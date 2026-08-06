import { useState, useEffect, useMemo } from 'react'
import { Search, File, FolderOpen, X, ClipboardList, Tag, Loader2 } from 'lucide-react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { isPathHidden } from '@/lib/hiddenFolders'
import { resolveDescription, resolvePartNumber } from '@/lib/metadata/overlay'
import { getSupabaseClient } from '@/lib/supabase'
import { logSearch } from '@/lib/userActionLogger'

interface ECOSearchResult {
  eco_number: string
  eco_title: string | null
  file_id: string
  file_name: string
  file_path: string
  part_number: string | null
}

export function SearchView() {
  const { files, searchQuery, setSearchQuery, toggleFileSelection, selectedFiles, organization } =
    usePDMStore()

  const { enforcedHiddenPaths } = useHiddenFolders()

  const [localQuery, setLocalQuery] = useState(searchQuery)
  const [ecoResults, setEcoResults] = useState<ECOSearchResult[]>([])
  const [isSearchingECO, setIsSearchingECO] = useState(false)
  const [searchMode, setSearchMode] = useState<'files' | 'eco'>('files')

  // Detect if query looks like an ECO search
  const isECOQuery = useMemo(() => {
    const query = localQuery.trim().toLowerCase()
    // Detect eco: prefix or ECO-xxx pattern
    return (
      query.startsWith('eco:') ||
      query.startsWith('eco-') ||
      query.startsWith('ecr-') ||
      query.startsWith('ecn-')
    )
  }, [localQuery])

  // Extract ECO search term
  const ecoSearchTerm = useMemo(() => {
    const query = localQuery.trim()
    if (query.toLowerCase().startsWith('eco:')) {
      return query.slice(4).trim()
    }
    return query
  }, [localQuery])

  // Search ECOs when query changes
  useEffect(() => {
    if (!isECOQuery || !organization || !ecoSearchTerm) {
      setEcoResults([])
      return
    }

    const searchECOs = async () => {
      setIsSearchingECO(true)
      setSearchMode('eco')

      try {
        const client = getSupabaseClient()

        // First find ECOs matching the search
        const { data: ecos, error: ecoError } = await client
          .from('ecos')
          .select('id, eco_number, title')
          .eq('org_id', organization.id)
          .ilike('eco_number', `%${ecoSearchTerm}%`)

        if (ecoError) {
          log.error('[Search]', 'ECO search error', { error: ecoError })
          return
        }

        if (!ecos || ecos.length === 0) {
          setEcoResults([])
          return
        }

        // Get files for matching ECOs
        const ecoIds = ecos.map((e) => e.id)
        const { data: fileEcos, error: fileError } = await client
          .from('file_ecos')
          .select(
            `
            eco_id,
            file:files!file_id(
              id,
              file_name,
              file_path,
              part_number
            )
          `,
          )
          .in('eco_id', ecoIds)

        if (fileError) {
          log.error('[Search]', 'File ECO search error', { error: fileError })
          return
        }

        // Build results with ECO info
        const results: ECOSearchResult[] = []
        for (const fe of fileEcos || []) {
          const eco = ecos.find((e) => e.id === fe.eco_id)
          const file = fe.file as any // TODO: type this
          if (eco && file) {
            results.push({
              eco_number: eco.eco_number,
              eco_title: eco.title,
              file_id: file.id,
              file_name: file.file_name,
              file_path: file.file_path,
              part_number: file.part_number,
            })
          }
        }

        setEcoResults(results)
      } catch (error) {
        log.error('[Search]', 'ECO search failed', { error: error })
      } finally {
        setIsSearchingECO(false)
      }
    }

    // Debounce search
    const timer = setTimeout(searchECOs, 300)
    return () => clearTimeout(timer)
  }, [isECOQuery, ecoSearchTerm, organization])

  // Update search mode when query changes
  useEffect(() => {
    if (!isECOQuery) {
      setSearchMode('files')
    }
  }, [isECOQuery])

  // Filter files based on search (for regular file search)
  const fileSearchResults = useMemo(() => {
    if (!localQuery.trim() || isECOQuery) return []

    const query = localQuery.toLowerCase()
    return files.filter(
      (f) =>
        !isPathHidden(f.relativePath, enforcedHiddenPaths) &&
        (f.name.toLowerCase().includes(query) ||
          f.relativePath.toLowerCase().includes(query) ||
          resolvePartNumber(f).value?.toLowerCase().includes(query) ||
          resolveDescription(f).value?.toLowerCase().includes(query)),
    )
  }, [localQuery, files, isECOQuery, enforcedHiddenPaths])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (localQuery.trim()) {
      logSearch(localQuery, searchMode)
    }
    setSearchQuery(localQuery)
  }

  const clearSearch = () => {
    setLocalQuery('')
    setSearchQuery('')
    setEcoResults([])
  }

  // Handle clicking an ECO result
  const handleECOResultClick = (result: ECOSearchResult, ctrlKey: boolean) => {
    // Find the file in local files by path
    const normalizedPath = result.file_path.replace(/\//g, '\\')
    const localFile = files.find(
      (f) =>
        f.relativePath.toLowerCase() === result.file_path.toLowerCase() ||
        f.relativePath.toLowerCase() === normalizedPath.toLowerCase(),
    )

    if (localFile) {
      toggleFileSelection(localFile.path, ctrlKey)
    }
  }

  // Group ECO results by ECO number
  const groupedECOResults = useMemo(() => {
    const groups: Record<string, ECOSearchResult[]> = {}
    for (const result of ecoResults) {
      if (!groups[result.eco_number]) {
        groups[result.eco_number] = []
      }
      groups[result.eco_number].push(result)
    }
    return groups
  }, [ecoResults])

  return (
    <div className="p-4">
      <form onSubmit={handleSearch} className="relative mb-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
        <input
          type="text"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          placeholder="Search files or eco:ECO-001..."
          className="w-full pl-9 pr-8"
        />
        {localQuery && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
          >
            <X size={14} />
          </button>
        )}
      </form>

      {/* Search mode indicator */}
      {localQuery.trim() && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-plm-fg-muted">Searching:</span>
          <span
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
              searchMode === 'eco'
                ? 'bg-plm-accent/20 text-plm-accent'
                : 'bg-plm-bg-light text-plm-fg-dim'
            }`}
          >
            {searchMode === 'eco' ? (
              <>
                <ClipboardList size={10} />
                ECO Files
              </>
            ) : (
              <>
                <File size={10} />
                Files
              </>
            )}
          </span>
          {isSearchingECO && <Loader2 size={12} className="animate-spin text-plm-fg-muted" />}
        </div>
      )}

      {localQuery.trim() ? (
        searchMode === 'eco' ? (
          // ECO Search Results
          <>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">
              ECO Results ({ecoResults.length} files)
            </div>

            {isSearchingECO ? (
              <div className="flex items-center justify-center py-8">
                <div className="spinner" />
              </div>
            ) : ecoResults.length === 0 ? (
              <div className="text-sm text-plm-fg-muted py-4 text-center">
                No files found for ECO "{ecoSearchTerm}"
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupedECOResults).map(([ecoNumber, results]) => (
                  <div
                    key={ecoNumber}
                    className="bg-plm-bg-light rounded border border-plm-border overflow-hidden"
                  >
                    <div className="flex items-center gap-2 p-2 bg-plm-bg border-b border-plm-border">
                      <Tag size={12} className="text-plm-accent" />
                      <span className="font-medium text-sm">{ecoNumber}</span>
                      <span className="text-xs text-plm-fg-muted">
                        ({results.length} file{results.length > 1 ? 's' : ''})
                      </span>
                    </div>
                    <div className="divide-y divide-plm-border">
                      {results.map((result) => {
                        const normalizedPath = result.file_path.replace(/\//g, '\\')
                        const localFile = files.find(
                          (f) =>
                            f.relativePath.toLowerCase() === result.file_path.toLowerCase() ||
                            f.relativePath.toLowerCase() === normalizedPath.toLowerCase(),
                        )
                        const isSelected = localFile && selectedFiles.includes(localFile.path)

                        return (
                          <div
                            key={result.file_id}
                            onClick={(e) => handleECOResultClick(result, e.ctrlKey || e.metaKey)}
                            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                              isSelected ? 'bg-plm-selection' : 'hover:bg-plm-highlight'
                            }`}
                          >
                            <File size={14} className="text-plm-fg-muted flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm truncate">{result.file_name}</div>
                              <div className="text-xs text-plm-fg-muted truncate flex items-center gap-2">
                                <span>{result.file_path}</span>
                                {result.part_number && (
                                  <span className="text-plm-accent">{result.part_number}</span>
                                )}
                              </div>
                            </div>
                            {!localFile && (
                              <span
                                className="text-xs text-plm-warning"
                                title="File not in local vault"
                              >
                                cloud
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          // Regular File Search Results
          <>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">
              Results ({fileSearchResults.length})
            </div>

            {fileSearchResults.length === 0 ? (
              <div className="text-sm text-plm-fg-muted py-4 text-center">No files found</div>
            ) : (
              <div className="space-y-1">
                {fileSearchResults.slice(0, 50).map((file) => (
                  <div
                    key={file.path}
                    onClick={(e) => toggleFileSelection(file.path, e.ctrlKey || e.metaKey)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
                      selectedFiles.includes(file.path)
                        ? 'bg-plm-selection'
                        : 'hover:bg-plm-highlight'
                    }`}
                  >
                    {file.isDirectory ? (
                      <FolderOpen size={14} className="text-plm-warning flex-shrink-0" />
                    ) : (
                      <File size={14} className="text-plm-fg-muted flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{file.name}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{file.relativePath}</div>
                    </div>
                  </div>
                ))}
                {fileSearchResults.length > 50 && (
                  <div className="text-xs text-plm-fg-muted text-center py-2">
                    Showing 50 of {fileSearchResults.length} results
                  </div>
                )}
              </div>
            )}
          </>
        )
      ) : (
        <div className="text-sm text-plm-fg-muted py-4 text-center space-y-2">
          <p>Enter a search term to find files</p>
          <p className="text-xs">Tip: Search "eco:ECO-001" to find files tagged with an ECO</p>
        </div>
      )}
    </div>
  )
}
