import type { LocalFile } from './types'

/**
 * Helpers for applying path-keyed updates to the `files` array.
 *
 * Every write that replaces the array invalidates the tree, folderMetrics and
 * sorting memos, each of which is O(N) over tens of thousands of files. Keeping the
 * array (and each element) referentially stable when an update would not actually
 * change anything makes redundant writes free for everything downstream.
 */

/** True when at least one of the update's own keys differs from the current value. */
export function hasActualChange(file: LocalFile, updates: Partial<LocalFile>): boolean {
  for (const key of Object.keys(updates) as Array<keyof LocalFile>) {
    if (!Object.is(file[key], updates[key])) return true
  }
  return false
}

export interface AppliedFileUpdates {
  files: LocalFile[]
  /** How many store entries the update map matched, whether or not values changed. */
  matchCount: number
  /** False when every matched entry already held the incoming values. */
  changed: boolean
}

/**
 * Apply a path-keyed update map (lowercase keys, for case-insensitive matching on
 * Windows) to the files array.
 *
 * Returns the original array when no file's values actually changed, and preserves
 * the original element reference for every file that did not change.
 */
export function applyFileUpdates(
  files: LocalFile[],
  updateMap: Map<string, Partial<LocalFile>>,
): AppliedFileUpdates {
  let matchCount = 0
  let changed = false

  const newFiles = files.map((file) => {
    const fileUpdates = updateMap.get(file.path.toLowerCase())
    if (!fileUpdates) return file

    matchCount++
    if (!hasActualChange(file, fileUpdates)) return file

    changed = true
    return { ...file, ...fileUpdates }
  })

  return { files: changed ? newFiles : files, matchCount, changed }
}
