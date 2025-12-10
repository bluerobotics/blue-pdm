import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PDMFile, FileState, Organization, User } from '../types/pdm'

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

export type SidebarView = 'explorer' | 'checkout' | 'history' | 'search' | 'settings'
export type DetailsPanelTab = 'properties' | 'preview' | 'whereused' | 'contains' | 'history'
export type PanelPosition = 'bottom' | 'right'
export type ToastType = 'error' | 'success' | 'info' | 'warning' | 'progress'
export type DiffStatus = 'added' | 'modified' | 'deleted' | 'outdated' | 'cloud' | 'moved'

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
  
  // File Browser
  files: LocalFile[]
  serverFiles: ServerFile[] // Files that exist on server (for tracking deletions)
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
  activeView: SidebarView
  detailsPanelVisible: boolean
  detailsPanelHeight: number
  detailsPanelTab: DetailsPanelTab
  
  // Right panel (dockable from bottom panel)
  rightPanelVisible: boolean
  rightPanelWidth: number
  rightPanelTab: DetailsPanelTab | null
  rightPanelTabs: DetailsPanelTab[]  // Tabs stacked in right panel
  
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
  
  // Recent vaults
  recentVaults: string[]
  autoConnect: boolean
  
  // Preview settings
  cadPreviewMode: 'thumbnail' | 'edrawings'  // thumbnail = embedded preview, edrawings = open externally
  
  // Display settings
  lowercaseExtensions: boolean  // Display file extensions in lowercase
  
  // Pinned items (quick access)
  pinnedFolders: { path: string; vaultId: string; vaultName: string; isDirectory: boolean }[]
  pinnedSectionExpanded: boolean
  
  // Processing folders (for spinner display)
  processingFolders: Set<string>
  
  // Operation queue for non-blocking file operations
  operationQueue: QueuedOperation[]
  
  // History filter (for folder-specific history view)
  historyFolderFilter: string | null
  
  // Actions - Toasts
  addToast: (type: ToastType, message: string, duration?: number) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number, speed?: string) => void
  requestCancelProgressToast: (id: string) => void
  isProgressToastCancelled: (id: string) => boolean
  removeToast: (id: string) => void
  
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
  
  // Actions - Display settings
  setLowercaseExtensions: (enabled: boolean) => void
  
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
  updateConnectedVault: (vaultId: string, updates: Partial<ConnectedVault>) => void
  triggerVaultsRefresh: () => void
  
  // Actions - Files
  setFiles: (files: LocalFile[]) => void
  setServerFiles: (files: ServerFile[]) => void
  updateFileInStore: (path: string, updates: Partial<LocalFile>) => void
  updatePendingMetadata: (path: string, metadata: PendingMetadata) => void
  clearPendingMetadata: (path: string) => void
  renameFileInStore: (oldPath: string, newPath: string, newName: string) => void
  setSelectedFiles: (paths: string[]) => void
  toggleFileSelection: (path: string, multiSelect?: boolean) => void
  selectAllFiles: () => void
  clearSelection: () => void
  toggleFolder: (path: string) => void
  setCurrentFolder: (path: string) => void
  
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
  setActiveView: (view: SidebarView) => void
  toggleDetailsPanel: () => void
  setDetailsPanelHeight: (height: number) => void
  setDetailsPanelTab: (tab: DetailsPanelTab) => void
  
  // Actions - Right Panel
  toggleRightPanel: () => void
  setRightPanelWidth: (width: number) => void
  setRightPanelTab: (tab: DetailsPanelTab | null) => void
  moveTabToRight: (tab: DetailsPanelTab) => void
  moveTabToBottom: (tab: DetailsPanelTab) => void
  
  // Actions - History
  setHistoryFolderFilter: (folderPath: string | null) => void
  
  // Actions - Columns
  setColumnWidth: (id: string, width: number) => void
  toggleColumnVisibility: (id: string) => void
  reorderColumns: (columns: ColumnConfig[]) => void
  
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
  getFolderDiffCounts: (folderPath: string) => { added: number; modified: number; moved: number; deleted: number; outdated: number; cloud: number }
}

const defaultColumns: ColumnConfig[] = [
  { id: 'name', label: 'Name', width: 280, visible: true, sortable: true },
  { id: 'fileStatus', label: 'File Status', width: 100, visible: true, sortable: true },
  { id: 'checkedOutBy', label: 'Checked Out By', width: 150, visible: true, sortable: true },
  { id: 'version', label: 'Ver', width: 60, visible: true, sortable: true },
  { id: 'itemNumber', label: 'Item Number', width: 120, visible: true, sortable: true },
  { id: 'description', label: 'Description', width: 200, visible: true, sortable: true },
  { id: 'revision', label: 'Rev', width: 50, visible: true, sortable: true },
  { id: 'state', label: 'State', width: 90, visible: true, sortable: true },
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
      
      vaultPath: null,
      vaultName: null,
      isVaultConnected: false,
      connectedVaults: [],
      activeVaultId: null,
      vaultsRefreshKey: 0,
      
      files: [],
      serverFiles: [],
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
      activeView: 'explorer',
      detailsPanelVisible: true,
      detailsPanelHeight: 250,
      detailsPanelTab: 'preview',
      
      rightPanelVisible: false,
      rightPanelWidth: 350,
      rightPanelTab: null,
      rightPanelTabs: [],
      
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
      
      recentVaults: [],
      autoConnect: true,
      cadPreviewMode: 'thumbnail',
      lowercaseExtensions: true,
      pinnedFolders: [],
      pinnedSectionExpanded: true,
      processingFolders: new Set(),
      operationQueue: [],
      historyFolderFilter: null,
      
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
      updateProgressToast: (id, current, percent, speed) => {
        set(state => ({
          toasts: state.toasts.map(t => 
            t.id === id && t.type === 'progress'
              ? { ...t, progress: { ...t.progress!, current, percent, speed } }
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
      setLowercaseExtensions: (lowercaseExtensions) => set({ lowercaseExtensions }),
      
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
      
      // Actions - Files
      setFiles: (files) => set({ files }),
      setServerFiles: (serverFiles) => set({ serverFiles }),
      updateFileInStore: (path, updates) => {
        set(state => ({
          files: state.files.map(f => 
            f.path === path ? { ...f, ...updates } : f
          )
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
      renameFileInStore: (oldPath, newPath, newName) => {
        const { files, selectedFiles } = get()
        
        // Update file in the files array
        const updatedFiles = files.map(f => {
          if (f.path === oldPath) {
            // Calculate new relative path
            const oldRelativePath = f.relativePath
            const pathParts = oldRelativePath.split('/')
            pathParts[pathParts.length - 1] = newName
            const newRelativePath = pathParts.join('/')
            
            return {
              ...f,
              path: newPath,
              name: newName,
              relativePath: newRelativePath,
              extension: newName.includes('.') ? newName.split('.').pop()?.toLowerCase() || '' : ''
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
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
      setActiveView: (activeView) => set({ activeView, sidebarVisible: true }),
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
      
      // Actions - History
      setHistoryFolderFilter: (folderPath) => set({ historyFolderFilter: folderPath }),
      
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
        
        const localPaths = new Set(files.map(f => f.relativePath))
        
        return serverFiles
          .filter(sf => !localPaths.has(sf.file_path))
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
        }
        
        return { added, modified, moved, deleted, outdated, cloud }
      }
    }),
    {
      name: 'blue-pdm-storage',
      partialize: (state) => ({
        vaultPath: state.vaultPath,
        vaultName: state.vaultName,
        recentVaults: state.recentVaults,
        autoConnect: state.autoConnect,
        cadPreviewMode: state.cadPreviewMode,
        lowercaseExtensions: state.lowercaseExtensions,
        pinnedFolders: state.pinnedFolders,
        pinnedSectionExpanded: state.pinnedSectionExpanded,
        connectedVaults: state.connectedVaults,
        activeVaultId: state.activeVaultId,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activeView: state.activeView,
        detailsPanelVisible: state.detailsPanelVisible,
        detailsPanelHeight: state.detailsPanelHeight,
        rightPanelVisible: state.rightPanelVisible,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelTabs: state.rightPanelTabs,
        columns: state.columns,
        expandedFolders: Array.from(state.expandedFolders)
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Record<string, unknown>
        
        // Deduplicate connected vaults by ID (keep first occurrence)
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
        })
        
        return {
          ...currentState,
          ...persisted,
          // Use deduplicated vaults
          connectedVaults: deduplicatedVaults,
          // Convert expandedFolders back to Set
          expandedFolders: new Set(persisted.expandedFolders as string[] || []),
          // Ensure cadPreviewMode has a default
          cadPreviewMode: (persisted.cadPreviewMode as 'thumbnail' | 'edrawings') || 'thumbnail',
          // Ensure lowercaseExtensions has a default (true)
          lowercaseExtensions: persisted.lowercaseExtensions !== undefined ? persisted.lowercaseExtensions as boolean : true,
          // Ensure columns have all fields
          columns: currentState.columns.map(defaultCol => {
            const persistedCol = (persisted.columns as ColumnConfig[] || [])
              .find(c => c.id === defaultCol.id)
            return persistedCol ? { ...defaultCol, ...persistedCol } : defaultCol
          })
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

