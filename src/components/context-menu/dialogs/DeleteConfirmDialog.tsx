// src/components/context-menu/dialogs/DeleteConfirmDialog.tsx
import { AlertTriangle, File, Trash2, CloudOff } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { MAX_VISIBLE_FILES } from '../constants'

interface DeleteConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  files: LocalFile[]
  keepLocal: boolean
  onConfirm: () => void
}

export function DeleteConfirmDialog({
  isOpen,
  onClose,
  files,
  keepLocal,
  onConfirm
}: DeleteConfirmDialogProps) {
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
          <div className={`w-10 h-10 rounded-full ${keepLocal ? 'bg-plm-warning/20' : 'bg-plm-error/20'} flex items-center justify-center`}>
            <AlertTriangle size={20} className={keepLocal ? 'text-plm-warning' : 'text-plm-error'} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">
              {keepLocal 
                ? `Delete from Server ${files.length > 1 ? `${files.length} Items` : 'Item'}?`
                : `Delete Local & Server ${files.length > 1 ? `${files.length} Items` : 'Item'}?`
              }
            </h3>
            <p className="text-sm text-plm-fg-muted">
              {keepLocal 
                ? 'Items will be deleted from the server. Local copies will be kept.'
                : 'Items will be deleted locally AND from the server.'
              }
            </p>
          </div>
        </div>
        
        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4 max-h-40 overflow-y-auto">
          {files.length === 1 ? (
            <div className="flex items-center gap-2">
              <File size={16} className="text-plm-fg-muted" />
              <span className="text-plm-fg font-medium truncate">{files[0]?.name}</span>
            </div>
          ) : (
            <>
              <div className="text-sm text-plm-fg mb-2">
                {files.length} file{files.length > 1 ? 's' : ''}
              </div>
              <div className="space-y-1">
                {files.slice(0, MAX_VISIBLE_FILES).map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <File size={14} className="text-plm-fg-muted" />
                    <span className="text-plm-fg-dim truncate">{f.name}</span>
                  </div>
                ))}
                {files.length > MAX_VISIBLE_FILES && (
                  <div className="text-xs text-plm-fg-muted">
                    ...and {files.length - MAX_VISIBLE_FILES} more
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        
        {/* Warning */}
        <div className={`${keepLocal ? 'bg-plm-info/10 border-plm-info/30' : 'bg-plm-warning/10 border-plm-warning/30'} border rounded p-3 mb-4`}>
          <p className={`text-sm ${keepLocal ? 'text-plm-info' : 'text-plm-warning'} font-medium`}>
            {keepLocal 
              ? `ℹ️ ${files.length} file${files.length > 1 ? 's' : ''} will be removed from the server. Local copies will become unsynced.`
              : `⚠️ ${files.length} synced file${files.length > 1 ? 's' : ''} will be deleted from the server.`
            }
          </p>
          <p className="text-xs text-plm-fg-muted mt-1">Files can be recovered from trash within 30 days.</p>
        </div>
        
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`btn ${keepLocal ? 'bg-plm-warning hover:bg-plm-warning/80' : 'bg-plm-error hover:bg-plm-error/80'} text-white`}
          >
            {keepLocal ? <CloudOff size={14} /> : <Trash2 size={14} />}
            {keepLocal 
              ? `Delete from Server ${files.length > 1 ? `(${files.length})` : ''}`
              : `Delete Local & Server ${files.length > 1 ? `(${files.length})` : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  )
}
