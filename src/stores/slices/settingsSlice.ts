import { StateCreator } from 'zustand'
import type {
  PDMStoreState,
  SettingsSlice,
  ColumnConfig,
  CardViewFieldConfig,
  ColorSwatch,
  ThemeMode,
  Language,
} from '../types'
import type { KeybindingAction, Keybinding, KeybindingsConfig } from '../../types/settings'
import { supabase } from '../../lib/supabase'

const defaultColumns: ColumnConfig[] = [
  { id: 'name', label: 'Name', width: 280, visible: true, sortable: true },
  { id: 'fileStatus', label: 'File Status', width: 100, visible: false, sortable: true },
  { id: 'checkedOutBy', label: 'Checked Out By', width: 150, visible: false, sortable: true },
  { id: 'version', label: 'Ver', width: 60, visible: true, sortable: true },
  { id: 'itemNumber', label: 'Item Number', width: 120, visible: true, sortable: true },
  { id: 'tabNumber', label: 'Tab', width: 80, visible: false, sortable: true },
  { id: 'description', label: 'Description', width: 200, visible: true, sortable: true },
  { id: 'revision', label: 'Rev', width: 50, visible: true, sortable: true },
  { id: 'state', label: 'State', width: 130, visible: true, sortable: true },
  { id: 'ecoTags', label: 'ECOs', width: 120, visible: true, sortable: true },
  { id: 'extension', label: 'Type', width: 70, visible: true, sortable: true },
  { id: 'size', label: 'Size', width: 80, visible: true, sortable: true },
  { id: 'modifiedTime', label: 'Modified', width: 140, visible: true, sortable: true },
]

// Default card view fields (for icon/grid view)
const defaultCardViewFields: CardViewFieldConfig[] = [
  { id: 'itemNumber', label: 'Item Number', visible: true },
  { id: 'description', label: 'Description', visible: true },
  { id: 'revision', label: 'Revision', visible: true },
  { id: 'version', label: 'Version', visible: true },
  { id: 'state', label: 'State', visible: false }, // Already shown as badge
  { id: 'ecoTags', label: 'ECOs', visible: false },
  { id: 'tabNumber', label: 'Tab Number', visible: false },
  { id: 'checkedOutBy', label: 'Checked Out By', visible: false },
  { id: 'size', label: 'Size', visible: false },
  { id: 'modifiedTime', label: 'Modified', visible: false },
]

const defaultKeybindings: KeybindingsConfig = {
  navigateUp: { key: 'ArrowUp' },
  navigateDown: { key: 'ArrowDown' },
  expandFolder: { key: 'ArrowRight' },
  collapseFolder: { key: 'ArrowLeft' },
  selectAll: { key: 'a', ctrlKey: true },
  copy: { key: 'c', ctrlKey: true },
  cut: { key: 'x', ctrlKey: true },
  paste: { key: 'v', ctrlKey: true },
  delete: { key: 'Delete' },
  escape: { key: 'Escape' },
  openFile: { key: 'Enter' },
  toggleDetailsPanel: { key: 'p', ctrlKey: true },
  refresh: { key: 'r', ctrlKey: true },
}

export const createSettingsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  SettingsSlice
> = (set, get) => ({
  // Initial state - Preview & Topbar
  cadPreviewMode: 'thumbnail',
  topbarConfig: {
    showFps: false,
    showZoom: true,
    showOrg: true,
    showSearch: true,
    showOnlineUsers: true,
    showSolidworks: true,
    showUserName: true,
    showPanelToggles: true,
  },

  // Initial state - SolidWorks
  solidworksIntegrationEnabled: true,
  solidworksPath: null,
  solidworksDmLicenseKey: null,
  autoStartSolidworksService: true,
  hideSolidworksTempFiles: true,
  ignoreSolidworksTempFiles: true,
  // Drawing metadata lockouts - when ON, drawing fields are read-only (inherited from model)
  lockDrawingRevision: true,
  lockDrawingItemNumber: true,
  lockDrawingDescription: true,
  // Service logging - OFF by default
  solidworksServiceVerboseLogging: false,

  // Initial state - API Server
  apiServerUrl: null,

  // Initial state - Display
  lowercaseExtensions: true,
  viewMode: 'list',
  iconSize: 96,
  listRowSize: 16,
  treeRowSize: 18,
  theme: 'dark',
  autoApplySeasonalThemes: true,
  language: 'en',
  keybindings: defaultKeybindings,

  // Initial state - Tree Filtering
  hideCloudOnlyFolders: false, // Show all folders by default

  // Initial state - Theme Effects
  christmasSnowOpacity: 40,
  christmasSnowDensity: 100,
  christmasSnowSize: 55,
  christmasBlusteryness: 30,
  christmasUseLocalWeather: true,
  christmasSleighEnabled: true,
  christmasSleighDirection: 'push',
  halloweenSparksEnabled: true,
  halloweenSparksOpacity: 70,
  halloweenSparksSpeed: 40,
  halloweenGhostsOpacity: 30,
  weatherRainOpacity: 60,
  weatherRainDensity: 80,
  weatherSnowOpacity: 70,
  weatherSnowDensity: 60,
  weatherEffectsEnabled: true,

  // Initial state - Auto-download
  autoDownloadCloudFiles: false,
  autoDownloadUpdates: false,
  autoDownloadSizeLimit: 1024, // Default: 1 GB (1024 MB) - 0 means no limit
  autoDownloadExcludedFiles: {},

  // Initial state - Auto-discard orphaned files
  autoDiscardOrphanedFiles: true, // Default: ON - automatically remove local files that no longer exist on server

  // Initial state - Upload warnings
  uploadSizeWarningEnabled: true, // Warn by default
  uploadSizeWarningThreshold: 100, // Default: 100 MB

  // Initial state - Pinned items
  pinnedFolders: [],
  pinnedSectionExpanded: true,

  // Initial state - Color swatches
  colorSwatches: [],
  orgColorSwatches: [],

  // Initial state - Columns
  columns: defaultColumns,
  columnConfigLastSyncedAt: null,

  // Initial state - Card View Fields
  cardViewFields: defaultCardViewFields,

  // Initial state - Onboarding
  onboardingComplete: false,
  logSharingEnabled: true,

  // Initial state - Windows Defender warning
  avExclusionWarningDismissed: false,

  // Initial state - Test Runner
  testFolderName: '0 - Tests',

  // Actions - Preview & Topbar
  setCadPreviewMode: (cadPreviewMode) => set({ cadPreviewMode }),
  setTopbarConfig: (config) => set((s) => ({ topbarConfig: { ...s.topbarConfig, ...config } })),

  // Actions - SolidWorks
  setSolidworksIntegrationEnabled: (solidworksIntegrationEnabled) =>
    set({ solidworksIntegrationEnabled }),
  setSolidworksPath: (solidworksPath) => set({ solidworksPath }),
  setSolidworksDmLicenseKey: (solidworksDmLicenseKey) => set({ solidworksDmLicenseKey }),
  setAutoStartSolidworksService: (autoStartSolidworksService) =>
    set({ autoStartSolidworksService }),
  setHideSolidworksTempFiles: (hideSolidworksTempFiles) => set({ hideSolidworksTempFiles }),
  setIgnoreSolidworksTempFiles: (ignoreSolidworksTempFiles) => set({ ignoreSolidworksTempFiles }),
  setLockDrawingRevision: (lockDrawingRevision) => set({ lockDrawingRevision }),
  setLockDrawingItemNumber: (lockDrawingItemNumber) => set({ lockDrawingItemNumber }),
  setLockDrawingDescription: (lockDrawingDescription) => set({ lockDrawingDescription }),
  setSolidworksServiceVerboseLogging: (solidworksServiceVerboseLogging) =>
    set({ solidworksServiceVerboseLogging }),

  // Actions - API Server
  setApiServerUrl: (apiServerUrl) => set({ apiServerUrl }),

  // Actions - Display
  setLowercaseExtensions: (lowercaseExtensions) => set({ lowercaseExtensions }),
  setViewMode: (viewMode) => set({ viewMode }),
  setIconSize: (iconSize) => set({ iconSize: Math.max(48, Math.min(256, iconSize)) }),
  setListRowSize: (listRowSize) => set({ listRowSize: Math.max(16, Math.min(64, listRowSize)) }),
  setTreeRowSize: (treeRowSize) => set({ treeRowSize: Math.max(16, Math.min(64, treeRowSize)) }),
  setTheme: (theme: ThemeMode) => set({ theme }),
  setAutoApplySeasonalThemes: (autoApplySeasonalThemes) => set({ autoApplySeasonalThemes }),
  setLanguage: (language: Language) => set({ language }),
  setKeybinding: (action: KeybindingAction, keybinding: Keybinding) =>
    set((state) => ({
      keybindings: { ...state.keybindings, [action]: keybinding },
    })),
  resetKeybindings: () => set({ keybindings: defaultKeybindings }),

  // Actions - Tree Filtering
  setHideCloudOnlyFolders: (hideCloudOnlyFolders) => set({ hideCloudOnlyFolders }),

  // Actions - Theme Effects
  setChristmasSnowOpacity: (christmasSnowOpacity) => set({ christmasSnowOpacity }),
  setChristmasSnowDensity: (christmasSnowDensity) => set({ christmasSnowDensity }),
  setChristmasSnowSize: (christmasSnowSize) => set({ christmasSnowSize }),
  setChristmasBlusteryness: (christmasBlusteryness) => set({ christmasBlusteryness }),
  setChristmasUseLocalWeather: (christmasUseLocalWeather) => set({ christmasUseLocalWeather }),
  setChristmasSleighEnabled: (christmasSleighEnabled) => set({ christmasSleighEnabled }),
  setChristmasSleighDirection: (christmasSleighDirection) => set({ christmasSleighDirection }),
  setHalloweenSparksEnabled: (halloweenSparksEnabled) => set({ halloweenSparksEnabled }),
  setHalloweenSparksOpacity: (halloweenSparksOpacity) => set({ halloweenSparksOpacity }),
  setHalloweenSparksSpeed: (halloweenSparksSpeed) => set({ halloweenSparksSpeed }),
  setHalloweenGhostsOpacity: (halloweenGhostsOpacity) => set({ halloweenGhostsOpacity }),
  setWeatherRainOpacity: (weatherRainOpacity) => set({ weatherRainOpacity }),
  setWeatherRainDensity: (weatherRainDensity) => set({ weatherRainDensity }),
  setWeatherSnowOpacity: (weatherSnowOpacity) => set({ weatherSnowOpacity }),
  setWeatherSnowDensity: (weatherSnowDensity) => set({ weatherSnowDensity }),
  setWeatherEffectsEnabled: (weatherEffectsEnabled) => set({ weatherEffectsEnabled }),

  // Actions - Auto-download
  setAutoDownloadCloudFiles: (autoDownloadCloudFiles) => set({ autoDownloadCloudFiles }),
  setAutoDownloadUpdates: (autoDownloadUpdates) => set({ autoDownloadUpdates }),
  setAutoDownloadSizeLimit: (autoDownloadSizeLimit) =>
    set({ autoDownloadSizeLimit: Math.max(0, autoDownloadSizeLimit) }),

  // Actions - Auto-discard orphaned files
  setAutoDiscardOrphanedFiles: (autoDiscardOrphanedFiles) => set({ autoDiscardOrphanedFiles }),

  // Actions - Upload warnings
  setUploadSizeWarningEnabled: (uploadSizeWarningEnabled) => set({ uploadSizeWarningEnabled }),
  setUploadSizeWarningThreshold: (uploadSizeWarningThreshold) =>
    set({ uploadSizeWarningThreshold: Math.max(1, uploadSizeWarningThreshold) }),

  addAutoDownloadExclusion: (vaultId, relativePath) =>
    set((state) => {
      const currentExclusions = state.autoDownloadExcludedFiles[vaultId] || []
      // Don't add duplicates
      if (currentExclusions.includes(relativePath)) return state
      return {
        autoDownloadExcludedFiles: {
          ...state.autoDownloadExcludedFiles,
          [vaultId]: [...currentExclusions, relativePath],
        },
      }
    }),
  removeAutoDownloadExclusion: (vaultId, relativePath) =>
    set((state) => {
      const currentExclusions = state.autoDownloadExcludedFiles[vaultId] || []
      return {
        autoDownloadExcludedFiles: {
          ...state.autoDownloadExcludedFiles,
          [vaultId]: currentExclusions.filter((p) => p !== relativePath),
        },
      }
    }),
  clearAutoDownloadExclusions: (vaultId) =>
    set((state) => ({
      autoDownloadExcludedFiles: {
        ...state.autoDownloadExcludedFiles,
        [vaultId]: [],
      },
    })),
  cleanupStaleExclusions: (vaultId, serverFilePaths) =>
    set((state) => {
      const currentExclusions = state.autoDownloadExcludedFiles[vaultId] || []
      // Keep only exclusions for files that still exist on the server
      const validExclusions = currentExclusions.filter((path) => serverFilePaths.has(path))
      // Only update if something changed
      if (validExclusions.length === currentExclusions.length) return state
      return {
        autoDownloadExcludedFiles: {
          ...state.autoDownloadExcludedFiles,
          [vaultId]: validExclusions,
        },
      }
    }),

  // Actions - Pinned items
  pinFolder: (path, vaultId, vaultName, isDirectory) => {
    const { pinnedFolders } = get()
    // Don't add duplicates
    if (pinnedFolders.some((p) => p.path === path && p.vaultId === vaultId)) return
    set({ pinnedFolders: [...pinnedFolders, { path, vaultId, vaultName, isDirectory }] })
  },
  unpinFolder: (path) => {
    const { pinnedFolders } = get()
    set({ pinnedFolders: pinnedFolders.filter((p) => p.path !== path) })
  },
  togglePinnedSection: () => {
    const { pinnedSectionExpanded } = get()
    set({ pinnedSectionExpanded: !pinnedSectionExpanded })
  },
  reorderPinnedFolders: (fromIndex, toIndex) => {
    const { pinnedFolders } = get()
    const newPinned = [...pinnedFolders]
    const [removed] = newPinned.splice(fromIndex, 1)
    newPinned.splice(toIndex, 0, removed)
    set({ pinnedFolders: newPinned })
  },

  // Actions - Color Swatches
  addColorSwatch: async (color, isOrg) => {
    const { user, organization, addToast, getEffectiveRole } = get()
    if (!user) {
      addToast('error', 'You must be logged in to save colors')
      return
    }

    // Only admins can add org swatches
    if (isOrg && getEffectiveRole() !== 'admin') {
      addToast('error', 'Only admins can add organization colors')
      return
    }

    // For org swatches, need organization
    if (isOrg && !organization?.id) {
      addToast('error', 'No organization found')
      return
    }

    // Insert to database (let DB generate UUID)
    try {
      const insertData = isOrg
        ? {
            color,
            org_id: organization!.id,
            user_id: null,
            created_by: user.id,
          }
        : {
            color,
            org_id: null,
            user_id: user.id,
            created_by: user.id,
          }

      const { data, error } = await supabase
        .from('color_swatches')
        .insert(insertData as never)
        .select('id, color, created_at')
        .single()

      if (error) {
        addToast('error', `Failed to save color: ${error.message}`)
        return
      }

      // Add to local state with the DB-generated ID
      const swatchData = data as { id: string; color: string; created_at: string }
      const newSwatch: ColorSwatch = {
        id: swatchData.id,
        color: swatchData.color,
        isOrg,
        createdAt: swatchData.created_at,
      }

      if (isOrg) {
        set({ orgColorSwatches: [...get().orgColorSwatches, newSwatch] })
      } else {
        set({ colorSwatches: [...get().colorSwatches, newSwatch] })
      }

      addToast('success', isOrg ? 'Color saved for organization' : 'Color saved')
    } catch (error) {
      addToast('error', 'Failed to save color')
    }
  },

  removeColorSwatch: async (swatchId) => {
    const { colorSwatches, orgColorSwatches, addToast, getEffectiveRole } = get()

    // Find the swatch
    const userSwatch = colorSwatches.find((s) => s.id === swatchId)
    const orgSwatch = orgColorSwatches.find((s) => s.id === swatchId)

    if (orgSwatch && getEffectiveRole() !== 'admin') {
      addToast('error', 'Only admins can remove organization colors')
      return
    }

    // Remove from local state immediately
    if (userSwatch) {
      set({ colorSwatches: colorSwatches.filter((s) => s.id !== swatchId) })
    } else if (orgSwatch) {
      set({ orgColorSwatches: orgColorSwatches.filter((s) => s.id !== swatchId) })
    }

    // Sync to database
    try {
      const { error } = await supabase.from('color_swatches').delete().eq('id', swatchId)

      if (error) {
        // Rollback on error
        if (userSwatch) {
          set({ colorSwatches: [...get().colorSwatches, userSwatch] })
        } else if (orgSwatch) {
          set({ orgColorSwatches: [...get().orgColorSwatches, orgSwatch] })
        }
      }
    } catch (error) {}
  },

  loadOrgColorSwatches: async () => {
    const { organization } = get()
    if (!organization?.id) return

    try {
      const { data, error } = await supabase
        .from('color_swatches')
        .select('id, color, created_at')
        .eq('org_id', organization.id)
        .order('created_at', { ascending: true })

      if (error) throw error

      const swatches = (data || []) as { id: string; color: string; created_at: string }[]
      set({
        orgColorSwatches: swatches.map((s) => ({
          id: s.id,
          color: s.color,
          isOrg: true,
          createdAt: s.created_at,
        })),
      })
    } catch (error) {}
  },

  syncColorSwatches: async () => {
    const { user, organization } = get()
    if (!user) return

    try {
      // Load user's personal swatches
      const { data: userSwatches, error: userError } = await supabase
        .from('color_swatches')
        .select('id, color, created_at')
        .eq('user_id', user.id)
        .is('org_id', null)
        .order('created_at', { ascending: true })

      if (userError) throw userError

      const userSwatchData = (userSwatches || []) as {
        id: string
        color: string
        created_at: string
      }[]
      set({
        colorSwatches: userSwatchData.map((s) => ({
          id: s.id,
          color: s.color,
          isOrg: false,
          createdAt: s.created_at,
        })),
      })

      // Load org swatches
      if (organization?.id) {
        const { data: orgSwatches, error: orgError } = await supabase
          .from('color_swatches')
          .select('id, color, created_at')
          .eq('org_id', organization.id)
          .order('created_at', { ascending: true })

        if (orgError) throw orgError

        const orgSwatchData = (orgSwatches || []) as {
          id: string
          color: string
          created_at: string
        }[]
        set({
          orgColorSwatches: orgSwatchData.map((s) => ({
            id: s.id,
            color: s.color,
            isOrg: true,
            createdAt: s.created_at,
          })),
        })
      }
    } catch (error) {}
  },

  // Actions - Columns
  setColumnWidth: (id, width) => {
    const { columns } = get()
    set({
      columns: columns.map((c) => (c.id === id ? { ...c, width: Math.max(40, width) } : c)),
    })
  },
  toggleColumnVisibility: (id) => {
    const { columns } = get()
    set({
      columns: columns.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
    })
  },
  reorderColumns: (columns) => set({ columns }),

  saveOrgColumnDefaults: async () => {
    const { organization, columns, getEffectiveRole } = get()
    if (!organization?.id) {
      return { success: false, error: 'No organization connected' }
    }
    if (getEffectiveRole() !== 'admin') {
      return { success: false, error: 'Only admins can save org defaults' }
    }

    try {
      // Save column configs (just id, width, visible - not label/sortable which are fixed)
      const columnDefaults = columns.map((c) => ({
        id: c.id,
        width: c.width,
        visible: c.visible,
      }))

      const { error } = await (supabase.rpc as any)('set_org_column_defaults', { // TODO: type this
        p_org_id: organization.id,
        p_column_defaults: columnDefaults,
      })

      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  loadOrgColumnDefaults: async () => {
    const { organization, columns } = get()
    if (!organization?.id) {
      return { success: false, error: 'No organization connected' }
    }

    try {
      const { data, error } = await (supabase.rpc as any)('get_org_column_defaults', { // TODO: type this
        p_org_id: organization.id,
      })

      if (error) throw error

      if (!data || !Array.isArray(data) || data.length === 0) {
        return { success: false, error: 'No org defaults configured' }
      }

      // Rebuild columns in saved order (preserving label/sortable from current config)
      const savedIds = new Set(data.map((d: { id: string }) => d.id))
      const orderedColumns: ColumnConfig[] = []

      for (const saved of data as Array<{ id: string; width?: number; visible?: boolean }>) {
        const local = columns.find((c) => c.id === saved.id)
        if (local) {
          orderedColumns.push({
            ...local,
            width: saved.width ?? local.width,
            visible: saved.visible ?? local.visible,
          })
        }
      }

      // Append any columns that exist locally but weren't in saved defaults (new columns)
      for (const col of columns) {
        if (!savedIds.has(col.id)) {
          orderedColumns.push(col)
        }
      }

      set({ columns: orderedColumns, columnConfigLastSyncedAt: Date.now() })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  forceOrgColumnDefaults: async () => {
    const { organization, columns, getEffectiveRole } = get()
    if (!organization?.id) {
      return { success: false, error: 'No organization connected' }
    }
    if (getEffectiveRole() !== 'admin') {
      return { success: false, error: 'Only admins can force column defaults' }
    }

    try {
      const columnDefaults = columns.map((c) => ({
        id: c.id,
        width: c.width,
        visible: c.visible,
      }))

      const { error } = await (supabase.rpc as any)('force_org_column_defaults', { // TODO: type this
        p_org_id: organization.id,
        p_column_defaults: columnDefaults,
      })

      if (error) throw error
      set({ columnConfigLastSyncedAt: Date.now() })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  saveUserColumnDefaults: async () => {
    const { user, columns } = get()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    try {
      const columnDefaults = columns.map((c) => ({
        id: c.id,
        width: c.width,
        visible: c.visible,
      }))

      const { error } = await (supabase.rpc as any)('set_user_column_defaults', { // TODO: type this
        p_column_defaults: columnDefaults,
      })

      if (error) throw error
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  loadUserColumnDefaults: async () => {
    const { user, columns } = get()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    try {
      const { data, error } = await (supabase.rpc as any)('get_user_column_defaults', {}) // TODO: type this

      if (error) throw error

      if (!data || !Array.isArray(data) || data.length === 0) {
        return { success: false, error: 'No personal defaults saved' }
      }

      // Rebuild columns in saved order (preserving label/sortable from current config)
      const savedIds = new Set(data.map((d: { id: string }) => d.id))
      const orderedColumns: ColumnConfig[] = []

      for (const saved of data as Array<{ id: string; width?: number; visible?: boolean }>) {
        const local = columns.find((c) => c.id === saved.id)
        if (local) {
          orderedColumns.push({
            ...local,
            width: saved.width ?? local.width,
            visible: saved.visible ?? local.visible,
          })
        }
      }

      for (const col of columns) {
        if (!savedIds.has(col.id)) {
          orderedColumns.push(col)
        }
      }

      set({ columns: orderedColumns, columnConfigLastSyncedAt: Date.now() })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  },

  resetColumnsToDefaults: () => {
    set({ columns: defaultColumns })
  },

  // Actions - Card View Fields
  toggleCardViewFieldVisibility: (id) => {
    const { cardViewFields } = get()
    set({
      cardViewFields: cardViewFields.map((f) => (f.id === id ? { ...f, visible: !f.visible } : f)),
    })
  },
  reorderCardViewFields: (fields) => set({ cardViewFields: fields }),
  resetCardViewFieldsToDefaults: () => {
    set({ cardViewFields: defaultCardViewFields })
  },

  // Actions - Onboarding
  completeOnboarding: (options) =>
    set({
      onboardingComplete: true,
      // Note: auto-download settings are NOT force-enabled here anymore.
      // They default to false and should only be enabled via VaultSetupDialog or Settings.
      // Previously this was overriding user preferences made during vault setup.
      autoStartSolidworksService: options?.solidworksIntegrationEnabled ?? true,
      solidworksIntegrationEnabled: options?.solidworksIntegrationEnabled ?? true,
    }),
  setLogSharingEnabled: (logSharingEnabled) => set({ logSharingEnabled }),

  // Actions - Windows Defender warning
  setAvExclusionWarningDismissed: (avExclusionWarningDismissed) =>
    set({ avExclusionWarningDismissed }),

  // Actions - Test Runner
  setTestFolderName: (testFolderName) => set({ testFolderName }),
})

// Export for use in main store
export { defaultColumns, defaultCardViewFields }
