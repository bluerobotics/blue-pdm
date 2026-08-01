/**
 * Turns a history entry into the operation that undo or redo has to perform.
 *
 * A history entry always describes what the user did, never its inverse, so
 * undoing and redoing the same entry must produce mirrored operations: undoing
 * an add removes, redoing that add recreates. Keeping the mapping here, away
 * from the database calls, is what makes that symmetry checkable.
 */
import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import type { HistoryEntry } from '../types'

export type HistoryAction =
  | { kind: 'recreate-state'; state: WorkflowState; message: string }
  | { kind: 'remove-state'; stateId: string; message: string }
  | { kind: 'recreate-transition'; transition: WorkflowTransition; message: string }
  | { kind: 'remove-transition'; transitionId: string; message: string }
  | { kind: 'move-state'; stateId: string; x: number; y: number; message: string }

/** The operation that undoes `entry`. */
export function revertAction(entry: HistoryEntry): HistoryAction {
  switch (entry.type) {
    case 'state_add':
      return {
        kind: 'remove-state',
        stateId: entry.state.id,
        message: 'workflows.history.undoStateAdd',
      }
    case 'state_delete':
      return {
        kind: 'recreate-state',
        state: entry.state,
        message: 'workflows.history.undoStateDelete',
      }
    case 'state_move':
      return {
        kind: 'move-state',
        stateId: entry.stateId,
        x: entry.from.x,
        y: entry.from.y,
        message: 'workflows.history.undoStateMove',
      }
    case 'transition_add':
      return {
        kind: 'remove-transition',
        transitionId: entry.transition.id,
        message: 'workflows.history.undoTransitionAdd',
      }
    case 'transition_delete':
      return {
        kind: 'recreate-transition',
        transition: entry.transition,
        message: 'workflows.history.undoTransitionDelete',
      }
  }
}

/** The operation that re-applies `entry` after it was undone. */
export function reapplyAction(entry: HistoryEntry): HistoryAction {
  switch (entry.type) {
    case 'state_add':
      return {
        kind: 'recreate-state',
        state: entry.state,
        message: 'workflows.history.redoStateAdd',
      }
    case 'state_delete':
      return {
        kind: 'remove-state',
        stateId: entry.state.id,
        message: 'workflows.history.redoStateDelete',
      }
    case 'state_move':
      return {
        kind: 'move-state',
        stateId: entry.stateId,
        x: entry.to.x,
        y: entry.to.y,
        message: 'workflows.history.redoStateMove',
      }
    case 'transition_add':
      return {
        kind: 'recreate-transition',
        transition: entry.transition,
        message: 'workflows.history.redoTransitionAdd',
      }
    case 'transition_delete':
      return {
        kind: 'remove-transition',
        transitionId: entry.transition.id,
        message: 'workflows.history.redoTransitionDelete',
      }
  }
}

/** Trim the undo stack to its cap, dropping the oldest entry first. */
export function pushHistory(
  stack: HistoryEntry[],
  entry: HistoryEntry,
  limit: number,
): HistoryEntry[] {
  const next = [...stack, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}
