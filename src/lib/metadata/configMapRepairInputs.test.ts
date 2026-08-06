import { describe, expect, it } from 'vitest'

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'
import {
  censusKey,
  indexCensus,
  parseJsonDocuments,
  parseShapeRows,
  toRelativePath,
} from './configMapRepairInputs'

const VAULT = 'C:\\BluePLM\\br-vault'

describe('parseJsonDocuments', () => {
  it('reads an array, a wrapper object and NDJSON alike', () => {
    expect(parseJsonDocuments('[{"a":1},{"a":2}]')).toHaveLength(2)
    expect(parseJsonDocuments('{"rows":[{"a":1}]}')).toHaveLength(1)
    expect(parseJsonDocuments('{"a":1}\n{"a":2}\n')).toHaveLength(2)
    expect(parseJsonDocuments('   ')).toEqual([])
  })
})

describe('parseShapeRows', () => {
  const record = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    file_path: 'Parts\\A.SLDPRT',
    file_name: 'A.SLDPRT',
    tab_map_shape: 'present-EMPTY',
    tab_configurations: [],
    description_map_shape: 'present',
    description_configurations: ['-013'],
    updated_at: '2026-08-01T00:00:00Z',
  }

  it('reads the columns the export query selects, lower-casing present-EMPTY', () => {
    const { rows, rejected } = parseShapeRows(JSON.stringify([record]))

    expect(rejected).toEqual([])
    expect(rows[0].shapes[CONFIG_TABS_KEY]).toBe('present-empty')
    expect(rows[0].shapes[CONFIG_DESCRIPTIONS_KEY]).toBe('present')
    expect(rows[0].keys[CONFIG_DESCRIPTIONS_KEY]).toEqual(['-013'])
    expect(rows[0].id).toBe(record.id)
  })

  it('infers a shape from the key list when the shape column is absent', () => {
    const { rows } = parseShapeRows(
      JSON.stringify([
        {
          file_path: 'Parts\\B.SLDPRT',
          tab_configurations: null,
          description_configurations: ['x'],
        },
      ]),
    )

    // `NULL` is what the query returns for a map that is not an object, including one that is not
    // there at all - which is the shape that must never be filled.
    expect(rows[0].shapes[CONFIG_TABS_KEY]).toBe('absent')
    expect(rows[0].shapes[CONFIG_DESCRIPTIONS_KEY]).toBe('present')
  })

  it('rejects a record whose shape cannot be established, rather than defaulting it', () => {
    const { rows, rejected } = parseShapeRows(JSON.stringify([{ file_path: 'Parts\\C.SLDPRT' }]))

    expect(rows).toEqual([])
    expect(rejected[0].reason).toContain('no map shape')
  })

  it('rejects a record with no file_path', () => {
    const { rejected } = parseShapeRows(JSON.stringify([{ id: 'x' }]))
    expect(rejected[0].reason).toBe('no file_path')
  })

  it('takes the file name from the path when the export omits it', () => {
    const { rows } = parseShapeRows(
      JSON.stringify([
        { file_path: 'Parts\\D.SLDPRT', tab_configurations: [], description_configurations: [] },
      ]),
    )
    expect(rows[0].fileName).toBe('D.SLDPRT')
  })
})

describe('indexCensus', () => {
  const ok = {
    Path: `${VAULT}\\0 - SHARED\\01-TOOLBOX\\ORING.SLDPRT`,
    Status: 'ok',
    Configurations: ['-013'],
    FileProps: { Description: 'Family', Weight: 12 },
    ConfigProps: { '-013': { Description: 'Blue' } },
  }

  it('keys documents by their vault-relative path, case-folded', () => {
    const index = indexCensus(JSON.stringify(ok), VAULT)
    const document = index.documents.get('0 - shared\\01-toolbox\\oring.sldprt')

    expect(document?.relativePath).toBe('0 - SHARED\\01-TOOLBOX\\ORING.SLDPRT')
    expect(document?.configurations).toEqual(['-013'])
    // A numeric property is coerced rather than dropped, as the other readers of these bags do.
    expect(document?.fileProperties.Weight).toBe('12')
  })

  it('separates a document it could not read, and says which status it had', () => {
    const index = indexCensus(
      JSON.stringify({ Path: `${VAULT}\\Parts\\OPEN.SLDPRT`, Status: 'held-by-another-process' }),
      VAULT,
    )

    expect(index.documents.size).toBe(0)
    expect(index.unreadable.get('parts\\open.sldprt')).toBe('held-by-another-process')
  })

  it('counts records that sit outside the vault instead of mis-keying them', () => {
    const index = indexCensus(JSON.stringify({ Path: 'D:\\elsewhere\\X.SLDPRT', Status: 'ok' }), VAULT)

    expect(index.outsideVault).toBe(1)
    expect(index.documents.size).toBe(0)
  })

  it('falls back to the configuration bags when the name list is empty', () => {
    const index = indexCensus(
      JSON.stringify({ ...ok, Configurations: [], ConfigProps: { A: {}, B: {} } }),
      VAULT,
    )

    expect(index.documents.get('0 - shared\\01-toolbox\\oring.sldprt')?.configurations).toEqual([
      'A',
      'B',
    ])
  })
})

describe('path handling', () => {
  it('folds separators and case so the two sides join', () => {
    expect(censusKey('/Parts/A.SLDPRT')).toBe('parts\\a.sldprt')
    expect(censusKey('Parts\\A.SLDPRT')).toBe('parts\\a.sldprt')
  })

  it('strips the vault root regardless of its case or trailing separator', () => {
    expect(toRelativePath(`${VAULT}\\Parts\\A.SLDPRT`, `${VAULT}\\`)).toBe('Parts\\A.SLDPRT')
    expect(toRelativePath(`c:\\blueplm\\br-vault\\Parts\\A.SLDPRT`, VAULT)).toBe('Parts\\A.SLDPRT')
    expect(toRelativePath('D:\\other\\A.SLDPRT', VAULT)).toBeNull()
  })
})
