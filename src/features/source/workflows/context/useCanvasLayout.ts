/**
 * Diagram layout - node size, transition anchors, waypoints and label placement.
 *
 * Layout is *derived* from the loaded rows rather than held in its own state, so
 * the canvas and the database cannot disagree. Every setter patches the row in
 * place and queues the matching write, which is what makes a resize or a
 * waypoint drag survive a reload.
 */
import { useCallback, useMemo, useRef } from 'react'

import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import { DEFAULT_STATE_WIDTH, DEFAULT_STATE_HEIGHT } from '../constants'
import {
  layoutService,
  readLayout,
  stabiliseLayout,
  stateSizePatch,
  anchorPatch,
  waypointsPatch,
  labelOffsetPatch,
  labelPinnedPatch,
  EMPTY_LAYOUT,
  type CanvasLayout,
} from '../services/layoutService'
import type { EdgePosition, EdgePositions, Point, StateDimensions } from '../types'

// Stable default dimensions object so memoized nodes that have no custom size
// receive a referentially-stable `dimensions` prop across renders.
const DEFAULT_DIMENSIONS: StateDimensions = {
  width: DEFAULT_STATE_WIDTH,
  height: DEFAULT_STATE_HEIGHT,
}

/** Apply a SetStateAction against a known current value. */
function resolveAction<T>(action: React.SetStateAction<T>, current: T): T {
  return typeof action === 'function' ? (action as (prev: T) => T)(current) : action
}

function samePoint(a: Point | undefined, b: Point | undefined): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y
}

interface UseCanvasLayoutParams {
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  onLayoutError: (message: string) => void
}

export function useCanvasLayout({
  states,
  transitions,
  setStates,
  setTransitions,
  onLayoutError,
}: UseCanvasLayoutParams) {
  const stableLayoutRef = useRef<CanvasLayout>(EMPTY_LAYOUT)
  const layout = useMemo(() => {
    const next = stabiliseLayout(stableLayoutRef.current, readLayout(states, transitions))
    stableLayoutRef.current = next
    return next
  }, [states, transitions])

  const { stateDimensions, edgePositions, waypoints, labelOffsets, pinnedLabelPositions } = layout

  // Keep the latest layout reachable from setters without making them change
  // identity on every row update, which would bust child memoization.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const reportLayoutError = useCallback(
    (error: Error) => {
      onLayoutError(error.message)
    },
    [onLayoutError],
  )

  /** Patch one transition row locally and queue the matching database write. */
  const patchTransition = useCallback(
    (transitionId: string, patch: Partial<WorkflowTransition>) => {
      setTransitions((prev) => prev.map((t) => (t.id === transitionId ? { ...t, ...patch } : t)))
      layoutService.saveTransitionLayout(transitionId, patch, reportLayoutError)
    },
    [setTransitions, reportLayoutError],
  )

  const getDimensions = useCallback(
    (stateId: string): StateDimensions => stateDimensions[stateId] || DEFAULT_DIMENSIONS,
    [stateDimensions],
  )

  const updateDimensions = useCallback(
    (stateId: string, dims: StateDimensions) => {
      const patch = stateSizePatch(dims)
      setStates((prev) => prev.map((s) => (s.id === stateId ? { ...s, ...patch } : s)))
      layoutService.saveStateLayout(stateId, patch, reportLayoutError)
    },
    [setStates, reportLayoutError],
  )

  const setWaypoints: React.Dispatch<React.SetStateAction<Record<string, Point[]>>> = useCallback(
    (action) => {
      const current = layoutRef.current.waypoints
      const next = resolveAction(action, current)

      for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
        const before = current[id] ?? []
        const after = next[id] ?? []
        const unchanged =
          before.length === after.length && before.every((p, i) => samePoint(p, after[i]))
        if (!unchanged) patchTransition(id, waypointsPatch(after))
      }
    },
    [patchTransition],
  )

  const addWaypoint = useCallback(
    (transitionId: string, point: Point, insertIndex?: number) => {
      const current = [...(layoutRef.current.waypoints[transitionId] ?? [])]
      current.splice(insertIndex ?? current.length, 0, point)
      patchTransition(transitionId, waypointsPatch(current))
    },
    [patchTransition],
  )

  const setLabelOffsets: React.Dispatch<React.SetStateAction<Record<string, Point>>> = useCallback(
    (action) => {
      const current = layoutRef.current.labelOffsets
      const next = resolveAction(action, current)
      for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (!samePoint(current[id], next[id])) {
          patchTransition(id, labelOffsetPatch(next[id] ?? null))
        }
      }
    },
    [patchTransition],
  )

  const setPinnedLabelPositions: React.Dispatch<React.SetStateAction<Record<string, Point>>> =
    useCallback(
      (action) => {
        const current = layoutRef.current.pinnedLabelPositions
        const next = resolveAction(action, current)
        for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
          if (!samePoint(current[id], next[id])) {
            patchTransition(id, labelPinnedPatch(next[id] ?? null))
          }
        }
      },
      [patchTransition],
    )

  const updateEdgePosition = useCallback(
    (transitionId: string, endpoint: 'start' | 'end', position: EdgePosition | null) => {
      patchTransition(transitionId, anchorPatch(endpoint, position))
    },
    [patchTransition],
  )

  const setEdgePositions: React.Dispatch<React.SetStateAction<EdgePositions>> = useCallback(
    (action) => {
      const current = layoutRef.current.edgePositions
      const next = resolveAction(action, current)

      for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
        const before = current[key]
        const after = next[key]
        if (before?.edge === after?.edge && before?.fraction === after?.fraction) continue

        const separator = key.lastIndexOf('-')
        const transitionId = key.slice(0, separator)
        const endpoint = key.slice(separator + 1) as 'start' | 'end'
        patchTransition(transitionId, anchorPatch(endpoint, after ?? null))
      }
    },
    [patchTransition],
  )

  return {
    stateDimensions,
    edgePositions,
    waypoints,
    labelOffsets,
    pinnedLabelPositions,
    getDimensions,
    updateDimensions,
    setWaypoints,
    addWaypoint,
    setLabelOffsets,
    setPinnedLabelPositions,
    setEdgePositions,
    updateEdgePosition,
  }
}
