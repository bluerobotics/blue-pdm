// Clipboard operations for workflow states and transitions
import { useCallback } from 'react'

import { log } from '@/lib/logger'
import type { WorkflowTemplate, WorkflowState, WorkflowTransition } from '@/types/workflow'

import { PASTE_OFFSET } from '../constants'
import type { ClipboardData, HistoryEntry } from '../types'
import { stateService, transitionService, unwrapRequired } from '../services'
import type { DeleteOptions } from './useWorkflowCRUD'

interface UseClipboardOperationsOptions {
  // Core data
  selectedWorkflow: WorkflowTemplate | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  isAdmin: boolean

  // Selection state
  selectedStateId: string | null
  selectedTransitionId: string | null

  // Clipboard
  clipboard: ClipboardData | null
  setClipboard: (data: ClipboardData | null) => void

  // Setters
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  setSelectedStateId: (id: string | null) => void
  setSelectedTransitionId: (id: string | null) => void

  // Deletion is delegated to the CRUD hook so cut and delete share one path
  // (permission check, layout cleanup, undo entry, selection reset).
  deleteState: (stateId: string, options?: DeleteOptions) => Promise<boolean>
  deleteTransition: (transitionId: string, options?: DeleteOptions) => Promise<boolean>

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void

  // Undo/redo support
  pushToUndo: (entry: HistoryEntry) => void
}

export function useClipboardOperations(options: UseClipboardOperationsOptions) {
  const {
    selectedWorkflow,
    states,
    transitions,
    isAdmin,
    selectedStateId,
    selectedTransitionId,
    clipboard,
    setClipboard,
    setStates,
    setTransitions,
    setSelectedStateId,
    setSelectedTransitionId,
    deleteState,
    deleteTransition,
    addToast,
    pushToUndo,
  } = options

  /**
   * Copy selected item to clipboard
   */
  const handleCopy = useCallback(() => {
    if (selectedStateId) {
      const state = states.find((s) => s.id === selectedStateId)
      if (state) {
        setClipboard({ type: 'state', data: state })
        addToast('success', 'State copied')
      }
    } else if (selectedTransitionId) {
      const transition = transitions.find((t) => t.id === selectedTransitionId)
      if (transition) {
        setClipboard({ type: 'transition', data: transition })
        addToast('success', 'Transition copied')
      }
    }
  }, [selectedStateId, selectedTransitionId, states, transitions, setClipboard, addToast])

  /**
   * Cut selected item (copy + delete)
   */
  const handleCut = useCallback(async () => {
    if (!isAdmin) return

    if (selectedStateId) {
      const state = states.find((s) => s.id === selectedStateId)
      if (!state) return

      // Only take the clipboard copy once the row is actually gone, so a failed
      // delete doesn't leave the user thinking they hold a cut item.
      if (await deleteState(selectedStateId, { silent: true })) {
        setClipboard({ type: 'state', data: state })
        addToast('success', 'State cut')
      }
    } else if (selectedTransitionId) {
      const transition = transitions.find((t) => t.id === selectedTransitionId)
      if (!transition) return

      if (await deleteTransition(selectedTransitionId, { silent: true })) {
        setClipboard({ type: 'transition', data: transition })
        addToast('success', 'Transition cut')
      }
    }
  }, [
    isAdmin,
    selectedStateId,
    selectedTransitionId,
    states,
    transitions,
    deleteState,
    deleteTransition,
    setClipboard,
    addToast,
  ])

  /**
   * Paste from clipboard
   */
  const handlePaste = useCallback(async () => {
    if (!clipboard || !isAdmin || !selectedWorkflow) return

    try {
      if (clipboard.type === 'state') {
        // Omit the identity columns; everything else, including size and styling,
        // is carried over so a pasted node looks like the one that was copied.
        const { id: _id, created_at: _createdAt, ...stateData } = clipboard.data
        const createdState = await unwrapRequired(
          stateService.create({
            ...stateData,
            workflow_id: selectedWorkflow.id,
            position_x: clipboard.data.position_x + PASTE_OFFSET,
            position_y: clipboard.data.position_y + PASTE_OFFSET,
            name: `${clipboard.data.name} (copy)`,
          }),
          'Paste state',
        )

        setStates((prev) => [...prev, createdState])
        pushToUndo({ type: 'state_add', state: createdState })
        setSelectedStateId(createdState.id)
        addToast('success', 'State pasted')
      } else if (clipboard.type === 'transition') {
        const fromExists = states.some((s) => s.id === clipboard.data.from_state_id)
        const toExists = states.some((s) => s.id === clipboard.data.to_state_id)

        if (!fromExists || !toExists) {
          addToast('error', 'Cannot paste: source or target state not found')
          return
        }

        const exists = transitions.some(
          (t) =>
            t.from_state_id === clipboard.data.from_state_id &&
            t.to_state_id === clipboard.data.to_state_id,
        )
        if (exists) {
          addToast('error', 'Transition already exists')
          return
        }

        const { id: _tid, created_at: _tCreatedAt, ...transitionData } = clipboard.data
        const createdTransition = await unwrapRequired(
          transitionService.create({
            ...transitionData,
            workflow_id: selectedWorkflow.id,
            name: `${clipboard.data.name} (copy)`,
          }),
          'Paste transition',
        )

        setTransitions((prev) => [...prev, createdTransition])
        pushToUndo({ type: 'transition_add', transition: createdTransition })
        setSelectedTransitionId(createdTransition.id)
        addToast('success', 'Transition pasted')
      }
    } catch (error) {
      log.error('[Workflow]', 'Paste failed', { error })
      addToast('error', 'Paste failed')
    }
  }, [
    clipboard,
    isAdmin,
    selectedWorkflow,
    states,
    transitions,
    setStates,
    setTransitions,
    setSelectedStateId,
    setSelectedTransitionId,
    addToast,
    pushToUndo,
  ])

  /**
   * Delete selected item
   */
  const handleDeleteSelected = useCallback(async () => {
    if (!isAdmin) return

    if (selectedStateId) {
      await deleteState(selectedStateId)
    } else if (selectedTransitionId) {
      await deleteTransition(selectedTransitionId)
    }
  }, [isAdmin, selectedStateId, selectedTransitionId, deleteState, deleteTransition])

  return {
    handleCopy,
    handleCut,
    handlePaste,
    handleDeleteSelected,
  }
}
