import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { customerQueries } from '../data/api'
import { clearCustomerCache, load, peek, setGeneration } from '../data/cache'
import type { CustomerRfmRow } from '../data/types'
import { matchesCategoryFilter } from '../lib/taxonomy'

/**
 * Cap on rows pulled for the table. The list is virtualized so rendering is
 * not the constraint - this bounds the payload for an Odoo with tens of
 * thousands of partners. Segment counts in the sidebar are aggregated in the
 * database, so they stay accurate even when this truncates.
 */
const ROW_LIMIT = 5000

/**
 * A roster row with its searchable text flattened once, at load.
 *
 * Building `name + account + email + city + country + category` per row inside
 * the filter meant six property reads, an array allocation, a join and a
 * toLowerCase for every row on every keystroke. At the row cap that is 30k
 * string operations per character typed.
 */
export interface RosterRow extends CustomerRfmRow {
  searchBlob: string
}

export interface CustomerRosterResult {
  rows: RosterRow[]
  /** Rows surviving the active filters, in the order the table should show. */
  visible: RosterRow[]
  loading: boolean
  error: string | null
  truncated: boolean
  refresh: () => void
}

function withSearchBlob(rows: CustomerRfmRow[]): RosterRow[] {
  return rows.map((row) => ({
    ...row,
    searchBlob: [row.name, row.account_name, row.email, row.city, row.country, row.category_label]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }))
}

export function useCustomerRoster(): CustomerRosterResult {
  const organization = usePDMStore((s) => s.organization)
  const filters = usePDMStore((s) => s.customerFilters)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  const orgId = organization?.id

  const query = useMemo(
    () => (orgId ? customerQueries.rfm(orgId, ROW_LIMIT) : null),
    [orgId],
  )

  const cached = query ? peek(query) : undefined

  const [rows, setRows] = useState<RosterRow[]>(() => (cached ? withSearchBlob(cached) : []))
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const requestId = useRef(0)

  useEffect(() => {
    if (!query) {
      setRows([])
      setLoading(false)
      return
    }

    setGeneration(dataVersion)

    const id = ++requestId.current
    const seeded = peek(query)

    if (seeded) {
      setRows(withSearchBlob(seeded))
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)

    const startedAt = performance.now()

    load(query)
      .then((result) => {
        if (id !== requestId.current) return
        setRows(withSearchBlob(result))
        // Logged separately from the dashboard: this is the largest single
        // payload the view pulls, and it is not part of that timing.
        log.info('[Customers]', 'Roster loaded', {
          ms: Math.round(performance.now() - startedAt),
          rows: result.length,
          capped: result.length >= ROW_LIMIT,
        })
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return
        log.error('[Customers]', 'Failed to load customer roster', { error: cause })
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (id !== requestId.current) return
        setLoading(false)
      })
  }, [query, dataVersion, nonce])

  // Deferred so React can paint the character you just typed before it spends
  // milliseconds re-filtering thousands of rows behind it. The facet filters
  // are not deferred - those are single clicks and should feel immediate.
  const search = useDeferredValue(filters.search)

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()

    return rows.filter((row) => {
      if (filters.presence === 'active' && row.is_active === false) return false
      if (filters.presence === 'gone' && row.is_active !== false) return false

      if (filters.segments.length > 0 && !filters.segments.includes(row.segment)) return false

      if (filters.countries.length > 0) {
        if (!row.country || !filters.countries.includes(row.country)) return false
      }

      if (!matchesCategoryFilter(filters.categories, row.category, row.subcategory)) return false

      if (needle && !row.searchBlob.includes(needle)) return false

      return true
    })
  }, [rows, search, filters.presence, filters.segments, filters.countries, filters.categories])

  const refresh = useCallback(() => {
    clearCustomerCache()
    setNonce((value) => value + 1)
  }, [])

  return {
    rows,
    visible,
    loading,
    error,
    truncated: rows.length >= ROW_LIMIT,
    refresh,
  }
}
