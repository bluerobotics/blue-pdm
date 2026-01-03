import { File, Folder, ArrowRight } from 'lucide-react'
import type { LocalFileResultProps } from './types'
import { getStateIndicator } from './utils'

/**
 * Single local file search result item
 */
export function LocalFileResult({ file, isHighlighted, onSelect, onMouseEnter }: LocalFileResultProps) {
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
        {file.isDirectory ? <Folder size={16} className="text-plm-warning" /> : <File size={16} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-plm-fg truncate">{file.name}</span>
          {file.pdmData?.part_number && (
            <span className="text-xs text-plm-accent font-mono">{file.pdmData.part_number}</span>
          )}
          {getStateIndicator(file.pdmData?.workflow_state)}
        </div>
        <div className="text-xs text-plm-fg-muted truncate">{file.relativePath}</div>
      </div>
      <ArrowRight size={12} className="text-plm-fg-muted opacity-0 group-hover:opacity-100" />
    </button>
  )
}
