// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { 
  getSupabaseClient, 
  authLog, 
  getCurrentConfigValues, 
  getSessionResolver, 
  setSessionResolver 
} from './client'

// Store the current access token (set by setupSessionListener)
let currentAccessToken: string | null = null

export function setCurrentAccessToken(token: string | null) {
  currentAccessToken = token
}

export function getCurrentAccessToken(): string | null {
  return currentAccessToken
}

// Cache for current user email (avoids repeated auth calls)
let cachedUserEmail: string | null = null

/**
 * Clear cached user email (call on logout)
 */
export function clearCachedUserEmail() {
  cachedUserEmail = null
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
      setSessionResolver(resolve)
      // Timeout after 5 minutes (user may take time in browser)
      setTimeout(() => {
        authLog('warn', 'Session promise timed out after 5 minutes')
        setSessionResolver(null)
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
      setSessionResolver(null)
      
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
    
    setSessionResolver(null)
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
    const config = getCurrentConfigValues()
    const url = config?.url || import.meta.env.VITE_SUPABASE_URL
    const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    
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
    const config = getCurrentConfigValues()
    const url = config?.url || import.meta.env.VITE_SUPABASE_URL
    const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
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
    // Import dynamically to avoid circular dependency
    const { endDeviceSession } = await import('./sessions')
    await endDeviceSession(user.id)
  }
  
  // Clear cached user email
  clearCachedUserEmail()
  
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

/**
 * Get the current user's email from session (cached for performance).
 * Falls back to empty string if unavailable.
 */
export async function getCurrentUserEmail(): Promise<string> {
  if (cachedUserEmail) return cachedUserEmail
  
  const { session } = await getCurrentSession()
  cachedUserEmail = session?.user?.email || ''
  return cachedUserEmail
}
