// Constants for TeamMembersSettings components

import { DEFAULT_PRESET_COLORS } from '../../shared/ColorPicker'

// Preset colors for teams - re-export from shared ColorPicker
export const TEAM_COLORS = DEFAULT_PRESET_COLORS

// Default icons for various entity types
export const DEFAULT_TEAM_ICONS = [
  'Users', 'Shield', 'Star', 'Briefcase',
  'Code', 'Database', 'Settings', 'Lock'
]

export const DEFAULT_WORKFLOW_ROLE_ICONS = [
  'Shield', 'Star', 'Award', 'Crown',
  'BadgeCheck', 'UserCheck', 'Wrench', 'Eye'
]

export const DEFAULT_JOB_TITLE_ICONS = [
  'Briefcase', 'Building', 'UserCog', 'Star',
  'GraduationCap', 'Badge', 'Gem', 'Crown'
]

// Role labels for display
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  engineer: 'Engineer',
  viewer: 'Viewer'
}

// Default colors for new entities
export const DEFAULT_TEAM_COLOR = '#3b82f6'
export const DEFAULT_WORKFLOW_ROLE_COLOR = '#8b5cf6'
export const DEFAULT_JOB_TITLE_COLOR = '#3b82f6'

// Default icons for new entities
export const DEFAULT_TEAM_ICON = 'Users'
export const DEFAULT_WORKFLOW_ROLE_ICON = 'Shield'
export const DEFAULT_JOB_TITLE_ICON = 'Briefcase'

// Permission resource groups for categorizing permissions in the UI
export const PERMISSION_RESOURCE_GROUPS: { id: string; name: string; icon: string; color: string; resources: string[] }[] = [
  {
    id: 'source-files',
    name: 'Source Files',
    icon: 'FolderTree',
    color: '#3b82f6',
    resources: ['module:explorer', 'module:pending', 'module:history', 'module:workflows', 'module:trash']
  },
  {
    id: 'items',
    name: 'Items & BOMs',
    icon: 'Package',
    color: '#8b5cf6',
    resources: ['module:items', 'module:boms', 'module:products']
  },
  {
    id: 'change-control',
    name: 'Change Control',
    icon: 'GitBranch',
    color: '#f59e0b',
    resources: ['module:ecr', 'module:eco', 'module:reviews', 'module:deviations', 'module:release-schedule', 'module:process']
  },
  {
    id: 'supply-chain',
    name: 'Supply Chain',
    icon: 'Truck',
    color: '#14b8a6',
    resources: ['module:supplier-database', 'module:supplier-portal', 'module:purchase-requests', 'module:purchase-orders', 'module:invoices', 'module:shipping', 'module:receiving']
  },
  {
    id: 'production',
    name: 'Production',
    icon: 'Factory',
    color: '#ec4899',
    resources: ['module:manufacturing-orders', 'module:travellers', 'module:work-instructions', 'module:production-schedule', 'module:routings', 'module:work-centers', 'module:process-flows', 'module:equipment', 'module:yield-tracking', 'module:error-codes', 'module:downtime', 'module:oee', 'module:scrap-tracking']
  },
  {
    id: 'quality',
    name: 'Quality',
    icon: 'ShieldCheck',
    color: '#22c55e',
    resources: ['module:fai', 'module:ncr', 'module:imr', 'module:scar', 'module:capa', 'module:rma', 'module:certificates', 'module:calibration', 'module:quality-templates']
  },
  {
    id: 'accounting',
    name: 'Accounting',
    icon: 'Calculator',
    color: '#a855f7',
    resources: ['module:accounts-payable', 'module:accounts-receivable', 'module:general-ledger', 'module:cost-tracking', 'module:budgets']
  },
  {
    id: 'system',
    name: 'System & Admin',
    icon: 'Settings',
    color: '#64748b',
    resources: ['module:google-drive', 'module:terminal', 'module:settings', 'system:users', 'system:teams', 'system:permissions', 'system:org-settings', 'system:vaults', 'system:backups', 'system:webhooks', 'system:workflows', 'system:metadata', 'system:integrations', 'system:recovery-codes', 'system:impersonation']
  }
]
