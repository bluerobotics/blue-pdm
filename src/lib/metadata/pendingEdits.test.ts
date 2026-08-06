/**
 * Cover for what removing the `pdmData` copy changed.
 *
 * `updatePendingMetadata` used to write the edited fields into `pdmData` as well as into
 * `pendingMetadata`. Two things followed from that and both are gone: an edit read back as a value
 * the server had confirmed, and there was nothing to undo when the write it was made for failed -
 * the copy stayed regardless. `pendingMetadata` is now the only record of the edit, and check-in
 * promotes whatever it finds there, so the two cases worth pinning are a failure leaving no
 * residue and a success leaving the edit alone until check-in delivers it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePartNumber, resolvedText } from './overlay'
import {
  applyPendingEdit,
  hasPendingMetadata,
  revertPendingEdit,
  shouldRevertPendingMetadata,
} from './pendingEdits'
import type { PDMFile } from '@/types/pdm'

const PATH = 'C:\\vault\\ORING-BUNA-70A.SLDPRT'

function committed(partNumber: string | null): PDMFile {
  return {
    part_number: partNumber,
    description: 'O-ring, NBR 70A',
    revision: 'A',
    custom_properties: null,
  } as PDMFile
}

describe('a write that never reached the file leaves no residue', () => {
  it('takes the edit back out, leaving the file with nothing pending', () => {
    const { pending, rollback } = applyPendingEdit(PATH, undefined, { part_number: 'PN-NEW' }, undefined)

    expect(pending.part_number).toBe('PN-NEW')
    expect(revertPendingEdit(pending, rollback)).toBeUndefined()
  })

  it('restores the value the field held before the edit, not just any value', () => {
    const first = applyPendingEdit(PATH, undefined, { part_number: 'PN-ONE' }, undefined)
    const second = applyPendingEdit(PATH, first.pending, { part_number: 'PN-TWO' }, 'modified')

    const restored = revertPendingEdit(second.pending, second.rollback)

    expect(restored?.part_number).toBe('PN-ONE')
  })

  it('leaves alone the earlier edits a later failure has nothing to do with', () => {
    // The description write landed and is still owed to the database. Reverting the renumber
    // must not take it with it, or check-in stops delivering a value the file already holds.
    const description = applyPendingEdit(PATH, undefined, { description: 'New title' }, undefined)
    const renumber = applyPendingEdit(PATH, description.pending, { part_number: 'PN-NEW' }, 'modified')

    const restored = revertPendingEdit(renumber.pending, renumber.rollback)

    expect(restored?.description).toBe('New title')
    expect(restored?.part_number).toBeUndefined()
  })

  it('undoes a clear as thoroughly as it undoes a value', () => {
    // A pending `null` is a deliberate clear, which is a different intention from never having
    // been set - and the one the old `||` overlays kept getting wrong.
    const { pending, rollback } = applyPendingEdit(PATH, undefined, { part_number: null }, undefined)

    expect(pending.part_number).toBeNull()
    expect(revertPendingEdit(pending, rollback)).toBeUndefined()
  })

  it('puts a configuration map back to the configurations it named before', () => {
    const first = applyPendingEdit(PATH, undefined, { config_tabs: { 'AS568-014': '014' } }, undefined)
    const second = applyPendingEdit(PATH, first.pending, { config_tabs: { 'AS568-015': '015' } }, 'modified')

    expect(Object.keys(second.pending.config_tabs ?? {})).toEqual(['AS568-014', 'AS568-015'])

    const restored = revertPendingEdit(second.pending, second.rollback)

    expect(restored?.config_tabs).toEqual({ 'AS568-014': '014' })
  })

  it('carries the diff status the file had before the edit, so nothing is left looking modified', () => {
    const { rollback } = applyPendingEdit(PATH, undefined, { part_number: 'PN-NEW' }, undefined)

    expect(rollback.previousDiffStatus).toBeUndefined()
    expect(rollback.fields).toEqual(['part_number'])
  })

  it('does nothing when the edit recorded nothing', () => {
    const pending = { part_number: 'PN-NEW' }

    expect(
      revertPendingEdit(pending, {
        path: PATH,
        fields: [],
        previous: undefined,
        previousDiffStatus: undefined,
      }),
    ).toBe(pending)
  })
})

describe('a pending edit survives until the write is confirmed', () => {
  it('keeps the edit when the write landed, because the database has not had it yet', () => {
    expect(shouldRevertPendingMetadata('landed')).toBe(false)
  })

  it('keeps the edit when only some configurations took it', () => {
    // The value is in the file for the ones that did. Dropping it would guarantee the divergence
    // rather than prevent it.
    expect(shouldRevertPendingMetadata('partial')).toBe(false)
  })

  it('keeps the edit on files that have no property write at all', () => {
    expect(shouldRevertPendingMetadata('not-applicable')).toBe(false)
  })

  it('takes the edit back only when nothing reached the file', () => {
    expect(shouldRevertPendingMetadata('failed')).toBe(true)
    expect(shouldRevertPendingMetadata('unattempted')).toBe(true)
  })

  it('shows the edit without the server row having changed', () => {
    // The point of the removal: the row still says what the server said, and the edit is visible
    // anyway because readers overlay it.
    const row = committed('PN-OLD')
    const { pending } = applyPendingEdit(PATH, undefined, { part_number: 'PN-NEW' }, undefined)

    expect(resolvedText(resolvePartNumber({ pendingMetadata: pending, pdmData: row }))).toBe('PN-NEW')
    expect(row.part_number).toBe('PN-OLD')
  })

  it('falls back to the server row once the edit is taken back', () => {
    const row = committed('PN-OLD')
    const { pending, rollback } = applyPendingEdit(PATH, undefined, { part_number: 'PN-NEW' }, undefined)
    const restored = revertPendingEdit(pending, rollback)

    expect(resolvedText(resolvePartNumber({ pendingMetadata: restored, pdmData: row }))).toBe('PN-OLD')
  })
})

describe('hasPendingMetadata', () => {
  it('counts a clear, which is an edit to nothing rather than no edit', () => {
    expect(hasPendingMetadata({ part_number: null })).toBe(true)
  })

  it('does not count a field that was never set', () => {
    expect(hasPendingMetadata({ part_number: undefined })).toBe(false)
    expect(hasPendingMetadata({})).toBe(false)
    expect(hasPendingMetadata(undefined)).toBe(false)
  })

  it('does not count an empty configuration map', () => {
    expect(hasPendingMetadata({ config_tabs: {} })).toBe(false)
    expect(hasPendingMetadata({ config_tabs: { Default: '001' } })).toBe(true)
  })
})

describe('nothing writes a pending value back into pdmData', () => {
  const SOURCE_ROOT = join(__dirname, '..', '..')

  /**
   * An object that spreads the server row and then takes one of its fields from the pending side.
   * That is the shape all three copies had, and the only one that produces a `pdmData` the server
   * never sent.
   */
  const COPIES_PENDING_INTO_COMMITTED =
    /\.\.\.\s*\w*\.?pdmData\s*,[\s\S]{0,400}?(part_number|description|revision)\s*:\s*(metadata|pending|preservedPending)\b/

  /** The three removed copies, quoted so the pattern is shown to still recognise what it hunts. */
  const REMOVED = {
    'filesSlice.updatePendingMetadata': `
      const updatedPdmData = f.pdmData
        ? {
            ...f.pdmData,
            part_number:
              metadata.part_number !== undefined ? metadata.part_number : f.pdmData.part_number,
          }
        : f.pdmData`,
    'filesSlice.clearPendingMetadata': `
      const mergedPdmData =
        file?.pdmData && pending
          ? {
              ...file.pdmData,
              part_number:
                pending.part_number !== undefined ? pending.part_number : file.pdmData.part_number,
            }
          : file?.pdmData`,
    'useLoadFiles.finalPdmData': `
      finalPdmData = {
        ...pdmData,
        part_number:
          preservedPending.part_number !== undefined
            ? preservedPending.part_number
            : pdmData.part_number,
      }`,
  }

  it.each(Object.entries(REMOVED))('still recognises the copy in %s', (_name, source) => {
    expect(COPIES_PENDING_INTO_COMMITTED.test(source)).toBe(true)
  })

  it.each([
    join('stores', 'slices', 'filesSlice.ts'),
    join('hooks', 'useLoadFiles.ts'),
  ])('finds no copy left in %s', (relativePath) => {
    const source = readFileSync(join(SOURCE_ROOT, relativePath), 'utf8')

    expect(source.length).toBeGreaterThan(1000)
    expect(COPIES_PENDING_INTO_COMMITTED.test(source)).toBe(false)
  })
})
