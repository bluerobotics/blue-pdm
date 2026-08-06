/**
 * PDM Store - Main Zustand store for BluePLM
 *
 * This file combines all slices into a single store with persistence.
 * See ./slices/ for individual slice implementations.
 *
 * ## Hydration
 *
 * The store uses Zustand's `persist` middleware which hydrates asynchronously
 * from localStorage. Components that depend on persisted values (like auto-start
 * settings) should wait for hydration using the `useHasHydrated()` hook before
 * acting on those values.
 */
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModuleId, ModuleGroupId, ModuleConfig, SectionDivider } from '../types/modules'
import { getDefaultModuleConfig, MODULES, getChildModules } from '../types/modules'
import type { KeybindingsConfig, SettingsTab } from '../types/settings'
import type {
  PDMStoreState,
  Tab,
  ConnectedVault,
  StagedCheckin,
  PendingMetadata,
  ThemeMode,
  Language,
  CardViewFieldConfig,
  SidebarView,
} from './types'
import { CURRENT_STORE_VERSION, runMigrations, getPersistedVersion } from './migrations'

/**
 * Hydration state - tracks whether the store has finished loading from localStorage.
 * This is separate from the main store to avoid circular dependencies and allow
 * synchronous access without store subscriptions.
 */
let storeHasHydrated = false

// Re-export all types from the types file for backward compatibility
export * from './types'

// Import all slice creators
import {
  createToastsSlice,
  createUpdateSlice,
  createUISlice,
  createSettingsSlice,
  createUserSlice,
  createVaultsSlice,
  createFilesSlice,
  createModulesSlice,
  createTabsSlice,
  createOperationsSlice,
  createWorkflowsSlice,
  createSuppliersSlice,
  createECOsSlice,
  createOrganizationDataSlice,
  createOrganizationMetadataSlice,
  createIntegrationsSlice,
  createExtensionsSlice,
  createOperationLogSlice,
  createAnnotationsSlice,
  createItemBrowserSlice,
  createCustomersSlice,
} from './slices'
import { defaultCardViewFields } from './slices/settingsSlice'

// Create the combined store
export const usePDMStore = create<PDMStoreState>()(
  persist(
    (...a) => ({
      ...createToastsSlice(...a),
      ...createUpdateSlice(...a),
      ...createUISlice(...a),
      ...createSettingsSlice(...a),
      ...createUserSlice(...a),
      ...createVaultsSlice(...a),
      ...createFilesSlice(...a),
      ...createModulesSlice(...a),
      ...createTabsSlice(...a),
      ...createOperationsSlice(...a),
      ...createWorkflowsSlice(...a),
      ...createSuppliersSlice(...a),
      ...createECOsSlice(...a),
      ...createOrganizationDataSlice(...a),
      ...createOrganizationMetadataSlice(...a),
      ...createIntegrationsSlice(...a),
      ...createExtensionsSlice(...a),
      ...createOperationLogSlice(...a),
      ...createAnnotationsSlice(...a),
      ...createItemBrowserSlice(...a),
      ...createCustomersSlice(...a),
    }),
    {
      name: 'blue-plm-storage',
      partialize: (state) => ({
        // ═══════════════════════════════════════════════════════════════
        // Schema Version
        // ═══════════════════════════════════════════════════════════════
        _storeVersion: CURRENT_STORE_VERSION,

        // ═══════════════════════════════════════════════════════════════
        // Vault State
        // ═══════════════════════════════════════════════════════════════
        vaultPath: state.vaultPath,
        vaultName: state.vaultName,
        recentVaults: state.recentVaults,
        autoConnect: state.autoConnect,
        connectedVaults: state.connectedVaults,
        activeVaultId: state.activeVaultId,

        // ═══════════════════════════════════════════════════════════════
        // UI Layout
        // ═══════════════════════════════════════════════════════════════
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activityBarMode: state.activityBarMode,
        activeView: state.activeView,
        settingsTab: state.settingsTab,
        detailsPanelVisible: state.detailsPanelVisible,
        detailsPanelHeight: state.detailsPanelHeight,
        rightPanelVisible: state.rightPanelVisible,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelTabs: state.rightPanelTabs,
        bottomPanelTabOrder: state.bottomPanelTabOrder,

        // ═══════════════════════════════════════════════════════════════
        // Tabs & Navigation
        // ═══════════════════════════════════════════════════════════════
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        tabGroups: state.tabGroups,
        tabsEnabled: state.tabsEnabled,
        currentFolder: state.currentFolder,
        expandedFolders: Array.from(state.expandedFolders),
        expandedPendingSections: Array.from(state.expandedPendingSections),

        // ═══════════════════════════════════════════════════════════════
        // Display Preferences
        // ═══════════════════════════════════════════════════════════════
        viewMode: state.viewMode,
        iconSize: state.iconSize,
        listRowSize: state.listRowSize,
        treeRowSize: state.treeRowSize,
        columns: state.columns,
        columnConfigLastSyncedAt: state.columnConfigLastSyncedAt,
        cardViewFields: state.cardViewFields,
        lowercaseExtensions: state.lowercaseExtensions,
        itemViewMode: state.itemViewMode,
        itemListRowSize: state.itemListRowSize,
        itemIconSize: state.itemIconSize,
        itemColumns: state.itemColumns,
        // Only the tab: customer filters are intentionally session-scoped,
        // see DEFAULT_CUSTOMER_FILTERS in slices/customersSlice.ts
        customersTab: state.customersTab,

        // ═══════════════════════════════════════════════════════════════
        // Theme & Appearance
        // ═══════════════════════════════════════════════════════════════
        theme: state.theme,
        autoApplySeasonalThemes: state.autoApplySeasonalThemes,
        language: state.language,

        // ═══════════════════════════════════════════════════════════════
        // Theme Effects (Christmas)
        // ═══════════════════════════════════════════════════════════════
        christmasSnowOpacity: state.christmasSnowOpacity,
        christmasSnowDensity: state.christmasSnowDensity,
        christmasSnowSize: state.christmasSnowSize,
        christmasBlusteryness: state.christmasBlusteryness,
        christmasUseLocalWeather: state.christmasUseLocalWeather,
        christmasSleighEnabled: state.christmasSleighEnabled,
        christmasSleighDirection: state.christmasSleighDirection,

        // ═══════════════════════════════════════════════════════════════
        // Theme Effects (Halloween)
        // ═══════════════════════════════════════════════════════════════
        halloweenSparksEnabled: state.halloweenSparksEnabled,
        halloweenSparksOpacity: state.halloweenSparksOpacity,
        halloweenSparksSpeed: state.halloweenSparksSpeed,
        halloweenGhostsOpacity: state.halloweenGhostsOpacity,

        // ═══════════════════════════════════════════════════════════════
        // Integrations
        // ═══════════════════════════════════════════════════════════════
        solidworksIntegrationEnabled: state.solidworksIntegrationEnabled,
        solidworksPath: state.solidworksPath,
        solidworksDmLicenseKey: state.solidworksDmLicenseKey,
        solidworksProgId: state.solidworksProgId,
        autoStartSolidworksService: state.autoStartSolidworksService,
        hideSolidworksTempFiles: state.hideSolidworksTempFiles,
        ignoreSolidworksTempFiles: state.ignoreSolidworksTempFiles,
        lockDrawingRevision: state.lockDrawingRevision,
        lockDrawingItemNumber: state.lockDrawingItemNumber,
        lockDrawingDescription: state.lockDrawingDescription,
        apiServerUrl: state.apiServerUrl,

        // ═══════════════════════════════════════════════════════════════
        // File Operations
        // ═══════════════════════════════════════════════════════════════
        autoDownloadCloudFiles: state.autoDownloadCloudFiles,
        autoDownloadUpdates: state.autoDownloadUpdates,
        autoDownloadExcludedFiles: state.autoDownloadExcludedFiles,
        autoDiscardOrphanedFiles: state.autoDiscardOrphanedFiles,
        ignorePatterns: state.ignorePatterns,
        stagedCheckins: state.stagedCheckins,
        persistedPendingMetadata: state.persistedPendingMetadata,
        persistedCopySource: state.persistedCopySource,

        // ═══════════════════════════════════════════════════════════════
        // User Preferences
        // ═══════════════════════════════════════════════════════════════
        onboardingComplete: state.onboardingComplete,
        logSharingEnabled: state.logSharingEnabled,
        cadPreviewMode: state.cadPreviewMode,
        topbarConfig: state.topbarConfig,
        keybindings: state.keybindings,
        pinnedFolders: state.pinnedFolders,
        pinnedSectionExpanded: state.pinnedSectionExpanded,
        colorSwatches: state.colorSwatches,
        hideCloudOnlyFolders: state.hideCloudOnlyFolders,

        // ═══════════════════════════════════════════════════════════════
        // Module Configuration
        // ═══════════════════════════════════════════════════════════════
        moduleConfig: state.moduleConfig,
        moduleConfigLastSyncedAt: state.moduleConfigLastSyncedAt,

        // ═══════════════════════════════════════════════════════════════
        // Terminal
        // ═══════════════════════════════════════════════════════════════
        terminalVisible: state.terminalVisible,
        terminalHeight: state.terminalHeight,
        terminalHistory: state.terminalHistory.slice(0, 100),

        // ═══════════════════════════════════════════════════════════════
        // Search
        // ═══════════════════════════════════════════════════════════════
        recentSearches: state.recentSearches.slice(0, 20),

        // ═══════════════════════════════════════════════════════════════
        // Test Runner
        // ═══════════════════════════════════════════════════════════════
        testFolderName: state.testFolderName,
      }),
      /**
       * Called when hydration starts and finishes.
       * We track completion to allow components to wait for persisted values.
       */
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
          } else {
          }
          // Mark hydration as complete regardless of error
          // Components should handle missing/default values gracefully
          storeHasHydrated = true
        }
      },
      merge: (persistedState, currentState) => {
        const rawPersisted = persistedState as Record<string, unknown>

        // Run any necessary migrations
        const persistedVersion = getPersistedVersion(rawPersisted)
        const persisted =
          persistedVersion < CURRENT_STORE_VERSION
            ? runMigrations(rawPersisted, persistedVersion)
            : rawPersisted

        // Deduplicate connected vaults by ID (keep first occurrence, ensure expanded)
        const persistedVaults = (persisted.connectedVaults as ConnectedVault[]) || []
        const seenIds = new Set<string>()
        const seenPaths = new Set<string>()
        const deduplicatedVaults = persistedVaults
          .filter((vault) => {
            if (!vault?.id || !vault?.localPath) return false
            const normalizedPath = vault.localPath.toLowerCase().replace(/\\/g, '/')
            if (seenIds.has(vault.id) || seenPaths.has(normalizedPath)) {
              return false
            }
            seenIds.add(vault.id)
            seenPaths.add(normalizedPath)
            return true
          })
          .map((vault) => ({
            ...vault,
            isExpanded: true, // Ensure vaults are expanded on load
          }))

        // Ensure activeVaultId points to a valid vault (might have been a removed duplicate)
        const persistedActiveVaultId = persisted.activeVaultId as string | null
        const validVaultIds = new Set(deduplicatedVaults.map((v) => v.id))
        const validActiveVaultId =
          persistedActiveVaultId && validVaultIds.has(persistedActiveVaultId)
            ? persistedActiveVaultId
            : deduplicatedVaults[0]?.id || null

        // Ensure vaultPath matches the active vault's path
        const activeVault = deduplicatedVaults.find((v) => v.id === validActiveVaultId)
        const validVaultPath = activeVault?.localPath || (persisted.vaultPath as string | null)

        // Ensure activeView is a valid module ID (not a group ID like 'group-source-files')
        const persistedActiveView = persisted.activeView as string | undefined
        const validModuleIds: Set<string> = new Set(MODULES.map((m) => m.id))
        let validActiveView: SidebarView = 'explorer'
        if (persistedActiveView && validModuleIds.has(persistedActiveView)) {
          validActiveView = persistedActiveView as SidebarView
        } else if (persistedActiveView?.startsWith('group-')) {
          const children = getChildModules(persistedActiveView, getDefaultModuleConfig())
          validActiveView = (children[0]?.id ?? 'explorer') as SidebarView
        }

        return {
          ...currentState,
          ...persisted,
          // Use deduplicated vaults
          connectedVaults: deduplicatedVaults,
          // Use validated activeVaultId
          activeVaultId: validActiveVaultId,
          // Use validated vaultPath
          vaultPath: validVaultPath,
          // Use validated activeView (prevents group IDs like 'group-source-files' from persisting)
          activeView: validActiveView,
          // Convert expandedFolders back to Set
          expandedFolders: new Set((persisted.expandedFolders as string[]) || []),
          // Convert expandedPendingSections back to Set
          expandedPendingSections: new Set((persisted.expandedPendingSections as string[]) || []),
          // Ensure cadPreviewMode has a default
          cadPreviewMode: (persisted.cadPreviewMode as 'thumbnail' | 'edrawings') || 'thumbnail',
          // Merge topbarConfig over defaults so newly added toggles (e.g. showSolidworks)
          // aren't left undefined for users with a pre-existing persisted config.
          topbarConfig: {
            ...currentState.topbarConfig,
            ...((persisted.topbarConfig as Partial<typeof currentState.topbarConfig>) || {}),
          },
          // Restore SolidWorks settings
          solidworksIntegrationEnabled:
            persisted.solidworksIntegrationEnabled !== undefined
              ? (persisted.solidworksIntegrationEnabled as boolean)
              : true, // Default enabled, onboarding will auto-detect
          solidworksPath: (persisted.solidworksPath as string | null) || null,
          solidworksDmLicenseKey: (persisted.solidworksDmLicenseKey as string | null) || null,
          solidworksProgId: (persisted.solidworksProgId as string | null) || null,
          autoStartSolidworksService: (persisted.autoStartSolidworksService as boolean) ?? true,
          hideSolidworksTempFiles:
            persisted.hideSolidworksTempFiles !== undefined
              ? (persisted.hideSolidworksTempFiles as boolean)
              : true,
          ignoreSolidworksTempFiles:
            persisted.ignoreSolidworksTempFiles !== undefined
              ? (persisted.ignoreSolidworksTempFiles as boolean)
              : true,
          // Drawing field lockouts - default to true (locked) for new installs
          lockDrawingRevision:
            persisted.lockDrawingRevision !== undefined
              ? (persisted.lockDrawingRevision as boolean)
              : true,
          lockDrawingItemNumber:
            persisted.lockDrawingItemNumber !== undefined
              ? (persisted.lockDrawingItemNumber as boolean)
              : true,
          lockDrawingDescription:
            persisted.lockDrawingDescription !== undefined
              ? (persisted.lockDrawingDescription as boolean)
              : true,
          // API Server URL - keep persisted value until org settings sync
          // The ApiSettings component will sync from org.settings.api_url when organization loads
          apiServerUrl: (persisted.apiServerUrl as string | null) || null,
          // Ensure lowercaseExtensions has a default (true)
          lowercaseExtensions:
            persisted.lowercaseExtensions !== undefined
              ? (persisted.lowercaseExtensions as boolean)
              : true,
          // Ensure viewMode has a default
          viewMode: (persisted.viewMode as 'list' | 'icons') || 'list',
          // Ensure iconSize has a default
          iconSize: (persisted.iconSize as number) || 96,
          // Ensure listRowSize has a default
          listRowSize: (persisted.listRowSize as number) || 24,
          treeRowSize: (persisted.treeRowSize as number) || 24,
          // Ensure theme has a default
          theme: (persisted.theme as ThemeMode) || 'dark',
          // Restore autoApplySeasonalThemes (default to true)
          autoApplySeasonalThemes:
            persisted.autoApplySeasonalThemes !== undefined
              ? (persisted.autoApplySeasonalThemes as boolean)
              : true,
          // Ensure language has a default
          language: (persisted.language as Language) || 'en',
          // Restore hideCloudOnlyFolders (default to false - show all folders)
          hideCloudOnlyFolders:
            persisted.hideCloudOnlyFolders !== undefined
              ? (persisted.hideCloudOnlyFolders as boolean)
              : false,
          // Ensure settingsTab has a default
          settingsTab: (persisted.settingsTab as SettingsTab) || 'profile',
          // Ensure keybindings has defaults (merge with defaults for new keybindings)
          keybindings: Object.assign(
            {
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
            },
            (persisted.keybindings as KeybindingsConfig) || {},
          ),
          // Ensure onboarding state has defaults
          onboardingComplete: (persisted.onboardingComplete as boolean) || false,
          logSharingEnabled: (persisted.logSharingEnabled as boolean) || false,
          // Ensure auto-download settings have defaults
          autoDownloadCloudFiles: (persisted.autoDownloadCloudFiles as boolean) || false,
          autoDownloadUpdates: (persisted.autoDownloadUpdates as boolean) || false,
          autoDownloadExcludedFiles:
            (persisted.autoDownloadExcludedFiles as Record<string, string[]>) || {},
          autoDiscardOrphanedFiles:
            persisted.autoDiscardOrphanedFiles !== undefined
              ? (persisted.autoDiscardOrphanedFiles as boolean)
              : true,
          // Ensure Christmas sleigh direction has default (new field for existing users)
          christmasSleighDirection:
            (persisted.christmasSleighDirection as 'push' | 'pull') || 'push',
          // Restore columns in the user's saved order (not the default order),
          // merging in any fixed fields (label/sortable) from the current defaults.
          // Widths/visibility come from the persisted config; new built-in columns
          // added since the user last saved are appended at the end.
          columns: (() => {
            const persistedColumns =
              (persisted.columns as typeof currentState.columns) || []
            const persistedIds = new Set(persistedColumns.map((c) => c.id))
            const ordered = persistedColumns
              .map((persistedCol) => {
                const defaultCol = currentState.columns.find((c) => c.id === persistedCol.id)
                return defaultCol ? { ...defaultCol, ...persistedCol } : null
              })
              .filter((c): c is (typeof currentState.columns)[number] => c !== null)
            for (const defaultCol of currentState.columns) {
              if (!persistedIds.has(defaultCol.id)) {
                ordered.push(defaultCol)
              }
            }
            return ordered.length > 0 ? ordered : currentState.columns
          })(),
          // Ensure cardViewFields have all fields (merge persisted with defaults for new fields)
          cardViewFields: defaultCardViewFields.map((defaultField) => {
            const persistedField = ((persisted.cardViewFields as CardViewFieldConfig[]) || []).find(
              (f) => f.id === defaultField.id,
            )
            return persistedField ? { ...defaultField, ...persistedField } : defaultField
          }),
          // Ensure ignorePatterns has a default
          ignorePatterns: (persisted.ignorePatterns as Record<string, string[]>) || {},
          // Restore persisted pending metadata
          persistedPendingMetadata:
            (persisted.persistedPendingMetadata as Record<string, PendingMetadata>) || {},
          // Restore persisted copy source info (for version history preservation on paste)
          persistedCopySource:
            (persisted.persistedCopySource as Record<
              string,
              { sourceFileId: string; version: number }
            >) || {},
          // Staged check-ins (offline mode)
          stagedCheckins: (persisted.stagedCheckins as StagedCheckin[]) || [],
          // Terminal settings
          terminalVisible: (persisted.terminalVisible as boolean) || false,
          terminalHeight: (persisted.terminalHeight as number) || 250,
          terminalHistory: (persisted.terminalHistory as string[]) || [],
          // Restore current folder - from persisted state or from active tab
          currentFolder: (() => {
            // First try to restore directly persisted currentFolder
            if (persisted.currentFolder && typeof persisted.currentFolder === 'string') {
              return persisted.currentFolder
            }
            // Fallback: try to get from active tab
            const persistedTabs = persisted.tabs as Tab[] | undefined
            const persistedActiveTabId = persisted.activeTabId as string | undefined
            if (persistedTabs && persistedActiveTabId) {
              const activeTab = persistedTabs.find((t) => t.id === persistedActiveTabId)
              if (activeTab?.folderPath) {
                return activeTab.folderPath
              }
            }
            return ''
          })(),
          // Module configuration - merge with defaults to handle new modules
          moduleConfig: (() => {
            const persistedConfig = persisted.moduleConfig as ModuleConfig | undefined
            const defaults = getDefaultModuleConfig()
            if (!persistedConfig) return defaults

            // Merge enabled modules (keep persisted values, add defaults for new modules)
            const enabledModules = { ...defaults.enabledModules }
            for (const [key, value] of Object.entries(persistedConfig.enabledModules || {})) {
              if (key in enabledModules) {
                enabledModules[key as ModuleId] = value as boolean
              }
            }

            // Merge enabled groups
            const enabledGroups = { ...defaults.enabledGroups }
            for (const [key, value] of Object.entries(persistedConfig.enabledGroups || {})) {
              if (key in enabledGroups) {
                enabledGroups[key as ModuleGroupId] = value as boolean
              }
            }

            // Module order - use persisted if valid, otherwise default
            let moduleOrder = defaults.moduleOrder
            if (persistedConfig.moduleOrder && Array.isArray(persistedConfig.moduleOrder)) {
              // Validate all modules exist
              const validOrder = persistedConfig.moduleOrder.filter((id: string) =>
                defaults.enabledModules.hasOwnProperty(id),
              )
              // Add any new modules that weren't in persisted order
              for (const id of defaults.moduleOrder) {
                if (!validOrder.includes(id)) {
                  validOrder.push(id)
                }
              }
              moduleOrder = validOrder as ModuleId[]
            }

            // Dividers - use persisted if valid, migrate old format if needed
            let dividers = defaults.dividers
            if (persistedConfig.dividers && Array.isArray(persistedConfig.dividers)) {
              // Check if this is old format (has afterGroup) or new format (has position)
              const hasOldFormat = persistedConfig.dividers.some(
                (d: any) => 'afterGroup' in d && !('position' in d),
              )

              if (hasOldFormat) {
                // Migrate from old format - just use defaults for now
                dividers = defaults.dividers
              } else {
                // New format - use persisted dividers
                dividers = persistedConfig.dividers.filter(
                  (d: SectionDivider) => typeof d.position === 'number',
                )
              }
            }

            // Module parents - start from defaults, overlay persisted values
            const moduleParents = { ...defaults.moduleParents }
            if (
              persistedConfig.moduleParents &&
              Object.keys(persistedConfig.moduleParents).length > 0
            ) {
              for (const [key, value] of Object.entries(persistedConfig.moduleParents)) {
                if (key in moduleParents) {
                  moduleParents[key as ModuleId] = value as ModuleId | null
                }
              }
            }

            // Module icon colors - merge with defaults
            const moduleIconColors = { ...defaults.moduleIconColors }
            if (persistedConfig.moduleIconColors) {
              for (const [key, value] of Object.entries(persistedConfig.moduleIconColors)) {
                if (key in moduleIconColors) {
                  moduleIconColors[key as ModuleId] = value as string | null
                }
              }
            }

            // Custom groups - use defaults if persisted is empty (migration from old format)
            // Also validate that all groups have proper names
            const customGroups =
              persistedConfig.customGroups && persistedConfig.customGroups.length > 0
                ? persistedConfig.customGroups.map((group) => ({
                    ...group,
                    // Ensure name exists - derive from ID if missing
                    name:
                      group.name ||
                      group.id
                        .replace('group-', '')
                        .split('-')
                        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' '),
                  }))
                : defaults.customGroups

            return {
              enabledModules,
              enabledGroups,
              moduleOrder,
              dividers,
              moduleParents,
              moduleIconColors,
              customGroups,
            }
          })(),
          // Module config sync timestamp (when user last synced org-forced config)
          moduleConfigLastSyncedAt: (persisted.moduleConfigLastSyncedAt as number | null) || null,
          // Column config sync timestamp (when user last synced org-forced column config)
          columnConfigLastSyncedAt: (persisted.columnConfigLastSyncedAt as number | null) || null,
          // Ensure there's always at least one tab
          tabs: (() => {
            const persistedTabs = persisted.tabs as Tab[] | undefined
            if (!persistedTabs || persistedTabs.length === 0) {
              return [
                {
                  id: 'default-tab',
                  title: activeVault?.name || 'Explorer',
                  folderPath: '',
                  panelState: {
                    sidebarVisible: true,
                    detailsPanelVisible: true,
                    rightPanelVisible: false,
                  },
                },
              ]
            }
            return persistedTabs
          })(),
          activeTabId: (() => {
            const persistedTabs = persisted.tabs as Tab[] | undefined
            const persistedActiveTabId = persisted.activeTabId as string | undefined
            if (!persistedTabs || persistedTabs.length === 0) {
              return 'default-tab'
            }
            // Ensure activeTabId points to a valid tab
            const validTabIds = new Set(persistedTabs.map((t) => t.id))
            if (persistedActiveTabId && validTabIds.has(persistedActiveTabId)) {
              return persistedActiveTabId
            }
            return persistedTabs[0]?.id || 'default-tab'
          })(),
        }
      },
    },
  ),
)

// Convenience hooks - kept for backward compatibility
export function useSelectedFiles() {
  return usePDMStore((s) => s.getSelectedFileObjects())
}

export function useVisibleFiles() {
  return usePDMStore((s) => s.getVisibleFiles())
}

/**
 * Hook to check if the Zustand store has completed hydration from localStorage.
 *
 * Use this when you need to wait for persisted values before taking action.
 * For example, the SolidWorks auto-start hook waits for hydration to ensure
 * it reads the user's actual preferences rather than defaults.
 *
 * @returns true if hydration is complete, false if still loading from localStorage
 *
 * @example
 * ```tsx
 * const hasHydrated = useHasHydrated()
 * const autoStart = usePDMStore(s => s.autoStartSolidworksService)
 *
 * useEffect(() => {
 *   if (!hasHydrated) return // Wait for real preferences
 *   if (autoStart) startService()
 * }, [hasHydrated, autoStart])
 * ```
 */
export function useHasHydrated(): boolean {
  // Use useSyncExternalStore for React 18+ concurrent mode safety
  // This ensures the component re-renders when hydration completes
  return useSyncExternalStore(
    // Subscribe: called when component mounts
    (callback: () => void) => {
      // If already hydrated, no need to subscribe
      if (storeHasHydrated) return () => {}

      // Poll for hydration completion (simple approach)
      // Zustand's persist middleware doesn't expose a subscription API
      const interval = setInterval(() => {
        if (storeHasHydrated) {
          callback()
          clearInterval(interval)
        }
      }, 50)

      return () => clearInterval(interval)
    },
    // getSnapshot: returns current hydration state
    () => storeHasHydrated,
    // getServerSnapshot: for SSR (not used in Electron, but required)
    () => true,
  )
}

/**
 * Synchronous check for hydration status.
 *
 * Prefer `useHasHydrated()` hook in React components for proper reactivity.
 * This is useful for non-React code or one-time checks.
 *
 * @returns true if hydration is complete
 */
export function getHasHydrated(): boolean {
  return storeHasHydrated
}
