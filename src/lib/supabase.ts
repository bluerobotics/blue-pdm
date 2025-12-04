import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// These will be set from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// ============================================
// Auth Helpers
// ============================================

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account'  // Only show account picker, not consent every time
      }
    }
  })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  return { user, error }
}

export async function getCurrentSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  return { session, error }
}

// ============================================
// User & Organization
// ============================================

export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('*, organization:organizations(*)')
    .eq('id', userId)
    .single()
  
  return { profile: data, error }
}

export async function getOrganization(orgId: string) {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()
  
  return { org: data, error }
}

// Find and link organization by email domain, or fetch existing org
export async function linkUserToOrganization(userId: string, userEmail: string) {
  // First, check if user already has an org_id
  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .single()
  
  if (userProfile?.org_id) {
    // User already has org_id, just fetch the organization
    const { data: existingOrg, error: fetchError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', userProfile.org_id)
      .single()
    
    if (existingOrg) {
      return { org: existingOrg, error: null }
    }
    // If fetch failed, continue to try email domain lookup
    console.warn('Failed to fetch existing org:', fetchError)
  }
  
  // Try to find org by email domain
  const domain = userEmail.split('@')[1]
  
  const { data: org, error: findError } = await supabase
    .from('organizations')
    .select('*')
    .contains('email_domains', [domain])
    .single()
  
  if (findError || !org) {
    // Try alternative query (in case contains doesn't work with array)
    const { data: allOrgs } = await supabase
      .from('organizations')
      .select('*')
    
    const matchingOrg = allOrgs?.find(o => 
      o.email_domains?.includes(domain)
    )
    
    if (matchingOrg) {
      // Update user's org_id
      await supabase
        .from('users')
        .update({ org_id: matchingOrg.id })
        .eq('id', userId)
      
      return { org: matchingOrg, error: null }
    }
    
    return { org: null, error: new Error(`No organization found for @${domain}`) }
  }
  
  // Update user's org_id
  const { error: updateError } = await supabase
    .from('users')
    .update({ org_id: org.id })
    .eq('id', userId)
  
  if (updateError) {
    console.warn('Failed to update user org_id:', updateError)
  }
  
  return { org, error: null }
}

// ============================================
// Files - Read Operations
// ============================================

export async function getFiles(orgId: string, options?: {
  folder?: string
  state?: string[]
  search?: string
  checkedOutByMe?: string  // user ID
}) {
  let query = supabase
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name),
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('org_id', orgId)
    .order('file_path', { ascending: true })
  
  if (options?.folder) {
    query = query.ilike('file_path', `${options.folder}%`)
  }
  
  if (options?.state && options.state.length > 0) {
    query = query.in('state', options.state)
  }
  
  if (options?.search) {
    query = query.or(
      `file_name.ilike.%${options.search}%,` +
      `part_number.ilike.%${options.search}%,` +
      `description.ilike.%${options.search}%`
    )
  }
  
  if (options?.checkedOutByMe) {
    query = query.eq('checked_out_by', options.checkedOutByMe)
  }
  
  const { data, error } = await query
  return { files: data, error }
}

export async function getFile(fileId: string) {
  const { data, error } = await supabase
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name),
      created_by_user:users!created_by(email, full_name),
      updated_by_user:users!updated_by(email, full_name)
    `)
    .eq('id', fileId)
    .single()
  
  return { file: data, error }
}

export async function getFileByPath(orgId: string, filePath: string) {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('org_id', orgId)
    .eq('file_path', filePath)
    .single()
  
  return { file: data, error }
}

// ============================================
// Files - Version History
// ============================================

export async function getFileVersions(fileId: string) {
  const { data, error } = await supabase
    .from('file_versions')
    .select(`
      *,
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('file_id', fileId)
    .order('version', { ascending: false })
  
  return { versions: data, error }
}

// ============================================
// Files - References (Where-Used / BOM)
// ============================================

export async function getWhereUsed(fileId: string) {
  const { data, error } = await supabase
    .from('file_references')
    .select(`
      *,
      parent:files!parent_file_id(
        id, file_name, file_path, part_number, revision, state
      )
    `)
    .eq('child_file_id', fileId)
  
  return { references: data, error }
}

export async function getContains(fileId: string) {
  const { data, error } = await supabase
    .from('file_references')
    .select(`
      *,
      child:files!child_file_id(
        id, file_name, file_path, part_number, revision, state
      )
    `)
    .eq('parent_file_id', fileId)
  
  return { references: data, error }
}

// ============================================
// Activity Log
// ============================================

export async function getRecentActivity(orgId: string, limit = 50) {
  const { data, error } = await supabase
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
  const { data, error } = await supabase
    .from('activity')
    .select('*')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  
  return { activity: data, error }
}

// ============================================
// Checked Out Files (for current user)
// ============================================

export async function getMyCheckedOutFiles(userId: string) {
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('checked_out_by', userId)
    .order('checked_out_at', { ascending: false })
  
  return { files: data, error }
}

export async function getAllCheckedOutFiles(orgId: string) {
  const { data, error } = await supabase
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name)
    `)
    .eq('org_id', orgId)
    .not('checked_out_by', 'is', null)
    .order('checked_out_at', { ascending: false })
  
  return { files: data, error }
}

// ============================================
// Sync Operations
// ============================================

export async function syncFile(
  orgId: string,
  userId: string,
  filePath: string,  // relative path in vault
  fileName: string,
  extension: string,
  fileSize: number,
  contentHash: string,
  base64Content: string
) {
  try {
    // 1. Upload file content to storage (using content hash as filename for deduplication)
    const storagePath = `${orgId}/${contentHash}`
    
    // Check if this content already exists (deduplication)
    const { data: existingFile } = await supabase.storage
      .from('vault')
      .list(orgId, { search: contentHash })
    
    if (!existingFile || existingFile.length === 0) {
      // Convert base64 to blob
      const binaryString = atob(base64Content)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes])
      
      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('vault')
        .upload(storagePath, blob, {
          contentType: 'application/octet-stream',
          upsert: false
        })
      
      if (uploadError && !uploadError.message.includes('already exists')) {
        throw uploadError
      }
    }
    
    // 2. Determine file type from extension
    const fileType = getFileTypeFromExtension(extension)
    
    // 3. Check if file already exists in database
    const { data: existingDbFile } = await supabase
      .from('files')
      .select('id, version')
      .eq('org_id', orgId)
      .eq('file_path', filePath)
      .single()
    
    if (existingDbFile) {
      // Update existing file
      const { data, error } = await supabase
        .from('files')
        .update({
          content_hash: contentHash,
          file_size: fileSize,
          version: existingDbFile.version + 1,
          updated_at: new Date().toISOString(),
          updated_by: userId
        })
        .eq('id', existingDbFile.id)
        .select()
        .single()
      
      if (error) throw error
      
      // Create version record
      await supabase.from('file_versions').insert({
        file_id: existingDbFile.id,
        version: existingDbFile.version + 1,
        revision: data.revision,
        content_hash: contentHash,
        file_size: fileSize,
        state: data.state,
        created_by: userId
      })
      
      return { file: data, error: null, isNew: false }
    } else {
      // Create new file record
      const { data, error } = await supabase
        .from('files')
        .insert({
          org_id: orgId,
          file_path: filePath,
          file_name: fileName,
          extension: extension,
          file_type: fileType,
          content_hash: contentHash,
          file_size: fileSize,
          state: 'wip',
          revision: 'A',
          version: 1,
          created_by: userId,
          updated_by: userId
        })
        .select()
        .single()
      
      if (error) throw error
      
      // Create initial version record
      await supabase.from('file_versions').insert({
        file_id: data.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'wip',
        created_by: userId
      })
      
      return { file: data, error: null, isNew: true }
    }
  } catch (error) {
    console.error('Error syncing file:', error)
    return { file: null, error, isNew: false }
  }
}

function getFileTypeFromExtension(ext: string): 'part' | 'assembly' | 'drawing' | 'document' | 'other' {
  const lowerExt = ext.toLowerCase()
  if (['.sldprt', '.prt', '.ipt', '.par'].includes(lowerExt)) return 'part'
  if (['.sldasm', '.asm', '.iam'].includes(lowerExt)) return 'assembly'
  if (['.slddrw', '.drw', '.idw', '.dwg'].includes(lowerExt)) return 'drawing'
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'].includes(lowerExt)) return 'document'
  return 'other'
}
