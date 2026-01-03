// Workflow Roles Modal - Manage a user's workflow role assignments
import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { Shield, Search, Plus, X, Check, Pencil, Trash2, Loader2 } from 'lucide-react'
import { ColorPickerDropdown } from '../../shared/ColorPicker'
import { IconGridPicker } from '../../shared/IconPicker'
import type { WorkflowRolesModalProps, WorkflowRoleBasic } from './types'

export function WorkflowRolesModal({
  user,
  workflowRoles,
  userRoleIds,
  onClose,
  onSave,
  onUpdateRole,
  onDeleteRole,
  onCreateRole
}: WorkflowRolesModalProps) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(userRoleIds)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Edit state
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null)
  
  const toggleRole = (roleId: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(roleId)
        ? prev.filter(id => id !== roleId)
        : [...prev, roleId]
    )
  }
  
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(selectedRoleIds)
    } finally {
      setIsSaving(false)
    }
  }
  
  const startEditing = (role: WorkflowRoleBasic) => {
    setEditingRoleId(role.id)
    setEditName(role.name)
    setEditColor(role.color)
    setEditIcon(role.icon)
  }
  
  const cancelEditing = () => {
    setEditingRoleId(null)
    setEditName('')
    setEditColor('')
    setEditIcon('')
  }
  
  const handleUpdateRole = async () => {
    if (!editingRoleId || !editName.trim()) return
    setIsUpdating(true)
    try {
      await onUpdateRole(editingRoleId, editName.trim(), editColor, editIcon)
      cancelEditing()
    } finally {
      setIsUpdating(false)
    }
  }
  
  const handleDeleteRole = async (roleId: string) => {
    setDeletingRoleId(roleId)
    try {
      await onDeleteRole(roleId)
      // Remove from selected if it was selected
      setSelectedRoleIds(prev => prev.filter(id => id !== roleId))
    } finally {
      setDeletingRoleId(null)
    }
  }
  
  const hasChanges = JSON.stringify([...selectedRoleIds].sort()) !== JSON.stringify([...userRoleIds].sort())
  
  const filteredRoles = workflowRoles.filter(r =>
    !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plm-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Shield size={20} className="text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Workflow Roles</h3>
              <p className="text-xs text-plm-fg-muted truncate max-w-[200px]">
                {user.full_name || user.email}
            </p>
          </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Search */}
        <div className="p-4 border-b border-plm-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search roles..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredRoles.length === 0 ? (
            <div className="text-center py-6 text-sm text-plm-fg-muted">
              {searchQuery ? (
                `No roles match "${searchQuery}"`
              ) : (
                <>
                  <Shield size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No workflow roles defined yet.</p>
                  <p className="text-xs mt-1">Create roles in the Roles tab.</p>
                </>
              )}
            </div>
          ) : (
            <>
              {filteredRoles.map(role => {
                const RoleIcon = (LucideIcons as any)[role.icon] || Shield
                const isSelected = selectedRoleIds.includes(role.id)
                const isEditing = editingRoleId === role.id
                const isDeleting = deletingRoleId === role.id
                
                if (isEditing) {
                  const EditIcon = (LucideIcons as any)[editIcon] || Shield
                  return (
                    <div key={role.id} className="p-3 rounded-lg border border-plm-accent bg-plm-accent/5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-plm-fg">Edit Role</span>
                        <button
                          onClick={cancelEditing}
                          className="p-1 text-plm-fg-muted hover:text-plm-fg"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Role name"
                        className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg text-sm placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <ColorPickerDropdown
                          color={editColor}
                          onChange={(c) => c && setEditColor(c)}
                          triggerSize="lg"
                          showReset={false}
                          title="Role Color"
                        />
                        <div
                          className="p-2 rounded-lg"
                          style={{ backgroundColor: `${editColor}20`, color: editColor }}
                        >
                          <EditIcon size={16} />
                        </div>
                      </div>
                      {/* Icon picker grid */}
                      <IconGridPicker
                        value={editIcon}
                        onChange={setEditIcon}
                        maxHeight="128px"
                        columns={8}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteRole(role.id)}
                          disabled={isDeleting}
                          className="btn btn-ghost btn-sm text-plm-error hover:bg-plm-error/10"
                        >
                          {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                        <button
                          onClick={handleUpdateRole}
                          disabled={isUpdating || !editName.trim()}
                          className="flex-1 btn btn-primary btn-sm flex items-center justify-center gap-2"
                        >
                          {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Save
                        </button>
                      </div>
                    </div>
                  )
                }
                
                return (
                  <button
                    key={role.id}
                    onClick={() => toggleRole(role.id)}
                    className={`w-full group flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-plm-accent bg-plm-accent/10'
                        : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${role.color}20`, color: role.color }}
                    >
                      <RoleIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm font-medium text-plm-fg">{role.name}</div>
                      {role.description && (
                        <div className="text-xs text-plm-fg-muted truncate">{role.description}</div>
                      )}
                    </div>
                    <div
                      onClick={e => { e.stopPropagation(); startEditing(role) }}
                      className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit role"
                    >
                      <Pencil size={12} />
                  </div>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'border-plm-accent bg-plm-accent'
                        : 'border-plm-fg-muted'
                    }`}>
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                  </button>
                )
              })}
            </>
          )}
          
          {/* Create new role option */}
          {!searchQuery && onCreateRole && (
            <button
              onClick={onCreateRole}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-plm-border text-purple-400 hover:border-purple-400 hover:bg-purple-500/5 transition-colors"
            >
              <Plus size={14} />
              Create new role
            </button>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="btn btn-primary flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
