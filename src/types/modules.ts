// Module system type definitions

// All available sidebar modules
export type ModuleId =
  // Source Files (PDM)
  | 'explorer'
  | 'pending'
  | 'history'
  | 'workflows'
  | 'trash'
  // Items
  | 'items'
  | 'boms'
  | 'products'
  // Change Control
  | 'ecr'
  | 'eco'
  | 'notifications'
  | 'deviations'
  | 'release-schedule'
  | 'process'
  // Supply Chain - Suppliers
  | 'supplier-database'
  | 'supplier-portal'
  // Supply Chain - Purchasing
  | 'purchase-requests'
  | 'purchase-orders'
  | 'invoices'
  // Supply Chain - Logistics
  | 'shipping'
  | 'receiving'
  // Production
  | 'manufacturing-orders'
  | 'travellers'
  | 'work-instructions'
  | 'production-schedule'
  | 'routings'
  | 'work-centers'
  | 'process-flows'
  | 'equipment'
  // Production - Analytics
  | 'production-analytics'
  | 'yield-tracking'
  | 'error-codes'
  | 'downtime'
  | 'oee'
  | 'scrap-tracking'
  // Quality
  | 'fai'
  | 'ncr'
  | 'imr'
  | 'scar'
  | 'capa'
  | 'rma'
  | 'certificates'
  | 'calibration'
  | 'quality-templates'
  // Accounting
  | 'accounts-payable'
  | 'accounts-receivable'
  | 'general-ledger'
  | 'cost-tracking'
  | 'budgets'
  // Integrations
  | 'google-drive'
  // System
  | 'terminal'
  | 'settings'

// Module group identifiers
export type ModuleGroupId =
  | 'source-files'
  | 'items'
  | 'change-control'
  | 'supply-chain'
  | 'supply-chain-suppliers'
  | 'supply-chain-purchasing'
  | 'supply-chain-logistics'
  | 'production'
  | 'production-analytics'
  | 'quality'
  | 'accounting'
  | 'integrations'
  | 'system'

// Section divider configuration
export interface SectionDivider {
  id: string
  enabled: boolean
  // Position is the index in the module order where this divider appears AFTER
  // e.g., position 6 means the divider appears after the 7th module (index 6)
  position: number
}

// Custom group configuration (user-created organizational folders)
export interface CustomGroup {
  id: string
  name: string
  icon: string  // Lucide icon name
  iconColor: string | null  // Custom color or null for default
  // Position in the sidebar order (index in combined order)
  position: number
  enabled: boolean
}

// Individual module definition
export interface ModuleDefinition {
  id: ModuleId
  name: string
  group: ModuleGroupId
  icon: string  // Lucide icon name
  defaultEnabled: boolean
  // If true, this module cannot be disabled when its group is enabled
  required?: boolean
  // Module IDs that must be enabled for this module to work
  dependencies?: ModuleId[]
  // Parent module ID - if set, this module appears in a submenu when parent is hovered
  parentId?: ModuleId
  // If true, the module is fully implemented; false = "Coming Soon"
  implemented?: boolean
}

// Module group definition
export interface ModuleGroupDefinition {
  id: ModuleGroupId
  name: string
  description: string
  // If true, disabling this group disables all modules in it
  isMasterToggle: boolean
  defaultEnabled: boolean
  // Parent group for nested groups (e.g., supply-chain-suppliers under supply-chain)
  parentGroup?: ModuleGroupId
}

// Parent can be a module ID or a custom group ID
export type ParentId = ModuleId | string | null

// User's module configuration (stored in pdmStore)
export interface ModuleConfig {
  enabledModules: Record<ModuleId, boolean>
  enabledGroups: Record<ModuleGroupId, boolean>
  moduleOrder: ModuleId[]  // Custom order of modules in sidebar
  dividers: SectionDivider[]
  // Custom parent-child relationships (overrides default parentId from ModuleDefinition)
  // Parent can be a ModuleId or a custom group ID (prefixed with "group-")
  moduleParents: Record<ModuleId, ParentId>
  // Custom icon colors per module (hex colors like "#ff0000" or null for default)
  moduleIconColors: Record<ModuleId, string | null>
  // User-created custom groups for organizing modules
  customGroups: CustomGroup[]
}

// Org's module defaults (stored in database)
export interface OrgModuleDefaults {
  enabledModules: Record<ModuleId, boolean>
  enabledGroups: Record<ModuleGroupId, boolean>
  moduleOrder: ModuleId[]
  dividers: SectionDivider[]
  moduleParents: Record<ModuleId, ParentId>
  moduleIconColors: Record<ModuleId, string | null>
  customGroups: CustomGroup[]
}

// Team's module defaults (stored in database, same structure as org defaults)
// When set, team members inherit these instead of org defaults
export type TeamModuleDefaults = OrgModuleDefaults

// ============================================
// DEFAULT CONFIGURATION
// ============================================

export const MODULE_GROUPS: ModuleGroupDefinition[] = [
  // Source Files
  {
    id: 'source-files',
    name: 'Source Files',
    description: 'Core PDM file management features',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  // Items
  {
    id: 'items',
    name: 'Items',
    description: 'Item master, BOMs, and product structures',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  // Change Control
  {
    id: 'change-control',
    name: 'Change Control',
    description: 'ECRs, ECOs, and deviations',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  // Supply Chain (parent group)
  {
    id: 'supply-chain',
    name: 'Supply Chain',
    description: 'Suppliers, purchasing, and logistics',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  {
    id: 'supply-chain-suppliers',
    name: 'Suppliers',
    description: 'Supplier database and portal',
    isMasterToggle: false,
    defaultEnabled: true,
    parentGroup: 'supply-chain',
  },
  {
    id: 'supply-chain-purchasing',
    name: 'Purchasing',
    description: 'Purchase requests, orders, and invoices',
    isMasterToggle: false,
    defaultEnabled: true,
    parentGroup: 'supply-chain',
  },
  {
    id: 'supply-chain-logistics',
    name: 'Logistics',
    description: 'Shipping and receiving',
    isMasterToggle: false,
    defaultEnabled: true,
    parentGroup: 'supply-chain',
  },
  // Production
  {
    id: 'production',
    name: 'Production',
    description: 'Manufacturing orders, travellers, and shop floor',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  {
    id: 'production-analytics',
    name: 'Analytics',
    description: 'Yield, OEE, downtime, and production metrics',
    isMasterToggle: false,
    defaultEnabled: true,
    parentGroup: 'production',
  },
  // Quality
  {
    id: 'quality',
    name: 'Quality',
    description: 'Inspections, NCRs, CAPA, and compliance',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  // Accounting
  {
    id: 'accounting',
    name: 'Accounting',
    description: 'Financial tracking, AP/AR, and budgets',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  // Integrations
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'External service connections',
    isMasterToggle: true,
    defaultEnabled: true,
  },
  // System
  {
    id: 'system',
    name: 'System',
    description: 'Core application settings',
    isMasterToggle: false,  // Cannot disable system modules
    defaultEnabled: true,
  },
]

export const MODULES: ModuleDefinition[] = [
  // ============================================
  // SOURCE FILES
  // ============================================
  {
    id: 'explorer',
    name: 'Explorer',
    group: 'source-files',
    icon: 'FolderTree',
    defaultEnabled: true,
    implemented: true,
  },
  {
    id: 'pending',
    name: 'Pending Changes',
    group: 'source-files',
    icon: 'ArrowDownUp',
    defaultEnabled: true,
    dependencies: ['explorer'],
    implemented: true,
  },
  {
    id: 'history',
    name: 'History',
    group: 'source-files',
    icon: 'History',
    defaultEnabled: true,
    dependencies: ['explorer'],
    implemented: true,
  },
  {
    id: 'workflows',
    name: 'File Workflows',
    group: 'source-files',
    icon: 'GitBranch',
    defaultEnabled: true,
    dependencies: ['explorer'],
    implemented: true,
  },
  {
    id: 'trash',
    name: 'Trash',
    group: 'source-files',
    icon: 'Trash2',
    defaultEnabled: true,
    dependencies: ['explorer'],
    implemented: true,
  },

  // ============================================
  // ITEMS
  // ============================================
  {
    id: 'items',
    name: 'Item Browser',
    group: 'items',
    icon: 'Database',
    defaultEnabled: true,
  },
  {
    id: 'boms',
    name: 'BOMs',
    group: 'items',
    icon: 'ListTree',
    defaultEnabled: true,
  },
  {
    id: 'products',
    name: 'Products',
    group: 'items',
    icon: 'Package',
    defaultEnabled: true,
  },

  // ============================================
  // CHANGE CONTROL
  // ============================================
  {
    id: 'ecr',
    name: 'ECRs / Issues',
    group: 'change-control',
    icon: 'AlertCircle',
    defaultEnabled: true,
  },
  {
    id: 'eco',
    name: 'ECOs',
    group: 'change-control',
    icon: 'ClipboardList',
    defaultEnabled: true,
  },
  {
    id: 'notifications',
    name: 'Notifications',
    group: 'system',
    icon: 'Bell',
    defaultEnabled: true,
    required: true,  // Cannot be disabled
    implemented: true,
  },
  {
    id: 'deviations',
    name: 'Deviations',
    group: 'change-control',
    icon: 'FileWarning',
    defaultEnabled: true,
  },
  {
    id: 'release-schedule',
    name: 'Release Schedule',
    group: 'change-control',
    icon: 'Calendar',
    defaultEnabled: true,
  },
  {
    id: 'process',
    name: 'Process Editor',
    group: 'change-control',
    icon: 'Network',
    defaultEnabled: true,
  },

  // ============================================
  // SUPPLY CHAIN - SUPPLIERS
  // ============================================
  {
    id: 'supplier-database',
    name: 'Supplier Database',
    group: 'supply-chain-suppliers',
    icon: 'Building2',
    defaultEnabled: true,
    implemented: true,
  },
  {
    id: 'supplier-portal',
    name: 'Supplier Portal',
    group: 'supply-chain-suppliers',
    icon: 'Globe',
    defaultEnabled: true,
    implemented: true,
  },

  // ============================================
  // SUPPLY CHAIN - PURCHASING
  // ============================================
  {
    id: 'purchase-requests',
    name: 'Purchase Requests',
    group: 'supply-chain-purchasing',
    icon: 'FileText',
    defaultEnabled: true,
  },
  {
    id: 'purchase-orders',
    name: 'Purchase Orders',
    group: 'supply-chain-purchasing',
    icon: 'ShoppingCart',
    defaultEnabled: true,
  },
  {
    id: 'invoices',
    name: 'Invoices',
    group: 'supply-chain-purchasing',
    icon: 'Receipt',
    defaultEnabled: true,
  },

  // ============================================
  // SUPPLY CHAIN - LOGISTICS
  // ============================================
  {
    id: 'shipping',
    name: 'Shipping',
    group: 'supply-chain-logistics',
    icon: 'Truck',
    defaultEnabled: true,
  },
  {
    id: 'receiving',
    name: 'Receiving',
    group: 'supply-chain-logistics',
    icon: 'PackageCheck',
    defaultEnabled: true,
  },

  // ============================================
  // PRODUCTION
  // ============================================
  {
    id: 'manufacturing-orders',
    name: 'Manufacturing Orders',
    group: 'production',
    icon: 'Factory',
    defaultEnabled: true,
  },
  {
    id: 'travellers',
    name: 'Travellers',
    group: 'production',
    icon: 'ScrollText',
    defaultEnabled: true,
  },
  {
    id: 'work-instructions',
    name: 'Work Instructions',
    group: 'production',
    icon: 'BookOpen',
    defaultEnabled: true,
  },
  {
    id: 'production-schedule',
    name: 'Production Schedule',
    group: 'production',
    icon: 'CalendarClock',
    defaultEnabled: true,
  },
  {
    id: 'routings',
    name: 'Routings',
    group: 'production',
    icon: 'Route',
    defaultEnabled: true,
  },
  {
    id: 'work-centers',
    name: 'Work Centers',
    group: 'production',
    icon: 'Warehouse',
    defaultEnabled: true,
  },
  {
    id: 'process-flows',
    name: 'Process Flows',
    group: 'production',
    icon: 'Workflow',
    defaultEnabled: true,
  },
  {
    id: 'equipment',
    name: 'Equipment',
    group: 'production',
    icon: 'Wrench',
    defaultEnabled: true,
  },

  // ============================================
  // PRODUCTION - ANALYTICS (Submenu)
  // ============================================
  {
    id: 'production-analytics',
    name: 'Analytics',
    group: 'production',
    icon: 'BarChart3',
    defaultEnabled: true,
    implemented: true,
  },
  {
    id: 'yield-tracking',
    name: 'Yield Tracking',
    group: 'production-analytics',
    icon: 'TrendingUp',
    defaultEnabled: true,
  },
  {
    id: 'error-codes',
    name: 'Error Codes',
    group: 'production-analytics',
    icon: 'AlertOctagon',
    defaultEnabled: true,
  },
  {
    id: 'downtime',
    name: 'Downtime',
    group: 'production-analytics',
    icon: 'Clock',
    defaultEnabled: true,
  },
  {
    id: 'oee',
    name: 'OEE Dashboard',
    group: 'production-analytics',
    icon: 'Gauge',
    defaultEnabled: true,
  },
  {
    id: 'scrap-tracking',
    name: 'Scrap Tracking',
    group: 'production-analytics',
    icon: 'Trash',
    defaultEnabled: true,
  },

  // ============================================
  // QUALITY
  // ============================================
  {
    id: 'fai',
    name: 'First Article Inspection (FAI)',
    group: 'quality',
    icon: 'ClipboardCheck',
    defaultEnabled: true,
  },
  {
    id: 'ncr',
    name: 'Non-Conformance Report (NCR)',
    group: 'quality',
    icon: 'AlertTriangle',
    defaultEnabled: true,
  },
  {
    id: 'imr',
    name: 'Incoming Material Report (IMR)',
    group: 'quality',
    icon: 'PackageSearch',
    defaultEnabled: true,
  },
  {
    id: 'scar',
    name: 'Supplier Corrective Action (SCAR)',
    group: 'quality',
    icon: 'FileWarning',
    defaultEnabled: true,
  },
  {
    id: 'capa',
    name: 'Corrective & Preventive Action (CAPA)',
    group: 'quality',
    icon: 'ShieldCheck',
    defaultEnabled: true,
  },
  {
    id: 'rma',
    name: 'Return Material Authorization (RMA)',
    group: 'quality',
    icon: 'PackageX',
    defaultEnabled: true,
  },
  {
    id: 'certificates',
    name: 'Certificates',
    group: 'quality',
    icon: 'Award',
    defaultEnabled: true,
  },
  {
    id: 'calibration',
    name: 'Calibration',
    group: 'quality',
    icon: 'Gauge',
    defaultEnabled: true,
  },
  {
    id: 'quality-templates',
    name: 'Templates',
    group: 'quality',
    icon: 'FileStack',
    defaultEnabled: true,
  },

  // ============================================
  // ACCOUNTING
  // ============================================
  {
    id: 'accounts-payable',
    name: 'Accounts Payable (AP)',
    group: 'accounting',
    icon: 'CreditCard',
    defaultEnabled: true,
  },
  {
    id: 'accounts-receivable',
    name: 'Accounts Receivable (AR)',
    group: 'accounting',
    icon: 'Wallet',
    defaultEnabled: true,
  },
  {
    id: 'general-ledger',
    name: 'General Ledger',
    group: 'accounting',
    icon: 'BookOpen',
    defaultEnabled: true,
  },
  {
    id: 'cost-tracking',
    name: 'Cost Tracking',
    group: 'accounting',
    icon: 'DollarSign',
    defaultEnabled: true,
  },
  {
    id: 'budgets',
    name: 'Budgets',
    group: 'accounting',
    icon: 'PiggyBank',
    defaultEnabled: true,
  },

  // ============================================
  // INTEGRATIONS
  // ============================================
  {
    id: 'google-drive',
    name: 'Google Drive',
    group: 'integrations',
    icon: 'GoogleDrive',  // Custom icon
    defaultEnabled: true,
    implemented: true,
  },

  // ============================================
  // SYSTEM
  // ============================================
  {
    id: 'terminal',
    name: 'Terminal',
    group: 'system',
    icon: 'Terminal',
    defaultEnabled: false,  // Hidden by default
    implemented: true,
  },
  {
    id: 'settings',
    name: 'Settings',
    group: 'system',
    icon: 'Settings',
    defaultEnabled: true,
    required: true,  // Cannot be disabled
    implemented: true,
  },
]

// Default section dividers (groups provide visual separation, so minimal dividers)
export const DEFAULT_DIVIDERS: SectionDivider[] = [
  // Divider before integrations/system
  { id: 'divider-1', enabled: true, position: 42 },  // After Quality, before google-drive
]

// Default module order
export const DEFAULT_MODULE_ORDER: ModuleId[] = [
  // Source Files
  'explorer',
  'pending',
  'history',
  'workflows',
  'trash',
  // Items
  'items',
  'boms',
  'products',
  // Change Control
  'ecr',
  'eco',
  'deviations',
  'release-schedule',
  'process',
  // Supply Chain - Suppliers
  'supplier-database',
  'supplier-portal',
  // Supply Chain - Purchasing
  'purchase-requests',
  'purchase-orders',
  'invoices',
  // Supply Chain - Logistics
  'shipping',
  'receiving',
  // Production
  'manufacturing-orders',
  'travellers',
  'work-instructions',
  'production-schedule',
  'routings',
  'work-centers',
  'process-flows',
  'equipment',
  // Production - Analytics submenu
  'production-analytics',
  'yield-tracking',
  'error-codes',
  'downtime',
  'oee',
  'scrap-tracking',
  // Quality
  'fai',
  'ncr',
  'imr',
  'scar',
  'capa',
  'rma',
  'certificates',
  'calibration',
  'quality-templates',
  // Accounting
  'accounts-payable',
  'accounts-receivable',
  'general-ledger',
  'cost-tracking',
  'budgets',
  // Integrations
  'google-drive',
  // System (notifications and settings at bottom)
  'terminal',
  'notifications',
  'settings',
]

// Helper to get default enabled modules
export function getDefaultEnabledModules(): Record<ModuleId, boolean> {
  const result: Record<string, boolean> = {}
  for (const mod of MODULES) {
    result[mod.id] = mod.defaultEnabled
  }
  return result as Record<ModuleId, boolean>
}

// Helper to get default enabled groups
export function getDefaultEnabledGroups(): Record<ModuleGroupId, boolean> {
  const result: Record<string, boolean> = {}
  for (const group of MODULE_GROUPS) {
    result[group.id] = group.defaultEnabled
  }
  return result as Record<ModuleGroupId, boolean>
}

// Default custom groups for sidebar organization
export const DEFAULT_CUSTOM_GROUPS: CustomGroup[] = [
  { id: 'group-source-files', name: 'Source Files', icon: 'FolderOpen', iconColor: null, position: 0, enabled: true },
  { id: 'group-items', name: 'Items', icon: 'Database', iconColor: null, position: 5, enabled: true },
  { id: 'group-change-control', name: 'Change Control', icon: 'GitPullRequest', iconColor: null, position: 8, enabled: true },
  { id: 'group-supply-chain', name: 'Supply Chain', icon: 'Truck', iconColor: null, position: 14, enabled: true },
  { id: 'group-production', name: 'Production', icon: 'Factory', iconColor: null, position: 21, enabled: true },
  { id: 'group-quality', name: 'Quality', icon: 'ShieldCheck', iconColor: null, position: 34, enabled: true },
  { id: 'group-accounting', name: 'Accounting', icon: 'Calculator', iconColor: null, position: 43, enabled: true },
]

// Default module-to-group parent assignments
export const DEFAULT_MODULE_PARENT_MAP: Record<ModuleId, ParentId> = {
  // Source Files group
  'explorer': 'group-source-files',
  'pending': 'group-source-files',
  'history': 'group-source-files',
  'workflows': 'group-source-files',
  'trash': 'group-source-files',
  // Items group
  'items': 'group-items',
  'boms': 'group-items',
  'products': 'group-items',
  // Change Control group
  'ecr': 'group-change-control',
  'eco': 'group-change-control',
  'notifications': null,  // Top-level, shown near settings
  'deviations': 'group-change-control',
  'release-schedule': 'group-change-control',
  'process': 'group-change-control',
  // Supply Chain group
  'supplier-database': 'group-supply-chain',
  'supplier-portal': 'group-supply-chain',
  'purchase-requests': 'group-supply-chain',
  'purchase-orders': 'group-supply-chain',
  'invoices': 'group-supply-chain',
  'shipping': 'group-supply-chain',
  'receiving': 'group-supply-chain',
  // Production group
  'manufacturing-orders': 'group-production',
  'travellers': 'group-production',
  'work-instructions': 'group-production',
  'production-schedule': 'group-production',
  'routings': 'group-production',
  'work-centers': 'group-production',
  'process-flows': 'group-production',
  'equipment': 'group-production',
  // Production - Analytics submenu
  'production-analytics': 'group-production',
  'yield-tracking': 'production-analytics',
  'error-codes': 'production-analytics',
  'downtime': 'production-analytics',
  'oee': 'production-analytics',
  'scrap-tracking': 'production-analytics',
  // Quality group
  'fai': 'group-quality',
  'ncr': 'group-quality',
  'imr': 'group-quality',
  'scar': 'group-quality',
  'capa': 'group-quality',
  'rma': 'group-quality',
  'certificates': 'group-quality',
  'calibration': 'group-quality',
  'quality-templates': 'group-quality',
  // Accounting group
  'accounts-payable': 'group-accounting',
  'accounts-receivable': 'group-accounting',
  'general-ledger': 'group-accounting',
  'cost-tracking': 'group-accounting',
  'budgets': 'group-accounting',
  // Top-level (no parent)
  'google-drive': null,
  'terminal': null,
  'settings': null,
}

// Helper to get default module parents
export function getDefaultModuleParents(): Record<ModuleId, ParentId> {
  return { ...DEFAULT_MODULE_PARENT_MAP }
}

// Helper to get default icon colors (all null = use theme default)
export function getDefaultModuleIconColors(): Record<ModuleId, string | null> {
  const result: Record<string, string | null> = {}
  for (const mod of MODULES) {
    result[mod.id] = null
  }
  return result as Record<ModuleId, string | null>
}

// Helper to get default module config
export function getDefaultModuleConfig(): ModuleConfig {
  return {
    enabledModules: getDefaultEnabledModules(),
    enabledGroups: getDefaultEnabledGroups(),
    moduleOrder: [...DEFAULT_MODULE_ORDER],
    dividers: [...DEFAULT_DIVIDERS],
    moduleParents: getDefaultModuleParents(),
    moduleIconColors: getDefaultModuleIconColors(),
    customGroups: [...DEFAULT_CUSTOM_GROUPS],
  }
}

// Helper to check if a module should be visible
export function isModuleVisible(
  moduleId: ModuleId,
  config: ModuleConfig
): boolean {
  const module = MODULES.find(m => m.id === moduleId)
  if (!module) return false
  
  // Check if group is enabled (for master toggle groups)
  const group = MODULE_GROUPS.find(g => g.id === module.group)
  if (group?.isMasterToggle && !config.enabledGroups[module.group]) {
    return false
  }
  
  // Check parent group if exists
  if (group?.parentGroup) {
    const parentGroup = MODULE_GROUPS.find(g => g.id === group.parentGroup)
    if (parentGroup?.isMasterToggle && !config.enabledGroups[group.parentGroup]) {
      return false
    }
  }
  
  // Check if module itself is enabled
  if (!config.enabledModules[moduleId]) {
    return false
  }
  
  // Check dependencies
  if (module.dependencies) {
    for (const dep of module.dependencies) {
      if (!config.enabledModules[dep]) {
        return false
      }
    }
  }
  
  return true
}

// Helper to check if a module can be toggled (not required)
export function canToggleModule(
  moduleId: ModuleId,
  _config: ModuleConfig
): boolean {
  const module = MODULES.find(m => m.id === moduleId)
  if (!module) return false
  
  // Required modules can never be toggled
  if (module.required) {
    return false
  }
  
  return true
}

// Get modules for a specific group
export function getModulesForGroup(groupId: ModuleGroupId): ModuleDefinition[] {
  return MODULES.filter(m => m.group === groupId)
}

// Get a module definition by ID
export function getModuleById(moduleId: ModuleId): ModuleDefinition | undefined {
  return MODULES.find(m => m.id === moduleId)
}

// Get a group definition by ID
export function getGroupById(groupId: ModuleGroupId): ModuleGroupDefinition | undefined {
  return MODULE_GROUPS.find(g => g.id === groupId)
}

// Get child modules of a parent (module or custom group)
export function getChildModules(parentId: string, config?: ModuleConfig): ModuleDefinition[] {
  if (config) {
    return MODULES.filter(m => config.moduleParents[m.id] === parentId)
  }
  return MODULES.filter(m => m.parentId === parentId)
}

// Check if a module or group has children
export function hasChildModules(parentId: string, config?: ModuleConfig): boolean {
  if (config) {
    return MODULES.some(m => config.moduleParents[m.id] === parentId)
  }
  return MODULES.some(m => m.parentId === parentId)
}

// Get only top-level modules (no parent, using config's moduleParents if provided)
export function getTopLevelModules(config?: ModuleConfig): ModuleDefinition[] {
  if (config) {
    return MODULES.filter(m => !config.moduleParents[m.id])
  }
  return MODULES.filter(m => !m.parentId)
}

// Get the parent of a module (using config's moduleParents)
export function getModuleParent(moduleId: ModuleId, config: ModuleConfig): ParentId {
  return config.moduleParents[moduleId] || null
}

// Check if an ID is a custom group ID
export function isCustomGroupId(id: string): boolean {
  return id.startsWith('group-')
}

// Get a custom group by ID
export function getCustomGroup(groupId: string, config: ModuleConfig): CustomGroup | undefined {
  return config.customGroups.find(g => g.id === groupId)
}

// Get visible custom groups (enabled and in order)
export function getVisibleCustomGroups(config: ModuleConfig): CustomGroup[] {
  return config.customGroups
    .filter(g => g.enabled)
    .sort((a, b) => a.position - b.position)
}

// Type for combined order list items
export type OrderListItem = 
  | { type: 'module'; id: ModuleId }
  | { type: 'divider'; id: string }
  | { type: 'group'; id: string }

// Build a combined order list with modules, dividers, and groups interleaved
export function buildCombinedOrderList(
  moduleOrder: ModuleId[],
  dividers: SectionDivider[],
  customGroups: CustomGroup[] = []
): OrderListItem[] {
  const result: OrderListItem[] = []
  const sortedDividers = [...dividers].sort((a, b) => a.position - b.position)
  const sortedGroups = [...customGroups].sort((a, b) => a.position - b.position)
  
  let dividerIdx = 0
  let groupIdx = 0
  
  for (let i = 0; i < moduleOrder.length; i++) {
    // Add any groups that come before this position
    while (groupIdx < sortedGroups.length && sortedGroups[groupIdx].position === i) {
      result.push({ type: 'group', id: sortedGroups[groupIdx].id })
      groupIdx++
    }
    
    result.push({ type: 'module', id: moduleOrder[i] })
    
    // Add any dividers that come after this position
    while (dividerIdx < sortedDividers.length && sortedDividers[dividerIdx].position === i) {
      result.push({ type: 'divider', id: sortedDividers[dividerIdx].id })
      dividerIdx++
    }
  }
  
  // Add any remaining groups at the end
  while (groupIdx < sortedGroups.length) {
    result.push({ type: 'group', id: sortedGroups[groupIdx].id })
    groupIdx++
  }
  
  // Add any remaining dividers at the end
  while (dividerIdx < sortedDividers.length) {
    result.push({ type: 'divider', id: sortedDividers[dividerIdx].id })
    dividerIdx++
  }
  
  return result
}

// Extract module order, divider positions, and group positions from a combined list
export function extractFromCombinedList(
  combinedList: OrderListItem[],
  existingDividers: SectionDivider[],
  existingGroups: CustomGroup[] = []
): { moduleOrder: ModuleId[]; dividers: SectionDivider[]; customGroups: CustomGroup[] } {
  const moduleOrder: ModuleId[] = []
  const dividers: SectionDivider[] = []
  const customGroups: CustomGroup[] = []
  
  let moduleIndex = -1
  for (const item of combinedList) {
    if (item.type === 'module') {
      moduleIndex++
      moduleOrder.push(item.id)
    } else if (item.type === 'divider') {
      // Find existing divider to preserve enabled state
      const existing = existingDividers.find(d => d.id === item.id)
      dividers.push({
        id: item.id,
        enabled: existing?.enabled ?? true,
        position: moduleIndex  // Position is after the last module
      })
    } else if (item.type === 'group') {
      // Find existing group to preserve all properties
      const existing = existingGroups.find(g => g.id === item.id)
      if (existing) {
        customGroups.push({
          ...existing,
          position: moduleIndex + 1  // Position before next module
        })
      }
    }
  }
  
  return { moduleOrder, dividers, customGroups }
}
