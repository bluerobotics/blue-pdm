import { useCallback, useEffect } from 'react'

import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { CustomerSyncRun } from '@/stores/types'

import {
  OUTDATED_API_MESSAGE,
  ROUTE_MISSING_MESSAGE,
  recordPollFailure,
  resetPollFailures,
} from './syncPollFailures'

/** The subset of POST /customers/sync's body the UI reports on. */
export interface SyncCounts {
  created?: number
  updated?: number
  reactivated?: number
  marked_inactive?: number
  linked?: number
  renamed?: number
  skipped_unknown_partner?: number
  rolled_up_to_company?: number
  replaced?: number
}

export interface SyncResponse {
  duration_ms?: number
  /**
   * 'incremental' when the run pulled only what Odoo had written since the
   * last successful sync, 'full' when it re-read everything.
   */
  mode?: 'full' | 'incremental'
  partner_pull_complete?: boolean
  fields_unavailable?: Record<string, string[]>
  customers?: SyncCounts
  customer_accounts?: SyncCounts
  customer_addresses?: SyncCounts
  customer_orders?: SyncCounts
  customer_order_lines?: SyncCounts
}

export interface CustomerSyncResult {
  /**
   * Run a sync. Incremental unless `full` is asked for, which is slow and only
   * needed to repair a mirror by hand.
   */
  sync: (options?: { full?: boolean }) => Promise<void>
  stop: () => Promise<void>
  /** True while a run is in flight, whoever started it. */
  syncing: boolean
  /** True once a stop has been asked for but the run has not yet acknowledged. */
  stopping: boolean
  run: CustomerSyncRun | null
  result: SyncResponse | null
  /**
   * Sync failures name a server-side or configuration problem someone has to
   * act on, so callers render them inline rather than as a toast that scrolls
   * away.
   */
  error: string | null
  canSync: boolean
  dismiss: () => void
  /**
   * Clear the summary of the last run without clearing an error, so a summary
   * that times out on screen cannot take a failure down with it.
   */
  dismissResult: () => void
}

/**
 * How often the run is re-read while it is active.
 *
 * The API's default rate limit is 100 requests per 60s, so 2s spends about a
 * third of that budget. Do not shorten it without raising the limit.
 */
const POLL_MS = 2000

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string | null {
  return organization?.settings?.api_url || null
}

async function getAuthToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token || null
}

/**
 * The poller is module state, not component state.
 *
 * The sidebar navigator and the workspace both call this hook, and a run is
 * global to the organization anyway - so there is exactly one interval for the
 * whole app no matter how many components are mounted.
 */
let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * The run id that was current when a start was requested, or null when we are
 * not waiting for one.
 *
 * A start is optimistic: the button locks before the server has opened its
 * log row. Without this, the first poll would find the *previous* run sitting
 * at 'success' and announce that the sync had finished instantly. Holding the
 * id we started from means "still starting" is distinguishable from "done",
 * and it does so without comparing a server timestamp to a client clock.
 */
let awaitingRunAfter: string | null = null

/**
 * The run whose ending has already been announced.
 *
 * A sync finishing is observed twice by the client that started it: once by the
 * poller, and once when the long POST finally returns. Whichever gets there
 * first claims the run id, so exactly one toast is shown.
 */
let announcedRunId: string | null = null

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * Record a failed status read, and abandon the run once they stop being a
 * blip.
 *
 * Only surfaces an error while a run is believed to be active. A failed read on
 * mount, with nothing in flight, is worth a log line and nothing more.
 */
function noteStatusFailure(status: number | null, cause?: unknown): void {
  const failure = recordPollFailure(status)
  log.warn('[Customers]', 'Sync status poll failed', {
    status,
    consecutiveFailures: failure.consecutive,
    ...(cause === undefined ? {} : { error: cause }),
  })

  const store = usePDMStore.getState()
  if (!store.customerSync.active || !failure.exhausted) return

  stopPolling()
  awaitingRunAfter = null
  store.setCustomerSync({ active: false, stopping: false, error: failure.message })
}

/**
 * Runs the Odoo customer sync.
 *
 * All state lives in the store, so every caller of this hook sees the same run
 * and the same button state. Progress is read back from the server rather than
 * inferred locally, which is what lets a run started before the app was closed
 * still be watched - and stopped - after it reopens.
 */
export function useCustomerSync(onComplete?: () => void): CustomerSyncResult {
  const organization = usePDMStore((s) => s.organization)
  const addToast = usePDMStore((s) => s.addToast)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const state = usePDMStore((s) => s.customerSync)
  const setCustomerSync = usePDMStore((s) => s.setCustomerSync)

  const canSync = hasPermission('module:customers', 'create')

  const request = useCallback(
    async (path: string, method: 'GET' | 'POST'): Promise<Response | null> => {
      const apiUrl = getApiUrl(organization)
      if (!apiUrl) return null
      const token = await getAuthToken()
      if (!token) return null

      return fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
      })
    },
    [organization],
  )

  /**
   * Read the current run once and fold it into the store.
   *
   * Returns the run so the poller can decide whether to keep going. Reading
   * the store through getState rather than the hook's closure keeps this
   * callback stable, so the polling effect is not torn down on every tick.
   */
  const refreshStatus = useCallback(async (): Promise<CustomerSyncRun | null> => {
    try {
      const response = await request('/customers/sync/status', 'GET')
      if (!response || !response.ok) {
        noteStatusFailure(response?.status ?? null)
        return null
      }
      resetPollFailures()

      const data = (await response.json()) as { run: CustomerSyncRun | null }
      const run = data.run ?? null
      const store = usePDMStore.getState()

      // Still waiting for the server to open the row for the run we just asked
      // for. Anything we can see right now belongs to a previous sync.
      if (awaitingRunAfter !== null && (run?.run_id ?? '') === awaitingRunAfter) {
        return run
      }
      awaitingRunAfter = null

      const wasActive = store.customerSync.active
      const running = run?.status === 'running' && !run.stale

      store.setCustomerSync({
        run,
        active: running,
        stopping: running ? store.customerSync.stopping || run.cancel_requested : false,
      })

      // A run that has just left 'running' is the moment the mirror changed,
      // whether this client started it or not.
      if (wasActive && !running) {
        stopPolling()
        store.invalidateCustomerData()

        const unannounced = run !== null && announcedRunId !== run.run_id
        if (run && unannounced) announcedRunId = run.run_id

        if (run?.status === 'failed' || run?.stale) {
          store.setCustomerSync({
            error:
              run?.error_message ??
              'The sync stopped reporting. It may have been interrupted; running it again is safe.',
          })
        } else if (unannounced && run?.status === 'success') {
          addToast('success', 'Customer sync finished')
        } else if (unannounced && run?.status === 'cancelled') {
          addToast('info', 'Customer sync stopped. Running it again resumes from here.')
        }
      }

      return run
    } catch (cause) {
      noteStatusFailure(null, cause)
      return null
    }
  }, [request, addToast])

  const startPolling = useCallback(() => {
    if (pollTimer !== null) return
    pollTimer = setInterval(() => {
      void refreshStatus()
    }, POLL_MS)
  }, [refreshStatus])

  // Attach to whatever is already happening. This is what makes progress
  // reappear after the app is closed and reopened mid-sync.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const run = await refreshStatus()
      if (cancelled) return
      if (run?.status === 'running' && !run.stale) startPolling()
    })()

    return () => {
      cancelled = true
    }
  }, [refreshStatus, startPolling])

  // The interval outlives any single component, so it is only torn down when
  // the last consumer goes away.
  useEffect(() => {
    return () => {
      if (!usePDMStore.getState().customerSync.active) stopPolling()
    }
  }, [])

  const sync = useCallback(async (options?: { full?: boolean }) => {
    const store = usePDMStore.getState()
    if (store.customerSync.active) return

    setCustomerSync({ error: null, result: null })

    const apiUrl = getApiUrl(organization)
    if (!apiUrl) {
      addToast('error', 'API server not configured. Go to Settings > REST API.')
      return
    }

    const token = await getAuthToken()
    if (!token) {
      addToast('error', 'Session expired. Please log in again.')
      return
    }

    // Optimistic, so the button locks on the first click rather than after the
    // first poll comes back. Polls are held from reporting completion until a
    // run newer than this one appears.
    awaitingRunAfter = store.customerSync.run?.run_id ?? ''
    resetPollFailures()
    setCustomerSync({ active: true, stopping: false })
    startPolling()

    try {
      // An empty body leaves the mode to the server, which resumes from the
      // watermark of the last successful run. `full` is the only override.
      const response = await fetch(`${apiUrl}/customers/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(options?.full ? { full: true } : {}),
      })

      const data = (await response.json()) as SyncResponse & {
        message?: string
        cancelled?: boolean
        run_id?: string
        run?: CustomerSyncRun
      }

      if (response.ok) {
        stopPolling()
        awaitingRunAfter = null

        // Claim the announcement before refreshing, so the poller's generic
        // "finished" toast cannot pre-empt the detailed one below.
        const alreadyAnnounced = !!data.run_id && announcedRunId === data.run_id
        if (data.run_id) announcedRunId = data.run_id

        await refreshStatus()

        if (data.cancelled) {
          setCustomerSync({ active: false, stopping: false })
          if (!alreadyAnnounced) {
            addToast('info', 'Customer sync stopped. Running it again resumes from here.')
          }
          onComplete?.()
          return
        }

        const touched = (data.customers?.created ?? 0) + (data.customers?.updated ?? 0)
        setCustomerSync({ active: false, stopping: false, result: data })
        if (!alreadyAnnounced) {
          // Nothing to do is the ordinary outcome of an incremental run, and
          // reporting it as "Synced 0 customers" reads like a failure.
          addToast(
            'success',
            touched === 0
              ? 'Already up to date with Odoo'
              : `Synced ${touched.toLocaleString()} customers from Odoo`,
          )
        }
        onComplete?.()
        return
      }

      // Someone else's run is already going. Watch theirs instead of reporting
      // a failure the user cannot act on.
      if (response.status === 409) {
        awaitingRunAfter = null
        setCustomerSync({ active: true, run: data.run ?? null })
        startPolling()
        addToast('info', 'A sync is already running. Showing its progress.')
        return
      }

      stopPolling()
      awaitingRunAfter = null
      setCustomerSync({ active: false, stopping: false })

      // The API's own message is the specific one (which credential is missing,
      // which environment variable is unset), so it leads; the added sentence
      // only says who can fix it.
      const detail = data.message || `The sync failed with HTTP ${response.status}.`
      if (response.status === 403) {
        setCustomerSync({
          error: `${detail} Running the customer sync needs create access on the Customers module - ask an administrator to grant it.`,
        })
      } else if (response.status === 400) {
        setCustomerSync({ error: `${detail} Odoo is configured in Settings > Google Drive & ERP.` })
      } else if (response.status === 503) {
        setCustomerSync({
          error: `${detail} This is a server-side setup problem an administrator must fix.`,
        })
      } else {
        setCustomerSync({ error: detail })
      }

      log.warn('[Customers]', 'Odoo customer sync rejected', {
        status: response.status,
        message: data.message,
      })
    } catch (cause) {
      log.error('[Customers]', 'Odoo customer sync failed', { error: cause })

      // The request died but the server did not: the sync is still running out
      // there, so keep watching it rather than declaring failure.
      awaitingRunAfter = null
      const run = await refreshStatus()
      if (run?.status === 'running' && !run.stale) {
        startPolling()
        return
      }

      stopPolling()
      setCustomerSync({
        active: false,
        stopping: false,
        error: `Could not reach the API server: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }, [organization, addToast, onComplete, setCustomerSync, refreshStatus, startPolling])

  const stop = useCallback(async () => {
    setCustomerSync({ stopping: true })
    try {
      const response = await request('/customers/sync/cancel', 'POST')
      if (!response || !response.ok) {
        setCustomerSync({ stopping: false })
        if (!response) return

        const data = (await response.json().catch(() => ({}))) as { message?: string }

        // The API has no cancel route, so there is nothing to wait for and
        // nothing more this view can show. Say so where it stays put, rather
        // than in a toast that scrolls away leaving the spinner running.
        if (response.status === 404 && data.message === ROUTE_MISSING_MESSAGE) {
          stopPolling()
          awaitingRunAfter = null
          setCustomerSync({ active: false, error: OUTDATED_API_MESSAGE })
          return
        }

        addToast('error', data.message || 'Could not stop the sync.')
        return
      }
      await refreshStatus()
    } catch (cause) {
      log.error('[Customers]', 'Could not request sync cancellation', { error: cause })
      setCustomerSync({ stopping: false })
      addToast('error', 'Could not reach the API server to stop the sync.')
    }
  }, [request, refreshStatus, setCustomerSync, addToast])

  const dismiss = useCallback(() => {
    setCustomerSync({ result: null, error: null })
  }, [setCustomerSync])

  const dismissResult = useCallback(() => {
    setCustomerSync({ result: null })
  }, [setCustomerSync])

  return {
    sync,
    stop,
    syncing: state.active,
    stopping: state.stopping,
    run: state.run,
    result: (state.result as SyncResponse | null) ?? null,
    error: state.error,
    canSync,
    dismiss,
    dismissResult,
  }
}
