// Team Members Settings - Barrel Export
// Main component - to be created as part of refactoring
// export { TeamMembersSettings } from './TeamMembersSettings'

// Sub-components
export { UserRow } from './UserRow'
export { TeamFormDialog } from './TeamFormDialog'
export { TeamMembersDialog } from './TeamMembersDialog'
export { WorkflowRolesModal } from './WorkflowRolesModal'
export { UserTeamsModal } from './UserTeamsModal'
export { UserJobTitleModal } from './UserJobTitleModal'
export { UserPermissionsDialog } from './UserPermissionsDialog'
export { ViewNetPermissionsModal } from './ViewNetPermissionsModal'
export { TeamModulesDialog } from './TeamModulesDialog'
export { RemoveUserDialog } from './RemoveUserDialog'
export { RemoveFromAdminsDialog } from './RemoveFromAdminsDialog'
export { CreateUserDialog } from './CreateUserDialog'

// Hooks
export {
  useTeams,
  useMembers,
  useInvites,
  useWorkflowRoles,
  useJobTitles,
  useVaultAccess
} from './hooks'

// Types
export type {
  WorkflowRoleBasic,
  OrgUser,
  Vault,
  TeamWithDetails,
  PendingMember,
  JobTitle,
  TeamFormData,
  WorkflowRoleFormData,
  PendingMemberFormData,
  UserRowProps,
  TeamFormDialogProps,
  TeamMembersDialogProps,
  WorkflowRolesModalProps,
  UserTeamsModalProps,
  UserJobTitleModalProps,
  UserPermissionsDialogProps,
  ViewNetPermissionsModalProps,
  TeamModulesDialogProps
} from './types'

// Utilities
export { formatLastOnline } from './utils'

// Constants
export {
  TEAM_COLORS,
  DEFAULT_TEAM_ICONS,
  DEFAULT_WORKFLOW_ROLE_ICONS,
  DEFAULT_JOB_TITLE_ICONS,
  ROLE_LABELS,
  DEFAULT_TEAM_COLOR,
  DEFAULT_WORKFLOW_ROLE_COLOR,
  DEFAULT_JOB_TITLE_COLOR,
  DEFAULT_TEAM_ICON,
  DEFAULT_WORKFLOW_ROLE_ICON,
  DEFAULT_JOB_TITLE_ICON,
  PERMISSION_RESOURCE_GROUPS
} from './constants'
