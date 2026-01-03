// Folder tree item component for the explorer
import { ChevronRight, ChevronDown, FolderOpen, Loader2 } from 'lucide-react'
import { LocalFile } from '../../../stores/pdmStore'
import { FolderActionButtons } from './TreeItemActions'
import { TREE_BASE_PADDING_PX, TREE_INDENT_PX, DIFF_STATUS_CLASS_PREFIX } from './constants'
import type { CheckoutUser } from '../../shared/FileItemComponents'
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
  isProcessing: boolean
  isDragTarget: boolean
  isCut: boolean
  // Folder stats
  diffCounts: FolderDiffCounts | null
  localOnlyCount: number
  checkoutUsers: CheckoutUser[]
  checkedOutByMeCount: number
  totalCheckouts: number
  syncedCount: number
  // Folder status
  checkoutStatus: 'none' | 'mine' | 'others' | 'both'
  isSynced: boolean
  // Children
  children: React.ReactNode
  onRefresh?: (silent?: boolean) => void
}

/**
 * Folder tree item component
 * Renders a folder in the explorer tree with status badges and expandable children
 */
export function FolderTreeItem({
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
  isProcessing,
  isDragTarget,
  isCut,
  diffCounts,
  localOnlyCount,
  checkoutUsers,
  checkedOutByMeCount,
  totalCheckouts,
  syncedCount,
  checkoutStatus,
  isSynced,
  children,
  onRefresh
}: FolderTreeItemProps) {
  const diffClass = file.diffStatus ? `${DIFF_STATUS_CLASS_PREFIX}${file.diffStatus}` : ''
  
  // Get folder icon with appropriate color
  const getFolderIcon = () => {
    if (isProcessing) {
      return <Loader2 size={16} className="text-sky-400 animate-spin" />
    }
    
    // Cloud-only folders - muted color
    if (file.diffStatus === 'cloud') {
      return <FolderOpen size={16} className="text-plm-fg-muted" />
    }
    
    // Red for folders with files checked out by others
    if (checkoutStatus === 'others' || checkoutStatus === 'both') {
      return <FolderOpen size={16} className="text-plm-error" />
    }
    
    // Orange for folders with only my checkouts
    if (checkoutStatus === 'mine') {
      return <FolderOpen size={16} className="text-orange-400" />
    }
    
    // Green for synced folders
    if (isSynced) {
      return <FolderOpen size={16} className="text-plm-success" />
    }
    
    // Default grey
    return <FolderOpen size={16} className="text-plm-fg-muted" />
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
          {isExpanded 
            ? <ChevronDown size={14} className="text-plm-fg-muted" /> 
            : <ChevronRight size={14} className="text-plm-fg-muted" />
          }
        </span>
        
        {/* Folder icon */}
        <span className="tree-item-icon">{getFolderIcon()}</span>
        
        {/* Folder name */}
        <span className={`truncate text-sm flex-1 ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}>
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
          isProcessing={isProcessing}
          onRefresh={onRefresh}
        />
      </div>
      
      {/* Children when expanded */}
      {isExpanded && children}
    </div>
  )
}
