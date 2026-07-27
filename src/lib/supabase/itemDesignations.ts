import { getSupabaseClient } from './client'

import { log } from '@/lib/logger'
import type { ItemDesignation } from '@/types/item'

// Row shapes returned by the item designation RPCs (snake_case, match the DB).
interface ItemDesignationRow {
  id: string
  name: string
  sort_order: number
}

interface ItemDesignationAssignmentRow {
  part_number: string
  designation_id: string
}

// Supabase v2 does not infer types for RPCs that are not yet in the generated
// supabase.ts. Cast to a loose caller until the types are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> } // TODO: type this after supabase types regen

function toDesignation(row: ItemDesignationRow): ItemDesignation {
  return { id: row.id, name: row.name, sortOrder: row.sort_order }
}

/** Load the org's configurable designation list (seeded with defaults). */
export async function getItemDesignations(orgId: string): Promise<ItemDesignation[]> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  try {
    const { data, error } = await supabase.rpc('get_item_designations', { p_org_id: orgId })
    if (error) throw error
    return ((data ?? []) as ItemDesignationRow[]).map(toDesignation)
  } catch (error) {
    log.error('[ItemDesignations]', 'Failed to load item designations', { error })
    return []
  }
}

/** Create or update a designation in the org list. */
export async function upsertItemDesignation(
  orgId: string,
  name: string,
  id?: string | null,
  sortOrder?: number | null,
): Promise<ItemDesignation> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const { data, error } = await supabase.rpc('upsert_item_designation', {
    p_org_id: orgId,
    p_name: name,
    p_id: id ?? null,
    p_sort_order: sortOrder ?? null,
  })
  if (error) throw error
  return toDesignation(data as ItemDesignationRow)
}

/** Delete a designation from the org list. */
export async function deleteItemDesignation(orgId: string, id: string): Promise<void> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const { error } = await supabase.rpc('delete_item_designation', {
    p_org_id: orgId,
    p_id: id,
  })
  if (error) throw error
}

/** Load per-item designation overrides for a vault, keyed by part number. */
export async function getItemDesignationAssignments(
  orgId: string,
  vaultId: string,
): Promise<Map<string, string>> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const result = new Map<string, string>()
  try {
    const { data, error } = await supabase.rpc('get_item_designation_assignments', {
      p_org_id: orgId,
      p_vault_id: vaultId,
    })
    if (error) throw error
    for (const row of (data ?? []) as ItemDesignationAssignmentRow[]) {
      result.set(row.part_number, row.designation_id)
    }
    return result
  } catch (error) {
    log.error('[ItemDesignations]', 'Failed to load designation assignments', { error })
    return result
  }
}

/**
 * Set (or clear, when designationId is null) a per-item designation override.
 */
export async function setItemDesignationAssignment(
  orgId: string,
  vaultId: string,
  partNumber: string,
  designationId: string | null,
): Promise<void> {
  const supabase = getSupabaseClient() as unknown as RpcClient
  const { error } = await supabase.rpc('set_item_designation_assignment', {
    p_org_id: orgId,
    p_vault_id: vaultId,
    p_part_number: partNumber,
    p_designation_id: designationId,
  })
  if (error) throw error
}
