// Folder tree item component for the explorer
import { memo } from 'react'
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import { LocalFile } from '@/stores/pdmStore'
import type { OperationType } from '@/stores/types'
import { FolderActionButtons } from './TreeItemActions'
import { TREE_BASE_PADDING_PX, TREE_INDENT_PX } from './constants'
import type { CheckoutUser } from '@/components/shared/FileItem'
import type { FolderDiffCounts } from './types'

interface FolderTreeItemProps {
  file: LocalFile
  depth: number
  isExpanded: boolean
  isSelected: boolean
  isCurrentFolder: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onToggleExpand: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  operationType: OperationType | null
  isDragTarget: boolean
  isCut: boolean
  // Folder stats
  diffCounts: FolderDiffCounts | null
  localOnlyCount: number
  checkoutUsers: CheckoutUser[]
  checkoutSignature: string
  checkedOutByMeCount: number
  totalCheckouts: number
  syncedCount: number
  // Folder status (priority-based from computeFolderVisualState)
  checkoutStatus: 'none' | 'mine' | 'others' | 'both'
  /** Whether folder text should be normal (true) or italic/muted (false) */
  isSynced: boolean
  /** Priority-based folder icon color (Tailwind class) */
  iconColor: string
  // Children
  children: React.ReactNode
  onRefresh?: (silent?: boolean) => void
  // Action button props (passed from parent to avoid child store subscriptions)
  isOfflineMode: boolean
  // NOTE: allFiles prop removed for O(N) performance optimization.
  // FolderActionButtons now uses pre-computed diffCounts instead of filtering allFiles.
}

/**
 * Custom comparison function for FolderTreeItem memoization.
 * Compares props that affect rendering, skipping callback functions.
 * Note: children prop uses reference equality since React handles child reconciliation.
 */
function areFolderTreeItemPropsEqual(
  prevProps: FolderTreeItemProps,
  nextProps: FolderTreeItemProps,
): boolean {
  // Compare file identity and key properties
  if (prevProps.file.path !== nextProps.file.path) return false
  if (prevProps.file.name !== nextProps.file.name) return false
  if (prevProps.file.diffStatus !== nextProps.file.diffStatus) return false

  // Compare primitive props
  if (prevProps.depth !== nextProps.depth) return false
  if (prevProps.isExpanded !== nextProps.isExpanded) return false
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.isCurrentFolder !== nextProps.isCurrentFolder) return false
  if (prevProps.operationType !== nextProps.operationType) return false
  if (prevProps.isDragTarget !== nextProps.isDragTarget) return false
  if (prevProps.isCut !== nextProps.isCut) return false

  // Compare folder stats
  if (prevProps.localOnlyCount !== nextProps.localOnlyCount) return false
  if (prevProps.checkedOutByMeCount !== nextProps.checkedOutByMeCount) return false
  if (prevProps.totalCheckouts !== nextProps.totalCheckouts) return false
  if (prevProps.syncedCount !== nextProps.syncedCount) return false
  if (prevProps.checkoutStatus !== nextProps.checkoutStatus) return false
  if (prevProps.isSynced !== nextProps.isSynced) return false
  if (prevProps.iconColor !== nextProps.iconColor) return false

  // Compare diffCounts object
  if (prevProps.diffCounts !== nextProps.diffCounts) {
    if (!prevProps.diffCounts || !nextProps.diffCounts) return false
    if (prevProps.diffCounts.added !== nextProps.diffCounts.added) return false
    if (prevProps.diffCounts.modified !== nextProps.diffCounts.modified) return false
    if (prevProps.diffCounts.moved !== nextProps.diffCounts.moved) return false
    if (prevProps.diffCounts.deleted !== nextProps.diffCounts.deleted) return false
    if (prevProps.diffCounts.outdated !== nextProps.diffCounts.outdated) return false
  }

  // Compare all owner/profile fields through the shared stable signature
  if (prevProps.checkoutSignature !== nextProps.checkoutSignature) return false

  // Compare children by reference (React handles child reconciliation)
  if (prevProps.children !== nextProps.children) return false

  // Compare action button props
  if (prevProps.isOfflineMode !== nextProps.isOfflineMode) return false

  return true
}

/**
 * Folder tree item component
 * Renders a folder in the explorer tree with status badges and expandable children
 */
export const FolderTreeItem = memo(function FolderTreeItem({
  file,
  depth,
  isExpanded,
  isSelected,
  isCurrentFolder,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggleExpand,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  operationType,
  isDragTarget,
  isCut,
  diffCounts,
  localOnlyCount,
  checkoutUsers,
  checkedOutByMeCount,
  totalCheckouts,
  syncedCount,
  checkoutStatus: _checkoutStatus,
  isSynced,
  iconColor,
  children,
  onRefresh,
  isOfflineMode,
}: FolderTreeItemProps) {
  const isProcessing = operationType !== null
  // Don't apply diffClass to folders - folder visual state is derived from children (via isSynced prop)
  // The CSS sidebar-diff-cloud class would make text italic based on stale folder diffStatus
  const diffClass = ''

  // Folder icon uses pre-computed iconColor from priority-based logic
  // Priority order: local-only > server-only > synced > mine > others
  const getFolderIcon = () => {
    return <FolderOpen size={16} className={iconColor} />
  }

  return (
    <div key={file.path}>
      <div
        className={`tree-item group ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''} ${isCut ? 'opacity-50' : ''}`}
        style={{ paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        draggable={file.diffStatus !== 'cloud'}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Expand/collapse chevron */}
        <span
          className="mr-1 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-plm-fg-muted" />
          ) : (
            <ChevronRight size={14} className="text-plm-fg-muted" />
          )}
        </span>

        {/* Folder icon */}
        <span className="tree-item-icon">{getFolderIcon()}</span>

        {/* Folder name - italic/muted for unsynced folders (derived from computed isSynced) */}
        <span className={`truncate text-sm flex-1 ${!isSynced ? 'italic text-plm-fg-muted' : ''}`}>
          {file.name}
        </span>

        {/* Action buttons */}
        <FolderActionButtons
          file={file}
          diffCounts={diffCounts}
          localOnlyCount={localOnlyCount}
          checkoutUsers={checkoutUsers}
          checkedOutByMeCount={checkedOutByMeCount}
          totalCheckouts={totalCheckouts}
          syncedCount={syncedCount}
          operationType={operationType}
          onRefresh={onRefresh}
          isOfflineMode={isOfflineMode}
        />
      </div>

      {/* Children when expanded */}
      {isExpanded && children}
    </div>
  )
}, areFolderTreeItemPropsEqual)
