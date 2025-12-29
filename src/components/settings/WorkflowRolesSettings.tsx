// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  BadgeCheck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  UserPlus,
  X,
  Check,
  Search,
  MoreVertical,
  Users,
  GitBranch,
  ExternalLink
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import { getInitials } from '../../types/pdm'
import type { WorkflowRole, WorkflowRoleAssignment } from '../../types/workflow'

// Popular icons for workflow role selection
const ROLE_ICONS = [
  'BadgeCheck', 'ShieldCheck', 'UserCheck', 'ClipboardCheck',
  'Award', 'Crown', 'Star', 'Medal',
  'Briefcase', 'Wrench', 'Microscope', 'Beaker',
  'FileCheck', 'ListChecks', 'CheckCircle', 'CircleCheck',
  'Lock', 'Key', 'Shield', 'ShieldAlert',
  'Eye', 'EyeCheck', 'Scan', 'Target'
]

// Preset colors for roles
const ROLE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b', '#78716c'
]

interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: 'admin' | 'engineer' | 'viewer'
}

interface WorkflowRoleWithAssignments extends WorkflowRole {
  user_count: number
  assignments: WorkflowRoleAssignment[]
}

export function WorkflowRolesSettings() {
  const { user, organization, addToast, getEffectiveRole } = usePDMStore()
  
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [roles, setRoles] = useState<WorkflowRoleWithAssignments[]>([])
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedRole, setSelectedRole] = useState<WorkflowRoleWithAssignments | null>(null)
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set())
  
  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    icon: 'BadgeCheck'
  })
  const [isSaving, setIsSaving] = useState(false)
  
  // Assignment state
  const [assignSearchQuery, setAssignSearchQuery] = useState('')
  const [pendingAssignments, setPendingAssignments] = useState<string[]>([])
  
  // Load roles on mount
  useEffect(() => {
    if (organization) {
      loadRoles()
      loadOrgUsers()
    }
  }, [organization])
  
  const loadRoles = async () => {
    if (!organization) return
    
    setIsLoading(true)
    try {
      // First load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('workflow_roles')
        .select('*')
        .eq('org_id', organization.id)
        .order('sort_order')
        .order('name')
      
      if (rolesError) throw rolesError
      
      // Then load assignments with user data
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('user_workflow_roles')
        .select(`
          id,
          user_id,
          workflow_role_id,
          assigned_at,
          assigned_by,
          user:user_id(id, email, full_name, avatar_url, role)
        `)
        .in('workflow_role_id', (rolesData || []).map(r => r.id))
      
      if (assignmentsError) {
        console.warn('Failed to load assignments:', assignmentsError)
      }
      
      // Group assignments by role
      const assignmentsByRole: Record<string, any[]> = {}
      for (const assignment of (assignmentsData || [])) {
        const roleId = assignment.workflow_role_id
        if (!assignmentsByRole[roleId]) {
          assignmentsByRole[roleId] = []
        }
        assignmentsByRole[roleId].push(assignment)
      }
      
      const rolesWithAssignments = (rolesData || []).map(role => ({
        ...role,
        user_count: assignmentsByRole[role.id]?.length || 0,
        assignments: assignmentsByRole[role.id] || []
      }))
      
      setRoles(rolesWithAssignments)
    } catch (err) {
      console.error('Failed to load workflow roles:', err)
      addToast('error', 'Failed to load workflow roles')
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadOrgUsers = async () => {
    if (!organization) return
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, role')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (error) throw error
      setOrgUsers(data || [])
    } catch (err) {
      console.error('Failed to load users:', err)
    }
  }
  
  const handleCreateRole = async () => {
    if (!organization || !user || !formData.name.trim()) return
    
    setIsSaving(true)
    try {
      const { data, error } = await supabase
        .from('workflow_roles')
        .insert({
          org_id: organization.id,
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          color: formData.color,
          icon: formData.icon,
          sort_order: roles.length,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      addToast('success', `Workflow role "${formData.name}" created`)
      setShowCreateDialog(false)
      setFormData({ name: '', description: '', color: '#3b82f6', icon: 'BadgeCheck' })
      loadRoles()
    } catch (err: any) {
      console.error('Failed to create role:', err)
      if (err.code === '23505') {
        addToast('error', 'A role with this name already exists')
      } else {
        addToast('error', 'Failed to create role')
      }
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleUpdateRole = async () => {
    if (!selectedRole || !formData.name.trim()) return
    
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .update({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          color: formData.color,
          icon: formData.icon,
          updated_by: user?.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedRole.id)
      
      if (error) throw error
      
      addToast('success', 'Workflow role updated')
      setShowEditDialog(false)
      setSelectedRole(null)
      loadRoles()
    } catch (err: any) {
      console.error('Failed to update role:', err)
      if (err.code === '23505') {
        addToast('error', 'A role with this name already exists')
      } else {
        addToast('error', 'Failed to update role')
      }
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleDeleteRole = async () => {
    if (!selectedRole) return
    
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .delete()
        .eq('id', selectedRole.id)
      
      if (error) throw error
      
      addToast('success', `Workflow role "${selectedRole.name}" deleted`)
      setShowDeleteDialog(false)
      setSelectedRole(null)
      loadRoles()
    } catch (err) {
      console.error('Failed to delete role:', err)
      addToast('error', 'Failed to delete role')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleSaveAssignments = async () => {
    if (!selectedRole || !user) return
    
    setIsSaving(true)
    try {
      // Get current assignments
      const currentUserIds = selectedRole.assignments.map(a => a.user_id)
      
      // Find users to add and remove
      const toAdd = pendingAssignments.filter(id => !currentUserIds.includes(id))
      const toRemove = currentUserIds.filter(id => !pendingAssignments.includes(id))
      
      // Add new assignments
      if (toAdd.length > 0) {
        const { error: addError } = await supabase
          .from('user_workflow_roles')
          .insert(toAdd.map(userId => ({
            user_id: userId,
            workflow_role_id: selectedRole.id,
            assigned_by: user.id
          })))
        
        if (addError) throw addError
      }
      
      // Remove old assignments
      if (toRemove.length > 0) {
        const { error: removeError } = await supabase
          .from('user_workflow_roles')
          .delete()
          .eq('workflow_role_id', selectedRole.id)
          .in('user_id', toRemove)
        
        if (removeError) throw removeError
      }
      
      addToast('success', 'Role assignments updated')
      setShowAssignDialog(false)
      setSelectedRole(null)
      loadRoles()
    } catch (err) {
      console.error('Failed to update assignments:', err)
      addToast('error', 'Failed to update assignments')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleRemoveAssignment = async (roleId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('user_workflow_roles')
        .delete()
        .eq('workflow_role_id', roleId)
        .eq('user_id', userId)
      
      if (error) throw error
      
      addToast('success', 'User removed from role')
      loadRoles()
    } catch (err) {
      console.error('Failed to remove assignment:', err)
      addToast('error', 'Failed to remove user from role')
    }
  }
  
  const toggleRoleExpanded = (roleId: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) {
        next.delete(roleId)
      } else {
        next.add(roleId)
      }
      return next
    })
  }
  
  const openEditDialog = (role: WorkflowRoleWithAssignments) => {
    setSelectedRole(role)
    setFormData({
      name: role.name,
      description: role.description || '',
      color: role.color,
      icon: role.icon
    })
    setShowEditDialog(true)
  }
  
  const openAssignDialog = (role: WorkflowRoleWithAssignments) => {
    setSelectedRole(role)
    setPendingAssignments(role.assignments.map(a => a.user_id))
    setAssignSearchQuery('')
    setShowAssignDialog(true)
  }
  
  const filteredUsers = assignSearchQuery
    ? orgUsers.filter(u => 
        u.email.toLowerCase().includes(assignSearchQuery.toLowerCase()) ||
        (u.full_name && u.full_name.toLowerCase().includes(assignSearchQuery.toLowerCase()))
      )
    : orgUsers
  
  // Get dynamic icon component
  const getIconComponent = (iconName: string) => {
    const Icon = (LucideIcons as any)[iconName]
    return Icon || BadgeCheck
  }
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 size={24} className="animate-spin text-pdm-accent" />
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <BadgeCheck size={20} className="text-pdm-accent" />
            Workflow Roles
          </h3>
          <p className="text-sm text-pdm-fg-muted mt-1">
            Define approval roles for workflow states and gates. Assign members to roles for approval authority.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              setFormData({ name: '', description: '', color: '#3b82f6', icon: 'BadgeCheck' })
              setShowCreateDialog(true)
            }}
            className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white"
          >
            <Plus size={16} />
            New Role
          </button>
        )}
      </div>
      
      {/* Roles List */}
      {roles.length === 0 ? (
        <div className="text-center py-12 border border-pdm-border rounded-lg bg-pdm-bg-light">
          <BadgeCheck size={48} className="mx-auto mb-3 text-pdm-fg-muted/50" />
          <p className="text-pdm-fg-muted mb-2">No workflow roles defined</p>
          {isAdmin && (
            <button
              onClick={() => {
                setFormData({ name: '', description: '', color: '#3b82f6', icon: 'BadgeCheck' })
                setShowCreateDialog(true)
              }}
              className="text-pdm-accent hover:underline text-sm"
            >
              Create your first workflow role
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {roles.map(role => {
            const isExpanded = expandedRoles.has(role.id)
            const IconComponent = getIconComponent(role.icon)
            
            return (
              <div
                key={role.id}
                className="border border-pdm-border rounded-lg bg-pdm-bg-light overflow-hidden"
              >
                {/* Role Header */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-pdm-bg"
                  onClick={() => toggleRoleExpanded(role.id)}
                >
                  <button className="p-0.5 hover:bg-pdm-highlight rounded">
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-pdm-fg-muted" />
                    ) : (
                      <ChevronRight size={16} className="text-pdm-fg-muted" />
                    )}
                  </button>
                  
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: role.color + '20' }}
                  >
                    <IconComponent size={16} style={{ color: role.color }} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{role.name}</div>
                    {role.description && (
                      <div className="text-sm text-pdm-fg-muted truncate">{role.description}</div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-pdm-fg-muted">
                    <Users size={14} />
                    <span>{role.user_count} {role.user_count === 1 ? 'member' : 'members'}</span>
                  </div>
                  
                  {isAdmin && (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openAssignDialog(role)}
                        className="p-1.5 hover:bg-pdm-highlight rounded text-pdm-fg-muted hover:text-pdm-fg"
                        title="Assign members"
                      >
                        <UserPlus size={16} />
                      </button>
                      <button
                        onClick={() => openEditDialog(role)}
                        className="p-1.5 hover:bg-pdm-highlight rounded text-pdm-fg-muted hover:text-pdm-fg"
                        title="Edit role"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedRole(role)
                          setShowDeleteDialog(true)
                        }}
                        className="p-1.5 hover:bg-pdm-highlight rounded text-pdm-fg-muted hover:text-red-400"
                        title="Delete role"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Expanded: Show assigned users */}
                {isExpanded && (
                  <div className="border-t border-pdm-border bg-pdm-bg p-3">
                    {role.assignments.length === 0 ? (
                      <p className="text-sm text-pdm-fg-muted text-center py-2">
                        No members assigned to this role
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {role.assignments.map(assignment => (
                          <div
                            key={assignment.id}
                            className="flex items-center gap-2 p-2 rounded bg-pdm-bg-light group"
                          >
                            {assignment.user?.avatar_url ? (
                              <img
                                src={assignment.user.avatar_url}
                                alt=""
                                className="w-6 h-6 rounded-full"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-pdm-accent/20 flex items-center justify-center text-xs text-pdm-accent font-medium">
                                {getInitials(assignment.user?.full_name || assignment.user?.email)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">
                                {assignment.user?.full_name || assignment.user?.email}
                              </div>
                            </div>
                            {isAdmin && (
                              <button
                                onClick={() => handleRemoveAssignment(role.id, assignment.user_id)}
                                className="p-1 rounded hover:bg-pdm-highlight text-pdm-fg-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove from role"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      
      {/* Info box about usage */}
      <div className="p-4 rounded-lg bg-pdm-accent/10 border border-pdm-accent/30">
        <div className="flex items-start gap-3">
          <GitBranch size={20} className="text-pdm-accent mt-0.5" />
          <div>
            <div className="font-medium text-sm">Using Workflow Roles</div>
            <p className="text-sm text-pdm-fg-muted mt-1">
              Workflow roles can be used in the Workflows editor to:
            </p>
            <ul className="text-sm text-pdm-fg-muted mt-2 space-y-1 list-disc list-inside">
              <li>Require specific roles to enter workflow states</li>
              <li>Designate who can approve gate reviews</li>
              <li>Control transition permissions beyond system roles</li>
            </ul>
          </div>
        </div>
      </div>
      
      {/* Create Dialog */}
      {showCreateDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowCreateDialog(false)}
        >
          <div
            className="bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-pdm-border">
              <h3 className="font-semibold">Create Workflow Role</h3>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="p-1 hover:bg-pdm-highlight rounded"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-1">Role Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Design Lead, QA Manager"
                  className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What this role is responsible for..."
                  className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent resize-none"
                  rows={2}
                />
              </div>
              
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-2">Icon</label>
                <div className="grid grid-cols-8 gap-1 p-2 bg-pdm-bg rounded border border-pdm-border max-h-32 overflow-y-auto">
                  {ROLE_ICONS.map(iconName => {
                    const Icon = getIconComponent(iconName)
                    return (
                      <button
                        key={iconName}
                        onClick={() => setFormData({ ...formData, icon: iconName })}
                        className={`p-2 rounded hover:bg-pdm-highlight ${
                          formData.icon === iconName ? 'bg-pdm-accent/20 ring-1 ring-pdm-accent' : ''
                        }`}
                        title={iconName}
                      >
                        <Icon size={16} style={{ color: formData.color }} />
                      </button>
                    )
                  })}
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-2">Color</label>
                <div className="grid grid-cols-9 gap-1">
                  {ROLE_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setFormData({ ...formData, color })}
                      className={`w-6 h-6 rounded-full ${
                        formData.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-pdm-bg-light' : ''
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-2 p-4 border-t border-pdm-border">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRole}
                disabled={!formData.name.trim() || isSaving}
                className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Create Role
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Edit Dialog */}
      {showEditDialog && selectedRole && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowEditDialog(false)}
        >
          <div
            className="bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-pdm-border">
              <h3 className="font-semibold">Edit Workflow Role</h3>
              <button
                onClick={() => setShowEditDialog(false)}
                className="p-1 hover:bg-pdm-highlight rounded"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-1">Role Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent"
                />
              </div>
              
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent resize-none"
                  rows={2}
                />
              </div>
              
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-2">Icon</label>
                <div className="grid grid-cols-8 gap-1 p-2 bg-pdm-bg rounded border border-pdm-border max-h-32 overflow-y-auto">
                  {ROLE_ICONS.map(iconName => {
                    const Icon = getIconComponent(iconName)
                    return (
                      <button
                        key={iconName}
                        onClick={() => setFormData({ ...formData, icon: iconName })}
                        className={`p-2 rounded hover:bg-pdm-highlight ${
                          formData.icon === iconName ? 'bg-pdm-accent/20 ring-1 ring-pdm-accent' : ''
                        }`}
                        title={iconName}
                      >
                        <Icon size={16} style={{ color: formData.color }} />
                      </button>
                    )
                  })}
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-pdm-fg-muted mb-2">Color</label>
                <div className="grid grid-cols-9 gap-1">
                  {ROLE_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setFormData({ ...formData, color })}
                      className={`w-6 h-6 rounded-full ${
                        formData.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-pdm-bg-light' : ''
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-2 p-4 border-t border-pdm-border">
              <button
                onClick={() => setShowEditDialog(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateRole}
                disabled={!formData.name.trim() || isSaving}
                className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && selectedRole && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4">
              <h3 className="font-semibold mb-2">Delete Workflow Role?</h3>
              <p className="text-sm text-pdm-fg-muted">
                Are you sure you want to delete <strong>"{selectedRole.name}"</strong>?
                {selectedRole.user_count > 0 && (
                  <span className="block mt-2 text-pdm-warning">
                    This role is assigned to {selectedRole.user_count} {selectedRole.user_count === 1 ? 'user' : 'users'}.
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-pdm-border">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteRole}
                disabled={isSaving}
                className="btn bg-red-600 hover:bg-red-700 text-white"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Assign Members Dialog */}
      {showAssignDialog && selectedRole && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowAssignDialog(false)}
        >
          <div
            className="bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-pdm-border">
              <h3 className="font-semibold">Assign Members to "{selectedRole.name}"</h3>
              <button
                onClick={() => setShowAssignDialog(false)}
                className="p-1 hover:bg-pdm-highlight rounded"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4">
              {/* Search */}
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted" />
                <input
                  type="text"
                  value={assignSearchQuery}
                  onChange={e => setAssignSearchQuery(e.target.value)}
                  placeholder="Search members..."
                  className="w-full pl-9 pr-3 py-2 bg-pdm-bg border border-pdm-border rounded focus:outline-none focus:border-pdm-accent text-sm"
                />
              </div>
              
              {/* User list */}
              <div className="max-h-64 overflow-y-auto border border-pdm-border rounded bg-pdm-bg">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-pdm-fg-muted text-center py-4">No users found</p>
                ) : (
                  filteredUsers.map(orgUser => (
                    <label
                      key={orgUser.id}
                      className="flex items-center gap-3 p-2 hover:bg-pdm-highlight cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={pendingAssignments.includes(orgUser.id)}
                        onChange={() => {
                          if (pendingAssignments.includes(orgUser.id)) {
                            setPendingAssignments(pendingAssignments.filter(id => id !== orgUser.id))
                          } else {
                            setPendingAssignments([...pendingAssignments, orgUser.id])
                          }
                        }}
                        className="w-4 h-4 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent"
                      />
                      {orgUser.avatar_url ? (
                        <img src={orgUser.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-pdm-accent/20 flex items-center justify-center text-xs text-pdm-accent font-medium">
                          {getInitials(orgUser.full_name || orgUser.email)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{orgUser.full_name || orgUser.email}</div>
                        {orgUser.full_name && (
                          <div className="text-xs text-pdm-fg-muted truncate">{orgUser.email}</div>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
              
              <div className="mt-3 text-sm text-pdm-fg-muted">
                {pendingAssignments.length} {pendingAssignments.length === 1 ? 'member' : 'members'} selected
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-2 p-4 border-t border-pdm-border">
              <button
                onClick={() => setShowAssignDialog(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAssignments}
                disabled={isSaving}
                className="btn bg-pdm-accent hover:bg-pdm-accent/90 text-white disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Save Assignments
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

