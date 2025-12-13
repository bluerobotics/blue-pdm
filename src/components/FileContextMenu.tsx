import { 
  Trash2, 
  Copy, 
  Scissors, 
  ClipboardPaste,
  FolderOpen,
  ExternalLink,
  ArrowDown,
  ArrowUp,
  Edit,
  FolderPlus,
  Pin,
  History,
  Info,
  EyeOff,
  FileX,
  FolderX,
  Unlock,
  AlertTriangle,
  File,
  Send,
  Users,
  Check,
  Loader2,
  Eye,
  EyeOff as EyeOffIcon,
  Link,
  ClipboardList,
  Calendar,
  Monitor
} from 'lucide-react'
import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
// Import command system instead of individual supabase functions
import { 
  executeCommand,
  getSyncedFilesFromSelection,
  getUnsyncedFilesFromSelection,
  getCloudOnlyFilesFromSelection,
  getFilesInFolder
} from '../lib/commands'
import { 
  getOrgUsers, 
  createReviewRequest, 
  requestCheckout, 
  sendFileNotification,
  watchFile,
  unwatchFile,
  isWatchingFile,
  createShareLink,
  getActiveECOs,
  addFileToECO
} from '../lib/supabase'

interface FileContextMenuProps {
  x: number
  y: number
  files: LocalFile[]  // All files in the vault
  contextFiles: LocalFile[]  // Files being right-clicked
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  // Optional handlers for clipboard operations
  clipboard?: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
  onRename?: (file: LocalFile) => void
  onNewFolder?: () => void
}

export function FileContextMenu({
  x,
  y,
  files,
  contextFiles,
  onClose,
  onRefresh,
  clipboard,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onNewFolder
}: FileContextMenuProps) {
  const { user, activeVaultId, addToast, pinnedFolders, pinFolder, unpinFolder, connectedVaults, addIgnorePattern, getIgnorePatterns, serverFolderPaths, organization } = usePDMStore()
  
  const [showProperties, setShowProperties] = useState(false)
  const [folderSize, setFolderSize] = useState<{ size: number; fileCount: number; folderCount: number } | null>(null)
  const [isCalculatingSize, setIsCalculatingSize] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmFiles, setDeleteConfirmFiles] = useState<LocalFile[]>([])
  const [showDeleteLocalConfirm, setShowDeleteLocalConfirm] = useState(false)
  const [deleteLocalCheckedOutFiles, setDeleteLocalCheckedOutFiles] = useState<LocalFile[]>([])
  const [showForceCheckinConfirm, setShowForceCheckinConfirm] = useState(false)
  const [forceCheckinFiles, setForceCheckinFiles] = useState<{ filesOnDifferentMachine: LocalFile[], machineNames: string[] } | null>(null)
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<string>('win32')
  const [showIgnoreSubmenu, setShowIgnoreSubmenu] = useState(false)
  const ignoreSubmenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Review request state
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [orgUsers, setOrgUsers] = useState<{ id: string; email: string; full_name: string | null; avatar_url: string | null }[]>([])
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([])
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewDueDate, setReviewDueDate] = useState<string>('')
  const [reviewPriority, setReviewPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  
  // Checkout request state
  const [showCheckoutRequestModal, setShowCheckoutRequestModal] = useState(false)
  const [checkoutRequestMessage, setCheckoutRequestMessage] = useState('')
  const [isSubmittingCheckoutRequest, setIsSubmittingCheckoutRequest] = useState(false)
  
  // Mention/notify state
  const [showMentionModal, setShowMentionModal] = useState(false)
  const [selectedMentionUsers, setSelectedMentionUsers] = useState<string[]>([])
  const [mentionMessage, setMentionMessage] = useState('')
  const [isSubmittingMention, setIsSubmittingMention] = useState(false)
  
  // Watch file state
  const [isWatching, setIsWatching] = useState(false)
  const [isTogglingWatch, setIsTogglingWatch] = useState(false)
  
  // Share link state
  const [showShareModal, setShowShareModal] = useState(false)
  const [_shareExpiresInDays, _setShareExpiresInDays] = useState<number | null>(7)
  const [_shareMaxDownloads, _setShareMaxDownloads] = useState<number | null>(null)
  const [_shareRequireAuth, _setShareRequireAuth] = useState(false)
  const [generatedShareLink, setGeneratedShareLink] = useState<string | null>(null)
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  
  // Add to ECO state
  const [showECOModal, setShowECOModal] = useState(false)
  const [activeECOs, setActiveECOs] = useState<{ id: string; eco_number: string; title: string }[]>([])
  const [selectedECO, setSelectedECO] = useState<string | null>(null)
  const [ecoNotes, setEcoNotes] = useState('')
  const [loadingECOs, setLoadingECOs] = useState(false)
  const [isAddingToECO, setIsAddingToECO] = useState(false)
  
  // For positioning the menu within viewport bounds
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y })
  const [submenuPosition, setSubmenuPosition] = useState<'right' | 'left'>('right')
  
  // Handle submenu hover with delay to prevent accidental closing
  const handleIgnoreSubmenuEnter = () => {
    if (ignoreSubmenuTimeoutRef.current) {
      clearTimeout(ignoreSubmenuTimeoutRef.current)
      ignoreSubmenuTimeoutRef.current = null
    }
    setShowIgnoreSubmenu(true)
  }
  
  const handleIgnoreSubmenuLeave = () => {
    ignoreSubmenuTimeoutRef.current = setTimeout(() => {
      setShowIgnoreSubmenu(false)
    }, 150) // Small delay to allow moving to submenu
  }
  
  // Toggle submenu on click (for touch/trackpad users)
  const handleIgnoreSubmenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowIgnoreSubmenu(prev => !prev)
  }
  
  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])
  
  // Load current machine ID for multi-device check-in detection
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const { getMachineId } = await import('@/lib/backup')
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)
      } catch {
        setCurrentMachineId(null)
      }
    }
    loadMachineId()
  }, [])
  
  // Check if user is watching the file
  useEffect(() => {
    if (user?.id && contextFiles.length === 1 && !contextFiles[0].isDirectory && contextFiles[0].pdmData?.id) {
      isWatchingFile(contextFiles[0].pdmData.id, user.id).then(({ watching }) => {
        setIsWatching(watching)
      })
    }
  }, [user?.id, contextFiles])
  
  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (ignoreSubmenuTimeoutRef.current) {
        clearTimeout(ignoreSubmenuTimeoutRef.current)
      }
    }
  }, [])
  
  // Adjust menu position to stay within viewport
  useLayoutEffect(() => {
    if (!menuRef.current) return
    
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    let newX = x
    let newY = y
    
    // Check right overflow
    if (x + rect.width > viewportWidth - 10) {
      newX = viewportWidth - rect.width - 10
    }
    
    // Check bottom overflow
    if (y + rect.height > viewportHeight - 10) {
      newY = viewportHeight - rect.height - 10
    }
    
    // Ensure minimum position
    newX = Math.max(10, newX)
    newY = Math.max(10, newY)
    
    setAdjustedPosition({ x: newX, y: newY })
    
    // Determine submenu position based on available space
    const spaceOnRight = viewportWidth - (newX + rect.width)
    const submenuWidth = 220 // approximate submenu width
    setSubmenuPosition(spaceOnRight >= submenuWidth ? 'right' : 'left')
  }, [x, y])
  
  if (contextFiles.length === 0) return null
  
  // Get current vault name for pinning
  const currentVault = connectedVaults.find(v => v.id === activeVaultId)
  const currentVaultName = currentVault?.name || 'Vault'
  
  const multiSelect = contextFiles.length > 1
  const firstFile = contextFiles[0]
  const isFolder = firstFile.isDirectory
  const allFolders = contextFiles.every(f => f.isDirectory)
  const fileCount = contextFiles.filter(f => !f.isDirectory).length
  const folderCount = contextFiles.filter(f => f.isDirectory).length
  
  // Use command system helpers for file categorization
  const syncedFilesInSelection = getSyncedFilesFromSelection(files, contextFiles)
  const unsyncedFilesInSelection = getUnsyncedFilesFromSelection(files, contextFiles)
  const cloudOnlyFilesInSelection = getCloudOnlyFilesFromSelection(files, contextFiles)
  
  const anySynced = syncedFilesInSelection.length > 0
  const anyUnsynced = unsyncedFilesInSelection.length > 0
  const anyCloudOnly = cloudOnlyFilesInSelection.length > 0 || contextFiles.some(f => f.diffStatus === 'cloud')
  
  // Check out/in status
  const allCheckedOut = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by)
  const allCheckedIn = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => !f.pdmData?.checked_out_by)
  
  // Count files that can be checked out/in
  const checkoutableCount = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by).length
  const checkinableCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user?.id).length
  const checkedOutByOthersCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id).length
  const isAdmin = user?.role === 'admin'
  
  const countLabel = multiSelect 
    ? `(${fileCount > 0 ? `${fileCount} file${fileCount > 1 ? 's' : ''}` : ''}${fileCount > 0 && folderCount > 0 ? ', ' : ''}${folderCount > 0 ? `${folderCount} folder${folderCount > 1 ? 's' : ''}` : ''})`
    : ''
  
  // Check for cloud-only files
  const allCloudOnly = contextFiles.every(f => f.diffStatus === 'cloud')
  const hasUnsyncedLocalFiles = unsyncedFilesInSelection.length > 0
  const cloudOnlyCount = cloudOnlyFilesInSelection.length
  
  // Check for empty local folders (folders that exist locally but have no files to sync/delete)
  // These can be deleted locally even if there are no unsynced files
  const hasLocalFolders = contextFiles.some(f => f.isDirectory && f.diffStatus !== 'cloud')
  
  // Check if any selected folders exist on server (for showing delete from server option)
  const hasFoldersOnServer = contextFiles.some(f => {
    if (!f.isDirectory) return false
    const normalizedPath = f.relativePath.replace(/\\/g, '/')
    return serverFolderPaths.has(normalizedPath)
  })
  
  // ============================================
  // Command-based handlers (much cleaner!)
  // ============================================
  
  const handleOpen = () => {
    onClose()
    executeCommand('open', { file: firstFile }, { onRefresh })
  }
  
  const handleShowInExplorer = () => {
    onClose()
    executeCommand('show-in-explorer', { path: firstFile.path }, { onRefresh })
  }
  
  const handleCheckout = () => {
    onClose()
    executeCommand('checkout', { files: contextFiles }, { onRefresh })
  }
  
  const handleCheckin = () => {
    // Get files that would be checked in
    const syncedFiles = getSyncedFilesFromSelection(files, contextFiles)
    const filesToCheckin = syncedFiles.filter(f => f.pdmData?.checked_out_by === user?.id)
    
    // Check if any files are checked out on a different machine
    const filesOnDifferentMachine = filesToCheckin.filter(f => {
      const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
      return checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
    })
    
    if (filesOnDifferentMachine.length > 0) {
      // Show confirmation dialog
      const machineNames = [...new Set(filesOnDifferentMachine.map(f => f.pdmData?.checked_out_by_machine_name || 'another computer'))]
      setForceCheckinFiles({ filesOnDifferentMachine, machineNames })
      setShowForceCheckinConfirm(true)
      return
    }
    
    onClose()
    executeCommand('checkin', { files: contextFiles }, { onRefresh })
  }
  
  const handleForceCheckin = () => {
    setShowForceCheckinConfirm(false)
    setForceCheckinFiles(null)
    onClose()
    executeCommand('checkin', { files: contextFiles }, { onRefresh })
  }
  
  const handleFirstCheckin = () => {
    onClose()
    executeCommand('sync', { files: contextFiles }, { onRefresh })
  }
  
  const handleDownload = () => {
    onClose()
    executeCommand('download', { files: contextFiles }, { onRefresh })
  }
  
  const handleDeleteLocal = () => {
    // Get all synced files that will be affected (including from folders)
    const syncedFiles = getSyncedFilesFromSelection(files, contextFiles)
    
    // Check for files checked out by current user
    const checkedOutByMe = syncedFiles.filter(f => f.pdmData?.checked_out_by === user?.id)
    
    // If there are checked out files, show confirmation dialog
    if (checkedOutByMe.length > 0) {
      setDeleteLocalCheckedOutFiles(checkedOutByMe)
      setShowDeleteLocalConfirm(true)
      return
    }
    
    // No checked out files - proceed directly
    onClose()
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }
  
  // Check in files first, then delete local
  const handleCheckinThenDeleteLocal = async () => {
    setShowDeleteLocalConfirm(false)
    onClose()
    // First check in all checked out files
    await executeCommand('checkin', { files: contextFiles }, { onRefresh })
    // Then delete local copies
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }
  
  // Discard checkouts and delete local copies
  const handleDiscardAndDeleteLocal = () => {
    setShowDeleteLocalConfirm(false)
    onClose()
    // The delete-local command will release checkouts automatically
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }
  
  const handleForceRelease = () => {
    onClose()
    executeCommand('force-release', { files: contextFiles }, { onRefresh })
  }
  
  // Handle delete from server (shows confirmation dialog first)
  const handleDeleteFromServer = () => {
    // Get all synced files to delete from server (including files inside folders)
    const allFilesToDelete: LocalFile[] = []
    
    for (const item of contextFiles) {
      if (item.isDirectory) {
        const folderPath = item.relativePath.replace(/\\/g, '/')
        const filesInFolder = files.filter(f => {
          if (f.isDirectory) return false
          if (!f.pdmData?.id) return false
          const filePath = f.relativePath.replace(/\\/g, '/')
          return filePath.startsWith(folderPath + '/')
        })
        allFilesToDelete.push(...filesInFolder)
      } else if (item.pdmData?.id) {
        allFilesToDelete.push(item)
      }
    }
    
    // Remove duplicates
    const uniqueFiles = [...new Map(allFilesToDelete.map(f => [f.path, f])).values()]
    
    // Check for local-only folders
    const hasLocalFolders = contextFiles.some(f => f.isDirectory && f.diffStatus !== 'cloud')
    const hasCloudOnlyFolders = contextFiles.some(f => f.isDirectory && f.diffStatus === 'cloud')
    
    if (uniqueFiles.length === 0 && !hasLocalFolders) {
      if (hasCloudOnlyFolders) {
        // Empty cloud-only folders - delete directly without confirmation
        onClose()
        executeCommand('delete-server', { files: contextFiles, deleteLocal: true }, { onRefresh })
      } else {
        addToast('warning', 'No files to delete from server')
        onClose()
      }
      return
    }
    
    // If only local folders with no server files, delete without confirmation
    if (uniqueFiles.length === 0 && hasLocalFolders) {
      onClose()
      executeCommand('delete-server', { files: contextFiles, deleteLocal: true }, { onRefresh })
      return
    }
    
    // Show confirmation dialog for server files
    setDeleteConfirmFiles(uniqueFiles)
    setShowDeleteConfirm(true)
  }
  
  // Execute server delete after confirmation
  const executeDeleteFromServer = () => {
    setShowDeleteConfirm(false)
    setDeleteConfirmFiles([])
    onClose()
    executeCommand('delete-server', { files: contextFiles, deleteLocal: true }, { onRefresh })
  }
  
  // Request Review handlers
  const handleOpenReviewModal = async () => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setShowReviewModal(true)
    setLoadingUsers(true)
    
    const { users } = await getOrgUsers(organization.id)
    // Filter out current user from the list
    setOrgUsers(users.filter((u: { id: string }) => u.id !== user?.id))
    setLoadingUsers(false)
  }
  
  const handleToggleReviewer = (userId: string) => {
    setSelectedReviewers(prev => 
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }
  
  const handleSubmitReviewRequest = async () => {
    if (!user?.id || !organization?.id || !activeVaultId) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (selectedReviewers.length === 0) {
      addToast('warning', 'Please select at least one reviewer')
      return
    }
    
    setIsSubmittingReview(true)
    
    // Get the first synced file for the review request
    const syncedFile = contextFiles.find(f => f.pdmData?.id)
    if (!syncedFile || !syncedFile.pdmData) {
      addToast('error', 'File must be synced to request a review')
      setIsSubmittingReview(false)
      return
    }
    
    const { error } = await createReviewRequest(
      organization.id,
      syncedFile.pdmData.id,
      activeVaultId,
      user.id,
      selectedReviewers,
      syncedFile.pdmData.version || 1,
      undefined,  // title
      reviewMessage || undefined,
      reviewDueDate || undefined,
      reviewPriority
    )
    
    if (error) {
      addToast('error', `Failed to create review request: ${error}`)
    } else {
      addToast('success', `Review request sent to ${selectedReviewers.length} reviewer${selectedReviewers.length > 1 ? 's' : ''}`)
      setShowReviewModal(false)
      setSelectedReviewers([])
      setReviewMessage('')
      setReviewDueDate('')
      setReviewPriority('normal')
      onClose()
    }
    
    setIsSubmittingReview(false)
  }
  
  // Request Checkout handlers (for files checked out by others)
  const handleSubmitCheckoutRequest = async () => {
    if (!user?.id || !organization?.id) {
      addToast('error', 'Missing required information')
      return
    }
    
    const syncedFile = contextFiles.find(f => f.pdmData?.id && f.pdmData.checked_out_by && f.pdmData.checked_out_by !== user.id)
    if (!syncedFile || !syncedFile.pdmData?.checked_out_by) {
      addToast('error', 'File is not checked out by someone else')
      setShowCheckoutRequestModal(false)
      return
    }
    
    setIsSubmittingCheckoutRequest(true)
    
    const { error } = await requestCheckout(
      organization.id,
      syncedFile.pdmData.id,
      syncedFile.name,
      user.id,
      syncedFile.pdmData.checked_out_by,
      checkoutRequestMessage || undefined
    )
    
    if (error) {
      addToast('error', `Failed to send request: ${error}`)
    } else {
      addToast('success', 'Checkout request sent')
      setShowCheckoutRequestModal(false)
      setCheckoutRequestMessage('')
      onClose()
    }
    
    setIsSubmittingCheckoutRequest(false)
  }
  
  // Mention/Notify handlers
  const handleOpenMentionModal = async () => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setShowMentionModal(true)
    setLoadingUsers(true)
    
    const { users } = await getOrgUsers(organization.id)
    // Filter out current user from the list
    setOrgUsers(users.filter((u: { id: string }) => u.id !== user?.id))
    setLoadingUsers(false)
  }
  
  const handleToggleMentionUser = (userId: string) => {
    setSelectedMentionUsers(prev => 
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }
  
  const handleSubmitMention = async () => {
    if (!user?.id || !organization?.id) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (selectedMentionUsers.length === 0) {
      addToast('warning', 'Please select at least one person to notify')
      return
    }
    
    const syncedFile = contextFiles.find(f => f.pdmData?.id)
    if (!syncedFile || !syncedFile.pdmData) {
      addToast('error', 'File must be synced to send notifications')
      setIsSubmittingMention(false)
      return
    }
    
    setIsSubmittingMention(true)
    
    let successCount = 0
    for (const toUserId of selectedMentionUsers) {
      const { success } = await sendFileNotification(
        organization.id,
        syncedFile.pdmData.id,
        syncedFile.name,
        toUserId,
        user.id,
        'mention',
        mentionMessage || `Check out this file: ${syncedFile.name}`
      )
      if (success) successCount++
    }
    
    if (successCount > 0) {
      addToast('success', `Notification sent to ${successCount} user${successCount > 1 ? 's' : ''}`)
      setShowMentionModal(false)
      setSelectedMentionUsers([])
      setMentionMessage('')
      onClose()
    } else {
      addToast('error', 'Failed to send notifications')
    }
    
    setIsSubmittingMention(false)
  }
  
  // Watch/Unwatch handlers
  const handleToggleWatch = async () => {
    if (!user?.id || !organization?.id) return
    
    const syncedFile = contextFiles.find(f => f.pdmData?.id)
    if (!syncedFile || !syncedFile.pdmData) return
    
    setIsTogglingWatch(true)
    
    if (isWatching) {
      const { success, error } = await unwatchFile(syncedFile.pdmData.id, user.id)
      if (success) {
        setIsWatching(false)
        addToast('info', `Stopped watching ${syncedFile.name}`)
      } else {
        addToast('error', error || 'Failed to unwatch file')
      }
    } else {
      const { success, error } = await watchFile(organization.id, syncedFile.pdmData.id, user.id)
      if (success) {
        setIsWatching(true)
        addToast('success', `Now watching ${syncedFile.name}`)
      } else {
        addToast('error', error || 'Failed to watch file')
      }
    }
    
    setIsTogglingWatch(false)
    onClose()
  }
  
  // Share link handler - creates link immediately and copies to clipboard
  const handleQuickShareLink = async (file: LocalFile) => {
    if (!user?.id || !organization?.id || !file.pdmData?.id) {
      addToast('error', 'File must be synced to create a share link')
      return
    }
    
    setIsCreatingShareLink(true)
    
    const { link, error } = await createShareLink(
      organization.id,
      file.pdmData.id,
      user.id,
      { expiresInDays: 7 } // Default 7 days
    )
    
    if (error) {
      addToast('error', error)
    } else if (link) {
      try {
        await navigator.clipboard.writeText(link.downloadUrl)
        addToast('success', 'Share link copied! (expires in 7 days)')
      } catch {
        // If clipboard fails, show the link in a prompt
        setGeneratedShareLink(link.downloadUrl)
        setShowShareModal(true)
      }
    }
    
    setIsCreatingShareLink(false)
    onClose()
  }
  
  const handleCopyShareLink = async () => {
    if (!generatedShareLink) return
    
    try {
      await navigator.clipboard.writeText(generatedShareLink)
      setCopiedLink(true)
      addToast('success', 'Link copied to clipboard!')
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      addToast('error', 'Failed to copy link')
    }
  }
  
  // ECO handlers
  const handleOpenECOModal = async () => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setShowECOModal(true)
    setLoadingECOs(true)
    
    const { ecos } = await getActiveECOs(organization.id)
    setActiveECOs(ecos)
    setLoadingECOs(false)
  }
  
  const handleAddToECO = async () => {
    if (!user?.id || !selectedECO) {
      addToast('warning', 'Please select an ECO')
      return
    }
    
    const syncedFile = contextFiles.find(f => f.pdmData?.id)
    if (!syncedFile || !syncedFile.pdmData) {
      addToast('error', 'File must be synced to add to ECO')
      return
    }
    
    setIsAddingToECO(true)
    
    const { success, error } = await addFileToECO(
      syncedFile.pdmData.id,
      selectedECO,
      user.id,
      ecoNotes || undefined
    )
    
    if (success) {
      const eco = activeECOs.find(e => e.id === selectedECO)
      addToast('success', `Added to ${eco?.eco_number || 'ECO'}`)
      setShowECOModal(false)
      setSelectedECO(null)
      setEcoNotes('')
      onClose()
    } else {
      addToast('error', error || 'Failed to add to ECO')
    }
    
    setIsAddingToECO(false)
  }

  return (
    <>
      <div 
        className="fixed inset-0 z-50" 
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div 
        ref={menuRef}
        className="context-menu z-[60]"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        {/* Download - for cloud-only files - show at TOP for cloud folders */}
        {anyCloudOnly && (
          <div className="context-menu-item" onClick={handleDownload}>
            <ArrowDown size={14} className="text-pdm-success" />
            Download {cloudOnlyCount > 0 ? `${cloudOnlyCount} files` : countLabel}
          </div>
        )}
        
        {/* Open - only for local files/folders (not cloud-only) */}
        {!multiSelect && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleOpen}>
            <ExternalLink size={14} />
            {isFolder ? 'Open Folder' : 'Open'}
          </div>
        )}
        
        {/* Show in Explorer/Finder */}
        {!allCloudOnly && (
          <div className="context-menu-item" onClick={handleShowInExplorer}>
            <FolderOpen size={14} />
            {platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer'}
          </div>
        )}
        
        {/* Pin/Unpin - for files and folders */}
        {!multiSelect && activeVaultId && (
          (() => {
            const isPinned = pinnedFolders.some(p => p.path === firstFile.relativePath && p.vaultId === activeVaultId)
            return (
              <div 
                className="context-menu-item"
                onClick={() => {
                  if (isPinned) {
                    unpinFolder(firstFile.relativePath)
                    addToast('info', `Unpinned ${firstFile.name}`)
                  } else {
                    pinFolder(firstFile.relativePath, activeVaultId, currentVaultName, firstFile.isDirectory)
                    addToast('success', `Pinned ${firstFile.name}`)
                  }
                  onClose()
                }}
              >
                <Pin size={14} className={isPinned ? 'fill-pdm-accent text-pdm-accent' : ''} />
                {isPinned ? 'Unpin' : `Pin ${isFolder ? 'Folder' : 'File'}`}
              </div>
            )
          })()
        )}
        
        {/* Rename - right after pin */}
        {onRename && !multiSelect && !allCloudOnly && (
          (() => {
            const isSynced = !!firstFile.pdmData
            const isCheckedOutByMe = firstFile.pdmData?.checked_out_by === user?.id
            const canRename = !isSynced || isCheckedOutByMe
            
            return (
              <div 
                className={`context-menu-item ${!canRename ? 'disabled' : ''}`}
                onClick={() => { 
                  if (canRename) {
                    onRename(firstFile)
                    onClose()
                  }
                }}
                title={!canRename ? 'Check out file first to rename' : ''}
              >
                <Edit size={14} />
                Rename
                <span className="text-xs text-pdm-fg-muted ml-auto">
                  {!canRename ? '(checkout required)' : 'F2'}
                </span>
              </div>
            )
          })()
        )}
        
        {/* Clipboard operations */}
        {(onCopy || onCut || onPaste) && (
          <>
            <div className="context-menu-separator" />
            {onCopy && (
              <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>
                <Copy size={14} />
                Copy
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+C</span>
              </div>
            )}
            {onCut && (() => {
              const canCut = contextFiles.every(f => 
                f.isDirectory || 
                !f.pdmData || 
                f.pdmData.checked_out_by === user?.id
              )
              return (
                <div 
                  className={`context-menu-item ${!canCut ? 'disabled' : ''}`}
                  onClick={() => { if (canCut) { onCut(); onClose(); } }}
                  title={!canCut ? 'Check out files first to move them' : undefined}
                >
                  <Scissors size={14} />
                  Cut
                  <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+X</span>
                </div>
              )
            })()}
            {onPaste && (
              <div 
                className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
                onClick={() => { if (clipboard) { onPaste(); onClose(); } }}
              >
                <ClipboardPaste size={14} />
                Paste
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+V</span>
              </div>
            )}
          </>
        )}
        
        {/* New Folder */}
        {onNewFolder && isFolder && !multiSelect && !allCloudOnly && (
          <>
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => { onNewFolder(); onClose(); }}>
              <FolderPlus size={14} />
              New Folder
            </div>
          </>
        )}
        
        <div className="context-menu-separator" />
        
        {/* First Check In - for unsynced files */}
        {anyUnsynced && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleFirstCheckin}>
            <ArrowUp size={14} className="text-pdm-success" />
            First Check In {unsyncedFilesInSelection.length > 0 ? `${unsyncedFilesInSelection.length} file${unsyncedFilesInSelection.length !== 1 ? 's' : ''}` : countLabel}
          </div>
        )}
        
        {/* Check Out */}
        <div 
          className={`context-menu-item ${!anySynced || allCheckedOut ? 'disabled' : ''}`}
          onClick={() => {
            if (!anySynced || allCheckedOut) return
            handleCheckout()
          }}
          title={!anySynced ? 'Download files first to enable checkout' : allCheckedOut ? 'Already checked out' : ''}
        >
          <ArrowDown size={14} className={!anySynced ? 'text-pdm-fg-muted' : 'text-pdm-warning'} />
          Check Out {allFolders && !multiSelect && checkoutableCount > 0 ? `${checkoutableCount} files` : countLabel}
          {!anySynced && <span className="text-xs text-pdm-fg-muted ml-auto">(download first)</span>}
          {anySynced && allCheckedOut && <span className="text-xs text-pdm-fg-muted ml-auto">(already out)</span>}
        </div>
        
        {/* Check In */}
        {anySynced && (
          <div 
            className={`context-menu-item ${allCheckedIn || checkinableCount === 0 ? 'disabled' : ''}`}
            onClick={() => {
              if (allCheckedIn || checkinableCount === 0) return
              handleCheckin()
            }}
            title={allCheckedIn ? 'Already checked in' : checkinableCount === 0 ? 'No files checked out by you' : ''}
          >
            <ArrowUp size={14} className={allCheckedIn || checkinableCount === 0 ? 'text-pdm-fg-muted' : 'text-pdm-success'} />
            Check In {allFolders && !multiSelect && checkinableCount > 0 ? `${checkinableCount} files` : countLabel}
            {allCheckedIn && <span className="text-xs text-pdm-fg-muted ml-auto">(already in)</span>}
          </div>
        )}
        
        {/* Admin: Force Release */}
        {isAdmin && checkedOutByOthersCount > 0 && (
          <div 
            className="context-menu-item text-pdm-error"
            onClick={handleForceRelease}
            title="Admin: Immediately release checkout. User's unsaved changes will be orphaned."
          >
            <Unlock size={14} />
            Force Release {checkedOutByOthersCount > 1 ? `(${checkedOutByOthersCount})` : ''}
          </div>
        )}
        
        <div className="context-menu-separator" />
        
        {/* Show History - for folders */}
        {!multiSelect && isFolder && (
          <div 
            className="context-menu-item"
            onClick={() => {
              const { setDetailsPanelTab, detailsPanelVisible, toggleDetailsPanel } = usePDMStore.getState()
              setDetailsPanelTab('history')
              if (!detailsPanelVisible) toggleDetailsPanel()
              onClose()
            }}
          >
            <History size={14} />
            Show History
          </div>
        )}
        
        {/* Show Deleted Files - for folders */}
        {!multiSelect && isFolder && (
          <div 
            className="context-menu-item"
            onClick={() => {
              const { setActiveView, setTrashFolderFilter } = usePDMStore.getState()
              setTrashFolderFilter(firstFile.relativePath)
              setActiveView('trash')
              onClose()
            }}
          >
            <Trash2 size={14} />
            Show Deleted Files
          </div>
        )}
        
        {/* Properties */}
        <div 
          className="context-menu-item"
          onClick={async () => {
            if (isFolder && !multiSelect) {
              setIsCalculatingSize(true)
              setShowProperties(true)
              const filesInFolder = getFilesInFolder(files, firstFile.relativePath)
              const foldersInFolder = files.filter(f => 
                f.isDirectory && 
                f.relativePath.replace(/\\/g, '/').startsWith(firstFile.relativePath.replace(/\\/g, '/') + '/') && 
                f.relativePath !== firstFile.relativePath
              )
              let totalSize = 0
              for (const f of filesInFolder) {
                totalSize += f.size || 0
              }
              setFolderSize({
                size: totalSize,
                fileCount: filesInFolder.length,
                folderCount: foldersInFolder.length
              })
              setIsCalculatingSize(false)
            } else {
              setShowProperties(true)
            }
          }}
        >
          <Info size={14} />
          Properties
        </div>
        
        {/* Request Review - only for synced files (not folders) */}
        {!multiSelect && !isFolder && anySynced && firstFile.pdmData?.id && (
          <div 
            className="context-menu-item"
            onClick={handleOpenReviewModal}
          >
            <Send size={14} className="text-pdm-accent" />
            Request Review
          </div>
        )}
        
        {/* Request Checkout - for files checked out by others */}
        {!multiSelect && !isFolder && anySynced && firstFile.pdmData?.checked_out_by && firstFile.pdmData.checked_out_by !== user?.id && (
          <div 
            className="context-menu-item"
            onClick={() => setShowCheckoutRequestModal(true)}
          >
            <ArrowDown size={14} className="text-pdm-warning" />
            Request Checkout
          </div>
        )}
        
        {/* Notify / Mention - for synced files */}
        {!multiSelect && !isFolder && anySynced && firstFile.pdmData?.id && (
          <div 
            className="context-menu-item"
            onClick={handleOpenMentionModal}
          >
            <Users size={14} className="text-pdm-fg-dim" />
            Notify Someone
          </div>
        )}
        
        {/* Watch/Unwatch - for synced files */}
        {!multiSelect && !isFolder && anySynced && firstFile.pdmData?.id && (
          <div 
            className={`context-menu-item ${isTogglingWatch ? 'opacity-50' : ''}`}
            onClick={handleToggleWatch}
          >
            {isTogglingWatch ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isWatching ? (
              <EyeOffIcon size={14} className="text-pdm-fg-muted" />
            ) : (
              <Eye size={14} className="text-pdm-accent" />
            )}
            {isWatching ? 'Stop Watching' : 'Watch File'}
          </div>
        )}
        
        {/* Copy Share Link - for synced files and folders */}
        {!multiSelect && anySynced && (isFolder || firstFile.pdmData?.id) && (
          <div 
            className={`context-menu-item ${isCreatingShareLink ? 'opacity-50' : ''}`}
            onClick={() => {
              if (isFolder) {
                addToast('info', 'Folder sharing coming soon! For now, share individual files.')
                onClose()
              } else if (!isCreatingShareLink) {
                handleQuickShareLink(firstFile)
              }
            }}
          >
            {isCreatingShareLink ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link size={14} className="text-pdm-accent" />
            )}
            Copy Share Link
          </div>
        )}
        
        {/* Add to ECO - for synced files */}
        {!multiSelect && !isFolder && anySynced && firstFile.pdmData?.id && (
          <div 
            className="context-menu-item"
            onClick={handleOpenECOModal}
          >
            <ClipboardList size={14} className="text-pdm-fg-dim" />
            Add to ECO
          </div>
        )}
        
        <div className="context-menu-separator" />
        
        {/* Keep Local Only (Ignore) - for unsynced files and folders */}
        {anyUnsynced && !allCloudOnly && activeVaultId && (
          <div 
            className="context-menu-item relative"
            onMouseEnter={handleIgnoreSubmenuEnter}
            onMouseLeave={handleIgnoreSubmenuLeave}
            onClick={handleIgnoreSubmenuClick}
          >
            <EyeOff size={14} />
            Keep Local Only
            <span className="text-xs text-pdm-fg-muted ml-auto">{submenuPosition === 'right' ? '▶' : '◀'}</span>
            
            {/* Submenu */}
            {showIgnoreSubmenu && (
              <div 
                className={`absolute top-0 min-w-[200px] bg-pdm-bg-lighter border border-pdm-border rounded-md py-1 shadow-lg z-[100] ${
                  submenuPosition === 'right' ? 'left-full ml-1' : 'right-full mr-1'
                }`}
                style={{ marginTop: '-4px' }}
                onMouseEnter={handleIgnoreSubmenuEnter}
                onMouseLeave={handleIgnoreSubmenuLeave}
              >
                {/* Ignore this specific file/folder */}
                <div 
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    for (const file of contextFiles) {
                      if (file.isDirectory) {
                        addIgnorePattern(activeVaultId, file.relativePath + '/')
                      } else {
                        addIgnorePattern(activeVaultId, file.relativePath)
                      }
                    }
                    addToast('success', `Added ${contextFiles.length > 1 ? `${contextFiles.length} items` : contextFiles[0].name} to ignore list`)
                    onRefresh(true)
                    onClose()
                  }}
                >
                  {isFolder ? <FolderX size={14} /> : <FileX size={14} />}
                  This {isFolder ? 'folder' : 'file'}{multiSelect ? ` (${contextFiles.length})` : ''}
                </div>
                
                {/* Ignore all files with this extension */}
                {!isFolder && !multiSelect && firstFile.extension && (
                  <div 
                    className="context-menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      const pattern = `*${firstFile.extension}`
                      addIgnorePattern(activeVaultId, pattern)
                      addToast('success', `Now ignoring all ${firstFile.extension} files`)
                      onRefresh(true)
                      onClose()
                    }}
                  >
                    <FileX size={14} />
                    All *{firstFile.extension} files
                  </div>
                )}
                
                {/* Show current patterns count */}
                {(() => {
                  const currentPatterns = getIgnorePatterns(activeVaultId)
                  if (currentPatterns.length > 0) {
                    return (
                      <>
                        <div className="context-menu-separator" />
                        <div className="px-3 py-1.5 text-xs text-pdm-fg-muted">
                          {currentPatterns.length} pattern{currentPatterns.length > 1 ? 's' : ''} configured
                        </div>
                      </>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </div>
        )}
        
        {/* Remove Local Copy - for synced files */}
        {anySynced && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleDeleteLocal}>
            <Trash2 size={14} />
            Remove Local Copy {countLabel}
          </div>
        )}
        
        {/* Delete Locally - for local files/folders (keeps server copy) */}
        {(hasUnsyncedLocalFiles || hasLocalFolders) && !allCloudOnly && (
          <div className="context-menu-item danger" onClick={handleDeleteLocal}>
            <Trash2 size={14} />
            Delete Locally {countLabel}
          </div>
        )}
        
        {/* Delete from Server - show if any content exists on server (synced, cloud-only, or folder exists on server) */}
        {(anySynced || allCloudOnly || anyCloudOnly || hasFoldersOnServer) && (
          <div className="context-menu-item danger" onClick={handleDeleteFromServer}>
            <Trash2 size={14} />
            {allCloudOnly ? 'Delete from Server' : 'Delete Local & Server'} {countLabel}
          </div>
        )}
      </div>
      
      {/* Properties Modal */}
      {showProperties && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowProperties(false); onClose(); }} />
          <div className="relative bg-pdm-bg-light border border-pdm-border rounded-lg shadow-2xl w-[400px] max-h-[80vh] overflow-auto">
            <div className="p-4 border-b border-pdm-border flex items-center gap-3">
              <Info size={20} className="text-pdm-accent" />
              <h3 className="font-semibold">Properties</h3>
            </div>
            <div className="p-4 space-y-3">
              {/* Name */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Name</div>
                <div className="text-sm">{firstFile.name}</div>
              </div>
              
              {/* Type */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Type</div>
                <div className="text-sm">
                  {isFolder ? 'Folder' : (firstFile.extension ? firstFile.extension.toUpperCase() + ' File' : 'File')}
                </div>
              </div>
              
              {/* Location */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Location</div>
                <div className="text-sm break-all text-pdm-fg-dim">
                  {firstFile.relativePath.includes('/') 
                    ? firstFile.relativePath.substring(0, firstFile.relativePath.lastIndexOf('/'))
                    : '/'}
                </div>
              </div>
              
              {/* Size */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Size</div>
                <div className="text-sm">
                  {isFolder && !multiSelect ? (
                    isCalculatingSize ? (
                      <span className="text-pdm-fg-muted">Calculating...</span>
                    ) : folderSize ? (
                      <span>
                        {formatSize(folderSize.size)}
                        <span className="text-pdm-fg-muted ml-2">
                          ({folderSize.fileCount} file{folderSize.fileCount !== 1 ? 's' : ''}, {folderSize.folderCount} folder{folderSize.folderCount !== 1 ? 's' : ''})
                        </span>
                      </span>
                    ) : '—'
                  ) : multiSelect ? (
                    formatSize(contextFiles.reduce((sum, f) => sum + (f.size || 0), 0))
                  ) : (
                    formatSize(firstFile.size || 0)
                  )}
                </div>
              </div>
              
              {/* Status */}
              {firstFile.pdmData && (
                <div>
                  <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Status</div>
                  <div className="text-sm">
                    {firstFile.pdmData.checked_out_by 
                      ? firstFile.pdmData.checked_out_by === user?.id 
                        ? 'Checked out by you'
                        : 'Checked out'
                      : 'Available'}
                  </div>
                </div>
              )}
              
              {/* Sync Status */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Sync Status</div>
                <div className={`text-sm ${firstFile.diffStatus === 'deleted_remote' ? 'text-pdm-error' : ''}`}>
                  {firstFile.diffStatus === 'cloud' ? 'Cloud only (not downloaded)' 
                    : firstFile.diffStatus === 'added' ? 'Local only (not synced)'
                    : firstFile.diffStatus === 'ignored' ? 'Local only (ignored from sync)'
                    : firstFile.diffStatus === 'modified' ? 'Modified locally'
                    : firstFile.diffStatus === 'moved' ? 'Moved (path changed)'
                    : firstFile.diffStatus === 'outdated' ? 'Outdated (newer version on server)'
                    : firstFile.diffStatus === 'deleted_remote' ? 'Deleted from server (orphaned)'
                    : firstFile.pdmData ? 'Synced' : 'Not synced'}
                </div>
              </div>
              
              {/* Modified Date */}
              {firstFile.modifiedTime && (
                <div>
                  <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Modified</div>
                  <div className="text-sm">{new Date(firstFile.modifiedTime).toLocaleString()}</div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-pdm-border flex justify-end">
              <button
                onClick={() => { setShowProperties(false); onClose(); }}
                className="btn btn-ghost"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete from Server Confirmation Dialog */}
      {showDeleteConfirm && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowDeleteConfirm(false); onClose(); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-error/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-pdm-error" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Delete Local & Server {deleteConfirmFiles.length > 1 ? `${deleteConfirmFiles.length} Items` : 'Item'}?
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  Items will be deleted locally AND from the server.
                </p>
              </div>
            </div>
            
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4 max-h-40 overflow-y-auto">
              {deleteConfirmFiles.length === 1 ? (
                <div className="flex items-center gap-2">
                  <File size={16} className="text-pdm-fg-muted" />
                  <span className="text-pdm-fg font-medium truncate">{deleteConfirmFiles[0]?.name}</span>
                </div>
              ) : (
                <>
                  <div className="text-sm text-pdm-fg mb-2">
                    {deleteConfirmFiles.length} file{deleteConfirmFiles.length > 1 ? 's' : ''}
                  </div>
                  <div className="space-y-1">
                    {deleteConfirmFiles.slice(0, 5).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <File size={14} className="text-pdm-fg-muted" />
                        <span className="text-pdm-fg-dim truncate">{f.name}</span>
                      </div>
                    ))}
                    {deleteConfirmFiles.length > 5 && (
                      <div className="text-xs text-pdm-fg-muted">
                        ...and {deleteConfirmFiles.length - 5} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Warning */}
            <div className="bg-pdm-warning/10 border border-pdm-warning/30 rounded p-3 mb-4">
              <p className="text-sm text-pdm-warning font-medium">
                ⚠️ {deleteConfirmFiles.length} synced file{deleteConfirmFiles.length > 1 ? 's' : ''} will be deleted from the server.
              </p>
              <p className="text-xs text-pdm-fg-muted mt-1">Files can be recovered from trash within 30 days.</p>
            </div>
            
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); onClose(); }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteFromServer}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white"
              >
                <Trash2 size={14} />
                Delete Local & Server {deleteConfirmFiles.length > 1 ? `(${deleteConfirmFiles.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Local Confirmation Dialog - only when files are checked out */}
      {showDeleteLocalConfirm && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowDeleteLocalConfirm(false); onClose(); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-warning/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-pdm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Files Are Checked Out
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  {deleteLocalCheckedOutFiles.length} file{deleteLocalCheckedOutFiles.length > 1 ? 's are' : ' is'} currently checked out by you.
                </p>
              </div>
            </div>
            
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4 max-h-40 overflow-y-auto">
              <div className="space-y-1">
                {deleteLocalCheckedOutFiles.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <File size={14} className="text-pdm-warning" />
                    <span className="text-pdm-fg truncate">{f.name}</span>
                  </div>
                ))}
                {deleteLocalCheckedOutFiles.length > 5 && (
                  <div className="text-xs text-pdm-fg-muted">
                    ...and {deleteLocalCheckedOutFiles.length - 5} more
                  </div>
                )}
              </div>
            </div>
            
            {/* Info */}
            <div className="bg-pdm-accent/10 border border-pdm-accent/30 rounded p-3 mb-4">
              <p className="text-sm text-pdm-fg">
                What would you like to do with your changes?
              </p>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={handleCheckinThenDeleteLocal}
                className="btn bg-pdm-success hover:bg-pdm-success/80 text-white w-full justify-center"
              >
                <ArrowUp size={14} />
                Check In First, Then Remove Local
              </button>
              <button
                onClick={handleDiscardAndDeleteLocal}
                className="btn bg-pdm-warning hover:bg-pdm-warning/80 text-white w-full justify-center"
              >
                <Trash2 size={14} />
                Discard Changes & Remove Local
              </button>
              <button
                onClick={() => { setShowDeleteLocalConfirm(false); onClose(); }}
                className="btn btn-ghost w-full justify-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Force Check-in Confirmation Dialog */}
      {showForceCheckinConfirm && forceCheckinFiles && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowForceCheckinConfirm(false); setForceCheckinFiles(null); onClose(); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-warning/20 flex items-center justify-center">
                <Monitor size={20} className="text-pdm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Check In From Different Computer
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  {forceCheckinFiles.filesOnDifferentMachine.length} file{forceCheckinFiles.filesOnDifferentMachine.length > 1 ? 's are' : ' is'} checked out on {forceCheckinFiles.machineNames.join(', ')}.
                </p>
              </div>
            </div>
            
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4 max-h-40 overflow-y-auto">
              <div className="space-y-1">
                {forceCheckinFiles.filesOnDifferentMachine.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <File size={14} className="text-pdm-warning" />
                    <span className="text-pdm-fg truncate">{f.name}</span>
                  </div>
                ))}
                {forceCheckinFiles.filesOnDifferentMachine.length > 5 && (
                  <div className="text-xs text-pdm-fg-muted">
                    ...and {forceCheckinFiles.filesOnDifferentMachine.length - 5} more
                  </div>
                )}
              </div>
            </div>
            
            {/* Warning */}
            <div className="bg-pdm-warning/10 border border-pdm-warning/30 rounded p-3 mb-4">
              <p className="text-sm text-pdm-fg">
                Checking in from here will <strong>discard any unsaved changes</strong> on {forceCheckinFiles.machineNames.length === 1 ? 'that' : 'those'} computer{forceCheckinFiles.machineNames.length > 1 ? 's' : ''}.
              </p>
              <p className="text-xs text-pdm-fg-muted mt-2">
                The other computer{forceCheckinFiles.machineNames.length > 1 ? 's' : ''} will be notified.
              </p>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={handleForceCheckin}
                className="btn bg-pdm-warning hover:bg-pdm-warning/80 text-white w-full justify-center"
              >
                <ArrowUp size={14} />
                Force Check In
              </button>
              <button
                onClick={() => { setShowForceCheckinConfirm(false); setForceCheckinFiles(null); onClose(); }}
                className="btn btn-ghost w-full justify-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Review Request Modal */}
      {showReviewModal && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowReviewModal(false); setSelectedReviewers([]); setReviewMessage(''); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-accent/20 flex items-center justify-center">
                <Send size={20} className="text-pdm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Request Review
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  {firstFile.name}
                </p>
              </div>
            </div>
            
            {/* File info */}
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-pdm-fg-muted" />
                <span className="text-pdm-fg font-medium truncate">{firstFile.name}</span>
                {firstFile.pdmData?.version && (
                  <span className="text-xs text-pdm-fg-muted">v{firstFile.pdmData.version}</span>
                )}
              </div>
            </div>
            
            {/* Reviewers selection */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Select Reviewers
              </label>
              {loadingUsers ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 size={20} className="animate-spin text-pdm-accent" />
                </div>
              ) : orgUsers.length === 0 ? (
                <p className="text-sm text-pdm-fg-muted p-2">No other users in your organization</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-pdm-border rounded bg-pdm-bg">
                  {orgUsers.map(orgUser => (
                    <label 
                      key={orgUser.id}
                      className="flex items-center gap-3 p-2 hover:bg-pdm-highlight cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedReviewers.includes(orgUser.id)}
                        onChange={() => handleToggleReviewer(orgUser.id)}
                        className="w-4 h-4 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent"
                      />
                      {orgUser.avatar_url ? (
                        <img 
                          src={orgUser.avatar_url} 
                          alt="" 
                          className="w-6 h-6 rounded-full"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-pdm-accent/20 flex items-center justify-center">
                          <Users size={12} className="text-pdm-accent" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-pdm-fg truncate">
                          {orgUser.full_name || orgUser.email}
                        </div>
                        {orgUser.full_name && (
                          <div className="text-xs text-pdm-fg-muted truncate">
                            {orgUser.email}
                          </div>
                        )}
                      </div>
                      {selectedReviewers.includes(orgUser.id) && (
                        <Check size={16} className="text-pdm-accent flex-shrink-0" />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            {/* Due Date and Priority */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                  <Calendar size={12} className="inline mr-1" />
                  Due Date (optional)
                </label>
                <input
                  type="date"
                  value={reviewDueDate}
                  onChange={(e) => setReviewDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                  Priority
                </label>
                <select
                  value={reviewPriority}
                  onChange={(e) => setReviewPriority(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            
            {/* Message */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Message (optional)
              </label>
              <textarea
                value={reviewMessage}
                onChange={(e) => setReviewMessage(e.target.value)}
                placeholder="Add a message for the reviewers..."
                className="w-full px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded resize-none focus:outline-none focus:border-pdm-accent"
                rows={2}
              />
            </div>
            
            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowReviewModal(false); setSelectedReviewers([]); setReviewMessage(''); setReviewDueDate(''); setReviewPriority('normal'); }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReviewRequest}
                disabled={selectedReviewers.length === 0 || isSubmittingReview}
                className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white disabled:opacity-50"
              >
                {isSubmittingReview ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Send Request {selectedReviewers.length > 0 && `(${selectedReviewers.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Checkout Request Modal */}
      {showCheckoutRequestModal && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowCheckoutRequestModal(false); setCheckoutRequestMessage(''); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-warning/20 flex items-center justify-center">
                <ArrowDown size={20} className="text-pdm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Request Checkout
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  Ask to check out this file
                </p>
              </div>
            </div>
            
            {/* File info */}
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-pdm-fg-muted" />
                <span className="text-pdm-fg font-medium truncate">{firstFile.name}</span>
              </div>
              <div className="mt-2 text-xs text-pdm-fg-muted">
                Currently checked out - a notification will be sent to the user who has this file.
              </div>
            </div>
            
            {/* Message */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Message (optional)
              </label>
              <textarea
                value={checkoutRequestMessage}
                onChange={(e) => setCheckoutRequestMessage(e.target.value)}
                placeholder="Why do you need this file? Any deadline?"
                className="w-full px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded resize-none focus:outline-none focus:border-pdm-accent"
                rows={3}
              />
            </div>
            
            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCheckoutRequestModal(false); setCheckoutRequestMessage(''); }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitCheckoutRequest}
                disabled={isSubmittingCheckoutRequest}
                className="btn bg-pdm-warning hover:bg-pdm-warning/90 text-white disabled:opacity-50"
              >
                {isSubmittingCheckoutRequest ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Notify/Mention Modal */}
      {showMentionModal && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowMentionModal(false); setSelectedMentionUsers([]); setMentionMessage(''); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-accent/20 flex items-center justify-center">
                <Users size={20} className="text-pdm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Notify Someone
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  Send a notification about this file
                </p>
              </div>
            </div>
            
            {/* File info */}
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-pdm-fg-muted" />
                <span className="text-pdm-fg font-medium truncate">{firstFile.name}</span>
                {firstFile.pdmData?.version && (
                  <span className="text-xs text-pdm-fg-muted">v{firstFile.pdmData.version}</span>
                )}
              </div>
            </div>
            
            {/* User selection */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Select People to Notify
              </label>
              {loadingUsers ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 size={20} className="animate-spin text-pdm-accent" />
                </div>
              ) : orgUsers.length === 0 ? (
                <p className="text-sm text-pdm-fg-muted p-2">No other users in your organization</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-pdm-border rounded bg-pdm-bg">
                  {orgUsers.map(orgUser => (
                    <label 
                      key={orgUser.id}
                      className="flex items-center gap-3 p-2 hover:bg-pdm-highlight cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMentionUsers.includes(orgUser.id)}
                        onChange={() => handleToggleMentionUser(orgUser.id)}
                        className="w-4 h-4 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent"
                      />
                      {orgUser.avatar_url ? (
                        <img 
                          src={orgUser.avatar_url} 
                          alt="" 
                          className="w-6 h-6 rounded-full"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-pdm-accent/20 flex items-center justify-center">
                          <Users size={12} className="text-pdm-accent" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-pdm-fg truncate">
                          {orgUser.full_name || orgUser.email}
                        </div>
                        {orgUser.full_name && (
                          <div className="text-xs text-pdm-fg-muted truncate">
                            {orgUser.email}
                          </div>
                        )}
                      </div>
                      {selectedMentionUsers.includes(orgUser.id) && (
                        <Check size={16} className="text-pdm-accent flex-shrink-0" />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            {/* Message */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Message
              </label>
              <textarea
                value={mentionMessage}
                onChange={(e) => setMentionMessage(e.target.value)}
                placeholder="What do you want to tell them about this file?"
                className="w-full px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded resize-none focus:outline-none focus:border-pdm-accent"
                rows={3}
              />
            </div>
            
            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowMentionModal(false); setSelectedMentionUsers([]); setMentionMessage(''); }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitMention}
                disabled={selectedMentionUsers.length === 0 || isSubmittingMention}
                className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white disabled:opacity-50"
              >
                {isSubmittingMention ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Send {selectedMentionUsers.length > 0 && `(${selectedMentionUsers.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Share Link Modal - fallback if clipboard fails */}
      {showShareModal && generatedShareLink && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowShareModal(false); setGeneratedShareLink(null); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-accent/20 flex items-center justify-center">
                <Link size={20} className="text-pdm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">Share Link Created</h3>
                <p className="text-sm text-pdm-fg-muted">Copy the link below</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={generatedShareLink}
                  readOnly
                  className="flex-1 px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded focus:outline-none"
                />
                <button
                  onClick={handleCopyShareLink}
                  className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white"
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-xs text-pdm-fg-muted">Expires in 7 days • Anyone with link can download</p>
              
              <div className="flex justify-end">
                <button
                  onClick={() => { setShowShareModal(false); setGeneratedShareLink(null); onClose(); }}
                  className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Add to ECO Modal */}
      {showECOModal && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowECOModal(false); setSelectedECO(null); setEcoNotes(''); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-accent/20 flex items-center justify-center">
                <ClipboardList size={20} className="text-pdm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Add to ECO
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  Add file to Engineering Change Order
                </p>
              </div>
            </div>
            
            {/* File info */}
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-pdm-fg-muted" />
                <span className="text-pdm-fg font-medium truncate">{firstFile.name}</span>
              </div>
            </div>
            
            {/* ECO selection */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Select ECO
              </label>
              {loadingECOs ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 size={20} className="animate-spin text-pdm-accent" />
                </div>
              ) : activeECOs.length === 0 ? (
                <p className="text-sm text-pdm-fg-muted p-2">No active ECOs found. Create one in the ECO Manager first.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-pdm-border rounded bg-pdm-bg">
                  {activeECOs.map(eco => (
                    <label 
                      key={eco.id}
                      className="flex items-center gap-3 p-2 hover:bg-pdm-highlight cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="eco"
                        value={eco.id}
                        checked={selectedECO === eco.id}
                        onChange={() => setSelectedECO(eco.id)}
                        className="w-4 h-4 border-pdm-border text-pdm-accent focus:ring-pdm-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-pdm-fg font-medium">
                          {eco.eco_number}
                        </div>
                        {eco.title && (
                          <div className="text-xs text-pdm-fg-muted truncate">
                            {eco.title}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            {/* Notes */}
            <div className="mb-4">
              <label className="block text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
                Notes (optional)
              </label>
              <textarea
                value={ecoNotes}
                onChange={(e) => setEcoNotes(e.target.value)}
                placeholder="Why is this file part of this ECO?"
                className="w-full px-3 py-2 text-sm bg-pdm-bg border border-pdm-border rounded resize-none focus:outline-none focus:border-pdm-accent"
                rows={2}
              />
            </div>
            
            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowECOModal(false); setSelectedECO(null); setEcoNotes(''); }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleAddToECO}
                disabled={!selectedECO || isAddingToECO}
                className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white disabled:opacity-50"
              >
                {isAddingToECO ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ClipboardList size={14} />
                )}
                Add to ECO
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Helper function to format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
