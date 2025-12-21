import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronUp, Home, ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  if (!relativePath) return vaultPath
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

// Parse a full path back to relative path
function parsePathToRelative(fullPath: string, vaultPath: string): string {
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedVault = vaultPath.replace(/[/\\]/g, sep)
  const normalizedFull = fullPath.replace(/[/\\]/g, sep)
  
  if (normalizedFull.toLowerCase().startsWith(normalizedVault.toLowerCase())) {
    let relative = normalizedFull.slice(normalizedVault.length)
    // Remove leading separator
    if (relative.startsWith(sep)) {
      relative = relative.slice(1)
    }
    // Convert to forward slashes for internal use
    return relative.replace(/\\/g, '/')
  }
  return ''
}

interface CrumbBarProps {
  /** Current relative path (using forward slashes internally) */
  currentPath: string
  /** Full vault path */
  vaultPath: string
  /** Display name for the vault root */
  vaultName: string
  /** Called when navigating to a folder path (relative path with forward slashes) */
  onNavigate: (relativePath: string) => void
  /** Called when navigating to root */
  onNavigateRoot: () => void
  /** Called when navigating up one level */
  onNavigateUp: () => void
  /** Called when going back in history */
  onBack?: () => void
  /** Called when going forward in history */
  onForward?: () => void
  /** Called when refreshing */
  onRefresh?: () => void
  /** Whether back navigation is available */
  canGoBack?: boolean
  /** Whether forward navigation is available */
  canGoForward?: boolean
  /** Optional class name */
  className?: string
}

export function CrumbBar({
  currentPath,
  vaultPath,
  vaultName,
  onNavigate,
  onNavigateRoot,
  onNavigateUp,
  onBack,
  onForward,
  onRefresh,
  canGoBack = false,
  canGoForward = false,
  className = ''
}: CrumbBarProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Get the full path for display in edit mode
  const fullPath = currentPath ? buildFullPath(vaultPath, currentPath) : vaultPath

  // Enter edit mode
  const startEditing = useCallback(() => {
    setEditValue(fullPath)
    setIsEditing(true)
  }, [fullPath])

  // Exit edit mode
  const stopEditing = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  // Handle path submission
  const handleSubmit = useCallback(() => {
    const trimmedPath = editValue.trim()
    if (!trimmedPath) {
      stopEditing()
      return
    }

    // Parse the path back to relative
    const relativePath = parsePathToRelative(trimmedPath, vaultPath)
    
    if (relativePath === '') {
      // Navigating to root or path equals vault path
      onNavigateRoot()
    } else {
      onNavigate(relativePath)
    }
    
    stopEditing()
  }, [editValue, vaultPath, onNavigate, onNavigateRoot, stopEditing])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Handle click outside to close edit mode
  useEffect(() => {
    if (!isEditing) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        stopEditing()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isEditing, stopEditing])

  // Handle keyboard events in edit mode
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      stopEditing()
    }
  }

  // Split path into segments
  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : []

  return (
    <div
      ref={containerRef}
      className={`flex items-center flex-1 min-w-0 gap-1 ${className}`}
    >
      {/* Navigation buttons - OUTSIDE the crumb field (Chrome-style) */}
      <div className="flex items-center gap-1 flex-shrink-0 mr-1">
        {/* Back */}
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className="p-1.5 rounded-md text-plm-fg-dim hover:text-plm-fg hover:bg-black/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Back"
        >
          <ArrowLeft size={20} />
        </button>
        
        {/* Forward */}
        <button
          onClick={onForward}
          disabled={!canGoForward}
          className="p-1.5 rounded-md text-plm-fg-dim hover:text-plm-fg hover:bg-black/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Forward"
        >
          <ArrowRight size={20} />
        </button>
        
        {/* Up */}
        <button
          onClick={onNavigateUp}
          disabled={!currentPath}
          className="p-1.5 rounded-md text-plm-fg-dim hover:text-plm-fg hover:bg-black/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Up one level"
        >
          <ChevronUp size={20} />
        </button>
        
        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-md text-plm-fg-dim hover:text-plm-fg hover:bg-black/20 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Crumb field - dark rounded area (Chrome omnibox style) */}
      <div
        className={`flex items-center flex-1 min-w-0 h-9 bg-plm-bg rounded-full px-3 transition-colors ${
          isEditing 
            ? 'ring-2 ring-plm-accent' 
            : 'hover:bg-plm-bg-light'
        }`}
      >
        {isEditing ? (
          // Edit mode - text input with full path
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={stopEditing}
            className="w-full h-full bg-transparent text-sm text-plm-fg focus:outline-none"
            placeholder="Enter path..."
          />
        ) : (
          // Breadcrumb mode - clickable path segments
          <div
            className="flex items-center gap-0.5 flex-1 min-w-0 h-full cursor-text"
            onClick={(e) => {
              // Only enter edit mode if clicking on the background, not on a button
              if ((e.target as HTMLElement).closest('button') === null) {
                startEditing()
              }
            }}
            title="Click to edit path"
          >
            {/* Root/Home button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigateRoot()
              }}
              className="flex items-center gap-2 text-plm-fg-dim hover:text-plm-fg hover:bg-white/10 transition-colors px-2 py-1 rounded-md flex-shrink-0"
              title="Go to vault root"
            >
              <Home size={18} />
              <span className="truncate max-w-[150px] text-sm">{vaultName}</span>
            </button>

            {/* Path segments */}
            {pathParts.map((part, i) => {
              const pathUpToHere = pathParts.slice(0, i + 1).join('/')
              const isLast = i === pathParts.length - 1
              
              return (
                <div key={pathUpToHere} className="flex items-center gap-0.5 min-w-0">
                  <ChevronRight size={18} className="text-plm-fg-muted flex-shrink-0" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onNavigate(pathUpToHere)
                    }}
                    className={`px-2 py-1 rounded-md truncate max-w-[150px] hover:bg-white/10 transition-colors text-sm ${
                      isLast
                        ? 'text-plm-fg font-medium'
                        : 'text-plm-fg-dim hover:text-plm-fg'
                    }`}
                    title={part}
                  >
                    {part}
                  </button>
                </div>
              )
            })}

            {/* Empty spacer to make the clickable area extend to the right */}
            <div className="flex-1 min-w-[20px] h-full" />
          </div>
        )}
      </div>
    </div>
  )
}

