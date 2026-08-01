import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Handshake, Layers, Users, X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'

import { SyncControl } from './components/SyncControl'
import { SyncSummary } from './components/SyncSummary'
import { useChannelCounts } from './hooks/useChannelCounts'
import { useCustomerFacets } from './hooks/useCustomerFacets'
import { useCustomerSync } from './hooks/useCustomerSync'
import { CHANNEL_IDS, channelMeta } from './lib/channels'
import { formatCompact, formatCount } from './lib/format'
import { SEGMENT_IDS, segmentMeta } from './lib/segments'
import { categoryKey } from './lib/taxonomy'

/**
 * Left sidebar for the Customers workspace: sync control, lifecycle segments,
 * the enrichment taxonomy tree and country facets.
 *
 * Selections here write to the shared customerFilters, which the main area and
 * the detail panel both read, so a click cross-filters the whole workspace.
 */
export function CustomersNavigator() {
  const filters = usePDMStore((s) => s.customerFilters)
  const toggleCustomerFacet = usePDMStore((s) => s.toggleCustomerFacet)
  const setCustomerFilters = usePDMStore((s) => s.setCustomerFilters)
  const resetCustomerFilters = usePDMStore((s) => s.resetCustomerFilters)
  const invalidateCustomerData = usePDMStore((s) => s.invalidateCustomerData)

  const { segmentCounts, categories, geo } = useCustomerFacets()
  const channels = useChannelCounts()
  const sync = useCustomerSync(invalidateCustomerData)

  const [showTaxonomy, setShowTaxonomy] = useState(true)
  const [showGeo, setShowGeo] = useState(true)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  const segmentLookup = useMemo(
    () => new Map(segmentCounts.map((row) => [row.segment, row])),
    [segmentCounts],
  )

  // Two-level tree from the flat category/subcategory rows, parents carrying
  // the summed revenue of their children.
  const taxonomy = useMemo(() => {
    const parents = new Map<
      string,
      { key: string; label: string; revenue: number; children: Map<string, { key: string; label: string; revenue: number }> }
    >()

    for (const row of categories) {
      const parentKey = row.category ?? 'unclassified'
      let parent = parents.get(parentKey)
      if (!parent) {
        parent = {
          key: parentKey,
          label: row.category_label ?? row.category ?? 'Unclassified',
          revenue: 0,
          children: new Map(),
        }
        parents.set(parentKey, parent)
      }
      parent.revenue += row.revenue

      if (row.category && row.subcategory) {
        const childKey = categoryKey(row.category, row.subcategory)
        const existing = parent.children.get(childKey)
        if (existing) existing.revenue += row.revenue
        else
          parent.children.set(childKey, {
            key: childKey,
            label: row.subcategory_label ?? row.subcategory,
            revenue: row.revenue,
          })
      }
    }

    return Array.from(parents.values())
      .map((parent) => ({
        ...parent,
        children: Array.from(parent.children.values()).sort((a, b) => b.revenue - a.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [categories])

  const countries = useMemo(() => geo.filter((row) => row.country).slice(0, 15), [geo])

  const activeFilterCount =
    filters.segments.length +
    filters.categories.length +
    filters.countries.length +
    filters.channels.length +
    (filters.presence === 'all' ? 0 : 1)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-plm-border space-y-2.5">
        <SyncControl sync={sync} />

        {sync.result && <SyncSummary result={sync.result} onExpire={sync.dismissResult} />}

        {activeFilterCount > 0 && (
          <button
            onClick={resetCustomerFilters}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[11px] text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors"
          >
            <X size={11} />
            Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <Section icon={Users} title="Segments">
          {SEGMENT_IDS.map((id) => {
            const meta = segmentMeta(id)
            const stats = segmentLookup.get(id)
            const selected = filters.segments.includes(id)

            return (
              <FacetRow
                key={id}
                label={meta.label}
                title={meta.description}
                count={stats?.buyers}
                selected={selected}
                onClick={() => toggleCustomerFacet('segments', id)}
                dot={meta.badgeClass}
              />
            )
          })}
        </Section>

        {/* Counts are accounts, not buyers, unlike every other facet here: a
            channel is a property of the account, and "3 distributors" is the
            number a person curating the list is checking against - so unlike
            the facets above and below, this one does not follow the range. */}
        <Section icon={Handshake} title="Channel">
          {CHANNEL_IDS.map((id) => {
            const meta = channelMeta(id)

            return (
              <FacetRow
                key={id}
                label={meta.plural}
                title={meta.description}
                count={channels.byChannel[id].account_count}
                selected={filters.channels.includes(id)}
                onClick={() => toggleCustomerFacet('channels', id)}
                dot={meta.badgeClass}
              />
            )
          })}
        </Section>

        <Section
          icon={Layers}
          title="Categories"
          collapsed={!showTaxonomy}
          onToggle={() => setShowTaxonomy((value) => !value)}
        >
          {taxonomy.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-plm-fg-muted">
              No enrichment has run yet, so nothing is classified.
            </p>
          ) : (
            taxonomy.map((parent) => {
              const expanded = expandedCategories.has(parent.key)
              const selected = filters.categories.includes(parent.key)

              return (
                <div key={parent.key}>
                  <div className="flex items-center">
                    {parent.children.length > 0 ? (
                      <button
                        onClick={() =>
                          setExpandedCategories((current) => {
                            const next = new Set(current)
                            if (next.has(parent.key)) next.delete(parent.key)
                            else next.add(parent.key)
                            return next
                          })
                        }
                        className="pl-2 pr-0.5 py-1 text-plm-fg-muted hover:text-plm-fg"
                      >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    ) : (
                      <span className="w-[22px]" />
                    )}
                    <FacetRow
                      label={parent.label}
                      count={parent.revenue}
                      countFormat="money"
                      selected={selected}
                      onClick={() => toggleCustomerFacet('categories', parent.key)}
                      className="flex-1 pl-1"
                    />
                  </div>

                  {expanded &&
                    parent.children.map((child) => (
                      <FacetRow
                        key={child.key}
                        label={child.label}
                        count={child.revenue}
                        countFormat="money"
                        selected={filters.categories.includes(child.key)}
                        onClick={() => toggleCustomerFacet('categories', child.key)}
                        className="pl-8"
                      />
                    ))}
                </div>
              )
            })
          )}
        </Section>

        <Section
          icon={Globe}
          title="Countries"
          collapsed={!showGeo}
          onToggle={() => setShowGeo((value) => !value)}
        >
          {countries.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-plm-fg-muted">No revenue in this period.</p>
          ) : (
            countries.map((row) => (
              <FacetRow
                key={row.country}
                label={row.country ?? 'Unknown'}
                count={row.revenue}
                countFormat="money"
                selected={filters.countries.includes(row.country ?? '')}
                onClick={() => row.country && toggleCustomerFacet('countries', row.country)}
              />
            ))
          )}
        </Section>

        <Section title="Odoo status">
          {(['all', 'active', 'gone'] as const).map((value) => (
            <FacetRow
              key={value}
              label={
                value === 'all' ? 'All customers' : value === 'active' ? 'In Odoo' : 'Gone from Odoo'
              }
              title={
                value === 'gone'
                  ? 'Flagged when a partner disappears from Odoo. The sync never deletes.'
                  : undefined
              }
              selected={filters.presence === value}
              onClick={() => setCustomerFilters({ presence: value })}
            />
          ))}
        </Section>
      </div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  collapsed,
  onToggle,
  children,
}: {
  icon?: typeof Users
  title: string
  collapsed?: boolean
  onToggle?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        disabled={!onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wide text-plm-fg-muted hover:text-plm-fg-dim disabled:hover:text-plm-fg-muted"
      >
        {Icon && <Icon size={11} />}
        <span className="flex-1 text-left">{title}</span>
        {onToggle && (collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />)}
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  )
}

function FacetRow({
  label,
  title,
  count,
  countFormat = 'count',
  selected,
  onClick,
  dot,
  className = '',
}: {
  label: string
  title?: string
  count?: number
  countFormat?: 'count' | 'money'
  selected: boolean
  onClick: () => void
  dot?: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors ${
        selected ? 'bg-plm-highlight text-plm-fg' : 'text-plm-fg-dim hover:bg-plm-bg-light'
      } ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot.split(' ')[0]}`} />}
      <span className="flex-1 min-w-0 truncate text-xs">{label}</span>
      {count != null && (
        <span className="text-[10px] tabular-nums text-plm-fg-muted shrink-0">
          {countFormat === 'money' ? formatCompact(count) : formatCount(count)}
        </span>
      )}
    </button>
  )
}
