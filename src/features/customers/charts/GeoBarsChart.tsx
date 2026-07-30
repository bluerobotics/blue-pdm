import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { GeoBreakdownRow } from '../data/types'
import { useChartTheme, withAlpha } from '../lib/chartTheme'
import { formatAmount, formatCompact, formatCount } from '../lib/format'

interface GeoBarsChartProps {
  data: GeoBreakdownRow[]
  loading: boolean
  onSelect: (country: string) => void
  selected: string[]
}

const MAX_BARS = 12

export function GeoBarsChart({ data, loading, onSelect, selected }: GeoBarsChartProps) {
  const theme = useChartTheme()

  const rows = data
    .slice(0, MAX_BARS)
    .map((row) => ({ ...row, label: row.country ?? 'Unknown' }))

  return (
    <ChartFrame
      title="Revenue by country"
      subtitle="Billing country on the customer record. Click a bar to filter."
      height={300}
      loading={loading}
      empty={rows.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
          barCategoryGap={4}
        >
          <XAxis
            type="number"
            tickFormatter={formatCompact}
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: theme.fgDim, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={92}
            tickFormatter={(value: string) =>
              value.length > 15 ? `${value.slice(0, 14)}…` : value
            }
          />
          <Tooltip
            cursor={{ fill: withAlpha(theme.fgMuted, 0.08) }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as (typeof rows)[number]
              return (
                <TooltipCard title={row.label}>
                  <TooltipRow label="Revenue" value={formatAmount(row.revenue)} />
                  <TooltipRow label="Orders" value={formatCount(row.orders)} />
                  <TooltipRow label="Buyers" value={formatCount(row.buyers)} />
                </TooltipCard>
              )
            }}
          />
          <Bar
            dataKey="revenue"
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(entry) => {
              const row = entry?.payload as (typeof rows)[number] | undefined
              if (row?.country) onSelect(row.country)
            }}
          >
            {rows.map((row) => (
              <Cell
                key={row.label}
                fill={
                  selected.length > 0 && !(row.country && selected.includes(row.country))
                    ? withAlpha(theme.accent, 0.3)
                    : theme.accent
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
