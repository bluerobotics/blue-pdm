// Floating toolbar action handlers for states and transitions
import { useCallback } from 'react'
import { log } from '@/lib/logger'
import type {
  WorkflowState,
  WorkflowTransition,
  TransitionLineStyle,
  TransitionPathType,
  TransitionArrowHead,
  TransitionLineThickness,
} from '@/types/workflow'
import type { FloatingToolbarState } from '../types'
import { stateService, transitionService } from '../services'

interface UseFloatingToolbarActionsOptions {
  // Core data
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  waypoints: Record<string, Array<{ x: number; y: number }>>
  floatingToolbar: FloatingToolbarState | null

  // Setters
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  setWaypoints: React.Dispatch<
    React.SetStateAction<Record<string, Array<{ x: number; y: number }>>>
  >
  setFloatingToolbar: (toolbar: FloatingToolbarState | null) => void
  setEditingState: (state: WorkflowState | null) => void
  setEditingTransition: (transition: WorkflowTransition | null) => void
  setShowEditState: (show: boolean) => void
  setShowEditTransition: (show: boolean) => void

  // CRUD operations
  deleteState: (stateId: string) => Promise<boolean>
  deleteTransition: (transitionId: string) => Promise<boolean>
  addTransitionGate: (transitionId: string) => Promise<unknown>

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function useFloatingToolbarActions(options: UseFloatingToolbarActionsOptions) {
  const {
    states,
    transitions,
    waypoints,
    floatingToolbar,
    setStates,
    setTransitions,
    setWaypoints,
    setFloatingToolbar,
    setEditingState,
    setEditingTransition,
    setShowEditState,
    setShowEditTransition,
    deleteState,
    deleteTransition,
    addTransitionGate,
    addToast,
  } = options

  /**
   * Handle color change for states or transitions
   */
  const handleColorChange = useCallback(
    async (color: string) => {
      if (!floatingToolbar) return

      if (floatingToolbar.type === 'state') {
        const { error } = await stateService.update(floatingToolbar.targetId, { color })
        if (!error) {
          setStates((prev) =>
            prev.map((s) => (s.id === floatingToolbar.targetId ? { ...s, color } : s)),
          )
        } else {
          log.error('[Workflow]', 'Failed to update state color', { error })
        }
      } else {
        const { error } = await transitionService.update(floatingToolbar.targetId, {
          line_color: color,
        })
        if (!error) {
          setTransitions((prev) =>
            prev.map((t) => (t.id === floatingToolbar.targetId ? { ...t, line_color: color } : t)),
          )
        } else {
          log.error('[Workflow]', 'Failed to update transition color', { error })
        }
      }
    },
    [floatingToolbar, setStates, setTransitions],
  )

  /**
   * Handle line style change for transitions
   */
  const handleLineStyleChange = useCallback(
    async (style: TransitionLineStyle) => {
      if (!floatingToolbar || floatingToolbar.type !== 'transition') return

      const { error } = await transitionService.update(floatingToolbar.targetId, {
        line_style: style,
      })
      if (!error) {
        setTransitions((prev) =>
          prev.map((t) => (t.id === floatingToolbar.targetId ? { ...t, line_style: style } : t)),
        )
      } else {
        log.error('[Workflow]', 'Failed to update line style', { error })
      }
    },
    [floatingToolbar, setTransitions],
  )

  /**
   * Handle path type change for transitions
   */
  const handlePathTypeChange = useCallback(
    async (pathType: TransitionPathType) => {
      if (!floatingToolbar || floatingToolbar.type !== 'transition') return

      const { error } = await transitionService.update(floatingToolbar.targetId, {
        line_path_type: pathType,
      })
      if (!error) {
        setTransitions((prev) =>
          prev.map((t) =>
            t.id === floatingToolbar.targetId ? { ...t, line_path_type: pathType } : t,
          ),
        )

        // When switching TO spline or elbow, ensure there's at least one waypoint for control
        if (pathType === 'spline' || pathType === 'elbow') {
          const existingWaypoints = waypoints[floatingToolbar.targetId]
          if (!existingWaypoints || existingWaypoints.length === 0) {
            // Create a default waypoint at the midpoint
            const transition = transitions.find((t) => t.id === floatingToolbar.targetId)
            if (transition) {
              const fromState = states.find((s) => s.id === transition.from_state_id)
              const toState = states.find((s) => s.id === transition.to_state_id)
              if (fromState && toState) {
                const midX = (fromState.position_x + toState.position_x) / 2
                // For spline, offset up for curve; for elbow, stay at midpoint
                const midY =
                  pathType === 'spline'
                    ? (fromState.position_y + toState.position_y) / 2 - 40
                    : (fromState.position_y + toState.position_y) / 2
                setWaypoints((prev) => ({
                  ...prev,
                  [floatingToolbar.targetId]: [{ x: midX, y: midY }],
                }))
              }
            }
          }
        }
      } else {
        log.error('[Workflow]', 'Failed to update path type', { error })
      }
    },
    [floatingToolbar, states, transitions, waypoints, setTransitions, setWaypoints],
  )

  /**
   * Handle arrow head change for transitions
   */
  const handleArrowHeadChange = useCallback(
    async (arrowHead: TransitionArrowHead) => {
      if (!floatingToolbar || floatingToolbar.type !== 'transition') return

      const { error } = await transitionService.update(floatingToolbar.targetId, {
        line_arrow_head: arrowHead,
      })
      if (!error) {
        setTransitions((prev) =>
          prev.map((t) =>
            t.id === floatingToolbar.targetId ? { ...t, line_arrow_head: arrowHead } : t,
          ),
        )
      } else {
        log.error('[Workflow]', 'Failed to update arrow head', { error })
      }
    },
    [floatingToolbar, setTransitions],
  )

  /**
   * Handle thickness change for transitions
   */
  const handleThicknessChange = useCallback(
    async (thickness: TransitionLineThickness) => {
      if (!floatingToolbar || floatingToolbar.type !== 'transition') return

      const { error } = await transitionService.update(floatingToolbar.targetId, {
        line_thickness: thickness,
      })
      if (!error) {
        setTransitions((prev) =>
          prev.map((t) =>
            t.id === floatingToolbar.targetId ? { ...t, line_thickness: thickness } : t,
          ),
        )
      } else {
        log.error('[Workflow]', 'Failed to update thickness', { error })
      }
    },
    [floatingToolbar, setTransitions],
  )

  /**
   * Handle fill opacity change for states
   */
  const handleFillOpacityChange = useCallback(
    async (opacity: number) => {
      if (!floatingToolbar || floatingToolbar.type !== 'state') return

      const { error } = await stateService.update(floatingToolbar.targetId, {
        fill_opacity: opacity,
      })
      if (!error) {
        setStates((prev) =>
          prev.map((s) =>
            s.id === floatingToolbar.targetId ? { ...s, fill_opacity: opacity } : s,
          ),
        )
      } else {
        log.error('[Workflow]', 'Failed to update fill opacity', { error })
      }
    },
    [floatingToolbar, setStates],
  )

  /**
   * Handle border color change for states
   */
  const handleBorderColorChange = useCallback(
    async (color: string | null) => {
      if (!floatingToolbar || floatingToolbar.type !== 'state') return

      const { error } = await stateService.update(floatingToolbar.targetId, { border_color: color })
      if (!error) {
        setStates((prev) =>
          prev.map((s) => (s.id === floatingToolbar.targetId ? { ...s, border_color: color } : s)),
        )
      } else {
        log.error('[Workflow]', 'Failed to update border color', { error })
      }
    },
    [floatingToolbar, setStates],
  )

  /**
   * Handle border opacity change for states
   */
  const handleBorderOpacityChange = useCallback(
    async (opacity: number) => {
      if (!floatingToolbar || floatingToolbar.type !== 'state') return

      const { error } = await stateService.update(floatingToolbar.targetId, {
        border_opacity: opacity,
      })
      if (!error) {
        setStates((prev) =>
          prev.map((s) =>
            s.id === floatingToolbar.targetId ? { ...s, border_opacity: opacity } : s,
          ),
        )
      } else {
        log.error('[Workflow]', 'Failed to update border opacity', { error })
      }
    },
    [floatingToolbar, setStates],
  )

  /**
   * Handle border thickness change for states
   */
  const handleBorderThicknessChange = useCallback(
    async (thickness: number) => {
      if (!floatingToolbar || floatingToolbar.type !== 'state') return

      const { error } = await stateService.update(floatingToolbar.targetId, {
        border_thickness: thickness,
      })
      if (!error) {
        setStates((prev) =>
          prev.map((s) =>
            s.id === floatingToolbar.targetId ? { ...s, border_thickness: thickness } : s,
          ),
        )
      } else {
        log.error('[Workflow]', 'Failed to update border thickness', { error })
      }
    },
    [floatingToolbar, setStates],
  )

  /**
   * Handle corner radius change for states
   */
  const handleCornerRadiusChange = useCallback(
    async (radius: number) => {
      if (!floatingToolbar || floatingToolbar.type !== 'state') return

      const { error } = await stateService.update(floatingToolbar.targetId, {
        corner_radius: radius,
      })
      if (!error) {
        setStates((prev) =>
          prev.map((s) =>
            s.id === floatingToolbar.targetId ? { ...s, corner_radius: radius } : s,
          ),
        )
      } else {
        log.error('[Workflow]', 'Failed to update corner radius', { error })
      }
    },
    [floatingToolbar, setStates],
  )

  /**
   * Handle shape change for states
   */
  const handleShapeChange = useCallback(
    async (shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse') => {
      if (!floatingToolbar || floatingToolbar.type !== 'state') return

      const { error } = await stateService.update(floatingToolbar.targetId, { shape })
      if (!error) {
        setStates((prev) =>
          prev.map((s) => (s.id === floatingToolbar.targetId ? { ...s, shape } : s)),
        )
      } else {
        log.error('[Workflow]', 'Failed to update shape', { error })
      }
    },
    [floatingToolbar, setStates],
  )

  /**
   * Handle edit action - open edit dialog
   */
  const handleEdit = useCallback(() => {
    if (!floatingToolbar) return

    if (floatingToolbar.type === 'state') {
      const state = states.find((s) => s.id === floatingToolbar.targetId)
      if (state) {
        setEditingState(state)
        setShowEditState(true)
      }
    } else {
      const transition = transitions.find((t) => t.id === floatingToolbar.targetId)
      if (transition) {
        setEditingTransition(transition)
        setShowEditTransition(true)
      }
    }
    setFloatingToolbar(null)
  }, [
    floatingToolbar,
    states,
    transitions,
    setEditingState,
    setShowEditState,
    setEditingTransition,
    setShowEditTransition,
    setFloatingToolbar,
  ])

  /**
   * Handle duplicate action for states
   */
  const handleDuplicate = useCallback(async () => {
    if (!floatingToolbar || floatingToolbar.type !== 'state') return

    const state = states.find((s) => s.id === floatingToolbar.targetId)
    if (state) {
      // Create duplicate state at offset position
      const newState = {
        workflow_id: state.workflow_id,
        name: state.name + ' (copy)',
        label: (state.label || state.name) + ' (copy)',
        description: state.description,
        color: state.color,
        icon: state.icon,
        position_x: state.position_x + 40,
        position_y: state.position_y + 40,
        is_editable: state.is_editable,
        requires_checkout: state.requires_checkout,
        auto_increment_revision: state.auto_increment_revision,
        sort_order: states.length,
        shape: state.shape,
      }

      const { data, error } = await stateService.create(newState)

      if (!error && data) {
        setStates((prev) => [...prev, data])
        addToast('success', 'State duplicated')
      }
    }
    setFloatingToolbar(null)
  }, [floatingToolbar, states, setStates, setFloatingToolbar, addToast])

  /**
   * Handle delete action
   */
  const handleDelete = useCallback(async () => {
    if (!floatingToolbar) return

    if (floatingToolbar.type === 'state') {
      await deleteState(floatingToolbar.targetId)
    } else {
      await deleteTransition(floatingToolbar.targetId)
    }
    setFloatingToolbar(null)
  }, [floatingToolbar, deleteState, deleteTransition, setFloatingToolbar])

  /**
   * Handle add gate action for transitions
   */
  const handleAddGate = useCallback(async () => {
    if (!floatingToolbar || floatingToolbar.type !== 'transition') return

    await addTransitionGate(floatingToolbar.targetId)
    setFloatingToolbar(null)
  }, [floatingToolbar, addTransitionGate, setFloatingToolbar])

  /**
   * Handle close action
   */
  const handleClose = useCallback(() => {
    setFloatingToolbar(null)
  }, [setFloatingToolbar])

  return {
    handleColorChange,
    handleLineStyleChange,
    handlePathTypeChange,
    handleArrowHeadChange,
    handleThicknessChange,
    handleFillOpacityChange,
    handleBorderColorChange,
    handleBorderOpacityChange,
    handleBorderThicknessChange,
    handleCornerRadiusChange,
    handleShapeChange,
    handleEdit,
    handleDuplicate,
    handleDelete,
    handleAddGate,
    handleClose,
  }
}
