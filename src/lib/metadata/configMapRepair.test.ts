import { describe, expect, it } from 'vitest'

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'
import {
  DEFAULT_REPAIR_OPTIONS,
  deriveTabFromNumber,
  fillGapsOnly,
  fillIsAdditive,
  gapsOnly,
  planConfigMapRepair,
  planFileRepair,
  proposedMap,
  type CensusDocument,
  type ConfigMapShapeRow,
  type MapShape,
  type RepairOptions,
} from './configMapRepair'

// ============================================
// Fixtures
// ============================================

function row(overrides: Partial<ConfigMapShapeRow> = {}): ConfigMapShapeRow {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    filePath: '0 - SHARED\\01-TOOLBOX\\ORING-BUNA-70A.SLDPRT',
    fileName: 'ORING-BUNA-70A.SLDPRT',
    shapes: { [CONFIG_TABS_KEY]: 'present', [CONFIG_DESCRIPTIONS_KEY]: 'present' },
    keys: { [CONFIG_TABS_KEY]: [], [CONFIG_DESCRIPTIONS_KEY]: [] },
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function shapes(tabs: MapShape, descriptions: MapShape): ConfigMapShapeRow['shapes'] {
  return { [CONFIG_TABS_KEY]: tabs, [CONFIG_DESCRIPTIONS_KEY]: descriptions }
}

function keys(tabs: string[], descriptions: string[]): ConfigMapShapeRow['keys'] {
  return { [CONFIG_TABS_KEY]: tabs, [CONFIG_DESCRIPTIONS_KEY]: descriptions }
}

/**
 * A slice of the real `ORING-BUNA-70A.SLDPRT` as the Document Manager census measured it: a
 * configuration whose description is its own, one whose description repeats the family's, and one
 * carrying no tab of its own at all.
 */
const oring: CensusDocument = {
  relativePath: '0 - SHARED\\01-TOOLBOX\\ORING-BUNA-70A.SLDPRT',
  absolutePath: 'C:\\BluePLM\\br-vault\\0 - SHARED\\01-TOOLBOX\\ORING-BUNA-70A.SLDPRT',
  configurations: ['-013', '-019', 'XXX'],
  fileProperties: {
    Number: 'BR-100635-XXX',
    'Base Item Number': 'BR-100635-XXX',
    'Tab Number': '-XXX',
    Description: 'O-ring, NBR 70A, Family',
    Weight: '"SW-Mass@ORING-BUNA-70A.SLDPRT"',
  },
  configurationProperties: {
    '-013': {
      Description: 'O-ring, NBR 70A, Blue, -013',
      Number: 'BR-100635-13',
      'Tab Number': '13',
    },
    '-019': {
      Description: 'O-ring, NBR 70A, Family',
      Number: 'BR-100635-XXX',
      'Tab Number': '-019',
    },
    // Carries no Tab Number of its own, so a tab for it can only be derived.
    XXX: { Description: 'O-ring, NBR 70A, Family', Number: 'BR-100635-777' },
  },
}

function options(overrides: Partial<RepairOptions> = {}): RepairOptions {
  return { ...DEFAULT_REPAIR_OPTIONS, ...overrides }
}

// ============================================
// The safety property
// ============================================

describe('the fill is additive by construction', () => {
  it('proposes nothing at all against a fully intact file', () => {
    const intact = row({
      keys: keys(['-013', '-019', 'XXX'], ['-013', '-019', 'XXX']),
    })

    const plan = planFileRepair(intact, oring, options({ includeDerivedTabs: true }))

    expect(plan.proposed).toEqual([])
    expect(plan.staleKeys).toEqual([])
    expect(plan.skipped.every((entry) => entry.reason === 'key-already-present')).toBe(true)
    expect(plan.skipped).toHaveLength(6)
  })

  it('never replaces an existing value, even when the document disagrees with it', () => {
    const disagreeing = row({
      keys: keys(['-013'], ['-013']),
    })

    const plan = planFileRepair(disagreeing, oring, options({ includeDerivedTabs: true }))

    // The document says `13` and `O-ring, NBR 70A, Blue, -013` for `-013`; the row holds something
    // else entirely, and the repair has no way to express saying so.
    expect(plan.proposed.some((entry) => entry.configuration === '-013')).toBe(false)

    const existing = {
      '-013': 'a value somebody typed that the document does not agree with',
    }
    for (const map of [CONFIG_TABS_KEY, CONFIG_DESCRIPTIONS_KEY] as const) {
      const merged = fillGapsOnly(proposedMap(plan, map), existing)
      expect(merged['-013']).toBe(existing['-013'])
      expect(fillIsAdditive(proposedMap(plan, map), existing)).toBe(true)
    }
  })

  it('treats a key holding an empty string as present, because clearing a value is an edit', () => {
    const cleared = row({ keys: keys(['-019'], ['-019']) })

    const plan = planFileRepair(cleared, oring, options())
    const forNineteen = plan.skipped.filter((entry) => entry.configuration === '-019')

    expect(forNineteen).toHaveLength(2)
    expect(forNineteen.every((entry) => entry.reason === 'key-already-present')).toBe(true)
    expect(fillGapsOnly(proposedMap(plan, CONFIG_TABS_KEY), { '-019': '' })['-019']).toBe('')
  })

  it('keeps every existing key and value under any combination of inputs', () => {
    const samples: [Record<string, string>, Record<string, string>][] = [
      [{}, {}],
      [{ a: '1' }, {}],
      [{}, { a: '1' }],
      [{ a: '1' }, { a: '2' }],
      [{ a: '1', b: '2' }, { b: '', c: '3' }],
      [{ a: '' }, { a: 'kept' }],
    ]

    for (const [computed, existing] of samples) {
      expect(fillIsAdditive(computed, existing)).toBe(true)

      const merged = fillGapsOnly(computed, existing)
      for (const key of Object.keys(existing)) expect(merged[key]).toBe(existing[key])
      // The gap set and the existing set are disjoint, and together they are the merge.
      expect(fillGapsOnly(gapsOnly(computed, existing), existing)).toEqual(merged)
    }
  })

  it('never returns a key the existing map already has', () => {
    const gaps = gapsOnly({ a: '1', b: '2', c: '3' }, { b: 'kept', c: '' })
    expect(gaps).toEqual({ a: '1' })
  })
})

// ============================================
// Which gaps get filled
// ============================================

describe('planFileRepair', () => {
  it('fills only the configurations missing from a truncated map', () => {
    const truncated = row({ keys: keys(['-013'], ['-013']) })

    const plan = planFileRepair(truncated, oring, options())
    const descriptions = proposedMap(plan, CONFIG_DESCRIPTIONS_KEY)

    expect(Object.keys(descriptions).sort()).toEqual(['-019', 'XXX'])
    expect(descriptions['-019']).toBe('O-ring, NBR 70A, Family')
    expect(proposedMap(plan, CONFIG_TABS_KEY)).toEqual({ '-019': '-019' })
  })

  it('treats a present-but-empty map as a total wipe and fills every configuration', () => {
    const wiped = row({
      shapes: shapes('present-empty', 'present-empty'),
      keys: keys([], []),
    })

    const plan = planFileRepair(wiped, oring, options())

    expect(Object.keys(proposedMap(plan, CONFIG_DESCRIPTIONS_KEY)).sort()).toEqual([
      '-013',
      '-019',
      'XXX',
    ])
  })

  it('fills nothing when the row carries no map, because the database never described it', () => {
    const never = row({ shapes: shapes('absent', 'absent') })

    const plan = planFileRepair(never, oring, options({ includeDerivedTabs: true }))

    expect(plan.proposed).toEqual([])
    expect(plan.skipped.every((entry) => entry.reason === 'row-has-no-map')).toBe(true)
  })

  it('refuses a map that is not an object rather than merging into it', () => {
    const wrongShape = row({ shapes: shapes('not-an-object', 'present') })

    const plan = planFileRepair(wrongShape, oring, options())

    expect(plan.proposed.some((entry) => entry.map === CONFIG_TABS_KEY)).toBe(false)
    expect(plan.skipped.filter((entry) => entry.reason === 'row-map-not-an-object')).toHaveLength(3)
  })

  it('reports keys for configurations the document no longer has, and proposes nothing for them', () => {
    // The `ORING-FKM-75A` shape: more keys on the row than the document has configurations, with
    // nothing missing. The eleven extra keys are a deletion to remove, so they are only reported.
    const stale = row({
      keys: keys(['-013', '-019', 'XXX', 'gone-1', 'gone-2'], ['-013', '-019', 'XXX', 'gone-1']),
    })

    const plan = planFileRepair(stale, oring, options({ includeDerivedTabs: true }))

    expect(plan.proposed).toEqual([])
    expect(plan.staleKeys).toEqual([
      { map: CONFIG_TABS_KEY, configuration: 'gone-1' },
      { map: CONFIG_TABS_KEY, configuration: 'gone-2' },
      { map: CONFIG_DESCRIPTIONS_KEY, configuration: 'gone-1' },
    ])
  })

  it('honours the $PRP: guard, because a linked property is a reference and not a value', () => {
    const linked: CensusDocument = {
      ...oring,
      configurations: ['A'],
      configurationProperties: {
        A: { Description: '$PRP:"Number"', 'Tab Number': 'SW-PRP:Tab', Number: 'BR-1-007' },
      },
    }

    const plan = planFileRepair(row({ keys: keys([], []) }), linked, options())

    expect(plan.proposed).toEqual([])
    expect(plan.skipped.filter((entry) => entry.reason === 'no-value-in-document')).toHaveLength(1)
    // The tab falls through the guarded read to derivation, which is off by default.
    expect(plan.skipped.filter((entry) => entry.reason === 'derivation-not-enabled')).toHaveLength(1)
  })
})

// ============================================
// The two judgement calls
// ============================================

describe('derived tabs', () => {
  it('splits the configuration own Number on the last dash, as the browser does', () => {
    expect(deriveTabFromNumber({ Number: 'BR-100635-777' })).toBe('777')
    expect(deriveTabFromNumber({ Number: 'BR100635' })).toBeNull()
    expect(deriveTabFromNumber({ Number: 'BR-100635-TOOLONG' })).toBeNull()
    expect(deriveTabFromNumber({})).toBeNull()
    // A trailing segment long enough to be the number in its own right is not a tab.
    expect(deriveTabFromNumber({ Number: 'BR-100635' })).toBeNull()
  })

  it('derives from the configuration own bag, never from the file-level Number', () => {
    // `XXX` has its own `Number`; the family's `BR-100635-XXX` must not reach it.
    expect(deriveTabFromNumber(oring.configurationProperties['XXX'])).toBe('777')
    expect(deriveTabFromNumber({ 'Tab Number': '-019' })).toBeNull()
  })

  it('ignores Base Item Number, which carries the base without the tab', () => {
    expect(deriveTabFromNumber({ 'Base Item Number': 'BR-100635' })).toBeNull()
  })

  it('is off by default and marked when on', () => {
    const gaps = row({ keys: keys([], []) })

    expect(proposedMap(planFileRepair(gaps, oring, options()), CONFIG_TABS_KEY)).toEqual({
      '-013': '13',
      '-019': '-019',
    })

    const withDerived = planFileRepair(gaps, oring, options({ includeDerivedTabs: true }))
    const derived = withDerived.proposed.filter((entry) => entry.provenance === 'derived')

    expect(derived).toHaveLength(1)
    expect(derived[0]).toMatchObject({ configuration: 'XXX', value: '777' })
  })
})

describe('values that repeat the document file-level value', () => {
  it('fills them by default and marks them', () => {
    const plan = planFileRepair(row({ keys: keys([], []) }), oring, options())
    const duplicates = plan.proposed.filter((entry) => entry.matchesFileLevel)

    expect(duplicates.map((entry) => entry.configuration).sort()).toEqual(['-019', 'XXX'])
    expect(duplicates.every((entry) => entry.map === CONFIG_DESCRIPTIONS_KEY)).toBe(true)
  })

  it('leaves them out when asked, without touching the distinct ones', () => {
    const plan = planFileRepair(
      row({ keys: keys([], []) }),
      oring,
      options({ skipFileLevelDuplicates: true }),
    )

    expect(proposedMap(plan, CONFIG_DESCRIPTIONS_KEY)).toEqual({
      '-013': 'O-ring, NBR 70A, Blue, -013',
    })
    expect(plan.skipped.filter((entry) => entry.reason === 'matches-file-level')).toHaveLength(2)
  })
})

// ============================================
// Planning a set of rows
// ============================================

describe('planConfigMapRepair', () => {
  const census = new Map([['0 - shared\\01-toolbox\\oring-buna-70a.sldprt', oring]])

  function rowsOfTwo(): ConfigMapShapeRow[] {
    return [row(), row({ filePath: 'Parts\\OTHER.SLDPRT', fileName: 'OTHER.SLDPRT' })]
  }

  it('reports a row with no census record rather than guessing at one', () => {
    const plan = planConfigMapRepair(
      [row(), row({ filePath: 'Parts\\NOT-MEASURED.SLDPRT', fileName: 'NOT-MEASURED.SLDPRT' })],
      census,
      new Map(),
    )

    expect(plan.files).toHaveLength(1)
    expect(plan.unplanned).toEqual([
      { relativePath: 'Parts\\NOT-MEASURED.SLDPRT', reason: 'no-census-record', detail: undefined },
    ])
  })

  it('distinguishes a document the census could not read, so a deferred repair is visible', () => {
    const plan = planConfigMapRepair(
      [row({ filePath: 'Parts\\OPEN.SLDPRT', fileName: 'OPEN.SLDPRT' })],
      new Map(),
      new Map([['parts\\open.sldprt', 'held-by-another-process']]),
    )

    expect(plan.unplanned[0]).toMatchObject({
      reason: 'census-unreadable',
      detail: 'held-by-another-process',
    })
  })

  it('narrows to exact paths, matching separators and case the way the row stores them', () => {
    const plan = planConfigMapRepair(rowsOfTwo(), census, new Map(), {
      ...DEFAULT_REPAIR_OPTIONS,
      onlyPaths: ['0 - shared/01-toolbox/oring-buna-70a.SLDPRT'],
    })

    expect(plan.summary.rowsConsidered).toBe(1)
    expect(plan.files).toHaveLength(1)
  })

  it('counts what it preserved as well as what it would add', () => {
    const plan = planConfigMapRepair([row({ keys: keys(['-013'], ['-013', 'gone']) })], census, new Map())

    expect(plan.summary).toMatchObject({
      proposedEntries: 3,
      recoveredEntries: 3,
      derivedEntries: 0,
      existingKeysPreserved: 3,
      staleKeys: 1,
      filesWithProposals: 1,
    })
  })
})
