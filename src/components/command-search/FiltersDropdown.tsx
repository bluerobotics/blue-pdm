import type { FiltersDropdownProps } from './types'

/**
 * Dropdown menu displaying all available search filters
 */
export function FiltersDropdown({ filters, currentFilter, onSelect }: FiltersDropdownProps) {
  return (
    <div className="absolute top-full left-0 mt-1 w-64 bg-plm-bg border border-plm-border rounded-lg shadow-2xl z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
      <div className="p-2 border-b border-plm-border">
        <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium">Search Filters</div>
      </div>
      <div className="p-1 max-h-64 overflow-y-auto">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => onSelect(filter.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
              currentFilter === filter.id
                ? 'bg-plm-accent/20 text-plm-accent'
                : 'text-plm-fg hover:bg-plm-bg-lighter'
            }`}
          >
            <span className={currentFilter === filter.id ? 'text-plm-accent' : 'text-plm-fg-muted'}>
              {filter.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{filter.label}</div>
              <div className="text-xs text-plm-fg-muted truncate">{filter.description}</div>
            </div>
            {filter.prefix && (
              <code className="text-[10px] px-1.5 py-0.5 bg-plm-bg-light border border-plm-border rounded font-mono">
                {filter.prefix}
              </code>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
