// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database'
import { loadConfig, type SupabaseConfig } from '../supabaseConfig'

// ============================================
// Logging Helper (must be defined early)
// ============================================

// Helper to log to both console and file (via Electron)
export const authLog = (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => {
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

// Export internal state accessors for other modules
export function getSessionResolver(): ((success: boolean) => void) | null {
  return sessionResolver
}

export function setSessionResolver(resolver: ((success: boolean) => void) | null): void {
  sessionResolver = resolver
}

// Export access to currentConfig for modules that need raw config values
export function getCurrentConfigValues(): { url: string; anonKey: string } | null {
  if (!currentConfig) return null
  return { url: currentConfig.url, anonKey: currentConfig.anonKey }
}
