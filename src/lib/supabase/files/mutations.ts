import { getSupabaseClient } from '../client'
import { getCurrentUser, getCurrentUserEmail } from '../auth'
import { withRetry } from '../../network'

// ============================================
// Private Helper Functions
// ============================================

function getFileTypeFromExtension(
  ext: string,
): 'part' | 'assembly' | 'drawing' | 'pdf' | 'step' | 'other' {
  const lowerExt = ext.toLowerCase()

  // CAD Parts (all major CAD software)
  if (
    [
      '.sldprt',
      '.prtdot',
      '.sldlfp',
      '.sldftp',
      '.sldblk', // SolidWorks
      '.ipt', // Inventor
      '.prt', // Creo/NX
      '.par',
      '.psm',
      '.pwd', // Solid Edge
      '.catpart',
      '.catshape', // CATIA
      '.3dm',
      '.gh',
      '.ghx', // Rhino
      '.skp',
      '.skb', // SketchUp
      '.fcstd',
      '.scad',
      '.brep', // Open source CAD
      '.blend',
      '.max',
      '.ma',
      '.mb',
      '.c4d', // 3D viz
      '.x_t',
      '.x_b',
      '.xmt_txt',
      '.xmt_bin', // Parasolid
      '.sat',
      '.sab',
      '.asat', // ACIS
      '.f3d',
      '.f3z', // Fusion 360
    ].includes(lowerExt)
  )
    return 'part'

  // CAD Assemblies
  if (
    [
      '.sldasm',
      '.asmdot', // SolidWorks
      '.iam',
      '.ipn', // Inventor
      '.asm', // Creo
      '.catproduct', // CATIA
    ].includes(lowerExt)
  )
    return 'assembly'

  // CAD Drawings
  if (
    [
      '.slddrw',
      '.slddrt',
      '.drwdot',
      '.sldstd', // SolidWorks
      '.idw',
      '.dwg',
      '.dwt',
      '.dws',
      '.dwf',
      '.dwfx', // Inventor/AutoCAD
      '.dxf', // DXF
      '.drw',
      '.frm', // Creo
      '.dft', // Solid Edge
      '.catdrawing', // CATIA
      '.layout', // SketchUp
    ].includes(lowerExt)
  )
    return 'drawing'

  // PDF
  if (lowerExt === '.pdf') return 'pdf'

  // STEP and neutral exchange formats
  if (
    [
      '.step',
      '.stp',
      '.stpz',
      '.p21', // STEP
      '.iges',
      '.igs', // IGES
      '.jt', // JT
      '.stl',
      '.stla',
      '.stlb', // STL
      '.3mf',
      '.amf', // Additive manufacturing
      '.obj',
      '.mtl', // OBJ
      '.fbx',
      '.dae', // Animation exchange
      '.gltf',
      '.glb', // GL Transmission
      '.usdz',
      '.usda',
      '.usdc', // USD
      '.ply',
      '.wrl',
      '.vrml',
      '.x3d', // Other mesh
    ].includes(lowerExt)
  )
    return 'step'

  return 'other'
}

// Helper to wrap Supabase DB calls with retry logic
// Uses PromiseLike to accept Supabase's PostgrestBuilder which is thenable
async function dbWithRetry<T>(
  operation: () => PromiseLike<{ data: T | null; error: any }>,
  context: string,
  logFn: (level: string, msg: string, data?: any) => void,
): Promise<{ data: T | null; error: any }> {
  let lastResult: { data: T | null; error: any } = { data: null, error: null }

  try {
    await withRetry(
      async () => {
        lastResult = await operation()
        if (lastResult.error) {
          throw lastResult.error
        }
        return lastResult
      },
      {
        maxAttempts: 3,
        baseDelay: 500,
        onRetry: (attempt, error) => {
          logFn('warn', `[syncFile] ${context} failed, retrying (${attempt}/3)`, {
            error: error instanceof Error ? error.message : String(error),
          })
        },
      },
    )
  } catch {
    // withRetry exhausted - lastResult contains the final error
  }

  return lastResult
}

// ============================================
// Sync Operations
// ============================================

export async function syncFile(
  orgId: string,
  vaultId: string,
  userId: string,
  filePath: string, // relative path in vault
  fileName: string,
  extension: string,
  fileSize: number,
  contentHash: string,
  base64Content: string,
  metadata?: {
    partNumber?: string | null
    description?: string | null
    revision?: string | null
    customProperties?: Record<string, string | number | null>
  },
  copiedFromFileId?: string,
) {
  const client = getSupabaseClient()

  // Debug: Log sync attempt
  const logFn =
    typeof window !== 'undefined' && (window as any).electronAPI?.log // TODO: type this
      ? (level: string, msg: string, data?: any) =>
          (window as any).electronAPI.log(level, msg, data) // TODO: type this
      : () => {}

  logFn('debug', '[syncFile] Starting sync', { orgId, vaultId, filePath, fileName })

  try {
    const syncStart = performance.now()
    let storageCheckMs = 0
    let storageUploadMs: number | null = null
    let uploadSpeedKBps: number | null = null
    let dbCheckMs = 0
    let dbWriteMs = 0
    let versionHistoryMs: number | null = null

    // 1. Upload file content to storage (using content hash as filename for deduplication)
    // Use subdirectory based on first 2 chars of hash to prevent too many files in one folder
    const storagePath = `${orgId}/${contentHash.substring(0, 2)}/${contentHash}`

    // Check if this content already exists (deduplication)
    logFn('debug', '[syncFile] Checking storage', { filePath, storagePath })
    let existingFile: { name: string }[] | null = null
    let listError: Error | null = null

    const storageCheckStart = performance.now()
    try {
      const listResult = await client.storage
        .from('vault')
        .list(`${orgId}/${contentHash.substring(0, 2)}`, { search: contentHash })
      existingFile = listResult.data
      listError = listResult.error
    } catch (error) {
      // Network error - log and continue (will try to upload)
      logFn('warn', '[syncFile] Storage list error, will attempt upload', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    storageCheckMs = Math.round(performance.now() - storageCheckStart)

    if (listError) {
      logFn('error', '[syncFile] Storage list error', {
        filePath,
        error: listError.message,
        durationMs: storageCheckMs,
      })
    }

    if (!existingFile || existingFile.length === 0) {
      // Convert base64 to blob
      logFn('debug', '[syncFile] Uploading to storage', { filePath, size: base64Content.length })
      const binaryString = atob(base64Content)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes])

      // Upload to storage
      const uploadStart = performance.now()
      try {
        const uploadResult = await client.storage.from('vault').upload(storagePath, blob, {
          contentType: 'application/octet-stream',
          upsert: false,
        })

        storageUploadMs = Math.round(performance.now() - uploadStart)

        if (uploadResult.error && !uploadResult.error.message.includes('already exists')) {
          logFn('error', '[syncFile] Storage upload failed', {
            filePath,
            error: uploadResult.error.message,
            durationMs: storageUploadMs,
          })
          throw uploadResult.error
        }

        // Compute upload speed from actual binary size
        const sizeBytes = binaryString.length
        uploadSpeedKBps =
          storageUploadMs > 0 ? Math.round(sizeBytes / 1024 / (storageUploadMs / 1000)) : null

        logFn('debug', '[syncFile] Storage upload complete', {
          filePath,
          durationMs: storageUploadMs,
          sizeBytes,
          uploadSpeedKBps,
        })
      } catch (error) {
        storageUploadMs = Math.round(performance.now() - uploadStart)
        const errMessage = error instanceof Error ? error.message : String(error)
        logFn('error', '[syncFile] Storage upload error', {
          filePath,
          error: errMessage,
          durationMs: storageUploadMs,
        })
        throw error
      }
    } else {
      logFn('debug', '[syncFile] Content already exists in storage', {
        filePath,
        durationMs: storageCheckMs,
      })
    }

    // 2. Determine file type from extension
    const fileType = getFileTypeFromExtension(extension)

    // 3. Check if file already exists in database (by vault and path)
    // With partial unique index (Agent 1), only active (non-deleted) files have unique constraint
    logFn('debug', '[syncFile] Checking DB for existing file', { filePath, vaultId, orgId })

    // Check for an active (non-deleted) file with matching org
    const dbCheckStart = performance.now()
    const { data: activeFile, error: activeError } = await client
      .from('files')
      .select('id, version, deleted_at, org_id')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()
    dbCheckMs = Math.round(performance.now() - dbCheckStart)

    if (activeError && activeError.code !== 'PGRST116') {
      logFn('error', '[syncFile] Active file check error', {
        filePath,
        error: activeError.message,
        code: activeError.code,
        durationMs: dbCheckMs,
      })
    } else {
      logFn('debug', '[syncFile] DB check complete', {
        filePath,
        found: !!activeFile,
        durationMs: dbCheckMs,
      })
    }

    // If active file exists with same org, update it
    if (activeFile) {
      logFn('debug', '[syncFile] Updating active file', {
        filePath,
        existingId: activeFile.id,
        metadata,
      })

      // Build update payload - only include metadata fields if provided
      const updatePayload: Record<string, unknown> = {
        content_hash: contentHash,
        file_size: fileSize,
        version: activeFile.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }

      // Only update metadata if provided (preserve existing values otherwise)
      if (metadata?.partNumber !== undefined) {
        updatePayload.part_number = metadata.partNumber
      }
      if (metadata?.description !== undefined) {
        updatePayload.description = metadata.description
      }
      if (metadata?.customProperties !== undefined) {
        updatePayload.custom_properties = metadata.customProperties
      }

      const dbWriteStart = performance.now()
      const { data: updatedFile, error } = await dbWithRetry(
        () => client.from('files').update(updatePayload).eq('id', activeFile.id).select().single(),
        'File update',
        logFn,
      )

      if (error || !updatedFile) {
        dbWriteMs = Math.round(performance.now() - dbWriteStart)
        logFn('error', '[syncFile] Update failed', {
          filePath,
          error: error?.message || 'No data returned',
          durationMs: dbWriteMs,
        })
        throw error || new Error('Update returned no data')
      }

      // Type assertion after validation - we know the structure from Supabase schema
      const fileData = updatedFile as {
        revision: string
        workflow_state_id: string | null
        state: string | null
      }

      // Create version record
      await dbWithRetry(
        () =>
          client.from('file_versions').insert({
            file_id: activeFile.id,
            version: activeFile.version + 1,
            revision: fileData.revision,
            content_hash: contentHash,
            file_size: fileSize,
            workflow_state_id: fileData.workflow_state_id,
            state: fileData.state || 'not_tracked',
            created_by: userId,
          }),
        'Version insert',
        logFn,
      )
      dbWriteMs = Math.round(performance.now() - dbWriteStart)

      const totalDurationMs = Math.round(performance.now() - syncStart)
      logFn('info', '[syncFile] Update SUCCESS', {
        filePath,
        fileId: activeFile.id,
        durationMs: dbWriteMs,
      })
      logFn('info', '[syncFile] Sync complete', {
        filePath,
        operation: 'update',
        totalDurationMs,
        storageCheckMs,
        storageUploadMs,
        uploadSpeedKBps,
        dbCheckMs,
        dbWriteMs,
        versionHistoryMs,
        sizeBytes: fileSize,
      })
      return { file: updatedFile, error: null, isNew: false }
    }

    // No active file exists - create new file record
    // With partial unique index, soft-deleted files don't block insertion
    logFn('debug', '[syncFile] Inserting new file', {
      filePath,
      vaultId,
      orgId,
      metadata,
      copiedFromFileId,
    })
    const dbWriteStart = performance.now()
    const { data, error } = await dbWithRetry(
      () =>
        client
          .from('files')
          .insert({
            org_id: orgId,
            vault_id: vaultId,
            file_path: filePath,
            file_name: fileName,
            extension: extension,
            file_type: fileType,
            content_hash: contentHash,
            file_size: fileSize,
            state: 'not_tracked',
            revision: metadata?.revision || '',
            version: 1, // Start at 1, will be updated if copying version history
            part_number: metadata?.partNumber || null,
            description: metadata?.description || null,
            custom_properties: metadata?.customProperties || {},
            created_by: userId,
            updated_by: userId,
          })
          .select()
          .single(),
      'File insert',
      logFn,
    )
    dbWriteMs = Math.round(performance.now() - dbWriteStart)

    if (error || !data) {
      logFn('error', '[syncFile] Insert failed', {
        filePath,
        error: error?.message || 'No data returned',
        code: (error as any)?.code, // TODO: type this
        durationMs: dbWriteMs,
      })
      throw error || new Error('Insert returned no data')
    }

    // Type assertion after validation - we know the structure from Supabase schema
    const insertedFile = data as { id: string }

    // Debug: Log successful insert
    logFn('info', '[syncFile] Insert SUCCESS', {
      filePath,
      fileId: insertedFile.id,
      vaultId,
      durationMs: dbWriteMs,
    })

    // Copy version history from source file if this was a copy-paste operation
    if (copiedFromFileId) {
      logFn('debug', '[syncFile] Copying version history from source', {
        filePath,
        copiedFromFileId,
      })
      const versionHistoryStart = performance.now()

      try {
        // Fetch source file's version history
        const versionFetchStart = performance.now()
        const { data: sourceVersions, error: versionsError } = await client
          .from('file_versions')
          .select(
            'version, revision, content_hash, file_size, workflow_state_id, state, comment, part_number, description, created_by',
          )
          .eq('file_id', copiedFromFileId)
          .order('version', { ascending: true })
        const versionFetchMs = Math.round(performance.now() - versionFetchStart)

        if (versionsError) {
          logFn('warn', '[syncFile] Failed to fetch source versions, falling back to version 1', {
            filePath,
            copiedFromFileId,
            error: versionsError.message,
            durationMs: versionFetchMs,
          })
        }

        if (sourceVersions && sourceVersions.length > 0) {
          const maxSourceVersion = sourceVersions[sourceVersions.length - 1].version
          logFn('debug', '[syncFile] Found source versions', {
            filePath,
            copiedFromFileId,
            versionCount: sourceVersions.length,
            maxVersion: maxSourceVersion,
            durationMs: versionFetchMs,
          })

          // Insert historical versions (1 through N-1) from source
          const historicalVersions = sourceVersions.slice(0, -1).map((v) => ({
            file_id: insertedFile.id,
            version: v.version,
            revision: v.revision,
            content_hash: v.content_hash,
            file_size: v.file_size,
            workflow_state_id: v.workflow_state_id,
            state: v.state,
            comment: v.comment,
            part_number: v.part_number,
            description: v.description,
            created_by: v.created_by,
          }))

          if (historicalVersions.length > 0) {
            await dbWithRetry(
              () => client.from('file_versions').insert(historicalVersions),
              'Historical versions insert',
              logFn,
            )
          }

          // Create version N with the actual uploaded content (may differ from source if modified)
          await dbWithRetry(
            () =>
              client.from('file_versions').insert({
                file_id: insertedFile.id,
                version: maxSourceVersion,
                revision: metadata?.revision || '',
                content_hash: contentHash,
                file_size: fileSize,
                state: 'not_tracked',
                created_by: userId,
              }),
            'Latest version insert',
            logFn,
          )

          // Update the file record version to match the source
          await dbWithRetry(
            () =>
              client.from('files').update({ version: maxSourceVersion }).eq('id', insertedFile.id),
            'File version update',
            logFn,
          )

          // Update the returned data to reflect the correct version
          ;(data as any).version = maxSourceVersion // TODO: type this

          versionHistoryMs = Math.round(performance.now() - versionHistoryStart)
          logFn('info', '[syncFile] Version history copied successfully', {
            filePath,
            copiedFromFileId,
            historicalVersions: historicalVersions.length,
            finalVersion: maxSourceVersion,
            durationMs: versionHistoryMs,
          })
        } else {
          // No source versions found (source may have been deleted) - fall back to version 1
          logFn('warn', '[syncFile] No source versions found, creating version 1', {
            filePath,
            copiedFromFileId,
          })
          await dbWithRetry(
            () =>
              client.from('file_versions').insert({
                file_id: insertedFile.id,
                version: 1,
                revision: metadata?.revision || '',
                content_hash: contentHash,
                file_size: fileSize,
                state: 'not_tracked',
                created_by: userId,
              }),
            'Version insert (fallback)',
            logFn,
          )
          versionHistoryMs = Math.round(performance.now() - versionHistoryStart)
        }
      } catch (copyError) {
        // If version history copying fails, fall back to version 1
        logFn('error', '[syncFile] Version history copy failed, falling back to version 1', {
          filePath,
          copiedFromFileId,
          error: String(copyError),
        })
        versionHistoryMs = Math.round(performance.now() - versionHistoryStart)
        await dbWithRetry(
          () =>
            client.from('file_versions').insert({
              file_id: insertedFile.id,
              version: 1,
              revision: metadata?.revision || '',
              content_hash: contentHash,
              file_size: fileSize,
              state: 'not_tracked',
              created_by: userId,
            }),
          'Version insert (error fallback)',
          logFn,
        )
      }
    } else {
      // No copy source - create initial version record (version 1)
      await dbWithRetry(
        () =>
          client.from('file_versions').insert({
            file_id: insertedFile.id,
            version: 1,
            revision: metadata?.revision || '',
            content_hash: contentHash,
            file_size: fileSize,
            state: 'not_tracked',
            created_by: userId,
          }),
        'Version insert',
        logFn,
      )
    }

    const totalDurationMs = Math.round(performance.now() - syncStart)
    logFn('info', '[syncFile] Sync complete', {
      filePath,
      operation: 'insert',
      totalDurationMs,
      storageCheckMs,
      storageUploadMs,
      uploadSpeedKBps,
      dbCheckMs,
      dbWriteMs,
      versionHistoryMs,
      sizeBytes: fileSize,
    })

    return { file: data, error: null, isNew: true }
  } catch (error) {
    logFn('error', '[syncFile] Exception', { filePath, error: String(error) })
    return { file: null, error, isNew: false }
  }
}

// ============================================
// File Metadata Updates
// ============================================

type LegacyStateChange =
  | { success: boolean; file?: any; error?: string | null; requiresReview?: boolean }
  | 'unmanaged'

/**
 * Move a file to the workflow state that maps to a legacy state name.
 *
 * Returns `'unmanaged'` when the file is not on a workflow, which is the one
 * case where the caller may still write `files.state` itself.
 */
async function executeLegacyStateChange(
  fileId: string,
  targetState: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete',
): Promise<LegacyStateChange> {
  const client = getSupabaseClient()

  const { data, error } = await client.rpc('execute_transition_to_legacy_state', {
    p_file_id: fileId,
    p_target_state: targetState,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const result = (data ?? {}) as {
    success?: boolean
    requires_review?: boolean
    error_code?: string
    error_message?: string
  }

  if (result.error_code === 'NO_WORKFLOW') {
    return 'unmanaged'
  }

  if (result.requires_review) {
    return { success: result.success ?? false, requiresReview: true, error: result.error_message }
  }

  if (!result.success) {
    return { success: false, error: result.error_message ?? 'Failed to change state' }
  }

  const { data: file } = await client.from('files').select('*').eq('id', fileId).single()
  return { success: true, file, error: null }
}

export async function updateFileMetadata(
  fileId: string,
  userId: string,
  updates: {
    state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
    workflow_state_id?: string
  },
): Promise<{ success: boolean; file?: any; error?: string | null; requiresReview?: boolean }> {
  const client = getSupabaseClient()

  // Get current file to validate and log changes
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*, org_id')
    .eq('id', fileId)
    .single()

  if (fetchError) {
    return { success: false, error: fetchError.message }
  }

  // A legacy state name is a projection of the workflow graph, so let the engine
  // walk it: it enforces the role, checkout and gate rules and writes history.
  if (updates.state && updates.state !== file.state) {
    const engineResult = await executeLegacyStateChange(fileId, updates.state)
    if (engineResult !== 'unmanaged') return engineResult

    // The file was never assigned to a workflow, so there is no graph to walk.
    const { data, error } = await client
      .from('files')
      .update({
        state: updates.state,
        state_changed_at: new Date().toISOString(),
        state_changed_by: userId,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', fileId)
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, file: data, error: null }
  }

  // Check if workflow state actually changed
  if (!updates.workflow_state_id || updates.workflow_state_id === file.workflow_state_id) {
    return { success: true, file, error: null }
  }

  // Prepare update data - state changes do NOT increment version
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId,
    workflow_state_id: updates.workflow_state_id,
    state_changed_at: new Date().toISOString(),
    state_changed_by: userId,
  }

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
  try {
    const userEmail = await getCurrentUserEmail()
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: userEmail,
      action: 'state_change',
      details: {
        from_state_id: file.workflow_state_id,
        to_state_id: updates.workflow_state_id,
      },
    })
  } catch {
    // Activity logging is non-critical
  }

  return { success: true, file: data, error: null }
}

export async function updateFilePath(
  fileId: string,
  newPath: string,
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()

  // Extract filename from path
  const newFileName = newPath.split('/').pop() || newPath.split('\\').pop() || newPath

  // Without updated_by the row keeps the previous writer's id, so the realtime
  // subscription reports the change as another user's and notifies the actor
  // about their own edit.
  const { user } = await getCurrentUser()

  const { data, error } = await client
    .from('files')
    .update({
      file_path: newPath,
      file_name: newFileName,
      updated_at: new Date().toISOString(),
      ...(user ? { updated_by: user.id } : {}),
    })
    .eq('id', fileId)
    .select()
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, file: data }
}

async function updateFolderPathLegacy(
  oldFolderPath: string,
  newFolderPath: string,
  vaultId?: string,
): Promise<{ success: boolean; updated: number; total: number; errors: string[] }> {
  const client = getSupabaseClient()

  let query = client
    .from('files')
    .select('id, file_path, file_name')
    .ilike('file_path', `${oldFolderPath}/%`)
    .is('deleted_at', null)

  if (vaultId) {
    query = query.eq('vault_id', vaultId)
  }

  const { data: files, error: fetchError } = await query

  if (fetchError) {
    return { success: false, updated: 0, total: 0, errors: [fetchError.message] }
  }

  if (!files || files.length === 0) {
    return { success: true, updated: 0, total: 0, errors: [] }
  }

  const errors: string[] = []
  const escapedOldPath = oldFolderPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const oldPathPattern = new RegExp(escapedOldPath, 'i')

  const CONCURRENCY = 10
  let updated = 0

  // Matches the rename_folder_files RPC, which sets updated_by so realtime can
  // tell the acting user's own changes apart from other users' changes.
  const { user } = await getCurrentUser()

  const updateOne = async (file: { id: string; file_path: string; file_name: string }) => {
    const newFilePath = file.file_path.replace(oldPathPattern, newFolderPath)
    const { error } = await client
      .from('files')
      .update({
        file_path: newFilePath,
        updated_at: new Date().toISOString(),
        ...(user ? { updated_by: user.id } : {}),
      })
      .eq('id', file.id)

    if (error) {
      errors.push(`Failed to update file ${file.id} (${file.file_path}): ${error.message}`)
    } else {
      updated++
    }
  }

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY)
    await Promise.allSettled(batch.map(updateOne))
  }

  return { success: errors.length === 0, updated, total: files.length, errors }
}

const RPC_NOT_FOUND_CODE = '42883'

export async function updateFolderPath(
  oldFolderPath: string,
  newFolderPath: string,
  vaultId?: string,
): Promise<{ success: boolean; updated: number; total: number; errors: string[]; error?: string }> {
  const client = getSupabaseClient()

  oldFolderPath = oldFolderPath.replace(/\/+$/, '')
  newFolderPath = newFolderPath.replace(/\/+$/, '')

  const { user } = await getCurrentUser()
  if (!user) {
    return { success: false, updated: 0, total: 0, errors: ['Not authenticated'] }
  }

  const { data, error } = await client.rpc('rename_folder_files', {
    p_old_folder_path: oldFolderPath,
    p_new_folder_path: newFolderPath,
    p_user_id: user.id,
    p_vault_id: vaultId,
  })

  if (error) {
    if (error.code === RPC_NOT_FOUND_CODE || error.message?.includes('function')) {
      return updateFolderPathLegacy(oldFolderPath, newFolderPath, vaultId)
    }
    return { success: false, updated: 0, total: 0, errors: [error.message], error: error.message }
  }

  const result = data as { success: boolean; updated: number; error?: string }

  if (!result.success) {
    return {
      success: false,
      updated: 0,
      total: 0,
      errors: [result.error ?? 'RPC returned failure'],
      error: result.error,
    }
  }

  return { success: true, updated: result.updated, total: result.updated, errors: [] }
}

// ============================================
// File References (BOM / Contains / Where-Used)
// ============================================

/**
 * Reference data from SolidWorks service
 */
export interface SWReference {
  /** Local file path of the referenced component */
  childFilePath: string
  /** Number of instances in the assembly */
  quantity: number
  /** SolidWorks configuration name (optional) */
  configuration?: string
  /** Type of reference */
  referenceType: 'component' | 'derived' | 'reference'
}

/**
 * Reason why a reference was skipped during upsert
 */
export interface SkippedReferenceReason {
  /** Original path from SolidWorks */
  swPath: string
  /** Reason the reference was skipped */
  reason: 'no_match' | 'file_not_synced' | 'ambiguous_filename'
  /** Additional details about the skip */
  details?: string
}

/**
 * Result of upsertFileReferences operation
 */
export interface UpsertReferencesResult {
  success: boolean
  inserted: number
  updated: number
  deleted: number
  skipped: number
  /** Detailed reasons for skipped references (useful for debugging) */
  skippedReasons?: SkippedReferenceReason[]
  error?: string
}

/**
 * Normalize a path for matching: lowercase, forward slashes, no leading/trailing slashes
 */
function normalizePathForMatching(path: string): string {
  return path.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Extract relative path from SW absolute path by stripping vault root
 * @param swPath - Absolute path from SolidWorks (e.g., "C:\Users\...\VaultRoot\folder\part.sldprt")
 * @param vaultRootPath - Optional vault root path to strip (e.g., "C:\Users\...\VaultRoot")
 * @returns Normalized relative path (e.g., "folder/part.sldprt")
 */
function extractRelativeFromSwPath(swPath: string, vaultRootPath?: string): string {
  let path = normalizePathForMatching(swPath)

  // Strip vault root if provided
  if (vaultRootPath) {
    const normalizedRoot = normalizePathForMatching(vaultRootPath)
    if (path.startsWith(normalizedRoot + '/')) {
      path = path.substring(normalizedRoot.length + 1)
    } else if (path.startsWith(normalizedRoot)) {
      path = path.substring(normalizedRoot.length)
    }
  }

  // Remove leading slash if present after stripping
  return path.replace(/^\/+/, '')
}

/**
 * Get the last N path segments for suffix matching
 * @param path - Normalized path
 * @param segmentCount - Number of trailing segments to get
 * @returns Last N segments joined by /
 */
function getPathSuffix(path: string, segmentCount: number): string {
  const segments = path.split('/').filter((s) => s.length > 0)
  if (segments.length <= segmentCount) {
    return segments.join('/')
  }
  return segments.slice(-segmentCount).join('/')
}

/**
 * Upsert file references for an assembly.
 *
 * This function:
 * 1. Resolves child file paths to database file IDs (within the same vault)
 * 2. Inserts/updates references in file_references table
 * 3. Removes stale references that no longer exist in the assembly
 *
 * @param orgId - Organization ID
 * @param vaultId - Vault ID (to scope file lookups)
 * @param parentFileId - Database ID of the parent assembly file
 * @param references - Array of reference data from SolidWorks service
 * @param vaultRootPath - Optional local vault root path (for better path matching)
 */
export async function upsertFileReferences(
  orgId: string,
  vaultId: string,
  parentFileId: string,
  references: SWReference[],
  vaultRootPath?: string,
): Promise<UpsertReferencesResult> {
  const client = getSupabaseClient()

  const logFn =
    typeof window !== 'undefined' && (window as any).electronAPI?.log // TODO: type this
      ? (level: string, msg: string, data?: any) =>
          (window as any).electronAPI.log(level, msg, data) // TODO: type this
      : () => {}

  logFn('debug', '[upsertFileReferences] Starting', {
    orgId,
    vaultId,
    parentFileId,
    referenceCount: references.length,
    vaultRootPath: vaultRootPath || '(not provided)',
  })

  let inserted = 0
  let updated = 0
  let deleted = 0
  let skipped = 0
  const skippedReasons: SkippedReferenceReason[] = []

  try {
    // Step 1: Get all files in the vault to build a path -> ID lookup
    // We need to match local file paths to database records
    const { data: vaultFiles, error: filesError } = await client
      .from('files')
      .select('id, file_path, file_name')
      .eq('vault_id', vaultId)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (filesError) {
      logFn('error', '[upsertFileReferences] Failed to fetch vault files', {
        error: filesError.message,
      })
      return {
        success: false,
        inserted: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        error: filesError.message,
      }
    }

    // Build lookup maps for path matching
    // Map 1: normalized relative path -> file ID
    // Map 2: filename -> file ID (for fallback, only unique filenames)
    // Map 3: path suffix (last 2 segments) -> file ID (for suffix fallback)
    const pathToFileId = new Map<string, string>()
    const filenameToFileId = new Map<string, string>()
    const filenameAmbiguous = new Set<string>() // Track which filenames are ambiguous
    const suffixToFileId = new Map<string, string>()
    const suffixAmbiguous = new Set<string>() // Track which suffixes are ambiguous

    for (const file of vaultFiles || []) {
      // Normalize path: lowercase, forward slashes, no leading slash
      const normalizedPath = normalizePathForMatching(file.file_path)
      pathToFileId.set(normalizedPath, file.id)

      // Index by filename
      const filename = file.file_name.toLowerCase()
      if (filenameAmbiguous.has(filename)) {
        // Already known to be ambiguous, skip
      } else if (filenameToFileId.has(filename)) {
        // Multiple files with same name - mark as ambiguous
        filenameToFileId.delete(filename)
        filenameAmbiguous.add(filename)
      } else {
        filenameToFileId.set(filename, file.id)
      }

      // Index by path suffix (last 2 segments, e.g., "folder/part.sldprt")
      const suffix = getPathSuffix(normalizedPath, 2)
      if (suffixAmbiguous.has(suffix)) {
        // Already known to be ambiguous, skip
      } else if (suffixToFileId.has(suffix)) {
        // Multiple files with same suffix - mark as ambiguous
        suffixToFileId.delete(suffix)
        suffixAmbiguous.add(suffix)
      } else {
        suffixToFileId.set(suffix, file.id)
      }
    }

    // Map 4: basename (without extension) -> { fileId, ext }[]
    // This handles extensionless references like "BB120-WEATHERSTATION" that should match "BB120-WEATHERSTATION.SLDPRT"
    const basenameToFiles = new Map<string, Array<{ fileId: string; ext: string }>>()
    for (const file of vaultFiles || []) {
      const basename = file.file_name.toLowerCase().replace(/\.[^.]+$/, '')
      const ext = (file.file_name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()

      const existing = basenameToFiles.get(basename) || []
      existing.push({ fileId: file.id, ext })
      basenameToFiles.set(basename, existing)
    }

    logFn('debug', '[upsertFileReferences] Built lookup maps', {
      totalVaultFiles: vaultFiles?.length || 0,
      exactPathCount: pathToFileId.size,
      uniqueFilenameCount: filenameToFileId.size,
      ambiguousFilenameCount: filenameAmbiguous.size,
      uniqueSuffixCount: suffixToFileId.size,
      ambiguousSuffixCount: suffixAmbiguous.size,
      basenameCount: basenameToFiles.size,
    })

    // Step 2: Get existing references for this parent file
    const { data: existingRefs, error: refsError } = await client
      .from('file_references')
      .select('id, child_file_id, configuration')
      .eq('parent_file_id', parentFileId)
      .eq('org_id', orgId)

    if (refsError) {
      logFn('error', '[upsertFileReferences] Failed to fetch existing refs', {
        error: refsError.message,
      })
      return {
        success: false,
        inserted: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        error: refsError.message,
      }
    }

    // Build a set of existing references for comparison
    // Key: `${child_file_id}::${configuration || ''}`
    const existingRefMap = new Map<string, { id: string; childFileId: string }>()
    for (const ref of existingRefs || []) {
      const key = `${ref.child_file_id}::${ref.configuration || ''}`
      existingRefMap.set(key, { id: ref.id, childFileId: ref.child_file_id })
    }

    // Step 3: Process each reference from SolidWorks
    const processedChildIds = new Set<string>()
    const toInsert: Array<{
      org_id: string
      parent_file_id: string
      child_file_id: string
      reference_type: 'component' | 'derived' | 'reference'
      quantity: number
      configuration: string | null
    }> = []

    const toUpdate: Array<{
      id: string
      quantity: number
      reference_type: 'component' | 'derived' | 'reference'
    }> = []

    for (const ref of references) {
      // Normalize the child file path from SolidWorks
      // SolidWorks returns absolute paths like "C:\Users\...\VaultRoot\folder\part.sldprt"
      // We need to extract the relative path "folder/part.sldprt"

      const normalizedSwPath = normalizePathForMatching(ref.childFilePath)
      const relativePath = extractRelativeFromSwPath(ref.childFilePath, vaultRootPath)
      const filename = normalizedSwPath.split('/').pop() || ''
      const pathSuffix = getPathSuffix(normalizedSwPath, 2)

      logFn('debug', '[upsertFileReferences] Processing reference', {
        originalPath: ref.childFilePath,
        normalizedSwPath,
        relativePath,
        filename,
        pathSuffix,
        vaultRootStripped: vaultRootPath ? relativePath !== normalizedSwPath : false,
      })

      // Try to find a matching file in the vault using multiple strategies
      let childFileId: string | null = null
      let matchMethod:
        | 'exact'
        | 'suffix'
        | 'suffix_fallback'
        | 'filename'
        | 'extension_inferred'
        | null = null

      // Strategy 1: Exact relative path match
      if (pathToFileId.has(relativePath)) {
        childFileId = pathToFileId.get(relativePath)!
        matchMethod = 'exact'
        logFn('debug', '[upsertFileReferences] MATCH: exact relative path', {
          swPath: ref.childFilePath,
          matchedPath: relativePath,
        })
      }

      // Strategy 2: Check if normalized SW path ends with any database path
      if (!childFileId) {
        for (const [dbPath, fileId] of Array.from(pathToFileId.entries())) {
          if (normalizedSwPath.endsWith('/' + dbPath) || normalizedSwPath === dbPath) {
            childFileId = fileId
            matchMethod = 'suffix'
            logFn('debug', '[upsertFileReferences] MATCH: SW path ends with DB path', {
              swPath: ref.childFilePath,
              matchedDbPath: dbPath,
            })
            break
          }
        }
      }

      // Strategy 3: Path suffix matching (last 2 segments)
      if (!childFileId && suffixToFileId.has(pathSuffix)) {
        childFileId = suffixToFileId.get(pathSuffix)!
        matchMethod = 'suffix_fallback'
        logFn('debug', '[upsertFileReferences] MATCH: path suffix (last 2 segments)', {
          swPath: ref.childFilePath,
          matchedSuffix: pathSuffix,
        })
      }

      // Strategy 4: Filename-only fallback (only if unique)
      if (!childFileId && filenameToFileId.has(filename)) {
        childFileId = filenameToFileId.get(filename)!
        matchMethod = 'filename'
        logFn('debug', '[upsertFileReferences] MATCH: unique filename fallback', {
          swPath: ref.childFilePath,
          matchedFilename: filename,
        })
      }

      // Strategy 5: Extension inference (for extensionless refs like "BB120-WEATHERSTATION")
      // SolidWorks assemblies sometimes store component references without file extensions
      if (!childFileId && !filename.includes('.')) {
        const basename = filename.toLowerCase()
        const candidates = basenameToFiles.get(basename)

        if (candidates && candidates.length === 1) {
          // Unique match - only one file with this basename
          childFileId = candidates[0].fileId
          matchMethod = 'extension_inferred'
          logFn('debug', '[upsertFileReferences] MATCH: extension inferred', {
            swPath: ref.childFilePath,
            inferredFile: `${basename}${candidates[0].ext}`,
          })
        } else if (candidates && candidates.length > 1) {
          // Ambiguous - multiple files with same basename but different extensions
          // Prefer .sldprt > .sldasm > .slddrw (most assembly refs are to parts)
          const preferredOrder = ['.sldprt', '.sldasm', '.slddrw']
          for (const prefExt of preferredOrder) {
            const match = candidates.find((c) => c.ext === prefExt)
            if (match) {
              childFileId = match.fileId
              matchMethod = 'extension_inferred'
              logFn('debug', '[upsertFileReferences] MATCH: extension inferred (preferred)', {
                swPath: ref.childFilePath,
                inferredFile: `${basename}${prefExt}`,
                otherCandidates: candidates.filter((c) => c.ext !== prefExt).map((c) => c.ext),
              })
              break
            }
          }
        }
      }

      // No match found - log detailed reason
      if (!childFileId) {
        let skipReason: SkippedReferenceReason['reason'] = 'no_match'
        let details: string

        // Check if filename exists but is ambiguous
        if (filenameAmbiguous.has(filename)) {
          skipReason = 'ambiguous_filename'
          details = `Multiple files named "${filename}" in vault - cannot determine which one`
        } else if (suffixAmbiguous.has(pathSuffix)) {
          skipReason = 'ambiguous_filename'
          details = `Multiple files with path suffix "${pathSuffix}" - cannot determine which one`
        } else if (!filename.includes('.')) {
          // Extensionless reference - check if we have candidates that don't match preferred extensions
          const basename = filename.toLowerCase()
          const candidates = basenameToFiles.get(basename)
          if (candidates && candidates.length > 1) {
            skipReason = 'ambiguous_filename'
            details = `Multiple files match "${filename}" with different extensions: ${candidates.map((c) => c.ext).join(', ')} (none matched preferred order)`
          } else if (!candidates || candidates.length === 0) {
            skipReason = 'file_not_synced'
            details = `No matching file found for extensionless reference "${filename}". File may not be synced.`
          } else {
            // Shouldn't reach here - single candidate should have matched in Strategy 5
            skipReason = 'file_not_synced'
            details = `No matching file found in database. Tried: exact path "${relativePath}", suffix "${pathSuffix}", filename "${filename}" (extensionless)`
          }
        } else {
          skipReason = 'file_not_synced'
          details = `No matching file found in database. Tried: exact path "${relativePath}", suffix "${pathSuffix}", filename "${filename}"`
        }

        logFn('debug', '[upsertFileReferences] SKIP: No match found', {
          swPath: ref.childFilePath,
          reason: skipReason,
          details,
          triedPaths: {
            exact: relativePath,
            suffix: pathSuffix,
            filename,
          },
        })

        skippedReasons.push({
          swPath: ref.childFilePath,
          reason: skipReason,
          details,
        })
        skipped++
        continue
      }

      logFn('debug', '[upsertFileReferences] Matched reference', {
        swPath: ref.childFilePath,
        childFileId,
        matchMethod,
      })

      // Generate the unique key for this reference
      const refKey = `${childFileId}::${ref.configuration || ''}`
      processedChildIds.add(refKey)

      if (existingRefMap.has(refKey)) {
        // Reference exists - queue for update
        const existing = existingRefMap.get(refKey)!
        toUpdate.push({
          id: existing.id,
          quantity: ref.quantity,
          reference_type: ref.referenceType,
        })
      } else {
        // New reference - queue for insert
        toInsert.push({
          org_id: orgId,
          parent_file_id: parentFileId,
          child_file_id: childFileId,
          reference_type: ref.referenceType,
          quantity: ref.quantity,
          configuration: ref.configuration || null,
        })
      }
    }

    // Step 4: Delete stale references (in DB but not in current assembly)
    const staleRefIds: string[] = []
    for (const [key, ref] of Array.from(existingRefMap.entries())) {
      if (!processedChildIds.has(key)) {
        staleRefIds.push(ref.id)
      }
    }

    if (staleRefIds.length > 0) {
      logFn('debug', '[upsertFileReferences] Deleting stale references', {
        count: staleRefIds.length,
      })
      const { error: deleteError } = await client
        .from('file_references')
        .delete()
        .in('id', staleRefIds)

      if (deleteError) {
        logFn('warn', '[upsertFileReferences] Failed to delete stale refs', {
          error: deleteError.message,
        })
      } else {
        deleted = staleRefIds.length
      }
    }

    // Step 5: Batch insert new references
    if (toInsert.length > 0) {
      logFn('debug', '[upsertFileReferences] Inserting new references', { count: toInsert.length })
      const { error: insertError } = await client.from('file_references').insert(toInsert)

      if (insertError) {
        // Handle unique constraint violations (might happen in race conditions)
        if (insertError.code === '23505') {
          logFn('warn', '[upsertFileReferences] Some inserts conflicted (race condition)', {
            error: insertError.message,
          })
        } else {
          logFn('error', '[upsertFileReferences] Insert failed', { error: insertError.message })
          return {
            success: false,
            inserted: 0,
            updated: 0,
            deleted,
            skipped,
            error: insertError.message,
          }
        }
      } else {
        inserted = toInsert.length
      }
    }

    // Step 6: Update existing references
    if (toUpdate.length > 0) {
      logFn('debug', '[upsertFileReferences] Updating existing references', {
        count: toUpdate.length,
      })
      for (const upd of toUpdate) {
        const { error: updateError } = await client
          .from('file_references')
          .update({
            quantity: upd.quantity,
            reference_type: upd.reference_type,
            updated_at: new Date().toISOString(),
          })
          .eq('id', upd.id)

        if (!updateError) {
          updated++
        } else {
          logFn('warn', '[upsertFileReferences] Update failed for ref', {
            id: upd.id,
            error: updateError.message,
          })
        }
      }
    }

    logFn('info', '[upsertFileReferences] Complete', {
      parentFileId,
      inserted,
      updated,
      deleted,
      skipped,
      skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined,
    })

    return {
      success: true,
      inserted,
      updated,
      deleted,
      skipped,
      skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined,
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logFn('error', '[upsertFileReferences] Exception', { error: errMsg })
    return {
      success: false,
      inserted,
      updated,
      deleted,
      skipped,
      skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined,
      error: errMsg,
    }
  }
}

/**
 * Update configuration revision for a referenced part/assembly.
 *
 * When a drawing is checked in, this function propagates the drawing's revision
 * to the configuration_revisions field of the referenced part/assembly.
 *
 * For example, if Drawing.slddrw (revision "B") references Part.sldprt with
 * configuration "Anodized", then Part.sldprt's configuration_revisions will
 * be updated to include: { "Anodized": "B" }
 *
 * @param referencedFileId - Database ID of the part/assembly being referenced
 * @param configuration - The configuration name being referenced (e.g., "Default", "Anodized")
 * @param drawingRevision - The drawing's revision to propagate (e.g., "B")
 */
export async function updateConfigurationRevision(
  referencedFileId: string,
  configuration: string,
  drawingRevision: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  const logFn =
    typeof window !== 'undefined' && (window as any).electronAPI?.log // TODO: type this
      ? (level: string, msg: string, data?: any) =>
          (window as any).electronAPI.log(level, msg, data) // TODO: type this
      : () => {}

  try {
    // First, get the current configuration_revisions for the file
    const { data: file, error: fetchError } = await client
      .from('files')
      .select('id, file_name, configuration_revisions')
      .eq('id', referencedFileId)
      .single()

    if (fetchError || !file) {
      logFn('warn', '[updateConfigurationRevision] Could not fetch file', {
        referencedFileId,
        error: fetchError?.message,
      })
      return { success: false, error: fetchError?.message || 'File not found' }
    }

    // Merge the new configuration revision into existing ones
    const currentRevisions = (file.configuration_revisions || {}) as Record<string, string>
    const updatedRevisions = {
      ...currentRevisions,
      [configuration]: drawingRevision,
    }

    // Update the file with the new configuration_revisions
    const { error: updateError } = await client
      .from('files')
      .update({
        configuration_revisions: updatedRevisions,
        updated_at: new Date().toISOString(),
      })
      .eq('id', referencedFileId)

    if (updateError) {
      logFn('error', '[updateConfigurationRevision] Update failed', {
        referencedFileId,
        configuration,
        drawingRevision,
        error: updateError.message,
      })
      return { success: false, error: updateError.message }
    }

    logFn('info', '[updateConfigurationRevision] Updated configuration revision', {
      fileName: file.file_name,
      referencedFileId,
      configuration,
      drawingRevision,
      previousRevision: currentRevisions[configuration] || null,
    })

    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logFn('error', '[updateConfigurationRevision] Exception', { error: errMsg })
    return { success: false, error: errMsg }
  }
}

/**
 * Propagate a drawing's revision to all referenced parts/assemblies.
 *
 * This function finds all file_references where the drawing is the parent,
 * and updates the configuration_revisions of each child file.
 *
 * @param drawingFileId - Database ID of the drawing file
 * @param drawingRevision - The drawing's revision to propagate
 * @param orgId - Organization ID
 */
export async function propagateDrawingRevisionToConfigurations(
  drawingFileId: string,
  drawingRevision: string,
  orgId: string,
): Promise<{ success: boolean; updated: number; errors: string[] }> {
  const client = getSupabaseClient()

  const logFn =
    typeof window !== 'undefined' && (window as any).electronAPI?.log // TODO: type this
      ? (level: string, msg: string, data?: any) =>
          (window as any).electronAPI.log(level, msg, data) // TODO: type this
      : () => {}

  let updated = 0
  const errors: string[] = []

  try {
    logFn('info', '[propagateDrawingRevision] Starting propagation', {
      drawingFileId,
      drawingRevision,
    })

    // Get all references from this drawing to parts/assemblies
    const { data: references, error: refsError } = await client
      .from('file_references')
      .select(
        `
        id,
        child_file_id,
        configuration,
        reference_type,
        child_file:files!file_references_child_file_id_fkey (
          id,
          file_name,
          extension,
          configuration_revisions
        )
      `,
      )
      .eq('parent_file_id', drawingFileId)
      .eq('org_id', orgId)

    if (refsError) {
      logFn('error', '[propagateDrawingRevision] Failed to fetch references', {
        error: refsError.message,
      })
      return { success: false, updated: 0, errors: [refsError.message] }
    }

    if (!references || references.length === 0) {
      logFn('debug', '[propagateDrawingRevision] No references found for drawing', {
        drawingFileId,
      })
      return { success: true, updated: 0, errors: [] }
    }

    logFn('debug', '[propagateDrawingRevision] Found references', {
      drawingFileId,
      referenceCount: references.length,
    })

    // Update each referenced file's configuration revision
    for (const ref of references) {
      // Skip if child file doesn't exist
      const childFile = ref.child_file as {
        id: string
        file_name: string
        extension: string
        configuration_revisions: Record<string, string> | null
      } | null
      if (!childFile) {
        logFn('warn', '[propagateDrawingRevision] Child file not found', {
          refId: ref.id,
          childFileId: ref.child_file_id,
        })
        continue
      }

      // Use the configuration from the reference, or "Default" if not specified
      const configName = ref.configuration || 'Default'

      const result = await updateConfigurationRevision(
        ref.child_file_id,
        configName,
        drawingRevision,
      )

      if (result.success) {
        updated++
        logFn('info', '[propagateDrawingRevision] Updated config revision', {
          childFileName: childFile.file_name,
          configuration: configName,
          newRevision: drawingRevision,
        })
      } else {
        errors.push(`Failed to update ${childFile.file_name}: ${result.error}`)
      }
    }

    logFn('info', '[propagateDrawingRevision] Complete', {
      drawingFileId,
      drawingRevision,
      updated,
      errorCount: errors.length,
    })

    return { success: errors.length === 0, updated, errors }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logFn('error', '[propagateDrawingRevision] Exception', { error: errMsg })
    return { success: false, updated, errors: [...errors, errMsg] }
  }
}
