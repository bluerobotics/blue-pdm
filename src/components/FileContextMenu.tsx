import { 
  Trash2, 
  Copy, 
  Scissors, 
  ClipboardPaste,
  FolderOpen,
  ExternalLink,
  ArrowDown,
  ArrowUp,
  Edit,
  FolderPlus,
  Pin,
  History,
  Info,
  EyeOff,
  FileX,
  FolderX,
  Unlock,
  AlertTriangle,
  File
} from 'lucide-react'
import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
// Import command system instead of individual supabase functions
import { 
  executeCommand,
  getSyncedFilesFromSelection,
  getUnsyncedFilesFromSelection,
  getCloudOnlyFilesFromSelection,
  getFilesInFolder
} from '../lib/commands'

interface FileContextMenuProps {
  x: number
  y: number
  files: LocalFile[]  // All files in the vault
  contextFiles: LocalFile[]  // Files being right-clicked
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  // Optional handlers for clipboard operations
  clipboard?: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
  onRename?: (file: LocalFile) => void
  onNewFolder?: () => void
}

export function FileContextMenu({
  x,
  y,
  files,
  contextFiles,
  onClose,
  onRefresh,
  clipboard,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onNewFolder
}: FileContextMenuProps) {
  const { user, activeVaultId, addToast, pinnedFolders, pinFolder, unpinFolder, connectedVaults, addIgnorePattern, getIgnorePatterns, serverFolderPaths } = usePDMStore()
  
  const [showProperties, setShowProperties] = useState(false)
  const [folderSize, setFolderSize] = useState<{ size: number; fileCount: number; folderCount: number } | null>(null)
  const [isCalculatingSize, setIsCalculatingSize] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmFiles, setDeleteConfirmFiles] = useState<LocalFile[]>([])
  const [showDeleteLocalConfirm, setShowDeleteLocalConfirm] = useState(false)
  const [deleteLocalCheckedOutFiles, setDeleteLocalCheckedOutFiles] = useState<LocalFile[]>([])
  const [platform, setPlatform] = useState<string>('win32')
  const [showIgnoreSubmenu, setShowIgnoreSubmenu] = useState(false)
  const ignoreSubmenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // For positioning the menu within viewport bounds
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y })
  const [submenuPosition, setSubmenuPosition] = useState<'right' | 'left'>('right')
  
  // Handle submenu hover with delay to prevent accidental closing
  const handleIgnoreSubmenuEnter = () => {
    if (ignoreSubmenuTimeoutRef.current) {
      clearTimeout(ignoreSubmenuTimeoutRef.current)
      ignoreSubmenuTimeoutRef.current = null
    }
    setShowIgnoreSubmenu(true)
  }
  
  const handleIgnoreSubmenuLeave = () => {
    ignoreSubmenuTimeoutRef.current = setTimeout(() => {
      setShowIgnoreSubmenu(false)
    }, 150) // Small delay to allow moving to submenu
  }
  
  // Toggle submenu on click (for touch/trackpad users)
  const handleIgnoreSubmenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowIgnoreSubmenu(prev => !prev)
  }
  
  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])
  
  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (ignoreSubmenuTimeoutRef.current) {
        clearTimeout(ignoreSubmenuTimeoutRef.current)
      }
    }
  }, [])
  
  // Adjust menu position to stay within viewport
  useLayoutEffect(() => {
    if (!menuRef.current) return
    
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    let newX = x
    let newY = y
    
    // Check right overflow
    if (x + rect.width > viewportWidth - 10) {
      newX = viewportWidth - rect.width - 10
    }
    
    // Check bottom overflow
    if (y + rect.height > viewportHeight - 10) {
      newY = viewportHeight - rect.height - 10
    }
    
    // Ensure minimum position
    newX = Math.max(10, newX)
    newY = Math.max(10, newY)
    
    setAdjustedPosition({ x: newX, y: newY })
    
    // Determine submenu position based on available space
    const spaceOnRight = viewportWidth - (newX + rect.width)
    const submenuWidth = 220 // approximate submenu width
    setSubmenuPosition(spaceOnRight >= submenuWidth ? 'right' : 'left')
  }, [x, y])
  
  if (contextFiles.length === 0) return null
  
  // Get current vault name for pinning
  const currentVault = connectedVaults.find(v => v.id === activeVaultId)
  const currentVaultName = currentVault?.name || 'Vault'
  
  const multiSelect = contextFiles.length > 1
  const firstFile = contextFiles[0]
  const isFolder = firstFile.isDirectory
  const allFolders = contextFiles.every(f => f.isDirectory)
  const fileCount = contextFiles.filter(f => !f.isDirectory).length
  const folderCount = contextFiles.filter(f => f.isDirectory).length
  
  // Use command system helpers for file categorization
  const syncedFilesInSelection = getSyncedFilesFromSelection(files, contextFiles)
  const unsyncedFilesInSelection = getUnsyncedFilesFromSelection(files, contextFiles)
  const cloudOnlyFilesInSelection = getCloudOnlyFilesFromSelection(files, contextFiles)
  
  const anySynced = syncedFilesInSelection.length > 0
  const anyUnsynced = unsyncedFilesInSelection.length > 0
  const anyCloudOnly = cloudOnlyFilesInSelection.length > 0 || contextFiles.some(f => f.diffStatus === 'cloud')
  
  // Check out/in status
  const allCheckedOut = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by)
  const allCheckedIn = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => !f.pdmData?.checked_out_by)
  
  // Count files that can be checked out/in
  const checkoutableCount = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by).length
  const checkinableCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user?.id).length
  const checkedOutByOthersCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id).length
  const isAdmin = user?.role === 'admin'
  
  const countLabel = multiSelect 
    ? `(${fileCount > 0 ? `${fileCount} file${fileCount > 1 ? 's' : ''}` : ''}${fileCount > 0 && folderCount > 0 ? ', ' : ''}${folderCount > 0 ? `${folderCount} folder${folderCount > 1 ? 's' : ''}` : ''})`
    : ''
  
  // Check for cloud-only files
  const allCloudOnly = contextFiles.every(f => f.diffStatus === 'cloud')
  const hasUnsyncedLocalFiles = unsyncedFilesInSelection.length > 0
  const cloudOnlyCount = cloudOnlyFilesInSelection.length
  
  // Check for empty local folders (folders that exist locally but have no files to sync/delete)
  // These can be deleted locally even if there are no unsynced files
  const hasLocalFolders = contextFiles.some(f => f.isDirectory && f.diffStatus !== 'cloud')
  
  // Check if any selected folders exist on server (for showing delete from server option)
  const hasFoldersOnServer = contextFiles.some(f => {
    if (!f.isDirectory) return false
    const normalizedPath = f.relativePath.replace(/\\/g, '/')
    return serverFolderPaths.has(normalizedPath)
  })
  
  // ============================================
  // Command-based handlers (much cleaner!)
  // ============================================
  
  const handleOpen = () => {
    onClose()
    executeCommand('open', { file: firstFile }, { onRefresh })
  }
  
  const handleShowInExplorer = () => {
    onClose()
    executeCommand('show-in-explorer', { path: firstFile.path }, { onRefresh })
  }
  
  const handleCheckout = () => {
    onClose()
    executeCommand('checkout', { files: contextFiles }, { onRefresh })
  }
  
  const handleCheckin = () => {
    onClose()
    executeCommand('checkin', { files: contextFiles }, { onRefresh })
  }
  
  const handleFirstCheckin = () => {
    onClose()
    executeCommand('sync', { files: contextFiles }, { onRefresh })
  }
  
  const handleDownload = () => {
    onClose()
    executeCommand('download', { files: contextFiles }, { onRefresh })
  }
  
  const handleDeleteLocal = () => {
    // Get all synced files that will be affected (including from folders)
    const syncedFiles = getSyncedFilesFromSelection(files, contextFiles)
    
    // Check for files checked out by current user
    const checkedOutByMe = syncedFiles.filter(f => f.pdmData?.checked_out_by === user?.id)
    
    // If there are checked out files, show confirmation dialog
    if (checkedOutByMe.length > 0) {
      setDeleteLocalCheckedOutFiles(checkedOutByMe)
      setShowDeleteLocalConfirm(true)
      return
    }
    
    // No checked out files - proceed directly
    onClose()
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }
  
  // Check in files first, then delete local
  const handleCheckinThenDeleteLocal = async () => {
    setShowDeleteLocalConfirm(false)
    onClose()
    // First check in all checked out files
    await executeCommand('checkin', { files: contextFiles }, { onRefresh })
    // Then delete local copies
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }
  
  // Discard checkouts and delete local copies
  const handleDiscardAndDeleteLocal = () => {
    setShowDeleteLocalConfirm(false)
    onClose()
    // The delete-local command will release checkouts automatically
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }
  
  const handleForceRelease = () => {
    onClose()
    executeCommand('force-release', { files: contextFiles }, { onRefresh })
  }
  
  // Handle delete from server (shows confirmation dialog first)
  const handleDeleteFromServer = () => {
    // Get all synced files to delete from server (including files inside folders)
    const allFilesToDelete: LocalFile[] = []
    
    for (const item of contextFiles) {
      if (item.isDirectory) {
        const folderPath = item.relativePath.replace(/\\/g, '/')
        const filesInFolder = files.filter(f => {
          if (f.isDirectory) return false
          if (!f.pdmData?.id) return false
          const filePath = f.relativePath.replace(/\\/g, '/')
          return filePath.startsWith(folderPath + '/')
        })
        allFilesToDelete.push(...filesInFolder)
      } else if (item.pdmData?.id) {
        allFilesToDelete.push(item)
      }
    }
    
    // Remove duplicates
    const uniqueFiles = [...new Map(allFilesToDelete.map(f => [f.path, f])).values()]
    
    // Check for local-only folders
    const hasLocalFolders = contextFiles.some(f => f.isDirectory && f.diffStatus !== 'cloud')
    const hasCloudOnlyFolders = contextFiles.some(f => f.isDirectory && f.diffStatus === 'cloud')
    
    if (uniqueFiles.length === 0 && !hasLocalFolders) {
      if (hasCloudOnlyFolders) {
        // Empty cloud-only folders - delete directly without confirmation
        onClose()
        executeCommand('delete-server', { files: contextFiles, deleteLocal: true }, { onRefresh })
      } else {
        addToast('warning', 'No files to delete from server')
        onClose()
      }
      return
    }
    
    // If only local folders with no server files, delete without confirmation
    if (uniqueFiles.length === 0 && hasLocalFolders) {
      onClose()
      executeCommand('delete-server', { files: contextFiles, deleteLocal: true }, { onRefresh })
      return
    }
    
    // Show confirmation dialog for server files
    setDeleteConfirmFiles(uniqueFiles)
    setShowDeleteConfirm(true)
  }
  
  // Execute server delete after confirmation
  const executeDeleteFromServer = () => {
    setShowDeleteConfirm(false)
    setDeleteConfirmFiles([])
    onClose()
    executeCommand('delete-server', { files: contextFiles, deleteLocal: true }, { onRefresh })
  }

  return (
    <>
      <div 
        className="fixed inset-0 z-50" 
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div 
        ref={menuRef}
        className="context-menu z-[60]"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        {/* Download - for cloud-only files - show at TOP for cloud folders */}
        {anyCloudOnly && (
          <div className="context-menu-item" onClick={handleDownload}>
            <ArrowDown size={14} className="text-pdm-success" />
            Download {cloudOnlyCount > 0 ? `${cloudOnlyCount} files` : countLabel}
          </div>
        )}
        
        {/* Open - only for local files/folders (not cloud-only) */}
        {!multiSelect && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleOpen}>
            <ExternalLink size={14} />
            {isFolder ? 'Open Folder' : 'Open'}
          </div>
        )}
        
        {/* Show in Explorer/Finder */}
        {!allCloudOnly && (
          <div className="context-menu-item" onClick={handleShowInExplorer}>
            <FolderOpen size={14} />
            {platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer'}
          </div>
        )}
        
        {/* Pin/Unpin - for files and folders */}
        {!multiSelect && activeVaultId && (
          (() => {
            const isPinned = pinnedFolders.some(p => p.path === firstFile.relativePath && p.vaultId === activeVaultId)
            return (
              <div 
                className="context-menu-item"
                onClick={() => {
                  if (isPinned) {
                    unpinFolder(firstFile.relativePath)
                    addToast('info', `Unpinned ${firstFile.name}`)
                  } else {
                    pinFolder(firstFile.relativePath, activeVaultId, currentVaultName, firstFile.isDirectory)
                    addToast('success', `Pinned ${firstFile.name}`)
                  }
                  onClose()
                }}
              >
                <Pin size={14} className={isPinned ? 'fill-pdm-accent text-pdm-accent' : ''} />
                {isPinned ? 'Unpin' : `Pin ${isFolder ? 'Folder' : 'File'}`}
              </div>
            )
          })()
        )}
        
        {/* Rename - right after pin */}
        {onRename && !multiSelect && !allCloudOnly && (
          (() => {
            const isSynced = !!firstFile.pdmData
            const isCheckedOutByMe = firstFile.pdmData?.checked_out_by === user?.id
            const canRename = !isSynced || isCheckedOutByMe
            
            return (
              <div 
                className={`context-menu-item ${!canRename ? 'disabled' : ''}`}
                onClick={() => { 
                  if (canRename) {
                    onRename(firstFile)
                    onClose()
                  }
                }}
                title={!canRename ? 'Check out file first to rename' : ''}
              >
                <Edit size={14} />
                Rename
                <span className="text-xs text-pdm-fg-muted ml-auto">
                  {!canRename ? '(checkout required)' : 'F2'}
                </span>
              </div>
            )
          })()
        )}
        
        {/* Clipboard operations */}
        {(onCopy || onCut || onPaste) && (
          <>
            <div className="context-menu-separator" />
            {onCopy && (
              <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>
                <Copy size={14} />
                Copy
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+C</span>
              </div>
            )}
            {onCut && (() => {
              const canCut = contextFiles.every(f => 
                f.isDirectory || 
                !f.pdmData || 
                f.pdmData.checked_out_by === user?.id
              )
              return (
                <div 
                  className={`context-menu-item ${!canCut ? 'disabled' : ''}`}
                  onClick={() => { if (canCut) { onCut(); onClose(); } }}
                  title={!canCut ? 'Check out files first to move them' : undefined}
                >
                  <Scissors size={14} />
                  Cut
                  <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+X</span>
                </div>
              )
            })()}
            {onPaste && (
              <div 
                className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
                onClick={() => { if (clipboard) { onPaste(); onClose(); } }}
              >
                <ClipboardPaste size={14} />
                Paste
                <span className="text-xs text-pdm-fg-muted ml-auto">Ctrl+V</span>
              </div>
            )}
          </>
        )}
        
        {/* New Folder */}
        {onNewFolder && isFolder && !multiSelect && !allCloudOnly && (
          <>
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => { onNewFolder(); onClose(); }}>
              <FolderPlus size={14} />
              New Folder
            </div>
          </>
        )}
        
        <div className="context-menu-separator" />
        
        {/* First Check In - for unsynced files */}
        {anyUnsynced && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleFirstCheckin}>
            <ArrowUp size={14} className="text-pdm-success" />
            First Check In {unsyncedFilesInSelection.length > 0 ? `${unsyncedFilesInSelection.length} file${unsyncedFilesInSelection.length !== 1 ? 's' : ''}` : countLabel}
          </div>
        )}
        
        {/* Check Out */}
        <div 
          className={`context-menu-item ${!anySynced || allCheckedOut ? 'disabled' : ''}`}
          onClick={() => {
            if (!anySynced || allCheckedOut) return
            handleCheckout()
          }}
          title={!anySynced ? 'Download files first to enable checkout' : allCheckedOut ? 'Already checked out' : ''}
        >
          <ArrowDown size={14} className={!anySynced ? 'text-pdm-fg-muted' : 'text-pdm-warning'} />
          Check Out {allFolders && !multiSelect && checkoutableCount > 0 ? `${checkoutableCount} files` : countLabel}
          {!anySynced && <span className="text-xs text-pdm-fg-muted ml-auto">(download first)</span>}
          {anySynced && allCheckedOut && <span className="text-xs text-pdm-fg-muted ml-auto">(already out)</span>}
        </div>
        
        {/* Check In */}
        {anySynced && (
          <div 
            className={`context-menu-item ${allCheckedIn || checkinableCount === 0 ? 'disabled' : ''}`}
            onClick={() => {
              if (allCheckedIn || checkinableCount === 0) return
              handleCheckin()
            }}
            title={allCheckedIn ? 'Already checked in' : checkinableCount === 0 ? 'No files checked out by you' : ''}
          >
            <ArrowUp size={14} className={allCheckedIn || checkinableCount === 0 ? 'text-pdm-fg-muted' : 'text-pdm-success'} />
            Check In {allFolders && !multiSelect && checkinableCount > 0 ? `${checkinableCount} files` : countLabel}
            {allCheckedIn && <span className="text-xs text-pdm-fg-muted ml-auto">(already in)</span>}
          </div>
        )}
        
        {/* Admin: Force Release */}
        {isAdmin && checkedOutByOthersCount > 0 && (
          <div 
            className="context-menu-item text-pdm-error"
            onClick={handleForceRelease}
            title="Admin: Immediately release checkout. User's unsaved changes will be orphaned."
          >
            <Unlock size={14} />
            Force Release {checkedOutByOthersCount > 1 ? `(${checkedOutByOthersCount})` : ''}
          </div>
        )}
        
        <div className="context-menu-separator" />
        
        {/* Show History - for folders */}
        {!multiSelect && isFolder && (
          <div 
            className="context-menu-item"
            onClick={() => {
              const { setDetailsPanelTab, detailsPanelVisible, toggleDetailsPanel } = usePDMStore.getState()
              setDetailsPanelTab('history')
              if (!detailsPanelVisible) toggleDetailsPanel()
              onClose()
            }}
          >
            <History size={14} />
            Show History
          </div>
        )}
        
        {/* Show Deleted Files - for folders */}
        {!multiSelect && isFolder && (
          <div 
            className="context-menu-item"
            onClick={() => {
              const { setActiveView, setTrashFolderFilter } = usePDMStore.getState()
              setTrashFolderFilter(firstFile.relativePath)
              setActiveView('trash')
              onClose()
            }}
          >
            <Trash2 size={14} />
            Show Deleted Files
          </div>
        )}
        
        {/* Properties */}
        <div 
          className="context-menu-item"
          onClick={async () => {
            if (isFolder && !multiSelect) {
              setIsCalculatingSize(true)
              setShowProperties(true)
              const filesInFolder = getFilesInFolder(files, firstFile.relativePath)
              const foldersInFolder = files.filter(f => 
                f.isDirectory && 
                f.relativePath.replace(/\\/g, '/').startsWith(firstFile.relativePath.replace(/\\/g, '/') + '/') && 
                f.relativePath !== firstFile.relativePath
              )
              let totalSize = 0
              for (const f of filesInFolder) {
                totalSize += f.size || 0
              }
              setFolderSize({
                size: totalSize,
                fileCount: filesInFolder.length,
                folderCount: foldersInFolder.length
              })
              setIsCalculatingSize(false)
            } else {
              setShowProperties(true)
            }
          }}
        >
          <Info size={14} />
          Properties
        </div>
        
        <div className="context-menu-separator" />
        
        {/* Keep Local Only (Ignore) - for unsynced files and folders */}
        {anyUnsynced && !allCloudOnly && activeVaultId && (
          <div 
            className="context-menu-item relative"
            onMouseEnter={handleIgnoreSubmenuEnter}
            onMouseLeave={handleIgnoreSubmenuLeave}
            onClick={handleIgnoreSubmenuClick}
          >
            <EyeOff size={14} />
            Keep Local Only
            <span className="text-xs text-pdm-fg-muted ml-auto">{submenuPosition === 'right' ? '▶' : '◀'}</span>
            
            {/* Submenu */}
            {showIgnoreSubmenu && (
              <div 
                className={`absolute top-0 min-w-[200px] bg-pdm-bg-lighter border border-pdm-border rounded-md py-1 shadow-lg z-[100] ${
                  submenuPosition === 'right' ? 'left-full ml-1' : 'right-full mr-1'
                }`}
                style={{ marginTop: '-4px' }}
                onMouseEnter={handleIgnoreSubmenuEnter}
                onMouseLeave={handleIgnoreSubmenuLeave}
              >
                {/* Ignore this specific file/folder */}
                <div 
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    for (const file of contextFiles) {
                      if (file.isDirectory) {
                        addIgnorePattern(activeVaultId, file.relativePath + '/')
                      } else {
                        addIgnorePattern(activeVaultId, file.relativePath)
                      }
                    }
                    addToast('success', `Added ${contextFiles.length > 1 ? `${contextFiles.length} items` : contextFiles[0].name} to ignore list`)
                    onRefresh(true)
                    onClose()
                  }}
                >
                  {isFolder ? <FolderX size={14} /> : <FileX size={14} />}
                  This {isFolder ? 'folder' : 'file'}{multiSelect ? ` (${contextFiles.length})` : ''}
                </div>
                
                {/* Ignore all files with this extension */}
                {!isFolder && !multiSelect && firstFile.extension && (
                  <div 
                    className="context-menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      const pattern = `*${firstFile.extension}`
                      addIgnorePattern(activeVaultId, pattern)
                      addToast('success', `Now ignoring all ${firstFile.extension} files`)
                      onRefresh(true)
                      onClose()
                    }}
                  >
                    <FileX size={14} />
                    All *{firstFile.extension} files
                  </div>
                )}
                
                {/* Show current patterns count */}
                {(() => {
                  const currentPatterns = getIgnorePatterns(activeVaultId)
                  if (currentPatterns.length > 0) {
                    return (
                      <>
                        <div className="context-menu-separator" />
                        <div className="px-3 py-1.5 text-xs text-pdm-fg-muted">
                          {currentPatterns.length} pattern{currentPatterns.length > 1 ? 's' : ''} configured
                        </div>
                      </>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </div>
        )}
        
        {/* Remove Local Copy - for synced files */}
        {anySynced && !allCloudOnly && (
          <div className="context-menu-item" onClick={handleDeleteLocal}>
            <Trash2 size={14} />
            Remove Local Copy {countLabel}
          </div>
        )}
        
        {/* Delete Locally - for local files/folders (keeps server copy) */}
        {(hasUnsyncedLocalFiles || hasLocalFolders) && !allCloudOnly && (
          <div className="context-menu-item danger" onClick={handleDeleteLocal}>
            <Trash2 size={14} />
            Delete Locally {countLabel}
          </div>
        )}
        
        {/* Delete from Server - show if any content exists on server (synced, cloud-only, or folder exists on server) */}
        {(anySynced || allCloudOnly || anyCloudOnly || hasFoldersOnServer) && (
          <div className="context-menu-item danger" onClick={handleDeleteFromServer}>
            <Trash2 size={14} />
            {allCloudOnly ? 'Delete from Server' : 'Delete Local & Server'} {countLabel}
          </div>
        )}
      </div>
      
      {/* Properties Modal */}
      {showProperties && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowProperties(false); onClose(); }} />
          <div className="relative bg-pdm-bg-light border border-pdm-border rounded-lg shadow-2xl w-[400px] max-h-[80vh] overflow-auto">
            <div className="p-4 border-b border-pdm-border flex items-center gap-3">
              <Info size={20} className="text-pdm-accent" />
              <h3 className="font-semibold">Properties</h3>
            </div>
            <div className="p-4 space-y-3">
              {/* Name */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Name</div>
                <div className="text-sm">{firstFile.name}</div>
              </div>
              
              {/* Type */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Type</div>
                <div className="text-sm">
                  {isFolder ? 'Folder' : (firstFile.extension ? firstFile.extension.toUpperCase() + ' File' : 'File')}
                </div>
              </div>
              
              {/* Location */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Location</div>
                <div className="text-sm break-all text-pdm-fg-dim">
                  {firstFile.relativePath.includes('/') 
                    ? firstFile.relativePath.substring(0, firstFile.relativePath.lastIndexOf('/'))
                    : '/'}
                </div>
              </div>
              
              {/* Size */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Size</div>
                <div className="text-sm">
                  {isFolder && !multiSelect ? (
                    isCalculatingSize ? (
                      <span className="text-pdm-fg-muted">Calculating...</span>
                    ) : folderSize ? (
                      <span>
                        {formatSize(folderSize.size)}
                        <span className="text-pdm-fg-muted ml-2">
                          ({folderSize.fileCount} file{folderSize.fileCount !== 1 ? 's' : ''}, {folderSize.folderCount} folder{folderSize.folderCount !== 1 ? 's' : ''})
                        </span>
                      </span>
                    ) : '—'
                  ) : multiSelect ? (
                    formatSize(contextFiles.reduce((sum, f) => sum + (f.size || 0), 0))
                  ) : (
                    formatSize(firstFile.size || 0)
                  )}
                </div>
              </div>
              
              {/* Status */}
              {firstFile.pdmData && (
                <div>
                  <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Status</div>
                  <div className="text-sm">
                    {firstFile.pdmData.checked_out_by 
                      ? firstFile.pdmData.checked_out_by === user?.id 
                        ? 'Checked out by you'
                        : 'Checked out'
                      : 'Available'}
                  </div>
                </div>
              )}
              
              {/* Sync Status */}
              <div>
                <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Sync Status</div>
                <div className="text-sm">
                  {firstFile.diffStatus === 'cloud' ? 'Cloud only (not downloaded)' 
                    : firstFile.diffStatus === 'added' ? 'Local only (not synced)'
                    : firstFile.diffStatus === 'ignored' ? 'Local only (ignored from sync)'
                    : firstFile.diffStatus === 'modified' ? 'Modified locally'
                    : firstFile.diffStatus === 'moved' ? 'Moved (path changed)'
                    : firstFile.diffStatus === 'outdated' ? 'Outdated (newer version on server)'
                    : firstFile.pdmData ? 'Synced' : 'Not synced'}
                </div>
              </div>
              
              {/* Modified Date */}
              {firstFile.modifiedTime && (
                <div>
                  <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-1">Modified</div>
                  <div className="text-sm">{new Date(firstFile.modifiedTime).toLocaleString()}</div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-pdm-border flex justify-end">
              <button
                onClick={() => { setShowProperties(false); onClose(); }}
                className="btn btn-ghost"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete from Server Confirmation Dialog */}
      {showDeleteConfirm && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowDeleteConfirm(false); onClose(); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-error/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-pdm-error" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Delete Local & Server {deleteConfirmFiles.length > 1 ? `${deleteConfirmFiles.length} Items` : 'Item'}?
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  Items will be deleted locally AND from the server.
                </p>
              </div>
            </div>
            
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4 max-h-40 overflow-y-auto">
              {deleteConfirmFiles.length === 1 ? (
                <div className="flex items-center gap-2">
                  <File size={16} className="text-pdm-fg-muted" />
                  <span className="text-pdm-fg font-medium truncate">{deleteConfirmFiles[0]?.name}</span>
                </div>
              ) : (
                <>
                  <div className="text-sm text-pdm-fg mb-2">
                    {deleteConfirmFiles.length} file{deleteConfirmFiles.length > 1 ? 's' : ''}
                  </div>
                  <div className="space-y-1">
                    {deleteConfirmFiles.slice(0, 5).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <File size={14} className="text-pdm-fg-muted" />
                        <span className="text-pdm-fg-dim truncate">{f.name}</span>
                      </div>
                    ))}
                    {deleteConfirmFiles.length > 5 && (
                      <div className="text-xs text-pdm-fg-muted">
                        ...and {deleteConfirmFiles.length - 5} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Warning */}
            <div className="bg-pdm-warning/10 border border-pdm-warning/30 rounded p-3 mb-4">
              <p className="text-sm text-pdm-warning font-medium">
                ⚠️ {deleteConfirmFiles.length} synced file{deleteConfirmFiles.length > 1 ? 's' : ''} will be deleted from the server.
              </p>
              <p className="text-xs text-pdm-fg-muted mt-1">Files can be recovered from trash within 30 days.</p>
            </div>
            
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); onClose(); }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteFromServer}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white"
              >
                <Trash2 size={14} />
                Delete Local & Server {deleteConfirmFiles.length > 1 ? `(${deleteConfirmFiles.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Local Confirmation Dialog - only when files are checked out */}
      {showDeleteLocalConfirm && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowDeleteLocalConfirm(false); onClose(); }}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-pdm-warning/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-pdm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-pdm-fg">
                  Files Are Checked Out
                </h3>
                <p className="text-sm text-pdm-fg-muted">
                  {deleteLocalCheckedOutFiles.length} file{deleteLocalCheckedOutFiles.length > 1 ? 's are' : ' is'} currently checked out by you.
                </p>
              </div>
            </div>
            
            <div className="bg-pdm-bg rounded border border-pdm-border p-3 mb-4 max-h-40 overflow-y-auto">
              <div className="space-y-1">
                {deleteLocalCheckedOutFiles.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <File size={14} className="text-pdm-warning" />
                    <span className="text-pdm-fg truncate">{f.name}</span>
                  </div>
                ))}
                {deleteLocalCheckedOutFiles.length > 5 && (
                  <div className="text-xs text-pdm-fg-muted">
                    ...and {deleteLocalCheckedOutFiles.length - 5} more
                  </div>
                )}
              </div>
            </div>
            
            {/* Info */}
            <div className="bg-pdm-accent/10 border border-pdm-accent/30 rounded p-3 mb-4">
              <p className="text-sm text-pdm-fg">
                What would you like to do with your changes?
              </p>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={handleCheckinThenDeleteLocal}
                className="btn bg-pdm-success hover:bg-pdm-success/80 text-white w-full justify-center"
              >
                <ArrowUp size={14} />
                Check In First, Then Remove Local
              </button>
              <button
                onClick={handleDiscardAndDeleteLocal}
                className="btn bg-pdm-warning hover:bg-pdm-warning/80 text-white w-full justify-center"
              >
                <Trash2 size={14} />
                Discard Changes & Remove Local
              </button>
              <button
                onClick={() => { setShowDeleteLocalConfirm(false); onClose(); }}
                className="btn btn-ghost w-full justify-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Helper function to format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
