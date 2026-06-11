/**
 * EditPendingMemberDialog - Edit pre-registered pending member details
 *
 * Allows admins to edit a pending member's name, teams, workflow roles,
 * and vault access before they sign in.
 *
 * @module team-members/EditPendingMemberDialog
 */

import { Pencil, X, Loader2, Check, Folder, Database } from 'lucide-react'
import { getRoleIcon, getTeamIcon } from '../../utils'
import type {
  PendingMember,
  PendingMemberFormData,
  TeamWithDetails,
  WorkflowRoleBasic,
  Vault,
} from '../../types'

export interface EditPendingMemberDialogProps {
  pendingMember: PendingMember
  pendingMemberForm: PendingMemberFormData
  setPendingMemberForm: (fn: (prev: PendingMemberFormData) => PendingMemberFormData) => void
  teams: TeamWithDetails[]
  workflowRoles: WorkflowRoleBasic[]
  orgVaults: Vault[]
  onSave: () => Promise<void>
  onClose: () => void
  isSaving: boolean
  togglePendingMemberTeam: (teamId: string) => void
  togglePendingMemberWorkflowRole: (roleId: string) => void
  togglePendingMemberVault: (vaultId: string) => void
}

export function EditPendingMemberDialog({
  pendingMember,
  pendingMemberForm,
  setPendingMemberForm,
  teams,
  workflowRoles,
  orgVaults,
  onSave,
  onClose,
  isSaving,
  togglePendingMemberTeam,
  togglePendingMemberWorkflowRole,
  togglePendingMemberVault,
}: EditPendingMemberDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-plm-fg flex items-center gap-2">
            <Pencil size={18} className="text-plm-accent" />
            Edit Pending Member
          </h3>
          <button onClick={onClose} className="p-1 text-plm-fg-muted hover:text-plm-fg rounded">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Email (read-only) */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1">Email</label>
            <div className="px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg-muted">
              {pendingMember.email}
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1">Full Name</label>
            <input
              type="text"
              value={pendingMemberForm.full_name}
              onChange={(e) =>
                setPendingMemberForm((prev) => ({ ...prev, full_name: e.target.value }))
              }
              placeholder="Enter name"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted focus:border-plm-accent focus:outline-none"
            />
          </div>

          {/* Workflow Roles */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-2">Workflow Roles</label>
            <div className="space-y-1 max-h-36 overflow-y-auto border border-plm-border rounded-lg p-2 bg-plm-bg">
              {workflowRoles.length === 0 ? (
                <div className="text-sm text-plm-fg-muted p-2">No workflow roles defined yet</div>
              ) : (
                workflowRoles.map((role) => {
                  const RoleIcon = getRoleIcon(role.icon)
                  const isSelected = pendingMemberForm.workflow_role_ids.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      onClick={() => togglePendingMemberWorkflowRole(role.id)}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-plm-accent/10 border border-plm-accent/30'
                          : 'hover:bg-plm-highlight border border-transparent'
                      }`}
                    >
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center"
                        style={{ backgroundColor: `${role.color}20`, color: role.color }}
                      >
                        <RoleIcon size={14} />
                      </div>
                      <span className="flex-1 text-left text-sm text-plm-fg">{role.name}</span>
                      {isSelected && <Check size={14} className="text-plm-accent" />}
                    </button>
                  )
                })
              )}
            </div>
            <p className="text-xs text-plm-fg-muted mt-1">
              Roles for workflow approvals and state transitions.
            </p>
          </div>

          {/* Teams */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-2">Pre-assigned Teams</label>
            <div className="space-y-1 max-h-48 overflow-y-auto border border-plm-border rounded-lg p-2 bg-plm-bg">
              {teams.length === 0 ? (
                <div className="text-sm text-plm-fg-muted p-2">No teams available</div>
              ) : (
                teams.map((team) => {
                  const TeamIcon = getTeamIcon(team.icon)
                  const isSelected = pendingMemberForm.team_ids.includes(team.id)
                  return (
                    <button
                      key={team.id}
                      onClick={() => togglePendingMemberTeam(team.id)}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-plm-accent/10 border border-plm-accent/30'
                          : 'hover:bg-plm-highlight border border-transparent'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded flex items-center justify-center ${
                          isSelected ? 'bg-plm-accent text-white' : 'bg-plm-fg-muted/10'
                        }`}
                        style={isSelected ? {} : { color: team.color }}
                      >
                        <TeamIcon size={14} />
                      </div>
                      <span className="flex-1 text-left text-sm text-plm-fg">{team.name}</span>
                      {isSelected && <Check size={14} className="text-plm-accent" />}
                    </button>
                  )
                })
              )}
            </div>
            <p className="text-xs text-plm-fg-muted mt-1">
              User will be automatically added to selected teams when they sign in.
            </p>
          </div>

          {/* Vault Access */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-2">Vault Access</label>
            <div
              className={`p-3 rounded-lg border mb-2 ${
                pendingMemberForm.vault_ids.length === 0
                  ? 'bg-plm-warning/10 border-plm-warning/30'
                  : 'bg-plm-bg border-plm-border'
              }`}
            >
              <div className="flex items-center gap-2">
                <Database
                  size={16}
                  className={
                    pendingMemberForm.vault_ids.length === 0
                      ? 'text-plm-warning'
                      : 'text-plm-fg-muted'
                  }
                />
                <span
                  className={`text-sm ${pendingMemberForm.vault_ids.length === 0 ? 'text-plm-warning' : 'text-plm-fg-muted'}`}
                >
                  {pendingMemberForm.vault_ids.length === 0
                    ? 'No vault access — select vaults to grant access'
                    : `${pendingMemberForm.vault_ids.length} of ${orgVaults.length} vaults selected`}
                </span>
              </div>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto border border-plm-border rounded-lg p-2 bg-plm-bg">
              {orgVaults.length === 0 ? (
                <div className="text-sm text-plm-fg-muted p-2">No vaults available</div>
              ) : (
                orgVaults.map((vault) => {
                  const isSelected = pendingMemberForm.vault_ids.includes(vault.id)
                  return (
                    <button
                      key={vault.id}
                      onClick={() => togglePendingMemberVault(vault.id)}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-plm-accent/10 border border-plm-accent/30'
                          : 'hover:bg-plm-highlight border border-transparent'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded flex items-center justify-center ${
                          isSelected
                            ? 'bg-plm-accent text-white'
                            : 'bg-plm-fg-muted/10 text-plm-fg-muted'
                        }`}
                      >
                        <Folder size={14} />
                      </div>
                      <span className="flex-1 text-left text-sm text-plm-fg">{vault.name}</span>
                      {isSelected && <Check size={14} className="text-plm-accent" />}
                    </button>
                  )
                })
              )}
            </div>
            <p className="text-xs text-plm-fg-muted mt-1">
              Leave empty for access to all vaults, or select specific vaults to restrict access.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
