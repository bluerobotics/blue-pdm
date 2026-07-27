/**
 * WorkflowCanvasContext - Slim canvas interaction state
 *
 * This context provides ONLY canvas-specific ephemeral state:
 * - Viewport (zoom, pan, canvasRef)
 * - Selection and hover states (selectedStateId, hoveredStateId, etc.)
 * - Drag and resize operations (draggingStateId, resizingState, etc.)
 * - Transition creation (isCreatingTransition, transitionStartId, etc.)
 * - Waypoints and labels (waypoints, labelOffsets, pinnedLabelPositions)
 * - Snap settings (snapSettings, alignmentGuides)
 *
 * Dialog visibility, editing entities, and context menus are
 * managed via local useState in WorkflowsViewContent.
 *
 * Core data (workflows, states, transitions) comes from props
 * via the useWorkflowData hook.
 *
 * @example
 * ```tsx
 * <WorkflowCanvasProvider workflowId={workflow.id}>
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
  useEffect,
  type ReactNode,
  type RefObject,
} from 'react'
import { MIN_ZOOM, MAX_ZOOM } from '../constants'
import type {
  CanvasMode,
  SnapSettings,
  AlignmentGuides,
  Point,
  EdgePosition,
  StateDimensions,
  ResizingState,
  TransitionEndpointDrag,
  SnappingResult,
  WorkflowState,
} from '../types'

// ==============================================
// Context Value Interface (~60 items vs 200+ in old context)
// ==============================================

export interface WorkflowCanvasContextValue {
  // ---- Canvas State ----
  canvasMode: CanvasMode
  zoom: number
  pan: Point
  mousePos: Point
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
  setMousePos: (pos: Point) => void
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

  setDraggingStateId: (id: string | null) => void
  setDragOffset: (offset: Point) => void
  startDragging: (
    stateId: string,
    offsetX: number,
    offsetY: number,
    clientX: number,
    clientY: number,
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
  isDraggingToCreateTransition: boolean
  draggingTransitionEndpoint: TransitionEndpointDrag | null
  justCompletedTransitionRef: RefObject<boolean>
  transitionCompletedAtRef: RefObject<number>

  setIsCreatingTransition: (creating: boolean) => void
  setTransitionStartId: (id: string | null) => void
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
  edgePositions: Record<string, EdgePosition>
  setEdgePositions: React.Dispatch<React.SetStateAction<Record<string, EdgePosition>>>
  updateEdgePosition: (
    transitionId: string,
    endpoint: 'start' | 'end',
    position: EdgePosition,
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
  /** Workflow ID for localStorage persistence */
  workflowId?: string
}

// ==============================================
// Constants
// ==============================================

const DEFAULT_STATE_WIDTH = 120
const DEFAULT_STATE_HEIGHT = 50
const DRAG_THRESHOLD = 5

// Stable default dimensions object so memoized nodes that have no custom size
// receive a referentially-stable `dimensions` prop across renders.
const DEFAULT_DIMENSIONS: StateDimensions = {
  width: DEFAULT_STATE_WIDTH,
  height: DEFAULT_STATE_HEIGHT,
}

// ==============================================
// Provider Component
// ==============================================

export function WorkflowCanvasProvider({
  children,
  workflowId: _workflowId,
}: WorkflowCanvasProviderProps) {
  // ---- Canvas State ----
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('select')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<SVGGElement>(null)

  // Keep always-current viewport + pointer values so memoized children can do
  // coordinate math via refs without re-rendering on every pan/zoom/move.
  const viewportRef = useRef<{ pan: Point; zoom: number }>({ pan, zoom })
  viewportRef.current = { pan, zoom }
  const mousePosRef = useRef<Point>(mousePos)

  // ---- Spacebar-to-pan (hold space to temporarily pan, like Figma) ----
  // Keep a ref to the latest mode so the keydown listener can restore it on release
  const canvasModeRef = useRef(canvasMode)
  canvasModeRef.current = canvasMode
  const isSpacePanningRef = useRef(false)
  const preSpacePanModeRef = useRef<CanvasMode>('select')

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        el.isContentEditable
      )
    }

    const startSpacePan = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (isEditableTarget(document.activeElement)) return
      e.preventDefault()
      if (isSpacePanningRef.current) return
      isSpacePanningRef.current = true
      preSpacePanModeRef.current = canvasModeRef.current
      setCanvasMode('pan')
    }

    const endSpacePan = () => {
      if (!isSpacePanningRef.current) return
      isSpacePanningRef.current = false
      setCanvasMode(preSpacePanModeRef.current)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      endSpacePan()
    }

    window.addEventListener('keydown', startSpacePan)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', endSpacePan)
    return () => {
      window.removeEventListener('keydown', startSpacePan)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', endSpacePan)
    }
  }, [])

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

  const startDragging = useCallback(
    (stateId: string, offsetX: number, offsetY: number, clientX: number, clientY: number) => {
      setDraggingStateId(stateId)
      setDragOffset({ x: offsetX, y: offsetY })
      hasDraggedRef.current = false
      dragStartPosRef.current = { x: clientX, y: clientY }
    },
    [],
  )

  const stopDragging = useCallback(() => {
    setDraggingStateId(null)
    hasDraggedRef.current = false
    dragStartPosRef.current = null
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
  const [stateDimensions, setStateDimensions] = useState<Record<string, StateDimensions>>({})

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

  const getDimensions = useCallback(
    (stateId: string): StateDimensions => {
      return stateDimensions[stateId] || DEFAULT_DIMENSIONS
    },
    [stateDimensions],
  )

  const updateDimensions = useCallback((stateId: string, dims: StateDimensions) => {
    setStateDimensions((prev) => ({ ...prev, [stateId]: dims }))
  }, [])

  // ---- Transition Creation ----
  const [isCreatingTransition, setIsCreatingTransition] = useState(false)
  const [transitionStartId, setTransitionStartId] = useState<string | null>(null)
  const [isDraggingToCreateTransition, setIsDraggingToCreateTransition] = useState(false)
  const [draggingTransitionEndpoint, setDraggingTransitionEndpoint] =
    useState<TransitionEndpointDrag | null>(null)
  const justCompletedTransitionRef = useRef(false)
  const transitionCompletedAtRef = useRef(0)

  const cancelTransitionCreation = useCallback(() => {
    setIsCreatingTransition(false)
    setTransitionStartId(null)
    setIsDraggingToCreateTransition(false)
    setHoveredStateId(null)
  }, [])

  // ---- Waypoint State ----
  const [waypoints, setWaypoints] = useState<Record<string, Point[]>>({})
  const [draggingCurveControl, setDraggingCurveControl] = useState<string | null>(null)
  const [draggingWaypointIndex, setDraggingWaypointIndex] = useState<number | null>(null)
  const [draggingWaypointAxis, setDraggingWaypointAxis] = useState<'x' | 'y' | null>(null)
  const [tempCurvePos, setTempCurvePos] = useState<Point | null>(null)
  const waypointHasDraggedRef = useRef(false)

  const addWaypoint = useCallback((transitionId: string, point: Point, insertIndex?: number) => {
    setWaypoints((prev) => {
      const current = prev[transitionId] || []
      const newWaypoints = [...current]
      if (insertIndex !== undefined) {
        newWaypoints.splice(insertIndex, 0, point)
      } else {
        newWaypoints.push(point)
      }
      return { ...prev, [transitionId]: newWaypoints }
    })
  }, [])

  const stopWaypointDrag = useCallback(() => {
    setDraggingCurveControl(null)
    setDraggingWaypointIndex(null)
    setDraggingWaypointAxis(null)
    setTempCurvePos(null)
    waypointHasDraggedRef.current = false
  }, [])

  // ---- Label State ----
  const [labelOffsets, setLabelOffsets] = useState<Record<string, Point>>({})
  const [pinnedLabelPositions, setPinnedLabelPositions] = useState<Record<string, Point>>({})
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null)
  const [tempLabelPos, setTempLabelPos] = useState<Point | null>(null)

  const stopLabelDrag = useCallback(() => {
    setDraggingLabel(null)
    setTempLabelPos(null)
  }, [])

  // ---- Edge Positions ----
  const [edgePositions, setEdgePositions] = useState<Record<string, EdgePosition>>({})

  const updateEdgePosition = useCallback(
    (transitionId: string, endpoint: 'start' | 'end', position: EdgePosition) => {
      const key = `${transitionId}-${endpoint}`
      setEdgePositions((prev) => ({
        ...prev,
        [key]: position,
      }))
    },
    [],
  )

  // ---- Snap Settings ----
  const [snapSettings, setSnapSettings] = useState<SnapSettings>({
    gridSize: 20,
    snapToGrid: false,
    snapToAlignment: true,
    alignmentThreshold: 8,
  })
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({
    vertical: null,
    horizontal: null,
  })

  const clearAlignmentGuides = useCallback(() => {
    setAlignmentGuides({ vertical: null, horizontal: null })
  }, [])

  // Snapping function - now takes states as parameter instead of from context
  const applySnapping = useCallback(
    (
      currentStateId: string,
      rawX: number,
      rawY: number,
      states: WorkflowState[],
    ): SnappingResult => {
      let x = rawX
      let y = rawY
      let verticalGuide: number | null = null
      let horizontalGuide: number | null = null

      if (snapSettings.snapToGrid) {
        const gridSize = snapSettings.gridSize
        x = Math.round(x / gridSize) * gridSize
        y = Math.round(y / gridSize) * gridSize
      }

      if (snapSettings.snapToAlignment) {
        const threshold = snapSettings.alignmentThreshold

        for (const state of states) {
          if (state.id === currentStateId) continue

          if (Math.abs(state.position_x - x) <= threshold) {
            x = state.position_x
            verticalGuide = state.position_x
          }

          if (Math.abs(state.position_y - y) <= threshold) {
            y = state.position_y
            horizontalGuide = state.position_y
          }
        }
      }

      return { x, y, verticalGuide, horizontalGuide }
    },
    [snapSettings],
  )

  // ---- Canvas Interaction Functions ----
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Miro-style: ctrl/cmd + wheel (and trackpad pinch, which reports ctrlKey)
      // zooms toward the cursor; a plain wheel / two-finger drag pans the canvas.
      if (e.ctrlKey || e.metaKey) {
        // Exponential factor keeps zoom velocity smooth and symmetric.
        const zoomFactor = Math.exp(-e.deltaY * 0.01)
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor))

        const canvasX = (mouseX - pan.x) / zoom
        const canvasY = (mouseY - pan.y) / zoom

        setZoom(newZoom)
        setPan({ x: mouseX - canvasX * newZoom, y: mouseY - canvasY * newZoom })
      } else {
        // Pan with wheel / trackpad. Shift+wheel scrolls horizontally on mice.
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
        setPan({ x: pan.x - dx, y: pan.y - dy })
      }
    },
    [zoom, pan],
  )

  const centerOnContent = useCallback(
    (contentStates: WorkflowState[]) => {
      if (contentStates.length === 0) return

      const minX = Math.min(...contentStates.map((s) => s.position_x))
      const maxX = Math.max(...contentStates.map((s) => s.position_x))
      const minY = Math.min(...contentStates.map((s) => s.position_y))
      const maxY = Math.max(...contentStates.map((s) => s.position_y))

      const contentCenterX = (minX + maxX) / 2
      const contentCenterY = (minY + maxY) / 2

      const canvasWidth = canvasRef.current?.clientWidth || 800
      const canvasHeight = canvasRef.current?.clientHeight || 600

      const panX = canvasWidth / 2 - contentCenterX * zoom
      const panY = canvasHeight / 2 - contentCenterY * zoom

      setPan({ x: panX, y: panY })
    },
    [zoom],
  )

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: screenX, y: screenY }

      return {
        x: (screenX - rect.left - pan.x) / zoom,
        y: (screenY - rect.top - pan.y) / zoom,
      }
    },
    [pan, zoom],
  )

  const canvasToScreen = useCallback(
    (canvasX: number, canvasY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: canvasX, y: canvasY }

      return {
        x: rect.left + pan.x + canvasX * zoom,
        y: rect.top + pan.y + canvasY * zoom,
      }
    },
    [pan, zoom],
  )

  // ---- Build context value ----
  const value = useMemo<WorkflowCanvasContextValue>(
    () => ({
      // Canvas
      canvasMode,
      zoom,
      pan,
      mousePos,
      canvasRef,
      groupRef,
      viewportRef,
      mousePosRef,
      setCanvasMode,
      setZoom,
      setPan,
      setMousePos,
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
      isDraggingToCreateTransition,
      draggingTransitionEndpoint,
      justCompletedTransitionRef,
      transitionCompletedAtRef,
      setIsCreatingTransition,
      setTransitionStartId,
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
      canvasMode,
      zoom,
      pan,
      mousePos,
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
      isDraggingToCreateTransition,
      draggingTransitionEndpoint,
      cancelTransitionCreation,
      // Waypoints
      waypoints,
      draggingCurveControl,
      draggingWaypointIndex,
      draggingWaypointAxis,
      tempCurvePos,
      addWaypoint,
      stopWaypointDrag,
      // Labels
      labelOffsets,
      pinnedLabelPositions,
      draggingLabel,
      tempLabelPos,
      stopLabelDrag,
      // Edge Positions
      edgePositions,
      updateEdgePosition,
      // Snap Settings
      snapSettings,
      alignmentGuides,
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
