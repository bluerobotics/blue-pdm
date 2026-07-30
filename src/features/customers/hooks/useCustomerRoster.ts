import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { fetchRfm } from '../data/api'
import type { CustomerRfmRow } from '../data/types'
import { matchesCategoryFilter } from '../lib/taxonomy'

/**
 * Cap on rows pulled for the table. The list is virtualized so rendering is
 * not the constraint - this bounds the payload for an Odoo with tens of
 * thousands of partners. Segment counts in the sidebar come from a separate
 * aggregate RPC so they stay accurate even when this truncates.
 */
const ROW_LIMIT = 5000

export interface CustomerRosterResult {
  rows: CustomerRfmRow[]
  /** Rows surviving the active filters, in the order the table should show. */
  visible: CustomerRfmRow[]
  loading: boolean
  error: string | null
  truncated: boolean
  refresh: () => void
}

export function useCustomerRoster(): CustomerRosterResult {
  const organization = usePDMStore((s) => s.organization)
  const filters = usePDMStore((s) => s.customerFilters)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  const [rows, setRows] = useState<CustomerRfmRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const requestId = useRef(0)
  const orgId = organization?.id

  useEffect(() => {
    if (!orgId) {
      setRows([])
      setLoading(false)
      return
    }

    const id = ++requestId.current
    setLoading(true)
    setError(null)

    fetchRfm(orgId, ROW_LIMIT)
      .then((result) => {
        if (id !== requestId.current) return
        setRows(result)
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
  }, [orgId, nonce, dataVersion])

  const visible = useMemo(() => {
    const query = filters.search.trim().toLowerCase()

    return rows.filter((row) => {
      if (filters.presence === 'active' && row.is_active === false) return false
      if (filters.presence === 'gone' && row.is_active !== false) return false

      if (filters.segments.length > 0 && !filters.segments.includes(row.segment)) return false

      if (filters.countries.length > 0) {
        if (!row.country || !filters.countries.includes(row.country)) return false
      }

      if (!matchesCategoryFilter(filters.categories, row.category, row.subcategory)) return false

      if (query) {
        const haystack = [
          row.name,
          row.account_name,
          row.email,
          row.city,
          row.country,
          row.category_label,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }

      return true
    })
  }, [rows, filters])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  return {
    rows,
    visible,
    loading,
    error,
    truncated: rows.length >= ROW_LIMIT,
    refresh,
  }
}
