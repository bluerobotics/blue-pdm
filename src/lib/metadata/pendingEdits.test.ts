/**
 * Cover for what removing the `pdmData` copy changed, and for what replaced the revert.
 *
 * `updatePendingMetadata` used to write the edited fields into `pdmData` as well as into
 * `pendingMetadata`, so an edit read back as a value the server had confirmed. That copy is gone.
 *
 * Its removal came with a revert: because `pendingMetadata` became the only record of the edit and
 * check-in promoted whatever it found there, a failed write took the edit back out rather than let
 * the database receive a value the file had refused. That is gone too - the value is kept and marked
 * instead, which `writeState.test.ts` covers. What remains here is the fold of an edit into the
 * pending set, and the guarantee that nothing copies a pending value into the committed one.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePartNumber, resolvedText } from './overlay'
import { applyPendingEdit, hasPendingMetadata } from './pendingEdits'
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

describe('folding an edit into the pending set', () => {
  it('records the value and names the field the write must report on', () => {
    const { pending, edit } = applyPendingEdit(PATH, undefined, { part_number: 'PN-NEW' })

    expect(pending.part_number).toBe('PN-NEW')
    expect(edit.fields).toEqual(['part_number'])
    expect(edit.path).toBe(PATH)
  })

  it('keeps a clear as a clear, not as an absence', () => {
    // A pending `null` is a deliberate clear, which is a different intention from never having been
    // set - and the one the old `||` overlays kept getting wrong.
    const { pending } = applyPendingEdit(PATH, undefined, { part_number: null })

    expect(pending.part_number).toBeNull()
    expect('part_number' in pending).toBe(true)
  })

  it('leaves earlier edits alone, because they are still owed to the database', () => {
    const description = applyPendingEdit(PATH, undefined, { description: 'New title' })
    const renumber = applyPendingEdit(PATH, description.pending, { part_number: 'PN-NEW' })

    expect(renumber.pending.description).toBe('New title')
    expect(renumber.pending.part_number).toBe('PN-NEW')
    expect(renumber.edit.fields).toEqual(['part_number'])
  })

  it('merges configuration maps rather than replacing them', () => {
    const first = applyPendingEdit(PATH, undefined, { config_tabs: { 'AS568-014': '014' } })
    const second = applyPendingEdit(PATH, first.pending, { config_tabs: { 'AS568-015': '015' } })

    expect(second.pending.config_tabs).toEqual({ 'AS568-014': '014', 'AS568-015': '015' })
  })

  it('carries the whole pending set on the edit, so the write does not have to read it again', () => {
    const first = applyPendingEdit(PATH, undefined, { description: 'New title' })
    const second = applyPendingEdit(PATH, first.pending, { part_number: 'PN-NEW' })

    expect(second.edit.pending).toEqual(second.pending)
  })

  it('shows the edit without the server row having changed', () => {
    // The point of the removal: the row still says what the server said, and the edit is visible
    // anyway because readers overlay it.
    const row = committed('PN-OLD')
    const { pending } = applyPendingEdit(PATH, undefined, { part_number: 'PN-NEW' })

    expect(resolvedText(resolvePartNumber({ pendingMetadata: pending, pdmData: row }))).toBe('PN-NEW')
    expect(row.part_number).toBe('PN-OLD')
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

describe('no write path can revert a typed value any more', () => {
  const SOURCE_ROOT = join(__dirname, '..', '..')

  it.each([
    join('lib', 'metadata', 'pendingEdits.ts'),
    join('lib', 'metadata', 'reportMetadataWrite.ts'),
    join('stores', 'slices', 'filesSlice.ts'),
  ])('has no revert machinery left in %s', (relativePath) => {
    const source = readFileSync(join(SOURCE_ROOT, relativePath), 'utf8')

    // The names are gone, not merely unused: a failed write keeps the value and marks it, and
    // leaving a reachable revert would let a future caller quietly choose the old behaviour.
    expect(source).not.toMatch(/revertPendingEdit|revertPendingMetadata|shouldRevertPendingMetadata/)
  })
})
