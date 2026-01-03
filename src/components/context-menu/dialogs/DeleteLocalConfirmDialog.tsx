// src/components/context-menu/dialogs/DeleteLocalConfirmDialog.tsx
import { AlertTriangle, File, ArrowUp, Trash2 } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { MAX_VISIBLE_FILES } from '../constants'

interface DeleteLocalConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  checkedOutFiles: LocalFile[]
  onCheckinThenDelete: () => void
  onDiscardAndDelete: () => void
}

export function DeleteLocalConfirmDialog({
  isOpen,
  onClose,
  checkedOutFiles,
  onCheckinThenDelete,
  onDiscardAndDelete
}: DeleteLocalConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div 
        className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-plm-warning/20 flex items-center justify-center">
            <AlertTriangle size={20} className="text-plm-warning" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">
              Files Are Checked Out
            </h3>
            <p className="text-sm text-plm-fg-muted">
              {checkedOutFiles.length} file{checkedOutFiles.length > 1 ? 's are' : ' is'} currently checked out by you.
            </p>
          </div>
        </div>
        
        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4 max-h-40 overflow-y-auto">
          <div className="space-y-1">
            {checkedOutFiles.slice(0, MAX_VISIBLE_FILES).map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <File size={14} className="text-plm-warning" />
                <span className="text-plm-fg truncate">{f.name}</span>
              </div>
            ))}
            {checkedOutFiles.length > MAX_VISIBLE_FILES && (
              <div className="text-xs text-plm-fg-muted">
                ...and {checkedOutFiles.length - MAX_VISIBLE_FILES} more
              </div>
            )}
          </div>
        </div>
        
        {/* Info */}
        <div className="bg-plm-accent/10 border border-plm-accent/30 rounded p-3 mb-4">
          <p className="text-sm text-plm-fg">
            What would you like to do with your changes?
          </p>
        </div>
        
        <div className="flex flex-col gap-2">
          <button
            onClick={onCheckinThenDelete}
            className="btn bg-plm-success hover:bg-plm-success/80 text-white w-full justify-center"
          >
            <ArrowUp size={14} />
            Check In First, Then Remove Local
          </button>
          <button
            onClick={onDiscardAndDelete}
            className="btn bg-plm-warning hover:bg-plm-warning/80 text-white w-full justify-center"
          >
            <Trash2 size={14} />
            Discard Changes & Remove Local
          </button>
          <button
            onClick={onClose}
            className="btn btn-ghost w-full justify-center"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
