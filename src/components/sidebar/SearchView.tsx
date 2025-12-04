import { useState } from 'react'
import { Search, File, FolderOpen, X } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

export function SearchView() {
  const { 
    files, 
    searchQuery, 
    setSearchQuery,
    toggleFileSelection,
    selectedFiles
  } = usePDMStore()
  
  const [localQuery, setLocalQuery] = useState(searchQuery)

  // Filter files based on search
  const searchResults = localQuery.trim() 
    ? files.filter(f => {
        const query = localQuery.toLowerCase()
        return (
          f.name.toLowerCase().includes(query) ||
          f.relativePath.toLowerCase().includes(query) ||
          f.pdmData?.partNumber?.toLowerCase().includes(query) ||
          f.pdmData?.description?.toLowerCase().includes(query)
        )
      })
    : []

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(localQuery)
  }

  const clearSearch = () => {
    setLocalQuery('')
    setSearchQuery('')
  }

  return (
    <div className="p-4">
      <form onSubmit={handleSearch} className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted" />
        <input
          type="text"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          placeholder="Search files..."
          className="w-full pl-9 pr-8"
        />
        {localQuery && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-pdm-fg-muted hover:text-pdm-fg"
          >
            <X size={14} />
          </button>
        )}
      </form>

      {localQuery.trim() ? (
        <>
          <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
            Results ({searchResults.length})
          </div>
          
          {searchResults.length === 0 ? (
            <div className="text-sm text-pdm-fg-muted py-4 text-center">
              No files found
            </div>
          ) : (
            <div className="space-y-1">
              {searchResults.slice(0, 50).map(file => (
                <div
                  key={file.path}
                  onClick={(e) => toggleFileSelection(file.path, e.ctrlKey || e.metaKey)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                    selectedFiles.includes(file.path) 
                      ? 'bg-pdm-selection' 
                      : 'hover:bg-pdm-highlight'
                  }`}
                >
                  {file.isDirectory 
                    ? <FolderOpen size={14} className="text-pdm-warning flex-shrink-0" />
                    : <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
                  }
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{file.name}</div>
                    <div className="text-xs text-pdm-fg-muted truncate">
                      {file.relativePath}
                    </div>
                  </div>
                </div>
              ))}
              {searchResults.length > 50 && (
                <div className="text-xs text-pdm-fg-muted text-center py-2">
                  Showing 50 of {searchResults.length} results
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-pdm-fg-muted py-4 text-center">
          Enter a search term to find files
        </div>
      )}
    </div>
  )
}

