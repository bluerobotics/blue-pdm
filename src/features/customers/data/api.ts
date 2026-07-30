/**
 * Typed wrappers over the customer analytics RPCs.
 *
 * Every call goes through the same client the rest of the app uses, so RLS
 * applies and the caller only ever sees their own org.
 */

import { supabase } from '@/lib/supabase'

import type {
  AnalyticsSummary,
  CategoryBreakdownRow,
  CohortCell,
  CustomerRfmRow,
  GeoBreakdownRow,
  SegmentCount,
  TimeseriesPoint,
  TopAccount,
  TopProduct,
} from './types'

/** Window passed to the range-scoped RPCs, as ISO strings. */
export interface DateWindow {
  from: string
  to: string
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`)
  }
  return (result.data ?? []) as T
}

export async function fetchSummary(
  orgId: string,
  window: DateWindow,
): Promise<AnalyticsSummary | null> {
  const result = await supabase.rpc('customer_analytics_summary', {
    p_org_id: orgId,
    p_from: window.from,
    p_to: window.to,
  })

  // The RPC always returns exactly one row; an empty array only happens if the
  // org has no rows at all, in which case the KPI strip renders zeroes.
  const rows = unwrap<AnalyticsSummary[]>(result, 'customer_analytics_summary')
  return rows[0] ?? null
}

export async function fetchTimeseries(
  orgId: string,
  window: DateWindow,
  bucket: string,
): Promise<TimeseriesPoint[]> {
  const result = await supabase.rpc('customer_revenue_timeseries', {
    p_org_id: orgId,
    p_from: window.from,
    p_to: window.to,
    p_bucket: bucket,
  })
  return unwrap<TimeseriesPoint[]>(result, 'customer_revenue_timeseries')
}

export async function fetchTopAccounts(
  orgId: string,
  window: DateWindow,
  limit = 15,
): Promise<TopAccount[]> {
  const result = await supabase.rpc('customer_top_accounts', {
    p_org_id: orgId,
    p_from: window.from,
    p_to: window.to,
    p_limit: limit,
  })
  return unwrap<TopAccount[]>(result, 'customer_top_accounts')
}

export async function fetchCategoryBreakdown(
  orgId: string,
  window: DateWindow,
): Promise<CategoryBreakdownRow[]> {
  const result = await supabase.rpc('customer_category_breakdown', {
    p_org_id: orgId,
    p_from: window.from,
    p_to: window.to,
  })
  return unwrap<CategoryBreakdownRow[]>(result, 'customer_category_breakdown')
}

export async function fetchGeoBreakdown(
  orgId: string,
  window: DateWindow,
): Promise<GeoBreakdownRow[]> {
  const result = await supabase.rpc('customer_geo_breakdown', {
    p_org_id: orgId,
    p_from: window.from,
    p_to: window.to,
  })
  return unwrap<GeoBreakdownRow[]>(result, 'customer_geo_breakdown')
}

export async function fetchCohorts(orgId: string, months = 12): Promise<CohortCell[]> {
  const result = await supabase.rpc('customer_cohort_retention', {
    p_org_id: orgId,
    p_months: months,
  })
  return unwrap<CohortCell[]>(result, 'customer_cohort_retention')
}

export async function fetchTopProducts(
  orgId: string,
  window: DateWindow,
  limit = 12,
): Promise<TopProduct[]> {
  const result = await supabase.rpc('customer_top_products', {
    p_org_id: orgId,
    p_from: window.from,
    p_to: window.to,
    p_limit: limit,
  })
  return unwrap<TopProduct[]>(result, 'customer_top_products')
}

export async function fetchRfm(orgId: string, limit = 5000): Promise<CustomerRfmRow[]> {
  const result = await supabase.rpc('customer_rfm', {
    p_org_id: orgId,
    p_limit: limit,
  })
  return unwrap<CustomerRfmRow[]>(result, 'customer_rfm')
}

export async function fetchSegmentCounts(orgId: string): Promise<SegmentCount[]> {
  const result = await supabase.rpc('customer_segment_counts', { p_org_id: orgId })
  return unwrap<SegmentCount[]>(result, 'customer_segment_counts')
}

/** Taxonomy display names, for labelling categories the enrichment produced. */
export async function fetchCategoryTaxonomy(orgId: string) {
  const { data, error } = await supabase
    .from('customer_categories')
    .select('category, subcategory, display_name, sort_order')
    .eq('org_id', orgId)
    .order('sort_order')

  if (error) throw new Error(`customer_categories: ${error.message}`)
  return data ?? []
}
