/**
 * LayoutService - reads and writes the parts of a workflow diagram that describe
 * how it looks rather than how it behaves: node size, transition anchors,
 * waypoints and label placement.
 *
 * Layout used to live only in React state and was lost on every refresh. It now
 * round-trips through real columns, so the maps the canvas renders from are
 * derived from the loaded rows and every gesture writes its result back.
 *
 * Writes are coalesced per field: a resize drag produces one UPDATE after the
 * pointer settles rather than one per animation frame.
 */
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import { DEFAULT_STATE_WIDTH, DEFAULT_STATE_HEIGHT } from '../constants'
import type { EdgePosition, EdgePositions, Point, StateDimensions } from '../types'

/** How long a layout field must go unchanged before it is written to the database. */
const LAYOUT_WRITE_DEBOUNCE_MS = 400

export interface CanvasLayout {
  stateDimensions: Record<string, StateDimensions>
  edgePositions: EdgePositions
  waypoints: Record<string, Point[]>
  labelOffsets: Record<string, Point>
  pinnedLabelPositions: Record<string, Point>
}

export const EMPTY_LAYOUT: CanvasLayout = {
  stateDimensions: {},
  edgePositions: {},
  waypoints: {},
  labelOffsets: {},
  pinnedLabelPositions: {},
}

// ============================================
// Parsing (JSONB -> canvas types)
// ============================================

function parsePoint(value: Json | null | undefined): Point | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { x, y } = value
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}

function parseWaypoints(value: Json | null | undefined): Point[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const point = parsePoint(entry)
    return point ? [point] : []
  })
}

function toJson(point: Point | null): Json {
  return point ? { x: point.x, y: point.y } : null
}

/** Build every canvas layout map from the rows that were just loaded. */
export function readLayout(
  states: WorkflowState[],
  transitions: WorkflowTransition[],
): CanvasLayout {
  const layout: CanvasLayout = {
    stateDimensions: {},
    edgePositions: {},
    waypoints: {},
    labelOffsets: {},
    pinnedLabelPositions: {},
  }

  for (const state of states) {
    layout.stateDimensions[state.id] = {
      width: state.width ?? DEFAULT_STATE_WIDTH,
      height: state.height ?? DEFAULT_STATE_HEIGHT,
    }
  }

  for (const transition of transitions) {
    if (transition.start_edge && transition.start_fraction !== null) {
      layout.edgePositions[`${transition.id}-start`] = {
        edge: transition.start_edge,
        fraction: transition.start_fraction,
      }
    }
    if (transition.end_edge && transition.end_fraction !== null) {
      layout.edgePositions[`${transition.id}-end`] = {
        edge: transition.end_edge,
        fraction: transition.end_fraction,
      }
    }

    const points = parseWaypoints(transition.waypoints)
    if (points.length > 0) layout.waypoints[transition.id] = points

    const offset = parsePoint(transition.label_offset)
    if (offset) layout.labelOffsets[transition.id] = offset

    const pinned = parsePoint(transition.label_pinned)
    if (pinned) layout.pinnedLabelPositions[transition.id] = pinned
  }

  return layout
}

/**
 * Reuse the previous object for every layout entry whose value is unchanged.
 *
 * The layout is re-derived from the rows on every state update, so without this
 * a single node drag would hand every memoized transition brand-new dimension,
 * anchor and label objects and force the whole diagram to re-render.
 */
export function stabiliseLayout(previous: CanvasLayout, next: CanvasLayout): CanvasLayout {
  return {
    stateDimensions: reuseEntries(
      previous.stateDimensions,
      next.stateDimensions,
      (a, b) => a.width === b.width && a.height === b.height,
    ),
    edgePositions: reuseEntries(
      previous.edgePositions,
      next.edgePositions,
      (a, b) => a.edge === b.edge && a.fraction === b.fraction,
    ),
    waypoints: reuseEntries(
      previous.waypoints,
      next.waypoints,
      (a, b) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y),
    ),
    labelOffsets: reuseEntries(previous.labelOffsets, next.labelOffsets, pointsEqual),
    pinnedLabelPositions: reuseEntries(
      previous.pinnedLabelPositions,
      next.pinnedLabelPositions,
      pointsEqual,
    ),
  }
}

function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

function reuseEntries<T>(
  previous: Record<string, T>,
  next: Record<string, T>,
  equal: (a: T, b: T) => boolean,
): Record<string, T> {
  const keys = Object.keys(next)
  let changed = keys.length !== Object.keys(previous).length

  const result: Record<string, T> = {}
  for (const key of keys) {
    const before = previous[key]
    if (before !== undefined && equal(before, next[key])) {
      result[key] = before
    } else {
      result[key] = next[key]
      changed = true
    }
  }

  return changed ? result : previous
}

// ============================================
// Serialising (canvas types -> row patches)
// ============================================

export function stateSizePatch(dims: StateDimensions): Pick<WorkflowState, 'width' | 'height'> {
  return { width: Math.round(dims.width), height: Math.round(dims.height) }
}

export function anchorPatch(endpoint: 'start' | 'end', position: EdgePosition | null) {
  if (endpoint === 'start') {
    return {
      start_edge: position?.edge ?? null,
      start_fraction: position ? roundFraction(position.fraction) : null,
    }
  }
  return {
    end_edge: position?.edge ?? null,
    end_fraction: position ? roundFraction(position.fraction) : null,
  }
}

/** start_fraction / end_fraction are DECIMAL(4,3), so keep three decimal places. */
function roundFraction(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 1000
}

export function waypointsPatch(points: Point[]) {
  const waypoints: Json = points.map((p) => ({ x: p.x, y: p.y }))
  return { waypoints }
}

export function labelOffsetPatch(offset: Point | null) {
  return { label_offset: toJson(offset) }
}

export function labelPinnedPatch(pinned: Point | null) {
  return { label_pinned: toJson(pinned) }
}

// ============================================
// Debounced writes
// ============================================

type PendingWrite = { timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> }

const pendingWrites = new Map<string, PendingWrite>()

function scheduleWrite(
  table: 'workflow_states' | 'workflow_transitions',
  id: string,
  patch: Record<string, unknown>,
  onError: (error: Error) => void,
) {
  const key = `${table}:${id}`
  const existing = pendingWrites.get(key)
  if (existing) clearTimeout(existing.timer)

  const merged = { ...existing?.patch, ...patch }
  const timer = setTimeout(() => {
    pendingWrites.delete(key)
    void supabase
      .from(table)
      .update(merged as never)
      .eq('id', id)
      .then(({ error }) => {
        if (error) onError(new Error(error.message))
      })
  }, LAYOUT_WRITE_DEBOUNCE_MS)

  pendingWrites.set(key, { timer, patch: merged })
}

export const layoutService = {
  saveStateLayout(
    stateId: string,
    patch: Partial<WorkflowState>,
    onError: (error: Error) => void,
  ) {
    scheduleWrite('workflow_states', stateId, patch, onError)
  },

  saveTransitionLayout(
    transitionId: string,
    patch: Record<string, unknown>,
    onError: (error: Error) => void,
  ) {
    scheduleWrite('workflow_transitions', transitionId, patch, onError)
  },

  /** Drop queued writes for rows that no longer exist, so a delete is not undone. */
  cancelPending(ids: string[]) {
    for (const id of ids) {
      for (const table of ['workflow_states', 'workflow_transitions'] as const) {
        const key = `${table}:${id}`
        const pending = pendingWrites.get(key)
        if (pending) {
          clearTimeout(pending.timer)
          pendingWrites.delete(key)
        }
      }
    }
  },
}
