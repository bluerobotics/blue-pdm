/**
 * Vault Audit Slice
 *
 * Holds the divergence scan the Vault Audit settings page drives, and the repair the admin builds
 * on top of it.
 *
 * ## Why the result lives here and not in the database
 *
 * A stored audit is a claim about a vault that stops being true the moment anyone checks a file
 * in, and it stops being true silently. Repairing against one is worse than having none, because
 * the numbers still look authoritative. So the result is recomputed on demand and never written
 * anywhere: the durable copy is the JSON artifact the scan already drops in the log directory,
 * which carries the timestamp that makes its age obvious.
 *
 * It lives in the store rather than in the page's own state for one reason: the scan takes minutes,
 * and settings panels unmount when the admin clicks another tab. Losing three minutes of scanning
 * to a stray click is the kind of thing that stops people running it at all.
 *
 * Only `vaultAuditScope` is persisted. The report holds every comparison for every file scanned -
 * megabytes for a full vault - and localStorage is the wrong place for it.
 */

import { StateCreator } from 'zustand'

import type { DivergenceReport } from '../../lib/metadata/divergenceScan'
import type {
  VaultAuditProgress,
  VaultAuditRepairOutcome,
  VaultAuditRunState,
  VaultAuditScope,
} from '../../types/vaultAudit'
import { DEFAULT_VAULT_AUDIT_SCOPE } from '../../types/vaultAudit'
import type { PDMStoreState } from '../types'

// ============================================================================
// Slice Types
// ============================================================================

/** One scan, from the moment it starts until another replaces it. */
export interface VaultAuditRun {
  id: string
  startedAt: number
  state: VaultAuditRunState
  scope: VaultAuditScope
  progress: VaultAuditProgress
  /** Present once the scan finishes, including when it was cancelled part-way. */
  report: DivergenceReport | null
  /** Where the JSON artifact was written, when it could be. */
  artifactPath: string | null
  error: string | null
  /** Set by the cancel button; the scan reads it between files. */
  cancelRequested: boolean
}

/**
 * What the admin has approved, and what came of applying it.
 *
 * The selection is by candidate id rather than by value: a value is the thing being approved, and
 * keeping a copy here would let the list drift from the preview the admin is reading. It starts
 * empty rather than everything-ticked, so a repair is something a person asked for item by item
 * rather than something they forgot to untick.
 */
export interface VaultAuditRepairState {
  /** Candidate ids the admin has ticked. Empty until they tick something. */
  selectedIds: string[]
  /**
   * Candidate ids the database has since accounted for, accumulated across every apply in this
   * run.
   *
   * The report is frozen at scan time and a repair does not change it, so without this the rows
   * just written stay in the list looking exactly like outstanding work. Which ids belong here is
   * read from the receipt per reserved map - see `settledCandidateIds` - so an entry that was
   * dropped is never counted as done.
   */
  settledIds: string[]
  /** Offer tabs reconstructed from the configuration's `Number`. Off unless asked for. */
  includeDerivedTabs: boolean
  /** True while the RPC is in flight; the apply button is not clickable twice. */
  applying: boolean
  /** The receipt from the last apply, kept so the admin can read it after it finishes. */
  outcome: VaultAuditRepairOutcome | null
  error: string | null
  /** The database predates the release the repair function ships in. */
  notInstalled: boolean
}

export const EMPTY_VAULT_AUDIT_REPAIR: VaultAuditRepairState = {
  selectedIds: [],
  settledIds: [],
  includeDerivedTabs: false,
  applying: false,
  outcome: null,
  error: null,
  notInstalled: false,
}

/**
 * What the admin has approved for writing into documents.
 *
 * Kept apart from the repair above because the two writers work at different granularities and
 * merging the selections would hide that. A configuration-map repair is approved value by value;
 * a document write is the Sync Metadata command, which rebuilds every BluePLM-owned property in
 * the file it is given, so the unit of approval is the file and the ids here are file ids.
 */
export interface VaultAuditPushState {
  /** File ids ticked for a document write. Empty until the admin ticks something. */
  selectedFileIds: string[]
  /** True while Sync Metadata is running, so the button is not clickable twice. */
  running: boolean
  /**
   * File ids a completed run in this session already wrote.
   *
   * Same purpose as the repair's `settledIds`: the report is frozen at scan time and a write does
   * not change it, so without this the rows just written stay in the list looking like outstanding
   * work.
   */
  writtenFileIds: string[]
}

export const EMPTY_VAULT_AUDIT_PUSH: VaultAuditPushState = {
  selectedFileIds: [],
  running: false,
  writtenFileIds: [],
}

/**
 * What the administrator chose for conflict rows where neither side is automatically authoritative.
 *
 * The file direction is kept separate from `vaultAuditPush` because pushing is per file while
 * adopting a file value is per finding. A single file can therefore have several independent
 * database decisions, but only one document write.
 */
export interface VaultAuditConflictState {
  /** Finding ids whose file values are approved for writing into BluePLM. */
  selectedFindingIds: string[]
  /** Finding ids successfully adopted during this audit session. */
  settledFindingIds: string[]
  /** True while the selected file values are being written into BluePLM. */
  applying: boolean
  error: string | null
}

export const EMPTY_VAULT_AUDIT_CONFLICT: VaultAuditConflictState = {
  selectedFindingIds: [],
  settledFindingIds: [],
  applying: false,
  error: null,
}

export interface VaultAuditSlice {
  // ═══════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════

  /** The scope the admin last chose. Persisted; a preference, not a result. */
  vaultAuditScope: VaultAuditScope

  /**
   * Whether a part or assembly document is expected to carry a `Revision` property.
   *
   * Persisted alongside the scope and for the same reason: it is a statement about how this vault
   * is run, not about any one scan. Off by default - a shop where drawings drive revisions is the
   * common case, and on such a vault this is the single largest source of findings.
   *
   * It changes how the report is read, never how it is gathered, so flipping it is instant and
   * costs no rescan.
   */
  vaultAuditExpectRevisionOnModels: boolean

  /** The current or most recent run. Session-scoped, never persisted. */
  vaultAuditRun: VaultAuditRun | null

  /**
   * The repair built on top of the current run. Session-scoped and never persisted, for the same
   * reason the report is not: an approval of values read from a vault three days ago is an
   * approval of something that may no longer be true.
   */
  vaultAuditRepair: VaultAuditRepairState

  /** The document writes built on top of the current run. Session-scoped, never persisted. */
  vaultAuditPush: VaultAuditPushState

  /** Explicit choices for conflict rows. Session-scoped, never persisted. */
  vaultAuditConflict: VaultAuditConflictState

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  setVaultAuditScope: (scope: VaultAuditScope) => void
  setVaultAuditExpectRevisionOnModels: (expect: boolean) => void
  startVaultAuditRun: (scope: VaultAuditScope) => string
  setVaultAuditProgress: (runId: string, progress: Partial<VaultAuditProgress>) => void
  finishVaultAuditRun: (
    runId: string,
    outcome: {
      state: VaultAuditRunState
      report?: DivergenceReport | null
      artifactPath?: string | null
      error?: string | null
    },
  ) => void
  requestVaultAuditCancel: () => void
  clearVaultAuditRun: () => void

  setVaultAuditRepairSelection: (ids: readonly string[]) => void
  setVaultAuditIncludeDerivedTabs: (include: boolean) => void
  startVaultAuditRepair: () => void
  finishVaultAuditRepair: (result: {
    outcome?: VaultAuditRepairOutcome | null
    error?: string | null
    notInstalled?: boolean
    /** Candidates the receipt accounted for, to be added to what earlier applies settled. */
    settledIds?: readonly string[]
  }) => void

  setVaultAuditPushSelection: (fileIds: readonly string[]) => void
  startVaultAuditPush: () => void
  /** `writtenFileIds` names the files the command actually processed, not the ones it was given. */
  finishVaultAuditPush: (writtenFileIds: readonly string[]) => void

  setVaultAuditConflictSelection: (findingIds: readonly string[]) => void
  startVaultAuditConflict: () => void
  finishVaultAuditConflict: (result: {
    settledFindingIds?: readonly string[]
    error?: string | null
  }) => void
}

// ============================================================================
// Slice Creator
// ============================================================================

const EMPTY_PROGRESS: VaultAuditProgress = { completed: 0, total: 0, message: '' }

export const createVaultAuditSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  VaultAuditSlice
> = (set, get) => ({
  vaultAuditScope: DEFAULT_VAULT_AUDIT_SCOPE,
  vaultAuditExpectRevisionOnModels: false,
  vaultAuditRun: null,
  vaultAuditRepair: EMPTY_VAULT_AUDIT_REPAIR,
  vaultAuditPush: EMPTY_VAULT_AUDIT_PUSH,
  vaultAuditConflict: EMPTY_VAULT_AUDIT_CONFLICT,

  setVaultAuditScope: (scope: VaultAuditScope) => set({ vaultAuditScope: scope }),

  // Deliberately does not clear the selection or the run. It changes which findings are shown, and
  // a value that goes out of view goes out of the list a selection is built from, so a tick on a
  // hidden row cannot be sent - `useVaultAuditRepair` selects out of the candidate list rather
  // than out of the id set for exactly this reason.
  setVaultAuditExpectRevisionOnModels: (expect: boolean) =>
    set({ vaultAuditExpectRevisionOnModels: expect }),

  startVaultAuditRun: (scope: VaultAuditScope) => {
    const id = `vault-audit-${Date.now()}`
    set({
      // A new scan invalidates every candidate the old one produced, and a selection carried
      // across would name ids from a report that no longer exists.
      vaultAuditRepair: EMPTY_VAULT_AUDIT_REPAIR,
      vaultAuditPush: EMPTY_VAULT_AUDIT_PUSH,
      vaultAuditRun: {
        id,
        startedAt: Date.now(),
        state: 'running',
        scope,
        progress: EMPTY_PROGRESS,
        report: null,
        artifactPath: null,
        error: null,
        cancelRequested: false,
      },
      vaultAuditConflict: EMPTY_VAULT_AUDIT_CONFLICT,
    })
    return id
  },

  // Keyed by run id so a late callback from a scan the admin already replaced cannot overwrite
  // the newer run's progress.
  setVaultAuditProgress: (runId: string, progress: Partial<VaultAuditProgress>) => {
    const run = get().vaultAuditRun
    if (!run || run.id !== runId || run.state !== 'running') return
    set({ vaultAuditRun: { ...run, progress: { ...run.progress, ...progress } } })
  },

  finishVaultAuditRun: (runId, outcome) => {
    const run = get().vaultAuditRun
    if (!run || run.id !== runId) return
    set({
      vaultAuditRun: {
        ...run,
        state: outcome.state,
        report: outcome.report ?? run.report,
        artifactPath: outcome.artifactPath ?? run.artifactPath,
        error: outcome.error ?? null,
      },
    })
  },

  requestVaultAuditCancel: () => {
    const run = get().vaultAuditRun
    if (!run || run.state !== 'running') return
    set({ vaultAuditRun: { ...run, cancelRequested: true } })
  },

  clearVaultAuditRun: () =>
    set({
      vaultAuditRun: null,
      vaultAuditRepair: EMPTY_VAULT_AUDIT_REPAIR,
      vaultAuditPush: EMPTY_VAULT_AUDIT_PUSH,
      vaultAuditConflict: EMPTY_VAULT_AUDIT_CONFLICT,
    }),

  setVaultAuditRepairSelection: (ids: readonly string[]) =>
    set((state) => ({
      // Clearing the previous receipt: leaving it on screen beside a new selection reads as if it
      // described that selection.
      vaultAuditRepair: {
        ...state.vaultAuditRepair,
        selectedIds: [...ids],
        outcome: null,
        error: null,
      },
    })),

  setVaultAuditIncludeDerivedTabs: (include: boolean) =>
    set((state) => ({
      vaultAuditRepair: {
        ...state.vaultAuditRepair,
        includeDerivedTabs: include,
        // Turning derivation off must not leave derived ids approved but invisible. The selection
        // is rebuilt from the list the admin can actually see, so it starts again either way.
        selectedIds: [],
        outcome: null,
        error: null,
      },
    })),

  startVaultAuditRepair: () =>
    set((state) => ({
      vaultAuditRepair: {
        ...state.vaultAuditRepair,
        applying: true,
        outcome: null,
        error: null,
        notInstalled: false,
      },
    })),

  finishVaultAuditRepair: (result) =>
    set((state) => ({
      vaultAuditRepair: {
        ...state.vaultAuditRepair,
        applying: false,
        outcome: result.outcome ?? null,
        error: result.error ?? null,
        notInstalled: result.notInstalled === true,
        // Applied entries are no longer proposals. Emptying the selection stops a second click
        // re-sending a request whose entries the row now holds - which the merge would refuse
        // anyway, but which would read as a repair that did nothing.
        selectedIds: result.outcome ? [] : state.vaultAuditRepair.selectedIds,
        // Accumulated rather than replaced: a vault-wide repair is applied in batches, and the
        // second batch's receipt says nothing about the first one's rows.
        settledIds: result.settledIds
          ? [...new Set([...state.vaultAuditRepair.settledIds, ...result.settledIds])]
          : state.vaultAuditRepair.settledIds,
      },
    })),

  setVaultAuditPushSelection: (fileIds: readonly string[]) =>
    set((state) => ({
      vaultAuditPush: { ...state.vaultAuditPush, selectedFileIds: [...fileIds] },
    })),

  startVaultAuditPush: () =>
    set((state) => ({ vaultAuditPush: { ...state.vaultAuditPush, running: true } })),

  finishVaultAuditPush: (writtenFileIds: readonly string[]) =>
    set((state) => ({
      vaultAuditPush: {
        selectedFileIds: [],
        running: false,
        // Accumulated across every write in this run, for the same reason the repair accumulates:
        // a vault-wide push happens in batches and the second says nothing about the first.
        writtenFileIds: [
          ...new Set([...state.vaultAuditPush.writtenFileIds, ...writtenFileIds]),
        ],
      },
    })),

  setVaultAuditConflictSelection: (findingIds: readonly string[]) =>
    set((state) => ({
      vaultAuditConflict: {
        ...state.vaultAuditConflict,
        selectedFindingIds: [...findingIds],
        error: null,
      },
    })),

  startVaultAuditConflict: () =>
    set((state) => ({
      vaultAuditConflict: {
        ...state.vaultAuditConflict,
        applying: true,
        error: null,
      },
    })),

  finishVaultAuditConflict: (result) =>
    set((state) => {
      const settled = new Set(result.settledFindingIds ?? [])
      return {
        vaultAuditConflict: {
          ...state.vaultAuditConflict,
          applying: false,
          error: result.error ?? null,
          selectedFindingIds: result.settledFindingIds
            ? state.vaultAuditConflict.selectedFindingIds.filter((id) => !settled.has(id))
            : state.vaultAuditConflict.selectedFindingIds,
          settledFindingIds: result.settledFindingIds
            ? [
                ...new Set([
                  ...state.vaultAuditConflict.settledFindingIds,
                  ...result.settledFindingIds,
                ]),
              ]
            : state.vaultAuditConflict.settledFindingIds,
        },
      }
    }),
})
