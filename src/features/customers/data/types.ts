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

/**
 * One roster row.
 *
 * order_count and total_spent cover the selected date range. The dates and the
 * segment do not: they describe the customer rather than the period, and the
 * lifecycle badge is derived from them as of the range's end.
 */
export interface CustomerRfmRow {
  customer_id: string
  name: string
  email: string | null
  city: string | null
  country: string | null
  account_id: string | null
  account_name: string | null
  is_active: boolean | null
  /** Confirmed orders inside the range. Zero for a customer who bought nothing. */
  order_count: number
  /** Revenue inside the range. */
  total_spent: number
  /**
   * Orders over all time. Not for display - it is what the account roll-up
   * needs to tell "quiet this quarter" from "never bought anything".
   */
  lifetime_orders: number
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
  /** Always set: the RPC falls back to 'direct' for a customer with no account. */
  channel: string
}

export interface SegmentCount {
  segment: string
  buyers: number
  revenue: number
}

/**
 * One row per channel, including the ones nobody is in yet.
 *
 * The counts are how many partners you have; revenue and orders are what they
 * bought inside the selected range.
 */
export interface ChannelCount {
  channel: string
  account_count: number
  customer_count: number
  revenue: number
  orders: number
}

/**
 * A named partner and the account it matched, if any.
 *
 * account_id null means nothing in the data keys to it - either they have never
 * ordered, or they are in Odoo under a name that normalises differently.
 *
 * partner_channel is where the list puts them; channel is where the account
 * actually sits, which differs once somebody overrides the list by hand.
 */
export interface PartnerCoverageRow {
  name: string
  partner_channel: string
  country: string
  website: string
  account_id: string | null
  account_key: string | null
  account_name: string | null
  channel: string | null
  contacts: number
  total_spent: number
  last_order_date: string | null
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
  /** The contact who placed it, when the order is credited to their company. */
  contact_name: string | null
}

export interface CustomerProductRecord {
  key: string
  name: string
  quantity: number
  revenue: number
}

/**
 * What this customer bought inside the selected range.
 *
 * Computed over every confirmed order in the window, not just the ones the
 * order limit returned, so the panel header stays truthful for a customer with
 * hundreds of them.
 */
export interface CustomerWindowTotals {
  spend: number
  orders: number
  units: number
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
  window: CustomerWindowTotals
  accountName: string | null
  /** Falls back to 'direct' in the RPC, so this is never null. */
  accountChannel: string
  /** Orders placed inside the range, newest first. */
  orders: CustomerOrderRecord[]
  /** Rolled up over `orders`, so the two always agree. */
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
