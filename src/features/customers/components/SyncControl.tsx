import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, RefreshCw, Square, X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import type { CustomerSyncRun } from '@/stores/types'

import type { CustomerSyncResult } from '../hooks/useCustomerSync'
import { formatCount, formatElapsed } from '../lib/format'

/**
 * Fraction of the whole sync that is done, 0 to 1.
 *
 * Phases are weighted equally. They are not equally long - the Odoo reads
 * dominate - but a bar that advances steadily and predictably is more useful
 * than one weighted by guesses at each phase's duration.
 */
function overallProgress(run: CustomerSyncRun | null): number {
  if (!run || !run.phase_count) return 0
  const withinPhase =
    run.progress_total && run.progress_total > 0
      ? Math.min(1, (run.progress_current ?? 0) / run.progress_total)
      : 0
  return Math.min(1, ((run.phase_index ?? 0) + withinPhase) / run.phase_count)
}

/** `3,500 of 20,000`, or just the running count when the total is unknown. */
function progressCounts(run: CustomerSyncRun | null): string | null {
  if (!run?.progress_current) return null
  if (!run.progress_total) return formatCount(run.progress_current)
  return `${formatCount(run.progress_current)} of ${formatCount(run.progress_total)}`
}

/** Ticks once a second while active, so elapsed time advances on its own. */
function useElapsed(startedAt: string | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!startedAt) return 0
  return now - new Date(startedAt).getTime()
}

/**
 * The one and only control for starting or stopping the Odoo sync.
 *
 * Deliberately singular: state lives in the store, so mounting this twice would
 * still show one consistent button, but there is no reason to.
 */
export function SyncControl({ sync }: { sync: CustomerSyncResult }) {
  const { run, syncing, stopping } = sync
  const elapsed = useElapsed(run?.started_at ?? null, syncing)
  const fraction = overallProgress(run)
  const counts = progressCounts(run)

  return (
    <div className="space-y-2">
      {syncing ? (
        <div className="rounded border border-plm-border bg-plm-bg-light p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={13} className="animate-spin text-plm-accent flex-shrink-0" />
            <span className="flex-1 text-xs text-plm-fg truncate">
              {run?.phase ?? 'Starting…'}
            </span>
            <span className="text-[11px] text-plm-fg-muted tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          </div>

          <div className="h-1 rounded-full bg-plm-bg overflow-hidden">
            <div
              className="h-full bg-plm-accent transition-[width] duration-500 ease-out"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-plm-fg-muted tabular-nums truncate">
              {counts ??
                (run?.phase_count
                  ? `Step ${(run.phase_index ?? 0) + 1} of ${run.phase_count}`
                  : 'Working…')}
            </span>
            <button
              onClick={sync.stop}
              disabled={stopping}
              title="Stop after the current step. Nothing already saved is undone, and the next sync picks up where this one left off."
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 transition-colors disabled:opacity-50"
            >
              <Square size={10} />
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={sync.sync}
          disabled={!sync.canSync}
          title={
            sync.canSync
              ? 'Mirror customers and orders from Odoo'
              : 'Requires create access on the Customers module'
          }
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw size={15} />
          <span>Sync from Odoo</span>
        </button>
      )}

      {sync.error && (
        <div className="flex items-start gap-2 p-2 rounded bg-plm-error/10 border border-plm-error/30">
          <AlertCircle size={13} className="text-plm-error flex-shrink-0 mt-0.5" />
          <span className="flex-1 text-[11px] text-plm-fg-muted">{sync.error}</span>
          <button onClick={sync.dismiss} className="text-plm-fg-muted hover:text-plm-fg">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Read-only echo of the same run, for places that should report progress but
 * must not offer a second way to start or stop it.
 */
export function SyncStatusLine() {
  const state = usePDMStore((s) => s.customerSync)
  const run = state.run
  const elapsed = useElapsed(run?.started_at ?? null, state.active)

  if (!state.active) return null

  const counts = progressCounts(run)

  return (
    <div className="flex items-center gap-2 text-xs text-plm-fg-muted">
      <Loader2 size={13} className="animate-spin text-plm-accent flex-shrink-0" />
      <span className="text-plm-fg">{run?.phase ?? 'Starting…'}</span>
      {counts && <span className="tabular-nums">{counts}</span>}
      <span className="tabular-nums">{formatElapsed(elapsed)}</span>
    </div>
  )
}
