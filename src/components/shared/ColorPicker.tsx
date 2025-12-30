import { useState, useRef, useEffect } from 'react'
import { Plus, RotateCcw } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'

// Default preset colors
export const DEFAULT_PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
  '#f43f5e', // rose
  '#84cc16', // lime
  '#64748b', // slate
]

interface ColorPickerProps {
  /** Current color value (hex) */
  color: string | null
  /** Callback when color changes */
  onChange: (color: string | null) => void
  /** Callback when picker is closed */
  onClose?: () => void
  /** Show "reset to default" option */
  showReset?: boolean
  /** Reset label text */
  resetLabel?: string
  /** Title for the picker */
  title?: string
  /** Additional preset colors to include */
  additionalPresets?: string[]
  /** Position of the dropdown */
  position?: 'left' | 'right'
  /** Whether to show inline (no dropdown wrapper) */
  inline?: boolean
  /** Custom class name */
  className?: string
}

export function ColorPicker({
  color,
  onChange,
  onClose,
  showReset = true,
  resetLabel = 'Use default color',
  title = 'Color',
  additionalPresets = [],
  position = 'right',
  inline = false,
  className = ''
}: ColorPickerProps) {
  const { 
    colorSwatches, 
    orgColorSwatches, 
    addColorSwatch, 
    removeColorSwatch,
    getEffectiveRole 
  } = usePDMStore()
  
  const [customColor, setCustomColor] = useState(color || '#3b82f6')
  const inputRef = useRef<HTMLInputElement>(null)
  const isAdmin = getEffectiveRole() === 'admin'
  
  // Combine all presets: default + additional + org swatches
  const allPresets = [...DEFAULT_PRESET_COLORS, ...additionalPresets]
  
  // Get user's personal swatches (non-org)
  const userSwatches = colorSwatches.filter(s => !s.isOrg)
  
  const handleApplyCustom = () => {
    onChange(customColor)
    onClose?.()
  }
  
  const handlePresetClick = (presetColor: string) => {
    onChange(presetColor)
    onClose?.()
  }
  
  const handleAddSwatch = (asOrg: boolean) => {
    addColorSwatch(customColor, asOrg)
  }
  
  const handleRemoveSwatch = (swatchId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    removeColorSwatch(swatchId)
  }
  
  const content = (
    <div className={`${inline ? '' : 'p-4'} space-y-3 ${className}`}>
      {title && (
        <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted">
          {title}
        </div>
      )}
      
      {/* Preset colors grid */}
      <div className="grid grid-cols-7 gap-2">
        {allPresets.map(presetColor => (
          <button
            key={presetColor}
            onClick={() => handlePresetClick(presetColor)}
            className={`w-8 h-8 rounded-md border-2 transition-all hover:scale-110 ${
              color === presetColor ? 'border-plm-fg ring-2 ring-plm-accent' : 'border-transparent'
            }`}
            style={{ backgroundColor: presetColor }}
            title={presetColor}
          />
        ))}
      </div>
      
      {/* Organization swatches */}
      {orgColorSwatches.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mt-3 flex items-center gap-2">
            <span>Organization</span>
            <span className="text-plm-fg-dim">({orgColorSwatches.length})</span>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {orgColorSwatches.map(swatch => (
              <button
                key={swatch.id}
                onClick={() => handlePresetClick(swatch.color)}
                onContextMenu={(e) => {
                  if (isAdmin) {
                    handleRemoveSwatch(swatch.id, e)
                  }
                }}
                className={`relative group w-8 h-8 rounded-md border-2 transition-all hover:scale-110 ${
                  color === swatch.color ? 'border-plm-fg ring-2 ring-plm-accent' : 'border-transparent'
                }`}
                style={{ backgroundColor: swatch.color }}
                title={`${swatch.color}${isAdmin ? ' (right-click to remove)' : ''}`}
              >
                {isAdmin && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-plm-error rounded-full text-[9px] text-white opacity-0 group-hover:opacity-100 flex items-center justify-center">
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      
      {/* User's personal swatches */}
      {userSwatches.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mt-3 flex items-center gap-2">
            <span>My Colors</span>
            <span className="text-plm-fg-dim">({userSwatches.length})</span>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {userSwatches.map(swatch => (
              <button
                key={swatch.id}
                onClick={() => handlePresetClick(swatch.color)}
                onContextMenu={(e) => handleRemoveSwatch(swatch.id, e)}
                className={`relative group w-8 h-8 rounded-md border-2 transition-all hover:scale-110 ${
                  color === swatch.color ? 'border-plm-fg ring-2 ring-plm-accent' : 'border-transparent'
                }`}
                style={{ backgroundColor: swatch.color }}
                title={`${swatch.color} (right-click to remove)`}
              >
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-plm-error rounded-full text-[9px] text-white opacity-0 group-hover:opacity-100 flex items-center justify-center">
                  ×
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      
      {/* Custom color picker */}
      <div className="pt-3 border-t border-plm-border">
        <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">
          Custom
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="color"
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
            className="w-10 h-10 rounded cursor-pointer border border-plm-border bg-transparent flex-shrink-0"
          />
          <input
            type="text"
            value={customColor}
            onChange={(e) => {
              const val = e.target.value
              if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                setCustomColor(val)
              }
            }}
            placeholder="#000000"
            className="flex-1 min-w-0 px-2.5 py-2 text-xs bg-plm-bg-secondary border border-plm-border rounded font-mono text-plm-fg"
          />
          <button
            onClick={handleApplyCustom}
            className="px-3 py-2 text-xs font-medium bg-plm-accent text-white rounded hover:bg-plm-accent/80 transition-colors flex-shrink-0"
          >
            Apply
          </button>
        </div>
        
        {/* Save swatch buttons - compact single row */}
        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            onClick={() => handleAddSwatch(false)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-plm-fg-muted hover:text-plm-fg bg-plm-bg-secondary hover:bg-plm-highlight border border-plm-border rounded transition-colors"
            title="Save to your personal swatches"
          >
            <Plus size={11} />
            <span>Save</span>
          </button>
          {isAdmin && (
            <button
              onClick={() => handleAddSwatch(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-plm-accent bg-plm-accent/10 hover:bg-plm-accent/20 border border-plm-accent/30 rounded transition-colors"
              title="Save for entire organization (admin only)"
            >
              <Plus size={11} />
              <span>Save for Org</span>
            </button>
          )}
        </div>
      </div>
      
      {/* Reset to default */}
      {showReset && (
        <button
          onClick={() => {
            onChange(null)
            onClose?.()
          }}
          className={`w-full px-3 py-2 text-xs text-left rounded transition-colors flex items-center gap-2 ${
            !color ? 'bg-plm-accent/20 text-plm-accent' : 'hover:bg-plm-highlight text-plm-fg-muted'
          }`}
        >
          <RotateCcw size={12} />
          {resetLabel}
        </button>
      )}
    </div>
  )
  
  if (inline) {
    return content
  }
  
  return (
    <div 
      className={`absolute ${position === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-72 bg-plm-bg border border-plm-border rounded-lg shadow-xl z-50`}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  )
}

// Dropdown color picker with trigger button
interface ColorPickerDropdownProps extends Omit<ColorPickerProps, 'onClose' | 'inline'> {
  /** Trigger button content - defaults to a color swatch */
  trigger?: React.ReactNode
  /** Size of the default trigger button */
  triggerSize?: 'sm' | 'md' | 'lg'
  /** Show palette icon in trigger */
  showPaletteIcon?: boolean
}

export function ColorPickerDropdown({
  color,
  onChange,
  trigger,
  triggerSize = 'md',
  showPaletteIcon = false,
  ...pickerProps
}: ColorPickerDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    
    // Delay to prevent immediate close
    const timeout = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)
    
    return () => {
      clearTimeout(timeout)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isOpen])
  
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-9 h-9'
  }
  
  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        className="rounded transition-colors hover:ring-2 hover:ring-plm-accent/50"
        title="Set color"
      >
        {trigger || (
          <div 
            className={`${sizeClasses[triggerSize]} rounded border border-plm-border flex items-center justify-center`}
            style={{ backgroundColor: color || 'transparent' }}
          >
            {!color && showPaletteIcon && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-plm-fg-muted">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="8" r="2" fill="#ef4444" stroke="none" />
                <circle cx="16" cy="12" r="2" fill="#3b82f6" stroke="none" />
                <circle cx="12" cy="16" r="2" fill="#22c55e" stroke="none" />
                <circle cx="8" cy="12" r="2" fill="#eab308" stroke="none" />
              </svg>
            )}
          </div>
        )}
      </button>
      
      {isOpen && (
        <ColorPicker
          color={color}
          onChange={(newColor) => {
            onChange(newColor)
          }}
          onClose={() => setIsOpen(false)}
          {...pickerProps}
        />
      )}
    </div>
  )
}

// Simple inline color swatches (no dropdown, just a row of colors)
interface ColorSwatchRowProps {
  color: string | null
  onChange: (color: string | null) => void
  colors?: string[]
  showReset?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function ColorSwatchRow({
  color,
  onChange,
  colors = DEFAULT_PRESET_COLORS.slice(0, 10),
  showReset = true,
  size = 'md'
}: ColorSwatchRowProps) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  }
  
  return (
    <div className="flex items-center gap-1">
      {showReset && (
        <button
          onClick={() => onChange(null)}
          className={`${sizeClasses[size]} rounded border-2 ${
            color === null ? 'border-plm-accent' : 'border-plm-border'
          } bg-plm-bg-secondary flex items-center justify-center text-xs text-plm-fg-muted`}
          title="Default"
        >
          ∅
        </button>
      )}
      {colors.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`${sizeClasses[size]} rounded border-2 transition-transform hover:scale-105 ${
            color === c ? 'border-plm-accent ring-1 ring-plm-accent' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  )
}

