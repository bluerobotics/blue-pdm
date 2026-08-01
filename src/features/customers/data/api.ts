/**
 * Typed wrappers over the customer analytics RPCs.
 *
 * Every call goes through the same client the rest of the app uses, so RLS
 * applies and the caller only ever sees their own org.
 *
 * Each RPC is exposed as a `Query` - a cache key paired with the function that
 * fills it - rather than as a bare fetch. Keeping the two together is what lets
 * the sidebar and the workspace ask for the same facet counts and get one
 * request instead of two; see data/cache.ts.
 */

import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'

import type { ChannelId } from '../lib/channels'
import type { Query } from './cache'
import type {
  AnalyticsSummary,
  CategoryBreakdownRow,
  ChannelCount,
  CohortCell,
  CustomerDetailPayload,
  CustomerRfmRow,
  GeoBreakdownRow,
  PartnerCoverageRow,
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

/**
 * An RPC slower than this is worth seeing in the session log without having to
 * turn debug logging on - it usually means an index or a policy regressed.
 */
const SLOW_RPC_MS = 1500

interface RpcResult<T> {
  data: T | null
  error: { message: string } | null
}

/**
 * Runs an RPC and records how long it took.
 *
 * The call is passed as a thunk rather than as a name plus params so the
 * generated Database types still check the arguments at each call site.
 *
 * The per-call line is debug-level (enable with localStorage.debug =
 * '[Customers]'); only failures and genuinely slow calls reach the log by
 * default, alongside the one summary line the analytics hook writes per load.
 */
async function timed<T>(name: string, run: () => PromiseLike<RpcResult<T>>): Promise<T | null> {
  const startedAt = performance.now()
  const { data, error } = await run()
  const ms = Math.round(performance.now() - startedAt)

  if (error) {
    log.error('[Customers]', `RPC ${name} failed after ${ms}ms`, { error: error.message })
    throw new Error(`${name}: ${error.message}`)
  }

  const rows = Array.isArray(data) ? data.length : 1

  if (ms >= SLOW_RPC_MS) {
    log.warn('[Customers]', `Slow RPC ${name}`, { ms, rows })
  } else {
    log.debug('[Customers]', `RPC ${name}`, { ms, rows })
  }

  return data
}

/** Set-returning RPCs, where PostgREST gives null for an empty result. */
async function timedRows<T>(name: string, run: () => PromiseLike<RpcResult<T[]>>): Promise<T[]> {
  return (await timed(name, run)) ?? []
}

async function fetchSummary(orgId: string, window: DateWindow): Promise<AnalyticsSummary | null> {
  const rows = await timedRows('customer_analytics_summary', () =>
    supabase.rpc('customer_analytics_summary', {
      p_org_id: orgId,
      p_from: window.from,
      p_to: window.to,
    }),
  )

  // The RPC always returns exactly one row; an empty array only happens if the
  // org has no rows at all, in which case the KPI strip renders zeroes.
  const row = rows[0]
  if (!row) return null

  return {
    ...row,
    // segment_counts is JSONB, which the generated types can only describe as
    // Json. The shape is fixed by the jsonb_build_object call in the RPC.
    segment_counts: (row.segment_counts ?? []) as unknown as SegmentCount[],
  }
}

export const customerQueries = {
  summary(orgId: string, window: DateWindow): Query<AnalyticsSummary | null> {
    return {
      key: `summary|${orgId}|${window.from}|${window.to}`,
      run: () => fetchSummary(orgId, window),
    }
  },

  timeseries(orgId: string, window: DateWindow, bucket: string): Query<TimeseriesPoint[]> {
    return {
      key: `timeseries|${orgId}|${window.from}|${window.to}|${bucket}`,
      run: () =>
        timedRows<TimeseriesPoint>('customer_revenue_timeseries', () =>
          supabase.rpc('customer_revenue_timeseries', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
            p_bucket: bucket,
          }),
        ),
    }
  },

  topAccounts(orgId: string, window: DateWindow, limit = 15): Query<TopAccount[]> {
    return {
      key: `topAccounts|${orgId}|${window.from}|${window.to}|${limit}`,
      run: () =>
        timedRows<TopAccount>('customer_top_accounts', () =>
          supabase.rpc('customer_top_accounts', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
            p_limit: limit,
          }),
        ),
    }
  },

  categories(orgId: string, window: DateWindow): Query<CategoryBreakdownRow[]> {
    return {
      key: `categories|${orgId}|${window.from}|${window.to}`,
      run: () =>
        timedRows<CategoryBreakdownRow>('customer_category_breakdown', () =>
          supabase.rpc('customer_category_breakdown', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
          }),
        ),
    }
  },

  geo(orgId: string, window: DateWindow): Query<GeoBreakdownRow[]> {
    return {
      key: `geo|${orgId}|${window.from}|${window.to}`,
      run: () =>
        timedRows<GeoBreakdownRow>('customer_geo_breakdown', () =>
          supabase.rpc('customer_geo_breakdown', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
          }),
        ),
    }
  },

  /**
   * Retention grid as of the window's end.
   *
   * `months` is how many cohorts to draw rather than a second window - see the
   * RPC's comment: retention only says something across several cohorts, so a
   * 30-day range still looks back far enough to have rows to compare.
   */
  cohorts(orgId: string, window: DateWindow, months = 12): Query<CohortCell[]> {
    return {
      key: `cohorts|${orgId}|${window.to}|${months}`,
      run: () =>
        timedRows<CohortCell>('customer_cohort_retention', () =>
          supabase.rpc('customer_cohort_retention', {
            p_org_id: orgId,
            p_as_of: window.to,
            p_months: months,
          }),
        ),
    }
  },

  topProducts(orgId: string, window: DateWindow, limit = 12): Query<TopProduct[]> {
    return {
      key: `topProducts|${orgId}|${window.from}|${window.to}|${limit}`,
      run: () =>
        timedRows<TopProduct>('customer_top_products', () =>
          supabase.rpc('customer_top_products', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
            p_limit: limit,
          }),
        ),
    }
  },

  /**
   * The roster behind every table in the workspace.
   *
   * Spend and order counts are the window's; the lifecycle dates and segment
   * are lifetime, as of the window's end. See the RPC for why.
   */
  rfm(orgId: string, window: DateWindow, limit = 5000): Query<CustomerRfmRow[]> {
    return {
      key: `rfm|${orgId}|${window.from}|${window.to}|${limit}`,
      run: () =>
        timedRows<CustomerRfmRow>('customer_rfm', () =>
          supabase.rpc('customer_rfm', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
            p_limit: limit,
          }),
        ),
    }
  },

  /**
   * Accounts and revenue per sales channel.
   *
   * Revenue and orders are the window's; the account and contact counts are
   * not, because they answer how many partners you have rather than how much
   * they bought in the period.
   */
  channelCounts(orgId: string, window: DateWindow): Query<ChannelCount[]> {
    return {
      key: `channelCounts|${orgId}|${window.from}|${window.to}`,
      run: () =>
        timedRows<ChannelCount>('customer_channel_counts', () =>
          supabase.rpc('customer_channel_counts', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
          }),
        ),
    }
  },

  /** Every named distributor and integrator, matched to an account or not. */
  partnerCoverage(orgId: string, window: DateWindow): Query<PartnerCoverageRow[]> {
    return {
      key: `partnerCoverage|${orgId}|${window.from}|${window.to}`,
      run: () =>
        timedRows<PartnerCoverageRow>('customer_partner_coverage', () =>
          supabase.rpc('customer_partner_coverage', {
            p_org_id: orgId,
            p_from: window.from,
            p_to: window.to,
          }),
        ),
    }
  },

  /** Everything the right-hand panel shows, as one JSONB document. */
  detail(customerId: string, window: DateWindow, orderLimit = 100): Query<CustomerDetailPayload> {
    return {
      key: `detail|${customerId}|${window.from}|${window.to}|${orderLimit}`,
      run: async () => {
        const payload = await timed('customer_detail', () =>
          supabase.rpc('customer_detail', {
            p_customer_id: customerId,
            p_from: window.from,
            p_to: window.to,
            p_order_limit: orderLimit,
          }),
        )

        // JSONB again: the shape is set by the jsonb_build_object in the RPC,
        // which the generated types flatten to Json.
        return payload as unknown as CustomerDetailPayload
      },
    }
  },
}

/**
 * Move an account to a different sales channel.
 *
 * A plain table update rather than an RPC: it is one column on one row, and the
 * existing "Managers can update customer accounts" policy already gates it on
 * module:customers edit. A trigger stamps who changed it and when, which is
 * what stops the distributor seed from later overwriting the answer - so the
 * client deliberately sends nothing but the channel itself.
 *
 * The caller is responsible for invalidating the cached roster afterwards;
 * every read of this value goes through queries keyed above.
 */
export async function setAccountChannel(accountId: string, channel: ChannelId): Promise<void> {
  const startedAt = performance.now()

  const { error } = await supabase
    .from('customer_accounts')
    .update({ channel })
    .eq('id', accountId)

  if (error) {
    log.error('[Customers]', 'Failed to set account channel', {
      accountId,
      channel,
      error: error.message,
    })
    throw new Error(error.message)
  }

  log.info('[Customers]', 'Account channel changed', {
    accountId,
    channel,
    ms: Math.round(performance.now() - startedAt),
  })
}
