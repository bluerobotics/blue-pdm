// Workflow Types for BluePLM
// SolidWorks PDM-style workflow system with states, transitions, permissions, and automations

// ===========================================
// ENUMS
// ===========================================

export type UserRole = 'admin' | 'engineer' | 'viewer'

// State shapes for visual builder
export type StateShape = 'rectangle' | 'diamond' | 'hexagon' | 'ellipse'

// Transition visual styles
export type TransitionLineStyle = 'solid' | 'dashed' | 'dotted'
export type TransitionPathType = 'straight' | 'spline' | 'elbow'
export type TransitionArrowHead = 'end' | 'start' | 'both' | 'none'
export type TransitionLineThickness = 1 | 2 | 3 | 4 | 6

// Permission types (what can be done to files in a state)
export type StatePermissionType = 
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'add_file'
  | 'rename_file'
  | 'change_state'
  | 'edit_metadata'

// Condition types (for transition conditions)
export type ConditionType = 
  | 'file_path'
  | 'file_extension'
  | 'variable'
  | 'revision'
  | 'category'
  | 'checkout_status'
  | 'user_role'
  | 'workflow_role'
  | 'file_owner'
  | 'custom_sql'

// Condition operators
export type ConditionOperator = 
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'in'
  | 'not_in'
  | 'matches_regex'

// Action types (what happens when transition executes)
export type ActionType = 
  | 'increment_revision'
  | 'set_variable'
  | 'clear_variable'
  | 'send_notification'
  | 'execute_task'
  | 'set_file_permission'
  | 'copy_file'
  | 'run_script'

// Revision scheme types
export type RevisionSchemeType = 
  | 'numeric'       // 1, 2, 3, 4...
  | 'alpha_upper'   // A, B, C, D...
  | 'alpha_lower'   // a, b, c, d...
  | 'alphanumeric'  // A.1, A.2, B.1...
  | 'custom'        // Custom pattern

// Auto-transition trigger types
export type AutoTriggerType = 
  | 'timer'           // After N hours in state
  | 'condition_met'   // When all conditions are met
  | 'all_approvals'   // When all required approvals are obtained
  | 'schedule'        // At specific time/date

// Task types (workflow automations)
export type WorkflowTaskType = 
  | 'convert_pdf'
  | 'convert_step'
  | 'convert_iges'
  | 'convert_edrawings'
  | 'convert_dxf'
  | 'custom_export'
  | 'run_script'
  | 'webhook'

// Notification recipient types
export type NotificationRecipientType = 
  | 'user'
  | 'role'
  | 'workflow_role'
  | 'file_owner'
  | 'file_creator'
  | 'checkout_user'
  | 'previous_state_user'
  | 'all_org'

// Approval mode (how approvals are counted)
export type ApprovalMode = 'any' | 'all' | 'sequential'

// Review status
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

// Canvas interaction modes
export type CanvasMode = 'select' | 'pan' | 'connect'

// ===========================================
// WORKFLOW TEMPLATE
// ===========================================

export interface WorkflowTemplate {
  id: string
  org_id: string
  name: string
  description: string | null
  is_default: boolean
  is_active: boolean
  canvas_config: CanvasConfig
  revision_scheme_id: string | null
  file_conditions: FileConditions | null
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface CanvasConfig {
  zoom: number
  panX: number
  panY: number
}

export interface FileConditions {
  extensions?: string[]     // File extensions this workflow applies to
  folders?: string[]        // Folder paths this workflow applies to
  categories?: string[]     // Category IDs this workflow applies to
}

// ===========================================
// REVISION SCHEME
// ===========================================

export interface RevisionScheme {
  id: string
  org_id: string
  name: string
  description: string | null
  scheme_type: RevisionSchemeType
  start_value: number
  increment_by: number
  major_minor_separator: string
  minor_scheme_type: RevisionSchemeType | null
  custom_pattern: string | null
  prefix: string
  suffix: string
  zero_padding: number
  is_default: boolean
  is_active: boolean
  created_at: string
  created_by: string | null
  updated_at: string
}

// ===========================================
// WORKFLOW STATE
// ===========================================

export interface WorkflowState {
  id: string
  workflow_id: string
  name: string
  label: string | null
  description: string | null
  
  // Visual properties
  shape: StateShape
  color: string
  fill_opacity: number | null
  border_color: string | null
  border_opacity: number | null
  border_thickness: number | null
  corner_radius: number | null
  icon: string
  position_x: number
  position_y: number
  width: number | null
  height: number | null
  
  // State behavior
  is_editable: boolean
  requires_checkout: boolean
  is_initial: boolean           // Starting state for new files
  is_released: boolean          // Files are considered "released" in this state
  is_obsolete: boolean          // Files are considered "obsolete" in this state
  
  sort_order: number
  created_at: string
}

// For visual builder - includes computed UI state
export interface WorkflowStateNode extends WorkflowState {
  isSelected?: boolean
  isDragging?: boolean
  isHovered?: boolean
}

// ===========================================
// WORKFLOW STATE PERMISSIONS
// ===========================================

export interface WorkflowStatePermission {
  id: string
  state_id: string
  
  // Who this permission applies to
  permission_for: 'user' | 'role' | 'workflow_role' | 'all'
  user_id: string | null
  role: UserRole | null
  workflow_role_id: string | null
  
  // What permissions are granted
  can_read: boolean
  can_write: boolean
  can_delete: boolean
  can_add: boolean
  can_rename: boolean
  can_change_state: boolean
  can_edit_metadata: boolean
  
  comment_required_on_change: boolean
  
  created_at: string
  
  // Joined data
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
  workflow_role?: WorkflowRole | null
}

// ===========================================
// WORKFLOW ROLES
// ===========================================

export interface WorkflowRole {
  id: string
  org_id: string
  name: string
  description: string | null
  color: string
  icon: string
  is_active: boolean
  sort_order: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  // Computed
  assigned_users?: WorkflowRoleAssignment[]
  user_count?: number
}

export interface WorkflowRoleAssignment {
  id: string
  user_id: string
  workflow_role_id: string
  assigned_at: string
  assigned_by: string | null
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    role: UserRole
  } | null
}

// ===========================================
// WORKFLOW TRANSITION
// ===========================================

export interface WorkflowTransition {
  id: string
  workflow_id: string
  from_state_id: string
  to_state_id: string
  name: string | null
  description: string | null
  
  // Visual styling
  line_style: TransitionLineStyle
  line_color: string | null
  line_path_type: TransitionPathType | null
  line_arrow_head: TransitionArrowHead | null
  line_thickness: number | null
  
  // Permissions (legacy - use workflow_state_permissions instead)
  allowed_roles: UserRole[]
  allowed_workflow_roles: string[]  // Workflow role IDs that can execute this transition
  
  // Requirements
  comment_required: boolean
  
  // Legacy auto conditions (use workflow_transition_conditions instead)
  auto_conditions: Record<string, unknown> | null
  
  created_at: string
}

// For visual builder
export interface WorkflowTransitionEdge extends WorkflowTransition {
  isSelected?: boolean
  isHovered?: boolean
  fromState?: WorkflowState
  toState?: WorkflowState
}

// ===========================================
// TRANSITION CONDITIONS
// ===========================================

export interface TransitionCondition {
  id: string
  transition_id: string
  name: string
  description: string | null
  condition_type: ConditionType
  
  // Configuration varies by type
  config: TransitionConditionConfig
  operator: ConditionOperator | null
  compare_value: string | null
  
  is_required: boolean
  sort_order: number
  error_message: string | null
  
  created_at: string
}

// Type-safe condition configs
export type TransitionConditionConfig = 
  | FilePathConditionConfig
  | FileExtensionConditionConfig
  | VariableConditionConfig
  | RevisionConditionConfig
  | CategoryConditionConfig
  | CheckoutStatusConditionConfig
  | UserRoleConditionConfig
  | CustomSqlConditionConfig

export interface FilePathConditionConfig {
  folder_path: string
  include_subfolders?: boolean
}

export interface FileExtensionConditionConfig {
  extensions: string[]  // [".sldprt", ".sldasm"]
}

export interface VariableConditionConfig {
  variable_name: string
  // operator and compare_value are in parent
}

export interface RevisionConditionConfig {
  // operator and compare_value are in parent
}

export interface CategoryConditionConfig {
  category_id: string
}

export interface CheckoutStatusConditionConfig {
  must_be_checked_in: boolean
}

export interface UserRoleConditionConfig {
  roles: UserRole[]
}

export interface CustomSqlConditionConfig {
  sql: string
}

// ===========================================
// TRANSITION ACTIONS
// ===========================================

export interface TransitionAction {
  id: string
  transition_id: string
  name: string
  description: string | null
  action_type: ActionType
  execute_when: 'before' | 'after'
  
  // Configuration varies by type
  config: TransitionActionConfig
  
  // For revision increment
  revision_scheme_id: string | null
  increment_type: 'major' | 'minor'
  
  // For variable actions
  variable_name: string | null
  variable_value: string | null  // Can use placeholders: {NOW}, {USER}, {FILE_NAME}
  
  sort_order: number
  continue_on_error: boolean
  is_enabled: boolean
  
  created_at: string
}

// Type-safe action configs
export type TransitionActionConfig = 
  | IncrementRevisionConfig
  | SetVariableConfig
  | ClearVariableConfig
  | SendNotificationConfig
  | ExecuteTaskConfig
  | SetFilePermissionConfig
  | CopyFileConfig
  | RunScriptConfig

export interface IncrementRevisionConfig {
  scheme_id: string
  increment_type: 'major' | 'minor'
}

export interface SetVariableConfig {
  variable_name: string
  value: string
  value_type?: 'text' | 'date' | 'number' | 'boolean'
}

export interface ClearVariableConfig {
  variable_name: string
}

export interface SendNotificationConfig {
  // Handled by workflow_transition_notifications table
}

export interface ExecuteTaskConfig {
  task_id: string
}

export interface SetFilePermissionConfig {
  read_only: boolean
}

export interface CopyFileConfig {
  destination_path: string  // Can use placeholders
  overwrite: boolean
}

export interface RunScriptConfig {
  script_id: string
  parameters: Record<string, unknown>
}

// ===========================================
// TRANSITION NOTIFICATIONS
// ===========================================

export interface TransitionNotification {
  id: string
  transition_id: string
  name: string
  
  // Who to notify
  recipient_type: NotificationRecipientType
  user_id: string | null
  role: UserRole | null
  workflow_role_id: string | null
  
  // Notification content (supports placeholders)
  // {FILE_NAME}, {FILE_PATH}, {FROM_STATE}, {TO_STATE}, {TRANSITION_NAME},
  // {USER_NAME}, {USER_EMAIL}, {REVISION}, {DATE}, {TIME}, {COMMENT}
  subject: string | null
  message: string | null
  
  // Channels
  send_email: boolean
  send_in_app: boolean
  
  priority: 'low' | 'normal' | 'high' | 'urgent'
  
  is_enabled: boolean
  
  created_at: string
}

// ===========================================
// TRANSITION APPROVALS (replaces gates)
// ===========================================

export interface TransitionApproval {
  id: string
  transition_id: string
  name: string
  description: string | null
  
  // Approval settings
  required_count: number
  approval_mode: ApprovalMode
  
  // Timeout
  timeout_hours: number | null
  timeout_action: 'reject' | 'escalate' | 'auto_approve'
  
  // Checklist requirements
  checklist_items: ChecklistItem[]
  
  comment_required: boolean
  
  // Skip permissions
  can_skip_roles: UserRole[]
  can_skip_workflow_roles: string[]
  
  sort_order: number
  is_enabled: boolean
  
  created_at: string
}

export interface ChecklistItem {
  id: string
  label: string
  required: boolean
}

export interface ApprovalReviewer {
  id: string
  approval_id: string
  reviewer_type: NotificationRecipientType
  user_id: string | null
  role: UserRole | null
  workflow_role_id: string | null
  sequence_order: number
  created_at: string
  
  // Joined data
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
  workflow_role?: WorkflowRole | null
}

// ===========================================
// AUTOMATIC TRANSITIONS
// ===========================================

export interface AutoTransition {
  id: string
  transition_id: string
  name: string
  description: string | null
  
  trigger_type: AutoTriggerType
  
  // For timer trigger
  timer_hours: number | null
  
  // For schedule trigger
  schedule_cron: string | null  // e.g., "0 0 * * 1" for every Monday at midnight
  schedule_datetime: string | null
  
  // Additional conditions that must be met
  required_conditions: string[]  // Condition IDs
  
  // Fallback if conditions aren't met
  fallback_action: 'wait' | 'reject' | 'notify'
  
  is_enabled: boolean
  
  created_at: string
}

// ===========================================
// WORKFLOW TASKS (File Conversions & Automations)
// ===========================================

export interface WorkflowTask {
  id: string
  org_id: string
  name: string
  description: string | null
  task_type: WorkflowTaskType
  
  // Task configuration varies by type
  config: WorkflowTaskConfig
  
  // Output configuration (supports placeholders)
  output_folder: string        // {SOURCE_FOLDER}, {ROOT}/Exports, etc.
  output_filename: string      // {FILE_NAME}, {FILE_NAME}_{DATE}, etc.
  output_extension: string | null
  
  // Execution settings
  run_as_background: boolean
  timeout_seconds: number
  retry_on_failure: boolean
  max_retries: number
  
  is_active: boolean
  
  created_at: string
  created_by: string | null
  updated_at: string
}

export type WorkflowTaskConfig = 
  | ConvertPdfConfig
  | ConvertStepConfig
  | ConvertIgesConfig
  | ConvertEdrawingsConfig
  | ConvertDxfConfig
  | CustomExportConfig
  | RunScriptTaskConfig
  | WebhookConfig

export interface ConvertPdfConfig {
  include_annotations?: boolean
  pages?: 'all' | number[]
  dpi?: number
  include_3d?: boolean
}

export interface ConvertStepConfig {
  version?: 'AP203' | 'AP214' | 'AP242'
  include_colors?: boolean
}

export interface ConvertIgesConfig {
  surfaces_only?: boolean
}

export interface ConvertEdrawingsConfig {
  version?: number
}

export interface ConvertDxfConfig {
  version?: string
  include_dimensions?: boolean
}

export interface CustomExportConfig {
  format: string
  options: Record<string, unknown>
}

export interface RunScriptTaskConfig {
  script_path: string
  parameters: Record<string, unknown>
}

export interface WebhookConfig {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers: Record<string, string>
  body_template: string  // JSON template with placeholders
}

// ===========================================
// PENDING APPROVALS
// ===========================================

export interface PendingTransitionApproval {
  id: string
  org_id: string
  file_id: string
  transition_id: string
  approval_id: string
  
  requested_by: string
  requested_at: string
  request_comment: string | null
  
  status: ReviewStatus
  current_assignee: string | null
  
  // Responses collected: { "user_id": { decision, comment, timestamp, checklist } }
  responses: Record<string, ApprovalResponse>
  
  approval_count: number
  rejection_count: number
  
  completed_at: string | null
  final_decision: 'approved' | 'rejected' | 'cancelled' | 'timed_out' | null
  
  expires_at: string | null
  
  created_at: string
  
  // Joined data
  file?: {
    id: string
    file_name: string
    file_path: string
    revision: string
  } | null
  transition?: WorkflowTransition | null
  approval?: TransitionApproval | null
  requester?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
}

export interface ApprovalResponse {
  decision: 'approved' | 'rejected'
  comment: string | null
  timestamp: string
  checklist: Record<string, boolean>
}

// ===========================================
// WORKFLOW HISTORY
// ===========================================

export interface WorkflowHistoryEntry {
  id: string
  org_id: string
  
  event_type: 'state_change' | 'approval' | 'rejection' | 'auto_transition' | 'task_executed' | 'condition_checked'
  
  // File info (snapshot)
  file_id: string | null
  file_path: string
  file_name: string
  file_version: number | null
  
  // Workflow info (snapshot)
  workflow_id: string | null
  workflow_name: string
  
  // State change info
  from_state_id: string | null
  from_state_name: string | null
  to_state_id: string | null
  to_state_name: string | null
  
  // Transition info
  transition_id: string | null
  transition_name: string | null
  
  // Revision info
  old_revision: string | null
  new_revision: string | null
  
  // Who/when
  performed_by: string | null
  performed_by_email: string | null
  performed_at: string
  
  // Details
  comment: string | null
  details: Record<string, unknown> | null
  
  // For approvals
  approval_decision: 'approved' | 'rejected' | null
  checklist_responses: Record<string, boolean> | null
  
  created_at: string
}

// ===========================================
// FILE STATE TRACKING
// ===========================================

export interface FileStateEntry {
  id: string
  file_id: string
  state_id: string
  
  entered_at: string
  entered_by: string | null
  
  auto_transition_scheduled_at: string | null
  auto_transition_id: string | null
  
  is_current: boolean
  left_at: string | null
}

// ===========================================
// FILE WORKFLOW ASSIGNMENT
// ===========================================

export interface FileWorkflowAssignment {
  id: string
  file_id: string
  workflow_id: string
  current_state_id: string | null
  
  assigned_at: string
  assigned_by: string | null
  
  // Joined data
  current_state?: WorkflowState | null
  workflow?: WorkflowTemplate | null
}

// ===========================================
// VISUAL BUILDER TYPES
// ===========================================

export interface DragItem {
  type: 'state' | 'transition'
  id: string
}

export interface WorkflowBuilderState {
  workflow: WorkflowTemplate | null
  states: WorkflowStateNode[]
  transitions: WorkflowTransitionEdge[]
  
  // New data structures (replacing gates)
  statePermissions: Record<string, WorkflowStatePermission[]>  // keyed by state_id
  transitionConditions: Record<string, TransitionCondition[]>   // keyed by transition_id
  transitionActions: Record<string, TransitionAction[]>         // keyed by transition_id
  transitionNotifications: Record<string, TransitionNotification[]>  // keyed by transition_id
  transitionApprovals: Record<string, TransitionApproval[]>     // keyed by transition_id
  approvalReviewers: Record<string, ApprovalReviewer[]>         // keyed by approval_id
  autoTransitions: Record<string, AutoTransition[]>             // keyed by transition_id
  
  // Selection
  selectedStateId: string | null
  selectedTransitionId: string | null
  
  // Canvas state
  canvasMode: CanvasMode
  zoom: number
  panX: number
  panY: number
  
  // Editing state
  isCreatingTransition: boolean
  transitionStartStateId: string | null
  
  // UI state
  isDirty: boolean
  isSaving: boolean
}

// ===========================================
// AVAILABLE TRANSITIONS (for file context menu)
// ===========================================

export interface AvailableTransition {
  transition_id: string
  transition_name: string | null
  to_state_id: string
  to_state_name: string
  to_state_color: string
  has_approvals: boolean       // Renamed from has_gates
  has_conditions: boolean
  user_can_transition: boolean
  conditions_met: boolean
}

// ===========================================
// FORM/DIALOG TYPES
// ===========================================

export interface CreateStateForm {
  name: string
  label: string
  description: string
  color: string
  icon: string
  shape: StateShape
  is_editable: boolean
  requires_checkout: boolean
  is_initial: boolean
  is_released: boolean
  is_obsolete: boolean
}

export interface CreateTransitionForm {
  from_state_id: string
  to_state_id: string
  name: string
  description: string
  line_style: TransitionLineStyle
  comment_required: boolean
  allowed_roles: UserRole[]
}

export interface CreateApprovalForm {
  name: string
  description: string
  required_count: number
  approval_mode: ApprovalMode
  timeout_hours: number | null
  timeout_action: 'reject' | 'escalate' | 'auto_approve'
  checklist_items: ChecklistItem[]
  comment_required: boolean
  can_skip_roles: UserRole[]
}

export interface CreateConditionForm {
  name: string
  description: string
  condition_type: ConditionType
  config: TransitionConditionConfig
  operator: ConditionOperator | null
  compare_value: string
  is_required: boolean
  error_message: string
}

export interface CreateActionForm {
  name: string
  description: string
  action_type: ActionType
  execute_when: 'before' | 'after'
  config: TransitionActionConfig
  revision_scheme_id: string | null
  increment_type: 'major' | 'minor'
  variable_name: string
  variable_value: string
  continue_on_error: boolean
}

export interface CreateNotificationForm {
  name: string
  recipient_type: NotificationRecipientType
  user_id: string | null
  role: UserRole | null
  workflow_role_id: string | null
  subject: string
  message: string
  send_email: boolean
  send_in_app: boolean
  priority: 'low' | 'normal' | 'high' | 'urgent'
}

export interface ReviewDecisionForm {
  decision: 'approved' | 'rejected'
  comment: string
  checklist_responses: Record<string, boolean>
}

// ===========================================
// ICONS FOR STATES
// ===========================================

export const STATE_ICONS = [
  'circle',
  'pencil',
  'eye',
  'check-circle',
  'x-circle',
  'archive',
  'clock',
  'alert-triangle',
  'star',
  'flag',
  'lock',
  'unlock',
  'send',
  'inbox',
  'file-check',
  'file-x',
  'thumbs-up',
  'thumbs-down',
  'user-check',
  'users',
  'shield-check',
  'badge-check',
  'clipboard-check',
  'list-checks',
] as const

export type StateIcon = typeof STATE_ICONS[number]

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
// SHAPE PRESETS
// ===========================================

export const STATE_SHAPES: { name: string; value: StateShape; description: string }[] = [
  { name: 'Rectangle', value: 'rectangle', description: 'Standard state' },
  { name: 'Diamond', value: 'diamond', description: 'Decision point' },
  { name: 'Hexagon', value: 'hexagon', description: 'Process step' },
  { name: 'Ellipse', value: 'ellipse', description: 'Start/end state' },
]

// ===========================================
// HELPER FUNCTIONS
// ===========================================

// Get contrasting text color for a background
export function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#FFFFFF'
}

// Format revision for display
export function formatRevision(revision: string | null, scheme?: RevisionScheme): string {
  if (!revision) return '-'
  if (!scheme) return revision
  return `${scheme.prefix || ''}${revision}${scheme.suffix || ''}`
}

// Get placeholder descriptions for notifications
export const NOTIFICATION_PLACEHOLDERS = [
  { key: '{FILE_NAME}', description: 'Name of the file' },
  { key: '{FILE_PATH}', description: 'Full path of the file' },
  { key: '{FROM_STATE}', description: 'Previous state name' },
  { key: '{TO_STATE}', description: 'New state name' },
  { key: '{TRANSITION_NAME}', description: 'Name of the transition' },
  { key: '{USER_NAME}', description: 'Name of user who performed action' },
  { key: '{USER_EMAIL}', description: 'Email of user who performed action' },
  { key: '{REVISION}', description: 'Current revision number' },
  { key: '{DATE}', description: 'Current date' },
  { key: '{TIME}', description: 'Current time' },
  { key: '{COMMENT}', description: 'Transition comment' },
]

// Legacy compatibility - map old GateType to new ApprovalMode
export type GateType = 'approval' | 'checklist' | 'condition' | 'notification'

// Legacy interface for backwards compatibility
export interface WorkflowGate {
  id: string
  transition_id: string
  name: string
  description: string | null
  gate_type: GateType
  required_approvals: number
  approval_mode: ApprovalMode
  checklist_items: ChecklistItem[]
  conditions: Record<string, unknown> | null
  is_blocking: boolean
  can_be_skipped_by: UserRole[]
  sort_order: number
  created_at: string
}

// Legacy interface
export interface GateReviewer {
  id: string
  gate_id: string
  reviewer_type: NotificationRecipientType
  user_id: string | null
  role: UserRole | null
  group_name: string | null
  workflow_role_id: string | null
  created_at: string
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
  workflow_role?: WorkflowRole | null
}

// Legacy type - remove state_type since we only have states now
export type StateType = 'state'

// Legacy interfaces that referenced gates
export interface GateConfig {
  gate_type?: GateType
  required_approvals?: number
  approval_mode?: ApprovalMode
  checklist_items?: ChecklistItem[]
  allowed_reviewers?: AllowedReviewer[]
  timeout_hours?: number
  can_be_skipped_by?: UserRole[]
}

export interface AllowedReviewer {
  type: 'user' | 'role' | 'workflow_role' | 'file_owner' | 'checkout_user'
  user_id?: string
  role?: UserRole
  workflow_role_id?: string
}

// Legacy - PendingReview mapped to new PendingTransitionApproval
export interface PendingReview {
  id: string
  org_id: string
  file_id: string
  transition_id: string
  gate_id: string  // Now maps to approval_id
  requested_by: string
  requested_at: string
  status: ReviewStatus
  assigned_to: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_comment: string | null
  checklist_responses: Record<string, boolean>
  expires_at: string | null
  created_at: string
  file?: {
    file_name: string
    file_path: string
  } | null
  gate?: WorkflowGate | null
  requester?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
  assignee?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
}

// Legacy - ReviewHistoryEntry mapped to WorkflowHistoryEntry
export interface ReviewHistoryEntry {
  id: string
  org_id: string
  file_id: string | null
  file_path: string
  file_name: string
  workflow_id: string | null
  workflow_name: string
  transition_id: string | null
  from_state_name: string
  to_state_name: string
  gate_id: string | null
  gate_name: string
  requested_by: string | null
  requested_by_email: string
  requested_at: string
  reviewed_by: string | null
  reviewed_by_email: string
  reviewed_at: string
  decision: 'approved' | 'rejected'
  comment: string | null
  checklist_responses: Record<string, boolean> | null
  created_at: string
}
