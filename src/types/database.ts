/**
 * Database Types - Re-exports and Custom Extensions
 *
 * This file provides:
 *   1. Re-exports from auto-generated supabase.ts
 *   2. Helper types for extracting table rows/inserts/updates
 *   3. Convenience type aliases for common tables
 *   4. Custom interfaces with joined fields (for views/queries)
 *   5. Custom type unions not defined in the database
 *
 * NOTE: supabase.ts is auto-generated. To regenerate after schema changes:
 *   npm run gen:types
 *
 * Requires SUPABASE_ACCESS_TOKEN in .env file (get from supabase.com/dashboard/account/tokens)
 *
 * @see ./supabase.ts for auto-generated types (DO NOT EDIT THAT FILE)
 */

// ===========================================
// Re-exports from auto-generated types
// ===========================================

export type { Database, Json } from './supabase'
import type { Database } from './supabase'

// ===========================================
// Helper Types for Table Access
// ===========================================

/** Extract the Row type from a table */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

/** Extract the Insert type from a table */
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

/** Extract the Update type from a table */
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

/** Extract an enum type */
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]

// ===========================================
// Convenience Type Aliases
// ===========================================

// Core entities
export type Organization = Tables<'organizations'>
export type UserProfile = Tables<'users'>
export type Team = Tables<'teams'>
export type TeamMember = Tables<'team_members'>

// Files and vaults
export type FileRecord = Tables<'files'>
export type Vault = Tables<'vaults'>
export type FileVersion = Tables<'file_versions'>

// Inspection
export type InspectionCharacteristic = Tables<'inspection_characteristics'>
export type InspectionCharacteristicInsert = TablesInsert<'inspection_characteristics'>
export type InspectionCharacteristicUpdate = TablesUpdate<'inspection_characteristics'>
export type InspectionCharacteristicVersion = Tables<'inspection_characteristic_versions'>
export type InspectionMethod = Tables<'inspection_methods'>
export type InspectionMethodInsert = TablesInsert<'inspection_methods'>

// Workflows
export type WorkflowTemplate = Tables<'workflow_templates'>
export type WorkflowState = Tables<'workflow_states'>
export type WorkflowTransition = Tables<'workflow_transitions'>
export type WorkflowGate = Tables<'workflow_gates'>
export type WorkflowRole = Tables<'workflow_roles'>

// Reviews
export type Review = Tables<'reviews'>
export type ReviewResponse = Tables<'review_responses'>

// Notifications
export type Notification = Tables<'notifications'>

// ECO/Change Management
export type ECORow = Tables<'ecos'>
export type FileEco = Tables<'file_ecos'>
export type EcoChecklistItem = Tables<'eco_checklist_items'>
export type EcoGateApproval = Tables<'eco_gate_approvals'>
export type EcoChecklistActivity = Tables<'eco_checklist_activity'>

// Process Templates
export type ProcessTemplate = Tables<'process_templates'>
export type ProcessTemplatePhase = Tables<'process_template_phases'>
export type ProcessTemplateItem = Tables<'process_template_items'>

// Webhooks
export type Webhook = Tables<'webhooks'>
export type WebhookDelivery = Tables<'webhook_deliveries'>

// Metadata
export type FileMetadataColumn = Tables<'file_metadata_columns'>

// Suppliers
export type SupplierRow = Tables<'suppliers'>
export type SupplierContact = Tables<'supplier_contacts'>

// ===========================================
// Custom Type Unions (not in database)
// ===========================================

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'kicked_back'

export type NotificationType =
  // File Reviews
  | 'review_request'
  | 'review_approved'
  | 'review_rejected'
  | 'review_kicked_back'
  | 'review_comment'
  // Change Management (ECO/ECR)
  | 'eco_submitted'
  | 'eco_approved'
  | 'eco_rejected'
  | 'eco_comment'
  | 'ecr_submitted'
  | 'ecr_approved'
  | 'ecr_rejected'
  // Purchasing
  | 'po_approval_request'
  | 'po_approved'
  | 'po_rejected'
  | 'supplier_approval_request'
  | 'supplier_approved'
  | 'supplier_rejected'
  | 'rfq_response_received'
  // Quality
  | 'ncr_created'
  | 'ncr_assigned'
  | 'ncr_resolved'
  | 'capa_created'
  | 'capa_assigned'
  | 'capa_due_soon'
  | 'capa_overdue'
  | 'fai_submitted'
  | 'fai_approved'
  | 'calibration_due'
  | 'calibration_overdue'
  // Workflow
  | 'workflow_state_change'
  | 'workflow_approval_request'
  | 'workflow_approved'
  | 'workflow_rejected'
  // General
  | 'mention'
  | 'file_updated'
  | 'file_checked_in'
  | 'checkout_request'
  | 'comment_added'
  | 'task_assigned'
  | 'task_due_soon'
  | 'task_overdue'
  | 'system_alert'

export type NotificationCategory =
  | 'review'
  | 'change'
  | 'purchasing'
  | 'quality'
  | 'workflow'
  | 'system'
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

export type AccountType = 'user' | 'supplier'
export type SupplierAuthMethod = 'email' | 'phone' | 'wechat'

export type MetadataColumnType = 'text' | 'number' | 'date' | 'boolean' | 'select'

export type WebhookEvent =
  | 'file.created'
  | 'file.updated'
  | 'file.deleted'
  | 'file.checked_in'
  | 'file.checked_out'
  | 'file.state_changed'
  | 'file.revision_changed'
  | 'eco.created'
  | 'eco.updated'
  | 'eco.completed'
  | 'review.requested'
  | 'review.approved'
  | 'review.rejected'
  | 'rfq.created'
  | 'rfq.sent'
  | 'rfq.quoted'
  | 'rfq.awarded'
  | 'supplier.created'
  | 'supplier.updated'

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying'
export type WebhookTriggerFilter = 'everyone' | 'roles' | 'users'

export type ChecklistItemStatus = 'not_started' | 'in_progress' | 'complete' | 'blocked' | 'na'

export type EcoChecklistAction =
  | 'item_added'
  | 'item_removed'
  | 'status_changed'
  | 'assigned'
  | 'unassigned'
  | 'target_date_changed'
  | 'gate_approved'
  | 'gate_unapproved'
  | 'notes_updated'
  | 'link_added'
  | 'link_removed'

// ===========================================
// Annotation Types (PDF commenting / spatial annotations)
// ===========================================

/** The type of annotation placed on a file or PDF page */
export type AnnotationType = 'area' | 'text' | 'highlight' | 'file'

/** Spatial position data for area/highlight annotations on a PDF page */
export interface AnnotationPosition {
  x: number
  y: number
  width: number
  height: number
  pageWidth: number
  pageHeight: number
}

/** A file annotation (comment) with optional spatial positioning and threading */
export interface FileAnnotation {
  id: string
  file_id: string
  user_id: string
  comment: string
  page_number: number | null
  position: AnnotationPosition | null
  annotation_type: AnnotationType
  parent_id: string | null
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  file_version: number | null
  edited_at: string | null
  created_at: string
  // Joined fields
  user?: { email: string; full_name: string | null; avatar_url: string | null }
  replies?: FileAnnotation[]
}

// ===========================================
// Shared Domain Types
// ===========================================

/** Base user info returned by org member queries (canonical shape — extend, don't redefine) */
export interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

/** ECO with denormalized UI fields (file_count, created_by_name, etc.) */
export interface ECO {
  id: string
  eco_number: string
  title: string | null
  description: string | null
  status: 'open' | 'in_progress' | 'completed' | 'cancelled' | null
  created_at: string | null
  created_by: string
  file_count?: number
  created_by_name?: string | null
  created_by_email?: string
}

/** Supplier summary for UI display */
export interface Supplier {
  id: string
  name: string
  code: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  city: string | null
  state: string | null
  country: string | null
  is_active: boolean | null
  is_approved: boolean | null
  erp_id: string | null
  erp_synced_at: string | null
  created_at: string | null
}

/** Part-Supplier association (vendors for a specific file/item) */
export interface PartSupplier {
  id: string
  org_id: string
  file_id: string
  supplier_id: string
  supplier?: Supplier
  supplier_part_number: string | null
  supplier_description: string | null
  supplier_url: string | null
  unit_price: number | null
  currency: string | null
  price_unit: string | null
  price_breaks: Array<{ qty: number; price: number }> | null
  min_order_qty: number | null
  order_multiple: number | null
  lead_time_days: number | null
  is_preferred: boolean | null
  is_active: boolean | null
  is_qualified: boolean | null
  qualified_at: string | null
  notes: string | null
  last_price_update: string | null
  created_at: string | null
  updated_at: string | null
}

// ===========================================
// Extended Interfaces (with joined fields)
// These are for queries that join multiple tables
// ===========================================

/** File with checkout info and user details */
export interface FileWithCheckout extends Omit<FileRecord, 'checkout_info'> {
  checkout_info?: {
    user_id: string
    user_email: string
    user_name: string | null
    machine_id: string
    machine_name: string | null
    checked_out_at: string
  } | null
}

/** User profile with organization details */
export interface UserWithOrg extends UserProfile {
  organization?: {
    id: string
    name: string
    slug: string
  }
}

/** Review with file info and responses */
export interface ReviewWithDetails extends Review {
  file?: {
    file_name: string
    file_path: string
    extension: string
    part_number?: string | null
    description?: string | null
    revision?: string | null
  }
  requester?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  }
  responses?: Array<
    ReviewResponse & {
      reviewer?: {
        id?: string
        email: string
        full_name: string | null
        avatar_url: string | null
      }
    }
  >
}

/** Notification with related entity details */
export interface NotificationWithDetails extends Notification {
  from_user?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
  review?: ReviewWithDetails
  file?: {
    file_name: string
    file_path: string
  } | null
  /** Alias for entity_id when entity_type is 'review' */
  review_id?: string
}

/** ECO checklist item with user details */
export interface EcoChecklistItemWithUsers extends EcoChecklistItem {
  accountable_user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  }
  responsible_user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  }
  link_file?: {
    id: string
    file_name: string
    file_path: string
  }
}

/** ECO gate approval with approver details */
export interface EcoGateApprovalWithUser extends EcoGateApproval {
  approver?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  }
}

/** Process template with phases and items */
export interface ProcessTemplateWithPhases extends ProcessTemplate {
  phases?: Array<
    ProcessTemplatePhase & {
      items?: ProcessTemplateItem[]
    }
  >
}

/** Supplier contact with supplier info */
export interface SupplierContactWithSupplier extends SupplierContact {
  supplier?: {
    id: string
    name: string
    code: string | null
    org_id: string
  }
}

/** Supplier account check result */
export interface SupplierAccountCheck {
  is_supplier: boolean
  is_invitation?: boolean
  contact_id?: string
  invitation_id?: string
  supplier_id?: string
  supplier_name?: string
  full_name?: string
  contact_name?: string
  auth_method?: SupplierAuthMethod
  org_id?: string
}

/** Webhook with delivery statistics */
export interface WebhookWithStats extends Webhook {
  recent_deliveries?: WebhookDelivery[]
}

/** Workflow state with position for canvas rendering */
export interface WorkflowStateWithPosition extends WorkflowState {
  position?: { x: number; y: number }
}

/** Workflow transition with source/target state names */
export interface WorkflowTransitionWithStates extends WorkflowTransition {
  source_state?: WorkflowState
  target_state?: WorkflowState
}
