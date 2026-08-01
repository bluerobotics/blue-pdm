/**
 * useWorkflowDialogs - Manages dialog visibility and editing entities
 *
 * Consolidates dialog state that was previously inline in WorkflowsViewContent.
 */
import { useState, useCallback } from 'react'
import type { WorkflowState, WorkflowTransition } from '@/types/workflow'

import type {
  FloatingToolbarState,
  ContextMenuState,
  WaypointContextMenu,
  ClipboardData,
} from '../types'

export interface UseWorkflowDialogsReturn {
  // Dialog visibility
  showCreateWorkflow: boolean
  showEditWorkflow: boolean
  showEditState: boolean
  showEditTransition: boolean

  // Editing entities
  editingState: WorkflowState | null
  editingTransition: WorkflowTransition | null

  // Context menus
  contextMenu: ContextMenuState | null
  waypointContextMenu: WaypointContextMenu | null
  floatingToolbar: FloatingToolbarState | null

  // Snap settings UI
  showSnapSettings: boolean

  // Clipboard
  clipboard: ClipboardData | null

  // Setters
  setShowCreateWorkflow: (v: boolean) => void
  setShowEditWorkflow: (v: boolean) => void
  setShowEditState: (v: boolean) => void
  setShowEditTransition: (v: boolean) => void
  setEditingState: (s: WorkflowState | null) => void
  setEditingTransition: (t: WorkflowTransition | null) => void
  setContextMenu: (m: ContextMenuState | null) => void
  setWaypointContextMenu: (m: WaypointContextMenu | null) => void
  setFloatingToolbar: (t: FloatingToolbarState | null) => void
  setShowSnapSettings: (v: boolean) => void
  setClipboard: (c: ClipboardData | null) => void

  // Helper functions
  openEditState: (state: WorkflowState) => void
  closeEditState: () => void
  openEditTransition: (transition: WorkflowTransition) => void
  closeEditTransition: () => void
  showStateToolbar: (x: number, y: number, stateId: string) => void
  showTransitionToolbar: (x: number, y: number, transitionId: string) => void
  closeContextMenu: () => void
  closeAll: () => void
}

export function useWorkflowDialogs(): UseWorkflowDialogsReturn {
  // Dialog visibility
  const [showCreateWorkflow, setShowCreateWorkflow] = useState(false)
  const [showEditWorkflow, setShowEditWorkflow] = useState(false)
  const [showEditState, setShowEditState] = useState(false)
  const [showEditTransition, setShowEditTransition] = useState(false)

  // Editing entities
  const [editingState, setEditingState] = useState<WorkflowState | null>(null)
  const [editingTransition, setEditingTransition] = useState<WorkflowTransition | null>(null)

  // Context menus
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [waypointContextMenu, setWaypointContextMenu] = useState<WaypointContextMenu | null>(null)
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState | null>(null)

  // Snap settings UI
  const [showSnapSettings, setShowSnapSettings] = useState(false)

  // Clipboard
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)

  // Helper functions
  const openEditState = useCallback((state: WorkflowState) => {
    setEditingState(state)
    setShowEditState(true)
  }, [])

  const closeEditState = useCallback(() => {
    setShowEditState(false)
    setEditingState(null)
  }, [])

  const openEditTransition = useCallback((transition: WorkflowTransition) => {
    setEditingTransition(transition)
    setShowEditTransition(true)
  }, [])

  const closeEditTransition = useCallback(() => {
    setShowEditTransition(false)
    setEditingTransition(null)
  }, [])

  const showStateToolbar = useCallback((x: number, y: number, stateId: string) => {
    setFloatingToolbar({ canvasX: x, canvasY: y, type: 'state', targetId: stateId })
  }, [])

  const showTransitionToolbar = useCallback((x: number, y: number, transitionId: string) => {
    setFloatingToolbar({ canvasX: x, canvasY: y, type: 'transition', targetId: transitionId })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setWaypointContextMenu(null)
  }, [])

  const closeAll = useCallback(() => {
    setContextMenu(null)
    setWaypointContextMenu(null)
    setFloatingToolbar(null)
  }, [])

  return {
    showCreateWorkflow,
    showEditWorkflow,
    showEditState,
    showEditTransition,
    editingState,
    editingTransition,
    contextMenu,
    waypointContextMenu,
    floatingToolbar,
    showSnapSettings,
    clipboard,
    setShowCreateWorkflow,
    setShowEditWorkflow,
    setShowEditState,
    setShowEditTransition,
    setEditingState,
    setEditingTransition,
    setContextMenu,
    setWaypointContextMenu,
    setFloatingToolbar,
    setShowSnapSettings,
    setClipboard,
    openEditState,
    closeEditState,
    openEditTransition,
    closeEditTransition,
    showStateToolbar,
    showTransitionToolbar,
    closeContextMenu,
    closeAll,
  }
}
