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
  includeDerivedTabs: false,
  applying: false,
  outcome: null,
  error: null,
  notInstalled: false,
}

export interface VaultAuditSlice {
  // ═══════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════

  /** The scope the admin last chose. Persisted; a preference, not a result. */
  vaultAuditScope: VaultAuditScope

  /** The current or most recent run. Session-scoped, never persisted. */
  vaultAuditRun: VaultAuditRun | null

  /**
   * The repair built on top of the current run. Session-scoped and never persisted, for the same
   * reason the report is not: an approval of values read from a vault three days ago is an
   * approval of something that may no longer be true.
   */
  vaultAuditRepair: VaultAuditRepairState

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  setVaultAuditScope: (scope: VaultAuditScope) => void
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
  vaultAuditRun: null,
  vaultAuditRepair: EMPTY_VAULT_AUDIT_REPAIR,

  setVaultAuditScope: (scope: VaultAuditScope) => set({ vaultAuditScope: scope }),

  startVaultAuditRun: (scope: VaultAuditScope) => {
    const id = `vault-audit-${Date.now()}`
    set({
      // A new scan invalidates every candidate the old one produced, and a selection carried
      // across would name ids from a report that no longer exists.
      vaultAuditRepair: EMPTY_VAULT_AUDIT_REPAIR,
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
    set({ vaultAuditRun: null, vaultAuditRepair: EMPTY_VAULT_AUDIT_REPAIR }),

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
      },
    })),
})
