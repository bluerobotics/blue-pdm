// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
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

// ============================================
// Email/Password Auth (for Users and Suppliers)
// ============================================

export async function signInWithEmail(email: string, password: string) {
  const client = getSupabaseClient()
  authLog('info', 'signInWithEmail called', { email })
  
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) {
      authLog('error', 'Email sign-in failed', { error: error.message })
      return { data: null, error }
    }
    
    authLog('info', 'Email sign-in successful', { userId: data.user?.id?.substring(0, 8) })
    return { data, error: null }
  } catch (err) {
    authLog('error', 'signInWithEmail exception', { error: String(err) })
    return { data: null, error: err as Error }
  }
}

export async function signUpWithEmail(email: string, password: string, fullName?: string) {
  const client = getSupabaseClient()
  authLog('info', 'signUpWithEmail called', { email, hasName: !!fullName })
  
  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        }
      }
    })
    
    if (error) {
      authLog('error', 'Email sign-up failed', { error: error.message })
      return { data: null, error }
    }
    
    authLog('info', 'Email sign-up successful', { 
      userId: data.user?.id?.substring(0, 8),
      needsConfirmation: !data.session  // No session means email confirmation needed
    })
    return { data, error: null }
  } catch (err) {
    authLog('error', 'signUpWithEmail exception', { error: String(err) })
    return { data: null, error: err as Error }
  }
}

// ============================================
// Phone/SMS Auth (Best for China)
// ============================================

export async function signInWithPhone(phone: string) {
  const client = getSupabaseClient()
  authLog('info', 'signInWithPhone called - sending OTP', { phone: phone.substring(0, 6) + '...' })
  
  try {
    const { data, error } = await client.auth.signInWithOtp({
      phone,
      options: {
        // Channel can be 'sms' or 'whatsapp' (SMS works in China)
        channel: 'sms'
      }
    })
    
    if (error) {
      authLog('error', 'Phone OTP send failed', { error: error.message })
      return { data: null, error }
    }
    
    authLog('info', 'Phone OTP sent successfully')
    return { data, error: null }
  } catch (err) {
    authLog('error', 'signInWithPhone exception', { error: String(err) })
    return { data: null, error: err as Error }
  }
}

export async function verifyPhoneOTP(phone: string, token: string) {
  const client = getSupabaseClient()
  authLog('info', 'verifyPhoneOTP called', { phone: phone.substring(0, 6) + '...' })
  
  try {
    const { data, error } = await client.auth.verifyOtp({
      phone,
      token,
      type: 'sms'
    })
    
    if (error) {
      authLog('error', 'Phone OTP verification failed', { error: error.message })
      return { data: null, error }
    }
    
    authLog('info', 'Phone OTP verified successfully', { userId: data.user?.id?.substring(0, 8) })
    return { data, error: null }
  } catch (err) {
    authLog('error', 'verifyPhoneOTP exception', { error: String(err) })
    return { data: null, error: err as Error }
  }
}

// ============================================
// Supplier Account Check
// ============================================

export async function checkIfSupplierAccount(identifier: string): Promise<{
  isSupplier: boolean
  isInvitation?: boolean
  contactId?: string
  invitationId?: string
  supplierId?: string
  supplierName?: string
  fullName?: string
  contactName?: string
  authMethod?: 'email' | 'phone' | 'wechat'
  orgId?: string
}> {
  authLog('info', 'checkIfSupplierAccount called', { identifier: identifier.substring(0, 5) + '...' })
  
  try {
    const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
    const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    
    // Call the database function
    const response = await fetch(`${url}/rest/v1/rpc/is_supplier_account`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_identifier: identifier })
    })
    
    const result = await response.json()
    authLog('debug', 'Supplier account check result', result)
    
    if (result && result.is_supplier) {
      return {
        isSupplier: true,
        isInvitation: result.is_invitation || false,
        contactId: result.contact_id,
        invitationId: result.invitation_id,
        supplierId: result.supplier_id,
        supplierName: result.supplier_name,
        fullName: result.full_name,
        contactName: result.contact_name,
        authMethod: result.auth_method,
        orgId: result.org_id
      }
    }
    
    return { isSupplier: false }
  } catch (err) {
    authLog('error', 'checkIfSupplierAccount failed', { error: String(err) })
    return { isSupplier: false }
  }
}

// ============================================
// Supplier Contact Profile
// ============================================

export async function getSupplierContact(authUserId: string) {
  authLog('debug', 'getSupplierContact called', { authUserId: authUserId?.substring(0, 8) + '...' })
  
  try {
    const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
    const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    const accessToken = currentAccessToken || key
    
    const response = await fetch(
      `${url}/rest/v1/supplier_contacts?select=*,supplier:suppliers(id,name,code,org_id)&auth_user_id=eq.${authUserId}`, 
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )
    const data = await response.json()
    
    if (data && data.length > 0) {
      authLog('debug', 'Found supplier contact', { contactId: data[0].id })
      return { contact: data[0], error: null }
    }
    return { contact: null, error: new Error('Supplier contact not found') }
  } catch (err) {
    authLog('error', 'getSupplierContact failed', { error: String(err) })
    return { contact: null, error: err as Error }
  }
}

export async function signOut() {
  const client = getSupabaseClient()
  
  // Get current user to end their session
  const { data: { user } } = await client.auth.getUser()
  if (user) {
    await endDeviceSession(user.id)
  }
  
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

export async function getUserProfile(userId: string, options?: { maxRetries?: number }) {
  authLog('debug', 'getUserProfile called', { userId: userId?.substring(0, 8) + '...', hasToken: !!currentAccessToken })
  
  // Use raw fetch - Supabase client methods hang
  const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
  const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const accessToken = currentAccessToken || key
  
  // Retry logic: new users may not have public.users record yet (trigger race condition)
  const maxRetries = options?.maxRetries ?? 3
  const retryDelays = [500, 1000, 2000] // ms
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      authLog('debug', 'Fetching profile...', { attempt: attempt + 1 })
      
      const response = await fetch(`${url}/rest/v1/users?select=id,email,role,org_id,full_name,avatar_url&id=eq.${userId}`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
      const data = await response.json()
      authLog('debug', 'Profile fetch result', { status: response.status, hasData: data?.length > 0, attempt: attempt + 1 })
      
      if (data && data.length > 0) {
        return { profile: data[0], error: null }
      }
      
      // User not found - might be a new user where trigger hasn't run yet
      if (attempt < maxRetries) {
        authLog('info', 'User not found, retrying...', { attempt: attempt + 1, nextDelayMs: retryDelays[attempt] })
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
      }
    } catch (err) {
      authLog('error', 'getUserProfile failed', { error: String(err), attempt: attempt + 1 })
      if (attempt === maxRetries) {
        return { profile: null, error: err as Error }
      }
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
    }
  }
  
  // After all retries, user still not found
  authLog('warn', 'User not found after retries - new user needs profile creation')
  return { profile: null, error: new Error('User not found - profile may still be creating') }
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

// Find and link organization by email domain, pending membership, or fetch existing org
export async function linkUserToOrganization(userId: string, userEmail: string) {
  authLog('info', 'linkUserToOrganization called', { userId: userId?.substring(0, 8) + '...', email: userEmail })
  
  // Use raw fetch - Supabase client methods hang
  const url = currentConfig?.url || import.meta.env.VITE_SUPABASE_URL
  const key = currentConfig?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const accessToken = currentAccessToken || key
  
  try {
    // First, check if user already has an org_id (with retry for new users)
    let userProfile: { org_id?: string } | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const userResponse = await fetch(`${url}/rest/v1/users?select=org_id&id=eq.${userId}`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
      const userData = await userResponse.json()
      userProfile = userData?.[0] || null
      
      if (userProfile) break
      
      // User record might not exist yet (trigger still running), wait and retry
      if (attempt < 2) {
        authLog('info', 'User record not found, waiting for trigger...', { attempt: attempt + 1 })
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
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
        authLog('info', 'Found existing org', { 
          orgName: orgData[0].name,
          hasSettings: !!orgData[0].settings,
          settingsApiUrl: orgData[0].settings?.api_url,
          settingsKeys: Object.keys(orgData[0].settings || {})
        })
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
      authLog('info', 'Found matching org', { 
        orgName: matchingOrg.name,
        hasSettings: !!matchingOrg.settings,
        settingsApiUrl: matchingOrg.settings?.api_url,
        settingsKeys: Object.keys(matchingOrg.settings || {})
      })
      
      // Update the user's org_id in the database so future logins remember the org
      // This also ensures sessions are registered with the correct org_id immediately
      try {
        const updateResponse = await fetch(`${url}/rest/v1/users?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ org_id: matchingOrg.id })
        })
        
        if (updateResponse.ok) {
          authLog('info', 'Updated user org_id in database', { orgId: matchingOrg.id?.substring(0, 8) + '...' })
        } else {
          authLog('warn', 'Failed to update user org_id', { status: updateResponse.status })
        }
      } catch (updateErr) {
        authLog('warn', 'Error updating user org_id', { error: String(updateErr) })
      }
      
      return { org: matchingOrg, error: null }
    }
    
    authLog('info', 'No org found by domain, checking pending_org_members...', { domain })
    
    // Check pending_org_members for this email (in case trigger didn't run)
    // Fetch all relevant fields so we can apply the correct permissions
    // Use ilike for case-insensitive matching (admin may have typed email differently)
    // Escape any % or _ characters in email to prevent pattern matching issues
    const escapedEmail = userEmail.toLowerCase().replace(/%/g, '\\%').replace(/_/g, '\\_')
    const pendingResponse = await fetch(
      `${url}/rest/v1/pending_org_members?select=id,org_id,role,full_name,team_ids,vault_ids,workflow_role_ids,created_by&email=ilike.${encodeURIComponent(escapedEmail)}&claimed_at=is.null&limit=1`, 
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )
    const pendingData = await pendingResponse.json()
    const pendingMember = pendingData?.[0]
    
    if (pendingMember?.org_id) {
      authLog('info', 'Found pending membership, linking user to org', { 
        orgId: pendingMember.org_id?.substring(0, 8) + '...',
        assignedRole: pendingMember.role,
        hasTeamIds: !!pendingMember.team_ids?.length,
        hasVaultIds: !!pendingMember.vault_ids?.length,
        hasWorkflowRoleIds: !!pendingMember.workflow_role_ids?.length
      })
      
      // Fetch the organization
      const orgResponse = await fetch(`${url}/rest/v1/organizations?select=*&id=eq.${pendingMember.org_id}`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
      const orgData = await orgResponse.json()
      const pendingOrg = orgData?.[0]
      
      if (pendingOrg) {
        // Update user's org_id and role from pending membership
        // IMPORTANT: Use the role from pending_org_members, default to 'viewer' only if missing
        const assignedRole = pendingMember.role || 'viewer'
        try {
          await fetch(`${url}/rest/v1/users?id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ 
              org_id: pendingOrg.id, 
              role: assignedRole,
              full_name: pendingMember.full_name || undefined // Preserve name if set in invite
            })
          })
          authLog('info', 'Updated user from pending membership', { 
            assignedRole, 
            orgId: pendingOrg.id?.substring(0, 8) + '...',
            fullNameFromInvite: pendingMember.full_name || null
          })
          
          // Mark pending membership as claimed
          await fetch(`${url}/rest/v1/pending_org_members?id=eq.${pendingMember.id}`, {
            method: 'PATCH',
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ claimed_at: new Date().toISOString(), claimed_by: userId })
          })
          authLog('info', 'Marked pending membership as claimed', { pendingMemberId: pendingMember.id?.substring(0, 8) + '...' })
          
          // Call RPC to apply team memberships, vault access, and workflow roles
          // This is a backup in case the DB AFTER INSERT trigger didn't fire
          try {
            const rpcResponse = await fetch(`${url}/rest/v1/rpc/apply_pending_team_memberships`, {
              method: 'POST',
              headers: {
                'apikey': key,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ p_user_id: userId })
            })
            if (rpcResponse.ok) {
              authLog('info', 'Applied pending team memberships via RPC')
            } else {
              authLog('warn', 'RPC apply_pending_team_memberships returned non-OK', { status: rpcResponse.status })
            }
          } catch (rpcErr) {
            authLog('warn', 'Failed to call apply_pending_team_memberships RPC (may already be applied)', { error: String(rpcErr) })
          }
        } catch (updateErr) {
          authLog('warn', 'Error updating user from pending membership', { error: String(updateErr) })
        }
        
        return { org: pendingOrg, error: null }
      }
    }
    
    // No pending membership found - try joining by org slug from config
    authLog('info', 'No pending membership, trying org slug from config...')
    
    // Import dynamically to avoid circular dependency
    const { loadConfig } = await import('./supabaseConfig')
    const config = loadConfig()
    
    // First try the explicit org slug from config
    const orgSlugToUse = config?.orgSlug
    
    if (orgSlugToUse) {
      authLog('info', 'Found org slug in config, calling join_org_by_slug', { slug: orgSlugToUse })
      
      // Retry up to 5 times with delay if user record isn't ready yet
      const maxRetries = 5
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const rpcResponse = await fetch(`${url}/rest/v1/rpc/join_org_by_slug`, {
            method: 'POST',
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_org_slug: orgSlugToUse })
          })
          
          const result = await rpcResponse.json()
          authLog('info', 'join_org_by_slug result', { success: result?.success, orgName: result?.org_name, retry: result?.retry, attempt })
          
          if (result?.success && result?.org_id) {
            // Successfully joined - fetch the full organization
            const orgResponse = await fetch(`${url}/rest/v1/organizations?select=*&id=eq.${result.org_id}`, {
              headers: {
                'apikey': key,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            })
            const orgData = await orgResponse.json()
            
            if (orgData?.[0]) {
              authLog('info', 'User joined org via slug', { orgName: orgData[0].name, addedToDefaultTeam: result.added_to_default_team })
              return { org: orgData[0], error: null }
            }
          } else if (result?.retry && attempt < maxRetries) {
            // User record not ready yet, wait and retry
            authLog('info', 'User record not ready, retrying join_org_by_slug...', { attempt, maxRetries })
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            continue
          } else if (result?.error) {
            authLog('warn', 'join_org_by_slug failed', { error: result.error })
            break
          }
        } catch (rpcErr) {
          authLog('warn', 'Failed to call join_org_by_slug RPC', { error: String(rpcErr), attempt })
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            continue
          }
        }
        break
      }
    }
    
    // Final fallback: if there's only ONE org in this database, join it
    // This handles legacy org codes that don't have a slug
    // Each organization has their own Supabase backend, so if a user has the org code,
    // they're connecting to THAT org's backend - the only org there is the right one
    if (allOrgs && allOrgs.length === 1) {
      authLog('info', 'Only one org in database, attempting to join via slug', { slug: allOrgs[0].slug })
      
      // Retry up to 5 times with delay if user record isn't ready yet
      const maxRetries = 5
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const rpcResponse = await fetch(`${url}/rest/v1/rpc/join_org_by_slug`, {
            method: 'POST',
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_org_slug: allOrgs[0].slug })
          })
          
          const result = await rpcResponse.json()
          authLog('info', 'join_org_by_slug (single org fallback) result', { success: result?.success, orgName: result?.org_name, retry: result?.retry, attempt })
          
          if (result?.success && result?.org_id) {
            authLog('info', 'User joined the only org in database', { orgName: allOrgs[0].name })
            return { org: allOrgs[0], error: null }
          } else if (result?.retry && attempt < maxRetries) {
            // User record not ready yet, wait and retry
            authLog('info', 'User record not ready, retrying join_org_by_slug (single org fallback)...', { attempt, maxRetries })
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            continue
          } else if (result?.error) {
            authLog('warn', 'join_org_by_slug (single org fallback) failed', { error: result.error })
            break
          }
        } catch (rpcErr) {
          authLog('warn', 'Failed to call join_org_by_slug for single org fallback', { error: String(rpcErr), attempt })
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            continue
          }
        }
        break
      }
    }
    
    authLog('warn', 'No organization found for domain, pending membership, or org slug', { domain, orgsInDb: allOrgs?.length })
    return { org: null, error: new Error(`No organization found for @${domain}. If you were invited, please contact your administrator.`) }
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
  
  if (options?.workflow_state_ids && options.workflow_state_ids.length > 0) {
    query = query.in('workflow_state_id', options.workflow_state_ids)
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
  
  // First get files with their checked_out_by user IDs
  const { data: files, error: filesError } = await client
    .from('files')
    .select('id, checked_out_by')
    .in('id', fileIds)
    .not('checked_out_by', 'is', null)
  
  if (filesError) return { users: {}, error: filesError }
  if (!files || files.length === 0) return { users: {}, error: null }
  
  // Get unique user IDs
  const userIds = [...new Set(files.map(f => f.checked_out_by).filter(Boolean))]
  
  // Fetch user info separately
  const { data: usersData, error: usersError } = await client
    .from('users')
    .select('id, email, full_name, avatar_url')
    .in('id', userIds)
  
  if (usersError) return { users: {}, error: usersError }
  
  // Create a user lookup map
  const userLookup = new Map(usersData?.map(u => [u.id, u]) || [])
  
  // Convert to a map for easy lookup by file ID
  const users: Record<string, { email: string; full_name: string; avatar_url?: string }> = {}
  for (const file of files) {
    const user = userLookup.get(file.checked_out_by)
    if (user) {
      users[file.id] = {
        email: user.email,
        full_name: user.full_name || '',
        avatar_url: user.avatar_url || undefined
      }
    }
  }
  
  return { users, error: null }
}

/**
 * Get basic user info by ID (for checkout display)
 * Used when realtime updates come in and we need to show who checked out a file
 */
export async function getUserBasicInfo(userId: string): Promise<{ 
  user: { email: string; full_name: string; avatar_url?: string } | null; 
  error?: string 
}> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('users')
    .select('email, full_name, avatar_url')
    .eq('id', userId)
    .single()
  
  if (error) {
    console.error('[getUserBasicInfo] Failed to fetch user:', error.message)
    return { user: null, error: error.message }
  }
  
  return { 
    user: data ? {
      email: data.email,
      full_name: data.full_name || '',
      avatar_url: data.avatar_url || undefined
    } : null 
  }
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
  base64Content: string,
  metadata?: {
    partNumber?: string | null
    description?: string | null
    revision?: string | null
    customProperties?: Record<string, string | number | null>
  }
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
      logFn('debug', '[syncFile] Updating active file', { filePath, existingId: activeFile.id, metadata })
      
      // Build update payload - only include metadata fields if provided
      const updatePayload: Record<string, unknown> = {
        content_hash: contentHash,
        file_size: fileSize,
        version: activeFile.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: userId
      }
      
      // Only update metadata if provided (preserve existing values otherwise)
      if (metadata?.partNumber !== undefined) {
        updatePayload.part_number = metadata.partNumber
      }
      if (metadata?.description !== undefined) {
        updatePayload.description = metadata.description
      }
      if (metadata?.customProperties !== undefined) {
        updatePayload.custom_properties = metadata.customProperties
      }
      
      const { data, error } = await client
        .from('files')
        .update(updatePayload)
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
        workflow_state_id: data.workflow_state_id,
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
      logFn('debug', '[syncFile] Inserting new file', { filePath, vaultId, orgId, metadata })
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
          revision: metadata?.revision || 'A',
          version: 1,
          part_number: metadata?.partNumber || null,
          description: metadata?.description || null,
          custom_properties: metadata?.customProperties || {},
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
  
  // Get machine ID and name for tracking
  const { getMachineId, getMachineName } = await import('./backup')
  const machineId = await getMachineId()
  const machineName = await getMachineName()
  
  // First check if file is already checked out (simple query without join)
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('id, file_name, checked_out_by, checked_out_by_machine_id')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (file.checked_out_by && file.checked_out_by !== userId) {
    // File is checked out by someone else - fetch their info separately
    const { data: checkedOutUser } = await client
      .from('users')
      .select('email, full_name')
      .eq('id', file.checked_out_by)
      .single()
    
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
      lock_message: message || null,
      checked_out_by_machine_id: machineId,
      checked_out_by_machine_name: machineName,
      updated_by: userId,
      updated_at: new Date().toISOString()
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
): Promise<{ success: boolean; file?: any; error?: string | null; contentChanged?: boolean; metadataChanged?: boolean; machineMismatchWarning?: string | null }> {
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
  
  // Check if checking in from a different machine
  const { getMachineId } = await import('./backup')
  const currentMachineId = await getMachineId()
  const checkoutMachineId = file.checked_out_by_machine_id
  
  // Warn if checking in from a different machine (but allow it)
  let machineMismatchWarning: string | null = null
  if (checkoutMachineId && checkoutMachineId !== currentMachineId) {
    const checkoutMachineName = file.checked_out_by_machine_name || 'another computer'
    machineMismatchWarning = `Warning: This file was checked out on ${checkoutMachineName}. You are checking it in from a different computer.`
  }
  
  // Prepare update data
  const updateData: Record<string, any> = {
    checked_out_by: null,
    checked_out_at: null,
    lock_message: null,
    checked_out_by_machine_id: null,
    checked_out_by_machine_name: null,
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
      workflow_state_id: file.workflow_state_id,
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
  
  return { success: true, file: data, error: null, contentChanged, metadataChanged, machineMismatchWarning }
}

/**
 * Sync SolidWorks file metadata and create a new version
 * This can be called without having the file checked out (for metadata-only updates from SW properties)
 */
export async function syncSolidWorksFileMetadata(
  fileId: string,
  userId: string,
  metadata: {
    part_number?: string | null
    description?: string | null
    revision?: string | null
    custom_properties?: Record<string, string | number | null>
  }
): Promise<{ success: boolean; file?: any; error?: string | null }> {
  const client = getSupabaseClient()
  
  // Get current file data
  const { data: file, error: fetchError } = await client
    .from('files')
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  // Check if any metadata actually changed
  const partNumberChanged = metadata.part_number !== undefined && 
    (metadata.part_number || null) !== (file.part_number || null)
  const descriptionChanged = metadata.description !== undefined && 
    (metadata.description || null) !== (file.description || null)
  const revisionChanged = metadata.revision !== undefined && 
    (metadata.revision || null) !== (file.revision || null)
  const customPropsChanged = metadata.custom_properties !== undefined
  
  if (!partNumberChanged && !descriptionChanged && !revisionChanged && !customPropsChanged) {
    // No changes - return current file
    return { success: true, file, error: null }
  }
  
  // Build update data
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId
  }
  
  if (metadata.part_number !== undefined) {
    updateData.part_number = metadata.part_number
  }
  if (metadata.description !== undefined) {
    updateData.description = metadata.description
  }
  if (metadata.revision !== undefined) {
    updateData.revision = metadata.revision
  }
  if (metadata.custom_properties !== undefined) {
    updateData.custom_properties = metadata.custom_properties
  }
  
  // Create a new version for metadata changes
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
  
  // Create version record
  await client.from('file_versions').insert({
    file_id: fileId,
    version: newVersion,
    revision: updateData.revision || file.revision,
    content_hash: file.content_hash,
    file_size: file.file_size,
    workflow_state_id: file.workflow_state_id,
    created_by: userId,
    comment: 'Metadata updated from SolidWorks file properties'
  })
  
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
  const changedFields: string[] = []
  if (partNumberChanged) changedFields.push('part_number')
  if (descriptionChanged) changedFields.push('description')
  if (revisionChanged) changedFields.push('revision')
  if (customPropsChanged) changedFields.push('custom_properties')
  
  await client.from('activity').insert({
    org_id: file.org_id,
    file_id: fileId,
    user_id: userId,
    action: 'checkin',
    details: { 
      metadataSync: true,
      changedFields,
      source: 'solidworks'
    }
  })
  
  return { success: true, file: data, error: null }
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
      lock_message: null,
      checked_out_by_machine_id: null,
      checked_out_by_machine_name: null
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
    .select('*')
    .eq('id', fileId)
    .single()
  
  if (fetchError) {
    return { success: false, error: fetchError.message }
  }
  
  if (!file.checked_out_by) {
    return { success: false, error: 'File is not checked out' }
  }
  
  // Get the checked out user info separately
  let checkedOutUser: { id: string; email: string; full_name: string } | null = null
  const { data: userData } = await client
    .from('users')
    .select('id, email, full_name')
    .eq('id', file.checked_out_by)
    .single()
  
  if (userData) {
    checkedOutUser = userData
  }
  
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
  
  // Delete any pending_org_members entries for this user's email in this org
  // This allows the user to be re-invited later without constraint violations
  await client
    .from('pending_org_members')
    .delete()
    .eq('org_id', adminOrgId)
    .ilike('email', targetUser.email)
  
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
    return { success: false, error: 'No user found with that email. They must sign in to BluePLM at least once first.' }
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

/**
 * Get the effective vault access for a user (combining team + individual permissions)
 * Uses the PostgreSQL get_user_vault_access function
 * Returns empty array if user has no restrictions (can access all vaults)
 */
export async function getEffectiveUserVaultAccess(userId: string): Promise<{ vaultIds: string[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client.rpc('get_user_vault_access', { p_user_id: userId })
  
  if (error) {
    return { vaultIds: [], error: error.message }
  }
  
  return { vaultIds: data?.map((r: { vault_id: string }) => r.vault_id) || [] }
}

/**
 * Get accessible vaults for a user in their organization
 * - Admins see all vaults
 * - If user has no vault restrictions (empty result from get_user_vault_access), they see all vaults
 * - Otherwise, only returns vaults they have been granted access to
 */
export async function getAccessibleVaults(
  userId: string,
  orgId: string,
  userRole: string
): Promise<{ 
  vaults: Array<{ id: string; name: string; slug: string; description: string | null; is_default: boolean; created_at: string }>;
  error?: string 
}> {
  const client = getSupabaseClient()
  
  // Get all vaults for the org first
  const { data: allVaults, error: vaultsError } = await client
    .from('vaults')
    .select('id, name, slug, description, is_default, created_at')
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .order('name')
  
  if (vaultsError) {
    return { vaults: [], error: vaultsError.message }
  }
  
  if (!allVaults || allVaults.length === 0) {
    return { vaults: [] }
  }
  
  // Admins always see all vaults
  if (userRole === 'admin') {
    return { vaults: allVaults }
  }
  
  // Get user's effective vault access (from teams + individual)
  const { vaultIds: accessibleVaultIds, error: accessError } = await getEffectiveUserVaultAccess(userId)
  
  if (accessError) {
    return { vaults: [], error: accessError }
  }
  
  // If no restrictions exist for this user, they can see all vaults
  if (accessibleVaultIds.length === 0) {
    return { vaults: allVaults }
  }
  
  // Filter vaults to only those the user has access to
  const accessibleVaultIdSet = new Set(accessibleVaultIds)
  const filteredVaults = allVaults.filter(v => accessibleVaultIdSet.has(v.id))
  
  return { vaults: filteredVaults }
}

// ============================================
// Teams & Permissions (Permission checking)
// ============================================

import type { PermissionAction } from '../types/permissions'

/**
 * Get all teams a user belongs to
 */
export async function getUserTeams(
  userId: string
): Promise<{ teams: Array<{ id: string; name: string; color: string; icon: string }> | null; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('team_members')
    .select(`
      team:teams(id, name, color, icon)
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { teams: null, error: error.message }
  }
  
  const teams = (data || [])
    .map(m => m.team)
    .filter(Boolean) as Array<{ id: string; name: string; color: string; icon: string }>
  
  return { teams }
}

/**
 * Get all effective permissions for a user (across all their teams)
 * Returns a map of resource -> array of actions
 */
export async function getUserPermissions(
  userId: string,
  userRole?: 'admin' | 'engineer' | 'viewer'
): Promise<{ permissions: Record<string, PermissionAction[]> | null; error?: string }> {
  // Admins have full access - return a special flag
  if (userRole === 'admin') {
    return { permissions: { __admin__: ['view', 'create', 'edit', 'delete', 'admin'] } }
  }
  
  const client = getSupabaseClient()
  
  // Get all team memberships and their permissions
  const { data, error } = await client
    .from('team_members')
    .select(`
      team_id,
      team:teams!inner(
        id,
        team_permissions(resource, actions)
      )
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { permissions: null, error: error.message }
  }
  
  // Merge permissions from all teams
  const mergedPermissions: Record<string, Set<PermissionAction>> = {}
  
  for (const membership of data || []) {
    const team = membership.team as any
    const perms = team?.team_permissions || []
    
    for (const perm of perms) {
      if (!mergedPermissions[perm.resource]) {
        mergedPermissions[perm.resource] = new Set()
      }
      for (const action of perm.actions || []) {
        mergedPermissions[perm.resource].add(action as PermissionAction)
      }
    }
  }
  
  // Convert sets to arrays
  const permissions: Record<string, PermissionAction[]> = {}
  for (const [resource, actionSet] of Object.entries(mergedPermissions)) {
    permissions[resource] = Array.from(actionSet)
  }
  
  return { permissions }
}

/**
 * Check if a user has a specific permission on a resource
 * This is the main function to use for permission checks in the UI
 */
export async function checkPermission(
  userId: string,
  resource: string,
  action: PermissionAction,
  userRole?: 'admin' | 'engineer' | 'viewer'
): Promise<{ hasPermission: boolean; error?: string }> {
  // Admins always have full access
  if (userRole === 'admin') {
    return { hasPermission: true }
  }
  
  const client = getSupabaseClient()
  
  // Check if user has this permission through any of their teams
  const { data, error } = await client
    .from('team_members')
    .select(`
      team_id,
      team:teams!inner(
        team_permissions!inner(resource, actions)
      )
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { hasPermission: false, error: error.message }
  }
  
  // Check if any team has the required permission
  for (const membership of data || []) {
    const team = membership.team as any
    const perms = team?.team_permissions || []
    
    for (const perm of perms) {
      if (perm.resource === resource) {
        if (perm.actions?.includes(action) || perm.actions?.includes('admin')) {
          return { hasPermission: true }
        }
      }
    }
  }
  
  return { hasPermission: false }
}

/**
 * Check multiple permissions at once (more efficient for bulk checks)
 */
export async function checkPermissions(
  userId: string,
  checks: Array<{ resource: string; action: PermissionAction }>,
  userRole?: 'admin' | 'engineer' | 'viewer'
): Promise<{ results: Record<string, boolean>; error?: string }> {
  // Admins always have full access
  if (userRole === 'admin') {
    const results: Record<string, boolean> = {}
    for (const check of checks) {
      results[`${check.resource}:${check.action}`] = true
    }
    return { results }
  }
  
  // Get all permissions once
  const { permissions, error } = await getUserPermissions(userId, userRole)
  
  if (error || !permissions) {
    return { results: {}, error }
  }
  
  // Check each permission
  const results: Record<string, boolean> = {}
  for (const check of checks) {
    const key = `${check.resource}:${check.action}`
    const resourcePerms = permissions[check.resource] || []
    results[key] = resourcePerms.includes(check.action) || resourcePerms.includes('admin')
  }
  
  return { results }
}

/**
 * Get all teams in an organization
 */
export async function getOrgTeams(
  orgId: string
): Promise<{ teams: any[] | null; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('teams')
    .select(`
      *,
      team_members(count),
      team_permissions(count)
    `)
    .eq('org_id', orgId)
    .order('name')
  
  if (error) {
    return { teams: null, error: error.message }
  }
  
  // Transform to include counts
  const teams = (data || []).map(team => ({
    ...team,
    member_count: team.team_members?.[0]?.count || 0,
    permissions_count: team.team_permissions?.[0]?.count || 0
  }))
  
  return { teams }
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
  
  // Check if workflow state actually changed
  if (!updates.workflow_state_id || updates.workflow_state_id === file.workflow_state_id) {
    return { success: true, file, error: null }
  }
  
  // Prepare update data - state changes do NOT increment version
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId,
    workflow_state_id: updates.workflow_state_id,
    state_changed_at: new Date().toISOString(),
    state_changed_by: userId
  }
  
  // Update the file
  const { data, error } = await client
    .from('files')
    .update(updateData)
    .eq('id', fileId)
    .select('*, workflow_state:workflow_states(*)')
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
      old_state_id: file.workflow_state_id,
      new_state_id: updates.workflow_state_id
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

// ============================================
// Reviews & Notifications
// ============================================

import type { Review, ReviewResponse, Notification, ReviewStatus } from '../types/database'

/**
 * Get all users in an organization (for selecting reviewers)
 */
export async function getOrgUsers(orgId: string): Promise<{ users: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('users')
    .select('id, email, full_name, avatar_url, role')
    .eq('org_id', orgId)
    .order('full_name', { ascending: true })
  
  if (error) {
    return { users: [], error: error.message }
  }
  
  return { users: data || [] }
}

/**
 * Create a review request for a file
 */
export async function createReviewRequest(
  orgId: string,
  fileId: string,
  vaultId: string | null,
  requestedBy: string,
  reviewerIds: string[],
  fileVersion: number,
  title?: string,
  message?: string,
  dueDate?: string,
  priority?: 'low' | 'normal' | 'high' | 'urgent'
): Promise<{ review: Review | null; error?: string }> {
  const client = getSupabaseClient()
  
  // Create the review
  const { data: review, error: reviewError } = await client
    .from('reviews')
    .insert({
      org_id: orgId,
      file_id: fileId,
      vault_id: vaultId,
      requested_by: requestedBy,
      title: title || null,
      due_date: dueDate || null,
      priority: priority || 'normal',
      message: message || null,
      file_version: fileVersion,
      status: 'pending'
    })
    .select()
    .single()
  
  if (reviewError) {
    return { review: null, error: reviewError.message }
  }
  
  // Get file info and requester info for notifications
  const { data: fileData } = await client
    .from('files')
    .select('file_name')
    .eq('id', fileId)
    .single()
  
  const { data: requesterData } = await client
    .from('users')
    .select('full_name, email')
    .eq('id', requestedBy)
    .single()
  
  const fileName = fileData?.file_name || 'File'
  const requesterName = requesterData?.full_name || requesterData?.email || 'Someone'
  
  // Create review responses for each reviewer
  for (const reviewerId of reviewerIds) {
    // Create pending response
    await client
      .from('review_responses')
      .insert({
        review_id: review.id,
        reviewer_id: reviewerId,
        status: 'pending'
      })
    
    // Create notification
    await client
      .from('notifications')
      .insert({
        org_id: orgId,
        user_id: reviewerId,
        type: 'review_request',
        title: `Review Requested: ${fileName}`,
        message: `${requesterName} requested your review${message ? ': ' + message : ''}`,
        review_id: review.id,
        file_id: fileId,
        from_user_id: requestedBy
      })
  }
  
  return { review }
}

/**
 * Get reviews for a user (reviews they requested or need to respond to)
 */
export async function getMyReviews(
  userId: string,
  orgId: string,
  options?: {
    status?: ReviewStatus
    asRequester?: boolean
    asReviewer?: boolean
  }
): Promise<{ reviews: Review[]; error?: string }> {
  const client = getSupabaseClient()
  
  const reviews: Review[] = []
  
  // Get reviews requested by user
  if (options?.asRequester !== false) {
    let query = client
      .from('reviews')
      .select(`
        *,
        file:files(file_name, file_path, extension),
        requester:users!requested_by(email, full_name, avatar_url),
        responses:review_responses(
          *,
          reviewer:users!reviewer_id(email, full_name, avatar_url)
        )
      `)
      .eq('org_id', orgId)
      .eq('requested_by', userId)
      .order('created_at', { ascending: false })
    
    if (options?.status) {
      query = query.eq('status', options.status)
    }
    
    const { data } = await query
    if (data) reviews.push(...(data as unknown as Review[]))
  }
  
  // Get reviews where user is a reviewer
  if (options?.asReviewer !== false) {
    const { data: responseData } = await client
      .from('review_responses')
      .select('review_id')
      .eq('reviewer_id', userId)
    
    if (responseData && responseData.length > 0) {
      const reviewIds = responseData.map(r => r.review_id)
      
      let query = client
        .from('reviews')
        .select(`
          *,
          file:files(file_name, file_path, extension),
          requester:users!requested_by(email, full_name, avatar_url),
          responses:review_responses(
            *,
            reviewer:users!reviewer_id(email, full_name, avatar_url)
          )
        `)
        .in('id', reviewIds)
        .order('created_at', { ascending: false })
      
      if (options?.status) {
        query = query.eq('status', options.status)
      }
      
      const { data } = await query
      if (data) {
        // Only add reviews not already added (avoid duplicates)
        for (const review of data as unknown as Review[]) {
          if (!reviews.find(r => r.id === review.id)) {
            reviews.push(review)
          }
        }
      }
    }
  }
  
  // Sort by created_at descending
  reviews.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  
  return { reviews }
}

/**
 * Get pending reviews where the user needs to respond
 */
export async function getPendingReviewsForUser(
  userId: string,
  orgId: string
): Promise<{ reviews: Review[]; error?: string }> {
  const client = getSupabaseClient()
  
  // Get pending review response IDs for this user
  const { data: pendingResponses, error: responsesError } = await client
    .from('review_responses')
    .select('review_id')
    .eq('reviewer_id', userId)
    .eq('status', 'pending')
  
  if (responsesError) {
    return { reviews: [], error: responsesError.message }
  }
  
  if (!pendingResponses || pendingResponses.length === 0) {
    return { reviews: [] }
  }
  
  const reviewIds = pendingResponses.map(r => r.review_id)
  
  const { data, error } = await client
    .from('reviews')
    .select(`
      *,
      file:files(file_name, file_path, extension),
      requester:users!requested_by(email, full_name, avatar_url),
      responses:review_responses(
        *,
        reviewer:users!reviewer_id(email, full_name, avatar_url)
      )
    `)
    .in('id', reviewIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  
  if (error) {
    return { reviews: [], error: error.message }
  }
  
  return { reviews: (data as unknown as Review[]) || [] }
}

/**
 * Respond to a review (approve/reject)
 */
export async function respondToReview(
  reviewId: string,
  reviewerId: string,
  status: 'approved' | 'rejected',
  comment?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Update the response
  const { error: responseError } = await client
    .from('review_responses')
    .update({
      status,
      comment: comment || null,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('review_id', reviewId)
    .eq('reviewer_id', reviewerId)
  
  if (responseError) {
    return { success: false, error: responseError.message }
  }
  
  // Get review info for notification
  const { data: review } = await client
    .from('reviews')
    .select(`
      *,
      file:files(file_name)
    `)
    .eq('id', reviewId)
    .single()
  
  if (review) {
    // Get reviewer name
    const { data: reviewerData } = await client
      .from('users')
      .select('full_name, email')
      .eq('id', reviewerId)
      .single()
    
    const reviewerName = reviewerData?.full_name || reviewerData?.email || 'Someone'
    const fileName = (review.file as any)?.file_name || 'File'
    
    // Notify the requester
    await client
      .from('notifications')
      .insert({
        org_id: review.org_id,
        user_id: review.requested_by,
        type: status === 'approved' ? 'review_approved' : 'review_rejected',
        title: `Review ${status === 'approved' ? 'Approved' : 'Rejected'}: ${fileName}`,
        message: `${reviewerName} ${status} the review${comment ? ': ' + comment : ''}`,
        review_id: reviewId,
        file_id: review.file_id,
        from_user_id: reviewerId
      })
    
    // Check if all reviewers have responded
    const { data: allResponses } = await client
      .from('review_responses')
      .select('status')
      .eq('review_id', reviewId)
    
    if (allResponses) {
      const allResponded = allResponses.every(r => r.status !== 'pending')
      
      if (allResponded) {
        const anyRejected = allResponses.some(r => r.status === 'rejected')
        
        // Update review status
        await client
          .from('reviews')
          .update({
            status: anyRejected ? 'rejected' : 'approved',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', reviewId)
      }
    }
  }
  
  return { success: true }
}

/**
 * Cancel a review request
 */
export async function cancelReview(
  reviewId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Verify user is the requester
  const { data: review, error: fetchError } = await client
    .from('reviews')
    .select('requested_by')
    .eq('id', reviewId)
    .single()
  
  if (fetchError || !review) {
    return { success: false, error: 'Review not found' }
  }
  
  if (review.requested_by !== userId) {
    return { success: false, error: 'Only the requester can cancel a review' }
  }
  
  const { error } = await client
    .from('reviews')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', reviewId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: string,
  options?: {
    unreadOnly?: boolean
    limit?: number
  }
): Promise<{ notifications: Notification[]; error?: string }> {
  const client = getSupabaseClient()
  
  let query = client
    .from('notifications')
    .select(`
      *,
      from_user:users!from_user_id(email, full_name, avatar_url),
      file:files(file_name, file_path)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (options?.unreadOnly) {
    query = query.eq('read', false)
  }
  
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  
  const { data, error } = await query
  
  if (error) {
    return { notifications: [], error: error.message }
  }
  
  return { notifications: (data as unknown as Notification[]) || [] }
}

/**
 * Get unread notification count
 */
export async function getUnreadNotificationCount(
  userId: string
): Promise<{ count: number; error?: string }> {
  const client = getSupabaseClient()
  
  const { count, error } = await client
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)
  
  if (error) {
    return { count: 0, error: error.message }
  }
  
  return { count: count || 0 }
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(
  notificationIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('notifications')
    .update({
      read: true,
      read_at: new Date().toISOString()
    })
    .in('id', notificationIds)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsRead(
  userId: string
): Promise<{ success: boolean; updated: number; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('notifications')
    .update({
      read: true,
      read_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('read', false)
    .select('id')
  
  if (error) {
    return { success: false, updated: 0, error: error.message }
  }
  
  return { success: true, updated: data?.length || 0 }
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('notifications')
    .delete()
    .eq('id', notificationId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Clear all notifications for a user
 */
export async function clearAllNotifications(
  userId: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .select('id')
  
  if (error) {
    return { success: false, deleted: 0, error: error.message }
  }
  
  return { success: true, deleted: data?.length || 0 }
}

/**
 * Request checkout from someone who has a file checked out
 * Sends a notification to the person who has the file
 */
export async function requestCheckout(
  orgId: string,
  fileId: string,
  fileName: string,
  requesterId: string,
  checkedOutById: string,
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get requester name
  const { data: requesterData } = await client
    .from('users')
    .select('full_name, email')
    .eq('id', requesterId)
    .single()
  
  const requesterName = requesterData?.full_name || requesterData?.email || 'Someone'
  
  // Create notification for the person who has the file checked out
  const { error } = await client
    .from('notifications')
    .insert({
      org_id: orgId,
      user_id: checkedOutById,
      type: 'checkout_request',
      title: `Checkout Requested: ${fileName}`,
      message: `${requesterName} is waiting for this file${message ? ': ' + message : ''}`,
      file_id: fileId,
      from_user_id: requesterId
    })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Create a custom notification to one or more users
 */
export async function createCustomNotification(
  orgId: string,
  fromUserId: string,
  toUserIds: string[],
  options: {
    type: string  // notification type
    category: 'review' | 'change' | 'purchasing' | 'quality' | 'workflow' | 'system'
    title: string
    message?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    actionType?: 'approve' | 'reject' | 'view' | 'respond'
    actionUrl?: string
    fileId?: string
    ecoId?: string
    poId?: string
  }
): Promise<{ success: boolean; count: number; error?: string }> {
  const client = getSupabaseClient()
  
  // Create notification for each recipient
  const notifications = toUserIds.map(userId => ({
    org_id: orgId,
    user_id: userId,
    type: options.type,
    category: options.category,
    title: options.title,
    message: options.message || null,
    priority: options.priority || 'normal',
    from_user_id: fromUserId,
    action_type: options.actionType || null,
    action_url: options.actionUrl || null,
    file_id: options.fileId || null,
    eco_id: options.ecoId || null,
    po_id: options.poId || null,
    read: false,
    action_completed: false
  }))
  
  const { data, error } = await client
    .from('notifications')
    .insert(notifications)
    .select()
  
  if (error) {
    return { success: false, count: 0, error: error.message }
  }
  
  return { success: true, count: data?.length || 0 }
}

/**
 * Send a generic file notification to a user
 */
export async function sendFileNotification(
  orgId: string,
  fileId: string,
  fileName: string,
  toUserId: string,
  fromUserId: string,
  type: 'mention' | 'file_updated' | 'checkout_request',
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  // Get sender name
  const { data: senderData } = await client
    .from('users')
    .select('full_name, email')
    .eq('id', fromUserId)
    .single()
  
  const senderName = senderData?.full_name || senderData?.email || 'Someone'
  
  const titles: Record<string, string> = {
    'mention': `${senderName} mentioned you`,
    'file_updated': `File Updated: ${fileName}`,
    'checkout_request': `Checkout Requested: ${fileName}`
  }
  
  const { error } = await client
    .from('notifications')
    .insert({
      org_id: orgId,
      user_id: toUserId,
      type,
      title: titles[type] || `Notification: ${fileName}`,
      message: message || `${senderName} mentioned you regarding ${fileName}`,
      file_id: fileId,
      from_user_id: fromUserId
    })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get the user who has a file checked out (with their info)
 */
export async function getCheckedOutByUser(
  fileId: string
): Promise<{ user: { id: string; email: string; full_name: string | null; avatar_url: string | null } | null; error?: string }> {
  const client = getSupabaseClient()
  
  // First get the file's checked_out_by
  const { data: file, error: fileError } = await client
    .from('files')
    .select('checked_out_by')
    .eq('id', fileId)
    .single()
  
  if (fileError) {
    return { user: null, error: fileError.message }
  }
  
  if (!file?.checked_out_by) {
    return { user: null }
  }
  
  // Then get the user info
  const { data: user, error: userError } = await client
    .from('users')
    .select('id, email, full_name, avatar_url')
    .eq('id', file.checked_out_by)
    .single()
  
  if (userError) {
    return { user: null, error: userError.message }
  }
  
  return { user }
}

// ============================================
// File Watchers (Watch/Subscribe to files)
// ============================================

/**
 * Watch a file to get notified of changes
 */
export async function watchFile(
  orgId: string,
  fileId: string,
  userId: string,
  options?: {
    notifyOnCheckin?: boolean
    notifyOnCheckout?: boolean
    notifyOnStateChange?: boolean
    notifyOnReview?: boolean
  }
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_watchers')
    .upsert({
      org_id: orgId,
      file_id: fileId,
      user_id: userId,
      notify_on_checkin: options?.notifyOnCheckin ?? true,
      notify_on_checkout: options?.notifyOnCheckout ?? false,
      notify_on_state_change: options?.notifyOnStateChange ?? true,
      notify_on_review: options?.notifyOnReview ?? true
    }, {
      onConflict: 'file_id,user_id'
    })
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Stop watching a file
 */
export async function unwatchFile(
  fileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_watchers')
    .delete()
    .eq('file_id', fileId)
    .eq('user_id', userId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Check if user is watching a file
 */
export async function isWatchingFile(
  fileId: string,
  userId: string
): Promise<{ watching: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_watchers')
    .select('id')
    .eq('file_id', fileId)
    .eq('user_id', userId)
    .maybeSingle()
  
  if (error) {
    return { watching: false, error: error.message }
  }
  
  return { watching: !!data }
}

/**
 * Get all files a user is watching
 */
export async function getWatchedFiles(
  userId: string
): Promise<{ files: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_watchers')
    .select(`
      *,
      file:files(id, file_name, file_path, state, version)
    `)
    .eq('user_id', userId)
  
  if (error) {
    return { files: [], error: error.message }
  }
  
  return { files: data || [] }
}

// ============================================
// File Share Links
// ============================================

export interface ShareLinkOptions {
  expiresInDays?: number
  maxDownloads?: number
  requireAuth?: boolean
}

/**
 * Create a shareable link for a file - generates actual signed URL from Supabase Storage
 */
export async function createShareLink(
  orgId: string,
  fileId: string,
  createdBy: string,
  options?: ShareLinkOptions
): Promise<{ link: { id: string; token: string; expiresAt: string | null; downloadUrl: string } | null; error?: string }> {
  const client = getSupabaseClient()
  
  // First, get the file info to find the content hash
  const { data: fileData, error: fileError } = await client
    .from('files')
    .select('content_hash, file_name, org_id')
    .eq('id', fileId)
    .single()
  
  if (fileError || !fileData) {
    return { link: null, error: fileError?.message || 'File not found' }
  }
  
  if (!fileData.content_hash) {
    return { link: null, error: 'File has no content in storage' }
  }
  
  // Calculate expiration in seconds for signed URL (default 7 days, max 1 year)
  const expiresInSeconds = options?.expiresInDays 
    ? Math.min(options.expiresInDays * 24 * 60 * 60, 365 * 24 * 60 * 60)
    : 7 * 24 * 60 * 60 // Default 7 days
  
  // Build storage path: {orgId}/{hash[0:2]}/{hash}
  const storagePath = `${fileData.org_id}/${fileData.content_hash.substring(0, 2)}/${fileData.content_hash}`
  
  // Generate signed URL from Supabase Storage
  const { data: signedUrlData, error: signedUrlError } = await client.storage
    .from('vault')
    .createSignedUrl(storagePath, expiresInSeconds, {
      download: fileData.file_name // Sets Content-Disposition header with filename
    })
  
  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { link: null, error: signedUrlError?.message || 'Failed to generate download URL' }
  }
  
  // Generate a token for tracking (optional - for our database)
  const token = generateToken(12)
  
  // Calculate expiration date
  let expiresAt: string | null = null
  if (options?.expiresInDays) {
    const date = new Date()
    date.setDate(date.getDate() + options.expiresInDays)
    expiresAt = date.toISOString()
  } else {
    // Default 7 days
    const date = new Date()
    date.setDate(date.getDate() + 7)
    expiresAt = date.toISOString()
  }
  
  // Optionally store link metadata in database for tracking
  // This is useful for download counting, revocation, etc.
  try {
    await client
      .from('file_share_links')
      .insert({
        org_id: orgId,
        file_id: fileId,
        token,
        created_by: createdBy,
        expires_at: expiresAt,
        max_downloads: options?.maxDownloads || null,
        require_auth: options?.requireAuth || false
      })
  } catch {
    // Don't fail if we can't track it - the signed URL still works
  }
  
  return { 
    link: { 
      id: token, 
      token, 
      expiresAt,
      downloadUrl: signedUrlData.signedUrl
    } 
  }
}

function generateToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Get share links for a file
 */
export async function getFileShareLinks(
  fileId: string
): Promise<{ links: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_share_links')
    .select(`
      *,
      created_by_user:users!created_by(email, full_name)
    `)
    .eq('file_id', fileId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  
  if (error) {
    return { links: [], error: error.message }
  }
  
  return { links: data || [] }
}

/**
 * Revoke/deactivate a share link
 */
export async function revokeShareLink(
  linkId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_share_links')
    .update({ is_active: false })
    .eq('id', linkId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Validate a share link token (for public access)
 */
export async function validateShareLink(
  token: string
): Promise<{ 
  valid: boolean
  fileId?: string
  orgId?: string
  requireAuth?: boolean
  error?: string 
}> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_share_links')
    .select('*')
    .eq('token', token)
    .eq('is_active', true)
    .single()
  
  if (error || !data) {
    return { valid: false, error: 'Link not found or invalid' }
  }
  
  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, error: 'Link has expired' }
  }
  
  // Check download limit
  if (data.max_downloads && data.download_count >= data.max_downloads) {
    return { valid: false, error: 'Download limit reached' }
  }
  
  return { 
    valid: true, 
    fileId: data.file_id, 
    orgId: data.org_id,
    requireAuth: data.require_auth
  }
}

// ============================================
// ECO Management (Add file to ECO)
// ============================================

/**
 * Get active ECOs for an organization (for selection)
 */
export async function getActiveECOs(
  orgId: string
): Promise<{ ecos: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('ecos')
    .select(`
      id,
      eco_number,
      title,
      status,
      created_at
    `)
    .eq('org_id', orgId)
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
  
  if (error) {
    return { ecos: [], error: error.message }
  }
  
  return { ecos: data || [] }
}

/**
 * Add a file to an ECO
 */
export async function addFileToECO(
  fileId: string,
  ecoId: string,
  userId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_ecos')
    .insert({
      file_id: fileId,
      eco_id: ecoId,
      created_by: userId,
      notes: notes || null
    })
  
  if (error) {
    // Check for duplicate
    if (error.code === '23505') {
      return { success: false, error: 'File is already part of this ECO' }
    }
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Remove a file from an ECO
 */
export async function removeFileFromECO(
  fileId: string,
  ecoId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('file_ecos')
    .delete()
    .eq('file_id', fileId)
    .eq('eco_id', ecoId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get ECOs that a file belongs to
 */
export async function getFileECOs(
  fileId: string
): Promise<{ ecos: any[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('file_ecos')
    .select(`
      id,
      notes,
      created_at,
      eco:ecos(id, eco_number, title, status)
    `)
    .eq('file_id', fileId)
  
  if (error) {
    return { ecos: [], error: error.message }
  }
  
  return { ecos: data || [] }
}

// ============================================
// User Sessions (Active Device Tracking)
// ============================================

export interface UserSession {
  id: string
  user_id: string
  org_id: string | null
  machine_id: string
  machine_name: string
  platform: string | null
  app_version: string | null
  last_seen: string
  is_active: boolean
  created_at: string
}

let heartbeatInterval: NodeJS.Timeout | null = null

/**
 * Register or update the current device session
 */
export async function registerDeviceSession(
  userId: string,
  orgId: string | null
): Promise<{ success: boolean; session?: UserSession; error?: string; isNewUser?: boolean }> {
  const client = getSupabaseClient()
  
  // Get machine info
  const { getMachineId, getMachineName } = await import('./backup')
  const machineId = await getMachineId()
  const machineName = await getMachineName()
  const platform = await window.electronAPI?.getPlatform() || 'unknown'
  const appVersion = await window.electronAPI?.getAppVersion() || 'unknown'
  
  console.log('[Session] Registering device session:', {
    userId: userId?.substring(0, 8) + '...',
    orgId: orgId ? orgId.substring(0, 8) + '...' : 'NULL',
    machineId: machineId?.substring(0, 8),
    machineName
  })
  
  // Retry logic for new users (user record might not exist yet due to trigger timing)
  const maxRetries = 3
  const retryDelays = [1000, 2000, 3000]
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, error } = await client
      .from('user_sessions')
      .upsert({
        user_id: userId,
        org_id: orgId,
        machine_id: machineId,
        machine_name: machineName,
        platform,
        app_version: appVersion,
        last_seen: new Date().toISOString(),
        is_active: true
      }, {
        onConflict: 'user_id,machine_id'
      })
      .select()
      .single()
    
    if (!error) {
      console.log('[Session] Device registered:', machineName, 'org_id in session:', data?.org_id || 'NULL')
      return { success: true, session: data }
    }
    
    // Check if it's a foreign key constraint error (user doesn't exist yet)
    if (error.message?.includes('foreign key constraint') || error.code === '23503') {
      if (attempt < maxRetries - 1) {
        console.log('[Session] User record not ready yet, retrying...', { attempt: attempt + 1, delayMs: retryDelays[attempt] })
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
        continue
      }
      // After all retries, return a helpful error
      console.error('[Session] Failed to register session - user record not created:', error.message)
      return { 
        success: false, 
        error: 'Your account is still being set up. Please wait a moment and try again.',
        isNewUser: true
      }
    }
    
    // Other errors, don't retry
    console.error('[Session] Failed to register device:', error.message)
    return { success: false, error: error.message }
  }
  
  return { success: false, error: 'Failed to register session after retries' }
}

/**
 * Sync all sessions for a user to use the correct org_id
 * Call this after org is loaded to fix sessions that were created with null or wrong org_id
 */
export async function syncUserSessionsOrgId(userId: string, orgId: string): Promise<void> {
  const client = getSupabaseClient()
  
  console.log('[Session] Syncing all user sessions to org_id:', orgId?.substring(0, 8) + '...')
  
  // Update ALL active sessions for this user to have the correct org_id
  // Use unconditional update - simpler and ensures all sessions have correct org_id
  // The update only affects this user's sessions, so it's safe
  const { data, error } = await client
    .from('user_sessions')
    .update({ org_id: orgId })
    .eq('user_id', userId)
    .select('id')
  
  if (error) {
    console.error('[Session] Failed to sync session org_ids:', error.message)
  } else {
    console.log('[Session] Session org_ids synced successfully, updated:', data?.length || 0, 'sessions')
  }
}

/**
 * Ensure the current user has the correct org_id in the database
 * This calls a database RPC that checks and fixes org_id based on email domain
 * Should be called on every app boot to prevent org_id mismatch issues
 * 
 * NOTE: This uses Supabase client.rpc() which can sometimes hang. We add a timeout
 * to prevent blocking the auth flow. If it times out, we just skip it - the
 * linkUserToOrganization function will handle setting org_id as a fallback.
 */
export async function ensureUserOrgId(): Promise<{ success: boolean; fixed: boolean; org_id?: string; error?: string }> {
  const client = getSupabaseClient()
  
  console.log('[Auth] Ensuring user org_id is correct...')
  
  // Wrap in a timeout since client.rpc() can hang
  const timeoutMs = 5000 // 5 second timeout
  
  try {
    const rpcPromise = client.rpc('ensure_user_org_id' as never)
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('RPC timeout after 5s')), timeoutMs)
    )
    
    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as { data: unknown; error: { message: string } | null }
    
    if (error) {
      // RPC might not exist yet (before migration runs)
      console.warn('[Auth] ensure_user_org_id RPC failed (run migration if not done):', error.message)
      return { success: false, fixed: false, error: error.message }
    }
    
    const result = data as { success: boolean; fixed: boolean; org_id?: string; previous_org_id?: string; new_org_id?: string; error?: string }
    
    if (result.fixed) {
      console.log('[Auth] Fixed user org_id:', result.previous_org_id?.substring(0, 8) + '... ->', result.new_org_id?.substring(0, 8) + '...')
    } else {
      console.log('[Auth] User org_id is correct:', result.org_id?.substring(0, 8) + '...')
    }
    
    return { 
      success: result.success, 
      fixed: result.fixed, 
      org_id: result.new_org_id || result.org_id,
      error: result.error
    }
  } catch (err) {
    // This catches both RPC errors and timeout
    const errorMsg = String(err)
    if (errorMsg.includes('timeout')) {
      console.warn('[Auth] ensureUserOrgId timed out - skipping (not critical)')
    } else {
      console.error('[Auth] ensureUserOrgId failed:', err)
    }
    return { success: false, fixed: false, error: errorMsg }
  }
}

/**
 * Send a heartbeat to keep the session alive
 * Returns false if session was remotely invalidated
 * @param userId - The user's ID
 * @param orgId - The user's current organization ID (to keep session org_id in sync)
 */
export async function sendSessionHeartbeat(userId: string, orgId?: string | null): Promise<boolean> {
  const client = getSupabaseClient()
  
  const { getMachineId } = await import('./backup')
  const machineId = await getMachineId()
  
  // First check if our session is still active (also get current org_id for logging)
  const { data: session, error: checkError } = await client
    .from('user_sessions')
    .select('is_active, org_id')
    .eq('user_id', userId)
    .eq('machine_id', machineId)
    .single()
  
  if (checkError) {
    console.error('[Session] Failed to check session status:', checkError.message)
    return true // Assume still active on error
  }
  
  // If session was deactivated remotely, don't update and signal sign out needed
  if (session && !session.is_active) {
    console.log('[Session] Session was remotely deactivated')
    return false
  }
  
  // Session is active, update the heartbeat
  // Also update org_id to keep it in sync (handles case where user joins/changes org)
  const updateData: Record<string, unknown> = { 
    last_seen: new Date().toISOString(),
    is_active: true
  }
  
  // Only update org_id if provided (to keep session in sync with current org)
  if (orgId !== undefined) {
    updateData.org_id = orgId
  }
  
  // Log when org_id changes
  const currentOrgId = session?.org_id
  const newOrgId = orgId !== undefined ? orgId : currentOrgId
  if (currentOrgId !== newOrgId) {
    console.log('[Session] Heartbeat updating org_id:', currentOrgId?.substring(0, 8) || 'NULL', '→', newOrgId?.substring(0, 8) || 'NULL')
  }
  
  const { error } = await client
    .from('user_sessions')
    .update(updateData)
    .eq('user_id', userId)
    .eq('machine_id', machineId)
  
  if (error) {
    console.error('[Session] Heartbeat failed:', error.message)
  }
  
  return true
}

/**
 * Start periodic heartbeat (call once when app starts)
 * @param userId - The user's ID
 * @param onSessionInvalidated - Callback when session is remotely ended (triggers sign out)
 * @param getOrgId - Optional callback to get current org_id (for keeping session org in sync)
 */
export function startSessionHeartbeat(
  userId: string, 
  onSessionInvalidated?: () => void,
  getOrgId?: () => string | null | undefined
): void {
  // Clear any existing interval
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
  }
  
  const checkHeartbeat = async () => {
    // Get current org_id if callback provided (allows org to change during session)
    const orgId = getOrgId?.()
    const isActive = await sendSessionHeartbeat(userId, orgId)
    if (!isActive && onSessionInvalidated) {
      console.log('[Session] Remote sign out detected, triggering sign out')
      stopSessionHeartbeat()
      onSessionInvalidated()
    }
  }
  
  // Send heartbeat every 30 seconds (faster detection of remote sign out)
  heartbeatInterval = setInterval(checkHeartbeat, 30000)
  
  // Send initial heartbeat
  checkHeartbeat()
}

/**
 * Stop the heartbeat (call when app closes or user signs out)
 */
export function stopSessionHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

/**
 * Mark the current session as inactive (on sign out or app close)
 */
export async function endDeviceSession(userId: string): Promise<void> {
  const client = getSupabaseClient()
  
  const { getMachineId } = await import('./backup')
  const machineId = await getMachineId()
  
  await client
    .from('user_sessions')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('machine_id', machineId)
  
  stopSessionHeartbeat()
}

/**
 * End a remote session by session ID (for signing out other devices)
 */
export async function endRemoteSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('user_sessions')
    .update({ is_active: false })
    .eq('id', sessionId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

/**
 * Get all active sessions for the current user
 * Returns sessions that have been seen in the last 2 minutes
 */
export async function getActiveSessions(userId: string): Promise<{ sessions: UserSession[]; error?: string }> {
  const client = getSupabaseClient()
  
  // Get sessions active within the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  
  const { data, error } = await client
    .from('user_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .gte('last_seen', fiveMinutesAgo)
    .order('last_seen', { ascending: false })
  
  if (error) {
    return { sessions: [], error: error.message }
  }
  
  return { sessions: data || [] }
}

/**
 * Check if a specific machine is online (has an active session)
 * @param userId - The user ID
 * @param machineId - The machine ID to check
 * @returns Whether the machine is online (active session within last 2 minutes)
 */
export async function isMachineOnline(userId: string, machineId: string): Promise<boolean> {
  const client = getSupabaseClient()
  
  // Consider online if active and seen within last 2 minutes
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  
  const { data, error } = await client
    .from('user_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('machine_id', machineId)
    .eq('is_active', true)
    .gte('last_seen', twoMinutesAgo)
    .limit(1)
  
  if (error) {
    console.error('[Session] Failed to check machine online status:', error.message)
    return false
  }
  
  return (data?.length || 0) > 0
}

/**
 * Subscribe to session changes for realtime updates
 */
export function subscribeToSessions(
  userId: string,
  onSessionChange: (sessions: UserSession[]) => void
): () => void {
  const client = getSupabaseClient()
  
  const channel = client
    .channel(`user_sessions:${userId}`)
    .on<UserSession>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_sessions',
        filter: `user_id=eq.${userId}`
      },
      async () => {
        // When any session changes, fetch all active sessions
        const { sessions } = await getActiveSessions(userId)
        onSessionChange(sessions)
      }
    )
    .subscribe()
  
  return () => {
    channel.unsubscribe()
  }
}

// ===========================================
// ONLINE PRESENCE
// ===========================================

export interface OnlineUser {
  user_id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  machine_name: string
  platform: string | null
  last_seen: string
}

/**
 * Get all online users from the organization
 * Returns users who have active sessions within the last 5 minutes
 */
export async function getOrgOnlineUsers(orgId: string): Promise<{ users: OnlineUser[]; error?: string }> {
  const client = getSupabaseClient()
  
  // Get sessions active within the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  
  console.log('[OnlineUsers] Fetching online users for org:', orgId?.substring(0, 8) + '...', 'since:', fiveMinutesAgo)
  
  // First, let's debug by fetching ALL active sessions visible to current user (RLS applies)
  // This helps diagnose if the RLS policy is working correctly
  const { data: debugData, error: debugError } = await client
    .from('user_sessions')
    .select('user_id, org_id, machine_name, is_active, last_seen')
    .eq('is_active', true)
    .gte('last_seen', fiveMinutesAgo)
  
  console.log('[OnlineUsers] DEBUG - All active sessions visible to current user (RLS filtered):', 
    debugData?.length || 0, 'sessions')
  if (debugData && debugData.length > 0) {
    debugData.forEach(s => {
      console.log('[OnlineUsers]   -', s.machine_name, 
        '| user:', s.user_id?.substring(0, 8) + '...',
        '| org:', s.org_id?.substring(0, 8) || 'NULL',
        '| last_seen:', new Date(s.last_seen).toLocaleTimeString())
    })
  }
  if (debugError) {
    console.error('[OnlineUsers] DEBUG query error:', debugError.message)
  }
  
  const { data, error } = await client
    .from('user_sessions')
    .select(`
      user_id,
      machine_name,
      platform,
      last_seen,
      users!inner (
        email,
        full_name,
        avatar_url,
        role
      )
    `)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .gte('last_seen', fiveMinutesAgo)
    .order('last_seen', { ascending: false })
  
  console.log('[OnlineUsers] Query result - sessions with org_id match:', data?.length || 0, 'Error:', error?.message || 'none')
  
  if (error) {
    console.error('[OnlineUsers] Failed to fetch online users:', error.message)
    return { users: [], error: error.message }
  }
  
  // Transform the data to flatten the user info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users: OnlineUser[] = (data || []).map((session: any) => ({
    user_id: session.user_id,
    email: session.users.email,
    full_name: session.users.full_name,
    avatar_url: session.users.avatar_url,
    role: session.users.role,
    machine_name: session.machine_name,
    platform: session.platform,
    last_seen: session.last_seen
  }))
  
  // Deduplicate by user_id (keep most recent session per user)
  const uniqueUsers = new Map<string, OnlineUser>()
  for (const user of users) {
    if (!uniqueUsers.has(user.user_id)) {
      uniqueUsers.set(user.user_id, user)
    }
  }
  
  return { users: Array.from(uniqueUsers.values()) }
}

/**
 * Subscribe to organization-wide session changes for online presence
 */
export function subscribeToOrgOnlineUsers(
  orgId: string,
  onUsersChange: (users: OnlineUser[]) => void
): () => void {
  const client = getSupabaseClient()
  
  console.log('[OnlineUsers] Subscribing to realtime updates for org:', orgId?.substring(0, 8) + '...')
  
  const channel = client
    .channel(`org_sessions:${orgId}`)
    .on<UserSession>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_sessions',
        filter: `org_id=eq.${orgId}`
      },
      async (payload) => {
        console.log('[OnlineUsers] Realtime event received:', payload.eventType, 
          '| user:', (payload.new as UserSession)?.user_id?.substring(0, 8) || (payload.old as UserSession)?.user_id?.substring(0, 8) || 'unknown')
        
        // When any org session changes, fetch all online users
        const { users } = await getOrgOnlineUsers(orgId)
        console.log('[OnlineUsers] Refreshed online users after realtime event:', users.length)
        onUsersChange(users)
      }
    )
    .subscribe((status) => {
      console.log('[OnlineUsers] Subscription status:', status)
    })
  
  return () => {
    console.log('[OnlineUsers] Unsubscribing from realtime updates for org:', orgId?.substring(0, 8) + '...')
    channel.unsubscribe()
  }
}

// ===========================================
// ADMIN RECOVERY CODES
// Emergency mechanism for admin access recovery
// ===========================================

export interface AdminRecoveryCode {
  id: string
  org_id: string
  description: string | null
  created_by: string
  created_at: string
  expires_at: string
  is_used: boolean
  used_by: string | null
  used_at: string | null
  is_revoked: boolean
  revoked_by: string | null
  revoked_at: string | null
  revoke_reason: string | null
  // Joined data
  created_by_user?: { email: string; full_name: string | null }
  used_by_user?: { email: string; full_name: string | null }
}

/**
 * Generate a cryptographically secure recovery code
 * Returns a code in format: XXXX-XXXX-XXXX-XXXX (16 chars + dashes)
 */
function generateSecureRecoveryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude confusing chars (0/O, 1/I/L)
  const segments = 4
  const segmentLength = 4
  const parts: string[] = []
  
  for (let s = 0; s < segments; s++) {
    let segment = ''
    for (let i = 0; i < segmentLength; i++) {
      // Use crypto.getRandomValues for security
      const array = new Uint8Array(1)
      crypto.getRandomValues(array)
      segment += chars[array[0] % chars.length]
    }
    parts.push(segment)
  }
  
  return parts.join('-')
}

/**
 * Hash a recovery code using SHA-256
 * This is what gets stored in the database
 */
async function hashRecoveryCode(code: string): Promise<string> {
  // Normalize: remove dashes and convert to uppercase
  const normalized = code.replace(/-/g, '').toUpperCase()
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a new admin recovery code (Admin only)
 * Returns the plain code ONCE - it must be written down immediately
 * The code is hashed before storage and cannot be recovered
 * 
 * @param orgId Organization ID
 * @param createdBy User ID of the admin creating the code
 * @param description Optional description (e.g., "Emergency backup for CEO")
 * @param expiresInDays How many days until the code expires (default 90)
 */
export async function generateAdminRecoveryCode(
  orgId: string,
  createdBy: string,
  description?: string,
  expiresInDays: number = 90
): Promise<{ success: boolean; code?: string; codeId?: string; error?: string }> {
  const client = getSupabaseClient()
  
  // Generate the code
  const plainCode = generateSecureRecoveryCode()
  const codeHash = await hashRecoveryCode(plainCode)
  
  // Calculate expiration
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)
  
  // Insert into database (RLS will enforce admin-only)
  const { data, error } = await client
    .from('admin_recovery_codes')
    .insert({
      org_id: orgId,
      code_hash: codeHash,
      description: description || null,
      created_by: createdBy,
      expires_at: expiresAt.toISOString()
    })
    .select('id')
    .single()
  
  if (error) {
    console.error('[RecoveryCode] Failed to create:', error.message)
    return { success: false, error: error.message }
  }
  
  console.log('[RecoveryCode] Created new recovery code:', data.id)
  
  // Return the plain code - this is the ONLY time it will be visible
  return { 
    success: true, 
    code: plainCode,
    codeId: data.id
  }
}

/**
 * List recovery codes for an organization (Admin only)
 * NOTE: The actual codes are never returned, only metadata
 */
export async function listAdminRecoveryCodes(
  orgId: string
): Promise<{ codes: AdminRecoveryCode[]; error?: string }> {
  const client = getSupabaseClient()
  
  const { data, error } = await client
    .from('admin_recovery_codes')
    .select(`
      id,
      org_id,
      description,
      created_by,
      created_at,
      expires_at,
      is_used,
      used_by,
      used_at,
      is_revoked,
      revoked_by,
      revoked_at,
      revoke_reason
    `)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('[RecoveryCode] Failed to list:', error.message)
    return { codes: [], error: error.message }
  }
  
  return { codes: data || [] }
}

/**
 * Revoke a recovery code (Admin only)
 * This prevents the code from being used even if not expired
 */
export async function revokeAdminRecoveryCode(
  codeId: string,
  revokedBy: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('admin_recovery_codes')
    .update({
      is_revoked: true,
      revoked_by: revokedBy,
      revoked_at: new Date().toISOString(),
      revoke_reason: reason || null
    })
    .eq('id', codeId)
    .eq('is_used', false) // Can't revoke already-used codes
  
  if (error) {
    console.error('[RecoveryCode] Failed to revoke:', error.message)
    return { success: false, error: error.message }
  }
  
  console.log('[RecoveryCode] Revoked code:', codeId)
  return { success: true }
}

/**
 * Delete a recovery code permanently (Admin only)
 * Only used codes or revoked codes should be deleted
 */
export async function deleteAdminRecoveryCode(
  codeId: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  const { error } = await client
    .from('admin_recovery_codes')
    .delete()
    .eq('id', codeId)
  
  if (error) {
    console.error('[RecoveryCode] Failed to delete:', error.message)
    return { success: false, error: error.message }
  }
  
  console.log('[RecoveryCode] Deleted code:', codeId)
  return { success: true }
}

/**
 * Use a recovery code to elevate a user to admin
 * This can be called by ANY authenticated user in the org
 * The code is validated and marked as used by the database function
 */
export async function useAdminRecoveryCode(
  code: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const client = getSupabaseClient()
  
  // Hash the code to match against stored hash
  const codeHash = await hashRecoveryCode(code)
  
  // Call the database function that handles everything
  const { data, error } = await client.rpc('use_admin_recovery_code', {
    p_code_hash: codeHash,
    p_user_ip: null // Could be populated if we tracked IPs
  })
  
  if (error) {
    console.error('[RecoveryCode] RPC error:', error.message)
    return { success: false, error: error.message }
  }
  
  // The function returns a JSONB object
  const result = data as { success: boolean; message?: string; error?: string }
  
  if (result.success) {
    console.log('[RecoveryCode] Successfully elevated user to admin')
  } else {
    console.warn('[RecoveryCode] Code validation failed:', result.error)
  }
  
  return result
}