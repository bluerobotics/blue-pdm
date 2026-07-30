import { formatCount } from '../lib/format'
import type { SyncResponse } from '../hooks/useCustomerSync'

/**
 * Per-table breakdown of what the last Odoo sync changed.
 *
 * Worth the space: the sync is the only way data enters this module, and
 * "0 new, 0 updated" versus "12 skipped (partner not mirrored)" are very
 * different outcomes that a success toast alone would hide.
 */
export function SyncSummary({ result }: { result: SyncResponse }) {
  const unavailable = Object.entries(result.fields_unavailable ?? {}).filter(
    ([, fields]) => fields.length > 0,
  )

  const lines: { label: string; value: string }[] = [
    {
      label: 'Customers',
      value: `${formatCount(result.customers?.created ?? 0)} new, ${formatCount(
        result.customers?.updated ?? 0,
      )} updated, ${formatCount(
        result.customers?.reactivated ?? 0,
      )} reactivated, ${formatCount(result.customers?.marked_inactive ?? 0)} marked inactive`,
    },
    {
      label: 'Accounts',
      value: `${formatCount(result.customer_accounts?.created ?? 0)} new, ${formatCount(
        result.customer_accounts?.linked ?? 0,
      )} linked`,
    },
    {
      label: 'Orders',
      value: `${formatCount(result.customer_orders?.created ?? 0)} new, ${formatCount(
        result.customer_orders?.updated ?? 0,
      )} updated${
        result.customer_orders?.skipped_unknown_partner
          ? `, ${formatCount(result.customer_orders.skipped_unknown_partner)} skipped (partner not mirrored)`
          : ''
      }`,
    },
    {
      label: 'Order lines',
      value: `${formatCount(result.customer_order_lines?.replaced ?? 0)} replaced`,
    },
    {
      label: 'Addresses',
      value: `${formatCount(result.customer_addresses?.created ?? 0)} new, ${formatCount(
        result.customer_addresses?.updated ?? 0,
      )} updated`,
    },
  ]

  return (
    <div className="p-2 rounded bg-plm-success/10 border border-plm-success/30 space-y-1">
      <div className="text-xs font-medium text-plm-success">
        {result.mode === 'full' ? 'Full sync finished' : 'Sync finished'}
        {typeof result.duration_ms === 'number'
          ? ` in ${(result.duration_ms / 1000).toFixed(1)}s`
          : ''}
      </div>
      {result.mode === 'incremental' && (
        <p className="text-[11px] text-plm-fg-dim">
          Only what changed in Odoo since the last sync was read.
        </p>
      )}
      {lines.map((line) => (
        <div key={line.label} className="flex gap-2 text-[11px] text-plm-fg-muted">
          <span className="w-20 flex-shrink-0 text-plm-fg-dim">{line.label}</span>
          <span className="flex-1">{line.value}</span>
        </div>
      ))}
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
