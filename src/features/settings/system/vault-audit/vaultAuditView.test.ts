import { describe, expect, it } from 'vitest'

import {
  compareOwnedMetadata,
  summarizeDivergence,
  type ComparedFileType,
  type DatabaseMetadata,
  type FileDivergence,
  type FileMetadata,
} from '@/lib/metadata/divergence'
import {
  DIVERGENCE_REPORT_SCHEMA_VERSION,
  type DivergenceReport,
} from '@/lib/metadata/divergenceScan'

import {
  buildVaultAuditView,
  documentCarriesField,
  hasEvidence,
  resolutionOf,
} from './vaultAuditView'

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

function reportOf(
  files: FileDivergence[],
  counts?: Partial<DivergenceReport['counts']>,
): DivergenceReport {
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
      rowsInScope: files.length,
      rowsConsidered: files.length,
      rowsSkippedNoConfigurationRecord: 0,
      rowsSkippedByLimit: 0,
      filesCompared: files.length,
      filesMissingOnDisk: 0,
      filesUnreadable: 0,
      filesOpenInSolidWorks: 0,
      ...counts,
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

describe('buildVaultAuditView - what the run did not compare', () => {
  /**
   * `configurationRecordedOnly` drops roughly six models in seven, and the page used to say
   * nothing about them. "Every value compared agrees" was true and read as "the vault is fine".
   */
  it('carries the rows the scope filter dropped, separately from the ones it read', () => {
    const view = buildVaultAuditView(
      reportOf([conflicting()], {
        rowsFetched: 8019,
        rowsInScope: 8015,
        rowsConsidered: 1652,
        rowsSkippedNoConfigurationRecord: 6363,
        rowsSkippedByLimit: 0,
      }),
    )

    expect(view.notCompared).toEqual({
      total: 6363,
      noConfigurationRecord: 6363,
      beyondLimit: 0,
    })
  })

  it('counts a limited run’s remainder too, so a spot check cannot read as a full audit', () => {
    const view = buildVaultAuditView(
      reportOf([conflicting()], {
        rowsInScope: 8015,
        rowsConsidered: 50,
        rowsSkippedNoConfigurationRecord: 0,
        rowsSkippedByLimit: 7965,
      }),
    )

    expect(view.notCompared).toEqual({
      total: 7965,
      noConfigurationRecord: 0,
      beyondLimit: 7965,
    })
  })

  it('is empty for a run that covered everything its scope named', () => {
    const view = buildVaultAuditView(reportOf([conflicting()]))

    expect(view.notCompared.total).toBe(0)
  })

  /**
   * A folder path that matches no row produces no findings, nothing uncompared and nothing unread
   * - numerically indistinguishable from a spotless vault, and the page rendered it in green. The
   * denominator is the only thing that separates the two, so the view has to carry it.
   */
  it('carries the denominator, so a scope that matched no rows cannot pass for a clean one', () => {
    const view = buildVaultAuditView(
      reportOf([], {
        rowsFetched: 8019,
        rowsInScope: 0,
        rowsConsidered: 0,
        filesCompared: 0,
      }),
    )

    expect(view.rowsInScope).toBe(0)
    expect(view.filesCompared).toBe(0)
    expect(view.findings).toHaveLength(0)
    expect(view.notCompared.total).toBe(0)
  })

  it('carries the denominator on a run that did compare something', () => {
    const view = buildVaultAuditView(reportOf([conflicting()], { rowsInScope: 8015 }))

    expect(view.rowsInScope).toBe(8015)
  })
})

describe('hasEvidence', () => {
  it('is false for a scope that matched no rows', () => {
    const view = buildVaultAuditView(
      reportOf([], { rowsInScope: 0, rowsConsidered: 0, filesCompared: 0 }),
    )

    expect(hasEvidence(view)).toBe(false)
  })

  /**
   * Rows matched and every one of them was open in SOLIDWORKS or absent from disk. Nothing was
   * read, so the coverage and category sections have no files to be true about, even though the
   * scope itself was fine.
   */
  it('is false when rows matched but none of them could be read', () => {
    const view = buildVaultAuditView(
      reportOf([], { rowsInScope: 12, rowsConsidered: 12, filesCompared: 0, filesUnreadable: 12 }),
    )

    expect(hasEvidence(view)).toBe(false)
  })

  it('is true once a single file has been compared', () => {
    const view = buildVaultAuditView(reportOf([conflicting()], { rowsInScope: 1 }))

    expect(hasEvidence(view)).toBe(true)
  })
})

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
      'absent-from-file',
      'unattributed',
    ])
  })

  it('always lists every category, including the empty ones', () => {
    expect(view.categories).toHaveLength(5)
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

describe('resolutionOf', () => {
  it('offers exactly one direction when only one side holds the value', () => {
    expect(resolutionOf('recoverable', 'config_tab', 'part')).toBe('adopt-file-value')
    expect(resolutionOf('absent-from-file', 'description', 'part')).toBe('push-vault-value')
    expect(resolutionOf('recoverable', 'revision', 'part')).toBe('adopt-file-value')
    expect(resolutionOf('absent-from-file', 'revision', 'part')).toBe('file-is-authoritative')
  })

  it('asks a person to pick only when both copies are candidates', () => {
    expect(resolutionOf('conflicting', 'part_number', 'part')).toBe('choose-a-side')
  })

  it('lets the file revision settle a conflict without asking', () => {
    expect(resolutionOf('conflicting', 'revision', 'part')).toBe('adopt-file-value')
    expect(resolutionOf('conflicting', 'revision', 'drawing')).toBe('adopt-file-value')
  })

  it("sends a conflict over a drawing's projected fields to the model", () => {
    expect(resolutionOf('conflicting', 'part_number', 'drawing')).toBe('fix-on-parent-model')
    expect(resolutionOf('unattributed', 'description', 'drawing')).toBe('fix-on-parent-model')
  })

  // The projection rule guards the direction that reads the document as evidence. Filling a
  // drawing's empty title block from the row is not that direction - the row's copy already came
  // from the model - so it stays a plain push.
  it('still pushes into a drawing the row already describes', () => {
    expect(resolutionOf('absent-from-file', 'part_number', 'drawing')).toBe('push-vault-value')
  })

  it('names no write where there is nothing to copy or nothing to claim', () => {
    expect(resolutionOf('lost', 'config_description', 'part')).toBe('nothing-to-restore')
    expect(resolutionOf('unattributed', 'description', 'part')).toBe('leave-alone')
  })
})

describe('buildVaultAuditView - a value the record holds and the file does not', () => {
  const view = buildVaultAuditView(
    reportOf([
      compare('SPACER.SLDPRT', rowOf({ description: 'Spacer, mild steel' }), {
        configurations: ['Default'],
        fileProperties: {},
        configurationProperties: { Default: {} },
      }),
    ]),
  )

  // It used to be classified `intact` alongside the agreements, so the page showed nothing at all
  // for a document whose description had never been written.
  it('reports it rather than counting it as agreement', () => {
    const finding = view.findings.find((candidate) => candidate.field === 'description')
    expect(finding?.kind).toBe('absent-from-file')
    expect(finding?.databaseValue).toBe('Spacer, mild steel')
    expect(finding?.fileValue).toBeNull()
  })

  it('names the write that settles it', () => {
    const finding = view.findings.find((candidate) => candidate.field === 'description')
    expect(finding?.resolution).toBe('push-vault-value')
  })
})

describe('buildVaultAuditView - an empty run', () => {
  const view = buildVaultAuditView(reportOf([]))

  it('produces every category at zero rather than none at all', () => {
    expect(view.categories).toHaveLength(5)
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

// ============================================
// Whose field the revision is
// ============================================

describe('documentCarriesField', () => {
  const drawingDriven = { expectRevisionOnModels: false }
  const modelRevised = { expectRevisionOnModels: true }

  it('does not expect a revision on a model when the drawings drive them', () => {
    expect(documentCarriesField('revision', 'part', drawingDriven)).toBe(false)
    expect(documentCarriesField('revision', 'assembly', drawingDriven)).toBe(false)
  })

  // The option exists to serve the drawing-driven convention, so the drawing itself is the one
  // document it must never write - a drawing states its own revision under either setting.
  it('always expects a revision on a drawing', () => {
    expect(documentCarriesField('revision', 'drawing', drawingDriven)).toBe(true)
    expect(documentCarriesField('revision', 'drawing', modelRevised)).toBe(true)
  })

  it('expects one on a model for a shop that revises models', () => {
    expect(documentCarriesField('revision', 'part', modelRevised)).toBe(true)
  })

  it('never withholds any other field', () => {
    for (const field of [
      'part_number',
      'description',
      'config_tab',
      'config_description',
    ] as const) {
      expect(documentCarriesField(field, 'part', drawingDriven)).toBe(true)
    }
  })
})

describe('buildVaultAuditView - a model with no revision under a drawing-driven convention', () => {
  /** BluePLM holds `A`; the model states nothing, which is the intended state rather than a gap. */
  function modelMissingRevision() {
    return compare('SCREW.SLDPRT', rowOf({ revision: 'A', description: 'Phillips Screw' }), {
      configurations: ['Default'],
      fileProperties: {},
      configurationProperties: { Default: {} },
    })
  }

  const hidden = buildVaultAuditView(reportOf([modelMissingRevision()]))
  const shown = buildVaultAuditView(reportOf([modelMissingRevision()]), {
    expectRevisionOnModels: true,
  })

  it('reports no finding for the revision by default', () => {
    expect(hidden.findings.some((finding) => finding.field === 'revision')).toBe(false)
  })

  // The exclusion is the largest one on the page in a vault like this, and a filter whose effect is
  // invisible is how a reassuring total comes to stand over values nobody was told about.
  it('says how many it left out rather than dropping them silently', () => {
    expect(hidden.revisionOnModelsHidden).toBe(1)
  })

  it('leaves the other fields on the same model alone', () => {
    const description = hidden.findings.find((finding) => finding.field === 'description')
    expect(description?.kind).toBe('absent-from-file')
  })

  it('keeps the excluded value out of the category counts too, not just the table', () => {
    const absent = hidden.categories.find((category) => category.kind === 'absent-from-file')
    expect(absent?.valueCount).toBe(1)
  })

  it('brings it back, as a finding and out of the hidden count, when asked to', () => {
    const revision = shown.findings.find((finding) => finding.field === 'revision')
    expect(revision?.kind).toBe('absent-from-file')
    expect(revision?.resolution).toBe('file-is-authoritative')
    expect(shown.revisionOnModelsHidden).toBe(0)
  })
})

describe('buildVaultAuditView - a drawing is never covered by the model revision rule', () => {
  const view = buildVaultAuditView(
    reportOf([
      compare(
        'SCREW.SLDDRW',
        rowOf({ revision: 'A' }),
        {
          configurations: ['Default'],
          fileProperties: { Revision: 'B' },
          configurationProperties: { Default: {} },
        },
        'drawing',
      ),
    ]),
  )

  it('still reports a drawing whose revision disagrees with the record', () => {
    const finding = view.findings.find((candidate) => candidate.field === 'revision')
    expect(finding?.kind).toBe('conflicting')
    // The file states its own revision, so there is nothing for a person to choose.
    expect(finding?.resolution).toBe('adopt-file-value')
    expect(view.revisionOnModelsHidden).toBe(0)
  })
})
