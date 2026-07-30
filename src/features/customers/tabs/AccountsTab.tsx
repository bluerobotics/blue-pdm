import { useMemo } from 'react'
import { Building2 } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'

import type { CustomerRfmRow } from '../data/types'
import { formatAmount, formatCount, formatRelativeDays } from '../lib/format'
import { segmentMeta } from '../lib/segments'

interface AccountsTabProps {
  rows: CustomerRfmRow[]
  loading: boolean
}

interface AccountRollup {
  key: string
  name: string
  contacts: number
  spend: number
  orders: number
  /** Best (lowest) recency across the account's contacts. */
  recency: number | null
  countries: Set<string>
  categoryLabel: string | null
  segment: string
  /** The contact to open when the row is clicked: the highest spender. */
  leadCustomerId: string
  leadCustomerName: string
}

/**
 * Account-level rollup, derived from the same RFM rows the customer table uses
 * rather than a separate query.
 *
 * The grouping mirrors what enrichment attaches to: several Odoo partners (a
 * company plus its contacts) collapse onto one account so research is paid for
 * once. Customers with no account stand alone.
 */
export function AccountsTab({ rows, loading }: AccountsTabProps) {
  const setCustomerPanel = usePDMStore((s) => s.setCustomerPanel)
  const customerPanel = usePDMStore((s) => s.customerPanel)

  const accounts = useMemo(() => {
    const map = new Map<string, AccountRollup>()

    for (const row of rows) {
      const key = row.account_id ?? `customer:${row.customer_id}`
      const existing = map.get(key)

      if (!existing) {
        map.set(key, {
          key,
          name: row.account_name ?? row.name,
          contacts: 1,
          spend: row.total_spent,
          orders: row.order_count,
          recency: row.recency_days,
          countries: new Set(row.country ? [row.country] : []),
          categoryLabel: row.category_label,
          segment: row.segment,
          leadCustomerId: row.customer_id,
          leadCustomerName: row.name,
        })
        continue
      }

      existing.contacts += 1
      existing.spend += row.total_spent
      existing.orders += row.order_count
      if (row.country) existing.countries.add(row.country)
      if (row.recency_days != null) {
        existing.recency =
          existing.recency == null ? row.recency_days : Math.min(existing.recency, row.recency_days)
      }
      if (row.total_spent > 0 && row.total_spent >= existing.spend - row.total_spent) {
        existing.leadCustomerId = row.customer_id
        existing.leadCustomerName = row.name
      }
    }

    return Array.from(map.values()).sort((a, b) => b.spend - a.spend)
  }, [rows])

  if (loading) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={index}
            className="h-11 rounded-lg border border-plm-border bg-plm-bg-light animate-pulse"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <Building2 size={22} className="text-plm-fg-muted/60" />
        <p className="text-sm text-plm-fg-dim">No accounts match these filters</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {accounts.map((account) => {
        const meta = segmentMeta(account.segment)
        const isOpen = customerPanel?.customerId === account.leadCustomerId

        return (
          <button
            key={account.key}
            onClick={() =>
              setCustomerPanel({
                customerId: account.leadCustomerId,
                name: account.leadCustomerName,
              })
            }
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
              isOpen
                ? 'border-plm-accent/50 bg-plm-selection/30'
                : 'border-plm-border bg-plm-bg-light hover:border-plm-border-light'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-plm-fg">{account.name}</span>
                <span
                  className={`px-1.5 py-px rounded text-[10px] font-medium shrink-0 ${meta.badgeClass}`}
                >
                  {meta.label}
                </span>
              </div>
              <div className="text-[11px] text-plm-fg-muted truncate">
                {account.categoryLabel ?? 'Unclassified'}
                {account.countries.size > 0 && ` · ${Array.from(account.countries).join(', ')}`}
                {account.contacts > 1 && ` · ${account.contacts} contacts`}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-sm tabular-nums text-plm-fg">{formatAmount(account.spend)}</div>
              <div className="text-[11px] text-plm-fg-muted tabular-nums">
                {formatCount(account.orders)} orders · {formatRelativeDays(account.recency)}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
