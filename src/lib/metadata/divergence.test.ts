import { describe, expect, it } from 'vitest'

import {
  classifyPair,
  classifyRecoverability,
  compareOwnedMetadata,
  isPropertyReference,
  readDatabaseMetadata,
  readProperty,
  summarizeDivergence,
  type DatabaseMetadata,
  type FileDivergence,
  type FileIdentity,
  type FileMetadata,
} from './divergence'

const identity: FileIdentity = {
  fileId: 'file-1',
  relativePath: 'Parts/ORING-BUNA-70A.SLDPRT',
  fileName: 'ORING-BUNA-70A.SLDPRT',
  fileType: 'part',
}

function database(overrides: Partial<DatabaseMetadata> = {}): DatabaseMetadata {
  return {
    partNumber: null,
    description: null,
    revision: null,
    configTabs: {},
    configDescriptions: {},
    hasConfigTabsKey: false,
    hasConfigDescriptionsKey: false,
    ...overrides,
  }
}

function file(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    configurations: [],
    fileProperties: {},
    configurationProperties: {},
    ...overrides,
  }
}

describe('isPropertyReference', () => {
  it('rejects a leading $ reference', () => {
    expect(isPropertyReference('$PRP:"Number"')).toBe(true)
    expect(isPropertyReference('$PRPSHEET:"Description"')).toBe(true)
  })

  it('rejects the mass-property shape the ORING fixture carries in Volume and Weight', () => {
    expect(isPropertyReference('"SW-Mass@ORING-BUNA-70A.SLDPRT"')).toBe(false)
    expect(isPropertyReference('SW-PRP:"Mass"')).toBe(true)
    expect(isPropertyReference('prp:"Number"')).toBe(true)
  })

  it('accepts an ordinary value that merely contains a dollar sign', () => {
    expect(isPropertyReference('BR-101$5')).toBe(false)
  })
})

describe('readProperty', () => {
  it('takes the first key in priority order', () => {
    expect(readProperty({ Number: 'BR-100', 'Base Item Number': 'BR-999' }, ['Number', 'Base Item Number'])).toBe(
      'BR-100',
    )
  })

  it('skips a property reference and keeps looking', () => {
    expect(readProperty({ Number: '$PRP:"x"', 'Base Item Number': 'BR-100' }, ['Number', 'Base Item Number'])).toBe(
      'BR-100',
    )
  })

  it('skips a whitespace-only value', () => {
    expect(readProperty({ Description: '   ', Desc: 'O-ring' }, ['Description', 'Desc'])).toBe('O-ring')
  })

  it('returns null when nothing is readable', () => {
    expect(readProperty({ Description: '$PRP:"y"' }, ['Description'])).toBeNull()
  })
})

describe('classifyPair', () => {
  it('reports both-empty when neither side holds anything', () => {
    expect(classifyPair(null, null)).toBe('both-empty')
    expect(classifyPair('  ', '')).toBe('both-empty')
  })

  it('reports file-empty when only the database holds a value', () => {
    expect(classifyPair('BR-100', null)).toBe('file-empty')
  })

  it('reports database-empty when only the file holds a value', () => {
    expect(classifyPair(null, 'BR-100')).toBe('database-empty')
  })

  it('reports agreement on an exact match after trimming', () => {
    expect(classifyPair(' BR-100 ', 'BR-100')).toBe('agrees')
  })

  it('treats a case difference as real divergence', () => {
    expect(classifyPair('br-100', 'BR-100')).toBe('both-set-differ')
  })

  it('accepts a match against any accepted key, so Base Item Number counts', () => {
    // Number carries base+tab, Base Item Number carries the base. The row holds the base.
    expect(classifyPair('BR-100', 'BR-100-265', ['BR-100-265', 'BR-100'])).toBe('agrees')
  })

  it('still reports divergence when no accepted key matches', () => {
    expect(classifyPair('BR-999', 'BR-100-265', ['BR-100-265', 'BR-100'])).toBe('both-set-differ')
  })
})

describe('classifyRecoverability', () => {
  it('calls a value the file still holds recoverable', () => {
    expect(classifyRecoverability('database-empty', false)).toBe('recoverable')
  })

  it('calls a value neither side holds unrecoverable only where metadata was authored', () => {
    expect(classifyRecoverability('both-empty', true)).toBe('unrecoverable')
    expect(classifyRecoverability('both-empty', false)).toBe('no-evidence')
  })

  it('never auto-classifies a genuine conflict as repairable', () => {
    expect(classifyRecoverability('both-set-differ', true)).toBe('disagreeing')
  })

  it('leaves a database-only value intact - the database is the owner', () => {
    expect(classifyRecoverability('file-empty', true)).toBe('intact')
    expect(classifyRecoverability('agrees', true)).toBe('intact')
  })
})

describe('readDatabaseMetadata', () => {
  it('lifts both reserved configuration maps out of custom_properties', () => {
    const result = readDatabaseMetadata({
      part_number: 'BR-100',
      description: 'O-ring',
      revision: 'A',
      custom_properties: {
        _config_tabs: { '265': '265', '277': '277' },
        _config_descriptions: { '265': 'O-ring, NBR 70A' },
        Material: 'Buna-N',
      },
    })

    expect(result.partNumber).toBe('BR-100')
    expect(result.configTabs).toEqual({ '265': '265', '277': '277' })
    expect(result.configDescriptions).toEqual({ '265': 'O-ring, NBR 70A' })
    expect(result.hasConfigTabsKey).toBe(true)
  })

  it('distinguishes an absent map from an empty one', () => {
    const absent = readDatabaseMetadata({
      part_number: null,
      description: null,
      revision: null,
      custom_properties: {},
    })
    expect(absent.hasConfigTabsKey).toBe(false)

    const empty = readDatabaseMetadata({
      part_number: null,
      description: null,
      revision: null,
      custom_properties: { _config_tabs: {} },
    })
    expect(empty.hasConfigTabsKey).toBe(true)
    expect(empty.configTabs).toEqual({})
  })

  it('ignores a reserved key that is not an object of scalars', () => {
    const result = readDatabaseMetadata({
      part_number: null,
      description: null,
      revision: null,
      custom_properties: { _config_tabs: ['265'], _config_descriptions: 'nonsense' },
    })
    expect(result.hasConfigTabsKey).toBe(false)
    expect(result.configTabs).toEqual({})
    expect(result.configDescriptions).toEqual({})
  })

  it('coerces a numeric tab to a string so it can be compared', () => {
    const result = readDatabaseMetadata({
      part_number: null,
      description: null,
      revision: null,
      custom_properties: { _config_tabs: { '265': 265 } },
    })
    expect(result.configTabs).toEqual({ '265': '265' })
  })
})

describe('compareOwnedMetadata - file scope', () => {
  it('agrees when the row matches Base Item Number even though Number carries the tab', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ partNumber: 'BR-100' }),
      file({ fileProperties: { Number: 'BR-100-265', 'Base Item Number': 'BR-100' } }),
    )

    const partNumber = result.fieldComparisons.find((c) => c.field === 'part_number')
    expect(partNumber?.divergence).toBe('agrees')
  })

  it('reports a description the database holds and the file does not', () => {
    const result = compareOwnedMetadata(identity, database({ description: 'O-ring' }), file())

    const description = result.fieldComparisons.find((c) => c.field === 'description')
    expect(description?.divergence).toBe('file-empty')
    expect(description?.recoverability).toBe('intact')
  })

  it('does not let a $PRP placeholder pass as the file value', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ description: 'O-ring' }),
      file({ fileProperties: { Description: '$PRP:"Number"' } }),
    )

    const description = result.fieldComparisons.find((c) => c.field === 'description')
    expect(description?.fileValue).toBeNull()
    expect(description?.divergence).toBe('file-empty')
  })
})

describe('compareOwnedMetadata - configuration scope', () => {
  it('measures how much of the configuration set the database map still describes', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ configTabs: { '265': '265' }, hasConfigTabsKey: true }),
      file({
        configurations: ['265', '277', '333'],
        configurationProperties: {
          '265': { 'Tab Number': '265' },
          '277': { 'Tab Number': '277' },
          '333': { 'Tab Number': '333' },
        },
      }),
    )

    expect(result.coverage.fileConfigurationCount).toBe(3)
    expect(result.coverage.databaseTabKeyCount).toBe(1)
    expect(result.coverage.missingTabConfigurations).toEqual(['277', '333'])
  })

  it('calls a tab the database lost but the file kept recoverable', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ configTabs: { '265': '265' }, hasConfigTabsKey: true }),
      file({
        configurations: ['265', '277'],
        configurationProperties: { '265': { 'Tab Number': '265' }, '277': { 'Tab Number': '277' } },
      }),
    )

    const lost = result.fieldComparisons.find(
      (c) => c.field === 'config_tab' && c.configuration === '277',
    )
    expect(lost?.divergence).toBe('database-empty')
    expect(lost?.recoverability).toBe('recoverable')
  })

  it('calls a tab neither side holds unrecoverable when other configurations were authored', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ configTabs: { '265': '265' }, hasConfigTabsKey: true }),
      file({
        configurations: ['265', '277'],
        configurationProperties: { '265': { 'Tab Number': '265' }, '277': {} },
      }),
    )

    const lost = result.fieldComparisons.find(
      (c) => c.field === 'config_tab' && c.configuration === '277',
    )
    expect(lost?.divergence).toBe('both-empty')
    expect(lost?.recoverability).toBe('unrecoverable')
  })

  it('does not claim a loss on a file that never had per-configuration metadata', () => {
    const result = compareOwnedMetadata(
      identity,
      database(),
      file({ configurations: ['Default'], configurationProperties: { Default: {} } }),
    )

    const tab = result.fieldComparisons.find((c) => c.field === 'config_tab')
    expect(tab?.recoverability).toBe('no-evidence')
  })

  it('reports a configuration description the two sides disagree about, with both values', () => {
    const result = compareOwnedMetadata(
      identity,
      database({
        configDescriptions: { '265': 'O-ring, NBR 70A' },
        hasConfigDescriptionsKey: true,
      }),
      file({
        configurations: ['265'],
        configurationProperties: { '265': { Description: 'O-ring, NBR 70A, Family' } },
      }),
    )

    const description = result.fieldComparisons.find((c) => c.field === 'config_description')
    expect(description?.divergence).toBe('both-set-differ')
    expect(description?.recoverability).toBe('disagreeing')
    expect(description?.databaseValue).toBe('O-ring, NBR 70A')
    expect(description?.fileValue).toBe('O-ring, NBR 70A, Family')
  })

  it('notices a database key with no matching configuration', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ configTabs: { Renamed: '100' }, hasConfigTabsKey: true }),
      file({ configurations: ['Default'], configurationProperties: { Default: {} } }),
    )

    expect(result.coverage.orphanedTabKeys).toEqual(['Renamed'])
  })
})

describe('summarizeDivergence', () => {
  function scanOf(...entries: FileDivergence[]): FileDivergence[] {
    return entries
  }

  const wipedFile = compareOwnedMetadata(
    identity,
    database({ partNumber: 'BR-100', configTabs: { '265': '265' }, hasConfigTabsKey: true }),
    file({
      configurations: ['265', '277', '333'],
      fileProperties: { Number: 'BR-100' },
      configurationProperties: {
        '265': { 'Tab Number': '265' },
        '277': { 'Tab Number': '277' },
        '333': {},
      },
    }),
  )

  const cleanFile = compareOwnedMetadata(
    { ...identity, fileId: 'file-2', relativePath: 'Parts/BRACKET.SLDPRT' },
    database({ partNumber: 'BR-200' }),
    file({
      configurations: ['Default'],
      fileProperties: { Number: 'BR-200' },
      configurationProperties: { Default: {} },
    }),
  )

  it('counts a truncated configuration map only where the map already held entries', () => {
    const summary = summarizeDivergence(scanOf(wipedFile, cleanFile))

    expect(summary.filesCompared).toBe(2)
    expect(summary.filesWithTruncatedConfigMap).toBe(1)
    expect(summary.truncatedConfigMaps[0]?.missingTabCount).toBe(2)
    expect(summary.truncatedConfigMaps[0]?.fileConfigurationCount).toBe(3)
  })

  it('separates the value the file kept from the value nobody kept', () => {
    const summary = summarizeDivergence(scanOf(wipedFile))

    // '277' survives in the file; '333' survives nowhere.
    expect(summary.recoverableValues).toBe(1)
    expect(summary.unrecoverableValues).toBe(1)
    expect(summary.unrecoverable[0]?.configuration).toBe('333')
    expect(summary.unrecoverable[0]?.field).toBe('config_tab')
  })

  it('names the file every unrecoverable value belongs to', () => {
    const summary = summarizeDivergence(scanOf(wipedFile))
    expect(summary.unrecoverable[0]?.relativePath).toBe('Parts/ORING-BUNA-70A.SLDPRT')
  })

  it('tallies each field separately rather than only in aggregate', () => {
    const summary = summarizeDivergence(scanOf(wipedFile, cleanFile))

    const configTab = summary.fieldTallies.find(
      (t) => t.field === 'config_tab' && t.scope === 'configuration',
    )
    expect(configTab?.compared).toBe(4)
    expect(configTab?.agrees).toBe(1)
    expect(configTab?.databaseEmpty).toBe(1)

    const partNumber = summary.fieldTallies.find((t) => t.field === 'part_number')
    expect(partNumber?.compared).toBe(2)
    expect(partNumber?.agrees).toBe(2)
  })

  it('counts a file once however many of its fields diverge', () => {
    const summary = summarizeDivergence(scanOf(wipedFile, cleanFile))
    expect(summary.filesWithAnyDivergence).toBe(1)
    expect(summary.filesWithMultipleConfigurations).toBe(1)
  })

  it('produces an empty summary for an empty scan rather than throwing', () => {
    const summary = summarizeDivergence([])
    expect(summary.filesCompared).toBe(0)
    expect(summary.fieldTallies).toEqual([])
    expect(summary.unrecoverable).toEqual([])
  })
})
