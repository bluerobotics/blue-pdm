// TransitionLine component - renders a workflow transition on the canvas
import React from 'react'
import type { WorkflowState, WorkflowTransition, WorkflowGate } from '@/types/workflow'

import type { StateDimensions, EdgePosition, Point } from '../types'
import { lightenColor, computeTransitionGeometry, resolveEffectiveWaypoints } from '../utils'

export interface TransitionLineProps {
  transition: WorkflowTransition
  states: WorkflowState[]
  gates: WorkflowGate[]

  // Selection state
  isSelected: boolean
  /** One of this line's ends is being re-anchored; the live line is drawn by the preview layer. */
  isDragging: boolean
  hoveredTransitionId: string | null

  // Mode state
  isAdmin: boolean

  // Dimensions
  stateDimensions: Record<string, StateDimensions>

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
  hoveredTransitionId,
  isAdmin,
  stateDimensions,
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

  const isDraggingThisCurve = draggingCurveControl === transition.id
  const isDraggingThisLabel = draggingLabel === transition.id

  const geometry = computeTransitionGeometry({
    transitionId: transition.id,
    fromState,
    toState,
    stateDimensions,
    pathType: transition.line_path_type || 'spline',
    edgePositions,
    waypoints: resolveEffectiveWaypoints(
      storedWaypoints,
      isDraggingThisCurve ? draggingWaypointIndex : null,
      tempCurvePos,
    ),
    parallelOffset,
    labelOffset: storedLabelOffset,
    pinnedLabelPosition: pinnedPosition,
    tempLabelPos: isDraggingThisLabel ? tempLabelPos : null,
  })

  const { start: startPoint, end: endPoint, pathD, labelPos, gatePos, bounds } = geometry
  const lineCenterX = (bounds.minX + bounds.maxX) / 2
  const lineMinY = bounds.minY
  const pathType = transition.line_path_type || 'spline'

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
    <g
      key={transition.id}
      style={{ pointerEvents: 'auto' }}
      // While an end is being re-anchored the preview layer draws the live line;
      // this one stays put as a faded reminder of where it came from.
      opacity={isDraggingThisTransition ? 0.35 : 1}
    >
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
          transform={`translate(${labelPos.x}, ${labelPos.y})`}
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
          transform={`translate(${gatePos.x}, ${gatePos.y})`}
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

  return true
}

export const TransitionLine = React.memo(TransitionLineComponent, transitionPropsEqual)

