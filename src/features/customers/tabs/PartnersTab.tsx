import { memo, useMemo } from 'react'
import { AlertCircle, ExternalLink, Handshake, Loader2, SearchX } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'

import { ChannelSelect } from '../components/ChannelSelect'
import type { CustomerRfmRow, PartnerCoverageRow } from '../data/types'
import { usePartnerCoverage, type PartnerCoverage } from '../hooks/usePartnerCoverage'
import { useSetAccountChannel } from '../hooks/useSetAccountChannel'
import { channelMeta, type ChannelId, type PartnerChannelId } from '../lib/channels'
import { formatAmount, formatCount, formatRelativeDays } from '../lib/format'
import { rangeOption } from '../lib/ranges'
import type { AccountRollup } from '../lib/rollup'
import { segmentMeta } from '../lib/segments'

interface PartnersTabProps {
  channel: PartnerChannelId
  /** Every account surviving the sidebar filters, of all channels. */
  accounts: AccountRollup<CustomerRfmRow>[]
  loading: boolean
}

/**
 * The Distributors and Integrators tabs.
 *
 * One component for both because they differ only in which channel they show
 * and in whether there is a published list to check against - and because the
 * whole point of the tab is to be the place a person moves an account from one
 * to the other, which is easier to keep honest when both sides are the same
 * code.
 *
 * These channels are curated by hand, so the tab is built for a person working
 * through a list rather than for analysis: every row carries the control that
 * changes it, and below the list are the partners we can name but found no
 * account for.
 */
export function PartnersTab({ channel, accounts, loading }: PartnersTabProps) {
  const meta = channelMeta(channel)
  const setCustomerPanel = usePDMStore((s) => s.setCustomerPanel)
  const openCustomerId = usePDMStore((s) => s.customerPanel?.customerId ?? null)
  const scopeLabel = usePDMStore((s) => rangeOption(s.customerFilters.range).scopeLabel)

  const { canEdit, pendingId, setChannel } = useSetAccountChannel()
  const coverage = usePartnerCoverage(channel, true)

  const rows = useMemo(
    () =>
      accounts
        .filter((account) => account.channel === channel)
        .sort((a, b) => b.totalSpent - a.totalSpent),
    [accounts, channel],
  )

  const revenue = useMemo(
    () => rows.reduce((total, account) => total + account.totalSpent, 0),
    [rows],
  )

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden space-y-1.5">
        {Array.from({ length: 10 }).map((_, index) => (
          <div
            key={index}
            className="h-11 rounded-lg border border-plm-border bg-plm-bg-light animate-pulse"
            style={{ animationDelay: `${index * 40}ms` }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto space-y-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-plm-fg">
          {formatCount(rows.length)} {rows.length === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}
        </span>
        <span className="text-[11px] text-plm-fg-muted tabular-nums">
          {formatAmount(revenue)} {scopeLabel}
        </span>
        {!coverage.loading && !coverage.error && coverage.knownCount > 0 && (
          <span className="text-[11px] text-plm-fg-muted">
            {formatCount(coverage.matchedCount)} of {formatCount(coverage.knownCount)} named{' '}
            {meta.plural.toLowerCase()} matched to an account
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyChannel channel={channel} canEdit={canEdit} />
      ) : (
        <div className="space-y-1">
          {rows.map((account) => (
            <PartnerRow
              key={account.key}
              account={account}
              isOpen={openCustomerId === account.lead.customer_id}
              canEdit={canEdit}
              pending={pendingId === account.accountId}
              onOpen={setCustomerPanel}
              onChangeChannel={setChannel}
            />
          ))}
        </div>
      )}

      <CoverageGaps coverage={coverage} channel={channel} />
    </div>
  )
}

function EmptyChannel({ channel, canEdit }: { channel: PartnerChannelId; canEdit: boolean }) {
  const meta = channelMeta(channel)

  return (
    <div className="flex flex-col items-center justify-center py-14 gap-2 text-center">
      <Handshake size={22} className="text-plm-fg-muted/60" />
      <p className="text-sm text-plm-fg-dim">No {meta.plural.toLowerCase()} yet</p>
      <p className="text-xs text-plm-fg-muted max-w-md">
        {meta.description}.{' '}
        {canEdit
          ? 'Nothing infers this - open any account and change its channel to add one.'
          : 'Changing an account’s channel needs edit access to the customers module.'}
      </p>
    </div>
  )
}

interface PartnerRowProps {
  account: AccountRollup<CustomerRfmRow>
  isOpen: boolean
  canEdit: boolean
  pending: boolean
  onOpen: (panel: { customerId: string; name: string }) => void
  onChangeChannel: (accountId: string, channel: ChannelId, label: string) => void
}

const PartnerRow = memo(function PartnerRow({
  account,
  isOpen,
  canEdit,
  pending,
  onOpen,
  onChangeChannel,
}: PartnerRowProps) {
  const segment = segmentMeta(account.segment)

  return (
    <div
      onClick={() => onOpen({ customerId: account.lead.customer_id, name: account.lead.name })}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
        isOpen
          ? 'border-plm-accent/50 bg-plm-selection/30'
          : 'border-plm-border bg-plm-bg-light hover:border-plm-border-light'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-plm-fg">{account.name}</span>
          <span
            className={`px-1.5 py-px rounded text-[10px] font-medium shrink-0 ${segment.badgeClass}`}
            title={segment.description}
          >
            {segment.label}
          </span>
        </div>
        <div className="text-[11px] text-plm-fg-muted truncate">
          {account.countries.length > 0 ? account.countries.join(', ') : 'No country'}
          {account.hasMembers && ` · ${formatCount(account.members.length)} contacts`}
          {account.categoryLabel && ` · ${account.categoryLabel}`}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-sm tabular-nums text-plm-fg">{formatAmount(account.totalSpent)}</div>
        <div className="text-[11px] text-plm-fg-muted tabular-nums">
          {formatCount(account.orderCount)} orders · {formatRelativeDays(account.recencyDays)}
        </div>
      </div>

      <ChannelSelect
        channel={account.channel}
        accountId={account.accountId}
        label={account.name}
        canEdit={canEdit}
        pending={pending}
        onChange={onChangeChannel}
        className="shrink-0"
      />
    </div>
  )
})

/**
 * Named partners with no account behind them.
 *
 * Worth showing rather than hiding: we know these companies exist, so a gap is
 * either a partner who has never placed an order or a name mismatch between our
 * list and Odoo. Both are things somebody should know about, and neither is
 * safe to resolve automatically.
 */
function CoverageGaps({
  coverage,
  channel,
}: {
  coverage: PartnerCoverage
  channel: PartnerChannelId
}) {
  const plural = channelMeta(channel).plural.toLowerCase()

  if (coverage.loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-plm-fg-muted">
        <Loader2 size={11} className="animate-spin" />
        Checking the known {plural} against your data
      </div>
    )
  }

  if (coverage.error) {
    return (
      <div className="flex items-start gap-2 p-2 rounded bg-plm-error/10 border border-plm-error/30">
        <AlertCircle size={13} className="text-plm-error shrink-0 mt-0.5" />
        <span className="text-[11px] text-plm-fg-dim">
          Could not check the known {plural}: {coverage.error}
        </span>
      </div>
    )
  }

  if (coverage.unmatched.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <SearchX size={12} className="text-plm-fg-muted" />
        <h4 className="text-[10px] uppercase tracking-wide text-plm-fg-muted">
          Not in your data ({formatCount(coverage.unmatched.length)})
        </h4>
      </div>

      <p className="text-[11px] text-plm-fg-muted max-w-2xl">
        Known {plural}, but no account matches. They have either never ordered, or they are in Odoo
        under a name that normalises to a different key - in which case add that key to
        known_partners() in the customers schema.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1">
        {coverage.unmatched.map((row) => (
          <UnmatchedRow key={row.name} row={row} />
        ))}
      </div>
    </div>
  )
}

function UnmatchedRow({ row }: { row: PartnerCoverageRow }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-dashed border-plm-border text-[11px]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-plm-fg-dim">{row.name}</div>
        <div className="truncate text-[10px] text-plm-fg-muted">{row.country}</div>
      </div>
      {/* No website for a partner we only ever reached on a personal mailbox. */}
      {row.website && (
        <a
          href={`https://${row.website}`}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => event.stopPropagation()}
          title={row.website}
          className="shrink-0 text-plm-fg-muted hover:text-plm-accent transition-colors"
        >
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}
