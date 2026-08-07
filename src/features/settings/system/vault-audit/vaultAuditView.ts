/**
 * Turn one divergence report into what the Vault Audit page shows.
 *
 * Pure: no I/O, no store, no React. That is deliberate, because this is where the report's
 * vocabulary is translated into an administrator's, and a translation is exactly the kind of thing
 * that goes quietly wrong. Keeping it callable from a test is what makes the two claims below
 * checkable rather than asserted.
 *
 * ## Two rules this module keeps
 *
 * **Nothing is re-decided here.** The scanner has already worked out, for every value, whether it
 * can be recovered and from where. This maps its five `Recoverability` states onto four categories
 * and drops the two that are not findings; it never looks at a pair of values and forms its own
 * opinion. A category is therefore never wrong in a way the report was not already wrong.
 *
 * **Configurations are compared by name, never by count.** The count comparison is the trap the
 * vault census turned up: one part carries twenty-six configuration entries in the database against
 * fifteen configurations in the file. By count that record has lost eleven entries and the file is
 * damaged. By name it describes every configuration the file has, plus eleven keys for
 * configurations that were deleted or renamed - and the file is intact. Those leftover keys are
 * counted as `staleKeys`, which is housekeeping, and they are never added to anything called a
 * loss. Every number below comes from `ConfigMapCoverage`, whose own membership tests are by name.
 */

import type {
  ConfigMapCoverage,
  FieldComparison,
  FileDivergence,
  Recoverability,
} from '@/lib/metadata/divergence'
import type { DivergenceReport } from '@/lib/metadata/divergenceScan'
import type {
  VaultAuditCategory,
  VaultAuditCategoryKind,
  VaultAuditCoverage,
  VaultAuditFileCoverage,
  VaultAuditFinding,
  VaultAuditTone,
  VaultAuditView,
} from '@/types/vaultAudit'

// ============================================
// Ordering
// ============================================

/**
 * Worst first, ordered by how little can be done rather than by how many there are.
 *
 * `lost` leads because it is the only irreversible one: no tool, this one or the repair tool that
 * follows it, can produce a value neither side holds. `conflicting` is next because both copies
 * survive but resolving one means a person choosing which is right, and a wrong choice writes the
 * wrong value into a file other people read from. `recoverable` follows: real damage, but the
 * source is known-good and the fix is mechanical. `unattributed` is last because it is not damage
 * at all - the file holds something the database never owned, and acting on it would invent
 * database state rather than restore it.
 */
const CATEGORY_ORDER: readonly VaultAuditCategoryKind[] = [
  'lost',
  'conflicting',
  'recoverable',
  'unattributed',
]

const CATEGORY_TONES: Record<VaultAuditCategoryKind, VaultAuditTone> = {
  lost: 'critical',
  conflicting: 'warning',
  recoverable: 'repairable',
  unattributed: 'neutral',
}

/**
 * The scanner's recoverability under the name the page uses, or null when it is not a finding.
 *
 * `intact` is agreement. `no-evidence` is both sides holding nothing on a row that never described
 * the file, which is an absence rather than a loss - it is reported as a single count so that the
 * exclusion is visible instead of silent.
 */
function categoryOf(recoverability: Recoverability): VaultAuditCategoryKind | null {
  switch (recoverability) {
    case 'unrecoverable':
      return 'lost'
    case 'disagreeing':
      return 'conflicting'
    case 'recoverable':
      return 'recoverable'
    case 'unattributed':
      return 'unattributed'
    case 'intact':
    case 'no-evidence':
      return null
  }
}

// ============================================
// Findings
// ============================================

function findingIdOf(file: FileDivergence, comparison: FieldComparison): string {
  return `${file.fileId}:${comparison.scope}:${comparison.field}:${comparison.configuration ?? ''}`
}

function toFinding(
  file: FileDivergence,
  comparison: FieldComparison,
  kind: VaultAuditCategoryKind,
): VaultAuditFinding {
  return {
    id: findingIdOf(file, comparison),
    kind,
    fileId: file.fileId,
    relativePath: file.relativePath,
    fileName: file.fileName,
    field: comparison.field,
    scope: comparison.scope,
    configuration: comparison.configuration ?? null,
    databaseValue: comparison.databaseValue,
    fileValue: comparison.fileValue,
    repairValue: comparison.databaseRepairValue,
    unattributedReason: comparison.unattributedReason ?? null,
  }
}

// ============================================
// Configuration coverage
// ============================================

function uniqueNames(...lists: readonly string[][]): string[] {
  return [...new Set(lists.flat())]
}

/**
 * Which of a file's configurations the database record fails to describe, by name.
 *
 * Only maps the row actually carries are consulted. A row with no `_config_tabs` key never
 * described this file's configurations, so counting all of them as undescribed would put every
 * part in a vault that has never used the feature into a number that is supposed to measure loss.
 */
function undescribedConfigurationsOf(coverage: ConfigMapCoverage): string[] {
  return uniqueNames(
    coverage.databaseHasTabMap ? coverage.missingTabConfigurations : [],
    coverage.databaseHasDescriptionMap ? coverage.missingDescriptionConfigurations : [],
  )
}

/** Record keys naming configurations the file no longer has. A rename or a deletion, not a loss. */
function staleKeysOf(coverage: ConfigMapCoverage): string[] {
  return uniqueNames(coverage.orphanedTabKeys, coverage.orphanedDescriptionKeys)
}

function recordEmptied(coverage: ConfigMapCoverage): boolean {
  return (
    (coverage.databaseHasTabMap && coverage.databaseTabKeyCount === 0) ||
    (coverage.databaseHasDescriptionMap && coverage.databaseDescriptionKeyCount === 0)
  )
}

function hasNoRecord(coverage: ConfigMapCoverage): boolean {
  return !coverage.databaseHasTabMap && !coverage.databaseHasDescriptionMap
}

function buildCoverage(files: readonly FileDivergence[]): VaultAuditCoverage {
  const detail: VaultAuditFileCoverage[] = []
  let filesWithUndescribedConfigurations = 0
  let undescribedConfigurationCount = 0
  let filesWithStaleKeys = 0
  let staleKeyCount = 0
  let filesWithEmptiedRecord = 0
  let filesWithNoRecord = 0

  for (const file of files) {
    const coverage = file.coverage
    const undescribed = undescribedConfigurationsOf(coverage)
    const stale = staleKeysOf(coverage)
    const emptied = recordEmptied(coverage)

    if (coverage.fileConfigurationCount > 0 && hasNoRecord(coverage)) filesWithNoRecord += 1
    if (undescribed.length > 0) {
      filesWithUndescribedConfigurations += 1
      undescribedConfigurationCount += undescribed.length
    }
    if (stale.length > 0) {
      filesWithStaleKeys += 1
      staleKeyCount += stale.length
    }
    if (emptied) filesWithEmptiedRecord += 1

    if (undescribed.length > 0 || stale.length > 0) {
      detail.push({
        fileId: file.fileId,
        relativePath: file.relativePath,
        fileName: file.fileName,
        configurationCount: coverage.fileConfigurationCount,
        undescribedConfigurations: undescribed,
        staleKeys: stale,
        recordEmptied: emptied,
      })
    }
  }

  // Undescribed configurations first: those are values the record has stopped carrying, while
  // stale keys are only clutter.
  detail.sort(
    (a, b) =>
      b.undescribedConfigurations.length - a.undescribedConfigurations.length ||
      b.staleKeys.length - a.staleKeys.length ||
      a.relativePath.localeCompare(b.relativePath),
  )

  return {
    filesWithUndescribedConfigurations,
    undescribedConfigurationCount,
    filesWithStaleKeys,
    staleKeyCount,
    filesWithEmptiedRecord,
    filesWithNoRecord,
    files: detail,
  }
}

// ============================================
// The view
// ============================================

/** Build everything the page renders from one report. */
export function buildVaultAuditView(report: DivergenceReport): VaultAuditView {
  const findings: VaultAuditFinding[] = []
  const valueCounts = new Map<VaultAuditCategoryKind, number>()
  const filesPerCategory = new Map<VaultAuditCategoryKind, Set<string>>()
  const filesWithFindings = new Set<string>()
  let noEvidenceValues = 0

  for (const file of report.files) {
    for (const comparison of file.fieldComparisons) {
      if (comparison.recoverability === 'no-evidence') noEvidenceValues += 1

      const kind = categoryOf(comparison.recoverability)
      if (!kind) continue

      findings.push(toFinding(file, comparison, kind))
      valueCounts.set(kind, (valueCounts.get(kind) ?? 0) + 1)

      let filesInCategory = filesPerCategory.get(kind)
      if (!filesInCategory) {
        filesInCategory = new Set<string>()
        filesPerCategory.set(kind, filesInCategory)
      }
      filesInCategory.add(file.fileId)
      filesWithFindings.add(file.fileId)
    }
  }

  const categories: VaultAuditCategory[] = CATEGORY_ORDER.map((kind) => ({
    kind,
    tone: CATEGORY_TONES[kind],
    valueCount: valueCounts.get(kind) ?? 0,
    fileCount: filesPerCategory.get(kind)?.size ?? 0,
  }))

  return {
    generatedAt: report.generatedAt,
    durationMs: report.durationMs,
    cancelled: report.cancelled,
    scopeDescription: {
      pathPrefix: report.scope.pathPrefix,
      configurationRecordedOnly: report.scope.configurationRecordedOnly,
      includeDrawings: report.scope.includeDrawings,
    },
    filesCompared: report.counts.filesCompared,
    filesWithFindings: filesWithFindings.size,
    filesWithMultipleConfigurations: report.summary.filesWithMultipleConfigurations,
    noEvidenceValues,
    // Passed through rather than derived from `rowsInScope - filesCompared`: that difference also
    // contains the files the run tried to read and could not, which are a different statement and
    // already have their own line.
    notCompared: {
      total:
        report.counts.rowsSkippedNoConfigurationRecord + report.counts.rowsSkippedByLimit,
      noConfigurationRecord: report.counts.rowsSkippedNoConfigurationRecord,
      beyondLimit: report.counts.rowsSkippedByLimit,
    },
    unread: {
      missingOnDisk: report.counts.filesMissingOnDisk,
      openInSolidWorks: report.counts.filesOpenInSolidWorks,
      readFailed: report.counts.filesUnreadable,
    },
    integrity: {
      filesHashed: report.integrity.filesHashed,
      filesChanged: report.integrity.breaches.length,
      changedPaths: report.integrity.breaches.map((breach) => breach.relativePath),
    },
    coverage: buildCoverage(report.files),
    categories,
    findings,
    fieldTallies: report.summary.fieldTallies,
  }
}
