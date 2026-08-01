import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleSlash } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'

import type { CustomerRfmRow } from '../data/types'
import { channelMeta } from '../lib/channels'
import { formatAmount, formatCount, formatRelativeDays, MONEY_NOTE } from '../lib/format'
import { rangeOption } from '../lib/ranges'
import type { AccountRollup } from '../lib/rollup'
import { segmentMeta } from '../lib/segments'

const ROW_HEIGHT = 30

type SortKey =
  | 'name'
  | 'total_spent'
  | 'order_count'
  | 'recency_days'
  | 'country'
  | 'segment'
  | 'category_label'

interface Column {
  key: SortKey | 'rfm'
  label: string
  width: number
  align?: 'right'
  sortable: boolean
  hint?: string
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Customer', width: 240, sortable: true },
  { key: 'segment', label: 'Segment', width: 104, sortable: true },
  { key: 'category_label', label: 'Category', width: 150, sortable: true },
  { key: 'country', label: 'Country', width: 110, sortable: true },
  {
    key: 'total_spent',
    label: 'Spend',
    width: 100,
    align: 'right',
    sortable: true,
    hint: `Confirmed orders in the selected date range, summed over the account. ${MONEY_NOTE}`,
  },
  {
    key: 'order_count',
    label: 'Orders',
    width: 70,
    align: 'right',
    sortable: true,
    hint: 'Confirmed orders in the selected date range.',
  },
  {
    key: 'recency_days',
    label: 'Last order',
    width: 92,
    align: 'right',
    sortable: true,
    hint: 'When they last bought anything, whatever the selected range is - a customer who has gone quiet is what you would be looking for here.',
  },
  {
    key: 'rfm',
    label: 'RFM',
    width: 62,
    align: 'right',
    sortable: false,
    hint: 'Recency / frequency / monetary quintiles, 1 to 5. 555 is your best customer.',
  },
]

/** Indent applied to a contact nested under its company. */
const CHILD_INDENT = 14

interface CustomerTableProps {
  /** One entry per company, contacts carried underneath. */
  accounts: AccountRollup<CustomerRfmRow>[]
  loading: boolean
  /** Accounts loaded before filters, for the "n of m" footer. */
  totalCount: number
  truncated: boolean
}

/**
 * How long the arrow keys have to settle before the detail panel follows.
 *
 * Holding the key down used to fire a full detail load per row crossed. Long
 * enough to swallow a key repeat, short enough that a deliberate single press
 * still feels instant.
 */
const FOLLOW_DELAY_MS = 120

/**
 * A line in the rendered list: an account, or one of its contacts when the
 * account is expanded.
 */
interface VisibleRow {
  key: string
  account: AccountRollup<CustomerRfmRow>
  /** The customer this line opens and shows figures for. */
  row: CustomerRfmRow
  isChild: boolean
}

/** The value an account sorts on for a given column. */
function accountSortValue(
  account: AccountRollup<CustomerRfmRow>,
  key: SortKey,
): string | number | null {
  switch (key) {
    case 'name':
      return account.name
    case 'total_spent':
      return account.totalSpent
    case 'order_count':
      return account.orderCount
    case 'recency_days':
      return account.recencyDays
    case 'country':
      return account.country
    case 'segment':
      return account.segment
    case 'category_label':
      return account.categoryLabel
  }
}

export function CustomerTable({ accounts, loading, totalCount, truncated }: CustomerTableProps) {
  // Subscribing to the id rather than the whole panel object keeps the table
  // from re-rendering when only the panel's name changes.
  const openCustomerId = usePDMStore((s) => s.customerPanel?.customerId ?? null)
  const setCustomerPanel = usePDMStore((s) => s.setCustomerPanel)
  const scopeLabel = usePDMStore((s) => rangeOption(s.customerFilters.range).scopeLabel)

  const [sortKey, setSortKey] = useState<SortKey>('total_spent')
  const [ascending, setAscending] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => {
    const direction = ascending ? 1 : -1

    return [...accounts].sort((a, b) => {
      const left = accountSortValue(a, sortKey)
      const right = accountSortValue(b, sortKey)

      // Nulls always sink, regardless of direction: a customer who has never
      // ordered is not "the most recent" when sorting recency ascending.
      if (left == null && right == null) return 0
      if (left == null) return 1
      if (right == null) return -1

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction
      }
      return String(left).localeCompare(String(right)) * direction
    })
  }, [accounts, sortKey, ascending])

  // Contacts are always ordered by spend inside their company, whatever the
  // column sort is doing to the companies themselves.
  const visibleRows = useMemo(() => {
    const lines: VisibleRow[] = []

    for (const account of sorted) {
      lines.push({ key: account.key, account, row: account.lead, isChild: false })

      if (!account.hasMembers || !expanded.has(account.key)) continue

      for (const member of account.members) {
        lines.push({
          key: `${account.key}:${member.customer_id}`,
          account,
          row: member,
          isChild: true,
        })
      }
    }

    return lines
  }, [sorted, expanded])

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const selectRow = useCallback(
    (index: number, line: VisibleRow) => {
      setFocusIndex(index)
      setCustomerPanel({ customerId: line.row.customer_id, name: line.row.name })
    },
    [setCustomerPanel],
  )

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setAscending((value) => !value)
        return
      }
      setSortKey(key)
      // Text reads naturally A-Z; numbers are almost always wanted biggest first.
      setAscending(key === 'name' || key === 'country' || key === 'category_label')
    },
    [sortKey],
  )

  // Arrow-key navigation moves a focus ring through the rows and opens the
  // detail panel as it goes, so the panel tracks the selection like a mail
  // client. The ring moves on the keystroke; the panel follows once the keys
  // stop, so scrolling through a hundred rows costs one query, not a hundred.
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (visibleRows.length === 0) return

      event.preventDefault()
      setFocusIndex((current) => {
        const next = Math.max(
          0,
          Math.min(visibleRows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
        )
        virtualizer.scrollToIndex(next, { align: 'auto' })

        if (followTimer.current) clearTimeout(followTimer.current)
        followTimer.current = setTimeout(() => {
          const line = visibleRows[next]
          if (line) setCustomerPanel({ customerId: line.row.customer_id, name: line.row.name })
        }, FOLLOW_DELAY_MS)

        return next
      })
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (followTimer.current) clearTimeout(followTimer.current)
    }
  }, [visibleRows, virtualizer, setCustomerPanel])

  if (loading) return <TableSkeleton />

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
        <CircleSlash size={22} className="text-plm-fg-muted/60" />
        <p className="text-sm text-plm-fg-dim">No customers match these filters</p>
        <p className="text-xs text-plm-fg-muted">
          {totalCount > 0
            ? `${formatCount(totalCount)} customers are loaded - try clearing a filter.`
            : 'Sync from Odoo to bring customers in.'}
        </p>
      </div>
    )
  }

  const totalWidth = COLUMNS.reduce((sum, column) => sum + column.width, 0)
  const contactCount = sorted.reduce((sum, account) => sum + account.members.length, 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 border border-plm-border rounded-lg overflow-hidden bg-plm-bg-light">
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: totalWidth }}>
          <div className="sticky top-0 z-10 flex bg-plm-bg-lighter border-b border-plm-border">
            {COLUMNS.map((column) => (
              <button
                key={column.key}
                type="button"
                aria-disabled={!column.sortable}
                title={column.hint}
                onClick={() => column.sortable && toggleSort(column.key as SortKey)}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-plm-fg-muted shrink-0 ${
                  column.align === 'right' ? 'justify-end' : ''
                } ${column.sortable ? 'hover:text-plm-fg cursor-pointer' : 'cursor-default'}`}
                style={{ width: column.width }}
              >
                {column.label}
                {sortKey === column.key &&
                  (ascending ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </button>
            ))}
          </div>

          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const line = visibleRows[virtualRow.index]

              return (
                <Row
                  key={line.key}
                  line={line}
                  index={virtualRow.index}
                  height={virtualRow.size}
                  offset={virtualRow.start}
                  isExpanded={expanded.has(line.account.key)}
                  isOpen={openCustomerId === line.row.customer_id}
                  isFocused={focusIndex === virtualRow.index}
                  onSelect={selectRow}
                  onToggle={toggleExpanded}
                />
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 border-t border-plm-border text-[11px] text-plm-fg-muted">
        <span>
          {formatCount(sorted.length)}
          {sorted.length !== totalCount && ` of ${formatCount(totalCount)}`} customers
          {contactCount !== sorted.length && (
            <span title="A company and the contacts who order on its behalf count as one customer.">
              {` · ${formatCount(contactCount)} Odoo records`}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span title="Segment, category and last order are lifetime; spend and orders follow the range.">
            Spend and orders {scopeLabel}
          </span>
          {truncated && (
            <span title="Sidebar segment counts are computed in the database and stay accurate.">
              Showing the first {formatCount(totalCount)} by spend
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

interface RowProps {
  line: VisibleRow
  index: number
  height: number
  offset: number
  isExpanded: boolean
  isOpen: boolean
  isFocused: boolean
  onSelect: (index: number, line: VisibleRow) => void
  onToggle: (key: string) => void
}

/**
 * Memoized because the parent re-renders on every scroll tick, every sort and
 * every selection change. Without this each of those rebuilt all ~30 visible
 * rows; now only the two whose isOpen or isFocused actually flipped re-render.
 */
const Row = memo(function Row({
  line,
  index,
  height,
  offset,
  isExpanded,
  isOpen,
  isFocused,
  onSelect,
  onToggle,
}: RowProps) {
  const { account, row, isChild } = line

  // A company row reports the whole account; a contact row reports only itself,
  // which is what makes expanding it worth doing.
  const segment = isChild ? row.segment : account.segment
  const spend = isChild ? row.total_spent : account.totalSpent
  const orders = isChild ? row.order_count : account.orderCount
  const recency = isChild ? row.recency_days : account.recencyDays
  const country = isChild ? row.country : account.country
  const categoryLabel = isChild ? row.category_label : account.categoryLabel
  const meta = segmentMeta(segment)
  const channel = channelMeta(account.channel)

  const expandable = !isChild && account.hasMembers

  return (
    <div
      onClick={() => onSelect(index, line)}
      className={`absolute left-0 right-0 flex items-center border-b border-plm-border/40 cursor-pointer text-xs transition-colors ${
        isOpen ? 'bg-plm-selection/40' : isFocused ? 'bg-plm-highlight' : 'hover:bg-plm-bg-lighter/60'
      }`}
      style={{ height, transform: `translateY(${offset}px)` }}
    >
      <div
        className="flex items-center gap-1 px-2.5 shrink-0 min-w-0"
        style={{ width: COLUMNS[0].width, paddingLeft: isChild ? CHILD_INDENT + 10 : undefined }}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={isExpanded ? 'Hide contacts' : 'Show contacts'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(account.key)
            }}
            className="shrink-0 -ml-1 p-0.5 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter"
          >
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          !isChild && <span className="shrink-0 w-[15px]" />
        )}

        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 ${isChild ? 'text-plm-fg-dim' : 'text-plm-fg'}`}>
            {/* An account that groups several partners is shown by its own
                name, since no one member's name describes it. A lone partner is
                shown by its name - the account's label there can be something
                derived like an email domain, which is a worse thing to read. */}
            <span className="truncate">{expandable ? account.name : row.name}</span>
            {/* Only partners are marked. Badging 'Direct' too would put a label
                on almost every row in the table and say nothing. */}
            {!isChild && account.channel !== 'direct' && (
              <span
                className={`shrink-0 px-1 py-px rounded text-[9px] font-medium ${channel.badgeClass}`}
                title={channel.description}
              >
                {channel.label}
              </span>
            )}
          </div>
          {!isChild &&
            (expandable ? (
              <div className="truncate text-[10px] text-plm-fg-muted -mt-0.5">
                {formatCount(account.members.length)} contacts
              </div>
            ) : (
              account.name !== row.name && (
                <div className="truncate text-[10px] text-plm-fg-muted -mt-0.5">{account.name}</div>
              )
            ))}
        </div>
      </div>

      <div className="px-2.5 shrink-0" style={{ width: COLUMNS[1].width }}>
        <span
          className={`inline-block px-1.5 py-px rounded text-[10px] font-medium ${meta.badgeClass}`}
          title={meta.description}
        >
          {meta.label}
        </span>
      </div>

      <div className="px-2.5 shrink-0 truncate text-plm-fg-dim" style={{ width: COLUMNS[2].width }}>
        {categoryLabel ?? <span className="text-plm-fg-muted">Unclassified</span>}
      </div>

      <div className="px-2.5 shrink-0 truncate text-plm-fg-dim" style={{ width: COLUMNS[3].width }}>
        {country ?? '-'}
      </div>

      <div
        className={`px-2.5 shrink-0 text-right tabular-nums ${isChild ? 'text-plm-fg-dim' : 'text-plm-fg'}`}
        style={{ width: COLUMNS[4].width }}
      >
        {formatAmount(spend)}
      </div>

      <div
        className="px-2.5 shrink-0 text-right tabular-nums text-plm-fg-dim"
        style={{ width: COLUMNS[5].width }}
      >
        {formatCount(orders)}
      </div>

      <div
        className="px-2.5 shrink-0 text-right text-plm-fg-dim"
        style={{ width: COLUMNS[6].width }}
      >
        {formatRelativeDays(recency)}
      </div>

      <div
        className="px-2.5 shrink-0 text-right tabular-nums text-plm-fg-muted"
        style={{ width: COLUMNS[7].width }}
        title="Recency, frequency and monetary quintiles (5 is best)"
      >
        {row.r_score ? `${row.r_score}${row.f_score}${row.m_score}` : '-'}
      </div>
    </div>
  )
})

function TableSkeleton() {
  return (
    <div className="flex-1 border border-plm-border rounded-lg overflow-hidden bg-plm-bg-light">
      <div className="h-7 bg-plm-bg-lighter border-b border-plm-border" />
      <div className="p-2 space-y-1.5">
        {Array.from({ length: 14 }).map((_, index) => (
          <div
            key={index}
            className="h-5 rounded bg-plm-fg-muted/10 animate-pulse"
            style={{ animationDelay: `${index * 40}ms`, width: `${92 - (index % 4) * 7}%` }}
          />
        ))}
      </div>
    </div>
  )
}
