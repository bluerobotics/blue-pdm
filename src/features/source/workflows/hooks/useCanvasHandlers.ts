/**
 * useCanvasHandlers - Extracts canvas event handlers from WorkflowsView
 *
 * Provides mouse event handlers for the workflow canvas, handling:
 * - Panning
 * - State dragging
 * - Resizing
 * - Transition endpoint dragging
 * - Waypoint dragging
 * - Label dragging
 */
import { useCallback, useRef, type RefObject } from 'react'
import type {
  WorkflowState,
  WorkflowTransition,
  Point,
  ResizingState,
  TransitionEndpointDrag,
  EdgePosition,
} from '../types'
import { getNearestPointOnBoxEdge, findInsertionIndex } from '../utils'
import { transitionService } from '../services'
import type { TransitionPathType } from '@/types/workflow'

/**
 * Minimal pointer shape accepted by the canvas handlers. Both React synthetic
 * events and native DOM PointerEvents satisfy this, so the same handlers work
 * whether invoked from JSX or from window-level pointer listeners.
 */
export type CanvasPointerInput = Pick<React.MouseEvent, 'clientX' | 'clientY' | 'button'>

interface UseCanvasHandlersParams {
  // Refs
  canvasRef: RefObject<HTMLDivElement | null>
  groupRef: RefObject<SVGGElement | null>
  viewportRef: RefObject<{ pan: Point; zoom: number }>
  mousePosRef: RefObject<Point>
  hasDraggedRef: RefObject<boolean>
  dragStartPosRef: RefObject<Point | null>
  waypointHasDraggedRef: RefObject<boolean>

  // Canvas state
  pan: Point
  zoom: number
  canvasMode: string
  isCreatingTransition: boolean

  // Dragging state
  draggingStateId: string | null
  dragOffset: Point

  // Resizing state
  currentResizing: ResizingState | null

  // Transition endpoint
  draggingTransitionEndpoint: TransitionEndpointDrag | null

  // Waypoint state
  waypoints: Record<string, Point[]>
  draggingCurveControl: string | null
  draggingWaypointIndex: number | null
  draggingWaypointAxis: 'x' | 'y' | null
  tempCurvePos: Point | null

  // Label state
  draggingLabel: string | null
  tempLabelPos: Point | null

  // Data
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  hoveredStateId: string | null
  isDraggingToCreateTransition: boolean

  // Callbacks
  setPan: (pan: Point) => void
  setMousePos: (pos: Point) => void
  setDraggingStateId: (id: string | null) => void
  setFloatingToolbar: (toolbar: null) => void
  setAlignmentGuides: (guides: { vertical: number | null; horizontal: number | null }) => void
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  setHoveredStateId: (id: string | null) => void
  setTempCurvePos: (pos: Point | null) => void
  setTempLabelPos: (pos: Point | null) => void
  setWaypoints: React.Dispatch<React.SetStateAction<Record<string, Point[]>>>
  setPinnedLabelPositions: React.Dispatch<React.SetStateAction<Record<string, Point>>>
  setDraggingTransitionEndpoint: (endpoint: TransitionEndpointDrag | null) => void

  // Functions
  checkDragThreshold: (clientX: number, clientY: number) => boolean
  markHasDragged: () => void
  applySnapping: (
    stateId: string,
    x: number,
    y: number,
  ) => { x: number; y: number; verticalGuide: number | null; horizontalGuide: number | null }
  getDimensions: (stateId: string) => { width: number; height: number }
  updateDimensions: (stateId: string, dims: { width: number; height: number }) => void
  closeAll: () => void
  clearAlignmentGuides: () => void
  updateStatePosition: (stateId: string, x: number, y: number) => Promise<void>
  stopDragging: () => void
  stopResizing: () => void
  updateEdgePosition: (
    transitionId: string,
    endpoint: 'start' | 'end',
    position: EdgePosition,
  ) => void
  stopWaypointDrag: () => void
  stopLabelDrag: () => void
  cancelTransitionCreation: () => void
  clearSelection: () => void
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function useCanvasHandlers(params: UseCanvasHandlersParams) {
  const {
    canvasRef,
    groupRef,
    viewportRef,
    mousePosRef,
    hasDraggedRef,
    dragStartPosRef,
    waypointHasDraggedRef,
    pan,
    zoom,
    canvasMode,
    isCreatingTransition,
    draggingStateId,
    dragOffset,
    currentResizing,
    draggingTransitionEndpoint,
    waypoints,
    draggingCurveControl,
    draggingWaypointIndex,
    draggingWaypointAxis,
    tempCurvePos,
    draggingLabel,
    tempLabelPos,
    states,
    transitions,
    hoveredStateId,
    isDraggingToCreateTransition,
    setPan,
    setMousePos,
    setDraggingStateId,
    setFloatingToolbar,
    setAlignmentGuides,
    setStates,
    setTransitions,
    setHoveredStateId,
    setTempCurvePos,
    setTempLabelPos,
    setWaypoints,
    setPinnedLabelPositions,
    setDraggingTransitionEndpoint,
    checkDragThreshold,
    markHasDragged,
    applySnapping,
    getDimensions,
    updateDimensions,
    closeAll,
    clearAlignmentGuides,
    updateStatePosition,
    stopDragging,
    stopResizing,
    updateEdgePosition,
    stopWaypointDrag,
    stopLabelDrag,
    cancelTransitionCreation,
    clearSelection,
    addToast,
  } = params

  // Latest pan computed during an imperative (non-React) pan gesture; committed
  // to React state on pointer up so panning never triggers a re-render per frame.
  const pendingPanRef = useRef<Point | null>(null)

  // Handle canvas mouse down
  const handleCanvasMouseDown = useCallback(
    (e: CanvasPointerInput) => {
      if (e.button !== 0) return

      closeAll()

      if (canvasMode === 'pan') {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        dragStartPosRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
        setDraggingStateId('_panning_')
      }
    },
    [canvasMode, pan, canvasRef, closeAll, dragStartPosRef, setDraggingStateId],
  )

  // Handle canvas mouse move
  const handleCanvasMouseMove = useCallback(
    (e: CanvasPointerInput) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - pan.x) / zoom
      const canvasY = (e.clientY - rect.top - pan.y) / zoom

      // Track the live pointer position in canvas space. Update the rubber-band
      // preview (CreatingTransition / endpoint drag) so it follows the cursor.
      mousePosRef.current = { x: canvasX, y: canvasY }
      if (isCreatingTransition || draggingTransitionEndpoint) {
        setMousePos({ x: canvasX, y: canvasY })
      }

      // Handle panning - apply the transform imperatively to the SVG group so a
      // pan gesture causes zero React re-renders; commit to state on pointer up.
      if (draggingStateId === '_panning_' && dragStartPosRef.current) {
        const newPan = {
          x: e.clientX - dragStartPosRef.current.x,
          y: e.clientY - dragStartPosRef.current.y,
        }
        pendingPanRef.current = newPan
        const group = groupRef.current
        if (group) {
          const currentZoom = viewportRef.current?.zoom ?? zoom
          group.setAttribute(
            'transform',
            `translate(${newPan.x}, ${newPan.y}) scale(${currentZoom})`,
          )
        } else {
          setPan(newPan)
        }
        return
      }

      // Handle state dragging
      if (draggingStateId && draggingStateId !== '_panning_') {
        if (!hasDraggedRef.current && checkDragThreshold(e.clientX, e.clientY)) {
          markHasDragged()
          setFloatingToolbar(null)
        }

        if (hasDraggedRef.current) {
          const newX = canvasX - dragOffset.x
          const newY = canvasY - dragOffset.y

          const snapped = applySnapping(draggingStateId, newX, newY)
          setAlignmentGuides({
            vertical: snapped.verticalGuide,
            horizontal: snapped.horizontalGuide,
          })

          setStates((prev) =>
            prev.map((s) =>
              s.id === draggingStateId ? { ...s, position_x: snapped.x, position_y: snapped.y } : s,
            ),
          )
        }
        return
      }

      // Handle resize
      if (currentResizing) {
        const state = states.find((s) => s.id === currentResizing.stateId)
        if (!state) return

        void getDimensions(currentResizing.stateId)
        const dx = canvasX - currentResizing.startMouseX
        const dy = canvasY - currentResizing.startMouseY

        let newWidth = currentResizing.startWidth
        let newHeight = currentResizing.startHeight

        if (currentResizing.handle.includes('e'))
          newWidth = Math.max(60, currentResizing.startWidth + dx * 2)
        if (currentResizing.handle.includes('w'))
          newWidth = Math.max(60, currentResizing.startWidth - dx * 2)
        if (currentResizing.handle.includes('s'))
          newHeight = Math.max(30, currentResizing.startHeight + dy * 2)
        if (currentResizing.handle.includes('n'))
          newHeight = Math.max(30, currentResizing.startHeight - dy * 2)

        updateDimensions(currentResizing.stateId, { width: newWidth, height: newHeight })
        return
      }

      // Handle transition endpoint dragging
      if (draggingTransitionEndpoint) {
        for (const state of states) {
          const dims = getDimensions(state.id)
          const hw = dims.width / 2
          const hh = dims.height / 2

          if (
            canvasX >= state.position_x - hw &&
            canvasX <= state.position_x + hw &&
            canvasY >= state.position_y - hh &&
            canvasY <= state.position_y + hh
          ) {
            if (state.id !== draggingTransitionEndpoint.originalStateId) {
              setHoveredStateId(state.id)
              return
            }
          }
        }
        setHoveredStateId(null)
        return
      }

      // Handle waypoint dragging
      if (draggingCurveControl && draggingWaypointIndex !== null) {
        waypointHasDraggedRef.current = true

        if (draggingWaypointAxis) {
          const currentWaypoints = waypoints[draggingCurveControl] || []
          const originalWp = currentWaypoints[draggingWaypointIndex]
          if (originalWp) {
            setTempCurvePos({
              x: draggingWaypointAxis === 'x' ? canvasX : originalWp.x,
              y: draggingWaypointAxis === 'y' ? canvasY : originalWp.y,
            })
          }
        } else {
          setTempCurvePos({ x: canvasX, y: canvasY })
        }
        return
      }

      // Handle label dragging
      if (draggingLabel) {
        setTempLabelPos({ x: canvasX, y: canvasY })
        return
      }
    },
    [
      canvasRef,
      groupRef,
      viewportRef,
      mousePosRef,
      isCreatingTransition,
      setMousePos,
      pan,
      zoom,
      draggingStateId,
      dragStartPosRef,
      setPan,
      dragOffset,
      hasDraggedRef,
      checkDragThreshold,
      markHasDragged,
      setFloatingToolbar,
      applySnapping,
      setAlignmentGuides,
      setStates,
      currentResizing,
      states,
      getDimensions,
      updateDimensions,
      draggingTransitionEndpoint,
      setHoveredStateId,
      draggingCurveControl,
      draggingWaypointIndex,
      draggingWaypointAxis,
      waypoints,
      waypointHasDraggedRef,
      setTempCurvePos,
      draggingLabel,
      setTempLabelPos,
    ],
  )

  // Handle canvas mouse up
  const handleCanvasMouseUp = useCallback(
    async (e: CanvasPointerInput) => {
      // Clear alignment guides
      clearAlignmentGuides()

      // Handle panning end - commit the imperatively-applied pan to React state
      if (draggingStateId === '_panning_') {
        if (pendingPanRef.current) {
          setPan(pendingPanRef.current)
          pendingPanRef.current = null
        }
        setDraggingStateId(null)
        dragStartPosRef.current = null
        return
      }

      // Handle state drag end
      if (draggingStateId) {
        const state = states.find((s) => s.id === draggingStateId)
        if (state && hasDraggedRef.current) {
          // Save position to database
          await updateStatePosition(draggingStateId, state.position_x, state.position_y)
        }
        stopDragging()

        // If we didn't drag, it was a click - deselect
        if (!hasDraggedRef.current) {
          // Handled by click handler
        }
        return
      }

      // Handle resize end
      if (currentResizing) {
        stopResizing()
        return
      }

      // Handle transition endpoint drag end
      if (draggingTransitionEndpoint) {
        const transition = transitions.find((t) => t.id === draggingTransitionEndpoint.transitionId)
        if (!transition) {
          setDraggingTransitionEndpoint(null)
          setHoveredStateId(null)
          return
        }

        // If hovering over a valid state, reconnect the transition
        if (hoveredStateId && hoveredStateId !== draggingTransitionEndpoint.originalStateId) {
          const endpoint = draggingTransitionEndpoint.endpoint === 'start' ? 'start' : 'end'
          const { error } = await transitionService.reconnect(
            transition.id,
            endpoint,
            hoveredStateId,
          )

          if (error) {
            addToast('error', 'Failed to reconnect transition')
          } else {
            const updates =
              draggingTransitionEndpoint.endpoint === 'start'
                ? { from_state_id: hoveredStateId }
                : { to_state_id: hoveredStateId }
            setTransitions((prev) =>
              prev.map((t) => (t.id === transition.id ? { ...t, ...updates } : t)),
            )
            addToast('success', 'Transition reconnected')
          }
        } else {
          // Dropped on same state or empty space - store edge position
          const rect = canvasRef.current?.getBoundingClientRect()
          if (rect) {
            const canvasX = (e.clientX - rect.left - pan.x) / zoom
            const canvasY = (e.clientY - rect.top - pan.y) / zoom

            const targetStateId = draggingTransitionEndpoint.originalStateId
            const targetState = states.find((s) => s.id === targetStateId)
            if (targetState) {
              const dims = getDimensions(targetStateId)
              const nearestPoint = getNearestPointOnBoxEdge(
                targetState.position_x,
                targetState.position_y,
                canvasX,
                canvasY,
                dims.width,
                dims.height,
              )

              // Calculate fraction along edge
              let fraction = 0.5
              const hw = dims.width / 2
              const hh = dims.height / 2

              switch (nearestPoint.edge) {
                case 'left':
                case 'right':
                  fraction = (canvasY - (targetState.position_y - hh)) / dims.height
                  break
                case 'top':
                case 'bottom':
                  fraction = (canvasX - (targetState.position_x - hw)) / dims.width
                  break
              }
              fraction = Math.max(0, Math.min(1, fraction))

              updateEdgePosition(transition.id, draggingTransitionEndpoint.endpoint, {
                edge: nearestPoint.edge,
                fraction,
              })
            }
          }
        }

        setDraggingTransitionEndpoint(null)
        setHoveredStateId(null)
        return
      }

      // Handle waypoint drag end
      if (draggingCurveControl && draggingWaypointIndex !== null) {
        if (tempCurvePos && waypointHasDraggedRef.current) {
          setWaypoints((prev) => {
            const currentWaypoints = [...(prev[draggingCurveControl] || [])]
            while (currentWaypoints.length <= draggingWaypointIndex) {
              currentWaypoints.push({ x: 0, y: 0 })
            }
            currentWaypoints[draggingWaypointIndex] = { x: tempCurvePos.x, y: tempCurvePos.y }
            return { ...prev, [draggingCurveControl]: currentWaypoints }
          })
        }
        stopWaypointDrag()
        return
      }

      // Handle label drag end
      if (draggingLabel) {
        if (tempLabelPos) {
          setPinnedLabelPositions((prev) => ({
            ...prev,
            [draggingLabel]: { x: tempLabelPos.x, y: tempLabelPos.y },
          }))
        }
        stopLabelDrag()
        return
      }

      // Handle creating transition (mouse up on canvas = cancel)
      if (isDraggingToCreateTransition && !hoveredStateId) {
        cancelTransitionCreation()
        return
      }

      // If clicking on empty canvas, deselect
      if (!hasDraggedRef.current && canvasMode === 'select') {
        clearSelection()
        setFloatingToolbar(null)
      }
    },
    [
      clearAlignmentGuides,
      draggingStateId,
      setDraggingStateId,
      dragStartPosRef,
      states,
      hasDraggedRef,
      updateStatePosition,
      stopDragging,
      currentResizing,
      stopResizing,
      draggingTransitionEndpoint,
      transitions,
      hoveredStateId,
      setDraggingTransitionEndpoint,
      setHoveredStateId,
      setTransitions,
      addToast,
      canvasRef,
      pan,
      zoom,
      getDimensions,
      updateEdgePosition,
      draggingCurveControl,
      draggingWaypointIndex,
      tempCurvePos,
      waypointHasDraggedRef,
      setWaypoints,
      stopWaypointDrag,
      draggingLabel,
      tempLabelPos,
      setPinnedLabelPositions,
      stopLabelDrag,
      isDraggingToCreateTransition,
      cancelTransitionCreation,
      canvasMode,
      clearSelection,
      setFloatingToolbar,
    ],
  )

  return {
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
  }
}

/**
 * Utility function to add a waypoint to a transition
 */
export function addWaypointToTransition(
  transitionId: string,
  x: number,
  y: number,
  pathType: TransitionPathType | string,
  _startEdge: string,
  _endEdge: string,
  states: WorkflowState[],
  transitions: { id: string; from_state_id: string; to_state_id: string }[],
  waypoints: Record<string, Point[]>,
  getDimensions: (stateId: string) => { width: number; height: number },
): { newWaypoints: Point[]; insertIndex: number } | null {
  const transition = transitions.find((t) => t.id === transitionId)
  if (!transition) return null

  const fromState = states.find((s) => s.id === transition.from_state_id)
  const toState = states.find((s) => s.id === transition.to_state_id)
  if (!fromState || !toState) return null

  const currentWaypoints = waypoints[transitionId] || []
  const fromDims = getDimensions(fromState.id)
  const toDims = getDimensions(toState.id)

  // Get edge points
  const startPoint = getNearestPointOnBoxEdge(
    fromState.position_x,
    fromState.position_y,
    toState.position_x,
    toState.position_y,
    fromDims.width,
    fromDims.height,
  )
  const endPoint = getNearestPointOnBoxEdge(
    toState.position_x,
    toState.position_y,
    fromState.position_x,
    fromState.position_y,
    toDims.width,
    toDims.height,
  )

  // Find where to insert the waypoint
  const insertIndex = findInsertionIndex(currentWaypoints, startPoint, endPoint, { x, y })

  // For elbow paths, snap to perpendicular
  let newPoint: Point = { x, y }
  if (pathType === 'elbow' && currentWaypoints.length > 0) {
    const nearestIdx = Math.min(insertIndex, currentWaypoints.length - 1)
    const nearestWp = currentWaypoints[nearestIdx]
    if (nearestWp) {
      if (Math.abs(x - nearestWp.x) < Math.abs(y - nearestWp.y)) {
        newPoint = { x: nearestWp.x, y }
      } else {
        newPoint = { x, y: nearestWp.y }
      }
    }
  }

  const newWaypoints = [...currentWaypoints]
  newWaypoints.splice(insertIndex, 0, newPoint)

  return { newWaypoints, insertIndex }
}
