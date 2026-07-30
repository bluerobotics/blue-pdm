import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { ChevronLeft } from 'lucide-react'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { CategoryBreakdownRow } from '../data/types'
import { seriesColor, useChartTheme } from '../lib/chartTheme'
import { formatAmount, formatCount, formatPercent } from '../lib/format'
import { categoryKey } from '../lib/taxonomy'

interface CategoryMixChartProps {
  data: CategoryBreakdownRow[]
  loading: boolean
  /** Adds the clicked slice to the workspace filters. */
  onSelect: (key: string) => void
  selected: string[]
}

interface Slice {
  key: string
  label: string
  revenue: number
  orders: number
  buyers: number
  share: number
  /** Present only at the top level, where a slice can be drilled into. */
  category: string | null
}

/**
 * Revenue split by the AI enrichment taxonomy, drillable from category into
 * its subcategories. Revenue from accounts that have never been researched is
 * kept as an explicit "Unclassified" slice rather than dropped, so the ring
 * always sums to total revenue.
 */
export function CategoryMixChart({ data, loading, onSelect, selected }: CategoryMixChartProps) {
  const theme = useChartTheme()
  const [drilled, setDrilled] = useState<string | null>(null)

  const total = useMemo(() => data.reduce((sum, row) => sum + row.revenue, 0), [data])

  const slices = useMemo<Slice[]>(() => {
    if (total === 0) return []

    if (drilled) {
      return data
        .filter((row) => row.category === drilled)
        .map((row) => ({
          key: categoryKey(row.category, row.subcategory),
          label: row.subcategory_label ?? row.subcategory ?? 'Unspecified',
          revenue: row.revenue,
          orders: row.orders,
          buyers: row.buyers,
          share: row.revenue / total,
          category: null,
        }))
        .sort((a, b) => b.revenue - a.revenue)
    }

    const byCategory = new Map<string, Slice>()
    for (const row of data) {
      const key = row.category ?? 'unclassified'
      const existing = byCategory.get(key)
      if (existing) {
        existing.revenue += row.revenue
        existing.orders += row.orders
        existing.buyers += row.buyers
      } else {
        byCategory.set(key, {
          key,
          label: row.category_label ?? row.category ?? 'Unclassified',
          revenue: row.revenue,
          orders: row.orders,
          buyers: row.buyers,
          share: 0,
          category: row.category,
        })
      }
    }

    return Array.from(byCategory.values())
      .map((slice) => ({ ...slice, share: slice.revenue / total }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [data, drilled, total])

  const drilledLabel = drilled
    ? (data.find((row) => row.category === drilled)?.category_label ?? drilled)
    : null

  return (
    <ChartFrame
      title={drilledLabel ? `Mix: ${drilledLabel}` : 'Revenue by category'}
      subtitle={
        drilledLabel
          ? 'Subcategories. Click a slice to filter the workspace.'
          : 'Click a slice to drill into subcategories'
      }
      height={300}
      loading={loading}
      empty={slices.length === 0}
      emptyMessage="No classified revenue in this range"
      actions={
        drilled && (
          <button
            onClick={() => setDrilled(null)}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg transition-colors"
          >
            <ChevronLeft size={11} />
            All categories
          </button>
        )
      }
    >
      <div className="h-full flex items-center gap-2">
        <div className="h-full flex-1 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="revenue"
                nameKey="label"
                innerRadius="55%"
                outerRadius="82%"
                paddingAngle={1.5}
                stroke={theme.bg}
                strokeWidth={2}
                isAnimationActive={false}
                onClick={(entry) => {
                  const slice = entry?.payload as Slice | undefined
                  if (!slice) return
                  // Top-level slices with children drill in; leaves filter.
                  if (slice.category && !drilled) setDrilled(slice.category)
                  else onSelect(slice.key)
                }}
                className="cursor-pointer focus:outline-none"
              >
                {slices.map((slice, index) => (
                  <Cell
                    key={slice.key}
                    fill={seriesColor(theme, index)}
                    opacity={
                      selected.length > 0 && !selected.includes(slice.key) && !slice.category
                        ? 0.35
                        : 1
                    }
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const slice = payload[0]?.payload as Slice
                  return (
                    <TooltipCard title={slice.label}>
                      <TooltipRow label="Revenue" value={formatAmount(slice.revenue)} />
                      <TooltipRow label="Share" value={formatPercent(slice.share, 1)} />
                      <TooltipRow label="Orders" value={formatCount(slice.orders)} />
                      <TooltipRow label="Buyers" value={formatCount(slice.buyers)} />
                    </TooltipCard>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="w-[44%] max-h-full overflow-y-auto pr-1 space-y-0.5">
          {slices.slice(0, 12).map((slice, index) => (
            <button
              key={slice.key}
              onClick={() =>
                slice.category && !drilled ? setDrilled(slice.category) : onSelect(slice.key)
              }
              className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left hover:bg-plm-bg transition-colors group"
            >
              <span
                className="w-2 h-2 rounded-[2px] shrink-0"
                style={{ backgroundColor: seriesColor(theme, index) }}
              />
              <span className="flex-1 min-w-0 truncate text-[11px] text-plm-fg-dim group-hover:text-plm-fg">
                {slice.label}
              </span>
              <span className="text-[10px] text-plm-fg-muted tabular-nums shrink-0">
                {formatPercent(slice.share, 0)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ChartFrame>
  )
}
