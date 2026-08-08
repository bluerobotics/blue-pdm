import { describe, expect, it } from 'vitest'

import { rangeBetween } from './repairSelection'

const ROWS = ['a', 'b', 'c', 'd', 'e']

describe('rangeBetween', () => {
  it('covers both endpoints when the click is below the anchor', () => {
    expect(rangeBetween(ROWS, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  it('covers both endpoints when the click is above the anchor', () => {
    expect(rangeBetween(ROWS, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('is the single row when the anchor is the row clicked', () => {
    expect(rangeBetween(ROWS, 'c', 'c')).toEqual(['c'])
  })

  it('has no range before anything has been ticked', () => {
    expect(rangeBetween(ROWS, null, 'c')).toBeNull()
  })

  /**
   * The reason the anchor is an id. Filtering leaves the anchor pointing at a row that is no
   * longer displayed, and extending to a row nobody can see would approve writes unseen.
   */
  it('has no range once the anchor has been filtered away', () => {
    expect(rangeBetween(['c', 'd', 'e'], 'a', 'd')).toBeNull()
  })
})
