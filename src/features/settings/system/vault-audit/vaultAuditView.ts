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
 * can be recovered and from where. This maps its seven `Recoverability` states onto five
 * categories and drops the two that are not findings, then names the resolution each category
 * admits by consulting the same ownership table the scanner used. It never looks at a pair of
 * values and forms its own opinion, so a category is never wrong in a way the report was not
 * already wrong.
 *
 * **Configurations are compared by name, never by count.** The count comparison is the trap the
 * vault census turned up: one part carries twenty-six configuration entries in the database against
 * fifteen configurations in the file. By count that record has lost eleven entries and the file is
 * damaged. By name it describes every configuration the file has, plus eleven keys for
 * configurations that were deleted or renamed - and the file is intact. Those leftover keys are
 * counted as `staleKeys`, which is housekeeping, and they are never added to anything called a
 * loss. Every number below comes from `ConfigMapCoverage`, whose own membership tests are by name.
 */

import { ownerOf } from '@/lib/metadata/divergence'
import type {
  ComparedFileType,
  ConfigMapCoverage,
  FieldComparison,
  FileDivergence,
  OwnedField,
  Recoverability,
} from '@/lib/metadata/divergence'
import type { DivergenceReport } from '@/lib/metadata/divergenceScan'
import type {
  VaultAuditCategory,
  VaultAuditCategoryKind,
  VaultAuditCoverage,
  VaultAuditFileCoverage,
  VaultAuditFinding,
  VaultAuditResolution,
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
  'absent-from-file',
  'unattributed',
]

/**
 * Colour by how settled the answer is, not by how alarming the count looks.
 *
 * `recoverable` and `absent-from-file` share a tone deliberately: they are opposite directions of
 * the same unambiguous case, one copy present and one absent, and neither asks anything of the
 * person reading them beyond agreeing to the write.
 */
const CATEGORY_TONES: Record<VaultAuditCategoryKind, VaultAuditTone> = {
  lost: 'critical',
  conflicting: 'warning',
  recoverable: 'repairable',
  'absent-from-file': 'repairable',
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
    case 'absent-from-file':
      return 'absent-from-file'
    case 'unattributed':
      return 'unattributed'
    case 'intact':
    case 'no-evidence':
      return null
  }
}

// ============================================
// Resolutions
// ============================================

/**
 * What resolving one finding would consist of.
 *
 * Only two writes exist - the file's value into the database, or the database's into the file -
 * and most of the work here is saying which findings have neither available. Nothing is
 * re-decided: the category comes from the scanner and the owner comes from `ownerOf`, and this
 * reads the pair rather than looking at the values again.
 *
 * The ownership table settles two cases the category alone leaves open. A file states its own
 * revision, so the file wins a conflict about one outright and there is nothing for a person to
 * choose. A drawing's part number and description are copies of the parent model's, so neither
 * copy is the record and writing either over the other leaves the disagreement where it started -
 * on the model.
 *
 * That second rule governs the direction that would take the *file's* value as authoritative, and
 * only that direction. A drawing whose title block is missing a part number the row already holds
 * is not an argument about which copy is right: the row's copy came from the model in the first
 * place, and putting it in the document is how a projection is meant to arrive.
 */
export function resolutionOf(
  kind: VaultAuditCategoryKind,
  field: OwnedField,
  fileType: ComparedFileType,
): VaultAuditResolution {
  // Neither of these reads the file's value as evidence, so neither can be misled by a projection.
  if (kind === 'lost') return 'nothing-to-restore'
  if (kind === 'absent-from-file') {
    // Revision is file-owned. A database-only revision must not be pushed into a document that
    // does not carry one; there is no file value for the audit to promote instead.
    return field === 'revision' ? 'file-is-authoritative' : 'push-vault-value'
  }

  const owner = ownerOf(field, fileType)
  if (owner === 'parent-model') return 'fix-on-parent-model'

  switch (kind) {
    case 'conflicting':
      return owner === 'file' ? 'adopt-file-value' : 'choose-a-side'
    case 'recoverable':
      return 'adopt-file-value'
    case 'unattributed':
      return 'leave-alone'
  }
}

// ============================================
// What the document is supposed to carry at all
// ============================================

/**
 * Reading choices that change which comparisons count as findings, without changing the scan.
 *
 * Applied here rather than in the scanner on purpose. The report is the measurement and it stays
 * complete: every comparison is in the artifact whatever these say, so turning one of these on is
 * instant and turning it off does not cost another three-minute walk of the vault. A rule that
 * lived in `divergence.ts` would bake an opinion about one shop's convention into the evidence.
 */
export interface VaultAuditViewOptions {
  /**
   * Expect a part or an assembly document to carry a `Revision` property.
   *
   * Off by default, because in a vault where drawings drive revisions the model never carries one
   * and BluePLM's row holding `A` against a model that states nothing is the intended state rather
   * than a document that has fallen behind. On such a vault this is the single largest source of
   * findings and all of them are noise. When enabled, revision remains file-owned: the audit may
   * read it into BluePLM, but never writes BluePLM's value into the document.
   *
   * Drawings are unaffected either way - their revision is always file-owned.
   */
  expectRevisionOnModels: boolean
}

export const DEFAULT_VAULT_AUDIT_VIEW_OPTIONS: VaultAuditViewOptions = {
  expectRevisionOnModels: false,
}

/**
 * Whether this kind of document is supposed to hold this field at all.
 *
 * Distinct from ownership, which asks who wins when both sides hold something. This asks the prior
 * question: a model that carries no revision under a drawing-driven convention is not empty, it is
 * correct, and no comparison of the two values can say anything useful about it.
 */
export function documentCarriesField(
  field: OwnedField,
  fileType: ComparedFileType,
  options: VaultAuditViewOptions,
): boolean {
  if (field !== 'revision') return true
  if (fileType === 'drawing') return true
  return options.expectRevisionOnModels
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
    resolution: resolutionOf(kind, comparison.field, file.fileType),
    fileId: file.fileId,
    relativePath: file.relativePath,
    fileName: file.fileName,
    fileType: file.fileType,
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
export function buildVaultAuditView(
  report: DivergenceReport,
  options: VaultAuditViewOptions = DEFAULT_VAULT_AUDIT_VIEW_OPTIONS,
): VaultAuditView {
  const findings: VaultAuditFinding[] = []
  const valueCounts = new Map<VaultAuditCategoryKind, number>()
  const filesPerCategory = new Map<VaultAuditCategoryKind, Set<string>>()
  const filesWithFindings = new Set<string>()
  let noEvidenceValues = 0
  let revisionOnModelsHidden = 0

  for (const file of report.files) {
    for (const comparison of file.fieldComparisons) {
      if (comparison.recoverability === 'no-evidence') noEvidenceValues += 1

      const kind = categoryOf(comparison.recoverability)
      if (!kind) continue

      // Counted before it is dropped, and reported. A filter whose effect is invisible is how a
      // page comes to show a reassuring number over values it decided not to mention.
      if (!documentCarriesField(comparison.field, file.fileType, options)) {
        revisionOnModelsHidden += 1
        continue
      }

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
    rowsInScope: report.counts.rowsInScope,
    filesCompared: report.counts.filesCompared,
    filesWithFindings: filesWithFindings.size,
    filesWithMultipleConfigurations: report.summary.filesWithMultipleConfigurations,
    noEvidenceValues,
    revisionOnModelsHidden,
    // Passed through rather than derived from `rowsInScope - filesCompared`: that difference also
    // contains the files the run tried to read and could not, which are a different statement and
    // already have their own line.
    notCompared: {
      total: report.counts.rowsSkippedNoConfigurationRecord + report.counts.rowsSkippedByLimit,
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

/**
 * Whether the run opened anything, and so whether its zeroes mean anything.
 *
 * Every summary the page draws is a count over compared files, and every one of them reads as
 * reassurance at zero: no findings, no undescribed configurations, no stale keys, records "aligned"
 * in green. A run whose folder path matched no row produces exactly that picture, which is how a
 * scope typo came to look like a healthy folder. Sections that can only say something true about
 * files that were read are gated on this.
 */
export function hasEvidence(view: VaultAuditView): boolean {
  return view.rowsInScope > 0 && view.filesCompared > 0
}
