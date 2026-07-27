/**
 * Inspection Table Operations
 *
 * The inspection table is bluePLM-native data stored in Postgres (the PLM source of
 * truth). Live rows live in `inspection_characteristics` keyed by file_id; immutable
 * per-version snapshots live in `inspection_characteristic_versions` keyed by
 * file_version_id (written by the checkin_file RPC).
 *
 * Editing is gated on the parent drawing being checked out by the current user. On
 * check-in, checkin_file computes a server-side fingerprint of the live rows and
 * increments the parent file version (and snapshots the rows) when it changes.
 */
import { getSupabaseClient } from '../client'

import type {
  InspectionCharacteristic,
  InspectionCharacteristicInsert,
  InspectionCharacteristicVersion,
  InspectionMethod,
} from '../../../types/database'

/** Editable fields of an inspection characteristic (no audit/identity columns). */
export interface InspectionRowValues {
  sort_order: number
  balloon_number: string | null
  char_id: string | null
  zone: string | null
  char_type: string | null
  sub_type: string | null
  nominal_value: string | null
  unit: string | null
  plus_tolerance: string | null
  minus_tolerance: string | null
  upper_limit: string | null
  lower_limit: string | null
  classification: string | null
  inspection_method: string | null
  operation: string | null
  aql: string | null
  sample_size: number | null
  supplier_inspection_rate: number | null
  internal_inspection_rate: number | null
  reference: string | null
  comments: string | null
}

/** A row as edited in the UI. `id` is present for existing rows, absent/local for new ones. */
export interface InspectionRowInput extends InspectionRowValues {
  id: string
}

/**
 * Detect the PostgREST error returned when the inspection tables don't exist yet
 * (i.e. the `15-inspection.sql` module hasn't been run against the database).
 * PGRST205 = "Could not find the table ... in the schema cache"; 42P01 = undefined_table.
 */
function isTableMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /schema cache|does not exist/i.test(error.message ?? '')
}

/**
 * Fetch the live inspection rows for a file, ordered by sort_order.
 */
export async function getInspectionRows(
  fileId: string,
): Promise<{
  success: boolean
  rows?: InspectionCharacteristic[]
  error?: string
  notInstalled?: boolean
}> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('inspection_characteristics')
    .select('*')
    .eq('file_id', fileId)
    .order('sort_order', { ascending: true })

  if (error) {
    if (isTableMissingError(error)) {
      return { success: false, notInstalled: true, error: error.message }
    }
    return { success: false, error: error.message }
  }

  return { success: true, rows: data ?? [] }
}

/**
 * Fetch the immutable snapshot rows for a specific file version, ordered by sort_order.
 * Used when viewing the inspection table as it was at a historical version (read-only).
 */
export async function getInspectionRowsForVersion(
  fileVersionId: string,
): Promise<{
  success: boolean
  rows?: InspectionCharacteristicVersion[]
  error?: string
  notInstalled?: boolean
}> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('inspection_characteristic_versions')
    .select('*')
    .eq('file_version_id', fileVersionId)
    .order('sort_order', { ascending: true })

  if (error) {
    if (isTableMissingError(error)) {
      return { success: false, notInstalled: true, error: error.message }
    }
    return { success: false, error: error.message }
  }

  return { success: true, rows: data ?? [] }
}

/**
 * Replace the live inspection rows for a file with the provided set.
 *
 * Gated on the file being checked out by `userId`. Rows present in `rows` are upserted
 * (by id); existing rows not present are deleted. The parent file version is NOT bumped
 * here — that happens at check-in via checkin_file, which fingerprints these rows.
 */
export async function saveInspectionRows(
  fileId: string,
  orgId: string,
  userId: string,
  rows: InspectionRowInput[],
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  // Verify checkout ownership (defense-in-depth; UI also gates this)
  const { data: file, error: fileError } = await client
    .from('files')
    .select('checked_out_by')
    .eq('id', fileId)
    .single()

  if (fileError) {
    return { success: false, error: fileError.message }
  }
  if (file.checked_out_by !== userId) {
    return { success: false, error: 'You must check out the drawing before editing its inspection table' }
  }

  // Delete rows that the user removed
  const keepIds = rows.map((r) => r.id)
  let deleteQuery = client.from('inspection_characteristics').delete().eq('file_id', fileId)
  if (keepIds.length > 0) {
    deleteQuery = deleteQuery.not('id', 'in', `(${keepIds.join(',')})`)
  }
  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    return { success: false, error: deleteError.message }
  }

  if (rows.length === 0) {
    return { success: true }
  }

  // Upsert provided rows
  const now = new Date().toISOString()
  const payload: InspectionCharacteristicInsert[] = rows.map(({ id, ...values }) => ({
    id,
    file_id: fileId,
    org_id: orgId,
    updated_at: now,
    updated_by: userId,
    ...values,
  }))

  const { error: upsertError } = await client
    .from('inspection_characteristics')
    .upsert(payload, { onConflict: 'id' })

  if (upsertError) {
    return { success: false, error: upsertError.message }
  }

  return { success: true }
}

/** An org-defined inspection method (id needed for edit/remove). */
export interface InspectionMethodOption {
  id: string
  name: string
}

/**
 * Fetch the org-defined custom inspection methods (merged with app defaults in the UI).
 * Returns an empty list (not an error) when the inspection module isn't installed yet.
 */
export async function getInspectionMethods(
  orgId: string,
): Promise<{ success: boolean; methods?: InspectionMethodOption[]; error?: string }> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('inspection_methods')
    .select('id, name')
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (error) {
    if (isTableMissingError(error)) return { success: true, methods: [] }
    return { success: false, error: error.message }
  }

  const methods = (data ?? [])
    .map((row) => row as Pick<InspectionMethod, 'id' | 'name'>)
    .filter((row): row is InspectionMethodOption => !!row.name)
    .map((row) => ({ id: row.id, name: row.name }))
  return { success: true, methods }
}

/**
 * Add a custom inspection method for the org. Idempotent on (org_id, name): a duplicate
 * upserts and returns the existing/created row so the UI can keep the value regardless of
 * who added it first.
 */
export async function addInspectionMethod(
  orgId: string,
  userId: string,
  name: string,
): Promise<{ success: boolean; method?: InspectionMethodOption; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { success: false, error: 'Method name is required' }

  const client = getSupabaseClient()

  const { data, error } = await client
    .from('inspection_methods')
    .upsert({ org_id: orgId, name: trimmed, created_by: userId }, { onConflict: 'org_id,name' })
    .select('id, name')
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  const row = data as Pick<InspectionMethod, 'id' | 'name'>
  return { success: true, method: { id: row.id, name: row.name } }
}

/** Rename an org inspection method. */
export async function updateInspectionMethod(
  orgId: string,
  id: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { success: false, error: 'Method name is required' }

  const client = getSupabaseClient()

  const { error } = await client
    .from('inspection_methods')
    .update({ name: trimmed })
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/** Remove an org inspection method (existing rows that reference it keep their text value). */
export async function deleteInspectionMethod(
  orgId: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  const { error } = await client
    .from('inspection_methods')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}
