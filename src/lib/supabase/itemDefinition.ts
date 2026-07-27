import { getSupabaseClient } from './client'

import { log } from '@/lib/logger'
import type { Json } from '@/types/supabase'
import type { ItemDefinitionSettings, ItemWorkflowStage } from '@/types/item'
import { DEFAULT_ITEM_DEFINITION } from '@/types/item'

function normalizeDefinition(raw: unknown): ItemDefinitionSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_ITEM_DEFINITION }
  }
  const value = raw as Partial<ItemDefinitionSettings>
  return {
    anyStage: value.anyStage ?? DEFAULT_ITEM_DEFINITION.anyStage,
    workflowStageIds: Array.isArray(value.workflowStageIds) ? value.workflowStageIds : [],
    anyType: value.anyType ?? DEFAULT_ITEM_DEFINITION.anyType,
    fileTypes: Array.isArray(value.fileTypes) ? value.fileTypes : [],
    requirePartNumber: value.requirePartNumber ?? DEFAULT_ITEM_DEFINITION.requirePartNumber,
    matchOrgFormat: value.matchOrgFormat ?? DEFAULT_ITEM_DEFINITION.matchOrgFormat,
  }
}

// Load the org-wide item definition settings (returns defaults on failure)
export async function getItemDefinitionSettings(
  orgId: string,
): Promise<ItemDefinitionSettings> {
  const supabase = getSupabaseClient()
  try {
    const { data, error } = await supabase.rpc('get_item_definition_settings', {
      p_org_id: orgId,
    })
    if (error) throw error
    return normalizeDefinition(data)
  } catch (error) {
    log.error('[ItemDefinition]', 'Failed to load settings', { error })
    return { ...DEFAULT_ITEM_DEFINITION }
  }
}

// Save the org-wide item definition settings
export async function updateItemDefinitionSettings(
  orgId: string,
  settings: ItemDefinitionSettings,
): Promise<{ error: Error | null }> {
  const supabase = getSupabaseClient()
  try {
    const { error } = await supabase.rpc('update_item_definition_settings', {
      p_org_id: orgId,
      p_settings: settings as unknown as Json,
    })
    if (error) throw error
    return { error: null }
  } catch (error) {
    log.error('[ItemDefinition]', 'Failed to save settings', { error })
    return { error: error as Error }
  }
}

// Load all workflow stages for the org (across all workflow templates)
export async function getOrgWorkflowStages(orgId: string): Promise<ItemWorkflowStage[]> {
  const supabase = getSupabaseClient()
  try {
    const { data, error } = await supabase
      .from('workflow_states')
      .select('id, name, label, color, workflow_templates!inner(org_id)')
      .eq('workflow_templates.org_id', orgId)
      .order('sort_order', { ascending: true })

    if (error) throw error

    const rows = (data ?? []) as unknown as Array<{
      id: string
      name: string
      label: string | null
      color: string | null
    }>

    // De-duplicate by state name (multiple templates may share stage names)
    const seen = new Set<string>()
    const stages: ItemWorkflowStage[] = []
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      stages.push({ id: row.id, name: row.name, label: row.label, color: row.color })
    }
    return stages
  } catch (error) {
    log.error('[ItemDefinition]', 'Failed to load workflow stages', { error })
    return []
  }
}
