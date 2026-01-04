import { useEffect, useState, useCallback, useRef } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import type { SettingsTab } from '@/types/settings'

/**
 * Hook to manage vault operations and state
 * Handles:
 * - Opening new vaults
 * - Opening recent vaults
 * - Vault not found dialog state
 * - Working directory initialization
 */
export function useVaultManagement(
  setSettingsTab: (tab: SettingsTab) => void
) {
  const {
    user,
    isOfflineMode,
    vaultPath,
    isVaultConnected,
    connectedVaults,
    activeVaultId,
    setVaultPath,
    setVaultConnected,
    setFiles,
    setServerFiles,
    setFilesLoaded,
    setStatusMessage,
    setIsLoading,
    addRecentVault,
    addToast,
  } = usePDMStore()

  // Vault not found dialog state
  const [vaultNotFoundPath, setVaultNotFoundPath] = useState<string | null>(null)
  const [vaultNotFoundName, setVaultNotFoundName] = useState<string | undefined>(undefined)

  // Track what configuration we last loaded to avoid duplicate loads
  const lastLoadKey = useRef<string>('')
  const mountedRef = useRef(false)

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
  }, [setSettingsTab])

  // Close vault not found dialog
  const handleCloseVaultNotFound = useCallback(() => {
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
      // If no vaultPath but we have connected vaults, use the ACTIVE vault's path (matching activeVaultId)
      // This ensures consistency between working directory and activeVaultId
      const activeVault = connectedVaults.find(v => v.id === activeVaultId) || connectedVaults[0]
      // CRITICAL: Prefer active vault's path over vaultPath to avoid showing wrong vault's files
      // This fixes the issue where vaultPath might be stale after vault switch
      const pathToUse = activeVault?.localPath || vaultPath
      if (!pathToUse) {
        console.log('[Init] No vault path available')
        return
      }
      
      console.log('[Init] Setting working directory:', pathToUse, 'activeVaultId:', activeVaultId)
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
        // Update vaultPath to match active vault (ensures consistency)
        if (activeVault?.localPath && vaultPath !== activeVault.localPath) {
          setVaultPath(activeVault.localPath)
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
  // IMPORTANT: Include activeVaultId so working directory updates when vault changes
  }, [user, isOfflineMode, vaultPath, connectedVaults, activeVaultId, setVaultPath, setVaultConnected])

  return {
    handleOpenVault,
    handleOpenRecentVault,
    handleVaultNotFoundBrowse,
    handleVaultNotFoundSettings,
    handleCloseVaultNotFound,
    vaultNotFoundPath,
    vaultNotFoundName,
    lastLoadKey,
  }
}
