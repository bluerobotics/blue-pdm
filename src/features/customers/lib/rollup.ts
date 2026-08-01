/**
 * Account roll-up: several Odoo partners presented as the one customer they
 * actually are.
 *
 * Odoo keeps a company and each of its contacts as separate res.partner
 * records, and the mirror keeps that shape - one `customers` row per partner.
 * Listing them raw puts "SIX Voice" and "Shuhei Habu" side by side as if they
 * were unrelated customers. `customer_accounts` already groups them, because
 * that is the unit the (expensive) AI enrichment attaches to, so the same
 * grouping is what the UI collapses on.
 *
 * The sync credits every order to the commercial partner, so a contact under a
 * company normally carries no orders of its own and the totals here are just
 * the company's. Summing anyway is still correct - each order belongs to
 * exactly one customer row, so nothing can be counted twice - and it keeps the
 * numbers honest for an account whose contacts do buy in their own right.
 *
 * Both the customer table and the accounts tab go through this, so the two
 * cannot show different totals or different segments for the same account.
 *
 * The rows arrive already scoped to the workspace's date range, so the spend
 * and order counts here are the window's. The dates are not - see
 * CustomerRfmRow - which is why the segment derived below stays meaningful at
 * any width.
 */

import type { CustomerRfmRow } from '../data/types'
import { isChannelId, type ChannelId } from './channels'
import { daysSince, deriveSegment, type SegmentId } from './segments'

/** One account, with the customer rows that make it up. */
export interface AccountRollup<T extends CustomerRfmRow = CustomerRfmRow> {
  /** Stable across renders: the account id, or the lone customer's own id. */
  key: string
  accountId: string | null
  name: string
  /** The member rows, highest spender first. Always at least one. */
  members: T[]
  /**
   * The row a click opens. The company itself when there is one, otherwise the
   * biggest spender - never an arbitrary contact.
   */
  lead: T
  /** True when the account is more than a single customer row. */
  hasMembers: boolean
  /** Inside the workspace's date range. */
  totalSpent: number
  /** Inside the workspace's date range. */
  orderCount: number
  /**
   * Orders over all time. Only the segment reads it: an account that bought
   * for years and nothing this quarter has to come out churned rather than
   * "never ordered", and the windowed count cannot tell those apart.
   */
  lifetimeOrders: number
  firstOrderDate: string | null
  lastOrderDate: string | null
  recencyDays: number | null
  segment: SegmentId
  country: string | null
  /** Every distinct country across the members, for the accounts tab subtitle. */
  countries: string[]
  categoryLabel: string | null
  category: string | null
  subcategory: string | null
  /**
   * Sales channel, which is a property of the account itself - so unlike the
   * category it is the same on every member by construction, not by fallback.
   */
  channel: ChannelId
  /** False only when every member has been flagged as gone from Odoo. */
  isActive: boolean
}

function earlier(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return left < right ? left : right
}

function later(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return left > right ? left : right
}

/**
 * Which member represents the account.
 *
 * Spend decides it, so the row that holds the history is the row that opens.
 * The tie-breaks matter whenever nobody spent anything in the window - a
 * freshly synced account, or any quiet account seen through a narrow range.
 * Without them the lead would be whichever partner Odoo happened to return
 * first, and an account could be represented by an employee while the company
 * row sat underneath it. Lifetime orders are the last word for exactly that
 * reason: they are the one signal a narrow window cannot flatten.
 */
function preferLead<T extends CustomerRfmRow>(current: T, candidate: T): T {
  if (candidate.total_spent !== current.total_spent) {
    return candidate.total_spent > current.total_spent ? candidate : current
  }

  // An account named after one of its members is that member.
  const currentIsNamesake = current.account_name === current.name
  const candidateIsNamesake = candidate.account_name === candidate.name
  if (currentIsNamesake !== candidateIsNamesake) {
    return candidateIsNamesake ? candidate : current
  }

  return candidate.lifetime_orders > current.lifetime_orders ? candidate : current
}

/**
 * Collapse roster rows onto their accounts.
 *
 * Rows with no account stand alone rather than being lumped together, since a
 * null account_id means "not grouped", not "grouped with the other ungrouped".
 *
 * @param rows - Roster rows, in any order
 * @param asOf - Overridable clock, so the segment is testable
 */
export function rollUpByAccount<T extends CustomerRfmRow>(
  rows: readonly T[],
  asOf: number = Date.now(),
): AccountRollup<T>[] {
  const byKey = new Map<string, AccountRollup<T>>()

  for (const row of rows) {
    const key = row.account_id ?? `customer:${row.customer_id}`
    const existing = byKey.get(key)

    if (!existing) {
      byKey.set(key, {
        key,
        accountId: row.account_id,
        name: row.account_name ?? row.name,
        members: [row],
        lead: row,
        hasMembers: false,
        totalSpent: row.total_spent,
        orderCount: row.order_count,
        lifetimeOrders: row.lifetime_orders,
        firstOrderDate: row.first_order_date,
        lastOrderDate: row.last_order_date,
        recencyDays: null,
        segment: 'prospect',
        country: row.country,
        countries: row.country ? [row.country] : [],
        categoryLabel: row.category_label,
        category: row.category,
        subcategory: row.subcategory,
        channel: isChannelId(row.channel) ? row.channel : 'direct',
        isActive: row.is_active !== false,
      })
      continue
    }

    existing.members.push(row)
    existing.hasMembers = true
    existing.totalSpent += row.total_spent
    existing.orderCount += row.order_count
    existing.lifetimeOrders += row.lifetime_orders
    existing.firstOrderDate = earlier(existing.firstOrderDate, row.first_order_date)
    existing.lastOrderDate = later(existing.lastOrderDate, row.last_order_date)
    existing.lead = preferLead(existing.lead, row)
    if (row.country && !existing.countries.includes(row.country)) {
      existing.countries.push(row.country)
    }
    // Enrichment hangs off the account, so every member reports the same
    // category - but a member the enrichment join missed reports null, and the
    // account should still show the category it was classified with.
    existing.categoryLabel ??= row.category_label
    existing.category ??= row.category
    existing.subcategory ??= row.subcategory
    if (row.is_active !== false) existing.isActive = true
  }

  for (const account of byKey.values()) {
    account.members.sort((a, b) => b.total_spent - a.total_spent)
    account.name = account.lead.account_name ?? account.lead.name
    account.country = account.lead.country ?? account.countries[0] ?? null
    account.recencyDays = daysSince(account.lastOrderDate, asOf)
    account.segment = deriveSegment(
      account.lifetimeOrders,
      account.firstOrderDate,
      account.lastOrderDate,
      asOf,
    )
  }

  return [...byKey.values()]
}
