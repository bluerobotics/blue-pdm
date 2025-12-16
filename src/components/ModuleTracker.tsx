import { useEffect, useRef } from 'react'
import { registerModule, unregisterModule, updateModuleMemory, getModules, ModuleMemory } from '@/lib/telemetry'

// Hook to track a component/module's memory usage
export function useModuleTracker(moduleName: string): void {
  const registeredRef = useRef(false)
  
  useEffect(() => {
    if (!registeredRef.current) {
      registerModule(moduleName)
      registeredRef.current = true
    }
    
    // Periodically estimate memory (rough approximation using performance API)
    const interval = setInterval(() => {
      // Try to use performance.measureUserAgentSpecificMemory if available (Chrome)
      // Otherwise use a rough estimate based on DOM size
      try {
        const element = document.querySelector(`[data-module="${moduleName}"]`)
        if (element) {
          // Rough estimate: count DOM nodes * average node memory
          const nodeCount = element.querySelectorAll('*').length
          const estimatedMemory = nodeCount * 1000 // ~1KB per node (rough)
          updateModuleMemory(moduleName, estimatedMemory)
        }
      } catch {
        // Ignore errors
      }
    }, 2000)
    
    return () => {
      clearInterval(interval)
      unregisterModule(moduleName)
      registeredRef.current = false
    }
  }, [moduleName])
}

// Higher-order component to add module tracking
export function withModuleTracker<P extends object>(
  Component: React.ComponentType<P>,
  moduleName: string
): React.FC<P> {
  return function TrackedComponent(props: P) {
    useModuleTracker(moduleName)
    return (
      <div data-module={moduleName}>
        <Component {...props} />
      </div>
    )
  }
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Process-like view showing all tracked modules
interface ProcessViewProps {
  modules: ModuleMemory[]
}

export function ProcessView({ modules }: ProcessViewProps) {
  // Sort by memory usage descending
  const sortedModules = [...modules].sort((a, b) => b.heapUsed - a.heapUsed)
  
  // Calculate total
  const totalMemory = modules.reduce((sum, m) => sum + m.heapUsed, 0)
  
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between text-[10px] text-plm-fg-muted uppercase tracking-wide px-2 py-1 bg-plm-bg rounded">
        <span className="flex-1">Module</span>
        <span className="w-16 text-right">Instances</span>
        <span className="w-20 text-right">Memory</span>
        <span className="w-24 text-right">Last Update</span>
      </div>
      
      {/* Module rows */}
      <div className="space-y-0.5">
        {sortedModules.map((mod) => (
          <ProcessRow key={mod.name} module={mod} totalMemory={totalMemory} />
        ))}
      </div>
      
      {/* Total row */}
      {modules.length > 0 && (
        <div className="flex items-center justify-between text-xs px-2 py-1.5 bg-plm-bg-lighter rounded border border-plm-border">
          <span className="flex-1 font-medium text-plm-fg">Total ({modules.length} modules)</span>
          <span className="w-16 text-right text-plm-fg-muted">
            {modules.reduce((sum, m) => sum + m.instances, 0)}
          </span>
          <span className="w-20 text-right font-mono tabular-nums text-plm-accent">
            {formatBytes(totalMemory)}
          </span>
          <span className="w-24" />
        </div>
      )}
      
      {modules.length === 0 && (
        <div className="text-center py-8 text-sm text-plm-fg-muted">
          No modules are currently being tracked.
          <br />
          <span className="text-xs">Add useModuleTracker() to components to track them.</span>
        </div>
      )}
    </div>
  )
}

function ProcessRow({ module, totalMemory }: { module: ModuleMemory; totalMemory: number }) {
  const percent = totalMemory > 0 ? (module.heapUsed / totalMemory) * 100 : 0
  const timeSinceUpdate = Date.now() - module.lastUpdate
  const isStale = timeSinceUpdate > 5000 // 5 seconds
  
  const formatTime = (ms: number) => {
    if (ms < 1000) return 'just now'
    if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`
    return `${Math.floor(ms / 60000)}m ago`
  }
  
  return (
    <div className={`flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-plm-bg-lighter transition-colors ${
      isStale ? 'opacity-50' : ''
    }`}>
      {/* Name with memory bar */}
      <div className="flex-1 flex items-center gap-2">
        <span className={`text-plm-fg ${isStale ? 'text-plm-fg-muted' : ''}`}>
          {module.name}
        </span>
        {/* Mini progress bar */}
        <div className="flex-1 h-1 bg-plm-bg rounded-full overflow-hidden max-w-[100px]">
          <div 
            className="h-full bg-plm-accent transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      
      {/* Instances */}
      <span className="w-16 text-right text-plm-fg-muted">
        {module.instances > 0 ? module.instances : '—'}
      </span>
      
      {/* Memory */}
      <span className="w-20 text-right font-mono tabular-nums text-plm-fg">
        {module.heapUsed > 0 ? formatBytes(module.heapUsed) : '—'}
      </span>
      
      {/* Last update */}
      <span className={`w-24 text-right text-[10px] ${
        isStale ? 'text-plm-warning' : 'text-plm-fg-muted'
      }`}>
        {formatTime(timeSinceUpdate)}
      </span>
    </div>
  )
}

// Export modules getter for use in Performance settings tab
export { getModules }

