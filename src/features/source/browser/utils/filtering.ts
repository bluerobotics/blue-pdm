/**
 * File filtering utilities for the file browser
 */
import { isPathHidden, type HiddenFolderPaths } from '@/lib/hiddenFolders'
import type { LocalFile } from '@/stores/pdmStore'

export interface FileFilter {
  search?: string
  searchType?: 'all' | 'files' | 'folders'
  extensions?: string[]
  states?: string[]
  showHidden?: boolean
  hideSolidworksTempFiles?: boolean
  /** Admin-only folder paths to strip from the list (empty for admins) */
  hiddenFolderPaths?: HiddenFolderPaths
}

/**
 * Fuzzy match helper - checks if query characters appear in order in the text
 */
export function fuzzyMatch(text: string | undefined | null, query: string): boolean {
  if (!text) return false
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // Simple fuzzy: check if all characters in query appear in order
  let queryIndex = 0
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      queryIndex++
    }
  }
  return queryIndex === lowerQuery.length
}

/**
 * Calculate search relevance score for a file
 * Higher score = better match
 * Prioritizes: filename > description > part number > path > other metadata > extension
 */
export function getSearchScore(file: LocalFile, query: string): number {
  const q = query.toLowerCase().trim()
  if (!q) return 0

  let score = 0

  // Priority 1: Filename matches (highest scores)
  const nameLower = file.name.toLowerCase()
  if (nameLower === q) {
    score = 1000 // Exact match
  } else if (nameLower.startsWith(q)) {
    score = 900 // Starts with query
  } else if (nameLower.includes(q)) {
    score = 800 // Contains query
  } else if (fuzzyMatch(file.name, q)) {
    score = 700 // Fuzzy match on name
  }

  // Priority 2: Description matches
  if (file.pdmData?.description) {
    const descLower = file.pdmData.description.toLowerCase()
    if (descLower.includes(q)) {
      score = Math.max(score, 500)
    }
  }

  // Priority 3: Part number matches
  if (file.pdmData?.part_number?.toLowerCase().includes(q)) {
    score = Math.max(score, 400)
  }

  // Priority 4: Path matches
  if (file.relativePath.toLowerCase().includes(q)) {
    score = Math.max(score, 300)
  }

  // Priority 5: Other metadata matches
  if (file.pdmData) {
    if (file.pdmData.revision?.toLowerCase().includes(q)) score = Math.max(score, 200)
    const customProps = file.pdmData.custom_properties as Record<string, unknown> | null
    if (
      typeof customProps?.['material'] === 'string' &&
      customProps['material'].toLowerCase().includes(q)
    )
      score = Math.max(score, 200)
    if (
      typeof customProps?.['vendor'] === 'string' &&
      customProps['vendor'].toLowerCase().includes(q)
    )
      score = Math.max(score, 200)
    if (
      typeof customProps?.['project'] === 'string' &&
      customProps['project'].toLowerCase().includes(q)
    )
      score = Math.max(score, 200)
  }

  // Extension match (lowest priority)
  if (file.extension?.toLowerCase().includes(q)) {
    score = Math.max(score, 100)
  }

  return score
}

/**
 * Check if a file matches the search query
 */
export function matchesSearch(file: LocalFile, query: string): boolean {
  return getSearchScore(file, query) > 0
}

/**
 * Validate a file (check it has required fields)
 */
export function isValidFile(file: LocalFile | undefined | null): file is LocalFile {
  return !!(file && file.relativePath && file.name)
}

/**
 * Check if a file is a SolidWorks temp file
 */
export function isSolidworksTempFile(file: LocalFile): boolean {
  return file.name.startsWith('~$')
}

/**
 * Filter files to get only valid, visible files
 */
export function filterValidFiles(
  files: LocalFile[],
  options: { hideSolidworksTempFiles?: boolean; hiddenFolderPaths?: HiddenFolderPaths } = {},
): LocalFile[] {
  const { hideSolidworksTempFiles = false, hiddenFolderPaths = [] } = options

  return files.filter((f) => {
    if (!isValidFile(f)) return false
    if (hideSolidworksTempFiles && isSolidworksTempFile(f)) return false
    if (isPathHidden(f.relativePath, hiddenFolderPaths)) return false
    return true
  })
}

/**
 * Get files in the current folder path (direct children only)
 */
export function getFilesInFolder(files: LocalFile[], currentPath: string): LocalFile[] {
  // Normalize path separators for cross-platform compatibility (Windows uses \, Unix uses /)
  const normalizedCurrentPath = currentPath.replace(/\\/g, '/')

  return files.filter((file) => {
    const normalizedPath = file.relativePath.replace(/\\/g, '/')
    const fileParts = normalizedPath.split('/')

    if (normalizedCurrentPath === '') {
      // Root level - show only top-level items
      return fileParts.length === 1
    } else {
      // In a subfolder - show direct children
      const currentParts = normalizedCurrentPath.split('/')

      // File must be exactly one level deeper than current path
      if (fileParts.length !== currentParts.length + 1) return false

      // File must start with current path (case-insensitive for Windows compatibility)
      for (let i = 0; i < currentParts.length; i++) {
        if (fileParts[i].toLowerCase() !== currentParts[i].toLowerCase()) return false
      }

      return true
    }
  })
}

/**
 * Filter files by search query and type
 */
export function filterBySearch(
  files: LocalFile[],
  query: string,
  searchType: 'all' | 'files' | 'folders' = 'all',
): LocalFile[] {
  return files.filter((file) => {
    // Filter by search type
    if (searchType === 'files' && file.isDirectory) return false
    if (searchType === 'folders' && !file.isDirectory) return false
    return matchesSearch(file, query)
  })
}

/**
 * Apply all filters to get the final file list
 */
export function applyFilters(files: LocalFile[], filter: FileFilter): LocalFile[] {
  let result = filterValidFiles(files, {
    hideSolidworksTempFiles: filter.hideSolidworksTempFiles,
    hiddenFolderPaths: filter.hiddenFolderPaths,
  })

  if (filter.search && filter.search.trim()) {
    result = filterBySearch(result, filter.search, filter.searchType)
  }

  if (filter.extensions && filter.extensions.length > 0) {
    result = result.filter(
      (f) => f.isDirectory || filter.extensions!.includes(f.extension.toLowerCase()),
    )
  }

  if (filter.states && filter.states.length > 0) {
    result = result.filter((f) => {
      const state = f.pdmData?.workflow_state?.name
      return f.isDirectory || (state && filter.states!.includes(state))
    })
  }

  return result
}
