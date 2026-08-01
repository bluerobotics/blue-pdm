import { memo, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Building2 } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'

import type { CustomerRfmRow } from '../data/types'
import { channelMeta } from '../lib/channels'
import { formatAmount, formatCount, formatRelativeDays } from '../lib/format'
import type { AccountRollup } from '../lib/rollup'
import { segmentMeta } from '../lib/segments'

interface AccountsTabProps {
  accounts: AccountRollup<CustomerRfmRow>[]
  loading: boolean
}

/** Row height in px. Fixed so the virtualizer needs no measurement pass. */
const ROW_HEIGHT = 48

/** Vertical gap between rows, matching the old space-y-1. */
const ROW_GAP = 4

/**
 * Account-level rollup, derived from the same RFM rows the customer table uses
 * rather than a separate query.
 *
 * The grouping mirrors what enrichment attaches to: several Odoo partners (a
 * company plus its contacts) collapse onto one account so research is paid for
 * once. Customers with no account stand alone. Both this tab and the customer
 * table roll up through `rollUpByAccount`, so the two cannot disagree about an
 * account's spend or its segment.
 *
 * Virtualized for the same reason the customer table is: an org whose partners
 * are mostly individuals rolls up to nearly one account per customer, and this
 * used to put every one of them in the DOM at once.
 */
export function AccountsTab({ accounts, loading }: AccountsTabProps) {
  const setCustomerPanel = usePDMStore((s) => s.setCustomerPanel)
  const openCustomerId = usePDMStore((s) => s.customerPanel?.customerId ?? null)

  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(
    () => [...accounts].sort((a, b) => b.totalSpent - a.totalSpent),
    [accounts],
  )

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 8,
  })

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden space-y-1.5">
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

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <Building2 size={22} className="text-plm-fg-muted/60" />
        <p className="text-sm text-plm-fg-dim">No accounts match these filters</p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const account = sorted[virtualRow.index]

          return (
            <div
              key={account.key}
              className="absolute left-0 right-0"
              style={{ height: ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
            >
              <AccountRow
                account={account}
                isOpen={openCustomerId === account.lead.customer_id}
                onOpen={setCustomerPanel}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface AccountRowProps {
  account: AccountRollup<CustomerRfmRow>
  isOpen: boolean
  onOpen: (panel: { customerId: string; name: string }) => void
}

const AccountRow = memo(function AccountRow({ account, isOpen, onOpen }: AccountRowProps) {
  const meta = segmentMeta(account.segment)
  const channel = channelMeta(account.channel)

  return (
    <button
      onClick={() => onOpen({ customerId: account.lead.customer_id, name: account.lead.name })}
      className={`w-full h-full flex items-center gap-3 px-3 rounded-lg border text-left transition-colors ${
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
          {/* Partners only: badging 'Direct' would label nearly every row. */}
          {account.channel !== 'direct' && (
            <span
              className={`px-1.5 py-px rounded text-[10px] font-medium shrink-0 ${channel.badgeClass}`}
              title={channel.description}
            >
              {channel.label}
            </span>
          )}
        </div>
        <div className="text-[11px] text-plm-fg-muted truncate">
          {account.categoryLabel ?? 'Unclassified'}
          {account.countries.length > 0 && ` · ${account.countries.join(', ')}`}
          {account.hasMembers && ` · ${account.members.length} contacts`}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-sm tabular-nums text-plm-fg">{formatAmount(account.totalSpent)}</div>
        <div className="text-[11px] text-plm-fg-muted tabular-nums">
          {formatCount(account.orderCount)} orders · {formatRelativeDays(account.recencyDays)}
        </div>
      </div>
    </button>
  )
})
