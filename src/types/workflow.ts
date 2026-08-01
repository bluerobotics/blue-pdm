// Workflow Types for BluePLM
// SolidWorks PDM-style workflow system: states, transitions, gates and reviews.
//
// The table-backed interfaces below all `extend` their generated Row type, so a
// column can never be invented here and can never silently disappear when the
// schema changes. Where the interface narrows a field it is because the column
// carries a NOT NULL default that the generator cannot see, so the value is
// always present on rows the application reads.

import type { Json, Tables } from './database'

// ===========================================
// ENUMS (mirror the Postgres enums)
// ===========================================

export type UserRole = 'admin' | 'engineer' | 'viewer'

export type StateShape = 'rectangle' | 'diamond' | 'hexagon' | 'ellipse'
export type StateType = 'state' | 'gate'

export type TransitionLineStyle = 'solid' | 'dashed' | 'dotted'
export type TransitionPathType = 'straight' | 'spline' | 'elbow'
export type TransitionArrowHead = 'none' | 'end' | 'start' | 'both'
export type TransitionEdge = 'left' | 'right' | 'top' | 'bottom'

/** Stroke widths offered in the editor toolbar. Stored as a plain integer. */
export type TransitionLineThickness = 1 | 2 | 3 | 4 | 6

export type GateType = 'approval' | 'checklist' | 'condition'
export type ApprovalMode = 'any' | 'all' | 'majority'
export type ReviewerType = 'user' | 'role' | 'group' | 'workflow_role'
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'kicked_back'

// Canvas interaction modes (editor-only, no database counterpart)
export type CanvasMode = 'select' | 'pan' | 'connect'

// ===========================================
// WORKFLOW TEMPLATE
// ===========================================

export interface CanvasConfig {
  zoom: number
  panX: number
  panY: number
}

export interface WorkflowTemplate extends Omit<Tables<'workflow_templates'>, 'canvas_config'> {
  canvas_config: CanvasConfig | null
}

// ===========================================
// WORKFLOW STATE
// ===========================================

export interface WorkflowState extends Tables<'workflow_states'> {
  shape: StateShape
  state_type: StateType
  color: string
  icon: string
  position_x: number
  position_y: number
  is_editable: boolean
  requires_checkout: boolean
  auto_increment_revision: boolean
  triggers_review: boolean
  required_workflow_roles: string[]
  sort_order: number
}

// ===========================================
// WORKFLOW TRANSITION
// ===========================================

export interface WorkflowTransition extends Tables<'workflow_transitions'> {
  line_style: TransitionLineStyle
  line_path_type: TransitionPathType
  line_arrow_head: TransitionArrowHead
  allowed_workflow_roles: string[]
  start_edge: TransitionEdge | null
  end_edge: TransitionEdge | null
}

// ===========================================
// WORKFLOW ROLES
// ===========================================

export interface WorkflowRole extends Tables<'workflow_roles'> {
  color: string
  icon: string
  // Computed by the roles view, not stored
  user_count?: number
}

// ===========================================
// WORKFLOW GATES (transition approval requirements)
// ===========================================

export interface ChecklistItem {
  id: string
  label: string
  required: boolean
}

// checklist_items and conditions stay raw JSONB; use parseChecklistItems to narrow
export interface WorkflowGate extends Tables<'workflow_gates'> {
  gate_type: GateType
  approval_mode: ApprovalMode
  is_blocking: boolean
  required_approvals: number
}

/** Narrow a gate's JSONB checklist into typed items, discarding malformed entries. */
export function parseChecklistItems(value: Json): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const { id, label, required } = entry
    if (typeof id !== 'string' || typeof label !== 'string') return []
    return [{ id, label, required: required === true }]
  })
}

export interface GateReviewer extends Tables<'workflow_gate_reviewers'> {
  reviewer_type: ReviewerType
  user?: ReviewerSummary | null
  workflow_role?: WorkflowRole | null
}

interface ReviewerSummary {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

// ===========================================
// REVIEWS
// ===========================================

export interface PendingReview extends Tables<'pending_reviews'> {
  status: ReviewStatus
  // Joined for the review inbox
  file?: { file_name: string; file_path: string } | null
  gate?: WorkflowGate | null
  requester?: Omit<ReviewerSummary, 'id'> | null
  assignee?: Omit<ReviewerSummary, 'id'> | null
}

// ===========================================
// FILE ASSIGNMENT AND HISTORY
// ===========================================

export type FileWorkflowAssignment = Tables<'file_workflow_assignments'>

export type WorkflowHistoryEntry = Tables<'workflow_history'>

export type FileStateEntry = Tables<'file_state_entries'>

// ===========================================
// ENGINE RESULTS
// ===========================================

/** Row shape returned by the get_available_transitions RPC. */
export interface AvailableTransition {
  transition_id: string
  transition_name: string | null
  to_state_id: string
  to_state_name: string
  to_state_color: string
  has_gates: boolean
  user_can_transition: boolean
}

/** Row shape returned by the get_my_pending_reviews RPC. */
export interface MyPendingReview {
  review_id: string
  file_id: string
  file_name: string
  file_path: string
  gate_id: string
  gate_name: string
  gate_type: GateType
  transition_id: string
  transition_name: string | null
  from_state_name: string
  to_state_name: string
  requested_by: string
  requested_by_email: string
  requested_at: string
  checklist_items: Json
}

/** Result of execute_workflow_transition and complete_gate_review. */
export interface TransitionResult {
  success: boolean
  /** Set when the transition opened one or more blocking gates instead of advancing. */
  requires_review: boolean
  new_state_id: string | null
  new_state_name: string | null
  new_revision: string | null
  error_code: string | null
  error_message: string | null
}

// ===========================================
// COLOR PRESETS FOR STATES
// ===========================================

export const STATE_COLORS = [
  { name: 'Gray', value: '#6B7280' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Amber', value: '#EAB308' },
  { name: 'Yellow', value: '#FACC15' },
  { name: 'Lime', value: '#84CC16' },
  { name: 'Green', value: '#22C55E' },
  { name: 'Emerald', value: '#10B981' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Sky', value: '#0EA5E9' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Violet', value: '#8B5CF6' },
  { name: 'Purple', value: '#A855F7' },
  { name: 'Fuchsia', value: '#D946EF' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Rose', value: '#F43F5E' },
] as const

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/** Pick black or white text so a label stays readable on a coloured node. */
export function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#FFFFFF'
}
