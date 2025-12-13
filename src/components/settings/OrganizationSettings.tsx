// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect } from 'react'
import { 
  Building2, 
  Users, 
  Mail, 
  Shield, 
  Loader2, 
  Plus, 
  Folder, 
  Trash2, 
  Star, 
  Pencil, 
  Check, 
  X,
  Link,
  Unlink,
  Key,
  Copy,
  RefreshCw,
  ChevronDown,
  Wrench,
  Eye,
  Lock,
  UserMinus,
  FileBox,
  AlertTriangle
} from 'lucide-react'
import { usePDMStore, ConnectedVault } from '../../stores/pdmStore'
import { supabase, getCurrentConfig, updateUserRole, removeUserFromOrg, getOrgVaultAccess, setUserVaultAccess } from '../../lib/supabase'
import { generateOrgCode } from '../../lib/supabaseConfig'
import { getInitials } from '../../types/pdm'

// Build vault path based on platform
function buildVaultPath(platform: string, vaultSlug: string): string {
  if (platform === 'darwin') {
    return `~/Documents/BluePDM/${vaultSlug}`
  } else if (platform === 'linux') {
    return `~/BluePDM/${vaultSlug}`
  } else {
    return `C:\\BluePDM\\${vaultSlug}`
  }
}

interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  last_sign_in: string | null
}

interface Vault {
  id: string
  name: string
  slug: string
  description: string | null
  storage_bucket: string
  is_default: boolean
  created_at: string
}

export function OrganizationSettings() {
  const { 
    user, 
    organization, 
    connectedVaults,
    activeVaultId,
    files,
    addConnectedVault,
    removeConnectedVault,
    updateConnectedVault,
    setFiles,
    setServerFiles,
    setFilesLoaded,
    setVaultPath,
    setVaultConnected,
    setOrganization,
    addToast,
    triggerVaultsRefresh
  } = usePDMStore()
  
  const [platform, setPlatform] = useState<string>('win32')
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [orgVaults, setOrgVaults] = useState<Vault[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isLoadingVaults, setIsLoadingVaults] = useState(false)
  const [isCreatingVault, setIsCreatingVault] = useState(false)
  const [newVaultName, setNewVaultName] = useState('')
  const [newVaultDescription, setNewVaultDescription] = useState('')
  const [isSavingVault, setIsSavingVault] = useState(false)
  const [renamingVaultId, setRenamingVaultId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [connectingVaultId, setConnectingVaultId] = useState<string | null>(null)
  const [deletingVault, setDeletingVault] = useState<Vault | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [disconnectingVault, setDisconnectingVault] = useState<{ id: string; name: string } | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  
  // Org code state
  const [showOrgCode, setShowOrgCode] = useState(false)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  
  // User management state
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(null)
  const [removingUser, setRemovingUser] = useState<OrgUser | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [roleDropdownOpen, setRoleDropdownOpen] = useState<string | null>(null)
  
  // Vault access state
  const [vaultAccessMap, setVaultAccessMap] = useState<Record<string, string[]>>({})
  const [editingVaultAccessUser, setEditingVaultAccessUser] = useState<OrgUser | null>(null)
  const [pendingVaultAccess, setPendingVaultAccess] = useState<string[]>([])
  const [isSavingVaultAccess, setIsSavingVaultAccess] = useState(false)
  
  // Get platform on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])
  
  // Load data on mount
  useEffect(() => {
    if (organization) {
      loadOrgVaults()
      loadOrgUsers()
      loadVaultAccess()
    }
  }, [organization])
  
  const loadOrgUsers = async () => {
    if (!organization) return
    
    setIsLoadingUsers(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, role, last_sign_in')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (error) {
        console.error('Failed to load org users:', error)
      } else {
        setOrgUsers(data || [])
      }
    } catch (err) {
      console.error('Failed to load org users:', err)
    } finally {
      setIsLoadingUsers(false)
    }
  }
  
  const loadOrgVaults = async () => {
    if (!organization) return
    
    setIsLoadingVaults(true)
    try {
      const { data, error } = await supabase
        .from('vaults')
        .select('*')
        .eq('org_id', organization.id)
        .order('is_default', { ascending: false })
        .order('name')
      
      if (error) {
        console.error('Failed to load org vaults:', error)
      } else {
        setOrgVaults(data || [])
      }
    } catch (err) {
      console.error('Failed to load org vaults:', err)
    } finally {
      setIsLoadingVaults(false)
    }
  }
  
  const loadVaultAccess = async () => {
    if (!organization) return
    
    const { accessMap, error } = await getOrgVaultAccess(organization.id)
    if (error) {
      console.error('Failed to load vault access:', error)
    } else {
      setVaultAccessMap(accessMap)
    }
  }
  
  const createSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
  
  const handleCreateVault = async () => {
    if (!newVaultName.trim() || !organization || !user) return
    
    setIsSavingVault(true)
    
    const name = newVaultName.trim()
    const slug = createSlug(name)
    const storageBucket = `vault-${organization.slug}-${slug}`
    
    try {
      const { data: vault, error } = await supabase
        .from('vaults')
        .insert({
          org_id: organization.id,
          name,
          slug,
          description: newVaultDescription.trim() || null,
          storage_bucket: storageBucket,
          is_default: orgVaults.length === 0,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) {
        console.error('Failed to create vault:', error)
        addToast('error', `Failed to create vault: ${error.message}`)
        return
      }
      
      addToast('success', `Vault "${name}" created`)
      setOrgVaults([...orgVaults, vault])
      setIsCreatingVault(false)
      setNewVaultName('')
      setNewVaultDescription('')
      triggerVaultsRefresh()
    } catch (err) {
      console.error('Failed to create vault:', err)
      addToast('error', 'Failed to create vault')
    } finally {
      setIsSavingVault(false)
    }
  }
  
  const handleRenameVault = async (vault: Vault) => {
    if (!renameValue.trim() || renameValue === vault.name) {
      setRenamingVaultId(null)
      return
    }
    
    const newName = renameValue.trim()
    const newSlug = createSlug(newName)
    
    try {
      const { error } = await supabase
        .from('vaults')
        .update({ name: newName, slug: newSlug })
        .eq('id', vault.id)
      
      if (error) {
        addToast('error', `Failed to rename vault: ${error.message}`)
        return
      }
      
      const connectedVault = connectedVaults.find(v => v.id === vault.id)
      if (connectedVault) {
        updateConnectedVault(vault.id, { name: newName })
      }
      
      setOrgVaults(orgVaults.map(v => 
        v.id === vault.id ? { ...v, name: newName, slug: newSlug } : v
      ))
      addToast('success', `Vault renamed to "${newName}"`)
      setRenamingVaultId(null)
    } catch (err) {
      console.error('Failed to rename vault:', err)
      addToast('error', 'Failed to rename vault')
    }
  }
  
  const handleSetDefaultVault = async (vaultId: string) => {
    if (!organization) return
    
    try {
      await supabase
        .from('vaults')
        .update({ is_default: false })
        .eq('org_id', organization.id)
      
      const { error } = await supabase
        .from('vaults')
        .update({ is_default: true })
        .eq('id', vaultId)
      
      if (error) {
        addToast('error', 'Failed to set default vault')
        return
      }
      
      setOrgVaults(orgVaults.map(v => ({
        ...v,
        is_default: v.id === vaultId
      })))
      addToast('success', 'Default vault updated')
    } catch (err) {
      console.error('Failed to set default vault:', err)
    }
  }
  
  const handleDeleteVault = async () => {
    if (!deletingVault || deleteConfirmText !== deletingVault.name) return
    
    setIsDeleting(true)
    
    try {
      const connectedVault = connectedVaults.find(v => v.id === deletingVault.id)
      if (connectedVault?.localPath) {
        const api = window.electronAPI
        if (api) {
          try {
            await api.deleteItem(connectedVault.localPath)
          } catch (err) {
            console.error('Failed to delete local folder:', err)
          }
        }
      }
      
      const { error } = await supabase
        .from('vaults')
        .delete()
        .eq('id', deletingVault.id)
      
      if (error) {
        addToast('error', `Failed to delete vault: ${error.message}`)
        return
      }
      
      if (connectedVaults.some(v => v.id === deletingVault.id)) {
        removeConnectedVault(deletingVault.id)
      }
      
      setOrgVaults(orgVaults.filter(v => v.id !== deletingVault.id))
      addToast('success', `Vault "${deletingVault.name}" permanently deleted`)
      setDeletingVault(null)
      setDeleteConfirmText('')
      triggerVaultsRefresh()
    } catch (err) {
      console.error('Failed to delete vault:', err)
      addToast('error', 'Failed to delete vault')
    } finally {
      setIsDeleting(false)
    }
  }
  
  const handleConnectVault = async (vault: Vault) => {
    setConnectingVaultId(vault.id)
    
    try {
      const api = window.electronAPI
      if (!api) {
        addToast('error', 'Electron API not available')
        return
      }
      
      const localPath = buildVaultPath(platform, vault.slug)
      const result = await api.createWorkingDir(localPath)
      
      if (result.success && result.path) {
        const connectedVault: ConnectedVault = {
          id: vault.id,
          name: vault.name,
          localPath: result.path,
          isExpanded: true
        }
        addConnectedVault(connectedVault)
        setVaultPath(result.path)
        setVaultConnected(true)
        addToast('success', `Connected to "${vault.name}"`)
      } else {
        addToast('error', `Failed to create vault folder: ${result.error}`)
      }
    } catch (err) {
      console.error('Failed to connect vault:', err)
      addToast('error', 'Failed to connect vault')
    } finally {
      setConnectingVaultId(null)
    }
  }
  
  const handleDisconnectVault = (vaultId: string) => {
    const vault = connectedVaults.find(v => v.id === vaultId)
    if (vault) {
      setDisconnectingVault({ id: vault.id, name: vault.name })
    }
  }
  
  const confirmDisconnect = async () => {
    if (!disconnectingVault) return
    
    setIsDisconnecting(true)
    const connectedVault = connectedVaults.find(v => v.id === disconnectingVault.id)
    
    let folderDeleted = false
    if (connectedVault?.localPath) {
      const api = window.electronAPI
      if (api) {
        try {
          await api.clearWorkingDir()
          await new Promise(resolve => setTimeout(resolve, 200))
          const result = await api.deleteItem(connectedVault.localPath)
          if (result.success) {
            folderDeleted = true
          }
        } catch (err) {
          console.error('Failed to delete local folder:', err)
        }
      }
    }
    
    if (disconnectingVault.id === activeVaultId) {
      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      setVaultPath(null)
      setVaultConnected(false)
    }
    
    removeConnectedVault(disconnectingVault.id)
    setDisconnectingVault(null)
    setIsDisconnecting(false)
    
    if (folderDeleted) {
      addToast('success', 'Vault disconnected and local files deleted')
    } else {
      addToast('info', 'Vault disconnected (local folder may still exist)')
    }
  }
  
  const isVaultConnected = (vaultId: string) => {
    return connectedVaults.some(v => v.id === vaultId)
  }
  
  // User management
  const generateInviteMessage = () => {
    const config = getCurrentConfig()
    if (!config || !organization) return ''
    
    const code = generateOrgCode(config)
    return `You've been invited to join ${organization.name} on BluePDM!

BluePDM is a Product Data Management tool for engineering teams.

To get started:
1. Download BluePDM from: https://github.com/bluerobotics/blue-pdm/releases
2. Install and open the app
3. When prompted, enter this organization code:

${code}

4. Sign in with your Google account

See you on the team!`
  }
  
  const handleCopyInvite = async () => {
    const message = generateInviteMessage()
    try {
      await navigator.clipboard.writeText(message)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
      addToast('success', 'Invite copied! Paste it in an email to send.')
    } catch (err) {
      addToast('error', 'Failed to copy invite')
    }
  }
  
  const handleChangeRole = async (targetUser: OrgUser, newRole: 'admin' | 'engineer' | 'viewer') => {
    if (!organization || targetUser.role === newRole) {
      setRoleDropdownOpen(null)
      return
    }
    
    setChangingRoleUserId(targetUser.id)
    try {
      const result = await updateUserRole(targetUser.id, newRole, organization.id)
      if (result.success) {
        addToast('success', `Changed ${targetUser.full_name || targetUser.email}'s role to ${newRole}`)
        setOrgUsers(orgUsers.map(u => 
          u.id === targetUser.id ? { ...u, role: newRole } : u
        ))
      } else {
        addToast('error', result.error || 'Failed to change role')
      }
    } catch (err) {
      addToast('error', 'Failed to change role')
    } finally {
      setChangingRoleUserId(null)
      setRoleDropdownOpen(null)
    }
  }
  
  const handleRemoveUser = async () => {
    if (!removingUser || !organization) return
    
    setIsRemoving(true)
    try {
      const result = await removeUserFromOrg(removingUser.id, organization.id)
      if (result.success) {
        addToast('success', `Removed ${removingUser.full_name || removingUser.email} from organization`)
        setOrgUsers(orgUsers.filter(u => u.id !== removingUser.id))
        setRemovingUser(null)
      } else {
        addToast('error', result.error || 'Failed to remove user')
      }
    } catch (err) {
      addToast('error', 'Failed to remove user')
    } finally {
      setIsRemoving(false)
    }
  }
  
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return Shield
      case 'engineer': return Wrench
      case 'viewer': return Eye
      default: return Eye
    }
  }
  
  const getUserVaultAccessCount = (userId: string) => {
    let count = 0
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        count++
      }
    }
    return count
  }
  
  const getUserAccessibleVaults = (userId: string) => {
    const accessibleVaultIds: string[] = []
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        accessibleVaultIds.push(vaultId)
      }
    }
    return accessibleVaultIds
  }
  
  const openVaultAccessEditor = (targetUser: OrgUser) => {
    setEditingVaultAccessUser(targetUser)
    const currentAccess = getUserAccessibleVaults(targetUser.id)
    setPendingVaultAccess(currentAccess)
  }
  
  const handleSaveVaultAccess = async () => {
    if (!editingVaultAccessUser || !user || !organization) return
    
    setIsSavingVaultAccess(true)
    try {
      const result = await setUserVaultAccess(
        editingVaultAccessUser.id,
        pendingVaultAccess,
        user.id,
        organization.id
      )
      
      if (result.success) {
        addToast('success', `Updated vault access for ${editingVaultAccessUser.full_name || editingVaultAccessUser.email}`)
        await loadVaultAccess()
        setEditingVaultAccessUser(null)
      } else {
        addToast('error', result.error || 'Failed to update vault access')
      }
    } catch (err) {
      addToast('error', 'Failed to update vault access')
    } finally {
      setIsSavingVaultAccess(false)
    }
  }
  
  const toggleVaultAccess = (vaultId: string) => {
    setPendingVaultAccess(current => 
      current.includes(vaultId)
        ? current.filter(id => id !== vaultId)
        : [...current, vaultId]
    )
  }

  if (!organization) {
    return (
      <div className="text-center py-12 text-pdm-fg-muted">
        No organization connected
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Organization info */}
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <div className="flex items-center gap-3 mb-2">
          <Building2 size={22} className="text-pdm-accent" />
          <span className="text-lg font-medium text-pdm-fg">{organization.name}</span>
        </div>
        <div className="text-sm text-pdm-fg-muted mb-4">
          Email domains: {organization.email_domains?.join(', ')}
        </div>
        
        {/* Organization Code (Admin only) */}
        {user?.role === 'admin' && (
          <div className="pt-3 border-t border-pdm-border">
            {showOrgCode && orgCode ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-pdm-fg-muted uppercase tracking-wide">Organization Code</span>
                  <button
                    onClick={() => setShowOrgCode(false)}
                    className="text-xs text-pdm-fg-muted hover:text-pdm-fg"
                  >
                    Hide
                  </button>
                </div>
                <div className="relative">
                  <div className="font-mono text-xs bg-pdm-bg-secondary border border-pdm-border rounded-lg p-3 pr-12 break-all text-pdm-fg max-h-24 overflow-y-auto">
                    {orgCode}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(orgCode)
                        setCodeCopied(true)
                        setTimeout(() => setCodeCopied(false), 2000)
                      } catch (err) {
                        console.error('Failed to copy:', err)
                      }
                    }}
                    className="absolute top-2 right-2 p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    {codeCopied ? (
                      <Check size={16} className="text-green-500" />
                    ) : (
                      <Copy size={16} className="text-pdm-fg-muted" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-pdm-fg-dim">
                  Share with team members to connect to your organization.
                </p>
              </div>
            ) : (
              <button
                onClick={() => {
                  const config = getCurrentConfig()
                  if (config) {
                    const code = generateOrgCode(config)
                    setOrgCode(code)
                    setShowOrgCode(true)
                  }
                }}
                className="flex items-center gap-2 text-sm text-pdm-fg-muted hover:text-pdm-fg transition-colors"
              >
                <Key size={14} />
                Show Organization Code
              </button>
            )}
          </div>
        )}
      </div>

      {/* Vaults */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
            <Folder size={14} />
            Vaults ({orgVaults.length})
          </div>
          {user?.role === 'admin' && (
            <button
              onClick={() => setIsCreatingVault(true)}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Plus size={14} />
              Add Vault
            </button>
          )}
        </div>
        
        {/* Create vault form */}
        {isCreatingVault && (
          <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-accent space-y-3">
            <div className="space-y-2">
              <label className="text-xs text-pdm-fg-muted">Vault Name</label>
              <input
                type="text"
                value={newVaultName}
                onChange={(e) => setNewVaultName(e.target.value)}
                placeholder="e.g., Main Vault, Archive, Projects"
                className="w-full bg-pdm-bg-light border border-pdm-border rounded-lg px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-pdm-fg-muted">Description (optional)</label>
              <input
                type="text"
                value={newVaultDescription}
                onChange={(e) => setNewVaultDescription(e.target.value)}
                placeholder="e.g., Main production files"
                className="w-full bg-pdm-bg-light border border-pdm-border rounded-lg px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsCreatingVault(false)
                  setNewVaultName('')
                  setNewVaultDescription('')
                }}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateVault}
                disabled={!newVaultName.trim() || isSavingVault}
                className="btn btn-primary btn-sm"
              >
                {isSavingVault ? 'Creating...' : 'Create Vault'}
              </button>
            </div>
          </div>
        )}
        
        {/* Vaults list */}
        {isLoadingVaults ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
          </div>
        ) : orgVaults.length === 0 ? (
          <div className="text-center py-8 text-pdm-fg-muted text-sm">
            {user?.role === 'admin' 
              ? 'No vaults created yet. Add a vault to get started.'
              : 'No vaults created yet. Ask an organization admin to create one.'}
          </div>
        ) : (
          <div className="space-y-2">
            {orgVaults.map(vault => (
              <div 
                key={vault.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-pdm-bg border border-pdm-border hover:border-pdm-border-light transition-colors"
              >
                <Folder size={18} className={vault.is_default ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                <div className="flex-1 min-w-0">
                  {renamingVaultId === vault.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameVault(vault)
                          if (e.key === 'Escape') setRenamingVaultId(null)
                        }}
                        className="flex-1 bg-pdm-bg-light border border-pdm-border rounded px-2 py-1 text-sm focus:border-pdm-accent focus:outline-none"
                        autoFocus
                      />
                      <button onClick={() => handleRenameVault(vault)} className="p-1 hover:bg-pdm-highlight rounded">
                        <Check size={14} className="text-pdm-success" />
                      </button>
                      <button onClick={() => setRenamingVaultId(null)} className="p-1 hover:bg-pdm-highlight rounded">
                        <X size={14} className="text-pdm-fg-muted" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-pdm-fg font-medium truncate">
                          {vault.name}
                        </span>
                        {vault.is_default && (
                          <span className="px-1.5 py-0.5 bg-pdm-accent/20 text-pdm-accent text-xs rounded">
                            Default
                          </span>
                        )}
                        {isVaultConnected(vault.id) && (
                          <span className="px-1.5 py-0.5 bg-pdm-success/20 text-pdm-success text-xs rounded">
                            Connected
                          </span>
                        )}
                      </div>
                      {vault.description && (
                        <div className="text-xs text-pdm-fg-muted truncate">
                          {vault.description}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {renamingVaultId !== vault.id && (
                  <div className="flex items-center gap-2">
                    {/* Connect/Disconnect button */}
                    {isVaultConnected(vault.id) ? (
                      <button
                        onClick={() => handleDisconnectVault(vault.id)}
                        className="btn btn-ghost btn-sm flex items-center gap-1 text-pdm-warning"
                        title="Disconnect vault"
                      >
                        <Unlink size={14} />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnectVault(vault)}
                        disabled={connectingVaultId === vault.id}
                        className="btn btn-primary btn-sm flex items-center gap-1"
                      >
                        {connectingVaultId === vault.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Link size={14} />
                        )}
                        Connect
                      </button>
                    )}
                    
                    {/* Admin actions */}
                    {user?.role === 'admin' && (
                      <div className="flex items-center gap-1 border-l border-pdm-border pl-2">
                        <button
                          onClick={() => {
                            setRenameValue(vault.name)
                            setRenamingVaultId(vault.id)
                          }}
                          className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                          title="Rename vault"
                        >
                          <Pencil size={14} className="text-pdm-fg-muted" />
                        </button>
                        {!vault.is_default && (
                          <button
                            onClick={() => handleSetDefaultVault(vault.id)}
                            className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                            title="Set as default"
                          >
                            <Star size={14} className="text-pdm-fg-muted" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setDeletingVault(vault)
                            setDeleteConfirmText('')
                          }}
                          className="p-1.5 hover:bg-pdm-error/20 rounded transition-colors"
                          title="Delete vault"
                        >
                          <Trash2 size={14} className="text-pdm-error" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
            <Users size={14} />
            Members ({orgUsers.length})
            <button
              onClick={loadOrgUsers}
              disabled={isLoadingUsers}
              className="p-1 rounded hover:bg-pdm-highlight transition-colors text-pdm-fg-muted hover:text-pdm-fg disabled:opacity-50"
              title="Refresh members"
            >
              <RefreshCw size={12} className={isLoadingUsers ? 'animate-spin' : ''} />
            </button>
          </div>
          {user?.role === 'admin' && (
            <button
              onClick={() => setShowInviteDialog(true)}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Mail size={14} />
              Invite User
            </button>
          )}
        </div>
        
        {isLoadingUsers ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
          </div>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {orgUsers.map(orgUser => {
              const RoleIcon = getRoleIcon(orgUser.role)
              const isCurrentUser = orgUser.id === user?.id
              const canManage = user?.role === 'admin' && !isCurrentUser
              
              return (
                <div 
                  key={orgUser.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-pdm-highlight transition-colors group"
                >
                  {orgUser.avatar_url ? (
                    <img 
                      src={orgUser.avatar_url} 
                      alt={orgUser.full_name || orgUser.email}
                      className="w-10 h-10 rounded-full"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-pdm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                      {getInitials(orgUser.full_name || orgUser.email)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-pdm-fg truncate flex items-center gap-2">
                      {orgUser.full_name || orgUser.email}
                      {isCurrentUser && (
                        <span className="text-xs text-pdm-fg-dim">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-pdm-fg-muted truncate flex items-center gap-2">
                      {orgUser.email}
                      {orgUser.role !== 'admin' && getUserVaultAccessCount(orgUser.id) > 0 && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-pdm-fg-muted/10 rounded text-pdm-fg-dim">
                          <Lock size={10} />
                          {getUserVaultAccessCount(orgUser.id)} vault{getUserVaultAccessCount(orgUser.id) !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Role badge / dropdown */}
                  <div className="relative">
                    {canManage ? (
                      <>
                        <button
                          onClick={() => setRoleDropdownOpen(roleDropdownOpen === orgUser.id ? null : orgUser.id)}
                          disabled={changingRoleUserId === orgUser.id}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                            orgUser.role === 'admin' ? 'bg-pdm-accent/20 text-pdm-accent' :
                            orgUser.role === 'engineer' ? 'bg-pdm-success/20 text-pdm-success' :
                            'bg-pdm-fg-muted/20 text-pdm-fg-muted'
                          } hover:opacity-80`}
                        >
                          {changingRoleUserId === orgUser.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RoleIcon size={12} />
                          )}
                          {orgUser.role.charAt(0).toUpperCase() + orgUser.role.slice(1)}
                          <ChevronDown size={12} />
                        </button>
                        
                        {roleDropdownOpen === orgUser.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl py-1 min-w-[140px]">
                            {(['viewer', 'engineer', 'admin'] as const).map(role => (
                              <button
                                key={role}
                                onClick={() => handleChangeRole(orgUser, role)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-pdm-highlight ${
                                  orgUser.role === role ? 'text-pdm-accent' : 'text-pdm-fg'
                                }`}
                              >
                                {role === 'admin' && <Shield size={14} />}
                                {role === 'engineer' && <Wrench size={14} />}
                                {role === 'viewer' && <Eye size={14} />}
                                {role.charAt(0).toUpperCase() + role.slice(1)}
                                {orgUser.role === role && <Check size={14} className="ml-auto" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                        orgUser.role === 'admin' ? 'bg-pdm-accent/20 text-pdm-accent' :
                        orgUser.role === 'engineer' ? 'bg-pdm-success/20 text-pdm-success' :
                        'bg-pdm-fg-muted/20 text-pdm-fg-muted'
                      }`}>
                        <RoleIcon size={12} />
                        {orgUser.role.charAt(0).toUpperCase() + orgUser.role.slice(1)}
                      </div>
                    )}
                  </div>
                  
                  {/* Vault Access button */}
                  {canManage && (
                    <button
                      onClick={() => openVaultAccessEditor(orgUser)}
                      className="p-1.5 text-pdm-fg-muted hover:text-pdm-accent hover:bg-pdm-accent/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                      title="Manage vault access"
                    >
                      <Lock size={16} />
                    </button>
                  )}
                  
                  {/* Remove button */}
                  {canManage && (
                    <button
                      onClick={() => setRemovingUser(orgUser)}
                      className="p-1.5 text-pdm-fg-muted hover:text-pdm-error hover:bg-pdm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                      title="Remove from organization"
                    >
                      <UserMinus size={16} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        
        {/* Role permissions info */}
        {user?.role === 'admin' && (
          <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border">
            <p className="text-xs text-pdm-fg-muted mb-2 font-medium">Role Permissions:</p>
            <div className="space-y-1 text-xs text-pdm-fg-dim">
              <div className="flex items-center gap-2">
                <Shield size={12} className="text-pdm-accent" />
                <span><strong>Admin:</strong> Full access, manage users & vaults</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench size={12} className="text-pdm-success" />
                <span><strong>Engineer:</strong> Check out, check in, modify files</span>
              </div>
              <div className="flex items-center gap-2">
                <Eye size={12} className="text-pdm-fg-muted" />
                <span><strong>Viewer:</strong> View and download files only</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SolidWorks DM License (Admin only) */}
      {user?.role === 'admin' && (
        <div className="space-y-3 pt-4 border-t border-pdm-border">
          <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
            <FileBox size={14} />
            SolidWorks Integration
          </div>
          <p className="text-sm text-pdm-fg-muted">
            Enter your organization's Document Manager API license key to enable direct file reading.
          </p>
          
          <div className="space-y-2">
            <label className="text-xs text-pdm-fg-dim">Document Manager License Key</label>
            <input
              type="password"
              value={organization?.settings?.solidworks_dm_license_key || ''}
              onChange={async (e) => {
                const newKey = e.target.value || null
                if (!organization) return
                try {
                  const { error } = await supabase
                    .from('organizations')
                    .update({ 
                      settings: { 
                        ...organization.settings, 
                        solidworks_dm_license_key: newKey 
                      } 
                    })
                    .eq('id', organization.id)
                  if (error) throw error
                  setOrganization({
                    ...organization,
                    settings: { ...organization.settings, solidworks_dm_license_key: newKey || undefined }
                  })
                  addToast('success', 'SolidWorks license key updated')
                } catch (err) {
                  addToast('error', 'Failed to save license key')
                }
              }}
              placeholder="Enter your organization's DM API license key"
              className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded-lg text-sm text-pdm-fg placeholder-pdm-fg-dim focus:outline-none focus:border-pdm-accent font-mono"
            />
            <p className="text-xs text-pdm-fg-dim">
              Free with SolidWorks subscription.{' '}
              <a 
                href="https://customerportal.solidworks.com/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-pdm-accent hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  window.electronAPI?.openFile('https://customerportal.solidworks.com/')
                }}
              >
                Request key →
              </a>
            </p>
            {organization?.settings?.solidworks_dm_license_key && (
              <div className="flex items-center gap-2 text-xs text-green-400">
                <Check size={12} />
                Direct file access enabled for all org users
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Vault Dialog */}
      {deletingVault && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setDeletingVault(null)}>
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-pdm-error/20 rounded-full">
                <AlertTriangle size={20} className="text-pdm-error" />
              </div>
              <h3 className="text-lg font-medium text-pdm-fg">Delete Vault</h3>
            </div>
            <p className="text-sm text-pdm-fg-muted mb-4">
              This will permanently delete the vault <strong>"{deletingVault.name}"</strong> and all its files from the cloud.
              This action cannot be undone.
            </p>
            <div className="space-y-2 mb-4">
              <label className="text-xs text-pdm-fg-dim">Type vault name to confirm:</label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deletingVault.name}
                className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded-lg text-sm focus:outline-none focus:border-pdm-error"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeletingVault(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleDeleteVault}
                disabled={deleteConfirmText !== deletingVault.name || isDeleting}
                className="btn bg-pdm-error text-white hover:bg-pdm-error/90 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete Vault'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Vault Dialog */}
      {disconnectingVault && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setDisconnectingVault(null)}>
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-pdm-warning/20 rounded-full">
                <Unlink size={20} className="text-pdm-warning" />
              </div>
              <h3 className="text-lg font-medium text-pdm-fg">Disconnect Vault</h3>
            </div>
            <p className="text-sm text-pdm-fg-muted mb-4">
              This will disconnect <strong>"{disconnectingVault.name}"</strong> and delete the local folder.
              Cloud files will not be affected.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDisconnectingVault(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={confirmDisconnect}
                disabled={isDisconnecting}
                className="btn bg-pdm-warning text-white hover:bg-pdm-warning/90"
              >
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite User Dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowInviteDialog(false)}>
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-pdm-fg mb-4">Invite User</h3>
            <p className="text-sm text-pdm-fg-muted mb-4">
              Copy the invite message below and send it to your team member via email or chat.
            </p>
            <div className="bg-pdm-bg border border-pdm-border rounded-lg p-4 text-sm text-pdm-fg-muted font-mono whitespace-pre-wrap max-h-60 overflow-y-auto mb-4">
              {generateInviteMessage()}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowInviteDialog(false)} className="btn btn-ghost">
                Close
              </button>
              <button onClick={handleCopyInvite} className="btn btn-primary flex items-center gap-2">
                {inviteCopied ? <Check size={14} /> : <Copy size={14} />}
                {inviteCopied ? 'Copied!' : 'Copy Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove User Dialog */}
      {removingUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setRemovingUser(null)}>
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-pdm-fg mb-4">Remove User</h3>
            <p className="text-sm text-pdm-fg-muted mb-4">
              Are you sure you want to remove <strong>{removingUser.full_name || removingUser.email}</strong> from the organization?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRemovingUser(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleRemoveUser}
                disabled={isRemoving}
                className="btn bg-pdm-error text-white hover:bg-pdm-error/90"
              >
                {isRemoving ? 'Removing...' : 'Remove User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vault Access Editor Dialog */}
      {editingVaultAccessUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setEditingVaultAccessUser(null)}>
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-pdm-fg mb-2">Vault Access</h3>
            <p className="text-sm text-pdm-fg-muted mb-4">
              Select which vaults <strong>{editingVaultAccessUser.full_name || editingVaultAccessUser.email}</strong> can access.
              Leave all unchecked for full access.
            </p>
            <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
              {orgVaults.map(vault => (
                <label key={vault.id} className="flex items-center gap-3 p-2 hover:bg-pdm-highlight rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pendingVaultAccess.includes(vault.id)}
                    onChange={() => toggleVaultAccess(vault.id)}
                    className="w-4 h-4 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent"
                  />
                  <Folder size={16} className={vault.is_default ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                  <span className="text-sm text-pdm-fg">{vault.name}</span>
                  {vault.is_default && (
                    <span className="text-xs text-pdm-accent">(default)</span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingVaultAccessUser(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleSaveVaultAccess}
                disabled={isSavingVaultAccess}
                className="btn btn-primary"
              >
                {isSavingVaultAccess ? 'Saving...' : 'Save Access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

