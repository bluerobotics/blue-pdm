/**
 * Lifecycle segments: how they are labelled, and the one client-side mirror of
 * how they are decided.
 *
 * customer_lifecycle_segment() in 60-customers.sql is the source of truth, and
 * anything reading the RFM aggregate takes the segment straight from it. Two
 * places cannot: the detail panel loads a plain customers row, and the account
 * roll-up combines several rows into one whose segment no query has computed.
 * Both go through {@link deriveSegment} here rather than keeping a copy each.
 *
 * Changing a threshold means changing the SQL function AND deriveSegment.
 */

import type { ChartTheme } from './chartTheme'

export const SEGMENT_IDS = ['new', 'active', 'at_risk', 'churned', 'prospect'] as const

export type SegmentId = (typeof SEGMENT_IDS)[number]

export interface SegmentMeta {
  id: SegmentId
  label: string
  /** Shown as the tooltip on the sidebar row, so it states the actual rule. */
  description: string
  /** Tailwind classes for the badge in the table. */
  badgeClass: string
  color: (theme: ChartTheme) => string
}

export const SEGMENTS: Record<SegmentId, SegmentMeta> = {
  new: {
    id: 'new',
    label: 'New',
    description: 'First order within the last 90 days',
    badgeClass: 'bg-plm-info/15 text-plm-info',
    color: (theme) => theme.info,
  },
  active: {
    id: 'active',
    label: 'Active',
    description: 'Ordered within the last 180 days',
    badgeClass: 'bg-plm-success/15 text-plm-success',
    color: (theme) => theme.success,
  },
  at_risk: {
    id: 'at_risk',
    label: 'At risk',
    description: 'Last order 180 to 365 days ago',
    badgeClass: 'bg-plm-warning/15 text-plm-warning',
    color: (theme) => theme.warning,
  },
  churned: {
    id: 'churned',
    label: 'Churned',
    description: 'No order in over 365 days',
    badgeClass: 'bg-plm-error/15 text-plm-error',
    color: (theme) => theme.error,
  },
  prospect: {
    id: 'prospect',
    label: 'Never ordered',
    description: 'In Odoo as a customer but has no confirmed order',
    badgeClass: 'bg-plm-fg-muted/15 text-plm-fg-muted',
    color: (theme) => theme.fgMuted,
  },
}

export function segmentMeta(id: string | null | undefined): SegmentMeta {
  if (id && id in SEGMENTS) return SEGMENTS[id as SegmentId]
  return SEGMENTS.prospect
}

export function isSegmentId(value: string): value is SegmentId {
  return (SEGMENT_IDS as readonly string[]).includes(value)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between a timestamp and now, or null if there is no timestamp. */
export function daysSince(iso: string | null | undefined, asOf: number = Date.now()): number | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  return Number.isNaN(time) ? null : Math.floor((asOf - time) / DAY_MS)
}

/**
 * Mirror of customer_lifecycle_segment() in 60-customers.sql.
 *
 * The branch order is part of the rule, not an implementation detail: a
 * one-time buyer from two years ago is churned, not new, so recency is tested
 * before the first-order window.
 */
export function deriveSegment(
  orderCount: number | null | undefined,
  firstOrder: string | null,
  lastOrder: string | null,
  asOf: number = Date.now(),
): SegmentId {
  if (!orderCount) return 'prospect'

  const recencyDays = daysSince(lastOrder, asOf)
  if (recencyDays == null) return 'prospect'
  if (recencyDays > 365) return 'churned'
  if (recencyDays > 180) return 'at_risk'

  const firstOrderDays = daysSince(firstOrder, asOf)
  if (firstOrderDays != null && firstOrderDays <= 90) return 'new'

  return 'active'
}
