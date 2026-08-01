import { useEffect } from 'react'

import { formatCount } from '../lib/format'
import type { SyncResponse } from '../hooks/useCustomerSync'

/**
 * What the last Odoo sync changed.
 *
 * Now that most runs are incremental and change little or nothing, a fixed
 * per-table grid was mostly rows of zeroes, so only non-zero counts are
 * listed and the whole thing takes itself away again.
 *
 * What does not time out is anything the operator has to act on: a partner
 * pull that could not be completed, fields this Odoo does not expose, or
 * orders that were dropped. Those are conditions rather than results, and they
 * stay until dismissed.
 */

/** Long enough to read one line, short enough not to become furniture. */
const AUTO_HIDE_MS = 8000

function elapsed(ms: number | undefined): string {
  if (typeof ms !== 'number') return ''
  if (ms < 60_000) return ` in ${(ms / 1000).toFixed(1)}s`
  return ` in ${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function changes(result: SyncResponse): string[] {
  const parts: string[] = []
  const add = (count: number | undefined, label: string) => {
    if (count) parts.push(`${formatCount(count)} ${label}`)
  }

  add(result.customers?.created, 'customers added')
  add(result.customers?.updated, 'customers updated')
  add(result.customers?.reactivated, 'reactivated')
  add(result.customers?.marked_inactive, 'marked inactive')
  add(result.customer_accounts?.created, 'accounts added')
  add(result.customer_accounts?.linked, 'accounts linked')
  add(result.customer_accounts?.renamed, 'accounts renamed')
  add(result.customer_orders?.created, 'orders added')
  add(result.customer_orders?.updated, 'orders updated')
  add(result.customer_order_lines?.replaced, 'order lines replaced')
  add(result.customer_addresses?.created, 'addresses added')
  add(result.customer_addresses?.updated, 'addresses updated')
  add(result.customer_orders?.rolled_up_to_company, 'orders credited to a parent company')
  // skipped_unknown_partner is deliberately absent: a dropped order is revenue
  // missing from the mirror, which is a warning below rather than a statistic.

  return parts
}

export function SyncSummary({
  result,
  onExpire,
}: {
  result: SyncResponse
  onExpire?: () => void
}) {
  const unavailable = Object.entries(result.fields_unavailable ?? {}).filter(
    ([, fields]) => fields.length > 0,
  )
  const ordersSkipped = result.customer_orders?.skipped_unknown_partner ?? 0
  const needsAttention =
    result.partner_pull_complete === false || unavailable.length > 0 || ordersSkipped > 0

  useEffect(() => {
    if (needsAttention || !onExpire) return
    const timer = setTimeout(onExpire, AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [result, needsAttention, onExpire])

  const parts = changes(result)

  return (
    <div className="p-2 rounded bg-plm-success/10 border border-plm-success/30 space-y-1">
      <p className="text-[11px] leading-relaxed">
        <span className="font-medium text-plm-success">
          {result.mode === 'full' ? 'Full sync finished' : 'Sync finished'}
          {elapsed(result.duration_ms)}
        </span>
        <span className="text-plm-fg-muted">
          {parts.length > 0 ? ` — ${parts.join(', ')}` : ' — nothing had changed in Odoo'}
        </span>
      </p>
      {ordersSkipped > 0 && (
        <p className="text-[11px] text-plm-warning">
          {formatCount(ordersSkipped)} orders were dropped because the partner named on them is not
          mirrored as a customer. Their revenue is missing from every total here, and the customers
          behind them can read as churned.
        </p>
      )}
      {result.partner_pull_complete === false && (
        <p className="text-[11px] text-plm-warning">
          This Odoo has no customer flag on partners, so only partners referenced by an order were
          pulled. Customers missing from Odoo were not flagged.
        </p>
      )}
      {unavailable.length > 0 && (
        <p className="text-[11px] text-plm-fg-muted">
          Fields this Odoo does not expose:{' '}
          {unavailable.map(([model, fields]) => `${model} (${fields.join(', ')})`).join('; ')}
        </p>
      )}
    </div>
  )
}
