import { useMemo } from 'react'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { isPathHidden } from '@/lib/hiddenFolders'
import { resolveDescription, resolvePartNumber } from '@/lib/metadata/overlay'
import type { SearchFilter, SearchScope } from '../types'

/**
 * Hook for searching local files
 */
export function useLocalFileSearch(
  searchTerm: string,
  filter: SearchFilter,
  currentFolder: string,
  searchScope: SearchScope,
) {
  const { files } = usePDMStore()
  const { enforcedHiddenPaths } = useHiddenFolders()

  // Filter files based on current query and filter
  const searchResults = useMemo(() => {
    // For drive-only filter, don't search local files
    if (filter === 'drive') return []
    if (!searchTerm) return []

    const term = searchTerm.toLowerCase()

    const inFolder = (f: LocalFile) =>
      currentFolder === '' ||
      f.relativePath === currentFolder ||
      f.relativePath.startsWith(currentFolder + '/')

    const visibleFiles = files.filter((f) => !isPathHidden(f.relativePath, enforcedHiddenPaths))
    const scopedFiles =
      searchScope === 'current-folder' ? visibleFiles.filter(inFolder) : visibleFiles

    return scopedFiles
      .filter((file: LocalFile) => {
        switch (filter) {
          case 'files':
            return !file.isDirectory && file.name.toLowerCase().includes(term)
          case 'folders':
            return file.isDirectory && file.name.toLowerCase().includes(term)
          case 'part-number':
            return resolvePartNumber(file).value?.toLowerCase().includes(term)
          case 'description':
            return resolveDescription(file).value?.toLowerCase().includes(term)
          case 'checked-out':
            return (
              file.pdmData?.checked_out_user?.full_name?.toLowerCase().includes(term) ||
              file.pdmData?.checked_out_user?.email?.toLowerCase().includes(term)
            )
          case 'state':
            return (
              file.pdmData?.workflow_state?.name?.toLowerCase().includes(term) ||
              file.pdmData?.workflow_state?.label?.toLowerCase().includes(term)
            )
          case 'eco':
            // ECO search would need async lookup - for now match on file metadata
            return (
              file.name.toLowerCase().includes(term) ||
              resolvePartNumber(file).value?.toLowerCase().includes(term)
            )
          case 'all':
          default:
            return (
              file.name.toLowerCase().includes(term) ||
              file.relativePath.toLowerCase().includes(term) ||
              resolvePartNumber(file).value?.toLowerCase().includes(term) ||
              resolveDescription(file).value?.toLowerCase().includes(term)
            )
        }
      })
      .slice(0, 20) // Limit results
  }, [searchTerm, filter, files, currentFolder, searchScope, enforcedHiddenPaths])

  return { searchResults }
}
