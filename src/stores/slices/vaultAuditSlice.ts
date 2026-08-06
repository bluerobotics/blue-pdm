/**
 * Vault Audit Slice
 *
 * Holds the state of the read-only divergence scan the Vault Audit settings page drives.
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
import type { VaultAuditProgress, VaultAuditRunState, VaultAuditScope } from '../../types/vaultAudit'
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

export interface VaultAuditSlice {
  // ═══════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════

  /** The scope the admin last chose. Persisted; a preference, not a result. */
  vaultAuditScope: VaultAuditScope

  /** The current or most recent run. Session-scoped, never persisted. */
  vaultAuditRun: VaultAuditRun | null

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

  setVaultAuditScope: (scope: VaultAuditScope) => set({ vaultAuditScope: scope }),

  startVaultAuditRun: (scope: VaultAuditScope) => {
    const id = `vault-audit-${Date.now()}`
    set({
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

  clearVaultAuditRun: () => set({ vaultAuditRun: null }),
})
