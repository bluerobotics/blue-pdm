// src/components/context-menu/items/CollaborationItems.tsx
import { Send, ArrowDown, Users, Eye, EyeOff, Link, ClipboardList, Loader2 } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import type { DialogName } from '../types'
import type { ToastType } from '../../../stores/types'

interface CollaborationItemsProps {
  firstFile: LocalFile
  multiSelect: boolean
  isFolder: boolean
  anySynced: boolean
  userId: string | undefined
  isWatching: boolean
  isTogglingWatch: boolean
  isCreatingShareLink: boolean
  onToggleWatch: () => void
  onQuickShareLink: () => void
  openDialog: (name: DialogName) => void
  onClose: () => void
  addToast: (type: ToastType, message: string, duration?: number) => void
}

export function CollaborationItems({
  firstFile,
  multiSelect,
  isFolder,
  anySynced,
  userId,
  isWatching,
  isTogglingWatch,
  isCreatingShareLink,
  onToggleWatch,
  onQuickShareLink,
  openDialog,
  onClose,
  addToast
}: CollaborationItemsProps) {
  const hasPdmData = firstFile.pdmData?.id
  const isCheckedOutByOther = firstFile.pdmData?.checked_out_by && firstFile.pdmData.checked_out_by !== userId

  return (
    <>
      {/* Request Review - only for synced files (not folders) */}
      {!multiSelect && !isFolder && anySynced && hasPdmData && (
        <div 
          className="context-menu-item"
          onClick={() => openDialog('reviewRequest')}
        >
          <Send size={14} className="text-plm-accent" />
          Request Review
        </div>
      )}

      {/* Request Checkout - for files checked out by others */}
      {!multiSelect && !isFolder && anySynced && isCheckedOutByOther && (
        <div 
          className="context-menu-item"
          onClick={() => openDialog('checkoutRequest')}
        >
          <ArrowDown size={14} className="text-plm-warning" />
          Request Checkout
        </div>
      )}

      {/* Notify / Mention - for synced files */}
      {!multiSelect && !isFolder && anySynced && hasPdmData && (
        <div 
          className="context-menu-item"
          onClick={() => openDialog('mention')}
        >
          <Users size={14} className="text-plm-fg-dim" />
          Notify Someone
        </div>
      )}

      {/* Watch/Unwatch - for synced files */}
      {!multiSelect && !isFolder && anySynced && hasPdmData && (
        <div 
          className={`context-menu-item ${isTogglingWatch ? 'opacity-50' : ''}`}
          onClick={onToggleWatch}
        >
          {isTogglingWatch ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isWatching ? (
            <EyeOff size={14} className="text-plm-fg-muted" />
          ) : (
            <Eye size={14} className="text-plm-accent" />
          )}
          {isWatching ? 'Stop Watching' : 'Watch File'}
        </div>
      )}

      {/* Copy Share Link - for synced files and folders */}
      {!multiSelect && anySynced && (isFolder || hasPdmData) && (
        <div 
          className={`context-menu-item ${isCreatingShareLink ? 'opacity-50' : ''}`}
          onClick={() => {
            if (isFolder) {
              addToast('info', 'Folder sharing coming soon! For now, share individual files.')
              onClose()
            } else if (!isCreatingShareLink) {
              onQuickShareLink()
            }
          }}
        >
          {isCreatingShareLink ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Link size={14} className="text-plm-accent" />
          )}
          Copy Share Link
        </div>
      )}

      {/* Add to ECO - for synced files */}
      {!multiSelect && !isFolder && anySynced && hasPdmData && (
        <div 
          className="context-menu-item"
          onClick={() => openDialog('addToECO')}
        >
          <ClipboardList size={14} className="text-plm-fg-dim" />
          Add to ECO
        </div>
      )}
    </>
  )
}
