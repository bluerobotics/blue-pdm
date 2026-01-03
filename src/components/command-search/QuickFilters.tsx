import type { QuickFiltersProps } from './types'

/**
 * Horizontal row of quick filter pills
 */
export function QuickFilters({ filters, currentFilter, onSelect, onShowMore }: QuickFiltersProps) {
  return (
    <div className="flex items-center gap-1 p-2 border-b border-plm-border bg-plm-bg-light/50 overflow-x-auto scrollbar-hidden">
      {filters.map((filter) => (
        <button
          key={filter.id}
          onClick={() => onSelect(filter.id)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            currentFilter === filter.id
              ? 'bg-plm-accent text-white'
              : 'bg-plm-bg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:border-plm-fg-muted'
          }`}
        >
          {filter.icon}
          <span>{filter.label}</span>
        </button>
      ))}
      <button
        onClick={onShowMore}
        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs text-plm-fg-muted hover:text-plm-fg"
      >
        <span>More...</span>
      </button>
    </div>
  )
}
