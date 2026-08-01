import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

import { customerQueries } from '../data/api'
import { load, peek, setGeneration } from '../data/cache'
import type { PartnerCoverageRow } from '../data/types'
import type { PartnerChannelId } from '../lib/channels'
import { useCustomerWindow } from './useCustomerWindow'

export interface PartnerCoverage {
  /** Every partner in this channel, unmatched ones first. */
  rows: PartnerCoverageRow[]
  /** Partners in this channel with no account in the data. */
  unmatched: PartnerCoverageRow[]
  matchedCount: number
  knownCount: number
  loading: boolean
  error: string | null
}

const EMPTY: PartnerCoverage = {
  rows: [],
  unmatched: [],
  matchedCount: 0,
  knownCount: 0,
  loading: true,
  error: null,
}

/**
 * The named partner list for one channel, checked against the synced data.
 *
 * The gaps are the reason this exists. A partner with no account has either
 * never ordered or is in Odoo under a name that normalises to a different
 * account_key, and only a person can tell those two apart - so the list is
 * surfaced rather than quietly reconciled.
 *
 * Both channels share one query and one cache entry, because the RPC returns
 * the whole list either way and filtering it here costs nothing.
 */
export function usePartnerCoverage(
  channel: PartnerChannelId,
  enabled: boolean,
): PartnerCoverage {
  const organization = usePDMStore((s) => s.organization)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)
  const window = useCustomerWindow()

  const orgId = organization?.id

  // Gated on `enabled` so the query only runs for someone who opened a partner
  // tab; it is of no interest anywhere else in the workspace.
  const query = useMemo(
    () => (orgId && enabled ? customerQueries.partnerCoverage(orgId, window) : null),
    [orgId, enabled, window],
  )

  const [rows, setRows] = useState<PartnerCoverageRow[]>(() => (query ? (peek(query) ?? []) : []))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestId = useRef(0)

  useEffect(() => {
    if (!query) {
      setLoading(false)
      return
    }

    setGeneration(dataVersion)

    const id = ++requestId.current
    const seeded = peek(query)

    if (seeded) {
      setRows(seeded)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)

    load(query)
      .then((result) => {
        if (id !== requestId.current) return
        setRows(result)
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return
        log.error('[Customers]', 'Failed to load partner coverage', { error: cause })
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (id !== requestId.current) return
        setLoading(false)
      })
  }, [query, dataVersion])

  return useMemo(() => {
    if (!query) return { ...EMPTY, loading: false }

    const mine = rows.filter((row) => row.partner_channel === channel)
    const unmatched = mine.filter((row) => !row.account_id)

    return {
      rows: mine,
      unmatched,
      matchedCount: mine.length - unmatched.length,
      knownCount: mine.length,
      loading,
      error,
    }
  }, [query, rows, channel, loading, error])
}
