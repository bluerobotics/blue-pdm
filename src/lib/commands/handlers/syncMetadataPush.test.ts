/**
 * PUSH, and the difference between "this document has no configurations" and "I could not find
 * out".
 *
 * Finding B1. `getConfigurations` returns `{ success: false, error }` with no `data` when the
 * service cannot open the document, and the old reader went straight to `result?.data?.configurations`
 * - which is `undefined` on a failure and on a document with none alike. So a failed read produced
 * an empty configuration list, the plan built for the document's own property bag and nothing else,
 * `writeMetadataWithVerification` confirmed that one scope perfectly honestly, and the user was told
 * "PUSH complete - confirmed in the file" over a document whose sixty-eight configurations still
 * held the previous part number.
 *
 * The fix is a refusal: nothing is written at all. The tests below pin both halves - that the
 * refusal happens and reaches the user, and that the ordinary path still writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalFile } from '../types'

import { pushPartAssemblyMetadata } from './syncMetadataPush'

const writeMetadataWithVerification = vi.fn()
const getConfigurations = vi.fn()

vi.mock('@/lib/metadata/writeMetadataToFile', () => ({
  writeMetadataWithVerification: (...args: unknown[]) => writeMetadataWithVerification(...args),
}))

vi.mock('@/lib/serialization', () => ({
  getSerializationSettings: vi.fn(async () => null),
  combineBaseAndTab: (base: string, tab: string) => `${base}-${tab}`,
  normalizeTabNumber: (tab: string) => tab,
}))

vi.mock('./syncMetadataCommon', () => ({
  WATCHER_SUPPRESSION_MS: 0,
  logSync: vi.fn(),
}))

// Delegates to the real English dictionary rather than echoing the key, so the assertions below
// are made against the sentence the user actually reads. `t` itself cannot be used directly here:
// it resolves the active language through the store, which this suite does not stand up.
vi.mock('@/lib/i18n', async () => {
  const { getTranslation } = await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n')
  return {
    t: (key: string, fallbackOrParams?: string | Record<string, string | number>) =>
      getTranslation('en', key, fallbackOrParams),
  }
})

const store = {
  organization: { id: 'org-1' },
  user: { id: 'user-1', full_name: 'Test User', email: 'test@example.com' },
  addExpectedFileChanges: vi.fn(),
  clearExpectedFileChanges: vi.fn(),
  recordMetadataWriteStates: vi.fn(),
  updateFileInStore: vi.fn(),
}

vi.mock('@/stores/pdmStore', () => ({
  usePDMStore: { getState: () => store },
}))

const PATH = 'C:\\vault\\Parts\\ORING-BUNA-70A.SLDPRT'

function installWindow(electronAPI: unknown): void {
  globalThis.window = { electronAPI } as unknown as Window & typeof globalThis
}

/** A part BluePLM holds a number and a description for, and the file does not yet agree. */
const FILE = {
  path: PATH,
  relativePath: 'Parts\\ORING-BUNA-70A.SLDPRT',
  extension: '.sldprt',
  pdmData: { part_number: 'BR-202020', description: 'O-ring, Buna-N 70A' },
  pendingMetadata: undefined,
} as unknown as LocalFile

beforeEach(() => {
  vi.clearAllMocks()
  getConfigurations.mockReset()
  writeMetadataWithVerification.mockReset().mockResolvedValue({
    outcome: 'verified',
    addresses: [{ address: { scope: 'file', field: 'part_number' }, state: 'verified' }],
    unrecordedFailures: [],
    unaddressedConfigurations: [],
    writeMs: 1,
    readBackMs: 1,
    document: null,
  })

  // The command only touches two of the fifty-odd members of the Electron surface.
  installWindow({ solidworks: { getConfigurations }, hashFile: async () => ({ success: true }) })
})

describe('when the configuration list cannot be read', () => {
  it('writes nothing rather than the document bag alone', async () => {
    getConfigurations.mockResolvedValue({ success: false, error: 'the document is in use' })

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(writeMetadataWithVerification).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })

  it('tells the user why nothing was written', async () => {
    getConfigurations.mockResolvedValue({ success: false, error: 'the document is in use' })

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(result.error).toMatch(/Nothing was written/i)
    expect(result.error).toMatch(/configuration/i)
  })

  it('refuses when the service is not there at all', async () => {
    installWindow({})

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(writeMetadataWithVerification).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })

  it('refuses when the call throws rather than returning a failure', async () => {
    getConfigurations.mockRejectedValue(new Error('the pipe closed'))

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(writeMetadataWithVerification).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })
})

describe('when the list is read successfully', () => {
  it('writes, and asks the verifier to hold the plan to the whole document', async () => {
    getConfigurations.mockResolvedValue({
      success: true,
      data: { configurations: [{ name: 'Default', isActive: true, properties: {} }] },
    })

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(result.success).toBe(true)
    expect(writeMetadataWithVerification).toHaveBeenCalledWith(
      expect.objectContaining({ path: PATH, coverage: 'whole-document' }),
    )
  })

  it('accepts a document that genuinely has no configurations', async () => {
    // The other side of the distinction: an empty list that the service actually reported is a
    // real answer, and refusing it would break every document that keeps its metadata at file
    // level.
    getConfigurations.mockResolvedValue({ success: true, data: { configurations: [] } })

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(result.success).toBe(true)
    expect(writeMetadataWithVerification).toHaveBeenCalled()
  })

  it('reports a shortfall the verdicts cannot express', async () => {
    getConfigurations.mockResolvedValue({
      success: true,
      data: { configurations: [{ name: 'Default', isActive: true, properties: {} }] },
    })
    writeMetadataWithVerification.mockResolvedValue({
      outcome: 'partial',
      addresses: [{ address: { scope: 'file', field: 'part_number' }, state: 'verified' }],
      unrecordedFailures: [],
      unaddressedConfigurations: ['AS568-014', 'AS568-015'],
      writeMs: 1,
      readBackMs: 1,
      document: null,
    })

    const result = await pushPartAssemblyMetadata(FILE, PATH)

    expect(result.success).toBe(false)
    expect(result.error).toContain('2')
  })
})
