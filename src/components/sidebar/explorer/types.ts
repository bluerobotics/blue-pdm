// Types for Explorer components
import type { LocalFile, ConnectedVault } from '../../../stores/pdmStore'
import type { CheckoutUser } from '../../shared/FileItemComponents'

// Tree node structure for recursive rendering
export interface TreeNode {
  id: string
  name: string
  path: string
  relativePath: string
  type: 'vault' | 'folder' | 'file'
  children?: TreeNode[]
  file?: LocalFile
  vault?: ConnectedVault
  isExpanded?: boolean
  depth: number
}

// Diff counts for folders - matches getFolderDiffCounts return type
export interface FolderDiffCounts {
  added: number
  modified: number
  moved: number
  deleted: number
  outdated: number
  cloud: number
  cloudNew: number
}

// Base props for all tree items
export interface TreeItemBaseProps {
  depth: number
  isSelected: boolean
  onSelect: (path: string, ctrlKey?: boolean, shiftKey?: boolean) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
  onRefresh?: (silent?: boolean) => void
}

// Props for file tree items
export interface FileTreeItemProps extends TreeItemBaseProps {
  file: LocalFile
  isRenaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onDoubleClick: (file: LocalFile) => void
  onSlowDoubleClick: (file: LocalFile) => void
  onDragStart: (e: React.DragEvent, file: LocalFile) => void
  onDragEnd: () => void
  clipboard?: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  // Multi-select hover states
  isDownloadHovered?: boolean
  isUploadHovered?: boolean
  isCheckoutHovered?: boolean
  isCheckinHovered?: boolean
  selectedDownloadableFiles?: LocalFile[]
  selectedUploadableFiles?: LocalFile[]
  selectedCheckoutableFiles?: LocalFile[]
  selectedCheckinableFiles?: LocalFile[]
  // Handlers for multi-select hover
  setIsDownloadHovered?: (v: boolean) => void
  setIsUploadHovered?: (v: boolean) => void
  setIsCheckoutHovered?: (v: boolean) => void
  setIsCheckinHovered?: (v: boolean) => void
}

// Props for folder tree items
export interface FolderTreeItemProps extends TreeItemBaseProps {
  file: LocalFile
  isExpanded: boolean
  onToggleExpand: (path: string) => void
  onDoubleClick: (file: LocalFile) => void
  onDragStart: (e: React.DragEvent, file: LocalFile) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent, file: LocalFile) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, file: LocalFile) => void
  diffCounts: FolderDiffCounts | null
  localOnlyCount: number
  checkoutUsers: CheckoutUser[]
  checkedOutByMeCount: number
  totalCheckouts: number
  syncedCount: number
  isProcessing: boolean
  isDragTarget: boolean
  children: React.ReactNode
  clipboard?: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
}

// Props for vault tree item header
export interface VaultTreeItemProps {
  vault: ConnectedVault
  isActive: boolean
  isExpanded: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent, vault: ConnectedVault) => void
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
  allCheckoutUsers: CheckoutUser[]
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

// Drag state for drag and drop operations
export interface DragState {
  isDragging: boolean
  draggedFiles: LocalFile[]
  dropTarget: string | null
  dropPosition: 'before' | 'inside' | 'after' | null
}

// Pinned folder item structure
export interface PinnedFolder {
  path: string
  vaultId: string
  vaultName: string
  isDirectory: boolean
}

// Props for pinned folders section
export interface PinnedFoldersSectionProps {
  pinnedFolders: PinnedFolder[]
  isExpanded: boolean
  onToggle: () => void
  activeVaultId: string | null
  onNavigate: (pinned: PinnedFolder) => void
  onUnpin: (path: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onRefresh?: (silent?: boolean) => void
}

// Props for recent vaults section
export interface RecentVaultsSectionProps {
  recentVaults: string[]
  onOpenRecentVault: (path: string) => void
}

// Props for tree item inline actions
export interface TreeItemActionsProps {
  file: LocalFile
  isProcessing: boolean
  onDownload: (e: React.MouseEvent) => void
  onUpload: (e: React.MouseEvent) => void
  onCheckout: (e: React.MouseEvent) => void
  onCheckin: (e: React.MouseEvent) => void
  onStageCheckin?: (e: React.MouseEvent) => void
  // Multi-select props
  selectedCount?: number
  isSelectionHovered?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

// Type for tree map
export type TreeMap = { [key: string]: LocalFile[] }
