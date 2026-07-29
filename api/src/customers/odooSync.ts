/**
 * Odoo Customer Sync - pure mapping logic
 *
 * Everything here is a pure function. No database, no network. The route in
 * `api/routes/customers.ts` does the I/O and delegates every decision about
 * *what to write* to this module, so the rules that protect paid-for
 * enrichment data are unit-testable without an Odoo instance or a Supabase
 * project.
 *
 * Two Odoo quirks drive most of the shape of this file:
 *
 *   1. A many2one field comes back as `[id, "Display Name"]`, not a scalar,
 *      and as `false` when unset.
 *   2. Every empty value comes back as boolean `false` rather than null or an
 *      empty string.
 *
 * And one data-preservation rule drives the rest: a field that Odoo did not
 * return must never reach the database as null. See {@link fillMissingColumns}.
 *
 * @module customers/odooSync
 */

import type { CustomerInput } from './types.js'

// ═══════════════════════════════════════════════════════════════════════════════
// SCALAR COERCION
// ═══════════════════════════════════════════════════════════════════════════════

/** A single record as returned by Odoo's `read` / `search_read`. */
export type OdooRecord = Record<string, unknown>

/**
 * Odoo's representation of an unset many2one, or of any empty value.
 */
function isOdooEmpty(value: unknown): boolean {
  return value === false || value === null || value === undefined
}

/**
 * Text out of Odoo, with the `false`-means-empty convention collapsed to null.
 */
export function odooText(value: unknown): string | null {
  if (isOdooEmpty(value)) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'number' || value === true) return String(value)
  return null
}

/**
 * Number out of Odoo. Non-finite results become null rather than NaN, which
 * would be rejected by a NUMERIC column.
 */
export function odooNumber(value: unknown): number | null {
  if (isOdooEmpty(value) || value === true) return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Boolean out of Odoo. Anything unset reads as false.
 */
export function odooBool(value: unknown): boolean {
  return value === true
}

/**
 * Odoo serialises datetimes as naive `YYYY-MM-DD HH:MM:SS` strings that are
 * always UTC. Handing that to Postgres as-is would make it depend on the
 * server's timezone, so the `Z` is made explicit here.
 */
export function odooDateTime(value: unknown): string | null {
  const text = odooText(value)
  if (!text) return null

  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(text)
  if (!match) return null

  const time = match[2] ?? '00:00:00'
  const iso = `${match[1]}T${time.length === 5 ? `${time}:00` : time}Z`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * Format a Date for an Odoo domain, which expects the same naive-UTC form.
 */
export function toOdooDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANY2ONE UNWRAPPING
// ═══════════════════════════════════════════════════════════════════════════════

/** The two halves of an Odoo many2one, either of which may be absent. */
export interface Many2One {
  id: number | null
  name: string | null
}

/**
 * Split Odoo's `[id, "Display Name"]` many2one representation.
 *
 * Tolerates every other form the wire actually produces: `false` for unset, a
 * bare id when the caller used `read` with a context that strips display
 * names, a one-element array, and a numeric string id.
 */
export function unwrapMany2One(value: unknown): Many2One {
  if (isOdooEmpty(value)) return { id: null, name: null }

  if (Array.isArray(value)) {
    const id = odooNumber(value[0])
    const name = value.length > 1 ? odooText(value[1]) : null
    return { id: Number.isInteger(id) ? id : null, name }
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const id = odooNumber(value)
    // A non-numeric string is a display name with no id attached.
    if (id !== null && Number.isInteger(id)) return { id, name: null }
    return { id: null, name: odooText(value) }
  }

  return { id: null, name: null }
}

/** The id half of a many2one. */
export function many2oneId(value: unknown): number | null {
  return unwrapMany2One(value).id
}

/** The display-name half of a many2one. */
export function many2oneName(value: unknown): string | null {
  return unwrapMany2One(value).name
}

/** The id half of a many2one, as the TEXT that `*_erp_id` columns hold. */
export function many2oneErpId(value: unknown): string | null {
  const id = unwrapMany2One(value).id
  return id === null ? null : String(id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD AVAILABILITY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Field names present in an Odoo `fields_get` response.
 *
 * Odoo versions and installed addons differ, and asking `search_read` for one
 * field that does not exist fails the entire call - so every desired field is
 * checked against this first.
 */
export function parseFieldsGet(raw: unknown): Set<string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Set()
  return new Set(Object.keys(raw as Record<string, unknown>))
}

/** Outcome of checking a desired field list against a model's real fields. */
export interface FieldIntersection {
  /** Desired fields that exist on the model, in the order requested. */
  selected: string[]
  /** Desired fields the model does not have. Reported back to the caller. */
  unavailable: string[]
}

/**
 * Intersect a desired field list with the fields the model actually has.
 *
 * Duplicates in `desired` are collapsed so the request stays minimal.
 */
export function intersectFields(desired: readonly string[], available: Set<string>): FieldIntersection {
  const selected: string[] = []
  const unavailable: string[] = []
  const seen = new Set<string>()

  for (const field of desired) {
    if (seen.has(field)) continue
    seen.add(field)
    if (available.has(field)) {
      selected.push(field)
    } else {
      unavailable.push(field)
    }
  }

  return { selected, unavailable }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLUMN MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════════

/** One database column, the Odoo field feeding it, and the coercion between. */
export interface ColumnMapping {
  column: string
  field: string
  map: (value: unknown) => unknown
}

/**
 * res.partner -> customers.
 *
 * `first_name`, `last_name` and `role` are deliberately absent: Odoo has no
 * equivalent, and inventing one would overwrite whatever a human put there.
 */
export const PARTNER_COLUMN_MAP: readonly ColumnMapping[] = [
  { column: 'name', field: 'name', map: odooText },
  { column: 'email', field: 'email', map: odooText },
  { column: 'phone', field: 'phone', map: odooText },
  { column: 'street', field: 'street', map: odooText },
  { column: 'street2', field: 'street2', map: odooText },
  { column: 'city', field: 'city', map: odooText },
  { column: 'zip', field: 'zip', map: odooText },
  { column: 'state', field: 'state_id', map: many2oneName },
  { column: 'country', field: 'country_id', map: many2oneName },
  { column: 'website', field: 'website', map: odooText },
  { column: 'vat', field: 'vat', map: odooText },
  { column: 'is_company', field: 'is_company', map: odooBool },
  { column: 'company', field: 'parent_id', map: many2oneName },
  { column: 'job_title', field: 'function', map: odooText },
  { column: 'industry', field: 'industry_id', map: many2oneName },
  { column: 'notes', field: 'comment', map: odooText },
]

/** res.partner (as a shipping address) -> customer_addresses. */
export const ADDRESS_COLUMN_MAP: readonly ColumnMapping[] = [
  { column: 'name', field: 'name', map: odooText },
  { column: 'street', field: 'street', map: odooText },
  { column: 'street2', field: 'street2', map: odooText },
  { column: 'city', field: 'city', map: odooText },
  { column: 'zip', field: 'zip', map: odooText },
  { column: 'state', field: 'state_id', map: many2oneName },
  { column: 'country', field: 'country_id', map: many2oneName },
]

/**
 * sale.order -> customer_orders.
 *
 * `customer_orders.shipping` has no sale.order equivalent (Odoo carries
 * delivery cost as an ordinary order line), so it is left unmapped rather than
 * guessed at. `discount` is not mapped here either - it is derived from the
 * order's lines by {@link summariseOrderLines}.
 */
export const ORDER_COLUMN_MAP: readonly ColumnMapping[] = [
  { column: 'order_date', field: 'date_order', map: odooDateTime },
  { column: 'status', field: 'state', map: odooText },
  { column: 'total', field: 'amount_total', map: odooNumber },
  { column: 'net', field: 'amount_untaxed', map: odooNumber },
  { column: 'tax', field: 'amount_tax', map: odooNumber },
  { column: 'payment_term', field: 'payment_term_id', map: many2oneName },
  { column: 'shipping_method', field: 'carrier_id', map: many2oneName },
  { column: 'note', field: 'note', map: odooText },
  { column: 'odoo_write_date', field: 'write_date', map: odooDateTime },
]

/**
 * Fields requested from res.partner for a customer row.
 *
 * `customer_rank` is requested because it is also the customer filter; `id` is
 * always returned by Odoo but is listed so the intersection reports honestly.
 */
export const PARTNER_FIELDS: readonly string[] = [
  'id',
  ...PARTNER_COLUMN_MAP.map((m) => m.field),
  'customer_rank',
]

/** Fields requested from res.partner when it is being read as an address. */
export const ADDRESS_FIELDS: readonly string[] = ['id', ...ADDRESS_COLUMN_MAP.map((m) => m.field)]

/**
 * Fields requested from sale.order.
 *
 * `partner_id` and `partner_shipping_id` resolve the two foreign keys rather
 * than becoming columns of their own. `currency_id` is requested because the
 * sync contract asks for it, but customer_orders has no currency column, so it
 * is read and then dropped.
 */
export const ORDER_FIELDS: readonly string[] = [
  'id',
  'partner_id',
  'partner_shipping_id',
  'currency_id',
  ...ORDER_COLUMN_MAP.map((m) => m.field),
]

/** Fields requested from sale.order.line. */
export const ORDER_LINE_FIELDS: readonly string[] = [
  'id',
  'order_id',
  'name',
  'product_id',
  'product_uom_qty',
  'price_unit',
  'price_subtotal',
  'discount',
]

// ═══════════════════════════════════════════════════════════════════════════════
// ROW BUILDING
// ═══════════════════════════════════════════════════════════════════════════════

/** A partially-built database row: only columns we actually have a value for. */
export type PartialRow = Record<string, unknown>

/**
 * Map an Odoo record onto database columns, skipping any column whose source
 * field was not fetched or was not returned.
 *
 * The skipping is the point. A column that is absent from the result is a
 * column the caller must leave alone; see {@link fillMissingColumns}.
 */
export function mapRecord(
  record: OdooRecord,
  available: Set<string>,
  mappings: readonly ColumnMapping[],
): PartialRow {
  const row: PartialRow = {}
  for (const mapping of mappings) {
    if (!available.has(mapping.field)) continue
    if (!(mapping.field in record)) continue
    row[mapping.column] = mapping.map(record[mapping.field])
  }
  return row
}

/**
 * Columns a mapping will produce given the fields that turned out to exist.
 *
 * PostgREST requires every object in a bulk upsert to carry the same keys, so
 * the caller needs this set up front to pad rows out to a uniform shape.
 */
export function mappedColumns(
  available: Set<string>,
  mappings: readonly ColumnMapping[],
): string[] {
  return mappings.filter((m) => available.has(m.field)).map((m) => m.column)
}

/**
 * Pad a row out to the full column set without ever blanking stored data.
 *
 * A column missing from `row` means Odoo did not tell us anything about it -
 * because the field does not exist on this Odoo version, or because the record
 * omitted it. That is not the same as Odoo saying "empty", so the stored value
 * is written straight back. Only a genuinely new row, which has nothing to
 * preserve, gets a null.
 */
export function fillMissingColumns(
  row: PartialRow,
  columns: readonly string[],
  existing?: PartialRow | null,
): PartialRow {
  const filled: PartialRow = { ...row }
  for (const column of columns) {
    if (column in filled) continue
    filled[column] = existing && column in existing ? existing[column] : null
  }
  return filled
}

/**
 * The identity fields {@link deriveAccount} needs, taken from an already-mapped
 * customer row so that field availability is respected here too.
 */
export function accountInputFromRow(erpId: string, row: PartialRow): CustomerInput {
  return {
    id: erpId,
    name: typeof row.name === 'string' ? row.name : null,
    email: typeof row.email === 'string' ? row.email : null,
    company: typeof row.company === 'string' ? row.company : null,
    isCompany: row.is_company === true,
  }
}

/**
 * Decide the account a customer row links to.
 *
 * customers.account_id is STICKY: assigned once at first sight, then never
 * re-derived. If a company renames itself in Odoo it must relink to the
 * existing account, never create a second one - a second account has no
 * enrichment attached, so the research already paid for would be silently
 * orphaned and the next enrichment run would pay for it all over again.
 *
 * So an existing non-null account_id always wins, and `derived` is consulted
 * only when the customer has never been grouped.
 */
export function resolveStickyAccountId(
  existingAccountId: string | null | undefined,
  derived: string | null | undefined,
): string | null {
  if (existingAccountId) return existingAccountId
  return derived ?? null
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER LINES
// ═══════════════════════════════════════════════════════════════════════════════

/** A customer_order_lines row, before org_id and order_id are stamped on. */
export interface OrderLineRow {
  product_name: string | null
  product_erp_id: string | null
  quantity: number | null
  price_unit: number | null
  price_subtotal: number | null
  discount: number | null
}

/**
 * Map a sale.order.line.
 *
 * The product's own name is preferred over the line description, which users
 * routinely overwrite with free text, but the description is a better label
 * than nothing for lines that carry no product at all (notes, sections).
 */
export function mapOrderLine(line: OdooRecord, available: Set<string>): OrderLineRow {
  const productName = available.has('product_id') ? many2oneName(line.product_id) : null
  const description = available.has('name') ? odooText(line.name) : null

  return {
    product_name: productName ?? description,
    product_erp_id: available.has('product_id') ? many2oneErpId(line.product_id) : null,
    quantity: available.has('product_uom_qty') ? odooNumber(line.product_uom_qty) : null,
    price_unit: available.has('price_unit') ? odooNumber(line.price_unit) : null,
    price_subtotal: available.has('price_subtotal') ? odooNumber(line.price_subtotal) : null,
    discount: available.has('discount') ? odooNumber(line.discount) : null,
  }
}

/** Order-level figures that only the lines can supply. */
export interface OrderLineSummary {
  /** Number of lines, which is what customer_orders.items_count records. */
  itemsCount: number
  /** Gross minus net across the lines, i.e. the money the discounts took off. */
  discountTotal: number
}

/**
 * Roll a set of order lines up into the order-level columns.
 *
 * sale.order has no order-level discount field - the discount lives per line -
 * so it is recovered as list price minus the discounted subtotal.
 */
export function summariseOrderLines(lines: readonly OrderLineRow[]): OrderLineSummary {
  let gross = 0
  let net = 0

  for (const line of lines) {
    const quantity = line.quantity ?? 0
    const unit = line.price_unit ?? 0
    const subtotal = line.price_subtotal ?? 0
    gross += quantity * unit
    net += subtotal
  }

  return {
    itemsCount: lines.length,
    discountTotal: round2(Math.max(0, gross - net)),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Order states excluded from a customer's spend.
 *
 * A cancelled order was never money, and a quotation is not money yet. Odoo's
 * `sale.order.state` is one of draft, sent, sale, done, cancel: the first two
 * are unconfirmed quotations, so only `sale` and `done` represent revenue.
 *
 * This matters beyond the displayed number. Spend feeds the enrichment
 * prioritisation, so counting quotations would push budget toward customers who
 * were quoted a large job and never bought.
 */
export const NON_REVENUE_ORDER_STATES: ReadonlySet<string> = new Set([
  'cancel',
  'draft',
  'sent',
])

/** The columns of customer_orders that feed the aggregates on customers. */
export interface AggregateOrderRow {
  customer_id: string
  order_date: string | null
  total: number | string | null
  items_count: number | string | null
  status: string | null
}

/** The aggregate columns recomputed on customers after every sync. */
export interface CustomerAggregates {
  total_spent: number
  order_count: number
  item_count: number
  first_order_date: string | null
  last_order_date: string | null
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Recompute per-customer totals from that customer's full order history.
 *
 * Callers must pass every order the customer has, not just the ones inside the
 * sync window, or an incremental run would shrink the totals.
 */
export function computeCustomerAggregates(
  orders: readonly AggregateOrderRow[],
): Map<string, CustomerAggregates> {
  const byCustomer = new Map<string, CustomerAggregates>()

  for (const order of orders) {
    if (!order.customer_id) continue

    const status = order.status?.toLowerCase() ?? ''
    if (NON_REVENUE_ORDER_STATES.has(status)) continue

    let aggregate = byCustomer.get(order.customer_id)
    if (!aggregate) {
      aggregate = {
        total_spent: 0,
        order_count: 0,
        item_count: 0,
        first_order_date: null,
        last_order_date: null,
      }
      byCustomer.set(order.customer_id, aggregate)
    }

    aggregate.total_spent += toNumber(order.total)
    aggregate.order_count += 1
    aggregate.item_count += toNumber(order.items_count)

    if (order.order_date) {
      if (!aggregate.first_order_date || order.order_date < aggregate.first_order_date) {
        aggregate.first_order_date = order.order_date
      }
      if (!aggregate.last_order_date || order.order_date > aggregate.last_order_date) {
        aggregate.last_order_date = order.order_date
      }
    }
  }

  for (const aggregate of byCustomer.values()) {
    aggregate.total_spent = round2(aggregate.total_spent)
  }

  return byCustomer
}

/** The zero row, for customers whose orders all vanished or were cancelled. */
export function emptyAggregates(): CustomerAggregates {
  return {
    total_spent: 0,
    order_count: 0,
    item_count: 0,
    first_order_date: null,
    last_order_date: null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCHING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Split a list into fixed-size batches.
 *
 * A full sync can move 20k customers; sending that as one statement would
 * blow past PostgREST's request limits.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}
