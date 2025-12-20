import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PDMFile, FileState, Organization, User } from '../types/pdm'
import type { ModuleId, ModuleGroupId, ModuleConfig, SectionDivider, OrderListItem } from '../types/modules'
import { getDefaultModuleConfig, MODULES, MODULE_GROUPS, isModuleVisible, extractFromCombinedList } from '../types/modules'
import type { KeybindingAction, KeybindingsConfig, Keybinding } from '../types/settings'
import { supabase } from '../lib/supabase'

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

export type SidebarView = 
  // PDM views
  | 'explorer' 
  | 'pending' 
  | 'search' 
  | 'workflows'  // File workflows
  | 'history' 
  | 'trash' 
  | 'terminal'
  // PLM views
  | 'eco'        // ECO management
  | 'ecr'        // Engineering Change Requests / Issues
  | 'products'   // Product information
  | 'process'    // ECO process editor
  | 'schedule'   // ECO schedule
  | 'reviews'    // Gate approvals & reviews
  | 'gsd'        // ECO summary (Getting Stuff Done)
  | 'deviations' // Deviations tracking
  | 'suppliers'  // Supplier database
  | 'supplier-portal'  // Supplier portal
  | 'google-drive'  // Google Drive integration
  // System
  | 'settings'
export type DetailsPanelTab = 'properties' | 'preview' | 'whereused' | 'contains' | 'history' | 'datacard'
export type PanelPosition = 'bottom' | 'right'
export type ToastType = 'error' | 'success' | 'info' | 'warning' | 'progress' | 'update'
export type ThemeMode = 'dark' | 'deep-blue' | 'light' | 'christmas' | 'halloween' | 'weather' | 'kenneth' | 'system'
export type Language = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'ja' | 'zh-CN' | 'zh-TW' | 'ko' | 'nl' | 'sv' | 'pl' | 'ru' | 'sindarin'
export type DiffStatus = 'added' | 'modified' | 'deleted' | 'outdated' | 'cloud' | 'cloud_new' | 'moved' | 'ignored' | 'deleted_remote'

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

interface PDMState {
  // Auth & Org
  user: User | null
  organization: Organization | null
  isAuthenticated: boolean
  isOfflineMode: boolean
  isConnecting: boolean  // True after sign-in while loading organization
  
  // Role impersonation (dev tools, non-persisted)
  impersonatedRole: 'admin' | 'engineer' | 'viewer' | null
  
  // Vault (legacy single vault)
  vaultPath: string | null
  vaultName: string | null  // Custom display name for vault
  isVaultConnected: boolean
  
  // Connected vaults (multi-vault support)
  connectedVaults: ConnectedVault[]
  activeVaultId: string | null  // Currently selected vault for file browser
  vaultsRefreshKey: number  // Increment to trigger vault list refresh
  
  // Per-vault file cache (allows viewing multiple vaults simultaneously)
  vaultFilesCache: Record<string, { files: LocalFile[], serverFiles: ServerFile[], loaded: boolean, loading: boolean }>
  
  // File Browser
  files: LocalFile[]
  serverFiles: ServerFile[] // Files that exist on server (for tracking deletions)
  serverFolderPaths: Set<string> // Folder paths that exist on server (computed from serverFiles)
  selectedFiles: string[] // paths
  expandedFolders: Set<string>
  currentFolder: string
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  
  // Search
  searchQuery: string
  searchType: 'files' | 'folders' | 'all'
  searchResults: LocalFile[]
  isSearching: boolean
  
  // Filter
  stateFilter: FileState[]
  extensionFilter: string[]
  checkedOutFilter: 'all' | 'mine' | 'others'
  
  // Layout
  sidebarVisible: boolean
  sidebarWidth: number
  activityBarMode: 'expanded' | 'collapsed' | 'hover'
  activeView: SidebarView
  detailsPanelVisible: boolean
  detailsPanelHeight: number
  detailsPanelTab: DetailsPanelTab
  
  // Tabs (browser-like tab system)
  tabs: Tab[]
  activeTabId: string | null
  tabGroups: TabGroup[]
  tabsEnabled: boolean  // Master toggle for tab system
  
  // Right panel (dockable from bottom panel)
  rightPanelVisible: boolean
  rightPanelWidth: number
  rightPanelTab: DetailsPanelTab | null
  rightPanelTabs: DetailsPanelTab[]  // Tabs stacked in right panel
  
  // Google Drive navigation (shared between sidebar and main panel)
  gdriveCurrentFolderId: string | null
  gdriveCurrentFolderName: string | null
  gdriveDriveId: string | null  // For shared drives
  gdriveIsSharedDrive: boolean
  gdriveOpenDocument: { id: string; name: string; mimeType: string; webViewLink?: string } | null
  gdriveAuthVersion: number  // Incremented on auth changes to trigger sidebar refresh
  
  // Columns configuration
  columns: ColumnConfig[]
  
  // Loading states
  isLoading: boolean
  isRefreshing: boolean
  statusMessage: string
  filesLoaded: boolean  // Has the initial file load completed?
  
  // Sync progress
  syncProgress: {
    isActive: boolean
    operation: 'upload' | 'download' | 'checkin' | 'checkout'
    current: number
    total: number
    percent: number
    speed: string
    cancelRequested: boolean
  }
  
  // Toasts
  toasts: ToastMessage[]
  
  // Update state
  updateAvailable: { version: string; releaseDate?: string; releaseNotes?: string; downloadUrl?: string; isManualVersion?: boolean } | null
  updateDownloading: boolean
  updateDownloaded: boolean
  updateProgress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null
  showUpdateModal: boolean
  installerPath: string | null  // Path to downloaded installer for manual version installs
  
  // Recent vaults
  recentVaults: string[]
  autoConnect: boolean
  
  // Preview settings
  cadPreviewMode: 'thumbnail' | 'edrawings'  // thumbnail = embedded preview, edrawings = open externally
  
  // Topbar configuration
  topbarConfig: {
    showFps: boolean
    showSystemStats: boolean
    systemStatsExpanded: boolean  // false = minimal (dots), true = expanded (full stats)
    showZoom: boolean
    showOrg: boolean
    showSearch: boolean
    showOnlineUsers: boolean
    showUserName: boolean  // false = avatar only, true = avatar + name
    showPanelToggles: boolean  // sidebar/panel toggle buttons
  }
  
  // SolidWorks settings
  solidworksIntegrationEnabled: boolean  // Master toggle for SolidWorks integration (false = hide from settings, skip checks)
  solidworksPath: string | null  // Custom SolidWorks installation path (null = default)
  solidworksDmLicenseKey: string | null  // Document Manager API license key for fast mode
  autoStartSolidworksService: boolean  // Auto-start SolidWorks service on app bootup
  hideSolidworksTempFiles: boolean  // Hide ~$ temp files from file browser UI
  ignoreSolidworksTempFiles: boolean  // Ignore ~$ temp files from sync/check-in operations
  
  // API Server settings
  apiServerUrl: string | null  // External API server URL for ERP integrations
  
  // Display settings
  lowercaseExtensions: boolean  // Display file extensions in lowercase
  viewMode: 'list' | 'icons'    // File browser view mode
  iconSize: number              // Icon size for icon view (48-256 pixels)
  listRowSize: number           // Row height for list view (16-64 pixels)
  theme: ThemeMode              // Theme: dark, light, blue, or system
  autoApplySeasonalThemes: boolean  // Auto-apply halloween/christmas themes on Oct 1 and Dec 1
  language: Language            // UI language
  keybindings: KeybindingsConfig  // Keyboard shortcuts configuration
  christmasSnowOpacity: number  // Christmas theme snow opacity (0-100)
  christmasSnowDensity: number  // Christmas theme snow density (10-200 flakes)
  christmasSnowSize: number     // Christmas theme snowflake size multiplier (50-200%)
  christmasBlusteryness: number  // Christmas theme snow wind intensity (0-100)
  christmasUseLocalWeather: boolean // Link wind to local weather data
  christmasSleighEnabled: boolean // Christmas theme sleigh animation enabled
  christmasSleighDirection: 'push' | 'pull' // Sleigh direction: push (reindeer behind) or pull (reindeer in front)
  halloweenSparksEnabled: boolean  // Halloween theme bonfire sparks enabled
  halloweenSparksOpacity: number  // Halloween theme bonfire sparks opacity (0-100)
  halloweenSparksSpeed: number    // Halloween theme bonfire sparks speed (10-100)
  halloweenGhostsOpacity: number // Halloween theme ghost opacity (0-100)
  
  // Weather theme settings
  weatherRainOpacity: number     // Weather theme rain opacity (0-100)
  weatherRainDensity: number     // Weather theme rain density (10-200)
  weatherSnowOpacity: number     // Weather theme snow opacity (0-100)
  weatherSnowDensity: number     // Weather theme snow density (10-200)
  weatherEffectsEnabled: boolean // Enable/disable weather visual effects
  
  // Auto-download settings
  autoDownloadCloudFiles: boolean  // Auto-download files that exist on server but not locally
  autoDownloadUpdates: boolean     // Auto-download when server has new versions
  autoDownloadExcludedFiles: Record<string, string[]>  // Per-vault list of relative paths excluded from auto-download
  
  // Pinned items (quick access)
  pinnedFolders: { path: string; vaultId: string; vaultName: string; isDirectory: boolean }[]
  pinnedSectionExpanded: boolean
  
  // Processing folders (for spinner display)
  processingFolders: Set<string>
  
  // Operation queue for non-blocking file operations
  operationQueue: QueuedOperation[]
  
  // History filter (for folder-specific history view)
  historyFolderFilter: string | null
  
  // Terminal
  terminalVisible: boolean
  terminalHeight: number
  terminalHistory: string[]  // Command history for up/down navigation
  
  // Trash filter (for folder-specific deleted files view)
  trashFolderFilter: string | null
  
  // Ignore patterns (per-vault, keyed by vault ID)
  // Patterns like: "*.sim", "build/", "__pycache__/", "*.sldprt~"
  ignorePatterns: Record<string, string[]>
  
  // Notifications & Reviews
  unreadNotificationCount: number
  pendingReviewCount: number
  
  // Orphaned checkouts (files force-checked-in from another machine)
  orphanedCheckouts: OrphanedCheckout[]
  
  // Missing storage files (database has records but storage blobs are missing)
  missingStorageFiles: MissingStorageFile[]
  
  // Module configuration (sidebar modules)
  moduleConfig: ModuleConfig
  
  // Onboarding (first app boot)
  onboardingComplete: boolean
  logSharingEnabled: boolean
  
  // Actions - Onboarding
  completeOnboarding: (options?: { solidworksIntegrationEnabled?: boolean }) => void
  setLogSharingEnabled: (enabled: boolean) => void
  
  // Actions - Module Configuration
  setModuleEnabled: (moduleId: ModuleId, enabled: boolean) => void
  setGroupEnabled: (groupId: ModuleGroupId, enabled: boolean) => void
  setModuleOrder: (order: ModuleId[]) => void
  reorderModule: (fromIndex: number, toIndex: number) => void
  setDividerEnabled: (dividerId: string, enabled: boolean) => void
  setCombinedOrder: (combinedList: OrderListItem[]) => void
  addDivider: (afterPosition: number) => void
  removeDivider: (dividerId: string) => void
  setModuleParent: (moduleId: ModuleId, parentId: string | null) => void
  setModuleIconColor: (moduleId: ModuleId, color: string | null) => void
  addCustomGroup: (name: string, icon: string, iconColor: string | null) => string  // Returns group ID
  updateCustomGroup: (groupId: string, updates: Partial<{ name: string; icon: string; iconColor: string | null; enabled: boolean }>) => void
  removeCustomGroup: (groupId: string) => void
  resetModulesToDefaults: () => void
  loadOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  saveOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  isModuleVisible: (moduleId: ModuleId) => boolean
  
  // Actions - Toasts
  addToast: (type: ToastType, message: string, duration?: number) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number, speed?: string, label?: string) => void
  requestCancelProgressToast: (id: string) => void
  isProgressToastCancelled: (id: string) => boolean
  removeToast: (id: string) => void
  
  // Actions - Update
  setUpdateAvailable: (info: { version: string; releaseDate?: string; releaseNotes?: string; downloadUrl?: string; isManualVersion?: boolean } | null) => void
  setUpdateDownloading: (downloading: boolean) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setUpdateProgress: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null) => void
  setShowUpdateModal: (show: boolean) => void
  setInstallerPath: (path: string | null) => void
  showUpdateToast: (version: string) => void
  dismissUpdateToast: () => void
  
  // Actions - Auth
  setUser: (user: User | null) => void
  setOrganization: (org: Organization | null) => void
  setOfflineMode: (offline: boolean) => void
  setIsConnecting: (connecting: boolean) => void
  signOut: () => void
  
  // Actions - Role Impersonation (dev tools)
  setImpersonatedRole: (role: 'admin' | 'engineer' | 'viewer' | null) => void
  getEffectiveRole: () => 'admin' | 'engineer' | 'viewer'
  
  // Actions - Vault
  setVaultPath: (path: string | null) => void
  setVaultName: (name: string | null) => void
  setVaultConnected: (connected: boolean) => void
  addRecentVault: (path: string) => void
  setAutoConnect: (auto: boolean) => void
  
  // Actions - Preview settings
  setCadPreviewMode: (mode: 'thumbnail' | 'edrawings') => void
  setTopbarConfig: (config: Partial<PDMState['topbarConfig']>) => void
  
  // Actions - SolidWorks settings
  setSolidworksIntegrationEnabled: (enabled: boolean) => void
  setSolidworksPath: (path: string | null) => void
  setSolidworksDmLicenseKey: (key: string | null) => void
  setAutoStartSolidworksService: (enabled: boolean) => void
  setHideSolidworksTempFiles: (enabled: boolean) => void
  setIgnoreSolidworksTempFiles: (enabled: boolean) => void
  
  // Actions - API Server settings
  setApiServerUrl: (url: string | null) => void
  
  // Actions - Display settings
  setLowercaseExtensions: (enabled: boolean) => void
  setViewMode: (mode: 'list' | 'icons') => void
  setIconSize: (size: number) => void
  setListRowSize: (size: number) => void
  setTheme: (theme: ThemeMode) => void
  setAutoApplySeasonalThemes: (enabled: boolean) => void
  setLanguage: (language: Language) => void
  setKeybinding: (action: KeybindingAction, keybinding: Keybinding) => void
  resetKeybindings: () => void
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
  
  // Actions - Weather theme settings
  setWeatherRainOpacity: (opacity: number) => void
  setWeatherRainDensity: (density: number) => void
  setWeatherSnowOpacity: (opacity: number) => void
  setWeatherSnowDensity: (density: number) => void
  setWeatherEffectsEnabled: (enabled: boolean) => void
  
  // Actions - Auto-download settings
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
  
  // Actions - Connected Vaults
  setConnectedVaults: (vaults: ConnectedVault[]) => void
  addConnectedVault: (vault: ConnectedVault) => void
  removeConnectedVault: (vaultId: string) => void
  toggleVaultExpanded: (vaultId: string) => void
  setActiveVault: (vaultId: string | null) => void
  switchVault: (vaultId: string, vaultPath: string) => void  // Atomically switch vault ID and path together
  updateConnectedVault: (vaultId: string, updates: Partial<ConnectedVault>) => void
  triggerVaultsRefresh: () => void
  
  // Actions - Vault Files Cache
  setVaultFiles: (vaultId: string, files: LocalFile[], serverFiles: ServerFile[]) => void
  setVaultLoading: (vaultId: string, loading: boolean) => void
  getVaultFiles: (vaultId: string) => { files: LocalFile[], serverFiles: ServerFile[], loaded: boolean, loading: boolean }
  clearVaultCache: (vaultId: string) => void
  
  // Actions - Files
  setFiles: (files: LocalFile[]) => void
  setServerFiles: (files: ServerFile[]) => void
  setServerFolderPaths: (paths: Set<string>) => void
  updateFileInStore: (path: string, updates: Partial<LocalFile>) => void
  updateFilesInStore: (updates: Array<{ path: string; updates: Partial<LocalFile> }>) => void  // Batch update
  removeFilesFromStore: (paths: string[]) => void
  updatePendingMetadata: (path: string, metadata: PendingMetadata) => void
  clearPendingMetadata: (path: string) => void
  renameFileInStore: (oldPath: string, newPath: string, newNameOrRelPath: string, isMove?: boolean) => void
  setSelectedFiles: (paths: string[]) => void
  toggleFileSelection: (path: string, multiSelect?: boolean) => void
  selectAllFiles: () => void
  clearSelection: () => void
  toggleFolder: (path: string) => void
  setCurrentFolder: (path: string) => void
  
  // Actions - Realtime Updates (incremental without full refresh)
  addCloudFile: (pdmFile: PDMFile) => void  // Add new file from server
  updateFilePdmData: (fileId: string, pdmData: Partial<PDMFile>) => void  // Update existing file's PDM data
  removeCloudFile: (fileId: string) => void  // Remove file from cloud view
  
  // Actions - Search
  setSearchQuery: (query: string) => void
  setSearchType: (type: 'files' | 'folders' | 'all') => void
  setSearchResults: (results: LocalFile[]) => void
  setIsSearching: (searching: boolean) => void
  
  // Actions - Sort & Filter
  setSortColumn: (column: string) => void
  setSortDirection: (direction: 'asc' | 'desc') => void
  toggleSort: (column: string) => void
  setStateFilter: (states: FileState[]) => void
  setExtensionFilter: (extensions: string[]) => void
  setCheckedOutFilter: (filter: 'all' | 'mine' | 'others') => void
  
  // Actions - Layout
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
  
  // Actions - Tabs (file browser workspaces)
  setTabsEnabled: (enabled: boolean) => void
  addTab: (folderPath?: string, title?: string) => string  // Returns tab ID
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  moveTab: (tabId: string, newIndex: number) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  duplicateTab: (tabId: string) => string  // Returns new tab ID
  updateTabTitle: (tabId: string, title: string) => void
  updateTabFolder: (tabId: string, folderPath: string) => void
  updateTabPanelState: (tabId: string, panelState: Partial<TabPanelState>) => void
  syncCurrentTabWithState: () => void  // Syncs current folder and panels to active tab
  // Tab Groups
  createTabGroup: (name: string, color: string) => string  // Returns group ID
  deleteTabGroup: (groupId: string) => void
  renameTabGroup: (groupId: string, name: string) => void
  addTabToGroup: (tabId: string, groupId: string) => void
  removeTabFromGroup: (tabId: string) => void
  
  // Actions - Right Panel
  toggleRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: DetailsPanelTab | null) => void
  moveTabToRight: (tab: DetailsPanelTab) => void
  moveTabToBottom: (tab: DetailsPanelTab) => void
  
  // Actions - Terminal
  toggleTerminal: () => void
  setTerminalHeight: (height: number) => void
  addTerminalHistory: (command: string) => void
  
  // Actions - History
  setHistoryFolderFilter: (folderPath: string | null) => void
  
  // Actions - Trash
  setTrashFolderFilter: (folderPath: string | null) => void
  
  // Actions - Ignore Patterns
  addIgnorePattern: (vaultId: string, pattern: string) => void
  removeIgnorePattern: (vaultId: string, pattern: string) => void
  setIgnorePatterns: (vaultId: string, patterns: string[]) => void
  getIgnorePatterns: (vaultId: string) => string[]
  isPathIgnored: (vaultId: string, relativePath: string) => boolean
  
  // Actions - Notifications & Reviews
  setUnreadNotificationCount: (count: number) => void
  setPendingReviewCount: (count: number) => void
  incrementNotificationCount: () => void
  decrementNotificationCount: (amount?: number) => void
  
  // Actions - Orphaned Checkouts
  addOrphanedCheckout: (checkout: OrphanedCheckout) => void
  removeOrphanedCheckout: (fileId: string) => void
  clearOrphanedCheckouts: () => void
  
  // Actions - Missing Storage Files
  setMissingStorageFiles: (files: MissingStorageFile[]) => void
  clearMissingStorageFiles: () => void
  
  // Actions - Columns
  setColumnWidth: (id: string, width: number) => void
  toggleColumnVisibility: (id: string) => void
  reorderColumns: (columns: ColumnConfig[]) => void
  saveOrgColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  loadOrgColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  resetColumnsToDefaults: () => void
  
  // Actions - Status
  setIsLoading: (loading: boolean) => void
  setIsRefreshing: (refreshing: boolean) => void
  setStatusMessage: (message: string) => void
  setFilesLoaded: (loaded: boolean) => void
  
  // Actions - Sync Progress
  setSyncProgress: (progress: Partial<PDMState['syncProgress']>) => void
  startSync: (total: number, operation?: 'upload' | 'download' | 'checkin' | 'checkout') => void
  updateSyncProgress: (current: number, percent: number, speed: string) => void
  requestCancelSync: () => void
  endSync: () => void
  
  // Actions - Processing Folders
  addProcessingFolder: (path: string) => void
  addProcessingFolders: (paths: string[]) => void  // Batch add (single state update)
  removeProcessingFolder: (path: string) => void
  removeProcessingFolders: (paths: string[]) => void  // Batch remove (single state update)
  clearProcessingFolders: () => void
  
  // Actions - Operation Queue
  queueOperation: (operation: Omit<QueuedOperation, 'id'>) => string  // Returns operation ID
  removeFromQueue: (id: string) => void
  hasPathConflict: (paths: string[]) => boolean
  processQueue: () => void
  
  // Getters
  getSelectedFileObjects: () => LocalFile[]
  getVisibleFiles: () => LocalFile[]
  getFileByPath: (path: string) => LocalFile | undefined
  getDeletedFiles: () => LocalFile[]  // Files on server but not locally
  getFolderDiffCounts: (folderPath: string) => { added: number; modified: number; moved: number; deleted: number; outdated: number; cloud: number; cloudNew: number }
}

const defaultColumns: ColumnConfig[] = [
  { id: 'name', label: 'Name', width: 280, visible: true, sortable: true },
  { id: 'fileStatus', label: 'File Status', width: 100, visible: false, sortable: true },
  { id: 'checkedOutBy', label: 'Checked Out By', width: 150, visible: false, sortable: true },
  { id: 'version', label: 'Ver', width: 60, visible: true, sortable: true },
  { id: 'itemNumber', label: 'Item Number', width: 120, visible: true, sortable: true },
  { id: 'description', label: 'Description', width: 200, visible: true, sortable: true },
  { id: 'revision', label: 'Rev', width: 50, visible: true, sortable: true },
  { id: 'state', label: 'State', width: 90, visible: true, sortable: true },
  { id: 'ecoTags', label: 'ECOs', width: 120, visible: true, sortable: true },
  { id: 'extension', label: 'Type', width: 70, visible: true, sortable: true },
  { id: 'size', label: 'Size', width: 80, visible: true, sortable: true },
  { id: 'modifiedTime', label: 'Modified', width: 140, visible: true, sortable: true },
]

export const usePDMStore = create<PDMState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      organization: null,
      isAuthenticated: false,
      isOfflineMode: false,
      isConnecting: false,
      impersonatedRole: null,
      
      // Onboarding (first app boot)
      onboardingComplete: false,
      logSharingEnabled: true,
      
      vaultPath: null,
      vaultName: null,
      isVaultConnected: false,
      connectedVaults: [],
      activeVaultId: null,
      vaultsRefreshKey: 0,
      vaultFilesCache: {},
      
      files: [],
      serverFiles: [],
      serverFolderPaths: new Set<string>(),
      selectedFiles: [],
      expandedFolders: new Set<string>(),
      currentFolder: '',
      sortColumn: 'name',
      sortDirection: 'asc',
      
      searchQuery: '',
      searchType: 'all',
      searchResults: [],
      isSearching: false,
      
      stateFilter: [],
      extensionFilter: [],
      checkedOutFilter: 'all',
      
      sidebarVisible: true,
      sidebarWidth: 280,
      activityBarMode: 'hover',
      activeView: 'explorer',
      detailsPanelVisible: true,
      detailsPanelHeight: 250,
      detailsPanelTab: 'preview',
      
      rightPanelVisible: false,
      rightPanelWidth: 350,
      rightPanelTab: null,
      rightPanelTabs: [],
      
      // Tabs (file browser workspaces)
      tabs: [{
        id: 'default-tab',
        title: 'Explorer',
        folderPath: '',
        panelState: { sidebarVisible: true, detailsPanelVisible: true, rightPanelVisible: false }
      }],
      activeTabId: 'default-tab',
      tabGroups: [],
      tabsEnabled: false,  // Disabled by default, users can enable via breadcrumb icon
      
      // Google Drive navigation
      gdriveCurrentFolderId: null,
      gdriveCurrentFolderName: null,
      gdriveDriveId: null,
      gdriveIsSharedDrive: false,
      gdriveOpenDocument: null,
      gdriveAuthVersion: 0,
      
      columns: defaultColumns,
      
      isLoading: false,
      isRefreshing: false,
      statusMessage: '',
      filesLoaded: false,
      
      syncProgress: {
        isActive: false,
        operation: 'upload',
        current: 0,
        total: 0,
        percent: 0,
        speed: '',
        cancelRequested: false
      },
      
      toasts: [],
      
      updateAvailable: null,
      updateDownloading: false,
      updateDownloaded: false,
      updateProgress: null,
      showUpdateModal: false,
      installerPath: null,
      
      recentVaults: [],
      autoConnect: true,
      cadPreviewMode: 'thumbnail',
      topbarConfig: {
        showFps: false,
        showSystemStats: true,
        systemStatsExpanded: false,  // minimal by default
        showZoom: true,
        showOrg: true,
        showSearch: true,
        showOnlineUsers: true,
        showUserName: true,  // show name by default
        showPanelToggles: true,  // show panel toggles by default
      },
      solidworksIntegrationEnabled: true,  // Enabled by default, but onboarding will auto-detect and disable on Mac
      solidworksPath: null,  // null = use default installation path
      solidworksDmLicenseKey: null,  // null = fast mode disabled
      autoStartSolidworksService: false,  // Don't auto-start by default
      hideSolidworksTempFiles: true,  // Hide ~$ temp files by default
      ignoreSolidworksTempFiles: true,  // Ignore ~$ temp files by default
      apiServerUrl: null,  // null = no API server configured
      lowercaseExtensions: true,
      viewMode: 'list',
      iconSize: 96,  // Default icon size (medium)
      listRowSize: 24, // Default list row height
      theme: 'dark',  // Default theme
      autoApplySeasonalThemes: true,  // Auto-apply seasonal themes by default
      language: 'en',  // Default language
      keybindings: {
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
      } as KeybindingsConfig,
      christmasSnowOpacity: 40,  // Default 40%
      christmasSnowDensity: 100,  // Default 100 snowflakes
      christmasSnowSize: 55,     // Default 55% size (smaller flakes)
      christmasBlusteryness: 30,  // Default 30% wind intensity
      christmasUseLocalWeather: true,  // Default ON - link to local weather
      autoDownloadCloudFiles: false,  // Off by default
      autoDownloadUpdates: false,     // Off by default
      autoDownloadExcludedFiles: {},  // Per-vault exclusion lists
      christmasSleighEnabled: true,  // Default ON
      christmasSleighDirection: 'push',  // Default to push (funny: reindeer pushing sleigh)
      halloweenSparksEnabled: true,  // Default ON
      halloweenSparksOpacity: 70,  // Default 70%
      halloweenSparksSpeed: 40,    // Default 40% speed
      halloweenGhostsOpacity: 30,  // Default 30%
      weatherRainOpacity: 60,       // Default 60%
      weatherRainDensity: 80,       // Default 80 raindrops
      weatherSnowOpacity: 70,       // Default 70%
      weatherSnowDensity: 60,       // Default 60 snowflakes
      weatherEffectsEnabled: true,  // Default enabled
      pinnedFolders: [],
      pinnedSectionExpanded: true,
      processingFolders: new Set(),
      operationQueue: [],
      historyFolderFilter: null,
      trashFolderFilter: null,
      ignorePatterns: {},
      
      // Terminal
      terminalVisible: false,
      terminalHeight: 250,
      terminalHistory: [],
      
      // Notifications & Reviews
      unreadNotificationCount: 0,
      pendingReviewCount: 0,
      orphanedCheckouts: [],
      missingStorageFiles: [],
      
      // Module configuration
      moduleConfig: getDefaultModuleConfig(),
      
      // Actions - Toasts
      addToast: (type, message, duration = 5000) => {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        set(state => ({ toasts: [...state.toasts, { id, type, message, duration }] }))
      },
      addProgressToast: (id, message, total) => {
        set(state => ({ 
          toasts: [...state.toasts, { 
            id, 
            type: 'progress', 
            message, 
            duration: 0, // Don't auto-dismiss progress toasts
            progress: { current: 0, total, percent: 0 }
          }] 
        }))
      },
      updateProgressToast: (id, current, percent, speed, label) => {
        set(state => ({
          toasts: state.toasts.map(t => 
            t.id === id && t.type === 'progress'
              ? { ...t, progress: { ...t.progress!, current, percent, speed, label } }
              : t
          )
        }))
      },
      requestCancelProgressToast: (id) => {
        set(state => ({
          toasts: state.toasts.map(t => 
            t.id === id && t.type === 'progress' && t.progress
              ? { ...t, progress: { ...t.progress, cancelRequested: true } }
              : t
          )
        }))
      },
      isProgressToastCancelled: (id) => {
        const toast = get().toasts.find(t => t.id === id)
        return toast?.progress?.cancelRequested || false
      },
      removeToast: (id) => {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
      },
      
      // Actions - Update
      setUpdateAvailable: (info) => set({ updateAvailable: info }),
      setUpdateDownloading: (downloading) => set({ updateDownloading: downloading }),
      setUpdateDownloaded: (downloaded) => set({ updateDownloaded: downloaded }),
      setUpdateProgress: (progress) => set({ updateProgress: progress }),
      setShowUpdateModal: (show) => set({ showUpdateModal: show }),
      setInstallerPath: (path) => set({ installerPath: path }),
      showUpdateToast: (version) => {
        const id = 'update-available'
        // Remove existing update toast if any
        set(state => ({
          toasts: [
            ...state.toasts.filter(t => t.id !== id),
            { id, type: 'update' as ToastType, message: `Version ${version} is available`, duration: 0 }
          ]
        }))
      },
      dismissUpdateToast: () => {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== 'update-available') }))
      },
      
      // Actions - Onboarding
      completeOnboarding: (options) => set({ 
        onboardingComplete: true,
        // Auto-enable these settings on first app startup for better out-of-box experience
        autoDownloadCloudFiles: true,
        autoDownloadUpdates: true,
        autoStartSolidworksService: options?.solidworksIntegrationEnabled ?? true,
        solidworksIntegrationEnabled: options?.solidworksIntegrationEnabled ?? true,
      }),
      setLogSharingEnabled: (logSharingEnabled) => set({ logSharingEnabled }),
      
      // Actions - Module Configuration
      setModuleEnabled: (moduleId, enabled) => {
        set(state => {
          const newEnabledModules = { ...state.moduleConfig.enabledModules, [moduleId]: enabled }
          
          // If disabling a module, check if any dependent modules need to be disabled
          if (!enabled) {
            for (const mod of MODULES) {
              if (mod.dependencies?.includes(moduleId)) {
                newEnabledModules[mod.id] = false
              }
            }
          }
          
          return {
            moduleConfig: {
              ...state.moduleConfig,
              enabledModules: newEnabledModules
            }
          }
        })
      },
      
      setGroupEnabled: (groupId, enabled) => {
        set(state => {
          const group = MODULE_GROUPS.find(g => g.id === groupId)
          const newEnabledGroups = { ...state.moduleConfig.enabledGroups, [groupId]: enabled }
          const newEnabledModules = { ...state.moduleConfig.enabledModules }
          
          // If this is a master toggle group, enable/disable all modules in the group
          if (group?.isMasterToggle) {
            for (const mod of MODULES) {
              if (mod.group === groupId) {
                // When enabling, restore to default. When disabling, disable all.
                newEnabledModules[mod.id] = enabled ? mod.defaultEnabled : false
              }
            }
          }
          
          return {
            moduleConfig: {
              ...state.moduleConfig,
              enabledGroups: newEnabledGroups,
              enabledModules: newEnabledModules
            }
          }
        })
      },
      
      setModuleOrder: (moduleOrder) => {
        set(state => ({
          moduleConfig: { ...state.moduleConfig, moduleOrder }
        }))
      },
      
      reorderModule: (fromIndex, toIndex) => {
        set(state => {
          const newOrder = [...state.moduleConfig.moduleOrder]
          const [removed] = newOrder.splice(fromIndex, 1)
          newOrder.splice(toIndex, 0, removed)
          return {
            moduleConfig: { ...state.moduleConfig, moduleOrder: newOrder }
          }
        })
      },
      
      setDividerEnabled: (dividerId, enabled) => {
        set(state => ({
          moduleConfig: {
            ...state.moduleConfig,
            dividers: state.moduleConfig.dividers.map(d =>
              d.id === dividerId ? { ...d, enabled } : d
            )
          }
        }))
      },
      
      setCombinedOrder: (combinedList) => {
        const { moduleConfig } = get()
        const { moduleOrder, dividers, customGroups } = extractFromCombinedList(
          combinedList, 
          moduleConfig.dividers,
          moduleConfig.customGroups
        )
        set({
          moduleConfig: {
            ...moduleConfig,
            moduleOrder,
            dividers,
            customGroups
          }
        })
      },
      
      addDivider: (afterPosition) => {
        set(state => {
          const newId = `divider-${Date.now()}`
          return {
            moduleConfig: {
              ...state.moduleConfig,
              dividers: [...state.moduleConfig.dividers, { id: newId, enabled: true, position: afterPosition }]
            }
          }
        })
      },
      
      removeDivider: (dividerId) => {
        set(state => ({
          moduleConfig: {
            ...state.moduleConfig,
            dividers: state.moduleConfig.dividers.filter(d => d.id !== dividerId)
          }
        }))
      },
      
      setModuleParent: (moduleId, parentId) => {
        set(state => ({
          moduleConfig: {
            ...state.moduleConfig,
            moduleParents: {
              ...state.moduleConfig.moduleParents,
              [moduleId]: parentId
            }
          }
        }))
      },
      
      setModuleIconColor: (moduleId, color) => {
        set(state => ({
          moduleConfig: {
            ...state.moduleConfig,
            moduleIconColors: {
              ...state.moduleConfig.moduleIconColors,
              [moduleId]: color
            }
          }
        }))
      },
      
      addCustomGroup: (name, icon, iconColor) => {
        const groupId = `group-${Date.now()}`
        set(state => {
          // Add at the end of the module order
          const position = state.moduleConfig.moduleOrder.length
          return {
            moduleConfig: {
              ...state.moduleConfig,
              customGroups: [
                ...state.moduleConfig.customGroups,
                { id: groupId, name, icon, iconColor, position, enabled: true }
              ]
            }
          }
        })
        return groupId
      },
      
      updateCustomGroup: (groupId, updates) => {
        set(state => ({
          moduleConfig: {
            ...state.moduleConfig,
            customGroups: state.moduleConfig.customGroups.map(g =>
              g.id === groupId ? { ...g, ...updates } : g
            )
          }
        }))
      },
      
      removeCustomGroup: (groupId) => {
        set(state => {
          // Remove group and unset any modules that had this as parent
          const newModuleParents = { ...state.moduleConfig.moduleParents }
          for (const [moduleId, parentId] of Object.entries(newModuleParents)) {
            if (parentId === groupId) {
              newModuleParents[moduleId as ModuleId] = null
            }
          }
          
          return {
            moduleConfig: {
              ...state.moduleConfig,
              customGroups: state.moduleConfig.customGroups.filter(g => g.id !== groupId),
              moduleParents: newModuleParents
            }
          }
        })
      },
      
      resetModulesToDefaults: () => {
        set({ moduleConfig: getDefaultModuleConfig() })
      },
      
      loadOrgModuleDefaults: async () => {
        const { organization } = get()
        if (!organization?.id) {
          return { success: false, error: 'No organization connected' }
        }
        
        try {
          const { data, error } = await (supabase.rpc as any)('get_org_module_defaults', {
            p_org_id: organization.id
          })
          
          if (error) throw error
          
          if (!data || (Array.isArray(data) && data.length === 0)) {
            return { success: false, error: 'No org module defaults configured' }
          }
          
          const defaults = Array.isArray(data) ? data[0] : data
          if (defaults) {
            const moduleConfig: ModuleConfig = {
              enabledModules: defaults.enabled_modules || getDefaultModuleConfig().enabledModules,
              enabledGroups: defaults.enabled_groups || getDefaultModuleConfig().enabledGroups,
              moduleOrder: defaults.module_order || getDefaultModuleConfig().moduleOrder,
              dividers: defaults.dividers || getDefaultModuleConfig().dividers,
              moduleParents: defaults.module_parents || getDefaultModuleConfig().moduleParents,
              moduleIconColors: defaults.module_icon_colors || getDefaultModuleConfig().moduleIconColors,
              customGroups: defaults.custom_groups || getDefaultModuleConfig().customGroups,
            }
            set({ moduleConfig })
          }
          
          return { success: true }
        } catch (err) {
          console.error('Failed to load org module defaults:', err)
          return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
      },
      
      saveOrgModuleDefaults: async () => {
        const { organization, moduleConfig, getEffectiveRole } = get()
        if (!organization?.id) {
          return { success: false, error: 'No organization connected' }
        }
        if (getEffectiveRole() !== 'admin') {
          return { success: false, error: 'Only admins can save org module defaults' }
        }
        
        try {
          const { error } = await (supabase.rpc as any)('set_org_module_defaults', {
            p_org_id: organization.id,
            p_enabled_modules: moduleConfig.enabledModules,
            p_enabled_groups: moduleConfig.enabledGroups,
            p_module_order: moduleConfig.moduleOrder,
            p_dividers: moduleConfig.dividers,
            p_module_parents: moduleConfig.moduleParents,
            p_module_icon_colors: moduleConfig.moduleIconColors,
            p_custom_groups: moduleConfig.customGroups
          })
          
          if (error) throw error
          return { success: true }
        } catch (err) {
          console.error('Failed to save org module defaults:', err)
          return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
      },
      
      isModuleVisible: (moduleId) => {
        const { moduleConfig } = get()
        return isModuleVisible(moduleId, moduleConfig)
      },
      
      // Actions - Auth
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setOrganization: (organization) => set({ organization, isConnecting: false }),  // Clear connecting state when org loads
      setOfflineMode: (isOfflineMode) => set({ isOfflineMode }),
      setIsConnecting: (isConnecting) => set({ isConnecting }),
      signOut: () => set({ user: null, organization: null, isAuthenticated: false, isOfflineMode: false, isConnecting: false, impersonatedRole: null }),
      
      // Actions - Role Impersonation (dev tools, session only)
      setImpersonatedRole: (impersonatedRole) => set({ impersonatedRole }),
      getEffectiveRole: () => {
        const { user, impersonatedRole } = get()
        return impersonatedRole ?? user?.role ?? 'viewer'
      },
      
      // Actions - Vault
      setVaultPath: (vaultPath) => set({ vaultPath }),
      setVaultName: (vaultName) => set({ vaultName }),
      setVaultConnected: (isVaultConnected) => set({ isVaultConnected }),
      addRecentVault: (path) => {
        const { recentVaults } = get()
        const updated = [path, ...recentVaults.filter(v => v !== path)].slice(0, 10)
        set({ recentVaults: updated })
      },
      setAutoConnect: (autoConnect) => set({ autoConnect }),
      setCadPreviewMode: (cadPreviewMode) => set({ cadPreviewMode }),
      setTopbarConfig: (config) => set((s) => ({ topbarConfig: { ...s.topbarConfig, ...config } })),
      setSolidworksIntegrationEnabled: (solidworksIntegrationEnabled) => set({ solidworksIntegrationEnabled }),
      setSolidworksPath: (solidworksPath) => set({ solidworksPath }),
      setSolidworksDmLicenseKey: (solidworksDmLicenseKey) => set({ solidworksDmLicenseKey }),
      setAutoStartSolidworksService: (autoStartSolidworksService) => set({ autoStartSolidworksService }),
      setHideSolidworksTempFiles: (hideSolidworksTempFiles) => set({ hideSolidworksTempFiles }),
      setIgnoreSolidworksTempFiles: (ignoreSolidworksTempFiles) => set({ ignoreSolidworksTempFiles }),
      setApiServerUrl: (apiServerUrl) => {
        set({ apiServerUrl })
        // Also sync to the legacy localStorage key for backward compatibility
        if (apiServerUrl) {
          localStorage.setItem('blueplm_api_url', apiServerUrl)
        } else {
          localStorage.removeItem('blueplm_api_url')
        }
      },
      setLowercaseExtensions: (lowercaseExtensions) => set({ lowercaseExtensions }),
      setViewMode: (viewMode) => set({ viewMode }),
      setIconSize: (iconSize) => set({ iconSize: Math.max(48, Math.min(256, iconSize)) }),
      setListRowSize: (listRowSize) => set({ listRowSize: Math.max(16, Math.min(64, listRowSize)) }),
      setTheme: (theme) => set({ theme }),
      setAutoApplySeasonalThemes: (autoApplySeasonalThemes) => set({ autoApplySeasonalThemes }),
      setLanguage: (language) => set({ language }),
      setKeybinding: (action, keybinding) => set(state => ({
        keybindings: { ...state.keybindings, [action]: keybinding }
      })),
      resetKeybindings: () => set({
        keybindings: {
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
      }),
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
      
      // Weather theme settings actions
      setWeatherRainOpacity: (weatherRainOpacity) => set({ weatherRainOpacity }),
      setWeatherRainDensity: (weatherRainDensity) => set({ weatherRainDensity }),
      setWeatherSnowOpacity: (weatherSnowOpacity) => set({ weatherSnowOpacity }),
      setWeatherSnowDensity: (weatherSnowDensity) => set({ weatherSnowDensity }),
      setWeatherEffectsEnabled: (weatherEffectsEnabled) => set({ weatherEffectsEnabled }),
      
      // Actions - Auto-download settings
      setAutoDownloadCloudFiles: (autoDownloadCloudFiles) => set({ autoDownloadCloudFiles }),
      setAutoDownloadUpdates: (autoDownloadUpdates) => set({ autoDownloadUpdates }),
      addAutoDownloadExclusion: (vaultId, relativePath) => set(state => {
        const currentExclusions = state.autoDownloadExcludedFiles[vaultId] || []
        // Don't add duplicates
        if (currentExclusions.includes(relativePath)) return state
        return {
          autoDownloadExcludedFiles: {
            ...state.autoDownloadExcludedFiles,
            [vaultId]: [...currentExclusions, relativePath]
          }
        }
      }),
      removeAutoDownloadExclusion: (vaultId, relativePath) => set(state => {
        const currentExclusions = state.autoDownloadExcludedFiles[vaultId] || []
        return {
          autoDownloadExcludedFiles: {
            ...state.autoDownloadExcludedFiles,
            [vaultId]: currentExclusions.filter(p => p !== relativePath)
          }
        }
      }),
      clearAutoDownloadExclusions: (vaultId) => set(state => ({
        autoDownloadExcludedFiles: {
          ...state.autoDownloadExcludedFiles,
          [vaultId]: []
        }
      })),
      cleanupStaleExclusions: (vaultId, serverFilePaths) => set(state => {
        const currentExclusions = state.autoDownloadExcludedFiles[vaultId] || []
        // Keep only exclusions for files that still exist on the server
        const validExclusions = currentExclusions.filter(path => serverFilePaths.has(path))
        // Only update if something changed
        if (validExclusions.length === currentExclusions.length) return state
        return {
          autoDownloadExcludedFiles: {
            ...state.autoDownloadExcludedFiles,
            [vaultId]: validExclusions
          }
        }
      }),
      
      // Actions - Pinned items
      pinFolder: (path, vaultId, vaultName, isDirectory) => {
        const { pinnedFolders } = get()
        // Don't add duplicates
        if (pinnedFolders.some(p => p.path === path && p.vaultId === vaultId)) return
        set({ pinnedFolders: [...pinnedFolders, { path, vaultId, vaultName, isDirectory }] })
      },
      unpinFolder: (path) => {
        const { pinnedFolders } = get()
        set({ pinnedFolders: pinnedFolders.filter(p => p.path !== path) })
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
      
      // Actions - Connected Vaults
      setConnectedVaults: (connectedVaults) => set({ connectedVaults }),
      addConnectedVault: (vault) => {
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
      removeConnectedVault: (vaultId) => {
        const { connectedVaults, activeVaultId } = get()
        const updated = connectedVaults.filter(v => v.id !== vaultId)
        set({ 
          connectedVaults: updated,
          activeVaultId: activeVaultId === vaultId ? (updated[0]?.id || null) : activeVaultId
        })
      },
      toggleVaultExpanded: (vaultId) => {
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
      updateConnectedVault: (vaultId, updates) => {
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
      setVaultFiles: (vaultId, files, serverFiles) => {
        const { vaultFilesCache } = get()
        set({
          vaultFilesCache: {
            ...vaultFilesCache,
            [vaultId]: { files, serverFiles, loaded: true, loading: false }
          }
        })
      },
      setVaultLoading: (vaultId, loading) => {
        const { vaultFilesCache } = get()
        const existing = vaultFilesCache[vaultId] || { files: [], serverFiles: [], loaded: false, loading: false }
        set({
          vaultFilesCache: {
            ...vaultFilesCache,
            [vaultId]: { ...existing, loading }
          }
        })
      },
      getVaultFiles: (vaultId) => {
        const { vaultFilesCache } = get()
        return vaultFilesCache[vaultId] || { files: [], serverFiles: [], loaded: false, loading: false }
      },
      clearVaultCache: (vaultId) => {
        const { vaultFilesCache } = get()
        const { [vaultId]: _, ...rest } = vaultFilesCache
        set({ vaultFilesCache: rest })
      },
      
      // Actions - Files
      setFiles: (files) => set({ files }),
      setServerFiles: (serverFiles) => set({ serverFiles }),
      setServerFolderPaths: (serverFolderPaths) => set({ serverFolderPaths }),
      updateFileInStore: (path, updates) => {
        set(state => ({
          files: state.files.map(f => 
            f.path === path ? { ...f, ...updates } : f
          )
        }))
      },
      // Batch update multiple files in a single state change (avoids N re-renders)
      updateFilesInStore: (updates) => {
        if (updates.length === 0) return
        // Build a map for O(1) lookups
        const updateMap = new Map(updates.map(u => [u.path, u.updates]))
        set(state => ({
          files: state.files.map(f => {
            const fileUpdates = updateMap.get(f.path)
            return fileUpdates ? { ...f, ...fileUpdates } : f
          })
        }))
      },
      removeFilesFromStore: (paths) => {
        const pathSet = new Set(paths)
        set(state => ({
          files: state.files.filter(f => !pathSet.has(f.path)),
          selectedFiles: state.selectedFiles.filter(p => !pathSet.has(p))
        }))
      },
      updatePendingMetadata: (path, metadata) => {
        set(state => ({
          files: state.files.map(f => {
            if (f.path === path) {
              // Merge with existing pending metadata
              const existingPending = f.pendingMetadata || {}
              const newPending = { ...existingPending, ...metadata }
              // Also update the pdmData to show the changes immediately in UI
              const updatedPdmData = f.pdmData ? {
                ...f.pdmData,
                part_number: metadata.part_number !== undefined ? metadata.part_number : f.pdmData.part_number,
                description: metadata.description !== undefined ? metadata.description : f.pdmData.description,
                revision: metadata.revision !== undefined ? metadata.revision : f.pdmData.revision,
              } : f.pdmData
              return { 
                ...f, 
                pendingMetadata: newPending,
                pdmData: updatedPdmData,
                // Mark as modified if it has pdmData (synced file)
                diffStatus: f.pdmData ? 'modified' : f.diffStatus
              }
            }
            return f
          })
        }))
      },
      clearPendingMetadata: (path) => {
        set(state => ({
          files: state.files.map(f => 
            f.path === path ? { ...f, pendingMetadata: undefined } : f
          )
        }))
      },
      renameFileInStore: (oldPath, newPath, newNameOrRelPath, isMove = false) => {
        const { files, selectedFiles } = get()
        
        // Update file in the files array
        const updatedFiles = files.map(f => {
          if (f.path === oldPath) {
            let newRelativePath: string
            let newName: string
            
            if (isMove) {
              // For moves, newNameOrRelPath is the full new relative path
              newRelativePath = newNameOrRelPath
              newName = newNameOrRelPath.includes('/') 
                ? newNameOrRelPath.split('/').pop()! 
                : newNameOrRelPath
            } else {
              // For renames, newNameOrRelPath is just the new filename
              newName = newNameOrRelPath
              const pathParts = f.relativePath.split('/')
              pathParts[pathParts.length - 1] = newName
              newRelativePath = pathParts.join('/')
            }
            
            // If the file is synced and being moved, mark it as 'moved'
            const shouldMarkAsMoved = isMove && f.pdmData?.id
            
            return {
              ...f,
              path: newPath,
              name: newName,
              relativePath: newRelativePath,
              extension: newName.includes('.') ? newName.split('.').pop()?.toLowerCase() || '' : '',
              // Set diffStatus to 'moved' if this is a synced file being moved
              ...(shouldMarkAsMoved ? { diffStatus: 'moved' as const } : {})
            }
          }
          return f
        })
        
        // Update selected files if the renamed file was selected
        const updatedSelectedFiles = selectedFiles.map(p => p === oldPath ? newPath : p)
        
        set({ 
          files: updatedFiles,
          selectedFiles: updatedSelectedFiles
        })
      },
      setSelectedFiles: (selectedFiles) => set({ selectedFiles }),
      toggleFileSelection: (path, multiSelect = false) => {
        const { selectedFiles } = get()
        if (multiSelect) {
          if (selectedFiles.includes(path)) {
            set({ selectedFiles: selectedFiles.filter(p => p !== path) })
          } else {
            set({ selectedFiles: [...selectedFiles, path] })
          }
        } else {
          set({ selectedFiles: [path] })
        }
      },
      selectAllFiles: () => {
        const { files } = get()
        set({ selectedFiles: files.filter(f => !f.isDirectory).map(f => f.path) })
      },
      clearSelection: () => set({ selectedFiles: [] }),
      toggleFolder: (path) => {
        const { expandedFolders } = get()
        const newExpanded = new Set(expandedFolders)
        if (newExpanded.has(path)) {
          newExpanded.delete(path)
        } else {
          newExpanded.add(path)
        }
        set({ expandedFolders: newExpanded })
      },
      setCurrentFolder: (currentFolder) => set({ currentFolder }),
      
      // Actions - Realtime Updates (incremental without full refresh)
      addCloudFile: (pdmFile) => {
        const { files, vaultPath } = get()
        if (!vaultPath) return
        
        // Check if file already exists (by server ID or path)
        const existingByPath = files.find(f => 
          f.relativePath.toLowerCase() === pdmFile.file_path.toLowerCase()
        )
        if (existingByPath) {
          // File already exists locally - update its pdmData instead
          set(state => ({
            files: state.files.map(f => 
              f.relativePath.toLowerCase() === pdmFile.file_path.toLowerCase()
                ? { ...f, pdmData: pdmFile, isSynced: true, diffStatus: f.localHash === pdmFile.content_hash ? undefined : 'outdated' }
                : f
            )
          }))
          return
        }
        
        // Add cloud parent folders if needed
        const pathParts = pdmFile.file_path.split('/')
        const newFiles: LocalFile[] = []
        
        // Create cloud folders for parents that don't exist
        let currentPath = ''
        for (let i = 0; i < pathParts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
          const folderExists = files.some(f => 
            f.relativePath.toLowerCase() === currentPath.toLowerCase()
          )
          if (!folderExists && !newFiles.some(f => f.relativePath === currentPath)) {
            newFiles.push({
              name: pathParts[i],
              path: buildFullPath(vaultPath, currentPath),
              relativePath: currentPath,
              isDirectory: true,
              extension: '',
              size: 0,
              modifiedTime: '',
              diffStatus: 'cloud'
            })
          }
        }
        
        // Add the cloud file itself - mark as 'cloud_new' (green positive diff)
        // to indicate this is a new file added by another user
        newFiles.push({
          name: pdmFile.file_name,
          path: buildFullPath(vaultPath, pdmFile.file_path),
          relativePath: pdmFile.file_path,
          isDirectory: false,
          extension: pdmFile.extension,
          size: pdmFile.file_size || 0,
          modifiedTime: pdmFile.updated_at || '',
          pdmData: pdmFile,
          isSynced: false, // Not synced locally (cloud only)
          diffStatus: 'cloud_new'  // Green positive indicator - new file to download
        })
        
        set(state => ({ files: [...state.files, ...newFiles] }))
      },
      
      updateFilePdmData: (fileId, pdmData) => {
        set(state => ({
          files: state.files.map(f => {
            if (f.pdmData?.id === fileId) {
              const updatedPdmData = { ...f.pdmData, ...pdmData } as PDMFile
              // Recompute diff status if content hash changed
              let newDiffStatus = f.diffStatus
              if (pdmData.content_hash && f.localHash) {
                if (pdmData.content_hash !== f.localHash) {
                  // Cloud has newer content
                  newDiffStatus = 'outdated'
                } else if (f.diffStatus === 'outdated') {
                  // Hashes now match - no longer outdated
                  newDiffStatus = undefined
                }
              }
              return { 
                ...f, 
                pdmData: updatedPdmData,
                diffStatus: newDiffStatus
              }
            }
            return f
          })
        }))
      },
      
      removeCloudFile: (fileId) => {
        set(state => ({
          files: state.files.filter(f => {
            // Only remove cloud-only files (files that exist on server but not locally)
            // Keep files that exist locally - mark as 'deleted_remote' so user knows
            if (f.pdmData?.id === fileId && f.diffStatus === 'cloud') {
              return false // Remove this file
            }
            // If file exists locally but had pdmData, keep it
            if (f.pdmData?.id === fileId) {
              return true
            }
            return true
          }).map(f => {
            // Mark locally existing files as 'deleted_remote' - server deleted but you still have local copy
            // This shows as red diff so user knows the server version was deleted
            if (f.pdmData?.id === fileId && f.diffStatus !== 'cloud') {
              return { ...f, pdmData: undefined, isSynced: false, diffStatus: 'deleted_remote' as const }
            }
            return f
          })
        }))
      },
      
      // Actions - Search
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSearchType: (searchType) => set({ searchType }),
      setSearchResults: (searchResults) => set({ searchResults }),
      setIsSearching: (isSearching) => set({ isSearching }),
      
      // Actions - Sort & Filter
      setSortColumn: (sortColumn) => set({ sortColumn }),
      setSortDirection: (sortDirection) => set({ sortDirection }),
      toggleSort: (column) => {
        const { sortColumn, sortDirection } = get()
        if (sortColumn === column) {
          set({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })
        } else {
          set({ sortColumn: column, sortDirection: 'asc' })
        }
      },
      setStateFilter: (stateFilter) => set({ stateFilter }),
      setExtensionFilter: (extensionFilter) => set({ extensionFilter }),
      setCheckedOutFilter: (checkedOutFilter) => set({ checkedOutFilter }),
      
      // Actions - Layout
      toggleSidebar: () => {
        const { sidebarVisible, tabsEnabled, activeTabId, tabs } = get()
        const newVisible = !sidebarVisible
        set({ sidebarVisible: newVisible })
        // Sync with active tab if tabs enabled
        if (tabsEnabled && activeTabId) {
          set({
            tabs: tabs.map(t => 
              t.id === activeTabId ? { ...t, panelState: { ...t.panelState, sidebarVisible: newVisible } } : t
            )
          })
        }
      },
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(900, width)) }),
      setActivityBarMode: (mode) => set({ activityBarMode: mode }),
      setActiveView: (activeView) => set({ activeView, sidebarVisible: true }),
      setGdriveNavigation: (folderId, folderName, isSharedDrive, driveId) => set({
        gdriveCurrentFolderId: folderId,
        gdriveCurrentFolderName: folderName || null,
        gdriveIsSharedDrive: isSharedDrive || false,
        gdriveDriveId: driveId || null
      }),
      setGdriveOpenDocument: (doc) => set({ gdriveOpenDocument: doc }),
      incrementGdriveAuthVersion: () => set((s) => ({ gdriveAuthVersion: s.gdriveAuthVersion + 1 })),
      toggleDetailsPanel: () => {
        const { detailsPanelVisible, tabsEnabled, activeTabId, tabs } = get()
        const newVisible = !detailsPanelVisible
        set({ detailsPanelVisible: newVisible })
        // Sync with active tab if tabs enabled
        if (tabsEnabled && activeTabId) {
          set({
            tabs: tabs.map(t => 
              t.id === activeTabId ? { ...t, panelState: { ...t.panelState, detailsPanelVisible: newVisible } } : t
            )
          })
        }
      },
      setDetailsPanelHeight: (height) => set({ detailsPanelHeight: Math.max(100, Math.min(1200, height)) }),
      setDetailsPanelTab: (detailsPanelTab) => set({ detailsPanelTab }),
      
      // Actions - Tabs (file browser workspaces)
      setTabsEnabled: (enabled) => set({ tabsEnabled: enabled }),
      
      addTab: (folderPath, title) => {
        const { currentFolder, sidebarVisible, detailsPanelVisible, rightPanelVisible } = get()
        const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const folder = folderPath ?? currentFolder
        const folderName = folder ? folder.split(/[/\\]/).pop() || 'Root' : 'Explorer'
        
        const newTab: Tab = {
          id,
          title: title || folderName,
          folderPath: folder,
          panelState: { sidebarVisible, detailsPanelVisible, rightPanelVisible }
        }
        set((s) => ({
          tabs: [...s.tabs, newTab],
          activeTabId: id,
        }))
        return id
      },
      
      closeTab: (tabId) => {
        const { tabs, activeTabId } = get()
        
        // Always keep at least one tab
        if (tabs.length <= 1) return
        
        const tabIndex = tabs.findIndex(t => t.id === tabId)
        if (tabIndex === -1) return
        
        // Don't close pinned tabs directly
        const tab = tabs[tabIndex]
        if (tab.isPinned) return
        
        const newTabs = tabs.filter(t => t.id !== tabId)
        
        // If closing active tab, switch to adjacent tab
        let newActiveId = activeTabId
        let newActiveTab: Tab | undefined
        if (activeTabId === tabId && newTabs.length > 0) {
          const newIndex = Math.min(tabIndex, newTabs.length - 1)
          newActiveTab = newTabs[newIndex]
          newActiveId = newActiveTab.id
        }
        
        // Restore the new active tab's state
        if (newActiveTab) {
          set({
            tabs: newTabs,
            activeTabId: newActiveId,
            currentFolder: newActiveTab.folderPath,
            sidebarVisible: newActiveTab.panelState.sidebarVisible,
            detailsPanelVisible: newActiveTab.panelState.detailsPanelVisible,
            rightPanelVisible: newActiveTab.panelState.rightPanelVisible,
          })
        } else {
          set({ tabs: newTabs, activeTabId: newActiveId })
        }
      },
      
      closeOtherTabs: (tabId) => {
        const { tabs } = get()
        const tab = tabs.find(t => t.id === tabId)
        if (!tab) return
        
        // Keep the current tab and pinned tabs
        const newTabs = tabs.filter(t => t.id === tabId || t.isPinned)
        set({
          tabs: newTabs,
          activeTabId: tabId,
        })
      },
      
      setActiveTab: (tabId) => {
        const { tabs, activeTabId } = get()
        if (tabId === activeTabId) return
        
        const tab = tabs.find(t => t.id === tabId)
        if (tab) {
          // Restore the tab's folder and panel state
          set({
            activeTabId: tabId,
            currentFolder: tab.folderPath,
            sidebarVisible: tab.panelState.sidebarVisible,
            detailsPanelVisible: tab.panelState.detailsPanelVisible,
            rightPanelVisible: tab.panelState.rightPanelVisible,
          })
        }
      },
      
      moveTab: (tabId, newIndex) => {
        const { tabs } = get()
        const currentIndex = tabs.findIndex(t => t.id === tabId)
        if (currentIndex === -1 || newIndex < 0 || newIndex >= tabs.length) return
        
        const newTabs = [...tabs]
        const [movedTab] = newTabs.splice(currentIndex, 1)
        newTabs.splice(newIndex, 0, movedTab)
        set({ tabs: newTabs })
      },
      
      pinTab: (tabId) => {
        const { tabs } = get()
        const newTabs = tabs.map(t => 
          t.id === tabId ? { ...t, isPinned: true } : t
        )
        // Move pinned tab to the front (after other pinned tabs)
        const pinnedCount = newTabs.filter(t => t.isPinned && t.id !== tabId).length
        const tabIndex = newTabs.findIndex(t => t.id === tabId)
        if (tabIndex > pinnedCount) {
          const [tab] = newTabs.splice(tabIndex, 1)
          newTabs.splice(pinnedCount, 0, tab)
        }
        set({ tabs: newTabs })
      },
      
      unpinTab: (tabId) => {
        const { tabs } = get()
        set({
          tabs: tabs.map(t => 
            t.id === tabId ? { ...t, isPinned: false } : t
          )
        })
      },
      
      duplicateTab: (tabId) => {
        const { tabs } = get()
        const tab = tabs.find(t => t.id === tabId)
        if (!tab) return ''
        
        const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const newTab: Tab = {
          ...tab,
          id: newId,
          isPinned: false,
          title: `${tab.title} (Copy)`,
        }
        
        const tabIndex = tabs.findIndex(t => t.id === tabId)
        const newTabs = [...tabs]
        newTabs.splice(tabIndex + 1, 0, newTab)
        
        set({
          tabs: newTabs,
          activeTabId: newId,
        })
        return newId
      },
      
      updateTabTitle: (tabId, title) => {
        const { tabs } = get()
        set({
          tabs: tabs.map(t => 
            t.id === tabId ? { ...t, title } : t
          )
        })
      },
      
      updateTabFolder: (tabId, folderPath) => {
        const { tabs } = get()
        const folderName = folderPath ? folderPath.split(/[/\\]/).pop() || 'Root' : 'Explorer'
        set({
          tabs: tabs.map(t => 
            t.id === tabId ? { ...t, folderPath, title: folderName } : t
          )
        })
      },
      
      updateTabPanelState: (tabId, panelState) => {
        const { tabs } = get()
        set({
          tabs: tabs.map(t => 
            t.id === tabId ? { ...t, panelState: { ...t.panelState, ...panelState } } : t
          )
        })
      },
      
      syncCurrentTabWithState: () => {
        const { activeTabId, tabs, currentFolder, sidebarVisible, detailsPanelVisible, rightPanelVisible } = get()
        if (!activeTabId) return
        
        const folderName = currentFolder ? currentFolder.split(/[/\\]/).pop() || 'Root' : 'Explorer'
        set({
          tabs: tabs.map(t => 
            t.id === activeTabId ? {
              ...t,
              folderPath: currentFolder,
              title: folderName,
              panelState: { sidebarVisible, detailsPanelVisible, rightPanelVisible }
            } : t
          )
        })
      },
      
      // Tab Groups
      createTabGroup: (name, color) => {
        const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const newGroup: TabGroup = { id, name, color }
        set((s) => ({
          tabGroups: [...s.tabGroups, newGroup]
        }))
        return id
      },
      
      deleteTabGroup: (groupId) => {
        const { tabGroups, tabs } = get()
        set({
          tabGroups: tabGroups.filter(g => g.id !== groupId),
          tabs: tabs.map(t => 
            t.groupId === groupId ? { ...t, groupId: undefined } : t
          )
        })
      },
      
      renameTabGroup: (groupId, name) => {
        const { tabGroups } = get()
        set({
          tabGroups: tabGroups.map(g => 
            g.id === groupId ? { ...g, name } : g
          )
        })
      },
      
      addTabToGroup: (tabId, groupId) => {
        const { tabs } = get()
        set({
          tabs: tabs.map(t => 
            t.id === tabId ? { ...t, groupId } : t
          )
        })
      },
      
      removeTabFromGroup: (tabId) => {
        const { tabs } = get()
        set({
          tabs: tabs.map(t => 
            t.id === tabId ? { ...t, groupId: undefined } : t
          )
        })
      },
      
      // Actions - Right Panel
      toggleRightPanel: () => {
        const { rightPanelVisible, rightPanelTabs, tabsEnabled, activeTabId, tabs } = get()
        let newVisible: boolean
        if (!rightPanelVisible && rightPanelTabs.length === 0) {
          // If showing right panel but no tabs, add properties tab
          set({ 
            rightPanelVisible: true, 
            rightPanelTabs: ['properties'], 
            rightPanelTab: 'properties' 
          })
          newVisible = true
        } else {
          newVisible = !rightPanelVisible
          set({ rightPanelVisible: newVisible })
        }
        // Sync with active tab if tabs enabled
        if (tabsEnabled && activeTabId) {
          set({
            tabs: tabs.map(t => 
              t.id === activeTabId ? { ...t, panelState: { ...t.panelState, rightPanelVisible: newVisible } } : t
            )
          })
        }
      },
      setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(200, Math.min(1200, width)) }),
      setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
      moveTabToRight: (tab) => {
        const { rightPanelTabs, detailsPanelTab } = get()
        // Add tab to right panel if not already there
        if (!rightPanelTabs.includes(tab)) {
          set({ 
            rightPanelTabs: [...rightPanelTabs, tab],
            rightPanelTab: tab,
            rightPanelVisible: true,
            // If we moved the active bottom tab, switch to another
            detailsPanelTab: detailsPanelTab === tab ? 'properties' : detailsPanelTab
          })
        }
      },
      moveTabToBottom: (tab) => {
        const { rightPanelTabs, rightPanelTab } = get()
        const newTabs = rightPanelTabs.filter(t => t !== tab)
        set({ 
          rightPanelTabs: newTabs,
          rightPanelTab: newTabs.length > 0 ? (rightPanelTab === tab ? newTabs[0] : rightPanelTab) : null,
          rightPanelVisible: newTabs.length > 0,
          detailsPanelTab: tab
        })
      },
      
      // Actions - Terminal
      toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
      setTerminalHeight: (height) => set({ terminalHeight: Math.max(150, Math.min(600, height)) }),
      addTerminalHistory: (command) => set((s) => {
        // Don't add duplicate consecutive commands
        if (s.terminalHistory[0] === command) return s
        // Keep last 100 commands
        return { terminalHistory: [command, ...s.terminalHistory.slice(0, 99)] }
      }),
      
      // Actions - History
      setHistoryFolderFilter: (folderPath) => set({ historyFolderFilter: folderPath }),
      
      // Actions - Trash
      setTrashFolderFilter: (folderPath) => set({ trashFolderFilter: folderPath }),
      
      // Actions - Ignore Patterns
      addIgnorePattern: (vaultId, pattern) => {
        const { ignorePatterns } = get()
        const current = ignorePatterns[vaultId] || []
        if (!current.includes(pattern)) {
          set({
            ignorePatterns: {
              ...ignorePatterns,
              [vaultId]: [...current, pattern]
            }
          })
        }
      },
      removeIgnorePattern: (vaultId, pattern) => {
        const { ignorePatterns } = get()
        const current = ignorePatterns[vaultId] || []
        set({
          ignorePatterns: {
            ...ignorePatterns,
            [vaultId]: current.filter(p => p !== pattern)
          }
        })
      },
      setIgnorePatterns: (vaultId, patterns) => {
        const { ignorePatterns } = get()
        set({
          ignorePatterns: {
            ...ignorePatterns,
            [vaultId]: patterns
          }
        })
      },
      getIgnorePatterns: (vaultId) => {
        const { ignorePatterns } = get()
        return ignorePatterns[vaultId] || []
      },
      isPathIgnored: (vaultId, relativePath) => {
        const patterns = get().ignorePatterns[vaultId] || []
        const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase()
        
        for (const pattern of patterns) {
          const normalizedPattern = pattern.toLowerCase()
          
          // Extension pattern: *.ext
          if (normalizedPattern.startsWith('*.')) {
            const ext = normalizedPattern.slice(1) // ".ext"
            if (normalizedPath.endsWith(ext)) return true
          }
          // Folder pattern: foldername/ or foldername/**
          else if (normalizedPattern.endsWith('/') || normalizedPattern.endsWith('/**')) {
            const folderPattern = normalizedPattern.replace(/\/\*\*$/, '/').replace(/\/$/, '')
            // Match exact folder or any nested path
            if (normalizedPath === folderPattern || 
                normalizedPath.startsWith(folderPattern + '/') ||
                normalizedPath.includes('/' + folderPattern + '/') ||
                normalizedPath.includes('/' + folderPattern)) {
              return true
            }
          }
          // Exact match pattern
          else if (normalizedPath === normalizedPattern || 
                   normalizedPath.endsWith('/' + normalizedPattern)) {
            return true
          }
          // Simple wildcard matching for other patterns
          else if (normalizedPattern.includes('*')) {
            const regex = new RegExp(
              '^' + normalizedPattern
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*') + '$'
            )
            if (regex.test(normalizedPath)) return true
          }
        }
        return false
      },
      
      // Actions - Notifications & Reviews
      setUnreadNotificationCount: (count) => set({ unreadNotificationCount: count }),
      setPendingReviewCount: (count) => set({ pendingReviewCount: count }),
      incrementNotificationCount: () => set(state => ({ unreadNotificationCount: state.unreadNotificationCount + 1 })),
      decrementNotificationCount: (amount = 1) => set(state => ({ 
        unreadNotificationCount: Math.max(0, state.unreadNotificationCount - amount) 
      })),
      
      // Actions - Orphaned Checkouts
      addOrphanedCheckout: (checkout) => set(state => ({
        orphanedCheckouts: [...state.orphanedCheckouts.filter(c => c.fileId !== checkout.fileId), checkout]
      })),
      removeOrphanedCheckout: (fileId) => set(state => ({
        orphanedCheckouts: state.orphanedCheckouts.filter(c => c.fileId !== fileId)
      })),
      clearOrphanedCheckouts: () => set({ orphanedCheckouts: [] }),
      
      // Actions - Missing Storage Files
      setMissingStorageFiles: (files) => set({ missingStorageFiles: files }),
      clearMissingStorageFiles: () => set({ missingStorageFiles: [] }),
      
      // Actions - Columns
      setColumnWidth: (id, width) => {
        const { columns } = get()
        set({
          columns: columns.map(c => c.id === id ? { ...c, width: Math.max(40, width) } : c)
        })
      },
      toggleColumnVisibility: (id) => {
        const { columns } = get()
        set({
          columns: columns.map(c => c.id === id ? { ...c, visible: !c.visible } : c)
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
          const columnDefaults = columns.map(c => ({
            id: c.id,
            width: c.width,
            visible: c.visible
          }))
          
          const { error } = await (supabase.rpc as any)('set_org_column_defaults', {
            p_org_id: organization.id,
            p_column_defaults: columnDefaults
          })
          
          if (error) throw error
          return { success: true }
        } catch (err) {
          console.error('Failed to save org column defaults:', err)
          return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
      },
      
      loadOrgColumnDefaults: async () => {
        const { organization, columns } = get()
        if (!organization?.id) {
          return { success: false, error: 'No organization connected' }
        }
        
        try {
          const { data, error } = await (supabase.rpc as any)('get_org_column_defaults', {
            p_org_id: organization.id
          })
          
          if (error) throw error
          
          if (!data || !Array.isArray(data) || data.length === 0) {
            return { success: false, error: 'No org defaults configured' }
          }
          
          // Merge org defaults with current columns (preserving label/sortable)
          const updatedColumns = columns.map(col => {
            const orgDefault = data.find((d: { id: string }) => d.id === col.id)
            if (orgDefault) {
              return {
                ...col,
                width: orgDefault.width ?? col.width,
                visible: orgDefault.visible ?? col.visible
              }
            }
            return col
          })
          
          set({ columns: updatedColumns })
          return { success: true }
        } catch (err) {
          console.error('Failed to load org column defaults:', err)
          return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
      },
      
      resetColumnsToDefaults: () => {
        set({ columns: defaultColumns })
      },
      
      // Actions - Status
      setIsLoading: (isLoading) => set({ isLoading }),
      setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
      setStatusMessage: (statusMessage) => set({ statusMessage }),
      setFilesLoaded: (filesLoaded) => set({ filesLoaded }),
      
      // Actions - Sync Progress
      setSyncProgress: (progress) => set(state => ({ 
        syncProgress: { ...state.syncProgress, ...progress } 
      })),
      startSync: (total, operation = 'upload') => set({ 
        syncProgress: { isActive: true, operation, current: 0, total, percent: 0, speed: '', cancelRequested: false } 
      }),
      updateSyncProgress: (current, percent, speed) => set(state => ({ 
        syncProgress: { ...state.syncProgress, current, percent, speed } 
      })),
      requestCancelSync: () => set(state => ({ 
        syncProgress: { ...state.syncProgress, cancelRequested: true } 
      })),
      endSync: () => {
        set({ 
          syncProgress: { isActive: false, operation: 'upload', current: 0, total: 0, percent: 0, speed: '', cancelRequested: false } 
        })
        // Process the queue after ending sync so the next operation can start
        setTimeout(() => get().processQueue(), 100)
      },
      
      // Actions - Processing Folders
      addProcessingFolder: (path) => set(state => {
        const newSet = new Set(state.processingFolders)
        newSet.add(path)
        return { processingFolders: newSet }
      }),
      // Batch add - single state update for multiple paths
      addProcessingFolders: (paths) => {
        if (paths.length === 0) return
        set(state => {
          const newSet = new Set(state.processingFolders)
          paths.forEach(p => newSet.add(p))
          return { processingFolders: newSet }
        })
      },
      removeProcessingFolder: (path) => {
        set(state => {
          const newSet = new Set(state.processingFolders)
          newSet.delete(path)
          return { processingFolders: newSet }
        })
        // Try to process queued operations after a folder is done
        setTimeout(() => get().processQueue(), 100)
      },
      // Batch remove - single state update for multiple paths
      removeProcessingFolders: (paths) => {
        if (paths.length === 0) return
        set(state => {
          const newSet = new Set(state.processingFolders)
          paths.forEach(p => newSet.delete(p))
          return { processingFolders: newSet }
        })
        // Try to process queued operations after paths are done
        setTimeout(() => get().processQueue(), 100)
      },
      clearProcessingFolders: () => set({ processingFolders: new Set() }),
      
      // Actions - Operation Queue
      queueOperation: (operation) => {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const fullOperation: QueuedOperation = { ...operation, id }
        
        set(state => ({
          operationQueue: [...state.operationQueue, fullOperation]
        }))
        
        // Try to process the queue immediately
        setTimeout(() => get().processQueue(), 0)
        
        return id
      },
      
      removeFromQueue: (id) => set(state => ({
        operationQueue: state.operationQueue.filter(op => op.id !== id)
      })),
      
      hasPathConflict: (paths) => {
        const { processingFolders } = get()
        
        // Check if any of the requested paths overlap with currently processing paths
        for (const path of paths) {
          for (const processingPath of processingFolders) {
            // Check if paths overlap (one contains the other or they're the same)
            if (path === processingPath || 
                path.startsWith(processingPath + '/') || 
                path.startsWith(processingPath + '\\') ||
                processingPath.startsWith(path + '/') || 
                processingPath.startsWith(path + '\\')) {
              return true
            }
          }
        }
        return false
      },
      
      processQueue: async () => {
        const { operationQueue, hasPathConflict, removeFromQueue, addToast, syncProgress } = get()
        
        if (operationQueue.length === 0) return
        
        // Don't start a new operation if one is already running
        // This ensures the progress bar only shows one operation at a time
        if (syncProgress.isActive) return
        
        // Find the first operation that doesn't have a path conflict
        for (const operation of operationQueue) {
          if (!hasPathConflict(operation.paths)) {
            // Remove from queue before executing
            removeFromQueue(operation.id)
            
            try {
              await operation.execute()
            } catch (err) {
              console.error('Queue operation failed:', err)
              addToast('error', `Operation failed: ${operation.label}`)
            }
            
            // After completing, try to process more from the queue
            setTimeout(() => get().processQueue(), 100)
            return
          }
        }
        
        // All operations have conflicts, will try again when a processing folder is removed
      },
      
      // Getters
      getSelectedFileObjects: () => {
        const { files, selectedFiles } = get()
        return files.filter(f => selectedFiles.includes(f.path))
      },
      
      getVisibleFiles: () => {
        const { files, expandedFolders, stateFilter, extensionFilter, searchQuery } = get()
        
        let visible = files.filter(file => {
          // Check if parent folder is expanded
          const parts = file.relativePath.split('/')
          if (parts.length > 1) {
            // Check all ancestor folders
            for (let i = 1; i <= parts.length - 1; i++) {
              const ancestorPath = parts.slice(0, i).join('/')
              if (!expandedFolders.has(ancestorPath)) {
                return false
              }
            }
          }
          return true
        })
        
        // Apply search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          visible = visible.filter(f => 
            f.name.toLowerCase().includes(query) ||
            f.relativePath.toLowerCase().includes(query) ||
            f.pdmData?.part_number?.toLowerCase().includes(query) ||
            f.pdmData?.description?.toLowerCase().includes(query)
          )
        }
        
        // Apply state filter
        if (stateFilter.length > 0) {
          visible = visible.filter(f => 
            f.isDirectory || !f.pdmData?.state || stateFilter.includes(f.pdmData.state)
          )
        }
        
        // Apply extension filter
        if (extensionFilter.length > 0) {
          visible = visible.filter(f => 
            f.isDirectory || extensionFilter.includes(f.extension)
          )
        }
        
        return visible
      },
      
      getFileByPath: (path) => {
        const { files } = get()
        return files.find(f => f.path === path)
      },
      
      // Get files that exist on server but not locally (deleted)
      getDeletedFiles: () => {
        const { files, serverFiles, vaultPath } = get()
        if (!vaultPath) return []
        
        // Use lowercase for case-insensitive matching (Windows compatibility)
        const localPaths = new Set(files.map(f => f.relativePath.toLowerCase()))
        
        return serverFiles
          .filter(sf => !localPaths.has(sf.file_path.toLowerCase()))
          .map(sf => ({
            name: sf.name,
            path: buildFullPath(vaultPath, sf.file_path),
            relativePath: sf.file_path,
            isDirectory: false,
            extension: sf.extension,
            size: 0,
            modifiedTime: '',
            diffStatus: 'deleted' as DiffStatus,
            pdmData: { id: sf.id } as any
          }))
      },
      
      // Get diff counts for a folder (counts all files recursively in folder and subfolders)
      getFolderDiffCounts: (folderPath: string) => {
        const { files } = get()
        
        let added = 0
        let modified = 0
        let moved = 0
        let deleted = 0
        let outdated = 0
        let cloud = 0
        let cloudNew = 0
        
        // Count all files (including cloud-only entries) recursively
        const prefix = folderPath ? folderPath + '/' : ''
        for (const file of files) {
          if (file.isDirectory) continue
          
          // Check if file is in this folder or subfolder
          if (folderPath) {
            if (!file.relativePath.startsWith(prefix)) continue
          }
          
          if (file.diffStatus === 'added') added++
          else if (file.diffStatus === 'modified') modified++
          else if (file.diffStatus === 'moved') moved++
          else if (file.diffStatus === 'deleted') deleted++
          else if (file.diffStatus === 'outdated') outdated++
          else if (file.diffStatus === 'cloud') cloud++
          else if (file.diffStatus === 'cloud_new') cloudNew++
        }
        
        return { added, modified, moved, deleted, outdated, cloud, cloudNew }
      }
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
        // Tabs
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        tabGroups: state.tabGroups,
        tabsEnabled: state.tabsEnabled,
        columns: state.columns,
        expandedFolders: Array.from(state.expandedFolders),
        ignorePatterns: state.ignorePatterns,
        terminalVisible: state.terminalVisible,
        terminalHeight: state.terminalHeight,
        terminalHistory: state.terminalHistory.slice(0, 100),  // Keep last 100
        moduleConfig: state.moduleConfig,
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
          // This ensures the URL is available before org loads; once org loads, server value wins
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
            const persistedCol = (persisted.columns as ColumnConfig[] || [])
              .find(c => c.id === defaultCol.id)
            return persistedCol ? { ...defaultCol, ...persistedCol } : defaultCol
          }),
          // Ensure ignorePatterns has a default
          ignorePatterns: (persisted.ignorePatterns as Record<string, string[]>) || {},
          // Terminal settings
          terminalVisible: (persisted.terminalVisible as boolean) || false,
          terminalHeight: (persisted.terminalHeight as number) || 250,
          terminalHistory: (persisted.terminalHistory as string[]) || [],
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
                // Old dividers with afterGroup are discarded, new position-based used
                dividers = defaults.dividers
              } else {
                // New format - use persisted dividers
                dividers = persistedConfig.dividers.filter(
                  (d: SectionDivider) => typeof d.position === 'number'
                )
              }
            }
            
            // Module parents - merge with defaults
            const moduleParents = { ...defaults.moduleParents }
            if (persistedConfig.moduleParents) {
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
            
            // Custom groups - use persisted if available
            const customGroups = persistedConfig.customGroups || defaults.customGroups
            
            return { enabledModules, enabledGroups, moduleOrder, dividers, moduleParents, moduleIconColors, customGroups }
          })(),
          // Ensure there's always at least one tab
          tabs: (() => {
            const persistedTabs = persisted.tabs as Tab[] | undefined
            if (!persistedTabs || persistedTabs.length === 0) {
              return [{
                id: 'default-tab',
                title: 'Explorer',
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

// Convenience hooks
export function useSelectedFiles() {
  return usePDMStore(s => s.getSelectedFileObjects())
}

export function useVisibleFiles() {
  return usePDMStore(s => s.getVisibleFiles())
}

