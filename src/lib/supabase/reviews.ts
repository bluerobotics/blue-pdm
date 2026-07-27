/**
 * Review helpers: CRUD operations, workflow triggers, and team fetching.
 */

import { getSupabaseClient } from './client'
import type { Review, ReviewStatus } from '../../types/database'

// ============================================
// Review CRUD
// ============================================

/**
 * Create a review request for a file
 */
export async function createReviewRequest(
  orgId: string,
  fileId: string,
  vaultId: string | null,
  requestedBy: string,
  reviewerIds: string[],
  fileVersion: number,
  title?: string,
  message?: string,
  dueDate?: string,
  priority?: 'low' | 'normal' | 'high' | 'urgent',
  teamId?: string,
): Promise<{ review: Review | null; error?: string }> {
  const client = getSupabaseClient()

  // Create the review
  const insertData: Record<string, unknown> = {
    org_id: orgId,
    file_id: fileId,
    vault_id: vaultId,
    requested_by: requestedBy,
    title: title || null,
    due_date: dueDate || null,
    priority: priority || 'normal',
    message: message || null,
    file_version: fileVersion,
    status: 'pending',
    team_id: teamId || null,
  }
  const { data: review, error: reviewError } = await client
    .from('reviews')
    .insert(insertData as any) // TODO: type this
    .select()
    .single()

  if (reviewError) {
    return { review: null, error: reviewError.message }
  }

  // Create review_responses for each reviewer
  const responses = reviewerIds.map((reviewerId) => ({
    review_id: review.id,
    reviewer_id: reviewerId,
    status: 'pending' as ReviewStatus,
  }))

  await client.from('review_responses').insert(responses)

  return { review: review as Review }
}

/**
 * Get reviews requested by a user
 */
export async function getMyReviews(
  userId: string,
  _orgId?: string,
  options?: {
    status?: ReviewStatus[]
    limit?: number
    asRequester?: boolean
    asReviewer?: boolean
  },
): Promise<{ reviews: any[]; error?: string }> {
  const client = getSupabaseClient()

  let query = client
    .from('reviews')
    .select(
      `
      *,
      file:files(id, file_name, file_path, extension, version, part_number, description, revision),
      requester:users!requested_by(email, full_name, avatar_url),
      responses:review_responses(
        id,
        reviewer_id,
        status,
        comment,
        responded_at,
        reviewer:users!reviewer_id(id, email, full_name, avatar_url)
      )
    `,
    )
    .eq('requested_by', userId)
    .order('created_at', { ascending: false })

  if (options?.status && options.status.length > 0) {
    query = query.in('status', options.status)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) {
    return { reviews: [], error: error.message }
  }

  return { reviews: data || [] }
}

/**
 * Get pending reviews for a user (reviews they need to respond to)
 */
export async function getPendingReviewsForUser(
  userId: string,
  _orgId?: string,
): Promise<{ reviews: any[]; error?: string }> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('review_responses')
    .select(
      `
      id,
      status,
      review:reviews!inner(
        id,
        title,
        message,
        priority,
        due_date,
        file_version,
        created_at,
        requested_by,
        status,
        file:files(id, file_name, file_path, extension, part_number, description, revision),
        requester:users!requested_by(email, full_name, avatar_url),
        responses:review_responses(
          id,
          reviewer_id,
          status,
          comment,
          responded_at,
          reviewer:users!reviewer_id(id, email, full_name, avatar_url)
        )
      )
    `,
    )
    .eq('reviewer_id', userId)
    .in('status', ['pending', 'kicked_back'])
    .eq('reviews.status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    return { reviews: [], error: error.message }
  }

  return { reviews: data || [] }
}

/**
 * Respond to a review request
 */
export async function respondToReview(
  reviewResponseId: string,
  reviewerId: string,
  status: 'approved' | 'rejected' | 'kicked_back',
  comment?: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  const { data: response, error: updateError } = await client
    .from('review_responses')
    .update({
      status,
      comment: comment || null,
      responded_at: new Date().toISOString(),
    })
    .eq('id', reviewResponseId)
    .eq('reviewer_id', reviewerId)
    .select('review_id')
    .single()

  if (updateError) {
    return { success: false, error: updateError.message }
  }

  if (response?.review_id) {
    const reviewId = response.review_id

    const { data: allResponses, error: responsesError } = await client
      .from('review_responses')
      .select('status')
      .eq('review_id', reviewId)

    if (!responsesError && allResponses) {
      const allResponded = allResponses.every(
        (r) => r.status !== 'pending' && r.status !== 'kicked_back',
      )

      if (allResponded) {
        const anyRejected = allResponses.some((r) => r.status === 'rejected')

        await client
          .from('reviews')
          .update({
            status: anyRejected ? 'rejected' : 'approved',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', reviewId)
      }
    }
  }

  return { success: true }
}

/**
 * Cancel a review request
 */
export async function cancelReview(
  reviewId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  const { data: review, error: fetchError } = await client
    .from('reviews')
    .select('requested_by')
    .eq('id', reviewId)
    .single()

  if (fetchError || !review) {
    return { success: false, error: 'Review not found' }
  }

  if (review.requested_by !== userId) {
    return { success: false, error: 'Only the requester can cancel a review' }
  }

  const { error } = await client
    .from('reviews')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', reviewId)

  if (error) {
    return { success: false, error: error.message }
  }

  await client.from('review_responses').update({ status: 'cancelled' }).eq('review_id', reviewId)

  return { success: true }
}

// ============================================
// Workflow review trigger
// ============================================

/**
 * Check if a workflow state has `triggers_review` enabled.
 *
 * @param workflowStateId - UUID of the workflow state to check
 * @returns true when the state should automatically prompt for a review request
 */
export async function checkReviewTrigger(workflowStateId: string): Promise<boolean> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('workflow_states')
    .select('triggers_review')
    .eq('id', workflowStateId)
    .single()

  if (error || !data) {
    return false
  }

  return data.triggers_review === true
}

// ============================================
// Team member types
// ============================================

export interface TeamMember {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role?: string | null
  workflow_role_ids?: string[]
}

export interface TeamReviewerConfig {
  id: string
  reviewer_type: 'user' | 'workflow_role'
  user_id: string | null
  workflow_role_id: string | null
}

export interface TeamWithMembers {
  id: string
  name: string
  color: string
  icon: string
  description: string | null
  members: TeamMember[]
  reviewerConfigs: TeamReviewerConfig[]
}

// ============================================
// Teams with members (for review modal)
// ============================================

/**
 * Fetch all teams in an organization together with their member details
 * and reviewer configuration.
 *
 * Used by the ReviewRequestModal so users can select teams as reviewers.
 * The reviewerConfigs array determines which members actually get added
 * when a team is selected. If empty, all members are added (fallback).
 */
export async function getOrgTeamsWithMembers(
  orgId: string,
): Promise<{ teams: TeamWithMembers[]; error?: string }> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('teams')
    .select(
      `
      id,
      name,
      color,
      icon,
      description,
      team_members(
        user:users!team_members_user_id_fkey(id, email, full_name, avatar_url, role)
      )
    `,
    )
    .eq('org_id', orgId)
    .order('name')

  if (error) {
    console.error(
      '[getOrgTeamsWithMembers] Supabase query failed:',
      error.message,
      error.details,
      error.hint,
    )
    return { teams: [], error: error.message }
  }

  // Fetch team_reviewers separately so the main query doesn't break if the
  // table doesn't exist yet or RLS blocks access.
  let reviewersByTeam = new Map<string, TeamReviewerConfig[]>()
  try {
    const { data: reviewerData } = await (client.from as any)('team_reviewers').select( // TODO: type this
      'id, team_id, reviewer_type, user_id, workflow_role_id',
    )

    if (reviewerData) {
      for (const r of reviewerData as Array<TeamReviewerConfig & { team_id: string }>) {
        const existing = reviewersByTeam.get(r.team_id) || []
        existing.push({
          id: r.id,
          reviewer_type: r.reviewer_type,
          user_id: r.user_id,
          workflow_role_id: r.workflow_role_id,
        })
        reviewersByTeam.set(r.team_id, existing)
      }
    }
  } catch {
    // team_reviewers table may not exist yet -- gracefully ignore
  }

  // Fetch workflow role assignments for all org users so we can resolve
  // workflow_role reviewer rules to actual user IDs
  const { data: wrAssignments } = await client
    .from('user_workflow_roles')
    .select('user_id, workflow_role_id')

  const userWorkflowRoles = new Map<string, Set<string>>()
  for (const a of wrAssignments || []) {
    if (!userWorkflowRoles.has(a.user_id)) {
      userWorkflowRoles.set(a.user_id, new Set())
    }
    userWorkflowRoles.get(a.user_id)!.add(a.workflow_role_id)
  }

  const teams: TeamWithMembers[] = (data || []).map((team: any) => {
    const rawMembers =
      ((team as Record<string, unknown>).team_members as Array<{ user: TeamMember | null }>) || []
    const members: TeamMember[] = rawMembers
      .map((tm) => tm.user)
      .filter((u): u is TeamMember => u !== null)
      .map((m) => ({
        ...m,
        workflow_role_ids: Array.from(userWorkflowRoles.get(m.id) || []),
      }))

    return {
      id: team.id as string,
      name: team.name as string,
      color: team.color as string,
      icon: team.icon as string,
      description: (team as Record<string, unknown>).description as string | null,
      members,
      reviewerConfigs: reviewersByTeam.get(team.id as string) || [],
    }
  })

  return { teams }
}

/**
 * Resolve reviewer configs for a team into actual user IDs.
 * If no configs exist, returns all member IDs (backward compatible).
 */
export function resolveTeamReviewers(team: TeamWithMembers): string[] {
  if (team.reviewerConfigs.length === 0) {
    return team.members.map((m) => m.id)
  }

  const reviewerIds = new Set<string>()

  for (const config of team.reviewerConfigs) {
    if (config.reviewer_type === 'user' && config.user_id) {
      if (team.members.some((m) => m.id === config.user_id)) {
        reviewerIds.add(config.user_id)
      }
    } else if (config.reviewer_type === 'workflow_role' && config.workflow_role_id) {
      for (const member of team.members) {
        if (member.workflow_role_ids?.includes(config.workflow_role_id)) {
          reviewerIds.add(member.id)
        }
      }
    }
  }

  return Array.from(reviewerIds)
}
