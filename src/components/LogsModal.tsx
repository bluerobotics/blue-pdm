import { useState, useEffect } from 'react'
import { 
  X, 
  FileText, 
  Loader2, 
  Copy, 
  Check, 
  Eye, 
  Trash2, 
  FolderOpen, 
  Download,
  Clock,
  ChevronLeft,
  ExternalLink
} from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'

interface LogFile {
  name: string
  path: string
  size: number
  modifiedTime: string
  isCurrentSession: boolean
}

interface LogsModalProps {
  onClose: () => void
}

export function LogsModal({ onClose }: LogsModalProps) {
  const { addToast } = usePDMStore()
  
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedLog, setSelectedLog] = useState<{ name: string; path: string; content: string } | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [logCopied, setLogCopied] = useState(false)

  // Load log files on mount
  useEffect(() => {
    loadLogFiles()
  }, [])

  const loadLogFiles = async () => {
    if (!window.electronAPI?.listLogFiles) {
      setIsLoading(false)
      return
    }
    
    setIsLoading(true)
    try {
      const result = await window.electronAPI.listLogFiles()
      if (result.success && result.files) {
        setLogFiles(result.files)
      }
    } catch (err) {
      console.error('Failed to load log files:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const viewLogFile = async (file: LogFile) => {
    if (!window.electronAPI?.readLogFile) return
    
    setIsLoadingContent(true)
    try {
      const result = await window.electronAPI.readLogFile(file.path)
      if (result.success && result.content) {
        setSelectedLog({ name: file.name, path: file.path, content: result.content })
      } else {
        addToast('error', result.error || 'Failed to read log file')
      }
    } catch {
      addToast('error', 'Failed to read log file')
    } finally {
      setIsLoadingContent(false)
    }
  }

  const copyLogFile = async (file: LogFile) => {
    if (!window.electronAPI?.readLogFile) return
    
    setCopiedPath(file.path)
    try {
      const result = await window.electronAPI.readLogFile(file.path)
      if (result.success && result.content) {
        await navigator.clipboard.writeText(result.content)
        addToast('success', `Copied ${file.name}`)
      }
    } catch {
      addToast('error', 'Failed to copy')
    } finally {
      setTimeout(() => setCopiedPath(null), 1500)
    }
  }

  const deleteLogFile = async (file: LogFile) => {
    const result = await window.electronAPI?.deleteLogFile(file.path)
    if (result?.success) {
      loadLogFiles()
      addToast('success', 'Log deleted')
    } else {
      addToast('error', result?.error || 'Failed to delete')
    }
  }

  const exportLogs = async () => {
    setIsExporting(true)
    try {
      const result = await window.electronAPI?.exportLogs()
      if (result?.success) {
        addToast('success', 'Logs exported successfully')
      } else if (!result?.canceled) {
        addToast('error', result?.error || 'Failed to export')
      }
    } catch {
      addToast('error', 'Failed to export logs')
    } finally {
      setIsExporting(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const parseSessionDate = (filename: string): string | null => {
    const match = filename.match(/bluepdm-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.log/)
    if (match) {
      const [, year, month, day, hour, minute] = match
      const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`)
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-pdm-border bg-pdm-sidebar">
          <FileText size={20} className="text-pdm-accent" />
          <h2 className="text-lg font-semibold text-pdm-fg flex-1">Application Logs</h2>
          <button
            onClick={() => window.electronAPI?.openLogsDir()}
            className="p-2 hover:bg-pdm-highlight rounded-lg transition-colors"
            title="Open logs folder"
          >
            <FolderOpen size={18} className="text-pdm-fg-muted" />
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-pdm-highlight rounded-lg transition-colors"
          >
            <X size={18} className="text-pdm-fg-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Log Viewer (if viewing a file) */}
          {selectedLog && (
            <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl w-[800px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-pdm-border bg-pdm-sidebar">
                  <button
                    onClick={() => {
                      setSelectedLog(null)
                      setLogCopied(false)
                    }}
                    className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                  >
                    <ChevronLeft size={18} className="text-pdm-fg-muted" />
                  </button>
                  <FileText size={18} className="text-pdm-fg-muted" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-pdm-fg truncate">{selectedLog.name}</div>
                  </div>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(selectedLog.content)
                      setLogCopied(true)
                      setTimeout(() => setLogCopied(false), 2000)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-pdm-bg border border-pdm-border rounded-lg hover:border-pdm-accent transition-colors"
                  >
                    {logCopied ? (
                      <>
                        <Check size={14} className="text-pdm-success" />
                        <span className="text-pdm-success">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} className="text-pdm-fg-muted" />
                        <span className="text-pdm-fg-muted">Copy All</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setSelectedLog(null)}
                    className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                  >
                    <X size={18} className="text-pdm-fg-muted" />
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-pdm-bg">
                  <pre className="text-xs text-pdm-fg-muted font-mono whitespace-pre-wrap break-all leading-relaxed">
                    {selectedLog.content}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Logs List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="text-pdm-fg-muted animate-spin" />
            </div>
          ) : logFiles.length === 0 ? (
            <div className="text-center py-12 text-pdm-fg-muted">
              No log files found
            </div>
          ) : (
            <div className="space-y-2">
              {logFiles.map((file) => (
                <div
                  key={file.path}
                  className="group flex items-center gap-3 p-3 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors"
                >
                  <FileText 
                    size={18} 
                    className={file.isCurrentSession ? 'text-pdm-accent' : 'text-pdm-fg-muted'} 
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-pdm-fg truncate">{file.name}</span>
                      {file.isCurrentSession && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-pdm-accent/20 text-pdm-accent rounded">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-pdm-fg-dim mt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {parseSessionDate(file.name) || new Date(file.modifiedTime).toLocaleString()}
                      </span>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyLogFile(file)}
                      className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                      title="Copy log content"
                    >
                      {copiedPath === file.path ? (
                        <Check size={14} className="text-pdm-success" />
                      ) : (
                        <Copy size={14} className="text-pdm-fg-muted" />
                      )}
                    </button>
                    <button
                      onClick={() => viewLogFile(file)}
                      disabled={isLoadingContent}
                      className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                      title="View log"
                    >
                      <Eye size={14} className="text-pdm-fg-muted" />
                    </button>
                    <button
                      onClick={() => window.electronAPI?.openInExplorer(file.path)}
                      className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                      title="Show in Explorer"
                    >
                      <ExternalLink size={14} className="text-pdm-fg-muted" />
                    </button>
                    {!file.isCurrentSession && (
                      <button
                        onClick={() => deleteLogFile(file)}
                        className="p-1.5 hover:bg-pdm-error/20 rounded transition-colors"
                        title="Delete log"
                      >
                        <Trash2 size={14} className="text-pdm-fg-muted hover:text-pdm-error" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Export Button */}
          <button
            onClick={exportLogs}
            disabled={isExporting}
            className="w-full flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 size={20} className="text-pdm-fg-muted animate-spin" />
            ) : (
              <Download size={20} className="text-pdm-fg-muted" />
            )}
            <div className="flex-1 text-left">
              <div className="text-sm font-medium text-pdm-fg">Export Current Session</div>
              <div className="text-xs text-pdm-fg-dim">
                Save logs to a file for sharing with support
              </div>
            </div>
          </button>

          {/* Tip */}
          <div className="p-3 bg-pdm-highlight/50 rounded-lg border border-pdm-border text-xs text-pdm-fg-dim">
            <strong>Tip:</strong> If BluePDM crashes, click the folder icon to access your logs directory.
          </div>
        </div>
      </div>
    </div>
  )
}

