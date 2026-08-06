/**
 * The one place a datacard value is written into a SolidWorks document and then confirmed.
 *
 * Before this module there were three write paths - the details panel, the configuration saver and
 * the two inline configuration editors - each building its own properties, each interpreting the
 * service's reply its own way, and none of them reading the file back. The service's reply is the
 * outcome of an API call, not the state of the file: a property SolidWorks refuses on info-type
 * grounds, a configuration that declines the value, a save that never reaches disk, all return
 * success. So "the write succeeded" was never a claim about the file, and check-in promoted values
 * on the strength of it.
 *
 * Here the sequence is write, read back, compare, and record per address. `verifyWrite.ts` owns the
 * comparison and is pure; this module owns the I/O and the timing.
 *
 * ## What the read-back costs
 *
 * One `getProperties` per write, regardless of how many configurations it touched, because that call
 * returns the file bag, every configuration's bag and the configuration list from a single Document
 * Manager open. Measured against this machine's own service logs: a median of 29ms warm, up to about
 * 370ms on the first open after the service starts, against 60ms for a single-scope `setProperties`
 * and around 1,000ms for a batch write. So verification adds roughly 3-50% to a write that is
 * already the slow part of an edit, and it does not scale with the configuration count - the reason
 * the read-back is one call outside the per-configuration loop rather than one per configuration.
 *
 * At that price it runs on every production write, which is why there is no flag to turn it off. The
 * one place it is deliberately skipped is a write no scope accepted: there is nothing to confirm,
 * the state is already known, and paying for an open to learn nothing would be the one case where
 * the cost buys nothing.
 *
 * ## Clearing a field
 *
 * A cleared field is written as an empty property, not removed. A drawing title block linked with
 * `$PRP:` renders blank against an empty property and can break against a missing one, and a
 * property that stays visible in SolidWorks' own dialog is what a user expects from clearing a field
 * rather than deleting it. Empty values are therefore included in the properties sent, not filtered
 * out, and an intent whose expected value is empty is a real intent that gets verified like any
 * other. The service does not yet hold up its end: its four write paths read an empty value as
 * "delete this property", so today a cleared field leaves the file with no property at all. The value
 * the app reads next time is right either way; the shape is not, and the `$PRP:` case the decision
 * exists for is not yet served. `.cursor/plans/service-empty-property-write.plan.md` specifies the
 * change.
 */

import { log } from '@/lib/logger'

import type { FileMetadata } from './divergence'
import type { MetadataWriteOutcome } from './pendingEdits'
import {
  failedWrite,
  unattemptedWrite,
  unverifiedWrite,
  verifyWrite,
  type MetadataWriteIntent,
  type VerifiedAddress,
} from './verifyWrite'

/** Properties destined for one scope, and what they are meant to establish there. */
export interface MetadataWriteGroup {
  /** Configuration to write into; absent means file scope. */
  configuration?: string
  /**
   * The properties to send. Empty strings are kept: an empty value is a clear, and dropping it
   * would leave the old value in the file while the database moved on.
   */
  properties: Record<string, string>
  /** The addresses this group is meant to establish, with the values expected afterwards. */
  intents: MetadataWriteIntent[]
}

export interface MetadataWriteRequest {
  /** Absolute path of the document. */
  path: string
  groups: readonly MetadataWriteGroup[]
  /**
   * Write through the live SolidWorks API instead of Document Manager. Needed when the document is
   * open in SolidWorks, and more reliable for imported parts with forced properties.
   */
  useLiveApi?: boolean
}

export interface MetadataWriteResult {
  /** The whole write's outcome, rounded from the per-address verdicts for callers that need one. */
  outcome: MetadataWriteOutcome
  /** The per-address verdicts, which are what gets recorded and what the UI marks. */
  addresses: VerifiedAddress[]
  /** Time in the service's write calls, milliseconds. */
  writeMs: number
  /** Time in the read-back, or null when none was made. */
  readBackMs: number | null
  /**
   * The document as the read-back found it, or null when there was none.
   *
   * Handed back so a caller with follow-up work - the details panel mirrors file-scope values into
   * the active configuration so `$PRP:` references in drawings resolve - can use this read instead
   * of making its own. That call site previously read the document anyway, so verification costs it
   * nothing.
   */
  document: FileMetadata | null
}

/**
 * Round the per-address verdicts into one outcome.
 *
 * `partial` is what makes the rounding safe: any disagreement between addresses reports as partial
 * rather than picking a winner, so a caller that only looks at the outcome cannot be told that 68
 * configurations succeeded because 66 of them did.
 */
export function summarizeOutcome(addresses: readonly VerifiedAddress[]): MetadataWriteOutcome {
  if (addresses.length === 0) return 'not-applicable'

  const states = new Set(addresses.map((entry) => entry.state))
  if (states.size === 1) {
    const only = [...states][0]
    if (only === 'verified') return 'verified'
    if (only === 'unverified') return 'unverified'
    if (only === 'unattempted') return 'unattempted'
    if (only === 'failed') return 'failed'
  }
  return 'partial'
}

async function readBack(path: string): Promise<FileMetadata> {
  const api = window.electronAPI?.solidworks
  if (!api?.getProperties) throw new Error('The SolidWorks service is not available')

  const result = await api.getProperties(path)
  if (!result?.success || !result.data) {
    throw new Error(result?.error ?? 'No response from the SolidWorks service')
  }

  const configurationProperties = result.data.configurationProperties ?? {}
  const configurations =
    result.data.configurations && result.data.configurations.length > 0
      ? result.data.configurations
      : Object.keys(configurationProperties)

  return {
    configurations,
    fileProperties: result.data.fileProperties ?? {},
    configurationProperties,
  }
}

async function writeGroup(
  path: string,
  group: MetadataWriteGroup,
  useLiveApi: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const api = window.electronAPI?.solidworks
  if (!api) return { ok: false, error: 'The SolidWorks service is not available' }

  try {
    const result = useLiveApi
      ? await api.setDocumentProperties?.(path, group.properties, group.configuration)
      : await api.setProperties(path, group.properties, group.configuration)
    if (result?.success) return { ok: true }
    return { ok: false, error: result?.error ?? 'The write returned no result' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Write every group, then read the document back once and decide each address on the evidence.
 *
 * A group whose write call failed is recorded `failed` without consulting the read-back: the call
 * said nothing was written, and a stale value that happens to match would otherwise verify a write
 * that never happened.
 */
export async function writeMetadataWithVerification(
  request: MetadataWriteRequest,
): Promise<MetadataWriteResult> {
  const allIntents = request.groups.flatMap((group) => group.intents)
  if (allIntents.length === 0) {
    return { outcome: 'not-applicable', addresses: [], writeMs: 0, readBackMs: null, document: null }
  }

  const writeStarted = performance.now()
  const accepted: MetadataWriteIntent[] = []
  const rejected: VerifiedAddress[] = []

  for (const group of request.groups) {
    if (Object.keys(group.properties).length === 0) {
      // A group with intents and nothing to send cannot establish them, and skipping it silently
      // would leave those addresses in `allIntents` - which is what decides this is not a no-op -
      // and out of `addresses`, so nothing would record a verdict for them at all. There is no
      // plan that emits this shape today; saying so out loud is what keeps it that way.
      if (group.intents.length > 0) {
        log.warn('[MetadataWrite]', 'A write group named addresses but carried no properties', {
          path: request.path,
          configuration: group.configuration ?? '(file scope)',
          intents: group.intents.length,
        })
        rejected.push(
          ...unattemptedWrite(group.intents, 'the write plan produced no properties to send'),
        )
      }
      continue
    }
    const result = await writeGroup(request.path, group, request.useLiveApi === true)
    if (result.ok) accepted.push(...group.intents)
    else rejected.push(...failedWrite(group.intents, result.error ?? 'the write failed'))
  }
  const writeMs = Math.round(performance.now() - writeStarted)

  if (accepted.length === 0) {
    const addresses = rejected
    return {
      outcome: summarizeOutcome(addresses),
      addresses,
      writeMs,
      readBackMs: null,
      document: null,
    }
  }

  let readBackMs: number | null = null
  let document: FileMetadata | null = null
  let verified: VerifiedAddress[]
  try {
    const readStarted = performance.now()
    document = await readBack(request.path)
    readBackMs = Math.round(performance.now() - readStarted)
    verified = verifyWrite(accepted, document)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.warn('[MetadataWrite]', 'Could not read the file back to confirm the write', {
      path: request.path,
      reason,
    })
    verified = unverifiedWrite(accepted, reason)
  }

  const addresses = [...verified, ...rejected]

  log.info('[MetadataWrite]', 'Verified write complete', {
    path: request.path,
    writeMs,
    readBackMs,
    verified: addresses.filter((entry) => entry.state === 'verified').length,
    unverified: addresses.filter((entry) => entry.state === 'unverified').length,
    failed: addresses.filter((entry) => entry.state === 'failed').length,
  })

  return { outcome: summarizeOutcome(addresses), addresses, writeMs, readBackMs, document }
}
