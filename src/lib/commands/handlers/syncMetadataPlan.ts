/**
 * What Sync Metadata should write into a part or assembly, decided before anything is opened.
 *
 * Sync Metadata used to build its own properties. It read the file-scope fields through the overlay
 * and the two configuration maps straight off `pendingMetadata`, which meant a file whose tabs live
 * only in the database - every file nobody edited this session - computed an empty tab for all of
 * its configurations. `Number` went in as the bare base and `Tab Number` was left out, so running
 * the command stripped the tab from every configuration in the file. It also filtered empty values
 * out of the write, so a cleared field kept its old value in the document, and returned early
 * without writing anything at all when all three file-scope fields came out empty - which made a
 * full clear the one edit that could never reach the file.
 *
 * None of that is repaired here. The mapping from a logical field to the properties that carry it
 * belongs to `buildMetadataWritePlan`, which the datacard and check-in already share, and the
 * reason to route this command through it rather than fix nine conditionals is that repaired
 * conditionals drift back. What is left in this module is the one thing the shared planner cannot
 * know: what a *sync* means, as opposed to a save.
 *
 * ## A sync is not an edit
 *
 * The planner writes the fields the pending set names, because a save writes what the user just
 * typed. This command writes everything BluePLM holds, into every configuration the document has,
 * because the user asked for the file to be made to agree with BluePLM. Those are different
 * questions with the same answer shape, so the synthetic pending set below names every field
 * BluePLM has an opinion about and every configuration the document has.
 *
 * "Has an opinion about" is the overlay's `absent`, not emptiness. A field neither side ever set is
 * left out, so the document keeps whatever it holds; a field the user cleared is named with an
 * empty value and is written empty. Those two look identical to `if (value)` and that is what the
 * old code collapsed.
 *
 * A configuration BluePLM holds no tab for keeps the tab the document already has, rather than
 * being emptied: BluePLM never knew about it, so it has nothing to say, and silently deleting a tab
 * the user can see in the configuration list would be the same class of loss this module exists to
 * stop. The old code got the worst of both - it stripped that tab out of `Number` while leaving the
 * `Tab Number` property behind, so the document's two properties disagreed about it.
 *
 * Pure: no I/O, no store access, no React.
 */

import {
  resolveConfigurationDescriptions,
  resolveConfigurationTabs,
  resolveFileMetadata,
  type MetadataOverlaySource,
  type ResolvedMetadataField,
} from '@/lib/metadata/overlay'
import type { MetadataWriteGroup } from '@/lib/metadata/writeMetadataToFile'
import { buildMetadataWritePlan, type PlanSerialization } from '@/lib/metadata/writePlan'
import { normalizeTabNumber } from '@/lib/serialization'
import type { PendingMetadata } from '@/stores/types'

/** One configuration as SolidWorks reports it, with the tab the document holds today. */
export interface PushConfiguration {
  name: string
  isActive?: boolean
  /** The `Tab Number` the document currently holds for this configuration. */
  tabNumber?: string
}

export interface PartAssemblyPushPlanInput {
  /** The file whose pending edits and committed row decide what the document should hold. */
  file: MetadataOverlaySource
  /** Every configuration the document has. Empty for a document with none worth writing to. */
  configurations: readonly PushConfiguration[]
  serialization: PlanSerialization | null
  /** The `Date` and `DrawnBy` properties BluePLM keeps in step with SolidWorks PDM. */
  parity: { date: string; drawnBy: string }
  /**
   * Leave the document's `Revision` alone, at file scope and in every configuration.
   *
   * For a vault where drawings drive revisions and the model never carries one. Without it a sync
   * stamps the row's revision into the model on the way past - which is correct for a shop that
   * revises models and is silent damage for a shop that does not, because the property appears in
   * a document nobody expected to have one and then goes stale the next time the drawing moves.
   *
   * Off by default, so nothing that already calls this changes. Drawings never reach this planner;
   * `pushDrawingMetadata` is a separate path and this option has no bearing on it.
   */
  omitRevision?: boolean
}

/** Whether BluePLM has anything to say about a field, as opposed to holding it empty. */
function held(field: ResolvedMetadataField): boolean {
  return field.source !== 'absent'
}

export function buildPartAssemblyPushPlan(
  input: PartAssemblyPushPlanInput,
): MetadataWriteGroup[] {
  const { file, configurations, serialization, parity, omitRevision = false } = input

  const resolved = resolveFileMetadata(file)
  const tabs = resolveConfigurationTabs(file)
  const descriptions = resolveConfigurationDescriptions(file)
  const separator = serialization?.settings.tab_separator || '-'

  const pending: PendingMetadata = {}
  if (held(resolved.partNumber)) pending.part_number = resolved.partNumber.value ?? ''
  if (held(resolved.description)) pending.description = resolved.description.value ?? ''
  // Left out of both halves below, which is what makes this an omission rather than a clear. The
  // planner writes `Revision` when the field is edited *or* when the committed value is non-empty,
  // so naming it in `committed` alone would still stamp it.
  if (!omitRevision && held(resolved.revision)) pending.revision = resolved.revision.value ?? ''

  const knowsSomething =
    Object.keys(pending).length > 0 ||
    Object.keys(tabs).length > 0 ||
    Object.keys(descriptions).length > 0
  if (!knowsSomething) return []

  // The planner reaches the configurations the pending set names, and this command's job is the
  // whole document, so every configuration is named. A tab BluePLM does not hold is named with the
  // document's own, which writes it back unchanged and keeps it in `Number`.
  const configurationTabs: Record<string, string> = {}
  const configurationDescriptions: Record<string, string> = {}
  for (const configuration of configurations) {
    configurationTabs[configuration.name] = normalizeTabNumber(
      tabs[configuration.name] ?? configuration.tabNumber ?? '',
      separator,
    )
    const description = descriptions[configuration.name]
    if (description !== undefined) configurationDescriptions[configuration.name] = description
  }

  // Committed and pending are the same values here, and deliberately so: the synthetic set above
  // already resolved the overlay, and the planner only consults `committed` for fields the pending
  // set leaves out - which, for a sync, are the fields BluePLM has nothing to say about.
  const committed = {
    partNumber: pending.part_number,
    description: pending.description,
    revision: pending.revision,
  }

  // One call, document bag and configurations together. This module used to ask the planner twice -
  // once with no configurations for the document's own group, once with them for the rest - and
  // strip the intents off the first, because the planner of the day gave a multi-configuration
  // document no file-scope group and confirmed its file-scope fields inside a configuration
  // instead. A group carrying properties and no intents is a write whose failure nothing records,
  // and this command produced one on every part it touched. The planner now emits the document
  // group itself, with the intents that make its failure visible.
  return buildMetadataWritePlan({
    pending: {
      ...pending,
      config_tabs: configurationTabs,
      config_descriptions: configurationDescriptions,
    },
    committed,
    configurations,
    serialization,
    parity,
  })
}
