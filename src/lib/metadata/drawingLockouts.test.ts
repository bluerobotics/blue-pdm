/**
 * The rule that keeps BluePLM's values out of a drawing's property bag.
 *
 * Worth pinning down because the settings behind it are per-user and default to on, so the
 * interesting cases are the ones a developer never sees: a user who turned one lock off, and a
 * part that must be unaffected by any of them.
 */

import { describe, expect, it } from 'vitest'

import { lockedDrawingFields, withoutLockedDrawingFields } from './drawingLockouts'

const ALL_LOCKED = {
  lockDrawingItemNumber: true,
  lockDrawingDescription: true,
  lockDrawingRevision: true,
}

const NONE_LOCKED = {
  lockDrawingItemNumber: false,
  lockDrawingDescription: false,
  lockDrawingRevision: false,
}

describe('lockedDrawingFields', () => {
  it('locks nothing on a part, whatever the settings say', () => {
    expect(lockedDrawingFields('.sldprt', ALL_LOCKED).size).toBe(0)
  })

  it('locks nothing on an assembly, whatever the settings say', () => {
    expect(lockedDrawingFields('.sldasm', ALL_LOCKED).size).toBe(0)
  })

  it('locks nothing on a file with no extension at all', () => {
    expect(lockedDrawingFields(undefined, ALL_LOCKED).size).toBe(0)
  })

  it('locks all three fields on a drawing under the default settings', () => {
    expect([...lockedDrawingFields('.slddrw', ALL_LOCKED)].sort()).toEqual([
      'description',
      'part_number',
      'revision',
    ])
  })

  it('recognises a drawing whatever case the extension arrives in', () => {
    expect(lockedDrawingFields('.SLDDRW', ALL_LOCKED).size).toBe(3)
  })

  it('locks only what the user asked for', () => {
    const locked = lockedDrawingFields('.slddrw', {
      ...NONE_LOCKED,
      lockDrawingItemNumber: true,
    })

    expect(locked.has('part_number')).toBe(true)
    expect(locked.has('description')).toBe(false)
    expect(locked.has('revision')).toBe(false)
  })

  it('locks nothing on a drawing once the user turns the settings off', () => {
    expect(lockedDrawingFields('.slddrw', NONE_LOCKED).size).toBe(0)
  })
})

describe('withoutLockedDrawingFields', () => {
  it('returns the pending set untouched when nothing is locked', () => {
    const pending = { part_number: 'BR-100', description: 'Bracket' }

    expect(withoutLockedDrawingFields(pending, new Set())).toBe(pending)
  })

  it('takes the tab out with the item number it belongs to', () => {
    const remaining = withoutLockedDrawingFields(
      { part_number: 'BR-100', tab_number: '02', description: 'Bracket' },
      new Set(['part_number'] as const),
    )

    expect(remaining).toEqual({ description: 'Bracket' })
  })

  it('takes the per-configuration descriptions out with the description', () => {
    const remaining = withoutLockedDrawingFields(
      { description: 'Bracket', config_descriptions: { Default: 'Bracket' }, revision: 'B' },
      new Set(['description'] as const),
    )

    expect(remaining).toEqual({ revision: 'B' })
  })

  it('leaves nothing to write when every field is locked', () => {
    const remaining = withoutLockedDrawingFields(
      { part_number: 'BR-100', description: 'Bracket', revision: 'B' },
      new Set(['part_number', 'description', 'revision'] as const),
    )

    expect(Object.keys(remaining)).toHaveLength(0)
  })

  it('keeps a cleared value rather than reading it as an absent one', () => {
    // `null` is a field the user emptied on purpose, and the write planner turns it into an empty
    // property. Dropping it here because it is falsy would leave the old value in the document.
    const remaining = withoutLockedDrawingFields(
      { part_number: null, description: null },
      new Set(['part_number'] as const),
    )

    expect(remaining).toEqual({ description: null })
  })

  it('does not mutate the pending set it was given', () => {
    const pending = { part_number: 'BR-100', description: 'Bracket' }
    withoutLockedDrawingFields(pending, new Set(['part_number'] as const))

    expect(pending.part_number).toBe('BR-100')
  })
})
