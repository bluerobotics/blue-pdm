/**
 * Turning a set of pending edits into the properties a SolidWorks document should end up holding.
 *
 * There are now two callers with the same question and no business disagreeing about the answer: the
 * datacard's save, which writes what the user just typed, and check-in, which writes whatever the
 * datacard could not. Before this module the mapping from a logical field to a property name lived
 * inside the save handler, so check-in could only have had its own copy - and a second copy of
 * "`part_number` means `Number` plus `Base Item Number`, and `Number` carries the tab" is a copy that
 * drifts, silently, into two different files on disk.
 *
 * ## What the plan says, and what it deliberately does not
 *
 * A plan is properties plus intents, grouped by the scope they are written to. The intents are what
 * makes the write checkable: each one names the field whose state the write decides and the value
 * the document should hold afterwards, which is all `verifyWrite.ts` needs.
 *
 * Presence decides, not truthiness. A field the pending set mentions is written whatever its value,
 * so clearing it puts an empty property in the document rather than leaving the old value there. A
 * field the pending set does not mention is left out entirely, which is not the same as writing
 * nothing to it. This is the same rule the read layer settled on, applied at the write layer, and it
 * is what makes a full clear expressible as a write instead of as an absence of one.
 *
 * ## A file-scope field lives in the document's own bag
 *
 * A document with configurations used to receive no file-scope group at all. Its file-scope intents
 * were redirected into the base configuration, so `verifyWrite` looked for the new part number in
 * the configuration that had just been written, found it, and reported `verified` while the
 * document's own property bag still held the value from before the edit. Nothing marked the file,
 * check-in forgot it, and a `$PRP:"Description"` title block went on rendering the old text.
 *
 * The scanner never agreed: `compareOwnedMetadata` reads every file-scope field out of
 * `file.fileProperties` whatever the document's configuration count, so it reported as divergent
 * exactly what the write had just called confirmed. Two modules held different beliefs about where
 * a file-scope field lives, and the plan is where the disagreement started.
 *
 * So the file-scope group is emitted for every document, and its intents are confirmed where the
 * scanner looks for them. The configurations still receive the same properties - SolidWorks
 * resolves a file-scope field from the configuration's bag when one is active, which is what makes
 * a configuration-specific title block right - but they are copies, and the address they answer for
 * is the document's.
 *
 * Pure: no I/O, no store access, no React.
 */

import { combineBaseAndTab } from '@/lib/serialization'
import { sanitizeTabNumber, type TabValidationOptions } from '@/lib/tabValidation'
import type { PendingMetadata } from '@/stores/types'

import type { MetadataWriteIntent } from './verifyWrite'
import type { MetadataWriteAddress } from './writeState'
import { addressKey } from './writeState'
import type { MetadataWriteGroup } from './writeMetadataToFile'

/** The serialization settings the plan needs, narrowed to the two questions it asks. */
export interface PlanSerialization {
  tabEnabled: boolean
  /** Passed whole to `combineBaseAndTab`, which owns separator and suffix handling. */
  settings: Parameters<typeof combineBaseAndTab>[2]
  validation?: TabValidationOptions
}

/** One configuration as the caller currently understands it. */
export interface PlanConfiguration {
  name: string
  isActive?: boolean
  /** The tab the file holds today, used when this configuration's tab was not edited. */
  tabNumber?: string
  /** The description the file holds today, used when neither this nor the base was edited. */
  description?: string
}

export interface MetadataWritePlanInput {
  pending: PendingMetadata
  /** What the database holds, for the fields this edit leaves alone. */
  committed: {
    partNumber?: string | null
    description?: string | null
    revision?: string | null
  }
  /** Empty when the document has no configurations worth writing per configuration. */
  configurations: readonly PlanConfiguration[]
  serialization: PlanSerialization | null
  /**
   * Restrict the plan to these addresses.
   *
   * Check-in passes the addresses that are not confirmed in the file, so it rewrites only what is
   * actually owed rather than every field the user has touched since the last check-in. Absent means
   * every address the pending set names.
   */
  only?: readonly MetadataWriteAddress[]
  /**
   * The `Date` and `DrawnBy` properties BluePLM keeps in step with SolidWorks PDM. Omitted by
   * callers - check-in - that are repairing a write rather than making one, since restamping them
   * would attribute an old edit to whoever happened to run the check-in.
   */
  parity?: { date: string; drawnBy: string }
}

function fullNumber(base: string, tab: string, serialization: PlanSerialization | null): string {
  if (!tab) return base
  if (serialization?.tabEnabled) return combineBaseAndTab(base, tab, serialization.settings)
  return `${base}-${tab}`
}

/**
 * Build the properties and intents for every scope this edit touches.
 *
 * The document's own group comes first and the configurations follow, because the service mirrors
 * a configuration write's `Number` back to file level inside the same open. Writing the document
 * bag afterwards would undo that mirror on some paths and not others depending on how many
 * configurations happened to be in the batch, and a document whose file-level number depends on
 * the shape of the last write is the kind of thing nobody can reason about later.
 */
export function buildMetadataWritePlan(input: MetadataWritePlanInput): MetadataWriteGroup[] {
  const { pending, committed, configurations, serialization } = input
  const wanted = input.only ? new Set(input.only.map(addressKey)) : null
  const includes = (address: MetadataWriteAddress): boolean =>
    wanted === null || wanted.has(addressKey(address))

  const validation = serialization?.validation

  const partNumberEdited = pending.part_number !== undefined
  const descriptionEdited = pending.description !== undefined
  const revisionEdited = pending.revision !== undefined
  const tabNumberEdited = pending.tab_number !== undefined

  // A cleared field takes the empty value, not the old one. Falling back to the committed value on a
  // clear is the "bounce back" bug: the deletion is resurrected from the row it was deleting from.
  const baseNumber = partNumberEdited ? (pending.part_number ?? '') : (committed.partNumber ?? '')
  const baseDescription = descriptionEdited
    ? (pending.description ?? '')
    : (committed.description ?? '')
  const revision = revisionEdited ? (pending.revision ?? '') : (committed.revision ?? '')

  const pendingTabs = pending.config_tabs ?? {}
  const pendingDescriptions = pending.config_descriptions ?? {}

  // The document's own property bag. Every file-scope address is established here and confirmed
  // here, which is also where the divergence scanner reads a file-scope field from.
  const documentProperties: Record<string, string> = {}
  const documentIntents: MetadataWriteIntent[] = []
  const fileTab = sanitizeTabNumber(pending.tab_number, validation)

  if (baseNumber) {
    documentProperties['Number'] = fullNumber(baseNumber, fileTab, serialization)
    documentProperties['Base Item Number'] = baseNumber
  } else if (partNumberEdited) {
    documentProperties['Number'] = ''
    documentProperties['Base Item Number'] = ''
  }
  if (partNumberEdited && includes({ scope: 'file', field: 'part_number' })) {
    documentIntents.push({ address: { scope: 'file', field: 'part_number' }, expected: baseNumber })
  }

  if (fileTab || tabNumberEdited) documentProperties['Tab Number'] = fileTab
  if (tabNumberEdited && includes({ scope: 'file', field: 'tab_number' })) {
    documentIntents.push({ address: { scope: 'file', field: 'tab_number' }, expected: fileTab })
  }

  if (descriptionEdited || baseDescription) documentProperties['Description'] = baseDescription
  if (descriptionEdited && includes({ scope: 'file', field: 'description' })) {
    documentIntents.push({
      address: { scope: 'file', field: 'description' },
      expected: baseDescription,
    })
  }

  if (revisionEdited || revision) documentProperties['Revision'] = revision
  if (revisionEdited && includes({ scope: 'file', field: 'revision' })) {
    documentIntents.push({ address: { scope: 'file', field: 'revision' }, expected: revision })
  }

  if (input.parity) {
    documentProperties['Date'] = input.parity.date
    if (input.parity.drawnBy) documentProperties['DrawnBy'] = input.parity.drawnBy
  }

  const documentGroup: MetadataWriteGroup = {
    properties: documentProperties,
    intents: documentIntents,
  }

  const configurationGroups: MetadataWriteGroup[] = []

  if (configurations.length > 0) {
    const baseConfiguration = (configurations.find((c) => c.isActive) ?? configurations[0]).name

    // Configurations this write has anything to say to: the ones edited, plus the one that carries
    // the copies of the file-scope fields when those changed.
    const touched = new Set<string>()
    for (const name of Object.keys(pendingTabs)) {
      if (includes({ scope: 'configuration', field: 'config_tab', configuration: name })) {
        touched.add(name)
      }
    }
    for (const name of Object.keys(pendingDescriptions)) {
      if (includes({ scope: 'configuration', field: 'config_description', configuration: name })) {
        touched.add(name)
      }
    }
    const baseFieldsWanted =
      (partNumberEdited && includes({ scope: 'file', field: 'part_number' })) ||
      (descriptionEdited && includes({ scope: 'file', field: 'description' })) ||
      (revisionEdited && includes({ scope: 'file', field: 'revision' }))
    if (baseFieldsWanted) touched.add(baseConfiguration)

    for (const configuration of configurations.filter((c) => touched.has(c.name))) {
      const properties: Record<string, string> = {}
      const intents: MetadataWriteIntent[] = []

      const tabAddress: MetadataWriteAddress = {
        scope: 'configuration',
        field: 'config_tab',
        configuration: configuration.name,
      }
      const tabEdited = pendingTabs[configuration.name] !== undefined && includes(tabAddress)
      const tab = sanitizeTabNumber(
        tabEdited ? pendingTabs[configuration.name] : (configuration.tabNumber ?? ''),
        validation,
      )

      if (baseNumber) {
        properties['Number'] = fullNumber(baseNumber, tab, serialization)
        properties['Base Item Number'] = baseNumber
      } else if (partNumberEdited) {
        properties['Number'] = ''
        properties['Base Item Number'] = ''
      }
      // Emitted when cleared as well as when set, so clearing a tab empties the property rather than
      // leaving the old tab behind. A configuration with no tab that nobody edited gains nothing.
      if (tab || tabEdited) properties['Tab Number'] = tab

      if (tabEdited) intents.push({ address: tabAddress, expected: tab })

      const descriptionAddress: MetadataWriteAddress = {
        scope: 'configuration',
        field: 'config_description',
        configuration: configuration.name,
      }
      const configDescriptionEdited =
        pendingDescriptions[configuration.name] !== undefined && includes(descriptionAddress)
      const description = configDescriptionEdited
        ? (pendingDescriptions[configuration.name] ?? '')
        : descriptionEdited
          ? baseDescription
          : (configuration.description ?? baseDescription)

      if (configDescriptionEdited || descriptionEdited || description) {
        properties['Description'] = description
      }
      if (configDescriptionEdited) {
        intents.push({ address: descriptionAddress, expected: description })
      }

      if (revisionEdited || revision) properties['Revision'] = revision

      if (input.parity) {
        properties['Date'] = input.parity.date
        if (input.parity.drawnBy) properties['DrawnBy'] = input.parity.drawnBy
      }

      configurationGroups.push({ configuration: configuration.name, properties, intents })
    }
  }

  // The document's bag is written when this edit has a file-scope address to establish there, and
  // on a document with no configurations, where it is the only place anything can go. It is not
  // written for a configuration-only edit: no file-scope field changed, so the extra open and save
  // - paid on every committed keystroke in the inline configuration editors - would buy nothing.
  const documentGroupWanted =
    documentIntents.length > 0 ||
    (configurationGroups.length === 0 && Object.keys(documentProperties).length > 0)

  return documentGroupWanted ? [documentGroup, ...configurationGroups] : configurationGroups
}
