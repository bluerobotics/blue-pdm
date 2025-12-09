import { useState, useEffect } from 'react'
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
  Check
} from 'lucide-react'
import { checkoutFile, checkinFile } from '../../lib/supabase'
import { downloadFile } from '../../lib/storage'
import { usePDMStore, LocalFile, ConnectedVault } from '../../stores/pdmStore'
import { getFileIconType } from '../../types/pdm'
import { FileContextMenu } from '../FileContextMenu'

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

// Get parent directory from a path
function getParentDir(fullPath: string): string {
  const lastSlash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
  return lastSlash > 0 ? fullPath.substring(0, lastSlash) : fullPath
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
    setActiveVault,
    addToast,
    pinnedFolders,
    unpinFolder,
    pinnedSectionExpanded,
    togglePinnedSection,
    reorderPinnedFolders,
    renameFileInStore,
    updateFileInStore,
    user,
    organization,
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
    isProgressToastCancelled,
    addProcessingFolder,
    removeProcessingFolder,
    removeConnectedVault,
    setFiles,
    setServerFiles,
    setFilesLoaded,
    setVaultPath,
    setVaultConnected,
  } = usePDMStore()
  
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(null)
  const [vaultContextMenu, setVaultContextMenu] = useState<{ x: number; y: number; vault: ConnectedVault } | null>(null)
  const [disconnectingVault, setDisconnectingVault] = useState<ConnectedVault | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
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
  
  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])
  
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
    const modifiedFiles = files.filter(f => !f.isDirectory && f.diffStatus === 'modified')
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
    
    const oldPath = renamingFile.path
    const newName = renameValue.trim()
    
    if (newName === renamingFile.name) {
      setRenamingFile(null)
      return
    }
    
    // Build new path (use the same path separator as the original)
    const pathSep = oldPath.includes('/') ? '/' : '\\'
    const pathParts = oldPath.split(/[/\\]/)
    pathParts[pathParts.length - 1] = newName
    const newPath = pathParts.join(pathSep)
    
    const result = await window.electronAPI?.moveFile(oldPath, newPath)
    if (result?.success) {
      addToast('success', `Renamed to ${newName}`)
      // Update file in store directly instead of full refresh
      renameFileInStore(oldPath, newPath, newName)
    } else {
      addToast('error', result?.error || 'Failed to rename')
    }
    setRenamingFile(null)
  }
  
  const handleCopy = () => {
    if (!contextMenu?.file) return
    setClipboard({ files: [contextMenu.file], operation: 'copy' })
    addToast('info', `Copied ${contextMenu.file.name}`)
  }
  
  const handleCut = () => {
    if (!contextMenu?.file) return
    setClipboard({ files: [contextMenu.file], operation: 'cut' })
    addToast('info', `Cut ${contextMenu.file.name}`)
  }
  
  const handlePaste = async () => {
    if (!clipboard || !contextMenu?.file || !vaultPath) return
    
    // Handle both Windows (\) and Unix (/) path separators
    const lastSepIndex = Math.max(contextMenu.file.path.lastIndexOf('/'), contextMenu.file.path.lastIndexOf('\\'))
    const targetFolder = contextMenu.file.isDirectory 
      ? contextMenu.file.path 
      : contextMenu.file.path.substring(0, lastSepIndex)
    
    for (const file of clipboard.files) {
      const destPath = `${targetFolder}/${file.name}`
      
      if (clipboard.operation === 'copy') {
        await window.electronAPI?.copyFile(file.path, destPath)
      } else {
        await window.electronAPI?.moveFile(file.path, destPath)
      }
    }
    
    if (clipboard.operation === 'cut') {
      setClipboard(null)
    }
    
    addToast('success', `${clipboard.operation === 'copy' ? 'Copied' : 'Moved'} ${clipboard.files.length} item(s)`)
    onRefresh?.(true)
  }
  
  const handleRename = (file: LocalFile) => {
    // Use a simple prompt for rename
    const newName = window.prompt('Enter new name:', file.name)
    if (newName && newName !== file.name) {
      // Handle both Windows (\) and Unix (/) path separators
      const lastSepIndex = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'))
      const newPath = file.path.substring(0, lastSepIndex + 1) + newName
      window.electronAPI?.moveFile(file.path, newPath).then((result: { success: boolean; error?: string } | undefined) => {
        if (result?.success) {
          addToast('success', `Renamed to ${newName}`)
          // Update file in store directly instead of full refresh
          renameFileInStore(file.path, newPath, newName)
        } else {
          addToast('error', 'Failed to rename')
        }
      })
    }
  }
  
  const handleNewFolder = async () => {
    if (!contextMenu?.file || !vaultPath) return
    
    // Handle both Windows (\) and Unix (/) path separators
    const lastSepIndex = Math.max(contextMenu.file.path.lastIndexOf('/'), contextMenu.file.path.lastIndexOf('\\'))
    const targetFolder = contextMenu.file.isDirectory 
      ? contextMenu.file.path 
      : contextMenu.file.path.substring(0, lastSepIndex)
    
    const folderName = window.prompt('Enter folder name:', 'New Folder')
    if (folderName) {
      const newPath = `${targetFolder}/${folderName}`
      const result = await window.electronAPI?.ensureDir(newPath)
      if (result?.success) {
        addToast('success', `Created folder ${folderName}`)
        onRefresh?.(true)
      } else {
        addToast('error', 'Failed to create folder')
      }
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

  // Check if all files in a folder are synced
  const isFolderSynced = (folderPath: string): boolean => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    if (folderFiles.length === 0) return false
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

  // Check if a file/folder is affected by any processing operation
  const isBeingProcessed = (relativePath: string) => {
    // Check if this exact path is being processed
    if (processingFolders.has(relativePath)) return true
    // Check if any parent folder is being processed
    for (const processingPath of processingFolders) {
      if (relativePath.startsWith(processingPath + '/')) return true
    }
    return false
  }

  // Inline action: Download a single file
  const handleInlineDownload = async (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    if (!organization || !vaultPath) return
    
    // Get files to download
    let filesToDownload: LocalFile[] = []
    if (file.isDirectory) {
      filesToDownload = files.filter(f => 
        !f.isDirectory && 
        f.diffStatus === 'cloud' &&
        f.relativePath.startsWith(file.relativePath + '/')
      )
    } else if (file.diffStatus === 'cloud') {
      filesToDownload = [file]
    }
    
    if (filesToDownload.length === 0) return
    
    addProcessingFolder(file.relativePath)
    const toastId = `download-${Date.now()}`
    addProgressToast(toastId, `Downloading ${file.name}...`, filesToDownload.length)
    
    let succeeded = 0
    for (let i = 0; i < filesToDownload.length; i++) {
      if (isProgressToastCancelled(toastId)) break
      
      const f = filesToDownload[i]
      if (!f.pdmData?.content_hash) continue
      
      try {
        const { data, error } = await downloadFile(organization.id, f.pdmData.content_hash)
        if (!error && data) {
          const fullPath = buildFullPath(vaultPath, f.relativePath)
          const parentDir = getParentDir(fullPath)
          await window.electronAPI?.createFolder(parentDir)
          
          const arrayBuffer = await data.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          const chunkSize = 8192
          for (let j = 0; j < bytes.length; j += chunkSize) {
            const chunk = bytes.subarray(j, Math.min(j + chunkSize, bytes.length))
            binary += String.fromCharCode.apply(null, Array.from(chunk))
          }
          const base64 = btoa(binary)
          
          const result = await window.electronAPI?.writeFile(fullPath, base64)
          if (result?.success) {
            await window.electronAPI?.setReadonly(fullPath, true)
            succeeded++
          }
        }
      } catch (err) {
        console.error('Download error:', err)
      }
      
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / filesToDownload.length) * 100))
    }
    
    removeToast(toastId)
    removeProcessingFolder(file.relativePath)
    
    if (succeeded > 0) {
      addToast('success', `Downloaded ${succeeded} file${succeeded > 1 ? 's' : ''}`)
      onRefresh?.(true)
    }
  }

  // Inline action: Check out a single file or folder
  const handleInlineCheckout = async (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    if (!user) return
    
    // Get files to checkout
    let filesToCheckout: LocalFile[] = []
    if (file.isDirectory) {
      filesToCheckout = files.filter(f => 
        !f.isDirectory && 
        f.pdmData && 
        !f.pdmData.checked_out_by &&
        f.diffStatus !== 'cloud' &&
        f.relativePath.startsWith(file.relativePath + '/')
      )
    } else if (file.pdmData?.id && !file.pdmData.checked_out_by) {
      filesToCheckout = [file]
    }
    
    if (filesToCheckout.length === 0) {
      addToast('info', 'No files to check out')
      return
    }
    
    // Add folder spinner and progress toast
    if (file.isDirectory) {
      addProcessingFolder(file.relativePath)
    }
    const toastId = `checkout-${Date.now()}`
    addProgressToast(toastId, `Checking out ${filesToCheckout.length} file${filesToCheckout.length > 1 ? 's' : ''}...`, filesToCheckout.length)
    
    let succeeded = 0
    for (let i = 0; i < filesToCheckout.length; i++) {
      const f = filesToCheckout[i]
      try {
        const result = await checkoutFile(f.pdmData!.id, user.id)
        if (result.success) {
          await window.electronAPI?.setReadonly(f.path, false)
          updateFileInStore(f.path, {
            pdmData: { 
              ...f.pdmData!, 
              checked_out_by: user.id,
              checked_out_user: { 
                full_name: user.full_name, 
                email: user.email, 
                avatar_url: user.avatar_url 
              }
            }
          })
          succeeded++
        }
      } catch (err) {
        console.error('Checkout error:', err)
      }
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / filesToCheckout.length) * 100))
    }
    
    // Clean up
    if (file.isDirectory) {
      removeProcessingFolder(file.relativePath)
    }
    removeToast(toastId)
    
    if (succeeded > 0) {
      addToast('success', `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
  }

  // Inline action: Check in a single file or folder
  const handleInlineCheckin = async (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    if (!user) return
    
    // Get files to checkin
    let filesToCheckin: LocalFile[] = []
    if (file.isDirectory) {
      filesToCheckin = files.filter(f => 
        !f.isDirectory && 
        f.pdmData?.checked_out_by === user.id &&
        f.relativePath.startsWith(file.relativePath + '/')
      )
    } else if (file.pdmData?.id && file.pdmData.checked_out_by === user.id) {
      filesToCheckin = [file]
    }
    
    if (filesToCheckin.length === 0) {
      addToast('info', 'No files to check in')
      return
    }
    
    // Add folder spinner and progress toast
    if (file.isDirectory) {
      addProcessingFolder(file.relativePath)
    }
    const toastId = `checkin-${Date.now()}`
    addProgressToast(toastId, `Checking in ${filesToCheckin.length} file${filesToCheckin.length > 1 ? 's' : ''}...`, filesToCheckin.length)
    
    let succeeded = 0
    for (let i = 0; i < filesToCheckin.length; i++) {
      const f = filesToCheckin[i]
      try {
        const result = await checkinFile(f.pdmData!.id, user.id)
        if (result.success) {
          await window.electronAPI?.setReadonly(f.path, true)
          updateFileInStore(f.path, {
            pdmData: { ...f.pdmData!, checked_out_by: null, checked_out_user: null }
          })
          succeeded++
        }
      } catch (err) {
        console.error('Checkin error:', err)
      }
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / filesToCheckin.length) * 100))
    }
    
    // Clean up
    if (file.isDirectory) {
      removeProcessingFolder(file.relativePath)
    }
    removeToast(toastId)
    
    if (succeeded > 0) {
      addToast('success', `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
  }

  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      // Check if folder is being processed (downloading/deleting) or is inside a processing folder
      if (isBeingProcessed(file.relativePath)) {
        return <Loader2 size={16} className="text-sky-400 animate-spin" />
      }
      // Cloud-only folders (exist on server but not locally)
      if (file.diffStatus === 'cloud') {
        return <FolderOpen size={16} className="text-pdm-fg-muted opacity-50" />
      }
      const hasCheckedOut = hasFolderCheckedOutFiles(file.relativePath)
      if (hasCheckedOut) {
        return <FolderOpen size={16} className="text-pdm-warning" />
      }
      const synced = isFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-pdm-success' : 'text-pdm-fg-muted'} />
    }
    
    // Check if file is inside a processing folder
    if (isBeingProcessed(file.relativePath)) {
      return <Loader2 size={16} className="text-sky-400 animate-spin" />
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
            name: 'You',
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
    
    // For folders - show stacked avatars of users with checkouts
    if (file.isDirectory) {
      const checkoutUsers = getFolderCheckoutUsers(file.relativePath)
      if (checkoutUsers.length === 0) return null
      
      const maxShow = 3
      const shown = checkoutUsers.slice(0, maxShow)
      const extra = checkoutUsers.length - maxShow
      
      return (
        <span className="flex items-center flex-shrink-0 -space-x-1.5" title={checkoutUsers.map(u => u.name).join(', ')}>
          {shown.map((u, i) => (
            u.avatar_url ? (
              <img 
                key={u.id}
                src={u.avatar_url} 
                alt={u.name}
                className={`w-4 h-4 rounded-full ring-1 ${u.isMe ? 'ring-pdm-warning' : 'ring-pdm-error'} bg-pdm-bg`}
                style={{ zIndex: maxShow - i }}
              />
            ) : (
              <div 
                key={u.id}
                className={`w-4 h-4 rounded-full ring-1 ${u.isMe ? 'ring-pdm-warning bg-pdm-warning/30' : 'ring-pdm-error bg-pdm-error/30'} flex items-center justify-center text-[8px] bg-pdm-bg`}
                style={{ zIndex: maxShow - i }}
              >
                {u.name.charAt(0).toUpperCase()}
              </div>
            )
          ))}
          {extra > 0 && (
            <div 
              className="w-4 h-4 rounded-full ring-1 ring-pdm-fg-muted bg-pdm-bg flex items-center justify-center text-[8px] text-pdm-fg-muted"
              style={{ zIndex: 0 }}
            >
              +{extra}
            </div>
          )}
        </span>
      )
    }
    
    // For files:
    // Checked out by me - show my avatar with orange ring
    if (file.pdmData?.checked_out_by === user?.id) {
      if (user?.avatar_url) {
        return (
          <img 
            src={user.avatar_url} 
            alt="You"
            title="Checked out by you"
            className="w-4 h-4 rounded-full flex-shrink-0 ring-1 ring-pdm-warning"
          />
        )
      }
      return <span title="Checked out by you"><Lock size={12} className="text-pdm-warning flex-shrink-0" /></span>
    }
    
    // Checked out by someone else - show their avatar with red ring
    if (file.pdmData?.checked_out_by) {
      const checkedOutUser = (file.pdmData as any).checked_out_user
      const avatarUrl = checkedOutUser?.avatar_url
      const displayName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'
      
      if (avatarUrl) {
        return (
          <img 
            src={avatarUrl} 
            alt={displayName}
            title={`Checked out by ${displayName}`}
            className="w-4 h-4 rounded-full flex-shrink-0 ring-1 ring-pdm-error"
          />
        )
      }
      return <span title={`Checked out by ${displayName}`}><Lock size={12} className="text-pdm-error flex-shrink-0" /></span>
    }
    
    // Cloud-only (not downloaded) - grey cloud
    if (file.diffStatus === 'cloud') {
      return <Cloud size={12} className="text-pdm-fg-muted flex-shrink-0" />
    }
    
    // Synced (has pdmData and downloaded locally) - green cloud
    if (file.pdmData) {
      return <Cloud size={12} className="text-pdm-success flex-shrink-0" />
    }
    
    // Not synced - no icon
    return null
  }

  const renderTreeItem = (file: LocalFile, depth: number = 0) => {
    const isExpanded = expandedFolders.has(file.relativePath)
    const isCurrentFolder = file.isDirectory && file.relativePath === currentFolder
    const children = tree[file.relativePath] || []
    
    // Get diff counts for folders
    const diffCounts = file.isDirectory ? getFolderDiffCounts(file.relativePath) : null
    const hasDiffs = diffCounts && (diffCounts.added > 0 || diffCounts.modified > 0 || diffCounts.deleted > 0 || diffCounts.outdated > 0 || diffCounts.cloud > 0)
    
    // Diff class for files and deleted folders
    const diffClass = file.diffStatus 
      ? `sidebar-diff-${file.diffStatus}` : ''

    const isSelected = selectedFiles.includes(file.path)
    const isRenaming = renamingFile?.relativePath === file.relativePath
    const isProcessing = isBeingProcessed(file.relativePath)

    return (
      <div key={file.path}>
        <div
          className={`tree-item group ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass}`}
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
            // If right-clicked file is not in selection, select only it
            // Otherwise keep the multi-selection
            if (!selectedFiles.includes(file.path)) {
              setSelectedFiles([file.path])
            }
            setContextMenu({ x: e.clientX, y: e.clientY, file })
          }}
          draggable={!file.isDirectory && file.diffStatus !== 'cloud'}
          onDragStart={(e) => {
            // Get files to drag
            let filesToDrag: LocalFile[]
            if (selectedFiles.includes(file.path) && selectedFiles.length > 1) {
              filesToDrag = files.filter(f => selectedFiles.includes(f.path) && !f.isDirectory && f.diffStatus !== 'cloud')
            } else if (!file.isDirectory && file.diffStatus !== 'cloud') {
              filesToDrag = [file]
            } else {
              e.preventDefault()
              return
            }
            
            if (filesToDrag.length === 0) {
              e.preventDefault()
              return
            }
            
            const filePaths = filesToDrag.map(f => f.path)
            console.log('[Drag] Starting native drag for:', filePaths)
            
            // Set up HTML5 drag data
            e.dataTransfer.effectAllowed = 'copyMove'
            e.dataTransfer.setData('text/plain', filePaths.join('\n'))
            
            // Use DownloadURL format for single file - enables actual file copy
            if (filesToDrag.length === 1) {
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
            dragPreview.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>${filesToDrag.length > 1 ? filesToDrag.length + ' files' : file.name}`
            document.body.appendChild(dragPreview)
            e.dataTransfer.setDragImage(dragPreview, 20, 20)
            setTimeout(() => dragPreview.remove(), 0)
            
            // Call Electron's native drag for multi-file support
            window.electronAPI?.startDrag(filePaths)
          }}
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
                ? <ChevronDown size={14} className="text-pdm-fg-muted" /> 
                : <ChevronRight size={14} className="text-pdm-fg-muted" />
              }
            </span>
          )}
          {!file.isDirectory && <span className="w-[14px] mr-1" />}
          <span className="tree-item-icon">{getFileIcon(file)}</span>
          
          {/* File name - editable when renaming */}
          {isRenaming ? (
            <input
              type="text"
              className="flex-1 text-sm bg-pdm-bg border border-pdm-accent rounded px-1 py-0.5 outline-none"
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
            <span className={`truncate text-sm flex-1 ${file.diffStatus === 'cloud' ? 'italic text-pdm-fg-muted' : ''}`}>
              {file.isDirectory || !file.extension 
                ? file.name 
                : file.name.slice(0, -file.extension.length) + (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
            </span>
          )}
          
          {/* Status icon (lock, cloud) */}
          {!isRenaming && getStatusIcon(file)}
          
          {/* Inline action buttons - show on hover */}
          {!isRenaming && !isBeingProcessed(file.relativePath) && (() => {
            // Check if folder has cloud files
            const hasCloudFiles = file.isDirectory && files.some(f => 
              !f.isDirectory && f.diffStatus === 'cloud' && f.relativePath.startsWith(file.relativePath + '/')
            )
            // Check if folder has checkoutable files
            const hasCheckoutableFiles = file.isDirectory && files.some(f => 
              !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.relativePath.startsWith(file.relativePath + '/')
            )
            // Check if folder has my checked out files
            const hasMyCheckedOutFiles = file.isDirectory && files.some(f => 
              !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.relativePath.startsWith(file.relativePath + '/')
            )
            
            const showDownload = file.diffStatus === 'cloud' || hasCloudFiles
            const showCheckout = (!file.isDirectory && file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud') || hasCheckoutableFiles
            const showCheckin = (!file.isDirectory && file.pdmData?.checked_out_by === user?.id) || hasMyCheckedOutFiles
            
            if (!showDownload && !showCheckout && !showCheckin) return null
            
            if (!showCheckout && !showCheckin) return null
            
            return (
              <span className="inline-actions flex items-center gap-0.5 ml-1">
                {/* Check Out - for synced files/folders not checked out */}
                {showCheckout && (
                  <button
                    className="p-0.5 rounded hover:bg-pdm-warning/20 text-pdm-warning"
                    onClick={(e) => handleInlineCheckout(e, file)}
                    title="Check Out"
                  >
                    <ArrowDown size={12} />
                  </button>
                )}
                {/* Check In - for files/folders checked out by me */}
                {showCheckin && (
                  <button
                    className="p-0.5 rounded hover:bg-pdm-success/20 text-pdm-success"
                    onClick={(e) => handleInlineCheckin(e, file)}
                    title="Check In"
                  >
                    <ArrowUp size={12} />
                  </button>
                )}
              </span>
            )
          })()}
          
          {/* Diff counts for folders */}
          {!isRenaming && file.isDirectory && hasDiffs && (
            <span className="flex items-center gap-1 ml-2 text-xs">
              {diffCounts.added > 0 && (
                <span className="text-pdm-success font-medium">+{diffCounts.added}</span>
              )}
              {diffCounts.modified > 0 && (
                <span className="text-pdm-warning font-medium">~{diffCounts.modified}</span>
              )}
              {diffCounts.deleted > 0 && (
                <span className="text-pdm-error font-medium">-{diffCounts.deleted}</span>
              )}
              {diffCounts.outdated > 0 && (
                <span className="text-purple-400 font-medium">↓{diffCounts.outdated}</span>
              )}
              {diffCounts.cloud > 0 && (
                <span className="text-pdm-fg-muted font-medium flex items-center gap-0.5">
                  <Cloud size={10} />
                  {diffCounts.cloud}
                  {/* Download button right after cloud count */}
                  <button
                    className="inline-actions p-0.5 rounded hover:bg-pdm-success/20 text-pdm-success ml-0.5"
                    onClick={(e) => handleInlineDownload(e, file)}
                    title="Download cloud files"
                  >
                    <ArrowDown size={10} />
                  </button>
                </span>
              )}
            </span>
          )}
          
          {/* Download for individual cloud files (not folders) */}
          {!isRenaming && !file.isDirectory && file.diffStatus === 'cloud' && (
            <button
              className="inline-actions p-0.5 rounded hover:bg-pdm-success/20 text-pdm-success ml-1"
              onClick={(e) => handleInlineDownload(e, file)}
              title="Download"
            >
              <ArrowDown size={12} />
            </button>
          )}
          
        </div>
        {file.isDirectory && isExpanded && children
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
    )
  }

  // Render a connected vault section
  const renderVaultSection = (vault: ConnectedVault) => {
    const isActive = activeVaultId === vault.id
    const isExpanded = vault.isExpanded
    
    // Calculate vault stats when active
    const cloudFilesCount = isActive ? files.filter(f => !f.isDirectory && f.diffStatus === 'cloud').length : 0
    const checkedOutByMeCount = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id).length : 0
    const checkedOutByOthers = isActive ? files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id) : []
    
    // Get unique users who have files checked out (excluding me)
    const otherCheckoutUsers = isActive ? [...new Map(
      checkedOutByOthers
        .filter(f => f.pdmData?.checked_out_user)
        .map(f => [f.pdmData!.checked_out_by, f.pdmData!.checked_out_user])
    ).values()] : []
    
    return (
      <div key={vault.id} className="border-b border-pdm-border last:border-b-0">
        {/* Vault header */}
        <div 
          className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
            isActive ? 'bg-pdm-highlight text-pdm-fg' : 'text-pdm-fg-dim hover:bg-pdm-highlight/50'
          }`}
          onClick={() => {
            setActiveVault(vault.id)
            setCurrentFolder('') // Go to root
            if (!isExpanded) {
              toggleVaultExpanded(vault.id)
            }
          }}
          onContextMenu={(e) => handleVaultContextMenu(e, vault)}
        >
          <span 
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              toggleVaultExpanded(vault.id)
            }}
          >
            {isExpanded 
              ? <ChevronDown size={14} className="text-pdm-fg-muted" />
              : <ChevronRight size={14} className="text-pdm-fg-muted" />
            }
          </span>
          <Database size={16} className={isActive ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
          <span className="flex-1 truncate text-sm font-medium">
            {vault.name}
          </span>
          
          {/* Inline badges and actions */}
          {isActive && (
            <div className="flex items-center gap-1">
              {/* Stacked avatars of users with checkouts */}
              {otherCheckoutUsers.length > 0 && (
                <div className="flex -space-x-1.5" title={`${otherCheckoutUsers.length} user${otherCheckoutUsers.length > 1 ? 's' : ''} have files checked out`}>
                  {otherCheckoutUsers.slice(0, 3).map((u: any, i) => (
                    <div key={i} className="w-5 h-5 rounded-full ring-1 ring-pdm-bg-light overflow-hidden flex-shrink-0">
                      {u?.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-pdm-accent/30 flex items-center justify-center text-[10px] font-medium text-pdm-accent">
                          {u?.full_name?.[0] || u?.email?.[0] || '?'}
                        </div>
                      )}
                    </div>
                  ))}
                  {otherCheckoutUsers.length > 3 && (
                    <div className="w-5 h-5 rounded-full ring-1 ring-pdm-bg-light bg-pdm-bg-light flex items-center justify-center text-[9px] text-pdm-fg-muted flex-shrink-0">
                      +{otherCheckoutUsers.length - 3}
                    </div>
                  )}
                </div>
              )}
              
              {/* My checkouts indicator - moved left */}
              {checkedOutByMeCount > 0 && (
                <div 
                  className="flex items-center gap-0.5 text-[10px] text-pdm-accent bg-pdm-accent/10 px-1.5 py-0.5 rounded"
                  title={`${checkedOutByMeCount} files checked out by you`}
                >
                  <Lock size={10} />
                  <span>{checkedOutByMeCount}</span>
                </div>
              )}
              
              {/* Cloud files indicator */}
              {cloudFilesCount > 0 && (
                <div 
                  className="flex items-center gap-0.5 text-[10px] text-pdm-fg-muted bg-pdm-bg/50 px-1.5 py-0.5 rounded"
                  title={`${cloudFilesCount} files available to download`}
                >
                  <Cloud size={10} />
                  <span>{cloudFilesCount}</span>
                </div>
              )}
              
              {/* Download all cloud files button - slightly visible */}
              {cloudFilesCount > 0 && (
                <button
                  className="p-1 rounded hover:bg-pdm-bg/50 text-pdm-fg-muted/50 hover:text-pdm-success transition-colors"
                  title={`Download ${cloudFilesCount} cloud files`}
                  onClick={(e) => {
                    e.stopPropagation()
                    // TODO: Implement bulk download
                    addToast('info', `Download all ${cloudFilesCount} cloud files coming soon!`)
                  }}
                >
                  <ArrowDown size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        
        {/* Vault contents */}
        {isExpanded && isActive && (
          <div className="pb-2">
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
            
            {tree[''].length === 0 && !isLoading && filesLoaded && (
              <div className="px-4 py-4 text-center text-pdm-fg-muted text-xs">
                No files in vault
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
            className={`px-3 py-2 border-b border-pdm-border flex items-center gap-2 cursor-pointer transition-colors ${
              currentFolder === '' ? 'text-pdm-accent font-medium' : 'text-pdm-fg-muted hover:text-pdm-fg'
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
          
          {rootItems.length === 0 && !isLoading && filesLoaded && (
            <div className="px-4 py-8 text-center text-pdm-fg-muted text-sm">
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
            <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
              Recent Vaults
            </div>
            {recentVaults.map(vault => (
              <button
                key={vault}
                onClick={() => onOpenRecentVault(vault)}
                className="w-full text-left px-2 py-1.5 text-sm text-pdm-fg-dim hover:bg-pdm-highlight rounded truncate"
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
        <div className="border-b border-pdm-border">
          {/* Pinned header - collapsible */}
          <div 
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-pdm-highlight/30"
            onClick={() => togglePinnedSection()}
          >
            <span className="cursor-pointer">
              {pinnedSectionExpanded 
                ? <ChevronDown size={14} className="text-pdm-fg-muted" /> 
                : <ChevronRight size={14} className="text-pdm-fg-muted" />
              }
            </span>
            <Pin size={14} className="text-pdm-accent fill-pdm-accent" />
            <span className="text-sm font-medium flex-1">Pinned</span>
            <span className="text-xs text-pdm-fg-muted">{pinnedFolders.length}</span>
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
                
                // Get diff counts for pinned folders
                const diffCounts = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? getFolderDiffCounts(pinned.path)
                  : null
                const hasDiffs = diffCounts && (diffCounts.added > 0 || diffCounts.modified > 0 || diffCounts.deleted > 0 || diffCounts.outdated > 0 || diffCounts.cloud > 0)
                
                // Get status icon for pinned file
                const getPinnedStatusIcon = () => {
                  if (!actualFile) return null
                  if (actualFile.isDirectory) return null
                  const { user } = usePDMStore.getState()
                  if (actualFile.pdmData?.checked_out_by === user?.id) {
                    if (user?.avatar_url) {
                      return (
                        <img 
                          src={user.avatar_url} 
                          alt="You"
                          title="Checked out by you"
                          className="w-4 h-4 rounded-full flex-shrink-0 ring-1 ring-pdm-warning"
                        />
                      )
                    }
                    return <span title="Checked out by you"><Lock size={12} className="text-pdm-warning flex-shrink-0" /></span>
                  }
                  if (actualFile.pdmData?.checked_out_by) {
                    const checkedOutUser = (actualFile.pdmData as any).checked_out_user
                    const avatarUrl = checkedOutUser?.avatar_url
                    const displayName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone'
                    
                    if (avatarUrl) {
                      return (
                        <img 
                          src={avatarUrl} 
                          alt={displayName}
                          title={`Checked out by ${displayName}`}
                          className="w-4 h-4 rounded-full flex-shrink-0 ring-1 ring-pdm-error"
                        />
                      )
                    }
                    return <span title={`Checked out by ${displayName}`}><Lock size={12} className="text-pdm-error flex-shrink-0" /></span>
                  }
                  if (actualFile.diffStatus === 'cloud') {
                    return <Cloud size={12} className="text-pdm-fg-muted flex-shrink-0" />
                  }
                  if (actualFile.pdmData) {
                    return <Cloud size={12} className="text-pdm-success flex-shrink-0" />
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
                        return <FolderOpen size={16} className="text-pdm-fg-muted opacity-50" />
                      }
                      // Has checked out files - orange
                      if (hasFolderCheckedOutFiles(pinned.path)) {
                        return <FolderOpen size={16} className="text-pdm-warning" />
                      }
                      // All synced - green
                      if (isFolderSynced(pinned.path)) {
                        return <FolderOpen size={16} className="text-pdm-success" />
                      }
                    }
                    // Default - grey
                    return <FolderOpen size={16} className="text-pdm-fg-muted" />
                  }
                  // For files, use actualFile.extension if available, otherwise parse from name
                  const ext = actualFile?.extension || ('.' + (fileName.split('.').pop()?.toLowerCase() || ''))
                  const iconType = getFileIconType(ext)
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
                      className={`tree-item group ${diffClass} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-pdm-accent' : ''}`}
                      style={{ paddingLeft: pinned.isDirectory ? 8 : 24, cursor: 'grab' }}
                      onClick={() => {
                        // Switch to the vault and navigate
                        if (pinned.vaultId !== activeVaultId) {
                          setActiveVault(pinned.vaultId)
                        }
                        // Always set current folder (for files, navigate to parent)
                        if (pinned.isDirectory) {
                          setCurrentFolder(pinned.path)
                        } else {
                          const parentPath = pinned.path.split('/').slice(0, -1).join('/') || ''
                          setCurrentFolder(parentPath)
                        }
                        // Expand the vault if not expanded
                        if (vault && !vault.isExpanded) {
                          toggleVaultExpanded(pinned.vaultId)
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
                            ? <ChevronDown size={14} className="text-pdm-fg-muted" /> 
                            : <ChevronRight size={14} className="text-pdm-fg-muted" />
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
                        <span className="text-[10px] text-pdm-fg-muted truncate max-w-[60px]" title={pinned.vaultName}>
                          {pinned.vaultName}
                        </span>
                      )}
                      
                      {/* Status icon */}
                      {getPinnedStatusIcon()}
                      
                      {/* Diff counts for folders */}
                      {pinned.isDirectory && hasDiffs && (
                        <span className="flex items-center gap-1 ml-1 text-xs">
                          {diffCounts.added > 0 && (
                            <span className="text-pdm-success font-medium">+{diffCounts.added}</span>
                          )}
                          {diffCounts.modified > 0 && (
                            <span className="text-pdm-warning font-medium">~{diffCounts.modified}</span>
                          )}
                          {diffCounts.deleted > 0 && (
                            <span className="text-pdm-error font-medium">-{diffCounts.deleted}</span>
                          )}
                          {diffCounts.outdated > 0 && (
                            <span className="text-purple-400 font-medium">↓{diffCounts.outdated}</span>
                          )}
                          {diffCounts.cloud > 0 && (
                            <span className="text-pdm-fg-muted font-medium flex items-center gap-0.5">
                              <Cloud size={10} />
                              {diffCounts.cloud}
                            </span>
                          )}
                        </span>
                      )}
                      
                      {/* Inline action buttons for pinned items */}
                      {actualFile && pinned.vaultId === activeVaultId && (() => {
                        const hasCloudFiles = actualFile.isDirectory && files.some(f => 
                          !f.isDirectory && f.diffStatus === 'cloud' && f.relativePath.startsWith(actualFile.relativePath + '/')
                        )
                        const hasCheckoutableFiles = actualFile.isDirectory && files.some(f => 
                          !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.relativePath.startsWith(actualFile.relativePath + '/')
                        )
                        const hasMyCheckedOutFiles = actualFile.isDirectory && files.some(f => 
                          !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.relativePath.startsWith(actualFile.relativePath + '/')
                        )
                        
                        const showDownload = actualFile.diffStatus === 'cloud' || hasCloudFiles
                        const showCheckout = (!actualFile.isDirectory && actualFile.pdmData && !actualFile.pdmData.checked_out_by && actualFile.diffStatus !== 'cloud') || hasCheckoutableFiles
                        const showCheckin = (!actualFile.isDirectory && actualFile.pdmData?.checked_out_by === user?.id) || hasMyCheckedOutFiles
                        
                        if (!showDownload && !showCheckout && !showCheckin) return null
                        
                        return (
                          <span className="inline-actions flex items-center gap-0.5 ml-1">
                            {showDownload && (
                              <button
                                className="p-0.5 rounded hover:bg-pdm-success/20 text-pdm-success"
                                onClick={(e) => handleInlineDownload(e, actualFile)}
                                title="Download"
                              >
                                <ArrowDown size={12} />
                              </button>
                            )}
                            {showCheckout && (
                              <button
                                className="p-0.5 rounded hover:bg-pdm-warning/20 text-pdm-warning"
                                onClick={(e) => handleInlineCheckout(e, actualFile)}
                                title="Check Out"
                              >
                                <ArrowDown size={12} />
                              </button>
                            )}
                            {showCheckin && (
                              <button
                                className="p-0.5 rounded hover:bg-pdm-success/20 text-pdm-success"
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
                        className="opacity-30 group-hover:opacity-100 p-0.5 hover:bg-pdm-fg-muted/20 rounded transition-opacity ml-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          unpinFolder(pinned.path)
                          addToast('info', `Unpinned ${fileName}`)
                        }}
                        title="Unpin"
                      >
                        <PinOff size={12} className="text-pdm-fg-muted" />
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
            className="fixed bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: vaultContextMenu.x, top: vaultContextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-pdm-highlight flex items-center gap-2 text-pdm-fg"
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
            <div className="border-t border-pdm-border my-1" />
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-pdm-highlight flex items-center gap-2 text-pdm-warning"
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
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center"
          onClick={() => setDisconnectingVault(null)}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-warning/50 rounded-xl shadow-2xl w-[480px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-warning/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-warning/20 rounded-full">
                  <AlertTriangle size={24} className="text-pdm-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Disconnect Vault</h3>
                  <p className="text-sm text-pdm-fg-muted">"{disconnectingVault.name}"</p>
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
                      <div className="p-4 bg-pdm-error/10 border border-pdm-error/30 rounded-lg space-y-3">
                        <p className="text-sm font-medium text-pdm-error">
                          You must resolve these issues before disconnecting:
                        </p>
                        
                        {checkedOutFiles.length > 0 && (
                          <div className="bg-pdm-bg/50 p-2 rounded">
                            <p className="text-sm text-pdm-fg flex items-center gap-2">
                              <span className="w-2 h-2 bg-pdm-accent rounded-full"></span>
                              <strong>{checkedOutFiles.length}</strong> file{checkedOutFiles.length !== 1 ? 's' : ''} checked out
                            </p>
                            <p className="text-xs text-pdm-fg-muted ml-4">Check in or undo checkout</p>
                          </div>
                        )}
                        
                        {newFiles.length > 0 && (
                          <div className="bg-pdm-bg/50 p-2 rounded">
                            <p className="text-sm text-pdm-fg flex items-center gap-2">
                              <span className="w-2 h-2 bg-pdm-success rounded-full"></span>
                              <strong>{newFiles.length}</strong> new file{newFiles.length !== 1 ? 's' : ''} not synced
                            </p>
                            <p className="text-xs text-pdm-fg-muted ml-4">Sync or delete locally</p>
                          </div>
                        )}
                        
                        {modifiedFiles.length > 0 && (
                          <div className="bg-pdm-bg/50 p-2 rounded">
                            <p className="text-sm text-pdm-fg flex items-center gap-2">
                              <span className="w-2 h-2 bg-pdm-warning rounded-full"></span>
                              <strong>{modifiedFiles.length}</strong> modified file{modifiedFiles.length !== 1 ? 's' : ''}
                            </p>
                            <p className="text-xs text-pdm-fg-muted ml-4">Check out & check in, or revert</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 bg-pdm-success/10 border border-pdm-success/30 rounded-lg">
                        <p className="text-sm text-pdm-fg flex items-center gap-2">
                          <Check size={16} className="text-pdm-success" />
                          All files are synced. Safe to disconnect.
                        </p>
                      </div>
                    )}
                    
                    <p className="text-sm text-pdm-fg-muted">
                      {hasBlockingIssues 
                        ? "Close this dialog and resolve the issues above."
                        : "Local files will be deleted. You can reconnect anytime."}
                    </p>
                  </>
                )
              })()}
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
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
                    className="btn bg-pdm-warning hover:bg-pdm-warning/80 text-black disabled:opacity-50 flex items-center gap-2"
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
    </div>
  )
}
