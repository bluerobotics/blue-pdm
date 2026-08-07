/**
 * Reading a metadata value out of a SolidWorks property bag.
 *
 * One question, answered in one place: given the properties a document carries, what value does a
 * logical field have - and which of the many keys a document may carry it under is the one BluePLM
 * would write it to.
 *
 * Split out of `divergence.ts`, which now imports and re-exports everything here so no call site
 * had to change. The two do different jobs. This module knows what SolidWorks property keys mean;
 * `divergence.ts` compares two sides and decides what may be done about the difference. Keeping the
 * key lists here means the next person adding a spelling of "Revision" reads only the rules for
 * reading properties, and not the recoverability classification alongside them.
 *
 * Pure: no I/O, no state, and nothing in its import graph can reach Supabase, the SolidWorks
 * service or the file system. That is what lets the scanner's read-only property be checked by
 * reading imports rather than trusted.
 */

// ============================================
// Vocabulary
// ============================================

/** Where a metadata value lives inside a SolidWorks document. */
export type MetadataScope = 'file' | 'configuration'

/** Owned fields that live in a column on `files`. */
export type FileScopeField = 'part_number' | 'description' | 'revision'

/** Owned fields that live in a reserved map under `files.custom_properties`. */
export type ConfigScopeField = 'config_tab' | 'config_description'

/**
 * The logical fields the plan's ownership table assigns to the database. Everything else in a
 * document (`Material`, `Weight`, `Volume`, `DrawnBy`, ...) is file-owned and is not compared:
 * SolidWorks recomputes those, so including them would report every rebuild as divergence.
 */
export type OwnedField = FileScopeField | ConfigScopeField

// ============================================
// Property keys
// ============================================

/**
 * How a file value is located for one logical field.
 *
 * `readKeys` is the ordered read priority. `acceptKeys` exists because `Number` and
 * `Base Item Number` carry different things - `Number` is the base plus the configuration's tab,
 * `Base Item Number` is the base alone - so a database part number legitimately equals either,
 * and treating a match on the second as divergence would report the whole vault as diverged.
 *
 * `repairKeys` is narrower than both and is the only list a repair phase may take a value from:
 * the keys BluePLM's own writers produce, matched case-insensitively because SolidWorks keeps
 * whatever case a property was created with. `Number` is deliberately absent from the part
 * number's list - it carries base-plus-tab, and `files.part_number` holds the base, so writing
 * what `readKeys` returned would put the composite in a column that holds the base.
 */
export interface FieldSpec<TField extends OwnedField = OwnedField> {
  field: TField
  scope: MetadataScope
  readKeys: readonly string[]
  acceptKeys: readonly string[]
  repairKeys: readonly string[]
}

/** Read priority for the part number, matching `extractMetadataFromProperties` in syncMetadata. */
const PART_NUMBER_KEYS = [
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
] as const

const DESCRIPTION_KEYS = [
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
] as const

const REVISION_KEYS = [
  'Revision',
  'REVISION',
  'revision',
  'Rev',
  'REV',
  'rev',
  'Rev.',
  'REV.',
] as const

const TAB_NUMBER_KEYS = ['Tab Number', 'TabNumber', 'Tab No', 'Tab', 'TAB', 'Suffix'] as const

/**
 * The keys BluePLM's writers actually produce, per field.
 *
 * Taken from `pushPartAssemblyMetadata` and `useConfigHandlers`, which write `Base Item Number`
 * for the base part number, `Tab Number` for a configuration's tab, and `Description` and
 * `Revision` for the other two. Nothing in BluePLM writes `Title`, `Desc`, `Suffix` or `Tab`, so
 * a value found under one of those came from somewhere else and is not BluePLM's to restore.
 */
const BASE_PART_NUMBER_WRITE_KEYS = ['Base Item Number'] as const
const DESCRIPTION_WRITE_KEYS = ['Description'] as const
const REVISION_WRITE_KEYS = ['Revision'] as const
const TAB_NUMBER_WRITE_KEYS = ['Tab Number'] as const

/** The file-scope fields compared for every model. */
export const FILE_SCOPE_SPECS: readonly FieldSpec<FileScopeField>[] = [
  {
    field: 'part_number',
    scope: 'file',
    readKeys: PART_NUMBER_KEYS,
    acceptKeys: ['Number', 'Base Item Number'],
    repairKeys: BASE_PART_NUMBER_WRITE_KEYS,
  },
  {
    field: 'description',
    scope: 'file',
    readKeys: DESCRIPTION_KEYS,
    acceptKeys: DESCRIPTION_KEYS,
    repairKeys: DESCRIPTION_WRITE_KEYS,
  },
  {
    field: 'revision',
    scope: 'file',
    readKeys: REVISION_KEYS,
    acceptKeys: REVISION_KEYS,
    repairKeys: REVISION_WRITE_KEYS,
  },
]

/** The configuration-scope fields, held in the database's reserved `custom_properties` maps. */
export const CONFIG_SCOPE_SPECS: readonly FieldSpec<ConfigScopeField>[] = [
  {
    field: 'config_tab',
    scope: 'configuration',
    readKeys: TAB_NUMBER_KEYS,
    acceptKeys: TAB_NUMBER_KEYS,
    repairKeys: TAB_NUMBER_WRITE_KEYS,
  },
  {
    field: 'config_description',
    scope: 'configuration',
    readKeys: DESCRIPTION_KEYS,
    acceptKeys: DESCRIPTION_KEYS,
    repairKeys: DESCRIPTION_WRITE_KEYS,
  },
]

/** Reserved key under `files.custom_properties` holding the per-configuration tab map. */
export const CONFIG_TABS_KEY = '_config_tabs'

/** Reserved key under `files.custom_properties` holding the per-configuration description map. */
export const CONFIG_DESCRIPTIONS_KEY = '_config_descriptions'

// ============================================
// The $PRP guard
// ============================================

/**
 * Whether a raw property value is a SolidWorks property reference rather than a value.
 *
 * The broadest of the three conventions in the codebase, as the plan recommends: a leading `$`,
 * or `PRP:` / `SW-PRP:` anywhere, case-insensitively. It has to be broad because the ORING fixture
 * carries `"SW-Mass@ORING-BUNA-70A.SLDPRT"`-shaped values in `Volume` and `Weight`, and a reader
 * without the guard compares a formula against a part number and reports divergence.
 */
export function isPropertyReference(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.startsWith('$')) return true
  const lowered = trimmed.toLowerCase()
  return lowered.includes('prp:') || lowered.includes('sw-prp:')
}

/** Trim to a value, or null when there is nothing meaningful there. */
export function normalizeValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * First readable value across an ordered key list. A property reference is skipped rather than
 * returned, so `Description = "$PRP:\"Number\""` reads as absent, which is what it means.
 */
export function readProperty(
  properties: Readonly<Record<string, string>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const raw = properties[key]
    if (raw === undefined) continue
    if (isPropertyReference(raw)) continue
    const normalized = normalizeValue(raw)
    if (normalized !== null) return normalized
  }
  return null
}

/** Every readable value across a key set, for the "does it agree with any of them" test. */
export function readAllProperties(
  properties: Readonly<Record<string, string>>,
  keys: readonly string[],
): string[] {
  const values: string[] = []
  for (const key of keys) {
    const raw = properties[key]
    if (raw === undefined || isPropertyReference(raw)) continue
    const normalized = normalizeValue(raw)
    if (normalized !== null) values.push(normalized)
  }
  return values
}

/**
 * The value under a key BluePLM writes, matched without regard to case.
 *
 * Case-insensitive because SolidWorks stores a property under whatever case it was created with:
 * a `DESCRIPTION` that predates BluePLM is the same property `setProperties('Description', ...)`
 * updates, so refusing to see it would report a value BluePLM itself wrote as untranscribable.
 * The match is still on the whole key, so `Part Description` and `Desc` remain excluded.
 */
export function readCanonicalProperty(
  properties: Readonly<Record<string, string>>,
  canonicalKeys: readonly string[],
): string | null {
  const wanted = canonicalKeys.map((key) => key.toLowerCase())
  for (const [key, raw] of Object.entries(properties)) {
    if (!wanted.includes(key.toLowerCase())) continue
    if (isPropertyReference(raw)) continue
    const normalized = normalizeValue(raw)
    if (normalized !== null) return normalized
  }
  return null
}

// ============================================
// Derivation
// ============================================

/**
 * The single document property a tab may be *derived* from.
 *
 * `Number` carries the base part number plus the configuration's tab; `Base Item Number` carries
 * the base alone, so splitting that one yields a fragment of the base rather than a tab. The
 * browser's display-time derivation in `loadFileConfigurations.ts` also accepts `Part Number` and
 * `PartNumber`; this does not, because a value under either of those has no documented
 * relationship to the tab and guessing is the failure mode the whole exercise exists to avoid.
 */
const TAB_DERIVATION_KEYS = ['Number'] as const

/**
 * The longest trailing segment of `Number` that reads as a tab rather than as the number itself,
 * matching `tabFromNumber` in `loadFileConfigurations.ts`.
 */
const MAX_DERIVED_TAB_LENGTH = 4

/**
 * The tab a configuration's own `Number` implies, or null.
 *
 * Emphatically *not* a `repairKeys` entry. A value it returns was never distinctly held by the
 * database, which is the whole difference between recovering something and reconstructing it.
 * Callers are expected to keep the two apart, and the repair preview marks every value that came
 * from here.
 *
 * Reads the configuration's own bag only, never the resolved view: resolving would fall back to
 * the file-level `Number` and hand every configuration the family's tab, which is the `-XXX` value
 * the census found on the ORING family and is not that configuration's tab at all.
 */
export function deriveTabFromNumber(
  configurationProperties: Readonly<Record<string, string>>,
): string | null {
  const number = readCanonicalProperty(configurationProperties, TAB_DERIVATION_KEYS)
  if (number === null) return null

  const parts = number.split('-')
  if (parts.length < 2) return null

  const last = parts[parts.length - 1]
  if (!last || last.length > MAX_DERIVED_TAB_LENGTH) return null
  return last
}
