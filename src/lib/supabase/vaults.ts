import { getSupabaseClient } from './client'

// ============================================
// Vault Access Management (Admin only)
// ============================================

/**
 * Get vault access records for a user
 * Returns array of vault IDs the user has access to
 */
export async function getUserVaultAccess(
  userId: string,
): Promise<{ vaultIds: string[]; error?: string }> {
  const client = getSupabaseClient()

  const { data, error } = await client.from('vault_access').select('vault_id').eq('user_id', userId)

  if (error) {
    return { vaultIds: [], error: error.message }
  }

  return { vaultIds: data?.map((r) => r.vault_id) || [] }
}

/**
 * Get all vault access records for an organization
 * Returns a map of vault_id -> array of user_ids
 */
export async function getOrgVaultAccess(orgId: string): Promise<{
  accessMap: Record<string, string[]>
  error?: string
}> {
  const client = getSupabaseClient()

  // Get all vaults for the org
  const { data: vaults, error: vaultsError } = await client
    .from('vaults')
    .select('id')
    .eq('org_id', orgId)

  if (vaultsError) {
    return { accessMap: {}, error: vaultsError.message }
  }

  const vaultIds = vaults?.map((v) => v.id) || []

  if (vaultIds.length === 0) {
    return { accessMap: {} }
  }

  // Get access records for all vaults
  const { data, error } = await client
    .from('vault_access')
    .select('vault_id, user_id')
    .in('vault_id', vaultIds)

  if (error) {
    return { accessMap: {}, error: error.message }
  }

  // Build the map
  const accessMap: Record<string, string[]> = {}
  for (const record of data || []) {
    if (!accessMap[record.vault_id]) {
      accessMap[record.vault_id] = []
    }
    accessMap[record.vault_id].push(record.user_id)
  }

  return { accessMap }
}

/**
 * Grant a user access to a vault (admin only)
 */
export async function grantVaultAccess(
  vaultId: string,
  userId: string,
  grantedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  const { error } = await client.from('vault_access').insert({
    vault_id: vaultId,
    user_id: userId,
    granted_by: grantedBy,
  })

  if (error) {
    // Ignore duplicate key errors (user already has access)
    if (error.code === '23505') {
      return { success: true }
    }
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Revoke a user's access to a vault (admin only)
 */
export async function revokeVaultAccess(
  vaultId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  const { error } = await client
    .from('vault_access')
    .delete()
    .eq('vault_id', vaultId)
    .eq('user_id', userId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Set a user's vault access to a specific set of vaults (admin only)
 * This replaces all existing access for the user with the new list
 */
export async function setUserVaultAccess(
  userId: string,
  vaultIds: string[],
  grantedBy: string,
  orgId: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()

  // Get all vaults for the org to only remove access for vaults in this org
  const { data: orgVaults, error: vaultsError } = await client
    .from('vaults')
    .select('id')
    .eq('org_id', orgId)

  if (vaultsError) {
    return { success: false, error: vaultsError.message }
  }

  const orgVaultIds = orgVaults?.map((v) => v.id) || []

  // Delete existing access for vaults in this org
  if (orgVaultIds.length > 0) {
    const { error: deleteError } = await client
      .from('vault_access')
      .delete()
      .eq('user_id', userId)
      .in('vault_id', orgVaultIds)

    if (deleteError) {
      return { success: false, error: deleteError.message }
    }
  }

  // Insert new access records
  if (vaultIds.length > 0) {
    const records = vaultIds.map((vaultId) => ({
      vault_id: vaultId,
      user_id: userId,
      granted_by: grantedBy,
    }))

    const { error: insertError } = await client.from('vault_access').insert(records)

    if (insertError) {
      return { success: false, error: insertError.message }
    }
  }

  return { success: true }
}

/**
 * Check if a user has access to a specific vault (opt-in model)
 * - Admins always have access to all vaults
 * - Everyone else must have been explicitly granted access, either directly
 *   (vault_access) or through one of their teams (team_vault_access)
 * - No grant means no access
 */
export async function checkVaultAccess(
  userId: string,
  vaultId: string,
  userRole: string,
): Promise<{ hasAccess: boolean; error?: string }> {
  // Admins always have access
  if (userRole === 'admin') {
    return { hasAccess: true }
  }

  // Resolve the user's effective access (individual + team grants)
  const { vaultIds, error } = await getEffectiveUserVaultAccess(userId)

  if (error) {
    return { hasAccess: false, error }
  }

  return { hasAccess: vaultIds.includes(vaultId) }
}

/**
 * Get the effective vault access for a user (combining team + individual permissions)
 * Uses the PostgreSQL get_user_vault_access function
 * Returns empty array if user has no restrictions (can access all vaults)
 */
export async function getEffectiveUserVaultAccess(
  userId: string,
): Promise<{ vaultIds: string[]; error?: string }> {
  const client = getSupabaseClient()

  const { data, error } = await client.rpc('get_user_vault_access', { p_user_id: userId })

  if (error) {
    return { vaultIds: [], error: error.message }
  }

  return { vaultIds: data?.map((r: { vault_id: string }) => r.vault_id) || [] }
}

/**
 * Get accessible vaults for a user in their organization (opt-in model)
 * - Admins see all vaults
 * - Non-admin users only see vaults they have been explicitly granted access to
 *   (via individual vault_access or their teams' team_vault_access)
 * - If a user has no grants, they see no vaults
 */
export async function getAccessibleVaults(
  userId: string,
  orgId: string,
  userRole: string,
): Promise<{
  vaults: Array<{
    id: string
    name: string
    slug: string
    description: string | null
    is_default: boolean | null
    created_at: string | null
  }>
  error?: string
}> {
  const client = getSupabaseClient()

  // Get all vaults for the org first
  const { data: allVaults, error: vaultsError } = await client
    .from('vaults')
    .select('id, name, slug, description, is_default, created_at')
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .order('name')

  if (vaultsError) {
    return { vaults: [], error: vaultsError.message }
  }

  if (!allVaults || allVaults.length === 0) {
    return { vaults: [] }
  }

  // Admins always see all vaults
  if (userRole === 'admin') {
    return { vaults: allVaults }
  }

  // Get user's effective vault access (from teams + individual)
  const { vaultIds: accessibleVaultIds, error: accessError } =
    await getEffectiveUserVaultAccess(userId)

  if (accessError) {
    return { vaults: [], error: accessError }
  }

  // Opt-in model: no grants means no accessible vaults
  if (accessibleVaultIds.length === 0) {
    return { vaults: [] }
  }

  // Filter vaults to only those the user has access to
  const accessibleVaultIdSet = new Set(accessibleVaultIds)
  const filteredVaults = allVaults.filter((v) => accessibleVaultIdSet.has(v.id))

  return { vaults: filteredVaults }
}
