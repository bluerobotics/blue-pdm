import { describe, expect, it } from 'vitest'

import type { CustomerRfmRow } from '../data/types'
import { rollUpByAccount } from './rollup'

/** A fixed clock, so a test does not change its meaning as the year rolls on. */
const NOW = new Date('2026-07-30T12:00:00Z').getTime()

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()
}

function row(overrides: Partial<CustomerRfmRow> & Pick<CustomerRfmRow, 'customer_id'>) {
  const base: CustomerRfmRow = {
    customer_id: overrides.customer_id,
    name: 'Someone',
    email: null,
    city: null,
    country: null,
    account_id: null,
    account_name: null,
    is_active: true,
    order_count: 0,
    total_spent: 0,
    lifetime_orders: 0,
    first_order_date: null,
    last_order_date: null,
    recency_days: null,
    r_score: null,
    f_score: null,
    m_score: null,
    segment: 'prospect',
    category: null,
    subcategory: null,
    category_label: null,
    channel: 'direct',
  }

  return { ...base, ...overrides }
}

describe('rollUpByAccount', () => {
  it('presents a company and its contacts as one customer', () => {
    const accounts = rollUpByAccount(
      [
        row({
          customer_id: 'company',
          name: 'SIX Voice',
          account_id: 'acct',
          account_name: 'SIX Voice',
          country: 'Japan',
          order_count: 351,
          lifetime_orders: 351,
          total_spent: 1_878_644.26,
          first_order_date: daysAgo(1200),
          last_order_date: daysAgo(3),
        }),
        row({
          customer_id: 'contact',
          name: 'Shuhei Habu',
          account_id: 'acct',
          account_name: 'SIX Voice',
          country: 'Japan',
          order_count: 4,
          lifetime_orders: 4,
          total_spent: 1_000,
          first_order_date: daysAgo(40),
          last_order_date: daysAgo(40),
        }),
      ],
      NOW,
    )

    expect(accounts).toHaveLength(1)
    const [account] = accounts
    expect(account.name).toBe('SIX Voice')
    expect(account.members).toHaveLength(2)
    expect(account.hasMembers).toBe(true)
    expect(account.totalSpent).toBeCloseTo(1_879_644.26)
    expect(account.orderCount).toBe(355)
    // Widest span across the members, not whichever row was read first.
    expect(account.firstOrderDate).toBe(daysAgo(1200))
    expect(account.lastOrderDate).toBe(daysAgo(3))
    expect(account.recencyDays).toBe(3)
    expect(account.lead.customer_id).toBe('company')
  })

  it('derives the segment from the rolled-up dates, not from a member', () => {
    // The company row on its own looks churned - every recent order was placed
    // by the contact. Together they are plainly an active customer, and that is
    // the bug this whole change exists to fix.
    const [account] = rollUpByAccount(
      [
        row({
          customer_id: 'company',
          name: 'JM Robotics',
          account_id: 'acct',
          account_name: 'JM Robotics',
          segment: 'churned',
          order_count: 505,
          lifetime_orders: 505,
          total_spent: 4_994_378.72,
          first_order_date: daysAgo(2000),
          last_order_date: daysAgo(600),
        }),
        row({
          customer_id: 'contact',
          name: 'Ola Nordmann',
          account_id: 'acct',
          account_name: 'JM Robotics',
          segment: 'active',
          order_count: 12,
          lifetime_orders: 12,
          total_spent: 90_000,
          first_order_date: daysAgo(120),
          last_order_date: daysAgo(1),
        }),
      ],
      NOW,
    )

    expect(account.segment).toBe('active')
  })

  it('segments an account that bought nothing in the window on its lifetime history', () => {
    // Seen through a 30-day range this account has no orders and no spend at
    // all. It is still a customer who bought heavily until last year, and
    // reading the windowed count would badge it "Never ordered".
    const [account] = rollUpByAccount(
      [
        row({
          customer_id: 'company',
          name: 'Quiet Works',
          account_id: 'acct',
          account_name: 'Quiet Works',
          order_count: 0,
          total_spent: 0,
          lifetime_orders: 240,
          first_order_date: daysAgo(2000),
          last_order_date: daysAgo(200),
        }),
      ],
      NOW,
    )

    expect(account.segment).toBe('at_risk')
    expect(account.totalSpent).toBe(0)
  })

  it('keeps ungrouped customers apart rather than lumping them together', () => {
    const accounts = rollUpByAccount(
      [
        row({ customer_id: 'a', name: 'Alice' }),
        row({ customer_id: 'b', name: 'Bob' }),
      ],
      NOW,
    )

    expect(accounts.map((account) => account.name)).toEqual(['Alice', 'Bob'])
    expect(accounts.every((account) => !account.hasMembers)).toBe(true)
  })

  it('sorts contacts by spend and leads with the biggest', () => {
    const [account] = rollUpByAccount(
      [
        row({ customer_id: 'small', name: 'Small', account_id: 'acct', total_spent: 10 }),
        row({ customer_id: 'big', name: 'Big', account_id: 'acct', total_spent: 900 }),
        row({ customer_id: 'mid', name: 'Mid', account_id: 'acct', total_spent: 100 }),
      ],
      NOW,
    )

    expect(account.members.map((member) => member.customer_id)).toEqual(['big', 'mid', 'small'])
    expect(account.lead.customer_id).toBe('big')
  })

  it('leads with the company when nobody has spent anything yet', () => {
    const [account] = rollUpByAccount(
      [
        row({
          customer_id: 'contact',
          name: 'Jo Diver',
          account_id: 'acct',
          account_name: 'Acme Subsea',
        }),
        row({
          customer_id: 'company',
          name: 'Acme Subsea',
          account_id: 'acct',
          account_name: 'Acme Subsea',
        }),
      ],
      NOW,
    )

    expect(account.lead.customer_id).toBe('company')
  })

  it('counts an account as present while any member is still in Odoo', () => {
    const [account] = rollUpByAccount(
      [
        row({ customer_id: 'gone', account_id: 'acct', is_active: false }),
        row({ customer_id: 'here', account_id: 'acct', is_active: true }),
      ],
      NOW,
    )

    expect(account.isActive).toBe(true)
  })

  it('collects every country its members sit in', () => {
    const [account] = rollUpByAccount(
      [
        row({ customer_id: 'no', account_id: 'acct', country: 'Norway', total_spent: 5 }),
        row({ customer_id: 'de', account_id: 'acct', country: 'Germany' }),
        row({ customer_id: 'dup', account_id: 'acct', country: 'Norway' }),
      ],
      NOW,
    )

    expect(account.countries.sort()).toEqual(['Germany', 'Norway'])
    // The lead's own country is what the single-value column shows.
    expect(account.country).toBe('Norway')
  })

  it('takes the category from whichever member the enrichment join reached', () => {
    const [account] = rollUpByAccount(
      [
        row({ customer_id: 'lead', account_id: 'acct', total_spent: 100 }),
        row({
          customer_id: 'other',
          account_id: 'acct',
          category: 'subsea',
          subcategory: 'rov',
          category_label: 'ROV integrator',
        }),
      ],
      NOW,
    )

    expect(account.categoryLabel).toBe('ROV integrator')
    expect(account.category).toBe('subsea')
  })

  it('carries the channel every member reports', () => {
    // Unlike the category, channel is a column on the account itself, so every
    // member of an account always agrees about it.
    const [account] = rollUpByAccount(
      [
        row({ customer_id: 'lead', account_id: 'acct', channel: 'distributor', total_spent: 100 }),
        row({ customer_id: 'contact', account_id: 'acct', channel: 'distributor' }),
      ],
      NOW,
    )

    expect(account.channel).toBe('distributor')
  })

  it('falls back to direct for a channel it does not recognise', () => {
    // The roll-up types channel as a union, so a value the database grew after
    // this build shipped has to land somewhere rather than leak through and
    // silently fail every comparison against it.
    const [account] = rollUpByAccount(
      [row({ customer_id: 'lone', channel: 'wholesaler' })],
      NOW,
    )

    expect(account.channel).toBe('direct')
  })
})
