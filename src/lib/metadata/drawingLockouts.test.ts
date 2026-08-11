/**
 * The rule that keeps BluePLM's values out of a drawing's property bag.
 *
 * Worth pinning down because the settings behind it are per-user and default to on, so the
 * interesting cases are the ones a developer never sees: a user who turned one lock off, and a
 * part that must be unaffected by any of them.
 */

import { describe, expect, it } from 'vitest'

import { lockedDrawingFields } from './drawingLockouts'

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
