import { describe, expect, it } from 'vitest'

import { daysSince, deriveSegment } from './segments'

const NOW = new Date('2026-07-30T12:00:00Z').getTime()

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('daysSince', () => {
  it('counts whole days back to a timestamp', () => {
    expect(daysSince(daysAgo(45), NOW)).toBe(45)
  })

  it('has no answer for a customer who has never ordered', () => {
    expect(daysSince(null, NOW)).toBeNull()
  })

  it('refuses to invent a number from an unparseable date', () => {
    expect(daysSince('not a date', NOW)).toBeNull()
  })
})

// These must agree with customer_lifecycle_segment() in 60-customers.sql.
describe('deriveSegment', () => {
  it('calls a customer with no orders a prospect', () => {
    expect(deriveSegment(0, null, null, NOW)).toBe('prospect')
  })

  it('calls a customer with orders but no date a prospect', () => {
    expect(deriveSegment(3, null, null, NOW)).toBe('prospect')
  })

  it('calls a recent buyer active', () => {
    expect(deriveSegment(10, daysAgo(900), daysAgo(20), NOW)).toBe('active')
  })

  it('calls a first-time buyer inside 90 days new', () => {
    expect(deriveSegment(1, daysAgo(10), daysAgo(10), NOW)).toBe('new')
  })

  it('calls a customer quiet for over 180 days at risk', () => {
    expect(deriveSegment(10, daysAgo(900), daysAgo(200), NOW)).toBe('at_risk')
  })

  it('calls a customer quiet for over 365 days churned', () => {
    expect(deriveSegment(10, daysAgo(900), daysAgo(400), NOW)).toBe('churned')
  })

  it('calls a one-time buyer from two years ago churned, not new', () => {
    // Branch order is the rule: recency is decided before the first-order
    // window, or a single ancient order would read as a brand new customer.
    expect(deriveSegment(1, daysAgo(700), daysAgo(700), NOW)).toBe('churned')
  })

  it('holds the boundaries where the SQL puts them', () => {
    expect(deriveSegment(5, daysAgo(900), daysAgo(365), NOW)).toBe('at_risk')
    expect(deriveSegment(5, daysAgo(900), daysAgo(366), NOW)).toBe('churned')
    expect(deriveSegment(5, daysAgo(900), daysAgo(180), NOW)).toBe('active')
    expect(deriveSegment(5, daysAgo(900), daysAgo(181), NOW)).toBe('at_risk')
  })
})
