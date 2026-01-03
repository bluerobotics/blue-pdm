// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient } from './client'
import type { PermissionAction } from '../../types/permissions'
import type { ModuleConfig as ModuleConfigType } from '../../types/modules'

// ============================================
// User Role Management
// ============================================

/**
 * Update a user's role (admin only)
 * Only admins can change roles of users in their organization
 */
export async function updateUserRole(
  targetUserId: string,
  newRole: 'admin' | 'engineer' | 'viewer',
  adminOrgId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Verify target user is in same org
  const { data: targetUser, error: fetchError } = await client
    .from('users')
    .select('id, org_id, role')
    .eq('id', targetUserId)
    .single()
  
  if (fetchError || !targetUser) {
    return { success: false, error: 'User not found' }
  }
  
  if (targetUser.org_id !== adminOrgId) {
    return { success: false, error: 'User is not in your organization' }
  }
  
  // Update the role
  const { error } = await client
    .from('users')
    .update({ role: newRole })
    .eq('id', targetUserId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Remove a user from the organization (admin only)
 * Sets the user's org_id to null - they can rejoin if they have the org code
 */
export async function removeUserFromOrg(
  targetUserId: string,
  _adminOrgId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get target user's email for the RPC call
  const { data: targetUser, error: fetchError } = await client
    .from('users')
    .select('email')
    .eq('id', targetUserId)
    .single()
  
  if (fetchError || !targetUser) {
    return { success: false, error: 'User not found' }
  }
  
  // Call admin_remove_user RPC which fully removes the user from org AND auth.users
  // This allows them to be cleanly re-invited later
  const { data, error } = await client.rpc('admin_remove_user', {
    p_user_email: targetUser.email
  })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  const result = data as { success: boolean; error?: string; message?: string }
  
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to remove user' }
  }
  
  return { success: true }
}

/**
 * Add a user to the organization by email (admin only)
 * The user must already have an account (signed in at least once)
 */
export async function addUserToOrg(
  email: string,
  orgId: string,
  role: 'admin' | 'engineer' | 'viewer' = 'engineer'
): Promise<{ success: boolean; user?: any; error?: string }> {
  const client = getSupabaseClient()
  
  // Find user by email
  const { data: existingUser, error: fetchError } = await client
    .from('users')
    .select('id, email, org_id, full_name')
    .eq('email', email.toLowerCase().trim())
    .single()
  
  if (fetchError || !existingUser) {
    return { success: false, error: 'No user found with that email. They must sign in to BluePLM at least once first.' }
  }
  
  if (existingUser.org_id === orgId) {
    return { success: false, error: 'User is already a member of this organization' }
  }
  
  if (existingUser.org_id) {
    return { success: false, error: 'User is already a member of another organization' }
  }
  
  // Add user to org
  const { data, error } = await client
    .from('users')
    .update({ org_id: orgId, role })
    .eq('id', existingUser.id)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true, user: data }
}

// ============================================
// Teams & Permissions (Permission checking)
// ============================================

/**
 * Get all teams a user belongs to
 */
export async function getUserTeams(
  userId: string
): Promise<{ teams: Array<{ id: string; name: string; color: string; icon: string }> | null; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('team_members')
    .select(`
      team:teams(id, name, color, icon)
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { teams: null, error: error.message }
  }
  
  const teams = (data || [])
    .map(m => m.team)
    .filter(Boolean) as Array<{ id: string; name: string; color: string; icon: string }>
  
  return { teams }
}

/**
 * Get all effective permissions for a user (across all their teams)
 * Returns a map of resource -> array of actions
 */
export async function getUserPermissions(
  userId: string,
  userRole?: 'admin' | 'engineer' | 'viewer'
): Promise<{ permissions: Record<string, PermissionAction[]> | null; error?: string }> {
  // Admins have full access - return a special flag
  if (userRole === 'admin') {
    return { permissions: { __admin__: ['view', 'create', 'edit', 'delete', 'admin'] } }
  }
  
  const client = getSupabaseClient()
  
  // Get all team memberships and their permissions
  const { data, error } = await client
    .from('team_members')
    .select(`
      team_id,
      team:teams!inner(
        id,
        team_permissions(resource, actions)
      )
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { permissions: null, error: error.message }
  }
  
  // Merge permissions from all teams
  const mergedPermissions: Record<string, Set<PermissionAction>> = {}
  
  for (const membership of data || []) {
    const team = membership.team as any
    const perms = team?.team_permissions || []
    
    for (const perm of perms) {
      if (!mergedPermissions[perm.resource]) {
        mergedPermissions[perm.resource] = new Set()
      }
      for (const action of perm.actions || []) {
        mergedPermissions[perm.resource].add(action as PermissionAction)
      }
    }
  }
  
  // Convert sets to arrays
  const permissions: Record<string, PermissionAction[]> = {}
  for (const [resource, actionSet] of Object.entries(mergedPermissions)) {
    permissions[resource] = Array.from(actionSet)
  }
  
  return { permissions }
}

/**
 * Load full context for impersonating a user (admin feature)
 * Returns user info, teams, permissions, vault access, and module config
 */
export async function loadImpersonatedUserContext(
  targetUserId: string
): Promise<{ 
  user: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    role: 'admin' | 'engineer' | 'viewer'
    teams: Array<{ id: string; name: string; color: string; icon: string }>
    permissions: Record<string, string[]>
    vaultIds: string[]
    moduleConfig?: ModuleConfigType
  } | null
  error?: string 
}> {
  const client = getSupabaseClient()
  
  // 1. Get the target user's basic info
  const { data: userData, error: userError } = await client
    .from('users')
    .select('id, email, full_name, avatar_url, role')
    .eq('id', targetUserId)
    .single()
  
  if (userError || !userData) {
    return { user: null, error: userError?.message || 'User not found' }
  }
  
  // 2. Get user's teams
  const { teams } = await getUserTeams(targetUserId)
  
  // 3. Get user's permissions
  const { permissions } = await getUserPermissions(
    targetUserId, 
    userData.role as 'admin' | 'engineer' | 'viewer'
  )
  
  // 4. Get user's vault access (import dynamically to avoid circular dependency)
  const { getEffectiveUserVaultAccess } = await import('./vaults')
  const { vaultIds } = await getEffectiveUserVaultAccess(targetUserId)
  
  // 5. Get user's effective module config (from their team defaults)
  let moduleConfig: ModuleConfigType | undefined
  
  try {
    const { data: moduleData, error: moduleError } = await (client.rpc as any)('get_user_module_defaults', {
      p_user_id: targetUserId
    })
    
    if (!moduleError && moduleData) {
      moduleConfig = {
        enabledModules: moduleData.enabled_modules || {},
        enabledGroups: moduleData.enabled_groups || {},
        moduleOrder: moduleData.module_order || [],
        dividers: moduleData.dividers || [],
        moduleParents: moduleData.module_parents || {},
        moduleIconColors: moduleData.module_icon_colors || {},
        customGroups: moduleData.custom_groups || []
      } as ModuleConfigType
    }
  } catch (err) {
    console.warn('Failed to load module defaults for impersonated user:', err)
  }
  
  return {
    user: {
      id: userData.id,
      email: userData.email,
      full_name: userData.full_name,
      avatar_url: userData.avatar_url,
      role: userData.role as 'admin' | 'engineer' | 'viewer',
      teams: teams || [],
      permissions: permissions || {},
      vaultIds: vaultIds || [],
      moduleConfig
    }
  }
}

/**
 * Check if a user has a specific permission on a resource
 * This is the main function to use for permission checks in the UI
 */
export async function checkPermission(
  userId: string,
  resource: string,
  action: PermissionAction,
  userRole?: 'admin' | 'engineer' | 'viewer'
): Promise<{ hasPermission: boolean; error?: string }> {
  // Admins always have full access
  if (userRole === 'admin') {
    return { hasPermission: true }
  }
  
  const client = getSupabaseClient()
  
  // Check if user has this permission through any of their teams
  const { data, error } = await client
    .from('team_members')
    .select(`
      team_id,
      team:teams!inner(
        team_permissions!inner(resource, actions)
      )
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { hasPermission: false, error: error.message }
  }
  
  // Check if any team has the required permission
  for (const membership of data || []) {
    const team = membership.team as any
    const perms = team?.team_permissions || []
    
    for (const perm of perms) {
      if (perm.resource === resource) {
        if (perm.actions?.includes(action) || perm.actions?.includes('admin')) {
          return { hasPermission: true }
        }
      }
    }
  }
  
  return { hasPermission: false }
}

/**
 * Check multiple permissions at once (more efficient for bulk checks)
 */
export async function checkPermissions(
  userId: string,
  checks: Array<{ resource: string; action: PermissionAction }>,
  userRole?: 'admin' | 'engineer' | 'viewer'
): Promise<{ results: Record<string, boolean>; error?: string }> {
  // Admins always have full access
  if (userRole === 'admin') {
    const results: Record<string, boolean> = {}
    for (const check of checks) {
      results[`${check.resource}:${check.action}`] = true
    }
    return { results }
  }
  
  // Get all permissions once
  const { permissions, error } = await getUserPermissions(userId, userRole)
  
  if (error || !permissions) {
    return { results: {}, error }
  }
  
  // Check each permission
  const results: Record<string, boolean> = {}
  for (const check of checks) {
    const key = `${check.resource}:${check.action}`
    const resourcePerms = permissions[check.resource] || []
    results[key] = resourcePerms.includes(check.action) || resourcePerms.includes('admin')
  }
  
  return { results }
}

/**
 * Get all teams in an organization
 */
export async function getOrgTeams(
  orgId: string
): Promise<{ teams: any[] | null; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('teams')
    .select(`
      *,
      team_members(count),
      team_permissions(count)
    `)
    .eq('org_id', orgId)
    .order('name')
  
  if (error) {
    return { teams: null, error: error.message }
  }
  
  // Transform to include counts
  const teams = (data || []).map(team => ({
    ...team,
    member_count: team.team_members?.[0]?.count || 0,
    permissions_count: team.team_permissions?.[0]?.count || 0
  }))
  
  return { teams }
}
