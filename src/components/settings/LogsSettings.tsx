import { useState, useEffect } from 'react'
import { 
  FileText, 
  Loader2, 
  Filter, 
  ChevronDown,
  Copy,
  Trash2,
  Calendar,
  CheckSquare,
  Square,
  ArrowLeft
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

interface LogFile {
  name: string
  path: string
  size: number
  modifiedTime: string
  isCurrentSession: boolean
}

export function LogsSettings() {
  const { addToast } = usePDMStore()
  
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [selectedLogFile, setSelectedLogFile] = useState<{ name: string; path: string; content: string } | null>(null)
  const [isLoadingLogContent, setIsLoadingLogContent] = useState(false)
  const [logFilter, setLogFilter] = useState<'today' | 'week' | 'all'>('all')
  const [logFilterDropdownOpen, setLogFilterDropdownOpen] = useState(false)
  const [selectedLogPaths, setSelectedLogPaths] = useState<Set<string>>(new Set())
  const [copyingLogPath, setCopyingLogPath] = useState<string | null>(null)
  const [isBulkCopying, setIsBulkCopying] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  
  // Load log files on mount
  useEffect(() => {
    loadLogFiles()
  }, [])
  
  const loadLogFiles = async () => {
    if (!window.electronAPI?.listLogFiles) return
    setIsLoadingLogs(true)
    try {
      const result = await window.electronAPI.listLogFiles()
      if (result.success && result.files) {
        setLogFiles(result.files)
      }
    } catch (err) {
      console.error('Failed to load log files:', err)
    } finally {
      setIsLoadingLogs(false)
    }
  }
  
  const viewLogFile = async (logFile: { name: string; path: string }) => {
    if (!window.electronAPI?.readLogFile) return
    setIsLoadingLogContent(true)
    try {
      const result = await window.electronAPI.readLogFile(logFile.path)
      if (result.success && result.content) {
        setSelectedLogFile({ name: logFile.name, path: logFile.path, content: result.content })
      } else {
        addToast('error', result.error || 'Failed to read log file')
      }
    } catch (err) {
      addToast('error', 'Failed to read log file')
    } finally {
      setIsLoadingLogContent(false)
    }
  }
  
  // Parse date from filename for filtering
  const getLogFileDate = (filename: string): Date | null => {
    const match = filename.match(/bluepdm-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.log/)
    if (match) {
      const [, year, month, day, hour, minute, second] = match
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
    }
    return null
  }
  
  // Filter log files
  const filteredLogFiles = logFiles.filter(file => {
    if (logFilter === 'all') return true
    
    const fileDate = getLogFileDate(file.name) || new Date(file.modifiedTime)
    const now = new Date()
    
    if (logFilter === 'today') {
      return fileDate.toDateString() === now.toDateString()
    } else if (logFilter === 'week') {
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return fileDate >= weekAgo
    }
    
    return true
  })
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  
  // Toggle selection
  const toggleLogSelection = (path: string) => {
    setSelectedLogPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }
  
  // Select/deselect all
  const toggleSelectAllLogs = () => {
    const allFilteredPaths = filteredLogFiles.map(f => f.path)
    const allSelected = allFilteredPaths.every(p => selectedLogPaths.has(p))
    
    if (allSelected) {
      setSelectedLogPaths(new Set())
    } else {
      setSelectedLogPaths(new Set(allFilteredPaths))
    }
  }
  
  // Copy single log
  const copyLogFile = async (file: { name: string; path: string }) => {
    if (!window.electronAPI?.readLogFile) return
    setCopyingLogPath(file.path)
    try {
      const result = await window.electronAPI.readLogFile(file.path)
      if (result.success && result.content) {
        await navigator.clipboard.writeText(result.content)
        addToast('success', `Copied ${file.name}`)
      } else {
        addToast('error', result.error || 'Failed to read log file')
      }
    } catch (err) {
      addToast('error', 'Failed to copy log file')
    } finally {
      setCopyingLogPath(null)
    }
  }
  
  // Bulk copy
  const bulkCopyLogs = async () => {
    if (!window.electronAPI?.readLogFile || selectedLogPaths.size === 0) return
    setIsBulkCopying(true)
    try {
      const selectedFiles = filteredLogFiles.filter(f => selectedLogPaths.has(f.path))
      const contents: string[] = []
      
      for (const file of selectedFiles) {
        const result = await window.electronAPI.readLogFile(file.path)
        if (result.success && result.content) {
          contents.push(`${'='.repeat(60)}\n${file.name}\n${'='.repeat(60)}\n${result.content}\n`)
        }
      }
      
      if (contents.length > 0) {
        await navigator.clipboard.writeText(contents.join('\n'))
        addToast('success', `Copied ${contents.length} log file${contents.length > 1 ? 's' : ''}`)
      }
    } catch (err) {
      addToast('error', 'Failed to copy log files')
    } finally {
      setIsBulkCopying(false)
    }
  }
  
  // Bulk delete
  const bulkDeleteLogs = async () => {
    if (!window.electronAPI?.deleteLogFile || selectedLogPaths.size === 0) return
    setIsBulkDeleting(true)
    try {
      const selectedFiles = filteredLogFiles.filter(f => selectedLogPaths.has(f.path) && !f.isCurrentSession)
      let deletedCount = 0
      
      for (const file of selectedFiles) {
        const result = await window.electronAPI.deleteLogFile(file.path)
        if (result?.success) {
          deletedCount++
        }
      }
      
      if (deletedCount > 0) {
        addToast('success', `Deleted ${deletedCount} log file${deletedCount > 1 ? 's' : ''}`)
        setSelectedLogPaths(new Set())
        loadLogFiles()
      }
    } catch (err) {
      addToast('error', 'Failed to delete log files')
    } finally {
      setIsBulkDeleting(false)
    }
  }
  
  const allFilteredSelected = filteredLogFiles.length > 0 && filteredLogFiles.every(f => selectedLogPaths.has(f.path))
  const deletableSelectedCount = filteredLogFiles.filter(f => selectedLogPaths.has(f.path) && !f.isCurrentSession).length

  if (isLoadingLogs) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-pdm-fg-muted" size={28} />
      </div>
    )
  }

  // Log content view
  if (selectedLogFile) {
    return (
      <div className="space-y-4 h-full flex flex-col">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedLogFile(null)}
            className="flex items-center gap-1.5 text-sm text-pdm-accent hover:underline"
          >
            <ArrowLeft size={16} />
            Back to log files
          </button>
          <span className="text-sm text-pdm-fg-muted">|</span>
          <span className="text-sm text-pdm-fg">{selectedLogFile.name}</span>
        </div>
        
        {isLoadingLogContent ? (
          <div className="flex items-center justify-center py-12 flex-1">
            <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
          </div>
        ) : (
          <pre className="flex-1 p-4 bg-pdm-bg rounded-lg border border-pdm-border text-xs font-mono text-pdm-fg overflow-auto whitespace-pre-wrap">
            {selectedLogFile.content}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with filter and bulk actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Select all */}
          <button
            onClick={toggleSelectAllLogs}
            className="p-1 text-pdm-fg-muted hover:text-pdm-fg"
            title={allFilteredSelected ? 'Deselect all' : 'Select all'}
          >
            {allFilteredSelected ? <CheckSquare size={18} /> : <Square size={18} />}
          </button>
          
          {/* Bulk actions */}
          {selectedLogPaths.size > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={bulkCopyLogs}
                disabled={isBulkCopying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-pdm-bg border border-pdm-border rounded-lg hover:border-pdm-fg-muted transition-colors"
              >
                {isBulkCopying ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                Copy ({selectedLogPaths.size})
              </button>
              {deletableSelectedCount > 0 && (
                <button
                  onClick={bulkDeleteLogs}
                  disabled={isBulkDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-pdm-error/10 text-pdm-error border border-pdm-error/20 rounded-lg hover:bg-pdm-error/20 transition-colors"
                >
                  {isBulkDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete ({deletableSelectedCount})
                </button>
              )}
            </div>
          )}
        </div>
        
        {/* Filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setLogFilterDropdownOpen(!logFilterDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-pdm-bg border border-pdm-border rounded-lg hover:border-pdm-fg-muted transition-colors"
          >
            <Filter size={14} />
            {logFilter === 'today' ? 'Today' : logFilter === 'week' ? 'This Week' : 'All Time'}
            <ChevronDown size={14} />
          </button>
          {logFilterDropdownOpen && (
            <div className="absolute right-0 mt-1 w-36 bg-pdm-bg border border-pdm-border rounded-lg shadow-lg z-10">
              {(['all', 'week', 'today'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => {
                    setLogFilter(filter)
                    setLogFilterDropdownOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-pdm-highlight transition-colors first:rounded-t-lg last:rounded-b-lg ${
                    logFilter === filter ? 'text-pdm-accent' : 'text-pdm-fg'
                  }`}
                >
                  {filter === 'today' ? 'Today' : filter === 'week' ? 'This Week' : 'All Time'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Log files list */}
      {filteredLogFiles.length === 0 ? (
        <div className="text-center py-12">
          <FileText size={40} className="mx-auto mb-4 text-pdm-fg-muted opacity-50" />
          <p className="text-sm text-pdm-fg-muted">No log files found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredLogFiles.map(file => (
            <div
              key={file.path}
              className="flex items-center gap-3 p-3 bg-pdm-bg rounded-lg border border-pdm-border hover:border-pdm-fg-muted transition-colors group"
            >
              {/* Checkbox */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleLogSelection(file.path)
                }}
                className="text-pdm-fg-muted hover:text-pdm-fg"
              >
                {selectedLogPaths.has(file.path) ? <CheckSquare size={18} /> : <Square size={18} />}
              </button>
              
              {/* File info */}
              <button
                onClick={() => viewLogFile(file)}
                className="flex-1 flex items-center gap-3 text-left min-w-0"
              >
                <FileText size={18} className={file.isCurrentSession ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-pdm-fg truncate">{file.name}</span>
                    {file.isCurrentSession && (
                      <span className="px-1.5 py-0.5 bg-pdm-accent/20 text-pdm-accent text-xs rounded flex-shrink-0">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-pdm-fg-muted">
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      {new Date(file.modifiedTime).toLocaleDateString()}
                    </span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                </div>
              </button>
              
              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    copyLogFile(file)
                  }}
                  disabled={copyingLogPath === file.path}
                  className="p-1.5 text-pdm-fg-muted hover:text-pdm-fg rounded transition-colors"
                  title="Copy to clipboard"
                >
                  {copyingLogPath === file.path ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

