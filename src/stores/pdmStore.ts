import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PDMFile, FileState, Organization, User } from '../types/pdm'
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
  | 'suppliers'  // Supplier database
  | 'supplier-portal'  // Supplier portal
  // System
  | 'settings'
export type DetailsPanelTab = 'properties' | 'preview' | 'whereused' | 'contains' | 'history'
export type PanelPosition = 'bottom' | 'right'
export type ToastType = 'error' | 'success' | 'info' | 'warning' | 'progress' | 'update'
export type ThemeMode = 'dark' | 'deep-blue' | 'light' | 'system'
export type Language = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'ja' | 'zh-CN' | 'zh-TW' | 'ko' | 'nl' | 'sv' | 'pl' | 'ru'
export type DiffStatus = 'added' | 'modified' | 'deleted' | 'outdated' | 'cloud' | 'cloud_new' | 'moved' | 'ignored' | 'deleted_remote'

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

interface PDMState {
  // Auth & Org
  user: User | null
  organization: Organization | null
  isAuthenticated: boolean
  isOfflineMode: boolean
  isConnecting: boolean  // True after sign-in while loading organization
  
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
  updateAvailable: { version: string; releaseDate?: string; releaseNotes?: string } | null
  updateDownloading: boolean
  updateDownloaded: boolean
  updateProgress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null
  
  // Recent vaults
  recentVaults: string[]
  autoConnect: boolean
  
  // Preview settings
  cadPreviewMode: 'thumbnail' | 'edrawings'  // thumbnail = embedded preview, edrawings = open externally
  
  // SolidWorks settings
  solidworksPath: string | null  // Custom SolidWorks installation path (null = default)
  solidworksDmLicenseKey: string | null  // Document Manager API license key for fast mode
  
  // Display settings
  lowercaseExtensions: boolean  // Display file extensions in lowercase
  viewMode: 'list' | 'icons'    // File browser view mode
  iconSize: number              // Icon size for icon view (48-256 pixels)
  listRowSize: number           // Row height for list view (16-64 pixels)
  theme: ThemeMode              // Theme: dark, light, blue, or system
  language: Language            // UI language
  
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
  
  // Onboarding (first app boot)
  onboardingComplete: boolean
  logSharingEnabled: boolean
  
  // Actions - Onboarding
  completeOnboarding: () => void
  setLogSharingEnabled: (enabled: boolean) => void
  
  // Actions - Toasts
  addToast: (type: ToastType, message: string, duration?: number) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number, speed?: string, label?: string) => void
  requestCancelProgressToast: (id: string) => void
  isProgressToastCancelled: (id: string) => boolean
  removeToast: (id: string) => void
  
  // Actions - Update
  setUpdateAvailable: (info: { version: string; releaseDate?: string; releaseNotes?: string } | null) => void
  setUpdateDownloading: (downloading: boolean) => void
  setUpdateDownloaded: (downloaded: boolean) => void
  setUpdateProgress: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null) => void
  showUpdateToast: (version: string) => void
  dismissUpdateToast: () => void
  
  // Actions - Auth
  setUser: (user: User | null) => void
  setOrganization: (org: Organization | null) => void
  setOfflineMode: (offline: boolean) => void
  setIsConnecting: (connecting: boolean) => void
  signOut: () => void
  
  // Actions - Vault
  setVaultPath: (path: string | null) => void
  setVaultName: (name: string | null) => void
  setVaultConnected: (connected: boolean) => void
  addRecentVault: (path: string) => void
  setAutoConnect: (auto: boolean) => void
  
  // Actions - Preview settings
  setCadPreviewMode: (mode: 'thumbnail' | 'edrawings') => void
  
  // Actions - SolidWorks settings
  setSolidworksPath: (path: string | null) => void
  setSolidworksDmLicenseKey: (key: string | null) => void
  
  // Actions - Display settings
  setLowercaseExtensions: (enabled: boolean) => void
  setViewMode: (mode: 'list' | 'icons') => void
  setIconSize: (size: number) => void
  setListRowSize: (size: number) => void
  setTheme: (theme: ThemeMode) => void
  setLanguage: (language: Language) => void
  
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
  removeProcessingFolder: (path: string) => void
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
      
      // Onboarding (first app boot)
      onboardingComplete: false,
      logSharingEnabled: false,
      
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
      
      recentVaults: [],
      autoConnect: true,
      cadPreviewMode: 'thumbnail',
      solidworksPath: null,  // null = use default installation path
      solidworksDmLicenseKey: null,  // null = fast mode disabled
      lowercaseExtensions: true,
      viewMode: 'list',
      iconSize: 96,  // Default icon size (medium)
      listRowSize: 24, // Default list row height
      theme: 'dark',  // Default theme
      language: 'en',  // Default language
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
      completeOnboarding: () => set({ onboardingComplete: true }),
      setLogSharingEnabled: (logSharingEnabled) => set({ logSharingEnabled }),
      
      // Actions - Auth
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setOrganization: (organization) => set({ organization, isConnecting: false }),  // Clear connecting state when org loads
      setOfflineMode: (isOfflineMode) => set({ isOfflineMode }),
      setIsConnecting: (isConnecting) => set({ isConnecting }),
      signOut: () => set({ user: null, organization: null, isAuthenticated: false, isOfflineMode: false, isConnecting: false }),
      
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
      setSolidworksPath: (solidworksPath) => set({ solidworksPath }),
      setSolidworksDmLicenseKey: (solidworksDmLicenseKey) => set({ solidworksDmLicenseKey }),
      setLowercaseExtensions: (lowercaseExtensions) => set({ lowercaseExtensions }),
      setViewMode: (viewMode) => set({ viewMode }),
      setIconSize: (iconSize) => set({ iconSize: Math.max(48, Math.min(256, iconSize)) }),
      setListRowSize: (listRowSize) => set({ listRowSize: Math.max(16, Math.min(64, listRowSize)) }),
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      
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
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
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
      toggleDetailsPanel: () => set((s) => ({ detailsPanelVisible: !s.detailsPanelVisible })),
      setDetailsPanelHeight: (height) => set({ detailsPanelHeight: Math.max(100, Math.min(1200, height)) }),
      setDetailsPanelTab: (detailsPanelTab) => set({ detailsPanelTab }),
      
      // Actions - Right Panel
      toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
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
        const { organization, columns, user } = get()
        if (!organization?.id) {
          return { success: false, error: 'No organization connected' }
        }
        if (user?.role !== 'admin') {
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
      removeProcessingFolder: (path) => {
        set(state => {
          const newSet = new Set(state.processingFolders)
          newSet.delete(path)
          return { processingFolders: newSet }
        })
        // Try to process queued operations after a folder is done
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
      name: 'blue-pdm-storage',
      partialize: (state) => ({
        vaultPath: state.vaultPath,
        vaultName: state.vaultName,
        recentVaults: state.recentVaults,
        autoConnect: state.autoConnect,
        onboardingComplete: state.onboardingComplete,
        logSharingEnabled: state.logSharingEnabled,
        cadPreviewMode: state.cadPreviewMode,
        solidworksPath: state.solidworksPath,
        solidworksDmLicenseKey: state.solidworksDmLicenseKey,
        lowercaseExtensions: state.lowercaseExtensions,
        viewMode: state.viewMode,
        iconSize: state.iconSize,
        listRowSize: state.listRowSize,
        theme: state.theme,
        language: state.language,
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
        columns: state.columns,
        expandedFolders: Array.from(state.expandedFolders),
        ignorePatterns: state.ignorePatterns,
        terminalVisible: state.terminalVisible,
        terminalHeight: state.terminalHeight,
        terminalHistory: state.terminalHistory.slice(0, 100)  // Keep last 100
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
          solidworksPath: (persisted.solidworksPath as string | null) || null,
          solidworksDmLicenseKey: (persisted.solidworksDmLicenseKey as string | null) || null,
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
          // Ensure language has a default
          language: (persisted.language as Language) || 'en',
          // Ensure onboarding state has defaults
          onboardingComplete: (persisted.onboardingComplete as boolean) || false,
          logSharingEnabled: (persisted.logSharingEnabled as boolean) || false,
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
          terminalHistory: (persisted.terminalHistory as string[]) || []
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

