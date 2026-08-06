/**
 * Read-only divergence scanner (phase 0 of `.cursor/plans/metadata-source-of-truth.plan.md`).
 *
 * Answers, over the real vault, how far the database and the SolidWorks files have drifted apart
 * on the fields the ownership table calls database-owned, and - for every value the database no
 * longer holds - whether the file still has it.
 *
 * ## This module cannot write. That is a structural property, not a convention.
 *
 * - **Database**: the only Supabase call is `.from('files').select(...)`. There is no `.insert`,
 *   `.update`, `.upsert`, `.delete` or `.rpc` anywhere in this file, and nothing from
 *   `lib/supabase/files/` - the modules that hold check-in, check-out and metadata promotion - is
 *   imported. A reviewer can confirm that from the import list alone.
 * - **SolidWorks files**: read through `solidworks.getPropertiesDocumentManager`, which resolves to
 *   `DocumentManagerAPI.GetCustomProperties` and opens the document with `readOnly: true`.
 *   `setProperties`, `setPropertiesBatch`, `setDocumentProperties` and `saveDocument` are never
 *   called, and `syncMetadata` - the module that owns the write path - is not imported.
 *
 *   Deliberately not `getProperties`: that dispatch asks `IsFileOpenInSolidWorks` and reads
 *   through the running session when the answer is yes, which would put a vault-wide walk through
 *   the session the user is working in. The caller is expected to supply `openInSolidWorks` so
 *   that documents SolidWorks is holding are skipped rather than opened by either route.
 * - **Disk**: the single write is the report artifact, and it goes to the application's log
 *   directory. Nothing under the vault is opened for writing.
 *
 * The scan runs before any phase that writes files from database values, because the files still
 * hold the only surviving copy of what the `jsonb ||` configuration-map wipe destroyed. Writing
 * first would overwrite that evidence.
 */

import { getSupabaseClient } from '@/lib/supabase/client'
import { log } from '@/lib/logger'
import { UNKNOWN_ACTION } from '@/lib/solidworks/types'

import {
  compareOwnedMetadata,
  readDatabaseMetadata,
  summarizeDivergence,
  CONFIG_DESCRIPTIONS_KEY,
  CONFIG_TABS_KEY,
  type ComparedFileType,
  type DivergenceSummary,
  type FileDivergence,
  type FileRowMetadata,
} from './divergence'

// ============================================
// Constants
// ============================================

/**
 * Bumped whenever the artifact's shape changes, so a later repair phase can refuse a stale one.
 *
 * 2 - every comparison carries `databaseRepairValue`, the value a repair phase may actually
 * write, which is not always what the document reads as; `recoverability` gained `unattributed`
 * for values the file holds and the database has no claim to; the configuration-map coverage
 * records whether the reserved map exists as well as how many entries it has. A version 1 report
 * classified some of those values as `recoverable`, so acting on one would write values BluePLM
 * never owned.
 */
export const DIVERGENCE_REPORT_SCHEMA_VERSION = 2

/** Supabase caps a single response; rows are pulled in pages of this size. */
const ROW_PAGE_SIZE = 1000

/** Models carry the configuration maps this scan is mostly about. */
const MODEL_EXTENSIONS = ['.sldprt', '.sldasm'] as const

/** Drawings reverse the ownership of `revision`, so they are opt-in rather than default. */
const DRAWING_EXTENSION = '.slddrw'

/**
 * The only folder whose files are hashed before and after by default. Mirrors
 * `RegressionFixtureGuard.DefaultFixtureRoot` in the SolidWorks service, which is the authority
 * for anything that writes; this copy exists only to decide which files get an integrity check.
 */
export const REGRESSION_FIXTURE_ROOT = 'C:\\BluePLM\\br-vault\\0 - SHARED\\00 - REGRESSION TESTS'

/** How often progress is reported while walking a large vault. */
const PROGRESS_INTERVAL = 25

// ============================================
// Types
// ============================================

/** Knobs the terminal command exposes. */
export interface DivergenceScanOptions {
  orgId: string
  vaultId: string | null
  vaultPath: string
  /** Only scan files whose relative path starts with this, case-insensitively. */
  pathPrefix?: string
  /**
   * Only scan rows whose `custom_properties` carries a reserved configuration map.
   *
   * Six of every seven models in a real vault have a single configuration, and the wipe this scan
   * exists to measure can only have taken something from a row that once described its
   * configurations. Restricting the walk to rows carrying `_config_tabs` or `_config_descriptions`
   * therefore keeps the findings and drops most of the cost - including rows whose map is present
   * and empty, which is exactly what a total wipe leaves behind.
   *
   * Its blind spot, which the caller must state rather than hide: a multi-configuration file whose
   * row never carried a map is skipped. Nothing was lost from a map that never existed, so those
   * files can only produce `no-evidence` and `unattributed` values.
   */
  configurationRecordedOnly?: boolean
  /**
   * Absolute paths, lower-cased, that SolidWorks currently has open.
   *
   * Pointing Document Manager at a document SolidWorks is holding can make SolidWorks close it, so
   * those files are recorded as unread rather than opened. One query answers this for the whole
   * vault; asking per file would mean thousands of COM round-trips, which is the cost this scan
   * routes around in the first place.
   */
  openInSolidWorks?: ReadonlySet<string>
  /** Stop after this many files. Undefined scans the whole vault. */
  limit?: number
  /** Include drawings. Off by default - a drawing's revision is file-owned, so it needs its own rules. */
  includeDrawings?: boolean
  /** Hash every scanned file before and after the read, not just the ones under the fixture root. */
  verifyHashesEverywhere?: boolean
  /**
   * Time the read-back cycle after the walk, on the file with the most configurations and on a
   * single-configuration one. Zero skips the measurement.
   */
  timingRepeats?: number
  /** Called with human-readable progress. */
  onProgress?: (message: string) => void
  /**
   * Called after every file with the running count, for a progress bar.
   *
   * Separate from `onProgress`, which reports in prose every twenty-fifth file. A bar needs a
   * number after each one, and a caller that renders on every call would render thousands of
   * times, so throttling is the caller's job.
   */
  onFileProgress?: (completed: number, total: number) => void
  /** Checked between files so a long scan can be stopped. */
  shouldCancel?: () => boolean
}

/**
 * The running service does not have `getPropertiesDocumentManager` at all.
 *
 * Distinct from a file that could not be read, and handled differently: every remaining file would
 * fail the same way, so the scan stops instead of producing a report that reads like a vault-wide
 * finding. The caller checks the service version before starting for exactly this reason; this is
 * what happens if that check is wrong.
 */
export class SwServiceCommandMissingError extends Error {
  constructor(action: string) {
    super(`The SolidWorks service does not have the "${action}" command. Rebuild it.`)
    this.name = 'SwServiceCommandMissingError'
  }
}

/** A file the scan could not compare, and why. */
export interface UnreadableFile {
  fileId: string
  relativePath: string
  reason: 'missing-on-disk' | 'read-failed' | 'open-in-solidworks'
  detail?: string
}

/** A file whose bytes were not identical before and after being read. */
export interface IntegrityBreach {
  relativePath: string
  hashBefore: string
  hashAfter: string
}

/** Timing for one open-and-read-every-scope cycle, which is what a verified write's read-back costs. */
export interface ReadBackTiming {
  relativePath: string
  configurationCount: number
  fileSizeBytes: number | null
  samplesMs: number[]
  minMs: number
  medianMs: number
  maxMs: number
}

/** The machine-readable artifact a later repair phase consumes. */
export interface DivergenceReport {
  schemaVersion: number
  generatedAt: string
  scope: {
    orgId: string
    vaultId: string | null
    vaultPath: string
    pathPrefix: string | null
    limit: number | null
    includeDrawings: boolean
    configurationRecordedOnly: boolean
  }
  counts: {
    rowsFetched: number
    rowsConsidered: number
    filesCompared: number
    filesMissingOnDisk: number
    filesUnreadable: number
    filesOpenInSolidWorks: number
  }
  summary: DivergenceSummary
  files: FileDivergence[]
  unreadable: UnreadableFile[]
  integrity: {
    filesHashed: number
    breaches: IntegrityBreach[]
  }
  readBackTimings: ReadBackTiming[]
  /** Wall-clock cost of the scan, so a later run can be budgeted. */
  durationMs: number
  cancelled: boolean
}

/** One row, narrowed to what the comparison needs. */
interface ScanRow extends FileRowMetadata {
  id: string
  file_path: string
  file_name: string
  extension: string | null
}

// ============================================
// Path helpers
// ============================================

function normalizeSeparators(value: string): string {
  return value.replace(/\//g, '\\')
}

/** Absolute path of a row's file inside the working copy. */
export function resolveAbsolutePath(vaultPath: string, relativePath: string): string {
  const root = normalizeSeparators(vaultPath).replace(/\\+$/, '')
  const relative = normalizeSeparators(relativePath).replace(/^\\+/, '')
  return `${root}\\${relative}`
}

/**
 * Whether a path sits under the regression fixture root.
 *
 * Deliberately conservative: it compares normalised, lower-cased prefixes with a trailing
 * separator so a sibling folder whose name merely starts with the root does not match. It does not
 * resolve junctions - the C# `RegressionFixtureGuard` does that, and it has to, because it gates
 * writes. This one only decides whether to spend time hashing a file, so a false negative costs a
 * check and a false positive costs nothing.
 */
export function isInsideFixtureRoot(absolutePath: string, root = REGRESSION_FIXTURE_ROOT): boolean {
  const candidate = normalizeSeparators(absolutePath).toLowerCase()
  const normalizedRoot = normalizeSeparators(root).replace(/\\+$/, '').toLowerCase()
  return candidate.startsWith(`${normalizedRoot}\\`)
}

function extensionOf(row: ScanRow): string {
  const fromColumn = row.extension?.toLowerCase()
  if (fromColumn) return fromColumn.startsWith('.') ? fromColumn : `.${fromColumn}`
  const dot = row.file_name.lastIndexOf('.')
  return dot === -1 ? '' : row.file_name.slice(dot).toLowerCase()
}

function fileTypeOf(extension: string): ComparedFileType {
  if (extension === '.sldprt') return 'part'
  if (extension === '.sldasm') return 'assembly'
  if (extension === DRAWING_EXTENSION) return 'drawing'
  return 'other'
}

// ============================================
// Database read (SELECT only)
// ============================================

function toCustomProperties(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Page through the `files` rows in scope.
 *
 * A plain `select` rather than the `get_vault_files_fast` RPC the app normally uses: the scanner
 * must not call any RPC, so that a reviewer checking this file for a write does not have to go
 * and read a database function to be sure.
 */
async function fetchRows(options: DivergenceScanOptions): Promise<ScanRow[]> {
  const client = getSupabaseClient()
  const rows: ScanRow[] = []

  for (let page = 0; ; page++) {
    let query = client
      .from('files')
      .select('id, file_path, file_name, extension, part_number, description, revision, custom_properties')
      .eq('org_id', options.orgId)
      .is('deleted_at', null)
      .order('file_path', { ascending: true })
      .range(page * ROW_PAGE_SIZE, (page + 1) * ROW_PAGE_SIZE - 1)

    if (options.vaultId) query = query.eq('vault_id', options.vaultId)

    const { data, error } = await query
    if (error) throw new Error(`Reading files failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const record of data) {
      rows.push({
        id: record.id,
        file_path: record.file_path,
        file_name: record.file_name,
        extension: record.extension,
        part_number: record.part_number,
        description: record.description,
        revision: record.revision,
        custom_properties: toCustomProperties(record.custom_properties),
      })
    }

    if (data.length < ROW_PAGE_SIZE) break
  }

  return rows
}

// ============================================
// File read (Document Manager, read-only)
// ============================================

interface DocumentProperties {
  configurations: string[]
  fileProperties: Record<string, string>
  configurationProperties: Record<string, Record<string, string>>
}

/**
 * Read every owned scope of a document in one open.
 *
 * `getProperties` returns the file-level bag, every configuration's bag and the configuration
 * list together, so this is a single Document Manager open covering all scopes - the same shape a
 * verified write's read-back would take, which is why `measureReadBack` can time it and get a
 * number phase 4 can use.
 */
async function readDocument(absolutePath: string): Promise<DocumentProperties> {
  const api = window.electronAPI?.solidworks
  if (!api?.getPropertiesDocumentManager) {
    throw new Error('The SolidWorks service is not available')
  }

  const result = await api.getPropertiesDocumentManager(absolutePath)
  if (result?.errorCode === UNKNOWN_ACTION) {
    throw new SwServiceCommandMissingError('getPropertiesDocumentManager')
  }
  if (!result?.success || !result.data) {
    throw new Error(result?.error ?? 'No response from the SolidWorks service')
  }

  const configurationProperties = result.data.configurationProperties ?? {}
  const configurations =
    result.data.configurations && result.data.configurations.length > 0
      ? result.data.configurations
      : Object.keys(configurationProperties)

  return {
    configurations,
    fileProperties: result.data.fileProperties ?? {},
    configurationProperties,
  }
}

/**
 * Refuse to start unless the Document Manager library is actually reachable.
 *
 * `getServiceStatus` only reports; it starts nothing and opens nothing.
 */
async function assertDocumentManagerAvailable(): Promise<void> {
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  if (!status?.success || !status.data?.running) {
    throw new Error('The SolidWorks service is not running. Start it in Settings > Integrations.')
  }
  if (status.data.documentManagerAvailable === false) {
    throw new Error(
      status.data.documentManagerError ??
        'The Document Manager licence is not configured, so files cannot be read.',
    )
  }
}

async function hashOf(absolutePath: string): Promise<string | null> {
  const result = await window.electronAPI?.hashFile?.(absolutePath)
  return result?.success ? (result.hash ?? null) : null
}

// ============================================
// Read-back cost measurement
// ============================================

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Time the open-and-read-all-scopes cycle a verified write would have to pay for.
 *
 * The plan marks this the largest unmeasured quantity in the design and phase 4 is built around
 * it, so it is measured on real files rather than assumed - including a multi-configuration one,
 * because the open question is whether the cost scales with the configuration count or is flat.
 */
export async function measureReadBack(
  absolutePath: string,
  relativePath: string,
  repeats: number,
): Promise<ReadBackTiming> {
  const samplesMs: number[] = []
  let configurationCount = 0
  const attempts = Math.max(1, repeats)

  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = performance.now()
    const document = await readDocument(absolutePath)
    samplesMs.push(performance.now() - started)
    configurationCount = document.configurations.length
  }

  const stat = await window.electronAPI?.statFile?.(absolutePath)
  const fileSizeBytes = stat?.success && typeof stat.size === 'number' ? stat.size : null

  return {
    relativePath,
    configurationCount,
    fileSizeBytes,
    samplesMs: samplesMs.map((value) => Math.round(value)),
    minMs: Math.round(Math.min(...samplesMs)),
    medianMs: Math.round(median(samplesMs)),
    maxMs: Math.round(Math.max(...samplesMs)),
  }
}

// ============================================
// The scan
// ============================================

/**
 * Time the read-back on the two files that bracket the open question.
 *
 * The plan assumes verification costs one open-and-read cycle regardless of configuration count,
 * on the strength of a measurement that all 68 configurations *write* in one cycle. Timing the
 * heaviest multi-configuration file the scan saw against a single-configuration one is what turns
 * that assumption into a number - if the two are close, the cost is flat and phase 4's design
 * holds; if the heavy one scales with the configuration count, verification has to be asynchronous.
 */
async function timeReadBack(
  files: readonly FileDivergence[],
  vaultPath: string,
  repeats: number,
  report: (message: string) => void,
): Promise<ReadBackTiming[]> {
  if (repeats <= 0 || files.length === 0) return []

  const byConfigCount = [...files].sort(
    (a, b) => b.configurations.length - a.configurations.length,
  )
  const heaviest = byConfigCount[0]
  const lightest = [...byConfigCount]
    .reverse()
    .find((file) => file.configurations.length <= 1)

  const targets = [heaviest, lightest].filter(
    (file, index, all): file is FileDivergence =>
      file !== undefined && all.findIndex((other) => other?.fileId === file.fileId) === index,
  )

  const timings: ReadBackTiming[] = []
  for (const target of targets) {
    report(`Timing the read-back on ${target.relativePath}...`)
    try {
      timings.push(
        await measureReadBack(
          resolveAbsolutePath(vaultPath, target.relativePath),
          target.relativePath,
          repeats,
        ),
      )
    } catch (error) {
      log.warn('[DivergenceScan]', 'Read-back timing failed', {
        relativePath: target.relativePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return timings
}

/**
 * Whether the row's `custom_properties` carries either reserved configuration map.
 *
 * The key's presence, not its size, for the same reason `classifyRecoverability` turns on it: a
 * map that is present and empty is a row that has lost every configuration it described, and
 * dropping it from the scan would hide the most complete instance of the thing being measured.
 */
function recordsConfigurations(row: ScanRow): boolean {
  const properties = row.custom_properties
  if (!properties) return false
  return CONFIG_TABS_KEY in properties || CONFIG_DESCRIPTIONS_KEY in properties
}

function inScope(row: ScanRow, options: DivergenceScanOptions): boolean {
  const extension = extensionOf(row)
  const isModel = (MODEL_EXTENSIONS as readonly string[]).includes(extension)
  const isDrawing = extension === DRAWING_EXTENSION

  if (!isModel && !(options.includeDrawings && isDrawing)) return false

  if (options.pathPrefix) {
    const prefix = normalizeSeparators(options.pathPrefix).toLowerCase()
    if (!normalizeSeparators(row.file_path).toLowerCase().startsWith(prefix)) return false
  }

  if (options.configurationRecordedOnly && !recordsConfigurations(row)) return false

  return true
}

/** Walk the vault, compare every row against its file, and return the report. */
export async function runDivergenceScan(
  options: DivergenceScanOptions,
): Promise<DivergenceReport> {
  const startedAt = performance.now()
  const report = (message: string) => options.onProgress?.(message)

  // Without this the scan still "succeeds" and reports every file as unreadable, which reads like
  // a vault-wide finding rather than a service that was not running.
  await assertDocumentManagerAvailable()

  report('Reading file rows from the database...')
  const allRows = await fetchRows(options)
  const scoped = allRows.filter((row) => inScope(row, options))
  const rows = options.limit ? scoped.slice(0, options.limit) : scoped

  report(`${allRows.length} rows fetched, ${rows.length} in scope.`)

  const files: FileDivergence[] = []
  const unreadable: UnreadableFile[] = []
  const breaches: IntegrityBreach[] = []
  let filesHashed = 0
  let missingOnDisk = 0
  let openInSolidWorks = 0
  let cancelled = false

  // A file that was skipped still moved the walk along, so every path out of the loop body reports
  // it. A bar that stalls on a run of missing files reads as a hang, which is the thing progress
  // exists to rule out.
  const advance = (index: number): void => {
    options.onFileProgress?.(index + 1, rows.length)
    if ((index + 1) % PROGRESS_INTERVAL === 0) {
      report(`${index + 1}/${rows.length} files read...`)
    }
  }

  for (const [index, row] of rows.entries()) {
    if (options.shouldCancel?.()) {
      cancelled = true
      break
    }

    const absolutePath = resolveAbsolutePath(options.vaultPath, row.file_path)

    if (options.openInSolidWorks?.has(absolutePath.toLowerCase())) {
      openInSolidWorks += 1
      unreadable.push({
        fileId: row.id,
        relativePath: row.file_path,
        reason: 'open-in-solidworks',
      })
      advance(index)
      continue
    }

    const exists = await window.electronAPI?.fileExists?.(absolutePath)
    if (!exists) {
      missingOnDisk += 1
      unreadable.push({ fileId: row.id, relativePath: row.file_path, reason: 'missing-on-disk' })
      advance(index)
      continue
    }

    // Fixture files are shared and must stay byte-identical. Hashing on both sides of the read
    // turns "the scanner does not write" from a claim into something the report can evidence.
    const shouldHash =
      options.verifyHashesEverywhere === true || isInsideFixtureRoot(absolutePath)
    const hashBefore = shouldHash ? await hashOf(absolutePath) : null

    try {
      const document = await readDocument(absolutePath)
      const extension = extensionOf(row)

      files.push(
        compareOwnedMetadata(
          {
            fileId: row.id,
            relativePath: row.file_path,
            fileName: row.file_name,
            fileType: fileTypeOf(extension),
          },
          readDatabaseMetadata(row),
          document,
        ),
      )
    } catch (error) {
      // Not a property of this file, and true of every remaining one. Recording it per file would
      // turn one fact about the service into thousands of findings about the vault.
      if (error instanceof SwServiceCommandMissingError) throw error

      unreadable.push({
        fileId: row.id,
        relativePath: row.file_path,
        reason: 'read-failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    if (hashBefore) {
      filesHashed += 1
      const hashAfter = await hashOf(absolutePath)
      if (hashAfter && hashAfter !== hashBefore) {
        breaches.push({ relativePath: row.file_path, hashBefore, hashAfter })
        log.error('[DivergenceScan]', 'A file changed while being read', {
          relativePath: row.file_path,
        })
      }
    }

    advance(index)
  }

  const readBackTimings = cancelled
    ? []
    : await timeReadBack(files, options.vaultPath, options.timingRepeats ?? 0, report)

  return {
    schemaVersion: DIVERGENCE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    scope: {
      orgId: options.orgId,
      vaultId: options.vaultId,
      vaultPath: options.vaultPath,
      pathPrefix: options.pathPrefix ?? null,
      limit: options.limit ?? null,
      includeDrawings: options.includeDrawings === true,
      configurationRecordedOnly: options.configurationRecordedOnly === true,
    },
    counts: {
      rowsFetched: allRows.length,
      rowsConsidered: rows.length,
      filesCompared: files.length,
      filesMissingOnDisk: missingOnDisk,
      filesUnreadable: unreadable.filter((entry) => entry.reason === 'read-failed').length,
      filesOpenInSolidWorks: openInSolidWorks,
    },
    summary: summarizeDivergence(files),
    files,
    unreadable,
    integrity: { filesHashed, breaches },
    readBackTimings,
    durationMs: Math.round(performance.now() - startedAt),
    cancelled,
  }
}
