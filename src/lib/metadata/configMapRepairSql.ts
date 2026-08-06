/**
 * Emitting the SQL that fills the gaps, for the database owner to run.
 *
 * This module produces text. It holds no client, opens no connection and imports nothing that
 * could: the repair tool is structurally incapable of writing to the database, and the only way a
 * row changes is a person reading this file and running it.
 *
 * ## Why the statement cannot lose data
 *
 * Every generated `UPDATE` has exactly this shape, per reserved map:
 *
 * ```sql
 * jsonb_set(custom_properties, '{_config_tabs}',
 *           '<computed>'::jsonb || COALESCE(custom_properties -> '_config_tabs', '{}'::jsonb))
 * ```
 *
 * Four properties follow from the shape alone, without reading the computed side:
 *
 * 1. **`a || b` keeps `b` on every shared key.** The live map is on the right, so an entry the row
 *    already holds survives untouched even if the computed side disagrees with it.
 * 2. **`a || b` produces the union of the key sets.** No key of the live map can be absent from the
 *    result, so no configuration can be dropped - including keys for configurations that no longer
 *    exist, which are left exactly where they are rather than tidied away.
 * 3. **The live map is read at apply time, not at plan time.** If the row gained entries between
 *    the export and the run, those entries are the ones that win. A stale plan degrades to a
 *    smaller repair, never to an overwrite.
 * 4. **`jsonb_set` replaces one path.** Every other key under `custom_properties` is carried
 *    through unchanged, and no other column appears in the `SET` list.
 *
 * The `WHERE` clause adds refusals rather than reach: the row must still exist under the same path,
 * must not be deleted, and must still carry the map as a JSON object. A row that fails any of them
 * is not updated, which is visible as a row count of zero and is always the safe outcome.
 *
 * There is no `DELETE`, no `jsonb - key`, and no path by which a value already in the row can be
 * read, modified and written back.
 */

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'

import {
  CONFIG_MAP_KEYS,
  proposedMap,
  type ConfigMapKey,
  type FileRepairPlan,
  type RepairPlan,
} from './configMapRepair'

/** Bumped when the emitted statement's shape changes, so a saved file names the rules it was built under. */
export const REPAIR_SQL_FORMAT_VERSION = 1

export interface EmittedSql {
  sql: string
  /** How many `UPDATE` statements the file contains. One per file with proposals. */
  statements: number
  /** Files that had proposals but could not be targeted, with the reason. */
  omitted: { relativePath: string; reason: string }[]
}

// ============================================
// Literals
// ============================================

/**
 * A single-quoted SQL literal.
 *
 * Doubling the quote is the whole escape, because PostgreSQL runs with
 * `standard_conforming_strings` on, so a backslash in a configuration name or a description is an
 * ordinary character rather than the start of an escape. The values here reach the literal through
 * `JSON.stringify`, which has already turned every newline and control character into a two-
 * character escape, so the result is always one line.
 */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** A uuid, refused unless it looks like one. The id goes into a literal, so the shape is checked. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidLiteral(id: string): string | null {
  return UUID_PATTERN.test(id.trim()) ? `${literal(id.trim())}::uuid` : null
}

// ============================================
// One statement
// ============================================

/** The maps a file actually has proposals for, in a stable order. */
function mapsToFill(plan: FileRepairPlan): ConfigMapKey[] {
  return CONFIG_MAP_KEYS.filter((map) => plan.proposed.some((entry) => entry.map === map))
}

/** Key order fixed so that re-running the tool on unchanged inputs produces an identical file. */
function stableJson(computed: Readonly<Record<string, string>>): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(computed).sort()) sorted[key] = computed[key]
  return JSON.stringify(sorted)
}

function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
}

/**
 * Wrap one more `jsonb_set` around the expression built so far.
 *
 * `custom_properties` inside the value expression refers to the row's pre-update value, which is
 * what makes the live map - and not the plan's snapshot of it - the side that wins.
 */
function wrapMap(
  inner: string,
  map: ConfigMapKey,
  computed: Readonly<Record<string, string>>,
): string {
  return [
    `jsonb_set(`,
    `${indent(inner)},`,
    `  '{${map}}',`,
    `  -- computed || existing: the row's own entries are on the right, so they win on every`,
    `  -- shared key and the result holds the union of both key sets.`,
    `  ${literal(stableJson(computed))}::jsonb`,
    `    || COALESCE(custom_properties -> '${map}', '{}'::jsonb)`,
    `)`,
  ].join('\n')
}

function guardsFor(maps: readonly ConfigMapKey[]): string[] {
  return maps.map(
    (map) =>
      `  AND custom_properties ? '${map}'\n` +
      `  AND jsonb_typeof(custom_properties -> '${map}') = 'object'`,
  )
}

function expectationComment(plan: FileRepairPlan, maps: readonly ConfigMapKey[]): string[] {
  return maps.map((map) => {
    const before = plan.existingKeyCount[map]
    const added = plan.proposed.filter((entry) => entry.map === map).length
    // "At least", because the row wins: entries added since the export are kept too, and they
    // would make the count higher than this rather than lower.
    return `--   ${map}: ${before} entries at export, ${added} to add, at least ${before + added} after`
  })
}

function statementFor(plan: FileRepairPlan): string | null {
  const maps = mapsToFill(plan)
  if (maps.length === 0 || plan.fileId === null) return null

  const id = uuidLiteral(plan.fileId)
  if (id === null) return null

  let expression = `COALESCE(custom_properties, '{}'::jsonb)`
  for (const map of maps) expression = wrapMap(expression, map, proposedMap(plan, map))

  return [
    `-- ${plan.relativePath}`,
    `--   ${plan.configurationCount} configurations in the document`,
    ...expectationComment(plan, maps),
    `UPDATE files SET custom_properties =`,
    indent(expression),
    `WHERE id = ${id}`,
    `  AND file_path = ${literal(plan.relativePath)}`,
    `  AND deleted_at IS NULL`,
    ...guardsFor(maps),
    `;`,
  ].join('\n')
}

// ============================================
// The file
// ============================================

function header(plan: RepairPlan, generatedAt: string): string[] {
  const { summary, options } = plan
  return [
    `-- Configuration-map repair, generated ${generatedAt} (format ${REPAIR_SQL_FORMAT_VERSION}).`,
    `--`,
    `-- Fills entries the pre-fix checkin_file erased from custom_properties._config_tabs and`,
    `-- ._config_descriptions, reading the values back out of the SolidWorks documents.`,
    `--`,
    `-- THIS SCRIPT CANNOT REMOVE OR CHANGE AN EXISTING ENTRY. Every map is rewritten as`,
    `-- \`computed || existing\`, in which the row's own value wins on any shared key and the key set`,
    `-- is the union of the two, so the only representable effect is adding a key the row lacks.`,
    `-- The right-hand side reads the live row, so entries added since the plan was computed also`,
    `-- win. Keys naming configurations that no longer exist are carried through untouched.`,
    `--`,
    `-- ${summary.proposedEntries} entries across ${summary.filesWithProposals} files.`,
    `--   recovered from a key BluePLM writes: ${summary.recoveredEntries}`,
    `--   derived from the configuration's Number: ${summary.derivedEntries}`,
    `--   equal to the document's file-level value: ${summary.fileLevelDuplicateEntries}`,
    `-- ${summary.existingKeysPreserved} existing entries are left exactly as they are.`,
    `-- ${summary.staleKeys} keys name configurations the document no longer has; none is removed.`,
    `--`,
    `-- Options: includeDerivedTabs=${options.includeDerivedTabs}, ` +
      `skipFileLevelDuplicates=${options.skipFileLevelDuplicates}`,
    `--`,
    `-- Run it in the Supabase SQL editor. If any statement reports 0 rows the row moved or its map`,
    `-- changed shape; that is a refusal, not a failure, and re-exporting is the fix.`,
    ``,
    `BEGIN;`,
    ``,
  ]
}

/**
 * A read-only receipt, run after the commit so the SQL editor shows it as the final result.
 *
 * Mirrors the shape query's counting so the numbers are comparable with the ones in the header
 * comments above each statement.
 */
function receipt(ids: readonly string[]): string[] {
  if (ids.length === 0) return []
  return [
    ``,
    `-- Receipt. Compare against the "at least ... after" numbers above each statement.`,
    `SELECT f.file_path,`,
    `       CASE WHEN jsonb_typeof(f.custom_properties -> '${CONFIG_TABS_KEY}') = 'object'`,
    `            THEN (SELECT count(*) FROM jsonb_object_keys(f.custom_properties -> '${CONFIG_TABS_KEY}'))`,
    `       END AS tab_entries,`,
    `       CASE WHEN jsonb_typeof(f.custom_properties -> '${CONFIG_DESCRIPTIONS_KEY}') = 'object'`,
    `            THEN (SELECT count(*) FROM jsonb_object_keys(f.custom_properties -> '${CONFIG_DESCRIPTIONS_KEY}'))`,
    `       END AS description_entries`,
    `FROM files f`,
    `WHERE f.id IN (${ids.join(', ')})`,
    `ORDER BY f.file_path;`,
    ``,
  ]
}

/** Render the plan as a SQL script. Returns the text; writing it anywhere is the caller's business. */
export function emitRepairSql(plan: RepairPlan, generatedAt: string): EmittedSql {
  const statements: string[] = []
  const ids: string[] = []
  const omitted: { relativePath: string; reason: string }[] = []

  for (const file of plan.files) {
    if (file.proposed.length === 0) continue

    if (file.fileId === null) {
      omitted.push({
        relativePath: file.relativePath,
        reason: 'the export carried no id for this row, and the id is the only safe target',
      })
      continue
    }

    const id = uuidLiteral(file.fileId)
    if (id === null) {
      omitted.push({ relativePath: file.relativePath, reason: `id is not a uuid: ${file.fileId}` })
      continue
    }

    const statement = statementFor(file)
    if (statement === null) continue

    statements.push(statement)
    ids.push(id)
  }

  const body =
    statements.length > 0
      ? statements.join('\n\n')
      : '-- Nothing to fill. Every configuration the documents have is already on its row.'

  const sql = [
    ...header(plan, generatedAt),
    body,
    ``,
    `COMMIT;`,
    ...receipt(ids),
  ].join('\n')

  return { sql, statements: statements.length, omitted }
}
