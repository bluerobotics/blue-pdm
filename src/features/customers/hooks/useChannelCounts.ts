import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { customerQueries } from '../data/api'
import { load, peek, setGeneration } from '../data/cache'
import type { ChannelCount } from '../data/types'
import type { ChannelId } from '../lib/channels'
import { useCustomerWindow } from './useCustomerWindow'

export interface ChannelCounts {
  /** Every channel, including ones with no accounts, keyed for direct lookup. */
  byChannel: Record<ChannelId, ChannelCount>
  loading: boolean
}

const EMPTY = (channel: string): ChannelCount => ({
  channel,
  account_count: 0,
  customer_count: 0,
  revenue: 0,
  orders: 0,
})

/**
 * How many accounts sit in each sales channel, and what they bought.
 *
 * Its own query rather than a slice of the roster because the roster is capped
 * and filtered: the tab label has to read "Distributors 66" whatever the
 * sidebar is currently excluding, and however many accounts the org has.
 *
 * Revenue and orders follow the date range; the counts do not. See the RPC.
 */
export function useChannelCounts(): ChannelCounts {
  const organization = usePDMStore((s) => s.organization)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)
  const window = useCustomerWindow()

  const orgId = organization?.id

  const query = useMemo(
    () => (orgId ? customerQueries.channelCounts(orgId, window) : null),
    [orgId, window],
  )

  const [rows, setRows] = useState<ChannelCount[]>(() => (query ? (peek(query) ?? []) : []))
  const [loading, setLoading] = useState(true)

  const requestId = useRef(0)

  useEffect(() => {
    if (!query) {
      setRows([])
      setLoading(false)
      return
    }

    setGeneration(dataVersion)

    const id = ++requestId.current
    setLoading(true)

    load(query)
      .then((result) => {
        if (id !== requestId.current) return
        setRows(result)
      })
      .catch((cause: unknown) => {
        // The tabs degrade to unlabelled counts rather than disappearing.
        log.error('[Customers]', 'Failed to load channel counts', { error: cause })
      })
      .finally(() => {
        if (id !== requestId.current) return
        setLoading(false)
      })
  }, [query, dataVersion])

  const byChannel = useMemo(() => {
    const lookup: Record<string, ChannelCount> = {
      direct: EMPTY('direct'),
      distributor: EMPTY('distributor'),
      integrator: EMPTY('integrator'),
    }
    for (const row of rows) {
      lookup[row.channel] = row
    }
    return lookup as Record<ChannelId, ChannelCount>
  }, [rows])

  return { byChannel, loading }
}
