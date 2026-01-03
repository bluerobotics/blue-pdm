// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient } from './client'

// ============================================
// Activity Log
// ============================================

export async function getRecentActivity(orgId: string, limit = 50) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('activity')
    .select(`
      *,
      file:files(file_name, file_path)
    `)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
  
  return { activity: data, error }
}

export async function getFileActivity(fileId: string, limit = 20) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('activity')
    .select('*')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  
  return { activity: data, error }
}
