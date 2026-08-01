// CRUD operations for workflow states, transitions, and gates
import { useCallback } from 'react'
import { log } from '@/lib/logger'
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
} from '@/types/workflow'
import type { EdgePosition, HistoryEntry } from '../types'
import { stateService, transitionService, layoutService } from '../services'
import { anchorPatch } from '../services/layoutService'

export interface DeleteOptions {
  /** Suppress the success toast when the caller reports the outcome itself. */
  silent?: boolean
}

interface UseWorkflowCRUDOptions {
  // Core data
  selectedWorkflow: WorkflowTemplate | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>
  isAdmin: boolean

  // Setters
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  setGates: React.Dispatch<React.SetStateAction<Record<string, WorkflowGate[]>>>
  setSelectedStateId: (id: string | null) => void
  setSelectedTransitionId: (id: string | null) => void
  setEditingState: (state: WorkflowState | null) => void
  setEditingTransition: (transition: WorkflowTransition | null) => void
  setEditingGate: (gate: WorkflowGate | null) => void
  setShowEditState: (show: boolean) => void
  setShowEditTransition: (show: boolean) => void
  setShowEditGate: (show: boolean) => void
  setFloatingToolbar: (
    toolbar: {
      canvasX: number
      canvasY: number
      type: 'state' | 'transition'
      targetId: string
    } | null,
  ) => void

  // Transition creation state
  setIsCreatingTransition: (creating: boolean) => void
  setTransitionStartId: (id: string | null) => void
  setTransitionStartAnchor: (anchor: EdgePosition | null) => void
  setIsDraggingToCreateTransition: (dragging: boolean) => void
  setHoveredStateId: (id: string | null) => void
  transitionStartId: string | null

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void

  // Undo/redo support
  pushToUndo?: (entry: HistoryEntry) => void
}

export function useWorkflowCRUD(options: UseWorkflowCRUDOptions) {
  const {
    selectedWorkflow,
    states,
    transitions,
    gates,
    isAdmin,
    setStates,
    setTransitions,
    setGates,
    setSelectedStateId,
    setSelectedTransitionId,
    setEditingState,
    setEditingTransition,
    setEditingGate,
    setShowEditState,
    setShowEditTransition,
    setShowEditGate,
    setFloatingToolbar,
    setIsCreatingTransition,
    setTransitionStartId,
    setTransitionStartAnchor,
    setIsDraggingToCreateTransition,
    setHoveredStateId,
    transitionStartId,
    addToast,
    pushToUndo,
  } = options

  /**
   * Add a new state to the workflow
   */
  const addState = useCallback(async () => {
    if (!selectedWorkflow || !isAdmin) return null

    const newState = {
      workflow_id: selectedWorkflow.id,
      shape: 'rectangle' as const,
      name: 'New State',
      label: 'New State',
      description: '',
      color: '#6B7280',
      icon: 'circle',
      position_x: 250 + states.length * 50,
      position_y: 200,
      is_editable: true,
      requires_checkout: true,
      auto_increment_revision: false,
      sort_order: states.length,
    }

    const { data, error } = await stateService.create(newState)

    if (error || !data) {
      log.error('[Workflow]', 'Failed to add state', { error })
      addToast('error', 'Failed to add state')
      return null
    }

    const createdState = data as WorkflowState
    setStates((prev) => [...prev, createdState])
    setSelectedStateId(createdState.id)
    setEditingState(createdState)
    setShowEditState(true)
    pushToUndo?.({ type: 'state_add', state: createdState })

    return createdState
  }, [
    selectedWorkflow,
    isAdmin,
    states.length,
    setStates,
    setSelectedStateId,
    setEditingState,
    setShowEditState,
    addToast,
    pushToUndo,
  ])

  /**
   * Delete a state from the workflow
   */
  const deleteState = useCallback(
    async (stateId: string, options?: DeleteOptions) => {
      if (!isAdmin) return false

      // Check if state has transitions
      const hasTransitions = transitions.some(
        (t) => t.from_state_id === stateId || t.to_state_id === stateId,
      )

      if (hasTransitions) {
        addToast('error', 'Remove all transitions first')
        return false
      }

      const state = states.find((s) => s.id === stateId)

      const { error } = await stateService.delete(stateId)

      if (error) {
        log.error('[Workflow]', 'Failed to delete state', { error })
        addToast('error', 'Failed to delete state')
        return false
      }

      // Layout writes queued during the last gesture would otherwise resurrect
      // this row's columns after the delete has already gone through.
      layoutService.cancelPending([stateId])

      setStates((prev) => prev.filter((s) => s.id !== stateId))
      setSelectedStateId(null)
      setFloatingToolbar(null)
      if (!options?.silent) addToast('success', 'State deleted')

      if (pushToUndo && state) {
        pushToUndo({ type: 'state_delete', state })
      }

      return true
    },
    [
      isAdmin,
      transitions,
      states,
      setStates,
      setSelectedStateId,
      setFloatingToolbar,
      addToast,
      pushToUndo,
    ],
  )

  /**
   * Update state position (for drag operations)
   */
  const updateStatePosition = useCallback(
    async (stateId: string, x: number, y: number) => {
      const { error } = await stateService.updatePosition(stateId, Math.round(x), Math.round(y))

      if (error) {
        log.error('[Workflow]', 'Failed to update state position', { error })
        return
      }

      // Use functional updater to avoid stale closure issues
      setStates((prev) =>
        prev.map((s) =>
          s.id === stateId ? { ...s, position_x: Math.round(x), position_y: Math.round(y) } : s,
        ),
      )
    },
    [setStates],
  )

  /** Clear every trace of an in-flight connection, however it ended. */
  const finishTransitionCreation = useCallback(() => {
    setIsCreatingTransition(false)
    setTransitionStartId(null)
    setTransitionStartAnchor(null)
    setIsDraggingToCreateTransition(false)
    setHoveredStateId(null)
  }, [
    setIsCreatingTransition,
    setTransitionStartId,
    setTransitionStartAnchor,
    setIsDraggingToCreateTransition,
    setHoveredStateId,
  ])

  /**
   * Complete transition creation by connecting to target state.
   *
   * The anchors the user dropped on are written in the insert itself, so the
   * finished arrow renders exactly where the preview was: it used to be created
   * anchorless and then given an arched waypoint, which made it jump away from
   * where it had been drawn. A null anchor is a deliberate choice, not a missing
   * value - it means the endpoint attaches to the node and re-routes as it moves.
   */
  const completeTransition = useCallback(
    async (toStateId: string, anchors?: { start: EdgePosition | null; end: EdgePosition | null }) => {
      if (!selectedWorkflow || !transitionStartId || !isAdmin) return null

      // Don't allow self-transitions
      if (transitionStartId === toStateId) {
        finishTransitionCreation()
        return null
      }

      // Check if transition already exists
      const exists = transitions.some(
        (t) => t.from_state_id === transitionStartId && t.to_state_id === toStateId,
      )

      if (exists) {
        addToast('error', 'Transition already exists')
        finishTransitionCreation()
        return null
      }

      const newTransition = {
        workflow_id: selectedWorkflow.id,
        from_state_id: transitionStartId,
        to_state_id: toStateId,
        line_style: 'solid' as const,
        ...anchorPatch('start', anchors?.start ?? null),
        ...anchorPatch('end', anchors?.end ?? null),
      }

      const { data, error } = await transitionService.create(newTransition)

      if (error || !data) {
        log.error('[Workflow]', 'Failed to create transition', { error })
        addToast('error', 'Failed to create transition')
        finishTransitionCreation()

        return null
      }

      const createdTransition = data as WorkflowTransition

      // Use functional updater to avoid stale closure issues
      setTransitions((prev) => [...prev, createdTransition])
      setSelectedTransitionId(createdTransition.id)
      setEditingTransition(createdTransition)
      setShowEditTransition(true)

      finishTransitionCreation()
      pushToUndo?.({ type: 'transition_add', transition: createdTransition })

      return createdTransition
    },
    [
      selectedWorkflow,
      transitionStartId,
      isAdmin,
      transitions,
      setTransitions,
      setSelectedTransitionId,
      setEditingTransition,
      setShowEditTransition,
      finishTransitionCreation,
      addToast,
      pushToUndo,
    ],
  )

  /**
   * Delete a transition
   */
  const deleteTransition = useCallback(
    async (transitionId: string, options?: DeleteOptions) => {
      if (!isAdmin) return false

      const transition = transitions.find((t) => t.id === transitionId)

      const { error } = await transitionService.delete(transitionId)

      if (error) {
        log.error('[Workflow]', 'Failed to delete transition', { error })
        addToast('error', 'Failed to delete transition')
        return false
      }

      layoutService.cancelPending([transitionId])

      setTransitions((prev) => prev.filter((t) => t.id !== transitionId))
      // The database cascades the gates; drop them locally too so a transition
      // that later reuses this id doesn't inherit them.
      setGates((prev) => {
        if (!(transitionId in prev)) return prev
        const { [transitionId]: _removed, ...rest } = prev
        return rest
      })
      setSelectedTransitionId(null)
      setFloatingToolbar(null)
      if (!options?.silent) addToast('success', 'Transition deleted')

      if (pushToUndo && transition) {
        pushToUndo({ type: 'transition_delete', transition })
      }

      return true
    },
    [
      isAdmin,
      transitions,
      setTransitions,
      setGates,
      setSelectedTransitionId,
      setFloatingToolbar,
      addToast,
      pushToUndo,
    ],
  )

  /**
   * Add a gate (approval requirement) to a transition
   */
  const addTransitionGate = useCallback(
    async (transitionId: string) => {
      if (!isAdmin) return null

      const newGate = {
        transition_id: transitionId,
        name: 'New Gate',
        gate_type: 'approval' as const,
        required_approvals: 1,
        approval_mode: 'any' as const,
        is_blocking: true,
        can_be_skipped_by: [] as ('admin' | 'engineer' | 'viewer')[],
        checklist_items: [] as { id: string; label: string; required: boolean }[],
        sort_order: gates[transitionId]?.length || 0,
      }

      const { data, error } = await transitionService.createGate(newGate)

      if (error || !data) {
        log.error('[Workflow]', 'Failed to add gate', { error })
        addToast('error', 'Failed to add gate')
        return null
      }

      const createdGate = data as WorkflowGate

      setGates((prev) => ({
        ...prev,
        [transitionId]: [...(prev[transitionId] || []), createdGate],
      }))
      setEditingGate(createdGate)
      setShowEditGate(true)

      return createdGate
    },
    [isAdmin, gates, setGates, setEditingGate, setShowEditGate, addToast],
  )

  return {
    // State operations
    addState,
    deleteState,
    updateStatePosition,

    // Transition operations
    completeTransition,
    deleteTransition,

    // Gate operations
    addTransitionGate,
  }
}
