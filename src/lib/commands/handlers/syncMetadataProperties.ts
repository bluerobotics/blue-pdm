/**
 * Reading BluePLM's four fields out of a SolidWorks property bag.
 *
 * Split out of `syncMetadata.ts`: this is the only part of the command with no I/O in it, and the
 * key lists below are the kind of thing that gets read far more often than the code around them.
 *
 * Pure: no I/O, no store access, no React.
 */

import { normalizeTabNumber } from '@/lib/serialization'

import type { ExtractedMetadata } from './syncMetadataCommon'

/**
 * Extract part number, description, revision from properties dictionary
 */
export function extractMetadataFromProperties(allProps: Record<string, string>): {
  partNumber: string | null
  tabNumber: string | null
  description: string | null
  revision: string | null
} {
  // Extract part number - "Number" is primary (used by BluePLM's "Save to File")
  const partNumberKeys = [
    'Number',
    'No',
    'No.',
    'Base Item Number',
    'PartNumber',
    'Part Number',
    'PARTNUMBER',
    'Part No',
    'Part No.',
    'PartNo',
    'ItemNumber',
    'Item Number',
    'ITEMNUMBER',
    'Item No',
    'Item No.',
    'ItemNo',
    'PN',
    'P/N',
  ]

  let partNumber: string | null = null
  for (const key of partNumberKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      partNumber = allProps[key].trim()
      break
    }
  }

  // Extract tab number
  // Note: Some SW templates store tab with leading dash (e.g., "-500")
  // Normalize to strip leading separators to prevent double-dash in combined numbers
  const tabNumberKeys = ['Tab Number', 'TabNumber', 'Tab No', 'Tab', 'TAB', 'Suffix']
  let tabNumber: string | null = null
  for (const key of tabNumberKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      // Normalize to strip leading dash (default separator)
      tabNumber = normalizeTabNumber(allProps[key].trim())
      break
    }
  }

  // Extract description
  const descriptionKeys = [
    'Description',
    'DESCRIPTION',
    'description',
    'Desc',
    'DESC',
    'desc',
    'Title',
    'TITLE',
    'Part Description',
    'PartDescription',
  ]

  let description: string | null = null
  for (const key of descriptionKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      description = allProps[key].trim()
      break
    }
  }

  // Extract revision
  const revisionKeys = ['Revision', 'REVISION', 'revision', 'Rev', 'REV', 'rev', 'Rev.', 'REV.']

  let revision: string | null = null
  for (const key of revisionKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      revision = allProps[key].trim()
      break
    }
  }

  return { partNumber, tabNumber, description, revision }
}

/**
 * The `Tab Number` a configuration's property bag holds, normalized.
 *
 * Read separately from `extractMetadataFromProperties` because the push half wants one
 * configuration's tab rather than the whole four-field reading, and because a template that stores
 * the tab as `-500` would otherwise reach the planner with its separator still attached and come
 * back out as `BR-107151--500`.
 */
export function readConfigurationTab(
  properties: Record<string, string> | undefined,
  separator: string,
): string {
  for (const key of ['Tab Number', 'TabNumber', 'Tab No', 'Tab', 'TAB', 'Suffix']) {
    const raw = properties?.[key]
    if (raw && raw.trim() && !raw.startsWith('$')) return normalizeTabNumber(raw.trim(), separator)
  }
  return ''
}

/**
 * Whether the resolved parent is certain enough to rewrite the drawing's own properties.
 *
 * A parent named by the drawing's references, by an exact filename match, or by the
 * reference database is that drawing's parent by definition. `sole-model-in-folder` only
 * infers it from folder layout, so it may populate BluePLM's fields - which a user can see
 * and correct before check-in - but must never be written into the file, where a wrong
 * guess would silently corrupt the title block.
 */
export function isParentAuthoritative(metadata: ExtractedMetadata): boolean {
  return metadata.parentInferenceStrategy !== 'sole-model-in-folder'
}

/**
 * Pick the parent model configuration a drawing's metadata should be inherited from.
 *
 * Only the configuration the drawing's views actually reference is acceptable. There used to be a
 * "default", then "standard", then first-configuration fallback here; on the o-ring fixture none of
 * the 68 configurations is called either, so all 11 of its drawings landed on the first one — `XXX`,
 * a template whose part number is literally `BR-100635-XXX`. Every drawing inherited placeholder
 * values and looked like a successful sync.
 *
 * `ISwDMView.ReferencedConfiguration` now supplies the real answer headlessly, so a guess is no
 * longer a lesser evil. When it is missing or names a configuration the parent does not have, this
 * returns undefined and the caller inherits file-level properties only.
 */
export function selectParentConfiguration(
  parentConfigProps: Record<string, Record<string, string>>,
  referencedConfiguration: string | undefined,
): string | undefined {
  if (!referencedConfiguration) return undefined

  const configNames = Object.keys(parentConfigProps)
  if (configNames.includes(referencedConfiguration)) return referencedConfiguration

  return configNames.find((k) => k.toLowerCase() === referencedConfiguration.toLowerCase())
}

/**
 * Recover the base item number from a resolved number that may already carry a tab.
 *
 * The parent's configuration-level `Number` is the combined base+tab value, but
 * `Base Item Number` must stay unsuffixed. The tab separator is org-configurable,
 * so strip whatever separator characters sit between the two rather than assuming '-'.
 */
export function deriveBaseNumber(
  partNumber: string,
  tabNumber: string | null | undefined,
): string {
  if (!tabNumber || !partNumber.endsWith(tabNumber)) return partNumber
  const base = partNumber.slice(0, partNumber.length - tabNumber.length).replace(/[-_.\s]+$/, '')
  return base || partNumber
}
