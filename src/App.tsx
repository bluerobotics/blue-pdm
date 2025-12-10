import { useEffect, useState, useCallback, useRef } from 'react'
import { usePDMStore } from './stores/pdmStore'
import { supabase, getCurrentSession, isSupabaseConfigured, getFilesLightweight, getCheckedOutUsers, linkUserToOrganization, getUserProfile, setCurrentAccessToken } from './lib/supabase'
import { MenuBar } from './components/MenuBar'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { FileBrowser } from './components/FileBrowser'
import { DetailsPanel } from './components/DetailsPanel'
import { StatusBar } from './components/StatusBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { SetupScreen } from './components/SetupScreen'
import { Toast } from './components/Toast'
import { RightPanel } from './components/RightPanel'

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

function App() {
  const {
    user,
    organization,
    isOfflineMode,
    vaultPath,
    isVaultConnected,
    connectedVaults,
    activeVaultId,
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
  
  // Track if Supabase is configured (can change at runtime)
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConfigured())
  
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

  // Load files from working directory and merge with PDM data
  // silent = true means no loading spinner (for background refreshes after downloads/uploads)
  const loadFiles = useCallback(async (silent: boolean = false) => {
    if (!window.electronAPI || !vaultPath) return
    
    if (!silent) {
      setIsLoading(true)
      setStatusMessage('Loading files...')
      // Yield to UI thread so loading state renders before heavy work
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    
    try {
      // Run local file scan and server fetch in PARALLEL for faster boot
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
        setStatusMessage(localResult.error || 'Failed to load files')
        return
      }
      
      // Map hash to localHash for comparison
      let localFiles = localResult.files.map((f: any) => ({
        ...f,
        localHash: f.hash
      }))
      
      // 2. If connected to Supabase, merge PDM data
      if (shouldFetchServer) {
        const pdmFiles = serverResult.files
        const pdmError = serverResult.error
        
        if (pdmError) {
          console.warn('Failed to fetch PDM data:', pdmError)
        } else if (pdmFiles && Array.isArray(pdmFiles)) {
          if (!silent) {
            setStatusMessage(`Merging ${pdmFiles.length} files...`)
          }
          
          // Create a map of pdm data by file path
          const pdmMap = new Map(pdmFiles.map((f: any) => [f.file_path, f]))
          
          // Store server files for tracking deletions
          const serverFilesList = pdmFiles.map((f: any) => ({
            id: f.id,
            file_path: f.file_path,
            name: f.name,
            extension: f.extension,
            content_hash: f.content_hash || ''
          }))
          setServerFiles(serverFilesList)
          
          // Create set of local file paths for deletion detection
          const localPathSet = new Set(localFiles.map(f => f.relativePath))
          
          // Create a map of existing files' localActiveVersion to preserve rollback state
          // Use getState() to get current files at execution time (not stale closure value)
          const currentFiles = usePDMStore.getState().files
          const existingLocalActiveVersions = new Map<string, number>()
          for (const f of currentFiles) {
            if (f.localActiveVersion !== undefined) {
              existingLocalActiveVersions.set(f.path, f.localActiveVersion)
            }
          }
          
          // Create a map of server files keyed by content hash for move detection
          // This allows us to detect moved files (same content, different path) and preserve their pdmData
          // We prioritize checked-out-by-me files, but also track all synced files for move detection
          const serverFilesByHash = new Map<string, any>()
          const checkedOutByMeByHash = new Map<string, any>()
          for (const pdmFile of pdmFiles as any[]) {
            if (pdmFile.content_hash) {
              // Always track by hash for move detection (first one wins if duplicates)
              if (!serverFilesByHash.has(pdmFile.content_hash)) {
                serverFilesByHash.set(pdmFile.content_hash, pdmFile)
              }
              // Also track checked-out-by-me files (these take priority)
              if (pdmFile.checked_out_by === user?.id) {
                checkedOutByMeByHash.set(pdmFile.content_hash, pdmFile)
              }
            }
          }
          
          // Merge PDM data into local files and compute diff status
          localFiles = localFiles.map(localFile => {
            if (localFile.isDirectory) return localFile
            
            let pdmData = pdmMap.get(localFile.relativePath)
            let isMovedFile = false
            
            // If no path match but file has same hash as a server file,
            // this is likely a moved file - preserve the pdmData
            // Prioritize checked-out-by-me files (allows editing), fall back to any server file
            if (!pdmData && localFile.localHash) {
              const movedFromFile = checkedOutByMeByHash.get(localFile.localHash) || serverFilesByHash.get(localFile.localHash)
              if (movedFromFile) {
                pdmData = movedFromFile
                isMovedFile = true
              }
            }
            
            // Preserve localActiveVersion from existing file (for rollback state)
            const existingLocalActiveVersion = existingLocalActiveVersions.get(localFile.path)
            
            // Determine diff status
            let diffStatus: 'added' | 'modified' | 'outdated' | 'moved' | undefined
            if (!pdmData) {
              // File exists locally but not on server = added
              diffStatus = 'added'
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
            } else if (pdmData.content_hash && !localFile.localHash) {
              // Cloud has content but we couldn't hash local file - might be outdated
              diffStatus = 'outdated'
            }
            
            return {
              ...localFile,
              pdmData: pdmData || undefined,
              isSynced: !!pdmData,
              diffStatus,
              // Preserve rollback state if it exists
              localActiveVersion: existingLocalActiveVersion
            }
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
            if (!localPathSet.has(pdmFile.file_path)) {
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
                if (!localPathSet.has(currentPath) && !cloudFolders.has(currentPath)) {
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
        }
      } else {
        // Offline mode or no org - all local files are "added"
        localFiles = localFiles.map(f => ({
          ...f,
          diffStatus: f.isDirectory ? undefined : 'added' as const
        }))
      }
      
      // Update folder diffStatus based on contents
      // A folder should be 'cloud' if all its contents are cloud-only
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
        const hasLocalContent = localFiles.some(f => {
          if (f.relativePath === folder.relativePath) return false // Skip self
          const normalizedPath = f.relativePath.replace(/\\/g, '/')
          
          // Check if it's a direct child (not nested deeper)
          if (!normalizedPath.startsWith(normalizedFolder + '/')) return false
          const remainder = normalizedPath.slice(normalizedFolder.length + 1)
          if (remainder.includes('/')) return false // It's nested deeper, not direct child
          
          // Check if this item is local (not cloud-only)
          return f.diffStatus !== 'cloud'
        })
        
        if (!hasLocalContent) {
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

  // Initialize working directory on startup (only if authenticated or offline)
  useEffect(() => {
    const initWorkingDir = async () => {
      if (!window.electronAPI || !vaultPath) return
      if (!user && !isOfflineMode) return
      
      const result = await window.electronAPI.setWorkingDir(vaultPath)
      if (result.success) {
        setVaultConnected(true)
      } else {
        setVaultPath(null)
        setVaultConnected(false)
      }
    }
    
    initWorkingDir()
  }, [user, isOfflineMode, vaultPath, setVaultPath, setVaultConnected])

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
    
    // Skip if we've already loaded for this exact configuration
    if (lastLoadKey.current === loadKey) {
      // Clear stale loading state if we're skipping (handles HMR)
      setIsLoading(false)
      if (statusMessage === 'Loading organization...' || statusMessage === 'Loading files...') {
        setStatusMessage('')
      }
      return
    }
    
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
        }
      }
      
      if (e.key === 'F5') {
        e.preventDefault()
        loadFiles()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenVault, toggleSidebar, toggleDetailsPanel, loadFiles])

  // Determine if we should show the welcome screen
  const showWelcome = (!user && !isOfflineMode) || !hasVaultConnected
  
  // Only show minimal menu bar on the sign-in screen (not authenticated)
  const isSignInScreen = !user && !isOfflineMode
  
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
            />
            <div
              className="w-1 bg-pdm-border hover:bg-pdm-accent cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={() => setIsResizingSidebar(true)}
            />
          </>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {showWelcome ? (
            <WelcomeScreen 
              onOpenRecentVault={handleOpenRecentVault}
            />
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
              className="w-1 bg-pdm-border hover:bg-pdm-accent cursor-col-resize transition-colors flex-shrink-0"
              onMouseDown={() => setIsResizingRightPanel(true)}
            />
            <RightPanel />
          </>
        )}
      </div>

      <StatusBar />
      <Toast />
    </div>
  )
}

export default App
