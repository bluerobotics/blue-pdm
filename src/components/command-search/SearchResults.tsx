import { HardDrive, Loader2 } from 'lucide-react'
import type { SearchResultsProps } from './types'
import { QuickFilters } from './QuickFilters'
import { LocalFileResult } from './LocalFileResult'
import { DriveFileResult } from './DriveFileResult'
import { RecentSearches } from './RecentSearches'
import { EmptyState } from './EmptyState'
import { KeyboardHints } from './KeyboardHints'

/**
 * Search results dropdown containing all result sections
 */
export function SearchResults({
  isOpen,
  showFilters,
  filters,
  currentFilter,
  localQuery,
  searchResults,
  driveResults,
  isDriveSearching,
  isGdriveConnected,
  recentSearches,
  highlightedIndex,
  onFilterSelect,
  onShowMoreFilters,
  onSelectLocalResult,
  onSelectDriveResult,
  onRecentSearchClick,
  onClearRecentSearches,
  onHighlightChange,
  dropdownRef,
}: SearchResultsProps) {
  if (!isOpen || showFilters) return null

  const hasQuery = localQuery.trim().length > 0
  const hasLocalResults = searchResults.length > 0
  const hasDriveResults = driveResults.length > 0
  const hasRecentSearches = recentSearches && recentSearches.length > 0
  const showDriveSection = hasQuery && isGdriveConnected && (currentFilter === 'all' || currentFilter === 'drive')
  const showNoResults = hasQuery && !hasLocalResults && !hasDriveResults && !isDriveSearching
  const showEmptyQuery = !hasQuery && !hasRecentSearches

  // Quick filters - show limited number
  const quickFilters = filters.slice(0, isGdriveConnected ? 6 : 5)

  return (
    <div 
      ref={dropdownRef}
      className="absolute top-full left-0 right-0 mt-1 bg-plm-bg border border-plm-border rounded-lg shadow-2xl z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
    >
      {/* Quick filters row */}
      <QuickFilters
        filters={quickFilters}
        currentFilter={currentFilter}
        onSelect={onFilterSelect}
        onShowMore={onShowMoreFilters}
      />

      <div className="max-h-80 overflow-y-auto">
        {/* Local File Results */}
        {hasQuery && hasLocalResults && (
          <div className="p-1">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium">
              {currentFilter === 'all' && isGdriveConnected ? 'Local Files' : 'Results'} ({searchResults.length})
            </div>
            {searchResults.map((file, index) => (
              <LocalFileResult
                key={file.path}
                file={file}
                isHighlighted={highlightedIndex === index}
                onSelect={() => onSelectLocalResult(file)}
                onMouseEnter={() => onHighlightChange(index)}
              />
            ))}
          </div>
        )}

        {/* Google Drive Results */}
        {showDriveSection && (
          <div className="p-1">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium flex items-center gap-2">
              <HardDrive size={10} />
              Google Drive
              {isDriveSearching && <Loader2 size={10} className="animate-spin" />}
              {!isDriveSearching && hasDriveResults && ` (${driveResults.length})`}
            </div>
            {driveResults.map((file, index) => {
              const resultIndex = searchResults.length + index
              return (
                <DriveFileResult
                  key={file.id}
                  file={file}
                  isHighlighted={highlightedIndex === resultIndex}
                  onSelect={() => onSelectDriveResult(file)}
                  onMouseEnter={() => onHighlightChange(resultIndex)}
                />
              )
            })}
            {!isDriveSearching && !hasDriveResults && currentFilter === 'drive' && (
              <div className="px-3 py-2 text-xs text-plm-fg-muted">
                No files found in Google Drive
              </div>
            )}
          </div>
        )}

        {/* No results */}
        {showNoResults && <EmptyState type="no-results" isGdriveConnected={isGdriveConnected} />}

        {/* Recent Searches */}
        {!hasQuery && hasRecentSearches && (
          <RecentSearches
            searches={recentSearches!}
            startIndex={searchResults.length + driveResults.length}
            highlightedIndex={highlightedIndex}
            onSelect={onRecentSearchClick}
            onClear={onClearRecentSearches}
            onMouseEnter={onHighlightChange}
          />
        )}

        {/* Empty state when no query and no recents */}
        {showEmptyQuery && <EmptyState type="empty-query" isGdriveConnected={isGdriveConnected} />}
      </div>

      {/* Footer with keyboard hints */}
      <KeyboardHints />
    </div>
  )
}
