/**
 * useSelectionBox - Reusable hook for marquee/drag-box selection
 *
 * Provides selection box functionality for multi-selecting items by
 * clicking and dragging to draw a selection rectangle.
 *
 * Used by:
 * - FilePane (file browser list view)
 * - FileTree (explorer tree view)
 *
 * @example
 * const { selectionBox, selectionHandlers } = useSelectionBox({
 *   containerRef: tableRef,
 *   getVisibleItems: () => sortedFiles,
 *   rowSelector: 'tbody tr',
 *   setSelectedFiles,
 *   clearSelection
 * })
 *
 * return (
 *   <div ref={containerRef} {...selectionHandlers}>
 *     {selectionBox && <SelectionBoxOverlay box={selectionBox} />}
 *     ...
 *   </div>
 * )
 */
import { useState, useCallback, useRef, RefObject } from 'react'

export interface SelectionBox {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export interface UseSelectionBoxOptions {
  /** Reference to the scrollable container element */
  containerRef: RefObject<HTMLElement | null>
  /** Function that returns the currently visible/selectable items with their paths */
  getVisibleItems: () => { path: string }[]
  /** CSS selector to find row elements within the container */
  rowSelector: string
  /** Function to set the selected file paths */
  setSelectedFiles: (paths: string[]) => void
  /** Function to clear all selections */
  clearSelection: () => void
  /** Optional: Elements that should NOT trigger selection box (default: none) */
  excludeSelector?: string
  /**
   * Which axes must overlap for an item to be selected.
   *
   * 'vertical' suits full-width rows, where a horizontal test would only ever
   * reject edge cases. Grids lay items out in both directions and need 'both'.
   * Default: 'vertical'.
   */
  axis?: 'vertical' | 'both'
}

export interface UseSelectionBoxReturn {
  /** Current selection box state, or null if not dragging */
  selectionBox: SelectionBox | null
  /** Set selection box state directly (for external control) */
  setSelectionBox: React.Dispatch<React.SetStateAction<SelectionBox | null>>
  /** Event handlers to spread onto the container element */
  selectionHandlers: {
    onMouseDown: (e: React.MouseEvent) => void
    onMouseMove: (e: React.MouseEvent) => void
    onMouseUp: (e: React.MouseEvent) => void
    onMouseLeave: (e: React.MouseEvent) => void
    onDragStart: (e: React.DragEvent) => void
  }
}

/**
 * Hook for marquee/drag-box selection functionality
 */
export function useSelectionBox(options: UseSelectionBoxOptions): UseSelectionBoxReturn {
  const {
    containerRef,
    // getVisibleItems is kept in the interface for backwards compatibility but no longer used
    // Selection detection now uses data-path attributes directly from DOM elements
    getVisibleItems: _getVisibleItems,
    rowSelector,
    setSelectedFiles,
    clearSelection,
    excludeSelector,
    axis = 'vertical',
  } = options

  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)

  // Ref to track selection intent immediately on mousedown (before state updates)
  // This prevents race condition where dragstart fires before selectionBox state updates
  const isSelectingRef = useRef(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start selection box on left click
      if (e.button !== 0) return

      const target = e.target as HTMLElement

      // Don't start selection if clicking on an actual row/item
      if (target.closest(rowSelector)) return

      // Don't start selection if clicking on excluded elements
      if (excludeSelector && target.closest(excludeSelector)) return

      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const startX = e.clientX - rect.left + container.scrollLeft
      const startY = e.clientY - rect.top + container.scrollTop

      // Mark selection intent immediately (synchronous, before state update)
      isSelectingRef.current = true

      setSelectionBox({ startX, startY, currentX: startX, currentY: startY })

      // Clear selection unless modifier keys are held
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        clearSelection()
      }
    },
    [containerRef, rowSelector, excludeSelector, clearSelection],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!selectionBox) return

      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const currentX = e.clientX - rect.left + container.scrollLeft
      const currentY = e.clientY - rect.top + container.scrollTop

      setSelectionBox((prev) => (prev ? { ...prev, currentX, currentY } : null))

      // Calculate selection box bounds
      const top = Math.min(selectionBox.startY, currentY)
      const bottom = Math.max(selectionBox.startY, currentY)
      const left = Math.min(selectionBox.startX, currentX)
      const right = Math.max(selectionBox.startX, currentX)

      // Find rows that intersect with selection box
      // Use data-path attributes to identify files instead of array indexing
      // This handles virtualization spacer rows, config rows, and other non-file rows correctly
      // Note: only rendered items can match, so in a virtualized view the marquee
      // covers what is on screen rather than the full underlying list.
      const rows = container.querySelectorAll(rowSelector)
      const containerRect = container.getBoundingClientRect()
      const selectedPaths: string[] = []

      rows.forEach((row) => {
        const rowRect = row.getBoundingClientRect()

        const rowTop = rowRect.top - containerRect.top + container.scrollTop
        const rowBottom = rowTop + rowRect.height

        if (rowBottom <= top || rowTop >= bottom) return

        if (axis === 'both') {
          const rowLeft = rowRect.left - containerRect.left + container.scrollLeft
          const rowRight = rowLeft + rowRect.width
          if (rowRight <= left || rowLeft >= right) return
        }

        // Get file path from data attribute (rows without data-path are ignored)
        const path = row.getAttribute('data-path')
        if (path) {
          selectedPaths.push(path)
        }
      })

      setSelectedFiles(selectedPaths)
    },
    [selectionBox, containerRef, rowSelector, setSelectedFiles, axis],
  )

  const handleMouseUp = useCallback(() => {
    isSelectingRef.current = false
    setSelectionBox(null)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (selectionBox) {
      isSelectingRef.current = false
      setSelectionBox(null)
    }
  }, [selectionBox])

  // Prevent native drag from interfering with selection box
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // If we're in selection mode (mousedown occurred on empty space),
      // prevent native drag from taking over
      if (isSelectingRef.current || selectionBox) {
        e.preventDefault()
      }
    },
    [selectionBox],
  )

  return {
    selectionBox,
    setSelectionBox,
    selectionHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
      onDragStart: handleDragStart,
    },
  }
}
