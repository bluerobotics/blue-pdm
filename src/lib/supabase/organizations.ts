// @ts-nocheck - Supabase type inference with Database generics has known issues in v2.x
import { getSupabaseClient, authLog, getCurrentConfigValues } from './client'
import { getCurrentAccessToken } from './auth'

// ============================================
// User & Organization
// ============================================

export async function getUserProfile(userId: string, options?: { maxRetries?: number }) {
  authLog('debug', 'getUserProfile called', { userId: userId?.substring(0, 8) + '...', hasToken: !!getCurrentAccessToken() })
  
  // Use raw fetch - Supabase client methods hang
  const config = getCurrentConfigValues()
  const url = config?.url || import.meta.env.VITE_SUPABASE_URL
  const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const accessToken = getCurrentAccessToken() || key
  
  // Retry logic: new users may not have public.users record yet (trigger race condition)
  const maxRetries = options?.maxRetries ?? 3
  const retryDelays = [500, 1000, 2000] // ms
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      authLog('debug', 'Fetching profile...', { attempt: attempt + 1 })
      
      const response = await fetch(`${url}/rest/v1/users?select=id,email,role,org_id,full_name,avatar_url,custom_avatar_url&id=eq.${userId}`, {
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
    const config = getCurrentConfigValues()
    const url = config?.url || import.meta.env.VITE_SUPABASE_URL
    const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    const accessToken = getCurrentAccessToken() || key
    
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

// Auth provider settings type
export interface AuthProviders {
  users: { google: boolean; email: boolean; phone: boolean }
  suppliers: { google: boolean; email: boolean; phone: boolean }
}

// Get organization auth providers by slug (works without authentication)
// Used by the sign-in screen to determine which sign-in methods to show
export async function getOrgAuthProviders(orgSlug: string): Promise<AuthProviders | null> {
  try {
    const config = getCurrentConfigValues()
    const url = config?.url || import.meta.env.VITE_SUPABASE_URL
    const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
    
    const response = await fetch(`${url}/rest/v1/rpc/get_org_auth_providers`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`, // Use anon key for unauthenticated access
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_org_slug: orgSlug })
    })
    
    if (!response.ok) {
      console.warn('[Supabase] Failed to fetch auth providers:', response.status)
      return null
    }
    
    const data = await response.json()
    return data as AuthProviders
  } catch (err) {
    console.warn('[Supabase] Error fetching auth providers:', err)
    return null
  }
}

// Find and link organization by email domain, pending membership, or fetch existing org
export async function linkUserToOrganization(userId: string, userEmail: string) {
  authLog('info', 'linkUserToOrganization called', { userId: userId?.substring(0, 8) + '...', email: userEmail })
  
  // Use raw fetch - Supabase client methods hang
  const config = getCurrentConfigValues()
  const url = config?.url || import.meta.env.VITE_SUPABASE_URL
  const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const accessToken = getCurrentAccessToken() || key
  
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
    
    // If user record still doesn't exist, call ensure_user_org_id RPC to create it
    // This handles cases where the auth trigger failed (e.g., after account deletion)
    if (!userProfile) {
      authLog('info', 'User record not found after retries, calling ensure_user_org_id RPC')
      try {
        const ensureResponse = await fetch(`${url}/rest/v1/rpc/ensure_user_org_id`, {
          method: 'POST',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: '{}'
        })
        const ensureResult = await ensureResponse.json()
        authLog('info', 'ensure_user_org_id result', ensureResult)
        
        if (ensureResult?.created_user) {
          // Re-fetch user profile now that it exists
          const userResponse = await fetch(`${url}/rest/v1/users?select=org_id&id=eq.${userId}`, {
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          })
          const userData = await userResponse.json()
          userProfile = userData?.[0] || null
          authLog('info', 'Re-fetched user profile after creation', { hasProfile: !!userProfile, orgId: userProfile?.org_id?.substring(0, 8) + '...' })
        }
      } catch (ensureErr) {
        authLog('warn', 'ensure_user_org_id RPC failed', { error: String(ensureErr) })
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
    const { loadConfig } = await import('../supabaseConfig')
    const loadedConfig = loadConfig()
    
    // First try the explicit org slug from config
    const orgSlugToUse = loadedConfig?.orgSlug
    
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
