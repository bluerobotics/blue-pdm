/**
 * Drawing a new transition, and re-anchoring an existing one.
 *
 * Both gestures are the same three steps - pick an origin, follow the cursor,
 * commit wherever it landed - so they share one implementation and one snap
 * resolver. Crucially the drop target is worked out from geometry at pointer
 * up rather than from whichever DOM node happened to receive the event, which
 * is what used to make the result depend on event ordering and forced the old
 * code to guard itself with timestamps.
 */
import { useCallback, useRef, type RefObject } from 'react'

import type { TransitionPathType, WorkflowState, WorkflowTransition } from '@/types/workflow'

import { DRAG_THRESHOLD } from '../constants'
import type { ConnectionPreviewStore } from '../context/connectionPreviewStore'
import { transitionService } from '../services'
import { anchorPatch } from '../services/layoutService'
import type {
  EdgePosition,
  Point,
  PointWithEdge,
  StateDimensions,
  TransitionEndpointDrag,
} from '../types'
import {
  buildSnapCandidates,
  resolveConnectionSnap,
  type ConnectionSnap,
  type SnapCandidate,
} from '../utils/connectionSnap'
import {
  buildOutline,
  outlinePointFromAnchor,
  outlinePointToward,
  resolveOutlineDimensions,
  type Outline,
} from '../utils/shapeOutline'

/** Everything a gesture step needs to know about the pointer. */
export interface ConnectionPointer {
  /** Position in canvas coordinates. */
  cursor: Point
  clientX: number
  clientY: number
  /** Freeform modifier: pin exactly where the cursor is, ignoring the magnets. */
  altKey: boolean
}

export interface TransitionAnchors {
  start: EdgePosition | null
  end: EdgePosition | null
}

interface EndpointDragStart extends TransitionEndpointDrag {
  /** The end that stays put while the other is dragged. */
  origin: PointWithEdge
  /** The state the untouched end is attached to, which cannot be dropped onto. */
  oppositeStateId: string
}

interface UseConnectionGestureParams {
  isAdmin: boolean
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  stateDimensions: Record<string, StateDimensions>
  viewportRef: RefObject<{ pan: Point; zoom: number }>
  connectionPreview: ConnectionPreviewStore

  // Creation state
  isCreatingTransition: boolean
  transitionStartId: string | null
  transitionStartAnchor: EdgePosition | null
  setIsCreatingTransition: (creating: boolean) => void
  setTransitionStartId: (id: string | null) => void
  setTransitionStartAnchor: (anchor: EdgePosition | null) => void
  setIsDraggingToCreateTransition: (dragging: boolean) => void
  cancelTransitionCreation: () => void

  // Endpoint re-anchoring state
  draggingTransitionEndpoint: TransitionEndpointDrag | null
  setDraggingTransitionEndpoint: (drag: TransitionEndpointDrag | null) => void
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  updateEdgePosition: (
    transitionId: string,
    endpoint: 'start' | 'end',
    position: EdgePosition | null,
  ) => void

  // Shared
  setHoveredStateId: (id: string | null) => void
  setFloatingToolbar: (toolbar: null) => void
  completeTransition: (toStateId: string, anchors?: TransitionAnchors) => Promise<unknown>
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function useConnectionGesture(params: UseConnectionGestureParams) {
  const {
    isAdmin,
    states,
    transitions,
    stateDimensions,
    viewportRef,
    connectionPreview,
    isCreatingTransition,
    transitionStartId,
    transitionStartAnchor,
    setIsCreatingTransition,
    setTransitionStartId,
    setTransitionStartAnchor,
    setIsDraggingToCreateTransition,
    cancelTransitionCreation,
    draggingTransitionEndpoint,
    setDraggingTransitionEndpoint,
    setTransitions,
    updateEdgePosition,
    setHoveredStateId,
    setFloatingToolbar,
    completeTransition,
    addToast,
  } = params

  /** Where the pointer went down, so a click can be told apart from a drag. */
  const gestureStartRef = useRef<Point | null>(null)
  const hasMovedRef = useRef(false)
  /** Set once a press-and-release has armed click-to-connect. */
  const armedRef = useRef(false)
  const endpointDragRef = useRef<EndpointDragStart | null>(null)
  /** The last resolved snap, reused by the commit so it cannot disagree with the preview. */
  const snapRef = useRef<ConnectionSnap | null>(null)

  const outlineOf = useCallback(
    (state: WorkflowState): Outline =>
      buildOutline(state, resolveOutlineDimensions(state.id, stateDimensions)),
    [stateDimensions],
  )

  const resolveSnap = useCallback(
    (pointer: ConnectionPointer, candidates: SnapCandidate[], origin: Point | null) =>
      resolveConnectionSnap({
        cursor: pointer.cursor,
        candidates,
        zoom: viewportRef.current?.zoom ?? 1,
        freeform: pointer.altKey,
        origin,
      }),
    [viewportRef],
  )

  const markMoved = useCallback((pointer: ConnectionPointer) => {
    const start = gestureStartRef.current
    if (!start || hasMovedRef.current) return
    if (Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) > DRAG_THRESHOLD) {
      hasMovedRef.current = true
    }
  }, [])

  const endGesture = useCallback(() => {
    gestureStartRef.current = null
    hasMovedRef.current = false
    armedRef.current = false
    endpointDragRef.current = null
    snapRef.current = null
    connectionPreview.set(null)
  }, [connectionPreview])

  // ============================================
  // Starting
  // ============================================

  /**
   * Begin drawing a transition out of `stateId`. A port gives a pinned origin;
   * pressing on the body gives a dynamic one that slides around the border to
   * face wherever the cursor goes.
   */
  const startConnection = useCallback(
    (stateId: string, anchor: EdgePosition | null, pointer: ConnectionPointer) => {
      if (!isAdmin) return

      const state = states.find((s) => s.id === stateId)
      if (!state) return

      const outline = outlineOf(state)
      let originAnchor = anchor
      let origin: PointWithEdge

      if (anchor) {
        origin = outlinePointFromAnchor(outline, anchor)
      } else {
        const grabbed = resolveSnap(pointer, [{ stateId, outline }], null)
        originAnchor = grabbed?.anchor ?? null
        origin = grabbed
          ? {
              x: grabbed.point.x,
              y: grabbed.point.y,
              edge: grabbed.anchor?.edge ?? 'right',
              normal: grabbed.normal,
            }
          : outlinePointToward(outline, pointer.cursor)
      }

      setFloatingToolbar(null)
      setIsCreatingTransition(true)
      setTransitionStartId(stateId)
      setTransitionStartAnchor(originAnchor)
      setIsDraggingToCreateTransition(true)

      gestureStartRef.current = { x: pointer.clientX, y: pointer.clientY }
      hasMovedRef.current = false
      armedRef.current = false
      snapRef.current = null
      connectionPreview.set({ origin, cursor: pointer.cursor, snap: null, pathType: 'spline' })
    },
    [
      isAdmin,
      states,
      outlineOf,
      resolveSnap,
      setFloatingToolbar,
      setIsCreatingTransition,
      setTransitionStartId,
      setTransitionStartAnchor,
      setIsDraggingToCreateTransition,
      connectionPreview,
    ],
  )

  /** Begin dragging one end of an existing transition to somewhere else. */
  const startEndpointDrag = useCallback(
    (
      drag: TransitionEndpointDrag & {
        origin: PointWithEdge
        oppositeStateId: string
        pathType: TransitionPathType
      },
      pointer: ConnectionPointer,
    ) => {
      if (!isAdmin) return

      setFloatingToolbar(null)
      setDraggingTransitionEndpoint({
        transitionId: drag.transitionId,
        endpoint: drag.endpoint,
        originalStateId: drag.originalStateId,
      })

      endpointDragRef.current = {
        transitionId: drag.transitionId,
        endpoint: drag.endpoint,
        originalStateId: drag.originalStateId,
        origin: drag.origin,
        oppositeStateId: drag.oppositeStateId,
      }
      gestureStartRef.current = { x: pointer.clientX, y: pointer.clientY }
      hasMovedRef.current = false
      snapRef.current = null
      connectionPreview.set({
        origin: drag.origin,
        cursor: pointer.cursor,
        snap: null,
        pathType: drag.pathType,
      })
    },
    [isAdmin, setFloatingToolbar, setDraggingTransitionEndpoint, connectionPreview],
  )

  // ============================================
  // Tracking
  // ============================================

  /** Recompute a dynamic origin, or leave a pinned one alone. */
  const resolveOrigin = useCallback(
    (current: PointWithEdge, target: Point): PointWithEdge => {
      if (endpointDragRef.current || transitionStartAnchor || !transitionStartId) return current

      const state = states.find((s) => s.id === transitionStartId)
      if (!state) return current

      return outlinePointToward(outlineOf(state), target)
    },
    [transitionStartAnchor, transitionStartId, states, outlineOf],
  )

  /**
   * What a dynamic attachment on the far end will aim at once committed: the
   * centre of the node at this end. Previewing against the origin point instead
   * would show the endpoint a few pixels away from where it settles.
   */
  const originCenter = useCallback(
    (fallback: Point): Point => {
      const endpointDrag = endpointDragRef.current
      const stateId = endpointDrag ? endpointDrag.oppositeStateId : transitionStartId
      const state = stateId ? states.find((s) => s.id === stateId) : null
      return state ? { x: state.position_x, y: state.position_y } : fallback
    },
    [transitionStartId, states],
  )

  /** Returns true when a connection gesture consumed the move. */
  const updateConnectionPointer = useCallback(
    (pointer: ConnectionPointer): boolean => {
      const endpointDrag = endpointDragRef.current
      const active = connectionPreview.getSnapshot()

      if (!active || (!isCreatingTransition && !endpointDrag)) return false

      markMoved(pointer)

      const excludedId = endpointDrag ? endpointDrag.oppositeStateId : transitionStartId
      const candidates = buildSnapCandidates(states, stateDimensions, excludedId)
      const snap = resolveSnap(pointer, candidates, originCenter(active.origin))

      snapRef.current = snap
      setHoveredStateId(snap?.stateId ?? null)

      // A source that was grabbed by the body is not pinned to a spot, so it
      // slides around its border to keep facing the moving end.
      const origin = resolveOrigin(active.origin, snap ? snap.outline.center : pointer.cursor)

      connectionPreview.set({ ...active, origin, cursor: pointer.cursor, snap })
      return true
    },
    [
      connectionPreview,
      isCreatingTransition,
      markMoved,
      transitionStartId,
      states,
      stateDimensions,
      resolveSnap,
      resolveOrigin,
      originCenter,
      setHoveredStateId,
    ],
  )

  // ============================================
  // Committing
  // ============================================

  const commitEndpointDrag = useCallback(
    async (drag: EndpointDragStart, snap: ConnectionSnap | null) => {
      const transition = transitions.find((t) => t.id === drag.transitionId)
      if (!transition || !snap) return

      if (snap.stateId === drag.originalStateId) {
        updateEdgePosition(drag.transitionId, drag.endpoint, snap.anchor)
        return
      }

      const { error } = await transitionService.reconnect(
        drag.transitionId,
        drag.endpoint,
        snap.stateId,
        snap.anchor,
      )

      if (error) {
        addToast('error', 'Failed to reconnect transition')
        return
      }

      // Mirror locally what reconnect just wrote, in one patch: the anchor is
      // read back off the row, so writing it separately would save it twice.
      const updates =
        drag.endpoint === 'start'
          ? { from_state_id: snap.stateId, ...anchorPatch('start', snap.anchor) }
          : { to_state_id: snap.stateId, ...anchorPatch('end', snap.anchor) }

      setTransitions((prev) =>
        prev.map((t) => (t.id === drag.transitionId ? { ...t, ...updates } : t)),
      )
      addToast('success', 'Transition reconnected')
    },
    [transitions, updateEdgePosition, setTransitions, addToast],
  )

  /** Returns true when a connection gesture consumed the release. */
  const finishConnectionPointer = useCallback(
    async (pointer: ConnectionPointer): Promise<boolean> => {
      const endpointDrag = endpointDragRef.current
      const active = connectionPreview.getSnapshot()
      if (!active || (!isCreatingTransition && !endpointDrag)) return false

      markMoved(pointer)

      // Resolve one last time from the release position: the final pointer up can
      // land a few pixels past the last frame the preview rendered.
      const excludedId = endpointDrag ? endpointDrag.oppositeStateId : transitionStartId
      const candidates = buildSnapCandidates(states, stateDimensions, excludedId)
      const snap = resolveSnap(pointer, candidates, originCenter(active.origin))

      if (endpointDrag) {
        await commitEndpointDrag(endpointDrag, snap)
        setDraggingTransitionEndpoint(null)
        setHoveredStateId(null)
        endGesture()
        return true
      }

      if (snap) {
        endGesture()
        await completeTransition(snap.stateId, {
          start: transitionStartAnchor,
          end: snap.anchor,
        })
        return true
      }

      // Released on empty space. The very first press-and-release without
      // movement is the opening half of click-to-connect, so the line stays
      // armed for the click that finishes it. A drag that landed nowhere, or a
      // second click into empty space, means the user changed their mind.
      if (hasMovedRef.current || armedRef.current) {
        endGesture()
        cancelTransitionCreation()
      } else {
        armedRef.current = true
        setIsDraggingToCreateTransition(false)
      }
      return true
    },
    [
      connectionPreview,
      isCreatingTransition,
      markMoved,
      transitionStartId,
      states,
      stateDimensions,
      resolveSnap,
      originCenter,
      commitEndpointDrag,
      setDraggingTransitionEndpoint,
      setHoveredStateId,
      endGesture,
      completeTransition,
      transitionStartAnchor,
      cancelTransitionCreation,
      setIsDraggingToCreateTransition,
    ],
  )

  return {
    startConnection,
    startEndpointDrag,
    updateConnectionPointer,
    finishConnectionPointer,
    isConnectionActive: isCreatingTransition || draggingTransitionEndpoint !== null,
  }
}
