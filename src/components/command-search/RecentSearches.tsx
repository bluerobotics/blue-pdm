import { Clock } from 'lucide-react'
import type { RecentSearchesProps } from './types'

/**
 * Recent searches section with clear button
 */
export function RecentSearches({ 
  searches, 
  startIndex,
  highlightedIndex, 
  onSelect, 
  onClear,
  onMouseEnter 
}: RecentSearchesProps) {
  return (
    <div className="p-1">
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium">
          Recent Searches
        </div>
        <button
          onClick={onClear}
          className="text-[10px] text-plm-fg-muted hover:text-plm-error transition-colors"
        >
          Clear all
        </button>
      </div>
      {searches.slice(0, 8).map((search, index) => {
        const resultIndex = startIndex + index
        return (
          <button
            key={search + index}
            onClick={() => onSelect(search)}
            onMouseEnter={() => onMouseEnter(resultIndex)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
              highlightedIndex === resultIndex
                ? 'bg-plm-accent/20'
                : 'hover:bg-plm-bg-lighter'
            }`}
          >
            <Clock size={14} className="text-plm-fg-muted" />
            <span className="text-sm text-plm-fg truncate">{search}</span>
          </button>
        )
      })}
    </div>
  )
}
