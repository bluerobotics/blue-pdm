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
  /**
   * Lifecycle rollup over every customer in the org, computed from the same
   * scan as the counts above rather than by a second RPC. The sidebar facet
   * counts read this.
   */
  segment_counts: SegmentCount[]
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

/**
 * Shapes inside the customer_detail JSONB document.
 *
 * Unlike the row types above these are keys of one object, so the names come
 * from the jsonb_build_object calls in the RPC, not from a RETURNS TABLE.
 */
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

/** Raw return value of the customer_detail RPC. */
export interface CustomerDetailPayload {
  customer: CustomerDetailRecord | null
  accountName: string | null
  orders: CustomerOrderRecord[]
  products: CustomerProductRecord[]
  enrichment: EnrichmentRecord | null
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
