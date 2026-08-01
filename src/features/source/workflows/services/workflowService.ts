/**
 * WorkflowService - Type-safe database operations for workflow templates
 *
 * Uses the supabase client with runtime type assertions to work around
 * TypeScript inference issues with the database types.
 */
import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'

import { exportPayloadAsJson } from '../utils/workflowExport'
import type { WorkflowExport } from '../utils/workflowExport'

type WorkflowTemplateRow = Database['public']['Tables']['workflow_templates']['Row']

export interface WorkflowServiceResult<T> {
  data: T | null
  error: Error | null
}

export interface ImportGraphResult {
  state_count: number
  transition_count: number
  gate_count: number
}

// Type-safe access to workflow_templates table
const workflowTemplates = () => supabase.from('workflow_templates')

export const workflowService = {
  /**
   * Get all active workflows for an organization
   */
  async getAll(orgId: string): Promise<WorkflowServiceResult<WorkflowTemplateRow[]>> {
    const { data, error } = await workflowTemplates()
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('name')

    return {
      data: data as WorkflowTemplateRow[] | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Get a single workflow by ID
   */
  async getById(workflowId: string): Promise<WorkflowServiceResult<WorkflowTemplateRow>> {
    const { data, error } = await workflowTemplates().select('*').eq('id', workflowId).single()

    return {
      data: data as WorkflowTemplateRow | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Create a new workflow using the default workflow function
   */
  async createDefault(orgId: string, userId: string): Promise<WorkflowServiceResult<string>> {
    const { data, error } = await supabase.rpc('create_default_workflow', {
      p_org_id: orgId,
      p_created_by: userId,
    })

    return {
      data: data as string | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Create a workflow with custom data
   */
  async create(
    workflow: Partial<WorkflowTemplateRow> & { org_id: string; name: string },
  ): Promise<WorkflowServiceResult<WorkflowTemplateRow>> {
    const { data, error } = await workflowTemplates()
      .insert(workflow as never)
      .select()
      .single()

    return {
      data: data as WorkflowTemplateRow | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Update a workflow
   */
  async update(
    workflowId: string,
    updates: Partial<WorkflowTemplateRow>,
  ): Promise<WorkflowServiceResult<WorkflowTemplateRow>> {
    const { data, error } = await workflowTemplates()
      .update(updates as never)
      .eq('id', workflowId)
      .select()
      .single()

    return {
      data: data as WorkflowTemplateRow | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Soft delete a workflow (set is_active = false)
   */
  async softDelete(workflowId: string): Promise<WorkflowServiceResult<void>> {
    const { error } = await workflowTemplates()
      .update({ is_active: false } as never)
      .eq('id', workflowId)

    return {
      data: error ? null : undefined,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Replace a workflow's states, transitions and gates from an exported payload.
   * Runs as a single database transaction, so the existing graph survives intact
   * if any part of the new one is rejected.
   */
  async importGraph(
    workflowId: string,
    payload: WorkflowExport,
  ): Promise<WorkflowServiceResult<ImportGraphResult>> {
    const { data, error } = await supabase.rpc('import_workflow_graph', {
      p_workflow_id: workflowId,
      p_payload: exportPayloadAsJson(payload),
    })

    return {
      data: data as ImportGraphResult | null,
      error: error ? new Error(error.message) : null,
    }
  },

  /**
   * Update workflow canvas configuration
   */
  async updateCanvasConfig(
    workflowId: string,
    config: { zoom: number; panX: number; panY: number },
  ): Promise<WorkflowServiceResult<void>> {
    const { error } = await workflowTemplates()
      .update({ canvas_config: config } as never)
      .eq('id', workflowId)

    return {
      data: error ? null : undefined,
      error: error ? new Error(error.message) : null,
    }
  },
}
