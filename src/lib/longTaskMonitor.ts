/**
 * Main-thread long task monitor.
 *
 * Hover highlighting, cursor shape and scrolling are all recalculated on the
 * main thread, so they only feel slow when something else is holding it. Which
 * subsystem is holding it does not appear anywhere in the session log, so the
 * view that happens to be open gets blamed for blocking it did not cause.
 *
 * This records the blocking itself. Entries carry the active view and a
 * timestamp, so a burst of long tasks can be lined up against the surrounding
 * log lines to find the subsystem responsible.
 */

import { log } from '@/lib/logger'

/**
 * Tasks at or above this get a line of their own. The Long Tasks API only
 * reports at all above 50ms, so anything here is already user-visible; this
 * higher bar picks out the ones that drop a run of frames rather than one.
 */
const REPORT_INDIVIDUALLY_MS = 200

/** Sub-threshold tasks are summarised on this cadence instead of one-by-one. */
const ROLLUP_INTERVAL_MS = 5000

/** The API's own floor, subtracted to get blocking time rather than duration. */
const LONG_TASK_FLOOR_MS = 50

interface Bucket {
  count: number
  totalMs: number
  blockingMs: number
  longestMs: number
}

type ContextProvider = () => Record<string, unknown>

let stop: (() => void) | null = null

function emptyBucket(): Bucket {
  return { count: 0, totalMs: 0, blockingMs: 0, longestMs: 0 }
}

/**
 * Begin watching for long tasks. Safe to call when the API is missing and
 * safe to call twice - the second call is a no-op that returns the first
 * disposer, so a remounting root does not stack observers.
 */
export function startLongTaskMonitor(getContext: ContextProvider = () => ({})): () => void {
  if (stop) return stop

  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    return () => {}
  }

  let bucket = emptyBucket()

  const flush = () => {
    if (bucket.count === 0) return

    const { count, totalMs, blockingMs, longestMs } = bucket
    bucket = emptyBucket()

    log.warn('[Perf]', 'Main thread blocked', {
      tasks: count,
      totalMs: Math.round(totalMs),
      blockingMs: Math.round(blockingMs),
      longestMs: Math.round(longestMs),
      overMs: ROLLUP_INTERVAL_MS,
      ...getContext(),
    })
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const ms = entry.duration

      if (ms >= REPORT_INDIVIDUALLY_MS) {
        log.warn('[Perf]', 'Long task', { ms: Math.round(ms), ...getContext() })
        continue
      }

      bucket.count += 1
      bucket.totalMs += ms
      bucket.blockingMs += ms - LONG_TASK_FLOOR_MS
      bucket.longestMs = Math.max(bucket.longestMs, ms)
    }
  })

  // `buffered` replays tasks recorded before this ran, which covers the boot
  // path - the window where blocking is worst and the observer is not up yet.
  observer.observe({ type: 'longtask', buffered: true })

  const timer = setInterval(flush, ROLLUP_INTERVAL_MS)

  stop = () => {
    clearInterval(timer)
    observer.disconnect()
    flush()
    stop = null
  }

  return stop
}
