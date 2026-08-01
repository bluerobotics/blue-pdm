import { describe, expect, it } from 'vitest'

import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import type { HistoryEntry } from '../types'

import { pushHistory, reapplyAction, revertAction } from './historyActions'

const state = { id: 's1', name: 'Development' } as WorkflowState
const transition = { id: 't1' } as WorkflowTransition

const move: HistoryEntry = {
  type: 'state_move',
  stateId: 's1',
  from: { x: 10, y: 20 },
  to: { x: 300, y: 400 },
}

describe('revertAction', () => {
  it('removes a state that was added', () => {
    expect(revertAction({ type: 'state_add', state })).toMatchObject({
      kind: 'remove-state',
      stateId: 's1',
    })
  })

  it('recreates a state that was deleted', () => {
    expect(revertAction({ type: 'state_delete', state })).toMatchObject({
      kind: 'recreate-state',
      state,
    })
  })

  it('moves a state back to where it started', () => {
    expect(revertAction(move)).toMatchObject({ kind: 'move-state', x: 10, y: 20 })
  })

  it('removes a transition that was added', () => {
    expect(revertAction({ type: 'transition_add', transition })).toMatchObject({
      kind: 'remove-transition',
      transitionId: 't1',
    })
  })

  it('recreates a transition that was deleted', () => {
    expect(revertAction({ type: 'transition_delete', transition })).toMatchObject({
      kind: 'recreate-transition',
      transition,
    })
  })
})

describe('reapplyAction', () => {
  it('re-adds a state rather than deleting it again', () => {
    expect(reapplyAction({ type: 'state_add', state })).toMatchObject({
      kind: 'recreate-state',
      state,
    })
  })

  it('re-deletes a state rather than restoring it', () => {
    expect(reapplyAction({ type: 'state_delete', state })).toMatchObject({
      kind: 'remove-state',
      stateId: 's1',
    })
  })

  it('moves a state to its post-drag position', () => {
    expect(reapplyAction(move)).toMatchObject({ kind: 'move-state', x: 300, y: 400 })
  })

  it('re-adds a transition rather than deleting it again', () => {
    expect(reapplyAction({ type: 'transition_add', transition })).toMatchObject({
      kind: 'recreate-transition',
    })
  })
})

describe('undo/redo symmetry', () => {
  const entries: HistoryEntry[] = [
    { type: 'state_add', state },
    { type: 'state_delete', state },
    move,
    { type: 'transition_add', transition },
    { type: 'transition_delete', transition },
  ]

  it('maps every entry to opposite operations for undo and redo', () => {
    const opposite: Record<string, string> = {
      'recreate-state': 'remove-state',
      'remove-state': 'recreate-state',
      'recreate-transition': 'remove-transition',
      'remove-transition': 'recreate-transition',
    }

    for (const entry of entries) {
      const undo = revertAction(entry)
      const redo = reapplyAction(entry)

      if (undo.kind === 'move-state' && redo.kind === 'move-state') {
        expect({ x: undo.x, y: undo.y }).not.toEqual({ x: redo.x, y: redo.y })
        continue
      }

      expect(redo.kind).toBe(opposite[undo.kind])
    }
  })
})

describe('pushHistory', () => {
  const entry: HistoryEntry = { type: 'state_add', state }

  it('appends the newest entry at the end', () => {
    expect(pushHistory([], entry, 3)).toEqual([entry])
  })

  it('drops the oldest entries once the cap is reached', () => {
    const older: HistoryEntry[] = [
      { type: 'state_delete', state: { ...state, id: 'a' } as WorkflowState },
      { type: 'state_delete', state: { ...state, id: 'b' } as WorkflowState },
    ]

    const result = pushHistory(older, entry, 2)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(older[1])
    expect(result[1]).toBe(entry)
  })
})
