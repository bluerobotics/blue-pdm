// Vault tree item header component for the explorer
import { ChevronRight, ChevronDown, Database } from 'lucide-react'
import { usePDMStore, ConnectedVault } from '../../../stores/pdmStore'
import { 
  InlineCheckoutButton, 
  InlineSyncButton,
  FolderDownloadButton,
  FolderUploadButton,
  FolderCheckinButton
} from '../../InlineActionButtons'
// CheckoutUser with optional count for FolderCheckinButton
type CheckoutUserWithCount = {
  id: string
  name: string
  avatar_url?: string
  isMe: boolean
  count?: number
}

interface VaultTreeItemProps {
  vault: ConnectedVault
  isActive: boolean
  isExpanded: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  isDragTarget: boolean
  // Stats for inline buttons
  cloudFilesCount: number
  outdatedFilesCount: number
  localOnlyFilesCount: number
  syncedFilesCount: number
  checkedOutByMeCount: number
  allCheckoutUsers: CheckoutUserWithCount[]
  totalCheckouts: number
  // Processing states
  isDownloadingAll: boolean
  isCheckingInAll: boolean
  isCheckingInMyCheckouts: boolean
  isAnyCloudFileProcessing: boolean
  // Handlers
  onDownloadAllCloud: (e: React.MouseEvent) => void
  onUpdateAllOutdated: (e: React.MouseEvent) => void
  onFirstCheckinAllLocal: (e: React.MouseEvent) => void
  onCheckInMyCheckouts: (e: React.MouseEvent) => void
  onCheckoutAllSynced: (e: React.MouseEvent) => void
}

/**
 * Vault tree item header component
 * Renders the vault header with expand/collapse and batch action buttons
 */
export function VaultTreeItem({
  vault,
  isActive,
  isExpanded,
  onClick,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragTarget,
  cloudFilesCount,
  outdatedFilesCount,
  localOnlyFilesCount,
  syncedFilesCount,
  checkedOutByMeCount,
  allCheckoutUsers,
  totalCheckouts,
  isDownloadingAll,
  isCheckingInAll,
  isCheckingInMyCheckouts,
  isAnyCloudFileProcessing,
  onDownloadAllCloud,
  onUpdateAllOutdated,
  onFirstCheckinAllLocal,
  onCheckInMyCheckouts,
  onCheckoutAllSynced
}: VaultTreeItemProps) {
  const { isOfflineMode } = usePDMStore()
  
  return (
    <div 
      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
        isActive ? 'bg-plm-highlight text-plm-fg' : 'text-plm-fg-dim hover:bg-plm-highlight/50'
      } ${isActive && isDragTarget ? 'bg-plm-accent/20 outline outline-2 outline-dashed outline-plm-accent/50' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Expand/collapse chevron */}
      <span className="flex-shrink-0">
        {isExpanded && isActive
          ? <ChevronDown size={14} className="text-plm-fg-muted" />
          : <ChevronRight size={14} className="text-plm-fg-muted" />
        }
      </span>
      
      {/* Vault icon */}
      <Database size={16} className={`vault-icon ${isActive ? 'text-plm-accent' : 'text-plm-fg-muted'}`} />
      
      {/* Vault name */}
      <span className="truncate text-sm font-medium">
        {vault.name}
      </span>
      
      {/* Spacer */}
      <div className="flex-1" />
      
      {/* Inline badges and actions - only for active vault */}
      {isActive && (
        <div className="flex items-center gap-1">
          {/* Order from left to right: update, cloud, avatar checkout, green cloud, local */}
          
          {/* 1. Update files (outdated) - only when online */}
          {!isOfflineMode && outdatedFilesCount > 0 && (
            <InlineSyncButton
              onClick={onUpdateAllOutdated}
              count={outdatedFilesCount}
            />
          )}
          
          {/* 2. Cloud files to download - only when online */}
          {!isOfflineMode && cloudFilesCount > 0 && (
            <FolderDownloadButton
              onClick={onDownloadAllCloud}
              cloudCount={cloudFilesCount}
              isProcessing={isDownloadingAll || isAnyCloudFileProcessing}
            />
          )}
          
          {/* 3. Avatar checkout (users with check-in button) - only when online */}
          {!isOfflineMode && allCheckoutUsers.length > 0 && (
            <FolderCheckinButton
              onClick={onCheckInMyCheckouts}
              users={allCheckoutUsers}
              myCheckedOutCount={checkedOutByMeCount}
              totalCheckouts={totalCheckouts}
              isProcessing={isCheckingInMyCheckouts}
              maxAvatars={3}
            />
          )}
          
          {/* 4. Green cloud - synced files ready to checkout - only when online */}
          {!isOfflineMode && syncedFilesCount > 0 && (
            <InlineCheckoutButton
              onClick={onCheckoutAllSynced}
              count={syncedFilesCount}
            />
          )}
          
          {/* 5. Local files - clickable upload button when online only */}
          {!isOfflineMode && localOnlyFilesCount > 0 && (
            <FolderUploadButton
              onClick={onFirstCheckinAllLocal}
              localCount={localOnlyFilesCount}
              isProcessing={isCheckingInAll}
            />
          )}
        </div>
      )}
    </div>
  )
}
