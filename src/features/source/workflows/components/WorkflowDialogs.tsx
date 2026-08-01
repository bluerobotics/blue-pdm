/**
 * WorkflowDialogs - Renders all workflow editor dialogs
 *
 * Consolidates Create/Edit workflow dialogs and Edit state/transition dialogs.
 */
import { log } from '@/lib/logger'
import {
  CreateWorkflowDialog,
  EditWorkflowDialog,
  EditStateDialog,
  EditTransitionDialog,
} from '../dialogs'
import { stateService, transitionService } from '../services'
import type { WorkflowTemplate, WorkflowState, WorkflowTransition } from '@/types/workflow'

interface WorkflowDialogsProps {
  // Visibility
  showCreateWorkflow: boolean
  showEditWorkflow: boolean
  showEditState: boolean
  showEditTransition: boolean

  // Data
  selectedWorkflow: WorkflowTemplate | null
  editingState: WorkflowState | null
  editingTransition: WorkflowTransition | null

  // Actions
  createWorkflow: (name: string, description: string) => Promise<boolean>
  updateWorkflow: (id: string, updates: { name: string; description: string }) => Promise<boolean>
  deleteWorkflow: (id: string) => Promise<boolean>
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>

  // Close handlers
  setShowCreateWorkflow: (v: boolean) => void
  setShowEditWorkflow: (v: boolean) => void
  closeEditState: () => void
  closeEditTransition: () => void

  // Toast
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export function WorkflowDialogs({
  showCreateWorkflow,
  showEditWorkflow,
  showEditState,
  showEditTransition,
  selectedWorkflow,
  editingState,
  editingTransition,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  setStates,
  setTransitions,
  setShowCreateWorkflow,
  setShowEditWorkflow,
  closeEditState,
  closeEditTransition,
  addToast,
}: WorkflowDialogsProps) {
  return (
    <>
      {showCreateWorkflow && (
        <CreateWorkflowDialog
          onClose={() => setShowCreateWorkflow(false)}
          onCreate={async (name, description) => {
            const success = await createWorkflow(name, description)
            if (success) setShowCreateWorkflow(false)
          }}
        />
      )}

      {showEditWorkflow && selectedWorkflow && (
        <EditWorkflowDialog
          workflow={selectedWorkflow}
          onClose={() => setShowEditWorkflow(false)}
          onSave={async (name, description) => {
            const success = await updateWorkflow(selectedWorkflow.id, { name, description })
            if (success) setShowEditWorkflow(false)
          }}
          onDelete={async () => {
            const success = await deleteWorkflow(selectedWorkflow.id)
            if (success) setShowEditWorkflow(false)
          }}
        />
      )}

      {showEditState && editingState && (
        <EditStateDialog
          state={editingState}
          onClose={closeEditState}
          onSave={async (updates) => {
            const { error } = await stateService.update(editingState.id, updates)
            if (error) {
              log.error('[Workflow]', 'Failed to update state', { error })
              addToast('error', 'Failed to update state')
              return
            }
            setStates((prev) =>
              prev.map((s) => (s.id === editingState.id ? { ...s, ...updates } : s)),
            )
            closeEditState()
            addToast('success', 'State updated')
          }}
        />
      )}

      {showEditTransition && editingTransition && (
        <EditTransitionDialog
          transition={editingTransition}
          onClose={closeEditTransition}
          onSave={async (updates) => {
            const { error } = await transitionService.update(editingTransition.id, updates)
            if (error) {
              log.error('[Workflow]', 'Failed to update transition', { error })
              addToast('error', 'Failed to update transition')
              return
            }
            setTransitions((prev) =>
              prev.map((t) => (t.id === editingTransition.id ? { ...t, ...updates } : t)),
            )
            closeEditTransition()
            addToast('success', 'Transition updated')
          }}
        />
      )}
    </>
  )
}
