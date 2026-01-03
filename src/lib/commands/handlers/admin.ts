// @ts-nocheck - Supabase type inference issues with Database generics
/**
 * Admin Command Handlers
 * 
 * Commands: members, invite, remove-member, teams, create-team, delete-team, add-to-team, remove-from-team,
 *           team-info, roles, create-role, delete-role, assign-role, unassign-role, titles, create-title,
 *           set-title, permissions, grant, revoke, user-info, pending-invites
 */

import { usePDMStore } from '../../../stores/pdmStore'
import {
  supabase,
  getOrgTeams,
  getUserTeams,
  getUserPermissions,
  removeUserFromOrg
} from '../../supabase'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Handle members command - list organization members
 */
export async function handleMembers(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in to an organization')
    return
  }
  
  try {
    const { data: members, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, last_sign_in, org_id')
      .eq('org_id', organization.id)
      .order('full_name')
    
    if (error) throw new Error(error.message)
    
    if (!members || members.length === 0) {
      addOutput('info', 'No members found')
      return
    }
    
    const lines = [`👥 Organization Members (${members.length}):`]
    for (const u of members) {
      const roleIcon = u.role === 'admin' ? '👑' : u.role === 'engineer' ? '🔧' : '👁️'
      const name = u.full_name || u.email
      lines.push(`  ${roleIcon} ${name}`)
      lines.push(`     Email: ${u.email}`)
      lines.push(`     Role: ${u.role}`)
      if (u.last_sign_in) {
        lines.push(`     Last seen: ${new Date(u.last_sign_in).toLocaleDateString()}`)
      }
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to list members: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle invite command - invite a new member
 */
export async function handleInvite(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  const name = parsed.flags['name'] as string || parsed.flags['n'] as string || 'New User'
  const role = parsed.flags['role'] as string || parsed.flags['r'] as string || 'engineer'
  
  if (!email) {
    addOutput('error', 'Usage: invite <email> [--name=<name>] [--role=<role>] [--team=<team>]')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Check if user already exists
    const { data: existing } = await supabase
      .from('pending_org_members')
      .select('id')
      .eq('org_id', organization.id)
      .eq('email', email.toLowerCase())
      .single()
    
    if (existing) {
      addOutput('error', `User ${email} already has a pending invite`)
      return
    }
    
    // Get team ID if specified
    let teamIds: string[] = []
    const teamName = parsed.flags['team'] as string || parsed.flags['t'] as string
    if (teamName) {
      const { data: team } = await supabase
        .from('teams')
        .select('id')
        .eq('org_id', organization.id)
        .ilike('name', teamName)
        .single()
      if (team) teamIds = [team.id]
    }
    
    // Create pending member
    const { error } = await supabase
      .from('pending_org_members')
      .insert({
        org_id: organization.id,
        email: email.toLowerCase(),
        full_name: name,
        role: role,
        team_ids: teamIds,
        workflow_role_ids: [],
        vault_ids: [],
        created_by: user.id
      })
    
    if (error) throw error
    
    addOutput('success', `Invited ${email} as ${role}${teamIds.length ? ` (team: ${teamName})` : ''}`)
    addOutput('info', 'User will see this organization when they sign in with this email.')
  } catch (err) {
    addOutput('error', `Failed to invite: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle remove-member/remove-user command - remove a member
 */
export async function handleRemoveMember(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  
  if (!email) {
    addOutput('error', 'Usage: remove-member <email>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // First try to remove from pending
    const { data: pending } = await supabase
      .from('pending_org_members')
      .select('id')
      .eq('org_id', organization.id)
      .eq('email', email.toLowerCase())
      .single()
    
    if (pending) {
      await supabase.from('pending_org_members').delete().eq('id', pending.id)
      addOutput('success', `Removed pending invite for ${email}`)
      return
    }
    
    // Find the user
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!userData) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Remove from org
    const result = await removeUserFromOrg(userData.id, organization.id)
    if (result.success) {
      addOutput('success', `Removed ${email} from organization`)
    } else {
      addOutput('error', result.error || 'Failed to remove user')
    }
  } catch (err) {
    addOutput('error', `Failed to remove member: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle teams command - list all teams
 */
export async function handleTeams(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { teams, error } = await getOrgTeams(organization.id)
    if (error) throw new Error(error)
    
    if (!teams || teams.length === 0) {
      addOutput('info', 'No teams found')
      return
    }
    
    const lines = [`👥 Teams (${teams.length}):`]
    for (const team of teams) {
      const isDefault = team.is_default ? ' (default)' : ''
      lines.push(`  • ${team.name}${isDefault}`)
      lines.push(`    Members: ${team.member_count || 0}`)
      lines.push(`    Permissions: ${team.permissions_count || 0}`)
      if (team.description) {
        lines.push(`    Description: ${team.description}`)
      }
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to list teams: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle create-team command - create a new team
 */
export async function handleCreateTeam(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const name = parsed.args[0]
  const color = parsed.flags['color'] as string || parsed.flags['c'] as string || '#3b82f6'
  const icon = parsed.flags['icon'] as string || parsed.flags['i'] as string || 'Users'
  const description = parsed.flags['desc'] as string || parsed.flags['d'] as string || ''
  
  if (!name) {
    addOutput('error', 'Usage: create-team <name> [--color=#hex] [--icon=IconName] [--desc="Description"]')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { error } = await supabase
      .from('teams')
      .insert({
        org_id: organization.id,
        name,
        color,
        icon,
        description,
        created_by: user.id,
        updated_by: user.id
      })
    
    if (error) throw error
    
    addOutput('success', `Created team: ${name}`)
  } catch (err) {
    addOutput('error', `Failed to create team: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle delete-team command - delete a team
 */
export async function handleDeleteTeam(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const name = parsed.args[0]
  
  if (!name) {
    addOutput('error', 'Usage: delete-team <name>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: team } = await supabase
      .from('teams')
      .select('id, is_system')
      .eq('org_id', organization.id)
      .ilike('name', name)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${name}`)
      return
    }
    
    if (team.is_system) {
      addOutput('error', 'Cannot delete system teams')
      return
    }
    
    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    if (error) throw error
    
    addOutput('success', `Deleted team: ${name}`)
  } catch (err) {
    addOutput('error', `Failed to delete team: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle add-to-team command - add user to a team
 */
export async function handleAddToTeam(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  const teamName = parsed.args[1]
  
  if (!email || !teamName) {
    addOutput('error', 'Usage: add-to-team <email> <team-name>')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find user
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!targetUser) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Find team
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', teamName)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${teamName}`)
      return
    }
    
    // Add to team
    const { error } = await supabase
      .from('team_members')
      .insert({
        team_id: team.id,
        user_id: targetUser.id,
        added_by: user.id
      })
    
    if (error) {
      if (error.code === '23505') {
        addOutput('info', `${email} is already in team ${teamName}`)
      } else {
        throw error
      }
    } else {
      addOutput('success', `Added ${email} to team: ${teamName}`)
    }
  } catch (err) {
    addOutput('error', `Failed to add to team: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle remove-from-team command - remove user from team
 */
export async function handleRemoveFromTeam(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  const teamName = parsed.args[1]
  
  if (!email || !teamName) {
    addOutput('error', 'Usage: remove-from-team <email> <team-name>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find user
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!targetUser) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Find team
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', teamName)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${teamName}`)
      return
    }
    
    // Remove from team
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', team.id)
      .eq('user_id', targetUser.id)
    
    if (error) throw error
    
    addOutput('success', `Removed ${email} from team: ${teamName}`)
  } catch (err) {
    addOutput('error', `Failed to remove from team: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle team-info command - show team details
 */
export async function handleTeamInfo(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const name = parsed.args[0]
  
  if (!name) {
    addOutput('error', 'Usage: team-info <team-name>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: team } = await supabase
      .from('teams')
      .select(`
        *,
        team_members(user_id, users(email, full_name)),
        team_permissions(resource, actions)
      `)
      .eq('org_id', organization.id)
      .ilike('name', name)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${name}`)
      return
    }
    
    const lines = [`👥 Team: ${team.name}`]
    if (team.description) lines.push(`   Description: ${team.description}`)
    lines.push(`   Color: ${team.color}`)
    lines.push(`   Icon: ${team.icon}`)
    lines.push(`   Default: ${team.is_default ? 'Yes' : 'No'}`)
    lines.push(`   System: ${team.is_system ? 'Yes' : 'No'}`)
    
    const members = team.team_members as any[] || []
    lines.push(`\n   Members (${members.length}):`)
    for (const m of members.slice(0, 10)) {
      const u = m.users
      lines.push(`     • ${u.full_name || u.email}`)
    }
    if (members.length > 10) {
      lines.push(`     ... and ${members.length - 10} more`)
    }
    
    const perms = team.team_permissions as any[] || []
    lines.push(`\n   Permissions (${perms.length}):`)
    for (const p of perms.slice(0, 10)) {
      lines.push(`     • ${p.resource}: ${p.actions.join(', ')}`)
    }
    if (perms.length > 10) {
      lines.push(`     ... and ${perms.length - 10} more`)
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get team info: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle roles/workflow-roles command - list workflow roles
 */
export async function handleRoles(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: roles, error } = await supabase
      .from('workflow_roles')
      .select('*')
      .eq('org_id', organization.id)
      .order('name')
    
    if (error) throw error
    
    if (!roles || roles.length === 0) {
      addOutput('info', 'No workflow roles defined')
      return
    }
    
    const lines = [`🎭 Workflow Roles (${roles.length}):`]
    for (const role of roles) {
      lines.push(`  • ${role.name}`)
      if (role.description) {
        lines.push(`    ${role.description}`)
      }
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to list roles: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle create-role command - create a workflow role
 */
export async function handleCreateRole(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const name = parsed.args[0]
  const color = parsed.flags['color'] as string || '#8b5cf6'
  const icon = parsed.flags['icon'] as string || 'Shield'
  const description = parsed.flags['desc'] as string || ''
  
  if (!name) {
    addOutput('error', 'Usage: create-role <name> [--color=#hex] [--icon=IconName] [--desc="Description"]')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { error } = await supabase
      .from('workflow_roles')
      .insert({
        org_id: organization.id,
        name,
        color,
        icon,
        description,
        created_by: user.id
      })
    
    if (error) throw error
    
    addOutput('success', `Created workflow role: ${name}`)
  } catch (err) {
    addOutput('error', `Failed to create role: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle delete-role command - delete a workflow role
 */
export async function handleDeleteRole(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const name = parsed.args[0]
  
  if (!name) {
    addOutput('error', 'Usage: delete-role <name>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: role } = await supabase
      .from('workflow_roles')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', name)
      .single()
    
    if (!role) {
      addOutput('error', `Role not found: ${name}`)
      return
    }
    
    const { error } = await supabase.from('workflow_roles').delete().eq('id', role.id)
    if (error) throw error
    
    addOutput('success', `Deleted workflow role: ${name}`)
  } catch (err) {
    addOutput('error', `Failed to delete role: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle assign-role command - assign workflow role to user
 */
export async function handleAssignRole(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  const roleName = parsed.args[1]
  
  if (!email || !roleName) {
    addOutput('error', 'Usage: assign-role <email> <role-name>')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find user
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!targetUser) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Find role
    const { data: role } = await supabase
      .from('workflow_roles')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', roleName)
      .single()
    
    if (!role) {
      addOutput('error', `Role not found: ${roleName}`)
      return
    }
    
    // Assign role
    const { error } = await supabase
      .from('user_workflow_roles')
      .insert({
        user_id: targetUser.id,
        role_id: role.id,
        assigned_by: user.id
      })
    
    if (error) {
      if (error.code === '23505') {
        addOutput('info', `${email} already has role: ${roleName}`)
      } else {
        throw error
      }
    } else {
      addOutput('success', `Assigned ${roleName} role to ${email}`)
    }
  } catch (err) {
    addOutput('error', `Failed to assign role: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle unassign-role command - remove workflow role from user
 */
export async function handleUnassignRole(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  const roleName = parsed.args[1]
  
  if (!email || !roleName) {
    addOutput('error', 'Usage: unassign-role <email> <role-name>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find user
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!targetUser) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Find role
    const { data: role } = await supabase
      .from('workflow_roles')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', roleName)
      .single()
    
    if (!role) {
      addOutput('error', `Role not found: ${roleName}`)
      return
    }
    
    // Remove role
    const { error } = await supabase
      .from('user_workflow_roles')
      .delete()
      .eq('user_id', targetUser.id)
      .eq('role_id', role.id)
    
    if (error) throw error
    
    addOutput('success', `Removed ${roleName} role from ${email}`)
  } catch (err) {
    addOutput('error', `Failed to unassign role: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle titles/job-titles command - list job titles
 */
export async function handleTitles(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: titles, error } = await supabase
      .from('job_titles')
      .select('*')
      .eq('org_id', organization.id)
      .order('name')
    
    if (error) throw error
    
    if (!titles || titles.length === 0) {
      addOutput('info', 'No job titles defined')
      return
    }
    
    const lines = [`💼 Job Titles (${titles.length}):`]
    for (const title of titles) {
      lines.push(`  • ${title.name}`)
      if (title.description) {
        lines.push(`    ${title.description}`)
      }
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to list titles: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle create-title command - create a job title
 */
export async function handleCreateTitle(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const name = parsed.args[0]
  const color = parsed.flags['color'] as string || '#3b82f6'
  const icon = parsed.flags['icon'] as string || 'Briefcase'
  const description = parsed.flags['desc'] as string || ''
  
  if (!name) {
    addOutput('error', 'Usage: create-title <name> [--color=#hex] [--icon=IconName] [--desc="Description"]')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { error } = await supabase
      .from('job_titles')
      .insert({
        org_id: organization.id,
        name,
        color,
        icon,
        description,
        created_by: user.id
      })
    
    if (error) throw error
    
    addOutput('success', `Created job title: ${name}`)
  } catch (err) {
    addOutput('error', `Failed to create title: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle set-title command - set user's job title
 */
export async function handleSetTitle(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  const titleName = parsed.args[1]
  
  if (!email || !titleName) {
    addOutput('error', 'Usage: set-title <email> <title-name>')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find user
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!targetUser) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Find title
    const { data: title } = await supabase
      .from('job_titles')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', titleName)
      .single()
    
    if (!title) {
      addOutput('error', `Title not found: ${titleName}`)
      return
    }
    
    // Remove any existing title assignments
    await supabase
      .from('user_job_titles')
      .delete()
      .eq('user_id', targetUser.id)
    
    // Set new title
    const { error } = await supabase
      .from('user_job_titles')
      .insert({
        user_id: targetUser.id,
        title_id: title.id,
        assigned_by: user.id
      })
    
    if (error) throw error
    
    addOutput('success', `Set ${email}'s job title to: ${titleName}`)
  } catch (err) {
    addOutput('error', `Failed to set title: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle permissions command - view team permissions
 */
export async function handlePermissions(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const teamName = parsed.args[0]
  
  if (!teamName) {
    addOutput('error', 'Usage: permissions <team-name>')
    addOutput('info', 'Use "teams" to list available teams')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: team } = await supabase
      .from('teams')
      .select('id, name, team_permissions(resource, actions)')
      .eq('org_id', organization.id)
      .ilike('name', teamName)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${teamName}`)
      return
    }
    
    const perms = team.team_permissions as any[] || []
    
    if (perms.length === 0) {
      addOutput('info', `Team "${team.name}" has no permissions configured`)
      return
    }
    
    const lines = [`🔐 Permissions for ${team.name}:`]
    for (const p of perms) {
      lines.push(`  ${p.resource}: ${p.actions.join(', ')}`)
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get permissions: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle grant command - grant permission to team
 */
export async function handleGrant(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const teamName = parsed.args[0]
  const resource = parsed.args[1]
  const action = parsed.args[2]
  
  if (!teamName || !resource || !action) {
    addOutput('error', 'Usage: grant <team-name> <resource> <action>')
    addOutput('info', 'Actions: view, create, edit, delete, admin')
    addOutput('info', 'Example: grant Engineering module:explorer view')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find team
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', teamName)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${teamName}`)
      return
    }
    
    // Check if permission already exists
    const { data: existing } = await supabase
      .from('team_permissions')
      .select('id, actions')
      .eq('team_id', team.id)
      .eq('resource', resource)
      .single()
    
    if (existing) {
      // Add action to existing permission
      const newActions = [...new Set([...existing.actions, action])]
      await supabase
        .from('team_permissions')
        .update({ actions: newActions, updated_by: user.id })
        .eq('id', existing.id)
    } else {
      // Create new permission
      await supabase
        .from('team_permissions')
        .insert({
          team_id: team.id,
          resource,
          actions: [action],
          granted_by: user.id
        })
    }
    
    addOutput('success', `Granted ${action} on ${resource} to ${teamName}`)
  } catch (err) {
    addOutput('error', `Failed to grant permission: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle revoke command - revoke permission from team
 */
export async function handleRevoke(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const teamName = parsed.args[0]
  const resource = parsed.args[1]
  const action = parsed.args[2]
  
  if (!teamName || !resource) {
    addOutput('error', 'Usage: revoke <team-name> <resource> [action]')
    addOutput('info', 'If action is omitted, all permissions for the resource are revoked')
    return
  }
  
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find team
    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('org_id', organization.id)
      .ilike('name', teamName)
      .single()
    
    if (!team) {
      addOutput('error', `Team not found: ${teamName}`)
      return
    }
    
    if (!action) {
      // Remove all permissions for this resource
      await supabase
        .from('team_permissions')
        .delete()
        .eq('team_id', team.id)
        .eq('resource', resource)
      
      addOutput('success', `Revoked all permissions on ${resource} from ${teamName}`)
    } else {
      // Remove specific action
      const { data: existing } = await supabase
        .from('team_permissions')
        .select('id, actions')
        .eq('team_id', team.id)
        .eq('resource', resource)
        .single()
      
      if (existing) {
        const newActions = existing.actions.filter((a: string) => a !== action)
        if (newActions.length === 0) {
          await supabase.from('team_permissions').delete().eq('id', existing.id)
        } else {
          await supabase
            .from('team_permissions')
            .update({ actions: newActions, updated_by: user.id })
            .eq('id', existing.id)
        }
      }
      
      addOutput('success', `Revoked ${action} on ${resource} from ${teamName}`)
    }
  } catch (err) {
    addOutput('error', `Failed to revoke permission: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle user-info command - show user details
 */
export async function handleUserInfo(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const email = parsed.args[0]
  
  if (!email) {
    addOutput('error', 'Usage: user-info <email>')
    return
  }
  
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Get user info
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single()
    
    if (!userData) {
      addOutput('error', `User not found: ${email}`)
      return
    }
    
    // Get teams
    const { teams } = await getUserTeams(userData.id)
    
    // Get permissions
    const { permissions } = await getUserPermissions(userData.id, userData.role)
    
    const lines = [`👤 User: ${userData.full_name || userData.email}`]
    lines.push(`   Email: ${userData.email}`)
    lines.push(`   Role: ${userData.role}`)
    if (userData.last_sign_in) {
      lines.push(`   Last sign in: ${new Date(userData.last_sign_in).toLocaleString()}`)
    }
    
    if (teams && teams.length > 0) {
      lines.push(`\n   Teams (${teams.length}):`)
      for (const t of teams) {
        lines.push(`     • ${t.name}`)
      }
    }
    
    if (permissions) {
      const permCount = Object.keys(permissions).length
      lines.push(`\n   Permissions: ${permCount} resource(s)`)
      if (permissions.__admin__) {
        lines.push(`     (Admin - full access)`)
      }
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get user info: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Handle pending/pending-invites command - list pending invites
 */
export async function handlePendingInvites(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const { data: pending, error } = await supabase
      .from('pending_org_members')
      .select('*')
      .eq('org_id', organization.id)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    if (!pending || pending.length === 0) {
      addOutput('info', 'No pending invites')
      return
    }
    
    const lines = [`📧 Pending Invites (${pending.length}):`]
    for (const p of pending) {
      const created = new Date(p.created_at).toLocaleDateString()
      lines.push(`  • ${p.email}`)
      lines.push(`    Name: ${p.full_name || 'Not set'}`)
      lines.push(`    Role: ${p.role}`)
      lines.push(`    Created: ${created}`)
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to list pending invites: ${err instanceof Error ? err.message : err}`)
  }
}
