// TransitionLine component - renders a workflow transition on the canvas
import React from 'react'
import type { WorkflowState, WorkflowTransition, WorkflowGate } from '../types'
import type { StateDimensions, EdgePosition, Point } from '../types'
import {
  lightenColor,
  getNearestPointOnBoxEdge,
  getPointFromEdgePosition,
  generateSplinePath,
  getPointOnSpline,
  getClosestPointOnBox,
} from '../utils'

export interface TransitionLineProps {
  transition: WorkflowTransition
  states: WorkflowState[]
  gates: WorkflowGate[]

  // Selection state
  isSelected: boolean
  isDragging: boolean
  draggingEndpoint: 'start' | 'end' | null
  hoveredTransitionId: string | null
  hoveredStateId: string | null

  // Mode state
  isAdmin: boolean

  // Dimensions
  stateDimensions: Record<string, StateDimensions>
  DEFAULT_STATE_WIDTH: number
  DEFAULT_STATE_HEIGHT: number

  // Positions
  edgePositions: Record<string, EdgePosition>
  waypoints: Point[]
  labelOffset: Point | null
  pinnedLabelPosition: Point | null

  // Perpendicular offset applied when an opposite-direction transition exists,
  // so A->B and B->A render as two clearly separated lines instead of overlapping.
  parallelOffset?: number

  // Curve control state
  draggingCurveControl: string | null
  draggingWaypointIndex: number | null
  tempCurvePos: Point | null

  // Label state
  draggingLabel: string | null
  tempLabelPos: Point | null

  // Mouse position
  mousePos: Point

  // Canvas transform - viewport read via ref so panning/zooming does not
  // re-render every transition; handlers use the always-current value.
  viewportRef: React.RefObject<{ pan: Point; zoom: number }>
  canvasRef: React.RefObject<HTMLDivElement | null>

  // Event handlers
  onSelect: () => void
  onHoverChange: (isHovered: boolean) => void
  onShowToolbar: (canvasX: number, canvasY: number) => void
  onAddWaypoint: (
    clickX: number,
    clickY: number,
    pathType: string,
    startEdge: string,
    endEdge: string,
  ) => void
  onShowContextMenu: (clientX: number, clientY: number, canvasX: number, canvasY: number) => void
  addToast: (type: 'success' | 'error' | 'info', message: string) => void
}

function TransitionLineComponent({
  transition,
  states,
  gates,
  isSelected,
  isDragging: isDraggingThisTransition,
  draggingEndpoint,
  hoveredTransitionId,
  hoveredStateId,
  isAdmin,
  stateDimensions,
  DEFAULT_STATE_WIDTH,
  DEFAULT_STATE_HEIGHT,
  edgePositions,
  waypoints: storedWaypoints,
  labelOffset: storedLabelOffset,
  pinnedLabelPosition: pinnedPosition,
  parallelOffset = 0,
  draggingCurveControl,
  draggingWaypointIndex,
  tempCurvePos,
  draggingLabel,
  tempLabelPos,
  mousePos,
  viewportRef,
  canvasRef,
  onSelect,
  onHoverChange,
  onShowToolbar,
  onAddWaypoint,
  onShowContextMenu,
  addToast,
}: TransitionLineProps) {
  const fromState = states.find((s) => s.id === transition.from_state_id)
  const toState = states.find((s) => s.id === transition.to_state_id)

  if (!fromState || !toState) return null

  const transitionGates = gates

  // Determine actual source and target positions
  let sourceStatePos = { x: fromState.position_x, y: fromState.position_y }
  let targetStatePos = { x: toState.position_x, y: toState.position_y }

  // Get custom dimensions
  const fromDims = stateDimensions[fromState.id] || {
    width: DEFAULT_STATE_WIDTH,
    height: DEFAULT_STATE_HEIGHT,
  }
  const toDims = stateDimensions[toState.id] || {
    width: DEFAULT_STATE_WIDTH,
    height: DEFAULT_STATE_HEIGHT,
  }

  // Check for stored edge positions
  const storedStartPos = edgePositions[`${transition.id}-start`]
  const storedEndPos = edgePositions[`${transition.id}-end`]

  // Calculate default connection points
  const defaultStartPoint = getClosestPointOnBox(
    sourceStatePos.x,
    sourceStatePos.y,
    targetStatePos.x,
    targetStatePos.y,
    fromDims.width,
    fromDims.height,
  )
  const defaultEndPoint = getClosestPointOnBox(
    targetStatePos.x,
    targetStatePos.y,
    sourceStatePos.x,
    sourceStatePos.y,
    toDims.width,
    toDims.height,
  )

  // Get the fixed points
  const fixedStartPoint = storedStartPos
    ? {
        ...getPointFromEdgePosition(
          sourceStatePos.x,
          sourceStatePos.y,
          storedStartPos,
          fromDims.width,
          fromDims.height,
        ),
        edge: storedStartPos.edge,
      }
    : defaultStartPoint
  const fixedEndPoint = storedEndPos
    ? {
        ...getPointFromEdgePosition(
          targetStatePos.x,
          targetStatePos.y,
          storedEndPos,
          toDims.width,
          toDims.height,
        ),
        edge: storedEndPos.edge,
      }
    : defaultEndPoint

  let startPoint: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' }
  let endPoint: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' }

  if (draggingEndpoint === 'start') {
    endPoint = fixedEndPoint
    if (hoveredStateId) {
      const hoverState = states.find((s) => s.id === hoveredStateId)
      if (hoverState) {
        const hoverDims = stateDimensions[hoverState.id] || {
          width: DEFAULT_STATE_WIDTH,
          height: DEFAULT_STATE_HEIGHT,
        }
        startPoint = getNearestPointOnBoxEdge(
          hoverState.position_x,
          hoverState.position_y,
          mousePos.x,
          mousePos.y,
          hoverDims.width,
          hoverDims.height,
        )
      } else {
        startPoint = { x: mousePos.x, y: mousePos.y, edge: 'right' }
      }
    } else {
      startPoint = { x: mousePos.x, y: mousePos.y, edge: 'right' }
    }
  } else if (draggingEndpoint === 'end') {
    startPoint = fixedStartPoint
    if (hoveredStateId) {
      const hoverState = states.find((s) => s.id === hoveredStateId)
      if (hoverState) {
        const hoverDims = stateDimensions[hoverState.id] || {
          width: DEFAULT_STATE_WIDTH,
          height: DEFAULT_STATE_HEIGHT,
        }
        endPoint = getNearestPointOnBoxEdge(
          hoverState.position_x,
          hoverState.position_y,
          mousePos.x,
          mousePos.y,
          hoverDims.width,
          hoverDims.height,
        )
      } else {
        endPoint = { x: mousePos.x, y: mousePos.y, edge: 'left' }
      }
    } else {
      endPoint = { x: mousePos.x, y: mousePos.y, edge: 'left' }
    }
  } else {
    startPoint = fixedStartPoint
    endPoint = fixedEndPoint
  }

  let startX = startPoint.x
  let startY = startPoint.y
  let endX = endPoint.x
  let endY = endPoint.y

  // Separate opposing transitions (A->B and B->A) by shifting the whole line
  // perpendicular to its direction so the two never overlap.
  if (parallelOffset !== 0 && draggingEndpoint === null) {
    const dx = endX - startX
    const dy = endY - startY
    const len = Math.hypot(dx, dy)
    if (len > 0.0001) {
      const perpX = -dy / len
      const perpY = dx / len
      startX += perpX * parallelOffset
      startY += perpY * parallelOffset
      endX += perpX * parallelOffset
      endY += perpY * parallelOffset
    }
  }

  // Line midpoint
  const lineMidX = (startX + endX) / 2
  const lineMidY = (startY + endY) / 2

  // Calculate bounding box for toolbar positioning
  const allLinePoints = [{ x: startX, y: startY }, { x: endX, y: endY }, ...storedWaypoints]
  const lineMinY = Math.min(...allLinePoints.map((p) => p.y))
  const lineCenterX =
    (Math.min(...allLinePoints.map((p) => p.x)) + Math.max(...allLinePoints.map((p) => p.x))) / 2

  // Check if we're dragging this transition's curve control
  const isDraggingThisCurve = draggingCurveControl === transition.id
  const isDraggingThisLabel = draggingLabel === transition.id

  // Build the effective waypoints list
  let effectiveWaypoints: Array<{ x: number; y: number }> = [...storedWaypoints]

  if (isDraggingThisCurve && tempCurvePos && draggingWaypointIndex !== null) {
    effectiveWaypoints = [...storedWaypoints]
    while (effectiveWaypoints.length <= draggingWaypointIndex) {
      effectiveWaypoints.push({ x: tempCurvePos.x, y: tempCurvePos.y })
    }
    effectiveWaypoints[draggingWaypointIndex] = { x: tempCurvePos.x, y: tempCurvePos.y }
  }

  // Generate path based on path type. While actively dragging an endpoint, draw
  // a straight rubber-band line to the cursor so the arrowhead always points
  // along the drag direction (a curved preview with a fixed perpendicular stub
  // can make the auto-oriented arrow appear to reverse).
  const start = { x: startX, y: startY, edge: startPoint.edge }
  const end = { x: endX, y: endY, edge: endPoint.edge }
  const pathType = draggingEndpoint !== null ? 'straight' : transition.line_path_type || 'spline'

  let pathD: string
  let curveMid: { x: number; y: number }

  if (pathType === 'straight') {
    pathD = `M ${startX} ${startY} L ${endX} ${endY}`
    curveMid = { x: (startX + endX) / 2, y: (startY + endY) / 2 }
  } else if (pathType === 'elbow') {
    // Elbow path calculation (simplified - full logic is complex)
    const startEdge = startPoint.edge
    const endEdge = endPoint.edge
    const TURN_OFFSET = 30

    let exitX = startX
    let exitY = startY
    const exitHorizontal = startEdge === 'left' || startEdge === 'right'

    if (startEdge === 'right') exitX = startX + TURN_OFFSET
    else if (startEdge === 'left') exitX = startX - TURN_OFFSET
    else if (startEdge === 'top') exitY = startY - TURN_OFFSET
    else if (startEdge === 'bottom') exitY = startY + TURN_OFFSET

    let entryX = endX
    let entryY = endY
    const entryHorizontal = endEdge === 'left' || endEdge === 'right'

    if (endEdge === 'right') entryX = endX + TURN_OFFSET
    else if (endEdge === 'left') entryX = endX - TURN_OFFSET
    else if (endEdge === 'top') entryY = endY - TURN_OFFSET
    else if (endEdge === 'bottom') entryY = endY + TURN_OFFSET

    // Build segments
    const segments: Array<{ x: number; y: number }> = [{ x: startX, y: startY }]
    segments.push({ x: exitX, y: exitY })

    if (exitHorizontal && entryHorizontal) {
      if (effectiveWaypoints.length === 0) {
        const midX = (exitX + entryX) / 2
        segments.push({ x: midX, y: exitY })
        segments.push({ x: midX, y: entryY })
      } else {
        let currentY = exitY
        for (let i = 0; i < effectiveWaypoints.length; i++) {
          const segX = effectiveWaypoints[i].x
          segments.push({ x: segX, y: currentY })
          currentY = i % 2 === 0 ? entryY : exitY
          segments.push({ x: segX, y: currentY })
        }
        const lastPt = segments[segments.length - 1]
        if (lastPt.y !== entryY) {
          const finalX = effectiveWaypoints[effectiveWaypoints.length - 1].x
          segments.push({ x: finalX, y: entryY })
        }
      }
    } else if (!exitHorizontal && !entryHorizontal) {
      if (effectiveWaypoints.length === 0) {
        const midY = (exitY + entryY) / 2
        segments.push({ x: exitX, y: midY })
        segments.push({ x: entryX, y: midY })
      } else {
        let currentX = exitX
        for (let i = 0; i < effectiveWaypoints.length; i++) {
          const segY = effectiveWaypoints[i].y
          segments.push({ x: currentX, y: segY })
          currentX = i % 2 === 0 ? entryX : exitX
          segments.push({ x: currentX, y: segY })
        }
        const lastPt = segments[segments.length - 1]
        if (lastPt.x !== entryX) {
          const finalY = effectiveWaypoints[effectiveWaypoints.length - 1].y
          segments.push({ x: entryX, y: finalY })
        }
      }
    } else if (exitHorizontal) {
      if (effectiveWaypoints.length === 0) {
        segments.push({ x: entryX, y: exitY })
      } else {
        const wp = effectiveWaypoints[0]
        segments.push({ x: wp.x, y: exitY })
        segments.push({ x: wp.x, y: wp.y })
        if (wp.x !== entryX) {
          segments.push({ x: entryX, y: wp.y })
        }
      }
    } else {
      if (effectiveWaypoints.length === 0) {
        segments.push({ x: exitX, y: entryY })
      } else {
        const wp = effectiveWaypoints[0]
        segments.push({ x: exitX, y: wp.y })
        segments.push({ x: wp.x, y: wp.y })
        if (wp.y !== entryY) {
          segments.push({ x: wp.x, y: entryY })
        }
      }
    }

    segments.push({ x: entryX, y: entryY })
    segments.push({ x: endX, y: endY })

    // Remove duplicates
    const cleanedSegments = segments.filter(
      (p, i) => i === 0 || p.x !== segments[i - 1].x || p.y !== segments[i - 1].y,
    )

    pathD = cleanedSegments.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

    const midIdx = Math.floor(cleanedSegments.length / 2)
    curveMid = {
      x: (cleanedSegments[Math.max(0, midIdx - 1)].x + cleanedSegments[midIdx].x) / 2,
      y: (cleanedSegments[Math.max(0, midIdx - 1)].y + cleanedSegments[midIdx].y) / 2,
    }
  } else {
    // Spline (curved)
    pathD = generateSplinePath(start, effectiveWaypoints, end)
    curveMid = getPointOnSpline(start, effectiveWaypoints, end, 0.5)
  }

  const curveMidX = curveMid.x
  const curveMidY = curveMid.y

  // Label position
  let labelX: number, labelY: number

  if (isDraggingThisLabel && tempLabelPos) {
    labelX = tempLabelPos.x
    labelY = tempLabelPos.y
  } else if (pinnedPosition) {
    labelX = pinnedPosition.x
    labelY = pinnedPosition.y
  } else if (storedLabelOffset) {
    labelX = lineMidX + storedLabelOffset.x
    labelY = lineMidY + storedLabelOffset.y
  } else {
    labelX = curveMidX
    labelY = curveMidY - 20
  }

  // Gate position
  const gateX = curveMidX
  const gateY = curveMidY + 15

  // Line styling
  const isHoveredLine = hoveredTransitionId === transition.id
  const baseColor = transition.line_color || '#6b7280'
  const lineColor = isDraggingThisTransition
    ? '#60a5fa'
    : isSelected
      ? '#60a5fa'
      : isHoveredLine
        ? lightenColor(baseColor, 0.35)
        : baseColor
  const strokeWidth = transition.line_thickness || 2
  const arrowHead = transition.line_arrow_head || 'end'

  // Markers
  let markerStart: string | undefined
  let markerEnd: string | undefined

  if (isSelected || isDraggingThisTransition) {
    if (arrowHead === 'end') markerEnd = 'url(#arrowhead-selected)'
    if (arrowHead === 'start') markerStart = 'url(#arrowhead-start-selected)'
  } else if (isHoveredLine) {
    if (arrowHead === 'end') markerEnd = `url(#arrowhead-hover-${transition.id})`
    if (arrowHead === 'start') markerStart = `url(#arrowhead-start-hover-${transition.id})`
  } else {
    if (arrowHead === 'end') markerEnd = `url(#arrowhead-${transition.id})`
    if (arrowHead === 'start') markerStart = `url(#arrowhead-start-${transition.id})`
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
    onShowToolbar(lineCenterX, lineMinY)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isAdmin) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const { pan, zoom } = viewportRef.current ?? { pan: { x: 0, y: 0 }, zoom: 1 }
    const clickX = (e.clientX - rect.left - pan.x) / zoom
    const clickY = (e.clientY - rect.top - pan.y) / zoom

    onAddWaypoint(clickX, clickY, pathType, startPoint.edge, endPoint.edge)
    addToast('info', 'Control point added')
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect()

    const rect = canvasRef.current?.getBoundingClientRect()
    const { pan, zoom } = viewportRef.current ?? { pan: { x: 0, y: 0 }, zoom: 1 }
    const clickX = rect ? (e.clientX - rect.left - pan.x) / zoom : 0
    const clickY = rect ? (e.clientY - rect.top - pan.y) / zoom : 0

    onShowContextMenu(e.clientX, e.clientY, clickX, clickY)
  }

  return (
    <g key={transition.id} style={{ pointerEvents: 'auto' }}>
      {/* Clickable wider path for selection */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth="20"
        className="cursor-pointer"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Visible path */}
      <path
        d={pathD}
        fill="none"
        stroke={lineColor}
        strokeWidth={strokeWidth}
        strokeDasharray={
          isDraggingThisTransition
            ? '6,3'
            : transition.line_style === 'dashed'
              ? '8,4'
              : transition.line_style === 'dotted'
                ? '2,4'
                : 'none'
        }
        markerStart={markerStart}
        markerEnd={markerEnd}
        className="pointer-events-none"
        style={{ transition: 'stroke 0.15s ease-out' }}
      />

      {/* Transition label */}
      {transition.name && !isDraggingThisTransition && !isSelected && (
        <g
          transform={`translate(${labelX}, ${labelY})`}
          className="cursor-pointer"
          style={{ pointerEvents: 'all' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClick}
        >
          <rect
            x={-(transition.name.length * 3.5 + 8)}
            y="-10"
            width={transition.name.length * 7 + 16}
            height="18"
            rx="4"
            fill="rgba(31, 41, 55, 0.9)"
            stroke="rgba(75, 85, 99, 0.5)"
            strokeWidth="1"
          />
          <text
            x="0"
            y="3"
            textAnchor="middle"
            fontSize="10"
            fill="#d1d5db"
            className="select-none pointer-events-none"
          >
            {transition.name}
          </text>
        </g>
      )}

      {/* Gate indicator */}
      {transitionGates.length > 0 && !isDraggingThisTransition && (
        <g
          transform={`translate(${gateX}, ${gateY})`}
          className="cursor-pointer"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClick}
        >
          <circle
            r="12"
            fill="#f59e0b"
            stroke="#fff"
            strokeWidth="2"
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontWeight="700"
            fill="#000"
            className="select-none pointer-events-none"
          >
            {transitionGates.length}
          </text>
          <title>
            {transitionGates.length} gate{transitionGates.length > 1 ? 's' : ''} - click to view
          </title>
        </g>
      )}
    </g>
  )
}

function pointEqual(a: Point | null, b: Point | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y
}

function pointArraysEqual(a: Point[], b: Point[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false
  }
  return true
}

/**
 * Re-render a transition only when something that affects its rendering changes.
 * The viewport (pan/zoom) is read via ref, so panning/zooming never re-renders
 * edges. During a node drag only the moved node's endpoints change reference, so
 * only the connected edges re-render.
 */
function transitionPropsEqual(prev: TransitionLineProps, next: TransitionLineProps): boolean {
  const t = next.transition
  if (prev.transition !== t) return false
  if (prev.isSelected !== next.isSelected) return false
  if (prev.isDragging !== next.isDragging) return false
  if (prev.draggingEndpoint !== next.draggingEndpoint) return false
  if (prev.isAdmin !== next.isAdmin) return false
  if (prev.parallelOffset !== next.parallelOffset) return false

  // Hover color only matters when this line is the hovered one.
  if ((prev.hoveredTransitionId === t.id) !== (next.hoveredTransitionId === t.id)) return false

  // Gate badge count.
  if (prev.gates.length !== next.gates.length) return false

  // Endpoint state objects (positions) - changes only for connected nodes.
  const pf = prev.states.find((s) => s.id === t.from_state_id)
  const nf = next.states.find((s) => s.id === t.from_state_id)
  if (pf !== nf) return false
  const pt = prev.states.find((s) => s.id === t.to_state_id)
  const nt = next.states.find((s) => s.id === t.to_state_id)
  if (pt !== nt) return false

  // Endpoint dimensions.
  if (prev.stateDimensions[t.from_state_id] !== next.stateDimensions[t.from_state_id]) return false
  if (prev.stateDimensions[t.to_state_id] !== next.stateDimensions[t.to_state_id]) return false

  // Custom edge anchor positions for this transition.
  if (prev.edgePositions[`${t.id}-start`] !== next.edgePositions[`${t.id}-start`]) return false
  if (prev.edgePositions[`${t.id}-end`] !== next.edgePositions[`${t.id}-end`]) return false

  // Label positioning.
  if (prev.labelOffset !== next.labelOffset) return false
  if (prev.pinnedLabelPosition !== next.pinnedLabelPosition) return false

  // Stored waypoints.
  if (!pointArraysEqual(prev.waypoints, next.waypoints)) return false

  // Live waypoint drag only affects the edge being dragged.
  const prevCurve = prev.draggingCurveControl === t.id
  const nextCurve = next.draggingCurveControl === t.id
  if (prevCurve !== nextCurve) return false
  if (nextCurve) {
    if (prev.draggingWaypointIndex !== next.draggingWaypointIndex) return false
    if (!pointEqual(prev.tempCurvePos, next.tempCurvePos)) return false
  }

  // Live label drag only affects the edge being dragged.
  const prevLabel = prev.draggingLabel === t.id
  const nextLabel = next.draggingLabel === t.id
  if (prevLabel !== nextLabel) return false
  if (nextLabel && !pointEqual(prev.tempLabelPos, next.tempLabelPos)) return false

  // Endpoint drag previews follow the cursor / hovered target.
  if (next.draggingEndpoint !== null) {
    if (!pointEqual(prev.mousePos, next.mousePos)) return false
    if (prev.hoveredStateId !== next.hoveredStateId) return false
  }

  return true
}

export const TransitionLine = React.memo(TransitionLineComponent, transitionPropsEqual)

