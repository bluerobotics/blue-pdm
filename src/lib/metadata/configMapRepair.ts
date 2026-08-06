/**
 * Planning the repair of per-configuration maps the pre-fix `checkin_file` erased.
 *
 * `jsonb ||` is a top-level merge, so a check-in that patched `custom_properties._config_tabs` with
 * only the configurations the user had edited replaced the whole map with those few entries. An
 * empty-but-present pending map - truthy in JavaScript - was sent as a complete map and replaced it
 * with `{}`. Both are fixed as of schema 87 and `merge_custom_properties` now merges entry-wise, but
 * nothing rewrites the rows that were already truncated, and nothing else in the codebase writes
 * these maps, so there is no self-healing. The SolidWorks documents still hold the values, because
 * the wipe destroyed the database's copy and not the file's.
 *
 * ## Data loss is unrepresentable here, not merely avoided
 *
 * Everything this module produces is a set of entries for configuration keys that are **absent**
 * from the row's map. There is no code path that emits an existing key, a key for a configuration
 * the document does not have, or a deletion - `gapsOnly` is the only producer of proposals and it
 * filters on `key in existing` before anything else looks at a value. `fillGapsOnly` states the
 * same rule as the merge the SQL performs, `computed || existing`, in which the existing value
 * always wins and the key set only ever grows. `fillIsAdditive` asserts the two agree.
 *
 * The consequence worth saying out loud: a repair against a row that is already intact proposes
 * nothing, and a repair against a row whose value disagrees with the document leaves the row's
 * value alone. Both are tested.
 *
 * A row carrying keys for configurations that no longer exist is left exactly as it is. Those keys
 * are reported so the operator can see them, and removing one would be a deletion, which this
 * module has no way to express.
 *
 * ## What a value may be filled from
 *
 * Only the keys BluePLM's own writers produce, taken from `CONFIG_SCOPE_SPECS.repairKeys` in
 * `divergence.ts` rather than restated here - `Description` for a configuration description and
 * `Tab Number` for a configuration tab. That list is the authority, it already applies the `$PRP:`
 * guard through `readCanonicalProperty`, and consuming it means this module tracks it rather than
 * becoming a sixth key list.
 *
 * A tab may also be *derived* by splitting the configuration's own `Number` on its last dash, which
 * is what the browser does at display time. That produces a value the database never distinctly
 * held, so it is off by default and always marked `derived` when it is on.
 *
 * This module is pure: no I/O, no store access, no imports that can reach Supabase, the SolidWorks
 * service or the file system.
 */

import {
  configurationScopeProperties,
  CONFIG_DESCRIPTIONS_KEY,
  CONFIG_SCOPE_SPECS,
  CONFIG_TABS_KEY,
  readCanonicalProperty,
  type ConfigScopeField,
  type FileMetadata,
} from './divergence'

// ============================================
// Vocabulary
// ============================================

/** The two reserved keys under `files.custom_properties` that hold a configuration-name-keyed map. */
export const CONFIG_MAP_KEYS = [CONFIG_TABS_KEY, CONFIG_DESCRIPTIONS_KEY] as const

export type ConfigMapKey = (typeof CONFIG_MAP_KEYS)[number]

/** Which logical field each reserved map stores, so the fill reads the right property key. */
const MAP_FIELDS: Record<ConfigMapKey, ConfigScopeField> = {
  [CONFIG_TABS_KEY]: 'config_tab',
  [CONFIG_DESCRIPTIONS_KEY]: 'config_description',
}

/**
 * The single document property a tab may be derived from.
 *
 * `Number` carries the base part number plus the configuration's tab; `Base Item Number` carries
 * the base alone, so splitting that one yields a fragment of the base rather than a tab. The
 * browser's display-time derivation in `loadFileConfigurations.ts` also accepts `Part Number` and
 * `PartNumber`; this does not, because a value under either of those has no documented relationship
 * to the tab and guessing is the failure mode the whole exercise exists to avoid. The disagreement
 * is one of the several the property-contract task is meant to settle.
 */
const TAB_DERIVATION_KEYS = ['Number'] as const

/**
 * The longest trailing segment of `Number` that reads as a tab rather than as the number itself,
 * matching `tabFromNumber` in `loadFileConfigurations.ts`.
 */
const MAX_DERIVED_TAB_LENGTH = 4

/** How a proposed value was arrived at. The report keeps the two apart; so does the operator. */
export type FillProvenance =
  /** Read from the key BluePLM writes, in the configuration's own property bag. */
  | 'recovered'
  /** Computed from the configuration's `Number`. A value the database never distinctly held. */
  | 'derived'

/** Why a configuration produced no proposal. Every configuration lands in exactly one of these. */
export type SkipReason =
  /** The row's map already has this key. Never touched, whatever the document says. */
  | 'key-already-present'
  /** The row carries no such map, so the database never described this file's configurations. */
  | 'row-has-no-map'
  /** The row's map is not a JSON object. Not a shape this application writes; left alone. */
  | 'row-map-not-an-object'
  /** The configuration's own bag holds nothing under a key BluePLM writes. */
  | 'no-value-in-document'
  /** A tab could only be derived from `Number`, and derivation was not enabled. */
  | 'derivation-not-enabled'
  /** The value equals the document's file-level value, and duplicates were excluded. */
  | 'matches-file-level'

// ============================================
// Inputs
// ============================================

/** The shape of one reserved map on one row, as `config-map-shapes.sql` reports it. */
export type MapShape = 'absent' | 'present' | 'present-empty' | 'not-an-object'

/**
 * One `files` row's map shapes and the configuration names each map holds keys for.
 *
 * The names rather than a count: a 26-entry map on a 15-configuration file reads as intact against
 * a count and as eleven stale keys plus nothing missing against the names.
 *
 * `id` is nullable because the query the census shipped with does not select it. A plan can be
 * reported without one; SQL cannot be emitted without one, because the id is the only identity a
 * statement can safely target.
 */
export interface ConfigMapShapeRow {
  id: string | null
  filePath: string
  fileName: string
  shapes: Record<ConfigMapKey, MapShape>
  /** Keys present in each map. Presence is what decides a gap; the values are never needed. */
  keys: Record<ConfigMapKey, readonly string[]>
  updatedAt: string | null
}

/**
 * One document as the read-only Document Manager census measured it.
 *
 * A `FileMetadata` plus where it lives, rather than a restatement of the same three fields, so
 * that the scope and resolved views in `divergence.ts` apply to it by declaration.
 */
export interface CensusDocument extends FileMetadata {
  /** Path relative to the vault root, backslash-separated, as the row stores it. */
  relativePath: string
  absolutePath: string
}

/** The two judgement calls, plus the usual narrowing. Both default to the conservative side. */
export interface RepairOptions {
  /**
   * Fill a tab derived from `Number` when the configuration carries no `Tab Number`.
   *
   * Off by default. A derived value is a reconstruction, and the derivation does not even agree
   * with the stored convention about the leading dash - the census has configurations whose
   * `Number` ends `-010` and whose `Tab Number` reads `-010`, where this rule yields `010`.
   */
  includeDerivedTabs: boolean
  /**
   * Exclude a value that equals the document's file-level value for the same field.
   *
   * Off by default, so those entries are filled. The value sits in the configuration's own property
   * bag, and per the source-of-truth plan's measurement of this very fixture, equality with the
   * file-level value is not evidence of inheritance - both are set deliberately. Filling restores
   * what the row held before the wipe and changes nothing a user sees, because a configuration with
   * no entry already falls back to the document at display time.
   */
  skipFileLevelDuplicates: boolean
  /** Only plan files whose relative path starts with this, case-insensitively. */
  pathPrefix?: string
  /** Only plan these exact relative paths, case-insensitively. */
  onlyPaths?: readonly string[]
}

export const DEFAULT_REPAIR_OPTIONS: RepairOptions = {
  includeDerivedTabs: false,
  skipFileLevelDuplicates: false,
}

// ============================================
// Output
// ============================================

/** One value proposed for one absent key. */
export interface ProposedEntry {
  map: ConfigMapKey
  configuration: string
  value: string
  provenance: FillProvenance
  /** The value equals what the document holds at file level for the same field. */
  matchesFileLevel: boolean
}

/** One configuration that produced nothing, and why. */
export interface SkippedEntry {
  map: ConfigMapKey
  configuration: string
  reason: SkipReason
  /** The value that would have been filled, where one was computed before being declined. */
  value: string | null
}

/** A key in a row's map naming a configuration the document does not have. Never removed. */
export interface StaleKey {
  map: ConfigMapKey
  configuration: string
}

/** Everything planned for one file. */
export interface FileRepairPlan {
  fileId: string | null
  relativePath: string
  fileName: string
  configurationCount: number
  proposed: ProposedEntry[]
  skipped: SkippedEntry[]
  staleKeys: StaleKey[]
  /** Keys the row already holds, per map. Every one of them is left exactly as it is. */
  existingKeyCount: Record<ConfigMapKey, number>
}

/** A row the plan could not act on. */
export interface UnplannedRow {
  relativePath: string
  reason: 'no-census-record' | 'census-unreadable' | 'out-of-scope'
  detail?: string
}

export interface RepairSummary {
  rowsConsidered: number
  filesWithProposals: number
  filesUntouched: number
  proposedEntries: number
  recoveredEntries: number
  derivedEntries: number
  /** Of the proposals, how many repeat the document's file-level value. */
  fileLevelDuplicateEntries: number
  /** Keys left exactly as the row holds them. The number the additive property is measured on. */
  existingKeysPreserved: number
  staleKeys: number
  skippedByReason: Record<SkipReason, number>
}

export interface RepairPlan {
  files: FileRepairPlan[]
  unplanned: UnplannedRow[]
  summary: RepairSummary
  options: RepairOptions
}

// ============================================
// The safety primitive
// ============================================

/**
 * The entries of `computed` whose key is absent from `existing`.
 *
 * The only producer of proposals in this module. It decides on key presence alone, before any value
 * is compared, so there is no arrangement of inputs in which it returns a key `existing` already
 * has - which is what makes "never modify an existing key" a property of the shape of the result
 * rather than a rule the caller has to remember.
 *
 * Presence, not emptiness: a key holding `""` is a configuration whose value someone deliberately
 * cleared, and overwriting it would be exactly the modification this refuses to make.
 */
export function gapsOnly(
  computed: Readonly<Record<string, string>>,
  existing: Readonly<Record<string, string>>,
): Record<string, string> {
  const gaps: Record<string, string> = {}
  for (const [key, value] of Object.entries(computed)) {
    if (key in existing) continue
    gaps[key] = value
  }
  return gaps
}

/**
 * `computed || existing` in `jsonb` terms: the right side wins, so only gaps are filled.
 *
 * This is the merge the emitted SQL performs against the live row, restated in TypeScript so it can
 * be asserted. The spread order is the whole of it - `existing` last means an existing value always
 * survives - and the result's key set is the union of the two, so no key can be dropped.
 */
export function fillGapsOnly(
  computed: Readonly<Record<string, string>>,
  existing: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...computed, ...existing }
}

/**
 * Whether applying `computed` to `existing` adds keys and changes nothing else.
 *
 * Exported so the property can be asserted over arbitrary inputs rather than over the handful of
 * cases a test happens to write down.
 */
export function fillIsAdditive(
  computed: Readonly<Record<string, string>>,
  existing: Readonly<Record<string, string>>,
): boolean {
  const merged = fillGapsOnly(computed, existing)
  for (const [key, value] of Object.entries(existing)) {
    if (merged[key] !== value) return false
  }
  return Object.keys(existing).every((key) => key in merged)
}

// ============================================
// Reading a value out of a configuration
// ============================================

/**
 * The tab a configuration's own `Number` implies, or null.
 *
 * Mirrors `tabFromNumber` in `loadFileConfigurations.ts`: split on the dash, and take the trailing
 * segment only when it is short enough to be a tab rather than the number itself. Unlike that
 * function this reads the configuration's own bag only, never the resolved view - resolving would
 * fall back to the file-level `Number` and hand every configuration the family's tab, which is the
 * `-XXX` value the census found on the ORING family and is not that configuration's tab at all.
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

interface Candidate {
  value: string
  provenance: FillProvenance
}

/** The repair keys for one map, straight from the divergence module's field specs. */
function repairKeysFor(map: ConfigMapKey): readonly string[] {
  const field = MAP_FIELDS[map]
  const spec = CONFIG_SCOPE_SPECS.find((candidate) => candidate.field === field)
  // Unreachable while both fields have a spec; a throw rather than a silent empty list, because an
  // empty list would quietly report every configuration as holding no value.
  if (!spec) throw new Error(`No field spec for ${field}`)
  return spec.repairKeys
}

/**
 * What one configuration offers for one map, or null.
 *
 * `readCanonicalProperty` applies the `$PRP:` guard, so a linked property reads as absent here: a
 * reference is not a value and writing one into the database would store a formula where a string
 * belongs.
 */
function candidateFor(
  map: ConfigMapKey,
  configurationProperties: Readonly<Record<string, string>>,
): Candidate | null {
  const recovered = readCanonicalProperty(configurationProperties, repairKeysFor(map))
  if (recovered !== null) return { value: recovered, provenance: 'recovered' }

  if (map !== CONFIG_TABS_KEY) return null

  const derived = deriveTabFromNumber(configurationProperties)
  return derived === null ? null : { value: derived, provenance: 'derived' }
}

/** The document's file-level value for the same field, for the duplicate judgement. */
function fileLevelValue(
  map: ConfigMapKey,
  fileProperties: Readonly<Record<string, string>>,
): string | null {
  return readCanonicalProperty(fileProperties, repairKeysFor(map))
}

// ============================================
// Planning one file
// ============================================

function shapeAllowsFill(shape: MapShape): { allowed: boolean; reason?: SkipReason } {
  switch (shape) {
    case 'present':
    case 'present-empty':
      return { allowed: true }
    case 'absent':
      return { allowed: false, reason: 'row-has-no-map' }
    case 'not-an-object':
      return { allowed: false, reason: 'row-map-not-an-object' }
  }
}

function planMap(
  map: ConfigMapKey,
  row: ConfigMapShapeRow,
  document: CensusDocument,
  options: RepairOptions,
  proposed: ProposedEntry[],
  skipped: SkippedEntry[],
): void {
  const gate = shapeAllowsFill(row.shapes[map])
  if (!gate.allowed) {
    // The row never described this file's configurations, so the document's values were never
    // BluePLM's to lose. Adopting them would invent database state - the `unattributed` verdict
    // the divergence scanner exists to keep out of a repair.
    for (const configuration of document.configurations) {
      skipped.push({ map, configuration, reason: gate.reason ?? 'row-has-no-map', value: null })
    }
    return
  }

  const existingKeys = new Set(row.keys[map])
  const fileValue = fileLevelValue(map, document.fileProperties)

  for (const configuration of document.configurations) {
    if (existingKeys.has(configuration)) {
      skipped.push({ map, configuration, reason: 'key-already-present', value: null })
      continue
    }

    // The scope view, never the resolved one: filling a configuration's entry from a value that
    // is only showing through from file level would record an inheritance as an owned value.
    const own = configurationScopeProperties(document, configuration)
    const candidate = candidateFor(map, own)

    if (candidate === null) {
      skipped.push({ map, configuration, reason: 'no-value-in-document', value: null })
      continue
    }

    if (candidate.provenance === 'derived' && !options.includeDerivedTabs) {
      skipped.push({
        map,
        configuration,
        reason: 'derivation-not-enabled',
        value: candidate.value,
      })
      continue
    }

    const matchesFileLevel = fileValue !== null && fileValue === candidate.value

    if (matchesFileLevel && options.skipFileLevelDuplicates) {
      skipped.push({ map, configuration, reason: 'matches-file-level', value: candidate.value })
      continue
    }

    proposed.push({
      map,
      configuration,
      value: candidate.value,
      provenance: candidate.provenance,
      matchesFileLevel,
    })
  }
}

/** Keys the row holds for configurations the document does not have. Reported, never removed. */
function staleKeysOf(row: ConfigMapShapeRow, document: CensusDocument): StaleKey[] {
  const present = new Set(document.configurations)
  const stale: StaleKey[] = []
  for (const map of CONFIG_MAP_KEYS) {
    for (const configuration of row.keys[map]) {
      if (!present.has(configuration)) stale.push({ map, configuration })
    }
  }
  return stale
}

/** Plan one row against the document the census measured for it. */
export function planFileRepair(
  row: ConfigMapShapeRow,
  document: CensusDocument,
  options: RepairOptions,
): FileRepairPlan {
  const proposed: ProposedEntry[] = []
  const skipped: SkippedEntry[] = []

  for (const map of CONFIG_MAP_KEYS) {
    planMap(map, row, document, options, proposed, skipped)
  }

  return {
    fileId: row.id,
    relativePath: row.filePath,
    fileName: row.fileName,
    configurationCount: document.configurations.length,
    proposed,
    skipped,
    staleKeys: staleKeysOf(row, document),
    existingKeyCount: {
      [CONFIG_TABS_KEY]: row.keys[CONFIG_TABS_KEY].length,
      [CONFIG_DESCRIPTIONS_KEY]: row.keys[CONFIG_DESCRIPTIONS_KEY].length,
    },
  }
}

/** The proposals for one file collapsed into the map a `computed || existing` merge would take. */
export function proposedMap(plan: FileRepairPlan, map: ConfigMapKey): Record<string, string> {
  const values: Record<string, string> = {}
  for (const entry of plan.proposed) {
    if (entry.map === map) values[entry.configuration] = entry.value
  }
  return values
}

// ============================================
// Planning a set of rows
// ============================================

function normalizePath(value: string): string {
  return value.replace(/\//g, '\\').replace(/^\\+/, '').toLowerCase()
}

function inScope(relativePath: string, options: RepairOptions): boolean {
  const path = normalizePath(relativePath)

  if (options.onlyPaths && options.onlyPaths.length > 0) {
    return options.onlyPaths.some((wanted) => normalizePath(wanted) === path)
  }
  if (options.pathPrefix) return path.startsWith(normalizePath(options.pathPrefix))
  return true
}

function emptySkipTally(): Record<SkipReason, number> {
  return {
    'key-already-present': 0,
    'row-has-no-map': 0,
    'row-map-not-an-object': 0,
    'no-value-in-document': 0,
    'derivation-not-enabled': 0,
    'matches-file-level': 0,
  }
}

function summarize(files: readonly FileRepairPlan[], rowsConsidered: number): RepairSummary {
  const skippedByReason = emptySkipTally()
  let proposedEntries = 0
  let recoveredEntries = 0
  let derivedEntries = 0
  let fileLevelDuplicateEntries = 0
  let existingKeysPreserved = 0
  let staleKeys = 0
  let filesWithProposals = 0

  for (const file of files) {
    if (file.proposed.length > 0) filesWithProposals += 1
    staleKeys += file.staleKeys.length
    existingKeysPreserved +=
      file.existingKeyCount[CONFIG_TABS_KEY] + file.existingKeyCount[CONFIG_DESCRIPTIONS_KEY]

    for (const entry of file.proposed) {
      proposedEntries += 1
      if (entry.provenance === 'recovered') recoveredEntries += 1
      else derivedEntries += 1
      if (entry.matchesFileLevel) fileLevelDuplicateEntries += 1
    }
    for (const entry of file.skipped) skippedByReason[entry.reason] += 1
  }

  return {
    rowsConsidered,
    filesWithProposals,
    filesUntouched: files.length - filesWithProposals,
    proposedEntries,
    recoveredEntries,
    derivedEntries,
    fileLevelDuplicateEntries,
    existingKeysPreserved,
    staleKeys,
    skippedByReason,
  }
}

/**
 * Plan every row that the census has a readable document for.
 *
 * A row with no census record produces nothing rather than a guess: the configuration list is what
 * decides which keys are gaps and which are stale, and without it neither question has an answer.
 */
export function planConfigMapRepair(
  rows: readonly ConfigMapShapeRow[],
  census: ReadonlyMap<string, CensusDocument>,
  unreadable: ReadonlyMap<string, string>,
  options: RepairOptions = DEFAULT_REPAIR_OPTIONS,
): RepairPlan {
  const files: FileRepairPlan[] = []
  const unplanned: UnplannedRow[] = []
  let rowsConsidered = 0

  for (const row of rows) {
    if (!inScope(row.filePath, options)) {
      unplanned.push({ relativePath: row.filePath, reason: 'out-of-scope' })
      continue
    }

    rowsConsidered += 1
    const key = normalizePath(row.filePath)
    const document = census.get(key)

    if (!document) {
      const detail = unreadable.get(key)
      unplanned.push({
        relativePath: row.filePath,
        reason: detail ? 'census-unreadable' : 'no-census-record',
        detail,
      })
      continue
    }

    files.push(planFileRepair(row, document, options))
  }

  return { files, unplanned, summary: summarize(files, rowsConsidered), options }
}
