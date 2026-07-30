/**
 * Store Migration System
 *
 * Each migration transforms persisted state from one version to the next.
 * Migrations run in order when the app loads with older persisted data.
 */

import { mergeModuleOrder, type ModuleId } from '../types/modules'

export interface StoreMigration {
  version: number
  description: string
  migrate: (state: Record<string, unknown>) => Record<string, unknown>
}

// Current schema version - increment when adding migrations
export const CURRENT_STORE_VERSION = 11

// In-development Quality modules that were previously nested under the
// 'group-quality' cascade menu and are now removed from the default sidebar.
const IN_DEV_QUALITY_MODULES = [
  'fai',
  'ncr',
  'imr',
  'scar',
  'capa',
  'rma',
  'certificates',
  'calibration',
  'quality-templates',
]

// Placeholder modules deleted in v11: they never had a view, only a
// "Coming soon" panel. Persisted sidebar configs still carry their ids.
const REMOVED_PLACEHOLDER_MODULES = [
  'boms',
  // Purchasing
  'purchase-requests',
  'purchase-orders',
  'invoices',
  // Logistics
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
  // Production analytics
  'production-analytics',
  'yield-tracking',
  'error-codes',
  'downtime',
  'oee',
  'scrap-tracking',
  // Quality
  ...IN_DEV_QUALITY_MODULES,
  // Accounting
  'accounts-payable',
  'accounts-receivable',
  'general-ledger',
  'cost-tracking',
  'budgets',
]

// Custom sidebar groups whose every child module was removed above
const REMOVED_CUSTOM_GROUPS = ['group-production', 'group-accounting']

// Module groups deleted alongside their modules
const REMOVED_MODULE_GROUPS = [
  'supply-chain-purchasing',
  'supply-chain-logistics',
  'production',
  'production-analytics',
  'accounting',
]

/**
 * All migrations in order. Each transforms state from previous version.
 */
export const migrations: StoreMigration[] = [
  {
    version: 2,
    description: 'Force auto-download settings OFF for v3.5 (user can re-enable)',
    migrate: (state) => ({
      ...state,
      autoDownloadCloudFiles: false,
      autoDownloadUpdates: false,
    }),
  },
  {
    version: 3,
    description: 'Enable auto-discard orphaned files by default',
    migrate: (state) => ({
      ...state,
      autoDiscardOrphanedFiles: true,
    }),
  },
  {
    version: 4,
    description: 'Remove contains tab (functionality moved to main view dropdowns)',
    migrate: (state) => {
      const rightPanelTabs = Array.isArray(state.rightPanelTabs)
        ? (state.rightPanelTabs as string[]).filter((t) => t !== 'contains')
        : state.rightPanelTabs
      const bottomPanelTabOrder = Array.isArray(state.bottomPanelTabOrder)
        ? (state.bottomPanelTabOrder as string[]).filter((t) => t !== 'contains')
        : state.bottomPanelTabOrder
      return {
        ...state,
        rightPanelTabs,
        bottomPanelTabOrder,
        detailsPanelTab: state.detailsPanelTab === 'contains' ? 'preview' : state.detailsPanelTab,
        rightPanelTab:
          state.rightPanelTab === 'contains'
            ? Array.isArray(rightPanelTabs) && rightPanelTabs.length > 0
              ? rightPanelTabs[0]
              : null
            : state.rightPanelTab,
      }
    },
  },
  {
    version: 5,
    description: 'Move Item Browser module from Products group to top of Quality group',
    migrate: (state) => {
      const moduleConfig = state.moduleConfig
      if (!moduleConfig || typeof moduleConfig !== 'object') {
        return state
      }

      const config = moduleConfig as Record<string, unknown>

      // Re-parent 'items' to the Quality group
      const moduleParents =
        config.moduleParents && typeof config.moduleParents === 'object'
          ? { ...(config.moduleParents as Record<string, unknown>), items: 'group-quality' }
          : config.moduleParents

      // Move 'items' to the top of the Quality block (right before 'fai')
      let moduleOrder = config.moduleOrder
      if (Array.isArray(moduleOrder)) {
        const filtered = (moduleOrder as string[]).filter((id) => id !== 'items')
        const faiIndex = filtered.indexOf('fai')
        if (faiIndex >= 0) {
          filtered.splice(faiIndex, 0, 'items')
        } else {
          filtered.push('items')
        }
        moduleOrder = filtered
      }

      return {
        ...state,
        moduleConfig: {
          ...config,
          moduleParents,
          moduleOrder,
        },
      }
    },
  },
  {
    version: 6,
    description:
      'Simplify Quality: un-nest Item Browser to top-level, remove in-dev quality modules from sidebar; drop stale itemBrowserHiddenColumns',
    migrate: (state) => {
      // Drop the stale item browser column-visibility key (replaced by itemColumns)
      const { itemBrowserHiddenColumns: _removed, ...rest } = state as Record<string, unknown>

      const moduleConfig = rest.moduleConfig
      if (!moduleConfig || typeof moduleConfig !== 'object') {
        return rest
      }

      const config = moduleConfig as Record<string, unknown>

      // Re-parent 'items' to top-level and detach the in-dev quality modules
      let moduleParents = config.moduleParents
      if (moduleParents && typeof moduleParents === 'object') {
        const parents = { ...(moduleParents as Record<string, unknown>) }
        parents.items = null
        for (const id of IN_DEV_QUALITY_MODULES) parents[id] = null
        moduleParents = parents
      }

      // Remove the in-dev quality modules from the sidebar order (keep 'items')
      let moduleOrder = config.moduleOrder
      if (Array.isArray(moduleOrder)) {
        moduleOrder = (moduleOrder as string[]).filter((id) => !IN_DEV_QUALITY_MODULES.includes(id))
      }

      // Remove the now-unused 'group-quality' cascade group
      let customGroups = config.customGroups
      if (Array.isArray(customGroups)) {
        customGroups = (customGroups as Array<Record<string, unknown>>).filter(
          (g) => g.id !== 'group-quality',
        )
      }

      return {
        ...rest,
        moduleConfig: {
          ...config,
          moduleParents,
          moduleOrder,
          customGroups,
        },
      }
    },
  },
  {
    version: 7,
    description:
      'Reset Item Browser columns so the thinner default Item Number width and file previews apply',
    migrate: (state) => {
      // Drop persisted itemColumns so the slice default (thinner Item Number
      // column) is used. Users can re-customize widths afterwards.
      const { itemColumns: _removed, ...rest } = state as Record<string, unknown>
      return rest
    },
  },
  {
    version: 8,
    description: 'Halve the default Item Browser Item Number column width',
    migrate: (state) => {
      // Drop persisted itemColumns again so the narrower default applies.
      const { itemColumns: _removed, ...rest } = state as Record<string, unknown>
      return rest
    },
  },
  {
    version: 9,
    description:
      'Add Designation column, narrow Rev, and shrink Description in the Item Browser defaults',
    migrate: (state) => {
      // Drop persisted itemColumns so the new default (with Designation column
      // and adjusted Rev/Description widths) applies. Users can re-customize.
      const { itemColumns: _removed, ...rest } = state as Record<string, unknown>
      return rest
    },
  },
  {
    version: 10,
    description: 'Restore modules missing from a saved sidebar order, including Customers',
    migrate: (state) => {
      const moduleConfig = state.moduleConfig
      if (!moduleConfig || typeof moduleConfig !== 'object') return state

      const config = moduleConfig as Record<string, unknown>
      if (!Array.isArray(config.moduleOrder)) return state

      return {
        ...state,
        moduleConfig: {
          ...config,
          moduleOrder: mergeModuleOrder(config.moduleOrder as ModuleId[]),
        },
      }
    },
  },
  {
    version: 11,
    description:
      'Drop the in-development placeholder modules (purchasing, logistics, production, analytics, quality, accounting, BOMs) from the persisted sidebar',
    migrate: (state) => {
      const moduleConfig = state.moduleConfig
      if (!moduleConfig || typeof moduleConfig !== 'object') return state

      const config = moduleConfig as Record<string, unknown>
      const isRemoved = (id: string) => REMOVED_PLACEHOLDER_MODULES.includes(id)

      const oldOrder = Array.isArray(config.moduleOrder) ? (config.moduleOrder as string[]) : null
      const newOrder = oldOrder ? oldOrder.filter((id) => !isRemoved(id)) : null

      // Divider positions are indexes into moduleOrder, so removing modules
      // ahead of a divider would slide it down the sidebar. Re-anchor each one
      // to the module it used to sit after.
      let dividers = config.dividers
      if (oldOrder && newOrder && Array.isArray(dividers)) {
        dividers = (dividers as Array<Record<string, unknown>>).map((divider) => {
          const position = divider.position
          if (typeof position !== 'number') return divider

          for (let i = Math.min(position, oldOrder.length - 1); i >= 0; i--) {
            const anchor = newOrder.indexOf(oldOrder[i])
            if (anchor !== -1) return { ...divider, position: anchor }
          }
          return { ...divider, position: 0 }
        })
      }

      const dropRemovedKeys = (value: unknown) => {
        if (!value || typeof value !== 'object') return value
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).filter(([id]) => !isRemoved(id)),
        )
      }

      // Group headers are inserted before the module at their position, so they
      // need the same re-anchoring as dividers, looking forwards instead.
      let customGroups = config.customGroups
      if (Array.isArray(customGroups)) {
        customGroups = (customGroups as Array<Record<string, unknown>>)
          .filter((group) => !REMOVED_CUSTOM_GROUPS.includes(group.id as string))
          .map((group) => {
            const position = group.position
            if (!oldOrder || !newOrder || typeof position !== 'number') return group

            for (let i = position; i < oldOrder.length; i++) {
              const anchor = newOrder.indexOf(oldOrder[i])
              if (anchor !== -1) return { ...group, position: anchor }
            }
            return { ...group, position: newOrder.length }
          })
      }

      // A module parented to a group that just disappeared would vanish from
      // the sidebar entirely, so pull any survivors back up to the top level.
      let moduleParents = dropRemovedKeys(config.moduleParents)
      if (moduleParents && typeof moduleParents === 'object') {
        moduleParents = Object.fromEntries(
          Object.entries(moduleParents as Record<string, unknown>).map(([id, parent]) => [
            id,
            REMOVED_CUSTOM_GROUPS.includes(parent as string) ? null : parent,
          ]),
        )
      }

      const enabledGroups =
        config.enabledGroups && typeof config.enabledGroups === 'object'
          ? Object.fromEntries(
              Object.entries(config.enabledGroups as Record<string, unknown>).filter(
                ([id]) => !REMOVED_MODULE_GROUPS.includes(id),
              ),
            )
          : config.enabledGroups

      // A stale activeView pointing at a deleted module is already reset to the
      // explorer by the store's merge step, so it needs nothing here.
      return {
        ...state,
        moduleConfig: {
          ...config,
          moduleOrder: newOrder ?? config.moduleOrder,
          dividers,
          moduleParents,
          customGroups,
          enabledGroups,
          enabledModules: dropRemovedKeys(config.enabledModules),
          moduleIconColors: dropRemovedKeys(config.moduleIconColors),
        },
      }
    },
  },
]

/**
 * Run all necessary migrations on persisted state
 */
export function runMigrations(
  persistedState: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let state = { ...persistedState }

  for (const migration of migrations) {
    if (migration.version > fromVersion) {
      state = migration.migrate(state)
    }
  }

  // Always set current version after migrations
  state._storeVersion = CURRENT_STORE_VERSION

  return state
}

/**
 * Get the version from persisted state, defaulting to 0 for legacy data
 */
export function getPersistedVersion(state: Record<string, unknown>): number {
  return typeof state._storeVersion === 'number' ? state._storeVersion : 0
}
