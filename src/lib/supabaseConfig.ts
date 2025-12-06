// Supabase Configuration Management
// Allows organizations to bring their own Supabase backend

const STORAGE_KEY = 'bluepdm-supabase-config'
const CONFIG_VERSION = 1

export interface SupabaseConfig {
  version: number
  url: string
  anonKey: string
  orgSlug?: string  // Optional: for verification
}

// Generate an organization code that can be shared with team members
// Format: base64 encoded JSON
export function generateOrgCode(config: SupabaseConfig): string {
  const payload = {
    v: CONFIG_VERSION,
    u: config.url,
    k: config.anonKey,
    s: config.orgSlug || ''
  }
  
  // Encode to base64
  const json = JSON.stringify(payload)
  const base64 = btoa(json)
  
  // Format as readable code with prefix
  // Split into chunks for readability: PDM-XXXX-XXXX-XXXX...
  const chunks = base64.match(/.{1,4}/g) || []
  return 'PDM-' + chunks.join('-')
}

// Parse an organization code back to config
export function parseOrgCode(code: string): SupabaseConfig | null {
  try {
    // Remove prefix and dashes
    let base64 = code.trim()
    if (base64.toUpperCase().startsWith('PDM-')) {
      base64 = base64.substring(4)
    }
    base64 = base64.replace(/-/g, '')
    
    // Decode from base64
    const json = atob(base64)
    const payload = JSON.parse(json)
    
    // Validate required fields
    if (!payload.u || !payload.k) {
      console.error('[SupabaseConfig] Invalid org code: missing required fields')
      return null
    }
    
    return {
      version: payload.v || CONFIG_VERSION,
      url: payload.u,
      anonKey: payload.k,
      orgSlug: payload.s || undefined
    }
  } catch (err) {
    console.error('[SupabaseConfig] Failed to parse org code:', err)
    return null
  }
}

// Save configuration to local storage
export function saveConfig(config: SupabaseConfig): void {
  try {
    const json = JSON.stringify(config)
    localStorage.setItem(STORAGE_KEY, json)
    console.log('[SupabaseConfig] Configuration saved')
  } catch (err) {
    console.error('[SupabaseConfig] Failed to save config:', err)
  }
}

// Load configuration from local storage
export function loadConfig(): SupabaseConfig | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY)
    if (!json) return null
    
    const config = JSON.parse(json) as SupabaseConfig
    
    // Validate required fields
    if (!config.url || !config.anonKey) {
      console.warn('[SupabaseConfig] Invalid stored config, clearing')
      clearConfig()
      return null
    }
    
    return config
  } catch (err) {
    console.error('[SupabaseConfig] Failed to load config:', err)
    return null
  }
}

// Clear stored configuration
export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    console.log('[SupabaseConfig] Configuration cleared')
  } catch (err) {
    console.error('[SupabaseConfig] Failed to clear config:', err)
  }
}

// Check if configuration exists
export function hasConfig(): boolean {
  return loadConfig() !== null
}

// Validate a Supabase configuration by attempting to connect
export async function validateConfig(config: SupabaseConfig): Promise<{ valid: boolean; error?: string }> {
  try {
    // Import dynamically to avoid circular dependency
    const { createClient } = await import('@supabase/supabase-js')
    
    const testClient = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
    
    // Try to make a simple query (organizations table should exist)
    const { error } = await testClient.from('organizations').select('id').limit(1)
    
    if (error) {
      // Some errors are expected (like empty results), others indicate bad config
      if (error.message.includes('Invalid API key') || 
          error.message.includes('Invalid URL') ||
          error.code === 'PGRST301') {
        return { valid: false, error: 'Invalid Supabase credentials' }
      }
      // Other errors might just mean empty table, which is fine
    }
    
    return { valid: true }
  } catch (err: any) {
    console.error('[SupabaseConfig] Validation failed:', err)
    return { valid: false, error: err.message || 'Failed to connect to Supabase' }
  }
}

