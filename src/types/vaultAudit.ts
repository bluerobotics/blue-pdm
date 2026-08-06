/**
 * Vault audit - the shapes the settings page renders.
 *
 * The audit is a presentation of `lib/metadata/divergenceScan`'s report. Nothing here re-decides
 * what a value means: the categories below are the scanner's own `Recoverability` states under
 * names an administrator can act on, and the mapping between the two is in
 * `features/settings/system/vault-audit/vaultAuditView.ts`.
 *
 * Read-only by construction. `VaultAuditRepairTarget` is the single seam a repair tool attaches
 * to, and nothing in this module or the page behind it performs one.
 */

import type {
  OwnedField,
  UnattributedReason,
  MetadataScope,
  FieldTally,
} from '@/lib/metadata/divergence'

// ============================================
// Scope
// ============================================

/** Which part of the vault a run covers. */
export type VaultAuditScopeKind =
  /** Every part and assembly the organisation has a row for. */
  | 'whole-vault'
  /** One folder and everything beneath it. */
  | 'folder'
  /**
   * Only rows whose `custom_properties` already carries a reserved configuration map.
   *
   * Six of every seven models carry a single configuration, and a configuration map can only have
   * lost something if it existed, so this covers the findings the wipe produced at a fraction of
   * the cost. It cannot see a multi-configuration file the database never recorded, which the page
   * says out loud rather than leaving the reader to infer.
   */
  | 'configuration-recorded'

export interface VaultAuditScope {
  kind: VaultAuditScopeKind
  /** Vault-relative folder path, used only when `kind` is `folder`. */
  folderPath: string
}

export const DEFAULT_VAULT_AUDIT_SCOPE: VaultAuditScope = {
  kind: 'configuration-recorded',
  folderPath: '',
}

// ============================================
// Run state
// ============================================

export type VaultAuditRunState = 'running' | 'complete' | 'cancelled' | 'failed'

/** How far a running scan has got. Both numbers are files, not rows. */
export interface VaultAuditProgress {
  completed: number
  total: number
  /** The scanner's own prose, shown while `total` is still unknown. */
  message: string
}

// ============================================
// Findings
// ============================================

/**
 * The four things that can be true of one value, ordered by how little can be done about it.
 *
 * They partition the scanner's `Recoverability`: `intact` and `no-evidence` are not findings and
 * are reported as counts elsewhere. Because they partition it, a value appears in exactly one
 * category and the totals add up.
 */
export type VaultAuditCategoryKind =
  /** Neither the database nor the file holds it any more. No tool can bring it back. */
  | 'lost'
  /** Both hold a value and they differ. A person has to choose; a wrong choice writes bad data. */
  | 'conflicting'
  /** Gone from the database, still in the file under the key BluePLM writes. Mechanically fixable. */
  | 'recoverable'
  /** In the file, never the database's to hold. Adopting one invents data rather than restoring it. */
  | 'unattributed'

/** Drives colour only; the ordering is the array order from `buildVaultAuditView`. */
export type VaultAuditTone = 'critical' | 'warning' | 'repairable' | 'neutral'

export interface VaultAuditCategory {
  kind: VaultAuditCategoryKind
  tone: VaultAuditTone
  /** Individual values in this category. */
  valueCount: number
  /** Distinct files holding at least one of them. */
  fileCount: number
}

/** One value, in one file, at one scope. */
export interface VaultAuditFinding {
  /** Stable across renders and unique within a report. */
  id: string
  kind: VaultAuditCategoryKind
  fileId: string
  relativePath: string
  fileName: string
  field: OwnedField
  scope: MetadataScope
  /** Configuration name for configuration-scope findings, null at file scope. */
  configuration: string | null
  databaseValue: string | null
  fileValue: string | null
  /**
   * What a repair could put in the database, read only from the keys BluePLM itself writes. Null
   * when the file holds nothing that can be transcribed without guessing what it means.
   */
  repairValue: string | null
  /** Set only on `unattributed` findings. */
  unattributedReason: UnattributedReason | null
}

// ============================================
// Configuration coverage
// ============================================

/**
 * One file whose database record and whose configurations do not line up.
 *
 * Compared by name throughout. Comparing counts is the trap this measurement exists to avoid: a
 * record holding twenty-six entries for a file with fifteen configurations looks damaged by count
 * and is intact by name, because the eleven extra entries are keys for configurations that were
 * deleted or renamed. Those are `staleKeyCount` and they are not a loss.
 */
export interface VaultAuditFileCoverage {
  fileId: string
  relativePath: string
  fileName: string
  configurationCount: number
  /** Configurations the file has that the database record does not describe. */
  undescribedConfigurations: string[]
  /** Record keys naming configurations the file no longer has. */
  staleKeys: string[]
  /** The record exists and describes nothing - what a wipe of every configuration leaves. */
  recordEmptied: boolean
}

/** The configuration-map picture across the whole run. */
export interface VaultAuditCoverage {
  /** Files whose record describes fewer configurations, by name, than the file has. */
  filesWithUndescribedConfigurations: number
  /** Total configuration entries missing across those files. */
  undescribedConfigurationCount: number
  /** Files carrying record keys for configurations that no longer exist. */
  filesWithStaleKeys: number
  staleKeyCount: number
  /** Files whose record was emptied outright. */
  filesWithEmptiedRecord: number
  /**
   * Files that have configurations and whose row carries no configuration record at all. Left out
   * of every number above: nothing can be lost from a record that never existed.
   */
  filesWithNoRecord: number
  /** Per-file detail, worst first. */
  files: VaultAuditFileCoverage[]
}

// ============================================
// The view
// ============================================

/** Files the run could not compare, and how many of each reason. */
export interface VaultAuditUnread {
  missingOnDisk: number
  openInSolidWorks: number
  readFailed: number
}

/** Evidence that the run changed nothing. */
export interface VaultAuditIntegrity {
  filesHashed: number
  filesChanged: number
  changedPaths: string[]
}

/** Everything the page renders, derived from one report. */
export interface VaultAuditView {
  generatedAt: string
  durationMs: number
  cancelled: boolean
  scopeDescription: {
    pathPrefix: string | null
    configurationRecordedOnly: boolean
    includeDrawings: boolean
  }
  filesCompared: number
  filesWithFindings: number
  filesWithMultipleConfigurations: number
  /** Values absent from both sides on a row that never described the file. Absence, not loss. */
  noEvidenceValues: number
  unread: VaultAuditUnread
  integrity: VaultAuditIntegrity
  coverage: VaultAuditCoverage
  /** Ordered worst first. Always holds all four kinds, including empty ones. */
  categories: VaultAuditCategory[]
  findings: VaultAuditFinding[]
  /** The scanner's per-field breakdown, passed through unchanged. */
  fieldTallies: FieldTally[]
}

// ============================================
// The repair seam
// ============================================

/**
 * The one address a repair tool needs, and the only thing this feature will ever hand it.
 *
 * Deliberately narrow. It names a value and the string a repair may write, and carries no
 * instruction about what to do with either - the decision of whether a value may be written stays
 * with the repair tool, which is the thing that has been designed to make it. `repairValue` comes
 * from the scanner's `databaseRepairValue`, so it is a value BluePLM's own writers produced rather
 * than whatever the document happened to read as.
 *
 * The audit never calls a handler itself; the button that would is disabled until a repair tool
 * supplies one.
 */
export interface VaultAuditRepairTarget {
  fileId: string
  relativePath: string
  field: OwnedField
  configuration: string | null
  repairValue: string | null
}

/** Supplied by a repair tool. Absent everywhere in the audit today. */
export type VaultAuditRepairHandler = (target: VaultAuditRepairTarget) => void
