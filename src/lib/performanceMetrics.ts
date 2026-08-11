/**
 * Performance Metrics Capture
 *
 * Simple module to capture timing metrics from various parts of the app
 * for display in the DevTools dashboard.
 */

export type MetricTag =
  | 'Startup' // App startup phases (hydration, auth, org loading)
  | 'VaultLoad' // Vault loading operations (local scan, server fetch, merge)
  | 'FolderMetrics'
  | 'Performance'
  | 'Store'
  | 'FileWatcher'
  | 'Download'
  | 'GetLatest'
  | 'Checkout'
  | 'Checkin'
  | 'Delete'
  | 'Discard'
  | 'Sync'
  | 'ForceRelease'
  | 'SyncMetadata'

export interface PerformanceEntry {
  id: string
  tag: MetricTag
  message: string
  data: Record<string, unknown>
  timestamp: number
  durationMs?: number
}

// Circular buffer for entries
const MAX_ENTRIES = 100
let entries: PerformanceEntry[] = []
let entryIdCounter = 0
let listeners: Set<() => void> = new Set()

/**
 * Record a performance metric entry
 */
export function recordMetric(
  tag: MetricTag,
  message: string,
  data: Record<string, unknown> = {},
): void {
  const entry: PerformanceEntry = {
    id: `${tag}-${++entryIdCounter}`,
    tag,
    message,
    data,
    timestamp: Date.now(),
    durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
  }

  entries.push(entry)

  // Trim to max size
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES)
  }

  // Notify listeners
  listeners.forEach((fn) => fn())
}

/**
 * Get all recorded entries
 */
export function getMetrics(): PerformanceEntry[] {
  return [...entries]
}

/**
 * Get entries filtered by tag
 */
export function getMetricsByTag(tag: MetricTag): PerformanceEntry[] {
  return entries.filter((e) => e.tag === tag)
}

/**
 * Clear all recorded entries
 */
export function clearMetrics(): void {
  entries = []
  listeners.forEach((fn) => fn())
}

/**
 * Subscribe to metric updates
 * Returns unsubscribe function
 */
export function subscribeToMetrics(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/**
 * Startup timing breakdown for DevTools display
 */
export interface StartupTiming {
  /** Splash screen startup time only */
  startupMs: number | null
  /** Total vault load time */
  vaultLoadMs: number | null
  /** Combined total: startup + vault load (time until app is usable) */
  totalMs: number | null
  /** Store hydration time */
  hydrationMs: number | null
  /** Auth session restore time */
  authMs: number | null
  /** Organization loading time */
  orgMs: number | null
  /** Local file scan time (Electron) */
  localScanMs: number | null
  /** Server file fetch time (Supabase) */
  serverFetchMs: number | null
  /** File merge and diff computation time */
  mergeMs: number | null
}

/**
 * Get the most recent startup timing breakdown
 */
export function getStartupTiming(): StartupTiming {
  // Case-insensitive search for more robust matching
  const findLatest = (tag: MetricTag, messageIncludes: string): number | null => {
    const searchLower = messageIncludes.toLowerCase()
    const matching = entries.filter(
      (e) =>
        e.tag === tag &&
        e.message.toLowerCase().includes(searchLower) &&
        e.durationMs !== undefined,
    )
    return matching.length > 0 ? (matching[matching.length - 1].durationMs ?? null) : null
  }

  const startupMs = findLatest('Startup', 'Total startup')
  const vaultLoadMs = findLatest('VaultLoad', 'Total vault load')

  // Calculate combined total (startup + vault load)
  let totalMs: number | null = null
  if (startupMs !== null && vaultLoadMs !== null) {
    totalMs = startupMs + vaultLoadMs
  } else if (vaultLoadMs !== null) {
    totalMs = vaultLoadMs // If no startup time, just use vault load
  } else if (startupMs !== null) {
    totalMs = startupMs // If no vault load, just use startup
  }

  return {
    startupMs,
    vaultLoadMs,
    totalMs,
    hydrationMs: findLatest('Startup', 'Store hydration'),
    authMs: findLatest('Startup', 'Auth session'),
    orgMs: findLatest('Startup', 'Organization load'),
    localScanMs: findLatest('VaultLoad', 'Local scan complete'),
    serverFetchMs: findLatest('VaultLoad', 'Server fetch complete'),
    mergeMs: findLatest('VaultLoad', 'Merge'),
  }
}

/**
 * Get statistics summary
 */
export function getMetricsSummary(): {
  folderMetrics: { count: number; avgDurationMs: number; lastDurationMs: number | null }
  storeUpdates: { count: number; avgDurationMs: number; lastDurationMs: number | null }
  fileWatcher: { eventCount: number; refreshesTriggered: number; refreshesSuppressed: number }
  startup: StartupTiming
} {
  const folderMetricsEntries = entries.filter(
    (e) => e.tag === 'FolderMetrics' && e.message.includes('complete'),
  )
  const storeEntries = entries.filter((e) => e.tag === 'Store' && e.message.includes('COMPLETE'))
  const watcherEvents = entries.filter((e) => e.tag === 'FileWatcher')
  const decisions = watcherEvents.filter((e) => e.message.includes('Decision'))

  const avgDuration = (entries: PerformanceEntry[]) => {
    const withDuration = entries.filter((e) => e.durationMs !== undefined)
    if (withDuration.length === 0) return 0
    return withDuration.reduce((sum, e) => sum + (e.durationMs || 0), 0) / withDuration.length
  }

  const lastDuration = (entries: PerformanceEntry[]) => {
    const withDuration = entries.filter((e) => e.durationMs !== undefined)
    return withDuration.length > 0
      ? (withDuration[withDuration.length - 1].durationMs ?? null)
      : null
  }

  return {
    folderMetrics: {
      count: folderMetricsEntries.length,
      avgDurationMs: Math.round(avgDuration(folderMetricsEntries) * 100) / 100,
      lastDurationMs: lastDuration(folderMetricsEntries),
    },
    storeUpdates: {
      count: storeEntries.length,
      avgDurationMs: Math.round(avgDuration(storeEntries) * 100) / 100,
      lastDurationMs: lastDuration(storeEntries),
    },
    fileWatcher: {
      eventCount: watcherEvents.filter((e) => e.message.includes('received')).length,
      refreshesTriggered: decisions.filter((e) => e.data.willTriggerRefresh === true).length,
      refreshesSuppressed: decisions.filter((e) => e.data.willTriggerRefresh === false).length,
    },
    startup: getStartupTiming(),
  }
}
