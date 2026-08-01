import { useCallback } from 'react'

import { usePDMStore } from '@/stores/pdmStore'
import type { CustomerBucket } from '@/stores/types'

import { CategoryMixChart } from '../charts/CategoryMixChart'
import { ChannelMixChart } from '../charts/ChannelMixChart'
import { CohortHeatmap } from '../charts/CohortHeatmap'
import { GeoBarsChart } from '../charts/GeoBarsChart'
import { ParetoChart } from '../charts/ParetoChart'
import { RevenueTrendChart } from '../charts/RevenueTrendChart'
import { RfmScatterChart } from '../charts/RfmScatterChart'
import { TopProductsChart } from '../charts/TopProductsChart'
import { KpiStrip, PortfolioStrip } from '../components/KpiStrip'
import type { CustomerAnalyticsData, CustomerRfmRow } from '../data/types'
import { useChannelCounts } from '../hooks/useChannelCounts'

interface OverviewTabProps {
  data: CustomerAnalyticsData
  roster: CustomerRfmRow[]
  loading: boolean
  rosterLoading: boolean
  comparisonLabel: string
}

export function OverviewTab({
  data,
  roster,
  loading,
  rosterLoading,
  comparisonLabel,
}: OverviewTabProps) {
  const filters = usePDMStore((s) => s.customerFilters)
  const setCustomerFilters = usePDMStore((s) => s.setCustomerFilters)
  const toggleCustomerFacet = usePDMStore((s) => s.toggleCustomerFacet)
  const setCustomerPanel = usePDMStore((s) => s.setCustomerPanel)

  const channelCounts = useChannelCounts()

  // Stable so the memoized scatter, the costliest chart here to rebuild, is
  // not re-rendered by every unrelated change on this tab.
  const openCustomer = useCallback(
    (row: CustomerRfmRow) => setCustomerPanel({ customerId: row.customer_id, name: row.name }),
    [setCustomerPanel],
  )

  return (
    <div className="space-y-3">
      <KpiStrip
        summary={data.summary}
        timeseries={data.timeseries}
        loading={loading}
        comparisonLabel={comparisonLabel}
      />

      <PortfolioStrip summary={data.summary} />

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
        <div className="2xl:col-span-2">
          <RevenueTrendChart
            data={data.timeseries}
            bucket={filters.bucket}
            onBucketChange={(bucket: CustomerBucket) => setCustomerFilters({ bucket })}
            loading={loading}
          />
        </div>

        <ChannelMixChart
          counts={channelCounts}
          selected={filters.channels}
          onSelect={(channel) => toggleCustomerFacet('channels', channel)}
        />

        <ParetoChart data={data.topAccounts} loading={loading} />

        <CategoryMixChart
          data={data.categories}
          loading={loading}
          selected={filters.categories}
          onSelect={(key) => toggleCustomerFacet('categories', key)}
        />

        <GeoBarsChart
          data={data.geo}
          loading={loading}
          selected={filters.countries}
          onSelect={(country) => toggleCustomerFacet('countries', country)}
        />

        <CohortHeatmap data={data.cohorts} loading={loading} />

        <RfmScatterChart rows={roster} loading={rosterLoading} onSelect={openCustomer} />

        <TopProductsChart data={data.topProducts} loading={loading} />
      </div>
    </div>
  )
}
