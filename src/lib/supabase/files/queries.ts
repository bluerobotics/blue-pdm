import { getSupabaseClient } from '../client'
import { log } from '@/lib/logger'
import { hashCheckoutIdentifier, type CheckoutUserProfile } from '@/types/pdm'

// ============================================
// Files - Read Operations
// ============================================

export interface CheckoutProfileScope {
  orgId: string
  vaultId: string | null
  fileId?: string
}

export interface CheckedOutUsersResult {
  users: Record<string, CheckoutUserProfile>
  error: unknown
}

const checkedOutUsersInFlight = new Map<string, Promise<CheckedOutUsersResult>>()

/**
 * Get files with full metadata including user info (slower, use for single file or small sets)
 */
export async function getFiles(
  orgId: string,
  options?: {
    vaultId?: string
    folder?: string
    state?: string[]
    search?: string
    checkedOutByMe?: string // user ID
    includeDeleted?: boolean // Include soft-deleted files (default: false)
    workflow_state_ids?: string[]
  },
) {
  const client = getSupabaseClient()
  let query = client
    .from('files')
    .select(
      `
      *,
      checked_out_user:users!checked_out_by(id, email, full_name, avatar_url),
      created_by_user:users!created_by(email, full_name)
    `,
    )
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
        `description.ilike.%${options.search}%`,
    )
  }

  if (options?.checkedOutByMe) {
    query = query.eq('checked_out_by', options.checkedOutByMe)
  }

  const { data, error } = await query
  return { files: data, error }
}

// Type for lightweight file data
export interface LightweightFile {
  id: string
  file_path: string
  file_name: string
  extension: string | null
  file_type: string | null
  part_number: string | null
  description: string | null
  revision: string | null
  version: number
  content_hash: string | null
  file_size: number | null
  state: string | null
  checked_out_by: string | null
  checked_out_at: string | null
  updated_at: string
  // Carries the reserved _config_tabs / _config_descriptions keys the explorer needs to
  // recognise per-configuration metadata that is already committed.
  custom_properties: Record<string, unknown> | null
}

// Delta file includes deletion info
export interface DeltaFile extends LightweightFile {
  deleted_at: string | null
  is_deleted: boolean
}

/**
 * Lightweight file fetch for initial vault sync - only essential columns, no joins
 * Much faster than getFiles() for large vaults
 * Uses RPC function to fetch ALL files in a single query (no pagination overhead)
 *
 * IMPORTANT: Requires Supabase project max_rows to be set high enough (e.g. 1M)
 * in Dashboard > Settings > API > Max Rows
 *
 * Performance: For 25,000 files, reduces from 25 round trips to 1 (~6s -> ~1s)
 */
export async function getFilesLightweight(
  orgId: string,
  vaultId?: string,
): Promise<{ files: LightweightFile[] | null; error: any }> {
  const logFn =
    typeof window !== 'undefined' && (window as any).electronAPI?.log // TODO: type this
      ? (level: string, msg: string, data?: any) =>
          (window as any).electronAPI.log(level, msg, data) // TODO: type this
      : () => {}

  logFn('debug', '[getFilesLightweight] Querying via RPC', { orgId, vaultId })

  const client = getSupabaseClient()

  // Use RPC function for single-query fetch (no pagination overhead)
  // Type assertion needed because RPC function types are generated from DB schema
  const { data, error } = await (client.rpc as any)('get_vault_files_fast', { // TODO: type this
    p_org_id: orgId,
    p_vault_id: vaultId || null,
  })

  if (error) {
    logFn('error', '[getFilesLightweight] RPC error', { error: error.message })
    return { files: null, error }
  }

  const files = data as LightweightFile[] | null

  logFn('debug', '[getFilesLightweight] Result', {
    fileCount: files?.length || 0,
    hasError: false,
  })

  return { files, error: null }
}

/**
 * Fetch only files changed since a specific timestamp (for delta sync)
 * Used after loading from cache to get only new/modified/deleted files
 *
 * IMPORTANT: Requires Supabase project max_rows to be set high enough
 *
 * @param orgId Organization ID
 * @param vaultId Vault ID
 * @param since ISO timestamp - fetch files modified after this time
 * @returns Changed files with is_deleted flag for deletions
 */
export async function getFilesDelta(
  orgId: string,
  vaultId: string,
  since: string,
): Promise<{ files: DeltaFile[] | null; error: any }> {
  const logFn =
    typeof window !== 'undefined' && (window as any).electronAPI?.log // TODO: type this
      ? (level: string, msg: string, data?: any) =>
          (window as any).electronAPI.log(level, msg, data) // TODO: type this
      : () => {}

  logFn('debug', '[getFilesDelta] Querying changes since', { orgId, vaultId, since })

  const client = getSupabaseClient()

  // Use RPC function for delta queries
  const { data, error } = await (client.rpc as any)('get_vault_files_delta', { // TODO: type this
    p_org_id: orgId,
    p_vault_id: vaultId,
    p_since: since,
  })

  if (error) {
    logFn('error', '[getFilesDelta] RPC error', { error: error.message })
    return { files: null, error }
  }

  const files = data as DeltaFile[] | null

  logFn('debug', '[getFilesDelta] Result', {
    changedCount: files?.length || 0,
  })

  return { files, error: null }
}

/**
 * Get checked out user info for a batch of file IDs
 * Used to lazily load user info after initial sync
 */
async function fetchCheckedOutUsers(
  fileIds: string[],
  scope?: CheckoutProfileScope,
): Promise<CheckedOutUsersResult> {
  if (fileIds.length === 0) return { users: {}, error: null }

  const client = getSupabaseClient()

  // First get files with their checked_out_by user IDs
  let filesQuery = client
    .from('files')
    .select('id, checked_out_by, org_id, vault_id')
    .in('id', fileIds)
    .not('checked_out_by', 'is', null)

  if (scope) {
    filesQuery = filesQuery.eq('org_id', scope.orgId)
    if (scope.vaultId) {
      filesQuery = filesQuery.eq('vault_id', scope.vaultId)
    }
  }

  const { data: files, error: filesError } = await filesQuery
  if (filesError) return { users: {}, error: filesError }
  if (!files || files.length === 0) return { users: {}, error: null }

  // Get unique user IDs - filter out nulls with proper type narrowing
  const userIds = [
    ...new Set(files.map((f) => f.checked_out_by).filter((id): id is string => id !== null)),
  ]

  if (userIds.length === 0) return { users: {}, error: null }

  // Fetch user info separately
  const { data: usersData, error: usersError } = await client
    .from('users')
    .select('id, email, full_name, avatar_url')
    .in('id', userIds)
    .eq('org_id', scope?.orgId ?? files[0].org_id)

  if (usersError) return { users: {}, error: usersError }

  // Create a user lookup map
  const userLookup = new Map(usersData?.map((u) => [u.id, u]) || [])

  // Convert to a map for easy lookup by file ID
  const users: Record<string, CheckoutUserProfile> = {}
  for (const file of files) {
    if (!file.checked_out_by) continue
    const user = userLookup.get(file.checked_out_by)
    if (user) {
      users[file.id] = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      }
    }
  }

  return { users, error: null }
}

export function getCheckedOutUsers(
  fileIds: string[],
  scope?: CheckoutProfileScope,
): Promise<CheckedOutUsersResult> {
  const normalizedFileIds = [...new Set(fileIds)].sort()
  const scopeKey = scope ? `${scope.orgId}:${scope.vaultId ?? ''}:${scope.fileId ?? ''}` : ''
  const key = `${scopeKey}:${normalizedFileIds.join(',')}`
  const existing = checkedOutUsersInFlight.get(key)
  if (existing) return existing

  const request = fetchCheckedOutUsers(normalizedFileIds, scope).finally(() => {
    if (checkedOutUsersInFlight.get(key) === request) {
      checkedOutUsersInFlight.delete(key)
    }
  })
  checkedOutUsersInFlight.set(key, request)
  return request
}

/**
 * Get basic user info by ID (for checkout display)
 * Used when realtime updates come in and we need to show who checked out a file
 */
export async function getUserBasicInfo(
  userId: string,
  scope?: CheckoutProfileScope,
): Promise<{
  user: CheckoutUserProfile | null
  error?: string
}> {
  const client = getSupabaseClient()

  if (scope?.fileId) {
    let fileQuery = client
      .from('files')
      .select('checked_out_by')
      .eq('id', scope.fileId)
      .eq('org_id', scope.orgId)
    if (scope.vaultId) {
      fileQuery = fileQuery.eq('vault_id', scope.vaultId)
    }
    const { data: file, error: fileError } = await fileQuery.maybeSingle()

    if (fileError) {
      log.warn('[Files]', 'Failed to validate checkout owner scope', {
        error: fileError.message,
        fileId: hashCheckoutIdentifier(scope.fileId),
      })
      return { user: null, error: fileError.message }
    }

    if (file?.checked_out_by !== userId) {
      return { user: null }
    }
  }

  let userQuery = client.from('users').select('id, email, full_name, avatar_url').eq('id', userId)
  if (scope) {
    userQuery = userQuery.eq('org_id', scope.orgId)
  }

  const { data, error } = await userQuery.single()

  if (error) {
    log.error('[Files]', 'Failed to fetch user', { error: error.message })
    return { user: null, error: error.message }
  }

  return {
    user: data
      ? {
          id: data.id,
          email: data.email,
          full_name: data.full_name,
          avatar_url: data.avatar_url,
        }
      : null,
  }
}

export async function getFile(fileId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select(
      `
      *,
      checked_out_user:users!checked_out_by(id, email, full_name, avatar_url),
      created_by_user:users!created_by(email, full_name),
      updated_by_user:users!updated_by(email, full_name)
    `,
    )
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
    .select(
      `
      *,
      created_by_user:users!created_by(email, full_name)
    `,
    )
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
    .select(
      `
      *,
      parent:files!parent_file_id(
        id, file_name, file_path, part_number, revision, state
      )
    `,
    )
    .eq('child_file_id', fileId)

  return { references: data, error }
}

export async function getContains(fileId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('file_references')
    .select(
      `
      *,
      child:files!child_file_id(
        id, file_name, file_path, part_number, revision, state, description
      )
    `,
    )
    .eq('parent_file_id', fileId)

  return { references: data, error }
}

/**
 * BOM item for configuration-specific display
 */
export interface ConfigBomItem {
  id: string
  child_file_id: string
  file_name: string
  file_path: string
  file_type: 'part' | 'assembly' | 'drawing' | 'other'
  part_number: string | null
  description: string | null
  revision: string | null
  state: string | null
  quantity: number
  configuration: string | null
  in_database: boolean
}

/**
 * Get BOM components for a specific assembly configuration.
 * Returns only the components that are included in the specified configuration.
 *
 * @param fileId - Assembly file ID
 * @param configName - Configuration name to filter by (null for all configs)
 * @returns Array of BOM items for the configuration
 */
export async function getContainsByConfiguration(
  fileId: string,
  configName: string | null,
): Promise<{ items: ConfigBomItem[] | null; error: any }> {
  const client = getSupabaseClient()

  let query = client
    .from('file_references')
    .select(
      `
      id,
      child_file_id,
      quantity,
      configuration,
      reference_type,
      child:files!child_file_id(
        id, file_name, file_path, file_type, part_number, revision, state, description
      )
    `,
    )
    .eq('parent_file_id', fileId)
    .eq('reference_type', 'component')

  // Filter by configuration if specified
  if (configName !== null) {
    query = query.eq('configuration', configName)
  }

  const { data, error } = await query.order('child(file_name)', { ascending: true })

  if (error) {
    return { items: null, error }
  }

  // Transform to ConfigBomItem format
  const items: ConfigBomItem[] = (data || []).map((ref) => {
    const child = ref.child as {
      id: string
      file_name: string
      file_path: string
      file_type: string | null
      part_number: string | null
      revision: string | null
      state: string | null
      description: string | null
    } | null

    // Determine file type from extension if not set
    let fileType: ConfigBomItem['file_type'] = 'other'
    if (child?.file_name) {
      const ext = child.file_name.toLowerCase().split('.').pop()
      if (ext === 'sldprt') fileType = 'part'
      else if (ext === 'sldasm') fileType = 'assembly'
      else if (ext === 'slddrw') fileType = 'drawing'
    }

    return {
      id: ref.id,
      child_file_id: ref.child_file_id,
      file_name: child?.file_name || 'Unknown',
      file_path: child?.file_path || '',
      file_type: fileType,
      part_number: child?.part_number || null,
      description: child?.description || null,
      revision: child?.revision || null,
      state: child?.state || null,
      quantity: ref.quantity ?? 1,
      configuration: ref.configuration,
      in_database: !!child?.id,
    }
  })

  return { items, error: null }
}

/**
 * Drawing reference item for drawing-related expand/collapse dropdowns.
 * Represents a drawing file that references a given part/assembly configuration.
 */
export interface DrawingRefItem {
  id: string
  file_id: string
  file_name: string
  file_path: string
  file_type: 'part' | 'assembly' | 'drawing' | 'other'
  part_number: string | null
  description: string | null
  revision: string | null
  state: string | null
  configuration: string | null
  configurationConfirmed?: boolean
  in_database: boolean
}

/**
 * Get drawings (.slddrw) that reference a specific file, optionally filtered by configuration.
 *
 * This queries `file_references` where `child_file_id = fileId` and the parent file
 * is a drawing (.slddrw). This is the inverse of `getContainsByConfiguration` — instead
 * of finding what an assembly contains, it finds which drawings reference a given
 * part or assembly.
 *
 * @param fileId - The file ID of the part/assembly to find referencing drawings for
 * @param configName - Configuration name to filter by, or null for all configurations
 * @returns Array of DrawingRefItem objects representing the referencing drawings
 */
export async function getDrawingsForFileConfig(
  fileId: string,
  configName: string | null,
): Promise<{ items: DrawingRefItem[]; error: string | null }> {
  const client = getSupabaseClient()

  const query = client
    .from('file_references')
    .select(
      `
      id,
      parent_file_id,
      configuration,
      parent:files!parent_file_id(
        id, file_name, file_path, file_type, part_number, revision, state, description
      )
    `,
    )
    .eq('child_file_id', fileId)

  const { data, error } = await query.order('parent(file_name)', { ascending: true })

  if (error) {
    log.error('[Files]', 'Failed to fetch drawings for file config', {
      error: error.message,
      fileId,
      configName,
    })
    return { items: [], error: error.message }
  }

  // Transform to DrawingRefItem format, filtering to only drawing parents
  const items: DrawingRefItem[] = []

  for (const ref of data || []) {
    const parent = ref.parent as {
      id: string
      file_name: string
      file_path: string
      file_type: string | null
      part_number: string | null
      revision: string | null
      state: string | null
      description: string | null
    } | null

    // Only include drawing files (.slddrw)
    if (!parent?.file_name?.toLowerCase().endsWith('.slddrw')) {
      continue
    }

    if (configName !== null && ref.configuration !== configName) {
      continue
    }

    items.push({
      id: ref.id,
      file_id: parent.id,
      file_name: parent.file_name,
      file_path: parent.file_path,
      file_type: 'drawing',
      part_number: parent.part_number,
      description: parent.description,
      revision: parent.revision,
      state: parent.state,
      configuration: ref.configuration,
      in_database: true,
    })
  }

  return { items, error: null }
}

/**
 * Get all child references for a drawing file, with configuration info.
 * Used to enrich DrawingRefRow data with which configurations of each
 * referenced part/assembly the drawing uses.
 *
 * Returns a map of child file_path -> array of configuration names.
 */
export async function getReferencesForDrawing(
  drawingFileId: string,
): Promise<{ configsByPath: Map<string, string[]>; error: string | null }> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('file_references')
    .select(
      `
      configuration,
      child:files!child_file_id(
        file_path
      )
    `,
    )
    .eq('parent_file_id', drawingFileId)

  if (error) {
    log.error('[Files]', 'Failed to fetch references for drawing', {
      error: error.message,
      drawingFileId,
    })
    return { configsByPath: new Map(), error: error.message }
  }

  // Group configurations by child file path
  const configsByPath = new Map<string, string[]>()

  for (const ref of data || []) {
    const child = ref.child as { file_path: string } | null
    if (!child?.file_path || !ref.configuration) continue

    const existing = configsByPath.get(child.file_path) || []
    if (!existing.includes(ref.configuration)) {
      existing.push(ref.configuration)
    }
    configsByPath.set(child.file_path, existing)
  }

  return { configsByPath, error: null }
}

// ============================================
// Recursive BOM Tree Types and Functions
// ============================================

/**
 * A node in the recursive BOM tree structure
 */
export interface BomTreeNode {
  id: string
  parent_file_id: string
  child_file_id: string
  quantity: number
  configuration: string | null
  reference_type: string
  child: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    revision: string | null
    state: string | null
    description: string | null
    extension?: string
  } | null
  children: BomTreeNode[] // Nested children for sub-assemblies
  depth: number // Current depth level in tree
}

/**
 * Get BOM tree with nested children (recursive)
 * Builds full tree hierarchy for assemblies containing sub-assemblies.
 * Uses multiple queries and builds tree in JavaScript.
 *
 * @param fileId - Root assembly file ID
 * @param maxDepth - Maximum nesting depth (default 10, prevents infinite loops)
 * @param onProgress - Optional callback for progress updates during deep tree loading
 * @returns Tree structure with children nested
 */
export async function getContainsRecursive(
  fileId: string,
  maxDepth: number = 10,
  onProgress?: (message: string) => void,
): Promise<{
  references: BomTreeNode[] | null
  error: any
  stats: {
    totalNodes: number
    maxDepthReached: number
    assembliesProcessed: number
  }
}> {
  const stats = {
    totalNodes: 0,
    maxDepthReached: 0,
    assembliesProcessed: 0,
  }

  // Track visited files to prevent cycles (circular references)
  const visited = new Set<string>()

  /**
   * Recursively fetch children for a file
   */
  async function fetchChildren(parentId: string, depth: number): Promise<BomTreeNode[]> {
    // Prevent infinite loops
    if (depth > maxDepth) {
      return []
    }

    // Prevent cycles
    if (visited.has(parentId)) {
      log.warn('[Files]', 'Cycle detected in BOM hierarchy, skipping', { parentId })
      return []
    }
    visited.add(parentId)

    // Update max depth reached
    if (depth > stats.maxDepthReached) {
      stats.maxDepthReached = depth
    }

    // Fetch direct children
    const { references, error } = await getContains(parentId)

    if (error || !references || references.length === 0) {
      return []
    }

    stats.totalNodes += references.length

    // Convert to BomTreeNode with children
    const nodes: BomTreeNode[] = []

    for (const ref of references) {
      const isAssembly = ref.child?.file_name?.toLowerCase().endsWith('.sldasm')

      const node: BomTreeNode = {
        id: ref.id,
        parent_file_id: ref.parent_file_id,
        child_file_id: ref.child_file_id,
        quantity: ref.quantity ?? 1,
        configuration: ref.configuration,
        reference_type: ref.reference_type || 'component',
        child: ref.child
          ? {
              ...ref.child,
              extension: ref.child.file_name?.includes('.')
                ? '.' + (ref.child.file_name.split('.').pop()?.toLowerCase() || '')
                : '',
            }
          : null,
        children: [],
        depth,
      }

      // If this is a sub-assembly, recursively fetch its children
      if (isAssembly && ref.child_file_id && depth < maxDepth) {
        stats.assembliesProcessed++

        if (onProgress) {
          onProgress(
            `Loading sub-assembly: ${ref.child?.file_name || 'unknown'} (level ${depth + 1})`,
          )
        }

        node.children = await fetchChildren(ref.child_file_id, depth + 1)
      }

      nodes.push(node)
    }

    return nodes
  }

  try {
    onProgress?.('Loading BOM tree...')

    const rootChildren = await fetchChildren(fileId, 1)

    onProgress?.(`Loaded ${stats.totalNodes} components across ${stats.maxDepthReached} levels`)

    return {
      references: rootChildren,
      error: null,
      stats,
    }
  } catch (error) {
    log.error('[Files]', 'Error building BOM tree', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      references: null,
      error,
      stats,
    }
  }
}

/**
 * Get all drawings (.slddrw) that reference any of the given file IDs.
 * Drawings reference parts/assemblies via file_references table where:
 * - parent_file_id = drawing file ID
 * - child_file_id = part/assembly file ID
 *
 * This function finds drawings by querying file_references where child_file_id
 * is in the provided fileIds, and the parent is a drawing file.
 *
 * @param fileIds - Array of file IDs (parts/assemblies) to find drawings for
 * @returns Array of lightweight file data for drawings that reference the given files
 */
export async function getDrawingsForFiles(fileIds: string[]): Promise<{
  drawings: LightweightFile[]
  error: any
}> {
  if (fileIds.length === 0) {
    return { drawings: [], error: null }
  }

  const client = getSupabaseClient()

  // Query file_references where child_file_id is in the given fileIds
  // We'll filter for drawings by checking the parent file's extension
  const { data, error } = await client
    .from('file_references')
    .select(
      `
      parent_file_id,
      parent:files!parent_file_id(
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
        updated_at,
        custom_properties
      )
    `,
    )
    .in('child_file_id', fileIds)

  if (error) {
    log.error('[Files]', 'Failed to fetch drawings for files', { error: error.message, fileIds })
    return { drawings: [], error }
  }

  // Extract unique drawings from the results
  // Multiple references might point to the same drawing
  const drawingMap = new Map<string, LightweightFile>()

  for (const ref of data || []) {
    const parent = ref.parent as {
      id: string
      file_path: string
      file_name: string
      extension: string | null
      file_type: string | null
      part_number: string | null
      description: string | null
      revision: string | null
      version: number
      content_hash: string | null
      file_size: number | null
      state: string | null
      checked_out_by: string | null
      checked_out_at: string | null
      updated_at: string
      custom_properties: Record<string, unknown> | null
    } | null

    // Verify this is actually a drawing file
    if (parent && parent.file_name?.toLowerCase().endsWith('.slddrw')) {
      if (!drawingMap.has(parent.id)) {
        drawingMap.set(parent.id, {
          id: parent.id,
          file_path: parent.file_path,
          file_name: parent.file_name,
          extension: parent.extension,
          file_type: parent.file_type,
          part_number: parent.part_number,
          description: parent.description,
          revision: parent.revision,
          version: parent.version,
          content_hash: parent.content_hash,
          file_size: parent.file_size,
          state: parent.state,
          checked_out_by: parent.checked_out_by,
          checked_out_at: parent.checked_out_at,
          updated_at: parent.updated_at,
          custom_properties: parent.custom_properties,
        })
      }
    }
  }

  return {
    drawings: Array.from(drawingMap.values()),
    error: null,
  }
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
    .select(
      `
      *,
      checked_out_user:users!checked_out_by(id, email, full_name, avatar_url)
    `,
    )
    .eq('org_id', orgId)
    .not('checked_out_by', 'is', null)
    .order('checked_out_at', { ascending: false })

  return { files: data, error }
}

// ============================================
// Reference Diagnostics (for debugging BOM issues)
// ============================================

export interface FileReferenceDiagnostic {
  id: string
  parent_file_id: string
  child_file_id: string
  reference_type: string
  quantity: number
  configuration: string | null
  created_at: string
  parent: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
  } | null
  child: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
  } | null
}

export interface VaultFileSummary {
  id: string
  file_name: string
  file_path: string
  extension: string | null
}

/**
 * Get all file_references for a specific assembly with full parent/child details.
 * Used for diagnostics to verify what references are actually stored.
 *
 * @param parentFileId - The assembly file ID to get references for
 * @returns Array of references with full details
 */
export async function getFileReferenceDiagnostics(parentFileId: string): Promise<{
  references: FileReferenceDiagnostic[]
  error: any
}> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('file_references')
    .select(
      `
      id,
      parent_file_id,
      child_file_id,
      reference_type,
      quantity,
      configuration,
      created_at,
      parent:files!parent_file_id(id, file_name, file_path, part_number),
      child:files!child_file_id(id, file_name, file_path, part_number)
    `,
    )
    .eq('parent_file_id', parentFileId)
    .order('created_at', { ascending: false })

  return {
    references: (data || []) as FileReferenceDiagnostic[],
    error,
  }
}

/**
 * Get all files in a vault for path matching diagnostics.
 * Returns lightweight file info for comparing with SW service paths.
 *
 * @param orgId - Organization ID
 * @param vaultId - Vault ID
 * @returns Array of files with path info
 */
export async function getVaultFilesForDiagnostics(
  orgId: string,
  vaultId: string,
): Promise<{
  files: VaultFileSummary[]
  error: any
}> {
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('files')
    .select('id, file_name, file_path, extension')
    .eq('org_id', orgId)
    .eq('vault_id', vaultId)
    .is('deleted_at', null)
    .order('file_path', { ascending: true })

  return {
    files: (data || []) as VaultFileSummary[],
    error,
  }
}
