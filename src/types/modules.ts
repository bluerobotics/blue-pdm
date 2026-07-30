// Module system type definitions

// All available sidebar modules
export type ModuleId =
  // Source Files (PDM)
  | 'explorer'
  | 'pending'
  | 'history'
  | 'workflows'
  | 'reviews'
  | 'trash'
  // Items
  | 'items'
  | 'products'
  // Change Control
  | 'ecr'
  | 'eco'
  | 'deviations'
  | 'release-schedule'
  | 'process'
  // Supply Chain - Suppliers
  | 'supplier-database'
  | 'supplier-portal'
  // Customers
  | 'customers'
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
  | 'quality'
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
  icon: string // Lucide icon name
  iconColor: string | null // Custom color or null for default
  // Position in the sidebar order (index in combined order)
  position: number
  enabled: boolean
}

// Individual module definition
export interface ModuleDefinition {
  id: ModuleId
  name: string
  group: ModuleGroupId
  icon: string // Lucide icon name
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
  moduleOrder: ModuleId[] // Custom order of modules in sidebar
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
  // Products
  {
    id: 'items',
    name: 'Products',
    description: 'Product explorer',
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
    description: 'Suppliers and customers',
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
  // Quality
  {
    id: 'quality',
    name: 'Quality',
    description: 'Item inspection and compliance records',
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
    isMasterToggle: false, // Cannot disable system modules
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
    id: 'reviews',
    name: 'Reviews',
    group: 'system',
    icon: 'Bell',
    defaultEnabled: true,
    required: true,
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
  // PRODUCTS
  // ============================================
  {
    id: 'products',
    name: 'Product Explorer',
    group: 'items',
    icon: 'Package',
    defaultEnabled: true,
  },
  {
    id: 'items',
    name: 'Item Browser',
    group: 'quality',
    icon: 'ShieldCheck',
    defaultEnabled: true,
    implemented: true,
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
    id: 'customers',
    name: 'Customers',
    group: 'supply-chain',
    icon: 'Users',
    defaultEnabled: false, // Hidden by default
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
  // INTEGRATIONS
  // ============================================
  {
    id: 'google-drive',
    name: 'Google Drive',
    group: 'integrations',
    icon: 'GoogleDrive', // Custom icon
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
    defaultEnabled: false, // Hidden by default
    implemented: true,
  },
  {
    id: 'settings',
    name: 'Settings',
    group: 'system',
    icon: 'Settings',
    defaultEnabled: true,
    required: true, // Cannot be disabled
    implemented: true,
  },
]

// Default section dividers (groups provide visual separation, so minimal dividers)
export const DEFAULT_DIVIDERS: SectionDivider[] = [
  // Divider before integrations/system
  { id: 'divider-1', enabled: true, position: 13 }, // After the Item Browser, before Customers
]

// Default module order
export const DEFAULT_MODULE_ORDER: ModuleId[] = [
  // Source Files
  'explorer', // 0
  'pending',
  'history',
  'workflows',
  'trash',
  // Products
  'products', // 5
  // Change Control
  'ecr', // 6
  'eco',
  'deviations',
  'release-schedule',
  'process',
  // Supply Chain - Suppliers
  'supplier-database', // 11
  'supplier-portal',
  // Quality (single top-level entry; opens the Item Browser)
  'items', // 13
  // Customers
  'customers', // 14
  // Integrations
  'google-drive', // 15
  // System (reviews and settings at bottom)
  'terminal',
  'reviews',
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
  {
    id: 'group-source-files',
    name: 'Source Files',
    icon: 'FolderOpen',
    iconColor: null,
    position: 0,
    enabled: true,
  },
  {
    id: 'group-products',
    name: 'Products',
    icon: 'Package',
    iconColor: null,
    position: 5,
    enabled: true,
  },
  {
    id: 'group-change-control',
    name: 'Change Control',
    icon: 'GitPullRequest',
    iconColor: null,
    position: 6,
    enabled: true,
  },
  {
    id: 'group-supply-chain',
    name: 'Supply Chain',
    icon: 'Truck',
    iconColor: null,
    position: 11,
    enabled: true,
  },
]

// Default module-to-group parent assignments
export const DEFAULT_MODULE_PARENT_MAP: Record<ModuleId, ParentId> = {
  // Source Files group
  explorer: 'group-source-files',
  pending: 'group-source-files',
  history: 'group-source-files',
  workflows: 'group-source-files',
  trash: 'group-source-files',
  // Products group (after Source Files)
  products: 'group-products',
  // Change Control group
  ecr: 'group-change-control',
  eco: 'group-change-control',
  deviations: 'group-change-control',
  'release-schedule': 'group-change-control',
  process: 'group-change-control',
  // Supply Chain group
  'supplier-database': 'group-supply-chain',
  'supplier-portal': 'group-supply-chain',
  // Quality: single top-level entry (Item Browser)
  items: null,
  // Top-level (no parent)
  customers: null,
  'google-drive': null,
  terminal: null,
  reviews: null,
  settings: null,
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

/**
 * Reconcile a saved sidebar order with the modules the app ships today.
 *
 * A saved order is a snapshot from whenever the sidebar was last customized,
 * so modules added afterwards are absent from it. The sidebar renders strictly
 * from this list, which makes a new module invisible rather than merely
 * misplaced, so anything missing has to be put back. Appending would bury it
 * under Settings, so each one is instead anchored to its nearest neighbour
 * from the default order - that keeps it in its own section even when the user
 * has moved that section somewhere else.
 */
export function mergeModuleOrder(
  savedOrder: ModuleId[],
  defaults: ModuleId[] = DEFAULT_MODULE_ORDER,
): ModuleId[] {
  const result = [...savedOrder]
  const present = new Set(savedOrder)

  defaults.forEach((moduleId, defaultIndex) => {
    if (present.has(moduleId)) return
    present.add(moduleId)

    let insertAt: number | null = null

    for (let i = defaultIndex - 1; i >= 0 && insertAt === null; i--) {
      const idx = result.indexOf(defaults[i])
      if (idx >= 0) insertAt = idx + 1
    }

    for (let i = defaultIndex + 1; i < defaults.length && insertAt === null; i++) {
      const idx = result.indexOf(defaults[i])
      if (idx >= 0) insertAt = idx
    }

    result.splice(insertAt ?? result.length, 0, moduleId)
  })

  return result
}

/**
 * Helper to check if a module should be visible.
 *
 * `denied` carries the admin-managed module access allowlist (see the
 * module_access table). It is checked first and cannot be overridden by the
 * user's own sidebar config, since that config is client state the restricted
 * user controls.
 */
export function isModuleVisible(
  moduleId: ModuleId,
  config: ModuleConfig,
  denied?: ReadonlySet<ModuleId>,
): boolean {
  if (denied?.has(moduleId)) return false

  const module = MODULES.find((m) => m.id === moduleId)
  if (!module) return false

  // Check if group is enabled (for master toggle groups)
  const group = MODULE_GROUPS.find((g) => g.id === module.group)
  if (group?.isMasterToggle && !config.enabledGroups[module.group]) {
    return false
  }

  // Check parent group if exists
  if (group?.parentGroup) {
    const parentGroup = MODULE_GROUPS.find((g) => g.id === group.parentGroup)
    if (parentGroup?.isMasterToggle && !config.enabledGroups[group.parentGroup]) {
      return false
    }
  }

  // Check if custom group parent is enabled (if module is in a custom group)
  const customParentId = config.moduleParents?.[moduleId]
  if (customParentId && customParentId.startsWith('group-')) {
    const customGroup = config.customGroups?.find((g) => g.id === customParentId)
    if (customGroup && customGroup.enabled === false) {
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
export function canToggleModule(moduleId: ModuleId, _config: ModuleConfig): boolean {
  const module = MODULES.find((m) => m.id === moduleId)
  if (!module) return false

  // Required modules can never be toggled
  if (module.required) {
    return false
  }

  return true
}

// Get modules for a specific group
export function getModulesForGroup(groupId: ModuleGroupId): ModuleDefinition[] {
  return MODULES.filter((m) => m.group === groupId)
}

// Get a module definition by ID
export function getModuleById(moduleId: ModuleId): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === moduleId)
}

// Get a group definition by ID
export function getGroupById(groupId: ModuleGroupId): ModuleGroupDefinition | undefined {
  return MODULE_GROUPS.find((g) => g.id === groupId)
}

// Get child modules of a parent (module or custom group)
export function getChildModules(parentId: string, config?: ModuleConfig): ModuleDefinition[] {
  if (config) {
    return MODULES.filter((m) => config.moduleParents[m.id] === parentId)
  }
  return MODULES.filter((m) => m.parentId === parentId)
}

// Check if a module or group has children
export function hasChildModules(parentId: string, config?: ModuleConfig): boolean {
  if (config) {
    return MODULES.some((m) => config.moduleParents[m.id] === parentId)
  }
  return MODULES.some((m) => m.parentId === parentId)
}

// Get only top-level modules (no parent, using config's moduleParents if provided)
export function getTopLevelModules(config?: ModuleConfig): ModuleDefinition[] {
  if (config) {
    return MODULES.filter((m) => !config.moduleParents[m.id])
  }
  return MODULES.filter((m) => !m.parentId)
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
  return config.customGroups.find((g) => g.id === groupId)
}

// Get visible custom groups (enabled and in order)
export function getVisibleCustomGroups(config: ModuleConfig): CustomGroup[] {
  return config.customGroups.filter((g) => g.enabled).sort((a, b) => a.position - b.position)
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
  customGroups: CustomGroup[] = [],
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
  existingGroups: CustomGroup[] = [],
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
      const existing = existingDividers.find((d) => d.id === item.id)
      dividers.push({
        id: item.id,
        enabled: existing?.enabled ?? true,
        position: moduleIndex, // Position is after the last module
      })
    } else if (item.type === 'group') {
      // Find existing group to preserve all properties
      const existing = existingGroups.find((g) => g.id === item.id)
      if (existing) {
        customGroups.push({
          ...existing,
          position: moduleIndex + 1, // Position before next module
        })
      }
    }
  }

  return { moduleOrder, dividers, customGroups }
}
