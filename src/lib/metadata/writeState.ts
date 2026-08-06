/**
 * Whether each metadata field a user edited is actually in the SolidWorks file.
 *
 * Until now the answer was a single boolean per write, and the only two things that could be done
 * with a failure were to keep the value - which let check-in promote it into the database as though
 * the file had accepted it - or to throw the user's typing away. The previous release picked the
 * second as the lesser harm and said so. This module is the state that makes the choice
 * unnecessary: an edit that did not reach the file keeps its value and carries a mark saying so.
 *
 * ## Why the state is per field and per configuration
 *
 * A part with 68 configurations can take a value in some of them and refuse it in others, and the
 * service has reported that per configuration since 1.16.0. One state per file cannot express it,
 * so it gets rounded - up to success, which is the original bug, or down to failure, which
 * misreports 67 configurations that are fine. An address here is one field at one scope, so
 * "`AS568-014` refused the tab number and the other 67 took it" is representable exactly.
 *
 * ## Why it is not stored in the database
 *
 * This describes one machine's attempt to write one working copy. Only that machine holds the file
 * and only it can retry, so the state is worthless to anyone else and would be actively misleading
 * on a second machine that has its own copy. The durable, shared record of whether a row was ever
 * confirmed against its file is `property_fingerprint` / `property_verified_at` - phase 5 of
 * `.cursor/plans/metadata-source-of-truth.plan.md` - which is a different fact with a different
 * lifetime. It is persisted to local storage beside `persistedPendingMetadata`, because a mark that
 * vanished when the app restarted would leave the value looking clean. Both are path-keyed and both
 * are declared in `src/stores/persistedPathKeys.ts`, which is what carries them across a rename.
 *
 * Pure: no I/O, no store access, no React.
 */

import type { PendingMetadata } from '@/stores/types'

// ============================================
// Vocabulary
// ============================================

/**
 * What is known about one field's presence in the file.
 *
 * The three states the plan insists no layer may collapse are `verified`, `failed` and
 * `unverified`. Two more exist because they are genuinely different questions:
 *
 * - `pending` - nothing has been attempted yet, which is not a failure.
 * - `unattempted` - a write was wanted and could not be issued at all, because the service was not
 *   running. Nothing was written, and we know that; `unverified` means the opposite, that
 *   *something* may have been written and cannot be confirmed. Collapsing them would tell a user
 *   whose service is off that their file might have changed.
 *
 * Every one of these is a conclusion. "A write is happening right now" is not a conclusion and is
 * not in this union - see `MetadataWriteDisplayState`.
 */
export type MetadataWriteState =
  | 'pending'
  | 'verified'
  | 'unverified'
  | 'failed'
  | 'unattempted'

/**
 * What a marker can show, which is every recorded state plus the one that is never recorded.
 *
 * `writing` is a property of a running write, not of the file: the caller that issued it knows it
 * is in flight and nobody else needs to, so it is passed to the marker and never stored. It was in
 * the recorded union for one release with no production path that produced it, and the module
 * claimed on that basis that a write interrupted by a crash would come back as `unverified` rather
 * than as `pending`. It never did, and it should not: `pending` means the address still owes the
 * file a write, so an interrupted write is re-issued and confirmed at the next save or check-in,
 * which settles the question. `unverified` is excluded from retry by design, so recording it would
 * have turned a self-healing case into a permanent mark on a value the database went on to take.
 * Keeping `writing` out of `MetadataWriteState` makes storing it a type error rather than a note.
 */
export type MetadataWriteDisplayState = MetadataWriteState | 'writing'

/** The pending fields that live at file scope. */
export type MetadataScalarField = 'part_number' | 'description' | 'revision' | 'tab_number'

/** The two per-configuration fields, named as the divergence scanner names them. */
export type MetadataConfigField = 'config_tab' | 'config_description'

/** One field at one scope - the unit the state is recorded against. */
export type MetadataWriteAddress =
  | { scope: 'file'; field: MetadataScalarField }
  | { scope: 'configuration'; field: MetadataConfigField; configuration: string }

/** One address's state, with when it was decided and what decided it. */
export interface FieldWriteState {
  state: MetadataWriteState
  /** ISO timestamp of the transition into this state. */
  at: string
  /**
   * The service's or the read-back's own words. Diagnostic detail rather than a message: the UI
   * takes its wording from `t()` keyed on `state` and appends this when it has one.
   */
  reason?: string
  /**
   * True once the value reached the database while still unconfirmed in the file. Set by check-in,
   * which promotes either way and must leave a record of what it could not confirm.
   *
   * Unlike `state`, `reason` and `at`, this is not a property of the latest attempt. It is a fact
   * about the world - the database took this value and the file may not have it - and it stays true
   * however many times the write is retried. So it carries across transitions rather than being
   * rebuilt from the transition's own detail, and it is dropped only by the one event that makes it
   * false: the address reaching `verified`, at which point the file demonstrably does have it.
   */
  promoted?: boolean
}

/** Every address's state for one file. Absent keys mean nothing has been recorded. */
export interface MetadataWriteStateRecord {
  fields?: Partial<Record<MetadataScalarField, FieldWriteState>>
  config_tabs?: Record<string, FieldWriteState>
  config_descriptions?: Record<string, FieldWriteState>
}

// ============================================
// Ordering
// ============================================

/**
 * How alarming each state is, most alarming first.
 *
 * Used only to choose the one marker a single row can show. It is deliberately not a "how far
 * along" ordering: `verified` is last because it is the state that needs no marker at all, not
 * because it is the least advanced.
 */
const SEVERITY: readonly MetadataWriteDisplayState[] = [
  'failed',
  'unattempted',
  'unverified',
  'writing',
  'pending',
  'verified',
]

/** Ordered over the display states, since choosing one marker is the only thing it is for. */
function severityOf(state: MetadataWriteDisplayState): number {
  return SEVERITY.indexOf(state)
}

/** States in which the value is known not to be in the file, so a retry is the whole remedy. */
const NOT_IN_FILE: ReadonlySet<MetadataWriteState> = new Set<MetadataWriteState>([
  'pending',
  'failed',
  'unattempted',
])

/** Whether an address still owes the file a write. `unverified` does not: it may already be there. */
export function needsWrite(state: MetadataWriteState): boolean {
  return NOT_IN_FILE.has(state)
}

/** Whether an address is confirmed present in the file. Only one state qualifies. */
export function isConfirmed(state: MetadataWriteState): boolean {
  return state === 'verified'
}

// ============================================
// Addresses
// ============================================

/** A stable key for an address, for maps and for tests. */
export function addressKey(address: MetadataWriteAddress): string {
  return address.scope === 'file'
    ? `file:${address.field}`
    : `configuration:${address.field}:${address.configuration}`
}

const SCALAR_FIELDS: readonly MetadataScalarField[] = [
  'part_number',
  'description',
  'revision',
  'tab_number',
]

/**
 * Every address one pending set touches.
 *
 * Presence decides, exactly as the overlay resolver does: a key that exists is an edit, including
 * an edit to nothing. A configuration map contributes one address per entry, which is what makes a
 * partial write across 68 configurations representable.
 */
export function listWriteAddresses(
  pending: PendingMetadata | undefined,
): MetadataWriteAddress[] {
  if (!pending) return []

  const addresses: MetadataWriteAddress[] = []

  for (const field of SCALAR_FIELDS) {
    if (pending[field] !== undefined) addresses.push({ scope: 'file', field })
  }

  for (const configuration of Object.keys(pending.config_tabs ?? {})) {
    addresses.push({ scope: 'configuration', field: 'config_tab', configuration })
  }
  for (const configuration of Object.keys(pending.config_descriptions ?? {})) {
    addresses.push({ scope: 'configuration', field: 'config_description', configuration })
  }

  return addresses
}

/** Every address the record has anything to say about. */
export function listRecordedAddresses(
  record: MetadataWriteStateRecord | undefined,
): MetadataWriteAddress[] {
  if (!record) return []

  const addresses: MetadataWriteAddress[] = []

  for (const field of SCALAR_FIELDS) {
    if (record.fields?.[field]) addresses.push({ scope: 'file', field })
  }
  for (const configuration of Object.keys(record.config_tabs ?? {})) {
    addresses.push({ scope: 'configuration', field: 'config_tab', configuration })
  }
  for (const configuration of Object.keys(record.config_descriptions ?? {})) {
    addresses.push({ scope: 'configuration', field: 'config_description', configuration })
  }

  return addresses
}

// ============================================
// Reading and writing the record
// ============================================

export function readWriteState(
  record: MetadataWriteStateRecord | undefined,
  address: MetadataWriteAddress,
): FieldWriteState | undefined {
  if (!record) return undefined
  if (address.scope === 'file') return record.fields?.[address.field]
  const map =
    address.field === 'config_tab' ? record.config_tabs : record.config_descriptions
  return map?.[address.configuration]
}

/** What a transition carries beyond the state itself. */
export interface WriteStateDetail {
  reason?: string
  promoted?: boolean
  /** Overridable so tests do not depend on the clock. */
  at?: string
}

/**
 * The entry one transition produces, given what the address said before it.
 *
 * Everything in a `FieldWriteState` describes the latest attempt except `promoted`, which describes
 * the database. Check-in leaves `{state: 'failed', promoted: true}`; the user edits the field again
 * and the address goes back to `pending`; the database still holds the value it took. Rebuilding
 * the entry from the transition's own detail dropped the flag there, and if the retry also failed
 * `hasPromotedUnconfirmed` said no while the answer was still yes.
 */
function withDetail(
  state: MetadataWriteState,
  previous: FieldWriteState | undefined,
  detail?: WriteStateDetail,
): FieldWriteState {
  const entry: FieldWriteState = { state, at: detail?.at ?? new Date().toISOString() }
  if (detail?.reason) entry.reason = detail.reason
  if (!isConfirmed(state) && (detail?.promoted === true || previous?.promoted === true)) {
    entry.promoted = true
  }
  return entry
}

/**
 * Move a set of addresses into one state, leaving every other address alone.
 *
 * Scoped rather than wholesale because a file can carry edits from several saves at once: one
 * configuration's tab written an hour ago and confirmed, another edited just now. A blanket
 * transition would relabel the first with the second's outcome.
 */
export function applyWriteState(
  record: MetadataWriteStateRecord | undefined,
  addresses: readonly MetadataWriteAddress[],
  state: MetadataWriteState,
  detail?: WriteStateDetail,
): MetadataWriteStateRecord {
  if (addresses.length === 0) return record ?? {}

  const next: MetadataWriteStateRecord = {
    fields: { ...(record?.fields ?? {}) },
    config_tabs: { ...(record?.config_tabs ?? {}) },
    config_descriptions: { ...(record?.config_descriptions ?? {}) },
  }

  for (const address of addresses) {
    const entry = withDetail(state, readWriteState(record, address), detail)
    if (address.scope === 'file') {
      next.fields![address.field] = entry
    } else if (address.field === 'config_tab') {
      next.config_tabs![address.configuration] = entry
    } else {
      next.config_descriptions![address.configuration] = entry
    }
  }

  return prune(next)
}

/**
 * Apply a different state to each address in one pass.
 *
 * This is what a read-back produces: 66 configurations verified and two failed, decided
 * individually. Applying them one call at a time would work but would stamp a different `at` on
 * each and make the record read as a sequence of separate events rather than one write.
 */
export function applyWriteStates(
  record: MetadataWriteStateRecord | undefined,
  outcomes: ReadonlyArray<{
    address: MetadataWriteAddress
    state: MetadataWriteState
    reason?: string
  }>,
  detail?: WriteStateDetail,
): MetadataWriteStateRecord {
  const at = detail?.at ?? new Date().toISOString()
  let next = record ?? {}
  for (const outcome of outcomes) {
    next = applyWriteState(next, [outcome.address], outcome.state, {
      at,
      reason: outcome.reason,
      promoted: detail?.promoted,
    })
  }
  return next
}

/** Forget a set of addresses. Used when a value stops being interesting, not when it fails. */
export function clearWriteState(
  record: MetadataWriteStateRecord | undefined,
  addresses: readonly MetadataWriteAddress[],
): MetadataWriteStateRecord | undefined {
  if (!record || addresses.length === 0) return record

  const next: MetadataWriteStateRecord = {
    fields: { ...(record.fields ?? {}) },
    config_tabs: { ...(record.config_tabs ?? {}) },
    config_descriptions: { ...(record.config_descriptions ?? {}) },
  }

  for (const address of addresses) {
    if (address.scope === 'file') delete next.fields![address.field]
    else if (address.field === 'config_tab') delete next.config_tabs![address.configuration]
    else delete next.config_descriptions![address.configuration]
  }

  const pruned = prune(next)
  return isEmptyRecord(pruned) ? undefined : pruned
}

function prune(record: MetadataWriteStateRecord): MetadataWriteStateRecord {
  const next: MetadataWriteStateRecord = {}
  if (record.fields && Object.keys(record.fields).length > 0) next.fields = record.fields
  if (record.config_tabs && Object.keys(record.config_tabs).length > 0) {
    next.config_tabs = record.config_tabs
  }
  if (record.config_descriptions && Object.keys(record.config_descriptions).length > 0) {
    next.config_descriptions = record.config_descriptions
  }
  return next
}

export function isEmptyRecord(record: MetadataWriteStateRecord | undefined): boolean {
  if (!record) return true
  return listRecordedAddresses(record).length === 0
}

// ============================================
// Summary
// ============================================

/** Enough for one marker and one sentence, without the caller walking the record. */
export interface WriteStateSummary {
  /** The most alarming state present, or undefined when nothing is recorded. */
  worst?: MetadataWriteState
  counts: Record<MetadataWriteState, number>
  /** Addresses that still owe the file a write. */
  unwritten: MetadataWriteAddress[]
  /** Configurations named by a failed or unconfirmed configuration-scope address. */
  affectedConfigurations: string[]
  /** True when at least one address reached the database without being confirmed in the file. */
  hasPromotedUnconfirmed: boolean
}

const ZERO_COUNTS: Record<MetadataWriteState, number> = {
  pending: 0,
  verified: 0,
  unverified: 0,
  failed: 0,
  unattempted: 0,
}

export function summarizeWriteState(
  record: MetadataWriteStateRecord | undefined,
): WriteStateSummary {
  const counts = { ...ZERO_COUNTS }
  const unwritten: MetadataWriteAddress[] = []
  const affected = new Set<string>()
  let worst: MetadataWriteState | undefined
  let hasPromotedUnconfirmed = false

  for (const address of listRecordedAddresses(record)) {
    const entry = readWriteState(record, address)
    if (!entry) continue

    counts[entry.state] += 1
    if (needsWrite(entry.state)) unwritten.push(address)
    if (entry.promoted && !isConfirmed(entry.state)) hasPromotedUnconfirmed = true
    if (address.scope === 'configuration' && !isConfirmed(entry.state)) {
      affected.add(address.configuration)
    }
    if (worst === undefined || severityOf(entry.state) < severityOf(worst)) worst = entry.state
  }

  return {
    worst,
    counts,
    unwritten,
    affectedConfigurations: [...affected].sort(),
    hasPromotedUnconfirmed,
  }
}

/**
 * A column in the file list, and the addresses it answers for.
 *
 * The datacard columns and the addresses do not correspond one to one: a part's per-configuration
 * descriptions belong under the Description column, and its per-configuration tabs under Tab Number,
 * because that is the cell a user would click to fix them. Without this grouping every column would
 * show the same file-wide mark and a row with one failed configuration tab would carry four
 * identical warnings.
 */
export type MetadataFieldGroup = 'part_number' | 'description' | 'revision' | 'tab_number'

/** The recorded states one column is answerable for. */
export function scopeRecordToGroup(
  record: MetadataWriteStateRecord | undefined,
  group: MetadataFieldGroup,
): MetadataWriteStateRecord | undefined {
  if (!record) return undefined

  const entry = record.fields?.[group]
  const scoped: MetadataWriteStateRecord = entry ? { fields: { [group]: entry } } : {}
  if (group === 'description' && record.config_descriptions) {
    scoped.config_descriptions = record.config_descriptions
  }
  if (group === 'tab_number' && record.config_tabs) scoped.config_tabs = record.config_tabs

  return isEmptyRecord(scoped) ? undefined : scoped
}

/** The pending edits one column is answerable for. */
export function scopePendingToGroup(
  pending: PendingMetadata | undefined,
  group: MetadataFieldGroup,
): PendingMetadata | undefined {
  if (!pending) return undefined

  const scoped: PendingMetadata = {}
  switch (group) {
    case 'part_number':
      if (pending.part_number !== undefined) scoped.part_number = pending.part_number
      break
    case 'description':
      if (pending.description !== undefined) scoped.description = pending.description
      break
    case 'revision':
      if (pending.revision !== undefined) scoped.revision = pending.revision
      break
    case 'tab_number':
      if (pending.tab_number !== undefined) scoped.tab_number = pending.tab_number
      break
  }
  if (group === 'description' && pending.config_descriptions) {
    scoped.config_descriptions = pending.config_descriptions
  }
  if (group === 'tab_number' && pending.config_tabs) scoped.config_tabs = pending.config_tabs

  return Object.keys(scoped).length > 0 ? scoped : undefined
}

/**
 * The state a whole file should display, given both its pending edits and its recorded outcomes.
 *
 * An edited field with no recorded state is `pending`: it was edited and nothing has been attempted
 * against it. Without this, an edit made before this feature existed - or one recorded while the
 * write state was being cleared - would show as though it were confirmed.
 */
export function resolveFileWriteState(
  pending: PendingMetadata | undefined,
  record: MetadataWriteStateRecord | undefined,
): MetadataWriteState | undefined {
  const summary = summarizeWriteState(record)
  const unrecorded = listWriteAddresses(pending).some(
    (address) => readWriteState(record, address) === undefined,
  )

  if (!unrecorded) return summary.worst
  if (summary.worst === undefined) return 'pending'
  return severityOf('pending') < severityOf(summary.worst) ? 'pending' : summary.worst
}
