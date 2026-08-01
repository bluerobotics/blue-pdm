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
import type { WorkflowState } from '@/types/workflow'

import type { Point, ResizingState, HistoryEntry } from '../types'
import { getNearestPointOnBoxEdge, findInsertionIndex } from '../utils'
import type { TransitionPathType } from '@/types/workflow'

import type { ConnectionPointer } from './useConnectionGesture'

/**
 * Minimal pointer shape accepted by the canvas handlers. Both React synthetic
 * events and native DOM PointerEvents satisfy this, so the same handlers work
 * whether invoked from JSX or from window-level pointer listeners.
 */
export type CanvasPointerInput = Pick<
  React.MouseEvent,
  'clientX' | 'clientY' | 'button' | 'altKey'
>

interface UseCanvasHandlersParams {
  // Refs
  canvasRef: RefObject<HTMLDivElement | null>
  groupRef: RefObject<SVGGElement | null>
  viewportRef: RefObject<{ pan: Point; zoom: number }>
  mousePosRef: RefObject<Point>
  hasDraggedRef: RefObject<boolean>
  dragStartPosRef: RefObject<Point | null>
  dragOriginRef: RefObject<Point | null>
  waypointHasDraggedRef: RefObject<boolean>

  // Canvas state
  pan: Point
  zoom: number
  canvasMode: string

  // Dragging state
  draggingStateId: string | null
  dragOffset: Point

  // Resizing state
  currentResizing: ResizingState | null

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

  // Callbacks
  setPan: (pan: Point) => void
  setDraggingStateId: (id: string | null) => void
  setFloatingToolbar: (toolbar: null) => void
  setAlignmentGuides: (guides: { vertical: number | null; horizontal: number | null }) => void
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTempCurvePos: (pos: Point | null) => void
  setTempLabelPos: (pos: Point | null) => void
  setWaypoints: React.Dispatch<React.SetStateAction<Record<string, Point[]>>>
  setPinnedLabelPositions: React.Dispatch<React.SetStateAction<Record<string, Point>>>

  // Connection gestures (creating a transition, or moving one of its ends)
  updateConnectionPointer: (pointer: ConnectionPointer) => boolean
  finishConnectionPointer: (pointer: ConnectionPointer) => Promise<boolean>

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
  stopWaypointDrag: () => void
  stopLabelDrag: () => void
  clearSelection: () => void
  pushToUndo: (entry: HistoryEntry) => void
}

export function useCanvasHandlers(params: UseCanvasHandlersParams) {
  const {
    canvasRef,
    groupRef,
    viewportRef,
    mousePosRef,
    hasDraggedRef,
    dragStartPosRef,
    dragOriginRef,
    waypointHasDraggedRef,
    pan,
    zoom,
    canvasMode,
    draggingStateId,
    dragOffset,
    currentResizing,
    waypoints,
    draggingCurveControl,
    draggingWaypointIndex,
    draggingWaypointAxis,
    tempCurvePos,
    draggingLabel,
    tempLabelPos,
    states,
    setPan,
    setDraggingStateId,
    setFloatingToolbar,
    setAlignmentGuides,
    setStates,
    setTempCurvePos,
    setTempLabelPos,
    setWaypoints,
    setPinnedLabelPositions,
    updateConnectionPointer,
    finishConnectionPointer,
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
    stopWaypointDrag,
    stopLabelDrag,
    clearSelection,
    pushToUndo,
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

      mousePosRef.current = { x: canvasX, y: canvasY }

      // A connection being drawn or re-anchored owns the pointer outright.
      if (updateConnectionPointer(toConnectionPointer(e, { x: canvasX, y: canvasY }))) return

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
      updateConnectionPointer,
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

      // Committing a connection is decided purely by where the pointer is, so it
      // needs nothing from the DOM beyond the release coordinates.
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        const cursor = {
          x: (e.clientX - rect.left - pan.x) / zoom,
          y: (e.clientY - rect.top - pan.y) / zoom,
        }
        if (await finishConnectionPointer(toConnectionPointer(e, cursor))) return
      }

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
        const origin = dragOriginRef.current
        if (state && hasDraggedRef.current) {
          const to = { x: state.position_x, y: state.position_y }
          await updateStatePosition(draggingStateId, to.x, to.y)
          // One entry per gesture, not per mouse-move, and only if it actually moved.
          if (origin && (origin.x !== to.x || origin.y !== to.y)) {
            pushToUndo({ type: 'state_move', stateId: draggingStateId, from: origin, to })
          }
        }
        stopDragging()
        return
      }

      // Handle resize end
      if (currentResizing) {
        stopResizing()
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

      // If clicking on empty canvas, deselect
      if (!hasDraggedRef.current && canvasMode === 'select') {
        clearSelection()
        setFloatingToolbar(null)
      }
    },
    [
      clearAlignmentGuides,
      canvasRef,
      pan,
      zoom,
      finishConnectionPointer,
      draggingStateId,
      setDraggingStateId,
      dragStartPosRef,
      dragOriginRef,
      states,
      hasDraggedRef,
      updateStatePosition,
      pushToUndo,
      stopDragging,
      currentResizing,
      stopResizing,
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

function toConnectionPointer(e: CanvasPointerInput, cursor: Point): ConnectionPointer {
  return { cursor, clientX: e.clientX, clientY: e.clientY, altKey: e.altKey }
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
