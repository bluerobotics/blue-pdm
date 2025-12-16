import { useState, useEffect, useRef } from 'react'
import { 
  FolderOpen, 
  ChevronRight, 
  ChevronDown,
  File,
  FileBox,
  FileText,
  Layers,
  Database,
  Lock,
  Cloud,
  Pin,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen,
  Loader2,
  ArrowDown,
  ArrowUp,
  PinOff,
  Unlink,
  FolderOpen as FolderOpenIcon,
  AlertTriangle,
  Check,
  HardDrive,
  Info,
  RefreshCw,
  Plus,
  X
} from 'lucide-react'
// Use command system for PDM operations
import { executeCommand } from '../../lib/commands'
import { usePDMStore, LocalFile, ConnectedVault } from '../../stores/pdmStore'
import { getFileIconType, getInitials } from '../../types/pdm'
import { FileContextMenu } from '../FileContextMenu'

// Component to load OS icon for files in explorer view
interface ExplorerFileIconProps {
  file: LocalFile
  size?: number
}

function ExplorerFileIcon({ file, size = 16 }: ExplorerFileIconProps) {
  const [icon, setIcon] = useState<string | null>(null)
  
  useEffect(() => {
    if (file.isDirectory || !file.path) {
      setIcon(null)
      return
    }
    
    let cancelled = false
    
    const loadIcon = async () => {
      try {
        const result = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (!cancelled && result?.success && result.data) {
          setIcon(result.data)
        }
      } catch {
        // Silently fail - will show default icon
      }
    }
    
    loadIcon()
    
    return () => { cancelled = true }
  }, [file.path, file.isDirectory])
  
  // Show OS icon if available
  if (icon) {
    return (
      <img 
        src={icon} 
        alt=""
        className="flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setIcon(null)}
      />
    )
  }
  
  // Fallback to React icons
  const iconType = getFileIconType(file.extension)
  switch (iconType) {
    case 'part':
      return <FileBox size={size} className="text-plm-accent flex-shrink-0" />
    case 'assembly':
      return <Layers size={size} className="text-amber-400 flex-shrink-0" />
    case 'drawing':
      return <FilePen size={size} className="text-sky-300 flex-shrink-0" />
    case 'step':
      return <FileBox size={size} className="text-orange-400 flex-shrink-0" />
    case 'pdf':
      return <FileType size={size} className="text-red-400 flex-shrink-0" />
    case 'image':
      return <FileImage size={size} className="text-purple-400 flex-shrink-0" />
    case 'spreadsheet':
      return <FileSpreadsheet size={size} className="text-green-400 flex-shrink-0" />
    case 'archive':
      return <FileArchive size={size} className="text-yellow-500 flex-shrink-0" />
    case 'schematic':
      return <Cpu size={size} className="text-red-400 flex-shrink-0" />
    case 'library':
      return <Cpu size={size} className="text-violet-400 flex-shrink-0" />
    case 'pcb':
      return <Cpu size={size} className="text-emerald-400 flex-shrink-0" />
    case 'code':
      return <FileCode size={size} className="text-sky-400 flex-shrink-0" />
    case 'text':
      return <FileText size={size} className="text-plm-fg-muted flex-shrink-0" />
    default:
      return <File size={size} className="text-plm-fg-muted flex-shrink-0" />
  }
}

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
    serverFolderPaths,
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
  // State for re-render triggers, ref for synchronous access during drag events
  const [, setDraggedFiles] = useState<LocalFile[]>([])
  const draggedFilesRef = useRef<LocalFile[]>([])
  
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
    setClipboard({ files: [contextMenu.file], operation: 'copy' })
    addToast('info', `Copied ${contextMenu.file.name}`)
  }
  
  const handleCut = () => {
    if (!contextMenu?.file) return
    const file = contextMenu.file
    
    // Check if file can be cut - need checkout for synced files
    // Can cut if: directory, unsynced (local-only), or checked out by current user
    if (!file.isDirectory && file.pdmData && file.pdmData.checked_out_by !== user?.id) {
      if (file.pdmData.checked_out_by) {
        addToast('error', 'Cannot move: file is checked out by someone else')
      } else {
        addToast('error', 'Cannot move: check out the file first')
      }
      return
    }
    
    setClipboard({ files: [file], operation: 'cut' })
    addToast('info', `Cut ${file.name}`)
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
    
    // Filter out any undefined or invalid files
    const validFiles = files.filter(f => f && f.relativePath && f.name)
    
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

  // Check if all files in a folder are truly synced (not just content-matched)
  const isFolderSynced = (folderPath: string): boolean => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    if (folderFiles.length === 0) return false
    // Only consider synced if ALL files have pdmData AND none are marked as 'added'
    return folderFiles.every(f => !!f.pdmData && f.diffStatus !== 'added')
  }

  // Get folder checkout status: 'mine' | 'others' | 'both' | null
  const getFolderCheckoutStatus = (folderPath: string): 'mine' | 'others' | 'both' | null => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    const checkedOutByMe = folderFiles.some(f => f.pdmData?.checked_out_by === user?.id)
    const checkedOutByOthers = folderFiles.some(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
    
    if (checkedOutByMe && checkedOutByOthers) return 'both'
    if (checkedOutByMe) return 'mine'
    if (checkedOutByOthers) return 'others'
    return null
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

  // Inline action: Download a single file (uses command system)
  const handleInlineDownload = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    executeCommand('download', { files: [file] }, { onRefresh })
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

  // Inline action: Check out a single file or folder (uses command system)
  const handleInlineCheckout = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    executeCommand('checkout', { files: [file] }, { onRefresh })
  }

  // Inline action: Check in a single file or folder (uses command system)
  const handleInlineCheckin = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    executeCommand('checkin', { files: [file] }, { onRefresh })
  }

  // Inline action: First check in (upload) a single file or folder (uses command system)
  const handleInlineFirstCheckin = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    executeCommand('sync', { files: [file] }, { onRefresh })
  }

  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      // Check if folder is being processed (downloading/deleting) or is inside a processing folder
      if (isBeingProcessed(file.relativePath)) {
        return <Loader2 size={16} className="text-sky-400 animate-spin" />
      }
      // Cloud-only folders (exist on server but not locally)
      if (file.diffStatus === 'cloud') {
        return <FolderOpen size={16} className="text-plm-fg-muted opacity-50" />
      }
      const checkoutStatus = getFolderCheckoutStatus(file.relativePath)
      if (checkoutStatus === 'others' || checkoutStatus === 'both') {
        // Red for folders with files checked out by others
        return <FolderOpen size={16} className="text-plm-error" />
      }
      if (checkoutStatus === 'mine') {
        // Orange for folders with only my checkouts
        return <FolderOpen size={16} className="text-plm-warning" />
      }
      const synced = isFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-plm-success' : 'text-plm-fg-muted'} />
    }
    
    // Check if file is inside a processing folder
    if (isBeingProcessed(file.relativePath)) {
      return <Loader2 size={16} className="text-sky-400 animate-spin" />
    }
    
    // Use OS icons for files (not folders)
    return <ExplorerFileIcon file={file} size={16} />
  }
  
  // Get unique users with checkouts in a folder
  const getFolderCheckoutUsers = (folderPath: string) => {
    const { user } = usePDMStore.getState()
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.pdmData?.checked_out_by &&
      f.relativePath.startsWith(folderPath + '/')
    )
    
    // Collect unique users
    const usersMap = new Map<string, { id: string; name: string; avatar_url?: string; isMe: boolean }>()
    
    for (const f of folderFiles) {
      const checkoutUserId = f.pdmData!.checked_out_by!
      if (!usersMap.has(checkoutUserId)) {
        const isMe = checkoutUserId === user?.id
        if (isMe) {
          usersMap.set(checkoutUserId, {
            id: checkoutUserId,
            name: user?.full_name || user?.email || 'You',
            avatar_url: user?.avatar_url || undefined,
            isMe: true
          })
        } else {
          const checkedOutUser = (f.pdmData as any).checked_out_user
          usersMap.set(checkoutUserId, {
            id: checkoutUserId,
            name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
            avatar_url: checkedOutUser?.avatar_url,
            isMe: false
          })
        }
      }
    }
    
    // Sort so "me" comes first
    return Array.from(usersMap.values()).sort((a, b) => {
      if (a.isMe && !b.isMe) return -1
      if (!a.isMe && b.isMe) return 1
      return 0
    })
  }

  // Get status icon for files (avatar/lock, green cloud, grey cloud)
  const getStatusIcon = (file: LocalFile) => {
    const { user } = usePDMStore.getState()
    
    // For folders - show stacked avatars of users with checkouts, or cloud status
    if (file.isDirectory) {
      const checkoutUsers = getFolderCheckoutUsers(file.relativePath)
      
      // If has checkout users, show avatars
      if (checkoutUsers.length > 0) {
        const maxShow = 3
        const shown = checkoutUsers.slice(0, maxShow)
        const extra = checkoutUsers.length - maxShow
        
        return (
          <span className="flex items-center flex-shrink-0 -space-x-1.5 ml-1" title={checkoutUsers.map(u => u.name).join(', ')}>
            {shown.map((u, i) => (
              <div key={u.id} className="relative" style={{ zIndex: maxShow - i }}>
                {u.avatar_url ? (
                  <img 
                    src={u.avatar_url} 
                    alt={u.name}
                    className={`w-5 h-5 rounded-full ring-1 ${u.isMe ? 'ring-plm-accent' : 'ring-plm-bg-light'} bg-plm-bg object-cover`}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div 
                  className={`w-5 h-5 rounded-full ring-1 ${u.isMe ? 'ring-plm-accent bg-plm-accent/30 text-plm-accent' : 'ring-plm-bg-light bg-plm-fg-muted/30 text-plm-fg'} flex items-center justify-center text-[9px] font-medium ${u.avatar_url ? 'hidden' : ''}`}
                >
                  {getInitials(u.name)}
                </div>
              </div>
            ))}
            {extra > 0 && (
              <div 
                className="w-5 h-5 rounded-full ring-1 ring-plm-fg-muted bg-plm-bg flex items-center justify-center text-[9px] font-medium text-plm-fg-muted"
                style={{ zIndex: 0 }}
              >
                +{extra}
              </div>
            )}
          </span>
        )
      }
      
      // Cloud-only folder - don't show cloud icon here since the folder icon is faded
      // and we show cloud file count with download button inline
      if (file.diffStatus === 'cloud') {
        return null
      }
      
      // Check if folder exists on server (by checking serverFolderPaths)
      const normalizedFolderPath = file.relativePath.replace(/\\/g, '/')
      const folderExistsOnServer = serverFolderPaths.has(normalizedFolderPath)
      
      // Check folder sync status based on files inside
      const folderFiles = files.filter(f => 
        !f.isDirectory && 
        f.relativePath.startsWith(file.relativePath + '/')
      )
      const syncedFiles = folderFiles.filter(f => f.pdmData && f.diffStatus !== 'cloud' && f.diffStatus !== 'added')
      const cloudOnlyFiles = folderFiles.filter(f => f.diffStatus === 'cloud')
      const hasServerContent = syncedFiles.length > 0 || cloudOnlyFiles.length > 0
      const hasUnsyncedFiles = folderFiles.some(f => !f.pdmData || f.diffStatus === 'added')
      const allSynced = syncedFiles.length > 0 && !hasUnsyncedFiles && cloudOnlyFiles.length === 0
      
      // Green cloud: folder exists on server (either has content or exists in serverFolderPaths)
      if (hasServerContent || folderExistsOnServer) {
        // Bright green if all local files are synced, muted green if some pending or empty
        const colorClass = allSynced ? 'text-plm-success' : 'text-plm-success/60'
        return <Cloud size={12} className={`${colorClass} flex-shrink-0`} />
      }
      
      // Local-only folder (not on server) - show drive icon
      return <HardDrive size={12} className="text-plm-fg-muted flex-shrink-0" />
    }
    
    // For files:
    // Checked out by me - show my avatar with accent ring
    if (file.pdmData?.checked_out_by === user?.id) {
      const myInitial = getInitials(user?.full_name || user?.email)
      return (
        <div className="relative w-5 h-5 flex-shrink-0" title={`Checked out by ${user?.full_name || user?.email || 'you'}`}>
          {user?.avatar_url ? (
            <img 
              src={user.avatar_url} 
              alt="You"
              className="w-5 h-5 rounded-full ring-1 ring-plm-accent object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div 
            className={`w-5 h-5 rounded-full ring-1 ring-plm-accent bg-plm-accent/30 text-plm-accent flex items-center justify-center text-[9px] font-medium absolute inset-0 ${user?.avatar_url ? 'hidden' : ''}`}
          >
            {myInitial}
          </div>
        </div>
      )
    }
    
    // Checked out by someone else - show their avatar with neutral ring
    if (file.pdmData?.checked_out_by) {
      const checkedOutUser = (file.pdmData as any).checked_out_user
      const avatarUrl = checkedOutUser?.avatar_url
      const displayName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'
      
      return (
        <div className="relative w-5 h-5 flex-shrink-0" title={`Checked out by ${displayName}`}>
          {avatarUrl ? (
            <img 
              src={avatarUrl} 
              alt={displayName}
              className="w-5 h-5 rounded-full ring-1 ring-plm-bg-light object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div 
            className={`w-5 h-5 rounded-full ring-1 ring-plm-bg-light bg-plm-fg-muted/30 text-plm-fg flex items-center justify-center text-[9px] font-medium absolute inset-0 ${avatarUrl ? 'hidden' : ''}`}
          >
            {getInitials(displayName)}
          </div>
        </div>
      )
    }
    
    // Cloud-only (not downloaded) - grey cloud
    if (file.diffStatus === 'cloud') {
      return <Cloud size={12} className="text-plm-fg-muted flex-shrink-0" />
    }
    
    // Added (local only, ready to check in) - hard drive icon
    if (file.diffStatus === 'added') {
      return <span title="Local only"><HardDrive size={12} className="text-plm-fg-muted flex-shrink-0" /></span>
    }
    
    // Synced (has pdmData and downloaded locally) - green cloud
    if (file.pdmData) {
      return <Cloud size={12} className="text-plm-success flex-shrink-0" />
    }
    
    // Not synced - no icon
    return null
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
    
    // Get diff counts for folders (exclude 'added' since it shows as localOnlyCount with HardDrive icon)
    const diffCounts = file.isDirectory ? getFolderDiffCounts(file.relativePath) : null
    const hasDiffs = diffCounts && (diffCounts.modified > 0 || diffCounts.moved > 0 || diffCounts.deleted > 0 || diffCounts.outdated > 0 || diffCounts.cloud > 0)
    
    // Get local-only (unsynced) files count for folders
    const localOnlyCount = file.isDirectory ? files.filter(f => 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added') && 
      f.diffStatus !== 'cloud' && 
      f.diffStatus !== 'ignored' &&
      f.relativePath.startsWith(file.relativePath + '/')
    ).length : 0
    
    // Diff class for files and deleted folders
    const diffClass = file.diffStatus 
      ? `sidebar-diff-${file.diffStatus}` : ''

    const isSelected = selectedFiles.includes(file.path)
    const isRenaming = renamingFile?.relativePath === file.relativePath
    const isProcessing = isBeingProcessed(file.relativePath)
    const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath

    return (
      <div key={file.path}>
        <div
          className={`tree-item group ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''}`}
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
            <span className={`truncate text-sm flex-1 ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}>
              {file.isDirectory || !file.extension 
                ? file.name 
                : file.name.slice(0, -file.extension.length) + (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
            </span>
          )}
          
          {/* Diff counts and local-only count for folders */}
          {/* Also show for empty cloud-only folders so they can be created locally */}
          {!isRenaming && file.isDirectory && (hasDiffs || localOnlyCount > 0 || file.diffStatus === 'cloud') && (
            <span className="flex items-center gap-1 ml-auto mr-0.5 text-xs">
              {/* Cloud files first (download from others) */}
              {/* Also show download button for empty cloud-only folders */}
              {(diffCounts && diffCounts.cloud > 0) || file.diffStatus === 'cloud' ? (
                <span className="text-plm-info font-medium flex items-center gap-0.5">
                  {diffCounts && diffCounts.cloud > 0 && (
                    <>
                      <Cloud size={10} />
                      {diffCounts.cloud}
                    </>
                  )}
                  {/* Download button - creates empty folder or downloads files */}
                  {!isProcessing && (
                    <button
                      className="inline-actions p-0.5 rounded hover:bg-sky-400/20 text-sky-400"
                      onClick={(e) => handleInlineDownload(e, file)}
                      title={diffCounts && diffCounts.cloud > 0 ? 'Download cloud files' : 'Create folder locally'}
                    >
                      <ArrowDown size={12} />
                    </button>
                  )}
                </span>
              ) : null}
              {diffCounts && diffCounts.modified > 0 && (
                <span className="text-plm-warning font-medium flex items-center gap-0.5"><ArrowUp size={10} />{diffCounts.modified}</span>
              )}
              {diffCounts && diffCounts.moved > 0 && (
                <span className="text-plm-accent font-medium">→{diffCounts.moved}</span>
              )}
              {diffCounts && diffCounts.deleted > 0 && (
                <span className="text-plm-error font-medium">-{diffCounts.deleted}</span>
              )}
              {diffCounts && diffCounts.outdated > 0 && (
                <span className="text-purple-400 font-medium">↓{diffCounts.outdated}</span>
              )}
              {/* Local-only files last (next to check-in button) */}
              {localOnlyCount > 0 && (
                <span className="text-plm-fg-muted font-medium flex items-center gap-0.5" title={`${localOnlyCount} local files not yet synced`}>
                  <HardDrive size={10} />
                  {localOnlyCount}
                </span>
              )}
            </span>
          )}
          
          {/* Status icon (lock, cloud) */}
          {!isRenaming && getStatusIcon(file)}
          
          {/* Download for individual cloud files (not folders) - after cloud icon */}
          {!isRenaming && !isProcessing && !file.isDirectory && file.diffStatus === 'cloud' && (
            <button
              className="inline-actions p-0.5 rounded hover:bg-sky-400/20 text-sky-400"
              onClick={(e) => handleInlineDownload(e, file)}
              title="Download"
            >
              <ArrowDown size={12} />
            </button>
          )}
          
          {/* Inline action buttons - show on hover */}
          {!isRenaming && !isBeingProcessed(file.relativePath) && (() => {
            // Count checkoutable files in folder
            const checkoutableFilesCount = file.isDirectory 
              ? files.filter(f => 
                  !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.relativePath.startsWith(file.relativePath + '/')
                ).length
              : 0
            // Check if folder has my checked out files
            const hasMyCheckedOutFiles = file.isDirectory && files.some(f => 
              !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.relativePath.startsWith(file.relativePath + '/')
            )
            // Check if file/folder has unsynced files (for first check-in)
            const hasUnsyncedFiles = file.isDirectory 
              ? files.some(f => 
                  !f.isDirectory && 
                  (!f.pdmData || f.diffStatus === 'added') && 
                  f.relativePath.startsWith(file.relativePath + '/')
                )
              : (!file.pdmData || file.diffStatus === 'added')
            
            const showCheckout = (!file.isDirectory && file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud') || checkoutableFilesCount > 0
            const showCheckin = (!file.isDirectory && file.pdmData?.checked_out_by === user?.id) || hasMyCheckedOutFiles
            const showFirstCheckin = hasUnsyncedFiles && file.diffStatus !== 'cloud'
            
            if (!showCheckout && !showCheckin && !showFirstCheckin) return null
            
            return (
              <span className="inline-actions flex items-center gap-0.5 ml-1">
                {/* First Check In - for unsynced files/folders */}
                {showFirstCheckin && (
                  <button
                    className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success"
                    onClick={(e) => handleInlineFirstCheckin(e, file)}
                    title="First Check In"
                  >
                    <ArrowUp size={12} />
                  </button>
                )}
                {/* Check Out - for synced files/folders not checked out */}
                {showCheckout && (
                  <button
                    className="p-0.5 rounded hover:bg-plm-warning/20 text-plm-warning"
                    onClick={(e) => handleInlineCheckout(e, file)}
                    title={file.isDirectory && checkoutableFilesCount > 0 ? `Check out ${checkoutableFilesCount} file${checkoutableFilesCount > 1 ? 's' : ''}` : "Check Out"}
                  >
                    <ArrowDown size={12} />
                  </button>
                )}
                {/* Check In - for files/folders checked out by me */}
                {showCheckin && (
                  <button
                    className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success"
                    onClick={(e) => handleInlineCheckin(e, file)}
                    title="Check In"
                  >
                    <ArrowUp size={12} />
                  </button>
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
    const isAnyCloudFileProcessing = isActive && cloudFiles.some(f => processingFolders.has(f.relativePath))
    const localOnlyFilesCount = isActive ? files.filter(f => !f.isDirectory && (!f.pdmData || f.diffStatus === 'added')).length : 0
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
          <Database size={16} className={isActive ? 'text-plm-accent' : 'text-plm-fg-muted'} />
          <span className="flex-1 truncate text-sm font-medium">
            {vault.name}
          </span>
          
          {/* Refresh button - always visible for active vault, hover for others */}
          <button
            className={`p-1 rounded transition-all ${
              isActive 
                ? 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light' 
                : 'opacity-0 group-hover:opacity-100 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light'
            }`}
            title="Refresh vault (F5)"
            onClick={(e) => {
              e.stopPropagation()
              onRefresh?.()
            }}
            disabled={isLoading}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          
          {/* Inline badges and actions - only for active vault */}
          {isActive && (
            <div className="flex items-center gap-1">
              {/* Stacked avatars of all users with checkouts */}
              {allCheckoutUsers.length > 0 && (
                <div 
                  className="flex items-center gap-1"
                  title={allCheckoutUsers.map(u => `${u.name}: ${u.count} file${u.count > 1 ? 's' : ''}`).join('\n')}
                >
                  <div className="flex -space-x-1.5">
                    {allCheckoutUsers.slice(0, 3).map((u) => (
                      <div 
                        key={u.id} 
                        className={`w-5 h-5 rounded-full ring-1 overflow-hidden flex-shrink-0 relative ${
                          u.isMe ? 'ring-plm-accent' : 'ring-plm-bg-light'
                        }`}
                      >
                        {u.avatar_url ? (
                          <img 
                            src={u.avatar_url} 
                            alt="" 
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              target.nextElementSibling?.classList.remove('hidden')
                            }}
                          />
                        ) : null}
                        <div className={`w-full h-full ${u.isMe ? 'bg-plm-accent/30' : 'bg-plm-fg-muted/30'} flex items-center justify-center text-[10px] font-medium ${u.isMe ? 'text-plm-accent' : 'text-plm-fg'} absolute inset-0 ${u.avatar_url ? 'hidden' : ''}`}>
                          {getInitials(u.name)}
                        </div>
                      </div>
                    ))}
                    {allCheckoutUsers.length > 3 && (
                      <div className="w-5 h-5 rounded-full ring-1 ring-plm-bg-light bg-plm-bg-light flex items-center justify-center text-[9px] text-plm-fg-muted flex-shrink-0">
                        +{allCheckoutUsers.length - 3}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted">
                    <Lock size={10} />
                    <span>{totalCheckouts}</span>
                  </div>
                </div>
              )}
              
              {/* Cloud files indicator - files others added that you haven't downloaded */}
              {cloudFilesCount > 0 && (
                <div 
                  className="flex items-center gap-0.5 text-[10px] text-plm-info bg-plm-bg/50 px-1.5 py-0.5 rounded"
                  title={isAnyCloudFileProcessing ? `Downloading ${cloudFilesCount} cloud files...` : `${cloudFilesCount} cloud files available to download`}
                >
                  {isAnyCloudFileProcessing ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Cloud size={10} />
                  )}
                  <span>{cloudFilesCount}</span>
                </div>
              )}
              
              {/* Download all cloud files button - slightly visible */}
              {cloudFilesCount > 0 && (
                <button
                  className={`p-1 rounded transition-colors ${
                    (isDownloadingAll || isAnyCloudFileProcessing)
                      ? 'text-plm-info cursor-not-allowed' 
                      : 'hover:bg-plm-bg/50 text-plm-fg-muted/50 hover:text-plm-info'
                  }`}
                  title={(isDownloadingAll || isAnyCloudFileProcessing) ? 'Downloading...' : `Download ${cloudFilesCount} cloud files`}
                  onClick={handleDownloadAllCloudFiles}
                  disabled={isDownloadingAll || isAnyCloudFileProcessing}
                >
                  {(isDownloadingAll || isAnyCloudFileProcessing) ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowDown size={14} />
                  )}
                </button>
              )}
              
              {/* Local-only files indicator - files not yet synced to cloud */}
              {localOnlyFilesCount > 0 && (
                <div 
                  className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted bg-plm-bg/50 px-1.5 py-0.5 rounded"
                  title={`${localOnlyFilesCount} local files not yet synced`}
                >
                  <HardDrive size={10} />
                  <span>{localOnlyFilesCount}</span>
                </div>
              )}
              
              {/* First check in all local files button */}
              {localOnlyFilesCount > 0 && (
                <button
                  className={`p-1 rounded transition-colors ${
                    isCheckingInAll 
                      ? 'text-plm-success cursor-not-allowed' 
                      : 'hover:bg-plm-success/20 text-plm-fg-muted/50 hover:text-plm-success'
                  }`}
                  title={isCheckingInAll ? 'Uploading...' : `First Check In ${localOnlyFilesCount} local files`}
                  onClick={handleFirstCheckinAllLocal}
                  disabled={isCheckingInAll}
                >
                  {isCheckingInAll ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowUp size={14} />
                  )}
                </button>
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
    <div className="flex flex-col h-full">
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
                
                // Get diff counts for pinned folders (exclude 'added' since it shows as localOnlyCount with HardDrive icon)
                const diffCounts = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? getFolderDiffCounts(pinned.path)
                  : null
                const hasDiffs = diffCounts && (diffCounts.modified > 0 || diffCounts.moved > 0 || diffCounts.deleted > 0 || diffCounts.outdated > 0 || diffCounts.cloud > 0)
                
                // Get local-only (unsynced) files count for pinned folders
                const localOnlyCount = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? files.filter(f => 
                      !f.isDirectory && 
                      (!f.pdmData || f.diffStatus === 'added') && 
                      f.diffStatus !== 'cloud' && 
                      f.diffStatus !== 'ignored' &&
                      f.relativePath.startsWith(pinned.path + '/')
                    ).length
                  : 0
                
                // Get status icon for pinned file
                const getPinnedStatusIcon = () => {
                  if (!actualFile) return null
                  if (actualFile.isDirectory) return null
                  const { user } = usePDMStore.getState()
                  if (actualFile.pdmData?.checked_out_by === user?.id) {
                    const myInitial = getInitials(user?.full_name || user?.email)
                    return (
                      <div className="relative w-5 h-5 flex-shrink-0" title="Checked out by you">
                        {user?.avatar_url ? (
                          <img 
                            src={user.avatar_url} 
                            alt="You"
                            className="w-5 h-5 rounded-full ring-1 ring-plm-accent object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              target.nextElementSibling?.classList.remove('hidden')
                            }}
                          />
                        ) : null}
                        <div 
                          className={`w-5 h-5 rounded-full ring-1 ring-plm-accent bg-plm-accent/30 text-plm-accent flex items-center justify-center text-[9px] font-medium absolute inset-0 ${user?.avatar_url ? 'hidden' : ''}`}
                        >
                          {myInitial}
                        </div>
                      </div>
                    )
                  }
                  if (actualFile.pdmData?.checked_out_by) {
                    const checkedOutUser = (actualFile.pdmData as any).checked_out_user
                    const avatarUrl = checkedOutUser?.avatar_url
                    const displayName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'
                    
                    return (
                      <div className="relative w-5 h-5 flex-shrink-0" title={`Checked out by ${displayName}`}>
                        {avatarUrl ? (
                          <img 
                            src={avatarUrl} 
                            alt={displayName}
                            className="w-5 h-5 rounded-full ring-1 ring-plm-bg-light object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              target.nextElementSibling?.classList.remove('hidden')
                            }}
                          />
                        ) : null}
                        <div 
                          className={`w-5 h-5 rounded-full ring-1 ring-plm-bg-light bg-plm-fg-muted/30 text-plm-fg flex items-center justify-center text-[9px] font-medium absolute inset-0 ${avatarUrl ? 'hidden' : ''}`}
                        >
                          {getInitials(displayName)}
                        </div>
                      </div>
                    )
                  }
                  if (actualFile.diffStatus === 'cloud') {
                    return <Cloud size={12} className="text-plm-fg-muted flex-shrink-0" />
                  }
                  if (actualFile.pdmData) {
                    return <Cloud size={12} className="text-plm-success flex-shrink-0" />
                  }
                  return null
                }
                
                // Get file icon with proper folder color scheme - use same logic as getFileIcon
                const getPinnedFileIcon = () => {
                  if (pinned.isDirectory) {
                    // Check folder status for color - only if this vault is active
                    if (pinned.vaultId === activeVaultId) {
                      // Cloud-only folder
                      if (actualFile?.diffStatus === 'cloud') {
                        return <FolderOpen size={16} className="text-plm-fg-muted opacity-50" />
                      }
                      // Check checkout status - red for others, orange for mine
                      const checkoutStatus = getFolderCheckoutStatus(pinned.path)
                      if (checkoutStatus === 'others' || checkoutStatus === 'both') {
                        return <FolderOpen size={16} className="text-plm-error" />
                      }
                      if (checkoutStatus === 'mine') {
                        return <FolderOpen size={16} className="text-plm-warning" />
                      }
                      // All synced - green
                      if (isFolderSynced(pinned.path)) {
                        return <FolderOpen size={16} className="text-plm-success" />
                      }
                    }
                    // Default - grey
                    return <FolderOpen size={16} className="text-plm-fg-muted" />
                  }
                  // For files, use OS icon if we have the actual file
                  if (actualFile) {
                    return <ExplorerFileIcon file={actualFile} size={16} />
                  }
                  // Fallback to React icons based on extension from name
                  const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '')
                  const iconType = getFileIconType(ext)
                  switch (iconType) {
                    case 'part':
                      return <FileBox size={16} className="text-plm-accent" />
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
                      return <FileText size={16} className="text-plm-fg-muted" />
                    default:
                      return <File size={16} className="text-plm-fg-muted" />
                  }
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
                      <span className="truncate text-sm flex-1" title={pinned.path}>
                        {pinned.isDirectory ? pinned.path : fileName}
                      </span>
                      
                      {/* Vault label if from different vault */}
                      {pinned.vaultId !== activeVaultId && (
                        <span className="text-[10px] text-plm-fg-muted truncate max-w-[60px]" title={pinned.vaultName}>
                          {pinned.vaultName}
                        </span>
                      )}
                      
                      {/* Status icon */}
                      {getPinnedStatusIcon()}
                      
                      {/* Diff counts and local-only count for folders */}
                      {pinned.isDirectory && (hasDiffs || localOnlyCount > 0) && (
                        <span className="flex items-center gap-1 ml-1 text-xs">
                          {localOnlyCount > 0 && (
                            <span className="text-plm-fg-muted font-medium flex items-center gap-0.5" title={`${localOnlyCount} local files not yet synced`}>
                              <HardDrive size={10} />
                              {localOnlyCount}
                            </span>
                          )}
                          {diffCounts && diffCounts.modified > 0 && (
                            <span className="text-plm-warning font-medium flex items-center gap-0.5"><ArrowUp size={10} />{diffCounts.modified}</span>
                          )}
                          {diffCounts && diffCounts.moved > 0 && (
                            <span className="text-plm-accent font-medium">→{diffCounts.moved}</span>
                          )}
                          {diffCounts && diffCounts.deleted > 0 && (
                            <span className="text-plm-error font-medium">-{diffCounts.deleted}</span>
                          )}
                          {diffCounts && diffCounts.outdated > 0 && (
                            <span className="text-purple-400 font-medium">↓{diffCounts.outdated}</span>
                          )}
                          {diffCounts && diffCounts.cloud > 0 && (
                            <span className="text-plm-fg-muted font-medium flex items-center gap-0.5">
                              <Cloud size={10} />
                              {diffCounts.cloud}
                            </span>
                          )}
                        </span>
                      )}
                      
                      {/* Inline action buttons for pinned items */}
                      {actualFile && pinned.vaultId === activeVaultId && (() => {
                        const isPinnedProcessing = isBeingProcessed(actualFile.relativePath)
                        const hasCloudFiles = actualFile.isDirectory && files.some(f => 
                          !f.isDirectory && f.diffStatus === 'cloud' && f.relativePath.startsWith(actualFile.relativePath + '/')
                        )
                        const checkoutableFilesCount = actualFile.isDirectory 
                          ? files.filter(f => 
                              !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.relativePath.startsWith(actualFile.relativePath + '/')
                            ).length
                          : 0
                        const hasMyCheckedOutFiles = actualFile.isDirectory && files.some(f => 
                          !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.relativePath.startsWith(actualFile.relativePath + '/')
                        )
                        
                        const showDownload = !isPinnedProcessing && (actualFile.diffStatus === 'cloud' || hasCloudFiles)
                        const showCheckout = !isPinnedProcessing && ((!actualFile.isDirectory && actualFile.pdmData && !actualFile.pdmData.checked_out_by && actualFile.diffStatus !== 'cloud') || checkoutableFilesCount > 0)
                        const showCheckin = !isPinnedProcessing && ((!actualFile.isDirectory && actualFile.pdmData?.checked_out_by === user?.id) || hasMyCheckedOutFiles)
                        
                        if (!showDownload && !showCheckout && !showCheckin) return null
                        
                        return (
                          <span className="inline-actions flex items-center gap-0.5 ml-1">
                            {showDownload && (
                              <button
                                className="p-0.5 rounded hover:bg-sky-400/20 text-sky-400"
                                onClick={(e) => handleInlineDownload(e, actualFile)}
                                title="Download"
                              >
                                <ArrowDown size={12} />
                              </button>
                            )}
                            {showCheckout && (
                              <button
                                className="p-0.5 rounded hover:bg-plm-warning/20 text-plm-warning"
                                onClick={(e) => handleInlineCheckout(e, actualFile)}
                                title={actualFile.isDirectory && checkoutableFilesCount > 0 ? `Check out ${checkoutableFilesCount} file${checkoutableFilesCount > 1 ? 's' : ''}` : "Check Out"}
                              >
                                <ArrowDown size={12} />
                              </button>
                            )}
                            {showCheckin && (
                              <button
                                className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success"
                                onClick={(e) => handleInlineCheckin(e, actualFile)}
                                title="Check In"
                              >
                                <ArrowUp size={12} />
                              </button>
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
                <div className="p-2 bg-plm-accent/20 rounded-lg">
                  <Database size={20} className="text-plm-accent" />
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
