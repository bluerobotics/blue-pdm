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
  AlertTriangle,
  Eye,
  EyeOff,
  GripVertical,
  Copy,
  Scissors,
  ClipboardPaste,
  ExternalLink,
  Star,
  Search,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen
} from 'lucide-react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { getFileIconType, formatFileSize, STATE_INFO } from '../types/pdm'
import { syncFile, checkoutFile, checkinFile } from '../lib/supabase'
import { format } from 'date-fns'

interface FileBrowserProps {
  onRefresh: (silent?: boolean) => void
}

export function FileBrowser({ onRefresh }: FileBrowserProps) {
  const {
    files,
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    selectAllFiles,
    clearSelection,
    columns,
    setColumnWidth,
    reorderColumns,
    toggleColumnVisibility,
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
    addToast,
    syncProgress,
    startSync,
    updateSyncProgress,
    endSync,
    vaultName,
    activeVaultId,
    connectedVaults,
    pinnedFolders,
    pinFolder,
    unpinFolder,
    renameFileInStore,
    searchQuery,
    searchType
  } = usePDMStore()
  
  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  const displayVaultName = vaultName || vaultPath?.split(/[/\\]/).pop() || 'Vault'

  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(null)
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<LocalFile | null>(null)
  const [customConfirm, setCustomConfirm] = useState<{
    title: string
    message: string
    warning?: string
    confirmText: string
    confirmDanger?: boolean
    onConfirm: () => void
  } | null>(null)
  const [undoStack, setUndoStack] = useState<Array<{ type: 'delete'; file: LocalFile; originalPath: string }>>([])
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<{ files: LocalFile[]; operation: 'copy' | 'cut' } | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Use store's currentFolder instead of local state
  const currentPath = currentFolder
  
  // Check if we're in search mode
  const isSearching = searchQuery && searchQuery.trim().length > 0

  // Get files in current folder (direct children only)
  // First filter out any invalid/undefined files
  const validFiles = files.filter(f => f && f.relativePath && f.name)
  
  // Fuzzy search helper - checks if query matches any part of the text
  const fuzzyMatch = (text: string | undefined | null, query: string): boolean => {
    if (!text) return false
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    
    // Simple fuzzy: check if all characters in query appear in order
    let queryIndex = 0
    for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
      if (lowerText[i] === lowerQuery[queryIndex]) {
        queryIndex++
      }
    }
    return queryIndex === lowerQuery.length
  }
  
  // Search score - higher = better match, prioritizes filename > description > other
  const getSearchScore = (file: LocalFile, query: string): number => {
    const q = query.toLowerCase().trim()
    let score = 0
    
    // Priority 1: Filename matches (highest scores)
    const nameLower = file.name.toLowerCase()
    if (nameLower === q) {
      score = 1000 // Exact match
    } else if (nameLower.startsWith(q)) {
      score = 900 // Starts with query
    } else if (nameLower.includes(q)) {
      score = 800 // Contains query
    } else if (fuzzyMatch(file.name, q)) {
      score = 700 // Fuzzy match on name
    }
    
    // Priority 2: Description matches
    if (file.pdmData?.description) {
      const descLower = file.pdmData.description.toLowerCase()
      if (descLower.includes(q)) {
        score = Math.max(score, 500)
      }
    }
    
    // Priority 3: Part number matches
    if (file.pdmData?.part_number?.toLowerCase().includes(q)) {
      score = Math.max(score, 400)
    }
    
    // Priority 4: Path matches
    if (file.relativePath.toLowerCase().includes(q)) {
      score = Math.max(score, 300)
    }
    
    // Priority 5: Other metadata matches
    if (file.pdmData) {
      if (file.pdmData.revision?.toLowerCase().includes(q)) score = Math.max(score, 200)
      if ((file.pdmData as any).material?.toLowerCase().includes(q)) score = Math.max(score, 200)
      if ((file.pdmData as any).vendor?.toLowerCase().includes(q)) score = Math.max(score, 200)
      if ((file.pdmData as any).project?.toLowerCase().includes(q)) score = Math.max(score, 200)
    }
    
    // Extension match (lowest priority)
    if (file.extension?.toLowerCase().includes(q)) {
      score = Math.max(score, 100)
    }
    
    return score
  }
  
  // Search across all metadata - returns true if any match
  const matchesSearch = (file: LocalFile, query: string): boolean => {
    return getSearchScore(file, query) > 0
  }
  
  const currentFolderFiles = isSearching 
    ? validFiles
        .filter(file => {
          // Filter by search type
          if (searchType === 'files' && file.isDirectory) return false
          if (searchType === 'folders' && !file.isDirectory) return false
          return matchesSearch(file, searchQuery)
        })
        .sort((a, b) => getSearchScore(b, searchQuery) - getSearchScore(a, searchQuery))
    : validFiles.filter(file => {
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

  // Sort: folders first, then by selected column (but preserve search relevance when searching)
  const sortedFiles = [...currentFolderFiles].filter(f => f && f.name).sort((a, b) => {
    // When searching, preserve the relevance order (already sorted by score)
    if (isSearching) {
      return 0 // Keep the order from search scoring
    }
    
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
        const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0
        const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0
        comparison = (isNaN(aTime) ? 0 : aTime) - (isNaN(bTime) ? 0 : bTime)
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

  // Check if any files in a folder are checked out
  const hasFolderCheckedOutFiles = (folderPath: string): boolean => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    return folderFiles.some(f => f.pdmData?.checked_out_by)
  }

  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      const hasCheckedOut = hasFolderCheckedOutFiles(file.relativePath)
      if (hasCheckedOut) {
        return <FolderOpen size={16} className="text-pdm-warning" />
      }
      const synced = isFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-pdm-success' : 'text-pdm-fg-muted'} />
    }
    
    const iconType = getFileIconType(file.extension)
    switch (iconType) {
      case 'part':
        return <FileBox size={16} className="text-pdm-accent" />
      case 'assembly':
        return <Layers size={16} className="text-amber-400" />
      case 'drawing':
        return <FilePen size={16} className="text-sky-300" />
      case 'step':
        return <FileBox size={16} className="text-orange-400" />
      case 'pdf':
        return <FileType size={16} className="text-red-400" />
      case 'image':
        return <FileImage size={16} className="text-purple-400" />
      case 'spreadsheet':
        return <FileSpreadsheet size={16} className="text-green-400" />
      case 'archive':
        return <FileArchive size={16} className="text-yellow-500" />
      case 'schematic':
        return <Cpu size={16} className="text-red-400" />
      case 'library':
        return <Cpu size={16} className="text-violet-400" />
      case 'pcb':
        return <Cpu size={16} className="text-emerald-400" />
      case 'code':
        return <FileCode size={16} className="text-sky-400" />
      case 'text':
        return <FileText size={16} className="text-pdm-fg-muted" />
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

  // Column drag handlers
  const handleColumnDragStart = (e: React.DragEvent, columnId: string) => {
    setDraggingColumn(columnId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', columnId)
  }

  const handleColumnDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    if (draggingColumn && draggingColumn !== columnId) {
      setDragOverColumn(columnId)
    }
  }

  const handleColumnDragLeave = () => {
    setDragOverColumn(null)
  }

  const handleColumnDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    if (!draggingColumn || draggingColumn === targetColumnId) {
      setDraggingColumn(null)
      setDragOverColumn(null)
      return
    }

    // Reorder columns
    const newColumns = [...columns]
    const dragIndex = newColumns.findIndex(c => c.id === draggingColumn)
    const dropIndex = newColumns.findIndex(c => c.id === targetColumnId)
    
    if (dragIndex !== -1 && dropIndex !== -1) {
      const [removed] = newColumns.splice(dragIndex, 1)
      newColumns.splice(dropIndex, 0, removed)
      reorderColumns(newColumns)
    }

    setDraggingColumn(null)
    setDragOverColumn(null)
  }

  const handleColumnDragEnd = () => {
    setDraggingColumn(null)
    setDragOverColumn(null)
  }

  const handleColumnHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setColumnContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleContextMenu = (e: React.MouseEvent, file: LocalFile) => {
    e.preventDefault()
    e.stopPropagation()
    setEmptyContextMenu(null)
    
    // If right-clicking on a file that's already selected, use all selected files
    // Otherwise, select only the right-clicked file
    if (!selectedFiles.includes(file.path)) {
      setSelectedFiles([file.path])
    }
    
    // Move context menu to new position (works even if already open)
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }
  
  // Get the files that the context menu should operate on
  const getContextMenuFiles = (): LocalFile[] => {
    if (!contextMenu) return []
    
    // If the right-clicked file is in selection, return all selected files
    if (selectedFiles.includes(contextMenu.file.path)) {
      return sortedFiles.filter(f => selectedFiles.includes(f.path))
    }
    
    // Otherwise just the right-clicked file
    return [contextMenu.file]
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
        // Update file in store directly instead of full refresh
        renameFileInStore(renamingFile.path, newPath, newName)
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
    const syncedFiles = folderFiles.filter(f => f.pdmData?.id)
    
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check out in this folder')
      return
    }

    let succeeded = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < syncedFiles.length; i++) {
      const file = syncedFiles[i]
      setStatusMessage(`Checking out ${i + 1}/${syncedFiles.length}: ${file.name}`)
      
      const result = await checkoutFile(file.pdmData!.id, user.id)
      if (result.success) {
        // Make file writable for editing
        await window.electronAPI?.setReadonly(file.path, false)
        succeeded++
      } else {
        failed++
        errors.push(`${file.name}: ${result.error}`)
      }
    }

    setStatusMessage('')
    
    if (failed > 0) {
      addToast('warning', `Checked out ${succeeded}/${syncedFiles.length} files. ${failed} failed.`)
      if (errors.length <= 3) {
        errors.forEach(e => addToast('error', e, 6000))
      }
    } else {
      addToast('success', `Checked out ${succeeded} files in "${folder.name}"`)
    }
    
    onRefresh(true) // Silent refresh after checkout
  }

  // Check in a folder (all synced files, uploading any changes)
  const handleCheckinFolder = async (folder: LocalFile) => {
    if (!user || !organization) {
      addToast('error', 'Please sign in first')
      return
    }

    const folderFiles = getFilesInFolder(folder.relativePath)
    // Get files that are synced
    const syncedFiles = folderFiles.filter(f => f.pdmData?.id)
    
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check in')
      return
    }

    let succeeded = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < syncedFiles.length; i++) {
      const file = syncedFiles[i]
      setStatusMessage(`Checking in ${i + 1}/${syncedFiles.length}: ${file.name}`)
      
      try {
        // Read file to get current hash
        const readResult = await window.electronAPI?.readFile(file.path)
        
        if (readResult?.success && readResult.data && readResult.hash) {
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newContentHash: readResult.hash,
            newFileSize: file.size,
            incrementVersion: true
          })
          
          if (result.success) {
            // Set file back to read-only after checkin
            await window.electronAPI?.setReadonly(file.path, true)
            succeeded++
          } else {
            // If error is "not checked out", that's ok for folder checkin
            if (result.error?.includes('not have this file checked out')) {
              succeeded++ // Count as success - file just wasn't checked out
            } else {
              failed++
              errors.push(`${file.name}: ${result.error}`)
            }
          }
        } else {
          // Just release checkout
          const result = await checkinFile(file.pdmData!.id, user.id)
          if (result.success) {
            // Set file back to read-only after checkin
            await window.electronAPI?.setReadonly(file.path, true)
            succeeded++
          } else if (result.error?.includes('not have this file checked out')) {
            succeeded++
          } else {
            failed++
            errors.push(`${file.name}: ${result.error || 'Failed to read'}`)
          }
        }
      } catch (err) {
        failed++
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setStatusMessage('')
    
    if (failed > 0) {
      addToast('warning', `Checked in ${succeeded}/${syncedFiles.length} files. ${failed} failed.`)
      if (errors.length <= 3) {
        errors.forEach(e => addToast('error', e, 6000))
      }
    } else {
      addToast('success', `Checked in ${succeeded} files in "${folder.name}"`)
    }
    
    onRefresh(true) // Silent refresh after checkin
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

  // Copy files
  const handleCopy = () => {
    const selectedFileObjects = files.filter(f => selectedFiles.includes(f.path))
    if (selectedFileObjects.length > 0) {
      setClipboard({ files: selectedFileObjects, operation: 'copy' })
      addToast('info', `Copied ${selectedFileObjects.length} item${selectedFileObjects.length > 1 ? 's' : ''}`)
    }
  }

  // Cut files
  const handleCut = () => {
    const selectedFileObjects = files.filter(f => selectedFiles.includes(f.path))
    if (selectedFileObjects.length > 0) {
      setClipboard({ files: selectedFileObjects, operation: 'cut' })
      addToast('info', `Cut ${selectedFileObjects.length} item${selectedFileObjects.length > 1 ? 's' : ''}`)
    }
  }

  // Generate unique filename if file already exists
  const getUniqueDestPath = async (basePath: string, fileName: string): Promise<string> => {
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
    const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
    
    let destPath = `${basePath}\\${fileName}`
    let counter = 1
    
    // Check if file exists
    while (await window.electronAPI?.fileExists(destPath)) {
      destPath = `${basePath}\\${nameWithoutExt} (${counter})${ext}`
      counter++
      if (counter > 100) break // Safety limit
    }
    
    return destPath
  }

  // Paste files
  const handlePaste = async () => {
    if (!clipboard || !vaultPath || !window.electronAPI) {
      addToast('info', 'Nothing to paste')
      return
    }

    const destFolder = currentPath 
      ? `${vaultPath}\\${currentPath.replace(/\//g, '\\')}`
      : vaultPath

    let succeeded = 0
    let failed = 0
    let skipped = 0

    setStatusMessage(`Pasting ${clipboard.files.length} item${clipboard.files.length > 1 ? 's' : ''}...`)

    for (const file of clipboard.files) {
      try {
        // Get parent folder of source file
        const sourceFolder = file.path.substring(0, file.path.lastIndexOf('\\'))
        
        if (clipboard.operation === 'cut') {
          // For cut: skip if pasting to same folder
          if (sourceFolder.toLowerCase() === destFolder.toLowerCase()) {
            skipped++
            continue
          }
          
          const destPath = `${destFolder}\\${file.name}`
          const result = await window.electronAPI.renameItem(file.path, destPath)
          if (result.success) succeeded++
          else failed++
        } else {
          // For copy: generate unique name if needed
          const destPath = await getUniqueDestPath(destFolder, file.name)
          const result = await window.electronAPI.copyFile(file.path, destPath)
          if (result.success) succeeded++
          else failed++
        }
      } catch (err) {
        failed++
        console.error('Paste error:', err)
      }
    }

    setStatusMessage('')

    if (skipped > 0 && succeeded === 0 && failed === 0) {
      addToast('info', 'Files already in this folder')
    } else if (failed > 0) {
      addToast('warning', `Pasted ${succeeded}, failed ${failed}${skipped > 0 ? `, skipped ${skipped}` : ''}`)
    } else {
      addToast('success', `Pasted ${succeeded} item${succeeded > 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped)` : ''}`)
    }

    // Clear clipboard after cut
    if (clipboard.operation === 'cut') {
      setClipboard(null)
    }

    onRefresh()
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Ctrl+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
      // Ctrl+C for copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        handleCopy()
      }
      // Ctrl+X for cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault()
        handleCut()
      }
      // Ctrl+V for paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        handlePaste()
      }
      // Ctrl+A for select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedFiles(sortedFiles.map(f => f.path))
      }
      // Delete key
      if (e.key === 'Delete' && selectedFiles.length > 0) {
        const selectedFile = files.find(f => f.path === selectedFiles[0])
        if (selectedFile) {
          setDeleteConfirm(selectedFile)
        }
      }
      // Escape to clear selection
      if (e.key === 'Escape') {
        clearSelection()
        setClipboard(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undoStack, selectedFiles, files, clipboard, sortedFiles, currentPath, vaultPath])

  const handleRowClick = (e: React.MouseEvent, file: LocalFile, index: number) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangePaths = sortedFiles.slice(start, end + 1).map(f => f.path)
      
      if (e.ctrlKey || e.metaKey) {
        // Add range to existing selection
        const newSelection = [...new Set([...selectedFiles, ...rangePaths])]
        setSelectedFiles(newSelection)
      } else {
        // Replace selection with range
        setSelectedFiles(rangePaths)
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle single item
      toggleFileSelection(file.path, true)
      setLastClickedIndex(index)
    } else {
      // Normal click: select single item
      setSelectedFiles([file.path])
      setLastClickedIndex(index)
    }
  }

  const handleRowDoubleClick = (file: LocalFile) => {
    if (file.isDirectory) {
      // Navigate into folder - allow even for cloud-only folders
      navigateToFolder(file.relativePath)
    } else if (file.diffStatus === 'cloud') {
      // Cloud-only files can't be opened (not downloaded yet)
      addToast('info', 'This file is not downloaded. Right-click to download.')
    } else if (window.electronAPI) {
      // Open file
      window.electronAPI.openFile(file.path)
    }
  }

  // Handle drag start - set file paths as text for basic drag support
  // Note: Native file drag-out is disabled due to Electron stability issues on Windows
  // Use "Show in Explorer" or copy the file path instead
  const handleDragStart = (e: React.DragEvent, file: LocalFile) => {
    // Get all selected files if the dragged file is part of selection
    let filesToDrag: string[]
    
    if (selectedFiles.includes(file.path) && selectedFiles.length > 1) {
      filesToDrag = selectedFiles
    } else {
      filesToDrag = [file.path]
    }
    
    // Set file paths as text (can be pasted in other apps)
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', filesToDrag.join('\n'))
    e.dataTransfer.setData('text/uri-list', filesToDrag.map(p => `file:///${p.replace(/\\/g, '/')}`).join('\n'))
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
        // Use relativePath if available (preserves folder structure), otherwise just the filename
        const targetPath = (file as any).relativePath || file.name
        const destPath = `${vaultPath}\\${targetPath.replace(/\//g, '\\')}`
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
        
        const fileStatusColumnVisible = columns.find(c => c.id === 'fileStatus')?.visible
        
        return (
          <div className="flex items-center gap-2">
            {getFileIcon(file)}
            <span className="truncate flex-1">{file.name}</span>
            {!file.isDirectory && !fileStatusColumnVisible && (
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
        const cloudVersion = file.pdmData?.version || null
        if (!cloudVersion) {
          // Not synced yet
          return <span className="text-pdm-fg-muted">-/-</span>
        }
        
        if (file.diffStatus === 'modified') {
          // Local changes - local version is effectively cloud+1
          return (
            <span className="text-pdm-warning" title={`Local changes (will be version ${cloudVersion + 1})`}>
              {cloudVersion + 1}/{cloudVersion}
            </span>
          )
        } else if (file.diffStatus === 'outdated') {
          // Cloud has newer version - local is behind
          const localVer = cloudVersion - 1 // Simplified assumption
          return (
            <span className="text-purple-400" title="Newer version available on cloud">
              {localVer > 0 ? localVer : '?'}/{cloudVersion}
            </span>
          )
        }
        // In sync
        return <span>{cloudVersion}/{cloudVersion}</span>
      case 'itemNumber':
        return file.pdmData?.part_number || ''
      case 'description':
        return file.pdmData?.description || ''
      case 'fileStatus':
        if (file.isDirectory) return ''
        
        if (file.diffStatus === 'cloud') {
          // Cloud only (not downloaded)
          return (
            <span className="flex items-center gap-1 text-pdm-fg-muted">
              <Cloud size={12} />
              Cloud
            </span>
          )
        }
        
        if (!file.pdmData) {
          // Not synced
          return (
            <span className="flex items-center gap-1 text-pdm-fg-muted">
              <HardDrive size={12} />
              Local
            </span>
          )
        }
        
        if (file.pdmData.checked_out_by) {
          // Checked out
          const isMe = user?.id === file.pdmData.checked_out_by
          return (
            <span className={`flex items-center gap-1 ${isMe ? 'text-pdm-warning' : 'text-pdm-error'}`}>
              <Lock size={12} />
              Checked Out
            </span>
          )
        }
        
        // Synced but not checked out
        return (
          <span className="flex items-center gap-1 text-pdm-success">
            <Cloud size={12} />
            Checked In
          </span>
        )
      case 'checkedOutBy':
        if (file.isDirectory || !file.pdmData?.checked_out_by) return ''
        
        const checkedOutUser = (file.pdmData as any).checked_out_user
        const avatarUrl = checkedOutUser?.avatar_url
        const displayName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Unknown'
        const isMe = user?.id === file.pdmData.checked_out_by
        
        return (
          <span className={`flex items-center gap-2 ${isMe ? 'text-pdm-warning' : 'text-pdm-fg'}`}>
            {avatarUrl ? (
              <img 
                src={avatarUrl} 
                alt={displayName}
                className="w-5 h-5 rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-pdm-accent/30 flex items-center justify-center text-xs">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="truncate">{displayName}</span>
          </span>
        )
      case 'extension':
        return file.extension ? file.extension.replace('.', '').toUpperCase() : ''
      case 'size':
        return file.isDirectory ? '' : formatFileSize(file.size)
      case 'modifiedTime':
        if (!file.modifiedTime) return '-'
        try {
          const date = new Date(file.modifiedTime)
          if (isNaN(date.getTime())) return '-'
          return format(date, 'MMM d, yyyy HH:mm')
        } catch {
          return '-'
        }
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

        {/* Breadcrumb / Search indicator */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
          {isSearching ? (
            <div className="flex items-center gap-2 text-pdm-fg-dim">
              <Search size={14} className="text-pdm-accent" />
              <span>
                {searchType === 'files' ? 'Files' : searchType === 'folders' ? 'Folders' : 'Results'} for "<span className="text-pdm-fg font-medium">{searchQuery}</span>"
              </span>
              <span className="text-pdm-fg-muted">({sortedFiles.length} matches)</span>
            </div>
          ) : (
            <>
              <button
                onClick={navigateToRoot}
                className="flex items-center gap-1.5 text-pdm-fg-dim hover:text-pdm-fg transition-colors px-1"
                title="Go to vault root"
              >
                <Home size={14} />
                <span>{displayVaultName}</span>
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
            </>
          )}
        </div>
        
        {/* Path actions */}
        <div className="flex items-center gap-1 border-l border-pdm-border pl-2">
          <button
            onClick={() => {
              const fullPath = currentPath 
                ? `${vaultPath}\\${currentPath.replace(/\//g, '\\')}`
                : vaultPath || ''
              navigator.clipboard.writeText(fullPath)
              addToast('success', 'Path copied to clipboard')
            }}
            className="btn btn-ghost btn-sm p-1"
            title="Copy current path"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => {
              if (window.electronAPI && vaultPath) {
                const fullPath = currentPath 
                  ? `${vaultPath}\\${currentPath.replace(/\//g, '\\')}`
                  : vaultPath
                window.electronAPI.openInExplorer(fullPath)
              }
            }}
            className="btn btn-ghost btn-sm p-1"
            title="Open in Explorer"
          >
            <ExternalLink size={14} />
          </button>
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
        className="flex-1 overflow-auto relative"
        onContextMenu={handleEmptyContextMenu}
        onMouseDown={(e) => {
          // Only start selection box on left click in empty area
          if (e.button !== 0) return
          const target = e.target as HTMLElement
          if (target.closest('tr') || target.closest('th')) return
          
          const rect = tableRef.current?.getBoundingClientRect()
          if (!rect) return
          
          const startX = e.clientX - rect.left + (tableRef.current?.scrollLeft || 0)
          const startY = e.clientY - rect.top + (tableRef.current?.scrollTop || 0)
          
          setSelectionBox({ startX, startY, currentX: startX, currentY: startY })
          
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            clearSelection()
          }
        }}
        onMouseMove={(e) => {
          if (!selectionBox) return
          
          const rect = tableRef.current?.getBoundingClientRect()
          if (!rect) return
          
          const currentX = e.clientX - rect.left + (tableRef.current?.scrollLeft || 0)
          const currentY = e.clientY - rect.top + (tableRef.current?.scrollTop || 0)
          
          setSelectionBox(prev => prev ? { ...prev, currentX, currentY } : null)
          
          // Calculate selection box bounds
          const left = Math.min(selectionBox.startX, currentX)
          const right = Math.max(selectionBox.startX, currentX)
          const top = Math.min(selectionBox.startY, currentY)
          const bottom = Math.max(selectionBox.startY, currentY)
          
          // Find rows that intersect with selection box
          const rows = tableRef.current?.querySelectorAll('tbody tr')
          const selectedPaths: string[] = []
          
          rows?.forEach((row, index) => {
            const rowRect = row.getBoundingClientRect()
            const tableRect = tableRef.current?.getBoundingClientRect()
            if (!tableRect) return
            
            const rowTop = rowRect.top - tableRect.top + (tableRef.current?.scrollTop || 0)
            const rowBottom = rowTop + rowRect.height
            
            // Check if row intersects with selection box
            if (rowBottom > top && rowTop < bottom) {
              const file = sortedFiles[index]
              if (file) {
                selectedPaths.push(file.path)
              }
            }
          })
          
          setSelectedFiles(selectedPaths)
        }}
        onMouseUp={() => {
          setSelectionBox(null)
        }}
        onMouseLeave={() => {
          if (selectionBox) {
            setSelectionBox(null)
          }
        }}
      >
        {/* Selection box overlay */}
        {selectionBox && (
          <div
            className="absolute border border-pdm-accent bg-pdm-accent/10 pointer-events-none z-10"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
            }}
          />
        )}
        
        <table className={`file-table ${selectionBox ? 'selecting' : ''}`}>
          <thead>
            <tr>
              {visibleColumns.map(column => (
                <th
                  key={column.id}
                  style={{ width: column.width }}
                  className={`${column.sortable ? 'sortable' : ''} ${draggingColumn === column.id ? 'dragging' : ''} ${dragOverColumn === column.id ? 'drag-over' : ''}`}
                  onClick={() => column.sortable && toggleSort(column.id)}
                  onContextMenu={handleColumnHeaderContextMenu}
                  onDragOver={(e) => handleColumnDragOver(e, column.id)}
                  onDragLeave={handleColumnDragLeave}
                  onDrop={(e) => handleColumnDrop(e, column.id)}
                  onDragEnd={handleColumnDragEnd}
                >
                  <div className="flex items-center gap-1">
                    <span
                      draggable
                      onDragStart={(e) => handleColumnDragStart(e, column.id)}
                      className="cursor-grab active:cursor-grabbing"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical size={12} className="text-pdm-fg-muted opacity-50" />
                    </span>
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
            {sortedFiles.map((file, index) => {
              const diffClass = file.diffStatus === 'added' ? 'diff-added' 
                : file.diffStatus === 'modified' ? 'diff-modified'
                : file.diffStatus === 'deleted' ? 'diff-deleted'
                : file.diffStatus === 'outdated' ? 'diff-outdated'
                : file.diffStatus === 'cloud' ? 'diff-cloud' : ''
              
              return (
              <tr
                key={file.path}
                className={`${selectedFiles.includes(file.path) ? 'selected' : ''} ${diffClass}`}
                onClick={(e) => handleRowClick(e, file, index)}
                onDoubleClick={() => handleRowDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                draggable={!selectionBox}
                onDragStart={(e) => {
                  if (selectionBox) {
                    e.preventDefault()
                    return
                  }
                  handleDragStart(e, file)
                }}
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
          <div className="absolute inset-0 z-30 bg-pdm-bg/80 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-pdm-accent/30 border-t-pdm-accent rounded-full animate-spin" />
              <span className="text-sm text-pdm-fg-muted">Loading files...</span>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
        const contextFiles = getContextMenuFiles()
        const multiSelect = contextFiles.length > 1
        const firstFile = contextFiles[0]
        const isSynced = contextFiles.every(f => !!f.pdmData)
        
        // Check for synced content - either direct files or files inside selected folders
        const hasSyncedContent = () => {
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Check if folder contains any synced files
              const folderPrefix = item.relativePath + '/'
              const hasSyncedInFolder = files.some(f => 
                !f.isDirectory && 
                f.pdmData &&
                f.diffStatus !== 'cloud' && // Must be downloaded, not cloud-only
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              if (hasSyncedInFolder) return true
            } else if (item.pdmData && item.diffStatus !== 'cloud') {
              return true
            }
          }
          return false
        }
        const anySynced = hasSyncedContent()
        
        // Check for unsynced content - either direct files or files inside selected folders
        const hasUnsyncedContent = () => {
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Check if folder contains any unsynced files
              const folderPrefix = item.relativePath + '/'
              const hasUnsyncedInFolder = files.some(f => 
                !f.isDirectory && 
                !f.pdmData &&
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              if (hasUnsyncedInFolder) return true
            } else if (!item.pdmData) {
              return true
            }
          }
          return false
        }
        const anyUnsynced = hasUnsyncedContent()
        
        const isFolder = firstFile.isDirectory
        const allFolders = contextFiles.every(f => f.isDirectory)
        const allFiles = contextFiles.every(f => !f.isDirectory)
        const fileCount = contextFiles.filter(f => !f.isDirectory).length
        const folderCount = contextFiles.filter(f => f.isDirectory).length
        
        // Get all synced files - either directly selected or inside selected folders
        const getSyncedFilesInSelection = (): LocalFile[] => {
          const result: LocalFile[] = []
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Get files inside folder
              const folderPrefix = item.relativePath + '/'
              const filesInFolder = files.filter(f => 
                !f.isDirectory && 
                f.pdmData &&
                f.diffStatus !== 'cloud' &&
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              result.push(...filesInFolder)
            } else if (item.pdmData && item.diffStatus !== 'cloud') {
              result.push(item)
            }
          }
          return result
        }
        const syncedFilesInSelection = getSyncedFilesInSelection()
        
        // Check out/in status - consider all synced files including those inside folders
        const allCheckedOut = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by)
        const allCheckedIn = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => !f.pdmData?.checked_out_by)
        const anyCheckedOut = syncedFilesInSelection.some(f => f.pdmData?.checked_out_by)
        const anyCheckedIn = syncedFilesInSelection.some(f => !f.pdmData?.checked_out_by)
        
        // Count files that can be checked out/in (for folder labels)
        const checkoutableCount = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by).length
        const checkinableCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user?.id).length
        
        const countLabel = multiSelect 
          ? `(${fileCount > 0 ? `${fileCount} file${fileCount > 1 ? 's' : ''}` : ''}${fileCount > 0 && folderCount > 0 ? ', ' : ''}${folderCount > 0 ? `${folderCount} folder${folderCount > 1 ? 's' : ''}` : ''})`
          : ''
        
        // Check if any files are cloud-only (exist on server but not locally)
        const allCloudOnly = contextFiles.every(f => f.diffStatus === 'cloud')
        
        // Count cloud-only files (for download count) - includes files inside folders
        const getCloudOnlyFilesCount = (): number => {
          let count = 0
          for (const item of contextFiles) {
            if (item.isDirectory) {
              const folderPrefix = item.relativePath + '/'
              count += files.filter(f => 
                !f.isDirectory && 
                f.diffStatus === 'cloud' &&
                f.relativePath.startsWith(folderPrefix)
              ).length
            } else if (item.diffStatus === 'cloud') {
              count++
            }
          }
          return count
        }
        const cloudOnlyCount = getCloudOnlyFilesCount()
        const anyCloudOnly = cloudOnlyCount > 0 || contextFiles.some(f => f.diffStatus === 'cloud')
        
        // Check for locally synced files (can be unsynced)
        const anyLocalSynced = contextFiles.some(f => f.pdmData && f.diffStatus !== 'cloud' && f.diffStatus !== 'added')
        
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
              {!multiSelect && !isFolder && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    window.electronAPI?.openFile(firstFile.path)
                    setContextMenu(null)
                  }}
                >
                  Open
                </div>
              )}
              {multiSelect && allFiles && (
                <div 
                  className="context-menu-item"
                  onClick={async () => {
                    for (const file of contextFiles) {
                      window.electronAPI?.openFile(file.path)
                    }
                    setContextMenu(null)
                  }}
                >
                  Open All {countLabel}
                </div>
              )}
              {!multiSelect && isFolder && !allCloudOnly && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    navigateToFolder(firstFile.relativePath)
                    setContextMenu(null)
                  }}
                >
                  Open Folder
                </div>
              )}
              
              {/* Options for cloud-only items (exist on server but not downloaded locally) */}
              {anyCloudOnly && (
                <>
                  <div className="context-menu-separator" />
                  <div 
                    className="context-menu-item text-pdm-success"
                    onClick={async () => {
                      setContextMenu(null)
                      
                      // Collect all cloud-only files to download
                      // For folders, get all cloud-only files inside them recursively
                      const filesToDownload: LocalFile[] = []
                      
                      for (const item of contextFiles) {
                        if (item.isDirectory) {
                          // Get all cloud-only files inside this folder
                          const folderPath = item.relativePath.replace(/\\/g, '/')
                          const filesInFolder = files.filter(f => {
                            if (f.isDirectory) return false
                            if (f.diffStatus !== 'cloud') return false
                            const filePath = f.relativePath.replace(/\\/g, '/')
                            return filePath.startsWith(folderPath + '/')
                          })
                          filesToDownload.push(...filesInFolder)
                        } else if (item.diffStatus === 'cloud') {
                          filesToDownload.push(item)
                        }
                      }
                      
                      // Remove duplicates
                      const uniqueFiles = [...new Map(filesToDownload.map(f => [f.path, f])).values()]
                      
                      if (uniqueFiles.length === 0) {
                        addToast('warning', 'No files to download')
                        return
                      }
                      
                      const total = uniqueFiles.length
                      const totalBytes = uniqueFiles.reduce((sum, f) => sum + (f.pdmData?.file_size || 0), 0)
                      let downloadedBytes = 0
                      let downloaded = 0
                      let failed = 0
                      let wasCancelled = false
                      const startTime = Date.now()
                      
                      const formatSpeed = (bytesPerSec: number) => {
                        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
                        return `${bytesPerSec.toFixed(0)} B/s`
                      }
                      
                      // Start progress tracking
                      startSync(total, 'download')
                      
                      const downloadOneFile = async (file: LocalFile): Promise<boolean> => {
                        if (!file.pdmData?.content_hash || !organization) return false
                        
                        try {
                          const { downloadFile } = await import('../lib/storage')
                          const { data: content, error } = await downloadFile(organization.id, file.pdmData.content_hash)
                          
                          if (error) {
                            console.error('Download error for', file.name, ':', error)
                            return false
                          }
                          
                          if (content) {
                            // Ensure parent directory exists
                            const parentDir = file.path.substring(0, file.path.lastIndexOf('\\'))
                            await window.electronAPI?.createFolder(parentDir)
                            
                            // Convert Blob to base64 for IPC transfer
                            const arrayBuffer = await content.arrayBuffer()
                            const base64 = btoa(
                              new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                            )
                            
                            // Write file
                            await window.electronAPI?.writeFile(file.path, base64)
                            return true
                          }
                        } catch (err) {
                          console.error('Failed to download file:', file.name, err)
                        }
                        return false
                      }
                      
                      // Process files with high concurrency for speed
                      const CONCURRENCY = 20
                      console.log(`[Download] Starting parallel download of ${total} files with concurrency ${CONCURRENCY}`)
                      for (let i = 0; i < uniqueFiles.length; i += CONCURRENCY) {
                        // Check for cancellation
                        if (usePDMStore.getState().syncProgress.cancelRequested) {
                          wasCancelled = true
                          break
                        }
                        
                        const batch = uniqueFiles.slice(i, i + CONCURRENCY)
                        
                        // Update progress before batch
                        const elapsed = (Date.now() - startTime) / 1000
                        const speed = elapsed > 0 ? downloadedBytes / elapsed : 0
                        const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : Math.round(((downloaded + failed) / total) * 100)
                        updateSyncProgress(downloaded + failed, percent, formatSpeed(speed))
                        
                        const batchStart = Date.now()
                        const results = await Promise.all(batch.map(f => downloadOneFile(f)))
                        const batchTime = Date.now() - batchStart
                        
                        let batchBytes = 0
                        for (let j = 0; j < results.length; j++) {
                          if (results[j]) {
                            downloaded++
                            const fileSize = batch[j].pdmData?.file_size || 0
                            downloadedBytes += fileSize
                            batchBytes += fileSize
                          } else {
                            failed++
                          }
                        }
                        console.log(`[Download] Batch ${Math.floor(i/CONCURRENCY)+1}: ${batch.length} files, ${(batchBytes/1024/1024).toFixed(2)}MB in ${batchTime}ms`)
                      }
                      
                      // End progress
                      endSync()
                      
                      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
                      const avgSpeed = formatSpeed(downloadedBytes / parseFloat(totalTime))
                      
                      if (wasCancelled) {
                        addToast('warning', `Download cancelled. ${downloaded} files downloaded.`)
                      } else if (downloaded > 0) {
                        addToast('success', `Downloaded ${downloaded} file${downloaded > 1 ? 's' : ''} in ${totalTime}s (${avgSpeed})`)
                      } else {
                        addToast('error', 'Failed to download files')
                      }
                      
                      if (downloaded > 0) {
                        onRefresh(true) // Silent refresh after download
                      }
                    }}
                  >
                    <ArrowDown size={14} className="text-pdm-success" />
                    Download {cloudOnlyCount > 0 ? `${cloudOnlyCount} files` : (multiSelect ? countLabel : '')}
                  </div>
                </>
              )}
              
              {/* Unsync moved to be with delete options below */}
              
              {!allCloudOnly && (
                <>
                  <div 
                    className="context-menu-item"
                    onClick={() => {
                      window.electronAPI?.openInExplorer(firstFile.path)
                      setContextMenu(null)
                    }}
                  >
                    Show in Explorer
                  </div>
                  
                  <div 
                    className="context-menu-item"
                    onClick={async () => {
                      const paths = contextFiles.map(f => f.path).join('\n')
                      await navigator.clipboard.writeText(paths)
                      addToast('success', `Copied ${contextFiles.length > 1 ? contextFiles.length + ' paths' : 'path'} to clipboard`)
                      setContextMenu(null)
                    }}
                  >
                    <Copy size={14} />
                    Copy Path{multiSelect ? 's' : ''}
                  </div>
                </>
              )}
              
              {/* Pin/Unpin */}
              {!multiSelect && activeVaultId && (
                (() => {
                  const isPinned = pinnedFolders.some(p => p.path === firstFile.relativePath && p.vaultId === activeVaultId)
                  const currentVault = connectedVaults.find(v => v.id === activeVaultId)
                  return (
                    <div 
                      className="context-menu-item"
                      onClick={() => {
                        if (isPinned) {
                          unpinFolder(firstFile.relativePath)
                          addToast('info', `Unpinned ${firstFile.name}`)
                        } else {
                          pinFolder(firstFile.relativePath, activeVaultId, currentVault?.name || 'Vault', firstFile.isDirectory)
                          addToast('success', `Pinned ${firstFile.name}`)
                        }
                        setContextMenu(null)
                      }}
                    >
                      <Star size={14} className={isPinned ? 'fill-pdm-warning text-pdm-warning' : ''} />
                      {isPinned ? 'Unpin' : `Pin ${isFolder ? 'Folder' : 'File'}`}
                    </div>
                  )
                })()
              )}
              
              {!multiSelect && !allCloudOnly && (
                (() => {
                  // Synced files require checkout to rename
                  const isSynced = !!firstFile.pdmData
                  const isCheckedOutByMe = firstFile.pdmData?.checked_out_by === user?.id
                  const canRename = !isSynced || isCheckedOutByMe
                  
                  return (
                    <div 
                      className={`context-menu-item ${!canRename ? 'disabled' : ''}`}
                      onClick={() => {
                        if (canRename) {
                          startRenaming(firstFile)
                        }
                      }}
                      title={!canRename ? 'Check out file first to rename' : ''}
                    >
                      <Pencil size={14} />
                      Rename
                      {!canRename && <span className="text-xs text-pdm-fg-muted ml-auto">(checkout required)</span>}
                    </div>
                  )
                })()
              )}
              
              <div className="context-menu-separator" />
              
              <div 
                className="context-menu-item"
                onClick={() => {
                  handleCopy()
                  setContextMenu(null)
                }}
              >
                <Copy size={14} />
                Copy
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+C</span>
              </div>
              <div 
                className="context-menu-item"
                onClick={() => {
                  handleCut()
                  setContextMenu(null)
                }}
              >
                <Scissors size={14} />
                Cut
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+X</span>
              </div>
              <div 
                className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
                onClick={() => {
                  if (clipboard) {
                    handlePaste()
                  }
                  setContextMenu(null)
                }}
              >
                <ClipboardPaste size={14} />
                Paste
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+V</span>
              </div>
              
              <div className="context-menu-separator" />
              
              {/* First Check In - only for unsynced items when no synced content */}
              {anyUnsynced && !anySynced && (
                <div 
                  className="context-menu-item"
                  onClick={async () => {
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
                    
                    // Collect all unsynced files from selection (including files in selected folders)
                    let unsyncedFiles: LocalFile[] = []
                    
                    for (const item of contextFiles) {
                      if (item.isDirectory) {
                        // Get all files in this folder and subfolders
                        const folderPrefix = item.relativePath + '/'
                        const folderFiles = files.filter(f => 
                          !f.isDirectory && 
                          !f.pdmData &&
                          (f.relativePath.startsWith(folderPrefix) || 
                           f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
                        )
                        unsyncedFiles.push(...folderFiles)
                      } else if (!item.pdmData) {
                        // Single unsynced file
                        unsyncedFiles.push(item)
                      }
                    }
                    
                    // Remove duplicates (in case folders overlap)
                    unsyncedFiles = unsyncedFiles.filter((f, i, arr) => 
                      arr.findIndex(x => x.path === f.path) === i
                    )
                    
                    if (unsyncedFiles.length === 0) {
                      addToast('info', 'All files already synced')
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
                    const syncedFileIds: string[] = [] // Track synced file IDs for potential rollback
                    let wasCancelled = false
                    
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
                    
                    // Start sync progress tracking
                    startSync(total)
                    
                    // Parallel upload with concurrency limit
                    const CONCURRENCY = 8
                    
                    const syncOneFile = async (f: LocalFile): Promise<{ success: boolean; size: number; error?: string; fileId?: string }> => {
                      try {
                        const readResult = await window.electronAPI?.readFile(f.path)
                        if (!readResult?.success || !readResult.data || !readResult.hash) {
                          return { success: false, size: 0, error: `${f.name}: Failed to read` }
                        }
                        
                        const { error, file: syncedFile } = await syncFile(
                          organization.id,
                          currentVaultId!,
                          user.id,
                          f.relativePath,
                          f.name,
                          f.extension,
                          f.size,
                          readResult.hash,
                          readResult.data
                        )
                        
                        if (error) {
                          const errMsg = typeof error === 'object' && 'message' in error 
                            ? (error as {message: string}).message 
                            : String(error)
                          return { success: false, size: 0, error: `${f.name}: ${errMsg}` }
                        }
                        
                        return { success: true, size: f.size, fileId: syncedFile?.id }
                      } catch (err) {
                        return { success: false, size: 0, error: `${f.name}: ${err instanceof Error ? err.message : String(err)}` }
                      }
                    }
                    
                    // Process in batches with cancellation support
                    for (let i = 0; i < unsyncedFiles.length; i += CONCURRENCY) {
                      // Check for cancellation before starting new batch
                      const currentState = usePDMStore.getState()
                      if (currentState.syncProgress.cancelRequested) {
                        wasCancelled = true
                        break
                      }
                      
                      const batch = unsyncedFiles.slice(i, i + CONCURRENCY)
                      
                      const elapsed = (Date.now() - startTime) / 1000
                      const speed = elapsed > 0 ? uploadedBytes / elapsed : 0
                      const percent = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0
                      
                      updateSyncProgress(synced + failed, percent, formatSpeed(speed))
                      
                      const results = await Promise.all(batch.map(f => syncOneFile(f)))
                      
                      for (const result of results) {
                        if (result.success) {
                          synced++
                          uploadedBytes += result.size
                          if (result.fileId) {
                            syncedFileIds.push(result.fileId)
                          }
                        } else {
                          failed++
                          if (result.error) {
                            errors.push(result.error)
                            console.error('Sync error:', result.error)
                          }
                        }
                      }
                    }
                    
                    // End sync progress
                    endSync()
                    setStatusMessage('')
                    
                    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
                    const avgSpeed = formatSpeed(uploadedBytes / parseFloat(totalTime))
                    
                    if (wasCancelled) {
                      addToast('warning', `Sync cancelled. ${synced} files synced before cancellation.`)
                      // Note: We keep synced files by default. The user chose "keep" in the dialog.
                      // If they chose "discard", we would delete syncedFileIds here (future enhancement)
                    } else if (failed > 0) {
                      addToast('warning', `Synced ${synced}/${total} files (${formatSize(uploadedBytes)}) in ${totalTime}s. ${failed} failed.`)
                      console.error('Sync errors:', errors)
                      if (errors.length <= 3) {
                        errors.forEach(e => addToast('error', e, 8000))
                      }
                    } else if (synced > 0) {
                      addToast('success', `Synced ${synced} files (${formatSize(uploadedBytes)}) in ${totalTime}s • ${avgSpeed}`)
                    }
                    
                    onRefresh(true) // Silent refresh after sync
                  }}
                >
                  <Cloud size={14} />
                  First Check In {multiSelect ? countLabel : ''}
                </div>
              )}
              
              {/* Check Out - for synced files or folders with synced content */}
              {allFolders && !multiSelect ? (
                <div 
                  className={`context-menu-item ${!anySynced || checkoutableCount === 0 ? 'disabled' : ''}`}
                  onClick={() => {
                    if (!anySynced || checkoutableCount === 0) return
                    handleCheckoutFolder(firstFile)
                    setContextMenu(null)
                  }}
                  title={!anySynced ? 'Check in files first to enable checkout' : checkoutableCount === 0 ? 'All files already checked out' : ''}
                >
                  <ArrowDown size={14} className={!anySynced || checkoutableCount === 0 ? 'text-pdm-fg-muted' : 'text-pdm-warning'} />
                  Check Out {checkoutableCount > 0 ? `${checkoutableCount} files` : ''}
                  {!anySynced && <span className="text-xs text-pdm-fg-muted ml-auto">(check in first)</span>}
                  {anySynced && checkoutableCount === 0 && <span className="text-xs text-pdm-fg-muted ml-auto">(already out)</span>}
                </div>
              ) : (
                <div 
                  className={`context-menu-item ${!anySynced || allCheckedOut ? 'disabled' : ''}`}
                  onClick={async () => {
                    if (!anySynced || allCheckedOut || !user) return
                    setContextMenu(null)
                    
                    // Get all files to checkout - including files inside selected folders
                    const getFilesToCheckout = (): LocalFile[] => {
                      const result: LocalFile[] = []
                      for (const item of contextFiles) {
                        if (item.isDirectory) {
                          // Get files inside folder that aren't checked out
                          const folderPrefix = item.relativePath + '/'
                          const filesInFolder = files.filter(f => 
                            !f.isDirectory && 
                            f.pdmData?.id &&
                            !f.pdmData.checked_out_by &&
                            f.diffStatus !== 'cloud' &&
                            (f.relativePath.startsWith(folderPrefix) || 
                             f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
                          )
                          result.push(...filesInFolder)
                        } else if (item.pdmData?.id && !item.pdmData.checked_out_by && item.diffStatus !== 'cloud') {
                          result.push(item)
                        }
                      }
                      return result
                    }
                    const filesToCheckout = getFilesToCheckout()
                    if (filesToCheckout.length === 0) {
                      addToast('info', 'All files are already checked out')
                      return
                    }
                    
                    let succeeded = 0
                    let failed = 0
                    const CONCURRENCY = 8
                    
                    const checkoutOneFile = async (file: LocalFile): Promise<boolean> => {
                      try {
                        const result = await checkoutFile(file.pdmData!.id, user.id)
                        if (result.success) {
                          await window.electronAPI?.setReadonly(file.path, false)
                          return true
                        }
                        return false
                      } catch {
                        return false
                      }
                    }
                    
                    // Process in parallel batches
                    for (let i = 0; i < filesToCheckout.length; i += CONCURRENCY) {
                      const batch = filesToCheckout.slice(i, i + CONCURRENCY)
                      setStatusMessage(`Checking out ${i + 1}-${Math.min(i + CONCURRENCY, filesToCheckout.length)}/${filesToCheckout.length}...`)
                      
                      const results = await Promise.all(batch.map(f => checkoutOneFile(f)))
                      
                      for (const success of results) {
                        if (success) succeeded++
                        else failed++
                      }
                    }
                    
                    setStatusMessage('')
                    if (failed > 0) {
                      addToast('warning', `Checked out ${succeeded}/${filesToCheckout.length} files`)
                    } else {
                      addToast('success', `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`)
                    }
                    onRefresh(true) // Silent refresh after checkout
                  }}
                  title={!anySynced ? 'Check in files first to enable checkout' : allCheckedOut ? 'Already checked out' : ''}
                >
                  <ArrowDown size={14} className={!anySynced ? 'text-pdm-fg-muted' : 'text-pdm-warning'} />
                  Check Out {multiSelect ? countLabel : ''}
                  {!anySynced && <span className="text-xs text-pdm-fg-muted ml-auto">(check in first)</span>}
                  {anySynced && allCheckedOut && <span className="text-xs text-pdm-fg-muted ml-auto">(already out)</span>}
                </div>
              )}
              
              {/* Check In - only for synced files or folders with synced content */}
              {anySynced && (
                allFolders && !multiSelect ? (
                  <div 
                    className={`context-menu-item ${checkinableCount === 0 ? 'disabled' : ''}`}
                    onClick={() => {
                      if (checkinableCount === 0) return
                      handleCheckinFolder(firstFile)
                      setContextMenu(null)
                    }}
                    title={checkinableCount === 0 ? 'No files checked out by you' : ''}
                  >
                    <ArrowUp size={14} className={checkinableCount === 0 ? 'text-pdm-fg-muted' : 'text-pdm-success'} />
                    Check In {checkinableCount > 0 ? `${checkinableCount} files` : ''}
                    {checkinableCount === 0 && <span className="text-xs text-pdm-fg-muted ml-auto">(none checked out)</span>}
                  </div>
                ) : (
                  <div 
                    className={`context-menu-item ${allCheckedIn ? 'disabled' : ''}`}
                    onClick={async () => {
                      if (allCheckedIn || !user) return
                      setContextMenu(null)
                      
                      // Get all files to checkin - including files inside selected folders
                      const getFilesToCheckin = (): LocalFile[] => {
                        const result: LocalFile[] = []
                        for (const item of contextFiles) {
                          if (item.isDirectory) {
                            // Get files inside folder that are checked out
                            const folderPrefix = item.relativePath + '/'
                            const filesInFolder = files.filter(f => 
                              !f.isDirectory && 
                              f.pdmData?.id &&
                              f.pdmData.checked_out_by &&
                              f.diffStatus !== 'cloud' &&
                              (f.relativePath.startsWith(folderPrefix) || 
                               f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
                            )
                            result.push(...filesInFolder)
                          } else if (item.pdmData?.id && item.pdmData.checked_out_by && item.diffStatus !== 'cloud') {
                            result.push(item)
                          }
                        }
                        return result
                      }
                      const filesToCheckin = getFilesToCheckin()
                      if (filesToCheckin.length === 0) {
                        addToast('info', 'No files are checked out')
                        return
                      }
                      
                      let succeeded = 0
                      let failed = 0
                      const CONCURRENCY = 8
                      
                      const checkinOneFile = async (file: LocalFile): Promise<boolean> => {
                        try {
                          const readResult = await window.electronAPI?.readFile(file.path)
                          
                          if (readResult?.success && readResult.data && readResult.hash) {
                            const result = await checkinFile(file.pdmData!.id, user.id, {
                              newContentHash: readResult.hash,
                              newFileSize: file.size
                            })
                            
                            if (result.success) {
                              await window.electronAPI?.setReadonly(file.path, true)
                              return true
                            }
                          } else {
                            const result = await checkinFile(file.pdmData!.id, user.id)
                            if (result.success) {
                              await window.electronAPI?.setReadonly(file.path, true)
                              return true
                            }
                          }
                          return false
                        } catch {
                          return false
                        }
                      }
                      
                      // Process in parallel batches
                      for (let i = 0; i < filesToCheckin.length; i += CONCURRENCY) {
                        const batch = filesToCheckin.slice(i, i + CONCURRENCY)
                        setStatusMessage(`Checking in ${i + 1}-${Math.min(i + CONCURRENCY, filesToCheckin.length)}/${filesToCheckin.length}...`)
                        
                        const results = await Promise.all(batch.map(f => checkinOneFile(f)))
                        
                        for (const success of results) {
                          if (success) succeeded++
                          else failed++
                        }
                      }
                      
                      setStatusMessage('')
                      if (failed > 0) {
                        addToast('warning', `Checked in ${succeeded}/${filesToCheckin.length} files`)
                      } else {
                        addToast('success', `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`)
                      }
                      onRefresh(true) // Silent refresh after checkin
                    }}
                    title={allCheckedIn ? 'Already checked in' : ''}
                  >
                    <ArrowUp size={14} className="text-pdm-success" />
                    Check In {multiSelect ? countLabel : ''}
                    {allCheckedIn && <span className="text-xs text-pdm-fg-muted ml-auto">(already in)</span>}
                  </div>
                )
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
              
              {/* Delete options - grouped together */}
              {(() => {
                // Helper to get all files including those inside folders
                const getAllFilesFromSelection = () => {
                  const allFiles: LocalFile[] = []
                  for (const item of contextFiles) {
                    if (item.isDirectory) {
                      // Get all files inside this folder recursively
                      const folderPath = item.relativePath.replace(/\\/g, '/')
                      const filesInFolder = files.filter(f => {
                        if (f.isDirectory) return false
                        const filePath = f.relativePath.replace(/\\/g, '/')
                        return filePath.startsWith(folderPath + '/')
                      })
                      allFiles.push(...filesInFolder)
                    } else {
                      allFiles.push(item)
                    }
                  }
                  // Remove duplicates
                  return [...new Map(allFiles.map(f => [f.path, f])).values()]
                }
                
                const allFilesInSelection = getAllFilesFromSelection()
                const syncedFilesInSelection = allFilesInSelection.filter(f => f.pdmData && f.diffStatus !== 'cloud' && f.diffStatus !== 'added')
                const unsyncedFilesInSelection = allFilesInSelection.filter(f => !f.pdmData || f.diffStatus === 'added')
                const hasLocalFiles = contextFiles.some(f => f.diffStatus !== 'cloud')
                const hasSyncedFiles = syncedFilesInSelection.length > 0 || contextFiles.some(f => f.pdmData && f.diffStatus !== 'cloud')
                const hasUnsyncedLocalFiles = unsyncedFilesInSelection.length > 0 || contextFiles.some(f => (!f.pdmData || f.diffStatus === 'added') && f.diffStatus !== 'cloud')
                
                return (
                  <>
                    {/* Remove Local Copy - removes local copy of synced files, keeps server */}
                    {hasLocalFiles && hasSyncedFiles && (
                      <div 
                        className="context-menu-item"
                        onClick={async () => {
                          setContextMenu(null)
                          
                          // Get all synced files (including from folders)
                          const filesToProcess = syncedFilesInSelection
                          
                          if (filesToProcess.length === 0) {
                            addToast('info', 'No synced files to remove locally')
                            return
                          }
                          
                          // Check for files with local changes that would be lost
                          const checkedOutByMe = filesToProcess.filter(f => f.pdmData?.checked_out_by === user?.id)
                          const modifiedFiles = filesToProcess.filter(f => f.diffStatus === 'modified')
                          
                          let warnings: string[] = []
                          if (checkedOutByMe.length > 0) {
                            warnings.push(`${checkedOutByMe.length} file${checkedOutByMe.length > 1 ? 's' : ''} will have checkout released`)
                          }
                          if (modifiedFiles.length > 0) {
                            warnings.push(`${modifiedFiles.length} file${modifiedFiles.length > 1 ? 's have' : ' has'} unsaved local changes that will be lost`)
                          }
                          
                          const warningText = warnings.length > 0 ? warnings.join('\n• ') : undefined
                          
                          // Store files for the confirm action
                          const storedFilesToProcess = [...filesToProcess]
                          const storedContextFiles = [...contextFiles]
                          
                          setCustomConfirm({
                            title: `Remove ${filesToProcess.length} Local Cop${filesToProcess.length > 1 ? 'ies' : 'y'}?`,
                            message: `${filesToProcess.length} file${filesToProcess.length > 1 ? 's' : ''} will be removed locally but remain on the server.`,
                            warning: warningText,
                            confirmText: 'Remove Local Copy',
                            confirmDanger: false,
                            onConfirm: async () => {
                              const total = storedFilesToProcess.length
                              startSync(total, 'download') // Reuse download type for local operations
                              
                              let removed = 0
                              let failed = 0
                              
                              for (const file of storedFilesToProcess) {
                                // Check for cancellation
                                if (usePDMStore.getState().syncProgress.cancelRequested) {
                                  break
                                }
                                
                                try {
                                  // If checked out by me, release the checkout first
                                  if (file.pdmData?.checked_out_by === user?.id && file.pdmData?.id) {
                                    await checkinFile(file.pdmData.id, user!.id)
                                  }
                                  
                                  await window.electronAPI?.deleteItem(file.path)
                                  removed++
                                } catch (err) {
                                  console.error('Failed to remove file:', file.name, err)
                                  failed++
                                }
                                
                                // Update progress
                                const percent = Math.round(((removed + failed) / total) * 100)
                                updateSyncProgress(removed + failed, percent, '')
                              }
                              
                              // Also remove empty folders that were selected
                              for (const item of storedContextFiles) {
                                if (item.isDirectory && item.diffStatus !== 'cloud') {
                                  try {
                                    await window.electronAPI?.deleteItem(item.path)
                                  } catch (err) {
                                    // Folder might not be empty or already deleted
                                  }
                                }
                              }
                              
                              endSync()
                              
                              if (removed > 0) {
                                addToast('success', `Removed ${removed} file${removed > 1 ? 's' : ''} locally`)
                                onRefresh(true) // Silent refresh after delete
                              }
                            }
                          })
                        }}
                      >
                        <Trash2 size={14} />
                        Remove Local Copy {countLabel}
                      </div>
                    )}
                    
                    {/* Delete Locally - for unsynced local files only (not when there are synced files too) */}
                    {hasUnsyncedLocalFiles && !hasSyncedFiles && !allCloudOnly && (
                      <div 
                        className="context-menu-item danger"
                        onClick={async () => {
                          setContextMenu(null)
                          
                          // Get all unsynced files to delete
                          const filesToDelete = unsyncedFilesInSelection.length > 0 
                            ? unsyncedFilesInSelection 
                            : contextFiles.filter(f => !f.pdmData || f.diffStatus === 'added')
                          
                          if (filesToDelete.length === 0) {
                            addToast('info', 'No local files to delete')
                            return
                          }
                          
                          // Use delete confirm dialog for local files
                          setDeleteConfirm(firstFile)
                        }}
                      >
                        <Trash2 size={14} />
                        Delete Locally {countLabel}
                      </div>
                    )}
                    
                    {/* Delete Everywhere - deletes from local AND server (only when synced files exist) */}
                    {(hasSyncedFiles || allCloudOnly) && (
                      <div 
                        className="context-menu-item danger"
                        onClick={async () => {
                          if (allCloudOnly) {
                            // Cloud-only: just delete from server
                            setContextMenu(null)
                            
                            const cloudFiles = contextFiles.filter(f => f.diffStatus === 'cloud')
                            // Also get files inside cloud folders
                            const allCloudFiles: LocalFile[] = []
                            for (const item of cloudFiles) {
                              if (item.isDirectory) {
                                const folderPath = item.relativePath.replace(/\\/g, '/')
                                const filesInFolder = files.filter(f => {
                                  if (f.isDirectory) return false
                                  if (f.diffStatus !== 'cloud') return false
                                  const filePath = f.relativePath.replace(/\\/g, '/')
                                  return filePath.startsWith(folderPath + '/')
                                })
                                allCloudFiles.push(...filesInFolder)
                              } else if (item.pdmData?.id) {
                                allCloudFiles.push(item)
                              }
                            }
                            const uniqueCloudFiles = [...new Map(allCloudFiles.map(f => [f.path, f])).values()]
                            
                            if (uniqueCloudFiles.length === 0) {
                              addToast('warning', 'No files to delete from server')
                              return
                            }
                            
                            // Store files for the confirm action
                            const storedCloudFiles = [...uniqueCloudFiles]
                            
                            setCustomConfirm({
                              title: `Delete ${uniqueCloudFiles.length} Item${uniqueCloudFiles.length > 1 ? 's' : ''} from Server?`,
                              message: `${uniqueCloudFiles.length} file${uniqueCloudFiles.length > 1 ? 's' : ''} will be permanently deleted from the server.`,
                              warning: 'This action cannot be undone.',
                              confirmText: 'Delete from Server',
                              confirmDanger: true,
                              onConfirm: async () => {
                                const total = storedCloudFiles.length
                                startSync(total, 'upload') // Use upload type for server operations
                                
                                let deleted = 0
                                let failed = 0
                                
                                for (const file of storedCloudFiles) {
                                  // Check for cancellation
                                  if (usePDMStore.getState().syncProgress.cancelRequested) {
                                    break
                                  }
                                  
                                  if (!file.pdmData?.id) {
                                    failed++
                                    continue
                                  }
                                  try {
                                    const { supabase } = await import('../lib/supabase')
                                    const { error } = await supabase
                                      .from('files')
                                      .delete()
                                      .eq('id', file.pdmData.id)
                                    
                                    if (!error) deleted++
                                    else failed++
                                  } catch (err) {
                                    console.error('Failed to delete file from server:', file.name, err)
                                    failed++
                                  }
                                  
                                  // Update progress
                                  const percent = Math.round(((deleted + failed) / total) * 100)
                                  updateSyncProgress(deleted + failed, percent, '')
                                }
                                
                                endSync()
                                
                                if (deleted > 0) {
                                  addToast('success', `Deleted ${deleted} file${deleted > 1 ? 's' : ''} from server`)
                                  onRefresh(true) // Silent refresh after delete
                                }
                              }
                            })
                          } else {
                            // Has local synced files: use delete confirm dialog
                            setDeleteConfirm(firstFile)
                            setContextMenu(null)
                          }
                        }}
                      >
                        <CloudOff size={14} />
                        {allCloudOnly ? 'Delete from Server' : 'Delete Everywhere'} {countLabel}
                      </div>
                    )}
                  </>
                )
              })()}
              
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

      {/* Column context menu */}
      {columnContextMenu && (
        <>
          <div 
            className="fixed inset-0 z-50" 
            onClick={() => setColumnContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setColumnContextMenu({ x: e.clientX, y: e.clientY })
            }}
          />
          <div 
            className="context-menu max-h-96 overflow-y-auto"
            style={{ left: columnContextMenu.x, top: columnContextMenu.y }}
          >
            <div className="px-3 py-1.5 text-xs text-pdm-fg-muted uppercase tracking-wide border-b border-pdm-border mb-1">
              Show/Hide Columns
            </div>
            {columns.map(column => (
              <div 
                key={column.id}
                className="context-menu-item"
                onClick={() => {
                  toggleColumnVisibility(column.id)
                }}
              >
                {column.visible ? (
                  <Eye size={14} className="text-pdm-success" />
                ) : (
                  <EyeOff size={14} className="text-pdm-fg-muted" />
                )}
                <span className={column.visible ? '' : 'text-pdm-fg-muted'}>{column.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

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
            <div 
              className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
              onClick={() => {
                if (clipboard) {
                  handlePaste()
                }
                setEmptyContextMenu(null)
              }}
            >
              <ClipboardPaste size={14} />
              Paste
              <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+V</span>
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

      {/* Custom confirmation dialog */}
      {customConfirm && (
        <div 
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={() => setCustomConfirm(null)}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full ${customConfirm.confirmDanger ? 'bg-pdm-error/20' : 'bg-pdm-warning/20'} flex items-center justify-center`}>
                <AlertTriangle size={20} className={customConfirm.confirmDanger ? 'text-pdm-error' : 'text-pdm-warning'} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">{customConfirm.title}</h3>
              </div>
            </div>
            
            <p className="text-sm text-pdm-fg-dim mb-4">{customConfirm.message}</p>
            
            {customConfirm.warning && (
              <div className="bg-pdm-warning/10 border border-pdm-warning/30 rounded p-3 mb-4">
                <div className="flex items-start gap-2 text-sm text-pdm-warning">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{customConfirm.warning}</span>
                </div>
              </div>
            )}
            
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCustomConfirm(null)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  customConfirm.onConfirm()
                  setCustomConfirm(null)
                }}
                className={customConfirm.confirmDanger ? 'btn btn-danger' : 'btn btn-primary'}
              >
                {customConfirm.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (() => {
        // Get all files to delete (selected files if deleteConfirm is in selection, otherwise just deleteConfirm)
        const filesToDelete = selectedFiles.includes(deleteConfirm.path)
          ? sortedFiles.filter(f => selectedFiles.includes(f.path))
          : [deleteConfirm]
        const deleteCount = filesToDelete.length
        const folderCount = filesToDelete.filter(f => f.isDirectory).length
        const fileCount = filesToDelete.filter(f => !f.isDirectory).length
        
        return (
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
                    <h3 className="text-lg font-semibold text-pdm-fg">
                      Delete {deleteCount > 1 ? `${deleteCount} Items` : deleteConfirm.isDirectory ? 'Folder' : 'File'}?
                    </h3>
                    <p className="text-sm text-pdm-fg-muted">This action will move items to the Recycle Bin.</p>
                  </div>
                </div>
                
                <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4 max-h-40 overflow-y-auto">
                  {deleteCount === 1 ? (
                    <div className="flex items-center gap-2">
                      {deleteConfirm.isDirectory ? (
                        <FolderOpen size={16} className="text-pdm-fg-muted" />
                      ) : (
                        <File size={16} className="text-pdm-fg-muted" />
                      )}
                      <span className="text-pdm-fg font-medium truncate">{deleteConfirm.name}</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-pdm-fg mb-2">
                        {fileCount > 0 && <span>{fileCount} file{fileCount > 1 ? 's' : ''}</span>}
                        {fileCount > 0 && folderCount > 0 && <span>, </span>}
                        {folderCount > 0 && <span>{folderCount} folder{folderCount > 1 ? 's' : ''}</span>}
                      </div>
                      <div className="space-y-1">
                        {filesToDelete.slice(0, 5).map(f => (
                          <div key={f.path} className="flex items-center gap-2 text-sm">
                            {f.isDirectory ? (
                              <FolderOpen size={14} className="text-pdm-fg-muted" />
                            ) : (
                              <File size={14} className="text-pdm-fg-muted" />
                            )}
                            <span className="text-pdm-fg-dim truncate">{f.name}</span>
                          </div>
                        ))}
                        {filesToDelete.length > 5 && (
                          <div className="text-xs text-pdm-fg-muted">
                            ...and {filesToDelete.length - 5} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {folderCount > 0 && (
                    <p className="text-xs text-pdm-fg-muted mt-2">
                      All contents inside folders will also be deleted.
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
                    onClick={async () => {
                      let deleted = 0
                      for (const file of filesToDelete) {
                        const result = await window.electronAPI?.deleteItem(file.path)
                        if (result?.success) {
                          deleted++
                          setUndoStack(prev => [...prev, { type: 'delete', file, originalPath: file.path }])
                        }
                      }
                      setDeleteConfirm(null)
                      clearSelection()
                      
                      if (deleted === filesToDelete.length) {
                        addToast('success', `Deleted ${deleted} item${deleted > 1 ? 's' : ''}`)
                      } else {
                        addToast('warning', `Deleted ${deleted}/${filesToDelete.length} items`)
                      }
                      onRefresh()
                    }}
                    className="btn bg-pdm-error hover:bg-pdm-error/80 text-white"
                  >
                    <Trash2 size={14} />
                    Delete {deleteCount > 1 ? `(${deleteCount})` : ''}
                  </button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
