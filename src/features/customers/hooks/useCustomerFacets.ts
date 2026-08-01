import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { customerQueries } from '../data/api'
import { load, peek, setGeneration } from '../data/cache'
import type { CategoryBreakdownRow, GeoBreakdownRow, SegmentCount } from '../data/types'
import { useCustomerWindow } from './useCustomerWindow'

export interface CustomerFacets {
  segmentCounts: SegmentCount[]
  categories: CategoryBreakdownRow[]
  geo: GeoBreakdownRow[]
  loading: boolean
}

/**
 * Facet counts for the sidebar navigator.
 *
 * The navigator renders inside the app's Sidebar while the charts render in
 * MainContent - two sibling subtrees with no shared ancestor below the store.
 * They therefore ask for the same things independently, and the shared request
 * cache is what stops that costing anything: these three queries are the exact
 * ones useCustomerAnalytics issues, so whichever surface mounts first pays and
 * the other joins the in-flight promise.
 *
 * Segment counts ride along on the analytics summary rather than a query of
 * their own; the database already had to scan customers to produce the KPI
 * counts, so it rolls up both in one pass.
 */
export function useCustomerFacets(): CustomerFacets {
  const organization = usePDMStore((s) => s.organization)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  const window = useCustomerWindow()
  const orgId = organization?.id

  const queries = useMemo(
    () =>
      orgId
        ? {
            summary: customerQueries.summary(orgId, window),
            categories: customerQueries.categories(orgId, window),
            geo: customerQueries.geo(orgId, window),
          }
        : null,
    [orgId, window],
  )

  const [segmentCounts, setSegmentCounts] = useState<SegmentCount[]>(
    () => (queries ? (peek(queries.summary)?.segment_counts ?? []) : []),
  )
  const [categories, setCategories] = useState<CategoryBreakdownRow[]>(
    () => (queries ? (peek(queries.categories) ?? []) : []),
  )
  const [geo, setGeo] = useState<GeoBreakdownRow[]>(() => (queries ? (peek(queries.geo) ?? []) : []))
  const [loading, setLoading] = useState(true)

  const requestId = useRef(0)

  useEffect(() => {
    if (!queries) {
      setLoading(false)
      return
    }

    setGeneration(dataVersion)

    const id = ++requestId.current
    setLoading(true)

    Promise.all([load(queries.summary), load(queries.categories), load(queries.geo)])
      .then(([summary, categoryRows, geoRows]) => {
        if (id !== requestId.current) return
        setSegmentCounts(summary?.segment_counts ?? [])
        setCategories(categoryRows)
        setGeo(geoRows)
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return
        // The sidebar degrades to unlabelled facets rather than blocking the
        // sync button, so this is logged and swallowed.
        log.error('[Customers]', 'Failed to load sidebar facets', { error: cause })
      })
      .finally(() => {
        if (id !== requestId.current) return
        setLoading(false)
      })
  }, [queries, dataVersion])

  return { segmentCounts, categories, geo, loading }
}
