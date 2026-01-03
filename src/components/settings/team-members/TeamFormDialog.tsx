// Team Form Dialog - Create/Edit team modal
import * as LucideIcons from 'lucide-react'
import { Users, Copy, Loader2 } from 'lucide-react'
import { IconPicker } from '../../shared/IconPicker'
import { ColorPickerDropdown } from '../../shared/ColorPicker'
import type { TeamFormDialogProps } from './types'

export function TeamFormDialog({
  title,
  formData,
  setFormData,
  onSave,
  onCancel,
  isSaving,
  existingTeams,
  copyFromTeamId,
  setCopyFromTeamId
}: TeamFormDialogProps) {
  const IconComponent = (LucideIcons as any)[formData.icon] || Users
  const isCreating = title === 'Create Team'
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-plm-fg mb-6">{title}</h3>
        
        <div className="space-y-4">
          {/* Copy from existing team */}
          {isCreating && existingTeams && existingTeams.length > 0 && setCopyFromTeamId && (
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">
                <Copy size={12} className="inline mr-1" />
                Copy from Existing Team
              </label>
              <select
                value={copyFromTeamId || ''}
                onChange={e => {
                  const teamId = e.target.value || null
                  setCopyFromTeamId(teamId)
                  if (teamId && existingTeams) {
                    const sourceTeam = existingTeams.find(t => t.id === teamId)
                    if (sourceTeam) {
                      setFormData({
                        ...formData,
                        color: sourceTeam.color,
                        icon: sourceTeam.icon
                      })
                    }
                  }
                }}
                className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg focus:outline-none focus:border-plm-accent"
              >
                <option value="">Start fresh (no copy)</option>
                {existingTeams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.member_count} members, {team.permissions_count} permissions)
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Name */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Team Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Engineering, Accounting, Quality"
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1.5">Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this team's purpose..."
              rows={2}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent resize-none"
            />
          </div>
          
          {/* Color & Icon */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Color</label>
              <div className="flex items-center gap-2 p-2 bg-plm-bg border border-plm-border rounded-lg">
                <ColorPickerDropdown
                  color={formData.color}
                  onChange={(c) => c && setFormData({ ...formData, color: c })}
                  triggerSize="lg"
                  showReset={false}
                  title="Team Color"
                  position="left"
                />
                <div
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: `${formData.color}20`, color: formData.color }}
                >
                  <IconComponent size={16} />
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-plm-fg-muted mb-1.5">Icon</label>
              <IconPicker
                value={formData.icon}
                onChange={(icon) => setFormData({ ...formData, icon })}
                color={formData.color}
              />
            </div>
          </div>
          
          {/* Default team toggle */}
          <label className="flex items-center gap-3 p-3 bg-plm-bg border border-plm-border rounded-lg cursor-pointer hover:border-plm-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={formData.is_default}
              onChange={e => setFormData({ ...formData, is_default: e.target.checked })}
              className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
            />
            <div>
              <div className="text-sm text-plm-fg font-medium">Default Team</div>
              <div className="text-xs text-plm-fg-muted">New users will automatically be added to this team</div>
            </div>
          </label>
        </div>
        
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button
            onClick={onSave}
            disabled={isSaving || !formData.name.trim()}
            className="btn btn-primary"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isCreating ? 'Create Team' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
