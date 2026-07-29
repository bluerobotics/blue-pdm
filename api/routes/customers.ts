/**
 * Customer Routes
 *
 * POST /customers/sync mirrors Odoo's res.partner / sale.order / sale.order.line
 * into the customers module.
 *
 * ---------------------------------------------------------------------------
 * DATA-PRESERVATION CONTRACT
 * ---------------------------------------------------------------------------
 * A full AI enrichment run costs hundreds of dollars. This sync runs
 * unattended and frequently, so it is written to be incapable of destroying
 * that research:
 *
 *   1. It never deletes a customer, an account, or any enrichment. A customer
 *      that has vanished from Odoo is flagged is_active = false with
 *      odoo_missing_since set. Only customer_order_lines are deleted, and only
 *      because they are fully reproducible from the next re-sync.
 *   2. customers.account_id is sticky - see resolveStickyAccountId().
 *   3. A column is never blanked because Odoo failed to return its field - see
 *      fillMissingColumns().
 *   4. Every upsert is keyed on (org_id, erp_id), matching the schema's unique
 *      constraints, and every query is filtered by the org_id of the
 *      authenticated user. An org_id in the request body is never trusted.
 *
 * Odoo is only ever read from: every call goes through odooReadOnlyCall, which
 * rejects a non-read-only model or ORM method before opening a socket.
 */

import { FastifyPluginAsync } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeOdooUrl, odooReadOnlyCall, sendError, ErrorCode } from '../utils/index.js'
import { requireTeamPermission } from '../middleware/index.js'
import { createSupabaseAdminClient } from '../src/infrastructure/supabase.js'
import { deriveAccount } from '../src/customers/grouping.js'
import {
  ADDRESS_COLUMN_MAP,
  ADDRESS_FIELDS,
  ORDER_COLUMN_MAP,
  ORDER_FIELDS,
  ORDER_LINE_FIELDS,
  PARTNER_COLUMN_MAP,
  PARTNER_FIELDS,
  accountInputFromRow,
  chunk,
  computeCustomerAggregates,
  emptyAggregates,
  fillMissingColumns,
  intersectFields,
  many2oneErpId,
  many2oneId,
  mapOrderLine,
  mapRecord,
  mappedColumns,
  odooNumber,
  parseFieldsGet,
  resolveStickyAccountId,
  summariseOrderLines,
  toOdooDateTime,
} from '../src/customers/odooSync.js'
import type { AggregateOrderRow, OdooRecord, PartialRow } from '../src/customers/odooSync.js'

/** Rows per Supabase write. A full sync can move 20k customers. */
const WRITE_CHUNK = 500
/** Rows per Supabase read page. */
const READ_PAGE = 1000
/** Records per Odoo search_read page. */
const ODOO_PAGE = 500
/** Ids per `IN` clause, kept well under URL and statement limits. */
const IN_CHUNK = 200
/** Hard stop on a single model's pull, so a runaway query cannot hang a sync. */
const MAX_ODOO_RECORDS = 100000

type Row = Record<string, unknown>

interface OdooConfig {
  url: string
  database: string
  uid: number
  apiKey: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// ODOO ACCESS (read-only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Every Odoo call in this file funnels through here, so the read-only guard is
 * unavoidable rather than merely conventional.
 */
async function odooCall(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  return odooReadOnlyCall(cfg.url, 'object', 'execute_kw', [
    cfg.database,
    cfg.uid,
    cfg.apiKey,
    model,
    method,
    args,
    kwargs,
  ])
}

function asRecords(value: unknown): OdooRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is OdooRecord => typeof item === 'object' && item !== null && !Array.isArray(item),
  )
}

/** Page through a search_read until the model is exhausted. */
async function searchReadAll(
  cfg: OdooConfig,
  model: string,
  domain: unknown[],
  fields: readonly string[],
): Promise<OdooRecord[]> {
  const out: OdooRecord[] = []
  for (let offset = 0; out.length < MAX_ODOO_RECORDS; offset += ODOO_PAGE) {
    const page = asRecords(
      await odooCall(cfg, model, 'search_read', [domain, [...fields]], {
        limit: ODOO_PAGE,
        offset,
        order: 'id asc',
      }),
    )
    out.push(...page)
    if (page.length < ODOO_PAGE) break
  }
  return out
}

/** Read specific ids, batched. Used for the shipping-address partners. */
async function readByIds(
  cfg: OdooConfig,
  model: string,
  ids: readonly number[],
  fields: readonly string[],
): Promise<OdooRecord[]> {
  const out: OdooRecord[] = []
  for (const batch of chunk(ids, ODOO_PAGE)) {
    out.push(...asRecords(await odooCall(cfg, model, 'read', [batch, [...fields]], {})))
  }
  return out
}

/** Page through a search_read restricted to a set of parent ids. */
async function searchReadByParentIds(
  cfg: OdooConfig,
  model: string,
  parentField: string,
  parentIds: readonly number[],
  fields: readonly string[],
): Promise<OdooRecord[]> {
  const out: OdooRecord[] = []
  for (const batch of chunk(parentIds, IN_CHUNK)) {
    out.push(...(await searchReadAll(cfg, model, [[parentField, 'in', batch]], fields)))
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE ACCESS
// ═══════════════════════════════════════════════════════════════════════════════

/** Await a PostgREST builder and turn its error into a thrown one. */
async function exec(query: PromiseLike<unknown>, what: string): Promise<Row[]> {
  const { data, error } = (await query) as {
    data: Row[] | null
    error: { message: string } | null
  }
  if (error) throw new Error(`${what}: ${error.message}`)
  return data ?? []
}

/** Page a select until it runs dry. */
async function selectAllPages(
  page: (from: number, to: number) => PromiseLike<unknown>,
  what: string,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const batch = await exec(page(from, from + READ_PAGE - 1), what)
    rows.push(...batch)
    if (batch.length < READ_PAGE) break
  }
  return rows
}

/** Upsert in batches, returning whatever the caller asked to have selected. */
async function upsertChunked(
  db: SupabaseClient,
  table: string,
  rows: readonly PartialRow[],
  onConflict: string,
  select: string,
  options: { ignoreDuplicates?: boolean } = {},
): Promise<Row[]> {
  const returned: Row[] = []
  for (const batch of chunk(rows, WRITE_CHUNK)) {
    returned.push(
      ...(await exec(
        db
          .from(table)
          .upsert(batch, { onConflict, ignoreDuplicates: options.ignoreDuplicates ?? false })
          .select(select),
        `${table} upsert`,
      )),
    )
  }
  return returned
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

const customerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/customers/sync',
    {
      schema: {
        description:
          'Mirror customers, orders and order lines from Odoo. Read-only against Odoo; never deletes customers, accounts or enrichment.',
        tags: ['Customers'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: {
              type: 'string',
              description:
                'ISO timestamp. Limits the sale.order pull to orders dated on or after this instant. Partners are always pulled in full.',
            },
          },
        },
      },
      preHandler: [fastify.authenticate, requireTeamPermission('module:customers', 'create')],
    },
    async (request, reply) => {
      const startedAt = Date.now()

      // org_id comes from the authenticated user, never from the request body.
      if (!request.user?.org_id || !request.supabase) {
        return sendError(reply, 401, ErrorCode.UNAUTHORIZED, 'Authentication required')
      }
      const orgId = request.user.org_id
      const userId = request.user.id

      const body = (request.body ?? {}) as { since?: string }
      let since: Date | null = null
      if (body.since) {
        const parsed = new Date(body.since)
        if (Number.isNaN(parsed.getTime())) {
          return sendError(reply, 400, ErrorCode.BAD_REQUEST, '`since` is not a valid timestamp')
        }
        since = parsed
      }

      // ── 1. Odoo connection config, loaded exactly like the supplier sync ────
      const { data: integration } = await request.supabase
        .from('organization_integrations')
        .select('id, settings, credentials_encrypted')
        .eq('org_id', orgId)
        .eq('integration_type', 'odoo')
        .single()

      if (!integration) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'Odoo integration not configured')
      }

      const settings = (integration.settings ?? {}) as Record<string, unknown>
      const rawUrl = text(settings.url)
      const database = text(settings.database)
      const username = text(settings.username)
      const apiKey = text(integration.credentials_encrypted)

      if (!rawUrl || !database || !username || !apiKey) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'Odoo integration is missing credentials')
      }

      const url = normalizeOdooUrl(rawUrl)
      const uid = await odooReadOnlyCall(url, 'common', 'authenticate', [
        database,
        username,
        apiKey,
        {},
      ])
      if (typeof uid !== 'number' || uid <= 0) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'Odoo authentication failed')
      }
      const cfg: OdooConfig = { url, database, uid, apiKey }

      // ── 2. Discover which fields this Odoo actually has ────────────────────
      // Odoo versions and installed addons differ, and asking search_read for
      // a single non-existent field fails the whole call.
      const [partnerFieldSet, orderFieldSet, lineFieldSet] = await Promise.all([
        odooCall(cfg, 'res.partner', 'fields_get', [[], ['type']]).then(parseFieldsGet),
        odooCall(cfg, 'sale.order', 'fields_get', [[], ['type']]).then(parseFieldsGet),
        odooCall(cfg, 'sale.order.line', 'fields_get', [[], ['type']]).then(parseFieldsGet),
      ])

      const partnerPlan = intersectFields(PARTNER_FIELDS, partnerFieldSet)
      const addressPlan = intersectFields(ADDRESS_FIELDS, partnerFieldSet)
      const orderPlan = intersectFields(ORDER_FIELDS, orderFieldSet)
      const linePlan = intersectFields(ORDER_LINE_FIELDS, lineFieldSet)

      const fieldsUnavailable = {
        'res.partner': partnerPlan.unavailable,
        'sale.order': orderPlan.unavailable,
        'sale.order.line': linePlan.unavailable,
      }
      request.log.info({ msg: '[CustomerSync] Odoo fields unavailable', fieldsUnavailable })

      if (!partnerFieldSet.has('name')) {
        return sendError(
          reply,
          502,
          ErrorCode.BAD_REQUEST,
          'Odoo res.partner has no `name` field; refusing to sync',
        )
      }

      // ── 3. Pull sale.order for the window ──────────────────────────────────
      const orderDomain: unknown[] = []
      if (since && orderFieldSet.has('date_order')) {
        orderDomain.push(['date_order', '>=', toOdooDateTime(since)])
      }
      const odooOrders = await searchReadAll(cfg, 'sale.order', orderDomain, orderPlan.selected)

      // ── 4. Pull res.partner, restricted to actual customers ────────────────
      // customer_rank is the Odoo 13+ marker; `customer` is the pre-13 boolean.
      // With neither we fall back to the partners referenced by the orders we
      // just pulled, which is a partial view - so the missing-customer sweep in
      // step 9 is suppressed, otherwise it would flag every customer outside
      // the window as gone from Odoo.
      let odooPartners: OdooRecord[]
      let partnerPullIsComplete = true
      if (partnerFieldSet.has('customer_rank')) {
        odooPartners = await searchReadAll(
          cfg,
          'res.partner',
          [['customer_rank', '>', 0]],
          partnerPlan.selected,
        )
      } else if (partnerFieldSet.has('customer')) {
        odooPartners = await searchReadAll(
          cfg,
          'res.partner',
          [['customer', '=', true]],
          partnerPlan.selected,
        )
      } else {
        partnerPullIsComplete = false
        const partnerIds = [
          ...new Set(
            odooOrders
              .map((order) => many2oneId(order.partner_id))
              .filter((id): id is number => id !== null),
          ),
        ]
        odooPartners = await readByIds(cfg, 'res.partner', partnerIds, partnerPlan.selected)
      }

      // ── 5. Resolve partner_shipping_id, itself a res.partner ───────────────
      const shippingIds = [
        ...new Set(
          odooOrders
            .map((order) => many2oneId(order.partner_shipping_id))
            .filter((id): id is number => id !== null),
        ),
      ]
      const odooAddresses = shippingIds.length
        ? await readByIds(cfg, 'res.partner', shippingIds, addressPlan.selected)
        : []

      // ── 6. Pull sale.order.line for those orders ───────────────────────────
      const odooOrderIds = odooOrders
        .map((order) => odooNumber(order.id))
        .filter((id): id is number => id !== null)
      const linesAvailable = lineFieldSet.has('order_id') && odooOrderIds.length > 0
      const odooLines = linesAvailable
        ? await searchReadByParentIds(
            cfg,
            'sale.order.line',
            'order_id',
            odooOrderIds,
            linePlan.selected,
          )
        : []

      // ── 7. Upsert into Supabase with the service-role client ───────────────
      const db = createSupabaseAdminClient()
      const nowIso = new Date().toISOString()

      const customerColumns = mappedColumns(partnerFieldSet, PARTNER_COLUMN_MAP)
      const addressColumns = mappedColumns(partnerFieldSet, ADDRESS_COLUMN_MAP)
      const orderColumns = mappedColumns(orderFieldSet, ORDER_COLUMN_MAP)

      // Existing customers are read in full for the columns we may write, so a
      // field Odoo did not return can be written straight back rather than
      // blanked.
      const existingCustomerSelect = [
        ...new Set(['id', 'erp_id', 'account_id', 'is_active', 'odoo_missing_since', ...customerColumns]),
      ].join(', ')

      const existingCustomerRows = await selectAllPages(
        (from, to) =>
          db
            .from('customers')
            .select(existingCustomerSelect)
            .eq('org_id', orgId)
            .not('erp_id', 'is', null)
            .order('erp_id', { ascending: true })
            .range(from, to),
        'customers select',
      )

      const existingByErpId = new Map<string, Row>()
      for (const row of existingCustomerRows) {
        const erpId = text(row.erp_id)
        if (erpId) existingByErpId.set(erpId, row)
      }

      // ── 7a. Accounts, for customers that do not have one yet ───────────────
      interface PreparedCustomer {
        erpId: string
        row: PartialRow
        existing: Row | undefined
        accountKey: string | null
      }

      const prepared: PreparedCustomer[] = []
      const accountsToEnsure = new Map<string, { displayName: string; kind: string }>()
      const seenErpIds = new Set<string>()

      for (const partner of odooPartners) {
        const partnerId = odooNumber(partner.id)
        if (partnerId === null) continue
        const erpId = String(partnerId)
        if (seenErpIds.has(erpId)) continue
        seenErpIds.add(erpId)

        const existing = existingByErpId.get(erpId)
        const mapped = mapRecord(partner, partnerFieldSet, PARTNER_COLUMN_MAP)
        const row = fillMissingColumns(mapped, customerColumns, existing)

        // customers.name is NOT NULL, and Odoo can hand back `false`.
        if (typeof row.name !== 'string' || row.name.trim() === '') {
          row.name = text(existing?.name) ?? `Odoo partner ${erpId}`
        }

        // account_id is STICKY. It is derived only for a customer that has
        // never been grouped; a customer that already has one keeps it, so a
        // company renaming itself in Odoo relinks to the account its
        // (expensive) enrichment already hangs off instead of minting a second.
        let accountKey: string | null = null
        if (!text(existing?.account_id)) {
          const account = deriveAccount(accountInputFromRow(erpId, row))
          accountKey = account.accountKey
          if (!accountsToEnsure.has(accountKey)) {
            accountsToEnsure.set(accountKey, {
              displayName: account.displayName,
              kind: account.kind,
            })
          }
        }

        prepared.push({ erpId, row, existing, accountKey })
      }

      // ON CONFLICT DO NOTHING: an account that already exists is left exactly
      // as it is. account_key is the identity enrichment hangs off, so it is
      // never re-keyed, and accounts are never deleted.
      const accountRows: PartialRow[] = [...accountsToEnsure.entries()].map(([key, meta]) => ({
        org_id: orgId,
        account_key: key,
        display_name: meta.displayName,
        kind: meta.kind,
        created_by: userId,
        updated_by: userId,
      }))

      const insertedAccounts = await upsertChunked(
        db,
        'customer_accounts',
        accountRows,
        'org_id,account_key',
        'id, account_key',
        { ignoreDuplicates: true },
      )

      const accountIdByKey = new Map<string, string>()
      for (const batch of chunk([...accountsToEnsure.keys()], IN_CHUNK)) {
        const rows = await exec(
          db.from('customer_accounts').select('id, account_key').eq('org_id', orgId).in('account_key', batch),
          'customer_accounts select',
        )
        for (const row of rows) {
          const key = text(row.account_key)
          const id = text(row.id)
          if (key && id) accountIdByKey.set(key, id)
        }
      }

      // ── 7b. Customers ──────────────────────────────────────────────────────
      const customerInserts: PartialRow[] = []
      const customerUpdates: PartialRow[] = []
      let reactivated = 0

      for (const item of prepared) {
        const derivedAccountId = item.accountKey ? (accountIdByKey.get(item.accountKey) ?? null) : null
        const accountId = resolveStickyAccountId(text(item.existing?.account_id), derivedAccountId)

        const base: PartialRow = {
          ...item.row,
          org_id: orgId,
          erp_id: item.erpId,
          account_id: accountId,
          erp_synced_at: nowIso,
          // Present in Odoo, so any earlier disappearance is over.
          is_active: true,
          odoo_missing_since: null,
          updated_by: userId,
        }

        if (item.existing) {
          if (item.existing.is_active === false || item.existing.odoo_missing_since !== null) {
            reactivated++
          }
          customerUpdates.push(base)
        } else {
          customerInserts.push({ ...base, created_by: userId })
        }
      }

      const customerIdByErpId = new Map<string, string>()
      for (const row of existingCustomerRows) {
        const erpId = text(row.erp_id)
        const id = text(row.id)
        if (erpId && id) customerIdByErpId.set(erpId, id)
      }

      for (const rows of [customerInserts, customerUpdates]) {
        const returned = await upsertChunked(db, 'customers', rows, 'org_id,erp_id', 'id, erp_id')
        for (const row of returned) {
          const erpId = text(row.erp_id)
          const id = text(row.id)
          if (erpId && id) customerIdByErpId.set(erpId, id)
        }
      }

      // ── 7c. Shipping addresses ─────────────────────────────────────────────
      const addressErpIds = odooAddresses
        .map((record) => odooNumber(record.id))
        .filter((id): id is number => id !== null)
        .map(String)

      const existingAddresses = new Map<string, Row>()
      if (addressErpIds.length) {
        const addressSelect = [...new Set(['id', 'erp_id', ...addressColumns])].join(', ')
        for (const batch of chunk(addressErpIds, IN_CHUNK)) {
          const rows = await exec(
            db.from('customer_addresses').select(addressSelect).eq('org_id', orgId).in('erp_id', batch),
            'customer_addresses select',
          )
          for (const row of rows) {
            const erpId = text(row.erp_id)
            if (erpId) existingAddresses.set(erpId, row)
          }
        }
      }

      const addressRows: PartialRow[] = []
      let addressesCreated = 0
      for (const record of odooAddresses) {
        const recordId = odooNumber(record.id)
        if (recordId === null) continue
        const erpId = String(recordId)
        const existing = existingAddresses.get(erpId)
        if (!existing) addressesCreated++
        addressRows.push({
          ...fillMissingColumns(
            mapRecord(record, partnerFieldSet, ADDRESS_COLUMN_MAP),
            addressColumns,
            existing,
          ),
          org_id: orgId,
          erp_id: erpId,
        })
      }

      const addressIdByErpId = new Map<string, string>()
      for (const row of await upsertChunked(
        db,
        'customer_addresses',
        addressRows,
        'org_id,erp_id',
        'id, erp_id',
      )) {
        const erpId = text(row.erp_id)
        const id = text(row.id)
        if (erpId && id) addressIdByErpId.set(erpId, id)
      }

      // ── 7d. Orders ─────────────────────────────────────────────────────────
      // Orders and their lines carry no enrichment and are fully reproducible
      // from a re-sync, so unlike customers they are safe to overwrite
      // wholesale.
      const linesByOrderErpId = new Map<string, OdooRecord[]>()
      for (const line of odooLines) {
        const orderErpId = many2oneErpId(line.order_id)
        if (!orderErpId) continue
        const bucket = linesByOrderErpId.get(orderErpId)
        if (bucket) bucket.push(line)
        else linesByOrderErpId.set(orderErpId, [line])
      }

      const orderErpIds = odooOrders
        .map((order) => odooNumber(order.id))
        .filter((id): id is number => id !== null)
        .map(String)

      const existingOrderErpIds = new Set<string>()
      for (const batch of chunk(orderErpIds, IN_CHUNK)) {
        const rows = await exec(
          db.from('customer_orders').select('erp_id').eq('org_id', orgId).in('erp_id', batch),
          'customer_orders select',
        )
        for (const row of rows) {
          const erpId = text(row.erp_id)
          if (erpId) existingOrderErpIds.add(erpId)
        }
      }

      const orderRows: PartialRow[] = []
      const lineRowsByOrderErpId = new Map<string, PartialRow[]>()
      let ordersCreated = 0
      let ordersUpdated = 0
      let ordersSkippedUnknownPartner = 0

      for (const order of odooOrders) {
        const orderId = odooNumber(order.id)
        if (orderId === null) continue
        const erpId = String(orderId)

        const partnerErpId = many2oneErpId(order.partner_id)
        const customerId = partnerErpId ? customerIdByErpId.get(partnerErpId) : undefined
        if (!customerId) {
          // customer_orders.customer_id is NOT NULL; an order whose partner is
          // not a customer we mirror has nowhere to hang.
          ordersSkippedUnknownPartner++
          continue
        }

        const shippingErpId = many2oneErpId(order.partner_shipping_id)
        const mapped = mapRecord(order, orderFieldSet, ORDER_COLUMN_MAP)
        const row: PartialRow = {
          ...fillMissingColumns(mapped, orderColumns, null),
          org_id: orgId,
          erp_id: erpId,
          customer_id: customerId,
          shipping_address_id: shippingErpId ? (addressIdByErpId.get(shippingErpId) ?? null) : null,
        }

        if (linesAvailable) {
          const lines = (linesByOrderErpId.get(erpId) ?? []).map((line) =>
            mapOrderLine(line, lineFieldSet),
          )
          const summary = summariseOrderLines(lines)
          row.items_count = summary.itemsCount
          // sale.order has no order-level discount; it is recovered from lines.
          row.discount = summary.discountTotal
          lineRowsByOrderErpId.set(
            erpId,
            lines.map((line) => ({ ...line, org_id: orgId })),
          )
        }

        if (existingOrderErpIds.has(erpId)) ordersUpdated++
        else ordersCreated++
        orderRows.push(row)
      }

      const orderIdByErpId = new Map<string, string>()
      for (const row of await upsertChunked(
        db,
        'customer_orders',
        orderRows,
        'org_id,erp_id',
        'id, erp_id',
      )) {
        const erpId = text(row.erp_id)
        const id = text(row.id)
        if (erpId && id) orderIdByErpId.set(erpId, id)
      }

      // ── 7e. Order lines: replaced wholesale ────────────────────────────────
      let lineCount = 0
      if (linesAvailable && orderIdByErpId.size > 0) {
        const touchedOrderIds = [...orderIdByErpId.values()]
        for (const batch of chunk(touchedOrderIds, IN_CHUNK)) {
          const { error } = (await db
            .from('customer_order_lines')
            .delete()
            .eq('org_id', orgId)
            .in('order_id', batch)) as { error: { message: string } | null }
          if (error) throw new Error(`customer_order_lines delete: ${error.message}`)
        }

        const insertRows: PartialRow[] = []
        for (const [erpId, lines] of lineRowsByOrderErpId) {
          const orderUuid = orderIdByErpId.get(erpId)
          if (!orderUuid) continue
          for (const line of lines) insertRows.push({ ...line, order_id: orderUuid })
        }
        lineCount = insertRows.length

        for (const batch of chunk(insertRows, WRITE_CHUNK)) {
          await exec(
            db.from('customer_order_lines').insert(batch).select('id'),
            'customer_order_lines insert',
          )
        }
      }

      // ── 8. Recompute aggregates on the customers we touched ────────────────
      const affectedCustomerIds = new Set<string>()
      for (const item of prepared) {
        const id = customerIdByErpId.get(item.erpId)
        if (id) affectedCustomerIds.add(id)
      }
      for (const row of orderRows) {
        if (typeof row.customer_id === 'string') affectedCustomerIds.add(row.customer_id)
      }

      const preparedByErpId = new Map(prepared.map((item) => [item.erpId, item]))
      const nameById = new Map<string, string>()
      const erpIdById = new Map<string, string>()
      for (const [erpId, id] of customerIdByErpId) {
        erpIdById.set(id, erpId)
        const name =
          text(preparedByErpId.get(erpId)?.row.name) ?? text(existingByErpId.get(erpId)?.name)
        if (name) nameById.set(id, name)
      }

      // Aggregates must reflect the customer's whole history, not just this
      // window, so every order they have is re-read rather than only the ones
      // the sync just wrote.
      const aggregateSource: AggregateOrderRow[] = []
      for (const batch of chunk([...affectedCustomerIds], IN_CHUNK)) {
        const rows = await selectAllPages(
          (from, to) =>
            db
              .from('customer_orders')
              .select('customer_id, order_date, total, items_count, status')
              .eq('org_id', orgId)
              .in('customer_id', batch)
              .order('customer_id', { ascending: true })
              .range(from, to),
          'customer_orders aggregate select',
        )
        for (const row of rows) {
          aggregateSource.push({
            customer_id: String(row.customer_id),
            order_date: text(row.order_date),
            total: (row.total as number | string | null) ?? null,
            items_count: (row.items_count as number | string | null) ?? null,
            status: text(row.status),
          })
        }
      }

      const aggregates = computeCustomerAggregates(aggregateSource)
      const aggregateRows: PartialRow[] = []
      for (const customerId of affectedCustomerIds) {
        const name = nameById.get(customerId)
        const erpId = erpIdById.get(customerId)
        if (!name || !erpId) continue
        // Keyed on the primary key so this touches only the aggregate columns;
        // org_id, erp_id and name are carried because they are NOT NULL or
        // uniquely constrained, and are rewritten with the values they already
        // hold.
        aggregateRows.push({
          id: customerId,
          org_id: orgId,
          erp_id: erpId,
          name,
          ...(aggregates.get(customerId) ?? emptyAggregates()),
        })
      }
      await upsertChunked(db, 'customers', aggregateRows, 'id', 'id')

      // ── 9. Flag customers that vanished from Odoo. Never delete. ───────────
      let markedInactive = 0
      if (partnerPullIsComplete) {
        const missing = [...existingByErpId.keys()].filter((erpId) => !seenErpIds.has(erpId))
        for (const batch of chunk(missing, IN_CHUNK)) {
          // Soft-flag only: the row, its account, its orders and any enrichment
          // paid for against it all survive. `is('odoo_missing_since', null)`
          // keeps the first-observed timestamp from being pushed forward on
          // every subsequent run.
          const rows = await exec(
            db
              .from('customers')
              .update({ is_active: false, odoo_missing_since: nowIso, updated_by: userId })
              .eq('org_id', orgId)
              .in('erp_id', batch)
              .is('odoo_missing_since', null)
              .select('id'),
            'customers deactivate',
          )
          markedInactive += rows.length
        }
      }

      // ── 10. Record the run on the integration ──────────────────────────────
      await request.supabase
        .from('organization_integrations')
        .update({
          is_connected: true,
          last_connected_at: nowIso,
          last_error: null,
          last_sync_at: nowIso,
          last_sync_status: 'success',
          last_sync_count: customerInserts.length + customerUpdates.length,
        })
        .eq('id', integration.id)

      return {
        success: true,
        duration_ms: Date.now() - startedAt,
        window: { since: since ? since.toISOString() : null },
        fields_unavailable: fieldsUnavailable,
        partner_pull_complete: partnerPullIsComplete,
        odoo_records: {
          partners: odooPartners.length,
          orders: odooOrders.length,
          order_lines: odooLines.length,
          shipping_addresses: odooAddresses.length,
        },
        customers: {
          created: customerInserts.length,
          updated: customerUpdates.length,
          reactivated,
          marked_inactive: markedInactive,
          aggregates_recomputed: aggregateRows.length,
        },
        customer_accounts: {
          created: insertedAccounts.length,
          linked: accountIdByKey.size,
        },
        customer_addresses: {
          created: addressesCreated,
          updated: addressRows.length - addressesCreated,
        },
        customer_orders: {
          created: ordersCreated,
          updated: ordersUpdated,
          skipped_unknown_partner: ordersSkippedUnknownPartner,
        },
        customer_order_lines: {
          replaced: lineCount,
        },
      }
    },
  )
}

export default customerRoutes
