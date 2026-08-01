/**
 * useSolidWorksStatus - Consolidated SolidWorks Service Status Hook
 *
 * This hook provides a single source of truth for SolidWorks service status
 * across the application. The status snapshot lives in the PDM store and a
 * single module-level poller drives it, so short-lived consumers (context
 * menus) read the last known status immediately on mount instead of starting
 * from a stale "not running" and having to wait for their own IPC round-trip.
 *
 * Features:
 * - 15-second polling interval (reduced from 5s to reduce service load)
 * - One poller regardless of how many components consume the hook
 * - Pause/resume API for batch operations to prevent status check interference
 * - Handles 'busy' flag from main process - doesn't mark service as offline when busy
 * - Automatic polling pause when batch SW operations are running
 *
 * @example
 * ```tsx
 * const { status, pausePolling, resumePolling, refreshStatus } = useSolidWorksStatus()
 *
 * // For batch operations:
 * pausePolling()
 * await performBatchOperation()
 * resumePolling()
 * ```
 */
import { useEffect, useCallback, useSyncExternalStore } from 'react'

import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import type { SolidWorksServiceStatus } from '@/types/solidworks'

export type { SolidWorksServiceStatus } from '@/types/solidworks'
export { isSolidWorksUsable } from '@/types/solidworks'

/**
 * Polling interval for SolidWorks status checks (15 seconds)
 * Increased from 5s to reduce service load during normal operations
 */
const POLLING_INTERVAL_MS = 15000

/**
 * Shape of the main process status payload. Field names differ between service
 * versions, so both the old and new spellings are accepted.
 */
interface ServiceStatusPayload {
  running?: boolean
  busy?: boolean
  version?: string
  installed?: boolean
  swInstalled?: boolean
  documentManagerAvailable?: boolean
  fastModeEnabled?: boolean
  dmApiAvailable?: boolean
  documentManagerError?: string | null
  dmApiError?: string | null
  queueDepth?: number
  referenceRecoveryNeeded?: boolean
  message?: string
}

// ═══════════════════════════════════════════════════════════════
// Module-level poller - shared by every consumer of the hook
// ═══════════════════════════════════════════════════════════════

let consumerCount = 0
let pollInterval: NodeJS.Timeout | null = null
let isPaused = false
let inFlightCheck: Promise<void> | null = null

const pauseListeners = new Set<() => void>()

function subscribePauseState(listener: () => void): () => void {
  pauseListeners.add(listener)
  return () => {
    pauseListeners.delete(listener)
  }
}

function getIsPollingSnapshot(): boolean {
  return !isPaused
}

function setPaused(paused: boolean) {
  if (isPaused === paused) return
  isPaused = paused
  pauseListeners.forEach((listener) => listener())
}

/**
 * Resolve the DM availability reported by the service, falling back to the
 * previous snapshot. When the service is busy it can't answer a ping, so the
 * main process replays cached capabilities - and when even those are missing
 * the last known values are still more accurate than dropping to undefined.
 */
function mergeCapabilities(
  prev: SolidWorksServiceStatus,
  payload: ServiceStatusPayload,
): Pick<SolidWorksServiceStatus, 'swInstalled' | 'dmApiAvailable' | 'dmApiError' | 'version'> {
  const dmApiAvailable =
    payload.documentManagerAvailable ??
    payload.fastModeEnabled ??
    payload.dmApiAvailable ??
    prev.dmApiAvailable

  return {
    swInstalled: payload.installed ?? payload.swInstalled ?? prev.swInstalled,
    dmApiAvailable,
    // An available DM has no error; otherwise keep whatever reason we know of
    dmApiError: dmApiAvailable
      ? null
      : (payload.documentManagerError ?? payload.dmApiError ?? prev.dmApiError),
    version: payload.version ?? prev.version,
  }
}

async function performStatusCheck(): Promise<void> {
  const { setSolidworksServiceStatus, setSolidworksStatusChecking, setIntegrationStatus } =
    usePDMStore.getState()

  setSolidworksStatusChecking(true)

  try {
    const result = await window.electronAPI?.solidworks?.getServiceStatus()
    const prev = usePDMStore.getState().solidworksServiceStatus

    if (result?.success && result.data) {
      const payload = result.data as ServiceStatusPayload
      const capabilities = mergeCapabilities(prev, payload)

      // Process alive but IPC connection lost - keep capabilities, flag the error
      if (payload.referenceRecoveryNeeded) {
        setSolidworksServiceStatus({
          ...prev,
          ...capabilities,
          running: true,
          busy: true,
          queueDepth: payload.queueDepth,
          error: payload.message || 'Service connection lost - restart recommended',
        })
        setIntegrationStatus('solidworks', 'partial', 'Service restart recommended')
        return
      }

      // Service is alive but occupied by an in-flight command, so it can't
      // answer a ping. Commands still queue normally - this is not offline.
      if (payload.busy) {
        setSolidworksServiceStatus({
          ...prev,
          ...capabilities,
          running: true,
          busy: true,
          queueDepth: payload.queueDepth,
          error: undefined,
        })
        // Don't update integration status when busy - keep current state
        return
      }

      // Definitively down: drop the carried-over capabilities so the UI doesn't
      // keep advertising Document Manager for a service that isn't there.
      setSolidworksServiceStatus({
        ...capabilities,
        ...(payload.running ? {} : { dmApiAvailable: payload.documentManagerAvailable }),
        running: payload.running ?? false,
        queueDepth: payload.queueDepth,
        busy: false,
        error: undefined,
      })

      if (payload.running) {
        if (capabilities.dmApiAvailable) {
          setIntegrationStatus('solidworks', capabilities.swInstalled ? 'online' : 'partial')
        } else {
          setIntegrationStatus('solidworks', 'offline')
        }
      } else {
        const isConfigured =
          usePDMStore.getState().organization?.settings?.solidworks_dm_license_key
        setIntegrationStatus('solidworks', isConfigured ? 'offline' : 'not-configured')
      }
    } else if (result?.error) {
      setSolidworksServiceStatus({ ...prev, running: false, busy: false, error: result.error })
      setIntegrationStatus('solidworks', 'offline', result.error)
    }
  } catch (error) {
    log.warn('[SWStatus]', 'Error checking status', { error: error })
    const prev = usePDMStore.getState().solidworksServiceStatus
    setSolidworksServiceStatus({ ...prev, running: false, busy: false, error: String(error) })
    setIntegrationStatus('solidworks', 'offline', String(error))
  } finally {
    usePDMStore.getState().setSolidworksStatusChecking(false)
  }
}

/**
 * Run a status check, deduping concurrent callers.
 * @param force - bypass the paused flag (used by manual refresh)
 */
function checkStatus(force = false): Promise<void> {
  const state = usePDMStore.getState()

  if (!force && isPaused) {
    return Promise.resolve()
  }

  // Skip while a batch operation or auto-start owns the service
  if (state.isBatchSWOperationRunning || state.solidworksAutoStartInProgress) {
    return Promise.resolve()
  }

  if (!state.solidworksIntegrationEnabled) {
    state.setSolidworksServiceStatus({ running: false })
    state.setIntegrationStatus('solidworks', 'not-configured')
    return Promise.resolve()
  }

  if (inFlightCheck && !force) {
    return inFlightCheck
  }

  const pending = performStatusCheck()
  inFlightCheck = pending
  void pending.finally(() => {
    if (inFlightCheck === pending) {
      inFlightCheck = null
    }
  })
  return pending
}

function startPolling() {
  if (pollInterval) return
  void checkStatus()
  pollInterval = setInterval(() => {
    void checkStatus()
  }, POLLING_INTERVAL_MS)
}

function stopPolling() {
  if (!pollInterval) return
  clearInterval(pollInterval)
  pollInterval = null
}

/**
 * Return type for useSolidWorksStatus hook
 */
export interface UseSolidWorksStatusReturn {
  /** Current service status */
  status: SolidWorksServiceStatus
  /** Whether status polling is currently active */
  isPolling: boolean
  /** Whether the hook is currently checking status */
  isChecking: boolean
  /** False until the first status check has completed - status is unknown, not offline */
  hasChecked: boolean
  /** Pause status polling (call before batch operations) */
  pausePolling: () => void
  /** Resume status polling (call after batch operations) */
  resumePolling: () => void
  /** Manually trigger a status refresh */
  refreshStatus: () => Promise<void>
}

/**
 * Consolidated SolidWorks service status hook
 *
 * Reads the shared status snapshot from the store and participates in a single
 * app-wide poller. Mounting additional consumers is cheap and they see the
 * current status on their very first render.
 */
export function useSolidWorksStatus(): UseSolidWorksStatusReturn {
  const status = usePDMStore((state) => state.solidworksServiceStatus)
  const isChecking = usePDMStore((state) => state.solidworksStatusChecking)
  const hasChecked = usePDMStore((state) => state.solidworksStatusLastChecked !== null)
  const solidworksIntegrationEnabled = usePDMStore((state) => state.solidworksIntegrationEnabled)
  const isBatchSWOperationRunning = usePDMStore((state) => state.isBatchSWOperationRunning)
  const solidworksAutoStartInProgress = usePDMStore((state) => state.solidworksAutoStartInProgress)

  const isPolling = useSyncExternalStore(subscribePauseState, getIsPollingSnapshot)

  const pausePolling = useCallback(() => {
    setPaused(true)
    stopPolling()
  }, [])

  const resumePolling = useCallback(() => {
    setPaused(false)
    startPolling()
  }, [])

  const refreshStatus = useCallback(async () => {
    await checkStatus(true)
  }, [])

  // Join the shared poller; the last consumer to unmount tears it down.
  useEffect(() => {
    consumerCount += 1
    if (consumerCount === 1 && !isPaused) {
      startPolling()
    }
    return () => {
      consumerCount -= 1
      if (consumerCount === 0) {
        stopPolling()
      }
    }
  }, [])

  // Re-check promptly when the gating conditions change rather than waiting out
  // the remainder of the current interval.
  useEffect(() => {
    if (consumerCount > 0 && !isPaused) {
      void checkStatus()
    }
  }, [solidworksIntegrationEnabled, isBatchSWOperationRunning, solidworksAutoStartInProgress])

  return {
    status,
    isPolling,
    isChecking,
    hasChecked,
    pausePolling,
    resumePolling,
    refreshStatus,
  }
}
