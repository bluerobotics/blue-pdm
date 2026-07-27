import { getSupabaseClient } from '../client'
import { getCurrentUserEmail } from '../auth'

// ============================================
// File Checkout Operations
// ============================================

/**
 * Value sent to checkin_file for a metadata field the user intentionally cleared.
 *
 * The checkin_file RPC uses COALESCE(p_field, field), so a NULL/omitted parameter
 * means "leave the existing value unchanged". An empty string is non-NULL, so
 * COALESCE keeps it and the field is decisively cleared in the database.
 */
const CLEARED_METADATA_VALUE = ''

/**
 * Map a clearable metadata field (part_number/description) to the value passed
 * to the checkin_file RPC, distinguishing three states:
 *   - undefined  -> user never touched the field -> omit (RPC keeps existing value)
 *   - null / ''  -> user intentionally cleared it -> send '' (RPC writes empty)
 *   - value      -> user set a value             -> send value
 *
 * Without this, `value ?? undefined` collapses an intentional clear (null) into
 * undefined, which JSON-RPC drops, so the cleared value never reaches the server.
 */
function toClearableRpcValue(value: string | null | undefined): string | undefined {
  if (value === undefined) return undefined
  return value ?? CLEARED_METADATA_VALUE
}

/**
 * Checkout a file using atomic RPC to prevent race conditions
 * Note: userEmail parameter is kept for API compatibility but no longer used
 * (RPC handles activity logging internally)
 */
export async function checkoutFile(
  fileId: string,
  userId: string,
  _userEmail: string, // Unused - RPC handles activity logging
  options?: {
    message?: string
    // Pre-computed values to avoid redundant IPC calls in batch operations
    machineId?: string
    machineName?: string
  },
) {
  const client = getSupabaseClient()

  // Use pre-computed values if provided, otherwise fetch (for single-file calls)
  let machineId = options?.machineId
  let machineName = options?.machineName
  if (!machineId || !machineName) {
    const { getMachineId, getMachineName } = await import('../../backup')
    machineId = machineId || (await getMachineId())
    machineName = machineName || (await getMachineName())
  }

  // Use atomic RPC to prevent race conditions
  const { data, error } = await client.rpc('checkout_file', {
    p_file_id: fileId,
    p_user_id: userId,
    p_machine_id: machineId,
    p_machine_name: machineName,
    p_lock_message: options?.message,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns JSONB with { success, error?, file? }
  const result = data as { success: boolean; error?: string; file?: any }

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // DO NOT add manual activity logging - RPC handles it!

  return { success: true, file: result.file, error: null }
}

export async function checkinFile(
  fileId: string,
  userId: string,
  options?: {
    newContentHash?: string
    newFileSize?: number
    comment?: string
    newFilePath?: string // For moved files - update the server path
    newFileName?: string // For renamed files - update the server name
    localActiveVersion?: number // If user rolled to a different version locally, track it to force version increment
    pendingMetadata?: {
      part_number?: string | null
      description?: string | null
      revision?: string
      config_tabs?: Record<string, string> // Per-configuration tab numbers
      config_descriptions?: Record<string, string> // Per-configuration descriptions
    }
    // Inspection table fingerprint override. Normally omitted: checkin_file computes the
    // authoritative fingerprint server-side from the live inspection_characteristics rows,
    // so any inspection edits made during checkout are detected and versioned automatically.
    inspectionHash?: string
    // Performance optimizations for batch operations:
    machineId?: string // Pre-fetched machine ID to avoid N IPC calls for N files
    skipMachineMismatchCheck?: boolean // Skip the SELECT query for batch operations
  },
): Promise<{
  success: boolean
  file?: any
  error?: string | null
  contentChanged?: boolean
  metadataChanged?: boolean
  inspectionChanged?: boolean
  machineMismatchWarning?: string | null
}> {
  const client = getSupabaseClient()

  // Machine mismatch check is optional for batch operations (significant perf savings)
  // When processing 80 files, this eliminates 80 SELECT queries + 80 getMachineId IPC calls
  let machineMismatchWarning: string | null = null
  if (!options?.skipMachineMismatchCheck) {
    const { data: fileCheck, error: fetchError } = await client
      .from('files')
      .select('checked_out_by_machine_id, checked_out_by_machine_name')
      .eq('id', fileId)
      .single()

    if (fetchError) {
      return { success: false, error: fetchError.message }
    }

    // Check for machine mismatch warning
    if (fileCheck.checked_out_by_machine_id) {
      // Use pre-fetched machineId if provided (batch optimization), otherwise fetch
      let currentMachineId = options?.machineId
      if (!currentMachineId) {
        const { getMachineId } = await import('../../backup')
        currentMachineId = await getMachineId()
      }
      if (fileCheck.checked_out_by_machine_id !== currentMachineId) {
        machineMismatchWarning = `Warning: This file was checked out on ${fileCheck.checked_out_by_machine_name || 'another computer'}. You are checking it in from a different computer.`
      }
    }
  }

  // NOTE: Path/name updates are now handled in the RPC (eliminates separate UPDATE query)
  // This was a performance optimization - 1 atomic operation instead of 2 separate queries

  // Build custom_properties JSONB for config data
  let customPropsUpdate: Record<string, Record<string, string>> | null = null
  if (options?.pendingMetadata?.config_tabs || options?.pendingMetadata?.config_descriptions) {
    customPropsUpdate = {}
    if (options.pendingMetadata.config_tabs) {
      customPropsUpdate._config_tabs = options.pendingMetadata.config_tabs
    }
    if (options.pendingMetadata.config_descriptions) {
      customPropsUpdate._config_descriptions = options.pendingMetadata.config_descriptions
    }
  }

  // Use atomic RPC for checkin - handles versioning, path updates, and activity logging
  // Path/name updates are now handled in the RPC (performance: eliminates separate UPDATE)
  const { data, error } = await client.rpc('checkin_file', {
    p_file_id: fileId,
    p_user_id: userId,
    p_new_content_hash: options?.newContentHash,
    p_new_file_size: options?.newFileSize,
    p_comment: options?.comment,
    // Use a clear-aware mapping so an intentional clear (null) is sent as '' and
    // decisively written, instead of being collapsed to undefined (= "no change").
    p_part_number: toClearableRpcValue(options?.pendingMetadata?.part_number),
    p_description: toClearableRpcValue(options?.pendingMetadata?.description),
    p_revision: options?.pendingMetadata?.revision,
    p_local_active_version: options?.localActiveVersion,
    p_custom_properties: customPropsUpdate,
    p_new_file_path: options?.newFilePath,
    p_new_file_name: options?.newFileName,
    p_inspection_hash: options?.inspectionHash,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const result = data as {
    success: boolean
    error?: string
    file?: unknown
    new_version?: number
    content_changed?: boolean
    metadata_changed?: boolean
    inspection_changed?: boolean
    version_incremented?: boolean
  }

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // DO NOT add manual activity logging - RPC handles it!

  return {
    success: true,
    file: result.file,
    error: null,
    contentChanged: result.content_changed,
    metadataChanged: result.metadata_changed,
    inspectionChanged: result.inspection_changed,
    machineMismatchWarning,
  }
}

/**
 * Sync SolidWorks file metadata from SW properties
 *
 * Behavior depends on checkout state:
 * - If file is checked out by current user: updates metadata only, NO version increment
 *   (version creation happens at check-in via checkin_file RPC)
 * - If file is NOT checked out: creates a new version for metadata-only update
 */
export async function syncSolidWorksFileMetadata(
  fileId: string,
  userId: string,
  metadata: {
    part_number?: string | null
    description?: string | null
    revision?: string | null
    custom_properties?: Record<string, string | number | null>
  },
): Promise<{ success: boolean; file?: any; error?: string | null }> {
  const client = getSupabaseClient()

  // Get current file data
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  // Check if any metadata actually changed
  const partNumberChanged =
    metadata.part_number !== undefined &&
    (metadata.part_number || null) !== (file.part_number || null)
  const descriptionChanged =
    metadata.description !== undefined &&
    (metadata.description || null) !== (file.description || null)
  const revisionChanged =
    metadata.revision !== undefined && (metadata.revision || null) !== (file.revision || null)
  const customPropsChanged = metadata.custom_properties !== undefined

  if (!partNumberChanged && !descriptionChanged && !revisionChanged && !customPropsChanged) {
    // No changes - return current file
    return { success: true, file, error: null }
  }

  // Build update data
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }

  if (metadata.part_number !== undefined) {
    updateData.part_number = metadata.part_number
  }
  if (metadata.description !== undefined) {
    updateData.description = metadata.description
  }
  if (metadata.revision !== undefined && metadata.revision !== null) {
    updateData.revision = metadata.revision
  }
  if (metadata.custom_properties !== undefined) {
    updateData.custom_properties = metadata.custom_properties
  }

  // Check if file is checked out by current user
  const isCheckedOutByMe = file.checked_out_by === userId

  // Only create a version if file is NOT checked out by current user
  // When checked out, metadata saves don't create versions - version is created at check-in
  const shouldCreateVersion = !isCheckedOutByMe

  if (shouldCreateVersion) {
    // Create new version for this change
    // Use maybeSingle() since file might not have version history yet (first version)
    const { data: maxVersionData } = await client
      .from('file_versions')
      .select('version')
      .eq('file_id', fileId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const maxVersionInHistory = maxVersionData?.version || file.version
    const newVersion = maxVersionInHistory + 1
    updateData.version = newVersion

    // Create version record with proper error handling
    const { error: versionError } = await client.from('file_versions').insert({
      file_id: fileId,
      version: newVersion,
      revision: updateData.revision || file.revision || '',
      content_hash: file.content_hash || '',
      file_size: file.file_size,
      workflow_state_id: file.workflow_state_id,
      state: file.state || 'not_tracked',
      created_by: userId,
      comment: 'Metadata updated from SolidWorks file properties',
    })

    if (versionError) {
      return { success: false, error: `Failed to create version: ${versionError.message}` }
    }
  }
  // If checked out by me: just update metadata, no version increment
  // Version creation is handled by checkin_file RPC

  // Update the file
  const { data, error } = await client
    .from('files')
    .update(updateData)
    .eq('id', fileId)
    .select()
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  // Log activity
  const changedFields: string[] = []
  if (partNumberChanged) changedFields.push('part_number')
  if (descriptionChanged) changedFields.push('description')
  if (revisionChanged) changedFields.push('revision')
  if (customPropsChanged) changedFields.push('custom_properties')

  // Log activity synchronously with try/catch
  // Use 'update' action if checked out (metadata-only), 'checkin' action if version was created
  try {
    const userEmail = await getCurrentUserEmail()
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: userEmail,
      action: shouldCreateVersion ? 'checkin' : 'update',
      details: {
        metadataSync: true,
        changedFields,
        source: 'solidworks',
        versionCreated: shouldCreateVersion,
        isCheckedOut: isCheckedOutByMe,
      },
    })
  } catch {
    // Activity logging is non-critical
  }

  return { success: true, file: data, error: null }
}

export async function undoCheckout(fileId: string, userId: string) {
  const client = getSupabaseClient()

  // Verify the user has the file checked out (or is admin)
  // Use maybeSingle() so a missing/deleted row doesn't throw "Cannot coerce the
  // result to a single JSON object". The file may have been deleted server-side
  // (e.g. a ghost left in the cache), in which case the checkout is already gone.
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*, org_id')
    .eq('id', fileId)
    .maybeSingle()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  // No row found - the file is already gone, so the user's goal (releasing the
  // checkout / clearing the ghost) is already achieved. Treat as success.
  if (!file) {
    return { success: true, file: null, error: null }
  }

  if (file.checked_out_by !== userId) {
    // If file is not checked out by anyone, the user's goal is already achieved
    // This handles stale local state gracefully (e.g., checkout released from another machine)
    if (file.checked_out_by === null) {
      return { success: true, file, error: null }
    }
    // File is checked out by someone else - that's a real conflict
    // Note: Admins should use adminForceDiscardCheckout() instead
    return { success: false, error: 'File is checked out by another user' }
  }

  // Release the checkout without saving changes
  // Must bump updated_at so delta sync picks up the change (cache uses updated_at as watermark)
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      checked_out_by_machine_id: null,
      checked_out_by_machine_name: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fileId)
    .select()
    .single()

  if (error) {
    return { success: false, error: error.message }
  }
  if (!data) {
    return { success: false, error: 'Update failed - no rows affected (check permissions)' }
  }

  return { success: true, file: data, error: null }
}

// ============================================
// Admin Force Check-In Operations
// ============================================

/**
 * Admin force discard checkout - discards the checkout without saving changes
 * Use this when the user is offline or unresponsive
 */
export async function adminForceDiscardCheckout(
  fileId: string,
  adminUserId: string,
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()

  // Verify admin
  const { data: adminUser, error: adminError } = await client
    .from('users')
    .select('role, org_id')
    .eq('id', adminUserId)
    .single()

  if (adminError || adminUser?.role !== 'admin') {
    return { success: false, error: 'Only admins can force discard checkouts' }
  }

  // Get the file info
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  if (!file.checked_out_by) {
    return { success: false, error: 'File is not checked out' }
  }

  // Get the checked out user info separately
  let checkedOutUser: { id: string; email: string; full_name: string | null } | null = null
  const { data: userData } = await client
    .from('users')
    .select('id, email, full_name')
    .eq('id', file.checked_out_by)
    .single()

  if (userData) {
    checkedOutUser = userData
  }

  // Release the checkout without saving changes
  // Must bump updated_at so delta sync picks up the change (cache uses updated_at as watermark)
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      checked_out_by_machine_id: null,
      checked_out_by_machine_name: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fileId)
    .select()
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  // Log activity synchronously with try/catch
  try {
    const adminEmail = await getCurrentUserEmail()
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: adminUserId,
      user_email: adminEmail,
      action: 'update' as const,
      details: {
        admin_action: 'force_discard',
        previousCheckoutUser: checkedOutUser?.email || checkedOutUser?.id,
        previousCheckoutUserName: checkedOutUser?.full_name,
      },
    })
  } catch {
    // Activity logging is non-critical
  }

  return { success: true, file: data }
}
