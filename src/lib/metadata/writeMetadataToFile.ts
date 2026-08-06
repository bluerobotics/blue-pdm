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
 * ## What the write and the read-back cost
 *
 * Both halves are one service call, and neither scales with the configuration count.
 *
 * The read-back is one `getProperties` however many configurations were touched, because that call
 * returns the file bag, every configuration's bag and the configuration list from a single Document
 * Manager open. The write is one `setPropertiesBatch`, which `DocumentManagerAPI` answers by
 * writing every configuration inside one open/save cycle rather than by looping.
 *
 * Measured on the 68-configuration `ORING-BUNA-70A.SLDPRT` regression fixture, driving a service
 * built from `solidworks-service/` directly over its stdin protocol, five rounds, medians. The
 * whole sequence a sync issues - the document bag, all 68 configurations, the read-back, 275
 * properties in all - takes 11,772ms with one `setProperties` per scope and 1,422ms with one
 * batch. The write alone is 11,363ms looped against 797ms batched; the read-back is ~600ms either
 * way. So the read-back, not the write, is now the larger half, which is why it is the half that
 * was never worth batching.
 *
 * At that price verification runs on every production write, which is why there is no flag to turn
 * it off. The one place it is deliberately skipped is a write no scope accepted: there is nothing
 * to confirm, the state is already known, and paying for an open to learn nothing would be the one
 * case where the cost buys nothing.
 *
 * ## Why the batch does not weaken the verdicts
 *
 * The per-address states are decided by the read-back, which names every configuration, so one
 * call for 68 scopes still reports 66 verified and 2 failed by name. What the batch has to carry
 * beyond that is the refusal signal: a scope the service says it did not write must be `failed`
 * without consulting the read-back, or a stale value that happens to match would confirm a write
 * that never happened. `batchWriteReport.ts` recovers that from the response, and says there what
 * it can and cannot recover.
 *
 * What it cannot recover is a configuration the service neither entered nor named, which it
 * reports only as a shortfall in the count. That used to be logged and then dropped, leaving the
 * read-back to confirm scopes nobody claimed to have written. It now downgrades them to
 * `unverified`, because "nobody knows" is what is true. Service 1.20.0 names the configurations it
 * refused, so on a current service the shortfall is zero and nothing is downgraded; the downgrade
 * is what keeps an older service honest rather than optimistic.
 *
 * ## Clearing a field
 *
 * A cleared field is written as an empty property, not removed. A drawing title block linked with
 * `$PRP:` renders blank against an empty property and can break against a missing one, and a
 * property that stays visible in SolidWorks' own dialog is what a user expects from clearing a field
 * rather than deleting it. Empty values are therefore included in the properties sent, not filtered
 * out, and an intent whose expected value is empty is a real intent that gets verified like any
 * other. Service 1.19.0 holds up the other end: its write paths carry an empty value through
 * instead of reading it as an instruction to delete, and deleting is a separate command. Against
 * an older service the value the app reads next time is still right; only the shape differs.
 */

import { log } from '@/lib/logger'

import { readBatchWriteReport, type BatchWriteScope } from './batchWriteReport'
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
import { addressKey } from './writeState'

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

/** A scope whose write failed while naming no address, so no verdict can carry the news. */
export interface UnrecordedScopeFailure {
  /** The configuration name, or `(file scope)` for the document's own bag. */
  scope: string
  reason: string
}

export interface MetadataWriteResult {
  /** The whole write's outcome, rounded from the per-address verdicts for callers that need one. */
  outcome: MetadataWriteOutcome
  /** The per-address verdicts, which are what gets recorded and what the UI marks. */
  addresses: VerifiedAddress[]
  /**
   * Writes that failed and could not be blamed on an address, because their group named none.
   *
   * Nothing in the per-address verdicts can express this, and rounding it away is what let a
   * failed write of the document's own property bag finish as `verified`. No plan emits an
   * intent-less group any more; this is what makes the next one say so rather than pass.
   */
  unrecordedFailures: UnrecordedScopeFailure[]
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

/**
 * The outcome, once a failure no address speaks for is taken into account.
 *
 * A write that failed is not a write that succeeded, whether or not the group it belonged to
 * named an address. With addresses present the honest answer is `partial` - something landed and
 * something did not - and with none it is simply `failed`.
 */
function roundOutcome(
  addresses: readonly VerifiedAddress[],
  unrecordedFailures: readonly UnrecordedScopeFailure[],
): MetadataWriteOutcome {
  if (unrecordedFailures.length === 0) return summarizeOutcome(addresses)
  return addresses.length === 0 ? 'failed' : 'partial'
}

/** The name a file-scope group goes by in a log line or a failure. */
const FILE_SCOPE = '(file scope)'

const UNACCOUNTED = 'the service did not say whether this configuration was written'

/**
 * Refuse to confirm an address the service could not account for.
 *
 * The read-back is the more authoritative half of every other verdict, and deliberately so - it
 * looks at the file. It is not authoritative about a scope that may never have been written,
 * because a stale value equal to the intended one reads exactly like a value the write just put
 * there. `verified` stops the retry and check-in forgets it, so this is the one direction where
 * the read-back must be overruled.
 *
 * Only `verified` is downgraded. A read-back that found the value missing is decisive whatever the
 * service said, so a `failed` verdict is left as it is.
 */
function withDoubtKept(
  verified: readonly VerifiedAddress[],
  unaccountedFor: ReadonlySet<string>,
): VerifiedAddress[] {
  if (unaccountedFor.size === 0) return [...verified]
  return verified.map((entry) =>
    entry.state === 'verified' && unaccountedFor.has(addressKey(entry.address))
      ? { address: entry.address, state: 'unverified' as const, reason: UNACCOUNTED }
      : entry,
  )
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

/** One configuration group with its scope named, which is what the batch call is addressed by. */
interface ConfigurationGroup extends MetadataWriteGroup {
  configuration: string
}

function isConfigurationGroup(group: MetadataWriteGroup): group is ConfigurationGroup {
  return group.configuration !== undefined
}

/**
 * Whether these configuration groups can go in one call.
 *
 * Two groups naming the same configuration cannot: the request is a map keyed by configuration, so
 * the second would silently replace the first and its properties would never be sent. No plan
 * emits that shape - `buildMetadataWritePlan` produces one group per configuration - and refusing
 * to batch rather than trusting it is what keeps a future one from losing a write in silence.
 *
 * A single configuration is left alone because the batch would be one call either way, and
 * `setProperties` states its verdict for that scope outright instead of leaving it to be recovered
 * from the batch's report. The inline configuration editors take that path on every keystroke.
 */
function canBatch(groups: readonly ConfigurationGroup[]): boolean {
  if (groups.length < 2) return false
  return new Set(groups.map((group) => group.configuration)).size === groups.length
}

interface BatchWriteOutcome {
  ok: boolean
  error?: string
  refused: ReadonlyMap<string, string>
  /**
   * Configurations the service neither entered nor named, so nothing can say whether they were
   * written. Carried out of here rather than only logged: the read-back cannot settle it either,
   * and letting it decide is how a scope that was skipped reported `verified` off a stale value.
   */
  unaccountedFor: number
}

async function writeConfigurationBatch(
  path: string,
  groups: readonly ConfigurationGroup[],
): Promise<BatchWriteOutcome> {
  const api = window.electronAPI?.solidworks
  if (!api?.setPropertiesBatch) {
    return {
      ok: false,
      error: 'The SolidWorks service is not available',
      refused: new Map(),
      unaccountedFor: 0,
    }
  }

  const configProperties: Record<string, Record<string, string>> = {}
  const sent: BatchWriteScope[] = []
  for (const group of groups) {
    configProperties[group.configuration] = group.properties
    sent.push({ configuration: group.configuration, propertyNames: Object.keys(group.properties) })
  }

  try {
    const result = await api.setPropertiesBatch(path, configProperties)
    if (!result?.success) {
      // The service fails a whole batch only when nothing in it reached the file: the document
      // would not open, the save was refused, or every property was declined. Every scope is
      // therefore refused, which is what the per-scope calls reported one at a time.
      return {
        ok: false,
        error: result?.error ?? 'The write returned no result',
        refused: new Map(),
        unaccountedFor: 0,
      }
    }

    const report = readBatchWriteReport(sent, result.data)
    if (report.unaccountedFor > 0) {
      log.warn('[MetadataWrite]', 'The batch write did not account for every configuration', {
        path,
        configurations: groups.length,
        unaccountedFor: report.unaccountedFor,
      })
    }
    return { ok: true, refused: report.refused, unaccountedFor: report.unaccountedFor }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      refused: new Map(),
      unaccountedFor: 0,
    }
  }
}

/**
 * Write every group, then read the document back once and decide each address on the evidence.
 *
 * A group whose write the service reported as refused is recorded `failed` without consulting the
 * read-back: nothing was written, and a stale value that happens to match would otherwise verify a
 * write that never happened.
 *
 * Configuration groups go in one `setPropertiesBatch`; the file-scope group keeps its own
 * `setProperties`, because the batch addresses configurations by name and has no file scope to
 * send to. Groups are visited in the order the plan gave them, and the batch is issued where its
 * first group sat, so the document bag is written before the configurations - which matters,
 * because the service mirrors a configuration write's `Number` back to file level inside the same
 * open.
 *
 * A group that carries properties, names no address and fails is reported in `unrecordedFailures`
 * rather than rounded away. No plan emits that shape now; before, Sync Metadata emitted one per
 * part and a read-only file took it silently.
 */
export async function writeMetadataWithVerification(
  request: MetadataWriteRequest,
): Promise<MetadataWriteResult> {
  const allIntents = request.groups.flatMap((group) => group.intents)
  if (allIntents.length === 0) {
    return {
      outcome: 'not-applicable',
      addresses: [],
      unrecordedFailures: [],
      writeMs: 0,
      readBackMs: null,
      document: null,
    }
  }

  const writeStarted = performance.now()
  const accepted: MetadataWriteIntent[] = []
  const rejected: VerifiedAddress[] = []
  const unrecordedFailures: UnrecordedScopeFailure[] = []
  // Addresses the service neither confirmed nor refused. The read-back cannot settle them: a stale
  // value equal to the intended one is indistinguishable from a value the write put there.
  const unaccountedFor = new Set<string>()

  const sendable: MetadataWriteGroup[] = []
  for (const group of request.groups) {
    if (Object.keys(group.properties).length > 0) {
      sendable.push(group)
      continue
    }
    // A group with intents and nothing to send cannot establish them, and skipping it silently
    // would leave those addresses in `allIntents` - which is what decides this is not a no-op -
    // and out of `addresses`, so nothing would record a verdict for them at all. There is no
    // plan that emits this shape today; saying so out loud is what keeps it that way.
    if (group.intents.length > 0) {
      log.warn('[MetadataWrite]', 'A write group named addresses but carried no properties', {
        path: request.path,
        configuration: group.configuration ?? FILE_SCOPE,
        intents: group.intents.length,
      })
      rejected.push(
        ...unattemptedWrite(group.intents, 'the write plan produced no properties to send'),
      )
    }
  }

  // The live SolidWorks API is per scope by nature - `setDocumentProperties` has no batch - so a
  // document open in SolidWorks keeps the loop.
  const useLiveApi = request.useLiveApi === true
  const configurationGroups = useLiveApi ? [] : sendable.filter(isConfigurationGroup)
  const batching = canBatch(configurationGroups)
  let batchIssued = false

  for (const group of sendable) {
    if (batching && isConfigurationGroup(group)) {
      if (batchIssued) continue
      batchIssued = true

      const batch = await writeConfigurationBatch(request.path, configurationGroups)
      const wholeBatchRefused = batch.ok ? undefined : (batch.error ?? 'the write failed')
      for (const configurationGroup of configurationGroups) {
        const refusal = wholeBatchRefused ?? batch.refused.get(configurationGroup.configuration)
        if (refusal !== undefined) {
          rejected.push(...failedWrite(configurationGroup.intents, refusal))
          continue
        }
        accepted.push(...configurationGroup.intents)
        // The service entered fewer configurations than it was sent and named none of the ones it
        // skipped, so which of these landed is unknowable from here. Every scope in the batch
        // inherits the doubt, because nothing distinguishes them.
        if (batch.unaccountedFor > 0) {
          for (const intent of configurationGroup.intents) {
            unaccountedFor.add(addressKey(intent.address))
          }
        }
      }
      continue
    }

    const result = await writeGroup(request.path, group, useLiveApi)
    if (result.ok) {
      accepted.push(...group.intents)
      continue
    }
    const reason = result.error ?? 'the write failed'
    if (group.intents.length > 0) rejected.push(...failedWrite(group.intents, reason))
    else unrecordedFailures.push({ scope: group.configuration ?? FILE_SCOPE, reason })
  }
  const writeMs = Math.round(performance.now() - writeStarted)

  if (accepted.length === 0) {
    const addresses = rejected
    return {
      outcome: roundOutcome(addresses, unrecordedFailures),
      addresses,
      unrecordedFailures,
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

  const addresses = [...withDoubtKept(verified, unaccountedFor), ...rejected]

  log.info('[MetadataWrite]', 'Verified write complete', {
    path: request.path,
    writeMs,
    readBackMs,
    verified: addresses.filter((entry) => entry.state === 'verified').length,
    unverified: addresses.filter((entry) => entry.state === 'unverified').length,
    failed: addresses.filter((entry) => entry.state === 'failed').length,
    unrecordedFailures: unrecordedFailures.length,
  })

  return {
    outcome: roundOutcome(addresses, unrecordedFailures),
    addresses,
    unrecordedFailures,
    writeMs,
    readBackMs,
    document,
  }
}
