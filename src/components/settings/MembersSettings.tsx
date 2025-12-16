// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect } from 'react'
import { 
  Users, 
  Mail, 
  Shield, 
  Loader2, 
  Check, 
  Copy,
  ChevronDown,
  Wrench,
  Eye,
  Lock,
  UserMinus,
  Folder,
  RefreshCw,
  Key,
  AlertTriangle,
  ExternalLink
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase, getCurrentConfig, updateUserRole, removeUserFromOrg, getOrgVaultAccess, setUserVaultAccess } from '../../lib/supabase'
import { generateOrgCode } from '../../lib/supabaseConfig'
import { getInitials } from '../../types/pdm'
import { UserProfileModal } from './UserProfileModal'

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

export function MembersSettings() {
  const { 
    user, 
    organization, 
    addToast,
    getEffectiveRole
  } = usePDMStore()
  
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [orgVaults, setOrgVaults] = useState<Vault[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  
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
  
  // User profile modal
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)
  
  // Org code state
  const [showOrgCode, setShowOrgCode] = useState(false)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)
  const [regenerateConfirm1, setRegenerateConfirm1] = useState('')
  const [regenerateConfirm2, setRegenerateConfirm2] = useState('')
  
  // Load data on mount
  useEffect(() => {
    if (organization) {
      loadOrgUsers()
      loadOrgVaults()
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
  
  // User management
  const generateInviteMessage = () => {
    const config = getCurrentConfig()
    if (!config || !organization) return ''
    
    const code = generateOrgCode(config)
    return `You've been invited to join ${organization.name} on BluePLM!

BluePLM is a Product Lifecycle Management tool for everyone who builds.

To get started:
1. Download BluePLM from: https://github.com/bluerobotics/bluePLM/releases
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
      <div className="text-center py-12 text-plm-fg-muted text-base">
        No organization connected
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-plm-fg">Members</h2>
          <p className="text-sm text-plm-fg-muted mt-1">
            Manage members in your organization
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadOrgUsers}
            disabled={isLoadingUsers}
            className="btn btn-ghost btn-sm flex items-center gap-1"
            title="Refresh members"
          >
            <RefreshCw size={14} className={isLoadingUsers ? 'animate-spin' : ''} />
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowInviteDialog(true)}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Mail size={14} />
              Invite User
            </button>
          )}
        </div>
      </div>

      {/* Organization Code (Admin only) */}
      {isAdmin && (
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          <div className="flex items-center gap-2 mb-3">
            <Key size={18} className="text-plm-accent" />
            <h3 className="text-base font-medium text-plm-fg">Organization Code</h3>
          </div>
          
          <p className="text-sm text-plm-fg-muted mb-3">
            Share this code with team members so they can connect to your organization.
          </p>
          
          {showOrgCode && orgCode ? (
            <div className="space-y-3">
              <div className="relative">
                <div className="font-mono text-sm bg-plm-bg-secondary border border-plm-border rounded-lg p-3 pr-12 break-all text-plm-fg max-h-24 overflow-y-auto">
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
                  className="absolute top-2 right-2 p-1.5 hover:bg-plm-highlight rounded transition-colors"
                  title="Copy to clipboard"
                >
                  {codeCopied ? (
                    <Check size={16} className="text-green-500" />
                  ) : (
                    <Copy size={16} className="text-plm-fg-muted" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOrgCode(false)}
                  className="text-sm text-plm-fg-muted hover:text-plm-fg"
                >
                  Hide Code
                </button>
                <span className="text-plm-fg-dim">•</span>
                <button
                  onClick={() => setShowRegenerateDialog(true)}
                  className="text-sm text-plm-warning hover:text-plm-warning/80 flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  Regenerate Code
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const config = getCurrentConfig()
                  if (config) {
                    const code = generateOrgCode(config)
                    setOrgCode(code)
                    setShowOrgCode(true)
                  }
                }}
                className="btn btn-primary btn-sm flex items-center gap-2"
              >
                <Key size={14} />
                Show Organization Code
              </button>
              <button
                onClick={() => setShowRegenerateDialog(true)}
                className="btn btn-ghost btn-sm flex items-center gap-1 text-plm-warning"
              >
                <RefreshCw size={14} />
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
      
      {isLoadingUsers ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-plm-fg-muted" size={24} />
        </div>
      ) : (
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {orgUsers.map(orgUser => {
            const RoleIcon = getRoleIcon(orgUser.role)
            const isCurrentUser = orgUser.id === user?.id
            const canManage = isAdmin && !isCurrentUser
            
            return (
              <div 
                key={orgUser.id}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-plm-highlight transition-colors group"
              >
                {/* Clickable avatar and name to open profile */}
                <button
                  onClick={() => setViewingUserId(orgUser.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
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
                    <div className="w-10 h-10 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                      {getInitials(orgUser.full_name || orgUser.email)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-base text-plm-fg truncate flex items-center gap-2">
                      {orgUser.full_name || orgUser.email}
                      {isCurrentUser && (
                        <span className="text-sm text-plm-fg-dim">(you)</span>
                      )}
                    </div>
                    <div className="text-sm text-plm-fg-muted truncate flex items-center gap-2">
                      {orgUser.email}
                      {orgUser.role !== 'admin' && getUserVaultAccessCount(orgUser.id) > 0 && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-plm-fg-muted/10 rounded text-plm-fg-dim">
                          <Lock size={12} />
                          {getUserVaultAccessCount(orgUser.id)} vault{getUserVaultAccessCount(orgUser.id) !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                
                {/* Role badge / dropdown */}
                <div className="relative">
                  {canManage ? (
                    <>
                      <button
                        onClick={() => setRoleDropdownOpen(roleDropdownOpen === orgUser.id ? null : orgUser.id)}
                        disabled={changingRoleUserId === orgUser.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
                          orgUser.role === 'admin' ? 'bg-plm-accent/20 text-plm-accent' :
                          orgUser.role === 'engineer' ? 'bg-plm-success/20 text-plm-success' :
                          'bg-plm-fg-muted/20 text-plm-fg-muted'
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
                        <div className="absolute right-0 top-full mt-1 z-50 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[140px]">
                          {(['viewer', 'engineer', 'admin'] as const).map(role => (
                            <button
                              key={role}
                              onClick={() => handleChangeRole(orgUser, role)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-base text-left transition-colors hover:bg-plm-highlight ${
                                orgUser.role === role ? 'text-plm-accent' : 'text-plm-fg'
                              }`}
                            >
                              {role === 'admin' && <Shield size={16} />}
                              {role === 'engineer' && <Wrench size={16} />}
                              {role === 'viewer' && <Eye size={16} />}
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                              {orgUser.role === role && <Check size={16} className="ml-auto" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm ${
                      orgUser.role === 'admin' ? 'bg-plm-accent/20 text-plm-accent' :
                      orgUser.role === 'engineer' ? 'bg-plm-success/20 text-plm-success' :
                      'bg-plm-fg-muted/20 text-plm-fg-muted'
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
                    className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Manage vault access"
                  >
                    <Lock size={16} />
                  </button>
                )}
                
                {/* Remove button */}
                {canManage && (
                  <button
                    onClick={() => setRemovingUser(orgUser)}
                    className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove from organization"
                  >
                    <UserMinus size={16} />
                  </button>
                )}
              </div>
            )
          })}
          
          {/* User Profile Modal */}
          {viewingUserId && (
            <UserProfileModal
              userId={viewingUserId}
              onClose={() => setViewingUserId(null)}
            />
          )}
        </div>
      )}
      
      {/* Role permissions info */}
      {isAdmin && (
        <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
          <p className="text-sm text-plm-fg-muted mb-2 font-medium">Role Permissions:</p>
          <div className="space-y-1 text-sm text-plm-fg-dim">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-plm-accent" />
              <span><strong>Admin:</strong> Full access, manage users & vaults</span>
            </div>
            <div className="flex items-center gap-2">
              <Wrench size={14} className="text-plm-success" />
              <span><strong>Engineer:</strong> Check out, check in, modify files</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye size={14} className="text-plm-fg-muted" />
              <span><strong>Viewer:</strong> View and download files only</span>
            </div>
          </div>
        </div>
      )}

      {/* Invite User Dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowInviteDialog(false)}>
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Invite User</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Copy the invite message below and send it to your team member via email or chat.
            </p>
            <div className="bg-plm-bg border border-plm-border rounded-lg p-4 text-base text-plm-fg-muted font-mono whitespace-pre-wrap max-h-60 overflow-y-auto mb-4">
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
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-4">Remove User</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Are you sure you want to remove <strong>{removingUser.full_name || removingUser.email}</strong> from the organization?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRemovingUser(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleRemoveUser}
                disabled={isRemoving}
                className="btn bg-plm-error text-white hover:bg-plm-error/90"
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
          <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-plm-fg mb-2">Vault Access</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Select which vaults <strong>{editingVaultAccessUser.full_name || editingVaultAccessUser.email}</strong> can access.
              Leave all unchecked for full access.
            </p>
            <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
              {orgVaults.map(vault => (
                <label key={vault.id} className="flex items-center gap-3 p-2 hover:bg-plm-highlight rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pendingVaultAccess.includes(vault.id)}
                    onChange={() => toggleVaultAccess(vault.id)}
                    className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <Folder size={18} className={vault.is_default ? 'text-plm-accent' : 'text-plm-fg-muted'} />
                  <span className="text-base text-plm-fg">{vault.name}</span>
                  {vault.is_default && (
                    <span className="text-sm text-plm-accent">(default)</span>
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

      {/* Regenerate Organization Code Dialog */}
      {showRegenerateDialog && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => {
            setShowRegenerateDialog(false)
            setRegenerateConfirm1('')
            setRegenerateConfirm2('')
          }}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl max-w-lg w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-full bg-plm-error/20">
                <AlertTriangle className="w-5 h-5 text-plm-error" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-plm-fg">Regenerate Organization Code</h3>
                <p className="text-sm text-plm-fg-muted mt-1">
                  This is a destructive action
                </p>
              </div>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="p-3 bg-plm-warning/10 border border-plm-warning/30 rounded-lg">
                <p className="text-sm text-plm-fg font-medium mb-2">⚠️ Warning: This will affect ALL users</p>
                <ul className="text-sm text-plm-fg-muted list-disc list-inside space-y-1">
                  <li>All existing organization codes will become invalid</li>
                  <li>All team members will be disconnected from the organization</li>
                  <li>Everyone will need the new code to reconnect</li>
                  <li>This action cannot be undone</li>
                </ul>
              </div>
              
              <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                <p className="text-sm text-plm-fg font-medium mb-2">How to regenerate:</p>
                <ol className="text-sm text-plm-fg-muted list-decimal list-inside space-y-1">
                  <li>Go to your Supabase Dashboard</li>
                  <li>Navigate to Project Settings → API</li>
                  <li>Click "Regenerate" next to the anon/public key</li>
                  <li>Update your BluePLM configuration with the new key</li>
                  <li>Share the new organization code with your team</li>
                </ol>
                <a 
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-sm text-plm-accent hover:underline"
                >
                  Open Supabase Dashboard
                  <ExternalLink size={12} />
                </a>
              </div>
              
              <div>
                <p className="text-sm text-plm-fg-muted mb-2">
                  To confirm you understand, type <strong className="text-plm-fg">REGENERATE</strong> twice:
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={regenerateConfirm1}
                    onChange={(e) => setRegenerateConfirm1(e.target.value)}
                    placeholder="Type REGENERATE"
                    className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-warning"
                  />
                  <input
                    type="text"
                    value={regenerateConfirm2}
                    onChange={(e) => setRegenerateConfirm2(e.target.value)}
                    placeholder="Type REGENERATE again"
                    className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-warning"
                  />
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowRegenerateDialog(false)
                  setRegenerateConfirm1('')
                  setRegenerateConfirm2('')
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className={`btn flex items-center gap-2 ${
                  regenerateConfirm1 === 'REGENERATE' && regenerateConfirm2 === 'REGENERATE'
                    ? 'bg-plm-warning hover:bg-plm-warning/80 text-white'
                    : 'bg-plm-fg-muted/20 text-plm-fg-muted cursor-not-allowed pointer-events-none'
                }`}
                onClick={(e) => {
                  if (regenerateConfirm1 !== 'REGENERATE' || regenerateConfirm2 !== 'REGENERATE') {
                    e.preventDefault()
                  }
                }}
              >
                <ExternalLink size={16} />
                Go to Supabase Dashboard
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

