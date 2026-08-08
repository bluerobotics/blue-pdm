/**
 * Extensions Slice - State management for the Extension System
 *
 * This slice manages:
 * - Installed extensions from the Extension Host
 * - Store (marketplace) extensions from the API
 * - Extension lifecycle states and updates
 * - Installation progress and UI state
 */
import { StateCreator } from 'zustand'
import type {
  PDMStoreState,
  ExtensionsSlice,
  InstalledExtension,
  StoreExtensionListing,
  ExtensionUpdateAvailable,
  ExtensionInstallProgress,
  ExtensionLifecycleState,
} from '../types'
import { log } from '@/lib/logger'

// Initial state
const initialState: Pick<
  ExtensionsSlice,
  | 'installedExtensions'
  | 'extensionStates'
  | 'storeExtensions'
  | 'availableUpdates'
  | 'storeLoading'
  | 'storeSearchQuery'
  | 'storeCategoryFilter'
  | 'storeVerifiedOnly'
  | 'storeSort'
  | 'installProgress'
  | 'checkingUpdates'
  | 'lastUpdateCheck'
> = {
  installedExtensions: {},
  extensionStates: {},
  storeExtensions: [],
  availableUpdates: [],
  storeLoading: false,
  storeSearchQuery: '',
  storeCategoryFilter: null,
  storeVerifiedOnly: false,
  storeSort: 'popular',
  installProgress: null,
  checkingUpdates: false,
  lastUpdateCheck: null,
}

export const createExtensionsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ExtensionsSlice
> = (set, get) => ({
  // Initial state
  ...initialState,

  // ═══════════════════════════════════════════════════════════════════════════
  // Synchronous Actions
  // ═══════════════════════════════════════════════════════════════════════════

  setInstalledExtensions: (extensions: Record<string, InstalledExtension>) => {
    const extensionStates: Record<string, ExtensionLifecycleState> = {}
    for (const [id, ext] of Object.entries(extensions)) {
      extensionStates[id] = ext.state
    }
    set({
      installedExtensions: extensions,
      extensionStates,
    })
  },

  updateInstalledExtension: (extensionId: string, updates: Partial<InstalledExtension>) => {
    set((state) => {
      const existing = state.installedExtensions[extensionId]
      if (!existing) return state

      const updated = { ...existing, ...updates }
      return {
        installedExtensions: {
          ...state.installedExtensions,
          [extensionId]: updated,
        },
        extensionStates: {
          ...state.extensionStates,
          [extensionId]: updated.state,
        },
      }
    })
  },

  removeInstalledExtension: (extensionId: string) => {
    set((state) => {
      const { [extensionId]: removed, ...remaining } = state.installedExtensions
      const { [extensionId]: removedState, ...remainingStates } = state.extensionStates
      return {
        installedExtensions: remaining,
        extensionStates: remainingStates,
      }
    })
  },

  setStoreExtensions: (extensions: StoreExtensionListing[]) => {
    set({ storeExtensions: extensions })
  },

  setAvailableUpdates: (updates: ExtensionUpdateAvailable[]) => {
    set({ availableUpdates: updates })
  },

  setStoreLoading: (loading: boolean) => {
    set({ storeLoading: loading })
  },

  setStoreSearchQuery: (query: string) => {
    set({ storeSearchQuery: query })
  },

  setStoreCategoryFilter: (category: string | null) => {
    set({ storeCategoryFilter: category })
  },

  setStoreVerifiedOnly: (verified: boolean) => {
    set({ storeVerifiedOnly: verified })
  },

  setStoreSort: (sort: 'popular' | 'recent' | 'name') => {
    set({ storeSort: sort })
  },

  setInstallProgress: (progress: ExtensionInstallProgress | null) => {
    set({ installProgress: progress })
  },

  setCheckingUpdates: (checking: boolean) => {
    set({ checkingUpdates: checking })
  },

  handleExtensionStateChange: (
    extensionId: string,
    state: ExtensionLifecycleState,
    error?: string,
  ) => {
    set((current) => {
      const existing = current.installedExtensions[extensionId]
      if (!existing) {
        // Extension not in our store yet, just update state
        return {
          extensionStates: {
            ...current.extensionStates,
            [extensionId]: state,
          },
        }
      }

      return {
        installedExtensions: {
          ...current.installedExtensions,
          [extensionId]: {
            ...existing,
            state,
            error,
          },
        },
        extensionStates: {
          ...current.extensionStates,
          [extensionId]: state,
        },
      }
    })
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Async Actions
  // ═══════════════════════════════════════════════════════════════════════════

  loadInstalledExtensions: async () => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const extensions = await api.getAll()
      const extensionsMap: Record<string, InstalledExtension> = {}

      for (const ext of extensions) {
        extensionsMap[ext.manifest.id] = ext
      }

      get().setInstalledExtensions(extensionsMap)
      log.info('[Extensions]', 'Loaded installed extensions', { count: extensions.length })
    } catch (error) {
      log.error('[Extensions]', 'Failed to load installed extensions', { error: error })
    }
  },

  fetchStoreExtensions: async () => {
    const { setStoreLoading, setStoreExtensions } = get()

    try {
      setStoreLoading(true)

      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const extensions = await api.fetchStore()
      setStoreExtensions(extensions)
      log.info('[Extensions]', 'Fetched store extensions', { count: extensions.length })
    } catch (error) {
      log.error('[Extensions]', 'Failed to fetch store extensions', { error: error })
    } finally {
      setStoreLoading(false)
    }
  },

  searchStoreExtensions: async (query?: string, category?: string) => {
    const { setStoreLoading, setStoreExtensions, storeVerifiedOnly, storeSort } = get()

    try {
      setStoreLoading(true)

      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const result = await api.searchStore({
        query,
        category,
        verifiedOnly: storeVerifiedOnly,
        sort: storeSort,
        page: 1,
        pageSize: 50,
      })

      setStoreExtensions(result.extensions)
      log.info('[Extensions]', 'Searched store extensions', {
        query,
        category,
        count: result.extensions.length,
        total: result.total,
      })
    } catch (error) {
      log.error('[Extensions]', 'Failed to search store extensions', { error: error })
    } finally {
      setStoreLoading(false)
    }
  },

  installExtension: async (extensionId: string, version?: string) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      // Find the store extension to get the database UUID for download
      const storeExt = get().storeExtensions.find((e) => e.extensionId === extensionId)
      const downloadId = storeExt?.id || extensionId // Use database UUID if available

      log.info('[Extensions]', 'Installing extension', { extensionId, downloadId, version })
      const result = await api.install(downloadId, version, extensionId)

      if (result.success) {
        // Refresh the installed extensions list to pick up the new installation
        await get().loadInstalledExtensions()
        log.info('[Extensions]', 'Extension installed successfully', {
          extensionId,
          version: result.extension?.manifest.version,
        })
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to install extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  sideloadExtension: async (bpxPath: string, acknowledgeUnsigned = false) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Sideloading extension', { bpxPath })
      const result = await api.installFromFile(bpxPath, acknowledgeUnsigned)

      if (result.success) {
        // Refresh the installed extensions list to pick up the new installation
        await get().loadInstalledExtensions()
        log.info('[Extensions]', 'Extension sideloaded successfully', {
          extensionId: result.extension?.manifest.id,
        })
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to sideload extension', { bpxPath, error: message })
      return { success: false, error: message }
    }
  },

  uninstallExtension: async (extensionId: string) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Uninstalling extension', { extensionId })
      const result = await api.uninstall(extensionId)

      if (result.success) {
        get().removeInstalledExtension(extensionId)
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to uninstall extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  enableExtension: async (extensionId: string) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Enabling extension', { extensionId })
      const result = await api.enable(extensionId)

      if (result.success) {
        get().handleExtensionStateChange(extensionId, 'installed')
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to enable extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  disableExtension: async (extensionId: string) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Disabling extension', { extensionId })
      const result = await api.disable(extensionId)

      if (result.success) {
        get().handleExtensionStateChange(extensionId, 'disabled')
      }

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to disable extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  updateExtension: async (extensionId: string, version?: string) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Updating extension', { extensionId, version })
      const result = await api.update(extensionId, version)

      if (result.success && result.extension) {
        get().updateInstalledExtension(extensionId, result.extension)
        // Remove from available updates
        set((state) => ({
          availableUpdates: state.availableUpdates.filter((u) => u.extensionId !== extensionId),
        }))
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to update extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  rollbackExtension: async (extensionId: string) => {
    try {
      const api = window.electronAPI?.extensions
      if (!api) {
        return { success: false, error: 'Extensions API not available' }
      }

      log.info('[Extensions]', 'Rolling back extension', { extensionId })
      const result = await api.rollback(extensionId)

      if (result.success && result.extension) {
        get().updateInstalledExtension(extensionId, result.extension)
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[Extensions]', 'Failed to rollback extension', { extensionId, error: message })
      return { success: false, error: message }
    }
  },

  checkForUpdates: async () => {
    const { setCheckingUpdates, setAvailableUpdates } = get()

    try {
      setCheckingUpdates(true)

      const api = window.electronAPI?.extensions
      if (!api) {
        log.warn('[Extensions]', 'Extensions API not available')
        return
      }

      const updates = await api.checkUpdates()
      setAvailableUpdates(updates)
      set({ lastUpdateCheck: Date.now() })

      log.info('[Extensions]', 'Checked for updates', { count: updates.length })
    } catch (error) {
      log.error('[Extensions]', 'Failed to check for updates', { error: error })
    } finally {
      setCheckingUpdates(false)
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Getters
  // ═══════════════════════════════════════════════════════════════════════════

  getExtension: (extensionId: string) => {
    return get().installedExtensions[extensionId]
  },

  getActiveExtensions: () => {
    return Object.values(get().installedExtensions).filter((ext) => ext.state === 'active')
  },

  isExtensionInstalled: (extensionId: string) => {
    return extensionId in get().installedExtensions
  },

  hasUpdate: (extensionId: string) => {
    return get().availableUpdates.some((u) => u.extensionId === extensionId)
  },

  getUpdateInfo: (extensionId: string) => {
    return get().availableUpdates.find((u) => u.extensionId === extensionId)
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Reset
  // ═══════════════════════════════════════════════════════════════════════════

  clearExtensionsState: () => {
    set(initialState)
  },
})
