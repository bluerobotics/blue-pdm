import { useState, useCallback } from 'react'
import type { LocalFile } from '../../../stores/pdmStore'
import { logDragDrop } from '../../../lib/userActionLogger'

export interface UseFileDragDropOptions {
  files: LocalFile[]
  selectedFiles: string[]
}

export interface UseFileDragDropReturn {
  draggedFiles: LocalFile[]
  setDraggedFiles: (files: LocalFile[]) => void
  dragOverFolder: string | null
  setDragOverFolder: (folder: string | null) => void
  isDraggingOver: boolean
  setIsDraggingOver: (dragging: boolean) => void
  isExternalDrag: boolean
  setIsExternalDrag: (external: boolean) => void
  handleDragStart: (e: React.DragEvent, file: LocalFile) => void
  handleDragEnd: () => void
  handleFolderDragOver: (e: React.DragEvent, folder: LocalFile) => void
  handleFolderDragLeave: (e: React.DragEvent) => void
  canDropOnFolder: (folder: LocalFile, filesToDrop: LocalFile[]) => boolean
}

/**
 * Hook to manage drag and drop state and handlers
 */
export function useFileDragDrop({
  files,
  selectedFiles
}: UseFileDragDropOptions): UseFileDragDropReturn {
  const [draggedFiles, setDraggedFiles] = useState<LocalFile[]>([])
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isExternalDrag, setIsExternalDrag] = useState(false)

  const handleDragStart = useCallback((e: React.DragEvent, file: LocalFile) => {
    logDragDrop('Started dragging files', { fileName: file.name, isDirectory: file.isDirectory })
    
    // Get files to drag - now supports both files and folders
    let filesToDrag: LocalFile[]
    if (selectedFiles.includes(file.path)) {
      // If the dragged file is in the selection, drag all selected
      filesToDrag = files.filter(f => selectedFiles.includes(f.path))
    } else {
      // Otherwise just drag this file
      filesToDrag = [file]
    }
    
    setDraggedFiles(filesToDrag)
    
    // Set drag image (optional - browser default is fine)
    // Set data for the drop target
    const fileNames = filesToDrag.map(f => f.name).join(', ')
    e.dataTransfer.setData('text/plain', fileNames)
    e.dataTransfer.effectAllowed = 'move'
    
    // For native file drag (Electron), add the file paths
    if (window.electronAPI?.startDrag) {
      const localFiles = filesToDrag.filter(f => 
        f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new'
      )
      if (localFiles.length > 0) {
        window.electronAPI.startDrag(localFiles.map(f => f.path))
      }
    }
  }, [files, selectedFiles])

  const handleDragEnd = useCallback(() => {
    setDraggedFiles([])
    setDragOverFolder(null)
    setIsDraggingOver(false)
    setIsExternalDrag(false)
  }, [])

  const canDropOnFolder = useCallback((folder: LocalFile, filesToDrop: LocalFile[]): boolean => {
    if (!folder.isDirectory) return false
    
    // Can't drop into cloud-only folder
    if (folder.diffStatus === 'cloud' || folder.diffStatus === 'cloud_new') {
      return false
    }
    
    // Can't drop folder into itself
    const isDroppingIntoSelf = filesToDrop.some(f => 
      f.isDirectory && (
        folder.relativePath === f.relativePath || 
        folder.relativePath.startsWith(f.relativePath + '/')
      )
    )
    if (isDroppingIntoSelf) return false
    
    // Don't allow if already in that folder
    const wouldStayInPlace = filesToDrop.every(f => {
      const parentPath = f.relativePath.includes('/') 
        ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
        : ''
      return parentPath === folder.relativePath
    })
    if (wouldStayInPlace) return false
    
    return true
  }, [])

  const handleFolderDragOver = useCallback((e: React.DragEvent, folder: LocalFile) => {
    // Check if this is an internal drag or external
    const isInternal = draggedFiles.length > 0
    
    if (isInternal) {
      // Internal drag - check if can drop
      if (!canDropOnFolder(folder, draggedFiles)) {
        e.dataTransfer.dropEffect = 'none'
        return
      }
      
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverFolder(folder.relativePath)
    } else {
      // External drag (from OS)
      if (!folder.isDirectory || folder.diffStatus === 'cloud' || folder.diffStatus === 'cloud_new') {
        e.dataTransfer.dropEffect = 'none'
        return
      }
      
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragOverFolder(folder.relativePath)
      setIsExternalDrag(true)
    }
  }, [draggedFiles, canDropOnFolder])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're actually leaving the folder element
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverFolder(null)
    }
  }, [])

  return {
    draggedFiles,
    setDraggedFiles,
    dragOverFolder,
    setDragOverFolder,
    isDraggingOver,
    setIsDraggingOver,
    isExternalDrag,
    setIsExternalDrag,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    canDropOnFolder
  }
}
