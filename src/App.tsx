import { useEffect, useState, useRef } from 'react'
import { usePDMStore } from './stores/pdmStore'
import { SetupScreen } from './components/SetupScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { PerformanceWindow } from './components/PerformanceWindow'
import { TabWindow, isTabWindowMode, parseTabWindowParams } from './components/TabWindow'
import { AppShell } from './components/layout'
import { executeTerminalCommand } from './lib/commands/parser'
import { logUserAction } from './lib/userActionLogger'
import { checkSchemaCompatibility } from './lib/schemaVersion'
import { getAccessibleVaults } from './lib/supabase'
import type { SettingsTab } from './types/settings'
import {
  useTheme,
  useLanguage,
  useRealtimeSubscriptions,
  useSessionHeartbeat,
  useBackupHeartbeat,
  useSolidWorksAutoStart,
  useAutoUpdater,
  useKeyboardShortcuts,
  useLoadFiles,
  useAuth,
  useStagedCheckins,
  useAutoDownload,
  useVaultManagement,
} from './hooks'

// Check if we're in performance mode (pop-out window)
function isPerformanceMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'performance'
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
  
  // Log app startup
  useEffect(() => {
    logUserAction('navigation', 'App started', {
      platform: navigator.platform,
      userAgent: navigator.userAgent.split(' ').slice(-1)[0] // Last part is Chrome version
    })
  }, [])
  
  // Get onboarding state
  const onboardingComplete = usePDMStore(s => s.onboardingComplete)
  
  // Settings tab state
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
  
  // Listen for settings tab navigation from MenuBar buttons
  useEffect(() => {
    const handleNavigateSettingsTab = (e: CustomEvent<SettingsTab>) => {
      setSettingsTab(e.detail)
    }
    window.addEventListener('navigate-settings-tab', handleNavigateSettingsTab as EventListener)
    return () => window.removeEventListener('navigate-settings-tab', handleNavigateSettingsTab as EventListener)
  }, [])
  
  // Auth hook - handles authentication state and Supabase initialization
  const { supabaseReady, handleSupabaseConfigured, handleChangeOrg } = useAuth()
  
  // Vault management hook
  const {
    handleOpenVault,
    handleOpenRecentVault,
    handleVaultNotFoundBrowse,
    handleVaultNotFoundSettings,
    handleCloseVaultNotFound,
    vaultNotFoundPath,
    vaultNotFoundName,
    lastLoadKey,
  } = useVaultManagement(setSettingsTab)
  
  // Load files hook
  const { loadFiles } = useLoadFiles()
  
  // Staged check-ins hook
  const { stagedConflicts, clearStagedConflicts } = useStagedCheckins(loadFiles)
  
  // Auto-download trigger hook
  useAutoDownload()
  
  // Get store values needed for effects and computed values
  const {
    user,
    organization,
    isOfflineMode,
    vaultPath,
    isVaultConnected,
    connectedVaults,
    activeVaultId,
    statusMessage,
    toggleSidebar,
    toggleDetailsPanel,
    setApiServerUrl,
    apiServerUrl,
    addToast,
    setIsLoading,
    setStatusMessage,
    setVaultPath,
    setVaultConnected,
    getEffectiveRole,
  } = usePDMStore()
  
  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  // Consider vault connected if either legacy or new multi-vault system is connected
  const hasVaultConnected = isVaultConnected || connectedVaults.length > 0
  
  // Existing extracted hooks
  useRealtimeSubscriptions(organization, isOfflineMode)
  useSessionHeartbeat(user, organization)
  useBackupHeartbeat(organization?.id)
  useSolidWorksAutoStart(organization)
  useAutoUpdater()
  useKeyboardShortcuts({ onOpenVault: handleOpenVault, onRefresh: loadFiles })

  // Sync API URL from organization settings to store (which handles localStorage persistence)
  useEffect(() => {
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
  useEffect(() => {
    const validateVaults = async () => {
      if (!organization || !user || connectedVaults.length === 0) return
      
      console.log('[VaultValidation] Checking', connectedVaults.length, 'connected vaults against accessible vaults')
      
      try {
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
        
        const staleVaults = connectedVaults.filter(cv => !serverVaultIds.has(cv.id))
        
        if (staleVaults.length > 0) {
          console.warn('[VaultValidation] Found', staleVaults.length, 'stale vault(s):', staleVaults.map(v => ({ id: v.id, name: v.name })))
          
          const store = usePDMStore.getState()
          staleVaults.forEach(v => {
            console.log('[VaultValidation] Removing stale vault:', v.name, v.id)
            store.removeConnectedVault(v.id)
          })
          
          if (staleVaults.some(v => v.id === currentVaultId) && serverVaults && serverVaults.length > 0) {
            const defaultVault = (serverVaults as any[]).find((v: any) => v.is_default) || serverVaults[0]
            console.log('[VaultValidation] Active vault was stale, will need to reconnect to:', (defaultVault as any).name)
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
  }, [organization, user?.id, connectedVaults, currentVaultId, setVaultConnected, setVaultPath, getEffectiveRole])

  // Track if we've already shown the schema warning this session
  const schemaCheckDoneRef = useRef(false)
  
  // Check schema compatibility after organization loads
  useEffect(() => {
    const checkSchema = async () => {
      if (!organization?.id || isOfflineMode || schemaCheckDoneRef.current) return
      
      schemaCheckDoneRef.current = true
      
      try {
        const result = await checkSchemaCompatibility()
        console.log('[SchemaVersion] Check result:', result)
        
        if (result.status === 'missing') {
          addToast('warning', `${result.message}: ${result.details}`, 15000)
        } else if (result.status === 'incompatible') {
          addToast('error', `${result.message}: ${result.details}`, 0)
        } else if (result.status === 'outdated') {
          if (result.dbVersion && result.dbVersion > result.expectedVersion) {
            addToast('info', `${result.message}. ${result.details}`, 10000)
          } else {
            addToast('warning', `${result.message}. ${result.details}`, 10000)
          }
        }
      } catch (err) {
        console.error('[SchemaVersion] Error checking schema:', err)
      }
    }
    
    checkSchema()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, isOfflineMode])

  // CLI command listener - always active so CLI works even when terminal is hidden
  useEffect(() => {
    if (!window.electronAPI?.onCliCommand) return
    
    const unsubscribe = window.electronAPI.onCliCommand(async ({ requestId, command }) => {
      console.log('[App] Received CLI command:', command)
      
      try {
        const results = await executeTerminalCommand(command, loadFiles)
        
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
  useEffect(() => {
    if (!window.electronAPI || !vaultPath) return
    
    let refreshTimeout: NodeJS.Timeout | null = null
    
    const cleanup = window.electronAPI.onFilesChanged((changedFiles) => {
      const { syncProgress, processingFolders } = usePDMStore.getState()
      if (syncProgress.isActive || processingFolders.size > 0) {
        return
      }
      
      console.log('[FileWatcher] Files changed:', changedFiles.length, 'files')
      
      if (refreshTimeout) {
        clearTimeout(refreshTimeout)
      }
      
      refreshTimeout = setTimeout(() => {
        const currentState = usePDMStore.getState()
        if (currentState.syncProgress.isActive || currentState.processingFolders.size > 0) {
          return
        }
        loadFiles(true)
        refreshTimeout = null
      }, 1000)
    })
    
    return cleanup
  }, [vaultPath, loadFiles])

  // Load files when ready - wait for organization to be loaded when online
  useEffect(() => {
    if (!isVaultConnected || !vaultPath) return
    
    if (!isOfflineMode && user && !organization) {
      setIsLoading(true)
      setStatusMessage('Loading organization...')
      return
    }
    
    const loadKey = `${vaultPath}:${currentVaultId || 'none'}:${organization?.id || 'none'}:${isOfflineMode ? 'offline' : 'online'}`
    
    console.log('[LoadEffect] loadKey:', loadKey, 'lastLoadKey:', lastLoadKey.current)
    
    if (lastLoadKey.current === loadKey) {
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
  }, [isVaultConnected, vaultPath, isOfflineMode, user, organization, currentVaultId, loadFiles, setIsLoading, setStatusMessage, statusMessage, lastLoadKey])

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
    <AppShell
      showWelcome={showWelcome}
      isSignInScreen={isSignInScreen}
      settingsTab={settingsTab}
      onSettingsTabChange={setSettingsTab}
      onOpenVault={handleOpenVault}
      onOpenRecentVault={handleOpenRecentVault}
      onChangeOrg={handleChangeOrg}
      loadFiles={loadFiles}
      stagedConflicts={stagedConflicts}
      onClearStagedConflicts={clearStagedConflicts}
      vaultNotFoundPath={vaultNotFoundPath}
      vaultNotFoundName={vaultNotFoundName}
      onCloseVaultNotFound={handleCloseVaultNotFound}
      onVaultNotFoundSettings={handleVaultNotFoundSettings}
      onVaultNotFoundBrowse={handleVaultNotFoundBrowse}
    />
  )
}

export default App
