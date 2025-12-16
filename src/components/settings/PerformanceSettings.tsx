import { useState, useEffect } from 'react'
import { Activity, Gauge, Cpu, MemoryStick, Wifi, Box, RefreshCw, Trash2 } from 'lucide-react'
import { telemetry, TelemetrySnapshot, TelemetryConfig, getModules, ModuleMemory } from '@/lib/telemetry'
import { TelemetryDashboard } from '../TelemetryGraph'
import { ProcessView } from '../ModuleTracker'

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function PerformanceSettings() {
  const [activeSection, setActiveSection] = useState<'telemetry' | 'processes'>('telemetry')
  const [modules, setModules] = useState<ModuleMemory[]>([])
  const [config, setConfig] = useState<TelemetryConfig>(telemetry.getConfig())
  const [latestSnapshot, setLatestSnapshot] = useState<TelemetrySnapshot | null>(null)
  
  // Load config and subscribe to updates
  useEffect(() => {
    telemetry.loadConfig()
    setConfig(telemetry.getConfig())
    
    // Update modules list periodically
    const interval = setInterval(() => {
      setModules(getModules())
    }, 1000)
    
    // Subscribe to telemetry for live stats
    const unsubscribe = telemetry.subscribe((snapshot) => {
      setLatestSnapshot(snapshot)
      setModules(getModules())
    })
    
    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [])
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-plm-fg mb-1">Performance</h2>
        <p className="text-sm text-plm-fg-muted">
          Monitor system performance, CPU, memory usage, and track module memory consumption.
        </p>
      </div>
      
      {/* Quick Stats Bar */}
      <div className="grid grid-cols-5 gap-3">
        <QuickStatCard
          icon={<Gauge size={16} />}
          label="FPS"
          value={latestSnapshot?.fps ?? 0}
          format={(v) => `${v}`}
          color="text-emerald-400"
        />
        <QuickStatCard
          icon={<Cpu size={16} />}
          label="CPU"
          value={latestSnapshot?.cpu ?? 0}
          format={(v) => `${v}%`}
          color="text-blue-400"
        />
        <QuickStatCard
          icon={<MemoryStick size={16} />}
          label="Memory"
          value={latestSnapshot?.memory.system ?? 0}
          format={(v) => `${v}%`}
          color="text-purple-400"
        />
        <QuickStatCard
          icon={<Box size={16} />}
          label="App Memory"
          value={latestSnapshot?.memory.app.rss ?? 0}
          format={formatBytes}
          color="text-amber-400"
        />
        <QuickStatCard
          icon={<Wifi size={16} />}
          label="Network"
          value={(latestSnapshot?.network.rxSpeed ?? 0) + (latestSnapshot?.network.txSpeed ?? 0)}
          format={(v) => v < 1024 ? `${v} B/s` : v < 1024 * 1024 ? `${(v/1024).toFixed(0)} KB/s` : `${(v/1024/1024).toFixed(1)} MB/s`}
          color="text-cyan-400"
        />
      </div>
      
      {/* Section Tabs */}
      <div className="flex items-center gap-2 border-b border-plm-border">
        <button
          onClick={() => setActiveSection('telemetry')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'telemetry'
              ? 'text-plm-accent border-plm-accent'
              : 'text-plm-fg-muted border-transparent hover:text-plm-fg'
          }`}
        >
          <Activity size={16} />
          Telemetry Logs
        </button>
        <button
          onClick={() => setActiveSection('processes')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'processes'
              ? 'text-plm-accent border-plm-accent'
              : 'text-plm-fg-muted border-transparent hover:text-plm-fg'
          }`}
        >
          <Box size={16} />
          Processes
          <span className="px-1.5 py-0.5 text-[10px] bg-plm-bg-lighter rounded">
            {modules.length}
          </span>
        </button>
      </div>
      
      {/* Section Content */}
      {activeSection === 'telemetry' && (
        <div className="space-y-4">
          <TelemetryDashboard />
        </div>
      )}
      
      {activeSection === 'processes' && (
        <div className="space-y-4">
          {/* Refresh and info */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-plm-fg-muted">
              Track memory usage per app module. Add <code className="px-1 py-0.5 bg-plm-bg rounded text-plm-accent">useModuleTracker('name')</code> to components.
            </p>
            <button
              onClick={() => setModules(getModules())}
              className="flex items-center gap-1 px-2 py-1 text-xs text-plm-fg-muted hover:text-plm-fg rounded hover:bg-plm-bg-lighter transition-colors"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          
          <ProcessView modules={modules} />
        </div>
      )}
      
      {/* Configuration Section */}
      <div className="pt-4 border-t border-plm-border">
        <h3 className="text-sm font-medium text-plm-fg mb-3">Settings</h3>
        
        <div className="space-y-4">
          {/* Sample Rate */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-plm-fg">Sample Rate</label>
              <p className="text-xs text-plm-fg-muted">How often to collect telemetry data</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="1"
                max="60"
                value={config.sampleRateHz}
                onChange={(e) => {
                  const newConfig = { ...config, sampleRateHz: parseInt(e.target.value) }
                  telemetry.configure(newConfig)
                  setConfig(newConfig)
                }}
                className="w-24 h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-plm-accent"
              />
              <span className="text-xs text-plm-fg-muted w-12 text-right">{config.sampleRateHz}Hz</span>
            </div>
          </div>
          
          {/* Retention Time */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-plm-fg">Retention Time</label>
              <p className="text-xs text-plm-fg-muted">How long to keep telemetry history</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="10"
                max="300"
                step="10"
                value={config.retentionSeconds}
                onChange={(e) => {
                  const newConfig = { ...config, retentionSeconds: parseInt(e.target.value) }
                  telemetry.configure(newConfig)
                  setConfig(newConfig)
                }}
                className="w-24 h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-plm-accent"
              />
              <span className="text-xs text-plm-fg-muted w-12 text-right">{config.retentionSeconds}s</span>
            </div>
          </div>
          
          {/* Buffer Info */}
          <div className="flex items-center justify-between text-xs text-plm-fg-muted">
            <span>Buffer size: {config.sampleRateHz * config.retentionSeconds} samples</span>
            <button
              onClick={() => {
                telemetry.clear()
                setLatestSnapshot(null)
              }}
              className="flex items-center gap-1 px-2 py-1 text-plm-fg-muted hover:text-plm-error rounded hover:bg-plm-bg-lighter transition-colors"
            >
              <Trash2 size={12} />
              Clear Data
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Quick stat card component
function QuickStatCard({
  icon,
  label,
  value,
  format,
  color
}: {
  icon: React.ReactNode
  label: string
  value: number
  format: (v: number) => string
  color: string
}) {
  return (
    <div className="bg-plm-bg-lighter rounded-lg p-3 border border-plm-border">
      <div className="flex items-center gap-2 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wide text-plm-fg-muted">{label}</span>
      </div>
      <div className={`text-lg font-mono tabular-nums ${color}`}>
        {format(value)}
      </div>
    </div>
  )
}

export default PerformanceSettings

