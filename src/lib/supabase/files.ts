// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient } from './client'
import { getCurrentUserEmail } from './auth'

// ============================================
// Files - Read Operations
// ============================================

/**
 * Get files with full metadata including user info (slower, use for single file or small sets)
 */
export async function getFiles(orgId: string, options?: {
  vaultId?: string
  folder?: string
  state?: string[]
  search?: string
  checkedOutByMe?: string  // user ID
  includeDeleted?: boolean  // Include soft-deleted files (default: false)
  workflow_state_ids?: string[]
}) {
  const client = getSupabaseClient()
  let query = client
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url),
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('org_id', orgId)
    .order('file_path', { ascending: true })
  
  // Filter out soft-deleted files by default
  if (!options?.includeDeleted) {
    query = query.is('deleted_at', null)
  }
  
  // Filter by vault if specified
  if (options?.vaultId) {
    query = query.eq('vault_id', options.vaultId)
  }
  
  if (options?.folder) {
    query = query.ilike('file_path', `${options.folder}%`)
  }
  
  if (options?.workflow_state_ids && options.workflow_state_ids.length > 0) {
    query = query.in('workflow_state_id', options.workflow_state_ids)
  }
  
  if (options?.search) {
    query = query.or(
      `file_name.ilike.%${options.search}%,` +
      `part_number.ilike.%${options.search}%,` +
      `description.ilike.%${options.search}%`
    )
  }
  
  if (options?.checkedOutByMe) {
    query = query.eq('checked_out_by', options.checkedOutByMe)
  }
  
  const { data, error } = await query
  return { files: data, error }
}

/**
 * Lightweight file fetch for initial vault sync - only essential columns, no joins
 * Much faster than getFiles() for large vaults
 * Automatically filters out soft-deleted files (deleted_at is set)
 * Uses pagination to fetch ALL files (Supabase default limit is 1000)
 */
export async function getFilesLightweight(orgId: string, vaultId?: string) {
  const logFn = typeof window !== 'undefined' && (window as any).electronAPI?.log
    ? (level: string, msg: string, data?: any) => (window as any).electronAPI.log(level, msg, data)
    : () => {}
  
  logFn('debug', '[getFilesLightweight] Querying', { orgId, vaultId })
  
  const client = getSupabaseClient()
  
  // DEBUG: First check what files exist for this vault (ignoring org_id AND deleted_at)
  if (vaultId) {
    // Query WITHOUT deleted_at filter to see if files exist but are soft-deleted
    const { data: allVaultFiles, error: allErr } = await client
      .from('files')
      .select('id, org_id, file_path, deleted_at')
      .eq('vault_id', vaultId)
      .limit(5)
    
    if (allVaultFiles && allVaultFiles.length > 0) {
      const hasDeletedFiles = allVaultFiles.some(f => f.deleted_at)
      const hasWrongOrg = allVaultFiles.some(f => f.org_id !== orgId)
      
      if (hasDeletedFiles) {
        logFn('error', '[getFilesLightweight] FILES ARE SOFT-DELETED! They have deleted_at set!', {
          vaultId,
          sampleFiles: allVaultFiles.map(f => ({ 
            id: f.id, 
            org_id: f.org_id, 
            path: f.file_path,
            deleted_at: f.deleted_at 
          }))
        })
      } else if (hasWrongOrg) {
        logFn('warn', '[getFilesLightweight] Files exist but have wrong org_id!', {
          vaultId,
          expectedOrgId: orgId,
          sampleFiles: allVaultFiles.map(f => ({ id: f.id, org_id: f.org_id, path: f.file_path }))
        })
      } else {
        logFn('debug', '[getFilesLightweight] Files exist and look correct', {
          count: allVaultFiles.length,
          sampleFiles: allVaultFiles.map(f => ({ id: f.id, path: f.file_path }))
        })
      }
    } else {
      logFn('debug', '[getFilesLightweight] No files found in vault at all (even deleted)', { vaultId, allErr: allErr?.message })
    }
  }
  
  // Fetch ALL files using pagination (Supabase default limit is 1000)
  const PAGE_SIZE = 1000
  const allFiles: any[] = []
  let offset = 0
  let hasMore = true
  
  while (hasMore) {
    let query = client
      .from('files')
      .select(`
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
        checked_out_by,
        checked_out_at,
        updated_at
      `)
      .eq('org_id', orgId)
      .is('deleted_at', null)  // Filter out soft-deleted files
      .order('file_path', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    
    if (vaultId) {
      query = query.eq('vault_id', vaultId)
    }
    
    const { data, error } = await query
    
    if (error) {
      logFn('error', '[getFilesLightweight] Query error', { 
        offset,
        error: error.message 
      })
      return { files: allFiles.length > 0 ? allFiles : null, error }
    }
    
    if (data && data.length > 0) {
      allFiles.push(...data)
      offset += data.length
      // If we got fewer than PAGE_SIZE, we've reached the end
      hasMore = data.length === PAGE_SIZE
      
      if (hasMore) {
        logFn('debug', '[getFilesLightweight] Fetching more files', { 
          fetchedSoFar: allFiles.length,
          offset 
        })
      }
    } else {
      hasMore = false
    }
  }
  
  logFn('debug', '[getFilesLightweight] Result', { 
    fileCount: allFiles.length, 
    hasError: false,
    pages: Math.ceil(allFiles.length / PAGE_SIZE)
  })
  
  return { files: allFiles, error: null }
}

/**
 * Get checked out user info for a batch of file IDs
 * Used to lazily load user info after initial sync
 */
export async function getCheckedOutUsers(fileIds: string[]) {
  if (fileIds.length === 0) return { users: {}, error: null }
  
  const client = getSupabaseClient()
  
  // First get files with their checked_out_by user IDs
  const { data: files, error: filesError } = await client
    .from('files')
    .select('id, checked_out_by')
    .in('id', fileIds)
    .not('checked_out_by', 'is', null)
  
  if (filesError) return { users: {}, error: filesError }
  if (!files || files.length === 0) return { users: {}, error: null }
  
  // Get unique user IDs
  const userIds = [...new Set(files.map(f => f.checked_out_by).filter(Boolean))]
  
  // Fetch user info separately
  const { data: usersData, error: usersError } = await client
    .from('users')
    .select('id, email, full_name, avatar_url')
    .in('id', userIds)
  
  if (usersError) return { users: {}, error: usersError }
  
  // Create a user lookup map
  const userLookup = new Map(usersData?.map(u => [u.id, u]) || [])
  
  // Convert to a map for easy lookup by file ID
  const users: Record<string, { email: string; full_name: string; avatar_url?: string }> = {}
  for (const file of files) {
    const user = userLookup.get(file.checked_out_by)
    if (user) {
      users[file.id] = {
        email: user.email,
        full_name: user.full_name || '',
        avatar_url: user.avatar_url || undefined
      }
    }
  }
  
  return { users, error: null }
}

/**
 * Get basic user info by ID (for checkout display)
 * Used when realtime updates come in and we need to show who checked out a file
 */
export async function getUserBasicInfo(userId: string): Promise<{ 
  user: { email: string; full_name: string; avatar_url?: string } | null; 
  error?: string 
}> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('users')
    .select('email, full_name, avatar_url')
    .eq('id', userId)
    .single()
  
  if (error) {
    console.error('[getUserBasicInfo] Failed to fetch user:', error.message)
    return { user: null, error: error.message }
  }
  
  return { 
    user: data ? {
      email: data.email,
      full_name: data.full_name || '',
      avatar_url: data.avatar_url || undefined
    } : null 
  }
}

export async function getFile(fileId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url),
      created_by_user:users!created_by(email, full_name),
      updated_by_user:users!updated_by(email, full_name)
    `)
    .eq('id', fileId)
    .single()
  
  return { file: data, error }
}

export async function getFileByPath(orgId: string, filePath: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select('*')
    .eq('org_id', orgId)
    .eq('file_path', filePath)
    .single()
  
  return { file: data, error }
}

// ============================================
// Files - Version History
// ============================================

export async function getFileVersions(fileId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('file_versions')
    .select(`
      *,
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('file_id', fileId)
    .order('version', { ascending: false })
  
  return { versions: data, error }
}

// ============================================
// Files - References (Where-Used / BOM)
// ============================================

export async function getWhereUsed(fileId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('file_references')
    .select(`
      *,
      parent:files!parent_file_id(
        id, file_name, file_path, part_number, revision, state
      )
    `)
    .eq('child_file_id', fileId)
  
  return { references: data, error }
}

export async function getContains(fileId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('file_references')
    .select(`
      *,
      child:files!child_file_id(
        id, file_name, file_path, part_number, revision, state
      )
    `)
    .eq('parent_file_id', fileId)
  
  return { references: data, error }
}

// ============================================
// Checked Out Files (for current user)
// ============================================

export async function getMyCheckedOutFiles(userId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select('*')
    .eq('checked_out_by', userId)
    .order('checked_out_at', { ascending: false })
  
  return { files: data, error }
}

export async function getAllCheckedOutFiles(orgId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url)
    `)
    .eq('org_id', orgId)
    .not('checked_out_by', 'is', null)
    .order('checked_out_at', { ascending: false })
  
  return { files: data, error }
}

// ============================================
// Sync Operations
// ============================================

function getFileTypeFromExtension(ext: string): 'part' | 'assembly' | 'drawing' | 'document' | 'other' {
  const lowerExt = ext.toLowerCase()
  if (['.sldprt', '.prt', '.ipt', '.par'].includes(lowerExt)) return 'part'
  if (['.sldasm', '.asm', '.iam'].includes(lowerExt)) return 'assembly'
  if (['.slddrw', '.drw', '.idw', '.dwg'].includes(lowerExt)) return 'drawing'
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'].includes(lowerExt)) return 'document'
  return 'other'
}

export async function syncFile(
  orgId: string,
  vaultId: string,
  userId: string,
  filePath: string,  // relative path in vault
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
  }
) {
  const client = getSupabaseClient()
  
  // Debug: Log sync attempt
  const logFn = typeof window !== 'undefined' && (window as any).electronAPI?.log
    ? (level: string, msg: string, data?: any) => (window as any).electronAPI.log(level, msg, data)
    : () => {}
  
  logFn('debug', '[syncFile] Starting sync', { orgId, vaultId, filePath, fileName })
  
  try {
    // 1. Upload file content to storage (using content hash as filename for deduplication)
    // Use subdirectory based on first 2 chars of hash to prevent too many files in one folder
    const storagePath = `${orgId}/${contentHash.substring(0, 2)}/${contentHash}`
    
    // Check if this content already exists (deduplication)
    logFn('debug', '[syncFile] Checking storage', { filePath, storagePath })
    const { data: existingFile, error: listError } = await client.storage
      .from('vault')
      .list(`${orgId}/${contentHash.substring(0, 2)}`, { search: contentHash })
    
    if (listError) {
      logFn('error', '[syncFile] Storage list error', { filePath, error: listError.message })
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
      const { error: uploadError } = await client.storage
        .from('vault')
        .upload(storagePath, blob, {
          contentType: 'application/octet-stream',
          upsert: false
        })
      
      if (uploadError && !uploadError.message.includes('already exists')) {
        logFn('error', '[syncFile] Storage upload failed', { filePath, error: uploadError.message })
        throw uploadError
      }
      logFn('debug', '[syncFile] Storage upload complete', { filePath })
    } else {
      logFn('debug', '[syncFile] Content already exists in storage', { filePath })
    }
    
    // 2. Determine file type from extension
    const fileType = getFileTypeFromExtension(extension)
    
    // 3. Check if file already exists in database (by vault and path)
    // IMPORTANT: Check for ACTIVE files (not deleted) first, then check for soft-deleted files
    logFn('debug', '[syncFile] Checking DB for existing file', { filePath, vaultId, orgId })
    
    // First check for an active (non-deleted) file with matching org
    const { data: activeFile, error: activeError } = await client
      .from('files')
      .select('id, version, deleted_at, org_id')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()
    
    if (activeError && activeError.code !== 'PGRST116') {
      logFn('error', '[syncFile] Active file check error', { filePath, error: activeError.message, code: activeError.code })
    }
    
    // If active file exists with same org, update it
    if (activeFile) {
      logFn('debug', '[syncFile] Updating active file', { filePath, existingId: activeFile.id, metadata })
      
      // Build update payload - only include metadata fields if provided
      const updatePayload: Record<string, unknown> = {
        content_hash: contentHash,
        file_size: fileSize,
        version: activeFile.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: userId
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
      
      const { data, error } = await client
        .from('files')
        .update(updatePayload)
        .eq('id', activeFile.id)
        .select()
        .single()
      
      if (error) {
        logFn('error', '[syncFile] Update failed', { filePath, error: error.message })
        throw error
      }
      
      // Create version record
      await client.from('file_versions').insert({
        file_id: activeFile.id,
        version: activeFile.version + 1,
        revision: data.revision,
        content_hash: contentHash,
        file_size: fileSize,
        workflow_state_id: data.workflow_state_id,
        state: data.state || 'not_tracked',
        created_by: userId
      })
      
      logFn('info', '[syncFile] Update SUCCESS', { filePath, fileId: activeFile.id })
      return { file: data, error: null, isNew: false }
    }
    
    // Check for soft-deleted files that might block insertion (due to UNIQUE constraint)
    const { data: deletedFiles, error: deletedError } = await client
      .from('files')
      .select('id, org_id, deleted_at')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .not('deleted_at', 'is', null)
    
    if (deletedError) {
      logFn('error', '[syncFile] Deleted file check error', { filePath, error: deletedError.message })
    }
    
    // If soft-deleted files exist, permanently delete them first to clear the UNIQUE constraint
    // This is necessary because UNIQUE(vault_id, file_path) doesn't exclude deleted files
    if (deletedFiles && deletedFiles.length > 0) {
      logFn('warn', '[syncFile] Found soft-deleted files blocking path, permanently deleting them', { 
        filePath, 
        count: deletedFiles.length,
        fileIds: deletedFiles.map(f => f.id)
      })
      
      for (const deletedFile of deletedFiles) {
        // Delete file versions first
        await client.from('file_versions').delete().eq('file_id', deletedFile.id)
        // Delete file references
        await client.from('file_references').delete().or(`parent_file_id.eq.${deletedFile.id},child_file_id.eq.${deletedFile.id}`)
        // Delete the file record
        const { error: hardDeleteError } = await client.from('files').delete().eq('id', deletedFile.id)
        
        if (hardDeleteError) {
          logFn('error', '[syncFile] Failed to hard-delete blocking file', { 
            filePath, 
            fileId: deletedFile.id, 
            error: hardDeleteError.message 
          })
          // Continue anyway - the insert might work if this was the only blocker
        } else {
          logFn('info', '[syncFile] Hard-deleted blocking file', { filePath, fileId: deletedFile.id })
        }
      }
    }
    
    // No active file exists - check if there's any other file (shouldn't be after cleanup above)
    const { data: existingDbFile, error: checkError } = await client
      .from('files')
      .select('id, version, deleted_at, org_id')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .single()
    
    if (checkError && checkError.code !== 'PGRST116') {
      logFn('error', '[syncFile] DB check error', { filePath, error: checkError.message, code: checkError.code })
    }
    
    if (existingDbFile) {
      // This shouldn't happen after the cleanup above, but handle it just in case
      logFn('warn', '[syncFile] File still exists after cleanup, updating it', { 
        filePath, 
        existingId: existingDbFile.id,
        existingOrgId: existingDbFile.org_id,
        expectedOrgId: orgId,
        wasDeleted: !!existingDbFile.deleted_at
      })
      
      // Update the existing file with ALL relevant fields (including org_id to fix any mismatch)
      const { data, error } = await client
        .from('files')
        .update({
          org_id: orgId,  // Fix org_id in case of mismatch
          content_hash: contentHash,
          file_size: fileSize,
          file_name: fileName,
          extension: extension,
          file_type: fileType,
          version: 1,  // Reset version since this is essentially a new file
          revision: 'A',  // Reset revision
          state: 'not_tracked',  // Reset state
          updated_at: new Date().toISOString(),
          updated_by: userId,
          created_by: userId,  // Update creator since this is a new upload
          created_at: new Date().toISOString(),  // Reset creation time
          deleted_at: null,  // Clear soft-delete flag
          deleted_by: null,
          checked_out_by: null,  // Clear any checkout
          checked_out_at: null,
          lock_message: null
        })
        .eq('id', existingDbFile.id)
        .select()
        .single()
      
      if (error) {
        logFn('error', '[syncFile] Update failed', { filePath, error: error.message })
        throw error
      }
      
      // Delete old versions and create fresh version record
      await client.from('file_versions').delete().eq('file_id', existingDbFile.id)
      await client.from('file_versions').insert({
        file_id: existingDbFile.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'not_tracked',
        created_by: userId
      })
      
      logFn('info', '[syncFile] Reset and update SUCCESS', { filePath, fileId: existingDbFile.id })
      return { file: data, error: null, isNew: false }
    } else {
      // Create new file record
      logFn('debug', '[syncFile] Inserting new file', { filePath, vaultId, orgId, metadata })
      const { data, error } = await client
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
          revision: metadata?.revision || 'A',
          version: 1,
          part_number: metadata?.partNumber || null,
          description: metadata?.description || null,
          custom_properties: metadata?.customProperties || {},
          created_by: userId,
          updated_by: userId
        })
        .select()
        .single()
      
      if (error) {
        logFn('error', '[syncFile] Insert failed', { filePath, error: error.message, code: (error as any).code })
        throw error
      }
      
      // Debug: Log successful insert
      logFn('info', '[syncFile] Insert SUCCESS', { filePath, fileId: data.id, vaultId })
      
      // Create initial version record
      await client.from('file_versions').insert({
        file_id: data.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'not_tracked',
        created_by: userId
      })
      
      return { file: data, error: null, isNew: true }
    }
  } catch (error) {
    logFn('error', '[syncFile] Exception', { filePath, error: String(error) })
    console.error('Error syncing file:', error)
    return { file: null, error, isNew: false }
  }
}

// ============================================
// Check Out / Check In Operations
// ============================================

export async function checkoutFile(
  fileId: string, 
  userId: string, 
  userEmail: string,
  options?: {
    message?: string
    // Pre-computed values to avoid redundant IPC calls in batch operations
    machineId?: string
    machineName?: string
  }
) {
  const client = getSupabaseClient()
  
  // Use pre-computed values if provided, otherwise fetch (for single-file calls)
  let machineId = options?.machineId
  let machineName = options?.machineName
  if (!machineId || !machineName) {
    const { getMachineId, getMachineName } = await import('../backup')
    machineId = machineId || await getMachineId()
    machineName = machineName || await getMachineName()
  }
  
  // First check if file is already checked out (simple query without join)
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, file_name, checked_out_by, checked_out_by_machine_id')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by && file.checked_out_by !== userId) {
    // File is checked out by someone else - fetch their info separately
    const { data: checkedOutUser } = await client
      .from('users')
      .select('email, full_name')
      .eq('id', file.checked_out_by)
      .single()
    
    return { 
      success: false, 
      error: `File is already checked out by ${checkedOutUser?.full_name || checkedOutUser?.email || 'another user'}` 
    }
  }
  
  // Check out the file
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: userId,
      checked_out_at: new Date().toISOString(),
      lock_message: options?.message || null,
      checked_out_by_machine_id: machineId,
      checked_out_by_machine_name: machineName,
      updated_by: userId,
      updated_at: new Date().toISOString()
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity (fire-and-forget to avoid blocking checkout)
  client.from('activity').insert({
    org_id: data.org_id,
    file_id: fileId,
    user_id: userId,
    user_email: userEmail,
    action: 'checkout',
    details: options?.message ? { message: options.message } : {}
  }).then(({ error: activityError }) => {
    if (activityError) {
      console.warn('[Checkout] Failed to log activity:', activityError.message)
    }
  })
  
  return { success: true, file: data, error: null }
}

export async function checkinFile(
  fileId: string, 
  userId: string, 
  options?: {
    newContentHash?: string
    newFileSize?: number
    comment?: string
    newFilePath?: string  // For moved files - update the server path
    newFileName?: string  // For renamed files - update the server name
    localActiveVersion?: number  // If user rolled to a different version locally, track it to force version increment
    pendingMetadata?: {
      part_number?: string | null
      description?: string | null
      revision?: string
      config_tabs?: Record<string, string>  // Per-configuration tab numbers
      config_descriptions?: Record<string, string>  // Per-configuration descriptions
    }
  }
): Promise<{ success: boolean; file?: any; error?: string | null; contentChanged?: boolean; metadataChanged?: boolean; machineMismatchWarning?: string | null }> {
  const client = getSupabaseClient()
  
  // First verify the user has the file checked out
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by !== userId) {
    return { success: false, error: 'You do not have this file checked out' }
  }
  
  // Check if checking in from a different machine
  const { getMachineId } = await import('../backup')
  const currentMachineId = await getMachineId()
  const checkoutMachineId = file.checked_out_by_machine_id
  
  // Warn if checking in from a different machine (but allow it)
  let machineMismatchWarning: string | null = null
  if (checkoutMachineId && checkoutMachineId !== currentMachineId) {
    const checkoutMachineName = file.checked_out_by_machine_name || 'another computer'
    machineMismatchWarning = `Warning: This file was checked out on ${checkoutMachineName}. You are checking it in from a different computer.`
  }
  
  // Prepare update data
  const updateData: Record<string, any> = {
    checked_out_by: null,
    checked_out_at: null,
    lock_message: null,
    checked_out_by_machine_id: null,
    checked_out_by_machine_name: null,
    updated_at: new Date().toISOString(),
    updated_by: userId
  }
  
  // Handle file path/name changes (for moved/renamed files)
  if (options?.newFilePath && options.newFilePath !== file.file_path) {
    updateData.file_path = options.newFilePath
  }
  if (options?.newFileName && options.newFileName !== file.file_name) {
    updateData.file_name = options.newFileName
  }
  
  // Apply pending metadata changes if any
  const hasPendingMetadata = options?.pendingMetadata && (
    options.pendingMetadata.part_number !== undefined ||
    options.pendingMetadata.description !== undefined ||
    options.pendingMetadata.revision !== undefined ||
    options.pendingMetadata.config_tabs !== undefined ||
    options.pendingMetadata.config_descriptions !== undefined
  )
  
  if (hasPendingMetadata && options?.pendingMetadata) {
    if (options.pendingMetadata.part_number !== undefined) {
      updateData.part_number = options.pendingMetadata.part_number
    }
    if (options.pendingMetadata.description !== undefined) {
      updateData.description = options.pendingMetadata.description
    }
    if (options.pendingMetadata.revision !== undefined) {
      updateData.revision = options.pendingMetadata.revision
    }
    // Save per-configuration data to custom_properties
    if (options.pendingMetadata.config_tabs !== undefined || options.pendingMetadata.config_descriptions !== undefined) {
      const existingCustomProps = (file.custom_properties || {}) as Record<string, unknown>
      updateData.custom_properties = {
        ...existingCustomProps,
        ...(options.pendingMetadata.config_tabs !== undefined && { _config_tabs: options.pendingMetadata.config_tabs }),
        ...(options.pendingMetadata.config_descriptions !== undefined && { _config_descriptions: options.pendingMetadata.config_descriptions })
      }
    }
  }
  
  // Check if content changed OR metadata changed OR user switched versions locally
  const contentChanged = options?.newContentHash && options.newContentHash !== file.content_hash
  const metadataChanged = hasPendingMetadata
  // If user rolled to a different version locally (localActiveVersion set and differs from server), we need to increment
  // This handles cases where version 7 has same hash as version 6 but user intentionally switched versions
  const versionSwitched = options?.localActiveVersion !== undefined && options.localActiveVersion !== file.version
  const shouldIncrementVersion = contentChanged || metadataChanged || versionSwitched
  
  console.debug('[Checkin] Version decision:', {
    fileId,
    serverVersion: file.version,
    localActiveVersion: options?.localActiveVersion,
    contentChanged,
    metadataChanged,
    versionSwitched,
    shouldIncrementVersion
  })
  
  if (shouldIncrementVersion) {
    // Get max version from history - new version should be max + 1
    // This handles the case where you rollback from v5 to v3, then check in -> should be v6
    // Use maybeSingle() since file might not have version history yet (first version)
    const { data: maxVersionData, error: maxVersionError } = await client
      .from('file_versions')
      .select('version')
      .eq('file_id', fileId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    if (maxVersionError) {
      console.warn('[Checkin] Failed to get max version from history:', maxVersionError.message)
    }
    
    const maxVersionInHistory = maxVersionData?.version || file.version
    const newVersion = maxVersionInHistory + 1
    updateData.version = newVersion
    
    console.debug('[Checkin] Incrementing version:', {
      fileId,
      currentVersion: file.version,
      maxVersionInHistory,
      newVersion,
      reason: versionSwitched ? 'version_switched' : contentChanged ? 'content_changed' : 'metadata_changed'
    })
    
    if (contentChanged) {
      updateData.content_hash = options!.newContentHash
      if (options!.newFileSize !== undefined) {
        updateData.file_size = options!.newFileSize
      }
    }
    
    // Create version record for changes
    const { error: versionInsertError } = await client.from('file_versions').insert({
      file_id: fileId,
      version: newVersion,
      revision: updateData.revision || file.revision,
      content_hash: updateData.content_hash || file.content_hash,
      file_size: updateData.file_size || file.file_size,
      workflow_state_id: file.workflow_state_id,
      state: file.state || 'not_tracked',
      created_by: userId,
      comment: options?.comment || null
    })
    
    if (versionInsertError) {
      console.error('[Checkin] Failed to insert version record:', versionInsertError.message)
      // If version insert fails, don't update the file to the new version
      // This prevents version mismatch between files and file_versions tables
      return { success: false, error: `Failed to create version record: ${versionInsertError.message}` }
    }
    
    // Log revision change activity if revision changed (fire-and-forget)
    if (options?.pendingMetadata?.revision && options.pendingMetadata.revision !== file.revision) {
      getCurrentUserEmail().then(userEmail => {
        client.from('activity').insert({
          org_id: file.org_id,
          file_id: fileId,
          user_id: userId,
          user_email: userEmail,
          action: 'revision_change',
          details: { from: file.revision, to: options.pendingMetadata!.revision }
        }).then(({ error: activityError }) => {
          if (activityError) {
            console.warn('[Checkin] Failed to log revision change activity:', activityError.message)
          }
        })
      })
    }
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
  
  // Log activity (fire-and-forget to avoid blocking checkin)
  getCurrentUserEmail().then(userEmail => {
    client.from('activity').insert({
      org_id: data.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: userEmail,
      action: 'checkin',
      details: { 
        ...(options?.comment ? { comment: options.comment } : {}),
        contentChanged,
        metadataChanged
      }
    }).then(({ error: activityError }) => {
      if (activityError) {
        console.warn('[Checkin] Failed to log activity:', activityError.message)
      }
    })
  })
  
  return { success: true, file: data, error: null, contentChanged, metadataChanged, machineMismatchWarning }
}

/**
 * Sync SolidWorks file metadata and create a new version
 * This can be called without having the file checked out (for metadata-only updates from SW properties)
 */
export async function syncSolidWorksFileMetadata(
  fileId: string,
  userId: string,
  metadata: {
    part_number?: string | null
    description?: string | null
    revision?: string | null
    custom_properties?: Record<string, string | number | null>
  }
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
  const partNumberChanged = metadata.part_number !== undefined && 
    (metadata.part_number || null) !== (file.part_number || null)
  const descriptionChanged = metadata.description !== undefined && 
    (metadata.description || null) !== (file.description || null)
  const revisionChanged = metadata.revision !== undefined && 
    (metadata.revision || null) !== (file.revision || null)
  const customPropsChanged = metadata.custom_properties !== undefined
  
  if (!partNumberChanged && !descriptionChanged && !revisionChanged && !customPropsChanged) {
    // No changes - return current file
    return { success: true, file, error: null }
  }
  
  // Build update data
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId
  }
  
  if (metadata.part_number !== undefined) {
    updateData.part_number = metadata.part_number
  }
  if (metadata.description !== undefined) {
    updateData.description = metadata.description
  }
  if (metadata.revision !== undefined) {
    updateData.revision = metadata.revision
  }
  if (metadata.custom_properties !== undefined) {
    updateData.custom_properties = metadata.custom_properties
  }
  
  // Create a new version for metadata changes
  const { data: maxVersionData } = await client
    .from('file_versions')
    .select('version')
    .eq('file_id', fileId)
    .order('version', { ascending: false })
    .limit(1)
    .single()
  
  const maxVersionInHistory = maxVersionData?.version || file.version
  const newVersion = maxVersionInHistory + 1
  updateData.version = newVersion
  
  // Create version record
  await client.from('file_versions').insert({
    file_id: fileId,
    version: newVersion,
    revision: updateData.revision || file.revision,
    content_hash: file.content_hash,
    file_size: file.file_size,
    workflow_state_id: file.workflow_state_id,
    state: file.state || 'not_tracked',
    created_by: userId,
    comment: 'Metadata updated from SolidWorks file properties'
  })
  
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
  
  // Log activity (fire-and-forget)
  getCurrentUserEmail().then(userEmail => {
    client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: userEmail,
      action: 'checkin',
      details: { 
        metadataSync: true,
        changedFields,
        source: 'solidworks'
      }
    }).then(({ error: activityError }) => {
      if (activityError) {
        console.warn('[SyncMetadata] Failed to log activity:', activityError.message)
      }
    })
  })
  
  return { success: true, file: data, error: null }
}

export async function undoCheckout(fileId: string, userId: string) {
  const client = getSupabaseClient()
  
  // Verify the user has the file checked out (or is admin)
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*, org_id')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by !== userId) {
    // TODO: Allow admins to undo anyone's checkout
    return { success: false, error: 'You do not have this file checked out' }
  }
  
  // Release the checkout without saving changes
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      checked_out_by_machine_id: null,
      checked_out_by_machine_name: null
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
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
  adminUserId: string
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
  let checkedOutUser: { id: string; email: string; full_name: string } | null = null
  const { data: userData } = await client
    .from('users')
    .select('id, email, full_name')
    .eq('id', file.checked_out_by)
    .single()
  
  if (userData) {
    checkedOutUser = userData
  }
  
  // Release the checkout without saving changes
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      checked_out_by_machine_id: null,
      checked_out_by_machine_name: null
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  getCurrentUserEmail().then(adminEmail => {
    client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: adminUserId,
      user_email: adminEmail,
      action: 'admin_force_discard',
      details: { 
        previousCheckoutUser: checkedOutUser?.email || checkedOutUser?.id,
        previousCheckoutUserName: checkedOutUser?.full_name
      }
    })
  })
  
  return { success: true, file: data }
}

// ============================================
// File Metadata Updates
// ============================================

export async function updateFileMetadata(
  fileId: string,
  userId: string,
  updates: {
    state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
    workflow_state_id?: string
  }
): Promise<{ success: boolean; file?: any; error?: string | null }> {
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
    state_changed_by: userId
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
  getCurrentUserEmail().then(userEmail => {
    client.from('activity').insert({
      org_id: file.org_id,
      file_id: fileId,
      user_id: userId,
      user_email: userEmail,
      action: 'state_change',
      details: { 
        from_state_id: file.workflow_state_id,
        to_state_id: updates.workflow_state_id
      }
    })
  })
  
  return { success: true, file: data, error: null }
}

export async function updateFilePath(
  fileId: string,
  newPath: string
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()
  
  // Extract filename from path
  const newFileName = newPath.split('/').pop() || newPath.split('\\').pop() || newPath
  
  const { data, error } = await client
    .from('files')
    .update({
      file_path: newPath,
      file_name: newFileName,
      updated_at: new Date().toISOString()
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true, file: data }
}

export async function updateFolderPath(
  oldFolderPath: string,
  newFolderPath: string
): Promise<{ success: boolean; updated: number; error?: string }> {
  const client = getSupabaseClient()
  
  // Get all files in the folder (uses RLS to filter by user's org/vault)
  const { data: files, error: fetchError } = await client
    .from('files')
    .select('id, file_path, file_name')
    .ilike('file_path', `${oldFolderPath}%`)
  
  if (fetchError) {
    return { success: false, updated: 0, error: fetchError.message }
  }
  
  if (!files || files.length === 0) {
    return { success: true, updated: 0 }
  }
  
  // Update each file's path
  let updated = 0
  for (const file of files) {
    const newFilePath = file.file_path.replace(oldFolderPath, newFolderPath)
    
    const { error } = await client
      .from('files')
      .update({
        file_path: newFilePath,
        updated_at: new Date().toISOString()
      })
      .eq('id', file.id)
    
    if (!error) {
      updated++
    }
  }
  
  return { success: true, updated }
}

// ============================================
// Soft Delete / Restore Operations
// ============================================

/**
 * Soft delete a file (move to trash)
 */
export async function softDeleteFile(
  fileId: string,
  userId: string
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
  
  // Don't allow deleting checked-out files
  if (file.checked_out_by) {
    return { success: false, error: 'Cannot delete a checked-out file. Please check it in first.' }
  }
  
  // Soft delete - set deleted_at and deleted_by
  const { data: deletedFile, error } = await client
    .from('files')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: userId,
    user_email: '',
    action: 'delete',
    details: {
      file_name: file.file_name,
      file_path: file.file_path,
      soft_delete: true
    }
  })
  
  return { success: true, file: deletedFile }
}

/**
 * Soft delete multiple files at once
 */
export async function softDeleteFiles(
  fileIds: string[],
  userId: string
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
  userId: string
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
  
  // Check if a file with the same path already exists (not deleted)
  const { data: existingFile } = await client
    .from('files')
    .select('id')
    .eq('vault_id', file.vault_id)
    .eq('file_path', file.file_path)
    .is('deleted_at', null)
    .single()
  
  if (existingFile) {
    return { 
      success: false, 
      error: 'A file with the same path already exists. Rename or delete the existing file first.' 
    }
  }
  
  // Restore - clear deleted_at and deleted_by
  const { data: restoredFile, error } = await client
    .from('files')
    .update({
      deleted_at: null,
      deleted_by: null
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: userId,
    user_email: '',
    action: 'restore',
    details: {
      file_name: file.file_name,
      file_path: file.file_path
    }
  })
  
  return { success: true, file: restoredFile }
}

/**
 * Restore multiple files from trash
 */
export async function restoreFiles(
  fileIds: string[],
  userId: string
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
  userId: string
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
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: null, // Set to null since file will be deleted
    user_id: userId,
    user_email: '',
    action: 'delete',
    details: {
      file_name: file.file_name,
      file_path: file.file_path,
      permanent: true
    }
  })
  
  // Delete file versions
  await client
    .from('file_versions')
    .delete()
    .eq('file_id', fileId)
  
  // Delete file references
  await client
    .from('file_references')
    .delete()
    .or(`parent_file_id.eq.${fileId},child_file_id.eq.${fileId}`)
  
  // Permanently delete the file
  const { error } = await client
    .from('files')
    .delete()
    .eq('id', fileId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get deleted files (trash) for an organization
 * Optionally filter by vault or folder path
 * Returns empty array if deleted_at column doesn't exist (migration not run)
 */
export async function getDeletedFiles(
  orgId: string,
  options?: {
    vaultId?: string
    folderPath?: string  // Get deleted files that were in this folder
  }
): Promise<{ files: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  try {
    let query = client
      .from('files')
      .select(`
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
      `)
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    
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
        console.warn('Trash feature not available - run migration to enable')
        return { files: [] }
      }
      return { files: [], error: error.message }
    }
    
    return { files: data || [] }
  } catch (err) {
    console.error('Error fetching deleted files:', err)
    return { files: [] }
  }
}

/**
 * Get count of deleted files (for badge display)
 * Returns 0 if deleted_at column doesn't exist (migration not run)
 */
export async function getDeletedFilesCount(
  orgId: string,
  vaultId?: string
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
  } catch (err) {
    return { count: 0 }
  }
}

/**
 * Empty the trash - permanently delete all trashed files
 * Admin only operation
 */
export async function emptyTrash(
  orgId: string,
  userId: string,
  vaultId?: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const client = getSupabaseClient()
  
  // First get all trashed files
  let query = client
    .from('files')
    .select('id')
    .eq('org_id', orgId)
    .not('deleted_at', 'is', null)
  
  if (vaultId) {
    query = query.eq('vault_id', vaultId)
  }
  
  const { data: trashedFiles, error: fetchError } = await query
  
  if (fetchError) {
    return { success: false, deleted: 0, error: fetchError.message }
  }
  
  if (!trashedFiles || trashedFiles.length === 0) {
    return { success: true, deleted: 0 }
  }
  
  // Delete each file permanently
  let deleted = 0
  for (const file of trashedFiles) {
    const result = await permanentlyDeleteFile(file.id, userId)
    if (result.success) {
      deleted++
    }
  }
  
  return { success: true, deleted }
}
