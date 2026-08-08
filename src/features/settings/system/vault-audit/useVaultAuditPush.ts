/**
 * Drives the document half of the audit: writing BluePLM's values into SOLIDWORKS files.
 *
 * ## Why this delegates rather than writes
 *
 * There is already a command that writes BluePLM-owned metadata into a document, at file scope and
 * at every configuration scope, verified by reading the properties back afterwards, batched over a
 * selection with a progress bar and a cancel. It is Sync Metadata, it is what the file browser's
 * context menu runs, and it has been the way metadata reaches a document since check-in stopped
 * doing it. The audit's job is to work out *which* files need it; writing a second implementation
 * of the write itself would give the vault two answers to what BluePLM's value is.
 *
 * So this hook resolves findings back to files and hands them over. Nothing here opens a document.
 *
 * ## What that inherits, including the awkward part
 *
 * Sync Metadata will only touch a file that is **local-only or checked out by you**, which is the
 * rule that makes it safe to run from a context menu and is not this hook's to relax. A vault-wide
 * audit routinely finds hundreds of files that need a write and none of them checked out, so the
 * eligible count is almost always smaller than the selected count - often much smaller.
 *
 * That gap is reported before the button rather than discovered after it. A run that silently
 * processed the eligible eighth of a selection and reported success would leave the admin believing
 * the vault had been brought into line, and the next scan would say otherwise with no explanation.
 *
 * The gap is also reported as two numbers rather than one - see `vaultAuditFileState`. A file you
 * have not checked out is a checkout away from being writable; a file a colleague is holding is not
 * yours at all, and those rows never become selectable here.
 */

import { useCallback, useMemo } from 'react'

import { syncMetadata } from '@/lib/commands'
import { log } from '@/lib/logger'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import {
  availabilityOf,
  tallyAvailability,
  type VaultAuditAvailabilityTally,
  type VaultAuditFileAvailability,
} from './vaultAuditFileState'

export interface VaultAuditPushEligibility {
  /** Files ticked, whether or not they can be written. */
  selected: number
  /** Of those, the ones Sync Metadata will accept: local-only, or checked out by this user. */
  eligible: LocalFile[]
  /** How the ticked files break down, so the notice can name the two refusals apart. */
  tally: VaultAuditAvailabilityTally
}

export interface UseVaultAuditPushResult {
  selectedFileIds: ReadonlySet<string>
  /** File ids a write in this session already covered. */
  writtenFileIds: ReadonlySet<string>
  /**
   * Files somebody else is holding, across every finding rather than only the ticked ones.
   *
   * The findings table consults this per row, because a file that is not yours is not something to
   * discover after selecting it - those rows are never selectable in the first place.
   */
  heldByOthers: ReadonlySet<string>
  /** Every finding's file, classified. Used by the table to explain a row that cannot be ticked. */
  availability: ReadonlyMap<string, VaultAuditFileAvailability>
  eligibility: VaultAuditPushEligibility
  running: boolean
  canRun: boolean
  toggleFile: (fileId: string) => void
  setManyFiles: (fileIds: readonly string[], selected: boolean) => void
  run: () => Promise<void>
}

/**
 * A finding names a row; Sync Metadata takes the loaded file.
 *
 * Matched on the database id first, because that is what both sides actually agree on. The path is
 * a fallback for a file the browser has on disk but has not associated with its row yet, and it is
 * normalised because the report writes vault-relative paths with backslashes and the store is not
 * guaranteed to.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function resolveFiles(
  findings: readonly VaultAuditFinding[],
  loaded: readonly LocalFile[],
): Map<string, LocalFile | undefined> {
  const byId = new Map<string, LocalFile>()
  const byPath = new Map<string, LocalFile>()
  for (const file of loaded) {
    if (file.pdmData?.id) byId.set(file.pdmData.id, file)
    byPath.set(normalizePath(file.relativePath), file)
  }

  // One entry per file, not per finding: several findings share a file and the command must not be
  // handed the same document twice.
  const resolved = new Map<string, LocalFile | undefined>()
  for (const finding of findings) {
    if (resolved.has(finding.fileId)) continue
    resolved.set(
      finding.fileId,
      byId.get(finding.fileId) ?? byPath.get(normalizePath(finding.relativePath)),
    )
  }

  return resolved
}

export function useVaultAuditPush(findings: readonly VaultAuditFinding[]): UseVaultAuditPushResult {
  const loadedFiles = usePDMStore((state) => state.files)
  const user = usePDMStore((state) => state.user)
  const push = usePDMStore((state) => state.vaultAuditPush)
  const setSelection = usePDMStore((state) => state.setVaultAuditPushSelection)
  const startPush = usePDMStore((state) => state.startVaultAuditPush)
  const finishPush = usePDMStore((state) => state.finishVaultAuditPush)

  const selectedFileIds = useMemo(() => new Set(push.selectedFileIds), [push.selectedFileIds])
  const writtenFileIds = useMemo(() => new Set(push.writtenFileIds), [push.writtenFileIds])

  // Every finding's file, classified once. Keyed on the findings and the loaded list rather than on
  // the selection, because the table asks about rows nobody has ticked.
  const availability = useMemo(() => {
    const files = resolveFiles(findings, loadedFiles)
    const states = new Map<string, VaultAuditFileAvailability>()
    for (const [fileId, file] of files) states.set(fileId, availabilityOf(file, user?.id))
    return states
  }, [findings, loadedFiles, user?.id])

  const heldByOthers = useMemo(() => {
    const held = new Set<string>()
    for (const [fileId, state] of availability) {
      if (state.state === 'held-by-other') held.add(fileId)
    }
    return held
  }, [availability])

  const eligibility = useMemo<VaultAuditPushEligibility>(() => {
    const files = resolveFiles(findings, loadedFiles)
    const selectedStates: VaultAuditFileAvailability[] = []
    const eligible: LocalFile[] = []

    for (const fileId of selectedFileIds) {
      const state = availability.get(fileId)
      if (!state) continue
      selectedStates.push(state)
      const file = files.get(fileId)
      if (state.state === 'writable' && file) eligible.push(file)
    }

    return {
      selected: selectedFileIds.size,
      eligible,
      tally: tallyAvailability(selectedStates),
    }
  }, [findings, loadedFiles, selectedFileIds, availability])

  const toggleFile = useCallback(
    (fileId: string) => {
      const next = new Set(push.selectedFileIds)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      setSelection([...next])
    },
    [push.selectedFileIds, setSelection],
  )

  const setManyFiles = useCallback(
    (fileIds: readonly string[], shouldSelect: boolean) => {
      const next = new Set(push.selectedFileIds)
      for (const id of fileIds) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      setSelection([...next])
    },
    [push.selectedFileIds, setSelection],
  )

  const run = useCallback(async () => {
    if (usePDMStore.getState().vaultAuditPush.running) return

    const files = eligibility.eligible
    if (files.length === 0) return

    startPush()
    try {
      // Revision is always driven by the file. Sync Metadata is per file, so a part ticked to fix
      // its description would otherwise take the row's revision with it - a property the audit
      // must never write back into a document.
      await syncMetadata(files, undefined, { omitRevisionOnModels: true })
    } catch (error) {
      log.error('[VaultAudit]', 'Writing BluePLM values into files failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Marked written whether the command succeeded or not, because the command reports its own
      // per-file outcome through the progress toast and re-offering the same batch here would
      // invite a second run over files that may already have been changed. A rescan is the honest
      // way to find out what landed, and it is one button away.
      finishPush(files.map((file) => file.pdmData?.id).filter((id): id is string => Boolean(id)))
    }
  }, [eligibility.eligible, startPush, finishPush])

  return {
    selectedFileIds,
    writtenFileIds,
    heldByOthers,
    availability,
    eligibility,
    running: push.running,
    canRun: !push.running && eligibility.eligible.length > 0,
    toggleFile,
    setManyFiles,
    run,
  }
}
