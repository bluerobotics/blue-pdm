import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STATE_HEIGHT,
  DEFAULT_STATE_WIDTH,
  GATE_BELOW_PATH_OFFSET,
  LABEL_ABOVE_PATH_OFFSET,
  PARALLEL_EDGE_OFFSET,
} from '../constants'

import {
  computeParallelOffsets,
  computeTransitionGeometry,
  resolveDimensions,
  resolveEffectiveWaypoints,
  type TransitionGeometryInput,
} from './transitionGeometry'

const from = { id: 'a', position_x: 0, position_y: 0 }
const to = { id: 'b', position_x: 400, position_y: 0 }

function geometry(overrides: Partial<TransitionGeometryInput> = {}) {
  return computeTransitionGeometry({
    transitionId: 't1',
    fromState: from,
    toState: to,
    stateDimensions: {},
    pathType: 'straight',
    edgePositions: {},
    waypoints: [],
    ...overrides,
  })
}

describe('resolveDimensions', () => {
  it('falls back to the default node size', () => {
    expect(resolveDimensions('a', {})).toEqual({
      width: DEFAULT_STATE_WIDTH,
      height: DEFAULT_STATE_HEIGHT,
    })
  })

  it('uses the stored size when the node has been resized', () => {
    const dims = { width: 200, height: 90 }
    expect(resolveDimensions('a', { a: dims })).toEqual(dims)
  })
})

describe('computeTransitionGeometry anchors', () => {
  it('puts both endpoints on the border for default-sized nodes', () => {
    const { start, end } = geometry()

    expect(start).toMatchObject({ x: DEFAULT_STATE_WIDTH / 2, y: 0, edge: 'right' })
    expect(end).toMatchObject({ x: 400 - DEFAULT_STATE_WIDTH / 2, y: 0, edge: 'left' })
  })

  it('reports the outward surface direction each end leaves along', () => {
    const { start, end } = geometry()

    expect(start.normal?.x).toBeCloseTo(1)
    expect(end.normal?.x).toBeCloseTo(-1)
  })

  it('anchors a diamond on its slanted side rather than its bounding box', () => {
    const { start } = geometry({
      fromState: { ...from, shape: 'diamond' },
      toState: { id: 'b', position_x: 400, position_y: 400 },
    })

    // The bounding-box maths would have put this on the corner at (60, 30).
    expect(start.x).toBeLessThan(DEFAULT_STATE_WIDTH / 2)
    expect(start.y).toBeLessThan(DEFAULT_STATE_HEIGHT / 2)
    expect(start.normal?.x).toBeGreaterThan(0)
    expect(start.normal?.y).toBeGreaterThan(0)
  })

  it('respects a resized node rather than assuming the default size', () => {
    const { start, end } = geometry({
      stateDimensions: { a: { width: 300, height: 120 }, b: { width: 200, height: 80 } },
    })

    expect(start.x).toBe(150)
    expect(end.x).toBe(300)
  })

  it('honours a stored anchor over the centre-to-centre ray', () => {
    const { start } = geometry({
      edgePositions: { 't1-start': { edge: 'bottom', fraction: 0.25 } },
    })

    expect(start.edge).toBe('bottom')
    expect(start.y).toBe(DEFAULT_STATE_HEIGHT / 2)
    expect(start.x).toBe(-DEFAULT_STATE_WIDTH / 2 + 0.25 * DEFAULT_STATE_WIDTH)
  })

  it('shifts both ends perpendicular to the line by the parallel offset', () => {
    const { start, end } = geometry({ parallelOffset: PARALLEL_EDGE_OFFSET })

    expect(start.y).toBe(PARALLEL_EDGE_OFFSET)
    expect(end.y).toBe(PARALLEL_EDGE_OFFSET)
    expect(start.x).toBe(DEFAULT_STATE_WIDTH / 2)
  })

})

describe('computeTransitionGeometry label and gate placement', () => {
  it('defaults the label above the path midpoint and the gate below it', () => {
    const { labelPos, gatePos, curveMid } = geometry()

    expect(labelPos).toEqual({ x: curveMid.x, y: curveMid.y - LABEL_ABOVE_PATH_OFFSET })
    expect(gatePos).toEqual({ x: curveMid.x, y: curveMid.y + GATE_BELOW_PATH_OFFSET })
  })

  it('applies a stored label offset relative to the straight-line midpoint', () => {
    const { labelPos, lineMid } = geometry({ labelOffset: { x: 10, y: -30 } })

    expect(labelPos).toEqual({ x: lineMid.x + 10, y: lineMid.y - 30 })
  })

  it('prefers a pinned label position over an offset', () => {
    const { labelPos } = geometry({
      labelOffset: { x: 10, y: -30 },
      pinnedLabelPosition: { x: 111, y: 222 },
    })

    expect(labelPos).toEqual({ x: 111, y: 222 })
  })

  it('lets the in-flight drag position win over everything stored', () => {
    const { labelPos } = geometry({
      labelOffset: { x: 10, y: -30 },
      pinnedLabelPosition: { x: 111, y: 222 },
      tempLabelPos: { x: 5, y: 6 },
    })

    expect(labelPos).toEqual({ x: 5, y: 6 })
  })
})

describe('computeTransitionGeometry path midpoints', () => {
  it('produces a finite midpoint when both states sit on top of each other', () => {
    const { curveMid, labelPos } = computeTransitionGeometry({
      transitionId: 't1',
      fromState: { id: 'a', position_x: 100, position_y: 100 },
      toState: { id: 'b', position_x: 100, position_y: 100 },
      stateDimensions: {},
      pathType: 'spline',
      edgePositions: {},
      waypoints: [],
    })

    expect(Number.isFinite(curveMid.x)).toBe(true)
    expect(Number.isFinite(curveMid.y)).toBe(true)
    expect(Number.isFinite(labelPos.y)).toBe(true)
  })

  it('includes waypoints in the bounds used to place the floating toolbar', () => {
    const { bounds } = geometry({ waypoints: [{ x: 200, y: -150 }] })

    expect(bounds.minY).toBe(-150)
    expect(bounds.maxX).toBe(400 - DEFAULT_STATE_WIDTH / 2)
  })
})

describe('resolveEffectiveWaypoints', () => {
  it('returns the stored points when nothing is being dragged', () => {
    const stored = [{ x: 1, y: 2 }]
    expect(resolveEffectiveWaypoints(stored, null, null)).toBe(stored)
  })

  it('replaces the dragged point with its live position', () => {
    const stored = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]
    expect(resolveEffectiveWaypoints(stored, 1, { x: 9, y: 9 })).toEqual([
      { x: 1, y: 2 },
      { x: 9, y: 9 },
    ])
  })

  it('grows the list when a point past the end is being dragged', () => {
    expect(resolveEffectiveWaypoints([], 1, { x: 9, y: 9 })).toEqual([
      { x: 9, y: 9 },
      { x: 9, y: 9 },
    ])
  })
})

describe('computeParallelOffsets', () => {
  it('leaves a transition with no opposite twin unshifted', () => {
    const offsets = computeParallelOffsets([{ id: 't1', from_state_id: 'a', to_state_id: 'b' }])
    expect(offsets.t1).toBe(0)
  })

  it('shifts an A->B / B->A pair by equal and opposite amounts', () => {
    const offsets = computeParallelOffsets([
      { id: 't1', from_state_id: 'a', to_state_id: 'b' },
      { id: 't2', from_state_id: 'b', to_state_id: 'a' },
    ])

    expect(offsets.t1).toBe(PARALLEL_EDGE_OFFSET)
    expect(offsets.t2).toBe(-PARALLEL_EDGE_OFFSET)
  })
})
