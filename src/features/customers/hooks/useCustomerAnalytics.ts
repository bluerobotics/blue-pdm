import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import {
  fetchCategoryBreakdown,
  fetchCohorts,
  fetchGeoBreakdown,
  fetchSegmentCounts,
  fetchSummary,
  fetchTimeseries,
  fetchTopAccounts,
  fetchTopProducts,
} from '../data/api'
import { EMPTY_ANALYTICS, type CustomerAnalyticsData } from '../data/types'
import { rangeOption, resolveWindow } from '../lib/ranges'

export interface CustomerAnalyticsResult {
  data: CustomerAnalyticsData
  loading: boolean
  error: string | null
  /** True while a refresh runs over data that is already on screen. */
  refreshing: boolean
  refresh: () => void
  window: { from: string; to: string; comparisonLabel: string }
}

/**
 * Loads everything the Overview tab needs in one parallel round of RPCs.
 *
 * The eight calls are independent, so they are issued together rather than
 * awaited in sequence; the slowest one sets the total latency instead of the
 * sum. A monotonic request id guards against a slow earlier response landing
 * after a faster later one and overwriting fresh data with stale.
 */
export function useCustomerAnalytics(): CustomerAnalyticsResult {
  const organization = usePDMStore((s) => s.organization)
  const range = usePDMStore((s) => s.customerFilters.range)
  const bucket = usePDMStore((s) => s.customerFilters.bucket)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  const [data, setData] = useState<CustomerAnalyticsData>(EMPTY_ANALYTICS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const requestId = useRef(0)
  const hasLoaded = useRef(false)

  // Memoized on the preset alone. Without this the window would resolve to new
  // ISO strings on every render and loop the effect forever. A manual refresh
  // deliberately does not move the window - it re-runs the same query.
  const window = useMemo(() => resolveWindow(range), [range])

  const orgId = organization?.id

  useEffect(() => {
    if (!orgId) {
      setData(EMPTY_ANALYTICS)
      setLoading(false)
      return
    }

    const id = ++requestId.current
    const isFirstLoad = !hasLoaded.current

    if (isFirstLoad) setLoading(true)
    else setRefreshing(true)
    setError(null)

    const months = rangeOption(range).cohortMonths

    Promise.all([
      fetchSummary(orgId, window),
      fetchTimeseries(orgId, window, bucket),
      fetchTopAccounts(orgId, window),
      fetchCategoryBreakdown(orgId, window),
      fetchGeoBreakdown(orgId, window),
      fetchCohorts(orgId, months),
      fetchTopProducts(orgId, window),
      fetchSegmentCounts(orgId),
    ])
      .then(
        ([
          summary,
          timeseries,
          topAccounts,
          categories,
          geo,
          cohorts,
          topProducts,
          segmentCounts,
        ]) => {
          if (id !== requestId.current) return
          setData({
            summary,
            timeseries,
            topAccounts,
            categories,
            geo,
            cohorts,
            topProducts,
            segmentCounts,
          })
          hasLoaded.current = true
        },
      )
      .catch((cause: unknown) => {
        if (id !== requestId.current) return
        const message = cause instanceof Error ? cause.message : String(cause)
        log.error('[Customers]', 'Failed to load analytics', { error: cause })
        setError(message)
      })
      .finally(() => {
        if (id !== requestId.current) return
        setLoading(false)
        setRefreshing(false)
      })
  }, [orgId, window, bucket, range, nonce, dataVersion])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, refreshing, refresh, window }
}
