// Teams and Permissions Type Definitions

// =========================================== 
// PERMISSION ACTIONS
// ===========================================

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'admin'

export const PERMISSION_ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'delete', 'admin']

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  admin: 'Admin'
}

export const PERMISSION_ACTION_DESCRIPTIONS: Record<PermissionAction, string> = {
  view: 'Can view and read data',
  create: 'Can create new records',
  edit: 'Can modify existing records',
  delete: 'Can delete records',
  admin: 'Full access including settings'
}

// ===========================================
// RESOURCE TYPES
// ===========================================

// Resource categories for organization
export type ResourceCategory = 
  | 'modules'           // Sidebar modules
  | 'module-groups'     // Module group toggles
  | 'system'            // System features
  | 'vaults'            // Vault access

// System resources (non-module features)
export type SystemResource = 
  | 'system:users'          // User management
  | 'system:teams'          // Team management
  | 'system:permissions'    // Permission management
  | 'system:org-settings'   // Organization settings
  | 'system:vaults'         // Vault management
  | 'system:backups'        // Backup configuration
  | 'system:webhooks'       // Webhook management
  | 'system:workflows'      // Workflow templates
  | 'system:metadata'       // Custom metadata columns
  | 'system:integrations'   // External integrations
  | 'system:recovery-codes' // Admin recovery codes
  | 'system:impersonation'  // User impersonation

// Resource definition for the permission editor
export interface ResourceDefinition {
  id: string
  name: string
  description: string
  category: ResourceCategory
  icon: string
  // Which actions are applicable to this resource
  applicableActions: PermissionAction[]
  // Default actions for new teams (usually empty)
  defaultActions: PermissionAction[]
}

// ===========================================
// RESOURCE DEFINITIONS
// ===========================================

// Generate module resources from module IDs
export const MODULE_RESOURCES: ResourceDefinition[] = [
  // Source Files
  { id: 'module:explorer', name: 'Explorer', description: 'File browser and navigation', category: 'modules', icon: 'FolderTree', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:pending', name: 'Pending Changes', description: 'View and manage pending file changes', category: 'modules', icon: 'ArrowDownUp', applicableActions: ['view', 'create', 'edit', 'delete'], defaultActions: [] },
  { id: 'module:history', name: 'History', description: 'View file history and versions', category: 'modules', icon: 'History', applicableActions: ['view', 'admin'], defaultActions: [] },
  { id: 'module:workflows', name: 'File Workflows', description: 'Manage file workflow states', category: 'modules', icon: 'GitBranch', applicableActions: ['view', 'edit', 'admin'], defaultActions: [] },
  { id: 'module:trash', name: 'Trash', description: 'View and restore deleted files', category: 'modules', icon: 'Trash2', applicableActions: ['view', 'delete', 'admin'], defaultActions: [] },
  
  // Items
  { id: 'module:items', name: 'Item Browser', description: 'Browse and manage items', category: 'modules', icon: 'Database', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:boms', name: 'BOMs', description: 'Bill of Materials management', category: 'modules', icon: 'ListTree', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:products', name: 'Products', description: 'Product management', category: 'modules', icon: 'Package', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Change Control
  { id: 'module:ecr', name: 'ECRs / Issues', description: 'Engineering change requests', category: 'modules', icon: 'AlertCircle', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:eco', name: 'ECOs', description: 'Engineering change orders', category: 'modules', icon: 'ClipboardList', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:reviews', name: 'Reviews', description: 'Review requests and approvals', category: 'modules', icon: 'ClipboardCheck', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:deviations', name: 'Deviations', description: 'Deviation management', category: 'modules', icon: 'FileWarning', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:release-schedule', name: 'Release Schedule', description: 'Plan and track releases', category: 'modules', icon: 'Calendar', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:process', name: 'Process Editor', description: 'Design workflow processes', category: 'modules', icon: 'Network', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Supply Chain - Suppliers
  { id: 'module:supplier-database', name: 'Supplier Database', description: 'Manage suppliers', category: 'modules', icon: 'Building2', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:supplier-portal', name: 'Supplier Portal', description: 'Supplier portal management', category: 'modules', icon: 'Globe', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Supply Chain - Purchasing
  { id: 'module:purchase-requests', name: 'Purchase Requests', description: 'Create and manage purchase requests', category: 'modules', icon: 'FileText', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:purchase-orders', name: 'Purchase Orders', description: 'Manage purchase orders', category: 'modules', icon: 'ShoppingCart', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:invoices', name: 'Invoices', description: 'Invoice management', category: 'modules', icon: 'Receipt', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Supply Chain - Logistics
  { id: 'module:shipping', name: 'Shipping', description: 'Shipping management', category: 'modules', icon: 'Truck', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:receiving', name: 'Receiving', description: 'Receiving management', category: 'modules', icon: 'PackageCheck', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Production
  { id: 'module:manufacturing-orders', name: 'Manufacturing Orders', description: 'Production order management', category: 'modules', icon: 'Factory', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:travellers', name: 'Travellers', description: 'Shop floor travellers', category: 'modules', icon: 'ScrollText', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:work-instructions', name: 'Work Instructions', description: 'Assembly and work instructions', category: 'modules', icon: 'BookOpen', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:production-schedule', name: 'Production Schedule', description: 'Production scheduling', category: 'modules', icon: 'CalendarClock', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:routings', name: 'Routings', description: 'Manufacturing routings', category: 'modules', icon: 'Route', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:work-centers', name: 'Work Centers', description: 'Work center management', category: 'modules', icon: 'Warehouse', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:process-flows', name: 'Process Flows', description: 'Process flow diagrams', category: 'modules', icon: 'Workflow', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:equipment', name: 'Equipment', description: 'Equipment management', category: 'modules', icon: 'Wrench', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Production - Analytics
  { id: 'module:yield-tracking', name: 'Yield Tracking', description: 'Production yield analytics', category: 'modules', icon: 'TrendingUp', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:error-codes', name: 'Error Codes', description: 'Error code management', category: 'modules', icon: 'AlertOctagon', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:downtime', name: 'Downtime', description: 'Downtime tracking', category: 'modules', icon: 'Clock', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:oee', name: 'OEE Dashboard', description: 'Overall Equipment Effectiveness', category: 'modules', icon: 'Gauge', applicableActions: ['view', 'admin'], defaultActions: [] },
  { id: 'module:scrap-tracking', name: 'Scrap Tracking', description: 'Scrap and waste tracking', category: 'modules', icon: 'Trash', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Quality
  { id: 'module:fai', name: 'First Article Inspection', description: 'FAI management', category: 'modules', icon: 'ClipboardCheck', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:ncr', name: 'Non-Conformance Reports', description: 'NCR management', category: 'modules', icon: 'AlertTriangle', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:imr', name: 'Incoming Material Reports', description: 'IMR management', category: 'modules', icon: 'PackageSearch', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:scar', name: 'Supplier Corrective Actions', description: 'SCAR management', category: 'modules', icon: 'FileWarning', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:capa', name: 'CAPA', description: 'Corrective and preventive actions', category: 'modules', icon: 'ShieldCheck', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:rma', name: 'RMA', description: 'Return material authorization', category: 'modules', icon: 'PackageX', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:certificates', name: 'Certificates', description: 'Certificate management', category: 'modules', icon: 'Award', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:calibration', name: 'Calibration', description: 'Equipment calibration', category: 'modules', icon: 'Gauge', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:quality-templates', name: 'Quality Templates', description: 'Quality document templates', category: 'modules', icon: 'FileStack', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Accounting
  { id: 'module:accounts-payable', name: 'Accounts Payable', description: 'AP management', category: 'modules', icon: 'CreditCard', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:accounts-receivable', name: 'Accounts Receivable', description: 'AR management', category: 'modules', icon: 'Wallet', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:general-ledger', name: 'General Ledger', description: 'GL management', category: 'modules', icon: 'BookOpen', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:cost-tracking', name: 'Cost Tracking', description: 'Cost tracking and analysis', category: 'modules', icon: 'DollarSign', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'module:budgets', name: 'Budgets', description: 'Budget management', category: 'modules', icon: 'PiggyBank', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // Integrations
  { id: 'module:google-drive', name: 'Google Drive', description: 'Google Drive integration', category: 'modules', icon: 'Cloud', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  
  // System
  { id: 'module:terminal', name: 'Terminal', description: 'Command terminal access', category: 'modules', icon: 'Terminal', applicableActions: ['view', 'admin'], defaultActions: [] },
  { id: 'module:settings', name: 'Settings', description: 'User settings access', category: 'modules', icon: 'Settings', applicableActions: ['view', 'edit'], defaultActions: [] },
]

// System resources
export const SYSTEM_RESOURCES: ResourceDefinition[] = [
  { id: 'system:users', name: 'User Management', description: 'Add, remove, and manage users', category: 'system', icon: 'Users', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:teams', name: 'Team Management', description: 'Create and manage teams', category: 'system', icon: 'UsersRound', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:permissions', name: 'Permission Management', description: 'Configure team permissions', category: 'system', icon: 'Shield', applicableActions: ['view', 'edit', 'admin'], defaultActions: [] },
  { id: 'system:org-settings', name: 'Organization Settings', description: 'Configure organization settings', category: 'system', icon: 'Building', applicableActions: ['view', 'edit', 'admin'], defaultActions: [] },
  { id: 'system:vaults', name: 'Vault Management', description: 'Create and manage file vaults', category: 'system', icon: 'Database', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:backups', name: 'Backup Configuration', description: 'Configure backup settings', category: 'system', icon: 'HardDrive', applicableActions: ['view', 'edit', 'admin'], defaultActions: [] },
  { id: 'system:webhooks', name: 'Webhook Management', description: 'Configure webhooks', category: 'system', icon: 'Webhook', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:workflows', name: 'Workflow Templates', description: 'Design workflow templates', category: 'system', icon: 'GitBranch', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:metadata', name: 'Metadata Columns', description: 'Configure custom metadata', category: 'system', icon: 'Table', applicableActions: ['view', 'create', 'edit', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:integrations', name: 'Integrations', description: 'Configure external integrations', category: 'system', icon: 'Plug', applicableActions: ['view', 'edit', 'admin'], defaultActions: [] },
  { id: 'system:recovery-codes', name: 'Recovery Codes', description: 'Manage admin recovery codes', category: 'system', icon: 'Key', applicableActions: ['view', 'create', 'delete', 'admin'], defaultActions: [] },
  { id: 'system:impersonation', name: 'User Impersonation', description: 'Impersonate other users', category: 'system', icon: 'UserCog', applicableActions: ['admin'], defaultActions: [] },
]

// All resources combined
export const ALL_RESOURCES: ResourceDefinition[] = [
  ...MODULE_RESOURCES,
  ...SYSTEM_RESOURCES,
]

// Get resource by ID
export function getResourceById(resourceId: string): ResourceDefinition | undefined {
  return ALL_RESOURCES.find(r => r.id === resourceId)
}

// Get resources by category
export function getResourcesByCategory(category: ResourceCategory): ResourceDefinition[] {
  return ALL_RESOURCES.filter(r => r.category === category)
}

// ===========================================
// TEAMS
// ===========================================

export interface Team {
  id: string
  org_id: string
  name: string
  description: string | null
  color: string
  icon: string
  parent_team_id: string | null
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  is_default: boolean
  is_system: boolean
  // Computed/joined
  member_count?: number
  members?: TeamMember[]
  permissions?: TeamPermission[]
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  is_team_admin: boolean
  added_at: string
  added_by: string | null
  // Joined
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    role: 'admin' | 'engineer' | 'viewer'
  }
}

export interface TeamPermission {
  id: string
  team_id: string
  resource: string
  actions: PermissionAction[]
  granted_at: string
  granted_by: string | null
  updated_at: string
  updated_by: string | null
}

// ===========================================
// PERMISSION PRESETS
// ===========================================

export interface PermissionPreset {
  id: string
  org_id: string
  name: string
  description: string | null
  color: string
  icon: string
  permissions: Record<string, PermissionAction[]>
  is_system: boolean
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

// Built-in presets (created on first access)
export const DEFAULT_PRESETS: Omit<PermissionPreset, 'id' | 'org_id' | 'created_at' | 'created_by' | 'updated_at' | 'updated_by'>[] = [
  {
    name: 'Full Access',
    description: 'Complete access to all modules and features',
    color: '#22c55e',
    icon: 'ShieldCheck',
    is_system: true,
    permissions: Object.fromEntries(
      ALL_RESOURCES.map(r => [r.id, r.applicableActions])
    ),
  },
  {
    name: 'Engineering',
    description: 'Access to engineering and design tools',
    color: '#3b82f6',
    icon: 'Wrench',
    is_system: true,
    permissions: {
      'module:explorer': ['view', 'create', 'edit', 'delete'],
      'module:pending': ['view', 'create', 'edit', 'delete'],
      'module:history': ['view'],
      'module:workflows': ['view', 'edit'],
      'module:trash': ['view'],
      'module:items': ['view', 'create', 'edit'],
      'module:boms': ['view', 'create', 'edit'],
      'module:ecr': ['view', 'create', 'edit'],
      'module:eco': ['view', 'create', 'edit'],
      'module:reviews': ['view', 'create', 'edit'],
      'module:deviations': ['view', 'create', 'edit'],
      'module:settings': ['view', 'edit'],
    },
  },
  {
    name: 'Accounting',
    description: 'Access to financial and accounting modules',
    color: '#8b5cf6',
    icon: 'Calculator',
    is_system: true,
    permissions: {
      'module:accounts-payable': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:accounts-receivable': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:general-ledger': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:cost-tracking': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:budgets': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:invoices': ['view', 'create', 'edit', 'delete'],
      'module:purchase-orders': ['view'],
      'module:supplier-database': ['view'],
      'module:settings': ['view', 'edit'],
    },
  },
  {
    name: 'Quality',
    description: 'Access to quality management modules',
    color: '#f59e0b',
    icon: 'ShieldCheck',
    is_system: true,
    permissions: {
      'module:fai': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:ncr': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:imr': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:scar': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:capa': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:rma': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:certificates': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:calibration': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:quality-templates': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:deviations': ['view', 'create', 'edit'],
      'module:explorer': ['view'],
      'module:items': ['view'],
      'module:settings': ['view', 'edit'],
    },
  },
  {
    name: 'Production',
    description: 'Access to production and manufacturing modules',
    color: '#ec4899',
    icon: 'Factory',
    is_system: true,
    permissions: {
      'module:manufacturing-orders': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:travellers': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:work-instructions': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:production-schedule': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:routings': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:work-centers': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:process-flows': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:equipment': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:yield-tracking': ['view', 'create', 'edit'],
      'module:error-codes': ['view', 'create', 'edit'],
      'module:downtime': ['view', 'create', 'edit'],
      'module:oee': ['view'],
      'module:scrap-tracking': ['view', 'create', 'edit'],
      'module:items': ['view'],
      'module:boms': ['view'],
      'module:settings': ['view', 'edit'],
    },
  },
  {
    name: 'Purchasing',
    description: 'Access to purchasing and supply chain modules',
    color: '#14b8a6',
    icon: 'ShoppingCart',
    is_system: true,
    permissions: {
      'module:supplier-database': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:supplier-portal': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:purchase-requests': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:purchase-orders': ['view', 'create', 'edit', 'delete', 'admin'],
      'module:invoices': ['view', 'create', 'edit'],
      'module:shipping': ['view', 'create', 'edit'],
      'module:receiving': ['view', 'create', 'edit'],
      'module:items': ['view'],
      'module:settings': ['view', 'edit'],
    },
  },
  {
    name: 'View Only',
    description: 'Read-only access to enabled modules',
    color: '#64748b',
    icon: 'Eye',
    is_system: true,
    permissions: Object.fromEntries(
      MODULE_RESOURCES
        .filter(r => r.applicableActions.includes('view'))
        .map(r => [r.id, ['view'] as PermissionAction[]])
    ),
  },
]

// ===========================================
// PERMISSION HELPERS
// ===========================================

// Check if a permission set has a specific action on a resource
export function hasPermission(
  permissions: Record<string, PermissionAction[]>,
  resource: string,
  action: PermissionAction
): boolean {
  const resourcePerms = permissions[resource]
  if (!resourcePerms) return false
  return resourcePerms.includes(action) || resourcePerms.includes('admin')
}

// Merge multiple permission sets (union of all permissions)
export function mergePermissions(
  ...permissionSets: Record<string, PermissionAction[]>[]
): Record<string, PermissionAction[]> {
  const merged: Record<string, Set<PermissionAction>> = {}
  
  for (const perms of permissionSets) {
    for (const [resource, actions] of Object.entries(perms)) {
      if (!merged[resource]) {
        merged[resource] = new Set()
      }
      for (const action of actions) {
        merged[resource].add(action)
      }
    }
  }
  
  return Object.fromEntries(
    Object.entries(merged).map(([resource, actionSet]) => [
      resource,
      Array.from(actionSet) as PermissionAction[]
    ])
  )
}

// Get permission summary for display
export function getPermissionSummary(
  permissions: Record<string, PermissionAction[]>
): { total: number; byCategory: Record<ResourceCategory, number> } {
  const byCategory: Record<ResourceCategory, number> = {
    'modules': 0,
    'module-groups': 0,
    'system': 0,
    'vaults': 0,
  }
  
  let total = 0
  for (const resource of Object.keys(permissions)) {
    const def = getResourceById(resource)
    if (def) {
      byCategory[def.category]++
      total++
    }
  }
  
  return { total, byCategory }
}

// ===========================================
// CATEGORY DEFINITIONS
// ===========================================

export interface ResourceCategoryDefinition {
  id: ResourceCategory
  name: string
  description: string
  icon: string
  color: string
}

export const RESOURCE_CATEGORIES: ResourceCategoryDefinition[] = [
  { id: 'modules', name: 'Modules', description: 'Sidebar module access', icon: 'LayoutGrid', color: '#3b82f6' },
  { id: 'system', name: 'System', description: 'Administration features', icon: 'Settings', color: '#f59e0b' },
  { id: 'vaults', name: 'Vaults', description: 'File vault access', icon: 'Database', color: '#8b5cf6' },
]

