/**
 * Number and date formatting for the Customers workspace.
 *
 * MONEY HAS NO CURRENCY. The Odoo sync reads sale.order.currency_id and drops
 * it - customer_orders has an amount but no currency column - so every amount
 * here renders as a bare number. Do not add a currency symbol until the column
 * exists, because guessing one is worse than omitting it.
 */

/**
 * Shown to the user anywhere an unlabelled amount could be mistaken for a
 * specific currency.
 */
export const MONEY_NOTE =
  'Amounts are unitless: Odoo reports a currency per order but the sync has nowhere to store it, so no symbol is shown.'

const countFormat = new Intl.NumberFormat()

const amountFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const amountWholeFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Elapsed wall clock, for a job that is still running. `2m 14s`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** Full precision. Use in tooltips and detail rows, never on an axis. */
export function formatAmount(value: number | null | undefined): string {
  return amountFormat.format(value ?? 0)
}

/** Whole units. Use where two decimals would be noise, e.g. KPI headlines. */
export function formatAmountWhole(value: number | null | undefined): string {
  return amountWholeFormat.format(value ?? 0)
}

/** Axis-sized: 12.4K, 1.2M. */
export function formatCompact(value: number | null | undefined): string {
  return compactFormat.format(value ?? 0)
}

export function formatCount(value: number | null | undefined): string {
  return countFormat.format(value ?? 0)
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '-'
  return `${(value * 100).toFixed(digits)}%`
}

/**
 * Period-over-period change as a ratio, or null when there is no baseline.
 *
 * Growth from zero is deliberately null rather than Infinity or 100%: "revenue
 * went from 0 to 40k" is a fact about starting up, and rendering it as +100%
 * would understate it while +Inf% would just be noise.
 */
export function computeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  const now = current ?? 0
  const before = previous ?? 0
  if (before === 0) return null
  return (now - before) / Math.abs(before)
}

export function formatDelta(delta: number | null): string {
  if (delta == null) return '-'
  const sign = delta > 0 ? '+' : ''
  const magnitude = Math.abs(delta)
  // Swings above 10x say "this is a tiny baseline", not a meaningful rate.
  if (magnitude >= 10) return `${sign}${Math.round(delta)}x`
  return `${sign}${(delta * 100).toFixed(magnitude < 0.1 ? 1 : 0)}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

export type Bucket = 'day' | 'week' | 'month' | 'quarter'

/** Axis tick for a timeseries bucket. Kept short so ticks do not collide. */
export function formatBucket(value: string, bucket: Bucket): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  switch (bucket) {
    case 'day':
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    case 'week':
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${String(date.getFullYear()).slice(2)}`
    case 'month':
    default:
      return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  }
}

/** Unambiguous label for tooltips, where there is room for the full period. */
export function formatBucketLong(value: string, bucket: Bucket): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  switch (bucket) {
    case 'day':
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    case 'week':
      return `Week of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
    case 'month':
    default:
      return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
}

/** "3 months ago" / "12 days ago", for recency columns. */
export function formatRelativeDays(days: number | null | undefined): string {
  if (days == null) return 'never'
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 45) return `${days}d ago`
  const months = Math.round(days / 30)
  if (months < 24) return `${months}mo ago`
  return `${Math.round(days / 365)}y ago`
}
