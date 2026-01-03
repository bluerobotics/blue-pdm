// src/components/context-menu/dialogs/PropertiesDialog.tsx
import { Info } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { formatSize } from '../utils'

interface PropertiesDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  isFolder: boolean
  multiSelect: boolean
  contextFiles: LocalFile[]
  userId?: string
  folderSize: { size: number; fileCount: number; folderCount: number } | null
  isCalculatingSize: boolean
}

export function PropertiesDialog({
  isOpen,
  onClose,
  file,
  isFolder,
  multiSelect,
  contextFiles,
  userId,
  folderSize,
  isCalculatingSize
}: PropertiesDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl w-[400px] max-h-[80vh] overflow-auto">
        <div className="p-4 border-b border-plm-border flex items-center gap-3">
          <Info size={20} className="text-plm-accent" />
          <h3 className="font-semibold">Properties</h3>
        </div>
        <div className="p-4 space-y-3">
          {/* Name */}
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Name</div>
            <div className="text-sm">{file.name}</div>
          </div>
          
          {/* Type */}
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Type</div>
            <div className="text-sm">
              {isFolder ? 'Folder' : (file.extension ? file.extension.toUpperCase() + ' File' : 'File')}
            </div>
          </div>
          
          {/* Location */}
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Location</div>
            <div className="text-sm break-all text-plm-fg-dim">
              {file.relativePath.includes('/') 
                ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
                : '/'}
            </div>
          </div>
          
          {/* Size */}
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Size</div>
            <div className="text-sm">
              {isFolder && !multiSelect ? (
                isCalculatingSize ? (
                  <span className="text-plm-fg-muted">Calculating...</span>
                ) : folderSize ? (
                  <span>
                    {formatSize(folderSize.size)}
                    <span className="text-plm-fg-muted ml-2">
                      ({folderSize.fileCount} file{folderSize.fileCount !== 1 ? 's' : ''}, {folderSize.folderCount} folder{folderSize.folderCount !== 1 ? 's' : ''})
                    </span>
                  </span>
                ) : '—'
              ) : multiSelect ? (
                formatSize(contextFiles.reduce((sum, f) => sum + (f.size || 0), 0))
              ) : (
                formatSize(file.size || 0)
              )}
            </div>
          </div>
          
          {/* Status */}
          {file.pdmData && (
            <div>
              <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Status</div>
              <div className="text-sm">
                {file.pdmData.checked_out_by 
                  ? file.pdmData.checked_out_by === userId 
                    ? 'Checked out by you'
                    : 'Checked out'
                  : 'Available'}
              </div>
            </div>
          )}
          
          {/* Sync Status */}
          <div>
            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Sync Status</div>
            <div className={`text-sm ${file.diffStatus === 'deleted_remote' ? 'text-plm-error' : ''}`}>
              {file.diffStatus === 'cloud' ? 'Cloud only (not downloaded)' 
                : file.diffStatus === 'added' ? 'Local only (not synced)'
                : file.diffStatus === 'ignored' ? 'Local only (ignored from sync)'
                : file.diffStatus === 'modified' ? 'Modified locally'
                : file.diffStatus === 'moved' ? 'Moved (path changed)'
                : file.diffStatus === 'outdated' ? 'Outdated (newer version on server)'
                : file.diffStatus === 'deleted_remote' ? 'Deleted from server (orphaned)'
                : file.pdmData ? 'Synced' : 'Not synced'}
            </div>
          </div>
          
          {/* Modified Date */}
          {file.modifiedTime && (
            <div>
              <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">Modified</div>
              <div className="text-sm">{new Date(file.modifiedTime).toLocaleString()}</div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-plm-border flex justify-end">
          <button
            onClick={onClose}
            className="btn btn-ghost"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
