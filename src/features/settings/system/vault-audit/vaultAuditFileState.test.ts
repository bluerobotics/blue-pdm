import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'

import { availabilityOf, tallyAvailability } from './vaultAuditFileState'

const ME = 'user-me'
const SARAH = 'user-sarah'

function fileOf(pdmData: Partial<NonNullable<LocalFile['pdmData']>> | null): LocalFile {
  return {
    name: 'BRACKET.SLDPRT',
    path: 'C:\\BluePLM\\br-vault\\0 - SHARED\\BRACKET.SLDPRT',
    relativePath: '0 - SHARED\\BRACKET.SLDPRT',
    extension: '.sldprt',
    pdmData: pdmData === null ? undefined : (pdmData as LocalFile['pdmData']),
  } as LocalFile
}

describe('availabilityOf', () => {
  it('calls a file checked out to me writable', () => {
    expect(availabilityOf(fileOf({ id: 'f1', checked_out_by: ME }), ME)).toEqual({
      state: 'writable',
    })
  })

  // Nothing in BluePLM to hold, so there is nobody to hold it.
  it('calls a local-only file writable', () => {
    expect(availabilityOf(fileOf(null), ME)).toEqual({ state: 'writable' })
  })

  /**
   * The distinction the audit exists to draw here. A checked-in file is a step away from being
   * writable; a file somebody else holds is not, and reporting the two as one number left the
   * reader unable to tell a vault needing ten checkouts from a colleague holding the folder.
   */
  it('separates a file nobody holds from one somebody else holds', () => {
    expect(availabilityOf(fileOf({ id: 'f1', checked_out_by: null }), ME)).toEqual({
      state: 'not-checked-out',
    })
    expect(availabilityOf(fileOf({ id: 'f1', checked_out_by: SARAH }), ME)).toEqual({
      state: 'held-by-other',
      holder: null,
    })
  })

  it('names the holder when the row carries one', () => {
    const held = fileOf({
      id: 'f1',
      checked_out_by: SARAH,
      checked_out_user: {
        id: SARAH,
        full_name: 'Sarah Chen',
        email: 's@example.com',
        avatar_url: null,
      },
    })
    expect(availabilityOf(held, ME)).toEqual({ state: 'held-by-other', holder: 'Sarah Chen' })
  })

  it('falls back to the email when there is no name', () => {
    const held = fileOf({
      id: 'f1',
      checked_out_by: SARAH,
      checked_out_user: { id: SARAH, full_name: null, email: 's@example.com', avatar_url: null },
    })
    expect(availabilityOf(held, ME)).toEqual({ state: 'held-by-other', holder: 's@example.com' })
  })

  it('does not attribute a mismatched profile to the checkout owner', () => {
    const held = fileOf({
      id: 'f1',
      checked_out_by: SARAH,
      checked_out_user: {
        id: ME,
        full_name: 'Current User',
        email: 'me@example.com',
        avatar_url: null,
      },
    })
    expect(availabilityOf(held, ME)).toEqual({ state: 'held-by-other', holder: null })
  })

  it('reports a file that is not loaded rather than guessing about it', () => {
    expect(availabilityOf(undefined, ME)).toEqual({ state: 'not-loaded' })
  })

  // A signed-out session must not read every checked-in file as its own.
  it('does not treat an absent user as the holder of an unheld file', () => {
    expect(availabilityOf(fileOf({ id: 'f1', checked_out_by: null }), undefined)).toEqual({
      state: 'not-checked-out',
    })
  })
})

describe('tallyAvailability', () => {
  it('counts each state apart and lists the holders once each', () => {
    const tally = tallyAvailability([
      { state: 'writable' },
      { state: 'writable' },
      { state: 'not-checked-out' },
      { state: 'held-by-other', holder: 'Sarah Chen' },
      { state: 'held-by-other', holder: 'Sarah Chen' },
      { state: 'held-by-other', holder: 'Tom Reed' },
      { state: 'not-loaded' },
    ])

    expect(tally).toEqual({
      writable: 2,
      notCheckedOut: 1,
      heldByOther: 3,
      notLoaded: 1,
      holders: ['Sarah Chen', 'Tom Reed'],
    })
  })

  it('leaves the holder list empty when no name was recorded', () => {
    const tally = tallyAvailability([{ state: 'held-by-other', holder: null }])
    expect(tally.heldByOther).toBe(1)
    expect(tally.holders).toEqual([])
  })
})
