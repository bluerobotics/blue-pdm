import { StateCreator } from 'zustand'
import type { PDMStoreState, FilesSlice, LocalFile, DiffStatus } from '../types'
import type { PDMFile } from '../../types/pdm'
import { buildFullPath } from '../../lib/utils'

export const createFilesSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  FilesSlice
> = (set, get) => ({
  // Initial state
  files: [],
  serverFiles: [],
  serverFolderPaths: new Set<string>(),
  selectedFiles: [],
  expandedFolders: new Set<string>(),
  currentFolder: '',
  persistedPendingMetadata: {},
  sortColumn: 'name',
  sortDirection: 'asc',
  
  // Initial state - Search
  searchQuery: '',
  searchType: 'all',
  searchResults: [],
  isSearching: false,
  recentSearches: [],
  
  // Initial state - Filters
  workflowStateFilter: [],
  extensionFilter: [],
  historyFolderFilter: null,
  trashFolderFilter: null,
  ignorePatterns: {},
  
  // Initial state - Processing
  processingFolders: new Set<string>(),
  
  // Actions - Files
  setFiles: (files) => {
    // Restore any persisted pending metadata to the files
    const { persistedPendingMetadata } = get()
    const filesWithRestoredMetadata = files.map(f => {
      const persisted = persistedPendingMetadata[f.path]
      if (persisted) {
        // Restore pending metadata and mark as modified if it's a synced file
        return { 
          ...f, 
          pendingMetadata: persisted,
          diffStatus: f.pdmData && !['outdated', 'deleted', 'deleted_remote'].includes(f.diffStatus || '') 
            ? 'modified' as const
            : f.diffStatus
        }
      }
      return f
    })
    set({ files: filesWithRestoredMetadata })
  },
  
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
    set(state => {
      // Calculate new pending metadata
      const file = state.files.find(f => f.path === path)
      const existingPending = file?.pendingMetadata || state.persistedPendingMetadata[path] || {}
      
      // Handle config_tabs merge specially (per-config tab numbers)
      let newConfigTabs = existingPending.config_tabs
      if (metadata.config_tabs) {
        newConfigTabs = {
          ...(existingPending.config_tabs || {}),
          ...metadata.config_tabs
        }
      }
      
      // Handle config_descriptions merge specially (per-config descriptions)
      let newConfigDescriptions = existingPending.config_descriptions
      if (metadata.config_descriptions) {
        newConfigDescriptions = {
          ...(existingPending.config_descriptions || {}),
          ...metadata.config_descriptions
        }
      }
      
      const newPending = { 
        ...existingPending, 
        ...metadata,
        config_tabs: newConfigTabs,
        config_descriptions: newConfigDescriptions
      }
      
      return {
        // Update file in files array
        files: state.files.map(f => {
          if (f.path === path) {
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
        }),
        // Also persist for app restart survival
        persistedPendingMetadata: {
          ...state.persistedPendingMetadata,
          [path]: newPending
        }
      }
    })
  },
  
  clearPendingMetadata: (path) => {
    set(state => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [path]: _, ...remainingPersisted } = state.persistedPendingMetadata
      return {
        files: state.files.map(f => 
          f.path === path ? { ...f, pendingMetadata: undefined } : f
        ),
        persistedPendingMetadata: remainingPersisted
      }
    })
  },
  
  clearPendingConfigMetadata: (path) => {
    set(state => {
      const file = state.files.find(f => f.path === path)
      const existingPending = file?.pendingMetadata
      
      // If no pending metadata, nothing to clear
      if (!existingPending) return state
      
      // Create new pending without config_tabs and config_descriptions
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { config_tabs, config_descriptions, ...remainingPending } = existingPending
      
      // Check if there's anything left after removing config metadata
      const hasRemainingPending = Object.keys(remainingPending).some(k => remainingPending[k as keyof typeof remainingPending] !== undefined)
      const newPending = hasRemainingPending ? remainingPending : undefined
      
      // Update persisted metadata too
      const existingPersistedPending = state.persistedPendingMetadata[path]
      let newPersistedMetadata = state.persistedPendingMetadata
      if (existingPersistedPending) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { config_tabs: _ct, config_descriptions: _cd, ...remainingPersistedPending } = existingPersistedPending
        const hasRemainingPersistedPending = Object.keys(remainingPersistedPending).some(k => remainingPersistedPending[k as keyof typeof remainingPersistedPending] !== undefined)
        if (hasRemainingPersistedPending) {
          newPersistedMetadata = { ...state.persistedPendingMetadata, [path]: remainingPersistedPending }
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: _, ...rest } = state.persistedPendingMetadata
          newPersistedMetadata = rest
        }
      }
      
      return {
        files: state.files.map(f => 
          f.path === path ? { ...f, pendingMetadata: newPending } : f
        ),
        persistedPendingMetadata: newPersistedMetadata
      }
    })
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
    newFiles.push({
      name: pdmFile.file_name,
      path: buildFullPath(vaultPath, pdmFile.file_path),
      relativePath: pdmFile.file_path,
      isDirectory: false,
      extension: pdmFile.extension,
      size: pdmFile.file_size || 0,
      modifiedTime: pdmFile.updated_at || '',
      pdmData: pdmFile,
      isSynced: false,
      diffStatus: 'cloud_new'
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
              newDiffStatus = 'outdated'
            } else if (f.diffStatus === 'outdated') {
              newDiffStatus = undefined
            }
          }
          
          // Handle checkout status changes for files marked as 'deleted'
          if (f.diffStatus === 'deleted' && 'checked_out_by' in pdmData && pdmData.checked_out_by === null) {
            newDiffStatus = 'cloud'
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
        // Only remove cloud-only files
        if (f.pdmData?.id === fileId && f.diffStatus === 'cloud') {
          return false
        }
        return true
      }).map(f => {
        // Mark locally existing files as 'deleted_remote'
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
  addRecentSearch: (query) => {
    const { recentSearches } = get()
    const filtered = recentSearches.filter(s => s.toLowerCase() !== query.toLowerCase())
    set({ recentSearches: [query, ...filtered].slice(0, 20) })
  },
  clearRecentSearches: () => set({ recentSearches: [] }),
  
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
  setWorkflowStateFilter: (workflowStateFilter) => set({ workflowStateFilter }),
  setExtensionFilter: (extensionFilter) => set({ extensionFilter }),
  setHistoryFolderFilter: (folderPath) => set({ historyFolderFilter: folderPath }),
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
    return get().ignorePatterns[vaultId] || []
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
          '^' + normalizedPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        )
        if (regex.test(normalizedPath)) return true
      }
    }
    
    return false
  },
  
  // Actions - Processing
  addProcessingFolder: (path) => set(state => {
    const newSet = new Set(state.processingFolders)
    newSet.add(path)
    return { processingFolders: newSet }
  }),
  addProcessingFolders: (paths) => {
    if (paths.length === 0) return
    set(state => {
      const newSet = new Set(state.processingFolders)
      paths.forEach(p => newSet.add(p))
      return { processingFolders: newSet }
    })
  },
  removeProcessingFolder: (path) => set(state => {
    const newSet = new Set(state.processingFolders)
    newSet.delete(path)
    return { processingFolders: newSet }
  }),
  removeProcessingFolders: (paths) => {
    if (paths.length === 0) return
    set(state => {
      const newSet = new Set(state.processingFolders)
      paths.forEach(p => newSet.delete(p))
      return { processingFolders: newSet }
    })
  },
  clearProcessingFolders: () => set({ processingFolders: new Set() }),
  
  // Getters
  getSelectedFileObjects: () => {
    const { files, selectedFiles } = get()
    return files.filter(f => selectedFiles.includes(f.path))
  },
  
  getVisibleFiles: () => {
    const { files, expandedFolders, workflowStateFilter, extensionFilter, searchQuery } = get()
    
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
    
    // Apply workflow state filter
    if (workflowStateFilter.length > 0) {
      visible = visible.filter(f => 
        f.isDirectory || !f.pdmData?.workflow_state_id || workflowStateFilter.includes(f.pdmData.workflow_state_id)
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
  
  getDeletedFiles: () => {
    const { files, serverFiles, vaultPath } = get()
    if (!vaultPath) return []
    
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
  
  getFolderDiffCounts: (folderPath: string) => {
    const { files } = get()
    
    let added = 0
    let modified = 0
    let moved = 0
    let deleted = 0
    let outdated = 0
    let cloud = 0
    let cloudNew = 0
    
    const prefix = folderPath ? folderPath + '/' : ''
    for (const file of files) {
      if (file.isDirectory) continue
      
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
})
