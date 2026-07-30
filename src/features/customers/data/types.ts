/**
 * Row shapes returned by the customer analytics RPCs.
 *
 * These mirror the RETURNS TABLE declarations in
 * supabase/modules/60-customers.sql. Numeric columns arrive as JS numbers via
 * PostgREST, except where a NUMERIC can be NULL (an empty window divides by
 * zero and yields NULL rather than NaN).
 */

export interface AnalyticsSummary {
  revenue: number
  orders: number
  buyers: number
  units: number
  aov: number | null
  discount: number
  new_customers: number
  prev_revenue: number
  prev_orders: number
  prev_buyers: number
  prev_units: number
  prev_aov: number | null
  prev_discount: number
  prev_new_customers: number
  total_customers: number
  active_customers: number
  at_risk_customers: number
  churned_customers: number
  gone_customers: number
  unclassified_accounts: number
}

export interface TimeseriesPoint {
  bucket_start: string
  revenue: number
  orders: number
  buyers: number
  new_customers: number
  units: number
}

export interface TopAccount {
  group_key: string
  account_id: string | null
  label: string | null
  revenue: number
  orders: number
  buyers: number
  share: number | null
  cumulative_share: number | null
  rank_index: number
}

export interface CategoryBreakdownRow {
  category: string | null
  subcategory: string | null
  category_label: string | null
  subcategory_label: string | null
  revenue: number
  orders: number
  buyers: number
}

export interface GeoBreakdownRow {
  country: string | null
  revenue: number
  orders: number
  buyers: number
}

export interface CohortCell {
  cohort_month: string
  cohort_size: number
  month_index: number
  buyers: number
  revenue: number
  retention: number | null
}

export interface TopProduct {
  product_key: string
  product_erp_id: string | null
  product_name: string | null
  quantity: number
  revenue: number
  orders: number
  buyers: number
}

export interface CustomerRfmRow {
  customer_id: string
  name: string
  email: string | null
  city: string | null
  country: string | null
  account_id: string | null
  account_name: string | null
  is_active: boolean | null
  order_count: number
  total_spent: number
  first_order_date: string | null
  last_order_date: string | null
  recency_days: number | null
  r_score: number | null
  f_score: number | null
  m_score: number | null
  segment: string
  category: string | null
  subcategory: string | null
  category_label: string | null
}

export interface SegmentCount {
  segment: string
  buyers: number
  revenue: number
}

/** Everything the Overview tab renders, resolved in one parallel fetch. */
export interface CustomerAnalyticsData {
  summary: AnalyticsSummary | null
  timeseries: TimeseriesPoint[]
  topAccounts: TopAccount[]
  categories: CategoryBreakdownRow[]
  geo: GeoBreakdownRow[]
  cohorts: CohortCell[]
  topProducts: TopProduct[]
  segmentCounts: SegmentCount[]
}

export const EMPTY_ANALYTICS: CustomerAnalyticsData = {
  summary: null,
  timeseries: [],
  topAccounts: [],
  categories: [],
  geo: [],
  cohorts: [],
  topProducts: [],
  segmentCounts: [],
}
