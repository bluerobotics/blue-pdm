// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useCallback, useEffect } from 'react'
import { supabase, getOrgVaultAccess, setUserVaultAccess } from '../../../../lib/supabase'
import { usePDMStore } from '../../../../stores/pdmStore'
import type { Vault } from '../types'

export function useVaultAccess(orgId: string | null) {
  const { user, addToast } = usePDMStore()
  const [vaults, setVaults] = useState<Vault[]>([])
  const [vaultAccessMap, setVaultAccessMap] = useState<Record<string, string[]>>({})
  const [teamVaultAccessMap, setTeamVaultAccessMap] = useState<Record<string, string[]>>({})
  const [isLoading, setIsLoading] = useState(true)

  const loadVaults = useCallback(async () => {
    if (!orgId) return
    
    try {
      const { data, error } = await supabase
        .from('vaults')
        .select('*')
        .eq('org_id', orgId)
        .order('is_default', { ascending: false })
        .order('name')
      
      if (error) throw error
      setVaults(data || [])
    } catch (err) {
      console.error('Failed to load org vaults:', err)
    }
  }, [orgId])

  const loadVaultAccess = useCallback(async () => {
    if (!orgId) return
    
    const { accessMap, error } = await getOrgVaultAccess(orgId)
    if (error) {
      console.error('Failed to load vault access:', error)
    } else {
      setVaultAccessMap(accessMap)
    }
  }, [orgId])

  const loadTeamVaultAccess = useCallback(async () => {
    if (!orgId) return
    
    try {
      const { data, error } = await supabase
        .from('team_vault_access')
        .select('team_id, vault_id')
      
      if (error) throw error
      
      // Build team -> vault[] map
      const accessMap: Record<string, string[]> = {}
      for (const row of data || []) {
        if (!accessMap[row.team_id]) {
          accessMap[row.team_id] = []
        }
        accessMap[row.team_id].push(row.vault_id)
      }
      setTeamVaultAccessMap(accessMap)
    } catch (err) {
      console.error('Failed to load team vault access:', err)
    }
  }, [orgId])

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadVaults(),
      loadVaultAccess(),
      loadTeamVaultAccess()
    ])
  }, [loadVaults, loadVaultAccess, loadTeamVaultAccess])

  const saveUserVaultAccess = useCallback(async (
    userId: string,
    vaultIds: string[],
    userName?: string
  ): Promise<boolean> => {
    if (!user || !orgId) return false
    
    try {
      const result = await setUserVaultAccess(userId, vaultIds, user.id, orgId)
      
      if (result.success) {
        addToast('success', `Updated vault access for ${userName || 'user'}`)
        await loadVaultAccess()
        return true
      } else {
        addToast('error', result.error || 'Failed to update vault access')
        return false
      }
    } catch {
      addToast('error', 'Failed to update vault access')
      return false
    }
  }, [user, orgId, addToast, loadVaultAccess])

  const saveTeamVaultAccess = useCallback(async (
    teamId: string,
    vaultIds: string[],
    teamName?: string
  ): Promise<boolean> => {
    if (!user) return false
    
    try {
      // Delete existing access
      await supabase
        .from('team_vault_access')
        .delete()
        .eq('team_id', teamId)
      
      // Insert new access
      if (vaultIds.length > 0) {
        await supabase.from('team_vault_access').insert(
          vaultIds.map(vaultId => ({
            team_id: teamId,
            vault_id: vaultId,
            granted_by: user.id
          }))
        )
      }
      
      addToast('success', `Updated vault access for ${teamName || 'team'}`)
      await loadTeamVaultAccess()
      return true
    } catch (err) {
      addToast('error', 'Failed to update vault access')
      return false
    }
  }, [user, addToast, loadTeamVaultAccess])

  // Get accessible vault IDs for a user
  const getUserAccessibleVaults = useCallback((userId: string): string[] => {
    const accessibleVaultIds: string[] = []
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        accessibleVaultIds.push(vaultId)
      }
    }
    return accessibleVaultIds
  }, [vaultAccessMap])

  // Get vault access count for a user
  const getUserVaultAccessCount = useCallback((userId: string): number => {
    let count = 0
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        count++
      }
    }
    return count
  }, [vaultAccessMap])

  useEffect(() => {
    if (orgId) {
      loadAll().finally(() => setIsLoading(false))
    }
  }, [orgId, loadAll])

  return {
    vaults,
    vaultAccessMap,
    teamVaultAccessMap,
    isLoading,
    loadVaults,
    loadVaultAccess,
    loadTeamVaultAccess,
    loadAll,
    saveUserVaultAccess,
    saveTeamVaultAccess,
    getUserAccessibleVaults,
    getUserVaultAccessCount
  }
}
