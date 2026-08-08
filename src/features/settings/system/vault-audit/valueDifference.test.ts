import { describe, expect, it } from 'vitest'

import {
  classifyDifference,
  compareForDisplay,
  diffValues,
  isTrivialDifference,
  segmentValue,
} from './valueDifference'

describe('classifyDifference', () => {
  it('separates the three differences nobody typed on purpose', () => {
    expect(classifyDifference('O-ring, FKM', 'O-RING, FKM')).toBe('case-only')
    expect(classifyDifference('O-ring,  FKM', 'O-ring, FKM')).toBe('whitespace-only')
    expect(classifyDifference('O-ring,  FKM', 'O-RING, FKM')).toBe('case-and-whitespace')
  })

  it('calls a real difference substantive', () => {
    expect(classifyDifference('O-ring, FKM 75A', 'O-ring, NBR 70A')).toBe('substantive')
  })

  // A tab or a newline where a space was meant reads as an unexplained conflict, and the fix is
  // the same as for a doubled space.
  it('treats any run of whitespace as the same separator', () => {
    expect(classifyDifference('Bracket\tshort', 'Bracket short')).toBe('whitespace-only')
    expect(classifyDifference('Bracket\nshort', 'Bracket short')).toBe('whitespace-only')
  })

  it('only calls a substantive difference worth reading', () => {
    expect(isTrivialDifference('case-only')).toBe(true)
    expect(isTrivialDifference('whitespace-only')).toBe(true)
    expect(isTrivialDifference('case-and-whitespace')).toBe(true)
    expect(isTrivialDifference('substantive')).toBe(false)
  })
})

describe('diffValues', () => {
  it('finds the span that differs between two otherwise identical values', () => {
    const difference = diffValues('Box, Cardboard 12x12', 'Box, Cardboard 14x12')
    expect('Box, Cardboard 12x12'.slice(0, difference.prefixLength)).toBe('Box, Cardboard 1')
    expect(difference.suffixLength).toBe(3)
  })

  /**
   * "abc" against "abcabc" shares three characters at the start and three at the end, and the same
   * three characters are doing both jobs. Counting them twice describes the difference as minus
   * three characters long, and the slice built from it comes out empty or backwards.
   */
  it('never lets the shared prefix and suffix claim the same characters', () => {
    const difference = diffValues('abc', 'abcabc')
    expect(difference.prefixLength + difference.suffixLength).toBeLessThanOrEqual(3)
    expect('abcabc'.length - difference.suffixLength).toBeGreaterThanOrEqual(
      difference.prefixLength,
    )
  })

  it('reports one value as entirely different from an unrelated one', () => {
    const difference = diffValues('Washer', 'Bracket')
    expect(difference.prefixLength).toBe(0)
    expect(difference.suffixLength).toBe(0)
  })
})

describe('segmentValue', () => {
  const long =
    'Assembly, hydraulic manifold, three port, anodised aluminium, LEFT hand, service kit included'
  const other = long.replace('LEFT', 'RIGHT')

  // The word starts at character 62, well past where a fixed-width column stops. The cell is built
  // around the difference rather than around the start of the string, so it is on screen.
  it('shows the difference even when it is far past where the column would truncate', () => {
    const difference = diffValues(long, other)
    const segments = segmentValue(long, difference)

    expect(`${segments.head}${segments.middle}${segments.tail}`).toContain('LEFT')
    expect(segments.elidedStart).toBe(true)
  })

  // "LEFT" and "RIGHT" share their final T, so the minimal differing span is "LEF" against "RIGH".
  // Highlighting only that is the point - it is what tells the two rows apart.
  it('highlights only the characters that actually differ', () => {
    expect(segmentValue(long, diffValues(long, other)).middle).toBe('LEF')
    expect(segmentValue(other, diffValues(long, other)).middle).toBe('RIGH')
  })

  it('keeps a little shared context either side so the difference can be placed', () => {
    const difference = diffValues(long, other)
    const segments = segmentValue(long, difference)

    expect(segments.head.length).toBeGreaterThan(0)
    expect(segments.tail.length).toBeGreaterThan(0)
    // Everything rendered must really be in the value, or the cell is inventing text.
    expect(long).toContain(`${segments.head}${segments.middle}${segments.tail}`)
  })

  it('does not elide a short value', () => {
    const difference = diffValues('BR-100', 'BR-200')
    const segments = segmentValue('BR-100', difference)

    expect(segments.elidedStart).toBe(false)
    expect(segments.elidedEnd).toBe(false)
    expect(`${segments.head}${segments.middle}${segments.tail}`).toBe('BR-100')
  })

  it('leaves an empty middle when one value is a prefix of the other', () => {
    const difference = diffValues('Clear Zip Bag', 'Clear Zip Bag, 1.5 mil')
    const segments = segmentValue('Clear Zip Bag', difference)
    expect(segments.middle).toBe('')
  })
})

describe('compareForDisplay', () => {
  it('draws nothing where one side holds nothing', () => {
    expect(compareForDisplay('Spacer', null)).toBeNull()
    expect(compareForDisplay(null, 'Spacer')).toBeNull()
    expect(compareForDisplay(null, null)).toBeNull()
  })

  it('draws nothing for two values that agree', () => {
    expect(compareForDisplay('Spacer', 'Spacer')).toBeNull()
  })

  it('marks up both sides of a conflict against the same difference', () => {
    const display = compareForDisplay('Ball Bearing, 6X13', 'Ball Bearing, 6X19')
    expect(display?.kind).toBe('substantive')
    expect(display?.database.middle).toBe('3')
    expect(display?.file.middle).toBe('9')
  })
})
