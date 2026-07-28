import { usePDMStore } from '@/stores/pdmStore'

/**
 * How long an expected-change registration survives after the write completes.
 *
 * Must outlast the whole watcher debounce chain, otherwise our own write is
 * reclassified as an external change: chokidar awaitWriteFinish (1s) +
 * main-process notify debounce (1s) + renderer debounce in App.tsx (1s).
 */
export const WATCHER_SUPPRESSION_MS = 5000

/**
 * Backstop for callers that never release (an unexpected throw, an early return on a
 * path the author missed). Long enough that it cannot fire during a legitimate bulk
 * operation, short enough that a missed release cannot suppress a path for the whole
 * session. Long operations are additionally covered by `processingOperations`.
 */
export const WATCHER_SUPPRESSION_MAX_LIFETIME_MS = 300_000

/**
 * The subset of store/command-context actions needed to suppress the watcher.
 * Command handlers pass their `ctx`; renderer code uses the store default.
 */
export interface WatcherSuppressionTarget {
  addExpectedFileChanges: (paths: string[]) => void
  clearExpectedFileChanges: (paths: string[]) => void
  setLastOperationCompletedAt: (timestamp: number) => void
}

const noop = () => {}

/**
 * Marks paths as self-written so the file watcher does not classify the resulting
 * change events as external and trigger a full vault reload.
 *
 * Returns a release function that must be called once the write finishes, ideally
 * from a `finally` block. Registrations are plain Set membership with no TTL of
 * their own, so one that is never released silently suppresses that path for the
 * rest of the session.
 */
export function beginWatcherSuppression(
  paths: string[],
  target: WatcherSuppressionTarget = usePDMStore.getState(),
): () => void {
  if (paths.length === 0) return noop

  target.addExpectedFileChanges(paths)
  target.setLastOperationCompletedAt(Date.now())

  let released = false

  const safetyNet = setTimeout(() => {
    if (released) return
    released = true
    target.clearExpectedFileChanges(paths)
  }, WATCHER_SUPPRESSION_MAX_LIFETIME_MS)

  return () => {
    if (released) return
    released = true
    clearTimeout(safetyNet)

    // Re-stamp so the suppression window covers the debounce that starts when the
    // write completes rather than when it started. SolidWorks writes can take
    // seconds, which would otherwise consume the entire window.
    target.setLastOperationCompletedAt(Date.now())
    setTimeout(() => target.clearExpectedFileChanges(paths), WATCHER_SUPPRESSION_MS)
  }
}
