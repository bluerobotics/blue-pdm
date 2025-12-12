import { useState, useEffect } from 'react'
import { Cpu, MemoryStick, HardDrive, ArrowDown, ArrowUp } from 'lucide-react'

interface SystemStats {
  cpu: { usage: number; cores: number[] }
  memory: { used: number; total: number; percent: number }
  network: { rxSpeed: number; txSpeed: number }
  disk: { used: number; total: number; percent: number }
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Format network speed
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

// Tiny progress bar component
function MicroBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-6 h-1.5 bg-pdm-bg rounded-sm overflow-hidden">
      <div
        className={`h-full transition-all duration-300 ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

// Get color based on usage percentage
function getBarColor(percent: number): string {
  if (percent < 50) return 'bg-emerald-500'
  if (percent < 75) return 'bg-amber-500'
  return 'bg-rose-500'
}

export function SystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    // Initial fetch
    fetchStats()
    
    // Poll every 2 seconds
    const interval = setInterval(fetchStats, 2000)
    return () => clearInterval(interval)
  }, [])

  const fetchStats = async () => {
    if (!window.electronAPI?.getSystemStats) return
    const data = await window.electronAPI.getSystemStats()
    if (data) setStats(data)
  }

  if (!stats) {
    return (
      <div className="flex items-center gap-3 px-2 text-xs text-pdm-fg-muted animate-pulse">
        <span>...</span>
      </div>
    )
  }

  return (
    <div 
      className="relative flex items-center gap-3 px-2"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* CPU */}
      <div className="flex items-center gap-1" title="CPU">
        <Cpu size={12} className="text-pdm-fg-muted" />
        <MicroBar percent={stats.cpu.usage} color={getBarColor(stats.cpu.usage)} />
        <span className="text-[10px] text-pdm-fg-dim w-6 tabular-nums">{stats.cpu.usage}%</span>
      </div>

      {/* Memory */}
      <div className="flex items-center gap-1" title="Memory">
        <MemoryStick size={12} className="text-pdm-fg-muted" />
        <MicroBar percent={stats.memory.percent} color={getBarColor(stats.memory.percent)} />
        <span className="text-[10px] text-pdm-fg-dim w-6 tabular-nums">{stats.memory.percent}%</span>
      </div>

      {/* Disk */}
      <div className="flex items-center gap-1" title="Disk">
        <HardDrive size={12} className="text-pdm-fg-muted" />
        <MicroBar percent={stats.disk.percent} color={getBarColor(stats.disk.percent)} />
        <span className="text-[10px] text-pdm-fg-dim w-6 tabular-nums">{stats.disk.percent}%</span>
      </div>

      {/* Network - just arrows with speed */}
      <div className="flex items-center gap-0.5 text-[10px] text-pdm-fg-dim" title="Network">
        <ArrowDown size={10} className="text-emerald-500" />
        <span className="w-12 tabular-nums">{formatSpeed(stats.network.rxSpeed)}</span>
        <ArrowUp size={10} className="text-amber-500" />
        <span className="w-12 tabular-nums">{formatSpeed(stats.network.txSpeed)}</span>
      </div>

      {/* Tooltip with detailed info */}
      {showTooltip && (
        <div className="absolute top-full right-0 mt-2 p-3 bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl z-50 text-xs min-w-[220px]">
          <div className="space-y-3">
            {/* CPU Details */}
            <div>
              <div className="flex items-center justify-between text-pdm-fg mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Cpu size={12} />
                  CPU
                </span>
                <span className="font-medium tabular-nums">{stats.cpu.usage}%</span>
              </div>
              <div className="flex gap-0.5">
                {stats.cpu.cores.map((core, i) => (
                  <div
                    key={i}
                    className="flex-1 h-3 bg-pdm-bg rounded-sm overflow-hidden"
                    title={`Core ${i}: ${core}%`}
                  >
                    <div
                      className={`h-full transition-all duration-300 ${getBarColor(core)}`}
                      style={{ width: `${core}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="text-pdm-fg-muted text-[10px] mt-1">
                {stats.cpu.cores.length} cores
              </div>
            </div>

            {/* Memory Details */}
            <div>
              <div className="flex items-center justify-between text-pdm-fg mb-1.5">
                <span className="flex items-center gap-1.5">
                  <MemoryStick size={12} />
                  Memory
                </span>
                <span className="font-medium tabular-nums">{stats.memory.percent}%</span>
              </div>
              <div className="h-2 bg-pdm-bg rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(stats.memory.percent)}`}
                  style={{ width: `${stats.memory.percent}%` }}
                />
              </div>
              <div className="text-pdm-fg-muted text-[10px] mt-1">
                {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
              </div>
            </div>

            {/* Disk Details */}
            <div>
              <div className="flex items-center justify-between text-pdm-fg mb-1.5">
                <span className="flex items-center gap-1.5">
                  <HardDrive size={12} />
                  Disk
                </span>
                <span className="font-medium tabular-nums">{stats.disk.percent}%</span>
              </div>
              <div className="h-2 bg-pdm-bg rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(stats.disk.percent)}`}
                  style={{ width: `${stats.disk.percent}%` }}
                />
              </div>
              <div className="text-pdm-fg-muted text-[10px] mt-1">
                {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)}
              </div>
            </div>

            {/* Network Details */}
            <div>
              <div className="flex items-center gap-1.5 text-pdm-fg mb-1.5">
                <ArrowDown size={12} className="text-emerald-500" />
                <ArrowUp size={12} className="text-amber-500" />
                Network
              </div>
              <div className="flex justify-between text-pdm-fg-muted">
                <span className="flex items-center gap-1">
                  <ArrowDown size={10} className="text-emerald-500" />
                  {formatSpeed(stats.network.rxSpeed)}
                </span>
                <span className="flex items-center gap-1">
                  <ArrowUp size={10} className="text-amber-500" />
                  {formatSpeed(stats.network.txSpeed)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

