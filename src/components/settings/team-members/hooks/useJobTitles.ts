// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { usePDMStore } from '../../../../stores/pdmStore'
import type { JobTitle, OrgUser } from '../types'

export function useJobTitles(orgId: string | null) {
  const { user, addToast } = usePDMStore()
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadJobTitles = useCallback(async () => {
    if (!orgId) return
    
    try {
      const { data, error } = await supabase
        .from('job_titles')
        .select('id, name, color, icon')
        .eq('org_id', orgId)
        .order('name')
      
      if (error) throw error
      setJobTitles(data || [])
    } catch (err) {
      console.error('Failed to load job titles:', err)
    }
  }, [orgId])

  const createJobTitle = useCallback(async (
    name: string,
    color: string,
    icon: string,
    assignToUserId?: string
  ): Promise<boolean> => {
    if (!orgId || !user || !name.trim()) return false
    
    try {
      // Create the title
      const { data, error } = await supabase
        .from('job_titles')
        .insert({
          org_id: orgId,
          name: name.trim(),
          color,
          icon,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      // If we have a user to assign, assign the title to them
      if (assignToUserId && data) {
        await supabase
          .from('user_job_titles')
          .upsert({
            user_id: assignToUserId,
            title_id: data.id,
            assigned_by: user.id
          }, { onConflict: 'user_id' })
        
        addToast('success', `Created and assigned "${name}"`)
      } else {
        addToast('success', `Created job title "${name}"`)
      }
      
      await loadJobTitles()
      return true
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A job title with this name already exists')
      } else {
        addToast('error', 'Failed to create job title')
      }
      return false
    }
  }, [orgId, user, addToast, loadJobTitles])

  const updateJobTitle = useCallback(async (
    titleId: string,
    name: string,
    color: string,
    icon: string
  ): Promise<boolean> => {
    if (!name.trim()) return false
    
    try {
      const { error } = await supabase
        .from('job_titles')
        .update({ name: name.trim(), color, icon })
        .eq('id', titleId)
      
      if (error) throw error
      
      addToast('success', `Updated "${name}"`)
      await loadJobTitles()
      return true
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A job title with this name already exists')
      } else {
        addToast('error', 'Failed to update job title')
      }
      return false
    }
  }, [addToast, loadJobTitles])

  const deleteJobTitle = useCallback(async (titleId: string): Promise<boolean> => {
    const title = jobTitles.find(t => t.id === titleId)
    if (!title) return false
    
    try {
      const { error } = await supabase
        .from('job_titles')
        .delete()
        .eq('id', titleId)
      
      if (error) throw error
      
      addToast('success', `Deleted "${title.name}"`)
      await loadJobTitles()
      return true
    } catch {
      addToast('error', 'Failed to delete job title')
      return false
    }
  }, [jobTitles, addToast, loadJobTitles])

  const assignJobTitle = useCallback(async (
    targetUser: OrgUser,
    titleId: string | null
  ): Promise<boolean> => {
    try {
      if (titleId) {
        // Upsert the title assignment
        const { error } = await supabase
          .from('user_job_titles')
          .upsert({
            user_id: targetUser.id,
            title_id: titleId,
            assigned_by: user?.id
          }, { onConflict: 'user_id' })
        
        if (error) throw error
        
        const titleName = jobTitles.find(t => t.id === titleId)?.name || 'title'
        addToast('success', `Set ${targetUser.full_name || targetUser.email}'s title to ${titleName}`)
      } else {
        // Remove title
        const { error } = await supabase
          .from('user_job_titles')
          .delete()
          .eq('user_id', targetUser.id)
        
        if (error) throw error
        addToast('success', `Removed ${targetUser.full_name || targetUser.email}'s job title`)
      }
      
      return true
    } catch {
      addToast('error', 'Failed to change job title')
      return false
    }
  }, [user, jobTitles, addToast])

  useEffect(() => {
    if (orgId) {
      loadJobTitles().finally(() => setIsLoading(false))
    }
  }, [orgId, loadJobTitles])

  return {
    jobTitles,
    isLoading,
    loadJobTitles,
    createJobTitle,
    updateJobTitle,
    deleteJobTitle,
    assignJobTitle
  }
}
