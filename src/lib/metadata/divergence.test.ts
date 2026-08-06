import { describe, expect, it } from 'vitest'

import {
  classifyPair,
  classifyRecoverability,
  compareOwnedMetadata,
  configurationScopeProperties,
  isPropertyReference,
  ownerOf,
  readCanonicalProperty,
  readDatabaseMetadata,
  readProperty,
  resolvedConfigurationProperties,
  resolvedPropertyView,
  summarizeDivergence,
  type DatabaseMetadata,
  type FileDivergence,
  type FileIdentity,
  type FileMetadata,
  type RecoveryContext,
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

function context(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    owner: 'database',
    databaseEverHeldField: false,
    repairValue: 'something',
    ...overrides,
  }
}

/** Every configuration of a part whose configurations all carry the same properties. */
function configurationsAll(
  names: readonly string[],
  properties: Record<string, string>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(names.map((name) => [name, properties]))
}

describe('the two views of a configuration, and the one rule under both', () => {
  // The split was declared complete while `resolvedConfigurationProperties` had no production
  // caller at all: every display reader spread the two bags by hand, so nothing forced the choice
  // and nothing kept the two definitions the same. Both exports now come from one rule.
  const document = file({
    configurations: ['Default', 'AS568-014'],
    fileProperties: { Description: 'O-ring', Number: 'BR-202020' },
    configurationProperties: { Default: {}, 'AS568-014': { Description: '' } },
  })

  it('shows the file-level value through a configuration that holds no property of its own', () => {
    expect(resolvedConfigurationProperties(document, 'Default')).toEqual({
      Description: 'O-ring',
      Number: 'BR-202020',
    })
  })

  it('shows a deliberately emptied configuration description as empty, not as the file’s', () => {
    expect(resolvedConfigurationProperties(document, 'AS568-014')).toMatchObject({
      Description: '',
      Number: 'BR-202020',
    })
  })

  it('keeps the scope view literal, which is what a write is judged against', () => {
    expect(configurationScopeProperties(document, 'Default')).toEqual({})
  })

  it('resolves the same way for a caller holding the two bags rather than the document', () => {
    expect(resolvedPropertyView(document.fileProperties, { Description: '' })).toEqual(
      resolvedConfigurationProperties(document, 'AS568-014'),
    )
  })
})

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
    expect(
      readProperty({ Number: 'BR-100', 'Base Item Number': 'BR-999' }, [
        'Number',
        'Base Item Number',
      ]),
    ).toBe('BR-100')
  })

  it('skips a property reference and keeps looking', () => {
    expect(
      readProperty({ Number: '$PRP:"x"', 'Base Item Number': 'BR-100' }, [
        'Number',
        'Base Item Number',
      ]),
    ).toBe('BR-100')
  })

  it('skips a whitespace-only value', () => {
    expect(readProperty({ Description: '   ', Desc: 'O-ring' }, ['Description', 'Desc'])).toBe(
      'O-ring',
    )
  })

  it('returns null when nothing is readable', () => {
    expect(readProperty({ Description: '$PRP:"y"' }, ['Description'])).toBeNull()
  })
})

describe('readCanonicalProperty', () => {
  it('reads only the key BluePLM writes, whatever the read priority would have taken', () => {
    const properties = { Number: 'BR-100-265', 'Base Item Number': 'BR-100' }
    expect(readCanonicalProperty(properties, ['Base Item Number'])).toBe('BR-100')
  })

  it('matches the case SolidWorks happens to have stored the property under', () => {
    expect(readCanonicalProperty({ DESCRIPTION: 'O-ring' }, ['Description'])).toBe('O-ring')
  })

  it('refuses a near-miss key, so Title and Desc are not descriptions BluePLM may write back', () => {
    expect(readCanonicalProperty({ Title: 'O-ring', Desc: 'O-ring' }, ['Description'])).toBeNull()
  })

  it('refuses a property reference', () => {
    expect(readCanonicalProperty({ Description: '$PRP:"Number"' }, ['Description'])).toBeNull()
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

  it('does not report two copies of the same string as a conflict', () => {
    // The value was read under a key outside the accepted set. It is still the same value.
    expect(classifyPair('BR-100', 'BR-100', [])).toBe('agrees')
  })
})

describe('classifyRecoverability', () => {
  it('calls a value the file kept recoverable only where the database once held the field', () => {
    expect(
      classifyRecoverability('database-empty', context({ databaseEverHeldField: true })),
    ).toEqual({ recoverability: 'recoverable' })

    expect(
      classifyRecoverability('database-empty', context({ databaseEverHeldField: false })),
    ).toEqual({
      recoverability: 'unattributed',
      unattributedReason: 'database-never-held-it',
    })
  })

  it('refuses to name a repair value it cannot read from a key BluePLM writes', () => {
    expect(
      classifyRecoverability(
        'database-empty',
        context({ databaseEverHeldField: true, repairValue: null }),
      ),
    ).toEqual({
      recoverability: 'unattributed',
      unattributedReason: 'no-transcribable-value',
    })
  })

  it('never promotes a value the ownership table gives to another row', () => {
    expect(
      classifyRecoverability(
        'database-empty',
        context({ owner: 'parent-model', databaseEverHeldField: true }),
      ),
    ).toEqual({
      recoverability: 'unattributed',
      unattributedReason: 'not-database-owned',
    })
  })

  it('lets the database adopt a value the file owns', () => {
    expect(classifyRecoverability('database-empty', context({ owner: 'file' }))).toEqual({
      recoverability: 'recoverable',
    })
  })

  it('calls a value neither side holds unrecoverable only where the database once held it', () => {
    expect(classifyRecoverability('both-empty', context({ databaseEverHeldField: true }))).toEqual({
      recoverability: 'unrecoverable',
    })

    expect(classifyRecoverability('both-empty', context({ databaseEverHeldField: false }))).toEqual(
      { recoverability: 'no-evidence' },
    )
  })

  it('never auto-classifies a genuine conflict as repairable', () => {
    expect(classifyRecoverability('both-set-differ', context())).toEqual({
      recoverability: 'disagreeing',
    })
  })

  it('leaves a database-only value intact - the database is the owner', () => {
    expect(classifyRecoverability('file-empty', context())).toEqual({ recoverability: 'intact' })
    expect(classifyRecoverability('agrees', context())).toEqual({ recoverability: 'intact' })
  })
})

describe('ownerOf', () => {
  it('gives every owned field on a model to the database', () => {
    expect(ownerOf('part_number', 'part')).toBe('database')
    expect(ownerOf('revision', 'assembly')).toBe('database')
    expect(ownerOf('config_description', 'part')).toBe('database')
  })

  it("gives a drawing's revision to the drawing and its part number to the parent model", () => {
    expect(ownerOf('revision', 'drawing')).toBe('file')
    expect(ownerOf('part_number', 'drawing')).toBe('parent-model')
    expect(ownerOf('description', 'drawing')).toBe('parent-model')
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
  })

  it('ignores a reserved key that is not an object of scalars', () => {
    const result = readDatabaseMetadata({
      part_number: null,
      description: null,
      revision: null,
      custom_properties: { _config_tabs: ['265'], _config_descriptions: 'nonsense' },
    })
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

  it('records the base as the part number a repair may write, never the base-plus-tab form', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ partNumber: 'BR-999' }),
      file({ fileProperties: { Number: 'BR-100-265', 'Base Item Number': 'BR-100' } }),
    )

    const partNumber = result.fieldComparisons.find((c) => c.field === 'part_number')
    // What the file reads as, under the read priority, is the composite.
    expect(partNumber?.fileValue).toBe('BR-100-265')
    // What may be written into files.part_number, which holds the base, is not.
    expect(partNumber?.databaseRepairValue).toBe('BR-100')
  })

  it('names no repair value when only the composite is in the file', () => {
    const result = compareOwnedMetadata(
      identity,
      database(),
      file({ fileProperties: { Number: 'BR-100-265' } }),
    )

    const partNumber = result.fieldComparisons.find((c) => c.field === 'part_number')
    expect(partNumber?.fileValue).toBe('BR-100-265')
    expect(partNumber?.databaseRepairValue).toBeNull()
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

  it('does not report the same value under an unexpected key as a conflict', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ partNumber: 'BR-100' }),
      file({ fileProperties: { PartNumber: 'BR-100' } }),
    )

    const partNumber = result.fieldComparisons.find((c) => c.field === 'part_number')
    expect(partNumber?.divergence).toBe('agrees')
  })

  it('will not adopt a file-scope value into a column the database never filled in', () => {
    // No mechanism empties a column, so an empty column is not a loss - it is a value BluePLM
    // never had, and someone typed into SolidWorks. That is a decision, not a repair.
    const result = compareOwnedMetadata(
      identity,
      database(),
      file({ fileProperties: { 'Base Item Number': 'BR-100', Description: 'O-ring' } }),
    )

    const partNumber = result.fieldComparisons.find((c) => c.field === 'part_number')
    expect(partNumber?.divergence).toBe('database-empty')
    expect(partNumber?.recoverability).toBe('unattributed')
    expect(partNumber?.unattributedReason).toBe('database-never-held-it')

    const description = result.fieldComparisons.find((c) => c.field === 'description')
    expect(description?.recoverability).toBe('unattributed')
  })
})

describe('compareOwnedMetadata - drawings', () => {
  const drawing: FileIdentity = {
    fileId: 'file-drw',
    relativePath: 'Drawings/BR-100.SLDDRW',
    fileName: 'BR-100.SLDDRW',
    fileType: 'drawing',
  }

  it("adopts a drawing's own revision, which the drawing owns", () => {
    const result = compareOwnedMetadata(
      drawing,
      database(),
      file({ fileProperties: { Revision: 'B' } }),
    )

    const revision = result.fieldComparisons.find((c) => c.field === 'revision')
    expect(revision?.recoverability).toBe('recoverable')
  })

  it("never adopts a drawing's part number, which belongs to its parent model", () => {
    const result = compareOwnedMetadata(
      drawing,
      database(),
      file({ fileProperties: { 'Base Item Number': 'BR-100', Description: 'O-ring' } }),
    )

    const partNumber = result.fieldComparisons.find((c) => c.field === 'part_number')
    expect(partNumber?.recoverability).toBe('unattributed')
    expect(partNumber?.unattributedReason).toBe('not-database-owned')

    const description = result.fieldComparisons.find((c) => c.field === 'description')
    expect(description?.unattributedReason).toBe('not-database-owned')
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
    expect(result.coverage.databaseHasTabMap).toBe(true)
    expect(result.coverage.databaseTabKeyCount).toBe(1)
    expect(result.coverage.missingTabConfigurations).toEqual(['277', '333'])
  })

  it('counts a map entry that holds nothing as describing nothing', () => {
    const result = compareOwnedMetadata(
      identity,
      database({ configTabs: { '265': '  ' }, hasConfigTabsKey: true }),
      file({ configurations: ['265'], configurationProperties: { '265': {} } }),
    )

    expect(result.coverage.missingTabConfigurations).toEqual(['265'])
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
    expect(lost?.databaseRepairValue).toBe('277')
  })

  it('calls a tab neither side holds unrecoverable when the row carries the map', () => {
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

  it('will not write a Suffix into the tab map, whatever the map says', () => {
    // Suffix reads as a tab so that a match is not reported as divergence. It is not a value
    // BluePLM wrote, so it is not a value BluePLM may write back.
    const result = compareOwnedMetadata(
      identity,
      database({ configTabs: { '265': '265' }, hasConfigTabsKey: true }),
      file({
        configurations: ['265', '277'],
        configurationProperties: { '265': { 'Tab Number': '265' }, '277': { Suffix: '277' } },
      }),
    )

    const lost = result.fieldComparisons.find(
      (c) => c.field === 'config_tab' && c.configuration === '277',
    )
    expect(lost?.fileValue).toBe('277')
    expect(lost?.databaseRepairValue).toBeNull()
    expect(lost?.recoverability).toBe('unattributed')
    expect(lost?.unattributedReason).toBe('no-transcribable-value')
  })
})

describe('a file that never used the reserved maps', () => {
  // SolidWorks configurations routinely carry Description for reasons that have nothing to do
  // with BluePLM. On a row with no _config_descriptions key, every one of them used to report as
  // recoverable, and a repair phase acting on that would have written 68 file properties into a
  // map BluePLM never owned.
  const configurations = ['AS568-001', 'AS568-002', 'AS568-003']

  const scanned = compareOwnedMetadata(
    identity,
    database(),
    file({
      configurations,
      configurationProperties: configurationsAll(configurations, {
        Description: 'O-ring, NBR 70A',
        Suffix: '001',
      }),
    }),
  )

  it('reports nothing on it as recoverable', () => {
    const summary = summarizeDivergence([scanned])
    expect(summary.recoverableValues).toBe(0)
  })

  it('reports each configuration value as unattributed, saying the database never held it', () => {
    const descriptions = scanned.fieldComparisons.filter((c) => c.field === 'config_description')
    expect(descriptions).toHaveLength(configurations.length)
    for (const description of descriptions) {
      expect(description.divergence).toBe('database-empty')
      expect(description.recoverability).toBe('unattributed')
      expect(description.unattributedReason).toBe('database-never-held-it')
    }
  })

  it('leaves it out of the configuration-map wipe entirely', () => {
    const summary = summarizeDivergence([scanned])
    expect(summary.filesWithTruncatedConfigMap).toBe(0)
    expect(summary.totalMissingConfigurationEntries).toBe(0)
    expect(summary.filesWithNoConfigMap).toBe(1)
  })
})

describe('the reserved map key, absent versus emptied', () => {
  const configurations = ['AS568-001', 'AS568-002', 'AS568-003']

  /** The shape a check-in that sent an empty edit set left behind: the key, and nothing in it. */
  const emptied = readDatabaseMetadata({
    part_number: null,
    description: null,
    revision: null,
    custom_properties: { _config_tabs: {} },
  })

  /** The shape of a file that never used the map at all. */
  const absent = readDatabaseMetadata({
    part_number: null,
    description: null,
    revision: null,
    custom_properties: {},
  })

  const documentWithTabs = file({
    configurations,
    configurationProperties: {
      'AS568-001': { 'Tab Number': '001' },
      'AS568-002': { 'Tab Number': '002' },
      'AS568-003': { 'Tab Number': '003' },
    },
  })

  const documentWithNothing = file({
    configurations,
    configurationProperties: configurationsAll(configurations, {}),
  })

  it('recovers every configuration from the file when the map was emptied', () => {
    const summary = summarizeDivergence([compareOwnedMetadata(identity, emptied, documentWithTabs)])
    expect(summary.recoverableValues).toBe(configurations.length)
    expect(summary.unattributedValues).toBe(0)
  })

  it('adopts nothing when the map was never there', () => {
    const summary = summarizeDivergence([compareOwnedMetadata(identity, absent, documentWithTabs)])
    expect(summary.recoverableValues).toBe(0)
    expect(summary.unattributedValues).toBe(configurations.length)
  })

  it('reports a wipe of every configuration as a loss rather than as no loss at all', () => {
    // The 0-of-3 shape. It used to classify as no-evidence and stay out of the wipe count, so
    // the more complete the wipe the more likely it reported as nothing having happened.
    const summary = summarizeDivergence([
      compareOwnedMetadata(identity, emptied, documentWithNothing),
    ])

    expect(summary.unrecoverableValues).toBe(configurations.length)
    // The three file-scope columns and the untouched description map: empty on both sides, with
    // no map to suggest anything was ever there.
    expect(summary.noEvidenceValues).toBe(3 + configurations.length)
    expect(summary.filesWithTruncatedConfigMap).toBe(1)
    expect(summary.truncatedConfigMaps[0]?.databaseTabKeyCount).toBe(0)
    expect(summary.truncatedConfigMaps[0]?.missingTabCount).toBe(configurations.length)
    expect(summary.truncatedConfigMaps[0]?.tabMapEmptied).toBe(true)
  })

  it('reports nothing at all when the map was never there and neither side has a value', () => {
    const summary = summarizeDivergence([
      compareOwnedMetadata(identity, absent, documentWithNothing),
    ])

    expect(summary.unrecoverableValues).toBe(0)
    expect(summary.filesWithTruncatedConfigMap).toBe(0)
    expect(summary.filesWithAnyDivergence).toBe(0)
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

  it('counts a truncated configuration map only where the row carries the map', () => {
    const summary = summarizeDivergence(scanOf(wipedFile, cleanFile))

    expect(summary.filesCompared).toBe(2)
    expect(summary.filesWithTruncatedConfigMap).toBe(1)
    expect(summary.truncatedConfigMaps[0]?.missingTabCount).toBe(2)
    expect(summary.truncatedConfigMaps[0]?.fileConfigurationCount).toBe(3)
    expect(summary.totalMissingConfigurationEntries).toBe(2)
    expect(summary.filesWithNoConfigMap).toBe(1)
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

  it('records what a repair may write next to each value it could not attribute', () => {
    const unowned = compareOwnedMetadata(
      identity,
      database(),
      file({
        configurations: ['265'],
        configurationProperties: { '265': { Description: 'O-ring', Suffix: '265' } },
      }),
    )

    const summary = summarizeDivergence(scanOf(unowned))
    const description = summary.unattributed.find((v) => v.field === 'config_description')
    expect(description?.fileValue).toBe('O-ring')
    expect(description?.repairValue).toBe('O-ring')
    expect(description?.reason).toBe('database-never-held-it')

    const tab = summary.unattributed.find((v) => v.field === 'config_tab')
    expect(tab?.fileValue).toBe('265')
    expect(tab?.repairValue).toBeNull()
    expect(tab?.reason).toBe('no-transcribable-value')
  })

  it('never calls a value recoverable without saying what would be written', () => {
    const everything = scanOf(
      wipedFile,
      cleanFile,
      compareOwnedMetadata(
        identity,
        database({ hasConfigDescriptionsKey: true }),
        file({
          configurations: ['265', '277'],
          fileProperties: { Number: 'BR-100-265', 'Base Item Number': 'BR-100' },
          configurationProperties: {
            '265': { Description: 'O-ring', Suffix: '265' },
            '277': { Title: 'O-ring' },
          },
        }),
      ),
    )

    for (const scanned of everything) {
      for (const comparison of scanned.fieldComparisons) {
        if (comparison.recoverability !== 'recoverable') continue
        expect(comparison.databaseRepairValue).not.toBeNull()
      }
    }
  })

  it('produces an empty summary for an empty scan rather than throwing', () => {
    const summary = summarizeDivergence([])
    expect(summary.filesCompared).toBe(0)
    expect(summary.fieldTallies).toEqual([])
    expect(summary.unrecoverable).toEqual([])
    expect(summary.unattributed).toEqual([])
  })
})
