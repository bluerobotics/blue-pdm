import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { TopProduct } from '../data/types'
import { useChartTheme, withAlpha } from '../lib/chartTheme'
import { formatAmount, formatCompact, formatCount } from '../lib/format'

interface TopProductsChartProps {
  data: TopProduct[]
  loading: boolean
}

export function TopProductsChart({ data, loading }: TopProductsChartProps) {
  const theme = useChartTheme()

  const rows = data.map((row) => ({
    ...row,
    label: row.product_name ?? row.product_erp_id ?? 'Unnamed',
  }))

  return (
    <ChartFrame
      title="Top products"
      subtitle="Order lines rolled up by product. No PLM part link exists yet."
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
            width={130}
            tickFormatter={(value: string) =>
              value.length > 22 ? `${value.slice(0, 21)}…` : value
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
                  <TooltipRow label="Quantity" value={formatCount(row.quantity)} />
                  <TooltipRow label="Orders" value={formatCount(row.orders)} />
                  <TooltipRow label="Buyers" value={formatCount(row.buyers)} />
                  {row.product_erp_id && (
                    <TooltipRow label="Odoo product" value={`#${row.product_erp_id}`} />
                  )}
                </TooltipCard>
              )
            }}
          />
          <Bar
            dataKey="revenue"
            fill={theme.series[1]}
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
