// src/components/context-menu/items/DeleteItems.tsx
import { Trash2, EyeOff, FileX, FolderX, CloudOff } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { executeCommand, getSyncedFilesFromSelection } from '../../../lib/commands'
import type { DialogName } from '../types'
import type { ToastType } from '../../../stores/types'

interface DeleteItemsProps {
  files: LocalFile[]
  contextFiles: LocalFile[]
  syncedFilesInSelection: LocalFile[]
  unsyncedFilesInSelection: LocalFile[]
  cloudOnlyFilesInSelection: LocalFile[]
  anySynced: boolean
  anyUnsynced: boolean
  allCloudOnly: boolean
  isFolder: boolean
  multiSelect: boolean
  folderCount: number
  hasLocalFolders: boolean
  hasFoldersOnServer: boolean
  activeVaultId: string | null | undefined
  userId: string | undefined
  showIgnoreSubmenu: boolean
  submenuPosition: 'right' | 'left'
  handleIgnoreSubmenuEnter: () => void
  handleIgnoreSubmenuLeave: () => void
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  openDialog: (name: DialogName) => void
  setDeleteConfirmFiles: (files: LocalFile[]) => void
  setDeleteServerKeepLocal: (value: boolean) => void
  setDeleteLocalCheckedOutFiles: (files: LocalFile[]) => void
  addIgnorePattern: (vaultId: string, pattern: string) => void
  getIgnorePatterns: (vaultId: string) => string[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  firstFile: LocalFile
}

export function DeleteItems({
  files,
  contextFiles,
  syncedFilesInSelection,
  unsyncedFilesInSelection,
  cloudOnlyFilesInSelection,
  anySynced,
  anyUnsynced,
  allCloudOnly,
  isFolder,
  multiSelect,
  folderCount,
  hasLocalFolders,
  hasFoldersOnServer,
  activeVaultId,
  userId,
  showIgnoreSubmenu,
  submenuPosition,
  handleIgnoreSubmenuEnter,
  handleIgnoreSubmenuLeave,
  onClose,
  onRefresh,
  openDialog,
  setDeleteConfirmFiles,
  setDeleteServerKeepLocal,
  setDeleteLocalCheckedOutFiles,
  addIgnorePattern,
  getIgnorePatterns,
  addToast,
  firstFile
}: DeleteItemsProps) {
  const hasUnsyncedLocalFiles = unsyncedFilesInSelection.length > 0

  const handleDeleteLocal = () => {
    // Get all synced files that will be affected (including from folders)
    const syncedFiles = getSyncedFilesFromSelection(files, contextFiles)
    
    // Check for files checked out by current user
    const checkedOutByMe = syncedFiles.filter(f => f.pdmData?.checked_out_by === userId)
    
    // If there are checked out files, show confirmation dialog
    if (checkedOutByMe.length > 0) {
      setDeleteLocalCheckedOutFiles(checkedOutByMe)
      openDialog('deleteLocalConfirm')
      return
    }
    
    // No checked out files - proceed directly
    onClose()
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }

  const handleDeleteFromServer = (keepLocal: boolean = false) => {
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
    const hasLocalFoldersInContext = contextFiles.some(f => f.isDirectory && f.diffStatus !== 'cloud')
    const hasCloudOnlyFolders = contextFiles.some(f => f.isDirectory && f.diffStatus === 'cloud')
    
    if (uniqueFiles.length === 0 && !hasLocalFoldersInContext) {
      if (hasCloudOnlyFolders) {
        // Empty cloud-only folders - delete directly without confirmation
        onClose()
        executeCommand('delete-server', { files: contextFiles, deleteLocal: !keepLocal }, { onRefresh })
      } else {
        addToast('warning', 'No files to delete from server')
        onClose()
      }
      return
    }
    
    // If only local folders with no server files, delete without confirmation
    if (uniqueFiles.length === 0 && hasLocalFoldersInContext) {
      onClose()
      executeCommand('delete-server', { files: contextFiles, deleteLocal: !keepLocal }, { onRefresh })
      return
    }
    
    // Show confirmation dialog for server files
    setDeleteConfirmFiles(uniqueFiles)
    setDeleteServerKeepLocal(keepLocal)
    openDialog('deleteConfirm')
  }

  // Toggle submenu on click (for touch/trackpad users)
  const handleIgnoreSubmenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Toggle handled by parent
  }

  return (
    <>
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
          <span className="text-xs text-plm-fg-muted ml-auto">{submenuPosition === 'right' ? '▶' : '◀'}</span>
          
          {/* Submenu */}
          {showIgnoreSubmenu && (
            <div 
              className={`absolute top-0 min-w-[200px] bg-plm-bg-lighter border border-plm-border rounded-md py-1 shadow-lg z-[100] ${
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
                      <div className="px-3 py-1.5 text-xs text-plm-fg-muted">
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
          Remove Local Copy ({syncedFilesInSelection.length} file{syncedFilesInSelection.length !== 1 ? 's' : ''})
        </div>
      )}
      
      {/* Delete Locally - for local files/folders (keeps server copy) */}
      {(hasUnsyncedLocalFiles || hasLocalFolders) && !allCloudOnly && !anySynced && (
        <div className="context-menu-item danger" onClick={handleDeleteLocal}>
          <Trash2 size={14} />
          Delete Locally ({unsyncedFilesInSelection.length} file{unsyncedFilesInSelection.length !== 1 ? 's' : ''}{folderCount > 0 ? `, ${folderCount} folder${folderCount !== 1 ? 's' : ''}` : ''})
        </div>
      )}
      
      {/* Delete from Server (Keep Local) - for synced files that have local copies */}
      {anySynced && !allCloudOnly && (
        <div className="context-menu-item" onClick={() => handleDeleteFromServer(true)}>
          <CloudOff size={14} />
          Delete from Server ({syncedFilesInSelection.length} file{syncedFilesInSelection.length !== 1 ? 's' : ''})
        </div>
      )}
      
      {/* Delete Local & Server - show if any content exists on server (synced, cloud-only, or folder exists on server) */}
      {(anySynced || allCloudOnly || contextFiles.some(f => f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new') || hasFoldersOnServer) && (
        <div className="context-menu-item danger" onClick={() => handleDeleteFromServer(false)}>
          <Trash2 size={14} />
          {allCloudOnly ? 'Delete from Server' : 'Delete Local & Server'} ({syncedFilesInSelection.length + cloudOnlyFilesInSelection.length} file{(syncedFilesInSelection.length + cloudOnlyFilesInSelection.length) !== 1 ? 's' : ''}{folderCount > 0 ? `, ${folderCount} folder${folderCount !== 1 ? 's' : ''}` : ''})
        </div>
      )}
    </>
  )
}
