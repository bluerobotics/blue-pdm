// @ts-nocheck - Supabase type inference issues with Database generics
import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  UserPlus,
  Users,
  Shield,
  Database,
  Mail,
  Loader2,
  UserCheck
} from 'lucide-react'
import { usePDMStore } from '../../../stores/pdmStore'
import { supabase } from '../../../lib/supabase'
import { copyToClipboard } from '../../../lib/clipboard'
import type { TeamWithDetails, WorkflowRoleBasic } from './types'

interface CreateUserDialogProps {
  onClose: () => void
  onCreated: () => void
  teams: TeamWithDetails[]
  orgId: string
  currentUserId?: string
  currentUserName?: string
  orgName?: string
  vaults: { id: string; name: string; description?: string | null }[]
  workflowRoles: WorkflowRoleBasic[]
  apiUrl?: string | null
  orgCode?: string
}

export function CreateUserDialog({
  onClose,
  onCreated,
  teams,
  orgId,
  currentUserId,
  currentUserName,
  orgName,
  vaults,
  workflowRoles,
  apiUrl,
  orgCode
}: CreateUserDialogProps) {
  const { addToast } = usePDMStore()
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([])
  const [selectedWorkflowRoleIds, setSelectedWorkflowRoleIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [sendInviteEmail, setSendInviteEmail] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  
  const handleCreate = async () => {
    if (!email || !isValidEmail || !currentUserId) return
    
    setIsSaving(true)
    try {
      // If we have API URL and want to send invite, use API endpoint
      if (sendInviteEmail && apiUrl) {
        // Get current session token
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          addToast('error', 'Session expired, please log in again')
          return
        }
        
        const response = await fetch(`${apiUrl}/auth/invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            full_name: fullName.trim() || undefined,
            team_ids: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
            vault_ids: selectedVaultIds.length > 0 ? selectedVaultIds : undefined,
            workflow_role_ids: selectedWorkflowRoleIds.length > 0 ? selectedWorkflowRoleIds : undefined,
            notes: notes.trim() || undefined
          })
        })
        
        const result = await response.json()
        
        if (!response.ok) {
          if (response.status === 409) {
            addToast('error', 'A user with this email already exists or is pending')
          } else {
            throw new Error(result.message || 'Failed to invite user')
          }
          return
        }
        
        // If user already has an account, copy org code to clipboard
        if (result.existing_user && result.org_code) {
          await copyToClipboard(result.org_code)
          addToast('success', `${result.message} (copied to clipboard)`)
        } else {
          addToast('success', result.message || `Invite sent to ${email}`)
        }
        onCreated()
        onClose()
        return
      }
      
      // Otherwise just create pending member without email
      const normalizedEmail = email.toLowerCase().trim()
      
      // First check if user is already in the org
      const { data: existingUsers } = await supabase
        .from('users')
        .select('id, org_id')
        .ilike('email', normalizedEmail)
      
      const existingUser = existingUsers?.[0]
      if (existingUser?.org_id === orgId) {
        addToast('error', 'This user is already a member of your organization')
        return
      }
      
      // Delete any existing pending record for this email (in case of re-invite)
      await supabase
        .from('pending_org_members')
        .delete()
        .eq('org_id', orgId)
        .ilike('email', normalizedEmail)
      
      const { error } = await supabase
        .from('pending_org_members')
        .insert({
          org_id: orgId,
          email: normalizedEmail,
          full_name: fullName.trim() || null,
          role: 'viewer',  // Default role, permissions come from teams
          team_ids: selectedTeamIds,
          vault_ids: selectedVaultIds,
          workflow_role_ids: selectedWorkflowRoleIds,
          notes: notes.trim() || null,
          created_by: currentUserId
        })
      
      if (error) {
        if (error.code === '23505') {
          addToast('error', 'A user with this email already exists or is pending')
        } else {
          throw error
        }
        return
      }
      
      addToast('success', `Created pending account for ${email}. They will be set up automatically when they sign in.`)
      onCreated()
      onClose()
    } catch (err) {
      console.error('Failed to create pending user:', err)
      addToast('error', 'Failed to create user account')
    } finally {
      setIsSaving(false)
    }
  }
  
  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds(current =>
      current.includes(teamId)
        ? current.filter(id => id !== teamId)
        : [...current, teamId]
    )
  }
  
  const toggleVault = (vaultId: string) => {
    setSelectedVaultIds(current =>
      current.includes(vaultId)
        ? current.filter(id => id !== vaultId)
        : [...current, vaultId]
    )
  }
  
  const toggleWorkflowRole = (roleId: string) => {
    setSelectedWorkflowRoleIds(current =>
      current.includes(roleId)
        ? current.filter(id => id !== roleId)
        : [...current, roleId]
    )
  }
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-6">
          <div className="p-2 rounded-lg bg-plm-accent/20 text-plm-accent">
            <UserPlus size={20} />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Add User</h3>
            <p className="text-sm text-plm-fg-muted mt-1">
              Pre-create an account. When they sign in with this email, they'll automatically join with these settings.
            </p>
          </div>
        </div>
        
        <div className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Email Address *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
            {email && !isValidEmail && (
              <p className="text-xs text-plm-error mt-1">Please enter a valid email address</p>
            )}
          </div>
          
          {/* Full Name */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="John Smith"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
          
          {/* Teams */}
          {teams.length > 0 && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Assign to Teams</label>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg p-2">
                {teams.map(team => {
                  const TeamIcon = (LucideIcons as any)[team.icon] || Users
                  const isSelected = selectedTeamIds.includes(team.id)
                  return (
                    <label
                      key={team.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTeam(team.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                      />
                      <div
                        className="p-1.5 rounded"
                        style={{ backgroundColor: `${team.color}15`, color: team.color }}
                      >
                        <TeamIcon size={14} />
                      </div>
                      <span className="text-sm text-plm-fg">{team.name}</span>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-plm-fg-dim mt-1">
                User will be added to selected teams when they first sign in
              </p>
            </div>
          )}
          
          {/* Vault Access */}
          {vaults.length > 0 && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Vault Access</label>
              <div className={`p-3 rounded-lg border mb-2 ${
                selectedVaultIds.length === 0
                  ? 'bg-plm-success/10 border-plm-success/30'
                  : 'bg-plm-warning/10 border-plm-warning/30'
              }`}>
                <div className="flex items-center gap-2">
                  <Database size={16} className={selectedVaultIds.length === 0 ? 'text-plm-success' : 'text-plm-warning'} />
                  <span className={`text-sm ${selectedVaultIds.length === 0 ? 'text-plm-success' : 'text-plm-warning'}`}>
                    {selectedVaultIds.length === 0 
                      ? 'All vaults (no restrictions)' 
                      : `Restricted to ${selectedVaultIds.length} of ${vaults.length} vaults`}
                  </span>
                </div>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg p-2">
                {vaults.map(vault => {
                  const isSelected = selectedVaultIds.includes(vault.id)
                  return (
                    <label
                      key={vault.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleVault(vault.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                      />
                      <Database size={14} className="text-plm-fg-muted" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-plm-fg">{vault.name}</span>
                        {vault.description && (
                          <span className="text-xs text-plm-fg-dim ml-2">{vault.description}</span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-plm-fg-dim mt-1">
                Leave all unchecked for full access. Check specific vaults to restrict access.
              </p>
            </div>
          )}
          
          {/* Workflow Roles */}
          {workflowRoles.length > 0 && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Workflow Roles</label>
              <div className="space-y-1 max-h-40 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg p-2">
                {workflowRoles.map(role => {
                  const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                  const isSelected = selectedWorkflowRoleIds.includes(role.id)
                  return (
                    <label
                      key={role.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleWorkflowRole(role.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                      />
                      <div
                        className="p-1.5 rounded"
                        style={{ backgroundColor: `${role.color}15`, color: role.color }}
                      >
                        <RoleIcon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-plm-fg">{role.name}</span>
                        {role.description && (
                          <span className="text-xs text-plm-fg-dim ml-2">{role.description}</span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-plm-fg-dim mt-1">
                Workflow roles for approval processes (e.g., R&D Approver, QA Reviewer)
              </p>
            </div>
          )}
          
          {/* Send Invite Email */}
          <div className="pt-2 border-t border-plm-border">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendInviteEmail}
                  onChange={e => setSendInviteEmail(e.target.checked)}
                  disabled={!apiUrl}
                  className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <Mail size={16} className={sendInviteEmail && apiUrl ? 'text-plm-accent' : 'text-plm-fg-muted'} />
                  <span className={`text-sm ${sendInviteEmail && apiUrl ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
                    Send invite email
                  </span>
                </div>
              </label>
              {apiUrl && sendInviteEmail && (
                <button
                  type="button"
                  onClick={() => setShowEmailPreview(!showEmailPreview)}
                  className="text-xs text-plm-accent hover:text-plm-accent/80 transition-colors"
                >
                  {showEmailPreview ? 'Hide preview' : 'Preview email'}
                </button>
              )}
            </div>
            {!apiUrl && (
              <p className="text-xs text-plm-fg-dim mt-1.5 ml-7">
                Configure API URL in Settings → REST API to enable invite emails
              </p>
            )}
            
            {/* Email Preview */}
            {apiUrl && sendInviteEmail && showEmailPreview && (
              <div className="mt-3 ml-7 p-4 bg-white border border-plm-border rounded-lg text-sm">
                <div className="text-gray-500 text-xs mb-3 pb-2 border-b border-gray-200">
                  <div><strong>To:</strong> {email || 'user@example.com'}</div>
                  <div><strong>From:</strong> BluePLM &lt;noreply@blueplm.app&gt;</div>
                  <div><strong>Subject:</strong> You've been invited to {orgName || 'an organization'}</div>
                </div>
                <div className="text-gray-800 space-y-3">
                  <p>Hi{fullName ? ` ${fullName}` : ''},</p>
                  <p>
                    <strong>{currentUserName || 'A team member'}</strong> has invited you to join{' '}
                    <strong>{orgName || 'their organization'}</strong> on BluePLM.
                  </p>
                  <p>BluePLM is a Product Data Management system for engineering teams.</p>
                  <div className="my-4">
                    <span className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
                      Accept Invitation
                    </span>
                  </div>
                  {orgCode && (
                    <div className="my-4 p-3 bg-gray-100 rounded-lg">
                      <p className="text-gray-600 text-xs mb-1">Organization Code:</p>
                      <code className="text-sm font-mono text-gray-800 break-all">{orgCode}</code>
                    </div>
                  )}
                  <p className="text-gray-500 text-xs">
                    If you didn't expect this invitation, you can ignore this email.
                  </p>
                </div>
              </div>
            )}
          </div>
          
          {/* Notes */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes about this user..."
              rows={2}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent resize-none"
            />
          </div>
        </div>
        
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={isSaving || !email || !isValidEmail}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
            {isSaving ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}
