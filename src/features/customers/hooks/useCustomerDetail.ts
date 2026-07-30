import { useEffect, useRef, useState } from 'react'

import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'

export interface CustomerDetailRecord {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  is_company: boolean | null
  website: string | null
  vat: string | null
  job_title: string | null
  industry: string | null
  street: string | null
  street2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  erp_id: string | null
  account_id: string | null
  total_spent: number | null
  order_count: number | null
  item_count: number | null
  first_order_date: string | null
  last_order_date: string | null
  is_active: boolean | null
  odoo_missing_since: string | null
}

export interface CustomerOrderRecord {
  id: string
  erp_id: string | null
  order_date: string | null
  status: string | null
  total: number | null
  discount: number | null
  items_count: number | null
}

export interface CustomerProductRecord {
  key: string
  name: string
  quantity: number
  revenue: number
}

export interface EnrichmentSource {
  id: string
  url: string
  title: string | null
  quote: string | null
}

export interface EnrichmentRecord {
  id: string
  category: string | null
  subcategory: string | null
  confidence: number | null
  report: string | null
  evidence_found: boolean
  needs_review: boolean | null
  model: string | null
  researched_at: string | null
  sources: EnrichmentSource[]
}

export interface CustomerDetail {
  customer: CustomerDetailRecord | null
  accountName: string | null
  orders: CustomerOrderRecord[]
  products: CustomerProductRecord[]
  enrichment: EnrichmentRecord | null
  loading: boolean
  error: string | null
}

const ORDER_LIMIT = 100

const EMPTY: CustomerDetail = {
  customer: null,
  accountName: null,
  orders: [],
  products: [],
  enrichment: null,
  loading: true,
  error: null,
}

/**
 * Everything the right-hand panel shows for one customer.
 *
 * Order lines are fetched for the loaded orders and rolled up client-side
 * rather than through another RPC: the set is bounded by ORDER_LIMIT, so this
 * is a single extra round trip instead of a per-customer aggregate.
 */
export function useCustomerDetail(customerId: string | null): CustomerDetail {
  const organization = usePDMStore((s) => s.organization)
  const dataVersion = usePDMStore((s) => s.customerDataVersion)

  const [detail, setDetail] = useState<CustomerDetail>(EMPTY)
  const requestId = useRef(0)

  const orgId = organization?.id

  useEffect(() => {
    if (!customerId || !orgId) {
      setDetail({ ...EMPTY, loading: false })
      return
    }

    const id = ++requestId.current
    setDetail({ ...EMPTY, loading: true })

    const load = async () => {
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select(
          'id, name, email, phone, company, is_company, website, vat, job_title, industry, street, street2, city, state, zip, country, erp_id, account_id, total_spent, order_count, item_count, first_order_date, last_order_date, is_active, odoo_missing_since',
        )
        .eq('id', customerId)
        .single()

      if (customerError) throw customerError

      const { data: orders, error: ordersError } = await supabase
        .from('customer_orders')
        .select('id, erp_id, order_date, status, total, discount, items_count')
        .eq('customer_id', customerId)
        .order('order_date', { ascending: false, nullsFirst: false })
        .limit(ORDER_LIMIT)

      if (ordersError) throw ordersError

      const orderIds = (orders ?? []).map((order) => order.id)

      const [linesResult, accountResult, enrichmentResult] = await Promise.all([
        orderIds.length > 0
          ? supabase
              .from('customer_order_lines')
              .select('product_name, product_erp_id, quantity, price_subtotal')
              .in('order_id', orderIds)
          : Promise.resolve({ data: [], error: null }),
        customer.account_id
          ? supabase
              .from('customer_accounts')
              .select('display_name, account_key')
              .eq('id', customer.account_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
        customer.account_id
          ? supabase
              .from('customer_enrichments')
              .select(
                'id, category, subcategory, confidence, report, evidence_found, needs_review, model, researched_at',
              )
              .eq('account_id', customer.account_id)
              .eq('is_current', true)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (linesResult.error) throw linesResult.error

      const rollup = new Map<string, CustomerProductRecord>()
      for (const line of linesResult.data ?? []) {
        const key = line.product_erp_id || line.product_name || 'unknown'
        const existing = rollup.get(key)
        if (existing) {
          existing.quantity += Number(line.quantity ?? 0)
          existing.revenue += Number(line.price_subtotal ?? 0)
        } else {
          rollup.set(key, {
            key,
            name: line.product_name ?? `Odoo product #${line.product_erp_id}`,
            quantity: Number(line.quantity ?? 0),
            revenue: Number(line.price_subtotal ?? 0),
          })
        }
      }

      let enrichment: EnrichmentRecord | null = null
      if (enrichmentResult.data) {
        const record = enrichmentResult.data
        const { data: sources } = await supabase
          .from('customer_enrichment_sources')
          .select('id, url, title, quote')
          .eq('enrichment_id', record.id)

        enrichment = { ...record, sources: sources ?? [] }
      }

      return {
        customer: customer as CustomerDetailRecord,
        accountName:
          (accountResult.data?.display_name || accountResult.data?.account_key) ?? null,
        orders: orders ?? [],
        products: Array.from(rollup.values()).sort((a, b) => b.revenue - a.revenue),
        enrichment,
        loading: false,
        error: null,
      }
    }

    load()
      .then((result) => {
        if (id !== requestId.current) return
        setDetail(result)
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
  }, [customerId, orgId, dataVersion])

  return detail
}
