/**
 * How check-in treats each write state.
 *
 * Check-in used to promote whatever it found pending and clear it, on the assumption that the
 * datacard had already written the value into the file. When that write had failed, the database
 * silently took a value the file did not have and nothing recorded it. These tests pin the
 * replacement: write what is owed, promote either way, and keep the mark on anything that could not
 * be confirmed - so the pending value's disappearance never takes the record of doubt with it.
 *
 * The SolidWorks service is stubbed. The convention it does not yet honour - an empty value must
 * write an empty property rather than delete it - lives in C# and is owned elsewhere, so what can be
 * tested here is that this side sends the empty value and treats its absence afterwards as the value
 * being right. When the service starts writing the empty property, these tests must keep passing
 * unchanged: the value is the same either way, only the shape left behind differs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settleMetadataForCheckin, unwrittenAddresses } from './checkinMetadata'
import { addressKey, applyWriteState, type MetadataWriteStateRecord } from './writeState'
import type { LocalFile } from '@/stores/types'

vi.mock('@/lib/serialization', () => ({
  getSerializationSettings: vi.fn(async () => null),
  combineBaseAndTab: (base: string, tab: string) => `${base}-${tab}`,
  normalizeTabNumber: (value: string) => value,
}))

const AT = '2026-08-06T12:00:00.000Z'

function file(overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: 'ORING-BUNA-70A.SLDPRT',
    path: 'C:\\vault\\ORING-BUNA-70A.SLDPRT',
    relativePath: 'ORING-BUNA-70A.SLDPRT',
    extension: '.sldprt',
    isDirectory: false,
    size: 1024,
    pdmData: { id: 'file-1', part_number: 'BR-101010' },
    ...overrides,
  } as LocalFile
}

interface Stub {
  setProperties: ReturnType<typeof vi.fn>
  setPropertiesBatch: ReturnType<typeof vi.fn>
  getProperties: ReturnType<typeof vi.fn>
  getConfigurations: ReturnType<typeof vi.fn>
}

let stub: Stub

function installService(options: {
  writeSucceeds?: boolean
  readBack?: Record<string, string> | 'throw'
  configurations?: string[]
  configurationReadBack?: Record<string, Record<string, string>>
}): Stub {
  const configurations = options.configurations ?? []
  const service: Stub = {
    setProperties: vi.fn(async () => ({ success: options.writeSucceeds !== false })),
    setPropertiesBatch: vi.fn(
      async (_path: string, configProperties: Record<string, Record<string, string>>) => ({
        success: options.writeSucceeds !== false,
        data: { configurationsProcessed: Object.keys(configProperties).length },
      }),
    ),
    getProperties: vi.fn(async () => {
      if (options.readBack === 'throw') return { success: false, error: 'the document is locked' }
      return {
        success: true,
        data: {
          configurations,
          fileProperties: options.readBack ?? {},
          configurationProperties: options.configurationReadBack ?? {},
        },
      }
    }),
    getConfigurations: vi.fn(async () => ({
      success: true,
      data: { configurations: configurations.map((name) => ({ name })) },
    })),
  }

  // @ts-expect-error the test only needs the SolidWorks surface this module touches
  globalThis.window = { electronAPI: { solidworks: service } }
  return service
}

beforeEach(() => {
  stub = installService({ readBack: {} })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('which addresses check-in still owes the file', () => {
  it('owes a field with no recorded state, since nothing ever confirmed it', () => {
    const owed = unwrittenAddresses(file({ pendingMetadata: { part_number: 'BR-202020' } }))

    expect(owed.map(addressKey)).toEqual(['file:part_number'])
  })

  it('owes a field whose write failed', () => {
    const record = applyWriteState(undefined, [{ scope: 'file', field: 'part_number' }], 'failed', {
      at: AT,
    })
    const owed = unwrittenAddresses(
      file({ pendingMetadata: { part_number: 'BR-202020' }, metadataWriteState: record }),
    )

    expect(owed).toHaveLength(1)
  })

  it('owes nothing for a confirmed field, so check-in does not redo work already done', () => {
    const record = applyWriteState(
      undefined,
      [{ scope: 'file', field: 'part_number' }],
      'verified',
      { at: AT },
    )
    const owed = unwrittenAddresses(
      file({ pendingMetadata: { part_number: 'BR-202020' }, metadataWriteState: record }),
    )

    expect(owed).toHaveLength(0)
  })

  it('does not owe a write for an unconfirmed field, because a second write could not settle it', () => {
    const record = applyWriteState(
      undefined,
      [{ scope: 'file', field: 'part_number' }],
      'unverified',
      { at: AT },
    )
    const owed = unwrittenAddresses(
      file({ pendingMetadata: { part_number: 'BR-202020' }, metadataWriteState: record }),
    )

    expect(owed).toHaveLength(0)
  })
})

describe('a confirmed value is promoted with nothing left to say', () => {
  it('keeps no record once the file and the database agree', async () => {
    stub = installService({ readBack: { Number: 'BR-202020' } })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('writes the value before promoting it, rather than assuming the datacard did', async () => {
    stub = installService({ readBack: { Number: 'BR-202020' } })

    await settleMetadataForCheckin(file({ pendingMetadata: { part_number: 'BR-202020' } }), {
      organizationId: null,
      serviceAvailable: true,
    })

    expect(stub.setProperties).toHaveBeenCalledTimes(1)
    expect(stub.getProperties).toHaveBeenCalledTimes(1)
  })

  it('does not touch the file when everything is already confirmed', async () => {
    const record = applyWriteState(
      undefined,
      [{ scope: 'file', field: 'part_number' }],
      'verified',
      { at: AT },
    )

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' }, metadataWriteState: record }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(stub.setProperties).not.toHaveBeenCalled()
    expect(outcome.writeState).toBeUndefined()
  })
})

describe('an unconfirmed value is promoted and marked', () => {
  it('promotes a value the file refused, and says so rather than silently accepting it', async () => {
    // The value is the user's and the database owns it, so withholding it would lose the edit. What
    // must not happen is promoting it as though the file had taken it.
    stub = installService({ readBack: { Number: 'BR-101010' } })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.promotedUnconfirmed.map(addressKey)).toEqual(['file:part_number'])
    expect(outcome.writeState?.fields?.part_number?.state).toBe('failed')
    expect(outcome.writeState?.fields?.part_number?.promoted).toBe(true)
  })

  it('marks a write it could not read back as unconfirmed, not as failed', async () => {
    stub = installService({ readBack: 'throw' })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.writeState?.fields?.part_number?.state).toBe('unverified')
    expect(outcome.writeState?.fields?.part_number?.promoted).toBe(true)
  })

  it('marks a write it could not issue as unattempted, and does not block the check-in', async () => {
    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: false },
    )

    expect(stub.setProperties).not.toHaveBeenCalled()
    expect(outcome.writeState?.fields?.part_number?.state).toBe('unattempted')
    expect(outcome.writeState?.fields?.part_number?.promoted).toBe(true)
  })

  it('marks a refused write as failed', async () => {
    stub = installService({ writeSucceeds: false })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.writeState?.fields?.part_number?.state).toBe('failed')
    expect(stub.getProperties).not.toHaveBeenCalled()
  })

  it('keeps the mark for the two configurations that refused and drops the 66 that did not', async () => {
    const configurations = Array.from({ length: 68 }, (_, index) => `AS568-${String(index).padStart(3, '0')}`)
    const service = installService({ configurations })
    service.getProperties = vi.fn(async () => ({
      success: true,
      data: {
        configurations,
        fileProperties: {},
        configurationProperties: Object.fromEntries(
          configurations.map((name, index) => [
            name,
            index < 66 ? { 'Tab Number': String(index) } : {},
          ]),
        ),
      },
    }))
    stub = service

    const outcome = await settleMetadataForCheckin(
      file({
        pendingMetadata: {
          config_tabs: Object.fromEntries(configurations.map((name, index) => [name, String(index)])),
        },
      }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.promotedUnconfirmed).toHaveLength(2)
    expect(Object.keys(outcome.writeState?.config_tabs ?? {})).toEqual(['AS568-066', 'AS568-067'])
  })
})

describe('an address the write never reached is not a confirmed one', () => {
  // `keepOnlyUnconfirmed` used to read an unrecorded address as confirmed, twelve lines after
  // `unwrittenAddresses` had read the same absence as owing a write. The confirmed reading ran
  // last, so the value went to the database, the mark was cleared and the file was never touched.
  // Each of these is an ordinary edit that produced no verdict at all.

  it('does not confirm a pending edit for a configuration the document no longer has', async () => {
    stub = installService({ configurations: ['Default'] })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { config_descriptions: { 'AS568-014': 'O-ring, Viton' } } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.promotedUnconfirmed.map(addressKey)).toEqual([
      'configuration:config_description:AS568-014',
    ])
    expect(outcome.writeState?.config_descriptions?.['AS568-014']).toMatchObject({
      state: 'unattempted',
      promoted: true,
    })
  })

  it('writes a file-scope tab number on a multi-configuration document rather than dropping it', async () => {
    // Reachable through the Sync Metadata pull. The plan emitted no group for it, so nothing was
    // written and nothing was recorded.
    stub = installService({ configurations: ['Default', 'AS568-014'] })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { tab_number: '014' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(stub.setProperties).toHaveBeenCalledTimes(1)
    expect(outcome.promotedUnconfirmed.map(addressKey)).toEqual(['file:tab_number'])
  })

  it('confirms the file-level description separately from the base configuration’s own', async () => {
    // Editing both took the per-configuration branch and never emitted the file-scope intent, so
    // the file-level description reached the database unwritten and unmarked.
    stub = installService({
      configurations: ['Default'],
      readBack: {},
      configurationReadBack: { Default: { Description: 'Viton, 014' } },
    })

    const outcome = await settleMetadataForCheckin(
      file({
        pendingMetadata: {
          description: 'Viton o-ring',
          config_descriptions: { Default: 'Viton, 014' },
        },
      }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.promotedUnconfirmed.map(addressKey)).toEqual(['file:description'])
    expect(outcome.writeState?.config_descriptions?.['Default']).toBeUndefined()
  })

  it('writes nothing when the document’s configurations could not be read', async () => {
    // An empty list and a failed call used to be the same value. Planning a file-scope write off a
    // failed call is the worst available answer: the read-back finds what the write just put at
    // file level and reports `verified`, while the configurations keep the old number.
    const service = installService({ readBack: { Number: 'BR-202020' } })
    service.getConfigurations = vi.fn(async () => ({
      success: false,
      error: 'the document is locked',
    }))
    stub = service

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(stub.setProperties).not.toHaveBeenCalled()
    expect(outcome.writeState?.fields?.part_number).toMatchObject({
      state: 'unattempted',
      promoted: true,
    })
  })

  it('still writes a drawing, which has no configurations to read', async () => {
    const service = installService({ readBack: { Revision: 'B' } })
    service.getConfigurations = vi.fn(async () => ({ success: false, error: 'not a model' }))
    stub = service

    const outcome = await settleMetadataForCheckin(
      file({ name: 'ORING.SLDDRW', extension: '.slddrw', pendingMetadata: { revision: 'B' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(stub.getConfigurations).not.toHaveBeenCalled()
    expect(outcome.writeState).toBeUndefined()
  })
})

describe('files with nothing to write', () => {
  it('has nothing to confirm on a file that cannot hold custom properties', async () => {
    const outcome = await settleMetadataForCheckin(
      file({ extension: '.step', pendingMetadata: { part_number: 'BR-202020' } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(stub.setProperties).not.toHaveBeenCalled()
    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('leaves a file with no pending edits alone', async () => {
    const outcome = await settleMetadataForCheckin(file(), {
      organizationId: null,
      serviceAvailable: true,
    })

    expect(stub.setProperties).not.toHaveBeenCalled()
    expect(outcome.writeState).toBeUndefined()
  })

  it('keeps a record about a value an earlier check-in already promoted', async () => {
    // The mark outliving the pending value is the point: a previous check-in put this in the database
    // without confirming it in the file, and a check-in that finds nothing pending must not read that
    // as nothing to say.
    const record: MetadataWriteStateRecord = {
      fields: { part_number: { state: 'failed', at: AT, promoted: true } },
    }

    const outcome = await settleMetadataForCheckin(file({ metadataWriteState: record }), {
      organizationId: null,
      serviceAvailable: true,
    })

    expect(outcome.writeState?.fields?.part_number?.state).toBe('failed')
    expect(outcome.writeState?.fields?.part_number?.promoted).toBe(true)
  })
})

describe('clearing a field at check-in', () => {
  it('sends the empty value rather than omitting the property', async () => {
    stub = installService({ readBack: {} })

    await settleMetadataForCheckin(file({ pendingMetadata: { description: null } }), {
      organizationId: null,
      serviceAvailable: true,
    })

    const [, properties] = stub.setProperties.mock.calls[0]

    expect('Description' in (properties as Record<string, string>)).toBe(true)
    expect((properties as Record<string, string>)['Description']).toBe('')
  })

  it('counts a cleared field as confirmed when the file reads back with no value', async () => {
    // The service deletes the property instead of emptying it, so the read-back finds it absent. By
    // value that is correct, and by value is what this side can honestly check.
    stub = installService({ readBack: {} })

    const outcome = await settleMetadataForCheckin(
      file({ pendingMetadata: { description: null } }),
      { organizationId: null, serviceAvailable: true },
    )

    expect(outcome.promotedUnconfirmed).toHaveLength(0)
    expect(outcome.writeState).toBeUndefined()
  })
})
