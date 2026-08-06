import { useState, useCallback, useMemo } from 'react'
import {
  Layers,
  Search,
  Database,
  Settings2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileBox,
  Loader2,
  Copy,
  Check,
  Info,
  HelpCircle,
} from 'lucide-react'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import {
  getFileReferenceDiagnostics,
  getVaultFilesForDiagnostics,
  type FileReferenceDiagnostic,
} from '@/lib/supabase'
import { copyToClipboard } from '@/lib/clipboard'
import { resolvePartNumber, resolvedText } from '@/lib/metadata/overlay'
import { useSolidWorksService } from '@/features/integrations/solidworks/SolidWorksPanel'
import { matchSwPathToDb, type PathMatchResult, type SWServiceReference } from '@/lib/solidworks'

// ============================================
// Types
// ============================================

interface DiagnosticSummary {
  dbReferenceCount: number
  swReferenceCount: number
  matchedCount: number
  missingInDbCount: number
  missingInSwCount: number
}

// ============================================
// Sub-Components
// ============================================

function StatusBadge({ status }: { status: 'success' | 'warning' | 'error' | 'info' }) {
  const styles = {
    success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  }

  const icons = {
    success: <CheckCircle size={12} />,
    warning: <AlertTriangle size={12} />,
    error: <XCircle size={12} />,
    info: <Info size={12} />,
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border ${styles[status]}`}
    >
      {icons[status]}
    </span>
  )
}

function MatchMethodBadge({ method }: { method: 'exact' | 'suffix' | 'filename' | 'none' }) {
  const styles = {
    exact: 'bg-emerald-500/20 text-emerald-400',
    suffix: 'bg-blue-500/20 text-blue-400',
    filename: 'bg-amber-500/20 text-amber-400',
    none: 'bg-red-500/20 text-red-400',
  }

  const labels = {
    exact: 'Exact Match',
    suffix: 'Suffix Match',
    filename: 'Filename Only',
    none: 'No Match',
  }

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[method]}`}>{labels[method]}</span>
  )
}

function PathComparisonRow({
  label,
  value,
  status,
}: {
  label: string
  value: string | null
  status?: 'match' | 'mismatch' | 'neutral'
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-plm-fg-muted w-20 flex-shrink-0">{label}:</span>
      <code
        className={`text-[11px] font-mono truncate flex-1 ${
          status === 'match'
            ? 'text-emerald-400'
            : status === 'mismatch'
              ? 'text-red-400'
              : 'text-plm-fg'
        }`}
      >
        {value || '(none)'}
      </code>
    </div>
  )
}

// ============================================
// Main Component
// ============================================

interface ReferenceDiagnosticsProps {
  onClose?: () => void
}

export function ReferenceDiagnostics({ onClose }: ReferenceDiagnosticsProps) {
  const { files, organization, activeVaultId, vaultPath, addToast } = usePDMStore()
  const { status: swStatus, startService, isStarting } = useSolidWorksService()

  // State
  const [selectedFile, setSelectedFile] = useState<LocalFile | null>(null)
  const [isLoadingDb, setIsLoadingDb] = useState(false)
  const [isLoadingSw, setIsLoadingSw] = useState(false)
  const [dbReferences, setDbReferences] = useState<FileReferenceDiagnostic[]>([])
  const [swReferences, setSwReferences] = useState<SWServiceReference[]>([])
  const [pathMatches, setPathMatches] = useState<PathMatchResult[]>([])
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary', 'db']))
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  // Filter assembly files
  const assemblyFiles = useMemo(() => {
    return files.filter((f) => f.extension?.toLowerCase() === '.sldasm' && f.pdmData?.id)
  }, [files])

  // Filter assemblies by search.
  //
  // The part number is a label for finding the right assembly, not one of the values this panel
  // diagnoses - it compares reference paths, never metadata - so it follows the same overlay as
  // every other picker rather than showing the server's copy.
  const filteredAssemblies = useMemo(() => {
    if (!searchQuery) return assemblyFiles.slice(0, 50) // Limit for performance
    const query = searchQuery.toLowerCase()
    return assemblyFiles
      .filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.relativePath.toLowerCase().includes(query) ||
          resolvePartNumber(f).value?.toLowerCase().includes(query),
      )
      .slice(0, 50)
  }, [assemblyFiles, searchQuery])

  // Calculate summary
  const summary = useMemo((): DiagnosticSummary => {
    const matchedDbIds = new Set(
      pathMatches.filter((m) => m.matchedDbFile).map((m) => m.matchedDbFile!.id),
    )

    return {
      dbReferenceCount: dbReferences.length,
      swReferenceCount: swReferences.length,
      matchedCount: pathMatches.filter((m) => m.matchMethod !== 'none').length,
      missingInDbCount: pathMatches.filter((m) => m.matchMethod === 'none').length,
      missingInSwCount: dbReferences.filter((r) => !matchedDbIds.has(r.child_file_id)).length,
    }
  }, [dbReferences, swReferences, pathMatches])

  // Toggle section
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  // Load database references
  const loadDbReferences = useCallback(
    async (file: LocalFile) => {
      if (!file.pdmData?.id) return

      setIsLoadingDb(true)
      try {
        const { references, error } = await getFileReferenceDiagnostics(file.pdmData.id)

        if (error) {
          addToast('error', `Failed to load DB references: ${error.message}`)
          return
        }

        setDbReferences(references)
      } catch (error) {
        addToast('error', `Error: ${error}`)
      } finally {
        setIsLoadingDb(false)
      }
    },
    [addToast],
  )

  // Load SW references and vault files
  const loadSwReferences = useCallback(
    async (file: LocalFile) => {
      if (!swStatus.running || !organization?.id || !activeVaultId) return

      setIsLoadingSw(true)
      try {
        // Load vault files for path matching
        const { files: vFiles, error: vError } = await getVaultFilesForDiagnostics(
          organization.id,
          activeVaultId,
        )

        if (vError) {
          addToast('error', `Failed to load vault files: ${vError.message}`)
          return
        }

        // Get references from SW service
        const result = await window.electronAPI?.solidworks?.getReferences(file.path)

        if (!result?.success || !result.data?.references) {
          addToast('info', 'No references returned from SolidWorks')
          setSwReferences([])
          setPathMatches([])
          return
        }

        const refs = result.data.references as SWServiceReference[]
        setSwReferences(refs)

        // Calculate path matches
        const matches = refs.map((ref) => matchSwPathToDb(ref.path, vFiles, vaultPath || undefined))
        setPathMatches(matches)
      } catch (error) {
        addToast('error', `Error: ${error}`)
      } finally {
        setIsLoadingSw(false)
      }
    },
    [swStatus.running, organization?.id, activeVaultId, vaultPath, addToast],
  )

  // Handle file selection
  const handleSelectFile = useCallback(
    (file: LocalFile) => {
      setSelectedFile(file)
      setDbReferences([])
      setSwReferences([])
      setPathMatches([])

      loadDbReferences(file)
      if (swStatus.running) {
        loadSwReferences(file)
      }
    },
    [loadDbReferences, loadSwReferences, swStatus.running],
  )

  // Refresh all data
  const handleRefresh = useCallback(() => {
    if (selectedFile) {
      loadDbReferences(selectedFile)
      if (swStatus.running) {
        loadSwReferences(selectedFile)
      }
    }
  }, [selectedFile, loadDbReferences, loadSwReferences, swStatus.running])

  // Copy path
  const handleCopyPath = async (path: string) => {
    const result = await copyToClipboard(path)
    if (result.success) {
      setCopiedPath(path)
      setTimeout(() => setCopiedPath(null), 1500)
    }
  }

  const isLoading = isLoadingDb || isLoadingSw

  return (
    <div className="flex flex-col h-full bg-plm-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-plm-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Layers size={18} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-plm-fg">Reference Diagnostics</h2>
            <p className="text-xs text-plm-fg-muted">Debug BOM/assembly reference extraction</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* SW Status indicator */}
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
              swStatus.running
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-plm-fg-muted/10 text-plm-fg-muted'
            }`}
          >
            <Settings2 size={12} />
            {swStatus.running ? 'SW Connected' : 'SW Offline'}
          </div>

          {!swStatus.running && (
            <button
              onClick={startService}
              disabled={isStarting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-plm-accent/10 text-plm-accent hover:bg-plm-accent/20 transition-colors"
            >
              {isStarting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Settings2 size={12} />
              )}
              Start Service
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-plm-highlight rounded transition-colors"
            >
              <XCircle size={16} className="text-plm-fg-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: File Selector */}
        <div className="w-72 border-r border-plm-border flex flex-col bg-plm-sidebar">
          <div className="p-2 border-b border-plm-border">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-plm-fg-muted"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assemblies..."
                className="w-full pl-7 pr-2 py-1.5 text-xs bg-plm-input border border-plm-border rounded focus:outline-none focus:border-plm-accent"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-1">
            {filteredAssemblies.length === 0 ? (
              <div className="text-center py-8 text-xs text-plm-fg-muted">
                <Layers size={24} className="mx-auto mb-2 opacity-30" />
                <p>No synced assemblies found</p>
                <p className="text-[10px] mt-1">Check in assemblies first</p>
              </div>
            ) : (
              filteredAssemblies.map((file) => (
                <div
                  key={file.relativePath}
                  onClick={() => handleSelectFile(file)}
                  className={`p-2 rounded cursor-pointer transition-colors ${
                    selectedFile?.relativePath === file.relativePath
                      ? 'bg-plm-accent/20 border border-plm-accent/40'
                      : 'hover:bg-plm-highlight border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Layers size={14} className="text-amber-400 flex-shrink-0" />
                    <span className="text-xs text-plm-fg truncate">{file.name}</span>
                  </div>
                  {resolvePartNumber(file).value && (
                    <div className="text-[10px] text-plm-accent mt-0.5 pl-5 truncate">
                      {resolvedText(resolvePartNumber(file))}
                    </div>
                  )}
                  <div className="text-[10px] text-plm-fg-muted mt-0.5 pl-5 truncate">
                    {file.relativePath}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Diagnostics */}
        <div className="flex-1 overflow-auto">
          {!selectedFile ? (
            <div className="flex flex-col items-center justify-center h-full text-plm-fg-muted">
              <HelpCircle size={48} className="mb-4 opacity-30" />
              <p className="text-sm">Select an assembly to diagnose</p>
              <p className="text-xs mt-1 opacity-70">Compare database references with SolidWorks</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Selected File Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Layers size={20} className="text-amber-400" />
                  <div>
                    <div className="text-sm font-medium text-plm-fg">{selectedFile.name}</div>
                    <div className="text-xs text-plm-fg-muted">{selectedFile.relativePath}</div>
                  </div>
                </div>

                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-plm-bg-light border border-plm-border hover:bg-plm-highlight transition-colors"
                >
                  <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>

              {/* Summary Section */}
              <div className="border border-plm-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('summary')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-plm-bg-light hover:bg-plm-highlight transition-colors"
                >
                  {expandedSections.has('summary') ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span className="text-xs font-medium text-plm-fg">Summary</span>
                  {summary.missingInDbCount > 0 && <StatusBadge status="warning" />}
                </button>

                {expandedSections.has('summary') && (
                  <div className="p-3 bg-plm-bg space-y-2">
                    {isLoading ? (
                      <div className="flex items-center gap-2 py-4 justify-center">
                        <Loader2 size={16} className="animate-spin text-plm-accent" />
                        <span className="text-xs text-plm-fg-muted">Loading...</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Database size={14} className="text-plm-accent" />
                            <span className="text-xs text-plm-fg-muted">Database</span>
                          </div>
                          <div className="text-2xl font-bold text-plm-fg">
                            {summary.dbReferenceCount}
                          </div>
                          <div className="text-xs text-plm-fg-muted">references stored</div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Settings2 size={14} className="text-amber-400" />
                            <span className="text-xs text-plm-fg-muted">SolidWorks</span>
                          </div>
                          <div className="text-2xl font-bold text-plm-fg">
                            {swStatus.running ? summary.swReferenceCount : '—'}
                          </div>
                          <div className="text-xs text-plm-fg-muted">
                            {swStatus.running ? 'references found' : 'service offline'}
                          </div>
                        </div>

                        {swStatus.running && (
                          <>
                            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                              <div className="text-lg font-bold text-emerald-400">
                                {summary.matchedCount}
                              </div>
                              <div className="text-xs text-emerald-300">matched paths</div>
                            </div>

                            <div
                              className={`p-2 rounded ${
                                summary.missingInDbCount > 0
                                  ? 'bg-red-500/10 border border-red-500/20'
                                  : 'bg-plm-bg-light border border-plm-border'
                              }`}
                            >
                              <div
                                className={`text-lg font-bold ${
                                  summary.missingInDbCount > 0 ? 'text-red-400' : 'text-plm-fg'
                                }`}
                              >
                                {summary.missingInDbCount}
                              </div>
                              <div
                                className={`text-xs ${
                                  summary.missingInDbCount > 0
                                    ? 'text-red-300'
                                    : 'text-plm-fg-muted'
                                }`}
                              >
                                missing in DB
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Database References Section */}
              <div className="border border-plm-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('db')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-plm-bg-light hover:bg-plm-highlight transition-colors"
                >
                  {expandedSections.has('db') ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <Database size={14} className="text-plm-accent" />
                  <span className="text-xs font-medium text-plm-fg">Database References</span>
                  <span className="text-xs text-plm-fg-muted ml-auto">{dbReferences.length}</span>
                </button>

                {expandedSections.has('db') && (
                  <div className="divide-y divide-plm-border/50">
                    {isLoadingDb ? (
                      <div className="flex items-center gap-2 py-4 justify-center">
                        <Loader2 size={16} className="animate-spin text-plm-accent" />
                        <span className="text-xs text-plm-fg-muted">Loading...</span>
                      </div>
                    ) : dbReferences.length === 0 ? (
                      <div className="p-4 text-center">
                        <XCircle size={24} className="mx-auto mb-2 text-plm-fg-muted opacity-50" />
                        <p className="text-xs text-plm-fg-muted">No references in database</p>
                        <p className="text-[10px] text-plm-fg-dim mt-1">
                          Check in assembly with SW service running to extract
                        </p>
                      </div>
                    ) : (
                      dbReferences.map((ref) => (
                        <div key={ref.id} className="p-3 hover:bg-plm-highlight/30">
                          <div className="flex items-center gap-2">
                            <FileBox size={14} className="text-plm-accent flex-shrink-0" />
                            <span className="text-xs text-plm-fg font-medium truncate">
                              {ref.child?.file_name || 'Unknown'}
                            </span>
                            {ref.quantity > 1 && (
                              <span className="text-xs text-plm-fg-muted bg-plm-bg px-1.5 py-0.5 rounded">
                                ×{ref.quantity}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 pl-5 space-y-0.5">
                            <div className="flex items-center gap-1 group">
                              <code className="text-[10px] text-plm-fg-muted font-mono truncate">
                                {ref.child?.file_path || ref.child_file_id}
                              </code>
                              <button
                                onClick={() =>
                                  handleCopyPath(ref.child?.file_path || ref.child_file_id)
                                }
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-plm-bg rounded"
                              >
                                {copiedPath === (ref.child?.file_path || ref.child_file_id) ? (
                                  <Check size={10} className="text-emerald-400" />
                                ) : (
                                  <Copy size={10} className="text-plm-fg-muted" />
                                )}
                              </button>
                            </div>
                            {ref.child?.part_number && (
                              <div className="text-[10px] text-plm-accent">
                                P/N: {ref.child.part_number}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* SolidWorks References Section */}
              <div className="border border-plm-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('sw')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-plm-bg-light hover:bg-plm-highlight transition-colors"
                >
                  {expandedSections.has('sw') ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <Settings2 size={14} className="text-amber-400" />
                  <span className="text-xs font-medium text-plm-fg">SolidWorks References</span>
                  <span className="text-xs text-plm-fg-muted ml-auto">
                    {swStatus.running ? swReferences.length : '(offline)'}
                  </span>
                </button>

                {expandedSections.has('sw') && (
                  <div className="divide-y divide-plm-border/50">
                    {!swStatus.running ? (
                      <div className="p-4 text-center">
                        <Settings2
                          size={24}
                          className="mx-auto mb-2 text-plm-fg-muted opacity-50"
                        />
                        <p className="text-xs text-plm-fg-muted">SolidWorks service not running</p>
                        <button
                          onClick={startService}
                          disabled={isStarting}
                          className="mt-2 text-xs text-plm-accent hover:underline"
                        >
                          Start service to compare
                        </button>
                      </div>
                    ) : isLoadingSw ? (
                      <div className="flex items-center gap-2 py-4 justify-center">
                        <Loader2 size={16} className="animate-spin text-amber-400" />
                        <span className="text-xs text-plm-fg-muted">
                          Loading from SolidWorks...
                        </span>
                      </div>
                    ) : swReferences.length === 0 ? (
                      <div className="p-4 text-center">
                        <Layers size={24} className="mx-auto mb-2 text-plm-fg-muted opacity-50" />
                        <p className="text-xs text-plm-fg-muted">No references found</p>
                        <p className="text-[10px] text-plm-fg-dim mt-1">
                          Assembly may be empty or file not open in SW
                        </p>
                      </div>
                    ) : (
                      swReferences.map((ref, idx) => {
                        const match = pathMatches[idx]
                        return (
                          <div key={ref.path} className="p-3 hover:bg-plm-highlight/30">
                            <div className="flex items-center gap-2">
                              <FileBox
                                size={14}
                                className={
                                  match?.matchMethod === 'none' ? 'text-red-400' : 'text-amber-400'
                                }
                              />
                              <span className="text-xs text-plm-fg font-medium truncate">
                                {ref.fileName}
                              </span>
                              {match && <MatchMethodBadge method={match.matchMethod} />}
                            </div>

                            <div className="mt-2 pl-5 space-y-1 text-[10px]">
                              <PathComparisonRow
                                label="SW Path"
                                value={match?.normalizedSwPath || ref.path}
                              />
                              {match?.matchedDbFile && (
                                <PathComparisonRow
                                  label="DB Path"
                                  value={match.normalizedDbPath}
                                  status="match"
                                />
                              )}
                              {match?.matchMethod === 'none' && (
                                <div className="flex items-center gap-1 text-red-400 mt-1">
                                  <AlertTriangle size={10} />
                                  <span>No matching file in database</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Path Matching Failures Section */}
              {summary.missingInDbCount > 0 && (
                <div className="border border-red-500/30 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSection('failures')}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                  >
                    {expandedSections.has('failures') ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    <AlertTriangle size={14} className="text-red-400" />
                    <span className="text-xs font-medium text-red-400">Path Matching Failures</span>
                    <span className="text-xs text-red-300 ml-auto">{summary.missingInDbCount}</span>
                  </button>

                  {expandedSections.has('failures') && (
                    <div className="p-3 bg-plm-bg space-y-3">
                      <p className="text-xs text-plm-fg-muted">
                        These SolidWorks references couldn't be matched to database files. Common
                        causes:
                      </p>
                      <ul className="text-xs text-plm-fg-muted list-disc pl-4 space-y-1">
                        <li>Component files not checked in to database yet</li>
                        <li>Path differences between local and database paths</li>
                        <li>Multiple files with same name (ambiguous match)</li>
                        <li>Vault root path not configured correctly</li>
                      </ul>

                      <div className="pt-2 border-t border-plm-border/50 space-y-2">
                        {pathMatches
                          .filter((m) => m.matchMethod === 'none')
                          .map((match) => (
                            <div
                              key={match.swPath}
                              className="p-2 rounded bg-red-500/5 border border-red-500/20"
                            >
                              <div className="flex items-center gap-2">
                                <XCircle size={12} className="text-red-400 flex-shrink-0" />
                                <span className="text-xs text-plm-fg truncate">
                                  {match.swFileName}
                                </span>
                              </div>
                              <code className="block text-[10px] text-red-300 font-mono mt-1 truncate pl-4">
                                {match.normalizedSwPath}
                              </code>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Vault Root Info */}
              {vaultPath && (
                <div className="p-3 rounded bg-plm-bg-light border border-plm-border text-xs">
                  <div className="flex items-center gap-2 text-plm-fg-muted">
                    <Info size={12} />
                    <span>Vault Root Path:</span>
                  </div>
                  <code className="block text-[10px] text-plm-fg font-mono mt-1">{vaultPath}</code>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Inline version for embedding in settings/dev-tools
export function ReferenceDiagnosticsInline() {
  return (
    <div className="h-[600px] w-full border border-plm-border rounded-lg overflow-hidden">
      <ReferenceDiagnostics />
    </div>
  )
}
