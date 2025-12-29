import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { 
  FolderOpen, 
  ChevronRight, 
  ChevronDown,
  Database,
  Lock,
  Cloud,
  Pin,
  Loader2,
  PinOff,
  Unlink,
  FolderOpen as FolderOpenIcon,
  AlertTriangle,
  Check,
  Info,
  RefreshCw,
  Plus,
  X
} from 'lucide-react'
// Shared file/folder components
import { 
  FileIcon,
  FileTypeIcon,
  getFolderCheckoutStatus,
  isFolderSynced,
  getFolderCheckoutUsers,
  type CheckoutUser
} from '../shared/FileItemComponents'
import { getInitials } from '../../types/pdm'
// Shared inline action button components
import { 
  InlineCheckoutButton, 
  InlineDownloadButton, 
  InlineUploadButton, 
  InlineSyncButton,
  InlineCheckinButton,
  InlineStageCheckinButton,
  FolderDownloadButton,
  FolderUploadButton,
  FolderCheckinButton
} from '../InlineActionButtons'
// Use command system for PDM operations
import { executeCommand } from '../../lib/commands'
import { usePDMStore, LocalFile, ConnectedVault } from '../../stores/pdmStore'
import { FileContextMenu } from '../FileContextMenu'

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

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
    getFolderDiffCounts,
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
    renameFileInStore,
    user,
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    lowercaseExtensions,
    processingFolders,
    isLoading,
    filesLoaded,
    addProgressToast,
    updateProgressToast,
    removeToast,
    addProcessingFolder,
    removeProcessingFolder,
    removeConnectedVault,
    setFiles,
    setServerFiles,
    setFilesLoaded,
    setVaultPath,
    setVaultConnected,
    hideSolidworksTempFiles,
    isOfflineMode,
    stageCheckin,
    unstageCheckin,
    getStagedCheckin,
  } = usePDMStore()
  
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
  const [draggingPinIndex, setDraggingPinIndex] = useState<number | null>(null)
  const [dragOverPinIndex, setDragOverPinIndex] = useState<number | null>(null)
  const [expandedPinnedFolders, setExpandedPinnedFolders] = useState<Set<string>>(new Set())
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [isCheckingInAll, setIsCheckingInAll] = useState(false)
  const [isCheckinHovered, setIsCheckinHovered] = useState(false)
  const [isDownloadHovered, setIsDownloadHovered] = useState(false)
  const [isUploadHovered, setIsUploadHovered] = useState(false)
  const [isCheckoutHovered, setIsCheckoutHovered] = useState(false)
  const [isUpdateHovered, setIsUpdateHovered] = useState(false)
  const [isCheckingInMyCheckouts, setIsCheckingInMyCheckouts] = useState(false)
  // State for re-render triggers, ref for synchronous access during drag events
  const [, setDraggedFiles] = useState<LocalFile[]>([])
  const draggedFilesRef = useRef<LocalFile[]>([])
  
  // Calculate selected files that can be checked in (for multi-select check-in feature)
  const selectedCheckinableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      f.pdmData?.checked_out_by === user?.id
    )
  }, [files, selectedFiles, user?.id])

  // Calculate selected files that can be downloaded (for multi-select download feature)
  // Includes cloud files (to download) and outdated files (to update)
  const selectedDownloadableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new' || f.diffStatus === 'outdated')
    )
  }, [files, selectedFiles])

  // Calculate selected files that can be uploaded (for multi-select upload feature)
  const selectedUploadableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added') && 
      f.diffStatus !== 'cloud'
    )
  }, [files, selectedFiles])

  // Calculate selected files that can be checked out (for multi-select checkout feature)
  const selectedCheckoutableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(f => 
      selectedFiles.includes(f.path) && 
      !f.isDirectory && 
      f.pdmData && 
      !f.pdmData.checked_out_by && 
      f.diffStatus !== 'cloud'
    )
  }, [files, selectedFiles])

  // Calculate selected files that can be updated (for multi-select update feature)
  // These are outdated files (local file exists but server has newer version)
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
  
  // Switch to a different vault - updates working directory and triggers reload via App.tsx effect
  // Note: This doesn't toggle expansion - that's handled by the click handler
  const switchToVault = async (vault: ConnectedVault) => {
    console.log('[VaultSwitch] Switching to vault:', { 
      vaultId: vault.id, 
      vaultName: vault.name, 
      localPath: vault.localPath,
      previousActiveId: activeVaultId 
    })
    
    // If clicking same vault, just navigate to root
    if (vault.id === activeVaultId) {
      setCurrentFolder('') // Go to root
      return
    }
    
    // Clear existing file state to avoid stale data showing under wrong vault
    console.log('[VaultSwitch] Clearing files')
    setFiles([])
    setServerFiles([])
    setFilesLoaded(false)
    
    // Tell Electron to switch the working directory FIRST (before state updates)
    // This ensures listWorkingFiles() reads from the correct directory
    if (window.electronAPI) {
      console.log('[VaultSwitch] Setting working directory to:', vault.localPath)
      const result = await window.electronAPI.setWorkingDir(vault.localPath)
      if (!result.success) {
        addToast('error', `Failed to switch vault: ${result.error}`)
        return
      }
    }
    
    // Now update state ATOMICALLY - this triggers the loadFiles effect in App.tsx
    // Using switchVault ensures both activeVaultId and vaultPath update together
    // so the loadKey change triggers a fresh load with correct values
    console.log('[VaultSwitch] Updating state atomically - vaultPath:', vault.localPath, 'activeVaultId:', vault.id)
    switchVault(vault.id, vault.localPath)
    setCurrentFolder('') // Go to root
    
    // DON'T call onRefresh() here - the useEffect in App.tsx will detect
    // the loadKey change and call loadFiles() with the CORRECT updated state
    console.log('[VaultSwitch] State update complete, waiting for effect to trigger loadFiles')
  }
  
  // @ts-ignore - Reserved for future use
  const handleDelete = async (file: LocalFile) => {
    const result = await window.electronAPI?.deleteItem(file.path)
    if (result?.success) {
      addToast('success', `Deleted ${file.name}`)
      onRefresh?.(true)
    } else {
      addToast('error', 'Failed to delete')
    }
  }
  
  // Get files that need attention before disconnect
  const getDisconnectWarnings = () => {
    const checkedOutFiles = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id)
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
    
    // Delete local folder
    let folderDeleted = false
    if (disconnectingVault.localPath) {
      const api = window.electronAPI
      if (api) {
        try {
          // Stop file watcher first
          await api.clearWorkingDir()
          await new Promise(resolve => setTimeout(resolve, 200))
          
          const result = await api.deleteItem(disconnectingVault.localPath)
          if (result.success) {
            folderDeleted = true
          } else {
            console.error('Failed to delete local folder:', result.error)
            addToast('warning', `Could not delete local folder: ${result.error}`)
          }
        } catch (err) {
          console.error('Failed to delete local folder:', err)
          addToast('warning', `Could not delete local folder: ${err}`)
        }
      }
    }
    
    // Clear file state if this was the active vault
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
    
    // Check if file can be renamed (unsynced files can always be renamed, synced files need checkout)
    const isSynced = !!file.pdmData
    const isCheckedOutByMe = file.pdmData?.checked_out_by === user?.id
    const canRename = !isSynced || isCheckedOutByMe
    
    // Slow double click: 400-1500ms between clicks on same file
    if (isSameFile && timeDiff > 400 && timeDiff < 1500 && !file.isDirectory && canRename) {
      // Start rename
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
    
    // Use command system for rename (handles both local and server)
    await executeCommand('rename', { file: renamingFile, newName }, { onRefresh })
    setRenamingFile(null)
  }
  
  const handleCopy = () => {
    if (!contextMenu?.file) return
    
    // Get files to copy - use multiple selection if applicable
    const filesToCopy = selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
      ? files.filter(f => selectedFiles.includes(f.path))
      : [contextMenu.file]
    
    setClipboard({ files: filesToCopy, operation: 'copy' })
    addToast('info', `Copied ${filesToCopy.length} item${filesToCopy.length > 1 ? 's' : ''}`)
  }
  
  const handleCut = () => {
    if (!contextMenu?.file) return
    
    // Get files to cut - use multiple selection if applicable
    const filesToCut = selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
      ? files.filter(f => selectedFiles.includes(f.path))
      : [contextMenu.file]
    
    // Check if all files can be cut - need checkout for synced files
    // Can cut if: directory, unsynced (local-only), or checked out by current user
    const notAllowed = filesToCut.filter(f => 
      !f.isDirectory && 
      f.pdmData && 
      f.pdmData.checked_out_by !== user?.id
    )
    
    if (notAllowed.length > 0) {
      const checkedOutByOthers = notAllowed.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
      const notCheckedOut = notAllowed.filter(f => !f.pdmData?.checked_out_by)
      
      if (checkedOutByOthers.length > 0) {
        addToast('error', `Cannot move: ${checkedOutByOthers.length} file${checkedOutByOthers.length > 1 ? 's are' : ' is'} checked out by others`)
      } else if (notCheckedOut.length > 0) {
        addToast('error', `Cannot move: ${notCheckedOut.length} file${notCheckedOut.length > 1 ? 's are' : ' is'} not checked out. Check out first to move.`)
      }
      return
    }
    
    setClipboard({ files: filesToCut, operation: 'cut' })
    addToast('info', `Cut ${filesToCut.length} item${filesToCut.length > 1 ? 's' : ''}`)
  }
  
  const handlePaste = async () => {
    if (!clipboard || !contextMenu?.file || !vaultPath) return
    
    // Get target folder relative path
    const targetFolderRelPath = contextMenu.file.isDirectory 
      ? contextMenu.file.relativePath 
      : contextMenu.file.relativePath.substring(0, contextMenu.file.relativePath.lastIndexOf('/'))
    
    if (clipboard.operation === 'cut') {
      // Move operation - use move command (handles server path updates)
      await executeCommand('move', { 
        files: clipboard.files, 
        targetFolder: targetFolderRelPath 
      }, { onRefresh, silent: true })
      setClipboard(null) // Clear clipboard after cut
    } else {
      // Copy operation - use copy command
      await executeCommand('copy', { 
        files: clipboard.files, 
        targetFolder: targetFolderRelPath 
      }, { onRefresh, silent: true })
    }
  }
  
  const handleRename = (file: LocalFile) => {
    // Use a simple prompt for rename
    const newName = window.prompt('Enter new name:', file.name)
    if (newName && newName !== file.name) {
      // Use command system for rename (handles both local and server)
      executeCommand('rename', { file, newName }, { onRefresh })
    }
  }
  
  const handleNewFolder = async () => {
    if (!contextMenu?.file || !vaultPath) return
    
    // Get parent path (relative path)
    const parentPath = contextMenu.file.isDirectory 
      ? contextMenu.file.relativePath 
      : contextMenu.file.relativePath.substring(0, contextMenu.file.relativePath.lastIndexOf('/'))
    
    const folderName = window.prompt('Enter folder name:', 'New Folder')
    if (folderName) {
      // Use command system for new folder
      await executeCommand('new-folder', { parentPath, folderName }, { onRefresh })
    }
  }

  // Build folder tree structure
  const buildTree = () => {
    const tree: { [key: string]: LocalFile[] } = { '': [] }
    
    // Filter out any undefined or invalid files and optionally hide SolidWorks temp files
    const validFiles = files.filter(f => {
      if (!f || !f.relativePath || !f.name) return false
      // Hide SolidWorks temp lock files (~$filename.sldxxx) when setting is enabled
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      return true
    })
    
    validFiles.forEach(file => {
      const parts = file.relativePath.split('/')
      if (parts.length === 1) {
        tree[''].push(file)
      } else {
        const parentPath = parts.slice(0, -1).join('/')
        if (!tree[parentPath]) {
          tree[parentPath] = []
        }
        tree[parentPath].push(file)
      }
    })
    
    return tree
  }

  const tree = buildTree()

  // Get flattened list of visible files for keyboard navigation
  const getVisibleFiles = useCallback((): LocalFile[] => {
    const result: LocalFile[] = []
    const addFiles = (items: LocalFile[]) => {
      for (const item of items) {
        result.push(item)
        if (item.isDirectory && expandedFolders.has(item.relativePath)) {
          const children = tree[item.relativePath] || []
          addFiles(children.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          }))
        }
      }
    }
    addFiles((tree[''] || []).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    }))
    return result
  }, [tree, expandedFolders])

  // Ref for the explorer view container to check if it's focused
  const explorerContainerRef = useRef<HTMLDivElement>(null)
  
  // Keyboard navigation for tree view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when not typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      // Only handle if the explorer view contains the active element or was recently clicked
      // This prevents conflicts with the main FileBrowser keyboard handler
      if (!explorerContainerRef.current?.contains(document.activeElement) && 
          !explorerContainerRef.current?.contains(e.target as Node)) {
        return
      }
      
      // Only handle arrow keys without modifiers (except shift for range selection)
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return
      
      const visibleFiles = getVisibleFiles()
      if (visibleFiles.length === 0) return
      
      // ArrowUp/ArrowDown - move selection up/down, Shift+Arrow extends selection
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        
        const isUp = e.key === 'ArrowUp'
        const isShift = e.shiftKey
        
        // Find the "focus" index - where the keyboard cursor currently is
        const focusIndex = selectedFiles.length > 0 
          ? visibleFiles.findIndex(f => f.path === selectedFiles[selectedFiles.length - 1])
          : -1
        
        // If current selection is not in view, select first or last based on direction
        if (focusIndex === -1) {
          const newIndex = isUp ? visibleFiles.length - 1 : 0
          setSelectedFiles([visibleFiles[newIndex].path])
          setLastClickedIndex(newIndex)
          return
        }
        
        // Calculate new index based on direction
        let newIndex: number
        if (isUp) {
          newIndex = Math.max(0, focusIndex - 1)
        } else {
          newIndex = Math.min(visibleFiles.length - 1, focusIndex + 1)
        }
        
        // Only update if index actually changed
        if (newIndex !== focusIndex) {
          if (isShift) {
            // Shift held - extend selection from anchor (lastClickedIndex) to new position
            const anchorIndex = lastClickedIndex ?? focusIndex
            const start = Math.min(anchorIndex, newIndex)
            const end = Math.max(anchorIndex, newIndex)
            const rangePaths = visibleFiles.slice(start, end + 1).map(f => f.path)
            setSelectedFiles(rangePaths)
            // Don't update lastClickedIndex - it's the anchor
          } else {
            // No shift - single selection
            setSelectedFiles([visibleFiles[newIndex].path])
            setLastClickedIndex(newIndex)
          }
        }
        return
      }
      
      // ArrowRight - expand folder or do nothing for files
      if (e.key === 'ArrowRight') {
        if (selectedFiles.length !== 1) return
        
        const selectedFile = visibleFiles.find(f => f.path === selectedFiles[0])
        if (!selectedFile?.isDirectory) return
        
        e.preventDefault()
        e.stopPropagation()
        
        if (!expandedFolders.has(selectedFile.relativePath)) {
          // Expand the folder
          toggleFolder(selectedFile.relativePath)
        }
        return
      }
      
      // ArrowLeft - collapse folder or select parent
      if (e.key === 'ArrowLeft') {
        if (selectedFiles.length !== 1) return
        
        const selectedFile = visibleFiles.find(f => f.path === selectedFiles[0])
        if (!selectedFile) return
        
        e.preventDefault()
        e.stopPropagation()
        
        // If it's an expanded folder, collapse it
        if (selectedFile.isDirectory && expandedFolders.has(selectedFile.relativePath)) {
          toggleFolder(selectedFile.relativePath)
          return
        }
        
        // Otherwise, select the parent folder
        const parentPath = selectedFile.relativePath.includes('/') 
          ? selectedFile.relativePath.substring(0, selectedFile.relativePath.lastIndexOf('/'))
          : ''
        
        if (parentPath) {
          // Find parent folder in visible files
          const parentFile = visibleFiles.find(f => f.relativePath === parentPath && f.isDirectory)
          if (parentFile) {
            const parentIndex = visibleFiles.indexOf(parentFile)
            setSelectedFiles([parentFile.path])
            setLastClickedIndex(parentIndex)
          }
        }
        return
      }
      
      // Enter - open file or toggle folder expansion
      if (e.key === 'Enter') {
        if (selectedFiles.length !== 1) return
        
        const selectedFile = visibleFiles.find(f => f.path === selectedFiles[0])
        if (!selectedFile) return
        
        e.preventDefault()
        e.stopPropagation()
        
        if (selectedFile.isDirectory) {
          // Toggle folder expansion
          toggleFolder(selectedFile.relativePath)
        } else if (window.electronAPI) {
          // Open file
          window.electronAPI.openFile(selectedFile.path)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [getVisibleFiles, selectedFiles, setSelectedFiles, expandedFolders, toggleFolder])

  // Wrapper for shared isFolderSynced using local files
  // Must filter out temp files when setting is enabled to match tree view
  const checkFolderSynced = (folderPath: string): boolean => {
    const filteredFiles = hideSolidworksTempFiles 
      ? files.filter(f => !f.name.startsWith('~$'))
      : files
    return isFolderSynced(folderPath, filteredFiles)
  }

  // Wrapper for shared getFolderCheckoutStatus using local files  
  const checkFolderCheckoutStatus = (folderPath: string) => {
    return getFolderCheckoutStatus(folderPath, files, user?.id)
  }

  // Check if a file/folder is affected by any processing operation
  const isBeingProcessed = (relativePath: string) => {
    // Normalize path to use forward slashes for consistent comparison
    const normalizedPath = relativePath.replace(/\\/g, '/')
    
    // Check if this exact path is being processed
    if (processingFolders.has(relativePath)) return true
    if (processingFolders.has(normalizedPath)) return true
    
    // Check if any parent folder is being processed
    for (const processingPath of processingFolders) {
      const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return true
    }
    return false
  }

  // Inline action: Download a single file or get latest (uses command system)
  // Uses 'download' for cloud-only files and 'get-latest' for outdated files
  // Supports multi-select: if clicking a selected file's download, downloads all selected files that can be downloaded
  const handleInlineDownload = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    
    // Check if this is a multi-select download
    const isMultiSelect = selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1
    
    if (isMultiSelect) {
      // Multi-select: download all selected downloadable files
      const outdatedFiles = selectedDownloadableFiles.filter(f => f.diffStatus === 'outdated')
      const cloudFiles = selectedDownloadableFiles.filter(f => f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new')
      
      if (outdatedFiles.length > 0) {
        executeCommand('get-latest', { files: outdatedFiles }, { onRefresh })
      }
      if (cloudFiles.length > 0) {
        executeCommand('download', { files: cloudFiles }, { onRefresh })
      }
      setIsDownloadHovered(false)
      setIsUpdateHovered(false)
      return
    }
    
    // Single file/folder handling
    // For folders, check if they contain outdated files and use appropriate command
    if (file.isDirectory) {
      const filesInFolder = files.filter(f => f.relativePath.startsWith(file.relativePath + '/'))
      const hasOutdated = filesInFolder.some(f => f.diffStatus === 'outdated')
      const hasCloud = filesInFolder.some(f => f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new')
      
      // Execute both commands if folder has both types
      if (hasOutdated) {
        executeCommand('get-latest', { files: [file] }, { onRefresh })
      }
      if (hasCloud || file.diffStatus === 'cloud') {
        executeCommand('download', { files: [file] }, { onRefresh })
      }
      return
    }
    
    // For individual files, use the appropriate command
    if (file.diffStatus === 'outdated') {
      executeCommand('get-latest', { files: [file] }, { onRefresh })
    } else {
      executeCommand('download', { files: [file] }, { onRefresh })
    }
    setIsDownloadHovered(false)
    setIsUpdateHovered(false)
  }
  
  // Download all cloud files in the vault (uses command system)
  const handleDownloadAllCloudFiles = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDownloadingAll) return
    
    // Include both 'cloud' and 'cloud_new' to match what the download command processes
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
  
  // Update all outdated files in the vault (uses get-latest command)
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

  // First check in all local-only files in the vault (uses command system)
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

  // Check in all files checked out by me (uses command system)
  const handleCheckInMyCheckouts = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCheckingInMyCheckouts) return
    
    const { user } = usePDMStore.getState()
    const myCheckedOutFiles = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id)
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

  // Check out all synced files that are ready to checkout (uses command system)
  const handleCheckoutAllSynced = async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    const syncedFiles = files.filter(f => !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check out')
      return
    }
    
    await executeCommand('checkout', { files: syncedFiles }, { onRefresh })
  }

  // Inline action: Check out a single file or folder (uses command system)
  // Supports multi-select: if clicking a selected file's checkout, checks out all selected files that can be checked out
  const handleInlineCheckout = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    
    // Check if this is a multi-select checkout
    const isMultiSelect = selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1
    const targetFiles = isMultiSelect ? selectedCheckoutableFiles : [file]
    
    executeCommand('checkout', { files: targetFiles }, { onRefresh })
    setIsCheckoutHovered(false)
  }

  // Inline action: Check in a single file or folder (uses command system)
  // Supports multi-select: if clicking a selected file's check-in, checks in all selected files that can be checked in
  const handleInlineCheckin = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    
    // Check if this is a multi-select check-in
    const isMultiSelect = selectedFiles.includes(file.path) && selectedCheckinableFiles.length > 1
    const targetFiles = isMultiSelect ? selectedCheckinableFiles : [file]
    
    executeCommand('checkin', { files: targetFiles }, { onRefresh })
    
    // Reset hover state
    setIsCheckinHovered(false)
  }

  // Inline action: First check in (upload) a single file or folder (uses command system)
  // Supports multi-select: if clicking a selected file's upload, uploads all selected files that can be uploaded
  const handleInlineFirstCheckin = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    
    // Check if this is a multi-select upload
    const isMultiSelect = selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1
    const targetFiles = isMultiSelect ? selectedUploadableFiles : [file]
    
    executeCommand('sync', { files: targetFiles }, { onRefresh })
    setIsUploadHovered(false)
  }

  // Stage/unstage a file for check-in when back online (offline mode feature)
  const handleStageCheckin = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    
    const existingStaged = getStagedCheckin(file.relativePath)
    
    if (existingStaged) {
      // Unstage the file
      unstageCheckin(file.relativePath)
      addToast('info', `Unstaged "${file.name}" from check-in queue`)
    } else {
      // Stage the file for check-in
      stageCheckin({
        relativePath: file.relativePath,
        fileName: file.name,
        localHash: file.localHash || '',
        stagedAt: new Date().toISOString(),
        serverVersion: file.pdmData?.version,
        serverHash: file.pdmData?.content_hash || undefined
      })
      addToast('success', `Staged "${file.name}" for check-in when online`)
    }
  }

  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      // Check if folder is being processed (downloading/deleting) or is inside a processing folder
      if (isBeingProcessed(file.relativePath)) {
        return <Loader2 size={16} className="text-sky-400 animate-spin" />
      }
      // Cloud-only folders (exist on server but not locally) - muted color, no opacity (text handles dimming)
      if (file.diffStatus === 'cloud') {
        return <FolderOpen size={16} className="text-plm-fg-muted" />
      }
      const checkoutStatus = checkFolderCheckoutStatus(file.relativePath)
      if (checkoutStatus === 'others' || checkoutStatus === 'both') {
        // Red for folders with files checked out by others
        return <FolderOpen size={16} className="text-plm-error" />
      }
      if (checkoutStatus === 'mine') {
        // Vibrant orange for folders with only my checkouts (matches lock icon)
        return <FolderOpen size={16} className="text-orange-400" />
      }
      const synced = checkFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-plm-success' : 'text-plm-fg-muted'} />
    }
    
    // Check if file is inside a processing folder
    if (isBeingProcessed(file.relativePath)) {
      return <Loader2 size={16} className="text-sky-400 animate-spin" />
    }
    
    // Use shared FileIcon for files (includes thumbnail support)
    return <FileIcon file={file} size={16} />
  }
  
  // Wrapper for shared getFolderCheckoutUsers using local files and user
  const getCheckoutUsersForFolder = (folderPath: string): CheckoutUser[] => {
    return getFolderCheckoutUsers(
      folderPath, 
      files, 
      user?.id, 
      user?.full_name || undefined, 
      user?.email || undefined, 
      user?.avatar_url || undefined
    )
  }

  // Check if files can be moved (all synced files must be checked out by user)
  const canMoveFiles = (filesToCheck: LocalFile[]): boolean => {
    for (const file of filesToCheck) {
      if (file.isDirectory) {
        // For folders, check if any synced files inside are not checked out by user
        const filesInFolder = files.filter(f => 
          !f.isDirectory && 
          f.relativePath.startsWith(file.relativePath + '/') &&
          f.pdmData?.id && // Is synced
          f.pdmData.checked_out_by !== user?.id // Not checked out by me
        )
        if (filesInFolder.length > 0) return false
      } else if (file.pdmData?.id && file.pdmData.checked_out_by !== user?.id) {
        // Synced file not checked out by current user
        return false
      }
    }
    return true
  }

  // Note: folder drag over logic is now inlined in onDragOver handler for all tree items
  // This ensures preventDefault is called even when dragging over non-folder items

  // Handle drag leave from a folder
  const handleExplorerFolderDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
  }

  // Handle drop onto a folder in explorer
  const handleExplorerDropOnFolder = async (e: React.DragEvent, targetFolder: LocalFile) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
    
    if (!window.electronAPI || !vaultPath) return
    
    // Check for external files first (from outside the app)
    const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
    const droppedExternalFiles = Array.from(e.dataTransfer.files)
    
    if (droppedExternalFiles.length > 0 && !hasPdmFiles) {
      // Handle external file drop onto this folder
      const filePaths: string[] = []
      for (const file of droppedExternalFiles) {
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
        addToast('error', 'Could not get file paths')
        return
      }

      // Copy external files to the target folder
      const totalFiles = filePaths.length
      const toastId = `drop-files-${Date.now()}`
      addProgressToast(toastId, `Adding ${totalFiles} file${totalFiles > 1 ? 's' : ''} to ${targetFolder.name}...`, totalFiles)

      try {
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < filePaths.length; i++) {
          const sourcePath = filePaths[i]
          const fileName = sourcePath.split(/[/\\]/).pop() || 'unknown'
          const destPath = buildFullPath(vaultPath, targetFolder.relativePath + '/' + fileName)

          console.log('[Explorer Drop on Folder] Copying:', sourcePath, '->', destPath)

          const result = await window.electronAPI.copyFile(sourcePath, destPath)
          if (result.success) {
            successCount++
          } else {
            errorCount++
            console.error(`Failed to copy ${fileName}:`, result.error)
          }
          
          // Update progress
          const percent = Math.round(((i + 1) / totalFiles) * 100)
          updateProgressToast(toastId, i + 1, percent)
        }

        removeToast(toastId)
        
        if (errorCount === 0) {
          addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''} to ${targetFolder.name}`)
        } else {
          addToast('warning', `Added ${successCount}, failed ${errorCount}`)
        }

        // Refresh the file list
        setTimeout(() => onRefresh?.(), 100)
      } catch (err) {
        console.error('Error adding files:', err)
        removeToast(toastId)
        addToast('error', 'Failed to add files')
      }
      return
    }
    
    // Get files from data transfer or local state (use ref for synchronous access)
    let filesToMove: LocalFile[] = []
    const currentDraggedFiles = draggedFilesRef.current
    
    if (currentDraggedFiles.length > 0) {
      filesToMove = currentDraggedFiles
      draggedFilesRef.current = []
      setDraggedFiles([])
    } else {
      // Try to get from data transfer (cross-view drag)
      const pdmFilesData = e.dataTransfer.getData('application/x-plm-files')
      if (pdmFilesData) {
        try {
          const relativePaths: string[] = JSON.parse(pdmFilesData)
          filesToMove = files.filter(f => relativePaths.includes(f.relativePath))
        } catch (err) {
          console.error('Failed to parse drag data:', err)
          return
        }
      }
    }
    
    if (filesToMove.length === 0) return
    
    // Validate the drop
    const isDroppingIntoSelf = filesToMove.some(f => 
      f.isDirectory && (targetFolder.relativePath === f.relativePath || targetFolder.relativePath.startsWith(f.relativePath + '/'))
    )
    if (isDroppingIntoSelf) {
      addToast('error', 'Cannot move a folder into itself')
      return
    }
    
    // Check that all synced files are checked out by the current user
    const notCheckedOut: string[] = []
    for (const file of filesToMove) {
      if (file.isDirectory) {
        const filesInFolder = files.filter(f => 
          !f.isDirectory && 
          f.relativePath.startsWith(file.relativePath + '/') &&
          f.pdmData?.id &&
          f.pdmData.checked_out_by !== user?.id
        )
        if (filesInFolder.length > 0) {
          notCheckedOut.push(`${file.name} (contains ${filesInFolder.length} file${filesInFolder.length > 1 ? 's' : ''} not checked out)`)
        }
      } else if (file.pdmData?.id && file.pdmData.checked_out_by !== user?.id) {
        notCheckedOut.push(file.name)
      }
    }
    
    if (notCheckedOut.length > 0) {
      addToast('error', `Cannot move - check out first: ${notCheckedOut.slice(0, 3).join(', ')}${notCheckedOut.length > 3 ? ` (+${notCheckedOut.length - 3} more)` : ''}`)
      return
    }
    
    let succeeded = 0
    let failed = 0
    
    for (const file of filesToMove) {
      const sourcePath = file.path
      const fileName = file.name
      const destPath = buildFullPath(vaultPath, targetFolder.relativePath + '/' + fileName)
      
      try {
        const result = await window.electronAPI.moveFile(sourcePath, destPath)
        if (result.success) {
          succeeded++
        } else {
          failed++
          console.error(`Failed to move ${fileName}:`, result.error)
        }
      } catch (err) {
        failed++
        console.error(`Failed to move ${fileName}:`, err)
      }
    }
    
    if (failed === 0) {
      addToast('success', `Moved ${succeeded} item${succeeded > 1 ? 's' : ''} to ${targetFolder.name}`)
    } else if (succeeded > 0) {
      addToast('warning', `Moved ${succeeded}, failed ${failed}`)
    } else {
      addToast('error', 'Failed to move items')
    }
    
    onRefresh?.(true)
  }

  // Handle drag end
  const handleExplorerDragEnd = () => {
    draggedFilesRef.current = []
    setDraggedFiles([])
    setDragOverFolder(null)
  }
  
  // Handle dropping into the vault root area (empty space or anywhere not on a folder)
  const handleVaultRootDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    // Check if we have pdm files being dragged (use ref for synchronous access)
    const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
    const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
    const currentDraggedFiles = draggedFilesRef.current
    
    // Only highlight if not already over a specific folder
    if (!dragOverFolder) {
      if (hasPdmFiles || currentDraggedFiles.length > 0) {
        e.dataTransfer.dropEffect = 'move'
        // Use empty string to indicate root
        setDragOverFolder('')
      } else if (hasExternalFiles) {
        e.dataTransfer.dropEffect = 'copy'
        // Use empty string to indicate root
        setDragOverFolder('')
      }
    }
  }
  
  const handleVaultRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    // Only clear if we're leaving to somewhere outside the tree
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      if (dragOverFolder === '') {
        setDragOverFolder(null)
      }
    }
  }
  
  const handleVaultRootDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
    
    if (!window.electronAPI || !vaultPath) return
    
    // Check for external files first (from outside the app)
    const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
    const droppedExternalFiles = Array.from(e.dataTransfer.files)
    
    if (droppedExternalFiles.length > 0 && !hasPdmFiles) {
      // Handle external file drop to vault root
      const filePaths: string[] = []
      for (const file of droppedExternalFiles) {
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
        addToast('error', 'Could not get file paths')
        return
      }

      // Copy external files to vault root
      const totalFiles = filePaths.length
      const toastId = `drop-files-root-${Date.now()}`
      addProgressToast(toastId, `Adding ${totalFiles} file${totalFiles > 1 ? 's' : ''} to vault root...`, totalFiles)

      try {
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < filePaths.length; i++) {
          const sourcePath = filePaths[i]
          const fileName = sourcePath.split(/[/\\]/).pop() || 'unknown'
          const destPath = buildFullPath(vaultPath, fileName)

          console.log('[Explorer Drop to Root] Copying:', sourcePath, '->', destPath)

          const result = await window.electronAPI.copyFile(sourcePath, destPath)
          if (result.success) {
            successCount++
          } else {
            errorCount++
            console.error(`Failed to copy ${fileName}:`, result.error)
          }
          
          // Update progress
          const percent = Math.round(((i + 1) / totalFiles) * 100)
          updateProgressToast(toastId, i + 1, percent)
        }

        removeToast(toastId)
        
        if (errorCount === 0) {
          addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''} to vault root`)
        } else {
          addToast('warning', `Added ${successCount}, failed ${errorCount}`)
        }

        // Refresh the file list
        setTimeout(() => onRefresh?.(), 100)
      } catch (err) {
        console.error('Error adding files:', err)
        removeToast(toastId)
        addToast('error', 'Failed to add files')
      }
      return
    }
    
    // Get files from data transfer or local state (use ref for synchronous access)
    let filesToMove: LocalFile[] = []
    const currentDraggedFiles = draggedFilesRef.current
    
    if (currentDraggedFiles.length > 0) {
      filesToMove = currentDraggedFiles
      draggedFilesRef.current = []
      setDraggedFiles([])
    } else {
      const pdmFilesData = e.dataTransfer.getData('application/x-plm-files')
      if (pdmFilesData) {
        try {
          const relativePaths: string[] = JSON.parse(pdmFilesData)
          filesToMove = files.filter(f => relativePaths.includes(f.relativePath))
        } catch (err) {
          console.error('Failed to parse drag data:', err)
          return
        }
      }
    }
    
    if (filesToMove.length === 0) return
    
    // Don't move if already in root
    const allInRoot = filesToMove.every(f => !f.relativePath.includes('/'))
    if (allInRoot) return
    
    // Check that all synced files are checked out
    const notCheckedOut: string[] = []
    for (const file of filesToMove) {
      if (file.isDirectory) {
        const filesInFolder = files.filter(f => 
          !f.isDirectory && 
          f.relativePath.startsWith(file.relativePath + '/') &&
          f.pdmData?.id &&
          f.pdmData.checked_out_by !== user?.id
        )
        if (filesInFolder.length > 0) {
          notCheckedOut.push(`${file.name} (contains files not checked out)`)
        }
      } else if (file.pdmData?.id && file.pdmData.checked_out_by !== user?.id) {
        notCheckedOut.push(file.name)
      }
    }
    
    if (notCheckedOut.length > 0) {
      addToast('error', `Cannot move: ${notCheckedOut.slice(0, 2).join(', ')}${notCheckedOut.length > 2 ? ` +${notCheckedOut.length - 2} more` : ''} not checked out`)
      return
    }
    
    // Perform the moves to root
    const total = filesToMove.length
    const toastId = `move-root-${Date.now()}`
    addProgressToast(toastId, `Moving ${total} item${total > 1 ? 's' : ''} to root...`, total)
    
    let succeeded = 0
    let failed = 0
    
    for (let i = 0; i < filesToMove.length; i++) {
      const file = filesToMove[i]
      const newRelPath = file.name // Just the filename, no folder
      const newFullPath = buildFullPath(vaultPath, newRelPath)
      
      addProcessingFolder(file.relativePath)
      
      try {
        const result = await window.electronAPI.moveFile(file.path, newFullPath)
        if (result.success) {
          succeeded++
          renameFileInStore(file.path, newFullPath, newRelPath, true)
        } else {
          failed++
        }
      } catch {
        failed++
      }
      
      removeProcessingFolder(file.relativePath)
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
    }
    
    removeToast(toastId)
    
    if (failed === 0) {
      addToast('success', `Moved ${succeeded} item${succeeded > 1 ? 's' : ''} to root`)
    } else if (succeeded === 0) {
      addToast('error', 'Failed to move items')
    } else {
      addToast('warning', `Moved ${succeeded}, failed ${failed}`)
    }
    
    // No need for full refresh - store is already updated
  }

  const renderTreeItem = (file: LocalFile, depth: number = 0) => {
    const isExpanded = expandedFolders.has(file.relativePath)
    const isCurrentFolder = file.isDirectory && file.relativePath === currentFolder
    const children = tree[file.relativePath] || []
    
    // Get diff counts for folders (for cloud count display)
    const diffCounts = file.isDirectory ? getFolderDiffCounts(file.relativePath) : null
    
    // Get local-only (unsynced) files count for folders
    // Must match the tree filtering (exclude temp files when setting enabled)
    // and include deleted_remote files (orphaned local files)
    const localOnlyCount = file.isDirectory ? files.filter(f => 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') && 
      f.diffStatus !== 'cloud' && 
      f.diffStatus !== 'ignored' &&
      f.relativePath.startsWith(file.relativePath + '/') &&
      // Exclude temp files when hide setting is enabled (must match tree filtering)
      !(hideSolidworksTempFiles && f.name.startsWith('~$'))
    ).length : 0
    
    // Get checkout info for folders
    const folderCheckoutUsers = file.isDirectory ? getCheckoutUsersForFolder(file.relativePath) : []
    const folderCheckedOutByMeCount = file.isDirectory ? files.filter(f => 
      !f.isDirectory && 
      f.pdmData?.checked_out_by === user?.id &&
      f.relativePath.startsWith(file.relativePath + '/')
    ).length : 0
    const folderTotalCheckouts = file.isDirectory ? files.filter(f => 
      !f.isDirectory && 
      f.pdmData?.checked_out_by &&
      f.relativePath.startsWith(file.relativePath + '/')
    ).length : 0
    // Count synced files that can be checked out
    const folderSyncedCount = file.isDirectory ? files.filter(f => 
      !f.isDirectory && 
      f.pdmData && !f.pdmData.checked_out_by &&
      f.diffStatus !== 'cloud' &&
      f.relativePath.startsWith(file.relativePath + '/')
    ).length : 0
    
    // Diff class for files and deleted folders
    const diffClass = file.diffStatus 
      ? `sidebar-diff-${file.diffStatus}` : ''

    const isSelected = selectedFiles.includes(file.path)
    const isRenaming = renamingFile?.relativePath === file.relativePath
    const isProcessing = isBeingProcessed(file.relativePath)
    const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath
    const isCut = clipboard?.operation === 'cut' && clipboard.files.some(f => f.path === file.path)

    return (
      <div key={file.path}>
        <div
          className={`tree-item group ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''} ${isCut ? 'opacity-50' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={(e) => {
            if (isRenaming) return
            
            // Prevent text selection on shift+click
            if (e.shiftKey) {
              e.preventDefault()
            }
            
            // Get flattened list of visible files for range selection
            const getVisibleFiles = (): LocalFile[] => {
              const result: LocalFile[] = []
              const addFiles = (items: LocalFile[]) => {
                for (const item of items) {
                  result.push(item)
                  if (item.isDirectory && expandedFolders.has(item.relativePath)) {
                    const children = tree[item.relativePath] || []
                    addFiles(children.sort((a, b) => {
                      if (a.isDirectory && !b.isDirectory) return -1
                      if (!a.isDirectory && b.isDirectory) return 1
                      return a.name.localeCompare(b.name)
                    }))
                  }
                }
              }
              addFiles((tree[''] || []).sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              }))
              return result
            }
            
            const visibleFiles = getVisibleFiles()
            const currentIndex = visibleFiles.findIndex(f => f.path === file.path)
            
            if (e.shiftKey && lastClickedIndex !== null) {
              // Shift+click: select range
              const start = Math.min(lastClickedIndex, currentIndex)
              const end = Math.max(lastClickedIndex, currentIndex)
              const rangePaths = visibleFiles.slice(start, end + 1).map(f => f.path)
              
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
              setLastClickedIndex(currentIndex)
            } else {
              // Normal click: select single item
              setSelectedFiles([file.path])
              setLastClickedIndex(currentIndex)
            }
            
            if (file.isDirectory) {
              // Navigate main pane to this folder (don't auto-expand, use arrow for that)
              setCurrentFolder(file.relativePath)
            } else {
              // Navigate to the file's parent folder in the file browser
              const parentPath = file.relativePath.split('/').slice(0, -1).join('/') || ''
              setCurrentFolder(parentPath)
              // Check for slow double click (for rename)
              handleSlowDoubleClick(file)
            }
          }}
          onDoubleClick={() => {
            if (isRenaming) return
            
            if (file.isDirectory) {
              // Toggle expand/collapse on double click
              toggleFolder(file.relativePath)
            } else if (window.electronAPI) {
              // Double click on file opens it
              window.electronAPI.openFile(file.path)
              // Reset slow double click tracking
              setLastClickTime(0)
              setLastClickPath(null)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            // Only keep multi-selection if there are multiple files selected AND 
            // the right-clicked file is part of that selection
            // Otherwise, select just the right-clicked file
            if (!(selectedFiles.length > 1 && selectedFiles.includes(file.path))) {
              setSelectedFiles([file.path])
            }
            setContextMenu({ x: e.clientX, y: e.clientY, file })
          }}
          draggable={file.diffStatus !== 'cloud'}
          onDragStart={(e) => {
            // Get files to drag - now supports folders too
            let filesToDrag: LocalFile[]
            if (selectedFiles.includes(file.path) && selectedFiles.length > 1) {
              filesToDrag = files.filter(f => selectedFiles.includes(f.path) && f.diffStatus !== 'cloud')
            } else if (file.diffStatus !== 'cloud') {
              filesToDrag = [file]
            } else {
              e.preventDefault()
              return
            }
            
            if (filesToDrag.length === 0) {
              e.preventDefault()
              return
            }
            
            // Track dragged files for internal moves (ref for sync access, state for UI)
            draggedFilesRef.current = filesToDrag
            setDraggedFiles(filesToDrag)
            
            const filePaths = filesToDrag.map(f => f.path)
            console.log('[Explorer Drag] Starting drag for:', filePaths)
            
            // Set up HTML5 drag data
            e.dataTransfer.effectAllowed = 'copyMove'
            e.dataTransfer.setData('text/plain', filePaths.join('\n'))
            // Set PDM-specific data for cross-view drag
            e.dataTransfer.setData('application/x-plm-files', JSON.stringify(filesToDrag.map(f => f.relativePath)))
            
            // Use DownloadURL format for single non-folder file - enables actual file copy
            if (filesToDrag.length === 1 && !filesToDrag[0].isDirectory) {
              const filePath = filesToDrag[0].path
              const fileName = filesToDrag[0].name
              const ext = filesToDrag[0].extension?.toLowerCase() || ''
              const mimeTypes: Record<string, string> = {
                '.pdf': 'application/pdf',
                '.step': 'application/step',
                '.stp': 'application/step',
                '.sldprt': 'application/octet-stream',
                '.sldasm': 'application/octet-stream',
                '.slddrw': 'application/octet-stream',
              }
              const mime = mimeTypes[ext] || 'application/octet-stream'
              const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`
              e.dataTransfer.setData('DownloadURL', `${mime}:${fileName}:${fileUrl}`)
            }
            
            // Create a custom drag image
            const dragPreview = document.createElement('div')
            dragPreview.style.cssText = 'position:absolute;left:-1000px;padding:8px 12px;background:#1e293b;border:1px solid #3b82f6;border-radius:6px;color:white;font-size:13px;display:flex;align-items:center;gap:6px;'
            const iconSvg = file.isDirectory 
              ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
              : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
            const label = filesToDrag.length > 1 ? `${filesToDrag.length} items` : file.name
            dragPreview.innerHTML = `${iconSvg}${label}`
            document.body.appendChild(dragPreview)
            e.dataTransfer.setDragImage(dragPreview, 20, 20)
            setTimeout(() => dragPreview.remove(), 0)
            
            // Note: We don't call window.electronAPI.startDrag() here for Explorer view
            // because it interferes with HTML5 drag-and-drop for internal moves.
            // Files can still be dragged to external apps via the dataTransfer data.
          }}
          onDragEnd={handleExplorerDragEnd}
          onDragOver={(e) => {
            // ALWAYS prevent default and stop propagation on tree items
            // This is critical for internal drag-and-drop to work
            e.preventDefault()
            e.stopPropagation()
            
            // Check if this is a pdm drag (internal or cross-view) or external files
            const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
            const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
            const currentDraggedFiles = draggedFilesRef.current
            
            // Only process if we have files being dragged
            if (!hasPdmFiles && !hasExternalFiles && currentDraggedFiles.length === 0) return
            
            // Only set drop effect and highlight for folders (actual drop targets)
            if (file.isDirectory) {
              // For external file drops, just show the target highlight
              if (hasExternalFiles) {
                e.dataTransfer.dropEffect = 'copy'
                setDragOverFolder(file.relativePath)
                return
              }
              
              const filesToCheck = currentDraggedFiles.length > 0 ? currentDraggedFiles : []
              
              // Don't allow dropping a folder into itself or its children
              const isDroppingIntoSelf = filesToCheck.some(f => 
                f.isDirectory && (file.relativePath === f.relativePath || file.relativePath.startsWith(f.relativePath + '/'))
              )
              if (isDroppingIntoSelf) return
              
              // Don't allow dropping if the target is the current parent
              const wouldStayInPlace = filesToCheck.length > 0 && filesToCheck.every(f => {
                const parentPath = f.relativePath.includes('/') 
                  ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
                  : ''
                return parentPath === file.relativePath
              })
              if (wouldStayInPlace) return
              
              // Check if all files can be moved (checked out)
              if (filesToCheck.length > 0 && !canMoveFiles(filesToCheck)) {
                e.dataTransfer.dropEffect = 'none'
                return
              }
              
              e.dataTransfer.dropEffect = 'move'
              setDragOverFolder(file.relativePath)
            }
          }}
          onDragLeave={file.isDirectory ? handleExplorerFolderDragLeave : undefined}
          onDrop={file.isDirectory ? (e) => handleExplorerDropOnFolder(e, file) : undefined}
        >
          {file.isDirectory && (
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
          )}
          {!file.isDirectory && <span className="w-[14px] mr-1" />}
          <span className="tree-item-icon">{getFileIcon(file)}</span>
          
          {/* File name - editable when renaming */}
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
            <span className={`truncate text-sm flex-1 transition-opacity duration-200 ${
              !file.isDirectory && (
                (isDownloadHovered && selectedDownloadableFiles.some(f => f.path === file.path)) ||
                (isUploadHovered && selectedUploadableFiles.some(f => f.path === file.path)) ||
                (isCheckoutHovered && selectedCheckoutableFiles.some(f => f.path === file.path)) ||
                (isCheckinHovered && selectedCheckinableFiles.some(f => f.path === file.path))
              ) ? 'opacity-50' : ''
            } ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}>
              {file.isDirectory || !file.extension 
                ? file.name 
                : file.name.slice(0, -file.extension.length) + (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
            </span>
          )}
          
          {/* Checkout info and local-only count for folders */}
          {/* Order from left to right: update, cloud, avatar checkout, green cloud, local */}
          {!isRenaming && file.isDirectory && (localOnlyCount > 0 || file.diffStatus === 'cloud' || (diffCounts && (diffCounts.cloud > 0 || diffCounts.outdated > 0)) || folderCheckoutUsers.length > 0 || folderSyncedCount > 0) && (
            <span className="flex items-center gap-1 ml-auto mr-0.5 text-[10px]">
              {/* 1. Update (outdated) - farthest left - only when online */}
              {!isOfflineMode && diffCounts && diffCounts.outdated > 0 && (
                <InlineSyncButton
                  onClick={(e) => handleInlineDownload(e, file)}
                  count={diffCounts.outdated}
                />
              )}
              {/* 2. Cloud files to download - only when online */}
              {!isOfflineMode && ((diffCounts && diffCounts.cloud > 0) || file.diffStatus === 'cloud') && (
                <FolderDownloadButton
                  onClick={(e) => !isProcessing && handleInlineDownload(e, file)}
                  cloudCount={diffCounts?.cloud || 0}
                  isProcessing={isProcessing}
                  disabled={isProcessing}
                />
              )}
              {/* 3. Avatar checkout (users with check-in button) - only when online */}
              {!isOfflineMode && folderCheckoutUsers.length > 0 && (
                <FolderCheckinButton
                  onClick={(e) => handleInlineCheckin(e, file)}
                  users={folderCheckoutUsers}
                  myCheckedOutCount={folderCheckedOutByMeCount}
                  totalCheckouts={folderTotalCheckouts}
                />
              )}
              {/* 4. Green cloud - synced files ready to checkout - only when online */}
              {!isOfflineMode && folderSyncedCount > 0 && (
                <InlineCheckoutButton
                  onClick={(e) => handleInlineCheckout(e, file)}
                  count={folderSyncedCount}
                />
              )}
              {/* 5. Local files - clickable upload button when online only */}
              {!isOfflineMode && localOnlyCount > 0 && (
                <FolderUploadButton
                  onClick={(e) => handleInlineFirstCheckin(e, file)}
                  localCount={localOnlyCount}
                />
              )}
            </span>
          )}
          
          {/* Download for individual cloud files (not folders) - only when online */}
          {!isRenaming && !isProcessing && !file.isDirectory && !isOfflineMode && (file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') && (
            <InlineDownloadButton
              onClick={(e) => handleInlineDownload(e, file)}
              isCloudNew={file.diffStatus === 'cloud_new'}
              selectedCount={selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1 ? selectedDownloadableFiles.length : undefined}
              isSelectionHovered={selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1 && isDownloadHovered}
              onMouseEnter={() => selectedDownloadableFiles.length > 1 && selectedFiles.includes(file.path) && setIsDownloadHovered(true)}
              onMouseLeave={() => setIsDownloadHovered(false)}
            />
          )}
          
          {/* Sync outdated files - newer version available on server - only when online */}
          {!isRenaming && !isProcessing && !file.isDirectory && !isOfflineMode && file.diffStatus === 'outdated' && (
            <InlineSyncButton 
              onClick={(e) => handleInlineDownload(e, file)}
              selectedCount={selectedFiles.includes(file.path) && selectedUpdatableFiles.length > 1 ? selectedUpdatableFiles.length : undefined}
              isSelectionHovered={selectedFiles.includes(file.path) && selectedUpdatableFiles.length > 1 && isUpdateHovered}
              onMouseEnter={() => selectedUpdatableFiles.length > 1 && selectedFiles.includes(file.path) && setIsUpdateHovered(true)}
              onMouseLeave={() => setIsUpdateHovered(false)}
            />
          )}
          
          {/* Stage Check-In button (offline mode) - only for files with actual local changes */}
          {/* Shows for modified or new local files, allows staging for check-in when back online */}
          {!isRenaming && !isProcessing && !file.isDirectory && isOfflineMode && file.diffStatus !== 'cloud' && (
            (() => {
              const isStaged = !!getStagedCheckin(file.relativePath)
              // Show for: new local files OR modified synced files OR already staged files
              // NOT for files that are just checked out without changes
              const hasLocalChanges = file.diffStatus === 'added' || file.diffStatus === 'modified'
              if (!hasLocalChanges && !isStaged) return null
              return (
                <InlineStageCheckinButton
                  onClick={(e) => handleStageCheckin(e, file)}
                  isStaged={isStaged}
                  title={isStaged 
                    ? 'Click to unstage (keep working on file)' 
                    : 'Stage for check-in when online'
                  }
                />
              )
            })()
          )}
          
          {/* First Check In for individual local-only files (not folders) - only when online */}
          {/* Includes: new files (!pdmData), added files, and deleted_remote (orphaned local files) */}
          {!isRenaming && !isProcessing && !file.isDirectory && !isOfflineMode && (!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') && file.diffStatus !== 'cloud' && (
            <InlineUploadButton 
              onClick={(e) => handleInlineFirstCheckin(e, file)}
              selectedCount={selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1 ? selectedUploadableFiles.length : undefined}
              isSelectionHovered={selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1 && isUploadHovered}
              onMouseEnter={() => selectedUploadableFiles.length > 1 && selectedFiles.includes(file.path) && setIsUploadHovered(true)}
              onMouseLeave={() => setIsUploadHovered(false)}
            />
          )}
          
          {/* Inline action buttons for individual files - show on hover */}
          {!isRenaming && !isBeingProcessed(file.relativePath) && !file.isDirectory && (() => {
            // In offline mode, checkout/checkin buttons don't work - use stage button instead
            // But we still show checkout status (avatar) for files checked out by others
            const showCheckout = !isOfflineMode && file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud'
            const showCheckin = !isOfflineMode && file.pdmData?.checked_out_by === user?.id
            const checkedOutByOther = file.pdmData?.checked_out_by && file.pdmData.checked_out_by !== user?.id
            const checkedOutUser = checkedOutByOther ? (file.pdmData as any)?.checked_out_user : null
            // In offline mode, show a lock icon for files I have checked out (visual indicator only)
            const showOfflineCheckoutIndicator = isOfflineMode && file.pdmData?.checked_out_by === user?.id
            
            if (!showCheckout && !showCheckin && !checkedOutByOther && !showOfflineCheckoutIndicator) return null
            
            return (
              <span className="flex items-center gap-0.5 ml-1">
                {/* Check Out - only when online */}
                {showCheckout && (
                  <InlineCheckoutButton 
                    onClick={(e) => handleInlineCheckout(e, file)}
                    selectedCount={selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1 ? selectedCheckoutableFiles.length : undefined}
                    isSelectionHovered={selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1 && isCheckoutHovered}
                    onMouseEnter={() => selectedCheckoutableFiles.length > 1 && selectedFiles.includes(file.path) && setIsCheckoutHovered(true)}
                    onMouseLeave={() => setIsCheckoutHovered(false)}
                  />
                )}
                {/* Check In - for individual files checked out by me (only when online) */}
                {showCheckin && (
                  <InlineCheckinButton
                    onClick={(e) => handleInlineCheckin(e, file)}
                    userAvatarUrl={user?.avatar_url ?? undefined}
                    userFullName={user?.full_name ?? undefined}
                    userEmail={user?.email}
                    selectedCount={selectedFiles.includes(file.path) && selectedCheckinableFiles.length > 1 ? selectedCheckinableFiles.length : undefined}
                    isSelectionHovered={selectedFiles.includes(file.path) && selectedCheckinableFiles.length > 1 && isCheckinHovered}
                    onMouseEnter={() => selectedCheckinableFiles.length > 1 && selectedFiles.includes(file.path) && setIsCheckinHovered(true)}
                    onMouseLeave={() => setIsCheckinHovered(false)}
                  />
                )}
                {/* Offline checkout indicator - shows I have this file checked out while offline */}
                {showOfflineCheckoutIndicator && (
                  <div 
                    className="relative w-5 h-5 flex-shrink-0" 
                    title="You have this file checked out (use stage button to queue check-in)"
                  >
                    {user?.avatar_url ? (
                      <img 
                        src={user.avatar_url} 
                        alt={user?.full_name || user?.email?.split('@')[0] || 'You'}
                        className="w-5 h-5 rounded-full object-cover ring-2 ring-plm-accent"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                          target.nextElementSibling?.classList.remove('hidden')
                        }}
                      />
                    ) : null}
                    <div 
                      className={`w-5 h-5 rounded-full bg-plm-accent/30 text-plm-accent flex items-center justify-center text-[9px] font-medium ring-2 ring-plm-accent ${user?.avatar_url ? 'hidden' : ''}`}
                    >
                      {getInitials(user?.full_name || user?.email?.split('@')[0] || 'U')}
                    </div>
                  </div>
                )}
                {/* Avatar for files checked out by someone else - no button, just shows who has it */}
                {checkedOutByOther && (
                  <div 
                    className="relative w-5 h-5 flex-shrink-0" 
                    title={`Checked out by ${checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'}`}
                  >
                    {checkedOutUser?.avatar_url ? (
                      <img 
                        src={checkedOutUser.avatar_url} 
                        alt={checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'User'}
                        className="w-5 h-5 rounded-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                          target.nextElementSibling?.classList.remove('hidden')
                        }}
                      />
                    ) : null}
                    <div 
                      className={`w-5 h-5 rounded-full bg-plm-accent/30 text-plm-accent flex items-center justify-center text-[9px] font-medium absolute inset-0 ${checkedOutUser?.avatar_url ? 'hidden' : ''}`}
                    >
                      {getInitials(checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'U')}
                    </div>
                  </div>
                )}
              </span>
            )
          })()}
          
        </div>
        {file.isDirectory && isExpanded && (
          <div
            onDragOver={(e) => {
              // When dragging over expanded folder area, highlight the parent folder
              e.preventDefault()
              const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
              if (hasPdmFiles || draggedFilesRef.current.length > 0) {
                e.dataTransfer.dropEffect = 'move'
                // Only set if not already over a more specific folder
                if (!dragOverFolder || dragOverFolder === file.relativePath) {
                  setDragOverFolder(file.relativePath)
                }
              }
            }}
            onDragLeave={(e) => {
              // Only clear if leaving to outside this folder's area
              const relatedTarget = e.relatedTarget as HTMLElement
              if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                if (dragOverFolder === file.relativePath) {
                  setDragOverFolder(null)
                }
              }
            }}
            onDrop={(e) => handleExplorerDropOnFolder(e, file)}
          >
            {children
              .filter(child => child && child.name)
              .sort((a, b) => {
                // Folders first, then alphabetically
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              })
              .map(child => renderTreeItem(child, depth + 1))
            }
          </div>
        )}
      </div>
    )
  }

  // Render a connected vault section
  const renderVaultSection = (vault: ConnectedVault) => {
    const isActive = activeVaultId === vault.id
    const isExpanded = vault.isExpanded
    
    // Calculate vault stats (only meaningful for active vault)
    // Include both 'cloud' and 'cloud_new' to match what the download command processes
    const cloudFiles = isActive ? files.filter(f => !f.isDirectory && (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new')) : []
    const cloudFilesCount = cloudFiles.length
    // Check if any cloud files are currently being downloaded (for spinner)
    // Use isBeingProcessed for consistency with individual file checks (handles path normalization)
    const isAnyCloudFileProcessing = isActive && cloudFiles.some(f => isBeingProcessed(f.relativePath))
    const outdatedFilesCount = isActive ? files.filter(f => !f.isDirectory && f.diffStatus === 'outdated').length : 0
    // Local-only files count - must match tree filtering (exclude temp files when setting enabled)
    const localOnlyFilesCount = isActive ? files.filter(f => 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') &&
      f.diffStatus !== 'cloud' &&
      f.diffStatus !== 'ignored' &&
      !(hideSolidworksTempFiles && f.name.startsWith('~$'))
    ).length : 0
    // Synced files that can be checked out (have pdmData, not checked out, not cloud-only)
    const syncedFilesCount = isActive ? files.filter(f => !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new').length : 0
    const checkedOutByMeCount = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id).length : 0
    const checkedOutByOthersCount = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id).length : 0
    const checkedOutByOthers = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id) : []
    
    // Get ALL unique users who have files checked out (including me)
    const allCheckoutUsers: { id: string; name: string; avatar_url?: string; isMe: boolean; count: number }[] = []
    
    // Add current user if they have checkouts
    if (isActive && checkedOutByMeCount > 0 && user) {
      allCheckoutUsers.push({
        id: user.id,
        name: user.full_name || user.email || 'You',
        avatar_url: user.avatar_url || undefined,
        isMe: true,
        count: checkedOutByMeCount
      })
    }
    
    // Add other users
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
    
    const totalCheckouts = checkedOutByMeCount + checkedOutByOthersCount
    
    return (
      <div key={vault.id} className="border-b border-plm-border last:border-b-0">
        {/* Vault header - click to select vault (expands automatically), also accepts drops to root */}
        <div 
          className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
            isActive ? 'bg-plm-highlight text-plm-fg' : 'text-plm-fg-dim hover:bg-plm-highlight/50'
          } ${isActive && dragOverFolder === '' ? 'bg-plm-accent/20 outline outline-2 outline-dashed outline-plm-accent/50' : ''}`}
          onClick={() => {
            if (isActive) {
              // Already active - just toggle expand/collapse
              toggleVaultExpanded(vault.id)
            } else {
              // Switch to this vault and expand it
              switchToVault(vault)
              if (!isExpanded) {
                toggleVaultExpanded(vault.id)
              }
            }
          }}
          onContextMenu={(e) => handleVaultContextMenu(e, vault)}
          onDragOver={(e) => {
            // Only accept drops on active vault header
            if (!isActive) return
            e.preventDefault()
            e.stopPropagation()
            const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
            const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
            if (hasPdmFiles || draggedFilesRef.current.length > 0) {
              e.dataTransfer.dropEffect = 'move'
              setDragOverFolder('')
            } else if (hasExternalFiles) {
              e.dataTransfer.dropEffect = 'copy'
              setDragOverFolder('')
            }
          }}
          onDragLeave={(e) => {
            if (!isActive) return
            e.preventDefault()
            const relatedTarget = e.relatedTarget as HTMLElement
            if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
              if (dragOverFolder === '') {
                setDragOverFolder(null)
              }
            }
          }}
          onDrop={(e) => {
            if (!isActive) return
            handleVaultRootDrop(e)
          }}
        >
          <span className="flex-shrink-0">
            {isExpanded && isActive
              ? <ChevronDown size={14} className="text-plm-fg-muted" />
              : <ChevronRight size={14} className="text-plm-fg-muted" />
            }
          </span>
          <Database size={16} className={`vault-icon ${isActive ? 'text-plm-accent' : 'text-plm-fg-muted'}`} />
          <span className="truncate text-sm font-medium">
            {vault.name}
          </span>
          
          {/* Spacer to push badges to the right */}
          <div className="flex-1" />
          
          {/* Inline badges and actions - only for active vault */}
          {isActive && (
            <div className="flex items-center gap-1">
              {/* Order from left to right: update, cloud, avatar checkout, green cloud, local */}
              
              {/* 1. Update files (outdated) - farthest left - only when online */}
              {!isOfflineMode && outdatedFilesCount > 0 && (
                <InlineSyncButton
                  onClick={handleUpdateAllOutdated}
                  count={outdatedFilesCount}
                />
              )}
              
              {/* 2. Cloud files to download - only when online */}
              {!isOfflineMode && cloudFilesCount > 0 && (
                <FolderDownloadButton
                  onClick={handleDownloadAllCloudFiles}
                  cloudCount={cloudFilesCount}
                  isProcessing={isDownloadingAll || isAnyCloudFileProcessing}
                />
              )}
              
              {/* 3. Avatar checkout (users with check-in button) - only when online */}
              {!isOfflineMode && allCheckoutUsers.length > 0 && (
                <FolderCheckinButton
                  onClick={handleCheckInMyCheckouts}
                  users={allCheckoutUsers}
                  myCheckedOutCount={checkedOutByMeCount}
                  totalCheckouts={totalCheckouts}
                  isProcessing={isCheckingInMyCheckouts}
                  maxAvatars={3}
                />
              )}
              
              {/* 4. Green cloud - synced files ready to checkout - only when online */}
              {!isOfflineMode && syncedFilesCount > 0 && (
                <InlineCheckoutButton
                  onClick={handleCheckoutAllSynced}
                  count={syncedFilesCount}
                />
              )}
              
              {/* 5. Local files - clickable upload button when online only */}
              {!isOfflineMode && localOnlyFilesCount > 0 && (
                <FolderUploadButton
                  onClick={handleFirstCheckinAllLocal}
                  localCount={localOnlyFilesCount}
                  isProcessing={isCheckingInAll}
                />
              )}
            </div>
          )}
        </div>
        
        {/* Vault contents - only show when active and expanded */}
        {isExpanded && isActive && (
          <div 
            className={`pb-2 min-h-[40px] ${dragOverFolder === '' ? 'bg-plm-accent/10 outline outline-2 outline-dashed outline-plm-accent/50 rounded' : ''}`}
            onDragOver={handleVaultRootDragOver}
            onDragLeave={handleVaultRootDragLeave}
            onDrop={handleVaultRootDrop}
          >
            {/* Root items for this vault */}
            {tree['']
              .filter(item => item && item.name)
              .sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              })
              .map(file => renderTreeItem(file, 1))
            }
            
            {(isLoading || !filesLoaded) && tree[''].length === 0 && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="text-plm-fg-muted animate-spin" />
              </div>
            )}
            
            {tree[''].length === 0 && !isLoading && filesLoaded && (
              <div className="px-4 py-4 text-center text-plm-fg-muted text-xs">
                {dragOverFolder === '' ? 'Drop here to move to root' : 'No files in vault'}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // If no vaults connected, show the old vault connection UI
  if (connectedVaults.length === 0) {
    // Fall back to legacy single vault mode if available
    if (isVaultConnected && vaultPath) {
      const displayName = vaultPath.split(/[/\\]/).pop() || 'vault'
      const rootItems = tree[''] || []
      
      return (
        <div className="py-2 relative">
          {/* Vault header */}
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
          
          {/* Tree */}
          {rootItems
            .filter(item => item && item.name)
            .sort((a, b) => {
              if (a.isDirectory && !b.isDirectory) return -1
              if (!a.isDirectory && b.isDirectory) return 1
              return a.name.localeCompare(b.name)
            })
            .map(file => renderTreeItem(file))
          }
          
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
        </div>
      )
    }
    
    // No vault connected at all
    return (
      <div className="p-4">
        <div className="mb-6">
          <button
            onClick={onOpenVault}
            className="btn btn-primary w-full"
          >
            <FolderOpen size={16} />
            Open Vault
          </button>
        </div>
        
        {recentVaults.length > 0 && (
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
              Recent Vaults
            </div>
            {recentVaults.map(vault => (
              <button
                key={vault}
                onClick={() => onOpenRecentVault(vault)}
                className="w-full text-left px-2 py-1.5 text-sm text-plm-fg-dim hover:bg-plm-highlight rounded truncate"
                title={vault}
              >
                {vault.split(/[/\\]/).pop()}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Multiple vaults mode
  return (
    <div ref={explorerContainerRef} className="flex flex-col h-full" tabIndex={-1}>
      {/* Pinned section - only show if there are pinned items */}
      {pinnedFolders.length > 0 && (
        <div className="border-b border-plm-border">
          {/* Pinned header - collapsible */}
          <div 
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-plm-highlight/30"
            onClick={() => togglePinnedSection()}
          >
            <span className="cursor-pointer">
              {pinnedSectionExpanded 
                ? <ChevronDown size={14} className="text-plm-fg-muted" /> 
                : <ChevronRight size={14} className="text-plm-fg-muted" />
              }
            </span>
            <Pin size={14} className="text-plm-accent fill-plm-accent" />
            <span className="text-sm font-medium flex-1">Pinned</span>
            <span className="text-xs text-plm-fg-muted">{pinnedFolders.length}</span>
          </div>
          
          {/* Pinned items */}
          {pinnedSectionExpanded && (
            <div className="pb-1">
              {pinnedFolders.map((pinned, index) => {
                const vault = connectedVaults.find(v => v.id === pinned.vaultId)
                // Find the actual file from the vault's files if this vault is active
                const actualFile = pinned.vaultId === activeVaultId 
                  ? files.find(f => f.relativePath === pinned.path)
                  : null
                const rawFileName = pinned.path.split('/').pop() || pinned.path
                // Format filename with lowercase extension if setting is on
                const ext = actualFile?.extension || (rawFileName.includes('.') ? '.' + rawFileName.split('.').pop() : '')
                const fileName = !pinned.isDirectory && ext 
                  ? rawFileName.slice(0, -ext.length) + (lowercaseExtensions !== false ? ext.toLowerCase() : ext)
                  : rawFileName
                
                // Get folder stats for pinned folders - same as regular tree items
                // Must match tree filtering (exclude temp files when setting enabled)
                const pinnedFolderPrefix = pinned.path + '/'
                const localOnlyCount = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? files.filter(f => 
                      !f.isDirectory && 
                      (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') && 
                      f.diffStatus !== 'cloud' && 
                      f.diffStatus !== 'ignored' &&
                      f.relativePath.startsWith(pinnedFolderPrefix) &&
                      !(hideSolidworksTempFiles && f.name.startsWith('~$'))
                    ).length
                  : 0
                
                // Get diff counts for pinned folders (cloud file count)
                const pinnedDiffCounts = pinned.isDirectory && pinned.vaultId === activeVaultId 
                  ? getFolderDiffCounts(pinned.path) 
                  : null
                
                // Get checkout info for pinned folders
                const pinnedFolderCheckoutUsers = pinned.isDirectory && pinned.vaultId === activeVaultId 
                  ? getCheckoutUsersForFolder(pinned.path) 
                  : []
                const pinnedFolderCheckedOutByMeCount = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? files.filter(f => 
                      !f.isDirectory && 
                      f.pdmData?.checked_out_by === user?.id &&
                      f.relativePath.startsWith(pinnedFolderPrefix)
                    ).length 
                  : 0
                const pinnedFolderTotalCheckouts = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? files.filter(f => 
                      !f.isDirectory && 
                      f.pdmData?.checked_out_by &&
                      f.relativePath.startsWith(pinnedFolderPrefix)
                    ).length 
                  : 0
                // Count synced files that can be checked out
                const pinnedFolderSyncedCount = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? files.filter(f => 
                      !f.isDirectory && 
                      f.pdmData && !f.pdmData.checked_out_by &&
                      f.diffStatus !== 'cloud' &&
                      f.relativePath.startsWith(pinnedFolderPrefix)
                    ).length 
                  : 0
                
                // Get status icon for pinned file
                // Note: Avatars for checked-out files are now shown via InlineCheckinButton, not here
                // Cloud files show their status via InlineDownloadButton, not here
                const getPinnedStatusIcon = () => {
                  if (!actualFile) return null
                  if (actualFile.isDirectory) return null
                  
                  // Checked out files - avatar is shown in InlineCheckinButton, skip here
                  if (actualFile.pdmData?.checked_out_by) {
                    return null
                  }
                  
                  // Cloud-only files - no icon here, shown in download button
                  if (actualFile.diffStatus === 'cloud' || actualFile.diffStatus === 'cloud_new') {
                    return null
                  }
                  
                  // Synced files that can be checked out - no icon here, shown in checkout button
                  if (actualFile.pdmData && !actualFile.pdmData.checked_out_by) {
                    return null
                  }
                  
                  return null
                }
                
                // Get file icon with proper folder color scheme - use same logic as getFileIcon
                const getPinnedFileIcon = () => {
                  if (pinned.isDirectory) {
                    // Check folder status for color - only if this vault is active
                    if (pinned.vaultId === activeVaultId) {
                      // Cloud-only folder - muted color, no opacity (text handles dimming)
                      if (actualFile?.diffStatus === 'cloud') {
                        return <FolderOpen size={16} className="text-plm-fg-muted" />
                      }
                      // Check checkout status - red for others, orange for mine
                      const checkoutStatus = checkFolderCheckoutStatus(pinned.path)
                      if (checkoutStatus === 'others' || checkoutStatus === 'both') {
                        return <FolderOpen size={16} className="text-plm-error" />
                      }
                      if (checkoutStatus === 'mine') {
                        return <FolderOpen size={16} className="text-orange-400" />
                      }
                      // All synced - green
                      if (checkFolderSynced(pinned.path)) {
                        return <FolderOpen size={16} className="text-plm-success" />
                      }
                    }
                    // Default - grey
                    return <FolderOpen size={16} className="text-plm-fg-muted" />
                  }
                  // For files, use shared FileIcon (includes thumbnail support)
                  if (actualFile) {
                    return <FileIcon file={actualFile} size={16} />
                  }
                  // Fallback: create a mock file object for FileTypeIcon
                  const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '')
                  return <FileTypeIcon extension={ext} size={16} />
                }
                
                // Diff class for files
                const diffClass = actualFile?.diffStatus 
                  ? `sidebar-diff-${actualFile.diffStatus}` : ''
                
                const isDragging = draggingPinIndex === index
                const isDragOver = dragOverPinIndex === index && draggingPinIndex !== index
                
                // For folders, check if expanded in pinned section
                const isPinnedFolderExpanded = pinned.isDirectory && expandedPinnedFolders.has(`${pinned.vaultId}-${pinned.path}`)
                
                // Get children for expanded pinned folders
                const pinnedFolderChildren = pinned.isDirectory && isPinnedFolderExpanded && pinned.vaultId === activeVaultId
                  ? (tree[pinned.path] || []).sort((a, b) => {
                      if (a.isDirectory && !b.isDirectory) return -1
                      if (!a.isDirectory && b.isDirectory) return 1
                      return a.name.localeCompare(b.name)
                    })
                  : []
                
                return (
                  <div key={`${pinned.vaultId}-${pinned.path}`}>
                    <div
                      draggable
                      onDragStart={(e) => {
                        setDraggingPinIndex(index)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        if (draggingPinIndex !== null && dragOverPinIndex !== null && draggingPinIndex !== dragOverPinIndex) {
                          reorderPinnedFolders(draggingPinIndex, dragOverPinIndex)
                        }
                        setDraggingPinIndex(null)
                        setDragOverPinIndex(null)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOverPinIndex(index)
                      }}
                      onDragLeave={() => {
                        if (dragOverPinIndex === index) {
                          setDragOverPinIndex(null)
                        }
                      }}
                      className={`tree-item group ${diffClass} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-plm-accent' : ''}`}
                      style={{ paddingLeft: pinned.isDirectory ? 8 : 24, cursor: 'grab' }}
                      onClick={async () => {
                        // Switch to the vault if different
                        if (pinned.vaultId !== activeVaultId && vault) {
                          console.log('[PinnedClick] Switching to vault:', vault.name, vault.id)
                          
                          // Clear existing file state to avoid stale data
                          setFiles([])
                          setServerFiles([])
                          setFilesLoaded(false)
                          
                          // Tell Electron to switch the working directory FIRST
                          if (window.electronAPI) {
                            const result = await window.electronAPI.setWorkingDir(vault.localPath)
                            if (!result.success) {
                              addToast('error', `Failed to switch vault: ${result.error}`)
                              return
                            }
                          }
                          
                          // Update state ATOMICALLY - triggers loadFiles via App.tsx effect
                          switchVault(pinned.vaultId, vault.localPath)
                          
                          // Expand the vault if not expanded
                          if (!vault.isExpanded) {
                            toggleVaultExpanded(pinned.vaultId)
                          }
                        }
                        
                        // Navigate to folder (or parent for files)
                        if (pinned.isDirectory) {
                          setCurrentFolder(pinned.path)
                        } else {
                          const parentPath = pinned.path.split('/').slice(0, -1).join('/') || ''
                          setCurrentFolder(parentPath)
                        }
                      }}
                      onDoubleClick={() => {
                        // Double click on files opens them
                        if (!pinned.isDirectory && actualFile && window.electronAPI) {
                          window.electronAPI.openFile(actualFile.path)
                        }
                        // Double click on folders toggles expand
                        if (pinned.isDirectory) {
                          const key = `${pinned.vaultId}-${pinned.path}`
                          setExpandedPinnedFolders(prev => {
                            const next = new Set(prev)
                            if (next.has(key)) {
                              next.delete(key)
                            } else {
                              next.add(key)
                            }
                            return next
                          })
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (actualFile) {
                          // Only keep multi-selection if there are multiple files selected AND 
                          // the right-clicked file is part of that selection
                          if (!(selectedFiles.length > 1 && selectedFiles.includes(actualFile.path))) {
                            setSelectedFiles([actualFile.path])
                          }
                          setContextMenu({ x: e.clientX, y: e.clientY, file: actualFile })
                        }
                      }}
                    >
                      {/* Expand/collapse chevron for folders */}
                      {pinned.isDirectory && (
                        <span 
                          className="mr-1 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            const key = `${pinned.vaultId}-${pinned.path}`
                            setExpandedPinnedFolders(prev => {
                              const next = new Set(prev)
                              if (next.has(key)) {
                                next.delete(key)
                              } else {
                                next.add(key)
                              }
                              return next
                            })
                          }}
                        >
                          {isPinnedFolderExpanded 
                            ? <ChevronDown size={14} className="text-plm-fg-muted" /> 
                            : <ChevronRight size={14} className="text-plm-fg-muted" />
                          }
                        </span>
                      )}
                      <span className="tree-item-icon">{getPinnedFileIcon()}</span>
                      {/* Show full path for folders, just filename for files */}
                      <span className={`truncate text-sm flex-1 transition-opacity duration-200 ${
                        !pinned.isDirectory && actualFile && (
                          (isDownloadHovered && selectedDownloadableFiles.some(f => f.path === actualFile.path)) ||
                          (isUploadHovered && selectedUploadableFiles.some(f => f.path === actualFile.path)) ||
                          (isCheckoutHovered && selectedCheckoutableFiles.some(f => f.path === actualFile.path)) ||
                          (isCheckinHovered && selectedCheckinableFiles.some(f => f.path === actualFile.path))
                        ) ? 'opacity-50' : ''
                      }`} title={pinned.path}>
                        {pinned.isDirectory ? pinned.path : fileName}
                      </span>
                      
                      {/* Vault label if from different vault */}
                      {pinned.vaultId !== activeVaultId && (
                        <span className="text-[10px] text-plm-fg-muted truncate max-w-[60px]" title={pinned.vaultName}>
                          {pinned.vaultName}
                        </span>
                      )}
                      
                      {/* Folder inline action buttons - order from left to right: update, cloud, avatar checkout, green cloud, local */}
                      {pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && (localOnlyCount > 0 || actualFile.diffStatus === 'cloud' || (pinnedDiffCounts && (pinnedDiffCounts.cloud > 0 || pinnedDiffCounts.outdated > 0)) || pinnedFolderCheckoutUsers.length > 0 || pinnedFolderSyncedCount > 0) && (
                        <span className="flex items-center gap-1 ml-auto mr-0.5 text-[10px]">
                          {/* 1. Update (outdated) - farthest left - only when online */}
                          {!isOfflineMode && pinnedDiffCounts && pinnedDiffCounts.outdated > 0 && (
                            <InlineSyncButton
                              onClick={(e) => handleInlineDownload(e, actualFile)}
                              count={pinnedDiffCounts.outdated}
                            />
                          )}
                          {/* 2. Cloud files to download - only when online */}
                          {!isOfflineMode && ((pinnedDiffCounts && pinnedDiffCounts.cloud > 0) || actualFile.diffStatus === 'cloud') && (
                            <FolderDownloadButton
                              onClick={(e) => !isBeingProcessed(actualFile.relativePath) && handleInlineDownload(e, actualFile)}
                              cloudCount={pinnedDiffCounts?.cloud || 0}
                              isProcessing={isBeingProcessed(actualFile.relativePath)}
                              disabled={isBeingProcessed(actualFile.relativePath)}
                            />
                          )}
                          {/* 3. Avatar checkout (users with check-in button) - only when online */}
                          {!isOfflineMode && pinnedFolderCheckoutUsers.length > 0 && (
                            <FolderCheckinButton
                              onClick={(e) => handleInlineCheckin(e, actualFile)}
                              users={pinnedFolderCheckoutUsers}
                              myCheckedOutCount={pinnedFolderCheckedOutByMeCount}
                              totalCheckouts={pinnedFolderTotalCheckouts}
                            />
                          )}
                          {/* 4. Green cloud - synced files ready to checkout - only when online */}
                          {!isOfflineMode && pinnedFolderSyncedCount > 0 && (
                            <InlineCheckoutButton
                              onClick={(e) => handleInlineCheckout(e, actualFile)}
                              count={pinnedFolderSyncedCount}
                            />
                          )}
                          {/* 5. Local files - clickable upload button when online only */}
                          {!isOfflineMode && localOnlyCount > 0 && (
                            <FolderUploadButton
                              onClick={(e) => handleInlineFirstCheckin(e, actualFile)}
                              localCount={localOnlyCount}
                            />
                          )}
                        </span>
                      )}
                      
                      {/* Status icon for files */}
                      {!pinned.isDirectory && getPinnedStatusIcon()}
                      
                      {/* Download for individual cloud files (not folders) - only when online */}
                      {!pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && !isOfflineMode && !isBeingProcessed(actualFile.relativePath) && (actualFile.diffStatus === 'cloud' || actualFile.diffStatus === 'cloud_new') && (
                        <InlineDownloadButton
                          onClick={(e) => handleInlineDownload(e, actualFile)}
                          isCloudNew={actualFile.diffStatus === 'cloud_new'}
                          selectedCount={selectedFiles.includes(actualFile.path) && selectedDownloadableFiles.length > 1 ? selectedDownloadableFiles.length : undefined}
                          isSelectionHovered={selectedFiles.includes(actualFile.path) && selectedDownloadableFiles.length > 1 && isDownloadHovered}
                          onMouseEnter={() => selectedDownloadableFiles.length > 1 && selectedFiles.includes(actualFile.path) && setIsDownloadHovered(true)}
                          onMouseLeave={() => setIsDownloadHovered(false)}
                        />
                      )}
                      
                      {/* Stage Check-In button (offline mode) - only for pinned files with actual local changes */}
                      {!pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && isOfflineMode && !isBeingProcessed(actualFile.relativePath) && actualFile.diffStatus !== 'cloud' && (
                        (() => {
                          const isStaged = !!getStagedCheckin(actualFile.relativePath)
                          // Show for: new local files OR modified synced files OR already staged files
                          // NOT for files that are just checked out without changes
                          const hasLocalChanges = actualFile.diffStatus === 'added' || actualFile.diffStatus === 'modified'
                          if (!hasLocalChanges && !isStaged) return null
                          return (
                            <InlineStageCheckinButton
                              onClick={(e) => handleStageCheckin(e, actualFile)}
                              isStaged={isStaged}
                              title={isStaged 
                                ? 'Click to unstage (keep working on file)' 
                                : 'Stage for check-in when online'
                              }
                            />
                          )
                        })()
                      )}
                      
                      {/* First Check In for individual local-only files (not folders) - only when online */}
                      {!pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && !isOfflineMode && !isBeingProcessed(actualFile.relativePath) && (!actualFile.pdmData || actualFile.diffStatus === 'added') && actualFile.diffStatus !== 'cloud' && (
                        <InlineUploadButton 
                          onClick={(e) => handleInlineFirstCheckin(e, actualFile)}
                          selectedCount={selectedFiles.includes(actualFile.path) && selectedUploadableFiles.length > 1 ? selectedUploadableFiles.length : undefined}
                          isSelectionHovered={selectedFiles.includes(actualFile.path) && selectedUploadableFiles.length > 1 && isUploadHovered}
                          onMouseEnter={() => selectedUploadableFiles.length > 1 && selectedFiles.includes(actualFile.path) && setIsUploadHovered(true)}
                          onMouseLeave={() => setIsUploadHovered(false)}
                        />
                      )}
                      
                      {/* Inline action buttons for individual files - show on hover */}
                      {!pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && !isBeingProcessed(actualFile.relativePath) && (() => {
                        // In offline mode, checkout/checkin buttons don't work - use stage button instead
                        const showCheckout = !isOfflineMode && actualFile.pdmData && !actualFile.pdmData.checked_out_by && actualFile.diffStatus !== 'cloud'
                        const showCheckin = !isOfflineMode && actualFile.pdmData?.checked_out_by === user?.id
                        const showOfflineCheckoutIndicator = isOfflineMode && actualFile.pdmData?.checked_out_by === user?.id
                        
                        if (!showCheckout && !showCheckin && !showOfflineCheckoutIndicator) return null
                        
                        return (
                          <span className="flex items-center gap-0.5 ml-1">
                            {/* Check Out - only when online */}
                            {showCheckout && (
                              <InlineCheckoutButton 
                                onClick={(e) => handleInlineCheckout(e, actualFile)}
                                selectedCount={selectedFiles.includes(actualFile.path) && selectedCheckoutableFiles.length > 1 ? selectedCheckoutableFiles.length : undefined}
                                isSelectionHovered={selectedFiles.includes(actualFile.path) && selectedCheckoutableFiles.length > 1 && isCheckoutHovered}
                                onMouseEnter={() => selectedCheckoutableFiles.length > 1 && selectedFiles.includes(actualFile.path) && setIsCheckoutHovered(true)}
                                onMouseLeave={() => setIsCheckoutHovered(false)}
                              />
                            )}
                            {/* Check In - for individual files checked out by me - only when online */}
                            {showCheckin && (
                              <InlineCheckinButton
                                onClick={(e) => handleInlineCheckin(e, actualFile)}
                                userAvatarUrl={user?.avatar_url ?? undefined}
                                userFullName={user?.full_name ?? undefined}
                                userEmail={user?.email}
                                selectedCount={selectedFiles.includes(actualFile.path) && selectedCheckinableFiles.length > 1 ? selectedCheckinableFiles.length : undefined}
                                isSelectionHovered={selectedFiles.includes(actualFile.path) && selectedCheckinableFiles.length > 1 && isCheckinHovered}
                                onMouseEnter={() => selectedCheckinableFiles.length > 1 && selectedFiles.includes(actualFile.path) && setIsCheckinHovered(true)}
                                onMouseLeave={() => setIsCheckinHovered(false)}
                              />
                            )}
                            {/* Offline checkout indicator - shows I have this file checked out while offline */}
                            {showOfflineCheckoutIndicator && (
                              <div 
                                className="relative w-5 h-5 flex-shrink-0" 
                                title="You have this file checked out (use stage button to queue check-in)"
                              >
                                {user?.avatar_url ? (
                                  <img 
                                    src={user.avatar_url} 
                                    alt={user?.full_name || user?.email?.split('@')[0] || 'You'}
                                    className="w-5 h-5 rounded-full object-cover ring-2 ring-plm-accent"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.style.display = 'none'
                                      target.nextElementSibling?.classList.remove('hidden')
                                    }}
                                  />
                                ) : null}
                                <div 
                                  className={`w-5 h-5 rounded-full bg-plm-accent/30 text-plm-accent flex items-center justify-center text-[9px] font-medium ring-2 ring-plm-accent ${user?.avatar_url ? 'hidden' : ''}`}
                                >
                                  {getInitials(user?.full_name || user?.email?.split('@')[0] || 'U')}
                                </div>
                              </div>
                            )}
                          </span>
                        )
                      })()}
                      
                      {/* Unpin button - slightly visible, full on hover */}
                      <button
                        className="opacity-30 group-hover:opacity-100 p-0.5 hover:bg-plm-fg-muted/20 rounded transition-opacity ml-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          unpinFolder(pinned.path)
                          addToast('info', `Unpinned ${fileName}`)
                        }}
                        title="Unpin"
                      >
                        <PinOff size={12} className="text-plm-fg-muted" />
                      </button>
                    </div>
                    
                    {/* Expanded pinned folder children */}
                    {isPinnedFolderExpanded && pinnedFolderChildren.map(child => 
                      renderTreeItem(child, 1)
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      
      {/* Vault list */}
      <div className="flex-1 overflow-y-auto">
        {connectedVaults.map(vault => renderVaultSection(vault))}
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
        <div
          className="fixed inset-0 z-50"
          onClick={() => setVaultContextMenu(null)}
        >
          <div
            className="fixed bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: vaultContextMenu.x, top: vaultContextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
              onClick={() => {
                setVaultContextMenu(null)
                // Hard refresh - switch to this vault if not active, then refresh
                const vault = vaultContextMenu.vault
                if (activeVaultId !== vault.id && vault.localPath) {
                  switchVault(vault.id, vault.localPath)
                }
                // Trigger a full refresh with loading spinner
                onRefresh?.(false)
              }}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
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
                
                // Open folder picker
                const result = await window.electronAPI?.selectWorkingDir()
                if (result?.success && result.path) {
                  // Update the vault's local path
                  const { updateConnectedVault, setVaultPath, setVaultConnected, addToast } = usePDMStore.getState()
                  updateConnectedVault(vault.id, { localPath: result.path })
                  
                  // If this is the active vault, also update the working directory
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
            {/* Header */}
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
            
            {/* Content */}
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
            
            {/* Actions */}
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
            {/* Header */}
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
            
            {/* Content */}
            <div className="p-4 space-y-4 overflow-auto max-h-[60vh]">
              {/* Location */}
              <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Local Path</div>
                <div className="text-sm text-plm-fg break-all font-mono">
                  {showVaultProperties.localPath || 'Not connected locally'}
                </div>
              </div>
              
              {/* File Statistics */}
              {(() => {
                // Get files for this vault
                const vaultFiles = files.filter(f => !f.isDirectory)
                const vaultFolders = files.filter(f => f.isDirectory)
                
                // Sync status counts
                const syncedFiles = vaultFiles.filter(f => !f.diffStatus)
                const modifiedFiles = vaultFiles.filter(f => f.diffStatus === 'modified')
                const addedFiles = vaultFiles.filter(f => f.diffStatus === 'added')
                const cloudFiles = vaultFiles.filter(f => f.diffStatus === 'cloud')
                const conflictFiles = vaultFiles.filter(f => f.diffStatus === 'outdated')
                
                // Checkout status
                const checkedOutByMe = vaultFiles.filter(f => f.pdmData?.checked_out_by === user?.id)
                const checkedOutByOthers = vaultFiles.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
                
                // Calculate total size
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
                    {/* Overview */}
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
                    
                    {/* Sync Status */}
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
                            <span className="text-sm text-plm-fg">Local Only (Unsynced)</span>
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
                    
                    {/* Checkout Status */}
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
                    
                    {/* File Types Breakdown */}
                    {(() => {
                      const typeCount = new Map<string, number>()
                      vaultFiles.forEach(f => {
                        const ext = (f.extension || 'other').toLowerCase()
                        typeCount.set(ext, (typeCount.get(ext) || 0) + 1)
                      })
                      
                      // Sort by count and take top 10
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
            
            {/* Footer */}
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
