import { useState, useRef, useCallback } from 'react'
import { usePDMStore, LocalFile } from '../../../../stores/pdmStore'
import { buildFullPath } from '../../../../lib/utils'
import { PDM_FILES_DATA_TYPE, MIME_TYPES } from '../constants'

interface DragDropHandlers {
  // State
  draggedFilesRef: React.MutableRefObject<LocalFile[]>
  dragOverFolder: string | null
  
  // Setters
  setDragOverFolder: (folder: string | null) => void
  
  // Handlers
  handleDragStart: (e: React.DragEvent, filesToDrag: LocalFile[], file: LocalFile) => void
  handleDragEnd: () => void
  handleFolderDragOver: (e: React.DragEvent, file: LocalFile, filesToCheck: LocalFile[]) => void
  handleFolderDragLeave: (e: React.DragEvent) => void
  handleDropOnFolder: (e: React.DragEvent, targetFolder: LocalFile, onRefresh?: (silent?: boolean) => void) => Promise<void>
  handleVaultRootDrop: (e: React.DragEvent, onRefresh?: (silent?: boolean) => void) => Promise<void>
  canMoveFiles: (filesToCheck: LocalFile[]) => boolean
}

/**
 * Hook for managing drag and drop operations in the explorer tree
 */
export function useTreeDragDrop(): DragDropHandlers {
  const {
    files,
    vaultPath,
    user,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    addProcessingFolder,
    removeProcessingFolder,
    renameFileInStore
  } = usePDMStore()
  
  // State for drag over highlighting
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  
  // Ref for tracking dragged files synchronously
  const draggedFilesRef = useRef<LocalFile[]>([])
  
  // Check if files can be moved (all synced files must be checked out by user)
  const canMoveFiles = useCallback((filesToCheck: LocalFile[]): boolean => {
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
  }, [files, user?.id])
  
  // Handle drag start
  const handleDragStart = useCallback((e: React.DragEvent, filesToDrag: LocalFile[], file: LocalFile) => {
    if (filesToDrag.length === 0) {
      e.preventDefault()
      return
    }
    
    // Track dragged files for internal moves
    draggedFilesRef.current = filesToDrag
    
    const filePaths = filesToDrag.map(f => f.path)
    
    // Set up HTML5 drag data
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', filePaths.join('\n'))
    // Set PDM-specific data for cross-view drag
    e.dataTransfer.setData(PDM_FILES_DATA_TYPE, JSON.stringify(filesToDrag.map(f => f.relativePath)))
    
    // Use DownloadURL format for single non-folder file
    if (filesToDrag.length === 1 && !filesToDrag[0].isDirectory) {
      const filePath = filesToDrag[0].path
      const fileName = filesToDrag[0].name
      const ext = filesToDrag[0].extension?.toLowerCase() || ''
      const mime = MIME_TYPES[ext] || 'application/octet-stream'
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
  }, [])
  
  // Handle drag end
  const handleDragEnd = useCallback(() => {
    draggedFilesRef.current = []
    setDragOverFolder(null)
  }, [])
  
  // Handle drag over folder
  const handleFolderDragOver = useCallback((e: React.DragEvent, file: LocalFile, filesToCheck: LocalFile[]) => {
    e.preventDefault()
    e.stopPropagation()
    
    const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
    const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
    const currentDraggedFiles = draggedFilesRef.current
    
    if (!hasPdmFiles && !hasExternalFiles && currentDraggedFiles.length === 0) return
    
    if (file.isDirectory) {
      if (hasExternalFiles) {
        e.dataTransfer.dropEffect = 'copy'
        setDragOverFolder(file.relativePath)
        return
      }
      
      const actualFilesToCheck = filesToCheck.length > 0 ? filesToCheck : currentDraggedFiles
      
      // Don't allow dropping a folder into itself or its children
      const isDroppingIntoSelf = actualFilesToCheck.some(f => 
        f.isDirectory && (file.relativePath === f.relativePath || file.relativePath.startsWith(f.relativePath + '/'))
      )
      if (isDroppingIntoSelf) return
      
      // Don't allow dropping if the target is the current parent
      const wouldStayInPlace = actualFilesToCheck.length > 0 && actualFilesToCheck.every(f => {
        const parentPath = f.relativePath.includes('/') 
          ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
          : ''
        return parentPath === file.relativePath
      })
      if (wouldStayInPlace) return
      
      // Check if all files can be moved
      if (actualFilesToCheck.length > 0 && !canMoveFiles(actualFilesToCheck)) {
        e.dataTransfer.dropEffect = 'none'
        return
      }
      
      e.dataTransfer.dropEffect = 'move'
      setDragOverFolder(file.relativePath)
    }
  }, [canMoveFiles])
  
  // Handle drag leave
  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
  }, [])
  
  // Handle drop on folder
  const handleDropOnFolder = useCallback(async (
    e: React.DragEvent, 
    targetFolder: LocalFile,
    onRefresh?: (silent?: boolean) => void
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
    
    if (!window.electronAPI || !vaultPath) return
    
    // Check for external files first
    const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
    const droppedExternalFiles = Array.from(e.dataTransfer.files)
    
    if (droppedExternalFiles.length > 0 && !hasPdmFiles) {
      // Handle external file drop
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

          const result = await window.electronAPI.copyFile(sourcePath, destPath)
          if (result.success) {
            successCount++
          } else {
            errorCount++
          }
          
          const percent = Math.round(((i + 1) / totalFiles) * 100)
          updateProgressToast(toastId, i + 1, percent)
        }

        removeToast(toastId)
        
        if (errorCount === 0) {
          addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''} to ${targetFolder.name}`)
        } else {
          addToast('warning', `Added ${successCount}, failed ${errorCount}`)
        }

        setTimeout(() => onRefresh?.(), 100)
      } catch (err) {
        console.error('Error adding files:', err)
        removeToast(toastId)
        addToast('error', 'Failed to add files')
      }
      return
    }
    
    // Get files from data transfer or local state
    let filesToMove: LocalFile[] = []
    const currentDraggedFiles = draggedFilesRef.current
    
    if (currentDraggedFiles.length > 0) {
      filesToMove = currentDraggedFiles
      draggedFilesRef.current = []
    } else {
      const pdmFilesData = e.dataTransfer.getData(PDM_FILES_DATA_TYPE)
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
        }
      } catch {
        failed++
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
  }, [files, vaultPath, user?.id, addToast, addProgressToast, updateProgressToast, removeToast])
  
  // Handle drop on vault root
  const handleVaultRootDrop = useCallback(async (
    e: React.DragEvent,
    onRefresh?: (silent?: boolean) => void
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
    
    if (!window.electronAPI || !vaultPath) return
    
    // Check for external files first
    const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
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

          const result = await window.electronAPI.copyFile(sourcePath, destPath)
          if (result.success) {
            successCount++
          } else {
            errorCount++
          }
          
          const percent = Math.round(((i + 1) / totalFiles) * 100)
          updateProgressToast(toastId, i + 1, percent)
        }

        removeToast(toastId)
        
        if (errorCount === 0) {
          addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''} to vault root`)
        } else {
          addToast('warning', `Added ${successCount}, failed ${errorCount}`)
        }

        setTimeout(() => onRefresh?.(), 100)
      } catch (err) {
        console.error('Error adding files:', err)
        removeToast(toastId)
        addToast('error', 'Failed to add files')
      }
      return
    }
    
    // Get files from data transfer or local state
    let filesToMove: LocalFile[] = []
    const currentDraggedFiles = draggedFilesRef.current
    
    if (currentDraggedFiles.length > 0) {
      filesToMove = currentDraggedFiles
      draggedFilesRef.current = []
    } else {
      const pdmFilesData = e.dataTransfer.getData(PDM_FILES_DATA_TYPE)
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
      const newRelPath = file.name
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
  }, [files, vaultPath, user?.id, addToast, addProgressToast, updateProgressToast, removeToast, addProcessingFolder, removeProcessingFolder, renameFileInStore])
  
  return {
    draggedFilesRef,
    dragOverFolder,
    setDragOverFolder,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleDropOnFolder,
    handleVaultRootDrop,
    canMoveFiles
  }
}
