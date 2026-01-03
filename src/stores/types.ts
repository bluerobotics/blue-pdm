// Store types - extracted from pdmStore.ts for use across slices
import type { PDMFile, Organization, User } from '../types/pdm'
import type { ModuleId, ModuleConfig } from '../types/modules'
import type { KeybindingsConfig, KeybindingAction, Keybinding } from '../types/settings'

// ============================================================================
// Type Aliases
// ============================================================================

export type SidebarView = 
  // Source Files
  | 'explorer' 
  | 'pending' 
  | 'history' 
  | 'workflows'
  | 'trash' 
  // Items
  | 'items'
  | 'boms'
  | 'products'
  // Change Control
  | 'ecr'
  | 'eco'
  | 'notifications'
  | 'deviations'
  | 'release-schedule'
  | 'process'
  // Supply Chain - Suppliers
  | 'supplier-database'
  | 'supplier-portal'
  // Supply Chain - Purchasing
  | 'purchase-requests'
  | 'purchase-orders'
  | 'invoices'
  // Supply Chain - Logistics
  | 'shipping'
  | 'receiving'
  // Production
  | 'manufacturing-orders'
  | 'travellers'
  | 'work-instructions'
  | 'production-schedule'
  | 'routings'
  | 'work-centers'
  | 'process-flows'
  | 'equipment'
  // Production - Analytics
  | 'yield-tracking'
  | 'error-codes'
  | 'downtime'
  | 'oee'
  | 'scrap-tracking'
  // Quality
  | 'fai'
  | 'ncr'
  | 'imr'
  | 'scar'
  | 'capa'
  | 'rma'
  | 'certificates'
  | 'calibration'
  | 'quality-templates'
  // Accounting
  | 'accounts-payable'
  | 'accounts-receivable'
  | 'general-ledger'
  | 'cost-tracking'
  | 'budgets'
  // Integrations
  | 'google-drive'
  // System
  | 'terminal'
  | 'settings'

export type DetailsPanelTab = 'properties' | 'preview' | 'whereused' | 'contains' | 'history' | 'datacard'
export type PanelPosition = 'bottom' | 'right'
export type ToastType = 'error' | 'success' | 'info' | 'warning' | 'progress' | 'update'
export type ThemeMode = 'dark' | 'deep-blue' | 'light' | 'christmas' | 'halloween' | 'weather' | 'kenneth' | 'system'
export type Language = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'ja' | 'zh-CN' | 'zh-TW' | 'ko' | 'nl' | 'sv' | 'pl' | 'ru' | 'sindarin'
export type DiffStatus = 'added' | 'modified' | 'deleted' | 'outdated' | 'cloud' | 'cloud_new' | 'moved' | 'ignored' | 'deleted_remote'

// ============================================================================
// Interfaces
// ============================================================================

// Tab system - browser-like tabs for file browser workspaces
export interface TabPanelState {
  sidebarVisible: boolean
  detailsPanelVisible: boolean
  rightPanelVisible: boolean
}

export interface Tab {
  id: string              // Unique tab ID
  title: string           // Tab display title (folder name or custom)
  folderPath: string      // Current folder path in file browser
  panelState: TabPanelState  // Which panels are visible
  groupId?: string        // Optional tab group ID
  isPinned?: boolean      // Pinned tabs can't be closed easily
}

export interface TabGroup {
  id: string
  name: string
  color: string           // Tailwind color class or hex color
  collapsed?: boolean     // Whether the group is collapsed
}

// Connected vault - an org vault that's connected locally
export interface ConnectedVault {
  id: string           // Vault ID from database
  name: string         // Vault name
  localPath: string    // Local folder path
  isExpanded: boolean  // UI state - is this vault expanded in explorer
}

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
  // Progress toast fields
  progress?: {
    current: number
    total: number
    percent: number
    speed?: string
    cancelRequested?: boolean
    label?: string  // Custom label (e.g., "214/398 MB") - overrides default current/total display
  }
}

// Pending metadata changes (not yet synced to server)
export interface PendingMetadata {
  part_number?: string | null
  description?: string | null
  revision?: string
  // Per-configuration tab numbers (config name -> tab number string)
  // Base number is shared (stored in part_number), tabs vary per config
  config_tabs?: Record<string, string>
  // Per-configuration descriptions (config name -> description string)
  // For parts/assemblies with multiple configurations
  config_descriptions?: Record<string, string>
}

// Local file info from filesystem
export interface LocalFile {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  extension: string
  size: number
  modifiedTime: string
  // PDM metadata (from Supabase when connected)
  pdmData?: PDMFile
  // Sync status
  isSynced?: boolean  // True if file exists in cloud
  // Diff status (compared to server)
  diffStatus?: DiffStatus
  // Local content hash (for detecting modifications)
  localHash?: string
  // Pending metadata changes (saved locally, synced on check-in)
  pendingMetadata?: PendingMetadata
  // Local active version (set after rollback, before check-in)
  // This tracks which version's content is currently in the local file
  localActiveVersion?: number
}

// Server file info (for tracking deleted files)
export interface ServerFile {
  id: string
  file_path: string
  name: string
  extension: string
  content_hash: string
}

// Queued operation for non-blocking file operations
export interface QueuedOperation {
  id: string
  type: 'download' | 'delete' | 'upload' | 'checkin' | 'checkout'
  label: string  // Human-readable description
  paths: string[]  // Folder/file paths being operated on
  execute: () => Promise<void>
}

// Column configuration for file browser
export interface ColumnConfig {
  id: string
  label: string
  width: number
  visible: boolean
  sortable: boolean
}

// Orphaned checkout - file was force-checked-in from another machine
export interface OrphanedCheckout {
  fileId: string
  fileName: string
  filePath: string           // Relative path in vault
  localPath: string          // Full local path
  checkedInBy: string        // Machine name that force-checked-in
  checkedInAt: string        // When it was checked in
  newVersion: number         // The new server version
  localHash?: string         // Hash of local file (if available)
  serverHash?: string        // Hash of server file
}

// Files that show as "needs update" but the storage blob is missing
// This happens when a check-in partially failed (database updated but upload failed)
export interface MissingStorageFile {
  fileId: string
  fileName: string
  filePath: string           // Relative path in vault
  serverHash: string         // The hash that's missing from storage
  version: number            // The version that's missing
  detectedAt: string         // When we detected this issue
}

// Staged check-in - file modified locally while offline, queued for check-in when online
export interface StagedCheckin {
  relativePath: string       // Relative path in vault (unique key)
  fileName: string           // File name for display
  localHash: string          // Hash of local file at time of staging
  stagedAt: string           // ISO timestamp when staged
  comment?: string           // Optional check-in comment
  serverVersion?: number     // Server version at time of staging (for conflict detection)
  serverHash?: string        // Server content hash at time of staging (for conflict detection)
}

// Color swatch for custom color picker colors
export interface ColorSwatch {
  id: string
  color: string              // Hex color value
  isOrg: boolean             // True if org-level swatch, false if user-level
  createdAt: string          // ISO timestamp
}

// Impersonated user context - full context for viewing as another user
export interface ImpersonatedUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: 'admin' | 'engineer' | 'viewer'
  teams: Array<{ id: string; name: string; color: string; icon: string }>
  permissions: Record<string, string[]>  // resource -> actions
  vaultIds: string[]  // Accessible vault IDs (empty = all vaults)
  moduleConfig?: ModuleConfig  // User's effective module config (from team defaults)
}

// ============================================================================
// Slice State Types
// ============================================================================

export interface ToastsSlice {
  // State
  toasts: ToastMessage[]
  
  // Actions
  addToast: (type: ToastType, message: string, duration?: number) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number, speed?: string, label?: string) => void
  requestCancelProgressToast: (id: string) => void
  isProgressToastCancelled: (id: string) => boolean
  removeToast: (id: string) => void
}

export interface UpdateSlice {
  // State
  updateAvailable: { version: string; releaseDate?: string; releaseNotes?: string; downloadUrl?: string; isManualVersion?: boolean } | null
  updateDownloading: boolean
  updateDownloaded: boolean
  updateProgress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null
  showUpdateModal: boolean
  installerPath: string | null
  
  // Actions
  setUpdateAvailable: (info: { version: string; releaseDate?: string; releaseNotes?: string; downloadUrl?: string; isManualVersion?: boolean } | null) => void
  setUpdateDownloading: (downloading: boolean) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setUpdateProgress: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null) => void
  setShowUpdateModal: (show: boolean) => void
  setInstallerPath: (path: string | null) => void
  showUpdateToast: (version: string) => void
  dismissUpdateToast: () => void
}

export interface UISlice {
  // State
  sidebarVisible: boolean
  sidebarWidth: number
  activityBarMode: 'expanded' | 'collapsed' | 'hover'
  activeView: SidebarView
  detailsPanelVisible: boolean
  detailsPanelHeight: number
  detailsPanelTab: DetailsPanelTab
  rightPanelVisible: boolean
  rightPanelWidth: number
  rightPanelTab: DetailsPanelTab | null
  rightPanelTabs: DetailsPanelTab[]
  bottomPanelTabOrder: DetailsPanelTab[]
  
  // Google Drive navigation
  gdriveCurrentFolderId: string | null
  gdriveCurrentFolderName: string | null
  gdriveDriveId: string | null
  gdriveIsSharedDrive: boolean
  gdriveOpenDocument: { id: string; name: string; mimeType: string; webViewLink?: string } | null
  gdriveAuthVersion: number
  
  // Terminal
  terminalVisible: boolean
  terminalHeight: number
  terminalHistory: string[]
  
  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setActivityBarMode: (mode: 'expanded' | 'collapsed' | 'hover') => void
  setActiveView: (view: SidebarView) => void
  setGdriveNavigation: (folderId: string | null, folderName?: string, isSharedDrive?: boolean, driveId?: string) => void
  setGdriveOpenDocument: (doc: { id: string; name: string; mimeType: string; webViewLink?: string } | null) => void
  incrementGdriveAuthVersion: () => void
  toggleDetailsPanel: () => void
  setDetailsPanelHeight: (height: number) => void
  setDetailsPanelTab: (tab: DetailsPanelTab) => void
  toggleRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: DetailsPanelTab | null) => void
  moveTabToRight: (tab: DetailsPanelTab) => void
  moveTabToBottom: (tab: DetailsPanelTab) => void
  reorderTabsInPanel: (panel: 'bottom' | 'right', tabId: DetailsPanelTab, newIndex: number) => void
  toggleTerminal: () => void
  setTerminalHeight: (height: number) => void
  addTerminalHistory: (command: string) => void
}

export interface SettingsSlice {
  // State - Preview & Topbar
  cadPreviewMode: 'thumbnail' | 'edrawings'
  topbarConfig: {
    showFps: boolean
    showSystemStats: boolean
    systemStatsExpanded: boolean
    showZoom: boolean
    showOrg: boolean
    showSearch: boolean
    showOnlineUsers: boolean
    showUserName: boolean
    showPanelToggles: boolean
  }
  
  // State - SolidWorks
  solidworksIntegrationEnabled: boolean
  solidworksPath: string | null
  solidworksDmLicenseKey: string | null
  autoStartSolidworksService: boolean
  hideSolidworksTempFiles: boolean
  ignoreSolidworksTempFiles: boolean
  
  // State - API Server
  apiServerUrl: string | null
  
  // State - Display
  lowercaseExtensions: boolean
  viewMode: 'list' | 'icons'
  iconSize: number
  listRowSize: number
  theme: ThemeMode
  autoApplySeasonalThemes: boolean
  language: Language
  keybindings: KeybindingsConfig
  
  // State - Theme Effects
  christmasSnowOpacity: number
  christmasSnowDensity: number
  christmasSnowSize: number
  christmasBlusteryness: number
  christmasUseLocalWeather: boolean
  christmasSleighEnabled: boolean
  christmasSleighDirection: 'push' | 'pull'
  halloweenSparksEnabled: boolean
  halloweenSparksOpacity: number
  halloweenSparksSpeed: number
  halloweenGhostsOpacity: number
  weatherRainOpacity: number
  weatherRainDensity: number
  weatherSnowOpacity: number
  weatherSnowDensity: number
  weatherEffectsEnabled: boolean
  
  // State - Auto-download
  autoDownloadCloudFiles: boolean
  autoDownloadUpdates: boolean
  autoDownloadExcludedFiles: Record<string, string[]>
  
  // State - Pinned items
  pinnedFolders: { path: string; vaultId: string; vaultName: string; isDirectory: boolean }[]
  pinnedSectionExpanded: boolean
  
  // State - Color swatches
  colorSwatches: ColorSwatch[]
  orgColorSwatches: ColorSwatch[]
  
  // State - Columns
  columns: ColumnConfig[]
  
  // State - Onboarding
  onboardingComplete: boolean
  logSharingEnabled: boolean
  
  // Actions - Preview & Topbar
  setCadPreviewMode: (mode: 'thumbnail' | 'edrawings') => void
  setTopbarConfig: (config: Partial<SettingsSlice['topbarConfig']>) => void
  
  // Actions - SolidWorks
  setSolidworksIntegrationEnabled: (enabled: boolean) => void
  setSolidworksPath: (path: string | null) => void
  setSolidworksDmLicenseKey: (key: string | null) => void
  setAutoStartSolidworksService: (enabled: boolean) => void
  setHideSolidworksTempFiles: (enabled: boolean) => void
  setIgnoreSolidworksTempFiles: (enabled: boolean) => void
  
  // Actions - API Server
  setApiServerUrl: (url: string | null) => void
  
  // Actions - Display
  setLowercaseExtensions: (enabled: boolean) => void
  setViewMode: (mode: 'list' | 'icons') => void
  setIconSize: (size: number) => void
  setListRowSize: (size: number) => void
  setTheme: (theme: ThemeMode) => void
  setAutoApplySeasonalThemes: (enabled: boolean) => void
  setLanguage: (language: Language) => void
  setKeybinding: (action: KeybindingAction, keybinding: Keybinding) => void
  resetKeybindings: () => void
  
  // Actions - Theme Effects
  setChristmasSnowOpacity: (opacity: number) => void
  setChristmasSnowDensity: (density: number) => void
  setChristmasSnowSize: (size: number) => void
  setChristmasBlusteryness: (blusteryness: number) => void
  setChristmasUseLocalWeather: (useLocalWeather: boolean) => void
  setChristmasSleighEnabled: (enabled: boolean) => void
  setChristmasSleighDirection: (direction: 'push' | 'pull') => void
  setHalloweenSparksEnabled: (enabled: boolean) => void
  setHalloweenSparksOpacity: (opacity: number) => void
  setHalloweenSparksSpeed: (speed: number) => void
  setHalloweenGhostsOpacity: (opacity: number) => void
  setWeatherRainOpacity: (opacity: number) => void
  setWeatherRainDensity: (density: number) => void
  setWeatherSnowOpacity: (opacity: number) => void
  setWeatherSnowDensity: (density: number) => void
  setWeatherEffectsEnabled: (enabled: boolean) => void
  
  // Actions - Auto-download
  setAutoDownloadCloudFiles: (enabled: boolean) => void
  setAutoDownloadUpdates: (enabled: boolean) => void
  addAutoDownloadExclusion: (vaultId: string, relativePath: string) => void
  removeAutoDownloadExclusion: (vaultId: string, relativePath: string) => void
  clearAutoDownloadExclusions: (vaultId: string) => void
  cleanupStaleExclusions: (vaultId: string, serverFilePaths: Set<string>) => void
  
  // Actions - Pinned items
  pinFolder: (path: string, vaultId: string, vaultName: string, isDirectory: boolean) => void
  unpinFolder: (path: string) => void
  togglePinnedSection: () => void
  reorderPinnedFolders: (fromIndex: number, toIndex: number) => void
  
  // Actions - Color swatches
  addColorSwatch: (color: string, isOrg: boolean) => void
  removeColorSwatch: (swatchId: string) => void
  loadOrgColorSwatches: () => Promise<void>
  syncColorSwatches: () => Promise<void>
  
  // Actions - Columns
  setColumnWidth: (id: string, width: number) => void
  toggleColumnVisibility: (id: string) => void
  reorderColumns: (columns: ColumnConfig[]) => void
  saveOrgColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  loadOrgColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  resetColumnsToDefaults: () => void
  
  // Actions - Onboarding
  completeOnboarding: (options?: { solidworksIntegrationEnabled?: boolean }) => void
  setLogSharingEnabled: (enabled: boolean) => void
}

export interface UserSlice {
  // State
  user: User | null
  organization: Organization | null
  isAuthenticated: boolean
  isOfflineMode: boolean
  isConnecting: boolean
  impersonatedUser: ImpersonatedUser | null
  userTeams: Array<{ id: string; name: string; color: string; icon: string }> | null
  userPermissions: Record<string, string[]> | null
  permissionsLoaded: boolean
  permissionsLastUpdated: number
  
  // Actions
  setUser: (user: User | null) => void
  setOrganization: (org: Organization | null) => void
  setOfflineMode: (offline: boolean) => void
  setIsConnecting: (connecting: boolean) => void
  signOut: () => void
  getEffectiveRole: () => string
  startUserImpersonation: (userId: string, customUser?: { id: string; email: string; full_name: string | null; role: string; teams?: { id: string; name: string; color: string; icon: string }[]; workflow_roles?: { id: string; name: string; color: string; icon: string }[] }) => Promise<void>
  stopUserImpersonation: () => void
  getImpersonatedUser: () => ImpersonatedUser | null
  getEffectiveVaultIds: () => string[]
  getEffectiveModuleConfig: () => ModuleConfig
  loadUserPermissions: () => Promise<void>
  hasPermission: (resource: string, action: string) => boolean
  updateOrganization: (updates: Partial<Organization>) => void
}

export interface VaultsSlice {
  // State - Legacy single vault
  vaultPath: string | null
  vaultName: string | null
  isVaultConnected: boolean
  
  // State - Multi-vault
  connectedVaults: ConnectedVault[]
  activeVaultId: string | null
  vaultsRefreshKey: number
  vaultFilesCache: Record<string, { files: LocalFile[], serverFiles: ServerFile[], loaded: boolean, loading: boolean }>
  
  // State - Recent
  recentVaults: string[]
  autoConnect: boolean
  
  // Actions
  setVaultPath: (path: string | null) => void
  setVaultName: (name: string | null) => void
  setVaultConnected: (connected: boolean) => void
  addRecentVault: (path: string) => void
  setAutoConnect: (auto: boolean) => void
  setConnectedVaults: (vaults: ConnectedVault[]) => void
  addConnectedVault: (vault: ConnectedVault) => void
  removeConnectedVault: (vaultId: string) => void
  toggleVaultExpanded: (vaultId: string) => void
  setActiveVault: (vaultId: string | null) => void
  switchVault: (vaultId: string, vaultPath: string) => void
  updateConnectedVault: (vaultId: string, updates: Partial<ConnectedVault>) => void
  triggerVaultsRefresh: () => void
  setVaultFiles: (vaultId: string, files: LocalFile[], serverFiles: ServerFile[]) => void
  setVaultLoading: (vaultId: string, loading: boolean) => void
  getVaultFiles: (vaultId: string) => { files: LocalFile[], serverFiles: ServerFile[], loaded: boolean, loading: boolean }
  clearVaultCache: (vaultId: string) => void
}

export interface FilesSlice {
  // State
  files: LocalFile[]
  serverFiles: ServerFile[]
  serverFolderPaths: Set<string>
  selectedFiles: string[]
  expandedFolders: Set<string>
  currentFolder: string
  persistedPendingMetadata: Record<string, PendingMetadata>
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  
  // State - Search
  searchQuery: string
  searchType: 'files' | 'folders' | 'all'
  searchResults: LocalFile[]
  isSearching: boolean
  recentSearches: string[]
  
  // State - Filters
  workflowStateFilter: string[]
  extensionFilter: string[]
  historyFolderFilter: string | null
  trashFolderFilter: string | null
  ignorePatterns: Record<string, string[]>
  
  // State - Processing
  processingFolders: Set<string>
  
  // Actions - Files
  setFiles: (files: LocalFile[]) => void
  setServerFiles: (files: ServerFile[]) => void
  setServerFolderPaths: (paths: Set<string>) => void
  updateFileInStore: (path: string, updates: Partial<LocalFile>) => void
  updateFilesInStore: (updates: Array<{ path: string; updates: Partial<LocalFile> }>) => void
  removeFilesFromStore: (paths: string[]) => void
  updatePendingMetadata: (path: string, metadata: PendingMetadata) => void
  clearPendingMetadata: (path: string) => void
  clearPendingConfigMetadata: (path: string) => void
  renameFileInStore: (oldPath: string, newPath: string, newNameOrRelPath: string, isMove?: boolean) => void
  setSelectedFiles: (paths: string[]) => void
  toggleFileSelection: (path: string, multiSelect?: boolean) => void
  selectAllFiles: () => void
  clearSelection: () => void
  toggleFolder: (path: string) => void
  setCurrentFolder: (path: string) => void
  
  // Actions - Realtime Updates
  addCloudFile: (pdmFile: import('../types/pdm').PDMFile) => void
  updateFilePdmData: (fileId: string, pdmData: Partial<import('../types/pdm').PDMFile>) => void
  removeCloudFile: (fileId: string) => void
  
  // Actions - Search
  setSearchQuery: (query: string) => void
  setSearchType: (type: 'files' | 'folders' | 'all') => void
  setSearchResults: (results: LocalFile[]) => void
  setIsSearching: (searching: boolean) => void
  addRecentSearch: (query: string) => void
  clearRecentSearches: () => void
  
  // Actions - Sort & Filter
  setSortColumn: (column: string) => void
  setSortDirection: (direction: 'asc' | 'desc') => void
  toggleSort: (column: string) => void
  setWorkflowStateFilter: (stateIds: string[]) => void
  setExtensionFilter: (extensions: string[]) => void
  setHistoryFolderFilter: (folderPath: string | null) => void
  setTrashFolderFilter: (folderPath: string | null) => void
  
  // Actions - Ignore Patterns
  addIgnorePattern: (vaultId: string, pattern: string) => void
  removeIgnorePattern: (vaultId: string, pattern: string) => void
  setIgnorePatterns: (vaultId: string, patterns: string[]) => void
  getIgnorePatterns: (vaultId: string) => string[]
  isPathIgnored: (vaultId: string, relativePath: string) => boolean
  
  // Actions - Processing
  addProcessingFolder: (path: string) => void
  addProcessingFolders: (paths: string[]) => void
  removeProcessingFolder: (path: string) => void
  removeProcessingFolders: (paths: string[]) => void
  clearProcessingFolders: () => void
  
  // Getters
  getSelectedFileObjects: () => LocalFile[]
  getVisibleFiles: () => LocalFile[]
  getFileByPath: (path: string) => LocalFile | undefined
  getDeletedFiles: () => LocalFile[]
  getFolderDiffCounts: (folderPath: string) => { added: number; modified: number; moved: number; deleted: number; outdated: number; cloud: number; cloudNew: number }
}

export interface ModulesSlice {
  // State
  moduleConfig: ModuleConfig
  
  // Actions
  setModuleConfig: (config: ModuleConfig) => void
  setModuleEnabled: (moduleId: ModuleId, enabled: boolean) => void
  setGroupEnabled: (groupId: import('../types/modules').ModuleGroupId, enabled: boolean) => void
  setModuleOrder: (order: ModuleId[]) => void
  reorderModule: (fromIndex: number, toIndex: number) => void
  setDividerEnabled: (dividerId: string, enabled: boolean) => void
  setCombinedOrder: (combinedList: import('../types/modules').OrderListItem[]) => void
  addDivider: (afterPosition: number) => void
  removeDivider: (dividerId: string) => void
  setModuleParent: (moduleId: ModuleId, parentId: string | null) => void
  setModuleIconColor: (moduleId: ModuleId, color: string | null) => void
  addCustomGroup: (name: string, icon: string, iconColor: string | null) => string
  updateCustomGroup: (groupId: string, updates: Partial<{ name: string; icon: string; iconColor: string | null; enabled: boolean }>) => void
  removeCustomGroup: (groupId: string) => void
  resetModulesToDefaults: () => void
  loadOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  saveOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  loadTeamModuleDefaults: (teamId: string) => Promise<{ success: boolean; defaults: import('../types/modules').OrgModuleDefaults | null; error?: string }>
  saveTeamModuleDefaults: (teamId: string, config?: ModuleConfig) => Promise<{ success: boolean; error?: string }>
  clearTeamModuleDefaults: (teamId: string) => Promise<{ success: boolean; error?: string }>
  loadUserModuleDefaults: () => Promise<{ success: boolean; defaults: import('../types/modules').OrgModuleDefaults | null; error?: string }>
  isModuleVisible: (moduleId: ModuleId) => boolean
}

export interface TabsSlice {
  // State
  tabs: Tab[]
  activeTabId: string | null
  tabGroups: TabGroup[]
  tabsEnabled: boolean
  
  // Actions
  setTabsEnabled: (enabled: boolean) => void
  addTab: (folderPath?: string, title?: string) => string
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  moveTab: (tabId: string, newIndex: number) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  duplicateTab: (tabId: string) => string
  updateTabTitle: (tabId: string, title: string) => void
  updateTabFolder: (tabId: string, folderPath: string) => void
  updateTabPanelState: (tabId: string, panelState: Partial<TabPanelState>) => void
  syncCurrentTabWithState: () => void
  createTabGroup: (name: string, color: string) => string
  deleteTabGroup: (groupId: string) => void
  renameTabGroup: (groupId: string, name: string) => void
  setTabGroupColor: (groupId: string, color: string) => void
  addTabToGroup: (tabId: string, groupId: string) => void
  removeTabFromGroup: (tabId: string) => void
}

export interface OperationsSlice {
  // State - Loading
  isLoading: boolean
  isRefreshing: boolean
  statusMessage: string
  filesLoaded: boolean
  
  // State - Sync
  syncProgress: {
    isActive: boolean
    operation: 'upload' | 'download' | 'checkin' | 'checkout'
    current: number
    total: number
    percent: number
    speed: string
    cancelRequested: boolean
  }
  
  // State - Queue
  operationQueue: QueuedOperation[]
  
  // State - Notifications & Reviews
  unreadNotificationCount: number
  pendingReviewCount: number
  
  // State - Orphaned checkouts
  orphanedCheckouts: OrphanedCheckout[]
  
  // State - Staged check-ins
  stagedCheckins: StagedCheckin[]
  
  // State - Missing storage files
  missingStorageFiles: MissingStorageFile[]
  
  // Actions - Loading
  setIsLoading: (loading: boolean) => void
  setIsRefreshing: (refreshing: boolean) => void
  setStatusMessage: (message: string) => void
  setFilesLoaded: (loaded: boolean) => void
  
  // Actions - Sync
  setSyncProgress: (progress: Partial<OperationsSlice['syncProgress']>) => void
  startSync: (total: number, operation?: 'upload' | 'download' | 'checkin' | 'checkout') => void
  updateSyncProgress: (current: number, percent: number, speed: string) => void
  requestCancelSync: () => void
  endSync: () => void
  
  // Actions - Queue
  queueOperation: (operation: Omit<QueuedOperation, 'id'>) => string
  removeFromQueue: (id: string) => void
  hasPathConflict: (paths: string[]) => boolean
  processQueue: () => void
  
  // Actions - Notifications & Reviews
  setUnreadNotificationCount: (count: number) => void
  setPendingReviewCount: (count: number) => void
  incrementNotificationCount: () => void
  decrementNotificationCount: (amount?: number) => void
  
  // Actions - Orphaned checkouts
  addOrphanedCheckout: (checkout: OrphanedCheckout) => void
  removeOrphanedCheckout: (fileId: string) => void
  clearOrphanedCheckouts: () => void
  
  // Actions - Staged check-ins
  stageCheckin: (checkin: StagedCheckin) => void
  unstageCheckin: (relativePath: string) => void
  updateStagedCheckinComment: (relativePath: string, comment: string) => void
  clearStagedCheckins: () => void
  getStagedCheckin: (relativePath: string) => StagedCheckin | undefined
  
  // Actions - Missing storage files
  setMissingStorageFiles: (files: MissingStorageFile[]) => void
  clearMissingStorageFiles: () => void
}

// ============================================================================
// Combined Store Type
// ============================================================================

export type PDMStoreState = 
  ToastsSlice & 
  UpdateSlice & 
  UISlice & 
  SettingsSlice & 
  UserSlice & 
  VaultsSlice & 
  FilesSlice & 
  ModulesSlice & 
  TabsSlice & 
  OperationsSlice

// Re-export types that were originally in pdmStore.ts for backward compatibility
export type { PDMFile, Organization, User } from '../types/pdm'
export type { ModuleId, ModuleGroupId, ModuleConfig, SectionDivider, OrderListItem, OrgModuleDefaults } from '../types/modules'
export type { KeybindingAction, KeybindingsConfig, Keybinding } from '../types/settings'
