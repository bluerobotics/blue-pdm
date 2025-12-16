import { useEffect } from 'react'
import { PerformanceSettings } from './settings/PerformanceSettings'

/**
 * Standalone Performance Window Component
 * Renders the performance dashboard in a pop-out window with proper styling
 */
export function PerformanceWindow() {
  // Apply dark theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])
  
  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden">
      {/* Title bar drag region */}
      <div 
        className="h-9 bg-plm-bg-light border-b border-plm-border flex items-center px-4 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-plm-fg">Performance Monitor</span>
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        <PerformanceSettings />
      </div>
    </div>
  )
}

export default PerformanceWindow

