import { useState, useRef, useEffect } from 'react'
import { File, Folder, ArrowRight, FolderOpen } from 'lucide-react'
import { resolvePartNumber, resolvedText } from '@/lib/metadata/overlay'
import type { LocalFileResultProps } from './types'
import { getStateIndicator } from './utils'

/**
 * Single local file search result item
 */
export function LocalFileResult({
  file,
  isHighlighted,
  onSelect,
  onMouseEnter,
  onOpenFileLocation,
}: LocalFileResultProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleOpenFileLocation = () => {
    setContextMenu(null)
    onOpenFileLocation()
  }

  // The search behind this result already matches on the pending edit, so the badge has to show
  // the same number - otherwise typing the new number returns a row labelled with the old one.
  const partNumber = resolvedText(resolvePartNumber(file))

  return (
    <>
      <button
        onClick={onSelect}
        onMouseEnter={onMouseEnter}
        onContextMenu={handleContextMenu}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
          isHighlighted ? 'bg-plm-accent/20' : 'hover:bg-plm-bg-lighter'
        }`}
      >
        <span className="text-plm-fg-muted">
          {file.isDirectory ? (
            <Folder size={16} className="text-plm-warning" />
          ) : (
            <File size={16} />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-plm-fg truncate">{file.name}</span>
            {partNumber && (
              <span className="text-xs text-plm-accent font-mono">{partNumber}</span>
            )}
            {getStateIndicator(file.pdmData?.workflow_state)}
          </div>
          <div className="text-xs text-plm-fg-muted truncate">{file.relativePath}</div>
        </div>
        <ArrowRight size={12} className="text-plm-fg-muted opacity-0 group-hover:opacity-100" />
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setContextMenu(null)} />
          <div
            ref={menuRef}
            className="fixed z-[101] bg-plm-bg border border-plm-border rounded-lg shadow-xl py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={handleOpenFileLocation}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-plm-fg hover:bg-plm-bg-lighter transition-colors"
            >
              <FolderOpen size={14} className="text-plm-fg-muted" />
              Open file location
            </button>
          </div>
        </>
      )}
    </>
  )
}
