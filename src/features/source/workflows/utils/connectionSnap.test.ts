import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STATE_HEIGHT,
  DEFAULT_STATE_WIDTH,
  PERIMETER_SNAP_BAND_PX,
  PORT_SNAP_RADIUS_PX,
  TARGET_ATTRACT_RADIUS_PX,
} from '../constants'
import type { Point } from '../types'

import { resolveConnectionSnap } from './connectionSnap'
import { buildOutline, nearestPointOnOutline } from './shapeOutline'

const DIMENSIONS = { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
const HALF_WIDTH = DEFAULT_STATE_WIDTH / 2
const HALF_HEIGHT = DEFAULT_STATE_HEIGHT / 2

function candidate(id: string, x = 0, y = 0, shape: 'rectangle' | 'diamond' = 'rectangle') {
  return {
    stateId: id,
    outline: buildOutline(
      { id, position_x: x, position_y: y, shape, corner_radius: 0 },
      DIMENSIONS,
    ),
  }
}

function snap(cursor: Point, overrides: Partial<Parameters<typeof resolveConnectionSnap>[0]> = {}) {
  return resolveConnectionSnap({
    cursor,
    candidates: [candidate('a')],
    zoom: 1,
    freeform: false,
    ...overrides,
  })
}

describe('target selection', () => {
  it('ignores nodes beyond the attract radius', () => {
    expect(snap({ x: HALF_WIDTH + TARGET_ATTRACT_RADIUS_PX + 5, y: 0 })).toBeNull()
  })

  it('targets a node the cursor has not reached yet', () => {
    const result = snap({ x: HALF_WIDTH + TARGET_ATTRACT_RADIUS_PX - 2, y: 0 })
    expect(result?.stateId).toBe('a')
  })

  it('scales the attract radius with the zoom level', () => {
    const cursor = { x: HALF_WIDTH + TARGET_ATTRACT_RADIUS_PX + 10, y: 0 }

    expect(snap(cursor, { zoom: 1 })).toBeNull()
    expect(snap(cursor, { zoom: 0.5 })?.stateId).toBe('a')
  })

  it('prefers the node the cursor is inside over one it is merely near', () => {
    const inside = candidate('inside', 0, 0)
    const nearby = candidate('nearby', DEFAULT_STATE_WIDTH + 10, 0)

    const result = snap({ x: 0, y: 0 }, { candidates: [nearby, inside] })
    expect(result?.stateId).toBe('inside')
  })

  it('picks the nearest when the cursor is inside none of them', () => {
    const near = candidate('near', 200, 0)
    const far = candidate('far', 400, 0)

    const result = snap({ x: 200 - HALF_WIDTH - 5, y: 0 }, { candidates: [far, near] })
    expect(result?.stateId).toBe('near')
  })

  it('breaks a tie in favour of the node drawn last', () => {
    const under = candidate('under', 0, 0)
    const over = candidate('over', 0, 0)

    const result = snap({ x: 0, y: 0 }, { candidates: [under, over] })
    expect(result?.stateId).toBe('over')
  })

  it('returns nothing when there are no candidates', () => {
    expect(snap({ x: 0, y: 0 }, { candidates: [] })).toBeNull()
  })
})

describe('port magnet', () => {
  it('pulls the endpoint onto a port from within the magnet radius', () => {
    const result = snap({ x: HALF_WIDTH + PORT_SNAP_RADIUS_PX - 2, y: 4 })

    expect(result?.kind).toBe('port')
    expect(result?.point).toEqual({ x: HALF_WIDTH, y: 0 })
    expect(result?.anchor).toEqual({ edge: 'right', fraction: 0.5 })
  })

  it('reports the outward normal of the port it grabbed', () => {
    const result = snap({ x: 0, y: -HALF_HEIGHT - 4 })

    expect(result?.anchor?.edge).toBe('top')
    expect(result?.normal.y).toBeCloseTo(-1)
  })

  it('gives way to the border once the cursor leaves the magnet radius', () => {
    const result = snap({ x: HALF_WIDTH, y: PORT_SNAP_RADIUS_PX + 4 })

    expect(result?.kind).toBe('perimeter')
    expect(result?.point.y).toBeCloseTo(PORT_SNAP_RADIUS_PX + 4)
  })

  it('shrinks the magnet radius in canvas units as the diagram zooms in', () => {
    const cursor = { x: HALF_WIDTH, y: PORT_SNAP_RADIUS_PX - 4 }

    expect(snap(cursor, { zoom: 1 })?.kind).toBe('port')
    expect(snap(cursor, { zoom: 2 })?.kind).toBe('perimeter')
  })

  it('snaps to the tip of a diamond, not the bounding box', () => {
    const result = snap(
      { x: HALF_WIDTH - 2, y: 2 },
      { candidates: [candidate('d', 0, 0, 'diamond')] },
    )

    expect(result?.kind).toBe('port')
    expect(result?.point).toEqual({ x: HALF_WIDTH, y: 0 })
  })
})

describe('perimeter magnet', () => {
  it('pins the exact border point just outside the shape', () => {
    const result = snap({ x: HALF_WIDTH + PERIMETER_SNAP_BAND_PX - 2, y: 20 })

    expect(result?.kind).toBe('perimeter')
    expect(result?.point).toEqual({ x: HALF_WIDTH, y: 20 })
    expect(result?.anchor).toEqual({ edge: 'right', fraction: (20 + HALF_HEIGHT) / DEFAULT_STATE_HEIGHT })
  })

  it('pins from just inside the border as well', () => {
    const result = snap({ x: HALF_WIDTH - 2, y: 20 })

    expect(result?.kind).toBe('perimeter')
    expect(result?.point.x).toBeCloseTo(HALF_WIDTH)
  })

  it('follows the slanted side of a diamond', () => {
    const outline = buildOutline(
      { id: 'd', position_x: 0, position_y: 0, shape: 'diamond' },
      DIMENSIONS,
    )
    const onBorder = nearestPointOnOutline(outline, { x: 40, y: -20 }).point
    const result = snap({ x: 40, y: -20 }, { candidates: [{ stateId: 'd', outline }] })

    expect(result?.kind).toBe('perimeter')
    expect(result?.point.x).toBeCloseTo(onBorder.x)
    expect(result?.point.y).toBeCloseTo(onBorder.y)
  })
})

describe('body attachment', () => {
  it('leaves the anchor dynamic when dropped on the middle of a node', () => {
    const result = snap({ x: 0, y: 0 })

    expect(result?.kind).toBe('body')
    expect(result?.anchor).toBeNull()
  })

  it('treats the attract ring outside the shape as a body target', () => {
    // Clear of the border band and of every port, but still within reach.
    const result = snap({ x: HALF_WIDTH + PERIMETER_SNAP_BAND_PX + 6, y: 25 })

    expect(result?.kind).toBe('body')
    expect(result?.anchor).toBeNull()
  })

  it('previews the border point facing the other end of the line', () => {
    const result = snap({ x: 0, y: 0 }, { origin: { x: -500, y: 0 } })

    expect(result?.point).toEqual({ x: -HALF_WIDTH, y: 0 })
  })

  it('falls back to the cursor projection when the other end is unknown', () => {
    const result = snap({ x: 10, y: 0 }, { origin: null })

    expect(result?.kind).toBe('body')
    expect(nearestPointOnOutline(result!.outline, result!.point).distance).toBeLessThan(1e-6)
  })
})

describe('freeform modifier', () => {
  it('places the endpoint exactly instead of jumping to a port', () => {
    const cursor = { x: HALF_WIDTH + 2, y: 3 }

    expect(snap(cursor)?.kind).toBe('port')

    const free = snap(cursor, { freeform: true })
    expect(free?.kind).toBe('perimeter')
    expect(free?.point).toEqual({ x: HALF_WIDTH, y: 3 })
  })

  it('pins to the border rather than attaching to the body', () => {
    const result = snap({ x: 0, y: 0 }, { freeform: true })

    expect(result?.kind).toBe('perimeter')
    expect(result?.anchor).not.toBeNull()
  })
})
