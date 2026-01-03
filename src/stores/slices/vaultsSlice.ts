import { StateCreator } from 'zustand'
import type { PDMStoreState, VaultsSlice, ConnectedVault, LocalFile, ServerFile } from '../types'

export const createVaultsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  VaultsSlice
> = (set, get) => ({
  // Initial state - Legacy single vault
  vaultPath: null,
  vaultName: null,
  isVaultConnected: false,
  
  // Initial state - Multi-vault
  connectedVaults: [],
  activeVaultId: null,
  vaultsRefreshKey: 0,
  vaultFilesCache: {},
  
  // Initial state - Recent
  recentVaults: [],
  autoConnect: true,
  
  // Actions - Legacy single vault
  setVaultPath: (vaultPath) => set({ vaultPath }),
  setVaultName: (vaultName) => set({ vaultName }),
  setVaultConnected: (isVaultConnected) => set({ isVaultConnected }),
  addRecentVault: (path) => {
    const { recentVaults } = get()
    const updated = [path, ...recentVaults.filter(v => v !== path)].slice(0, 10)
    set({ recentVaults: updated })
  },
  setAutoConnect: (autoConnect) => set({ autoConnect }),
  
  // Actions - Connected Vaults
  setConnectedVaults: (connectedVaults) => set({ connectedVaults }),
  
  addConnectedVault: (vault: ConnectedVault) => {
    const { connectedVaults } = get()
    // Don't add duplicates by ID
    if (connectedVaults.some(v => v.id === vault.id)) return
    // Don't add duplicates by path (normalized for case-insensitive and path separator comparison)
    const normalizedNewPath = vault.localPath.toLowerCase().replace(/\\/g, '/')
    if (connectedVaults.some(v => v.localPath.toLowerCase().replace(/\\/g, '/') === normalizedNewPath)) {
      console.warn('[PDMStore] Vault with same local path already exists, skipping add', { 
        newVault: vault.name, 
        existingVault: connectedVaults.find(v => v.localPath.toLowerCase().replace(/\\/g, '/') === normalizedNewPath)?.name 
      })
      return
    }
    // Add vault and set it as active
    set({ 
      connectedVaults: [...connectedVaults, vault],
      activeVaultId: vault.id
    })
  },
  
  removeConnectedVault: (vaultId: string) => {
    const { connectedVaults, activeVaultId } = get()
    const updated = connectedVaults.filter(v => v.id !== vaultId)
    set({ 
      connectedVaults: updated,
      activeVaultId: activeVaultId === vaultId ? (updated[0]?.id || null) : activeVaultId
    })
  },
  
  toggleVaultExpanded: (vaultId: string) => {
    const { connectedVaults } = get()
    set({
      connectedVaults: connectedVaults.map(v =>
        v.id === vaultId ? { ...v, isExpanded: !v.isExpanded } : v
      )
    })
  },
  
  setActiveVault: (activeVaultId) => set({ activeVaultId }),
  
  switchVault: (activeVaultId, vaultPath) => {
    console.log('[Store] switchVault called:', { activeVaultId, vaultPath })
    set({ activeVaultId, vaultPath })
  },
  
  updateConnectedVault: (vaultId: string, updates: Partial<ConnectedVault>) => {
    const { connectedVaults } = get()
    set({
      connectedVaults: connectedVaults.map(v =>
        v.id === vaultId ? { ...v, ...updates } : v
      )
    })
  },
  
  triggerVaultsRefresh: () => {
    set({ vaultsRefreshKey: get().vaultsRefreshKey + 1 })
  },
  
  // Actions - Vault Files Cache
  setVaultFiles: (vaultId: string, files: LocalFile[], serverFiles: ServerFile[]) => {
    const { vaultFilesCache } = get()
    set({
      vaultFilesCache: {
        ...vaultFilesCache,
        [vaultId]: { files, serverFiles, loaded: true, loading: false }
      }
    })
  },
  
  setVaultLoading: (vaultId: string, loading: boolean) => {
    const { vaultFilesCache } = get()
    const existing = vaultFilesCache[vaultId] || { files: [], serverFiles: [], loaded: false, loading: false }
    set({
      vaultFilesCache: {
        ...vaultFilesCache,
        [vaultId]: { ...existing, loading }
      }
    })
  },
  
  getVaultFiles: (vaultId: string) => {
    const { vaultFilesCache } = get()
    return vaultFilesCache[vaultId] || { files: [], serverFiles: [], loaded: false, loading: false }
  },
  
  clearVaultCache: (vaultId: string) => {
    const { vaultFilesCache } = get()
    const { [vaultId]: _, ...rest } = vaultFilesCache
    set({ vaultFilesCache: rest })
  },
})
