// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useCallback, useEffect } from 'react'
import { supabase, removeUserFromOrg } from '../../../../lib/supabase'
import { usePDMStore } from '../../../../stores/pdmStore'
import type { OrgUser } from '../types'

export function useMembers(orgId: string | null) {
  const { user, addToast } = usePDMStore()
  const [members, setMembers] = useState<OrgUser[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadMembers = useCallback(async () => {
    if (!orgId) return
    
    try {
      const { data: usersData, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, custom_avatar_url, job_title, role, last_sign_in, last_online')
        .eq('org_id', orgId)
        .order('full_name')
      
      if (error) throw error
      
      // Load pending org members (unclaimed) to filter them out from the user list
      const { data: pendingData } = await supabase
        .from('pending_org_members')
        .select('email')
        .eq('org_id', orgId)
        .is('claimed_at', null)
      
      const pendingEmails = new Set((pendingData || []).map(p => p.email.toLowerCase()))
      
      // Filter out users who are still pending
      const activeUsers = (usersData || []).filter(u => !pendingEmails.has(u.email.toLowerCase()))
      
      // Load team memberships for active users only
      const { data: membershipsData } = await supabase
        .from('team_members')
        .select(`
          user_id,
          team:teams(id, name, color, icon)
        `)
        .in('user_id', activeUsers.map(u => u.id))
      
      // Load job title assignments for active users only
      const { data: titleAssignmentsData } = await supabase
        .from('user_job_titles')
        .select(`
          user_id,
          title:job_titles(id, name, color, icon)
        `)
        .in('user_id', activeUsers.map(u => u.id))
      
      // Map teams and job_title to users
      const usersWithTeamsAndTitles = activeUsers.map(userRecord => {
        const userMemberships = (membershipsData || []).filter(m => m.user_id === userRecord.id)
        const userTitleAssignment = (titleAssignmentsData || []).find(t => t.user_id === userRecord.id)
        return {
          ...userRecord,
          teams: userMemberships.map(m => m.team).filter(Boolean) as { id: string; name: string; color: string; icon: string }[],
          job_title: userTitleAssignment?.title as { id: string; name: string; color: string; icon: string } | null
        }
      })
      
      setMembers(usersWithTeamsAndTitles)
    } catch (err) {
      console.error('Failed to load org users:', err)
    }
  }, [orgId])

  const removeMember = useCallback(async (memberId: string): Promise<boolean> => {
    if (!orgId) return false
    
    const member = members.find(m => m.id === memberId)
    if (!member) return false
    
    try {
      const result = await removeUserFromOrg(memberId, orgId)
      if (result.success) {
        addToast('success', `Removed ${member.full_name || member.email} from organization`)
        setMembers(prev => prev.filter(u => u.id !== memberId))
        return true
      } else {
        addToast('error', result.error || 'Failed to remove user')
        return false
      }
    } catch {
      addToast('error', 'Failed to remove user')
      return false
    }
  }, [orgId, members, addToast])

  const removeFromTeam = useCallback(async (
    memberId: string,
    teamId: string,
    teamName: string
  ): Promise<boolean> => {
    const member = members.find(m => m.id === memberId)
    if (!member) return false
    
    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('user_id', memberId)
        .eq('team_id', teamId)
      
      if (error) throw error
      
      addToast('success', `Removed ${member.full_name || member.email} from ${teamName}`)
      await loadMembers()
      return true
    } catch {
      addToast('error', 'Failed to remove from team')
      return false
    }
  }, [members, addToast, loadMembers])

  const toggleTeam = useCallback(async (
    memberId: string,
    teamId: string,
    isAdding: boolean
  ): Promise<boolean> => {
    try {
      if (isAdding) {
        const { error } = await supabase.from('team_members').insert({
          team_id: teamId,
          user_id: memberId,
          added_by: user?.id
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('team_members')
          .delete()
          .eq('user_id', memberId)
          .eq('team_id', teamId)
        if (error) throw error
      }
      await loadMembers()
      return true
    } catch {
      addToast('error', isAdding ? 'Failed to add to team' : 'Failed to remove from team')
      return false
    }
  }, [user, addToast, loadMembers])

  useEffect(() => {
    if (orgId) {
      loadMembers().finally(() => setIsLoading(false))
    }
  }, [orgId, loadMembers])

  return {
    members,
    isLoading,
    loadMembers,
    removeMember,
    removeFromTeam,
    toggleTeam
  }
}
