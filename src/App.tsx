import { useEffect, useState, useCallback } from 'react'
import { usePDMStore } from './stores/pdmStore'
import { supabase, getCurrentSession, getUserProfile, isSupabaseConfigured, getFiles, linkUserToOrganization } from './lib/supabase'
import { MenuBar } from './components/MenuBar'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { FileBrowser } from './components/FileBrowser'
import { DetailsPanel } from './components/DetailsPanel'
import { StatusBar } from './components/StatusBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Toast } from './components/Toast'

function App() {
  const {
    user,
    organization,
    isOfflineMode,
    vaultPath,
    isVaultConnected,
    sidebarVisible,
    setSidebarWidth,
    toggleSidebar,
    detailsPanelVisible,
    toggleDetailsPanel,
    setVaultPath,
    setVaultConnected,
    setFiles,
    setServerFiles,
    setIsLoading,
    setStatusMessage,
    addRecentVault,
    setUser,
    setOrganization,
  } = usePDMStore()

  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingDetails, setIsResizingDetails] = useState(false)

  // Initialize auth state (runs in background, doesn't block UI)
  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.log('[Auth] Supabase not configured')
      return
    }

    console.log('[Auth] Checking for existing session...')

    // Check for existing session
    getCurrentSession().then(async ({ session }) => {
      if (session?.user) {
        console.log('[Auth] Found existing session:', session.user.email)
        
        // Set user from session data first (fast)
        const userData = {
          id: session.user.id,
          email: session.user.email || '',
          full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
          avatar_url: session.user.user_metadata?.avatar_url || null,
          org_id: null,
          role: 'engineer' as const,
          created_at: session.user.created_at,
          last_sign_in: null
        }
        setUser(userData)
        
        // Then load organization using the working linkUserToOrganization function
        console.log('[Auth] Loading organization for:', session.user.email)
        linkUserToOrganization(session.user.id, session.user.email || '').then(({ org, error }) => {
          if (org) {
            console.log('[Auth] Organization loaded:', org.name)
            setOrganization(org)
          } else if (error) {
            console.log('[Auth] No organization found:', error)
          }
        })
      } else {
        console.log('[Auth] No existing session')
      }
    }).catch(err => {
      console.error('[Auth] Error checking session:', err)
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Auth] Auth state changed:', event)
        
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
          // Set user from session
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
            avatar_url: session.user.user_metadata?.avatar_url || null,
            org_id: null,
            role: 'engineer',
            created_at: session.user.created_at,
            last_sign_in: null
          })
          
          if (event === 'SIGNED_IN') {
            setStatusMessage(`Welcome, ${session.user.user_metadata?.full_name || session.user.email}!`)
            setTimeout(() => setStatusMessage(''), 3000)
          }
          
          // Load organization
          linkUserToOrganization(session.user.id, session.user.email || '').then(({ org }) => {
            if (org) {
              console.log('[Auth] Organization loaded on state change:', org.name)
              setOrganization(org)
            }
          })
        } else if (event === 'SIGNED_OUT') {
          console.log('[Auth] Signed out')
          setUser(null)
          setOrganization(null)
          setVaultConnected(false)
          setStatusMessage('Signed out')
          setTimeout(() => setStatusMessage(''), 3000)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [setUser, setOrganization, setStatusMessage, setVaultConnected])

  // Load files from working directory and merge with PDM data
  const loadFiles = useCallback(async () => {
    if (!window.electronAPI || !vaultPath) return
    
    setIsLoading(true)
    setStatusMessage('Loading files...')
    
    try {
      // 1. Load local files
      const result = await window.electronAPI.listWorkingFiles()
      if (!result.success || !result.files) {
        setStatusMessage(result.error || 'Failed to load files')
        return
      }
      
      let localFiles = result.files
      
      // 2. If connected to Supabase, fetch PDM data and merge
      if (organization && !isOfflineMode) {
        const { files: pdmFiles, error: pdmError } = await getFiles(organization.id)
        
        if (pdmError) {
          console.warn('Failed to fetch PDM data:', pdmError)
        } else if (pdmFiles) {
          // Create a map of pdm data by file path
          const pdmMap = new Map(pdmFiles.map(f => [f.file_path, f]))
          
          // Store server files for tracking deletions
          const serverFilesList = pdmFiles.map(f => ({
            id: f.id,
            file_path: f.file_path,
            name: f.name,
            extension: f.extension,
            content_hash: f.latest_version?.content_hash || ''
          }))
          setServerFiles(serverFilesList)
          
          // Create set of local file paths for deletion detection
          const localPathSet = new Set(localFiles.map(f => f.relativePath))
          
          // Merge PDM data into local files and compute diff status
          localFiles = localFiles.map(localFile => {
            if (localFile.isDirectory) return localFile
            
            const pdmData = pdmMap.get(localFile.relativePath)
            
            // Determine diff status
            let diffStatus: 'added' | 'modified' | undefined
            if (!pdmData) {
              // File exists locally but not on server = added
              diffStatus = 'added'
            } else if (pdmData.latest_version?.content_hash && localFile.localHash) {
              // File exists both places - check if modified
              if (pdmData.latest_version.content_hash !== localFile.localHash) {
                diffStatus = 'modified'
              }
            }
            
            return {
              ...localFile,
              pdmData: pdmData || undefined,
              isSynced: !!pdmData,
              diffStatus
            }
          })
          
          // Add deleted files (exist on server but not locally) as "ghost" entries
          for (const pdmFile of pdmFiles) {
            if (!localPathSet.has(pdmFile.file_path)) {
              localFiles.push({
                name: pdmFile.name,
                path: `${vaultPath}\\${pdmFile.file_path.replace(/\//g, '\\')}`,
                relativePath: pdmFile.file_path,
                isDirectory: false,
                extension: pdmFile.extension,
                size: pdmFile.file_size || 0,
                modifiedTime: pdmFile.updated_at || '',
                pdmData: pdmFile,
                isSynced: true,
                diffStatus: 'deleted'
              })
            }
          }
        }
      } else {
        // Offline mode or no org - all local files are "added"
        localFiles = localFiles.map(f => ({
          ...f,
          diffStatus: f.isDirectory ? undefined : 'added' as const
        }))
      }
      
      setFiles(localFiles)
      const syncedCount = localFiles.filter(f => f.pdmData).length
      const totalFiles = localFiles.filter(f => !f.isDirectory).length
      setStatusMessage(`Loaded ${localFiles.length} items (${syncedCount}/${totalFiles} synced)`)
    } catch (err) {
      setStatusMessage('Error loading files')
      console.error(err)
    } finally {
      setIsLoading(false)
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }, [vaultPath, organization, isOfflineMode, setFiles, setIsLoading, setStatusMessage])

  // Open working directory
  const handleOpenVault = useCallback(async () => {
    if (!window.electronAPI) return
    
    const result = await window.electronAPI.selectWorkingDir()
    if (result.success && result.path) {
      setVaultPath(result.path)
      setVaultConnected(true)
      addRecentVault(result.path)
      setStatusMessage(`Opened: ${result.path}`)
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }, [setVaultPath, setVaultConnected, addRecentVault, setStatusMessage])

  // Open recent vault
  const handleOpenRecentVault = useCallback(async (path: string) => {
    if (!window.electronAPI) return
    
    const result = await window.electronAPI.setWorkingDir(path)
    if (result.success) {
      setVaultPath(path)
      setVaultConnected(true)
      addRecentVault(path)
      setStatusMessage(`Opened: ${path}`)
      setTimeout(() => setStatusMessage(''), 3000)
    } else {
      setStatusMessage(result.error || 'Failed to open folder')
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }, [setVaultPath, setVaultConnected, addRecentVault, setStatusMessage])

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

  // Load files when working directory changes
  useEffect(() => {
    if (isVaultConnected && vaultPath) {
      loadFiles()
    }
  }, [isVaultConnected, vaultPath, loadFiles])

  // Handle sidebar resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = e.clientX - 48
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
      setIsResizingDetails(false)
    }

    if (isResizingSidebar || isResizingDetails) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = isResizingSidebar ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingSidebar, isResizingDetails, setSidebarWidth])

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
  const showWelcome = (!user && !isOfflineMode) || !isVaultConnected

  return (
    <div className="h-screen flex flex-col bg-pdm-bg overflow-hidden">
      <MenuBar 
        onOpenVault={handleOpenVault}
        onRefresh={loadFiles}
      />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <ActivityBar />

        {sidebarVisible && !showWelcome && (
          <>
            <Sidebar 
              onOpenVault={handleOpenVault}
              onOpenRecentVault={handleOpenRecentVault}
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
              onOpenVault={handleOpenVault}
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
      </div>

      <StatusBar />
      <Toast />
    </div>
  )
}

export default App
