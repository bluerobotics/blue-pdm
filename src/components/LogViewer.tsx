import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  X,
  FileText,
  Loader2,
  Search,
  Clock,
  AlertTriangle,
  AlertCircle,
  Info,
  Bug,
  BarChart3,
  Filter,
  RefreshCw,
  Download,
  ChevronDown,
  Copy,
  Check,
  FolderOpen,
  Trash2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Zap,
  Pause,
  Play,
  ArrowUpToLine,
  ArrowDownToLine,
  Pin,
  PinOff,
  Skull,
  Settings,
  HardDrive,
  RotateCcw
} from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'

// ============================================
// Types
// ============================================

interface LogEntry {
  id: string
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: string
  raw: string
}

interface LogFile {
  name: string
  path: string
  size: number
  modifiedTime: string
  isCurrentSession: boolean
}

interface CrashFile {
  name: string
  path: string
  size: number
  modifiedTime: string
}

type FileViewMode = 'logs' | 'crashes'

interface HistogramBucket {
  time: Date
  label: string
  info: number
  warn: number
  error: number
  debug: number
  total: number
}

type TimePeriod = '30s' | '1m' | '2m' | '5m' | '10m' | '30m' | '1h' | '6h' | '24h' | '7d' | 'all'
type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogRetentionSettings {
  maxFiles: number
  maxAgeDays: number
  maxSizeMb: number
  maxTotalSizeMb: number
}

interface LogStorageInfo {
  totalSize: number
  fileCount: number
  logsDir?: string
}

interface LogViewerProps {
  onClose: () => void
}

// ============================================
// Utility Functions
// ============================================

function parseLogLine(line: string, index: number): LogEntry | null {
  // Format: [2024-12-15T10:30:45.123Z] [LEVEL] message {optional json data}
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\s*\[(\w+)\]\s*(.+)$/)
  
  if (!match) {
    // Try alternative format without milliseconds
    const altMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?)\]\s*\[(\w+)\]\s*(.+)$/)
    if (!altMatch) return null
    
    const [, timestamp, level, content] = altMatch
    return parseEntry(timestamp, level, content, line, index)
  }
  
  const [, timestamp, level, content] = match
  return parseEntry(timestamp, level, content, line, index)
}

function parseEntry(timestamp: string, level: string, content: string, raw: string, index: number): LogEntry {
  const normalizedLevel = level.toLowerCase() as LogLevel
  const validLevels: LogLevel[] = ['info', 'warn', 'error', 'debug']
  
  // Try to extract JSON data from message
  let message = content
  let data: string | undefined
  
  const jsonMatch = content.match(/(.+?)\s*(\{[\s\S]*\})\s*$/)
  if (jsonMatch) {
    message = jsonMatch[1].trim()
    data = jsonMatch[2]
  }
  
  return {
    id: `${timestamp}-${index}`,
    timestamp: new Date(timestamp),
    level: validLevels.includes(normalizedLevel) ? normalizedLevel : 'info',
    message,
    data,
    raw
  }
}

function parseLogContent(content: string): LogEntry[] {
  const lines = content.split('\n').filter(line => line.trim())
  const entries: LogEntry[] = []
  
  lines.forEach((line, index) => {
    const entry = parseLogLine(line, index)
    if (entry) {
      entries.push(entry)
    }
  })
  
  return entries
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getTimePeriodMs(period: TimePeriod): number {
  switch (period) {
    case '30s': return 30 * 1000
    case '1m': return 60 * 1000
    case '2m': return 2 * 60 * 1000
    case '5m': return 5 * 60 * 1000
    case '10m': return 10 * 60 * 1000
    case '30m': return 30 * 60 * 1000
    case '1h': return 60 * 60 * 1000
    case '6h': return 6 * 60 * 60 * 1000
    case '24h': return 24 * 60 * 60 * 1000
    case '7d': return 7 * 24 * 60 * 60 * 1000
    case 'all': return Infinity
  }
}

function createHistogramBuckets(entries: LogEntry[], period: TimePeriod): HistogramBucket[] {
  if (entries.length === 0) return []
  
  const now = new Date()
  const periodMs = getTimePeriodMs(period)
  const startTime = period === 'all' 
    ? entries[entries.length - 1]?.timestamp || now
    : new Date(now.getTime() - periodMs)
  
  // Determine bucket size based on period
  let bucketMs: number
  let labelFormat: (d: Date) => string
  
  switch (period) {
    case '30s':
      bucketMs = 5 * 1000 // 5 seconds
      labelFormat = (d) => d.toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' })
      break
    case '1m':
      bucketMs = 10 * 1000 // 10 seconds
      labelFormat = (d) => d.toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' })
      break
    case '2m':
      bucketMs = 15 * 1000 // 15 seconds
      labelFormat = (d) => d.toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' })
      break
    case '5m':
      bucketMs = 30 * 1000 // 30 seconds
      labelFormat = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      break
    case '10m':
      bucketMs = 60 * 1000 // 1 minute
      labelFormat = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      break
    case '30m':
      bucketMs = 2 * 60 * 1000 // 2 minutes
      labelFormat = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      break
    case '1h':
      bucketMs = 5 * 60 * 1000 // 5 minutes
      labelFormat = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      break
    case '6h':
      bucketMs = 30 * 60 * 1000 // 30 minutes
      labelFormat = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      break
    case '24h':
      bucketMs = 60 * 60 * 1000 // 1 hour
      labelFormat = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      break
    case '7d':
      bucketMs = 12 * 60 * 60 * 1000 // 12 hours
      labelFormat = (d) => d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit' })
      break
    case 'all':
      // Dynamic bucket size based on date range
      const range = now.getTime() - startTime.getTime()
      bucketMs = Math.max(60 * 60 * 1000, Math.floor(range / 24))
      labelFormat = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      break
  }
  
  // Create buckets
  const buckets: Map<number, HistogramBucket> = new Map()
  const bucketStart = Math.floor(startTime.getTime() / bucketMs) * bucketMs
  const bucketEnd = Math.ceil(now.getTime() / bucketMs) * bucketMs
  
  // Initialize empty buckets
  for (let t = bucketStart; t <= bucketEnd; t += bucketMs) {
    const time = new Date(t)
    buckets.set(t, {
      time,
      label: labelFormat(time),
      info: 0,
      warn: 0,
      error: 0,
      debug: 0,
      total: 0
    })
  }
  
  // Fill buckets with entries
  entries.forEach(entry => {
    const bucketTime = Math.floor(entry.timestamp.getTime() / bucketMs) * bucketMs
    const bucket = buckets.get(bucketTime)
    if (bucket) {
      bucket[entry.level]++
      bucket.total++
    }
  })
  
  return Array.from(buckets.values()).slice(-24) // Max 24 buckets for readability
}

// ============================================
// Sub-Components
// ============================================

function LevelIcon({ level, size = 14 }: { level: LogLevel; size?: number }) {
  switch (level) {
    case 'error':
      return <AlertCircle size={size} className="text-plm-error" />
    case 'warn':
      return <AlertTriangle size={size} className="text-plm-warning" />
    case 'info':
      return <Info size={size} className="text-plm-info" />
    case 'debug':
      return <Bug size={size} className="text-plm-fg-muted" />
  }
}

function LevelBadge({ level }: { level: LogLevel }) {
  const styles: Record<LogLevel, string> = {
    error: 'bg-plm-error/20 text-plm-error border-plm-error/30',
    warn: 'bg-plm-warning/20 text-plm-warning border-plm-warning/30',
    info: 'bg-plm-info/20 text-plm-info border-plm-info/30',
    debug: 'bg-plm-fg-muted/20 text-plm-fg-muted border-plm-fg-muted/30'
  }
  
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded border ${styles[level]}`}>
      {level}
    </span>
  )
}

interface HistogramProps {
  buckets: HistogramBucket[]
  maxValue: number
  onBucketClick?: (bucket: HistogramBucket) => void
  levelFilter: Set<LogLevel>
  height: number
  onHeightChange: (height: number) => void
}

function Histogram({ buckets, maxValue, onBucketClick, levelFilter, height, onHeightChange }: HistogramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  
  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    
    const startY = e.clientY
    const startHeight = height
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startY
      const newHeight = Math.max(60, Math.min(300, startHeight + delta))
      onHeightChange(newHeight)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height, onHeightChange])
  
  if (buckets.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-plm-fg-muted text-sm">
        No data to display
      </div>
    )
  }
  
  const topPadding = 12 // Always leave some whitespace above tallest bar
  const barAreaHeight = height - topPadding
  
  const getSegmentHeight = (value: number) => {
    if (maxValue === 0 || value === 0) return 0
    return Math.max(2, Math.round((value / maxValue) * barAreaHeight))
  }
  
  // Level colors - order: error (bottom), warn, info, debug (top)
  // Using explicit colors to ensure visibility
  const levelColors = {
    error: 'bg-red-500',
    warn: 'bg-amber-500', 
    info: 'bg-blue-500',
    debug: 'bg-slate-500'
  }
  
  return (
    <div className="px-2" ref={containerRef}>
      {/* Bar area with top padding */}
      <div 
        className="flex items-end gap-[2px] overflow-hidden"
        style={{ height: `${height}px`, paddingTop: `${topPadding}px` }}
      >
        {buckets.map((bucket, index) => {
          // Build stacked segments from bottom to top: error -> warn -> info -> debug
          const segments: { level: LogLevel; count: number; color: string }[] = []
          
          if (levelFilter.has('error') && bucket.error > 0) {
            segments.push({ level: 'error', count: bucket.error, color: levelColors.error })
          }
          if (levelFilter.has('warn') && bucket.warn > 0) {
            segments.push({ level: 'warn', count: bucket.warn, color: levelColors.warn })
          }
          if (levelFilter.has('info') && bucket.info > 0) {
            segments.push({ level: 'info', count: bucket.info, color: levelColors.info })
          }
          if (levelFilter.has('debug') && bucket.debug > 0) {
            segments.push({ level: 'debug', count: bucket.debug, color: levelColors.debug })
          }
          
          const totalVisible = segments.reduce((sum, s) => sum + s.count, 0)
          
          return (
            <div
              key={index}
              className="flex-1 relative group cursor-pointer overflow-hidden"
              style={{ height: `${barAreaHeight}px` }}
              onClick={() => onBucketClick?.(bucket)}
            >
              {/* Tooltip */}
              <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-plm-bg-light border border-plm-border rounded-lg px-2 py-1.5 text-xs shadow-lg z-20 pointer-events-none whitespace-nowrap">
                <div className="font-medium text-plm-fg">{bucket.label}</div>
                <div className="flex gap-2 mt-0.5 text-[10px]">
                  {bucket.error > 0 && <span className="text-plm-error">{bucket.error} err</span>}
                  {bucket.warn > 0 && <span className="text-plm-warning">{bucket.warn} warn</span>}
                  {bucket.info > 0 && <span className="text-plm-info">{bucket.info} info</span>}
                  {bucket.debug > 0 && <span className="text-plm-fg-muted">{bucket.debug} dbg</span>}
                </div>
              </div>
              
              {/* Stacked bar segments - positioned at bottom */}
              {totalVisible > 0 && (
                <div 
                  className="absolute bottom-0 left-0 right-0 flex flex-col-reverse gap-[3px] opacity-80 group-hover:opacity-100 transition-opacity"
                >
                  {segments.map((segment) => {
                    // Calculate height based on count
                    const segmentHeight = getSegmentHeight(segment.count)
                    return (
                      <div
                        key={segment.level}
                        className={`${segment.color} w-full flex-shrink-0 transition-all duration-150 rounded-sm`}
                        style={{ 
                          height: `${segmentHeight}px`,
                        }}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      {/* Labels row */}
      <div className="flex gap-[2px] mt-1">
        {buckets.map((bucket, index) => (
          <div key={index} className="flex-1 text-center">
            {(index === 0 || index === buckets.length - 1 || index % Math.ceil(buckets.length / 6) === 0) && (
              <div className="text-[9px] text-plm-fg-muted truncate">
                {bucket.label.split(' ')[0]}
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Resize handle */}
      <div 
        className={`h-2 cursor-ns-resize flex items-center justify-center group mt-1 ${isResizing ? 'bg-plm-accent/20' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className={`w-12 h-1 rounded-full transition-colors ${isResizing ? 'bg-plm-accent' : 'bg-plm-border group-hover:bg-plm-fg-muted'}`} />
      </div>
    </div>
  )
}

interface LogEntryRowProps {
  entry: LogEntry
  isExpanded: boolean
  onToggle: () => void
  searchQuery: string
}

function LogEntryRow({ entry, isExpanded, onToggle, searchQuery }: LogEntryRowProps) {
  const [copied, setCopied] = useState(false)
  
  const highlightText = (text: string) => {
    if (!searchQuery) return text
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === searchQuery.toLowerCase() 
        ? <mark key={i} className="bg-plm-warning/40 text-plm-fg rounded px-0.5">{part}</mark>
        : part
    )
  }
  
  const copyEntry = async () => {
    await navigator.clipboard.writeText(entry.raw)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  
  return (
    <div
      className={`group border-b border-plm-border/50 hover:bg-plm-highlight/30 transition-colors ${
        entry.level === 'error' ? 'bg-plm-error/5' : 
        entry.level === 'warn' ? 'bg-plm-warning/5' : ''
      }`}
    >
      <div
        className="flex items-start gap-3 px-3 py-2 cursor-pointer"
        onClick={onToggle}
      >
        {/* Level icon */}
        <div className="mt-0.5 flex-shrink-0">
          <LevelIcon level={entry.level} />
        </div>
        
        {/* Timestamp */}
        <div className="text-[11px] text-plm-fg-muted font-mono flex-shrink-0 mt-0.5">
          {formatTime(entry.timestamp)}
        </div>
        
        {/* Level badge */}
        <div className="flex-shrink-0">
          <LevelBadge level={entry.level} />
        </div>
        
        {/* Message */}
        <div className="flex-1 min-w-0 text-sm text-plm-fg font-mono">
          <span className={entry.level === 'error' ? 'text-plm-error' : ''}>
            {highlightText(entry.message)}
          </span>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              copyEntry()
            }}
            className="p-1 hover:bg-plm-bg rounded transition-colors"
            title="Copy log entry"
          >
            {copied ? (
              <Check size={12} className="text-plm-success" />
            ) : (
              <Copy size={12} className="text-plm-fg-muted" />
            )}
          </button>
          {entry.data && (
            <ChevronRight
              size={14}
              className={`text-plm-fg-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
        </div>
      </div>
      
      {/* Expanded data */}
      {isExpanded && entry.data && (
        <div className="px-3 pb-3 pl-12">
          <pre className="text-xs text-plm-fg-muted bg-plm-bg rounded-lg p-3 overflow-x-auto border border-plm-border/50">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(entry.data), null, 2)
              } catch {
                return entry.data
              }
            })()}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================
// Main Component (Modal version for backwards compatibility)
// ============================================

export function LogViewer({ onClose }: LogViewerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-plm-bg border border-plm-border rounded-xl shadow-2xl w-[1200px] max-w-[95vw] h-[85vh] flex flex-col overflow-hidden">
        <LogViewerContent onClose={onClose} />
      </div>
    </div>
  )
}

// ============================================
// Inline version (embedded in settings)
// ============================================

export function LogViewerInline() {
  return (
    <div className="h-full w-full flex flex-col bg-plm-bg rounded-lg border border-plm-border overflow-hidden">
      <LogViewerContent />
    </div>
  )
}

// ============================================
// Core Content Component
// ============================================

interface LogViewerContentProps {
  onClose?: () => void
}

function LogViewerContent({ onClose }: LogViewerContentProps) {
  const { addToast } = usePDMStore()
  
  // State
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [crashFiles, setCrashFiles] = useState<CrashFile[]>([])
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>('logs')
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null)
  const [selectedCrash, setSelectedCrash] = useState<CrashFile | null>(null)
  const [crashContent, setCrashContent] = useState<string>('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error', 'debug']))
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('5m')
  const [showFilters] = useState(true)
  const [newestFirst, setNewestFirst] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [histogramHeight, setHistogramHeight] = useState(120) // Default 120px, resizable 60-300px
  
  // UI state
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set())
  const [isLive, setIsLive] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showFileList, setShowFileList] = useState(true)
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false)
  
  // Retention settings state
  const [showRetentionSettings, setShowRetentionSettings] = useState(false)
  const [retentionSettings, setRetentionSettings] = useState<LogRetentionSettings | null>(null)
  const [defaultSettings, setDefaultSettings] = useState<LogRetentionSettings | null>(null)
  const [storageInfo, setStorageInfo] = useState<LogStorageInfo | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [editMaxFiles, setEditMaxFiles] = useState<string>('')
  const [editMaxAgeDays, setEditMaxAgeDays] = useState<string>('')
  const [editMaxTotalSizeMb, setEditMaxTotalSizeMb] = useState<string>('')
  const [unlimitedFiles, setUnlimitedFiles] = useState(false)
  const [unlimitedAge, setUnlimitedAge] = useState(false)
  const [unlimitedTotalSize, setUnlimitedTotalSize] = useState(false)
  
  const contentRef = useRef<HTMLDivElement>(null)
  const refreshIntervalRef = useRef<number | null>(null)
  
  // Load log files
  useEffect(() => {
    loadLogFiles()
  }, [])
  
  // Auto-select current session on load
  useEffect(() => {
    if (logFiles.length > 0 && !selectedFile) {
      const currentSession = logFiles.find(f => f.isCurrentSession) || logFiles[0]
      if (currentSession) {
        loadLogContent(currentSession)
      }
    }
  }, [logFiles])
  
  // Live mode refresh
  useEffect(() => {
    if (isLive && selectedFile?.isCurrentSession) {
      refreshIntervalRef.current = window.setInterval(() => {
        loadLogContent(selectedFile, true)
      }, 2000)
      
      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
        }
      }
    }
  }, [isLive, selectedFile])
  
  // Auto-scroll when entries change (for live mode)
  useEffect(() => {
    if (isLive && autoScroll && contentRef.current) {
      if (newestFirst) {
        contentRef.current.scrollTop = 0
      } else {
        contentRef.current.scrollTop = contentRef.current.scrollHeight
      }
    }
  }, [entries, isLive, autoScroll, newestFirst])
  
  const loadLogFiles = async () => {
    if (!window.electronAPI?.listLogFiles) {
      setIsLoading(false)
      return
    }
    
    setIsLoading(true)
    try {
      // Load both logs and crashes in parallel
      const [logsResult, crashesResult] = await Promise.all([
        window.electronAPI.listLogFiles(),
        window.electronAPI.listCrashFiles?.() || { success: true, files: [] }
      ])
      
      if (logsResult.success && logsResult.files) {
        setLogFiles(logsResult.files)
      }
      if (crashesResult.success && crashesResult.files) {
        setCrashFiles(crashesResult.files)
      }
    } catch (err) {
      console.error('Failed to load log files:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadRetentionSettings = async () => {
    if (!window.electronAPI?.getLogRetentionSettings) return
    
    try {
      const [settingsResult, storageResult] = await Promise.all([
        window.electronAPI.getLogRetentionSettings(),
        window.electronAPI.getLogStorageInfo?.() || { success: false }
      ])
      
      if (settingsResult.success && settingsResult.settings) {
        setRetentionSettings(settingsResult.settings)
        setEditMaxFiles(settingsResult.settings.maxFiles.toString())
        setEditMaxAgeDays(settingsResult.settings.maxAgeDays.toString())
        setEditMaxTotalSizeMb(settingsResult.settings.maxTotalSizeMb.toString())
        setUnlimitedFiles(settingsResult.settings.maxFiles === 0)
        setUnlimitedAge(settingsResult.settings.maxAgeDays === 0)
        setUnlimitedTotalSize(settingsResult.settings.maxTotalSizeMb === 0)
      }
      if (settingsResult.defaults) {
        setDefaultSettings(settingsResult.defaults)
      }
      if (storageResult.success) {
        setStorageInfo({
          totalSize: storageResult.totalSize || 0,
          fileCount: storageResult.fileCount || 0,
          logsDir: storageResult.logsDir
        })
      }
    } catch (err) {
      console.error('Failed to load retention settings:', err)
    }
  }
  
  const saveRetentionSettings = async () => {
    if (!window.electronAPI?.setLogRetentionSettings) return
    
    setSavingSettings(true)
    try {
      const newSettings = {
        maxFiles: unlimitedFiles ? 0 : Math.max(0, parseInt(editMaxFiles) || 0),
        maxAgeDays: unlimitedAge ? 0 : Math.max(0, parseInt(editMaxAgeDays) || 0),
        maxSizeMb: retentionSettings?.maxSizeMb || 10,
        maxTotalSizeMb: unlimitedTotalSize ? 0 : Math.max(0, parseInt(editMaxTotalSizeMb) || 0)
      }
      
      const result = await window.electronAPI.setLogRetentionSettings(newSettings)
      if (result.success && result.settings) {
        setRetentionSettings(result.settings)
        addToast('success', 'Retention settings saved')
        // Refresh file list and storage info after settings change
        loadLogFiles()
        loadRetentionSettings()
      } else {
        addToast('error', result.error || 'Failed to save settings')
      }
    } catch (err) {
      addToast('error', 'Failed to save retention settings')
    } finally {
      setSavingSettings(false)
    }
  }
  
  const resetToDefaults = () => {
    if (defaultSettings) {
      setEditMaxFiles(defaultSettings.maxFiles.toString())
      setEditMaxAgeDays(defaultSettings.maxAgeDays.toString())
      setEditMaxTotalSizeMb(defaultSettings.maxTotalSizeMb.toString())
      setUnlimitedFiles(defaultSettings.maxFiles === 0)
      setUnlimitedAge(defaultSettings.maxAgeDays === 0)
      setUnlimitedTotalSize(defaultSettings.maxTotalSizeMb === 0)
    }
  }
  
  const runManualCleanup = async () => {
    if (!window.electronAPI?.cleanupOldLogs) return
    
    setCleaningUp(true)
    try {
      const result = await window.electronAPI.cleanupOldLogs()
      if (result.success) {
        addToast('success', `Cleaned up ${result.deleted} log file${result.deleted !== 1 ? 's' : ''}`)
        loadLogFiles()
        loadRetentionSettings()
      } else {
        addToast('error', result.error || 'Cleanup failed')
      }
    } catch (err) {
      addToast('error', 'Failed to run cleanup')
    } finally {
      setCleaningUp(false)
    }
  }
  
  // Load retention settings when panel opens
  useEffect(() => {
    if (showRetentionSettings) {
      loadRetentionSettings()
    }
  }, [showRetentionSettings])
  
  const loadCrashContent = async (file: CrashFile) => {
    if (!window.electronAPI?.readCrashFile) return
    
    setIsLoadingContent(true)
    setSelectedCrash(file)
    setSelectedFile(null)
    setEntries([])
    
    try {
      const result = await window.electronAPI.readCrashFile(file.path)
      if (result.success && result.content) {
        setCrashContent(result.content)
      } else {
        addToast('error', result.error || 'Failed to read crash file')
      }
    } catch {
      addToast('error', 'Failed to read crash file')
    } finally {
      setIsLoadingContent(false)
    }
  }
  
  const loadLogContent = async (file: LogFile, silent = false) => {
    if (!window.electronAPI?.readLogFile) return
    
    if (!silent) {
      setIsLoadingContent(true)
      setSelectedFile(file)
    }
    
    try {
      const result = await window.electronAPI.readLogFile(file.path)
      if (result.success && result.content) {
        const parsed = parseLogContent(result.content)
        setEntries(parsed)
        // Auto-scroll is handled by the useEffect that watches entries
      }
    } catch (err) {
      if (!silent) {
        addToast('error', 'Failed to load log content')
      }
    } finally {
      if (!silent) {
        setIsLoadingContent(false)
      }
    }
  }
  
  const toggleLevel = (level: LogLevel) => {
    setLevelFilter(prev => {
      const next = new Set(prev)
      if (next.has(level)) {
        next.delete(level)
      } else {
        next.add(level)
      }
      return next
    })
  }
  
  const toggleEntry = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }
  
  // Filter entries
  const filteredEntries = useMemo(() => {
    const now = new Date()
    const periodMs = getTimePeriodMs(timePeriod)
    const cutoff = timePeriod === 'all' ? 0 : now.getTime() - periodMs
    
    const filtered = entries.filter(entry => {
      // Level filter
      if (!levelFilter.has(entry.level)) return false
      
      // Time filter
      if (entry.timestamp.getTime() < cutoff) return false
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!entry.message.toLowerCase().includes(query) && 
            !entry.data?.toLowerCase().includes(query)) {
          return false
        }
      }
      
      return true
    })
    
    // Sort: newest first or oldest first
    if (newestFirst) {
      return [...filtered].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    }
    return filtered
  }, [entries, levelFilter, timePeriod, searchQuery, newestFirst])
  
  // Create histogram
  const histogram = useMemo(() => {
    return createHistogramBuckets(filteredEntries, timePeriod)
  }, [filteredEntries, timePeriod])
  
  const maxHistogramValue = useMemo(() => {
    return Math.max(...histogram.map(b => {
      let count = 0
      if (levelFilter.has('error')) count += b.error
      if (levelFilter.has('warn')) count += b.warn
      if (levelFilter.has('info')) count += b.info
      if (levelFilter.has('debug')) count += b.debug
      return count
    }), 1)
  }, [histogram, levelFilter])
  
  // Stats
  const stats = useMemo(() => {
    return {
      total: filteredEntries.length,
      error: filteredEntries.filter(e => e.level === 'error').length,
      warn: filteredEntries.filter(e => e.level === 'warn').length,
      info: filteredEntries.filter(e => e.level === 'info').length,
      debug: filteredEntries.filter(e => e.level === 'debug').length
    }
  }, [filteredEntries])
  
  const copyAllFiltered = async () => {
    const content = filteredEntries.map(e => e.raw).join('\n')
    await navigator.clipboard.writeText(content)
    setCopied(true)
    addToast('success', `Copied ${filteredEntries.length} log entries`)
    setTimeout(() => setCopied(false), 2000)
  }
  
  const exportLogs = async () => {
    const result = await window.electronAPI?.exportLogs()
    if (result?.success) {
      addToast('success', 'Logs exported successfully')
    } else if (!result?.canceled) {
      addToast('error', result?.error || 'Failed to export')
    }
  }
  
  const deleteLogFile = async (file: LogFile) => {
    if (file.isCurrentSession) return
    
    const result = await window.electronAPI?.deleteLogFile(file.path)
    if (result?.success) {
      addToast('success', 'Log file deleted')
      loadLogFiles()
      if (selectedFile?.path === file.path) {
        setSelectedFile(null)
        setEntries([])
      }
    } else {
      addToast('error', result?.error || 'Failed to delete')
    }
  }
  
  const timePeriods: { value: TimePeriod; label: string }[] = [
    { value: '30s', label: '30 Seconds' },
    { value: '1m', label: '1 Minute' },
    { value: '2m', label: '2 Minutes' },
    { value: '5m', label: '5 Minutes' },
    { value: '10m', label: '10 Minutes' },
    { value: '30m', label: '30 Minutes' },
    { value: '1h', label: '1 Hour' },
    { value: '6h', label: '6 Hours' },
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: 'all', label: 'All Time' }
  ]

  const handleBucketClick = useCallback((bucket: HistogramBucket) => {
    // Scroll to first entry in that time bucket
    // For now just show a toast with the bucket info
    addToast('info', `${bucket.label}: ${bucket.total} entries`)
  }, [addToast])
  
  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-plm-border bg-gradient-to-r from-plm-sidebar to-plm-bg">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-plm-accent/20 rounded-lg">
            {selectedCrash ? (
              <Skull size={18} className="text-plm-error" />
            ) : (
              <BarChart3 size={18} className="text-plm-accent" />
            )}
          </div>
          <div>
            <h2 className="text-base font-semibold text-plm-fg">
              {selectedCrash ? 'Crash Report' : 'Log Viewer'}
            </h2>
            <p className="text-xs text-plm-fg-muted">
              {selectedCrash?.name || selectedFile?.name || 'Select a file'}
            </p>
          </div>
        </div>
        
        <div className="flex-1" />
        
        {/* Quick stats */}
        <div className="flex items-center gap-3 mr-4">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-plm-error animate-pulse" />
            <span className="text-plm-fg-muted">{stats.error}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-plm-warning" />
            <span className="text-plm-fg-muted">{stats.warn}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-plm-info" />
            <span className="text-plm-fg-muted">{stats.info}</span>
          </div>
          <div className="text-xs text-plm-fg-dim">
            {stats.total} total
          </div>
        </div>
        
        <button
          onClick={() => setShowRetentionSettings(!showRetentionSettings)}
          className={`p-2 rounded-lg transition-colors ${
            showRetentionSettings 
              ? 'bg-plm-accent/20 text-plm-accent' 
              : 'hover:bg-plm-highlight text-plm-fg-muted'
          }`}
          title="Retention settings"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={() => window.electronAPI?.openLogsDir()}
          className="p-2 hover:bg-plm-highlight rounded-lg transition-colors"
          title="Open logs folder"
        >
          <FolderOpen size={16} className="text-plm-fg-muted" />
        </button>
        <button
          onClick={exportLogs}
          className="p-2 hover:bg-plm-highlight rounded-lg transition-colors"
          title="Export logs"
        >
          <Download size={16} className="text-plm-fg-muted" />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={18} className="text-plm-fg-muted" />
          </button>
        )}
      </div>
      
      {/* Retention Settings Panel */}
      {showRetentionSettings && (
        <div className="border-b border-plm-border bg-plm-bg-light px-4 py-3">
          <div className="flex items-start gap-6">
            {/* Storage Info */}
            <div className="flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={14} className="text-plm-fg-muted" />
                <span className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Storage</span>
              </div>
              {storageInfo ? (
                <div className="text-sm">
                  <div className="text-plm-fg font-medium">
                    {formatFileSize(storageInfo.totalSize)}
                  </div>
                  <div className="text-xs text-plm-fg-muted">
                    {storageInfo.fileCount} log file{storageInfo.fileCount !== 1 ? 's' : ''}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-plm-fg-muted">Loading...</div>
              )}
            </div>
            
            {/* Max Files Setting */}
            <div className="flex-shrink-0">
              <label className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Max Files</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={unlimitedFiles ? '' : editMaxFiles}
                  onChange={(e) => {
                    setEditMaxFiles(e.target.value)
                    setUnlimitedFiles(false)
                  }}
                  disabled={unlimitedFiles}
                  placeholder="∞"
                  className={`w-20 px-2 py-1.5 text-sm bg-plm-input border border-plm-border rounded focus:outline-none focus:border-plm-accent ${
                    unlimitedFiles ? 'opacity-50' : ''
                  }`}
                />
                <label className="flex items-center gap-1.5 text-xs text-plm-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={unlimitedFiles}
                    onChange={(e) => {
                      setUnlimitedFiles(e.target.checked)
                      if (e.target.checked) {
                        setEditMaxFiles('0')
                      } else if (defaultSettings) {
                        setEditMaxFiles(defaultSettings.maxFiles.toString())
                      }
                    }}
                    className="w-3.5 h-3.5 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <span>Unlimited</span>
                </label>
              </div>
            </div>
            
            {/* Max Age Setting */}
            <div className="flex-shrink-0">
              <label className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Max Age (Days)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={unlimitedAge ? '' : editMaxAgeDays}
                  onChange={(e) => {
                    setEditMaxAgeDays(e.target.value)
                    setUnlimitedAge(false)
                  }}
                  disabled={unlimitedAge}
                  placeholder="∞"
                  className={`w-20 px-2 py-1.5 text-sm bg-plm-input border border-plm-border rounded focus:outline-none focus:border-plm-accent ${
                    unlimitedAge ? 'opacity-50' : ''
                  }`}
                />
                <label className="flex items-center gap-1.5 text-xs text-plm-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={unlimitedAge}
                    onChange={(e) => {
                      setUnlimitedAge(e.target.checked)
                      if (e.target.checked) {
                        setEditMaxAgeDays('0')
                      } else if (defaultSettings) {
                        setEditMaxAgeDays(defaultSettings.maxAgeDays.toString())
                      }
                    }}
                    className="w-3.5 h-3.5 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <span>Unlimited</span>
                </label>
              </div>
            </div>
            
            {/* Max Total Size Setting */}
            <div className="flex-shrink-0">
              <label className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Max Total Size (MB)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={unlimitedTotalSize ? '' : editMaxTotalSizeMb}
                  onChange={(e) => {
                    setEditMaxTotalSizeMb(e.target.value)
                    setUnlimitedTotalSize(false)
                  }}
                  disabled={unlimitedTotalSize}
                  placeholder="∞"
                  className={`w-20 px-2 py-1.5 text-sm bg-plm-input border border-plm-border rounded focus:outline-none focus:border-plm-accent ${
                    unlimitedTotalSize ? 'opacity-50' : ''
                  }`}
                />
                <label className="flex items-center gap-1.5 text-xs text-plm-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={unlimitedTotalSize}
                    onChange={(e) => {
                      setUnlimitedTotalSize(e.target.checked)
                      if (e.target.checked) {
                        setEditMaxTotalSizeMb('0')
                      } else if (defaultSettings) {
                        setEditMaxTotalSizeMb(defaultSettings.maxTotalSizeMb.toString())
                      }
                    }}
                    className="w-3.5 h-3.5 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <span>Unlimited</span>
                </label>
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex-1 flex items-end justify-end gap-2">
              <button
                onClick={resetToDefaults}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-fg-muted hover:text-plm-fg border border-plm-border rounded hover:bg-plm-highlight transition-colors"
                title="Reset to defaults"
              >
                <RotateCcw size={12} />
                <span>Defaults</span>
              </button>
              <button
                onClick={runManualCleanup}
                disabled={cleaningUp}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-fg-muted hover:text-plm-fg border border-plm-border rounded hover:bg-plm-highlight transition-colors disabled:opacity-50"
                title="Run cleanup now based on current settings"
              >
                {cleaningUp ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                <span>Cleanup Now</span>
              </button>
              <button
                onClick={saveRetentionSettings}
                disabled={savingSettings}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-bg bg-plm-accent rounded hover:bg-plm-accent/90 transition-colors disabled:opacity-50"
              >
                {savingSettings ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
                <span>Save</span>
              </button>
            </div>
          </div>
          
          {/* Info text */}
          <div className="mt-2 text-[10px] text-plm-fg-dim">
            Set to 0 or check &quot;Unlimited&quot; to disable that limit. Changes apply immediately on save.
          </div>
        </div>
      )}
        
        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* File list sidebar */}
          {showFileList && (
            <div className="w-72 border-r border-plm-border bg-plm-sidebar flex flex-col">
              {/* View mode tabs */}
              <div className="flex border-b border-plm-border">
                <button
                  onClick={() => setFileViewMode('logs')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                    fileViewMode === 'logs'
                      ? 'text-plm-accent border-b-2 border-plm-accent bg-plm-accent/10'
                      : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
                  }`}
                >
                  <FileText size={14} />
                  <span>Logs</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-bg">{logFiles.length}</span>
                </button>
                <button
                  onClick={() => setFileViewMode('crashes')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                    fileViewMode === 'crashes'
                      ? 'text-plm-error border-b-2 border-plm-error bg-plm-error/10'
                      : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
                  }`}
                >
                  <Skull size={14} />
                  <span>Crashes</span>
                  {crashFiles.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-error/20 text-plm-error">{crashFiles.length}</span>
                  )}
                </button>
              </div>
              
              <div className="p-2 border-b border-plm-border flex items-center justify-between">
                <span className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">
                  {fileViewMode === 'logs' ? 'Log Files' : 'Crash Reports'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => fileViewMode === 'logs' 
                      ? window.electronAPI?.openLogsDir() 
                      : window.electronAPI?.openCrashesDir()
                    }
                    className="p-1 hover:bg-plm-highlight rounded transition-colors"
                    title={`Open ${fileViewMode} folder`}
                  >
                    <FolderOpen size={12} className="text-plm-fg-muted" />
                  </button>
                  <button
                    onClick={loadLogFiles}
                    className="p-1 hover:bg-plm-highlight rounded transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw size={12} className="text-plm-fg-muted" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-plm-fg-muted" />
                  </div>
                ) : fileViewMode === 'logs' ? (
                  // Log files view
                  logFiles.length === 0 ? (
                    <div className="text-center py-8 text-xs text-plm-fg-muted">
                      No log files found
                    </div>
                  ) : (
                    logFiles.map(file => (
                      <div
                        key={file.path}
                        className={`group relative rounded-lg transition-colors cursor-pointer ${
                          selectedFile?.path === file.path
                            ? 'bg-plm-accent/20 border border-plm-accent/40'
                            : 'hover:bg-plm-highlight border border-transparent'
                        }`}
                        onClick={() => {
                          setSelectedCrash(null)
                          setCrashContent('')
                          loadLogContent(file)
                        }}
                      >
                        <div className="p-2">
                          <div className="flex items-center gap-2">
                            <FileText 
                              size={14} 
                              className={file.isCurrentSession ? 'text-plm-accent' : 'text-plm-fg-muted'} 
                            />
                            <span className="text-xs text-plm-fg truncate flex-1">
                              {file.name.replace('blueplm-', '').replace('.log', '')}
                            </span>
                            {file.isCurrentSession && (
                              <Zap size={10} className="text-plm-accent" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-plm-fg-muted">
                            <span>{formatFileSize(file.size)}</span>
                        </div>
                      </div>
                      
                      {/* Delete button */}
                      {!file.isCurrentSession && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteLogFile(file)
                          }}
                          className="absolute right-1 top-1 p-1 opacity-0 group-hover:opacity-100 hover:bg-plm-error/20 rounded transition-all"
                          title="Delete log file"
                        >
                          <Trash2 size={12} className="text-plm-fg-muted hover:text-plm-error" />
                        </button>
                      )}
                    </div>
                  ))
                  )
                ) : (
                  // Crash files view
                  crashFiles.length === 0 ? (
                    <div className="text-center py-8 text-xs text-plm-fg-muted">
                      <Skull size={24} className="mx-auto mb-2 opacity-30" />
                      <p>No crash reports found</p>
                      <p className="mt-1 text-[10px]">That&apos;s a good thing!</p>
                    </div>
                  ) : (
                    crashFiles.map(file => (
                      <div
                        key={file.path}
                        className={`group relative rounded-lg transition-colors cursor-pointer ${
                          selectedCrash?.path === file.path
                            ? 'bg-plm-error/20 border border-plm-error/40'
                            : 'hover:bg-plm-highlight border border-transparent'
                        }`}
                        onClick={() => loadCrashContent(file)}
                      >
                        <div className="p-2">
                          <div className="flex items-center gap-2">
                            <Skull size={14} className="text-plm-error" />
                            <span className="text-xs text-plm-fg truncate flex-1">
                              {file.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-plm-fg-muted">
                            <span>{formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>
          )}
          
          {/* Toggle sidebar button */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowFileList(!showFileList)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-plm-bg border border-plm-border rounded-r-lg hover:bg-plm-highlight transition-colors"
            >
              {showFileList ? (
                <ChevronLeft size={14} className="text-plm-fg-muted" />
              ) : (
                <ChevronRight size={14} className="text-plm-fg-muted" />
              )}
            </button>
          </div>
          
          {/* Log content area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="p-3 border-b border-plm-border bg-plm-bg-light space-y-3">
              {/* Search and filters row */}
              <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 max-w-md">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search logs..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-plm-input border border-plm-border rounded-lg focus:outline-none focus:border-plm-accent text-plm-fg placeholder:text-plm-fg-muted"
                  />
                </div>
                
                {/* Time period dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setPeriodDropdownOpen(!periodDropdownOpen)}
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-plm-input border border-plm-border rounded-lg hover:border-plm-fg-muted transition-colors"
                  >
                    <Clock size={14} className="text-plm-fg-muted" />
                    <span className="text-plm-fg">{timePeriods.find(p => p.value === timePeriod)?.label}</span>
                    <ChevronDown size={14} className="text-plm-fg-muted" />
                  </button>
                  
                  {periodDropdownOpen && (
                    <>
                      <div className="fixed inset-0" onClick={() => setPeriodDropdownOpen(false)} />
                      <div className="absolute right-0 mt-1 w-40 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl z-20 overflow-hidden">
                        {timePeriods.map(period => (
                          <button
                            key={period.value}
                            onClick={() => {
                              setTimePeriod(period.value)
                              setPeriodDropdownOpen(false)
                            }}
                            className={`w-full px-3 py-2 text-sm text-left hover:bg-plm-highlight transition-colors ${
                              timePeriod === period.value ? 'text-plm-accent bg-plm-highlight' : 'text-plm-fg'
                            }`}
                          >
                            {period.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                
                {/* Level filters */}
                <div className="flex items-center gap-1 px-1 py-1 bg-plm-input border border-plm-border rounded-lg">
                  {(['error', 'warn', 'info', 'debug'] as LogLevel[]).map(level => (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        levelFilter.has(level)
                          ? level === 'error' ? 'bg-plm-error/20 text-plm-error' :
                            level === 'warn' ? 'bg-plm-warning/20 text-plm-warning' :
                            level === 'info' ? 'bg-plm-info/20 text-plm-info' :
                            'bg-plm-fg-muted/20 text-plm-fg-muted'
                          : 'text-plm-fg-dim opacity-50'
                      }`}
                    >
                      <LevelIcon level={level} size={12} />
                      <span className="uppercase">{level}</span>
                    </button>
                  ))}
                </div>
                
                {/* Newest first toggle */}
                <button
                  onClick={() => setNewestFirst(!newestFirst)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    newestFirst
                      ? 'bg-plm-accent/20 text-plm-accent border border-plm-accent/40'
                      : 'bg-plm-input border border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
                  }`}
                  title={newestFirst ? 'Newest first' : 'Oldest first'}
                >
                  {newestFirst ? (
                    <ArrowUpToLine size={14} />
                  ) : (
                    <ArrowDownToLine size={14} />
                  )}
                  <span className="hidden sm:inline">{newestFirst ? 'Newest' : 'Oldest'}</span>
                </button>
                
                {/* Auto-scroll toggle */}
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    autoScroll
                      ? 'bg-plm-accent/20 text-plm-accent border border-plm-accent/40'
                      : 'bg-plm-input border border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
                  }`}
                  title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
                >
                  {autoScroll ? (
                    <Pin size={14} />
                  ) : (
                    <PinOff size={14} />
                  )}
                  <span className="hidden sm:inline">Pin</span>
                </button>
                
                {/* Live mode toggle */}
                {selectedFile?.isCurrentSession && (
                  <button
                    onClick={() => setIsLive(!isLive)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isLive
                        ? 'bg-plm-success/20 text-plm-success border border-plm-success/40'
                        : 'bg-plm-input border border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
                    }`}
                  >
                    {isLive ? (
                      <>
                        <Pause size={14} />
                        <span>Live</span>
                        <div className="w-2 h-2 rounded-full bg-plm-success animate-pulse" />
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        <span>Live</span>
                      </>
                    )}
                  </button>
                )}
                
                {/* Copy filtered */}
                <button
                  onClick={copyAllFiltered}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-plm-input border border-plm-border rounded-lg hover:border-plm-fg-muted transition-colors"
                  title="Copy filtered logs"
                >
                  {copied ? (
                    <Check size={14} className="text-plm-success" />
                  ) : (
                    <Copy size={14} className="text-plm-fg-muted" />
                  )}
                </button>
              </div>
              
              {/* Histogram */}
              {showFilters && histogram.length > 0 && (
                <div className="relative bg-plm-bg rounded-lg border border-plm-border p-2">
                  <Histogram
                    buckets={histogram}
                    maxValue={maxHistogramValue}
                    onBucketClick={handleBucketClick}
                    levelFilter={levelFilter}
                    height={histogramHeight}
                    onHeightChange={setHistogramHeight}
                  />
                </div>
              )}
            </div>
            
            {/* Log entries / Crash content */}
            <div 
              ref={contentRef}
              className="flex-1 overflow-y-auto bg-plm-bg"
            >
              {isLoadingContent ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
                </div>
              ) : selectedCrash ? (
                // Crash report view
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-plm-border">
                    <Skull size={24} className="text-plm-error" />
                    <div>
                      <h3 className="text-sm font-medium text-plm-fg">{selectedCrash.name}</h3>
                      <p className="text-xs text-plm-fg-muted">
                        {new Date(selectedCrash.modifiedTime).toLocaleString()} • {formatFileSize(selectedCrash.size)}
                      </p>
                    </div>
                  </div>
                  <pre className="text-xs text-plm-fg font-mono whitespace-pre-wrap break-all bg-plm-bg-light p-4 rounded-lg border border-plm-border">
                    {crashContent}
                  </pre>
                </div>
              ) : !selectedFile ? (
                <div className="flex flex-col items-center justify-center py-16 text-plm-fg-muted">
                  <FileText size={48} className="mb-4 opacity-30" />
                  <p className="text-sm">Select a log file to view</p>
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-plm-fg-muted">
                  <Filter size={48} className="mb-4 opacity-30" />
                  <p className="text-sm">No entries match your filters</p>
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setLevelFilter(new Set(['info', 'warn', 'error', 'debug']))
                      setTimePeriod('all')
                    }}
                    className="mt-3 text-xs text-plm-accent hover:underline"
                  >
                    Clear all filters
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-plm-border/30">
                  {filteredEntries.map(entry => (
                    <LogEntryRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedEntries.has(entry.id)}
                      onToggle={() => toggleEntry(entry.id)}
                      searchQuery={searchQuery}
                    />
                  ))}
                </div>
              )}
            </div>
            
            {/* Status bar */}
            <div className="px-3 py-1.5 border-t border-plm-border bg-plm-sidebar flex items-center gap-4 text-[11px] text-plm-fg-muted">
              <span>{filteredEntries.length} entries</span>
              {searchQuery && <span>Filtered: &quot;{searchQuery}&quot;</span>}
              {selectedFile && (
                <span className="ml-auto flex items-center gap-1">
                  <Calendar size={10} />
                  {formatDateTime(new Date(selectedFile.modifiedTime))}
                </span>
              )}
            </div>
          </div>
        </div>
    </>
  )
}

