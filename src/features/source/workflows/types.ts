/**
 * Types for the workflow editor's canvas interactions.
 *
 * Domain types (`WorkflowState`, `WorkflowTransition`, ...) live in
 * `@/types/workflow` and are imported from there directly; this module owns only
 * the ephemeral editor state that never reaches the database.
 */
import type { WorkflowState, WorkflowTemplate, WorkflowTransition } from '@/types/workflow'

export interface TransitionEndpointDrag {
  transitionId: string
  endpoint: 'start' | 'end'
  originalStateId: string
}

export interface ResizingState {
  stateId: string
  handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  startMouseX: number
  startMouseY: number
  startWidth: number
  startHeight: number
}

export interface StateDimensions {
  width: number
  height: number
}

export interface EdgePosition {
  edge: 'left' | 'right' | 'top' | 'bottom'
  fraction: number // 0-1 position along that edge
}

// Type alias for edge positions record
// Keys are formatted as `${transitionId}-start` or `${transitionId}-end`
export type EdgePositions = Record<string, EdgePosition>

export interface SnapSettings {
  gridSize: number
  snapToGrid: boolean
  snapToAlignment: boolean
  alignmentThreshold: number
}

export interface AlignmentGuides {
  vertical: number | null
  horizontal: number | null
}

export interface SnappingResult {
  x: number
  y: number
  verticalGuide: number | null
  horizontalGuide: number | null
}

/**
 * A history entry always describes the action the user performed, never its
 * inverse. Undo reverts it and redo re-applies it, so the same entry can move
 * between the two stacks unchanged and an undo/redo cycle is symmetric.
 */
export type HistoryEntry =
  | { type: 'state_add'; state: WorkflowState }
  | { type: 'state_delete'; state: WorkflowState }
  | { type: 'state_move'; stateId: string; from: Point; to: Point }
  | { type: 'transition_add'; transition: WorkflowTransition }
  | { type: 'transition_delete'; transition: WorkflowTransition }

export type ClipboardData =
  | { type: 'state'; data: WorkflowState }
  | { type: 'transition'; data: WorkflowTransition }

// Context menu types
export interface ContextMenuState {
  x: number
  y: number
  type: 'state' | 'transition' | 'canvas'
  targetId: string
  canvasX?: number
  canvasY?: number
}

export interface WaypointContextMenu {
  x: number
  y: number
  canvasX: number
  canvasY: number
  transitionId: string
  waypointIndex: number | null
}

// Floating toolbar types
export interface FloatingToolbarState {
  canvasX: number
  canvasY: number
  type: 'state' | 'transition'
  targetId: string
}

// Path and waypoint types
export interface Point {
  x: number
  y: number
}

export interface PointWithEdge extends Point {
  edge: 'left' | 'right' | 'top' | 'bottom'
  /**
   * Unit vector pointing out of the node at this point. Present when the anchor
   * was resolved against the node's real outline, where the surface direction
   * is not necessarily the axis the `edge` names - the side of a diamond faces
   * diagonally, and every point on an ellipse faces somewhere different.
   * Consumers fall back to the axis implied by `edge` when it is absent.
   */
  normal?: Point
}

// Workflow role type (simplified for UI)
export interface WorkflowRoleBasic {
  id: string
  name: string
  color: string
  icon: string
}

// Dialog props
export interface CreateWorkflowDialogProps {
  onClose: () => void
  onCreate: (name: string, description: string) => void
}

export interface EditWorkflowDialogProps {
  workflow: WorkflowTemplate
  onClose: () => void
  onSave: (name: string, description: string) => void
  onDelete: () => void
}

export interface EditStateDialogProps {
  state: WorkflowState
  onClose: () => void
  onSave: (updates: Partial<WorkflowState>) => void
}

export interface EditTransitionDialogProps {
  transition: WorkflowTransition
  onClose: () => void
  onSave: (updates: Partial<WorkflowTransition>) => void
}
