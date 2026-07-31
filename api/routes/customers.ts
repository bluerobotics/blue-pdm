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
 *
 * ---------------------------------------------------------------------------
 * INCREMENTAL BY DEFAULT
 * ---------------------------------------------------------------------------
 * The first run mirrors everything. Every run after it pulls only what Odoo
 * has written since the last SUCCESSFUL run, anchored on Odoo's own
 * `write_date` and resumed from integration_sync_log.sync_watermark.
 *
 * Two things the window cannot see are handled separately, because a sync that
 * quietly stopped noticing them would be worse than a slow one:
 *
 *   - A line edited without its order's write_date moving. Changed lines are
 *     probed on their own and their orders folded into the refresh set.
 *   - A customer deleted from Odoo, which by definition writes nothing. Step 9
 *     sweeps with an id-only `search`, which moves ints rather than records and
 *     so stays cheap enough to run every time.
 *
 * ---------------------------------------------------------------------------
 * ORDERS BELONG TO THE COMPANY
 * ---------------------------------------------------------------------------
 * An order is credited to the company - the `commercial_partner_id` of the
 * partner named in `partner_id` - not to the contact itself. That field lives
 * on res.partner and not on sale.order, so step 4a assembles the contact ->
 * company map from partner records, reading whichever contacts and companies
 * the customer pull did not already return. See resolveOrderOwner(). The
 * contact is kept on customer_orders.contact_id.
 */

import { FastifyPluginAsync } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeOdooUrl, odooReadOnlyCall, sendError, ErrorCode } from '../utils/index.js'
import { requireTeamPermission } from '../middleware/index.js'
import { createSupabaseAdminClient } from '../src/infrastructure/supabase.js'
import {
  credentialSetupProblem,
  getCredential,
  openCredentialStore,
} from '../src/integrations/credentialStore.js'
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
  changedSinceDomain,
  chunk,
  commercialPartnerMap,
  computeCustomerAggregates,
  customerDomain,
  customerMarker,
  emptyAggregates,
  fillMissingColumns,
  idsNotYetPulled,
  intersectFields,
  isCustomerPartner,
  latestWriteDate,
  many2oneErpId,
  many2oneId,
  mapOrderLine,
  mapRecord,
  mappedColumns,
  nextWatermark,
  odooNumber,
  orderContactIds,
  parseFieldsGet,
  parseIdList,
  planOrderRefresh,
  resolveOrderOwner,
  resolveStickyAccountId,
  summariseOrderLines,
} from '../src/customers/odooSync.js'
import type {
  AggregateOrderRow,
  CustomerMarker,
  OdooRecord,
  PartialRow,
} from '../src/customers/odooSync.js'
import type { Account } from '../src/customers/types.js'

/** Rows per Supabase write. A full sync can move 20k customers. */
const WRITE_CHUNK = 500
/** Rows per Supabase read page. */
const READ_PAGE = 1000
/** Records per Odoo search_read page. */
const ODOO_PAGE = 500
/** Ids per Odoo `search` page. Far larger than ODOO_PAGE: these are bare ints. */
const ODOO_ID_PAGE = 10000
/** Ids per `IN` clause, kept well under URL and statement limits. */
const IN_CHUNK = 200
/** Hard stop on a single model's pull, so a runaway query cannot hang a sync. */
const MAX_ODOO_RECORDS = 100000

type Row = Record<string, unknown>

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT LABELS
// ═══════════════════════════════════════════════════════════════════════════════

/** One member's suggestion for what its account should be called. */
interface AccountNameCandidate {
  displayName: string
  source: Account['source']
  /** True when the suggestion comes from the company's own res.partner record. */
  fromCompanyRecord: boolean
}

/**
 * How authoritative each rule's label is.
 *
 * A company name is the thing a human would write down. An email domain is a
 * serviceable stand-in. A person's name only names the account when the account
 * really is that person, which is why it must never overwrite the other two.
 */
const NAME_SOURCE_RANK: Record<Account['source'], number> = {
  'company-name': 2,
  'email-domain': 1,
  individual: 0,
}

function nameCandidateFor(account: Account, row: PartialRow): AccountNameCandidate {
  return {
    displayName: account.displayName,
    source: account.source,
    fromCompanyRecord: row.is_company === true,
  }
}

/**
 * Whether one candidate label beats another.
 *
 * Every tier is decided, down to comparing the strings themselves, so that a
 * run cannot pick a different winner from the same members and leave two syncs
 * renaming an account back and forth.
 */
function outranks(candidate: AccountNameCandidate, incumbent: AccountNameCandidate): boolean {
  const bySource = NAME_SOURCE_RANK[candidate.source] - NAME_SOURCE_RANK[incumbent.source]
  if (bySource !== 0) return bySource > 0

  if (candidate.fromCompanyRecord !== incumbent.fromCompanyRecord) {
    return candidate.fromCompanyRecord
  }

  return candidate.displayName < incumbent.displayName
}

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

/**
 * How many records a pull will return, so progress has a real denominator
 * instead of a number that climbs forever. Null when Odoo will not say.
 */
async function searchCount(
  cfg: OdooConfig,
  model: string,
  domain: unknown[],
): Promise<number | null> {
  const value = await odooCall(cfg, model, 'search_count', [domain])
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Page through a search_read until the model is exhausted. */
async function searchReadAll(
  cfg: OdooConfig,
  model: string,
  domain: unknown[],
  fields: readonly string[],
  progress?: ProgressSink,
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
    // Between pages, with nothing written yet: the cheapest possible place to
    // abandon a sync.
    await progress?.checkpoint(out.length)
    if (page.length < ODOO_PAGE) break
  }
  return out
}

/**
 * Page through a `search`, which answers with bare ids instead of records.
 *
 * This is what makes the disappearance sweep affordable on every run: the
 * whole customer list comes back as integers, so an org with 20k of them costs
 * two calls and a few hundred kilobytes rather than a full re-read.
 */
async function searchAllIds(
  cfg: OdooConfig,
  model: string,
  domain: unknown[],
  progress?: ProgressSink,
): Promise<number[]> {
  const out: number[] = []
  for (let offset = 0; out.length < MAX_ODOO_RECORDS; offset += ODOO_ID_PAGE) {
    const page = parseIdList(
      await odooCall(cfg, model, 'search', [domain], {
        limit: ODOO_ID_PAGE,
        offset,
        order: 'id asc',
      }),
    )
    out.push(...page)
    await progress?.tick(out.length)
    if (page.length < ODOO_ID_PAGE) break
  }
  return out
}

/** Read specific ids, batched. Used for the shipping-address partners. */
async function readByIds(
  cfg: OdooConfig,
  model: string,
  ids: readonly number[],
  fields: readonly string[],
  progress?: ProgressSink,
): Promise<OdooRecord[]> {
  const out: OdooRecord[] = []
  for (const batch of chunk(ids, ODOO_PAGE)) {
    out.push(...asRecords(await odooCall(cfg, model, 'read', [batch, [...fields]], {})))
    await progress?.checkpoint(out.length)
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
  progress?: ProgressSink,
): Promise<OdooRecord[]> {
  const out: OdooRecord[] = []
  for (const batch of chunk(parentIds, IN_CHUNK)) {
    // The inner pager counts from zero for each batch, so its progress is
    // rebased onto the running total.
    out.push(
      ...(await searchReadAll(
        cfg,
        model,
        [[parentField, 'in', batch]],
        fields,
        offsetProgress(progress, out.length),
      )),
    )
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
  progress?: ProgressSink,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const batch = await exec(page(from, from + READ_PAGE - 1), what)
    rows.push(...batch)
    await progress?.tick(rows.length)
    if (batch.length < READ_PAGE) break
  }
  return rows
}

/**
 * Upsert in batches, returning whatever the caller asked to have selected.
 *
 * `progress` reports between batches. Pass a sink whose checkpoint can throw
 * only where a half-written table is acceptable - every upsert here is keyed on
 * a unique constraint, so a partial run is a partial mirror the next sync
 * finishes, not corruption.
 */
async function upsertChunked(
  db: SupabaseClient,
  table: string,
  rows: readonly PartialRow[],
  onConflict: string,
  select: string,
  options: { ignoreDuplicates?: boolean; progress?: ProgressSink } = {},
): Promise<Row[]> {
  const returned: Row[] = []
  let written = 0
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
    written += batch.length
    await options.progress?.tick(written, rows.length)
  }
  return returned
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC RUN: live progress, heartbeat and cooperative cancellation
// ═══════════════════════════════════════════════════════════════════════════════
//
// A sync is one long HTTP request that can run for many minutes. The client
// that started it may close before it finishes, and a second client may want to
// watch or stop it. So the run's state lives in integration_sync_log rather
// than in this process:
//
//   - It survives the client disconnecting, which is what lets the app be
//     closed mid-sync and still show progress when it reopens.
//   - It works if the API is ever scaled past one replica, where an in-memory
//     cancel flag would reach the wrong instance.
//
// Every write goes through the service-role client, because the table's RLS
// only grants SELECT to holders of `system:integrations` view - a permission a
// customers user has no reason to hold.

/**
 * The ordered phases of a sync. The index is the determinate part of the
 * progress bar; `progress_current` refines it within a phase.
 *
 * Keep in step with the phase transitions in the handler below.
 */
const SYNC_PHASES = [
  'Connecting to Odoo',
  'Checking available fields',
  'Reading orders from Odoo',
  'Finding orders with changed lines',
  'Reading customers from Odoo',
  'Reading order contacts from Odoo',
  'Reading order companies from Odoo',
  'Reading shipping addresses',
  'Reading order lines',
  'Saving customers and accounts',
  'Saving addresses',
  'Saving orders',
  'Saving order lines',
  'Recalculating totals',
  'Checking for removed customers',
  'Finishing up',
] as const

type SyncPhase = (typeof SYNC_PHASES)[number]

/**
 * A running row whose heartbeat is older than this is treated as abandoned -
 * the process holding it died without getting to its `finally`. Comfortably
 * longer than the 30s ceiling on a single Odoo call plus a progress write.
 */
const HEARTBEAT_STALE_MS = 90_000
/** Floor on the gap between progress writes, so tight loops cannot flood PG. */
const PROGRESS_WRITE_MS = 1000
/** Floor on the gap between cancel_requested reads. */
const CANCEL_POLL_MS = 2000

/**
 * The slice of a run the paging helpers need. Narrower than SyncRun so those
 * helpers can be handed a rebased view of progress without knowing about the
 * run row.
 *
 * Cancellation is a return value, never an exception. A pager that is told to
 * stop simply breaks and returns what it has; the handler then sees
 * `run.cancelled` at the next phase boundary and returns early. Keeping it out
 * of the exception channel is what lets the sync body stay a flat sequence of
 * steps with no unwinding to reason about.
 */
interface ProgressSink {
  /**
   * Report progress. Resolves true when the caller should stop paging.
   * Only call this where stopping is safe.
   */
  checkpoint(current: number, total?: number | null): Promise<boolean>
  /** Report progress only. Used inside sections that must not be interrupted. */
  tick(current: number, total?: number | null): Promise<void>
}

interface FinishFields {
  processed?: number
  created?: number
  updated?: number
  skipped?: number
  error?: string | null
  details?: unknown
  /**
   * How far through Odoo's write_date history this run got. Written only on
   * success, so a run that stopped early leaves its window to be re-read.
   */
  watermark?: string | null
}

/**
 * Owns one integration_sync_log row for the life of a sync.
 *
 * Progress reporting is best-effort by construction: a failed write is logged
 * and swallowed, because losing the progress bar is a far better outcome than
 * failing a ten-minute sync over it. Cancellation reads fail the same way, open
 * rather than closed - a transient read error lets the sync continue.
 */
class SyncRun implements ProgressSink {
  private phaseIndex = 0
  private phaseLabel: SyncPhase = SYNC_PHASES[0]
  private total: number | null = null
  private lastWriteAt = 0
  private lastCancelCheckAt = 0
  private observedCancel = false

  constructor(
    private readonly db: SupabaseClient,
    readonly id: string,
    private readonly log: { warn: (obj: unknown, msg: string) => void },
  ) {}

  /** Enter a phase. Always writes, so the label never lags behind the work. */
  async setPhase(phase: SyncPhase, total: number | null = null): Promise<void> {
    this.phaseIndex = SYNC_PHASES.indexOf(phase)
    this.phaseLabel = phase
    this.total = total
    this.lastWriteAt = 0
    await this.write({ progress_current: 0 })
  }

  async tick(current: number, total?: number | null): Promise<void> {
    if (total !== undefined) this.total = total
    if (Date.now() - this.lastWriteAt < PROGRESS_WRITE_MS) return
    await this.write({ progress_current: current })
  }

  /**
   * Report progress and report back whether to stop. Callers place this only
   * where stopping leaves the mirror in a state the next sync can complete.
   */
  async checkpoint(current: number, total?: number | null): Promise<boolean> {
    await this.tick(current, total)
    return this.isCancelRequested()
  }

  /** True once someone has asked this run to stop. Sticky. */
  get cancelled(): boolean {
    return this.observedCancel
  }

  private async isCancelRequested(): Promise<boolean> {
    if (this.observedCancel) return true
    if (Date.now() - this.lastCancelCheckAt < CANCEL_POLL_MS) return false
    this.lastCancelCheckAt = Date.now()

    const { data, error } = await this.db
      .from('integration_sync_log')
      .select('cancel_requested')
      .eq('id', this.id)
      .single()

    // Fail open: a transient read error lets a long sync finish rather than
    // killing it on a blip.
    if (error) {
      this.log.warn({ err: error, runId: this.id }, '[CustomerSync] cancel check failed')
      return false
    }
    if (data?.cancel_requested) {
      this.observedCancel = true
      return true
    }
    return false
  }

  async finish(
    status: 'success' | 'failed' | 'cancelled',
    fields: FinishFields = {},
  ): Promise<void> {
    const closing = {
      status,
      completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      phase: status === 'success' ? 'Done' : this.phaseLabel,
      records_processed: fields.processed ?? 0,
      records_created: fields.created ?? 0,
      records_updated: fields.updated ?? 0,
      records_skipped: fields.skipped ?? 0,
      error_message: fields.error ?? null,
      error_details: (fields.details ?? null) as never,
    }

    // Only a successful run may move the watermark. Anything else leaves the
    // previous one standing, so the next run re-reads the window this one did
    // not finish.
    const advances = status === 'success' && fields.watermark != null
    const { error } = await this.db
      .from('integration_sync_log')
      .update(advances ? { ...closing, sync_watermark: fields.watermark } : closing)
      .eq('id', this.id)

    if (!error) return
    this.log.warn({ err: error, runId: this.id }, '[CustomerSync] finish write failed')

    // A database that predates the watermark column rejects the whole update,
    // which would leave this row saying 'running' until its heartbeat went
    // stale and blocked the next sync. Closing it without the watermark costs
    // only the incremental window: the next run does a full pull.
    if (!advances) return
    const retry = await this.db
      .from('integration_sync_log')
      .update(closing)
      .eq('id', this.id)
    if (retry.error) {
      this.log.warn(
        { err: retry.error, runId: this.id },
        '[CustomerSync] finish write failed without the watermark too',
      )
    }
  }

  private async write(extra: Record<string, unknown>): Promise<void> {
    this.lastWriteAt = Date.now()
    const { error } = await this.db
      .from('integration_sync_log')
      .update({
        phase: this.phaseLabel,
        phase_index: this.phaseIndex,
        phase_count: SYNC_PHASES.length,
        progress_total: this.total,
        heartbeat_at: new Date().toISOString(),
        ...extra,
      })
      .eq('id', this.id)

    if (error) this.log.warn({ err: error, runId: this.id }, '[CustomerSync] progress write failed')
  }
}

/** Rebase a sink's counter, for a pager that restarts at zero per batch. */
function offsetProgress(progress: ProgressSink | undefined, base: number): ProgressSink | undefined {
  if (!progress) return undefined
  return {
    checkpoint: (current, total) => progress.checkpoint(base + current, total),
    tick: (current, total) => progress.tick(base + current, total),
  }
}

// Note on where a sync can stop: only the Odoo pagers call `checkpoint`, and
// they all run in phases 3 to 7, before anything is written. The write phases
// use `tick` alone and are interrupted at their phase boundary instead, which
// keeps chunked upserts atomic-per-batch. From step 7e onward the handler stops
// checking entirely: order lines are replaced with a delete followed by an
// insert, and stopping between the two would leave those orders with no lines
// at all - worse than either finishing or never starting.

/** Shape returned by the status endpoint and by a sync that was stopped. */
interface SyncRunView {
  run_id: string
  status: string
  phase: string | null
  phase_index: number | null
  phase_count: number | null
  progress_current: number | null
  progress_total: number | null
  started_at: string | null
  completed_at: string | null
  heartbeat_at: string | null
  cancel_requested: boolean
  error_message: string | null
  records_created: number | null
  records_updated: number | null
  /** True when status says running but the process holding it has gone quiet. */
  stale: boolean
}

function isStale(row: Row): boolean {
  if (row.status !== 'running') return false
  const beat = text(row.heartbeat_at) ?? text(row.started_at)
  if (!beat) return true
  return Date.now() - new Date(beat).getTime() > HEARTBEAT_STALE_MS
}

function toRunView(row: Row): SyncRunView {
  return {
    run_id: String(row.id),
    status: String(row.status),
    phase: text(row.phase),
    phase_index: (row.phase_index as number | null) ?? null,
    phase_count: (row.phase_count as number | null) ?? null,
    progress_current: (row.progress_current as number | null) ?? null,
    progress_total: (row.progress_total as number | null) ?? null,
    started_at: text(row.started_at),
    completed_at: text(row.completed_at),
    heartbeat_at: text(row.heartbeat_at),
    cancel_requested: row.cancel_requested === true,
    error_message: text(row.error_message),
    records_created: (row.records_created as number | null) ?? null,
    records_updated: (row.records_updated as number | null) ?? null,
    stale: isStale(row),
  }
}

const RUN_COLUMNS =
  'id, status, phase, phase_index, phase_count, progress_current, progress_total, ' +
  'started_at, completed_at, heartbeat_at, cancel_requested, error_message, ' +
  'records_created, records_updated'

/**
 * PostgREST cannot infer a row shape from a column list assembled at runtime,
 * so it falls back to an error-ish type. The rows here are read back through
 * `toRunView`, which does its own per-field narrowing.
 */
function asRow(value: unknown): Row {
  return value as Row
}

/**
 * Runs owned by an in-flight request, so the route's onError hook can close a
 * row out when the handler throws.
 *
 * A WeakMap rather than a property on the request keeps this out of the shared
 * Fastify type declarations, and lets a finished request be collected without
 * anyone remembering to clean up.
 */
const runsInFlight = new WeakMap<object, { run: SyncRun; integrationId: string }>()

/**
 * Record the outcome on the integration row.
 *
 * Uses the service-role client deliberately. The RLS policy on
 * organization_integrations only allows an UPDATE from an org admin, so doing
 * this as the caller silently records nothing for everyone else - which is why
 * last_sync_at could previously go stale for a non-admin who ran a sync.
 */
async function markIntegration(
  admin: SupabaseClient,
  integrationId: string,
  status: 'success' | 'failed' | 'cancelled',
  error: string | null,
  count?: number,
): Promise<void> {
  const nowIso = new Date().toISOString()
  await admin
    .from('organization_integrations')
    .update({
      is_connected: status !== 'failed',
      last_connected_at: nowIso,
      last_error: error,
      last_sync_at: nowIso,
      last_sync_status: status,
      ...(count === undefined ? {} : { last_sync_count: count }),
    })
    .eq('id', integrationId)
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
          'Mirror customers, orders and order lines from Odoo. Incremental by default: pulls only what Odoo has written since the last successful run. Read-only against Odoo; never deletes customers, accounts or enrichment.',
        tags: ['Customers'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: {
              type: 'string',
              description:
                'ISO timestamp overriding the stored watermark. Restricts every pull to records whose Odoo write_date is at or after this instant.',
            },
            full: {
              type: 'boolean',
              description:
                'Ignore the stored watermark and re-read everything. Slow, and only needed after changing what the sync maps or to repair a mirror by hand.',
            },
          },
        },
      },
      preHandler: [fastify.authenticate, requireTeamPermission('module:customers', 'create')],
      // The sync body is a flat sequence of steps with no try/finally around
      // it, so this is what stops a thrown error from leaving a row stuck in
      // 'running' until its heartbeat goes stale.
      onError: async (request, _reply, error) => {
        const tracked = runsInFlight.get(request)
        if (!tracked) return
        runsInFlight.delete(request)
        const message = error instanceof Error ? error.message : String(error)
        await tracked.run.finish('failed', { error: message })
        await markIntegration(
          createSupabaseAdminClient(),
          tracked.integrationId,
          'failed',
          message,
        )
      },
    },
    async (request, reply) => {
      const startedAt = Date.now()

      // org_id comes from the authenticated user, never from the request body.
      if (!request.user?.org_id || !request.supabase) {
        return sendError(reply, 401, ErrorCode.UNAUTHORIZED, 'Authentication required')
      }
      const orgId = request.user.org_id
      const userId = request.user.id

      const body = (request.body ?? {}) as { since?: string; full?: boolean }
      let requestedSince: Date | null = null
      if (body.since) {
        const parsed = new Date(body.since)
        if (Number.isNaN(parsed.getTime())) {
          return sendError(reply, 400, ErrorCode.BAD_REQUEST, '`since` is not a valid timestamp')
        }
        requestedSince = parsed
      }
      const forceFull = body.full === true

      // ── 1. Odoo connection config, loaded exactly like the supplier sync ────
      const { data: integration } = await request.supabase
        .from('organization_integrations')
        .select('id, settings')
        .eq('org_id', orgId)
        .eq('integration_type', 'odoo')
        .single()

      if (!integration) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'Odoo integration not configured')
      }

      // ── 1a. Refuse to start a second sync for this org ─────────────────────
      // Two concurrent runs race on the same upserts. This is the only thing
      // preventing that, since the client-side guard cannot see other clients.
      const admin = createSupabaseAdminClient()
      const { data: inFlight } = await admin
        .from('integration_sync_log')
        .select(RUN_COLUMNS)
        .eq('org_id', orgId)
        .eq('integration_id', integration.id)
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (inFlight) {
        if (!isStale(asRow(inFlight))) {
          reply.code(409)
          return {
            success: false,
            code: ErrorCode.CONFLICT,
            message: 'A sync is already running for this organization.',
            run: toRunView(asRow(inFlight)),
          }
        }
        // The heartbeat stopped: whatever process held this row is gone, so the
        // row is closed out rather than blocking every future sync forever.
        await admin
          .from('integration_sync_log')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'The sync stopped reporting and was assumed to have died.',
          })
          .eq('id', String(asRow(inFlight).id))
      }

      // ── 1a-ii. Where the last successful run got to ────────────────────────
      // Read before the new row is opened so there is no chance of matching it.
      // Any failure here - including a database that predates the column - is
      // read as "no watermark", which costs a full pull and never correctness.
      let previousWatermark: Date | null = null
      if (!forceFull) {
        const { data: lastRun, error: watermarkError } = await admin
          .from('integration_sync_log')
          .select('sync_watermark')
          .eq('org_id', orgId)
          .eq('integration_id', integration.id)
          .eq('sync_type', 'customers')
          .eq('status', 'success')
          .not('sync_watermark', 'is', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (watermarkError) {
          request.log.warn(
            { err: watermarkError },
            '[CustomerSync] could not read the last watermark; falling back to a full sync',
          )
        } else {
          const stored = text(asRow(lastRun ?? {}).sync_watermark)
          const parsed = stored ? new Date(stored) : null
          if (parsed && !Number.isNaN(parsed.getTime())) previousWatermark = parsed
        }
      }

      // ── 1b. Open the run row ───────────────────────────────────────────────
      const { data: runRow, error: runError } = await admin
        .from('integration_sync_log')
        .insert({
          org_id: orgId,
          integration_id: integration.id,
          sync_type: 'customers',
          sync_direction: 'pull',
          status: 'running',
          started_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          phase: SYNC_PHASES[0],
          phase_index: 0,
          phase_count: SYNC_PHASES.length,
          triggered_by: userId,
          trigger_type: 'manual',
        })
        .select('id')
        .single()

      if (runError || !runRow) {
        request.log.error({ err: runError }, '[CustomerSync] could not open a sync run')
        return sendError(
          reply,
          500,
          ErrorCode.INTERNAL_ERROR,
          'Could not start the sync: the run could not be recorded.',
        )
      }

      const run = new SyncRun(admin, String(runRow.id), request.log)
      // The onError hook closes this row out if the handler throws.
      runsInFlight.set(request, { run, integrationId: integration.id })

      /** Everything a stopped or finished run reports back to the caller. */
      const cancelledResponse = async () => {
        await run.finish('cancelled', {
          error: 'Stopped at your request. The next sync picks up where this one left off.',
        })
        await markIntegration(admin, integration.id, 'cancelled', null)
        runsInFlight.delete(request)
        return {
          success: true,
          cancelled: true,
          run_id: run.id,
          duration_ms: Date.now() - startedAt,
        }
      }

      const settings = (integration.settings ?? {}) as Record<string, unknown>
      const rawUrl = text(settings.url)
      const database = text(settings.database)
      const username = text(settings.username)

      // The key is deliberately not on the integration row: that row is readable
      // by every member of the org, so the credential lives in a table only the
      // service-role client can reach.
      let apiKey: string | null
      try {
        apiKey = text(
          await getCredential(openCredentialStore(), 'organization_integration', integration.id),
        )
      } catch (err) {
        // A misconfigured deployment is fixed by setting an env var, so the
        // message has to survive the production handler that would otherwise
        // replace it with "Internal server error".
        const problem = credentialSetupProblem(err)
        if (!problem) throw err
        request.log.error({ err }, 'Odoo credential store is not usable')
        return sendError(reply, 503, ErrorCode.INTERNAL_ERROR, problem)
      }

      if (!rawUrl || !database || !username) {
        return sendError(reply, 400, ErrorCode.BAD_REQUEST, 'Odoo integration is missing connection details')
      }

      if (!apiKey) {
        return sendError(
          reply,
          400,
          ErrorCode.BAD_REQUEST,
          'The Odoo integration has no stored API key. Re-enter it in Settings and save.',
        )
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
      await run.setPhase('Checking available fields')
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

      // ── 2a. Decide between a full mirror and a diff ────────────────────────
      // `marker` is how a res.partner says it is a customer: customer_rank on
      // Odoo 13+, the `customer` boolean before that, neither on an Odoo with
      // no sales app.
      //
      // A diff needs write_date on all three models, and a marker to partition
      // the unfiltered partner pull with. Without any one of those the run
      // falls back to a full mirror rather than silently mirroring a subset.
      const marker: CustomerMarker = customerMarker(partnerFieldSet)
      const canDiff =
        marker !== null &&
        partnerFieldSet.has('write_date') &&
        orderFieldSet.has('write_date') &&
        lineFieldSet.has('write_date')

      const since = forceFull ? null : (requestedSince ?? previousWatermark)
      const incremental = canDiff && since !== null
      request.log.info({
        msg: '[CustomerSync] sync mode',
        mode: incremental ? 'incremental' : 'full',
        since: since?.toISOString() ?? null,
        canDiff,
        forceFull,
      })

      // ── 3. Pull sale.order for the window ──────────────────────────────────
      // search_count first so the progress bar has a real denominator. One
      // extra cheap call buys the difference between "3,500 of 20,000" and a
      // number that climbs with no end in sight.
      const orderDomain = changedSinceDomain(incremental ? since : null)
      await run.setPhase('Reading orders from Odoo', await searchCount(cfg, 'sale.order', orderDomain))
      const changedOrders = await searchReadAll(
        cfg,
        'sale.order',
        orderDomain,
        orderPlan.selected,
        run,
      )
      if (run.cancelled) return cancelledResponse()

      // ── 3a. Fold in orders whose lines changed underneath them ─────────────
      // Editing a line does not reliably move its order's write_date, so an
      // order-only diff would mirror stale line data indefinitely. The probe
      // asks only for order_id, so it stays cheap even when a lot changed.
      await run.setPhase('Finding orders with changed lines')
      let odooOrders = changedOrders
      let changedLines: OdooRecord[] = []
      if (incremental && lineFieldSet.has('order_id')) {
        changedLines = await searchReadAll(
          cfg,
          'sale.order.line',
          changedSinceDomain(since),
          ['id', 'order_id', 'write_date'],
          run,
        )
        const refresh = planOrderRefresh(changedOrders, changedLines)
        if (refresh.toFetch.length > 0) {
          // These orders did not change themselves, but items_count and
          // discount are recomputed from their lines and written onto the
          // order row, so the row has to be rewritten alongside them.
          odooOrders = [
            ...changedOrders,
            ...(await readByIds(cfg, 'sale.order', refresh.toFetch, orderPlan.selected, run)),
          ]
        }
      }
      if (run.cancelled) return cancelledResponse()

      // ── 4. Pull res.partner ────────────────────────────────────────────────
      // A diff deliberately drops the customer filter: a shipping address is a
      // res.partner too, and usually carries no customer marker, so filtering
      // here would mean address edits were never mirrored. One pull covers
      // both, and `isCustomerPartner` does the partitioning the domain would
      // have done.
      //
      // With no marker at all the fallback is the partners the orders in hand
      // reference, which is a partial view - so the sweep in step 9 is
      // suppressed, otherwise it would flag every customer it did not pull as
      // gone from Odoo.
      let odooPartners: OdooRecord[]
      let changedNonCustomers: OdooRecord[] = []
      const partnerPullIsComplete = marker !== null

      if (incremental) {
        const domain = changedSinceDomain(since)
        await run.setPhase(
          'Reading customers from Odoo',
          await searchCount(cfg, 'res.partner', domain),
        )
        const changedPartners = await searchReadAll(
          cfg,
          'res.partner',
          domain,
          intersectFields([...PARTNER_FIELDS, ...ADDRESS_FIELDS], partnerFieldSet).selected,
          run,
        )
        odooPartners = changedPartners.filter((partner) => isCustomerPartner(partner, marker))
        changedNonCustomers = changedPartners.filter(
          (partner) => !isCustomerPartner(partner, marker),
        )
      } else if (marker !== null) {
        const domain = customerDomain(marker)
        await run.setPhase(
          'Reading customers from Odoo',
          await searchCount(cfg, 'res.partner', domain),
        )
        odooPartners = await searchReadAll(cfg, 'res.partner', domain, partnerPlan.selected, run)
      } else {
        const partnerIds = orderContactIds(odooOrders)
        await run.setPhase('Reading customers from Odoo', partnerIds.length)
        odooPartners = await readByIds(cfg, 'res.partner', partnerIds, partnerPlan.selected, run)
      }
      if (run.cancelled) return cancelledResponse()

      // ── 4a. Work out which company each order belongs to ───────────────────
      // Only res.partner knows this. Standard Odoo puts `commercial_partner_id`
      // on the partner and not on sale.order, so the answer has to be assembled
      // from partner records rather than read off the orders.
      const partnerRecordByErpId = new Map<string, OdooRecord>()
      for (const partner of [...odooPartners, ...changedNonCustomers]) {
        const id = odooNumber(partner.id)
        if (id !== null) partnerRecordByErpId.set(String(id), partner)
      }

      // A contact named on an order whose record we do not hold has an unknown
      // company, and defaulting it to itself is what leaves a company reading
      // as churned. What lands here is small: partners Odoo does not flag as
      // customers on a full run, and on an incremental run only the contacts on
      // the handful of orders in the window.
      const orderContactErpIds = orderContactIds(odooOrders).map(String)
      const unknownContactIds = idsNotYetPulled(
        orderContactErpIds,
        new Set(partnerRecordByErpId.keys()),
      )

      let orderContactRecords: OdooRecord[] = []
      if (unknownContactIds.length > 0) {
        await run.setPhase('Reading order contacts from Odoo', unknownContactIds.length)
        orderContactRecords = await readByIds(
          cfg,
          'res.partner',
          unknownContactIds,
          partnerPlan.selected,
          run,
        )
      }
      if (run.cancelled) return cancelledResponse()

      const commercialByContactErpId = commercialPartnerMap([
        ...partnerRecordByErpId.values(),
        ...orderContactRecords,
      ])

      // The company an order rolls up to can sit at customer_rank 0 in Odoo when
      // its contacts place every order, so the customer domain never returns it
      // and the roll-up would have nothing to point at. Only companies that
      // actually receive an order are topped up - resolving every contact's
      // parent would mirror a pile of companies that never bought anything.
      const orderCompanyErpIds = new Set(
        orderContactErpIds.map((erpId) => commercialByContactErpId.get(erpId) ?? erpId),
      )
      const pulledCustomerErpIds = new Set(
        odooPartners
          .map((partner) => odooNumber(partner.id))
          .filter((id): id is number => id !== null)
          .map(String),
      )
      const commercialTopUpIds = idsNotYetPulled(orderCompanyErpIds, pulledCustomerErpIds)

      // These partners were pulled because an order points at them, not because
      // Odoo calls them customers, so the sweep in step 9 must not read their
      // absence from the customer domain as a disappearance.
      const commercialOnlyErpIds = new Set(commercialTopUpIds.map(String))

      if (commercialTopUpIds.length > 0) {
        await run.setPhase('Reading order companies from Odoo', commercialTopUpIds.length)
        odooPartners = [
          ...odooPartners,
          ...(await readByIds(cfg, 'res.partner', commercialTopUpIds, partnerPlan.selected, run)),
        ]
      }
      if (run.cancelled) return cancelledResponse()

      // ── 5. Resolve partner_shipping_id, itself a res.partner ───────────────
      // Two sources feed this. The orders being written name the addresses
      // their rows must point at. Separately, an address already in the mirror
      // may simply have been edited in Odoo, with no order touched at all -
      // those arrive in `changedNonCustomers`, and are kept only if we already
      // store them, so that editing an unrelated vendor does not file it here
      // as a shipping address.
      await run.setPhase('Reading shipping addresses')
      const shippingIds = new Set(
        odooOrders
          .map((order) => many2oneId(order.partner_shipping_id))
          .filter((id): id is number => id !== null),
      )

      const changedPartnerById = new Map<number, OdooRecord>()
      for (const partner of changedNonCustomers) {
        const id = odooNumber(partner.id)
        if (id !== null) changedPartnerById.set(id, partner)
      }

      if (changedPartnerById.size > 0) {
        const candidates = [...changedPartnerById.keys()].map(String)
        for (const batch of chunk(candidates, IN_CHUNK)) {
          const rows = await exec(
            admin
              .from('customer_addresses')
              .select('erp_id')
              .eq('org_id', orgId)
              .in('erp_id', batch),
            'customer_addresses erp_id select',
          )
          for (const row of rows) {
            const id = odooNumber(text(row.erp_id))
            if (id !== null) shippingIds.add(id)
          }
        }
      }

      // Records already in hand from the partner pull cost nothing; the rest
      // have to be read by id.
      const addressesInHand = [...shippingIds]
        .map((id) => changedPartnerById.get(id))
        .filter((record): record is OdooRecord => record !== undefined)
      const addressIdsToRead = [...shippingIds].filter((id) => !changedPartnerById.has(id))

      await run.tick(addressesInHand.length, shippingIds.size)
      const odooAddresses = [
        ...addressesInHand,
        ...(addressIdsToRead.length
          ? await readByIds(
              cfg,
              'res.partner',
              addressIdsToRead,
              addressPlan.selected,
              offsetProgress(run, addressesInHand.length),
            )
          : []),
      ]
      if (run.cancelled) return cancelledResponse()

      // ── 6. Pull sale.order.line for those orders ───────────────────────────
      const odooOrderIds = odooOrders
        .map((order) => odooNumber(order.id))
        .filter((id): id is number => id !== null)
      const linesAvailable = lineFieldSet.has('order_id') && odooOrderIds.length > 0
      await run.setPhase('Reading order lines')
      const odooLines = linesAvailable
        ? await searchReadByParentIds(
            cfg,
            'sale.order.line',
            'order_id',
            odooOrderIds,
            linePlan.selected,
            run,
          )
        : []
      if (run.cancelled) return cancelledResponse()

      // ── 7. Upsert into Supabase with the service-role client ───────────────
      // From here on the sync writes. Every upsert is keyed on a unique
      // constraint, so stopping between phases leaves a partial mirror that the
      // next run completes rather than anything inconsistent.
      const db = admin
      const nowIso = new Date().toISOString()
      await run.setPhase('Saving customers and accounts')

      const customerColumns = mappedColumns(partnerFieldSet, PARTNER_COLUMN_MAP)
      const addressColumns = mappedColumns(partnerFieldSet, ADDRESS_COLUMN_MAP)
      const orderColumns = mappedColumns(orderFieldSet, ORDER_COLUMN_MAP)

      // Two reads of the same table, for two different jobs.
      //
      // The wide one preserves data: a field Odoo did not return is written
      // straight back rather than blanked, which needs every column the sync
      // may write. It is restricted to the partners actually in hand, because
      // on an incremental run that is a handful of rows out of tens of
      // thousands.
      //
      // The narrow one is unavoidably whole-table - orders reference customers
      // this run never pulled, the disappearance sweep has to know every erp_id
      // there is, and customers.name is NOT NULL so the aggregate rewrite has
      // to carry it. Three small columns make that affordable.
      const identityRows = await selectAllPages(
        (from, to) =>
          db
            .from('customers')
            .select('id, erp_id, name')
            .eq('org_id', orgId)
            .not('erp_id', 'is', null)
            .order('erp_id', { ascending: true })
            .range(from, to),
        'customers identity select',
        run,
      )

      const pulledErpIds = [
        ...new Set(
          odooPartners
            .map((partner) => odooNumber(partner.id))
            .filter((id): id is number => id !== null)
            .map(String),
        ),
      ]

      const existingCustomerSelect = [
        ...new Set(['id', 'erp_id', 'account_id', 'is_active', 'odoo_missing_since', ...customerColumns]),
      ].join(', ')

      const existingByErpId = new Map<string, Row>()
      for (const batch of chunk(pulledErpIds, IN_CHUNK)) {
        const rows = await exec(
          db.from('customers').select(existingCustomerSelect).eq('org_id', orgId).in('erp_id', batch),
          'customers select',
        )
        for (const row of rows) {
          const erpId = text(row.erp_id)
          if (erpId) existingByErpId.set(erpId, row)
        }
        await run.tick(existingByErpId.size, pulledErpIds.length)
      }

      // ── 7a. Accounts, for customers that do not have one yet ───────────────
      interface PreparedCustomer {
        erpId: string
        row: PartialRow
        existing: Row | undefined
        accountKey: string | null
        /** What this partner alone would call its account. */
        nameCandidate: AccountNameCandidate
      }

      const prepared: PreparedCustomer[] = []
      const accountsToEnsure = new Map<string, AccountNameCandidate & { kind: string }>()
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

        const account = deriveAccount(accountInputFromRow(erpId, row))
        const nameCandidate = nameCandidateFor(account, row)

        // account_id is STICKY. It is derived only for a customer that has
        // never been grouped; a customer that already has one keeps it, so a
        // company renaming itself in Odoo relinks to the account its
        // (expensive) enrichment already hangs off instead of minting a second.
        // The *label* is not sticky - see the refresh below.
        let accountKey: string | null = null
        if (!text(existing?.account_id)) {
          accountKey = account.accountKey
          const current = accountsToEnsure.get(accountKey)
          if (!current || outranks(nameCandidate, current)) {
            accountsToEnsure.set(accountKey, { ...nameCandidate, kind: account.kind })
          }
        }

        prepared.push({ erpId, row, existing, accountKey, nameCandidate })
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
        { ignoreDuplicates: true, progress: run },
      )
      if (run.cancelled) return cancelledResponse()

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
      const bestNameByAccountId = new Map<string, AccountNameCandidate>()
      let reactivated = 0

      for (const item of prepared) {
        const derivedAccountId = item.accountKey ? (accountIdByKey.get(item.accountKey) ?? null) : null
        const accountId = resolveStickyAccountId(text(item.existing?.account_id), derivedAccountId)

        if (accountId) {
          const best = bestNameByAccountId.get(accountId)
          if (!best || outranks(item.nameCandidate, best)) {
            bestNameByAccountId.set(accountId, item.nameCandidate)
          }
        }

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
      for (const row of identityRows) {
        const erpId = text(row.erp_id)
        const id = text(row.id)
        if (erpId && id) customerIdByErpId.set(erpId, id)
      }

      for (const rows of [customerInserts, customerUpdates]) {
        const returned = await upsertChunked(db, 'customers', rows, 'org_id,erp_id', 'id, erp_id', {
          progress: run,
        })
        for (const row of returned) {
          const erpId = text(row.erp_id)
          const id = text(row.id)
          if (erpId && id) customerIdByErpId.set(erpId, id)
        }
      }
      if (run.cancelled) return cancelledResponse()

      // ── 7b-ii. Give each account the best name its members can offer ───────
      // account_key is sticky, so a partner that Odoo has since renamed - or
      // converted from a person to a company - stays on the account it was
      // first grouped under. Its label was written once by whichever member got
      // there first and never revisited, which is how an account can end up
      // displaying a contact's name where its company's belongs.
      //
      // Only the label is rewritten. account_key is untouched, so nothing the
      // enrichment hangs off moves.
      const nameRefreshIds = [...bestNameByAccountId.keys()]
      let accountsRenamed = 0
      for (const batch of chunk(nameRefreshIds, IN_CHUNK)) {
        const rows = await exec(
          db
            .from('customer_accounts')
            .select('id, display_name')
            .eq('org_id', orgId)
            .in('id', batch),
          'customer_accounts display_name select',
        )

        for (const row of rows) {
          const id = text(row.id)
          if (!id) continue
          const best = bestNameByAccountId.get(id)
          // Two conditions, both about not making things worse:
          //
          //   - Only a real company name may overwrite a stored label. An email
          //     domain or a person's name is a fallback that was right when it
          //     was written, and demoting to one would be a regression.
          //   - Only the company's own res.partner may supply it. An account
          //     has one of those, so the winner is the same whichever subset of
          //     members a run happens to pull; letting contacts nominate a name
          //     would let two runs rename the account back and forth.
          if (!best || best.source !== 'company-name' || !best.fromCompanyRecord) continue
          if (text(row.display_name) === best.displayName) continue

          await exec(
            db
              .from('customer_accounts')
              .update({ display_name: best.displayName, updated_by: userId })
              .eq('org_id', orgId)
              .eq('id', id)
              .select('id'),
            'customer_accounts rename',
          )
          accountsRenamed++
        }
      }
      if (run.cancelled) return cancelledResponse()

      // ── 7c. Shipping addresses ─────────────────────────────────────────────
      await run.setPhase('Saving addresses')
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
        { progress: run },
      )) {
        const erpId = text(row.erp_id)
        const id = text(row.id)
        if (erpId && id) addressIdByErpId.set(erpId, id)
      }
      if (run.cancelled) return cancelledResponse()

      // ── 7d. Orders ─────────────────────────────────────────────────────────
      // Orders and their lines carry no enrichment and are fully reproducible
      // from a re-sync, so unlike customers they are safe to overwrite
      // wholesale.
      await run.setPhase('Saving orders')
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

      // customer_id comes back alongside erp_id so the customer an order is
      // moving *away* from can be recomputed too. Rolling an order up to its
      // company takes money off the contact who used to hold it, and that
      // contact is not otherwise in the affected set on an incremental run.
      const existingOrderErpIds = new Set<string>()
      const previousOrderOwners = new Set<string>()
      for (const batch of chunk(orderErpIds, IN_CHUNK)) {
        const rows = await exec(
          db
            .from('customer_orders')
            .select('erp_id, customer_id')
            .eq('org_id', orgId)
            .in('erp_id', batch),
          'customer_orders select',
        )
        for (const row of rows) {
          const erpId = text(row.erp_id)
          if (erpId) existingOrderErpIds.add(erpId)
          const owner = text(row.customer_id)
          if (owner) previousOrderOwners.add(owner)
        }
      }

      const orderRows: PartialRow[] = []
      const lineRowsByOrderErpId = new Map<string, PartialRow[]>()
      let ordersCreated = 0
      let ordersUpdated = 0
      let ordersSkippedUnknownPartner = 0
      let ordersRolledUpToCompany = 0

      for (const order of odooOrders) {
        const orderId = odooNumber(order.id)
        if (orderId === null) continue
        const erpId = String(orderId)

        // Revenue goes to the commercial partner - the company - rather than
        // the contact Odoo named on the order. See `resolveOrderOwner`.
        const { customerId, contactId } = resolveOrderOwner(
          order,
          customerIdByErpId,
          commercialByContactErpId,
        )
        if (!customerId) {
          // customer_orders.customer_id is NOT NULL; an order whose partner is
          // not a customer we mirror has nowhere to hang.
          ordersSkippedUnknownPartner++
          continue
        }
        if (contactId) ordersRolledUpToCompany++

        const shippingErpId = many2oneErpId(order.partner_shipping_id)
        const mapped = mapRecord(order, orderFieldSet, ORDER_COLUMN_MAP)
        const row: PartialRow = {
          ...fillMissingColumns(mapped, orderColumns, null),
          org_id: orgId,
          erp_id: erpId,
          customer_id: customerId,
          contact_id: contactId,
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
        { progress: run },
      )) {
        const erpId = text(row.erp_id)
        const id = text(row.id)
        if (erpId && id) orderIdByErpId.set(erpId, id)
      }

      // LAST CANCELLATION POINT. Everything below either deletes before it
      // inserts or recomputes a derived column, so it runs to completion once
      // entered even if a stop has been requested.
      if (run.cancelled) return cancelledResponse()

      // ── 7e. Order lines: replaced wholesale ────────────────────────────────
      await run.setPhase('Saving order lines')
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
      await run.setPhase('Recalculating totals')
      const affectedCustomerIds = new Set<string>()
      for (const item of prepared) {
        const id = customerIdByErpId.get(item.erpId)
        if (id) affectedCustomerIds.add(id)
      }
      for (const row of orderRows) {
        if (typeof row.customer_id === 'string') affectedCustomerIds.add(row.customer_id)
      }
      for (const owner of previousOrderOwners) affectedCustomerIds.add(owner)

      const preparedByErpId = new Map(prepared.map((item) => [item.erpId, item]))
      const storedNameByErpId = new Map<string, string>()
      for (const row of identityRows) {
        const erpId = text(row.erp_id)
        const name = text(row.name)
        if (erpId && name) storedNameByErpId.set(erpId, name)
      }

      const nameById = new Map<string, string>()
      const erpIdById = new Map<string, string>()
      for (const [erpId, id] of customerIdByErpId) {
        erpIdById.set(id, erpId)
        const name = text(preparedByErpId.get(erpId)?.row.name) ?? storedNameByErpId.get(erpId)
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
      await upsertChunked(db, 'customers', aggregateRows, 'id', 'id', { progress: run })

      // ── 9. Flag customers that vanished from Odoo. Never delete. ───────────
      // A deletion writes nothing, so no change window can contain it. The
      // whole live customer list is fetched instead - but with `search`, which
      // answers in bare ids, so this costs a couple of calls even against an
      // Odoo with tens of thousands of customers and can run on every sync.
      //
      // It also catches what the old full-pull diff could not: a partner still
      // in Odoo that has stopped being a customer no longer appears in the
      // marker's domain, and is now flagged like any other disappearance.
      await run.setPhase('Checking for removed customers')
      let markedInactive = 0
      if (marker !== null) {
        const liveErpIds = new Set(
          (await searchAllIds(cfg, 'res.partner', customerDomain(marker), run)).map(String),
        )

        // The sweep flags everything the list does not mention, so a list that
        // is wrong in the wrong direction would deactivate the whole module in
        // a single run. Two ways it can be wrong, both refused:
        //
        //   - Empty against a mirror that has customers. Far likelier to be a
        //     permissions or connectivity fault than a real mass deletion.
        //   - Truncated at the pager's ceiling, where the ids past the cut look
        //     exactly like ids that no longer exist.
        //
        // Skipping costs one sync. The next one flags them if it was true.
        const truncated = liveErpIds.size >= MAX_ODOO_RECORDS
        const suspiciouslyEmpty = liveErpIds.size === 0 && customerIdByErpId.size > 0
        if (truncated || suspiciouslyEmpty) {
          request.log.warn(
            { liveCustomers: liveErpIds.size, storedCustomers: customerIdByErpId.size, truncated },
            '[CustomerSync] the live customer list is not trustworthy; skipping the disappearance sweep',
          )
        }

        const candidates =
          truncated || suspiciouslyEmpty
            ? []
            : [...customerIdByErpId.keys()].filter(
                // A company topped up in step 4a is deliberately outside the
                // customer domain, so its absence from this list is expected
                // rather than a disappearance.
                (erpId) => !liveErpIds.has(erpId) && !commercialOnlyErpIds.has(erpId),
              )

        // The step 4a exemption only covers companies this run happened to top
        // up. A company whose contacts place every order sits at customer_rank
        // 0 permanently, so on the next run - which tops up nothing because no
        // order changed - the sweep would deactivate the very rows that hold
        // the org's revenue.
        //
        // An order with a contact_id is by definition one that was rolled up
        // from a contact to a different partner, so a customer owning one is a
        // parent company, not a customer Odoo has lost. Ordinary customers
        // order under their own record and leave contact_id null, so this
        // exempts nobody the sweep is actually meant to catch.
        const parentCompanyIds = new Set<string>()
        const candidateIds = candidates
          .map((erpId) => customerIdByErpId.get(erpId))
          .filter((id): id is string => id !== undefined)

        for (const batch of chunk(candidateIds, IN_CHUNK)) {
          const rows = await exec(
            db
              .from('customer_orders')
              .select('customer_id')
              .eq('org_id', orgId)
              .in('customer_id', batch)
              .not('contact_id', 'is', null),
            'customer_orders parent company probe',
          )
          for (const row of rows) {
            const id = text(row.customer_id)
            if (id) parentCompanyIds.add(id)
          }
        }

        const missing = candidates.filter((erpId) => {
          const id = customerIdByErpId.get(erpId)
          return !id || !parentCompanyIds.has(id)
        })

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

      // ── 10. Record the run on the integration and close the log row ────────
      // The watermark is the newest write_date this run actually saw, rewound
      // slightly, and it is only reached on the success path - every early
      // return above leaves the previous one standing so the window is re-read.
      const watermark = nextWatermark(
        [
          latestWriteDate(odooPartners),
          latestWriteDate(changedNonCustomers),
          latestWriteDate(odooOrders),
          latestWriteDate(changedLines),
          latestWriteDate(odooLines),
        ],
        previousWatermark?.toISOString() ?? null,
      )

      const touchedCustomers = customerInserts.length + customerUpdates.length
      await markIntegration(admin, integration.id, 'success', null, touchedCustomers)
      await run.finish('success', {
        processed: odooPartners.length + odooOrders.length + odooLines.length,
        created: customerInserts.length,
        updated: customerUpdates.length,
        skipped: ordersSkippedUnknownPartner,
        watermark,
      })
      runsInFlight.delete(request)

      return {
        success: true,
        run_id: run.id,
        duration_ms: Date.now() - startedAt,
        mode: incremental ? 'incremental' : 'full',
        window: { since: since ? since.toISOString() : null, watermark },
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
          renamed: accountsRenamed,
        },
        customer_addresses: {
          created: addressesCreated,
          updated: addressRows.length - addressesCreated,
        },
        customer_orders: {
          created: ordersCreated,
          updated: ordersUpdated,
          skipped_unknown_partner: ordersSkippedUnknownPartner,
          rolled_up_to_company: ordersRolledUpToCompany,
        },
        customer_order_lines: {
          replaced: lineCount,
        },
      }
    },
  )

  // ── Watch a sync ─────────────────────────────────────────────────────────
  // Gated on `view`, not `create`: anyone who can look at the customers module
  // should be able to see that a sync is in progress and why the numbers are
  // moving, even if they cannot start one.
  fastify.get(
    '/customers/sync/status',
    {
      schema: {
        description:
          'Progress of the current or most recent Odoo customer sync. Poll while a run is active.',
        tags: ['Customers'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: [fastify.authenticate, requireTeamPermission('module:customers', 'view')],
    },
    async (request, reply) => {
      if (!request.user?.org_id) {
        return sendError(reply, 401, ErrorCode.UNAUTHORIZED, 'Authentication required')
      }

      const admin = createSupabaseAdminClient()
      const { data, error } = await admin
        .from('integration_sync_log')
        .select(RUN_COLUMNS)
        .eq('org_id', request.user.org_id)
        .eq('sync_type', 'customers')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        request.log.error({ err: error }, '[CustomerSync] status read failed')
        return sendError(reply, 500, ErrorCode.INTERNAL_ERROR, 'Could not read the sync status')
      }

      return { success: true, run: data ? toRunView(asRow(data)) : null }
    },
  )

  // ── Stop a sync ──────────────────────────────────────────────────────────
  // This only raises a flag. The run notices it at its next checkpoint and
  // stops itself, which is why the response says "requested" rather than
  // reporting the run as already stopped.
  fastify.post(
    '/customers/sync/cancel',
    {
      schema: {
        description:
          'Ask the running Odoo customer sync to stop. It stops at its next safe checkpoint, leaving a partial mirror the next sync completes.',
        tags: ['Customers'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: [fastify.authenticate, requireTeamPermission('module:customers', 'create')],
    },
    async (request, reply) => {
      if (!request.user?.org_id) {
        return sendError(reply, 401, ErrorCode.UNAUTHORIZED, 'Authentication required')
      }

      const admin = createSupabaseAdminClient()
      const { data: running } = await admin
        .from('integration_sync_log')
        .select(RUN_COLUMNS)
        .eq('org_id', request.user.org_id)
        .eq('sync_type', 'customers')
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!running) {
        return sendError(reply, 404, ErrorCode.NOT_FOUND, 'No sync is running.')
      }

      const runId = String(asRow(running).id)

      // A run whose heartbeat has stopped will never see the flag, so close it
      // out here instead of leaving the caller waiting for a stop that cannot
      // arrive.
      if (isStale(asRow(running))) {
        await admin
          .from('integration_sync_log')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'The sync stopped reporting and was assumed to have died.',
          })
          .eq('id', runId)
        return { success: true, run_id: runId, already_stopped: true }
      }

      const { error } = await admin
        .from('integration_sync_log')
        .update({ cancel_requested: true, cancel_requested_by: request.user.id })
        .eq('id', runId)

      if (error) {
        request.log.error({ err: error }, '[CustomerSync] cancel request failed')
        return sendError(reply, 500, ErrorCode.INTERNAL_ERROR, 'Could not request cancellation')
      }

      return { success: true, run_id: runId, already_stopped: false }
    },
  )
}

export default customerRoutes
