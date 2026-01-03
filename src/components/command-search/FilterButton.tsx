import { Filter, ChevronDown } from 'lucide-react'
import type { FilterButtonProps } from './types'

/**
 * Filter toggle button that displays current filter state
 */
export function FilterButton({ currentFilter, isActive, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 h-8 px-3 rounded-full border transition-colors ${
        isActive
          ? 'bg-plm-accent/20 border-plm-accent/50 text-plm-accent'
          : 'bg-plm-bg-lighter border-plm-border text-plm-fg-muted hover:text-plm-fg hover:border-plm-fg-muted'
      }`}
      title="Search filters"
    >
      <Filter size={12} />
      <span className="text-xs font-medium hidden sm:inline">{currentFilter.label}</span>
      <ChevronDown size={10} className={`transition-transform ${isActive ? 'rotate-180' : ''}`} />
    </button>
  )
}
