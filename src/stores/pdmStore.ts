import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PDMFile, FileState, Organization, User } from '../types/pdm'

export type SidebarView = 'explorer' | 'checkout' | 'history' | 'search'
export type DetailsPanelTab = 'properties' | 'whereused' | 'contains' | 'history'
export type ToastType = 'error' | 'success' | 'info' | 'warning'
export type DiffStatus = 'added' | 'modified' | 'deleted'

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
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
  gitStatus?: string
  // PDM metadata (from Supabase when connected)
  pdmData?: PDMFile
  // Sync status
  isSynced?: boolean  // True if file exists in cloud
  // Diff status (compared to server)
  diffStatus?: DiffStatus
  // Local content hash (for detecting modifications)
  localHash?: string
}

// Server file info (for tracking deleted files)
export interface ServerFile {
  id: string
  file_path: string
  name: string
  extension: string
  content_hash: string
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
  
  // Vault
  vaultPath: string | null
  isVaultConnected: boolean
  
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
  
  // Columns configuration
  columns: ColumnConfig[]
  
  // Loading states
  isLoading: boolean
  isRefreshing: boolean
  statusMessage: string
  
  // Toasts
  toasts: ToastMessage[]
  
  // Recent vaults
  recentVaults: string[]
  autoConnect: boolean
  
  // Actions - Toasts
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
  
  // Actions - Auth
  setUser: (user: User | null) => void
  setOrganization: (org: Organization | null) => void
  setOfflineMode: (offline: boolean) => void
  signOut: () => void
  
  // Actions - Vault
  setVaultPath: (path: string | null) => void
  setVaultConnected: (connected: boolean) => void
  addRecentVault: (path: string) => void
  setAutoConnect: (auto: boolean) => void
  
  // Actions - Files
  setFiles: (files: LocalFile[]) => void
  setServerFiles: (files: ServerFile[]) => void
  setSelectedFiles: (paths: string[]) => void
  toggleFileSelection: (path: string, multiSelect?: boolean) => void
  selectAllFiles: () => void
  clearSelection: () => void
  toggleFolder: (path: string) => void
  setCurrentFolder: (path: string) => void
  
  // Actions - Search
  setSearchQuery: (query: string) => void
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
  
  // Actions - Columns
  setColumnWidth: (id: string, width: number) => void
  toggleColumnVisibility: (id: string) => void
  reorderColumns: (columns: ColumnConfig[]) => void
  
  // Actions - Status
  setIsLoading: (loading: boolean) => void
  setIsRefreshing: (refreshing: boolean) => void
  setStatusMessage: (message: string) => void
  
  // Getters
  getSelectedFileObjects: () => LocalFile[]
  getVisibleFiles: () => LocalFile[]
  getFileByPath: (path: string) => LocalFile | undefined
  getDeletedFiles: () => LocalFile[]  // Files on server but not locally
  getFolderDiffCounts: (folderPath: string) => { added: number; modified: number; deleted: number }
}

const defaultColumns: ColumnConfig[] = [
  { id: 'name', label: 'Name', width: 280, visible: true, sortable: true },
  { id: 'state', label: 'State', width: 90, visible: true, sortable: true },
  { id: 'revision', label: 'Rev', width: 50, visible: true, sortable: true },
  { id: 'version', label: 'Ver', width: 50, visible: true, sortable: true },
  { id: 'partNumber', label: 'Part Number', width: 120, visible: true, sortable: true },
  { id: 'description', label: 'Description', width: 200, visible: true, sortable: true },
  { id: 'checkedOutBy', label: 'Checked Out', width: 120, visible: true, sortable: true },
  { id: 'extension', label: 'Type', width: 70, visible: true, sortable: true },
  { id: 'size', label: 'Size', width: 80, visible: true, sortable: true },
  { id: 'modifiedTime', label: 'Modified', width: 140, visible: true, sortable: true },
  { id: 'gitStatus', label: 'Git', width: 70, visible: true, sortable: true },
]

export const usePDMStore = create<PDMState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      organization: null,
      isAuthenticated: false,
      isOfflineMode: false,
      
      vaultPath: null,
      isVaultConnected: false,
      
      files: [],
      serverFiles: [],
      selectedFiles: [],
      expandedFolders: new Set<string>(),
      currentFolder: '',
      sortColumn: 'name',
      sortDirection: 'asc',
      
      searchQuery: '',
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
      detailsPanelTab: 'properties',
      
      columns: defaultColumns,
      
      isLoading: false,
      isRefreshing: false,
      statusMessage: '',
      
      toasts: [],
      
      recentVaults: [],
      autoConnect: false,
      
      // Actions - Toasts
      addToast: (type, message, duration = 5000) => {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        set(state => ({ toasts: [...state.toasts, { id, type, message, duration }] }))
      },
      removeToast: (id) => {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
      },
      
      // Actions - Auth
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setOrganization: (organization) => set({ organization }),
      setOfflineMode: (isOfflineMode) => set({ isOfflineMode }),
      signOut: () => set({ user: null, organization: null, isAuthenticated: false, isOfflineMode: false }),
      
      // Actions - Vault
      setVaultPath: (vaultPath) => set({ vaultPath }),
      setVaultConnected: (isVaultConnected) => set({ isVaultConnected }),
      addRecentVault: (path) => {
        const { recentVaults } = get()
        const updated = [path, ...recentVaults.filter(v => v !== path)].slice(0, 10)
        set({ recentVaults: updated })
      },
      setAutoConnect: (autoConnect) => set({ autoConnect }),
      
      // Actions - Files
      setFiles: (files) => set({ files }),
      setServerFiles: (serverFiles) => set({ serverFiles }),
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
      setDetailsPanelHeight: (height) => set({ detailsPanelHeight: Math.max(150, Math.min(500, height)) }),
      setDetailsPanelTab: (detailsPanelTab) => set({ detailsPanelTab }),
      
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
            const parentPath = parts.slice(0, -1).join('/')
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
            f.pdmData?.partNumber?.toLowerCase().includes(query) ||
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
            path: `${vaultPath}\\${sf.file_path.replace(/\//g, '\\')}`,
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
        let deleted = 0
        
        // Count all files (including deleted ghost entries) recursively
        const prefix = folderPath ? folderPath + '/' : ''
        for (const file of files) {
          if (file.isDirectory) continue
          
          // Check if file is in this folder or subfolder
          if (folderPath) {
            if (!file.relativePath.startsWith(prefix)) continue
          }
          
          if (file.diffStatus === 'added') added++
          else if (file.diffStatus === 'modified') modified++
          else if (file.diffStatus === 'deleted') deleted++
        }
        
        return { added, modified, deleted }
      }
    }),
    {
      name: 'blue-pdm-storage',
      partialize: (state) => ({
        vaultPath: state.vaultPath,
        recentVaults: state.recentVaults,
        autoConnect: state.autoConnect,
        sidebarVisible: state.sidebarVisible,
        sidebarWidth: state.sidebarWidth,
        activeView: state.activeView,
        detailsPanelVisible: state.detailsPanelVisible,
        detailsPanelHeight: state.detailsPanelHeight,
        columns: state.columns,
        expandedFolders: Array.from(state.expandedFolders)
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Record<string, unknown>
        return {
          ...currentState,
          ...persisted,
          // Convert expandedFolders back to Set
          expandedFolders: new Set(persisted.expandedFolders as string[] || []),
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

