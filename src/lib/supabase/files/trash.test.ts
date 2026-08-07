/**
 * What a user is told when the soft delete wrote nothing.
 *
 * Schema 95 moves trashing from `module:explorer:edit` to `module:explorer:delete`. A refused
 * UPDATE is not reported as a permission error by PostgREST - the statement runs, matches no row
 * the caller may write, and `.single()` then reports *"JSON object requested, multiple (or no) rows
 * returned"*. That is the sentence an organisation which deliberately granted Edit and withheld
 * Delete would have seen on day one.
 */

import { describe, expect, it } from 'vitest'

import { describeFailedSoftDelete } from './trash'

describe('explaining a soft delete that wrote nothing', () => {
  it('names the permission when the update matched no writable row', () => {
    const message = describeFailedSoftDelete({
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    })

    expect(message).toMatch(/permission/i)
    expect(message).toMatch(/Delete/)
    expect(message).not.toMatch(/JSON object/)
  })

  it('passes any other failure through unchanged', () => {
    // The select above already proved the row is visible, so PGRST116 is the only code that can
    // mean "refused". Anything else is a real database error and rewriting it would hide it.
    expect(
      describeFailedSoftDelete({ code: '57014', message: 'canceling statement due to timeout' }),
    ).toBe('canceling statement due to timeout')
  })

  it('passes a failure with no code through unchanged', () => {
    expect(describeFailedSoftDelete({ message: 'network error' })).toBe('network error')
  })
})
