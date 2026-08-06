/**
 * What the two inline configuration editors write into a SolidWorks document.
 *
 * Both editors used to build their own properties. Both gated `Number` and `Base Item Number` on
 * the base number being truthy, so a user who cleared the item number and then touched a
 * configuration left the number they deleted sitting in the file while the database moved on; the
 * description editor nested `Tab Number` inside the same condition, which made a configuration's
 * tab depend on whether the file had an item number at all. Neither of those is repaired here.
 * The mapping from a logical field to the properties that carry it belongs to
 * `buildMetadataWritePlan`, which the datacard, check-in and Sync Metadata already share, and a
 * repaired conditional drifts back where a shared planner does not.
 *
 * What is left is the part the planner cannot know: which fields an inline editor is entitled to
 * touch. An editor that changes one configuration's tab has no business writing that
 * configuration's description or the file's revision, so those are simply not named in the pending
 * set handed over. The item number is named, because the tab is half of `Number` and the two
 * cannot be written apart.
 *
 * "Named" means the overlay holds an opinion - `source` is not `absent` - not that the value is
 * non-empty. A number the user cleared is named with an empty string and is written empty; a number
 * neither side ever held is left out, and the document keeps whatever it has.
 *
 * Pure: no I/O, no store access, no React.
 */

import {
  resolveConfigurationTab,
  resolvePartNumber,
  type MetadataOverlaySource,
} from '@/lib/metadata/overlay'
import type { MetadataWriteGroup } from '@/lib/metadata/writeMetadataToFile'
import { buildMetadataWritePlan, type PlanSerialization } from '@/lib/metadata/writePlan'
import type { PendingMetadata } from '@/stores/types'

export interface ConfigurationWriteInput {
  /** The file whose pending edits and committed row decide the fields this edit does not set. */
  file: MetadataOverlaySource
  configuration: string
  serialization: PlanSerialization | null
  /** The `Date` and `DrawnBy` properties BluePLM keeps in step with SolidWorks PDM. */
  parity: { date: string; drawnBy: string }
}

/**
 * The item number as this write should establish it, or nothing when BluePLM never held one.
 *
 * Returned as a pair rather than a string so an item number cleared to empty stays distinguishable
 * from one that was never set - the distinction `if (baseNumber)` used to lose.
 */
function partNumberEdit(file: MetadataOverlaySource): Pick<PendingMetadata, 'part_number'> {
  const resolved = resolvePartNumber(file)
  return resolved.source === 'absent' ? {} : { part_number: resolved.value ?? '' }
}

export function buildConfigurationTabWritePlan(
  input: ConfigurationWriteInput & { tabNumber: string },
): MetadataWriteGroup[] {
  const { file, configuration, tabNumber, serialization, parity } = input
  const number = partNumberEdit(file)

  return buildMetadataWritePlan({
    pending: { ...number, config_tabs: { [configuration]: tabNumber } },
    committed: { partNumber: number.part_number },
    configurations: [{ name: configuration, isActive: true }],
    serialization,
    parity,
  })
}

export function buildConfigurationDescriptionWritePlan(
  input: ConfigurationWriteInput & { description: string; documentTabNumber?: string },
): MetadataWriteGroup[] {
  const { file, configuration, description, documentTabNumber, serialization, parity } = input
  const number = partNumberEdit(file)

  // The tab is not being edited, so it is supplied as what the configuration already holds: the
  // user's own pending tab first, then the committed one, then whatever the loaded configuration
  // read out of the document. Without it, rewriting `Number` here would quietly drop the tab.
  const tabNumber = resolveConfigurationTab(file, configuration).value ?? documentTabNumber ?? ''

  return buildMetadataWritePlan({
    pending: { ...number, config_descriptions: { [configuration]: description } },
    committed: { partNumber: number.part_number },
    configurations: [{ name: configuration, isActive: true, tabNumber }],
    serialization,
    parity,
  })
}
