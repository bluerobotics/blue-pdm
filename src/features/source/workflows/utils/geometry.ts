/**
 * Geometry utility functions for box/edge calculations
 */
import { DEFAULT_STATE_WIDTH, DEFAULT_STATE_HEIGHT } from '../constants'
import type { Point, PointWithEdge, EdgePosition } from '../types'

/**
 * Find the absolute closest point on any edge of the box to a given point
 * Also returns the fraction (0-1) along that edge for storage
 */
export const getNearestPointOnBoxEdge = (
  boxCenterX: number,
  boxCenterY: number,
  pointX: number,
  pointY: number,
  boxWidth: number = DEFAULT_STATE_WIDTH,
  boxHeight: number = DEFAULT_STATE_HEIGHT,
): { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; fraction: number } => {
  const hw = boxWidth / 2
  const hh = boxHeight / 2

  const left = boxCenterX - hw
  const right = boxCenterX + hw
  const top = boxCenterY - hh
  const bottom = boxCenterY + hh

  // Calculate closest point on each edge with fraction
  const candidates: {
    x: number
    y: number
    edge: 'left' | 'right' | 'top' | 'bottom'
    dist: number
    fraction: number
  }[] = []

  // Right edge - clamp Y to edge bounds
  const rightY = Math.max(top, Math.min(bottom, pointY))
  const rightFraction = (rightY - top) / (bottom - top)
  candidates.push({
    x: right,
    y: rightY,
    edge: 'right',
    dist: Math.hypot(right - pointX, rightY - pointY),
    fraction: rightFraction,
  })

  // Left edge
  const leftY = Math.max(top, Math.min(bottom, pointY))
  const leftFraction = (leftY - top) / (bottom - top)
  candidates.push({
    x: left,
    y: leftY,
    edge: 'left',
    dist: Math.hypot(left - pointX, leftY - pointY),
    fraction: leftFraction,
  })

  // Bottom edge
  const bottomX = Math.max(left, Math.min(right, pointX))
  const bottomFraction = (bottomX - left) / (right - left)
  candidates.push({
    x: bottomX,
    y: bottom,
    edge: 'bottom',
    dist: Math.hypot(bottomX - pointX, bottom - pointY),
    fraction: bottomFraction,
  })

  // Top edge
  const topX = Math.max(left, Math.min(right, pointX))
  const topFraction = (topX - left) / (right - left)
  candidates.push({
    x: topX,
    y: top,
    edge: 'top',
    dist: Math.hypot(topX - pointX, top - pointY),
    fraction: topFraction,
  })

  // Return the closest
  candidates.sort((a, b) => a.dist - b.dist)
  return {
    x: candidates[0].x,
    y: candidates[0].y,
    edge: candidates[0].edge,
    fraction: candidates[0].fraction,
  }
}

/**
 * Convert stored edge position back to coordinates
 */
export const getPointFromEdgePosition = (
  boxCenterX: number,
  boxCenterY: number,
  edgePos: EdgePosition,
  boxWidth: number = DEFAULT_STATE_WIDTH,
  boxHeight: number = DEFAULT_STATE_HEIGHT,
): Point => {
  const hw = boxWidth / 2
  const hh = boxHeight / 2

  const left = boxCenterX - hw
  const right = boxCenterX + hw
  const top = boxCenterY - hh
  const bottom = boxCenterY + hh

  switch (edgePos.edge) {
    case 'right':
      return { x: right, y: top + edgePos.fraction * (bottom - top) }
    case 'left':
      return { x: left, y: top + edgePos.fraction * (bottom - top) }
    case 'bottom':
      return { x: left + edgePos.fraction * (right - left), y: bottom }
    case 'top':
      return { x: left + edgePos.fraction * (right - left), y: top }
  }
}

/**
 * Calculate connection point using ray from center to target (for non-dragging cases)
 */
export const getClosestPointOnBox = (
  boxCenterX: number,
  boxCenterY: number,
  targetX: number,
  targetY: number,
  boxWidth: number = DEFAULT_STATE_WIDTH,
  boxHeight: number = DEFAULT_STATE_HEIGHT,
): PointWithEdge => {
  const hw = boxWidth / 2
  const hh = boxHeight / 2

  const left = boxCenterX - hw
  const right = boxCenterX + hw
  const top = boxCenterY - hh
  const bottom = boxCenterY + hh

  const dx = targetX - boxCenterX
  const dy = targetY - boxCenterY

  // If target is at same position, default to right edge
  if (dx === 0 && dy === 0) {
    return { x: right, y: boxCenterY, edge: 'right' }
  }

  // Find where the line from center to target intersects each edge
  const candidates: {
    x: number
    y: number
    edge: 'left' | 'right' | 'top' | 'bottom'
    dist: number
  }[] = []

  // Right edge (x = right)
  if (dx > 0) {
    const t = (right - boxCenterX) / dx
    const y = boxCenterY + t * dy
    if (y >= top && y <= bottom) {
      candidates.push({
        x: right,
        y,
        edge: 'right',
        dist: Math.hypot(right - targetX, y - targetY),
      })
    }
  }

  // Left edge (x = left)
  if (dx < 0) {
    const t = (left - boxCenterX) / dx
    const y = boxCenterY + t * dy
    if (y >= top && y <= bottom) {
      candidates.push({ x: left, y, edge: 'left', dist: Math.hypot(left - targetX, y - targetY) })
    }
  }

  // Bottom edge (y = bottom)
  if (dy > 0) {
    const t = (bottom - boxCenterY) / dy
    const x = boxCenterX + t * dx
    if (x >= left && x <= right) {
      candidates.push({
        x,
        y: bottom,
        edge: 'bottom',
        dist: Math.hypot(x - targetX, bottom - targetY),
      })
    }
  }

  // Top edge (y = top)
  if (dy < 0) {
    const t = (top - boxCenterY) / dy
    const x = boxCenterX + t * dx
    if (x >= left && x <= right) {
      candidates.push({ x, y: top, edge: 'top', dist: Math.hypot(x - targetX, top - targetY) })
    }
  }

  // Return the closest intersection point
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.dist - b.dist)
    return { x: candidates[0].x, y: candidates[0].y, edge: candidates[0].edge }
  }

  // Fallback: determine edge based on angle
  const angle = Math.atan2(dy, dx)
  const absAngle = Math.abs(angle)

  if (absAngle <= Math.PI / 4) {
    return { x: right, y: boxCenterY, edge: 'right' }
  } else if (absAngle >= (3 * Math.PI) / 4) {
    return { x: left, y: boxCenterY, edge: 'left' }
  } else if (angle > 0) {
    return { x: boxCenterX, y: bottom, edge: 'bottom' }
  } else {
    return { x: boxCenterX, y: top, edge: 'top' }
  }
}

/**
 * Get perpendicular direction vector based on box edge
 */
export const getPerpendicularDirection = (edge: 'left' | 'right' | 'top' | 'bottom'): Point => {
  switch (edge) {
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
  }
}

/**
 * The direction a line should leave an anchor in.
 *
 * Anchors resolved against a node's real outline carry the surface normal,
 * which is the only direction that looks right on a shape whose sides are not
 * axis-aligned: the side of a diamond faces diagonally and every point on an
 * ellipse faces somewhere different. Anchors without one fall back to the axis
 * their edge names.
 */
export const getExitDirection = (anchor: PointWithEdge): Point | null => {
  const { normal } = anchor
  if (normal && (normal.x !== 0 || normal.y !== 0)) return normal
  return anchor.edge ? getPerpendicularDirection(anchor.edge) : null
}
