// FileBrowser-specific types
import type { LocalFile } from '../../stores/pdmStore'

/**
 * Props for the main FileBrowser component
 */
export interface FileBrowserProps {
  onRefresh: (silent?: boolean) => void
}

/**
 * Props for file/folder row rendering in list view
 */
export interface FileRowProps {
  file: LocalFile
  index: number
  isSelected: boolean
  isCut: boolean
  isRenaming: boolean
  renameValue: string
  columns: ColumnConfig[]
  rowHeight: number
  processingPaths: Set<string>
  lowercaseExtensions: boolean
  userId: string | undefined
  currentMachineId: string | null
  draggedFiles: LocalFile[]
  dragOverFolder: string | null
  folderMetrics: FolderMetricsMap
  editingCell: { path: string; column: string } | null
  editValue: string
  onSelect: (e: React.MouseEvent, file: LocalFile, index: number) => void
  onDoubleClick: (file: LocalFile) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
  onDragStart: (e: React.DragEvent, file: LocalFile) => void
  onDragEnd: () => void
  onFolderDragOver: (e: React.DragEvent, folder: LocalFile) => void
  onFolderDragLeave: (e: React.DragEvent) => void
  onDropOnFolder: (e: React.DragEvent, folder: LocalFile) => void
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onCellEdit: (file: LocalFile, column: string) => void
  onCellEditChange: (value: string) => void
  onCellEditSave: () => void
  onCellEditCancel: () => void
  onInlineDownload: (e: React.MouseEvent, file: LocalFile) => void
  onInlineCheckout: (e: React.MouseEvent, file: LocalFile) => void
  onInlineCheckin: (e: React.MouseEvent, file: LocalFile) => void
  onInlineUpload: (e: React.MouseEvent, file: LocalFile) => void
  renderCellContent: (file: LocalFile, columnId: string) => React.ReactNode
}

/**
 * Props for FileIconCard (icon/grid view)
 */
export interface FileIconCardProps {
  file: LocalFile
  iconSize: number
  isSelected: boolean
  isCut: boolean
  allFiles: LocalFile[]
  processingPaths: Set<string>
  currentMachineId: string | null
  lowercaseExtensions: boolean
  userId: string | undefined
  userFullName: string | undefined
  userEmail: string | undefined
  userAvatarUrl: string | undefined
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDownload?: (e: React.MouseEvent, file: LocalFile) => void
  onCheckout?: (e: React.MouseEvent, file: LocalFile) => void
  onCheckin?: (e: React.MouseEvent, file: LocalFile) => void
  onUpload?: (e: React.MouseEvent, file: LocalFile) => void
}

/**
 * Props for ListRowIcon
 */
export interface ListRowIconProps {
  file: LocalFile
  size: number
  isProcessing: boolean
  folderCheckoutStatus?: 'mine' | 'others' | 'both' | null
  isFolderSynced?: boolean
}

/**
 * Column configuration for the file browser table
 */
export interface ColumnConfig {
  id: string
  label: string
  width: number
  minWidth: number
  visible: boolean
  sortable: boolean
}

/**
 * Selection state for files
 */
export interface SelectionState {
  selectedPaths: Set<string>
  lastSelectedPath: string | null
  anchorIndex: number | null  // For shift-click range selection
}

/**
 * Drag state for file operations
 */
export interface DragState {
  isDragging: boolean
  draggedFiles: LocalFile[]
  dropTarget: string | null
  isExternalDrag: boolean
}

/**
 * Pre-computed folder metrics for performance
 */
export interface FolderMetrics {
  cloudFilesCount: number
  cloudNewFilesCount: number
  localOnlyFilesCount: number
  checkoutableFilesCount: number
  outdatedFilesCount: number
  hasCheckoutableFiles: boolean
  hasMyCheckedOutFiles: boolean
  hasOthersCheckedOutFiles: boolean
  hasUnsyncedFiles: boolean
  myCheckedOutFilesCount: number
  totalCheckedOutFilesCount: number
  checkoutUsers: CheckoutUser[]
  isSynced: boolean
}

export type FolderMetricsMap = Map<string, FolderMetrics>

/**
 * Checkout user info for display
 */
export interface CheckoutUser {
  id: string
  name: string
  avatar_url?: string
  isMe: boolean
  isDifferentMachine?: boolean
  machineName?: string
}

/**
 * Configuration row with depth for tree display
 */
export interface ConfigWithDepth {
  name: string
  isActive?: boolean
  parentConfiguration?: string | null
  tabNumber?: string
  description?: string
  depth: number
}

/**
 * File conflict info for conflict resolution dialog
 */
export interface FileConflict {
  sourcePath: string
  destPath: string
  fileName: string
  relativePath: string
}

/**
 * Conflict dialog state
 */
export interface ConflictDialogState {
  conflicts: FileConflict[]
  nonConflicts: { sourcePath: string; destPath: string; relativePath: string }[]
  targetFolder: string
  folderName?: string
  onResolve: (resolution: 'overwrite' | 'rename' | 'skip', applyToAll: boolean) => void
}

/**
 * Context menu state
 */
export interface ContextMenuState {
  x: number
  y: number
  file: LocalFile
}

/**
 * Column context menu state
 */
export interface ColumnContextMenuState {
  x: number
  y: number
}

/**
 * Configuration context menu state
 */
export interface ConfigContextMenuState {
  x: number
  y: number
  filePath: string
  configName: string
}

/**
 * Custom confirmation dialog state
 */
export interface CustomConfirmState {
  title: string
  message: string
  warning?: string
  confirmText: string
  confirmDanger?: boolean
  onConfirm: () => void
}

/**
 * Delete local checkout confirmation state
 */
export interface DeleteLocalCheckoutConfirmState {
  checkedOutFiles: LocalFile[]
  allFilesToProcess: LocalFile[]
  contextFiles: LocalFile[]
}

/**
 * Selection box for multi-select
 */
export interface SelectionBox {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

/**
 * Column ID to translation key mapping
 */
export const COLUMN_TRANSLATION_KEYS: Record<string, string> = {
  name: 'fileBrowser.name',
  fileStatus: 'fileBrowser.fileStatus',
  checkedOutBy: 'fileBrowser.checkedOutBy',
  version: 'fileBrowser.version',
  itemNumber: 'fileBrowser.itemNumber',
  description: 'fileBrowser.description',
  revision: 'fileBrowser.revision',
  state: 'fileBrowser.state',
  ecoTags: 'fileBrowser.ecoTags',
  extension: 'fileBrowser.extension',
  size: 'fileBrowser.size',
  modifiedTime: 'fileBrowser.modified',
}
