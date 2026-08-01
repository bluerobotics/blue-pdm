import { X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'

import type { CategoryBreakdownRow } from '../data/types'
import { channelMeta } from '../lib/channels'
import { segmentMeta } from '../lib/segments'
import { parseCategoryKey } from '../lib/taxonomy'

interface FilterChipsProps {
  /** Used to show the taxonomy display name rather than the raw slug. */
  categories: CategoryBreakdownRow[]
}

/**
 * Shows every active cross-filter as a removable chip.
 *
 * Without this, clicking a donut slice silently changes what the table and KPI
 * numbers mean, and the only way back is a Clear button in a sidebar that may
 * be collapsed.
 */
export function FilterChips({ categories }: FilterChipsProps) {
  const filters = usePDMStore((s) => s.customerFilters)
  const toggleCustomerFacet = usePDMStore((s) => s.toggleCustomerFacet)
  const setCustomerFilters = usePDMStore((s) => s.setCustomerFilters)
  const resetCustomerFilters = usePDMStore((s) => s.resetCustomerFilters)

  const categoryLabel = (key: string): string => {
    const { category, subcategory } = parseCategoryKey(key)
    if (key === 'unclassified') return 'Unclassified'

    const match = categories.find(
      (row) => row.category === category && (row.subcategory ?? null) === subcategory,
    )
    if (subcategory) return match?.subcategory_label ?? subcategory
    return (
      categories.find((row) => row.category === category)?.category_label ?? category
    )
  }

  const chips: { key: string; label: string; value: string; onRemove: () => void }[] = [
    ...filters.segments.map((id) => ({
      key: `segment:${id}`,
      label: 'Segment',
      value: segmentMeta(id).label,
      onRemove: () => toggleCustomerFacet('segments', id),
    })),
    ...filters.categories.map((key) => ({
      key: `category:${key}`,
      label: 'Category',
      value: categoryLabel(key),
      onRemove: () => toggleCustomerFacet('categories', key),
    })),
    ...filters.channels.map((id) => ({
      key: `channel:${id}`,
      label: 'Channel',
      value: channelMeta(id).plural,
      onRemove: () => toggleCustomerFacet('channels', id),
    })),
    ...filters.countries.map((country) => ({
      key: `country:${country}`,
      label: 'Country',
      value: country,
      onRemove: () => toggleCustomerFacet('countries', country),
    })),
  ]

  if (filters.presence !== 'all') {
    chips.push({
      key: 'presence',
      label: 'Status',
      value: filters.presence === 'active' ? 'In Odoo' : 'Gone from Odoo',
      onRemove: () => setCustomerFilters({ presence: 'all' }),
    })
  }

  if (filters.search.trim()) {
    chips.push({
      key: 'search',
      label: 'Search',
      value: filters.search.trim(),
      onRemove: () => setCustomerFilters({ search: '' }),
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={chip.onRemove}
          className="group flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full border border-plm-border bg-plm-bg-light text-[11px] hover:border-plm-accent/50 transition-colors"
        >
          <span className="text-plm-fg-muted">{chip.label}</span>
          <span className="text-plm-fg max-w-[160px] truncate">{chip.value}</span>
          <X size={11} className="text-plm-fg-muted group-hover:text-plm-error" />
        </button>
      ))}

      {chips.length > 1 && (
        <button
          onClick={resetCustomerFilters}
          className="px-2 py-0.5 text-[11px] text-plm-fg-muted hover:text-plm-fg transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
