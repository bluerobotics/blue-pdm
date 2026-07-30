/**
 * Lifecycle segment presentation.
 *
 * The segments themselves are decided in SQL by customer_lifecycle_segment()
 * so the KPI strip, the sidebar counts and the table badges cannot drift. This
 * module only carries how each one is labelled and coloured; changing a
 * threshold means changing the SQL function, not this file.
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
