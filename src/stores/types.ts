// Store types - extracted from pdmStore.ts for use across slices
import type { PDMFile, Organization, User } from '../types/pdm'
import type { ModuleId, ModuleConfig } from '../types/modules'
import type {
  KeybindingsConfig,
  KeybindingAction,
  Keybinding,
  SettingsTab,
} from '../types/settings'
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
} from '../types/workflow'
import type {
  OrgUser,
  TeamWithDetails,
  PendingMember,
} from '../features/settings/organization/team-members/types'
import type { OperationLogSlice } from './slices/operationLogSlice'
import type { NewAnnotationData } from '../features/source/details/components/PdfAnnotationViewer'
import type { FileAnnotation, ECO, Supplier } from '../types/database'

// ============================================================================
// Type Aliases — UI enums & discriminated unions
// TODO(decompose): Extract UI type aliases (SidebarView, DetailsPanelTab,
// PanelPosition, ToastType, ThemeMode, Language) to src/types/ui.ts
// ============================================================================

export type SidebarView =
  // Source Files
  | 'explorer'
  | 'pending'
  | 'history'
  | 'workflows'
  | 'reviews'
  | 'trash'
  // Items
  | 'items'
  | 'boms'
  | 'products'
  // Change Control
  | 'ecr'
  | 'eco'
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
  // Customers
  | 'customers'
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

export type DetailsPanelTab =
  | 'properties'
  | 'preview'
  | 'whereused'
  | 'datacard'
  | 'vendors'
  | 'inspection'
export type PanelPosition = 'bottom' | 'right'
export type ToastType = 'error' | 'success' | 'info' | 'warning' | 'progress' | 'update'
export type ThemeMode =
  | 'dark'
  | 'deep-blue'
  | 'light'
  | 'christmas'
  | 'halloween'
  | 'weather'
  | 'kenneth'
  | 'system'
export type Language =
  | 'en'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'pt'
  | 'ja'
  | 'zh-CN'
  | 'zh-TW'
  | 'ko'
  | 'nl'
  | 'sv'
  | 'pl'
  | 'ru'
  | 'sindarin'
export type DiffStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'outdated'
  | 'cloud'
  | 'moved'
  | 'ignored'
  | 'deleted_remote'

/** Operation type for tracking which operation is running on a file/folder (for inline button spinners) */
export type OperationType =
  | 'checkout'
  | 'checkin'
  | 'download'
  | 'upload'
  | 'delete'
  | 'sync'
  | 'export'

// ============================================================================
// --- Domain models below should be extracted to src/types/ ---
// These interfaces describe domain concepts (files, vaults, operations, tabs)
// that are consumed far beyond the Zustand store. Moving them to src/types/
// would decouple consumers from importing @/stores/types.
// ============================================================================

// TODO(decompose): Extract to src/types/ui.ts — Tab, TabGroup, TabPanelState,
// ColumnConfig, CardViewFieldConfig, ColorSwatch (UI configuration models)

// Tab system - browser-like tabs for file browser workspaces
export interface TabPanelState {
  sidebarVisible: boolean
  detailsPanelVisible: boolean
  rightPanelVisible: boolean
}

export interface Tab {
  id: string // Unique tab ID
  title: string // Tab display title (folder name or custom)
  folderPath: string // Current folder path in file browser
  panelState: TabPanelState // Which panels are visible
  groupId?: string // Optional tab group ID
  isPinned?: boolean // Pinned tabs can't be closed easily
}

export interface TabGroup {
  id: string
  name: string
  color: string // Tailwind color class or hex color
  collapsed?: boolean // Whether the group is collapsed
}

// Connected vault - an org vault that's connected locally
export interface ConnectedVault {
  id: string // Vault ID from database
  name: string // Vault name
  localPath: string // Local folder path
  isExpanded: boolean // UI state - is this vault expanded in explorer
  hasCompletedSetup?: boolean // Whether user has completed the first-time setup wizard
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
    label?: string // Custom label (e.g., "214/398 MB") - overrides default current/total display
    queued?: boolean // True if operation is waiting in queue (not yet started)
  }
}

// TODO(decompose): Extract to src/types/files.ts — LocalFile, ServerFile,
// PendingMetadata, FileLocationUpdate, DiffStatus, OperationType,
// OrphanedCheckout, MissingStorageFile, StagedCheckin, PendingLargeUpload
// (core file-management domain models used across hooks, commands, and components)

// Pending metadata changes (not yet synced to server)
export interface PendingMetadata {
  part_number?: string | null
  description?: string | null
  revision?: string
  // File-level tab number (for single-config or no-config files)
  tab_number?: string | null
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
  isSynced?: boolean // True if file exists in cloud
  // Diff status (compared to server)
  diffStatus?: DiffStatus
  // Local content hash (for detecting modifications)
  localHash?: string
  // Pending metadata changes (saved locally, synced on check-in)
  pendingMetadata?: PendingMetadata
  // Local active version (set after rollback, before check-in)
  // This tracks which version's content is currently in the local file
  localActiveVersion?: number
  // Tracked local version (the version number of content currently on disk)
  // Set when: file is downloaded, checked in, or rolled back
  // Used for accurate version display instead of assuming "cloudVersion - 1"
  localVersion?: number
  // Pending version notes (version_id -> note, synced on check-in)
  // Allows editing notes on historical versions while file is checked out
  pendingVersionNotes?: Record<string, string>
  // Note for the upcoming local version (saved as comment when checked in)
  pendingCheckinNote?: string
  // Source file info for version history copying (set on paste, consumed on first sync)
  copiedFromFileId?: string
  copiedVersion?: number
  // NTFS file index number - persistent across renames on the same volume
  ino?: number
}

// Server file info (for tracking deleted files)
export interface ServerFile {
  id: string
  file_path: string
  name: string
  extension: string
  content_hash: string
}

// File location update from realtime events (for batching multiple moves)
export interface FileLocationUpdate {
  fileId: string
  newRelativePath: string
  newFileName: string
  pdmData: import('../types/pdm').PDMFile
}

// TODO(decompose): Extract to src/types/operations.ts — QueuedOperation,
// ConnectedVault (operation/vault domain models)

// Queued operation for non-blocking file operations
export interface QueuedOperation {
  id: string
  type:
    | 'download'
    | 'get-latest'
    | 'delete'
    | 'upload'
    | 'sync'
    | 'checkin'
    | 'checkout'
    | 'discard'
    | 'force-release'
  label: string // Human-readable description
  paths: string[] // Folder/file paths being operated on
  toastId: string // ID of the progress toast for this operation
  fileCount: number // Number of files in this operation
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

// Card view field configuration for icon/grid view
export interface CardViewFieldConfig {
  id: string // Field identifier (same as column ids)
  label: string // Display label
  visible: boolean
}

// TODO(decompose): Extract to src/types/solidworks.ts — SWConfiguration,
// ConfigBomItem, DrawingRefItem (SolidWorks-specific domain models used in
// file browser, pending view, and config handlers)

// SolidWorks configuration with tree depth (for config expansion in file browser)
export interface SWConfiguration {
  name: string
  isActive?: boolean
  parentConfiguration?: string | null
  tabNumber?: string
  description?: string
  depth: number // Tree depth for indentation
}

// BOM item for configuration-specific display in file browser
export interface ConfigBomItem {
  id: string
  child_file_id: string
  file_name: string
  file_path: string
  file_type: 'part' | 'assembly' | 'drawing' | 'other'
  part_number: string | null
  description: string | null
  revision: string | null
  state: string | null
  quantity: number
  configuration: string | null
  in_database: boolean
  /** True if the referenced file doesn't exist on disk (broken reference) */
  is_broken?: boolean
}

// Drawing reference item for drawing-related expand/collapse dropdowns in file browser.
// Used for two scenarios:
//   1. Expanding a .slddrw file to show which models it references
//   2. Expanding a config row to show which drawings reference that part/assembly config
export interface DrawingRefItem {
  id: string
  file_id: string
  file_name: string
  file_path: string
  file_type: 'part' | 'assembly' | 'drawing' | 'other'
  part_number: string | null
  description: string | null
  revision: string | null
  state: string | null
  configuration: string | null
  /** All configurations of this file that the parent drawing references (from DB enrichment) */
  configurations?: string[]
  /** Per-config tab numbers (from pendingMetadata.config_tabs or pdmData) */
  config_tabs?: Record<string, string>
  /** Per-config descriptions (from pendingMetadata.config_descriptions) */
  config_descriptions?: Record<string, string>
  /** Per-config revisions (from pdmData.configuration_revisions) */
  configuration_revisions?: Record<string, string>
  in_database: boolean
}

// Orphaned checkout - file was force-checked-in from another machine
export interface OrphanedCheckout {
  fileId: string
  fileName: string
  filePath: string // Relative path in vault
  localPath: string // Full local path
  checkedInBy: string // Machine name that force-checked-in
  checkedInAt: string | null // When it was checked in
  newVersion: number // The new server version
  localHash?: string // Hash of local file (if available)
  serverHash?: string // Hash of server file
}

// Files that show as "needs update" but the storage blob is missing
// This happens when a check-in partially failed (database updated but upload failed)
export interface MissingStorageFile {
  fileId: string
  fileName: string
  filePath: string // Relative path in vault
  serverHash: string // The hash that's missing from storage
  version: number // The version that's missing
  detectedAt: string // When we detected this issue
}

// Pending upload with large files - waiting for user decision
export interface PendingLargeUpload {
  /** All files that were originally selected for upload */
  files: LocalFile[]
  /** Files that exceed the size threshold */
  largeFiles: Array<{
    name: string
    relativePath: string
    size: number
  }>
  /** Files that are under the threshold */
  smallFiles: LocalFile[]
  /** Command to execute ('sync' or 'checkin') */
  command: 'sync' | 'checkin'
  /** Original command options */
  options?: { extractReferences?: boolean }
  /** Callback to trigger after user decision */
  onRefresh?: (silent?: boolean) => void
}

// Staged check-in - file modified locally while offline, queued for check-in when online
export interface StagedCheckin {
  relativePath: string // Relative path in vault (unique key)
  fileName: string // File name for display
  localHash: string // Hash of local file at time of staging
  stagedAt: string // ISO timestamp when staged
  comment?: string // Optional check-in comment
  serverVersion?: number // Server version at time of staging (for conflict detection)
  serverHash?: string // Server content hash at time of staging (for conflict detection)
}

// Color swatch for custom color picker colors
export interface ColorSwatch {
  id: string
  color: string // Hex color value
  isOrg: boolean // True if org-level swatch, false if user-level
  createdAt: string // ISO timestamp
}

// Impersonated user context - full context for viewing as another user
export interface ImpersonatedUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: 'admin' | 'engineer' | 'viewer'
  teams: Array<{ id: string; name: string; color: string; icon: string }>
  permissions: Record<string, string[]> // resource -> actions
  vaultIds: string[] // Accessible vault IDs (empty = all vaults)
  moduleConfig?: ModuleConfig // User's effective module config (from team defaults)
}

// --- End of domain models that should be extracted to src/types/ ---

// ============================================================================
// Slice State Types — Zustand slice contracts (should STAY in stores/types.ts)
// ============================================================================

export interface ToastsSlice {
  // State
  toasts: ToastMessage[]

  // Actions
  /**
   * Add a toast.
   * @param type - Toast type (error, success, info, warning, progress, update)
   * @param message - Message to display
   * @param duration - Duration in ms (default 5000, 0 for no auto-dismiss)
   */
  addToast: (type: ToastType, message: string, duration?: number) => void
  addProgressToast: (id: string, message: string, total: number, queued?: boolean) => void
  setProgressToastActive: (id: string) => void
  updateProgressToast: (
    id: string,
    current: number,
    percent: number,
    speed?: string,
    label?: string,
  ) => void
  requestCancelProgressToast: (id: string) => void
  isProgressToastCancelled: (id: string) => boolean
  removeToast: (id: string) => void
}

export interface UpdateSlice {
  // State
  updateAvailable: {
    version: string
    releaseDate?: string
    releaseNotes?: string
    downloadUrl?: string
    isManualVersion?: boolean
  } | null
  updateDownloading: boolean
  updateDownloaded: boolean
  updateProgress: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  } | null
  showUpdateModal: boolean
  installerPath: string | null

  // Actions
  setUpdateAvailable: (
    info: {
      version: string
      releaseDate?: string
      releaseNotes?: string
      downloadUrl?: string
      isManualVersion?: boolean
    } | null,
  ) => void
  setUpdateDownloading: (downloading: boolean) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setUpdateProgress: (
    progress: {
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    } | null,
  ) => void
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

  // Settings navigation
  settingsTab: SettingsTab

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

  // Deep Link
  pendingDeepLinkInstall: { extensionId: string; version?: string } | null

  // Clipboard (unified across FilePane and FileTree)
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null

  // Command confirmation dialog (shown from command handlers via ctx.confirm())
  pendingCommandConfirm: {
    title: string
    message: string
    items?: string[]
    confirmText?: string
  } | null

  // Review preview (full-screen PDF in reviews view)
  reviewPreviewFile: {
    filePath: string // local filesystem path for PDF rendering
    fileId: string | null // database ID for comments
    fileName: string
    fileVersion?: number | null
    reviewId: string
  } | null

  // Actions
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setActivityBarMode: (mode: 'expanded' | 'collapsed' | 'hover') => void
  setActiveView: (view: SidebarView) => void
  setGdriveNavigation: (
    folderId: string | null,
    folderName?: string,
    isSharedDrive?: boolean,
    driveId?: string,
  ) => void
  setGdriveOpenDocument: (
    doc: { id: string; name: string; mimeType: string; webViewLink?: string } | null,
  ) => void
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

  // Settings navigation
  setSettingsTab: (tab: SettingsTab) => void

  // Deep Link
  setPendingDeepLinkInstall: (data: { extensionId: string; version?: string } | null) => void
  clearPendingDeepLinkInstall: () => void

  // Clipboard
  setClipboard: (clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null) => void
  clearClipboard: () => void

  // Command confirmation dialog
  setPendingCommandConfirm: (confirm: UISlice['pendingCommandConfirm']) => void

  // Review preview
  setReviewPreviewFile: (file: UISlice['reviewPreviewFile']) => void
  clearReviewPreviewFile: () => void
}

export interface SettingsSlice {
  // State - Preview & Topbar
  cadPreviewMode: 'thumbnail' | 'edrawings'
  topbarConfig: {
    showFps: boolean
    showZoom: boolean
    showOrg: boolean
    showSearch: boolean
    showOnlineUsers: boolean
    showSolidworks: boolean
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
  // Drawing metadata lockouts - when true, drawing fields are read-only (inherited from model)
  lockDrawingRevision: boolean
  lockDrawingItemNumber: boolean
  lockDrawingDescription: boolean
  // Service logging
  solidworksServiceVerboseLogging: boolean // Enable detailed diagnostic output from service

  // State - API Server
  apiServerUrl: string | null

  // State - Display
  lowercaseExtensions: boolean
  viewMode: 'list' | 'icons'
  iconSize: number
  listRowSize: number
  treeRowSize: number
  theme: ThemeMode
  autoApplySeasonalThemes: boolean
  language: Language
  keybindings: KeybindingsConfig

  // State - Tree Filtering
  hideCloudOnlyFolders: boolean // Hide folders containing only cloud (non-downloaded) files

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
  autoDownloadSizeLimit: number // Max file size in MB for auto-download (0 = no limit)
  autoDownloadExcludedFiles: Record<string, string[]>

  // State - Auto-discard orphaned files
  autoDiscardOrphanedFiles: boolean // Automatically remove local files that no longer exist on server

  // State - Upload warnings
  uploadSizeWarningEnabled: boolean // Warn when uploading files over threshold
  uploadSizeWarningThreshold: number // File size threshold in MB (default: 100)

  // State - Pinned items
  pinnedFolders: { path: string; vaultId: string; vaultName: string; isDirectory: boolean }[]
  pinnedSectionExpanded: boolean

  // State - Color swatches
  colorSwatches: ColorSwatch[]
  orgColorSwatches: ColorSwatch[]

  // State - Columns
  columns: ColumnConfig[]
  /** Timestamp when user last synced/acknowledged org-forced column config (ms since epoch) */
  columnConfigLastSyncedAt: number | null

  // State - Card View Fields (for icon/grid view)
  cardViewFields: CardViewFieldConfig[]

  // State - Onboarding
  onboardingComplete: boolean
  logSharingEnabled: boolean

  // State - Windows Defender warning
  avExclusionWarningDismissed: boolean

  // State - Test Runner
  testFolderName: string // Name of the temporary test folder inside vault root (default "0 - Tests")

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
  setLockDrawingRevision: (enabled: boolean) => void
  setLockDrawingItemNumber: (enabled: boolean) => void
  setLockDrawingDescription: (enabled: boolean) => void
  setSolidworksServiceVerboseLogging: (enabled: boolean) => void

  // Actions - API Server
  setApiServerUrl: (url: string | null) => void

  // Actions - Display
  setLowercaseExtensions: (enabled: boolean) => void
  setViewMode: (mode: 'list' | 'icons') => void
  setIconSize: (size: number) => void
  setListRowSize: (size: number) => void
  setTreeRowSize: (size: number) => void
  setTheme: (theme: ThemeMode) => void
  setAutoApplySeasonalThemes: (enabled: boolean) => void
  setLanguage: (language: Language) => void
  setKeybinding: (action: KeybindingAction, keybinding: Keybinding) => void
  resetKeybindings: () => void

  // Actions - Tree Filtering
  setHideCloudOnlyFolders: (enabled: boolean) => void

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
  setAutoDownloadSizeLimit: (sizeMB: number) => void
  addAutoDownloadExclusion: (vaultId: string, relativePath: string) => void

  // Actions - Auto-discard orphaned files
  setAutoDiscardOrphanedFiles: (enabled: boolean) => void

  // Actions - Upload warnings
  setUploadSizeWarningEnabled: (enabled: boolean) => void
  setUploadSizeWarningThreshold: (sizeMB: number) => void
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
  /** Force-push current column config to all org users (admin only) */
  forceOrgColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  /** Save current column config as the user's personal defaults (synced across devices) */
  saveUserColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  /** Load the user's personal column defaults from the database */
  loadUserColumnDefaults: () => Promise<{ success: boolean; error?: string }>
  resetColumnsToDefaults: () => void

  // Actions - Card View Fields
  toggleCardViewFieldVisibility: (id: string) => void
  reorderCardViewFields: (fields: CardViewFieldConfig[]) => void
  resetCardViewFieldsToDefaults: () => void

  // Actions - Onboarding
  completeOnboarding: (options?: { solidworksIntegrationEnabled?: boolean }) => void
  setLogSharingEnabled: (enabled: boolean) => void

  // Actions - Windows Defender warning
  setAvExclusionWarningDismissed: (dismissed: boolean) => void

  // Actions - Test Runner
  setTestFolderName: (name: string) => void
}

export interface UserSlice {
  // State
  user: User | null
  organization: Organization | null
  isAuthenticated: boolean
  isOfflineMode: boolean
  isConnecting: boolean
  /** True once Supabase's INITIAL_SESSION event has been processed (regardless of session presence) */
  authInitialized: boolean
  impersonatedUser: ImpersonatedUser | null
  userTeams: Array<{ id: string; name: string; color: string; icon: string }> | null
  userPermissions: Record<string, string[]> | null
  userWorkflowRoleIds: string[]
  permissionsLoaded: boolean
  permissionsLastUpdated: number

  // Actions
  setUser: (user: User | null) => void
  setAuthInitialized: (initialized: boolean) => void
  setOrganization: (org: Organization | null) => void
  setOfflineMode: (offline: boolean) => void
  setIsConnecting: (connecting: boolean) => void
  signOut: () => void
  getEffectiveRole: () => string
  startUserImpersonation: (
    userId: string,
    customUser?: {
      id: string
      email: string
      full_name: string | null
      role: string
      teams?: { id: string; name: string; color: string; icon: string }[]
      workflow_roles?: { id: string; name: string; color: string; icon: string }[]
    },
  ) => Promise<void>
  stopUserImpersonation: () => void
  getImpersonatedUser: () => ImpersonatedUser | null
  getEffectiveVaultIds: () => string[]
  getEffectiveModuleConfig: () => ModuleConfig
  loadUserPermissions: () => Promise<void>
  loadUserWorkflowRoles: () => Promise<void>
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
  vaultFilesCache: Record<
    string,
    { files: LocalFile[]; serverFiles: ServerFile[]; loaded: boolean; loading: boolean }
  >

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
  getVaultFiles: (vaultId: string) => {
    files: LocalFile[]
    serverFiles: ServerFile[]
    loaded: boolean
    loading: boolean
  }
  clearVaultCache: (vaultId: string) => void
}

export interface FilesSlice {
  // State
  files: LocalFile[]
  serverFiles: ServerFile[]
  serverFolderPaths: Set<string>
  selectedFiles: string[]
  /** File path to scroll into view after navigation (transient, cleared after scroll) */
  pendingScrollToFile: string | null
  expandedFolders: Set<string>
  currentFolder: string
  persistedPendingMetadata: Record<string, PendingMetadata>
  persistedCopySource: Record<string, { sourceFileId: string; version: number }>
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
  // OperationType tracks what kind of operation is running on each file/folder
  processingOperations: Map<string, OperationType>

  // State - SolidWorks Configurations (analogous to expandedFolders/selectedFiles)
  expandedConfigFiles: Set<string> // Which files have config section expanded
  selectedConfigs: Set<string> // Selected configs (format: "filePath::configName")
  fileConfigurations: Map<string, SWConfiguration[]> // Cached configurations per file
  loadingConfigs: Set<string> // Files currently loading configs

  // State - Configuration BOM expansion (nested under configs)
  expandedConfigBoms: Set<string> // Expanded config BOMs (format: "filePath::configName")
  configBomData: Map<string, ConfigBomItem[]> // Cached BOM data per config (format: "filePath::configName")
  loadingConfigBoms: Set<string> // Configs currently loading BOM data

  // State - Drawing file expand (for .slddrw files showing referenced models)
  expandedDrawingRefs: Set<string> // Expanded drawing refs (keyed by drawing file path)
  drawingRefData: Map<string, DrawingRefItem[]> // Cached drawing ref data per drawing file
  loadingDrawingRefs: Set<string> // Drawing files currently loading ref data
  expandedDrawingRefFiles: Set<string> // Expanded ref files under a drawing (format: "drawingPath::refFilePath")

  // State - Config -> drawings (for part/assembly configs showing which drawings reference them)
  expandedConfigDrawings: Set<string> // Expanded config drawings (format: "filePath::configName")
  configDrawingData: Map<string, DrawingRefItem[]> // Cached drawing data per config key
  loadingConfigDrawings: Set<string> // Configs currently loading drawing data

  // State - Realtime update debouncing (prevents state drift from stale realtime events)
  recentlyModifiedFiles: Map<string, number> // fileId -> timestamp of local modification

  // State - Pending pane section expansion
  expandedPendingSections: Set<string> // Section IDs that are expanded

  // Actions - Files
  setFiles: (files: LocalFile[]) => void
  setServerFiles: (files: ServerFile[]) => void
  setServerFolderPaths: (paths: Set<string>) => void
  updateFileInStore: (path: string, updates: Partial<LocalFile>) => void
  updateFilesInStore: (updates: Array<{ path: string; updates: Partial<LocalFile> }>) => void
  removeFilesFromStore: (paths: string[]) => void
  addFilesToStore: (files: LocalFile[]) => void
  updatePendingMetadata: (path: string, metadata: PendingMetadata) => void
  clearPendingMetadata: (path: string) => void
  clearPendingConfigMetadata: (path: string) => void
  clearPersistedPendingMetadataForPaths: (paths: string[]) => void
  setCopySource: (path: string, source: { sourceFileId: string; version: number } | null) => void
  updatePendingVersionNote: (path: string, versionId: string, note: string) => void
  clearPendingVersionNotes: (path: string) => void
  updatePendingCheckinNote: (path: string, note: string) => void
  renameFileInStore: (
    oldPath: string,
    newPath: string,
    newNameOrRelPath: string,
    isMove?: boolean,
  ) => void
  setSelectedFiles: (paths: string[]) => void
  setPendingScrollToFile: (path: string | null) => void
  toggleFileSelection: (path: string, multiSelect?: boolean) => void
  selectAllFiles: () => void
  clearSelection: () => void
  toggleFolder: (path: string) => void
  collapseAllFolders: () => void
  setCurrentFolder: (path: string) => void

  // Actions - Realtime Updates
  addCloudFile: (pdmFile: import('../types/pdm').PDMFile) => void
  updateFilePdmData: (fileId: string, pdmData: Partial<import('../types/pdm').PDMFile>) => void
  /** Update a file's location from a realtime event (handles path changes from other users) */
  updateFileLocationFromServer: (
    fileId: string,
    newRelativePath: string,
    newFileName: string,
    pdmData: import('../types/pdm').PDMFile,
  ) => void
  /** Batch update multiple file locations from realtime events (prevents render cascade) */
  batchUpdateFileLocationsFromServer: (updates: FileLocationUpdate[]) => void
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
  addProcessingFolder: (path: string, operationType: OperationType) => void
  addProcessingFolders: (paths: string[], operationType: OperationType) => void
  /** Adds paths to processing and flushes synchronously. Use in critical paths where UI must show spinner BEFORE async work starts. */
  addProcessingFoldersSync: (paths: string[], operationType: OperationType) => void
  removeProcessingFolder: (path: string) => void
  removeProcessingFolders: (paths: string[]) => void
  /** Removes paths from processing and flushes synchronously. Use at end of operations where UI must update IMMEDIATELY. */
  removeProcessingFoldersSync: (paths: string[]) => void
  clearProcessingFolders: () => void
  getProcessingOperation: (path: string, isDirectory?: boolean) => OperationType | null

  // Actions - SolidWorks Configurations
  toggleConfigExpansion: (filePath: string) => void
  setExpandedConfigFiles: (paths: Set<string>) => void
  setSelectedConfigs: (configs: Set<string>) => void
  setFileConfigurations: (filePath: string, configs: SWConfiguration[]) => void
  clearFileConfigurations: (filePath: string) => void
  setLoadingConfigs: (paths: Set<string>) => void
  addLoadingConfig: (filePath: string) => void
  removeLoadingConfig: (filePath: string) => void
  /** Clear all configuration caches (fileConfigurations, expandedConfigFiles, selectedConfigs, configBomData, expandedConfigBoms) */
  clearAllConfigCaches: () => void

  // Actions - Configuration BOM expansion
  toggleConfigBomExpansion: (configKey: string) => void
  setExpandedConfigBoms: (keys: Set<string>) => void
  setConfigBomData: (configKey: string, items: ConfigBomItem[]) => void
  clearConfigBomData: (configKey: string) => void
  addLoadingConfigBom: (configKey: string) => void
  removeLoadingConfigBom: (configKey: string) => void

  // Actions - Drawing file expand (for .slddrw files showing referenced models)
  toggleDrawingRefExpansion: (filePath: string) => void
  setDrawingRefData: (filePath: string, items: DrawingRefItem[]) => void
  clearDrawingRefData: (filePath: string) => void
  addLoadingDrawingRef: (filePath: string) => void
  removeLoadingDrawingRef: (filePath: string) => void
  toggleDrawingRefFileExpansion: (key: string) => void

  // Actions - Config -> drawings (for part/assembly configs showing which drawings reference them)
  toggleConfigDrawingExpansion: (configKey: string) => void
  setConfigDrawingData: (configKey: string, items: DrawingRefItem[]) => void
  clearConfigDrawingData: (configKey: string) => void
  addLoadingConfigDrawing: (configKey: string) => void
  removeLoadingConfigDrawing: (configKey: string) => void

  // Actions - Realtime update debouncing
  /** Mark a file as recently modified locally. Realtime updates will be skipped for this file. */
  markFileAsRecentlyModified: (fileId: string) => void
  /** Clear the recently modified flag for a file. */
  clearRecentlyModified: (fileId: string) => void
  /** Check if a file was recently modified locally (within 15s window). */
  isFileRecentlyModified: (fileId: string) => boolean

  // Actions - Pending pane sections
  togglePendingSection: (sectionId: string) => void

  /**
   * Atomic update: combines file updates + clearing processing state in a single set() call.
   *
   * This prevents two sequential re-renders that would otherwise occur when calling
   * updateFilesInStore() followed by removeProcessingFolders(). With 8000+ files,
   * each re-render triggers expensive O(N x depth) folderMetrics computation,
   * causing ~5 second UI freezes.
   *
   * @param updates - Array of file path + partial updates to apply
   * @param pathsToClearProcessing - Paths to remove from processingOperations Map
   */
  updateFilesAndClearProcessing: (
    updates: Array<{ path: string; updates: Partial<LocalFile> }>,
    pathsToClearProcessing: string[],
  ) => void

  // Getters
  getSelectedFileObjects: () => LocalFile[]
  getVisibleFiles: () => LocalFile[]
  getFileByPath: (path: string) => LocalFile | undefined
  getDeletedFiles: () => LocalFile[]
  getFolderDiffCounts: (folderPath: string) => {
    added: number
    modified: number
    moved: number
    deleted: number
    outdated: number
    cloud: number
    cloudNew: number
  }
}

export interface ModulesSlice {
  // State
  moduleConfig: ModuleConfig
  /** Timestamp when user last synced/acknowledged org-forced module config (ms since epoch) */
  moduleConfigLastSyncedAt: number | null

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
  updateCustomGroup: (
    groupId: string,
    updates: Partial<{ name: string; icon: string; iconColor: string | null; enabled: boolean }>,
  ) => void
  removeCustomGroup: (groupId: string) => void
  resetModulesToDefaults: () => void
  loadOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  saveOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  /** Force-push current module config to all org users (admin only) */
  forceOrgModuleDefaults: () => Promise<{ success: boolean; error?: string }>
  loadTeamModuleDefaults: (teamId: string) => Promise<{
    success: boolean
    defaults: import('../types/modules').OrgModuleDefaults | null
    error?: string
  }>
  saveTeamModuleDefaults: (
    teamId: string,
    config?: ModuleConfig,
  ) => Promise<{ success: boolean; error?: string }>
  clearTeamModuleDefaults: (teamId: string) => Promise<{ success: boolean; error?: string }>
  loadUserModuleDefaults: () => Promise<{
    success: boolean
    defaults: import('../types/modules').OrgModuleDefaults | null
    error?: string
  }>
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

// Re-export domain types for consumers that import from @/stores/types
export type { ECO, Supplier, PartSupplier } from '../types/database'

// ============================================================================
// ECOs Slice
// ============================================================================

export interface ECOsSlice {
  // State
  ecos: ECO[]
  ecosLoading: boolean
  ecosLoaded: boolean

  // Actions
  setECOs: (ecos: ECO[]) => void
  setECOsLoading: (loading: boolean) => void
  addECO: (eco: ECO) => void
  updateECO: (id: string, updates: Partial<ECO>) => void
  removeECO: (id: string) => void
  clearECOs: () => void

  // Getter
  getActiveECOs: () => ECO[]
}

// ============================================================================
// Workflows Slice
// ============================================================================

export interface WorkflowsSlice {
  // Workflow list
  workflows: WorkflowTemplate[]
  workflowsLoading: boolean
  workflowsLoaded: boolean
  setWorkflows: (workflows: WorkflowTemplate[]) => void
  setWorkflowsLoading: (loading: boolean) => void
  addWorkflow: (workflow: WorkflowTemplate) => void
  updateWorkflow: (id: string, updates: Partial<WorkflowTemplate>) => void
  removeWorkflow: (id: string) => void

  // Selection
  selectedWorkflowId: string | null
  setSelectedWorkflowId: (id: string | null) => void

  // Workflow details (for selected workflow)
  workflowStates: WorkflowState[]
  workflowTransitions: WorkflowTransition[]
  workflowGates: Record<string, WorkflowGate[]>
  setWorkflowStates: (states: WorkflowState[]) => void
  setWorkflowTransitions: (transitions: WorkflowTransition[]) => void
  setWorkflowGates: (gates: Record<string, WorkflowGate[]>) => void

  // State CRUD
  addWorkflowState: (state: WorkflowState) => void
  updateWorkflowState: (id: string, updates: Partial<WorkflowState>) => void
  removeWorkflowState: (id: string) => void

  // Transition CRUD
  addWorkflowTransition: (transition: WorkflowTransition) => void
  updateWorkflowTransition: (id: string, updates: Partial<WorkflowTransition>) => void
  removeWorkflowTransition: (id: string) => void

  // Gate CRUD
  setTransitionGates: (transitionId: string, gates: WorkflowGate[]) => void

  // Clear/Reset
  clearWorkflowData: () => void
  clearWorkflowsSlice: () => void

  // Getters
  getSelectedWorkflow: () => WorkflowTemplate | null
}

// ============================================================================
// Suppliers Slice
// ============================================================================

export interface SuppliersSlice {
  suppliers: Supplier[]
  suppliersLoading: boolean
  suppliersLoaded: boolean
  setSuppliers: (suppliers: Supplier[]) => void
  setSuppliersLoading: (loading: boolean) => void
  addSupplier: (supplier: Supplier) => void
  updateSupplier: (id: string, updates: Partial<Supplier>) => void
  removeSupplier: (id: string) => void
  clearSuppliers: () => void
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
  isOperationRunning: boolean
  /** Currently running operation details (for deduplication) */
  currentOperation: { type: QueuedOperation['type']; paths: string[] } | null

  // State - Reviews
  pendingReviewCount: number

  // State - Orphaned checkouts
  orphanedCheckouts: OrphanedCheckout[]

  // State - Staged check-ins
  stagedCheckins: StagedCheckin[]

  // State - Missing storage files
  missingStorageFiles: MissingStorageFile[]

  // State - Pending large upload (waiting for user decision)
  pendingLargeUpload: PendingLargeUpload | null

  // State - File watcher suppression
  /**
   * Timestamp (ms since epoch) when the last operation completed.
   * Used by the file watcher to suppress redundant loadFiles() calls
   * within a configurable time window after operations finish.
   */
  lastOperationCompletedAt: number

  /**
   * Set of file paths (relative to vault) that we expect to change
   * due to an in-progress operation. The file watcher uses this to
   * filter out expected changes and only trigger refreshes for
   * unexpected external modifications.
   */
  expectedFileChanges: Set<string>

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
  /**
   * Queue an operation. Returns the operation ID if queued, or null if duplicate was detected.
   * Deduplication checks for same operation type with overlapping paths in queue or currently running.
   */
  queueOperation: (operation: Omit<QueuedOperation, 'id'>) => string | null
  removeFromQueue: (id: string) => void
  setOperationRunning: (running: boolean) => void
  processQueue: () => void

  // Actions - Reviews
  setPendingReviewCount: (count: number) => void

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

  // Actions - Pending large upload
  setPendingLargeUpload: (upload: PendingLargeUpload | null) => void
  clearPendingLargeUpload: () => void

  // Actions - File watcher suppression
  /**
   * Add file paths that we expect to change during an operation.
   * Call before starting downloads/get-latest operations.
   */
  addExpectedFileChanges: (paths: string[]) => void

  /**
   * Clear file paths after an operation completes.
   * Call after downloads/get-latest operations finish.
   */
  clearExpectedFileChanges: (paths: string[]) => void

  /**
   * Set the timestamp when the last operation completed.
   * Used by the file watcher to suppress redundant refreshes.
   * Call at the end of each file operation (download, get-latest, etc.).
   */
  setLastOperationCompletedAt: (timestamp: number) => void
}

// ============================================================================
// Organization Metadata Slice
// ============================================================================

// TODO(decompose): Extract to src/types/organization.ts — JobTitle,
// WorkflowRoleBasic, OrgVault, WorkflowRoleFormData (organization domain
// models used in settings, team management, and access control)

/** Job title for organization members */
export interface JobTitle {
  id: string
  name: string
  color: string
  icon: string
}

/** Basic workflow role info */
export interface WorkflowRoleBasic {
  id: string
  name: string
  color: string
  icon: string
  description?: string | null
}

/** Vault info for access management */
export interface OrgVault {
  id: string
  name: string
  slug: string
  description: string | null
  storage_bucket: string
  is_default: boolean
  created_at: string
}

/** Form data for creating/editing workflow roles */
export interface WorkflowRoleFormData {
  name: string
  color: string
  icon: string
  description: string
}

export interface OrganizationMetadataSlice {
  // ═══════════════════════════════════════════════════════════════
  // Job Titles State
  // ═══════════════════════════════════════════════════════════════
  jobTitles: JobTitle[]
  jobTitlesLoading: boolean
  jobTitlesLoaded: boolean

  // ═══════════════════════════════════════════════════════════════
  // Job Titles Actions
  // ═══════════════════════════════════════════════════════════════
  setJobTitles: (titles: JobTitle[]) => void
  setJobTitlesLoading: (loading: boolean) => void
  addJobTitle: (title: JobTitle) => void
  updateJobTitleInStore: (id: string, updates: Partial<JobTitle>) => void
  removeJobTitle: (id: string) => void
  clearJobTitles: () => void

  // ═══════════════════════════════════════════════════════════════
  // Workflow Roles State
  // ═══════════════════════════════════════════════════════════════
  workflowRoles: WorkflowRoleBasic[]
  workflowRolesLoading: boolean
  workflowRolesLoaded: boolean
  userRoleAssignments: Record<string, string[]> // userId -> roleIds

  // ═══════════════════════════════════════════════════════════════
  // Workflow Roles Actions
  // ═══════════════════════════════════════════════════════════════
  setWorkflowRoles: (roles: WorkflowRoleBasic[]) => void
  setWorkflowRolesLoading: (loading: boolean) => void
  setUserRoleAssignments: (assignments: Record<string, string[]>) => void
  addWorkflowRole: (role: WorkflowRoleBasic) => void
  updateWorkflowRoleInStore: (id: string, updates: Partial<WorkflowRoleBasic>) => void
  removeWorkflowRole: (id: string) => void
  assignUserRole: (userId: string, roleId: string) => void
  unassignUserRole: (userId: string, roleId: string) => void
  clearWorkflowRoles: () => void

  // ═══════════════════════════════════════════════════════════════
  // Vault Access State
  // ═══════════════════════════════════════════════════════════════
  orgVaults: OrgVault[]
  orgVaultsLoading: boolean
  orgVaultsLoaded: boolean
  vaultAccessMap: Record<string, string[]> // vaultId -> userIds
  teamVaultAccessMap: Record<string, string[]> // teamId -> vaultIds

  // ═══════════════════════════════════════════════════════════════
  // Vault Access Actions
  // ═══════════════════════════════════════════════════════════════
  setOrgVaults: (vaults: OrgVault[]) => void
  setOrgVaultsLoading: (loading: boolean) => void
  setVaultAccessMap: (map: Record<string, string[]>) => void
  setTeamVaultAccessMap: (map: Record<string, string[]>) => void
  grantUserVaultAccess: (userId: string, vaultId: string) => void
  revokeUserVaultAccess: (userId: string, vaultId: string) => void
  grantTeamVaultAccess: (teamId: string, vaultId: string) => void
  revokeTeamVaultAccess: (teamId: string, vaultId: string) => void
  clearOrgVaults: () => void

  // ═══════════════════════════════════════════════════════════════
  // Bulk Clear (for org switch)
  // ═══════════════════════════════════════════════════════════════
  clearOrganizationMetadata: () => void
}

export interface OrganizationDataSlice {
  // Teams
  teams: TeamWithDetails[]
  teamsLoading: boolean
  teamsLoaded: boolean
  setTeams: (teams: TeamWithDetails[]) => void
  setTeamsLoading: (loading: boolean) => void
  addTeam: (team: TeamWithDetails) => void
  updateTeam: (id: string, updates: Partial<TeamWithDetails>) => void
  removeTeam: (id: string) => void

  // Members
  members: OrgUser[]
  membersLoading: boolean
  membersLoaded: boolean
  setMembers: (members: OrgUser[]) => void
  setMembersLoading: (loading: boolean) => void
  addMember: (member: OrgUser) => void
  updateMember: (id: string, updates: Partial<OrgUser>) => void
  removeMember: (id: string) => void

  // Pending Members
  pendingMembers: PendingMember[]
  pendingMembersLoading: boolean
  pendingMembersLoaded: boolean
  setPendingMembers: (members: PendingMember[]) => void
  setPendingMembersLoading: (loading: boolean) => void
  addPendingMember: (member: PendingMember) => void
  updatePendingMember: (id: string, updates: Partial<PendingMember>) => void
  removePendingMember: (id: string) => void

  // Dialog state
  removingUser: OrgUser | null
  isRemoving: boolean
  editingTeamsUser: OrgUser | null
  setRemovingUser: (user: OrgUser | null) => void
  setIsRemoving: (v: boolean) => void
  setEditingTeamsUser: (user: OrgUser | null) => void

  // Reset
  clearOrganizationData: () => void
}

// ============================================================================
// Integration Status Slice
// ============================================================================

// TODO(decompose): Extract to src/types/integrations.ts — IntegrationId,
// IntegrationStatusValue, IntegrationStatus, BackupStatusValue,
// IntegrationState (integration domain models used in status indicators,
// system stats, and integration settings)

/** Integration identifiers for status tracking */
export type IntegrationId =
  | 'supabase'
  | 'solidworks'
  | 'google-drive'
  | 'odoo'
  | 'slack'
  | 'webhooks'
  | 'api'

/** Status of an individual integration */
export type IntegrationStatusValue =
  | 'online'
  | 'partial'
  | 'offline'
  | 'not-configured'
  | 'checking'
  | 'coming-soon'

/** Backward compatibility alias */
export type IntegrationStatus = IntegrationStatusValue

/** Backup status type alias for backward compatibility */
export type BackupStatusValue = 'online' | 'partial' | 'offline' | 'not-configured'

/** State for a single integration */
export interface IntegrationState {
  status: IntegrationStatusValue
  lastChecked: number | null // Unix timestamp ms
  error?: string
}

export interface IntegrationsSlice {
  // ═══════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════
  integrations: Record<IntegrationId, IntegrationState>
  backupStatus: BackupStatusValue
  isCheckingIntegrations: boolean
  integrationsLastFullCheck: number | null // Unix timestamp ms of last full check

  /** Flag to prevent integration status checks from overwriting auto-start results */
  solidworksAutoStartInProgress: boolean

  /** Flag indicating a batch SolidWorks operation is in progress (e.g., 80-file check-in) */
  isBatchSWOperationRunning: boolean

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════
  /** Set the status of a specific integration */
  setIntegrationStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void

  /** Set multiple integration statuses at once */
  setIntegrationStatuses: (statuses: Partial<Record<IntegrationId, IntegrationStatusValue>>) => void

  /** Set backup status */
  setBackupStatus: (status: BackupStatusValue) => void

  /** Check status of a single integration. When silent=true, skips the 'checking' visual state. */
  checkIntegration: (id: IntegrationId, silent?: boolean) => Promise<void>

  /** Check status of all integrations. When silent=true, skips the 'checking' visual state. */
  checkAllIntegrations: (silent?: boolean) => Promise<void>

  /** Mark an integration as currently checking */
  setIntegrationChecking: (id: IntegrationId) => void

  /** Reset all integration statuses to initial state */
  resetIntegrationStatuses: () => void

  /** Set whether SolidWorks auto-start is in progress */
  setSolidworksAutoStartInProgress: (inProgress: boolean) => void

  /** Set whether a batch SolidWorks operation is running */
  setIsBatchSWOperationRunning: (running: boolean) => void

  // ═══════════════════════════════════════════════════════════════
  // Backward compatibility aliases
  // ═══════════════════════════════════════════════════════════════
  /** @deprecated Use isCheckingIntegrations state directly */
  setIsCheckingIntegrations: (checking: boolean) => void
  /** @deprecated Use setIntegrationChecking */
  startIntegrationCheck: (id: IntegrationId) => void
  /** @deprecated Use setIntegrationStatus */
  completeIntegrationCheck: (
    id: IntegrationId,
    status: IntegrationStatusValue,
    error?: string,
  ) => void
  /** @deprecated Use resetIntegrationStatuses */
  resetAllStatuses: () => void
}

// ============================================================================
// Extensions Slice
// ============================================================================

// TODO(decompose): Extract to src/types/extensions.ts — ExtensionLifecycleState,
// ExtensionVerificationStatus, ExtensionCategoryType, ExtensionInstallPhase,
// InstalledExtension, StoreExtensionListing, ExtensionUpdateAvailable,
// ExtensionInstallProgress (extension domain models used in extension store,
// install dialogs, and IPC handlers)

/** Extension lifecycle state */
export type ExtensionLifecycleState =
  | 'not-installed'
  | 'installed'
  | 'loading'
  | 'active'
  | 'error'
  | 'disabled'

/** Extension verification status */
export type ExtensionVerificationStatus = 'verified' | 'community' | 'sideloaded'

/** Extension category */
export type ExtensionCategoryType = 'sandboxed' | 'native'

/** Install progress phase */
export type ExtensionInstallPhase =
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'loading'
  | 'deploying'
  | 'complete'
  | 'error'

/** Loaded extension information (from IPC) */
export interface InstalledExtension {
  manifest: {
    id: string
    name: string
    version: string
    publisher: string
    description?: string
    icon?: string
    repository?: string
    license: string
    category?: ExtensionCategoryType
    main?: string
    serverMain?: string
  }
  state: ExtensionLifecycleState
  verification: ExtensionVerificationStatus
  error?: string
  installedAt?: string
  activatedAt?: string
}

/** Store extension listing (from API) */
export interface StoreExtensionListing {
  id: string
  extensionId: string
  publisher: {
    id: string
    name: string
    slug: string
    verified: boolean
  }
  name: string
  description?: string
  iconUrl?: string
  repositoryUrl: string
  license: string
  category: ExtensionCategoryType
  categories: string[]
  tags: string[]
  verified: boolean
  featured: boolean
  downloadCount: number
  latestVersion: string
  createdAt: string
  updatedAt: string
  deprecation?: {
    deprecatedAt: string
    reason: string
    replacementId?: string
    sunsetDate?: string
  }
}

/** Available extension update */
export interface ExtensionUpdateAvailable {
  extensionId: string
  currentVersion: string
  newVersion: string
  changelog?: string
  breaking: boolean
  minAppVersion?: string
}

/** Install progress state */
export interface ExtensionInstallProgress {
  extensionId: string
  phase: ExtensionInstallPhase
  percent: number
  message: string
  error?: string
}

export interface ExtensionsSlice {
  // ═══════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════

  /** Installed extensions keyed by extension ID */
  installedExtensions: Record<string, InstalledExtension>

  /** Extension states for quick lookup */
  extensionStates: Record<string, ExtensionLifecycleState>

  /** Extensions from the store (marketplace) */
  storeExtensions: StoreExtensionListing[]

  /** Available updates for installed extensions */
  availableUpdates: ExtensionUpdateAvailable[]

  /** Whether store is currently loading */
  storeLoading: boolean

  /** Store search query */
  storeSearchQuery: string

  /** Store category filter */
  storeCategoryFilter: string | null

  /** Store verification filter */
  storeVerifiedOnly: boolean

  /** Store sort order */
  storeSort: 'popular' | 'recent' | 'name'

  /** Current install progress (if installing) */
  installProgress: ExtensionInstallProgress | null

  /** Whether checking for updates */
  checkingUpdates: boolean

  /** Last update check timestamp */
  lastUpdateCheck: number | null

  // ═══════════════════════════════════════════════════════════════
  // Synchronous Actions
  // ═══════════════════════════════════════════════════════════════

  /** Set all installed extensions */
  setInstalledExtensions: (extensions: Record<string, InstalledExtension>) => void

  /** Update a single installed extension */
  updateInstalledExtension: (extensionId: string, updates: Partial<InstalledExtension>) => void

  /** Remove an installed extension from state */
  removeInstalledExtension: (extensionId: string) => void

  /** Set store extensions */
  setStoreExtensions: (extensions: StoreExtensionListing[]) => void

  /** Set available updates */
  setAvailableUpdates: (updates: ExtensionUpdateAvailable[]) => void

  /** Set store loading state */
  setStoreLoading: (loading: boolean) => void

  /** Set store search query */
  setStoreSearchQuery: (query: string) => void

  /** Set store category filter */
  setStoreCategoryFilter: (category: string | null) => void

  /** Set store verified only filter */
  setStoreVerifiedOnly: (verified: boolean) => void

  /** Set store sort order */
  setStoreSort: (sort: 'popular' | 'recent' | 'name') => void

  /** Set install progress */
  setInstallProgress: (progress: ExtensionInstallProgress | null) => void

  /** Set checking updates state */
  setCheckingUpdates: (checking: boolean) => void

  /** Handle extension state change event */
  handleExtensionStateChange: (
    extensionId: string,
    state: ExtensionLifecycleState,
    error?: string,
  ) => void

  // ═══════════════════════════════════════════════════════════════
  // Async Actions (call IPC via window.electronAPI.extensions)
  // ═══════════════════════════════════════════════════════════════

  /** Load all installed extensions from IPC */
  loadInstalledExtensions: () => Promise<void>

  /** Fetch store extensions from API */
  fetchStoreExtensions: () => Promise<void>

  /** Search store extensions */
  searchStoreExtensions: (query?: string, category?: string) => Promise<void>

  /** Install an extension from the store */
  installExtension: (
    extensionId: string,
    version?: string,
  ) => Promise<{ success: boolean; error?: string }>

  /** Sideload an extension from a .bpx file */
  sideloadExtension: (
    bpxPath: string,
    acknowledgeUnsigned?: boolean,
  ) => Promise<{ success: boolean; error?: string }>

  /** Uninstall an extension */
  uninstallExtension: (extensionId: string) => Promise<{ success: boolean; error?: string }>

  /** Enable an extension */
  enableExtension: (extensionId: string) => Promise<{ success: boolean; error?: string }>

  /** Disable an extension */
  disableExtension: (extensionId: string) => Promise<{ success: boolean; error?: string }>

  /** Update an extension to a new version */
  updateExtension: (
    extensionId: string,
    version?: string,
  ) => Promise<{ success: boolean; error?: string }>

  /** Rollback an extension to a previous version */
  rollbackExtension: (extensionId: string) => Promise<{ success: boolean; error?: string }>

  /** Check for available updates */
  checkForUpdates: () => Promise<void>

  // ═══════════════════════════════════════════════════════════════
  // Getters
  // ═══════════════════════════════════════════════════════════════

  /** Get extension by ID */
  getExtension: (extensionId: string) => InstalledExtension | undefined

  /** Get all active extensions */
  getActiveExtensions: () => InstalledExtension[]

  /** Check if extension is installed */
  isExtensionInstalled: (extensionId: string) => boolean

  /** Check if update is available for extension */
  hasUpdate: (extensionId: string) => boolean

  /** Get update info for extension */
  getUpdateInfo: (extensionId: string) => ExtensionUpdateAvailable | undefined

  // ═══════════════════════════════════════════════════════════════
  // Reset
  // ═══════════════════════════════════════════════════════════════

  /** Clear all extensions state */
  clearExtensionsState: () => void
}

// ============================================================================
// Annotations Slice (PDF commenting / spatial annotations)
// ============================================================================

export interface AnnotationsSlice {
  // State
  /** Threaded annotations for the currently viewed file */
  annotations: FileAnnotation[]
  /** Whether annotations are being fetched from the server */
  annotationsLoading: boolean
  /** The annotation (thread root) currently highlighted / scrolled to */
  activeAnnotationId: string | null
  /** The annotation currently being hovered (on either PDF box or sidebar comment) */
  hoveredAnnotationId: string | null
  /** Which file's annotations are currently loaded (avoids stale data) */
  annotationFileId: string | null
  /** Whether the new-comment input panel is visible */
  showCommentInput: boolean
  /** Pending annotation data created by area/text selection before the user types a comment */
  pendingAnnotation: NewAnnotationData | null

  // Actions
  setAnnotations: (annotations: FileAnnotation[]) => void
  addAnnotation: (annotation: FileAnnotation) => void
  updateAnnotationInStore: (id: string, updates: Partial<FileAnnotation>) => void
  removeAnnotation: (id: string) => void
  setActiveAnnotationId: (id: string | null) => void
  setHoveredAnnotationId: (id: string | null) => void
  setAnnotationFileId: (fileId: string | null) => void
  setShowCommentInput: (show: boolean) => void
  setPendingAnnotation: (data: NewAnnotationData | null) => void
  clearAnnotations: () => void
}

// ============================================================================
// Item Browser Slice
// ============================================================================

export type ItemViewMode = 'list' | 'icons'

// Right-panel context for an Item Browser item (eBOM / mBOM detail view)
export interface ItemPanelState {
  itemNumber: string
  kind: 'ebom' | 'mbom'
  // Server file id of the item's primary assembly file (for BOM lookups)
  fileId: string | null
  title: string
}

export interface ItemBrowserSlice {
  // Org-wide definition of what constitutes an item (cached from DB)
  itemDefinition: import('../types/item').ItemDefinitionSettings
  // Whether the definition has been loaded from the server at least once
  itemDefinitionLoaded: boolean
  // UI preferences (persisted) — kept separate from the file browser's fields
  itemViewMode: ItemViewMode
  itemListRowSize: number
  itemIconSize: number
  // Column config (visibility, width, order) for the item list view
  itemColumns: ColumnConfig[]
  // Currently open item detail panel (eBOM/mBOM), null when closed
  itemPanel: ItemPanelState | null

  // Actions
  setItemDefinition: (definition: import('../types/item').ItemDefinitionSettings) => void
  setItemDefinitionLoaded: (loaded: boolean) => void
  setItemViewMode: (mode: ItemViewMode) => void
  setItemListRowSize: (size: number) => void
  setItemIconSize: (size: number) => void
  setItemColumns: (columns: ColumnConfig[]) => void
  setItemPanel: (panel: ItemPanelState | null) => void
}

// ============================================================================
// Customers Slice
// ============================================================================

export type CustomersTab = 'overview' | 'customers' | 'accounts'

export type CustomerBucket = 'day' | 'week' | 'month' | 'quarter'

/** Preset windows offered by the workspace command bar. */
export type CustomerRangeId = '30d' | '90d' | '12m' | '24m' | 'ytd' | 'all'

/** Odoo-presence filter, distinct from the lifecycle segment filter. */
export type CustomerPresence = 'all' | 'active' | 'gone'

export interface CustomerFilters {
  range: CustomerRangeId
  bucket: CustomerBucket
  search: string
  /**
   * Lifecycle segments from customer_lifecycle_segment(). Typed as string[]
   * rather than the feature's SegmentId union so the store stays independent
   * of src/features.
   */
  segments: string[]
  /** Composite taxonomy keys: 'category' or 'category::subcategory'. */
  categories: string[]
  countries: string[]
  presence: CustomerPresence
}

/** The customer currently open in the right-hand detail panel. */
export interface CustomerPanelState {
  customerId: string
  name: string
}

/**
 * A sync run as reported by GET /customers/sync/status.
 *
 * Mirrors an integration_sync_log row. `stale` is computed by the server: it
 * means the run still says 'running' but the process that owned it has stopped
 * reporting, so it is never coming back.
 */
export interface CustomerSyncRun {
  run_id: string
  status: 'running' | 'success' | 'failed' | 'cancelled' | string
  phase: string | null
  phase_index: number | null
  phase_count: number | null
  progress_current: number | null
  progress_total: number | null
  started_at: string | null
  completed_at: string | null
  heartbeat_at: string | null
  cancel_requested: boolean
  error_message: string | null
  records_created: number | null
  records_updated: number | null
  stale: boolean
}

/**
 * Everything the UI knows about the Odoo customer sync.
 *
 * This lives in the store rather than in the hook because the sidebar
 * navigator and the main-area workspace are separate React subtrees. When each
 * held its own useState, both rendered an enabled button and clicking one left
 * the other live - which was the whole two-buttons bug.
 */
export interface CustomerSyncState {
  /** True from the moment a start is requested until the run leaves 'running'. */
  active: boolean
  /** Set while a cancel request is in flight or awaiting the run's next checkpoint. */
  stopping: boolean
  run: CustomerSyncRun | null
  /** Populated by the final response of a sync this client started. */
  result: unknown | null
  error: string | null
}

export interface CustomersSlice {
  customersTab: CustomersTab
  customerFilters: CustomerFilters
  customerPanel: CustomerPanelState | null
  customerSync: CustomerSyncState
  /**
   * Bumped after a sync completes. The sidebar navigator and the main-area
   * workspace are separate React subtrees that cannot pass callbacks to each
   * other, so they both watch this counter to know when to refetch.
   */
  customerDataVersion: number

  setCustomersTab: (tab: CustomersTab) => void
  invalidateCustomerData: () => void
  setCustomerFilters: (patch: Partial<CustomerFilters>) => void
  /** Adds or removes one value from a multi-select facet. Used by cross-filtering. */
  toggleCustomerFacet: (facet: 'segments' | 'categories' | 'countries', value: string) => void
  resetCustomerFilters: () => void
  setCustomerPanel: (panel: CustomerPanelState | null) => void
  setCustomerSync: (patch: Partial<CustomerSyncState>) => void
}

// ============================================================================
// Combined Store Type
// ============================================================================

export type PDMStoreState = ToastsSlice &
  UpdateSlice &
  UISlice &
  SettingsSlice &
  UserSlice &
  VaultsSlice &
  FilesSlice &
  ModulesSlice &
  TabsSlice &
  OperationsSlice &
  WorkflowsSlice &
  SuppliersSlice &
  ECOsSlice &
  OrganizationDataSlice &
  OrganizationMetadataSlice &
  IntegrationsSlice &
  ExtensionsSlice &
  OperationLogSlice &
  AnnotationsSlice &
  ItemBrowserSlice &
  CustomersSlice

// ============================================================================
// Store Versioning
// ============================================================================

// Store versioning for migrations
export interface StoreMetadata {
  _storeVersion: number
}

// Re-export types that were originally in pdmStore.ts for backward compatibility
export type { PDMFile, Organization, User } from '../types/pdm'
export type {
  ModuleId,
  ModuleGroupId,
  ModuleConfig,
  SectionDivider,
  OrderListItem,
  OrgModuleDefaults,
} from '../types/modules'
export type {
  KeybindingAction,
  KeybindingsConfig,
  Keybinding,
  SettingsTab,
} from '../types/settings'
