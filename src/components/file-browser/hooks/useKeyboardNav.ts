import { useEffect, useCallback } from 'react'
import type { LocalFile } from '../../../stores/pdmStore'

export interface KeybindingConfig {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

export interface UseKeyboardNavOptions {
  files: LocalFile[]
  selectedFiles: string[]
  setSelectedFiles: (paths: string[]) => void
  lastClickedIndex: number | null
  setLastClickedIndex: (index: number | null) => void
  currentPath: string
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  matchesKeybinding: (e: KeyboardEvent, action: string) => boolean
  navigateToFolder: (path: string) => void
  navigateUp: () => void
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void
  handleUndo: () => void
  handleDelete: (file: LocalFile) => void
  handleOpen: (file: LocalFile) => void
  clearSelection: () => void
  toggleDetailsPanel: () => void
  onRefresh?: (silent?: boolean) => void
}

/**
 * Hook to manage keyboard navigation and shortcuts
 */
export function useKeyboardNav({
  files,
  selectedFiles,
  setSelectedFiles,
  lastClickedIndex,
  setLastClickedIndex,
  currentPath,
  clipboard,
  matchesKeybinding,
  navigateToFolder,
  navigateUp,
  handleCopy,
  handleCut,
  handlePaste,
  handleUndo,
  handleDelete,
  handleOpen,
  clearSelection,
  toggleDetailsPanel,
  onRefresh
}: UseKeyboardNavOptions): void {
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle shortcuts when typing in input fields
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }
    
    // Allow native copy/paste/cut/undo in the details panel or when text is selected
    const isInDetailsPanel = (e.target as HTMLElement)?.closest?.('.details-panel, .sw-datacard-panel, [data-allow-clipboard]')
    const hasTextSelection = window.getSelection()?.toString()
    
    if (isInDetailsPanel || hasTextSelection) {
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'z', 'a'].includes(e.key.toLowerCase())) {
        return // Let browser handle it
      }
    }

    // Ctrl+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      handleUndo()
      return
    }
    
    // Arrow key navigation
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      
      e.preventDefault()
      e.stopPropagation()
      if (files.length === 0) return
      
      const isUp = e.key === 'ArrowUp'
      const isShift = e.shiftKey
      
      // Find focus index
      const focusIndex = selectedFiles.length > 0 
        ? files.findIndex(f => f.path === selectedFiles[selectedFiles.length - 1])
        : -1
      
      if (focusIndex === -1) {
        const newIndex = isUp ? files.length - 1 : 0
        setSelectedFiles([files[newIndex].path])
        setLastClickedIndex(newIndex)
        return
      }
      
      let newIndex: number
      if (isUp) {
        newIndex = Math.max(0, focusIndex - 1)
      } else {
        newIndex = Math.min(files.length - 1, focusIndex + 1)
      }
      
      if (newIndex !== focusIndex) {
        if (isShift) {
          const anchorIndex = lastClickedIndex ?? focusIndex
          const start = Math.min(anchorIndex, newIndex)
          const end = Math.max(anchorIndex, newIndex)
          const rangePaths = files.slice(start, end + 1).map(f => f.path)
          setSelectedFiles(rangePaths)
        } else {
          setSelectedFiles([files[newIndex].path])
          setLastClickedIndex(newIndex)
        }
      }
      return
    }
    
    // ArrowRight - navigate into folder
    if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (selectedFiles.length !== 1) return
      
      const selectedFile = files.find(f => f.path === selectedFiles[0])
      if (!selectedFile?.isDirectory) return
      
      e.preventDefault()
      e.stopPropagation()
      navigateToFolder(selectedFile.relativePath)
      return
    }
    
    // ArrowLeft - navigate to parent
    if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!currentPath) return
      
      e.preventDefault()
      e.stopPropagation()
      navigateUp()
      return
    }
    
    // Open file (Enter)
    if (matchesKeybinding(e, 'openFile')) {
      e.preventDefault()
      e.stopPropagation()
      if (selectedFiles.length !== 1) return
      
      const selectedFile = files.find(f => f.path === selectedFiles[0])
      if (!selectedFile) return
      
      handleOpen(selectedFile)
      return
    }
    
    // Copy
    if (matchesKeybinding(e, 'copy')) {
      e.preventDefault()
      e.stopPropagation()
      handleCopy()
      return
    }
    
    // Cut
    if (matchesKeybinding(e, 'cut')) {
      e.preventDefault()
      e.stopPropagation()
      handleCut()
      return
    }
    
    // Paste
    if (matchesKeybinding(e, 'paste')) {
      e.preventDefault()
      e.stopPropagation()
      handlePaste()
      return
    }
    
    // Select All
    if (matchesKeybinding(e, 'selectAll')) {
      e.preventDefault()
      e.stopPropagation()
      setSelectedFiles(files.map(f => f.path))
      return
    }
    
    // Delete
    if (matchesKeybinding(e, 'delete') && selectedFiles.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      const selectedFile = files.find(f => f.path === selectedFiles[0])
      if (selectedFile) {
        handleDelete(selectedFile)
      }
      return
    }
    
    // Escape
    if (matchesKeybinding(e, 'escape')) {
      e.preventDefault()
      e.stopPropagation()
      clearSelection()
      return
    }
    
    // Toggle Details Panel
    if (matchesKeybinding(e, 'toggleDetailsPanel')) {
      e.preventDefault()
      e.stopPropagation()
      toggleDetailsPanel()
      return
    }
    
    // Refresh
    if (matchesKeybinding(e, 'refresh')) {
      e.preventDefault()
      e.stopPropagation()
      onRefresh?.()
      return
    }
  }, [
    files,
    selectedFiles,
    setSelectedFiles,
    lastClickedIndex,
    setLastClickedIndex,
    currentPath,
    clipboard,
    matchesKeybinding,
    navigateToFolder,
    navigateUp,
    handleCopy,
    handleCut,
    handlePaste,
    handleUndo,
    handleDelete,
    handleOpen,
    clearSelection,
    toggleDetailsPanel,
    onRefresh
  ])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
