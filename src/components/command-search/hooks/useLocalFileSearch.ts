import { useMemo } from 'react'
import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import type { SearchFilter } from '../types'

/**
 * Hook for searching local files
 */
export function useLocalFileSearch(searchTerm: string, filter: SearchFilter) {
  const { files } = usePDMStore()

  // Filter files based on current query and filter
  const searchResults = useMemo(() => {
    // For drive-only filter, don't search local files
    if (filter === 'drive') return []
    if (!searchTerm) return []
    
    const term = searchTerm.toLowerCase()
    
    return files.filter((file: LocalFile) => {
      switch (filter) {
        case 'files':
          return !file.isDirectory && file.name.toLowerCase().includes(term)
        case 'folders':
          return file.isDirectory && file.name.toLowerCase().includes(term)
        case 'part-number':
          return file.pdmData?.part_number?.toLowerCase().includes(term)
        case 'description':
          return file.pdmData?.description?.toLowerCase().includes(term)
        case 'checked-out':
          return file.pdmData?.checked_out_user?.full_name?.toLowerCase().includes(term) || 
                 file.pdmData?.checked_out_user?.email?.toLowerCase().includes(term)
        case 'state':
          return file.pdmData?.workflow_state?.name?.toLowerCase().includes(term) ||
                 file.pdmData?.workflow_state?.label?.toLowerCase().includes(term)
        case 'eco':
          // ECO search would need async lookup - for now match on file metadata
          return file.name.toLowerCase().includes(term) || 
                 file.pdmData?.part_number?.toLowerCase().includes(term)
        case 'all':
        default:
          return (
            file.name.toLowerCase().includes(term) ||
            file.relativePath.toLowerCase().includes(term) ||
            file.pdmData?.part_number?.toLowerCase().includes(term) ||
            file.pdmData?.description?.toLowerCase().includes(term)
          )
      }
    }).slice(0, 20) // Limit results
  }, [searchTerm, filter, files])

  return { searchResults }
}
