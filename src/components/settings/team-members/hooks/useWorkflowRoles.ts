// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { usePDMStore } from '../../../../stores/pdmStore'
import type { WorkflowRoleBasic, WorkflowRoleFormData } from '../types'

export function useWorkflowRoles(orgId: string | null) {
  const { addToast } = usePDMStore()
  const [workflowRoles, setWorkflowRoles] = useState<WorkflowRoleBasic[]>([])
  const [userRoleAssignments, setUserRoleAssignments] = useState<Record<string, string[]>>({})
  const [isLoading, setIsLoading] = useState(true)

  const loadWorkflowRoles = useCallback(async () => {
    if (!orgId) return
    
    try {
      // Load workflow roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('workflow_roles')
        .select('id, name, color, icon, description')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('sort_order')
      
      if (rolesError) throw rolesError
      setWorkflowRoles(rolesData || [])
      
      // Load user role assignments
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('user_workflow_roles')
        .select(`
          user_id,
          workflow_role_id,
          workflow_roles!inner (org_id)
        `)
        .eq('workflow_roles.org_id', orgId)
      
      if (assignmentsError) throw assignmentsError
      
      // Build userId -> roleIds map
      const assignmentsMap: Record<string, string[]> = {}
      for (const a of (assignmentsData || [])) {
        if (!assignmentsMap[a.user_id]) {
          assignmentsMap[a.user_id] = []
        }
        assignmentsMap[a.user_id].push(a.workflow_role_id)
      }
      setUserRoleAssignments(assignmentsMap)
    } catch (err) {
      console.error('Failed to load workflow roles:', err)
    }
  }, [orgId])

  const createWorkflowRole = useCallback(async (
    formData: WorkflowRoleFormData
  ): Promise<boolean> => {
    if (!formData.name.trim() || !orgId) return false
    
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .insert({
          name: formData.name.trim(),
          color: formData.color,
          icon: formData.icon,
          description: formData.description || null,
          org_id: orgId
        })
      
      if (error) throw error
      
      addToast('success', `Created workflow role "${formData.name}"`)
      await loadWorkflowRoles()
      return true
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A workflow role with this name already exists')
      } else {
        addToast('error', 'Failed to create workflow role')
      }
      return false
    }
  }, [orgId, addToast, loadWorkflowRoles])

  const updateWorkflowRole = useCallback(async (
    roleId: string,
    formData: WorkflowRoleFormData
  ): Promise<boolean> => {
    if (!formData.name.trim()) return false
    
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .update({
          name: formData.name.trim(),
          color: formData.color,
          icon: formData.icon,
          description: formData.description || null
        })
        .eq('id', roleId)
      
      if (error) throw error
      
      addToast('success', `Updated workflow role "${formData.name}"`)
      await loadWorkflowRoles()
      return true
    } catch (err: any) {
      if (err.code === '23505') {
        addToast('error', 'A workflow role with this name already exists')
      } else {
        addToast('error', 'Failed to update workflow role')
      }
      return false
    }
  }, [addToast, loadWorkflowRoles])

  const deleteWorkflowRole = useCallback(async (roleId: string): Promise<boolean> => {
    const role = workflowRoles.find(r => r.id === roleId)
    if (!role) return false
    
    try {
      const { error } = await supabase
        .from('workflow_roles')
        .delete()
        .eq('id', roleId)
      
      if (error) throw error
      
      addToast('success', `Deleted workflow role "${role.name}"`)
      await loadWorkflowRoles()
      return true
    } catch {
      addToast('error', 'Failed to delete workflow role')
      return false
    }
  }, [workflowRoles, addToast, loadWorkflowRoles])

  const toggleUserRole = useCallback(async (
    userId: string,
    roleId: string,
    isAdding: boolean,
    assignedBy?: string
  ): Promise<boolean> => {
    try {
      if (isAdding) {
        const { error } = await supabase.from('user_workflow_roles').insert({
          user_id: userId,
          workflow_role_id: roleId,
          assigned_by: assignedBy
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_workflow_roles')
          .delete()
          .eq('user_id', userId)
          .eq('workflow_role_id', roleId)
        if (error) throw error
      }
      await loadWorkflowRoles()
      return true
    } catch {
      addToast('error', isAdding ? 'Failed to add role' : 'Failed to remove role')
      return false
    }
  }, [addToast, loadWorkflowRoles])

  useEffect(() => {
    if (orgId) {
      loadWorkflowRoles().finally(() => setIsLoading(false))
    }
  }, [orgId, loadWorkflowRoles])

  return {
    workflowRoles,
    userRoleAssignments,
    isLoading,
    loadWorkflowRoles,
    createWorkflowRole,
    updateWorkflowRole,
    deleteWorkflowRole,
    toggleUserRole
  }
}
