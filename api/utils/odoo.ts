/**
 * Odoo XML-RPC Integration Helpers
 *
 * Provides functions for authenticating with Odoo and fetching supplier data
 * via the XML-RPC interface.
 */

import type { OdooSupplier, OdooFetchResult, OdooConnectionResult } from '../types.js'

// Store last XML responses for debugging
let lastXmlResponses: string[] = []

/**
 * Get recent XML responses for debugging
 */
export function getLastXmlResponses(): string[] {
  return lastXmlResponses
}

/**
 * Clear stored XML responses
 */
export function clearLastXmlResponses(): void {
  lastXmlResponses = []
}

/**
 * Options for a single XML-RPC call.
 */
export interface OdooXmlRpcOptions {
  /** Override the fetch implementation (used by tests). */
  fetch?: typeof globalThis.fetch
}

/**
 * Make an XML-RPC call to Odoo
 */
export async function odooXmlRpc(
  url: string,
  service: string,
  method: string,
  params: unknown[],
  options?: OdooXmlRpcOptions,
): Promise<unknown> {
  // Build XML-RPC request
  const xmlPayload = buildXmlRpcRequest(method, params)

  const target = `${url}/xmlrpc/2/${service}`
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xmlPayload,
    signal: AbortSignal.timeout(30000), // 30s timeout
  }
  const response = options?.fetch ? await options.fetch(target, init) : await fetch(target, init)

  if (!response.ok) {
    throw new Error(`Odoo API error: ${response.status} ${response.statusText}`)
  }

  const xmlResponse = await response.text()

  // Store for debugging (keep last 5, truncate to 300 chars each)
  lastXmlResponses.push(`${service}.${method}: ${xmlResponse.substring(0, 300)}...`)
  if (lastXmlResponses.length > 5) lastXmlResponses.shift()

  return parseXmlRpcResponse(xmlResponse)
}

/**
 * ORM methods that may be invoked through `execute_kw`.
 *
 * Allowlist, never a blocklist: anything not named here is rejected.
 */
export const ODOO_ALLOWED_ORM_METHODS = [
  'search',
  'search_read',
  'search_count',
  'read',
  'fields_get',
  'check_access_rights',
] as const

/**
 * Models that may be touched through `execute_kw`.
 */
export const ODOO_ALLOWED_MODELS = [
  'res.partner',
  'sale.order',
  'sale.order.line',
  'res.partner.category',
  'res.partner.industry',
] as const

/**
 * Non-`execute_kw` calls that are inherently read-only, as `service.method`.
 */
export const ODOO_ALLOWED_SERVICE_METHODS = ['common.version', 'common.authenticate'] as const

const SECURITY_PREFIX = '[SECURITY] Odoo read-only guard:'

/**
 * Make a read-only XML-RPC call to Odoo.
 *
 * The `method` argument of an ORM call is always the literal string `execute_kw`,
 * so allowlisting it would permit every write in existence. The real ORM method
 * lives inside the params array:
 *
 *   [database, uid, apiKey, model, ormMethod, args, kwargs?]
 *
 * which is why this validates `params[3]` (model) and `params[4]` (ORM method).
 * Throws before any HTTP request is made.
 */
export async function odooReadOnlyCall(
  url: string,
  service: string,
  method: string,
  params: unknown[],
  options?: OdooXmlRpcOptions,
): Promise<unknown> {
  assertOdooReadOnly(service, method, params)
  return odooXmlRpc(url, service, method, params, options)
}

/**
 * Throw unless the call is provably read-only. Exported for tests and for
 * callers that build a request before deciding to send it.
 */
export function assertOdooReadOnly(service: string, method: string, params: unknown[]): void {
  if (method !== 'execute_kw') {
    const serviceMethod = `${service}.${method}`
    if (!(ODOO_ALLOWED_SERVICE_METHODS as readonly string[]).includes(serviceMethod)) {
      throw new Error(
        `${SECURITY_PREFIX} call '${serviceMethod}' is not permitted. ` +
          `Allowed non-ORM calls: ${ODOO_ALLOWED_SERVICE_METHODS.join(', ')}.`,
      )
    }
    return
  }

  const model = params[3]
  const ormMethod = params[4]

  if (typeof ormMethod !== 'string') {
    throw new Error(
      `${SECURITY_PREFIX} execute_kw ORM method (params[4]) must be a string, got ${describe(ormMethod)}.`,
    )
  }
  if (!(ODOO_ALLOWED_ORM_METHODS as readonly string[]).includes(ormMethod)) {
    throw new Error(
      `${SECURITY_PREFIX} ORM method '${ormMethod}' is not permitted. ` +
        `Allowed ORM methods: ${ODOO_ALLOWED_ORM_METHODS.join(', ')}.`,
    )
  }

  if (typeof model !== 'string') {
    throw new Error(
      `${SECURITY_PREFIX} execute_kw model (params[3]) must be a string, got ${describe(model)}.`,
    )
  }
  if (!(ODOO_ALLOWED_MODELS as readonly string[]).includes(model)) {
    throw new Error(
      `${SECURITY_PREFIX} model '${model}' is not permitted. ` +
        `Allowed models: ${ODOO_ALLOWED_MODELS.join(', ')}.`,
    )
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  return `${typeof value} (${JSON.stringify(value)})`
}

/**
 * Build an XML-RPC request payload
 */
function buildXmlRpcRequest(method: string, params: unknown[]): string {
  const paramXml = params.map((p) => `<param>${valueToXml(p)}</param>`).join('')
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>${paramXml}</params>
</methodCall>`
}

const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

/**
 * Decode XML entities in text taken out of an XML-RPC response.
 *
 * Done in a single left-to-right pass rather than chained replaces: a chain
 * would rewrite `&amp;lt;` into `<` instead of the literal `&lt;` the sender
 * meant, no matter which order the replaces run in.
 */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(
    /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) return fromCodePoint(parseInt(dec, 10)) ?? match
      if (hex !== undefined) return fromCodePoint(parseInt(hex, 16)) ?? match
      const named = name !== undefined ? NAMED_ENTITIES.get(name) : undefined
      return named ?? match
    },
  )
}

function fromCodePoint(code: number): string | null {
  // Lone surrogates and out-of-range values would throw; leave them as-is.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null
  if (code >= 0xd800 && code <= 0xdfff) return null
  return String.fromCodePoint(code)
}

/**
 * Convert a JavaScript value to XML-RPC format
 */
export function valueToXml(value: unknown): string {
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
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<value><string>${escaped}</string></value>`
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => valueToXml(v)).join('')
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

/**
 * Parse an XML-RPC response
 */
export function parseXmlRpcResponse(xml: string): unknown {
  // Check for fault
  const faultMatch = xml.match(/<fault>[\s\S]*?<string>([^<]*)<\/string>[\s\S]*?<\/fault>/)
  if (faultMatch) {
    throw new Error(`Odoo fault: ${decodeXmlEntities(faultMatch[1])}`)
  }

  // Find the param value content
  const paramSection = xml.match(/<params>\s*<param>([\s\S]+)<\/param>\s*<\/params>/)
  if (!paramSection) {
    // Check if it's a simple response
    const simpleMatch = xml.match(/<value>[\s\S]*?<(int|boolean|string)>([^<]*)</)
    if (simpleMatch) {
      if (simpleMatch[1] === 'int') return parseInt(simpleMatch[2], 10)
      if (simpleMatch[1] === 'boolean') return simpleMatch[2] === '1'
      return decodeXmlEntities(simpleMatch[2])
    }
    throw new Error('Invalid XML-RPC response')
  }

  // Find the outer <value>...</value> in the param section
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

/**
 * Parse XML value content
 */
export function parseXmlValue(valueXml: string): unknown {
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
    const memberRegex =
      /<member>\s*<name>([^<]+)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g
    let match
    while ((match = memberRegex.exec(structMatch[1])) !== null) {
      obj[decodeXmlEntities(match[1])] = parseXmlValue(match[2])
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
  if (strMatch) return decodeXmlEntities(strMatch[1])

  // Double
  const doubleMatch = valueXml.match(/^\s*<double>([^<]+)<\/double>\s*$/)
  if (doubleMatch) return parseFloat(doubleMatch[1])

  // Empty content
  if (valueXml.match(/^\s*$/)) return ''

  // Default - return trimmed string (Odoo sends bare <value>text</value> for strings)
  return decodeXmlEntities(valueXml.trim())
}

/**
 * Normalize Odoo URL - ensure https:// prefix
 */
export function normalizeOdooUrl(url: string): string {
  let normalized = url.trim()
  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '')
  // Add https:// if no protocol specified
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = 'https://' + normalized
  }
  return normalized
}

/**
 * Test connection to an Odoo instance
 */
export async function testOdooConnection(
  url: string,
  database: string,
  username: string,
  apiKey: string,
): Promise<OdooConnectionResult> {
  const normalizedUrl = normalizeOdooUrl(url)
  try {
    // Get version info (no auth required)
    const version = (await odooXmlRpc(normalizedUrl, 'common', 'version', [])) as {
      server_version?: string
    }

    // Authenticate
    const uid = await odooXmlRpc(normalizedUrl, 'common', 'authenticate', [
      database,
      username,
      apiKey,
      {},
    ])

    if (!uid || uid === false) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Get user name
    const users = (await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
      database,
      uid,
      apiKey,
      'res.users',
      'read',
      [[uid as number], ['name']],
    ])) as Array<{ name: string }>

    return {
      success: true,
      user_name: users[0]?.name || username,
      version: version?.server_version || 'Unknown',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * Fetch suppliers from Odoo
 */
export async function fetchOdooSuppliers(
  url: string,
  database: string,
  username: string,
  apiKey: string,
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
    timing_ms: 0,
  }

  try {
    // Authenticate first
    const uid = await odooXmlRpc(normalizedUrl, 'common', 'authenticate', [
      database,
      username,
      apiKey,
      {},
    ])

    debug.auth_uid = uid

    if (!uid || uid === false) {
      debug.timing_ms = Date.now() - startTime
      return {
        success: false,
        suppliers: [],
        error: 'Odoo authentication failed - check credentials',
        debug,
      }
    }

    // Search for suppliers using multiple strategies
    let supplierIds: unknown = []

    // Helper to check if result is a valid array of IDs
    const isValidIdArray = (result: unknown): result is number[] =>
      Array.isArray(result) && result.length > 0

    // Strategy 1: supplier_rank > 0 (partners with purchase history in Odoo 13+)
    try {
      supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
        database,
        uid,
        apiKey,
        'res.partner',
        'search',
        [[['supplier_rank', '>', 0]]],
        { limit: 5000 },
      ])
      debug.supplier_ids_type = `supplier_rank:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
    } catch (error) {
      debug.supplier_ids_type = `supplier_rank:error:${error}`
    }

    // Strategy 2: Partners with vendor payment terms (indicates vendor setup)
    if (!isValidIdArray(supplierIds)) {
      try {
        supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
          database,
          uid,
          apiKey,
          'res.partner',
          'search',
          [[['property_supplier_payment_term_id', '!=', false]]],
          { limit: 5000 },
        ])
        debug.supplier_ids_type += ` → payment_terms:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
      } catch {
        debug.supplier_ids_type += ' → payment_terms:field_error'
      }
    }

    // Strategy 3: All companies (broad - will include customers too)
    if (!isValidIdArray(supplierIds)) {
      try {
        supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
          database,
          uid,
          apiKey,
          'res.partner',
          'search',
          [
            [
              ['is_company', '=', true],
              ['active', '=', true],
            ],
          ],
          { limit: 5000 },
        ])
        debug.supplier_ids_type += ` → is_company:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
      } catch (error) {
        debug.supplier_ids_type += ` → is_company:error:${error}`
      }
    }

    // Strategy 4: Last resort - ALL active partners
    if (!isValidIdArray(supplierIds)) {
      try {
        supplierIds = await odooXmlRpc(normalizedUrl, 'object', 'execute_kw', [
          database,
          uid,
          apiKey,
          'res.partner',
          'search',
          [[['active', '=', true]]],
          { limit: 1000 }, // Smaller limit for broad query
        ])
        debug.supplier_ids_type += ` → all_partners:${typeof supplierIds}${Array.isArray(supplierIds) ? `[${supplierIds.length}]` : ''}`
      } catch (error) {
        debug.supplier_ids_type += ` → all_partners:error:${error}`
      }
    }

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
      database,
      uid,
      apiKey,
      'res.partner',
      'read',
      [
        ids,
        [
          'id',
          'name',
          'ref',
          'email',
          'phone',
          'mobile',
          'website',
          'street',
          'street2',
          'city',
          'zip',
          'state_id',
          'country_id',
          'active',
        ],
      ],
    ])

    debug.suppliers_result_type =
      typeof suppliersResult + (Array.isArray(suppliersResult) ? '[]' : '')

    // Ensure result is an array
    const suppliers = Array.isArray(suppliersResult) ? (suppliersResult as OdooSupplier[]) : []
    debug.suppliers_count = suppliers.length
    debug.timing_ms = Date.now() - startTime

    // Include raw XML samples for debugging
    const debugWithXml = { ...debug, raw_xml_samples: getLastXmlResponses() }

    return { success: true, suppliers, debug: debugWithXml }
  } catch (error) {
    const debugWithXml = {
      ...debug,
      timing_ms: Date.now() - startTime,
      raw_xml_samples: getLastXmlResponses(),
    }
    return {
      success: false,
      suppliers: [],
      error: `Odoo API error: ${error instanceof Error ? error.message : String(error)}`,
      debug: debugWithXml,
    }
  }
}
