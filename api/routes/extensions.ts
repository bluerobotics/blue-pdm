/**
 * Extension Routes
 *
 * API endpoints for extension management and handler execution.
 *
 * Admin Endpoints:
 * - POST /admin/extensions/install - Install an extension
 * - DELETE /admin/extensions/:id - Uninstall an extension
 * - GET /admin/extensions - List installed extensions
 * - GET /admin/extensions/:id/stats - Get extension statistics
 * - PATCH /admin/extensions/:id - Enable/disable extension
 *
 * Handler Routing:
 * - ALL /extensions/:extensionId/* - Route to extension handlers
 */

import { FastifyPluginAsync } from 'fastify'
import {
  getLoader,
  installExtension,
  uninstallExtension,
  setExtensionEnabled,
  createExtensionRouteHandler,
  getIsolatePool,
  getRateLimiter,
} from '../src/extensions/index.js'
import type { InstallExtensionRequest, ExtensionManifest } from '../src/extensions/types.js'
import { sendError } from '../utils/index.js'

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

// Common error response schema
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
}

const installSchema = {
  description: 'Install an extension for this organization',
  tags: ['Extensions'],
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['extensionId', 'version', 'manifest', 'handlers'],
    properties: {
      extensionId: {
        type: 'string',
        description: 'Extension identifier (e.g., blueplm.google-drive)',
      },
      version: { type: 'string', description: 'Semantic version' },
      manifest: { type: 'object', description: 'Extension manifest (extension.json)' },
      handlers: { type: 'object', description: 'Handler code map { handlerPath: code }' },
      allowedDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Allowed HTTP domains for this extension',
      },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        extensionId: { type: 'string' },
        version: { type: 'string' },
        message: { type: 'string' },
      },
    },
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
}

const uninstallSchema = {
  description: 'Uninstall an extension',
  tags: ['Extensions'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Extension identifier' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
}

const listSchema = {
  description: 'List installed extensions',
  tags: ['Extensions'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: 'object',
      properties: {
        extensions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              extension_id: { type: 'string' },
              version: { type: 'string' },
              enabled: { type: 'boolean' },
              installed_at: { type: 'string' },
              manifest: { type: 'object' },
            },
          },
        },
      },
    },
  },
}

const statsSchema = {
  description: 'Get extension statistics',
  tags: ['Extensions'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Extension identifier' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        extensionId: { type: 'string' },
        handlers: { type: 'number' },
        rateLimit: { type: 'object' },
        pool: { type: 'object' },
      },
    },
    404: errorResponseSchema,
  },
}

const updateSchema = {
  description: 'Update extension settings',
  tags: ['Extensions'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Extension identifier' },
    },
  },
  body: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'Enable or disable the extension' },
      pinnedVersion: {
        type: 'string',
        description: 'Pin to specific version (null for auto-update)',
      },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSION ROUTES PLUGIN
// ═══════════════════════════════════════════════════════════════════════════════

const extensionRoutes: FastifyPluginAsync = async (fastify) => {
  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Install an extension
   */
  fastify.post(
    '/admin/extensions/install',
    {
      schema: installSchema,
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const user = request.user!

      // Only admins can install extensions
      if (user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Only admins can install extensions')
      }

      const body = request.body as InstallExtensionRequest

      try {
        await installExtension(
          request.supabase!,
          user.org_id!,
          body.extensionId,
          body.version,
          body.manifest as ExtensionManifest,
          body.handlers,
          body.allowedDomains ?? [],
          user.id,
        )

        return {
          success: true,
          extensionId: body.extensionId,
          version: body.version,
          message: `Extension ${body.extensionId} v${body.version} installed successfully`,
        }
      } catch (error) {
        request.log.error({ error }, 'Failed to install extension')
        return sendError(reply, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error')
      }
    },
  )

  /**
   * Uninstall an extension
   */
  fastify.delete(
    '/admin/extensions/:id',
    {
      schema: uninstallSchema,
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const user = request.user!
      const { id: extensionId } = request.params as { id: string }

      if (user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Only admins can uninstall extensions')
      }

      try {
        await uninstallExtension(request.supabase!, user.org_id!, extensionId)

        return {
          success: true,
          message: `Extension ${extensionId} uninstalled successfully`,
        }
      } catch (error) {
        request.log.error({ error }, 'Failed to uninstall extension')
        return sendError(reply, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error')
      }
    },
  )

  /**
   * List installed extensions
   */
  fastify.get(
    '/admin/extensions',
    {
      schema: listSchema,
      preHandler: fastify.authenticate,
    },
    async (request) => {
      const user = request.user!
      const loader = getLoader(request.supabase!, user.org_id!)

      if (!loader.isLoaded()) {
        await loader.loadAll()
      }

      const extensions = loader.getAllExtensions().map((ext) => ({
        extension_id: ext.extension_id,
        version: ext.version,
        enabled: ext.enabled,
        installed_at: ext.installed_at,
        manifest: {
          name: ext.manifest.name,
          description: ext.manifest.description,
          publisher: ext.manifest.publisher,
          category: ext.manifest.category,
        },
      }))

      return { extensions }
    },
  )

  /**
   * Get extension statistics
   */
  fastify.get(
    '/admin/extensions/:id/stats',
    {
      schema: statsSchema,
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const user = request.user!
      const { id: extensionId } = request.params as { id: string }

      const loader = getLoader(request.supabase!, user.org_id!)

      if (!loader.isLoaded()) {
        await loader.loadAll()
      }

      const extension = loader.getExtension(extensionId)

      if (!extension) {
        return sendError(reply, 404, 'NOT_FOUND', `Extension ${extensionId} not found`)
      }

      const handlers = loader.getExtensionHandlers(extensionId)
      const pool = getIsolatePool()
      const limiter = getRateLimiter()

      return {
        extensionId,
        handlers: handlers.length,
        handlerPaths: handlers.map((h) => `${h.method} ${h.path}`),
        rateLimit: limiter.getStatus(user.org_id!, extensionId),
        pool: pool.getStats(),
      }
    },
  )

  /**
   * Update extension settings (enable/disable, pin version)
   */
  fastify.patch(
    '/admin/extensions/:id',
    {
      schema: updateSchema,
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const user = request.user!
      const { id: extensionId } = request.params as { id: string }
      const body = request.body as { enabled?: boolean; pinnedVersion?: string | null }

      if (user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Only admins can update extension settings')
      }

      try {
        if (body.enabled !== undefined) {
          await setExtensionEnabled(request.supabase!, user.org_id!, extensionId, body.enabled)
        }

        if (body.pinnedVersion !== undefined) {
          await request
            .supabase!.from('org_installed_extensions')
            .update({ pinned_version: body.pinnedVersion })
            .eq('org_id', user.org_id!)
            .eq('extension_id', extensionId)
        }

        return {
          success: true,
          message: `Extension ${extensionId} updated successfully`,
        }
      } catch (error) {
        request.log.error({ error }, 'Failed to update extension')
        return sendError(reply, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error')
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTENSION HANDLER ROUTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Route all requests to extension handlers.
   *
   * Authentication is a preHandler, as it is on every other protected route, so
   * a refused request never reaches the handler. A handler declared `public` in
   * its manifest is therefore not reachable without a token either; see
   * `docs/extensions/contributions.md` and the note in `loader.ts` for why that
   * is currently the case.
   */
  const extensionHandler = createExtensionRouteHandler()

  // Register catch-all route for extension handlers
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/extensions/:extensionId/*',
    schema: {
      description: 'Extension handler endpoint',
      tags: ['Extensions'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          extensionId: { type: 'string' },
          '*': { type: 'string' },
        },
      },
    },
    preHandler: fastify.authenticate,
    handler: extensionHandler,
  })

  // Also handle root extension paths (no trailing path)
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/extensions/:extensionId',
    schema: {
      description: 'Extension handler endpoint (root)',
      tags: ['Extensions'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          extensionId: { type: 'string' },
        },
      },
    },
    preHandler: fastify.authenticate,
    handler: extensionHandler,
  })
}

export default extensionRoutes
