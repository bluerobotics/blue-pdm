# Agent 4: CommandSearch Refactor

## Objective
Split `CommandSearch.tsx` (703 lines) into a proper feature folder with separated components and hooks. Target: Main component ~150 lines, sub-components ~100-150 lines each.

---

## BOUNDARIES - READ CAREFULLY

### Files You CAN Create
- `src/components/command-search/CommandSearch.tsx`
- `src/components/command-search/SearchInput.tsx`
- `src/components/command-search/FilterButton.tsx`
- `src/components/command-search/FiltersDropdown.tsx`
- `src/components/command-search/QuickFilters.tsx`
- `src/components/command-search/SearchResults.tsx`
- `src/components/command-search/LocalFileResult.tsx`
- `src/components/command-search/DriveFileResult.tsx`
- `src/components/command-search/RecentSearches.tsx`
- `src/components/command-search/KeyboardHints.tsx`
- `src/components/command-search/EmptyState.tsx`
- `src/components/command-search/hooks/index.ts`
- `src/components/command-search/hooks/useSearchState.ts`
- `src/components/command-search/hooks/useGoogleDriveSearch.ts`
- `src/components/command-search/hooks/useLocalFileSearch.ts`
- `src/components/command-search/hooks/useKeyboardNavigation.ts`
- `src/components/command-search/types.ts`
- `src/components/command-search/constants.ts`
- `src/components/command-search/utils.ts`
- `src/components/command-search/index.ts`

### Files You CAN Edit
- `src/components/CommandSearch.tsx` - Will be replaced/deleted after migration

### Files You CAN Read (but not edit)
- `src/stores/pdmStore.ts` - To understand store interface

### Files You MUST NOT Touch
- `src/App.tsx` - Another agent handles this
- `src/components/ActivityBar.tsx` - Another agent handles this
- `src/components/BackupPanel.tsx` - Another agent handles this
- `src/components/MenuBar.tsx` - Uses CommandSearch, don't modify
- ANY file in `src/lib/commands/` - Another agent handles this
- ANY file in `src/stores/`
- ANY file in `src/types/`
- ANY file in `src/hooks/` (if it exists)

---

## Task Breakdown

### Step 1: Create Feature Folder Structure
```
src/components/command-search/
├── index.ts
├── CommandSearch.tsx
├── SearchInput.tsx
├── FilterButton.tsx
├── FiltersDropdown.tsx
├── QuickFilters.tsx
├── SearchResults.tsx
├── LocalFileResult.tsx
├── DriveFileResult.tsx
├── RecentSearches.tsx
├── KeyboardHints.tsx
├── EmptyState.tsx
├── types.ts
├── constants.ts
├── utils.ts
└── hooks/
    ├── index.ts
    ├── useSearchState.ts
    ├── useGoogleDriveSearch.ts
    ├── useLocalFileSearch.ts
    └── useKeyboardNavigation.ts
```

### Step 2: Create types.ts
Extract/define types (lines ~11-41):
```typescript
export interface GoogleDriveFileResult {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  iconLink?: string
  modifiedTime?: string
  owners?: { displayName: string }[]
}

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
  icon: React.ReactNode
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
```

### Step 3: Create constants.ts
Extract FILTER_OPTIONS array (lines ~43-53):
```typescript
import { Search, File, Folder, Hash, FileText, User, ClipboardList, Tag, HardDrive } from 'lucide-react'
import type { FilterOption } from './types'

export const FILTER_OPTIONS: FilterOption[] = [
  { id: 'all', label: 'All', icon: <Search size={14} />, description: 'Search everything' },
  { id: 'files', label: 'Files', icon: <File size={14} />, prefix: 'file:', description: 'Search file names only' },
  // ... rest of options
]
```

### Step 4: Create utils.ts
Extract utility functions:
```typescript
import type { ParsedQuery, SearchFilter } from './types'
import { FILTER_OPTIONS } from './constants'

export function parseQuery(query: string, activeFilter: SearchFilter): ParsedQuery {
  // Extract from lines ~98-109
}

export function getDriveFileIcon(mimeType: string): React.ReactNode {
  // Extract from lines ~330-342
}

export function getStateIndicator(workflowState?: {...}): React.ReactNode {
  // Extract from lines ~392-401
}
```

### Step 5: Create useSearchState Hook
Extract main search state (lines ~74-79, ~344-360):
```typescript
export function useSearchState() {
  // Return: {
  //   localQuery, setLocalQuery,
  //   activeFilter, setActiveFilter,
  //   isOpen, setIsOpen,
  //   showFilters, setShowFilters,
  //   highlightedIndex, setHighlightedIndex,
  //   parsedQuery,
  //   executeSearch, clearSearch
  // }
}
```

### Step 6: Create useGoogleDriveSearch Hook
Extract Google Drive search logic (lines ~90-170):
```typescript
export function useGoogleDriveSearch(searchTerm: string, filter: SearchFilter) {
  // Return: {
  //   driveResults,
  //   isDriveSearching,
  //   isGdriveConnected
  // }
}
```
This hook handles:
- Token checking
- Debounced search
- Google Drive API calls

### Step 7: Create useLocalFileSearch Hook
Extract local file search logic (lines ~172-211):
```typescript
export function useLocalFileSearch(searchTerm: string, filter: SearchFilter, files: LocalFile[]) {
  // Return: { searchResults }
}
```

### Step 8: Create useKeyboardNavigation Hook
Extract keyboard handling (lines ~239-292):
```typescript
export function useKeyboardNavigation(options: {
  totalResults: number
  onSelect: (index: number) => void
  onEscape: () => void
  onExecute: () => void
}) {
  // Return: { highlightedIndex, handleKeyDown }
}
```

### Step 9: Extract FilterButton Component
Extract the filter button (lines ~409-422):
```typescript
interface FilterButtonProps {
  currentFilter: FilterOption
  isActive: boolean
  onClick: () => void
}
```

### Step 10: Extract FiltersDropdown Component
Extract the filters dropdown menu (lines ~465-499):
- List of filter options
- Selection handling
- Prefix code display

### Step 11: Extract QuickFilters Component
Extract the quick filters row (lines ~508-532):
- Horizontal scrollable filter pills
- "More..." button

### Step 12: Extract LocalFileResult Component
Extract local file result item (lines ~541-568):
```typescript
interface LocalFileResultProps {
  file: LocalFile
  isHighlighted: boolean
  onSelect: () => void
  onMouseEnter: () => void
}
```

### Step 13: Extract DriveFileResult Component
Extract Google Drive result item (lines ~580-609):
```typescript
interface DriveFileResultProps {
  file: GoogleDriveFileResult
  isHighlighted: boolean
  onSelect: () => void
  onMouseEnter: () => void
}
```

### Step 14: Extract RecentSearches Component
Extract recent searches section (lines ~630-661):
- Header with clear button
- List of recent search items

### Step 15: Extract EmptyState Component
Extract empty/no results states (lines ~619-627, ~664-677):
```typescript
interface EmptyStateProps {
  type: 'no-results' | 'empty-query'
  isGdriveConnected: boolean
}
```

### Step 16: Extract KeyboardHints Component
Extract keyboard hints footer (lines ~680-696):
- Arrow key hints
- Enter/Escape hints

### Step 17: Extract SearchInput Component
Extract the main input with clear button (lines ~424-461):
```typescript
interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onFocus: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  placeholder: string
  inputRef: RefObject<HTMLInputElement>
}
```

### Step 18: Extract SearchResults Component
Compose the results dropdown (lines ~501-698):
- QuickFilters
- LocalFileResults section
- DriveFileResults section
- RecentSearches section
- EmptyState
- KeyboardHints

### Step 19: Refactor Main CommandSearch Component
The main component should:
- Import all sub-components
- Import all hooks
- Handle refs and click outside
- Compose SearchInput + FilterButton + FiltersDropdown + SearchResults
- Should be ~150 lines

### Step 20: Create index.ts Barrel Export
```typescript
export { CommandSearch } from './CommandSearch'
export type { CommandSearchProps, SearchFilter, GoogleDriveFileResult } from './types'
```

### Step 21: Update Old File
Once complete, update imports or re-export from old location.

---

## Testing Checklist
After refactoring, verify:
- [ ] Search input focuses with Ctrl+K
- [ ] Typing shows results
- [ ] Filter button shows current filter
- [ ] Filter dropdown opens and closes
- [ ] Quick filter pills work
- [ ] Local file results appear
- [ ] Google Drive results appear (if connected)
- [ ] Clicking results selects/navigates
- [ ] Keyboard navigation (up/down/enter/escape) works
- [ ] Recent searches display
- [ ] Clear recent searches works
- [ ] Click outside closes dropdown
- [ ] Prefix shortcuts work (pn:, file:, etc.)
- [ ] Empty states display correctly

---

## Notes
- The Google Drive token is stored in localStorage
- Debounce timeout for Drive search is 300ms
- Preserve the `logSearch` calls for analytics
- Preserve all Lucide icon imports
- Keep the same Tailwind styling
