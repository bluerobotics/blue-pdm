import { useEffect, useState, useCallback, useRef } from 'react'
import { usePDMStore } from './stores/pdmStore'
import { SettingsContent } from './components/SettingsContent'

type SettingsTab = 'account' | 'vault' | 'organization' | 'branding' | 'metadata-columns' | 'backup' | 'solidworks' | 'integrations' | 'api' | 'preferences' | 'logs' | 'about'
import { supabase, getCurrentSession, isSupabaseConfigured, getFilesLightweight, getCheckedOutUsers, linkUserToOrganization, getUserProfile, setCurrentAccessToken } from './lib/supabase'
import { subscribeToFiles, subscribeToActivity, unsubscribeAll } from './lib/realtime'
// Backup services removed - now handled directly via restic
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
import { executeTerminalCommand } from './lib/commands/parser'

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
}

// Apply theme to document and update titlebar overlay
function useTheme() {
  const theme = usePDMStore(s => s.theme)
  
  useEffect(() => {
    // Determine the actual theme to apply
    let effectiveTheme: string = theme
    
    if (theme === 'system') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    }
    
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    
    // Update titlebar overlay colors (Windows only)
    const overlayColors = titleBarOverlayColors[effectiveTheme] || titleBarOverlayColors['dark']
    window.electronAPI?.setTitleBarOverlay?.(overlayColors)
    
    // Listen for system preference changes when using system theme
    if (theme === 'system') {
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
  }, [theme])
}

function App() {
  // Apply theme
  useTheme()
  
  const {
    user,
    organization,
    isOfflineMode,
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
  } = usePDMStore()
  
  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  // Consider vault connected if either legacy or new multi-vault system is connected
  const hasVaultConnected = isVaultConnected || connectedVaults.length > 0

  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingDetails, setIsResizingDetails] = useState(false)
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account')
  
  // Track if Supabase is configured (can change at runtime)
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConfigured())
  
  // Get onboarding state
  const onboardingComplete = usePDMStore(s => s.onboardingComplete)
  
  // Handle Supabase being configured (from SetupScreen)
  const handleSupabaseConfigured = useCallback(() => {
    setSupabaseReady(true)
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
          // Fetch user profile from database to get role
          const { profile, error: profileError } = await getUserProfile(session.user.id)
          if (profileError) {
            console.log('[Auth] Error fetching profile:', profileError)
          }
          const userProfile = profile as { full_name?: string; avatar_url?: string; org_id?: string; role?: string; last_sign_in?: string } | null
          
          // Set user from profile (includes role) or fallback to session data
          // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
          const userData = {
            id: session.user.id,
            email: session.user.email || '',
            full_name: userProfile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
            avatar_url: userProfile?.avatar_url || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
            org_id: userProfile?.org_id || null,
            role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
            created_at: session.user.created_at,
            last_sign_in: userProfile?.last_sign_in || null
          }
          setUser(userData)
          console.log('[Auth] User profile loaded:', { email: userData.email, role: userData.role })
          
          // Then load organization using the working linkUserToOrganization function
          console.log('[Auth] Loading organization for:', session.user.email)
          const { org, error } = await linkUserToOrganization(session.user.id, session.user.email || '')
          if (org) {
            console.log('[Auth] Organization loaded:', (org as any).name)
            setOrganization(org as any)
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
          if (event === 'SIGNED_IN') {
            setIsConnecting(true)
          }
          
          // Store access token for raw fetch calls (Supabase client methods hang)
          setCurrentAccessToken(session.access_token)
          
          try {
            // Fetch user profile from database to get role
            console.log('[Auth] Fetching user profile...')
            const { profile, error: profileError } = await getUserProfile(session.user.id)
            console.log('[Auth] Profile fetch result:', { hasProfile: !!profile, error: profileError?.message })
            
            const userProfile = profile as { full_name?: string; avatar_url?: string; org_id?: string; role?: string; last_sign_in?: string } | null
            
            // Set user from profile (includes role) or fallback to session data
            // Note: Google OAuth stores avatar as 'picture' in user_metadata, not 'avatar_url'
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              full_name: userProfile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
              avatar_url: userProfile?.avatar_url || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
              org_id: userProfile?.org_id || null,
              role: (userProfile?.role || 'engineer') as 'admin' | 'engineer' | 'viewer',
              created_at: session.user.created_at,
              last_sign_in: userProfile?.last_sign_in || null
            })
            console.log('[Auth] User set:', { email: session.user.email, role: userProfile?.role || 'engineer' })
            
            if (event === 'SIGNED_IN') {
              setStatusMessage(`Welcome, ${session.user.user_metadata?.full_name || session.user.email}!`)
              setTimeout(() => setStatusMessage(''), 3000)
            }
            
            // Load organization (setOrganization will clear isConnecting)
            console.log('[Auth] Loading organization...')
            const { org, error: orgError } = await linkUserToOrganization(session.user.id, session.user.email || '')
            if (org) {
              console.log('[Auth] Organization loaded:', (org as any).name)
              setOrganization(org as any)
            } else {
              console.log('[Auth] No organization found:', orgError)
              setIsConnecting(false)
            }
          } catch (err) {
            console.error('[Auth] Error in auth state handler:', err)
            setIsConnecting(false)
          }
        } else if (event === 'SIGNED_OUT') {
          console.log('[Auth] Signed out')
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

  // Validate connected vault IDs after organization loads
  // This cleans up stale vaults that no longer exist on the server
  useEffect(() => {
    const validateVaults = async () => {
      if (!organization || connectedVaults.length === 0) return
      
      console.log('[VaultValidation] Checking', connectedVaults.length, 'connected vaults against server')
      
      try {
        // Fetch vault IDs from server
        const { data: serverVaults, error } = await supabase
          .from('vaults')
          .select('id, name, slug')
          .eq('org_id', organization.id)
        
        if (error) {
          console.error('[VaultValidation] Failed to fetch server vaults:', error)
          return
        }
        
        const serverVaultIds = new Set((serverVaults || []).map((v: any) => v.id))
        console.log('[VaultValidation] Server has', serverVaultIds.size, 'vaults:', Array.from(serverVaultIds))
        
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
  }, [organization, connectedVaults, currentVaultId, setVaultConnected, setVaultPath])

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
                }
              }
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
        // Only clear state if user is authenticated (to avoid clearing on startup race)
        if (user || isOfflineMode) {
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
    const loadKey = `${vaultPath}:${currentVaultId || 'none'}:${organization?.id || 'none'}`
    
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
            // Show toast notification for new files
            const userName = newFile.created_by === currentUserId ? 'You' : 'Another user'
            addToast('info', `${userName} added: ${newFile.file_name}`)
          }
          break
          
        case 'UPDATE':
          // File updated - could be checkout, version change, state change, etc.
          if (newFile) {
            console.log('[Realtime] File updated:', newFile.file_name)
            updateFilePdmData(newFile.id, newFile)
            
            // Check for force check-in from different machine (your file was released)
            // This happens when: you had file checked out on this machine, but it was checked in from elsewhere
            if (oldFile?.checked_out_by === currentUserId && !newFile.checked_out_by) {
              // The file that was checked out by current user is now not checked out
              // Check if it was force-checked-in from a different machine
              const oldMachineId = oldFile?.checked_out_by_machine_id
              
              // Get current machine ID to compare
              import('@/lib/backup').then(async ({ getMachineId }) => {
                const currentMachineId = await getMachineId()
                
                if (oldMachineId && oldMachineId === currentMachineId) {
                  // File was checked out on THIS machine but released from elsewhere
                  // This is a force check-in scenario!
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
            
            // Notify about important changes from other users
            if (newFile.updated_by && newFile.updated_by !== currentUserId) {
              // Check for checkout changes
              if (oldFile?.checked_out_by !== newFile.checked_out_by) {
                if (newFile.checked_out_by) {
                  addToast('info', `${newFile.file_name} checked out`)
                } else {
                  addToast('info', `${newFile.file_name} checked in (v${newFile.version})`)
                }
              }
              // Check for new version
              else if (oldFile?.version !== newFile.version) {
                addToast('info', `${newFile.file_name} updated to v${newFile.version}`)
              }
              // Check for state change
              else if (oldFile?.state !== newFile.state) {
                addToast('info', `${newFile.file_name} → ${newFile.state}`)
              }
            }
          }
          break
          
        case 'DELETE':
          // File deleted from server
          if (oldFile) {
            console.log('[Realtime] File deleted:', oldFile.file_name)
            removeCloudFile(oldFile.id)
            if (oldFile.deleted_by !== currentUserId) {
              addToast('warning', `${oldFile.file_name} was deleted`)
            }
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
    
    return () => {
      console.log('[Realtime] Cleaning up subscriptions')
      unsubscribeFiles()
      unsubscribeActivity()
      unsubscribeAll()
    }
  }, [organization, isOfflineMode])

  // Start backup heartbeat and scheduler when user and org are available
  // Backup services removed - all backup operations are now handled directly via restic
  // when the user clicks "Backup Now" or "Restore" in the BackupPanel

  // Auto-updater event listeners
  useEffect(() => {
    if (!window.electronAPI) return
    
    const { 
      showUpdateToast, 
      setUpdateAvailable, 
      setUpdateDownloading, 
      setUpdateDownloaded, 
      setUpdateProgress,
      addToast 
    } = usePDMStore.getState()
    
    const cleanups: (() => void)[] = []
    
    // Update available - show toast notification
    cleanups.push(
      window.electronAPI.onUpdateAvailable((info) => {
        console.log('[Update] Update available:', info.version)
        setUpdateAvailable(info)
        showUpdateToast(info.version)
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
    
    // Download completed
    cleanups.push(
      window.electronAPI.onUpdateDownloaded((info) => {
        console.log('[Update] Update downloaded:', info.version)
        setUpdateDownloading(false)
        setUpdateDownloaded(true)
        setUpdateProgress(null)
      })
    )
    
    // Error
    cleanups.push(
      window.electronAPI.onUpdateError((error) => {
        console.error('[Update] Error:', error.message)
        setUpdateDownloading(false)
        setUpdateProgress(null)
        addToast('error', `Update error: ${error.message}`)
      })
    )
    
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
              handleOpenVault()
            }
            break
          case 'b':
            e.preventDefault()
            toggleSidebar()
            break
          case 'd':
            e.preventDefault()
            toggleDetailsPanel()
            break
          case '`':  // Ctrl+` or Cmd+` to switch to terminal view
            e.preventDefault()
            setActiveView('terminal')
            break
        }
      }
      
      if (e.key === 'F5') {
        e.preventDefault()
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
      <div className="h-screen flex flex-col bg-pdm-bg overflow-hidden">
        <SetupScreen onConfigured={handleSupabaseConfigured} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-pdm-bg overflow-hidden">
      <MenuBar
        onOpenVault={handleOpenVault}
        onRefresh={loadFiles}
        minimal={isSignInScreen}
      />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!showWelcome && <ActivityBar />}

        {sidebarVisible && !showWelcome && (
          <>
            <Sidebar 
              onOpenVault={handleOpenVault}
              onOpenRecentVault={handleOpenRecentVault}
              onRefresh={loadFiles}
              settingsTab={settingsTab}
              onSettingsTabChange={setSettingsTab}
            />
            {/* Hide resize handle for settings view (fixed width) */}
            {activeView !== 'settings' && (
              <div
                className="w-1.5 bg-pdm-border hover:bg-pdm-accent cursor-col-resize transition-colors flex-shrink-0 relative group"
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
          {showWelcome ? (
            <WelcomeScreen 
              onOpenRecentVault={handleOpenRecentVault}
            />
          ) : activeView === 'settings' ? (
            /* Settings View - replaces entire main content area */
            <SettingsContent activeTab={settingsTab} />
          ) : (
            <>
              {/* File Browser */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <FileBrowser onRefresh={loadFiles} />
          </div>

              {/* Details Panel */}
              {detailsPanelVisible && (
                <>
                  <div
                    className="h-1 bg-pdm-border hover:bg-pdm-accent cursor-row-resize transition-colors flex-shrink-0"
                    onMouseDown={() => setIsResizingDetails(true)}
                  />
          <DetailsPanel />
                </>
              )}
            </>
          )}
        </div>

        {/* Right Panel */}
        {rightPanelVisible && rightPanelTabs.length > 0 && !showWelcome && (
          <>
            <div
              className="w-1.5 bg-pdm-border hover:bg-pdm-accent cursor-col-resize transition-colors flex-shrink-0 relative"
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
      
      {/* Orphaned Checkouts Dialog */}
      <OrphanedCheckoutsContainer onRefresh={loadFiles} />
    </div>
  )
}

export default App
