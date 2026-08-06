/**
 * Getting a file's metadata into the file before check-in puts it into the database.
 *
 * Check-in has always promoted `pendingMetadata` to the server and cleared it, on the assumption that
 * the datacard's own write had already put the value in the document. When that write failed -
 * refused property, offline service, locked file - the assumption was false and nothing recorded it,
 * so the database silently took a value the file did not have. That is the divergence this phase
 * exists to remove, and decision D4 in `.cursor/plans/metadata-source-of-truth.plan.md` settles the
 * trade: check-in may get slower for files that were actually edited.
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
 */

import { log } from '@/lib/logger'
import { getSerializationSettings } from '@/lib/serialization'
import { getTabValidationOptions } from '@/lib/tabValidation'
import type { LocalFile } from '@/stores/types'

import { writeMetadataWithVerification } from './writeMetadataToFile'
import { buildMetadataWritePlan } from './writePlan'
import {
  applyWriteStates,
  clearWriteState,
  isEmptyRecord,
  listWriteAddresses,
  needsWrite,
  readWriteState,
  type MetadataWriteAddress,
  type MetadataWriteState,
  type MetadataWriteStateRecord,
} from './writeState'

const SOLIDWORKS_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

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
  return listWriteAddresses(file.pendingMetadata).filter((address) => {
    const entry = readWriteState(file.metadataWriteState, address)
    return entry === undefined || needsWrite(entry.state)
  })
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
    const entry = readWriteState(record, address)
    if (entry === undefined || entry.state === 'verified') confirmed.push(address)
    else unconfirmed.push(address)
  }

  let next = clearWriteState(record, confirmed)
  if (unconfirmed.length > 0) {
    next = applyWriteStates(
      next,
      unconfirmed.map((address) => {
        const entry = readWriteState(record, address)
        return {
          address,
          state: entry?.state ?? ('failed' as MetadataWriteState),
          reason: entry?.reason,
        }
      }),
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

  if (!options.serviceAvailable) {
    return settle(
      applyWriteStates(
        file.metadataWriteState,
        owed.map((address) => ({
          address,
          state: 'unattempted' as MetadataWriteState,
          reason: 'the SolidWorks service was not running at check-in',
        })),
      ),
    )
  }

  try {
    const configurations = (await readConfigurations(file.path)).map((name) => ({ name }))
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

    if (groups.length === 0) return settle(file.metadataWriteState)

    const result = await writeMetadataWithVerification({ path: file.path, groups })

    log.info('[CheckinMetadata]', 'Wrote pending metadata before promoting it', {
      path: file.relativePath,
      owed: owed.length,
      outcome: result.outcome,
      writeMs: result.writeMs,
      readBackMs: result.readBackMs,
    })

    return settle(
      applyWriteStates(
        file.metadataWriteState,
        result.addresses.map((entry) => ({
          address: entry.address,
          state: entry.state,
          reason: entry.reason,
        })),
      ),
    )
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

async function readConfigurations(path: string): Promise<string[]> {
  const api = window.electronAPI?.solidworks
  if (!api?.getConfigurations) return []

  const result = await api.getConfigurations(path)
  if (!result?.success || !result.data?.configurations) return []
  return result.data.configurations.map((configuration) => configuration.name)
}
