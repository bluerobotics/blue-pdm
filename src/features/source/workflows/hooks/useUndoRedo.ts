// Undo/Redo history management hook
import { useState, useCallback } from 'react'

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'

import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import { MAX_HISTORY } from '../constants'
import type { HistoryEntry } from '../types'
import { stateService, transitionService, layoutService, unwrap } from '../services'

import { pushHistory, reapplyAction, revertAction, type HistoryAction } from './historyActions'

interface UseUndoRedoOptions {
  isAdmin: boolean
  addToast: (type: 'success' | 'error' | 'info', message: string) => void
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
}

export function useUndoRedo({ isAdmin, addToast, setStates, setTransitions }: UseUndoRedoOptions) {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])

  const pushToUndo = useCallback((entry: HistoryEntry) => {
    setUndoStack((prev) => pushHistory(prev, entry, MAX_HISTORY))
    setRedoStack([]) // A new action invalidates anything that was undone
  }, [])

  const clearHistory = useCallback(() => {
    setUndoStack([])
    setRedoStack([])
  }, [])

  // ============================================
  // Primitives shared by undo and redo
  // ============================================

  const recreateState = useCallback(
    async (state: WorkflowState) => {
      // Recreating with the original id keeps every later history entry, and any
      // transition that references this state, pointing at something real.
      const restored = await unwrap(stateService.create(state))
      if (!restored) throw new Error('State was not restored')
      setStates((prev) => [...prev.filter((s) => s.id !== restored.id), restored as WorkflowState])
    },
    [setStates],
  )

  const removeState = useCallback(
    async (stateId: string) => {
      layoutService.cancelPending([stateId])
      await unwrap(stateService.delete(stateId))
      setStates((prev) => prev.filter((s) => s.id !== stateId))
    },
    [setStates],
  )

  const recreateTransition = useCallback(
    async (transition: WorkflowTransition) => {
      const restored = await unwrap(transitionService.create(transition))
      if (!restored) throw new Error('Transition was not restored')
      setTransitions((prev) => [
        ...prev.filter((tr) => tr.id !== restored.id),
        restored as WorkflowTransition,
      ])
    },
    [setTransitions],
  )

  const removeTransition = useCallback(
    async (transitionId: string) => {
      layoutService.cancelPending([transitionId])
      await unwrap(transitionService.delete(transitionId))
      setTransitions((prev) => prev.filter((tr) => tr.id !== transitionId))
    },
    [setTransitions],
  )

  const moveState = useCallback(
    async (stateId: string, x: number, y: number) => {
      await unwrap(stateService.updatePosition(stateId, Math.round(x), Math.round(y)))
      setStates((prev) =>
        prev.map((s) =>
          s.id === stateId ? { ...s, position_x: Math.round(x), position_y: Math.round(y) } : s,
        ),
      )
    },
    [setStates],
  )

  // ============================================
  // Undo / redo
  // ============================================

  /** Run one mapped operation and return the message to show for it. */
  const perform = useCallback(
    async (action: HistoryAction) => {
      switch (action.kind) {
        case 'recreate-state':
          await recreateState(action.state)
          break
        case 'remove-state':
          await removeState(action.stateId)
          break
        case 'recreate-transition':
          await recreateTransition(action.transition)
          break
        case 'remove-transition':
          await removeTransition(action.transitionId)
          break
        case 'move-state':
          await moveState(action.stateId, action.x, action.y)
          break
      }
      return t(action.message)
    },
    [removeState, recreateState, moveState, removeTransition, recreateTransition],
  )

  const revert = useCallback(
    (entry: HistoryEntry) => perform(revertAction(entry)),
    [perform],
  )

  const reapply = useCallback(
    (entry: HistoryEntry) => perform(reapplyAction(entry)),
    [perform],
  )

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || !isAdmin) return

    const entry = undoStack[undoStack.length - 1]
    setUndoStack((prev) => prev.slice(0, -1))

    try {
      addToast('success', await revert(entry))
      setRedoStack((prev) => [...prev, entry])
    } catch (error) {
      // The write failed, so the entry has not been undone: put it back rather
      // than leaving the canvas and the database disagreeing.
      log.error('[Workflow]', 'Undo failed', { error })
      setUndoStack((prev) => [...prev, entry])
      addToast('error', t('workflows.history.undoFailed'))
    }
  }, [undoStack, isAdmin, addToast, revert])

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0 || !isAdmin) return

    const entry = redoStack[redoStack.length - 1]
    setRedoStack((prev) => prev.slice(0, -1))

    try {
      addToast('success', await reapply(entry))
      setUndoStack((prev) => [...prev, entry])
    } catch (error) {
      log.error('[Workflow]', 'Redo failed', { error })
      setRedoStack((prev) => [...prev, entry])
      addToast('error', t('workflows.history.redoFailed'))
    }
  }, [redoStack, isAdmin, addToast, reapply])

  return {
    undoStack,
    redoStack,
    pushToUndo,
    clearHistory,
    handleUndo,
    handleRedo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }
}
