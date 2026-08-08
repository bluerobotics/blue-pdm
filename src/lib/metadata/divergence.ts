/**
 * Divergence comparison and classification.
 *
 * Measure-only, and it changes nothing: decide, for one file, how the database row and the
 * SolidWorks document disagree about the fields the ownership table calls database-owned, and what
 * can still be done about each disagreement.
 *
 * This module is deliberately pure. It performs no I/O, imports nothing that can reach Supabase,
 * the SolidWorks service or the file system, and holds no state. Everything it needs is passed in.
 * That is what makes the scanner's read-only property checkable by reading its imports, and it is
 * what makes the classification - which decides what counts as unrecoverable - unit-testable.
 *
 * ## What the classification promises to a repair phase
 *
 * The report is the repair phase's input, so a value in the wrong bucket here becomes a wrong
 * write later. Two rules keep that from happening.
 *
 * **A value is only `recoverable` when the database demonstrably once held that field, and the
 * document carries the value under the very key BluePLM writes.** Absent either, the value is
 * `unattributed` and carries the reason why. `Description`, `Title`, `Suffix` and `Tab` are
 * properties SolidWorks documents routinely carry for reasons that have nothing to do with
 * BluePLM; treating one as a lost BluePLM value and writing it into a reserved map would
 * manufacture data rather than restore it.
 *
 * **Agreement is judged leniently and repair strictly.** A database value matching the document
 * under any equivalent key is agreement, because reporting it as divergence would drown the real
 * findings. But the value a repair phase may write back comes only from the canonical key, so a
 * lenient match never becomes a licence to write.
 *
 * ## What it still cannot tell apart
 *
 * Two things a repair phase must not read more into than is there.
 *
 * A configuration's `Description` cannot be told apart from the file-level one it may merely be
 * repeating. Per the plan's measurement the ORING fixture has both set to the same string
 * deliberately, so equality is not evidence of inheritance and nothing here guesses at it.
 *
 * `both-set-differ` is always `disagreeing`, including for revision, which the ownership table
 * gives to the file. The direction that conflict resolves in is a repair-phase decision made from
 * `fileType`; this module only refuses to make it automatically.
 */

import {
  CONFIG_DESCRIPTIONS_KEY,
  CONFIG_SCOPE_SPECS,
  CONFIG_TABS_KEY,
  deriveTabFromNumber,
  FILE_SCOPE_SPECS,
  normalizeValue,
  readAllProperties,
  readCanonicalProperty,
  readProperty,
  type ConfigScopeField,
  type FieldSpec,
  type FileScopeField,
  type MetadataScope,
  type OwnedField,
} from './documentProperties'

/**
 * The rules for reading a value out of a property bag live in `documentProperties`, and are
 * re-exported here because this module was where they used to be and is where callers look for
 * them. Splitting them out was a size decision, not a boundary change.
 */
export {
  CONFIG_DESCRIPTIONS_KEY,
  CONFIG_SCOPE_SPECS,
  CONFIG_TABS_KEY,
  deriveTabFromNumber,
  FILE_SCOPE_SPECS,
  isPropertyReference,
  normalizeValue,
  readCanonicalProperty,
  readProperty,
} from './documentProperties'
export type {
  ConfigScopeField,
  FieldSpec,
  FileScopeField,
  MetadataScope,
  OwnedField,
} from './documentProperties'

// ============================================
// Vocabulary
// ============================================

/** The kinds of file the scan compares. Drawings reverse part of the ownership table. */
export type ComparedFileType = 'part' | 'assembly' | 'drawing' | 'other'

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
 *
 * The distinction that keeps a repair phase honest is `unattributed`. The file holding a value
 * the database does not is only a *recovery* when the database is the field's owner and once held
 * it. Otherwise the document's value is something BluePLM never owned, and adopting it would
 * invent database state rather than restore it.
 */
export type Recoverability =
  /** Both sides hold the same value. Nothing to do. */
  | 'intact'
  /**
   * The database holds the value and the file does not.
   *
   * Nothing has been lost - which is why this used to be reported as `intact` - but the two sides
   * do not say the same thing, and a reader looking at the document sees an absence where the
   * record has a value. Naming it apart is what lets the audit state a direction for it: the only
   * write that resolves one of these goes database to file, and `intact` could not say that
   * without also saying it about the agreements it was lumped in with.
   */
  | 'absent-from-file'
  /** Missing from the database, still present in the file, and safe to write back. */
  | 'recoverable'
  /** Missing from both, on a file that demonstrably had per-configuration metadata authored. */
  | 'unrecoverable'
  /** Missing from both, with nothing to suggest a value ever existed. Not a loss, an absence. */
  | 'no-evidence'
  /**
   * Present in the file, absent from the database, and *not* evidently the database's to hold.
   * Needs a human. Never auto-repaired.
   */
  | 'unattributed'
  /** Both sides hold a value and they differ. Needs a human, never auto-repaired. */
  | 'disagreeing'

/**
 * Why a value the file holds is not treated as a recovery. The three cases need different
 * handling, so the report names which one applies rather than merging them into one bucket.
 */
export type UnattributedReason =
  /**
   * The database's storage for this field never existed on this row - at configuration scope,
   * `custom_properties` carries no reserved map at all - so the document's value was never a
   * BluePLM value that went missing.
   */
  | 'database-never-held-it'
  /** The ownership table gives this field to something other than this row. */
  | 'not-database-owned'
  /**
   * The document holds a value, but not under a key BluePLM writes, so there is nothing that can
   * be transcribed into the database without guessing what it means.
   */
  | 'no-transcribable-value'

// ============================================
// Ownership
// ============================================

/**
 * Who the plan's ownership table makes authoritative for one field on one kind of file.
 *
 * Only `database-empty` turns on this: the question it decides is whether the database adopting
 * the document's value is a repair or an invention.
 */
export type FieldOwner =
  /** This `files` row. Every owned field on a part or an assembly. */
  | 'database'
  /** The document. Revision is driven by the file's own property/revision table. */
  | 'file'
  /**
   * Neither this row nor this document: a drawing's part number and description are a projection
   * of its parent model's row, so the drawing's own copy is never promoted as authoritative.
   */
  | 'parent-model'

/** Apply the ownership table to one field on one kind of file. */
export function ownerOf(field: OwnedField, fileType: ComparedFileType): FieldOwner {
  if (field === 'revision') return 'file'
  if (fileType !== 'drawing') return 'database'
  return 'parent-model'
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
  /**
   * The value a repair phase may write into the database for this field, read only from the keys
   * BluePLM itself writes. Null when the document holds nothing transcribable - which is not the
   * same as holding nothing, and is why this is a separate field from `fileValue`.
   */
  databaseRepairValue: string | null
  divergence: DivergenceClass
  recoverability: Recoverability
  /** Set only when `recoverability` is `unattributed`. */
  unattributedReason?: UnattributedReason
}

/**
 * Classify one pair of values.
 *
 * An exact match after trimming is always agreement, whatever key the value was found under -
 * otherwise a row and a document holding the identical string under a key outside `acceptKeys`
 * would be reported as a conflict between two copies of the same text. `acceptedFileValues`
 * widens agreement beyond that: a database part number that matches `Base Item Number` agrees
 * even when the higher-priority `Number` carries the base-plus-tab form. Case and spacing
 * differences are real divergence, not noise.
 */
export function classifyPair(
  databaseValue: string | null,
  fileValue: string | null,
  acceptedFileValues: readonly string[] = [],
): DivergenceClass {
  const database = normalizeValue(databaseValue)
  const file = normalizeValue(fileValue)

  if (database === null && file === null) return 'both-empty'
  if (database === null) return 'database-empty'
  if (file === null) return 'file-empty'
  if (database === file) return 'agrees'
  return acceptedFileValues.includes(database) ? 'agrees' : 'both-set-differ'
}

/**
 * What is known about a field beyond the two values themselves.
 *
 * The caller supplies this because nothing in a pair of values distinguishes "lost from both"
 * from "never existed", or "the database lost this" from "the database never had this".
 */
export interface RecoveryContext {
  /** Who the ownership table makes authoritative for this field on this kind of file. */
  owner: FieldOwner
  /**
   * Whether the database's storage for this field exists on this row at all. At configuration
   * scope that is whether `custom_properties` carries the reserved map key - which is what tells
   * a map that was emptied apart from one that was never written, and those mean opposite things.
   * At file scope it is always false: a column cannot be absent, and no known mechanism empties
   * one, so an empty column is not evidence that anything was lost from it.
   */
  databaseEverHeldField: boolean
  /** What a repair phase could write into the database, or null when there is no such value. */
  repairValue: string | null
}

/** A recoverability, with the reason where the reason changes what may be done. */
export interface RecoverabilityVerdict {
  recoverability: Recoverability
  unattributedReason?: UnattributedReason
}

function classifyDatabaseEmpty(context: RecoveryContext): RecoverabilityVerdict {
  // The drawing's own part number is a copy of its parent model's, so promoting it would make
  // the copy authoritative over the thing it copies.
  if (context.owner === 'parent-model') {
    return { recoverability: 'unattributed', unattributedReason: 'not-database-owned' }
  }

  if (context.repairValue === null) {
    return { recoverability: 'unattributed', unattributedReason: 'no-transcribable-value' }
  }

  // Revision is the file's state, so the database taking it is not a guess.
  if (context.owner === 'file') return { recoverability: 'recoverable' }

  return context.databaseEverHeldField
    ? { recoverability: 'recoverable' }
    : { recoverability: 'unattributed', unattributedReason: 'database-never-held-it' }
}

/**
 * Turn a class into what can be done about it.
 *
 * `databaseEverHeldField` is the whole reason `unrecoverable` and `no-evidence` are separate
 * states, and the reason `recoverable` and `unattributed` are. Neither side holding a value has
 * two completely different explanations - the value was lost from both, or it never existed - and
 * the file holding one the database does not has two more: the database lost it, or the database
 * never had it and the document's value is somebody else's. The reserved map key answers both:
 * present means the row once described its configurations, absent means it never did.
 */
export function classifyRecoverability(
  divergence: DivergenceClass,
  context: RecoveryContext,
): RecoverabilityVerdict {
  switch (divergence) {
    case 'agrees':
      return { recoverability: 'intact' }
    case 'file-empty':
      return { recoverability: 'absent-from-file' }
    case 'database-empty':
      return classifyDatabaseEmpty(context)
    case 'both-set-differ':
      return { recoverability: 'disagreeing' }
    case 'both-empty':
      return {
        recoverability: context.databaseEverHeldField ? 'unrecoverable' : 'no-evidence',
      }
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
 * This is the measurement that confirms or refutes the `jsonb ||` wipe: check-in replaced
 * `_config_tabs` wholesale rather than merging into it, so editing one configuration should leave
 * a map holding exactly the edited configurations and nothing else - and sending an empty edit
 * set should leave a map holding nothing at all, which is why the key's presence is recorded
 * separately from its size.
 */
export interface ConfigMapCoverage {
  fileConfigurationCount: number
  /** Whether `custom_properties` carries `_config_tabs` at all, however many entries it has. */
  databaseHasTabMap: boolean
  databaseHasDescriptionMap: boolean
  databaseTabKeyCount: number
  databaseDescriptionKeyCount: number
  /** Configurations the document has that `_config_tabs` gives no readable value for. */
  missingTabConfigurations: string[]
  /** Configurations the document has that `_config_descriptions` gives no readable value for. */
  missingDescriptionConfigurations: string[]
  /**
   * Configurations for which `_config_tabs` carries no key at all.
   *
   * A strict subset of `missingTabConfigurations`, and the difference between the two is the set
   * that matters to a repair: a key that is present and holds `""` is a configuration whose value
   * someone deliberately cleared. Both read as "no readable value", and only the first is a gap.
   * Filling the second would be the overwrite a repair is not allowed to perform, so the two are
   * measured apart here rather than being told apart by whoever consumes the number.
   */
  unkeyedTabConfigurations: string[]
  unkeyedDescriptionConfigurations: string[]
  /** Keys in the database maps with no matching configuration - a rename or a deleted config. */
  orphanedTabKeys: string[]
  orphanedDescriptionKeys: string[]
}

/** Everything phase 0 records about one file. */
export interface FileDivergence {
  fileId: string
  relativePath: string
  fileName: string
  fileType: ComparedFileType
  configurations: string[]
  fieldComparisons: FieldComparison[]
  coverage: ConfigMapCoverage
  /**
   * Configuration name to the tab its own `Number` implies. Only configurations that have one.
   *
   * Recorded rather than recomputed because working it out needs the document, and the document is
   * behind a three-minute vault walk that must not be repeated at repair time. It is kept out of
   * `fieldComparisons` deliberately: a derived tab is not a comparison and never contributes to a
   * recoverability verdict. It is raw material a person may opt into, and the only place in the
   * report where a value the database never distinctly held is offered at all.
   */
  derivableTabs: Record<string, string>
}

/** Identity of the row under comparison, carried through to the report. */
export interface FileIdentity {
  fileId: string
  relativePath: string
  fileName: string
  fileType: ComparedFileType
}

/**
 * What one configuration of a document actually holds.
 *
 * This is the definition of configuration scope for every comparison in the app - the scanner's and
 * the write verifier's alike - and it is deliberately literal: a configuration's bag, and nothing
 * underneath it. A configuration-scope write goes to that bag, so that bag is the only evidence
 * that it landed. Nothing else can distinguish "the configuration took the value" from "the
 * configuration is empty and the document happens to hold the same string at file level", and those
 * two are the difference between a title block that reads `PN-100-014` and one that reads `PN-100`.
 *
 * Not to be confused with `resolvedConfigurationProperties`, which is what a *reader* sees.
 */
export function configurationScopeProperties(
  file: FileMetadata,
  configuration: string,
): Readonly<Record<string, string>> {
  return file.configurationProperties[configuration] ?? {}
}

/**
 * What a reader looking at one configuration sees, file properties showing through underneath.
 *
 * SolidWorks resolves a property in a configuration's context by taking the configuration's own
 * value and falling back to the document's, and so does everything in BluePLM that displays a
 * configuration: the browser's configuration loader, the properties tab, the export naming. So this
 * is the correct view for *display* and the correct answer to "what value will the user see".
 *
 * It is the wrong view for deciding whether a write landed, because the fallback is exactly what a
 * failed configuration write leaves visible. The two views are named apart so that the next person
 * to need one is made to choose.
 */
export function resolvedConfigurationProperties(
  file: FileMetadata,
  configuration: string,
): Readonly<Record<string, string>> {
  return resolvedPropertyView(
    file.fileProperties,
    configurationScopeProperties(file, configuration),
  )
}

/**
 * The same resolution, for a caller holding the two bags rather than the whole document.
 *
 * The panels keep the selected configuration's properties in their own state and never assemble a
 * `FileMetadata`, so without this they went on spreading the two maps by hand - which is how the
 * split between the resolved view and the configuration's own came to be claimed as complete while
 * five display readers bypassed it. The rule has one definition and this is it; both exported
 * views are it under different arguments.
 */
export function resolvedPropertyView(
  fileProperties: Readonly<Record<string, string>>,
  configurationOwn: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return { ...fileProperties, ...configurationOwn }
}

/** A map entry describes a configuration only when it holds something readable. */
function describes(map: Readonly<Record<string, string>>, configuration: string): boolean {
  return normalizeValue(map[configuration]) !== null
}

function coverageOf(database: DatabaseMetadata, file: FileMetadata): ConfigMapCoverage {
  const configurations = [...file.configurations]
  const tabKeys = Object.keys(database.configTabs)
  const descriptionKeys = Object.keys(database.configDescriptions)
  const tabKeySet = new Set(tabKeys)
  const descriptionKeySet = new Set(descriptionKeys)

  return {
    fileConfigurationCount: configurations.length,
    databaseHasTabMap: database.hasConfigTabsKey,
    databaseHasDescriptionMap: database.hasConfigDescriptionsKey,
    databaseTabKeyCount: tabKeys.length,
    databaseDescriptionKeyCount: descriptionKeys.length,
    missingTabConfigurations: configurations.filter(
      (name) => !describes(database.configTabs, name),
    ),
    missingDescriptionConfigurations: configurations.filter(
      (name) => !describes(database.configDescriptions, name),
    ),
    unkeyedTabConfigurations: configurations.filter((name) => !tabKeySet.has(name)),
    unkeyedDescriptionConfigurations: configurations.filter((name) => !descriptionKeySet.has(name)),
    orphanedTabKeys: tabKeys.filter((key) => !configurations.includes(key)),
    orphanedDescriptionKeys: descriptionKeys.filter((key) => !configurations.includes(key)),
  }
}

/** The part of a comparison that depends only on the two values, not on where they sit. */
type ValueComparison = Pick<
  FieldComparison,
  | 'databaseValue'
  | 'fileValue'
  | 'databaseRepairValue'
  | 'divergence'
  | 'recoverability'
  | 'unattributedReason'
>

function comparisonOf(
  spec: FieldSpec,
  properties: Readonly<Record<string, string>>,
  databaseValue: string | null,
  context: Omit<RecoveryContext, 'repairValue'>,
): ValueComparison {
  const fileValue = readProperty(properties, spec.readKeys)
  const accepted = readAllProperties(properties, spec.acceptKeys)
  const repairValue = readCanonicalProperty(properties, spec.repairKeys)
  const divergence = classifyPair(databaseValue, fileValue, accepted)
  const verdict = classifyRecoverability(divergence, { ...context, repairValue })

  return {
    databaseValue: normalizeValue(databaseValue),
    fileValue,
    databaseRepairValue: repairValue,
    divergence,
    recoverability: verdict.recoverability,
    unattributedReason: verdict.unattributedReason,
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
    fieldComparisons.push({
      field: spec.field,
      scope: 'file',
      ...comparisonOf(spec, file.fileProperties, databaseFileValues[spec.field], {
        owner: ownerOf(spec.field, identity.fileType),
        databaseEverHeldField: false,
      }),
    })
  }

  // Whether the row ever described this file's configurations at all. The key's presence, not the
  // map's size: a check-in that sent an empty edit set replaced the whole map with `{}`, and that
  // row has lost every configuration it had while looking exactly like a row that has none.
  const claimed: Record<ConfigScopeField, boolean> = {
    config_tab: database.hasConfigTabsKey,
    config_description: database.hasConfigDescriptionsKey,
  }

  const derivableTabs: Record<string, string> = {}

  for (const configuration of file.configurations) {
    const properties = configurationScopeProperties(file, configuration)

    const derivedTab = deriveTabFromNumber(properties)
    if (derivedTab !== null) derivableTabs[configuration] = derivedTab

    for (const spec of CONFIG_SCOPE_SPECS) {
      const databaseValue =
        spec.field === 'config_tab'
          ? (database.configTabs[configuration] ?? null)
          : (database.configDescriptions[configuration] ?? null)

      fieldComparisons.push({
        field: spec.field,
        scope: 'configuration',
        configuration,
        ...comparisonOf(spec, properties, databaseValue, {
          owner: ownerOf(spec.field, identity.fileType),
          databaseEverHeldField: claimed[spec.field],
        }),
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
    derivableTabs,
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

/**
 * A value the file holds that the database has no claim to. Carries what the document says and
 * what could be written if a person decided to adopt it - which is not the same string when the
 * document's value sits under a key BluePLM does not write.
 */
export interface UnattributedValue {
  fileId: string
  relativePath: string
  field: OwnedField
  configuration?: string
  fileValue: string | null
  repairValue: string | null
  reason: UnattributedReason
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
  /** True when the map exists and is empty - the shape a wipe of every configuration leaves. */
  tabMapEmptied: boolean
  descriptionMapEmptied: boolean
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
  /**
   * Files with configurations whose row carries neither reserved map. Excluded from the wipe
   * numbers above - the database never described their configurations, so nothing was lost from
   * one - and reported separately so the exclusion is visible rather than silent.
   */
  filesWithNoConfigMap: number

  /** Recoverability, summed over every value compared. */
  recoverableValues: number
  unrecoverableValues: number
  disagreeingValues: number
  unattributedValues: number
  noEvidenceValues: number
  /** Values the database holds that the file does not. Not a loss; the file is behind the record. */
  absentFromFileValues: number

  unrecoverable: UnrecoverableValue[]
  disagreeing: DisagreeingValue[]
  unattributed: UnattributedValue[]

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
  const unattributed: UnattributedValue[] = []
  const truncatedConfigMaps: TruncatedConfigMap[] = []

  let filesWithAnyDivergence = 0
  let filesWithMultipleConfigurations = 0
  let filesWithNoConfigMap = 0
  let totalMissingConfigurationEntries = 0
  let recoverableValues = 0
  let noEvidenceValues = 0
  let absentFromFileValues = 0

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
        case 'unattributed':
          unattributed.push({
            fileId: file.fileId,
            relativePath: file.relativePath,
            field: comparison.field,
            configuration: comparison.configuration,
            fileValue: comparison.fileValue,
            repairValue: comparison.databaseRepairValue,
            reason: comparison.unattributedReason ?? 'database-never-held-it',
          })
          break
        case 'no-evidence':
          noEvidenceValues += 1
          break
        case 'absent-from-file':
          absentFromFileValues += 1
          break
        case 'intact':
          break
      }
    }

    if (fileHasFinding) filesWithAnyDivergence += 1

    const coverage = file.coverage
    const missingTabs = coverage.missingTabConfigurations.length
    const missingDescriptions = coverage.missingDescriptionConfigurations.length

    const hasNoConfigMap = !coverage.databaseHasTabMap && !coverage.databaseHasDescriptionMap
    if (coverage.fileConfigurationCount > 0 && hasNoConfigMap) filesWithNoConfigMap += 1

    // Only a file whose row carries the map can have lost entries from it. A row with no map
    // never described its configurations, and counting its configurations as missing entries
    // would put every part in a vault that has never used the feature into the wipe's total.
    if (coverage.databaseHasTabMap) totalMissingConfigurationEntries += missingTabs
    if (coverage.databaseHasDescriptionMap) totalMissingConfigurationEntries += missingDescriptions

    const tabMapTruncated = coverage.databaseHasTabMap && missingTabs > 0
    const descriptionMapTruncated = coverage.databaseHasDescriptionMap && missingDescriptions > 0

    if (tabMapTruncated || descriptionMapTruncated) {
      truncatedConfigMaps.push({
        fileId: file.fileId,
        relativePath: file.relativePath,
        fileConfigurationCount: coverage.fileConfigurationCount,
        databaseTabKeyCount: coverage.databaseTabKeyCount,
        missingTabCount: missingTabs,
        missingTabConfigurations: coverage.missingTabConfigurations,
        databaseDescriptionKeyCount: coverage.databaseDescriptionKeyCount,
        missingDescriptionCount: missingDescriptions,
        tabMapEmptied: coverage.databaseHasTabMap && coverage.databaseTabKeyCount === 0,
        descriptionMapEmptied:
          coverage.databaseHasDescriptionMap && coverage.databaseDescriptionKeyCount === 0,
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
    filesWithNoConfigMap,
    recoverableValues,
    unrecoverableValues: unrecoverable.length,
    disagreeingValues: disagreeing.length,
    unattributedValues: unattributed.length,
    noEvidenceValues,
    absentFromFileValues,
    unrecoverable,
    disagreeing,
    unattributed,
    fieldTallies,
  }
}
