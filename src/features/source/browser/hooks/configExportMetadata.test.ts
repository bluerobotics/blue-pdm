/**
 * What a configuration export carries after the user clears a field.
 *
 * The exported file leaves the building. Its filename and its title block are read by a vendor, so
 * a value that is one edit out of date arrives wrong somewhere BluePLM cannot correct it - which is
 * why every field here goes through the overlay in the first place.
 *
 * The overlay was not enough on its own. `.value` is null for a field the user cleared and for one
 * neither side ever set, and this module chained `||` from the overlay to what the configuration
 * tree had read out of the document. So clearing a configuration's description and exporting it
 * resurrected the description from the file, in the deliverable, silently.
 */

import { describe, expect, it, vi } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'

import { buildConfigurationExportMetadata } from './configExportMetadata'

vi.mock('@/lib/serialization', () => ({
  getSerializationSettings: vi.fn(async () => null),
  combineBaseAndTab: (base: string, tab: string) => `${base}-${tab}`,
}))

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/** The tree read these out of the document; they are the values the export used to fall back to. */
const LOADED = { tabNumber: '014', description: 'O-ring, Buna-N 70A' }

function fileWith(pendingMetadata: LocalFile['pendingMetadata']): LocalFile {
  return {
    pendingMetadata,
    pdmData: {
      part_number: 'BR-202020',
      description: 'O-ring, Buna-N 70A',
      revision: 'B',
      custom_properties: {
        _config_tabs: { 'AS568-014': '014' },
        _config_descriptions: { 'AS568-014': 'O-ring, Buna-N 70A' },
      },
    },
  } as unknown as LocalFile
}

async function exported(pendingMetadata: LocalFile['pendingMetadata']) {
  return buildConfigurationExportMetadata({
    file: fileWith(pendingMetadata),
    configuration: 'AS568-014',
    loaded: LOADED,
    organizationId: 'org-1',
  })
}

describe('a configuration export after a clear', () => {
  it('exports the cleared description as blank, not as the document’s copy of it', async () => {
    const metadata = await exported({ config_descriptions: { 'AS568-014': '' } })

    expect(metadata.description).toBe('')
  })

  it('exports the cleared tab as blank rather than the one the tree loaded', async () => {
    const metadata = await exported({ config_tabs: { 'AS568-014': '' } })

    expect(metadata.tabNumber).toBe('')
    expect(metadata.partNumber).toBe('BR-202020')
  })

  it('still falls through to the document for a field neither side ever set', async () => {
    // The other half of the distinction, and the reason `||` was there. A configuration BluePLM
    // holds no description for should carry the document's, not a blank.
    const metadata = await buildConfigurationExportMetadata({
      file: {
        pendingMetadata: undefined,
        pdmData: { part_number: 'BR-202020', revision: 'B', custom_properties: {} },
      } as unknown as LocalFile,
      configuration: 'AS568-014',
      loaded: LOADED,
      organizationId: 'org-1',
    })

    expect(metadata.description).toBe('O-ring, Buna-N 70A')
    expect(metadata.tabNumber).toBe('014')
  })

  it('takes an edited value over both the committed one and the document', async () => {
    const metadata = await exported({ config_descriptions: { 'AS568-014': 'O-ring, FKM 75A' } })

    expect(metadata.description).toBe('O-ring, FKM 75A')
  })
})
