/**
 * Path generation functions for spline and elbow transition paths
 */
import { STRAIGHT_LENGTH } from '../constants'
import type { Point, PointWithEdge } from '../types'
import { getExitDirection } from './geometry'

/**
 * Generate a smooth SVG path through multiple waypoints with perpendicular box exits
 * Uses cubic bezier curves with straight perpendicular segments at box edges
 */
export const generateSplinePath = (
  start: PointWithEdge,
  waypointsList: Point[],
  end: PointWithEdge,
): string => {
  // Directions the line leaves each node's surface in
  const startDir = getExitDirection(start)
  const endDir = getExitDirection(end)

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
        y: p1.y + (startDir?.y || 0) * controlDist,
      }
      const cp2 = {
        x: p2.x + (endDir?.x || 0) * controlDist,
        y: p2.y + (endDir?.y || 0) * controlDist,
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
        y: p1.y + startDir.y * segmentControlDist,
      }
    } else {
      // Tangent based on surrounding points
      const prev = i > 0 ? curvePoints[i - 1] : p1
      const tangentX = p2.x - prev.x
      const tangentY = p2.y - prev.y
      const tangentLen = Math.hypot(tangentX, tangentY) || 1
      cp1 = {
        x: p1.x + (tangentX / tangentLen) * segmentControlDist,
        y: p1.y + (tangentY / tangentLen) * segmentControlDist,
      }
    }

    // Second control point
    if (i === curvePoints.length - 2 && endDir) {
      // Approach from the perpendicular direction to end
      cp2 = {
        x: p2.x + endDir.x * segmentControlDist,
        y: p2.y + endDir.y * segmentControlDist,
      }
    } else {
      // Tangent based on surrounding points
      const next = i < curvePoints.length - 2 ? curvePoints[i + 2] : p2
      const tangentX = next.x - p1.x
      const tangentY = next.y - p1.y
      const tangentLen = Math.hypot(tangentX, tangentY) || 1
      cp2 = {
        x: p2.x - (tangentX / tangentLen) * segmentControlDist,
        y: p2.y - (tangentY / tangentLen) * segmentControlDist,
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
  t: number = 0.5,
): Point => {
  const startDir = getExitDirection(start)
  const endDir = getExitDirection(end)

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

  // Every point is coincident, so there is no path to walk along
  if (totalLength === 0) {
    return { x: start.x, y: start.y }
  }

  // Find which segment t falls in
  const targetLength = t * totalLength
  let accumulatedLength = 0

  for (let i = 0; i < segmentLengths.length; i++) {
    // A zero-length segment cannot contain t and would divide by zero below
    if (segmentLengths[i] > 0 && accumulatedLength + segmentLengths[i] >= targetLength) {
      // t falls in this segment
      const segmentProgress = (targetLength - accumulatedLength) / segmentLengths[i]
      return {
        x: allPoints[i].x + segmentProgress * (allPoints[i + 1].x - allPoints[i].x),
        y: allPoints[i].y + segmentProgress * (allPoints[i + 1].y - allPoints[i].y),
      }
    }
    accumulatedLength += segmentLengths[i]
  }

  // Fallback to end point
  return { x: end.x, y: end.y }
}

/**
 * Generate elbow (orthogonal) path with waypoints for segment control
 */
export const generateElbowPath = (
  start: PointWithEdge,
  waypointsList: Point[],
  end: PointWithEdge,
  turnOffset: number = 30,
): {
  path: string
  segments: Point[]
  handles: Array<{
    x: number
    y: number
    isVertical: boolean
    segmentIndex: number
    waypointIndex: number
  }>
} => {
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
        currentY = i % 2 === 0 ? entryY : exitY
        segments.push({ x: segX, y: currentY })
      }
      const lastPt = segments[segments.length - 1]
      if (lastPt.y !== entryY) {
        const finalX =
          waypointsList.length > 0
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
        currentX = i % 2 === 0 ? entryX : exitX
        segments.push({ x: currentX, y: segY })
      }
      const lastPt = segments[segments.length - 1]
      if (lastPt.x !== entryX) {
        const finalY =
          waypointsList.length > 0
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
  const cleanedSegments = segments.filter(
    (p, i) => i === 0 || p.x !== segments[i - 1].x || p.y !== segments[i - 1].y,
  )

  // Build path string
  const path = cleanedSegments.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  // Calculate handles at segment midpoints
  const adjustableSegmentType: 'vertical' | 'horizontal' | 'both' =
    exitHorizontal && entryHorizontal
      ? 'vertical'
      : !exitHorizontal && !entryHorizontal
        ? 'horizontal'
        : 'both'

  const handles: Array<{
    x: number
    y: number
    isVertical: boolean
    segmentIndex: number
    waypointIndex: number
  }> = []
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
        waypointIndex: waypointIdx,
      })
      waypointIdx++
    }
  }

  return { path, segments: cleanedSegments, handles }
}
