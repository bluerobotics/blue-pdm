import { describe, expect, it } from 'vitest'

import {
  compareOwnedMetadata,
  summarizeDivergence,
  type DatabaseMetadata,
  type FileDivergence,
  type FileMetadata,
} from '@/lib/metadata/divergence'
import { DIVERGENCE_REPORT_SCHEMA_VERSION, type DivergenceReport } from '@/lib/metadata/divergenceScan'

import { buildVaultAuditView } from './vaultAuditView'

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
): FileDivergence {
  return compareOwnedMetadata(
    {
      fileId: fileName,
      relativePath: `0 - SHARED\\01-TOOLBOX\\${fileName}`,
      fileName,
      fileType: 'part',
    },
    database,
    file,
  )
}

function reportOf(files: FileDivergence[]): DivergenceReport {
  return {
    schemaVersion: DIVERGENCE_REPORT_SCHEMA_VERSION,
    generatedAt: '2026-08-06T00:00:00.000Z',
    scope: {
      orgId: 'org-1',
      vaultId: null,
      vaultPath: 'C:\\BluePLM\\br-vault',
      pathPrefix: null,
      limit: null,
      includeDrawings: false,
      configurationRecordedOnly: true,
    },
    counts: {
      rowsFetched: 8019,
      rowsConsidered: files.length,
      filesCompared: files.length,
      filesMissingOnDisk: 0,
      filesUnreadable: 0,
      filesOpenInSolidWorks: 0,
    },
    summary: summarizeDivergence(files),
    files,
    unreadable: [],
    integrity: { filesHashed: 0, breaches: [] },
    readBackTimings: [],
    durationMs: 163_000,
    cancelled: false,
  }
}

/**
 * The census fixture: fifteen real configurations against a record carrying twenty-six keys.
 *
 * Every configuration the file has is described, so nothing has been lost. The eleven extra keys
 * name configurations that were deleted or renamed. Comparing counts calls this file damaged;
 * comparing names calls it intact, which it is.
 */
const REAL_CONFIGURATIONS = [
  '-010',
  '-037',
  '-037 AS INSTALLED PING360',
  '1X2.5',
  '1.5X34',
  '2.0X18',
  '2.5X14',
  '1x12',
  'Streched nom Oring 1',
  'Streched nom Oring 2',
  'Streched Oring 1 Worst case',
  'Streched Oring 2 Worst case',
  'Streched Oring 1 Biggest',
  'Streched Oring 2 Biggest',
  '1.5X29',
]

const DEPARTED_CONFIGURATIONS = [
  '-006',
  '-008',
  '-012',
  '-014',
  '-016',
  '-018',
  '-020',
  '-022',
  '-024',
  '-026',
  '-028',
]

function oringFkm(): FileDivergence {
  const tabs: Record<string, string> = {}
  const descriptions: Record<string, string> = {}
  for (const name of [...REAL_CONFIGURATIONS, ...DEPARTED_CONFIGURATIONS]) {
    tabs[name] = name
    descriptions[name] = `O-ring, FKM 75A ${name}`
  }

  const configurationProperties: Record<string, Record<string, string>> = {}
  for (const name of REAL_CONFIGURATIONS) {
    configurationProperties[name] = {
      'Tab Number': name,
      Description: `O-ring, FKM 75A ${name}`,
    }
  }

  return compare(
    'ORING-FKM-75A.SLDPRT',
    rowOf({
      configTabs: tabs,
      configDescriptions: descriptions,
      hasConfigTabsKey: true,
      hasConfigDescriptionsKey: true,
    }),
    {
      configurations: REAL_CONFIGURATIONS,
      fileProperties: { Description: 'O-ring, FKM 75A, Family' },
      configurationProperties,
    },
  )
}

/** A record that exists and describes nothing - what a wipe of every configuration leaves. */
function wipedRecord(): FileDivergence {
  return compare(
    'BRACKET.SLDPRT',
    rowOf({ hasConfigTabsKey: true, hasConfigDescriptionsKey: true }),
    {
      configurations: ['Short', 'Long'],
      fileProperties: {},
      configurationProperties: {
        Short: { 'Tab Number': '-001', Description: 'Short bracket' },
        Long: {},
      },
    },
  )
}

/** Both sides hold a value and they differ, at file scope. */
function conflicting(): FileDivergence {
  return compare('SHAFT.SLDPRT', rowOf({ partNumber: 'PN-100', description: 'Shaft' }), {
    configurations: ['Default'],
    fileProperties: { 'Base Item Number': 'PN-200', Description: 'Shaft' },
    configurationProperties: { Default: {} },
  })
}

/** A row that never used the reserved maps, against a file whose configuration carries values. */
function neverRecorded(): FileDivergence {
  return compare('WASHER.SLDPRT', rowOf(), {
    configurations: ['Default'],
    fileProperties: {},
    configurationProperties: { Default: { Description: 'Washer', Suffix: '-001' } },
  })
}

// ============================================
// Tests
// ============================================

describe('buildVaultAuditView - configuration coverage', () => {
  const view = buildVaultAuditView(reportOf([oringFkm()]))

  it('calls a record with more keys than the file has configurations intact', () => {
    expect(view.coverage.filesWithUndescribedConfigurations).toBe(0)
    expect(view.coverage.undescribedConfigurationCount).toBe(0)
  })

  it('counts the keys for departed configurations as stale rather than as a loss', () => {
    expect(view.coverage.filesWithStaleKeys).toBe(1)
    expect(view.coverage.staleKeyCount).toBe(DEPARTED_CONFIGURATIONS.length)
    expect(view.coverage.files[0].staleKeys).toHaveLength(11)
    expect(view.coverage.files[0].undescribedConfigurations).toEqual([])
  })

  it('reports no lost or recoverable values for that file', () => {
    const byKind = Object.fromEntries(view.categories.map((c) => [c.kind, c.valueCount]))
    expect(byKind.lost).toBe(0)
    expect(byKind.recoverable).toBe(0)
    expect(byKind.conflicting).toBe(0)
  })

  it('records the file only once in the coverage detail', () => {
    expect(view.coverage.files).toHaveLength(1)
    expect(view.coverage.files[0].configurationCount).toBe(15)
  })
})

describe('buildVaultAuditView - a record that was emptied', () => {
  const view = buildVaultAuditView(reportOf([wipedRecord()]))

  it('names the configurations the record no longer describes', () => {
    expect(view.coverage.filesWithUndescribedConfigurations).toBe(1)
    expect(view.coverage.files[0].undescribedConfigurations.sort()).toEqual(['Long', 'Short'])
    expect(view.coverage.filesWithEmptiedRecord).toBe(1)
  })

  it('classifies a value the file still holds as recoverable and one it does not as lost', () => {
    const kinds = view.findings
      .filter((finding) => finding.configuration === 'Short')
      .map((finding) => finding.kind)
    expect(kinds).toEqual(['recoverable', 'recoverable'])

    const longKinds = view.findings
      .filter((finding) => finding.configuration === 'Long')
      .map((finding) => finding.kind)
    expect(longKinds).toEqual(['lost', 'lost'])
  })

  it('carries the value a repair could write, and only from a key BluePLM writes', () => {
    const tab = view.findings.find(
      (finding) => finding.configuration === 'Short' && finding.field === 'config_tab',
    )
    expect(tab?.repairValue).toBe('-001')
  })
})

describe('buildVaultAuditView - categories', () => {
  const view = buildVaultAuditView(
    reportOf([oringFkm(), wipedRecord(), conflicting(), neverRecorded()]),
  )

  it('orders categories by how little can be done about them', () => {
    expect(view.categories.map((category) => category.kind)).toEqual([
      'lost',
      'conflicting',
      'recoverable',
      'unattributed',
    ])
  })

  it('always lists every category, including the empty ones', () => {
    expect(view.categories).toHaveLength(4)
  })

  it('partitions every finding into exactly one category', () => {
    const total = view.categories.reduce((sum, category) => sum + category.valueCount, 0)
    expect(total).toBe(view.findings.length)
    expect(new Set(view.findings.map((finding) => finding.id)).size).toBe(view.findings.length)
  })

  it('counts a conflict between two held values as conflicting', () => {
    const conflict = view.findings.find((finding) => finding.kind === 'conflicting')
    expect(conflict?.field).toBe('part_number')
    expect(conflict?.databaseValue).toBe('PN-100')
    expect(conflict?.fileValue).toBe('PN-200')
  })

  it('keeps values the database never owned out of the repairable buckets', () => {
    const washer = view.findings.filter((finding) => finding.fileId === 'WASHER.SLDPRT')
    expect(washer.every((finding) => finding.kind === 'unattributed')).toBe(true)
    expect(washer.map((finding) => finding.unattributedReason)).toContain('database-never-held-it')
  })

  it('counts files with findings rather than findings', () => {
    expect(view.filesWithFindings).toBeLessThanOrEqual(4)
    expect(view.filesWithFindings).toBeGreaterThan(0)
  })
})

describe('buildVaultAuditView - an empty run', () => {
  const view = buildVaultAuditView(reportOf([]))

  it('produces every category at zero rather than none at all', () => {
    expect(view.categories).toHaveLength(4)
    expect(view.categories.every((category) => category.valueCount === 0)).toBe(true)
    expect(view.findings).toEqual([])
    expect(view.coverage.files).toEqual([])
  })
})

describe('the finding a repair is built from', () => {
  const view = buildVaultAuditView(reportOf([wipedRecord()]))

  // The per-value repair seam this used to exercise is gone; what a repair consumes is now decided
  // over a whole key set in `configMapRepairProposal`, which has its own tests. What the view still
  // owes that planner is the writable value, kept apart from whatever the document merely reads as.
  it('carries the value a repair may write, not just the one the file shows', () => {
    const finding = view.findings.find(
      (candidate) => candidate.configuration === 'Short' && candidate.field === 'config_tab',
    )
    expect(finding).toBeDefined()
    expect(finding?.kind).toBe('recoverable')
    expect(finding?.repairValue).toBe('-001')
    expect(finding?.databaseValue).toBeNull()
  })
})
