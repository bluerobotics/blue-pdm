import { useState, useEffect } from 'react'
import {
  Timer,
  Folder,
  Database,
  Eye,
  Trash2,
  ChevronDown,
  ChevronRight,
  Rocket,
} from 'lucide-react'
import {
  getMetrics,
  getMetricsSummary,
  clearMetrics,
  subscribeToMetrics,
  type PerformanceEntry,
  type MetricTag,
} from '@/lib/performanceMetrics'

// Tag colors for visual distinction
const TAG_COLORS: Record<MetricTag, string> = {
  Startup: 'text-sky-400 bg-sky-400/10',
  VaultLoad: 'text-lime-400 bg-lime-400/10',
  FolderMetrics: 'text-purple-400 bg-purple-400/10',
  Performance: 'text-fuchsia-400 bg-fuchsia-400/10',
  Store: 'text-blue-400 bg-blue-400/10',
  FileWatcher: 'text-amber-400 bg-amber-400/10',
  Download: 'text-emerald-400 bg-emerald-400/10',
  GetLatest: 'text-emerald-400 bg-emerald-400/10',
  Checkout: 'text-cyan-400 bg-cyan-400/10',
  Checkin: 'text-cyan-400 bg-cyan-400/10',
  Delete: 'text-red-400 bg-red-400/10',
  Discard: 'text-orange-400 bg-orange-400/10',
  Sync: 'text-teal-400 bg-teal-400/10',
  ForceRelease: 'text-rose-400 bg-rose-400/10',
  SyncMetadata: 'text-indigo-400 bg-indigo-400/10',
}

// Session start timestamp - captured when the app starts
// This persists across component re-renders but resets when app restarts
const SESSION_START = Date.now()

type TimeRange = 'session' | 'all'

export function FileOperationTiming() {
  const [entries, setEntries] = useState<PerformanceEntry[]>([])
  const [summary, setSummary] = useState(getMetricsSummary())
  const [expanded, setExpanded] = useState(true)
  const [tagFilter, setTagFilter] = useState<MetricTag | 'all'>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('session') // Default to this session

  useEffect(() => {
    // Initial load
    setEntries(getMetrics())
    setSummary(getMetricsSummary())

    // Subscribe to updates
    const unsubscribe = subscribeToMetrics(() => {
      setEntries(getMetrics())
      setSummary(getMetricsSummary())
    })

    return () => unsubscribe()
  }, [])

  // Apply both tag and time range filters
  const filteredEntries = entries.filter((e) => {
    // Tag filter
    if (tagFilter !== 'all' && e.tag !== tagFilter) return false
    // Time range filter
    if (timeRange === 'session' && e.timestamp < SESSION_START) return false
    return true
  })

  const handleClear = () => {
    clearMetrics()
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const timeStr = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    // Add milliseconds manually
    const ms = date.getMilliseconds().toString().padStart(3, '0')
    return `${timeStr}.${ms}`
  }

  const formatDuration = (ms: number | undefined) => {
    if (ms === undefined) return '—'
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
    if (ms < 1000) return `${ms.toFixed(1)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatMs = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined) return '—'
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
    if (ms < 1000) return `${ms.toFixed(1)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div className="space-y-4">
      {/* Startup Timing Card - Full Width */}
      <div className="bg-plm-bg rounded-lg p-3 border border-plm-border">
        <div className="flex items-center gap-2 mb-3">
          <Rocket size={14} className="text-sky-400" />
          <span className="text-[10px] uppercase tracking-wide text-plm-fg-muted">
            App Ready Time
          </span>
          <span className="text-[9px] text-plm-fg-muted ml-2">
            ({entries.filter((e) => e.tag === 'Startup').length} startup,{' '}
            {entries.filter((e) => e.tag === 'VaultLoad').length} vault metrics)
          </span>
          {summary.startup.totalMs && (
            <span className="ml-auto text-sm font-mono text-plm-fg">
              Total:{' '}
              <span
                className={
                  summary.startup.totalMs > 10000
                    ? 'text-red-400'
                    : summary.startup.totalMs > 5000
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }
              >
                {formatMs(summary.startup.totalMs)}
              </span>
            </span>
          )}
        </div>

        {/* Two-row layout: Startup phases, then Vault load phases */}
        <div className="space-y-2">
          {/* Row 1: Startup (splash screen) */}
          <div className="flex items-center gap-2">
            <div className="text-[9px] text-plm-fg-muted w-16 shrink-0">
              Startup
              <span className="text-sky-400 ml-1">({formatMs(summary.startup.startupMs)})</span>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2 text-[10px]">
              <div className="bg-plm-bg-light rounded p-2">
                <div className="text-plm-fg-muted mb-0.5">Hydration</div>
                <div className="font-mono text-plm-fg">{formatMs(summary.startup.hydrationMs)}</div>
              </div>
              <div className="bg-plm-bg-light rounded p-2">
                <div className="text-plm-fg-muted mb-0.5">Auth</div>
                <div className="font-mono text-plm-fg">{formatMs(summary.startup.authMs)}</div>
              </div>
              <div className="bg-plm-bg-light rounded p-2">
                <div className="text-plm-fg-muted mb-0.5">Org Load</div>
                <div className="font-mono text-plm-fg">{formatMs(summary.startup.orgMs)}</div>
              </div>
            </div>
          </div>

          {/* Row 2: Vault Load */}
          <div className="flex items-center gap-2">
            <div className="text-[9px] text-plm-fg-muted w-16 shrink-0">
              Vault Load
              <span className="text-lime-400 ml-1">({formatMs(summary.startup.vaultLoadMs)})</span>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2 text-[10px]">
              <div className="bg-plm-bg-light rounded p-2">
                <div className="text-plm-fg-muted mb-0.5">Local Scan</div>
                <div className="font-mono text-lime-400">
                  {formatMs(summary.startup.localScanMs)}
                </div>
              </div>
              <div className="bg-plm-bg-light rounded p-2">
                <div className="text-plm-fg-muted mb-0.5">Server Fetch</div>
                <div className="font-mono text-lime-400">
                  {formatMs(summary.startup.serverFetchMs)}
                </div>
              </div>
              <div className="bg-plm-bg-light rounded p-2">
                <div className="text-plm-fg-muted mb-0.5">Merge</div>
                <div className="font-mono text-lime-400">{formatMs(summary.startup.mergeMs)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          icon={<Folder size={14} />}
          label="Folder Metrics"
          count={summary.folderMetrics.count}
          avgMs={summary.folderMetrics.avgDurationMs}
          lastMs={summary.folderMetrics.lastDurationMs}
          color="text-purple-400"
        />
        <SummaryCard
          icon={<Database size={14} />}
          label="Store Updates"
          count={summary.storeUpdates.count}
          avgMs={summary.storeUpdates.avgDurationMs}
          lastMs={summary.storeUpdates.lastDurationMs}
          color="text-blue-400"
        />
        <SummaryCard
          icon={<Eye size={14} />}
          label="File Watcher"
          count={summary.fileWatcher.eventCount}
          extra={
            <div className="text-[10px] text-plm-fg-muted mt-0.5">
              <span className="text-emerald-400">{summary.fileWatcher.refreshesSuppressed}</span>
              {' suppressed / '}
              <span className="text-amber-400">{summary.fileWatcher.refreshesTriggered}</span>
              {' triggered'}
            </div>
          }
          color="text-amber-400"
        />
      </div>

      {/* Log Entries */}
      <div className="bg-plm-bg-lighter rounded-lg border border-plm-border overflow-hidden">
        <div
          className="flex items-center justify-between px-3 py-2 bg-plm-bg-light border-b border-plm-border cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Timer size={14} className="text-plm-fg-muted" />
            <span className="text-sm font-medium text-plm-fg">Recent Timings</span>
            <span className="text-xs text-plm-fg-muted">({filteredEntries.length} entries)</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Time range filter - defaults to This Session */}
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              onClick={(e) => e.stopPropagation()}
              className="text-xs bg-plm-bg border border-plm-border rounded px-2 py-0.5 text-plm-fg"
            >
              <option value="session">This Session</option>
              <option value="all">All Time</option>
            </select>

            {/* Tag filter */}
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value as MetricTag | 'all')}
              onClick={(e) => e.stopPropagation()}
              className="text-xs bg-plm-bg border border-plm-border rounded px-2 py-0.5 text-plm-fg"
            >
              <option value="all">All Tags</option>
              <option value="Startup">Startup</option>
              <option value="VaultLoad">VaultLoad</option>
              <option value="FolderMetrics">FolderMetrics</option>
              <option value="Performance">Performance</option>
              <option value="Store">Store</option>
              <option value="FileWatcher">FileWatcher</option>
              <option value="Download">Download</option>
              <option value="GetLatest">GetLatest</option>
              <option value="Checkout">Checkout</option>
              <option value="Checkin">Checkin</option>
            </select>

            <button
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs text-plm-fg-muted hover:text-plm-error rounded hover:bg-plm-bg transition-colors"
            >
              <Trash2 size={12} />
              Clear
            </button>
          </div>
        </div>

        {expanded && (
          <div className="max-h-[300px] overflow-y-auto">
            {filteredEntries.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-plm-fg-muted">
                No timing entries recorded yet.
                <br />
                <span className="text-xs">Perform file operations to see timing data.</span>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-plm-bg-light sticky top-0">
                  <tr className="text-left text-plm-fg-muted">
                    <th className="px-3 py-1.5 font-medium">Time</th>
                    <th className="px-3 py-1.5 font-medium">Tag</th>
                    <th className="px-3 py-1.5 font-medium">Message</th>
                    <th className="px-3 py-1.5 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-plm-border/50">
                  {[...filteredEntries].reverse().map((entry) => (
                    <tr key={entry.id} className="hover:bg-plm-bg-light/50">
                      <td className="px-3 py-1.5 font-mono text-plm-fg-muted whitespace-nowrap">
                        {formatTime(entry.timestamp)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TAG_COLORS[entry.tag]}`}
                        >
                          {entry.tag}
                        </span>
                      </td>
                      <td
                        className="px-3 py-1.5 text-plm-fg max-w-[200px] truncate"
                        title={entry.message}
                      >
                        {entry.message}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-right whitespace-nowrap">
                        {entry.durationMs !== undefined ? (
                          <span
                            className={
                              entry.durationMs > 100
                                ? 'text-amber-400'
                                : entry.durationMs > 500
                                  ? 'text-red-400'
                                  : 'text-emerald-400'
                            }
                          >
                            {formatDuration(entry.durationMs)}
                          </span>
                        ) : (
                          <span className="text-plm-fg-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  count,
  avgMs,
  lastMs,
  extra,
  color,
}: {
  icon: React.ReactNode
  label: string
  count: number
  avgMs?: number
  lastMs?: number | null
  extra?: React.ReactNode
  color: string
}) {
  const formatMs = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined) return '—'
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
    if (ms < 1000) return `${ms.toFixed(1)}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  return (
    <div className="bg-plm-bg rounded-lg p-3 border border-plm-border">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={color}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wide text-plm-fg-muted">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-mono tabular-nums ${color}`}>{count}</span>
        <span className="text-[10px] text-plm-fg-muted">events</span>
      </div>
      {avgMs !== undefined && lastMs !== undefined && (
        <div className="text-[10px] text-plm-fg-muted mt-1">
          Last: <span className="font-mono text-plm-fg">{formatMs(lastMs)}</span>
          {' · '}
          Avg: <span className="font-mono text-plm-fg">{formatMs(avgMs)}</span>
        </div>
      )}
      {extra}
    </div>
  )
}
