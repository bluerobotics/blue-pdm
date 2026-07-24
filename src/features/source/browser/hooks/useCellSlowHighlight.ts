/**
 * useCellSlowHighlight - slow double-click detection for a single table cell.
 *
 * Mirrors the Name column's slow double-click (see useSlowDoubleClick.ts): a fast
 * double-click stays reserved for opening the file, while a slow "click, pause,
 * click" opens the cell's read-only copy-highlight box.
 *
 * Fed from the cell's onClick. On the triggering (second) click it stops
 * propagation so the row-level handler doesn't also highlight the file name.
 */
import { useCallback, useRef } from 'react'

import { SLOW_DOUBLE_CLICK_MIN_MS, SLOW_DOUBLE_CLICK_MAX_MS } from '@/hooks/useSlowDoubleClick'

export function useCellSlowHighlight(onSlowDoubleClick: () => void) {
  const lastClickTimeRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useCallback(
    (e: React.MouseEvent) => {
      // Let modified clicks (range/multi-select) bubble untouched
      if (e.shiftKey || e.ctrlKey || e.metaKey) return

      const now = Date.now()
      const timeDiff = now - lastClickTimeRef.current

      if (timeDiff >= SLOW_DOUBLE_CLICK_MIN_MS && timeDiff <= SLOW_DOUBLE_CLICK_MAX_MS) {
        // Slow double-click detected -> highlight this cell for copying.
        // Stop propagation so the row doesn't also highlight the file name.
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        lastClickTimeRef.current = 0
        e.stopPropagation()
        onSlowDoubleClick()
      } else {
        // First click (or timing out of window) - record and let it bubble
        // so normal row selection still happens.
        lastClickTimeRef.current = now
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
          lastClickTimeRef.current = 0
          timeoutRef.current = null
        }, SLOW_DOUBLE_CLICK_MAX_MS + 100)
      }
    },
    [onSlowDoubleClick],
  )
}
