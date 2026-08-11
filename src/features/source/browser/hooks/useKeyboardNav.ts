/**
 * useKeyboardNav - Keyboard navigation and shortcuts hook
 *
 * Attaches global keyboard event listeners to handle:
 * - Arrow key navigation (up/down to select files)
 * - Enter to open file/folder, Backspace to navigate up
 * - Ctrl+A to select all, Escape to clear selection
 * - Ctrl+C/X/V for copy/cut/paste operations
 * - Ctrl+Z for undo, Delete/Backspace to delete
 * - F2 to rename, F5 to refresh
 * - Custom keybindings from user settings
 *
 * All handlers respect context (e.g., disabled when input focused).
 *
 * @example
 * useKeyboardNav({
 *   selectableRows,
 *   topLevelFiles,
 *   selectedFiles,
 *   setSelectedFiles,
 *   matchesKeybinding,
 *   handleCopy,
 *   handlePaste,
 *   ...
 * })
 */
import { useEffect, useCallback } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import type { KeybindingAction } from '@/types/settings'
import { executeCommand } from '@/lib/commands'
import type { SelectableRow } from '../components/FileList/rowTypes'

export interface UseKeyboardNavOptions {
  files: LocalFile[]
  /** Every selectable row in visual order, including resolved configuration drawings */
  selectableRows: SelectableRow[]
  /** The sorted/filtered top-level files used by Select All */
  topLevelFiles: LocalFile[]
  selectedFiles: string[]
  setSelectedFiles: (paths: string[]) => void
  lastClickedIndex: number | null
  setLastClickedIndex: (index: number | null) => void
  currentPath: string
  vaultPath: string | null
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  setClipboard: (clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null) => void
  matchesKeybinding: (e: KeyboardEvent, action: KeybindingAction) => boolean
  navigateToFolder: (path: string) => void
  navigateUp: () => void
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void
  handleUndo: () => void
  clearSelection: () => void
  toggleDetailsPanel: () => void
  startRenaming?: (file: LocalFile) => void
  onRefresh?: (silent?: boolean) => void
}

/**
 * Hook to manage keyboard navigation and shortcuts
 */
export function useKeyboardNav({
  files,
  selectableRows,
  topLevelFiles,
  selectedFiles,
  setSelectedFiles,
  lastClickedIndex,
  setLastClickedIndex,
  currentPath,
  clipboard: _clipboard,
  setClipboard,
  matchesKeybinding,
  navigateToFolder,
  navigateUp,
  handleCopy,
  handleCut,
  handlePaste,
  handleUndo,
  clearSelection,
  toggleDetailsPanel,
  startRenaming,
  onRefresh,
}: UseKeyboardNavOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Allow native copy/paste/cut/undo in the details panel or when text is selected
      // This enables Ctrl+C/V/X/Z to work in the bottom pane
      const isInDetailsPanel = (e.target as HTMLElement)?.closest?.(
        '.details-panel, .sw-preview-panel, [data-allow-clipboard]',
      )
      const hasTextSelection = window.getSelection()?.toString()

      if (isInDetailsPanel || hasTextSelection) {
        // Let native clipboard operations work
        if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'z', 'a'].includes(e.key.toLowerCase())) {
          return // Don't prevent default - let browser handle it
        }
      }

      // Ctrl+Z for undo (not configurable) - only for file operations, not text editing
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
        return
      }

      // F2 - rename selected file
      if (e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.altKey && startRenaming) {
        if (selectedFiles.length !== 1) return

        const selectedFile = selectableRows.find((row) => row.path === selectedFiles[0])?.file
        if (!selectedFile) return

        e.preventDefault()
        e.stopPropagation()
        startRenaming(selectedFile)
        return
      }

      // Arrow key navigation - use direct key check for reliability
      // ArrowUp = move selection up (to lower index), ArrowDown = move selection down (to higher index)
      // Shift+Arrow = extend selection
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Only handle if Ctrl/Meta/Alt are not pressed (Shift is allowed for range selection)
        if (e.ctrlKey || e.metaKey || e.altKey) return

        e.preventDefault()
        e.stopPropagation()
        if (selectableRows.length === 0) return

        const isUp = e.key === 'ArrowUp'
        const isShift = e.shiftKey

        // Find the "focus" index - where the keyboard cursor currently is
        // This is the last item in the selection when extending, or the only selected item
        const focusIndex =
          selectedFiles.length > 0
            ? lastClickedIndex !== null &&
              selectableRows[lastClickedIndex]?.path === selectedFiles[selectedFiles.length - 1]
              ? lastClickedIndex
              : selectableRows.findIndex(
                  (row) => row.path === selectedFiles[selectedFiles.length - 1],
                )
            : -1

        // If current selection is not in view, select first or last based on direction
        if (focusIndex === -1) {
          const newIndex = isUp ? selectableRows.length - 1 : 0
          setSelectedFiles([selectableRows[newIndex].path])
          setLastClickedIndex(newIndex)
          return
        }

        // Calculate new index based on direction
        let newIndex: number
        if (isUp) {
          newIndex = Math.max(0, focusIndex - 1)
        } else {
          newIndex = Math.min(selectableRows.length - 1, focusIndex + 1)
        }

        // Only update if index actually changed
        if (newIndex !== focusIndex) {
          if (isShift) {
            // Shift held - extend selection from anchor (lastClickedIndex) to new position
            const anchorIndex = lastClickedIndex ?? focusIndex
            const start = Math.min(anchorIndex, newIndex)
            const end = Math.max(anchorIndex, newIndex)
            const rangePaths = [
              ...new Set(selectableRows.slice(start, end + 1).map((row) => row.path)),
            ]
            setSelectedFiles(rangePaths)
            // Don't update lastClickedIndex - it's the anchor
          } else {
            // No shift - single selection
            setSelectedFiles([selectableRows[newIndex].path])
            setLastClickedIndex(newIndex)
          }
        }
        return
      }

      // ArrowRight - navigate into selected folder
      if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selectedFiles.length !== 1) return

        const selectedFile = selectableRows.find((row) => row.path === selectedFiles[0])?.file
        if (!selectedFile?.isDirectory) return

        e.preventDefault()
        e.stopPropagation()
        // Navigate into the folder
        navigateToFolder(selectedFile.relativePath)
        return
      }

      // ArrowLeft - navigate to parent folder
      if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!currentPath) return

        e.preventDefault()
        e.stopPropagation()
        navigateUp()
        return
      }

      // Open File (Enter) - open selected file or navigate into folder
      if (matchesKeybinding(e, 'openFile')) {
        e.preventDefault()
        e.stopPropagation()
        if (selectedFiles.length !== 1) return

        const selectedFile = selectableRows.find((row) => row.path === selectedFiles[0])?.file
        if (!selectedFile) return

        if (selectedFile.isDirectory) {
          navigateToFolder(selectedFile.relativePath)
        } else if (selectedFile.diffStatus === 'cloud') {
          // Cloud-only file: download first, then open
          executeCommand('download', { files: [selectedFile] }, { onRefresh, silent: true }).then(
            (result) => {
              if (result.success && window.electronAPI) {
                window.electronAPI.openFile(selectedFile.path)
              }
            },
          )
        } else if (window.electronAPI) {
          window.electronAPI.openFile(selectedFile.path)
        }
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
        setSelectedFiles(topLevelFiles.map((file) => file.path))
        return
      }

      // Delete key - for folders, delete directly (no dialog). For files, show dialog.
      if (matchesKeybinding(e, 'delete') && selectedFiles.length > 0) {
        e.preventDefault()
        e.stopPropagation()

        const selectedItems = files.filter((file) => selectedFiles.includes(file.path))

        // Delete files/folders using the command system
        // The delete-local command handles confirmation internally if needed
        executeCommand('delete-local', { files: selectedItems }, { onRefresh })
        return
      }

      // Escape to clear selection
      if (matchesKeybinding(e, 'escape')) {
        e.preventDefault()
        e.stopPropagation()
        clearSelection()
        setClipboard(null)
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
    },
    [
      files,
      selectableRows,
      topLevelFiles,
      selectedFiles,
      setSelectedFiles,
      lastClickedIndex,
      setLastClickedIndex,
      currentPath,
      setClipboard,
      matchesKeybinding,
      navigateToFolder,
      navigateUp,
      handleCopy,
      handleCut,
      handlePaste,
      handleUndo,
      clearSelection,
      toggleDetailsPanel,
      startRenaming,
      onRefresh,
    ],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
