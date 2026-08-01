import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { customerQueries } from '../data/api'
import { load, peek, setGeneration } from '../data/cache'
import type {
  CustomerDetailRecord,
  CustomerOrderRecord,
  CustomerProductRecord,
  CustomerWindowTotals,
  EnrichmentRecord,
} from '../data/types'
import { useCustomerWindow } from './useCustomerWindow'

export type {
  CustomerDetailRecord,
  CustomerOrderRecord,
  CustomerProductRecord,
  CustomerWindowTotals,
  EnrichmentRecord,
  EnrichmentSource,
} from '../data/types'

export interface CustomerDetail {
  /** Carries the lifetime columns; the lifecycle badge is derived from them. */
  customer: CustomerDetailRecord | null
  /** What they bought inside the selected range. */
  window: CustomerWindowTotals
  accountName: string | null
  /** The account's sales channel. 'direct' when the customer has no account. */
  accountChannel: string
  /** Orders inside the range, newest first. */
  orders: CustomerOrderRecord[]
  products: CustomerProductRecord[]
  enrichment: EnrichmentRecord | null
  loading: boolean
  error: string | null
}

const ORDER_LIMIT = 100

const NO_WINDOW_TOTALS: CustomerWindowTotals = { spend: 0, orders: 0, units: 0 }

const EMPTY: CustomerDetail = {
  customer: null,
  window: NO_WINDOW_TOTALS,
  accountName: null,
  accountChannel: 'direct',
  orders: [],
  products: [],
  enrichment: null,
  loading: true,
  error: null,
}

/**
 * Everything the right-hand panel shows for one customer, in one request.
 *
 * The customer_detail RPC assembles the record, its orders, the product rollup
 * over those orders, the account name and the current enrichment with its
 * citations into a single JSONB document. Doing it in the database rather than
 * here is what makes stepping through the table cheap: the previous version
 * needed the customer before it could ask for orders, and the orders before it
 * could ask for lines, so every row cost three sequential round trips.
 *
 * Results are cached per customer and window, so arrowing back up the list is
 * free and so is returning to a range you already looked at.
 */
export function useCustomerDetail(customerId: string | null): CustomerDetail {
  const organization = usePDMStore((s) => s.organization)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)
  const window = useCustomerWindow()

  const orgId = organization?.id

  const query = useMemo(
    () => (customerId && orgId ? customerQueries.detail(customerId, window, ORDER_LIMIT) : null),
    [customerId, orgId, window],
  )

  const [detail, setDetail] = useState<CustomerDetail>(EMPTY)
  const requestId = useRef(0)

  useEffect(() => {
    if (!query) {
      setDetail({ ...EMPTY, loading: false })
      return
    }

    setGeneration(dataVersion)

    const id = ++requestId.current
    const seeded = peek(query)

    setDetail(
      seeded?.customer
        ? { ...seeded, loading: false, error: null }
        : { ...EMPTY, loading: true },
    )

    load(query)
      .then((payload) => {
        if (id !== requestId.current) return

        if (!payload?.customer) {
          setDetail({ ...EMPTY, loading: false, error: 'Customer not found' })
          return
        }

        setDetail({
          customer: payload.customer,
          window: payload.window ?? NO_WINDOW_TOTALS,
          accountName: payload.accountName,
          accountChannel: payload.accountChannel ?? 'direct',
          orders: payload.orders ?? [],
          products: payload.products ?? [],
          enrichment: payload.enrichment,
          loading: false,
          error: null,
        })
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return
        log.error('[Customers]', 'Failed to load customer detail', { error: cause })
        setDetail({
          ...EMPTY,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      })
  }, [query, dataVersion])

  return detail
}
