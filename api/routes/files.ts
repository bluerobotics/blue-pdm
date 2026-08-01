/**
 * File Routes
 *
 * Core file operations: list, get, checkout, checkin, sync, download, delete.
 */

import { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import { SIGNED_URL_EXPIRY } from '../src/config/env.js'
import { schemas } from '../schemas/index.js'
import {
  sendError,
  ErrorCode,
  computeHash,
  getFileTypeFromExtension,
  triggerWebhooks,
  changeFileStateViaWorkflow,
  stateChangeErrorResponse,
} from '../utils/index.js'
import type { LegacyFileState } from '../utils/index.js'
import type { FileRecord } from '../types.js'

const fileRoutes: FastifyPluginAsync = async (fastify) => {
  // List files with optional filters
  fastify.get(
    '/files',
    {
      schema: {
        description: 'List files with optional filters',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            vault_id: { type: 'string', format: 'uuid' },
            folder: { type: 'string' },
            state: {
              type: 'string',
              enum: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete'],
            },
            search: { type: 'string' },
            checked_out: { type: 'string', enum: ['me', 'any'] },
            limit: { type: 'integer', default: 1000 },
            offset: { type: 'integer', default: 0 },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request) => {
      const {
        vault_id,
        folder,
        state,
        search,
        checked_out,
        limit = 1000,
        offset = 0,
      } = request.query as Record<string, string | number | undefined>

      let query = request
        .supabase!.from('files')
        .select(
          `
        id, file_path, file_name, extension, file_type,
        part_number, description, revision, version,
        content_hash, file_size, state,
        checked_out_by, checked_out_at, updated_at, created_at
      `,
        )
        .eq('org_id', request.user!.org_id)
        .is('deleted_at', null)
        .order('file_path')
        .range(offset as number, (offset as number) + (limit as number) - 1)

      if (vault_id) query = query.eq('vault_id', vault_id)
      if (folder) query = query.ilike('file_path', `${folder}%`)
      if (state) query = query.eq('state', state)
      if (search) {
        const s = String(search).replace(/[,%._()]/g, '')
        if (s) query = query.or(`file_name.ilike.%${s}%,part_number.ilike.%${s}%`)
      }
      if (checked_out === 'me') query = query.eq('checked_out_by', request.user!.id)
      if (checked_out === 'any') query = query.not('checked_out_by', 'is', null)

      const { data, error } = await query
      if (error) throw error

      return { files: data, count: data?.length || 0 }
    },
  )

  // Get file by ID
  fastify.get(
    '/files/:id',
    {
      schema: {
        description: 'Get file by ID',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const { data, error } = await request
        .supabase!.from('files')
        .select(
          `
        *,
        checked_out_user:users!checked_out_by(email, full_name, avatar_url),
        created_by_user:users!created_by(email, full_name)
      `,
        )
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (error) throw error
      if (!data) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')

      return { file: data }
    },
  )

  // Check out a file for editing
  fastify.post(
    '/files/:id/checkout',
    {
      schema: {
        description: 'Check out a file for editing',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Optional lock message' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              file: schemas.file,
            },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const { message } = (request.body as { message?: string }) || {}

      // Use atomic RPC for checkout - handles locking and activity logging
      const { data, error } = await request.supabase!.rpc('checkout_file', {
        p_file_id: id,
        p_user_id: request.user!.id,
        p_machine_id: null,
        p_machine_name: 'API',
        p_lock_message: message || null,
      })

      if (error) throw error

      const result = data as { success: boolean; error?: string; file?: Record<string, unknown> }

      if (!result.success) {
        // Determine appropriate error code based on error message
        if (result.error?.includes('not found')) {
          return sendError(reply, 404, ErrorCode.NOT_FOUND, result.error)
        }
        return sendError(reply, 409, ErrorCode.CONFLICT, result.error || 'Checkout failed')
      }

      // RPC handles activity logging - DO NOT add manual logging here
      // BUT keep the webhook trigger - webhooks are API layer responsibility
      await triggerWebhooks(
        request.user!.org_id!,
        'file.checkout',
        {
          file_id: id,
          file_path: (result.file as { file_path?: string })?.file_path,
          file_name: (result.file as { file_name?: string })?.file_name,
          user_id: request.user!.id,
          user_email: request.user!.email,
        },
        fastify.log,
      )

      return { success: true, file: result.file }
    },
  )

  // Check in a file after editing
  fastify.post(
    '/files/:id/checkin',
    {
      schema: {
        description: 'Check in a file after editing',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            comment: { type: 'string' },
            content_hash: { type: 'string' },
            file_size: { type: 'integer' },
            content: { type: 'string', description: 'Base64 encoded file content' },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const { comment, content_hash, file_size, content } =
        (request.body as {
          comment?: string
          content_hash?: string
          file_size?: number
          content?: string
        }) || {}

      // Step 1: Handle content upload FIRST (before RPC)
      // Storage uploads must happen before the atomic RPC call
      let newHash = content_hash
      let newSize = file_size

      if (content) {
        const binaryContent = Buffer.from(content, 'base64')
        newHash = computeHash(binaryContent)
        newSize = binaryContent.length
        const dirPath = `${request.user!.org_id}/${newHash.substring(0, 2)}`
        const storagePath = `${dirPath}/${newHash}`

        const { error: uploadError } = await request
          .supabase!.storage.from('vault')
          .upload(storagePath, binaryContent, {
            contentType: 'application/octet-stream',
            upsert: false,
          })

        // Ignore "already exists" - content-addressable storage deduplicates
        if (uploadError && !uploadError.message.includes('already exists')) {
          throw uploadError
        }

        // Post-upload verification: confirm the object exists with expected size
        const { data: verified, error: verifyError } = await request
          .supabase!.storage.from('vault')
          .list(dirPath, { search: newHash, limit: 1 })

        if (!verifyError && verified && verified.length > 0) {
          const storedSize = (verified[0] as { metadata?: { size?: number } }).metadata?.size
          if (storedSize !== undefined && storedSize !== newSize) {
            throw new Error(
              `Upload corrupted: expected ${newSize} bytes, stored ${storedSize} bytes`,
            )
          }
        } else if (!verifyError && (!verified || verified.length === 0)) {
          throw new Error('Upload verification failed: object not found in storage after upload')
        }
      }

      // Step 2: Call atomic RPC for checkin - handles versioning + activity logging
      const { data, error } = await request.supabase!.rpc('checkin_file', {
        p_file_id: id,
        p_user_id: request.user!.id,
        p_new_content_hash: newHash || null,
        p_new_file_size: newSize || null,
        p_comment: comment || null,
        p_part_number: null,
        p_description: null,
        p_revision: null,
        p_local_active_version: null,
      })

      if (error) throw error

      const result = data as {
        success: boolean
        error?: string
        file?: Record<string, unknown>
        content_changed?: boolean
        version_incremented?: boolean
        new_version?: number
      }

      if (!result.success) {
        // Determine appropriate error code based on error message
        if (result.error?.includes('not found')) {
          return sendError(reply, 404, ErrorCode.NOT_FOUND, result.error)
        }
        if (result.error?.includes('not checked out')) {
          return sendError(reply, 403, ErrorCode.FORBIDDEN, result.error)
        }
        return sendError(reply, 409, ErrorCode.CONFLICT, result.error || 'Checkin failed')
      }

      // Step 3: Trigger webhooks (API layer responsibility)
      // RPC handles activity logging - DO NOT duplicate

      if (result.version_incremented) {
        await triggerWebhooks(
          request.user!.org_id!,
          'file.version',
          {
            file_id: id,
            file_path: (result.file as { file_path?: string })?.file_path,
            file_name: (result.file as { file_name?: string })?.file_name,
            version: result.new_version,
            user_id: request.user!.id,
            user_email: request.user!.email,
          },
          fastify.log,
        )
      }

      await triggerWebhooks(
        request.user!.org_id!,
        'file.checkin',
        {
          file_id: id,
          file_path: (result.file as { file_path?: string })?.file_path,
          file_name: (result.file as { file_name?: string })?.file_name,
          user_id: request.user!.id,
          user_email: request.user!.email,
          content_changed: result.content_changed,
        },
        fastify.log,
      )

      return { success: true, file: result.file, contentChanged: result.content_changed }
    },
  )

  // Undo checkout (discard changes)
  fastify.post(
    '/files/:id/undo-checkout',
    {
      schema: {
        description: 'Undo checkout (discard changes)',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const { data: file, error: fetchError } = await request
        .supabase!.from('files')
        .select('id, checked_out_by')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (fetchError) throw fetchError
      if (!file) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')

      if (file.checked_out_by !== request.user!.id && request.user!.role !== 'admin') {
        return sendError(reply, 403, ErrorCode.FORBIDDEN, 'File is not checked out to you')
      }

      const { data, error } = await request
        .supabase!.from('files')
        .update({
          checked_out_by: null,
          checked_out_at: null,
          lock_message: null,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return { success: true, file: data }
    },
  )

  // Upload a new file or update existing
  fastify.post(
    '/files/sync',
    {
      schema: {
        description: 'Upload a new file or update existing',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['vault_id', 'file_path', 'file_name', 'content'],
          properties: {
            vault_id: { type: 'string', format: 'uuid' },
            file_path: { type: 'string' },
            file_name: { type: 'string' },
            extension: { type: 'string' },
            content: { type: 'string', description: 'Base64 encoded file content' },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { vault_id, file_path, file_name, extension, content } = request.body as {
        vault_id: string
        file_path: string
        file_name: string
        extension?: string
        content: string
      }

      // Verify vault
      const { data: vault, error: vaultError } = await request
        .supabase!.from('vaults')
        .select('id')
        .eq('id', vault_id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (vaultError || !vault) {
        return sendError(reply, 404, ErrorCode.NOT_FOUND, 'Vault not found')
      }

      const binaryContent = Buffer.from(content, 'base64')
      const contentHash = computeHash(binaryContent)
      const fileSize = binaryContent.length
      const fileType = getFileTypeFromExtension(extension || '')

      // Upload to storage
      const dirPath = `${request.user!.org_id}/${contentHash.substring(0, 2)}`
      const storagePath = `${dirPath}/${contentHash}`
      const { error: storageUploadError } = await request
        .supabase!.storage.from('vault')
        .upload(storagePath, binaryContent, {
          contentType: 'application/octet-stream',
          upsert: false,
        })

      if (storageUploadError && !storageUploadError.message.includes('already exists')) {
        throw storageUploadError
      }

      // Post-upload verification: confirm the object exists with expected size
      const { data: verified, error: verifyError } = await request
        .supabase!.storage.from('vault')
        .list(dirPath, { search: contentHash, limit: 1 })

      if (!verifyError && verified && verified.length > 0) {
        const storedSize = (verified[0] as { metadata?: { size?: number } }).metadata?.size
        if (storedSize !== undefined && storedSize !== fileSize) {
          throw new Error(
            `Upload corrupted: expected ${fileSize} bytes, stored ${storedSize} bytes`,
          )
        }
      } else if (!verifyError && (!verified || verified.length === 0)) {
        throw new Error('Upload verification failed: object not found in storage after upload')
      }

      // Check existing (case-insensitive: Windows paths are case-insensitive)
      const escapedPath = file_path.replace(/%/g, '\\%').replace(/_/g, '\\_')
      const { data: existing } = await request
        .supabase!.from('files')
        .select('id, version')
        .eq('vault_id', vault_id)
        .ilike('file_path', escapedPath)
        .is('deleted_at', null)
        .single()

      let result: { file: unknown; isNew: boolean }

      if (existing) {
        const { data, error } = await request
          .supabase!.from('files')
          .update({
            content_hash: contentHash,
            file_size: fileSize,
            version: existing.version + 1,
            updated_at: new Date().toISOString(),
            updated_by: request.user!.id,
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        result = { file: data, isNew: false }
      } else {
        const { data, error } = await request
          .supabase!.from('files')
          .insert({
            org_id: request.user!.org_id,
            vault_id,
            file_path,
            file_name,
            extension: extension || '',
            file_type: fileType,
            content_hash: contentHash,
            file_size: fileSize,
            state: 'not_tracked',
            revision: '',
            version: 1,
            created_by: request.user!.id,
            updated_by: request.user!.id,
          })
          .select()
          .single()

        if (error) throw error

        await request.supabase!.from('file_versions').insert({
          file_id: data.id,
          version: 1,
          revision: '',
          content_hash: contentHash,
          file_size: fileSize,
          state: 'not_tracked',
          created_by: request.user!.id,
        })

        result = { file: data, isNew: true }
      }

      // Trigger webhook
      await triggerWebhooks(
        request.user!.org_id!,
        'file.sync',
        {
          file_id: (result.file as { id: string }).id,
          file_path,
          file_name,
          is_new: result.isNew,
          user_id: request.user!.id,
          user_email: request.user!.email,
        },
        fastify.log,
      )

      return { success: true, ...result }
    },
  )

  // Get a signed download URL for a file
  fastify.get(
    '/files/:id/download',
    {
      schema: {
        description: 'Get a signed download URL for a file (URL expires in 1 hour)',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        querystring: {
          type: 'object',
          properties: {
            version: { type: 'integer', description: 'Specific version to download' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              file_id: { type: 'string' },
              file_name: { type: 'string' },
              file_size: { type: 'integer' },
              content_hash: { type: 'string' },
              download_url: { type: 'string', description: 'Signed URL for direct download' },
              expires_in: { type: 'integer', description: 'Seconds until URL expires' },
            },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const { version } = request.query as { version?: number }

      const { data: file, error: fetchError } = await request
        .supabase!.from('files')
        .select('*')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (fetchError) throw fetchError
      if (!file) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')

      let contentHash = file.content_hash
      let fileSize = file.file_size

      if (version && version !== file.version) {
        const { data: versionData } = await request
          .supabase!.from('file_versions')
          .select('content_hash, file_size')
          .eq('file_id', id)
          .eq('version', version)
          .single()

        if (!versionData) {
          return sendError(reply, 404, ErrorCode.NOT_FOUND, 'Version not found')
        }
        contentHash = versionData.content_hash
        fileSize = versionData.file_size
      }

      const storagePath = `${request.user!.org_id}/${contentHash.substring(0, 2)}/${contentHash}`

      // Create signed URL for direct download from Supabase Storage
      const { data, error } = await request
        .supabase!.storage.from('vault')
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY, {
          download: file.file_name,
        })

      if (error) throw error

      return {
        file_id: id,
        file_name: file.file_name,
        file_size: fileSize,
        content_hash: contentHash,
        download_url: data.signedUrl,
        expires_in: SIGNED_URL_EXPIRY,
      }
    },
  )

  // Get file version history
  fastify.get(
    '/files/:id/versions',
    {
      schema: {
        description: 'Get file version history',
        tags: ['Versions'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request) => {
      const { id } = request.params as { id: string }

      const { data, error } = await request
        .supabase!.from('file_versions')
        .select(
          `
        *,
        created_by_user:users!created_by(email, full_name)
      `,
        )
        .eq('file_id', id)
        .order('version', { ascending: false })

      if (error) throw error
      return { versions: data }
    },
  )

  // Soft delete a file
  fastify.delete(
    '/files/:id',
    {
      schema: {
        description: 'Soft delete a file',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const { data: file, error: fetchError } = await request
        .supabase!.from('files')
        .select('id, file_path, file_name, checked_out_by')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (fetchError) throw fetchError
      if (!file) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')

      if (file.checked_out_by && file.checked_out_by !== request.user!.id) {
        return sendError(reply, 409, ErrorCode.CONFLICT, 'Cannot delete file checked out by another user')
      }

      const { error } = await request
        .supabase!.from('files')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: request.user!.id,
        })
        .eq('id', id)

      if (error) throw error

      // Trigger webhook
      await triggerWebhooks(
        request.user!.org_id!,
        'file.delete',
        {
          file_id: id,
          file_path: file.file_path,
          file_name: file.file_name,
          user_id: request.user!.id,
          user_email: request.user!.email,
        },
        fastify.log,
      )

      return { success: true }
    },
  )

  // Update file metadata (state)
  fastify.patch(
    '/files/:id/metadata',
    {
      schema: {
        description: 'Update file metadata (state)',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              enum: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete'],
            },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const { state } = request.body as { state?: FileRecord['state'] }

      // Get current file for webhook
      const { data: currentFile } = await request
        .supabase!.from('files')
        .select('file_path, file_name, state')
        .eq('id', id)
        .single()

      if (state && currentFile?.state !== state) {
        const change = await changeFileStateViaWorkflow(
          request.supabase!,
          id,
          state as LegacyFileState,
        )

        if (change.outcome === 'rejected') {
          const { status, code } = stateChangeErrorResponse(change.code)
          return sendError(reply, status, code, change.message)
        }

        if (change.outcome === 'review_required') {
          return reply.code(202).send({ success: true, requires_review: true })
        }

        if (change.outcome === 'advanced') {
          const { data: advanced } = await request
            .supabase!.from('files')
            .select()
            .eq('id', id)
            .single()

          await triggerWebhooks(
            request.user!.org_id!,
            'file.state_change',
            {
              file_id: id,
              file_path: currentFile?.file_path,
              file_name: currentFile?.file_name,
              old_state: currentFile?.state,
              new_state: state,
              user_id: request.user!.id,
              user_email: request.user!.email,
            },
            fastify.log,
          )

          return { success: true, file: advanced }
        }
      }

      // No workflow assignment (or nothing to change): write the column directly.
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: request.user!.id,
      }

      if (state) {
        updateData.state = state
        updateData.state_changed_at = new Date().toISOString()
        updateData.state_changed_by = request.user!.id
      }

      const { data, error } = await request
        .supabase!.from('files')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .select()
        .single()

      if (error) throw error

      // Trigger webhook if state changed
      if (state && currentFile?.state !== state) {
        await triggerWebhooks(
          request.user!.org_id!,
          'file.state_change',
          {
            file_id: id,
            file_path: currentFile?.file_path,
            file_name: currentFile?.file_name,
            old_state: currentFile?.state,
            new_state: state,
            user_id: request.user!.id,
            user_email: request.user!.email,
          },
          fastify.log,
        )
      }

      return { success: true, file: data }
    },
  )

  // Quick release: Change file state to "released"
  fastify.post(
    '/files/:id/release',
    {
      schema: {
        description: 'Quick release: Change file state to "released"',
        tags: ['ERP'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              file: schemas.file,
              previous_state: { type: 'string' },
            },
          },
          // Blocking approval gates opened reviews; the file has not moved yet.
          202: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              requires_review: { type: 'boolean' },
            },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const { data: currentFile } = await request
        .supabase!.from('files')
        .select('file_path, file_name, state, checked_out_by')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (!currentFile) {
        return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')
      }

      if (currentFile.checked_out_by) {
        return sendError(reply, 409, ErrorCode.CONFLICT, 'Cannot release a checked out file')
      }

      if (currentFile.state === 'released') {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'File is already in released state')
      }

      const change = await changeFileStateViaWorkflow(request.supabase!, id, 'released')

      if (change.outcome === 'rejected') {
        const { status, code } = stateChangeErrorResponse(change.code)
        return sendError(reply, status, code, change.message)
      }

      if (change.outcome === 'review_required') {
        return reply.code(202).send({ success: true, requires_review: true })
      }

      if (change.outcome === 'advanced') {
        const { data: advanced } = await request
          .supabase!.from('files')
          .select()
          .eq('id', id)
          .single()

        await triggerWebhooks(
          request.user!.org_id!,
          'file.state_change',
          {
            file_id: id,
            file_path: currentFile.file_path,
            file_name: currentFile.file_name,
            old_state: currentFile.state,
            new_state: 'released',
            user_id: request.user!.id,
            user_email: request.user!.email,
          },
          fastify.log,
        )

        return { success: true, file: advanced, previous_state: currentFile.state }
      }

      // Not on a workflow: keep the legacy column write so ERP callers still work.
      const { data, error } = await request
        .supabase!.from('files')
        .update({
          state: 'released',
          state_changed_at: new Date().toISOString(),
          state_changed_by: request.user!.id,
          updated_at: new Date().toISOString(),
          updated_by: request.user!.id,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      // Trigger webhook
      await triggerWebhooks(
        request.user!.org_id!,
        'file.state_change',
        {
          file_id: id,
          file_path: currentFile.file_path,
          file_name: currentFile.file_name,
          old_state: currentFile.state,
          new_state: 'released',
          user_id: request.user!.id,
          user_email: request.user!.email,
        },
        fastify.log,
      )

      return { success: true, file: data, previous_state: currentFile.state }
    },
  )

  // Quick obsolete: Change file state to "obsolete"
  fastify.post(
    '/files/:id/obsolete',
    {
      schema: {
        description: 'Quick obsolete: Change file state to "obsolete"',
        tags: ['ERP'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const { data: currentFile } = await request
        .supabase!.from('files')
        .select('file_path, file_name, state, checked_out_by')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (!currentFile) {
        return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')
      }

      if (currentFile.checked_out_by) {
        return sendError(reply, 409, ErrorCode.CONFLICT, 'Cannot obsolete a checked out file')
      }

      const change = await changeFileStateViaWorkflow(request.supabase!, id, 'obsolete')

      if (change.outcome === 'rejected') {
        const { status, code } = stateChangeErrorResponse(change.code)
        return sendError(reply, status, code, change.message)
      }

      if (change.outcome === 'review_required') {
        return reply.code(202).send({ success: true, requires_review: true })
      }

      if (change.outcome === 'advanced') {
        const { data: advanced } = await request
          .supabase!.from('files')
          .select()
          .eq('id', id)
          .single()

        await triggerWebhooks(
          request.user!.org_id!,
          'file.state_change',
          {
            file_id: id,
            file_path: currentFile.file_path,
            file_name: currentFile.file_name,
            old_state: currentFile.state,
            new_state: 'obsolete',
            user_id: request.user!.id,
            user_email: request.user!.email,
          },
          fastify.log,
        )

        return { success: true, file: advanced, previous_state: currentFile.state }
      }

      // Not on a workflow: keep the legacy column write so ERP callers still work.
      const { data, error } = await request
        .supabase!.from('files')
        .update({
          state: 'obsolete',
          state_changed_at: new Date().toISOString(),
          state_changed_by: request.user!.id,
          updated_at: new Date().toISOString(),
          updated_by: request.user!.id,
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      await triggerWebhooks(
        request.user!.org_id!,
        'file.state_change',
        {
          file_id: id,
          file_path: currentFile.file_path,
          file_name: currentFile.file_name,
          old_state: currentFile.state,
          new_state: 'obsolete',
          user_id: request.user!.id,
          user_email: request.user!.email,
        },
        fastify.log,
      )

      return { success: true, file: data, previous_state: currentFile.state }
    },
  )

  // Get the associated drawing for a part or assembly
  fastify.get(
    '/files/:id/drawing',
    {
      schema: {
        description: 'Get the associated drawing for a part or assembly',
        tags: ['ERP'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              has_drawing: { type: 'boolean' },
              drawing: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'string' },
                  file_name: { type: 'string' },
                  file_path: { type: 'string' },
                  revision: { type: 'string' },
                  version: { type: 'integer' },
                  state: { type: 'string' },
                  download_url: { type: 'string' },
                  expires_in: { type: 'integer' },
                },
              },
            },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      // Get the source file
      const { data: sourceFile, error: sourceError } = await request
        .supabase!.from('files')
        .select('file_name, file_path, vault_id')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (sourceError) throw sourceError
      if (!sourceFile) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')

      // Look for drawing with similar name
      const baseName = sourceFile.file_name.replace(/\.[^/.]+$/, '')

      const { data: drawings } = await request
        .supabase!.from('files')
        .select('id, file_name, file_path, revision, version, state, content_hash')
        .eq('vault_id', sourceFile.vault_id)
        .eq('org_id', request.user!.org_id)
        .eq('file_type', 'drawing')
        .is('deleted_at', null)
        .ilike('file_name', `${baseName}%`)
        .limit(1)

      if (!drawings || drawings.length === 0) {
        return { has_drawing: false, drawing: null }
      }

      const drawing = drawings[0]

      // Generate signed URL for the drawing
      const storagePath = `${request.user!.org_id}/${drawing.content_hash.substring(0, 2)}/${drawing.content_hash}`
      const { data: urlData } = await request
        .supabase!.storage.from('vault')
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY, {
          download: drawing.file_name,
        })

      return {
        has_drawing: true,
        drawing: {
          id: drawing.id,
          file_name: drawing.file_name,
          file_path: drawing.file_path,
          revision: drawing.revision,
          version: drawing.version,
          state: drawing.state,
          download_url: urlData?.signedUrl || null,
          expires_in: SIGNED_URL_EXPIRY,
        },
      }
    },
  )

  // Get a signed upload URL
  fastify.get(
    '/files/:id/upload-url',
    {
      schema: {
        description: 'Get a signed upload URL for updating file content (direct to Supabase)',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              upload_url: { type: 'string' },
              storage_path: { type: 'string' },
              expires_in: { type: 'integer' },
              instructions: { type: 'string' },
            },
          },
        },
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      // Verify file exists and is checked out to user
      const { data: file, error } = await request
        .supabase!.from('files')
        .select('id, checked_out_by')
        .eq('id', id)
        .eq('org_id', request.user!.org_id)
        .single()

      if (error) throw error
      if (!file) return sendError(reply, 404, ErrorCode.NOT_FOUND, 'File not found')

      if (file.checked_out_by !== request.user!.id) {
        return sendError(
          reply,
          403,
          'Forbidden',
          'File must be checked out to you before uploading',
        )
      }

      // Generate a unique path for the upload
      const uploadId = crypto.randomUUID()
      const storagePath = `${request.user!.org_id}/uploads/${uploadId}`

      // Create signed upload URL
      const { data, error: urlError } = await request
        .supabase!.storage.from('vault')
        .createSignedUploadUrl(storagePath)

      if (urlError) throw urlError

      return {
        upload_url: data.signedUrl,
        storage_path: storagePath,
        expires_in: SIGNED_URL_EXPIRY,
        instructions:
          'PUT your file content to upload_url, then call POST /files/:id/checkin with the storage_path',
      }
    },
  )
}

export default fileRoutes
