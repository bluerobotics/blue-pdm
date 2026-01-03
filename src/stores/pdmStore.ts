/**
 * PDM Store - Main Zustand store for BluePLM
 * 
 * This file combines all slices into a single store with persistence.
 * See ./slices/ for individual slice implementations.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModuleId, ModuleGroupId, ModuleConfig, SectionDivider } from '../types/modules'
import { getDefaultModuleConfig } from '../types/modules'
import type { KeybindingsConfig } from '../types/settings'
import type { PDMStoreState, Tab, ConnectedVault, StagedCheckin, PendingMetadata, ThemeMode, Language } from './types'

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
} from './slices'

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
    }),
    {
      name: 'blue-plm-storage',
      partialize: (state) => ({
        vaultPath: state.vaultPath,
        vaultName: state.vaultName,
        recentVaults: state.recentVaults,
        autoConnect: state.autoConnect,
        onboardingComplete: state.onboardingComplete,
        logSharingEnabled: state.logSharingEnabled,
        cadPreviewMode: state.cadPreviewMode,
        topbarConfig: state.topbarConfig,
        solidworksIntegrationEnabled: state.solidworksIntegrationEnabled,
        solidworksPath: state.solidworksPath,
        solidworksDmLicenseKey: state.solidworksDmLicenseKey,
        autoStartSolidworksService: state.autoStartSolidworksService,
        hideSolidworksTempFiles: state.hideSolidworksTempFiles,
        ignoreSolidworksTempFiles: state.ignoreSolidworksTempFiles,
        apiServerUrl: state.apiServerUrl,
        lowercaseExtensions: state.lowercaseExtensions,
        viewMode: state.viewMode,
        iconSize: state.iconSize,
        listRowSize: state.listRowSize,
        theme: state.theme,
        autoApplySeasonalThemes: state.autoApplySeasonalThemes,
        language: state.language,
        keybindings: state.keybindings,
        christmasSnowOpacity: state.christmasSnowOpacity,
        christmasSnowDensity: state.christmasSnowDensity,
        christmasSnowSize: state.christmasSnowSize,
        christmasBlusteryness: state.christmasBlusteryness,
        christmasUseLocalWeather: state.christmasUseLocalWeather,
        christmasSleighEnabled: state.christmasSleighEnabled,
        christmasSleighDirection: state.christmasSleighDirection,
        halloweenSparksEnabled: state.halloweenSparksEnabled,
        halloweenSparksOpacity: state.halloweenSparksOpacity,
        halloweenSparksSpeed: state.halloweenSparksSpeed,
        halloweenGhostsOpacity: state.halloweenGhostsOpacity,
        autoDownloadCloudFiles: state.autoDownloadCloudFiles,
        autoDownloadUpdates: state.autoDownloadUpdates,
        autoDownloadExcludedFiles: state.autoDownloadExcludedFiles,
        pinnedFolders: state.pinnedFolders,
        pinnedSectionExpanded: state.pinnedSectionExpanded,
        colorSwatches: state.colorSwatches,
        connectedVaults: state.connectedVaults,
        activeVaultId: state.activeVaultId,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activityBarMode: state.activityBarMode,
        activeView: state.activeView,
        detailsPanelVisible: state.detailsPanelVisible,
        detailsPanelHeight: state.detailsPanelHeight,
        rightPanelVisible: state.rightPanelVisible,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelTabs: state.rightPanelTabs,
        bottomPanelTabOrder: state.bottomPanelTabOrder,
        // Tabs and navigation
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        tabGroups: state.tabGroups,
        tabsEnabled: state.tabsEnabled,
        currentFolder: state.currentFolder,
        columns: state.columns,
        expandedFolders: Array.from(state.expandedFolders),
        ignorePatterns: state.ignorePatterns,
        stagedCheckins: state.stagedCheckins,
        terminalVisible: state.terminalVisible,
        terminalHeight: state.terminalHeight,
        terminalHistory: state.terminalHistory.slice(0, 100),  // Keep last 100
        moduleConfig: state.moduleConfig,
        recentSearches: state.recentSearches.slice(0, 20),  // Keep last 20
        persistedPendingMetadata: state.persistedPendingMetadata,  // Survive app restart
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Record<string, unknown>
        
        // Deduplicate connected vaults by ID (keep first occurrence, ensure expanded)
        const persistedVaults = (persisted.connectedVaults as ConnectedVault[]) || []
        const seenIds = new Set<string>()
        const seenPaths = new Set<string>()
        const deduplicatedVaults = persistedVaults.filter(vault => {
          if (!vault?.id || !vault?.localPath) return false
          const normalizedPath = vault.localPath.toLowerCase().replace(/\\/g, '/')
          if (seenIds.has(vault.id) || seenPaths.has(normalizedPath)) {
            console.warn('[PDMStore] Removing duplicate vault from storage:', vault.name, vault.id)
            return false
          }
          seenIds.add(vault.id)
          seenPaths.add(normalizedPath)
          return true
        }).map(vault => ({
          ...vault,
          isExpanded: true  // Ensure vaults are expanded on load
        }))
        
        // Ensure activeVaultId points to a valid vault (might have been a removed duplicate)
        const persistedActiveVaultId = persisted.activeVaultId as string | null
        const validVaultIds = new Set(deduplicatedVaults.map(v => v.id))
        const validActiveVaultId = persistedActiveVaultId && validVaultIds.has(persistedActiveVaultId)
          ? persistedActiveVaultId
          : (deduplicatedVaults[0]?.id || null)
        
        // Ensure vaultPath matches the active vault's path
        const activeVault = deduplicatedVaults.find(v => v.id === validActiveVaultId)
        const validVaultPath = activeVault?.localPath || (persisted.vaultPath as string | null)
        
        return {
          ...currentState,
          ...persisted,
          // Use deduplicated vaults
          connectedVaults: deduplicatedVaults,
          // Use validated activeVaultId
          activeVaultId: validActiveVaultId,
          // Use validated vaultPath
          vaultPath: validVaultPath,
          // Convert expandedFolders back to Set
          expandedFolders: new Set(persisted.expandedFolders as string[] || []),
          // Ensure cadPreviewMode has a default
          cadPreviewMode: (persisted.cadPreviewMode as 'thumbnail' | 'edrawings') || 'thumbnail',
          // Restore SolidWorks settings
          solidworksIntegrationEnabled: persisted.solidworksIntegrationEnabled !== undefined 
            ? (persisted.solidworksIntegrationEnabled as boolean) 
            : true,  // Default enabled, onboarding will auto-detect
          solidworksPath: (persisted.solidworksPath as string | null) || null,
          solidworksDmLicenseKey: (persisted.solidworksDmLicenseKey as string | null) || null,
          autoStartSolidworksService: (persisted.autoStartSolidworksService as boolean) || false,
          hideSolidworksTempFiles: persisted.hideSolidworksTempFiles !== undefined ? (persisted.hideSolidworksTempFiles as boolean) : true,
          ignoreSolidworksTempFiles: persisted.ignoreSolidworksTempFiles !== undefined ? (persisted.ignoreSolidworksTempFiles as boolean) : true,
          // Restore API Server URL from local cache (server value syncs in App.tsx and takes precedence)
          apiServerUrl: (() => {
            // First check if it's in the persisted Zustand state
            if (persisted.apiServerUrl) return persisted.apiServerUrl as string
            // Migrate from old localStorage key if exists (one-time migration)
            const legacyUrl = typeof window !== 'undefined' ? localStorage.getItem('blueplm_api_url') : null
            return legacyUrl || null
          })(),
          // Ensure lowercaseExtensions has a default (true)
          lowercaseExtensions: persisted.lowercaseExtensions !== undefined ? persisted.lowercaseExtensions as boolean : true,
          // Ensure viewMode has a default
          viewMode: (persisted.viewMode as 'list' | 'icons') || 'list',
          // Ensure iconSize has a default
          iconSize: (persisted.iconSize as number) || 96,
          // Ensure listRowSize has a default
          listRowSize: (persisted.listRowSize as number) || 24,
          // Ensure theme has a default
          theme: (persisted.theme as ThemeMode) || 'dark',
          // Restore autoApplySeasonalThemes (default to true)
          autoApplySeasonalThemes: persisted.autoApplySeasonalThemes !== undefined ? (persisted.autoApplySeasonalThemes as boolean) : true,
          // Ensure language has a default
          language: (persisted.language as Language) || 'en',
          // Ensure keybindings has defaults (merge with defaults for new keybindings)
          keybindings: Object.assign({
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
          }, persisted.keybindings as KeybindingsConfig || {}),
          // Ensure onboarding state has defaults
          onboardingComplete: (persisted.onboardingComplete as boolean) || false,
          logSharingEnabled: (persisted.logSharingEnabled as boolean) || false,
          // Ensure auto-download settings have defaults
          autoDownloadCloudFiles: (persisted.autoDownloadCloudFiles as boolean) || false,
          autoDownloadUpdates: (persisted.autoDownloadUpdates as boolean) || false,
          autoDownloadExcludedFiles: (persisted.autoDownloadExcludedFiles as Record<string, string[]>) || {},
          // Ensure Christmas sleigh direction has default (new field for existing users)
          christmasSleighDirection: (persisted.christmasSleighDirection as 'push' | 'pull') || 'push',
          // Ensure columns have all fields
          columns: currentState.columns.map(defaultCol => {
            const persistedCol = (persisted.columns as typeof currentState.columns || [])
              .find(c => c.id === defaultCol.id)
            return persistedCol ? { ...defaultCol, ...persistedCol } : defaultCol
          }),
          // Ensure ignorePatterns has a default
          ignorePatterns: (persisted.ignorePatterns as Record<string, string[]>) || {},
          // Restore persisted pending metadata
          persistedPendingMetadata: (persisted.persistedPendingMetadata as Record<string, PendingMetadata>) || {},
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
              const activeTab = persistedTabs.find(t => t.id === persistedActiveTabId)
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
              const validOrder = persistedConfig.moduleOrder.filter(
                (id: string) => defaults.enabledModules.hasOwnProperty(id)
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
                (d: any) => 'afterGroup' in d && !('position' in d)
              )
              
              if (hasOldFormat) {
                // Migrate from old format - just use defaults for now
                dividers = defaults.dividers
              } else {
                // New format - use persisted dividers
                dividers = persistedConfig.dividers.filter(
                  (d: SectionDivider) => typeof d.position === 'number'
                )
              }
            }
            
            // Module parents - use defaults, only override for user-customized values
            const moduleParents = { ...defaults.moduleParents }
            if (persistedConfig.moduleParents) {
              // Check if persisted has any group-based parents (new format)
              const hasGroupParents = Object.values(persistedConfig.moduleParents).some(
                (v) => typeof v === 'string' && v.startsWith('group-')
              )
              // Only merge if user has customized (has group parents)
              if (hasGroupParents) {
                for (const [key, value] of Object.entries(persistedConfig.moduleParents)) {
                  if (key in moduleParents) {
                    moduleParents[key as ModuleId] = value as ModuleId | null
                  }
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
            const customGroups = (persistedConfig.customGroups && persistedConfig.customGroups.length > 0) 
              ? persistedConfig.customGroups 
              : defaults.customGroups
            
            return { enabledModules, enabledGroups, moduleOrder, dividers, moduleParents, moduleIconColors, customGroups }
          })(),
          // Ensure there's always at least one tab
          tabs: (() => {
            const persistedTabs = persisted.tabs as Tab[] | undefined
            if (!persistedTabs || persistedTabs.length === 0) {
              return [{
                id: 'default-tab',
                title: activeVault?.name || 'Explorer',
                folderPath: '',
                panelState: { sidebarVisible: true, detailsPanelVisible: true, rightPanelVisible: false }
              }]
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
            const validTabIds = new Set(persistedTabs.map(t => t.id))
            if (persistedActiveTabId && validTabIds.has(persistedActiveTabId)) {
              return persistedActiveTabId
            }
            return persistedTabs[0]?.id || 'default-tab'
          })()
        }
      }
    }
  )
)

// Convenience hooks - kept for backward compatibility
export function useSelectedFiles() {
  return usePDMStore(s => s.getSelectedFileObjects())
}

export function useVisibleFiles() {
  return usePDMStore(s => s.getVisibleFiles())
}
