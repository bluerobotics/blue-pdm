/**
 * Drives the configuration-map repair the Vault Audit offers once a scan has finished.
 *
 * It consumes the scan's own report rather than re-reading anything. The scan has already opened
 * every document in scope and read every row, so the values are already known; opening the vault a
 * second time would cost another three minutes and would risk the SOLIDWORKS session the scan went
 * out of its way to leave alone.
 *
 * ## Two clocks, deliberately
 *
 * The **document** side is frozen at scan time. It is what the preview showed and what the admin
 * ticked, and re-reading it at apply time would write a value nobody approved.
 *
 * The **database** side is read at apply time, inside the merge, in SQL. So a row that gained
 * entries between the scan and the click wins on those entries and the repair quietly becomes a
 * smaller one. The receipt reports entries added against entries requested, which is where that
 * shows up.
 *
 * The two cannot conflict, because the row always wins. That is the whole reason the value may be
 * frozen without the freeze being a hazard.
 */

import { useCallback, useMemo } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  buildRepairCandidates,
  summarizeCandidates,
  toRepairRequest,
  type RepairProposalSummary,
} from '@/lib/metadata/configMapRepairProposal'
import {
  applyConfigMapRepair,
  ConfigMapRepairNotInstalledError,
} from '@/lib/supabase/configMapRepair'
import { usePDMStore } from '@/stores/pdmStore'
import type { VaultAuditRepairCandidate, VaultAuditRepairOutcome } from '@/types/vaultAudit'

import { settledCandidateIds } from './repairReceipt'

export interface UseVaultAuditRepairResult {
  /** Every value that could be written, given the derivation setting. */
  candidates: VaultAuditRepairCandidate[]
  /** What the whole set amounts to, settled entries included. Says whether there is a job at all. */
  available: RepairProposalSummary
  /** What is left of it. This is what the section leads with, because it is the work remaining. */
  outstanding: RepairProposalSummary
  /** What the ticked subset amounts to. This is what Apply will send. */
  selected: RepairProposalSummary
  selectedIds: ReadonlySet<string>
  /** Candidates an earlier apply in this run accounted for. Hidden by default in the preview. */
  settledIds: ReadonlySet<string>
  includeDerivedTabs: boolean
  applying: boolean
  outcome: VaultAuditRepairOutcome | null
  error: string | null
  /** The database predates the release the repair function ships in. */
  notInstalled: boolean
  /** False when nothing is ticked, a repair is already running, or there is no organization. */
  canApply: boolean
  toggle: (id: string) => void
  setMany: (ids: readonly string[], selected: boolean) => void
  setIncludeDerivedTabs: (include: boolean) => void
  apply: () => Promise<void>
}

export function useVaultAuditRepair(): UseVaultAuditRepairResult {
  const organization = usePDMStore((state) => state.organization)
  const addToast = usePDMStore((state) => state.addToast)
  const run = usePDMStore((state) => state.vaultAuditRun)
  const repair = usePDMStore((state) => state.vaultAuditRepair)
  const setSelection = usePDMStore((state) => state.setVaultAuditRepairSelection)
  const setIncludeDerived = usePDMStore((state) => state.setVaultAuditIncludeDerivedTabs)
  const startRepair = usePDMStore((state) => state.startVaultAuditRepair)
  const finishRepair = usePDMStore((state) => state.finishVaultAuditRepair)

  // Keyed on the report and the one option that changes the answer. Walking every comparison in a
  // vault-wide report is not something to redo on each keystroke elsewhere on the page.
  const candidates = useMemo(
    () =>
      run?.report
        ? buildRepairCandidates(run.report.files, {
            includeDerivedTabs: repair.includeDerivedTabs,
          })
        : [],
    [run?.report, repair.includeDerivedTabs],
  )

  const selectedIds = useMemo(() => new Set(repair.selectedIds), [repair.selectedIds])
  const settledIds = useMemo(() => new Set(repair.settledIds), [repair.settledIds])

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedIds.has(candidate.id)),
    [candidates, selectedIds],
  )

  const outstandingCandidates = useMemo(
    () => candidates.filter((candidate) => !settledIds.has(candidate.id)),
    [candidates, settledIds],
  )

  const available = useMemo(() => summarizeCandidates(candidates), [candidates])
  const outstanding = useMemo(
    () => summarizeCandidates(outstandingCandidates),
    [outstandingCandidates],
  )
  const selected = useMemo(() => summarizeCandidates(selectedCandidates), [selectedCandidates])

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(repair.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelection([...next])
    },
    [repair.selectedIds, setSelection],
  )

  const setMany = useCallback(
    (ids: readonly string[], shouldSelect: boolean) => {
      const next = new Set(repair.selectedIds)
      for (const id of ids) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      setSelection([...next])
    },
    [repair.selectedIds, setSelection],
  )

  const apply = useCallback(async () => {
    if (!organization?.id) {
      addToast('error', t('vaultAudit.repair.noOrganization'))
      return
    }
    // Re-read rather than trusting the render that produced the button: two clicks in flight would
    // send the same entries twice, and while the merge makes the second a no-op, it would report a
    // repair that added nothing and read as a failure.
    if (usePDMStore.getState().vaultAuditRepair.applying) return

    // Selected out of the candidate list rather than out of the id set, so an id left over from a
    // list the admin can no longer see cannot be sent.
    const request = toRepairRequest(selectedCandidates)
    if (request.length === 0) return

    startRepair()

    try {
      const outcome = await applyConfigMapRepair(organization.id, request)
      // Settled against what was sent, not against what is ticked: the tick is cleared by this
      // same call, and the receipt only speaks about the files this request named.
      finishRepair({ outcome, settledIds: settledCandidateIds(selectedCandidates, outcome) })

      log.info('[VaultAudit]', 'Configuration-map repair applied', {
        filesUpdated: outcome.filesUpdated,
        entriesRequested: outcome.entriesRequested,
        entriesAdded: outcome.entriesAdded,
      })

      addToast(
        'success',
        t('vaultAudit.repair.appliedToast', {
          entries: outcome.entriesAdded,
          files: outcome.filesUpdated,
        }),
      )
    } catch (error) {
      if (error instanceof ConfigMapRepairNotInstalledError) {
        finishRepair({ notInstalled: true })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      finishRepair({ error: message })
      log.error('[VaultAudit]', 'Configuration-map repair failed', { error: message })
    }
  }, [organization?.id, selectedCandidates, addToast, startRepair, finishRepair])

  return {
    candidates,
    available,
    outstanding,
    selected,
    selectedIds,
    settledIds,
    includeDerivedTabs: repair.includeDerivedTabs,
    applying: repair.applying,
    outcome: repair.outcome,
    error: repair.error,
    notInstalled: repair.notInstalled,
    canApply: Boolean(organization?.id) && !repair.applying && selectedCandidates.length > 0,
    toggle,
    setMany,
    setIncludeDerivedTabs: setIncludeDerived,
    apply,
  }
}
