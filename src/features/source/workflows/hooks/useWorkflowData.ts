// Workflow data management hook - uses centralized Zustand store
import { useCallback, useEffect, useRef, type SetStateAction, type Dispatch } from 'react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
} from '@/types/workflow'
import { workflowService, stateService, transitionService } from '../services'

interface UseWorkflowDataOptions {
  onWorkflowSelect?: (workflow: WorkflowTemplate, states: WorkflowState[]) => void
  onSelectionClear?: () => void
}

export interface WorkflowDetails {
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>
}

export function useWorkflowData(options: UseWorkflowDataOptions = {}) {
  const {
    organization,
    user,
    addToast,
    getEffectiveRole,
    // Workflow slice state
    workflows,
    workflowsLoading,
    workflowStates,
    workflowTransitions,
    workflowGates,
    // Workflow slice actions
    setWorkflows,
    setWorkflowsLoading,
    updateWorkflow: updateWorkflowInStore,
    removeWorkflow: removeWorkflowFromStore,
    setSelectedWorkflowId,
    setWorkflowStates,
    setWorkflowTransitions,
    setWorkflowGates,
    getSelectedWorkflow,
  } = usePDMStore()

  // Derived state
  const selectedWorkflow = getSelectedWorkflow()
  const isLoading = workflowsLoading

  // Incremented per detail load so a slow response can tell it has been superseded
  const loadGenerationRef = useRef(0)

  // Admin check based on effective role
  const effectiveRole = getEffectiveRole()
  const isAdmin = effectiveRole === 'admin' || effectiveRole === 'owner'

  /**
   * Load all workflows for the organization
   */
  const loadWorkflows = useCallback(async () => {
    if (!organization) return []

    setWorkflowsLoading(true)

    const { data, error } = await workflowService.getAll(organization.id)

    if (error) {
      log.error('[Workflow]', 'Failed to load workflows', { error })
      addToast('error', 'Failed to load workflows')
      setWorkflowsLoading(false)
      return []
    }

    const workflowList = (data || []) as WorkflowTemplate[]
    setWorkflows(workflowList)
    setWorkflowsLoading(false)

    // Return data for caller to handle auto-select if needed
    return workflowList
  }, [organization, addToast, setWorkflows, setWorkflowsLoading])

  /**
   * Load workflow details (states, transitions, gates)
   * Returns the loaded data for canvas positioning
   */
  const loadWorkflowDetails = useCallback(
    async (workflow: WorkflowTemplate): Promise<WorkflowDetails | null> => {
      // Clicking through the list faster than the queries return would otherwise
      // let an earlier load finish last and paint the wrong workflow.
      const generation = ++loadGenerationRef.current
      const isStale = () => generation !== loadGenerationRef.current

      const statesResult = await stateService.getByWorkflow(workflow.id)
      if (isStale()) return null
      const statesData = statesResult.data || []
      setWorkflowStates(statesData)

      const transitionsResult = await transitionService.getByWorkflow(workflow.id)
      if (isStale()) return null
      const transitionsData = transitionsResult.data || []
      setWorkflowTransitions(transitionsData)

      let gatesByTransition: Record<string, WorkflowGate[]> = {}
      if (transitionsData.length > 0) {
        const transitionIds = transitionsData.map((t) => t.id)
        const gatesResult = await transitionService.getGatesGroupedByTransition(transitionIds)
        if (isStale()) return null
        gatesByTransition = gatesResult.data || {}
      }
      setWorkflowGates(gatesByTransition)

      return {
        states: statesData,
        transitions: transitionsData,
        gates: gatesByTransition,
      }
    },
    [setWorkflowStates, setWorkflowTransitions, setWorkflowGates],
  )

  /**
   * Select a workflow and load its details
   */
  const selectWorkflow = useCallback(
    async (workflow: WorkflowTemplate) => {
      setSelectedWorkflowId(workflow.id)
      options.onSelectionClear?.()

      const details = await loadWorkflowDetails(workflow)
      if (!details) return null

      options.onWorkflowSelect?.(workflow, details.states)

      return details
    },
    [loadWorkflowDetails, options, setSelectedWorkflowId],
  )

  /**
   * Create a new workflow
   */
  const createWorkflow = useCallback(
    async (name: string, description: string): Promise<boolean> => {
      if (!organization || !user) return false

      // Create the workflow using the default workflow function
      const { data: workflowId, error } = await workflowService.createDefault(
        organization.id,
        user.id,
      )

      if (error || !workflowId) {
        log.error('[Workflow]', 'Failed to create workflow', { error })
        addToast('error', 'Failed to create workflow')
        return false
      }

      // Update the name if different from default
      if (name !== 'Standard Release Process') {
        await workflowService.update(workflowId, { name, description })
      }

      addToast('success', 'Workflow created successfully')
      await loadWorkflows()
      return true
    },
    [organization, user, addToast, loadWorkflows],
  )

  /**
   * Update a workflow
   */
  const updateWorkflow = useCallback(
    async (
      workflowId: string,
      updates: { name: string; description: string },
    ): Promise<boolean> => {
      const { error } = await workflowService.update(workflowId, updates)

      if (error) {
        log.error('[Workflow]', 'Failed to update workflow', { error })
        addToast('error', 'Failed to update workflow')
        return false
      }

      // Update store state
      updateWorkflowInStore(workflowId, updates)

      addToast('success', 'Workflow updated')
      return true
    },
    [addToast, updateWorkflowInStore],
  )

  /**
   * Delete a workflow
   */
  const deleteWorkflow = useCallback(
    async (workflowId: string): Promise<boolean> => {
      const { error } = await workflowService.softDelete(workflowId)

      if (error) {
        log.error('[Workflow]', 'Failed to delete workflow', { error })
        addToast('error', 'Failed to delete workflow')
        return false
      }

      addToast('success', 'Workflow deleted')

      // Remove from store (this also clears selection if needed)
      removeWorkflowFromStore(workflowId)

      return true
    },
    [addToast, removeWorkflowFromStore],
  )

  /**
   * Reload current workflow details
   */
  const reloadCurrentWorkflow = useCallback(async () => {
    if (selectedWorkflow) {
      await loadWorkflowDetails(selectedWorkflow)
    }
  }, [selectedWorkflow, loadWorkflowDetails])

  // Auto-load workflows when organization changes
  useEffect(() => {
    if (!organization) {
      setWorkflows([])
      setWorkflowsLoading(false)
      return
    }

    loadWorkflows()
  }, [organization?.id]) // Only depend on org ID, not the full object

  // Setters that match the React.Dispatch<SetStateAction<T>> API the canvas hooks
  // expect. Updater functions read from the store rather than from a captured
  // render value, so two updates within the same tick can't clobber each other.
  const setStates: Dispatch<SetStateAction<WorkflowState[]>> = useCallback(
    (value) => {
      if (typeof value === 'function') {
        const updater = value as (prev: WorkflowState[]) => WorkflowState[]
        setWorkflowStates(updater(usePDMStore.getState().workflowStates))
      } else {
        setWorkflowStates(value)
      }
    },
    [setWorkflowStates],
  )

  const setTransitions: Dispatch<SetStateAction<WorkflowTransition[]>> = useCallback(
    (value) => {
      if (typeof value === 'function') {
        const updater = value as (prev: WorkflowTransition[]) => WorkflowTransition[]
        setWorkflowTransitions(updater(usePDMStore.getState().workflowTransitions))
      } else {
        setWorkflowTransitions(value)
      }
    },
    [setWorkflowTransitions],
  )

  const setGates: Dispatch<SetStateAction<Record<string, WorkflowGate[]>>> = useCallback(
    (value) => {
      if (typeof value === 'function') {
        const updater = value as (
          prev: Record<string, WorkflowGate[]>,
        ) => Record<string, WorkflowGate[]>
        setWorkflowGates(updater(usePDMStore.getState().workflowGates))
      } else {
        setWorkflowGates(value)
      }
    },
    [setWorkflowGates],
  )

  const setSelectedWorkflow: Dispatch<SetStateAction<WorkflowTemplate | null>> = useCallback(
    (value) => {
      if (typeof value === 'function') {
        const updater = value as (prev: WorkflowTemplate | null) => WorkflowTemplate | null
        const newWorkflow = updater(selectedWorkflow)
        setSelectedWorkflowId(newWorkflow?.id ?? null)
      } else {
        setSelectedWorkflowId(value?.id ?? null)
      }
    },
    [selectedWorkflow, setSelectedWorkflowId],
  )

  return {
    // State - mapped from store
    workflows,
    selectedWorkflow,
    states: workflowStates,
    transitions: workflowTransitions,
    gates: workflowGates,
    isLoading,
    isAdmin,

    // Setters (for external manipulation like undo/redo)
    setStates,
    setTransitions,
    setGates,
    setSelectedWorkflow,

    // Actions
    loadWorkflows,
    selectWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    reloadCurrentWorkflow,
  }
}
