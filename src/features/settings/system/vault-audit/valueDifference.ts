/**
 * Showing an administrator what actually differs between two values.
 *
 * The conflict table puts BluePLM's value and the document's value side by side and asks which one
 * is right. Both are descriptions, both start with the same twenty characters, and both were
 * truncated to the column width - so the table rendered two identical-looking strings and asked
 * the reader to choose between them. Every row was unanswerable, which made the whole category
 * unanswerable, which is the one category that cannot be resolved any other way.
 *
 * Two things fix that, and they are separable.
 *
 * **Say where the difference is.** Trimming a common prefix and a common suffix leaves the span
 * that genuinely differs, and the cell is built around that span rather than around the start of
 * the string. A value whose only difference is at character 180 shows character 180.
 *
 * **Say when the difference is not worth reading.** `classifyPair` treats case and spacing as real
 * divergence, deliberately - `BR-100` and `br-100` are not the same part number and pretending
 * otherwise would hide a genuine fault. But a vault-wide scan turns that correctness into forty
 * rows that all look identical, and an administrator who cannot tell them apart from the
 * substantive ones has to open forty documents to find out. Naming the trivial ones lets them be
 * cleared as a group and leaves the rest to be read.
 *
 * Pure: no React, no I/O, no store.
 */

// ============================================
// Classification
// ============================================

/** How much of a difference there is to read, once case and spacing are set aside. */
export type ValueDifferenceKind =
  /** The two differ only in capitalisation. */
  | 'case-only'
  /** The two differ only in where the spaces are, or how many of them there are. */
  | 'whitespace-only'
  /** Both at once, which is neither of the above and is still nothing anyone typed on purpose. */
  | 'case-and-whitespace'
  /** A real difference in what the value says. */
  | 'substantive'

/** Whether a difference is one a person has to read the values to settle. */
export function isTrivialDifference(kind: ValueDifferenceKind): boolean {
  return kind !== 'substantive'
}

/**
 * Internal spacing collapsed to one space, and the ends trimmed.
 *
 * The scanner has already trimmed both values - anything reaching here differs somewhere other
 * than at the ends - so this is about runs of spaces and tabs in the middle, and about a newline
 * where a space was meant.
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Only reached for two values that are not equal, so the three trivial verdicts are mutually
 * exclusive: differing in case leaves the collapsed forms differing too, and vice versa. The
 * both-at-once case is the one that survives each single test and is caught last.
 */
export function classifyDifference(a: string, b: string): ValueDifferenceKind {
  const spacedA = collapseWhitespace(a)
  const spacedB = collapseWhitespace(b)

  if (a.toLowerCase() === b.toLowerCase()) return 'case-only'
  if (spacedA === spacedB) return 'whitespace-only'
  if (spacedA.toLowerCase() === spacedB.toLowerCase()) return 'case-and-whitespace'

  return 'substantive'
}

// ============================================
// Locating the difference
// ============================================

/** The span of each value that is not shared with the other. */
export interface ValueDifference {
  kind: ValueDifferenceKind
  /** Characters the two share at the start. */
  prefixLength: number
  /**
   * Characters the two share at the end.
   *
   * Never allowed to overlap the prefix on either value, so `prefixLength + suffixLength` is at
   * most the length of the shorter one and the differing span is never negative.
   */
  suffixLength: number
}

export function diffValues(a: string, b: string): ValueDifference {
  const shortest = Math.min(a.length, b.length)

  let prefixLength = 0
  while (prefixLength < shortest && a[prefixLength] === b[prefixLength]) prefixLength += 1

  // Bounded by what the prefix has already claimed on the *shorter* value: "abc" against "abcabc"
  // shares three characters at each end, and counting both would describe a difference of minus
  // three characters in the middle of a value that is entirely a difference.
  const remaining = shortest - prefixLength
  let suffixLength = 0
  while (
    suffixLength < remaining &&
    a[a.length - 1 - suffixLength] === b[b.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return { kind: classifyDifference(a, b), prefixLength, suffixLength }
}

// ============================================
// Building the cell
// ============================================

/**
 * One value cut into the part that is shared, the part that differs, and the part that is shared
 * again - with either shared end replaced by an ellipsis when it is long enough to push the
 * difference out of the column.
 *
 * The middle is never elided. It is the only reason the row is on screen.
 */
export interface ValueSegments {
  /** True when `head` is not the true start of the value. */
  elidedStart: boolean
  head: string
  /** The differing span. Empty only when one value is a prefix or suffix of the other. */
  middle: string
  tail: string
  /** True when `tail` is not the true end of the value. */
  elidedEnd: boolean
}

/** Shared characters kept either side of the difference, so it can be read in context. */
const CONTEXT_CHARS = 14

/**
 * The longest differing span rendered in full.
 *
 * Past this the two values have essentially nothing in common and the row is answered by the first
 * line of each rather than by a character-level comparison, so the span is cut and the cell says
 * so. Nothing is decided by what is dropped - the full strings are in the JSON artifact, and the
 * title attribute on the cell carries the whole value.
 */
const MAX_MIDDLE_CHARS = 80

export function segmentValue(value: string, difference: ValueDifference): ValueSegments {
  const { prefixLength, suffixLength } = difference

  const headStart = Math.max(0, prefixLength - CONTEXT_CHARS)
  const head = value.slice(headStart, prefixLength)

  const middleEnd = value.length - suffixLength
  const rawMiddle = value.slice(prefixLength, middleEnd)
  const middle =
    rawMiddle.length > MAX_MIDDLE_CHARS ? `${rawMiddle.slice(0, MAX_MIDDLE_CHARS)}…` : rawMiddle

  const tail = value.slice(middleEnd, middleEnd + CONTEXT_CHARS)

  return {
    elidedStart: headStart > 0,
    head,
    middle,
    tail,
    elidedEnd: middleEnd + CONTEXT_CHARS < value.length,
  }
}

/**
 * The pair of cells for one row, or null when there is no comparison to draw.
 *
 * Null for every finding where one side holds nothing: a value against an absence is already
 * legible as one filled cell and one dash, and marking up the filled one would imply the whole of
 * it is in dispute when what is in dispute is whether it should be there at all.
 */
export interface ValueComparisonDisplay {
  kind: ValueDifferenceKind
  database: ValueSegments
  file: ValueSegments
}

export function compareForDisplay(
  databaseValue: string | null,
  fileValue: string | null,
): ValueComparisonDisplay | null {
  if (databaseValue === null || fileValue === null) return null
  if (databaseValue === fileValue) return null

  const difference = diffValues(databaseValue, fileValue)
  return {
    kind: difference.kind,
    database: segmentValue(databaseValue, difference),
    file: segmentValue(fileValue, difference),
  }
}
