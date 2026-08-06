/**
 * A failed write keeps the value the user typed, and marks it.
 *
 * For one release this function did the opposite: nothing reached the file, so the edit was taken
 * back out. That was the only defence available - `pendingMetadata` was the sole record the edit
 * existed and check-in promoted whatever it found there, so a value left behind by a failed write
 * would arrive in the database looking exactly like one the file had accepted. Deleting the keystroke
 * was the lesser of two data losses, and it was shipped as a compromise rather than a design.
 *
 * These tests are the replacement's guarantee. Whatever the outcome, the value stays pending; what
 * changes is the mark it carries.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reportMetadataWrite, unattemptedWrite } from './reportMetadataWrite'
import { applyWriteStates, type MetadataWriteStateRecord } from './writeState'
import type { PendingMetadata, PendingMetadataEdit } from '@/stores/types'

/** The store as this module uses it, with the write-state recording done for real. */
const store = {
  pendingMetadata: undefined as PendingMetadata | undefined,
  metadataWriteState: undefined as MetadataWriteStateRecord | undefined,
  toasts: [] as { level: string; message: string }[],
  addToast: vi.fn((level: string, message: string) => {
    store.toasts.push({ level, message })
  }),
  recordMetadataWriteStates: vi.fn(
    (_path: string, entries: Parameters<typeof applyWriteStates>[1]) => {
      store.metadataWriteState = applyWriteStates(store.metadataWriteState, entries)
    },
  ),
  updatePendingMetadata: vi.fn(),
  clearPendingMetadata: vi.fn(),
}

vi.mock('@/stores/pdmStore', () => ({ usePDMStore: { getState: () => store } }))

const PATH = 'C:\\vault\\ORING-BUNA-70A.SLDPRT'

const edit: PendingMetadataEdit = {
  path: PATH,
  fields: ['part_number'],
  pending: { part_number: 'BR-202020' },
}

beforeEach(() => {
  store.pendingMetadata = { part_number: 'BR-202020' }
  store.metadataWriteState = undefined
  store.toasts = []
  vi.clearAllMocks()
})

describe('a write that did not reach the file', () => {
  it('keeps the typed value and marks it failed', () => {
    reportMetadataWrite(edit, {
      outcome: 'failed',
      addresses: [
        {
          address: { scope: 'file', field: 'part_number' },
          state: 'failed',
          reason: 'the property is read-only',
        },
      ],
    })

    expect(store.pendingMetadata?.part_number).toBe('BR-202020')
    expect(store.metadataWriteState?.fields?.part_number?.state).toBe('failed')
    expect(store.metadataWriteState?.fields?.part_number?.reason).toBe('the property is read-only')
  })

  it('never reaches for a clear or an overwrite of the pending set', () => {
    reportMetadataWrite(edit, {
      outcome: 'failed',
      addresses: [{ address: { scope: 'file', field: 'part_number' }, state: 'failed' }],
    })

    expect(store.clearPendingMetadata).not.toHaveBeenCalled()
    expect(store.updatePendingMetadata).not.toHaveBeenCalled()
  })

  it('tells the user, at the severity the outcome deserves', () => {
    reportMetadataWrite(edit, {
      outcome: 'failed',
      addresses: [{ address: { scope: 'file', field: 'part_number' }, state: 'failed' }],
    })

    expect(store.toasts[0].level).toBe('error')
  })
})

describe('a write nobody could confirm', () => {
  it('marks unverified rather than failed, and warns rather than errors', () => {
    // Distinct on purpose: `failed` means the value is known not to be in the file, so a retry is the
    // whole remedy. This means nobody knows, and a retry may be rewriting a value already correct.
    reportMetadataWrite(edit, {
      outcome: 'unverified',
      addresses: [
        {
          address: { scope: 'file', field: 'part_number' },
          state: 'unverified',
          reason: 'the document could not be read back',
        },
      ],
    })

    expect(store.metadataWriteState?.fields?.part_number?.state).toBe('unverified')
    expect(store.toasts[0].level).toBe('warning')
  })
})

describe('a write that was never issued', () => {
  it('marks every address the edit touched as unattempted', () => {
    const report = unattemptedWrite(
      { path: PATH, fields: ['part_number'], pending: { part_number: 'BR-202020', revision: 'B' } },
      'the SolidWorks service is not running',
    )

    expect(report.outcome).toBe('unattempted')
    expect(report.addresses.map((entry) => entry.state)).toEqual(['unattempted', 'unattempted'])
  })

  it('does not claim the file might have changed', () => {
    reportMetadataWrite(
      edit,
      unattemptedWrite(edit, 'the SolidWorks service is not running'),
    )

    expect(store.metadataWriteState?.fields?.part_number?.state).toBe('unattempted')
    expect(store.pendingMetadata?.part_number).toBe('BR-202020')
  })
})

describe('a write that landed', () => {
  it('records the confirmation and says so plainly', () => {
    reportMetadataWrite(edit, {
      outcome: 'verified',
      addresses: [{ address: { scope: 'file', field: 'part_number' }, state: 'verified' }],
    })

    expect(store.metadataWriteState?.fields?.part_number?.state).toBe('verified')
    expect(store.toasts[0].level).toBe('success')
    // The value is still owed to the database until check-in promotes it.
    expect(store.pendingMetadata?.part_number).toBe('BR-202020')
  })
})

describe('a write that landed in some scopes and not others', () => {
  it('marks each configuration on its own evidence and reports the count, not a verdict', () => {
    reportMetadataWrite(
      { path: PATH, fields: ['config_tabs'], pending: {} },
      {
        outcome: 'partial',
        addresses: [
          {
            address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-014' },
            state: 'verified',
          },
          {
            address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-015' },
            state: 'failed',
            reason: 'the file holds "014" after the write',
          },
        ],
      },
    )

    expect(store.metadataWriteState?.config_tabs?.['AS568-014']?.state).toBe('verified')
    expect(store.metadataWriteState?.config_tabs?.['AS568-015']?.state).toBe('failed')
    expect(store.toasts[0].level).toBe('warning')
  })
})

describe('a file with nothing to write to', () => {
  it('records nothing and says nothing', () => {
    reportMetadataWrite(edit, { outcome: 'not-applicable', addresses: [] })

    expect(store.recordMetadataWriteStates).not.toHaveBeenCalled()
    expect(store.toasts).toHaveLength(0)
  })
})
