#!/usr/bin/env node
/**
 * BluePDM REST API Server (Fastify)
 * 
 * High-performance REST API for PDM operations.
 * Built with Fastify for speed and built-in validation.
 * 
 * Features:
 * - JWT authentication via Supabase
 * - JSON Schema validation on all endpoints
 * - Structured logging with Pino
 * - File upload/download support
 * - Batch operations
 * 
 * Environment Variables:
 *   SUPABASE_URL      - Supabase project URL
 *   SUPABASE_KEY      - Supabase anon key  
 *   API_PORT          - Port to listen on (default: 3001)
 *   API_HOST          - Host to bind to (default: 127.0.0.1)
 * 
 * Usage:
 *   node api/server.js
 *   npm run api
 */

const Fastify = require('fastify')
const cors = require('@fastify/cors')
const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

// Configuration
const PORT = parseInt(process.env.API_PORT || '3001', 10)
const HOST = process.env.API_HOST || '127.0.0.1'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY

// Initialize Fastify with logging
const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        colorize: true
      }
    }
  },
  bodyLimit: 104857600 // 100MB
})

// ============================================
// Schemas (JSON Schema for validation)
// ============================================

const schemas = {
  // Common schemas
  uuid: { type: 'string', format: 'uuid' },
  
  error: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' }
    }
  },
  
  file: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      file_path: { type: 'string' },
      file_name: { type: 'string' },
      extension: { type: 'string' },
      file_type: { type: 'string' },
      part_number: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      revision: { type: 'string' },
      version: { type: 'integer' },
      content_hash: { type: 'string' },
      file_size: { type: 'integer' },
      state: { type: 'string' },
      checked_out_by: { type: ['string', 'null'] },
      checked_out_at: { type: ['string', 'null'] }
    }
  },
  
  vault: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      org_id: { type: 'string' }
    }
  },
  
  user: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      email: { type: 'string' },
      full_name: { type: ['string', 'null'] },
      role: { type: 'string' },
      org_id: { type: ['string', 'null'] }
    }
  }
}

// ============================================
// Supabase Client Factory
// ============================================

function createSupabaseClient(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY environment variables.')
  }
  
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
  
  if (accessToken) {
    options.global = {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  }
  
  return createClient(SUPABASE_URL, SUPABASE_KEY, options)
}

// ============================================
// Authentication Plugin
// ============================================

async function authPlugin(fastify) {
  fastify.decorateRequest('user', null)
  fastify.decorateRequest('supabase', null)
  fastify.decorateRequest('accessToken', null)
  
  fastify.decorate('authenticate', async function(request, reply) {
    const authHeader = request.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ 
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header'
      })
    }
    
    const token = authHeader.substring(7)
    
    try {
      const supabase = createSupabaseClient(token)
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
      if (error || !user) {
        return reply.code(401).send({ 
          error: 'Invalid token',
          message: error?.message || 'Token verification failed'
        })
      }
      
      // Get user profile
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, email, role, org_id, full_name')
        .eq('id', user.id)
        .single()
      
      if (profileError || !profile) {
        return reply.code(401).send({ 
          error: 'Profile not found',
          message: 'User profile does not exist'
        })
      }
      
      if (!profile.org_id) {
        return reply.code(403).send({ 
          error: 'No organization',
          message: 'User is not a member of any organization'
        })
      }
      
      request.user = profile
      request.supabase = supabase
      request.accessToken = token
    } catch (err) {
      request.log.error(err, 'Authentication error')
      return reply.code(500).send({ 
        error: 'Auth error',
        message: err.message
      })
    }
  })
}

// ============================================
// Utility Functions
// ============================================

function getFileTypeFromExtension(ext) {
  const lowerExt = (ext || '').toLowerCase()
  if (['.sldprt', '.prt', '.ipt', '.par'].includes(lowerExt)) return 'part'
  if (['.sldasm', '.asm', '.iam'].includes(lowerExt)) return 'assembly'
  if (['.slddrw', '.drw', '.idw', '.dwg'].includes(lowerExt)) return 'drawing'
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'].includes(lowerExt)) return 'document'
  return 'other'
}

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

// ============================================
// Register Plugins
// ============================================

async function buildServer() {
  // CORS
  await fastify.register(cors, { origin: true })
  
  // Auth plugin
  await fastify.register(authPlugin)
  
  // ============================================
  // Health & Info Routes
  // ============================================
  
  fastify.get('/', {
    schema: {
      description: 'API info and available endpoints',
      response: {
        200: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            status: { type: 'string' },
            endpoints: { type: 'object' }
          }
        }
      }
    }
  }, async () => {
    return {
      name: 'BluePDM REST API',
      version: '2.0.0',
      status: 'running',
      framework: 'fastify',
      endpoints: {
        auth: 'POST /auth/login',
        files: 'GET /files',
        checkout: 'POST /files/:id/checkout',
        checkin: 'POST /files/:id/checkin',
        sync: 'POST /files/sync',
        download: 'GET /files/:id/download',
        versions: 'GET /files/:id/versions',
        activity: 'GET /activity',
        vaults: 'GET /vaults',
        trash: 'GET /trash'
      }
    }
  })
  
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            supabase: { type: 'string' }
          }
        }
      }
    }
  }, async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      supabase: SUPABASE_URL ? 'configured' : 'not configured'
    }
  })
  
  // ============================================
  // Auth Routes
  // ============================================
  
  fastify.get('/auth/me', {
    schema: {
      description: 'Get current user info',
      response: {
        200: {
          type: 'object',
          properties: {
            user: schemas.user,
            org_id: { type: 'string' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    return { user: request.user, org_id: request.user.org_id }
  })
  
  fastify.post('/auth/login', {
    schema: {
      description: 'Login with email and password',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            access_token: { type: 'string' },
            refresh_token: { type: 'string' },
            expires_at: { type: 'integer' },
            user: schemas.user
          }
        }
      }
    }
  }, async (request, reply) => {
    const { email, password } = request.body
    const supabase = createSupabaseClient()
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    
    if (error) {
      return reply.code(401).send({ error: 'Login failed', message: error.message })
    }
    
    const { data: profile } = await supabase
      .from('users')
      .select('id, email, role, org_id, full_name')
      .eq('id', data.user.id)
      .single()
    
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: profile
    }
  })
  
  fastify.post('/auth/refresh', {
    schema: {
      description: 'Refresh access token',
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: {
          refresh_token: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { refresh_token } = request.body
    const supabase = createSupabaseClient()
    
    const { data, error } = await supabase.auth.refreshSession({ refresh_token })
    
    if (error) {
      return reply.code(401).send({ error: 'Refresh failed', message: error.message })
    }
    
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    }
  })
  
  // ============================================
  // Vault Routes
  // ============================================
  
  fastify.get('/vaults', {
    schema: {
      description: 'List organization vaults',
      response: {
        200: {
          type: 'object',
          properties: {
            vaults: { type: 'array', items: schemas.vault }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { data, error } = await request.supabase
      .from('vaults')
      .select('*')
      .eq('org_id', request.user.org_id)
      .order('name')
    
    if (error) throw error
    return { vaults: data }
  })
  
  fastify.get('/vaults/:id', {
    schema: {
      description: 'Get vault by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { data, error } = await request.supabase
      .from('vaults')
      .select('*')
      .eq('id', request.params.id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'Vault not found' })
    
    return { vault: data }
  })
  
  fastify.get('/vaults/:id/status', {
    schema: {
      description: 'Get vault status summary',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { data: files, error } = await request.supabase
      .from('files')
      .select('state, checked_out_by')
      .eq('vault_id', request.params.id)
      .eq('org_id', request.user.org_id)
      .is('deleted_at', null)
    
    if (error) throw error
    
    const status = {
      total: files?.length || 0,
      checked_out: files?.filter(f => f.checked_out_by).length || 0,
      checked_out_by_me: files?.filter(f => f.checked_out_by === request.user.id).length || 0,
      by_state: {}
    }
    
    for (const file of files || []) {
      const state = file.state || 'not_tracked'
      status.by_state[state] = (status.by_state[state] || 0) + 1
    }
    
    return { status }
  })
  
  // ============================================
  // File Listing Routes
  // ============================================
  
  fastify.get('/files', {
    schema: {
      description: 'List files with optional filters',
      querystring: {
        type: 'object',
        properties: {
          vault_id: { type: 'string' },
          folder: { type: 'string' },
          state: { type: 'string' },
          search: { type: 'string' },
          checked_out: { type: 'string', enum: ['me', 'any'] },
          limit: { type: 'integer', default: 1000 },
          offset: { type: 'integer', default: 0 }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { vault_id, folder, state, search, checked_out, limit, offset } = request.query
    
    let query = request.supabase
      .from('files')
      .select(`
        id, file_path, file_name, extension, file_type,
        part_number, description, revision, version,
        content_hash, file_size, state,
        checked_out_by, checked_out_at, updated_at, created_at
      `)
      .eq('org_id', request.user.org_id)
      .is('deleted_at', null)
      .order('file_path')
      .range(offset, offset + limit - 1)
    
    if (vault_id) query = query.eq('vault_id', vault_id)
    if (folder) query = query.ilike('file_path', `${folder}%`)
    if (state) query = query.eq('state', state)
    if (search) query = query.or(`file_name.ilike.%${search}%,part_number.ilike.%${search}%`)
    if (checked_out === 'me') query = query.eq('checked_out_by', request.user.id)
    if (checked_out === 'any') query = query.not('checked_out_by', 'is', null)
    
    const { data, error } = await query
    if (error) throw error
    
    return { files: data, count: data?.length || 0 }
  })
  
  fastify.get('/files/:id', {
    schema: {
      description: 'Get file by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { data, error } = await request.supabase
      .from('files')
      .select(`
        *,
        checked_out_user:users!checked_out_by(email, full_name, avatar_url),
        created_by_user:users!created_by(email, full_name)
      `)
      .eq('id', request.params.id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    return { file: data }
  })
  
  fastify.get('/files/by-path/:vault_id/*', {
    schema: {
      description: 'Get file by path within a vault',
      params: {
        type: 'object',
        properties: { vault_id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const filePath = request.params['*']
    
    const { data, error } = await request.supabase
      .from('files')
      .select('*')
      .eq('vault_id', request.params.vault_id)
      .eq('file_path', filePath)
      .eq('org_id', request.user.org_id)
      .is('deleted_at', null)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    return { file: data }
  })
  
  // ============================================
  // Checkout / Checkin Routes
  // ============================================
  
  fastify.post('/files/:id/checkout', {
    schema: {
      description: 'Check out a file for editing',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      },
      body: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            file: schemas.file
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params
    const { message } = request.body || {}
    
    // Get current file state
    const { data: file, error: fetchError } = await request.supabase
      .from('files')
      .select('id, file_name, checked_out_by, org_id')
      .eq('id', id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by && file.checked_out_by !== request.user.id) {
      return reply.code(409).send({ 
        error: 'Already checked out',
        message: 'File is checked out by another user',
        checked_out_by: file.checked_out_by
      })
    }
    
    const { data, error } = await request.supabase
      .from('files')
      .update({
        checked_out_by: request.user.id,
        checked_out_at: new Date().toISOString(),
        lock_message: message || null
      })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    // Log activity
    await request.supabase.from('activity').insert({
      org_id: request.user.org_id,
      file_id: id,
      user_id: request.user.id,
      action: 'checkout',
      details: message ? { message } : {}
    })
    
    return { success: true, file: data }
  })
  
  fastify.post('/files/:id/checkin', {
    schema: {
      description: 'Check in a file after editing',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      },
      body: {
        type: 'object',
        properties: {
          comment: { type: 'string' },
          content_hash: { type: 'string' },
          file_size: { type: 'integer' },
          content: { type: 'string' } // base64 encoded
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params
    const { comment, content_hash, file_size, content } = request.body || {}
    
    // Get current file state
    const { data: file, error: fetchError } = await request.supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by !== request.user.id) {
      return reply.code(403).send({ 
        error: 'Forbidden',
        message: 'File is not checked out to you'
      })
    }
    
    const updateData = {
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      updated_at: new Date().toISOString(),
      updated_by: request.user.id
    }
    
    // Upload new content if provided
    if (content) {
      const binaryContent = Buffer.from(content, 'base64')
      const newHash = computeHash(binaryContent)
      const storagePath = `${request.user.org_id}/${newHash.substring(0, 2)}/${newHash}`
      
      const { error: uploadError } = await request.supabase.storage
        .from('vault')
        .upload(storagePath, binaryContent, {
          contentType: 'application/octet-stream',
          upsert: false
        })
      
      if (uploadError && !uploadError.message.includes('already exists')) {
        throw uploadError
      }
      
      updateData.content_hash = newHash
      updateData.file_size = binaryContent.length
    } else if (content_hash) {
      updateData.content_hash = content_hash
      if (file_size) updateData.file_size = file_size
    }
    
    const contentChanged = updateData.content_hash && updateData.content_hash !== file.content_hash
    
    if (contentChanged) {
      updateData.version = file.version + 1
      
      await request.supabase.from('file_versions').insert({
        file_id: id,
        version: file.version + 1,
        revision: file.revision,
        content_hash: updateData.content_hash,
        file_size: updateData.file_size || file.file_size,
        state: file.state,
        created_by: request.user.id,
        comment: comment || null
      })
    }
    
    const { data, error } = await request.supabase
      .from('files')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    await request.supabase.from('activity').insert({
      org_id: request.user.org_id,
      file_id: id,
      user_id: request.user.id,
      action: 'checkin',
      details: { comment, contentChanged }
    })
    
    return { success: true, file: data, contentChanged }
  })
  
  fastify.post('/files/:id/undo-checkout', {
    schema: {
      description: 'Undo checkout (discard changes)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params
    
    const { data: file, error: fetchError } = await request.supabase
      .from('files')
      .select('id, checked_out_by')
      .eq('id', id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by !== request.user.id && request.user.role !== 'admin') {
      return reply.code(403).send({ 
        error: 'Forbidden',
        message: 'File is not checked out to you'
      })
    }
    
    const { data, error } = await request.supabase
      .from('files')
      .update({
        checked_out_by: null,
        checked_out_at: null,
        lock_message: null
      })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return { success: true, file: data }
  })
  
  // ============================================
  // Sync (Upload) Routes
  // ============================================
  
  fastify.post('/files/sync', {
    schema: {
      description: 'Upload a new file or update existing',
      body: {
        type: 'object',
        required: ['vault_id', 'file_path', 'file_name', 'content'],
        properties: {
          vault_id: { type: 'string' },
          file_path: { type: 'string' },
          file_name: { type: 'string' },
          extension: { type: 'string' },
          content: { type: 'string' } // base64
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { vault_id, file_path, file_name, extension, content } = request.body
    
    // Verify vault
    const { data: vault, error: vaultError } = await request.supabase
      .from('vaults')
      .select('id')
      .eq('id', vault_id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (vaultError || !vault) {
      return reply.code(404).send({ error: 'Not found', message: 'Vault not found' })
    }
    
    const binaryContent = Buffer.from(content, 'base64')
    const contentHash = computeHash(binaryContent)
    const fileSize = binaryContent.length
    const fileType = getFileTypeFromExtension(extension)
    
    // Upload to storage
    const storagePath = `${request.user.org_id}/${contentHash.substring(0, 2)}/${contentHash}`
    
    await request.supabase.storage
      .from('vault')
      .upload(storagePath, binaryContent, {
        contentType: 'application/octet-stream',
        upsert: false
      }).catch(() => {}) // Ignore if exists
    
    // Check existing
    const { data: existing } = await request.supabase
      .from('files')
      .select('id, version')
      .eq('vault_id', vault_id)
      .eq('file_path', file_path)
      .is('deleted_at', null)
      .single()
    
    let result
    if (existing) {
      const { data, error } = await request.supabase
        .from('files')
        .update({
          content_hash: contentHash,
          file_size: fileSize,
          version: existing.version + 1,
          updated_at: new Date().toISOString(),
          updated_by: request.user.id
        })
        .eq('id', existing.id)
        .select()
        .single()
      
      if (error) throw error
      result = { file: data, isNew: false }
    } else {
      const { data, error } = await request.supabase
        .from('files')
        .insert({
          org_id: request.user.org_id,
          vault_id,
          file_path,
          file_name,
          extension: extension || '',
          file_type: fileType,
          content_hash: contentHash,
          file_size: fileSize,
          state: 'not_tracked',
          revision: 'A',
          version: 1,
          created_by: request.user.id,
          updated_by: request.user.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      await request.supabase.from('file_versions').insert({
        file_id: data.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'not_tracked',
        created_by: request.user.id
      })
      
      result = { file: data, isNew: true }
    }
    
    return { success: true, ...result }
  })
  
  fastify.post('/files/sync-batch', {
    schema: {
      description: 'Batch upload multiple files',
      body: {
        type: 'object',
        required: ['vault_id', 'files'],
        properties: {
          vault_id: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              required: ['file_path', 'file_name', 'content'],
              properties: {
                file_path: { type: 'string' },
                file_name: { type: 'string' },
                extension: { type: 'string' },
                content: { type: 'string' }
              }
            }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { vault_id, files } = request.body
    const results = []
    let succeeded = 0
    let failed = 0
    
    for (const file of files) {
      try {
        const binaryContent = Buffer.from(file.content, 'base64')
        const contentHash = computeHash(binaryContent)
        const fileSize = binaryContent.length
        const fileType = getFileTypeFromExtension(file.extension)
        
        const storagePath = `${request.user.org_id}/${contentHash.substring(0, 2)}/${contentHash}`
        await request.supabase.storage
          .from('vault')
          .upload(storagePath, binaryContent, { contentType: 'application/octet-stream', upsert: false })
          .catch(() => {})
        
        const { data, error } = await request.supabase
          .from('files')
          .insert({
            org_id: request.user.org_id,
            vault_id,
            file_path: file.file_path,
            file_name: file.file_name,
            extension: file.extension || '',
            file_type: fileType,
            content_hash: contentHash,
            file_size: fileSize,
            state: 'not_tracked',
            revision: 'A',
            version: 1,
            created_by: request.user.id,
            updated_by: request.user.id
          })
          .select()
          .single()
        
        if (error) throw error
        results.push({ path: file.file_path, success: true, id: data.id })
        succeeded++
      } catch (err) {
        results.push({ path: file.file_path, success: false, error: err.message })
        failed++
      }
    }
    
    return { success: failed === 0, results, succeeded, failed }
  })
  
  // ============================================
  // Download Routes
  // ============================================
  
  fastify.get('/files/:id/download', {
    schema: {
      description: 'Download file content',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      },
      querystring: {
        type: 'object',
        properties: {
          version: { type: 'integer' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params
    const { version } = request.query
    
    const { data: file, error: fetchError } = await request.supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    let contentHash = file.content_hash
    
    if (version && version !== file.version) {
      const { data: versionData } = await request.supabase
        .from('file_versions')
        .select('content_hash')
        .eq('file_id', id)
        .eq('version', version)
        .single()
      
      if (!versionData) {
        return reply.code(404).send({ error: 'Not found', message: 'Version not found' })
      }
      contentHash = versionData.content_hash
    }
    
    const storagePath = `${request.user.org_id}/${contentHash.substring(0, 2)}/${contentHash}`
    const { data, error } = await request.supabase.storage
      .from('vault')
      .download(storagePath)
    
    if (error) throw error
    
    const buffer = Buffer.from(await data.arrayBuffer())
    
    if (request.headers.accept === 'application/octet-stream') {
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${file.file_name}"`)
        .header('Content-Length', buffer.length)
        .send(buffer)
    }
    
    return {
      file_name: file.file_name,
      content_hash: contentHash,
      file_size: buffer.length,
      content: buffer.toString('base64')
    }
  })
  
  // ============================================
  // Version History Routes
  // ============================================
  
  fastify.get('/files/:id/versions', {
    schema: {
      description: 'Get file version history',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { data, error } = await request.supabase
      .from('file_versions')
      .select(`
        *,
        created_by_user:users!created_by(email, full_name)
      `)
      .eq('file_id', request.params.id)
      .order('version', { ascending: false })
    
    if (error) throw error
    return { versions: data }
  })
  
  // ============================================
  // Trash Routes
  // ============================================
  
  fastify.get('/trash', {
    schema: {
      description: 'List deleted files',
      querystring: {
        type: 'object',
        properties: {
          vault_id: { type: 'string' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { vault_id } = request.query
    
    let query = request.supabase
      .from('files')
      .select(`
        id, file_path, file_name, extension, deleted_at, deleted_by,
        deleted_by_user:users!deleted_by(email, full_name)
      `)
      .eq('org_id', request.user.org_id)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    
    if (vault_id) query = query.eq('vault_id', vault_id)
    
    const { data, error } = await query
    if (error) throw error
    
    return { files: data }
  })
  
  fastify.post('/trash/:id/restore', {
    schema: {
      description: 'Restore file from trash',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { data, error } = await request.supabase
      .from('files')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', request.params.id)
      .eq('org_id', request.user.org_id)
      .select()
      .single()
    
    if (error) throw error
    return { success: true, file: data }
  })
  
  fastify.delete('/files/:id', {
    schema: {
      description: 'Soft delete a file',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { data: file, error: fetchError } = await request.supabase
      .from('files')
      .select('id, checked_out_by')
      .eq('id', request.params.id)
      .eq('org_id', request.user.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by && file.checked_out_by !== request.user.id) {
      return reply.code(409).send({ 
        error: 'Conflict',
        message: 'Cannot delete file checked out by another user'
      })
    }
    
    const { error } = await request.supabase
      .from('files')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: request.user.id
      })
      .eq('id', request.params.id)
    
    if (error) throw error
    return { success: true }
  })
  
  // ============================================
  // Activity Routes
  // ============================================
  
  fastify.get('/activity', {
    schema: {
      description: 'Get recent activity',
      querystring: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          limit: { type: 'integer', default: 50 }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { file_id, limit } = request.query
    
    let query = request.supabase
      .from('activity')
      .select(`
        *,
        file:files(file_name, file_path),
        user:users(email, full_name)
      `)
      .eq('org_id', request.user.org_id)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (file_id) query = query.eq('file_id', file_id)
    
    const { data, error } = await query
    if (error) throw error
    
    return { activity: data }
  })
  
  // ============================================
  // Checkouts Route
  // ============================================
  
  fastify.get('/checkouts', {
    schema: {
      description: 'List checked out files',
      querystring: {
        type: 'object',
        properties: {
          mine_only: { type: 'string' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { mine_only } = request.query
    
    let query = request.supabase
      .from('files')
      .select(`
        id, file_path, file_name, checked_out_at, lock_message,
        checked_out_user:users!checked_out_by(id, email, full_name)
      `)
      .eq('org_id', request.user.org_id)
      .not('checked_out_by', 'is', null)
      .order('checked_out_at', { ascending: false })
    
    if (mine_only === 'true') {
      query = query.eq('checked_out_by', request.user.id)
    }
    
    const { data, error } = await query
    if (error) throw error
    
    return { checkouts: data }
  })
  
  // ============================================
  // Metadata Routes
  // ============================================
  
  fastify.patch('/files/:id/metadata', {
    schema: {
      description: 'Update file metadata',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      },
      body: {
        type: 'object',
        properties: {
          state: { 
            type: 'string',
            enum: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete']
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { state } = request.body
    
    const updateData = {
      updated_at: new Date().toISOString(),
      updated_by: request.user.id
    }
    
    if (state) {
      updateData.state = state
      updateData.state_changed_at = new Date().toISOString()
      updateData.state_changed_by = request.user.id
    }
    
    const { data, error } = await request.supabase
      .from('files')
      .update(updateData)
      .eq('id', request.params.id)
      .eq('org_id', request.user.org_id)
      .select()
      .single()
    
    if (error) throw error
    return { success: true, file: data }
  })
  
  // ============================================
  // BOM Routes
  // ============================================
  
  fastify.get('/files/:id/where-used', {
    schema: {
      description: 'Get parent assemblies',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { data, error } = await request.supabase
      .from('file_references')
      .select(`
        *,
        parent:files!parent_file_id(
          id, file_name, file_path, part_number, revision, state
        )
      `)
      .eq('child_file_id', request.params.id)
    
    if (error) throw error
    return { references: data }
  })
  
  fastify.get('/files/:id/contains', {
    schema: {
      description: 'Get child components',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { data, error } = await request.supabase
      .from('file_references')
      .select(`
        *,
        child:files!child_file_id(
          id, file_name, file_path, part_number, revision, state
        )
      `)
      .eq('parent_file_id', request.params.id)
    
    if (error) throw error
    return { references: data }
  })
  
  // ============================================
  // Error Handler
  // ============================================
  
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    
    if (error.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: error.message,
        details: error.validation
      })
    }
    
    reply.code(error.statusCode || 500).send({
      error: error.name || 'Error',
      message: error.message
    })
  })
  
  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Not Found', message: 'Endpoint not found' })
  })
  
  return fastify
}

// ============================================
// Start Server
// ============================================

async function start() {
  try {
    const server = await buildServer()
    await server.listen({ port: PORT, host: HOST })
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              BluePDM REST API (Fastify)                      ║
╠══════════════════════════════════════════════════════════════╣
║  Server:    http://${HOST}:${PORT.toString().padEnd(38)}║
║  Supabase:  ${SUPABASE_URL ? 'Configured ✓'.padEnd(45) : 'Not configured ✗'.padEnd(45)}║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║    GET  /health              Health check                    ║
║    POST /auth/login          Login                           ║
║    GET  /vaults              List vaults                     ║
║    GET  /files               List files                      ║
║    POST /files/sync          Upload file                     ║
║    GET  /files/:id/download  Download file                   ║
║    POST /files/:id/checkout  Check out                       ║
║    POST /files/:id/checkin   Check in                        ║
║    GET  /files/:id/versions  Version history                 ║
║    GET  /activity            Activity feed                   ║
║    GET  /checkouts           List checkouts                  ║
╚══════════════════════════════════════════════════════════════╝
`)
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

start()

module.exports = { buildServer }
