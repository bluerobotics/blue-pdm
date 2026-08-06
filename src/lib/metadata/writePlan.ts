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
 * Configuration-scope groups come first and the file-scope group last, so a document with
 * configurations never receives a file-scope write for a field a configuration is about to set - the
 * two would disagree and the last one would win by accident.
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

  const groups: MetadataWriteGroup[] = []

  if (configurations.length > 0) {
    const baseConfiguration = (configurations.find((c) => c.isActive) ?? configurations[0]).name

    // Configurations this write has anything to say to: the ones edited, plus the one that carries
    // the file-scope fields when those changed.
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
      const isBase = configuration.name === baseConfiguration
      // A file-scope field on a multi-configuration document is written into the configuration
      // SolidWorks resolves it from, so its read-back has to look there too.
      const verifyIn = { configuration: configuration.name }

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
      if (partNumberEdited && isBase && includes({ scope: 'file', field: 'part_number' })) {
        intents.push({
          address: { scope: 'file', field: 'part_number' },
          expected: baseNumber,
          verifyIn,
        })
      }

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
      } else if (descriptionEdited && isBase && includes({ scope: 'file', field: 'description' })) {
        intents.push({
          address: { scope: 'file', field: 'description' },
          expected: description,
          verifyIn,
        })
      }

      if (revisionEdited || revision) properties['Revision'] = revision
      if (revisionEdited && isBase && includes({ scope: 'file', field: 'revision' })) {
        intents.push({ address: { scope: 'file', field: 'revision' }, expected: revision, verifyIn })
      }

      if (input.parity) {
        properties['Date'] = input.parity.date
        if (input.parity.drawnBy) properties['DrawnBy'] = input.parity.drawnBy
      }

      groups.push({ configuration: configuration.name, properties, intents })
    }

    return groups
  }

  // No configurations: everything goes to file scope.
  const properties: Record<string, string> = {}
  const intents: MetadataWriteIntent[] = []
  const tab = sanitizeTabNumber(pending.tab_number, validation)

  if (baseNumber) {
    properties['Number'] = fullNumber(baseNumber, tab, serialization)
    properties['Base Item Number'] = baseNumber
  } else if (partNumberEdited) {
    properties['Number'] = ''
    properties['Base Item Number'] = ''
  }
  if (partNumberEdited && includes({ scope: 'file', field: 'part_number' })) {
    intents.push({ address: { scope: 'file', field: 'part_number' }, expected: baseNumber })
  }

  if (tab || tabNumberEdited) properties['Tab Number'] = tab
  if (tabNumberEdited && includes({ scope: 'file', field: 'tab_number' })) {
    intents.push({ address: { scope: 'file', field: 'tab_number' }, expected: tab })
  }

  if (descriptionEdited || baseDescription) properties['Description'] = baseDescription
  if (descriptionEdited && includes({ scope: 'file', field: 'description' })) {
    intents.push({ address: { scope: 'file', field: 'description' }, expected: baseDescription })
  }

  if (revisionEdited || revision) properties['Revision'] = revision
  if (revisionEdited && includes({ scope: 'file', field: 'revision' })) {
    intents.push({ address: { scope: 'file', field: 'revision' }, expected: revision })
  }

  if (input.parity) {
    properties['Date'] = input.parity.date
    if (input.parity.drawnBy) properties['DrawnBy'] = input.parity.drawnBy
  }

  if (intents.length === 0 && Object.keys(properties).length === 0) return []

  groups.push({ properties, intents })
  return groups
}
