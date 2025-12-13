import { useState, useMemo, useCallback, memo, useEffect } from 'react'
import { Lock, File, ArrowUp, Undo2, CheckSquare, Square, Plus, Trash2, Upload, X, AlertTriangle, Shield, Unlock, FolderOpen, CloudOff, Monitor } from 'lucide-react'
import { usePDMStore, LocalFile } from '../../stores/pdmStore'
import { getInitials } from '../../types/pdm'
// Use command system instead of direct supabase calls
import { executeCommand } from '../../lib/commands'

// ============================================
// Memoized Row Components (outside main component)
// ============================================

interface FileRowProps {
  file: LocalFile
  isOwn: boolean
  showAdminSelect?: boolean
  isSelected: boolean
  isBeingProcessed: boolean
  onToggleSelect: (path: string) => void
  onNavigate: (file: LocalFile) => void
}

const FileRow = memo(function FileRow({ 
  file, 
  isOwn, 
  showAdminSelect, 
  isSelected, 
  isBeingProcessed,
  onToggleSelect,
  onNavigate
}: FileRowProps) {
  const checkedOutUser = (file.pdmData as any)?.checked_out_user
  const userName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Unknown'
  const avatarUrl = checkedOutUser?.avatar_url
  const canSelect = isOwn || showAdminSelect
  
  // Don't render files that are being processed
  if (isBeingProcessed) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm opacity-50 cursor-not-allowed">
        <div className="w-4 h-4 border-2 border-pdm-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <Lock size={14} className="flex-shrink-0 text-pdm-fg-muted" />
        <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
        <span className="truncate text-pdm-fg-muted flex-1" title={file.relativePath}>
          {file.name}
        </span>
      </div>
    )
  }
  
  const handleClick = () => {
    if (canSelect) {
      onToggleSelect(file.path)
    }
  }
  
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
        canSelect ? 'cursor-pointer' : ''
      } ${isSelected ? 'bg-pdm-highlight' : canSelect ? 'hover:bg-pdm-highlight/50' : ''}`}
      onClick={handleClick}
    >
      {canSelect && (
        <button 
          className="flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            handleClick()
          }}
        >
          {isSelected ? (
            <CheckSquare size={16} className={showAdminSelect ? 'text-pdm-error' : 'text-pdm-accent'} />
          ) : (
            <Square size={16} className="text-pdm-fg-muted" />
          )}
        </button>
      )}
      <Lock size={14} className={`flex-shrink-0 ${isOwn ? 'text-pdm-warning' : 'text-pdm-error'}`} />
      <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
      <span className="truncate flex-1" title={file.relativePath}>
        {file.name}
      </span>
      {/* Avatar for files checked out by others */}
      {!isOwn && (
        <div 
          className="flex-shrink-0 relative" 
          title={userName}
        >
          {avatarUrl ? (
            <img 
              src={avatarUrl} 
              alt={userName}
              className="w-5 h-5 rounded-full ring-1 ring-pdm-error/50 bg-pdm-bg object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement
                if (fallback) fallback.classList.remove('hidden')
              }}
            />
          ) : null}
          <div 
            className={`w-5 h-5 rounded-full ring-1 ring-pdm-error/50 bg-pdm-error/20 text-pdm-error flex items-center justify-center text-[9px] font-medium ${avatarUrl ? 'hidden' : ''}`}
          >
            {getInitials(userName)}
          </div>
        </div>
      )}
      {/* Navigate to file location */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(file)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-pdm-highlight text-pdm-fg-muted hover:text-pdm-fg transition-colors"
        title="Show in Explorer"
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

interface AddedFileRowProps {
  file: LocalFile
  isSelected: boolean
  isBeingProcessed: boolean
  onToggleSelect: (path: string) => void
  onNavigate: (file: LocalFile) => void
}

const AddedFileRow = memo(function AddedFileRow({ 
  file, 
  isSelected, 
  isBeingProcessed,
  onToggleSelect,
  onNavigate
}: AddedFileRowProps) {
  // Show processing state for files being uploaded
  if (isBeingProcessed) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm opacity-50 cursor-not-allowed">
        <div className="w-4 h-4 border-2 border-pdm-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <Plus size={14} className="flex-shrink-0 text-pdm-fg-muted" />
        <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
        <span className="truncate text-pdm-fg-muted flex-1" title={file.relativePath}>
          {file.name}
        </span>
      </div>
    )
  }
  
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
        isSelected ? 'bg-pdm-highlight' : 'hover:bg-pdm-highlight/50'
      }`}
      onClick={() => onToggleSelect(file.path)}
    >
      <button 
        className="flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(file.path)
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
      <span className="truncate flex-1" title={file.relativePath}>
        {file.name}
      </span>
      {/* Navigate to file location */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(file)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-pdm-highlight text-pdm-fg-muted hover:text-pdm-fg transition-colors"
        title="Show in Explorer"
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

interface DeletedRemoteFileRowProps {
  file: LocalFile
  isSelected: boolean
  isBeingProcessed: boolean
  onToggleSelect: (path: string) => void
  onNavigate: (file: LocalFile) => void
}

const DeletedRemoteFileRow = memo(function DeletedRemoteFileRow({ 
  file, 
  isSelected, 
  isBeingProcessed,
  onToggleSelect,
  onNavigate
}: DeletedRemoteFileRowProps) {
  // Show processing state for files being processed
  if (isBeingProcessed) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm opacity-50 cursor-not-allowed">
        <div className="w-4 h-4 border-2 border-pdm-error border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <CloudOff size={14} className="flex-shrink-0 text-pdm-fg-muted" />
        <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
        <span className="truncate text-pdm-fg-muted flex-1" title={file.relativePath}>
          {file.name}
        </span>
      </div>
    )
  }
  
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
        isSelected ? 'bg-pdm-error/20' : 'hover:bg-pdm-error/10'
      }`}
      onClick={() => onToggleSelect(file.path)}
    >
      <button 
        className="flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(file.path)
        }}
      >
        {isSelected ? (
          <CheckSquare size={16} className="text-pdm-error" />
        ) : (
          <Square size={16} className="text-pdm-fg-muted" />
        )}
      </button>
      <CloudOff size={14} className="flex-shrink-0 text-pdm-error" />
      <File size={14} className="text-pdm-fg-muted flex-shrink-0" />
      <span className="truncate flex-1" title={file.relativePath}>
        {file.name}
      </span>
      {/* Navigate to file location */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(file)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-pdm-highlight text-pdm-fg-muted hover:text-pdm-fg transition-colors"
        title="Show in Explorer"
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

// ============================================
// Main Component
// ============================================

interface PendingViewProps {
  onRefresh: (silent?: boolean) => void
}

export function PendingView({ onRefresh }: PendingViewProps) {
  const { files, user, setActiveView, setCurrentFolder, toggleFolder, expandedFolders } = usePDMStore()
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [selectedAddedFiles, setSelectedAddedFiles] = useState<Set<string>>(new Set())
  const [selectedOthersFiles, setSelectedOthersFiles] = useState<Set<string>>(new Set())
  const [selectedDeletedRemoteFiles, setSelectedDeletedRemoteFiles] = useState<Set<string>>(new Set())
  const [isProcessingCheckedOut, setIsProcessingCheckedOut] = useState(false)
  const [isProcessingAdded, setIsProcessingAdded] = useState(false)
  const [isProcessingOthers, setIsProcessingOthers] = useState(false)
  const [isProcessingDeletedRemote, setIsProcessingDeletedRemote] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [processingPaths, setProcessingPaths] = useState<Set<string>>(new Set())
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  const [forceCheckinConfirm, setForceCheckinConfirm] = useState<{
    filesOnDifferentMachine: LocalFile[]
    allFilesToCheckin: LocalFile[]
    machineNames: string[]
  } | null>(null)
  
  // Load current machine ID once
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const { getMachineId } = await import('@/lib/backup')
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)
      } catch {
        setCurrentMachineId(null)
      }
    }
    loadMachineId()
  }, [])
  
  // Memoize expensive file filtering - only recompute when files or user changes
  const { checkedOutFiles, myCheckedOutFiles, othersCheckedOutFiles, addedFiles, deletedRemoteFiles, syncedFilesCount } = useMemo(() => {
    const checkedOut = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by)
    const myCheckedOut = checkedOut.filter(f => f.pdmData?.checked_out_by === user?.id)
    const othersCheckedOut = checkedOut.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
    const added = files.filter(f => !f.isDirectory && f.diffStatus === 'added')
    const deletedRemote = files.filter(f => !f.isDirectory && f.diffStatus === 'deleted_remote')
    const synced = files.filter(f => !f.isDirectory && f.pdmData).length
    
    return { checkedOutFiles: checkedOut, myCheckedOutFiles: myCheckedOut, othersCheckedOutFiles: othersCheckedOut, addedFiles: added, deletedRemoteFiles: deletedRemote, syncedFilesCount: synced }
  }, [files, user?.id])
  
  // Stable callbacks for row components
  const toggleSelect = useCallback((path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  
  const toggleSelectAdded = useCallback((path: string) => {
    setSelectedAddedFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  
  const toggleSelectOthers = useCallback((path: string) => {
    setSelectedOthersFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  
  const toggleSelectDeletedRemote = useCallback((path: string) => {
    setSelectedDeletedRemoteFiles(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  
  const navigateToFile = useCallback((file: LocalFile) => {
    const parts = file.relativePath.split('/')
    parts.pop()
    const parentPath = parts.join('/')
    
    if (parentPath) {
      for (let i = 1; i <= parts.length; i++) {
        const ancestorPath = parts.slice(0, i).join('/')
        if (!expandedFolders.has(ancestorPath)) {
          toggleFolder(ancestorPath)
        }
      }
    }
    
    setCurrentFolder(parentPath)
    setActiveView('explorer')
  }, [expandedFolders, toggleFolder, setCurrentFolder, setActiveView])
  
  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(myCheckedOutFiles.map(f => f.path)))
  }, [myCheckedOutFiles])
  
  const selectNone = useCallback(() => {
    setSelectedFiles(new Set())
  }, [])
  
  const selectAllAdded = useCallback(() => {
    setSelectedAddedFiles(new Set(addedFiles.map(f => f.path)))
  }, [addedFiles])
  
  const selectNoneAdded = useCallback(() => {
    setSelectedAddedFiles(new Set())
  }, [])
  
  const selectAllOthers = useCallback(() => {
    setSelectedOthersFiles(new Set(othersCheckedOutFiles.map(f => f.path)))
  }, [othersCheckedOutFiles])
  
  const selectNoneOthers = useCallback(() => {
    setSelectedOthersFiles(new Set())
  }, [])
  
  const selectAllDeletedRemote = useCallback(() => {
    setSelectedDeletedRemoteFiles(new Set(deletedRemoteFiles.map(f => f.path)))
  }, [deletedRemoteFiles])
  
  const selectNoneDeletedRemote = useCallback(() => {
    setSelectedDeletedRemoteFiles(new Set())
  }, [])
  
  const selectedCount = selectedFiles.size
  const allSelected = myCheckedOutFiles.length > 0 && selectedCount === myCheckedOutFiles.length
  const selectedAddedCount = selectedAddedFiles.size
  const allAddedSelected = addedFiles.length > 0 && selectedAddedCount === addedFiles.length
  const isAdmin = user?.role === 'admin'
  const selectedOthersCount = selectedOthersFiles.size
  const allOthersSelected = othersCheckedOutFiles.length > 0 && selectedOthersCount === othersCheckedOutFiles.length
  const selectedDeletedRemoteCount = selectedDeletedRemoteFiles.size
  const allDeletedRemoteSelected = deletedRemoteFiles.length > 0 && selectedDeletedRemoteCount === deletedRemoteFiles.length
  
  // Command handlers
  const handleCheckin = useCallback(async () => {
    if (selectedFiles.size === 0) return
    
    const filesToCheckinPaths = Array.from(selectedFiles)
    const pathToFile = new Map(myCheckedOutFiles.map(f => [f.path, f]))
    const fileObjects = filesToCheckinPaths.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    // Check if any files are checked out on a different machine
    const filesOnDifferentMachine = fileObjects.filter(f => {
      const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
      return checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
    })
    
    if (filesOnDifferentMachine.length > 0) {
      // Show confirmation dialog
      const machineNames = [...new Set(filesOnDifferentMachine.map(f => f.pdmData?.checked_out_by_machine_name || 'another computer'))]
      setForceCheckinConfirm({
        filesOnDifferentMachine,
        allFilesToCheckin: fileObjects,
        machineNames
      })
      return
    }
    
    // No machine mismatch, proceed with check-in
    await doCheckin(fileObjects, filesToCheckinPaths)
  }, [selectedFiles, myCheckedOutFiles, currentMachineId])
  
  // Actual check-in execution
  const doCheckin = useCallback(async (fileObjects: LocalFile[], filesToCheckinPaths: string[]) => {
    setIsProcessingCheckedOut(true)
    setProcessingPaths(prev => new Set([...prev, ...filesToCheckinPaths]))
    setSelectedFiles(new Set())
    
    try {
      await executeCommand('checkin', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToCheckinPaths.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingCheckedOut(false)
    }
  }, [onRefresh])
  
  // Handle force check-in confirmation
  const handleForceCheckin = useCallback(() => {
    if (!forceCheckinConfirm) return
    const { allFilesToCheckin } = forceCheckinConfirm
    const paths = allFilesToCheckin.map(f => f.path)
    setForceCheckinConfirm(null)
    doCheckin(allFilesToCheckin, paths)
  }, [forceCheckinConfirm, doCheckin])
  
  const handleCheckinAddedFiles = useCallback(async () => {
    if (selectedAddedFiles.size === 0) return
    
    setIsProcessingAdded(true)
    const filesToSync = Array.from(selectedAddedFiles)
    setProcessingPaths(prev => new Set([...prev, ...filesToSync]))
    setSelectedAddedFiles(new Set())
    
    const pathToFile = new Map(addedFiles.map(f => [f.path, f]))
    const fileObjects = filesToSync.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    try {
      await executeCommand('sync', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToSync.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingAdded(false)
    }
  }, [selectedAddedFiles, addedFiles, onRefresh])
  
  const handleDeleteClick = useCallback(() => {
    if (selectedAddedFiles.size === 0) return
    setShowDeleteConfirm(true)
  }, [selectedAddedFiles.size])
  
  const handleDiscardAddedFiles = useCallback(async () => {
    if (selectedAddedFiles.size === 0) return
    
    setShowDeleteConfirm(false)
    setIsProcessingAdded(true)
    const filesToDelete = Array.from(selectedAddedFiles)
    setProcessingPaths(prev => new Set([...prev, ...filesToDelete]))
    setSelectedAddedFiles(new Set())
    
    const pathToFile = new Map(addedFiles.map(f => [f.path, f]))
    const fileObjects = filesToDelete.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    try {
      await executeCommand('delete-local', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToDelete.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingAdded(false)
    }
  }, [selectedAddedFiles, addedFiles, onRefresh])
  
  const handleDiscardChanges = useCallback(async () => {
    if (selectedFiles.size === 0) return
    
    setIsProcessingCheckedOut(true)
    const filesToDiscard = Array.from(selectedFiles)
    setProcessingPaths(prev => new Set([...prev, ...filesToDiscard]))
    setSelectedFiles(new Set())
    
    const pathToFile = new Map(myCheckedOutFiles.map(f => [f.path, f]))
    const fileObjects = filesToDiscard.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    try {
      await executeCommand('discard', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToDiscard.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingCheckedOut(false)
    }
  }, [selectedFiles, myCheckedOutFiles, onRefresh])
  
  const handleAdminForceRelease = useCallback(async () => {
    if (!isAdmin || selectedOthersFiles.size === 0) return
    
    setIsProcessingOthers(true)
    const filesToProcess = Array.from(selectedOthersFiles)
    setProcessingPaths(prev => new Set([...prev, ...filesToProcess]))
    setSelectedOthersFiles(new Set())
    
    const pathToFile = new Map(othersCheckedOutFiles.map(f => [f.path, f]))
    const fileObjects = filesToProcess.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    try {
      await executeCommand('force-release', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToProcess.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingOthers(false)
    }
  }, [isAdmin, selectedOthersFiles, othersCheckedOutFiles, onRefresh])
  
  // Handler to delete orphaned local files (files deleted from server)
  const handleDeleteOrphanedFiles = useCallback(async () => {
    if (selectedDeletedRemoteFiles.size === 0) return
    
    setIsProcessingDeletedRemote(true)
    const filesToDelete = Array.from(selectedDeletedRemoteFiles)
    setProcessingPaths(prev => new Set([...prev, ...filesToDelete]))
    setSelectedDeletedRemoteFiles(new Set())
    
    const pathToFile = new Map(deletedRemoteFiles.map(f => [f.path, f]))
    const fileObjects = filesToDelete.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    try {
      await executeCommand('delete-local', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToDelete.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingDeletedRemote(false)
    }
  }, [selectedDeletedRemoteFiles, deletedRemoteFiles, onRefresh])
  
  // Handler to re-upload orphaned files to server (treats them as new files)
  const handleReuploadOrphanedFiles = useCallback(async () => {
    if (selectedDeletedRemoteFiles.size === 0) return
    
    setIsProcessingDeletedRemote(true)
    const filesToUpload = Array.from(selectedDeletedRemoteFiles)
    setProcessingPaths(prev => new Set([...prev, ...filesToUpload]))
    setSelectedDeletedRemoteFiles(new Set())
    
    const pathToFile = new Map(deletedRemoteFiles.map(f => [f.path, f]))
    const fileObjects = filesToUpload.map(path => pathToFile.get(path)).filter(Boolean) as LocalFile[]
    
    try {
      // Sync command will upload these as new files since they have no pdmData
      await executeCommand('sync', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths(prev => {
        const next = new Set(prev)
        filesToUpload.forEach(p => next.delete(p))
        return next
      })
      setIsProcessingDeletedRemote(false)
    }
  }, [selectedDeletedRemoteFiles, deletedRemoteFiles, onRefresh])

  return (
    <div className="flex flex-col h-full">
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
          
          {selectedAddedCount > 0 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-pdm-border">
              <span className="text-xs text-pdm-fg-muted">{selectedAddedCount} selected</span>
              <div className="flex-1" />
              <button
                onClick={handleCheckinAddedFiles}
                disabled={isProcessingAdded}
                className="btn btn-primary btn-sm text-xs flex items-center gap-1"
              >
                <Upload size={12} />
                Check In
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={isProcessingAdded}
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
                  <AddedFileRow 
                    key={file.path} 
                    file={file}
                    isSelected={selectedAddedFiles.has(file.path)}
                    isBeingProcessed={processingPaths.has(file.path)}
                    onToggleSelect={toggleSelectAdded}
                    onNavigate={navigateToFile}
                  />
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
          
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-pdm-border">
              <span className="text-xs text-pdm-fg-muted">{selectedCount} selected</span>
              <div className="flex-1" />
              <button
                onClick={handleCheckin}
                disabled={isProcessingCheckedOut}
                className="btn btn-primary btn-sm text-xs flex items-center gap-1"
              >
                <ArrowUp size={12} />
                Check In
              </button>
              <button
                onClick={handleDiscardChanges}
                disabled={isProcessingCheckedOut}
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
                <FileRow 
                  key={file.path} 
                  file={file} 
                  isOwn={true}
                  isSelected={selectedFiles.has(file.path)}
                  isBeingProcessed={processingPaths.has(file.path)}
                  onToggleSelect={toggleSelect}
                  onNavigate={navigateToFile}
                />
              ))}
            </div>
          )}
        </div>

        {/* Files checked out by others */}
        {othersCheckedOutFiles.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-pdm-fg-muted uppercase tracking-wide flex items-center gap-2">
                <Lock size={12} className="text-pdm-error" />
                Checked Out by Others ({othersCheckedOutFiles.length})
              </div>
              {isAdmin && othersCheckedOutFiles.length > 0 && (
                <button
                  onClick={allOthersSelected ? selectNoneOthers : selectAllOthers}
                  className="text-xs text-pdm-fg-muted hover:text-pdm-fg transition-colors"
                >
                  {allOthersSelected ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
            
            {isAdmin && selectedOthersCount > 0 && (
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-pdm-border">
                <span className="text-xs text-pdm-fg-muted flex items-center gap-1">
                  <Shield size={10} className="text-pdm-error" />
                  {selectedOthersCount} selected
                </span>
                <div className="flex-1" />
                <button
                  onClick={handleAdminForceRelease}
                  disabled={isProcessingOthers}
                  className="btn btn-sm text-xs flex items-center gap-1 bg-pdm-error hover:bg-pdm-error/80 text-white"
                  title="Immediately release the checkout. User's unsaved changes will be orphaned."
                >
                  <Unlock size={12} />
                  Force Release
                </button>
              </div>
            )}
            
            {isAdmin && selectedOthersCount === 0 && (
              <div className="text-xs text-pdm-fg-muted mb-2 px-2 py-1 bg-pdm-bg/50 rounded flex items-center gap-1">
                <Shield size={10} />
                Admin: Select files to force release checkout
              </div>
            )}
            
            <div className="space-y-1">
              {othersCheckedOutFiles.map(file => (
                <FileRow 
                  key={file.path} 
                  file={file} 
                  isOwn={false} 
                  showAdminSelect={isAdmin}
                  isSelected={selectedOthersFiles.has(file.path)}
                  isBeingProcessed={processingPaths.has(file.path)}
                  onToggleSelect={toggleSelectOthers}
                  onNavigate={navigateToFile}
                />
              ))}
            </div>
          </div>
        )}

        {/* Deleted from Server - files that exist locally but were deleted by another user */}
        {deletedRemoteFiles.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-pdm-fg-muted uppercase tracking-wide flex items-center gap-2">
                <CloudOff size={12} className="text-pdm-error" />
                Deleted from Server ({deletedRemoteFiles.length})
              </div>
              {deletedRemoteFiles.length > 0 && (
                <button
                  onClick={allDeletedRemoteSelected ? selectNoneDeletedRemote : selectAllDeletedRemote}
                  className="text-xs text-pdm-fg-muted hover:text-pdm-fg transition-colors"
                >
                  {allDeletedRemoteSelected ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
            
            {selectedDeletedRemoteCount > 0 && (
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-pdm-border">
                <span className="text-xs text-pdm-fg-muted">{selectedDeletedRemoteCount} selected</span>
                <div className="flex-1" />
                <button
                  onClick={handleReuploadOrphanedFiles}
                  disabled={isProcessingDeletedRemote}
                  className="btn btn-primary btn-sm text-xs flex items-center gap-1"
                  title="Re-upload these files to the server as new files"
                >
                  <Upload size={12} />
                  Re-upload
                </button>
                <button
                  onClick={handleDeleteOrphanedFiles}
                  disabled={isProcessingDeletedRemote}
                  className="btn btn-sm text-xs flex items-center gap-1 bg-pdm-error hover:bg-pdm-error/80 text-white"
                  title="Delete these orphaned local files"
                >
                  <Trash2 size={12} />
                  Delete Local
                </button>
              </div>
            )}
            
            {selectedDeletedRemoteCount === 0 && (
              <div className="text-xs text-pdm-fg-muted mb-2 px-2 py-1 bg-pdm-error/10 border border-pdm-error/20 rounded flex items-center gap-1">
                <AlertTriangle size={10} className="text-pdm-error" />
                Another user deleted these files from the server. Your local copies are orphaned.
              </div>
            )}
            
            <div className="space-y-1">
              {deletedRemoteFiles.map(file => (
                <DeletedRemoteFileRow 
                  key={file.path} 
                  file={file}
                  isSelected={selectedDeletedRemoteFiles.has(file.path)}
                  isBeingProcessed={processingPaths.has(file.path)}
                  onToggleSelect={toggleSelectDeletedRemote}
                  onNavigate={navigateToFile}
                />
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="text-xs text-pdm-fg-muted border-t border-pdm-border pt-4">
          <div className="flex justify-between mb-1">
            <span>Total synced files:</span>
            <span>{syncedFilesCount}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>Total checked out:</span>
            <span>{checkedOutFiles.length}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>New files to sync:</span>
            <span className={addedFiles.length > 0 ? 'text-pdm-success' : ''}>{addedFiles.length}</span>
          </div>
          {deletedRemoteFiles.length > 0 && (
            <div className="flex justify-between">
              <span>Deleted from server:</span>
              <span className="text-pdm-error">{deletedRemoteFiles.length}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
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
            
            <div className="p-4">
              <p className="text-sm text-pdm-fg mb-3">
                Are you sure you want to delete <span className="font-semibold text-pdm-error">{selectedAddedCount}</span> file{selectedAddedCount > 1 ? 's' : ''} from your local vault?
              </p>
              <p className="text-xs text-pdm-fg-muted">
                This will move the files to your Recycle Bin.
              </p>
            </div>
            
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
      
      {/* Force Check-in Confirmation Dialog */}
      {forceCheckinConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-pdm-border">
              <div className="flex items-center gap-2 text-pdm-warning">
                <Monitor size={18} />
                <span className="font-medium">Check In From Different Computer</span>
              </div>
              <button
                onClick={() => setForceCheckinConfirm(null)}
                className="p-1 rounded hover:bg-pdm-bg transition-colors text-pdm-fg-muted hover:text-pdm-fg"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4">
              <p className="text-sm text-pdm-fg mb-3">
                <span className="font-semibold text-pdm-warning">{forceCheckinConfirm.filesOnDifferentMachine.length}</span> file{forceCheckinConfirm.filesOnDifferentMachine.length > 1 ? 's are' : ' is'} checked out on <span className="font-semibold">{forceCheckinConfirm.machineNames.join(', ')}</span>.
              </p>
              <p className="text-sm text-pdm-fg mb-3">
                Checking in from here will discard any unsaved changes on {forceCheckinConfirm.machineNames.length === 1 ? 'that' : 'those'} computer{forceCheckinConfirm.machineNames.length > 1 ? 's' : ''}.
              </p>
              <div className="bg-pdm-warning/10 border border-pdm-warning/30 rounded-lg px-3 py-2 text-xs text-pdm-warning">
                The other computer{forceCheckinConfirm.machineNames.length > 1 ? 's' : ''} will be notified that {forceCheckinConfirm.filesOnDifferentMachine.length > 1 ? 'these files were' : 'this file was'} force checked in.
              </div>
            </div>
            
            <div className="flex justify-end gap-2 px-4 py-3 bg-pdm-bg border-t border-pdm-border">
              <button
                onClick={() => setForceCheckinConfirm(null)}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleForceCheckin}
                className="btn btn-sm bg-pdm-warning hover:bg-pdm-warning/80 text-pdm-bg flex items-center gap-1"
              >
                <ArrowUp size={14} />
                Force Check In
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
