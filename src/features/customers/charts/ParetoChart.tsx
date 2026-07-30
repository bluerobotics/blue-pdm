import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { TopAccount } from '../data/types'
import { useChartTheme, withAlpha } from '../lib/chartTheme'
import { formatAmount, formatCompact, formatCount, formatPercent } from '../lib/format'

interface ParetoChartProps {
  data: TopAccount[]
  loading: boolean
}

/**
 * Revenue concentration. Bars are per-account revenue, the line is the running
 * share of ALL revenue (not just the accounts shown), so the 80% marker
 * answers "how few accounts are we depending on".
 */
export function ParetoChart({ data, loading }: ParetoChartProps) {
  const theme = useChartTheme()

  const chartData = data.map((row) => ({
    ...row,
    label: row.label ?? 'Unnamed',
    cumulativePercent: (row.cumulative_share ?? 0) * 100,
  }))

  const accountsTo80 = chartData.findIndex((row) => row.cumulativePercent >= 80)
  const subtitle =
    accountsTo80 >= 0
      ? `Top ${accountsTo80 + 1} ${accountsTo80 === 0 ? 'account makes' : 'accounts make'} up 80% of revenue`
      : 'Revenue by account, rolled up from contacts'

  return (
    <ChartFrame
      title="Revenue concentration"
      subtitle={subtitle}
      height={300}
      loading={loading}
      empty={chartData.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fill: theme.fgMuted, fontSize: 9 }}
            axisLine={{ stroke: theme.border }}
            tickLine={false}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={70}
            tickFormatter={(value: string) =>
              value.length > 16 ? `${value.slice(0, 15)}…` : value
            }
          />
          <YAxis
            yAxisId="money"
            tickFormatter={formatCompact}
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <YAxis
            yAxisId="share"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />

          <Tooltip
            cursor={{ fill: withAlpha(theme.fgMuted, 0.08) }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as (typeof chartData)[number]
              return (
                <TooltipCard title={row.label}>
                  <TooltipRow
                    color={theme.accent}
                    label="Revenue"
                    value={formatAmount(row.revenue)}
                  />
                  <TooltipRow label="Share of total" value={formatPercent(row.share, 1)} />
                  <TooltipRow
                    color={theme.warning}
                    label="Running total"
                    value={formatPercent(row.cumulative_share, 1)}
                  />
                  <TooltipRow label="Orders" value={formatCount(row.orders)} />
                  <TooltipRow label="Contacts" value={formatCount(row.buyers)} />
                </TooltipCard>
              )
            }}
          />

          <ReferenceLine
            yAxisId="share"
            y={80}
            stroke={withAlpha(theme.warning, 0.5)}
            strokeDasharray="4 4"
          />

          <Bar yAxisId="money" dataKey="revenue" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {chartData.map((row) => (
              <Cell
                key={row.group_key}
                // Everything inside the 80% band is the dependency risk the
                // chart is about, so it keeps full accent weight.
                fill={row.cumulativePercent <= 80 ? theme.accent : withAlpha(theme.accent, 0.4)}
              />
            ))}
          </Bar>
          <Line
            yAxisId="share"
            type="monotone"
            dataKey="cumulativePercent"
            stroke={theme.warning}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
