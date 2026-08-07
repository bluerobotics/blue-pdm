import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()

vi.mock('./client', () => ({ getSupabaseClient: () => ({ rpc }) }))
vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { applyConfigMapRepair, ConfigMapRepairNotInstalledError } = await import('./configMapRepair')

import type { VaultAuditRepairFile } from '@/types/vaultAudit'

const FILE_ID = '00000000-0000-0000-0000-0000000000f1'
const ORG_ID = '00000000-0000-0000-0000-00000000a001'

const request: VaultAuditRepairFile[] = [
  {
    fileId: FILE_ID,
    relativePath: '0 - SHARED\\ORING-BUNA-70A.SLDPRT',
    maps: { _config_tabs: { '-019': '-019' } },
  },
]

function answers(data: unknown) {
  rpc.mockResolvedValueOnce({ data, error: null })
}

beforeEach(() => {
  rpc.mockReset()
})

describe('what crosses the wire', () => {
  it('sends configuration names and values, and no instruction about how to merge them', async () => {
    answers({})
    await applyConfigMapRepair(ORG_ID, request)

    expect(rpc).toHaveBeenCalledWith('repair_config_maps', {
      p_org_id: ORG_ID,
      p_repairs: [{ file_id: FILE_ID, maps: { _config_tabs: { '-019': '-019' } } }],
    })
  })
})

describe('reading the receipt', () => {
  it('reports what the database says it added, per map', async () => {
    answers({
      files_requested: 1,
      files_updated: 1,
      entries_requested: 3,
      entries_added: 2,
      files: [
        {
          file_id: FILE_ID,
          file_path: '0 - SHARED\\ORING-BUNA-70A.SLDPRT',
          updated: true,
          refused: null,
          maps: { _config_tabs: { added: 2 }, _config_descriptions: { added: 0 } },
        },
      ],
    })

    const outcome = await applyConfigMapRepair(ORG_ID, request)

    expect(outcome.entriesAdded).toBe(2)
    expect(outcome.filesUpdated).toBe(1)
    expect(outcome.files[0].added).toEqual({ _config_tabs: 2, _config_descriptions: 0 })
    expect(outcome.files[0].refused).toBeNull()
  })

  // Fewer added than requested is the ordinary answer when the row moved between scan and apply.
  // It has to survive the boundary intact, because it is what the interface says out loud.
  it('keeps a shortfall visible rather than reconciling it', async () => {
    answers({ entries_requested: 5, entries_added: 1, files_requested: 1, files_updated: 1 })

    const outcome = await applyConfigMapRepair(ORG_ID, request)

    expect(outcome.entriesRequested - outcome.entriesAdded).toBe(4)
  })

  it('carries a per-file refusal through instead of throwing on it', async () => {
    answers({
      files_requested: 1,
      files_updated: 0,
      entries_requested: 1,
      entries_added: 0,
      files: [{ file_id: FILE_ID, updated: false, refused: 'file-not-found', maps: {} }],
    })

    const outcome = await applyConfigMapRepair(ORG_ID, request)

    expect(outcome.files[0].refused).toBe('file-not-found')
    expect(outcome.files[0].updated).toBe(false)
  })

  it('notes a map the row never carried, which is not a gap and is not an error', async () => {
    answers({
      files: [
        {
          file_id: FILE_ID,
          updated: false,
          maps: { _config_tabs: { refused: 'map-absent' } },
        },
      ],
    })

    const outcome = await applyConfigMapRepair(ORG_ID, request)

    expect(outcome.files[0].mapsAbsent).toEqual(['_config_tabs'])
    expect(outcome.files[0].added._config_tabs).toBeUndefined()
  })

  // A file missing from the receipt would read as a file nobody asked about. Zero, not absent.
  it('keeps an unreadable entry in the list rather than dropping it', async () => {
    answers({ files: [null, 7] })

    const outcome = await applyConfigMapRepair(ORG_ID, request)

    expect(outcome.files).toHaveLength(2)
    expect(outcome.files.every((file) => file.updated === false)).toBe(true)
  })

  it('survives a database that answers with nothing at all', async () => {
    answers(null)

    await expect(applyConfigMapRepair(ORG_ID, request)).resolves.toEqual({
      filesRequested: 0,
      filesUpdated: 0,
      entriesRequested: 0,
      entriesAdded: 0,
      files: [],
    })
  })
})

describe('a database that does not have the function', () => {
  it('says so, rather than blaming the request', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function repair_config_maps(...) does not exist' },
    })

    await expect(applyConfigMapRepair(ORG_ID, request)).rejects.toBeInstanceOf(
      ConfigMapRepairNotInstalledError,
    )
  })

  it('does not swallow any other refusal', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'not a member of this organization' },
    })

    await expect(applyConfigMapRepair(ORG_ID, request)).rejects.toThrow(
      'not a member of this organization',
    )
  })
})
