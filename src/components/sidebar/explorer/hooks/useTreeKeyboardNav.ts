import { useEffect, useCallback, RefObject } from 'react'
import { usePDMStore, LocalFile } from '../../../../stores/pdmStore'
import { executeCommand } from '../../../../lib/commands'
import type { TreeMap } from '../types'

interface UseTreeKeyboardNavOptions {
  containerRef: RefObject<HTMLDivElement>
  tree: TreeMap
  onRefresh?: (silent?: boolean) => void
}

/**
 * Hook for keyboard navigation in the explorer tree
 * Handles arrow keys for navigation, Enter for opening files, etc.
 */
export function useTreeKeyboardNav({ containerRef, tree, onRefresh }: UseTreeKeyboardNavOptions) {
  const {
    expandedFolders,
    toggleFolder,
    selectedFiles,
    setSelectedFiles
  } = usePDMStore()
  
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
  
  useEffect(() => {
    // Track last clicked index for range selection
    let lastClickedIndex: number | null = null
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when not typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      // Only handle if the explorer view contains the active element
      if (!containerRef.current?.contains(document.activeElement) && 
          !containerRef.current?.contains(e.target as Node)) {
        return
      }
      
      // Only handle arrow keys without modifiers (except shift for range selection)
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return
      
      const visibleFiles = getVisibleFiles()
      if (visibleFiles.length === 0) return
      
      // ArrowUp/ArrowDown - move selection up/down
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        
        const isUp = e.key === 'ArrowUp'
        const isShift = e.shiftKey
        
        const focusIndex = selectedFiles.length > 0 
          ? visibleFiles.findIndex(f => f.path === selectedFiles[selectedFiles.length - 1])
          : -1
        
        if (focusIndex === -1) {
          const newIndex = isUp ? visibleFiles.length - 1 : 0
          setSelectedFiles([visibleFiles[newIndex].path])
          lastClickedIndex = newIndex
          return
        }
        
        let newIndex: number
        if (isUp) {
          newIndex = Math.max(0, focusIndex - 1)
        } else {
          newIndex = Math.min(visibleFiles.length - 1, focusIndex + 1)
        }
        
        if (newIndex !== focusIndex) {
          if (isShift) {
            const anchorIndex = lastClickedIndex ?? focusIndex
            const start = Math.min(anchorIndex, newIndex)
            const end = Math.max(anchorIndex, newIndex)
            const rangePaths = visibleFiles.slice(start, end + 1).map(f => f.path)
            setSelectedFiles(rangePaths)
          } else {
            setSelectedFiles([visibleFiles[newIndex].path])
            lastClickedIndex = newIndex
          }
        }
        return
      }
      
      // ArrowRight - expand folder
      if (e.key === 'ArrowRight') {
        if (selectedFiles.length !== 1) return
        
        const selectedFile = visibleFiles.find(f => f.path === selectedFiles[0])
        if (!selectedFile?.isDirectory) return
        
        e.preventDefault()
        e.stopPropagation()
        
        if (!expandedFolders.has(selectedFile.relativePath)) {
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
          const parentFile = visibleFiles.find(f => f.relativePath === parentPath && f.isDirectory)
          if (parentFile) {
            const parentIndex = visibleFiles.indexOf(parentFile)
            setSelectedFiles([parentFile.path])
            lastClickedIndex = parentIndex
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
          toggleFolder(selectedFile.relativePath)
        } else if (selectedFile.diffStatus === 'cloud' || selectedFile.diffStatus === 'cloud_new') {
          // Cloud-only file: download first, then open
          executeCommand('download', { files: [selectedFile] }, { onRefresh, silent: true }).then(result => {
            if (result.success && window.electronAPI) {
              window.electronAPI.openFile(selectedFile.path)
            }
          })
        } else if (window.electronAPI) {
          window.electronAPI.openFile(selectedFile.path)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [getVisibleFiles, selectedFiles, setSelectedFiles, expandedFolders, toggleFolder, containerRef, onRefresh])
  
  return { getVisibleFiles }
}
