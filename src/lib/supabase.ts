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

// Session listener state (must be declared before initializeClient)
let sessionResolver: ((success: boolean) => void) | null = null
let sessionListenerCleanup: (() => void) | null = null

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

function setupSessionListener() {
  if (typeof window !== 'undefined' && window.electronAPI?.onSetSession) {
    // Clean up any existing listener first
    if (sessionListenerCleanup) {
      authLog('debug', 'Cleaning up previous session listener')
      sessionListenerCleanup()
      sessionListenerCleanup = null
    }
    
    authLog('info', 'Setting up onSetSession listener')
    sessionListenerCleanup = window.electronAPI.onSetSession(async (tokens) => {
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
  
  // In Electron (both dev and production), use system browser OAuth flow
  const isElectron = !!window.electronAPI
  
  authLog('info', 'signInWithGoogle called', { 
    isElectron,
    currentUrl: window.location.href.substring(0, 50)
  })
  
  if (isElectron) {
    authLog('info', 'Using Electron system browser OAuth flow')
    
    // Get the OAuth URL from Supabase without auto-redirecting
    // The redirect URL will be replaced by the main process with a local callback server
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost/auth/callback', // Placeholder - will be replaced by main process
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
      // Timeout after 5 minutes (user may take time in browser)
      setTimeout(() => {
        authLog('warn', 'Session promise timed out after 5 minutes')
        sessionResolver = null
        resolve(false)
      }, 5 * 60 * 1000)
    })
    
    // Open system browser via Electron IPC (this opens the user's default browser)
    authLog('info', 'Opening system browser for Google sign-in')
    const result = await window.electronAPI.openOAuthWindow(data.url)
    
    authLog('info', 'OAuth flow returned', { 
      success: result?.success,
      canceled: result?.canceled,
      error: result?.error
    })
    
    if (result?.success) {
      authLog('info', 'OAuth completed in browser, waiting for session')
      // Wait for the session to be set by the main process
      const sessionSet = await sessionPromise
      sessionResolver = null
      
      authLog('info', 'Session promise resolved', { sessionSet })
      
      if (sessionSet) {
        authLog('info', 'Session set successfully!')
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
    if (result?.error) {
      authLog('error', 'OAuth flow failed', { error: result.error })
      return { data: null, error: new Error(result.error) }
    }
    
    authLog('error', 'OAuth flow completed without establishing session', {
      wasCanceled: result?.canceled
    })
    return { data: null, error: result?.canceled ? null : new Error('Sign in was not completed') }
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

/**
 * Get files with full metadata including user info (slower, use for single file or small sets)
 */
export async function getFiles(orgId: string, options?: {
  vaultId?: string
  folder?: string
  state?: string[]
  search?: string
  checkedOutByMe?: string  // user ID
  includeDeleted?: boolean  // Include soft-deleted files (default: false)
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
  
  // Filter out soft-deleted files by default
  if (!options?.includeDeleted) {
    query = query.is('deleted_at', null)
  }
  
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

/**
 * Lightweight file fetch for initial vault sync - only essential columns, no joins
 * Much faster than getFiles() for large vaults
 * Automatically filters out soft-deleted files (deleted_at is set)
 * Uses pagination to fetch ALL files (Supabase default limit is 1000)
 */
export async function getFilesLightweight(orgId: string, vaultId?: string) {
  const logFn = typeof window !== 'undefined' && (window as any).electronAPI?.log
    ? (level: string, msg: string, data?: any) => (window as any).electronAPI.log(level, msg, data)
    : () => {}
  
  logFn('debug', '[getFilesLightweight] Querying', { orgId, vaultId })
  
  const client = getSupabaseClient()
  
  // DEBUG: First check what files exist for this vault (ignoring org_id AND deleted_at)
  if (vaultId) {
    // Query WITHOUT deleted_at filter to see if files exist but are soft-deleted
    const { data: allVaultFiles, error: allErr } = await client
      .from('files')
      .select('id, org_id, file_path, deleted_at')
      .eq('vault_id', vaultId)
      .limit(5)
    
    if (allVaultFiles && allVaultFiles.length > 0) {
      const hasDeletedFiles = allVaultFiles.some(f => f.deleted_at)
      const hasWrongOrg = allVaultFiles.some(f => f.org_id !== orgId)
      
      if (hasDeletedFiles) {
        logFn('error', '[getFilesLightweight] FILES ARE SOFT-DELETED! They have deleted_at set!', {
          vaultId,
          sampleFiles: allVaultFiles.map(f => ({ 
            id: f.id, 
            org_id: f.org_id, 
            path: f.file_path,
            deleted_at: f.deleted_at 
          }))
        })
      } else if (hasWrongOrg) {
        logFn('warn', '[getFilesLightweight] Files exist but have wrong org_id!', {
          vaultId,
          expectedOrgId: orgId,
          sampleFiles: allVaultFiles.map(f => ({ id: f.id, org_id: f.org_id, path: f.file_path }))
        })
      } else {
        logFn('debug', '[getFilesLightweight] Files exist and look correct', {
          count: allVaultFiles.length,
          sampleFiles: allVaultFiles.map(f => ({ id: f.id, path: f.file_path }))
        })
      }
    } else {
      logFn('debug', '[getFilesLightweight] No files found in vault at all (even deleted)', { vaultId, allErr: allErr?.message })
    }
  }
  
  // Fetch ALL files using pagination (Supabase default limit is 1000)
  const PAGE_SIZE = 1000
  const allFiles: any[] = []
  let offset = 0
  let hasMore = true
  
  while (hasMore) {
    let query = client
      .from('files')
      .select(`
        id,
        file_path,
        file_name,
        extension,
        file_type,
        part_number,
        description,
        revision,
        version,
        content_hash,
        file_size,
        state,
        checked_out_by,
        checked_out_at,
        updated_at
      `)
      .eq('org_id', orgId)
      .is('deleted_at', null)  // Filter out soft-deleted files
      .order('file_path', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    
    if (vaultId) {
      query = query.eq('vault_id', vaultId)
    }
    
    const { data, error } = await query
    
    if (error) {
      logFn('error', '[getFilesLightweight] Query error', { 
        offset,
        error: error.message 
      })
      return { files: allFiles.length > 0 ? allFiles : null, error }
    }
    
    if (data && data.length > 0) {
      allFiles.push(...data)
      offset += data.length
      // If we got fewer than PAGE_SIZE, we've reached the end
      hasMore = data.length === PAGE_SIZE
      
      if (hasMore) {
        logFn('debug', '[getFilesLightweight] Fetching more files', { 
          fetchedSoFar: allFiles.length,
          offset 
        })
      }
    } else {
      hasMore = false
    }
  }
  
  logFn('debug', '[getFilesLightweight] Result', { 
    fileCount: allFiles.length, 
    hasError: false,
    pages: Math.ceil(allFiles.length / PAGE_SIZE)
  })
  
  return { files: allFiles, error: null }
}

/**
 * Get checked out user info for a batch of file IDs
 * Used to lazily load user info after initial sync
 */
export async function getCheckedOutUsers(fileIds: string[]) {
  if (fileIds.length === 0) return { users: {}, error: null }
  
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('files')
    .select(`
      id,
      checked_out_user:users!checked_out_by(email, full_name, avatar_url)
    `)
    .in('id', fileIds)
    .not('checked_out_by', 'is', null)
  
  if (error) return { users: {}, error }
  
  // Convert to a map for easy lookup
  const users: Record<string, { email: string; full_name: string; avatar_url?: string }> = {}
  for (const file of data || []) {
    if (file.checked_out_user) {
      users[file.id] = file.checked_out_user as { email: string; full_name: string; avatar_url?: string }
    }
  }
  
  return { users, error: null }
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
  
  // Debug: Log sync attempt
  const logFn = typeof window !== 'undefined' && (window as any).electronAPI?.log
    ? (level: string, msg: string, data?: any) => (window as any).electronAPI.log(level, msg, data)
    : () => {}
  
  logFn('debug', '[syncFile] Starting sync', { orgId, vaultId, filePath, fileName })
  
  try {
    // 1. Upload file content to storage (using content hash as filename for deduplication)
    // Use subdirectory based on first 2 chars of hash to prevent too many files in one folder
    const storagePath = `${orgId}/${contentHash.substring(0, 2)}/${contentHash}`
    
    // Check if this content already exists (deduplication)
    logFn('debug', '[syncFile] Checking storage', { filePath, storagePath })
    const { data: existingFile, error: listError } = await client.storage
      .from('vault')
      .list(`${orgId}/${contentHash.substring(0, 2)}`, { search: contentHash })
    
    if (listError) {
      logFn('error', '[syncFile] Storage list error', { filePath, error: listError.message })
    }
    
    if (!existingFile || existingFile.length === 0) {
      // Convert base64 to blob
      logFn('debug', '[syncFile] Uploading to storage', { filePath, size: base64Content.length })
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
        logFn('error', '[syncFile] Storage upload failed', { filePath, error: uploadError.message })
        throw uploadError
      }
      logFn('debug', '[syncFile] Storage upload complete', { filePath })
    } else {
      logFn('debug', '[syncFile] Content already exists in storage', { filePath })
    }
    
    // 2. Determine file type from extension
    const fileType = getFileTypeFromExtension(extension)
    
    // 3. Check if file already exists in database (by vault and path)
    // IMPORTANT: Check for ACTIVE files (not deleted) first, then check for soft-deleted files
    logFn('debug', '[syncFile] Checking DB for existing file', { filePath, vaultId, orgId })
    
    // First check for an active (non-deleted) file with matching org
    const { data: activeFile, error: activeError } = await client
      .from('files')
      .select('id, version, deleted_at, org_id')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single()
    
    if (activeError && activeError.code !== 'PGRST116') {
      logFn('error', '[syncFile] Active file check error', { filePath, error: activeError.message, code: activeError.code })
    }
    
    // If active file exists with same org, update it
    if (activeFile) {
      logFn('debug', '[syncFile] Updating active file', { filePath, existingId: activeFile.id })
      const { data, error } = await client
        .from('files')
        .update({
          content_hash: contentHash,
          file_size: fileSize,
          version: activeFile.version + 1,
          updated_at: new Date().toISOString(),
          updated_by: userId
        })
        .eq('id', activeFile.id)
        .select()
        .single()
      
      if (error) {
        logFn('error', '[syncFile] Update failed', { filePath, error: error.message })
        throw error
      }
      
      // Create version record
      await client.from('file_versions').insert({
        file_id: activeFile.id,
        version: activeFile.version + 1,
        revision: data.revision,
        content_hash: contentHash,
        file_size: fileSize,
        state: data.state,
        created_by: userId
      })
      
      logFn('info', '[syncFile] Update SUCCESS', { filePath, fileId: activeFile.id })
      return { file: data, error: null, isNew: false }
    }
    
    // Check for soft-deleted files that might block insertion (due to UNIQUE constraint)
    const { data: deletedFiles, error: deletedError } = await client
      .from('files')
      .select('id, org_id, deleted_at')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .not('deleted_at', 'is', null)
    
    if (deletedError) {
      logFn('error', '[syncFile] Deleted file check error', { filePath, error: deletedError.message })
    }
    
    // If soft-deleted files exist, permanently delete them first to clear the UNIQUE constraint
    // This is necessary because UNIQUE(vault_id, file_path) doesn't exclude deleted files
    if (deletedFiles && deletedFiles.length > 0) {
      logFn('warn', '[syncFile] Found soft-deleted files blocking path, permanently deleting them', { 
        filePath, 
        count: deletedFiles.length,
        fileIds: deletedFiles.map(f => f.id)
      })
      
      for (const deletedFile of deletedFiles) {
        // Delete file versions first
        await client.from('file_versions').delete().eq('file_id', deletedFile.id)
        // Delete file references
        await client.from('file_references').delete().or(`parent_file_id.eq.${deletedFile.id},child_file_id.eq.${deletedFile.id}`)
        // Delete the file record
        const { error: hardDeleteError } = await client.from('files').delete().eq('id', deletedFile.id)
        
        if (hardDeleteError) {
          logFn('error', '[syncFile] Failed to hard-delete blocking file', { 
            filePath, 
            fileId: deletedFile.id, 
            error: hardDeleteError.message 
          })
          // Continue anyway - the insert might work if this was the only blocker
        } else {
          logFn('info', '[syncFile] Hard-deleted blocking file', { filePath, fileId: deletedFile.id })
        }
      }
    }
    
    // No active file exists - check if there's any other file (shouldn't be after cleanup above)
    const { data: existingDbFile, error: checkError } = await client
      .from('files')
      .select('id, version, deleted_at, org_id')
      .eq('vault_id', vaultId)
      .eq('file_path', filePath)
      .single()
    
    if (checkError && checkError.code !== 'PGRST116') {
      logFn('error', '[syncFile] DB check error', { filePath, error: checkError.message, code: checkError.code })
    }
    
    if (existingDbFile) {
      // This shouldn't happen after the cleanup above, but handle it just in case
      logFn('warn', '[syncFile] File still exists after cleanup, updating it', { 
        filePath, 
        existingId: existingDbFile.id,
        existingOrgId: existingDbFile.org_id,
        expectedOrgId: orgId,
        wasDeleted: !!existingDbFile.deleted_at
      })
      
      // Update the existing file with ALL relevant fields (including org_id to fix any mismatch)
      const { data, error } = await client
        .from('files')
        .update({
          org_id: orgId,  // Fix org_id in case of mismatch
          content_hash: contentHash,
          file_size: fileSize,
          file_name: fileName,
          extension: extension,
          file_type: fileType,
          version: 1,  // Reset version since this is essentially a new file
          revision: 'A',  // Reset revision
          state: 'not_tracked',  // Reset state
          updated_at: new Date().toISOString(),
          updated_by: userId,
          created_by: userId,  // Update creator since this is a new upload
          created_at: new Date().toISOString(),  // Reset creation time
          deleted_at: null,  // Clear soft-delete flag
          deleted_by: null,
          checked_out_by: null,  // Clear any checkout
          checked_out_at: null,
          lock_message: null
        })
        .eq('id', existingDbFile.id)
        .select()
        .single()
      
      if (error) {
        logFn('error', '[syncFile] Update failed', { filePath, error: error.message })
        throw error
      }
      
      // Delete old versions and create fresh version record
      await client.from('file_versions').delete().eq('file_id', existingDbFile.id)
      await client.from('file_versions').insert({
        file_id: existingDbFile.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'not_tracked',
        created_by: userId
      })
      
      logFn('info', '[syncFile] Reset and update SUCCESS', { filePath, fileId: existingDbFile.id })
      return { file: data, error: null, isNew: false }
    } else {
      // Create new file record
      logFn('debug', '[syncFile] Inserting new file', { filePath, vaultId, orgId })
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
          state: 'not_tracked',
          revision: 'A',
          version: 1,
          created_by: userId,
          updated_by: userId
        })
        .select()
        .single()
      
      if (error) {
        logFn('error', '[syncFile] Insert failed', { filePath, error: error.message, code: (error as any).code })
        throw error
      }
      
      // Debug: Log successful insert
      logFn('info', '[syncFile] Insert SUCCESS', { filePath, fileId: data.id, vaultId })
      
      // Create initial version record
      await client.from('file_versions').insert({
        file_id: data.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'not_tracked',
        created_by: userId
      })
      
      return { file: data, error: null, isNew: true }
    }
  } catch (error) {
    logFn('error', '[syncFile] Exception', { filePath, error: String(error) })
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
): Promise<{ success: boolean; file?: any; error?: string | null; contentChanged?: boolean; metadataChanged?: boolean }> {
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

// ============================================
// Admin Force Check-In Operations
// ============================================

/**
 * Admin force discard checkout - discards the checkout without saving changes
 * Use this when the user is offline or unresponsive
 */
export async function adminForceDiscardCheckout(
  fileId: string,
  adminUserId: string
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()
  
  // Verify admin
  const { data: adminUser, error: adminError } = await client
    .from('users')
    .select('role, org_id')
    .eq('id', adminUserId)
    .single()
  
  if (adminError || adminUser?.role !== 'admin') {
    return { success: false, error: 'Only admins can force discard checkouts' }
  }
  
  // Get the file info
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*, checked_out_user:users!checked_out_by(id, email, full_name)')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (!file.checked_out_by) {
    return { success: false, error: 'File is not checked out' }
  }
  
  const checkedOutUser = file.checked_out_user as { id: string; email: string; full_name: string } | null
  
  // Release the checkout
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
  
  // Log activity
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: adminUserId,
    action: 'admin_force_discard',
    details: { 
      discarded_user_id: file.checked_out_by,
      discarded_user_name: checkedOutUser?.full_name || checkedOutUser?.email || 'Unknown'
    }
  })
  
  return { success: true, file: data }
}

/**
 * Update file metadata (part number, description, revision, state)
 * File must be checked out by the user to edit
 * Version is incremented on any metadata change
 */
// Update file metadata - NOW ONLY USED FOR STATE CHANGES (syncs immediately)
// Item number, description, revision are saved locally and synced on check-in
// State changes do NOT require checkout
// ============================================
// User Management (Admin only)
// ============================================

/**
 * Update a user's role (admin only)
 * Only admins can change roles of users in their organization
 */
export async function updateUserRole(
  targetUserId: string,
  newRole: 'admin' | 'engineer' | 'viewer',
  adminOrgId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Verify target user is in same org
  const { data: targetUser, error: fetchError } = await client
    .from('users')
    .select('id, org_id, role')
    .eq('id', targetUserId)
    .single()
  
  if (fetchError || !targetUser) {
    return { success: false, error: 'User not found' }
  }
  
  if (targetUser.org_id !== adminOrgId) {
    return { success: false, error: 'User is not in your organization' }
  }
  
  // Update the role
  const { error } = await client
    .from('users')
    .update({ role: newRole })
    .eq('id', targetUserId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Remove a user from the organization (admin only)
 * Sets the user's org_id to null - they can rejoin if they have the org code
 */
export async function removeUserFromOrg(
  targetUserId: string,
  adminOrgId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Verify target user is in same org
  const { data: targetUser, error: fetchError } = await client
    .from('users')
    .select('id, org_id, email')
    .eq('id', targetUserId)
    .single()
  
  if (fetchError || !targetUser) {
    return { success: false, error: 'User not found' }
  }
  
  if (targetUser.org_id !== adminOrgId) {
    return { success: false, error: 'User is not in your organization' }
  }
  
  // Remove from org by setting org_id to null
  const { error } = await client
    .from('users')
    .update({ org_id: null, role: 'engineer' }) // Reset to default role
    .eq('id', targetUserId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Add a user to the organization by email (admin only)
 * The user must already have an account (signed in at least once)
 */
export async function addUserToOrg(
  email: string,
  orgId: string,
  role: 'admin' | 'engineer' | 'viewer' = 'engineer'
): Promise<{ success: boolean; user?: any; error?: string }> {
  const client = getSupabaseClient()
  
  // Find user by email
  const { data: existingUser, error: fetchError } = await client
    .from('users')
    .select('id, email, org_id, full_name')
    .eq('email', email.toLowerCase().trim())
    .single()
  
  if (fetchError || !existingUser) {
    return { success: false, error: 'No user found with that email. They must sign in to BluePDM at least once first.' }
  }
  
  if (existingUser.org_id === orgId) {
    return { success: false, error: 'User is already a member of this organization' }
  }
  
  if (existingUser.org_id) {
    return { success: false, error: 'User is already a member of another organization' }
  }
  
  // Add user to org
  const { data, error } = await client
    .from('users')
    .update({ org_id: orgId, role })
    .eq('id', existingUser.id)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true, user: data }
}

// ============================================
// Vault Access Management (Admin only)
// ============================================

/**
 * Get vault access records for a user
 * Returns array of vault IDs the user has access to
 */
export async function getUserVaultAccess(userId: string): Promise<{ vaultIds: string[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('vault_access')
    .select('vault_id')
    .eq('user_id', userId)
  
  if (error) {
    return { vaultIds: [], error: error.message }
  }
  
  return { vaultIds: data?.map(r => r.vault_id) || [] }
}

/**
 * Get all vault access records for an organization
 * Returns a map of vault_id -> array of user_ids
 */
export async function getOrgVaultAccess(orgId: string): Promise<{ 
  accessMap: Record<string, string[]>; 
  error?: string 
}> {
  const client = getSupabaseClient()
  
  // Get all vaults for the org
  const { data: vaults, error: vaultsError } = await client
    .from('vaults')
    .select('id')
    .eq('org_id', orgId)
  
  if (vaultsError) {
    return { accessMap: {}, error: vaultsError.message }
  }
  
  const vaultIds = vaults?.map(v => v.id) || []
  
  if (vaultIds.length === 0) {
    return { accessMap: {} }
  }
  
  // Get access records for all vaults
  const { data, error } = await client
    .from('vault_access')
    .select('vault_id, user_id')
    .in('vault_id', vaultIds)
  
  if (error) {
    return { accessMap: {}, error: error.message }
  }
  
  // Build the map
  const accessMap: Record<string, string[]> = {}
  for (const record of data || []) {
    if (!accessMap[record.vault_id]) {
      accessMap[record.vault_id] = []
    }
    accessMap[record.vault_id].push(record.user_id)
  }
  
  return { accessMap }
}

/**
 * Grant a user access to a vault (admin only)
 */
export async function grantVaultAccess(
  vaultId: string,
  userId: string,
  grantedBy: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('vault_access')
    .insert({
      vault_id: vaultId,
      user_id: userId,
      granted_by: grantedBy
    })
  
  if (error) {
    // Ignore duplicate key errors (user already has access)
    if (error.code === '23505') {
      return { success: true }
    }
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Revoke a user's access to a vault (admin only)
 */
export async function revokeVaultAccess(
  vaultId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('vault_access')
    .delete()
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Set a user's vault access to a specific set of vaults (admin only)
 * This replaces all existing access for the user with the new list
 */
export async function setUserVaultAccess(
  userId: string,
  vaultIds: string[],
  grantedBy: string,
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get all vaults for the org to only remove access for vaults in this org
  const { data: orgVaults, error: vaultsError } = await client
    .from('vaults')
    .select('id')
    .eq('org_id', orgId)
  
  if (vaultsError) {
    return { success: false, error: vaultsError.message }
  }
  
  const orgVaultIds = orgVaults?.map(v => v.id) || []
  
  // Delete existing access for vaults in this org
  if (orgVaultIds.length > 0) {
    const { error: deleteError } = await client
      .from('vault_access')
      .delete()
      .eq('user_id', userId)
      .in('vault_id', orgVaultIds)
    
    if (deleteError) {
      return { success: false, error: deleteError.message }
    }
  }
  
  // Insert new access records
  if (vaultIds.length > 0) {
    const records = vaultIds.map(vaultId => ({
      vault_id: vaultId,
      user_id: userId,
      granted_by: grantedBy
    }))
    
    const { error: insertError } = await client
      .from('vault_access')
      .insert(records)
    
    if (insertError) {
      return { success: false, error: insertError.message }
    }
  }
  
  return { success: true }
}

/**
 * Check if a user has access to a specific vault
 * Admins always have access to all vaults
 * If no vault_access records exist for a vault, everyone has access (legacy behavior)
 */
export async function checkVaultAccess(
  userId: string,
  vaultId: string,
  userRole: string
): Promise<{ hasAccess: boolean; error?: string }> {
  // Admins always have access
  if (userRole === 'admin') {
    return { hasAccess: true }
  }
  
  const client = getSupabaseClient()
  
  // Check if any access records exist for this vault
  const { data: allAccess, error: checkError } = await client
    .from('vault_access')
    .select('id')
    .eq('vault_id', vaultId)
    .limit(1)
  
  if (checkError) {
    return { hasAccess: false, error: checkError.message }
  }
  
  // If no access records exist, everyone has access (vault is unrestricted)
  if (!allAccess || allAccess.length === 0) {
    return { hasAccess: true }
  }
  
  // Check if user has specific access
  const { data, error } = await client
    .from('vault_access')
    .select('id')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .limit(1)
  
  if (error) {
    return { hasAccess: false, error: error.message }
  }
  
  return { hasAccess: (data?.length || 0) > 0 }
}

export async function updateFileMetadata(
  fileId: string,
  userId: string,
  updates: {
    state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
  }
): Promise<{ success: boolean; file?: any; error?: string | null }> {
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

// ============================================
// File Path Updates (Rename/Move)
// ============================================

/**
 * Update a file's path on the server (for rename/move operations)
 */
export async function updateFilePath(
  fileId: string,
  newPath: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Extract file name from path
  const fileName = newPath.includes('/') 
    ? newPath.substring(newPath.lastIndexOf('/') + 1) 
    : newPath
  
  const { error } = await client
    .from('files')
    .update({
      file_path: newPath,
      file_name: fileName,
      updated_at: new Date().toISOString()
    })
    .eq('id', fileId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Update all files under a folder path (for folder rename/move)
 * Updates file_path for all files where file_path starts with oldPath
 */
export async function updateFolderPath(
  oldPath: string,
  newPath: string
): Promise<{ success: boolean; updated: number; error?: string }> {
  const client = getSupabaseClient()
  
  // Normalize paths (ensure forward slashes, no trailing slash)
  const normalizedOld = oldPath.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedNew = newPath.replace(/\\/g, '/').replace(/\/$/, '')
  
  // Get all files under the old path
  const { data: files, error: fetchError } = await client
    .from('files')
    .select('id, file_path, file_name')
    .like('file_path', `${normalizedOld}/%`)
  
  if (fetchError) {
    return { success: false, updated: 0, error: fetchError.message }
  }
  
  if (!files || files.length === 0) {
    return { success: true, updated: 0 }
  }
  
  // Update each file's path
  let updated = 0
  for (const file of files) {
    const updatedPath = file.file_path.replace(normalizedOld, normalizedNew)
    
    const { error } = await client
      .from('files')
      .update({
        file_path: updatedPath,
        updated_at: new Date().toISOString()
      })
      .eq('id', file.id)
    
    if (!error) {
      updated++
    }
  }
  
  return { success: true, updated }
}

// ============================================
// Trash / Soft Delete Operations
// ============================================

/**
 * Soft delete a file (move to trash)
 * File can be restored within 30 days
 * Falls back to hard delete if deleted_at column doesn't exist
 */
export async function softDeleteFile(
  fileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get current file to validate
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, org_id, file_name, file_path, checked_out_by')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // Don't allow deleting files that are checked out by someone else
  if (file.checked_out_by && file.checked_out_by !== userId) {
    return { success: false, error: 'Cannot delete a file that is checked out by another user.' }
  }
  
  // Try soft delete - set deleted_at timestamp
  const { error } = await client
    .from('files')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    })
    .eq('id', fileId)
  
  // If soft delete fails (column doesn't exist), fall back to hard delete
  if (error && (error.message?.includes('deleted_at') || error.message?.includes('column'))) {
    console.warn('Soft delete not available, performing hard delete')
    
    // Log activity BEFORE delete
    await client.from('activity').insert({
      org_id: file.org_id,
      file_id: null,
      user_id: userId,
      user_email: '',
      action: 'delete',
      details: {
        file_name: file.file_name,
        file_path: file.file_path
      }
    })
    
    const { error: deleteError } = await client
      .from('files')
      .delete()
      .eq('id', fileId)
    
    if (deleteError) {
      return { success: false, error: deleteError.message }
    }
    
    return { success: true }
  }
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: userId,
    user_email: '',
    action: 'delete',
    details: {
      file_name: file.file_name,
      file_path: file.file_path,
      soft_delete: true
    }
  })
  
  return { success: true }
}

/**
 * Soft delete multiple files at once
 */
export async function softDeleteFiles(
  fileIds: string[],
  userId: string
): Promise<{ success: boolean; deleted: number; failed: number; errors: string[] }> {
  const errors: string[] = []
  let deleted = 0
  let failed = 0
  
  for (const fileId of fileIds) {
    const result = await softDeleteFile(fileId, userId)
    if (result.success) {
      deleted++
    } else {
      failed++
      errors.push(result.error || 'Unknown error')
    }
  }
  
  return { success: failed === 0, deleted, failed, errors }
}

/**
 * Restore a file from trash
 */
export async function restoreFile(
  fileId: string,
  userId: string
): Promise<{ success: boolean; file?: any; error?: string }> {
  const client = getSupabaseClient()
  
  // Get current file to validate
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, org_id, file_name, file_path, deleted_at, vault_id')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (!file.deleted_at) {
    return { success: false, error: 'File is not in trash' }
  }
  
  // Check if a file with the same path already exists (not deleted)
  const { data: existingFile } = await client
    .from('files')
    .select('id')
    .eq('vault_id', file.vault_id)
    .eq('file_path', file.file_path)
    .is('deleted_at', null)
    .single()
  
  if (existingFile) {
    return { 
      success: false, 
      error: 'A file with the same path already exists. Rename or delete the existing file first.' 
    }
  }
  
  // Restore - clear deleted_at and deleted_by
  const { data: restoredFile, error } = await client
    .from('files')
    .update({
      deleted_at: null,
      deleted_by: null
    })
    .eq('id', fileId)
    .select()
    .single()
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  // Log activity
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: userId,
    user_email: '',
    action: 'restore',
    details: {
      file_name: file.file_name,
      file_path: file.file_path
    }
  })
  
  return { success: true, file: restoredFile }
}

/**
 * Restore multiple files from trash
 */
export async function restoreFiles(
  fileIds: string[],
  userId: string
): Promise<{ success: boolean; restored: number; failed: number; errors: string[] }> {
  const errors: string[] = []
  let restored = 0
  let failed = 0
  
  for (const fileId of fileIds) {
    const result = await restoreFile(fileId, userId)
    if (result.success) {
      restored++
    } else {
      failed++
      errors.push(result.error || 'Unknown error')
    }
  }
  
  return { success: failed === 0, restored, failed, errors }
}

/**
 * Permanently delete a file (cannot be undone)
 * Only for files already in trash
 */
export async function permanentlyDeleteFile(
  fileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get current file to validate
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, org_id, file_name, file_path, deleted_at')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (!file.deleted_at) {
    return { success: false, error: 'File must be in trash before permanent deletion' }
  }
  
  // Log activity BEFORE delete
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: null, // Set to null since file will be deleted
    user_id: userId,
    user_email: '',
    action: 'delete',
    details: {
      file_name: file.file_name,
      file_path: file.file_path,
      permanent: true
    }
  })
  
  // Delete file versions
  await client
    .from('file_versions')
    .delete()
    .eq('file_id', fileId)
  
  // Delete file references
  await client
    .from('file_references')
    .delete()
    .or(`parent_file_id.eq.${fileId},child_file_id.eq.${fileId}`)
  
  // Permanently delete the file
  const { error } = await client
    .from('files')
    .delete()
    .eq('id', fileId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get deleted files (trash) for an organization
 * Optionally filter by vault or folder path
 * Returns empty array if deleted_at column doesn't exist (migration not run)
 */
export async function getDeletedFiles(
  orgId: string,
  options?: {
    vaultId?: string
    folderPath?: string  // Get deleted files that were in this folder
  }
): Promise<{ files: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  try {
    let query = client
      .from('files')
      .select(`
        id,
        file_path,
        file_name,
        extension,
        file_type,
        part_number,
        description,
        revision,
        version,
        content_hash,
        file_size,
        state,
        deleted_at,
        deleted_by,
        vault_id,
        org_id,
        updated_at,
        deleted_by_user:users!deleted_by(email, full_name, avatar_url)
      `)
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    
    if (options?.vaultId) {
      query = query.eq('vault_id', options.vaultId)
    }
    
    if (options?.folderPath) {
      // Match files that were in this folder or subfolders
      query = query.ilike('file_path', `${options.folderPath}%`)
    }
    
    const { data, error } = await query
    
    if (error) {
      // If column doesn't exist, return empty (trash feature not available)
      if (error.message?.includes('deleted_at') || error.message?.includes('column')) {
        console.warn('Trash feature not available - run migration to enable')
        return { files: [] }
      }
      return { files: [], error: error.message }
    }
    
    return { files: data || [] }
  } catch (err) {
    console.error('Error fetching deleted files:', err)
    return { files: [] }
  }
}

/**
 * Get count of deleted files (for badge display)
 * Returns 0 if deleted_at column doesn't exist (migration not run)
 */
export async function getDeletedFilesCount(
  orgId: string,
  vaultId?: string
): Promise<{ count: number; error?: string }> {
  const client = getSupabaseClient()
  
  try {
    let query = client
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
    
    if (vaultId) {
      query = query.eq('vault_id', vaultId)
    }
    
    const { count, error } = await query
    
    if (error) {
      // If column doesn't exist, return 0 (trash feature not available)
      if (error.message?.includes('deleted_at') || error.message?.includes('column')) {
        return { count: 0 }
      }
      return { count: 0, error: error.message }
    }
    
    return { count: count || 0 }
  } catch (err) {
    return { count: 0 }
  }
}

/**
 * Empty the trash - permanently delete all trashed files
 * Admin only operation
 */
export async function emptyTrash(
  orgId: string,
  userId: string,
  vaultId?: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const client = getSupabaseClient()
  
  // First get all trashed files
  let query = client
    .from('files')
    .select('id')
    .eq('org_id', orgId)
    .not('deleted_at', 'is', null)
  
  if (vaultId) {
    query = query.eq('vault_id', vaultId)
  }
  
  const { data: trashedFiles, error: fetchError } = await query
  
  if (fetchError) {
    return { success: false, deleted: 0, error: fetchError.message }
  }
  
  if (!trashedFiles || trashedFiles.length === 0) {
    return { success: true, deleted: 0 }
  }
  
  // Delete each file permanently
  let deleted = 0
  for (const file of trashedFiles) {
    const result = await permanentlyDeleteFile(file.id, userId)
    if (result.success) {
      deleted++
    }
  }
  
  return { success: true, deleted }
}