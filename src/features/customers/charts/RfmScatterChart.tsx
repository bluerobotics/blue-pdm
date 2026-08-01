import { memo, useMemo } from 'react'
import {
  CartesianGrid,
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
import { SEGMENT_IDS, segmentMeta } from '../lib/segments'

interface RfmScatterChartProps {
  rows: CustomerRfmRow[]
  loading: boolean
  onSelect: (row: CustomerRfmRow) => void
}

/**
 * Most bubbles the chart will draw.
 *
 * Every point becomes an SVG symbol, and Recharts rebuilds the chart tree
 * whenever the tooltip's active point changes - which is on every mousemove
 * across the plot. At the roster cap of 5000 that render measured ~1.7s, so
 * moving the mouse over the Overview produced a continuous run of second-long
 * freezes that stalled hover and cursor feedback across the whole window.
 *
 * A 300px-tall plot cannot separate that many bubbles in any case: at the
 * radii this chart uses they overplot into a solid mass well before 5000.
 */
const MAX_POINTS = 900

/**
 * Biggest spenders always survive the downsample. They are the largest bubbles
 * and the ones worth clicking, so losing one of them is the only omission a
 * reader would actually notice.
 */
const KEEP_TOP_SPENDERS = 200

/**
 * Bounds the plotted set while keeping its shape.
 *
 * Takes every top spender, then walks the remainder at a fixed stride. Because
 * the remainder is ordered by spend, the stride spreads the sample evenly down
 * the spend range instead of clipping its tail.
 */
function selectPoints(points: ScatterPoint[]): ScatterPoint[] {
  if (points.length <= MAX_POINTS) return points

  const bySpend = [...points].sort((a, b) => b.total_spent - a.total_spent)
  const kept = bySpend.slice(0, KEEP_TOP_SPENDERS)

  const tail = bySpend.slice(KEEP_TOP_SPENDERS)
  const wanted = MAX_POINTS - KEEP_TOP_SPENDERS
  // At least 1, so the indices below strictly increase and never repeat a row.
  const stride = tail.length / wanted

  for (let index = 0; index < wanted; index++) {
    kept.push(tail[Math.floor(index * stride)])
  }

  return kept
}

/**
 * Recency against frequency, bubble size by spend.
 *
 * Plots only customers who bought inside the selected range. Everyone else
 * sits at zero orders with no recency to plot, so they would pile onto one
 * axis and squash the real distribution.
 *
 * Points are split into one series per lifecycle segment so each series can
 * carry a flat fill. Colouring a single series meant emitting a <Cell> element
 * per customer, which for a large org is thousands of React nodes rebuilt on
 * every filter change; this is at most five regardless of org size.
 *
 * Memoized because the Overview re-renders on every filter and panel change,
 * and this is by far the most expensive chart on it to rebuild.
 */
export const RfmScatterChart = memo(function RfmScatterChart({
  rows,
  loading,
  onSelect,
}: RfmScatterChartProps) {
  const theme = useChartTheme()

  const series = useMemo(() => {
    const eligible: ScatterPoint[] = []

    for (const row of rows) {
      if (row.recency_days == null || row.order_count <= 0) continue

      eligible.push({
        ...row,
        x: row.recency_days,
        y: row.order_count,
        z: Math.max(row.total_spent, 1),
      })
    }

    const plotted = selectPoints(eligible)

    const bySegment = new Map<string, ScatterPoint[]>()
    for (const point of plotted) {
      const bucket = bySegment.get(point.segment)
      if (bucket) bucket.push(point)
      else bySegment.set(point.segment, [point])
    }

    // Ordered by SEGMENT_IDS rather than by insertion so the draw order, and
    // therefore which bubbles end up on top, does not depend on the sort.
    const ordered: { id: string; points: ScatterPoint[] }[] = SEGMENT_IDS.filter((id) =>
      bySegment.has(id),
    ).map((id) => ({ id, points: bySegment.get(id) as ScatterPoint[] }))

    // A segment the SQL produced that this file does not know about would
    // otherwise vanish from the chart without a trace.
    for (const [id, points] of bySegment) {
      if (!SEGMENT_IDS.includes(id as (typeof SEGMENT_IDS)[number])) ordered.push({ id, points })
    }

    return { ordered, total: eligible.length, plotted: plotted.length }
  }, [rows])

  const subtitle =
    series.plotted < series.total
      ? `Showing ${formatCount(series.plotted)} of ${formatCount(series.total)} customers - every top spender, the rest evenly sampled. Click a bubble to open.`
      : 'Each bubble is a customer; size is spend in the selected range. Click to open.'

  return (
    <ChartFrame
      title="Recency, frequency and value"
      subtitle={subtitle}
      height={300}
      loading={loading}
      empty={series.total === 0}
      emptyMessage="No customers with confirmed orders in this period"
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
              const row = payload[0]?.payload as ScatterPoint
              const meta = segmentMeta(row.segment)
              return (
                <TooltipCard title={row.name}>
                  <TooltipRow color={meta.color(theme)} label="Segment" value={meta.label} />
                  <TooltipRow label="Last order" value={formatRelativeDays(row.recency_days)} />
                  <TooltipRow label="Orders" value={formatCount(row.order_count)} />
                  <TooltipRow label="Spend" value={formatAmount(row.total_spent)} />
                  {row.category_label && (
                    <TooltipRow label="Category" value={row.category_label} />
                  )}
                </TooltipCard>
              )
            }}
          />

          {series.ordered.map(({ id, points }) => {
            const color = segmentMeta(id).color(theme)
            return (
              <Scatter
                key={id}
                name={segmentMeta(id).label}
                data={points}
                fill={color}
                fillOpacity={0.55}
                stroke={color}
                strokeOpacity={0.9}
                isAnimationActive={false}
                className="cursor-pointer"
                onClick={(entry) => {
                  const row = entry?.payload as CustomerRfmRow | undefined
                  if (row) onSelect(row)
                }}
              />
            )
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
})

interface ScatterPoint extends CustomerRfmRow {
  x: number
  y: number
  z: number
}
