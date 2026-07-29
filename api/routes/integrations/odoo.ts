/**
 * Odoo Integration Routes
 *
 * Configuration, testing, and sync with Odoo ERP.
 *
 * The Odoo API key is never returned to a client and is never written to
 * `odoo_saved_configs.api_key_encrypted` or
 * `organization_integrations.credentials_encrypted`. Both of those columns sit
 * on rows that every member of the org can read through PostgREST, so the
 * credential lives in `integration_credentials` instead, reachable only with
 * the service-role client. See api/src/integrations/credentialStore.ts.
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeOdooUrl,
  testOdooConnection,
  fetchOdooSuppliers,
  sendError,
  ErrorCode,
} from '../../utils/index.js'
import {
  CredentialKeyMissingError,
  CredentialStoreUnavailableError,
  credentialSetupProblem,
  deleteCredential,
  getCredential,
  hasEncryptionKey,
  openCredentialStore,
  setCredential,
  type CredentialOwnerType,
} from '../../src/integrations/credentialStore.js'

// Re-exported because they were defined here before moving to the credential
// store, and the route's tests import them from this module.
export { CredentialStoreUnavailableError, credentialSetupProblem }

/**
 * Everything a client is allowed to see about a saved config. Listed out rather
 * than selecting `*` so that a deprecated credential column cannot ride along
 * in a response.
 */
const SAVED_CONFIG_COLUMNS =
  'id, name, description, url, database, username, color, is_active, last_tested_at, last_test_success, created_at'

/** Credentials are stored per organization, so a user without one has nowhere to put them. */
const NO_ORGANIZATION = 'Your account is not linked to an organization'

type OdooRouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

function withCredentialErrors(handler: OdooRouteHandler): OdooRouteHandler {
  return async (request, reply) => {
    try {
      return await handler(request, reply)
    } catch (err) {
      const problem = credentialSetupProblem(err)
      if (!problem) throw err
      request.log.error({ err }, 'Odoo credential store is not usable')
      return sendError(reply, 503, ErrorCode.INTERNAL_ERROR, problem)
    }
  }
}

export interface OdooConnectionIdentity {
  url: string
  database: string
  username: string
}

/**
 * Find the saved config describing the same connection.
 *
 * The API key used to be part of this comparison, back when it sat in a column
 * on the row. It is now obtainable only by decrypting it, so including it would
 * mean decrypting every saved config on every save. It is also the wrong test:
 * a connection is identified by where it points and who it logs in as, and a
 * new key for that same target is a rotation of the connection rather than a
 * different one.
 */
export function findMatchingSavedConfig<T extends OdooConnectionIdentity>(
  configs: T[] | null | undefined,
  target: OdooConnectionIdentity,
): T | undefined {
  return configs?.find(
    (c) => c.url === target.url && c.database === target.database && c.username === target.username,
  )
}

/**
 * Whether a usable credential is stored, for UI that shows a key as already
 * set. A credential that cannot be decrypted counts as absent: re-entering it
 * is the only way out of that state, which is what the UI asks for when this
 * is false.
 */
async function hasStoredCredential(
  credentials: SupabaseClient,
  ownerType: CredentialOwnerType,
  ownerId: string,
): Promise<boolean> {
  try {
    return Boolean(await getCredential(credentials, ownerType, ownerId))
  } catch {
    return false
  }
}

/**
 * Refuse a save that would write a row and then fail to store its credential.
 * `setCredential` throws the same error moments later; raising it up front just
 * keeps the connection and its key from getting out of step.
 */
function requireEncryptionKey(): void {
  if (!hasEncryptionKey()) throw new CredentialKeyMissingError()
}

const odooRoutes: FastifyPluginAsync = async (fastify) => {
  // Get Odoo integration settings
  fastify.get(
    '/integrations/odoo',
    {
      schema: {
        description: 'Get Odoo integration settings',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, ErrorCode.UNAUTHORIZED, 'Authentication required')
      }

      const { data, error } = await request
        .supabase!.from('organization_integrations')
        .select(
          'id, settings, is_connected, last_sync_at, last_sync_status, last_sync_count, auto_sync',
        )
        .eq('org_id', request.user.org_id)
        .eq('integration_type', 'odoo')
        .single()

      if (error || !data) {
        return { configured: false }
      }

      return {
        configured: true,
        settings: {
          url: data.settings?.url,
          database: data.settings?.database,
          username: data.settings?.username,
        },
        // The key itself never leaves the server; the client only needs to know
        // whether one is stored so it can show the field as already set.
        has_api_key: await hasStoredCredential(
          openCredentialStore(),
          'organization_integration',
          data.id,
        ),
        is_connected: data.is_connected,
        last_sync_at: data.last_sync_at,
        last_sync_status: data.last_sync_status,
        last_sync_count: data.last_sync_count,
        auto_sync: data.auto_sync,
      }
    }),
  )

  // Configure Odoo integration
  fastify.post(
    '/integrations/odoo',
    {
      schema: {
        description: 'Configure Odoo integration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          // api_key is optional: the client cannot read the stored key back, so
          // an edit that leaves the field untouched sends nothing and keeps it.
          required: ['url', 'database', 'username'],
          properties: {
            url: { type: 'string' },
            database: { type: 'string' },
            username: { type: 'string' },
            api_key: { type: 'string' },
            auto_sync: { type: 'boolean', default: false },
            skip_test: { type: 'boolean', default: false },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (!request.user || request.user.role !== 'admin') {
        return sendError(reply, 403, ErrorCode.FORBIDDEN, 'Only admins can configure integrations')
      }

      const { url, database, username, api_key, auto_sync, skip_test } = request.body as {
        url: string
        database: string
        username: string
        api_key?: string
        auto_sync?: boolean
        skip_test?: boolean
      }

      const orgId = request.user.org_id
      if (!orgId) return sendError(reply, 403, ErrorCode.FORBIDDEN, NO_ORGANIZATION)

      const userId = request.user.id
      const normalizedUrl = normalizeOdooUrl(url)
      const credentials = openCredentialStore()

      const { data: existingConfigs } = await request
        .supabase!.from('odoo_saved_configs')
        .select('id, url, database, username')
        .eq('org_id', orgId)
        .eq('is_active', true)

      const matchingConfig = findMatchingSavedConfig(existingConfigs, {
        url: normalizedUrl,
        database,
        username,
      })

      const { data: existingIntegration } = await request
        .supabase!.from('organization_integrations')
        .select('id')
        .eq('org_id', orgId)
        .eq('integration_type', 'odoo')
        .maybeSingle()

      // Fall back to the stored key so that editing the URL or username does
      // not require the admin to dig the key out of Odoo again.
      let apiKey = (api_key ?? '').trim()
      if (!apiKey && matchingConfig) {
        apiKey = (await getCredential(credentials, 'odoo_saved_config', matchingConfig.id)) ?? ''
      }
      if (!apiKey && existingIntegration) {
        apiKey =
          (await getCredential(credentials, 'organization_integration', existingIntegration.id)) ??
          ''
      }
      if (!apiKey) {
        return sendError(
          reply,
          400,
          ErrorCode.BAD_REQUEST,
          'An Odoo API key is required: none was supplied and none is stored for this connection.',
        )
      }

      requireEncryptionKey()

      let isConnected = false
      let connectionError: string | null = null

      if (!skip_test) {
        const testResult = await testOdooConnection(normalizedUrl, database, username, apiKey)
        isConnected = testResult.success
        connectionError = testResult.error || null
      }

      let configId: string | null = matchingConfig?.id || null
      let configName: string | null = null

      if (!matchingConfig) {
        const baseName = normalizedUrl.replace(/^https?:\/\//, '').split('/')[0]
        const colors = [
          '#22c55e',
          '#3b82f6',
          '#8b5cf6',
          '#f97316',
          '#ec4899',
          '#06b6d4',
          '#eab308',
          '#ef4444',
        ]

        const { data: newConfig } = await request
          .supabase!.from('odoo_saved_configs')
          .insert({
            org_id: orgId,
            name: baseName,
            url: normalizedUrl,
            database,
            username,
            color: colors[(existingConfigs?.length || 0) % colors.length],
            is_active: true,
            last_tested_at: !skip_test ? new Date().toISOString() : null,
            last_test_success: !skip_test ? isConnected : null,
            created_by: userId,
            updated_by: userId,
          })
          .select('id, name')
          .single()

        if (newConfig) {
          configId = newConfig.id
          configName = newConfig.name
        }
      }

      // Credentials are keyed on the owning row, so the row has to exist first.
      if (configId) {
        await setCredential(credentials, orgId, 'odoo_saved_config', configId, apiKey, userId)
      }

      const { data: integration, error } = await request
        .supabase!.from('organization_integrations')
        .upsert(
          {
            org_id: orgId,
            integration_type: 'odoo',
            settings: {
              url: normalizedUrl,
              database,
              username,
              config_id: configId,
              config_name: configName,
            },
            // Deprecated column, cleared rather than written: anything left in
            // it would be readable by every member of the org.
            credentials_encrypted: null,
            is_active: true,
            is_connected: isConnected,
            last_connected_at: isConnected ? new Date().toISOString() : null,
            last_error: connectionError,
            auto_sync: auto_sync || false,
            updated_by: userId,
          },
          { onConflict: 'org_id,integration_type' },
        )
        .select('id')
        .single()

      if (error) throw error
      if (!integration) throw new Error('Odoo integration row was not returned after save')

      await setCredential(
        credentials,
        orgId,
        'organization_integration',
        integration.id,
        apiKey,
        userId,
      )

      return {
        success: true,
        message: isConnected
          ? 'Odoo integration connected!'
          : `Saved but connection failed: ${connectionError}`,
        new_config: configName ? { id: configId, name: configName } : undefined,
      }
    }),
  )

  // Test Odoo connection
  fastify.post(
    '/integrations/odoo/test',
    {
      schema: {
        description: 'Test Odoo connection',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          // The caller supplies the key. There is deliberately no fall back to
          // the stored one: this route takes an arbitrary URL from any
          // authenticated user, so a stored key would be sent wherever they
          // asked. Use "Save & Test" to exercise a key already on file.
          required: ['url', 'database', 'username', 'api_key'],
          properties: {
            url: { type: 'string' },
            database: { type: 'string' },
            username: { type: 'string' },
            api_key: { type: 'string' },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { url, database, username, api_key } = request.body as {
        url: string
        database: string
        username: string
        api_key: string
      }

      const result = await testOdooConnection(url, database, username, api_key)

      if (!result.success) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, result.error || 'Connection test failed')
      }

      return { success: true, user_name: result.user_name, version: result.version }
    },
  )

  // Sync suppliers from Odoo
  fastify.post(
    '/integrations/odoo/sync/suppliers',
    {
      schema: {
        description: 'Sync suppliers from Odoo',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (!request.user) {
        return sendError(reply, 401, ErrorCode.UNAUTHORIZED)
      }
      if (request.user.role !== 'admin' && request.user.role !== 'engineer') {
        return sendError(reply, 403, ErrorCode.FORBIDDEN, 'Only admins and engineers can sync')
      }

      const { data: integration } = await request
        .supabase!.from('organization_integrations')
        .select('id, settings')
        .eq('org_id', request.user.org_id)
        .eq('integration_type', 'odoo')
        .single()

      if (!integration) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'Odoo integration not configured')
      }

      const apiKey = await getCredential(
        openCredentialStore(),
        'organization_integration',
        integration.id,
      )

      if (!apiKey) {
        return sendError(
          reply,
          400,
          ErrorCode.BAD_REQUEST,
          'The Odoo integration has no stored API key. Re-enter it in Settings and save.',
        )
      }

      const odooSuppliers = await fetchOdooSuppliers(
        integration.settings.url,
        integration.settings.database,
        integration.settings.username,
        apiKey,
      )

      if (!odooSuppliers.success) {
        await request
          .supabase!.from('organization_integrations')
          .update({
            is_connected: false,
            last_sync_at: new Date().toISOString(),
            last_sync_status: 'error',
            last_error: odooSuppliers.error,
          })
          .eq('id', integration.id)
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, odooSuppliers.error || 'Sync failed')
      }

      const suppliers = odooSuppliers.suppliers || []
      let created = 0,
        updated = 0,
        errors = 0

      for (const odooSupplier of suppliers) {
        try {
          const { data: existing } = await request
            .supabase!.from('suppliers')
            .select('id')
            .eq('org_id', request.user.org_id)
            .eq('erp_id', String(odooSupplier.id))
            .single()

          const supplierData = {
            org_id: request.user.org_id,
            name: odooSupplier.name,
            code: odooSupplier.ref || null,
            contact_email: odooSupplier.email || null,
            contact_phone: odooSupplier.phone || odooSupplier.mobile || null,
            website: odooSupplier.website || null,
            address_line1: odooSupplier.street || null,
            city: odooSupplier.city || null,
            postal_code: odooSupplier.zip || null,
            country:
              (odooSupplier.country_id && Array.isArray(odooSupplier.country_id)
                ? odooSupplier.country_id[1]
                : null) || 'USA',
            is_active: odooSupplier.active !== false,
            is_approved: true,
            erp_id: String(odooSupplier.id),
            erp_synced_at: new Date().toISOString(),
            updated_by: request.user.id,
          }

          if (existing) {
            await request.supabase!.from('suppliers').update(supplierData).eq('id', existing.id)
            updated++
          } else {
            await request
              .supabase!.from('suppliers')
              .insert({ ...supplierData, created_by: request.user.id })
            created++
          }
        } catch {
          errors++
        }
      }

      await request
        .supabase!.from('organization_integrations')
        .update({
          is_connected: true,
          last_connected_at: new Date().toISOString(),
          last_error: null,
          last_sync_at: new Date().toISOString(),
          last_sync_status: errors > 0 ? 'partial' : 'success',
          last_sync_count: created + updated,
        })
        .eq('id', integration.id)

      return {
        success: true,
        created,
        updated,
        errors,
        message: `Synced ${created + updated} suppliers from Odoo`,
        debug: odooSuppliers.debug,
      }
    }),
  )

  // Disconnect Odoo integration
  fastify.delete(
    '/integrations/odoo',
    {
      schema: {
        description: 'Disconnect Odoo integration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (!request.user || request.user.role !== 'admin') {
        return sendError(reply, 403, ErrorCode.FORBIDDEN, 'Only admins can disconnect integrations')
      }

      const { data: integration } = await request
        .supabase!.from('organization_integrations')
        .select('id')
        .eq('org_id', request.user.org_id)
        .eq('integration_type', 'odoo')
        .maybeSingle()

      if (integration) {
        await request
          .supabase!.from('organization_integrations')
          .update({
            is_active: false,
            is_connected: false,
            credentials_encrypted: null,
            updated_by: request.user.id,
          })
          .eq('id', integration.id)

        // Disconnecting is meant to revoke access, so the key goes with it.
        // Saved configs keep their own, which is what makes reconnecting work.
        await deleteCredential(openCredentialStore(), 'organization_integration', integration.id)
      }

      return { success: true, message: 'Odoo integration disconnected' }
    }),
  )

  // List saved Odoo configurations
  fastify.get(
    '/integrations/odoo/configs',
    {
      schema: {
        description: 'List all saved Odoo configurations',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    async (request) => {
      const { data } = await request
        .supabase!.from('odoo_saved_configs')
        .select(SAVED_CONFIG_COLUMNS)
        .eq('org_id', request.user!.org_id)
        .eq('is_active', true)
        .order('name')

      return { configs: data || [] }
    },
  )

  // Get a single saved configuration
  fastify.get(
    '/integrations/odoo/configs/:id',
    {
      schema: {
        description: 'Get a saved Odoo configuration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (request.user!.role !== 'admin') {
        return sendError(reply, 403, ErrorCode.FORBIDDEN, 'Only admins can access saved configurations')
      }

      const { id } = request.params as { id: string }
      const { data } = await request
        .supabase!.from('odoo_saved_configs')
        .select('id, name, url, database, username, color')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (!data) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'Configuration not found')

      return {
        id: data.id,
        name: data.name,
        url: data.url,
        database: data.database,
        username: data.username,
        // Not the key: an admin loading this config into the form needs to know
        // that one is on file, nothing more.
        has_api_key: await hasStoredCredential(openCredentialStore(), 'odoo_saved_config', data.id),
        color: data.color,
      }
    }),
  )

  // Save a new Odoo configuration
  fastify.post(
    '/integrations/odoo/configs',
    {
      schema: {
        description: 'Save a new Odoo configuration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'url', 'database', 'username', 'api_key'],
          properties: {
            name: { type: 'string' },
            url: { type: 'string' },
            database: { type: 'string' },
            username: { type: 'string' },
            api_key: { type: 'string' },
            color: { type: 'string' },
            skip_test: { type: 'boolean' },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (request.user!.role !== 'admin') {
        return sendError(reply, 403, ErrorCode.FORBIDDEN, 'Only admins can save configurations')
      }

      const { name, url, database, username, api_key, color, skip_test } = request.body as {
        name: string
        url: string
        database: string
        username: string
        api_key: string
        color?: string
        skip_test?: boolean
      }

      const apiKey = (api_key ?? '').trim()
      if (!apiKey) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'An Odoo API key is required')
      }

      requireEncryptionKey()

      const orgId = request.user!.org_id
      if (!orgId) return sendError(reply, 403, ErrorCode.FORBIDDEN, NO_ORGANIZATION)

      const userId = request.user!.id
      const normalizedUrl = normalizeOdooUrl(url)
      let testResult: { success: boolean; error?: string } = { success: false, error: '' }
      if (!skip_test) testResult = await testOdooConnection(normalizedUrl, database, username, apiKey)

      const { data, error } = await request
        .supabase!.from('odoo_saved_configs')
        .insert({
          org_id: orgId,
          name,
          url: normalizedUrl,
          database,
          username,
          color,
          last_tested_at: !skip_test ? new Date().toISOString() : null,
          last_test_success: !skip_test ? testResult.success : null,
          created_by: userId,
          updated_by: userId,
        })
        .select(SAVED_CONFIG_COLUMNS)
        .single()

      if (error) {
        if (error.code === '23505')
          return sendError(reply, 409, ErrorCode.CONFLICT, `Configuration "${name}" already exists`)
        throw error
      }

      await setCredential(
        openCredentialStore(),
        orgId,
        'odoo_saved_config',
        data.id,
        apiKey,
        userId,
      )

      return { success: true, config: data, connection_test: skip_test ? null : testResult }
    }),
  )

  // Update a saved configuration
  fastify.put(
    '/integrations/odoo/configs/:id',
    {
      schema: {
        description: 'Update a saved Odoo configuration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (request.user!.role !== 'admin') return sendError(reply, 403, ErrorCode.FORBIDDEN)

      const orgId = request.user!.org_id
      if (!orgId) return sendError(reply, 403, ErrorCode.FORBIDDEN, NO_ORGANIZATION)

      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      // Absent or blank means the admin did not retype the key, so the stored
      // one stays. Only an actual value replaces it.
      const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
      if (apiKey) requireEncryptionKey()

      const updateData: Record<string, unknown> = { updated_by: request.user!.id }
      if (body.name) updateData.name = body.name
      if (body.url) updateData.url = normalizeOdooUrl(body.url as string)
      if (body.database) updateData.database = body.database
      if (body.username) updateData.username = body.username
      if (body.color !== undefined) updateData.color = body.color

      const { data } = await request
        .supabase!.from('odoo_saved_configs')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', orgId)
        .select(SAVED_CONFIG_COLUMNS)
        .single()

      if (!data) return sendError(reply, 404, ErrorCode.NOT_FOUND)

      if (apiKey) {
        // data.id rather than the path param: the update is what proves the row
        // belongs to this org, and credential owner ids are not org-scoped.
        await setCredential(
          openCredentialStore(),
          orgId,
          'odoo_saved_config',
          data.id,
          apiKey,
          request.user!.id,
        )
      }

      return { success: true, config: data }
    }),
  )

  // Delete a saved configuration
  fastify.delete(
    '/integrations/odoo/configs/:id',
    {
      schema: {
        description: 'Delete a saved Odoo configuration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (request.user!.role !== 'admin') return sendError(reply, 403, ErrorCode.FORBIDDEN)

      const { id } = request.params as { id: string }
      const { data: deleted } = await request
        .supabase!.from('odoo_saved_configs')
        .delete()
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .select('id')

      // Only once the row is confirmed deleted from this org. Credential owner
      // ids carry no org, so acting on an unverified id would let an admin drop
      // another org's credential.
      if (deleted && deleted.length > 0) {
        await deleteCredential(openCredentialStore(), 'odoo_saved_config', id)
      }

      return { success: true, message: 'Configuration deleted' }
    }),
  )

  // Activate a saved configuration
  fastify.post(
    '/integrations/odoo/configs/:id/activate',
    {
      schema: {
        description: 'Activate a saved configuration',
        tags: ['Integrations'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    withCredentialErrors(async (request, reply) => {
      if (request.user!.role !== 'admin') return sendError(reply, 403, ErrorCode.FORBIDDEN)

      const orgId = request.user!.org_id
      if (!orgId) return sendError(reply, 403, ErrorCode.FORBIDDEN, NO_ORGANIZATION)

      const userId = request.user!.id
      const { id } = request.params as { id: string }
      const { data: config } = await request
        .supabase!.from('odoo_saved_configs')
        .select('id, name, url, database, username')
        .eq('id', id)
        .eq('org_id', orgId)
        .single()

      if (!config) return sendError(reply, 404, ErrorCode.NOT_FOUND)

      const credentials = openCredentialStore()
      const apiKey = await getCredential(credentials, 'odoo_saved_config', config.id)

      if (!apiKey) {
        return sendError(
          reply,
          400,
          ErrorCode.BAD_REQUEST,
          `"${config.name}" has no stored API key. Edit the connection and enter it again.`,
        )
      }

      // A legacy plaintext key reads back without the encryption key but cannot
      // be copied onto the integration without it.
      requireEncryptionKey()

      const testResult = await testOdooConnection(
        config.url,
        config.database,
        config.username,
        apiKey,
      )

      const { data: integration, error } = await request
        .supabase!.from('organization_integrations')
        .upsert(
          {
            org_id: orgId,
            integration_type: 'odoo',
            settings: {
              url: config.url,
              database: config.database,
              username: config.username,
              config_id: config.id,
              config_name: config.name,
            },
            // Deprecated column: see the note on the configure route.
            credentials_encrypted: null,
            is_active: true,
            is_connected: testResult.success,
            last_connected_at: testResult.success ? new Date().toISOString() : null,
            last_error: testResult.error,
            updated_by: userId,
          },
          { onConflict: 'org_id,integration_type' },
        )
        .select('id')
        .single()

      if (error) throw error
      if (!integration) throw new Error('Odoo integration row was not returned after activate')

      await setCredential(
        credentials,
        orgId,
        'organization_integration',
        integration.id,
        apiKey,
        userId,
      )

      await request
        .supabase!.from('odoo_saved_configs')
        .update({ last_tested_at: new Date().toISOString(), last_test_success: testResult.success })
        .eq('id', id)

      return {
        success: true,
        connected: testResult.success,
        config_name: config.name,
        message: testResult.success
          ? `Switched to "${config.name}" and connected!`
          : `Switched to "${config.name}" but connection failed`,
      }
    }),
  )
}

export default odooRoutes
