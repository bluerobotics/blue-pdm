// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient } from './client'

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
  const { getMachineId, getMachineName } = await import('../backup')
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
  
  const { getMachineId } = await import('../backup')
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
  
  // Also update last_online in users table (throttled - only if more than 1 min since last update)
  // This keeps "last online" in sync with actual activity
  try {
    await client
      .from('users')
      .update({ last_online: new Date().toISOString() })
      .eq('id', userId)
  } catch (err) {
    // Silently ignore - last_online is non-critical
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
  
  const { getMachineId } = await import('../backup')
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
  custom_avatar_url: string | null
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
        custom_avatar_url,
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
    custom_avatar_url: session.users.custom_avatar_url,
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

// ============================================
// User Activity Tracking
// ============================================

/**
 * Update the user's last_online timestamp.
 * Called when user is active in the app.
 */
export async function updateLastOnline(): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  
  try {
    const { data, error } = await client.rpc('update_last_online')
    
    if (error) {
      console.error('[LastOnline] Failed to update:', error.message)
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err) {
    console.error('[LastOnline] Error updating:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
