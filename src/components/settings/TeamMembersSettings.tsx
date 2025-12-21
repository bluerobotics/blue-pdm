// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect, useMemo } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Shield,
  ChevronRight,
  ChevronDown,
  UserPlus,
  X,
  Check,
  Search,
  Copy,
  Crown,
  Wrench,
  Eye,
  Lock,
  UserMinus,
  RefreshCw,
  Key,
  AlertTriangle,
  ExternalLink,
  UsersRound,
  Mail,
  Folder,
  Database,
  UserX,
  Settings2,
  Clock,
  UserCheck,
  Minus
} from 'lucide-react'
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  ALL_RESOURCES
} from '../../types/permissions'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase, getCurrentConfig, updateUserRole, removeUserFromOrg, getOrgVaultAccess, setUserVaultAccess } from '../../lib/supabase'
import { generateOrgCode } from '../../lib/supabaseConfig'
import { getInitials } from '../../types/pdm'
import { UserProfileModal } from './UserProfileModal'
import { PermissionsEditor } from './PermissionsEditor'
import type { Team, TeamMember, TeamPermission, PermissionAction } from '../../types/permissions'

// Popular icons for team selection
const TEAM_ICONS = [
  'Users', 'UsersRound', 'UserCog', 'Shield', 'ShieldCheck', 'Star', 'Crown',
  'Briefcase', 'Building', 'Building2', 'Factory', 'Warehouse', 'Store',
  'Code', 'Wrench', 'Hammer', 'Calculator', 'ClipboardList', 'FileCheck',
  'Box', 'Package', 'Truck', 'ShoppingCart', 'Receipt', 'Wallet',
  'Microscope', 'Beaker', 'TestTube', 'Gauge', 'Target', 'Award',
  'Heart', 'Zap', 'Rocket', 'Globe', 'Compass', 'Map'
]

// Preset colors for teams
const TEAM_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b', '#78716c'
]

interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  last_sign_in: string | null
  teams?: { id: string; name: string; color: string; icon: string }[]
}

interface Vault {
  id: string
  name: string
  slug: string
  description: string | null
  storage_bucket: string
  is_default: boolean
  created_at: string
}

interface TeamWithDetails extends Team {
  member_count: number
  permissions_count: number
  vault_access?: string[] // vault IDs
}

interface PendingMember {
  id: string
  email: string
  full_name: string | null
  role: string
  team_ids: string[]
  created_at: string
  created_by: string | null
  notes: string | null
  claimed_at: string | null
}

export function TeamMembersSettings() {
  const { user, organization, addToast, getEffectiveRole } = usePDMStore()
  
  const isAdmin = getEffectiveRole() === 'admin'
  
  // Data state
  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [orgVaults, setOrgVaults] = useState<Vault[]>([])
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Team dialogs
  const [selectedTeam, setSelectedTeam] = useState<TeamWithDetails | null>(null)
  const [showCreateTeamDialog, setShowCreateTeamDialog] = useState(false)
  const [showEditTeamDialog, setShowEditTeamDialog] = useState(false)
  const [showDeleteTeamDialog, setShowDeleteTeamDialog] = useState(false)
  const [showTeamMembersDialog, setShowTeamMembersDialog] = useState(false)
  const [showTeamVaultAccessDialog, setShowTeamVaultAccessDialog] = useState(false)
  const [showPermissionsEditor, setShowPermissionsEditor] = useState(false)
  
  // Team form state
  const [teamFormData, setTeamFormData] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    icon: 'Users',
    is_default: false
  })
  const [isSavingTeam, setIsSavingTeam] = useState(false)
  const [copyFromTeamId, setCopyFromTeamId] = useState<string | null>(null)
  
  // User management state
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [showCreateUserDialog, setShowCreateUserDialog] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(null)
  const [removingUser, setRemovingUser] = useState<OrgUser | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [roleDropdownOpen, setRoleDropdownOpen] = useState<string | null>(null)
  
  // User vault access state
  const [vaultAccessMap, setVaultAccessMap] = useState<Record<string, string[]>>({})
  const [editingVaultAccessUser, setEditingVaultAccessUser] = useState<OrgUser | null>(null)
  const [pendingVaultAccess, setPendingVaultAccess] = useState<string[]>([])
  const [isSavingVaultAccess, setIsSavingVaultAccess] = useState(false)
  
  // Team vault access state
  const [teamVaultAccessMap, setTeamVaultAccessMap] = useState<Record<string, string[]>>({})
  const [pendingTeamVaultAccess, setPendingTeamVaultAccess] = useState<string[]>([])
  const [isSavingTeamVaultAccess, setIsSavingTeamVaultAccess] = useState(false)
  
  // User permissions state (for unassigned users)
  const [editingPermissionsUser, setEditingPermissionsUser] = useState<OrgUser | null>(null)
  
  // User profile modal
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)
  
  // Org code state
  const [showOrgCode, setShowOrgCode] = useState(false)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  
  // Expanded sections
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [showUnassignedUsers, setShowUnassignedUsers] = useState(true)
  const [showPendingMembers, setShowPendingMembers] = useState(true)
  
  // Load data on mount
  useEffect(() => {
    if (organization) {
      loadAllData()
    }
  }, [organization])
  
  const loadAllData = async () => {
    setIsLoading(true)
    try {
      await Promise.all([
        loadTeams(),
        loadOrgUsers(),
        loadOrgVaults(),
        loadVaultAccess(),
        loadTeamVaultAccess(),
        loadPendingMembers()
      ])
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadPendingMembers = async () => {
    if (!organization) return
    
    try {
      const { data, error } = await supabase
        .from('pending_org_members')
        .select('*')
        .eq('org_id', organization.id)
        .is('claimed_at', null)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setPendingMembers(data || [])
    } catch (err) {
      console.error('Failed to load pending members:', err)
    }
  }
  
  const loadTeams = async () => {
    if (!organization) return
    
    try {
      const { data: teamsData, error } = await supabase
        .from('teams')
        .select(`
          *,
          team_members(count),
          team_permissions(count)
        `)
        .eq('org_id', organization.id)
        .order('name')
      
      if (error) throw error
      
      const teamsWithCounts = (teamsData || []).map(team => ({
        ...team,
        member_count: team.team_members?.[0]?.count || 0,
        permissions_count: team.team_permissions?.[0]?.count || 0
      }))
      
      setTeams(teamsWithCounts)
    } catch (err) {
      console.error('Failed to load teams:', err)
      addToast('error', 'Failed to load teams')
    }
  }
  
  const loadOrgUsers = async () => {
    if (!organization) return
    
    try {
      const { data: usersData, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, role, last_sign_in')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (error) throw error
      
      // Load team memberships for all users
      const { data: membershipsData } = await supabase
        .from('team_members')
        .select(`
          user_id,
          team:teams(id, name, color, icon)
        `)
        .in('user_id', (usersData || []).map(u => u.id))
      
      // Map teams to users
      const usersWithTeams = (usersData || []).map(user => {
        const userMemberships = (membershipsData || []).filter(m => m.user_id === user.id)
        return {
          ...user,
          teams: userMemberships.map(m => m.team).filter(Boolean) as { id: string; name: string; color: string; icon: string }[]
        }
      })
      
      setOrgUsers(usersWithTeams)
    } catch (err) {
      console.error('Failed to load org users:', err)
    }
  }
  
  const loadOrgVaults = async () => {
    if (!organization) return
    
    try {
      const { data, error } = await supabase
        .from('vaults')
        .select('*')
        .eq('org_id', organization.id)
        .order('is_default', { ascending: false })
        .order('name')
      
      if (error) throw error
      setOrgVaults(data || [])
    } catch (err) {
      console.error('Failed to load org vaults:', err)
    }
  }
  
  const loadVaultAccess = async () => {
    if (!organization) return
    
    const { accessMap, error } = await getOrgVaultAccess(organization.id)
    if (error) {
      console.error('Failed to load vault access:', error)
    } else {
      setVaultAccessMap(accessMap)
    }
  }
  
  const loadTeamVaultAccess = async () => {
    if (!organization) return
    
    try {
      const { data, error } = await supabase
        .from('team_vault_access')
        .select('team_id, vault_id')
      
      if (error) throw error
      
      // Build team -> vault[] map
      const accessMap: Record<string, string[]> = {}
      for (const row of data || []) {
        if (!accessMap[row.team_id]) {
          accessMap[row.team_id] = []
        }
        accessMap[row.team_id].push(row.vault_id)
      }
      setTeamVaultAccessMap(accessMap)
    } catch (err) {
      console.error('Failed to load team vault access:', err)
    }
  }
  
  // Computed: users not in any team
  const unassignedUsers = useMemo(() => {
    return orgUsers.filter(u => !u.teams || u.teams.length === 0)
  }, [orgUsers])
  
  // Computed: users in teams
  const assignedUsers = useMemo(() => {
    return orgUsers.filter(u => u.teams && u.teams.length > 0)
  }, [orgUsers])
  
  // Filter by search
  const filteredUnassignedUsers = useMemo(() => {
    if (!searchQuery) return unassignedUsers
    const q = searchQuery.toLowerCase()
    return unassignedUsers.filter(u =>
      u.full_name?.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    )
  }, [unassignedUsers, searchQuery])
  
  const filteredTeams = useMemo(() => {
    if (!searchQuery) return teams
    const q = searchQuery.toLowerCase()
    return teams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q)
    )
  }, [teams, searchQuery])
  
  // Team CRUD operations
  const handleCreateTeam = async () => {
    if (!organization || !user || !teamFormData.name.trim()) return
    
    setIsSavingTeam(true)
    try {
      const { data, error } = await supabase
        .from('teams')
        .insert({
          org_id: organization.id,
          name: teamFormData.name.trim(),
          description: teamFormData.description.trim() || null,
          color: teamFormData.color,
          icon: teamFormData.icon,
          is_default: teamFormData.is_default,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      // If copying from an existing team, copy its permissions and vault access
      if (copyFromTeamId && data) {
        const { data: sourcePerms } = await supabase
          .from('team_permissions')
          .select('resource, actions')
          .eq('team_id', copyFromTeamId)
        
        if (sourcePerms && sourcePerms.length > 0) {
          await supabase.from('team_permissions').insert(
            sourcePerms.map(p => ({
              team_id: data.id,
              resource: p.resource,
              actions: p.actions,
              granted_by: user.id
            }))
          )
        }
        
        // Copy vault access
        const { data: sourceVaultAccess } = await supabase
          .from('team_vault_access')
          .select('vault_id')
          .eq('team_id', copyFromTeamId)
        
        if (sourceVaultAccess && sourceVaultAccess.length > 0) {
          await supabase.from('team_vault_access').insert(
            sourceVaultAccess.map(va => ({
              team_id: data.id,
              vault_id: va.vault_id,
              granted_by: user.id
            }))
          )
        }
        
        const sourceTeam = teams.find(t => t.id === copyFromTeamId)
        addToast('success', `Team "${teamFormData.name}" created (copied from ${sourceTeam?.name})`)
      } else {
        addToast('success', `Team "${teamFormData.name}" created`)
      }
      
      setShowCreateTeamDialog(false)
      resetTeamForm()
      loadTeams()
      loadTeamVaultAccess()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A team with this name already exists')
      } else {
        addToast('error', 'Failed to create team')
      }
    } finally {
      setIsSavingTeam(false)
    }
  }
  
  const handleUpdateTeam = async () => {
    if (!selectedTeam || !user || !teamFormData.name.trim()) return
    
    setIsSavingTeam(true)
    try {
      const { error } = await supabase
        .from('teams')
        .update({
          name: teamFormData.name.trim(),
          description: teamFormData.description.trim() || null,
          color: teamFormData.color,
          icon: teamFormData.icon,
          is_default: teamFormData.is_default,
          updated_at: new Date().toISOString(),
          updated_by: user.id
        })
        .eq('id', selectedTeam.id)
      
      if (error) throw error
      
      addToast('success', `Team "${teamFormData.name}" updated`)
      setShowEditTeamDialog(false)
      setSelectedTeam(null)
      resetTeamForm()
      loadTeams()
    } catch (err) {
      addToast('error', 'Failed to update team')
    } finally {
      setIsSavingTeam(false)
    }
  }
  
  const handleDeleteTeam = async () => {
    if (!selectedTeam) return
    
    setIsSavingTeam(true)
    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', selectedTeam.id)
      
      if (error) throw error
      
      addToast('success', `Team "${selectedTeam.name}" deleted`)
      setShowDeleteTeamDialog(false)
      setSelectedTeam(null)
      loadTeams()
      loadOrgUsers() // Refresh to update team memberships
    } catch (err) {
      addToast('error', 'Failed to delete team')
    } finally {
      setIsSavingTeam(false)
    }
  }
  
  const resetTeamForm = () => {
    setTeamFormData({
      name: '',
      description: '',
      color: '#3b82f6',
      icon: 'Users',
      is_default: false
    })
    setCopyFromTeamId(null)
  }
  
  const openEditTeamDialog = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setTeamFormData({
      name: team.name,
      description: team.description || '',
      color: team.color,
      icon: team.icon,
      is_default: team.is_default
    })
    setShowEditTeamDialog(true)
  }
  
  // Team vault access
  const openTeamVaultAccessDialog = (team: TeamWithDetails) => {
    setSelectedTeam(team)
    setPendingTeamVaultAccess(teamVaultAccessMap[team.id] || [])
    setShowTeamVaultAccessDialog(true)
  }
  
  const handleSaveTeamVaultAccess = async () => {
    if (!selectedTeam || !user) return
    
    setIsSavingTeamVaultAccess(true)
    try {
      // Delete existing access
      await supabase
        .from('team_vault_access')
        .delete()
        .eq('team_id', selectedTeam.id)
      
      // Insert new access
      if (pendingTeamVaultAccess.length > 0) {
        await supabase.from('team_vault_access').insert(
          pendingTeamVaultAccess.map(vaultId => ({
            team_id: selectedTeam.id,
            vault_id: vaultId,
            granted_by: user.id
          }))
        )
      }
      
      addToast('success', `Updated vault access for ${selectedTeam.name}`)
      setShowTeamVaultAccessDialog(false)
      setSelectedTeam(null)
      loadTeamVaultAccess()
    } catch (err) {
      addToast('error', 'Failed to update vault access')
    } finally {
      setIsSavingTeamVaultAccess(false)
    }
  }
  
  // User management
  const generateInviteMessage = () => {
    const config = getCurrentConfig()
    if (!config || !organization) return ''
    
    const code = generateOrgCode(config)
    return `You've been invited to join ${organization.name} on BluePLM!

BluePLM is a Product Lifecycle Management tool for everyone who builds.

To get started:
1. Download BluePLM from: https://github.com/bluerobotics/bluePLM/releases
2. Install and open the app
3. When prompted, enter this organization code:

${code}

4. Sign in with your Google account

See you on the team!`
  }
  
  const handleCopyInvite = async () => {
    const message = generateInviteMessage()
    try {
      await navigator.clipboard.writeText(message)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
      addToast('success', 'Invite copied! Paste it in an email to send.')
    } catch {
      addToast('error', 'Failed to copy invite')
    }
  }
  
  const handleChangeRole = async (targetUser: OrgUser, newRole: 'admin' | 'engineer' | 'viewer') => {
    if (!organization || targetUser.role === newRole) {
      setRoleDropdownOpen(null)
      return
    }
    
    setChangingRoleUserId(targetUser.id)
    try {
      const result = await updateUserRole(targetUser.id, newRole, organization.id)
      if (result.success) {
        addToast('success', `Changed ${targetUser.full_name || targetUser.email}'s role to ${newRole}`)
        setOrgUsers(orgUsers.map(u => 
          u.id === targetUser.id ? { ...u, role: newRole } : u
        ))
      } else {
        addToast('error', result.error || 'Failed to change role')
      }
    } catch {
      addToast('error', 'Failed to change role')
    } finally {
      setChangingRoleUserId(null)
      setRoleDropdownOpen(null)
    }
  }
  
  const handleRemoveUser = async () => {
    if (!removingUser || !organization) return
    
    setIsRemoving(true)
    try {
      const result = await removeUserFromOrg(removingUser.id, organization.id)
      if (result.success) {
        addToast('success', `Removed ${removingUser.full_name || removingUser.email} from organization`)
        setOrgUsers(orgUsers.filter(u => u.id !== removingUser.id))
        setRemovingUser(null)
      } else {
        addToast('error', result.error || 'Failed to remove user')
      }
    } catch {
      addToast('error', 'Failed to remove user')
    } finally {
      setIsRemoving(false)
    }
  }
  
  // User vault access
  const getUserVaultAccessCount = (userId: string) => {
    let count = 0
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        count++
      }
    }
    return count
  }
  
  const getUserAccessibleVaults = (userId: string) => {
    const accessibleVaultIds: string[] = []
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        accessibleVaultIds.push(vaultId)
      }
    }
    return accessibleVaultIds
  }
  
  const openVaultAccessEditor = (targetUser: OrgUser) => {
    setEditingVaultAccessUser(targetUser)
    setPendingVaultAccess(getUserAccessibleVaults(targetUser.id))
  }
  
  const handleSaveVaultAccess = async () => {
    if (!editingVaultAccessUser || !user || !organization) return
    
    setIsSavingVaultAccess(true)
    try {
      const result = await setUserVaultAccess(
        editingVaultAccessUser.id,
        pendingVaultAccess,
        user.id,
        organization.id
      )
      
      if (result.success) {
        addToast('success', `Updated vault access for ${editingVaultAccessUser.full_name || editingVaultAccessUser.email}`)
        await loadVaultAccess()
        setEditingVaultAccessUser(null)
      } else {
        addToast('error', result.error || 'Failed to update vault access')
      }
    } catch {
      addToast('error', 'Failed to update vault access')
    } finally {
      setIsSavingVaultAccess(false)
    }
  }
  
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return Shield
      case 'engineer': return Wrench
      case 'viewer': return Eye
      default: return Eye
    }
  }
  
  const toggleTeamExpand = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) {
        next.delete(teamId)
      } else {
        next.add(teamId)
      }
      return next
    })
  }
  
  if (!organization) {
    return (
      <div className="text-center py-12 text-plm-fg-muted text-base">
        No organization connected
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-plm-fg flex items-center gap-2">
            <UsersRound size={22} />
            Members & Teams
          </h2>
          <p className="text-sm text-plm-fg-muted mt-1">
            Organize members into teams and manage permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAllData}
            disabled={isLoading}
            className="btn btn-ghost btn-sm flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setShowInviteDialog(true)}
                className="btn btn-ghost btn-sm flex items-center gap-1"
                title="Send invite code"
              >
                <Mail size={14} />
                Invite
              </button>
              <button
                onClick={() => setShowCreateUserDialog(true)}
                className="btn btn-ghost btn-sm flex items-center gap-1"
                title="Pre-create user account"
              >
                <UserPlus size={14} />
                Add User
              </button>
              <button
                onClick={() => {
                  resetTeamForm()
                  setShowCreateTeamDialog(true)
                }}
                className="btn btn-primary btn-sm flex items-center gap-2"
              >
                <Plus size={16} />
                Create Team
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search teams or members..."
          className="w-full pl-10 pr-4 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
        />
      </div>
      
      {/* Organization Code (Admin only) */}
      {isAdmin && (
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center gap-2 mb-2">
            <Key size={16} className="text-plm-accent" />
            <h3 className="text-sm font-medium text-plm-fg">Organization Code</h3>
          </div>
          {showOrgCode && orgCode ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-plm-bg-secondary border border-plm-border rounded px-3 py-1.5 font-mono text-plm-fg truncate">
                {orgCode}
              </code>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(orgCode)
                  setCodeCopied(true)
                  setTimeout(() => setCodeCopied(false), 2000)
                }}
                className="btn btn-ghost btn-sm"
              >
                {codeCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
              <button onClick={() => setShowOrgCode(false)} className="text-sm text-plm-fg-muted hover:text-plm-fg">
                Hide
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                const config = getCurrentConfig()
                if (config) {
                  setOrgCode(generateOrgCode(config))
                  setShowOrgCode(true)
                }
              }}
              className="text-sm text-plm-accent hover:underline"
            >
              Show organization code
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Teams Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-plm-fg-muted uppercase tracking-wide flex items-center gap-2">
              <Users size={14} />
              Teams ({teams.length})
            </h3>
            
            {filteredTeams.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-plm-border rounded-lg">
                <Users size={36} className="mx-auto text-plm-fg-muted mb-3 opacity-50" />
                <p className="text-sm text-plm-fg-muted mb-4">No teams yet</p>
                {isAdmin && (
                  <button
                    onClick={() => {
                      resetTeamForm()
                      setShowCreateTeamDialog(true)
                    }}
                    className="btn btn-primary btn-sm"
                  >
                    <Plus size={14} className="mr-1" />
                    Create First Team
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTeams.map(team => {
                  const IconComponent = (LucideIcons as any)[team.icon] || Users
                  const isExpanded = expandedTeams.has(team.id)
                  const teamMembers = orgUsers.filter(u => u.teams?.some(t => t.id === team.id))
                  const teamVaults = teamVaultAccessMap[team.id] || []
                  
                  return (
                    <div
                      key={team.id}
                      className="border border-plm-border rounded-lg overflow-hidden bg-plm-bg/50"
                    >
                      {/* Team Header */}
                      <div
                        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-plm-highlight/50 transition-colors"
                        onClick={() => toggleTeamExpand(team.id)}
                      >
                        <div
                          className="p-2 rounded-lg"
                          style={{ backgroundColor: `${team.color}20`, color: team.color }}
                        >
                          <IconComponent size={18} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-plm-fg truncate">{team.name}</h4>
                            {team.is_default && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent uppercase">
                                Default
                              </span>
                            )}
                            {team.is_system && (
                              <Crown size={12} className="text-yellow-500" />
                            )}
                          </div>
                          <div className="text-xs text-plm-fg-muted flex items-center gap-3">
                            <span>{team.member_count} member{team.member_count !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>{team.permissions_count} permission{team.permissions_count !== 1 ? 's' : ''}</span>
                            {teamVaults.length > 0 && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Database size={10} />
                                  {teamVaults.length} vault{teamVaults.length !== 1 ? 's' : ''}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        
                        {isExpanded ? (
                          <ChevronDown size={18} className="text-plm-fg-muted" />
                        ) : (
                          <ChevronRight size={18} className="text-plm-fg-muted" />
                        )}
                      </div>
                      
                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="border-t border-plm-border">
                          {/* Team Actions */}
                          {isAdmin && !team.is_system && (
                            <div className="p-3 bg-plm-bg/30 border-b border-plm-border flex flex-wrap gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedTeam(team)
                                  setShowTeamMembersDialog(true)
                                }}
                                className="btn btn-ghost btn-sm flex items-center gap-1.5"
                              >
                                <UserPlus size={14} />
                                Manage Members
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedTeam(team)
                                  setShowPermissionsEditor(true)
                                }}
                                className="btn btn-ghost btn-sm flex items-center gap-1.5"
                              >
                                <Shield size={14} />
                                Permissions
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openTeamVaultAccessDialog(team)
                                }}
                                className="btn btn-ghost btn-sm flex items-center gap-1.5"
                              >
                                <Database size={14} />
                                Vault Access
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEditTeamDialog(team)
                                }}
                                className="btn btn-ghost btn-sm flex items-center gap-1.5"
                              >
                                <Pencil size={14} />
                                Edit
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedTeam(team)
                                  setShowDeleteTeamDialog(true)
                                }}
                                className="btn btn-ghost btn-sm flex items-center gap-1.5 text-plm-error hover:bg-plm-error/10"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          )}
                          
                          {/* Team Members List */}
                          <div className="p-3">
                            {teamMembers.length === 0 ? (
                              <p className="text-sm text-plm-fg-muted text-center py-4">
                                No members in this team
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {teamMembers.map(member => (
                                  <UserRow
                                    key={member.id}
                                    user={member}
                                    isAdmin={isAdmin}
                                    isCurrentUser={member.id === user?.id}
                                    getRoleIcon={getRoleIcon}
                                    onViewProfile={() => setViewingUserId(member.id)}
                                    onChangeRole={handleChangeRole}
                                    onRemove={() => setRemovingUser(member)}
                                    onVaultAccess={() => openVaultAccessEditor(member)}
                                    roleDropdownOpen={roleDropdownOpen}
                                    setRoleDropdownOpen={setRoleDropdownOpen}
                                    changingRoleUserId={changingRoleUserId}
                                    vaultAccessCount={getUserVaultAccessCount(member.id)}
                                    compact
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          
          {/* Unassigned Users Section */}
          <div className="space-y-3">
            <button
              onClick={() => setShowUnassignedUsers(!showUnassignedUsers)}
              className="w-full flex items-center justify-between text-sm font-medium text-plm-fg-muted uppercase tracking-wide hover:text-plm-fg transition-colors"
            >
              <span className="flex items-center gap-2">
                <UserX size={14} />
                Unassigned Users ({unassignedUsers.length})
              </span>
              {showUnassignedUsers ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            
            {showUnassignedUsers && (
              <>
                {filteredUnassignedUsers.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-plm-border rounded-lg">
                    <Check size={24} className="mx-auto text-plm-success mb-2" />
                    <p className="text-sm text-plm-fg-muted">
                      {unassignedUsers.length === 0 
                        ? 'All users are assigned to teams'
                        : 'No unassigned users match your search'
                      }
                    </p>
                  </div>
                ) : (
                  <div className="border border-plm-border rounded-lg overflow-hidden bg-plm-bg/50">
                    <div className="p-3 border-b border-plm-border bg-plm-bg/30">
                      <p className="text-xs text-plm-fg-muted">
                        {isAdmin 
                          ? 'These users are not in any team. You can assign them to teams or set individual permissions. Individual permissions are additive—users get the union of all team + individual permissions (highest level wins).'
                          : 'These users are not assigned to any team.'
                        }
                      </p>
                    </div>
                    <div className="divide-y divide-plm-border/50">
                      {filteredUnassignedUsers.map(u => (
                        <UserRow
                          key={u.id}
                          user={u}
                          isAdmin={isAdmin}
                          isCurrentUser={u.id === user?.id}
                          getRoleIcon={getRoleIcon}
                          onViewProfile={() => setViewingUserId(u.id)}
                          onChangeRole={handleChangeRole}
                          onRemove={() => setRemovingUser(u)}
                          onVaultAccess={() => openVaultAccessEditor(u)}
                          onPermissions={isAdmin ? () => setEditingPermissionsUser(u) : undefined}
                          roleDropdownOpen={roleDropdownOpen}
                          setRoleDropdownOpen={setRoleDropdownOpen}
                          changingRoleUserId={changingRoleUserId}
                          vaultAccessCount={getUserVaultAccessCount(u.id)}
                          showAddToTeam={isAdmin && teams.length > 0}
                          teams={teams}
                          onAddToTeam={async (teamId) => {
                            try {
                              await supabase.from('team_members').insert({
                                team_id: teamId,
                                user_id: u.id,
                                added_by: user?.id
                              })
                              addToast('success', `Added ${u.full_name || u.email} to team`)
                              loadOrgUsers()
                              loadTeams()
                            } catch (err) {
                              addToast('error', 'Failed to add user to team')
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          {/* Pending Members Section (pre-created accounts) */}
          {isAdmin && pendingMembers.length > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setShowPendingMembers(!showPendingMembers)}
                className="w-full flex items-center justify-between text-sm font-medium text-plm-fg-muted uppercase tracking-wide hover:text-plm-fg transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Clock size={14} />
                  Pending Members ({pendingMembers.length})
                </span>
                {showPendingMembers ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              
              {showPendingMembers && (
                <div className="border border-plm-border rounded-lg overflow-hidden bg-plm-bg/50">
                  <div className="p-3 border-b border-plm-border bg-plm-bg/30">
                    <p className="text-xs text-plm-fg-muted">
                      Pre-created accounts waiting for users to sign in. They will automatically join the org with assigned teams.
                    </p>
                  </div>
                  <div className="divide-y divide-plm-border/50">
                    {pendingMembers.map(pm => (
                      <div key={pm.id} className="flex items-center gap-3 p-3 group">
                        <div className="w-10 h-10 rounded-full bg-plm-fg-muted/10 flex items-center justify-center">
                          <Clock size={18} className="text-plm-fg-muted" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-base text-plm-fg truncate flex items-center gap-2">
                            {pm.full_name || pm.email}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 uppercase">
                              Pending
                            </span>
                          </div>
                          <div className="text-sm text-plm-fg-muted truncate flex items-center gap-2">
                            <span>{pm.email}</span>
                            {pm.team_ids.length > 0 && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-plm-fg-muted/10 rounded text-plm-fg-dim">
                                <Users size={10} />
                                {pm.team_ids.length} team{pm.team_ids.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={`px-2 py-1 rounded text-xs ${
                          pm.role === 'admin' ? 'bg-plm-accent/20 text-plm-accent' :
                          pm.role === 'engineer' ? 'bg-plm-success/20 text-plm-success' :
                          'bg-plm-fg-muted/20 text-plm-fg-muted'
                        }`}>
                          {pm.role.charAt(0).toUpperCase() + pm.role.slice(1)}
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await supabase.from('pending_org_members').delete().eq('id', pm.id)
                              addToast('success', `Removed pending member ${pm.email}`)
                              loadPendingMembers()
                            } catch {
                              addToast('error', 'Failed to remove pending member')
                            }
                          }}
                          className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                          title="Remove pending member"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      
      {/* Create Team Dialog */}
      {showCreateTeamDialog && (
        <TeamFormDialog
          title="Create Team"
          formData={teamFormData}
          setFormData={setTeamFormData}
          onSave={handleCreateTeam}
          onCancel={() => setShowCreateTeamDialog(false)}
          isSaving={isSavingTeam}
          existingTeams={teams}
          copyFromTeamId={copyFromTeamId}
          setCopyFromTeamId={setCopyFromTeamId}
        />
      )}

      {/* Edit Team Dialog */}
      {showEditTeamDialog && selectedTeam && (
        <TeamFormDialog
          title="Edit Team"
          formData={teamFormData}
          setFormData={setTeamFormData}
          onSave={handleUpdateTeam}
          onCancel={() => {
            setShowEditTeamDialog(false)
            setSelectedTeam(null)
          }}
          isSaving={isSavingTeam}
        />
      )}

      {/* Delete Team Dialog */}
      {showDeleteTeamDialog && selectedTeam && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowDeleteTeamDialog(false)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Delete Team</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Are you sure you want to delete <strong>{selectedTeam.name}</strong>? This will remove all {selectedTeam.member_count} members from the team and delete all associated permissions.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteTeamDialog(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={isSavingTeam}
                className="btn bg-plm-error text-white hover:bg-plm-error/90"
              >
                {isSavingTeam ? 'Deleting...' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team Members Dialog */}
      {showTeamMembersDialog && selectedTeam && (
        <TeamMembersDialog
          team={selectedTeam}
          orgUsers={orgUsers}
          onClose={() => {
            setShowTeamMembersDialog(false)
            setSelectedTeam(null)
            loadTeams()
            loadOrgUsers()
          }}
          userId={user?.id}
        />
      )}

      {/* Team Vault Access Dialog */}
      {showTeamVaultAccessDialog && selectedTeam && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowTeamVaultAccessDialog(false)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-2 flex items-center gap-2">
              <Database size={18} className="text-plm-accent" />
              Vault Access - {selectedTeam.name}
            </h3>
            <p className="text-sm text-plm-fg-muted mb-4">
              Select which vaults this team can access.
            </p>
            
            {/* All vaults indicator */}
            <div className={`p-3 rounded-lg border mb-3 ${
              pendingTeamVaultAccess.length === 0
                ? 'bg-plm-success/10 border-plm-success/30'
                : 'bg-plm-bg border-plm-border'
            }`}>
              <div className="flex items-center gap-2">
                <Database size={16} className={pendingTeamVaultAccess.length === 0 ? 'text-plm-success' : 'text-plm-fg-muted'} />
                <span className={`text-sm ${pendingTeamVaultAccess.length === 0 ? 'text-plm-success' : 'text-plm-fg-muted'}`}>
                  {pendingTeamVaultAccess.length === 0 
                    ? 'All vaults (no restrictions)' 
                    : `${pendingTeamVaultAccess.length} of ${orgVaults.length} vaults selected`}
                </span>
              </div>
              {pendingTeamVaultAccess.length === 0 && (
                <p className="text-xs text-plm-fg-muted mt-1 ml-6">
                  By default, teams have access to all organization vaults
                </p>
              )}
            </div>
            
            <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
              {orgVaults.map(vault => (
                <label key={vault.id} className="flex items-center gap-3 p-2 hover:bg-plm-highlight rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pendingTeamVaultAccess.includes(vault.id)}
                    onChange={() => {
                      setPendingTeamVaultAccess(current =>
                        current.includes(vault.id)
                          ? current.filter(id => id !== vault.id)
                          : [...current, vault.id]
                      )
                    }}
                    className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <Folder size={18} className={vault.is_default ? 'text-plm-accent' : 'text-plm-fg-muted'} />
                  <span className="text-base text-plm-fg">{vault.name}</span>
                  {vault.is_default && (
                    <span className="text-xs text-plm-accent">(default)</span>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-plm-fg-dim mb-4">
              Select specific vaults to restrict access, or leave all unchecked for full access to all vaults.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowTeamVaultAccessDialog(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleSaveTeamVaultAccess}
                disabled={isSavingTeamVaultAccess}
                className="btn btn-primary"
              >
                {isSavingTeamVaultAccess ? 'Saving...' : 'Save Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Editor */}
      {showPermissionsEditor && selectedTeam && (
        <PermissionsEditor
          team={selectedTeam}
          onClose={() => {
            setShowPermissionsEditor(false)
            setSelectedTeam(null)
            loadTeams()
          }}
          userId={user?.id}
          isAdmin={isAdmin}
        />
      )}

      {/* User Permissions Editor (for unassigned users) */}
      {editingPermissionsUser && (
        <UserPermissionsDialog
          user={editingPermissionsUser}
          onClose={() => setEditingPermissionsUser(null)}
          currentUserId={user?.id}
        />
      )}
      
      {/* Create User Dialog (pre-create account) */}
      {showCreateUserDialog && organization && (
        <CreateUserDialog
          onClose={() => setShowCreateUserDialog(false)}
          onCreated={() => loadPendingMembers()}
          teams={teams}
          orgId={organization.id}
          currentUserId={user?.id}
        />
      )}

      {/* User Vault Access Dialog */}
      {editingVaultAccessUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditingVaultAccessUser(null)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-2">Vault Access</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Select which vaults <strong>{editingVaultAccessUser.full_name || editingVaultAccessUser.email}</strong> can access.
            </p>
            
            {/* All vaults indicator */}
            <div className={`p-3 rounded-lg border mb-3 ${
              pendingVaultAccess.length === 0
                ? 'bg-plm-success/10 border-plm-success/30'
                : 'bg-plm-bg border-plm-border'
            }`}>
              <div className="flex items-center gap-2">
                <Database size={16} className={pendingVaultAccess.length === 0 ? 'text-plm-success' : 'text-plm-fg-muted'} />
                <span className={`text-sm ${pendingVaultAccess.length === 0 ? 'text-plm-success' : 'text-plm-fg-muted'}`}>
                  {pendingVaultAccess.length === 0 
                    ? 'All vaults (no restrictions)' 
                    : `${pendingVaultAccess.length} of ${orgVaults.length} vaults selected`}
                </span>
              </div>
              {pendingVaultAccess.length === 0 && (
                <p className="text-xs text-plm-fg-muted mt-1 ml-6">
                  By default, users have access to all organization vaults
                </p>
              )}
            </div>
            
            <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
              {orgVaults.map(vault => (
                <label key={vault.id} className="flex items-center gap-3 p-2 hover:bg-plm-highlight rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pendingVaultAccess.includes(vault.id)}
                    onChange={() => {
                      setPendingVaultAccess(current =>
                        current.includes(vault.id)
                          ? current.filter(id => id !== vault.id)
                          : [...current, vault.id]
                      )
                    }}
                    className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <Folder size={18} className={vault.is_default ? 'text-plm-accent' : 'text-plm-fg-muted'} />
                  <span className="text-base text-plm-fg">{vault.name}</span>
                  {vault.is_default && (
                    <span className="text-xs text-plm-accent">(default)</span>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-plm-fg-dim mb-4">
              Select specific vaults to restrict access, or leave all unchecked for full access to all vaults.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingVaultAccessUser(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleSaveVaultAccess}
                disabled={isSavingVaultAccess}
                className="btn btn-primary"
              >
                {isSavingVaultAccess ? 'Saving...' : 'Save Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove User Dialog */}
      {removingUser && (
        <RemoveUserDialog
          user={removingUser}
          onClose={() => setRemovingUser(null)}
          onConfirm={handleRemoveUser}
          isRemoving={isRemoving}
        />
      )}

      {/* Invite Dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowInviteDialog(false)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Invite User</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Copy the invite message below and send it to your team member via email or chat.
            </p>
            <div className="bg-plm-bg border border-plm-border rounded-lg p-4 text-base text-plm-fg-muted font-mono whitespace-pre-wrap max-h-60 overflow-y-auto mb-4">
              {generateInviteMessage()}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowInviteDialog(false)} className="btn btn-ghost">
                Close
              </button>
              <button onClick={handleCopyInvite} className="btn btn-primary flex items-center gap-2">
                {inviteCopied ? <Check size={14} /> : <Copy size={14} />}
                {inviteCopied ? 'Copied!' : 'Copy Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Profile Modal */}
      {viewingUserId && (
        <UserProfileModal
          userId={viewingUserId}
          onClose={() => setViewingUserId(null)}
        />
      )}
    </div>
  )
}

// User Row Component
function UserRow({
  user,
  isAdmin,
  isCurrentUser,
  getRoleIcon,
  onViewProfile,
  onChangeRole,
  onRemove,
  onVaultAccess,
  onPermissions,
  roleDropdownOpen,
  setRoleDropdownOpen,
  changingRoleUserId,
  vaultAccessCount,
  compact,
  showAddToTeam,
  teams,
  onAddToTeam
}: {
  user: OrgUser
  isAdmin: boolean
  isCurrentUser: boolean
  getRoleIcon: (role: string) => any
  onViewProfile: () => void
  onChangeRole: (user: OrgUser, role: 'admin' | 'engineer' | 'viewer') => void
  onRemove: () => void
  onVaultAccess: () => void
  onPermissions?: () => void
  roleDropdownOpen: string | null
  setRoleDropdownOpen: (id: string | null) => void
  changingRoleUserId: string | null
  vaultAccessCount: number
  compact?: boolean
  showAddToTeam?: boolean
  teams?: TeamWithDetails[]
  onAddToTeam?: (teamId: string) => void
}) {
  const [showAddTeamDropdown, setShowAddTeamDropdown] = useState(false)
  const RoleIcon = getRoleIcon(user.role)
  const canManage = isAdmin && !isCurrentUser
  
  return (
    <div className={`flex items-center gap-3 ${compact ? 'py-2 px-1' : 'p-3'} rounded-lg hover:bg-plm-highlight transition-colors group`}>
      <button
        onClick={onViewProfile}
        className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
      >
        {user.avatar_url ? (
          <img 
            src={user.avatar_url} 
            alt=""
            className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full`}
          />
        ) : (
          <div className={`${compact ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'} rounded-full bg-plm-fg-muted/20 flex items-center justify-center font-medium`}>
            {getInitials(user.full_name || user.email)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={`${compact ? 'text-sm' : 'text-base'} text-plm-fg truncate flex items-center gap-2`}>
            {user.full_name || user.email}
            {isCurrentUser && (
              <span className="text-xs text-plm-fg-dim">(you)</span>
            )}
          </div>
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-plm-fg-muted truncate flex items-center gap-2`}>
            <span className="truncate">{user.email}</span>
            {user.role !== 'admin' && vaultAccessCount > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-plm-fg-muted/10 rounded text-plm-fg-dim">
                <Lock size={10} />
                {vaultAccessCount}
              </span>
            )}
          </div>
        </div>
      </button>
      
      {/* Role badge/dropdown */}
      <div className="relative">
        {canManage ? (
          <>
            <button
              onClick={() => setRoleDropdownOpen(roleDropdownOpen === user.id ? null : user.id)}
              disabled={changingRoleUserId === user.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                user.role === 'admin' ? 'bg-plm-accent/20 text-plm-accent' :
                user.role === 'engineer' ? 'bg-plm-success/20 text-plm-success' :
                'bg-plm-fg-muted/20 text-plm-fg-muted'
              } hover:opacity-80`}
            >
              {changingRoleUserId === user.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RoleIcon size={12} />
              )}
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              <ChevronDown size={12} />
            </button>
            
            {roleDropdownOpen === user.id && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[120px]">
                {(['viewer', 'engineer', 'admin'] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => onChangeRole(user, role)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors hover:bg-plm-highlight ${
                      user.role === role ? 'text-plm-accent' : 'text-plm-fg'
                    }`}
                  >
                    {role === 'admin' && <Shield size={14} />}
                    {role === 'engineer' && <Wrench size={14} />}
                    {role === 'viewer' && <Eye size={14} />}
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                    {user.role === role && <Check size={14} className="ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            user.role === 'admin' ? 'bg-plm-accent/20 text-plm-accent' :
            user.role === 'engineer' ? 'bg-plm-success/20 text-plm-success' :
            'bg-plm-fg-muted/20 text-plm-fg-muted'
          }`}>
            <RoleIcon size={12} />
            {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
          </div>
        )}
      </div>
      
      {/* Action buttons */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Add to team button */}
        {showAddToTeam && teams && onAddToTeam && (
          <div className="relative">
            <button
              onClick={() => setShowAddTeamDropdown(!showAddTeamDropdown)}
              className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors"
              title="Add to team"
            >
              <UserPlus size={14} />
            </button>
            {showAddTeamDropdown && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[160px]">
                {teams.map(team => {
                  const TeamIcon = (LucideIcons as any)[team.icon] || Users
                  return (
                    <button
                      key={team.id}
                      onClick={() => {
                        onAddToTeam(team.id)
                        setShowAddTeamDropdown(false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors"
                    >
                      <div
                        className="p-1 rounded"
                        style={{ backgroundColor: `${team.color}15`, color: team.color }}
                      >
                        <TeamIcon size={12} />
                      </div>
                      <span className="text-plm-fg truncate">{team.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        
        {/* Individual permissions button (for unassigned users) */}
        {onPermissions && canManage && (
          <button
            onClick={onPermissions}
            className="p-1.5 text-plm-fg-muted hover:text-purple-400 hover:bg-purple-500/10 rounded transition-colors"
            title="Individual permissions"
          >
            <Shield size={14} />
          </button>
        )}
        
        {/* Vault access button */}
        {canManage && (
          <button
            onClick={onVaultAccess}
            className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors"
            title="Vault access"
          >
            <Lock size={14} />
          </button>
        )}
        
        {/* Remove button */}
        {canManage && (
          <button
            onClick={onRemove}
            className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
            title="Remove from organization"
          >
            <UserMinus size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// Team Form Dialog Component
function TeamFormDialog({
  title,
  formData,
  setFormData,
  onSave,
  onCancel,
  isSaving,
  existingTeams,
  copyFromTeamId,
  setCopyFromTeamId
}: {
  title: string
  formData: { name: string; description: string; color: string; icon: string; is_default: boolean }
  setFormData: (data: any) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  existingTeams?: TeamWithDetails[]
  copyFromTeamId?: string | null
  setCopyFromTeamId?: (id: string | null) => void
}) {
  const [showIconPicker, setShowIconPicker] = useState(false)
  const IconComponent = (LucideIcons as any)[formData.icon] || Users
  const isCreating = title === 'Create Team'
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-plm-fg mb-6">{title}</h3>
        
        <div className="space-y-4">
          {/* Copy from existing team */}
          {isCreating && existingTeams && existingTeams.length > 0 && setCopyFromTeamId && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                <Copy size={12} className="inline mr-1" />
                Copy from Existing Team
              </label>
              <select
                value={copyFromTeamId || ''}
                onChange={e => {
                  const teamId = e.target.value || null
                  setCopyFromTeamId(teamId)
                  if (teamId && existingTeams) {
                    const sourceTeam = existingTeams.find(t => t.id === teamId)
                    if (sourceTeam) {
                      setFormData({
                        ...formData,
                        color: sourceTeam.color,
                        icon: sourceTeam.icon
                      })
                    }
                  }
                }}
                className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg focus:outline-none focus:border-plm-accent"
              >
                <option value="">Start fresh (no copy)</option>
                {existingTeams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.member_count} members, {team.permissions_count} permissions)
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Name */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Team Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Engineering, Accounting, Quality"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this team's purpose..."
              rows={2}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent resize-none"
            />
          </div>
          
          {/* Color & Icon */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Color</label>
              <div className="grid grid-cols-6 gap-1.5 p-2 bg-plm-bg border border-plm-border rounded-lg">
                {TEAM_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setFormData({ ...formData, color })}
                    className={`w-6 h-6 rounded-md transition-all ${
                      formData.color === color ? 'ring-2 ring-plm-fg ring-offset-2 ring-offset-plm-bg scale-110' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Icon</label>
              <div className="relative">
                <button
                  onClick={() => setShowIconPicker(!showIconPicker)}
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg flex items-center gap-2 hover:border-plm-accent transition-colors"
                  style={{ color: formData.color }}
                >
                  <IconComponent size={18} />
                  <span className="text-plm-fg text-sm">{formData.icon}</span>
                  <ChevronDown size={14} className="ml-auto text-plm-fg-muted" />
                </button>
                
                {showIconPicker && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-plm-bg border border-plm-border rounded-lg shadow-xl p-2 max-h-48 overflow-y-auto">
                    <div className="grid grid-cols-6 gap-1">
                      {TEAM_ICONS.map(iconName => {
                        const Icon = (LucideIcons as any)[iconName]
                        return (
                          <button
                            key={iconName}
                            onClick={() => {
                              setFormData({ ...formData, icon: iconName })
                              setShowIconPicker(false)
                            }}
                            className={`p-2 rounded-lg transition-colors ${
                              formData.icon === iconName
                                ? 'bg-plm-accent/20 text-plm-accent'
                                : 'hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg'
                            }`}
                            title={iconName}
                          >
                            <Icon size={16} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Default team toggle */}
          <label className="flex items-center gap-3 p-3 bg-plm-bg border border-plm-border rounded-lg cursor-pointer hover:border-plm-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={formData.is_default}
              onChange={e => setFormData({ ...formData, is_default: e.target.checked })}
              className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
            />
            <div>
              <div className="text-sm text-plm-fg font-medium">Default Team</div>
              <div className="text-xs text-plm-fg-muted">New users will automatically be added to this team</div>
            </div>
          </label>
        </div>
        
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button
            onClick={onSave}
            disabled={isSaving || !formData.name.trim()}
            className="btn btn-primary"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isCreating ? 'Create Team' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Team Members Dialog
function TeamMembersDialog({
  team,
  orgUsers,
  onClose,
  userId
}: {
  team: TeamWithDetails
  orgUsers: OrgUser[]
  onClose: () => void
  userId?: string
}) {
  const { addToast } = usePDMStore()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  
  useEffect(() => {
    loadMembers()
  }, [team.id])
  
  const loadMembers = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          id, team_id, user_id, is_team_admin, added_at, added_by,
          users!user_id (id, email, full_name, avatar_url, role)
        `)
        .eq('team_id', team.id)
        .order('added_at', { ascending: false })
      
      if (error) throw error
      
      const mappedData = (data || []).map(m => ({
        ...m,
        user: m.users
      }))
      
      setMembers(mappedData)
    } catch (err) {
      console.error('Failed to load team members:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const memberUserIds = members.map(m => m.user_id)
  const availableUsers = orgUsers.filter(u => !memberUserIds.includes(u.id))
  const filteredUsers = availableUsers.filter(u =>
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  const addMember = async (userToAdd: OrgUser) => {
    if (!userId) return
    
    setIsAdding(true)
    try {
      const { error } = await supabase.from('team_members').insert({
        team_id: team.id,
        user_id: userToAdd.id,
        added_by: userId
      })
      
      if (error) throw error
      
      addToast('success', `Added ${userToAdd.full_name || userToAdd.email} to team`)
      loadMembers()
    } catch (err) {
      addToast('error', 'Failed to add member')
    } finally {
      setIsAdding(false)
    }
  }
  
  const removeMember = async (member: TeamMember) => {
    try {
      const { error } = await supabase.from('team_members').delete().eq('id', member.id)
      if (error) throw error
      
      addToast('success', `Removed ${member.user?.full_name || member.user?.email} from team`)
      loadMembers()
    } catch (err) {
      addToast('error', 'Failed to remove member')
    }
  }
  
  const IconComponent = (LucideIcons as any)[team.icon] || Users
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: `${team.color}20`, color: team.color }}
          >
            <IconComponent size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-plm-fg">{team.name} - Members</h3>
            <p className="text-sm text-plm-fg-muted">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 text-plm-fg-muted hover:text-plm-fg rounded">
            <X size={18} />
          </button>
        </div>
        
        {/* Add member section */}
        <div className="p-4 border-b border-plm-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-plm-fg flex items-center gap-2">
              <UserPlus size={14} />
              Add Members
            </h4>
            <span className="text-xs text-plm-fg-muted">{availableUsers.length} available</span>
          </div>
          
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter users..."
              className="w-full pl-9 pr-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
          
          {availableUsers.length === 0 ? (
            <div className="text-center py-4 text-sm text-plm-fg-muted bg-plm-bg rounded-lg border border-plm-border">
              All organization members are already in this team
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-4 text-sm text-plm-fg-muted">
                  No users match your search
                </div>
              ) : (
                filteredUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      addMember(u)
                      setSearchQuery('')
                    }}
                    disabled={isAdding}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-plm-highlight transition-colors text-left border-b border-plm-border/50 last:border-b-0"
                  >
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-xs font-medium">
                        {getInitials(u.full_name || u.email)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-plm-fg truncate">{u.full_name || u.email}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-1 text-plm-accent text-xs font-medium">
                      <Plus size={14} />
                      Add
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        
        {/* Members list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-plm-fg-muted" size={24} />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-plm-fg-muted">
              No members in this team yet
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(member => (
                <div key={member.id} className="flex items-center gap-3 p-3 bg-plm-bg rounded-lg group">
                  {member.user?.avatar_url ? (
                    <img src={member.user.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                      {getInitials(member.user?.full_name || member.user?.email || '')}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-plm-fg truncate">{member.user?.full_name || member.user?.email}</div>
                    <div className="text-xs text-plm-fg-muted truncate">{member.user?.email}</div>
                  </div>
                  {member.is_team_admin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent uppercase font-medium">
                      Team Admin
                    </span>
                  )}
                  <button
                    onClick={() => removeMember(member)}
                    className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove from team"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex justify-end">
          <button onClick={onClose} className="btn btn-primary">Done</button>
        </div>
      </div>
    </div>
  )
}

// User Permissions Dialog (for unassigned users) - Full Editor
function UserPermissionsDialog({
  user,
  onClose,
  currentUserId
}: {
  user: OrgUser
  onClose: () => void
  currentUserId?: string
}) {
  const { addToast } = usePDMStore()
  const [permissions, setPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [originalPermissions, setOriginalPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  useEffect(() => {
    loadPermissions()
  }, [user.id])
  
  const loadPermissions = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', user.id)
      
      if (error) throw error
      
      const permsMap: Record<string, PermissionAction[]> = {}
      for (const perm of data || []) {
        permsMap[perm.resource] = perm.actions as PermissionAction[]
      }
      
      setPermissions(permsMap)
      setOriginalPermissions(permsMap)
    } catch (err) {
      console.error('Failed to load user permissions:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const savePermissions = async () => {
    if (!currentUserId) return
    
    setIsSaving(true)
    try {
      // Delete existing permissions
      await supabase.from('user_permissions').delete().eq('user_id', user.id)
      
      // Insert new permissions
      const newPerms = Object.entries(permissions)
        .filter(([_, actions]) => actions.length > 0)
        .map(([resource, actions]) => ({
          user_id: user.id,
          resource,
          actions,
          granted_by: currentUserId
        }))
      
      if (newPerms.length > 0) {
        const { error } = await supabase.from('user_permissions').insert(newPerms)
        if (error) throw error
      }
      
      addToast('success', `Permissions saved for ${user.full_name || user.email}`)
      onClose()
    } catch (err) {
      console.error('Failed to save permissions:', err)
      addToast('error', 'Failed to save permissions')
    } finally {
      setIsSaving(false)
    }
  }
  
  const toggleAction = (resourceId: string, action: PermissionAction) => {
    setPermissions(prev => {
      const current = prev[resourceId] || []
      if (current.includes(action)) {
        return { ...prev, [resourceId]: current.filter(a => a !== action) }
      } else {
        return { ...prev, [resourceId]: [...current, action] }
      }
    })
  }
  
  const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions)
  const permissionCount = Object.entries(permissions).filter(([_, a]) => a.length > 0).length
  
  // Filter resources by search
  const filteredResources = searchQuery
    ? ALL_RESOURCES.filter(r => 
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : ALL_RESOURCES
  
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center overflow-hidden" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-4xl h-[85vh] mx-4 flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-4 flex-shrink-0">
          <div className="p-2.5 rounded-lg bg-purple-500/20 text-purple-400">
            <Shield size={22} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-plm-fg flex items-center gap-2">
              Individual Permissions
              <span className="text-sm font-normal text-plm-fg-muted">— {user.full_name || user.email}</span>
            </h2>
            <p className="text-sm text-plm-fg-muted">
              These permissions are added to any team permissions (union of all)
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg">
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-3 border-b border-plm-border flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search resources..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
            </div>
          ) : (
            <div className="space-y-1">
              {filteredResources.map(resource => {
                const ResourceIcon = (LucideIcons as any)[resource.icon] || Shield
                const currentActions = permissions[resource.id] || []
                
                return (
                  <div
                    key={resource.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-plm-highlight/30 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-plm-bg-secondary flex items-center justify-center text-plm-fg-muted flex-shrink-0">
                      <ResourceIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-plm-fg font-medium truncate">{resource.name}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{resource.description}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {PERMISSION_ACTIONS.map(action => {
                        const isApplicable = resource.applicableActions.includes(action)
                        const isGranted = currentActions.includes(action)
                        
                        if (!isApplicable) {
                          return (
                            <div key={action} className="w-8 h-8 rounded-lg flex items-center justify-center opacity-20">
                              <Minus size={12} className="text-plm-fg-dim" />
                            </div>
                          )
                        }
                        
                        const colorClass = 
                          action === 'view' ? 'bg-blue-500/35 text-blue-300 border-blue-400/70' :
                          action === 'create' ? 'bg-green-500/35 text-green-300 border-green-400/70' :
                          action === 'edit' ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70' :
                          action === 'delete' ? 'bg-red-500/35 text-red-300 border-red-400/70' :
                          'bg-purple-500/35 text-purple-300 border-purple-400/70'
                        
                        const uncheckedClass = 
                          action === 'view' ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15' :
                          action === 'create' ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15' :
                          action === 'edit' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15' :
                          action === 'delete' ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15' :
                          'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15'
                        
                        return (
                          <button
                            key={action}
                            onClick={() => toggleAction(resource.id, action)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
                              isGranted ? colorClass : uncheckedClass
                            }`}
                            title={`${isGranted ? 'Revoke' : 'Grant'} ${PERMISSION_ACTION_LABELS[action]}`}
                          >
                            {isGranted ? (
                              <Check size={12} />
                            ) : (
                              <span className="text-[9px] font-medium">{action.charAt(0).toUpperCase()}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex items-center justify-between bg-plm-bg/50 flex-shrink-0">
          <div className="text-sm text-plm-fg-muted">
            {permissionCount} resource{permissionCount !== 1 ? 's' : ''} with permissions
            {hasChanges && <span className="ml-2 text-plm-warning">• Unsaved changes</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button
              onClick={savePermissions}
              disabled={isSaving || !hasChanges}
              className={`btn flex items-center gap-2 ${hasChanges ? 'btn-primary' : 'btn-ghost opacity-50'}`}
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
              Save Permissions
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Remove User Confirmation Dialog
function RemoveUserDialog({
  user,
  onClose,
  onConfirm,
  isRemoving
}: {
  user: OrgUser
  onClose: () => void
  onConfirm: () => void
  isRemoving: boolean
}) {
  const [confirmText, setConfirmText] = useState('')
  
  const displayName = user.full_name || user.email
  const isConfirmed = confirmText === displayName
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-full bg-plm-error/20">
            <AlertTriangle className="w-5 h-5 text-plm-error" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Remove User from Organization</h3>
            <p className="text-sm text-plm-fg-muted mt-1">This action cannot be undone</p>
          </div>
        </div>
        
        <div className="space-y-4 mb-6">
          <div className="p-3 bg-plm-error/10 border border-plm-error/30 rounded-lg">
            <p className="text-sm text-plm-fg">
              You are about to remove <strong>{displayName}</strong> from this organization. They will:
            </p>
            <ul className="text-sm text-plm-fg-muted list-disc list-inside mt-2 space-y-1">
              <li>Lose access to all vaults and files</li>
              <li>Be removed from all teams</li>
              <li>Need to be re-invited to rejoin</li>
            </ul>
          </div>
          
          <div>
            <p className="text-sm text-plm-fg-muted mb-2">
              To confirm, type <strong className="text-plm-fg">{displayName}</strong> below:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={displayName}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-error"
              autoFocus
            />
          </div>
        </div>
        
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!isConfirmed || isRemoving}
            className={`btn flex items-center gap-2 ${
              isConfirmed
                ? 'bg-plm-error hover:bg-plm-error/90 text-white'
                : 'bg-plm-fg-muted/20 text-plm-fg-muted cursor-not-allowed'
            }`}
          >
            {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
            {isRemoving ? 'Removing...' : 'Remove User'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Create User Dialog (pre-create account before they log in)
function CreateUserDialog({
  onClose,
  onCreated,
  teams,
  orgId,
  currentUserId
}: {
  onClose: () => void
  onCreated: () => void
  teams: TeamWithDetails[]
  orgId: string
  currentUserId?: string
}) {
  const { addToast } = usePDMStore()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'admin' | 'engineer' | 'viewer'>('engineer')
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  
  const handleCreate = async () => {
    if (!email || !isValidEmail || !currentUserId) return
    
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('pending_org_members')
        .insert({
          org_id: orgId,
          email: email.toLowerCase().trim(),
          full_name: fullName.trim() || null,
          role,
          team_ids: selectedTeamIds,
          notes: notes.trim() || null,
          created_by: currentUserId
        })
      
      if (error) {
        if (error.code === '23505') {
          addToast('error', 'A user with this email already exists or is pending')
        } else {
          throw error
        }
        return
      }
      
      addToast('success', `Created pending account for ${email}. They will be set up automatically when they sign in.`)
      onCreated()
      onClose()
    } catch (err) {
      console.error('Failed to create pending user:', err)
      addToast('error', 'Failed to create user account')
    } finally {
      setIsSaving(false)
    }
  }
  
  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds(current =>
      current.includes(teamId)
        ? current.filter(id => id !== teamId)
        : [...current, teamId]
    )
  }
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-6">
          <div className="p-2 rounded-lg bg-plm-accent/20 text-plm-accent">
            <UserPlus size={20} />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Add User</h3>
            <p className="text-sm text-plm-fg-muted mt-1">
              Pre-create an account. When they sign in with this email, they'll automatically join with these settings.
            </p>
          </div>
        </div>
        
        <div className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Email Address *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
            {email && !isValidEmail && (
              <p className="text-xs text-plm-error mt-1">Please enter a valid email address</p>
            )}
          </div>
          
          {/* Full Name */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="John Smith"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
          
          {/* Role */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Role</label>
            <div className="flex gap-2">
              {(['viewer', 'engineer', 'admin'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                    role === r
                      ? r === 'admin' ? 'bg-plm-accent/20 border-plm-accent text-plm-accent' :
                        r === 'engineer' ? 'bg-plm-success/20 border-plm-success text-plm-success' :
                        'bg-plm-fg-muted/20 border-plm-fg-muted text-plm-fg'
                      : 'border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
                  }`}
                >
                  {r === 'admin' && <Shield size={14} />}
                  {r === 'engineer' && <Wrench size={14} />}
                  {r === 'viewer' && <Eye size={14} />}
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>
          
          {/* Teams */}
          {teams.length > 0 && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Assign to Teams</label>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg p-2">
                {teams.map(team => {
                  const TeamIcon = (LucideIcons as any)[team.icon] || Users
                  const isSelected = selectedTeamIds.includes(team.id)
                  return (
                    <label
                      key={team.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTeam(team.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                      />
                      <div
                        className="p-1.5 rounded"
                        style={{ backgroundColor: `${team.color}15`, color: team.color }}
                      >
                        <TeamIcon size={14} />
                      </div>
                      <span className="text-sm text-plm-fg">{team.name}</span>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-plm-fg-dim mt-1">
                User will be added to selected teams when they first sign in
              </p>
            </div>
          )}
          
          {/* Notes */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes about this user..."
              rows={2}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent resize-none"
            />
          </div>
        </div>
        
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={isSaving || !email || !isValidEmail}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
            {isSaving ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}

