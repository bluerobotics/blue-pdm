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
 * `both-set-differ` is always `disagreeing`, including for a drawing's revision, which the
 * ownership table gives to the file. The direction that conflict resolves in is a repair-phase
 * decision made from `fileType`; this module only refuses to make it automatically.
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
  /** The database still holds the value. Nothing to recover. */
  | 'intact'
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

const REVISION_KEYS = ['Revision', 'REVISION', 'revision', 'Rev', 'REV', 'rev', 'Rev.', 'REV.'] as const

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
  /** The document. A drawing's revision, whose own revision table is the record. */
  | 'file'
  /**
   * Neither this row nor this document: a drawing's part number and description are a projection
   * of its parent model's row, so the drawing's own copy is never promoted as authoritative.
   */
  | 'parent-model'

/** Apply the ownership table to one field on one kind of file. */
export function ownerOf(field: OwnedField, fileType: ComparedFileType): FieldOwner {
  if (fileType !== 'drawing') return 'database'
  return field === 'revision' ? 'file' : 'parent-model'
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

  // A drawing's revision is the drawing's to state, so the database taking it is not a guess.
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
      return { recoverability: 'intact' }
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
  return { ...file.fileProperties, ...configurationScopeProperties(file, configuration) }
}

/** A map entry describes a configuration only when it holds something readable. */
function describes(map: Readonly<Record<string, string>>, configuration: string): boolean {
  return normalizeValue(map[configuration]) !== null
}

function coverageOf(database: DatabaseMetadata, file: FileMetadata): ConfigMapCoverage {
  const configurations = [...file.configurations]
  const tabKeys = Object.keys(database.configTabs)
  const descriptionKeys = Object.keys(database.configDescriptions)

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

  for (const configuration of file.configurations) {
    const properties = configurationScopeProperties(file, configuration)

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
    unrecoverable,
    disagreeing,
    unattributed,
    fieldTallies,
  }
}
