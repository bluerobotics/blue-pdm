/**
 * BluePLM API Authentication Middleware
 *
 * Fastify plugin that validates JWT tokens and attaches user profile to requests.
 *
 * Security note: Verbose logging is disabled by default. Do not log tokens,
 * full user IDs, or email addresses in production.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { createSupabaseClient } from '../src/infrastructure/supabase.js'
import { sendError } from '../utils/index.js'
import type { UserProfile } from '../types.js'

/**
 * Truncate a UUID for safe logging (shows first 8 characters)
 */
function truncateId(id: string): string {
  return id.length > 8 ? `${id.substring(0, 8)}...` : id
}

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  // Decorate request with user, supabase client, and access token
  fastify.decorateRequest('user', null)
  fastify.decorateRequest('supabase', null)
  fastify.decorateRequest('accessToken', null)

  // Add authenticate method to fastify instance
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      try {
        const authHeader = request.headers.authorization

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          fastify.log.warn('[Auth] Missing or invalid auth header')
          sendError(reply, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header')
          throw new Error('Auth: Missing header')
        }

        const token = authHeader.substring(7)

        if (!token || token === 'undefined' || token === 'null') {
          fastify.log.warn('[Auth] Empty or invalid token string')
          sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or missing access token')
          throw new Error('Auth: Invalid token string')
        }

        const supabase = createSupabaseClient(token)
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser(token)

        if (error || !user) {
          fastify.log.warn('[Auth] Token verification failed')
          sendError(reply, 401, 'UNAUTHORIZED', error?.message || 'Token verification failed')
          throw new Error('Auth: Token verification failed')
        }

        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('id, email, role, org_id, full_name')
          .eq('id', user.id)
          .single()

        if (profileError || !profile) {
          fastify.log.warn({ msg: '[Auth] Profile lookup failed', userId: truncateId(user.id) })
          sendError(reply, 401, 'UNAUTHORIZED', 'User profile does not exist')
          throw new Error('Auth: Profile not found')
        }

        if (!profile.org_id) {
          fastify.log.warn({ msg: '[Auth] User has no organization', userId: truncateId(user.id) })
          sendError(reply, 403, 'FORBIDDEN', 'User is not a member of any organization')
          throw new Error('Auth: No organization')
        }

        // Success - set user on request
        request.user = profile as UserProfile
        request.supabase = supabase
        request.accessToken = token

        // Log success with minimal info (no email, truncated ID)
        fastify.log.debug({ msg: '[Auth] Authenticated', userId: truncateId(profile.id) })
      } catch (error) {
        // Re-throw to stop the request lifecycle (error already logged above)
        throw error
      }
    },
  )
}

// Wrap with fastify-plugin to make decorators available to parent scope
const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin',
})

export default authPlugin

/**
 * The five actions `permission_action` allows in the database.
 */
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'admin'

/**
 * Build a preHandler that requires a team permission on a resource.
 *
 * The check is delegated to the `user_has_team_permission(resource, action)`
 * SQL function through the request's RLS-scoped client, which is the exact
 * predicate the RLS policies use. Deciding it here in TypeScript instead would
 * create a second, drifting definition of who may do what - and it would
 * matter, because the routes that need this run their writes through the
 * service-role client, where RLS is not there to catch a disagreement.
 *
 * That function grants access when the user is an org admin (a member of the
 * 'Administrators' team) and otherwise requires an EXACT action match. It does
 * not treat an 'admin' grant on the resource as implying 'view', 'create' or
 * anything else, so ask for the action you actually need.
 *
 * Fails closed: an error talking to the database is a denial, not an allow.
 *
 * @param resource - Permission resource, e.g. `module:customers`
 * @param action - Exact action required, e.g. `create`
 */
export function requireTeamPermission(resource: string, action: PermissionAction) {
  return async function checkTeamPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.user || !request.supabase) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Authentication required')
      throw new Error('Permission: unauthenticated')
    }

    const { data, error } = await request.supabase.rpc('user_has_team_permission', {
      p_resource: resource,
      p_action: action,
    })

    if (error) {
      request.log.warn({
        msg: '[Auth] Permission check failed',
        resource,
        action,
        userId: truncateId(request.user.id),
        error: error.message,
      })
      sendError(reply, 403, 'FORBIDDEN', 'Permission check failed')
      throw new Error('Permission: check failed')
    }

    if (data !== true) {
      request.log.warn({
        msg: '[Auth] Permission denied',
        resource,
        action,
        userId: truncateId(request.user.id),
      })
      sendError(reply, 403, 'FORBIDDEN', `Requires '${action}' permission on '${resource}'`)
      throw new Error('Permission: denied')
    }
  }
}
