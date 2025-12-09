import { 
  Trash2, 
  Copy, 
  Scissors, 
  ClipboardPaste,
  FolderOpen,
  ExternalLink,
  ArrowDown,
  ArrowUp,
  Cloud,
  CloudOff,
  Edit,
  FolderPlus,
  Pin,
  History,
  Info,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { checkoutFile, checkinFile, syncFile, supabase } from '../lib/supabase'
import { downloadFile } from '../lib/storage'

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
  const { user, organization, vaultPath, activeVaultId, addToast, addProgressToast, updateProgressToast, removeToast, isProgressToastCancelled, pinnedFolders, pinFolder, unpinFolder, connectedVaults, addProcessingFolder, removeProcessingFolder, queueOperation, hasPathConflict, updateFileInStore } = usePDMStore()
  
  const [showProperties, setShowProperties] = useState(false)
  const [folderSize, setFolderSize] = useState<{ size: number; fileCount: number; folderCount: number } | null>(null)
  const [isCalculatingSize, setIsCalculatingSize] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmFiles, setDeleteConfirmFiles] = useState<LocalFile[]>([])
  const [isDeleting, setIsDeleting] = useState(false)
  const [platform, setPlatform] = useState<string>('win32')
  
  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])
  
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
  
  // Check for synced content - either direct files or files inside selected folders
  const hasSyncedContent = () => {
    for (const item of contextFiles) {
      if (item.isDirectory) {
        const folderPrefix = item.relativePath + '/'
        const hasSyncedInFolder = files.some(f => 
          !f.isDirectory && 
          f.pdmData &&
          f.diffStatus !== 'cloud' &&
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
  
  // Check for unsynced content
  const hasUnsyncedContent = () => {
    for (const item of contextFiles) {
      if (item.isDirectory) {
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
  
  // Get all synced files in selection
  const getSyncedFilesInSelection = (): LocalFile[] => {
    const result: LocalFile[] = []
    for (const item of contextFiles) {
      if (item.isDirectory) {
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
  
  // Get unsynced files in selection
  const getUnsyncedFilesInSelection = (): LocalFile[] => {
    const result: LocalFile[] = []
    for (const item of contextFiles) {
      if (item.isDirectory) {
        const folderPrefix = item.relativePath + '/'
        const filesInFolder = files.filter(f => 
          !f.isDirectory && 
          (!f.pdmData || f.diffStatus === 'added') &&
          (f.relativePath.startsWith(folderPrefix) || 
           f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
        )
        result.push(...filesInFolder)
      } else if (!item.pdmData || item.diffStatus === 'added') {
        result.push(item)
      }
    }
    return result
  }
  const unsyncedFilesInSelection = getUnsyncedFilesInSelection()
  
  // Check out/in status
  const allCheckedOut = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by)
  const allCheckedIn = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => !f.pdmData?.checked_out_by)
  
  // Count files that can be checked out (synced but not checked out)
  const checkoutableCount = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by).length
  // Count files that can be checked in (checked out by current user)
  const checkinableCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user?.id).length
  
  const countLabel = multiSelect 
    ? `(${fileCount > 0 ? `${fileCount} file${fileCount > 1 ? 's' : ''}` : ''}${fileCount > 0 && folderCount > 0 ? ', ' : ''}${folderCount > 0 ? `${folderCount} folder${folderCount > 1 ? 's' : ''}` : ''})`
    : ''
  
  // Check for cloud-only files
  const allCloudOnly = contextFiles.every(f => f.diffStatus === 'cloud')
  const hasUnsyncedLocalFiles = unsyncedFilesInSelection.length > 0
  
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
  
  // Handlers
  const handleOpen = () => {
    if (firstFile.isDirectory) {
      // Open folder in Windows Explorer
      window.electronAPI?.showInExplorer(firstFile.path)
    } else {
      window.electronAPI?.openFile(firstFile.path)
    }
    onClose()
  }
  
  const handleShowInExplorer = () => {
    window.electronAPI?.showInExplorer(firstFile.path)
    onClose()
  }
  
  const handleCheckout = async () => {
    if (!user) return
    onClose()
    
    const filesToCheckout = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by)
    if (filesToCheckout.length === 0) {
      addToast('info', 'All files are already checked out')
      return
    }
    
    // Add folder spinners for folders being processed
    const foldersBeingProcessed = contextFiles.filter(f => f.isDirectory).map(f => f.relativePath)
    foldersBeingProcessed.forEach(p => addProcessingFolder(p))
    
    // Show progress toast
    const toastId = `checkout-${Date.now()}`
    addProgressToast(toastId, `Checking out ${filesToCheckout.length} file${filesToCheckout.length > 1 ? 's' : ''}...`, filesToCheckout.length)
    
    let succeeded = 0
    let failed = 0
    
    for (let i = 0; i < filesToCheckout.length; i++) {
      const file = filesToCheckout[i]
      try {
        const result = await checkoutFile(file.pdmData!.id, user.id)
        if (result.success) {
          await window.electronAPI?.setReadonly(file.path, false)
          // Update file in store directly instead of full refresh
          updateFileInStore(file.path, {
            pdmData: { 
              ...file.pdmData!, 
              checked_out_by: user.id,
              checked_out_user: { 
                full_name: user.full_name, 
                email: user.email, 
                avatar_url: user.avatar_url 
              }
            }
          })
          succeeded++
        } else {
          failed++
        }
      } catch {
        failed++
      }
      
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / filesToCheckout.length) * 100))
    }
    
    // Clean up
    foldersBeingProcessed.forEach(p => removeProcessingFolder(p))
    removeToast(toastId)
    
    if (failed > 0) {
      addToast('warning', `Checked out ${succeeded}/${filesToCheckout.length} files`)
    } else {
      addToast('success', `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
  }
  
  const handleCheckin = async () => {
    if (!user) return
    onClose()
    
    const filesToCheckin = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user.id)
    if (filesToCheckin.length === 0) {
      addToast('info', 'No files are checked out by you')
      return
    }
    
    // Add folder spinners for folders being processed
    const foldersBeingProcessed = contextFiles.filter(f => f.isDirectory).map(f => f.relativePath)
    foldersBeingProcessed.forEach(p => addProcessingFolder(p))
    
    // Show progress toast
    const toastId = `checkin-${Date.now()}`
    addProgressToast(toastId, `Checking in ${filesToCheckin.length} file${filesToCheckin.length > 1 ? 's' : ''}...`, filesToCheckin.length)
    
    let succeeded = 0
    let failed = 0
    
    for (let i = 0; i < filesToCheckin.length; i++) {
      const file = filesToCheckin[i]
      try {
        const readResult = await window.electronAPI?.readFile(file.path)
        if (readResult?.success && readResult.hash) {
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newContentHash: readResult.hash,
            newFileSize: file.size
          })
          if (result.success) {
            await window.electronAPI?.setReadonly(file.path, true)
            // Update file in store directly instead of full refresh
            updateFileInStore(file.path, {
              pdmData: { ...file.pdmData!, checked_out_by: null, checked_out_user: null },
              localHash: readResult.hash,
              diffStatus: undefined  // Now in sync
            })
            succeeded++
          } else {
            failed++
          }
        } else {
          const result = await checkinFile(file.pdmData!.id, user.id)
          if (result.success) {
            await window.electronAPI?.setReadonly(file.path, true)
            // Update file in store directly
            updateFileInStore(file.path, {
              pdmData: { ...file.pdmData!, checked_out_by: null, checked_out_user: null }
            })
            succeeded++
          } else {
            failed++
          }
        }
      } catch {
        failed++
      }
      
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / filesToCheckin.length) * 100))
    }
    
    // Clean up
    foldersBeingProcessed.forEach(p => removeProcessingFolder(p))
    removeToast(toastId)
    
    if (failed > 0) {
      addToast('warning', `Checked in ${succeeded}/${filesToCheckin.length} files`)
    } else {
      addToast('success', `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
  }
  
  const handleFirstCheckin = async () => {
    if (!user || !organization || !activeVaultId) return
    onClose()
    
    const filesToSync = unsyncedFilesInSelection
    if (filesToSync.length === 0) {
      addToast('info', 'No unsynced files to check in')
      return
    }
    
    // Add folder spinners for folders being processed
    const foldersBeingProcessed = contextFiles.filter(f => f.isDirectory).map(f => f.relativePath)
    foldersBeingProcessed.forEach(p => addProcessingFolder(p))
    
    // Show progress toast
    const toastId = `first-checkin-${Date.now()}`
    addProgressToast(toastId, `Uploading ${filesToSync.length} file${filesToSync.length > 1 ? 's' : ''}...`, filesToSync.length)
    
    let succeeded = 0
    let failed = 0
    
    for (let i = 0; i < filesToSync.length; i++) {
      const file = filesToSync[i]
      try {
        const readResult = await window.electronAPI?.readFile(file.path)
        if (readResult?.success && readResult.data && readResult.hash) {
          const { error } = await syncFile(
            organization.id,
            activeVaultId,
            user.id,
            file.relativePath,
            file.name,
            file.extension,
            file.size,
            readResult.hash,
            readResult.data
          )
          if (!error) {
            await window.electronAPI?.setReadonly(file.path, true)
            succeeded++
          } else {
            failed++
          }
        } else {
          failed++
        }
      } catch {
        failed++
      }
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / filesToSync.length) * 100))
    }
    
    // Clean up
    foldersBeingProcessed.forEach(p => removeProcessingFolder(p))
    removeToast(toastId)
    
    if (failed > 0) {
      addToast('warning', `Synced ${succeeded}/${filesToSync.length} files`)
    } else {
      addToast('success', `Synced ${succeeded} file${succeeded > 1 ? 's' : ''} to cloud`)
    }
    onRefresh(true)
  }
  
  const handleDownload = async () => {
    if (!organization || !vaultPath) return
    onClose()
    
    // Get folder paths being operated on
    const foldersBeingProcessed = contextFiles.filter(f => f.isDirectory).map(f => f.relativePath)
    const operationPaths = foldersBeingProcessed.length > 0 ? foldersBeingProcessed : contextFiles.map(f => f.relativePath)
    
    // Define the download operation
    const executeDownload = async () => {
      // Get cloud-only files and track which folders actually have files to download
      const cloudFiles: LocalFile[] = []
      const foldersWithCloudFiles: string[] = []
      
      for (const item of contextFiles) {
        if (item.isDirectory) {
          const folderPrefix = item.relativePath + '/'
          const filesInFolder = files.filter(f => 
            !f.isDirectory && 
            f.diffStatus === 'cloud' &&
            f.relativePath.startsWith(folderPrefix)
          )
          if (filesInFolder.length > 0) {
            cloudFiles.push(...filesInFolder)
            foldersWithCloudFiles.push(item.relativePath)
          }
        } else if (item.diffStatus === 'cloud' && item.pdmData) {
          cloudFiles.push(item)
        }
      }
      
      if (cloudFiles.length === 0) {
        addToast('info', 'No cloud files to download')
        return
      }
      
      // Only track folders that actually have files to download
      foldersWithCloudFiles.forEach(p => addProcessingFolder(p))
      
      // Create a unique toast ID for this download operation
      const toastId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const folderName = foldersWithCloudFiles.length > 0 
        ? foldersWithCloudFiles[0].split('/').pop() 
        : 'files'
      addProgressToast(toastId, `Downloading ${folderName}...`, cloudFiles.length)
      
    let succeeded = 0
    let failed = 0
    let downloadedBytes = 0
    let wasCancelled = false
    const startTime = Date.now()
    
    const formatSpeed = (bytesPerSec: number) => {
      if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
      if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
      return `${bytesPerSec.toFixed(0)} B/s`
    }
    
    for (let i = 0; i < cloudFiles.length; i++) {
      // Check for cancellation
      if (isProgressToastCancelled(toastId)) {
        wasCancelled = true
        break
      }
      
      const file = cloudFiles[i]
      if (!file.pdmData?.content_hash) {
        failed++
        continue
      }
      
      try {
        const { data, error } = await downloadFile(organization.id, file.pdmData.content_hash)
        if (!error && data) {
          // Construct path with platform-appropriate separators
          const fullPath = buildFullPath(vaultPath, file.relativePath)
          const parentDir = getParentDir(fullPath)
          await window.electronAPI?.createFolder(parentDir)
          
          // Convert Blob to base64 for IPC transfer
          const arrayBuffer = await data.arrayBuffer()
          downloadedBytes += arrayBuffer.byteLength
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
          } else {
            console.error('Failed to write file:', file.name, result?.error)
            failed++
          }
        } else {
          console.error('Download error for', file.name, ':', error)
          failed++
        }
      } catch (err) {
        console.error('Download exception for', file.name, ':', err)
        failed++
      }
      
      // Calculate and display speed
      const elapsed = (Date.now() - startTime) / 1000
      const speed = elapsed > 0 ? downloadedBytes / elapsed : 0
      const percent = Math.round(((i + 1) / cloudFiles.length) * 100)
      updateProgressToast(toastId, i + 1, percent, formatSpeed(speed))
    }
    
    // Remove progress toast
    removeToast(toastId)
    foldersWithCloudFiles.forEach(p => removeProcessingFolder(p))
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    const avgSpeed = formatSpeed(downloadedBytes / parseFloat(totalTime))
    
    if (wasCancelled) {
      addToast('warning', `Download stopped. ${succeeded} files downloaded.`)
    } else if (failed > 0) {
      addToast('warning', `Downloaded ${succeeded}/${cloudFiles.length} files in ${totalTime}s (${avgSpeed})`)
    } else {
      addToast('success', `Downloaded ${succeeded} file${succeeded > 1 ? 's' : ''} in ${totalTime}s (${avgSpeed})`)
    }
    onRefresh(true)
    }
    
    // Check for path conflicts
    if (hasPathConflict(operationPaths)) {
      const folderNames = foldersBeingProcessed.length > 0 
        ? foldersBeingProcessed.map(p => p.split('/').pop()).join(', ')
        : 'files'
      queueOperation({
        type: 'download',
        label: `Download ${folderNames}`,
        paths: operationPaths,
        execute: executeDownload
      })
      addToast('info', `Download queued - waiting for current operation to complete`)
    } else {
      executeDownload()
    }
  }
  
  const handleDeleteLocal = async () => {
    onClose()
    
    // Get folder paths being operated on
    const foldersBeingProcessed = contextFiles.filter(f => f.isDirectory).map(f => f.relativePath)
    const operationPaths = foldersBeingProcessed.length > 0 ? foldersBeingProcessed : contextFiles.map(f => f.relativePath)
    
    // Define the delete operation
    const executeDelete = async () => {
      // Track folders being processed for spinner display
      foldersBeingProcessed.forEach(p => addProcessingFolder(p))
      
      // Get files to remove - both synced files that exist locally AND unsynced local files
      const syncedLocalFiles = syncedFilesInSelection.filter(f => f.diffStatus !== 'cloud')
      const unsyncedLocalFiles = unsyncedFilesInSelection.filter(f => !f.isDirectory)
      const filesToRemove = [...syncedLocalFiles, ...unsyncedLocalFiles]
      
      if (filesToRemove.length === 0) {
        foldersBeingProcessed.forEach(p => removeProcessingFolder(p))
        addToast('info', 'No local files to remove')
        return
      }
      
      // Create a unique toast ID for this delete operation
      const toastId = `delete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const folderName = foldersBeingProcessed.length > 0 
        ? foldersBeingProcessed[0].split('/').pop() 
        : 'files'
      addProgressToast(toastId, `Removing ${folderName}...`, filesToRemove.length)
      
    let removed = 0
    let failed = 0
    
    for (let i = 0; i < filesToRemove.length; i++) {
      const file = filesToRemove[i]
      
      try {
        // If checked out by me, release the checkout first
        if (file.pdmData?.checked_out_by === user?.id && file.pdmData?.id) {
          await checkinFile(file.pdmData.id, user!.id)
        }
        
        const result = await window.electronAPI?.deleteItem(file.path)
        if (result?.success) {
          removed++
        } else {
          console.error('Failed to delete file:', file.name, result?.error)
          failed++
        }
      } catch (err) {
        console.error('Failed to remove file:', file.name, err)
        failed++
      }
      
      // Update progress
      const percent = Math.round(((i + 1) / filesToRemove.length) * 100)
      updateProgressToast(toastId, i + 1, percent)
    }
    
    // Clean up empty parent directories
    if (vaultPath) {
      const parentDirs = new Set<string>()
      for (const file of filesToRemove) {
        let dir = file.path.substring(0, file.path.lastIndexOf('\\'))
        while (dir && dir.length > vaultPath.length) {
          parentDirs.add(dir)
          const lastSlash = dir.lastIndexOf('\\')
          if (lastSlash <= 0) break
          dir = dir.substring(0, lastSlash)
        }
      }
      
      // Also include folders that were selected
      for (const item of contextFiles) {
        if (item.isDirectory && item.diffStatus !== 'cloud') {
          parentDirs.add(item.path)
        }
      }
      
      // Sort by depth (deepest first)
      const sortedDirs = Array.from(parentDirs).sort((a, b) => {
        return b.split('\\').length - a.split('\\').length
      })
      
      for (const dir of sortedDirs) {
        try {
          await window.electronAPI?.deleteItem(dir)
        } catch {
          // Folder might not be empty - expected
        }
      }
    }
    
    // Remove progress toast
    removeToast(toastId)
    foldersBeingProcessed.forEach(p => removeProcessingFolder(p))
    
    if (failed > 0) {
      addToast('warning', `Removed ${removed}/${filesToRemove.length} files locally`)
    } else if (removed > 0) {
      addToast('success', `Removed ${removed} file${removed > 1 ? 's' : ''} locally`)
    }
    
    onRefresh(true)
    }
    
    // Check for path conflicts
    if (hasPathConflict(operationPaths)) {
      const folderNames = foldersBeingProcessed.length > 0 
        ? foldersBeingProcessed.map(p => p.split('/').pop()).join(', ')
        : 'files'
      queueOperation({
        type: 'delete',
        label: `Remove local copy of ${folderNames}`,
        paths: operationPaths,
        execute: executeDelete
      })
      addToast('info', `Delete queued - waiting for current operation to complete`)
    } else {
      executeDelete()
    }
  }
  
  // Handle delete from server (for cloud-only files or synced files)
  const handleDeleteFromServer = () => {
    // Get all files to delete from server
    const cloudFiles = contextFiles.filter(f => f.diffStatus === 'cloud' || (f.pdmData && f.diffStatus !== 'added'))
    
    // Also get files inside folders
    const allFilesToDelete: LocalFile[] = []
    for (const item of cloudFiles) {
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
    
    if (uniqueFiles.length === 0) {
      addToast('warning', 'No files to delete from server')
      onClose()
      return
    }
    
    setDeleteConfirmFiles(uniqueFiles)
    setShowDeleteConfirm(true)
  }
  
  // Execute server delete after confirmation
  const executeDeleteFromServer = async () => {
    setIsDeleting(true)
    
    const total = deleteConfirmFiles.length
    const toastId = `delete-server-${Date.now()}`
    addProgressToast(toastId, `Deleting ${total} file${total > 1 ? 's' : ''} from server...`, total)
    
    let deleted = 0
    let failed = 0
    
    for (let i = 0; i < deleteConfirmFiles.length; i++) {
      const file = deleteConfirmFiles[i]
      
      // Check for cancellation
      if (isProgressToastCancelled(toastId)) {
        break
      }
      
      if (!file.pdmData?.id) {
        failed++
        updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
        continue
      }
      
      try {
        const { error } = await supabase
          .from('files')
          .delete()
          .eq('id', file.pdmData.id)
        
        if (!error) {
          // Also delete local copy if it exists
          if (file.diffStatus !== 'cloud' && vaultPath) {
            await window.electronAPI?.deleteItem(file.path)
          }
          deleted++
        } else {
          failed++
        }
      } catch (err) {
        console.error('Failed to delete file from server:', file.name, err)
        failed++
      }
      
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
    }
    
    removeToast(toastId)
    setIsDeleting(false)
    setShowDeleteConfirm(false)
    setDeleteConfirmFiles([])
    onClose()
    
    if (deleted > 0) {
      addToast('success', `Deleted ${deleted} file${deleted > 1 ? 's' : ''} from server`)
      onRefresh(true)
    }
    if (failed > 0) {
      addToast('warning', `Failed to delete ${failed} file${failed > 1 ? 's' : ''}`)
    }
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
        className="context-menu"
        style={{ left: x, top: y }}
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
            // Synced files require checkout to rename
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
            {onCut && (
              <div className="context-menu-item" onClick={() => { onCut(); onClose(); }}>
                <Scissors size={14} />
                Cut
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+X</span>
              </div>
            )}
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
        {anyUnsynced && !anySynced && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleFirstCheckin}>
            <Cloud size={14} />
            First Check In {countLabel}
          </div>
        )}
        
        {/* Check Out */}
        <div 
          className={`context-menu-item ${!anySynced || allCheckedOut ? 'disabled' : ''}`}
          onClick={() => {
            if (!anySynced || allCheckedOut) return
            handleCheckout()
          }}
          title={!anySynced ? 'Check in files first to enable checkout' : allCheckedOut ? 'Already checked out' : ''}
        >
          <ArrowDown size={14} className={!anySynced ? 'text-pdm-fg-muted' : 'text-pdm-warning'} />
          Check Out {allFolders && !multiSelect && checkoutableCount > 0 ? `${checkoutableCount} files` : countLabel}
          {!anySynced && <span className="text-xs text-pdm-fg-muted ml-auto">(check in first)</span>}
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
        
        <div className="context-menu-separator" />
        
        {/* Show History - for folders, opens in details panel */}
        {!multiSelect && isFolder && (
          <div 
            className="context-menu-item"
            onClick={() => {
              // Open history tab in details panel - it will show folder activity
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
        
        {/* Properties */}
        <div 
          className="context-menu-item"
          onClick={async () => {
            if (isFolder && !multiSelect) {
              setIsCalculatingSize(true)
              setShowProperties(true)
              // Calculate folder size
              const filesInFolder = files.filter(f => 
                !f.isDirectory && f.relativePath.startsWith(firstFile.relativePath + '/')
              )
              const foldersInFolder = files.filter(f => 
                f.isDirectory && f.relativePath.startsWith(firstFile.relativePath + '/') && f.relativePath !== firstFile.relativePath
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
        
        <div className="context-menu-separator" />
        
        {/* Remove Local Copy - for synced files, removes local but keeps server */}
        {anySynced && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleDeleteLocal}>
            <Trash2 size={14} />
            Remove Local Copy {countLabel}
          </div>
        )}
        
        {/* Delete Locally - for unsynced local files only */}
        {hasUnsyncedLocalFiles && !anySynced && !allCloudOnly && (
          <div className="context-menu-item danger" onClick={handleDeleteLocal}>
            <Trash2 size={14} />
            Delete Locally {countLabel}
          </div>
        )}
        
        {/* Delete from Server / Delete Everywhere */}
        {(anySynced || allCloudOnly) && (
          <div className="context-menu-item danger" onClick={handleDeleteFromServer}>
            <CloudOff size={14} />
            {allCloudOnly ? 'Delete from Server' : 'Delete Everywhere'} {countLabel}
          </div>
        )}
      </div>
      
      {/* Properties Modal */}
      {showProperties && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => { setShowProperties(false); onClose(); }} />
          <div className="relative bg-pdm-panel border border-pdm-border rounded-lg shadow-xl w-[400px] max-h-[80vh] overflow-auto">
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
                <div className="text-sm">
                  {firstFile.diffStatus === 'cloud' ? 'Cloud only (not downloaded)' 
                    : firstFile.diffStatus === 'added' ? 'Local only (not synced)'
                    : firstFile.diffStatus === 'modified' ? 'Modified locally'
                    : firstFile.diffStatus === 'outdated' ? 'Outdated (newer version on server)'
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => { setShowDeleteConfirm(false); onClose(); }} />
          <div className="relative bg-pdm-bg-light border border-pdm-error/50 rounded-xl shadow-2xl w-[450px] overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-error/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-error/20 rounded-full">
                  <AlertTriangle size={24} className="text-pdm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Delete from Server</h3>
                  <p className="text-sm text-pdm-fg-muted">
                    {deleteConfirmFiles.length} file{deleteConfirmFiles.length !== 1 ? 's' : ''} will be permanently deleted
                  </p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="p-4 bg-pdm-error/10 border border-pdm-error/30 rounded-lg">
                <p className="text-sm text-pdm-fg mb-3">
                  <strong>Warning:</strong> This action cannot be undone. The following will be deleted:
                </p>
                <div className="max-h-32 overflow-auto text-sm text-pdm-fg-dim space-y-1">
                  {deleteConfirmFiles.slice(0, 10).map((f, i) => (
                    <div key={i} className="truncate flex items-center gap-2">
                      <span className="w-2 h-2 bg-pdm-error/50 rounded-full flex-shrink-0"></span>
                      {f.name}
                    </div>
                  ))}
                  {deleteConfirmFiles.length > 10 && (
                    <div className="text-pdm-fg-muted">...and {deleteConfirmFiles.length - 10} more files</div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); onClose(); }}
                className="btn btn-ghost"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteFromServer}
                disabled={isDeleting}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete from Server
                  </>
                )}
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

