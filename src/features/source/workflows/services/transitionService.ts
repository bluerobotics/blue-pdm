/**
 * TransitionService - Type-safe database operations for workflow transitions and gates
 *
 * Uses the supabase client with runtime type assertions to work around
 * TypeScript inference issues with the database types.
 */
import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import type { WorkflowTransition, WorkflowGate } from '@/types/workflow'

import type { EdgePosition } from '../types'

import { anchorPatch } from './layoutService'

type WorkflowTransitionRow = Database['public']['Tables']['workflow_transitions']['Row']
type WorkflowGateRow = Database['public']['Tables']['workflow_gates']['Row']

export interface TransitionServiceResult<T> {
  data: T | null
  error: Error | null
}

// Type-safe access to workflow tables
const workflowTransitions = () => supabase.from('workflow_transitions')
const workflowGates = () => supabase.from('workflow_gates')

export const transitionService = {
  /**
   * Get all transitions for a workflow
   */
  async getByWorkflow(
    workflowId: string,
  ): Promise<TransitionServiceResult<WorkflowTransition[]>> {
    const { data, error } = await workflowTransitions().select('*').eq('workflow_id', workflowId)

    return {
      data: data as WorkflowTransition[] | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Get a single transition by ID
   */
  async getById(transitionId: string): Promise<TransitionServiceResult<WorkflowTransition>> {
    const { data, error } = await workflowTransitions().select('*').eq('id', transitionId).single()

    return {
      data: data as WorkflowTransition | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Create a new transition
   */
  async create(
    transition: Partial<WorkflowTransitionRow> & {
      workflow_id: string
      from_state_id: string
      to_state_id: string
    },
  ): Promise<TransitionServiceResult<WorkflowTransition>> {
    const { data, error } = await workflowTransitions()
      .insert(transition as never)
      .select()
      .single()

    return {
      data: data as WorkflowTransition | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Update a transition
   * Accepts any record to support fields that may exist in the database
   * but aren't in the generated types (e.g., line_path_type, line_arrow_head)
   */
  async update(
    transitionId: string,
    updates: Record<string, unknown>,
  ): Promise<TransitionServiceResult<WorkflowTransition>> {
    const { data, error } = await workflowTransitions()
      .update(updates as never)
      .eq('id', transitionId)
      .select()
      .single()

    return {
      data: data as WorkflowTransition | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Delete a transition
   */
  async delete(transitionId: string): Promise<TransitionServiceResult<void>> {
    const { error } = await workflowTransitions().delete().eq('id', transitionId)

    return {
      data: error ? null : undefined,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Reconnect a transition endpoint.
   *
   * The anchor is written in the same statement as the new state so a reload
   * cannot show the line attached to the right node in the wrong place. Passing
   * `null` clears it, leaving the endpoint free to re-route as the nodes move.
   */
  async reconnect(
    transitionId: string,
    endpoint: 'start' | 'end',
    stateId: string,
    anchor: EdgePosition | null = null,
  ): Promise<TransitionServiceResult<void>> {
    const updates =
      endpoint === 'start'
        ? { from_state_id: stateId, ...anchorPatch('start', anchor) }
        : { to_state_id: stateId, ...anchorPatch('end', anchor) }

    const { error } = await workflowTransitions()
      .update(updates as never)
      .eq('id', transitionId)

    return {
      data: error ? null : undefined,
      error: error ? new Error(error.message) : null,
    }
  },

  // ============================================
  // Gate operations
  // ============================================

  /**
   * Get all gates for a list of transitions
   */
  async getGatesByTransitions(
    transitionIds: string[],
  ): Promise<TransitionServiceResult<WorkflowGate[]>> {
    if (transitionIds.length === 0) {
      return { data: [], error: null }
    }

    const { data, error } = await workflowGates()
      .select('*')
      .in('transition_id', transitionIds)
      .order('sort_order')

    return {
      data: data as WorkflowGate[] | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Get gates grouped by transition ID
   */
  async getGatesGroupedByTransition(
    transitionIds: string[],
  ): Promise<TransitionServiceResult<Record<string, WorkflowGate[]>>> {
    const result = await this.getGatesByTransitions(transitionIds)

    if (result.error || !result.data) {
      return { data: null, error: result.error }
    }

    const grouped: Record<string, WorkflowGate[]> = {}
    for (const gate of result.data) {
      if (!grouped[gate.transition_id]) {
        grouped[gate.transition_id] = []
      }
      grouped[gate.transition_id].push(gate)
    }

    return { data: grouped, error: null }
  },

  /**
   * Create a gate
   */
  async createGate(
    gate: Partial<WorkflowGateRow> & { transition_id: string; name: string },
  ): Promise<TransitionServiceResult<WorkflowGate>> {
    const { data, error } = await workflowGates()
      .insert(gate as never)
      .select()
      .single()

    return {
      data: data as WorkflowGate | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Update a gate
   */
  async updateGate(
    gateId: string,
    updates: Partial<WorkflowGateRow>,
  ): Promise<TransitionServiceResult<WorkflowGate>> {
    const { data, error } = await workflowGates()
      .update(updates as never)
      .eq('id', gateId)
      .select()
      .single()

    return {
      data: data as WorkflowGate | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Delete a gate
   */
  async deleteGate(gateId: string): Promise<TransitionServiceResult<void>> {
    const { error } = await workflowGates().delete().eq('id', gateId)

    return {
      data: error ? null : undefined,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Get next sort order for gates in a transition
   */
  async getNextGateSortOrder(transitionId: string): Promise<number> {
    const { data } = await workflowGates()
      .select('sort_order')
      .eq('transition_id', transitionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    return ((data as { sort_order: number } | null)?.sort_order ?? 0) + 1
  },
}
