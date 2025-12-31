import { useEffect, useState, useCallback, useRef } from 'react'
import { registerModule, unregisterModule } from '@/lib/telemetry'
import { setAnalyticsUser, clearAnalyticsUser } from '@/lib/analytics'
import { usePDMStore } from './stores/pdmStore'
import { SettingsContent } from './components/SettingsContent'
import type { SettingsTab } from './types/settings'
import { supabase, getCurrentSession, isSupabaseConfigured, getFilesLightweight, getCheckedOutUsers, linkUserToOrganization, getUserProfile, setCurrentAccessToken, registerDeviceSession, startSessionHeartbeat, stopSessionHeartbeat, signOut, syncUserSessionsOrgId, getAccessibleVaults } from './lib/supabase'
import { subscribeToFiles, subscribeToActivity, subscribeToOrganization, subscribeToColorSwatches, subscribeToPermissions, unsubscribeAll } from './lib/realtime'
import { getBackupStatus, isThisDesignatedMachine, updateHeartbeat } from './lib/backup'
import { MenuBar } from './components/MenuBar'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { FileBrowser } from './components/FileBrowser'
import { DetailsPanel } from './components/DetailsPanel'
// StatusBar removed - zoom now in MenuBar
import { WelcomeScreen } from './components/WelcomeScreen'
import { SetupScreen } from './components/SetupScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { Toast } from './components/Toast'
import { RightPanel } from './components/RightPanel'
import { OrphanedCheckoutsContainer } from './components/OrphanedCheckoutDialog'
import { StagedCheckinConflictDialog } from './components/StagedCheckinConflictDialog'
import type { StagedCheckin } from './stores/pdmStore'
import { MissingStorageFilesContainer } from './components/MissingStorageFilesDialog'
import { GoogleDrivePanel } from './components/GoogleDrivePanel'
import { WorkflowsView } from './components/sidebar/WorkflowsView'
import { ChristmasEffects } from './components/ChristmasEffects'
import { HalloweenEffects } from './components/HalloweenEffects'
import { WeatherEffects } from './components/WeatherEffects'
import { VaultNotFoundDialog } from './components/VaultNotFoundDialog'
import { PerformanceWindow } from './components/PerformanceWindow'
import { ImpersonationBanner } from './components/ImpersonationBanner'
import { UpdateModal } from './components/UpdateModal'
import { TabBar } from './components/TabBar'
import { TabWindow, isTabWindowMode, parseTabWindowParams } from './components/TabWindow'
import { executeTerminalCommand } from './lib/commands/parser'
import { executeCommand } from './lib/commands'
import { logKeyboard, logUserAction } from './lib/userActionLogger'
import { checkSchemaCompatibility } from './lib/schemaVersion'
import { clearConfig } from './lib/supabaseConfig'

// Check if we're in performance mode (pop-out window)
function isPerformanceMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'performance'
}

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

// Titlebar overlay colors for each theme
const titleBarOverlayColors: Record<string, { color: string; symbolColor: string }> = {
  'dark': { color: '#181818', symbolColor: '#cccccc' },
  'deep-blue': { color: '#071320', symbolColor: '#e3f2fd' },
  'light': { color: '#f0f0f0', symbolColor: '#333333' },
  'christmas': { color: '#1a0a0a', symbolColor: '#ff6b6b' },
  'halloween': { color: '#080808', symbolColor: '#ff6b2b' },
  'weather': { color: '#1c1916', symbolColor: '#fef3c7' }, // Default sunny, WeatherEffects will override
}

// Check if we should auto-apply a seasonal theme
// Returns the seasonal theme if applicable, or null if no override
function getSeasonalThemeOverride(): 'halloween' | 'christmas' | null {
  const now = new Date()
  const month = now.getMonth() // 0-indexed: 0 = Jan, 9 = Oct, 10 = Nov, 11 = Dec
  
  // Halloween: October 1-31 (month 9)
  if (month === 9) {
    return 'halloween'
  }
  
  // Christmas: December 1-31 (month 11)
  if (month === 11) {
    return 'christmas'
  }
  
  return null
}

// Apply theme to document and update titlebar overlay
// Sign-in screen: always use system theme
// Logged in: auto-applies seasonal themes (Halloween in October, Christmas in December) if setting is enabled
function useTheme() {
  const theme = usePDMStore(s => s.theme)
  const autoApplySeasonalThemes = usePDMStore(s => s.autoApplySeasonalThemes)
  const setTheme = usePDMStore(s => s.setTheme)
  const user = usePDMStore(s => s.user)
  const isOfflineMode = usePDMStore(s => s.isOfflineMode)
  
  // Determine if user is signed in
  const isSignedIn = !!user || isOfflineMode
  
  // Auto-apply seasonal theme when user signs in (if setting is enabled)
  useEffect(() => {
    // Only apply seasonal themes when signed in
    if (!isSignedIn) return
    
    // Don't auto-apply if setting is disabled
    if (!autoApplySeasonalThemes) return
    
    const seasonalTheme = getSeasonalThemeOverride()
    
    // If we're in a seasonal period and user's theme is NOT already the seasonal theme
    if (seasonalTheme && theme !== seasonalTheme) {
      // Check if we've already auto-switched this season (stored in localStorage to persist across restarts)
      const storageKey = `seasonal-theme-applied-${seasonalTheme}`
      const alreadyApplied = localStorage.getItem(storageKey)
      
      if (!alreadyApplied) {
        // Auto-switch to seasonal theme
        setTheme(seasonalTheme)
        localStorage.setItem(storageKey, 'true')
        console.log(`🎃🎄 Auto-applying ${seasonalTheme} theme for the season!`)
      }
    }
  }, [isSignedIn, autoApplySeasonalThemes]) // Re-run when sign-in status or setting changes
  
  useEffect(() => {
    // Determine the actual theme to apply
    // On sign-in screen: always use system theme
    // When signed in: use stored theme
    let effectiveTheme: string
    
    if (!isSignedIn) {
      // Sign-in screen: always use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    } else if (theme === 'system') {
      // Signed in with system theme: check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    } else if (theme === 'weather') {
      // Weather theme - set data-theme but let WeatherEffects handle colors
      effectiveTheme = 'weather'
    } else {
      effectiveTheme = theme
    }
    
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    
    // Update titlebar overlay colors (Windows only)
    // For weather theme, WeatherEffects will override this dynamically
    const overlayColors = titleBarOverlayColors[effectiveTheme] || titleBarOverlayColors['dark']
    window.electronAPI?.setTitleBarOverlay?.(overlayColors)
    
    // Listen for system preference changes when using system theme (or on sign-in screen)
    if (!isSignedIn || theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        const newTheme = e.matches ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', newTheme)
        // Also update titlebar overlay
        const colors = titleBarOverlayColors[newTheme] || titleBarOverlayColors['dark']
        window.electronAPI?.setTitleBarOverlay?.(colors)
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme, isSignedIn])
}

// Apply language to document (for Elvish Easter egg font)
function useLanguage() {
  const language = usePDMStore(s => s.language)
  
  useEffect(() => {
    document.documentElement.setAttribute('data-language', language)
  }, [language])
}

function App() {
  // Check for performance mode (pop-out window) early
  // Render standalone performance window if in that mode
  if (isPerformanceMode()) {
    return <PerformanceWindow />
  }
  
  // Check for tab window mode (popped out tab)
  if (isTabWindowMode()) {
    const tabParams = parseTabWindowParams()
    if (tabParams) {
      return <TabWindow view={tabParams.view} title={tabParams.title} customData={tabParams.customData} />
    }
  }
  
  // Apply theme and language
  useTheme()
  useLanguage()
  
  // Register App module for telemetry tracking
  useEffect(() => {
    registerModule('App')
    return () => unregisterModule('App')
  }, [])
  
  // Log app startup
  useEffect(() => {
    logUserAction('navigation', 'App started', {
      platform: navigator.platform,
      userAgent: navigator.userAgent.split(' ').slice(-1)[0] // Last part is Chrome version
    })
  }, [])
  
  const {
    user,
    organization,
    isOfflineMode,
    setOfflineMode,
    vaultPath,
    isVaultConnected,
    connectedVaults,
    activeVaultId,
    activeView,
    sidebarVisible,
    setSidebarWidth,
    toggleSidebar,
    detailsPanelVisible,
    toggleDetailsPanel,
    setDetailsPanelHeight,
    rightPanelVisible,
    setRightPanelWidth,
    rightPanelTabs,
    setVaultPath,
    setVaultConnected,
    setFiles,
    setServerFiles,
    setServerFolderPaths,
    setIsLoading,
    statusMessage,
    setStatusMessage,
    setFilesLoaded,
    addRecentVault,
    setUser,
    setOrganization,
    setIsConnecting,
    addToast,
    apiServerUrl,
    setApiServerUrl,
    stagedCheckins,
    unstageCheckin,
    getEffectiveRole,
  } = usePDMStore()
  
  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  // Consider vault connected if either legacy or new multi-vault system is connected
  const hasVaultConnected = isVaultConnected || connectedVaults.length > 0

  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingDetails, setIsResizingDetails] = useState(false)
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
  
  // Vault not found dialog state
  const [vaultNotFoundPath, setVaultNotFoundPath] = useState<string | null>(null)
  const [vaultNotFoundName, setVaultNotFoundName] = useState<string | undefined>(undefined)
  
  // Staged check-in conflict dialog state
  const [stagedConflicts, setStagedConflicts] = useState<Array<{
    staged: StagedCheckin
    serverVersion: number
    localPath: string
  }>>([])
  
  // Listen for settings tab navigation from MenuBar buttons
  useEffect(() => {
    const handleNavigateSettingsTab = (e: CustomEvent<SettingsTab>) => {
      setSettingsTab(e.detail)
    }
    window.addEventListener('navigate-settings-tab', handleNavigateSettingsTab as EventListener)
    return () => window.removeEventListener('navigate-settings-tab', handleNavigateSettingsTab as EventListener)
  }, [])
  
  // Track if Supabase is configured (can change at runtime)
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConfigured())
  
  // Get onboarding state
  const onboardingComplete = usePDMStore(s => s.onboardingComplete)
  
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

  // Offline mode is a manual toggle - no automatic switching based on network status
  // User controls when to work offline and when to go back online
  // This prevents unexpected syncs and gives user full control over when data is uploaded

  // Track previous offline mode to detect transition (ref updated later in staged check-in effect)
  const prevOfflineModeRef = useRef(isOfflineMode)

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
          const userProfile = profile as { full_name?: string; avatar_url?: string; job_title?: string; org_id?: string; role?: string; last_sign_in?: string } | null
          
          // Set user from profile (includes role) or fallback to session data
          // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
          const userData = {
            id: session.user.id,
            email: session.user.email || '',
            full_name: userProfile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
            avatar_url: userProfile?.avatar_url || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
            job_title: userProfile?.job_title || null,
            org_id: userProfile?.org_id || null,
            role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
            created_at: session.user.created_at,
            last_sign_in: userProfile?.last_sign_in || null
          }
          setUser(userData)
          logUserAction('auth', 'User authenticated', { email: userData.email, role: userData.role })
          console.log('[Auth] User profile loaded:', { email: userData.email, role: userData.role })
          
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
            
            const userProfile = profile as { full_name?: string; avatar_url?: string; job_title?: string; org_id?: string; role?: string; last_sign_in?: string } | null
            
            // Set user from profile (includes role) or fallback to session data
            // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              full_name: userProfile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
              avatar_url: userProfile?.avatar_url || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
              job_title: userProfile?.job_title || null,
              org_id: userProfile?.org_id || null,
              role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
              created_at: session.user.created_at,
              last_sign_in: userProfile?.last_sign_in || null
            })
            console.log('[Auth] User set:', { email: session.user.email, role: userProfile?.role || 'engineer' })
            
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
  }, [supabaseReady, setUser, setOrganization, setStatusMessage, setVaultConnected, setIsConnecting])

  // Sync API URL from organization settings to store (which handles localStorage persistence)
  // This ensures the API URL is restored on app launch, not just when opening Settings → REST API
  // Also syncs when admin clears the URL (org value takes precedence over local cache)
  useEffect(() => {
    // Normalize both values to compare - treat undefined, null, and empty string as null
    const orgApiUrl = organization?.settings?.api_url || null
    const currentApiUrl = apiServerUrl || null
    
    if (orgApiUrl !== currentApiUrl) {
      console.log('[App] Syncing API URL from org settings to store:', orgApiUrl || '(cleared)')
      setApiServerUrl(orgApiUrl)
    }
  }, [organization?.settings?.api_url, apiServerUrl, setApiServerUrl])

  // Load color swatches when user and organization are available
  useEffect(() => {
    if (user && organization) {
      const { syncColorSwatches } = usePDMStore.getState()
      syncColorSwatches().catch(err => {
        console.warn('[ColorSwatches] Failed to sync:', err)
      })
    }
  }, [user?.id, organization?.id])

  // Validate connected vault IDs after organization loads
  // This cleans up stale vaults that no longer exist on the server or that user lost access to
  useEffect(() => {
    const validateVaults = async () => {
      if (!organization || !user || connectedVaults.length === 0) return
      
      console.log('[VaultValidation] Checking', connectedVaults.length, 'connected vaults against accessible vaults')
      
      try {
        // Fetch vaults the user has access to (filters by permissions)
        const { vaults: serverVaults, error } = await getAccessibleVaults(
          user.id,
          organization.id,
          getEffectiveRole()
        )
        
        if (error) {
          console.error('[VaultValidation] Failed to fetch accessible vaults:', error)
          return
        }
        
        const serverVaultIds = new Set((serverVaults || []).map((v) => v.id))
        console.log('[VaultValidation] User has access to', serverVaultIds.size, 'vaults:', Array.from(serverVaultIds))
        
        // Find stale vaults (connected but not on server)
        const staleVaults = connectedVaults.filter(cv => !serverVaultIds.has(cv.id))
        
        if (staleVaults.length > 0) {
          console.warn('[VaultValidation] Found', staleVaults.length, 'stale vault(s):', staleVaults.map(v => ({ id: v.id, name: v.name })))
          
          // Remove stale vaults
          const store = usePDMStore.getState()
          staleVaults.forEach(v => {
            console.log('[VaultValidation] Removing stale vault:', v.name, v.id)
            store.removeConnectedVault(v.id)
          })
          
          // If we removed the active vault, try to reconnect to a server vault
          if (staleVaults.some(v => v.id === currentVaultId) && serverVaults && serverVaults.length > 0) {
            const defaultVault = (serverVaults as any[]).find((v: any) => v.is_default) || serverVaults[0]
            console.log('[VaultValidation] Active vault was stale, will need to reconnect to:', (defaultVault as any).name)
            // Clear vault connected state to trigger reconnection flow
            setVaultConnected(false)
            setVaultPath(null)
          }
        } else {
          console.log('[VaultValidation] All connected vaults are valid')
        }
      } catch (err) {
        console.error('[VaultValidation] Error validating vaults:', err)
      }
    }
    
    validateVaults()
  }, [organization, user?.id, connectedVaults, currentVaultId, setVaultConnected, setVaultPath])

  // Track if we've already shown the schema warning this session (prevent duplicate toasts)
  const schemaCheckDoneRef = useRef(false)
  
  // Check schema compatibility after organization loads
  // Warns users if the database schema is outdated compared to what the app expects
  useEffect(() => {
    const checkSchema = async () => {
      // Only check once per session, and only when we have an org
      if (!organization?.id || isOfflineMode || schemaCheckDoneRef.current) return
      
      schemaCheckDoneRef.current = true
      
      try {
        const result = await checkSchemaCompatibility()
        console.log('[SchemaVersion] Check result:', result)
        
        if (result.status === 'missing') {
          // Schema version table doesn't exist - older database
          addToast('warning', `${result.message}: ${result.details}`, 15000)
        } else if (result.status === 'incompatible') {
          // Critical - database too old, might cause errors
          addToast('error', `${result.message}: ${result.details}`, 0) // Don't auto-dismiss
        } else if (result.status === 'outdated') {
          // Soft warning - some features might not work
          // Check if the app is outdated vs database is outdated
          if (result.dbVersion && result.dbVersion > result.expectedVersion) {
            // Database is newer than app - user should update the app
            addToast('info', `${result.message}. ${result.details}`, 10000)
          } else {
            // Database is older than app - admin should run migrations
            addToast('warning', `${result.message}. ${result.details}`, 10000)
          }
        }
        // 'current' status = no toast needed, everything is fine
      } catch (err) {
        console.error('[SchemaVersion] Error checking schema:', err)
      }
    }
    
    checkSchema()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, isOfflineMode])

  // Load files from working directory and merge with PDM data
  // silent = true means no loading spinner (for background refreshes after downloads/uploads)
  const loadFiles = useCallback(async (silent: boolean = false) => {
    window.electronAPI?.log('info', '[LoadFiles] Called with', { vaultPath, currentVaultId, silent })
    if (!window.electronAPI || !vaultPath) return
    
    if (!silent) {
      setIsLoading(true)
      setStatusMessage('Loading files...')
      // Yield to UI thread so loading state renders before heavy work
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    
    try {
      // Run local file scan and server fetch in PARALLEL for faster boot
      // Note: listWorkingFiles now returns FAST (no blocking hash computation)
      // Hashes are computed in background after initial display
      const shouldFetchServer = organization && !isOfflineMode && currentVaultId
      
      if (!silent) {
        setStatusMessage(shouldFetchServer ? 'Loading local & cloud files...' : 'Scanning local files...')
      }
      
      // Start both operations at once
      const localPromise = window.electronAPI.listWorkingFiles()
      const serverPromise = shouldFetchServer 
        ? getFilesLightweight(organization.id, currentVaultId)
        : Promise.resolve({ files: null, error: null })
      
      // Wait for both to complete
      const [localResult, serverResult] = await Promise.all([localPromise, serverPromise])
      
      // Process local files
      if (!localResult.success || !localResult.files) {
        const errorMsg = localResult.error || 'Failed to load files'
        window.electronAPI?.log('error', '[LoadFiles] Local file scan failed', { errorMsg, vaultPath, hasWorkingDir: !!localResult })
        setStatusMessage(errorMsg)
        return
      }
      
      window.electronAPI?.log('info', '[LoadFiles] Scanned local items', { count: localResult.files.length })
      window.electronAPI?.log('info', '[LoadFiles] Server query params', { 
        orgId: organization?.id, 
        vaultId: currentVaultId,
        shouldFetchServer,
        serverFileCount: serverResult.files?.length || 0,
        serverError: serverResult.error?.message 
      })
      
      // Debug: Log first few paths for comparison (helps debug path matching issues)
      if (serverResult.files && serverResult.files.length > 0) {
        const sampleServer = serverResult.files.slice(0, 5).map((f: any) => f.file_path)
        const sampleLocal = localResult.files.filter((f: any) => !f.isDirectory).slice(0, 5).map((f: any) => f.relativePath)
        window.electronAPI?.log('info', '[LoadFiles] Sample SERVER paths', sampleServer)
        window.electronAPI?.log('info', '[LoadFiles] Sample LOCAL paths', sampleLocal)
        
        // Try to find a matching file by name and compare full paths
        const firstServerFile = serverResult.files[0] as any
        if (firstServerFile) {
          const serverFileName = firstServerFile.file_name || firstServerFile.file_path.split('/').pop()
          const matchingLocal = localResult.files.find((f: any) => f.name === serverFileName)
          if (matchingLocal) {
            window.electronAPI?.log('info', '[LoadFiles] PATH COMPARISON', {
              fileName: serverFileName,
              serverPath: firstServerFile.file_path,
              localPath: matchingLocal.relativePath,
              serverLower: firstServerFile.file_path.toLowerCase(),
              localLower: matchingLocal.relativePath.toLowerCase(),
              pathsEqual: firstServerFile.file_path.toLowerCase() === matchingLocal.relativePath.toLowerCase()
            })
          } else {
            window.electronAPI?.log('warn', '[LoadFiles] Could not find local file with name', { serverFileName })
          }
        }
      }
      
      // Map hash to localHash for comparison
      let localFiles = localResult.files.map((f: any) => ({
        ...f,
        localHash: f.hash
      }))
      
      // Get ignored paths checker for later use (don't filter, just mark as ignored)
      const isIgnoredPath = currentVaultId 
        ? (path: string) => usePDMStore.getState().isPathIgnored(currentVaultId, path)
        : () => false
      
      // 2. If connected to Supabase, merge PDM data
      if (shouldFetchServer) {
        const pdmFiles = serverResult.files
        const pdmError = serverResult.error
        
        if (pdmError) {
          window.electronAPI?.log('warn', '[LoadFiles] Failed to fetch PDM data', { error: pdmError })
        } else if (pdmFiles && Array.isArray(pdmFiles)) {
          if (!silent) {
            setStatusMessage(`Merging ${pdmFiles.length} files...`)
          }
          
          // Create a map of pdm data by file path (case-insensitive for Windows compatibility)
          // Windows filesystems are case-insensitive, so we normalize to lowercase for matching
          const pdmMap = new Map(pdmFiles.map((f: any) => [f.file_path.toLowerCase(), f]))
          
          // Debug: verify pdmMap keys
          const pdmMapKeys = Array.from(pdmMap.keys()).slice(0, 3)
          window.electronAPI?.log('info', '[LoadFiles] pdmMap sample keys (lowercase)', pdmMapKeys)
          
          // Store server files for tracking deletions
          const serverFilesList = pdmFiles.map((f: any) => ({
            id: f.id,
            file_path: f.file_path,
            name: f.name,
            extension: f.extension,
            content_hash: f.content_hash || ''
          }))
          setServerFiles(serverFilesList)
          
          // Clean up auto-download exclusions for files that no longer exist on the server
          if (currentVaultId) {
            const serverFilePaths = new Set(pdmFiles.map((f: any) => f.file_path))
            usePDMStore.getState().cleanupStaleExclusions(currentVaultId, serverFilePaths)
          }
          
          // Compute all folder paths that exist on the server
          const serverFolderPathsSet = new Set<string>()
          for (const file of pdmFiles as any[]) {
            const pathParts = file.file_path.split('/')
            let currentPath = ''
            for (let i = 0; i < pathParts.length - 1; i++) {
              currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
              serverFolderPathsSet.add(currentPath)
            }
          }
          setServerFolderPaths(serverFolderPathsSet)
          
          // Create set of local file paths for deletion detection (case-insensitive)
          const localPathSet = new Set(localFiles.map(f => f.relativePath.toLowerCase()))
          
          // Create a map of existing files' localActiveVersion to preserve rollback state
          // Use getState() to get current files at execution time (not stale closure value)
          const currentFiles = usePDMStore.getState().files
          const existingLocalActiveVersions = new Map<string, number>()
          for (const f of currentFiles) {
            if (f.localActiveVersion !== undefined) {
              existingLocalActiveVersions.set(f.path, f.localActiveVersion)
            }
          }
          
          // Create a map of files checked out by me, keyed by content hash for move detection
          // This allows us to detect moved files (same content, different path) and preserve their pdmData
          // IMPORTANT: Only track checked-out-by-me files - if a file isn't checked out by me,
          // I couldn't have moved it, so matching hashes should be treated as new files, not moves.
          const checkedOutByMeByHash = new Map<string, any>()
          for (const pdmFile of pdmFiles as any[]) {
            if (pdmFile.content_hash && pdmFile.checked_out_by === user?.id) {
              checkedOutByMeByHash.set(pdmFile.content_hash, pdmFile)
            }
          }
          
          // Merge PDM data into local files and compute diff status
          let matchedCount = 0
          let unmatchedCount = 0
          const unmatchedSamples: string[] = []
          
          localFiles = localFiles.map(localFile => {
            if (localFile.isDirectory) return localFile
            
            // Use lowercase for case-insensitive matching (Windows compatibility)
            const lookupKey = localFile.relativePath.toLowerCase()
            let pdmData = pdmMap.get(lookupKey)
            let isMovedFile = false
            
            // Debug: track match/unmatch counts
            if (pdmData) {
              matchedCount++
            } else {
              unmatchedCount++
              if (unmatchedSamples.length < 5) {
                unmatchedSamples.push(lookupKey)
              }
            }
            
            // If no path match but file has same hash as a file CHECKED OUT BY ME,
            // this MIGHT be a moved file - but only if the original path no longer exists locally.
            // If the original path still has a file, then this is a COPY, not a move.
            // IMPORTANT: Only detect moves for files checked out by me - otherwise a new file
            // with the same content as some random server file would be incorrectly detected as moved.
            if (!pdmData && localFile.localHash) {
              const movedFromFile = checkedOutByMeByHash.get(localFile.localHash)
              if (movedFromFile) {
                // Check if the original file path still exists locally (case-insensitive)
                // If it does, this is a copy/duplicate, not a move
                const originalPathStillExists = localPathSet.has(movedFromFile.file_path.toLowerCase())
                
                if (!originalPathStillExists) {
                  // Original location is empty - this IS a move
                  pdmData = movedFromFile
                  isMovedFile = true
                }
                // If originalPathStillExists, leave pdmData as undefined - this is a new file (copy)
              }
            }
            
            // Preserve localActiveVersion from existing file (for rollback state)
            const existingLocalActiveVersion = existingLocalActiveVersions.get(localFile.path)
            
            // Determine diff status
            let diffStatus: 'added' | 'modified' | 'outdated' | 'moved' | 'ignored' | undefined
            if (!pdmData) {
              // File exists locally but not on server
              // Check if it's in the ignore list (keep local only)
              if (isIgnoredPath(localFile.relativePath)) {
                diffStatus = 'ignored'
              } else {
                diffStatus = 'added'
              }
            } else if (isMovedFile) {
              // File was moved - needs check-in to update server path (but no version increment)
              diffStatus = 'moved'
            } else if (pdmData.content_hash && localFile.localHash) {
              // File exists both places - check if modified or outdated
              if (pdmData.content_hash !== localFile.localHash) {
                // Hashes differ - determine if local is newer or cloud is newer
                const localModTime = new Date(localFile.modifiedTime).getTime()
                const cloudUpdateTime = pdmData.updated_at ? new Date(pdmData.updated_at).getTime() : 0
                
                if (localModTime > cloudUpdateTime) {
                  // Local file was modified more recently - local changes
                  diffStatus = 'modified'
                } else {
                  // Cloud was updated more recently - need to pull
                  diffStatus = 'outdated'
                  // Debug: Log outdated file details
                  window.electronAPI?.log('debug', '[LoadFiles] File marked as OUTDATED', {
                    name: localFile.name,
                    relativePath: localFile.relativePath,
                    localHash: localFile.localHash?.substring(0, 16),
                    serverHash: pdmData.content_hash?.substring(0, 16),
                    localModTime: new Date(localModTime).toISOString(),
                    cloudUpdateTime: new Date(cloudUpdateTime).toISOString(),
                    fileId: pdmData.id,
                    version: pdmData.version,
                    checkedOutBy: pdmData.checked_out_by
                  })
                }
              }
            } else if (pdmData.content_hash && !localFile.localHash) {
              // Debug: Log files waiting for hash computation
              window.electronAPI?.log('debug', '[LoadFiles] File waiting for hash computation', {
                name: localFile.name,
                relativePath: localFile.relativePath,
                hasServerHash: !!pdmData.content_hash,
                hasLocalHash: !!localFile.localHash
              })
            }
            // NOTE: If cloud has hash but local doesn't have one yet, leave diffStatus undefined
            // The background hash computation will set the proper status once hashes are computed
            
            return {
              ...localFile,
              pdmData: pdmData || undefined,
              isSynced: !!pdmData,
              diffStatus,
              // Preserve rollback state if it exists
              localActiveVersion: existingLocalActiveVersion
            }
          })
          
          // Debug: Log match statistics
          window.electronAPI?.log('info', '[LoadFiles] MATCH STATS', {
            matched: matchedCount,
            unmatched: unmatchedCount,
            serverTotal: pdmFiles.length,
            unmatchedSamples
          })
          
          // Add cloud-only files (exist on server but not locally) as "cloud" or "deleted" entries
          // "cloud" = available for download (muted)
          // "deleted" = was checked out by me but removed locally (red) - indicates moved/deleted file
          // Note: if a file was MOVED (same content hash exists locally), don't show the deleted ghost
          const cloudFolders = new Set<string>()
          
          // Create a set of local content hashes to detect moved files
          const localContentHashes = new Set(
            localFiles.filter(f => !f.isDirectory && f.localHash).map(f => f.localHash)
          )
          
          for (const pdmFile of pdmFiles as any[]) {
            if (!localPathSet.has(pdmFile.file_path.toLowerCase())) {
              // Check if this file was MOVED (same content exists at a different location locally)
              const isCheckedOutByMe = pdmFile.checked_out_by === user?.id
              const wasMoved = pdmFile.content_hash && localContentHashes.has(pdmFile.content_hash)
              
              // If moved, don't show the ghost at the old location - the file is handled at the new location
              if (wasMoved) {
                continue
              }
              
              // If checked out by me but not moved, it was truly deleted locally
              const isDeletedByMe = isCheckedOutByMe
              
              // Add cloud parent folders for this file
              const pathParts = pdmFile.file_path.split('/')
              let currentPath = ''
              for (let i = 0; i < pathParts.length - 1; i++) {
                currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
                if (!localPathSet.has(currentPath.toLowerCase()) && !cloudFolders.has(currentPath)) {
                  cloudFolders.add(currentPath)
                }
              }
              
              // Add the cloud-only file (not synced locally)
              localFiles.push({
                name: pdmFile.file_name,
                path: buildFullPath(vaultPath, pdmFile.file_path),
                relativePath: pdmFile.file_path,
                isDirectory: false,
                extension: pdmFile.extension,
                size: pdmFile.file_size || 0,
                modifiedTime: pdmFile.updated_at || '',
                pdmData: pdmFile,
                isSynced: false, // Not synced locally
                diffStatus: isDeletedByMe ? 'deleted' : 'cloud' // Deleted if I moved/removed it, otherwise cloud
              })
            }
          }
          
          // Add cloud folders (folders that exist on server but not locally)
          for (const folderPath of cloudFolders) {
            const folderName = folderPath.split('/').pop() || folderPath
            localFiles.push({
              name: folderName,
              path: buildFullPath(vaultPath, folderPath),
              relativePath: folderPath,
              isDirectory: true,
              extension: '',
              size: 0,
              modifiedTime: '',
              diffStatus: 'cloud'
            })
          }
          
          // Debug: Log merge summary
          const syncedCount = localFiles.filter(f => !f.isDirectory && f.isSynced).length
          const addedCount = localFiles.filter(f => !f.isDirectory && f.diffStatus === 'added').length
          const cloudCount = localFiles.filter(f => !f.isDirectory && f.diffStatus === 'cloud').length
          window.electronAPI?.log('info', '[LoadFiles] Merge summary', {
            serverFiles: pdmFiles.length,
            localFilesAfterMerge: localFiles.filter(f => !f.isDirectory).length,
            synced: syncedCount,
            added: addedCount,
            cloudOnly: cloudCount,
          })
        }
      } else {
        // Offline mode or no org - local files are "added" unless ignored
        localFiles = localFiles.map(f => ({
          ...f,
          diffStatus: f.isDirectory ? undefined : (isIgnoredPath(f.relativePath) ? 'ignored' as const : 'added' as const)
        }))
      }
      
      // Update folder diffStatus based on contents
      // A folder should be 'cloud' if all its contents are cloud-only AND it has some cloud content
      // Empty folders that exist locally should NOT be marked as cloud
      // Process folders bottom-up (deepest first) so parent folders see updated child statuses
      const folders = localFiles.filter(f => f.isDirectory)
      
      // Sort folders by depth (deepest first)
      folders.sort((a, b) => {
        const depthA = a.relativePath.split(/[/\\]/).length
        const depthB = b.relativePath.split(/[/\\]/).length
        return depthB - depthA
      })
      
      // Check each folder from deepest to shallowest
      for (const folder of folders) {
        const normalizedFolder = folder.relativePath.replace(/\\/g, '/')
        
        // Get direct children of this folder
        const directChildren = localFiles.filter(f => {
          if (f.relativePath === folder.relativePath) return false // Skip self
          const normalizedPath = f.relativePath.replace(/\\/g, '/')
          
          // Check if it's a direct child (not nested deeper)
          if (!normalizedPath.startsWith(normalizedFolder + '/')) return false
          const remainder = normalizedPath.slice(normalizedFolder.length + 1)
          if (remainder.includes('/')) return false // It's nested deeper, not direct child
          
          return true
        })
        
        const hasLocalContent = directChildren.some(f => f.diffStatus !== 'cloud')
        const hasCloudContent = directChildren.some(f => f.diffStatus === 'cloud')
        
        // Only mark as cloud if folder has cloud content AND no local content
        // Empty local folders should stay as normal folders
        if (!hasLocalContent && hasCloudContent) {
          // Update this folder to cloud status
          const folderInList = localFiles.find(f => f.relativePath === folder.relativePath)
          if (folderInList) {
            folderInList.diffStatus = 'cloud'
          }
        }
      }
      
      setFiles(localFiles)
      setFilesLoaded(true)  // Mark that initial load is complete
      const totalFiles = localFiles.filter(f => !f.isDirectory).length
      const syncedCount = localFiles.filter(f => !f.isDirectory && f.pdmData).length
      const folderCount = localFiles.filter(f => f.isDirectory).length
      setStatusMessage(`Loaded ${totalFiles} files, ${folderCount} folders${syncedCount > 0 ? ` (${syncedCount} synced)` : ''}`)
      
      // Background tasks (non-blocking) - run after UI renders
      if (user && window.electronAPI) {
        setTimeout(async () => {
          // 1. Set read-only status on synced files
          for (const file of localFiles) {
            if (file.isDirectory || !file.pdmData) continue
            const isCheckedOutByMe = file.pdmData.checked_out_by === user.id
            window.electronAPI.setReadonly(file.path, !isCheckedOutByMe)
          }
          
          // 2. Lazy-load checked out user info for UI display
          // This adds user names/emails without blocking initial render
          const checkedOutFileIds = localFiles
            .filter(f => !f.isDirectory && f.pdmData?.checked_out_by)
            .map(f => f.pdmData!.id)
          
          if (checkedOutFileIds.length > 0 && organization) {
            const { users: userInfo } = await getCheckedOutUsers(checkedOutFileIds)
            const userInfoMap = userInfo as Record<string, { email: string; full_name: string; avatar_url?: string }>
            if (Object.keys(userInfoMap).length > 0) {
              // Update files in store with user info
              const currentFiles = usePDMStore.getState().files
              const updatedFiles = currentFiles.map(f => {
                const fileId = f.pdmData?.id
                if (fileId && fileId in userInfoMap && f.pdmData) {
                  return {
                    ...f,
                    pdmData: {
                      ...f.pdmData,
                      checked_out_user: userInfoMap[fileId]
                    }
                  } as typeof f
                }
                return f
              })
              setFiles(updatedFiles)
            }
          }
          
          // 3. Background hash computation for files without hashes
          // This runs progressively without blocking the UI
          const filesNeedingHash = localFiles.filter(f => 
            !f.isDirectory && !f.localHash && f.pdmData?.content_hash
          )
          
          if (filesNeedingHash.length > 0 && window.electronAPI.computeFileHashes) {
            window.electronAPI?.log('info', '[LoadFiles] Computing hashes for', { count: filesNeedingHash.length })
            setStatusMessage(`Checking ${filesNeedingHash.length} files for changes...`)
            
            // Prepare file list for hash computation
            const hashRequests = filesNeedingHash.map(f => ({
              path: f.path,
              relativePath: f.relativePath,
              size: f.size,
              mtime: new Date(f.modifiedTime).getTime()
            }))
            
            try {
              // Compute hashes in background (with progress updates via IPC)
              const { results } = await window.electronAPI.computeFileHashes(hashRequests)
              
              if (results && results.length > 0) {
                // Create a map for quick lookup
                const hashMap = new Map(results.map(r => [r.relativePath, r.hash]))
                
                // Update files with computed hashes and recompute diff status
                const currentFiles = usePDMStore.getState().files
                const updatedFiles = currentFiles.map(f => {
                  if (f.isDirectory) return f
                  
                  const computedHash = hashMap.get(f.relativePath)
                  if (!computedHash) return f
                  
                  // Recompute diff status with the new hash
                  let newDiffStatus = f.diffStatus
                  if (f.pdmData?.content_hash && computedHash) {
                    if (f.pdmData.content_hash !== computedHash) {
                      // Hashes differ - check which is newer
                      const localModTime = new Date(f.modifiedTime).getTime()
                      const cloudUpdateTime = f.pdmData.updated_at ? new Date(f.pdmData.updated_at).getTime() : 0
                      newDiffStatus = localModTime > cloudUpdateTime ? 'modified' : 'outdated'
                      // Debug: log hash mismatches to help identify stale data issues
                      window.electronAPI?.log('warn', '[HashCompute] Hash mismatch detected', {
                        file: f.name,
                        localHash: computedHash.substring(0, 12),
                        serverHash: f.pdmData.content_hash.substring(0, 12),
                        localModTime: new Date(localModTime).toISOString(),
                        serverUpdatedAt: f.pdmData.updated_at,
                        result: newDiffStatus,
                        checkedOut: !!f.pdmData.checked_out_by
                      })
                    } else {
                      // Hashes match - no diff
                      newDiffStatus = undefined
                    }
                  }
                  
                  return {
                    ...f,
                    localHash: computedHash,
                    diffStatus: newDiffStatus
                  }
                })
                
                setFiles(updatedFiles)
                window.electronAPI?.log('info', '[LoadFiles] Hash computation complete', { updated: results.length })
              }
            } catch (err) {
              window.electronAPI?.log('error', '[LoadFiles] Hash computation failed', { error: String(err) })
            }
            
            // Clear the status message after hash computation
            setStatusMessage('')
          }
          
          // 4. Auto-download cloud files and updates (if enabled)
          // Run after hash computation so we have accurate diff statuses
          // IMPORTANT: Skip on silent refreshes to prevent infinite loops
          // (silent refreshes are triggered by download/update commands completing)
          if (silent) {
            window.electronAPI?.log('info', '[AutoDownload] Skipping - silent refresh')
          }
          
          const { autoDownloadCloudFiles, autoDownloadUpdates, addToast, autoDownloadExcludedFiles, activeVaultId } = usePDMStore.getState()
          
          if (!silent && (autoDownloadCloudFiles || autoDownloadUpdates) && organization && !isOfflineMode) {
            const latestFiles = usePDMStore.getState().files
            
            // Get exclusion list for current vault
            const excludedPaths = activeVaultId ? (autoDownloadExcludedFiles[activeVaultId] || []) : []
            const excludedPathsSet = new Set(excludedPaths)
            
            // Auto-download cloud-only files
            if (autoDownloadCloudFiles) {
              const cloudOnlyFiles = latestFiles.filter(f => 
                !f.isDirectory && 
                f.diffStatus === 'cloud' && 
                f.pdmData?.content_hash &&
                // Exclude files that were intentionally removed locally
                !excludedPathsSet.has(f.relativePath)
              )
              
              if (cloudOnlyFiles.length > 0) {
                window.electronAPI?.log('info', '[AutoDownload] Downloading cloud files', { count: cloudOnlyFiles.length })
                try {
                  // Don't pass onRefresh - we already skipped auto-download on silent refreshes,
                  // and the download command will update the store. User can manually refresh if needed.
                  const result = await executeCommand('download', { files: cloudOnlyFiles })
                  if (result.succeeded > 0) {
                    addToast('success', `Auto-downloaded ${result.succeeded} cloud file${result.succeeded > 1 ? 's' : ''}`)
                  }
                  if (result.failed > 0) {
                    window.electronAPI?.log('warn', '[AutoDownload] Some downloads failed', { failed: result.failed, errors: result.errors })
                  }
                } catch (err) {
                  window.electronAPI?.log('error', '[AutoDownload] Failed to download cloud files', { error: String(err) })
                }
              }
            }
            
            // Auto-download updates for outdated files
            if (autoDownloadUpdates) {
              // Debug: Log all files with outdated status before filtering
              const allOutdatedStatus = latestFiles.filter(f => f.diffStatus === 'outdated')
              window.electronAPI?.log('debug', '[AutoDownload] Files with outdated status', {
                count: allOutdatedStatus.length,
                files: allOutdatedStatus.map(f => ({
                  name: f.name,
                  relativePath: f.relativePath,
                  isDirectory: f.isDirectory,
                  hasContentHash: !!f.pdmData?.content_hash,
                  contentHash: f.pdmData?.content_hash?.substring(0, 12),
                  localHash: f.localHash?.substring(0, 12),
                  fileId: f.pdmData?.id,
                  checkedOutBy: f.pdmData?.checked_out_by
                }))
              })
              
              const outdatedFiles = latestFiles.filter(f => 
                !f.isDirectory && f.diffStatus === 'outdated' && f.pdmData?.content_hash
              )
              
              // Debug: Log files that were filtered out
              const filteredOut = allOutdatedStatus.filter(f => 
                f.isDirectory || !f.pdmData?.content_hash
              )
              if (filteredOut.length > 0) {
                window.electronAPI?.log('warn', '[AutoDownload] Outdated files FILTERED OUT (no content_hash or is directory)', {
                  count: filteredOut.length,
                  files: filteredOut.map(f => ({
                    name: f.name,
                    isDirectory: f.isDirectory,
                    hasContentHash: !!f.pdmData?.content_hash
                  }))
                })
              }
              
              if (outdatedFiles.length > 0) {
                window.electronAPI?.log('info', '[AutoDownload] Updating outdated files', { 
                  count: outdatedFiles.length,
                  files: outdatedFiles.map(f => ({
                    name: f.name,
                    relativePath: f.relativePath,
                    localHash: f.localHash?.substring(0, 12),
                    serverHash: f.pdmData?.content_hash?.substring(0, 12),
                    fileId: f.pdmData?.id
                  }))
                })
                try {
                  // Don't pass onRefresh - same reason as above
                  const result = await executeCommand('get-latest', { files: outdatedFiles })
                  window.electronAPI?.log('info', '[AutoDownload] Update result', {
                    total: result.total,
                    succeeded: result.succeeded,
                    failed: result.failed,
                    errors: result.errors
                  })
                  if (result.succeeded > 0) {
                    addToast('success', `Auto-updated ${result.succeeded} file${result.succeeded > 1 ? 's' : ''}`)
                  }
                  if (result.failed > 0) {
                    window.electronAPI?.log('warn', '[AutoDownload] Some updates failed', { failed: result.failed, errors: result.errors })
                  }
                } catch (err) {
                  window.electronAPI?.log('error', '[AutoDownload] Failed to update outdated files', { error: String(err) })
                }
              }
            }
          }
        }, 50) // Small delay to let React render first
      }
    } catch (err) {
      if (!silent) {
        setStatusMessage('Error loading files')
      }
      console.error(err)
    } finally {
      if (!silent) {
        setIsLoading(false)
        setTimeout(() => setStatusMessage(''), 3000)
      }
    }
  }, [vaultPath, organization, isOfflineMode, currentVaultId, setFiles, setIsLoading, setStatusMessage, setFilesLoaded])

  // Process staged check-ins when going back online
  const processStagedCheckins = useCallback(async () => {
    if (stagedCheckins.length === 0 || !organization || !user || !vaultPath) {
      return
    }
    
    console.log('[StagedCheckins] Processing', stagedCheckins.length, 'staged check-ins')
    
    // Get current files to find the staged ones
    const { files } = usePDMStore.getState()
    
    // Collect conflicts for dialog
    const conflicts: Array<{
      staged: StagedCheckin
      serverVersion: number
      localPath: string
    }> = []
    
    let successCount = 0
    
    for (const staged of stagedCheckins) {
      const file = files.find(f => f.relativePath === staged.relativePath)
      if (!file) {
        console.warn('[StagedCheckins] File not found:', staged.relativePath)
        unstageCheckin(staged.relativePath)
        continue
      }
      
      // Check for conflict: server version changed since we staged
      const serverVersionChanged = staged.serverVersion !== undefined && 
        file.pdmData?.version !== undefined && 
        file.pdmData.version > staged.serverVersion
      
      if (serverVersionChanged) {
        // Conflict detected - add to conflicts list for dialog
        console.log('[StagedCheckins] Conflict detected for:', staged.fileName, {
          stagedVersion: staged.serverVersion,
          currentVersion: file.pdmData?.version
        })
        conflicts.push({
          staged,
          serverVersion: file.pdmData?.version || 0,
          localPath: file.path
        })
        continue
      }
      
      try {
        // For new files, use sync (first check-in)
        // For existing files, use checkout + checkin
        if (!file.pdmData) {
          // New file - first check-in
          await executeCommand('sync', { files: [file] }, { silent: true })
        } else {
          // Existing file - checkout then checkin
          await executeCommand('checkout', { files: [file] }, { silent: true })
          await executeCommand('checkin', { files: [file], comment: staged.comment || 'Offline changes' }, { silent: true })
        }
        
        // Remove from staged
        unstageCheckin(staged.relativePath)
        successCount++
        console.log('[StagedCheckins] Successfully processed:', staged.fileName)
      } catch (err) {
        console.error('[StagedCheckins] Failed to process:', staged.fileName, err)
        addToast('error', `Failed to check in "${staged.fileName}": ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
    
    // Show success message for processed files
    if (successCount > 0) {
      addToast('success', `Successfully checked in ${successCount} staged file${successCount > 1 ? 's' : ''}`)
    }
    
    // Show conflict dialog if there are conflicts
    if (conflicts.length > 0) {
      setStagedConflicts(conflicts)
    }
    
    // Refresh files after processing
    loadFiles(true)
  }, [stagedCheckins, organization, user, vaultPath, addToast, unstageCheckin, loadFiles])
  
  // Handle staged check-ins when going back online
  useEffect(() => {
    const wasOffline = prevOfflineModeRef.current
    const isNowOnline = !isOfflineMode
    
    // Update ref for next render
    prevOfflineModeRef.current = isOfflineMode
    
    // Only process when transitioning from offline to online
    if (wasOffline && isNowOnline && stagedCheckins.length > 0) {
      console.log('[StagedCheckins] Going online with', stagedCheckins.length, 'staged check-ins')
      
      // Show notification about staged check-ins
      addToast(
        'info',
        `Processing ${stagedCheckins.length} staged file${stagedCheckins.length > 1 ? 's' : ''} for check-in...`,
        8000
      )
      
      // Process staged check-ins in the background
      processStagedCheckins()
    }
  }, [isOfflineMode, stagedCheckins.length, addToast, processStagedCheckins])

  // Auto-download trigger when settings are toggled ON
  // This effect runs the download logic immediately when the user enables auto-download
  const autoDownloadCloudFiles = usePDMStore(s => s.autoDownloadCloudFiles)
  const autoDownloadUpdates = usePDMStore(s => s.autoDownloadUpdates)
  const prevAutoDownloadCloudFiles = useRef(autoDownloadCloudFiles)
  const prevAutoDownloadUpdates = useRef(autoDownloadUpdates)
  
  useEffect(() => {
    const cloudFilesJustEnabled = autoDownloadCloudFiles && !prevAutoDownloadCloudFiles.current
    const updatesJustEnabled = autoDownloadUpdates && !prevAutoDownloadUpdates.current
    
    // Update refs for next comparison
    prevAutoDownloadCloudFiles.current = autoDownloadCloudFiles
    prevAutoDownloadUpdates.current = autoDownloadUpdates
    
    // Only proceed if a setting was just toggled ON
    if (!cloudFilesJustEnabled && !updatesJustEnabled) return
    
    // Need organization, vault, and not offline to download
    if (!organization || isOfflineMode || !currentVaultId) return
    
    const runAutoDownload = async () => {
      const { files, autoDownloadExcludedFiles, addToast, activeVaultId } = usePDMStore.getState()
      
      // Get exclusion list for current vault
      const excludedPaths = activeVaultId ? (autoDownloadExcludedFiles[activeVaultId] || []) : []
      const excludedPathsSet = new Set(excludedPaths)
      
      // Auto-download cloud-only files (if just enabled)
      if (cloudFilesJustEnabled) {
        const cloudOnlyFiles = files.filter(f => 
          !f.isDirectory && 
          f.diffStatus === 'cloud' && 
          f.pdmData?.content_hash &&
          !excludedPathsSet.has(f.relativePath)
        )
        
        if (cloudOnlyFiles.length > 0) {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - downloading cloud files', { count: cloudOnlyFiles.length })
          try {
            const result = await executeCommand('download', { files: cloudOnlyFiles })
            if (result.succeeded > 0) {
              addToast('success', `Auto-downloaded ${result.succeeded} cloud file${result.succeeded > 1 ? 's' : ''}`)
            }
            if (result.failed > 0) {
              window.electronAPI?.log('warn', '[AutoDownload] Some downloads failed', { failed: result.failed, errors: result.errors })
            }
          } catch (err) {
            window.electronAPI?.log('error', '[AutoDownload] Failed to download cloud files', { error: String(err) })
          }
        } else {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - no cloud files to download')
        }
      }
      
      // Auto-download updates for outdated files (if just enabled)
      if (updatesJustEnabled) {
        const outdatedFiles = files.filter(f => 
          !f.isDirectory && f.diffStatus === 'outdated' && f.pdmData?.content_hash
        )
        
        if (outdatedFiles.length > 0) {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - updating outdated files', { count: outdatedFiles.length })
          try {
            const result = await executeCommand('get-latest', { files: outdatedFiles })
            if (result.succeeded > 0) {
              addToast('success', `Auto-updated ${result.succeeded} file${result.succeeded > 1 ? 's' : ''}`)
            }
            if (result.failed > 0) {
              window.electronAPI?.log('warn', '[AutoDownload] Some updates failed', { failed: result.failed, errors: result.errors })
            }
          } catch (err) {
            window.electronAPI?.log('error', '[AutoDownload] Failed to update outdated files', { error: String(err) })
          }
        } else {
          window.electronAPI?.log('info', '[AutoDownload] Setting toggled ON - no outdated files to update')
        }
      }
    }
    
    runAutoDownload()
  }, [autoDownloadCloudFiles, autoDownloadUpdates, organization, isOfflineMode, currentVaultId])

  // CLI command listener - always active so CLI works even when terminal is hidden
  useEffect(() => {
    if (!window.electronAPI?.onCliCommand) return
    
    const unsubscribe = window.electronAPI.onCliCommand(async ({ requestId, command }) => {
      console.log('[App] Received CLI command:', command)
      
      try {
        const results = await executeTerminalCommand(command, loadFiles)
        
        // Handle clear command
        if (results.length === 1 && results[0].content === '__CLEAR__') {
          window.electronAPI?.sendCliResponse(requestId, { 
            outputs: [{ type: 'info', content: 'Cleared' }] 
          })
        } else {
          window.electronAPI?.sendCliResponse(requestId, { 
            outputs: results.map(r => ({ type: r.type, content: r.content }))
          })
        }
      } catch (err) {
        window.electronAPI?.sendCliResponse(requestId, { 
          outputs: [{ type: 'error', content: `Error: ${err instanceof Error ? err.message : String(err)}` }] 
        })
      }
    })
    
    return () => unsubscribe()
  }, [loadFiles])

  // Open working directory
  const handleOpenVault = useCallback(async () => {
    if (!window.electronAPI) return
    
    const result = await window.electronAPI.selectWorkingDir()
    if (result.success && result.path) {
      // Clear existing file state to avoid stale data
      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      
      setVaultPath(result.path)
      setVaultConnected(true)
      addRecentVault(result.path)
      setStatusMessage(`Opened: ${result.path}`)
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }, [setVaultPath, setVaultConnected, addRecentVault, setStatusMessage, setFiles, setServerFiles, setFilesLoaded])

  // Handle vault not found - browse for new path
  const handleVaultNotFoundBrowse = useCallback(async () => {
    if (!window.electronAPI || !vaultNotFoundPath) return
    
    const result = await window.electronAPI.selectWorkingDir()
    if (result.success && result.path) {
      // Find the vault that had the broken path and update it
      const brokenVault = connectedVaults.find(v => v.localPath === vaultNotFoundPath)
      if (brokenVault) {
        // Update the vault's local path
        const { updateConnectedVault } = usePDMStore.getState()
        updateConnectedVault(brokenVault.id, { localPath: result.path })
        addToast('success', `Vault "${brokenVault.name}" path updated to: ${result.path}`)
      }
      
      // Clear existing file state
      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      
      // Set the new path
      setVaultPath(result.path)
      setVaultConnected(true)
      setVaultNotFoundPath(null)
      setVaultNotFoundName(undefined)
    }
  }, [vaultNotFoundPath, connectedVaults, setVaultPath, setVaultConnected, setFiles, setServerFiles, setFilesLoaded, addToast])

  // Handle vault not found - open settings to vaults tab where vaults are managed
  const handleVaultNotFoundSettings = useCallback(() => {
    const { setActiveView } = usePDMStore.getState()
    setSettingsTab('vaults')
    setActiveView('settings')
    setVaultNotFoundPath(null)
    setVaultNotFoundName(undefined)
  }, [])

  // Open recent vault
  const handleOpenRecentVault = useCallback(async (path: string) => {
    if (!window.electronAPI) return
    
    const result = await window.electronAPI.setWorkingDir(path)
    if (result.success) {
      // Clear existing file state to avoid stale data
      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      
      setVaultPath(path)
      setVaultConnected(true)
      addRecentVault(path)
      
      // Find matching connected vault and activate it
      const normalizedPath = path.toLowerCase().replace(/\\/g, '/')
      const currentVaults = usePDMStore.getState().connectedVaults
      const matchingVault = currentVaults.find(v => 
        v.localPath.toLowerCase().replace(/\\/g, '/') === normalizedPath
      )
      if (matchingVault) {
        usePDMStore.getState().setActiveVault(matchingVault.id)
        // Ensure vault is expanded so files show
        if (!matchingVault.isExpanded) {
          usePDMStore.getState().toggleVaultExpanded(matchingVault.id)
        }
      }
      
      setStatusMessage(`Opened: ${path}`)
      setTimeout(() => setStatusMessage(''), 3000)
    } else {
      setStatusMessage(result.error || 'Failed to open folder')
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }, [setVaultPath, setVaultConnected, addRecentVault, setStatusMessage, setFiles, setServerFiles, setFilesLoaded])

  // Track what configuration we last loaded to avoid duplicate loads
  const lastLoadKey = useRef<string>('')
  const mountedRef = useRef(false)
  
  // Reset state on component mount (handles HMR and stale loading state)
  useEffect(() => {
    // Force fresh load on mount
    lastLoadKey.current = ''
    
    // Clear any stale loading state from previous HMR
    // Use the store directly to check state at mount time
    const state = usePDMStore.getState()
    if (state.isLoading || state.statusMessage === 'Loading organization...' || state.statusMessage === 'Loading files...') {
      setIsLoading(false)
      setStatusMessage('')
    }
    
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount
  
  // Reset lastLoadKey when vault is disconnected so reconnecting triggers a fresh load
  useEffect(() => {
    if (!isVaultConnected) {
      lastLoadKey.current = ''
    }
  }, [isVaultConnected])

  // Initialize working directory on startup
  // This runs BEFORE auth to ensure electron's workingDirectory is set when we have persisted vaults
  // This prevents files from showing as "cloud" on startup before auth completes
  useEffect(() => {
    const initWorkingDir = async () => {
      if (!window.electronAPI) return
      
      // Get the path from vaultPath (which is synced from activeVault in store merge)
      // If no vaultPath but we have connected vaults, use the first vault's path
      const pathToUse = vaultPath || connectedVaults[0]?.localPath
      if (!pathToUse) {
        console.log('[Init] No vault path available')
        return
      }
      
      console.log('[Init] Setting working directory:', pathToUse)
      const result = await window.electronAPI.setWorkingDir(pathToUse)
      
      if (result.success) {
        console.log('[Init] Working directory set successfully')
        // Clear any vault not found state
        setVaultNotFoundPath(null)
        setVaultNotFoundName(undefined)
        // Only set vault connected if we have auth (user) or offline mode
        // This ensures loadFiles waits for org data when online
        if (user || isOfflineMode) {
          setVaultConnected(true)
        }
        // Update vaultPath if we used connectedVaults fallback
        if (!vaultPath && connectedVaults[0]?.localPath) {
          setVaultPath(connectedVaults[0].localPath)
        }
      } else {
        console.error('[Init] Failed to set working directory:', result.error)
        // Only handle if user is authenticated (to avoid race on startup)
        if (user || isOfflineMode) {
          // Check if the error is because the path doesn't exist
          if (result.error?.includes('not exist') || result.error?.includes('Path does not exist')) {
            // Show the vault not found dialog
            const vaultName = connectedVaults.find(v => v.localPath === pathToUse)?.name
            setVaultNotFoundPath(pathToUse)
            setVaultNotFoundName(vaultName)
          }
          setVaultPath(null)
          setVaultConnected(false)
        }
      }
    }
    
    initWorkingDir()
  }, [user, isOfflineMode, vaultPath, connectedVaults, setVaultPath, setVaultConnected])

  // Load files when ready - wait for organization to be loaded when online
  // This prevents double-loading (once without org, once with org)
  useEffect(() => {
    if (!isVaultConnected || !vaultPath) return
    
    // When online, wait for organization to be loaded before first load
    // This prevents the "add diff spam" from loading without org data
    if (!isOfflineMode && user && !organization) {
      // Show loading state while waiting for org
      setIsLoading(true)
      setStatusMessage('Loading organization...')
      return // Wait for org to load
    }
    
    // Clear loading state once organization is ready (handles HMR race conditions)
    if (organization) {
      // Don't show "Loading organization..." anymore - org is loaded
      // The loadFiles call below will set proper loading state
    }
    
    // Create a key to track what we've loaded for
    // Include vaultPath so switching vaults triggers a new load
    // Include isOfflineMode so going online/offline triggers a fresh load
    const loadKey = `${vaultPath}:${currentVaultId || 'none'}:${organization?.id || 'none'}:${isOfflineMode ? 'offline' : 'online'}`
    
    console.log('[LoadEffect] loadKey:', loadKey, 'lastLoadKey:', lastLoadKey.current)
    
    // Skip if we've already loaded for this exact configuration
    if (lastLoadKey.current === loadKey) {
      // Clear stale loading state if we're skipping (handles HMR)
      console.log('[LoadEffect] Skipping - same loadKey')
      setIsLoading(false)
      if (statusMessage === 'Loading organization...' || statusMessage === 'Loading files...') {
        setStatusMessage('')
      }
      return
    }
    
    console.log('[LoadEffect] Triggering loadFiles for new loadKey')
    lastLoadKey.current = loadKey
    loadFiles()
  }, [isVaultConnected, vaultPath, isOfflineMode, user, organization, currentVaultId, loadFiles, setIsLoading, setStatusMessage, statusMessage])

  // Handle sidebar, details panel, and right panel resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = e.clientX - 48
        setSidebarWidth(newWidth)
      }
      if (isResizingDetails) {
        // Calculate height from bottom of window
        const windowHeight = window.innerHeight
        const statusBarHeight = 24 // Approximate status bar height
        const newHeight = windowHeight - e.clientY - statusBarHeight
        // Allow up to 80% of window height
        setDetailsPanelHeight(Math.max(100, Math.min(windowHeight * 0.8, newHeight)))
      }
      if (isResizingRightPanel) {
        // Calculate width from right edge
        const windowWidth = window.innerWidth
        const newWidth = windowWidth - e.clientX
        // Allow up to 70% of window width
        setRightPanelWidth(Math.max(200, Math.min(windowWidth * 0.7, newWidth)))
      }
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
      setIsResizingDetails(false)
      setIsResizingRightPanel(false)
    }

    if (isResizingSidebar || isResizingDetails || isResizingRightPanel) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = (isResizingSidebar || isResizingRightPanel) ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingSidebar, isResizingDetails, isResizingRightPanel, setSidebarWidth, setDetailsPanelHeight, setRightPanelWidth])

  // Menu event handlers
  useEffect(() => {
    if (!window.electronAPI) return

    const cleanup = window.electronAPI.onMenuEvent((event) => {
      switch (event) {
        case 'menu:set-working-dir':
          handleOpenVault()
          break
        case 'menu:toggle-sidebar':
          toggleSidebar()
          break
        case 'menu:toggle-details':
          toggleDetailsPanel()
          break
        case 'menu:refresh':
          loadFiles()
          break
      }
    })

    return cleanup
  }, [handleOpenVault, toggleSidebar, toggleDetailsPanel, loadFiles])

  // File change watcher - auto-refresh when files change externally
  // Completely disabled during sync operations for smooth performance
  useEffect(() => {
    if (!window.electronAPI || !vaultPath) return
    
    let refreshTimeout: NodeJS.Timeout | null = null
    
    const cleanup = window.electronAPI.onFilesChanged((changedFiles) => {
      // Completely skip ALL updates during sync operations or delete operations
      const { syncProgress, processingFolders } = usePDMStore.getState()
      if (syncProgress.isActive || processingFolders.size > 0) {
        return // Silent skip - no logging, no processing
      }
      
      console.log('[FileWatcher] Files changed:', changedFiles.length, 'files')
      
      // Debounce - wait for changes to settle
      if (refreshTimeout) {
        clearTimeout(refreshTimeout)
      }
      
      refreshTimeout = setTimeout(() => {
        // Check again before refreshing in case a delete started during debounce
        const currentState = usePDMStore.getState()
        if (currentState.syncProgress.isActive || currentState.processingFolders.size > 0) {
          return
        }
        loadFiles(true) // Silent refresh
        refreshTimeout = null
      }, 1000) // Wait 1 second after last change
    })
    
    return cleanup
  }, [vaultPath, loadFiles])

  // Realtime subscription - instant updates from other users
  // This provides incremental updates without requiring full vault refreshes
  useEffect(() => {
    if (!organization || isOfflineMode) return
    
    console.log('[Realtime] Setting up subscriptions for org:', organization.id)
    
    const { addCloudFile, updateFilePdmData, removeCloudFile, addToast } = usePDMStore.getState()
    
    // Batch notifications to avoid toast spam when someone does bulk operations
    // Collects notifications over 500ms then shows a single summary toast
    type NotificationType = 'checkout' | 'checkin' | 'version' | 'state' | 'add'
    interface PendingNotification {
      type: NotificationType
      userId: string
      userName: string | null  // null means we need to fetch it
      fileNames: string[]
      version?: number
      state?: string
    }
    
    const pendingNotifications: Map<string, PendingNotification> = new Map()
    let flushTimeout: NodeJS.Timeout | null = null
    const userNameCache: Map<string, string> = new Map()
    
    const flushNotifications = () => {
      flushTimeout = null
      
      for (const notification of pendingNotifications.values()) {
        const count = notification.fileNames.length
        const userName = notification.userName || 'Another user'
        
        let message: string
        if (count === 1) {
          // Single file - show file name
          const fileName = notification.fileNames[0]
          switch (notification.type) {
            case 'checkout':
              message = `${userName} checked out ${fileName}`
              break
            case 'checkin':
              message = `${userName} checked in ${fileName} (v${notification.version})`
              break
            case 'version':
              message = `${userName} updated ${fileName} to v${notification.version}`
              break
            case 'state':
              message = `${fileName} → ${notification.state}`
              break
            case 'add':
              message = `${userName} added ${fileName}`
              break
          }
        } else {
          // Multiple files - show count
          switch (notification.type) {
            case 'checkout':
              message = `${userName} checked out ${count} files`
              break
            case 'checkin':
              message = `${userName} checked in ${count} files`
              break
            case 'version':
              message = `${userName} updated ${count} files`
              break
            case 'state':
              message = `${count} files → ${notification.state}`
              break
            case 'add':
              message = `${userName} added ${count} files`
              break
          }
        }
        
        addToast('info', message)
      }
      
      pendingNotifications.clear()
    }
    
    const queueNotification = (type: NotificationType, userId: string, fileName: string, extra?: { version?: number; state?: string }) => {
      const key = `${type}:${userId}:${extra?.state || ''}`  // Group by type, user, and state (for state changes)
      
      const existing = pendingNotifications.get(key)
      if (existing) {
        existing.fileNames.push(fileName)
        if (extra?.version) existing.version = extra.version
      } else {
        // Check cache for user name
        const cachedName = userNameCache.get(userId)
        pendingNotifications.set(key, {
          type,
          userId,
          userName: cachedName || null,
          fileNames: [fileName],
          ...extra
        })
        
        // Fetch user name if not cached
        if (!cachedName) {
          import('./lib/supabase').then(({ getUserBasicInfo }) => {
            getUserBasicInfo(userId).then(({ user }) => {
              const displayName = user?.full_name || user?.email?.split('@')[0] || 'Another user'
              userNameCache.set(userId, displayName)
              
              // Update pending notification if it still exists
              const notification = pendingNotifications.get(key)
              if (notification) {
                notification.userName = displayName
              }
            })
          })
        }
      }
      
      // Start/reset the flush timer
      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      flushTimeout = setTimeout(flushNotifications, 500)
    }
    
    // Subscribe to file changes
    const unsubscribeFiles = subscribeToFiles(organization.id, (eventType, newFile, oldFile) => {
      // Skip updates caused by current user (we handle those locally)
      const currentUserId = usePDMStore.getState().user?.id
      
      switch (eventType) {
        case 'INSERT':
          // New file added by someone else
          if (newFile && newFile.created_by !== currentUserId) {
            console.log('[Realtime] New file from another user:', newFile.file_name)
            addCloudFile(newFile)
            // Queue batched notification for new files
            queueNotification('add', newFile.created_by, newFile.file_name)
          }
          break
          
        case 'UPDATE':
          // File updated - could be checkout, version change, state change, etc.
          if (newFile) {
            console.log('[Realtime] File updated:', newFile.file_name, 'by:', newFile.updated_by === currentUserId ? 'me' : 'other')
            
            // Only process updates from OTHER users via realtime
            // Updates from current user are handled by the command handlers directly
            // This prevents race conditions where realtime might interfere with local store updates
            if (newFile.updated_by !== currentUserId) {
              // Check if file is newly checked out by someone else
              // Realtime updates don't include the joined checked_out_user info,
              // so we need to fetch it separately
              const isNewlyCheckedOut = newFile.checked_out_by && 
                (!oldFile?.checked_out_by || oldFile.checked_out_by !== newFile.checked_out_by)
              
              if (isNewlyCheckedOut && newFile.checked_out_by !== currentUserId) {
                // Fetch user info for the person who checked out the file
                import('./lib/supabase').then(({ getUserBasicInfo }) => {
                  getUserBasicInfo(newFile.checked_out_by!).then(({ user }) => {
                    if (user) {
                      // Update with user info
                      updateFilePdmData(newFile.id, {
                        ...newFile,
                        checked_out_user: user
                      } as any)
                    } else {
                      // Still update even without user info
                      updateFilePdmData(newFile.id, newFile)
                    }
                  })
                })
              } else {
                // No new checkout, just update normally
                updateFilePdmData(newFile.id, newFile)
              }
            }
            
            // Check for force check-in from different machine (your file was released)
            // This happens when: you had file checked out on this machine, but it was checked in from elsewhere
            if (oldFile?.checked_out_by === currentUserId && !newFile.checked_out_by) {
              // The file that was checked out by current user is now not checked out
              // Check if it was force-checked-in from a different machine
              const oldMachineId = oldFile?.checked_out_by_machine_id
              
              // Get current machine ID to compare
              import('@/lib/backup').then(async ({ getMachineId }) => {
                const currentMachineId = await getMachineId()
                
                // Only trigger orphaned checkout if:
                // 1. File was checked out on THIS machine (oldMachineId === currentMachineId)
                //    AND someone ELSE did the check-in (force release scenario)
                // 2. OR file was checked out on ANOTHER machine (oldMachineId !== currentMachineId)
                //    AND current user checked it in from here (user's other machine has orphaned changes)
                
                const wasCheckedOutOnThisMachine = oldMachineId && oldMachineId === currentMachineId
                const currentUserDidTheCheckin = newFile.updated_by === currentUserId
                
                // If user checked in their own file from the same machine, it's NOT an orphan
                // That's just a normal check-in
                if (wasCheckedOutOnThisMachine && currentUserDidTheCheckin) {
                  // Normal check-in by user on the same machine - no orphan
                  return
                }
                
                // If file was checked out on this machine but released by someone else
                // OR if user checked in from a different machine (their other machine has orphaned local copy)
                if (wasCheckedOutOnThisMachine || (oldMachineId && !currentUserDidTheCheckin)) {
                  console.log('[Realtime] Force check-in detected! File:', newFile.file_name, 'Your local changes may need attention.')
                  
                  // Get the machine name that did the force check-in
                  const checkedInByMachine = newFile.checked_out_by_machine_name || 'another computer'
                  
                  // Get current vault path for building local path
                  const { vaultPath, addOrphanedCheckout } = usePDMStore.getState()
                  
                  // Add to orphaned checkouts list - this will trigger the dialog
                  addOrphanedCheckout({
                    fileId: newFile.id,
                    fileName: newFile.file_name,
                    filePath: newFile.file_path,
                    localPath: vaultPath ? buildFullPath(vaultPath, newFile.file_path) : newFile.file_path,
                    checkedInBy: checkedInByMachine,
                    checkedInAt: newFile.updated_at,
                    newVersion: newFile.version,
                    serverHash: newFile.content_hash || undefined
                  })
                }
              }).catch(() => {
                // Couldn't get machine ID, just show normal notification
              })
            }
            
            // Queue batched notifications for important changes from other users
            if (newFile.updated_by && newFile.updated_by !== currentUserId) {
              // Check for checkout changes
              if (oldFile?.checked_out_by !== newFile.checked_out_by) {
                if (newFile.checked_out_by) {
                  queueNotification('checkout', newFile.updated_by, newFile.file_name)
                } else {
                  queueNotification('checkin', newFile.updated_by, newFile.file_name, { version: newFile.version })
                }
              }
              // Check for new version
              else if (oldFile?.version !== newFile.version) {
                queueNotification('version', newFile.updated_by, newFile.file_name, { version: newFile.version })
              }
              // Check for state change
              else if (oldFile?.workflow_state?.name !== newFile.workflow_state?.name) {
                queueNotification('state', newFile.updated_by, newFile.file_name, { state: newFile.workflow_state?.name })
              }
            }
          }
          break
          
        case 'DELETE':
          // File deleted from server
          // Note: Supabase realtime DELETE events only include primary key by default,
          // so oldFile may not have all fields (file_name, deleted_by, etc.)
          if (oldFile?.id) {
            console.log('[Realtime] File deleted:', oldFile.file_name || oldFile.id)
            removeCloudFile(oldFile.id)
            // Only show toast if we have a valid file name AND it wasn't deleted by current user
            // Skip toast entirely for DELETE events - they spam when bulk deleting and often lack file_name
            // Users can see deleted files in the file browser (red diff status)
          }
          break
      }
    })
    
    // Subscribe to activity feed for additional notifications
    const unsubscribeActivity = subscribeToActivity(organization.id, (activity) => {
      // Activity notifications are handled by the file subscription above
      // This could be used for additional features like showing activity in a panel
      console.log('[Realtime] Activity:', activity.action, activity.details)
    })
    
    // Subscribe to organization settings changes (integration settings, etc.)
    const unsubscribeOrg = subscribeToOrganization(organization.id, (_eventType, newOrg, oldOrg) => {
      // Check what changed in the settings JSONB
      const newSettings = (newOrg?.settings || {}) as unknown as Record<string, unknown>
      const oldSettings = (oldOrg?.settings || {}) as unknown as Record<string, unknown>
      
      // All keys in the settings JSONB that admins can modify
      const settingsKeys = [
        'solidworks_dm_license_key',
        'api_url',
        'slack_enabled',
        'slack_webhook_url',
        'odoo_url',
        'odoo_api_key',
        'require_checkout',
        'auto_increment_part_numbers',
        'part_number_prefix',
        'part_number_digits',
        'allowed_extensions',
        'require_description',
        'require_approval_for_release',
        'max_file_size_mb',
        'enforce_email_domain',
        'column_defaults'
      ]
      
      const changedSettingsKeys = settingsKeys.filter(
        key => JSON.stringify(newSettings[key]) !== JSON.stringify(oldSettings[key])
      )
      
      // All admin-modifiable fields directly on the organization table
      const orgAdminFields = [
        // Google Drive integration
        'google_drive_enabled',
        'google_drive_client_id',
        'google_drive_client_secret',
        // Company profile
        'logo_url',
        'logo_storage_path',
        'phone',
        'website',
        'contact_email',
        // Address fields
        'address_line1',
        'address_line2',
        'city',
        'state',
        'postal_code',
        'country',
        // Domain settings
        'email_domains',
        'revision_scheme',
        'name',
        'slug'
      ] as const
      
      const changedOrgFields = orgAdminFields.filter(
        key => JSON.stringify((newOrg as any)?.[key]) !== JSON.stringify((oldOrg as any)?.[key])
      )
      
      // Check JSONB columns for admin settings
      const jsonbAdminFields = [
        'rfq_settings',
        'serialization_settings',
        'module_defaults'
      ] as const
      
      const changedJsonbFields = jsonbAdminFields.filter(
        key => JSON.stringify((newOrg as any)?.[key]) !== JSON.stringify((oldOrg as any)?.[key])
      )
      
      const allChangedFields = [...changedSettingsKeys, ...changedOrgFields, ...changedJsonbFields]
      
      // Log api_url changes specifically for debugging sync issues
      if (changedSettingsKeys.includes('api_url')) {
        console.log('[Realtime] API URL changed from', oldSettings.api_url || '(empty)', 'to', newSettings.api_url || '(empty)')
      }
      
      // Update the organization in the store
      // This triggers the sync useEffect in App.tsx to update apiServerUrl
      // Also triggers re-render in all components that use organization from store
      setOrganization(newOrg)
      
      // Show toast if any admin settings changed
      if (allChangedFields.length > 0) {
        console.log('[Realtime] Organization settings updated:', allChangedFields)
        addToast('info', 'Organization settings updated by an admin')
      }
    })
    
    // Subscribe to org color swatch changes (shared palette)
    const unsubscribeColorSwatches = subscribeToColorSwatches(organization.id, (eventType, swatch) => {
      const { orgColorSwatches } = usePDMStore.getState()
      
      // Only process org swatches (swatch.org_id is set)
      if (!swatch.org_id) return
      
      if (eventType === 'INSERT') {
        // Add new org swatch if not already present
        if (!orgColorSwatches.find(s => s.id === swatch.id)) {
          usePDMStore.setState({
            orgColorSwatches: [...orgColorSwatches, {
              id: swatch.id,
              color: swatch.color,
              isOrg: true,
              createdAt: swatch.created_at
            }]
          })
          console.log('[Realtime] Org color swatch added:', swatch.color)
        }
      } else if (eventType === 'DELETE') {
        // Remove deleted org swatch
        usePDMStore.setState({
          orgColorSwatches: orgColorSwatches.filter(s => s.id !== swatch.id)
        })
        console.log('[Realtime] Org color swatch removed:', swatch.color)
      }
    })
    
    // Subscribe to permission changes (vault access, team membership, etc.)
    // This ensures users see access changes immediately when an admin modifies them
    const currentUserId = usePDMStore.getState().user?.id
    const unsubscribePermissions = currentUserId ? subscribeToPermissions(
      currentUserId,
      organization.id,
      async (changeType, eventType) => {
        console.log('[Realtime] Permission change:', changeType, eventType)
        
        // Reload user permissions from the store
        const { loadUserPermissions } = usePDMStore.getState()
        await loadUserPermissions()
        
        // Show toast to inform user their access changed
        const messages: Record<string, string> = {
          'vault_access': 'Your vault access has been updated',
          'team_vault_access': 'Team vault access has been updated',
          'team_members': 'Your team membership has been updated',
          'user_permissions': 'Your permissions have been updated'
        }
        addToast('info', messages[changeType] || 'Your access has been updated')
        
        // Trigger a refresh of the vault list in WelcomeScreen by updating a timestamp
        // Components watching this will know to reload
        usePDMStore.setState({ permissionsLastUpdated: Date.now() })
      }
    ) : () => {}
    
    return () => {
      console.log('[Realtime] Cleaning up subscriptions')
      // Clear any pending notification timeout
      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      unsubscribeFiles()
      unsubscribeActivity()
      unsubscribeOrg()
      unsubscribeColorSwatches()
      unsubscribePermissions()
      unsubscribeAll()
    }
  }, [organization, isOfflineMode, setOrganization, addToast])

  // Start backup heartbeat and scheduler when user and org are available
  // Backup services removed - all backup operations are now handled directly via restic
  // when the user clicks "Backup Now" or "Restore" in the BackupPanel

  // Register device session and start heartbeat when user is logged in
  useEffect(() => {
    if (!user) {
      stopSessionHeartbeat()
      return
    }
    
    // Register this device's session
    // Use user.org_id first, fall back to organization.id if not set
    const orgIdForSession = user.org_id || organization?.id || null
    console.log('[Session] Registering session with org_id:', orgIdForSession?.substring(0, 8) || 'NULL', 
      '(user.org_id:', user.org_id?.substring(0, 8) || 'NULL', 
      ', organization?.id:', organization?.id?.substring(0, 8) || 'NULL', ')')
    
    registerDeviceSession(user.id, orgIdForSession)
      .then(result => {
        if (result.success) {
          console.log('[Session] Device session registered successfully with org_id:', orgIdForSession?.substring(0, 8) || 'NULL')
          // Start heartbeat to keep session alive
          // Pass callbacks: one for remote sign out, one to get current org_id
          startSessionHeartbeat(
            user.id, 
            async () => {
              console.log('[Session] Remote sign out triggered')
              const { addToast: toast, setUser: clearUser, setOrganization: clearOrg } = usePDMStore.getState()
              toast('info', 'You were signed out from another device')
              await signOut()
              clearUser(null)
              clearOrg(null)
            },
            // Get current org_id from store (handles org changes during session)
            // Fall back to organization.id if user.org_id is not set
            () => usePDMStore.getState().user?.org_id || usePDMStore.getState().organization?.id
          )
        } else {
          console.error('[Session] Failed to register session:', result.error)
        }
      })
      .catch(err => {
        console.error('[Session] Error registering session:', err)
      })
    
    return () => {
      stopSessionHeartbeat()
    }
  }, [user?.id, user?.org_id, organization?.id])

  // Backup machine heartbeat - keeps designated_machine_last_seen updated
  // This runs at App level so it doesn't require BackupPanel to be open
  useEffect(() => {
    if (!organization?.id) return
    
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null
    let isDesignated = false
    
    const checkAndStartHeartbeat = async () => {
      try {
        // Get backup config to check if this is the designated machine
        const status = await getBackupStatus(organization.id)
        if (!status.config?.designated_machine_id) return
        
        isDesignated = await isThisDesignatedMachine(status.config)
        if (!isDesignated) return
        
        console.log('[Backup] This is the designated machine, starting heartbeat')
        
        // Send immediate heartbeat
        await updateHeartbeat(organization.id)
        
        // Send heartbeat every minute
        heartbeatInterval = setInterval(() => {
          updateHeartbeat(organization.id)
        }, 60 * 1000)
      } catch (err) {
        console.error('[Backup] Failed to start heartbeat:', err)
      }
    }
    
    checkAndStartHeartbeat()
    
    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
      }
    }
  }, [organization?.id])

  // Auto-start SolidWorks service if enabled and SolidWorks is installed
  useEffect(() => {
    const { autoStartSolidworksService: autoStart, solidworksIntegrationEnabled } = usePDMStore.getState()
    const dmLicenseKey = organization?.settings?.solidworks_dm_license_key
    
    window.electronAPI?.log?.('info', '[SolidWorks] Auto-start effect triggered')
    window.electronAPI?.log?.('info', `[SolidWorks] integrationEnabled: ${solidworksIntegrationEnabled}`)
    window.electronAPI?.log?.('info', `[SolidWorks] autoStart setting: ${autoStart}`)
    window.electronAPI?.log?.('info', `[SolidWorks] organization loaded: ${!!organization}`)
    window.electronAPI?.log?.('info', `[SolidWorks] dmLicenseKey from org settings: ${dmLicenseKey ? `PRESENT (${dmLicenseKey.length} chars)` : 'NOT PRESENT'}`)
    
    // Skip auto-start if integration is disabled
    if (!solidworksIntegrationEnabled) {
      window.electronAPI?.log?.('info', '[SolidWorks] Integration disabled, skipping auto-start')
      return
    }
    
    if (autoStart && window.electronAPI?.solidworks) {
      // First check if SolidWorks is installed on this machine
      window.electronAPI.solidworks.getServiceStatus().then(result => {
        // Only proceed if SolidWorks is installed
        if (!result?.data?.installed) {
          // SolidWorks not installed - silently skip auto-start
          return
        }
        
        const data = result?.data as any
        
        // SolidWorks is installed, check if service is already running
        if (result?.success && !data?.running) {
          // Service not running - start it with license key
          console.log('[SolidWorks] Auto-starting service...')
          console.log('[SolidWorks] DM License key available:', !!dmLicenseKey)
          window.electronAPI?.solidworks?.startService(dmLicenseKey || undefined).then(startResult => {
            if (startResult?.success) {
              const modeMsg = (startResult.data as any)?.fastModeEnabled 
                ? ' (fast mode)' 
                : ''
              console.log(`[SolidWorks] Service auto-started${modeMsg}`)
            } else {
              console.warn('[SolidWorks] Auto-start failed:', startResult?.error)
            }
          }).catch(err => {
            console.warn('[SolidWorks] Auto-start error:', err)
          })
        } else if (result?.success && data?.running && dmLicenseKey && !data?.documentManagerAvailable) {
          // Service is running but DM API not available - send license key
          console.log('[SolidWorks] Service running but DM API not available, sending license key...')
          window.electronAPI?.solidworks?.startService(dmLicenseKey).then(setKeyResult => {
            if (setKeyResult?.success) {
              console.log('[SolidWorks] License key sent to running service')
            } else {
              console.warn('[SolidWorks] Failed to set license key:', setKeyResult?.error)
            }
          }).catch(err => {
            console.warn('[SolidWorks] Error sending license key:', err)
          })
        }
      }).catch(() => {
        // Service check failed, don't try to start
      })
    }
  }, [organization]) // Re-check when organization loads (for DM license key)

  // Auto-updater event listeners
  useEffect(() => {
    if (!window.electronAPI) return
    
    const { 
      setShowUpdateModal, 
      setUpdateAvailable, 
      setUpdateDownloading, 
      setUpdateDownloaded, 
      setUpdateProgress,
      addToast 
    } = usePDMStore.getState()
    
    const cleanups: (() => void)[] = []
    
    // Update available - show modal (always update to latest version)
    cleanups.push(
      window.electronAPI.onUpdateAvailable((info) => {
        console.log('[Update] Update available:', info.version)
        // Reset download state when switching to a new update version
        setUpdateDownloading(false)
        setUpdateDownloaded(false)
        setUpdateProgress(null)
        setUpdateAvailable(info)
        setShowUpdateModal(true)
      })
    )
    
    // Update not available
    cleanups.push(
      window.electronAPI.onUpdateNotAvailable(() => {
        console.log('[Update] No update available')
        setUpdateAvailable(null)
      })
    )
    
    // Download progress
    cleanups.push(
      window.electronAPI.onUpdateDownloadProgress((progress) => {
        setUpdateProgress(progress)
      })
    )
    
    // Download completed - auto-install
    cleanups.push(
      window.electronAPI.onUpdateDownloaded(async (info) => {
        console.log('[Update] Update downloaded:', info.version)
        setUpdateDownloading(false)
        setUpdateDownloaded(true)
        setUpdateProgress(null)
        // Auto-install after download completes
        try {
          await window.electronAPI.installUpdate()
        } catch (err) {
          console.error('[Update] Auto-install error:', err)
        }
      })
    )
    
    // Error
    cleanups.push(
      window.electronAPI.onUpdateError((error) => {
        console.error('[Update] Error:', error.message)
        setUpdateDownloading(false)
        setUpdateProgress(null)
        setShowUpdateModal(false)
        addToast('error', `Update error: ${error.message}`)
        // Request focus restoration after modal closes (fixes macOS UI freeze issue)
        window.electronAPI?.requestFocus?.()
      })
    )
    
    // Check if an update was already detected before listeners were set up
    // This handles the race condition where the update check completes before
    // the React app mounts and registers its event listeners
    window.electronAPI.getUpdateStatus().then((status) => {
      if (status.updateAvailable) {
        console.log('[Update] Found pending update on mount:', status.updateAvailable.version)
        setUpdateAvailable(status.updateAvailable)
        setShowUpdateModal(true)
      }
      if (status.updateDownloaded) {
        setUpdateDownloaded(true)
      }
    }).catch((err) => {
      console.error('[Update] Failed to get initial status:', err)
    })
    
    return () => {
      cleanups.forEach(cleanup => cleanup())
    }
  }, [])

  // Get setActiveView for terminal shortcut
  const { setActiveView } = usePDMStore()
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'o':
            if (e.shiftKey) {
              e.preventDefault()
              logKeyboard('Ctrl+Shift+O', 'Open vault')
              handleOpenVault()
            }
            break
          case 'b':
            e.preventDefault()
            logKeyboard('Ctrl+B', 'Toggle sidebar')
            toggleSidebar()
            break
          case 'd':
            e.preventDefault()
            logKeyboard('Ctrl+D', 'Toggle details panel')
            toggleDetailsPanel()
            break
          case '`':  // Ctrl+` or Cmd+` to switch to terminal view
            e.preventDefault()
            logKeyboard('Ctrl+`', 'Switch to terminal')
            setActiveView('terminal')
            break
          case 'k':  // Ctrl+K or Cmd+K to focus search
            e.preventDefault()
            logKeyboard('Ctrl+K', 'Focus search')
            // Dispatch custom event for search component to listen
            window.dispatchEvent(new CustomEvent('focus-search'))
            break
        }
      }
      
      if (e.key === 'F5') {
        e.preventDefault()
        logKeyboard('F5', 'Refresh files')
        loadFiles()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenVault, toggleSidebar, toggleDetailsPanel, loadFiles, setActiveView])

  // Determine if we should show the welcome screen
  const showWelcome = (!user && !isOfflineMode) || !hasVaultConnected
  
  // Only show minimal menu bar on the sign-in screen (not authenticated)
  const isSignInScreen = !user && !isOfflineMode
  
  // Show onboarding screen on first app boot (before Supabase setup)
  if (!onboardingComplete) {
    return <OnboardingScreen />
  }
  
  // Show setup screen if Supabase is not configured
  if (!supabaseReady) {
    return (
      <div className="h-screen flex flex-col bg-plm-bg overflow-hidden">
        <SetupScreen onConfigured={handleSupabaseConfigured} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden relative">
      {/* 🎄 Christmas Effects - snow, sleigh, stars when theme is active */}
      <ChristmasEffects />
      
      {/* 🎃 Halloween Effects - bats, ghosts, pumpkins when theme is active */}
      <HalloweenEffects />
      
      {/* 🌤️ Weather Effects - dynamic theme based on local weather */}
      <WeatherEffects />
      
      <MenuBar
        onOpenVault={handleOpenVault}
        onRefresh={loadFiles}
        minimal={isSignInScreen}
      />
      
      {/* Role impersonation banner (dev tools) */}
      <ImpersonationBanner />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!showWelcome && <ActivityBar />}

        {sidebarVisible && !showWelcome && activeView !== 'workflows' && (
          <>
            <Sidebar 
              onOpenVault={handleOpenVault}
              onOpenRecentVault={handleOpenRecentVault}
              onRefresh={loadFiles}
              settingsTab={settingsTab}
              onSettingsTabChange={setSettingsTab}
            />
            {/* Resize handle for non-settings views, simple border for settings */}
            {activeView === 'settings' ? (
              <div className="w-px bg-plm-border flex-shrink-0" />
            ) : (
              <div
                className="w-1.5 bg-plm-border hover:bg-plm-accent cursor-col-resize transition-colors flex-shrink-0 relative group"
                onMouseDown={() => setIsResizingSidebar(true)}
              >
                {/* Wider invisible hit area for easier grabbing */}
                <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
              </div>
            )}
          </>
        )}

        {/* Main Content */}
        <div className={`flex-1 flex flex-col overflow-hidden min-w-0 ${isResizingSidebar || isResizingRightPanel ? 'pointer-events-none' : ''}`}>
          {/* Tab bar (browser-like tabs) - only shown when tabs are enabled and in file explorer view */}
          {!showWelcome && activeView === 'explorer' && <TabBar />}
          
          {showWelcome ? (
            <WelcomeScreen 
              onOpenRecentVault={handleOpenRecentVault}
              onChangeOrg={handleChangeOrg}
            />
          ) : activeView === 'settings' ? (
            /* Settings View - replaces entire main content area */
            <SettingsContent activeTab={settingsTab} />
          ) : activeView === 'google-drive' ? (
            /* Google Drive View - replaces entire main content area */
            <GoogleDrivePanel />
          ) : activeView === 'workflows' ? (
            /* Workflows View - replaces entire main content area (full screen) */
            <WorkflowsView />
          ) : (
            <>
              {/* File Browser */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
                <FileBrowser onRefresh={loadFiles} />
          </div>

              {/* Details Panel */}
              {detailsPanelVisible && (
                <>
                  <div
                    className="h-1.5 bg-plm-border hover:bg-plm-accent cursor-row-resize transition-colors flex-shrink-0 relative z-10"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setIsResizingDetails(true)
                    }}
                  >
                    {/* Taller invisible hit area for easier grabbing - prevents file drag from taking over */}
                    <div className="absolute inset-x-0 -top-2 -bottom-2 cursor-row-resize" />
                  </div>
          <DetailsPanel />
                </>
              )}
            </>
          )}
        </div>

        {/* Right Panel */}
        {rightPanelVisible && rightPanelTabs.length > 0 && !showWelcome && activeView !== 'workflows' && (
          <>
            <div
              className="w-1.5 bg-plm-border hover:bg-plm-accent cursor-col-resize transition-colors flex-shrink-0 relative"
              onMouseDown={() => setIsResizingRightPanel(true)}
            >
              {/* Wider invisible hit area for easier grabbing */}
              <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
            </div>
            <div className={isResizingSidebar || isResizingRightPanel ? 'pointer-events-none' : ''}>
              <RightPanel />
            </div>
          </>
        )}
      </div>

      <Toast />
      
      {/* Update Modal */}
      <UpdateModal />
      
      {/* Orphaned Checkouts Dialog */}
      <OrphanedCheckoutsContainer onRefresh={loadFiles} />
      
      {/* Staged Check-in Conflict Dialog */}
      {stagedConflicts.length > 0 && (
        <StagedCheckinConflictDialog
          conflicts={stagedConflicts}
          onClose={() => setStagedConflicts([])}
          onRefresh={loadFiles}
        />
      )}
      
      {/* Missing Storage Files Dialog */}
      <MissingStorageFilesContainer onRefresh={loadFiles} />
      
      {/* Vault Not Found Dialog */}
      {vaultNotFoundPath && (
        <VaultNotFoundDialog
          vaultPath={vaultNotFoundPath}
          vaultName={vaultNotFoundName}
          onClose={() => {
            setVaultNotFoundPath(null)
            setVaultNotFoundName(undefined)
          }}
          onOpenSettings={handleVaultNotFoundSettings}
          onBrowseNewPath={handleVaultNotFoundBrowse}
        />
      )}
    </div>
  )
}

export default App
