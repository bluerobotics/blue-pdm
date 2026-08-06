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

import {
  compareOwnedMetadata,
  configurationScopeProperties,
  resolvedConfigurationProperties,
  type FileMetadata,
} from './divergence'
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

  it('reads a file-scope field from the document, not from a configuration holding a copy', () => {
    // The plan writes a file-scope field into the document's own bag and copies it into the
    // configurations, so the copy is not the evidence. An intent used to be able to name the
    // configuration as the place to look, and a document whose own bag was never written reported
    // `verified` off the copy while a `$PRP:` title block rendered the old value.
    const outcomes = verifyWrite(
      [partNumber],
      document({}, { Default: { 'Base Item Number': 'BR-101010' } }),
    )

    expect(outcomes[0].state).toBe('failed')
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

describe('a configuration is judged on its own bag, not on the document underneath it', () => {
  // `scopeProperties` used to spread the file bag underneath the configuration's as a fallback,
  // on the argument that it matched how the configuration loader reads a value for display. What a
  // reader resolves and what a write established are different questions, and the fallback got
  // both of these wrong.

  it('does not verify a configuration write off a value the document holds at file level', () => {
    // An empty configuration bag means nothing landed there, however familiar the string sitting
    // at file level looks. Read through the fallback this reported `verified`, the one state a
    // retry skips and check-in forgets, while the configuration's composite `Number` was never
    // written and the title block stayed wrong.
    const outcomes = verifyWrite(
      [
        {
          address: { scope: 'configuration', field: 'config_tab', configuration: 'Default' },
          expected: '014',
        },
        {
          address: {
            scope: 'configuration',
            field: 'config_description',
            configuration: 'Default',
          },
          expected: 'O-ring, NBR 70A',
        },
      ],
      document({ 'Tab Number': '014', Description: 'O-ring, NBR 70A' }, { Default: {} }),
    )

    expect(outcomes.map((outcome) => outcome.state)).toEqual(['failed', 'failed'])
    expect(outcomes[0].reason).toContain('no value')
  })

  it('verifies a per-configuration clear on a document that keeps a file-level value', () => {
    // Clearing one configuration's description means "fall back to the file's", so the file-level
    // value surviving is the point rather than the failure. Read through the fallback it looked
    // like a value that refused to go, which failed permanently: every check-in re-issued the
    // write, paid for the read-back, failed again and promoted the value unconfirmed.
    const outcomes = verifyWrite(
      [
        {
          address: {
            scope: 'configuration',
            field: 'config_description',
            configuration: 'Default',
          },
          expected: '',
        },
      ],
      document({ Description: 'A file-level description' }, { Default: {} }),
    )

    expect(outcomes[0].state).toBe('verified')
  })

  it('verifies that clear the same way once the service writes empty properties instead of deleting', () => {
    // `.cursor/plans/service-empty-property-write.plan.md` changes the shape the service leaves
    // behind, not the value. Both shapes have to read the same or the plan would silently change
    // what verification means.
    const outcomes = verifyWrite(
      [
        {
          address: {
            scope: 'configuration',
            field: 'config_description',
            configuration: 'Default',
          },
          expected: '',
        },
      ],
      document({ Description: 'A file-level description' }, { Default: { Description: '' } }),
    )

    expect(outcomes[0].state).toBe('verified')
  })
})

describe('the scanner and the verifier mean the same thing by "configuration scope"', () => {
  // They disagreed: the scanner read `configurationProperties[name]` and the verifier read that
  // over the file bag, so the same document could be reported as diverged by one and confirmed by
  // the other. `divergence.ts` owns the definition now and both take it from there.

  const readBack = document({ Description: 'A file-level description' }, { Default: {} })

  it('agrees the configuration holds nothing', () => {
    expect(configurationScopeProperties(readBack, 'Default')).toEqual({})

    const [outcome] = verifyWrite(
      [
        {
          address: {
            scope: 'configuration',
            field: 'config_description',
            configuration: 'Default',
          },
          expected: 'A file-level description',
        },
      ],
      readBack,
    )
    expect(outcome.state).toBe('failed')

    const [, comparison] = compareOwnedMetadata(
      { fileId: 'f', relativePath: 'ring.sldprt', fileName: 'ring.sldprt', fileType: 'part' },
      {
        partNumber: null,
        description: null,
        revision: null,
        configTabs: {},
        configDescriptions: { Default: 'A file-level description' },
        hasConfigTabsKey: false,
        hasConfigDescriptionsKey: true,
      },
      readBack,
    ).fieldComparisons.filter((entry) => entry.scope === 'configuration')

    expect(comparison.field).toBe('config_description')
    expect(comparison.fileValue).toBeNull()
  })

  it('keeps the resolved view available for display, under a name nobody will confuse', () => {
    // What SolidWorks shows for the configuration, and what the browser's configuration loader
    // reads. Correct for display, wrong for deciding whether a write landed.
    expect(resolvedConfigurationProperties(readBack, 'Default')).toEqual({
      Description: 'A file-level description',
    })
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
