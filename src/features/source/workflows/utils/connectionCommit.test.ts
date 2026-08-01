/**
 * The promise the drag makes: wherever the preview showed the endpoint when you
 * released, that is where the committed line draws it. The preview resolves its
 * point through resolveConnectionSnap and the finished line resolves it through
 * computeTransitionGeometry, so these two have to agree for every shape, every
 * snap tier and every zoom level.
 */
import { describe, expect, it } from 'vitest'

import type { StateShape } from '@/types/workflow'

import {
  DEFAULT_STATE_HEIGHT,
  DEFAULT_STATE_WIDTH,
  PERIMETER_SNAP_BAND_PX,
} from '../constants'
import type { EdgePosition, EdgePositions, Point } from '../types'

import { resolveConnectionSnap } from './connectionSnap'
import { buildOutline, intersectRayFromCenter } from './shapeOutline'
import { computeTransitionGeometry } from './transitionGeometry'

const SHAPES: StateShape[] = ['rectangle', 'diamond', 'hexagon', 'ellipse']
const HALF_WIDTH = DEFAULT_STATE_WIDTH / 2

const START_ANCHOR: EdgePosition = { edge: 'right', fraction: 0.5 }

/** The node the drag starts from, kept off to the left and slightly above. */
const source = { id: 'source', position_x: 0, position_y: -40, shape: 'rectangle' as const }

function target(shape: StateShape) {
  return { id: 'target', position_x: 400, position_y: 0, shape }
}

function outlineOf(shape: StateShape) {
  return buildOutline(target(shape), { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT })
}

/**
 * A cursor `offset` away from the border of `shape`, up towards its top-right so
 * the spot is clear of all four ports whatever the silhouette. Negative offsets
 * sit inside the shape.
 */
function nearBorder(shape: StateShape, offset: number): Point {
  const outline = outlineOf(shape)
  const hit = intersectRayFromCenter(outline, { x: 400 + 100, y: -100 })

  return { x: hit.point.x + hit.normal.x * offset, y: hit.point.y + hit.normal.y * offset }
}

/**
 * Play a whole gesture: resolve the drop the way the pointer-up path does, then
 * lay out the transition the way the canvas does once the anchor is persisted.
 */
function dropAt(cursor: Point, shape: StateShape, { zoom = 1, freeform = false } = {}) {
  const toState = target(shape)
  const outline = outlineOf(shape)

  const snap = resolveConnectionSnap({
    cursor,
    candidates: [{ stateId: toState.id, outline }],
    zoom,
    freeform,
    // Dynamic attachments aim at the centre of the node at the other end.
    origin: { x: source.position_x, y: source.position_y },
  })

  if (!snap) return { snap: null, committed: null }

  const edgePositions: EdgePositions = { 't1-start': START_ANCHOR }
  if (snap.anchor) edgePositions['t1-end'] = snap.anchor

  const { end } = computeTransitionGeometry({
    transitionId: 't1',
    fromState: source,
    toState,
    stateDimensions: {},
    pathType: 'spline',
    edgePositions,
    waypoints: [],
  })

  return { snap, committed: end }
}

function expectCommitMatchesPreview(cursor: Point, shape: StateShape, options = {}) {
  const { snap, committed } = dropAt(cursor, shape, options)

  expect(snap).not.toBeNull()
  expect(committed!.x).toBeCloseTo(snap!.point.x, 6)
  expect(committed!.y).toBeCloseTo(snap!.point.y, 6)

  return snap!
}

describe('the line does not move on release', () => {
  it.each(SHAPES)('honours a port drop on a %s', (shape) => {
    // Just outside the left-hand port of the target.
    const snap = expectCommitMatchesPreview({ x: 400 - HALF_WIDTH - 6, y: 3 }, shape)

    expect(snap.kind).toBe('port')
    expect(snap.anchor).toEqual({ edge: 'left', fraction: 0.5 })
  })

  it.each(SHAPES)('honours a border drop on a %s', (shape) => {
    const snap = expectCommitMatchesPreview(nearBorder(shape, 3), shape)

    expect(snap.kind).toBe('perimeter')
    expect(snap.anchor).not.toBeNull()
  })

  it.each(SHAPES)('honours a body drop on a %s', (shape) => {
    const snap = expectCommitMatchesPreview({ x: 400, y: 0 }, shape)

    expect(snap.kind).toBe('body')
    expect(snap.anchor).toBeNull()
  })

  it.each(SHAPES)('honours a freeform drop on a %s', (shape) => {
    const snap = expectCommitMatchesPreview({ x: 400 - HALF_WIDTH - 4, y: 1 }, shape, {
      freeform: true,
    })

    expect(snap.kind).toBe('perimeter')
  })

  it.each([0.25, 0.5, 1, 2])('holds at %sx zoom', (zoom) => {
    for (const shape of SHAPES) {
      expectCommitMatchesPreview(nearBorder(shape, 2), shape, { zoom })
      expectCommitMatchesPreview(nearBorder(shape, -2), shape, { zoom })
    }
  })
})

describe('what each drop attaches to', () => {
  it('re-routes a body attachment after the target moves', () => {
    const { snap } = dropAt({ x: 400, y: 0 }, 'rectangle')
    expect(snap?.anchor).toBeNull()

    const moved = { ...target('rectangle'), position_y: 400 }
    const { end } = computeTransitionGeometry({
      transitionId: 't1',
      fromState: source,
      toState: moved,
      stateDimensions: {},
      pathType: 'spline',
      edgePositions: { 't1-start': START_ANCHOR },
      waypoints: [],
    })

    // The node is now below the source, so the line arrives at its top.
    expect(end.edge).toBe('top')
  })

  it('keeps a pinned attachment on the same spot after the target moves', () => {
    const { snap } = dropAt({ x: 400 - HALF_WIDTH - 2, y: 20 }, 'rectangle')
    expect(snap?.anchor?.edge).toBe('left')

    const moved = { ...target('rectangle'), position_y: 400 }
    const { end } = computeTransitionGeometry({
      transitionId: 't1',
      fromState: source,
      toState: moved,
      stateDimensions: {},
      pathType: 'spline',
      edgePositions: { 't1-start': START_ANCHOR, 't1-end': snap!.anchor! },
      waypoints: [],
    })

    expect(end.edge).toBe('left')
    expect(end.x).toBeCloseTo(400 - HALF_WIDTH)
    expect(end.y - 400).toBeCloseTo(snap!.point.y)
  })

  it('reaches a node the cursor never touched', () => {
    const { snap } = dropAt({ x: 400 - HALF_WIDTH - PERIMETER_SNAP_BAND_PX - 8, y: 24 }, 'rectangle')

    expect(snap?.stateId).toBe('target')
  })
})
