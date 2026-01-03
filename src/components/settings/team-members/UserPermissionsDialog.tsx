// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  Shield,
  X,
  Loader2,
  Search,
  Database,
  Check,
  Minus
} from 'lucide-react'
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  ALL_RESOURCES
} from '../../../types/permissions'
import { usePDMStore } from '../../../stores/pdmStore'
import { supabase } from '../../../lib/supabase'
import type { OrgUser, Vault } from './types'
import type { PermissionAction } from '../../../types/permissions'

interface UserPermissionsDialogProps {
  user: OrgUser
  onClose: () => void
  currentUserId?: string
}

export function UserPermissionsDialog({
  user,
  onClose,
  currentUserId
}: UserPermissionsDialogProps) {
  const { addToast, organization } = usePDMStore()
  const [permissions, setPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [originalPermissions, setOriginalPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Vault scope state
  const [vaults, setVaults] = useState<Vault[]>([])
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null) // null = "All Vaults"
  const [vaultsLoading, setVaultsLoading] = useState(true)
  
  // Load vaults for this org
  useEffect(() => {
    const loadVaults = async () => {
      if (!organization?.id) {
        setVaultsLoading(false)
        return
      }
      try {
        const { data, error } = await supabase
          .from('vaults')
          .select('id, name, slug')
          .eq('org_id', organization.id)
          .order('name')
        
        if (error) throw error
        setVaults(data || [])
      } catch (err) {
        console.error('Failed to load vaults:', err)
      } finally {
        setVaultsLoading(false)
      }
    }
    loadVaults()
  }, [organization?.id])
  
  useEffect(() => {
    loadPermissions()
  }, [user.id, selectedVaultId])
  
  const loadPermissions = async () => {
    setIsLoading(true)
    try {
      // Build query - filter by vault_id
      let query = supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', user.id)
      
      if (selectedVaultId === null) {
        // "All Vaults" - only load global permissions
        query = query.is('vault_id', null)
      } else {
        // Specific vault
        query = query.eq('vault_id', selectedVaultId)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      const permsMap: Record<string, PermissionAction[]> = {}
      for (const perm of data || []) {
        permsMap[perm.resource] = perm.actions as PermissionAction[]
      }
      
      setPermissions(permsMap)
      setOriginalPermissions(permsMap)
    } catch (err) {
      console.error('Failed to load user permissions:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const savePermissions = async () => {
    if (!currentUserId) return
    
    setIsSaving(true)
    try {
      // Delete existing permissions for this vault scope
      let deleteQuery = supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', user.id)
      
      if (selectedVaultId === null) {
        deleteQuery = deleteQuery.is('vault_id', null)
      } else {
        deleteQuery = deleteQuery.eq('vault_id', selectedVaultId)
      }
      
      await deleteQuery
      
      // Insert new permissions
      const newPerms = Object.entries(permissions)
        .filter(([_, actions]) => actions.length > 0)
        .map(([resource, actions]) => ({
          user_id: user.id,
          resource,
          vault_id: selectedVaultId,
          actions,
          granted_by: currentUserId
        }))
      
      if (newPerms.length > 0) {
        const { error } = await supabase.from('user_permissions').insert(newPerms)
        if (error) throw error
      }
      
      const vaultName = selectedVaultId 
        ? vaults.find(v => v.id === selectedVaultId)?.name || 'selected vault'
        : 'all vaults'
      addToast('success', `Permissions saved for ${user.full_name || user.email} on ${vaultName}`)
      onClose()
    } catch (err) {
      console.error('Failed to save permissions:', err)
      addToast('error', 'Failed to save permissions')
    } finally {
      setIsSaving(false)
    }
  }
  
  const toggleAction = (resourceId: string, action: PermissionAction) => {
    setPermissions(prev => {
      const current = prev[resourceId] || []
      if (current.includes(action)) {
        return { ...prev, [resourceId]: current.filter(a => a !== action) }
      } else {
        return { ...prev, [resourceId]: [...current, action] }
      }
    })
  }
  
  const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions)
  const permissionCount = Object.entries(permissions).filter(([_, a]) => a.length > 0).length
  
  // Filter resources by search
  const filteredResources = searchQuery
    ? ALL_RESOURCES.filter(r => 
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : ALL_RESOURCES
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center overflow-hidden" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-4xl h-[85vh] mx-4 flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-4 flex-shrink-0">
          <div className="p-2.5 rounded-lg bg-purple-500/20 text-purple-400">
            <Shield size={22} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-plm-fg flex items-center gap-2">
              Individual Permissions
              <span className="text-sm font-normal text-plm-fg-muted">— {user.full_name || user.email}</span>
            </h2>
            <p className="text-sm text-plm-fg-muted">
              These permissions are added to any team permissions (union of all)
            </p>
          </div>
          
          {/* Vault scope selector */}
          <div className="flex items-center gap-2">
            <Database size={16} className="text-plm-fg-muted" />
            <select
              value={selectedVaultId || 'all'}
              onChange={(e) => {
                const value = e.target.value
                setSelectedVaultId(value === 'all' ? null : value)
              }}
              disabled={vaultsLoading}
              className="px-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg focus:outline-none focus:border-plm-accent min-w-[160px]"
            >
              <option value="all">All Vaults (Global)</option>
              {vaults.map(vault => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
          </div>
          
          <button onClick={onClose} className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg">
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-3 border-b border-plm-border flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search resources..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-plm-bg-light">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-plm-fg-muted" size={32} />
            </div>
          ) : (
            <div className="space-y-0">
              {filteredResources.map(resource => {
                const ResourceIcon = (LucideIcons as any)[resource.icon] || Shield
                const currentActions = permissions[resource.id] || []
                
                return (
                  <div
                    key={resource.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-plm-highlight/30 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-plm-bg-secondary flex items-center justify-center text-plm-fg-muted flex-shrink-0">
                      <ResourceIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-plm-fg font-medium truncate">{resource.name}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{resource.description}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {PERMISSION_ACTIONS.map(action => {
                        const isApplicable = resource.applicableActions.includes(action)
                        const isGranted = currentActions.includes(action)
                        
                        if (!isApplicable) {
                          return (
                            <div key={action} className="w-8 h-8 rounded-lg flex items-center justify-center opacity-20">
                              <Minus size={12} className="text-plm-fg-dim" />
                            </div>
                          )
                        }
                        
                        const colorClass = 
                          action === 'view' ? 'bg-blue-500/35 text-blue-300 border-blue-400/70' :
                          action === 'create' ? 'bg-green-500/35 text-green-300 border-green-400/70' :
                          action === 'edit' ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70' :
                          action === 'delete' ? 'bg-red-500/35 text-red-300 border-red-400/70' :
                          'bg-purple-500/35 text-purple-300 border-purple-400/70'
                        
                        const uncheckedClass = 
                          action === 'view' ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15' :
                          action === 'create' ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15' :
                          action === 'edit' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15' :
                          action === 'delete' ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15' :
                          'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15'
                        
                        return (
                          <button
                            key={action}
                            onClick={() => toggleAction(resource.id, action)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
                              isGranted ? colorClass : uncheckedClass
                            }`}
                            title={`${isGranted ? 'Revoke' : 'Grant'} ${PERMISSION_ACTION_LABELS[action]}`}
                          >
                            {isGranted ? (
                              <Check size={12} />
                            ) : (
                              <span className="text-[9px] font-medium">{action.charAt(0).toUpperCase()}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex items-center justify-between bg-plm-bg/50 flex-shrink-0">
          <div className="text-sm text-plm-fg-muted">
            {permissionCount} resource{permissionCount !== 1 ? 's' : ''} with permissions
            {hasChanges && <span className="ml-2 text-plm-warning">• Unsaved changes</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button
              onClick={savePermissions}
              disabled={isSaving || !hasChanges}
              className={`btn flex items-center gap-2 ${hasChanges ? 'btn-primary' : 'btn-ghost opacity-50'}`}
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
              Save Permissions
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
