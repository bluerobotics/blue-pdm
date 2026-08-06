/**
 * Divergence comparison and classification.
 *
 * Phase 0 of `.cursor/plans/metadata-source-of-truth.plan.md`: decide, for one file, how the
 * database row and the SolidWorks document disagree about the fields the ownership table calls
 * database-owned, and what can still be done about each disagreement.
 *
 * This module is deliberately pure. It performs no I/O, imports nothing that can reach Supabase,
 * the SolidWorks service or the file system, and holds no state. Everything it needs is passed in.
 * That is what makes the scanner's read-only property checkable by reading its imports, and it is
 * what makes the classification - which decides what counts as unrecoverable - unit-testable.
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

/**
 * How one database value relates to its counterpart in the file. These are the five classes in
 * section 5 of the plan, plus `both-empty` for the overwhelmingly common "neither side has
 * anything to say" case, which is not a finding and would otherwise be miscounted as agreement.
 */
export type DivergenceClass =
  | 'agrees'
  | 'both-empty'
  /** The database holds a value, the file does not. The commonest shape of the info-type bug. */
  | 'file-empty'
  /** The file holds a value, the database does not. The shape the `jsonb ||` wipe leaves behind. */
  | 'database-empty'
  /** Both hold a value and they are not the same. */
  | 'both-set-differ'

/**
 * What can still be done about a value the database no longer holds.
 *
 * The distinction that matters is `unrecoverable`. Until the `AddCustomProperty` info-type fix, a
 * value created through BluePLM could fail to reach the file while check-in was simultaneously
 * wiping it from the database, so neither copy survives. Those values cannot be repaired from
 * anything this scanner can see, and they are the reason this phase runs before anything writes.
 */
export type Recoverability =
  /** The database still holds the value. Nothing to recover. */
  | 'intact'
  /** Missing from the database, still present in the file. Repairable database-ward. */
  | 'recoverable'
  /** Missing from both, on a file that demonstrably had per-configuration metadata authored. */
  | 'unrecoverable'
  /** Missing from both, with nothing to suggest a value ever existed. Not a loss, an absence. */
  | 'no-evidence'
  /** Both sides hold a value and they differ. Needs a human, never auto-repaired. */
  | 'disagreeing'

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
 */
export interface FieldSpec<TField extends OwnedField = OwnedField> {
  field: TField
  scope: MetadataScope
  readKeys: readonly string[]
  acceptKeys: readonly string[]
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

const REVISION_KEYS = ['Revision', 'REVISION', 'revision', 'Rev', 'REV', 'rev', 'Rev.', 'REV.'] as const

const TAB_NUMBER_KEYS = ['Tab Number', 'TabNumber', 'Tab No', 'Tab', 'TAB', 'Suffix'] as const

/** The file-scope fields compared for every model. */
export const FILE_SCOPE_SPECS: readonly FieldSpec<FileScopeField>[] = [
  {
    field: 'part_number',
    scope: 'file',
    readKeys: PART_NUMBER_KEYS,
    acceptKeys: ['Number', 'Base Item Number'],
  },
  { field: 'description', scope: 'file', readKeys: DESCRIPTION_KEYS, acceptKeys: DESCRIPTION_KEYS },
  { field: 'revision', scope: 'file', readKeys: REVISION_KEYS, acceptKeys: REVISION_KEYS },
]

/** The configuration-scope fields, held in the database's reserved `custom_properties` maps. */
export const CONFIG_SCOPE_SPECS: readonly FieldSpec<ConfigScopeField>[] = [
  {
    field: 'config_tab',
    scope: 'configuration',
    readKeys: TAB_NUMBER_KEYS,
    acceptKeys: TAB_NUMBER_KEYS,
  },
  {
    field: 'config_description',
    scope: 'configuration',
    readKeys: DESCRIPTION_KEYS,
    acceptKeys: DESCRIPTION_KEYS,
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
function readAllProperties(
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

// ============================================
// Comparison
// ============================================

/** One field, at one scope, compared between the database row and the document. */
export interface FieldComparison {
  field: OwnedField
  scope: MetadataScope
  /** Configuration name for configuration-scope comparisons, absent at file scope. */
  configuration?: string
  databaseValue: string | null
  /** Value read from the document under the field's read priority. */
  fileValue: string | null
  divergence: DivergenceClass
  recoverability: Recoverability
}

/**
 * Classify one pair of values.
 *
 * `acceptedFileValues` is every value the file carries under a key that counts as agreement, so a
 * database part number that matches `Base Item Number` agrees even when the higher-priority
 * `Number` carries the base-plus-tab form. Comparison is exact after trimming: case and spacing
 * differences in a part number are real divergence, not noise.
 */
export function classifyPair(
  databaseValue: string | null,
  fileValue: string | null,
  acceptedFileValues: readonly string[] = fileValue === null ? [] : [fileValue],
): DivergenceClass {
  const database = normalizeValue(databaseValue)
  const file = normalizeValue(fileValue)

  if (database === null && file === null) return 'both-empty'
  if (database === null) return 'database-empty'
  if (file === null) return 'file-empty'
  return acceptedFileValues.includes(database) ? 'agrees' : 'both-set-differ'
}

/**
 * Turn a class into what can be done about it.
 *
 * `hasAuthoringEvidence` is the whole reason `unrecoverable` and `no-evidence` are separate
 * states. Neither side holding a value has two completely different explanations: the value was
 * lost from both, or it never existed. Nothing in the file or the row distinguishes them, so the
 * caller supplies the discriminator - for a configuration, whether the database's map holds
 * entries for *other* configurations of the same file, which is evidence that per-configuration
 * metadata was authored here and that this configuration's entry is missing rather than unused.
 * Reporting every empty configuration as a loss would drown the real ones.
 */
export function classifyRecoverability(
  divergence: DivergenceClass,
  hasAuthoringEvidence: boolean,
): Recoverability {
  switch (divergence) {
    case 'agrees':
      return 'intact'
    case 'file-empty':
      return 'intact'
    case 'database-empty':
      return 'recoverable'
    case 'both-set-differ':
      return 'disagreeing'
    case 'both-empty':
      return hasAuthoringEvidence ? 'unrecoverable' : 'no-evidence'
  }
}

/** What the database row says about the owned fields. */
export interface DatabaseMetadata {
  partNumber: string | null
  description: string | null
  revision: string | null
  /** `custom_properties._config_tabs`, or an empty object when the key is absent. */
  configTabs: Readonly<Record<string, string>>
  /** `custom_properties._config_descriptions`, or an empty object when the key is absent. */
  configDescriptions: Readonly<Record<string, string>>
  /** False when `custom_properties` carries no `_config_tabs` key at all. */
  hasConfigTabsKey: boolean
  /** False when `custom_properties` carries no `_config_descriptions` key at all. */
  hasConfigDescriptionsKey: boolean
}

/** What the document says, as returned by a read-only Document Manager open. */
export interface FileMetadata {
  configurations: readonly string[]
  fileProperties: Readonly<Record<string, string>>
  /** Configuration name to its own custom properties. */
  configurationProperties: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/**
 * How much of the file's configuration set the database's reserved maps still describe.
 *
 * This is the measurement that confirms or refutes the `jsonb ||` wipe: check-in replaces
 * `_config_tabs` wholesale rather than merging into it, so editing one configuration should leave
 * a map holding exactly the edited configurations and nothing else.
 */
export interface ConfigMapCoverage {
  fileConfigurationCount: number
  databaseTabKeyCount: number
  databaseDescriptionKeyCount: number
  /** Configurations the document has that `_config_tabs` does not mention. */
  missingTabConfigurations: string[]
  /** Configurations the document has that `_config_descriptions` does not mention. */
  missingDescriptionConfigurations: string[]
  /** Keys in the database maps with no matching configuration - a rename or a deleted config. */
  orphanedTabKeys: string[]
  orphanedDescriptionKeys: string[]
}

/** Everything phase 0 records about one file. */
export interface FileDivergence {
  fileId: string
  relativePath: string
  fileName: string
  fileType: string
  configurations: string[]
  fieldComparisons: FieldComparison[]
  coverage: ConfigMapCoverage
}

/** Identity of the row under comparison, carried through to the report. */
export interface FileIdentity {
  fileId: string
  relativePath: string
  fileName: string
  fileType: string
}

function coverageOf(database: DatabaseMetadata, file: FileMetadata): ConfigMapCoverage {
  const configurations = [...file.configurations]
  const tabKeys = Object.keys(database.configTabs)
  const descriptionKeys = Object.keys(database.configDescriptions)

  return {
    fileConfigurationCount: configurations.length,
    databaseTabKeyCount: tabKeys.length,
    databaseDescriptionKeyCount: descriptionKeys.length,
    missingTabConfigurations: configurations.filter((name) => !(name in database.configTabs)),
    missingDescriptionConfigurations: configurations.filter(
      (name) => !(name in database.configDescriptions),
    ),
    orphanedTabKeys: tabKeys.filter((key) => !configurations.includes(key)),
    orphanedDescriptionKeys: descriptionKeys.filter((key) => !configurations.includes(key)),
  }
}

/**
 * Compare one database row against one document across the owned field set, at file scope and at
 * every configuration scope.
 */
export function compareOwnedMetadata(
  identity: FileIdentity,
  database: DatabaseMetadata,
  file: FileMetadata,
): FileDivergence {
  const fieldComparisons: FieldComparison[] = []

  const databaseFileValues: Record<FileScopeField, string | null> = {
    part_number: database.partNumber,
    description: database.description,
    revision: database.revision,
  }

  for (const spec of FILE_SCOPE_SPECS) {
    const databaseValue = databaseFileValues[spec.field]
    const fileValue = readProperty(file.fileProperties, spec.readKeys)
    const accepted = readAllProperties(file.fileProperties, spec.acceptKeys)
    const divergence = classifyPair(databaseValue, fileValue, accepted)
    fieldComparisons.push({
      field: spec.field,
      scope: 'file',
      databaseValue: normalizeValue(databaseValue),
      fileValue,
      divergence,
      // A file-scope value has a column of its own, so an empty column plus an empty property is
      // simply a field nobody filled in. There is no wipe mechanism at this scope to suspect.
      recoverability: classifyRecoverability(divergence, false),
    })
  }

  // Evidence that per-configuration metadata was authored for this file at all. Used only to tell
  // a lost configuration entry apart from one that never existed.
  const tabsAuthored = Object.keys(database.configTabs).length > 0
  const descriptionsAuthored = Object.keys(database.configDescriptions).length > 0

  for (const configuration of file.configurations) {
    const properties = file.configurationProperties[configuration] ?? {}

    for (const spec of CONFIG_SCOPE_SPECS) {
      const databaseValue =
        spec.field === 'config_tab'
          ? (database.configTabs[configuration] ?? null)
          : (database.configDescriptions[configuration] ?? null)
      const fileValue = readProperty(properties, spec.readKeys)
      const accepted = readAllProperties(properties, spec.acceptKeys)
      const divergence = classifyPair(databaseValue, fileValue, accepted)
      const authored = spec.field === 'config_tab' ? tabsAuthored : descriptionsAuthored

      fieldComparisons.push({
        field: spec.field,
        scope: 'configuration',
        configuration,
        databaseValue: normalizeValue(databaseValue),
        fileValue,
        divergence,
        recoverability: classifyRecoverability(divergence, authored),
      })
    }
  }

  return {
    fileId: identity.fileId,
    relativePath: identity.relativePath,
    fileName: identity.fileName,
    fileType: identity.fileType,
    configurations: [...file.configurations],
    fieldComparisons,
    coverage: coverageOf(database, file),
  }
}

// ============================================
// Parsing the database side
// ============================================

/** A reserved map reads as a map only when it is an object of strings; anything else is ignored. */
function readReservedMap(
  customProperties: Readonly<Record<string, unknown>> | null,
  key: string,
): { present: boolean; map: Record<string, string> } {
  const raw = customProperties?.[key]
  if (raw === undefined || raw === null) return { present: false, map: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { present: false, map: {} }

  const map: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') map[name] = value
    else if (typeof value === 'number') map[name] = String(value)
  }
  return { present: true, map }
}

/** The subset of a `files` row the comparison needs. Deliberately not the whole row. */
export interface FileRowMetadata {
  part_number: string | null
  description: string | null
  revision: string | null
  custom_properties: Record<string, unknown> | null
}

/** Lift the owned fields out of a `files` row, including the two reserved configuration maps. */
export function readDatabaseMetadata(row: FileRowMetadata): DatabaseMetadata {
  const tabs = readReservedMap(row.custom_properties, CONFIG_TABS_KEY)
  const descriptions = readReservedMap(row.custom_properties, CONFIG_DESCRIPTIONS_KEY)

  return {
    partNumber: normalizeValue(row.part_number),
    description: normalizeValue(row.description),
    revision: normalizeValue(row.revision),
    configTabs: tabs.map,
    configDescriptions: descriptions.map,
    hasConfigTabsKey: tabs.present,
    hasConfigDescriptionsKey: descriptions.present,
  }
}

// ============================================
// Aggregation
// ============================================

/** Counts for one field across the scan. */
export interface FieldTally {
  field: OwnedField
  scope: MetadataScope
  compared: number
  agrees: number
  bothEmpty: number
  fileEmpty: number
  databaseEmpty: number
  bothSetDiffer: number
}

/** A single value that neither side holds, named so a repair phase can act on it. */
export interface UnrecoverableValue {
  fileId: string
  relativePath: string
  field: OwnedField
  configuration?: string
}

/** A single value the two sides disagree about, with both sides recorded. */
export interface DisagreeingValue {
  fileId: string
  relativePath: string
  field: OwnedField
  configuration?: string
  databaseValue: string | null
  fileValue: string | null
}

/** A file whose database configuration map describes fewer configurations than the file has. */
export interface TruncatedConfigMap {
  fileId: string
  relativePath: string
  fileConfigurationCount: number
  databaseTabKeyCount: number
  missingTabCount: number
  missingTabConfigurations: string[]
  databaseDescriptionKeyCount: number
  missingDescriptionCount: number
}

/** Everything the report says about the scan as a whole. */
export interface DivergenceSummary {
  filesCompared: number
  filesWithAnyDivergence: number
  filesWithMultipleConfigurations: number

  /** Extent of the `jsonb ||` wipe. */
  filesWithTruncatedConfigMap: number
  truncatedConfigMaps: TruncatedConfigMap[]
  totalMissingConfigurationEntries: number

  /** Recoverability, summed over every value compared. */
  recoverableValues: number
  unrecoverableValues: number
  disagreeingValues: number
  noEvidenceValues: number

  unrecoverable: UnrecoverableValue[]
  disagreeing: DisagreeingValue[]

  fieldTallies: FieldTally[]
}

function emptyTally(field: OwnedField, scope: MetadataScope): FieldTally {
  return {
    field,
    scope,
    compared: 0,
    agrees: 0,
    bothEmpty: 0,
    fileEmpty: 0,
    databaseEmpty: 0,
    bothSetDiffer: 0,
  }
}

function countInto(tally: FieldTally, divergence: DivergenceClass): void {
  tally.compared += 1
  switch (divergence) {
    case 'agrees':
      tally.agrees += 1
      break
    case 'both-empty':
      tally.bothEmpty += 1
      break
    case 'file-empty':
      tally.fileEmpty += 1
      break
    case 'database-empty':
      tally.databaseEmpty += 1
      break
    case 'both-set-differ':
      tally.bothSetDiffer += 1
      break
  }
}

/** Whether a comparison is a finding rather than two sides quietly agreeing. */
function isFinding(comparison: FieldComparison): boolean {
  return comparison.divergence !== 'agrees' && comparison.divergence !== 'both-empty'
}

/** Roll a set of per-file results up into the numbers the report leads with. */
export function summarizeDivergence(files: readonly FileDivergence[]): DivergenceSummary {
  const tallies = new Map<string, FieldTally>()
  const unrecoverable: UnrecoverableValue[] = []
  const disagreeing: DisagreeingValue[] = []
  const truncatedConfigMaps: TruncatedConfigMap[] = []

  let filesWithAnyDivergence = 0
  let filesWithMultipleConfigurations = 0
  let totalMissingConfigurationEntries = 0
  let recoverableValues = 0
  let noEvidenceValues = 0

  for (const file of files) {
    if (file.configurations.length > 1) filesWithMultipleConfigurations += 1

    let fileHasFinding = false

    for (const comparison of file.fieldComparisons) {
      const key = `${comparison.scope}:${comparison.field}`
      let tally = tallies.get(key)
      if (!tally) {
        tally = emptyTally(comparison.field, comparison.scope)
        tallies.set(key, tally)
      }
      countInto(tally, comparison.divergence)

      if (isFinding(comparison)) fileHasFinding = true

      switch (comparison.recoverability) {
        case 'recoverable':
          recoverableValues += 1
          break
        case 'unrecoverable':
          unrecoverable.push({
            fileId: file.fileId,
            relativePath: file.relativePath,
            field: comparison.field,
            configuration: comparison.configuration,
          })
          break
        case 'disagreeing':
          disagreeing.push({
            fileId: file.fileId,
            relativePath: file.relativePath,
            field: comparison.field,
            configuration: comparison.configuration,
            databaseValue: comparison.databaseValue,
            fileValue: comparison.fileValue,
          })
          break
        case 'no-evidence':
          noEvidenceValues += 1
          break
        case 'intact':
          break
      }
    }

    if (fileHasFinding) filesWithAnyDivergence += 1

    const missingTabs = file.coverage.missingTabConfigurations.length
    const missingDescriptions = file.coverage.missingDescriptionConfigurations.length
    totalMissingConfigurationEntries += missingTabs + missingDescriptions

    // Only a file whose map already holds entries can have been truncated. A file with no map at
    // all never had per-configuration metadata, and counting it here would inflate the wipe.
    const tabMapTruncated = file.coverage.databaseTabKeyCount > 0 && missingTabs > 0
    const descriptionMapTruncated =
      file.coverage.databaseDescriptionKeyCount > 0 && missingDescriptions > 0

    if (tabMapTruncated || descriptionMapTruncated) {
      truncatedConfigMaps.push({
        fileId: file.fileId,
        relativePath: file.relativePath,
        fileConfigurationCount: file.coverage.fileConfigurationCount,
        databaseTabKeyCount: file.coverage.databaseTabKeyCount,
        missingTabCount: missingTabs,
        missingTabConfigurations: file.coverage.missingTabConfigurations,
        databaseDescriptionKeyCount: file.coverage.databaseDescriptionKeyCount,
        missingDescriptionCount: missingDescriptions,
      })
    }
  }

  const scopeOrder: Record<MetadataScope, number> = { file: 0, configuration: 1 }
  const fieldTallies = [...tallies.values()].sort(
    (a, b) => scopeOrder[a.scope] - scopeOrder[b.scope] || a.field.localeCompare(b.field),
  )

  return {
    filesCompared: files.length,
    filesWithAnyDivergence,
    filesWithMultipleConfigurations,
    filesWithTruncatedConfigMap: truncatedConfigMaps.length,
    truncatedConfigMaps,
    totalMissingConfigurationEntries,
    recoverableValues,
    unrecoverableValues: unrecoverable.length,
    disagreeingValues: disagreeing.length,
    noEvidenceValues,
    unrecoverable,
    disagreeing,
    fieldTallies,
  }
}
