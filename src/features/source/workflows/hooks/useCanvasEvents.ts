/**
 * useCanvasEvents - Extracts canvas event handlers and keyboard shortcuts from WorkflowsView
 *
 * Provides:
 * - handleCanvasClick - Deselection and cancel operations
 * - handleCanvasContextMenu - Right-click menu on canvas
 * - handleStateStartDrag - Initiate state dragging
 * - handleStateStartResize - Initiate state resizing
 * - handleStateShowToolbar - Show floating toolbar for state
 * - handleTransitionShowToolbar - Show floating toolbar for transition
 * - handleAddWaypointToTransition - Add waypoint at click position
 * - setupKeyboardShortcuts - Effect for Escape, Delete, Ctrl+C/V/X/Z
 */
import { useCallback, useEffect, type RefObject } from 'react'
import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import type { Point, ResizingState, ContextMenuState } from '../types'
import { findInsertionIndex } from '../utils'

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True when the event target is somewhere the user could be entering text. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable
}

interface UseCanvasEventsParams {
  // Refs
  canvasRef: RefObject<HTMLDivElement | null>
  hasDraggedRef: RefObject<boolean>

  // Canvas state
  pan: Point
  zoom: number
  canvasMode: string

  // Selection
  isCreatingTransition: boolean
  contextMenu: ContextMenuState | null
  floatingToolbar: { type: string; targetId: string } | null
  isAdmin: boolean

  // Data
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  waypoints: Record<string, Point[]>

  // Callbacks - transition creation
  cancelTransitionCreation: () => void

  // Callbacks - context menu
  setContextMenu: (menu: ContextMenuState | null) => void
  closeContextMenu: () => void
  setFloatingToolbar: (toolbar: null) => void

  // Callbacks - selection
  clearSelection: () => void

  // Callbacks - dragging
  startDragging: (
    stateId: string,
    offsetX: number,
    offsetY: number,
    clientX: number,
    clientY: number,
    origin: Point,
  ) => void

  // Callbacks - resizing
  startResizing: (
    stateId: string,
    handle: ResizingState['handle'],
    mouseX: number,
    mouseY: number,
    startWidth: number,
    startHeight: number,
  ) => void
  getDimensions: (stateId: string) => { width: number; height: number }

  // Callbacks - toolbar
  showStateToolbar: (x: number, y: number, stateId: string) => void
  showTransitionToolbar: (x: number, y: number, transitionId: string) => void

  // Callbacks - waypoints
  addWaypoint: (transitionId: string, point: Point, insertIndex?: number) => void

  // Callbacks - clipboard/undo
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void
  handleUndo: () => void
  handleRedo: () => void
  handleDeleteSelected: () => void
}

interface UseCanvasEventsReturn {
  handleCanvasClick: (e: React.MouseEvent) => void
  handleCanvasContextMenu: (e: React.MouseEvent) => void
  handleStateStartDrag: (stateId: string, e: React.MouseEvent) => void
  handleStateStartResize: (stateId: string, handle: string, e: React.MouseEvent) => void
  handleStateShowToolbar: (stateId: string) => void
  handleTransitionShowToolbar: (transitionId: string, canvasX: number, canvasY: number) => void
  handleAddWaypointToTransition: (
    transitionId: string,
    clickX: number,
    clickY: number,
    pathType: string,
    startEdge: string,
    endEdge: string,
  ) => void
}

export function useCanvasEvents(params: UseCanvasEventsParams): UseCanvasEventsReturn {
  const {
    canvasRef,
    hasDraggedRef,
    pan,
    zoom,
    canvasMode,
    isCreatingTransition,
    contextMenu,
    floatingToolbar,
    isAdmin,
    states,
    transitions,
    waypoints,
    cancelTransitionCreation,
    setContextMenu,
    closeContextMenu,
    setFloatingToolbar,
    clearSelection,
    startDragging,
    startResizing,
    getDimensions,
    showStateToolbar,
    showTransitionToolbar,
    addWaypoint,
    handleCopy,
    handleCut,
    handlePaste,
    handleUndo,
    handleRedo,
    handleDeleteSelected,
  } = params

  /**
   * Clicking empty canvas in select mode clears the current selection. An
   * in-flight connection is deliberately not cancelled here: the click that
   * ends a drag on another node bubbles to this handler too, and the pointer-up
   * path already decides whether the gesture committed, stayed armed for
   * click-to-connect, or was abandoned.
   */
  const handleCanvasClick = useCallback(
    (_e: React.MouseEvent) => {
      if (hasDraggedRef.current || isCreatingTransition) return

      if (canvasMode === 'select') {
        clearSelection()
        setFloatingToolbar(null)
      }
    },
    [hasDraggedRef, isCreatingTransition, canvasMode, clearSelection, setFloatingToolbar],
  )

  // Handle canvas context menu
  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - pan.x) / zoom
      const canvasY = (e.clientY - rect.top - pan.y) / zoom

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: 'canvas',
        targetId: '',
        canvasX,
        canvasY,
      })
    },
    [canvasRef, pan, zoom, setContextMenu],
  )

  // Handle state start drag
  const handleStateStartDrag = useCallback(
    (stateId: string, e: React.MouseEvent) => {
      if (!isAdmin) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - pan.x) / zoom
      const canvasY = (e.clientY - rect.top - pan.y) / zoom

      const state = states.find((s) => s.id === stateId)
      if (!state) return

      const offsetX = canvasX - state.position_x
      const offsetY = canvasY - state.position_y

      startDragging(stateId, offsetX, offsetY, e.clientX, e.clientY, {
        x: state.position_x,
        y: state.position_y,
      })
    },
    [isAdmin, canvasRef, pan, zoom, states, startDragging],
  )

  // Handle state start resize
  const handleStateStartResize = useCallback(
    (stateId: string, handle: string, e: React.MouseEvent) => {
      if (!isAdmin) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - pan.x) / zoom
      const canvasY = (e.clientY - rect.top - pan.y) / zoom

      const dims = getDimensions(stateId)

      startResizing(
        stateId,
        handle as ResizingState['handle'],
        canvasX,
        canvasY,
        dims.width,
        dims.height,
      )
    },
    [isAdmin, canvasRef, pan, zoom, getDimensions, startResizing],
  )

  // Handle state show toolbar
  const handleStateShowToolbar = useCallback(
    (stateId: string) => {
      const state = states.find((s) => s.id === stateId)
      if (!state) return

      const dims = getDimensions(stateId)
      showStateToolbar(state.position_x, state.position_y - dims.height / 2 - 60, stateId)
    },
    [states, getDimensions, showStateToolbar],
  )

  // Handle transition show toolbar
  const handleTransitionShowToolbar = useCallback(
    (transitionId: string, canvasX: number, canvasY: number) => {
      showTransitionToolbar(canvasX, canvasY - 60, transitionId)
    },
    [showTransitionToolbar],
  )

  // Handle add waypoint to transition
  const handleAddWaypointToTransition = useCallback(
    (
      transitionId: string,
      clickX: number,
      clickY: number,
      _pathType: string,
      _startEdge: string,
      _endEdge: string,
    ) => {
      const transition = transitions.find((t) => t.id === transitionId)
      if (!transition) return

      const currentWaypoints = waypoints[transitionId] || []

      // Get start and end positions from states
      const fromState = states.find((s) => s.id === transition.from_state_id)
      const toState = states.find((s) => s.id === transition.to_state_id)
      if (!fromState || !toState) return

      const start = { x: fromState.position_x, y: fromState.position_y }
      const end = { x: toState.position_x, y: toState.position_y }

      // Find best insertion point
      const insertIndex = findInsertionIndex(currentWaypoints, start, end, { x: clickX, y: clickY })

      addWaypoint(transitionId, { x: clickX, y: clickY }, insertIndex)
    },
    [transitions, states, waypoints, addWaypoint],
  )

  // Keyboard shortcuts effect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // These are window-level listeners, so a shortcut must never fire while the
      // user is typing. Copy, cut, paste and undo in particular have native
      // behaviour inside a field that preventDefault would otherwise swallow.
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return

      // Escape - cancel operations
      if (e.key === 'Escape') {
        if (isCreatingTransition) {
          cancelTransitionCreation()
        } else if (floatingToolbar) {
          setFloatingToolbar(null)
        } else if (contextMenu) {
          closeContextMenu()
        } else {
          clearSelection()
          setFloatingToolbar(null)
        }
        return
      }

      // Delete/Backspace - delete selected item
      if ((e.key === 'Delete' || e.key === 'Backspace') && isAdmin) {
        handleDeleteSelected()
        return
      }

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'c':
            e.preventDefault()
            handleCopy()
            break
          case 'x':
            e.preventDefault()
            handleCut()
            break
          case 'v':
            e.preventDefault()
            handlePaste()
            break
          case 'z':
            e.preventDefault()
            if (e.shiftKey) {
              handleRedo()
            } else {
              handleUndo()
            }
            break
          case 'y':
            e.preventDefault()
            handleRedo()
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isCreatingTransition,
    cancelTransitionCreation,
    floatingToolbar,
    setFloatingToolbar,
    contextMenu,
    closeContextMenu,
    clearSelection,
    isAdmin,
    handleDeleteSelected,
    handleCopy,
    handleCut,
    handlePaste,
    handleUndo,
    handleRedo,
  ])

  return {
    handleCanvasClick,
    handleCanvasContextMenu,
    handleStateStartDrag,
    handleStateStartResize,
    handleStateShowToolbar,
    handleTransitionShowToolbar,
    handleAddWaypointToTransition,
  }
}
