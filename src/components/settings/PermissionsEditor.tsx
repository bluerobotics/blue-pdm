// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect, useMemo, useCallback } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  X,
  Shield,
  Check,
  Minus,
  Loader2,
  Search,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Save,
  RotateCcw,
  Filter,
  Eye,
  Plus,
  Edit,
  Trash2,
  Users,
  Settings,
  Database,
  LayoutGrid,
  Wand2,
  Copy,
  AlertTriangle
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import type { Team, TeamPermission, PermissionPreset, PermissionAction, ResourceDefinition, ResourceCategory } from '../../types/permissions'
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  MODULE_RESOURCES,
  SYSTEM_RESOURCES,
  ALL_RESOURCES,
  RESOURCE_CATEGORIES,
  getResourcesByCategory,
  DEFAULT_PRESETS,
  hasPermission
} from '../../types/permissions'

interface PermissionsEditorProps {
  team: Team
  onClose: () => void
  userId?: string
  isAdmin: boolean
}

// Group resources by a custom category for better UX
const RESOURCE_GROUPS: { id: string; name: string; icon: string; color: string; resources: string[] }[] = [
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

export function PermissionsEditor({ team, onClose, userId, isAdmin }: PermissionsEditorProps) {
  const { addToast } = usePDMStore()
  
  // State
  const [permissions, setPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [originalPermissions, setOriginalPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(RESOURCE_GROUPS.map(g => g.id)))
  const [showPresets, setShowPresets] = useState(false)
  const [presets, setPresets] = useState<PermissionPreset[]>([])
  
  // Load permissions
  useEffect(() => {
    loadPermissions()
    loadPresets()
  }, [team.id])
  
  // Track changes
  useEffect(() => {
    const changed = JSON.stringify(permissions) !== JSON.stringify(originalPermissions)
    setHasChanges(changed)
  }, [permissions, originalPermissions])
  
  const loadPermissions = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('team_permissions')
        .select('*')
        .eq('team_id', team.id)
      
      if (error) throw error
      
      const permsMap: Record<string, PermissionAction[]> = {}
      for (const perm of data || []) {
        permsMap[perm.resource] = perm.actions as PermissionAction[]
      }
      
      setPermissions(permsMap)
      setOriginalPermissions(permsMap)
    } catch (err) {
      console.error('Failed to load permissions:', err)
      addToast('error', 'Failed to load permissions')
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadPresets = async () => {
    try {
      const { data: orgData } = await supabase
        .from('teams')
        .select('org_id')
        .eq('id', team.id)
        .single()
      
      if (!orgData) return
      
      const { data, error } = await supabase
        .from('permission_presets')
        .select('*')
        .eq('org_id', orgData.org_id)
        .order('name')
      
      if (error) throw error
      setPresets(data || [])
    } catch (err) {
      console.error('Failed to load presets:', err)
    }
  }
  
  const savePermissions = async () => {
    if (!userId) return
    
    setIsSaving(true)
    try {
      // Delete existing permissions
      await supabase
        .from('team_permissions')
        .delete()
        .eq('team_id', team.id)
      
      // Insert new permissions (only those with at least one action)
      const newPerms = Object.entries(permissions)
        .filter(([_, actions]) => actions.length > 0)
        .map(([resource, actions]) => ({
          team_id: team.id,
          resource,
          actions,
          granted_by: userId
        }))
      
      if (newPerms.length > 0) {
        const { error } = await supabase
          .from('team_permissions')
          .insert(newPerms)
        
        if (error) throw error
      }
      
      setOriginalPermissions({ ...permissions })
      setHasChanges(false)
      addToast('success', 'Permissions saved successfully')
    } catch (err) {
      console.error('Failed to save permissions:', err)
      addToast('error', 'Failed to save permissions')
    } finally {
      setIsSaving(false)
    }
  }
  
  const toggleAction = (resourceId: string, action: PermissionAction) => {
    if (!isAdmin) return
    
    setPermissions(prev => {
      const current = prev[resourceId] || []
      if (current.includes(action)) {
        return { ...prev, [resourceId]: current.filter(a => a !== action) }
      } else {
        return { ...prev, [resourceId]: [...current, action] }
      }
    })
  }
  
  const toggleAllInGroup = (groupId: string, action: PermissionAction) => {
    if (!isAdmin) return
    
    const group = RESOURCE_GROUPS.find(g => g.id === groupId)
    if (!group) return
    
    // Check if all resources in group have this action
    const allHave = group.resources.every(r => (permissions[r] || []).includes(action))
    
    setPermissions(prev => {
      const updated = { ...prev }
      for (const resourceId of group.resources) {
        const current = updated[resourceId] || []
        if (allHave) {
          // Remove from all
          updated[resourceId] = current.filter(a => a !== action)
        } else {
          // Add to all
          if (!current.includes(action)) {
            updated[resourceId] = [...current, action]
          }
        }
      }
      return updated
    })
  }
  
  const setAllActions = (resourceId: string, actions: PermissionAction[]) => {
    if (!isAdmin) return
    setPermissions(prev => ({ ...prev, [resourceId]: actions }))
  }
  
  const applyPreset = (preset: PermissionPreset) => {
    if (!isAdmin) return
    setPermissions(preset.permissions)
    setShowPresets(false)
    addToast('success', `Applied "${preset.name}" preset`)
  }
  
  const resetToOriginal = () => {
    setPermissions({ ...originalPermissions })
  }
  
  const clearAll = () => {
    if (!isAdmin) return
    setPermissions({})
  }
  
  const grantAll = () => {
    if (!isAdmin) return
    const allPerms: Record<string, PermissionAction[]> = {}
    for (const resource of ALL_RESOURCES) {
      allPerms[resource.id] = [...resource.applicableActions]
    }
    setPermissions(allPerms)
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
  
  // Count permissions in a group
  const getGroupStats = (groupId: string) => {
    const group = RESOURCE_GROUPS.find(g => g.id === groupId)
    if (!group) return { total: 0, withPerms: 0 }
    
    let withPerms = 0
    for (const resourceId of group.resources) {
      if ((permissions[resourceId] || []).length > 0) {
        withPerms++
      }
    }
    return { total: group.resources.length, withPerms }
  }
  
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
  
  const IconComponent = (LucideIcons as any)[team.icon] || Users
  
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center overflow-hidden" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-6xl h-[90vh] mx-4 flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-4 flex-shrink-0">
          <div
            className="p-2.5 rounded-lg"
            style={{ backgroundColor: `${team.color}20`, color: team.color }}
          >
            <IconComponent size={22} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-plm-fg flex items-center gap-2">
              {team.name}
              <span className="text-sm font-normal text-plm-fg-muted">— Permissions</span>
            </h2>
            <p className="text-sm text-plm-fg-muted">
              Configure what this team can access and do
            </p>
          </div>
          
          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                onClick={resetToOriginal}
                className="btn btn-ghost btn-sm flex items-center gap-1.5"
                title="Reset changes"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            )}
            
            {isAdmin && (
              <button
                onClick={() => setShowPresets(!showPresets)}
                className="btn btn-ghost btn-sm flex items-center gap-1.5"
              >
                <Wand2 size={14} />
                Presets
              </button>
            )}
            
            <button
              onClick={savePermissions}
              disabled={!hasChanges || isSaving || !isAdmin}
              className={`btn btn-sm flex items-center gap-1.5 ${
                hasChanges ? 'btn-primary' : 'btn-ghost opacity-50'
              }`}
            >
              {isSaving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save
            </button>
            
            <button
              onClick={onClose}
              className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        
        {/* Presets dropdown */}
        {showPresets && isAdmin && (
          <div className="border-b border-plm-border p-4 bg-gradient-to-r from-plm-accent/5 to-transparent">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-medium text-plm-fg">
                <Sparkles size={16} className="text-plm-accent" />
                Quick Apply Preset
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearAll}
                  className="text-xs text-plm-fg-muted hover:text-plm-fg px-2 py-1 rounded hover:bg-plm-highlight"
                >
                  Clear All
                </button>
                <button
                  onClick={grantAll}
                  className="text-xs text-plm-accent hover:text-plm-accent/80 px-2 py-1 rounded hover:bg-plm-accent/10"
                >
                  Grant All
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_PRESETS.map(preset => {
                const PresetIcon = (LucideIcons as any)[preset.icon] || Shield
                return (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset as PermissionPreset)}
                    className="flex items-center gap-2 px-3 py-2 bg-plm-bg border border-plm-border rounded-lg hover:border-plm-accent/50 hover:bg-plm-highlight transition-all group"
                  >
                    <div
                      className="p-1 rounded"
                      style={{ backgroundColor: `${preset.color}20`, color: preset.color }}
                    >
                      <PresetIcon size={14} />
                    </div>
                    <span className="text-sm text-plm-fg">{preset.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Toolbar */}
        <div className="p-3 border-b border-plm-border flex items-center gap-3 flex-shrink-0 bg-plm-bg/50">
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
          
          {/* Action legend */}
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
          ) : (
            <div className="p-4 space-y-2">
              {RESOURCE_GROUPS.map(group => {
                const filteredResources = filterResources(group.resources)
                if (filteredResources.length === 0) return null
                
                const isExpanded = expandedGroups.has(group.id)
                const stats = getGroupStats(group.id)
                const GroupIcon = (LucideIcons as any)[group.icon] || LayoutGrid
                
                return (
                  <div key={group.id} className="border border-plm-border rounded-xl overflow-hidden bg-plm-bg/30">
                    {/* Group header */}
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-plm-highlight/50 transition-colors">
                      {/* Icon - same width as child icons */}
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
                        style={{ backgroundColor: `${group.color}15`, color: group.color }}
                      >
                        <GroupIcon size={16} />
                      </button>
                      
                      {/* Text content - flex-1 like children */}
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="flex-1 min-w-0 text-left flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-plm-fg">{group.name}</div>
                          <div className="text-xs text-plm-fg-muted">
                            {stats.withPerms} of {stats.total} resources configured
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronDown size={18} className="text-plm-fg-muted flex-shrink-0" />
                        ) : (
                          <ChevronRight size={18} className="text-plm-fg-muted flex-shrink-0" />
                        )}
                      </button>
                      
                      {/* Group-level quick toggles - aligned with child checkboxes */}
                      {isAdmin && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {PERMISSION_ACTIONS.map(action => {
                            const allHave = group.resources.every(r => (permissions[r] || []).includes(action))
                            const someHave = group.resources.some(r => (permissions[r] || []).includes(action))
                            
                            // Match the styling from child buttons
                            const checkedClass = 
                              action === 'view' ? 'bg-blue-500/35 text-blue-300 border-blue-400/70' :
                              action === 'create' ? 'bg-green-500/35 text-green-300 border-green-400/70' :
                              action === 'edit' ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70' :
                              action === 'delete' ? 'bg-red-500/35 text-red-300 border-red-400/70' :
                              'bg-purple-500/35 text-purple-300 border-purple-400/70'
                            
                            const partialClass = 
                              action === 'view' ? 'bg-blue-500/15 text-blue-400/60 border-blue-400/40' :
                              action === 'create' ? 'bg-green-500/15 text-green-400/60 border-green-400/40' :
                              action === 'edit' ? 'bg-yellow-500/15 text-yellow-400/60 border-yellow-400/40' :
                              action === 'delete' ? 'bg-red-500/15 text-red-400/60 border-red-400/40' :
                              'bg-purple-500/15 text-purple-400/60 border-purple-400/40'
                            
                            const uncheckedClass = 
                              action === 'view' ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15' :
                              action === 'create' ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15' :
                              action === 'edit' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15' :
                              action === 'delete' ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15' :
                              'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15'
                            
                            return (
                              <button
                                key={action}
                                onClick={() => toggleAllInGroup(group.id, action)}
                                className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                                  allHave ? checkedClass : someHave ? partialClass : uncheckedClass
                                }`}
                                title={`Toggle ${PERMISSION_ACTION_LABELS[action]} for all in ${group.name}`}
                              >
                                {allHave ? <Check size={14} /> : someHave ? <Minus size={14} /> : <span className="text-[10px] font-medium">{action.charAt(0).toUpperCase()}</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    
                    {/* Group resources */}
                    {isExpanded && (
                      <div className="border-t border-plm-border">
                        {filteredResources.map((resourceId, idx) => {
                          const resource = ALL_RESOURCES.find(r => r.id === resourceId)
                          if (!resource) return null
                          
                          const ResourceIcon = (LucideIcons as any)[resource.icon] || Shield
                          const currentActions = permissions[resourceId] || []
                          
                          return (
                            <div
                              key={resourceId}
                              className={`flex items-center gap-3 px-4 py-2.5 hover:bg-plm-highlight/30 transition-colors ${
                                idx !== filteredResources.length - 1 ? 'border-b border-plm-border/50' : ''
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
                              
                              {/* Permission checkboxes */}
                              <div className="flex items-center gap-1">
                                {PERMISSION_ACTIONS.map(action => {
                                  const isApplicable = resource.applicableActions.includes(action)
                                  const isGranted = currentActions.includes(action)
                                  
                                  if (!isApplicable) {
                                    return (
                                      <div
                                        key={action}
                                        className="w-9 h-9 rounded-lg flex items-center justify-center opacity-20"
                                        title={`${PERMISSION_ACTION_LABELS[action]} not applicable`}
                                      >
                                        <Minus size={12} className="text-plm-fg-dim" />
                                      </div>
                                    )
                                  }
                                  
                                  // Brighter colors for checked state
                                  const colorClass = 
                                    action === 'view' ? 'bg-blue-500/35 text-blue-300 border-blue-400/70' :
                                    action === 'create' ? 'bg-green-500/35 text-green-300 border-green-400/70' :
                                    action === 'edit' ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70' :
                                    action === 'delete' ? 'bg-red-500/35 text-red-300 border-red-400/70' :
                                    'bg-purple-500/35 text-purple-300 border-purple-400/70'
                                  
                                  // Dimmer colors for unchecked state
                                  const uncheckedColorClass = 
                                    action === 'view' ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15 hover:text-blue-400/70' :
                                    action === 'create' ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15 hover:text-green-400/70' :
                                    action === 'edit' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15 hover:text-yellow-400/70' :
                                    action === 'delete' ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-400/70' :
                                    'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15 hover:text-purple-400/70'
                                  
                                  // Get the first letter of the action for unchecked display
                                  const actionLetter = action.charAt(0).toUpperCase()
                                  
                                  return (
                                    <button
                                      key={action}
                                      onClick={() => toggleAction(resourceId, action)}
                                      disabled={!isAdmin}
                                      className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                                        isGranted
                                          ? colorClass
                                          : uncheckedColorClass
                                      } ${!isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                                      title={`${isGranted ? 'Revoke' : 'Grant'} ${PERMISSION_ACTION_LABELS[action]}`}
                                    >
                                      {isGranted ? (
                                        <Check size={14} />
                                      ) : (
                                        <span className="text-[10px] font-medium">{actionLetter}</span>
                                      )}
                                    </button>
                                  )
                                })}
                                
                                {/* Quick actions */}
                                {isAdmin && (
                                  <div className="ml-2 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                                    <button
                                      onClick={() => setAllActions(resourceId, [])}
                                      className="p-1.5 text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight rounded transition-colors"
                                      title="Clear all"
                                    >
                                      <X size={12} />
                                    </button>
                                    <button
                                      onClick={() => setAllActions(resourceId, [...resource.applicableActions])}
                                      className="p-1.5 text-plm-fg-dim hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors"
                                      title="Grant all"
                                    >
                                      <Check size={12} />
                                    </button>
                                  </div>
                                )}
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
        
        {/* Footer with summary */}
        <div className="p-4 border-t border-plm-border flex items-center justify-between bg-plm-bg/50 flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-plm-fg-muted">
            <div className="flex items-center gap-1.5">
              <Shield size={14} />
              <span>
                {Object.entries(permissions).filter(([_, a]) => a.length > 0).length} resources with permissions
              </span>
            </div>
            {hasChanges && (
              <div className="flex items-center gap-1.5 text-plm-warning">
                <AlertTriangle size={14} />
                <span>Unsaved changes</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost">
              {hasChanges ? 'Cancel' : 'Close'}
            </button>
            {isAdmin && (
              <button
                onClick={savePermissions}
                disabled={!hasChanges || isSaving}
                className="btn btn-primary flex items-center gap-2"
              >
                {isSaving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                Save Permissions
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

