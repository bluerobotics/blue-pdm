/**
 * PUSH: writing BluePLM's metadata into a SolidWorks document, and confirming it landed.
 *
 * Split out of `syncMetadata.ts` and migrated onto the shared write path. This half used to be the
 * last metadata writer in the app with its own property construction and its own idea of what a
 * successful write was: it built the properties inline, read the two configuration maps straight
 * off `pendingMetadata` - which stripped the tab from every configuration of any file nobody had
 * edited this session - filtered empty values out so a cleared field kept its old value, and took
 * the service's reply as proof. It recorded no write state at all, so the datacard could not say
 * which fields had reached the file.
 *
 * Now `syncMetadataPlan.ts` decides what to write, `writeMetadataWithVerification` writes it and
 * reads the document back, and the per-address verdicts are recorded against the file exactly as
 * the datacard's own saves are.
 *
 * ## What verification costs here
 *
 * One `setPropertiesBatch` for every configuration and one `getProperties` to confirm them, so two
 * service calls whatever the configuration count. Migrating to the shared path briefly cost a call
 * per scope - 68 opens on the 68-configuration fixture, eleven seconds of writing against under
 * one - until `writeMetadataWithVerification` learned to send the groups together. It owns
 * the measurement and the reasoning; this file only calls it.
 */

import { t } from '@/lib/i18n'
import { readDocumentConfigurations } from '@/lib/metadata/configurationRead'
import { resolveFileMetadata, resolvedText } from '@/lib/metadata/overlay'
import { writeMetadataWithVerification } from '@/lib/metadata/writeMetadataToFile'
import type { PlanSerialization } from '@/lib/metadata/writePlan'
import type { VerifiedAddress } from '@/lib/metadata/verifyWrite'
import { getSerializationSettings } from '@/lib/serialization'
import { getTabValidationOptions } from '@/lib/tabValidation'
import { usePDMStore } from '@/stores/pdmStore'

import type { LocalFile } from '../types'

import { WATCHER_SUPPRESSION_MS, logSync, type ExtractedMetadata } from './syncMetadataCommon'
import { buildPartAssemblyPushPlan, type PushConfiguration } from './syncMetadataPlan'
import { deriveBaseNumber, readConfigurationTab } from './syncMetadataProperties'

export interface PushResult {
  success: boolean
  error?: string
}

/**
 * The document's configurations, with the tab each one currently holds, or the reason the service
 * could not say.
 *
 * Read before anything is written, because the plan needs them: a configuration BluePLM has no tab
 * for keeps its own rather than being emptied.
 *
 * The two outcomes are kept apart because they mean opposite things. An empty list is a document
 * that keeps its metadata at file level - a drawing, most often. A failed call is a document that
 * may keep all of it in configurations this write is about to ignore, and reading the second as
 * the first is exactly how a PUSH came to write the document bag, verify that one scope honestly,
 * and report "confirmed in the file" while all 68 configurations kept their old values.
 *
 * `readDocumentConfigurations` is where that distinction is now made, once, for the three write
 * paths that need it. This function only adds the tabs.
 */
type PushConfigurationRead =
  | { readonly ok: true; readonly configurations: PushConfiguration[] }
  | { readonly ok: false; readonly reason: string }

async function readConfigurations(
  fullPath: string,
  separator: string,
): Promise<PushConfigurationRead> {
  const read = await readDocumentConfigurations(fullPath)
  if (!read.ok) return { ok: false, reason: read.reason }

  return {
    ok: true,
    configurations: read.configurations.map((configuration) => ({
      name: configuration.name,
      isActive: configuration.isActive,
      tabNumber: readConfigurationTab(configuration.properties, separator),
    })),
  }
}

/** The sentence the user sees when the document did not take everything it was sent. */
function describeUnwritten(
  addresses: readonly VerifiedAddress[],
  configurationCount: number,
  unaddressedConfigurations: readonly string[] = [],
): string {
  // First, because it is the one shortfall no address can express: every verdict may read
  // `verified` and the document still disagree, in every configuration the plan never reached.
  if (unaddressedConfigurations.length > 0) {
    return t('metadataWrite.configurationsUnaddressed', {
      count: unaddressedConfigurations.length,
    })
  }

  const failed = addresses.filter((entry) => entry.state === 'failed')
  const configurations = new Set(
    failed
      .filter((entry) => entry.address.scope === 'configuration')
      .map((entry) => (entry.address as { configuration: string }).configuration),
  )

  if (configurations.size > 0) {
    return t('metadataWrite.configurationsFailed', {
      failed: configurations.size,
      total: configurationCount,
    })
  }

  return t('metadataWrite.fieldsUnwritten', {
    failed: failed.length,
    total: addresses.length,
  })
}

/**
 * Refresh localHash to match the new disk content.
 *
 * localVersion is intentionally left untouched: it tracks which downloaded/checked-in version's
 * content the file started from, not the user's local edits. After this, the load-time merge can
 * correctly classify the file as 'modified'.
 */
async function refreshHashAfterWrite(file: LocalFile, fullPath: string): Promise<void> {
  try {
    const hashResult = await window.electronAPI?.hashFile(fullPath)
    if (hashResult?.success && hashResult.hash) {
      usePDMStore.getState().updateFileInStore(file.path, { localHash: hashResult.hash })
      logSync('debug', 'localHash refreshed after PUSH', {
        fullPath,
        hashPrefix: hashResult.hash.slice(0, 8),
      })
      return
    }
    logSync('warn', 'Failed to rehash after PUSH; clearing stale localHash', {
      fullPath,
      error: hashResult?.error,
    })
  } catch (error) {
    logSync('warn', 'Exception rehashing after PUSH; clearing stale localHash', {
      fullPath,
      error: String(error),
    })
  }
  // Clearing is safer than leaving the pre-write hash that no longer matches disk.
  usePDMStore.getState().updateFileInStore(file.path, { localHash: undefined })
}

/**
 * PUSH: Write metadata from BluePLM into a part/assembly file.
 *
 * BluePLM is the source of truth for part/assembly metadata, so this writes everything it holds
 * into the document bag and into every configuration - see `syncMetadataPlan.ts` for what "holds"
 * means and why it is not the same as "is not empty".
 */
export async function pushPartAssemblyMetadata(
  file: LocalFile,
  fullPath: string,
  options: { omitRevision?: boolean } = {},
): Promise<PushResult> {
  logSync('debug', 'PUSH: Writing metadata to part/assembly', { fullPath })

  const store = usePDMStore.getState()
  const orgId = store.organization?.id
  let serSettings: Awaited<ReturnType<typeof getSerializationSettings>> | null = null
  if (orgId) {
    try {
      serSettings = await getSerializationSettings(orgId)
    } catch {
      logSync('warn', 'Failed to get serialization settings, using defaults', { fullPath })
    }
  }

  const serialization: PlanSerialization | null = serSettings
    ? {
        tabEnabled: !!serSettings.tab_enabled,
        settings: serSettings,
        validation: getTabValidationOptions(serSettings),
      }
    : null

  const currentUser = store.user
  const parity = {
    date: new Date().toISOString().split('T')[0],
    drawnBy: currentUser?.full_name || currentUser?.email || '',
  }

  const read = await readConfigurations(fullPath, serSettings?.tab_separator || '-')
  if (!read.ok) {
    // Nothing is written at all, deliberately. A plan built without the configuration list can
    // only reach the document's own property bag, and the read-back would then confirm exactly
    // the scope the write had just touched - a `verified` verdict over a document whose
    // configurations still hold the old number. Refusing is the only honest answer available,
    // and it is the answer `settleMetadataForCheckin` already gives to the same question.
    logSync('error', 'Could not list the configurations, so nothing was written', {
      fullPath,
      reason: read.reason,
    })
    return {
      success: false,
      error: t('metadataWrite.configurationsUnreadable'),
    }
  }

  const { configurations } = read

  const groups = buildPartAssemblyPushPlan({
    file,
    configurations,
    serialization,
    parity,
    omitRevision: options.omitRevision,
  })
  if (groups.length === 0) {
    logSync('debug', 'No metadata to write', { fullPath })
    return { success: true }
  }

  const resolved = resolveFileMetadata(file)
  logSync('info', 'Writing BluePLM metadata into the document', {
    fullPath,
    baseNumber: resolvedText(resolved.partNumber),
    description: resolvedText(resolved.description).substring(0, 50),
    revision: options.omitRevision ? 'omitted' : resolvedText(resolved.revision),
    configurationCount: configurations.length,
  })

  // Suppress the FileWatcher for this path while we mutate SLDPRT bytes via SW. Without this, the
  // watcher will fire mid-write and trigger a vault reload that races against our post-write hash
  // refresh. Cleared after a delay to cover the watcher's debounce window.
  const watcherKey = file.relativePath
  store.addExpectedFileChanges([watcherKey])

  let diskMutated = false
  try {
    // `whole-document`, because that is what a sync is: `buildPartAssemblyPushPlan` names every
    // configuration the read above returned, so a plan that reaches fewer than the file has is a
    // plan built from a list that was wrong. The refusal above is the first defence and this is the
    // second, checked against the read-back instead of against the same list that misled the plan.
    const result = await writeMetadataWithVerification({
      path: fullPath,
      groups,
      coverage: 'whole-document',
    })

    // The per-address verdicts are what the datacard marks and what check-in reads, so they are
    // recorded whatever the outcome. Recorded rather than reported: this command runs over a
    // selection and finishes with one summary, so a toast per file would bury it.
    if (result.addresses.length > 0) {
      usePDMStore.getState().recordMetadataWriteStates(
        file.path,
        result.addresses.map((entry) => ({
          address: entry.address,
          state: entry.state,
          reason: entry.reason,
        })),
      )
    }

    diskMutated = result.addresses.some((entry) => entry.state !== 'unattempted')

    if (result.outcome === 'unverified') {
      // The write was issued and the document could not be read back. That is not a failure - the
      // value may well be there - but it is not the proof this path exists to produce either.
      logSync('warn', 'PUSH complete but could not be confirmed against the file', { fullPath })
      return { success: true }
    }

    if (result.outcome === 'failed' || result.outcome === 'partial') {
      logSync('error', 'PUSH did not reach every scope it was sent to', {
        fullPath,
        addresses: result.addresses.length,
        failed: result.addresses.filter((entry) => entry.state === 'failed').length,
        unaddressedConfigurations: result.unaddressedConfigurations.length,
      })
      return {
        success: false,
        error: describeUnwritten(
          result.addresses,
          configurations.length,
          result.unaddressedConfigurations,
        ),
      }
    }

    logSync('info', 'PUSH complete - confirmed in the file', {
      fullPath,
      configurationCount: configurations.length,
      addresses: result.addresses.length,
    })
    return { success: true }
  } catch (error) {
    logSync('error', 'PUSH threw', { fullPath, error: String(error) })
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (diskMutated) await refreshHashAfterWrite(file, fullPath)

    // Delay clearing the watcher suppression so the debounced FileWatcher event
    // fired by our SW write is filtered out, not the next legitimate user edit.
    setTimeout(() => {
      usePDMStore.getState().clearExpectedFileChanges([watcherKey])
    }, WATCHER_SUPPRESSION_MS)
  }
}

/**
 * PUSH: write parent-inherited metadata into a drawing's own custom properties.
 *
 * Drawings take their item number and description from the referenced model, but nothing used to
 * write those values back into the drawing file. A drawing copied from another item therefore kept
 * the source item's `Number` on disk indefinitely, and it was unreachable from the UI because
 * `lockDrawingItemNumber` makes the cell read-only. PDF export reads these properties directly and
 * prefers them over BluePLM's value, so a drifted drawing yields both a misnamed PDF and a wrong
 * title block.
 *
 * The properties are the parent's own, verbatim, rather than rebuilt from the base and tab through
 * the shared planner: the parent's `Number` is whatever that document holds, and recomposing it
 * from this organisation's separator settings would quietly rewrite a number that came from
 * somewhere else. What the shared path does supply is the proof - the write is read back and each
 * field is marked, so a drawing that refused the correction stops reporting as corrected.
 *
 * Revision is deliberately never written - the drawing's own revision table is authoritative, which
 * is why `pullDrawingMetadata` keeps it and the exporter refuses the PDM revision fallback for
 * drawings.
 */
export async function pushDrawingMetadata(
  file: LocalFile,
  fullPath: string,
  metadata: ExtractedMetadata,
): Promise<PushResult> {
  const properties: Record<string, string> = {}
  const intents = []

  // Truthiness, deliberately, and it is not the `.source` distinction.
  //
  // `metadata` is `ExtractedMetadata`, read out of the *parent document's* own property bag by
  // `extractMetadataFromProperties`. It is not a `ResolvedMetadataField` and there is no overlay
  // behind it: one side, one value, and nothing that could say whether an absent `Number` was
  // cleared by someone or simply never read. Reading it as a clear would empty the number on every
  // drawing whose parent could not be opened, which is the destructive half of a guess. Keeping
  // what the drawing holds is the same rule this file already applies to a configuration tab
  // BluePLM has no opinion about.
  if (metadata.partNumber) {
    properties['Number'] = metadata.partNumber
    properties['Base Item Number'] = deriveBaseNumber(metadata.partNumber, metadata.tabNumber)
    intents.push({
      address: { scope: 'file', field: 'part_number' } as const,
      expected: metadata.partNumber,
    })
  }
  if (metadata.description) {
    properties['Description'] = metadata.description
    intents.push({
      address: { scope: 'file', field: 'description' } as const,
      expected: metadata.description,
    })
  }

  if (intents.length === 0) return { success: true }

  logSync('info', 'Writing inherited properties to drawing', {
    fullPath,
    parentModelPath: metadata.parentModelPath,
    from: { partNumber: metadata.ownPartNumber, description: metadata.ownDescription },
    to: { partNumber: metadata.partNumber, description: metadata.description },
  })

  // Suppress the FileWatcher while we mutate SLDDRW bytes, otherwise it fires mid-write
  // and triggers a vault reload that races the post-write hash refresh below.
  const store = usePDMStore.getState()
  const watcherKey = file.relativePath
  store.addExpectedFileChanges([watcherKey])

  let diskMutated = false
  try {
    // File-level only: drawings have sheets rather than configurations, and both the
    // exporter and pullDrawingMetadata read the drawing's file-level properties.
    const result = await writeMetadataWithVerification({
      path: fullPath,
      groups: [{ properties, intents }],
    })

    if (result.addresses.length > 0) {
      usePDMStore.getState().recordMetadataWriteStates(
        file.path,
        result.addresses.map((entry) => ({
          address: entry.address,
          state: entry.state,
          reason: entry.reason,
        })),
      )
    }

    diskMutated = result.addresses.some((entry) => entry.state !== 'unattempted')

    if (result.outcome === 'failed' || result.outcome === 'partial') {
      return { success: false, error: describeUnwritten(result.addresses, 0) }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (diskMutated) await refreshHashAfterWrite(file, fullPath)

    setTimeout(() => {
      usePDMStore.getState().clearExpectedFileChanges([watcherKey])
    }, WATCHER_SUPPRESSION_MS)
  }
}
