import { describe, expect, it } from 'vitest'

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'
import {
  DEFAULT_REPAIR_OPTIONS,
  planConfigMapRepair,
  type CensusDocument,
  type ConfigMapShapeRow,
  type RepairPlan,
} from './configMapRepair'
import { emitRepairSql } from './configMapRepairSql'

const FILE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PATH = "0 - SHARED\\01-TOOLBOX\\O'RING.SLDPRT"
const KEY = "0 - shared\\01-toolbox\\o'ring.sldprt"

function document(overrides: Partial<CensusDocument> = {}): CensusDocument {
  return {
    relativePath: PATH,
    absolutePath: `C:\\BluePLM\\br-vault\\${PATH}`,
    configurations: ["-013", "Bob's config"],
    fileProperties: { Description: 'Family', 'Tab Number': '-XXX' },
    configurationProperties: {
      '-013': { Description: "O'ring, -013", 'Tab Number': '13' },
      "Bob's config": { Description: 'Another', 'Tab Number': '-99' },
    },
    ...overrides,
  }
}

function row(overrides: Partial<ConfigMapShapeRow> = {}): ConfigMapShapeRow {
  return {
    id: FILE_ID,
    filePath: PATH,
    fileName: "O'RING.SLDPRT",
    shapes: { [CONFIG_TABS_KEY]: 'present', [CONFIG_DESCRIPTIONS_KEY]: 'present' },
    keys: { [CONFIG_TABS_KEY]: [], [CONFIG_DESCRIPTIONS_KEY]: [] },
    updatedAt: null,
    ...overrides,
  }
}

function planOf(rowOverrides: Partial<ConfigMapShapeRow> = {}): RepairPlan {
  return planConfigMapRepair(
    [row(rowOverrides)],
    new Map([[KEY, document()]]),
    new Map(),
    DEFAULT_REPAIR_OPTIONS,
  )
}

const GENERATED_AT = '2026-08-06T22:00:00.000Z'

describe('emitRepairSql', () => {
  const emitted = emitRepairSql(planOf(), GENERATED_AT)

  it('puts the computed map on the left of the merge, so the live row wins', () => {
    // The whole safety property in one assertion: `computed || existing`, with `existing` read from
    // the row at apply time. Reverse the operands and the statement becomes an overwrite.
    expect(emitted.sql).toContain(
      `|| COALESCE(custom_properties -> '${CONFIG_TABS_KEY}', '{}'::jsonb)`,
    )
    expect(emitted.sql).toContain(
      `|| COALESCE(custom_properties -> '${CONFIG_DESCRIPTIONS_KEY}', '{}'::jsonb)`,
    )
    expect(emitted.sql).not.toMatch(/COALESCE\(custom_properties -> '_config_\w+', '\{\}'::jsonb\)\s*\|\|/)
  })

  it('contains nothing that can remove or overwrite anything', () => {
    const sql = emitted.sql
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')

    expect(statements).not.toMatch(/\bDELETE\b/i)
    expect(statements).not.toMatch(/\bTRUNCATE\b/i)
    expect(statements).not.toMatch(/\bDROP\b/i)
    // `jsonb - key` is the only way to remove an entry, and it never appears.
    expect(statements).not.toMatch(/custom_properties\s*-\s*'/)
    // One column in the SET list, and it is the one the repair is about.
    expect(statements.match(/UPDATE files SET (\w+)/g)).toEqual(['UPDATE files SET custom_properties'])
  })

  it('refuses to act on a row that has moved or changed shape', () => {
    expect(emitted.sql).toContain(`WHERE id = '${FILE_ID}'::uuid`)
    expect(emitted.sql).toContain(`AND file_path = '0 - SHARED\\01-TOOLBOX\\O''RING.SLDPRT'`)
    expect(emitted.sql).toContain('AND deleted_at IS NULL')
    expect(emitted.sql).toContain(`AND custom_properties ? '${CONFIG_TABS_KEY}'`)
    expect(emitted.sql).toContain(
      `AND jsonb_typeof(custom_properties -> '${CONFIG_TABS_KEY}') = 'object'`,
    )
  })

  it('doubles the quote in a value and in a configuration name', () => {
    expect(emitted.sql).toContain('Bob\'\'s config')
    expect(emitted.sql).toContain('O\'\'ring, -013')
  })

  it('emits no guard for a map it is not writing', () => {
    const oneMap = emitRepairSql(
      planOf({ keys: { [CONFIG_TABS_KEY]: ['-013', "Bob's config"], [CONFIG_DESCRIPTIONS_KEY]: [] } }),
      GENERATED_AT,
    )

    expect(oneMap.sql).toContain(`AND custom_properties ? '${CONFIG_DESCRIPTIONS_KEY}'`)
    expect(oneMap.sql).not.toContain(`AND custom_properties ? '${CONFIG_TABS_KEY}'`)
  })

  it('wraps the statements in a transaction and ends with a read-only receipt', () => {
    expect(emitted.statements).toBe(1)
    expect(emitted.sql).toContain('BEGIN;')
    expect(emitted.sql.indexOf('COMMIT;')).toBeGreaterThan(emitted.sql.indexOf('UPDATE files'))
    expect(emitted.sql.indexOf('SELECT f.file_path')).toBeGreaterThan(emitted.sql.indexOf('COMMIT;'))
  })

  it('omits a row it cannot identify exactly, rather than targeting it by path', () => {
    const noId = emitRepairSql(planOf({ id: null }), GENERATED_AT)

    expect(noId.statements).toBe(0)
    expect(noId.omitted).toEqual([
      {
        relativePath: PATH,
        reason: 'the export carried no id for this row, and the id is the only safe target',
      },
    ])

    const badId = emitRepairSql(planOf({ id: 'not-a-uuid' }), GENERATED_AT)
    expect(badId.statements).toBe(0)
    expect(badId.omitted[0].reason).toContain('not a uuid')
  })

  it('says so plainly when there is nothing to fill', () => {
    const intact = emitRepairSql(
      planOf({
        keys: {
          [CONFIG_TABS_KEY]: ['-013', "Bob's config"],
          [CONFIG_DESCRIPTIONS_KEY]: ['-013', "Bob's config"],
        },
      }),
      GENERATED_AT,
    )

    expect(intact.statements).toBe(0)
    expect(intact.sql).toContain('Nothing to fill')
    expect(intact.sql).not.toContain('UPDATE files')
  })

  it('is deterministic, so re-running on unchanged inputs produces the same file', () => {
    expect(emitRepairSql(planOf(), GENERATED_AT).sql).toBe(emitted.sql)
  })
})
