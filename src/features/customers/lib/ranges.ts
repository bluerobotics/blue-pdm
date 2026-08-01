import type { CustomerBucket, CustomerRangeId } from '@/stores/types'

export interface RangeOption {
  id: CustomerRangeId
  label: string
  /**
   * The range as a phrase that can follow a figure, e.g. "40,120 over the last
   * 90 days". Every table in the module reports the window rather than lifetime
   * totals, so each one has to say which window it means.
   */
  scopeLabel: string
  /** Bucket that keeps the trend chart readable at this width. */
  defaultBucket: CustomerBucket
  /** How many cohort months the retention grid should request. */
  cohortMonths: number
}

export const RANGE_OPTIONS: RangeOption[] = [
  {
    id: '30d',
    label: '30 days',
    scopeLabel: 'over the last 30 days',
    defaultBucket: 'day',
    cohortMonths: 6,
  },
  {
    id: '90d',
    label: '90 days',
    scopeLabel: 'over the last 90 days',
    defaultBucket: 'week',
    cohortMonths: 6,
  },
  {
    id: 'ytd',
    label: 'YTD',
    scopeLabel: 'year to date',
    defaultBucket: 'month',
    cohortMonths: 12,
  },
  {
    id: '12m',
    label: '12 months',
    scopeLabel: 'over the last 12 months',
    defaultBucket: 'month',
    cohortMonths: 12,
  },
  {
    id: '24m',
    label: '24 months',
    scopeLabel: 'over the last 24 months',
    defaultBucket: 'month',
    cohortMonths: 24,
  },
  {
    id: 'all',
    label: 'All time',
    scopeLabel: 'all time',
    defaultBucket: 'quarter',
    cohortMonths: 36,
  },
]

export function rangeOption(id: CustomerRangeId): RangeOption {
  return RANGE_OPTIONS.find((option) => option.id === id) ?? RANGE_OPTIONS[3]
}

export interface ResolvedWindow {
  from: string
  to: string
  /** Human label for the comparison chip, e.g. "vs previous 12 months". */
  comparisonLabel: string
  /** The window as a phrase, e.g. "over the last 12 months". */
  scopeLabel: string
}

/**
 * Turns a preset into a concrete window.
 *
 * `to` is the start of tomorrow rather than "now" so orders placed earlier
 * today are inside the window - the RPCs use a half-open `>= from AND < to`
 * range, and a `to` of now would silently exclude the last few hours.
 */
export function resolveWindow(id: CustomerRangeId, now: Date = new Date()): ResolvedWindow {
  const to = new Date(now)
  to.setHours(0, 0, 0, 0)
  to.setDate(to.getDate() + 1)

  const from = new Date(to)

  switch (id) {
    case '30d':
      from.setDate(from.getDate() - 30)
      break
    case '90d':
      from.setDate(from.getDate() - 90)
      break
    case 'ytd':
      from.setMonth(0, 1)
      break
    case '24m':
      from.setFullYear(from.getFullYear() - 2)
      break
    case 'all':
      // Far enough back to precede any plausible Odoo history, while staying a
      // real date so the timeseries spine and the SQL range stay well-defined.
      from.setFullYear(1970, 0, 1)
      break
    case '12m':
    default:
      from.setFullYear(from.getFullYear() - 1)
      break
  }

  const option = rangeOption(id)

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    comparisonLabel:
      id === 'all' ? 'no comparison period' : `vs previous ${option.label.toLowerCase()}`,
    scopeLabel: option.scopeLabel,
  }
}
