/**
 * WorkflowCanvasContext - canvas interaction state
 *
 * Two kinds of state live here, and the distinction matters:
 *
 * 1. Ephemeral interaction state, held in React state: viewport, selection and
 *    hover, in-flight drags and resizes, transition creation, snap settings. None
 *    of it survives a reload, and none of it should.
 * 2. Diagram layout - node size, transition anchors, waypoints and label
 *    placement. This is *derived* from the loaded rows rather than stored here,
 *    and every setter writes back to both the row and the database. Keeping it
 *    derived means the canvas and the database cannot disagree, which is what
 *    used to happen when layout was React-state-only and vanished on refresh.
 *
 * Dialog visibility, editing entities, and context menus are managed via local
 * useState in WorkflowsViewContent.
 *
 * @example
 * ```tsx
 * <WorkflowCanvasProvider
 *   key={workflow.id}
 *   workflowId={workflow.id}
 *   states={states}
 *   transitions={transitions}
 *   setStates={setStates}
 *   setTransitions={setTransitions}
 * >
 *   <WorkflowCanvas states={states} transitions={transitions} />
 * </WorkflowCanvasProvider>
 * ```
 */
import {
  createContext,
  useContext,
  useState,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
  type RefObject,
} from 'react'

import type { CanvasMode, WorkflowState, WorkflowTransition } from '@/types/workflow'

import { DRAG_THRESHOLD } from '../constants'
import type {
  SnapSettings,
  AlignmentGuides,
  Point,
  EdgePosition,
  EdgePositions,
  StateDimensions,
  ResizingState,
  TransitionEndpointDrag,
  SnappingResult,
} from '../types'

import {
  createConnectionPreviewStore,
  type ConnectionPreviewStore,
} from './connectionPreviewStore'
import { useCanvasViewport } from './useCanvasViewport'
import { useCanvasLayout } from './useCanvasLayout'
import { useCanvasSnapping } from './useCanvasSnapping'

// ==============================================
// Context Value Interface (~60 items vs 200+ in old context)
// ==============================================

export interface WorkflowCanvasContextValue {
  // ---- Canvas State ----
  canvasMode: CanvasMode
  zoom: number
  pan: Point
  canvasRef: RefObject<HTMLDivElement | null>
  /** Ref to the transformable SVG group, used for imperative pan/zoom during gestures */
  groupRef: RefObject<SVGGElement | null>
  /** Always-current viewport values for stable coordinate math inside memoized children */
  viewportRef: RefObject<{ pan: Point; zoom: number }>
  /** Always-current pointer position in canvas coordinates */
  mousePosRef: RefObject<Point>

  setCanvasMode: (mode: CanvasMode) => void
  setZoom: (zoom: number) => void
  setPan: (pan: Point) => void
  handleWheel: (e: React.WheelEvent) => void
  centerOnContent: (states: WorkflowState[]) => void
  screenToCanvas: (screenX: number, screenY: number) => Point
  canvasToScreen: (canvasX: number, canvasY: number) => Point

  // ---- Selection State ----
  selectedStateId: string | null
  selectedTransitionId: string | null
  hoveredStateId: string | null
  hoveredTransitionId: string | null
  hoveredWaypoint: { transitionId: string; index: number } | null

  selectState: (id: string | null) => void
  selectTransition: (id: string | null) => void
  setHoveredStateId: (id: string | null) => void
  setHoveredTransitionId: (id: string | null) => void
  setHoveredWaypoint: (waypoint: { transitionId: string; index: number } | null) => void
  clearSelection: () => void

  // ---- Dragging State ----
  draggingStateId: string | null
  dragOffset: Point
  hasDraggedRef: RefObject<boolean>
  dragStartPosRef: RefObject<Point | null>
  /** Canvas position of the dragged node when the gesture began, for undo. */
  dragOriginRef: RefObject<Point | null>

  setDraggingStateId: (id: string | null) => void
  setDragOffset: (offset: Point) => void
  startDragging: (
    stateId: string,
    offsetX: number,
    offsetY: number,
    clientX: number,
    clientY: number,
    origin: Point,
  ) => void
  stopDragging: () => void
  checkDragThreshold: (clientX: number, clientY: number) => boolean
  markHasDragged: () => void

  // ---- Resizing State ----
  resizingState: ResizingState | null
  stateDimensions: Record<string, StateDimensions>

  setResizingState: (state: ResizingState | null) => void
  startResizing: (
    stateId: string,
    handle: ResizingState['handle'],
    mouseX: number,
    mouseY: number,
    width: number,
    height: number,
  ) => void
  stopResizing: () => void
  getDimensions: (stateId: string) => StateDimensions
  updateDimensions: (stateId: string, dims: StateDimensions) => void

  // ---- Transition Creation ----
  isCreatingTransition: boolean
  transitionStartId: string | null
  /** Where on the origin node the line is pinned, or null while it is free to slide. */
  transitionStartAnchor: EdgePosition | null
  isDraggingToCreateTransition: boolean
  draggingTransitionEndpoint: TransitionEndpointDrag | null
  /** Per-frame state of the line being dragged, kept out of React. */
  connectionPreview: ConnectionPreviewStore

  setIsCreatingTransition: (creating: boolean) => void
  setTransitionStartId: (id: string | null) => void
  setTransitionStartAnchor: (anchor: EdgePosition | null) => void
  setIsDraggingToCreateTransition: (dragging: boolean) => void
  setDraggingTransitionEndpoint: (endpoint: TransitionEndpointDrag | null) => void
  cancelTransitionCreation: () => void

  // ---- Waypoint State ----
  waypoints: Record<string, Point[]>
  draggingCurveControl: string | null
  draggingWaypointIndex: number | null
  draggingWaypointAxis: 'x' | 'y' | null
  tempCurvePos: Point | null
  waypointHasDraggedRef: RefObject<boolean>

  setWaypoints: React.Dispatch<React.SetStateAction<Record<string, Point[]>>>
  setDraggingCurveControl: (transitionId: string | null) => void
  setDraggingWaypointIndex: (index: number | null) => void
  setDraggingWaypointAxis: (axis: 'x' | 'y' | null) => void
  setTempCurvePos: (pos: Point | null) => void
  addWaypoint: (transitionId: string, point: Point, insertIndex?: number) => void
  stopWaypointDrag: () => void

  // ---- Label State ----
  labelOffsets: Record<string, Point>
  pinnedLabelPositions: Record<string, Point>
  draggingLabel: string | null
  tempLabelPos: Point | null

  setLabelOffsets: React.Dispatch<React.SetStateAction<Record<string, Point>>>
  setPinnedLabelPositions: React.Dispatch<React.SetStateAction<Record<string, Point>>>
  setDraggingLabel: (transitionId: string | null) => void
  setTempLabelPos: (pos: Point | null) => void
  stopLabelDrag: () => void

  // ---- Edge Positions ----
  edgePositions: EdgePositions
  setEdgePositions: React.Dispatch<React.SetStateAction<EdgePositions>>
  updateEdgePosition: (
    transitionId: string,
    endpoint: 'start' | 'end',
    position: EdgePosition | null,
  ) => void

  // ---- Snap Settings ----
  snapSettings: SnapSettings
  alignmentGuides: AlignmentGuides

  setSnapSettings: React.Dispatch<React.SetStateAction<SnapSettings>>
  setAlignmentGuides: (guides: AlignmentGuides) => void
  clearAlignmentGuides: () => void
  applySnapping: (stateId: string, x: number, y: number, states: WorkflowState[]) => SnappingResult
}

// ==============================================
// Context Creation
// ==============================================

const WorkflowCanvasContext = createContext<WorkflowCanvasContextValue | null>(null)

// ==============================================
// Provider Props (minimal - no data props needed)
// ==============================================

export interface WorkflowCanvasProviderProps {
  children: ReactNode
  /** Mount the provider with this as its React key so a workflow switch resets the canvas. */
  workflowId?: string
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  onLayoutError: (message: string) => void
}

// ==============================================
// Provider Component
// ==============================================

export function WorkflowCanvasProvider({
  children,
  states,
  transitions,
  setStates,
  setTransitions,
  onLayoutError,
}: WorkflowCanvasProviderProps) {
  // ---- Canvas viewport, diagram layout and snapping ----
  const {
    canvasMode,
    zoom,
    pan,
    canvasRef,
    groupRef,
    viewportRef,
    mousePosRef,
    setCanvasMode,
    setZoom,
    setPan,
    handleWheel,
    centerOnContent,
    screenToCanvas,
    canvasToScreen,
  } = useCanvasViewport()

  const {
    stateDimensions,
    edgePositions,
    waypoints,
    labelOffsets,
    pinnedLabelPositions,
    getDimensions,
    updateDimensions,
    setWaypoints,
    addWaypoint,
    setLabelOffsets,
    setPinnedLabelPositions,
    setEdgePositions,
    updateEdgePosition,
  } = useCanvasLayout({ states, transitions, setStates, setTransitions, onLayoutError })

  const {
    snapSettings,
    alignmentGuides,
    setSnapSettings,
    setAlignmentGuides,
    clearAlignmentGuides,
    applySnapping,
  } = useCanvasSnapping()

  // ---- Selection State ----
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null)
  const [hoveredStateId, setHoveredStateId] = useState<string | null>(null)
  const [hoveredTransitionId, setHoveredTransitionId] = useState<string | null>(null)
  const [hoveredWaypoint, setHoveredWaypoint] = useState<{
    transitionId: string
    index: number
  } | null>(null)

  const selectState = useCallback((id: string | null) => {
    setSelectedStateId(id)
    setSelectedTransitionId(null)
  }, [])

  const selectTransition = useCallback((id: string | null) => {
    setSelectedTransitionId(id)
    setSelectedStateId(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedStateId(null)
    setSelectedTransitionId(null)
  }, [])

  // ---- Dragging State ----
  const [draggingStateId, setDraggingStateId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 })
  const hasDraggedRef = useRef(false)
  const dragStartPosRef = useRef<Point | null>(null)
  const dragOriginRef = useRef<Point | null>(null)

  const startDragging = useCallback(
    (
      stateId: string,
      offsetX: number,
      offsetY: number,
      clientX: number,
      clientY: number,
      origin: Point,
    ) => {
      setDraggingStateId(stateId)
      setDragOffset({ x: offsetX, y: offsetY })
      hasDraggedRef.current = false
      dragStartPosRef.current = { x: clientX, y: clientY }
      dragOriginRef.current = origin
    },
    [],
  )

  const stopDragging = useCallback(() => {
    setDraggingStateId(null)
    hasDraggedRef.current = false
    dragStartPosRef.current = null
    dragOriginRef.current = null
  }, [])

  const checkDragThreshold = useCallback((clientX: number, clientY: number) => {
    if (!dragStartPosRef.current) return false
    const dx = clientX - dragStartPosRef.current.x
    const dy = clientY - dragStartPosRef.current.y
    return Math.hypot(dx, dy) > DRAG_THRESHOLD
  }, [])

  const markHasDragged = useCallback(() => {
    hasDraggedRef.current = true
  }, [])

  // ---- Resizing State ----
  const [resizingState, setResizingState] = useState<ResizingState | null>(null)

  const startResizing = useCallback(
    (
      stateId: string,
      handle: ResizingState['handle'],
      mouseX: number,
      mouseY: number,
      width: number,
      height: number,
    ) => {
      setResizingState({
        stateId,
        handle,
        startMouseX: mouseX,
        startMouseY: mouseY,
        startWidth: width,
        startHeight: height,
      })
    },
    [],
  )

  const stopResizing = useCallback(() => {
    setResizingState(null)
  }, [])

  // ---- Transition Creation ----
  const [isCreatingTransition, setIsCreatingTransition] = useState(false)
  const [transitionStartId, setTransitionStartId] = useState<string | null>(null)
  const [transitionStartAnchor, setTransitionStartAnchor] = useState<EdgePosition | null>(null)
  const [isDraggingToCreateTransition, setIsDraggingToCreateTransition] = useState(false)
  const [draggingTransitionEndpoint, setDraggingTransitionEndpoint] =
    useState<TransitionEndpointDrag | null>(null)
  const connectionPreview = useRef(createConnectionPreviewStore()).current

  const cancelTransitionCreation = useCallback(() => {
    setIsCreatingTransition(false)
    setTransitionStartId(null)
    setTransitionStartAnchor(null)
    setIsDraggingToCreateTransition(false)
    setDraggingTransitionEndpoint(null)
    setHoveredStateId(null)
    connectionPreview.set(null)
  }, [connectionPreview])

  // ---- Waypoint State ----
  const [draggingCurveControl, setDraggingCurveControl] = useState<string | null>(null)
  const [draggingWaypointIndex, setDraggingWaypointIndex] = useState<number | null>(null)
  const [draggingWaypointAxis, setDraggingWaypointAxis] = useState<'x' | 'y' | null>(null)
  const [tempCurvePos, setTempCurvePos] = useState<Point | null>(null)
  const waypointHasDraggedRef = useRef(false)

  const stopWaypointDrag = useCallback(() => {
    setDraggingCurveControl(null)
    setDraggingWaypointIndex(null)
    setDraggingWaypointAxis(null)
    setTempCurvePos(null)
    waypointHasDraggedRef.current = false
  }, [])

  // ---- Label State ----
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null)
  const [tempLabelPos, setTempLabelPos] = useState<Point | null>(null)

  const stopLabelDrag = useCallback(() => {
    setDraggingLabel(null)
    setTempLabelPos(null)
  }, [])

  // ---- Build context value ----
  const value = useMemo<WorkflowCanvasContextValue>(
    () => ({
      // Canvas
      canvasMode,
      zoom,
      pan,
      canvasRef,
      groupRef,
      viewportRef,
      mousePosRef,
      setCanvasMode,
      setZoom,
      setPan,
      handleWheel,
      centerOnContent,
      screenToCanvas,
      canvasToScreen,

      // Selection
      selectedStateId,
      selectedTransitionId,
      hoveredStateId,
      hoveredTransitionId,
      hoveredWaypoint,
      selectState,
      selectTransition,
      setHoveredStateId,
      setHoveredTransitionId,
      setHoveredWaypoint,
      clearSelection,

      // Dragging
      draggingStateId,
      dragOffset,
      hasDraggedRef,
      dragStartPosRef,
      dragOriginRef,
      setDraggingStateId,
      setDragOffset,
      startDragging,
      stopDragging,
      checkDragThreshold,
      markHasDragged,

      // Resizing
      resizingState,
      stateDimensions,
      setResizingState,
      startResizing,
      stopResizing,
      getDimensions,
      updateDimensions,

      // Transition Creation
      isCreatingTransition,
      transitionStartId,
      transitionStartAnchor,
      isDraggingToCreateTransition,
      draggingTransitionEndpoint,
      connectionPreview,
      setIsCreatingTransition,
      setTransitionStartId,
      setTransitionStartAnchor,
      setIsDraggingToCreateTransition,
      setDraggingTransitionEndpoint,
      cancelTransitionCreation,

      // Waypoints
      waypoints,
      draggingCurveControl,
      draggingWaypointIndex,
      draggingWaypointAxis,
      tempCurvePos,
      waypointHasDraggedRef,
      setWaypoints,
      setDraggingCurveControl,
      setDraggingWaypointIndex,
      setDraggingWaypointAxis,
      setTempCurvePos,
      addWaypoint,
      stopWaypointDrag,

      // Labels
      labelOffsets,
      pinnedLabelPositions,
      draggingLabel,
      tempLabelPos,
      setLabelOffsets,
      setPinnedLabelPositions,
      setDraggingLabel,
      setTempLabelPos,
      stopLabelDrag,

      // Edge Positions
      edgePositions,
      setEdgePositions,
      updateEdgePosition,

      // Snap Settings
      snapSettings,
      alignmentGuides,
      setSnapSettings,
      setAlignmentGuides,
      clearAlignmentGuides,
      applySnapping,
    }),
    [
      // Canvas
      canvasRef,
      groupRef,
      viewportRef,
      mousePosRef,
      setCanvasMode,
      setZoom,
      setPan,
      canvasMode,
      zoom,
      pan,
      handleWheel,
      centerOnContent,
      screenToCanvas,
      canvasToScreen,
      // Selection
      selectedStateId,
      selectedTransitionId,
      hoveredStateId,
      hoveredTransitionId,
      hoveredWaypoint,
      selectState,
      selectTransition,
      clearSelection,
      // Dragging
      draggingStateId,
      dragOffset,
      startDragging,
      stopDragging,
      checkDragThreshold,
      markHasDragged,
      // Resizing
      resizingState,
      stateDimensions,
      startResizing,
      stopResizing,
      getDimensions,
      updateDimensions,
      // Transition Creation
      isCreatingTransition,
      transitionStartId,
      transitionStartAnchor,
      isDraggingToCreateTransition,
      draggingTransitionEndpoint,
      connectionPreview,
      cancelTransitionCreation,
      // Waypoints
      waypoints,
      draggingCurveControl,
      draggingWaypointIndex,
      draggingWaypointAxis,
      tempCurvePos,
      setWaypoints,
      addWaypoint,
      stopWaypointDrag,
      // Labels
      labelOffsets,
      pinnedLabelPositions,
      draggingLabel,
      tempLabelPos,
      setLabelOffsets,
      setPinnedLabelPositions,
      stopLabelDrag,
      // Edge Positions
      edgePositions,
      setEdgePositions,
      updateEdgePosition,
      // Snap Settings
      snapSettings,
      alignmentGuides,
      setSnapSettings,
      setAlignmentGuides,
      clearAlignmentGuides,
      applySnapping,
    ],
  )

  return <WorkflowCanvasContext.Provider value={value}>{children}</WorkflowCanvasContext.Provider>
}

// ==============================================
// Hook
// ==============================================

export function useWorkflowCanvasContext() {
  const context = useContext(WorkflowCanvasContext)
  if (!context) {
    throw new Error('useWorkflowCanvasContext must be used within WorkflowCanvasProvider')
  }
  return context
}

export { WorkflowCanvasContext }
