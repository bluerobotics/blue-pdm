import { describe, expect, it } from 'vitest'

import { compareOwnedMetadata, summarizeDivergence, type DatabaseMetadata } from './divergence'
import { formatDivergenceReport } from './divergenceReport'
import { DIVERGENCE_REPORT_SCHEMA_VERSION, type DivergenceReport } from './divergenceScan'

/**
 * A row that never used the reserved maps, against a part whose configurations carry properties
 * that read as a tab and a description. Every one of those values used to be reported as
 * recoverable; the report has to say what they are instead of leaving them in a repair queue.
 */
const emptyRow: DatabaseMetadata = {
  partNumber: null,
  description: null,
  revision: null,
  configTabs: {},
  configDescriptions: {},
  hasConfigTabsKey: false,
  hasConfigDescriptionsKey: false,
}

const scanned = compareOwnedMetadata(
  {
    fileId: 'file-1',
    relativePath: 'Parts/ORING-BUNA-70A.SLDPRT',
    fileName: 'ORING-BUNA-70A.SLDPRT',
    fileType: 'part',
  },
  emptyRow,
  {
    configurations: ['AS568-001'],
    fileProperties: {},
    configurationProperties: { 'AS568-001': { Description: 'O-ring, NBR 70A', Suffix: '001' } },
  },
)

function reportOf(): DivergenceReport {
  return {
    schemaVersion: DIVERGENCE_REPORT_SCHEMA_VERSION,
    generatedAt: '2026-08-06T00:00:00.000Z',
    scope: {
      orgId: 'org-1',
      vaultId: null,
      vaultPath: 'C:\\BluePLM\\vault',
      pathPrefix: null,
      limit: null,
      includeDrawings: false,
      configurationRecordedOnly: false,
    },
    counts: {
      rowsFetched: 1,
      rowsInScope: 1,
      rowsConsidered: 1,
      rowsSkippedNoConfigurationRecord: 0,
      rowsSkippedByLimit: 0,
      filesCompared: 1,
      filesMissingOnDisk: 0,
      filesUnreadable: 0,
      filesOpenInSolidWorks: 0,
    },
    summary: summarizeDivergence([scanned]),
    files: [scanned],
    unreadable: [],
    integrity: { filesHashed: 0, breaches: [] },
    readBackTimings: [],
    durationMs: 1000,
    cancelled: false,
  }
}

describe('formatDivergenceReport', () => {
  const lines = formatDivergenceReport(reportOf())
  const text = lines.join('\n')

  it('resolves every string it prints, rather than printing a translation key', () => {
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*divergence\./)
      expect(line).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it('gives the values it could not attribute a section of their own', () => {
    expect(text).toContain('NEEDS A DECISION')
    expect(text).toContain('Parts/ORING-BUNA-70A.SLDPRT [AS568-001]')
  })

  it('says why each of them could not be attributed', () => {
    expect(text).toContain('the row has no configuration map at all')
    expect(text).toContain('not under a key BluePLM writes')
  })

  it('does not report a file with no configuration map as part of the wipe', () => {
    expect(text).toContain('carry no configuration map on the row at all')
  })

  it('numbers its sections in order', () => {
    const headings = lines.filter((line) => /^\d\. /.test(line))
    expect(headings.map((heading) => heading[0])).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})
