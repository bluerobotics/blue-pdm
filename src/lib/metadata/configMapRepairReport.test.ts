import { describe, expect, it } from 'vitest'

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'
import {
  DEFAULT_REPAIR_OPTIONS,
  planConfigMapRepair,
  type CensusDocument,
  type ConfigMapShapeRow,
  type RepairOptions,
} from './configMapRepair'
import { formatRepairPlan } from './configMapRepairReport'

const PATH = '0 - SHARED\\01-TOOLBOX\\ORING-BUNA-70A.SLDPRT'
const KEY = '0 - shared\\01-toolbox\\oring-buna-70a.sldprt'

const document: CensusDocument = {
  relativePath: PATH,
  absolutePath: `C:\\BluePLM\\br-vault\\${PATH}`,
  configurations: ['-013', '-019', 'XXX'],
  fileProperties: { Description: 'O-ring, NBR 70A, Family', 'Tab Number': '-XXX' },
  configurationProperties: {
    '-013': { Description: 'O-ring, NBR 70A, Blue, -013', 'Tab Number': '13' },
    '-019': { Description: 'O-ring, NBR 70A, Family', 'Tab Number': '-019' },
    XXX: { Description: 'O-ring, NBR 70A, Family', Number: 'BR-100635-777' },
  },
}

const truncated: ConfigMapShapeRow = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  filePath: PATH,
  fileName: 'ORING-BUNA-70A.SLDPRT',
  shapes: { [CONFIG_TABS_KEY]: 'present', [CONFIG_DESCRIPTIONS_KEY]: 'present' },
  keys: { [CONFIG_TABS_KEY]: ['-013', 'gone'], [CONFIG_DESCRIPTIONS_KEY]: ['-013'] },
  updatedAt: null,
}

function reportOf(options: Partial<RepairOptions> = {}): string[] {
  return formatRepairPlan(
    planConfigMapRepair([truncated], new Map([[KEY, document]]), new Map(), {
      ...DEFAULT_REPAIR_OPTIONS,
      ...options,
    }),
  )
}

describe('formatRepairPlan', () => {
  const lines = reportOf()
  const text = lines.join('\n')

  it('leads with the fact that nothing has been written', () => {
    expect(lines[0]).toContain('DRY RUN, nothing has been written')
  })

  it('prints the file, the configuration, the key and the value for every proposal', () => {
    expect(text).toContain(`${PATH}  [-019]  tab = "-019"  (recovered)`)
    expect(text).toContain(
      `${PATH}  [XXX]  description = "O-ring, NBR 70A, Family"  (recovered, same as file-level)`,
    )
  })

  it('marks a reconstructed value apart from a recovered one', () => {
    const derived = reportOf({ includeDerivedTabs: true }).join('\n')
    expect(derived).toContain(`${PATH}  [XXX]  tab = "777"  (derived)`)
  })

  it('says how many entries it is leaving exactly as they are', () => {
    expect(text).toContain('3 entries already on those rows would be left exactly as they')
  })

  it('reports keys for configurations that no longer exist without proposing to remove them', () => {
    expect(text).toContain('kept, never removed')
    expect(text).toContain(`${PATH}: tab:gone`)
  })

  it('states both judgement calls and how to reverse each', () => {
    expect(text).toContain('--skip-file-level-duplicates')
    expect(text).toContain('--include-derived')
    expect(text).toContain('2 of the 3 proposed entries repeat it.')
    expect(text).toContain('1 tabs could only have been derived.')
  })

  it('numbers its sections in order', () => {
    const headings = lines.filter((line) => /^\d\. /.test(line))
    expect(headings.map((heading) => heading[0])).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('does not leave an unresolved placeholder anywhere', () => {
    for (const line of lines) expect(line).not.toMatch(/\{\{\w+\}\}/)
  })
})
