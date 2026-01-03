// Path calculation utilities for workflow transitions
import { DEFAULT_STATE_WIDTH, DEFAULT_STATE_HEIGHT, STRAIGHT_LENGTH } from '../constants'
import type { Point, PointWithEdge, EdgePosition } from '../types'

/**
 * Helper to lighten a hex color
 */
export const lightenColor = (hex: string, amount: number): string => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  
  const newR = Math.min(255, Math.round(r + (255 - r) * amount))
  const newG = Math.min(255, Math.round(g + (255 - g) * amount))
  const newB = Math.min(255, Math.round(b + (255 - b) * amount))
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}

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
  boxHeight: number = DEFAULT_STATE_HEIGHT
): { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; fraction: number } => {
  const hw = boxWidth / 2
  const hh = boxHeight / 2
  
  const left = boxCenterX - hw
  const right = boxCenterX + hw
  const top = boxCenterY - hh
  const bottom = boxCenterY + hh
  
  // Calculate closest point on each edge with fraction
  const candidates: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; dist: number; fraction: number }[] = []
  
  // Right edge - clamp Y to edge bounds
  const rightY = Math.max(top, Math.min(bottom, pointY))
  const rightFraction = (rightY - top) / (bottom - top)
  candidates.push({ x: right, y: rightY, edge: 'right', dist: Math.hypot(right - pointX, rightY - pointY), fraction: rightFraction })
  
  // Left edge
  const leftY = Math.max(top, Math.min(bottom, pointY))
  const leftFraction = (leftY - top) / (bottom - top)
  candidates.push({ x: left, y: leftY, edge: 'left', dist: Math.hypot(left - pointX, leftY - pointY), fraction: leftFraction })
  
  // Bottom edge
  const bottomX = Math.max(left, Math.min(right, pointX))
  const bottomFraction = (bottomX - left) / (right - left)
  candidates.push({ x: bottomX, y: bottom, edge: 'bottom', dist: Math.hypot(bottomX - pointX, bottom - pointY), fraction: bottomFraction })
  
  // Top edge
  const topX = Math.max(left, Math.min(right, pointX))
  const topFraction = (topX - left) / (right - left)
  candidates.push({ x: topX, y: top, edge: 'top', dist: Math.hypot(topX - pointX, top - pointY), fraction: topFraction })
  
  // Return the closest
  candidates.sort((a, b) => a.dist - b.dist)
  return { x: candidates[0].x, y: candidates[0].y, edge: candidates[0].edge, fraction: candidates[0].fraction }
}

/**
 * Convert stored edge position back to coordinates
 */
export const getPointFromEdgePosition = (
  boxCenterX: number, 
  boxCenterY: number,
  edgePos: EdgePosition,
  boxWidth: number = DEFAULT_STATE_WIDTH,
  boxHeight: number = DEFAULT_STATE_HEIGHT
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
  boxHeight: number = DEFAULT_STATE_HEIGHT
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
  const candidates: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; dist: number }[] = []
  
  // Right edge (x = right)
  if (dx > 0) {
    const t = (right - boxCenterX) / dx
    const y = boxCenterY + t * dy
    if (y >= top && y <= bottom) {
      candidates.push({ x: right, y, edge: 'right', dist: Math.hypot(right - targetX, y - targetY) })
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
      candidates.push({ x, y: bottom, edge: 'bottom', dist: Math.hypot(x - targetX, bottom - targetY) })
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
  } else if (absAngle >= 3 * Math.PI / 4) {
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
    case 'left': return { x: -1, y: 0 }
    case 'right': return { x: 1, y: 0 }
    case 'top': return { x: 0, y: -1 }
    case 'bottom': return { x: 0, y: 1 }
  }
}

/**
 * Calculate the actual midpoint of a quadratic bezier curve (at t=0.5)
 */
export const getBezierMidpoint = (
  startX: number, startY: number,
  controlX: number, controlY: number,
  endX: number, endY: number
): Point => {
  // B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2
  return {
    x: 0.25 * startX + 0.5 * controlX + 0.25 * endX,
    y: 0.25 * startY + 0.5 * controlY + 0.25 * endY
  }
}

/**
 * Calculate the control point needed to make the curve pass through a given midpoint
 */
export const getControlPointFromMidpoint = (
  startX: number, startY: number,
  midX: number, midY: number,
  endX: number, endY: number
): Point => {
  // If M = 0.25*P0 + 0.5*P1 + 0.25*P2, then P1 = 2*M - 0.5*(P0 + P2)
  return {
    x: 2 * midX - 0.5 * (startX + endX),
    y: 2 * midY - 0.5 * (startY + endY)
  }
}

/**
 * Generate a smooth SVG path through multiple waypoints with perpendicular box exits
 * Uses cubic bezier curves with straight perpendicular segments at box edges
 */
export const generateSplinePath = (
  start: PointWithEdge,
  waypointsList: Point[],
  end: PointWithEdge
): string => {
  // Get perpendicular directions for start and end
  const startDir = start.edge ? getPerpendicularDirection(start.edge) : null
  const endDir = end.edge ? getPerpendicularDirection(end.edge) : null
  
  // Calculate the "stub" points - ends of the perpendicular straight segments
  const startStub = startDir 
    ? { x: start.x + startDir.x * STRAIGHT_LENGTH, y: start.y + startDir.y * STRAIGHT_LENGTH }
    : null
  const endStub = endDir
    ? { x: end.x + endDir.x * STRAIGHT_LENGTH, y: end.y + endDir.y * STRAIGHT_LENGTH }
    : null
  
  // Calculate control point distance for the curved middle section
  const curveStart = startStub || start
  const curveEnd = endStub || end
  const curveDist = Math.hypot(curveEnd.x - curveStart.x, curveEnd.y - curveStart.y)
  const controlDist = Math.max(20, Math.min(50, curveDist * 0.35))
  
  // No waypoints
  if (waypointsList.length === 0) {
    let path = `M ${start.x} ${start.y}`
    
    // Straight segment from start (perpendicular)
    if (startStub) {
      path += ` L ${startStub.x} ${startStub.y}`
    }
    
    // Curved section from stub to stub (or start to end if no stubs)
    const p1 = startStub || start
    const p2 = endStub || end
    
    if (startDir && endDir) {
      // Both have edges - create a smooth S-curve between stubs
      const cp1 = {
        x: p1.x + (startDir?.x || 0) * controlDist,
        y: p1.y + (startDir?.y || 0) * controlDist
      }
      const cp2 = {
        x: p2.x + (endDir?.x || 0) * controlDist,
        y: p2.y + (endDir?.y || 0) * controlDist
      }
      path += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`
    } else {
      // Simple line between stubs
      path += ` L ${p2.x} ${p2.y}`
    }
    
    // Straight segment to end (perpendicular)
    if (endStub) {
      path += ` L ${end.x} ${end.y}`
    }
    
    return path
  }
  
  // With waypoints - build path through all points
  let path = `M ${start.x} ${start.y}`
  
  // Straight segment from start (perpendicular)
  if (startStub) {
    path += ` L ${startStub.x} ${startStub.y}`
  }
  
  // Build the curved section through waypoints
  const curvePoints = [startStub || start, ...waypointsList, endStub || end]
  
  for (let i = 0; i < curvePoints.length - 1; i++) {
    const p1 = curvePoints[i]
    const p2 = curvePoints[i + 1]
    const segmentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const segmentControlDist = Math.max(15, segmentDist * 0.35)
    
    let cp1: Point
    let cp2: Point
    
    // First control point
    if (i === 0 && startDir) {
      // Continue in the perpendicular direction from start
      cp1 = {
        x: p1.x + startDir.x * segmentControlDist,
        y: p1.y + startDir.y * segmentControlDist
      }
    } else {
      // Tangent based on surrounding points
      const prev = i > 0 ? curvePoints[i - 1] : p1
      const tangentX = p2.x - prev.x
      const tangentY = p2.y - prev.y
      const tangentLen = Math.hypot(tangentX, tangentY) || 1
      cp1 = {
        x: p1.x + (tangentX / tangentLen) * segmentControlDist,
        y: p1.y + (tangentY / tangentLen) * segmentControlDist
      }
    }
    
    // Second control point
    if (i === curvePoints.length - 2 && endDir) {
      // Approach from the perpendicular direction to end
      cp2 = {
        x: p2.x + endDir.x * segmentControlDist,
        y: p2.y + endDir.y * segmentControlDist
      }
    } else {
      // Tangent based on surrounding points
      const next = i < curvePoints.length - 2 ? curvePoints[i + 2] : p2
      const tangentX = next.x - p1.x
      const tangentY = next.y - p1.y
      const tangentLen = Math.hypot(tangentX, tangentY) || 1
      cp2 = {
        x: p2.x - (tangentX / tangentLen) * segmentControlDist,
        y: p2.y - (tangentY / tangentLen) * segmentControlDist
      }
    }
    
    path += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`
  }
  
  // Straight segment to end (perpendicular)
  if (endStub) {
    path += ` L ${end.x} ${end.y}`
  }
  
  return path
}

/**
 * Get a point on the spline at parameter t (0-1) for placing labels/gates
 * This approximates the position along the path including straight stubs
 */
export const getPointOnSpline = (
  start: PointWithEdge,
  waypointsList: Point[],
  end: PointWithEdge,
  t: number = 0.5
): Point => {
  // Get perpendicular directions
  const startDir = start.edge ? getPerpendicularDirection(start.edge) : null
  const endDir = end.edge ? getPerpendicularDirection(end.edge) : null
  
  const startStub = startDir 
    ? { x: start.x + startDir.x * STRAIGHT_LENGTH, y: start.y + startDir.y * STRAIGHT_LENGTH }
    : null
  const endStub = endDir
    ? { x: end.x + endDir.x * STRAIGHT_LENGTH, y: end.y + endDir.y * STRAIGHT_LENGTH }
    : null
  
  // Build all the points the path goes through
  const allPoints: Point[] = [start]
  if (startStub) allPoints.push(startStub)
  allPoints.push(...waypointsList)
  if (endStub) allPoints.push(endStub)
  allPoints.push(end)
  
  // Calculate total approximate path length
  let totalLength = 0
  const segmentLengths: number[] = []
  for (let i = 0; i < allPoints.length - 1; i++) {
    const len = Math.hypot(allPoints[i + 1].x - allPoints[i].x, allPoints[i + 1].y - allPoints[i].y)
    segmentLengths.push(len)
    totalLength += len
  }
  
  // Find which segment t falls in
  const targetLength = t * totalLength
  let accumulatedLength = 0
  
  for (let i = 0; i < segmentLengths.length; i++) {
    if (accumulatedLength + segmentLengths[i] >= targetLength) {
      // t falls in this segment
      const segmentProgress = (targetLength - accumulatedLength) / segmentLengths[i]
      return {
        x: allPoints[i].x + segmentProgress * (allPoints[i + 1].x - allPoints[i].x),
        y: allPoints[i].y + segmentProgress * (allPoints[i + 1].y - allPoints[i].y)
      }
    }
    accumulatedLength += segmentLengths[i]
  }
  
  // Fallback to end point
  return { x: end.x, y: end.y }
}

/**
 * Find the closest point on the path to insert a new waypoint
 */
export const findInsertionIndex = (
  waypointsList: Point[],
  start: Point,
  end: Point,
  clickPoint: Point
): number => {
  const points = [start, ...waypointsList, end]
  
  // Find which segment the click is closest to
  let bestSegment = 0
  let bestDist = Infinity
  
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    
    // Distance from point to line segment
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const lengthSq = dx * dx + dy * dy
    
    let t = 0
    if (lengthSq > 0) {
      t = Math.max(0, Math.min(1, ((clickPoint.x - p1.x) * dx + (clickPoint.y - p1.y) * dy) / lengthSq))
    }
    
    const projX = p1.x + t * dx
    const projY = p1.y + t * dy
    const dist = Math.hypot(clickPoint.x - projX, clickPoint.y - projY)
    
    if (dist < bestDist) {
      bestDist = dist
      bestSegment = i
    }
  }
  
  // Return the index where the new waypoint should be inserted
  return bestSegment
}

/**
 * Generate elbow (orthogonal) path with waypoints for segment control
 */
export const generateElbowPath = (
  start: PointWithEdge,
  waypointsList: Point[],
  end: PointWithEdge,
  turnOffset: number = 30
): { path: string; segments: Point[]; handles: Array<{ x: number; y: number; isVertical: boolean; segmentIndex: number; waypointIndex: number }> } => {
  const startEdge = start.edge
  const endEdge = end.edge
  
  // Determine exit point and direction
  let exitX = start.x
  let exitY = start.y
  const exitHorizontal = startEdge === 'left' || startEdge === 'right'
  
  if (startEdge === 'right') exitX = start.x + turnOffset
  else if (startEdge === 'left') exitX = start.x - turnOffset
  else if (startEdge === 'top') exitY = start.y - turnOffset
  else if (startEdge === 'bottom') exitY = start.y + turnOffset
  
  // Determine entry point and direction
  let entryX = end.x
  let entryY = end.y
  const entryHorizontal = endEdge === 'left' || endEdge === 'right'
  
  if (endEdge === 'right') entryX = end.x + turnOffset
  else if (endEdge === 'left') entryX = end.x - turnOffset
  else if (endEdge === 'top') entryY = end.y - turnOffset
  else if (endEdge === 'bottom') entryY = end.y + turnOffset
  
  // Build path segments
  const segments: Point[] = [{ x: start.x, y: start.y }]
  segments.push({ x: exitX, y: exitY })
  
  // Determine the segment structure based on exit/entry directions
  if (exitHorizontal && entryHorizontal) {
    // Both horizontal - need vertical segment(s) in middle
    if (waypointsList.length === 0) {
      const midX = (exitX + entryX) / 2
      segments.push({ x: midX, y: exitY })
      segments.push({ x: midX, y: entryY })
    } else {
      let currentY = exitY
      for (let i = 0; i < waypointsList.length; i++) {
        const segX = waypointsList[i].x
        segments.push({ x: segX, y: currentY })
        currentY = (i % 2 === 0) ? entryY : exitY
        segments.push({ x: segX, y: currentY })
      }
      const lastPt = segments[segments.length - 1]
      if (lastPt.y !== entryY) {
        const finalX = waypointsList.length > 0 
          ? waypointsList[waypointsList.length - 1].x 
          : (exitX + entryX) / 2
        segments.push({ x: finalX, y: entryY })
      }
    }
  } else if (!exitHorizontal && !entryHorizontal) {
    // Both vertical - need horizontal segment(s) in middle
    if (waypointsList.length === 0) {
      const midY = (exitY + entryY) / 2
      segments.push({ x: exitX, y: midY })
      segments.push({ x: entryX, y: midY })
    } else {
      let currentX = exitX
      for (let i = 0; i < waypointsList.length; i++) {
        const segY = waypointsList[i].y
        segments.push({ x: currentX, y: segY })
        currentX = (i % 2 === 0) ? entryX : exitX
        segments.push({ x: currentX, y: segY })
      }
      const lastPt = segments[segments.length - 1]
      if (lastPt.x !== entryX) {
        const finalY = waypointsList.length > 0 
          ? waypointsList[waypointsList.length - 1].y 
          : (exitY + entryY) / 2
        segments.push({ x: entryX, y: finalY })
      }
    }
  } else if (exitHorizontal) {
    // Exit horizontal, entry vertical
    if (waypointsList.length === 0) {
      segments.push({ x: entryX, y: exitY })
    } else {
      const wp = waypointsList[0]
      segments.push({ x: wp.x, y: exitY })
      segments.push({ x: wp.x, y: wp.y })
      if (wp.x !== entryX) {
        segments.push({ x: entryX, y: wp.y })
      }
    }
  } else {
    // Exit vertical, entry horizontal
    if (waypointsList.length === 0) {
      segments.push({ x: exitX, y: entryY })
    } else {
      const wp = waypointsList[0]
      segments.push({ x: exitX, y: wp.y })
      segments.push({ x: wp.x, y: wp.y })
      if (wp.y !== entryY) {
        segments.push({ x: wp.x, y: entryY })
      }
    }
  }
  
  segments.push({ x: entryX, y: entryY })
  segments.push({ x: end.x, y: end.y })
  
  // Remove duplicate consecutive points
  const cleanedSegments = segments.filter((p, i) => 
    i === 0 || p.x !== segments[i - 1].x || p.y !== segments[i - 1].y
  )
  
  // Build path string
  const path = cleanedSegments.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  
  // Calculate handles at segment midpoints
  const adjustableSegmentType: 'vertical' | 'horizontal' | 'both' = 
    (exitHorizontal && entryHorizontal) ? 'vertical' :
    (!exitHorizontal && !entryHorizontal) ? 'horizontal' : 'both'
  
  const handles: Array<{ x: number; y: number; isVertical: boolean; segmentIndex: number; waypointIndex: number }> = []
  let waypointIdx = 0
  
  for (let i = 1; i < cleanedSegments.length - 2; i++) {
    const p1 = cleanedSegments[i]
    const p2 = cleanedSegments[i + 1]
    
    const isVerticalSegment = Math.abs(p1.x - p2.x) < 1
    const isHorizontalSegment = Math.abs(p1.y - p2.y) < 1
    
    const shouldShowHandle = 
      (adjustableSegmentType === 'vertical' && isVerticalSegment) ||
      (adjustableSegmentType === 'horizontal' && isHorizontalSegment) ||
      adjustableSegmentType === 'both'
    
    if (shouldShowHandle) {
      handles.push({
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
        isVertical: isVerticalSegment,
        segmentIndex: i,
        waypointIndex: waypointIdx
      })
      waypointIdx++
    }
  }
  
  return { path, segments: cleanedSegments, handles }
}
