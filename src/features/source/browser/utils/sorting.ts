/**
 * File sorting utilities for the file browser
 */
import type { LocalFile } from '@/stores/pdmStore'
import {
  resolveDescription,
  resolvePartNumber,
  resolveRevision,
  resolvedText,
} from '@/lib/metadata/overlay'
import type { SortColumn, SortDirection } from '../types'

/**
 * Compare two files by a specific column
 */
export function compareFiles(
  a: LocalFile,
  b: LocalFile,
  column: SortColumn,
  direction: SortDirection,
): number {
  let comparison = 0

  switch (column) {
    case 'name':
      comparison = a.name.localeCompare(b.name)
      break
    case 'size':
      comparison = a.size - b.size
      break
    case 'modifiedTime':
      const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0
      const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0
      comparison = (isNaN(aTime) ? 0 : aTime) - (isNaN(bTime) ? 0 : bTime)
      break
    case 'extension':
      comparison = a.extension.localeCompare(b.extension)
      break
    // These three sort on the same overlay the matching cells render, so a pending edit
    // moves the row rather than leaving it filed under the value it no longer shows.
    case 'itemNumber':
      comparison = resolvedText(resolvePartNumber(a)).localeCompare(
        resolvedText(resolvePartNumber(b)),
      )
      break
    case 'description':
      comparison = resolvedText(resolveDescription(a)).localeCompare(
        resolvedText(resolveDescription(b)),
      )
      break
    case 'revision':
      comparison = resolvedText(resolveRevision(a)).localeCompare(resolvedText(resolveRevision(b)))
      break
    case 'version':
      const aVer = a.pdmData?.version || 0
      const bVer = b.pdmData?.version || 0
      comparison = aVer - bVer
      break
    case 'state':
      const aState = a.pdmData?.workflow_state?.name || ''
      const bState = b.pdmData?.workflow_state?.name || ''
      comparison = aState.localeCompare(bState)
      break
    case 'checkedOutBy':
      const aCheckedOut = a.pdmData?.checked_out_user?.full_name || ''
      const bCheckedOut = b.pdmData?.checked_out_user?.full_name || ''
      comparison = aCheckedOut.localeCompare(bCheckedOut)
      break
    case 'fileStatus':
      const aStatus = a.diffStatus || ''
      const bStatus = b.diffStatus || ''
      comparison = aStatus.localeCompare(bStatus)
      break
    default:
      comparison = a.name.localeCompare(b.name)
  }

  return direction === 'asc' ? comparison : -comparison
}

/**
 * Sort files with folders first, then by the specified column
 */
export function sortFiles(
  files: LocalFile[],
  column: SortColumn,
  direction: SortDirection,
  foldersFirst: boolean = true,
): LocalFile[] {
  return [...files]
    .filter((f) => f && f.name)
    .sort((a, b) => {
      // Folders always first (if enabled)
      if (foldersFirst) {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
      }

      return compareFiles(a, b, column, direction)
    })
}

/**
 * Sort files by search relevance score
 */
export function sortByRelevance(
  files: LocalFile[],
  getScore: (file: LocalFile) => number,
): LocalFile[] {
  return [...files].sort((a, b) => getScore(b) - getScore(a))
}
