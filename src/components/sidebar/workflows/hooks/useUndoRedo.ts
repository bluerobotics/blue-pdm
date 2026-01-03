// @ts-nocheck - Generic state setter types
// Undo/Redo history management hook
import { useState, useCallback } from 'react'
import { MAX_HISTORY } from '../constants'
import type { HistoryEntry, ClipboardData, WorkflowState, WorkflowTransition } from '../types'
import { supabase } from '../../../../lib/supabase'

interface UseUndoRedoOptions {
  isAdmin: boolean
  addToast: (type: 'success' | 'error' | 'info', message: string) => void
  setStates: (updater: (prev: WorkflowState[]) => WorkflowState[]) => void
  setTransitions: (updater: (prev: WorkflowTransition[]) => WorkflowTransition[]) => void
}

export function useUndoRedo({
  isAdmin,
  addToast,
  setStates,
  setTransitions
}: UseUndoRedoOptions) {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)

  /**
   * Push to undo stack
   */
  const pushToUndo = useCallback((entry: HistoryEntry) => {
    setUndoStack(prev => {
      const newStack = [...prev, entry]
      if (newStack.length > MAX_HISTORY) newStack.shift()
      return newStack
    })
    setRedoStack([]) // Clear redo when new action is performed
  }, [])

  /**
   * Undo last action
   */
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || !isAdmin) return
    
    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    
    try {
      switch (entry.type) {
        case 'state_delete':
          // Re-add the deleted state
          const { data: restoredState, error: stateError } = await supabase
            .from('workflow_states')
            .insert(entry.data.state)
            .select()
            .single()
          if (stateError) throw stateError
          setStates(prev => [...prev, restoredState])
          setRedoStack(prev => [...prev, { type: 'state_add', data: { state: restoredState } }])
          addToast('success', 'Undo: State restored')
          break
          
        case 'state_add':
          // Delete the added state
          await supabase.from('workflow_states').delete().eq('id', entry.data.state.id)
          setStates(prev => prev.filter(s => s.id !== entry.data.state.id))
          setRedoStack(prev => [...prev, { type: 'state_delete', data: entry.data }])
          addToast('success', 'Undo: State removed')
          break
          
        case 'transition_delete':
          // Re-add the deleted transition
          const { data: restoredTrans, error: transError } = await supabase
            .from('workflow_transitions')
            .insert(entry.data.transition)
            .select()
            .single()
          if (transError) throw transError
          setTransitions(prev => [...prev, restoredTrans])
          setRedoStack(prev => [...prev, { type: 'transition_add', data: { transition: restoredTrans } }])
          addToast('success', 'Undo: Transition restored')
          break
          
        case 'transition_add':
          // Delete the added transition
          await supabase.from('workflow_transitions').delete().eq('id', entry.data.transition.id)
          setTransitions(prev => prev.filter(t => t.id !== entry.data.transition.id))
          setRedoStack(prev => [...prev, { type: 'transition_delete', data: entry.data }])
          addToast('success', 'Undo: Transition removed')
          break
          
        case 'state_move':
          // Move state back to original position
          await supabase
            .from('workflow_states')
            .update({ position_x: entry.data.oldX, position_y: entry.data.oldY })
            .eq('id', entry.data.stateId)
          setStates(prev => prev.map(s => 
            s.id === entry.data.stateId 
              ? { ...s, position_x: entry.data.oldX, position_y: entry.data.oldY }
              : s
          ))
          setRedoStack(prev => [...prev, { 
            type: 'state_move', 
            data: { stateId: entry.data.stateId, oldX: entry.data.newX, oldY: entry.data.newY, newX: entry.data.oldX, newY: entry.data.oldY }
          }])
          addToast('success', 'Undo: State moved back')
          break
      }
    } catch (err) {
      console.error('Undo failed:', err)
      addToast('error', 'Undo failed')
    }
  }, [undoStack, isAdmin, addToast, setStates, setTransitions])

  /**
   * Redo last undone action
   */
  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0 || !isAdmin) return
    
    const entry = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    
    try {
      switch (entry.type) {
        case 'state_add':
          const { data: readdedState, error: stateError } = await supabase
            .from('workflow_states')
            .insert(entry.data.state)
            .select()
            .single()
          if (stateError) throw stateError
          setStates(prev => [...prev, readdedState])
          setUndoStack(prev => [...prev, { type: 'state_delete', data: { state: readdedState } }])
          break
          
        case 'state_delete':
          await supabase.from('workflow_states').delete().eq('id', entry.data.state.id)
          setStates(prev => prev.filter(s => s.id !== entry.data.state.id))
          setUndoStack(prev => [...prev, { type: 'state_add', data: entry.data }])
          break
          
        case 'transition_add':
          const { data: readdedTrans, error: transError } = await supabase
            .from('workflow_transitions')
            .insert(entry.data.transition)
            .select()
            .single()
          if (transError) throw transError
          setTransitions(prev => [...prev, readdedTrans])
          setUndoStack(prev => [...prev, { type: 'transition_delete', data: { transition: readdedTrans } }])
          break
          
        case 'transition_delete':
          await supabase.from('workflow_transitions').delete().eq('id', entry.data.transition.id)
          setTransitions(prev => prev.filter(t => t.id !== entry.data.transition.id))
          setUndoStack(prev => [...prev, { type: 'transition_add', data: entry.data }])
          break
          
        case 'state_move':
          await supabase
            .from('workflow_states')
            .update({ position_x: entry.data.newX, position_y: entry.data.newY })
            .eq('id', entry.data.stateId)
          setStates(prev => prev.map(s => 
            s.id === entry.data.stateId 
              ? { ...s, position_x: entry.data.newX, position_y: entry.data.newY }
              : s
          ))
          setUndoStack(prev => [...prev, { 
            type: 'state_move', 
            data: { stateId: entry.data.stateId, oldX: entry.data.newX, oldY: entry.data.newY, newX: entry.data.oldX, newY: entry.data.oldY }
          }])
          break
      }
    } catch (err) {
      console.error('Redo failed:', err)
      addToast('error', 'Redo failed')
    }
  }, [redoStack, isAdmin, addToast, setStates, setTransitions])

  return {
    undoStack,
    redoStack,
    clipboard,
    setClipboard,
    pushToUndo,
    handleUndo,
    handleRedo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0
  }
}
