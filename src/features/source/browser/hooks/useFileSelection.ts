/**
 * useFileSelection - File selection state and handlers hook
 *
 * Manages row selection in the file browser with support for:
 * - Single click selection (replaces selection)
 * - Ctrl/Cmd+click (toggle individual file)
 * - Shift+click (range selection from last clicked)
 * - Shift+Ctrl/Cmd+click (add range to existing selection)
 * - Select all operation
 *
 * Key exports:
 * - lastClickedIndex - Anchor point for shift-click range selection
 * - handleRowClick - Click handler with modifier key support
 * - selectAll, selectRange - Programmatic selection helpers
 *
 * @example
 * const { handleRowClick, lastClickedIndex } = useFileSelection({
 *   selectableRows,
 *   topLevelFiles,
 *   selectedFiles,
 *   setSelectedFiles,
 *   toggleFileSelection
 * })
 */
import { useState, useCallback, useMemo } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { SelectableRow } from '../components/FileList/rowTypes'

export interface UseFileSelectionOptions {
  /** Every selectable row in visual order, including resolved configuration drawings */
  selectableRows?: SelectableRow[]
  /** The sorted/filtered top-level files used by Select All */
  topLevelFiles?: LocalFile[]
  /** @deprecated Use selectableRows and topLevelFiles */
  sortedFiles?: LocalFile[]
  selectedFiles: string[]
  setSelectedFiles: (paths: string[]) => void
  toggleFileSelection: (path: string, addToSelection?: boolean) => void
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
  selectableRows: providedSelectableRows,
  topLevelFiles: providedTopLevelFiles,
  sortedFiles,
  selectedFiles,
  setSelectedFiles,
  toggleFileSelection,
}: UseFileSelectionOptions): UseFileSelectionReturn {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const selectableRows = useMemo(
    () =>
      providedSelectableRows ??
      (sortedFiles ?? []).map((file) => ({ path: file.path, file })),
    [providedSelectableRows, sortedFiles],
  )
  const topLevelFiles = useMemo(
    () => providedTopLevelFiles ?? sortedFiles ?? [],
    [providedTopLevelFiles, sortedFiles],
  )

  // Get config selection clearer from store
  const setSelectedConfigs = usePDMStore((s) => s.setSelectedConfigs)

  const handleRowClick = useCallback(
    (e: React.MouseEvent, file: LocalFile, index: number) => {
      // Clear config selection when selecting files (only one level should be highlighted)
      setSelectedConfigs(new Set())

      if (e.shiftKey && lastClickedIndex !== null) {
        // Shift+click: select range
        const start = Math.min(lastClickedIndex, index)
        const end = Math.max(lastClickedIndex, index)
        const rangePaths = [
          ...new Set(selectableRows.slice(start, end + 1).map((row) => row.path)),
        ]

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
    },
    [
      selectableRows,
      selectedFiles,
      setSelectedFiles,
      toggleFileSelection,
      lastClickedIndex,
      setSelectedConfigs,
    ],
  )

  const selectAll = useCallback(() => {
    setSelectedFiles(topLevelFiles.map((file) => file.path))
  }, [topLevelFiles, setSelectedFiles])

  const selectRange = useCallback(
    (startIndex: number, endIndex: number, addToExisting = false) => {
      const start = Math.min(startIndex, endIndex)
      const end = Math.max(startIndex, endIndex)
      const rangePaths = [
        ...new Set(selectableRows.slice(start, end + 1).map((row) => row.path)),
      ]

      if (addToExisting) {
        const newSelection = [...new Set([...selectedFiles, ...rangePaths])]
        setSelectedFiles(newSelection)
      } else {
        setSelectedFiles(rangePaths)
      }
    },
    [selectableRows, selectedFiles, setSelectedFiles],
  )

  return {
    lastClickedIndex,
    setLastClickedIndex,
    handleRowClick,
    selectAll,
    selectRange,
  }
}
