#!/usr/bin/env npx ts-node
/**
 * BluePLM REST API Server (Fastify + TypeScript)
 * Build: 2025-12-14T06:26-v2.1.3-pino
 * 
 * Integration API for external systems (ERP, CI/CD, Slack, etc.)
 * 
 * NOTE: This API is designed for INTEGRATIONS, not daily app use.
 * - Desktop app users → Direct to Supabase (faster)
 * - SolidWorks add-in → Direct to Supabase (faster)  
 * - ERP systems (Odoo, etc.) → This API (controlled access)
 * - CI/CD, webhooks, automation → This API
 * 
 * Features:
 * - JWT authentication via Supabase
 * - JSON Schema validation on all endpoints
 * - OpenAPI/Swagger documentation at /docs
 * - Rate limiting for production
 * - Webhook support for notifications
 * - Signed URLs for file transfers (files go direct to Supabase)
 * - ERP-friendly endpoints (/parts, /bom, state shortcuts)
 * 
 * Environment Variables:
 *   SUPABASE_URL       - Supabase project URL
 *   SUPABASE_KEY       - Supabase anon key  
 *   SUPABASE_SERVICE_KEY - Service role key (for signed URLs)
 *   API_PORT           - Port to listen on (default: 3001)
 *   API_HOST           - Host to bind to (default: 127.0.0.1)
 *   RATE_LIMIT_MAX     - Max requests per window (default: 100)
 *   RATE_LIMIT_WINDOW  - Time window in ms (default: 60000)
 * 
 * Usage:
 *   npx ts-node api/server.ts
 *   npm run api
 */

import Fastify, { 
  FastifyInstance, 
  FastifyRequest, 
  FastifyReply,
  FastifyPluginAsync 
} from 'fastify'
import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { createClient, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Load version from API's own package.json
const packageJsonPath = path.join(__dirname, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
const API_VERSION = packageJson.version || '0.0.0'

// ============================================
// Types
// ============================================

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'engineer' | 'viewer'
  org_id: string | null
}

interface FileRecord {
  id: string
  org_id: string
  vault_id: string
  file_path: string
  file_name: string
  extension: string
  file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
  part_number: string | null
  description: string | null
  revision: string
  version: number
  content_hash: string
  file_size: number
  state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
  checked_out_by: string | null
  checked_out_at: string | null
  lock_message: string | null
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
  created_by: string
  updated_by: string
}

interface Webhook {
  id: string
  org_id: string
  url: string
  secret: string
  events: WebhookEvent[]
  active: boolean
  created_at: string
  created_by: string
}

type WebhookEvent = 
  | 'file.checkout'
  | 'file.checkin'
  | 'file.sync'
  | 'file.delete'
  | 'file.restore'
  | 'file.state_change'
  | 'file.version'

interface WebhookPayload {
  event: WebhookEvent
  timestamp: string
  org_id: string
  data: {
    file_id?: string
    file_path?: string
    file_name?: string
    user_id?: string
    user_email?: string
    [key: string]: unknown
  }
}

// Supplier types
interface Supplier {
  id: string
  org_id: string
  name: string
  code: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string
  payment_terms: string | null
  default_lead_time_days: number | null
  min_order_value: number | null
  currency: string
  shipping_account: string | null
  is_active: boolean
  is_approved: boolean
  notes: string | null
  erp_id: string | null
  created_at: string
  updated_at: string
}

interface PartSupplier {
  id: string
  org_id: string
  file_id: string
  supplier_id: string
  supplier_part_number: string | null
  supplier_description: string | null
  supplier_url: string | null
  unit_price: number | null
  currency: string
  price_unit: string
  price_breaks: PriceBreak[]
  min_order_qty: number
  order_multiple: number
  lead_time_days: number | null
  is_preferred: boolean
  is_active: boolean
  is_qualified: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

interface PriceBreak {
  qty: number
  price: number
}

// Extend FastifyRequest with our custom properties
declare module 'fastify' {
  interface FastifyRequest {
    user: UserProfile | null
    supabase: SupabaseClient | null
    accessToken: string | null
  }
  
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

// ============================================
// Configuration
// ============================================

const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3001', 10)
const HOST = process.env.API_HOST || '0.0.0.0' // 0.0.0.0 for cloud deployment
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '' // For signed URLs
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10)
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10)
const SIGNED_URL_EXPIRY = 3600 // 1 hour

// ============================================
// JSON Schemas
// ============================================

const schemas = {
  // Common response schemas
  error: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      message: { type: 'string' },
      details: { type: 'array', items: { type: 'object' } }
    }
  } as const,
  
  file: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      file_path: { type: 'string' },
      file_name: { type: 'string' },
      extension: { type: 'string' },
      file_type: { type: 'string', enum: ['part', 'assembly', 'drawing', 'document', 'other'] },
      part_number: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      revision: { type: 'string' },
      version: { type: 'integer' },
      content_hash: { type: 'string' },
      file_size: { type: 'integer' },
      state: { type: 'string', enum: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete'] },
      checked_out_by: { type: ['string', 'null'] },
      checked_out_at: { type: ['string', 'null'] }
    }
  } as const,
  
  vault: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      org_id: { type: 'string', format: 'uuid' }
    }
  } as const,
  
  user: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      full_name: { type: ['string', 'null'] },
      role: { type: 'string', enum: ['admin', 'engineer', 'viewer'] },
      org_id: { type: ['string', 'null'] }
    }
  } as const,
  
  webhook: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      url: { type: 'string', format: 'uri' },
      events: { 
        type: 'array', 
        items: { 
          type: 'string',
          enum: ['file.checkout', 'file.checkin', 'file.sync', 'file.delete', 'file.restore', 'file.state_change', 'file.version']
        }
      },
      active: { type: 'boolean' },
      created_at: { type: 'string', format: 'date-time' }
    }
  } as const,
  
  supplier: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      code: { type: ['string', 'null'] },
      contact_name: { type: ['string', 'null'] },
      contact_email: { type: ['string', 'null'] },
      contact_phone: { type: ['string', 'null'] },
      website: { type: ['string', 'null'] },
      address_line1: { type: ['string', 'null'] },
      city: { type: ['string', 'null'] },
      state: { type: ['string', 'null'] },
      postal_code: { type: ['string', 'null'] },
      country: { type: 'string' },
      payment_terms: { type: ['string', 'null'] },
      default_lead_time_days: { type: ['integer', 'null'] },
      min_order_value: { type: ['number', 'null'] },
      currency: { type: 'string' },
      is_active: { type: 'boolean' },
      is_approved: { type: 'boolean' },
      notes: { type: ['string', 'null'] },
      erp_id: { type: ['string', 'null'] }
    }
  } as const,
  
  partSupplier: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      file_id: { type: 'string', format: 'uuid' },
      supplier_id: { type: 'string', format: 'uuid' },
      supplier_part_number: { type: ['string', 'null'] },
      supplier_description: { type: ['string', 'null'] },
      supplier_url: { type: ['string', 'null'] },
      unit_price: { type: ['number', 'null'] },
      currency: { type: 'string' },
      price_unit: { type: 'string' },
      price_breaks: { 
        type: 'array',
        items: {
          type: 'object',
          properties: {
            qty: { type: 'integer' },
            price: { type: 'number' }
          }
        }
      },
      min_order_qty: { type: 'integer' },
      order_multiple: { type: 'integer' },
      lead_time_days: { type: ['integer', 'null'] },
      is_preferred: { type: 'boolean' },
      is_active: { type: 'boolean' },
      is_qualified: { type: 'boolean' },
      notes: { type: ['string', 'null'] }
    }
  } as const
}

// ============================================
// Supabase Client Factory
// ============================================

function createSupabaseClient(accessToken?: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY environment variables.')
  }
  
  const options: Parameters<typeof createClient>[2] = {
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
// Utility Functions
// ============================================

function getFileTypeFromExtension(ext: string): FileRecord['file_type'] {
  const lowerExt = (ext || '').toLowerCase()
  if (['.sldprt', '.prt', '.ipt', '.par'].includes(lowerExt)) return 'part'
  if (['.sldasm', '.asm', '.iam'].includes(lowerExt)) return 'assembly'
  if (['.slddrw', '.drw', '.idw', '.dwg'].includes(lowerExt)) return 'drawing'
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'].includes(lowerExt)) return 'document'
  return 'other'
}

function computeHash(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

// ============================================
// Odoo XML-RPC Helpers
// ============================================

interface OdooSupplier {
  id: number
  name: string
  ref: string | false
  email: string | false
  phone: string | false
  mobile: string | false
  website: string | false
  street: string | false
  street2: string | false
  city: string | false
  zip: string | false
  state_id: [number, string] | false
  country_id: [number, string] | false
  active: boolean
}

// Store last XML responses for debugging
let lastXmlResponses: string[] = []

async function odooXmlRpc(
  url: string, 
  service: string, 
  method: string, 
  params: unknown[]
): Promise<unknown> {
  // Build XML-RPC request
  const xmlPayload = buildXmlRpcRequest(method, params)
  
  const response = await fetch(`${url}/xmlrpc/2/${service}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlPayload,
    signal: AbortSignal.timeout(30000) // 30s timeout
  })
  
  if (!response.ok) {
    throw new Error(`Odoo API error: ${response.status} ${response.statusText}`)
  }
  
  const xmlResponse = await response.text()
  
  // Store for debugging (keep last 5, truncate to 300 chars each)
  lastXmlResponses.push(`${service}.${method}: ${xmlResponse.substring(0, 300)}...`)
  if (lastXmlResponses.length > 5) lastXmlResponses.shift()
  
  return parseXmlRpcResponse(xmlResponse)
}

function getLastXmlResponses(): string[] {
  return lastXmlResponses
}

function buildXmlRpcRequest(method: string, params: unknown[]): string {
  const paramXml = params.map(p => `<param>${valueToXml(p)}</param>`).join('')
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>${paramXml}</params>
</methodCall>`
}

function valueToXml(value: unknown): string {
  if (value === null || value === undefined) {
    return '<value><boolean>0</boolean></value>'
  }
  if (typeof value === 'boolean') {
    return `<value><boolean>${value ? 1 : 0}</boolean></value>`
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return `<value><int>${value}</int></value>`
    }
    return `<value><double>${value}</double></value>`
  }
  if (typeof value === 'string') {
    const escaped = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<value><string>${escaped}</string></value>`
  }
  if (Array.isArray(value)) {
    const items = value.map(v => valueToXml(v)).join('')
    return `<value><array><data>${items}</data></array></value>`
  }
  if (typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `<member><name>${k}</name>${valueToXml(v)}</member>`)
      .join('')
    return `<value><struct>${members}</struct></value>`
  }
  return `<value><string>${String(value)}</string></value>`
}

function parseXmlRpcResponse(xml: string): unknown {
  // Simple XML-RPC response parser
  // Check for fault
  const faultMatch = xml.match(/<fault>[\s\S]*?<string>([^<]*)<\/string>[\s\S]*?<\/fault>/)
  if (faultMatch) {
    throw new Error(`Odoo fault: ${faultMatch[1]}`)
  }
  
  // Find the param value content
  // First, extract just the param section
  const paramSection = xml.match(/<params>\s*<param>([\s\S]+)<\/param>\s*<\/params>/)
  if (!paramSection) {
    // Check if it's a simple response
    const simpleMatch = xml.match(/<value>[\s\S]*?<(int|boolean|string)>([^<]*)</)
    if (simpleMatch) {
      if (simpleMatch[1] === 'int') return parseInt(simpleMatch[2], 10)
      if (simpleMatch[1] === 'boolean') return simpleMatch[2] === '1'
      return simpleMatch[2]
    }
    throw new Error('Invalid XML-RPC response')
  }
  
  // Now find the outer <value>...</value> in the param section
  // We need to match the first <value> with its corresponding </value>
  const paramContent = paramSection[1].trim()
  
  // Find first <value>
  const valueStart = paramContent.indexOf('<value>')
  if (valueStart === -1) {
    throw new Error('No value tag in param')
  }
  
  // Find matching </value> by counting depth
  let depth = 0
  let i = valueStart
  let valueEnd = -1
  while (i < paramContent.length) {
    if (paramContent.substring(i, i + 7) === '<value>') {
      depth++
      i += 7
    } else if (paramContent.substring(i, i + 8) === '</value>') {
      depth--
      if (depth === 0) {
        valueEnd = i
        break
      }
      i += 8
    } else {
      i++
    }
  }
  
  if (valueEnd === -1) {
    throw new Error('No matching </value> tag')
  }
  
  // Extract content between <value> and </value>
  const innerContent = paramContent.substring(valueStart + 7, valueEnd)
  
  return parseXmlValue(innerContent)
}

function parseXmlValue(valueXml: string): unknown {
  // Check for COMPLEX types first (they contain other elements)
  
  // Array - must check BEFORE int/string since arrays contain those
  const arrayMatch = valueXml.match(/^\s*<array>\s*<data>([\s\S]*)<\/data>\s*<\/array>\s*$/)
  if (arrayMatch) {
    const items: unknown[] = []
    // Match each <value>...</value> at the top level of the data
    const dataContent = arrayMatch[1]
    let depth = 0
    let currentStart = -1
    for (let i = 0; i < dataContent.length; i++) {
      if (dataContent.substring(i, i + 7) === '<value>') {
        if (depth === 0) currentStart = i + 7
        depth++
        i += 6
      } else if (dataContent.substring(i, i + 8) === '</value>') {
        depth--
        if (depth === 0 && currentStart !== -1) {
          const valueContent = dataContent.substring(currentStart, i)
          items.push(parseXmlValue(valueContent))
          currentStart = -1
        }
        i += 7
      }
    }
    return items
  }
  
  // Struct - must check BEFORE int/string since structs contain those  
  const structMatch = valueXml.match(/^\s*<struct>([\s\S]*)<\/struct>\s*$/)
  if (structMatch) {
    const obj: Record<string, unknown> = {}
    const memberRegex = /<member>\s*<name>([^<]+)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g
    let match
    while ((match = memberRegex.exec(structMatch[1])) !== null) {
      obj[match[1]] = parseXmlValue(match[2])
    }
    return obj
  }
  
  // Now check SIMPLE types (these don't contain nested elements)
  
  // Integer
  const intMatch = valueXml.match(/^\s*<int>(-?\d+)<\/int>\s*$/)
  if (intMatch) return parseInt(intMatch[1], 10)
  
  const i4Match = valueXml.match(/^\s*<i4>(-?\d+)<\/i4>\s*$/)
  if (i4Match) return parseInt(i4Match[1], 10)
  
  // Boolean
  const boolMatch = valueXml.match(/^\s*<boolean>(\d)<\/boolean>\s*$/)
  if (boolMatch) return boolMatch[1] === '1'
  
  // String
  const strMatch = valueXml.match(/^\s*<string>([^<]*)<\/string>\s*$/)
  if (strMatch) return strMatch[1]
  
  // Double
  const doubleMatch = valueXml.match(/^\s*<double>([^<]+)<\/double>\s*$/)
  if (doubleMatch) return parseFloat(doubleMatch[1])
  
  // Empty content
  if (valueXml.match(/^\s*$/)) return ''
  
  // Default - return trimmed string
  return valueXml.trim()
}

// Normalize Odoo URL - ensure https:// prefix
function normalizeOdooUrl(url: string): string {
  let normalized = url.trim()
  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '')
  // Add https:// if no protocol specified
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = 'https://' + normalized
  }
  return normalized
}

async function testOdooConnection(
  url: string, 
  database: string, 
  username: string, 
  apiKey: string
): Promise<{ success: boolean; user_name?: string; version?: string; error?: string }> {
  const normalizedUrl = normalizeOdooUrl(url)
  try {
    // Get version info (no auth required)
    const version = await odooXmlRpc(normalizedUrl, 'common', 'version', []) as { server_version?: string }
    
    // Authenticate
    const uid = await odooXmlRpc(normalizedUrl, 'common', 'authenticate', [
      database, username, apiKey, {}
    ])
    
    if (!uid || uid === false) {
      return { success: false, error: 'Invalid credentials' }
    }
    
    // Get user name
    const users = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
      database, uid, apiKey,
      'res.users', 'read',
      [[uid as number], ['name']]
    ]) as Array<{ name: string }>
    
    return {
      success: true,
      user_name: users[0]?.name || username,
      version: version?.server_version || 'Unknown'
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

interface OdooFetchResult {
  success: boolean
  suppliers: OdooSupplier[]
  error?: string
  debug: {
    url: string
    auth_uid: unknown
    supplier_ids_count: number
    supplier_ids_type: string
    suppliers_result_type: string
    suppliers_count: number
    timing_ms: number
  }
}

async function fetchOdooSuppliers(
  url: string,
  database: string,
  username: string,
  apiKey: string
): Promise<OdooFetchResult> {
  const normalizedUrl = normalizeOdooUrl(url)
  const startTime = Date.now()
  const debug: OdooFetchResult['debug'] = {
    url: normalizedUrl,
    auth_uid: null,
    supplier_ids_count: 0,
    supplier_ids_type: 'unknown',
    suppliers_result_type: 'unknown',
    suppliers_count: 0,
    timing_ms: 0
  }
  
  try {
    // Authenticate first
    const uid = await odooXmlRpc(normalizedUrl, 'common', 'authenticate', [
      database, username, apiKey, {}
    ])
    
    debug.auth_uid = uid
    
    if (!uid || uid === false) {
      debug.timing_ms = Date.now() - startTime
      return { success: false, suppliers: [], error: 'Odoo authentication failed - check credentials', debug }
    }
    
    // Search for suppliers using multiple strategies
    let supplierIds: unknown = []
    let queryUsed = 'none'
    
    // Helper to check if result is a valid array of IDs
    const isValidIdArray = (result: unknown): result is number[] => 
      Array.isArray(result) && result.length > 0
    
    // Strategy 1: supplier_rank > 0 (partners with purchase history in Odoo 13+)
    try {
      supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
        database, uid, apiKey,
        'res.partner', 'search',
        [[['supplier_rank', '>', 0]]],
        { limit: 5000 }
      ])
      queryUsed = 'supplier_rank'
      debug.supplier_ids_type = `supplier_rank:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
    } catch (e) {
      debug.supplier_ids_type = `supplier_rank:error:${e}`
    }
    
    // Strategy 2: Partners with vendor payment terms (indicates vendor setup)
    if (!isValidIdArray(supplierIds)) {
      try {
        supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
          database, uid, apiKey,
          'res.partner', 'search',
          [[['property_supplier_payment_term_id', '!=', false]]],
          { limit: 5000 }
        ])
        queryUsed = 'payment_terms'
        debug.supplier_ids_type += ` → payment_terms:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
      } catch {
        debug.supplier_ids_type += ' → payment_terms:field_error'
      }
    }
    
    // Strategy 3: All companies (broad - will include customers too)
    if (!isValidIdArray(supplierIds)) {
      try {
        supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
          database, uid, apiKey,
          'res.partner', 'search',
          [[['is_company', '=', true], ['active', '=', true]]],
          { limit: 5000 }
        ])
        queryUsed = 'is_company'
        debug.supplier_ids_type += ` → is_company:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
      } catch (e) {
        debug.supplier_ids_type += ` → is_company:error:${e}`
      }
    }
    
    // Strategy 4: Last resort - ALL active partners
    if (!isValidIdArray(supplierIds)) {
      try {
        supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
          database, uid, apiKey,
          'res.partner', 'search',
          [[['active', '=', true]]],
          { limit: 1000 }  // Smaller limit for broad query
        ])
        queryUsed = 'all_partners'
        debug.supplier_ids_type += ` → all_partners:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
      } catch (e) {
        debug.supplier_ids_type += ` → all_partners:error:${e}`
      }
    }
    
    // debug.supplier_ids_type is set in the query strategies above
    
    // Ensure supplierIds is an array
    const ids = Array.isArray(supplierIds) ? supplierIds : []
    debug.supplier_ids_count = ids.length
    
    if (ids.length === 0) {
      debug.timing_ms = Date.now() - startTime
      const debugWithXml = { ...debug, raw_xml_samples: getLastXmlResponses() }
      return { success: true, suppliers: [], debug: debugWithXml }
    }
    
    // Read supplier details
    const suppliersResult = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
      database, uid, apiKey,
      'res.partner', 'read',
      [ids, [
        'id', 'name', 'ref', 'email', 'phone', 'mobile', 'website',
        'street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'active'
      ]]
    ])
    
    debug.suppliers_result_type = typeof suppliersResult + (Array.isArray(suppliersResult) ? '[]' : '')
    
    // Ensure result is an array
    const suppliers = Array.isArray(suppliersResult) ? suppliersResult as OdooSupplier[] : []
    debug.suppliers_count = suppliers.length
    debug.timing_ms = Date.now() - startTime
    
    // Include raw XML samples for debugging
    const debugWithXml = { ...debug, raw_xml_samples: getLastXmlResponses() }
    
    return { success: true, suppliers, debug: debugWithXml }
  } catch (err) {
    const debugWithXml = { ...debug, timing_ms: Date.now() - startTime, raw_xml_samples: getLastXmlResponses() }
    return { 
      success: false, 
      suppliers: [], 
      error: `Odoo API error: ${err instanceof Error ? err.message : String(err)}`,
      debug: debugWithXml 
    }
  }
}

// In-memory webhook store (in production, use database)
const webhooks: Map<string, Webhook[]> = new Map()

async function triggerWebhooks(
  orgId: string, 
  event: WebhookEvent, 
  data: WebhookPayload['data'],
  log: FastifyInstance['log']
): Promise<void> {
  const orgWebhooks = webhooks.get(orgId) || []
  const activeWebhooks = orgWebhooks.filter(w => w.active && w.events.includes(event))
  
  if (activeWebhooks.length === 0) return
  
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    org_id: orgId,
    data
  }
  
  const payloadString = JSON.stringify(payload)
  
  for (const webhook of activeWebhooks) {
    try {
      const signature = signWebhookPayload(payloadString, webhook.secret)
      
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BluePLM-Signature': signature,
          'X-BluePLM-Event': event
        },
        body: payloadString,
        signal: AbortSignal.timeout(10000) // 10s timeout
      })
      
      if (!response.ok) {
        log.warn({ webhookId: webhook.id, status: response.status }, 'Webhook delivery failed')
      }
    } catch (err) {
      log.error({ webhookId: webhook.id, error: err }, 'Webhook delivery error')
    }
  }
}

// ============================================
// Authentication Plugin
// ============================================

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('user', null)
  fastify.decorateRequest('supabase', null)
  fastify.decorateRequest('accessToken', null)
  
  fastify.decorate('authenticate', async function(
    request: FastifyRequest, 
    reply: FastifyReply
  ): Promise<void> {
    // Use console.log as fallback to ensure we see output
    console.log('>>> [Auth] authenticate() ENTRY - v2.1.8')
    fastify.log.info('>>> [Auth] authenticate() ENTRY')
    
    try {
      const authHeader = request.headers.authorization
      console.log('>>> [Auth] Header:', authHeader ? authHeader.substring(0, 30) + '...' : 'NONE')
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('>>> [Auth] FAIL: Missing or invalid auth header')
        reply.code(401).send({ 
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header'
        })
        throw new Error('Auth: Missing header')
      }
      
      const token = authHeader.substring(7)
      
      if (!token || token === 'undefined' || token === 'null') {
        console.log('>>> [Auth] FAIL: Empty or invalid token string')
        reply.code(401).send({ 
          error: 'Unauthorized',
          message: 'Invalid or missing access token'
        })
        throw new Error('Auth: Invalid token string')
      }
      
      console.log('>>> [Auth] Verifying token with Supabase...')
      const supabase = createSupabaseClient(token)
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
      if (error || !user) {
        console.log('>>> [Auth] FAIL: Token verification failed:', error?.message)
        reply.code(401).send({ 
          error: 'Invalid token',
          message: error?.message || 'Token verification failed',
          hint: 'Ensure API server SUPABASE_URL matches your app\'s Supabase project'
        })
        throw new Error('Auth: Token verification failed')
      }
      
      console.log('>>> [Auth] Token valid, looking up profile for user:', user.id)
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, email, role, org_id, full_name')
        .eq('id', user.id)
        .single()
      
      if (profileError || !profile) {
        console.log('>>> [Auth] FAIL: Profile lookup failed:', profileError?.message)
        reply.code(401).send({ 
          error: 'Profile not found',
          message: 'User profile does not exist'
        })
        throw new Error('Auth: Profile not found')
      }
      
      if (!profile.org_id) {
        console.log('>>> [Auth] FAIL: User has no organization:', profile.email)
        reply.code(403).send({ 
          error: 'No organization',
          message: 'User is not a member of any organization'
        })
        throw new Error('Auth: No organization')
      }
      
      // Success - set user on request
      request.user = profile as UserProfile
      request.supabase = supabase
      request.accessToken = token
      console.log('>>> [Auth] SUCCESS: Authenticated', profile.email)
      fastify.log.info({ msg: '>>> [Auth] Authenticated', email: profile.email })
    } catch (err) {
      // Re-throw to stop the request lifecycle
      console.log('>>> [Auth] Exception caught:', err instanceof Error ? err.message : err)
      throw err
    }
  })
}

// Wrap with fastify-plugin to make decorators available to parent scope
const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin'
})

// ============================================
// Build Server
// ============================================

export async function buildServer(): Promise<FastifyInstance> {
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

  // Register CORS
  // CORS - configure allowed origins via CORS_ORIGINS env var (comma-separated)
  const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : true // Allow all in dev
  await fastify.register(cors, { 
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
  
  // Register Rate Limiting
  await fastify.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
    errorResponseBuilder: () => ({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW / 1000}s`
    })
  })
  
  // Register OpenAPI/Swagger
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'BluePLM REST API',
        description: 'Product Lifecycle Management API for everyone who builds',
        version: API_VERSION
      },
      servers: [
        { url: `http://${HOST}:${PORT}`, description: 'Local server' }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      tags: [
        { name: 'Info', description: 'API info and health' },
        { name: 'Auth', description: 'Authentication endpoints' },
        { name: 'Vaults', description: 'Vault management' },
        { name: 'Files', description: 'File operations' },
        { name: 'ERP', description: 'ERP integration endpoints (Odoo, SAP, etc.)' },
        { name: 'Suppliers', description: 'Supplier/vendor management and costing' },
        { name: 'Versions', description: 'Version history' },
        { name: 'Trash', description: 'Deleted files' },
        { name: 'Activity', description: 'Activity feed' },
        { name: 'Webhooks', description: 'Webhook management' }
      ]
    }
  })
  
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true
    },
    theme: {
      title: 'BluePLM API',
      favicon: [
        {
          filename: 'favicon.png',
          rel: 'icon',
          sizes: '32x32',
          type: 'image/png',
          content: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANKSURBVFiFtZdNaBNBFMd/s5tNYps0fqTVqlQEFUEUwYMHwYMHP0BFxJMeBE+CIHgRPHj04kHw4EEQwYMgIuJBEMGDIIIHQQQPihcPiv1IbZOm2WR3x0N2k91ks9mksH8YZndm3vv9Z2bevJkVSiml0Wh4VNO1IAHQDUHSwBwQB7qAOGCY5rMAA0gCKWChKAVEJQFagB6gO0jONdADnAfOhNjzwF/gHfATyLQqwCIgYhiGUVVVhWEYlupd8P7+/rTPxU0JoBQqk8koTdPYuXOnOnHihGLYrD5OAQGk02kGBgZ4+PAhgwODdHV1ceLkCc6dO8eBAwdCFTJBNwL8BUDNQCRV0xKPx6mpqSGRSBAPQBFfgJ+EqBcq7+8G6urqAHj9+jWpVIqrV6/y4sUL0uk0t27dorGxkYMHD5aFwC3ACSHEXgCl1Hxvby9nz54llUoxMTHBhg0bOHbsGIcPH2bhwoVV/SukgS8C9GxOVrAAwB8AKRsz/gNYsGABV65cYc+ePXz//p1MJsP69eu5ePEiLS0tVROQRoMQC7AYqHMrYFlDuQD/AKQA0uk0sViMefPm0dXVRU9PD0ePHmX37t1lkfAdA7kHSMljJOcvIQQ1NTU0NDRQX19fGg8TwI9cJqBDxmKKZDLJsmXLuHTpEocOHSKRSFQ0di3ACE6lFfX19fT29rJ8+XI+fPjA+Pg4169f5/nz5yQSCa5du8bGjRurAkDSJqA2N+ecnJzE0ulJJJLZUAUAmZwfQC/2Z9u2baTTaV69esXY2Bg3btzg1atXJJNJenp6aN++vapVUu47UOu+L23D4+np6ayVbNmyxf56bGwMpRSjo6NcuHAhOwmrAbCQT0NlHgBqHPk8H4AiwDQtaxL09fXx8OFDBgYGSCQS3L17l3379lU1E3LtA0D6TULbIrJz504ePXrE169fmZiY4M6dOzx58oRkMsndu3cpzgSlFNJX+58AVKpIKYWh69ntdv369UZnZyddXV0sXryYNWvWcPz4cbZv304sFnOdCKK4B4Td86/QBiiluH//vhocHFSDg4MKaOxOCAAlvNrvKxVaLqG8xjwHQN4gHACpQKO0AajwcZ3v2yqaUoVjpK2xIZKKx8Mnn4yRV3sA/APBfwG8kT/9YgAAAABJRU5ErkJggg==', 'base64')
        }
      ]
    },
    logo: {
      type: 'image/svg+xml',
      content: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50">
        <rect width="200" height="50" fill="#1e293b"/>
        <text x="10" y="35" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="bold" fill="#3b82f6">Blue</text>
        <text x="65" y="35" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="bold" fill="#ffffff">PDM</text>
        <text x="120" y="35" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="#64748b">API</text>
      </svg>`)
    }
  })
  
  // Register Auth Plugin
  await fastify.register(authPlugin)

  // DEBUG: Log all requests with auth header info
  fastify.addHook('onRequest', async (request) => {
    const authHeader = request.headers.authorization
    request.log.info({
      msg: '>>> REQUEST DEBUG',
      url: request.url,
      method: request.method,
      hasAuthHeader: !!authHeader,
      authHeaderStart: authHeader?.substring(0, 30) || 'none'
    })
  })

  // ============================================
  // Health & Info Routes
  // ============================================
  
  fastify.get('/', {
    schema: {
      description: 'API info and status',
      tags: ['Info'],
      response: {
        200: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            status: { type: 'string' },
            docs: { type: 'string' }
          }
        }
      }
    }
  }, async () => ({
    name: 'BluePLM REST API',
    version: API_VERSION,
    status: 'running',
    docs: `http://${HOST}:${PORT}/docs`
  }))
  
  fastify.get('/health', {
    schema: {
      description: 'Health check',
      tags: ['Info'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            supabase: { type: 'string' },
            supabase_project: { type: ['string', 'null'] },
            version: { type: 'string' },
            build: { type: ['string', 'null'] }
          }
        }
      }
    }
  }, async () => {
    // Extract project ID from Supabase URL for debugging (e.g., https://abcdefgh.supabase.co -> abcdefgh)
    const supabaseProject = SUPABASE_URL ? SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase/)?.[1] || 'custom' : null
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      supabase: SUPABASE_URL ? 'configured' : 'not configured',
      supabase_project: supabaseProject, // Shows project ID for verification
      version: API_VERSION,
      build: process.env.RAILWAY_GIT_COMMIT_SHA?.substring(0, 7) || process.env.RENDER_GIT_COMMIT?.substring(0, 7) || null
    }
  })

  // ============================================
  // Auth Routes
  // ============================================
  
  fastify.get('/auth/me', {
    schema: {
      description: 'Get current user info',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
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
  }, async (request) => ({
    user: request.user,
    org_id: request.user!.org_id
  }))
  
  fastify.post('/auth/login', {
    schema: {
      description: 'Login with email and password',
      tags: ['Auth'],
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
    const { email, password } = request.body as { email: string; password: string }
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
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['refresh_token'],
        properties: {
          refresh_token: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { refresh_token } = request.body as { refresh_token: string }
    const supabase = createSupabaseClient()
    
    const { data, error } = await supabase.auth.refreshSession({ refresh_token })
    
    if (error) {
      return reply.code(401).send({ error: 'Refresh failed', message: error.message })
    }
    
    return {
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
      expires_at: data.session!.expires_at
    }
  })

  // ============================================
  // Vault Routes
  // ============================================
  
  fastify.get('/vaults', {
    schema: {
      description: 'List organization vaults',
      tags: ['Vaults'],
      security: [{ bearerAuth: [] }],
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
    const { data, error } = await request.supabase!
      .from('vaults')
      .select('*')
      .eq('org_id', request.user!.org_id)
      .order('name')
    
    if (error) throw error
    return { vaults: data }
  })
  
  fastify.get('/vaults/:id', {
    schema: {
      description: 'Get vault by ID',
      tags: ['Vaults'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data, error } = await request.supabase!
      .from('vaults')
      .select('*')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'Vault not found' })
    
    return { vault: data }
  })
  
  fastify.get('/vaults/:id/status', {
    schema: {
      description: 'Get vault status summary',
      tags: ['Vaults'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { id } = request.params as { id: string }
    
    const { data: files, error } = await request.supabase!
      .from('files')
      .select('state, checked_out_by')
      .eq('vault_id', id)
      .eq('org_id', request.user!.org_id)
      .is('deleted_at', null)
    
    if (error) throw error
    
    const status = {
      total: files?.length || 0,
      checked_out: files?.filter(f => f.checked_out_by).length || 0,
      checked_out_by_me: files?.filter(f => f.checked_out_by === request.user!.id).length || 0,
      by_state: {} as Record<string, number>
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
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          vault_id: { type: 'string', format: 'uuid' },
          folder: { type: 'string' },
          state: { type: 'string', enum: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete'] },
          search: { type: 'string' },
          checked_out: { type: 'string', enum: ['me', 'any'] },
          limit: { type: 'integer', default: 1000 },
          offset: { type: 'integer', default: 0 }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { vault_id, folder, state, search, checked_out, limit = 1000, offset = 0 } = 
      request.query as Record<string, string | number | undefined>
    
    let query = request.supabase!
      .from('files')
      .select(`
        id, file_path, file_name, extension, file_type,
        part_number, description, revision, version,
        content_hash, file_size, state,
        checked_out_by, checked_out_at, updated_at, created_at
      `)
      .eq('org_id', request.user!.org_id)
      .is('deleted_at', null)
      .order('file_path')
      .range(offset as number, (offset as number) + (limit as number) - 1)
    
    if (vault_id) query = query.eq('vault_id', vault_id)
    if (folder) query = query.ilike('file_path', `${folder}%`)
    if (state) query = query.eq('state', state)
    if (search) query = query.or(`file_name.ilike.%${search}%,part_number.ilike.%${search}%`)
    if (checked_out === 'me') query = query.eq('checked_out_by', request.user!.id)
    if (checked_out === 'any') query = query.not('checked_out_by', 'is', null)
    
    const { data, error } = await query
    if (error) throw error
    
    return { files: data, count: data?.length || 0 }
  })
  
  fastify.get('/files/:id', {
    schema: {
      description: 'Get file by ID',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data, error } = await request.supabase!
      .from('files')
      .select(`
        *,
        checked_out_user:users!checked_out_by(email, full_name, avatar_url),
        created_by_user:users!created_by(email, full_name)
      `)
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    return { file: data }
  })

  // ============================================
  // Checkout / Checkin Routes
  // ============================================
  
  fastify.post('/files/:id/checkout', {
    schema: {
      description: 'Check out a file for editing',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Optional lock message' }
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
    const { id } = request.params as { id: string }
    const { message } = (request.body as { message?: string }) || {}
    
    const { data: file, error: fetchError } = await request.supabase!
      .from('files')
      .select('id, file_name, file_path, checked_out_by, org_id')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by && file.checked_out_by !== request.user!.id) {
      return reply.code(409).send({ 
        error: 'Already checked out',
        message: 'File is checked out by another user'
      })
    }
    
    const { data, error } = await request.supabase!
      .from('files')
      .update({
        checked_out_by: request.user!.id,
        checked_out_at: new Date().toISOString(),
        lock_message: message || null
      })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    // Log activity
    await request.supabase!.from('activity').insert({
      org_id: request.user!.org_id,
      file_id: id,
      user_id: request.user!.id,
      action: 'checkout',
      details: message ? { message } : {}
    })
    
    // Trigger webhooks
    await triggerWebhooks(request.user!.org_id!, 'file.checkout', {
      file_id: id,
      file_path: file.file_path,
      file_name: file.file_name,
      user_id: request.user!.id,
      user_email: request.user!.email
    }, fastify.log)
    
    return { success: true, file: data }
  })
  
  fastify.post('/files/:id/checkin', {
    schema: {
      description: 'Check in a file after editing',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        properties: {
          comment: { type: 'string' },
          content_hash: { type: 'string' },
          file_size: { type: 'integer' },
          content: { type: 'string', description: 'Base64 encoded file content' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { comment, content_hash, file_size, content } = 
      (request.body as { comment?: string; content_hash?: string; file_size?: number; content?: string }) || {}
    
    const { data: file, error: fetchError } = await request.supabase!
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by !== request.user!.id) {
      return reply.code(403).send({ error: 'Forbidden', message: 'File is not checked out to you' })
    }
    
    const updateData: Record<string, unknown> = {
      checked_out_by: null,
      checked_out_at: null,
      lock_message: null,
      checked_out_by_machine_id: null,
      checked_out_by_machine_name: null,
      updated_at: new Date().toISOString(),
      updated_by: request.user!.id
    }
    
    // Upload new content if provided
    if (content) {
      const binaryContent = Buffer.from(content, 'base64')
      const newHash = computeHash(binaryContent)
      const storagePath = `${request.user!.org_id}/${newHash.substring(0, 2)}/${newHash}`
      
      const { error: uploadError } = await request.supabase!.storage
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
      
      await request.supabase!.from('file_versions').insert({
        file_id: id,
        version: file.version + 1,
        revision: file.revision,
        content_hash: updateData.content_hash,
        file_size: updateData.file_size || file.file_size,
        state: file.state,
        created_by: request.user!.id,
        comment: comment || null
      })
      
      // Trigger version webhook
      await triggerWebhooks(request.user!.org_id!, 'file.version', {
        file_id: id,
        file_path: file.file_path,
        file_name: file.file_name,
        version: file.version + 1,
        user_id: request.user!.id,
        user_email: request.user!.email
      }, fastify.log)
    }
    
    const { data, error } = await request.supabase!
      .from('files')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    // Log activity and trigger webhook
    await request.supabase!.from('activity').insert({
      org_id: request.user!.org_id,
      file_id: id,
      user_id: request.user!.id,
      action: 'checkin',
      details: { comment, contentChanged }
    })
    
    await triggerWebhooks(request.user!.org_id!, 'file.checkin', {
      file_id: id,
      file_path: file.file_path,
      file_name: file.file_name,
      user_id: request.user!.id,
      user_email: request.user!.email,
      content_changed: contentChanged
    }, fastify.log)
    
    return { success: true, file: data, contentChanged }
  })
  
  fastify.post('/files/:id/undo-checkout', {
    schema: {
      description: 'Undo checkout (discard changes)',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data: file, error: fetchError } = await request.supabase!
      .from('files')
      .select('id, checked_out_by')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by !== request.user!.id && request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'File is not checked out to you' })
    }
    
    const { data, error } = await request.supabase!
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
          content: { type: 'string', description: 'Base64 encoded file content' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { vault_id, file_path, file_name, extension, content } = 
      request.body as { vault_id: string; file_path: string; file_name: string; extension?: string; content: string }
    
    // Verify vault
    const { data: vault, error: vaultError } = await request.supabase!
      .from('vaults')
      .select('id')
      .eq('id', vault_id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (vaultError || !vault) {
      return reply.code(404).send({ error: 'Not found', message: 'Vault not found' })
    }
    
    const binaryContent = Buffer.from(content, 'base64')
    const contentHash = computeHash(binaryContent)
    const fileSize = binaryContent.length
    const fileType = getFileTypeFromExtension(extension || '')
    
    // Upload to storage
    const storagePath = `${request.user!.org_id}/${contentHash.substring(0, 2)}/${contentHash}`
    await request.supabase!.storage
      .from('vault')
      .upload(storagePath, binaryContent, {
        contentType: 'application/octet-stream',
        upsert: false
      }).catch(() => {})
    
    // Check existing
    const { data: existing } = await request.supabase!
      .from('files')
      .select('id, version')
      .eq('vault_id', vault_id)
      .eq('file_path', file_path)
      .is('deleted_at', null)
      .single()
    
    let result: { file: unknown; isNew: boolean }
    
    if (existing) {
      const { data, error } = await request.supabase!
        .from('files')
        .update({
          content_hash: contentHash,
          file_size: fileSize,
          version: existing.version + 1,
          updated_at: new Date().toISOString(),
          updated_by: request.user!.id
        })
        .eq('id', existing.id)
        .select()
        .single()
      
      if (error) throw error
      result = { file: data, isNew: false }
    } else {
      const { data, error } = await request.supabase!
        .from('files')
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
          revision: 'A',
          version: 1,
          created_by: request.user!.id,
          updated_by: request.user!.id
        })
        .select()
        .single()
      
      if (error) throw error
      
      await request.supabase!.from('file_versions').insert({
        file_id: data.id,
        version: 1,
        revision: 'A',
        content_hash: contentHash,
        file_size: fileSize,
        state: 'not_tracked',
        created_by: request.user!.id
      })
      
      result = { file: data, isNew: true }
    }
    
    // Trigger webhook
    await triggerWebhooks(request.user!.org_id!, 'file.sync', {
      file_id: (result.file as { id: string }).id,
      file_path,
      file_name,
      is_new: result.isNew,
      user_id: request.user!.id,
      user_email: request.user!.email
    }, fastify.log)
    
    return { success: true, ...result }
  })

  // ============================================
  // Download Routes
  // ============================================
  
  fastify.get('/files/:id/download', {
    schema: {
      description: 'Get a signed download URL for a file (URL expires in 1 hour)',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      querystring: {
        type: 'object',
        properties: {
          version: { type: 'integer', description: 'Specific version to download' }
        }
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
            expires_in: { type: 'integer', description: 'Seconds until URL expires' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { version } = request.query as { version?: number }
    
    const { data: file, error: fetchError } = await request.supabase!
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    let contentHash = file.content_hash
    let fileSize = file.file_size
    
    if (version && version !== file.version) {
      const { data: versionData } = await request.supabase!
        .from('file_versions')
        .select('content_hash, file_size')
        .eq('file_id', id)
        .eq('version', version)
        .single()
      
      if (!versionData) {
        return reply.code(404).send({ error: 'Not found', message: 'Version not found' })
      }
      contentHash = versionData.content_hash
      fileSize = versionData.file_size
    }
    
    const storagePath = `${request.user!.org_id}/${contentHash.substring(0, 2)}/${contentHash}`
    
    // Create signed URL for direct download from Supabase Storage
    const { data, error } = await request.supabase!.storage
      .from('vault')
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY, {
        download: file.file_name // Sets Content-Disposition header
      })
    
    if (error) throw error
    
    return {
      file_id: id,
      file_name: file.file_name,
      file_size: fileSize,
      content_hash: contentHash,
      download_url: data.signedUrl,
      expires_in: SIGNED_URL_EXPIRY
    }
  })

  // ============================================
  // Version History Routes
  // ============================================
  
  fastify.get('/files/:id/versions', {
    schema: {
      description: 'Get file version history',
      tags: ['Versions'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { id } = request.params as { id: string }
    
    const { data, error } = await request.supabase!
      .from('file_versions')
      .select(`
        *,
        created_by_user:users!created_by(email, full_name)
      `)
      .eq('file_id', id)
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
      tags: ['Trash'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          vault_id: { type: 'string', format: 'uuid' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { vault_id } = request.query as { vault_id?: string }
    
    let query = request.supabase!
      .from('files')
      .select(`
        id, file_path, file_name, extension, deleted_at, deleted_by,
        deleted_by_user:users!deleted_by(email, full_name)
      `)
      .eq('org_id', request.user!.org_id)
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
      tags: ['Trash'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { id } = request.params as { id: string }
    
    const { data: file } = await request.supabase!
      .from('files')
      .select('file_path, file_name')
      .eq('id', id)
      .single()
    
    const { data, error } = await request.supabase!
      .from('files')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .select()
      .single()
    
    if (error) throw error
    
    // Trigger webhook
    await triggerWebhooks(request.user!.org_id!, 'file.restore', {
      file_id: id,
      file_path: file?.file_path,
      file_name: file?.file_name,
      user_id: request.user!.id,
      user_email: request.user!.email
    }, fastify.log)
    
    return { success: true, file: data }
  })
  
  fastify.delete('/files/:id', {
    schema: {
      description: 'Soft delete a file',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data: file, error: fetchError } = await request.supabase!
      .from('files')
      .select('id, file_path, file_name, checked_out_by')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (fetchError) throw fetchError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by && file.checked_out_by !== request.user!.id) {
      return reply.code(409).send({ error: 'Conflict', message: 'Cannot delete file checked out by another user' })
    }
    
    const { error } = await request.supabase!
      .from('files')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: request.user!.id
      })
      .eq('id', id)
    
    if (error) throw error
    
    // Trigger webhook
    await triggerWebhooks(request.user!.org_id!, 'file.delete', {
      file_id: id,
      file_path: file.file_path,
      file_name: file.file_name,
      user_id: request.user!.id,
      user_email: request.user!.email
    }, fastify.log)
    
    return { success: true }
  })

  // ============================================
  // Activity Routes
  // ============================================
  
  fastify.get('/activity', {
    schema: {
      description: 'Get recent activity',
      tags: ['Activity'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          file_id: { type: 'string', format: 'uuid' },
          limit: { type: 'integer', default: 50 }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { file_id, limit = 50 } = request.query as { file_id?: string; limit?: number }
    
    let query = request.supabase!
      .from('activity')
      .select(`
        *,
        file:files(file_name, file_path),
        user:users(email, full_name)
      `)
      .eq('org_id', request.user!.org_id)
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
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          mine_only: { type: 'boolean' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { mine_only } = request.query as { mine_only?: boolean }
    
    let query = request.supabase!
      .from('files')
      .select(`
        id, file_path, file_name, checked_out_at, lock_message,
        checked_out_user:users!checked_out_by(id, email, full_name)
      `)
      .eq('org_id', request.user!.org_id)
      .not('checked_out_by', 'is', null)
      .order('checked_out_at', { ascending: false })
    
    if (mine_only) {
      query = query.eq('checked_out_by', request.user!.id)
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
      description: 'Update file metadata (state)',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
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
    const { id } = request.params as { id: string }
    const { state } = request.body as { state?: FileRecord['state'] }
    
    // Get current file for webhook
    const { data: currentFile } = await request.supabase!
      .from('files')
      .select('file_path, file_name, state')
      .eq('id', id)
      .single()
    
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: request.user!.id
    }
    
    if (state) {
      updateData.state = state
      updateData.state_changed_at = new Date().toISOString()
      updateData.state_changed_by = request.user!.id
    }
    
    const { data, error } = await request.supabase!
      .from('files')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .select()
      .single()
    
    if (error) throw error
    
    // Trigger webhook if state changed
    if (state && currentFile?.state !== state) {
      await triggerWebhooks(request.user!.org_id!, 'file.state_change', {
        file_id: id,
        file_path: currentFile?.file_path,
        file_name: currentFile?.file_name,
        old_state: currentFile?.state,
        new_state: state,
        user_id: request.user!.id,
        user_email: request.user!.email
      }, fastify.log)
    }
    
    return { success: true, file: data }
  })

  // ============================================
  // Quick State Change Routes (ERP-friendly)
  // ============================================
  
  fastify.post('/files/:id/release', {
    schema: {
      description: 'Quick release: Change file state to "released"',
      tags: ['ERP'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            file: schemas.file,
            previous_state: { type: 'string' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data: currentFile } = await request.supabase!
      .from('files')
      .select('file_path, file_name, state, checked_out_by')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (!currentFile) {
      return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    }
    
    if (currentFile.checked_out_by) {
      return reply.code(409).send({ error: 'Conflict', message: 'Cannot release a checked out file' })
    }
    
    if (currentFile.state === 'released') {
      return reply.code(400).send({ error: 'Already released', message: 'File is already in released state' })
    }
    
    const { data, error } = await request.supabase!
      .from('files')
      .update({
        state: 'released',
        state_changed_at: new Date().toISOString(),
        state_changed_by: request.user!.id,
        updated_at: new Date().toISOString(),
        updated_by: request.user!.id
      })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    // Trigger webhook
    await triggerWebhooks(request.user!.org_id!, 'file.state_change', {
      file_id: id,
      file_path: currentFile.file_path,
      file_name: currentFile.file_name,
      old_state: currentFile.state,
      new_state: 'released',
      user_id: request.user!.id,
      user_email: request.user!.email
    }, fastify.log)
    
    return { success: true, file: data, previous_state: currentFile.state }
  })
  
  fastify.post('/files/:id/obsolete', {
    schema: {
      description: 'Quick obsolete: Change file state to "obsolete"',
      tags: ['ERP'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data: currentFile } = await request.supabase!
      .from('files')
      .select('file_path, file_name, state, checked_out_by')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (!currentFile) {
      return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    }
    
    if (currentFile.checked_out_by) {
      return reply.code(409).send({ error: 'Conflict', message: 'Cannot obsolete a checked out file' })
    }
    
    const { data, error } = await request.supabase!
      .from('files')
      .update({
        state: 'obsolete',
        state_changed_at: new Date().toISOString(),
        state_changed_by: request.user!.id,
        updated_at: new Date().toISOString(),
        updated_by: request.user!.id
      })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    await triggerWebhooks(request.user!.org_id!, 'file.state_change', {
      file_id: id,
      file_path: currentFile.file_path,
      file_name: currentFile.file_name,
      old_state: currentFile.state,
      new_state: 'obsolete',
      user_id: request.user!.id,
      user_email: request.user!.email
    }, fastify.log)
    
    return { success: true, file: data, previous_state: currentFile.state }
  })

  // ============================================
  // ERP Integration Routes
  // ============================================
  
  fastify.get('/parts', {
    schema: {
      description: 'List parts (files with part numbers). Ideal for ERP integration.',
      tags: ['ERP'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          vault_id: { type: 'string', format: 'uuid' },
          state: { type: 'string', enum: ['not_tracked', 'wip', 'in_review', 'released', 'obsolete'] },
          released_only: { type: 'boolean', description: 'Only return released parts' },
          search: { type: 'string', description: 'Search by part number' },
          limit: { type: 'integer', default: 100 },
          offset: { type: 'integer', default: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            parts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  part_number: { type: 'string' },
                  file_name: { type: 'string' },
                  file_path: { type: 'string' },
                  description: { type: ['string', 'null'] },
                  revision: { type: 'string' },
                  version: { type: 'integer' },
                  state: { type: 'string' },
                  file_type: { type: 'string' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { vault_id, state, released_only, search, limit = 100, offset = 0 } = 
      request.query as Record<string, string | number | boolean | undefined>
    
    let query = request.supabase!
      .from('files')
      .select('id, part_number, file_name, file_path, description, revision, version, state, file_type')
      .eq('org_id', request.user!.org_id)
      .is('deleted_at', null)
      .not('part_number', 'is', null) // Only files with part numbers
      .order('part_number')
      .range(offset as number, (offset as number) + (limit as number) - 1)
    
    if (vault_id) query = query.eq('vault_id', vault_id)
    if (state) query = query.eq('state', state)
    if (released_only) query = query.eq('state', 'released')
    if (search) query = query.ilike('part_number', `%${search}%`)
    
    const { data, error } = await query
    if (error) throw error
    
    return { parts: data, count: data?.length || 0 }
  })
  
  fastify.get('/bom/:id', {
    schema: {
      description: 'Get Bill of Materials for an assembly. Returns all child components.',
      tags: ['ERP'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      querystring: {
        type: 'object',
        properties: {
          recursive: { type: 'boolean', description: 'Include nested sub-assemblies', default: false },
          released_only: { type: 'boolean', description: 'Only include released components' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            assembly: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                part_number: { type: ['string', 'null'] },
                file_name: { type: 'string' },
                revision: { type: 'string' },
                state: { type: 'string' }
              }
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  part_number: { type: ['string', 'null'] },
                  file_name: { type: 'string' },
                  file_path: { type: 'string' },
                  revision: { type: 'string' },
                  state: { type: 'string' },
                  quantity: { type: 'integer' }
                }
              }
            },
            total_components: { type: 'integer' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { released_only } = request.query as { recursive?: boolean; released_only?: boolean }
    
    // Get the assembly
    const { data: assembly, error: assemblyError } = await request.supabase!
      .from('files')
      .select('id, part_number, file_name, file_path, revision, state, file_type')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (assemblyError) throw assemblyError
    if (!assembly) return reply.code(404).send({ error: 'Not found', message: 'Assembly not found' })
    
    // Get child components from file_references
    let query = request.supabase!
      .from('file_references')
      .select(`
        quantity,
        child:files!child_file_id(
          id, part_number, file_name, file_path, revision, state, file_type
        )
      `)
      .eq('parent_file_id', id)
    
    const { data: refs, error: refsError } = await query
    if (refsError) throw refsError
    
    let components = (refs || [])
      .filter(r => r.child)
      .map(r => ({
        ...(r.child as object),
        quantity: r.quantity || 1
      }))
    
    if (released_only) {
      components = components.filter((c: any) => c.state === 'released')
    }
    
    return {
      assembly: {
        id: assembly.id,
        part_number: assembly.part_number,
        file_name: assembly.file_name,
        revision: assembly.revision,
        state: assembly.state
      },
      components,
      total_components: components.length
    }
  })
  
  fastify.get('/files/:id/drawing', {
    schema: {
      description: 'Get the associated drawing for a part or assembly',
      tags: ['ERP'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
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
                expires_in: { type: 'integer' }
              }
            }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    // Get the source file
    const { data: sourceFile, error: sourceError } = await request.supabase!
      .from('files')
      .select('file_name, file_path, vault_id')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (sourceError) throw sourceError
    if (!sourceFile) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    // Look for drawing with similar name (common pattern: part.SLDPRT -> part.SLDDRW)
    const baseName = sourceFile.file_name.replace(/\.[^/.]+$/, '') // Remove extension
    
    const { data: drawings } = await request.supabase!
      .from('files')
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
    const { data: urlData } = await request.supabase!.storage
      .from('vault')
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY, {
        download: drawing.file_name
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
        expires_in: SIGNED_URL_EXPIRY
      }
    }
  })
  
  fastify.get('/files/:id/upload-url', {
    schema: {
      description: 'Get a signed upload URL for updating file content (direct to Supabase)',
      tags: ['Files'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            upload_url: { type: 'string' },
            storage_path: { type: 'string' },
            expires_in: { type: 'integer' },
            instructions: { type: 'string' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    // Verify file exists and is checked out to user
    const { data: file, error } = await request.supabase!
      .from('files')
      .select('id, checked_out_by')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (error) throw error
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    if (file.checked_out_by !== request.user!.id) {
      return reply.code(403).send({ 
        error: 'Forbidden', 
        message: 'File must be checked out to you before uploading' 
      })
    }
    
    // Generate a unique path for the upload
    const uploadId = crypto.randomUUID()
    const storagePath = `${request.user!.org_id}/uploads/${uploadId}`
    
    // Create signed upload URL
    const { data, error: urlError } = await request.supabase!.storage
      .from('vault')
      .createSignedUploadUrl(storagePath)
    
    if (urlError) throw urlError
    
    return {
      upload_url: data.signedUrl,
      storage_path: storagePath,
      expires_in: SIGNED_URL_EXPIRY,
      instructions: 'PUT your file content to upload_url, then call POST /files/:id/checkin with the storage_path'
    }
  })

  // ============================================
  // Supplier Routes
  // ============================================
  
  fastify.get('/suppliers', {
    schema: {
      description: 'List all suppliers in the organization',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          active_only: { type: 'boolean', description: 'Only return active suppliers' },
          approved_only: { type: 'boolean', description: 'Only return approved suppliers' },
          search: { type: 'string', description: 'Search by name or code' },
          limit: { type: 'integer', default: 100 },
          offset: { type: 'integer', default: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            suppliers: { type: 'array', items: schemas.supplier },
            count: { type: 'integer' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { active_only, approved_only, search, limit = 100, offset = 0 } = 
      request.query as Record<string, string | number | boolean | undefined>
    
    let query = request.supabase!
      .from('suppliers')
      .select('*')
      .eq('org_id', request.user!.org_id)
      .order('name')
      .range(offset as number, (offset as number) + (limit as number) - 1)
    
    if (active_only) query = query.eq('is_active', true)
    if (approved_only) query = query.eq('is_approved', true)
    if (search) query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    
    const { data, error } = await query
    if (error) throw error
    
    return { suppliers: data, count: data?.length || 0 }
  })
  
  fastify.get('/suppliers/:id', {
    schema: {
      description: 'Get supplier by ID',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    const { data, error } = await request.supabase!
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'Supplier not found' })
    
    return { supplier: data }
  })
  
  fastify.post('/suppliers', {
    schema: {
      description: 'Create a new supplier',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          code: { type: 'string' },
          contact_name: { type: 'string' },
          contact_email: { type: 'string' },
          contact_phone: { type: 'string' },
          website: { type: 'string' },
          address_line1: { type: 'string' },
          address_line2: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postal_code: { type: 'string' },
          country: { type: 'string' },
          payment_terms: { type: 'string' },
          default_lead_time_days: { type: 'integer' },
          min_order_value: { type: 'number' },
          currency: { type: 'string' },
          shipping_account: { type: 'string' },
          is_approved: { type: 'boolean' },
          notes: { type: 'string' },
          erp_id: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            supplier: schemas.supplier
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Viewers cannot create suppliers' })
    }
    
    const body = request.body as Partial<Supplier>
    
    const { data, error } = await request.supabase!
      .from('suppliers')
      .insert({
        ...body,
        org_id: request.user!.org_id,
        created_by: request.user!.id,
        updated_by: request.user!.id
      })
      .select()
      .single()
    
    if (error) throw error
    return { success: true, supplier: data }
  })
  
  fastify.patch('/suppliers/:id', {
    schema: {
      description: 'Update a supplier',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          code: { type: 'string' },
          contact_name: { type: 'string' },
          contact_email: { type: 'string' },
          contact_phone: { type: 'string' },
          website: { type: 'string' },
          address_line1: { type: 'string' },
          address_line2: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postal_code: { type: 'string' },
          country: { type: 'string' },
          payment_terms: { type: 'string' },
          default_lead_time_days: { type: 'integer' },
          min_order_value: { type: 'number' },
          currency: { type: 'string' },
          shipping_account: { type: 'string' },
          is_active: { type: 'boolean' },
          is_approved: { type: 'boolean' },
          notes: { type: 'string' },
          erp_id: { type: 'string' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Viewers cannot update suppliers' })
    }
    
    const body = request.body as Partial<Supplier>
    
    const { data, error } = await request.supabase!
      .from('suppliers')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
        updated_by: request.user!.id
      })
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .select()
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'Supplier not found' })
    
    return { success: true, supplier: data }
  })
  
  fastify.delete('/suppliers/:id', {
    schema: {
      description: 'Delete a supplier (admin only)',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can delete suppliers' })
    }
    
    const { error } = await request.supabase!
      .from('suppliers')
      .delete()
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
    
    if (error) throw error
    return { success: true }
  })
  
  // ============================================
  // Part-Supplier Routes (Costing/Pricing)
  // ============================================
  
  fastify.get('/files/:id/suppliers', {
    schema: {
      description: 'Get all suppliers and pricing for a part',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            file_id: { type: 'string' },
            part_number: { type: ['string', 'null'] },
            file_name: { type: 'string' },
            suppliers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  supplier: schemas.supplier,
                  supplier_part_number: { type: ['string', 'null'] },
                  supplier_description: { type: ['string', 'null'] },
                  supplier_url: { type: ['string', 'null'] },
                  unit_price: { type: ['number', 'null'] },
                  currency: { type: 'string' },
                  price_unit: { type: 'string' },
                  price_breaks: { type: 'array' },
                  min_order_qty: { type: 'integer' },
                  lead_time_days: { type: ['integer', 'null'] },
                  is_preferred: { type: 'boolean' },
                  is_qualified: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    // Get file info
    const { data: file, error: fileError } = await request.supabase!
      .from('files')
      .select('id, file_name, part_number')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (fileError) throw fileError
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    // Get suppliers for this part
    const { data: partSuppliers, error } = await request.supabase!
      .from('part_suppliers')
      .select(`
        id, supplier_part_number, supplier_description, supplier_url,
        unit_price, currency, price_unit, price_breaks,
        min_order_qty, order_multiple, lead_time_days,
        is_preferred, is_active, is_qualified, notes,
        supplier:suppliers(*)
      `)
      .eq('file_id', id)
      .eq('is_active', true)
      .order('is_preferred', { ascending: false })
    
    if (error) throw error
    
    return {
      file_id: file.id,
      part_number: file.part_number,
      file_name: file.file_name,
      suppliers: partSuppliers
    }
  })
  
  fastify.post('/files/:id/suppliers', {
    schema: {
      description: 'Link a supplier to a part with pricing info',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        required: ['supplier_id'],
        properties: {
          supplier_id: { type: 'string', format: 'uuid' },
          supplier_part_number: { type: 'string' },
          supplier_description: { type: 'string' },
          supplier_url: { type: 'string' },
          unit_price: { type: 'number' },
          currency: { type: 'string' },
          price_unit: { type: 'string' },
          price_breaks: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                qty: { type: 'integer' },
                price: { type: 'number' }
              }
            }
          },
          min_order_qty: { type: 'integer' },
          order_multiple: { type: 'integer' },
          lead_time_days: { type: 'integer' },
          is_preferred: { type: 'boolean' },
          notes: { type: 'string' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Viewers cannot link suppliers' })
    }
    
    const body = request.body as Partial<PartSupplier> & { supplier_id: string }
    
    // Verify file exists
    const { data: file } = await request.supabase!
      .from('files')
      .select('id')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (!file) return reply.code(404).send({ error: 'Not found', message: 'File not found' })
    
    // If marking as preferred, unmark others
    if (body.is_preferred) {
      await request.supabase!
        .from('part_suppliers')
        .update({ is_preferred: false })
        .eq('file_id', id)
    }
    
    const { data, error } = await request.supabase!
      .from('part_suppliers')
      .insert({
        ...body,
        org_id: request.user!.org_id,
        file_id: id,
        created_by: request.user!.id,
        updated_by: request.user!.id
      })
      .select(`
        *,
        supplier:suppliers(*)
      `)
      .single()
    
    if (error) throw error
    return { success: true, part_supplier: data }
  })
  
  fastify.patch('/files/:id/suppliers/:supplierId', {
    schema: {
      description: 'Update supplier pricing/info for a part',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { 
          id: { type: 'string', format: 'uuid' },
          supplierId: { type: 'string', format: 'uuid' }
        }
      },
      body: {
        type: 'object',
        properties: {
          supplier_part_number: { type: 'string' },
          supplier_description: { type: 'string' },
          supplier_url: { type: 'string' },
          unit_price: { type: 'number' },
          currency: { type: 'string' },
          price_unit: { type: 'string' },
          price_breaks: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                qty: { type: 'integer' },
                price: { type: 'number' }
              }
            }
          },
          min_order_qty: { type: 'integer' },
          order_multiple: { type: 'integer' },
          lead_time_days: { type: 'integer' },
          is_preferred: { type: 'boolean' },
          is_active: { type: 'boolean' },
          is_qualified: { type: 'boolean' },
          notes: { type: 'string' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id, supplierId } = request.params as { id: string; supplierId: string }
    
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Viewers cannot update supplier info' })
    }
    
    const body = request.body as Partial<PartSupplier>
    
    // If marking as preferred, unmark others
    if (body.is_preferred) {
      await request.supabase!
        .from('part_suppliers')
        .update({ is_preferred: false })
        .eq('file_id', id)
        .neq('supplier_id', supplierId)
    }
    
    const { data, error } = await request.supabase!
      .from('part_suppliers')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
        updated_by: request.user!.id,
        last_price_update: body.unit_price !== undefined ? new Date().toISOString() : undefined
      })
      .eq('file_id', id)
      .eq('supplier_id', supplierId)
      .eq('org_id', request.user!.org_id)
      .select(`
        *,
        supplier:suppliers(*)
      `)
      .single()
    
    if (error) throw error
    if (!data) return reply.code(404).send({ error: 'Not found', message: 'Part-supplier link not found' })
    
    return { success: true, part_supplier: data }
  })
  
  fastify.delete('/files/:id/suppliers/:supplierId', {
    schema: {
      description: 'Remove supplier from a part',
      tags: ['Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { 
          id: { type: 'string', format: 'uuid' },
          supplierId: { type: 'string', format: 'uuid' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id, supplierId } = request.params as { id: string; supplierId: string }
    
    if (request.user!.role === 'viewer') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Viewers cannot remove suppliers' })
    }
    
    const { error } = await request.supabase!
      .from('part_suppliers')
      .delete()
      .eq('file_id', id)
      .eq('supplier_id', supplierId)
      .eq('org_id', request.user!.org_id)
    
    if (error) throw error
    return { success: true }
  })
  
  // ============================================
  // ERP Costing Routes
  // ============================================
  
  fastify.get('/parts/:id/costing', {
    schema: {
      description: 'Get complete costing info for a part including all suppliers and volume pricing',
      tags: ['ERP', 'Suppliers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      querystring: {
        type: 'object',
        properties: {
          quantity: { type: 'integer', default: 1, description: 'Quantity to calculate pricing for' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            part: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                part_number: { type: ['string', 'null'] },
                file_name: { type: 'string' },
                description: { type: ['string', 'null'] },
                revision: { type: 'string' },
                state: { type: 'string' }
              }
            },
            quantity: { type: 'integer' },
            preferred_supplier: {
              type: 'object',
              nullable: true,
              properties: {
                supplier_id: { type: 'string' },
                supplier_name: { type: 'string' },
                supplier_code: { type: ['string', 'null'] },
                supplier_part_number: { type: ['string', 'null'] },
                unit_price: { type: ['number', 'null'] },
                total_price: { type: ['number', 'null'] },
                currency: { type: 'string' },
                lead_time_days: { type: ['integer', 'null'] }
              }
            },
            lowest_cost: {
              type: 'object',
              nullable: true,
              properties: {
                supplier_id: { type: 'string' },
                supplier_name: { type: 'string' },
                supplier_code: { type: ['string', 'null'] },
                unit_price: { type: 'number' },
                total_price: { type: 'number' },
                currency: { type: 'string' }
              }
            },
            all_suppliers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  supplier_id: { type: 'string' },
                  supplier_name: { type: 'string' },
                  supplier_code: { type: ['string', 'null'] },
                  supplier_part_number: { type: ['string', 'null'] },
                  unit_price: { type: ['number', 'null'] },
                  total_price: { type: ['number', 'null'] },
                  currency: { type: 'string' },
                  lead_time_days: { type: ['integer', 'null'] },
                  is_preferred: { type: 'boolean' },
                  price_breaks: { type: 'array' }
                }
              }
            }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { quantity = 1 } = request.query as { quantity?: number }
    
    // Get part info
    const { data: part, error: partError } = await request.supabase!
      .from('files')
      .select('id, part_number, file_name, description, revision, state')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (partError) throw partError
    if (!part) return reply.code(404).send({ error: 'Not found', message: 'Part not found' })
    
    // Get all suppliers with pricing
    const { data: partSuppliers, error } = await request.supabase!
      .from('part_suppliers')
      .select(`
        supplier_id, supplier_part_number, unit_price, currency,
        price_breaks, lead_time_days, is_preferred,
        supplier:suppliers(id, name, code, default_lead_time_days)
      `)
      .eq('file_id', id)
      .eq('is_active', true)
    
    if (error) throw error
    
    // Calculate prices at quantity
    const suppliersWithPricing = (partSuppliers || []).map((ps: any) => {
      let effectivePrice = ps.unit_price
      
      // Check price breaks for volume pricing
      if (ps.price_breaks && Array.isArray(ps.price_breaks) && ps.price_breaks.length > 0) {
        const sortedBreaks = [...ps.price_breaks].sort((a: PriceBreak, b: PriceBreak) => b.qty - a.qty)
        for (const pb of sortedBreaks) {
          if (quantity >= pb.qty) {
            effectivePrice = pb.price
            break
          }
        }
      }
      
      return {
        supplier_id: ps.supplier_id,
        supplier_name: ps.supplier?.name,
        supplier_code: ps.supplier?.code,
        supplier_part_number: ps.supplier_part_number,
        unit_price: effectivePrice,
        total_price: effectivePrice ? effectivePrice * quantity : null,
        currency: ps.currency,
        lead_time_days: ps.lead_time_days || ps.supplier?.default_lead_time_days,
        is_preferred: ps.is_preferred,
        price_breaks: ps.price_breaks || []
      }
    })
    
    // Find preferred and lowest cost
    const preferred = suppliersWithPricing.find((s: any) => s.is_preferred)
    const withPrices = suppliersWithPricing.filter((s: any) => s.unit_price !== null)
    const lowest = withPrices.length > 0 
      ? withPrices.reduce((min: any, s: any) => s.unit_price < min.unit_price ? s : min)
      : null
    
    return {
      part: {
        id: part.id,
        part_number: part.part_number,
        file_name: part.file_name,
        description: part.description,
        revision: part.revision,
        state: part.state
      },
      quantity,
      preferred_supplier: preferred || null,
      lowest_cost: lowest,
      all_suppliers: suppliersWithPricing
    }
  })
  
  fastify.get('/suppliers/:id/parts', {
    schema: {
      description: 'List all parts available from a specific supplier',
      tags: ['Suppliers', 'ERP'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 100 },
          offset: { type: 'integer', default: 0 }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { limit = 100, offset = 0 } = request.query as { limit?: number; offset?: number }
    
    // Verify supplier exists
    const { data: supplier, error: supplierError } = await request.supabase!
      .from('suppliers')
      .select('id, name, code')
      .eq('id', id)
      .eq('org_id', request.user!.org_id)
      .single()
    
    if (supplierError) throw supplierError
    if (!supplier) return reply.code(404).send({ error: 'Not found', message: 'Supplier not found' })
    
    // Get parts from this supplier
    const { data, error } = await request.supabase!
      .from('part_suppliers')
      .select(`
        supplier_part_number, unit_price, currency, lead_time_days, is_preferred,
        file:files(id, part_number, file_name, description, revision, state, file_type)
      `)
      .eq('supplier_id', id)
      .eq('is_active', true)
      .range(offset, offset + limit - 1)
    
    if (error) throw error
    
    return {
      supplier,
      parts: data,
      count: data?.length || 0
    }
  })

  // ============================================
  // Odoo Integration Routes
  // ============================================

  // Get Odoo integration settings
  fastify.get('/integrations/odoo', {
    schema: {
      description: 'Get Odoo integration settings',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            configured: { type: 'boolean' },
            settings: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                database: { type: 'string' },
                username: { type: 'string' }
              }
            },
            is_connected: { type: 'boolean' },
            last_sync_at: { type: 'string', nullable: true },
            last_sync_status: { type: 'string', nullable: true },
            last_sync_count: { type: 'number', nullable: true },
            auto_sync: { type: 'boolean' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' })
    }
    
    const { data, error } = await request.supabase!
      .from('organization_integrations')
      .select('*')
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
        username: data.settings?.username
      },
      is_connected: data.is_connected,
      last_sync_at: data.last_sync_at,
      last_sync_status: data.last_sync_status,
      last_sync_count: data.last_sync_count,
      auto_sync: data.auto_sync
    }
  })

  // Configure Odoo integration
  fastify.post('/integrations/odoo', {
    schema: {
      description: 'Configure Odoo integration',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url', 'database', 'username', 'api_key'],
        properties: {
          url: { type: 'string', description: 'Odoo instance URL (e.g., https://mycompany.odoo.com)' },
          database: { type: 'string', description: 'Odoo database name' },
          username: { type: 'string', description: 'Odoo username (email)' },
          api_key: { type: 'string', description: 'Odoo API key' },
          auto_sync: { type: 'boolean', default: false },
          skip_test: { type: 'boolean', default: false, description: 'Save without testing connection' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' })
    }
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can configure integrations' })
    }
    
    const { url, database, username, api_key, auto_sync, skip_test } = request.body as {
      url: string
      database: string
      username: string
      api_key: string
      auto_sync?: boolean
      skip_test?: boolean
    }
    
    // Normalize URL (add https:// if missing)
    const normalizedUrl = normalizeOdooUrl(url)
    
    let isConnected = false
    let connectionError: string | null = null
    
    // Test connection to Odoo (unless skip_test is true)
    if (!skip_test) {
      try {
        const testResult = await testOdooConnection(normalizedUrl, database, username, api_key)
        if (testResult.success) {
          isConnected = true
        } else {
          connectionError = testResult.error || 'Connection failed'
        }
      } catch (err) {
        connectionError = String(err)
      }
    }
    
    // Always save the settings (even if connection failed)
    const { error } = await request.supabase!
      .from('organization_integrations')
      .upsert({
        org_id: request.user.org_id,
        integration_type: 'odoo',
        settings: { url: normalizedUrl, database, username },
        credentials_encrypted: api_key, // In production, encrypt this
        is_active: true,
        is_connected: isConnected,
        last_connected_at: isConnected ? new Date().toISOString() : null,
        last_error: connectionError,
        auto_sync: auto_sync || false,
        updated_by: request.user.id
      }, {
        onConflict: 'org_id,integration_type'
      })
    
    if (error) throw error
    
    if (skip_test) {
      return { success: true, message: 'Odoo credentials saved (connection not tested)' }
    } else if (isConnected) {
      return { success: true, message: 'Odoo integration configured and connected!' }
    } else {
      return { success: true, message: `Credentials saved but connection failed: ${connectionError}`, connection_error: connectionError }
    }
  })

  // Test Odoo connection
  fastify.post('/integrations/odoo/test', {
    schema: {
      description: 'Test Odoo connection',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url', 'database', 'username', 'api_key'],
        properties: {
          url: { type: 'string' },
          database: { type: 'string' },
          username: { type: 'string' },
          api_key: { type: 'string' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { url, database, username, api_key } = request.body as {
      url: string
      database: string
      username: string
      api_key: string
    }
    
    const result = await testOdooConnection(url, database, username, api_key)
    
    if (!result.success) {
      return reply.code(400).send({ success: false, error: result.error })
    }
    
    return { success: true, user_name: result.user_name, version: result.version }
  })

  // Sync suppliers from Odoo
  fastify.post('/integrations/odoo/sync/suppliers', {
    schema: {
      description: 'Sync suppliers from Odoo',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            created: { type: 'number' },
            updated: { type: 'number' },
            skipped: { type: 'number' },
            errors: { type: 'number' },
            message: { type: 'string' },
            debug: { type: 'object', additionalProperties: true }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' })
    }
    if (request.user.role !== 'admin' && request.user.role !== 'engineer') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only admins and engineers can sync' })
    }
    
    // Get Odoo integration settings
    const { data: integration, error: intError } = await request.supabase!
      .from('organization_integrations')
      .select('*')
      .eq('org_id', request.user.org_id)
      .eq('integration_type', 'odoo')
      .single()
    
    if (intError || !integration) {
      return reply.code(400).send({ error: 'Not configured', message: 'Odoo integration not configured' })
    }
    
    // Fetch suppliers from Odoo
    const odooSuppliers = await fetchOdooSuppliers(
      integration.settings.url,
      integration.settings.database,
      integration.settings.username,
      integration.credentials_encrypted
    )
    
    if (!odooSuppliers.success) {
      // Update integration status with error
      await request.supabase!
        .from('organization_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_message: odooSuppliers.error,
          last_error: odooSuppliers.error
        })
        .eq('id', integration.id)
      
      return reply.code(400).send({ 
        error: 'Sync failed', 
        message: odooSuppliers.error,
        debug: odooSuppliers.debug  // Include debug info in error response
      })
    }
    
    // Safety check - ensure suppliers is an array
    const suppliers = Array.isArray(odooSuppliers.suppliers) ? odooSuppliers.suppliers : []
    
    if (suppliers.length === 0) {
      const queryUsed = odooSuppliers.debug?.supplier_ids_type || 'unknown'
      return { 
        success: true, 
        created: 0, 
        updated: 0, 
        skipped: 0, 
        errors: 0,
        message: `No suppliers found in Odoo (tried: ${queryUsed})`,
        debug: odooSuppliers.debug
      }
    }
    
    // Process suppliers
    let created = 0, updated = 0, skipped = 0, errors = 0
    
    for (const odooSupplier of suppliers) {
      try {
        // Check if supplier already exists by erp_id
        const { data: existing } = await request.supabase!
          .from('suppliers')
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
          address_line2: odooSupplier.street2 || null,
          city: odooSupplier.city || null,
          state: odooSupplier.state_id?.[1] || null,
          postal_code: odooSupplier.zip || null,
          country: odooSupplier.country_id?.[1] || 'USA',
          is_active: odooSupplier.active !== false,
          is_approved: true,  // Auto-approve synced suppliers from Odoo
          erp_id: String(odooSupplier.id),
          erp_synced_at: new Date().toISOString(),
          updated_by: request.user.id
        }
        
        if (existing) {
          // Update existing supplier
          await request.supabase!
            .from('suppliers')
            .update(supplierData)
            .eq('id', existing.id)
          updated++
        } else {
          // Create new supplier
          await request.supabase!
            .from('suppliers')
            .insert({
              ...supplierData,
              created_by: request.user.id
            })
          created++
        }
      } catch (err) {
        console.error('Error syncing supplier:', odooSupplier.name, err)
        errors++
      }
    }
    
    // Update integration status
    await request.supabase!
      .from('organization_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: errors > 0 ? 'partial' : 'success',
        last_sync_count: created + updated,
        last_sync_message: `Created: ${created}, Updated: ${updated}, Errors: ${errors}`
      })
      .eq('id', integration.id)
    
    // Log the sync
    await request.supabase!
      .from('integration_sync_log')
      .insert({
        org_id: request.user.org_id,
        integration_id: integration.id,
        sync_type: 'suppliers',
        sync_direction: 'pull',
        status: errors > 0 ? 'partial' : 'success',
        completed_at: new Date().toISOString(),
        records_processed: odooSuppliers.suppliers.length,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        records_errored: errors,
        triggered_by: request.user.id,
        trigger_type: 'manual'
      })
    
    return {
      success: true,
      created,
      updated,
      skipped,
      errors,
      message: `Synced ${created + updated} suppliers from Odoo`,
      debug: odooSuppliers.debug
    }
  })

  // Disconnect Odoo integration
  fastify.delete('/integrations/odoo', {
    schema: {
      description: 'Disconnect Odoo integration',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }]
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' })
    }
    if (request.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can disconnect integrations' })
    }
    
    const { error } = await request.supabase!
      .from('organization_integrations')
      .update({
        is_active: false,
        is_connected: false,
        credentials_encrypted: null,
        updated_by: request.user.id
      })
      .eq('org_id', request.user.org_id)
      .eq('integration_type', 'odoo')
    
    if (error) throw error
    
    return { success: true, message: 'Odoo integration disconnected' }
  })

  // ============================================
  // Webhook Routes
  // ============================================
  
  fastify.get('/webhooks', {
    schema: {
      description: 'List webhooks',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            webhooks: { type: 'array', items: schemas.webhook }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const orgWebhooks = webhooks.get(request.user!.org_id!) || []
    // Return without secrets
    return { 
      webhooks: orgWebhooks.map(w => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        created_at: w.created_at
      }))
    }
  })
  
  fastify.post('/webhooks', {
    schema: {
      description: 'Create a webhook',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { 
            type: 'array',
            items: { 
              type: 'string',
              enum: ['file.checkout', 'file.checkin', 'file.sync', 'file.delete', 'file.restore', 'file.state_change', 'file.version']
            },
            minItems: 1
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            webhook: schemas.webhook,
            secret: { type: 'string', description: 'Webhook secret (only shown once)' }
          }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request) => {
    const { url, events } = request.body as { url: string; events: WebhookEvent[] }
    
    // Only admins can create webhooks
    if (request.user!.role !== 'admin') {
      throw { statusCode: 403, message: 'Only admins can create webhooks' }
    }
    
    const webhook: Webhook = {
      id: crypto.randomUUID(),
      org_id: request.user!.org_id!,
      url,
      secret: generateWebhookSecret(),
      events,
      active: true,
      created_at: new Date().toISOString(),
      created_by: request.user!.id
    }
    
    const orgWebhooks = webhooks.get(request.user!.org_id!) || []
    orgWebhooks.push(webhook)
    webhooks.set(request.user!.org_id!, orgWebhooks)
    
    return { 
      success: true,
      webhook: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        created_at: webhook.created_at
      },
      secret: webhook.secret // Only returned on creation
    }
  })
  
  fastify.delete('/webhooks/:id', {
    schema: {
      description: 'Delete a webhook',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can delete webhooks' })
    }
    
    const orgWebhooks = webhooks.get(request.user!.org_id!) || []
    const index = orgWebhooks.findIndex(w => w.id === id)
    
    if (index === -1) {
      return reply.code(404).send({ error: 'Not found', message: 'Webhook not found' })
    }
    
    orgWebhooks.splice(index, 1)
    webhooks.set(request.user!.org_id!, orgWebhooks)
    
    return { success: true }
  })
  
  fastify.patch('/webhooks/:id', {
    schema: {
      description: 'Update a webhook',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { 
            type: 'array',
            items: { type: 'string' }
          },
          active: { type: 'boolean' }
        }
      }
    },
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const updates = request.body as Partial<Webhook>
    
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only admins can update webhooks' })
    }
    
    const orgWebhooks = webhooks.get(request.user!.org_id!) || []
    const webhook = orgWebhooks.find(w => w.id === id)
    
    if (!webhook) {
      return reply.code(404).send({ error: 'Not found', message: 'Webhook not found' })
    }
    
    if (updates.url) webhook.url = updates.url
    if (updates.events) webhook.events = updates.events as WebhookEvent[]
    if (updates.active !== undefined) webhook.active = updates.active
    
    return { 
      success: true,
      webhook: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        created_at: webhook.created_at
      }
    }
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
  
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Not Found', message: 'Endpoint not found' })
  })

  return fastify
}

// ============================================
// Start Server
// ============================================

async function start(): Promise<void> {
  try {
    const server = await buildServer()
    await server.listen({ port: PORT, host: HOST })
    
    const versionLine = `BluePLM REST API v${API_VERSION}`.padStart(35).padEnd(55)
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ${versionLine}   ║
╠══════════════════════════════════════════════════════════════╣
║  Server:    http://${HOST}:${PORT.toString().padEnd(38)}║
║  Docs:      http://${HOST}:${PORT}/docs${''.padEnd(30)}║
║  Supabase:  ${SUPABASE_URL ? 'Configured ✓'.padEnd(45) : 'Not configured ✗'.padEnd(45)}║
╠══════════════════════════════════════════════════════════════╣
║  Features:                                                   ║
║    ✓ OpenAPI/Swagger documentation                           ║
║    ✓ Rate limiting (${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW/1000}s)${' '.repeat(30)}║
║    ✓ Webhook support                                         ║
║    ✓ JSON Schema validation                                  ║
╚══════════════════════════════════════════════════════════════╝
`)
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

start()

export { triggerWebhooks }

