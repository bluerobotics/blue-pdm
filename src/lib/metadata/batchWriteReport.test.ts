/**
 * Recognising a refused configuration in a batch response.
 *
 * The rule under test is the one the per-scope call applied: a configuration is refused when the
 * service said so outright, or when every property sent to it was declined. Anything less than
 * every property is a partial write, which the read-back is the right judge of.
 */

import { describe, expect, it } from 'vitest'

import { readBatchWriteReport, type BatchWriteScope } from './batchWriteReport'

const sent: BatchWriteScope[] = [
  { configuration: 'AS568-014', propertyNames: ['Number', 'Tab Number'] },
  { configuration: 'AS568-015', propertyNames: ['Number', 'Tab Number'] },
]

describe('a configuration either path named', () => {
  it('is refused, carrying the reason the service gave', () => {
    const report = readBatchWriteReport(sent, {
      configurationsProcessed: 1,
      failedConfigurations: { 'AS568-015': 'the configuration is read-only' },
    })

    expect(report.refused.get('AS568-015')).toBe('the configuration is read-only')
    expect(report.refused.has('AS568-014')).toBe(false)
    expect(report.unaccountedFor).toBe(0)
  })

  it('leaves nothing unaccounted for when Document Manager names the one it skipped', () => {
    // Service 1.20.0. The same response before it carried the name only in `errors`, in prose, so
    // the shortfall was a number and the whole batch had to be distrusted.
    const report = readBatchWriteReport(sent, {
      configurationsProcessed: 1,
      failedConfigurations: { 'AS568-015': 'the document has no configuration by this name' },
      errors: ['Configuration not found: AS568-015'],
    })

    expect(report.refused.get('AS568-015')).toBe('the document has no configuration by this name')
    expect(report.unaccountedFor).toBe(0)
  })
})

describe('a configuration the Document Manager path declined every property of', () => {
  it('is refused', () => {
    const report = readBatchWriteReport(sent, {
      configurationsProcessed: 2,
      failedProperties: ['AS568-015:Number', 'AS568-015:Tab Number'],
    })

    expect(report.refused.has('AS568-015')).toBe(true)
    expect(report.refused.has('AS568-014')).toBe(false)
  })

  it('is not refused when only some of its properties were declined', () => {
    // The scope was written; one value did not land. That is exactly what the read-back is for,
    // and calling it a refusal would skip the read-back for an address the file may well hold.
    const report = readBatchWriteReport(sent, {
      configurationsProcessed: 2,
      failedProperties: ['AS568-015:Tab Number'],
    })

    expect(report.refused.size).toBe(0)
  })

  it('matches identifiers exactly rather than parsing them apart', () => {
    // A configuration named with a colon rebuilds to the same identifier the service emits, so it
    // is recognised; a different configuration whose name is a prefix of it is not.
    const colonScopes: BatchWriteScope[] = [
      { configuration: 'A:B', propertyNames: ['Number'] },
      { configuration: 'A', propertyNames: ['Number'] },
    ]

    const report = readBatchWriteReport(colonScopes, {
      configurationsProcessed: 2,
      failedProperties: ['A:B:Number'],
    })

    expect(report.refused.has('A:B')).toBe(true)
    expect(report.refused.has('A')).toBe(false)
  })
})

describe('configurations the service neither entered nor named', () => {
  it('are counted, because nothing in the response says which they were', () => {
    const report = readBatchWriteReport(sent, {
      configurationsProcessed: 1,
      errors: ['Configuration not found: AS568-015'],
    })

    expect(report.unaccountedFor).toBe(1)
    expect(report.refused.size).toBe(0)
  })

  it('are none when a service reports no count at all', () => {
    // An absent count read as zero would report every configuration missing on every write.
    expect(readBatchWriteReport(sent, {}).unaccountedFor).toBe(0)
    expect(readBatchWriteReport(sent, undefined).unaccountedFor).toBe(0)
  })
})

describe('a batch nothing went wrong in', () => {
  it('refuses nothing and accounts for everything', () => {
    const report = readBatchWriteReport(sent, {
      configurationsProcessed: 2,
      failedProperties: null,
      errors: null,
    })

    expect(report.refused.size).toBe(0)
    expect(report.unaccountedFor).toBe(0)
  })
})
