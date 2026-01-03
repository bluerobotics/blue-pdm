import { useCallback } from 'react'
import type { SearchFilter } from '../types'
import { getAvailableFilters } from '../utils'

interface UseKeyboardNavigationOptions {
  totalResults: number
  highlightedIndex: number
  setHighlightedIndex: (index: number | ((prev: number) => number)) => void
  isOpen: boolean
  showFilters: boolean
  activeFilter: SearchFilter
  setActiveFilter: (filter: SearchFilter) => void
  isGdriveConnected: boolean
  onEnter: (index: number) => void
  onEscape: () => void
}

/**
 * Hook for keyboard navigation in search results
 */
export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
  const {
    totalResults,
    highlightedIndex,
    setHighlightedIndex,
    isOpen,
    showFilters,
    activeFilter,
    setActiveFilter,
    isGdriveConnected,
    onEnter,
    onEscape,
  } = options

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((prev: number) => Math.min(prev + 1, totalResults - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((prev: number) => Math.max(prev - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        onEnter(highlightedIndex)
        break
      case 'Escape':
        e.preventDefault()
        onEscape()
        break
      case 'Tab':
        if (showFilters) {
          e.preventDefault()
          // Cycle through filters - only show filters user can use
          const availableFilters = getAvailableFilters(isGdriveConnected)
          const currentIndex = availableFilters.findIndex(f => f.id === activeFilter)
          const nextIndex = (currentIndex + 1) % availableFilters.length
          setActiveFilter(availableFilters[nextIndex].id)
        }
        break
    }
  }, [highlightedIndex, totalResults, isOpen, showFilters, activeFilter, isGdriveConnected, setHighlightedIndex, onEnter, onEscape, setActiveFilter])

  return { handleKeyDown }
}
