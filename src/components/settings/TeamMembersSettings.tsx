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
  Minus,
  Briefcase
} from 'lucide-react'
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  ALL_RESOURCES
} from '../../types/permissions'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase, getCurrentConfig, removeUserFromOrg, getOrgVaultAccess, setUserVaultAccess } from '../../lib/supabase'
import { copyToClipboard } from '../../lib/clipboard'
import { generateOrgCode } from '../../lib/supabaseConfig'
import { getInitials } from '../../types/pdm'
import { UserProfileModal } from './UserProfileModal'
import { PermissionsEditor } from './PermissionsEditor'
import type { Team, TeamMember, TeamPermission, PermissionAction } from '../../types/permissions'

import { IconPicker, IconGridPicker, ICON_LIBRARY } from '../shared/IconPicker'
import { ColorPickerDropdown, DEFAULT_PRESET_COLORS } from '../shared/ColorPicker'

// Preset colors for teams
const TEAM_COLORS = DEFAULT_PRESET_COLORS

// Icon options for workflow roles

interface WorkflowRoleBasic {
  id: string
  name: string
  color: string
  icon: string
  description?: string | null
}

interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  last_sign_in: string | null
  teams?: { id: string; name: string; color: string; icon: string }[]
  job_title?: { id: string; name: string; color: string; icon: string } | null
  workflow_roles?: WorkflowRoleBasic[]
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
  workflow_role_ids: string[]
  vault_ids: string[]
  created_at: string
  created_by: string | null
  notes: string | null
  claimed_at: string | null
}

export function TeamMembersSettings() {
  const { user, organization, setOrganization, addToast, getEffectiveRole, apiServerUrl } = usePDMStore()
  
  const isAdmin = getEffectiveRole() === 'admin'
  
  // Active tab state - 'teams' or 'users'
  const [activeTab, setActiveTab] = useState<'users' | 'teams' | 'roles' | 'titles'>('users')
  
  // Data state
  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [orgVaults, setOrgVaults] = useState<Vault[]>([])
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSavingDefaultTeam, setIsSavingDefaultTeam] = useState(false)
  
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
  const [showCreateUserDialog, setShowCreateUserDialog] = useState(false)
  const [removingUser, setRemovingUser] = useState<OrgUser | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  
  // Remove from team confirmation (for removing self from Administrators)
  const [removingFromTeam, setRemovingFromTeam] = useState<{ user: OrgUser; teamId: string; teamName: string } | null>(null)
  const [isRemovingFromTeam, setIsRemovingFromTeam] = useState(false)
  
  // Job titles state
  const [jobTitles, setJobTitles] = useState<{ id: string; name: string; color: string; icon: string }[]>([])
  const [showCreateTitleDialog, setShowCreateTitleDialog] = useState(false)
  const [pendingTitleForUser, setPendingTitleForUser] = useState<OrgUser | null>(null)
  const [newTitleName, setNewTitleName] = useState('')
  const [newTitleColor, setNewTitleColor] = useState('#3b82f6')
  const [newTitleIcon, setNewTitleIcon] = useState('Briefcase')
  const [isCreatingTitle, setIsCreatingTitle] = useState(false)
  const [jobTitleSearchQuery, setJobTitleSearchQuery] = useState('')
  
  // Edit team from manage modal
  const [editingTeamFromManage, setEditingTeamFromManage] = useState<{ id: string; name: string; color: string; icon: string; description?: string } | null>(null)
  
  // Workflow role management
  const [showCreateWorkflowRoleDialog, setShowCreateWorkflowRoleDialog] = useState(false)
  const [showEditWorkflowRoleDialog, setShowEditWorkflowRoleDialog] = useState(false)
  const [editingWorkflowRole, setEditingWorkflowRole] = useState<WorkflowRoleBasic | null>(null)
  const [workflowRoleFormData, setWorkflowRoleFormData] = useState({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
  const [isSavingWorkflowRole, setIsSavingWorkflowRole] = useState(false)
  const [editingJobTitle, setEditingJobTitle] = useState<{ id: string; name: string; color: string; icon: string } | null>(null)
  const [editingJobTitleUser, setEditingJobTitleUser] = useState<OrgUser | null>(null)
  
  // Workflow roles state
  const [workflowRoles, setWorkflowRoles] = useState<WorkflowRoleBasic[]>([])
  const [editingWorkflowRolesUser, setEditingWorkflowRolesUser] = useState<OrgUser | null>(null)
  const [userWorkflowRoleAssignments, setUserWorkflowRoleAssignments] = useState<Record<string, string[]>>({}) // userId -> roleIds
  
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
  
  // Add to team modal
  const [addToTeamUser, setAddToTeamUser] = useState<OrgUser | null>(null)
  
  // Edit user teams modal
  const [editingTeamsUser, setEditingTeamsUser] = useState<OrgUser | null>(null)
  
  // Org code state
  const [showOrgCode, setShowOrgCode] = useState(false)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  
  // Expanded sections
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [showUnassignedUsers, setShowUnassignedUsers] = useState(true)
  const [showPendingMembers, setShowPendingMembers] = useState(true)
  
  // Pending member editing
  const [editingPendingMember, setEditingPendingMember] = useState<PendingMember | null>(null)
  const [pendingMemberForm, setPendingMemberForm] = useState<{
    full_name: string
    team_ids: string[]
    workflow_role_ids: string[]
    vault_ids: string[]
  }>({ full_name: '', team_ids: [], workflow_role_ids: [], vault_ids: [] })
  const [isSavingPendingMember, setIsSavingPendingMember] = useState(false)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  
  // Listen for navigation events to switch inner tab
  useEffect(() => {
    const handleSwitchTab = (e: CustomEvent<'users' | 'teams' | 'roles' | 'titles'>) => {
      setActiveTab(e.detail)
    }
    window.addEventListener('navigate-team-members-tab', handleSwitchTab as EventListener)
    return () => window.removeEventListener('navigate-team-members-tab', handleSwitchTab as EventListener)
  }, [])
  
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
        loadPendingMembers(),
        loadJobTitles(),
        loadWorkflowRoles()
      ])
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadJobTitles = async () => {
    if (!organization) return
    
    try {
      const { data, error } = await supabase
        .from('job_titles')
        .select('id, name, color, icon')
        .eq('org_id', organization.id)
        .order('name')
      
      if (error) throw error
      setJobTitles(data || [])
    } catch (err) {
      console.error('Failed to load job titles:', err)
    }
  }
  
  const loadWorkflowRoles = async () => {
    if (!organization) return
    
    try {
      // Load workflow roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('workflow_roles')
        .select('id, name, color, icon, description')
        .eq('org_id', organization.id)
        .eq('is_active', true)
        .order('sort_order')
      
      if (rolesError) throw rolesError
      setWorkflowRoles(rolesData || [])
      
      // Load user role assignments
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('user_workflow_roles')
        .select(`
          user_id,
          workflow_role_id,
          workflow_roles!inner (org_id)
        `)
        .eq('workflow_roles.org_id', organization.id)
      
      if (assignmentsError) throw assignmentsError
      
      // Build userId -> roleIds map
      const assignmentsMap: Record<string, string[]> = {}
      for (const a of (assignmentsData || [])) {
        if (!assignmentsMap[a.user_id]) {
          assignmentsMap[a.user_id] = []
        }
        assignmentsMap[a.user_id].push(a.workflow_role_id)
      }
      setUserWorkflowRoleAssignments(assignmentsMap)
    } catch (err) {
      console.error('Failed to load workflow roles:', err)
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
  
  const openEditPendingMember = (pm: PendingMember) => {
    setEditingPendingMember(pm)
    setPendingMemberForm({
      full_name: pm.full_name || '',
      team_ids: pm.team_ids || [],
      workflow_role_ids: pm.workflow_role_ids || [],
      vault_ids: pm.vault_ids || []
    })
  }
  
  const handleSavePendingMember = async () => {
    if (!editingPendingMember) return
    
    setIsSavingPendingMember(true)
    try {
      const { error } = await supabase
        .from('pending_org_members')
        .update({
          full_name: pendingMemberForm.full_name || null,
          team_ids: pendingMemberForm.team_ids,
          workflow_role_ids: pendingMemberForm.workflow_role_ids,
          vault_ids: pendingMemberForm.vault_ids
        })
        .eq('id', editingPendingMember.id)
      
      if (error) throw error
      
      addToast('success', `Updated pending member ${editingPendingMember.email}`)
      setEditingPendingMember(null)
      loadPendingMembers()
    } catch (err) {
      console.error('Failed to update pending member:', err)
      addToast('error', 'Failed to update pending member')
    } finally {
      setIsSavingPendingMember(false)
    }
  }
  
  const handleResendInvite = async (pm: PendingMember) => {
    if (!apiServerUrl || !user) {
      addToast('error', 'API server not configured - cannot send invite emails')
      return
    }
    
    setResendingInviteId(pm.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        addToast('error', 'Session expired, please log in again')
        return
      }
      
      const response = await fetch(`${apiServerUrl}/auth/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          email: pm.email,
          full_name: pm.full_name || undefined,
          team_ids: pm.team_ids?.length > 0 ? pm.team_ids : undefined,
          vault_ids: pm.vault_ids?.length > 0 ? pm.vault_ids : undefined,
          workflow_role_ids: pm.workflow_role_ids?.length > 0 ? pm.workflow_role_ids : undefined,
          resend: true
        })
      })
      
      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to resend invite')
      }
      
      addToast('success', `Invite email resent to ${pm.email}`)
    } catch (err: any) {
      console.error('Failed to resend invite:', err)
      addToast('error', err.message || 'Failed to resend invite email')
    } finally {
      setResendingInviteId(null)
    }
  }
  
  const togglePendingMemberTeam = (teamId: string) => {
    setPendingMemberForm(prev => ({
      ...prev,
      team_ids: prev.team_ids.includes(teamId)
        ? prev.team_ids.filter(id => id !== teamId)
        : [...prev.team_ids, teamId]
    }))
  }
  
  const togglePendingMemberWorkflowRole = (roleId: string) => {
    setPendingMemberForm(prev => ({
      ...prev,
      workflow_role_ids: prev.workflow_role_ids.includes(roleId)
        ? prev.workflow_role_ids.filter(id => id !== roleId)
        : [...prev.workflow_role_ids, roleId]
    }))
  }
  
  const togglePendingMemberVault = (vaultId: string) => {
    setPendingMemberForm(prev => ({
      ...prev,
      vault_ids: prev.vault_ids.includes(vaultId)
        ? prev.vault_ids.filter(id => id !== vaultId)
        : [...prev.vault_ids, vaultId]
    }))
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
        .select('id, email, full_name, avatar_url, job_title, role, last_sign_in')
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
      
      // Load job title assignments for all users
      const { data: titleAssignmentsData } = await supabase
        .from('user_job_titles')
        .select(`
          user_id,
          title:job_titles(id, name, color, icon)
        `)
        .in('user_id', (usersData || []).map(u => u.id))
      
      // Map teams and job_title to users
      const usersWithTeamsAndTitles = (usersData || []).map(user => {
        const userMemberships = (membershipsData || []).filter(m => m.user_id === user.id)
        const userTitleAssignment = (titleAssignmentsData || []).find(t => t.user_id === user.id)
        return {
          ...user,
          teams: userMemberships.map(m => m.team).filter(Boolean) as { id: string; name: string; color: string; icon: string }[],
          job_title: userTitleAssignment?.title as { id: string; name: string; color: string; icon: string } | null
        }
      })
      
      setOrgUsers(usersWithTeamsAndTitles)
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
  
  // Filter all users for the "users" tab
  const filteredAllUsers = useMemo(() => {
    if (!searchQuery) return orgUsers
    const q = searchQuery.toLowerCase()
    return orgUsers.filter(u =>
      u.full_name?.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.job_title?.toLowerCase().includes(q)
    )
  }, [orgUsers, searchQuery])
  
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
  
  // Update the default team for new users (joining without invite or with invite but no teams)
  const handleSetDefaultTeam = async (teamId: string | null) => {
    if (!organization?.id) return
    
    setIsSavingDefaultTeam(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ default_new_user_team_id: teamId })
        .eq('id', organization.id)
      
      if (error) throw error
      
      // Update local organization state
      setOrganization({
        ...organization,
        default_new_user_team_id: teamId
      })
      
      const teamName = teamId ? teams.find(t => t.id === teamId)?.name : 'None'
      addToast('success', `Default team set to "${teamName}"`)
    } catch (err) {
      console.error('Failed to set default team:', err)
      addToast('error', 'Failed to update default team')
    } finally {
      setIsSavingDefaultTeam(false)
    }
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
  
  // Delete team directly (from manage modal)
  const handleDeleteTeamDirect = async (team: { id: string; name: string }) => {
    if (team.name === 'Administrators') {
      addToast('error', 'Cannot delete the Administrators team')
      return
    }
    
    if (!confirm(`Delete "${team.name}"? All members will be removed from this team.`)) return
    
    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', team.id)
      
      if (error) throw error
      
      addToast('success', `Team "${team.name}" deleted`)
      loadTeams()
      loadOrgUsers()
    } catch {
      addToast('error', 'Failed to delete team')
    }
  }
  
  // Edit team from manage modal
  const handleUpdateTeamFromManage = async () => {
    if (!editingTeamFromManage) return
    
    setIsSavingTeam(true)
    try {
      const { error } = await supabase
        .from('teams')
        .update({
          name: teamFormData.name,
          description: teamFormData.description,
          color: teamFormData.color,
          icon: teamFormData.icon
        })
        .eq('id', editingTeamFromManage.id)
      
      if (error) throw error
      
      addToast('success', `Team "${teamFormData.name}" updated`)
      setShowEditTeamDialog(false)
      setEditingTeamFromManage(null)
      loadTeams()
      loadOrgUsers()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A team with this name already exists')
      } else {
        addToast('error', 'Failed to update team')
      }
    } finally {
      setIsSavingTeam(false)
    }
  }
  
  // Workflow role management functions
  const handleCreateWorkflowRole = async () => {
    if (!workflowRoleFormData.name.trim() || !organization) return
    
    setIsSavingWorkflowRole(true)
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .insert({
          name: workflowRoleFormData.name.trim(),
          color: workflowRoleFormData.color,
          icon: workflowRoleFormData.icon,
          description: workflowRoleFormData.description || null,
          org_id: organization.id
        })
      
      if (error) throw error
      
      addToast('success', `Created workflow role "${workflowRoleFormData.name}"`)
      setShowCreateWorkflowRoleDialog(false)
      setWorkflowRoleFormData({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
      loadWorkflowRoles()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A workflow role with this name already exists')
      } else {
        addToast('error', 'Failed to create workflow role')
      }
    } finally {
      setIsSavingWorkflowRole(false)
    }
  }
  
  const handleUpdateWorkflowRole = async () => {
    if (!editingWorkflowRole || !workflowRoleFormData.name.trim()) return
    
    setIsSavingWorkflowRole(true)
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .update({
          name: workflowRoleFormData.name.trim(),
          color: workflowRoleFormData.color,
          icon: workflowRoleFormData.icon,
          description: workflowRoleFormData.description || null
        })
        .eq('id', editingWorkflowRole.id)
      
      if (error) throw error
      
      addToast('success', `Updated workflow role "${workflowRoleFormData.name}"`)
      setShowEditWorkflowRoleDialog(false)
      setEditingWorkflowRole(null)
      setWorkflowRoleFormData({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
      loadWorkflowRoles()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A workflow role with this name already exists')
      } else {
        addToast('error', 'Failed to update workflow role')
      }
    } finally {
      setIsSavingWorkflowRole(false)
    }
  }
  
  const handleDeleteWorkflowRole = async (role: { id: string; name: string }) => {
    if (!confirm(`Delete "${role.name}"? Users with this role will have it removed.`)) return
    
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .delete()
        .eq('id', role.id)
      
      if (error) throw error
      
      addToast('success', `Deleted workflow role "${role.name}"`)
      loadWorkflowRoles()
      loadUserWorkflowRoles()
    } catch {
      addToast('error', 'Failed to delete workflow role')
    }
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
  
  const handleRemoveFromTeam = async (targetUser: OrgUser, teamId: string, teamName: string) => {
    // If removing yourself from Administrators, show confirmation
    if (targetUser.id === user?.id && teamName === 'Administrators') {
      setRemovingFromTeam({ user: targetUser, teamId, teamName })
      return
    }
    
    await executeRemoveFromTeam(targetUser, teamId, teamName)
  }
  
  const executeRemoveFromTeam = async (targetUser: OrgUser, teamId: string, teamName: string) => {
    try {
      setIsRemovingFromTeam(true)
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('user_id', targetUser.id)
        .eq('team_id', teamId)
      
      if (error) throw error
      
      addToast('success', `Removed ${targetUser.full_name || targetUser.email} from ${teamName}`)
      setRemovingFromTeam(null)
      await loadOrgUsers()
      await loadTeams()
    } catch {
      addToast('error', 'Failed to remove from team')
    } finally {
      setIsRemovingFromTeam(false)
    }
  }
  
  const handleChangeJobTitle = async (targetUser: OrgUser, titleId: string | null) => {
    try {
      if (titleId) {
        // Upsert the title assignment
        const { error } = await supabase
          .from('user_job_titles')
          .upsert({
            user_id: targetUser.id,
            title_id: titleId,
            assigned_by: user?.id
          }, { onConflict: 'user_id' })
        
        if (error) throw error
        
        const titleName = jobTitles.find(t => t.id === titleId)?.name || 'title'
        addToast('success', `Set ${targetUser.full_name || targetUser.email}'s title to ${titleName}`)
      } else {
        // Remove title
        const { error } = await supabase
          .from('user_job_titles')
          .delete()
          .eq('user_id', targetUser.id)
        
        if (error) throw error
        addToast('success', `Removed ${targetUser.full_name || targetUser.email}'s job title`)
      }
      
      await loadOrgUsers()
    } catch {
      addToast('error', 'Failed to change job title')
    }
  }
  
  const openCreateTitleDialog = (targetUser: OrgUser) => {
    setPendingTitleForUser(targetUser)
    setNewTitleName('')
    setNewTitleColor('#3b82f6')
    setShowCreateTitleDialog(true)
  }
  
  const handleCreateTitle = async () => {
    if (!organization || !user || !newTitleName.trim()) return
    
    setIsCreatingTitle(true)
    try {
      // Create the title
      const { data, error } = await supabase
        .from('job_titles')
        .insert({
          org_id: organization.id,
          name: newTitleName.trim(),
          color: newTitleColor,
          icon: newTitleIcon,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      // If we have a pending user, assign the title to them
      if (pendingTitleForUser && data) {
        await supabase
          .from('user_job_titles')
          .upsert({
            user_id: pendingTitleForUser.id,
            title_id: data.id,
            assigned_by: user.id
          }, { onConflict: 'user_id' })
        
        addToast('success', `Created "${newTitleName}" and assigned to ${pendingTitleForUser.full_name || pendingTitleForUser.email}`)
      } else {
        addToast('success', `Created job title "${newTitleName}"`)
      }
      
      setShowCreateTitleDialog(false)
      setPendingTitleForUser(null)
      setEditingJobTitle(null)
      await loadJobTitles()
      await loadOrgUsers()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A job title with this name already exists')
      } else {
        addToast('error', 'Failed to create job title')
      }
    } finally {
      setIsCreatingTitle(false)
    }
  }
  
  const handleUpdateJobTitle = async () => {
    if (!editingJobTitle || !newTitleName.trim()) return
    
    setIsCreatingTitle(true)
    try {
      const { error } = await supabase
        .from('job_titles')
        .update({
          name: newTitleName.trim(),
          color: newTitleColor,
          icon: newTitleIcon
        })
        .eq('id', editingJobTitle.id)
      
      if (error) throw error
      
      addToast('success', `Updated "${newTitleName}"`)
      setEditingJobTitle(null)
      setShowCreateTitleDialog(false)
      await loadJobTitles()
      await loadOrgUsers()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A job title with this name already exists')
      } else {
        addToast('error', 'Failed to update job title')
      }
    } finally {
      setIsCreatingTitle(false)
    }
  }
  
  const handleDeleteJobTitle = async (title: { id: string; name: string }) => {
    if (!confirm(`Delete "${title.name}"? Users with this title will have it removed.`)) return
    
    try {
      const { error } = await supabase
        .from('job_titles')
        .delete()
        .eq('id', title.id)
      
      if (error) throw error
      
      addToast('success', `Deleted "${title.name}"`)
      await loadJobTitles()
      await loadOrgUsers()
    } catch {
      addToast('error', 'Failed to delete job title')
    }
  }
  
  // Direct update/delete functions for inline modal editing
  const updateJobTitleDirect = async (titleId: string, name: string, color: string, icon: string) => {
    try {
      const { error } = await supabase
        .from('job_titles')
        .update({ name, color, icon })
        .eq('id', titleId)
      
      if (error) throw error
      
      addToast('success', `Updated "${name}"`)
      await loadJobTitles()
      await loadOrgUsers()
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A job title with this name already exists')
      } else {
        addToast('error', 'Failed to update job title')
      }
      throw err
    }
  }
  
  const deleteJobTitleDirect = async (titleId: string) => {
    const title = jobTitles.find(t => t.id === titleId)
    if (!title) return
    
    if (!confirm(`Delete "${title.name}"? Users with this title will have it removed.`)) {
      throw new Error('Cancelled')
    }
    
    try {
      const { error } = await supabase
        .from('job_titles')
        .delete()
        .eq('id', titleId)
      
      if (error) throw error
      
      addToast('success', `Deleted "${title.name}"`)
      await loadJobTitles()
      await loadOrgUsers()
    } catch (err: any) {
      if (err.message !== 'Cancelled') {
        addToast('error', 'Failed to delete job title')
      }
      throw err
    }
  }
  
  const openEditJobTitle = (title: { id: string; name: string; color: string; icon: string }) => {
    setEditingJobTitle(title)
    setNewTitleName(title.name)
    setNewTitleColor(title.color)
    setNewTitleIcon(title.icon)
    setShowCreateTitleDialog(true)
  }
  
  const openCreateJobTitle = () => {
    setEditingJobTitle(null)
    setNewTitleName('')
    setNewTitleColor('#3b82f6')
    setNewTitleIcon('Briefcase')
    setPendingTitleForUser(null)
    setShowCreateTitleDialog(true)
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
            Members
          </h2>
          <p className="text-sm text-plm-fg-muted mt-1">
            {activeTab === 'users' ? 'Manage individual users in your organization' :
             activeTab === 'teams' ? 'Organize members into teams and manage permissions' : 
             activeTab === 'roles' ? 'Define workflow roles for approvals and reviews' :
             'Manage job titles for your organization'}
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
          {isAdmin && activeTab === 'users' && (
            <button
              onClick={() => setShowCreateUserDialog(true)}
              className="btn btn-primary btn-sm flex items-center gap-1"
              title="Add user"
            >
              <UserPlus size={14} />
              Add User
            </button>
          )}
          {isAdmin && activeTab === 'teams' && (
            <button
              onClick={() => {
                resetTeamForm()
                setShowCreateTeamDialog(true)
              }}
              className="btn btn-primary btn-sm flex items-center gap-1"
              title="Add team"
            >
              <Plus size={14} />
              Add Team
            </button>
          )}
          {isAdmin && activeTab === 'roles' && (
            <button
              onClick={() => setShowCreateWorkflowRoleDialog(true)}
              className="btn btn-primary btn-sm flex items-center gap-1"
              title="Add role"
            >
              <Plus size={14} />
              Add Role
            </button>
          )}
          {isAdmin && activeTab === 'titles' && (
            <button
              onClick={openCreateJobTitle}
              className="btn btn-primary btn-sm flex items-center gap-1"
              title="Add title"
            >
              <Plus size={14} />
              Add Title
            </button>
          )}
        </div>
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
                  const result = await copyToClipboard(orgCode)
                  if (result.success) {
                    setCodeCopied(true)
                    setTimeout(() => setCodeCopied(false), 2000)
                  }
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
                  // Always include org slug from current organization for join_org_by_slug to work
                  setOrgCode(generateOrgCode(config, organization?.slug))
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
      
      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-plm-bg-secondary rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
            activeTab === 'users'
              ? 'bg-plm-bg text-plm-fg shadow-sm'
              : 'text-plm-fg-muted hover:text-plm-fg'
          }`}
        >
          <UsersRound size={16} />
          Users
          {orgUsers.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'users' ? 'bg-plm-accent/20 text-plm-accent' : 'bg-plm-fg-muted/20'
            }`}>
              {orgUsers.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
            activeTab === 'teams'
              ? 'bg-plm-bg text-plm-fg shadow-sm'
              : 'text-plm-fg-muted hover:text-plm-fg'
          }`}
        >
          <Users size={16} />
          Teams
          {teams.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'teams' ? 'bg-plm-accent/20 text-plm-accent' : 'bg-plm-fg-muted/20'
            }`}>
              {teams.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
            activeTab === 'roles'
              ? 'bg-plm-bg text-plm-fg shadow-sm'
              : 'text-plm-fg-muted hover:text-plm-fg'
          }`}
        >
          <Shield size={16} />
          Roles
          {workflowRoles.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'roles' ? 'bg-plm-accent/20 text-plm-accent' : 'bg-plm-fg-muted/20'
            }`}>
              {workflowRoles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('titles')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
            activeTab === 'titles'
              ? 'bg-plm-bg text-plm-fg shadow-sm'
              : 'text-plm-fg-muted hover:text-plm-fg'
          }`}
        >
          <Briefcase size={16} />
          Titles
          {jobTitles.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'titles' ? 'bg-plm-accent/20 text-plm-accent' : 'bg-plm-fg-muted/20'
            }`}>
              {jobTitles.length}
            </span>
          )}
        </button>
      </div>
      
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={
            activeTab === 'users' ? "Search users..." :
            activeTab === 'teams' ? "Search teams..." : 
            activeTab === 'roles' ? "Search roles..." :
            "Search titles..."
          }
          className="w-full pl-10 pr-4 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Teams Tab Content */}
          {activeTab === 'teams' && (
          <div className="space-y-3">
            
            {/* Default Team for New Users Setting */}
            {isAdmin && teams.length > 0 && (
              <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-plm-accent/10">
                      <UserPlus size={18} className="text-plm-accent" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-plm-fg">Default Team for New Users</h4>
                      <p className="text-xs text-plm-fg-muted">
                        Users joining via org code (or invited without specific teams) will be added here
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={(organization as any)?.default_new_user_team_id || ''}
                      onChange={(e) => handleSetDefaultTeam(e.target.value || null)}
                      disabled={isSavingDefaultTeam}
                      className="px-3 py-1.5 text-sm bg-plm-bg-secondary border border-plm-border rounded-lg text-plm-fg focus:outline-none focus:border-plm-accent disabled:opacity-50"
                    >
                      <option value="">Unassigned (no team permissions)</option>
                      {teams.map(team => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </select>
                    {isSavingDefaultTeam && (
                      <Loader2 size={14} className="animate-spin text-plm-fg-muted" />
                    )}
                  </div>
                </div>
                {!(organization as any)?.default_new_user_team_id && (
                  <p className="mt-2 text-xs text-yellow-500 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    New users will have no team permissions until manually assigned
                  </p>
                )}
              </div>
            )}
            
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
                          {isAdmin && (
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
                              {!team.is_system && (
                                <>
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
                                </>
                              )}
                              {team.is_system && (
                                <span className="text-xs text-plm-fg-muted flex items-center gap-1 ml-auto">
                                  <Crown size={12} className="text-yellow-500" />
                                  System team (cannot be deleted)
                                </span>
                              )}
                            </div>
                          )}
                          
                          {/* Team Members List */}
                          <div>
                            {teamMembers.length === 0 ? (
                              <p className="text-sm text-plm-fg-muted text-center py-4">
                                No members in this team
                              </p>
                            ) : (
                              <div className="divide-y divide-plm-border/50">
                                {teamMembers.map(member => (
                                  <UserRow
                                    key={member.id}
                                    user={member}
                                    isAdmin={isAdmin}
                                    isCurrentUser={member.id === user?.id}
                                    onViewProfile={() => setViewingUserId(member.id)}
                                    onRemove={() => setRemovingUser(member)}
                                    onRemoveFromTeam={() => handleRemoveFromTeam(member, team.id, team.name)}
                                    onVaultAccess={() => openVaultAccessEditor(member)}
                                    onPermissions={isAdmin ? () => setEditingPermissionsUser(member) : undefined}
                                    vaultAccessCount={getUserVaultAccessCount(member.id)}
                                    onEditJobTitle={isAdmin ? setEditingJobTitleUser : undefined}
                                    workflowRoles={workflowRoles}
                                    userWorkflowRoleIds={userWorkflowRoleAssignments[member.id]}
                                    onEditWorkflowRoles={setEditingWorkflowRolesUser}
                                    teams={teams}
                                    onEditTeams={setEditingTeamsUser}
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
          )}
          
          {/* Users Tab Content */}
          {activeTab === 'users' && (
          <>
          {/* All Users Section */}
          <div className="space-y-3">
            {filteredAllUsers.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-plm-border rounded-lg">
                <UsersRound size={36} className="mx-auto text-plm-fg-muted mb-3 opacity-50" />
                <p className="text-sm text-plm-fg-muted mb-4">
                  {orgUsers.length === 0 ? 'No users yet' : 'No users match your search'}
                </p>
                {isAdmin && orgUsers.length === 0 && (
                  <button
                    onClick={() => setShowCreateUserDialog(true)}
                    className="btn btn-primary btn-sm"
                  >
                    <UserPlus size={14} className="mr-1" />
                    Add First User
                  </button>
                )}
              </div>
            ) : (
              <div className="border border-plm-border rounded-lg overflow-hidden bg-plm-bg/50">
                <div className="divide-y divide-plm-border/50">
                  {filteredAllUsers.map(u => (
                    <UserRow
                      key={u.id}
                      user={u}
                      isAdmin={isAdmin}
                      isCurrentUser={u.id === user?.id}
                      onViewProfile={() => setViewingUserId(u.id)}
                      onRemove={() => setRemovingUser(u)}
                      onVaultAccess={() => openVaultAccessEditor(u)}
                      onPermissions={isAdmin ? () => setEditingPermissionsUser(u) : undefined}
                      vaultAccessCount={getUserVaultAccessCount(u.id)}
                      showAddToTeam={isAdmin && teams.length > 0}
                      onOpenAddToTeamModal={() => setAddToTeamUser(u)}
                      onEditJobTitle={isAdmin ? setEditingJobTitleUser : undefined}
                      workflowRoles={workflowRoles}
                      userWorkflowRoleIds={userWorkflowRoleAssignments[u.id]}
                      onEditWorkflowRoles={setEditingWorkflowRolesUser}
                      teams={teams}
                      onEditTeams={setEditingTeamsUser}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pending Members Section (pre-created accounts) - only in users tab */}
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
                      Pre-created accounts awaiting user sign-in. These users can sign in with the organization code.
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
                          <div className="text-sm text-plm-fg-muted truncate flex items-center gap-2 flex-wrap">
                            <span className="truncate">{pm.email}</span>
                            {pm.workflow_role_ids && pm.workflow_role_ids.length > 0 && (
                              <span className="flex items-center gap-1">
                                {pm.workflow_role_ids.slice(0, 2).map(roleId => {
                                  const role = workflowRoles.find(r => r.id === roleId)
                                  if (!role) return null
                                  const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                                  return (
                                    <span
                                      key={roleId}
                                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                                      style={{ backgroundColor: `${role.color}20`, color: role.color }}
                                      title={role.name}
                                    >
                                      <RoleIcon size={10} />
                                      {role.name}
                                    </span>
                                  )
                                })}
                                {pm.workflow_role_ids.length > 2 && (
                                  <span className="text-xs text-plm-fg-dim">+{pm.workflow_role_ids.length - 2}</span>
                                )}
                              </span>
                            )}
                            {pm.team_ids && pm.team_ids.length > 0 && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-plm-fg-muted/10 rounded text-plm-fg-dim">
                                <Users size={10} />
                                {pm.team_ids.length} team{pm.team_ids.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {apiServerUrl && (
                            <button
                              onClick={() => handleResendInvite(pm)}
                              disabled={resendingInviteId === pm.id}
                              className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded disabled:opacity-50"
                              title="Resend invite email"
                            >
                              {resendingInviteId === pm.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Mail size={14} />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => openEditPendingMember(pm)}
                            className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded"
                            title="Edit pending member"
                          >
                            <Pencil size={14} />
                          </button>
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
                            className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded"
                            title="Remove pending member"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}

          {/* Roles Tab Content */}
          {activeTab === 'roles' && (
            <div className="space-y-3">
              {workflowRoles.filter(r => 
                !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase())
              ).length === 0 ? (
                <div className="text-center py-8 border border-dashed border-plm-border rounded-lg">
                  <Shield size={36} className="mx-auto text-plm-fg-muted mb-3 opacity-50" />
                  <p className="text-sm text-plm-fg-muted mb-4">
                    {searchQuery ? 'No matching workflow roles' : 'No workflow roles yet'}
                  </p>
                  {isAdmin && !searchQuery && (
                    <button
                      onClick={() => setShowCreateWorkflowRoleDialog(true)}
                      className="btn btn-primary btn-sm"
                    >
                      <Plus size={14} className="mr-1" />
                      Create First Role
                    </button>
                  )}
                </div>
              ) : (
                <div className="border border-plm-border rounded-lg overflow-hidden bg-plm-bg/50">
                  <div className="divide-y divide-plm-border/50">
                    {workflowRoles
                      .filter(r => !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(role => {
                        const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                        const usersWithRole = orgUsers.filter(u => 
                          userWorkflowRoleAssignments[u.id]?.includes(role.id)
                        )
                        
                        return (
                          <div
                            key={role.id}
                            className="flex items-center gap-3 p-3 hover:bg-plm-highlight/30 transition-colors group"
                          >
                            {/* Role icon */}
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${role.color}15`, color: role.color }}
                            >
                              <RoleIcon size={20} />
                            </div>
                            
                            {/* Role info */}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-plm-fg">{role.name}</div>
                              <div className="text-xs text-plm-fg-muted">
                                {usersWithRole.length} user{usersWithRole.length !== 1 ? 's' : ''}
                                {role.description && ` • ${role.description}`}
                              </div>
                            </div>
                            
                            {/* Users with this role */}
                            {usersWithRole.length > 0 && (
                              <div className="flex -space-x-2 flex-shrink-0">
                                {usersWithRole.slice(0, 4).map(u => (
                                  u.avatar_url ? (
                                    <img
                                      key={u.id}
                                      src={u.avatar_url}
                                      alt={u.full_name || u.email}
                                      className="w-7 h-7 rounded-full border-2 border-plm-bg-light"
                                      title={u.full_name || u.email}
                                    />
                                  ) : (
                                    <div
                                      key={u.id}
                                      className="w-7 h-7 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-[10px] font-medium border-2 border-plm-bg-light"
                                      title={u.full_name || u.email}
                                    >
                                      {getInitials(u.full_name || u.email)}
                                    </div>
                                  )
                                ))}
                                {usersWithRole.length > 4 && (
                                  <div className="w-7 h-7 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-[10px] font-medium border-2 border-plm-bg-light">
                                    +{usersWithRole.length - 4}
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Actions */}
                            {isAdmin && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => {
                                    setEditingWorkflowRole(role)
                                    setWorkflowRoleFormData({
                                      name: role.name,
                                      color: role.color,
                                      icon: role.icon,
                                      description: role.description || ''
                                    })
                                    setShowEditWorkflowRoleDialog(true)
                                  }}
                                  className="p-1.5 text-plm-fg-muted hover:text-purple-400 hover:bg-purple-500/10 rounded transition-colors"
                                  title="Edit role"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteWorkflowRole(role)}
                                  className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                                  title="Delete role"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
              
              {/* Info footer */}
              <p className="text-xs text-plm-fg-muted">
                Workflow roles define responsibilities in workflows (e.g., approvers, reviewers). 
                Editing a role updates it for all assigned users.
              </p>
            </div>
          )}

          {/* Titles Tab Content */}
          {activeTab === 'titles' && (
            <div className="space-y-3">
              {jobTitles.filter(t => 
                !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
              ).length === 0 ? (
                <div className="text-center py-8 border border-dashed border-plm-border rounded-lg">
                  <Briefcase size={36} className="mx-auto text-plm-fg-muted mb-3 opacity-50" />
                  <p className="text-sm text-plm-fg-muted mb-4">
                    {searchQuery ? 'No matching job titles' : 'No job titles yet'}
                  </p>
                  {isAdmin && !searchQuery && (
                    <button
                      onClick={openCreateJobTitle}
                      className="btn btn-primary btn-sm"
                    >
                      <Plus size={14} className="mr-1" />
                      Create First Title
                    </button>
                  )}
                </div>
              ) : (
                <div className="border border-plm-border rounded-lg overflow-hidden bg-plm-bg/50">
                  <div className="divide-y divide-plm-border/50">
                    {jobTitles
                      .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(title => {
                        const TitleIcon = (LucideIcons as any)[title.icon] || Briefcase
                        const usersWithTitle = orgUsers.filter(u => u.job_title?.id === title.id)
                        
                        return (
                          <div
                            key={title.id}
                            className="flex items-center gap-3 p-3 hover:bg-plm-highlight/30 transition-colors group"
                          >
                            {/* Title icon */}
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: `${title.color}15`, color: title.color }}
                            >
                              <TitleIcon size={20} />
                            </div>
                            
                            {/* Title info */}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-plm-fg">{title.name}</div>
                              <div className="text-xs text-plm-fg-muted">
                                {usersWithTitle.length} user{usersWithTitle.length !== 1 ? 's' : ''}
                              </div>
                            </div>
                            
                            {/* Users with this title */}
                            {usersWithTitle.length > 0 && (
                              <div className="flex -space-x-2 flex-shrink-0">
                                {usersWithTitle.slice(0, 4).map(u => (
                                  u.avatar_url ? (
                                    <img
                                      key={u.id}
                                      src={u.avatar_url}
                                      alt={u.full_name || u.email}
                                      className="w-7 h-7 rounded-full border-2 border-plm-bg-light"
                                      title={u.full_name || u.email}
                                    />
                                  ) : (
                                    <div
                                      key={u.id}
                                      className="w-7 h-7 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-[10px] font-medium border-2 border-plm-bg-light"
                                      title={u.full_name || u.email}
                                    >
                                      {getInitials(u.full_name || u.email)}
                                    </div>
                                  )
                                ))}
                                {usersWithTitle.length > 4 && (
                                  <div className="w-7 h-7 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-[10px] font-medium border-2 border-plm-bg-light">
                                    +{usersWithTitle.length - 4}
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Actions */}
                            {isAdmin && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => {
                                    openEditJobTitle(title)
                                  }}
                                  className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors"
                                  title="Edit title"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteJobTitle(title)}
                                  className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                                  title="Delete title"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
              
              {/* Info footer */}
              <p className="text-xs text-plm-fg-muted">
                Job titles are display-only labels. Editing a title updates it for all users who have it assigned.
                All permissions come from teams.
              </p>
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

      {/* Edit Pending Member Dialog */}
      {editingPendingMember && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditingPendingMember(null)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-plm-fg flex items-center gap-2">
                <Pencil size={18} className="text-plm-accent" />
                Edit Pending Member
              </h3>
              <button
                onClick={() => setEditingPendingMember(null)}
                className="p-1 text-plm-fg-muted hover:text-plm-fg rounded"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Email (read-only) */}
              <div>
                <label className="block text-sm text-plm-fg-muted mb-1">Email</label>
                <div className="px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg-muted">
                  {editingPendingMember.email}
                </div>
              </div>
              
              {/* Full Name */}
              <div>
                <label className="block text-sm text-plm-fg-muted mb-1">Full Name</label>
                <input
                  type="text"
                  value={pendingMemberForm.full_name}
                  onChange={e => setPendingMemberForm(prev => ({ ...prev, full_name: e.target.value }))}
                  placeholder="Enter name"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted focus:border-plm-accent focus:outline-none"
                />
              </div>
              
              {/* Workflow Roles */}
              <div>
                <label className="block text-sm text-plm-fg-muted mb-2">Workflow Roles</label>
                <div className="space-y-1 max-h-36 overflow-y-auto border border-plm-border rounded-lg p-2 bg-plm-bg">
                  {workflowRoles.length === 0 ? (
                    <div className="text-sm text-plm-fg-muted p-2">No workflow roles defined yet</div>
                  ) : (
                    workflowRoles.map(role => {
                      const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                      const isSelected = pendingMemberForm.workflow_role_ids.includes(role.id)
                      return (
                        <button
                          key={role.id}
                          onClick={() => togglePendingMemberWorkflowRole(role.id)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                            isSelected 
                              ? 'bg-plm-accent/10 border border-plm-accent/30' 
                              : 'hover:bg-plm-highlight border border-transparent'
                          }`}
                        >
                          <div
                            className="w-6 h-6 rounded flex items-center justify-center"
                            style={{ backgroundColor: `${role.color}20`, color: role.color }}
                          >
                            <RoleIcon size={14} />
                          </div>
                          <span className="flex-1 text-left text-sm text-plm-fg">{role.name}</span>
                          {isSelected && <Check size={14} className="text-plm-accent" />}
                        </button>
                      )
                    })
                  )}
                </div>
                <p className="text-xs text-plm-fg-muted mt-1">
                  Roles for workflow approvals and state transitions.
                </p>
              </div>
              
              {/* Teams */}
              <div>
                <label className="block text-sm text-plm-fg-muted mb-2">Pre-assigned Teams</label>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-plm-border rounded-lg p-2 bg-plm-bg">
                  {teams.length === 0 ? (
                    <div className="text-sm text-plm-fg-muted p-2">No teams available</div>
                  ) : (
                    teams.map(team => {
                      const TeamIcon = (LucideIcons as any)[team.icon] || Users
                      const isSelected = pendingMemberForm.team_ids.includes(team.id)
                      return (
                        <button
                          key={team.id}
                          onClick={() => togglePendingMemberTeam(team.id)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                            isSelected 
                              ? 'bg-plm-accent/10 border border-plm-accent/30' 
                              : 'hover:bg-plm-highlight border border-transparent'
                          }`}
                        >
                          <div
                            className={`w-6 h-6 rounded flex items-center justify-center ${
                              isSelected ? 'bg-plm-accent text-white' : 'bg-plm-fg-muted/10'
                            }`}
                            style={isSelected ? {} : { color: team.color }}
                          >
                            <TeamIcon size={14} />
                          </div>
                          <span className="flex-1 text-left text-sm text-plm-fg">{team.name}</span>
                          {isSelected && <Check size={14} className="text-plm-accent" />}
                        </button>
                      )
                    })
                  )}
                </div>
                <p className="text-xs text-plm-fg-muted mt-1">
                  User will be automatically added to selected teams when they sign in.
                </p>
              </div>
              
              {/* Vault Access */}
              <div>
                <label className="block text-sm text-plm-fg-muted mb-2">Vault Access</label>
                <div className={`p-3 rounded-lg border mb-2 ${
                  pendingMemberForm.vault_ids.length === 0
                    ? 'bg-plm-success/10 border-plm-success/30'
                    : 'bg-plm-bg border-plm-border'
                }`}>
                  <div className="flex items-center gap-2">
                    <Database size={16} className={pendingMemberForm.vault_ids.length === 0 ? 'text-plm-success' : 'text-plm-fg-muted'} />
                    <span className={`text-sm ${pendingMemberForm.vault_ids.length === 0 ? 'text-plm-success' : 'text-plm-fg-muted'}`}>
                      {pendingMemberForm.vault_ids.length === 0 
                        ? 'All vaults (no restrictions)' 
                        : `${pendingMemberForm.vault_ids.length} of ${orgVaults.length} vaults selected`}
                    </span>
                  </div>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto border border-plm-border rounded-lg p-2 bg-plm-bg">
                  {orgVaults.length === 0 ? (
                    <div className="text-sm text-plm-fg-muted p-2">No vaults available</div>
                  ) : (
                    orgVaults.map(vault => {
                      const isSelected = pendingMemberForm.vault_ids.includes(vault.id)
                      return (
                        <button
                          key={vault.id}
                          onClick={() => togglePendingMemberVault(vault.id)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                            isSelected 
                              ? 'bg-plm-accent/10 border border-plm-accent/30' 
                              : 'hover:bg-plm-highlight border border-transparent'
                          }`}
                        >
                          <div
                            className={`w-6 h-6 rounded flex items-center justify-center ${
                              isSelected ? 'bg-plm-accent text-white' : 'bg-plm-fg-muted/10 text-plm-fg-muted'
                            }`}
                          >
                            <Folder size={14} />
                          </div>
                          <span className="flex-1 text-left text-sm text-plm-fg">{vault.name}</span>
                          {isSelected && <Check size={14} className="text-plm-accent" />}
                        </button>
                      )
                    })
                  )}
                </div>
                <p className="text-xs text-plm-fg-muted mt-1">
                  Leave empty for access to all vaults, or select specific vaults to restrict access.
                </p>
              </div>
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setEditingPendingMember(null)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePendingMember}
                disabled={isSavingPendingMember}
                className="btn btn-primary flex items-center gap-2"
              >
                {isSavingPendingMember ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
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
          currentUserName={user?.full_name || user?.email}
          orgName={organization.name}
          vaults={orgVaults}
          workflowRoles={workflowRoles}
          apiUrl={apiServerUrl}
          orgCode={(() => {
            const config = getCurrentConfig()
            return config ? generateOrgCode(config, organization?.slug) : undefined
          })()}
        />
      )}

      {/* User Vault Access Dialog */}
      {editingVaultAccessUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditingVaultAccessUser(null)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-2">Individual Vault Access</h3>
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
          isSelf={removingUser.id === user?.id}
        />
      )}

      {/* Remove from Administrators Team Dialog */}
      {removingFromTeam && (
        <RemoveFromAdminsDialog
          user={removingFromTeam.user}
          teamName={removingFromTeam.teamName}
          onClose={() => setRemovingFromTeam(null)}
          onConfirm={() => executeRemoveFromTeam(removingFromTeam.user, removingFromTeam.teamId, removingFromTeam.teamName)}
          isRemoving={isRemovingFromTeam}
        />
      )}

      {/* Job Titles Modal */}
      {/* Create Workflow Role Dialog */}
      {showCreateWorkflowRoleDialog && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center" onClick={() => {
          setShowCreateWorkflowRoleDialog(false)
          setWorkflowRoleFormData({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
        }}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Create Workflow Role</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Role Name</label>
                <input
                  type="text"
                  value={workflowRoleFormData.name}
                  onChange={e => setWorkflowRoleFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Design Lead"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={workflowRoleFormData.description}
                  onChange={e => setWorkflowRoleFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g., Leads design reviews"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <ColorPickerDropdown
                    color={workflowRoleFormData.color}
                    onChange={(c) => c && setWorkflowRoleFormData(prev => ({ ...prev, color: c }))}
                    triggerSize="lg"
                    showReset={false}
                    title="Role Color"
                  />
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${workflowRoleFormData.color}20`, color: workflowRoleFormData.color }}
                  >
                    {(() => {
                      const IconComp = (LucideIcons as any)[workflowRoleFormData.icon] || Shield
                      return <IconComp size={16} />
                    })()}
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Icon</label>
                <IconGridPicker
                  value={workflowRoleFormData.icon}
                  onChange={(icon) => setWorkflowRoleFormData(prev => ({ ...prev, icon }))}
                  maxHeight="128px"
                  columns={8}
                />
              </div>
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button 
                onClick={() => {
                  setShowCreateWorkflowRoleDialog(false)
                  setWorkflowRoleFormData({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
                }} 
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkflowRole}
                disabled={isSavingWorkflowRole || !workflowRoleFormData.name.trim()}
                className="btn btn-primary"
              >
                {isSavingWorkflowRole ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Workflow Role Dialog */}
      {showEditWorkflowRoleDialog && editingWorkflowRole && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center" onClick={() => {
          setShowEditWorkflowRoleDialog(false)
          setEditingWorkflowRole(null)
          setWorkflowRoleFormData({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
        }}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Edit Workflow Role</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Role Name</label>
                <input
                  type="text"
                  value={workflowRoleFormData.name}
                  onChange={e => setWorkflowRoleFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Design Lead"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={workflowRoleFormData.description}
                  onChange={e => setWorkflowRoleFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g., Leads design reviews"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <ColorPickerDropdown
                    color={workflowRoleFormData.color}
                    onChange={(c) => c && setWorkflowRoleFormData(prev => ({ ...prev, color: c }))}
                    triggerSize="lg"
                    showReset={false}
                    title="Role Color"
                  />
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${workflowRoleFormData.color}20`, color: workflowRoleFormData.color }}
                  >
                    {(() => {
                      const IconComp = (LucideIcons as any)[workflowRoleFormData.icon] || Shield
                      return <IconComp size={16} />
                    })()}
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Icon</label>
                <IconGridPicker
                  value={workflowRoleFormData.icon}
                  onChange={(icon) => setWorkflowRoleFormData(prev => ({ ...prev, icon }))}
                  maxHeight="128px"
                  columns={8}
                />
              </div>
              
              <p className="text-xs text-plm-fg-muted bg-plm-bg p-2 rounded">
                Changes will update for all users with this role.
              </p>
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button 
                onClick={() => {
                  setShowEditWorkflowRoleDialog(false)
                  setEditingWorkflowRole(null)
                  setWorkflowRoleFormData({ name: '', color: '#8b5cf6', icon: 'Shield', description: '' })
                }} 
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateWorkflowRole}
                disabled={isSavingWorkflowRole || !workflowRoleFormData.name.trim()}
                className="btn btn-primary"
              >
                {isSavingWorkflowRole ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Team Dialog (from Manage Teams) */}
      {showEditTeamDialog && editingTeamFromManage && !selectedTeam && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center" onClick={() => {
          setShowEditTeamDialog(false)
          setEditingTeamFromManage(null)
        }}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Edit Team</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Team Name</label>
                <input
                  type="text"
                  value={teamFormData.name}
                  onChange={e => setTeamFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Engineering"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  autoFocus
                  disabled={editingTeamFromManage.name === 'Administrators'}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={teamFormData.description}
                  onChange={e => setTeamFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g., Core engineering team"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <ColorPickerDropdown
                    color={teamFormData.color}
                    onChange={(c) => c && setTeamFormData(prev => ({ ...prev, color: c }))}
                    triggerSize="lg"
                    showReset={false}
                    title="Team Color"
                  />
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${teamFormData.color}20`, color: teamFormData.color }}
                  >
                    {(() => {
                      const IconComp = (LucideIcons as any)[teamFormData.icon] || Users
                      return <IconComp size={16} />
                    })()}
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Icon</label>
                <IconPicker
                  value={teamFormData.icon}
                  onChange={(icon) => setTeamFormData(prev => ({ ...prev, icon }))}
                  color={teamFormData.color}
                />
              </div>
              
              <p className="text-xs text-plm-fg-muted bg-plm-bg p-2 rounded">
                Changes will update for all team members.
              </p>
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button 
                onClick={() => {
                  setShowEditTeamDialog(false)
                  setEditingTeamFromManage(null)
                }} 
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTeamFromManage}
                disabled={isSavingTeam || !teamFormData.name.trim()}
                className="btn btn-primary"
              >
                {isSavingTeam ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Job Title Dialog */}
      {showCreateTitleDialog && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center" onClick={() => {
          setShowCreateTitleDialog(false)
          setEditingJobTitle(null)
          setPendingTitleForUser(null)
        }}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">
              {editingJobTitle ? 'Edit Job Title' : 'Create Job Title'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Title Name</label>
                <input
                  type="text"
                  value={newTitleName}
                  onChange={e => setNewTitleName(e.target.value)}
                  placeholder="e.g., Quality Engineer"
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <ColorPickerDropdown
                    color={newTitleColor}
                    onChange={(c) => c && setNewTitleColor(c)}
                    triggerSize="lg"
                    showReset={false}
                    title="Title Color"
                  />
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: `${newTitleColor}20`, color: newTitleColor }}
                  >
                    {(() => {
                      const IconComp = (LucideIcons as any)[newTitleIcon] || Briefcase
                      return <IconComp size={16} />
                    })()}
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">Icon</label>
                <IconGridPicker
                  value={newTitleIcon}
                  onChange={setNewTitleIcon}
                  maxHeight="128px"
                  columns={8}
                />
              </div>
              
              {pendingTitleForUser && (
                <p className="text-sm text-plm-fg-muted">
                  Will assign to: <strong className="text-plm-fg">{pendingTitleForUser.full_name || pendingTitleForUser.email}</strong>
                </p>
              )}
              
              {editingJobTitle && (
                <p className="text-xs text-plm-fg-muted bg-plm-bg p-2 rounded">
                  Changes will update for all users with this title.
                </p>
              )}
            </div>
            
            <div className="flex gap-2 justify-end mt-6">
              <button 
                onClick={() => {
                  setShowCreateTitleDialog(false)
                  setEditingJobTitle(null)
                  setPendingTitleForUser(null)
                }} 
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={editingJobTitle ? handleUpdateJobTitle : handleCreateTitle}
                disabled={isCreatingTitle || !newTitleName.trim()}
                className="btn btn-primary"
              >
                {isCreatingTitle ? 'Saving...' : editingJobTitle ? 'Save Changes' : 'Create'}
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

      {/* Add to Team Modal */}
      {addToTeamUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setAddToTeamUser(null)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-2">Add to Team</h3>
            <p className="text-sm text-plm-fg-muted mb-4">
              Select a team for <strong>{addToTeamUser.full_name || addToTeamUser.email}</strong>
            </p>
            
            {teams.length === 0 ? (
              <div className="text-center py-4 text-sm text-plm-fg-muted bg-plm-bg rounded-lg border border-plm-border">
                No teams available. Create a team first.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {teams.map(team => {
                  const TeamIcon = (LucideIcons as any)[team.icon] || Users
                  return (
                    <button
                      key={team.id}
                      onClick={async () => {
                        try {
                          await supabase.from('team_members').insert({
                            team_id: team.id,
                            user_id: addToTeamUser.id,
                            added_by: user?.id
                          })
                          addToast('success', `Added ${addToTeamUser.full_name || addToTeamUser.email} to ${team.name}`)
                          loadOrgUsers()
                          loadTeams()
                          setAddToTeamUser(null)
                        } catch (err) {
                          addToast('error', 'Failed to add user to team')
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-plm-bg border border-plm-border hover:border-plm-accent hover:bg-plm-highlight transition-colors text-left"
                    >
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${team.color}15`, color: team.color }}
                      >
                        <TeamIcon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-plm-fg truncate">{team.name}</div>
                        {team.description && (
                          <div className="text-xs text-plm-fg-muted truncate">{team.description}</div>
                        )}
                      </div>
                      <div className="text-xs text-plm-fg-dim flex items-center gap-1">
                        <Users size={12} />
                        {team.member_count}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            
            <div className="flex justify-end mt-4">
              <button onClick={() => setAddToTeamUser(null)} className="btn btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workflow Roles Modal */}
      {editingWorkflowRolesUser && (
        <WorkflowRolesModal
          user={editingWorkflowRolesUser}
          workflowRoles={workflowRoles}
          userRoleIds={userWorkflowRoleAssignments[editingWorkflowRolesUser.id] || []}
          onClose={() => setEditingWorkflowRolesUser(null)}
          onSave={async (roleIds) => {
            if (!user) return
            try {
              // Remove existing assignments
              await supabase
                .from('user_workflow_roles')
                .delete()
                .eq('user_id', editingWorkflowRolesUser.id)
              
              // Add new assignments
              if (roleIds.length > 0) {
                await supabase
                  .from('user_workflow_roles')
                  .insert(roleIds.map(roleId => ({
                    user_id: editingWorkflowRolesUser.id,
                    workflow_role_id: roleId,
                    assigned_by: user.id
                  })))
              }
              
              addToast('success', `Updated workflow roles for ${editingWorkflowRolesUser.full_name || editingWorkflowRolesUser.email}`)
              loadWorkflowRoles()
              setEditingWorkflowRolesUser(null)
            } catch (err) {
              console.error('Failed to update workflow roles:', err)
              addToast('error', 'Failed to update workflow roles')
            }
          }}
          onUpdateRole={async (roleId, name, color, icon) => {
            try {
              const { error } = await supabase
                .from('workflow_roles')
                .update({ name, color, icon })
                .eq('id', roleId)
              
              if (error) throw error
              
              addToast('success', `Updated workflow role "${name}"`)
              await loadWorkflowRoles()
            } catch (err: any) {
              if (err.code === '23505') {
                addToast('error', 'A workflow role with this name already exists')
              } else {
                addToast('error', 'Failed to update workflow role')
              }
            }
          }}
          onDeleteRole={async (roleId) => {
            try {
              const { error } = await supabase
                .from('workflow_roles')
                .delete()
                .eq('id', roleId)
              
              if (error) throw error
              
              addToast('success', 'Deleted workflow role')
              await loadWorkflowRoles()
            } catch (err) {
              console.error('Failed to delete workflow role:', err)
              addToast('error', 'Failed to delete workflow role')
            }
          }}
          onCreateRole={() => {
            setEditingWorkflowRolesUser(null)
            setShowCreateWorkflowRoleDialog(true)
          }}
        />
      )}

      {/* User Teams Modal */}
      {editingTeamsUser && (
        <UserTeamsModal
          user={editingTeamsUser}
          allTeams={teams}
          userTeamIds={(editingTeamsUser.teams || []).map(t => t.id)}
          onClose={() => setEditingTeamsUser(null)}
          onSave={async (teamIds) => {
            if (!user) return
            try {
              // Get current team memberships
              const currentTeamIds = (editingTeamsUser.teams || []).map(t => t.id)
              
              // Teams to add (in teamIds but not in currentTeamIds)
              const toAdd = teamIds.filter(id => !currentTeamIds.includes(id))
              
              // Teams to remove (in currentTeamIds but not in teamIds)
              const toRemove = currentTeamIds.filter(id => !teamIds.includes(id))
              
              // Remove from teams
              for (const teamId of toRemove) {
                await supabase
                  .from('team_members')
                  .delete()
                  .eq('user_id', editingTeamsUser.id)
                  .eq('team_id', teamId)
              }
              
              // Add to teams
              for (const teamId of toAdd) {
                await supabase
                  .from('team_members')
                  .insert({
                    team_id: teamId,
                    user_id: editingTeamsUser.id,
                    added_by: user.id
                  })
              }
              
              addToast('success', `Updated teams for ${editingTeamsUser.full_name || editingTeamsUser.email}`)
              loadOrgUsers()
              loadTeams()
              setEditingTeamsUser(null)
            } catch (err) {
              console.error('Failed to update teams:', err)
              addToast('error', 'Failed to update teams')
            }
          }}
          onCreateTeam={() => {
            setEditingTeamsUser(null)
            resetTeamForm()
            setShowCreateTeamDialog(true)
          }}
        />
      )}

      {/* User Job Title Modal */}
      {editingJobTitleUser && (
        <UserJobTitleModal
          user={editingJobTitleUser}
          jobTitles={jobTitles}
          onClose={() => setEditingJobTitleUser(null)}
          onSelectTitle={async (titleId) => {
            await handleChangeJobTitle(editingJobTitleUser, titleId)
            setEditingJobTitleUser(null)
          }}
          onCreateTitle={() => {
            setPendingTitleForUser(editingJobTitleUser)
            setEditingJobTitleUser(null)
            openCreateJobTitle()
          }}
          onUpdateTitle={updateJobTitleDirect}
          onDeleteTitle={deleteJobTitleDirect}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}

// Workflow Roles Modal Component
function WorkflowRolesModal({
  user,
  workflowRoles,
  userRoleIds,
  onClose,
  onSave,
  onUpdateRole,
  onDeleteRole,
  onCreateRole
}: {
  user: OrgUser
  workflowRoles: WorkflowRoleBasic[]
  userRoleIds: string[]
  onClose: () => void
  onSave: (roleIds: string[]) => Promise<void>
  onUpdateRole: (roleId: string, name: string, color: string, icon: string) => Promise<void>
  onDeleteRole: (roleId: string) => Promise<void>
  onCreateRole?: () => void
}) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(userRoleIds)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Edit state
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null)
  
  const toggleRole = (roleId: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(roleId)
        ? prev.filter(id => id !== roleId)
        : [...prev, roleId]
    )
  }
  
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(selectedRoleIds)
    } finally {
      setIsSaving(false)
    }
  }
  
  const startEditing = (role: WorkflowRoleBasic) => {
    setEditingRoleId(role.id)
    setEditName(role.name)
    setEditColor(role.color)
    setEditIcon(role.icon)
  }
  
  const cancelEditing = () => {
    setEditingRoleId(null)
    setEditName('')
    setEditColor('')
    setEditIcon('')
  }
  
  const handleUpdateRole = async () => {
    if (!editingRoleId || !editName.trim()) return
    setIsUpdating(true)
    try {
      await onUpdateRole(editingRoleId, editName.trim(), editColor, editIcon)
      cancelEditing()
    } finally {
      setIsUpdating(false)
    }
  }
  
  const handleDeleteRole = async (roleId: string) => {
    setDeletingRoleId(roleId)
    try {
      await onDeleteRole(roleId)
      // Remove from selected if it was selected
      setSelectedRoleIds(prev => prev.filter(id => id !== roleId))
    } finally {
      setDeletingRoleId(null)
    }
  }
  
  const hasChanges = JSON.stringify([...selectedRoleIds].sort()) !== JSON.stringify([...userRoleIds].sort())
  
  const filteredRoles = workflowRoles.filter(r =>
    !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plm-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Shield size={20} className="text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Workflow Roles</h3>
              <p className="text-xs text-plm-fg-muted truncate max-w-[200px]">
                {user.full_name || user.email}
            </p>
          </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-4 border-b border-plm-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search roles..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredRoles.length === 0 ? (
            <div className="text-center py-6 text-sm text-plm-fg-muted">
              {searchQuery ? (
                `No roles match "${searchQuery}"`
              ) : (
                <>
                  <Shield size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No workflow roles defined yet.</p>
                  <p className="text-xs mt-1">Create roles in the Roles tab.</p>
                </>
              )}
            </div>
          ) : (
            <>
              {filteredRoles.map(role => {
                const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                const isSelected = selectedRoleIds.includes(role.id)
                const isEditing = editingRoleId === role.id
                const isDeleting = deletingRoleId === role.id
                
                if (isEditing) {
                  const EditIcon = (LucideIcons as any)[editIcon] || Shield
                  return (
                    <div key={role.id} className="p-3 rounded-lg border border-plm-accent bg-plm-accent/5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-plm-fg">Edit Role</span>
                        <button
                          onClick={cancelEditing}
                          className="p-1 text-plm-fg-muted hover:text-plm-fg"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Role name"
                        className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg text-sm placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <ColorPickerDropdown
                          color={editColor}
                          onChange={(c) => c && setEditColor(c)}
                          triggerSize="lg"
                          showReset={false}
                          title="Role Color"
                        />
                        <div
                          className="p-2 rounded-lg"
                          style={{ backgroundColor: `${editColor}20`, color: editColor }}
                        >
                          <EditIcon size={16} />
                        </div>
                      </div>
                      {/* Icon picker grid */}
                      <IconGridPicker
                        value={editIcon}
                        onChange={setEditIcon}
                        maxHeight="128px"
                        columns={8}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteRole(role.id)}
                          disabled={isDeleting}
                          className="btn btn-ghost btn-sm text-plm-error hover:bg-plm-error/10"
                        >
                          {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                        <button
                          onClick={handleUpdateRole}
                          disabled={isUpdating || !editName.trim()}
                          className="flex-1 btn btn-primary btn-sm flex items-center justify-center gap-2"
                        >
                          {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Save
                        </button>
                      </div>
                    </div>
                  )
                }
                
                return (
                  <button
                    key={role.id}
                    onClick={() => toggleRole(role.id)}
                    className={`w-full group flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-plm-accent bg-plm-accent/10'
                        : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${role.color}20`, color: role.color }}
                    >
                      <RoleIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm font-medium text-plm-fg">{role.name}</div>
                      {role.description && (
                        <div className="text-xs text-plm-fg-muted truncate">{role.description}</div>
                      )}
                    </div>
                    <div
                      onClick={e => { e.stopPropagation(); startEditing(role) }}
                      className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit role"
                    >
                      <Pencil size={12} />
                  </div>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'border-plm-accent bg-plm-accent'
                        : 'border-plm-fg-muted'
                    }`}>
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                  </button>
                )
              })}
            </>
          )}
          
          {/* Create new role option */}
          {!searchQuery && onCreateRole && (
            <button
              onClick={onCreateRole}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-plm-border text-purple-400 hover:border-purple-400 hover:bg-purple-500/5 transition-colors"
            >
              <Plus size={14} />
              Create new role
            </button>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// User Teams Modal Component
function UserTeamsModal({
  user,
  allTeams,
  userTeamIds,
  onClose,
  onSave,
  onCreateTeam
}: {
  user: OrgUser
  allTeams: { id: string; name: string; color: string; icon: string }[]
  userTeamIds: string[]
  onClose: () => void
  onSave: (teamIds: string[]) => Promise<void>
  onCreateTeam?: () => void
}) {
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(userTeamIds)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds(prev =>
      prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId]
    )
  }
  
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(selectedTeamIds)
    } finally {
      setIsSaving(false)
    }
  }
  
  const hasChanges = JSON.stringify([...selectedTeamIds].sort()) !== JSON.stringify([...userTeamIds].sort())
  
  const filteredTeams = allTeams.filter(t =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plm-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-plm-accent/10">
              <Users size={20} className="text-plm-accent" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Teams</h3>
              <p className="text-xs text-plm-fg-muted truncate max-w-[200px]">
                {user.full_name || user.email}
            </p>
          </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-4 border-b border-plm-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search teams..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredTeams.length === 0 ? (
            <div className="text-center py-6 text-sm text-plm-fg-muted">
              {searchQuery ? `No teams match "${searchQuery}"` : 'No teams available'}
            </div>
          ) : (
            filteredTeams.map(team => {
              const TeamIcon = (LucideIcons as any)[team.icon] || Users
              const isSelected = selectedTeamIds.includes(team.id)
              
              return (
                <button
                  key={team.id}
                  onClick={() => toggleTeam(team.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent/10'
                      : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${team.color}20`, color: team.color }}
                  >
                    <TeamIcon size={16} />
                  </div>
                  <span className="flex-1 text-left text-sm text-plm-fg font-medium">{team.name}</span>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent'
                      : 'border-plm-fg-muted'
                  }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                </button>
              )
            })
          )}
          
          {/* Create new team option */}
          {!searchQuery && onCreateTeam && (
            <button
              onClick={onCreateTeam}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-plm-border text-plm-accent hover:border-plm-accent hover:bg-plm-accent/5 transition-colors"
            >
              <Plus size={14} />
              Create new team
            </button>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// User Job Title Modal Component
function UserJobTitleModal({
  user,
  jobTitles,
  onClose,
  onSelectTitle,
  onCreateTitle,
  onUpdateTitle,
  onDeleteTitle,
  isAdmin
}: {
  user: OrgUser
  jobTitles: { id: string; name: string; color: string; icon: string }[]
  onClose: () => void
  onSelectTitle: (titleId: string | null) => Promise<void>
  onCreateTitle: () => void
  onUpdateTitle?: (titleId: string, name: string, color: string, icon: string) => Promise<void>
  onDeleteTitle?: (titleId: string) => Promise<void>
  isAdmin?: boolean
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(user.job_title?.id || null)
  
  // Edit state
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [deletingTitleId, setDeletingTitleId] = useState<string | null>(null)
  
  const filteredTitles = jobTitles.filter(t =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSelectTitle(selectedTitleId)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }
  
  const startEditing = (title: { id: string; name: string; color: string; icon: string }) => {
    setEditingTitleId(title.id)
    setEditName(title.name)
    setEditColor(title.color)
    setEditIcon(title.icon)
  }
  
  const cancelEditing = () => {
    setEditingTitleId(null)
    setEditName('')
    setEditColor('')
    setEditIcon('')
  }
  
  const handleUpdateTitle = async () => {
    if (!editingTitleId || !editName.trim() || !onUpdateTitle) return
    setIsUpdating(true)
    try {
      await onUpdateTitle(editingTitleId, editName.trim(), editColor, editIcon)
      cancelEditing()
    } finally {
      setIsUpdating(false)
    }
  }
  
  const handleDeleteTitle = async (titleId: string) => {
    if (!onDeleteTitle) return
    setDeletingTitleId(titleId)
    try {
      await onDeleteTitle(titleId)
      // If the deleted title was selected, clear selection
      if (selectedTitleId === titleId) {
        setSelectedTitleId(null)
      }
    } finally {
      setDeletingTitleId(null)
    }
  }
  
  const hasChanges = selectedTitleId !== (user.job_title?.id || null)
  
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plm-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-plm-accent/10">
              <Briefcase size={20} className="text-plm-accent" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-plm-fg">Job Title</h3>
              <p className="text-xs text-plm-fg-muted truncate max-w-[200px]">
                {user.full_name || user.email}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-4 border-b border-plm-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search job titles..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* No title option */}
          <button
            onClick={() => setSelectedTitleId(null)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              selectedTitleId === null
                ? 'border-plm-accent bg-plm-accent/10'
                : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
            }`}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-plm-fg-muted/10 text-plm-fg-muted">
              <X size={16} />
            </div>
            <span className="flex-1 text-left text-sm text-plm-fg-muted">No title</span>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              selectedTitleId === null
                ? 'border-plm-accent bg-plm-accent'
                : 'border-plm-fg-muted'
            }`}>
              {selectedTitleId === null && <Check size={12} className="text-white" />}
            </div>
          </button>
          
          {filteredTitles.length === 0 && searchQuery ? (
            <div className="text-center py-6 text-sm text-plm-fg-muted">
              No titles match "{searchQuery}"
            </div>
          ) : (
            filteredTitles.map(title => {
              const TitleIcon = (LucideIcons as any)[title.icon] || Briefcase
              const isSelected = selectedTitleId === title.id
              const isEditing = editingTitleId === title.id
              const isDeleting = deletingTitleId === title.id
              
              if (isEditing && isAdmin) {
                const EditIcon = (LucideIcons as any)[editIcon] || Briefcase
                return (
                  <div key={title.id} className="p-3 rounded-lg border border-plm-accent bg-plm-accent/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-plm-fg">Edit Job Title</span>
                      <button
                        onClick={cancelEditing}
                        className="p-1 text-plm-fg-muted hover:text-plm-fg"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Title name"
                      className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg text-sm placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <ColorPickerDropdown
                        color={editColor}
                        onChange={(c) => c && setEditColor(c)}
                        triggerSize="lg"
                        showReset={false}
                        title="Title Color"
                      />
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${editColor}20`, color: editColor }}
                      >
                        <EditIcon size={16} />
                      </div>
                    </div>
                    {/* Icon picker grid */}
                    <IconGridPicker
                      value={editIcon}
                      onChange={setEditIcon}
                      maxHeight="128px"
                      columns={8}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteTitle(title.id)}
                        disabled={isDeleting}
                        className="btn btn-ghost btn-sm text-plm-error hover:bg-plm-error/10"
                      >
                        {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                      <button
                        onClick={handleUpdateTitle}
                        disabled={isUpdating || !editName.trim()}
                        className="flex-1 btn btn-primary btn-sm flex items-center justify-center gap-2"
                      >
                        {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Save
                      </button>
                    </div>
                  </div>
                )
              }
              
              return (
                <button
                  key={title.id}
                  onClick={() => setSelectedTitleId(title.id)}
                  className={`w-full group flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent/10'
                      : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${title.color}20`, color: title.color }}
                  >
                    <TitleIcon size={16} />
                  </div>
                  <span className="flex-1 text-left text-sm text-plm-fg font-medium">{title.name}</span>
                  {isAdmin && onUpdateTitle && (
                    <div
                      onClick={e => { e.stopPropagation(); startEditing(title) }}
                      className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit title"
                    >
                      <Pencil size={12} />
                    </div>
                  )}
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent'
                      : 'border-plm-fg-muted'
                  }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                </button>
              )
            })
          )}
          
          {/* Create new option */}
          {!searchQuery && (
            <button
              onClick={onCreateTitle}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-plm-border text-plm-accent hover:border-plm-accent hover:bg-plm-accent/5 transition-colors"
            >
              <Plus size={14} />
              Create new job title
            </button>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// User Row Component
function UserRow({
  user,
  isAdmin,
  isCurrentUser,
  onViewProfile,
  onRemove,
  onRemoveFromTeam,
  onVaultAccess,
  onPermissions,
  vaultAccessCount,
  compact,
  showAddToTeam,
  onOpenAddToTeamModal,
  onEditJobTitle,
  workflowRoles,
  userWorkflowRoleIds,
  onEditWorkflowRoles,
  teams,
  onEditTeams
}: {
  user: OrgUser
  isAdmin: boolean
  isCurrentUser: boolean
  onViewProfile: () => void
  onRemove: () => void
  onRemoveFromTeam?: () => void
  onVaultAccess: () => void
  onPermissions?: () => void
  vaultAccessCount: number
  compact?: boolean
  showAddToTeam?: boolean
  onOpenAddToTeamModal?: () => void
  onEditJobTitle?: (user: OrgUser) => void
  workflowRoles?: WorkflowRoleBasic[]
  userWorkflowRoleIds?: string[]
  onEditWorkflowRoles?: (user: OrgUser) => void
  teams?: { id: string; name: string; color: string; icon: string }[]
  onEditTeams?: (user: OrgUser) => void
}) {
  // Admins can manage settings for everyone including themselves
  const canManage = isAdmin
  
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
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-plm-fg-muted truncate flex items-center gap-2 flex-wrap`}>
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
      
      {/* Job title badge */}
      {(user.job_title || (canManage && onEditJobTitle)) && (
        canManage && onEditJobTitle ? (
              <button
            onClick={() => onEditJobTitle(user)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  user.job_title 
                ? 'hover:ring-1 hover:ring-current' 
                : 'bg-plm-fg-muted/10 text-plm-fg-muted border border-dashed border-plm-border hover:border-plm-accent hover:text-plm-accent'
                }`}
                style={user.job_title ? { backgroundColor: `${user.job_title.color}15`, color: user.job_title.color } : {}}
              >
            {user.job_title ? (
                  (() => {
                const TitleIcon = (LucideIcons as any)[user.job_title.icon] || Briefcase
                    return <TitleIcon size={12} />
                  })()
                ) : (
              <Briefcase size={12} />
                )}
                {user.job_title?.name || 'No title'}
              </button>
          ) : user.job_title ? (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
              style={{ backgroundColor: `${user.job_title.color}15`, color: user.job_title.color }}
            >
              {(() => {
              const TitleIcon = (LucideIcons as any)[user.job_title.icon] || Briefcase
                return <TitleIcon size={12} />
              })()}
              {user.job_title.name}
            </div>
        ) : null
      )}
      
      {/* Teams and Roles badges - side by side */}
      {!compact && (
        <div className="flex items-center gap-1.5">
          {/* Teams badge */}
          {teams && teams.length > 0 && (user.teams || []).length > 0 ? (
            canManage && onEditTeams ? (
              <button
                onClick={() => onEditTeams(user)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors bg-plm-accent/10 text-plm-accent hover:ring-1 hover:ring-plm-accent cursor-pointer"
                title={(user.teams || []).map(t => t.name).join(', ')}
              >
                <Users size={12} />
                <span>{(user.teams || []).length} team{(user.teams || []).length !== 1 ? 's' : ''}</span>
                <ChevronDown size={12} />
              </button>
            ) : (
              <span
                className="flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap bg-plm-accent/10 text-plm-accent"
                title={(user.teams || []).map(t => t.name).join(', ')}
              >
                <Users size={12} />
                <span>{(user.teams || []).length} team{(user.teams || []).length !== 1 ? 's' : ''}</span>
              </span>
            )
          ) : teams && teams.length > 0 && canManage && onEditTeams ? (
            <button
              onClick={() => onEditTeams(user)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-yellow-500/10 text-yellow-500 border border-dashed border-yellow-500/30 hover:border-yellow-500 hover:bg-yellow-500/20 transition-colors"
              title="Unassigned - click to add to a team"
            >
              <UserX size={12} />
              Unassigned
              <ChevronDown size={12} />
            </button>
          ) : teams && teams.length > 0 ? (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-yellow-500/10 text-yellow-500">
              <UserX size={12} />
              Unassigned
            </span>
          ) : null}
          
          {/* Workflow roles badge */}
          {workflowRoles && workflowRoles.length > 0 && (
            <>
              {userWorkflowRoleIds && userWorkflowRoleIds.length > 0 ? (
                canManage && onEditWorkflowRoles ? (
                  <button
                    onClick={() => onEditWorkflowRoles(user)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors bg-purple-500/10 text-purple-400 hover:ring-1 hover:ring-purple-400 cursor-pointer"
                    title={userWorkflowRoleIds.map(id => workflowRoles.find(r => r.id === id)?.name).filter(Boolean).join(', ')}
                  >
                    <Shield size={12} />
                    <span>{userWorkflowRoleIds.length} role{userWorkflowRoleIds.length !== 1 ? 's' : ''}</span>
                    <ChevronDown size={12} />
                  </button>
                ) : (
                  <span
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap bg-purple-500/10 text-purple-400"
                    title={userWorkflowRoleIds.map(id => workflowRoles.find(r => r.id === id)?.name).filter(Boolean).join(', ')}
                  >
                    <Shield size={12} />
                    <span>{userWorkflowRoleIds.length} role{userWorkflowRoleIds.length !== 1 ? 's' : ''}</span>
                  </span>
                )
              ) : canManage && onEditWorkflowRoles ? (
                <button
                  onClick={() => onEditWorkflowRoles(user)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-plm-fg-muted/10 text-plm-fg-muted border border-dashed border-plm-border hover:border-purple-400 hover:text-purple-400 transition-colors"
                  title="Add workflow roles"
                >
                  <Shield size={12} />
                  No roles
                  <ChevronDown size={12} />
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
      
      {/* Workflow roles badge - compact mode (team member rows) */}
      {compact && workflowRoles && workflowRoles.length > 0 && (
        <div className="flex items-center">
          {userWorkflowRoleIds && userWorkflowRoleIds.length > 0 ? (
            canManage && onEditWorkflowRoles ? (
              <button
                onClick={() => onEditWorkflowRoles(user)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors bg-purple-500/10 text-purple-400 hover:ring-1 hover:ring-purple-400 cursor-pointer"
                title={userWorkflowRoleIds.map(id => workflowRoles.find(r => r.id === id)?.name).filter(Boolean).join(', ')}
              >
                <Shield size={12} />
                <span>{userWorkflowRoleIds.length} role{userWorkflowRoleIds.length !== 1 ? 's' : ''}</span>
                <ChevronDown size={12} />
              </button>
            ) : (
              <span
                className="flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap bg-purple-500/10 text-purple-400"
                title={userWorkflowRoleIds.map(id => workflowRoles.find(r => r.id === id)?.name).filter(Boolean).join(', ')}
              >
                <Shield size={12} />
                <span>{userWorkflowRoleIds.length} role{userWorkflowRoleIds.length !== 1 ? 's' : ''}</span>
              </span>
            )
          ) : canManage && onEditWorkflowRoles ? (
            <button
              onClick={() => onEditWorkflowRoles(user)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-plm-fg-muted/10 text-plm-fg-muted border border-dashed border-plm-border hover:border-purple-400 hover:text-purple-400 transition-colors"
              title="Add workflow roles"
            >
              <Shield size={12} />
              No roles
              <ChevronDown size={12} />
            </button>
          ) : null}
        </div>
      )}
      
      {/* Action buttons */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Add to team button */}
        {showAddToTeam && onOpenAddToTeamModal && (
          <button
            onClick={onOpenAddToTeamModal}
            className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors"
            title="Add to team"
          >
            <UserPlus size={14} />
          </button>
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
        
        {/* Individual vault access button - only show in users section (not in team member rows) */}
        {canManage && !compact && (
          <button
            onClick={onVaultAccess}
            className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors"
            title="Individual vault access"
          >
            <Lock size={14} />
          </button>
        )}
        
        {/* Remove from team button */}
        {canManage && onRemoveFromTeam && (
          <button
            onClick={onRemoveFromTeam}
            className="p-1.5 text-plm-fg-muted hover:text-plm-warning hover:bg-plm-warning/10 rounded transition-colors"
            title="Remove from team"
          >
            <X size={14} />
          </button>
        )}
        
        {/* Remove from organization button */}
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
              <div className="flex items-center gap-2 p-2 bg-plm-bg border border-plm-border rounded-lg">
                <ColorPickerDropdown
                  color={formData.color}
                  onChange={(c) => c && setFormData({ ...formData, color: c })}
                  triggerSize="lg"
                  showReset={false}
                  title="Team Color"
                  position="left"
                />
                <div
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: `${formData.color}20`, color: formData.color }}
                >
                  <IconComponent size={16} />
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Icon</label>
              <IconPicker
                value={formData.icon}
                onChange={(icon) => setFormData({ ...formData, icon })}
                color={formData.color}
              />
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center overflow-hidden" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-4xl h-[85vh] mx-4 flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
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
        <div className="flex-1 overflow-y-auto p-4 bg-plm-bg-light">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
            </div>
          ) : (
            <div className="space-y-0">
              {filteredResources.map(resource => {
                const ResourceIcon = (LucideIcons as any)[resource.icon] || Shield
                const currentActions = permissions[resource.id] || []
                
                return (
                  <div
                    key={resource.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-plm-highlight/30 transition-colors"
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
  isRemoving,
  isSelf = false
}: {
  user: OrgUser
  onClose: () => void
  onConfirm: () => void
  isRemoving: boolean
  isSelf?: boolean
}) {
  const [confirmText, setConfirmText] = useState('')
  
  const displayName = user.full_name || user.email
  const confirmPhrase = isSelf ? 'confirm' : displayName
  const isConfirmed = confirmText === confirmPhrase
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-full bg-plm-error/20">
            <AlertTriangle className="w-5 h-5 text-plm-error" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">
              {isSelf ? 'Leave Organization' : 'Remove User from Organization'}
            </h3>
            <p className="text-sm text-plm-fg-muted mt-1">This action cannot be undone</p>
          </div>
        </div>
        
        <div className="space-y-4 mb-6">
          <div className="p-3 bg-plm-error/10 border border-plm-error/30 rounded-lg">
            <p className="text-sm text-plm-fg">
              {isSelf ? (
                <>You are about to <strong>leave this organization</strong>. You will:</>
              ) : (
                <>You are about to remove <strong>{displayName}</strong> from this organization. They will:</>
              )}
            </p>
            <ul className="text-sm text-plm-fg-muted list-disc list-inside mt-2 space-y-1">
              <li>Lose access to all vaults and files</li>
              <li>Be removed from all teams</li>
              <li>Need to be re-invited to rejoin</li>
            </ul>
          </div>
          
          <div>
            <p className="text-sm text-plm-fg-muted mb-2">
              To confirm, type <strong className="text-plm-fg">{confirmPhrase}</strong> below:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
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
            {isRemoving ? 'Removing...' : isSelf ? 'Leave Organization' : 'Remove User'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Dialog for confirming removal from Administrators team
function RemoveFromAdminsDialog({
  user,
  teamName,
  onClose,
  onConfirm,
  isRemoving
}: {
  user: OrgUser
  teamName: string
  onClose: () => void
  onConfirm: () => void
  isRemoving: boolean
}) {
  const [confirmText, setConfirmText] = useState('')
  
  const confirmPhrase = 'confirm'
  const isConfirmed = confirmText === confirmPhrase
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-full bg-plm-warning/20">
            <AlertTriangle className="w-5 h-5 text-plm-warning" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Leave {teamName} Team</h3>
            <p className="text-sm text-plm-fg-muted mt-1">This may affect your admin privileges</p>
          </div>
        </div>
        
        <div className="space-y-4 mb-6">
          <div className="p-3 bg-plm-warning/10 border border-plm-warning/30 rounded-lg">
            <p className="text-sm text-plm-fg">
              You are about to remove yourself from the <strong>{teamName}</strong> team. 
            </p>
            <ul className="text-sm text-plm-fg-muted list-disc list-inside mt-2 space-y-1">
              <li>You may lose admin-level permissions</li>
              <li>You won't be able to manage team settings</li>
              <li>Another admin will need to add you back</li>
            </ul>
          </div>
          
          <div>
            <p className="text-sm text-plm-fg-muted mb-2">
              To confirm, type <strong className="text-plm-fg">{confirmPhrase}</strong> below:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-warning"
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
                ? 'bg-plm-warning hover:bg-plm-warning/90 text-white'
                : 'bg-plm-fg-muted/20 text-plm-fg-muted cursor-not-allowed'
            }`}
          >
            {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
            {isRemoving ? 'Leaving...' : 'Leave Team'}
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
  currentUserId,
  currentUserName,
  orgName,
  vaults,
  workflowRoles,
  apiUrl,
  orgCode
}: {
  onClose: () => void
  onCreated: () => void
  teams: TeamWithDetails[]
  orgId: string
  currentUserId?: string
  currentUserName?: string
  orgName?: string
  vaults: { id: string; name: string; description?: string }[]
  workflowRoles: WorkflowRoleBasic[]
  apiUrl?: string | null
  orgCode?: string
}) {
  const { addToast } = usePDMStore()
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([])
  const [selectedWorkflowRoleIds, setSelectedWorkflowRoleIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [sendInviteEmail, setSendInviteEmail] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  
  const handleCreate = async () => {
    if (!email || !isValidEmail || !currentUserId) return
    
    setIsSaving(true)
    try {
      // If we have API URL and want to send invite, use API endpoint
      if (sendInviteEmail && apiUrl) {
        // Get current session token
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          addToast('error', 'Session expired, please log in again')
          return
        }
        
        const response = await fetch(`${apiUrl}/auth/invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            full_name: fullName.trim() || undefined,
            team_ids: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
            vault_ids: selectedVaultIds.length > 0 ? selectedVaultIds : undefined,
            workflow_role_ids: selectedWorkflowRoleIds.length > 0 ? selectedWorkflowRoleIds : undefined,
            notes: notes.trim() || undefined
          })
        })
        
        const result = await response.json()
        
        if (!response.ok) {
          if (response.status === 409) {
            addToast('error', 'A user with this email already exists or is pending')
          } else {
            throw new Error(result.message || 'Failed to invite user')
          }
          return
        }
        
        addToast('success', result.message || `Invite sent to ${email}`)
        onCreated()
        onClose()
        return
      }
      
      // Otherwise just create pending member without email
      const normalizedEmail = email.toLowerCase().trim()
      
      // First check if user is already in the org
      const { data: existingUsers } = await supabase
        .from('users')
        .select('id, org_id')
        .ilike('email', normalizedEmail)
      
      const existingUser = existingUsers?.[0]
      if (existingUser?.org_id === orgId) {
        addToast('error', 'This user is already a member of your organization')
        return
      }
      
      // Delete any existing pending record for this email (in case of re-invite)
      await supabase
        .from('pending_org_members')
        .delete()
        .eq('org_id', orgId)
        .ilike('email', normalizedEmail)
      
      const { error } = await supabase
        .from('pending_org_members')
        .insert({
          org_id: orgId,
          email: normalizedEmail,
          full_name: fullName.trim() || null,
          role: 'viewer',  // Default role, permissions come from teams
          team_ids: selectedTeamIds,
          vault_ids: selectedVaultIds,
          workflow_role_ids: selectedWorkflowRoleIds,
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
  
  const toggleVault = (vaultId: string) => {
    setSelectedVaultIds(current =>
      current.includes(vaultId)
        ? current.filter(id => id !== vaultId)
        : [...current, vaultId]
    )
  }
  
  const toggleWorkflowRole = (roleId: string) => {
    setSelectedWorkflowRoleIds(current =>
      current.includes(roleId)
        ? current.filter(id => id !== roleId)
        : [...current, roleId]
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
          
          {/* Vault Access */}
          {vaults.length > 0 && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Vault Access</label>
              <div className={`p-3 rounded-lg border mb-2 ${
                selectedVaultIds.length === 0
                  ? 'bg-plm-success/10 border-plm-success/30'
                  : 'bg-plm-warning/10 border-plm-warning/30'
              }`}>
                <div className="flex items-center gap-2">
                  <Database size={16} className={selectedVaultIds.length === 0 ? 'text-plm-success' : 'text-plm-warning'} />
                  <span className={`text-sm ${selectedVaultIds.length === 0 ? 'text-plm-success' : 'text-plm-warning'}`}>
                    {selectedVaultIds.length === 0 
                      ? 'All vaults (no restrictions)' 
                      : `Restricted to ${selectedVaultIds.length} of ${vaults.length} vaults`}
                  </span>
                </div>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg p-2">
                {vaults.map(vault => {
                  const isSelected = selectedVaultIds.includes(vault.id)
                  return (
                    <label
                      key={vault.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleVault(vault.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                      />
                      <Database size={14} className="text-plm-fg-muted" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-plm-fg">{vault.name}</span>
                        {vault.description && (
                          <span className="text-xs text-plm-fg-dim ml-2">{vault.description}</span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-plm-fg-dim mt-1">
                Leave all unchecked for full access. Check specific vaults to restrict access.
              </p>
            </div>
          )}
          
          {/* Workflow Roles */}
          {workflowRoles.length > 0 && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Workflow Roles</label>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg p-2">
                {workflowRoles.map(role => {
                  const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                  const isSelected = selectedWorkflowRoleIds.includes(role.id)
                  return (
                    <label
                      key={role.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleWorkflowRole(role.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                      />
                      <div
                        className="p-1.5 rounded"
                        style={{ backgroundColor: `${role.color}15`, color: role.color }}
                      >
                        <RoleIcon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-plm-fg">{role.name}</span>
                        {role.description && (
                          <span className="text-xs text-plm-fg-dim ml-2">{role.description}</span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-plm-fg-dim mt-1">
                Workflow roles for approval processes (e.g., R&D Approver, QA Reviewer)
              </p>
            </div>
          )}
          
          {/* Send Invite Email */}
          <div className="pt-2 border-t border-plm-border">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendInviteEmail}
                  onChange={e => setSendInviteEmail(e.target.checked)}
                  disabled={!apiUrl}
                  className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <Mail size={16} className={sendInviteEmail && apiUrl ? 'text-plm-accent' : 'text-plm-fg-muted'} />
                  <span className={`text-sm ${sendInviteEmail && apiUrl ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
                    Send invite email
                  </span>
                </div>
              </label>
              {apiUrl && sendInviteEmail && (
                <button
                  type="button"
                  onClick={() => setShowEmailPreview(!showEmailPreview)}
                  className="text-xs text-plm-accent hover:text-plm-accent/80 transition-colors"
                >
                  {showEmailPreview ? 'Hide preview' : 'Preview email'}
                </button>
              )}
            </div>
            {!apiUrl && (
              <p className="text-xs text-plm-fg-dim mt-1.5 ml-7">
                Configure API URL in Settings → REST API to enable invite emails
              </p>
            )}
            
            {/* Email Preview */}
            {apiUrl && sendInviteEmail && showEmailPreview && (
              <div className="mt-3 ml-7 p-4 bg-white border border-plm-border rounded-lg text-sm">
                <div className="text-gray-500 text-xs mb-3 pb-2 border-b border-gray-200">
                  <div><strong>To:</strong> {email || 'user@example.com'}</div>
                  <div><strong>From:</strong> BluePLM &lt;noreply@blueplm.app&gt;</div>
                  <div><strong>Subject:</strong> You've been invited to {orgName || 'an organization'}</div>
                </div>
                <div className="text-gray-800 space-y-3">
                  <p>Hi{fullName ? ` ${fullName}` : ''},</p>
                  <p>
                    <strong>{currentUserName || 'A team member'}</strong> has invited you to join{' '}
                    <strong>{orgName || 'their organization'}</strong> on BluePLM.
                  </p>
                  <p>BluePLM is a Product Data Management system for engineering teams.</p>
                  <div className="my-4">
                    <span className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
                      Accept Invitation
                    </span>
                  </div>
                  {orgCode && (
                    <div className="my-4 p-3 bg-gray-100 rounded-lg">
                      <p className="text-gray-600 text-xs mb-1">Organization Code:</p>
                      <code className="text-sm font-mono text-gray-800 break-all">{orgCode}</code>
                    </div>
                  )}
                  <p className="text-gray-500 text-xs">
                    If you didn't expect this invitation, you can ignore this email.
                  </p>
                </div>
              </div>
            )}
          </div>
          
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

