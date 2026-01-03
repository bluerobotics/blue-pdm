// Types for TeamMembersSettings components

import type { Team, TeamMember, PermissionAction } from '../../../types/permissions'

export interface WorkflowRoleBasic {
  id: string
  name: string
  color: string
  icon: string
  description?: string | null
}

export interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  custom_avatar_url: string | null
  role: string
  last_sign_in: string | null
  last_online: string | null
  teams?: { id: string; name: string; color: string; icon: string }[]
  job_title?: { id: string; name: string; color: string; icon: string } | null
  workflow_roles?: WorkflowRoleBasic[]
}

export interface Vault {
  id: string
  name: string
  slug: string
  description: string | null
  storage_bucket: string
  is_default: boolean
  created_at: string
}

export interface TeamWithDetails extends Team {
  member_count: number
  permissions_count: number
  vault_access?: string[] // vault IDs
  module_defaults?: Record<string, unknown> | null
}

export interface PendingMember {
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

export interface JobTitle {
  id: string
  name: string
  color: string
  icon: string
}

// Form data types
export interface TeamFormData {
  name: string
  description: string
  color: string
  icon: string
  is_default: boolean
}

export interface WorkflowRoleFormData {
  name: string
  color: string
  icon: string
  description: string
}

export interface PendingMemberFormData {
  full_name: string
  team_ids: string[]
  workflow_role_ids: string[]
  vault_ids: string[]
}

// Component prop types
export interface UserRowProps {
  user: OrgUser
  isAdmin: boolean
  isRealAdmin?: boolean
  isCurrentUser: boolean
  onViewProfile: () => void
  onRemove: () => void
  onRemoveFromTeam?: () => void
  onVaultAccess: () => void
  onPermissions?: () => void
  onViewNetPermissions?: () => void
  onSimulatePermissions?: () => void
  isSimulating?: boolean
  vaultAccessCount: number
  compact?: boolean
  onEditJobTitle?: (user: OrgUser) => void
  jobTitles?: JobTitle[]
  onToggleJobTitle?: (user: OrgUser, titleId: string | null) => Promise<void>
  workflowRoles?: WorkflowRoleBasic[]
  userWorkflowRoleIds?: string[]
  onEditWorkflowRoles?: (user: OrgUser) => void
  teams?: { id: string; name: string; color: string; icon: string }[]
  onEditTeams?: (user: OrgUser) => void
  onToggleTeam?: (user: OrgUser, teamId: string, isAdding: boolean) => Promise<void>
  onToggleWorkflowRole?: (user: OrgUser, roleId: string, isAdding: boolean) => Promise<void>
}

export interface TeamFormDialogProps {
  title: string
  formData: TeamFormData
  setFormData: (data: TeamFormData) => void
  onSave: () => Promise<void> | void
  onCancel: () => void
  isSaving: boolean
  existingTeams?: TeamWithDetails[]
  copyFromTeamId?: string | null
  setCopyFromTeamId?: (id: string | null) => void
}

export interface TeamMembersDialogProps {
  team: TeamWithDetails
  orgUsers: OrgUser[]
  onClose: () => void
  userId?: string
}

export interface WorkflowRolesModalProps {
  user: OrgUser
  workflowRoles: WorkflowRoleBasic[]
  userRoleIds: string[]
  onClose: () => void
  onSave: (roleIds: string[]) => Promise<void>
  onUpdateRole: (roleId: string, name: string, color: string, icon: string) => Promise<void>
  onDeleteRole: (roleId: string) => Promise<void>
  onCreateRole?: () => void
}

export interface UserTeamsModalProps {
  user: OrgUser
  allTeams: { id: string; name: string; color: string; icon: string }[]
  userTeamIds: string[]
  onClose: () => void
  onSave: (teamIds: string[]) => Promise<void>
  onCreateTeam?: () => void
}

export interface UserJobTitleModalProps {
  user: OrgUser
  jobTitles: JobTitle[]
  onClose: () => void
  onSelectTitle: (titleId: string | null) => Promise<void>
  onCreateTitle: () => void
  onUpdateTitle?: (titleId: string, name: string, color: string, icon: string) => Promise<void>
  onDeleteTitle?: (titleId: string) => Promise<void>
  isAdmin?: boolean
}

export interface UserPermissionsDialogProps {
  user: OrgUser
  onClose: () => void
  currentUserId?: string
}

export interface ViewNetPermissionsModalProps {
  user: OrgUser
  vaultAccessCount: number
  orgVaults: Vault[]
  teams: TeamWithDetails[]
  onClose: () => void
}

export interface TeamModulesDialogProps {
  team: TeamWithDetails
  onClose: () => void
}

// Re-export types from permissions for convenience
export type { Team, TeamMember, PermissionAction }
