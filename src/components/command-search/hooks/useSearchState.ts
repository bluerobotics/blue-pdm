import { useState, useMemo, useCallback } from 'react'
import { usePDMStore } from '../../../stores/pdmStore'
import { logSearch } from '../../../lib/userActionLogger'
import type { SearchFilter, ParsedQuery } from '../types'
import { parseQuery } from '../utils'

/**
 * Hook for managing the main search state
 */
export function useSearchState() {
  const {
    searchQuery,
    setSearchQuery,
    setSearchType,
    addRecentSearch,
  } = usePDMStore()

  const [isOpen, setIsOpen] = useState(false)
  const [localQuery, setLocalQuery] = useState(searchQuery || '')
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('all')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [showFilters, setShowFilters] = useState(false)

  // Parse query for filter prefix
  const parsedQuery: ParsedQuery = useMemo(() => {
    return parseQuery(localQuery, activeFilter)
  }, [localQuery, activeFilter])

  // Execute global search
  const executeSearch = useCallback(() => {
    if (localQuery.trim()) {
      addRecentSearch?.(localQuery.trim())
      logSearch(localQuery, parsedQuery.filter)
      // Sync to global search
      setSearchQuery(localQuery)
      // Convert filter to searchType
      if (parsedQuery.filter === 'files') {
        setSearchType('files')
      } else if (parsedQuery.filter === 'folders') {
        setSearchType('folders')
      } else {
        setSearchType('all')
      }
    }
    setIsOpen(false)
  }, [localQuery, parsedQuery.filter, addRecentSearch, setSearchQuery, setSearchType])

  // Clear the search
  const clearSearch = useCallback(() => {
    setLocalQuery('')
    setSearchQuery('')
    setHighlightedIndex(-1)
  }, [setSearchQuery])

  // Handle input change
  const handleInputChange = useCallback((value: string) => {
    setLocalQuery(value)
    setSearchQuery(value)
    setHighlightedIndex(-1)
    if (!isOpen) setIsOpen(true)
  }, [isOpen, setSearchQuery])

  return {
    // State
    localQuery,
    setLocalQuery,
    activeFilter,
    setActiveFilter,
    isOpen,
    setIsOpen,
    showFilters,
    setShowFilters,
    highlightedIndex,
    setHighlightedIndex,
    parsedQuery,
    // Actions
    executeSearch,
    clearSearch,
    handleInputChange,
    // Store dependencies needed by other hooks
    searchQuery,
    addRecentSearch,
  }
}
