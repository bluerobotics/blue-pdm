import { useCallback, useEffect, useRef } from 'react'
import { AlertCircle, Download, Loader2, RefreshCw, Search, X } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import type { CustomersTab } from '@/stores/types'

import { FilterChips } from './components/FilterChips'
import { FirstRunHero } from './components/FirstRunHero'
import { useChannelCounts } from './hooks/useChannelCounts'
import { useCustomerAnalytics } from './hooks/useCustomerAnalytics'
import { useCustomerRoster } from './hooks/useCustomerRoster'
import { CHANNELS } from './lib/channels'
import { formatCount } from './lib/format'
import { RANGE_OPTIONS, rangeOption } from './lib/ranges'
import { AccountsTab } from './tabs/AccountsTab'
import { OverviewTab } from './tabs/OverviewTab'
import { PartnersTab } from './tabs/PartnersTab'
import { CustomerTable } from './table/CustomerTable'
import { exportCustomersCsv } from './lib/export'

const TABS: { id: CustomersTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'distributors', label: CHANNELS.distributor.plural },
  { id: 'integrators', label: CHANNELS.integrator.plural },
]

/**
 * Main-area surface of the Customers workspace: command bar, active filter
 * chips, and the Overview / Customers / Accounts tabs.
 *
 * The left sidebar (CustomersNavigator) and right panel (CustomerDetailPanel)
 * are rendered by the app shell, not here; all three coordinate through
 * customerFilters and customerPanel in the store.
 */
export function CustomersWorkspace() {
  const tab = usePDMStore((s) => s.customersTab)
  const setTab = usePDMStore((s) => s.setCustomersTab)
  const filters = usePDMStore((s) => s.customerFilters)
  const setCustomerFilters = usePDMStore((s) => s.setCustomerFilters)
  const setCustomerPanel = usePDMStore((s) => s.setCustomerPanel)

  const analytics = useCustomerAnalytics()
  const roster = useCustomerRoster()
  const channels = useChannelCounts()

  const searchRef = useRef<HTMLInputElement>(null)

  // `/` jumps to search and Escape closes the detail panel, the two shortcuts
  // that matter when you are reading rather than typing.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)

      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }

      if (event.key === 'Escape') {
        if (typing && target === searchRef.current) {
          searchRef.current?.blur()
          return
        }
        setCustomerPanel(null)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCustomerPanel])

  const handleExport = useCallback(() => {
    exportCustomersCsv(roster.visible, filters.range)
  }, [roster.visible, filters.range])

  const refreshAnalytics = analytics.refresh
  const refreshRoster = roster.refresh

  const refresh = useCallback(() => {
    refreshAnalytics()
    refreshRoster()
  }, [refreshAnalytics, refreshRoster])

  const hasAnyData =
    (analytics.data.summary?.total_customers ?? 0) > 0 || roster.rows.length > 0

  // A never-synced org gets the explainer instead of a grid of zeroes.
  if (!analytics.loading && !roster.loading && !hasAnyData) {
    return <FirstRunHero />
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-3 pb-2 space-y-2.5 border-b border-plm-border">
        <div className="flex items-center gap-2">
          <div className="flex rounded bg-plm-input p-0.5">
            {TABS.map((entry) => {
              // Partner counts are shown on the tab because they are the point:
              // these are curated lists, so "how many are there" is the first
              // thing you want to know, and a zero is information rather than
              // an empty tab that looks broken.
              const count =
                entry.id === 'distributors'
                  ? channels.byChannel.distributor.account_count
                  : entry.id === 'integrators'
                    ? channels.byChannel.integrator.account_count
                    : null

              return (
                <button
                  key={entry.id}
                  onClick={() => setTab(entry.id)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    tab === entry.id
                      ? 'bg-plm-bg text-plm-fg shadow-sm'
                      : 'text-plm-fg-muted hover:text-plm-fg'
                  }`}
                >
                  {entry.label}
                  {count != null && !channels.loading && (
                    <span className="ml-1.5 text-plm-fg-muted tabular-nums">
                      {formatCount(count)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-plm-fg-muted pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              value={filters.search}
              onChange={(event) => setCustomerFilters({ search: event.target.value })}
              placeholder="Search customers   /"
              className="w-full pl-8 pr-7 py-1 bg-plm-input border border-plm-border rounded text-xs text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent"
            />
            {filters.search && (
              <button
                onClick={() => setCustomerFilters({ search: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex-1" />

          <div
            className="flex rounded bg-plm-input p-0.5"
            title="Scopes the whole workspace: every amount and count below is for this period. Segments and last-order dates stay lifetime."
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() =>
                  setCustomerFilters({ range: option.id, bucket: option.defaultBucket })
                }
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                  filters.range === option.id
                    ? 'bg-plm-bg text-plm-fg shadow-sm'
                    : 'text-plm-fg-muted hover:text-plm-fg'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            disabled={roster.visible.length === 0}
            title={`Export ${formatCount(roster.visible.length)} filtered customers as CSV, with spend and orders ${rangeOption(filters.range).scopeLabel}`}
            className="p-1.5 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors disabled:opacity-40"
          >
            <Download size={14} />
          </button>

          <button
            onClick={refresh}
            disabled={analytics.refreshing}
            title="Reload from the database"
            className="p-1.5 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors disabled:opacity-40"
          >
            <RefreshCw
              size={14}
              className={analytics.refreshing ? 'animate-spin' : undefined}
            />
          </button>
        </div>

        <FilterChips categories={analytics.data.categories} />
      </div>

      {(analytics.error || roster.error) && (
        <div className="flex items-start gap-2 mx-4 mt-3 p-2.5 rounded-lg bg-plm-error/10 border border-plm-error/30">
          <AlertCircle size={14} className="text-plm-error flex-shrink-0 mt-0.5" />
          <div className="text-xs text-plm-fg-dim">
            <p className="text-plm-fg">Could not load customer analytics</p>
            <p className="text-plm-fg-muted mt-0.5">{analytics.error ?? roster.error}</p>
            <p className="text-plm-fg-muted mt-1">
              If this names a missing function, the database is older than the app - run the latest
              schema from Settings.
            </p>
          </div>
        </div>
      )}

      {/* The two virtualized tabs scroll internally - the table so its header
          can stay sticky, and both so the virtualizer has a scroll element of
          its own. Overview is ordinary flowing content and scrolls here. */}
      <div
        className={`flex-1 min-h-0 p-4 ${
          tab === 'overview' ? 'overflow-auto' : 'flex flex-col overflow-hidden'
        }`}
      >
        {tab === 'overview' && (
          <OverviewTab
            data={analytics.data}
            roster={roster.visible}
            loading={analytics.loading}
            rosterLoading={roster.loading}
            comparisonLabel={analytics.window.comparisonLabel}
          />
        )}

        {tab === 'customers' && (
          <CustomerTable
            accounts={roster.accounts}
            loading={roster.loading}
            totalCount={roster.accountCount}
            truncated={roster.truncated}
          />
        )}

        {tab === 'accounts' && <AccountsTab accounts={roster.accounts} loading={roster.loading} />}

        {(tab === 'distributors' || tab === 'integrators') && (
          <PartnersTab
            channel={tab === 'distributors' ? 'distributor' : 'integrator'}
            accounts={roster.accounts}
            loading={roster.loading}
          />
        )}
      </div>

      {analytics.refreshing && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded bg-plm-bg-lighter border border-plm-border text-[11px] text-plm-fg-muted">
          <Loader2 size={11} className="animate-spin" />
          Refreshing {rangeOption(filters.range).label.toLowerCase()}
        </div>
      )}
    </div>
  )
}
