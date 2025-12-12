import { useEffect, useState, useMemo } from 'react'
import { 
  Trash2, 
  RefreshCw, 
  RotateCcw, 
  FileText, 
  User, 
  Clock, 
  AlertTriangle,
  Loader2,
  FileBox,
  FolderOpen,
  Folder,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Filter,
  List,
  Network,
  Database
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { getDeletedFiles, restoreFile, permanentlyDeleteFile, emptyTrash } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import type { DeletedFile } from '../../types/pdm'
import { getFileIconType } from '../../types/pdm'

// File type icons
function FileIcon({ extension, size = 16 }: { extension: string; size?: number }) {
  const iconType = getFileIconType(extension)
  
  // Simple colored icon based on type
  const getIconColor = () => {
    switch (iconType) {
      case 'part': return 'text-amber-500'
      case 'assembly': return 'text-blue-500'
      case 'drawing': return 'text-purple-500'
      case 'step': return 'text-green-500'
      case 'pdf': return 'text-red-500'
      default: return 'text-pdm-fg-muted'
    }
  }
  
  return <FileText size={size} className={getIconColor()} />
}

export function TrashView() {
  const { organization, isVaultConnected, activeVaultId, user, addToast, addProgressToast, updateProgressToast, removeToast, isProgressToastCancelled, connectedVaults, trashFolderFilter, setTrashFolderFilter } = usePDMStore()
  const [deletedFiles, setDeletedFiles] = useState<DeletedFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [isRestoring, setIsRestoring] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
  const [isEmptying, setIsEmptying] = useState(false)
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [deletedByFilter, setDeletedByFilter] = useState<string | null>(null)
  const [folderFilter, setFolderFilter] = useState<string | null>(null)
  const [vaultFilter, setVaultFilter] = useState<string | null>(null) // null = current vault only, 'all' = all vaults
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'files' | 'folders' | 'nested'>('files') // files = only files, folders = only folders, nested = full hierarchy
  
  // Get current vault name
  const currentVault = connectedVaults.find(v => v.id === activeVaultId)
  
  // Get unique deleted-by users from the files
  const deletedByUsers = useMemo(() => {
    const users = new Map<string, { id: string; name: string }>()
    deletedFiles.forEach(file => {
      if (file.deleted_by && file.deleted_by_user) {
        users.set(file.deleted_by, {
          id: file.deleted_by,
          name: file.deleted_by_user.full_name || file.deleted_by_user.email.split('@')[0]
        })
      }
    })
    return Array.from(users.values())
  }, [deletedFiles])
  
  // Get unique folder paths from deleted files
  const folderPaths = useMemo(() => {
    const folders = new Set<string>()
    deletedFiles.forEach(file => {
      // Get parent folder path
      const lastSlash = file.file_path.lastIndexOf('/')
      if (lastSlash > 0) {
        const folder = file.file_path.substring(0, lastSlash)
        folders.add(folder)
      }
    })
    return Array.from(folders).sort()
  }, [deletedFiles])
  
  // Filter and search files
  const filteredFiles = useMemo(() => {
    return deletedFiles.filter(file => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = file.file_name.toLowerCase().includes(query)
        const matchesPath = file.file_path.toLowerCase().includes(query)
        if (!matchesName && !matchesPath) return false
      }
      
      // Deleted-by filter
      if (deletedByFilter && file.deleted_by !== deletedByFilter) {
        return false
      }
      
      // Folder filter
      if (folderFilter) {
        const fileFolderPath = file.file_path.substring(0, file.file_path.lastIndexOf('/'))
        if (!fileFolderPath.startsWith(folderFilter)) {
          return false
        }
      }
      
      return true
    })
  }, [deletedFiles, searchQuery, deletedByFilter, folderFilter])
  
  // Separate files from folders (folders have file_type 'folder' or no extension and ends with /)
  const { deletedFilesOnly, deletedFoldersOnly } = useMemo(() => {
    const filesOnly: DeletedFile[] = []
    const foldersOnly: DeletedFile[] = []
    
    filteredFiles.forEach(file => {
      // Check if it's a folder - extension is empty and name has no extension
      const isFolder = file.extension === '' && !file.file_name.includes('.')
      
      if (isFolder) {
        foldersOnly.push(file)
      } else {
        filesOnly.push(file)
      }
    })
    
    return { deletedFilesOnly: filesOnly, deletedFoldersOnly: foldersOnly }
  }, [filteredFiles])
  
  // Group files by folder for nested display
  const groupedByFolder = useMemo(() => {
    const groups = new Map<string, DeletedFile[]>()
    
    // Only use actual files (not folders) for nested view
    deletedFilesOnly.forEach(file => {
      const lastSlash = file.file_path.lastIndexOf('/')
      const folder = lastSlash > 0 ? file.file_path.substring(0, lastSlash) : '/'
      
      if (!groups.has(folder)) {
        groups.set(folder, [])
      }
      groups.get(folder)!.push(file)
    })
    
    // Sort folders alphabetically
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  }, [deletedFilesOnly])
  
  // Files sorted by deletion time (most recent first) - for file view
  const filesSortedByTime = useMemo(() => {
    return [...deletedFilesOnly].sort((a, b) => 
      new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
    )
  }, [deletedFilesOnly])
  
  // Folders sorted by deletion time (most recent first) - for folder view
  const foldersSortedByTime = useMemo(() => {
    return [...deletedFoldersOnly].sort((a, b) => 
      new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
    )
  }, [deletedFoldersOnly])
  
  // Toggle folder expansion
  const toggleFolderExpand = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) {
        next.delete(folder)
      } else {
        next.add(folder)
      }
      return next
    })
  }
  
  // Select all files in a folder
  const selectFolder = (folder: string) => {
    const folderFiles = groupedByFolder.get(folder) || []
    setSelectedFiles(prev => {
      const next = new Set(prev)
      const allSelected = folderFiles.every(f => prev.has(f.id))
      
      if (allSelected) {
        // Deselect all in folder
        folderFiles.forEach(f => next.delete(f.id))
      } else {
        // Select all in folder
        folderFiles.forEach(f => next.add(f.id))
      }
      return next
    })
  }
  
  // Check if all files in folder are selected
  const isFolderSelected = (folder: string) => {
    const folderFiles = groupedByFolder.get(folder) || []
    return folderFiles.length > 0 && folderFiles.every(f => selectedFiles.has(f.id))
  }
  
  // Check if some (but not all) files in folder are selected
  const isFolderPartiallySelected = (folder: string) => {
    const folderFiles = groupedByFolder.get(folder) || []
    const selectedCount = folderFiles.filter(f => selectedFiles.has(f.id)).length
    return selectedCount > 0 && selectedCount < folderFiles.length
  }
  
  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('')
    setDeletedByFilter(null)
    setFolderFilter(null)
    setVaultFilter(null)
  }
  
  const hasActiveFilters = searchQuery || deletedByFilter || folderFilter || vaultFilter
  
  // Get the current view items (files, folders, or all files in nested view)
  const currentViewItems = useMemo(() => {
    if (viewMode === 'files') return deletedFilesOnly
    if (viewMode === 'folders') return deletedFoldersOnly
    return deletedFilesOnly // nested view shows files within folder groups
  }, [viewMode, deletedFilesOnly, deletedFoldersOnly])
  
  // Select all items in current view
  const selectAll = () => {
    if (selectedFiles.size === currentViewItems.length && currentViewItems.length > 0) {
      // All selected, deselect all
      setSelectedFiles(new Set())
    } else {
      // Select all items in current view
      setSelectedFiles(new Set(currentViewItems.map(f => f.id)))
    }
  }
  
  const allSelected = currentViewItems.length > 0 && selectedFiles.size === currentViewItems.length
  const someSelected = selectedFiles.size > 0 && selectedFiles.size < currentViewItems.length
  
  // Load deleted files
  const loadDeletedFiles = async () => {
    if (!isVaultConnected || !organization) {
      setDeletedFiles([])
      return
    }
    
    setIsLoading(true)
    
    try {
      const { files, error } = await getDeletedFiles(organization.id, {
        vaultId: vaultFilter === 'all' ? undefined : (activeVaultId || undefined),
        folderPath: trashFolderFilter || undefined
      })
      if (!error && files) {
        setDeletedFiles(files as DeletedFile[])
      }
    } catch (err) {
      console.error('Failed to load deleted files:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDeletedFiles()
  }, [isVaultConnected, organization, activeVaultId, trashFolderFilter, vaultFilter])
  
  // Auto-expand folders when there are few of them
  useEffect(() => {
    if (groupedByFolder.size <= 5) {
      setExpandedFolders(new Set(groupedByFolder.keys()))
    }
  }, [deletedFiles])
  
  // Clear selection when switching view modes
  useEffect(() => {
    setSelectedFiles(new Set())
  }, [viewMode])
  
  // Handle file selection
  const toggleFileSelection = (fileId: string, isShiftClick: boolean, isCtrlClick: boolean) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (isCtrlClick) {
        // Toggle individual file
        if (next.has(fileId)) {
          next.delete(fileId)
        } else {
          next.add(fileId)
        }
      } else if (isShiftClick && prev.size > 0) {
        // Range select (simplified - just add this one)
        next.add(fileId)
      } else {
        // Single select
        return new Set([fileId])
      }
      return next
    })
  }
  
  // Restore selected files
  const handleRestore = async () => {
    if (selectedFiles.size === 0 || !user) return
    
    setIsRestoring(true)
    const fileIds = Array.from(selectedFiles)
    const total = fileIds.length
    
    // For single file, just restore directly
    if (total === 1) {
      try {
        const result = await restoreFile(fileIds[0], user.id)
        if (result.success) {
          addToast('success', 'File restored successfully')
        } else {
          addToast('error', result.error || 'Failed to restore file')
        }
        setSelectedFiles(new Set())
        loadDeletedFiles()
      } catch (err) {
        addToast('error', 'Failed to restore file')
      } finally {
        setIsRestoring(false)
      }
      return
    }
    
    // For multiple files, show progress toast
    const toastId = `restore-${Date.now()}`
    addProgressToast(toastId, `Restoring ${total} files...`, total)
    
    let restored = 0
    let failed = 0
    
    try {
      for (let i = 0; i < fileIds.length; i++) {
        // Check for cancellation
        if (isProgressToastCancelled(toastId)) {
          break
        }
        
        const fileId = fileIds[i]
        try {
          const result = await restoreFile(fileId, user.id)
          if (result.success) {
            restored++
          } else {
            failed++
          }
        } catch {
          failed++
        }
        
        // Update progress
        const percent = Math.round(((i + 1) / total) * 100)
        updateProgressToast(toastId, i + 1, percent)
      }
      
      removeToast(toastId)
      
      if (restored > 0 && failed === 0) {
        addToast('success', `Restored ${restored} file${restored > 1 ? 's' : ''}`)
      } else if (restored > 0) {
        addToast('warning', `Restored ${restored}/${total} files (${failed} failed)`)
      } else {
        addToast('error', 'Failed to restore files')
      }
      
      setSelectedFiles(new Set())
      loadDeletedFiles()
    } catch (err) {
      removeToast(toastId)
      addToast('error', 'Failed to restore files')
    } finally {
      setIsRestoring(false)
    }
  }
  
  // Permanently delete selected files
  const handlePermanentDelete = async () => {
    if (selectedFiles.size === 0 || !user) return
    
    setIsDeleting(true)
    const fileIds = Array.from(selectedFiles)
    const total = fileIds.length
    
    // For single file, just delete directly
    if (total === 1) {
      try {
        const result = await permanentlyDeleteFile(fileIds[0], user.id)
        if (result.success) {
          addToast('success', 'File permanently deleted')
        } else {
          addToast('error', result.error || 'Failed to delete file')
        }
        setSelectedFiles(new Set())
        loadDeletedFiles()
      } catch (err) {
        addToast('error', 'Failed to delete file')
      } finally {
        setIsDeleting(false)
      }
      return
    }
    
    // For multiple files, show progress toast
    const toastId = `delete-permanent-${Date.now()}`
    addProgressToast(toastId, `Permanently deleting ${total} files...`, total)
    
    let deleted = 0
    let failed = 0
    
    try {
      for (let i = 0; i < fileIds.length; i++) {
        // Check for cancellation
        if (isProgressToastCancelled(toastId)) {
          break
        }
        
        const fileId = fileIds[i]
        try {
          const result = await permanentlyDeleteFile(fileId, user.id)
          if (result.success) {
            deleted++
          } else {
            failed++
          }
        } catch {
          failed++
        }
        
        // Update progress
        const percent = Math.round(((i + 1) / total) * 100)
        updateProgressToast(toastId, i + 1, percent)
      }
      
      removeToast(toastId)
      
      if (deleted > 0 && failed === 0) {
        addToast('success', `Permanently deleted ${deleted} file${deleted > 1 ? 's' : ''}`)
      } else if (deleted > 0) {
        addToast('warning', `Deleted ${deleted}/${total} files (${failed} failed)`)
      } else {
        addToast('error', 'Failed to delete files')
      }
      
      setSelectedFiles(new Set())
      loadDeletedFiles()
    } catch (err) {
      removeToast(toastId)
      addToast('error', 'Failed to delete files')
    } finally {
      setIsDeleting(false)
    }
  }
  
  // Empty entire trash
  const handleEmptyTrash = async () => {
    if (!organization || !user) return
    
    setIsEmptying(true)
    
    try {
      const result = await emptyTrash(organization.id, user.id, activeVaultId || undefined)
      if (result.success) {
        addToast('success', `Permanently deleted ${result.deleted} files from trash`)
        setShowEmptyConfirm(false)
        loadDeletedFiles()
      } else {
        addToast('error', result.error || 'Failed to empty trash')
      }
    } catch (err) {
      addToast('error', 'Failed to empty trash')
    } finally {
      setIsEmptying(false)
    }
  }
  
  // Calculate days until permanent deletion
  const getDaysRemaining = (deletedAt: string): number => {
    const deleted = new Date(deletedAt)
    const expires = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000)
    const now = new Date()
    const msRemaining = expires.getTime() - now.getTime()
    return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)))
  }

  if (!isVaultConnected) {
    return (
      <div className="p-4 text-sm text-pdm-fg-muted text-center">
        Open a vault to view trash
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="p-4 text-sm text-pdm-fg-muted text-center">
        Sign in to view trash
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-pdm-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-pdm-fg-muted">
            <Trash2 size={16} />
            <span>
              {viewMode === 'files' ? (
                <>
                  {deletedFilesOnly.length} file{deletedFilesOnly.length !== 1 ? 's' : ''}
                </>
              ) : viewMode === 'folders' ? (
                <>
                  {deletedFoldersOnly.length} folder{deletedFoldersOnly.length !== 1 ? 's' : ''}
                </>
              ) : (
                <>
                  {deletedFilesOnly.length} file{deletedFilesOnly.length !== 1 ? 's' : ''} in {groupedByFolder.size} folder{groupedByFolder.size !== 1 ? 's' : ''}
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* View mode toggle - three options */}
            <div className="flex items-center bg-pdm-bg rounded border border-pdm-border">
              <button
                onClick={() => setViewMode('files')}
                className={`p-1 rounded-l transition-colors ${
                  viewMode === 'files'
                    ? 'bg-pdm-accent/20 text-pdm-accent'
                    : 'hover:bg-pdm-bg-light text-pdm-fg-muted hover:text-pdm-fg'
                }`}
                title="File view - show only deleted files"
              >
                <List size={14} />
              </button>
              <button
                onClick={() => setViewMode('folders')}
                className={`p-1 border-x border-pdm-border transition-colors ${
                  viewMode === 'folders'
                    ? 'bg-pdm-accent/20 text-pdm-accent'
                    : 'hover:bg-pdm-bg-light text-pdm-fg-muted hover:text-pdm-fg'
                }`}
                title="Folder view - show only deleted folders"
              >
                <Folder size={14} />
              </button>
              <button
                onClick={() => setViewMode('nested')}
                className={`p-1 rounded-r transition-colors ${
                  viewMode === 'nested'
                    ? 'bg-pdm-accent/20 text-pdm-accent'
                    : 'hover:bg-pdm-bg-light text-pdm-fg-muted hover:text-pdm-fg'
                }`}
                title="Nested view - show files in folder hierarchy"
              >
                <Network size={14} />
              </button>
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-1 rounded transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-pdm-accent/20 text-pdm-accent'
                  : 'hover:bg-pdm-bg-light text-pdm-fg-muted hover:text-pdm-fg'
              }`}
              title="Filters"
            >
              <Filter size={14} />
            </button>
            <button
              onClick={loadDeletedFiles}
              className="p-1 hover:bg-pdm-bg-light rounded text-pdm-fg-muted hover:text-pdm-fg"
              title="Refresh"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        
        {/* Search input */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pdm-fg-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deleted files..."
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-pdm-fg-muted hover:text-pdm-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>
        
        {/* Filters panel */}
        {showFilters && (
          <div className="space-y-2 pt-1">
            {/* Deleted by filter */}
            {deletedByUsers.length > 0 && (
              <div>
                <label className="text-xs text-pdm-fg-muted mb-1 block">Deleted by</label>
                <select
                  value={deletedByFilter || ''}
                  onChange={(e) => setDeletedByFilter(e.target.value || null)}
                  className="w-full px-2 py-1.5 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                >
                  <option value="">All users</option>
                  {deletedByUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Folder filter */}
            {folderPaths.length > 0 && (
              <div>
                <label className="text-xs text-pdm-fg-muted mb-1 block">Folder</label>
                <select
                  value={folderFilter || ''}
                  onChange={(e) => setFolderFilter(e.target.value || null)}
                  className="w-full px-2 py-1.5 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                >
                  <option value="">All folders</option>
                  {folderPaths.map(path => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Vault filter */}
            {connectedVaults.length > 1 && (
              <div>
                <label className="text-xs text-pdm-fg-muted mb-1 block">Vault</label>
                <select
                  value={vaultFilter || ''}
                  onChange={(e) => setVaultFilter(e.target.value || null)}
                  className="w-full px-2 py-1.5 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                >
                  <option value="">Current vault ({currentVault?.name || 'None'})</option>
                  <option value="all">All vaults</option>
                  {connectedVaults.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Clear filters button */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-pdm-accent hover:text-pdm-accent/80"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
        
        {/* Active filter badges */}
        {hasActiveFilters && !showFilters && (
          <div className="flex flex-wrap gap-1.5">
            {deletedByFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-pdm-accent/20 text-pdm-accent rounded">
                <User size={10} />
                {deletedByUsers.find(u => u.id === deletedByFilter)?.name}
                <button onClick={() => setDeletedByFilter(null)} className="hover:text-pdm-fg">
                  <X size={10} />
                </button>
              </span>
            )}
            {folderFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-pdm-accent/20 text-pdm-accent rounded">
                <FolderOpen size={10} />
                {folderFilter.split('/').pop()}
                <button onClick={() => setFolderFilter(null)} className="hover:text-pdm-fg">
                  <X size={10} />
                </button>
              </span>
            )}
            {vaultFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-pdm-accent/20 text-pdm-accent rounded">
                <Database size={10} />
                {vaultFilter === 'all' ? 'All vaults' : connectedVaults.find(v => v.id === vaultFilter)?.name}
                <button onClick={() => setVaultFilter(null)} className="hover:text-pdm-fg">
                  <X size={10} />
                </button>
              </span>
            )}
          </div>
        )}
        
        {currentVault && !trashFolderFilter && !hasActiveFilters && (
          <div className="flex items-center gap-1.5 text-xs text-pdm-fg-muted">
            <FolderOpen size={12} />
            <span className="truncate">{currentVault.name}</span>
          </div>
        )}
        
        {/* External folder filter indicator (from file browser) */}
        {trashFolderFilter && (
          <div className="flex items-center gap-2 p-2 bg-pdm-bg-light rounded border border-pdm-border">
            <FolderOpen size={14} className="text-pdm-accent flex-shrink-0" />
            <span className="text-sm truncate flex-1" title={trashFolderFilter}>
              {trashFolderFilter.split('/').pop() || trashFolderFilter}
            </span>
            <button
              onClick={() => setTrashFolderFilter(null)}
              className="p-0.5 hover:bg-pdm-bg rounded text-pdm-fg-muted hover:text-pdm-fg"
              title="Show all deleted files"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      
      {/* Action buttons */}
      {currentViewItems.length > 0 && (
        <div className="p-2 border-b border-pdm-border space-y-2">
          {/* Select All row */}
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
                allSelected 
                  ? 'bg-pdm-accent/20 text-pdm-accent' 
                  : 'hover:bg-pdm-bg-light text-pdm-fg-muted hover:text-pdm-fg'
              }`}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected }}
                onChange={selectAll}
                className="w-3.5 h-3.5 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent focus:ring-offset-0 cursor-pointer"
              />
              <span>Select All ({currentViewItems.length})</span>
            </button>
            {selectedFiles.size > 0 && (
              <button
                onClick={() => setSelectedFiles(new Set())}
                className="text-xs text-pdm-fg-muted hover:text-pdm-fg"
              >
                Clear
              </button>
            )}
          </div>
          
          {/* Action buttons row */}
          <div className="flex gap-2">
            <button
              onClick={handleRestore}
              disabled={selectedFiles.size === 0 || isRestoring}
              className={`flex-1 text-xs py-2 px-3 rounded-md flex items-center justify-center gap-1.5 font-medium transition-colors ${
                selectedFiles.size === 0
                  ? 'bg-pdm-bg-light text-pdm-fg-muted cursor-not-allowed opacity-50'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              } disabled:opacity-50`}
            >
              {isRestoring ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              Restore{selectedFiles.size > 0 ? ` (${selectedFiles.size})` : ''}
            </button>
            <button
              onClick={handlePermanentDelete}
              disabled={selectedFiles.size === 0 || isDeleting}
              className={`flex-1 text-xs py-2 px-3 rounded-md flex items-center justify-center gap-1.5 font-medium transition-colors ${
                selectedFiles.size === 0
                  ? 'bg-pdm-bg-light text-pdm-fg-muted cursor-not-allowed opacity-50'
                  : 'bg-pdm-error hover:bg-pdm-error/80 text-white'
              } disabled:opacity-50`}
            >
              {isDeleting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Delete{selectedFiles.size > 0 ? ` (${selectedFiles.size})` : ''}
            </button>
          </div>
        </div>
      )}
      
      {/* File list */}
      <div className="flex-1 overflow-auto">
        {isLoading && deletedFiles.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="spinner" />
          </div>
        ) : deletedFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-pdm-fg-muted">
            <FileBox size={48} className="opacity-30 mb-3" />
            <p className="text-sm">Trash is empty</p>
            <p className="text-xs mt-1 opacity-70">Deleted files appear here</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-pdm-fg-muted">
            <Search size={48} className="opacity-30 mb-3" />
            <p className="text-sm">No matching files</p>
            <p className="text-xs mt-1 opacity-70">Try adjusting your search or filters</p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs text-pdm-accent hover:text-pdm-accent/80"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : viewMode === 'files' ? (
          /* File view - only show deleted files (not folders) */
          <div className="py-1">
            {filesSortedByTime.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-pdm-fg-muted">
                <FileText size={48} className="opacity-30 mb-3" />
                <p className="text-sm">No deleted files</p>
                <p className="text-xs mt-1 opacity-70">Only folders are in the trash</p>
              </div>
            ) : (
              filesSortedByTime.map((file) => {
                const isSelected = selectedFiles.has(file.id)
                const daysRemaining = getDaysRemaining(file.deleted_at)
                
                return (
                  <div
                    key={file.id}
                    onClick={(e) => toggleFileSelection(file.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                    className={`px-3 py-2 cursor-pointer border-l-2 transition-colors ${
                      isSelected
                        ? 'bg-pdm-accent/10 border-pdm-accent'
                        : 'hover:bg-pdm-bg-light border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleFileSelection(file.id, false, true)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 mt-0.5 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent focus:ring-offset-0 cursor-pointer flex-shrink-0"
                      />
                      <FileIcon extension={file.extension} size={16} />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="text-sm text-pdm-fg truncate" title={file.file_name}>
                          {file.file_name}
                        </div>
                        <div className="text-xs text-pdm-fg-muted truncate mt-0.5" title={file.file_path}>
                          {file.file_path}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-pdm-fg-muted mt-1">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatDistanceToNow(new Date(file.deleted_at), { addSuffix: true })}
                          </span>
                          {file.deleted_by_user && (
                            <span className="flex items-center gap-1">
                              <User size={10} />
                              {file.deleted_by_user.full_name || file.deleted_by_user.email.split('@')[0]}
                            </span>
                          )}
                        </div>
                        {daysRemaining <= 7 && (
                          <div className={`flex items-center gap-1 text-xs mt-1 ${
                            daysRemaining <= 3 ? 'text-pdm-error' : 'text-pdm-warning'
                          }`}>
                            <AlertTriangle size={10} />
                            {daysRemaining === 0 
                              ? 'Expires today!' 
                              : `Expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        ) : viewMode === 'folders' ? (
          /* Folder view - only show deleted folders */
          <div className="py-1">
            {foldersSortedByTime.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-pdm-fg-muted">
                <Folder size={48} className="opacity-30 mb-3" />
                <p className="text-sm">No deleted folders</p>
                <p className="text-xs mt-1 opacity-70">Only files are in the trash</p>
              </div>
            ) : (
              foldersSortedByTime.map((folder) => {
                const isSelected = selectedFiles.has(folder.id)
                const daysRemaining = getDaysRemaining(folder.deleted_at)
                
                return (
                  <div
                    key={folder.id}
                    onClick={(e) => toggleFileSelection(folder.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                    className={`px-3 py-2 cursor-pointer border-l-2 transition-colors ${
                      isSelected
                        ? 'bg-pdm-accent/10 border-pdm-accent'
                        : 'hover:bg-pdm-bg-light border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleFileSelection(folder.id, false, true)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 mt-0.5 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent focus:ring-offset-0 cursor-pointer flex-shrink-0"
                      />
                      <FolderOpen size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="text-sm text-pdm-fg truncate" title={folder.file_name}>
                          {folder.file_name}
                        </div>
                        <div className="text-xs text-pdm-fg-muted truncate mt-0.5" title={folder.file_path}>
                          {folder.file_path}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-pdm-fg-muted mt-1">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatDistanceToNow(new Date(folder.deleted_at), { addSuffix: true })}
                          </span>
                          {folder.deleted_by_user && (
                            <span className="flex items-center gap-1">
                              <User size={10} />
                              {folder.deleted_by_user.full_name || folder.deleted_by_user.email.split('@')[0]}
                            </span>
                          )}
                        </div>
                        {daysRemaining <= 7 && (
                          <div className={`flex items-center gap-1 text-xs mt-1 ${
                            daysRemaining <= 3 ? 'text-pdm-error' : 'text-pdm-warning'
                          }`}>
                            <AlertTriangle size={10} />
                            {daysRemaining === 0 
                              ? 'Expires today!' 
                              : `Expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        ) : (
          /* Nested view - show files grouped by folder hierarchy */
          <div className="py-1">
            {groupedByFolder.size === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-pdm-fg-muted">
                <Network size={48} className="opacity-30 mb-3" />
                <p className="text-sm">No deleted files to organize</p>
                <p className="text-xs mt-1 opacity-70">Files will appear in their folder hierarchy</p>
              </div>
            ) : (
              Array.from(groupedByFolder.entries()).map(([folder, files]) => {
                const isExpanded = expandedFolders.has(folder)
                const folderSelected = isFolderSelected(folder)
                const folderPartial = isFolderPartiallySelected(folder)
                const folderName = folder === '/' ? '(root)' : folder.split('/').pop() || folder
                
                return (
                  <div key={folder}>
                    {/* Folder header - clickable to select all files in folder */}
                    <div
                      className={`px-2 py-1.5 flex items-center gap-1.5 cursor-pointer border-l-2 transition-colors ${
                        folderSelected
                          ? 'bg-pdm-accent/10 border-pdm-accent'
                          : folderPartial
                          ? 'bg-pdm-accent/5 border-pdm-accent/50'
                          : 'hover:bg-pdm-bg-light border-transparent'
                      }`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFolderExpand(folder) }}
                        className="p-0.5 hover:bg-pdm-bg rounded text-pdm-fg-muted"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <input
                        type="checkbox"
                        checked={folderSelected}
                        ref={(el) => { if (el) el.indeterminate = folderPartial }}
                        onChange={() => selectFolder(folder)}
                        className="w-3.5 h-3.5 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent focus:ring-offset-0 cursor-pointer"
                      />
                      <div
                        onClick={() => selectFolder(folder)}
                        className="flex-1 flex items-center gap-1.5 min-w-0"
                      >
                        <FolderOpen size={14} className="text-pdm-fg-muted flex-shrink-0" />
                        <span className="text-sm text-pdm-fg truncate" title={folder}>
                          {folderName}
                        </span>
                        <span className="text-xs text-pdm-fg-muted">
                          ({files.length})
                        </span>
                      </div>
                    </div>
                    
                    {/* Files in folder */}
                    {isExpanded && files.map((file) => {
                      const isSelected = selectedFiles.has(file.id)
                      const daysRemaining = getDaysRemaining(file.deleted_at)
                      
                      return (
                        <div
                          key={file.id}
                          onClick={(e) => toggleFileSelection(file.id, e.shiftKey, e.ctrlKey || e.metaKey)}
                          className={`pl-6 pr-3 py-2 cursor-pointer border-l-2 transition-colors ${
                            isSelected
                              ? 'bg-pdm-accent/10 border-pdm-accent'
                              : 'hover:bg-pdm-bg-light border-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFileSelection(file.id, false, true)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-3.5 h-3.5 mt-0.5 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent focus:ring-offset-0 cursor-pointer flex-shrink-0"
                            />
                            <FileIcon extension={file.extension} size={16} />
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="text-sm text-pdm-fg truncate" title={file.file_name}>
                                {file.file_name}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-pdm-fg-muted mt-1">
                                <span className="flex items-center gap-1">
                                  <Clock size={10} />
                                  {formatDistanceToNow(new Date(file.deleted_at), { addSuffix: true })}
                                </span>
                                {file.deleted_by_user && (
                                  <span className="flex items-center gap-1">
                                    <User size={10} />
                                    {file.deleted_by_user.full_name || file.deleted_by_user.email.split('@')[0]}
                                  </span>
                                )}
                              </div>
                              {daysRemaining <= 7 && (
                                <div className={`flex items-center gap-1 text-xs mt-1 ${
                                  daysRemaining <= 3 ? 'text-pdm-error' : 'text-pdm-warning'
                                }`}>
                                  <AlertTriangle size={10} />
                                  {daysRemaining === 0 
                                    ? 'Expires today!' 
                                    : `Expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`
                                  }
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
      
      {/* Footer - Empty Trash */}
      {deletedFiles.length > 0 && (
        <div className="p-2 border-t border-pdm-border">
          <button
            onClick={() => setShowEmptyConfirm(true)}
            className="w-full btn text-xs py-1.5 bg-pdm-error/10 text-pdm-error hover:bg-pdm-error/20 flex items-center justify-center gap-1.5"
          >
            <Trash2 size={12} />
            Empty Trash
          </button>
          <p className="text-[10px] text-pdm-fg-muted text-center mt-1.5">
            Files are automatically deleted after 30 days
          </p>
        </div>
      )}
      
      {/* Empty Trash Confirmation Modal */}
      {showEmptyConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowEmptyConfirm(false)} />
          <div className="relative bg-pdm-bg-light border border-pdm-error/50 rounded-xl shadow-2xl w-[400px] overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-error/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-error/20 rounded-full">
                  <AlertTriangle size={24} className="text-pdm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Empty Trash</h3>
                  <p className="text-sm text-pdm-fg-muted">
                    {deletedFiles.length} file{deletedFiles.length !== 1 ? 's' : ''} will be permanently deleted
                  </p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6">
              <div className="p-4 bg-pdm-error/10 border border-pdm-error/30 rounded-lg">
                <p className="text-sm text-pdm-fg">
                  <strong>Warning:</strong> This action cannot be undone. All files in the trash will be permanently deleted.
                </p>
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={() => setShowEmptyConfirm(false)}
                className="btn btn-ghost"
                disabled={isEmptying}
              >
                Cancel
              </button>
              <button
                onClick={handleEmptyTrash}
                disabled={isEmptying}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white disabled:opacity-50 flex items-center gap-2"
              >
                {isEmptying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Emptying...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Empty Trash
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

