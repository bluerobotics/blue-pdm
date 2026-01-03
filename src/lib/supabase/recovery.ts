// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient } from './client'

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
