import { useMemo } from 'react'

import { ChartFrame } from '../components/ChartFrame'
import type { CohortCell } from '../data/types'
import { useChartTheme, withAlpha } from '../lib/chartTheme'
import { formatAmount, formatCount, formatPercent } from '../lib/format'

interface CohortHeatmapProps {
  data: CohortCell[]
  loading: boolean
}

/**
 * Retention grid: acquisition month down, months-since across.
 *
 * A CSS grid rather than a Recharts chart. Recharts has no heatmap primitive,
 * and the alternatives (a scatter with square shapes, or a stacked bar hack)
 * cost more code than 60 divs and lose the ability to put a real tooltip and
 * a readable number inside each cell.
 */
export function CohortHeatmap({ data, loading }: CohortHeatmapProps) {
  const theme = useChartTheme()

  const { cohorts, maxIndex, lookup } = useMemo(() => {
    const map = new Map<string, CohortCell>()
    const months = new Map<string, number>()
    let widest = 0

    for (const cell of data) {
      map.set(`${cell.cohort_month}:${cell.month_index}`, cell)
      months.set(cell.cohort_month, cell.cohort_size)
      if (cell.month_index > widest) widest = cell.month_index
    }

    return {
      cohorts: Array.from(months.entries())
        .map(([month, size]) => ({ month, size }))
        .sort((a, b) => b.month.localeCompare(a.month)),
      maxIndex: Math.min(widest, 12),
      lookup: map,
    }
  }, [data])

  const columns = Array.from({ length: maxIndex + 1 }, (_, index) => index)

  return (
    <ChartFrame
      title="Cohort retention"
      subtitle="Share of each month's new customers who ordered again later"
      height={300}
      loading={loading}
      empty={cohorts.length === 0}
      emptyMessage="Not enough order history to build cohorts"
    >
      <div className="h-full overflow-auto px-2">
        <table className="border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-plm-bg-light text-left text-[10px] font-normal text-plm-fg-muted pr-2 pb-1">
                Cohort
              </th>
              <th className="text-[10px] font-normal text-plm-fg-muted pb-1 pr-1">Size</th>
              {columns.map((index) => (
                <th
                  key={index}
                  className="text-[10px] font-normal text-plm-fg-muted pb-1 w-9 text-center"
                >
                  {index === 0 ? 'M0' : `+${index}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort.month}>
                <td className="sticky left-0 z-10 bg-plm-bg-light text-[10px] text-plm-fg-dim whitespace-nowrap pr-2">
                  {new Date(cohort.month).toLocaleDateString(undefined, {
                    month: 'short',
                    year: '2-digit',
                  })}
                </td>
                <td className="text-[10px] text-plm-fg-muted tabular-nums text-right pr-1">
                  {formatCount(cohort.size)}
                </td>
                {columns.map((index) => {
                  const cell = lookup.get(`${cohort.month}:${index}`)
                  const retention = cell?.retention ?? 0

                  return (
                    <td key={index} className="p-0">
                      <div
                        className="w-9 h-6 rounded-[3px] flex items-center justify-center text-[9px] tabular-nums transition-colors"
                        style={{
                          backgroundColor: cell
                            ? withAlpha(theme.accent, 0.12 + retention * 0.78)
                            : withAlpha(theme.fgMuted, 0.05),
                          color: retention > 0.55 ? theme.bg : theme.fgDim,
                        }}
                        title={
                          cell
                            ? `${formatCount(cell.buyers)} of ${formatCount(cohort.size)} customers ordered (${formatPercent(retention, 0)}) - ${formatAmount(cell.revenue)} revenue`
                            : 'No orders'
                        }
                      >
                        {cell ? formatPercent(retention, 0) : ''}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  )
}
