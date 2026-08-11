import { useEffect, useState, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { usePDMStore } from '@/stores/pdmStore'
import { setAnalyticsUser, clearAnalyticsUser } from '@/lib/analytics'
import { setLoadFilesSessionContext } from '@/hooks/loadFilesCoordination'
import {
  supabase,
  isSupabaseConfigured,
  linkUserToOrganization,
  getUserProfile,
  setCurrentAccessToken,
  signOut,
  syncUserSessionsOrgId,
  updateLastOnline,
} from '@/lib/supabase'
import { logUserAction } from '@/lib/userActionLogger'
import { clearConfig } from '@/lib/supabaseConfig'
import { log } from '@/lib/logger'
import { recordMetric } from '@/lib/performanceMetrics'

const STATUS_MESSAGE_CLEAR_MS = 3_000
const CONNECT_TIMEOUT_MS = 90_000

export interface AuthSessionBoundary {
  authenticatedUserId: string | null
  sessionGeneration: number
}

export interface AutoConnectLoadContext {
  isOfflineMode: boolean
  authenticatedUserId: string | null
  sessionGeneration: number
  authInitialized: boolean
}

export function advanceAuthSessionBoundary(
  current: AuthSessionBoundary,
  event: string,
  authenticatedUserId: string | null,
): AuthSessionBoundary {
  const userChanged = current.authenticatedUserId !== authenticatedUserId
  const startsNewSession =
    event === 'SIGNED_IN' ||
    event === 'SIGNED_OUT' ||
    (event === 'INITIAL_SESSION' && authenticatedUserId !== null)

  if (!userChanged && !startsNewSession) return current

  return {
    authenticatedUserId,
    sessionGeneration: current.sessionGeneration + 1,
  }
}

export function shouldResetAuthSessionState(
  current: AuthSessionBoundary,
  event: string,
  authenticatedUserId: string | null,
): boolean {
  return !(
    event === 'INITIAL_SESSION' &&
    current.authenticatedUserId === null &&
    authenticatedUserId !== null
  )
}

export function shouldDeferAutoConnectLoad(context: AutoConnectLoadContext): boolean {
  if (context.isOfflineMode) return false
  if (context.authenticatedUserId !== null && context.sessionGeneration === 0) return true
  return !context.authInitialized
}

export function isAuthSessionCurrent(
  expected: AuthSessionBoundary,
  current: AuthSessionBoundary,
): boolean {
  return (
    expected.authenticatedUserId === current.authenticatedUserId &&
    expected.sessionGeneration === current.sessionGeneration
  )
}

/**
 * Truncate email for safe logging (e.g., "jo***@example.com")
 * Masks most of the local part while preserving domain for debugging
 */
function truncateEmail(email: string | null | undefined): string {
  if (!email) return '(no email)'
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const visibleChars = Math.min(2, local.length)
  return `${local.substring(0, visibleChars)}***@${domain}`
}

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
    setAuthInitialized,
    setOfflineMode,
    addToast,
    resetSessionState,
  } = usePDMStore(
    useShallow((s) => ({
      setUser: s.setUser,
      setOrganization: s.setOrganization,
      setStatusMessage: s.setStatusMessage,
      setVaultConnected: s.setVaultConnected,
      setIsConnecting: s.setIsConnecting,
      setAuthInitialized: s.setAuthInitialized,
      setOfflineMode: s.setOfflineMode,
      addToast: s.addToast,
      resetSessionState: s.resetSessionState,
    })),
  )

  // Track if Supabase is configured (can change at runtime)
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConfigured())
  const [sessionGeneration, setSessionGeneration] = useState(0)
  const sessionBoundaryRef = useRef<AuthSessionBoundary>({
    authenticatedUserId: null,
    sessionGeneration: 0,
  })
  const authEventSequenceRef = useRef(0)
  const authListenerEpochRef = useRef(0)

  const advanceSession = useCallback(
    (event: string, authenticatedUserId: string | null): AuthSessionBoundary => {
      const previous = sessionBoundaryRef.current
      const next = advanceAuthSessionBoundary(previous, event, authenticatedUserId)
      sessionBoundaryRef.current = next

      if (next.sessionGeneration !== previous.sessionGeneration) {
        setSessionGeneration(next.sessionGeneration)
        if (shouldResetAuthSessionState(previous, event, authenticatedUserId)) {
          resetSessionState()
        }
        setLoadFilesSessionContext(next)
      }

      return next
    },
    [resetSessionState],
  )

  // Handle Supabase being configured (from SetupScreen)
  const handleSupabaseConfigured = useCallback(() => {
    setSupabaseReady(true)
  }, [])

  // Handle user wanting to change organization (go back to setup)
  const handleChangeOrg = useCallback(async () => {
    advanceSession('SIGNED_OUT', null)
    // Sign out first if user is signed in
    await signOut()
    // Clear the stored Supabase config
    clearConfig()
    // Reset state to show setup screen
    setSupabaseReady(false)
  }, [advanceSession])

  // Initialize auth state via onAuthStateChange listener
  // NOTE: We removed the duplicate getCurrentSession() flow that was causing a race condition
  // Supabase fires INITIAL_SESSION or SIGNED_IN when restoring a persisted session on startup
  useEffect(() => {
    if (!supabaseReady) {
      return
    }

    // Listen for auth state changes (also handles session restoration on startup)
    const listenerEpoch = ++authListenerEpochRef.current
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (authListenerEpochRef.current !== listenerEpoch) return

      const eventSequence = ++authEventSequenceRef.current
      const sessionUserId = session?.user?.id ?? null

      const handlerBoundary = advanceSession(event, sessionUserId)
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        setAuthInitialized(false)
      }
      const isCurrentHandler = () =>
        authListenerEpochRef.current === listenerEpoch &&
        authEventSequenceRef.current === eventSequence &&
        isAuthSessionCurrent(handlerBoundary, sessionBoundaryRef.current)

      // Handle session events: INITIAL_SESSION (startup restore), SIGNED_IN (new login), TOKEN_REFRESHED
      if (
        (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
        session?.user
      ) {
        // Show connecting state while loading organization
        // Add timeout to prevent infinite hanging if network/db is slow
        let connectingTimeout: ReturnType<typeof setTimeout> | null = null
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          setIsConnecting(true)
          connectingTimeout = setTimeout(() => {
            if (!isCurrentHandler()) return
            log.warn('[Auth]', 'Organization loading timeout - clearing connecting state')
            setIsConnecting(false)
            addToast(
              'warning',
              'Loading your organization is taking longer than expected. Please check your internet connection.',
            )
          }, CONNECT_TIMEOUT_MS)
        }

        // Store access token for raw fetch calls (Supabase client methods hang)
        setCurrentAccessToken(session.access_token)

        try {
          // NOTE: ensureUserOrgId() removed - it used client.rpc() which hangs
          // linkUserToOrganization() handles org_id setup correctly as fallback

          // Fetch user profile from database to get role
          const profileStart = performance.now()
          const { profile, error: profileError } = await getUserProfile(session.user.id)
          const profileDuration = performance.now() - profileStart
          recordMetric('Startup', 'getUserProfile complete', {
            durationMs: Math.round(profileDuration),
            hasProfile: !!profile,
            hasOrgId: !!profile?.org_id,
          })
          if (profileError) {
            log.warn('[Auth]', 'Profile fetch error', { error: profileError.message })
          }

          if (!isCurrentHandler()) {
            if (connectingTimeout) clearTimeout(connectingTimeout)
            return
          }

          const userProfile = profile as {
            full_name?: string
            avatar_url?: string
            custom_avatar_url?: string
            job_title?: string
            org_id?: string
            role?: string
            last_sign_in?: string
          } | null

          // Set user from profile (includes role) or fallback to session data
          // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            full_name:
              userProfile?.full_name ||
              session.user.user_metadata?.full_name ||
              session.user.user_metadata?.name ||
              null,
            avatar_url:
              userProfile?.avatar_url ||
              session.user.user_metadata?.avatar_url ||
              session.user.user_metadata?.picture ||
              null,
            custom_avatar_url: userProfile?.custom_avatar_url || null,
            job_title: userProfile?.job_title || null,
            org_id: userProfile?.org_id || null,
            role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
            created_at: session.user.created_at,
            last_sign_in: userProfile?.last_sign_in || null,
          })
          log.info('[Auth]', 'User signed in', {
            email: truncateEmail(session.user.email),
            role: userProfile?.role || 'engineer',
          })

          // Update last_online timestamp
          updateLastOnline().catch((error) =>
            log.warn('[Auth]', 'Failed to update last_online', { error: error }),
          )

          // Set user for Sentry analytics (uses hashed IDs for privacy)
          setAnalyticsUser(session.user.id, userProfile?.org_id || undefined)

          if (event === 'SIGNED_IN') {
            if (!isCurrentHandler()) {
              if (connectingTimeout) clearTimeout(connectingTimeout)
              return
            }
            // Only show welcome message for new sign-ins, not session restoration
            setStatusMessage(
              `Welcome, ${session.user.user_metadata?.full_name || session.user.email}!`,
            )
            setTimeout(() => {
              if (isCurrentHandler()) setStatusMessage('')
            }, STATUS_MESSAGE_CLEAR_MS)

            // Disable offline mode when user signs in (they're now authenticated)
            // Use getState() to get current value, not stale closure value
            const currentOfflineMode = usePDMStore.getState().isOfflineMode
            if (currentOfflineMode && navigator.onLine) {
              setOfflineMode(false)
              addToast('success', 'Back online')
            }
          } else if (event === 'INITIAL_SESSION') {
            // Session restored from storage - user is already signed in
            log.info('[Auth]', 'Session restored from storage', {
              email: truncateEmail(session.user.email),
            })
          }

          // Load organization (setOrganization will clear isConnecting)
          // Pass cached org_id to avoid duplicate profile fetch in linkUserToOrganization
          const orgStart = performance.now()
          const { org, error: orgError } = await linkUserToOrganization(
            session.user.id,
            session.user.email || '',
            userProfile?.org_id,
          )
          const orgDuration = performance.now() - orgStart
          recordMetric('Startup', 'linkUserToOrganization complete', {
            durationMs: Math.round(orgDuration),
            hasOrg: !!org,
            usedCachedOrgId: !!userProfile?.org_id,
          })

          if (!isCurrentHandler()) {
            if (connectingTimeout) clearTimeout(connectingTimeout)
            return
          }

          if (org) {
            log.info('[Auth]', 'Organization loaded', { name: org.name })
            if (connectingTimeout) clearTimeout(connectingTimeout)
            setOrganization(org)

            // Update user's org_id in store if it wasn't set (triggers session re-registration with correct org_id)
            // This fixes the "no other users showing online" bug where sessions were registered with org_id=null
            const currentUser = usePDMStore.getState().user
            if (currentUser && !currentUser.org_id) {
              setUser({ ...currentUser, org_id: org.id })
              setAnalyticsUser(currentUser.id, org.id)
            }

            // Sync all user sessions to have the correct org_id (fixes sessions created before org was linked)
            syncUserSessionsOrgId(session.user.id, org.id)

            // Load user's team permissions
            if (isCurrentHandler()) {
              usePDMStore.getState().loadUserPermissions()
            }

            // Load user's workflow roles for real-time sync
            if (isCurrentHandler()) {
              usePDMStore.getState().loadUserWorkflowRoles()
            }

            // Load which modules an admin has restricted away from this user
            if (isCurrentHandler()) {
              usePDMStore.getState().loadModuleAccess()
            }
          } else {
            log.warn('[Auth]', 'No organization found', { error: orgError })
            if (connectingTimeout) clearTimeout(connectingTimeout)
            setIsConnecting(false)
            // Show a toast with helpful message
            addToast(
              'warning',
              (orgError instanceof Error ? orgError.message : orgError) ||
                'No organization found. Please enter an organization code or contact your administrator.',
            )
          }
          if (event === 'INITIAL_SESSION' && isCurrentHandler()) {
            setAuthInitialized(true)
          }
        } catch (error) {
          log.error('[Auth]', 'Error in auth state handler', { error: error })
          if (!isCurrentHandler()) return
          if (connectingTimeout) clearTimeout(connectingTimeout)
          setIsConnecting(false)
          if (event === 'INITIAL_SESSION') {
            setAuthInitialized(true)
          }
        }
      } else if (event === 'INITIAL_SESSION' && !session?.user) {
        if (!isCurrentHandler()) return
        log.info('[Auth]', 'No stored session found')
        setAuthInitialized(true)
      } else if (event === 'SIGNED_OUT') {
        if (!isCurrentHandler()) return
        logUserAction('auth', 'User signed out')
        log.info('[Auth]', 'User signed out')
        clearAnalyticsUser()
        setAuthInitialized(true)
        setUser(null)
        setOrganization(null)
        setVaultConnected(false)
        setIsConnecting(false)
        setStatusMessage('Signed out')
        setTimeout(() => {
          if (isCurrentHandler()) setStatusMessage('')
        }, STATUS_MESSAGE_CLEAR_MS)
      }
    })

    return () => {
      authListenerEpochRef.current += 1
      authEventSequenceRef.current += 1
      subscription.unsubscribe()
    }
  }, [
    supabaseReady,
    setUser,
    setOrganization,
    setStatusMessage,
    setVaultConnected,
    setIsConnecting,
    setAuthInitialized,
    setOfflineMode,
    addToast,
    advanceSession,
  ])

  return {
    supabaseReady,
    sessionGeneration,
    handleSupabaseConfigured,
    handleChangeOrg,
  }
}
