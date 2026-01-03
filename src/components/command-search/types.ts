import type { ReactNode, RefObject } from 'react'
import type { LocalFile } from '../../stores/pdmStore'

// Google Drive file result type
export interface GoogleDriveFileResult {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  iconLink?: string
  modifiedTime?: string
  owners?: { displayName: string }[]
}

// Search filter types
export type SearchFilter = 
  | 'all'
  | 'files' 
  | 'folders'
  | 'part-number'
  | 'description'
  | 'eco'
  | 'checked-out'
  | 'state'
  | 'drive'

export interface FilterOption {
  id: SearchFilter
  label: string
  icon: ReactNode
  prefix?: string
  description: string
  requiresAuth?: 'gdrive'
}

export interface CommandSearchProps {
  maxWidth?: string
}

export interface ParsedQuery {
  filter: SearchFilter
  searchTerm: string
}

// Sub-component props
export interface FilterButtonProps {
  currentFilter: FilterOption
  isActive: boolean
  onClick: () => void
}

export interface FiltersDropdownProps {
  filters: FilterOption[]
  currentFilter: SearchFilter
  onSelect: (filter: SearchFilter) => void
}

export interface QuickFiltersProps {
  filters: FilterOption[]
  currentFilter: SearchFilter
  onSelect: (filter: SearchFilter) => void
  onShowMore: () => void
}

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onFocus: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  placeholder: string
  inputRef: RefObject<HTMLInputElement | null>
  onClear: () => void
}

export interface LocalFileResultProps {
  file: LocalFile
  isHighlighted: boolean
  onSelect: () => void
  onMouseEnter: () => void
}

export interface DriveFileResultProps {
  file: GoogleDriveFileResult
  isHighlighted: boolean
  onSelect: () => void
  onMouseEnter: () => void
}

export interface RecentSearchesProps {
  searches: string[]
  startIndex: number
  highlightedIndex: number
  onSelect: (search: string) => void
  onClear: () => void
  onMouseEnter: (index: number) => void
}

export interface EmptyStateProps {
  type: 'no-results' | 'empty-query'
  isGdriveConnected: boolean
}

export interface SearchResultsProps {
  isOpen: boolean
  showFilters: boolean
  filters: FilterOption[]
  currentFilter: SearchFilter
  localQuery: string
  searchResults: LocalFile[]
  driveResults: GoogleDriveFileResult[]
  isDriveSearching: boolean
  isGdriveConnected: boolean
  recentSearches?: string[]
  highlightedIndex: number
  onFilterSelect: (filter: SearchFilter) => void
  onShowMoreFilters: () => void
  onSelectLocalResult: (file: LocalFile) => void
  onSelectDriveResult: (file: GoogleDriveFileResult) => void
  onRecentSearchClick: (search: string) => void
  onClearRecentSearches: () => void
  onHighlightChange: (index: number) => void
  dropdownRef: RefObject<HTMLDivElement | null>
}
