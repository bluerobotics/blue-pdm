/**
 * Where a connection being dragged wants to land.
 *
 * One resolver drives the rubber band, the drop highlight and the commit that
 * happens on pointer up, so the line always ends up exactly where the preview
 * promised. Creating a transition and re-anchoring an existing one both go
 * through here; they used to disagree, one relying on DOM hover and the other
 * on a bounding-box test.
 *
 * Radii are declared in screen pixels and divided by the zoom before use, so
 * the magnets feel the same whether the diagram is at 25% or 200%.
 */
import type { WorkflowState } from '@/types/workflow'

import {
  PERIMETER_SNAP_BAND_PX,
  PORT_SNAP_RADIUS_PX,
  TARGET_ATTRACT_RADIUS_PX,
} from '../constants'
import type { EdgePosition, Point, StateDimensions } from '../types'

import {
  anchorFromOutlinePoint,
  buildOutline,
  containsPoint,
  intersectRayFromCenter,
  nearestPointOnOutline,
  outlinePorts,
  resolveOutlineDimensions,
  type Outline,
} from './shapeOutline'

/**
 * - `port`: pinned to one of the four connection dots.
 * - `perimeter`: pinned to an exact spot on the border.
 * - `body`: attached to the node as a whole, free to re-route when it moves.
 */
export type SnapKind = 'port' | 'perimeter' | 'body'

export interface SnapCandidate {
  stateId: string
  outline: Outline
}

export interface ConnectionSnap {
  stateId: string
  kind: SnapKind
  /** Where the endpoint renders right now. */
  point: Point
  /** Outward direction at `point`, for the perpendicular stub the path leaves along. */
  normal: Point
  /** What to persist. `null` means a dynamic attachment that re-routes on its own. */
  anchor: EdgePosition | null
  outline: Outline
  /** Distance along the border to `point`, used to highlight the run around it. */
  arcLength: number
}

export interface ConnectionSnapParams {
  /** Pointer position in canvas coordinates. */
  cursor: Point
  candidates: SnapCandidate[]
  zoom: number
  /** Set while the freeform modifier is held: pin exactly, ignore the magnets. */
  freeform: boolean
  /**
   * The other end of the connection. A body attachment previews the anchor the
   * finished line will actually use, which points back at this.
   */
  origin?: Point | null
}

/** Build the snap candidates for a drag, skipping the node the drag came from. */
export function buildSnapCandidates(
  states: WorkflowState[],
  stateDimensions: Record<string, StateDimensions>,
  excludeStateId?: string | null,
): SnapCandidate[] {
  const candidates: SnapCandidate[] = []
  for (const state of states) {
    if (state.id === excludeStateId) continue
    candidates.push({
      stateId: state.id,
      outline: buildOutline(state, resolveOutlineDimensions(state.id, stateDimensions)),
    })
  }
  return candidates
}

interface RankedCandidate extends SnapCandidate {
  inside: boolean
  distance: number
}

/**
 * The node the cursor is aiming at. Anything the cursor is inside of beats
 * anything it is merely near, and among equals the one drawn last wins, since
 * that is the one painted on top.
 */
function pickCandidate(
  candidates: SnapCandidate[],
  cursor: Point,
  attractRadius: number,
): RankedCandidate | null {
  let best: RankedCandidate | null = null
  let bestScore = Infinity

  for (const candidate of candidates) {
    const distance = nearestPointOnOutline(candidate.outline, cursor).distance
    const inside = containsPoint(candidate.outline, cursor)
    if (!inside && distance > attractRadius) continue

    const score = inside ? 0 : distance
    if (score <= bestScore) {
      bestScore = score
      best = { ...candidate, inside, distance }
    }
  }

  return best
}

export function resolveConnectionSnap({
  cursor,
  candidates,
  zoom,
  freeform,
  origin,
}: ConnectionSnapParams): ConnectionSnap | null {
  const scale = zoom > 0 ? zoom : 1
  const portRadius = PORT_SNAP_RADIUS_PX / scale
  const perimeterBand = PERIMETER_SNAP_BAND_PX / scale
  const attractRadius = TARGET_ATTRACT_RADIUS_PX / scale

  const target = pickCandidate(candidates, cursor, attractRadius)
  if (!target) return null

  const { outline, stateId } = target

  if (!freeform) {
    const port = nearestPort(outline, cursor, portRadius)
    if (port) return { stateId, ...port }
  }

  // Freeform pins wherever the cursor projects; otherwise the border only grabs
  // the endpoint once the cursor is close enough to it to have meant it.
  if (freeform || target.distance <= perimeterBand) {
    const hit = nearestPointOnOutline(outline, cursor)
    return {
      stateId,
      kind: 'perimeter',
      point: hit.point,
      normal: hit.normal,
      anchor: anchorFromOutlinePoint(outline, hit.point),
      outline,
      arcLength: hit.arcLength,
    }
  }

  // Attached to the node itself: preview the anchor the finished line will pick,
  // which is where the ray back towards the other end crosses the border.
  const hit = origin
    ? intersectRayFromCenter(outline, origin)
    : nearestPointOnOutline(outline, cursor)

  return {
    stateId,
    kind: 'body',
    point: hit.point,
    normal: hit.normal,
    anchor: null,
    outline,
    arcLength: hit.arcLength,
  }
}

function nearestPort(
  outline: Outline,
  cursor: Point,
  radius: number,
): Omit<ConnectionSnap, 'stateId'> | null {
  let best: ReturnType<typeof outlinePorts>[number] | null = null
  let bestDistance = radius

  for (const port of outlinePorts(outline)) {
    const distance = Math.hypot(port.x - cursor.x, port.y - cursor.y)
    if (distance <= bestDistance) {
      bestDistance = distance
      best = port
    }
  }

  if (!best) return null

  const point = { x: best.x, y: best.y }
  const hit = nearestPointOnOutline(outline, point)

  return {
    kind: 'port',
    point,
    normal: best.normal ?? hit.normal,
    anchor: { edge: best.edge, fraction: 0.5 },
    outline,
    arcLength: hit.arcLength,
  }
}
