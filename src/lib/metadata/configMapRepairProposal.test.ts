import { describe, expect, it } from 'vitest'

import {
  buildRepairCandidates,
  summarizeCandidates,
  toRepairRequest,
} from './configMapRepairProposal'
import {
  compareOwnedMetadata,
  CONFIG_DESCRIPTIONS_KEY,
  CONFIG_TABS_KEY,
  type ComparedFileType,
  type DatabaseMetadata,
  type FileDivergence,
  type FileMetadata,
} from './divergence'

// ============================================
// Fixtures
// ============================================

function rowOf(overrides: Partial<DatabaseMetadata> = {}): DatabaseMetadata {
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

function compare(
  fileName: string,
  database: DatabaseMetadata,
  file: FileMetadata,
  fileType: ComparedFileType = 'part',
): FileDivergence {
  return compareOwnedMetadata(
    {
      fileId: fileName,
      relativePath: `0 - SHARED\\01-TOOLBOX\\${fileName}`,
      fileName,
      fileType,
    },
    database,
    file,
  )
}

/**
 * The wipe, in miniature: the row carries both maps and one surviving entry, and the document
 * still holds the values for every configuration under the keys BluePLM writes.
 */
function wiped(): FileDivergence {
  return compare(
    'BRACKET.SLDPRT',
    rowOf({
      configTabs: { Short: '-001' },
      configDescriptions: {},
      hasConfigTabsKey: true,
      hasConfigDescriptionsKey: true,
    }),
    {
      configurations: ['Short', 'Long'],
      fileProperties: {},
      configurationProperties: {
        Short: { 'Tab Number': '-001', Description: 'Short bracket' },
        Long: { 'Tab Number': '-002', Description: 'Long bracket' },
      },
    },
  )
}

/**
 * The trap. Fifteen configurations against a record holding twenty-six keys: every configuration
 * is described and eleven keys name configurations that have since gone. Intact by name, damaged
 * only by count.
 */
function oringFkm(): FileDivergence {
  const real = ['-010', '-037', '1X2.5', '1.5X34', '2.0X18']
  const departed = ['-006', '-008', '-012']

  const tabs: Record<string, string> = {}
  const configurationProperties: Record<string, Record<string, string>> = {}
  for (const name of [...real, ...departed]) tabs[name] = name
  for (const name of real) configurationProperties[name] = { 'Tab Number': name }

  return compare(
    'ORING-FKM-75A.SLDPRT',
    rowOf({ configTabs: tabs, hasConfigTabsKey: true }),
    { configurations: real, fileProperties: {}, configurationProperties },
  )
}

// ============================================
// Tests
// ============================================

describe('buildRepairCandidates', () => {
  it('proposes the entries the record is missing, and no others', () => {
    const candidates = buildRepairCandidates([wiped()])

    expect(candidates.map((candidate) => `${candidate.field}:${candidate.configuration}`)).toEqual([
      'config_description:Short',
      'config_tab:Long',
      'config_description:Long',
    ])
    expect(candidates.every((candidate) => candidate.provenance === 'recovered')).toBe(true)
  })

  it('leaves an entry the record already holds alone, whatever the document says', () => {
    const candidates = buildRepairCandidates([wiped()])

    expect(
      candidates.some(
        (candidate) => candidate.field === 'config_tab' && candidate.configuration === 'Short',
      ),
    ).toBe(false)
  })

  // Presence of the key, not readability of the value. A cleared entry is a decision someone made.
  it('does not refill an entry someone deliberately cleared', () => {
    const file = compare(
      'CLEARED.SLDPRT',
      rowOf({ configTabs: { Only: '' }, hasConfigTabsKey: true }),
      {
        configurations: ['Only'],
        fileProperties: {},
        configurationProperties: { Only: { 'Tab Number': '-009' } },
      },
    )

    expect(buildRepairCandidates([file])).toEqual([])
  })

  it('proposes nothing for a record that is intact by name and short only by count', () => {
    expect(buildRepairCandidates([oringFkm()])).toEqual([])
  })

  it('never proposes a key for a configuration the file no longer has', () => {
    const candidates = buildRepairCandidates([oringFkm(), wiped()])
    const configurations = candidates.map((candidate) => candidate.configuration)

    expect(configurations).not.toContain('-006')
    expect(configurations).not.toContain('-008')
    expect(configurations).not.toContain('-012')
  })

  it('proposes nothing for a row that never carried a map', () => {
    const file = compare('WASHER.SLDPRT', rowOf(), {
      configurations: ['Default'],
      fileProperties: {},
      configurationProperties: { Default: { 'Tab Number': '-001', Description: 'Washer' } },
    })

    expect(buildRepairCandidates([file])).toEqual([])
  })

  it("proposes nothing for a drawing, whose configuration fields are its parent model's", () => {
    const file = compare(
      'BRACKET.SLDDRW',
      rowOf({ configTabs: {}, hasConfigTabsKey: true, hasConfigDescriptionsKey: true }),
      {
        configurations: ['Sheet1'],
        fileProperties: {},
        configurationProperties: { Sheet1: { 'Tab Number': '-001', Description: 'A sheet' } },
      },
      'drawing',
    )

    expect(buildRepairCandidates([file])).toEqual([])
  })
})

describe('derived tabs', () => {
  /** Neither side holds a tab, but the configuration's own `Number` implies one. */
  function derivableOnly(): FileDivergence {
    return compare(
      'SPACER.SLDPRT',
      rowOf({ configTabs: {}, hasConfigTabsKey: true }),
      {
        configurations: ['Thin'],
        fileProperties: { Number: 'PN-500-999' },
        configurationProperties: { Thin: { Number: 'PN-500-014' } },
      },
    )
  }

  it('are not offered unless they are asked for', () => {
    expect(buildRepairCandidates([derivableOnly()])).toEqual([])
  })

  it('are offered on request, and say what they are', () => {
    const candidates = buildRepairCandidates([derivableOnly()], { includeDerivedTabs: true })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].value).toBe('014')
    expect(candidates[0].provenance).toBe('derived')
  })

  // Resolving would fall back to the file-level `Number` and hand every configuration the family's
  // tab, which is not that configuration's tab at all.
  it("read the configuration's own Number, never the one showing through from file level", () => {
    const file = compare(
      'SPACER.SLDPRT',
      rowOf({ configTabs: {}, hasConfigTabsKey: true }),
      {
        configurations: ['Thin'],
        fileProperties: { Number: 'PN-500-999' },
        configurationProperties: { Thin: {} },
      },
    )

    expect(buildRepairCandidates([file], { includeDerivedTabs: true })).toEqual([])
  })

  it('never displace a value that can actually be recovered', () => {
    const candidates = buildRepairCandidates([wiped()], { includeDerivedTabs: true })

    expect(candidates.every((candidate) => candidate.provenance === 'recovered')).toBe(true)
  })
})

describe('toRepairRequest', () => {
  it('folds the approved entries into one merge per file, keyed by reserved map', () => {
    const request = toRepairRequest(buildRepairCandidates([wiped()]))

    expect(request).toHaveLength(1)
    expect(request[0].fileId).toBe('BRACKET.SLDPRT')
    expect(request[0].maps[CONFIG_TABS_KEY]).toEqual({ Long: '-002' })
    expect(request[0].maps[CONFIG_DESCRIPTIONS_KEY]).toEqual({
      Short: 'Short bracket',
      Long: 'Long bracket',
    })
  })

  it('sends only what was approved', () => {
    const candidates = buildRepairCandidates([wiped()])
    const oneOnly = candidates.filter((candidate) => candidate.configuration === 'Long')
    const request = toRepairRequest(oneOnly)

    expect(request[0].maps[CONFIG_TABS_KEY]).toEqual({ Long: '-002' })
    expect(request[0].maps[CONFIG_DESCRIPTIONS_KEY]).toEqual({ Long: 'Long bracket' })
  })

  it('produces nothing from nothing', () => {
    expect(toRepairRequest([])).toEqual([])
  })
})

describe('summarizeCandidates', () => {
  it('counts files once and keeps the two provenances apart', () => {
    const candidates = [
      ...buildRepairCandidates([wiped()]),
      ...buildRepairCandidates(
        [
          compare('SPACER.SLDPRT', rowOf({ configTabs: {}, hasConfigTabsKey: true }), {
            configurations: ['Thin'],
            fileProperties: {},
            configurationProperties: { Thin: { Number: 'PN-500-014' } },
          }),
        ],
        { includeDerivedTabs: true },
      ),
    ]

    expect(summarizeCandidates(candidates)).toEqual({
      files: 2,
      entries: 4,
      recovered: 3,
      derived: 1,
    })
  })
})
