import { useEffect, useState, useCallback } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { setAnalyticsUser, clearAnalyticsUser } from '@/lib/analytics'
import { 
  supabase, 
  getCurrentSession, 
  isSupabaseConfigured, 
  linkUserToOrganization, 
  getUserProfile, 
  setCurrentAccessToken, 
  signOut, 
  syncUserSessionsOrgId,
  updateLastOnline
} from '@/lib/supabase'
import { logUserAction } from '@/lib/userActionLogger'
import { clearConfig } from '@/lib/supabaseConfig'

/**
 * Hook to manage authentication state and initialization
 * Handles:
 * - Supabase configuration check
 * - Session restoration on app start
 * - Auth state change listener (sign in/out)
 * - Organization loading and linking
 * - Analytics user setup
 */
export function useAuth() {
  const {
    setUser,
    setOrganization,
    setStatusMessage,
    setVaultConnected,
    setIsConnecting,
    setOfflineMode,
    addToast,
  } = usePDMStore()

  // Track if Supabase is configured (can change at runtime)
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConfigured())

  // Handle Supabase being configured (from SetupScreen)
  const handleSupabaseConfigured = useCallback(() => {
    setSupabaseReady(true)
  }, [])

  // Handle user wanting to change organization (go back to setup)
  const handleChangeOrg = useCallback(async () => {
    // Sign out first if user is signed in
    await signOut()
    // Clear the stored Supabase config
    clearConfig()
    // Reset state to show setup screen
    setSupabaseReady(false)
  }, [])

  // Initialize auth state (runs in background, doesn't block UI)
  useEffect(() => {
    if (!supabaseReady) {
      console.log('[Auth] Supabase not configured, waiting...')
      return
    }

    console.log('[Auth] Supabase ready, setting up auth listener...')

    // Check for existing session
    getCurrentSession().then(async ({ session }) => {
      if (session?.user) {
        console.log('[Auth] Found existing session:', session.user.email)
        
        // Store access token for raw fetch calls
        setCurrentAccessToken(session.access_token)
        
        try {
          // NOTE: ensureUserOrgId() removed - it used client.rpc() which hangs
          // linkUserToOrganization() handles org_id setup correctly as fallback
          
          // Fetch user profile from database to get role
          const { profile, error: profileError } = await getUserProfile(session.user.id)
          if (profileError) {
            console.log('[Auth] Error fetching profile:', profileError)
          }
          const userProfile = profile as { full_name?: string; avatar_url?: string; custom_avatar_url?: string; job_title?: string; org_id?: string; role?: string; last_sign_in?: string } | null
          
          // Set user from profile (includes role) or fallback to session data
          // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
          const userData = {
            id: session.user.id,
            email: session.user.email || '',
            full_name: userProfile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
            avatar_url: userProfile?.avatar_url || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
            custom_avatar_url: userProfile?.custom_avatar_url || null,
            job_title: userProfile?.job_title || null,
            org_id: userProfile?.org_id || null,
            role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
            created_at: session.user.created_at,
            last_sign_in: userProfile?.last_sign_in || null
          }
          setUser(userData)
          logUserAction('auth', 'User authenticated', { email: userData.email, role: userData.role })
          console.log('[Auth] User profile loaded:', { email: userData.email, role: userData.role })
          
          // Update last_online timestamp
          updateLastOnline().catch(err => console.warn('[Auth] Failed to update last_online:', err))
          
          // Set user for Sentry analytics (uses hashed IDs for privacy)
          setAnalyticsUser(userData.id, userData.org_id || undefined)
          
          // Then load organization using the working linkUserToOrganization function
          console.log('[Auth] Loading organization for:', session.user.email)
          const { org, error } = await linkUserToOrganization(session.user.id, session.user.email || '')
          if (org) {
            console.log('[Auth] Organization loaded:', (org as any).name)
            window.electronAPI?.log?.('info', `[Auth] Organization loaded: ${(org as any).name}`)
            window.electronAPI?.log?.('info', `[Auth] Organization settings keys: ${Object.keys((org as any).settings || {}).join(', ')}`)
            window.electronAPI?.log?.('info', `[Auth] DM License key in settings: ${(org as any).settings?.solidworks_dm_license_key ? 'PRESENT (' + (org as any).settings.solidworks_dm_license_key.length + ' chars)' : 'NOT PRESENT'}`)
            setOrganization(org as any)
            
            // Update user's org_id in store if it wasn't set (triggers session re-registration with correct org_id)
            if (!userData.org_id) {
              console.log('[Auth] Updating user org_id in store:', (org as any).id)
              setUser({ ...userData, org_id: (org as any).id })
              // Update analytics user with org_id
              setAnalyticsUser(userData.id, (org as any).id)
            }
            
            // Sync all user sessions to have the correct org_id (fixes sessions created before org was linked)
            syncUserSessionsOrgId(session.user.id, (org as any).id)
          } else if (error) {
            console.log('[Auth] No organization found:', error)
          }
        } catch (err) {
          console.error('[Auth] Error loading user profile:', err)
        }
      } else {
        console.log('[Auth] No existing session')
      }
    }).catch(err => {
      console.error('[Auth] Error checking session:', err)
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Auth] Auth state changed:', event, { hasSession: !!session, hasUser: !!session?.user })
        
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
          // Show connecting state while loading organization
          // Add timeout to prevent infinite hanging if network/db is slow
          let connectingTimeout: ReturnType<typeof setTimeout> | null = null
          if (event === 'SIGNED_IN') {
            setIsConnecting(true)
            // Safety timeout: clear isConnecting after 30s to prevent infinite hang
            connectingTimeout = setTimeout(() => {
              console.warn('[Auth] Organization loading timeout - clearing connecting state')
              setIsConnecting(false)
              addToast('warning', 'Connection timed out. You may need to sign in again.')
            }, 30000)
          }
          
          // Store access token for raw fetch calls (Supabase client methods hang)
          setCurrentAccessToken(session.access_token)
          
          try {
            // NOTE: ensureUserOrgId() removed - it used client.rpc() which hangs
            // linkUserToOrganization() handles org_id setup correctly as fallback
            
            // Fetch user profile from database to get role
            console.log('[Auth] Fetching user profile...')
            const { profile, error: profileError } = await getUserProfile(session.user.id)
            console.log('[Auth] Profile fetch result:', { hasProfile: !!profile, error: profileError?.message })
            
            const userProfile = profile as { full_name?: string; avatar_url?: string; custom_avatar_url?: string; job_title?: string; org_id?: string; role?: string; last_sign_in?: string } | null
            
            // Set user from profile (includes role) or fallback to session data
            // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              full_name: userProfile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
              avatar_url: userProfile?.avatar_url || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
              custom_avatar_url: userProfile?.custom_avatar_url || null,
              job_title: userProfile?.job_title || null,
              org_id: userProfile?.org_id || null,
              role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
              created_at: session.user.created_at,
              last_sign_in: userProfile?.last_sign_in || null
            })
            console.log('[Auth] User set:', { email: session.user.email, role: userProfile?.role || 'engineer' })
            
            // Update last_online timestamp
            updateLastOnline().catch(err => console.warn('[Auth] Failed to update last_online:', err))
            
            // Set user for Sentry analytics (uses hashed IDs for privacy)
            setAnalyticsUser(session.user.id, userProfile?.org_id || undefined)
            
            if (event === 'SIGNED_IN') {
              setStatusMessage(`Welcome, ${session.user.user_metadata?.full_name || session.user.email}!`)
              setTimeout(() => setStatusMessage(''), 3000)
              
              // Disable offline mode when user signs in (they're now authenticated)
              // Use getState() to get current value, not stale closure value
              const currentOfflineMode = usePDMStore.getState().isOfflineMode
              if (currentOfflineMode && navigator.onLine) {
                console.log('[Auth] Disabling offline mode after sign-in')
                setOfflineMode(false)
                addToast('success', 'Back online')
              }
            }
            
            // Load organization (setOrganization will clear isConnecting)
            console.log('[Auth] Loading organization...')
            const { org, error: orgError } = await linkUserToOrganization(session.user.id, session.user.email || '')
            if (org) {
              console.log('[Auth] Organization loaded:', (org as any).name)
              window.electronAPI?.log?.('info', `[Auth] Organization loaded: ${(org as any).name}`)
              window.electronAPI?.log?.('info', `[Auth] Organization settings keys: ${Object.keys((org as any).settings || {}).join(', ')}`)
              window.electronAPI?.log?.('info', `[Auth] DM License key in settings: ${(org as any).settings?.solidworks_dm_license_key ? 'PRESENT (' + (org as any).settings.solidworks_dm_license_key.length + ' chars)' : 'NOT PRESENT'}`)
              if (connectingTimeout) clearTimeout(connectingTimeout)
              setOrganization(org as any)
              
              // Update user's org_id in store if it wasn't set (triggers session re-registration with correct org_id)
              // This fixes the "no other users showing online" bug where sessions were registered with org_id=null
              const currentUser = usePDMStore.getState().user
              if (currentUser && !currentUser.org_id) {
                console.log('[Auth] Updating user org_id in store:', (org as any).id)
                setUser({ ...currentUser, org_id: (org as any).id })
                // Update analytics user with org_id
                setAnalyticsUser(currentUser.id, (org as any).id)
              }
              
              // Sync all user sessions to have the correct org_id (fixes sessions created before org was linked)
              syncUserSessionsOrgId(session.user.id, (org as any).id)
            } else {
              console.log('[Auth] No organization found:', orgError)
              if (connectingTimeout) clearTimeout(connectingTimeout)
              setIsConnecting(false)
              // Show a toast with helpful message
              addToast('warning', orgError?.message || 'No organization found. Please enter an organization code or contact your administrator.')
            }
          } catch (err) {
            console.error('[Auth] Error in auth state handler:', err)
            if (connectingTimeout) clearTimeout(connectingTimeout)
            setIsConnecting(false)
          }
        } else if (event === 'SIGNED_OUT') {
          logUserAction('auth', 'User signed out')
          console.log('[Auth] Signed out')
          clearAnalyticsUser()
          setUser(null)
          setOrganization(null)
          setVaultConnected(false)
          setIsConnecting(false)
          setStatusMessage('Signed out')
          setTimeout(() => setStatusMessage(''), 3000)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [supabaseReady, setUser, setOrganization, setStatusMessage, setVaultConnected, setIsConnecting, setOfflineMode, addToast])

  return {
    supabaseReady,
    handleSupabaseConfigured,
    handleChangeOrg,
  }
}
