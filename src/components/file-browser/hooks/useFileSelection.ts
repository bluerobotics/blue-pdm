import { useState, useCallback } from 'react'
import type { LocalFile } from '../../../stores/pdmStore'

export interface UseFileSelectionOptions {
  files: LocalFile[]
  selectedFiles: string[]
  setSelectedFiles: (paths: string[]) => void
  toggleFileSelection: (path: string, addToSelection?: boolean) => void
  clearSelection: () => void
}

export interface UseFileSelectionReturn {
  lastClickedIndex: number | null
  setLastClickedIndex: (index: number | null) => void
  handleRowClick: (e: React.MouseEvent, file: LocalFile, index: number) => void
  selectAll: () => void
  selectRange: (startIndex: number, endIndex: number, addToExisting?: boolean) => void
}

/**
 * Hook to manage file selection state and handlers
 */
export function useFileSelection({
  files,
  selectedFiles,
  setSelectedFiles,
  toggleFileSelection,
  clearSelection: _clearSelection
}: UseFileSelectionOptions): UseFileSelectionReturn {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)

  const handleRowClick = useCallback((e: React.MouseEvent, file: LocalFile, index: number) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangePaths = files.slice(start, end + 1).map(f => f.path)
      
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
  }, [files, selectedFiles, setSelectedFiles, toggleFileSelection, lastClickedIndex])

  const selectAll = useCallback(() => {
    setSelectedFiles(files.map(f => f.path))
  }, [files, setSelectedFiles])

  const selectRange = useCallback((startIndex: number, endIndex: number, addToExisting = false) => {
    const start = Math.min(startIndex, endIndex)
    const end = Math.max(startIndex, endIndex)
    const rangePaths = files.slice(start, end + 1).map(f => f.path)
    
    if (addToExisting) {
      const newSelection = [...new Set([...selectedFiles, ...rangePaths])]
      setSelectedFiles(newSelection)
    } else {
      setSelectedFiles(rangePaths)
    }
  }, [files, selectedFiles, setSelectedFiles])

  return {
    lastClickedIndex,
    setLastClickedIndex,
    handleRowClick,
    selectAll,
    selectRange
  }
}
