import { ExternalLink } from 'lucide-react'
import type { DriveFileResultProps } from './types'
import { getDriveFileIcon } from './utils'

/**
 * Single Google Drive search result item
 */
export function DriveFileResult({ file, isHighlighted, onSelect, onMouseEnter }: DriveFileResultProps) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
        isHighlighted
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
}
