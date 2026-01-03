// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect, useMemo } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  Shield,
  X,
  Loader2,
  Search,
  Database,
  Check,
  Minus,
  ChevronRight,
  ChevronDown,
  Users,
  UsersRound,
  UserX,
  Folder,
  Settings2
} from 'lucide-react'
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  ALL_RESOURCES
} from '../../../types/permissions'
import { supabase } from '../../../lib/supabase'
import { getEffectiveAvatarUrl } from '../../../types/pdm'
import { PERMISSION_RESOURCE_GROUPS } from './constants'
import type { OrgUser, Vault, TeamWithDetails, ViewNetPermissionsModalProps } from './types'
import type { PermissionAction } from '../../../types/permissions'

export function ViewNetPermissionsModal({
  user,
  vaultAccessCount,
  orgVaults,
  teams,
  onClose
}: ViewNetPermissionsModalProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [permissions, setPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSourceFilesVaultId, setSelectedSourceFilesVaultId] = useState<string | null>(null)
  const [userVaultIds, setUserVaultIds] = useState<string[]>([])
  const [sourceFilesPermsByVault, setSourceFilesPermsByVault] = useState<Record<string, Record<string, PermissionAction[]>>>({})
  
  const isUserAdmin = user.role === 'admin'
  const hasFullVaultAccess = vaultAccessCount === 0 || isUserAdmin
  
  // Get the list of vaults user has access to
  const accessibleVaults = useMemo(() => {
    if (hasFullVaultAccess) return orgVaults
    return orgVaults.filter(v => userVaultIds.includes(v.id))
  }, [hasFullVaultAccess, orgVaults, userVaultIds])
  
  // Source files resources
  const sourceFilesResources = ['module:explorer', 'module:pending', 'module:history', 'module:workflows', 'module:trash']
  
  // Load user's vault access via their teams
  useEffect(() => {
    const loadVaultAccess = async () => {
      const userTeamIds = (user.teams || []).map(t => t.id)
      if (userTeamIds.length === 0) {
        setUserVaultIds([])
        return
      }
      
      const { data } = await supabase
        .from('team_vault_access')
        .select('vault_id')
        .in('team_id', userTeamIds)
      
      const vaultIds = [...new Set((data || []).map(d => d.vault_id))]
      setUserVaultIds(vaultIds)
    }
    
    loadVaultAccess()
  }, [user.teams])
  
  // Load user's effective permissions from their teams
  useEffect(() => {
    const loadPermissions = async () => {
      setIsLoading(true)
      try {
        const userTeamIds = (user.teams || []).map(t => t.id)
        
        if (userTeamIds.length === 0) {
          setPermissions({})
          setSourceFilesPermsByVault({})
          setIsLoading(false)
          return
        }
        
        // Get all permissions from user's teams (for non-source-files resources)
        const { data, error } = await supabase
          .from('team_permissions')
          .select('resource, actions')
          .in('team_id', userTeamIds)
        
        if (error) throw error
        
        // Merge permissions - union of all actions for each resource
        const mergedPerms: Record<string, Set<PermissionAction>> = {}
        for (const perm of data || []) {
          if (!mergedPerms[perm.resource]) {
            mergedPerms[perm.resource] = new Set()
          }
          for (const action of (perm.actions as PermissionAction[])) {
            mergedPerms[perm.resource].add(action)
          }
        }
        
        // Convert sets to arrays
        const finalPerms: Record<string, PermissionAction[]> = {}
        for (const [resource, actions] of Object.entries(mergedPerms)) {
          finalPerms[resource] = Array.from(actions)
        }
        
        setPermissions(finalPerms)
        
        // Now load source files permissions per vault
        const vaultPerms: Record<string, Record<string, PermissionAction[]>> = {}
        
        // Get team vault access mapping
        const { data: teamVaultData } = await supabase
          .from('team_vault_access')
          .select('team_id, vault_id')
          .in('team_id', userTeamIds)
        
        const teamsByVault: Record<string, string[]> = {}
        const teamsWithRestrictions = new Set<string>()
        
        for (const tv of teamVaultData || []) {
          teamsWithRestrictions.add(tv.team_id)
          if (!teamsByVault[tv.vault_id]) {
            teamsByVault[tv.vault_id] = []
          }
          teamsByVault[tv.vault_id].push(tv.team_id)
        }
        
        // Teams with no vault restrictions have access to all vaults
        const unrestrictedTeams = userTeamIds.filter(id => !teamsWithRestrictions.has(id))
        
        // For each vault, calculate source file permissions
        for (const vault of orgVaults) {
          const teamsForVault = [...(teamsByVault[vault.id] || []), ...unrestrictedTeams]
          
          if (teamsForVault.length === 0) continue
          
          // Get permissions specifically from teams with vault access
          const { data: vaultTeamPerms } = await supabase
            .from('team_permissions')
            .select('resource, actions')
            .in('team_id', teamsForVault)
          
          const vaultPermsObj: Record<string, PermissionAction[]> = {}
          for (const perm of vaultTeamPerms || []) {
            if (sourceFilesResources.includes(perm.resource)) {
              if (!vaultPermsObj[perm.resource]) {
                vaultPermsObj[perm.resource] = []
              }
              for (const action of (perm.actions as PermissionAction[])) {
                if (!vaultPermsObj[perm.resource].includes(action)) {
                  vaultPermsObj[perm.resource].push(action)
                }
              }
            }
          }
          
          vaultPerms[vault.id] = vaultPermsObj
        }
        
        setSourceFilesPermsByVault(vaultPerms)
      } catch (err) {
        console.error('Failed to load permissions:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadPermissions()
  }, [user.teams, orgVaults])
  
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }
  
  const expandAll = () => {
    setExpandedGroups(new Set(PERMISSION_RESOURCE_GROUPS.map(g => g.id)))
  }
  
  const collapseAll = () => {
    setExpandedGroups(new Set())
  }
  
  // Count permissions in a group
  const getGroupStats = (groupId: string) => {
    const group = PERMISSION_RESOURCE_GROUPS.find(g => g.id === groupId)
    if (!group) return { total: 0, withPerms: 0 }
    
    let withPerms = 0
    for (const resourceId of group.resources) {
      if ((permissions[resourceId] || []).length > 0) {
        withPerms++
      }
    }
    return { total: group.resources.length, withPerms }
  }
  
  // Filter resources by search
  const filterResources = (resources: string[]): string[] => {
    if (!searchQuery) return resources
    return resources.filter(resourceId => {
      const resource = ALL_RESOURCES.find(r => r.id === resourceId)
      if (!resource) return false
      return (
        resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center overflow-hidden" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-5xl h-[90vh] mx-4 flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-4 flex-shrink-0">
          {getEffectiveAvatarUrl(user) ? (
            <img 
              src={getEffectiveAvatarUrl(user) || ''} 
              alt={user.full_name || user.email}
              className="w-12 h-12 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-lg font-medium text-plm-fg">
              {(user.full_name || user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-plm-fg flex items-center gap-2">
              {user.full_name || user.email}
              <span className="text-sm font-normal text-plm-fg-muted">— Net Permissions</span>
            </h2>
            <p className="text-sm text-plm-fg-muted">{user.email}</p>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Overview row */}
        <div className="p-4 border-b border-plm-border bg-plm-bg/50 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            {/* Admin badge (if admin) */}
            {isUserAdmin && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-plm-accent/10">
                <Shield size={16} className="text-plm-accent" />
                <span className="text-sm font-medium text-plm-accent">Admin</span>
              </div>
            )}
            
            {/* Teams */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-plm-fg-muted mr-1">Teams:</span>
              {(user.teams || []).length > 0 ? (
                <>
                  {(user.teams || []).map(team => {
                    const TeamIcon = (LucideIcons as any)[team.icon] || UsersRound
                    return (
                      <div
                        key={team.id}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: `${team.color}15`, color: team.color }}
                        title={team.name}
                      >
                        <TeamIcon size={12} />
                        {team.name}
                      </div>
                    )
                  })}
                </>
              ) : (
                <span className="text-xs text-plm-fg-muted flex items-center gap-1">
                  <UserX size={12} />
                  None
                </span>
              )}
            </div>
            
            {/* Workflow roles */}
            {(user.workflow_roles || []).length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-plm-fg-muted mr-1">Roles:</span>
                {(user.workflow_roles || []).map(wfRole => {
                  const WfRoleIcon = (LucideIcons as any)[wfRole.icon] || Shield
                  return (
                    <div
                      key={wfRole.id}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ backgroundColor: `${wfRole.color}15`, color: wfRole.color }}
                    >
                      <WfRoleIcon size={12} />
                      {wfRole.name}
                    </div>
                  )
                })}
              </div>
            )}
            
            {/* Vault access summary */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-plm-fg-muted mr-1">Vaults:</span>
              <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                hasFullVaultAccess ? 'bg-plm-success/10 text-plm-success' : 'bg-plm-accent/10 text-plm-accent'
              }`}>
                <Database size={12} />
                {hasFullVaultAccess ? `All ${orgVaults.length}` : `${accessibleVaults.length} of ${orgVaults.length}`}
              </div>
            </div>
          </div>
        </div>
        
        {/* Toolbar */}
        <div className="p-3 border-b border-plm-border flex items-center gap-3 flex-shrink-0 bg-plm-bg/30">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search resources..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              className="px-2 py-1 text-xs text-plm-fg-muted hover:text-plm-fg rounded hover:bg-plm-highlight transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-2 py-1 text-xs text-plm-fg-muted hover:text-plm-fg rounded hover:bg-plm-highlight transition-colors"
            >
              Collapse All
            </button>
          </div>
          
          {/* Legend */}
          <div className="flex items-center gap-4 ml-auto text-xs text-plm-fg-muted">
            {PERMISSION_ACTIONS.map(action => (
              <div key={action} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${
                  action === 'view' ? 'bg-blue-400' :
                  action === 'create' ? 'bg-green-400' :
                  action === 'edit' ? 'bg-yellow-400' :
                  action === 'delete' ? 'bg-red-400' :
                  'bg-purple-400'
                }`} />
                {PERMISSION_ACTION_LABELS[action]}
              </div>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
            </div>
          ) : isUserAdmin ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-plm-accent/20 mb-4">
                <Shield size={32} className="text-plm-accent" />
              </div>
              <h3 className="text-lg font-medium text-plm-fg mb-2">Full Admin Access</h3>
              <p className="text-sm text-plm-fg-muted max-w-md mx-auto">
                As an Admin, this user has full access to all resources and actions across the entire system.
                Team permissions do not restrict admin users.
              </p>
            </div>
          ) : (user.teams || []).length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yellow-500/20 mb-4">
                <UserX size={32} className="text-yellow-500" />
              </div>
              <h3 className="text-lg font-medium text-plm-fg mb-2">No Team Assignments</h3>
              <p className="text-sm text-plm-fg-muted max-w-md mx-auto">
                This user is not assigned to any teams and has no team-based permissions.
                Add them to a team to grant permissions.
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {PERMISSION_RESOURCE_GROUPS.map(group => {
                const filteredResourceIds = filterResources(group.resources)
                if (filteredResourceIds.length === 0) return null
                
                const isExpanded = expandedGroups.has(group.id)
                const stats = getGroupStats(group.id)
                const GroupIcon = (LucideIcons as any)[group.icon] || Settings2
                
                return (
                  <div key={group.id} className="border border-plm-border rounded-xl overflow-hidden bg-plm-bg/30">
                    {/* Group header */}
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-plm-highlight/50 transition-colors text-left"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
                        style={{ backgroundColor: `${group.color}15`, color: group.color }}
                      >
                        <GroupIcon size={16} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-plm-fg">{group.name}</div>
                        <div className="text-xs text-plm-fg-muted">
                          {group.id === 'source-files' 
                            ? `${accessibleVaults.length} vault${accessibleVaults.length !== 1 ? 's' : ''} accessible`
                            : `${stats.withPerms} of ${stats.total} resources with permissions`
                          }
                        </div>
                      </div>
                      
                      {isExpanded ? (
                        <ChevronDown size={18} className="text-plm-fg-muted flex-shrink-0" />
                      ) : (
                        <ChevronRight size={18} className="text-plm-fg-muted flex-shrink-0" />
                      )}
                    </button>
                    
                    {/* Group resources */}
                    {isExpanded && (
                      <div className="border-t border-plm-border">
                        {/* Vault tabs for source-files group */}
                        {group.id === 'source-files' && accessibleVaults.length > 0 && (
                          <div className="px-4 py-2 border-b border-plm-border bg-plm-bg/50 flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-plm-fg-muted mr-1">Vault:</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedSourceFilesVaultId(null) }}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                                selectedSourceFilesVaultId === null
                                  ? 'bg-plm-accent text-white'
                                  : 'bg-plm-bg-light text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight border border-plm-border'
                              }`}
                            >
                              <Database size={11} />
                              All
                            </button>
                            {accessibleVaults.map(vault => (
                              <button
                                key={vault.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedSourceFilesVaultId(vault.id) }}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                                  selectedSourceFilesVaultId === vault.id
                                    ? 'bg-plm-accent text-white'
                                    : 'bg-plm-bg-light text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight border border-plm-border'
                                }`}
                              >
                                <Folder size={11} />
                                {vault.name}
                              </button>
                            ))}
                            {!hasFullVaultAccess && accessibleVaults.length < orgVaults.length && (
                              <span className="text-xs text-plm-fg-dim ml-1">
                                ({orgVaults.length - accessibleVaults.length} restricted)
                              </span>
                            )}
                          </div>
                        )}
                        
                        {filteredResourceIds.map((resourceId, idx) => {
                          const resource = ALL_RESOURCES.find(r => r.id === resourceId)
                          if (!resource) return null
                          
                          const ResourceIcon = (LucideIcons as any)[resource.icon] || Shield
                          
                          // For source-files, use vault-specific permissions
                          let currentActions: PermissionAction[] = []
                          if (group.id === 'source-files') {
                            if (selectedSourceFilesVaultId) {
                              currentActions = sourceFilesPermsByVault[selectedSourceFilesVaultId]?.[resourceId] || []
                            } else {
                              // "All" - merge permissions from all accessible vaults
                              const mergedActions = new Set<PermissionAction>()
                              for (const vault of accessibleVaults) {
                                const vaultPerms = sourceFilesPermsByVault[vault.id]?.[resourceId] || []
                                vaultPerms.forEach(a => mergedActions.add(a))
                              }
                              currentActions = Array.from(mergedActions)
                            }
                          } else {
                            currentActions = permissions[resourceId] || []
                          }
                          
                          return (
                            <div
                              key={resourceId}
                              className={`flex items-center gap-3 px-4 py-2.5 ${
                                idx !== filteredResourceIds.length - 1 ? 'border-b border-plm-border/20' : ''
                              }`}
                            >
                              {/* Resource icon */}
                              <div className="w-8 h-8 rounded-lg bg-plm-bg-secondary flex items-center justify-center text-plm-fg-muted">
                                <ResourceIcon size={16} />
                              </div>
                              
                              {/* Resource info */}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-plm-fg font-medium truncate">
                                  {resource.name}
                                </div>
                                <div className="text-xs text-plm-fg-muted truncate">
                                  {resource.description}
                                </div>
                              </div>
                              
                              {/* Permission indicators */}
                              <div className="flex items-center gap-1">
                                {PERMISSION_ACTIONS.map(action => {
                                  const isApplicable = resource.applicableActions.includes(action)
                                  const isGranted = currentActions.includes(action)
                                  
                                  if (!isApplicable) {
                                    return (
                                      <div
                                        key={action}
                                        className="w-8 h-8 rounded-lg flex items-center justify-center opacity-20"
                                        title={`${PERMISSION_ACTION_LABELS[action]} not applicable`}
                                      >
                                        <Minus size={12} className="text-plm-fg-dim" />
                                      </div>
                                    )
                                  }
                                  
                                  const colorClass = isGranted ? (
                                    action === 'view' ? 'bg-blue-500/35 text-blue-300 border-blue-400/70' :
                                    action === 'create' ? 'bg-green-500/35 text-green-300 border-green-400/70' :
                                    action === 'edit' ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70' :
                                    action === 'delete' ? 'bg-red-500/35 text-red-300 border-red-400/70' :
                                    'bg-purple-500/35 text-purple-300 border-purple-400/70'
                                  ) : (
                                    action === 'view' ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40' :
                                    action === 'create' ? 'border-green-500/20 bg-green-500/5 text-green-400/40' :
                                    action === 'edit' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40' :
                                    action === 'delete' ? 'border-red-500/20 bg-red-500/5 text-red-400/40' :
                                    'border-purple-500/20 bg-purple-500/5 text-purple-400/40'
                                  )
                                  
                                  return (
                                    <div
                                      key={action}
                                      className={`w-8 h-8 rounded-lg flex items-center justify-center border ${colorClass}`}
                                      title={`${PERMISSION_ACTION_LABELS[action]}: ${isGranted ? 'Granted' : 'Not granted'}`}
                                    >
                                      {isGranted ? (
                                        <Check size={12} />
                                      ) : (
                                        <span className="text-[10px] font-medium">{action.charAt(0).toUpperCase()}</span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex items-center justify-between bg-plm-bg/50 flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-plm-fg-muted">
            <div className="flex items-center gap-1.5">
              <Shield size={14} />
              <span>
                {Object.entries(permissions).filter(([_, a]) => a.length > 0).length} resources with permissions
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users size={14} />
              <span>
                Via {(user.teams || []).length} team{(user.teams || []).length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          
          <button onClick={onClose} className="btn btn-ghost">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
