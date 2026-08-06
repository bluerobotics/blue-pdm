/**
 * Extension Request Router
 *
 * Routes incoming HTTP requests to the appropriate extension handler
 * and executes them in the V8 sandbox.
 *
 * @module extensions/router
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getIsolatePool, type SandboxResult } from './sandbox.js'
import { createExtensionRuntime } from './runtime.js'
import { getLoader, type LoadedHandler } from './loader.js'
import { checkRateLimit, getRateLimitHeaders } from './ratelimit.js'
import { env } from '../config/env.js'
import { sendError } from '../../utils/index.js'
import type { ExtensionRequestContext, ExtensionUserContext } from './types.js'

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extension router configuration.
 */
export interface RouterOptions {
  /** Encryption key for secrets. Falls back to env.EXTENSION_ENCRYPTION_KEY */
  encryptionKey?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Route an extension request to its handler.
 *
 * The caller must already have authenticated the request: `orgId` has to be the
 * organization of `user`, never a value taken from the request. Everything this
 * function reaches - the installed-extension rows, the handler source, the
 * sandbox and its side effects - is scoped by `orgId` alone, so an org id that
 * the caller could choose would be a cross-tenant read and a blind write.
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 * @param supabase - Supabase client scoped to the authenticated user
 * @param orgId - Organization of the authenticated user
 * @param user - Authenticated user
 * @param options - Router options
 */
export async function routeExtensionRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  supabase: SupabaseClient,
  orgId: string,
  user: ExtensionUserContext,
  options: RouterOptions = {},
): Promise<void> {
  const startTime = Date.now()

  // Parse the extension path: /extensions/{extensionId}/{path}
  const pathMatch = request.url.match(/^\/extensions\/([^/?]+)(?:\/([^?]*))?/)

  if (!pathMatch) {
    sendError(reply, 404, 'NOT_FOUND', 'Invalid extension path')
    return
  }

  const [, extensionId, handlerPath = ''] = pathMatch

  // Get loader and ensure extensions are loaded
  const loader = getLoader(supabase, orgId)
  if (!loader.isLoaded()) {
    await loader.loadAll()
  }

  // Find the handler
  const handler = loader.getHandler(request.method, extensionId, handlerPath)

  if (!handler) {
    sendError(reply, 404, 'NOT_FOUND', `No handler found for ${request.method} /extensions/${extensionId}/${handlerPath}`)
    return
  }

  // Check rate limit
  const bodySize = request.headers['content-length']
    ? parseInt(request.headers['content-length'], 10)
    : 0

  const rateLimitResult = checkRateLimit(orgId, extensionId, bodySize)
  const rateLimitHeaders = getRateLimitHeaders(rateLimitResult)

  // Set rate limit headers
  for (const [key, value] of Object.entries(rateLimitHeaders)) {
    reply.header(key, value)
  }

  if (!rateLimitResult.allowed) {
    sendError(reply, 429, 'RATE_LIMIT_EXCEEDED', `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter} seconds.`)
    return
  }

  // Execute the handler
  const result = await executeHandler(handler, request, supabase, orgId, user, options)

  // Send response
  const executionTime = Date.now() - startTime
  reply.header('X-Extension-Execution-Time', String(executionTime))

  if (result.success && result.response) {
    const { status, headers, body } = result.response

    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value)
    }

    reply.code(status).send(body)
  } else {
    const status =
      result.errorCode === 'TIMEOUT' ? 504 : result.errorCode === 'MEMORY_EXCEEDED' ? 503 : 500

    sendError(reply, status, result.errorCode ?? 'EXECUTION_ERROR', result.error ?? 'Handler execution failed')
  }
}

/**
 * Execute an extension handler in the sandbox.
 */
async function executeHandler(
  handler: LoadedHandler,
  request: FastifyRequest,
  supabase: SupabaseClient,
  orgId: string,
  user: ExtensionUserContext,
  options: RouterOptions,
): Promise<SandboxResult> {
  // Build request context
  const requestContext: ExtensionRequestContext = {
    method: request.method,
    path: request.url,
    body: request.body,
    headers: Object.fromEntries(
      Object.entries(request.headers)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string]),
    ),
    query: request.query as Record<string, string>,
    params: request.params as Record<string, string>,
  }

  // Get encryption key — never fall back to a default; require explicit configuration
  const encryptionKey =
    options.encryptionKey ?? ((env as Record<string, unknown>).EXTENSION_ENCRYPTION_KEY as string)
  if (!encryptionKey) {
    throw new Error(
      'EXTENSION_ENCRYPTION_KEY is required for extension secret encryption. Set it in your environment variables (min 32 characters).',
    )
  }

  // Create runtime API
  const apiCallable = createExtensionRuntime({
    orgId,
    extensionId: handler.extensionId,
    manifest: handler.manifest,
    supabase,
    request: requestContext,
    user,
    encryptionKey,
  })

  // Execute in sandbox
  const pool = getIsolatePool()
  return pool.execute(
    handler.extensionId,
    handler.code,
    apiCallable as unknown as import('./runtime.js').ExtensionServerAPI,
    handler.manifest,
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASTIFY PLUGIN HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a Fastify route handler for extension requests.
 *
 * Register it behind `preHandler: fastify.authenticate`, exactly like every
 * other protected route. This handler deliberately does not call `authenticate`
 * itself. It used to, inside a `try`/`catch`, and that was the bug: the guard
 * both sends a 401 and throws, the `catch` swallowed the throw, and the rest of
 * this function then ran on a request that had already been refused - reading
 * the org from a caller-supplied `X-Org-Id` header and querying with an
 * anon-key client. Nothing returned to the caller, so the only visible trace
 * was a "Promise errored, but reply.sent = true" line in the log.
 *
 * As a `preHandler` the guard's throw aborts the lifecycle before Fastify ever
 * reaches the handler, so "refused" and "did not run" are the same event rather
 * than two things that have to agree.
 *
 * @param options - Router options
 */
export function createExtensionRouteHandler(options: RouterOptions = {}) {
  return async function extensionRouteHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Unreachable behind the authenticate preHandler. Kept because everything
    // below is scoped by the org id alone, so this is the assumption that has
    // to hold rather than one that is merely expected to.
    if (!request.user?.org_id || !request.supabase) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Authentication required')
      return
    }

    const user: ExtensionUserContext = {
      id: request.user.id,
      email: request.user.email,
      orgId: request.user.org_id,
      role: request.user.role,
    }

    await routeExtensionRequest(request, reply, request.supabase, user.orgId, user, options)
  }
}
