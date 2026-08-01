/**
 * Single source of truth for where a transition attaches to its two state boxes
 * and where its path, label and gate badge are drawn.
 *
 * Every renderer that draws or hit-tests a transition (the line itself, the
 * endpoint/label drag handles, the rubber band shown while connecting) must go
 * through this module. Previously each one re-derived the geometry with its own
 * copy of the maths and its own idea of the default node size, so handles drifted
 * away from the line they were supposed to be attached to.
 */
import type { TransitionPathType } from '@/types/workflow'

import {
  DEFAULT_STATE_WIDTH,
  DEFAULT_STATE_HEIGHT,
  ELBOW_TURN_OFFSET,
  LABEL_ABOVE_PATH_OFFSET,
  GATE_BELOW_PATH_OFFSET,
  PARALLEL_EDGE_OFFSET,
} from '../constants'
import type { Point, PointWithEdge, EdgePositions, StateDimensions } from '../types'

import { generateSplinePath, getPointOnSpline, generateElbowPath } from './pathGeneration'
import {
  buildOutline,
  outlinePointFromAnchor,
  outlinePointToward,
  type OutlineState,
} from './shapeOutline'

/**
 * The minimum a state needs to expose for its geometry to be resolvable. The
 * shape fields are optional so callers holding a bare position can still ask
 * for geometry; they default to a rectangle.
 */
export type GeometryState = OutlineState

export interface TransitionGeometryInput {
  transitionId: string
  fromState: GeometryState
  toState: GeometryState
  /** Custom sizes keyed by state id; states absent from the map use the defaults. */
  stateDimensions: Record<string, StateDimensions>
  pathType: TransitionPathType
  /** Stored anchor overrides, keyed `${transitionId}-start` / `${transitionId}-end`. */
  edgePositions: EdgePositions
  /** Waypoints with any in-flight drag already applied (see resolveEffectiveWaypoints). */
  waypoints: Point[]
  /** Perpendicular shift applied so A->B and B->A do not overlap. */
  parallelOffset?: number
  labelOffset?: Point | null
  pinnedLabelPosition?: Point | null
  /** Live label drag position, which wins over every stored label position. */
  tempLabelPos?: Point | null
}

export interface TransitionGeometry {
  start: PointWithEdge
  end: PointWithEdge
  pathD: string
  /** Midpoint measured along the rendered path. */
  curveMid: Point
  /** Midpoint of the straight line between the two anchors. */
  lineMid: Point
  labelPos: Point
  gatePos: Point
  /** Bounding box of the anchors plus waypoints, used to place the floating toolbar. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/**
 * Merge the stored waypoints with the one currently being dragged, so the line and
 * its handles agree on where the control points are mid-gesture.
 */
export function resolveEffectiveWaypoints(
  stored: Point[],
  draggingIndex: number | null,
  tempPos: Point | null,
): Point[] {
  if (draggingIndex === null || !tempPos) return stored

  const next = [...stored]
  while (next.length <= draggingIndex) {
    next.push({ x: tempPos.x, y: tempPos.y })
  }
  next[draggingIndex] = { x: tempPos.x, y: tempPos.y }
  return next
}

export function resolveDimensions(
  stateId: string,
  stateDimensions: Record<string, StateDimensions>,
): StateDimensions {
  return stateDimensions[stateId] ?? { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
}

/**
 * When A->B and B->A both exist they would render on top of each other, so each is
 * shifted perpendicular to its direction by an equal and opposite amount. Comparing
 * the two state ids gives a stable sign without depending on transition order.
 */
export function computeParallelOffsets(
  transitions: Array<{ id: string; from_state_id: string; to_state_id: string }>,
): Record<string, number> {
  const pairs = new Set(transitions.map((t) => `${t.from_state_id}->${t.to_state_id}`))

  const offsets: Record<string, number> = {}
  for (const transition of transitions) {
    const hasReverse = pairs.has(`${transition.to_state_id}->${transition.from_state_id}`)
    offsets[transition.id] = hasReverse
      ? (transition.from_state_id < transition.to_state_id ? 1 : -1) * PARALLEL_EDGE_OFFSET
      : 0
  }
  return offsets
}

/**
 * Resolve one end of a transition: a stored anchor if the user has pinned it to
 * a specific spot on the border, otherwise the point where the ray towards the
 * other node crosses it. Both are resolved against the node's real silhouette,
 * so a diamond's endpoint sits on its slanted side rather than out in the empty
 * corner of its bounding box.
 */
function resolveAnchor(
  state: GeometryState,
  other: GeometryState,
  dims: StateDimensions,
  stored: EdgePositions[string] | undefined,
): PointWithEdge {
  const outline = buildOutline(state, dims)

  if (stored) {
    return outlinePointFromAnchor(outline, stored)
  }

  return outlinePointToward(outline, { x: other.position_x, y: other.position_y })
}

export function computeTransitionGeometry(input: TransitionGeometryInput): TransitionGeometry {
  const {
    transitionId,
    fromState,
    toState,
    stateDimensions,
    edgePositions,
    waypoints,
    parallelOffset = 0,
    labelOffset,
    pinnedLabelPosition,
    tempLabelPos,
    pathType,
  } = input

  const fromDims = resolveDimensions(fromState.id, stateDimensions)
  const toDims = resolveDimensions(toState.id, stateDimensions)

  let start = resolveAnchor(fromState, toState, fromDims, edgePositions[`${transitionId}-start`])
  let end = resolveAnchor(toState, fromState, toDims, edgePositions[`${transitionId}-end`])

  // Shift the whole line perpendicular to its direction so an opposite-direction
  // transition between the same pair of states renders as a separate line.
  if (parallelOffset !== 0) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length > 0) {
      const perpX = (-dy / length) * parallelOffset
      const perpY = (dx / length) * parallelOffset
      start = { ...start, x: start.x + perpX, y: start.y + perpY }
      end = { ...end, x: end.x + perpX, y: end.y + perpY }
    }
  }

  const lineMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }

  let pathD: string
  let curveMid: Point

  if (pathType === 'straight') {
    pathD = `M ${start.x} ${start.y} L ${end.x} ${end.y}`
    curveMid = lineMid
  } else if (pathType === 'elbow') {
    const elbow = generateElbowPath(start, waypoints, end, ELBOW_TURN_OFFSET)
    pathD = elbow.path
    const midIndex = Math.floor(elbow.segments.length / 2)
    const before = elbow.segments[Math.max(0, midIndex - 1)]
    const after = elbow.segments[midIndex] ?? before
    curveMid = { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 }
  } else {
    pathD = generateSplinePath(start, waypoints, end)
    curveMid = getPointOnSpline(start, waypoints, end, 0.5)
  }

  let labelPos: Point
  if (tempLabelPos) {
    labelPos = tempLabelPos
  } else if (pinnedLabelPosition) {
    labelPos = pinnedLabelPosition
  } else if (labelOffset) {
    labelPos = { x: lineMid.x + labelOffset.x, y: lineMid.y + labelOffset.y }
  } else {
    labelPos = { x: curveMid.x, y: curveMid.y - LABEL_ABOVE_PATH_OFFSET }
  }

  const allPoints = [start, end, ...waypoints]
  const bounds = {
    minX: Math.min(...allPoints.map((p) => p.x)),
    maxX: Math.max(...allPoints.map((p) => p.x)),
    minY: Math.min(...allPoints.map((p) => p.y)),
    maxY: Math.max(...allPoints.map((p) => p.y)),
  }

  return {
    start,
    end,
    pathD,
    curveMid,
    lineMid,
    labelPos,
    gatePos: { x: curveMid.x, y: curveMid.y + GATE_BELOW_PATH_OFFSET },
    bounds,
  }
}
