import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { fetchCategoryBreakdown, fetchGeoBreakdown, fetchSegmentCounts } from '../data/api'
import type { CategoryBreakdownRow, GeoBreakdownRow, SegmentCount } from '../data/types'
import { resolveWindow } from '../lib/ranges'

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
 * Rather than lifting analytics into global state, the sidebar issues its own
 * three aggregate queries; they are cheap GROUP BYs and it keeps each surface
 * able to load and fail independently.
 */
export function useCustomerFacets(): CustomerFacets {
  const organization = usePDMStore((s) => s.organization)
  const range = usePDMStore((s) => s.customerFilters.range)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  const [segmentCounts, setSegmentCounts] = useState<SegmentCount[]>([])
  const [categories, setCategories] = useState<CategoryBreakdownRow[]>([])
  const [geo, setGeo] = useState<GeoBreakdownRow[]>([])
  const [loading, setLoading] = useState(true)

  const requestId = useRef(0)
  const orgId = organization?.id

  const window = useMemo(() => resolveWindow(range), [range])

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }

    const id = ++requestId.current
    setLoading(true)

    Promise.all([
      fetchSegmentCounts(orgId),
      fetchCategoryBreakdown(orgId, window),
      fetchGeoBreakdown(orgId, window),
    ])
      .then(([segments, categoryRows, geoRows]) => {
        if (id !== requestId.current) return
        setSegmentCounts(segments)
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
  }, [orgId, window, dataVersion])

  return { segmentCounts, categories, geo, loading }
}
