// User Teams Modal - Manage a user's team assignments
import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { Users, Search, Plus, X, Check, Loader2 } from 'lucide-react'
import type { UserTeamsModalProps } from './types'

export function UserTeamsModal({
  user,
  allTeams,
  userTeamIds,
  onClose,
  onSave,
  onCreateTeam
}: UserTeamsModalProps) {
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(userTeamIds)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds(prev =>
      prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId]
    )
  }
  
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(selectedTeamIds)
    } finally {
      setIsSaving(false)
    }
  }
  
  const hasChanges = JSON.stringify([...selectedTeamIds].sort()) !== JSON.stringify([...userTeamIds].sort())
  
  const filteredTeams = allTeams.filter(t =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-plm-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-plm-accent/10">
              <Users size={20} className="text-plm-accent" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Teams</h3>
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
              placeholder="Search teams..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredTeams.length === 0 ? (
            <div className="text-center py-6 text-sm text-plm-fg-muted">
              {searchQuery ? `No teams match "${searchQuery}"` : 'No teams available'}
            </div>
          ) : (
            filteredTeams.map(team => {
              const TeamIcon = (LucideIcons as any)[team.icon] || Users
              const isSelected = selectedTeamIds.includes(team.id)
              
              return (
                <button
                  key={team.id}
                  onClick={() => toggleTeam(team.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent/10'
                      : 'border-plm-border hover:border-plm-fg-muted hover:bg-plm-highlight'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${team.color}20`, color: team.color }}
                  >
                    <TeamIcon size={16} />
                  </div>
                  <span className="flex-1 text-left text-sm text-plm-fg font-medium">{team.name}</span>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-plm-accent bg-plm-accent'
                      : 'border-plm-fg-muted'
                  }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                </button>
              )
            })
          )}
          
          {/* Create new team option */}
          {!searchQuery && onCreateTeam && (
            <button
              onClick={onCreateTeam}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-plm-border text-plm-accent hover:border-plm-accent hover:bg-plm-accent/5 transition-colors"
            >
              <Plus size={14} />
              Create new team
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
