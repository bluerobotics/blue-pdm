import { useState } from 'react'
import { Lock, User, File, ArrowUp, Undo2, CheckSquare, Square, Plus, Trash2, Upload, X, AlertTriangle, Loader2 } from 'lucide-react'
import { usePDMStore, LocalFile } from '../../stores/pdmStore'
import { checkinFile, syncFile } from '../../lib/supabase'
import { downloadFile } from '../../lib/storage'

interface CheckoutViewProps {
  onRefresh: (silent?: boolean) => void
}

export function CheckoutView({ onRefresh }: CheckoutViewProps) {
  const { files, user, organization, vaultPath, addToast, activeVaultId, connectedVaults, addProcessingFolder, removeProcessingFolder } = usePDMStore()
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [selectedAddedFiles, setSelectedAddedFiles] = useState<Set<string>>(new Set())
  const [isProcessing, setIsProcessing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0, isActive: false })
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, isActive: false })
  
  // Get current vault ID
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  // Get files that are checked out by anyone
  const checkedOutFiles = files.filter(f => 
    !f.isDirectory && f.pdmData?.checked_out_by
  )
  
  // Get files checked out by current user
  const myCheckedOutFiles = checkedOutFiles.filter(f => 
    f.pdmData?.checked_out_by === user?.id
  )
  
  // Get files checked out by others
  const othersCheckedOutFiles = checkedOutFiles.filter(f => 
    f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id
  )
  
  // Get added files (local files not yet synced to cloud)
  const addedFiles = files.filter(f => 
    !f.isDirectory && f.diffStatus === 'added'
  )
  
  const toggleSelect = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }
  
  const selectAll = () => {
    setSelectedFiles(new Set(myCheckedOutFiles.map(f => f.path)))
  }
  
  const selectNone = () => {
    setSelectedFiles(new Set())
  }
  
  const selectedCount = selectedFiles.size
  const allSelected = myCheckedOutFiles.length > 0 && selectedCount === myCheckedOutFiles.length
  
  // Added files selection
  const toggleSelectAdded = (path: string) => {
    setSelectedAddedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }
  
  const selectAllAdded = () => {
    setSelectedAddedFiles(new Set(addedFiles.map(f => f.path)))
  }
  
  const selectNoneAdded = () => {
    setSelectedAddedFiles(new Set())
  }
  
  const selectedAddedCount = selectedAddedFiles.size
  const allAddedSelected = addedFiles.length > 0 && selectedAddedCount === addedFiles.length
  
  // Check in selected files
  const handleCheckin = async () => {
    if (!organization || !user || selectedCount === 0) return
    
    setIsProcessing(true)
    let succeeded = 0
    let failed = 0
    
    const api = (window as any).electronAPI
    if (!api) {
      addToast('error', 'Electron API not available')
      setIsProcessing(false)
      return
    }
    
    try {
      for (const path of selectedFiles) {
        const file = myCheckedOutFiles.find(f => f.path === path)
        if (!file || !file.pdmData) continue
        
        try {
          // Check if file was moved (local path differs from server path)
          const wasFileMoved = file.pdmData?.file_path && file.relativePath !== file.pdmData.file_path
          const wasFileRenamed = file.pdmData?.file_name && file.name !== file.pdmData.file_name
          
          // Read file to get current hash
          const readResult = await api.readFile(file.path)
          
          if (readResult?.success && readResult.hash) {
            const result = await checkinFile(file.pdmData.id, user.id, {
              newContentHash: readResult.hash,
              newFileSize: file.size,
              newFilePath: wasFileMoved ? file.relativePath : undefined,
              newFileName: wasFileRenamed ? file.name : undefined
            })
            
            if (result.success && result.file) {
              // Make file read-only after check-in
              await api.setReadonly(file.path, true)
              // Update store with new version and clear rollback state
              updateFileInStore(file.path, {
                pdmData: { ...file.pdmData, ...result.file, checked_out_by: null, checked_out_user: null },
                localHash: readResult.hash,
                diffStatus: undefined,
                localActiveVersion: undefined  // Clear rollback state
              })
              succeeded++
            } else if (result.success) {
              await api.setReadonly(file.path, true)
              updateFileInStore(file.path, {
                pdmData: { ...file.pdmData, checked_out_by: null, checked_out_user: null },
                localHash: readResult.hash,
                diffStatus: undefined,
                localActiveVersion: undefined
              })
              succeeded++
            } else {
              console.error('Check in failed:', result.error)
              failed++
            }
          } else {
            // Just release checkout without updating content
            const result = await checkinFile(file.pdmData.id, user.id, {
              newFilePath: wasFileMoved ? file.relativePath : undefined,
              newFileName: wasFileRenamed ? file.name : undefined
            })
            if (result.success && result.file) {
              await api.setReadonly(file.path, true)
              // Update store and clear rollback state
              updateFileInStore(file.path, {
                pdmData: { ...file.pdmData, ...result.file, checked_out_by: null, checked_out_user: null },
                localHash: result.file.content_hash,
                diffStatus: undefined,
                localActiveVersion: undefined
              })
              succeeded++
            } else if (result.success) {
              await api.setReadonly(file.path, true)
              updateFileInStore(file.path, {
                pdmData: { ...file.pdmData, checked_out_by: null, checked_out_user: null },
                diffStatus: undefined,
                localActiveVersion: undefined
              })
              succeeded++
            } else {
              console.error('Check in failed:', result.error)
              failed++
            }
          }
        } catch (err) {
          console.error('Check in error:', err)
          failed++
        }
      }
      
      if (failed > 0) {
        addToast('warning', `Checked in ${succeeded}/${selectedCount} files (${failed} failed)`)
      } else {
        addToast('success', `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`)
      }
      
      setSelectedFiles(new Set())
      
      // Refresh file list to update the UI
      onRefresh(true)
    } finally {
      setIsProcessing(false)
    }
  }
  
  // Check in added files (first sync to cloud)
  const handleCheckinAddedFiles = async () => {
    if (!organization || !user || !currentVaultId || selectedAddedCount === 0) return
    
    setIsProcessing(true)
    const filesToSync = Array.from(selectedAddedFiles)
    setSyncProgress({ current: 0, total: filesToSync.length, isActive: true })
    
    let succeeded = 0
    let failed = 0
    
    const api = (window as any).electronAPI
    if (!api) {
      addToast('error', 'Electron API not available')
      setIsProcessing(false)
      setSyncProgress({ current: 0, total: 0, isActive: false })
      return
    }
    
    try {
      for (let i = 0; i < filesToSync.length; i++) {
        const path = filesToSync[i]
        const file = addedFiles.find(f => f.path === path)
        if (!file) {
          failed++
          setSyncProgress({ current: i + 1, total: filesToSync.length, isActive: true })
          continue
        }
        
        try {
          // Read file content
          const readResult = await api.readFile(file.path)
          if (!readResult?.success || !readResult.data || !readResult.hash) {
            console.error('Failed to read file:', file.name)
            failed++
            setSyncProgress({ current: i + 1, total: filesToSync.length, isActive: true })
            continue
          }
          
          // Sync to cloud
          const { error } = await syncFile(
            organization.id,
            currentVaultId,
            user.id,
            file.relativePath,
            file.name,
            file.extension,
            file.size,
            readResult.hash,
            readResult.data
          )
          
          if (error) {
            console.error('Sync failed:', error)
            failed++
          } else {
            // Make file read-only after first sync
            await api.setReadonly(file.path, true)
            succeeded++
          }
        } catch (err) {
          console.error('Check in error:', err)
          failed++
        }
        
        setSyncProgress({ current: i + 1, total: filesToSync.length, isActive: true })
      }
      
      if (failed > 0) {
        addToast('warning', `Synced ${succeeded}/${filesToSync.length} files (${failed} failed)`)
      } else {
        addToast('success', `Synced ${succeeded} new file${succeeded > 1 ? 's' : ''} to cloud`)
      }
      
      setSelectedAddedFiles(new Set())
      
      // Refresh file list to update the UI
      onRefresh(true)
    } finally {
      setIsProcessing(false)
      setSyncProgress({ current: 0, total: 0, isActive: false })
    }
  }
  
  // Show delete confirmation dialog
  const handleDeleteClick = () => {
    if (selectedAddedCount === 0) return
    setShowDeleteConfirm(true)
  }
  
  // Discard added files (delete local files)
  const handleDiscardAddedFiles = async () => {
    if (!vaultPath || selectedAddedCount === 0) return
    
    setShowDeleteConfirm(false)
    setIsProcessing(true)
    
    const filesToDelete = Array.from(selectedAddedFiles)
    
    // Track files being deleted for spinner display
    const fileObjects = filesToDelete.map(path => addedFiles.find(f => f.path === path)).filter(Boolean)
    const pathsBeingDeleted = fileObjects.map(f => f!.relativePath)
    pathsBeingDeleted.forEach(p => addProcessingFolder(p))
    
    setDeleteProgress({ current: 0, total: filesToDelete.length, isActive: true })
    
    let succeeded = 0
    let failed = 0
    
    const api = (window as any).electronAPI
    if (!api) {
      addToast('error', 'Electron API not available')
      pathsBeingDeleted.forEach(p => removeProcessingFolder(p))
      setIsProcessing(false)
      setDeleteProgress({ current: 0, total: 0, isActive: false })
      return
    }
    
    try {
      for (let i = 0; i < filesToDelete.length; i++) {
        const path = filesToDelete[i]
        const file = addedFiles.find(f => f.path === path)
        if (!file) continue
        
        setDeleteProgress({ current: i + 1, total: filesToDelete.length, isActive: true })
        
        try {
          const result = await api.deleteItem(file.path)
          if (result.success) {
            succeeded++
          } else {
            console.error('Delete failed:', result.error)
            failed++
          }
        } catch (err) {
          console.error('Delete error:', err)
          failed++
        }
      }
      
      if (failed > 0) {
        addToast('warning', `Deleted ${succeeded}/${filesToDelete.length} files (${failed} failed)`)
      } else {
        addToast('success', `Deleted ${succeeded} file${succeeded > 1 ? 's' : ''}`)
      }
      
      setSelectedAddedFiles(new Set())
      
      // Refresh file list to update the UI
      onRefresh(true)
    } finally {
      // Clean up spinners
      pathsBeingDeleted.forEach(p => removeProcessingFolder(p))
      setIsProcessing(false)
      setDeleteProgress({ current: 0, total: 0, isActive: false })
    }
  }
  
  // Discard changes (revert to server version)
  const handleDiscardChanges = async () => {
    if (!organization || !user || !vaultPath || selectedCount === 0) return
    
    setIsProcessing(true)
    let succeeded = 0
    let failed = 0
    
    const api = (window as any).electronAPI
    if (!api) {
      addToast('error', 'Electron API not available')
      setIsProcessing(false)
      return
    }
    
    try {
      for (const path of selectedFiles) {
        const file = myCheckedOutFiles.find(f => f.path === path)
        if (!file || !file.pdmData) continue
        
        try {
          // Get the server version content hash
          const contentHash = file.pdmData.content_hash
          if (!contentHash) {
            failed++
            continue
          }
          
          // Download the server version
          const { data, error: downloadError } = await downloadFile(organization.id, contentHash)
          if (downloadError || !data) {
            console.error('Download failed:', downloadError)
            failed++
            continue
          }
          
          // Make writable first
          await api.setReadonly(file.path, false)
          
          // Write file
          const writeResult = await api.writeFile(file.path, data)
          if (!writeResult?.success) {
            failed++
            continue
          }
          
          // Release checkout without updating content (we reverted to server version)
          const result = await checkinFile(file.pdmData.id, user.id)
          
          if (!result.success) {
            console.error('Release checkout failed:', result.error)
            failed++
            continue
          }
          
          // Make read-only
          await api.setReadonly(file.path, true)
          succeeded++
        } catch (err) {
          console.error('Discard changes error:', err)
          failed++
        }
      }
      
      if (failed > 0) {
        addToast('warning', `Discarded ${succeeded}/${selectedCount} files (${failed} failed)`)
      } else {
        addToast('success', `Discarded changes for ${succeeded} file${succeeded > 1 ? 's' : ''}`)
      }
      
      setSelectedFiles(new Set())
      
      // Refresh file list to update the UI
      onRefresh(true)
    } finally {
      setIsProcessing(false)
    }
  }
  
  const FileRow = ({ file, isOwn }: { file: LocalFile; isOwn: boolean }) => {
    const isSelected = selectedFiles.has(file.path)
    const checkedOutUser = (file.pdmData as any)?.checked_out_user
    const userName = checkedOutUser?.full_name || checkedOutUser?.email || 'Unknown'
    
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
          isSelected ? 'bg-pdm-highlight' : 'hover:bg-pdm-highlight/50'
        }`}
        onClick={() => isOwn && toggleSelect(file.path)}
      >
        {isOwn && (
          <button 
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              toggleSelect(file.path)
            }}
          >
            {isSelected ? (
              <CheckSquare size={16} className="text-pdm-accent" />
            ) : (
              <Square size={16} className="text-pdm-fg-muted" />
            )}
          </button>
        )}
        <Lock size={14} className={`flex-shrink-0 ${isOwn ? 'text-pdm-warning' : 'text-pdm-error'}`} />
        <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate" title={file.relativePath}>
            {file.name}
          </div>
          {!isOwn && (
            <div className="text-xs text-pdm-fg-muted flex items-center gap-1">
              <User size={10} />
              {userName}
            </div>
          )}
        </div>
      </div>
    )
  }
  
  const AddedFileRow = ({ file }: { file: LocalFile }) => {
    const isSelected = selectedAddedFiles.has(file.path)
    
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
          isSelected ? 'bg-pdm-highlight' : 'hover:bg-pdm-highlight/50'
        }`}
        onClick={() => toggleSelectAdded(file.path)}
      >
        <button 
          className="flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            toggleSelectAdded(file.path)
          }}
        >
          {isSelected ? (
            <CheckSquare size={16} className="text-pdm-accent" />
          ) : (
            <Square size={16} className="text-pdm-fg-muted" />
          )}
        </button>
        <Plus size={14} className="flex-shrink-0 text-pdm-success" />
        <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate" title={file.relativePath}>
            {file.name}
          </div>
          <div className="text-xs text-pdm-fg-muted truncate">
            {file.relativePath}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sync progress bar */}
      {syncProgress.isActive && (
        <div className="px-3 py-2 bg-pdm-bg-light border-b border-pdm-border">
          <div className="flex items-center gap-2 text-xs text-pdm-fg-dim mb-1">
            <Loader2 size={12} className="animate-spin" />
            Syncing {syncProgress.current} of {syncProgress.total}...
          </div>
          <div className="h-1 bg-pdm-border rounded-full overflow-hidden">
            <div 
              className="h-full bg-pdm-accent transition-all duration-200"
              style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      
      {/* Delete progress bar */}
      {deleteProgress.isActive && (
        <div className="px-3 py-2 bg-pdm-bg-light border-b border-pdm-border">
          <div className="flex items-center gap-2 text-xs text-pdm-fg-dim mb-1">
            <Loader2 size={12} className="animate-spin" />
            Deleting {deleteProgress.current} of {deleteProgress.total}...
          </div>
          <div className="h-1 bg-pdm-border rounded-full overflow-hidden">
            <div 
              className="h-full bg-pdm-error transition-all duration-200"
              style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* New files (not yet synced) - shown first */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-pdm-fg-muted uppercase tracking-wide flex items-center gap-2">
              <Plus size={12} className="text-pdm-success" />
              New Files ({addedFiles.length})
            </div>
            {addedFiles.length > 0 && (
              <button
                onClick={allAddedSelected ? selectNoneAdded : selectAllAdded}
                className="text-xs text-pdm-fg-muted hover:text-pdm-fg transition-colors"
              >
                {allAddedSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          
          {/* Actions for new files - at top */}
          {selectedAddedCount > 0 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-pdm-border">
              <span className="text-xs text-pdm-fg-muted">{selectedAddedCount} selected</span>
              <div className="flex-1" />
              <button
                onClick={handleCheckinAddedFiles}
                disabled={isProcessing || !currentVaultId}
                className="btn btn-primary btn-sm text-xs flex items-center gap-1"
              >
                <Upload size={12} />
                Check In
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={isProcessing}
                className="btn btn-sm text-xs flex items-center gap-1 bg-pdm-error hover:bg-pdm-error/80 text-white"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )}
          
          {addedFiles.length === 0 ? (
            <div className="text-sm text-pdm-fg-muted py-4 text-center">
              No new files
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {addedFiles.map(file => (
                  <AddedFileRow key={file.path} file={file} />
                ))}
              </div>
              {selectedAddedCount === 0 && (
                <div className="text-xs text-pdm-fg-muted mt-2 px-2">
                  These files exist locally but haven't been synced to the cloud yet.
                </div>
              )}
            </>
          )}
        </div>

        {/* Checked out files */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-pdm-fg-muted uppercase tracking-wide flex items-center gap-2">
              <Lock size={12} className="text-pdm-warning" />
              Checked Out Files ({myCheckedOutFiles.length})
            </div>
            {myCheckedOutFiles.length > 0 && (
              <button
                onClick={allSelected ? selectNone : selectAll}
                className="text-xs text-pdm-fg-muted hover:text-pdm-fg transition-colors"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          
          {/* Actions for checked out files - at top */}
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-pdm-border">
              <span className="text-xs text-pdm-fg-muted">{selectedCount} selected</span>
              <div className="flex-1" />
              <button
                onClick={handleCheckin}
                disabled={isProcessing}
                className="btn btn-primary btn-sm text-xs flex items-center gap-1"
              >
                <ArrowUp size={12} />
                Check In
              </button>
              <button
                onClick={handleDiscardChanges}
                disabled={isProcessing}
                className="btn btn-ghost btn-sm text-xs flex items-center gap-1 text-pdm-warning"
              >
                <Undo2 size={12} />
                Discard
              </button>
            </div>
          )}
          
          {myCheckedOutFiles.length === 0 ? (
            <div className="text-sm text-pdm-fg-muted py-4 text-center">
              No files checked out
            </div>
          ) : (
            <div className="space-y-1">
              {myCheckedOutFiles.map(file => (
                <FileRow key={file.path} file={file} isOwn={true} />
              ))}
            </div>
          )}
        </div>

        {/* Files checked out by others */}
        {othersCheckedOutFiles.length > 0 && (
          <div>
            <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-3">
              Checked Out by Others ({othersCheckedOutFiles.length})
            </div>
            
            <div className="space-y-1">
              {othersCheckedOutFiles.map(file => (
                <FileRow key={file.path} file={file} isOwn={false} />
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="text-xs text-pdm-fg-muted border-t border-pdm-border pt-4">
          <div className="flex justify-between mb-1">
            <span>Total synced files:</span>
            <span>{files.filter(f => !f.isDirectory && f.pdmData).length}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>Total checked out:</span>
            <span>{checkedOutFiles.length}</span>
          </div>
          <div className="flex justify-between">
            <span>New files to sync:</span>
            <span className={addedFiles.length > 0 ? 'text-pdm-success' : ''}>{addedFiles.length}</span>
          </div>
        </div>
      </div>
      
      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-pdm-border">
              <div className="flex items-center gap-2 text-pdm-error">
                <AlertTriangle size={18} />
                <span className="font-medium">Delete Files</span>
              </div>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="p-1 rounded hover:bg-pdm-bg transition-colors text-pdm-fg-muted hover:text-pdm-fg"
              >
                <X size={16} />
              </button>
            </div>
            
            {/* Content */}
            <div className="p-4">
              <p className="text-sm text-pdm-fg mb-3">
                Are you sure you want to delete <span className="font-semibold text-pdm-error">{selectedAddedCount}</span> file{selectedAddedCount > 1 ? 's' : ''} from your local vault?
              </p>
              <p className="text-xs text-pdm-fg-muted">
                This will move the files to your Recycle Bin.
              </p>
            </div>
            
            {/* Actions */}
            <div className="flex justify-end gap-2 px-4 py-3 bg-pdm-bg border-t border-pdm-border">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDiscardAddedFiles}
                className="btn btn-sm bg-pdm-error hover:bg-pdm-error/80 text-white flex items-center gap-1"
              >
                <Trash2 size={14} />
                Delete Files
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
