import { AlertTriangle, XCircle, RotateCcw, Loader2 } from 'lucide-react'

interface RestoreActionBarProps {
  selectedSnapshot: string
  isRestoring: boolean
  onRestore: () => void
  onCancel: () => void
}

/**
 * Confirmation bar shown when a snapshot is selected for restoration.
 */
export function RestoreActionBar({
  selectedSnapshot,
  isRestoring,
  onRestore,
  onCancel
}: RestoreActionBarProps) {
  return (
    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs text-amber-300">
            <strong>Ready to restore snapshot {selectedSnapshot.substring(0, 8)}</strong>
            <br />
            This will overwrite current files with the backed-up versions.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-amber-400 hover:text-amber-300"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRestore}
          disabled={isRestoring}
          className="flex-1 py-2 px-4 bg-amber-600 text-white rounded font-medium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isRestoring ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Restoring...
            </>
          ) : (
            <>
              <RotateCcw className="w-4 h-4" />
              Restore Now
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={isRestoring}
          className="py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-secondary disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
