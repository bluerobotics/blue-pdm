/**
 * Extension Server Runtime API
 *
 * Implements the ExtensionServerAPI that extension handlers use to interact
 * with storage, secrets, HTTP, and request context.
 *
 * @module extensions/runtime
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtensionRequestContext, ExtensionUserContext, ExtensionManifest } from './types.js'
import { ExtensionStorage } from './storage.js'
import { ExtensionSecrets } from './secrets.js'
import { logHttpRequest } from './http-logger.js'
import { log } from '../infrastructure/logging.js'

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSION SERVER API INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Server-side API available to extension handlers.
 *
 * This is the primary interface extension code uses in sandbox execution.
 */
export interface ExtensionServerAPI {
  /**
   * Extension-scoped key-value storage.
   * Persisted to org's Supabase database.
   */
  storage: {
    get<T>(key: string): Promise<T | undefined>
    set<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<void>
    list(prefix?: string): Promise<string[]>
  }

  /**
   * Encrypted secrets storage.
   * Limited to 50 secrets, 10KB each. All access is audited.
   */
  secrets: {
    get(name: string): Promise<string | undefined>
    set(name: string, value: string): Promise<void>
    delete(name: string): Promise<void>
  }

  /**
   * HTTP client for external API calls.
   * Domain-restricted based on extension permissions.
   */
  http: {
    fetch(url: string, options?: RequestInit): Promise<Response>
  }

  /**
   * Current HTTP request context.
   */
  request: ExtensionRequestContext

  /**
   * Authenticated user context (null for public endpoints).
   */
  user: ExtensionUserContext | null

  /**
   * Response helpers for handler return values.
   */
  response: {
    json(data: unknown, status?: number): ExtensionResponse
    error(message: string, status?: number): ExtensionResponse
    redirect(url: string, status?: number): ExtensionResponse
  }
}

/**
 * Extension handler response type.
 */
export interface ExtensionResponse {
  type: 'json' | 'error' | 'redirect'
  data?: unknown
  message?: string
  url?: string
  status: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for creating an ExtensionServerAPI instance.
 */
export interface RuntimeOptions {
  orgId: string
  extensionId: string
  manifest: ExtensionManifest
  supabase: SupabaseClient
  request: ExtensionRequestContext
  user: ExtensionUserContext | null
  encryptionKey: string
}

/**
 * Creates an ExtensionServerAPI instance for handler execution.
 *
 * This API is injected into the sandbox context and provides controlled
 * access to storage, secrets, and HTTP functionality.
 *
 * @param options - Runtime configuration
 * @returns Callable API reference for sandbox
 */
export function createExtensionRuntime(options: RuntimeOptions): ExtensionServerAPICallable {
  const { orgId, extensionId, manifest, supabase, request, user, encryptionKey } = options

  // Get allowed domains from manifest permissions
  const allowedDomains = extractAllowedDomains(manifest.permissions.server ?? [])

  // Create storage and secrets handlers
  const storage = new ExtensionStorage(supabase, orgId, extensionId)
  const secrets = new ExtensionSecrets(
    supabase,
    orgId,
    extensionId,
    encryptionKey,
    user?.id ?? 'system',
  )

  // Create callable API that the sandbox can invoke
  const apiCallable: ExtensionServerAPICallable = async (
    method: string,
    args: unknown[],
  ): Promise<unknown> => {
    switch (method) {
      // Storage methods
      case 'storage.get':
        return storage.get(args[0] as string)
      case 'storage.set':
        return storage.set(args[0] as string, args[1])
      case 'storage.delete':
        return storage.delete(args[0] as string)
      case 'storage.list':
        return storage.list(args[0] as string | undefined)

      // Secrets methods
      case 'secrets.get':
        return secrets.get(args[0] as string)
      case 'secrets.set':
        return secrets.set(args[0] as string, args[1] as string)
      case 'secrets.delete':
        return secrets.delete(args[0] as string)

      // HTTP methods
      case 'http.fetch':
        return handleHttpFetch(
          args[0] as string,
          args[1] as RequestInit | undefined,
          allowedDomains,
          orgId,
          extensionId,
          supabase,
        )

      // Context getters
      case 'getRequest':
        return request
      case 'getUser':
        return user

      default:
        throw new Error(`Unknown API method: ${method}`)
    }
  }

  return apiCallable
}

/**
 * Callable API reference for isolated-vm.
 */
export type ExtensionServerAPICallable = (method: string, args: unknown[]) => Promise<unknown>

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP FETCH HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle HTTP fetch requests from extension handlers.
 * Validates domain against allowlist and logs all requests.
 */
async function handleHttpFetch(
  url: string,
  options: RequestInit | undefined,
  allowedDomains: string[],
  orgId: string,
  extensionId: string,
  supabase: SupabaseClient,
): Promise<SerializableResponse> {
  const startTime = Date.now()
  let status = 0

  // Named apart from the catch binding on purpose. This used to be `error`, so the
  // catch below shadowed it, the assignment landed on the binding rather than on this
  // variable, and the audit row in the `finally` recorded `undefined` for every failure
  // the runtime ever logged.
  let failure: string | undefined

  try {
    // Validate URL
    const parsedUrl = new URL(url)
    const domain = parsedUrl.hostname

    // Check domain allowlist (skip if wildcard allowed)
    if (!allowedDomains.includes('*')) {
      const isAllowed = allowedDomains.some((allowed) => {
        if (allowed.startsWith('*.')) {
          // Wildcard subdomain match
          const baseDomain = allowed.slice(2)
          return domain === baseDomain || domain.endsWith('.' + baseDomain)
        }
        return domain === allowed
      })

      if (!isAllowed) {
        throw new Error(
          `Domain ${domain} not in extension's allowed domains: ${allowedDomains.join(', ')}`,
        )
      }
    }

    // Make the fetch request
    const response = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': `BluePLM-Extension/${extensionId}`,
        ...options?.headers,
      },
    })

    status = response.status

    // Convert response to serializable format for sandbox
    const responseBody = await response.text()

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)

    // Rethrown as it arrived. Replacing it with its own message threw a bare string
    // across the sandbox boundary, which carries no stack for the operator to read.
    throw error
  } finally {
    // Log the HTTP request
    const duration = Date.now() - startTime
    await logHttpRequest(supabase, {
      org_id: orgId,
      extension_id: extensionId,
      method: options?.method ?? 'GET',
      url,
      status,
      duration_ms: duration,
      request_size: options?.body ? String(options.body).length : 0,
      response_size: 0, // Would need to capture this
      error: failure,
    }).catch((error) => log.error({ err: error }, '[Runtime] Failed to log HTTP request'))
  }
}

/**
 * Serializable response for passing through sandbox boundary.
 */
interface SerializableResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract allowed domains from server permissions.
 */
function extractAllowedDomains(permissions: string[]): string[] {
  const domains: string[] = []

  for (const perm of permissions) {
    if (perm === 'http:fetch') {
      // Wildcard - all domains allowed
      domains.push('*')
    } else if (perm.startsWith('http:domain:')) {
      domains.push(perm.slice('http:domain:'.length))
    }
  }

  return domains
}

/**
 * Create response helpers.
 */
export function createResponseHelpers() {
  return {
    json(data: unknown, status = 200): ExtensionResponse {
      return { type: 'json', data, status }
    },
    error(message: string, status = 500): ExtensionResponse {
      return { type: 'error', message, status }
    },
    redirect(url: string, status = 302): ExtensionResponse {
      return { type: 'redirect', url, status }
    },
  }
}
