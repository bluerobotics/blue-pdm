import { getSupabaseClient, authLog, getCurrentConfigValues } from './client'
import { getCurrentAccessToken } from './auth'
import { recordMetric } from '@/lib/performanceMetrics'
import type { Organization } from '@/types/pdm'

// ============================================
// User & Organization
// ============================================

interface UserProfileResult {
  id: string
  email: string
  role: string
  org_id: string | null
  full_name: string | null
  avatar_url: string | null
  custom_avatar_url: string | null
}

export async function getUserProfile(
  userId: string,
  options?: { maxRetries?: number },
): Promise<{ profile: UserProfileResult | null; error: Error | null }> {
  authLog('debug', 'getUserProfile called', {
    userId: userId?.substring(0, 8) + '...',
    hasToken: !!getCurrentAccessToken(),
  })

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

      const response = await fetch(
        `${url}/rest/v1/users?select=id,email,role,org_id,full_name,avatar_url,custom_avatar_url&id=eq.${userId}`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const data = await response.json()
      authLog('debug', 'Profile fetch result', {
        status: response.status,
        hasData: data?.length > 0,
        attempt: attempt + 1,
      })

      if (data && data.length > 0) {
        return { profile: data[0], error: null }
      }

      // User not found - might be a new user where trigger hasn't run yet
      if (attempt < maxRetries) {
        authLog('info', 'User not found, retrying...', {
          attempt: attempt + 1,
          nextDelayMs: retryDelays[attempt],
        })
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]))
      }
    } catch (error) {
      authLog('error', 'getUserProfile failed', { error: String(error), attempt: attempt + 1 })
      if (attempt === maxRetries) {
        return { profile: null, error: error as Error }
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]))
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
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    const data = await response.json()

    if (data && data.length > 0) {
      return { org: data[0], error: null }
    }
    return { org: null, error: new Error('Organization not found') }
  } catch (error) {
    return { org: null, error: error as Error }
  }
}

// Auth provider settings type
export interface AuthProviders {
  users: { google: boolean; email: boolean; phone: boolean }
  suppliers: { google: boolean; email: boolean; phone: boolean }
}

// Default auth providers (all enabled) - used as fallback
const DEFAULT_AUTH_PROVIDERS: AuthProviders = {
  users: { google: true, email: true, phone: true },
  suppliers: { google: true, email: true, phone: true },
}

// Get organization auth providers (works without authentication)
// Used by the sign-in screen to determine which sign-in methods to show
// If orgSlug is provided, fetches by slug. Otherwise, fetches from the first/only org in the database.
export async function getOrgAuthProviders(orgSlug?: string): Promise<AuthProviders | null> {
  try {
    const config = getCurrentConfigValues()
    const url = config?.url || import.meta.env.VITE_SUPABASE_URL
    const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY

    // If we have an org slug, use the RPC function
    if (orgSlug) {
      const response = await fetch(`${url}/rest/v1/rpc/get_org_auth_providers`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`, // Use anon key for unauthenticated access
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_org_slug: orgSlug }),
      })

      if (!response.ok) {
        // Fall through to try the fallback method
      } else {
        const data = await response.json()
        if (data) {
          return data as AuthProviders
        }
      }
    }

    // Fallback: Query all organizations and get the first one's auth_providers
    // This works because each org has their own Supabase database (single-tenant model)
    const orgResponse = await fetch(`${url}/rest/v1/organizations?select=auth_providers&limit=1`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    })

    if (!orgResponse.ok) {
      return null
    }

    const orgs = await orgResponse.json()
    if (orgs && orgs.length > 0 && orgs[0].auth_providers) {
      const authProviders = orgs[0].auth_providers as AuthProviders
      // Merge with defaults to ensure all fields exist
      return {
        users: {
          google: authProviders?.users?.google ?? true,
          email: authProviders?.users?.email ?? true,
          phone: authProviders?.users?.phone ?? true,
        },
        suppliers: {
          google: authProviders?.suppliers?.google ?? true,
          email: authProviders?.suppliers?.email ?? true,
          phone: authProviders?.suppliers?.phone ?? true,
        },
      }
    }

    // If no org found or no auth_providers set, return defaults (all enabled)
    return DEFAULT_AUTH_PROVIDERS
  } catch {
    return null
  }
}

// ============================================
// Organization membership
// ============================================

const JOIN_ORG_MAX_RETRIES = 5
const JOIN_ORG_RETRY_BASE_DELAY_MS = 1_000

interface RestApi {
  url: string
  key: string
  accessToken: string
}

function restHeaders(api: RestApi): Record<string, string> {
  return {
    apikey: api.key,
    Authorization: `Bearer ${api.accessToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Join the signed-in user to an organization by slug.
 *
 * `users.org_id` is pinned by RLS: the self-update policy requires the new value to be
 * `IS NOT DISTINCT FROM` the current one, so an account cannot put itself into an organization
 * with a PATCH. `join_org_by_slug` is SECURITY DEFINER and is the only route a client has. It
 * also enforces blocked users and `enforce_email_domain`, and adds the caller to the
 * organization's default team - none of which the direct write it replaces ever did.
 *
 * Returns the joined org id, or null when the join did not happen.
 */
async function joinOrgBySlug(api: RestApi, slug: string, context: string): Promise<string | null> {
  for (let attempt = 1; attempt <= JOIN_ORG_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${api.url}/rest/v1/rpc/join_org_by_slug`, {
        method: 'POST',
        headers: restHeaders(api),
        body: JSON.stringify({ p_org_slug: slug }),
      })
      const result = await response.json()

      authLog('info', 'join_org_by_slug result', {
        context,
        success: result?.success,
        orgName: result?.org_name,
        addedToDefaultTeam: result?.added_to_default_team,
        retry: result?.retry,
        attempt,
      })

      if (result?.success && result?.org_id) {
        return result.org_id as string
      }

      // The users row may not exist yet because the auth trigger is still running.
      if (result?.retry && attempt < JOIN_ORG_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, JOIN_ORG_RETRY_BASE_DELAY_MS * attempt))
        continue
      }

      if (result?.error) {
        authLog('warn', 'join_org_by_slug failed', { context, error: result.error })
      }
    } catch (error) {
      authLog('warn', 'join_org_by_slug request failed', {
        context,
        error: String(error),
        attempt,
      })
      if (attempt < JOIN_ORG_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, JOIN_ORG_RETRY_BASE_DELAY_MS * attempt))
        continue
      }
    }
    break
  }

  return null
}

/**
 * Ask the database to resolve membership for the signed-in user. Runs as definer, so it can act
 * on a pending invitation or an email-domain match that the client is not permitted to write
 * itself. Returns the resolved org id, or null when the server could not place the user.
 */
async function ensureUserOrgIdRpc(api: RestApi): Promise<string | null> {
  try {
    const response = await fetch(`${api.url}/rest/v1/rpc/ensure_user_org_id`, {
      method: 'POST',
      headers: restHeaders(api),
      body: '{}',
    })
    const result = await response.json()
    authLog('info', 'ensure_user_org_id result', result)

    return result?.has_org && result?.org_id ? (result.org_id as string) : null
  } catch (error) {
    authLog('warn', 'ensure_user_org_id RPC failed', { error: String(error) })
    return null
  }
}

async function fetchOrgById(api: RestApi, orgId: string): Promise<Organization | null> {
  try {
    const response = await fetch(`${api.url}/rest/v1/organizations?select=*&id=eq.${orgId}`, {
      headers: restHeaders(api),
    })
    const data = await response.json()
    return data?.[0] ?? null
  } catch (error) {
    authLog('warn', 'Failed to fetch organization', { error: String(error) })
    return null
  }
}

/**
 * Read `users.org_id` back and confirm it holds the organization we are about to report as
 * joined.
 *
 * A write that RLS refuses still returns a response a caller can mistake for success, and an
 * account that boots into an organization it is not a member of looks entirely healthy from the
 * inside - it even registers a `user_sessions` row stamped with that org, so it shows up in
 * presence - while being absent from every query that reads real membership. Reporting no
 * organization is the honest answer and the one that surfaces the problem immediately.
 */
async function confirmMembership(api: RestApi, userId: string, orgId: string): Promise<boolean> {
  try {
    const response = await fetch(`${api.url}/rest/v1/users?select=org_id&id=eq.${userId}`, {
      headers: restHeaders(api),
    })
    const data = await response.json()
    const storedOrgId: string | null = data?.[0]?.org_id ?? null

    if (storedOrgId === orgId) return true

    authLog('error', 'Organization link did not persist', {
      expected: orgId.substring(0, 8) + '...',
      stored: storedOrgId ? storedOrgId.substring(0, 8) + '...' : null,
    })
    return false
  } catch (error) {
    authLog('error', 'Failed to confirm organization link', { error: String(error) })
    return false
  }
}

// Find and link organization by email domain, pending membership, or fetch existing org
// cachedOrgId: Optional org_id from already-fetched profile (avoids duplicate network request)
export async function linkUserToOrganization(
  userId: string,
  userEmail: string,
  cachedOrgId?: string | null,
): Promise<{ org: Organization | null; error: Error | string | null }> {
  const startTime = performance.now()
  authLog('info', 'linkUserToOrganization called', {
    userId: userId?.substring(0, 8) + '...',
    email: userEmail,
    hasCachedOrgId: !!cachedOrgId,
  })

  // Use raw fetch - Supabase client methods hang
  const config = getCurrentConfigValues()
  const url = config?.url || import.meta.env.VITE_SUPABASE_URL
  const key = config?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const accessToken = getCurrentAccessToken() || key
  const api: RestApi = { url, key, accessToken }

  try {
    // Use cached org_id if provided, otherwise fetch user profile
    let userProfile: { org_id?: string } | null =
      cachedOrgId !== undefined ? { org_id: cachedOrgId || undefined } : null

    // Only fetch profile if we don't have cached org_id
    if (cachedOrgId === undefined) {
      // First, check if user already has an org_id (with retry for new users)
      for (let attempt = 0; attempt < 3; attempt++) {
        const userResponse = await fetch(`${url}/rest/v1/users?select=org_id&id=eq.${userId}`, {
          headers: {
            apikey: key,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })
        const userData = await userResponse.json()
        userProfile = userData?.[0] || null

        if (userProfile) break

        // User record might not exist yet (trigger still running), wait and retry
        if (attempt < 2) {
          authLog('info', 'User record not found, waiting for trigger...', { attempt: attempt + 1 })
          await new Promise((resolve) => setTimeout(resolve, 1000))
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
              apikey: key,
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: '{}',
          })
          const ensureResult = await ensureResponse.json()
          authLog('info', 'ensure_user_org_id result', ensureResult)

          if (ensureResult?.created_user) {
            // Re-fetch user profile now that it exists
            const userResponse = await fetch(`${url}/rest/v1/users?select=org_id&id=eq.${userId}`, {
              headers: {
                apikey: key,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            })
            const userData = await userResponse.json()
            userProfile = userData?.[0] || null
            authLog('info', 'Re-fetched user profile after creation', {
              hasProfile: !!userProfile,
              orgId: userProfile?.org_id?.substring(0, 8) + '...',
            })
          }
        } catch (ensureErr) {
          authLog('warn', 'ensure_user_org_id RPC failed', { error: String(ensureErr) })
        }
      }
    }

    authLog('info', 'User profile lookup result', {
      hasProfile: !!userProfile,
      hasOrgId: !!userProfile?.org_id,
      orgId: userProfile?.org_id?.substring(0, 8) + '...',
      usedCache: cachedOrgId !== undefined,
    })

    if (userProfile?.org_id) {
      // User already has org_id, just fetch the organization (FAST PATH)
      authLog('info', 'User has org_id, fetching org details (fast path)')
      const orgFetchStart = performance.now()
      const orgResponse = await fetch(
        `${url}/rest/v1/organizations?select=*&id=eq.${userProfile.org_id}`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const orgData = await orgResponse.json()
      const orgFetchDuration = performance.now() - orgFetchStart

      if (orgData && orgData.length > 0) {
        const totalDuration = performance.now() - startTime
        recordMetric('Startup', 'Organization load complete', {
          durationMs: Math.round(totalDuration),
          path: 'fast',
          orgFetchMs: Math.round(orgFetchDuration),
        })
        authLog('info', 'Found existing org (fast path)', {
          orgName: orgData[0].name,
          durationMs: Math.round(totalDuration),
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
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    const allOrgsJson = await allOrgsResponse.json()
    const allOrgs = Array.isArray(allOrgsJson) ? allOrgsJson : []

    if (!allOrgsResponse.ok || !Array.isArray(allOrgsJson)) {
      authLog('warn', 'Failed to fetch organizations', {
        status: allOrgsResponse.status,
        body: allOrgsJson,
      })
    }

    authLog('info', 'Fetched all orgs', { count: allOrgs.length })

    const matchingOrg = allOrgs?.find((o: { email_domains?: string[] }) =>
      o.email_domains?.includes(domain),
    )

    if (matchingOrg) {
      authLog('info', 'Found matching org', {
        orgName: matchingOrg.name,
        hasSettings: !!matchingOrg.settings,
        settingsApiUrl: matchingOrg.settings?.api_url,
        settingsKeys: Object.keys(matchingOrg.settings || {}),
      })

      const joinedOrgId = matchingOrg.slug
        ? await joinOrgBySlug(api, matchingOrg.slug, 'domain_match')
        : null

      if (joinedOrgId && (await confirmMembership(api, userId, joinedOrgId))) {
        const totalDuration = performance.now() - startTime
        recordMetric('Startup', 'Organization load complete', {
          durationMs: Math.round(totalDuration),
          path: 'domain_match',
        })
        return { org: matchingOrg, error: null }
      }

      authLog('warn', 'Domain match did not establish membership, continuing resolution', {
        orgName: matchingOrg.name,
        hasSlug: !!matchingOrg.slug,
      })
    }

    authLog('info', 'No org found by domain, asking the server to resolve membership...', {
      domain,
    })

    // A pending invitation is applied by handle_new_user() and claim_pending_membership_trigger,
    // both of which run as definer. This asks the database to do that work now in case neither
    // trigger fired - the client cannot write org_id, role or claimed_at itself, so attempting
    // it here only produced writes that RLS silently refused.
    const ensuredOrgId = await ensureUserOrgIdRpc(api)

    if (ensuredOrgId && (await confirmMembership(api, userId, ensuredOrgId))) {
      const ensuredOrg = await fetchOrgById(api, ensuredOrgId)

      if (ensuredOrg) {
        const totalDuration = performance.now() - startTime
        recordMetric('Startup', 'Organization load complete', {
          durationMs: Math.round(totalDuration),
          path: 'pending_member',
        })
        authLog('info', 'Server resolved membership', { orgName: ensuredOrg.name })
        return { org: ensuredOrg, error: null }
      }
    }

    // Not resolvable server-side - try joining by org slug from config
    authLog('info', 'No pending membership, trying org slug from config...')

    // Import dynamically to avoid circular dependency
    const { loadConfig } = await import('../supabaseConfig')
    const loadedConfig = loadConfig()

    // First try the explicit org slug from config
    const orgSlugToUse = loadedConfig?.orgSlug

    if (orgSlugToUse) {
      authLog('info', 'Found org slug in config, calling join_org_by_slug', { slug: orgSlugToUse })
      const joinedOrgId = await joinOrgBySlug(api, orgSlugToUse, 'org_slug')

      if (joinedOrgId && (await confirmMembership(api, userId, joinedOrgId))) {
        const joinedOrg = await fetchOrgById(api, joinedOrgId)

        if (joinedOrg) {
          const totalDuration = performance.now() - startTime
          recordMetric('Startup', 'Organization load complete', {
            durationMs: Math.round(totalDuration),
            path: 'org_slug',
          })
          authLog('info', 'User joined org via slug', { orgName: joinedOrg.name })
          return { org: joinedOrg, error: null }
        }
      }
    }

    // Final fallback: if there's only ONE org in this database, join it
    // This handles legacy org codes that don't have a slug
    // Each organization has their own Supabase backend, so if a user has the org code,
    // they're connecting to THAT org's backend - the only org there is the right one
    if (allOrgs.length === 1 && allOrgs[0]?.slug) {
      authLog('info', 'Only one org in database, attempting to join via slug', {
        slug: allOrgs[0].slug,
      })
      const joinedOrgId = await joinOrgBySlug(api, allOrgs[0].slug, 'single_org')

      if (joinedOrgId && (await confirmMembership(api, userId, joinedOrgId))) {
        const totalDuration = performance.now() - startTime
        recordMetric('Startup', 'Organization load complete', {
          durationMs: Math.round(totalDuration),
          path: 'single_org',
        })
        authLog('info', 'User joined the only org in database', { orgName: allOrgs[0].name })
        return { org: allOrgs[0], error: null }
      }
    }

    const totalDuration = performance.now() - startTime
    recordMetric('Startup', 'Organization load complete', {
      durationMs: Math.round(totalDuration),
      path: 'not_found',
    })
    authLog('warn', 'No organization found for domain, pending membership, or org slug', {
      domain,
      orgsInDb: allOrgs?.length,
      durationMs: Math.round(totalDuration),
    })
    return {
      org: null,
      error: new Error(
        `No organization found for @${domain}. If you were invited, please contact your administrator.`,
      ),
    }
  } catch (error) {
    const totalDuration = performance.now() - startTime
    recordMetric('Startup', 'Organization load complete', {
      durationMs: Math.round(totalDuration),
      path: 'error',
    })
    authLog('error', 'linkUserToOrganization failed', {
      error: String(error),
      durationMs: Math.round(totalDuration),
    })
    return { org: null, error: error as Error }
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
