/**
 * WorkflowCanvas - SVG canvas for rendering workflow states and transitions
 *
 * Extracted from WorkflowsView to reduce complexity.
 * Handles rendering of grid, alignment guides, transitions, and state nodes.
 */
import { useCallback, useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import type {
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
  CanvasMode,
  TransitionPathType,
  TransitionLineStyle,
  TransitionArrowHead,
  TransitionLineThickness,
} from '@/types/workflow'
import type { ConnectionPreviewStore } from '../context/connectionPreviewStore'
import type { ConnectionPointer } from '../hooks/useConnectionGesture'
import type {
  EdgePosition,
  Point,
  PointWithEdge,
  SnapSettings,
  AlignmentGuides,
  EdgePositions,
  FloatingToolbarState,
  TransitionEndpointDrag,
} from '../types'
import { DEFAULT_LINE_COLOR } from '../constants'
import { lightenColor, computeParallelOffsets } from '../utils'
import { ConnectionPortsLayer } from './ConnectionPortsLayer'
import { ConnectionPreviewLayer } from './ConnectionPreviewLayer'
import { StateNode } from './StateNode'
import { TransitionLine } from './TransitionLine'
import { TransitionHandles } from './TransitionHandles'
import { GridPattern } from './GridPattern'
import { FloatingToolbar } from './toolbar'

interface WorkflowCanvasProps {
  // Core data
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>

  // Selection state
  selectedStateId: string | null
  selectedTransitionId: string | null
  hoveredStateId: string | null
  hoveredTransitionId: string | null
  hoveredWaypoint: { transitionId: string; index: number } | null

  // Canvas state
  canvasMode: CanvasMode
  zoom: number
  pan: Point
  canvasRef: React.RefObject<HTMLDivElement | null>
  groupRef: React.RefObject<SVGGElement | null>
  viewportRef: React.RefObject<{ pan: Point; zoom: number }>
  canvasTransform: string

  // Permissions
  isAdmin: boolean

  // Dragging state
  draggingStateId: string | null
  currentResizing: { stateId: string } | null

  // Transition creation
  isCreatingTransition: boolean
  transitionStartId: string | null
  draggingTransitionEndpoint: TransitionEndpointDrag | null
  connectionPreview: ConnectionPreviewStore
  hasDraggedRef: React.MutableRefObject<boolean>

  // Dimensions
  stateDimensions: Record<string, { width: number; height: number }>
  getDimensions: (stateId: string) => { width: number; height: number }

  // Snap/alignment
  snapSettings: SnapSettings
  alignmentGuides: AlignmentGuides

  // Waypoints/edges
  waypoints: Record<string, Point[]>
  edgePositions: EdgePositions
  draggingCurveControl: string | null
  draggingWaypointIndex: number | null
  tempCurvePos: Point | null
  waypointHasDraggedRef: React.MutableRefObject<boolean>

  // Labels
  labelOffsets: Record<string, Point>
  pinnedLabelPositions: Record<string, Point>
  draggingLabel: string | null
  tempLabelPos: Point | null

  // Floating toolbar
  floatingToolbar: FloatingToolbarState | null
  toolbarActions: {
    handleColorChange: (color: string) => void | Promise<void>
    handleLineStyleChange: (style: TransitionLineStyle) => void | Promise<void>
    handlePathTypeChange: (pathType: TransitionPathType) => void | Promise<void>
    handleArrowHeadChange: (arrowHead: TransitionArrowHead) => void | Promise<void>
    handleThicknessChange: (thickness: TransitionLineThickness) => void | Promise<void>
    handleFillOpacityChange: (opacity: number) => void | Promise<void>
    handleBorderColorChange: (color: string | null) => void | Promise<void>
    handleBorderOpacityChange: (opacity: number) => void | Promise<void>
    handleBorderThicknessChange: (thickness: number) => void | Promise<void>
    handleCornerRadiusChange: (radius: number) => void | Promise<void>
    handleShapeChange: (
      shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse',
    ) => void | Promise<void>
    handleEdit: () => void
    handleDuplicate: () => void | Promise<void>
    handleDelete: () => void | Promise<void>
    handleAddGate: () => void | Promise<void>
    handleClose: () => void
  }

  // Event handlers
  onCanvasMouseDown: (e: React.PointerEvent) => void
  onCanvasClick: (e: React.MouseEvent) => void
  onCanvasContextMenu: (e: React.MouseEvent) => void
  onWheel: (e: React.WheelEvent) => void

  // State handlers
  onSelectState: (stateId: string | null) => void
  onSelectTransition: (transitionId: string | null) => void
  onStartDrag: (stateId: string, e: React.MouseEvent) => void
  onStartResize: (stateId: string, handle: string, e: React.MouseEvent) => void
  onStartConnection: (
    stateId: string,
    anchor: EdgePosition | null,
    pointer: ConnectionPointer,
  ) => void
  onStartEndpointDrag: (
    drag: TransitionEndpointDrag & {
      origin: PointWithEdge
      oppositeStateId: string
      pathType: TransitionPathType
    },
    pointer: ConnectionPointer,
  ) => void
  onEditState: (state: WorkflowState) => void
  onHoverState: (stateId: string | null) => void
  onShowStateToolbar: (stateId: string) => void
  onShowTransitionToolbar: (transitionId: string, canvasX: number, canvasY: number) => void
  onShowTransitionContextMenu: (
    transitionId: string,
    clientX: number,
    clientY: number,
    canvasX: number,
    canvasY: number,
  ) => void
  onAddWaypointToTransition: (
    transitionId: string,
    x: number,
    y: number,
    pathType: string,
    startEdge: string,
    endEdge: string,
  ) => void

  // Setters
  setHoveredTransitionId: (id: string | null) => void
  setFloatingToolbar: (data: FloatingToolbarState | null) => void
  setDraggingCurveControl: (id: string | null) => void
  setDraggingWaypointIndex: (index: number | null) => void
  setDraggingWaypointAxis: (axis: 'x' | 'y' | null) => void
  setTempCurvePos: (pos: Point | null) => void
  setDraggingLabel: (id: string | null) => void
  setTempLabelPos: (pos: Point | null) => void
  setHoveredWaypoint: (value: { transitionId: string; index: number } | null) => void
  setWaypoints: React.Dispatch<React.SetStateAction<Record<string, Point[]>>>
  setWaypointContextMenu: (
    menu: {
      x: number
      y: number
      canvasX: number
      canvasY: number
      transitionId: string
      waypointIndex: number | null
    } | null,
  ) => void
  setLabelOffsets: React.Dispatch<React.SetStateAction<Record<string, Point>>>
  setPinnedLabelPositions: React.Dispatch<React.SetStateAction<Record<string, Point>>>

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function WorkflowCanvas({
  states,
  transitions,
  gates,
  selectedStateId,
  selectedTransitionId,
  hoveredStateId,
  hoveredTransitionId,
  hoveredWaypoint,
  canvasMode,
  zoom,
  pan,
  canvasRef,
  groupRef,
  viewportRef,
  canvasTransform,
  isAdmin,
  draggingStateId,
  currentResizing,
  isCreatingTransition,
  transitionStartId,
  draggingTransitionEndpoint,
  connectionPreview,
  hasDraggedRef,
  stateDimensions,
  getDimensions,
  snapSettings,
  alignmentGuides,
  waypoints,
  edgePositions,
  draggingCurveControl,
  draggingWaypointIndex,
  tempCurvePos,
  waypointHasDraggedRef,
  labelOffsets,
  pinnedLabelPositions,
  draggingLabel,
  tempLabelPos,
  floatingToolbar,
  toolbarActions,
  onCanvasMouseDown,
  onCanvasClick,
  onCanvasContextMenu,
  onShowTransitionContextMenu,
  onWheel,
  onSelectState,
  onSelectTransition,
  onStartDrag,
  onStartResize,
  onStartConnection,
  onStartEndpointDrag,
  onEditState,
  onHoverState,
  onShowStateToolbar,
  onShowTransitionToolbar,
  onAddWaypointToTransition,
  setHoveredTransitionId,
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
  setLabelOffsets,
  setPinnedLabelPositions,
  addToast,
}: WorkflowCanvasProps) {
  const parallelOffsets = useMemo(() => computeParallelOffsets(transitions), [transitions])

  // One <marker> set per transition, rebuilt only when a line colour changes -
  // this used to be reconciled on every frame of a drag.
  const transitionMarkers = useMemo(
    () => transitions.map((t) => ({ id: t.id, color: t.line_color || DEFAULT_LINE_COLOR })),
    [transitions],
  )

  const toPointer = useCallback(
    (e: React.MouseEvent): ConnectionPointer => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const { pan: livePan, zoom: liveZoom } = viewportRef.current ?? { pan, zoom }
      return {
        cursor: rect
          ? {
              x: (e.clientX - rect.left - livePan.x) / liveZoom,
              y: (e.clientY - rect.top - livePan.y) / liveZoom,
            }
          : { x: 0, y: 0 },
        clientX: e.clientX,
        clientY: e.clientY,
        altKey: e.altKey,
      }
    },
    [canvasRef, viewportRef, pan, zoom],
  )

  return (
    <div
      ref={canvasRef}
      className="flex-1 relative overflow-hidden bg-plm-bg"
      style={{
        cursor:
          canvasMode === 'pan'
            ? draggingStateId === '_panning_'
              ? 'grabbing'
              : 'grab'
            : canvasMode === 'connect'
              ? 'crosshair'
              : 'default',
        touchAction: 'none',
      }}
      onPointerDown={onCanvasMouseDown}
      onClick={onCanvasClick}
      onContextMenu={onCanvasContextMenu}
      onWheel={onWheel}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
        shapeRendering="geometricPrecision"
      >
        {/* Arrow marker definitions */}
        <defs>
          <marker
            id="arrowhead-selected"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
          </marker>
          <marker
            id="arrowhead-start-selected"
            markerWidth="10"
            markerHeight="7"
            refX="1"
            refY="3.5"
            orient="auto"
          >
            <polygon points="10 0, 0 3.5, 10 7" fill="#60a5fa" />
          </marker>
          <marker
            id="arrowhead-creating"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
          </marker>

          {/* Per-transition markers for custom colors */}
          {transitionMarkers.map((t) => {
            const color = t.color
            const hoverColor = lightenColor(color, 0.35)
            return (
              <g key={`markers-${t.id}`}>
                <marker
                  id={`arrowhead-${t.id}`}
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill={color} />
                </marker>
                <marker
                  id={`arrowhead-start-${t.id}`}
                  markerWidth="10"
                  markerHeight="7"
                  refX="1"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="10 0, 0 3.5, 10 7" fill={color} />
                </marker>
                <marker
                  id={`arrowhead-hover-${t.id}`}
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill={hoverColor} />
                </marker>
                <marker
                  id={`arrowhead-start-hover-${t.id}`}
                  markerWidth="10"
                  markerHeight="7"
                  refX="1"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="10 0, 0 3.5, 10 7" fill={hoverColor} />
                </marker>
              </g>
            )
          })}
        </defs>

        {/* Transformable canvas group */}
        <g
          ref={groupRef}
          transform={canvasTransform}
          style={{
            willChange: 'transform',
            // While panning, the transform is updated imperatively; suppress
            // hover events so an incidental re-render can't snap it back.
            pointerEvents: draggingStateId === '_panning_' ? 'none' : undefined,
          }}
        >
          {/* Grid pattern when snap to grid enabled */}
          <GridPattern snapSettings={snapSettings} />

          {/* Alignment guides */}
          {alignmentGuides.vertical !== null && (
            <line
              x1={alignmentGuides.vertical}
              y1={-10000}
              x2={alignmentGuides.vertical}
              y2={10000}
              stroke="#60a5fa"
              strokeWidth={1}
              strokeDasharray="4,4"
              className="pointer-events-none"
            />
          )}
          {alignmentGuides.horizontal !== null && (
            <line
              x1={-10000}
              y1={alignmentGuides.horizontal}
              x2={10000}
              y2={alignmentGuides.horizontal}
              stroke="#60a5fa"
              strokeWidth={1}
              strokeDasharray="4,4"
              className="pointer-events-none"
            />
          )}

          {/* Transitions */}
          {transitions.map((transition) => {
            const fromState = states.find((s) => s.id === transition.from_state_id)
            const toState = states.find((s) => s.id === transition.to_state_id)
            if (!fromState || !toState) return null

            const transitionGates = gates[transition.id] || []
            const transitionWaypoints = waypoints[transition.id] || []
            const isDraggingThis = draggingTransitionEndpoint?.transitionId === transition.id

            return (
              <TransitionLine
                key={transition.id}
                transition={transition}
                states={states}
                gates={transitionGates}
                parallelOffset={parallelOffsets[transition.id] ?? 0}
                isSelected={selectedTransitionId === transition.id}
                isDragging={isDraggingThis}
                hoveredTransitionId={hoveredTransitionId}
                isAdmin={isAdmin}
                stateDimensions={stateDimensions}
                edgePositions={edgePositions}
                waypoints={transitionWaypoints}
                labelOffset={labelOffsets[transition.id] || null}
                pinnedLabelPosition={pinnedLabelPositions[transition.id] || null}
                draggingCurveControl={draggingCurveControl}
                draggingWaypointIndex={draggingWaypointIndex}
                tempCurvePos={tempCurvePos}
                draggingLabel={draggingLabel}
                tempLabelPos={tempLabelPos}
                viewportRef={viewportRef}
                canvasRef={canvasRef}
                onSelect={() => onSelectTransition(transition.id)}
                onHoverChange={(hovered) => setHoveredTransitionId(hovered ? transition.id : null)}
                onShowToolbar={(canvasX, canvasY) =>
                  onShowTransitionToolbar(transition.id, canvasX, canvasY)
                }
                onAddWaypoint={(clickX, clickY, pathType, startEdge, endEdge) => {
                  onAddWaypointToTransition(
                    transition.id,
                    clickX,
                    clickY,
                    pathType,
                    startEdge,
                    endEdge,
                  )
                }}
                onShowContextMenu={(clientX, clientY, clickX, clickY) => {
                  onShowTransitionContextMenu(transition.id, clientX, clientY, clickX, clickY)
                }}
                addToast={addToast}
              />
            )
          })}

          {/* Transition handles (when selected) */}
          <TransitionHandles
            transitions={transitions}
            states={states}
            isAdmin={isAdmin}
            selectedTransitionId={selectedTransitionId}
            zoom={zoom}
            stateDimensions={stateDimensions}
            parallelOffsets={parallelOffsets}
            edgePositions={edgePositions}
            waypoints={waypoints}
            labelOffsets={labelOffsets}
            pinnedLabelPositions={pinnedLabelPositions}
            draggingTransitionEndpoint={draggingTransitionEndpoint}
            draggingCurveControl={draggingCurveControl}
            draggingWaypointIndex={draggingWaypointIndex}
            draggingLabel={draggingLabel}
            tempCurvePos={tempCurvePos}
            tempLabelPos={tempLabelPos}
            hoveredWaypoint={hoveredWaypoint}
            waypointHasDraggedRef={waypointHasDraggedRef}
            onStartEndpointDrag={onStartEndpointDrag}
            toPointer={toPointer}
            setFloatingToolbar={setFloatingToolbar}
            setDraggingCurveControl={setDraggingCurveControl}
            setDraggingWaypointIndex={setDraggingWaypointIndex}
            setDraggingWaypointAxis={setDraggingWaypointAxis}
            setTempCurvePos={setTempCurvePos}
            setDraggingLabel={setDraggingLabel}
            setTempLabelPos={setTempLabelPos}
            setHoveredWaypoint={setHoveredWaypoint}
            setWaypoints={setWaypoints}
            setWaypointContextMenu={setWaypointContextMenu}
            setSelectedTransitionId={onSelectTransition}
            setSelectedStateId={onSelectState}
            setLabelOffsets={setLabelOffsets}
            setPinnedLabelPositions={setPinnedLabelPositions}
            addToast={addToast}
          />

          {/* State nodes */}
          {states.map((state) => (
            <StateNode
              key={state.id}
              state={state}
              isSelected={selectedStateId === state.id}
              isTransitionStart={transitionStartId === state.id}
              isDragging={draggingStateId === state.id}
              isResizing={currentResizing?.stateId === state.id}
              isHovered={hoveredStateId === state.id}
              isAdmin={isAdmin}
              canvasMode={canvasMode}
              isCreatingTransition={isCreatingTransition}
              dimensions={getDimensions(state.id)}
              canvasRef={canvasRef}
              hasDraggedRef={hasDraggedRef}
              onSelect={() => onSelectState(state.id)}
              onStartDrag={(e) => onStartDrag(state.id, e)}
              onStartResize={(handle, e) => onStartResize(state.id, handle, e)}
              onStartConnection={(e) => onStartConnection(state.id, null, toPointer(e))}
              onEdit={() => onEditState(state)}
              onHoverChange={(hovered) => {
                if (hovered) {
                  onHoverState(state.id)
                } else if (hoveredStateId === state.id) {
                  onHoverState(null)
                }
              }}
              onShowToolbar={() => onShowStateToolbar(state.id)}
            />
          ))}

          {/* Connection ports, above the nodes so an overlapped one stays grabbable */}
          <ConnectionPortsLayer
            states={states}
            stateDimensions={stateDimensions}
            zoom={zoom}
            isAdmin={isAdmin}
            canvasMode={canvasMode}
            selectedStateId={selectedStateId}
            hoveredStateId={hoveredStateId}
            isCreatingTransition={isCreatingTransition}
            onStartConnection={(stateId, anchor, e) => onStartConnection(stateId, anchor, toPointer(e))}
          />

          {/* The line being drawn, and the node it is about to land on */}
          <ConnectionPreviewLayer store={connectionPreview} zoom={zoom} />
        </g>
      </svg>

      {/* Empty state message */}
      {states.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-plm-fg-muted pointer-events-none">
          <div className="text-center">
            <GitBranch size={48} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No states defined. Click "Add State" to add your first state.</p>
          </div>
        </div>
      )}

      {/* Floating toolbar */}
      {floatingToolbar &&
        (() => {
          const targetState =
            floatingToolbar.type === 'state'
              ? states.find((s) => s.id === floatingToolbar.targetId)
              : undefined
          const targetTransition =
            floatingToolbar.type === 'transition'
              ? transitions.find((t) => t.id === floatingToolbar.targetId)
              : undefined

          // Convert canvas coordinates to screen coordinates
          const rect = canvasRef.current?.getBoundingClientRect()
          const screenX = rect
            ? rect.left + pan.x + floatingToolbar.canvasX * zoom
            : floatingToolbar.canvasX
          const screenY = rect
            ? rect.top + pan.y + floatingToolbar.canvasY * zoom
            : floatingToolbar.canvasY

          return (
            <FloatingToolbar
              x={screenX}
              y={screenY}
              type={floatingToolbar.type}
              isAdmin={isAdmin}
              targetState={targetState}
              targetTransition={targetTransition}
              onColorChange={toolbarActions.handleColorChange}
              onLineStyleChange={toolbarActions.handleLineStyleChange}
              onPathTypeChange={toolbarActions.handlePathTypeChange}
              onArrowHeadChange={toolbarActions.handleArrowHeadChange}
              onThicknessChange={toolbarActions.handleThicknessChange}
              onFillOpacityChange={toolbarActions.handleFillOpacityChange}
              onBorderColorChange={toolbarActions.handleBorderColorChange}
              onBorderOpacityChange={toolbarActions.handleBorderOpacityChange}
              onBorderThicknessChange={toolbarActions.handleBorderThicknessChange}
              onCornerRadiusChange={toolbarActions.handleCornerRadiusChange}
              onShapeChange={toolbarActions.handleShapeChange}
              onEdit={toolbarActions.handleEdit}
              onDuplicate={toolbarActions.handleDuplicate}
              onDelete={toolbarActions.handleDelete}
              onAddGate={toolbarActions.handleAddGate}
              onClose={toolbarActions.handleClose}
            />
          )
        })()}
    </div>
  )
}
