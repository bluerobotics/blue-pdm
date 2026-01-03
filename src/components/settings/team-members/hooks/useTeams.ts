// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { usePDMStore } from '../../../../stores/pdmStore'
import type { TeamWithDetails, TeamFormData } from '../types'

export function useTeams(orgId: string | null) {
  const { user, addToast } = usePDMStore()
  const [teams, setTeams] = useState<TeamWithDetails[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadTeams = useCallback(async () => {
    if (!orgId) return
    
    try {
      const { data: teamsData, error } = await supabase
        .from('teams')
        .select(`
          *,
          team_members(count),
          team_permissions(count)
        `)
        .eq('org_id', orgId)
        .order('name')
      
      if (error) throw error
      
      const teamsWithCounts = (teamsData || []).map(team => ({
        ...team,
        member_count: team.team_members?.[0]?.count || 0,
        permissions_count: team.team_permissions?.[0]?.count || 0
      }))
      
      setTeams(teamsWithCounts)
    } catch (err) {
      console.error('Failed to load teams:', err)
      addToast('error', 'Failed to load teams')
    }
  }, [orgId, addToast])

  const createTeam = useCallback(async (
    formData: TeamFormData,
    copyFromTeamId?: string | null
  ): Promise<boolean> => {
    if (!orgId || !user || !formData.name.trim()) return false
    
    try {
      const { data, error } = await supabase
        .from('teams')
        .insert({
          org_id: orgId,
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          color: formData.color,
          icon: formData.icon,
          is_default: formData.is_default,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      // If copying from an existing team, copy its permissions and vault access
      if (copyFromTeamId && data) {
        const { data: sourcePerms } = await supabase
          .from('team_permissions')
          .select('resource, actions')
          .eq('team_id', copyFromTeamId)
        
        if (sourcePerms && sourcePerms.length > 0) {
          await supabase.from('team_permissions').insert(
            sourcePerms.map(p => ({
              team_id: data.id,
              resource: p.resource,
              actions: p.actions,
              granted_by: user.id
            }))
          )
        }
        
        // Copy vault access
        const { data: sourceVaultAccess } = await supabase
          .from('team_vault_access')
          .select('vault_id')
          .eq('team_id', copyFromTeamId)
        
        if (sourceVaultAccess && sourceVaultAccess.length > 0) {
          await supabase.from('team_vault_access').insert(
            sourceVaultAccess.map(va => ({
              team_id: data.id,
              vault_id: va.vault_id,
              granted_by: user.id
            }))
          )
        }
        
        const sourceTeam = teams.find(t => t.id === copyFromTeamId)
        addToast('success', `Team "${formData.name}" created (copied from ${sourceTeam?.name})`)
      } else {
        addToast('success', `Team "${formData.name}" created`)
      }
      
      await loadTeams()
      return true
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A team with this name already exists')
      } else {
        addToast('error', 'Failed to create team')
      }
      return false
    }
  }, [orgId, user, teams, addToast, loadTeams])

  const updateTeam = useCallback(async (
    teamId: string,
    formData: TeamFormData
  ): Promise<boolean> => {
    if (!user || !formData.name.trim()) return false
    
    try {
      const { error } = await supabase
        .from('teams')
        .update({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          color: formData.color,
          icon: formData.icon,
          is_default: formData.is_default,
          updated_at: new Date().toISOString(),
          updated_by: user.id
        })
        .eq('id', teamId)
      
      if (error) throw error
      
      addToast('success', `Team "${formData.name}" updated`)
      await loadTeams()
      return true
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A team with this name already exists')
      } else {
        addToast('error', 'Failed to update team')
      }
      return false
    }
  }, [user, addToast, loadTeams])

  const deleteTeam = useCallback(async (teamId: string): Promise<boolean> => {
    const team = teams.find(t => t.id === teamId)
    if (!team) return false
    
    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', teamId)
      
      if (error) throw error
      
      addToast('success', `Team "${team.name}" deleted`)
      await loadTeams()
      return true
    } catch (err) {
      addToast('error', 'Failed to delete team')
      return false
    }
  }, [teams, addToast, loadTeams])

  useEffect(() => {
    if (orgId) {
      loadTeams().finally(() => setIsLoading(false))
    }
  }, [orgId, loadTeams])

  return {
    teams,
    isLoading,
    loadTeams,
    createTeam,
    updateTeam,
    deleteTeam
  }
}
