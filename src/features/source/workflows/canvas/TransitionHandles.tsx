// Transition handles component - renders draggable handles for transition endpoints, waypoints, and labels
import type { TransitionPathType, WorkflowState, WorkflowTransition } from '@/types/workflow'
import { computeTransitionGeometry } from '../utils'
import {
  HANDLE_HIT_RADIUS_PX,
  HANDLE_VISUAL_RADIUS_PX,
  WAYPOINT_HOVER_RING_PX,
} from '../constants'
import type { ConnectionPointer } from '../hooks/useConnectionGesture'
import type {
  EdgePosition,
  PointWithEdge,
  StateDimensions,
  TransitionEndpointDrag,
  WaypointContextMenu,
  FloatingToolbarState,
} from '../types'

interface TransitionHandlesProps {
  transitions: WorkflowTransition[]
  states: WorkflowState[]
  isAdmin: boolean
  selectedTransitionId: string | null
  /** Handles are sized in screen pixels, so they stay grabbable at any zoom. */
  zoom: number

  // Dimensions - must match what the line uses or the handles drift off the box
  stateDimensions: Record<string, StateDimensions>

  // Perpendicular shift per transition, keyed by transition id
  parallelOffsets: Record<string, number>

  // Edge positions
  edgePositions: Record<string, EdgePosition>

  // Waypoints
  waypoints: Record<string, Array<{ x: number; y: number }>>

  // Label positions
  labelOffsets: Record<string, { x: number; y: number }>
  pinnedLabelPositions: Record<string, { x: number; y: number }>

  // Dragging states
  draggingTransitionEndpoint: TransitionEndpointDrag | null
  draggingCurveControl: string | null
  draggingWaypointIndex: number | null
  draggingLabel: string | null
  tempCurvePos: { x: number; y: number } | null
  tempLabelPos: { x: number; y: number } | null

  // Hover state
  hoveredWaypoint: { transitionId: string; index: number } | null

  // Refs
  waypointHasDraggedRef: React.MutableRefObject<boolean>

  /** Hand an endpoint over to the shared connection gesture. */
  onStartEndpointDrag: (
    drag: TransitionEndpointDrag & {
      origin: PointWithEdge
      oppositeStateId: string
      pathType: TransitionPathType
    },
    pointer: ConnectionPointer,
  ) => void
  toPointer: (e: React.MouseEvent) => ConnectionPointer

  // Setters
  setFloatingToolbar: (toolbar: FloatingToolbarState | null) => void
  setDraggingCurveControl: (id: string | null) => void
  setDraggingWaypointIndex: (index: number | null) => void
  setDraggingWaypointAxis: (axis: 'x' | 'y' | null) => void
  setTempCurvePos: (pos: { x: number; y: number } | null) => void
  setDraggingLabel: (id: string | null) => void
  setTempLabelPos: (pos: { x: number; y: number } | null) => void
  setHoveredWaypoint: (waypoint: { transitionId: string; index: number } | null) => void
  setWaypoints: React.Dispatch<
    React.SetStateAction<Record<string, Array<{ x: number; y: number }>>>
  >
  setWaypointContextMenu: (menu: WaypointContextMenu | null) => void
  setSelectedTransitionId: (id: string | null) => void
  setSelectedStateId: (id: string | null) => void
  setLabelOffsets: React.Dispatch<React.SetStateAction<Record<string, { x: number; y: number }>>>
  setPinnedLabelPositions: React.Dispatch<
    React.SetStateAction<Record<string, { x: number; y: number }>>
  >

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function TransitionHandles({
  transitions,
  states,
  isAdmin,
  selectedTransitionId,
  zoom,
  stateDimensions,
  parallelOffsets,
  edgePositions,
  waypoints,
  labelOffsets,
  pinnedLabelPositions,
  draggingTransitionEndpoint,
  draggingCurveControl,
  draggingWaypointIndex,
  draggingLabel,
  tempCurvePos,
  tempLabelPos,
  hoveredWaypoint,
  waypointHasDraggedRef,
  onStartEndpointDrag,
  toPointer,
  setFloatingToolbar,
  setDraggingCurveControl,
  setDraggingWaypointIndex,
  setDraggingWaypointAxis,
  setTempCurvePos,
  setDraggingLabel,
  setTempLabelPos,
  setHoveredWaypoint,
  setWaypoints,
  setWaypointContextMenu,
  setSelectedTransitionId,
  setSelectedStateId,
  setLabelOffsets,
  setPinnedLabelPositions,
  addToast,
}: TransitionHandlesProps) {
  if (!isAdmin) return null

  const scale = zoom > 0 ? zoom : 1
  const hitRadius = HANDLE_HIT_RADIUS_PX / scale
  const handleRadius = HANDLE_VISUAL_RADIUS_PX / scale
  const waypointRingRadius = WAYPOINT_HOVER_RING_PX / scale

  return (
    <>
      {transitions.map((transition) => {
        const fromState = states.find((s) => s.id === transition.from_state_id)
        const toState = states.find((s) => s.id === transition.to_state_id)
        if (!fromState || !toState) return null

        const isSelected = selectedTransitionId === transition.id
        const isDraggingThis = draggingTransitionEndpoint?.transitionId === transition.id

        // Only show handles when selected and not currently dragging this transition
        if (!isSelected || isDraggingThis) return null

        const pathType = transition.line_path_type || 'spline'
        const transitionWaypoints = waypoints[transition.id] || []
        const isDraggingThisLabel = draggingLabel === transition.id

        // Derived from the exact same inputs as the rendered line, so the handles
        // always sit on the line rather than near it.
        const geometry = computeTransitionGeometry({
          transitionId: transition.id,
          fromState,
          toState,
          stateDimensions,
          pathType,
          edgePositions,
          waypoints: transitionWaypoints,
          parallelOffset: parallelOffsets[transition.id] ?? 0,
          labelOffset: labelOffsets[transition.id] ?? null,
          pinnedLabelPosition: pinnedLabelPositions[transition.id] ?? null,
          tempLabelPos: isDraggingThisLabel ? tempLabelPos : null,
        })

        const { start: startPoint, end: endPoint, curveMid } = geometry
        const curveMidX = curveMid.x
        const curveMidY = curveMid.y
        const actualLabelX = geometry.labelPos.x
        const actualLabelY = geometry.labelPos.y

        return (
          <g key={`handles-${transition.id}`}>
            {/* Start handle */}
            <g
              transform={`translate(${startPoint.x}, ${startPoint.y})`}
              className="cursor-grab"
              style={{ pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onStartEndpointDrag(
                  {
                    transitionId: transition.id,
                    endpoint: 'start',
                    originalStateId: transition.from_state_id,
                    origin: endPoint,
                    oppositeStateId: transition.to_state_id,
                    pathType,
                  },
                  toPointer(e),
                )
              }}
            >
              <circle r={hitRadius} fill="transparent" />
              <circle
                r={handleRadius}
                fill="#60a5fa"
                stroke="#fff"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
              />
              <title>Drag to reconnect start</title>
            </g>

            {/* Waypoint handles */}
            {transitionWaypoints
              .map((waypoint, index) => {
                const isDraggingThisWaypoint =
                  draggingCurveControl === transition.id && draggingWaypointIndex === index
                const wpX = isDraggingThisWaypoint && tempCurvePos ? tempCurvePos.x : waypoint.x
                const wpY = isDraggingThisWaypoint && tempCurvePos ? tempCurvePos.y : waypoint.y
                const isHovered =
                  hoveredWaypoint?.transitionId === transition.id &&
                  hoveredWaypoint?.index === index
                // Elbow paths: constrain movement to perpendicular axis
                const isElbow = pathType === 'elbow'
                const cursor = isElbow ? 'move' : 'move'
                return {
                  wpX,
                  wpY,
                  index,
                  isDraggingThisWaypoint,
                  isHovered,
                  isVertical: false,
                  freeMove: true,
                  cursor,
                }
              })
              .map(({ wpX, wpY, index, isDraggingThisWaypoint, isHovered, cursor }) => (
                <g
                  key={`waypoint-${index}`}
                  transform={`translate(${wpX}, ${wpY})`}
                  style={{ pointerEvents: 'all', cursor }}
                  onMouseEnter={() => setHoveredWaypoint({ transitionId: transition.id, index })}
                  onMouseLeave={() => setHoveredWaypoint(null)}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    setFloatingToolbar(null)
                    setWaypointContextMenu(null)
                    setDraggingCurveControl(transition.id)
                    setDraggingWaypointIndex(index)
                    setDraggingWaypointAxis(null)
                    setTempCurvePos({ x: wpX, y: wpY })
                    waypointHasDraggedRef.current = false
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    if (!waypointHasDraggedRef.current) {
                      setWaypoints((prev) => {
                        const currentWaypoints = [...(prev[transition.id] || [])]
                        currentWaypoints.splice(index, 1)
                        if (currentWaypoints.length === 0) {
                          const next = { ...prev }
                          delete next[transition.id]
                          return next
                        }
                        return { ...prev, [transition.id]: currentWaypoints }
                      })
                      addToast('info', 'Control point removed')
                    }
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    setWaypointContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      canvasX: wpX,
                      canvasY: wpY,
                      transitionId: transition.id,
                      waypointIndex: index,
                    })
                  }}
                >
                  <circle r={hitRadius} fill="transparent" />
                  {isHovered && !isDraggingThisWaypoint && (
                    <circle
                      r={waypointRingRadius}
                      fill="none"
                      stroke="#60a5fa"
                      strokeWidth="2"
                      opacity="0.4"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <circle
                    r={handleRadius}
                    fill={isDraggingThisWaypoint ? '#60a5fa' : isHovered ? '#f0f0f0' : '#ffffff'}
                    stroke="#60a5fa"
                    strokeWidth={isHovered || isDraggingThisWaypoint ? 2.5 : 2}
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
                  />
                  <title>Drag to adjust • Double-click or right-click to remove</title>
                </g>
              ))}

            {/* Add waypoint hint */}
            {(pathType === 'spline' || pathType === 'elbow') &&
              transitionWaypoints.length === 0 && (
                <g
                  transform={`translate(${curveMidX}, ${curveMidY})`}
                  className="pointer-events-none"
                >
                  <circle
                    r={handleRadius}
                    fill="rgba(255, 255, 255, 0.3)"
                    stroke={`${transition.line_color || '#6b7280'}80`}
                    strokeWidth="2"
                    strokeDasharray="2,2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <title>Double-click or right-click to add control point</title>
                </g>
              )}

            {/* Label handle */}
            {transition.name &&
              (() => {
                const isPinned = !!pinnedLabelPositions[transition.id]
                const textWidth = transition.name.length * 7
                const pinAreaWidth = 18
                const padding = 8
                const totalWidth = textWidth + padding * 2 + pinAreaWidth
                const labelStartX = -totalWidth / 2
                const textCenterX = labelStartX + padding + textWidth / 2
                const pinCenterX = labelStartX + textWidth + padding * 1.5 + pinAreaWidth / 2

                return (
                  <g
                    transform={`translate(${actualLabelX}, ${actualLabelY})`}
                    style={{ pointerEvents: 'all' }}
                  >
                    <rect
                      x={labelStartX}
                      y="-10"
                      width={totalWidth}
                      height="18"
                      rx="4"
                      fill="rgba(31, 41, 55, 0.95)"
                      stroke={
                        isDraggingThisLabel
                          ? '#60a5fa'
                          : isPinned
                            ? 'rgba(96, 165, 250, 0.8)'
                            : 'rgba(96, 165, 250, 0.6)'
                      }
                      strokeWidth={isDraggingThisLabel ? 2 : isPinned ? 1.5 : 1}
                      style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
                      className="cursor-move"
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        setDraggingLabel(transition.id)
                        setTempLabelPos({ x: actualLabelX, y: actualLabelY })
                        setSelectedTransitionId(transition.id)
                        setSelectedStateId(null)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setLabelOffsets((prev) => {
                          const next = { ...prev }
                          delete next[transition.id]
                          return next
                        })
                        setPinnedLabelPositions((prev) => {
                          const next = { ...prev }
                          delete next[transition.id]
                          return next
                        })
                        addToast('info', 'Label position reset')
                      }}
                    />

                    <line
                      x1={pinCenterX - pinAreaWidth / 2 - 1}
                      y1="-6"
                      x2={pinCenterX - pinAreaWidth / 2 - 1}
                      y2="6"
                      stroke="rgba(75, 85, 99, 0.4)"
                      strokeWidth="1"
                    />

                    <text
                      x={textCenterX}
                      y="3"
                      textAnchor="middle"
                      fontSize="10"
                      fill="#d1d5db"
                      className="select-none pointer-events-none"
                    >
                      {transition.name}
                    </text>

                    <g
                      transform={`translate(${pinCenterX}, 0)`}
                      className="cursor-pointer"
                      style={{ pointerEvents: 'all' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isPinned) {
                          setPinnedLabelPositions((prev) => {
                            const next = { ...prev }
                            delete next[transition.id]
                            return next
                          })
                        } else {
                          setPinnedLabelPositions((prev) => ({
                            ...prev,
                            [transition.id]: { x: actualLabelX, y: actualLabelY },
                          }))
                        }
                      }}
                    >
                      <rect
                        x="-7"
                        y="-7"
                        width="14"
                        height="14"
                        rx="2"
                        fill={isPinned ? 'rgba(96, 165, 250, 0.3)' : 'transparent'}
                        className="hover:fill-[rgba(96,165,250,0.2)]"
                      />
                      <g transform="translate(-5, -5) scale(0.42)">
                        <path
                          d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5a.5.5 0 0 0 0-1h-9a.5.5 0 0 0 0 1H8a1 1 0 0 1 1 1z"
                          fill="none"
                          stroke={isPinned ? '#60a5fa' : '#9ca3af'}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                      <title>
                        {isPinned ? 'Unpin (label will follow line)' : 'Pin label to canvas'}
                      </title>
                    </g>

                    <title>Drag to move label (double-click to reset)</title>
                  </g>
                )
              })()}

            {/* End handle */}
            <g
              transform={`translate(${endPoint.x}, ${endPoint.y})`}
              className="cursor-grab"
              style={{ pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onStartEndpointDrag(
                  {
                    transitionId: transition.id,
                    endpoint: 'end',
                    originalStateId: transition.to_state_id,
                    origin: startPoint,
                    oppositeStateId: transition.from_state_id,
                    pathType,
                  },
                  toPointer(e),
                )
              }}
            >
              <circle r={hitRadius} fill="transparent" />
              <circle
                r={handleRadius}
                fill="#22c55e"
                stroke="#fff"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
              />
              <title>Drag to reconnect end</title>
            </g>
          </g>
        )
      })}
    </>
  )
}
