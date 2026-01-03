// src/components/context-menu/items/PDMItems.tsx
import { ArrowDown, ArrowUp, Undo2, RefreshCw } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { executeCommand, getSyncedFilesFromSelection } from '../../../lib/commands'
import { SW_EXTENSIONS } from '../constants'

interface PDMItemsProps {
  files: LocalFile[]
  contextFiles: LocalFile[]
  syncedFilesInSelection: LocalFile[]
  unsyncedFilesInSelection: LocalFile[]
  anySynced: boolean
  anyUnsynced: boolean
  anyCloudOnly: boolean
  allCloudOnly: boolean
  allCheckedOut: boolean
  allCheckedIn: boolean
  checkoutableCount: number
  checkinableCount: number
  discardableCount: number
  allFolders: boolean
  multiSelect: boolean
  countLabel: string
  cloudOnlyCount: number
  userId: string | undefined
  checkForDifferentMachineCheckout: (files: LocalFile[]) => Promise<boolean>
  onClose: () => void
  onRefresh: (silent?: boolean) => void
}

export function PDMItems({
  files,
  contextFiles,
  syncedFilesInSelection,
  unsyncedFilesInSelection,
  anySynced,
  anyUnsynced,
  anyCloudOnly,
  allCloudOnly,
  allCheckedOut,
  allCheckedIn,
  checkoutableCount,
  checkinableCount,
  discardableCount,
  allFolders,
  multiSelect,
  countLabel,
  cloudOnlyCount,
  userId,
  checkForDifferentMachineCheckout,
  onClose,
  onRefresh
}: PDMItemsProps) {
  const handleCheckout = () => {
    onClose()
    executeCommand('checkout', { files: contextFiles }, { onRefresh })
  }

  const handleCheckin = async () => {
    // Get files that would be checked in
    const syncedFiles = getSyncedFilesFromSelection(files, contextFiles)
    const filesToCheckin = syncedFiles.filter(f => f.pdmData?.checked_out_by === userId)
    
    // Check if any files are checked out on a different machine
    const hasDifferentMachineCheckout = await checkForDifferentMachineCheckout(filesToCheckin)
    if (hasDifferentMachineCheckout) return
    
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

  const handleDiscardCheckout = () => {
    onClose()
    executeCommand('discard', { files: contextFiles }, { onRefresh })
  }

  const handleSyncSwMetadata = () => {
    onClose()
    executeCommand('sync-sw-metadata', { files: contextFiles }, { onRefresh })
  }

  // Get synced SolidWorks files (works for both files and folders)
  const syncedSolidWorksFiles = syncedFilesInSelection.filter(f => 
    SW_EXTENSIONS.includes(f.extension.toLowerCase())
  )

  return (
    <>
      {/* Download - for cloud-only files - show at TOP for cloud folders */}
      {anyCloudOnly && (
        <div className="context-menu-item" onClick={handleDownload}>
          <ArrowDown size={14} className="text-plm-success" />
          Download {cloudOnlyCount > 0 ? `${cloudOnlyCount} files` : countLabel}
        </div>
      )}

      <div className="context-menu-separator" />

      {/* First Check In - for unsynced files */}
      {anyUnsynced && !allCloudOnly && (
        <div className="context-menu-item" onClick={handleFirstCheckin}>
          <ArrowUp size={14} className="text-plm-info" />
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
        <ArrowDown size={14} className={!anySynced ? 'text-plm-fg-muted' : 'text-plm-warning'} />
        Check Out {allFolders && !multiSelect && checkoutableCount > 0 ? `${checkoutableCount} files` : countLabel}
        {!anySynced && <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>}
        {anySynced && allCheckedOut && <span className="text-xs text-plm-fg-muted ml-auto">(already out)</span>}
      </div>

      {/* Check In - only for synced files that exist locally (not 'deleted') */}
      {anySynced && (
        <div 
          className={`context-menu-item ${allCheckedIn || checkinableCount === 0 ? 'disabled' : ''}`}
          onClick={() => {
            if (allCheckedIn || checkinableCount === 0) return
            handleCheckin()
          }}
          title={allCheckedIn ? 'Already checked in' : checkinableCount === 0 ? 'No files checked out by you' : ''}
        >
          <ArrowUp size={14} className={allCheckedIn || checkinableCount === 0 ? 'text-plm-fg-muted' : 'text-plm-success'} />
          Check In {allFolders && !multiSelect && checkinableCount > 0 ? `${checkinableCount} files` : countLabel}
          {allCheckedIn && <span className="text-xs text-plm-fg-muted ml-auto">(already in)</span>}
        </div>
      )}

      {/* Discard Checkout - for files checked out by current user */}
      {discardableCount > 0 && (
        <div 
          className="context-menu-item text-plm-warning"
          onClick={handleDiscardCheckout}
          title="Discard local changes and revert to server version"
        >
          <Undo2 size={14} />
          Discard Checkout {discardableCount > 1 ? `(${discardableCount})` : ''}
        </div>
      )}

      {/* Sync SolidWorks Metadata - for synced SW files (works for folders too) */}
      {syncedSolidWorksFiles.length > 0 && (
        <div 
          className="context-menu-item"
          onClick={handleSyncSwMetadata}
          title="Extract metadata (part number, description, revision) from SolidWorks file properties and update the database"
        >
          <RefreshCw size={14} className="text-plm-accent" />
          Refresh Metadata {syncedSolidWorksFiles.length > 1 ? `(${syncedSolidWorksFiles.length} files)` : ''}
        </div>
      )}
    </>
  )
}
