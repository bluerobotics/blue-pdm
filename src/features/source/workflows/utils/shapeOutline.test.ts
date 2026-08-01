import { describe, expect, it } from 'vitest'

import type { StateShape } from '@/types/workflow'

import { DEFAULT_STATE_HEIGHT, DEFAULT_STATE_WIDTH } from '../constants'
import type { EdgePosition } from '../types'

import { getPointFromEdgePosition } from './geometry'
import {
  anchorFromOutlinePoint,
  buildOutline,
  containsPoint,
  inflateOutline,
  intersectRayFromCenter,
  nearestPointOnOutline,
  outlinePointFromAnchor,
  outlinePorts,
  type Outline,
} from './shapeOutline'

const DIMENSIONS = { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
const HALF_WIDTH = DEFAULT_STATE_WIDTH / 2
const HALF_HEIGHT = DEFAULT_STATE_HEIGHT / 2

const EDGES = ['left', 'right', 'top', 'bottom'] as const
const FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8]

function outlineOf(shape: StateShape, cornerRadius: number | null = null): Outline {
  return buildOutline(
    { id: shape, position_x: 0, position_y: 0, shape, corner_radius: cornerRadius },
    DIMENSIONS,
  )
}

/** Smallest distance from a point to the outline, used to assert "sits on the border". */
function distanceToBorder(outline: Outline, point: { x: number; y: number }): number {
  return nearestPointOnOutline(outline, point).distance
}

describe('buildOutline', () => {
  it('matches the vertices StateNodeShape renders for a diamond', () => {
    expect(outlineOf('diamond').points).toEqual([
      { x: 0, y: -HALF_HEIGHT },
      { x: HALF_WIDTH, y: 0 },
      { x: 0, y: HALF_HEIGHT },
      { x: -HALF_WIDTH, y: 0 },
    ])
  })

  it('matches the vertices StateNodeShape renders for a hexagon', () => {
    expect(outlineOf('hexagon').points).toEqual([
      { x: -HALF_WIDTH * 0.5, y: -HALF_HEIGHT },
      { x: HALF_WIDTH * 0.5, y: -HALF_HEIGHT },
      { x: HALF_WIDTH, y: 0 },
      { x: HALF_WIDTH * 0.5, y: HALF_HEIGHT },
      { x: -HALF_WIDTH * 0.5, y: HALF_HEIGHT },
      { x: -HALF_WIDTH, y: 0 },
    ])
  })

  it('reduces a zero-radius rectangle to its four corners', () => {
    expect(outlineOf('rectangle', 0).points).toHaveLength(4)
  })

  it('translates the outline to the node position', () => {
    const outline = buildOutline(
      { id: 'a', position_x: 300, position_y: -80, shape: 'diamond' },
      DIMENSIONS,
    )
    expect(outline.center).toEqual({ x: 300, y: -80 })
    expect(outline.points[0]).toEqual({ x: 300, y: -80 - HALF_HEIGHT })
  })

  it('reuses the cached outline while the node is unchanged', () => {
    const state = { id: 'a', position_x: 0, position_y: 0, shape: 'ellipse' as const }
    expect(buildOutline(state, DIMENSIONS)).toBe(buildOutline(state, DIMENSIONS))
  })

  it('rebuilds after the node moves', () => {
    const state = { id: 'a', position_x: 0, position_y: 0, shape: 'ellipse' as const }
    const before = buildOutline(state, DIMENSIONS)
    state.position_x = 50
    expect(buildOutline(state, DIMENSIONS)).not.toBe(before)
  })
})

describe('anchor encoding', () => {
  it('places a sharp rectangle anchor exactly where the old box maths did', () => {
    const outline = outlineOf('rectangle', 0)

    for (const edge of EDGES) {
      for (const fraction of FRACTIONS) {
        const legacy = getPointFromEdgePosition(
          0,
          0,
          { edge, fraction },
          DEFAULT_STATE_WIDTH,
          DEFAULT_STATE_HEIGHT,
        )
        const resolved = outlinePointFromAnchor(outline, { edge, fraction })

        expect(resolved.x).toBe(legacy.x)
        expect(resolved.y).toBe(legacy.y)
        expect(resolved.edge).toBe(edge)
      }
    }
  })

  it('leaves rounded-rectangle anchors untouched away from the corners', () => {
    const outline = outlineOf('rectangle', 8)
    const legacy = getPointFromEdgePosition(
      0,
      0,
      { edge: 'right', fraction: 0.5 },
      DEFAULT_STATE_WIDTH,
      DEFAULT_STATE_HEIGHT,
    )
    const resolved = outlinePointFromAnchor(outline, { edge: 'right', fraction: 0.5 })

    expect(resolved.x).toBe(legacy.x)
    expect(resolved.y).toBe(legacy.y)
  })

  it('pulls a rounded-rectangle corner anchor in onto the arc', () => {
    const outline = outlineOf('rectangle', 8)
    const resolved = outlinePointFromAnchor(outline, { edge: 'top', fraction: 0 })

    expect(resolved.x).toBeGreaterThan(-HALF_WIDTH)
    expect(distanceToBorder(outline, resolved)).toBeLessThan(1e-6)
  })

  it.each<StateShape>(['rectangle', 'diamond', 'hexagon', 'ellipse'])(
    'round-trips every anchor of a %s',
    (shape) => {
      const outline = outlineOf(shape)

      for (const edge of EDGES) {
        for (const fraction of FRACTIONS) {
          const anchor: EdgePosition = { edge, fraction }
          const point = outlinePointFromAnchor(outline, anchor)
          const encoded = anchorFromOutlinePoint(outline, point)

          expect(encoded.edge).toBe(edge)
          expect(encoded.fraction).toBeCloseTo(fraction, 9)
        }
      }
    },
  )

  it.each<StateShape>(['rectangle', 'diamond', 'hexagon', 'ellipse'])(
    'puts every anchor of a %s on the border rather than the bounding box',
    (shape) => {
      const outline = outlineOf(shape)

      for (const edge of EDGES) {
        for (const fraction of FRACTIONS) {
          const point = outlinePointFromAnchor(outline, { edge, fraction })
          expect(distanceToBorder(outline, point)).toBeLessThan(1e-6)
        }
      }
    },
  )

  it('keeps a diamond anchor off the empty bounding-box corner', () => {
    const outline = outlineOf('diamond')
    const point = outlinePointFromAnchor(outline, { edge: 'top', fraction: 0.1 })

    // The bounding box would put this at the top-left, outside the diamond.
    expect(containsPoint(outline, { x: -HALF_WIDTH * 0.8, y: -HALF_HEIGHT })).toBe(false)
    expect(distanceToBorder(outline, point)).toBeLessThan(1e-6)
  })

  it('falls back to the right edge for a point at the centre', () => {
    expect(anchorFromOutlinePoint(outlineOf('rectangle'), { x: 0, y: 0 })).toEqual({
      edge: 'right',
      fraction: 0.5,
    })
  })
})

describe('containsPoint', () => {
  it('excludes the bounding-box corners of a diamond', () => {
    const outline = outlineOf('diamond')

    expect(containsPoint(outline, { x: 0, y: 0 })).toBe(true)
    expect(containsPoint(outline, { x: HALF_WIDTH - 1, y: -HALF_HEIGHT + 1 })).toBe(false)
    expect(containsPoint(outline, { x: -HALF_WIDTH + 1, y: HALF_HEIGHT - 1 })).toBe(false)
  })

  it('excludes the bounding-box corners of an ellipse', () => {
    const outline = outlineOf('ellipse')

    expect(containsPoint(outline, { x: 0, y: 0 })).toBe(true)
    expect(containsPoint(outline, { x: HALF_WIDTH * 0.9, y: HALF_HEIGHT * 0.9 })).toBe(false)
    expect(containsPoint(outline, { x: HALF_WIDTH * 0.5, y: 0 })).toBe(true)
  })

  it('includes points inside a hexagon and excludes its clipped corners', () => {
    const outline = outlineOf('hexagon')

    expect(containsPoint(outline, { x: 0, y: 0 })).toBe(true)
    expect(containsPoint(outline, { x: -HALF_WIDTH + 1, y: -HALF_HEIGHT + 1 })).toBe(false)
  })
})

describe('nearestPointOnOutline', () => {
  it('reports the outward normal of the side it landed on', () => {
    const outline = outlineOf('rectangle', 0)
    const hit = nearestPointOnOutline(outline, { x: 200, y: 0 })

    expect(hit.point).toEqual({ x: HALF_WIDTH, y: 0 })
    expect(hit.normal.x).toBeCloseTo(1)
    expect(hit.normal.y).toBeCloseTo(0)
    expect(hit.distance).toBeCloseTo(200 - HALF_WIDTH)
  })

  it('faces diagonally on the side of a diamond', () => {
    const outline = outlineOf('diamond')
    const hit = nearestPointOnOutline(outline, { x: 60, y: -60 })

    expect(hit.normal.x).toBeGreaterThan(0)
    expect(hit.normal.y).toBeLessThan(0)
  })

  it('measures from inside the shape too', () => {
    const outline = outlineOf('rectangle', 0)
    const hit = nearestPointOnOutline(outline, { x: HALF_WIDTH - 4, y: 0 })

    expect(hit.distance).toBeCloseTo(4)
    expect(hit.point.x).toBeCloseTo(HALF_WIDTH)
  })

  it.each<StateShape>(['rectangle', 'diamond', 'hexagon', 'ellipse'])(
    'always returns a unit normal for a %s',
    (shape) => {
      const outline = outlineOf(shape)

      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const probe = { x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 }
        const { normal } = nearestPointOnOutline(outline, probe)
        expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1)
      }
    },
  )
})

describe('intersectRayFromCenter', () => {
  it.each<StateShape>(['rectangle', 'diamond', 'hexagon', 'ellipse'])(
    'lands on the border of a %s in every direction',
    (shape) => {
      const outline = outlineOf(shape)

      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
        const target = { x: Math.cos(angle) * 500, y: Math.sin(angle) * 500 }
        const hit = intersectRayFromCenter(outline, target)
        expect(distanceToBorder(outline, hit.point)).toBeLessThan(1e-6)
      }
    },
  )

  it('degenerates gracefully when the target sits on the centre', () => {
    const outline = outlineOf('diamond')
    const hit = intersectRayFromCenter(outline, { x: 0, y: 0 })
    expect(Number.isFinite(hit.point.x)).toBe(true)
    expect(Number.isFinite(hit.point.y)).toBe(true)
  })
})

describe('inflateOutline', () => {
  it.each<StateShape>(['rectangle', 'diamond', 'hexagon', 'ellipse'])(
    'fully contains the original %s',
    (shape) => {
      const outline = outlineOf(shape)
      const inflated = inflateOutline(outline, 4)

      for (const point of outline.points) {
        expect(containsPoint(inflated, point)).toBe(true)
      }
      expect(inflated.perimeter).toBeGreaterThan(outline.perimeter)
    },
  )

  it('offsets each side by the requested distance rather than scaling', () => {
    const outline = outlineOf('rectangle', 0)
    const inflated = inflateOutline(outline, 5)

    expect(distanceToBorder(inflated, { x: HALF_WIDTH, y: 0 })).toBeCloseTo(5)
    expect(distanceToBorder(inflated, { x: 0, y: HALF_HEIGHT })).toBeCloseTo(5)
  })

  it('returns the same outline when there is nothing to offset', () => {
    const outline = outlineOf('diamond')
    expect(inflateOutline(outline, 0)).toBe(outline)
  })
})

describe('outlinePorts', () => {
  it.each<StateShape>(['rectangle', 'diamond', 'hexagon', 'ellipse'])(
    'puts all four ports of a %s on the border',
    (shape) => {
      const outline = outlineOf(shape)
      const ports = outlinePorts(outline)

      expect(ports).toHaveLength(4)
      for (const port of ports) {
        expect(distanceToBorder(outline, port)).toBeLessThan(1e-6)
      }
    },
  )

  it('puts a diamond port on the tip of each vertex', () => {
    const ports = outlinePorts(outlineOf('diamond'))
    expect(ports.map((p) => ({ x: p.x, y: p.y }))).toEqual([
      { x: HALF_WIDTH, y: 0 },
      { x: 0, y: HALF_HEIGHT },
      { x: -HALF_WIDTH, y: 0 },
      { x: 0, y: -HALF_HEIGHT },
    ])
  })
})
