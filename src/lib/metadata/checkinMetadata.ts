/**
 * Getting a file's metadata into the file before check-in puts it into the database.
 *
 * Check-in has always promoted `pendingMetadata` to the server and cleared it, on the assumption that
 * the datacard's own write had already put the value in the document. When that write failed -
 * refused property, offline service, locked file - the assumption was false and nothing recorded it,
 * so the database silently took a value the file did not have. That is the divergence this phase
 * exists to remove, and the trade it accepts is deliberate: check-in may get slower for files that
 * were actually edited, because confirming a write is worth more than finishing quickly.
 *
 * The model is write, then promote, and mark what could not be confirmed.
 *
 * - **Write** only the addresses that are not already confirmed. A field the datacard wrote and read
 *   back needs nothing, and re-writing it would make every check-in pay for work already done.
 * - **Promote either way.** The value is the user's and the database owns it, so withholding it would
 *   lose the edit rather than protect it. What changes is that a value promoted without confirmation
 *   keeps a mark saying so, which outlives the pending value being cleared.
 * - **Never promote silently.** The pending value goes; the record of doubt does not.
 *
 * The service is not required to be running. If it is not, nothing is written and the unconfirmed
 * addresses are marked `unattempted` - blocking a check-in because SolidWorks is closed would be a
 * worse failure than a marked file.
 *
 * ## No record is not a confirmation
 *
 * The rule above only holds while every address has something recorded against it. `verified` is
 * the one state that stops a retry and that check-in forgets, and an unrecorded address used to be
 * treated as though it were one, twelve lines after the same absence had been read as owing a
 * write. Both readings now come through `writeStateOf`, where absence is `pending`, and every
 * address the plan does not name is given an explicit `unattempted` before the promotion runs. So
 * the promotion can no longer meet an address it knows nothing about.
 */

import { log } from '@/lib/logger'
import { getSerializationSettings } from '@/lib/serialization'
import { getTabValidationOptions } from '@/lib/tabValidation'
import type { LocalFile } from '@/stores/types'

import { readDocumentConfigurations } from './configurationRead'
import { writeMetadataWithVerification } from './writeMetadataToFile'
import { buildMetadataWritePlan } from './writePlan'
import {
  addressKey,
  applyWriteStates,
  clearWriteState,
  isConfirmed,
  isEmptyRecord,
  listWriteAddresses,
  needsWrite,
  readWriteState,
  writeStateOf,
  type MetadataWriteAddress,
  type MetadataWriteState,
  type MetadataWriteStateRecord,
} from './writeState'

const SOLIDWORKS_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

/** The two that can hold per-configuration metadata. A drawing has sheets, not configurations. */
const CONFIGURABLE_EXTENSIONS = ['.sldprt', '.sldasm']

/** One address's outcome, as `applyWriteStates` takes it. */
interface AddressOutcome {
  address: MetadataWriteAddress
  state: MetadataWriteState
  reason?: string
}

/** Why an address the plan never named ends up `unattempted` rather than unrecorded. */
const NOTHING_PLANNED = 'the write plan had nothing to send for this field'

/** Why nothing is written when the document's configurations cannot be listed. */
const CONFIGURATIONS_UNREADABLE = 'the file’s configurations could not be read'

/** What check-in learned, and the record it must carry forward. */
export interface CheckinMetadataOutcome {
  /** The write state to store on the file after promotion. Undefined means nothing left to say. */
  writeState: MetadataWriteStateRecord | undefined
  /** Addresses whose values reach the database without being confirmed in the file. */
  promotedUnconfirmed: MetadataWriteAddress[]
  /** Milliseconds spent writing and confirming, for the timing breakdown check-in already logs. */
  elapsedMs: number
}

/**
 * Which addresses still owe the file a write.
 *
 * An address with no recorded state counts as owing one: it was edited and nothing ever confirmed it,
 * which includes every edit made before per-field state existed. `unverified` does not count -
 * something may already be in the file, and a second write could not tell us which.
 */
export function unwrittenAddresses(file: LocalFile): MetadataWriteAddress[] {
  return listWriteAddresses(file.pendingMetadata).filter((address) =>
    needsWrite(writeStateOf(file.metadataWriteState, address)),
  )
}

/**
 * Give every owed address a verdict, so an unrecorded one never reaches the promotion.
 *
 * An address the plan has nothing to send for produces no intent, the write returns no verdict for
 * it, and the record stays empty - which `keepOnlyUnconfirmed` used to read as confirmation on the
 * way out. The plan builder no longer drops a file-scope field on a multi-configuration document,
 * so the case left is a pending edit naming a configuration the document does not have; this is
 * what keeps the next one from being silent too.
 *
 * `unattempted` is the honest verdict: nothing was written and we know it, so a retry picks the
 * address up at the next save or check-in. `failed` would be a claim about the document that
 * nobody made.
 */
function withVerdictForEvery(
  owed: readonly MetadataWriteAddress[],
  decided: readonly AddressOutcome[],
  reason: string,
): AddressOutcome[] {
  const named = new Set(decided.map((outcome) => addressKey(outcome.address)))
  return [
    ...decided,
    ...owed
      .filter((address) => !named.has(addressKey(address)))
      .map((address) => ({ address, state: 'unattempted' as MetadataWriteState, reason })),
  ]
}

/**
 * Reduce a record to what is still worth keeping once the values have been promoted.
 *
 * A confirmed address is forgotten: its value is in the file and in the database, so a mark would
 * only record that the app once did its job. Everything else is stamped `promoted`, which is the
 * durable statement that the database holds something the file may not.
 */
function keepOnlyUnconfirmed(
  record: MetadataWriteStateRecord | undefined,
  addresses: readonly MetadataWriteAddress[],
): { record: MetadataWriteStateRecord | undefined; unconfirmed: MetadataWriteAddress[] } {
  const unconfirmed: MetadataWriteAddress[] = []
  const confirmed: MetadataWriteAddress[] = []

  for (const address of addresses) {
    if (isConfirmed(writeStateOf(record, address))) confirmed.push(address)
    else unconfirmed.push(address)
  }

  let next = clearWriteState(record, confirmed)
  if (unconfirmed.length > 0) {
    next = applyWriteStates(
      next,
      unconfirmed.map((address) => ({
        address,
        state: writeStateOf(record, address),
        reason: readWriteState(record, address)?.reason,
      })),
      { promoted: true },
    )
  }

  return { record: next && !isEmptyRecord(next) ? next : undefined, unconfirmed }
}

/**
 * Write whatever the datacard could not, then say what may be promoted with confidence.
 *
 * Returns the record to store rather than storing it, so check-in can fold it into the batched update
 * it already makes per file instead of triggering a separate render.
 */
export async function settleMetadataForCheckin(
  file: LocalFile,
  options: { organizationId?: string | null; serviceAvailable: boolean },
): Promise<CheckinMetadataOutcome> {
  const started = performance.now()
  const pending = file.pendingMetadata
  const edited = listWriteAddresses(pending)

  const settle = (record: MetadataWriteStateRecord | undefined): CheckinMetadataOutcome => {
    const kept = keepOnlyUnconfirmed(record, edited)
    if (kept.unconfirmed.length > 0) {
      log.warn('[CheckinMetadata]', 'Promoting values that are not confirmed in the file', {
        path: file.relativePath,
        count: kept.unconfirmed.length,
        addresses: kept.unconfirmed.map((address) =>
          address.scope === 'file' ? address.field : `${address.field}:${address.configuration}`,
        ),
      })
    }
    return {
      writeState: kept.record,
      promotedUnconfirmed: kept.unconfirmed,
      elapsedMs: Math.round(performance.now() - started),
    }
  }

  if (!pending || edited.length === 0) return settle(file.metadataWriteState)

  const extension = file.extension?.toLowerCase() ?? ''
  if (!SOLIDWORKS_EXTENSIONS.includes(extension)) {
    // Nothing in this file can hold a custom property, so the database is the only place the value
    // was ever going. There is nothing to confirm and nothing to doubt.
    return { writeState: undefined, promotedUnconfirmed: [], elapsedMs: 0 }
  }

  const owed = unwrittenAddresses(file)
  if (owed.length === 0) return settle(file.metadataWriteState)

  const settleAll = (decided: readonly AddressOutcome[], reason: string): CheckinMetadataOutcome =>
    settle(applyWriteStates(file.metadataWriteState, withVerdictForEvery(owed, decided, reason)))

  if (!options.serviceAvailable) {
    return settleAll([], 'the SolidWorks service was not running at check-in')
  }

  try {
    const names = CONFIGURABLE_EXTENSIONS.includes(extension)
      ? await readConfigurations(file.path)
      : []
    if (names === null) {
      // Without the configuration list there is no way to know whether this document keeps its
      // metadata in a configuration, so any plan built now would be a guess. Guessing produced the
      // worst available answer: the file-scope write went ahead, the read-back found the value it
      // had just written, and a document whose configurations still held the old number reported
      // as confirmed.
      log.warn('[CheckinMetadata]', 'Could not list the configurations, so nothing was written', {
        path: file.relativePath,
      })
      return settleAll([], CONFIGURATIONS_UNREADABLE)
    }

    const configurations = names.map((name) => ({ name }))
    const serialization = options.organizationId
      ? await getSerializationSettings(options.organizationId)
      : null

    const groups = buildMetadataWritePlan({
      pending,
      committed: {
        partNumber: file.pdmData?.part_number,
        description: file.pdmData?.description,
        revision: file.pdmData?.revision,
      },
      configurations,
      serialization: serialization
        ? {
            tabEnabled: !!serialization.tab_enabled,
            settings: serialization,
            validation: getTabValidationOptions(serialization),
          }
        : null,
      only: owed,
      // No Date or DrawnBy: check-in is completing an earlier edit, and restamping those would
      // attribute it to whoever happened to run the check-in.
    })

    // No early return on an empty plan: `writeMetadataWithVerification` does no I/O when there is
    // nothing to establish, and returning here is how an owed address used to leave with no
    // verdict at all.
    const result = await writeMetadataWithVerification({ path: file.path, groups })

    log.info('[CheckinMetadata]', 'Wrote pending metadata before promoting it', {
      path: file.relativePath,
      owed: owed.length,
      outcome: result.outcome,
      writeMs: result.writeMs,
      readBackMs: result.readBackMs,
    })

    return settleAll(result.addresses, NOTHING_PLANNED)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.warn('[CheckinMetadata]', 'Could not write pending metadata before check-in', {
      path: file.relativePath,
      reason,
    })
    return settle(
      applyWriteStates(
        file.metadataWriteState,
        owed.map((address) => ({ address, state: 'failed' as MetadataWriteState, reason })),
      ),
    )
  }
}

/**
 * The document's configurations by name, or null when the service could not say.
 *
 * Null rather than an empty list, because the two mean opposite things: an empty list is a
 * document that keeps its metadata at file level, and a failed call is a document that may keep
 * all of it somewhere this write is about to ignore. `readDocumentConfigurations` is where that
 * distinction is drawn against the service's reply; this only takes the names.
 */
async function readConfigurations(path: string): Promise<string[] | null> {
  const read = await readDocumentConfigurations(path)
  if (!read.ok) return null
  return read.configurations.map((configuration) => configuration.name)
}
