/**
 * Vault audit - the shapes the settings page renders.
 *
 * The audit is a presentation of `lib/metadata/divergenceScan`'s report. Nothing here re-decides
 * what a value means: the categories below are the scanner's own `Recoverability` states under
 * names an administrator can act on, and the mapping between the two is in
 * `features/settings/system/vault-audit/vaultAuditView.ts`.
 *
 * The scan itself is read-only by construction. The repair seam at the bottom of this file is the
 * one place that is not, and everything it can do is bounded by the database function behind it
 * rather than by anything declared here.
 */

import type { ConfigMapKey } from '@/lib/metadata/configMapRepair'
import type {
  ComparedFileType,
  ConfigScopeField,
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
 * The five things that can be true of one value, ordered by how little can be done about it.
 *
 * They partition the scanner's `Recoverability`: `intact` and `no-evidence` are not findings and
 * are reported as counts elsewhere. Because they partition it, a value appears in exactly one
 * category and the totals add up.
 *
 * A category says what the *evidence* is, not what to do about it. What to do is
 * `VaultAuditResolution`, which is derived from the category and the ownership table together,
 * because the same evidence resolves differently on a drawing than on a part.
 */
export type VaultAuditCategoryKind =
  /** Neither the database nor the file holds it any more. No tool can bring it back. */
  | 'lost'
  /** Both hold a value and they differ. A person has to choose; a wrong choice writes bad data. */
  | 'conflicting'
  /** Gone from the database, still in the file under the key BluePLM writes. Mechanically fixable. */
  | 'recoverable'
  /** In the database, absent from the file. Nothing lost; the document is behind the record. */
  | 'absent-from-file'
  /** In the file, never the database's to hold. Adopting one invents data rather than restoring it. */
  | 'unattributed'

/** Drives colour only; the ordering is the array order from `buildVaultAuditView`. */
export type VaultAuditTone = 'critical' | 'warning' | 'repairable' | 'neutral'

/**
 * What resolving one finding would actually consist of.
 *
 * There are only ever two writes available - the file's value into BluePLM, or BluePLM's value
 * into the file - and this enumerates the cases in which each is on the table. The three entries
 * that are not a write exist because a finding can fail to offer either direction: there may be no
 * value anywhere to copy, both copies may be candidates with nothing to choose between them, or
 * the row under comparison may not be the field's owner, in which case writing either way settles
 * an argument at the wrong end of it.
 *
 * Naming the outcome per row is the point. The categories above say what the evidence is, and an
 * administrator reading "Not BluePLM's to hold" still has to work out that the answer is to do
 * nothing.
 */
export type VaultAuditResolution =
  /** Write the file's value into BluePLM. The file is the surviving copy. */
  | 'adopt-file-value'
  /** Write BluePLM's value into the file. The record is the surviving copy. */
  | 'push-vault-value'
  /**
   * The file is authoritative, but it has no revision to promote. The audit never writes the
   * database's revision into the document.
   */
  | 'file-is-authoritative'
  /** Both sides hold a value and the ownership table does not settle it. A person must pick. */
  | 'choose-a-side'
  /** Neither side holds a value. Nothing can be copied; someone has to author one. */
  | 'nothing-to-restore'
  /**
   * The value on this row is a projection of the parent model's. Writing either copy over the
   * other leaves the source untouched, so the fix belongs on the model.
   */
  | 'fix-on-parent-model'
  /** The file's value was never BluePLM's. Adopting it invents a record; erasing it is not ours. */
  | 'leave-alone'

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
  /** What resolving this would consist of. Derived from `kind` and the field's owner. */
  resolution: VaultAuditResolution
  fileId: string
  relativePath: string
  fileName: string
  /** Carried because the ownership table, and so the resolution, differs on a drawing. */
  fileType: ComparedFileType
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

/**
 * Files inside the run's file-type and path scope that were never opened.
 *
 * Distinct from `VaultAuditUnread`, which is files the run tried to read and failed on. These were
 * not attempted at all, and neither number is a finding. They are carried separately because the
 * page's headline depends on them: "every value compared agrees" is true of a run that compared
 * one file in seven, and read as "the vault is fine" by everyone who saw it.
 */
export interface VaultAuditNotCompared {
  /** The sum. Zero means the run covered everything its scope named. */
  total: number
  /**
   * Dropped because the row carries no reserved configuration map.
   *
   * Roughly six of every seven models. Not damage - nothing can be lost from a record that never
   * existed - but not evidence of health either.
   */
  noConfigurationRecord: number
  /** Dropped because the run was limited to a fixed number of files. */
  beyondLimit: number
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
  /**
   * Rows the scope named, before anything narrowed or failed. The denominator.
   *
   * Zero is the case the page exists to not misreport: a folder path that matches no row produces
   * no findings and nothing uncompared, which every other number here reads as perfect health.
   */
  rowsInScope: number
  filesCompared: number
  filesWithFindings: number
  filesWithMultipleConfigurations: number
  /** Values absent from both sides on a row that never described the file. Absence, not loss. */
  noEvidenceValues: number
  /**
   * Revision comparisons on parts and assemblies left out because the documents are not expected
   * to carry one. Zero when the reader has asked to see them.
   *
   * Reported rather than merely applied: this is usually the largest single exclusion on the page,
   * and a count that is quietly smaller than the vault would support is the failure mode the whole
   * audit exists to avoid.
   */
  revisionOnModelsHidden: number
  /** In-scope files the run never opened. The headline is not allowed to ignore these. */
  notCompared: VaultAuditNotCompared
  unread: VaultAuditUnread
  integrity: VaultAuditIntegrity
  coverage: VaultAuditCoverage
  /** Ordered worst first. Always holds all five kinds, including empty ones. */
  categories: VaultAuditCategory[]
  findings: VaultAuditFinding[]
  /** The scanner's per-field breakdown, passed through unchanged. */
  fieldTallies: FieldTally[]
}

// ============================================
// The repair seam
// ============================================

/**
 * ## Why this is not the seam that was declared here before
 *
 * The original seam was `(target: VaultAuditRepairTarget) => void`: one value, synchronous, no
 * result. It was never wired to anything, and three things about it turned out to be wrong once a
 * caller existed.
 *
 * **A write is asynchronous and has an outcome.** `void` cannot say whether the row was found,
 * whether it was already intact, or how many entries actually landed. A repair whose result cannot
 * be reported is one the operator has to go and verify by hand, which is the terminal-and-SQL
 * workflow this replaces.
 *
 * **Approving a subset requires a set.** The owner must see file, configuration, field and value
 * and tick the ones to apply. A per-value entry point can only be driven by a button per row,
 * which is a click per value across a hundred and thirty-four of them and no way to see the whole
 * before committing to any of it.
 *
 * **One call per value is one transaction per value.** A hundred round trips that can fail
 * half-way leave a partial repair with no receipt.
 *
 * Note what is *not* among the reasons: safety. Per-value would have been perfectly safe, because
 * the guarantee no longer lives in the shape of this interface - it lives in the SQL, where the
 * merge is written `computed || existing` inside a `SECURITY DEFINER` function and no argument can
 * turn it into an overwrite. The seam was reshaped for honesty about outcomes, not to buy back a
 * property it never carried.
 */

/** How a proposed value was arrived at. The two are never mixed in the interface. */
export type VaultAuditRepairProvenance =
  /**
   * Read from the configuration's own bag, under the very key BluePLM's writers produce. The
   * database held this string and lost it; putting it back is a restoration.
   */
  | 'recovered'
  /**
   * Computed by splitting the configuration's `Number` on its last dash - what the browser does at
   * display time. The database never distinctly held this string, so writing one is a
   * reconstruction and not a recovery. Off unless the operator asks for it, and labelled wherever
   * it appears.
   */
  | 'derived'

/** One value that could be written, and everything needed to decide whether it should be. */
export interface VaultAuditRepairCandidate {
  /** Stable within a report, so a selection survives re-renders. */
  id: string
  fileId: string
  relativePath: string
  fileName: string
  field: ConfigScopeField
  configuration: string
  /**
   * The string that would be written.
   *
   * Frozen when the vault was scanned, and deliberately so: it is what the operator approved, and
   * re-reading the document at apply time would write a value nobody saw. The database side is the
   * half that is re-read - inside the merge - so a row that changed in between wins on its own
   * entries and this value simply does not land.
   */
  value: string
  provenance: VaultAuditRepairProvenance
}

/** One file's worth of merge, keyed by the reserved map the entries belong under. */
export interface VaultAuditRepairFile {
  fileId: string
  relativePath: string
  maps: Partial<Record<ConfigMapKey, Record<string, string>>>
}

/** What one file's maps did, as the database reported it. */
export interface VaultAuditRepairFileOutcome {
  fileId: string
  relativePath: string | null
  updated: boolean
  /** Set when the row could not be acted on at all - a moved, deleted or foreign row. */
  refused: string | null
  /**
   * Entries this file's request asked for, whether or not any of them could be applied.
   *
   * On a refused file this is the whole request, and it is the number the receipt has to show:
   * every one of those entries was dropped.
   */
  entriesRequested: number
  /** Entries the row gained, per reserved map. Never more than were asked for; often fewer. */
  added: Partial<Record<ConfigMapKey, number>>
  /** Maps the row does not carry, so there was nothing there to restore. */
  mapsAbsent: ConfigMapKey[]
  /** How many entries were asked for under those absent maps. Dropped, not merged. */
  entriesUnderAbsentMap: number
}

/**
 * The receipt.
 *
 * `entriesRequested` and `entriesAdded` can differ for three unrelated reasons, and the difference
 * alone does not say which. The row may already have held the entry, which is the normal and safe
 * outcome of applying a stale plan; the row may not have been reachable at all; or the row may not
 * carry the reserved map, in which case there was nothing to restore into. `describeShortfall` in
 * `features/settings/system/vault-audit/repairReceipt.ts` separates them, because reporting all
 * three as "already there" is reassurance about entries that were dropped.
 */
export interface VaultAuditRepairOutcome {
  filesRequested: number
  filesUpdated: number
  entriesRequested: number
  entriesAdded: number
  files: VaultAuditRepairFileOutcome[]
}

/**
 * Supplied by the panel, which holds the Supabase session. Takes an approved set and returns what
 * the database did with it.
 */
export type VaultAuditRepairHandler = (
  files: readonly VaultAuditRepairFile[],
) => Promise<VaultAuditRepairOutcome>
