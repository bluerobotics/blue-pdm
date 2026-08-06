/**
 * Whether a write is confirmed by the file, or only by the service's say-so.
 *
 * The service reports the outcome of an API call. A property SolidWorks refuses on info-type grounds,
 * a configuration that declines the value, a save that never reaches disk - all return success, which
 * is why check-in promoting on that basis was the original bug. These tests pin the read-back rule
 * that replaces it, including the two cases the plan is emphatic about not collapsing: a value known
 * to be absent, and a value nobody could check.
 */

import { describe, expect, it } from 'vitest'

import type { FileMetadata } from './divergence'
import { failedWrite, unverifiedWrite, verifyWrite, type MetadataWriteIntent } from './verifyWrite'

function document(
  fileProperties: Record<string, string>,
  configurationProperties: Record<string, Record<string, string>> = {},
): FileMetadata {
  return {
    configurations: Object.keys(configurationProperties),
    fileProperties,
    configurationProperties,
  }
}

const partNumber: MetadataWriteIntent = {
  address: { scope: 'file', field: 'part_number' },
  expected: 'BR-101010',
}

describe('a value the file holds is verified', () => {
  it('accepts the value under the field read priority', () => {
    const [outcome] = verifyWrite([partNumber], document({ Number: 'BR-101010' }))

    expect(outcome.state).toBe('verified')
  })

  it('accepts a part number that landed in Base Item Number while Number carries the tab', () => {
    // Number is base-plus-tab and Base Item Number is the base alone, so a database part number
    // legitimately equals either. Comparing only against Number would fail every tabbed part.
    const [outcome] = verifyWrite(
      [partNumber],
      document({ Number: 'BR-101010-014', 'Base Item Number': 'BR-101010' }),
    )

    expect(outcome.state).toBe('verified')
  })

  it('is exact after trimming, because a part number differing in case is a different part', () => {
    const [outcome] = verifyWrite([partNumber], document({ Number: 'br-101010' }))

    expect(outcome.state).toBe('failed')
    expect(outcome.reason).toContain('br-101010')
  })

  it('does not accept a property reference as the value', () => {
    // `$PRP:"Number"` renders as something else entirely; counting it as agreement would verify a
    // write against a reference to itself.
    const [outcome] = verifyWrite([partNumber], document({ Number: '$PRP:"Number"' }))

    expect(outcome.state).toBe('failed')
  })
})

describe('a value the file does not hold is failed, not merely unconfirmed', () => {
  it('reports the absence in its own words', () => {
    const [outcome] = verifyWrite([partNumber], document({}))

    expect(outcome.state).toBe('failed')
    expect(outcome.reason).toContain('no value')
  })

  it('names a configuration the file does not have', () => {
    const [outcome] = verifyWrite(
      [
        {
          address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-999' },
          expected: '999',
        },
      ],
      document({}, { Default: {} }),
    )

    expect(outcome.state).toBe('failed')
    expect(outcome.reason).toContain('AS568-999')
  })
})

describe('a clear is verified by the file holding nothing', () => {
  it('accepts a property that is present and empty', () => {
    const [outcome] = verifyWrite(
      [{ address: { scope: 'file', field: 'description' }, expected: '' }],
      document({ Description: '' }),
    )

    expect(outcome.state).toBe('verified')
  })

  it('accepts an absent property too, since the value the app reads next is the same', () => {
    // The product decision is that clearing writes an empty property and leaves it in the file, and
    // the service does not honour that yet - it deletes on empty. Verifying by value keeps this
    // honest about what it can see; the shape is the service's to fix.
    const [outcome] = verifyWrite(
      [{ address: { scope: 'file', field: 'description' }, expected: '' }],
      document({}),
    )

    expect(outcome.state).toBe('verified')
  })

  it('does not accept a clear the file ignored', () => {
    const [outcome] = verifyWrite(
      [{ address: { scope: 'file', field: 'description' }, expected: '' }],
      document({ Description: 'O-ring, NBR 70A' }),
    )

    expect(outcome.state).toBe('failed')
    expect(outcome.reason).toContain('O-ring')
  })
})

describe('a partial write across configurations', () => {
  it('decides each configuration on its own evidence', () => {
    const intents: MetadataWriteIntent[] = [
      {
        address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-014' },
        expected: '014',
      },
      {
        address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-015' },
        expected: '015',
      },
    ]

    const outcomes = verifyWrite(
      intents,
      document(
        {},
        {
          'AS568-014': { 'Tab Number': '014' },
          'AS568-015': { 'Tab Number': '' },
        },
      ),
    )

    expect(outcomes.map((outcome) => outcome.state)).toEqual(['verified', 'failed'])
  })

  it('reads a file-scope field from the configuration it was written into', () => {
    // A multi-configuration part takes its base metadata into the active configuration's bag, so
    // verifying against the document's own bag would fail every base write on such a part.
    const outcomes = verifyWrite(
      [{ ...partNumber, verifyIn: { configuration: 'Default' } }],
      document({}, { Default: { 'Base Item Number': 'BR-101010' } }),
    )

    expect(outcomes[0].state).toBe('verified')
  })

  it('lets a configuration value override the file value it shadows', () => {
    const outcomes = verifyWrite(
      [
        {
          address: {
            scope: 'configuration',
            field: 'config_description',
            configuration: 'AS568-014',
          },
          expected: 'Config title',
        },
      ],
      document({ Description: 'File title' }, { 'AS568-014': { Description: 'Config title' } }),
    )

    expect(outcomes[0].state).toBe('verified')
  })
})

describe('the verdicts a read-back never produced', () => {
  it('marks everything unverified when the file could not be read', () => {
    const outcomes = unverifiedWrite([partNumber], 'the service stopped responding')

    expect(outcomes[0].state).toBe('unverified')
    expect(outcomes[0].reason).toBe('the service stopped responding')
  })

  it('marks everything failed when the write itself was refused', () => {
    const outcomes = failedWrite([partNumber], 'the document is checked out elsewhere')

    expect(outcomes[0].state).toBe('failed')
  })
})
