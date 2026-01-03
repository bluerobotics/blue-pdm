import { useState, useEffect, useRef, useMemo } from 'react'
import { 
  FolderOpen, 
  ChevronRight, 
  ChevronDown,
  Database,
  Cloud,
  Loader2,
  Unlink,
  FolderOpen as FolderOpenIcon,
  AlertTriangle,
  Check,
  Info,
  RefreshCw,
  Plus,
  Lock,
  X
} from 'lucide-react'
// Shared file/folder components
import { 
  FileIcon,
  type CheckoutUser
} from '../shared/FileItemComponents'
// Use command system for PDM operations
import { executeCommand } from '../../lib/commands'
import { usePDMStore, LocalFile, ConnectedVault } from '../../stores/pdmStore'
import { FileContextMenu } from '../FileContextMenu'
// Explorer sub-components
import { VaultTreeItem } from './explorer/VaultTreeItem'
import { PinnedFoldersSection } from './explorer/PinnedFoldersSection'
import { RecentVaultsSection, NoVaultAccessMessage } from './explorer/RecentVaultsSection'
import { FileActionButtons, FolderActionButtons } from './explorer/TreeItemActions'
// Explorer hooks
import { useVaultTree } from './explorer/hooks/useVaultTree'
import { useTreeDragDrop } from './explorer/hooks/useTreeDragDrop'
import { useTreeKeyboardNav } from './explorer/hooks/useTreeKeyboardNav'
// Constants
import { 
  TREE_BASE_PADDING_PX, 
  TREE_INDENT_PX, 
  DIFF_STATUS_CLASS_PREFIX,
  SLOW_DOUBLE_CLICK_MIN_MS,
  SLOW_DOUBLE_CLICK_MAX_MS,
  SOLIDWORKS_EXTENSIONS,
  PDM_FILES_DATA_TYPE
} from './explorer/constants'

interface ExplorerViewProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
  onRefresh?: (silent?: boolean) => void
}

export function ExplorerView({ onOpenVault, onOpenRecentVault, onRefresh }: ExplorerViewProps) {
  const { 
    files, 
    expandedFolders, 
    toggleFolder, 
    vaultPath,
    isVaultConnected,
    recentVaults,
    currentFolder,
    setCurrentFolder,
    connectedVaults,
    toggleVaultExpanded,
    activeVaultId,
    switchVault,
    addToast,
    pinnedFolders,
    unpinFolder,
    pinnedSectionExpanded,
    togglePinnedSection,
    reorderPinnedFolders,
    user,
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    lowercaseExtensions,
    isLoading,
    filesLoaded,
    removeConnectedVault,
    setFiles,
    setServerFiles,
    setFilesLoaded,
    setVaultPath,
    setVaultConnected,
    hideSolidworksTempFiles,
    getEffectiveVaultIds,
    impersonatedUser,
  } = usePDMStore()
  
  // Filter connected vaults based on impersonated user's access
  const effectiveVaultIds = getEffectiveVaultIds()
  const visibleVaults = useMemo(() => {
    if (effectiveVaultIds.length === 0) return connectedVaults
    return connectedVaults.filter(v => effectiveVaultIds.includes(v.id))
  }, [connectedVaults, effectiveVaultIds])
  
  // Use extracted hooks
  const { 
    tree, 
    isBeingProcessed, 
    checkFolderSynced, 
    checkFolderCheckoutStatus, 
    getDiffCounts,
    getLocalOnlyCount,
    getFolderCheckoutStats,
    sortChildren
  } = useVaultTree()
  
  const {
    draggedFilesRef,
    dragOverFolder,
    setDragOverFolder,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleDropOnFolder,
    handleVaultRootDrop
  } = useTreeDragDrop()
  
  // Local state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(null)
  const [vaultContextMenu, setVaultContextMenu] = useState<{ x: number; y: number; vault: ConnectedVault } | null>(null)
  const [disconnectingVault, setDisconnectingVault] = useState<ConnectedVault | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [showVaultProperties, setShowVaultProperties] = useState<ConnectedVault | null>(null)
  const [clipboard, setClipboard] = useState<{ files: LocalFile[]; operation: 'copy' | 'cut' } | null>(null)
  const [lastClickTime, setLastClickTime] = useState<number>(0)
  const [lastClickPath, setLastClickPath] = useState<string | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [platform, setPlatform] = useState<string>('win32')
  const [renameValue, setRenameValue] = useState('')
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [isCheckingInAll, setIsCheckingInAll] = useState(false)
  const [isCheckinHovered, setIsCheckinHovered] = useState(false)
  const [isDownloadHovered, setIsDownloadHovered] = useState(false)
  const [isUploadHovered, setIsUploadHovered] = useState(false)
  const [isCheckoutHovered, setIsCheckoutHovered] = useState(false)
  const [isUpdateHovered, setIsUpdateHovered] = useState(false)
  const [isCheckingInMyCheckouts, setIsCheckingInMyCheckouts] = useState(false)
  
  // Ref for the explorer view container
  const explorerContainerRef = useRef<HTMLDivElement>(null!)
  
  // Use keyboard navigation hook
  useTreeKeyboardNav({ containerRef: explorerContainerRef, tree, onRefresh })
  
  // Calculate selected files for multi-select operations
  const selectedCheckinableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      f.pdmData?.checked_out_by === user?.id &&
      f.diffStatus !== 'deleted'
    )
  }, [files, selectedFiles, user?.id])

  const selectedDownloadableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new' || f.diffStatus === 'outdated')
    )
  }, [files, selectedFiles])

  const selectedUploadableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added') && 
      f.diffStatus !== 'cloud'
    )
  }, [files, selectedFiles])

  const selectedCheckoutableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      f.pdmData && 
      !f.pdmData.checked_out_by && 
      f.diffStatus !== 'cloud' &&
      f.diffStatus !== 'deleted'
    )
  }, [files, selectedFiles])

  const selectedUpdatableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      f.diffStatus === 'outdated'
    )
  }, [files, selectedFiles])
  
  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])
  
  // Switch to a different vault
  const switchToVault = async (vault: ConnectedVault) => {
    if (vault.id === activeVaultId) {
      setCurrentFolder('')
      return
    }
    
    setFiles([])
    setServerFiles([])
    setFilesLoaded(false)
    
    if (window.electronAPI) {
      const result = await window.electronAPI.setWorkingDir(vault.localPath)
      if (!result.success) {
        addToast('error', `Failed to switch vault: ${result.error}`)
        return
      }
    }
    
    switchVault(vault.id, vault.localPath)
    setCurrentFolder('')
  }
  
  // Get files that need attention before disconnect
  const getDisconnectWarnings = () => {
    const checkedOutFiles = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.diffStatus !== 'deleted')
    const newFiles = files.filter(f => !f.isDirectory && f.diffStatus === 'added')
    const modifiedFiles = files.filter(f => !f.isDirectory && (f.diffStatus === 'modified' || f.diffStatus === 'moved'))
    return { checkedOutFiles, newFiles, modifiedFiles }
  }
  
  const handleVaultContextMenu = (e: React.MouseEvent, vault: ConnectedVault) => {
    e.preventDefault()
    e.stopPropagation()
    setVaultContextMenu({ x: e.clientX, y: e.clientY, vault })
  }
  
  const confirmDisconnect = async () => {
    if (!disconnectingVault) return
    
    setIsDisconnecting(true)
    
    let folderDeleted = false
    if (disconnectingVault.localPath) {
      const api = window.electronAPI
      if (api) {
        try {
          await api.clearWorkingDir()
          await new Promise(resolve => setTimeout(resolve, 200))
          
          const result = await api.deleteItem(disconnectingVault.localPath)
          if (result.success) {
            folderDeleted = true
          } else {
            addToast('warning', `Could not delete local folder: ${result.error}`)
          }
        } catch (err) {
          addToast('warning', `Could not delete local folder: ${err}`)
        }
      }
    }
    
    if (disconnectingVault.id === activeVaultId) {
      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      setVaultPath(null)
      setVaultConnected(false)
    }
    
    removeConnectedVault(disconnectingVault.id)
    setDisconnectingVault(null)
    setIsDisconnecting(false)
    
    if (folderDeleted) {
      addToast('success', 'Vault disconnected and local files deleted')
    } else {
      addToast('info', 'Vault disconnected (local folder may still exist)')
    }
  }
  
  // Handle slow double click for rename
  const handleSlowDoubleClick = (file: LocalFile) => {
    const now = Date.now()
    const timeDiff = now - lastClickTime
    const isSameFile = lastClickPath === file.relativePath
    
    const isSynced = !!file.pdmData
    const isCheckedOutByMe = file.pdmData?.checked_out_by === user?.id
    const canRename = !isSynced || isCheckedOutByMe
    
    if (isSameFile && timeDiff > SLOW_DOUBLE_CLICK_MIN_MS && timeDiff < SLOW_DOUBLE_CLICK_MAX_MS && !file.isDirectory && canRename) {
      setRenamingFile(file)
      setRenameValue(file.name)
      setLastClickTime(0)
      setLastClickPath(null)
    } else {
      setLastClickTime(now)
      setLastClickPath(file.relativePath)
    }
  }
  
  const handleRenameSubmit = async () => {
    if (!renamingFile || !renameValue.trim()) {
      setRenamingFile(null)
      return
    }
    
    const newName = renameValue.trim()
    
    if (newName === renamingFile.name) {
      setRenamingFile(null)
      return
    }
    
    await executeCommand('rename', { file: renamingFile, newName }, { onRefresh })
    setRenamingFile(null)
  }
  
  // Clipboard operations
  const handleCopy = () => {
    if (!contextMenu?.file) return
    const filesToCopy = selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
      ? files.filter(f => selectedFiles.includes(f.path))
      : [contextMenu.file]
    setClipboard({ files: filesToCopy, operation: 'copy' })
    addToast('info', `Copied ${filesToCopy.length} item${filesToCopy.length > 1 ? 's' : ''}`)
  }
  
  const handleCut = () => {
    if (!contextMenu?.file) return
    const filesToCut = selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
      ? files.filter(f => selectedFiles.includes(f.path))
      : [contextMenu.file]
    
    const notAllowed = filesToCut.filter(f => 
      !f.isDirectory && f.pdmData && f.pdmData.checked_out_by !== user?.id
    )
    
    if (notAllowed.length > 0) {
      addToast('error', `Cannot move: files not checked out by you`)
      return
    }
    
    setClipboard({ files: filesToCut, operation: 'cut' })
    addToast('info', `Cut ${filesToCut.length} item${filesToCut.length > 1 ? 's' : ''}`)
  }
  
  const handlePaste = async () => {
    if (!clipboard || !contextMenu?.file || !vaultPath) return
    
    const targetFolderRelPath = contextMenu.file.isDirectory 
      ? contextMenu.file.relativePath 
      : contextMenu.file.relativePath.substring(0, contextMenu.file.relativePath.lastIndexOf('/'))
    
    if (clipboard.operation === 'cut') {
      await executeCommand('move', { files: clipboard.files, targetFolder: targetFolderRelPath }, { onRefresh, silent: true })
      setClipboard(null)
    } else {
      await executeCommand('copy', { files: clipboard.files, targetFolder: targetFolderRelPath }, { onRefresh, silent: true })
    }
  }
  
  const handleRename = (file: LocalFile) => {
    const newName = window.prompt('Enter new name:', file.name)
    if (newName && newName !== file.name) {
      executeCommand('rename', { file, newName }, { onRefresh })
    }
  }
  
  const handleNewFolder = async () => {
    if (!contextMenu?.file || !vaultPath) return
    
    const parentPath = contextMenu.file.isDirectory 
      ? contextMenu.file.relativePath 
      : contextMenu.file.relativePath.substring(0, contextMenu.file.relativePath.lastIndexOf('/'))
    
    const folderName = window.prompt('Enter folder name:', 'New Folder')
    if (folderName) {
      await executeCommand('new-folder', { parentPath, folderName }, { onRefresh })
    }
  }
  
  // Batch operations handlers
  const handleDownloadAllCloudFiles = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDownloadingAll) return
    
    const cloudFiles = files.filter(f => !f.isDirectory && (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new'))
    if (cloudFiles.length === 0) {
      addToast('info', 'No cloud files to download')
      return
    }
    
    setIsDownloadingAll(true)
    try {
      await executeCommand('download', { files: cloudFiles }, { onRefresh })
    } finally {
      setIsDownloadingAll(false)
    }
  }
  
  const handleUpdateAllOutdated = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDownloadingAll) return
    
    const outdatedFiles = files.filter(f => !f.isDirectory && f.diffStatus === 'outdated')
    if (outdatedFiles.length === 0) {
      addToast('info', 'No outdated files to update')
      return
    }
    
    setIsDownloadingAll(true)
    try {
      await executeCommand('get-latest', { files: outdatedFiles }, { onRefresh })
    } finally {
      setIsDownloadingAll(false)
    }
  }

  const handleFirstCheckinAllLocal = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCheckingInAll) return
    
    const localOnlyFiles = files.filter(f => !f.isDirectory && (!f.pdmData || f.diffStatus === 'added'))
    if (localOnlyFiles.length === 0) {
      addToast('info', 'No local files to check in')
      return
    }
    
    setIsCheckingInAll(true)
    try {
      await executeCommand('sync', { files: localOnlyFiles }, { onRefresh })
    } finally {
      setIsCheckingInAll(false)
    }
  }

  const handleCheckInMyCheckouts = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCheckingInMyCheckouts) return
    
    const myCheckedOutFiles = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.diffStatus !== 'deleted')
    if (myCheckedOutFiles.length === 0) {
      addToast('info', 'No files to check in')
      return
    }
    
    setIsCheckingInMyCheckouts(true)
    try {
      await executeCommand('checkin', { files: myCheckedOutFiles }, { onRefresh })
    } finally {
      setIsCheckingInMyCheckouts(false)
    }
  }

  const handleCheckoutAllSynced = async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    const syncedFiles = files.filter(f => !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check out')
      return
    }
    
    await executeCommand('checkout', { files: syncedFiles }, { onRefresh })
  }

  // Get file icon
  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      if (isBeingProcessed(file.relativePath)) {
        return <Loader2 size={16} className="text-sky-400 animate-spin" />
      }
      if (file.diffStatus === 'cloud') {
        return <FolderOpen size={16} className="text-plm-fg-muted" />
      }
      const checkoutStatus = checkFolderCheckoutStatus(file.relativePath)
      if (checkoutStatus === 'others' || checkoutStatus === 'both') {
        return <FolderOpen size={16} className="text-plm-error" />
      }
      if (checkoutStatus === 'mine') {
        return <FolderOpen size={16} className="text-orange-400" />
      }
      const synced = checkFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-plm-success' : 'text-plm-fg-muted'} />
    }
    
    if (isBeingProcessed(file.relativePath)) {
      return <Loader2 size={16} className="text-sky-400 animate-spin" />
    }
    
    return <FileIcon file={file} size={16} />
  }

  // Render tree item (file or folder)
  const renderTreeItem = (file: LocalFile, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(file.relativePath)
    const isCurrentFolder = file.isDirectory && file.relativePath === currentFolder
    const children = tree[file.relativePath] || []
    
    const diffCounts = file.isDirectory ? getDiffCounts(file.relativePath) : null
    const localOnlyCount = file.isDirectory ? getLocalOnlyCount(file.relativePath) : 0
    const folderStats = file.isDirectory ? getFolderCheckoutStats(file.relativePath) : null
    
    const diffClass = file.diffStatus ? `${DIFF_STATUS_CLASS_PREFIX}${file.diffStatus}` : ''
    const isSelected = selectedFiles.includes(file.path)
    const isRenaming = renamingFile?.relativePath === file.relativePath
    const isProcessing = isBeingProcessed(file.relativePath)
    const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath
    const isCut = clipboard?.operation === 'cut' && clipboard.files.some(f => f.path === file.path)

    // Click handler with selection logic
    const handleClick = (e: React.MouseEvent) => {
      if (isRenaming) return
      if (e.shiftKey) e.preventDefault()
      
      const getVisibleFiles = (): LocalFile[] => {
        const result: LocalFile[] = []
        const addFiles = (items: LocalFile[]) => {
          for (const item of items) {
            result.push(item)
            if (item.isDirectory && expandedFolders.has(item.relativePath)) {
              const children = tree[item.relativePath] || []
              addFiles(sortChildren(children))
            }
          }
        }
        addFiles(sortChildren(tree[''] || []))
        return result
      }
      
      const visibleFiles = getVisibleFiles()
      const currentIndex = visibleFiles.findIndex(f => f.path === file.path)
      
      if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, currentIndex)
        const end = Math.max(lastClickedIndex, currentIndex)
        const rangePaths = visibleFiles.slice(start, end + 1).map(f => f.path)
        
        if (e.ctrlKey || e.metaKey) {
          const newSelection = [...new Set([...selectedFiles, ...rangePaths])]
          setSelectedFiles(newSelection)
        } else {
          setSelectedFiles(rangePaths)
        }
      } else if (e.ctrlKey || e.metaKey) {
        toggleFileSelection(file.path, true)
        setLastClickedIndex(currentIndex)
      } else {
        setSelectedFiles([file.path])
        setLastClickedIndex(currentIndex)
      }
      
      if (file.isDirectory) {
        setCurrentFolder(file.relativePath)
      } else {
        const parentPath = file.relativePath.split('/').slice(0, -1).join('/') || ''
        setCurrentFolder(parentPath)
        handleSlowDoubleClick(file)
      }
    }

    // Double click handler
    const handleDoubleClick = async () => {
      if (isRenaming) return
      
      if (file.isDirectory) {
        toggleFolder(file.relativePath)
      } else if (file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') {
        const result = await executeCommand('download', { files: [file] }, { onRefresh, silent: true })
        if (result.success && window.electronAPI) {
          window.electronAPI.openFile(file.path)
        }
        setLastClickTime(0)
        setLastClickPath(null)
      } else if (window.electronAPI) {
        window.electronAPI.openFile(file.path)
        setLastClickTime(0)
        setLastClickPath(null)
      }
    }

    // Context menu handler
    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!(selectedFiles.length > 1 && selectedFiles.includes(file.path))) {
        setSelectedFiles([file.path])
      }
      setContextMenu({ x: e.clientX, y: e.clientY, file })
    }

    // Drag start handler
    const onDragStart = (e: React.DragEvent) => {
      let filesToDrag: LocalFile[]
      if (selectedFiles.includes(file.path) && selectedFiles.length > 1) {
        filesToDrag = files.filter(f => selectedFiles.includes(f.path) && f.diffStatus !== 'cloud')
      } else if (file.diffStatus !== 'cloud') {
        filesToDrag = [file]
      } else {
        e.preventDefault()
        return
      }
      
      handleDragStart(e, filesToDrag, file)
    }

    // Drag over handler
    const onDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
      const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
      const currentDraggedFiles = draggedFilesRef.current
      
      if (!hasPdmFiles && !hasExternalFiles && currentDraggedFiles.length === 0) return
      
      if (file.isDirectory) {
        handleFolderDragOver(e, file, currentDraggedFiles)
      }
    }

    return (
      <div key={file.path}>
        <div
          className={`tree-item group ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''} ${isCut ? 'opacity-50' : ''}`}
          style={{ paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          draggable={file.diffStatus !== 'cloud'}
          onDragStart={onDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={onDragOver}
          onDragLeave={file.isDirectory ? handleFolderDragLeave : undefined}
          onDrop={file.isDirectory ? (e) => handleDropOnFolder(e, file, onRefresh) : undefined}
        >
          {/* Folder chevron or file spacer */}
          {file.isDirectory ? (
            <span 
              className="mr-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                toggleFolder(file.relativePath)
              }}
            >
              {isExpanded 
                ? <ChevronDown size={14} className="text-plm-fg-muted" /> 
                : <ChevronRight size={14} className="text-plm-fg-muted" />
              }
            </span>
          ) : (
            <span className="w-[14px] mr-1" />
          )}
          
          {/* Icon */}
          <span className="tree-item-icon">{getFileIcon(file)}</span>
          
          {/* Name */}
          {isRenaming ? (
            <input
              type="text"
              className="flex-1 text-sm bg-plm-bg border border-plm-accent rounded px-1 py-0.5 outline-none"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') setRenamingFile(null)
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className={`truncate text-sm flex-1 ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}>
              {file.isDirectory || !file.extension 
                ? file.name 
                : file.name.slice(0, -file.extension.length) + (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
            </span>
          )}
          
          {/* Folder action buttons */}
          {!isRenaming && file.isDirectory && folderStats && (
            <FolderActionButtons
              file={file}
              diffCounts={diffCounts}
              localOnlyCount={localOnlyCount}
              checkoutUsers={folderStats.checkoutUsers}
              checkedOutByMeCount={folderStats.checkedOutByMeCount}
              totalCheckouts={folderStats.totalCheckouts}
              syncedCount={folderStats.syncedCount}
              isProcessing={isProcessing}
              onRefresh={onRefresh}
            />
          )}
          
          {/* File action buttons */}
          {!isRenaming && !file.isDirectory && (
            <FileActionButtons
              file={file}
              isProcessing={isProcessing}
              onRefresh={onRefresh}
              selectedFiles={selectedFiles}
              selectedDownloadableFiles={selectedDownloadableFiles}
              selectedUploadableFiles={selectedUploadableFiles}
              selectedCheckoutableFiles={selectedCheckoutableFiles}
              selectedCheckinableFiles={selectedCheckinableFiles}
              selectedUpdatableFiles={selectedUpdatableFiles}
              isDownloadHovered={isDownloadHovered}
              isUploadHovered={isUploadHovered}
              isCheckoutHovered={isCheckoutHovered}
              isCheckinHovered={isCheckinHovered}
              isUpdateHovered={isUpdateHovered}
              setIsDownloadHovered={setIsDownloadHovered}
              setIsUploadHovered={setIsUploadHovered}
              setIsCheckoutHovered={setIsCheckoutHovered}
              setIsCheckinHovered={setIsCheckinHovered}
              setIsUpdateHovered={setIsUpdateHovered}
            />
          )}
        </div>
        
        {/* Children when expanded */}
        {file.isDirectory && isExpanded && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              if (draggedFilesRef.current.length > 0 || e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)) {
                if (!dragOverFolder || dragOverFolder === file.relativePath) {
                  setDragOverFolder(file.relativePath)
                }
              }
            }}
            onDragLeave={(e) => {
              const relatedTarget = e.relatedTarget as HTMLElement
              if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                if (dragOverFolder === file.relativePath) {
                  setDragOverFolder(null)
                }
              }
            }}
            onDrop={(e) => handleDropOnFolder(e, file, onRefresh)}
          >
            {sortChildren(children).map(child => renderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Render vault section
  const renderVaultSection = (vault: ConnectedVault) => {
    const isActive = activeVaultId === vault.id
    const isExpanded = vault.isExpanded
    
    // Calculate vault stats
    const cloudFiles = isActive ? files.filter(f => !f.isDirectory && (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new')) : []
    const cloudFilesCount = cloudFiles.length
    const isAnyCloudFileProcessing = isActive && cloudFiles.some(f => isBeingProcessed(f.relativePath))
    const outdatedFilesCount = isActive ? files.filter(f => !f.isDirectory && f.diffStatus === 'outdated').length : 0
    const localOnlyFilesCount = isActive ? files.filter(f => 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') &&
      f.diffStatus !== 'cloud' && f.diffStatus !== 'ignored' &&
      !(hideSolidworksTempFiles && f.name.startsWith('~$'))
    ).length : 0
    const syncedFilesCount = isActive ? files.filter(f => !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new').length : 0
    const checkedOutByMeCount = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id).length : 0
    const checkedOutByOthers = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id) : []
    
    // Get all checkout users (with count for FolderCheckinButton)
    type CheckoutUserWithCount = CheckoutUser & { count?: number }
    const allCheckoutUsers: CheckoutUserWithCount[] = []
    if (isActive && checkedOutByMeCount > 0 && user) {
      allCheckoutUsers.push({
        id: user.id,
        name: user.full_name || user.email || 'You',
        avatar_url: user.avatar_url || undefined,
        isMe: true,
        count: checkedOutByMeCount
      })
    }
    if (isActive) {
      const othersMap = new Map<string, { id: string; name: string; avatar_url?: string; count: number }>()
      for (const f of checkedOutByOthers) {
        const checkoutUserId = f.pdmData!.checked_out_by!
        const checkedOutUser = (f.pdmData as any).checked_out_user
        if (othersMap.has(checkoutUserId)) {
          othersMap.get(checkoutUserId)!.count++
        } else {
          othersMap.set(checkoutUserId, {
            id: checkoutUserId,
            name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
            avatar_url: checkedOutUser?.avatar_url,
            count: 1
          })
        }
      }
      for (const u of othersMap.values()) {
        allCheckoutUsers.push({ ...u, isMe: false })
      }
    }
    
    const totalCheckouts = checkedOutByMeCount + checkedOutByOthers.length
    
    // Handle vault header click
    const handleVaultClick = () => {
      if (isActive) {
        toggleVaultExpanded(vault.id)
      } else {
        switchToVault(vault)
        if (!isExpanded) {
          toggleVaultExpanded(vault.id)
        }
      }
    }
    
    // Drag handlers for vault header
    const handleVaultDragOver = (e: React.DragEvent) => {
      if (!isActive) return
      e.preventDefault()
      e.stopPropagation()
      const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
      const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
      if (hasPdmFiles || draggedFilesRef.current.length > 0) {
        e.dataTransfer.dropEffect = 'move'
        setDragOverFolder('')
      } else if (hasExternalFiles) {
        e.dataTransfer.dropEffect = 'copy'
        setDragOverFolder('')
      }
    }
    
    const handleVaultDragLeave = (e: React.DragEvent) => {
      if (!isActive) return
      e.preventDefault()
      const relatedTarget = e.relatedTarget as HTMLElement
      if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
        if (dragOverFolder === '') {
          setDragOverFolder(null)
        }
      }
    }
    
    const handleVaultDrop = (e: React.DragEvent) => {
      if (!isActive) return
      handleVaultRootDrop(e, onRefresh)
    }
    
    return (
      <div key={vault.id} className="border-b border-plm-border last:border-b-0">
        <VaultTreeItem
          vault={vault}
          isActive={isActive}
          isExpanded={isExpanded && isActive}
          onClick={handleVaultClick}
          onContextMenu={(e) => handleVaultContextMenu(e, vault)}
          onDragOver={handleVaultDragOver}
          onDragLeave={handleVaultDragLeave}
          onDrop={handleVaultDrop}
          isDragTarget={isActive && dragOverFolder === ''}
          cloudFilesCount={cloudFilesCount}
          outdatedFilesCount={outdatedFilesCount}
          localOnlyFilesCount={localOnlyFilesCount}
          syncedFilesCount={syncedFilesCount}
          checkedOutByMeCount={checkedOutByMeCount}
          allCheckoutUsers={allCheckoutUsers}
          totalCheckouts={totalCheckouts}
          isDownloadingAll={isDownloadingAll}
          isCheckingInAll={isCheckingInAll}
          isCheckingInMyCheckouts={isCheckingInMyCheckouts}
          isAnyCloudFileProcessing={isAnyCloudFileProcessing}
          onDownloadAllCloud={handleDownloadAllCloudFiles}
          onUpdateAllOutdated={handleUpdateAllOutdated}
          onFirstCheckinAllLocal={handleFirstCheckinAllLocal}
          onCheckInMyCheckouts={handleCheckInMyCheckouts}
          onCheckoutAllSynced={handleCheckoutAllSynced}
        />
        
        {/* Vault contents */}
        {isExpanded && isActive && (
          <div 
            className={`pb-2 min-h-[40px] ${dragOverFolder === '' ? 'bg-plm-accent/10 outline outline-2 outline-dashed outline-plm-accent/50 rounded' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (draggedFilesRef.current.length > 0 || e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)) {
                if (!dragOverFolder) setDragOverFolder('')
              }
            }}
            onDragLeave={(e) => {
              const relatedTarget = e.relatedTarget as HTMLElement
              if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                if (dragOverFolder === '') setDragOverFolder(null)
              }
            }}
            onDrop={(e) => handleVaultRootDrop(e, onRefresh)}
          >
            {sortChildren(tree[''] || []).map(file => renderTreeItem(file, 1))}
            
            {(isLoading || !filesLoaded) && (tree[''] || []).length === 0 && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="text-plm-fg-muted animate-spin" />
              </div>
            )}
            
            {(tree[''] || []).length === 0 && !isLoading && filesLoaded && (
              <div className="px-4 py-4 text-center text-plm-fg-muted text-xs">
                {dragOverFolder === '' ? 'Drop here to move to root' : 'No files in vault'}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Render when no vaults connected
  if (visibleVaults.length === 0) {
    if (impersonatedUser && connectedVaults.length > 0) {
      return (
        <NoVaultAccessMessage 
          impersonatedUser={impersonatedUser}
          connectedVaultsCount={connectedVaults.length}
        />
      )
    }
    
    // Legacy single vault mode
    if (isVaultConnected && vaultPath) {
      const displayName = vaultPath.split(/[/\\]/).pop() || 'vault'
      const rootItems = tree[''] || []
      
      return (
        <div className="py-2 relative">
          <div 
            className={`px-3 py-2 border-b border-plm-border flex items-center gap-2 cursor-pointer transition-colors ${
              currentFolder === '' ? 'text-plm-accent font-medium' : 'text-plm-fg-muted hover:text-plm-fg'
            }`}
            onClick={() => setCurrentFolder('')}
            title="Go to vault root"
          >
            <Database size={14} />
            <span className="truncate text-sm">{displayName}</span>
          </div>
          
          {sortChildren(rootItems).map(file => renderTreeItem(file))}
          
          {(isLoading || !filesLoaded) && rootItems.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="text-plm-fg-muted animate-spin" />
            </div>
          )}
          
          {rootItems.length === 0 && !isLoading && filesLoaded && (
            <div className="px-4 py-8 text-center text-plm-fg-muted text-sm">
              No files in vault
            </div>
          )}
          
          {contextMenu && (
            <FileContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              files={files}
              contextFiles={selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
                ? files.filter(f => selectedFiles.includes(f.path))
                : [contextMenu.file]}
              onClose={() => setContextMenu(null)}
              onRefresh={onRefresh || (() => {})}
              clipboard={clipboard}
              onCopy={handleCopy}
              onCut={handleCut}
              onPaste={handlePaste}
              onRename={handleRename}
              onNewFolder={handleNewFolder}
            />
          )}
        </div>
      )
    }
    
    return (
      <RecentVaultsSection
        recentVaults={recentVaults}
        onOpenVault={onOpenVault}
        onOpenRecentVault={onOpenRecentVault}
      />
    )
  }

  // Main render - multiple vaults mode
  return (
    <div ref={explorerContainerRef} className="flex flex-col h-full" tabIndex={-1}>
      {/* Pinned section */}
      <PinnedFoldersSection
        pinnedFolders={pinnedFolders}
        isExpanded={pinnedSectionExpanded}
        onToggle={togglePinnedSection}
        activeVaultId={activeVaultId}
        connectedVaults={connectedVaults}
        files={files}
        tree={tree}
        onNavigate={async (pinned, vault) => {
          if (pinned.vaultId !== activeVaultId && vault) {
            setFiles([])
            setServerFiles([])
            setFilesLoaded(false)
            
            if (window.electronAPI) {
              const result = await window.electronAPI.setWorkingDir(vault.localPath)
              if (!result.success) {
                addToast('error', `Failed to switch vault: ${result.error}`)
                return
              }
            }
            
            switchVault(pinned.vaultId, vault.localPath)
            
            if (!vault.isExpanded) {
              toggleVaultExpanded(pinned.vaultId)
            }
          }
          
          if (pinned.isDirectory) {
            setCurrentFolder(pinned.path)
          } else {
            const parentPath = pinned.path.split('/').slice(0, -1).join('/') || ''
            setCurrentFolder(parentPath)
          }
        }}
        onUnpin={unpinFolder}
        onReorder={reorderPinnedFolders}
        onRefresh={onRefresh}
        renderTreeItem={renderTreeItem}
      />
      
      {/* Vault list */}
      <div className="flex-1 overflow-y-auto">
        {visibleVaults.map(vault => renderVaultSection(vault))}
        
        {impersonatedUser && effectiveVaultIds.length > 0 && connectedVaults.length > visibleVaults.length && (
          <div className="px-3 py-2 text-xs text-plm-fg-dim italic border-t border-plm-border mt-2">
            {connectedVaults.length - visibleVaults.length} vault{connectedVaults.length - visibleVaults.length !== 1 ? 's' : ''} hidden (no access as {impersonatedUser.full_name || impersonatedUser.email})
          </div>
        )}
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          files={files}
          contextFiles={selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
            ? files.filter(f => selectedFiles.includes(f.path))
            : [contextMenu.file]}
          onClose={() => setContextMenu(null)}
          onRefresh={onRefresh || (() => {})}
          clipboard={clipboard}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onRename={handleRename}
          onNewFolder={handleNewFolder}
        />
      )}
      
      {/* Vault Context Menu */}
      {vaultContextMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setVaultContextMenu(null)}>
          <div
            className="fixed bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: vaultContextMenu.x, top: vaultContextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
              onClick={() => {
                setVaultContextMenu(null)
                const vault = vaultContextMenu.vault
                if (activeVaultId !== vault.id && vault.localPath) {
                  switchVault(vault.id, vault.localPath)
                }
                onRefresh?.(false)
              }}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            {(() => {
              const swFilesInVault = files.filter(f => 
                !f.isDirectory && 
                SOLIDWORKS_EXTENSIONS.includes(f.extension.toLowerCase()) &&
                f.pdmData?.id
              )
              
              if (swFilesInVault.length > 0) {
                return (
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                    onClick={() => {
                      setVaultContextMenu(null)
                      executeCommand('sync-sw-metadata', { files: swFilesInVault }, { onRefresh })
                    }}
                  >
                    <RefreshCw size={14} className="text-plm-accent" />
                    Refresh SW Metadata ({swFilesInVault.length})
                  </button>
                )
              }
              return null
            })()}
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
              onClick={() => {
                if (vaultContextMenu.vault.localPath) {
                  window.electronAPI?.openInExplorer(vaultContextMenu.vault.localPath)
                }
                setVaultContextMenu(null)
              }}
            >
              <FolderOpenIcon size={14} />
              {platform === 'darwin' ? 'Reveal in Finder' : 'Open in Explorer'}
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
              onClick={() => {
                setShowVaultProperties(vaultContextMenu.vault)
                setVaultContextMenu(null)
              }}
            >
              <Info size={14} />
              Properties
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
              onClick={async () => {
                const vault = vaultContextMenu.vault
                setVaultContextMenu(null)
                
                const result = await window.electronAPI?.selectWorkingDir()
                if (result?.success && result.path) {
                  const { updateConnectedVault, setVaultPath, setVaultConnected, addToast } = usePDMStore.getState()
                  updateConnectedVault(vault.id, { localPath: result.path })
                  
                  if (activeVaultId === vault.id) {
                    setVaultPath(result.path)
                    setVaultConnected(true)
                  }
                  
                  addToast('success', `Vault "${vault.name}" path changed to: ${result.path}`)
                }
              }}
            >
              <FolderOpen size={14} />
              Change Path...
            </button>
            <div className="border-t border-plm-border my-1" />
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-warning"
              onClick={() => {
                setDisconnectingVault(vaultContextMenu.vault)
                setVaultContextMenu(null)
              }}
            >
              <Unlink size={14} />
              Disconnect Vault
            </button>
          </div>
        </div>
      )}
      
      {/* Disconnect Vault Confirmation Dialog */}
      {disconnectingVault && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setDisconnectingVault(null)}
        >
          <div 
            className="bg-plm-bg-light border border-plm-warning/50 rounded-xl shadow-2xl w-[480px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-plm-border bg-plm-warning/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-plm-warning/20 rounded-full">
                  <AlertTriangle size={24} className="text-plm-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-plm-fg">Disconnect Vault</h3>
                  <p className="text-sm text-plm-fg-muted">"{disconnectingVault.name}"</p>
                </div>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {(() => {
                const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                const hasBlockingIssues = checkedOutFiles.length > 0 || newFiles.length > 0 || modifiedFiles.length > 0
                
                return (
                  <>
                    {hasBlockingIssues ? (
                      <div className="p-4 bg-plm-error/10 border border-plm-error/30 rounded-lg space-y-3">
                        <p className="text-sm font-medium text-plm-error">
                          You must resolve these issues before disconnecting:
                        </p>
                        
                        {checkedOutFiles.length > 0 && (
                          <div className="bg-plm-bg/50 p-2 rounded">
                            <p className="text-sm text-plm-fg flex items-center gap-2">
                              <span className="w-2 h-2 bg-plm-accent rounded-full"></span>
                              <strong>{checkedOutFiles.length}</strong> file{checkedOutFiles.length !== 1 ? 's' : ''} checked out
                            </p>
                            <p className="text-xs text-plm-fg-muted ml-4">Check in or undo checkout</p>
                          </div>
                        )}
                        
                        {newFiles.length > 0 && (
                          <div className="bg-plm-bg/50 p-2 rounded">
                            <p className="text-sm text-plm-fg flex items-center gap-2">
                              <span className="w-2 h-2 bg-plm-success rounded-full"></span>
                              <strong>{newFiles.length}</strong> new file{newFiles.length !== 1 ? 's' : ''} not synced
                            </p>
                            <p className="text-xs text-plm-fg-muted ml-4">Sync or delete locally</p>
                          </div>
                        )}
                        
                        {modifiedFiles.length > 0 && (
                          <div className="bg-plm-bg/50 p-2 rounded">
                            <p className="text-sm text-plm-fg flex items-center gap-2">
                              <span className="w-2 h-2 bg-plm-warning rounded-full"></span>
                              <strong>{modifiedFiles.length}</strong> modified file{modifiedFiles.length !== 1 ? 's' : ''}
                            </p>
                            <p className="text-xs text-plm-fg-muted ml-4">Check out & check in, or revert</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 bg-plm-success/10 border border-plm-success/30 rounded-lg">
                        <p className="text-sm text-plm-fg flex items-center gap-2">
                          <Check size={16} className="text-plm-success" />
                          All files are synced. Safe to disconnect.
                        </p>
                      </div>
                    )}
                    
                    <p className="text-sm text-plm-fg-muted">
                      {hasBlockingIssues 
                        ? "Close this dialog and resolve the issues above."
                        : "Local files will be deleted. You can reconnect anytime."}
                    </p>
                  </>
                )
              })()}
            </div>
            
            <div className="p-4 border-t border-plm-border bg-plm-bg flex justify-end gap-3">
              <button
                onClick={() => setDisconnectingVault(null)}
                className="btn btn-ghost"
                disabled={isDisconnecting}
              >
                {(() => {
                  const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                  return (checkedOutFiles.length > 0 || newFiles.length > 0 || modifiedFiles.length > 0) ? 'Close' : 'Cancel'
                })()}
              </button>
              {(() => {
                const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                const canDisconnect = checkedOutFiles.length === 0 && newFiles.length === 0 && modifiedFiles.length === 0
                
                return canDisconnect ? (
                  <button
                    onClick={confirmDisconnect}
                    disabled={isDisconnecting}
                    className="btn bg-plm-warning hover:bg-plm-warning/80 text-black disabled:opacity-50 flex items-center gap-2"
                  >
                    {isDisconnecting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      <>
                        <Unlink size={16} />
                        Disconnect
                      </>
                    )}
                  </button>
                ) : null
              })()}
            </div>
          </div>
        </div>
      )}
      
      {/* Vault Properties Modal */}
      {showVaultProperties && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowVaultProperties(null)}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-xl shadow-2xl w-[500px] max-h-[80vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-plm-border bg-plm-bg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-plm-accent/20 rounded-lg vault-icon-bg">
                  <Database size={20} className="vault-icon text-plm-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-plm-fg">{showVaultProperties.name}</h3>
                  <p className="text-xs text-plm-fg-muted">Vault Properties</p>
                </div>
              </div>
              <button
                onClick={() => setShowVaultProperties(null)}
                className="p-1 hover:bg-plm-bg-light rounded text-plm-fg-muted hover:text-plm-fg"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-auto max-h-[60vh]">
              <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Local Path</div>
                <div className="text-sm text-plm-fg break-all font-mono">
                  {showVaultProperties.localPath || 'Not connected locally'}
                </div>
              </div>
              
              {(() => {
                const vaultFiles = files.filter(f => !f.isDirectory)
                const vaultFolders = files.filter(f => f.isDirectory)
                const syncedFiles = vaultFiles.filter(f => !f.diffStatus)
                const modifiedFiles = vaultFiles.filter(f => f.diffStatus === 'modified')
                const addedFiles = vaultFiles.filter(f => f.diffStatus === 'added')
                const cloudFiles = vaultFiles.filter(f => f.diffStatus === 'cloud')
                const conflictFiles = vaultFiles.filter(f => f.diffStatus === 'outdated')
                const checkedOutByMe = vaultFiles.filter(f => f.pdmData?.checked_out_by === user?.id)
                const checkedOutByOthers = vaultFiles.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
                
                const totalLocalSize = vaultFiles
                  .filter(f => f.diffStatus !== 'cloud')
                  .reduce((sum, f) => sum + (f.size || 0), 0)
                
                const formatSize = (bytes: number) => {
                  if (bytes === 0) return '0 B'
                  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
                  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
                  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
                  return `${bytes} B`
                }
                
                return (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 bg-plm-bg rounded-lg border border-plm-border text-center">
                        <div className="text-2xl font-bold text-plm-fg">{vaultFiles.length}</div>
                        <div className="text-xs text-plm-fg-muted">Files</div>
                      </div>
                      <div className="p-3 bg-plm-bg rounded-lg border border-plm-border text-center">
                        <div className="text-2xl font-bold text-plm-fg">{vaultFolders.length}</div>
                        <div className="text-xs text-plm-fg-muted">Folders</div>
                      </div>
                      <div className="p-3 bg-plm-bg rounded-lg border border-plm-border text-center">
                        <div className="text-2xl font-bold text-plm-fg">{formatSize(totalLocalSize)}</div>
                        <div className="text-xs text-plm-fg-muted">Local Size</div>
                      </div>
                    </div>
                    
                    <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                      <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">Sync Status</div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Check size={14} className="text-plm-success" />
                            <span className="text-sm text-plm-fg">Synced</span>
                          </div>
                          <span className="text-sm font-medium text-plm-fg">{syncedFiles.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <RefreshCw size={14} className="text-plm-warning" />
                            <span className="text-sm text-plm-fg">Modified</span>
                          </div>
                          <span className="text-sm font-medium text-plm-fg">{modifiedFiles.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Plus size={14} className="text-plm-accent" />
                            <span className="text-sm text-plm-fg">Local Only</span>
                          </div>
                          <span className="text-sm font-medium text-plm-fg">{addedFiles.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Cloud size={14} className="text-plm-fg-muted" />
                            <span className="text-sm text-plm-fg">Cloud Only</span>
                          </div>
                          <span className="text-sm font-medium text-plm-fg">{cloudFiles.length}</span>
                        </div>
                        {conflictFiles.length > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <AlertTriangle size={14} className="text-plm-error" />
                              <span className="text-sm text-plm-fg">Conflicts</span>
                            </div>
                            <span className="text-sm font-medium text-plm-error">{conflictFiles.length}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                      <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">Checkout Status</div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Lock size={14} className="text-plm-accent" />
                            <span className="text-sm text-plm-fg">Checked out by you</span>
                          </div>
                          <span className="text-sm font-medium text-plm-fg">{checkedOutByMe.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Lock size={14} className="text-plm-warning" />
                            <span className="text-sm text-plm-fg">Checked out by others</span>
                          </div>
                          <span className="text-sm font-medium text-plm-fg">{checkedOutByOthers.length}</span>
                        </div>
                      </div>
                    </div>
                    
                    {(() => {
                      const typeCount = new Map<string, number>()
                      vaultFiles.forEach(f => {
                        const ext = (f.extension || 'other').toLowerCase()
                        typeCount.set(ext, (typeCount.get(ext) || 0) + 1)
                      })
                      
                      const sortedTypes = [...typeCount.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                      
                      if (sortedTypes.length === 0) return null
                      
                      return (
                        <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                          <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">File Types</div>
                          <div className="space-y-1.5">
                            {sortedTypes.map(([ext, count]) => (
                              <div key={ext} className="flex items-center justify-between">
                                <span className="text-sm text-plm-fg">.{ext}</span>
                                <span className="text-sm text-plm-fg-muted">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )
              })()}
            </div>
            
            <div className="p-4 border-t border-plm-border bg-plm-bg flex justify-end">
              <button
                onClick={() => setShowVaultProperties(null)}
                className="btn btn-ghost"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
