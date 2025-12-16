import { useState, useEffect, useRef, useMemo } from 'react'
import { telemetry, TelemetrySnapshot } from '@/lib/telemetry'
import { Play, Pause, Trash2, Settings2 } from 'lucide-react'

interface TelemetryGraphProps {
  metric: 'fps' | 'cpu' | 'memory' | 'network' | 'appMemory'
  height?: number
  showControls?: boolean
  color?: string
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Format speed
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

const METRIC_CONFIG = {
  fps: { label: 'FPS', color: '#22c55e', max: 120, format: (v: number) => `${v}` },
  cpu: { label: 'CPU', color: '#3b82f6', max: 100, format: (v: number) => `${v}%` },
  memory: { label: 'System Memory', color: '#8b5cf6', max: 100, format: (v: number) => `${v}%` },
  network: { label: 'Network', color: '#06b6d4', max: 10 * 1024 * 1024, format: formatSpeed },
  appMemory: { label: 'App Memory', color: '#f59e0b', max: 2 * 1024 * 1024 * 1024, format: formatBytes }
}

export function TelemetryGraph({ 
  metric, 
  height = 80, 
  showControls = false,
  color 
}: TelemetryGraphProps) {
  const [data, setData] = useState<TelemetrySnapshot[]>([])
  const [isRunning, setIsRunning] = useState(telemetry.isRunning())
  const [currentValue, setCurrentValue] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)
  
  const config = METRIC_CONFIG[metric]
  const graphColor = color || config.color
  
  // Get value from snapshot based on metric
  const getValue = (snapshot: TelemetrySnapshot): number => {
    switch (metric) {
      case 'fps': return snapshot.fps
      case 'cpu': return snapshot.cpu
      case 'memory': return snapshot.memory.system
      case 'network': return snapshot.network.rxSpeed + snapshot.network.txSpeed
      case 'appMemory': return snapshot.memory.app.rss
      default: return 0
    }
  }
  
  // Subscribe to telemetry updates
  useEffect(() => {
    // Load initial data
    setData(telemetry.getHistory())
    setIsRunning(telemetry.isRunning())
    
    const unsubscribe = telemetry.subscribe((snapshot) => {
      setData(telemetry.getHistory())
      setCurrentValue(getValue(snapshot))
    })
    
    return unsubscribe
  }, [metric])
  
  // Observe container width
  useEffect(() => {
    if (!containerRef.current) return
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width)
      }
    })
    
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])
  
  // Generate SVG path for the graph
  const path = useMemo(() => {
    if (data.length < 2) return ''
    
    const points: string[] = []
    const maxValue = Math.max(config.max, ...data.map(getValue))
    
    data.forEach((snapshot, i) => {
      const x = (i / (data.length - 1)) * width
      const value = getValue(snapshot)
      const y = height - (value / maxValue) * (height - 10) - 5
      
      if (i === 0) {
        points.push(`M ${x} ${y}`)
      } else {
        points.push(`L ${x} ${y}`)
      }
    })
    
    return points.join(' ')
  }, [data, width, height, config.max])
  
  // Generate filled area path
  const areaPath = useMemo(() => {
    if (data.length < 2) return ''
    return `${path} L ${width} ${height} L 0 ${height} Z`
  }, [path, width, height])
  
  const handleToggle = () => {
    if (isRunning) {
      telemetry.stop()
    } else {
      telemetry.start()
    }
    setIsRunning(!isRunning)
  }
  
  const handleClear = () => {
    telemetry.clear()
    setData([])
  }
  
  return (
    <div ref={containerRef} className="relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-plm-fg">{config.label}</span>
          <span 
            className="text-xs font-mono tabular-nums"
            style={{ color: graphColor }}
          >
            {config.format(currentValue)}
          </span>
        </div>
        
        {showControls && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggle}
              className="p-1 rounded hover:bg-plm-bg-lighter text-plm-fg-muted hover:text-plm-fg transition-colors"
              title={isRunning ? 'Pause' : 'Start'}
            >
              {isRunning ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={handleClear}
              className="p-1 rounded hover:bg-plm-bg-lighter text-plm-fg-muted hover:text-plm-fg transition-colors"
              title="Clear data"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
      
      {/* Graph */}
      <div 
        className="bg-plm-bg rounded border border-plm-border overflow-hidden"
        style={{ height }}
      >
        <svg width={width} height={height} className="block">
          {/* Grid lines */}
          <defs>
            <pattern id={`grid-${metric}`} width="40" height="20" patternUnits="userSpaceOnUse">
              <path 
                d="M 40 0 L 0 0 0 20" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="0.5"
                className="text-plm-border"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#grid-${metric})`} />
          
          {/* Area fill */}
          {areaPath && (
            <path
              d={areaPath}
              fill={graphColor}
              fillOpacity={0.1}
            />
          )}
          
          {/* Line */}
          {path && (
            <path
              d={path}
              fill="none"
              stroke={graphColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          
          {/* Current value indicator */}
          {data.length > 0 && (
            <circle
              cx={width - 2}
              cy={height - (currentValue / Math.max(config.max, currentValue)) * (height - 10) - 5}
              r={3}
              fill={graphColor}
            />
          )}
        </svg>
      </div>
      
      {/* Time axis labels */}
      <div className="flex justify-between mt-0.5 text-[9px] text-plm-fg-muted">
        <span>{telemetry.getConfig().retentionSeconds}s ago</span>
        <span>now</span>
      </div>
    </div>
  )
}

// Multi-graph view showing all metrics
export function TelemetryDashboard() {
  const [isRunning, setIsRunning] = useState(telemetry.isRunning())
  const [config, setConfig] = useState(telemetry.getConfig())
  const [showSettings, setShowSettings] = useState(false)
  
  useEffect(() => {
    telemetry.loadConfig()
    setConfig(telemetry.getConfig())
    setIsRunning(telemetry.isRunning())
  }, [])
  
  const handleToggle = () => {
    if (isRunning) {
      telemetry.stop()
    } else {
      telemetry.start()
    }
    setIsRunning(!isRunning)
  }
  
  const handleConfigChange = (key: keyof typeof config, value: number | boolean) => {
    const newConfig = { ...config, [key]: value }
    telemetry.configure(newConfig)
    setConfig(newConfig)
    setIsRunning(telemetry.isRunning())
  }
  
  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              isRunning 
                ? 'bg-plm-error/20 text-plm-error hover:bg-plm-error/30' 
                : 'bg-plm-accent/20 text-plm-accent hover:bg-plm-accent/30'
            }`}
          >
            {isRunning ? <Pause size={14} /> : <Play size={14} />}
            {isRunning ? 'Stop Recording' : 'Start Recording'}
          </button>
          
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-plm-fg-muted">
              <span className="w-2 h-2 rounded-full bg-plm-error animate-pulse" />
              Recording at {config.sampleRateHz}Hz
            </span>
          )}
        </div>
        
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-1.5 rounded transition-colors ${
            showSettings ? 'bg-plm-bg-lighter text-plm-fg' : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
          }`}
          title="Settings"
        >
          <Settings2 size={16} />
        </button>
      </div>
      
      {/* Settings panel */}
      {showSettings && (
        <div className="p-3 bg-plm-bg rounded-lg border border-plm-border space-y-3">
          <h4 className="text-xs font-medium text-plm-fg">Telemetry Settings</h4>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-plm-fg-muted block mb-1">Sample Rate (Hz)</label>
              <input
                type="range"
                min="1"
                max="60"
                value={config.sampleRateHz}
                onChange={(e) => handleConfigChange('sampleRateHz', parseInt(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-plm-accent"
              />
              <span className="text-[10px] text-plm-fg-muted">{config.sampleRateHz}Hz</span>
            </div>
            
            <div>
              <label className="text-[10px] text-plm-fg-muted block mb-1">Retention (seconds)</label>
              <input
                type="range"
                min="10"
                max="300"
                step="10"
                value={config.retentionSeconds}
                onChange={(e) => handleConfigChange('retentionSeconds', parseInt(e.target.value))}
                className="w-full h-1.5 bg-plm-border rounded-full appearance-none cursor-pointer accent-plm-accent"
              />
              <span className="text-[10px] text-plm-fg-muted">{config.retentionSeconds}s</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Graphs */}
      <div className="grid grid-cols-1 gap-4">
        <TelemetryGraph metric="fps" height={100} showControls />
        <TelemetryGraph metric="cpu" height={100} />
        <TelemetryGraph metric="memory" height={100} />
        <TelemetryGraph metric="appMemory" height={100} />
        <TelemetryGraph metric="network" height={100} />
      </div>
    </div>
  )
}

