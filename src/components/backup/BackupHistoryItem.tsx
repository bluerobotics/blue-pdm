import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Loader2
} from 'lucide-react'
import type { BackupSnapshot } from './types'
import { formatDate, snapshotHasFiles, snapshotHasMetadata, getVaultNameFromTags } from './utils'

interface BackupHistoryItemProps {
  snapshot: BackupSnapshot
  isSelected: boolean
  isAdmin: boolean
  isDeleting: boolean
  isRestoring: boolean
  onSelect: () => void
  onRequestDelete: () => void
}

/**
 * Single backup history item showing snapshot details and actions.
 */
export function BackupHistoryItem({
  snapshot,
  isSelected,
  isAdmin,
  isDeleting,
  isRestoring,
  onSelect,
  onRequestDelete
}: BackupHistoryItemProps) {
  const hasFiles = snapshotHasFiles(snapshot.tags)
  const hasMetadata = snapshotHasMetadata(snapshot.tags)
  const vaultName = getVaultNameFromTags(snapshot.tags)
  
  // Status: success only if both files AND metadata
  const isComplete = hasFiles && hasMetadata
  const isIncomplete = hasFiles && !hasMetadata
  
  return (
    <div
      className={`p-3 rounded border ${
        isSelected
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-plm-bg-secondary border-plm-border'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status badge */}
          {isComplete ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              <CheckCircle2 className="w-3 h-3" />
              Complete
            </span>
          ) : isIncomplete ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-amber-500/20 text-amber-400 border-amber-500/30" title="Files backed up but database metadata missing">
              <AlertTriangle className="w-3 h-3" />
              Partial
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-red-500/20 text-red-400 border-red-500/30">
              <XCircle className="w-3 h-3" />
              Error
            </span>
          )}
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              {formatDate(snapshot.time)}
              {vaultName && (
                <span className="text-xs px-1.5 py-0.5 bg-plm-bg-tertiary rounded text-plm-fg-muted">
                  {vaultName}
                </span>
              )}
            </div>
            <div className="text-xs text-plm-fg-muted">
              from {snapshot.hostname} • {snapshot.id}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Restore button */}
          {isAdmin && (
            <button
              onClick={onSelect}
              disabled={isRestoring}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-amber-600 text-white'
                  : 'bg-plm-bg-tertiary hover:bg-amber-600/20 text-plm-fg-muted hover:text-amber-500'
              }`}
              title="Restore vault to this backup"
            >
              <RotateCcw className="w-3 h-3" />
              Restore
            </button>
          )}
          {/* Delete button */}
          {isAdmin && (
            <button
              onClick={onRequestDelete}
              disabled={isDeleting}
              className="p-1 rounded text-plm-fg-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete this snapshot"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* Files/Database check indicators */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-plm-border">
        <div className="flex items-center gap-1.5">
          {hasFiles ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400">Files</span>
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5 text-plm-fg-muted" />
              <span className="text-xs text-plm-fg-muted">Files</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasMetadata ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400">Database</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs text-amber-400">No Database</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
