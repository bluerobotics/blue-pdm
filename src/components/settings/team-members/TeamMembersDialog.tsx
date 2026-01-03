// @ts-nocheck - Supabase type inference issues with Database generics
// Team Members Dialog - Manage members of a specific team
import { useState, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { Users, UserPlus, Search, Plus, X, Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { usePDMStore } from '../../../stores/pdmStore'
import { getInitials, getEffectiveAvatarUrl } from '../../../types/pdm'
import type { TeamMembersDialogProps, OrgUser } from './types'
import type { TeamMember } from '../../../types/permissions'

export function TeamMembersDialog({
  team,
  orgUsers,
  onClose,
  userId
}: TeamMembersDialogProps) {
  const { addToast } = usePDMStore()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  
  useEffect(() => {
    loadMembers()
  }, [team.id])
  
  const loadMembers = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          id, team_id, user_id, is_team_admin, added_at, added_by,
          users!user_id (id, email, full_name, avatar_url, custom_avatar_url, role)
        `)
        .eq('team_id', team.id)
        .order('added_at', { ascending: false })
      
      if (error) throw error
      
      const mappedData = (data || []).map(m => ({
        ...m,
        user: m.users
      }))
      
      setMembers(mappedData)
    } catch (err) {
      console.error('Failed to load team members:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const memberUserIds = members.map(m => m.user_id)
  const availableUsers = orgUsers.filter(u => !memberUserIds.includes(u.id))
  const filteredUsers = availableUsers.filter(u =>
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  const addMember = async (userToAdd: OrgUser) => {
    if (!userId) return
    
    setIsAdding(true)
    try {
      const { error } = await supabase.from('team_members').insert({
        team_id: team.id,
        user_id: userToAdd.id,
        added_by: userId
      })
      
      if (error) throw error
      
      addToast('success', `Added ${userToAdd.full_name || userToAdd.email} to team`)
      loadMembers()
    } catch (err) {
      addToast('error', 'Failed to add member')
    } finally {
      setIsAdding(false)
    }
  }
  
  const removeMember = async (member: TeamMember) => {
    try {
      const { error } = await supabase.from('team_members').delete().eq('id', member.id)
      if (error) throw error
      
      addToast('success', `Removed ${member.user?.full_name || member.user?.email} from team`)
      loadMembers()
    } catch (err) {
      addToast('error', 'Failed to remove member')
    }
  }
  
  const IconComponent = (LucideIcons as any)[team.icon] || Users
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: `${team.color}20`, color: team.color }}
          >
            <IconComponent size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-plm-fg">{team.name} - Members</h3>
            <p className="text-sm text-plm-fg-muted">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 text-plm-fg-muted hover:text-plm-fg rounded">
            <X size={18} />
          </button>
        </div>
        
        {/* Add member section */}
        <div className="p-4 border-b border-plm-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-plm-fg flex items-center gap-2">
              <UserPlus size={14} />
              Add Members
            </h4>
            <span className="text-xs text-plm-fg-muted">{availableUsers.length} available</span>
          </div>
          
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter users..."
              className="w-full pl-9 pr-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
            />
          </div>
          
          {availableUsers.length === 0 ? (
            <div className="text-center py-4 text-sm text-plm-fg-muted bg-plm-bg rounded-lg border border-plm-border">
              All organization members are already in this team
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-4 text-sm text-plm-fg-muted">
                  No users match your search
                </div>
              ) : (
                filteredUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      addMember(u)
                      setSearchQuery('')
                    }}
                    disabled={isAdding}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-plm-highlight transition-colors text-left border-b border-plm-border/50 last:border-b-0"
                  >
                    {getEffectiveAvatarUrl(u) ? (
                      <img src={getEffectiveAvatarUrl(u) || ''} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-xs font-medium">
                        {getInitials(u.full_name || u.email)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-plm-fg truncate">{u.full_name || u.email}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-1 text-plm-accent text-xs font-medium">
                      <Plus size={14} />
                      Add
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        
        {/* Members list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-plm-fg-muted" size={24} />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-plm-fg-muted">
              No members in this team yet
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(member => (
                <div key={member.id} className="flex items-center gap-3 p-3 bg-plm-bg rounded-lg group">
                  {getEffectiveAvatarUrl(member.user) ? (
                    <img src={getEffectiveAvatarUrl(member.user) || ''} alt="" className="w-10 h-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-plm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                      {getInitials(member.user?.full_name || member.user?.email || '')}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-plm-fg truncate">{member.user?.full_name || member.user?.email}</div>
                    <div className="text-xs text-plm-fg-muted truncate">{member.user?.email}</div>
                  </div>
                  {member.is_team_admin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent uppercase font-medium">
                      Team Admin
                    </span>
                  )}
                  <button
                    onClick={() => removeMember(member)}
                    className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove from team"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-plm-border flex justify-end">
          <button onClick={onClose} className="btn btn-primary">Done</button>
        </div>
      </div>
    </div>
  )
}
