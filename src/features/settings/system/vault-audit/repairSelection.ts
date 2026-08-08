/**
 * Which rows a shift-click covers in the repair preview.
 *
 * The anchor is remembered as an id rather than as a row index, because the list under it moves.
 * Typing in the filter re-derives the rows, and an index that pointed at the row someone ticked a
 * moment ago can afterwards point at an unrelated file - which in a table whose purpose is to
 * approve writes would tick rows nobody looked at. An id that is no longer on screen resolves to
 * nothing, and the click falls back to selecting the single row it landed on.
 *
 * Pure: no React, no store.
 */

/**
 * The ids from the anchor to the clicked row, inclusive, in the order they are displayed.
 *
 * Null when there is no usable anchor - no row ticked yet, or the anchor has been filtered away -
 * which the caller reads as "treat this as an ordinary click".
 */
export function rangeBetween(
  rowIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): string[] | null {
  if (anchorId === null) return null

  const anchorIndex = rowIds.indexOf(anchorId)
  const targetIndex = rowIds.indexOf(targetId)
  if (anchorIndex === -1 || targetIndex === -1) return null

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return rowIds.slice(start, end + 1)
}
