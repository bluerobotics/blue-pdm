// Vault tree item header component for the explorer
import { memo } from 'react'
import { ChevronRight, ChevronDown, Database } from 'lucide-react'
import { usePDMStore, ConnectedVault } from '@/stores/pdmStore'
import {
  InlineCheckoutButton,
  InlineSyncButton,
  FolderDownloadButton,
  FolderUploadButton,
  FolderCheckinButton,
} from '@/components/shared/InlineActions'
// CheckoutUser with optional count for FolderCheckinButton
type CheckoutUserWithCount = {
  id: string
  name: string
  email?: string
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
  checkoutUsersSignature: string
  totalCheckouts: number
  // Processing states
  isDownloadingAll: boolean
  isCheckingInAll: boolean
  isCheckingInMyCheckouts: boolean
  isAnyCloudFileProcessing: boolean
  isAnyOutdatedFileProcessing: boolean
  // Handlers
  onDownloadAllCloud: (e: React.MouseEvent) => void
  onUpdateAllOutdated: (e: React.MouseEvent) => void
  onFirstCheckinAllLocal: (e: React.MouseEvent) => void
  onCheckInMyCheckouts: (e: React.MouseEvent) => void
  onCheckoutAllSynced: (e: React.MouseEvent) => void
}

/**
 * Custom comparison function for VaultTreeItem memoization.
 * Compares props that affect rendering, skipping callback functions.
 */
function areVaultTreeItemPropsEqual(
  prevProps: VaultTreeItemProps,
  nextProps: VaultTreeItemProps,
): boolean {
  // Compare vault identity
  if (prevProps.vault.id !== nextProps.vault.id) return false
  if (prevProps.vault.name !== nextProps.vault.name) return false

  // Compare UI states
  if (prevProps.isActive !== nextProps.isActive) return false
  if (prevProps.isExpanded !== nextProps.isExpanded) return false
  if (prevProps.isDragTarget !== nextProps.isDragTarget) return false

  // Compare stats
  if (prevProps.cloudFilesCount !== nextProps.cloudFilesCount) return false
  if (prevProps.outdatedFilesCount !== nextProps.outdatedFilesCount) return false
  if (prevProps.localOnlyFilesCount !== nextProps.localOnlyFilesCount) return false
  if (prevProps.syncedFilesCount !== nextProps.syncedFilesCount) return false
  if (prevProps.checkedOutByMeCount !== nextProps.checkedOutByMeCount) return false
  if (prevProps.totalCheckouts !== nextProps.totalCheckouts) return false

  // Compare processing states
  if (prevProps.isDownloadingAll !== nextProps.isDownloadingAll) return false
  if (prevProps.isCheckingInAll !== nextProps.isCheckingInAll) return false
  if (prevProps.isCheckingInMyCheckouts !== nextProps.isCheckingInMyCheckouts) return false
  if (prevProps.isAnyCloudFileProcessing !== nextProps.isAnyCloudFileProcessing) return false
  if (prevProps.isAnyOutdatedFileProcessing !== nextProps.isAnyOutdatedFileProcessing) return false

  // Compare all owner/profile fields through the shared stable signature
  if (prevProps.checkoutUsersSignature !== nextProps.checkoutUsersSignature) return false

  return true
}

/**
 * Vault tree item header component
 * Renders the vault header with expand/collapse and batch action buttons
 */
export const VaultTreeItem = memo(function VaultTreeItem({
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
  isAnyOutdatedFileProcessing,
  onDownloadAllCloud,
  onUpdateAllOutdated,
  onFirstCheckinAllLocal,
  onCheckInMyCheckouts,
  onCheckoutAllSynced,
}: VaultTreeItemProps) {
  // Selective selector: only re-render when isOfflineMode changes
  const isOfflineMode = usePDMStore((s) => s.isOfflineMode)

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
        {isExpanded && isActive ? (
          <ChevronDown size={14} className="text-plm-fg-muted" />
        ) : (
          <ChevronRight size={14} className="text-plm-fg-muted" />
        )}
      </span>

      {/* Vault icon */}
      <Database
        size={16}
        className={`vault-icon ${isActive ? 'text-plm-accent' : 'text-plm-fg-muted'}`}
      />

      {/* Vault name */}
      <span className="truncate text-sm font-medium">{vault.name}</span>

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
              isProcessing={isDownloadingAll || isAnyOutdatedFileProcessing}
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
              folderId={vault.id}
              folderName={vault.name}
            />
          )}

          {/* 4. Green cloud - synced files ready to checkout - only when online */}
          {!isOfflineMode && syncedFilesCount > 0 && (
            <InlineCheckoutButton onClick={onCheckoutAllSynced} count={syncedFilesCount} />
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
}, areVaultTreeItemPropsEqual)
