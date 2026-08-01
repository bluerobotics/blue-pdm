/**
 * The real silhouette of a state node, as a closed polygon.
 *
 * Anchors used to be computed against the bounding box, which is only correct
 * for a sharp rectangle: a diamond's anchor floated in the empty space beside
 * its corner and an ellipse's sat inside the fill. Everything that needs to know
 * where a node's border actually is - snapping, hit-testing, drop highlighting,
 * the rendered shape itself - now goes through the outline built here, so the
 * maths and the pixels cannot disagree.
 *
 * Outlines are wound clockwise in screen coordinates (y grows downwards), which
 * makes the outward normal of an edge `(dy, -dx)`.
 */
import type { StateShape } from '@/types/workflow'

import {
  DEFAULT_CORNER_RADIUS,
  DEFAULT_STATE_HEIGHT,
  DEFAULT_STATE_WIDTH,
  ELLIPSE_OUTLINE_SEGMENTS,
  ROUNDED_CORNER_SEGMENTS,
} from '../constants'
import type { EdgePosition, Point, PointWithEdge, StateDimensions } from '../types'

/** Distances below this are treated as coincident. */
const EPSILON = 1e-9

/** The minimum a state needs to expose for its outline to be resolvable. */
export interface OutlineState {
  id: string
  position_x: number
  position_y: number
  shape?: StateShape | null
  corner_radius?: number | null
}

export interface Outline {
  /** Closed polygon in world coordinates, wound clockwise. Last point != first. */
  points: Point[]
  center: Point
  width: number
  height: number
  /** Arc length from `points[0]` to each vertex; the final entry is the perimeter. */
  cumulativeLengths: number[]
  perimeter: number
}

export interface OutlineHit {
  point: Point
  /** Unit vector pointing out of the shape at `point`. */
  normal: Point
  /** Unsigned distance from the queried point to the outline. */
  distance: number
  /** Distance travelled along the outline to reach `point`. */
  arcLength: number
}

// ============================================
// Building
// ============================================

function ellipsePoints(hw: number, hh: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i < ELLIPSE_OUTLINE_SEGMENTS; i++) {
    const angle = (i / ELLIPSE_OUTLINE_SEGMENTS) * Math.PI * 2
    points.push({ x: hw * Math.cos(angle), y: hh * Math.sin(angle) })
  }
  return points
}

/**
 * Sample a quarter-circle corner. Angles are measured in screen space, so the
 * sweep runs clockwise from `startAngle` through 90 degrees.
 */
function cornerArc(cx: number, cy: number, radius: number, startAngle: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= ROUNDED_CORNER_SEGMENTS; i++) {
    const angle = startAngle + (i / ROUNDED_CORNER_SEGMENTS) * (Math.PI / 2)
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  }
  return points
}

function rectanglePoints(hw: number, hh: number, cornerRadius: number): Point[] {
  const radius = Math.max(0, Math.min(cornerRadius, hw, hh))
  if (radius < EPSILON) {
    return [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ]
  }

  // Clockwise from the top-left corner arc: top edge, right edge, bottom, left.
  return [
    ...cornerArc(-hw + radius, -hh + radius, radius, Math.PI),
    ...cornerArc(hw - radius, -hh + radius, radius, -Math.PI / 2),
    ...cornerArc(hw - radius, hh - radius, radius, 0),
    ...cornerArc(-hw + radius, hh - radius, radius, Math.PI / 2),
  ]
}

/** Local-space vertices, matching what `StateNodeShape` renders for each shape. */
function localPoints(shape: StateShape, hw: number, hh: number, cornerRadius: number): Point[] {
  switch (shape) {
    case 'diamond':
      return [
        { x: 0, y: -hh },
        { x: hw, y: 0 },
        { x: 0, y: hh },
        { x: -hw, y: 0 },
      ]
    case 'hexagon':
      return [
        { x: -hw * 0.5, y: -hh },
        { x: hw * 0.5, y: -hh },
        { x: hw, y: 0 },
        { x: hw * 0.5, y: hh },
        { x: -hw * 0.5, y: hh },
        { x: -hw, y: 0 },
      ]
    case 'ellipse':
      return ellipsePoints(hw, hh)
    case 'rectangle':
    default:
      return rectanglePoints(hw, hh, cornerRadius)
  }
}

function measure(points: Point[]): { cumulativeLengths: number[]; perimeter: number } {
  const cumulativeLengths: number[] = [0]
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
    cumulativeLengths.push(total)
  }
  return { cumulativeLengths, perimeter: total }
}

/**
 * Deduplicate consecutive vertices. Degenerate sizes (a zero-width node, a
 * corner radius equal to half the height) can otherwise produce zero-length
 * segments, which have no direction and therefore no normal.
 */
function dropDuplicates(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result[result.length - 1]
    if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) {
      continue
    }
    result.push(point)
  }
  const first = result[0]
  const last = result[result.length - 1]
  if (
    result.length > 1 &&
    Math.abs(first.x - last.x) < EPSILON &&
    Math.abs(first.y - last.y) < EPSILON
  ) {
    result.pop()
  }
  return result
}

function createOutline(
  center: Point,
  width: number,
  height: number,
  local: Point[],
): Outline {
  const points = dropDuplicates(local).map((p) => ({ x: center.x + p.x, y: center.y + p.y }))
  const { cumulativeLengths, perimeter } = measure(points)
  return { points, center, width, height, cumulativeLengths, perimeter }
}

interface CachedOutline {
  dimensions: StateDimensions
  x: number
  y: number
  shape: StateShape
  cornerRadius: number
  outline: Outline
}

/**
 * Rebuilding a 64-gon for every ellipse on every pointer move is wasteful, and
 * a drag only ever changes one node. Keying the cache on the state object keeps
 * it self-cleaning: rows dropped from the diagram drop out of the map with them.
 */
const outlineCache = new WeakMap<OutlineState, CachedOutline>()

export function buildOutline(state: OutlineState, dimensions: StateDimensions): Outline {
  const shape = state.shape || 'rectangle'
  const cornerRadius = state.corner_radius ?? DEFAULT_CORNER_RADIUS

  const cached = outlineCache.get(state)
  if (
    cached &&
    cached.dimensions === dimensions &&
    cached.x === state.position_x &&
    cached.y === state.position_y &&
    cached.shape === shape &&
    cached.cornerRadius === cornerRadius
  ) {
    return cached.outline
  }

  const outline = createOutline(
    { x: state.position_x, y: state.position_y },
    dimensions.width,
    dimensions.height,
    localPoints(shape, dimensions.width / 2, dimensions.height / 2, cornerRadius),
  )

  outlineCache.set(state, {
    dimensions,
    x: state.position_x,
    y: state.position_y,
    shape,
    cornerRadius,
    outline,
  })
  return outline
}

export function resolveOutlineDimensions(
  stateId: string,
  stateDimensions: Record<string, StateDimensions>,
): StateDimensions {
  return stateDimensions[stateId] ?? { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
}

// ============================================
// Rendering
// ============================================

/** An SVG `d` string for the outline, so what is drawn is what is hit-tested. */
export function outlineToPath(outline: Outline): string {
  if (outline.points.length === 0) return ''
  const [first, ...rest] = outline.points
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z`
}

/** The point that sits `arcLength` along the border from `points[0]`. */
export function pointAtArcLength(outline: Outline, arcLength: number): Point {
  const { points, perimeter, cumulativeLengths } = outline
  if (points.length === 0) return outline.center
  if (perimeter < EPSILON) return points[0]

  const target = ((arcLength % perimeter) + perimeter) % perimeter
  const index = segmentIndexAt(outline, target)
  const from = points[index]
  const to = points[(index + 1) % points.length]
  const segmentLength = cumulativeLengths[index + 1] - cumulativeLengths[index]
  const t = segmentLength < EPSILON ? 0 : (target - cumulativeLengths[index]) / segmentLength

  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

function segmentIndexAt(outline: Outline, arcLength: number): number {
  const { cumulativeLengths } = outline
  for (let i = 0; i < cumulativeLengths.length - 1; i++) {
    if (arcLength <= cumulativeLengths[i + 1]) return i
  }
  return Math.max(0, outline.points.length - 1)
}

/**
 * An open path tracing the stretch of border `halfLength` either side of
 * `centerArcLength`, used to light up the run of edge a connection will land on.
 */
export function outlineRunPath(
  outline: Outline,
  centerArcLength: number,
  halfLength: number,
): string {
  const { points, perimeter } = outline
  if (points.length === 0 || perimeter < EPSILON) return ''
  if (halfLength * 2 >= perimeter) return outlineToPath(outline)

  const start = centerArcLength - halfLength
  const run: Point[] = [pointAtArcLength(outline, start)]

  // Walk the vertices the run passes through, then close on the exact end point.
  const startIndex = segmentIndexAt(outline, wrap(start, perimeter))
  const steps = points.length
  let travelled = 0
  let index = startIndex

  for (let i = 0; i < steps; i++) {
    index = (index + 1) % points.length
    const vertexArcLength = outline.cumulativeLengths[index]
    travelled = wrap(vertexArcLength - start, perimeter)
    if (travelled >= halfLength * 2) break
    run.push(points[index])
  }

  run.push(pointAtArcLength(outline, centerArcLength + halfLength))

  const [first, ...rest] = run
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')}`
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period
}

/** An SVG `d` string for the outline expressed relative to the node's centre. */
export function outlineToLocalPath(outline: Outline): string {
  if (outline.points.length === 0) return ''
  const local = outline.points.map((p) => ({
    x: p.x - outline.center.x,
    y: p.y - outline.center.y,
  }))
  const [first, ...rest] = local
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z`
}

/**
 * Push every edge `amount` outwards. Vertices move along the miter direction so
 * the offset shape stays parallel to the original rather than being a scaled
 * copy of it, which matters for a diamond where radial scaling would fatten the
 * corners far more than the edges.
 */
export function inflateOutline(outline: Outline, amount: number): Outline {
  if (amount === 0 || outline.points.length < 3) return outline

  const count = outline.points.length
  const normals = outline.points.map((point, index) => {
    const next = outline.points[(index + 1) % count]
    return edgeNormal(point, next)
  })

  const local = outline.points.map((point, index) => {
    const incoming = normals[(index - 1 + count) % count]
    const outgoing = normals[index]

    let dirX = incoming.x + outgoing.x
    let dirY = incoming.y + outgoing.y
    const length = Math.hypot(dirX, dirY)
    if (length < EPSILON) {
      dirX = outgoing.x
      dirY = outgoing.y
    } else {
      dirX /= length
      dirY /= length
    }

    // Extend along the miter so both adjacent edges end up exactly `amount`
    // away, capped so a near-spike vertex cannot shoot off to infinity.
    const cosHalfAngle = dirX * outgoing.x + dirY * outgoing.y
    const scale = cosHalfAngle > 0.1 ? amount / cosHalfAngle : amount * 10

    return {
      x: point.x - outline.center.x + dirX * scale,
      y: point.y - outline.center.y + dirY * scale,
    }
  })

  return createOutline(outline.center, outline.width + amount * 2, outline.height + amount * 2, local)
}

// ============================================
// Queries
// ============================================

function edgeNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < EPSILON) return { x: 0, y: 0 }
  return { x: dy / length, y: -dx / length }
}

/** Even-odd ray cast. Points sitting exactly on the border may land either way. */
export function containsPoint(outline: Outline, point: Point): boolean {
  const { points } = outline
  let inside = false

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    const straddles = a.y > point.y !== b.y > point.y
    if (!straddles) continue

    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < crossingX) inside = !inside
  }

  return inside
}

/**
 * Closest point on the border, with the outward normal there. At a vertex the
 * two adjacent edge normals are averaged so the direction changes smoothly as
 * the cursor sweeps past a corner.
 */
export function nearestPointOnOutline(outline: Outline, point: Point): OutlineHit {
  const { points } = outline
  const count = points.length

  let bestDistance = Infinity
  let bestIndex = 0
  let bestT = 0
  let bestPoint: Point = points[0] ?? outline.center

  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % count]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy

    let t = 0
    if (lengthSquared > EPSILON) {
      t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
      t = Math.max(0, Math.min(1, t))
    }

    const candidate = { x: a.x + t * dx, y: a.y + t * dy }
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
      bestT = t
      bestPoint = candidate
    }
  }

  const segmentLength =
    outline.cumulativeLengths[bestIndex + 1] - outline.cumulativeLengths[bestIndex]

  return {
    point: bestPoint,
    normal: normalAt(outline, bestIndex, bestT),
    distance: bestDistance,
    arcLength: outline.cumulativeLengths[bestIndex] + bestT * segmentLength,
  }
}

function normalAt(outline: Outline, segmentIndex: number, t: number): Point {
  const { points } = outline
  const count = points.length
  const current = edgeNormal(points[segmentIndex], points[(segmentIndex + 1) % count])

  let neighbour: Point | null = null
  if (t < EPSILON) {
    neighbour = edgeNormal(points[(segmentIndex - 1 + count) % count], points[segmentIndex])
  } else if (t > 1 - EPSILON) {
    neighbour = edgeNormal(
      points[(segmentIndex + 1) % count],
      points[(segmentIndex + 2) % count],
    )
  }

  if (!neighbour) return current

  const x = current.x + neighbour.x
  const y = current.y + neighbour.y
  const length = Math.hypot(x, y)
  return length < EPSILON ? current : { x: x / length, y: y / length }
}

/**
 * Where the ray from the node's centre towards `target` leaves the shape. Used
 * for the default anchor of an unpinned transition, which always points at the
 * other end of the line.
 */
export function intersectRayFromCenter(outline: Outline, target: Point): OutlineHit {
  const { center, points } = outline
  const dirX = target.x - center.x
  const dirY = target.y - center.y

  if (Math.abs(dirX) < EPSILON && Math.abs(dirY) < EPSILON) {
    return nearestPointOnOutline(outline, { x: center.x + outline.width, y: center.y })
  }

  const count = points.length
  let bestT = Infinity
  let bestIndex = -1
  let bestU = 0

  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % count]
    const edgeX = b.x - a.x
    const edgeY = b.y - a.y

    const denominator = dirX * edgeY - dirY * edgeX
    if (Math.abs(denominator) < EPSILON) continue

    const originX = a.x - center.x
    const originY = a.y - center.y
    const t = (originX * edgeY - originY * edgeX) / denominator
    const u = (originX * dirY - originY * dirX) / denominator

    if (t >= 0 && u >= -EPSILON && u <= 1 + EPSILON && t < bestT) {
      bestT = t
      bestIndex = i
      bestU = Math.max(0, Math.min(1, u))
    }
  }

  if (bestIndex === -1) {
    return nearestPointOnOutline(outline, target)
  }

  const segmentLength = outline.cumulativeLengths[bestIndex + 1] - outline.cumulativeLengths[bestIndex]
  const point = { x: center.x + dirX * bestT, y: center.y + dirY * bestT }

  return {
    point,
    normal: normalAt(outline, bestIndex, bestU),
    distance: Math.hypot(point.x - target.x, point.y - target.y),
    arcLength: outline.cumulativeLengths[bestIndex] + bestU * segmentLength,
  }
}

// ============================================
// Anchor encoding
//
// A pinned anchor is stored as a bounding-box side plus a fraction along it
// (`start_edge` / `start_fraction`). That encoding predates non-rectangular
// nodes, so rather than migrate it we treat it as a direction: the stored point
// names a spot on the bounding box, and the anchor is where the ray from the
// centre through that spot crosses the real outline. For a sharp rectangle the
// two coincide, so anchors saved before this change render exactly where they
// always did.
// ============================================

/** The point on the bounding box that a stored anchor names. */
export function boundingBoxPointFromAnchor(outline: Outline, anchor: EdgePosition): Point {
  const hw = outline.width / 2
  const hh = outline.height / 2
  const left = outline.center.x - hw
  const right = outline.center.x + hw
  const top = outline.center.y - hh
  const bottom = outline.center.y + hh

  switch (anchor.edge) {
    case 'right':
      return { x: right, y: top + anchor.fraction * outline.height }
    case 'left':
      return { x: left, y: top + anchor.fraction * outline.height }
    case 'bottom':
      return { x: left + anchor.fraction * outline.width, y: bottom }
    case 'top':
      return { x: left + anchor.fraction * outline.width, y: top }
  }
}

/** Encode a point on the border as the bounding-box side and fraction to store. */
export function anchorFromOutlinePoint(outline: Outline, point: Point): EdgePosition {
  const hw = outline.width / 2
  const hh = outline.height / 2
  const dx = point.x - outline.center.x
  const dy = point.y - outline.center.y

  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    return { edge: 'right', fraction: 0.5 }
  }

  const scaleX = Math.abs(dx) > EPSILON ? hw / Math.abs(dx) : Infinity
  const scaleY = Math.abs(dy) > EPSILON ? hh / Math.abs(dy) : Infinity

  if (scaleX <= scaleY) {
    const y = outline.center.y + dy * scaleX
    return {
      edge: dx > 0 ? 'right' : 'left',
      fraction: clamp01(outline.height > 0 ? (y - (outline.center.y - hh)) / outline.height : 0.5),
    }
  }

  const x = outline.center.x + dx * scaleY
  return {
    edge: dy > 0 ? 'bottom' : 'top',
    fraction: clamp01(outline.width > 0 ? (x - (outline.center.x - hw)) / outline.width : 0.5),
  }
}

/** Decode a stored anchor back onto the border, with the normal to leave along. */
export function outlinePointFromAnchor(outline: Outline, anchor: EdgePosition): PointWithEdge {
  const boxPoint = boundingBoxPointFromAnchor(outline, anchor)

  // A sharp rectangle's bounding box *is* its outline, so return the stored
  // point untouched rather than letting the ray solve reintroduce float drift.
  const nearest = nearestPointOnOutline(outline, boxPoint)
  if (nearest.distance < EPSILON) {
    return { x: boxPoint.x, y: boxPoint.y, edge: anchor.edge, normal: nearest.normal }
  }

  const hit = intersectRayFromCenter(outline, boxPoint)
  return { x: hit.point.x, y: hit.point.y, edge: anchor.edge, normal: hit.normal }
}

/**
 * Where a line aimed at `target` leaves the node: the default anchor for a
 * transition whose endpoint the user has not pinned.
 */
export function outlinePointToward(outline: Outline, target: Point): PointWithEdge {
  const hit = intersectRayFromCenter(outline, target)
  return {
    x: hit.point.x,
    y: hit.point.y,
    edge: anchorFromOutlinePoint(outline, hit.point).edge,
    normal: hit.normal,
  }
}

/** The four canonical ports, one at the middle of each bounding-box side. */
export function outlinePorts(outline: Outline): PointWithEdge[] {
  return (['right', 'bottom', 'left', 'top'] as const).map((edge) =>
    outlinePointFromAnchor(outline, { edge, fraction: 0.5 }),
  )
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
