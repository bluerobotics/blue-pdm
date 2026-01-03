import { Search, X, Command } from 'lucide-react'
import type { SearchInputProps } from './types'

/**
 * Main search input with clear button and keyboard shortcut hint
 */
export function SearchInput({ 
  value, 
  onChange, 
  onFocus, 
  onKeyDown, 
  placeholder, 
  inputRef,
  onClear 
}: SearchInputProps) {
  return (
    <div className="relative flex-1">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full h-8 pl-9 pr-16 bg-plm-bg-lighter border border-plm-border rounded-full text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent focus:ring-1 focus:ring-plm-accent/50 transition-colors"
      />
      
      {/* Right side: clear button + keyboard shortcut */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {value && (
          <button
            onClick={onClear}
            className="p-0.5 text-plm-fg-muted hover:text-plm-fg rounded"
          >
            <X size={14} />
          </button>
        )}
        {!value && (
          <div className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted">
            <kbd className="px-1 py-0.5 bg-plm-bg-light border border-plm-border rounded text-[9px] font-mono">
              <Command size={8} className="inline" />K
            </kbd>
          </div>
        )}
      </div>
    </div>
  )
}
