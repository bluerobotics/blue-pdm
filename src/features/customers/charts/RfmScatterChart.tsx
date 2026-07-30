import { useMemo } from 'react'
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { CustomerRfmRow } from '../data/types'
import { useChartTheme } from '../lib/chartTheme'
import { formatAmount, formatCount, formatRelativeDays } from '../lib/format'
import { segmentMeta } from '../lib/segments'

interface RfmScatterChartProps {
  rows: CustomerRfmRow[]
  loading: boolean
  onSelect: (row: CustomerRfmRow) => void
}

/**
 * Recency against frequency, bubble size by spend.
 *
 * Plots only customers who have actually bought. Prospects have no recency, so
 * they would all pile onto one axis and squash the real distribution.
 */
export function RfmScatterChart({ rows, loading, onSelect }: RfmScatterChartProps) {
  const theme = useChartTheme()

  const points = useMemo(
    () =>
      rows
        .filter((row) => row.recency_days != null && row.order_count > 0)
        .map((row) => ({
          ...row,
          x: row.recency_days ?? 0,
          y: row.order_count,
          z: Math.max(row.total_spent, 1),
        })),
    [rows],
  )

  return (
    <ChartFrame
      title="Recency, frequency and value"
      subtitle="Each bubble is a customer; size is lifetime spend. Click to open."
      height={300}
      loading={loading}
      empty={points.length === 0}
      emptyMessage="No customers with confirmed orders yet"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />

          <XAxis
            type="number"
            dataKey="x"
            name="Days since last order"
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={{ stroke: theme.border }}
            tickLine={false}
            label={{
              value: 'Days since last order',
              position: 'insideBottom',
              offset: -10,
              fill: theme.fgMuted,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Orders"
            // Order counts are heavily skewed - a handful of customers with
            // 50+ orders would flatten everyone else onto the baseline.
            scale="log"
            domain={[1, 'auto']}
            allowDataOverflow
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <ZAxis type="number" dataKey="z" range={[24, 420]} />

          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: theme.borderLight }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as (typeof points)[number]
              const meta = segmentMeta(row.segment)
              return (
                <TooltipCard title={row.name}>
                  <TooltipRow color={meta.color(theme)} label="Segment" value={meta.label} />
                  <TooltipRow label="Last order" value={formatRelativeDays(row.recency_days)} />
                  <TooltipRow label="Orders" value={formatCount(row.order_count)} />
                  <TooltipRow label="Lifetime spend" value={formatAmount(row.total_spent)} />
                  {row.category_label && (
                    <TooltipRow label="Category" value={row.category_label} />
                  )}
                </TooltipCard>
              )
            }}
          />

          <Scatter
            data={points}
            isAnimationActive={false}
            className="cursor-pointer"
            onClick={(entry) => {
              const row = entry?.payload as CustomerRfmRow | undefined
              if (row) onSelect(row)
            }}
          >
            {points.map((point) => (
              <Cell
                key={point.customer_id}
                fill={segmentMeta(point.segment).color(theme)}
                fillOpacity={0.55}
                stroke={segmentMeta(point.segment).color(theme)}
                strokeOpacity={0.9}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
