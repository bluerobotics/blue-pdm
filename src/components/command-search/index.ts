// Main component export
export { CommandSearch } from './CommandSearch'

// Type exports
export type { 
  CommandSearchProps, 
  SearchFilter, 
  GoogleDriveFileResult,
  FilterOption,
  ParsedQuery,
} from './types'

// Sub-components (for advanced customization)
export { FilterButton } from './FilterButton'
export { FiltersDropdown } from './FiltersDropdown'
export { QuickFilters } from './QuickFilters'
export { SearchInput } from './SearchInput'
export { SearchResults } from './SearchResults'
export { LocalFileResult } from './LocalFileResult'
export { DriveFileResult } from './DriveFileResult'
export { RecentSearches } from './RecentSearches'
export { EmptyState } from './EmptyState'
export { KeyboardHints } from './KeyboardHints'

// Hooks (for advanced customization)
export { 
  useSearchState, 
  useGoogleDriveSearch, 
  useLocalFileSearch, 
  useKeyboardNavigation 
} from './hooks'

// Constants
export { FILTER_OPTIONS } from './constants'

// Utils
export { 
  parseQuery, 
  getCurrentFilter, 
  getDriveFileIcon, 
  getStateIndicator, 
  getAvailableFilters 
} from './utils'
