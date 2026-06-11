import { getSupabaseClient } from '../client'
import { processWithConcurrency, CONCURRENT_OPERATIONS } from '../../concurrency'
import { log } from '@/lib/logger'

// ============================================
// Soft Delete / Restore Operations
// ============================================

/**
 * Soft delete a file (move to trash)
 */
export async function softDeleteFile(
  fileId: string,
  userId: string,
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()

  // Get current file to validate
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, org_id, file_name, file_path, checked_out_by')
    .eq('id', fileId)
    .single()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  // Don't allow deleting files checked out by other users
  if (file.checked_out_by && file.checked_out_by !== userId) {
    return {
      success: false,
      error: 'Cannot delete a file checked out by another user. Ask them to check it in first.',
    }
  }

  // Soft delete - set deleted_at and deleted_by.
  // Also bump updated_at so the watermark-based delta sync (get_vault_files_delta)
  // surfaces the deletion to other clients even if the deployed RPC keys off
  // updated_at. Without this, other machines keep the row cached as a "ghost".
  const { data: deletedFile, error } = await client
    .from('files')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fileId)
    .select()
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  // Log activity
  try {
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: '',
      action: 'delete' as const,
      details: {
        file_name: file.file_name,
        file_path: file.file_path,
        soft_delete: true,
      },
    })
  } catch {
    // Activity logging is non-critical
  }

  return { success: true, file: deletedFile }
}

/**
 * Soft delete multiple files at once
 */
export async function softDeleteFiles(
  fileIds: string[],
  userId: string,
): Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }> {
  const errors: string[] = []
  let deleted = 0
  let failed = 0

  for (const fileId of fileIds) {
    const result = await softDeleteFile(fileId, userId)
    if (result.success) {
      deleted++
    } else {
      failed++
      errors.push(result.error || 'Unknown error')
    }
  }

  return { success: failed === 0, deleted, failed, errors }
}

/**
 * Restore a file from trash
 */
export async function restoreFile(
  fileId: string,
  userId: string,
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()

  // Get current file to validate
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, org_id, file_name, file_path, deleted_at, vault_id')
    .eq('id', fileId)
    .single()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  if (!file.deleted_at) {
    return { success: false, error: 'File is not in trash' }
  }

  if (!file.vault_id) {
    return { success: false, error: 'File has no vault assigned' }
  }

  // Check if a file with the same path already exists (case-insensitive: Windows paths are case-insensitive)
  const escapedPath = file.file_path.replace(/%/g, '\\%').replace(/_/g, '\\_')
  const { data: existingFile } = await client
    .from('files')
    .select('id')
    .eq('vault_id', file.vault_id)
    .ilike('file_path', escapedPath)
    .is('deleted_at', null)
    .single()

  if (existingFile) {
    return {
      success: false,
      error: 'A file with the same path already exists. Rename or delete the existing file first.',
    }
  }

  // Restore - clear deleted_at and deleted_by
  // Select full PDMFile-compatible data including workflow_state for addCloudFile()
  const { data: restoredFile, error } = await client
    .from('files')
    .update({
      deleted_at: null,
      deleted_by: null,
    })
    .eq('id', fileId)
    .select(
      `
      *,
      workflow_state:workflow_states(id, name, label, color, icon, is_editable, requires_checkout)
    `,
    )
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  // Log activity
  try {
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: '',
      action: 'restore',
      details: {
        file_name: file.file_name,
        file_path: file.file_path,
      },
    })
  } catch {
    // Activity logging is non-critical
  }

  return { success: true, file: restoredFile }
}

/**
 * Restore multiple files from trash
 */
export async function restoreFiles(
  fileIds: string[],
  userId: string,
): Promise<{ success: boolean; restored: number; failed: number; errors: string[] }> {
  const errors: string[] = []
  let restored = 0
  let failed = 0

  for (const fileId of fileIds) {
    const result = await restoreFile(fileId, userId)
    if (result.success) {
      restored++
    } else {
      failed++
      errors.push(result.error || 'Unknown error')
    }
  }

  return { success: failed === 0, restored, failed, errors }
}

/**
 * Permanently delete a file (cannot be undone)
 * Only for files already in trash
 */
export async function permanentlyDeleteFile(
  fileId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  // Get current file to validate
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, org_id, file_name, file_path, deleted_at')
    .eq('id', fileId)
    .single()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  if (!file.deleted_at) {
    return { success: false, error: 'File must be in trash before permanent deletion' }
  }

  // Log activity BEFORE delete
  try {
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: null, // Set to null since file will be deleted
      user_id: userId,
      user_email: '',
      action: 'delete' as const,
      details: {
        file_name: file.file_name,
        file_path: file.file_path,
        permanent: true,
      },
    })
  } catch {
    // Activity logging is non-critical
  }

  // Delete file versions
  await client.from('file_versions').delete().eq('file_id', fileId)

  // Delete file references
  await client
    .from('file_references')
    .delete()
    .or(`parent_file_id.eq.${fileId},child_file_id.eq.${fileId}`)

  // Permanently delete the file
  const { error } = await client.from('files').delete().eq('id', fileId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Permanently delete multiple files (cannot be undone)
 * Uses concurrent individual operations for smooth progress reporting
 */
export async function permanentlyDeleteFiles(
  fileIds: string[],
  userId: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }> {
  if (fileIds.length === 0) {
    return { success: true, deleted: 0, failed: 0, errors: [] }
  }

  let completed = 0
  const errors: string[] = []

  const results = await processWithConcurrency(fileIds, CONCURRENT_OPERATIONS, async (fileId) => {
    const result = await permanentlyDeleteFile(fileId, userId)
    completed++
    onProgress?.(completed, fileIds.length)
    return result
  })

  const deleted = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  // Collect first few errors for reporting
  for (const r of results) {
    if (!r.success && r.error && errors.length < 5) {
      errors.push(r.error)
    }
  }
  if (failed > errors.length) {
    errors.push(`...and ${failed - errors.length} more errors`)
  }

  return { success: failed === 0, deleted, failed, errors }
}

/**
 * Get deleted files (trash) for an organization
 * Optionally filter by vault or folder path
 * Returns empty array if deleted_at column doesn't exist (migration not run)
 * Uses pagination to fetch ALL deleted files (Supabase default limit is 1000)
 */
export async function getDeletedFiles(
  orgId: string,
  options?: {
    vaultId?: string
    folderPath?: string // Get deleted files that were in this folder
  },
): Promise<{ files: any[]; error?: string }> {
  const client = getSupabaseClient()

  try {
    // Fetch ALL deleted files using pagination (Supabase default limit is 1000)
    const PAGE_SIZE = 1000
    const allFiles: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      let query = client
        .from('files')
        .select(
          `
          id,
          file_path,
          file_name,
          extension,
          file_type,
          part_number,
          description,
          revision,
          version,
          content_hash,
          file_size,
          state,
          deleted_at,
          deleted_by,
          vault_id,
          org_id,
          updated_at,
          deleted_by_user:users!deleted_by(email, full_name, avatar_url)
        `,
        )
        .eq('org_id', orgId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

      if (options?.vaultId) {
        query = query.eq('vault_id', options.vaultId)
      }

      if (options?.folderPath) {
        // Match files that were in this folder or subfolders
        query = query.ilike('file_path', `${options.folderPath}%`)
      }

      const { data, error } = await query

      if (error) {
        // If column doesn't exist, return empty (trash feature not available)
        if (error.message?.includes('deleted_at') || error.message?.includes('column')) {
          return { files: [] }
        }
        return { files: allFiles, error: error.message }
      }

      if (data && data.length > 0) {
        allFiles.push(...data)
        offset += PAGE_SIZE
        hasMore = data.length === PAGE_SIZE
      } else {
        hasMore = false
      }
    }

    return { files: allFiles }
  } catch (error) {
    log.error('[Trash]', 'Error fetching deleted files', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { files: [] }
  }
}

/**
 * Get count of deleted files (for badge display)
 * Returns 0 if deleted_at column doesn't exist (migration not run)
 */
export async function getDeletedFilesCount(
  orgId: string,
  vaultId?: string,
): Promise<{ count: number; error?: string }> {
  const client = getSupabaseClient()

  try {
    let query = client
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)

    if (vaultId) {
      query = query.eq('vault_id', vaultId)
    }

    const { count, error } = await query

    if (error) {
      // If column doesn't exist, return 0 (trash feature not available)
      if (error.message?.includes('deleted_at') || error.message?.includes('column')) {
        return { count: 0 }
      }
      return { count: 0, error: error.message }
    }

    return { count: count || 0 }
  } catch (error) {
    return { count: 0 }
  }
}

/**
 * Empty the trash - permanently delete all trashed files
 * Admin only operation
 * Uses batch deletion for performance
 * Uses pagination to fetch ALL trashed files (Supabase default limit is 1000)
 */
export async function emptyTrash(
  orgId: string,
  userId: string,
  vaultId?: string,
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const client = getSupabaseClient()

  // Fetch ALL trashed file IDs using pagination (Supabase default limit is 1000)
  const PAGE_SIZE = 1000
  const allFileIds: string[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    let query = client
      .from('files')
      .select('id')
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .order('id', { ascending: true }) // Consistent ordering for pagination
      .range(offset, offset + PAGE_SIZE - 1)

    if (vaultId) {
      query = query.eq('vault_id', vaultId)
    }

    const { data: trashedFiles, error: fetchError } = await query

    if (fetchError) {
      // If we've already collected some IDs, try to delete those
      if (allFileIds.length > 0) {
        log.warn('[Trash]', 'Pagination error, proceeding with collected IDs', {
          error: fetchError.message,
        })
        break
      }
      return { success: false, deleted: 0, error: fetchError.message }
    }

    if (trashedFiles && trashedFiles.length > 0) {
      allFileIds.push(...trashedFiles.map((f) => f.id))
      offset += PAGE_SIZE
      hasMore = trashedFiles.length === PAGE_SIZE
    } else {
      hasMore = false
    }
  }

  if (allFileIds.length === 0) {
    return { success: true, deleted: 0 }
  }

  // Use batch deletion for performance
  const result = await permanentlyDeleteFiles(allFileIds, userId)

  if (!result.success && result.errors.length > 0) {
    return { success: false, deleted: result.deleted, error: result.errors[0] }
  }

  return { success: true, deleted: result.deleted }
}
