import { useState, useRef, useCallback, useEffect } from 'react'
import { 
  ChevronUp, 
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  Folder,
  File,
  FileBox,
  FileText,
  Layers,
  Lock,
  MoreVertical,
  RefreshCw,
  Upload,
  Home,
  Cloud,
  CloudOff,
  HardDrive,
  Pencil,
  Trash2,
  ArrowDown,
  ArrowUp,
  Undo2,
  AlertTriangle
} from 'lucide-react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { getFileType, formatFileSize, STATE_INFO } from '../types/pdm'
import { syncFile } from '../lib/supabase'
import { format } from 'date-fns'

interface FileBrowserProps {
  onRefresh: () => void
}

export function FileBrowser({ onRefresh }: FileBrowserProps) {
  const {
    files,
    selectedFiles,
    toggleFileSelection,
    selectAllFiles,
    clearSelection,
    columns,
    setColumnWidth,
    sortColumn,
    sortDirection,
    toggleSort,
    isLoading,
    isRefreshing,
    vaultPath,
    setStatusMessage,
    user,
    organization,
    currentFolder,
    setCurrentFolder,
    expandedFolders,
    toggleFolder,
    addToast
  } = usePDMStore()

  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(null)
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<LocalFile | null>(null)
  const [undoStack, setUndoStack] = useState<Array<{ type: 'delete'; file: LocalFile; originalPath: string }>>([])
  const tableRef = useRef<HTMLDivElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Use store's currentFolder instead of local state
  const currentPath = currentFolder

  // Get files in current folder (direct children only)
  const currentFolderFiles = files.filter(file => {
    const fileParts = file.relativePath.split('/')
    
    if (currentPath === '') {
      // Root level - show only top-level items
      return fileParts.length === 1
    } else {
      // In a subfolder - show direct children
      const currentParts = currentPath.split('/')
      
      // File must be exactly one level deeper than current path
      if (fileParts.length !== currentParts.length + 1) return false
      
      // File must start with current path
      for (let i = 0; i < currentParts.length; i++) {
        if (fileParts[i] !== currentParts[i]) return false
      }
      
      return true
    }
  })

  // Sort: folders first, then by selected column
  const sortedFiles = [...currentFolderFiles].sort((a, b) => {
    // Folders always first
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1

    let comparison = 0
    switch (sortColumn) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'size':
        comparison = a.size - b.size
        break
      case 'modifiedTime':
        comparison = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime()
        break
      case 'extension':
        comparison = a.extension.localeCompare(b.extension)
        break
      default:
        comparison = a.name.localeCompare(b.name)
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })

  // Check if all files in a folder are synced
  const isFolderSynced = (folderPath: string): boolean => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    if (folderFiles.length === 0) return false // Empty folder = not synced
    return folderFiles.every(f => !!f.pdmData)
  }

  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      const synced = isFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-pdm-success' : 'text-pdm-fg-muted'} />
    }
    
    const fileType = getFileType(file.extension)
    switch (fileType) {
      case 'part':
        return <FileBox size={16} className="text-pdm-accent" />
      case 'assembly':
        return <Layers size={16} className="text-pdm-success" />
      case 'drawing':
        return <FileText size={16} className="text-pdm-info" />
      default:
        return <File size={16} className="text-pdm-fg-muted" />
    }
  }

  // Navigate to a folder - also expand it and its parents in sidebar
  const navigateToFolder = (folderPath: string) => {
    setCurrentFolder(folderPath)
    
    if (folderPath === '') return // Root doesn't need expansion
    
    // Expand the folder and all its parents in the sidebar
    const parts = folderPath.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/')
      if (!expandedFolders.has(ancestorPath)) {
        toggleFolder(ancestorPath)
      }
    }
  }

  // Navigate up one level
  const navigateUp = () => {
    if (currentPath === '') return
    const parts = currentPath.split('/')
    parts.pop()
    navigateToFolder(parts.join('/'))
  }
  
  // Navigate to root
  const navigateToRoot = () => {
    setCurrentFolder('')
  }

  const handleColumnResize = useCallback((e: React.MouseEvent, columnId: string) => {
    e.preventDefault()
    setResizingColumn(columnId)

    const startX = e.clientX
    const column = columns.find(c => c.id === columnId)
    if (!column) return
    const startWidth = column.width

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX
      setColumnWidth(columnId, startWidth + diff)
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [columns, setColumnWidth])

  const handleContextMenu = (e: React.MouseEvent, file: LocalFile) => {
    e.preventDefault()
    e.stopPropagation()
    setEmptyContextMenu(null)
    // Move context menu to new position (works even if already open)
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    // Only trigger if clicking on empty space, not on a file row
    const target = e.target as HTMLElement
    if (target.closest('tr') && target.closest('tbody')) return
    
    e.preventDefault()
    setContextMenu(null)
    // Move empty context menu to new position (works even if already open)
    setEmptyContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !vaultPath || !window.electronAPI) {
      setIsCreatingFolder(false)
      setNewFolderName('')
      return
    }

    const folderName = newFolderName.trim()
    const folderPath = currentPath 
      ? `${vaultPath}\\${currentPath.replace(/\//g, '\\')}\\${folderName}`
      : `${vaultPath}\\${folderName}`

    try {
      const result = await window.electronAPI.createFolder(folderPath)
      if (result.success) {
        addToast('success', `Created folder "${folderName}"`)
        onRefresh()
      } else {
        addToast('error', `Failed to create folder: ${result.error}`)
      }
    } catch (err) {
      addToast('error', `Failed to create folder: ${err instanceof Error ? err.message : String(err)}`)
    }

    setIsCreatingFolder(false)
    setNewFolderName('')
  }

  const startCreatingFolder = () => {
    setEmptyContextMenu(null)
    setIsCreatingFolder(true)
    setNewFolderName('New Folder')
    // Focus input after render
    setTimeout(() => {
      newFolderInputRef.current?.focus()
      newFolderInputRef.current?.select()
    }, 10)
  }

  const startRenaming = (file: LocalFile) => {
    setContextMenu(null)
    setRenamingFile(file)
    setRenameValue(file.name)
    // Focus input after render
    setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 10)
  }

  const handleRename = async () => {
    if (!renamingFile || !renameValue.trim() || !vaultPath || !window.electronAPI) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    const newName = renameValue.trim()
    if (newName === renamingFile.name) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    // Build new path
    const parentDir = renamingFile.path.substring(0, renamingFile.path.lastIndexOf('\\'))
    const newPath = `${parentDir}\\${newName}`

    try {
      const result = await window.electronAPI.renameItem(renamingFile.path, newPath)
      if (result.success) {
        addToast('success', `Renamed to "${newName}"`)
        onRefresh()
      } else {
        addToast('error', `Failed to rename: ${result.error}`)
      }
    } catch (err) {
      addToast('error', `Failed to rename: ${err instanceof Error ? err.message : String(err)}`)
    }

    setRenamingFile(null)
    setRenameValue('')
  }

  // Get all files in a folder (for folder operations)
  const getFilesInFolder = (folderPath: string): LocalFile[] => {
    return files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
  }

  // Check out a folder (all synced files in it)
  const handleCheckoutFolder = async (folder: LocalFile) => {
    if (!user || !organization) {
      addToast('error', 'Please sign in first')
      return
    }

    const folderFiles = getFilesInFolder(folder.relativePath)
    const syncedFiles = folderFiles.filter(f => f.pdmData)
    
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check out in this folder')
      return
    }

    setStatusMessage(`Checking out ${syncedFiles.length} files...`)
    
    // TODO: Implement actual checkout via Supabase
    // For now, just show a message
    addToast('info', `Would check out ${syncedFiles.length} files in ${folder.name}`)
    setStatusMessage('')
  }

  // Check in a folder (all checked-out files in it that we own)
  const handleCheckinFolder = async (folder: LocalFile) => {
    if (!user || !organization) {
      addToast('error', 'Please sign in first')
      return
    }

    const folderFiles = getFilesInFolder(folder.relativePath)
    // Get files that are synced (checkin works even if not all are checked out)
    const syncedFiles = folderFiles.filter(f => f.pdmData)
    
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check in')
      return
    }

    setStatusMessage(`Checking in ${syncedFiles.length} files...`)
    
    // TODO: Implement actual checkin via Supabase
    // For now, just show a message
    addToast('info', `Would check in ${syncedFiles.length} files in ${folder.name}`)
    setStatusMessage('')
  }

  // Delete a file or folder (moves to trash/recycle bin)
  const handleDelete = async (file: LocalFile) => {
    if (!vaultPath || !window.electronAPI) {
      addToast('error', 'No vault connected')
      return
    }

    try {
      const result = await window.electronAPI.deleteItem(file.path)
      if (result.success) {
        // Add to undo stack
        setUndoStack(prev => [...prev, { type: 'delete', file, originalPath: file.path }])
        addToast('success', `Deleted "${file.name}"`, 5000)
        onRefresh()
      } else {
        addToast('error', `Failed to delete: ${result.error}`)
      }
    } catch (err) {
      addToast('error', `Failed to delete: ${err instanceof Error ? err.message : String(err)}`)
    }
    
    setDeleteConfirm(null)
  }

  // Undo last action
  const handleUndo = async () => {
    if (undoStack.length === 0) {
      addToast('info', 'Nothing to undo')
      return
    }

    const lastAction = undoStack[undoStack.length - 1]
    
    if (lastAction.type === 'delete') {
      // Unfortunately, once deleted via shell.trashItem, we can't programmatically restore
      // The user needs to restore from Recycle Bin manually
      addToast('info', `"${lastAction.file.name}" was moved to Recycle Bin. Restore it from there.`, 6000)
    }
    
    // Remove from undo stack
    setUndoStack(prev => prev.slice(0, -1))
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
      // Delete key
      if (e.key === 'Delete' && selectedFiles.length > 0) {
        const selectedFile = files.find(f => f.path === selectedFiles[0])
        if (selectedFile) {
          setDeleteConfirm(selectedFile)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undoStack, selectedFiles, files])

  const handleRowClick = (e: React.MouseEvent, file: LocalFile) => {
    // Select the file/folder
    toggleFileSelection(file.path, e.ctrlKey || e.metaKey || e.shiftKey)
  }

  const handleRowDoubleClick = (file: LocalFile) => {
    if (file.isDirectory) {
      // Navigate into folder
      navigateToFolder(file.relativePath)
    } else if (window.electronAPI) {
      // Open file
      window.electronAPI.openFile(file.path)
    }
  }

  // Add files via dialog
  const handleAddFiles = async () => {
    if (!window.electronAPI || !vaultPath) {
      setStatusMessage('No vault connected')
      return
    }

    const result = await window.electronAPI.selectFiles()
    if (!result.success || !result.files || result.files.length === 0) {
      return // Cancelled or no files selected
    }

    setStatusMessage(`Adding ${result.files.length} file${result.files.length > 1 ? 's' : ''}...`)

    try {
      let successCount = 0
      let errorCount = 0

      for (const file of result.files) {
        const destPath = `${vaultPath}\\${file.name}`
        console.log('[AddFiles] Copying:', file.path, '->', destPath)

        const copyResult = await window.electronAPI.copyFile(file.path, destPath)
        if (copyResult.success) {
          successCount++
        } else {
          errorCount++
          console.error(`Failed to copy ${file.name}:`, copyResult.error)
        }
      }

      if (errorCount === 0) {
        setStatusMessage(`Added ${successCount} file${successCount > 1 ? 's' : ''}`)
      } else {
        setStatusMessage(`Added ${successCount}, failed ${errorCount}`)
      }

      // Refresh the file list
      setTimeout(() => {
        onRefresh()
        setTimeout(() => setStatusMessage(''), 3000)
      }, 100)

    } catch (err) {
      console.error('Error adding files:', err)
      setStatusMessage('Failed to add files')
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    if (!window.electronAPI || !vaultPath) {
      setStatusMessage('No vault connected')
      return
    }

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // Use Electron's webUtils.getPathForFile to get the file paths
    const filePaths: string[] = []
    for (const file of droppedFiles) {
      try {
        const filePath = window.electronAPI.getPathForFile(file)
        if (filePath) {
          filePaths.push(filePath)
        }
      } catch (err) {
        console.error('Error getting file path:', err)
      }
    }

    if (filePaths.length === 0) {
      setStatusMessage('Could not get file paths')
      setTimeout(() => setStatusMessage(''), 3000)
      return
    }

    setStatusMessage(`Adding ${filePaths.length} file${filePaths.length > 1 ? 's' : ''}...`)

    try {
      let successCount = 0
      let errorCount = 0

      for (const sourcePath of filePaths) {
        const fileName = sourcePath.split(/[/\\]/).pop() || 'unknown'
        const destPath = `${vaultPath}\\${fileName}`

        console.log('[Drop] Copying:', sourcePath, '->', destPath)

        const result = await window.electronAPI.copyFile(sourcePath, destPath)
        if (result.success) {
          successCount++
        } else {
          errorCount++
          console.error(`Failed to copy ${fileName}:`, result.error)
        }
      }

      if (errorCount === 0) {
        setStatusMessage(`Added ${successCount} file${successCount > 1 ? 's' : ''}`)
      } else {
        setStatusMessage(`Added ${successCount}, failed ${errorCount}`)
      }

      // Refresh the file list
      setTimeout(() => {
        onRefresh()
        setTimeout(() => setStatusMessage(''), 3000)
      }, 100)

    } catch (err) {
      console.error('Error adding files:', err)
      setStatusMessage('Failed to add files')
      setTimeout(() => setStatusMessage(''), 3000)
    }
  }

  const renderCellContent = (file: LocalFile, columnId: string) => {
    switch (columnId) {
      case 'name':
        const isSynced = !!file.pdmData
        const isBeingRenamed = renamingFile?.path === file.path
        
        if (isBeingRenamed) {
          return (
            <div className="flex items-center gap-2">
              {getFileIcon(file)}
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRename()
                  } else if (e.key === 'Escape') {
                    setRenamingFile(null)
                    setRenameValue('')
                  }
                }}
                onBlur={handleRename}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-pdm-bg border border-pdm-accent rounded px-2 py-0.5 text-sm text-pdm-fg focus:outline-none focus:ring-1 focus:ring-pdm-accent"
              />
            </div>
          )
        }
        
        return (
          <div className="flex items-center gap-2">
            {getFileIcon(file)}
            <span className="truncate flex-1">{file.name}</span>
            {!file.isDirectory && (
              <span 
                className={`flex-shrink-0 ${isSynced ? 'text-pdm-success' : 'text-pdm-fg-muted'}`}
                title={isSynced ? 'Synced with cloud' : 'Local only - not synced'}
              >
                {isSynced ? <Cloud size={12} /> : <HardDrive size={12} />}
              </span>
            )}
          </div>
        )
      case 'state':
        if (file.isDirectory) return null
        const state = file.pdmData?.state || 'wip'
        const stateInfo = STATE_INFO[state]
        return (
          <span className={`state-badge ${state.replace('_', '-')}`}>
            {stateInfo?.label || state}
          </span>
        )
      case 'revision':
        return file.isDirectory ? '' : (file.pdmData?.revision || 'A')
      case 'version':
        if (file.isDirectory) return ''
        const localVersion = 1 // TODO: track local version from file hash changes
        const cloudVersion = file.pdmData?.version || null
        if (cloudVersion) {
          return `${localVersion}/${cloudVersion}`
        }
        return `${localVersion}/-`
      case 'partNumber':
        return file.pdmData?.part_number || ''
      case 'description':
        return file.pdmData?.description || ''
      case 'checkedOutBy':
        if (file.pdmData?.checked_out_by) {
          return (
            <span className="checkout-indicator">
              <Lock size={12} />
              {file.pdmData.checked_out_by}
            </span>
          )
        }
        return ''
      case 'extension':
        return file.extension ? file.extension.replace('.', '').toUpperCase() : ''
      case 'size':
        return file.isDirectory ? '' : formatFileSize(file.size)
      case 'modifiedTime':
        return format(new Date(file.modifiedTime), 'MMM d, yyyy HH:mm')
      case 'gitStatus':
        if (!file.gitStatus || file.gitStatus === 'committed') return ''
        return (
          <span className={`git-status ${file.gitStatus}`}>
            {file.gitStatus === 'modified' && 'M'}
            {file.gitStatus === 'untracked' && 'U'}
            {file.gitStatus === 'staged' && 'S'}
            {file.gitStatus === 'deleted' && 'D'}
            {file.gitStatus === 'added' && 'A'}
          </span>
        )
      default:
        return ''
    }
  }

  const visibleColumns = columns.filter(c => c.visible)

  return (
    <div 
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 bg-pdm-accent/10 border-2 border-dashed border-pdm-accent rounded-lg flex items-center justify-center pointer-events-none">
          <div className="bg-pdm-bg-light border border-pdm-accent rounded-xl p-6 flex flex-col items-center gap-3 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-pdm-accent/20 flex items-center justify-center">
              <Upload size={32} className="text-pdm-accent" />
            </div>
            <div className="text-lg font-semibold text-pdm-fg">Drop files to add</div>
            <div className="text-sm text-pdm-fg-muted">Files will be copied to the vault</div>
          </div>
        </div>
      )}

      {/* Toolbar with breadcrumb */}
      <div className="h-10 bg-pdm-bg-light border-b border-pdm-border flex items-center px-2 flex-shrink-0 gap-2">
        {/* Navigation buttons */}
        <button
          onClick={navigateUp}
          disabled={currentPath === ''}
          className="btn btn-ghost btn-sm p-1"
          title="Go up"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={navigateToRoot}
          disabled={currentPath === ''}
          className="btn btn-ghost btn-sm p-1"
          title="Go to root"
        >
          <Home size={16} />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
          <button
            onClick={navigateToRoot}
            className="text-pdm-fg-dim hover:text-pdm-fg transition-colors px-1"
          >
            Vault
          </button>
          {currentPath && currentPath.split('/').map((part, i, arr) => {
            const pathUpToHere = arr.slice(0, i + 1).join('/')
            return (
              <div key={pathUpToHere} className="flex items-center gap-1">
                <ChevronRight size={14} className="text-pdm-fg-muted" />
                <button
                  onClick={() => navigateToFolder(pathUpToHere)}
                  className={`px-1 truncate ${
                    i === arr.length - 1 
                      ? 'text-pdm-fg font-medium' 
                      : 'text-pdm-fg-dim hover:text-pdm-fg'
                  } transition-colors`}
                >
                  {part}
                </button>
              </div>
            )
          })}
        </div>

        {/* File count */}
        <span className="text-xs text-pdm-fg-muted px-2">
          {selectedFiles.length > 0 
            ? `${selectedFiles.length} selected`
            : `${sortedFiles.length} items`
          }
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleAddFiles}
            className="btn btn-primary btn-sm gap-1"
            title="Add files to vault"
          >
            <Upload size={14} />
            Add
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading || isRefreshing}
            className="btn btn-ghost btn-sm p-1"
            title="Refresh (F5)"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div 
        ref={tableRef} 
        className="flex-1 overflow-auto"
        onContextMenu={handleEmptyContextMenu}
      >
        <table className="file-table">
          <thead>
            <tr>
              {visibleColumns.map(column => (
                <th
                  key={column.id}
                  style={{ width: column.width }}
                  className={column.sortable ? 'sortable' : ''}
                  onClick={() => column.sortable && toggleSort(column.id)}
                >
                  <div className="flex items-center gap-1">
                    <span>{column.label}</span>
                    {sortColumn === column.id && (
                      sortDirection === 'asc' 
                        ? <ChevronUp size={12} />
                        : <ChevronDown size={12} />
                    )}
                  </div>
                  <div
                    className={`column-resize-handle ${resizingColumn === column.id ? 'resizing' : ''}`}
                    onMouseDown={(e) => handleColumnResize(e, column.id)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* New folder input row */}
            {isCreatingFolder && (
              <tr className="new-folder-row">
                <td colSpan={visibleColumns.length}>
                  <div className="flex items-center gap-2 py-1">
                    <FolderOpen size={16} className="text-pdm-accent" />
                    <input
                      ref={newFolderInputRef}
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateFolder()
                        } else if (e.key === 'Escape') {
                          setIsCreatingFolder(false)
                          setNewFolderName('')
                        }
                      }}
                      onBlur={handleCreateFolder}
                      className="bg-pdm-bg border border-pdm-accent rounded px-2 py-1 text-sm text-pdm-fg focus:outline-none focus:ring-1 focus:ring-pdm-accent"
                      placeholder="Folder name"
                    />
                  </div>
                </td>
              </tr>
            )}
            {sortedFiles.map(file => {
              const diffClass = file.diffStatus === 'added' ? 'diff-added' 
                : file.diffStatus === 'modified' ? 'diff-modified'
                : file.diffStatus === 'deleted' ? 'diff-deleted' : ''
              
              return (
              <tr
                key={file.path}
                className={`${selectedFiles.includes(file.path) ? 'selected' : ''} ${diffClass}`}
                onClick={(e) => handleRowClick(e, file)}
                onDoubleClick={() => handleRowDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                {visibleColumns.map(column => (
                  <td key={column.id} style={{ width: column.width }}>
                    {renderCellContent(file, column.id)}
                  </td>
                ))}
              </tr>
            )})}
          </tbody>
        </table>

        {sortedFiles.length === 0 && !isLoading && (
          <div className="empty-state">
            <Upload className="empty-state-icon" />
            <div className="empty-state-title">No files yet</div>
            <div className="empty-state-description">
              Drag and drop files here, or click below
            </div>
            <button
              onClick={handleAddFiles}
              className="btn btn-primary mt-4 gap-2"
            >
              <Upload size={16} />
              Add Files
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="spinner" />
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
        const isSynced = !!contextMenu.file.pdmData
        const isFolder = contextMenu.file.isDirectory
        
        return (
          <>
            <div 
              className="fixed inset-0 z-50" 
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                // Allow right-click to reposition or close
                setContextMenu(null)
              }}
            />
            <div 
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {!isFolder && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    window.electronAPI?.openFile(contextMenu.file.path)
                    setContextMenu(null)
                  }}
                >
                  Open
                </div>
              )}
              {isFolder && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    navigateToFolder(contextMenu.file.relativePath)
                    setContextMenu(null)
                  }}
                >
                  Open Folder
                </div>
              )}
              <div 
                className="context-menu-item"
                onClick={() => {
                  window.electronAPI?.openInExplorer(contextMenu.file.path)
                  setContextMenu(null)
                }}
              >
                Show in Explorer
              </div>
              
              <div 
                className="context-menu-item"
                onClick={() => startRenaming(contextMenu.file)}
              >
                <Pencil size={14} />
                Rename
              </div>
              
              <div className="context-menu-separator" />
              
              {/* Sync option - only for unsynced items */}
              {!isSynced && (
                <div 
                  className="context-menu-item"
                  onClick={async () => {
                    const file = contextMenu.file
                    setContextMenu(null)
                    
                    if (!user) {
                      addToast('error', 'Please sign in to sync files')
                      return
                    }
                    
                    if (!organization) {
                      const domain = user.email.split('@')[1]
                      addToast('error', `No organization found for @${domain}. Ask your admin to create one in Supabase.`)
                      return
                    }
                    
                    if (isFolder) {
                      // Sync folder - find all files in this folder and subfolders
                      const folderPrefix = file.relativePath + '/'
                      const folderFiles = files.filter(f => 
                        !f.isDirectory && 
                        (f.relativePath.startsWith(folderPrefix) || 
                         f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === file.relativePath)
                      )
                      
                      // Filter to only unsynced files
                      const unsyncedFiles = folderFiles.filter(f => !f.pdmData)
                      
                      if (unsyncedFiles.length === 0) {
                        if (folderFiles.length > 0) {
                          addToast('info', `All ${folderFiles.length} files already synced`)
                        } else {
                          addToast('info', 'No files to sync in this folder')
                        }
                        setStatusMessage('')
                        return
                      }
                      
                      let synced = 0
                      let failed = 0
                      const errors: string[] = []
                      const total = unsyncedFiles.length
                      const totalBytes = unsyncedFiles.reduce((sum, f) => sum + f.size, 0)
                      let uploadedBytes = 0
                      const startTime = Date.now()
                      
                      const formatSpeed = (bytesPerSec: number) => {
                        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
                        return `${bytesPerSec.toFixed(0)} B/s`
                      }
                      
                      const formatSize = (bytes: number) => {
                        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
                        if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
                        return `${bytes} B`
                      }
                      
                      setStatusMessage(`Syncing 0/${total} files (0%)...`)
                      
                      for (let i = 0; i < unsyncedFiles.length; i++) {
                        const f = unsyncedFiles[i]
                        const elapsed = (Date.now() - startTime) / 1000
                        const speed = elapsed > 0 ? uploadedBytes / elapsed : 0
                        const percent = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0
                        
                        setStatusMessage(`Syncing ${i + 1}/${total} (${percent}%) • ${formatSpeed(speed)} • ${f.name}`)
                        
                        try {
                          const readResult = await window.electronAPI?.readFile(f.path)
                          if (!readResult?.success) {
                            failed++
                            errors.push(`${f.name}: Failed to read file`)
                            console.error('Read error for', f.name, readResult?.error)
                            continue
                          }
                          
                          if (!readResult.data || !readResult.hash) {
                            failed++
                            errors.push(`${f.name}: No data or hash`)
                            continue
                          }
                          
                          const { error } = await syncFile(
                            organization.id,
                            user.id,
                            f.relativePath,
                            f.name,
                            f.extension,
                            f.size,
                            readResult.hash,
                            readResult.data
                          )
                          
                          if (error) {
                            failed++
                            const errMsg = typeof error === 'object' && 'message' in error 
                              ? (error as {message: string}).message 
                              : String(error)
                            errors.push(`${f.name}: ${errMsg}`)
                            console.error('Sync error for', f.name, error)
                          } else {
                            synced++
                            uploadedBytes += f.size
                          }
                        } catch (err) {
                          failed++
                          errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`)
                          console.error('Sync error for', f.name, err)
                        }
                      }
                      
                      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
                      const avgSpeed = formatSpeed(uploadedBytes / parseFloat(totalTime))
                      setStatusMessage('')
                      
                      if (failed > 0) {
                        addToast('warning', `Synced ${synced}/${total} files (${formatSize(uploadedBytes)}) in ${totalTime}s. ${failed} failed.`)
                        console.error('Sync errors:', errors)
                        if (errors.length <= 3) {
                          errors.forEach(e => addToast('error', e, 8000))
                        }
                      } else if (synced > 0) {
                        addToast('success', `Synced ${synced} files (${formatSize(uploadedBytes)}) in ${totalTime}s • ${avgSpeed}`)
                      }
                      
                      onRefresh()
                    } else {
                      // Sync single file
                      setStatusMessage(`Syncing ${file.name}...`)
                      
                      try {
                        const readResult = await window.electronAPI?.readFile(file.path)
                        if (readResult?.success && readResult.data && readResult.hash) {
                          const { error, isNew } = await syncFile(
                            organization.id,
                            user.id,
                            file.relativePath,
                            file.name,
                            file.extension,
                            file.size,
                            readResult.hash,
                            readResult.data
                          )
                          
                          if (error) {
                            const errorMsg = typeof error === 'object' && error !== null && 'message' in error 
                              ? (error as { message: string }).message 
                              : String(error)
                            addToast('error', `Failed to sync: ${errorMsg}`)
                          } else {
                            addToast('success', `${isNew ? 'Synced' : 'Updated'} ${file.name}`)
                            onRefresh()
                          }
                        } else {
                          addToast('error', 'Failed to read file')
                        }
                      } catch (err) {
                        console.error('Sync error:', err)
                        addToast('error', 'Failed to sync file')
                      }
                      setStatusMessage('')
                    }
                  }}
                >
                  <Cloud size={14} />
                  {isFolder ? 'Sync Folder to Cloud' : 'Sync to Cloud'}
                </div>
              )}
              
              {/* Check Out - for synced files or folders with synced content */}
              {isFolder ? (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    handleCheckoutFolder(contextMenu.file)
                    setContextMenu(null)
                  }}
                >
                  <ArrowDown size={14} className="text-pdm-error" />
                  Check Out Folder
                </div>
              ) : (
                <div 
                  className={`context-menu-item ${!isSynced ? 'disabled' : ''}`}
                  onClick={() => {
                    if (!isSynced) return
                    // TODO: Implement checkout
                    setStatusMessage('Check out not implemented yet')
                    setContextMenu(null)
                  }}
                  title={!isSynced ? 'File must be synced first' : ''}
                >
                  <ArrowDown size={14} className="text-pdm-error" />
                  Check Out
                  {!isSynced && <span className="text-xs text-pdm-fg-muted ml-auto">(sync first)</span>}
                </div>
              )}
              
              {/* Check In - for synced files or folders with synced content */}
              {isFolder ? (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    handleCheckinFolder(contextMenu.file)
                    setContextMenu(null)
                  }}
                >
                  <ArrowUp size={14} className="text-pdm-success" />
                  Check In Folder
                </div>
              ) : (
                <div 
                  className={`context-menu-item ${!isSynced ? 'disabled' : ''}`}
                  onClick={() => {
                    if (!isSynced) return
                    // TODO: Implement checkin
                    setStatusMessage('Check in not implemented yet')
                    setContextMenu(null)
                  }}
                  title={!isSynced ? 'File must be synced first' : ''}
                >
                  <ArrowUp size={14} className="text-pdm-success" />
                  Check In
                  {!isSynced && <span className="text-xs text-pdm-fg-muted ml-auto">(sync first)</span>}
                </div>
              )}
              
              <div className="context-menu-separator" />
              
              {!isFolder && isSynced && (
                <>
                  <div className="context-menu-item">
                    View History
                  </div>
                  <div className="context-menu-item">
                    Where Used
                  </div>
                  <div className="context-menu-separator" />
                </>
              )}
              
              <div 
                className="context-menu-item danger"
                onClick={() => {
                  setDeleteConfirm(contextMenu.file)
                  setContextMenu(null)
                }}
              >
                <Trash2 size={14} />
                Delete
              </div>
              
              <div className="context-menu-separator" />
              
              <div 
                className={`context-menu-item ${undoStack.length === 0 ? 'disabled' : ''}`}
                onClick={() => {
                  if (undoStack.length > 0) {
                    handleUndo()
                  }
                  setContextMenu(null)
                }}
              >
                <Undo2 size={14} />
                Undo
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+Z</span>
              </div>
            </div>
          </>
        )
      })()}

      {/* Empty space context menu */}
      {emptyContextMenu && (
        <>
          <div 
            className="fixed inset-0 z-50" 
            onClick={() => setEmptyContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              // Allow right-click to reposition
              setEmptyContextMenu({ x: e.clientX, y: e.clientY })
            }}
          />
          <div 
            className="context-menu"
            style={{ left: emptyContextMenu.x, top: emptyContextMenu.y }}
          >
            <div 
              className="context-menu-item"
              onClick={startCreatingFolder}
            >
              <Folder size={14} />
              New Folder
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                handleAddFiles()
                setEmptyContextMenu(null)
              }}
            >
              <Upload size={14} />
              Add Files...
            </div>
            <div className="context-menu-separator" />
            <div 
              className="context-menu-item"
              onClick={() => {
                onRefresh()
                setEmptyContextMenu(null)
              }}
            >
              <RefreshCw size={14} />
              Refresh
            </div>
            <div className="context-menu-separator" />
            <div 
              className={`context-menu-item ${undoStack.length === 0 ? 'disabled' : ''}`}
              onClick={() => {
                if (undoStack.length > 0) {
                  handleUndo()
                }
                setEmptyContextMenu(null)
              }}
            >
              <Undo2 size={14} />
              Undo
              <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+Z</span>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <>
          <div 
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
            onClick={() => setDeleteConfirm(null)}
          >
            <div 
              className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-pdm-error/20 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-pdm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Delete {deleteConfirm.isDirectory ? 'Folder' : 'File'}?</h3>
                  <p className="text-sm text-pdm-fg-muted">This action will move the item to the Recycle Bin.</p>
                </div>
              </div>
              
              <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4">
                <div className="flex items-center gap-2">
                  {deleteConfirm.isDirectory ? (
                    <FolderOpen size={16} className="text-pdm-fg-muted" />
                  ) : (
                    <File size={16} className="text-pdm-fg-muted" />
                  )}
                  <span className="text-pdm-fg font-medium truncate">{deleteConfirm.name}</span>
                </div>
                {deleteConfirm.isDirectory && (
                  <p className="text-xs text-pdm-fg-muted mt-2">
                    All contents inside the folder will also be deleted.
                  </p>
                )}
              </div>
              
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="btn bg-pdm-error hover:bg-pdm-error/80 text-white"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
