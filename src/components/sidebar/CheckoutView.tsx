import { Lock, Unlock, AlertCircle } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

export function CheckoutView() {
  const { files, selectedFiles, getSelectedFileObjects } = usePDMStore()
  
  // Get files that are checked out (have gitStatus of modified)
  const modifiedFiles = files.filter(f => 
    !f.isDirectory && (f.gitStatus === 'modified' || f.gitStatus === 'staged')
  )
  
  const selectedFileObjects = getSelectedFileObjects()

  const handleCheckout = async () => {
    if (selectedFileObjects.length === 0) return
    // TODO: Implement checkout logic with Supabase
    console.log('Checking out:', selectedFileObjects)
  }

  const handleCheckin = async () => {
    if (selectedFileObjects.length === 0) return
    // TODO: Implement checkin logic with Git and Supabase
    console.log('Checking in:', selectedFileObjects)
  }

  return (
    <div className="p-4 space-y-6">
      {/* Selection actions */}
      <div>
        <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
          Selected Files ({selectedFiles.length})
        </div>
        
        <div className="space-y-2">
          <button
            onClick={handleCheckout}
            disabled={selectedFiles.length === 0}
            className="btn btn-secondary w-full justify-start"
          >
            <Lock size={16} />
            Check Out Selected
          </button>
          
          <button
            onClick={handleCheckin}
            disabled={selectedFiles.length === 0}
            className="btn btn-secondary w-full justify-start"
          >
            <Unlock size={16} />
            Check In Selected
          </button>
        </div>
      </div>

      {/* Modified files */}
      <div>
        <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
          Modified Files ({modifiedFiles.length})
        </div>
        
        {modifiedFiles.length === 0 ? (
          <div className="text-sm text-pdm-fg-muted py-4 text-center">
            No modified files
          </div>
        ) : (
          <div className="space-y-1">
            {modifiedFiles.map(file => (
              <div
                key={file.path}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-pdm-highlight text-sm"
              >
                <AlertCircle size={14} className="text-pdm-warning flex-shrink-0" />
                <span className="truncate" title={file.relativePath}>
                  {file.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick commit */}
      {modifiedFiles.length > 0 && (
        <div>
          <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
            Quick Commit
          </div>
          
          <textarea
            placeholder="Commit message..."
            className="w-full h-20 resize-none text-sm"
          />
          
          <button className="btn btn-primary w-full mt-2">
            Commit All Changes
          </button>
        </div>
      )}
    </div>
  )
}

