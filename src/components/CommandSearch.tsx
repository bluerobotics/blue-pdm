import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { 
  Search, X, Clock, File, Folder, Hash, FileText, User, 
  CheckCircle, Circle, AlertCircle, ArrowRight, Command,
  ClipboardList, Tag, Filter, ChevronDown, HardDrive,
  FileSpreadsheet, Presentation, Loader2, ExternalLink
} from 'lucide-react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { logSearch } from '../lib/userActionLogger'

// Google Drive file result type
interface GoogleDriveFileResult {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  iconLink?: string
  modifiedTime?: string
  owners?: { displayName: string }[]
}

// Search filter types
type SearchFilter = 
  | 'all'
  | 'files' 
  | 'folders'
  | 'part-number'
  | 'description'
  | 'eco'
  | 'checked-out'
  | 'state'
  | 'drive'

interface FilterOption {
  id: SearchFilter
  label: string
  icon: React.ReactNode
  prefix?: string
  description: string
  requiresAuth?: 'gdrive'
}

const FILTER_OPTIONS: FilterOption[] = [
  { id: 'all', label: 'All', icon: <Search size={14} />, description: 'Search everything' },
  { id: 'files', label: 'Files', icon: <File size={14} />, prefix: 'file:', description: 'Search file names only' },
  { id: 'folders', label: 'Folders', icon: <Folder size={14} />, prefix: 'folder:', description: 'Search folder names only' },
  { id: 'part-number', label: 'Part Number', icon: <Hash size={14} />, prefix: 'pn:', description: 'Search by part number' },
  { id: 'description', label: 'Description', icon: <FileText size={14} />, prefix: 'desc:', description: 'Search file descriptions' },
  { id: 'eco', label: 'ECO', icon: <ClipboardList size={14} />, prefix: 'eco:', description: 'Find files in an ECO' },
  { id: 'checked-out', label: 'Checked Out By', icon: <User size={14} />, prefix: 'by:', description: 'Find files checked out by user' },
  { id: 'state', label: 'State', icon: <Tag size={14} />, prefix: 'state:', description: 'Filter by workflow state' },
  { id: 'drive', label: 'Google Drive', icon: <HardDrive size={14} />, prefix: 'drive:', description: 'Search Google Drive files', requiresAuth: 'gdrive' },
]

interface CommandSearchProps {
  maxWidth?: string
}

export function CommandSearch({ maxWidth = 'max-w-lg' }: CommandSearchProps) {
  const {
    searchQuery,
    setSearchQuery,
    setSearchType,
    files,
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
    toggleFileSelection,
    setGdriveOpenDocument,
    setActiveView,
    gdriveAuthVersion,
  } = usePDMStore()

  const [isOpen, setIsOpen] = useState(false)
  const [localQuery, setLocalQuery] = useState(searchQuery || '')
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('all')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [showFilters, setShowFilters] = useState(false)
  
  // Google Drive search state
  const [driveResults, setDriveResults] = useState<GoogleDriveFileResult[]>([])
  const [isDriveSearching, setIsDriveSearching] = useState(false)
  const driveSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Check if Google Drive is authenticated (re-check when auth version changes)
  const isGdriveConnected = useMemo(() => {
    const token = localStorage.getItem('gdrive_access_token')
    const expiry = localStorage.getItem('gdrive_token_expiry')
    if (!token || !expiry) return false
    return Date.now() < parseInt(expiry, 10)
  }, [gdriveAuthVersion])

  // Parse query for filter prefix
  const parsedQuery = useMemo(() => {
    const query = localQuery.trim()
    for (const filter of FILTER_OPTIONS) {
      if (filter.prefix && query.toLowerCase().startsWith(filter.prefix)) {
        return {
          filter: filter.id,
          searchTerm: query.slice(filter.prefix.length).trim()
        }
      }
    }
    return { filter: activeFilter, searchTerm: query }
  }, [localQuery, activeFilter])

  // Search Google Drive files
  const searchGoogleDrive = useCallback(async (searchTerm: string) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token || !searchTerm.trim()) {
      setDriveResults([])
      return
    }
    
    setIsDriveSearching(true)
    try {
      // Use Google Drive API's fullText search
      const query = `name contains '${searchTerm.replace(/'/g, "\\'")}' and trashed = false`
      const fields = 'files(id,name,mimeType,webViewLink,iconLink,modifiedTime,owners)'
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${fields}&pageSize=10&orderBy=modifiedTime desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (response.ok) {
        const data = await response.json()
        setDriveResults(data.files || [])
      } else {
        setDriveResults([])
      }
    } catch (err) {
      console.error('Google Drive search failed:', err)
      setDriveResults([])
    } finally {
      setIsDriveSearching(false)
    }
  }, [])

  // Debounced Google Drive search when filter is 'drive' or 'all' and connected
  useEffect(() => {
    if (!isGdriveConnected) {
      setDriveResults([])
      return
    }
    
    const shouldSearchDrive = parsedQuery.filter === 'drive' || parsedQuery.filter === 'all'
    if (!shouldSearchDrive || !parsedQuery.searchTerm) {
      setDriveResults([])
      return
    }
    
    // Debounce the search
    if (driveSearchTimeoutRef.current) {
      clearTimeout(driveSearchTimeoutRef.current)
    }
    
    driveSearchTimeoutRef.current = setTimeout(() => {
      searchGoogleDrive(parsedQuery.searchTerm)
    }, 300)
    
    return () => {
      if (driveSearchTimeoutRef.current) {
        clearTimeout(driveSearchTimeoutRef.current)
      }
    }
  }, [parsedQuery.searchTerm, parsedQuery.filter, isGdriveConnected, searchGoogleDrive])

  // Filter files based on current query and filter
  const searchResults = useMemo(() => {
    // For drive-only filter, don't search local files
    if (parsedQuery.filter === 'drive') return []
    if (!parsedQuery.searchTerm) return []
    
    const term = parsedQuery.searchTerm.toLowerCase()
    const filter = parsedQuery.filter
    
    return files.filter(file => {
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
          return file.pdmData?.state?.toLowerCase().includes(term)
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
  }, [parsedQuery, files])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setShowFilters(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Listen for global focus-search event (Ctrl+K)
  useEffect(() => {
    const handleFocusSearch = () => {
      inputRef.current?.focus()
      setIsOpen(true)
    }
    window.addEventListener('focus-search', handleFocusSearch)
    return () => window.removeEventListener('focus-search', handleFocusSearch)
  }, [])

  // Total navigable results (local + drive + recent)
  const totalResults = searchResults.length + driveResults.length + (recentSearches?.length || 0)

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => Math.min(prev + 1, totalResults - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => Math.max(prev - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0) {
          if (highlightedIndex < searchResults.length) {
            // Select local file
            handleSelectResult(searchResults[highlightedIndex])
          } else if (highlightedIndex < searchResults.length + driveResults.length) {
            // Select drive file
            const driveIndex = highlightedIndex - searchResults.length
            handleSelectDriveResult(driveResults[driveIndex])
          } else {
            // Use recent search
            const recentIndex = highlightedIndex - searchResults.length - driveResults.length
            if (recentSearches && recentSearches[recentIndex]) {
              setLocalQuery(recentSearches[recentIndex])
              setSearchQuery(recentSearches[recentIndex])
            }
          }
        } else if (localQuery.trim()) {
          executeSearch()
        }
        break
      case 'Escape':
        e.preventDefault()
        if (isOpen) {
          setIsOpen(false)
        } else {
          setLocalQuery('')
          setSearchQuery('')
        }
        inputRef.current?.blur()
        break
      case 'Tab':
        if (showFilters) {
          e.preventDefault()
          // Cycle through filters - only show filters user can use
          const availableFilters = FILTER_OPTIONS.filter(f => !f.requiresAuth || (f.requiresAuth === 'gdrive' && isGdriveConnected))
          const currentIndex = availableFilters.findIndex(f => f.id === activeFilter)
          const nextIndex = (currentIndex + 1) % availableFilters.length
          setActiveFilter(availableFilters[nextIndex].id)
        }
        break
    }
  }, [highlightedIndex, totalResults, searchResults, driveResults, recentSearches, localQuery, isOpen, showFilters, activeFilter, isGdriveConnected])

  const handleSelectResult = (file: LocalFile) => {
    toggleFileSelection(file.path, false)
    setIsOpen(false)
    // Add to recent searches
    if (localQuery.trim()) {
      addRecentSearch?.(localQuery.trim())
    }
    logSearch(localQuery, parsedQuery.filter)
  }
  
  const handleSelectDriveResult = (file: GoogleDriveFileResult) => {
    setIsOpen(false)
    // Add to recent searches
    if (localQuery.trim()) {
      addRecentSearch?.(localQuery.trim())
    }
    logSearch(localQuery, 'drive')
    
    // Switch to Google Drive view and open the document
    setActiveView('google-drive')
    
    // For Google Workspace files, open inline; for others, open in new tab
    const isGoogleWorkspace = file.mimeType.startsWith('application/vnd.google-apps.')
    if (isGoogleWorkspace && file.mimeType !== 'application/vnd.google-apps.folder') {
      setGdriveOpenDocument({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink
      })
    } else if (file.webViewLink) {
      window.open(file.webViewLink, '_blank')
    }
  }
  
  // Get icon for Google Drive file type
  const getDriveFileIcon = (mimeType: string) => {
    if (mimeType === 'application/vnd.google-apps.folder') {
      return <Folder size={16} className="text-plm-warning" />
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      return <FileSpreadsheet size={16} className="text-green-500" />
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      return <Presentation size={16} className="text-orange-400" />
    } else if (mimeType === 'application/vnd.google-apps.document') {
      return <FileText size={16} className="text-blue-400" />
    } else {
      return <HardDrive size={16} className="text-plm-fg-muted" />
    }
  }

  const executeSearch = () => {
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
  }

  const handleFilterSelect = (filter: SearchFilter) => {
    setActiveFilter(filter)
    const option = FILTER_OPTIONS.find(f => f.id === filter)
    if (option?.prefix) {
      // Add prefix to query
      const currentTerm = parsedQuery.searchTerm
      setLocalQuery(option.prefix + currentTerm)
    } else {
      // Remove any existing prefix
      setLocalQuery(parsedQuery.searchTerm)
    }
    setShowFilters(false)
    inputRef.current?.focus()
  }

  const handleRecentSearchClick = (search: string) => {
    setLocalQuery(search)
    setSearchQuery(search)
    addRecentSearch?.(search)
    logSearch(search, 'recent')
  }

  const clearSearch = () => {
    setLocalQuery('')
    setSearchQuery('')
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }

  // Get icon for file state
  const getStateIcon = (state?: string) => {
    switch (state?.toLowerCase()) {
      case 'released':
        return <CheckCircle size={12} className="text-plm-success" />
      case 'wip':
        return <Circle size={12} className="text-plm-warning" />
      case 'in review':
        return <AlertCircle size={12} className="text-plm-info" />
      default:
        return null
    }
  }

  const currentFilter = FILTER_OPTIONS.find(f => f.id === parsedQuery.filter) || FILTER_OPTIONS[0]

  return (
    <div ref={containerRef} className={`relative w-full ${maxWidth}`}>
      {/* Search Input */}
      <div className="relative flex items-center gap-1">
        {/* Filter indicator button */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 h-8 px-3 rounded-full border transition-colors ${
            parsedQuery.filter !== 'all'
              ? 'bg-plm-accent/20 border-plm-accent/50 text-plm-accent'
              : 'bg-plm-bg-lighter border-plm-border text-plm-fg-muted hover:text-plm-fg hover:border-plm-fg-muted'
          }`}
          title="Search filters"
        >
          <Filter size={12} />
          <span className="text-xs font-medium hidden sm:inline">{currentFilter.label}</span>
          <ChevronDown size={10} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        {/* Main search input */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={(e) => {
              setLocalQuery(e.target.value)
              setSearchQuery(e.target.value)
              setHighlightedIndex(-1)
              if (!isOpen) setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={currentFilter.description}
            className="w-full h-8 pl-9 pr-16 bg-plm-bg-lighter border border-plm-border rounded-full text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent focus:ring-1 focus:ring-plm-accent/50 transition-colors"
          />
          
          {/* Right side: clear button + keyboard shortcut */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {localQuery && (
              <button
                onClick={clearSearch}
                className="p-0.5 text-plm-fg-muted hover:text-plm-fg rounded"
              >
                <X size={14} />
              </button>
            )}
            {!localQuery && (
              <div className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted">
                <kbd className="px-1 py-0.5 bg-plm-bg-light border border-plm-border rounded text-[9px] font-mono">
                  <Command size={8} className="inline" />K
                </kbd>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters Dropdown */}
      {showFilters && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-plm-bg border border-plm-border rounded-lg shadow-2xl z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-2 border-b border-plm-border">
            <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium">Search Filters</div>
          </div>
          <div className="p-1 max-h-64 overflow-y-auto">
            {FILTER_OPTIONS
              .filter(f => !f.requiresAuth || (f.requiresAuth === 'gdrive' && isGdriveConnected))
              .map((filter) => (
              <button
                key={filter.id}
                onClick={() => handleFilterSelect(filter.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                  parsedQuery.filter === filter.id
                    ? 'bg-plm-accent/20 text-plm-accent'
                    : 'text-plm-fg hover:bg-plm-bg-lighter'
                }`}
              >
                <span className={parsedQuery.filter === filter.id ? 'text-plm-accent' : 'text-plm-fg-muted'}>
                  {filter.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{filter.label}</div>
                  <div className="text-xs text-plm-fg-muted truncate">{filter.description}</div>
                </div>
                {filter.prefix && (
                  <code className="text-[10px] px-1.5 py-0.5 bg-plm-bg-light border border-plm-border rounded font-mono">
                    {filter.prefix}
                  </code>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Results Dropdown */}
      {isOpen && !showFilters && (
        <div 
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-plm-bg border border-plm-border rounded-lg shadow-2xl z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Quick filters row */}
          <div className="flex items-center gap-1 p-2 border-b border-plm-border bg-plm-bg-light/50 overflow-x-auto scrollbar-hidden">
            {FILTER_OPTIONS
              .filter(f => !f.requiresAuth || (f.requiresAuth === 'gdrive' && isGdriveConnected))
              .slice(0, isGdriveConnected ? 6 : 5)
              .map((filter) => (
              <button
                key={filter.id}
                onClick={() => handleFilterSelect(filter.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  parsedQuery.filter === filter.id
                    ? 'bg-plm-accent text-white'
                    : 'bg-plm-bg border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:border-plm-fg-muted'
                }`}
              >
                {filter.icon}
                <span>{filter.label}</span>
              </button>
            ))}
            <button
              onClick={() => setShowFilters(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs text-plm-fg-muted hover:text-plm-fg"
            >
              <span>More...</span>
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {/* Local File Results */}
            {localQuery.trim() && searchResults.length > 0 && (
              <div className="p-1">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium">
                  {parsedQuery.filter === 'all' && isGdriveConnected ? 'Local Files' : 'Results'} ({searchResults.length})
                </div>
                {searchResults.map((file, index) => (
                  <button
                    key={file.path}
                    onClick={() => handleSelectResult(file)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                      highlightedIndex === index
                        ? 'bg-plm-accent/20'
                        : 'hover:bg-plm-bg-lighter'
                    }`}
                  >
                    <span className="text-plm-fg-muted">
                      {file.isDirectory ? <Folder size={16} className="text-plm-warning" /> : <File size={16} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-plm-fg truncate">{file.name}</span>
                        {file.pdmData?.part_number && (
                          <span className="text-xs text-plm-accent font-mono">{file.pdmData.part_number}</span>
                        )}
                        {getStateIcon(file.pdmData?.state)}
                      </div>
                      <div className="text-xs text-plm-fg-muted truncate">{file.relativePath}</div>
                    </div>
                    <ArrowRight size={12} className="text-plm-fg-muted opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}

            {/* Google Drive Results */}
            {localQuery.trim() && isGdriveConnected && (parsedQuery.filter === 'all' || parsedQuery.filter === 'drive') && (
              <div className="p-1">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium flex items-center gap-2">
                  <HardDrive size={10} />
                  Google Drive
                  {isDriveSearching && <Loader2 size={10} className="animate-spin" />}
                  {!isDriveSearching && driveResults.length > 0 && ` (${driveResults.length})`}
                </div>
                {driveResults.map((file, index) => {
                  const resultIndex = searchResults.length + index
                  return (
                    <button
                      key={file.id}
                      onClick={() => handleSelectDriveResult(file)}
                      onMouseEnter={() => setHighlightedIndex(resultIndex)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                        highlightedIndex === resultIndex
                          ? 'bg-plm-accent/20'
                          : 'hover:bg-plm-bg-lighter'
                      }`}
                    >
                      <span className="text-plm-fg-muted">
                        {getDriveFileIcon(file.mimeType)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-plm-fg truncate">{file.name}</span>
                        </div>
                        {file.owners?.[0]?.displayName && (
                          <div className="text-xs text-plm-fg-muted truncate">
                            {file.owners[0].displayName}
                          </div>
                        )}
                      </div>
                      <ExternalLink size={12} className="text-plm-fg-muted" />
                    </button>
                  )
                })}
                {!isDriveSearching && driveResults.length === 0 && parsedQuery.filter === 'drive' && (
                  <div className="px-3 py-2 text-xs text-plm-fg-muted">
                    No files found in Google Drive
                  </div>
                )}
              </div>
            )}

            {/* No results */}
            {localQuery.trim() && searchResults.length === 0 && driveResults.length === 0 && !isDriveSearching && (
              <div className="p-6 text-center">
                <Search size={24} className="mx-auto text-plm-fg-muted mb-2 opacity-50" />
                <div className="text-sm text-plm-fg-muted">No results found</div>
                <div className="text-xs text-plm-fg-muted mt-1">
                  Try a different filter or search term
                </div>
              </div>
            )}

            {/* Recent Searches */}
            {!localQuery.trim() && recentSearches && recentSearches.length > 0 && (
              <div className="p-1">
                <div className="flex items-center justify-between px-3 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted font-medium">
                    Recent Searches
                  </div>
                  <button
                    onClick={() => clearRecentSearches?.()}
                    className="text-[10px] text-plm-fg-muted hover:text-plm-error transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                {recentSearches.slice(0, 8).map((search, index) => {
                  const resultIndex = searchResults.length + driveResults.length + index
                  return (
                    <button
                      key={search + index}
                      onClick={() => handleRecentSearchClick(search)}
                      onMouseEnter={() => setHighlightedIndex(resultIndex)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                        highlightedIndex === resultIndex
                          ? 'bg-plm-accent/20'
                          : 'hover:bg-plm-bg-lighter'
                      }`}
                    >
                      <Clock size={14} className="text-plm-fg-muted" />
                      <span className="text-sm text-plm-fg truncate">{search}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Empty state when no query and no recents */}
            {!localQuery.trim() && (!recentSearches || recentSearches.length === 0) && (
              <div className="p-6 text-center">
                <Search size={24} className="mx-auto text-plm-fg-muted mb-2 opacity-50" />
                <div className="text-sm text-plm-fg-muted">Start typing to search</div>
                <div className="text-xs text-plm-fg-muted mt-2 space-y-1">
                  <p>Use filters like <code className="px-1 bg-plm-bg-light rounded">pn:123</code> for part numbers</p>
                  <p>or <code className="px-1 bg-plm-bg-light rounded">eco:ECO-001</code> for ECO files</p>
                  {isGdriveConnected && (
                    <p>or <code className="px-1 bg-plm-bg-light rounded">drive:file</code> for Google Drive</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer with keyboard hints */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-plm-border bg-plm-bg-light/50 text-[10px] text-plm-fg-muted">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-plm-bg border border-plm-border rounded font-mono">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-plm-bg border border-plm-border rounded font-mono">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-plm-bg border border-plm-border rounded font-mono">esc</kbd>
                close
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

