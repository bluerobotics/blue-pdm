import { StateCreator } from 'zustand'
import type { PDMStoreState, UserSlice, ImpersonatedUser } from '../types'
import type { User, Organization } from '../../types/pdm'
import type { ModuleId, ModuleGroupId, ModuleConfig } from '../../types/modules'

export const createUserSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  UserSlice
> = (set, get) => ({
  // Initial state
  user: null,
  organization: null,
  isAuthenticated: false,
  isOfflineMode: false,
  isConnecting: false,
  impersonatedUser: null,
  userTeams: null,
  userPermissions: null,
  permissionsLoaded: false,
  permissionsLastUpdated: 0,
  
  // Actions
  setUser: (user: User | null) => set({ user, isAuthenticated: !!user }),
  setOrganization: (organization: Organization | null) => set({ organization, isConnecting: false }),
  setOfflineMode: (isOfflineMode) => set({ isOfflineMode }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  signOut: () => set({ 
    user: null, 
    organization: null, 
    isAuthenticated: false, 
    isOfflineMode: false, 
    isConnecting: false, 
    impersonatedUser: null 
  }),
  
  // Get effective role (considering user impersonation)
  getEffectiveRole: () => {
    const { user, impersonatedUser } = get()
    if (impersonatedUser) return impersonatedUser.role
    return user?.role ?? 'member'
  },
  
  // Actions - User Impersonation (admin feature)
  startUserImpersonation: async (targetUserId: string, customUser) => {
    const { user, addToast, moduleConfig: defaultConfig } = get()
    
    // Only real admins can impersonate
    if (user?.role !== 'admin') {
      addToast('error', 'Only admins can impersonate users')
      return
    }
    
    // Can't impersonate yourself
    if (user.id === targetUserId) {
      addToast('error', 'Cannot impersonate yourself')
      return
    }
    
    // If a custom user is provided (e.g., pending member), use that directly
    if (customUser) {
      // For pending members, we need to load their team permissions, module config, and vault access
      const teamIds = (customUser.teams || []).map(t => t.id)
      let permissions: Record<string, string[]> = {}
      let moduleConfig: ModuleConfig | undefined
      let vaultIds: string[] = []
      
      if (teamIds.length > 0) {
        const { supabase } = await import('../../lib/supabase')
        
        // Load team vault access
        const { data: vaultAccessData } = await (supabase as any)
          .from('team_vault_access')
          .select('vault_id')
          .in('team_id', teamIds)
        
        if (vaultAccessData && vaultAccessData.length > 0) {
          vaultIds = [...new Set((vaultAccessData as Array<{ vault_id: string }>).map(v => v.vault_id))]
        }
        
        // Load team permissions
        const { data: permsData } = await supabase
          .from('team_permissions')
          .select('resource, actions')
          .in('team_id', teamIds)
        
        // Merge permissions from all teams
        for (const perm of (permsData || []) as { resource: string; actions: string[] }[]) {
          if (!permissions[perm.resource]) {
            permissions[perm.resource] = []
          }
          for (const action of perm.actions) {
            if (!permissions[perm.resource].includes(action)) {
              permissions[perm.resource].push(action)
            }
          }
        }
        
        // Load team module defaults and merge (union of enabled modules)
        const { data: teamsData } = await (supabase as any)
          .from('teams')
          .select('id, module_defaults')
          .in('id', teamIds)
        
        if (teamsData && teamsData.length > 0) {
          const mergedEnabledModules: Record<string, boolean> = {}
          const mergedEnabledGroups: Record<string, boolean> = {}
          let firstTeamConfig: ModuleConfig | null = null
          
          for (const team of teamsData as Array<{ id: string; module_defaults: any }>) {
            const defaults = team.module_defaults
            if (!defaults) continue
            
            // Use first team's config as base for order, dividers, etc.
            if (!firstTeamConfig) {
              firstTeamConfig = {
                enabledModules: defaults.enabled_modules || {},
                enabledGroups: defaults.enabled_groups || {},
                moduleOrder: defaults.module_order || defaultConfig.moduleOrder,
                dividers: defaults.dividers || [],
                moduleParents: defaults.module_parents || {},
                moduleIconColors: defaults.module_icon_colors || {},
                customGroups: defaults.custom_groups || []
              } as ModuleConfig
            }
            
            // Union enabled modules (if ANY team enables a module, it's enabled)
            for (const [moduleId, enabled] of Object.entries(defaults.enabled_modules || {})) {
              if (enabled) {
                mergedEnabledModules[moduleId] = true
              } else if (mergedEnabledModules[moduleId] === undefined) {
                mergedEnabledModules[moduleId] = false
              }
            }
            
            // Union enabled groups
            for (const [groupId, enabled] of Object.entries(defaults.enabled_groups || {})) {
              if (enabled) {
                mergedEnabledGroups[groupId] = true
              } else if (mergedEnabledGroups[groupId] === undefined) {
                mergedEnabledGroups[groupId] = false
              }
            }
          }
          
          if (firstTeamConfig) {
            moduleConfig = {
              ...firstTeamConfig,
              enabledModules: mergedEnabledModules as Record<ModuleId, boolean>,
              enabledGroups: mergedEnabledGroups as Record<ModuleGroupId, boolean>
            }
          }
        }
      }
      
      const impersonatedUser: ImpersonatedUser = {
        id: customUser.id,
        email: customUser.email,
        full_name: customUser.full_name,
        avatar_url: null,
        role: customUser.role as 'admin' | 'engineer' | 'viewer',
        teams: customUser.teams || [],
        permissions,
        vaultIds,
        moduleConfig
      }
      
      set({ impersonatedUser })
      
      addToast('info', `Now viewing as ${customUser.full_name || customUser.email} (pending)`)
      return
    }
    
    try {
      const { loadImpersonatedUserContext } = await import('../../lib/supabase')
      const result = await loadImpersonatedUserContext(targetUserId)
      
      if (result.error || !result.user) {
        addToast('error', result.error || 'Failed to load user context')
        return
      }
      
      set({ impersonatedUser: result.user })
      
      addToast('info', `Now viewing as ${result.user.full_name || result.user.email}`)
    } catch (err) {
      console.error('Failed to start user impersonation:', err)
      addToast('error', 'Failed to start impersonation')
    }
  },
  
  stopUserImpersonation: () => {
    const { impersonatedUser, addToast } = get()
    if (impersonatedUser) {
      set({ impersonatedUser: null })
      addToast('info', 'Stopped viewing as another user')
    }
  },
  
  getImpersonatedUser: () => get().impersonatedUser,
  
  getEffectiveVaultIds: () => {
    const { impersonatedUser } = get()
    // If impersonating, return impersonated user's vault access
    if (impersonatedUser) {
      return impersonatedUser.vaultIds
    }
    // For real user, return empty (means all vaults - actual filtering happens in supabase)
    return []
  },
  
  getEffectiveModuleConfig: () => {
    const { impersonatedUser, moduleConfig } = get()
    // If impersonating and user has a module config, use it
    if (impersonatedUser?.moduleConfig) {
      return impersonatedUser.moduleConfig
    }
    // Otherwise use the real user's module config
    return moduleConfig
  },
  
  // Actions - Teams & Permissions
  loadUserPermissions: async () => {
    const { user } = get()
    if (!user) {
      set({ userTeams: null, userPermissions: null, permissionsLoaded: false })
      return
    }
    
    try {
      const { getUserTeams, getUserPermissions } = await import('../../lib/supabase')
      
      // Load teams
      const { teams } = await getUserTeams(user.id)
      
      // Load permissions
      const { permissions } = await getUserPermissions(user.id, user.role)
      
      set({
        userTeams: teams,
        userPermissions: permissions,
        permissionsLoaded: true
      })
    } catch (err) {
      console.error('Failed to load user permissions:', err)
      set({ permissionsLoaded: true })
    }
  },
  
  hasPermission: (resource: string, action: string) => {
    const { user, impersonatedUser, userPermissions } = get()
    
    // If impersonating a user, use their permissions
    if (impersonatedUser) {
      // Impersonated admin gets full access
      if (impersonatedUser.role === 'admin') {
        return true
      }
      const resourcePerms = impersonatedUser.permissions[resource] || []
      return resourcePerms.includes(action) || resourcePerms.includes('admin')
    }
    
    // Admins always have full access
    if (user?.role === 'admin') {
      return true
    }
    
    // Check team-based permissions
    if (!userPermissions) return false
    
    // Check for __admin__ flag (returned for admin users)
    if (userPermissions.__admin__) return true
    
    const resourcePerms = userPermissions[resource] || []
    return resourcePerms.includes(action) || resourcePerms.includes('admin')
  },
  
  // Update organization with partial data (for local state sync after API calls)
  updateOrganization: (updates: Partial<Organization>) => set((state) => ({
    organization: state.organization 
      ? { ...state.organization, ...updates }
      : null
  })),
})
