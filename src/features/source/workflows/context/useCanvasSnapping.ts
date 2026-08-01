/**
 * Snap-to-grid and snap-to-alignment for dragged state nodes, plus the guides
 * drawn while a node is snapped to a neighbour.
 */
import { useCallback, useState } from 'react'

import type { WorkflowState } from '@/types/workflow'

import { DEFAULT_SNAP_SETTINGS } from '../constants'
import type { AlignmentGuides, SnapSettings, SnappingResult } from '../types'

const NO_GUIDES: AlignmentGuides = { vertical: null, horizontal: null }

export function useCanvasSnapping() {
  const [snapSettings, setSnapSettings] = useState<SnapSettings>(DEFAULT_SNAP_SETTINGS)
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>(NO_GUIDES)

  const clearAlignmentGuides = useCallback(() => {
    setAlignmentGuides(NO_GUIDES)
  }, [])

  const applySnapping = useCallback(
    (
      currentStateId: string,
      rawX: number,
      rawY: number,
      states: WorkflowState[],
    ): SnappingResult => {
      let x = rawX
      let y = rawY
      let verticalGuide: number | null = null
      let horizontalGuide: number | null = null

      if (snapSettings.snapToGrid) {
        const gridSize = snapSettings.gridSize
        x = Math.round(x / gridSize) * gridSize
        y = Math.round(y / gridSize) * gridSize
      }

      if (snapSettings.snapToAlignment) {
        const threshold = snapSettings.alignmentThreshold

        for (const state of states) {
          if (state.id === currentStateId) continue

          if (Math.abs(state.position_x - x) <= threshold) {
            x = state.position_x
            verticalGuide = state.position_x
          }

          if (Math.abs(state.position_y - y) <= threshold) {
            y = state.position_y
            horizontalGuide = state.position_y
          }
        }
      }

      return { x, y, verticalGuide, horizontalGuide }
    },
    [snapSettings],
  )

  return {
    snapSettings,
    alignmentGuides,
    setSnapSettings,
    setAlignmentGuides,
    clearAlignmentGuides,
    applySnapping,
  }
}
