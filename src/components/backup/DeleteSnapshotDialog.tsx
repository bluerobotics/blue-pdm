import { Trash2 } from 'lucide-react'
import type { DeleteConfirmTarget } from './types'

interface DeleteSnapshotDialogProps {
  target: DeleteConfirmTarget
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal dialog to confirm snapshot deletion.
 */
export function DeleteSnapshotDialog({
  target,
  onConfirm,
  onCancel
}: DeleteSnapshotDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-red-500/10">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Delete Snapshot?</h3>
            <p className="text-sm text-plm-fg-muted mt-1">
              {target.time}
            </p>
          </div>
        </div>
        
        <div className="space-y-2 text-sm text-plm-fg-muted">
          <p>This will permanently delete the snapshot from the backup server.</p>
          <p className="text-red-400 font-medium">This action cannot be undone.</p>
        </div>
        
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-secondary border border-plm-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 px-4 bg-red-600 text-white rounded font-medium hover:bg-red-500 transition-colors flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
