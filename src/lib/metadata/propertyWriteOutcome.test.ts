import { describe, expect, it } from 'vitest'

import {
  describeBatchPropertyWriteFailure,
  summarizeBatchPropertyWrite,
} from './propertyWriteOutcome'

describe('summarizeBatchPropertyWrite', () => {
  it('is complete when every configuration was written', () => {
    const outcome = summarizeBatchPropertyWrite(68, {
      configurationsProcessed: 68,
      propertiesSet: 340,
      propertiesFailed: 0,
    })

    expect(outcome.complete).toBe(true)
    expect(outcome.configurationsMissing).toBe(0)
  })

  // The case the plan names: 12 of 68 written, reported as success.
  it('is incomplete when the SolidWorks path names failed configurations', () => {
    const outcome = summarizeBatchPropertyWrite(68, {
      configurationsProcessed: 12,
      configurationsFailed: 56,
      failedConfigurations: { 'AS568-014': 'file is read-only' },
    })

    expect(outcome.complete).toBe(false)
    expect(outcome.configurationsWritten).toBe(12)
    expect(outcome.configurationsMissing).toBe(56)
    expect(outcome.failedConfigurations).toEqual(['AS568-014: file is read-only'])
  })

  it('is incomplete when the Document Manager path reports failed properties', () => {
    const outcome = summarizeBatchPropertyWrite(3, {
      configurationsProcessed: 3,
      propertiesSet: 8,
      propertiesFailed: 1,
      failedProperties: ['AS568-014:Tab Number'],
    })

    expect(outcome.complete).toBe(false)
    expect(outcome.configurationsMissing).toBe(0)
    expect(outcome.propertiesFailed).toBe(1)
  })

  // A configuration the Document Manager path cannot find is skipped into `errors` and counted
  // nowhere else, so the shortfall against what was asked for is the only thing that catches it.
  it('notices a configuration that was dropped rather than refused', () => {
    const outcome = summarizeBatchPropertyWrite(68, {
      configurationsProcessed: 67,
      propertiesFailed: 0,
      errors: ['Configuration not found: AS568-014'],
    })

    expect(outcome.complete).toBe(false)
    expect(outcome.configurationsMissing).toBe(1)
    expect(outcome.errors).toEqual(['Configuration not found: AS568-014'])
  })

  it('treats a response with no counts as having written everything', () => {
    expect(summarizeBatchPropertyWrite(68, undefined).complete).toBe(true)
    expect(summarizeBatchPropertyWrite(68, {}).complete).toBe(true)
  })

  it('takes the larger of the reported count and the named failures', () => {
    const outcome = summarizeBatchPropertyWrite(4, {
      configurationsProcessed: 4,
      configurationsFailed: 0,
      failedConfigurations: { A: 'refused', B: 'refused' },
    })

    expect(outcome.configurationsMissing).toBe(2)
  })
})

describe('describeBatchPropertyWriteFailure', () => {
  it('says nothing about a complete write', () => {
    expect(describeBatchPropertyWriteFailure(summarizeBatchPropertyWrite(2, {}))).toBe('')
  })

  it('names the failed configurations and caps the list', () => {
    const failedConfigurations = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`AS568-${index}`, 'refused']),
    )
    const detail = describeBatchPropertyWriteFailure(
      summarizeBatchPropertyWrite(8, { configurationsProcessed: 0, failedConfigurations }),
    )

    expect(detail).toContain('AS568-0')
    expect(detail).toContain('+3 more')
  })

  it('carries the messages the service reported through to the user', () => {
    const detail = describeBatchPropertyWriteFailure(
      summarizeBatchPropertyWrite(2, {
        configurationsProcessed: 1,
        errors: ['Configuration not found: AS568-014'],
      }),
    )

    expect(detail).toBe('Configuration not found: AS568-014')
  })
})
