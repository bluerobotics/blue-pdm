import { useState, useEffect } from 'react'
import { 
  User, 
  Building2, 
  FolderCog, 
  X,
  Users,
  Mail,
  Shield,
  LogOut,
  Loader2,
  Plus,
  Folder,
  Trash2,
  Star,
  Pencil,
  Check,
  FolderOpen,
  Link,
  Unlink,
  AlertTriangle,
  Settings,
  Image,
  ExternalLink,
  Info,
  Github,
  Heart
} from 'lucide-react'
import { usePDMStore, ConnectedVault } from '../stores/pdmStore'
import { supabase, signOut } from '../lib/supabase'

type SettingsTab = 'account' | 'vault' | 'organization' | 'preferences' | 'about'

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

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { 
    user, 
    organization, 
    connectedVaults,
    addConnectedVault,
    removeConnectedVault,
    updateConnectedVault,
    setUser,
    setOrganization,
    addToast,
    triggerVaultsRefresh,
    cadPreviewMode,
    setCadPreviewMode,
    lowercaseExtensions,
    setLowercaseExtensions
  } = usePDMStore()
  
  const [activeTab, setActiveTab] = useState<SettingsTab>('account')
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
  
  // Load org users and vaults when organization tab is selected
  useEffect(() => {
    if ((activeTab === 'organization' || activeTab === 'vault') && organization) {
      loadOrgVaults()
      if (activeTab === 'organization') {
        loadOrgUsers()
      }
    }
  }, [activeTab, organization])
  
  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingVaultId) {
          setRenamingVaultId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, renamingVaultId])
  
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
      const { data, error } = await (supabase
        .from('vaults') as any)
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
  
  const handleSignOut = async () => {
    await signOut()
    setUser(null)
    setOrganization(null)
    onClose()
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
      const { data: vault, error } = await (supabase
        .from('vaults') as any)
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
      triggerVaultsRefresh() // Notify other components to refresh vault list
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
      // Update in database
      const { error } = await (supabase
        .from('vaults') as any)
        .update({ name: newName, slug: newSlug })
        .eq('id', vault.id)
      
      if (error) {
        addToast('error', `Failed to rename vault: ${error.message}`)
        return
      }
      
      // Update local connected vault if exists
      const connectedVault = connectedVaults.find(v => v.id === vault.id)
      if (connectedVault) {
        // Rename the local folder too
        const api = (window as any).electronAPI
        if (api && connectedVault.localPath) {
          const pathParts = connectedVault.localPath.split(/[/\\]/)
          pathParts[pathParts.length - 1] = newName.replace(/[<>:"/\\|?*]/g, '-')
          const newPath = pathParts.join('\\')
          
          if (newPath !== connectedVault.localPath) {
            const result = await api.renameItem(connectedVault.localPath, newPath)
            if (result.success) {
              updateConnectedVault(vault.id, { name: newName, localPath: newPath })
            } else {
              addToast('warning', `Vault renamed but folder rename failed: ${result.error}`)
            }
          } else {
            updateConnectedVault(vault.id, { name: newName })
          }
        } else {
          updateConnectedVault(vault.id, { name: newName })
        }
      }
      
      // Update local state
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
      await (supabase
        .from('vaults') as any)
        .update({ is_default: false })
        .eq('org_id', organization.id)
      
      const { error } = await (supabase
        .from('vaults') as any)
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
      // Delete local folder if connected
      const connectedVault = connectedVaults.find(v => v.id === deletingVault.id)
      if (connectedVault?.localPath) {
        const api = (window as any).electronAPI
        if (api) {
          try {
            await api.deleteItem(connectedVault.localPath)
          } catch (err) {
            console.error('Failed to delete local folder:', err)
            // Continue with database deletion even if local delete fails
          }
        }
      }
      
      const { error } = await (supabase
        .from('vaults') as any)
        .delete()
        .eq('id', deletingVault.id)
      
      if (error) {
        addToast('error', `Failed to delete vault: ${error.message}`)
        return
      }
      
      // Remove from connected vaults if connected
      if (connectedVaults.some(v => v.id === deletingVault.id)) {
        removeConnectedVault(deletingVault.id)
      }
      
      setOrgVaults(orgVaults.filter(v => v.id !== deletingVault.id))
      addToast('success', `Vault "${deletingVault.name}" permanently deleted`)
      setDeletingVault(null)
      setDeleteConfirmText('')
      triggerVaultsRefresh() // Notify other components to refresh vault list
    } catch (err) {
      console.error('Failed to delete vault:', err)
      addToast('error', 'Failed to delete vault')
    } finally {
      setIsDeleting(false)
    }
  }
  
  const openDeleteDialog = (vault: Vault) => {
    setDeletingVault(vault)
    setDeleteConfirmText('')
  }
  
  const closeDeleteDialog = () => {
    setDeletingVault(null)
    setDeleteConfirmText('')
  }
  
  const handleConnectVault = async (vault: Vault) => {
    setConnectingVaultId(vault.id)
    
    try {
      const api = (window as any).electronAPI
      if (!api) {
        addToast('error', 'Electron API not available')
        return
      }
      
      // Create vault folder in C:\BluePDM\ to avoid conflicts with other software
      const vaultPath = `C:\\BluePDM\\${vault.slug}`
      const result = await api.createWorkingDir(vaultPath)
      
      if (result.success && result.path) {
        const connectedVault: ConnectedVault = {
          id: vault.id,
          name: vault.name,
          localPath: result.path,
          isExpanded: true
        }
        addConnectedVault(connectedVault)
        addToast('success', `Connected to "${vault.name}" at ${result.path}`)
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
  
  const handleDisconnectVault = async (vaultId: string) => {
    const connectedVault = connectedVaults.find(v => v.id === vaultId)
    
    // Delete local folder
    let folderDeleted = false
    if (connectedVault?.localPath) {
      const api = window.electronAPI
      if (api) {
        try {
          const result = await api.deleteItem(connectedVault.localPath)
          if (result.success) {
            folderDeleted = true
          } else {
            console.error('Failed to delete local folder:', result.error)
            addToast('warning', `Could not delete local folder: ${result.error}`)
          }
        } catch (err) {
          console.error('Failed to delete local folder:', err)
          addToast('warning', `Could not delete local folder: ${err}`)
        }
      }
    }
    
    removeConnectedVault(vaultId)
    if (folderDeleted) {
      addToast('success', 'Vault disconnected and local folder moved to Recycle Bin')
    } else {
      addToast('info', 'Vault disconnected (local folder may still exist)')
    }
  }
  
  const isVaultConnected = (vaultId: string) => {
    return connectedVaults.some(v => v.id === vaultId)
  }
  
  const getConnectedPath = (vaultId: string) => {
    return connectedVaults.find(v => v.id === vaultId)?.localPath
  }
  
  const tabs = [
    { id: 'account' as SettingsTab, icon: User, label: 'Account' },
    { id: 'vault' as SettingsTab, icon: FolderCog, label: 'Local Vaults' },
    { id: 'organization' as SettingsTab, icon: Building2, label: 'Organization' },
    { id: 'preferences' as SettingsTab, icon: Settings, label: 'Preferences' },
    { id: 'about' as SettingsTab, icon: Info, label: 'About' },
  ]

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div 
        className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl w-[700px] max-h-[85vh] flex overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-48 bg-pdm-sidebar border-r border-pdm-border flex flex-col">
          <div className="p-4 border-b border-pdm-border">
            <h2 className="text-sm font-semibold text-pdm-fg">Settings</h2>
          </div>
          <div className="flex-1 py-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-pdm-highlight text-pdm-fg border-l-2 border-pdm-accent'
                    : 'text-pdm-fg-muted hover:text-pdm-fg hover:bg-pdm-highlight/50 border-l-2 border-transparent'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-pdm-border">
            <h3 className="text-lg font-medium text-pdm-fg">
              {tabs.find(t => t.id === activeTab)?.label}
            </h3>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-pdm-highlight rounded transition-colors"
            >
              <X size={18} className="text-pdm-fg-muted" />
            </button>
          </div>
          
          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'account' && (
              <div className="space-y-6">
                {user ? (
                  <>
                    <div className="flex items-center gap-4 p-4 bg-pdm-bg rounded-lg border border-pdm-border">
                      {user.avatar_url ? (
                        <img 
                          src={user.avatar_url} 
                          alt={user.full_name || user.email}
                          className="w-16 h-16 rounded-full"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-pdm-accent flex items-center justify-center text-2xl text-white font-semibold">
                          {(user.full_name || user.email)[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-medium text-pdm-fg truncate">
                          {user.full_name || 'No name'}
                        </div>
                        <div className="text-sm text-pdm-fg-muted truncate flex items-center gap-2">
                          <Mail size={14} />
                          {user.email}
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-pdm-error hover:bg-pdm-error/10 rounded-lg transition-colors"
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </>
                ) : (
                  <div className="text-center py-12 text-pdm-fg-muted">
                    Not signed in
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'vault' && (
              <div className="space-y-6">
                {organization ? (
                  <>
                    <p className="text-sm text-pdm-fg-muted">
                      Select which organization vaults to connect locally. Each vault will create a folder on your computer.
                    </p>
                    
                    {isLoadingVaults ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
                      </div>
                    ) : orgVaults.length === 0 ? (
                      <div className="text-center py-8 text-pdm-fg-muted text-sm">
                        No vaults available. Create one in Organization settings.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {orgVaults.map(vault => {
                          const connected = isVaultConnected(vault.id)
                          const localPath = getConnectedPath(vault.id)
                          const isConnecting = connectingVaultId === vault.id
                          
                          return (
                            <div 
                              key={vault.id}
                              className={`p-4 rounded-lg border transition-colors ${
                                connected 
                                  ? 'bg-pdm-accent/10 border-pdm-accent' 
                                  : 'bg-pdm-bg border-pdm-border hover:border-pdm-border-light'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <FolderOpen size={20} className={connected ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-pdm-fg truncate">
                                      {vault.name}
                                    </span>
                                    {vault.is_default && (
                                      <span className="px-1.5 py-0.5 bg-pdm-accent/20 text-pdm-accent text-xs rounded">
                                        Default
                                      </span>
                                    )}
                                    {connected && (
                                      <Check size={14} className="text-pdm-success" />
                                    )}
                                  </div>
                                  {vault.description && (
                                    <div className="text-xs text-pdm-fg-muted truncate">
                                      {vault.description}
                                    </div>
                                  )}
                                  {localPath && (
                                    <div className="text-xs text-pdm-fg-dim font-mono mt-1">
                                      {localPath}
                                    </div>
                                  )}
                                </div>
                                
                                {connected ? (
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
                                    disabled={isConnecting}
                                    className="btn btn-primary btn-sm flex items-center gap-1"
                                  >
                                    {isConnecting ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Link size={14} />
                                    )}
                                    Connect
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    
                    {connectedVaults.length > 0 && (
                      <div className="pt-4 border-t border-pdm-border">
                        <div className="text-xs text-pdm-fg-muted">
                          {connectedVaults.length} vault{connectedVaults.length > 1 ? 's' : ''} connected
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-pdm-fg-muted">
                    Sign in to an organization to manage vaults
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'organization' && (
              <div className="space-y-6">
                {organization ? (
                  <>
                    {/* Org info */}
                    <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
                      <div className="flex items-center gap-3 mb-2">
                        <Building2 size={20} className="text-pdm-accent" />
                        <span className="text-lg font-medium text-pdm-fg">{organization.name}</span>
                      </div>
                      <div className="text-sm text-pdm-fg-muted">
                        Email domains: {organization.email_domains?.join(', ')}
                      </div>
                    </div>
                    
                    {/* Vaults */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
                          <Folder size={14} />
                          Vaults ({orgVaults.length})
                        </div>
                        <button
                          onClick={() => setIsCreatingVault(true)}
                          className="btn btn-primary btn-sm flex items-center gap-1"
                        >
                          <Plus size={14} />
                          Add Vault
                        </button>
                      </div>
                      
                      {isCreatingVault && (
                        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-accent space-y-3">
                          <div className="space-y-2">
                            <label className="text-xs text-pdm-fg-muted">Vault Name</label>
                            <input
                              type="text"
                              value={newVaultName}
                              onChange={(e) => setNewVaultName(e.target.value)}
                              placeholder="e.g., Main Vault, Archive, Projects"
                              className="w-full bg-pdm-bg-light border border-pdm-border rounded px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
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
                              className="w-full bg-pdm-bg-light border border-pdm-border rounded px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
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
                      
                      {isLoadingVaults ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
                        </div>
                      ) : orgVaults.length === 0 ? (
                        <div className="text-center py-8 text-pdm-fg-muted text-sm">
                          No vaults created yet. Add a vault to get started.
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
                                    <button
                                      onClick={() => handleRenameVault(vault)}
                                      className="p-1 hover:bg-pdm-highlight rounded"
                                    >
                                      <Check size={14} className="text-pdm-success" />
                                    </button>
                                    <button
                                      onClick={() => setRenamingVaultId(null)}
                                      className="p-1 hover:bg-pdm-highlight rounded"
                                    >
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
                                <div className="flex items-center gap-1">
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
                                    onClick={() => openDeleteDialog(vault)}
                                    className="p-1.5 hover:bg-pdm-error/20 rounded transition-colors"
                                    title="Delete vault"
                                  >
                                    <Trash2 size={14} className="text-pdm-error" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Users */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
                        <Users size={14} />
                        Members ({orgUsers.length})
                      </div>
                      
                      {isLoadingUsers ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {orgUsers.map(orgUser => (
                            <div 
                              key={orgUser.id}
                              className="flex items-center gap-3 p-3 rounded-lg hover:bg-pdm-highlight transition-colors"
                            >
                              {orgUser.avatar_url ? (
                                <img 
                                  src={orgUser.avatar_url} 
                                  alt={orgUser.full_name || orgUser.email}
                                  className="w-10 h-10 rounded-full"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-pdm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                                  {(orgUser.full_name || orgUser.email)[0].toUpperCase()}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-pdm-fg truncate">
                                  {orgUser.full_name || orgUser.email}
                                </div>
                                <div className="text-xs text-pdm-fg-muted truncate">
                                  {orgUser.email}
                                </div>
                              </div>
                              {orgUser.role === 'admin' && (
                                <div className="flex items-center gap-1 px-2 py-1 bg-pdm-accent/20 rounded text-xs text-pdm-accent">
                                  <Shield size={12} />
                                  Admin
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-pdm-fg-muted">
                    No organization connected
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'preferences' && (
              <div className="space-y-6">
                {/* CAD Preview Mode */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-pdm-fg">SolidWorks Preview</h3>
                  <p className="text-sm text-pdm-fg-muted">
                    Choose how to preview SolidWorks files (.sldprt, .sldasm, .slddrw)
                  </p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setCadPreviewMode('thumbnail')}
                      className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                        cadPreviewMode === 'thumbnail'
                          ? 'bg-pdm-accent/10 border-pdm-accent'
                          : 'bg-pdm-bg border-pdm-border hover:border-pdm-fg-muted'
                      }`}
                    >
                      <Image size={24} className={cadPreviewMode === 'thumbnail' ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                      <div className="text-left flex-1">
                        <div className={`text-sm font-medium ${cadPreviewMode === 'thumbnail' ? 'text-pdm-fg' : 'text-pdm-fg-muted'}`}>
                          Embedded Thumbnail
                        </div>
                        <div className="text-xs text-pdm-fg-dim">
                          Extract and display the preview image stored inside SolidWorks files
                        </div>
                      </div>
                      {cadPreviewMode === 'thumbnail' && (
                        <Check size={20} className="text-pdm-accent" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => setCadPreviewMode('edrawings')}
                      className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                        cadPreviewMode === 'edrawings'
                          ? 'bg-pdm-accent/10 border-pdm-accent'
                          : 'bg-pdm-bg border-pdm-border hover:border-pdm-fg-muted'
                      }`}
                    >
                      <ExternalLink size={24} className={cadPreviewMode === 'edrawings' ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                      <div className="text-left flex-1">
                        <div className={`text-sm font-medium ${cadPreviewMode === 'edrawings' ? 'text-pdm-fg' : 'text-pdm-fg-muted'}`}>
                          eDrawings (External)
                        </div>
                        <div className="text-xs text-pdm-fg-dim">
                          Open files directly in the eDrawings application for full 3D interaction
                        </div>
                      </div>
                      {cadPreviewMode === 'edrawings' && (
                        <Check size={20} className="text-pdm-accent" />
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Display Settings */}
                <div className="space-y-3 pt-4 border-t border-pdm-border">
                  <h3 className="text-sm font-semibold text-pdm-fg">Display</h3>
                  <label className="flex items-center justify-between p-3 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-fg-muted transition-colors cursor-pointer">
                    <div>
                      <div className="text-sm font-medium text-pdm-fg">Lowercase Extensions</div>
                      <div className="text-xs text-pdm-fg-dim">
                        Display file extensions in lowercase (e.g., .sldprt instead of .SLDPRT)
                      </div>
                    </div>
                    <button
                      onClick={() => setLowercaseExtensions(!lowercaseExtensions)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        lowercaseExtensions ? 'bg-pdm-accent' : 'bg-pdm-border'
                      }`}
                    >
                      <span 
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                          lowercaseExtensions ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>
            )}
            
            {activeTab === 'about' && (
              <div className="space-y-6">
                {/* App Info */}
                <div className="text-center py-6">
                  <div className="flex justify-center items-center gap-3 mb-4">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-pdm-accent">
                      <path 
                        d="M12 2L2 7L12 12L22 7L12 2Z" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                      <path 
                        d="M2 17L12 22L22 17" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                      <path 
                        d="M2 12L12 17L22 12" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                    </svg>
                    <h1 className="text-2xl font-bold text-pdm-fg">BluePDM</h1>
                  </div>
                  <p className="text-pdm-fg-dim mb-2">
                    Open source Product Data Management for engineering teams
                  </p>
                  <p className="text-sm text-pdm-fg-muted">
                    Version 0.7.1
                  </p>
                </div>
                
                {/* Links */}
                <div className="space-y-2">
                  <a
                    href="https://github.com/bluerobotics/blue-pdm"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.electronAPI?.openFile('https://github.com/bluerobotics/blue-pdm')
                    }}
                    className="flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors cursor-pointer"
                  >
                    <Github size={20} className="text-pdm-fg-muted" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-pdm-fg">GitHub Repository</div>
                      <div className="text-xs text-pdm-fg-dim">
                        View source code, report issues, contribute
                      </div>
                    </div>
                    <ExternalLink size={16} className="text-pdm-fg-muted" />
                  </a>
                  
                  <a
                    href="https://bluerobotics.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.electronAPI?.openFile('https://bluerobotics.com')
                    }}
                    className="flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors cursor-pointer"
                  >
                    <Heart size={20} className="text-pdm-accent" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-pdm-fg">Blue Robotics</div>
                      <div className="text-xs text-pdm-fg-dim">
                        Making robotics accessible for everyone
                      </div>
                    </div>
                    <ExternalLink size={16} className="text-pdm-fg-muted" />
                  </a>
                </div>
                
                {/* License */}
                <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
                  <div className="text-xs text-pdm-fg-muted text-center">
                    Released under the MIT License
                  </div>
                </div>
                
                {/* Footer */}
                <div className="text-center text-sm text-pdm-fg-muted">
                  Made with 💙 by Blue Robotics
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Delete Vault Confirmation Dialog */}
      {deletingVault && (
        <div 
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center"
          onClick={closeDeleteDialog}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-error/50 rounded-xl shadow-2xl w-[480px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-error/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-error/20 rounded-full">
                  <AlertTriangle size={24} className="text-pdm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Delete Vault</h3>
                  <p className="text-sm text-pdm-fg-muted">This action cannot be undone</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="p-4 bg-pdm-error/10 border border-pdm-error/30 rounded-lg">
                <p className="text-sm text-pdm-fg mb-2">
                  <strong>Warning:</strong> Deleting this vault will permanently remove:
                </p>
                <ul className="text-sm text-pdm-fg-dim list-disc list-inside space-y-1">
                  <li>All files stored in this vault on the server</li>
                  <li>All version history and metadata</li>
                  <li>All checkout locks and activity history</li>
                </ul>
              </div>
              
              <div>
                <p className="text-sm text-pdm-fg mb-2">
                  To confirm, type <strong className="text-pdm-error font-mono">{deletingVault.name}</strong> below:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deletingVault.name}
                  className="w-full bg-pdm-bg border border-pdm-border rounded px-3 py-2 text-sm focus:border-pdm-error focus:outline-none font-mono"
                  autoFocus
                />
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={closeDeleteDialog}
                className="btn btn-ghost"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteVault}
                disabled={deleteConfirmText !== deletingVault.name || isDeleting}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete Vault Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
