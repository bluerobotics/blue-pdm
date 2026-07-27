// Workflow Service Functions for BluePLM
// Handles all Supabase interactions for workflow management

import { supabase } from './supabase'
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
  GateReviewer,
  PendingReview,
  AvailableTransition,
} from '../types/workflow'

// ============================================
// Workflow Templates
// ============================================

export async function getWorkflowTemplates(orgId: string) {
  const { data, error } = await supabase
    .from('workflow_templates')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name')

  return { data, error }
}

export async function getDefaultWorkflow(orgId: string) {
  const { data, error } = await supabase
    .from('workflow_templates')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .eq('is_active', true)
    .single()

  return { data, error }
}

export async function createWorkflowTemplate(
  orgId: string,
  createdBy: string,
  name: string,
  description?: string,
) {
  // First create using the default template function
  const { data: workflowId, error: createError } = await supabase.rpc('create_default_workflow', {
    p_org_id: orgId,
    p_created_by: createdBy,
  })

  if (createError) return { data: null, error: createError }

  // Update name/description if different from default
  if (name !== 'Standard Release Process' || description) {
    const { error: updateError } = await supabase
      .from('workflow_templates')
      .update({ name, description })
      .eq('id', workflowId)

    if (updateError) return { data: null, error: updateError }
  }

  // Return the created workflow
  return supabase.from('workflow_templates').select('*').eq('id', workflowId).single()
}

export async function updateWorkflowTemplate(
  workflowId: string,
  updates: Partial<WorkflowTemplate>,
) {
  // Cast canvas_config to Json for Supabase compatibility
  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
    canvas_config: updates.canvas_config as import('../types/supabase').Json | undefined,
  }
  return supabase
    .from('workflow_templates')
    .update(updateData)
    .eq('id', workflowId)
    .select()
    .single()
}

export async function deleteWorkflowTemplate(workflowId: string) {
  // Soft delete - just mark as inactive
  return supabase.from('workflow_templates').update({ is_active: false }).eq('id', workflowId)
}

// ============================================
// Workflow States
// ============================================

export async function getWorkflowStates(workflowId: string) {
  return supabase
    .from('workflow_states')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('sort_order')
}

export async function createWorkflowState(
  state: Omit<Partial<WorkflowState>, 'id'> & { name: string; workflow_id: string },
) {
  return supabase.from('workflow_states').insert(state).select().single()
}

export async function updateWorkflowState(stateId: string, updates: Partial<WorkflowState>) {
  return supabase.from('workflow_states').update(updates).eq('id', stateId).select().single()
}

export async function deleteWorkflowState(stateId: string) {
  return supabase.from('workflow_states').delete().eq('id', stateId)
}

// ============================================
// Workflow Transitions
// ============================================

export async function getWorkflowTransitions(workflowId: string) {
  return supabase.from('workflow_transitions').select('*').eq('workflow_id', workflowId)
}

export async function createWorkflowTransition(
  transition: Omit<Partial<WorkflowTransition>, 'id'> & {
    workflow_id: string
    from_state_id: string
    to_state_id: string
  },
) {
  // Cast auto_conditions to Json for Supabase compatibility
  const insertData = {
    ...transition,
    auto_conditions: transition.auto_conditions as import('../types/supabase').Json | undefined,
  }
  return supabase.from('workflow_transitions').insert(insertData).select().single()
}

export async function updateWorkflowTransition(
  transitionId: string,
  updates: Partial<WorkflowTransition>,
) {
  // Cast auto_conditions to Json for Supabase compatibility
  const updateData = {
    ...updates,
    auto_conditions: updates.auto_conditions as import('../types/supabase').Json | undefined,
  }
  return supabase
    .from('workflow_transitions')
    .update(updateData)
    .eq('id', transitionId)
    .select()
    .single()
}

export async function deleteWorkflowTransition(transitionId: string) {
  return supabase.from('workflow_transitions').delete().eq('id', transitionId)
}

// ============================================
// Workflow Gates
// ============================================

export async function getGatesForTransitions(transitionIds: string[]) {
  return supabase
    .from('workflow_gates')
    .select('*')
    .in('transition_id', transitionIds)
    .order('sort_order')
}

export async function createWorkflowGate(
  gate: Omit<Partial<WorkflowGate>, 'id'> & { transition_id: string; name: string },
) {
  // Cast types to handle the difference between local and Supabase types
  const insertData = {
    ...gate,
    approval_mode: gate.approval_mode as 'any' | 'all' | 'majority' | null | undefined,
    checklist_items: gate.checklist_items as import('../types/supabase').Json | undefined,
    conditions: gate.conditions as import('../types/supabase').Json | undefined,
  }
  return supabase.from('workflow_gates').insert(insertData).select().single()
}

export async function updateWorkflowGate(gateId: string, updates: Partial<WorkflowGate>) {
  // Cast types to handle the difference between local and Supabase types
  const updateData = {
    ...updates,
    approval_mode: updates.approval_mode as 'any' | 'all' | 'majority' | null | undefined,
    checklist_items: updates.checklist_items as import('../types/supabase').Json | undefined,
    conditions: updates.conditions as import('../types/supabase').Json | undefined,
  }
  return supabase.from('workflow_gates').update(updateData).eq('id', gateId).select().single()
}

export async function deleteWorkflowGate(gateId: string) {
  return supabase.from('workflow_gates').delete().eq('id', gateId)
}

// ============================================
// Gate Reviewers
// ============================================

export async function getGateReviewers(gateId: string) {
  return supabase
    .from('workflow_gate_reviewers')
    .select(
      `
      *,
      user:user_id (
        id,
        email,
        full_name,
        avatar_url
      ),
      workflow_role:workflow_role_id (
        id,
        name,
        color,
        icon
      )
    `,
    )
    .eq('gate_id', gateId)
}

export async function addGateReviewer(
  reviewer: Omit<Partial<GateReviewer>, 'id'> & {
    gate_id: string
    reviewer_type: 'user' | 'role' | 'group' | 'workflow_role'
  },
) {
  return supabase.from('workflow_gate_reviewers').insert(reviewer).select().single()
}

export async function removeGateReviewer(reviewerId: string) {
  return supabase.from('workflow_gate_reviewers').delete().eq('id', reviewerId)
}

// ============================================
// File Workflow Assignments
// ============================================

export async function getFileWorkflowAssignment(fileId: string) {
  return supabase
    .from('file_workflow_assignments')
    .select(
      `
      *,
      current_state:current_state_id (*),
      workflow:workflow_id (*)
    `,
    )
    .eq('file_id', fileId)
    .single()
}

export async function assignWorkflowToFile(
  fileId: string,
  workflowId: string,
  initialStateId: string,
  assignedBy: string,
) {
  return supabase
    .from('file_workflow_assignments')
    .upsert({
      file_id: fileId,
      workflow_id: workflowId,
      current_state_id: initialStateId,
      assigned_by: assignedBy,
    })
    .select()
    .single()
}

export async function updateFileWorkflowState(fileId: string, newStateId: string) {
  return supabase
    .from('file_workflow_assignments')
    .update({ current_state_id: newStateId })
    .eq('file_id', fileId)
    .select()
    .single()
}

// ============================================
// Available Transitions (for file context menu)
// ============================================

export async function getAvailableTransitions(
  fileId: string,
): Promise<{ data: AvailableTransition[] | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('get_available_transitions', {
    p_file_id: fileId,
  })

  return { data, error }
}

// ============================================
// Pending Reviews
// ============================================

export async function getPendingReviews(orgId: string) {
  return supabase
    .from('pending_reviews')
    .select(
      `
      *,
      file:file_id (file_name, file_path),
      gate:gate_id (*),
      requester:requested_by (email, full_name, avatar_url),
      assignee:assigned_to (email, full_name, avatar_url)
    `,
    )
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
}

export async function getMyPendingReviews() {
  const { data, error } = await supabase.rpc('get_my_pending_reviews')
  return { data, error }
}

export async function createPendingReview(
  review: Omit<Partial<PendingReview>, 'id'> & {
    file_id: string
    transition_id: string
    gate_id: string
    org_id: string
    requested_by: string
  },
) {
  return supabase.from('pending_reviews').insert(review).select().single()
}

export async function submitReviewDecision(
  reviewId: string,
  decision: 'approved' | 'rejected',
  reviewedBy: string,
  comment?: string,
  checklistResponses?: Record<string, boolean>,
) {
  return supabase
    .from('pending_reviews')
    .update({
      status: decision,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_comment: comment,
      checklist_responses: checklistResponses || {},
    })
    .eq('id', reviewId)
    .select()
    .single()
}

// ============================================
// Review History
// ============================================

export async function getReviewHistory(
  orgId: string,
  options?: {
    fileId?: string
    reviewedBy?: string
    limit?: number
  },
) {
  let query = supabase
    .from('workflow_review_history')
    .select('*')
    .eq('org_id', orgId)
    .order('reviewed_at', { ascending: false })

  if (options?.fileId) {
    query = query.eq('file_id', options.fileId)
  }
  if (options?.reviewedBy) {
    query = query.eq('reviewed_by', options.reviewedBy)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }

  return query
}

// ============================================
// Workflow Transition (Execute)
// ============================================

export async function executeTransition(
  fileId: string,
  transitionId: string,
  userId: string,
  _options?: {
    comment?: string
    checklistResponses?: Record<string, boolean>
  },
) {
  // Get the transition details with to_state and get org_id from workflow
  const { data: transition, error: transitionError } = await supabase
    .from('workflow_transitions')
    .select(
      `
      *,
      to_state:workflow_states!workflow_transitions_to_state_id_fkey (
        *
      ),
      workflow:workflow_templates!workflow_transitions_workflow_id_fkey (
        org_id
      )
    `,
    )
    .eq('id', transitionId)
    .single()

  if (transitionError || !transition) {
    return { success: false, error: transitionError || new Error('Transition not found') }
  }

  const toState = transition.to_state as { maps_to_file_state?: string } | null
  const workflow = transition.workflow as { org_id: string } | null

  // Check for blocking gates
  const { data: gates } = await supabase
    .from('workflow_gates')
    .select('*')
    .eq('transition_id', transitionId)
    .eq('is_blocking', true)

  if (gates && gates.length > 0) {
    // Check for pending reviews
    const { data: pendingReviews } = await supabase
      .from('pending_reviews')
      .select('*')
      .eq('file_id', fileId)
      .eq('transition_id', transitionId)
      .eq('status', 'pending')

    if (pendingReviews && pendingReviews.length > 0) {
      return {
        success: false,
        error: new Error('This transition has pending reviews'),
        pendingReviews,
      }
    }

    // Create review requests for gates
    if (workflow?.org_id) {
      for (const gate of gates) {
        await supabase.from('pending_reviews').insert({
          org_id: workflow.org_id,
          file_id: fileId,
          transition_id: transitionId,
          gate_id: gate.id,
          requested_by: userId,
          status: 'pending',
        })
      }
    }

    return {
      success: false,
      error: new Error('Review required'),
      requiresReview: true,
    }
  }

  // No blocking gates - execute transition
  const { error: updateError } = await supabase
    .from('file_workflow_assignments')
    .update({ current_state_id: transition.to_state_id })
    .eq('file_id', fileId)

  if (updateError) {
    return { success: false, error: updateError }
  }

  // Update the canonical file state so the vault list reflects the change
  const { error: fileUpdateError } = await supabase
    .from('files')
    .update({
      workflow_state_id: transition.to_state_id,
      state_changed_at: new Date().toISOString(),
      state_changed_by: userId,
    })
    .eq('id', fileId)

  if (fileUpdateError) {
    return { success: false, error: fileUpdateError }
  }

  // Update the legacy file state enum if the workflow state maps to one
  if (toState?.maps_to_file_state) {
    await supabase
      .from('files')
      .update({
        state: toState.maps_to_file_state,
        state_changed_at: new Date().toISOString(),
        state_changed_by: userId,
      })
      .eq('id', fileId)
  }

  return { success: true, toStateId: transition.to_state_id }
}

// ============================================
// Helper: Get full workflow with all related data
// ============================================

export async function getFullWorkflow(workflowId: string) {
  const [workflowResult, statesResult, transitionsResult] = await Promise.all([
    supabase.from('workflow_templates').select('*').eq('id', workflowId).single(),
    getWorkflowStates(workflowId),
    getWorkflowTransitions(workflowId),
  ])

  const workflow = workflowResult.data
  const states = statesResult.data
  const transitions = transitionsResult.data

  if (!workflow) {
    return { data: null, error: new Error('Workflow not found') }
  }

  // Get gates for all transitions
  let gates: Record<string, WorkflowGate[]> = {}
  if (transitions && transitions.length > 0) {
    const { data: allGates } = await getGatesForTransitions(transitions.map((t) => t.id))
    if (allGates) {
      gates = allGates.reduce(
        (acc, gate) => {
          if (!acc[gate.transition_id]) acc[gate.transition_id] = []
          acc[gate.transition_id].push(gate as WorkflowGate)
          return acc
        },
        {} as Record<string, WorkflowGate[]>,
      )
    }
  }

  return {
    data: {
      workflow,
      states: states || [],
      transitions: transitions || [],
      gates,
    },
    error: null,
  }
}
