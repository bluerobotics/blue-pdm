import type { ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'

interface ChartFrameProps {
  title: string
  /** One line saying how to read the chart, or what the numbers exclude. */
  subtitle?: string
  /** Toolbar rendered on the right of the header: granularity toggles, etc. */
  actions?: ReactNode
  loading?: boolean
  /** True when the query succeeded but returned nothing to plot. */
  empty?: boolean
  emptyMessage?: string
  /** Fixed body height. Recharts' responsive container needs a bounded parent. */
  height?: number
  className?: string
  children: ReactNode
}

/**
 * Shared shell for every chart on the Overview tab, so they line up and share
 * one loading and empty treatment.
 */
export function ChartFrame({
  title,
  subtitle,
  actions,
  loading = false,
  empty = false,
  emptyMessage = 'No data in this range',
  height = 260,
  className = '',
  children,
}: ChartFrameProps) {
  return (
    <div
      className={`flex flex-col bg-plm-bg-light border border-plm-border rounded-lg overflow-hidden ${className}`}
    >
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-plm-fg truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-plm-fg-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>

      <div className="px-2 pb-2" style={{ height }}>
        {loading ? (
          <ChartSkeleton />
        ) : empty ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <BarChart3 size={20} className="text-plm-fg-muted/60" />
            <p className="text-xs text-plm-fg-muted">{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

/**
 * Bar-shaped skeleton rather than a spinner: it reserves the same space the
 * chart will take, so the dashboard does not reflow as each query lands.
 */
function ChartSkeleton() {
  const heights = [45, 70, 35, 85, 55, 95, 40, 75, 60, 88, 50, 68]

  return (
    <div className="h-full flex items-end gap-1.5 px-3 pb-6 pt-3">
      {heights.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-sm bg-plm-fg-muted/10 animate-pulse"
          style={{ height: `${value}%`, animationDelay: `${index * 60}ms` }}
        />
      ))}
    </div>
  )
}
