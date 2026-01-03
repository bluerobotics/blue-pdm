// WorkflowToolbar - Canvas toolbar with zoom, mode, and actions
import { memo, useState, useRef } from 'react'
import { 
  Plus, 
  ZoomIn, 
  ZoomOut, 
  MousePointer, 
  Move, 
  GitBranch,
  RotateCcw,
  Settings2,
  Download,
  Upload,
  Grid
} from 'lucide-react'
import type { CanvasMode, SnapSettings } from './types'

interface WorkflowToolbarProps {
  canvasMode: CanvasMode
  zoom: number
  isAdmin: boolean
  canUndo: boolean
  canRedo: boolean
  snapSettings: SnapSettings
  onModeChange: (mode: CanvasMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onUndo: () => void
  onRedo: () => void
  onAddState: () => void
  onExport: () => void
  onImport: () => void
  onSnapSettingsChange: (settings: Partial<SnapSettings>) => void
}

export const WorkflowToolbar = memo(function WorkflowToolbar({
  canvasMode,
  zoom,
  isAdmin,
  canUndo,
  canRedo,
  snapSettings,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onUndo,
  onRedo,
  onAddState,
  onExport,
  onImport,
  onSnapSettingsChange
}: WorkflowToolbarProps) {
  const [showSnapSettings, setShowSnapSettings] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-plm-border bg-plm-bg-light">
      {/* Mode toggle */}
      <div className="flex items-center bg-plm-bg rounded p-0.5">
        <button
          onClick={() => onModeChange('select')}
          className={`p-1.5 rounded ${
            canvasMode === 'select' ? 'bg-plm-highlight' : 'hover:bg-plm-highlight'
          }`}
          title="Select mode (V)"
        >
          <MousePointer size={14} />
        </button>
        <button
          onClick={() => onModeChange('pan')}
          className={`p-1.5 rounded ${
            canvasMode === 'pan' ? 'bg-plm-highlight' : 'hover:bg-plm-highlight'
          }`}
          title="Pan mode (Space+Drag)"
        >
          <Move size={14} />
        </button>
        <button
          onClick={() => onModeChange('connect')}
          className={`p-1.5 rounded ${
            canvasMode === 'connect' ? 'bg-plm-highlight' : 'hover:bg-plm-highlight'
          }`}
          title="Connect mode - click states to create transitions"
        >
          <GitBranch size={14} />
        </button>
      </div>
      
      {/* Divider */}
      <div className="w-px h-5 bg-plm-border mx-1" />
      
      {/* Zoom controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onZoomOut}
          className="p-1.5 hover:bg-plm-highlight rounded"
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={onZoomReset}
          className="px-2 py-1 text-xs hover:bg-plm-highlight rounded min-w-[48px] text-center"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={onZoomIn}
          className="p-1.5 hover:bg-plm-highlight rounded"
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
      </div>
      
      {/* Divider */}
      <div className="w-px h-5 bg-plm-border mx-1" />
      
      {/* Snap settings */}
      <div className="relative">
        <button
          onClick={() => setShowSnapSettings(!showSnapSettings)}
          className={`p-1.5 rounded flex items-center gap-1 ${
            showSnapSettings || snapSettings.snapToGrid || snapSettings.snapToAlignment 
              ? 'bg-plm-highlight' 
              : 'hover:bg-plm-highlight'
          }`}
          title="Snap settings"
        >
          <Grid size={14} />
          <Settings2 size={10} />
        </button>
        
        {showSnapSettings && (
          <div 
            className="absolute top-full left-0 mt-1 p-3 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border z-50 min-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3">
              {/* Snap to grid */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={snapSettings.snapToGrid}
                  onChange={(e) => onSnapSettingsChange({ snapToGrid: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">Snap to grid</span>
              </label>
              
              {/* Grid size */}
              {snapSettings.snapToGrid && (
                <div className="pl-6">
                  <label className="text-xs text-plm-fg-muted">Grid size: {snapSettings.gridSize}px</label>
                  <input
                    type="range"
                    min="20"
                    max="80"
                    step="10"
                    value={snapSettings.gridSize}
                    onChange={(e) => onSnapSettingsChange({ gridSize: parseInt(e.target.value) })}
                    className="w-full"
                  />
                </div>
              )}
              
              {/* Snap to alignment */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={snapSettings.snapToAlignment}
                  onChange={(e) => onSnapSettingsChange({ snapToAlignment: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">Snap to alignment</span>
              </label>
            </div>
          </div>
        )}
      </div>
      
      {/* Spacer */}
      <div className="flex-1" />
      
      {/* Undo/Redo */}
      {isAdmin && (
        <>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded ${canUndo ? 'hover:bg-plm-highlight' : 'opacity-30'}`}
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded ${canRedo ? 'hover:bg-plm-highlight' : 'opacity-30'}`}
            title="Redo (Ctrl+Y)"
          >
            <RotateCcw size={14} className="transform scale-x-[-1]" />
          </button>
          
          {/* Divider */}
          <div className="w-px h-5 bg-plm-border mx-1" />
        </>
      )}
      
      {/* Import/Export */}
      <button
        onClick={onExport}
        className="p-1.5 hover:bg-plm-highlight rounded"
        title="Export workflow"
      >
        <Download size={14} />
      </button>
      
      {isAdmin && (
        <>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                onImport()
              }
              // Reset input
              if (importInputRef.current) {
                importInputRef.current.value = ''
              }
            }}
            className="hidden"
          />
          <button
            onClick={() => importInputRef.current?.click()}
            className="p-1.5 hover:bg-plm-highlight rounded"
            title="Import workflow"
          >
            <Upload size={14} />
          </button>
        </>
      )}
      
      {/* Divider */}
      <div className="w-px h-5 bg-plm-border mx-1" />
      
      {/* Add state */}
      {isAdmin && (
        <button
          onClick={onAddState}
          className="flex items-center gap-1 px-2 py-1 bg-plm-accent hover:bg-plm-accent-hover text-white rounded text-sm"
          title="Add new state"
        >
          <Plus size={14} />
          <span>State</span>
        </button>
      )}
    </div>
  )
})
