import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { customerQueries, type DateWindow } from '../data/api'
import { clearCustomerCache, load, peek, setGeneration } from '../data/cache'
import { EMPTY_ANALYTICS, type CustomerAnalyticsData } from '../data/types'
import { rangeOption, type ResolvedWindow } from '../lib/ranges'
import { useCustomerWindow } from './useCustomerWindow'

export interface CustomerAnalyticsResult {
  data: CustomerAnalyticsData
  loading: boolean
  error: string | null
  /** True while a refresh runs over data that is already on screen. */
  refreshing: boolean
  refresh: () => void
  window: ResolvedWindow
}

/**
 * Loads everything the Overview tab needs in one parallel round of RPCs.
 *
 * The seven calls are independent, so they are issued together rather than
 * awaited in sequence; the slowest one sets the total latency instead of the
 * sum. A monotonic request id guards against a slow earlier response landing
 * after a faster later one and overwriting fresh data with stale.
 *
 * Results go through the shared cache, so re-entering the view paints from the
 * previous load immediately and only revalidates behind the scenes.
 */
export function useCustomerAnalytics(): CustomerAnalyticsResult {
  const organization = usePDMStore((s) => s.organization)
  const range = usePDMStore((s) => s.customerFilters.range)
  const bucket = usePDMStore((s) => s.customerFilters.bucket)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  // A manual refresh deliberately does not move the window - it re-runs the
  // same query.
  const window = useCustomerWindow()

  const orgId = organization?.id
  const months = rangeOption(range).cohortMonths

  const queries = useMemo(
    () => (orgId ? buildQueries(orgId, window, bucket, months) : null),
    [orgId, window, bucket, months],
  )

  // Seeded from whatever the cache already holds so a revisit renders the
  // previous numbers on the first frame instead of a wall of skeletons.
  const [data, setData] = useState<CustomerAnalyticsData>(
    () => (queries ? readCache(queries) : null) ?? EMPTY_ANALYTICS,
  )
  const [loading, setLoading] = useState(() => !(queries && readCache(queries)))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const requestId = useRef(0)
  const hasLoaded = useRef(!loading)

  useEffect(() => {
    if (!queries) {
      setData(EMPTY_ANALYTICS)
      setLoading(false)
      return
    }

    setGeneration(dataVersion)

    const id = ++requestId.current
    const seeded = readCache(queries)

    if (seeded) {
      setData(seeded)
      setLoading(false)
      hasLoaded.current = true
    }

    if (hasLoaded.current) setRefreshing(true)
    else setLoading(true)
    setError(null)

    const startedAt = performance.now()

    Promise.all([
      load(queries.summary),
      load(queries.timeseries),
      load(queries.topAccounts),
      load(queries.categories),
      load(queries.geo),
      load(queries.cohorts),
      load(queries.topProducts),
    ])
      .then(([summary, timeseries, topAccounts, categories, geo, cohorts, topProducts]) => {
        if (id !== requestId.current) return
        setData({
          summary,
          timeseries,
          topAccounts,
          categories,
          geo,
          cohorts,
          topProducts,
          segmentCounts: summary?.segment_counts ?? [],
        })
        hasLoaded.current = true
        log.info('[Customers]', 'Dashboard loaded', {
          ms: Math.round(performance.now() - startedAt),
          range,
          customers: summary?.total_customers ?? 0,
        })
      })
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
  }, [queries, dataVersion, range, nonce])

  // Refresh means "go back to the database", so the cache is dropped rather
  // than allowed to serve its still-fresh copies.
  const refresh = useCallback(() => {
    clearCustomerCache()
    setNonce((value) => value + 1)
  }, [])

  return { data, loading, error, refreshing, refresh, window }
}

type AnalyticsQueries = ReturnType<typeof buildQueries>

function buildQueries(orgId: string, window: DateWindow, bucket: string, months: number) {
  return {
    summary: customerQueries.summary(orgId, window),
    timeseries: customerQueries.timeseries(orgId, window, bucket),
    topAccounts: customerQueries.topAccounts(orgId, window),
    categories: customerQueries.categories(orgId, window),
    geo: customerQueries.geo(orgId, window),
    cohorts: customerQueries.cohorts(orgId, window, months),
    topProducts: customerQueries.topProducts(orgId, window),
  }
}

/**
 * The cached payload, but only if every part of it is present - a half-filled
 * dashboard would render some panels against this range and others against the
 * last one.
 */
function readCache(queries: AnalyticsQueries): CustomerAnalyticsData | null {
  const summary = peek(queries.summary)
  const timeseries = peek(queries.timeseries)
  const topAccounts = peek(queries.topAccounts)
  const categories = peek(queries.categories)
  const geo = peek(queries.geo)
  const cohorts = peek(queries.cohorts)
  const topProducts = peek(queries.topProducts)

  if (
    summary === undefined ||
    !timeseries ||
    !topAccounts ||
    !categories ||
    !geo ||
    !cohorts ||
    !topProducts
  ) {
    return null
  }

  return {
    summary,
    timeseries,
    topAccounts,
    categories,
    geo,
    cohorts,
    topProducts,
    segmentCounts: summary?.segment_counts ?? [],
  }
}
