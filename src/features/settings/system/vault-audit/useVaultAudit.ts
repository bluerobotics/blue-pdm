/**
 * Drives the read-only divergence scan behind the Vault Audit page.
 *
 * ## Two things this hook exists to get right
 *
 * **It must not disturb a running SolidWorks session.** The scan reads through
 * `getPropertiesDocumentManager`, which never touches the live session, and before it starts this
 * hook asks SolidWorks once which documents it currently holds so those files are skipped rather
 * than opened at all - pointing Document Manager at a document SolidWorks has open can make
 * SolidWorks close it. One query for the whole run, because asking per file would mean thousands
 * of COM round-trips through the session being protected.
 *
 * **Three minutes of silence reads as a hang.** A full vault is around eight thousand documents at
 * roughly twenty milliseconds each, and the bottleneck is the app's single-file command queue
 * rather than Document Manager, so it cannot be made much faster. It can be made legible: progress
 * after every file, and a cancel that takes effect after the file in flight.
 *
 * **A scan that cannot work must refuse rather than fail.** `getPropertiesDocumentManager` arrived
 * in service v1.21.0, and a machine whose service predates it would fail on the first file after
 * the admin had committed to a three-minute walk. So the version is checked before a run starts,
 * and a service that is too old gets the same "Service rebuild required" notice the Service tab
 * shows rather than a wording invented here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { writeDivergenceArtifact } from '@/lib/metadata/divergenceReport'
import { runDivergenceScan, type DivergenceScanOptions } from '@/lib/metadata/divergenceScan'
import {
  checkSwServiceFeature,
  SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ,
  type SwServiceVersionCheckResult,
} from '@/lib/swServiceVersion'
import { usePDMStore } from '@/stores/pdmStore'
import type { VaultAuditScope, VaultAuditView } from '@/types/vaultAudit'

import { buildVaultAuditView } from './vaultAuditView'

/** Store writes per second while scanning. Enough for a smooth bar, few enough to be free. */
const PROGRESS_THROTTLE_MS = 200

export interface UseVaultAuditResult {
  isAdmin: boolean
  /** False when no vault is connected, which is the one thing the page cannot work without. */
  canScan: boolean
  /**
   * The running service measured against the version that introduced the audit's read command.
   * Null while the answer is still being fetched, and when the service is not running at all -
   * that is a different problem, and the scan already reports it in its own words.
   */
  serviceCheck: SwServiceVersionCheckResult | null
  /** The service is too old to answer the audit's read command, so a run would fail on file one. */
  serviceTooOld: boolean
  scope: VaultAuditScope
  setScope: (scope: VaultAuditScope) => void
  /** Whether a part or assembly is expected to carry a revision. Re-reads the report, never rescans. */
  expectRevisionOnModels: boolean
  setExpectRevisionOnModels: (expect: boolean) => void
  isRunning: boolean
  progress: { completed: number; total: number; message: string }
  /** Null until a run finishes; survives leaving and returning to the tab. */
  view: VaultAuditView | null
  runState: 'running' | 'complete' | 'cancelled' | 'failed' | null
  error: string | null
  artifactPath: string | null
  cancelRequested: boolean
  start: () => Promise<void>
  cancel: () => void
  clear: () => void
}

/**
 * Absolute paths, lower-cased, that SolidWorks currently has open.
 *
 * Components are included: a part loaded inside an open assembly is held just as firmly as the
 * assembly itself. A failure here is not fatal - it means SolidWorks is not running or not
 * reachable, and an empty set is the right answer in both cases.
 */
async function readOpenDocuments(): Promise<Set<string>> {
  try {
    const result = await window.electronAPI?.solidworks?.getOpenDocuments?.({
      includeComponents: true,
    })
    if (!result?.success || !result.data?.documents) return new Set()
    return new Set(result.data.documents.map((document) => document.filePath.toLowerCase()))
  } catch (error) {
    log.warn('[VaultAudit]', 'Could not ask SolidWorks which documents are open', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new Set()
  }
}

/**
 * Measure the running service against the version that first answered the audit's read command.
 *
 * Returns null when the service is not running: the scan's own preflight already refuses in that
 * case, and reporting a version problem on top of a stopped service points at the wrong fix.
 */
async function readServiceCheck(): Promise<SwServiceVersionCheckResult | null> {
  try {
    const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
    if (!status?.success || !status.data?.running) return null
    return checkSwServiceFeature(
      status.data.version ?? null,
      SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ,
    )
  } catch (error) {
    log.warn('[VaultAudit]', 'Could not read the SolidWorks service version', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * A service reporting no version cannot be shown to have the command, so it is refused alongside
 * one that is provably too old. Every other outcome - including a service merely a release behind
 * the app - still has the command and may scan.
 */
function blocksScan(check: SwServiceVersionCheckResult | null): boolean {
  return check?.status === 'incompatible' || check?.status === 'unknown'
}

export function useVaultAudit(): UseVaultAuditResult {
  const isAdmin = usePDMStore((state) => state.getEffectiveRole() === 'admin')
  const organization = usePDMStore((state) => state.organization)
  const activeVaultId = usePDMStore((state) => state.activeVaultId)
  const vaultPath = usePDMStore((state) => state.vaultPath)
  const addToast = usePDMStore((state) => state.addToast)

  const scope = usePDMStore((state) => state.vaultAuditScope)
  const setScope = usePDMStore((state) => state.setVaultAuditScope)
  const expectRevisionOnModels = usePDMStore((state) => state.vaultAuditExpectRevisionOnModels)
  const setExpectRevisionOnModels = usePDMStore(
    (state) => state.setVaultAuditExpectRevisionOnModels,
  )
  const run = usePDMStore((state) => state.vaultAuditRun)
  const startVaultAuditRun = usePDMStore((state) => state.startVaultAuditRun)
  const setVaultAuditProgress = usePDMStore((state) => state.setVaultAuditProgress)
  const finishVaultAuditRun = usePDMStore((state) => state.finishVaultAuditRun)
  const requestVaultAuditCancel = usePDMStore((state) => state.requestVaultAuditCancel)
  const clearVaultAuditRun = usePDMStore((state) => state.clearVaultAuditRun)

  const lastProgressAt = useRef(0)
  const [serviceCheck, setServiceCheck] = useState<SwServiceVersionCheckResult | null>(null)

  // Answered once when the page opens, so the admin sees the refusal before choosing a scope
  // rather than after clicking Run.
  useEffect(() => {
    let abandoned = false
    readServiceCheck().then((check) => {
      if (!abandoned) setServiceCheck(check)
    })
    return () => {
      abandoned = true
    }
  }, [])

  // Rebuilding the view walks every comparison in the report, so it is keyed on the report itself
  // rather than on the run: progress updates replace the run object many times a second. The
  // revision option is the other key, and it is what makes the toggle instant - the report already
  // holds every comparison, so changing which of them count is a re-read rather than a rescan.
  const view = useMemo(
    () =>
      run?.report ? buildVaultAuditView(run.report, { expectRevisionOnModels }) : null,
    [run?.report, expectRevisionOnModels],
  )

  const isRunning = run?.state === 'running'
  const canScan = Boolean(organization?.id && vaultPath)

  const start = useCallback(async () => {
    if (!organization?.id || !vaultPath) {
      addToast('error', t('vaultAudit.noVault'))
      return
    }
    if (usePDMStore.getState().vaultAuditRun?.state === 'running') return

    // Re-read rather than trusting the mount-time answer: the service can be stopped, rebuilt and
    // restarted while this page is open, in either direction.
    const currentCheck = await readServiceCheck()
    setServiceCheck(currentCheck)
    if (blocksScan(currentCheck)) {
      addToast(
        'error',
        t('vaultAudit.serviceTooOld', { version: SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ }),
      )
      return
    }

    const runId = startVaultAuditRun(scope)
    lastProgressAt.current = 0

    const options: DivergenceScanOptions = {
      orgId: organization.id,
      vaultId: activeVaultId,
      vaultPath,
      pathPrefix: scope.kind === 'folder' && scope.folderPath ? scope.folderPath : undefined,
      configurationRecordedOnly: scope.kind === 'configuration-recorded',
      openInSolidWorks: await readOpenDocuments(),
      // The read-back timing exists for the plan's phase 4 and costs extra opens. An audit is not
      // a benchmark, so it is off here and stays available in the terminal command.
      timingRepeats: 0,
      shouldCancel: () => usePDMStore.getState().vaultAuditRun?.cancelRequested === true,
      onProgress: (message) => setVaultAuditProgress(runId, { message }),
      onFileProgress: (completed, total) => {
        const now = Date.now()
        if (completed < total && now - lastProgressAt.current < PROGRESS_THROTTLE_MS) return
        lastProgressAt.current = now
        setVaultAuditProgress(runId, { completed, total })
      },
    }

    try {
      const report = await runDivergenceScan(options)

      let artifactPath: string | null = null
      try {
        artifactPath = await writeDivergenceArtifact(report)
      } catch (error) {
        // A report on screen is still worth having when only the file copy failed.
        log.warn('[VaultAudit]', 'Could not write the report artifact', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      finishVaultAuditRun(runId, {
        state: report.cancelled ? 'cancelled' : 'complete',
        report,
        artifactPath,
      })

      log.info('[VaultAudit]', 'Scan finished', {
        filesCompared: report.counts.filesCompared,
        durationMs: report.durationMs,
        cancelled: report.cancelled,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishVaultAuditRun(runId, { state: 'failed', error: message })
      log.error('[VaultAudit]', 'Scan failed', { error: message })
    }
  }, [
    organization?.id,
    vaultPath,
    activeVaultId,
    scope,
    addToast,
    startVaultAuditRun,
    setVaultAuditProgress,
    finishVaultAuditRun,
  ])

  const cancel = useCallback(() => requestVaultAuditCancel(), [requestVaultAuditCancel])
  const clear = useCallback(() => clearVaultAuditRun(), [clearVaultAuditRun])

  return {
    isAdmin,
    canScan,
    serviceCheck,
    serviceTooOld: blocksScan(serviceCheck),
    expectRevisionOnModels,
    setExpectRevisionOnModels,
    scope,
    setScope,
    isRunning,
    progress: run?.progress ?? { completed: 0, total: 0, message: '' },
    view,
    runState: run?.state ?? null,
    error: run?.error ?? null,
    artifactPath: run?.artifactPath ?? null,
    cancelRequested: run?.cancelRequested === true,
    start,
    cancel,
    clear,
  }
}
