import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

import type { AnalyticsSummary, TimeseriesPoint } from '../data/types'
import { useChartTheme, withAlpha } from '../lib/chartTheme'
import {
  computeDelta,
  formatAmountWhole,
  formatCompact,
  formatCount,
  formatDelta,
  MONEY_NOTE,
} from '../lib/format'

interface KpiStripProps {
  summary: AnalyticsSummary | null
  timeseries: TimeseriesPoint[]
  loading: boolean
  comparisonLabel: string
}

interface Kpi {
  id: string
  label: string
  value: string
  delta: number | null
  /** Whether a rise is good. Discount is the one metric where it is not. */
  positiveIsGood: boolean
  spark: number[]
  hint: string
  /** Adds the "no currency" explanation to the card's tooltip. */
  money?: boolean
}

export function KpiStrip({ summary, timeseries, loading, comparisonLabel }: KpiStripProps) {
  const kpis = useMemo<Kpi[]>(() => {
    if (!summary) return []

    const revenueSpark = timeseries.map((point) => point.revenue)
    const orderSpark = timeseries.map((point) => point.orders)
    const buyerSpark = timeseries.map((point) => point.buyers)
    const newSpark = timeseries.map((point) => point.new_customers)
    const aovSpark = timeseries.map((point) =>
      point.orders > 0 ? point.revenue / point.orders : 0,
    )

    return [
      {
        id: 'revenue',
        label: 'Revenue',
        value: formatAmountWhole(summary.revenue),
        delta: computeDelta(summary.revenue, summary.prev_revenue),
        positiveIsGood: true,
        spark: revenueSpark,
        money: true,
        hint: 'Confirmed orders only. Quotes and cancellations are excluded.',
      },
      {
        id: 'orders',
        label: 'Orders',
        value: formatCount(summary.orders),
        delta: computeDelta(summary.orders, summary.prev_orders),
        positiveIsGood: true,
        spark: orderSpark,
        hint: 'Confirmed sales orders in the selected period.',
      },
      {
        id: 'aov',
        label: 'Avg order value',
        value: formatAmountWhole(summary.aov ?? 0),
        delta: computeDelta(summary.aov, summary.prev_aov),
        positiveIsGood: true,
        spark: aovSpark,
        money: true,
        hint: 'Revenue divided by order count.',
      },
      {
        id: 'buyers',
        label: 'Buyers',
        value: formatCount(summary.buyers),
        delta: computeDelta(summary.buyers, summary.prev_buyers),
        positiveIsGood: true,
        spark: buyerSpark,
        hint: 'Distinct customers who placed at least one confirmed order.',
      },
      {
        id: 'new',
        label: 'New customers',
        value: formatCount(summary.new_customers),
        delta: computeDelta(summary.new_customers, summary.prev_new_customers),
        positiveIsGood: true,
        spark: newSpark,
        hint: 'Customers whose very first order falls inside this period.',
      },
      {
        id: 'discount',
        label: 'Discount given',
        value: formatAmountWhole(summary.discount),
        delta: computeDelta(summary.discount, summary.prev_discount),
        positiveIsGood: false,
        spark: [],
        money: true,
        hint: 'Total discount across confirmed orders in the period.',
      },
    ]
  }, [summary, timeseries])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-[86px] rounded-lg border border-plm-border bg-plm-bg-light animate-pulse"
            style={{ animationDelay: `${index * 70}ms` }}
          />
        ))}
      </div>
    )
  }

  if (kpis.length === 0) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} comparisonLabel={comparisonLabel} />
      ))}
    </div>
  )
}

function KpiCard({ kpi, comparisonLabel }: { kpi: Kpi; comparisonLabel: string }) {
  const theme = useChartTheme()

  const improving = kpi.delta == null ? null : kpi.positiveIsGood ? kpi.delta > 0 : kpi.delta < 0
  const deltaColor =
    improving == null ? 'text-plm-fg-muted' : improving ? 'text-plm-success' : 'text-plm-error'
  const DeltaIcon = kpi.delta == null ? Minus : kpi.delta > 0 ? ArrowUpRight : ArrowDownRight

  const sparkData = kpi.spark.map((value, index) => ({ index, value }))
  const sparkColor = improving === false ? theme.error : theme.accent

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-plm-border bg-plm-bg-light px-3 pt-2.5 pb-2"
      title={[
        kpi.hint,
        `Change is measured ${comparisonLabel}.`,
        kpi.money ? MONEY_NOTE : null,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted">{kpi.label}</div>
      <div className="mt-1 text-lg font-semibold text-plm-fg tabular-nums leading-tight">
        {kpi.value}
      </div>

      <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${deltaColor}`}>
        <DeltaIcon size={12} />
        <span className="tabular-nums">{formatDelta(kpi.delta)}</span>
        {kpi.delta == null && <span className="text-plm-fg-muted">no baseline</span>}
      </div>

      {sparkData.length > 1 && (
        <div className="absolute bottom-0 right-0 left-0 h-7 opacity-60 pointer-events-none">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={withAlpha(sparkColor, 0.45)} />
                  <stop offset="100%" stopColor={withAlpha(sparkColor, 0)} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={sparkColor}
                strokeWidth={1.5}
                fill={`url(#spark-${kpi.id})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/** Compact secondary stats shown under the KPI strip. */
export function PortfolioStrip({ summary }: { summary: AnalyticsSummary | null }) {
  if (!summary) return null

  const entries = [
    { label: 'Total customers', value: formatCount(summary.total_customers) },
    { label: 'Active', value: formatCount(summary.active_customers) },
    { label: 'At risk', value: formatCount(summary.at_risk_customers) },
    { label: 'Churned', value: formatCount(summary.churned_customers) },
    { label: 'Gone from Odoo', value: formatCount(summary.gone_customers) },
    { label: 'Unclassified accounts', value: formatCount(summary.unclassified_accounts) },
    { label: 'Units shipped', value: formatCompact(summary.units) },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[11px]">
      {entries.map((entry) => (
        <span key={entry.label} className="flex items-center gap-1.5">
          <span className="text-plm-fg-muted">{entry.label}</span>
          <span className="text-plm-fg tabular-nums font-medium">{entry.value}</span>
        </span>
      ))}
    </div>
  )
}
