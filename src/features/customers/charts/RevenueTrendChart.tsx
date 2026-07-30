import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { CustomerBucket } from '@/stores/types'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { TimeseriesPoint } from '../data/types'
import { useChartTheme, withAlpha } from '../lib/chartTheme'
import { formatAmount, formatBucket, formatBucketLong, formatCompact, formatCount } from '../lib/format'

const BUCKETS: CustomerBucket[] = ['day', 'week', 'month', 'quarter']

interface RevenueTrendChartProps {
  data: TimeseriesPoint[]
  bucket: CustomerBucket
  onBucketChange: (bucket: CustomerBucket) => void
  loading: boolean
}

export function RevenueTrendChart({
  data,
  bucket,
  onBucketChange,
  loading,
}: RevenueTrendChartProps) {
  const theme = useChartTheme()

  const hasRevenue = data.some((point) => point.revenue !== 0 || point.orders !== 0)

  return (
    <ChartFrame
      title="Revenue and orders"
      subtitle="Confirmed orders only, with new customers acquired per period"
      height={300}
      loading={loading}
      empty={!hasRevenue}
      actions={
        <div className="flex rounded bg-plm-input p-0.5">
          {BUCKETS.map((option) => (
            <button
              key={option}
              onClick={() => onBucketChange(option)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded capitalize transition-colors ${
                bucket === option
                  ? 'bg-plm-bg text-plm-fg shadow-sm'
                  : 'text-plm-fg-muted hover:text-plm-fg'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={withAlpha(theme.accent, 0.35)} />
              <stop offset="100%" stopColor={withAlpha(theme.accent, 0.02)} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="bucket_start"
            tickFormatter={(value: string) => formatBucket(value, bucket)}
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={{ stroke: theme.border }}
            tickLine={false}
            minTickGap={16}
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
            yAxisId="count"
            orientation="right"
            tickFormatter={formatCompact}
            tick={{ fill: theme.fgMuted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={32}
          />

          <Tooltip
            cursor={{ fill: withAlpha(theme.fgMuted, 0.08) }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]?.payload as TimeseriesPoint
              return (
                <TooltipCard title={formatBucketLong(String(label), bucket)}>
                  <TooltipRow
                    color={theme.accent}
                    label="Revenue"
                    value={formatAmount(point.revenue)}
                  />
                  <TooltipRow
                    color={theme.info}
                    label="Orders"
                    value={formatCount(point.orders)}
                  />
                  <TooltipRow label="Buyers" value={formatCount(point.buyers)} />
                  <TooltipRow
                    color={theme.success}
                    label="New customers"
                    value={formatCount(point.new_customers)}
                  />
                </TooltipCard>
              )
            }}
          />

          <Area
            yAxisId="money"
            type="monotone"
            dataKey="revenue"
            stroke={theme.accent}
            strokeWidth={2}
            fill="url(#revenue-fill)"
            isAnimationActive={false}
          />
          <Bar
            yAxisId="count"
            dataKey="new_customers"
            fill={withAlpha(theme.success, 0.5)}
            radius={[2, 2, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="orders"
            stroke={theme.info}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
