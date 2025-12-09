// @ts-nocheck - TODO: Fix Supabase type inference issues with Database types
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { loadConfig, type SupabaseConfig } from './supabaseConfig'

// ============================================
// Logging Helper (must be defined early)
// ============================================

// Helper to log to both console and file (via Electron)
const authLog = (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => {
  const logMsg = `[Auth] ${message}`
  if (level === 'error') {
    console.error(logMsg, data || '')
  } else if (level === 'warn') {
    console.warn(logMsg, data || '')
  } else {
    console.log(logMsg, data || '')
  }
  // Also log to file if Electron API is available
  window.electronAPI?.log?.(level, message, data)
}

// ============================================
// Dynamic Supabase Client
// ============================================

// Current configuration and client (mutable - can be reconfigured at runtime)
let currentConfig: SupabaseConfig | null = null
let supabaseClient: SupabaseClient<Database> | null = null

// Initialize from stored config or env variables (for dev)
function initializeClient() {
  // First, try to load from stored config
  const storedConfig = loadConfig()
  if (storedConfig) {
    currentConfig = storedConfig
    supabaseClient = createClient<Database>(storedConfig.url, storedConfig.anonKey, getClientOptions())
    console.log('[Supabase] Initialized from stored config')
    setupSessionListener()
    return
  }
  
  // Fallback to environment variables (for development)
  const envUrl = import.meta.env.VITE_SUPABASE_URL || ''
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  
  if (envUrl && envKey) {
    currentConfig = { version: 1, url: envUrl, anonKey: envKey }
    supabaseClient = createClient<Database>(envUrl, envKey, getClientOptions())
    console.log('[Supabase] Initialized from environment variables')
    setupSessionListener()
    return
  }
  
  // Not configured - will use placeholder client
  console.log('[Supabase] Not configured')
  supabaseClient = createClient<Database>(
    'https://placeholder.supabase.co',
    'placeholder-key',
    getClientOptions()
  )
}

function getClientOptions() {
  return {
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
  }
}

// Reconfigure the Supabase client with new credentials
export function reconfigureSupabase(config: SupabaseConfig): void {
  currentConfig = config
  supabaseClient = createClient<Database>(config.url, config.anonKey, getClientOptions())
  console.log('[Supabase] Reconfigured with new credentials')
  setupSessionListener()
}

// Get the current Supabase client (creates placeholder if not configured)
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseClient) {
    initializeClient()
  }
  return supabaseClient!
}

// Check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  if (!currentConfig && !supabaseClient) {
    initializeClient()
  }
  return currentConfig !== null && currentConfig.url !== '' && currentConfig.anonKey !== ''
}

// Get current config (for display/sharing)
export function getCurrentConfig(): SupabaseConfig | null {
  return currentConfig
}

// Legacy export for compatibility - getter that returns the client
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_, prop) {
    const client = getSupabaseClient()
    const value = client[prop as keyof SupabaseClient<Database>]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  }
})

// Initialize on module load
initializeClient()

// ============================================
// Session Listener Setup
// ============================================

let sessionResolver: ((success: boolean) => void) | null = null

function setupSessionListener() {
  if (typeof window !== 'undefined' && window.electronAPI?.onSetSession) {
    authLog('info', 'Setting up onSetSession listener')
    window.electronAPI.onSetSession(async (tokens) => {
      authLog('info', 'Received tokens from main process', {
        hasAccessToken: !!tokens.access_token,
        accessTokenLength: tokens.access_token?.length,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      })
      try {
        const client = getSupabaseClient()
        const { data, error } = await client.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token
        })
        
        if (error) {
          authLog('error', 'Error setting session', { error: error.message, code: error.status })
          sessionResolver?.(false)
        } else {
          authLog('info', 'Session set successfully', { 
            email: data.user?.email,
            userId: data.user?.id?.substring(0, 8) + '...'
          })
          sessionResolver?.(true)
        }
      } catch (err) {
        authLog('error', 'Failed to set session (exception)', { error: String(err) })
        sessionResolver?.(false)
      }
    })
  }
}

// ============================================
// Auth Helpers
// ============================================

export async function signInWithGoogle() {
  const client = getSupabaseClient()
  
  // In Electron production, use popup window flow
  const isElectronProduction = window.electronAPI && !window.location.href.startsWith('http://localhost')
  
  authLog('info', 'signInWithGoogle called', { 
    isElectronProduction,
    currentUrl: window.location.href.substring(0, 50)
  })
  
  if (isElectronProduction) {
    authLog('info', 'Using Electron production OAuth flow')
    
    // Get the OAuth URL from Supabase without auto-redirecting
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost/auth/callback', // Will be intercepted by Electron
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account'
        },
        skipBrowserRedirect: true // Don't redirect, just get the URL
      }
    })
    
    if (error || !data?.url) {
      authLog('error', 'Failed to get OAuth URL from Supabase', { 
        error: error?.message,
        hasData: !!data
      })
      return { data, error: error || new Error('No OAuth URL returned') }
    }
    
    authLog('info', 'Got OAuth URL from Supabase', { urlLength: data.url.length })
    
    // Set up promise to wait for session from main process
    const sessionPromise = new Promise<boolean>((resolve) => {
      sessionResolver = resolve
      // Timeout after 60 seconds
      setTimeout(() => {
        authLog('warn', 'Session promise timed out after 60s')
        sessionResolver = null
        resolve(false)
      }, 60000)
    })
    
    // Open OAuth window via Electron IPC
    authLog('info', 'Opening OAuth popup window via Electron IPC')
    const result = await window.electronAPI.openOAuthWindow(data.url)
    
    authLog('info', 'OAuth window closed', { 
      success: result?.success,
      canceled: result?.canceled,
      error: result?.error
    })
    
    if (result?.success) {
      authLog('info', 'OAuth window reported success, waiting for session from main process')
      // Wait for the session to be set by the main process
      const sessionSet = await sessionPromise
      sessionResolver = null
      
      authLog('info', 'Session promise resolved', { sessionSet })
      
      if (sessionSet) {
        authLog('info', 'Session set successfully via IPC!')
        return { data: { url: null, provider: 'google' }, error: null }
      } else {
        authLog('warn', 'Session was not set via IPC, checking manually')
        // Fallback: try to get session manually
        const { data: { session } } = await client.auth.getSession()
        authLog('info', 'Manual session check result', {
          hasSession: !!session,
          email: session?.user?.email
        })
        if (session) {
          authLog('info', 'Found session via manual check')
          return { data: { url: null, provider: 'google' }, error: null }
        }
      }
    }
    
    sessionResolver = null
    authLog('error', 'OAuth flow completed without establishing session', {
      wasCanceled: result?.canceled
    })
    return { data: null, error: result?.canceled ? null : new Error('OAuth failed') }
  }
  
  // In development or web, use normal OAuth flow
  authLog('info', 'Using web/development OAuth flow')
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account'
      }
    }
  })
  return { data, error }
}

export async function signOut() {
  const client = getSupabaseClient()
  const { error } = await client.auth.signOut()
  return { error }
}

export async function getCurrentUser() {
  const client = getSupabaseClient()
  const { data: { user }, error } = await client.auth.getUser()
  return { user, error }
}

export async function getCurrentSession() {
  const client = getSupabaseClient()
  const { data: { session }, error } = await client.auth.getSession()
  return { session, error }
}

// ============================================
// User & Organization
// ============================================

// Store the current access token (set by setupSessionListener)
let currentAccessToken: string | null = null

export function setCurrentAccessToken(token: string | null) {
  currentAccessToken = token
}

export async function getUserProfile(userId: string) {
  authLog('debug', 'getUserProfile called', { userId: userId?.substring(0, 8) + '...', hasToken: !!currentAccessToken })
  
  // Use raw fetch - Supabase client methods hang
  try {
    const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
    const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    const accessToken = currentAccessToken || key
    
    authLog('debug', 'Fetching profile...')
    
    const response = await fetch(`${url}/rest/v1/users?select=id,email,role,org_id,full_name,avatar_url&id=eq.${userId}`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })
    const data = await response.json()
    authLog('debug', 'Profile fetch result', { status: response.status, hasData: data?.length > 0 })
    
    if (data && data.length > 0) {
      return { profile: data[0], error: null }
    }
    return { profile: null, error: new Error('User not found') }
  } catch (err) {
    authLog('error', 'getUserProfile failed', { error: String(err) })
    return { profile: null, error: err as Error }
  }
}

export async function getOrganization(orgId: string) {
  // Use raw fetch - Supabase client methods hang
  try {
    const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
    const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    const accessToken = currentAccessToken || key
    
    const response = await fetch(`${url}/rest/v1/organizations?select=*&id=eq.${orgId}`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })
    const data = await response.json()
    
    if (data && data.length > 0) {
      return { org: data[0], error: null }
    }
    return { org: null, error: new Error('Organization not found') }
  } catch (err) {
    return { org: null, error: err as Error }
  }
}

// Find and link organization by email domain, or fetch existing org
export async function linkUserToOrganization(userId: string, userEmail: string) {
  authLog('info', 'linkUserToOrganization called', { userId: userId?.substring(0, 8) + '...', email: userEmail })
  
  // Use raw fetch - Supabase client methods hang
  const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
  const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const accessToken = currentAccessToken || key
  
  try {
    // First, check if user already has an org_id
    const userResponse = await fetch(`${url}/rest/v1/users?select=org_id&id=eq.${userId}`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })
    const userData = await userResponse.json()
    const userProfile = userData?.[0]
    
    authLog('info', 'User profile lookup result', { 
      hasProfile: !!userProfile, 
      hasOrgId: !!userProfile?.org_id,
      orgId: userProfile?.org_id?.substring(0, 8) + '...'
    })
    
    if (userProfile?.org_id) {
      // User already has org_id, just fetch the organization
      authLog('info', 'User has org_id, fetching org details')
      const orgResponse = await fetch(`${url}/rest/v1/organizations?select=*&id=eq.${userProfile.org_id}`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
      const orgData = await orgResponse.json()
      
      if (orgData && orgData.length > 0) {
        authLog('info', 'Found existing org', { orgName: orgData[0].name })
        return { org: orgData[0], error: null }
      }
      authLog('warn', 'Failed to fetch existing org, trying domain lookup')
    }
    
    // Try to find org by email domain
    const domain = userEmail.split('@')[1]
    authLog('info', 'Looking up org by email domain', { domain })
    
    // Fetch all orgs and filter by domain (contains filter is complex with REST API)
    const allOrgsResponse = await fetch(`${url}/rest/v1/organizations?select=*`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })
    const allOrgs = await allOrgsResponse.json()
    
    authLog('info', 'Fetched all orgs', { count: allOrgs?.length })
    
    const matchingOrg = allOrgs?.find((o: { email_domains?: string[] }) => 
      o.email_domains?.includes(domain)
    )
    
    if (matchingOrg) {
      authLog('info', 'Found matching org', { orgName: matchingOrg.name })
      return { org: matchingOrg, error: null }
    }
    
    authLog('warn', 'No organization found for domain', { domain })
    return { org: null, error: new Error(`No organization found for @${domain}`) }
  } catch (err) {
    authLog('error', 'linkUserToOrganization failed', { error: String(err) })
    return { org: null, error: err as Error }
  }
}

// ============================================
// Files - Read Operations
// ============================================

export async function getFiles(orgId: string, options?: {
  vaultId?: string
  folder?: string
  state?: string[]
  search?: string
  checkedOutByMe?: string  // user ID
}) {
  const client = getSupabaseClient()
  let query = client
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url),
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('org_id', orgId)
    .order('file_path', { ascending: true })
  
  // Filter by vault if specified
  if (options?.vaultId) {
    query = query.eq('vault_id', options.vaultId)
  }
  
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
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url),
      created_by_user:users!created_by(email, full_name),
      updated_by_user:users!updated_by(email, full_name)
    `)
    .eq('id', fileId)
    .single()
  
  return { file: data, error }
}

export async function getFileByPath(orgId: string, filePath: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
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
  const client = getSupabaseClient()
  const { data, error } = await client
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
  const client = getSupabaseClient()
  const { data, error } = await client
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
  const client = getSupabaseClient()
  const { data, error } = await client
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

// ============================================
// Checked Out Files (for current user)
// ============================================

export async function getMyCheckedOutFiles(userId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select('*')
    .eq('checked_out_by', userId)
    .order('checked_out_at', { ascending: false })
  
  return { files: data, error }
}

export async function getAllCheckedOutFiles(orgId: string) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select(`
      *,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url)
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
  vaultId: string,
  userId: string,
  filePath: string,  // relative path in vault
  fileName: string,
  extension: string,
  fileSize: number,
  contentHash: string,
  base64Content: string
) {
  const client = getSupabaseClient()
  
  try {
    // 1. Upload file content to storage (using content hash as filename for deduplication)
    // Use subdirectory based on first 2 chars of hash to prevent too many files in one folder
    const storagePath = `${orgId}/${contentHash.substring(0, 2)}/${contentHash}`
    
    // Check if this content already exists (deduplication)
    const { data: existingFile } = await client.storage
      .from('vault')
      .list(`${orgId}/${contentHash.substring(0, 2)}`, { search: contentHash })
    
    if (!existingFile || existingFile.length === 0) {
      // Convert base64 to blob
      const binaryString = atob(base64Content)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes])
      
      // Upload to storage
      const { error: uploadError } = await client.storage
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
    
    // 3. Check if file already exists in database (by vault and path)
    const { data: existingDbFile } = await client
      .from('files')
      .select('id, version')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .single()
    
    if (existingDbFile) {
      // Update existing file
      const { data, error } = await client
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
      await client.from('file_versions').insert({
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
      const { data, error } = await client
        .from('files')
        .insert({
          org_id: orgId,
          vault_id: vaultId,
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
      await client.from('file_versions').insert({
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

// ============================================
// Check Out / Check In Operations
// ============================================

export async function checkoutFile(fileId: string, userId: string, message?: string) {
  const client = getSupabaseClient()
  
  // First check if file is already checked out
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, file_name, checked_out_by, checked_out_user:users!checked_out_by(email, full_name, avatar_url)')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by && file.checked_out_by !== userId) {
    const checkedOutUser = file.checked_out_user as { email: string; full_name: string } | null
    return { 
      success: false, 
      error: `File is already checked out by ${checkedOutUser?.full_name || checkedOutUser?.email || 'another user'}` 
    }
  }
  
  // Check out the file
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: userId,
      checked_out_at: new Date().toISOString(),
      lock_message: message || null
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  await client.from('activity').insert({
    org_id: data.org_id,
    file_id: fileId,
    user_id: userId,
    action: 'checkout',
    details: message ? { message } : {}
  })
  
  return { success: true, file: data, error: null }
}

export async function checkinFile(
  fileId: string, 
  userId: string, 
  options?: {
    newContentHash?: string
    newFileSize?: number
    comment?: string
    newFilePath?: string  // For moved files - update the server path
    newFileName?: string  // For renamed files - update the server name
    pendingMetadata?: {
      part_number?: string | null
      description?: string | null
      revision?: string
    }
  }
) {
  const client = getSupabaseClient()
  
  // First verify the user has the file checked out
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by !== userId) {
    return { success: false, error: 'You do not have this file checked out' }
  }
  
  // Prepare update data
  const updateData: Record<string, any> = {
    checked_out_by: null,
    checked_out_at: null,
    lock_message: null,
    updated_at: new Date().toISOString(),
    updated_by: userId
  }
  
  // Handle file path/name changes (for moved/renamed files)
  if (options?.newFilePath && options.newFilePath !== file.file_path) {
    updateData.file_path = options.newFilePath
  }
  if (options?.newFileName && options.newFileName !== file.file_name) {
    updateData.file_name = options.newFileName
  }
  
  // Apply pending metadata changes if any
  const hasPendingMetadata = options?.pendingMetadata && (
    options.pendingMetadata.part_number !== undefined ||
    options.pendingMetadata.description !== undefined ||
    options.pendingMetadata.revision !== undefined
  )
  
  if (hasPendingMetadata && options?.pendingMetadata) {
    if (options.pendingMetadata.part_number !== undefined) {
      updateData.part_number = options.pendingMetadata.part_number
    }
    if (options.pendingMetadata.description !== undefined) {
      updateData.description = options.pendingMetadata.description
    }
    if (options.pendingMetadata.revision !== undefined) {
      updateData.revision = options.pendingMetadata.revision
    }
  }
  
  // Check if content changed OR metadata changed
  const contentChanged = options?.newContentHash && options.newContentHash !== file.content_hash
  const metadataChanged = hasPendingMetadata
  const shouldIncrementVersion = contentChanged || metadataChanged
  
  if (shouldIncrementVersion) {
    // Get max version from history - new version should be max + 1
    // This handles the case where you rollback from v5 to v3, then check in -> should be v6
    const { data: maxVersionData } = await client
      .from('file_versions')
      .select('version')
      .eq('file_id', fileId)
      .order('version', { ascending: false })
      .limit(1)
      .single()
    
    const maxVersionInHistory = maxVersionData?.version || file.version
    const newVersion = maxVersionInHistory + 1
    updateData.version = newVersion
    
    if (contentChanged) {
      updateData.content_hash = options!.newContentHash
      if (options!.newFileSize !== undefined) {
        updateData.file_size = options!.newFileSize
      }
    }
    
    // Create version record for changes
    await client.from('file_versions').insert({
      file_id: fileId,
      version: newVersion,
      revision: updateData.revision || file.revision,
      content_hash: updateData.content_hash || file.content_hash,
      file_size: updateData.file_size || file.file_size,
      state: file.state,
      created_by: userId,
      comment: options?.comment || null
    })
    
    // Log revision change activity if revision changed
    if (options?.pendingMetadata?.revision && options.pendingMetadata.revision !== file.revision) {
      await client.from('activity').insert({
        org_id: file.org_id,
        file_id: fileId,
        user_id: userId,
        action: 'revision_change',
        details: { from: file.revision, to: options.pendingMetadata.revision }
      })
    }
  }
  
  // Update the file
  const { data, error } = await client
    .from('files')
    .update(updateData)
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  await client.from('activity').insert({
    org_id: data.org_id,
    file_id: fileId,
    user_id: userId,
    action: 'checkin',
    details: { 
      ...(options?.comment ? { comment: options.comment } : {}),
      contentChanged,
      metadataChanged
    }
  })
  
  return { success: true, file: data, error: null, contentChanged, metadataChanged }
}

export async function undoCheckout(fileId: string, userId: string) {
  const client = getSupabaseClient()
  
  // Verify the user has the file checked out (or is admin)
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*, org_id')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by !== userId) {
    // TODO: Allow admins to undo anyone's checkout
    return { success: false, error: 'You do not have this file checked out' }
  }
  
  // Release the checkout without saving changes
  const { data, error } = await client
    .from('files')
    .update({
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true, file: data, error: null }
}

/**
 * Update file metadata (part number, description, revision, state)
 * File must be checked out by the user to edit
 * Version is incremented on any metadata change
 */
// Update file metadata - NOW ONLY USED FOR STATE CHANGES (syncs immediately)
// Item number, description, revision are saved locally and synced on check-in
// State changes do NOT require checkout
export async function updateFileMetadata(
  fileId: string,
  userId: string,
  updates: {
    state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
  }
) {
  const client = getSupabaseClient()
  
  // Get current file to validate and log changes
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*, org_id')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // Check if state actually changed
  if (!updates.state || updates.state === file.state) {
    return { success: true, file, error: null }
  }
  
  // Prepare update data - state changes do NOT increment version
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId,
    state: updates.state,
    state_changed_at: new Date().toISOString(),
    state_changed_by: userId
  }
  
  // Update the file
  const { data, error } = await client
    .from('files')
    .update(updateData)
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log state change activity
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: userId,
    action: 'state_change',
    details: {
      old_state: file.state,
      new_state: updates.state
    }
  })
  
  return { success: true, file: data, error: null }
}