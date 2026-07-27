import { useState, useEffect } from 'react'
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
  Users,
  Database,
  LayoutGrid,
  Wand2,
  AlertTriangle,
  Folder,
} from 'lucide-react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'
import type { Team, PermissionPreset, PermissionAction } from '@/types/permissions'
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  ALL_RESOURCES,
  DEFAULT_PRESETS,
} from '@/types/permissions'

interface Vault {
  id: string
  name: string
  slug: string
}

interface PermissionsEditorProps {
  team: Team
  onClose: () => void
  userId?: string
  isAdmin: boolean
}

// Group resources by a custom category for better UX
const RESOURCE_GROUPS: {
  id: string
  name: string
  icon: string
  color: string
  resources: string[]
}[] = [
  {
    id: 'source-files',
    name: 'Source Files',
    icon: 'FolderTree',
    color: '#3b82f6',
    resources: [
      'module:explorer',
      'module:pending',
      'module:history',
      'module:workflows',
      'module:trash',
    ],
  },
  {
    id: 'items',
    name: 'Items & BOMs',
    icon: 'Package',
    color: '#8b5cf6',
    resources: ['module:items', 'system:item-designations', 'module:boms', 'module:products'],
  },
  {
    id: 'change-control',
    name: 'Change Control',
    icon: 'GitBranch',
    color: '#f59e0b',
    resources: [
      'module:ecr',
      'module:eco',
      'module:reviews',
      'module:deviations',
      'module:release-schedule',
      'module:process',
    ],
  },
  {
    id: 'supply-chain',
    name: 'Supply Chain',
    icon: 'Truck',
    color: '#14b8a6',
    resources: [
      'module:supplier-database',
      'module:supplier-portal',
      'module:purchase-requests',
      'module:purchase-orders',
      'module:invoices',
      'module:shipping',
      'module:receiving',
    ],
  },
  {
    id: 'production',
    name: 'Production',
    icon: 'Factory',
    color: '#ec4899',
    resources: [
      'module:manufacturing-orders',
      'module:travellers',
      'module:work-instructions',
      'module:production-schedule',
      'module:routings',
      'module:work-centers',
      'module:process-flows',
      'module:equipment',
      'module:yield-tracking',
      'module:error-codes',
      'module:downtime',
      'module:oee',
      'module:scrap-tracking',
    ],
  },
  {
    id: 'quality',
    name: 'Quality',
    icon: 'ShieldCheck',
    color: '#22c55e',
    resources: [
      'module:fai',
      'module:ncr',
      'module:imr',
      'module:scar',
      'module:capa',
      'module:rma',
      'module:certificates',
      'module:calibration',
      'module:quality-templates',
    ],
  },
  {
    id: 'accounting',
    name: 'Accounting',
    icon: 'Calculator',
    color: '#a855f7',
    resources: [
      'module:accounts-payable',
      'module:accounts-receivable',
      'module:general-ledger',
      'module:cost-tracking',
      'module:budgets',
    ],
  },
  {
    id: 'system',
    name: 'System & Admin',
    icon: 'Settings',
    color: '#64748b',
    resources: [
      'module:google-drive',
      'module:terminal',
      'module:settings',
      'system:users',
      'system:teams',
      'system:permissions',
      'system:org-settings',
      'system:vaults',
      'system:backups',
      'system:webhooks',
      'system:workflows',
      'system:metadata',
      'system:integrations',
      'system:recovery-codes',
      'system:impersonation',
    ],
  },
]

export function PermissionsEditor({ team, onClose, userId, isAdmin }: PermissionsEditorProps) {
  const { addToast } = usePDMStore()

  // State
  const [permissions, setPermissions] = useState<Record<string, PermissionAction[]>>({})
  const [originalPermissions, setOriginalPermissions] = useState<
    Record<string, PermissionAction[]>
  >({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(RESOURCE_GROUPS.map((g) => g.id)),
  )
  const [showPresets, setShowPresets] = useState(false)
  const [_presets, setPresets] = useState<PermissionPreset[]>([])

  // Vault scope state - only for source files
  const [vaults, setVaults] = useState<Vault[]>([])
  const [selectedSourceFilesVaultId, setSelectedSourceFilesVaultId] = useState<string | null>(null) // null = "All Vaults"
  const [sourceFilesPermsByVault, setSourceFilesPermsByVault] = useState<
    Record<string, Record<string, PermissionAction[]>>
  >({})
  const [originalSourceFilesPermsByVault, setOriginalSourceFilesPermsByVault] = useState<
    Record<string, Record<string, PermissionAction[]>>
  >({})
  const [_vaultsLoading, setVaultsLoading] = useState(true)

  // Source files resources
  const sourceFilesResources = [
    'module:explorer',
    'module:pending',
    'module:history',
    'module:workflows',
    'module:trash',
  ]

  // Load vaults for this org
  useEffect(() => {
    const loadVaults = async () => {
      try {
        const { data: orgData } = await supabase
          .from('teams')
          .select('org_id')
          .eq('id', team.id)
          .single()

        if (!orgData) return

        const { data, error } = await supabase
          .from('vaults')
          .select('id, name, slug')
          .eq('org_id', orgData.org_id)
          .order('name')

        if (error) throw error
        setVaults(data || [])
      } catch (error) {
        log.error('[PermissionsEditor]', 'Failed to load vaults', { error: error })
      } finally {
        setVaultsLoading(false)
      }
    }
    loadVaults()
  }, [team.id])

  // Load permissions when team changes
  useEffect(() => {
    loadPermissions()
    loadPresets()
  }, [team.id])

  // Track changes - check both global and source files permissions
  useEffect(() => {
    const globalChanged = JSON.stringify(permissions) !== JSON.stringify(originalPermissions)
    const sourceFilesChanged =
      JSON.stringify(sourceFilesPermsByVault) !== JSON.stringify(originalSourceFilesPermsByVault)
    setHasChanges(globalChanged || sourceFilesChanged)
  }, [permissions, originalPermissions, sourceFilesPermsByVault, originalSourceFilesPermsByVault])

  const loadPermissions = async () => {
    setIsLoading(true)
    try {
      // Load global permissions (vault_id IS NULL) for non-source-files resources
      const { data: globalData, error: globalError } = await supabase
        .from('team_permissions')
        .select('*')
        .eq('team_id', team.id)
        .is('vault_id', null)

      if (globalError) throw globalError

      const globalPermsMap: Record<string, PermissionAction[]> = {}
      for (const perm of globalData || []) {
        // Only include non-source-files resources in global permissions
        if (!sourceFilesResources.includes(perm.resource)) {
          globalPermsMap[perm.resource] = perm.actions as PermissionAction[]
        }
      }

      setPermissions(globalPermsMap)
      setOriginalPermissions(globalPermsMap)

      // Load source files permissions per vault
      const { data: vaultPermsData, error: vaultError } = await supabase
        .from('team_permissions')
        .select('*')
        .eq('team_id', team.id)
        .not('vault_id', 'is', null)

      if (vaultError) throw vaultError

      // Also load "All Vaults" source files permissions (vault_id IS NULL)
      const { data: allVaultsSourceFiles } = await supabase
        .from('team_permissions')
        .select('*')
        .eq('team_id', team.id)
        .is('vault_id', null)
        .in('resource', sourceFilesResources)

      const vaultPermsMap: Record<string, Record<string, PermissionAction[]>> = {}

      // Initialize "all" vaults entry
      vaultPermsMap['all'] = {}
      for (const perm of allVaultsSourceFiles || []) {
        if (sourceFilesResources.includes(perm.resource)) {
          vaultPermsMap['all'][perm.resource] = perm.actions as PermissionAction[]
        }
      }

      // Group by vault_id
      for (const perm of vaultPermsData || []) {
        if (sourceFilesResources.includes(perm.resource) && perm.vault_id) {
          if (!vaultPermsMap[perm.vault_id]) {
            vaultPermsMap[perm.vault_id] = {}
          }
          vaultPermsMap[perm.vault_id][perm.resource] = perm.actions as PermissionAction[]
        }
      }

      setSourceFilesPermsByVault(vaultPermsMap)
      setOriginalSourceFilesPermsByVault(JSON.parse(JSON.stringify(vaultPermsMap)))
    } catch (error) {
      log.error('[PermissionsEditor]', 'Failed to load permissions', { error: error })
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
      // Map Supabase types to app types with defaults
      setPresets(
        (data || []).map((p) => ({
          id: p.id,
          org_id: p.org_id,
          name: p.name,
          description: p.description ?? null,
          color: p.color ?? '#64748b',
          icon: p.icon ?? 'Shield',
          permissions: (p.permissions as Record<string, PermissionAction[]>) ?? {},
          is_system: p.is_system ?? false,
          created_at: p.created_at ?? new Date().toISOString(),
          created_by: p.created_by ?? null,
          updated_at: p.updated_at ?? new Date().toISOString(),
          updated_by: p.updated_by ?? null,
        })),
      )
    } catch (error) {
      log.error('[PermissionsEditor]', 'Failed to load presets', { error: error })
    }
  }

  const savePermissions = async () => {
    if (!userId) return

    setIsSaving(true)
    try {
      // Delete all existing permissions for this team
      await supabase.from('team_permissions').delete().eq('team_id', team.id)

      const allNewPerms: any[] = []

      // Add global permissions (non-source-files with vault_id = null)
      for (const [resource, actions] of Object.entries(permissions)) {
        if (actions.length > 0 && !sourceFilesResources.includes(resource)) {
          allNewPerms.push({
            team_id: team.id,
            resource,
            vault_id: null,
            actions,
            granted_by: userId,
          })
        }
      }

      // Add source files permissions per vault
      for (const [vaultKey, vaultPerms] of Object.entries(sourceFilesPermsByVault)) {
        const vaultId = vaultKey === 'all' ? null : vaultKey
        for (const [resource, actions] of Object.entries(vaultPerms)) {
          if (actions.length > 0 && sourceFilesResources.includes(resource)) {
            allNewPerms.push({
              team_id: team.id,
              resource,
              vault_id: vaultId,
              actions,
              granted_by: userId,
            })
          }
        }
      }

      if (allNewPerms.length > 0) {
        const { error } = await supabase.from('team_permissions').insert(allNewPerms)

        if (error) throw error
      }

      setOriginalPermissions({ ...permissions })
      setOriginalSourceFilesPermsByVault(JSON.parse(JSON.stringify(sourceFilesPermsByVault)))
      setHasChanges(false)
      addToast('success', 'Permissions saved')
    } catch (error) {
      log.error('[PermissionsEditor]', 'Failed to save permissions', { error: error })
      addToast('error', 'Failed to save permissions')
    } finally {
      setIsSaving(false)
    }
  }

  // Get the current vault key for source files
  const getSourceFilesVaultKey = () => selectedSourceFilesVaultId || 'all'

  // Get permissions for a resource (handles source files vs others)
  const getResourcePermissions = (resourceId: string): PermissionAction[] => {
    if (sourceFilesResources.includes(resourceId)) {
      const vaultKey = getSourceFilesVaultKey()
      return sourceFilesPermsByVault[vaultKey]?.[resourceId] || []
    }
    return permissions[resourceId] || []
  }

  const toggleAction = (resourceId: string, action: PermissionAction) => {
    if (!isAdmin) return

    if (sourceFilesResources.includes(resourceId)) {
      // Handle source files - update vault-specific permissions
      const vaultKey = getSourceFilesVaultKey()
      setSourceFilesPermsByVault((prev) => {
        const vaultPerms = prev[vaultKey] || {}
        const current = vaultPerms[resourceId] || []
        const newActions = current.includes(action)
          ? current.filter((a) => a !== action)
          : [...current, action]
        return {
          ...prev,
          [vaultKey]: {
            ...vaultPerms,
            [resourceId]: newActions,
          },
        }
      })
    } else {
      // Handle non-source files - update global permissions
      setPermissions((prev) => {
        const current = prev[resourceId] || []
        if (current.includes(action)) {
          return { ...prev, [resourceId]: current.filter((a) => a !== action) }
        } else {
          return { ...prev, [resourceId]: [...current, action] }
        }
      })
    }
  }

  const toggleAllInGroup = (groupId: string, action: PermissionAction) => {
    if (!isAdmin) return

    const group = RESOURCE_GROUPS.find((g) => g.id === groupId)
    if (!group) return

    if (groupId === 'source-files') {
      // Handle source files group
      const vaultKey = getSourceFilesVaultKey()
      const allHave = group.resources.every((r) =>
        (sourceFilesPermsByVault[vaultKey]?.[r] || []).includes(action),
      )

      setSourceFilesPermsByVault((prev) => {
        const vaultPerms = prev[vaultKey] || {}
        const updated = { ...vaultPerms }
        for (const resourceId of group.resources) {
          const current = updated[resourceId] || []
          if (allHave) {
            updated[resourceId] = current.filter((a) => a !== action)
          } else if (!current.includes(action)) {
            updated[resourceId] = [...current, action]
          }
        }
        return { ...prev, [vaultKey]: updated }
      })
    } else {
      // Handle non-source files groups
      const allHave = group.resources.every((r) => (permissions[r] || []).includes(action))

      setPermissions((prev) => {
        const updated = { ...prev }
        for (const resourceId of group.resources) {
          const current = updated[resourceId] || []
          if (allHave) {
            updated[resourceId] = current.filter((a) => a !== action)
          } else if (!current.includes(action)) {
            updated[resourceId] = [...current, action]
          }
        }
        return updated
      })
    }
  }

  const setAllActions = (resourceId: string, actions: PermissionAction[]) => {
    if (!isAdmin) return

    if (sourceFilesResources.includes(resourceId)) {
      const vaultKey = getSourceFilesVaultKey()
      setSourceFilesPermsByVault((prev) => ({
        ...prev,
        [vaultKey]: {
          ...prev[vaultKey],
          [resourceId]: actions,
        },
      }))
    } else {
      setPermissions((prev) => ({ ...prev, [resourceId]: actions }))
    }
  }

  const applyPreset = (preset: PermissionPreset) => {
    if (!isAdmin) return
    // Split preset into source files and other permissions
    const globalPerms: Record<string, PermissionAction[]> = {}
    const sfPerms: Record<string, PermissionAction[]> = {}

    for (const [resource, actions] of Object.entries(preset.permissions)) {
      if (sourceFilesResources.includes(resource)) {
        sfPerms[resource] = actions
      } else {
        globalPerms[resource] = actions
      }
    }

    setPermissions(globalPerms)
    // Apply source files to "all" vault context
    setSourceFilesPermsByVault((prev) => ({ ...prev, all: sfPerms }))
    setShowPresets(false)
    addToast('success', `Applied "${preset.name}" preset`)
  }

  const resetToOriginal = () => {
    setPermissions({ ...originalPermissions })
    setSourceFilesPermsByVault(JSON.parse(JSON.stringify(originalSourceFilesPermsByVault)))
  }

  const clearAll = () => {
    if (!isAdmin) return
    setPermissions({})
    setSourceFilesPermsByVault({})
  }

  const grantAll = () => {
    if (!isAdmin) return
    const globalPerms: Record<string, PermissionAction[]> = {}
    const sfPerms: Record<string, PermissionAction[]> = {}

    for (const resource of ALL_RESOURCES) {
      if (sourceFilesResources.includes(resource.id)) {
        sfPerms[resource.id] = [...resource.applicableActions]
      } else {
        globalPerms[resource.id] = [...resource.applicableActions]
      }
    }

    setPermissions(globalPerms)
    setSourceFilesPermsByVault({ all: sfPerms })
  }

  // Toggle a specific action across ALL resources (including source files for current vault context)
  const toggleAllForAction = (action: PermissionAction) => {
    if (!isAdmin) return

    // Get non-source-files resources
    const nonSfResources = ALL_RESOURCES.filter((r) => !sourceFilesResources.includes(r.id))
    // Get source files resources
    const sfResources = ALL_RESOURCES.filter((r) => sourceFilesResources.includes(r.id))
    const vaultKey = getSourceFilesVaultKey()

    // Check if all applicable resources have the action (both global and source files)
    const allNonSfHave = nonSfResources
      .filter((r) => r.applicableActions.includes(action))
      .every((r) => (permissions[r.id] || []).includes(action))
    const allSfHave = sfResources
      .filter((r) => r.applicableActions.includes(action))
      .every((r) => (sourceFilesPermsByVault[vaultKey]?.[r.id] || []).includes(action))
    const allHave = allNonSfHave && allSfHave

    // Update non-source-files permissions
    setPermissions((prev) => {
      const updated = { ...prev }
      for (const resource of nonSfResources) {
        if (!resource.applicableActions.includes(action)) continue
        const current = updated[resource.id] || []
        if (allHave) {
          updated[resource.id] = current.filter((a) => a !== action)
        } else if (!current.includes(action)) {
          updated[resource.id] = [...current, action]
        }
      }
      return updated
    })

    // Update source files permissions for current vault context
    setSourceFilesPermsByVault((prev) => {
      const vaultPerms = prev[vaultKey] || {}
      const updated = { ...vaultPerms }
      for (const resource of sfResources) {
        if (!resource.applicableActions.includes(action)) continue
        const current = updated[resource.id] || []
        if (allHave) {
          updated[resource.id] = current.filter((a) => a !== action)
        } else if (!current.includes(action)) {
          updated[resource.id] = [...current, action]
        }
      }
      return { ...prev, [vaultKey]: updated }
    })
  }

  // Check if all applicable resources have a specific action (including source files for current vault)
  const allHaveAction = (action: PermissionAction): boolean => {
    const vaultKey = getSourceFilesVaultKey()
    const nonSfResources = ALL_RESOURCES.filter((r) => !sourceFilesResources.includes(r.id))
    const sfResources = ALL_RESOURCES.filter((r) => sourceFilesResources.includes(r.id))

    const allNonSfHave = nonSfResources
      .filter((r) => r.applicableActions.includes(action))
      .every((r) => (permissions[r.id] || []).includes(action))
    const allSfHave = sfResources
      .filter((r) => r.applicableActions.includes(action))
      .every((r) => (sourceFilesPermsByVault[vaultKey]?.[r.id] || []).includes(action))

    return allNonSfHave && allSfHave
  }

  // Check if some (but not all) applicable resources have a specific action (including source files)
  const someHaveAction = (action: PermissionAction): boolean => {
    const vaultKey = getSourceFilesVaultKey()
    const nonSfResources = ALL_RESOURCES.filter((r) => !sourceFilesResources.includes(r.id))
    const sfResources = ALL_RESOURCES.filter((r) => sourceFilesResources.includes(r.id))

    const applicableNonSf = nonSfResources.filter((r) => r.applicableActions.includes(action))
    const applicableSf = sfResources.filter((r) => r.applicableActions.includes(action))

    const withActionNonSf = applicableNonSf.filter((r) =>
      (permissions[r.id] || []).includes(action),
    )
    const withActionSf = applicableSf.filter((r) =>
      (sourceFilesPermsByVault[vaultKey]?.[r.id] || []).includes(action),
    )

    const totalApplicable = applicableNonSf.length + applicableSf.length
    const totalWithAction = withActionNonSf.length + withActionSf.length

    return totalWithAction > 0 && totalWithAction < totalApplicable
  }

  // Filter resources by search
  const filterResources = (resources: string[]): string[] => {
    if (!searchQuery) return resources
    return resources.filter((resourceId) => {
      const resource = ALL_RESOURCES.find((r) => r.id === resourceId)
      if (!resource) return false
      return (
        resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }

  // Count permissions in a group
  const getGroupStats = (groupId: string) => {
    const group = RESOURCE_GROUPS.find((g) => g.id === groupId)
    if (!group) return { total: 0, withPerms: 0 }

    let withPerms = 0
    for (const resourceId of group.resources) {
      if (getResourcePermissions(resourceId).length > 0) {
        withPerms++
      }
    }
    return { total: group.resources.length, withPerms }
  }

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const IconComponent = (LucideIcons as any)[team.icon] || Users // TODO: type this

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center overflow-hidden"
      onClick={onClose}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-6xl h-[90vh] mx-4 flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
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
            <p className="text-sm text-plm-fg-muted">Configure what this team can access and do</p>
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
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
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
              {DEFAULT_PRESETS.map((preset) => {
                const PresetIcon = (LucideIcons as any)[preset.icon] || Shield // TODO: type this
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
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resources..."
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>

          {/* Quick column toggles */}
          {isAdmin && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-plm-fg-muted mr-1">Toggle All:</span>
              {PERMISSION_ACTIONS.map((action) => {
                const allHave = allHaveAction(action)
                const someHave = someHaveAction(action)

                const checkedClass =
                  action === 'view'
                    ? 'bg-blue-500/35 text-blue-300 border-blue-400/70'
                    : action === 'create'
                      ? 'bg-green-500/35 text-green-300 border-green-400/70'
                      : action === 'edit'
                        ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70'
                        : action === 'delete'
                          ? 'bg-red-500/35 text-red-300 border-red-400/70'
                          : 'bg-purple-500/35 text-purple-300 border-purple-400/70'

                const partialClass =
                  action === 'view'
                    ? 'bg-blue-500/15 text-blue-400/60 border-blue-400/40'
                    : action === 'create'
                      ? 'bg-green-500/15 text-green-400/60 border-green-400/40'
                      : action === 'edit'
                        ? 'bg-yellow-500/15 text-yellow-400/60 border-yellow-400/40'
                        : action === 'delete'
                          ? 'bg-red-500/15 text-red-400/60 border-red-400/40'
                          : 'bg-purple-500/15 text-purple-400/60 border-purple-400/40'

                const uncheckedClass =
                  action === 'view'
                    ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15'
                    : action === 'create'
                      ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15'
                      : action === 'edit'
                        ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15'
                        : action === 'delete'
                          ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15'
                          : 'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15'

                return (
                  <button
                    key={action}
                    onClick={() => toggleAllForAction(action)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
                      allHave ? checkedClass : someHave ? partialClass : uncheckedClass
                    }`}
                    title={`${allHave ? 'Remove' : 'Grant'} ${PERMISSION_ACTION_LABELS[action]} for all resources`}
                  >
                    {allHave ? (
                      <Check size={12} />
                    ) : someHave ? (
                      <Minus size={12} />
                    ) : (
                      <span className="text-[9px] font-medium">
                        {action.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </button>
                )
              })}

              {/* Select All / Clear All button */}
              <div className="ml-2 flex items-center gap-1 border-l border-plm-border pl-2">
                <button
                  onClick={grantAll}
                  className="px-2 py-1.5 text-xs rounded-lg border border-plm-accent/30 bg-plm-accent/10 text-plm-accent hover:bg-plm-accent/20 transition-colors flex items-center gap-1"
                  title="Grant all permissions to all resources"
                >
                  <Check size={12} />
                  All
                </button>
                <button
                  onClick={clearAll}
                  className="px-2 py-1.5 text-xs rounded-lg border border-plm-border bg-plm-bg text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors flex items-center gap-1"
                  title="Clear all permissions"
                >
                  <X size={12} />
                  None
                </button>
              </div>
            </div>
          )}

          {/* Action legend */}
          <div className="flex items-center gap-4 ml-auto text-xs text-plm-fg-muted">
            {PERMISSION_ACTIONS.map((action) => (
              <div key={action} className="flex items-center gap-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    action === 'view'
                      ? 'bg-blue-400'
                      : action === 'create'
                        ? 'bg-green-400'
                        : action === 'edit'
                          ? 'bg-yellow-400'
                          : action === 'delete'
                            ? 'bg-red-400'
                            : 'bg-purple-400'
                  }`}
                />
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
              {RESOURCE_GROUPS.map((group) => {
                const filteredResources = filterResources(group.resources)
                if (filteredResources.length === 0) return null

                const isExpanded = expandedGroups.has(group.id)
                const stats = getGroupStats(group.id)
                const GroupIcon = (LucideIcons as any)[group.icon] || LayoutGrid // TODO: type this

                return (
                  <div
                    key={group.id}
                    className="border border-plm-border rounded-xl overflow-hidden bg-plm-bg/30"
                  >
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
                            {group.id === 'source-files'
                              ? `${vaults.length} vault${vaults.length !== 1 ? 's' : ''} • ${stats.withPerms} of ${stats.total} configured`
                              : `${stats.withPerms} of ${stats.total} resources configured`}
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
                          {PERMISSION_ACTIONS.map((action) => {
                            const allHave = group.resources.every((r) =>
                              getResourcePermissions(r).includes(action),
                            )
                            const someHave = group.resources.some((r) =>
                              getResourcePermissions(r).includes(action),
                            )

                            // Match the styling from child buttons
                            const checkedClass =
                              action === 'view'
                                ? 'bg-blue-500/35 text-blue-300 border-blue-400/70'
                                : action === 'create'
                                  ? 'bg-green-500/35 text-green-300 border-green-400/70'
                                  : action === 'edit'
                                    ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70'
                                    : action === 'delete'
                                      ? 'bg-red-500/35 text-red-300 border-red-400/70'
                                      : 'bg-purple-500/35 text-purple-300 border-purple-400/70'

                            const partialClass =
                              action === 'view'
                                ? 'bg-blue-500/15 text-blue-400/60 border-blue-400/40'
                                : action === 'create'
                                  ? 'bg-green-500/15 text-green-400/60 border-green-400/40'
                                  : action === 'edit'
                                    ? 'bg-yellow-500/15 text-yellow-400/60 border-yellow-400/40'
                                    : action === 'delete'
                                      ? 'bg-red-500/15 text-red-400/60 border-red-400/40'
                                      : 'bg-purple-500/15 text-purple-400/60 border-purple-400/40'

                            const uncheckedClass =
                              action === 'view'
                                ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15'
                                : action === 'create'
                                  ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15'
                                  : action === 'edit'
                                    ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15'
                                    : action === 'delete'
                                      ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15'
                                      : 'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15'

                            return (
                              <button
                                key={action}
                                onClick={() => toggleAllInGroup(group.id, action)}
                                className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                                  allHave ? checkedClass : someHave ? partialClass : uncheckedClass
                                }`}
                                title={`Toggle ${PERMISSION_ACTION_LABELS[action]} for all in ${group.name}`}
                              >
                                {allHave ? (
                                  <Check size={14} />
                                ) : someHave ? (
                                  <Minus size={14} />
                                ) : (
                                  <span className="text-[10px] font-medium">
                                    {action.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                          {/* Spacer to align with child rows' quick actions */}
                          <div className="ml-2 w-[52px]" />
                        </div>
                      )}
                    </div>

                    {/* Group resources */}
                    {isExpanded && (
                      <div className="border-t border-plm-border">
                        {/* Vault tabs for source-files group */}
                        {group.id === 'source-files' && vaults.length > 0 && (
                          <div className="px-4 py-2 border-b border-plm-border bg-plm-bg/50 flex items-center gap-1 flex-wrap">
                            <span className="text-xs text-plm-fg-muted mr-1">Vault:</span>
                            <button
                              onClick={() => setSelectedSourceFilesVaultId(null)}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                                selectedSourceFilesVaultId === null
                                  ? 'bg-plm-accent text-white'
                                  : 'bg-plm-bg-light text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight border border-plm-border'
                              }`}
                            >
                              <Database size={11} />
                              All
                            </button>
                            {vaults.map((vault) => (
                              <button
                                key={vault.id}
                                onClick={() => setSelectedSourceFilesVaultId(vault.id)}
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
                          </div>
                        )}

                        {filteredResources.map((resourceId, idx) => {
                          const resource = ALL_RESOURCES.find((r) => r.id === resourceId)
                          if (!resource) return null

                          const ResourceIcon = (LucideIcons as any)[resource.icon] || Shield // TODO: type this
                          const currentActions = getResourcePermissions(resourceId)

                          return (
                            <div
                              key={resourceId}
                              className={`flex items-center gap-3 px-4 py-2.5 hover:bg-plm-highlight/30 transition-colors ${
                                idx !== filteredResources.length - 1
                                  ? 'border-b border-plm-border/20'
                                  : ''
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
                                {PERMISSION_ACTIONS.map((action) => {
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
                                    action === 'view'
                                      ? 'bg-blue-500/35 text-blue-300 border-blue-400/70'
                                      : action === 'create'
                                        ? 'bg-green-500/35 text-green-300 border-green-400/70'
                                        : action === 'edit'
                                          ? 'bg-yellow-500/35 text-yellow-300 border-yellow-400/70'
                                          : action === 'delete'
                                            ? 'bg-red-500/35 text-red-300 border-red-400/70'
                                            : 'bg-purple-500/35 text-purple-300 border-purple-400/70'

                                  // Dimmer colors for unchecked state
                                  const uncheckedColorClass =
                                    action === 'view'
                                      ? 'border-blue-500/20 bg-blue-500/5 text-blue-400/40 hover:border-blue-400/50 hover:bg-blue-500/15 hover:text-blue-400/70'
                                      : action === 'create'
                                        ? 'border-green-500/20 bg-green-500/5 text-green-400/40 hover:border-green-400/50 hover:bg-green-500/15 hover:text-green-400/70'
                                        : action === 'edit'
                                          ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400/40 hover:border-yellow-400/50 hover:bg-yellow-500/15 hover:text-yellow-400/70'
                                          : action === 'delete'
                                            ? 'border-red-500/20 bg-red-500/5 text-red-400/40 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-400/70'
                                            : 'border-purple-500/20 bg-purple-500/5 text-purple-400/40 hover:border-purple-400/50 hover:bg-purple-500/15 hover:text-purple-400/70'

                                  // Get the first letter of the action for unchecked display
                                  const actionLetter = action.charAt(0).toUpperCase()

                                  return (
                                    <button
                                      key={action}
                                      onClick={() => toggleAction(resourceId, action)}
                                      disabled={!isAdmin}
                                      className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                                        isGranted ? colorClass : uncheckedColorClass
                                      } ${!isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                                      title={`${isGranted ? 'Revoke' : 'Grant'} ${PERMISSION_ACTION_LABELS[action]}`}
                                    >
                                      {isGranted ? (
                                        <Check size={14} />
                                      ) : (
                                        <span className="text-[10px] font-medium">
                                          {actionLetter}
                                        </span>
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
                                      onClick={() =>
                                        setAllActions(resourceId, [...resource.applicableActions])
                                      }
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
                {Object.entries(permissions).filter(([_, a]) => a.length > 0).length +
                  Object.values(sourceFilesPermsByVault).reduce(
                    (sum, vaultPerms) =>
                      sum + Object.values(vaultPerms).filter((a) => a.length > 0).length,
                    0,
                  )}{' '}
                resources configured
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
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Permissions
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
