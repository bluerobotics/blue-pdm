import { describe, expect, it } from 'vitest'

import type { PointWithEdge } from '../types'

import { generateElbowPath, generateSplinePath, getPointOnSpline } from './pathGeneration'

const right: PointWithEdge = { x: 60, y: 0, edge: 'right' }
const left: PointWithEdge = { x: 340, y: 0, edge: 'left' }

describe('getPointOnSpline', () => {
  it('returns the midpoint of a straight horizontal run', () => {
    const point = getPointOnSpline(right, [], left, 0.5)

    expect(point.y).toBe(0)
    expect(point.x).toBeCloseTo(200)
  })

  it('does not divide by zero when every point coincides', () => {
    const coincident: PointWithEdge = { x: 10, y: 10, edge: 'right' }
    const point = getPointOnSpline(
      coincident,
      [{ x: 10, y: 10 }],
      { ...coincident, edge: 'left' },
      0.5,
    )

    expect(point).toEqual({ x: 10, y: 10 })
  })

  it('skips zero-length segments instead of returning NaN', () => {
    const duplicated = [
      { x: 200, y: 0 },
      { x: 200, y: 0 },
    ]
    const point = getPointOnSpline(right, duplicated, left, 0.5)

    expect(Number.isNaN(point.x)).toBe(false)
    expect(Number.isNaN(point.y)).toBe(false)
  })

  it('walks to the ends at t = 0 and t = 1', () => {
    expect(getPointOnSpline(right, [], left, 0)).toEqual({ x: right.x, y: right.y })
    expect(getPointOnSpline(right, [], left, 1)).toEqual({ x: left.x, y: left.y })
  })
})

describe('generateSplinePath', () => {
  it('starts at the start anchor and ends at the end anchor', () => {
    const path = generateSplinePath(right, [], left)

    expect(path.startsWith(`M ${right.x} ${right.y}`)).toBe(true)
    expect(path.endsWith(`L ${left.x} ${left.y}`)).toBe(true)
  })

  it('emits no NaN coordinates for coincident anchors', () => {
    const path = generateSplinePath({ x: 0, y: 0, edge: 'right' }, [], { x: 0, y: 0, edge: 'left' })

    expect(path).not.toContain('NaN')
  })
})

describe('generateElbowPath', () => {
  it('produces orthogonal segments between the two anchors', () => {
    const { path, segments } = generateElbowPath(right, [], left)

    expect(path).not.toContain('NaN')
    expect(segments.length).toBeGreaterThan(1)
    for (let i = 0; i < segments.length - 1; i++) {
      const isOrthogonal =
        Math.abs(segments[i].x - segments[i + 1].x) < 0.001 ||
        Math.abs(segments[i].y - segments[i + 1].y) < 0.001
      expect(isOrthogonal).toBe(true)
    }
  })
})
