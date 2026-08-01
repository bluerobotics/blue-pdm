import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { ChartFrame } from '../components/ChartFrame'
import { TooltipCard, TooltipRow } from '../components/TooltipCard'
import type { ChannelCounts } from '../hooks/useChannelCounts'
import { CHANNEL_IDS, CHANNELS, type ChannelId } from '../lib/channels'
import { useChartTheme, type ChartTheme } from '../lib/chartTheme'
import { formatAmount, formatCount, formatPercent } from '../lib/format'

interface ChannelMixChartProps {
  counts: ChannelCounts
  /** Adds the clicked slice to the workspace filters. */
  onSelect: (channel: ChannelId) => void
  selected: string[]
}

type Metric = 'revenue' | 'accounts'

interface Slice {
  channel: ChannelId
  label: string
  color: string
  value: number
  share: number
  revenue: number
  accounts: number
  customers: number
  orders: number
}

/**
 * Each channel keeps the hue of its badge, so a slice and the tag on an account
 * row are recognisably the same thing.
 */
function channelColor(theme: ChartTheme, channel: ChannelId): string {
  if (channel === 'distributor') return theme.accent
  if (channel === 'integrator') return theme.info
  return theme.fgMuted
}

/**
 * How the business splits across direct, distributors and integrators.
 *
 * Offered by revenue and by account count because the two say opposite things:
 * a few dozen partners can carry a large share of revenue while barely
 * registering against thousands of direct accounts, and either number on its
 * own would be misleading about how much the channel matters.
 *
 * The revenue split follows the date range like the charts around it. The
 * account split does not: it describes who your partners are, which does not
 * change because the dashboard is showing the last 90 days.
 */
export function ChannelMixChart({ counts, onSelect, selected }: ChannelMixChartProps) {
  const theme = useChartTheme()
  const [metric, setMetric] = useState<Metric>('revenue')

  const slices = useMemo<Slice[]>(() => {
    const rows = CHANNEL_IDS.map((channel) => {
      const row = counts.byChannel[channel]
      return {
        channel,
        label: CHANNELS[channel].plural,
        color: channelColor(theme, channel),
        value: metric === 'revenue' ? row.revenue : row.account_count,
        share: 0,
        revenue: row.revenue,
        accounts: row.account_count,
        customers: row.customer_count,
        orders: row.orders,
      }
    })

    const total = rows.reduce((sum, row) => sum + row.value, 0)
    if (total === 0) return []

    // Channels stay in their fixed order rather than sorting by size, so the
    // ring does not rearrange itself when you switch metric.
    return rows
      .filter((row) => row.value > 0)
      .map((row) => ({ ...row, share: row.value / total }))
  }, [counts.byChannel, metric, theme])

  return (
    <ChartFrame
      title={metric === 'revenue' ? 'Revenue by channel' : 'Accounts by channel'}
      subtitle="How they buy from us. Click a slice to filter the workspace."
      height={300}
      loading={counts.loading}
      empty={slices.length === 0}
      emptyMessage="No accounts to split by channel"
      actions={
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-plm-bg">
          {(['revenue', 'accounts'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setMetric(option)}
              className={`px-1.5 py-0.5 text-[10px] rounded capitalize transition-colors ${
                metric === option
                  ? 'bg-plm-bg-light text-plm-fg'
                  : 'text-plm-fg-muted hover:text-plm-fg'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-full flex items-center gap-2">
        <div className="h-full flex-1 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="55%"
                outerRadius="82%"
                paddingAngle={1.5}
                stroke={theme.bg}
                strokeWidth={2}
                isAnimationActive={false}
                onClick={(entry) => {
                  const slice = entry?.payload as Slice | undefined
                  if (slice) onSelect(slice.channel)
                }}
                className="cursor-pointer focus:outline-none"
              >
                {slices.map((slice) => (
                  <Cell
                    key={slice.channel}
                    fill={slice.color}
                    opacity={
                      selected.length > 0 && !selected.includes(slice.channel) ? 0.35 : 1
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
                      <TooltipRow label="Share" value={formatPercent(slice.share, 1)} />
                      <TooltipRow label="Revenue" value={formatAmount(slice.revenue)} />
                      <TooltipRow label="Accounts" value={formatCount(slice.accounts)} />
                      <TooltipRow label="Contacts" value={formatCount(slice.customers)} />
                      <TooltipRow label="Orders" value={formatCount(slice.orders)} />
                    </TooltipCard>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="w-[44%] space-y-0.5">
          {slices.map((slice) => (
            <button
              key={slice.channel}
              onClick={() => onSelect(slice.channel)}
              title={CHANNELS[slice.channel].description}
              className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left hover:bg-plm-bg transition-colors group"
            >
              <span
                className="w-2 h-2 rounded-[2px] shrink-0"
                style={{ backgroundColor: slice.color }}
              />
              <span className="flex-1 min-w-0 truncate text-[11px] text-plm-fg-dim group-hover:text-plm-fg">
                {slice.label}
              </span>
              <span className="text-[10px] text-plm-fg-muted tabular-nums shrink-0">
                {metric === 'revenue' ? formatAmount(slice.revenue) : formatCount(slice.accounts)}
              </span>
              <span className="w-8 text-right text-[10px] text-plm-fg-muted tabular-nums shrink-0">
                {formatPercent(slice.share, 0)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ChartFrame>
  )
}
