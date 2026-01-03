import { StateCreator } from 'zustand'
import type { PDMStoreState, ModulesSlice } from '../types'
import type { ModuleId, ModuleConfig, OrgModuleDefaults, OrderListItem } from '../../types/modules'
import { getDefaultModuleConfig, MODULES, MODULE_GROUPS, isModuleVisible, extractFromCombinedList } from '../../types/modules'
import { supabase } from '../../lib/supabase'

export const createModulesSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ModulesSlice
> = (set, get) => ({
  // Initial state
  moduleConfig: getDefaultModuleConfig(),
  
  // Actions
  setModuleConfig: (config) => set({ moduleConfig: config }),
  
  setModuleEnabled: (moduleId, enabled) => {
    set(state => {
      const newEnabledModules = { ...state.moduleConfig.enabledModules, [moduleId]: enabled }
      
      // If disabling a module, check if any dependent modules need to be disabled
      if (!enabled) {
        for (const mod of MODULES) {
          if (mod.dependencies?.includes(moduleId)) {
            newEnabledModules[mod.id] = false
          }
        }
      }
      
      return {
        moduleConfig: {
          ...state.moduleConfig,
          enabledModules: newEnabledModules
        }
      }
    })
  },
  
  setGroupEnabled: (groupId, enabled) => {
    set(state => {
      const group = MODULE_GROUPS.find(g => g.id === groupId)
      const newEnabledGroups = { ...state.moduleConfig.enabledGroups, [groupId]: enabled }
      const newEnabledModules = { ...state.moduleConfig.enabledModules }
      
      // If this is a master toggle group, enable/disable all modules in the group
      if (group?.isMasterToggle) {
        for (const mod of MODULES) {
          if (mod.group === groupId) {
            // When enabling, restore to default. When disabling, disable all.
            newEnabledModules[mod.id] = enabled ? mod.defaultEnabled : false
          }
        }
      }
      
      return {
        moduleConfig: {
          ...state.moduleConfig,
          enabledGroups: newEnabledGroups,
          enabledModules: newEnabledModules
        }
      }
    })
  },
  
  setModuleOrder: (moduleOrder) => {
    set(state => ({
      moduleConfig: { ...state.moduleConfig, moduleOrder }
    }))
  },
  
  reorderModule: (fromIndex, toIndex) => {
    set(state => {
      const newOrder = [...state.moduleConfig.moduleOrder]
      const [removed] = newOrder.splice(fromIndex, 1)
      newOrder.splice(toIndex, 0, removed)
      return {
        moduleConfig: { ...state.moduleConfig, moduleOrder: newOrder }
      }
    })
  },
  
  setDividerEnabled: (dividerId, enabled) => {
    set(state => ({
      moduleConfig: {
        ...state.moduleConfig,
        dividers: state.moduleConfig.dividers.map(d =>
          d.id === dividerId ? { ...d, enabled } : d
        )
      }
    }))
  },
  
  setCombinedOrder: (combinedList: OrderListItem[]) => {
    const { moduleConfig } = get()
    const { moduleOrder, dividers, customGroups } = extractFromCombinedList(
      combinedList, 
      moduleConfig.dividers,
      moduleConfig.customGroups
    )
    set({
      moduleConfig: {
        ...moduleConfig,
        moduleOrder,
        dividers,
        customGroups
      }
    })
  },
  
  addDivider: (afterPosition) => {
    set(state => {
      const newId = `divider-${Date.now()}`
      return {
        moduleConfig: {
          ...state.moduleConfig,
          dividers: [...state.moduleConfig.dividers, { id: newId, enabled: true, position: afterPosition }]
        }
      }
    })
  },
  
  removeDivider: (dividerId) => {
    set(state => ({
      moduleConfig: {
        ...state.moduleConfig,
        dividers: state.moduleConfig.dividers.filter(d => d.id !== dividerId)
      }
    }))
  },
  
  setModuleParent: (moduleId, parentId) => {
    set(state => ({
      moduleConfig: {
        ...state.moduleConfig,
        moduleParents: {
          ...state.moduleConfig.moduleParents,
          [moduleId]: parentId
        }
      }
    }))
  },
  
  setModuleIconColor: (moduleId, color) => {
    set(state => ({
      moduleConfig: {
        ...state.moduleConfig,
        moduleIconColors: {
          ...state.moduleConfig.moduleIconColors,
          [moduleId]: color
        }
      }
    }))
  },
  
  addCustomGroup: (name, icon, iconColor) => {
    const groupId = `group-${Date.now()}`
    set(state => {
      // Add at the end of the module order
      const position = state.moduleConfig.moduleOrder.length
      return {
        moduleConfig: {
          ...state.moduleConfig,
          customGroups: [
            ...state.moduleConfig.customGroups,
            { id: groupId, name, icon, iconColor, position, enabled: true }
          ]
        }
      }
    })
    return groupId
  },
  
  updateCustomGroup: (groupId, updates) => {
    set(state => ({
      moduleConfig: {
        ...state.moduleConfig,
        customGroups: state.moduleConfig.customGroups.map(g =>
          g.id === groupId ? { ...g, ...updates } : g
        )
      }
    }))
  },
  
  removeCustomGroup: (groupId) => {
    set(state => {
      // Remove group and unset any modules that had this as parent
      const newModuleParents = { ...state.moduleConfig.moduleParents }
      for (const [moduleId, parentId] of Object.entries(newModuleParents)) {
        if (parentId === groupId) {
          newModuleParents[moduleId as ModuleId] = null
        }
      }
      
      return {
        moduleConfig: {
          ...state.moduleConfig,
          customGroups: state.moduleConfig.customGroups.filter(g => g.id !== groupId),
          moduleParents: newModuleParents
        }
      }
    })
  },
  
  resetModulesToDefaults: () => {
    set({ moduleConfig: getDefaultModuleConfig() })
  },
  
  loadOrgModuleDefaults: async () => {
    const { organization } = get()
    if (!organization?.id) {
      return { success: false, error: 'No organization connected' }
    }
    
    try {
      const { data, error } = await (supabase.rpc as any)('get_org_module_defaults', {
        p_org_id: organization.id
      })
      
      if (error) throw error
      
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return { success: false, error: 'No org module defaults configured' }
      }
      
      const defaults = Array.isArray(data) ? data[0] : data
      if (defaults) {
        const moduleConfig: ModuleConfig = {
          enabledModules: defaults.enabled_modules || getDefaultModuleConfig().enabledModules,
          enabledGroups: defaults.enabled_groups || getDefaultModuleConfig().enabledGroups,
          moduleOrder: defaults.module_order || getDefaultModuleConfig().moduleOrder,
          dividers: defaults.dividers || getDefaultModuleConfig().dividers,
          moduleParents: defaults.module_parents || getDefaultModuleConfig().moduleParents,
          moduleIconColors: defaults.module_icon_colors || getDefaultModuleConfig().moduleIconColors,
          customGroups: defaults.custom_groups || getDefaultModuleConfig().customGroups,
        }
        set({ moduleConfig })
      }
      
      return { success: true }
    } catch (err) {
      console.error('Failed to load org module defaults:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },
  
  saveOrgModuleDefaults: async () => {
    const { organization, moduleConfig, getEffectiveRole } = get()
    if (!organization?.id) {
      return { success: false, error: 'No organization connected' }
    }
    if (getEffectiveRole() !== 'admin') {
      return { success: false, error: 'Only admins can save org module defaults' }
    }
    
    try {
      const { error } = await (supabase.rpc as any)('set_org_module_defaults', {
        p_org_id: organization.id,
        p_enabled_modules: moduleConfig.enabledModules,
        p_enabled_groups: moduleConfig.enabledGroups,
        p_module_order: moduleConfig.moduleOrder,
        p_dividers: moduleConfig.dividers,
        p_module_parents: moduleConfig.moduleParents,
        p_module_icon_colors: moduleConfig.moduleIconColors,
        p_custom_groups: moduleConfig.customGroups
      })
      
      if (error) throw error
      return { success: true }
    } catch (err) {
      console.error('Failed to save org module defaults:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },
  
  loadTeamModuleDefaults: async (teamId: string) => {
    try {
      const { data, error } = await (supabase.rpc as any)('get_team_module_defaults', {
        p_team_id: teamId
      })
      
      if (error) throw error
      
      // Convert from database format (snake_case) to TypeScript format (camelCase)
      if (data) {
        const defaults: OrgModuleDefaults = {
          enabledModules: data.enabled_modules || {},
          enabledGroups: data.enabled_groups || {},
          moduleOrder: data.module_order || [],
          dividers: data.dividers || [],
          moduleParents: data.module_parents || {},
          moduleIconColors: data.module_icon_colors || {},
          customGroups: data.custom_groups || []
        }
        return { success: true, defaults }
      }
      
      return { success: true, defaults: null }
    } catch (err) {
      console.error('Failed to load team module defaults:', err)
      return { success: false, defaults: null, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },
  
  saveTeamModuleDefaults: async (teamId: string, config?: ModuleConfig) => {
    const { moduleConfig } = get()
    const configToSave = config || moduleConfig
    
    try {
      const { error } = await (supabase.rpc as any)('set_team_module_defaults', {
        p_team_id: teamId,
        p_enabled_modules: configToSave.enabledModules,
        p_enabled_groups: configToSave.enabledGroups,
        p_module_order: configToSave.moduleOrder,
        p_dividers: configToSave.dividers,
        p_module_parents: configToSave.moduleParents,
        p_module_icon_colors: configToSave.moduleIconColors,
        p_custom_groups: configToSave.customGroups
      })
      
      if (error) throw error
      return { success: true }
    } catch (err) {
      console.error('Failed to save team module defaults:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },
  
  clearTeamModuleDefaults: async (teamId: string) => {
    try {
      const { error } = await (supabase.rpc as any)('clear_team_module_defaults', {
        p_team_id: teamId
      })
      
      if (error) throw error
      return { success: true }
    } catch (err) {
      console.error('Failed to clear team module defaults:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },
  
  loadUserModuleDefaults: async () => {
    try {
      const { data, error } = await (supabase.rpc as any)('get_user_module_defaults', {})
      
      if (error) throw error
      
      // Convert from database format (snake_case) to TypeScript format (camelCase)
      if (data) {
        const defaults: OrgModuleDefaults = {
          enabledModules: data.enabled_modules || {},
          enabledGroups: data.enabled_groups || {},
          moduleOrder: data.module_order || [],
          dividers: data.dividers || [],
          moduleParents: data.module_parents || {},
          moduleIconColors: data.module_icon_colors || {},
          customGroups: data.custom_groups || []
        }
        return { success: true, defaults }
      }
      
      return { success: true, defaults: null }
    } catch (err) {
      console.error('Failed to load user module defaults:', err)
      return { success: false, defaults: null, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },
  
  isModuleVisible: (moduleId) => {
    const { moduleConfig } = get()
    return isModuleVisible(moduleId, moduleConfig)
  },
})
