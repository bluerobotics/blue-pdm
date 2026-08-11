/**
 * VirtualizedTreeRow - A single row in the virtualized file tree
 *
 * This component renders an individual tree item (file or folder) for the virtualizer.
 * It maintains all existing functionality from the original renderTreeItem function
 * including selection, drag-drop, context menus, and inline action buttons.
 */
import { memo, useCallback } from 'react'
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import { LocalFile } from '@/stores/pdmStore'
import { FileIcon } from '@/components/shared/FileItem'
import { HiddenFolderBadge } from '@/components/shared/HiddenFolder'
import { FileActionButtons, FolderActionButtons } from './TreeItemActions'
import {
  TREE_BASE_PADDING_PX,
  TREE_INDENT_PX,
  DIFF_STATUS_CLASS_PREFIX,
  PDM_FILES_DATA_TYPE,
  getTreeRowHeight,
  DEFAULT_LIST_ROW_SIZE,
} from './constants'
import type { FlattenedTreeItem } from './hooks/useFlattenedTree'
import type { FolderMetrics } from './hooks/useVaultTree'
import type { OperationType, StagedCheckin, ToastType } from '@/stores/types'
import type { FolderDiffCounts } from './types'
import type { User } from '@/types/pdm'

/** Default row height in pixels (when listRowSize = 24). Used as fallback. */
export const TREE_ROW_HEIGHT = getTreeRowHeight(DEFAULT_LIST_ROW_SIZE)

interface VirtualizedTreeRowProps {
  /** The flattened tree item data */
  item: FlattenedTreeItem
  /** Style from virtualizer (contains transform for positioning) */
  style: React.CSSProperties
  /** Tree density setting — controls row height (line spacing) */
  treeRowSize: number
  /** Whether this item is currently selected */
  isSelected: boolean
  /** Whether this item is being renamed */
  isRenaming: boolean
  /** Current rename input value */
  renameValue: string
  /** Handler for rename value change */
  onRenameChange: (value: string) => void
  /** Handler for rename submit */
  onRenameSubmit: () => void
  /** Handler for rename cancel */
  onRenameCancel: () => void
  /** Handler for item click */
  onClick: (e: React.MouseEvent, file: LocalFile, flatIndex: number) => void
  /** Handler for item double click */
  onDoubleClick: (file: LocalFile) => void
  /** Handler for context menu */
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
  /** Handler for slow double click (rename trigger) */
  onSlowDoubleClick: (file: LocalFile) => void
  /** Reset slow double click */
  resetSlowDoubleClick: () => void
  /** Whether drag is over this folder */
  isDragTarget: boolean
  /** Clipboard state for cut opacity */
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  /** Operation type if file is being processed */
  operationType: OperationType | null
  /** Folder diff counts (for folders only) */
  diffCounts: FolderDiffCounts | null
  /** Stable checkout identity signature for this row */
  checkoutSignature: string
  /**
   * Pre-computed folder metrics from useVaultTree's O(N) single-pass computation.
   * Consolidates localOnlyCount, folderStats, and other metrics into a single object.
   * Provides stable references for memoization.
   */
  folderMetrics: FolderMetrics | null
  /** Folder is marked hidden from non-admins — only ever true for admins, who still see it */
  isHiddenFromNonAdmins: boolean
  /** Refresh callback */
  onRefresh?: (silent?: boolean) => void
  // Multi-select props for FileActionButtons
  selectedFiles: string[]
  selectedDownloadableFiles: LocalFile[]
  selectedUploadableFiles: LocalFile[]
  selectedCheckoutableFiles: LocalFile[]
  selectedCheckinableFiles: LocalFile[]
  selectedUpdatableFiles: LocalFile[]
  // Drag handlers
  onDragStart: (e: React.DragEvent, file: LocalFile) => void
  onDragEnd: () => void
  onFolderDragOver: (e: React.DragEvent, file: LocalFile, draggedFiles: LocalFile[]) => void
  onFolderDragLeave: (e: React.DragEvent) => void
  onDropOnFolder: (
    e: React.DragEvent,
    file: LocalFile,
    onRefresh?: (silent?: boolean) => void,
  ) => void
  draggedFilesRef: React.MutableRefObject<LocalFile[]>
  // Tree data for drag checks
  files: LocalFile[]
  // Folder sync/checkout status functions
  checkFolderSynced: (path: string) => boolean
  checkFolderCheckoutStatus: (path: string) => 'none' | 'mine' | 'others' | 'both' | null
  // Props passed from parent to avoid store subscriptions (performance optimization)
  currentFolder: string
  lowercaseExtensions: boolean
  toggleFolder: (path: string) => void
  // Action button props (passed from parent to avoid child store subscriptions)
  user: User | null
  isOfflineMode: boolean
  stageCheckin: (data: StagedCheckin) => void
  unstageCheckin: (path: string) => void
  getStagedCheckin: (path: string) => StagedCheckin | undefined
  addToast: (type: ToastType, message: string) => void
}

/**
 * Get the appropriate icon for a file/folder.
 * For folders, uses pre-computed iconColor from folderMetrics with priority-based logic.
 * Priority order: local-only > server-only > synced > mine > others
 */
function useFolderIcon(file: LocalFile, folderIconColor: string) {
  if (file.isDirectory) {
    return <FolderOpen size={16} className={folderIconColor} />
  }

  return <FileIcon file={file} size={16} />
}

/**
 * Custom comparison function for VirtualizedTreeRow memo.
 *
 * PERFORMANCE OPTIMIZATION: This comparator prevents unnecessary re-renders by only
 * comparing props that actually affect THIS specific row's visual output.
 *
 * Props NOT compared (and why):
 * - files: No longer used in this component (drag logic moved to parent hook)
 * - Callback functions: Should be stable references from parent
 * - Refs (draggedFilesRef): Always same object reference
 * - selectedFiles arrays: The isSelected prop captures selection state for this row
 *
 * @returns true to skip re-render (props are equal), false to re-render
 */
function arePropsEqual(
  prevProps: VirtualizedTreeRowProps,
  nextProps: VirtualizedTreeRowProps,
): boolean {
  // 1. Item identity and state
  if (prevProps.item.file.path !== nextProps.item.file.path) return false
  if (prevProps.item.file.diffStatus !== nextProps.item.file.diffStatus) return false
  if (prevProps.item.depth !== nextProps.item.depth) return false
  if (prevProps.item.isExpanded !== nextProps.item.isExpanded) return false
  if (prevProps.item.flatIndex !== nextProps.item.flatIndex) return false

  // 2. File data changes that affect display
  if (prevProps.item.file.name !== nextProps.item.file.name) return false
  if (prevProps.item.file.pdmData?.checked_out_by !== nextProps.item.file.pdmData?.checked_out_by)
    return false
  if (prevProps.checkoutSignature !== nextProps.checkoutSignature) return false
  if (prevProps.item.file.pdmData?.version !== nextProps.item.file.pdmData?.version) return false
  if (prevProps.item.file.localHash !== nextProps.item.file.localHash) return false

  // 3. Selection and interaction state
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.isRenaming !== nextProps.isRenaming) return false
  if (prevProps.isRenaming && prevProps.renameValue !== nextProps.renameValue) return false
  if (prevProps.isDragTarget !== nextProps.isDragTarget) return false
  if (prevProps.isHiddenFromNonAdmins !== nextProps.isHiddenFromNonAdmins) return false

  // 4. Processing state
  if (prevProps.operationType !== nextProps.operationType) return false

  // 5. Clipboard state (only check if this file is cut)
  const prevIsCut =
    prevProps.clipboard?.operation === 'cut' &&
    prevProps.clipboard.files.some((f) => f.path === prevProps.item.file.path)
  const nextIsCut =
    nextProps.clipboard?.operation === 'cut' &&
    nextProps.clipboard.files.some((f) => f.path === nextProps.item.file.path)
  if (prevIsCut !== nextIsCut) return false

  // 6. Folder-specific metrics (only compare for folders)
  if (prevProps.item.file.isDirectory) {
    // Compare diffCounts
    const prevDiff = prevProps.diffCounts
    const nextDiff = nextProps.diffCounts
    if ((prevDiff === null) !== (nextDiff === null)) return false
    if (prevDiff && nextDiff) {
      if (prevDiff.added !== nextDiff.added) return false
      if (prevDiff.modified !== nextDiff.modified) return false
      if (prevDiff.cloud !== nextDiff.cloud) return false
      if (prevDiff.outdated !== nextDiff.outdated) return false
    }

    // Compare folderMetrics (consolidated object from useVaultTree's O(N) pre-computation)
    const prevMetrics = prevProps.folderMetrics
    const nextMetrics = nextProps.folderMetrics
    if ((prevMetrics === null) !== (nextMetrics === null)) return false
    if (prevMetrics && nextMetrics) {
      // Compare metrics that affect visual output
      if (prevMetrics.isSynced !== nextMetrics.isSynced) return false // Affects folder text styling
      if (prevMetrics.iconColor !== nextMetrics.iconColor) return false // Affects folder icon color
      if (prevMetrics.localOnlyFilesCount !== nextMetrics.localOnlyFilesCount) return false
      if (prevMetrics.syncedFilesCount !== nextMetrics.syncedFilesCount) return false
      if (prevMetrics.totalCheckedOutFilesCount !== nextMetrics.totalCheckedOutFilesCount)
        return false
      if (prevMetrics.myCheckedOutFilesCount !== nextMetrics.myCheckedOutFilesCount) return false
      // Compare all owner/profile fields through the shared stable signature.
      if (prevMetrics.checkoutSignature !== nextMetrics.checkoutSignature) return false
    }
  }

  // 7. Display preferences
  if (prevProps.treeRowSize !== nextProps.treeRowSize) return false
  if (prevProps.currentFolder !== nextProps.currentFolder) return false
  if (prevProps.lowercaseExtensions !== nextProps.lowercaseExtensions) return false
  if (prevProps.isOfflineMode !== nextProps.isOfflineMode) return false

  // 8. User identity (affects checkout display)
  if (prevProps.user?.id !== nextProps.user?.id) return false

  // 9. Style from virtualizer (position)
  // Note: style changes on scroll, but virtualizer reuses rows, so position changes
  // are expected and should trigger re-render for correct placement
  if (prevProps.style.transform !== nextProps.style.transform) return false
  if (prevProps.style.top !== nextProps.style.top) return false

  // All relevant props are equal - skip re-render
  return true
}

/**
 * A memoized row component for the virtualized tree.
 * Uses React.memo with a custom comparison to prevent unnecessary re-renders.
 *
 * PERFORMANCE: With 1000+ files, preventing unnecessary re-renders is critical.
 * The custom comparator (arePropsEqual) ensures only rows with actual visual
 * changes re-render, not all visible rows on any prop change.
 */
export const VirtualizedTreeRow = memo(function VirtualizedTreeRow({
  item,
  style,
  treeRowSize,
  isSelected,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onClick,
  onDoubleClick,
  onContextMenu,
  onSlowDoubleClick,
  resetSlowDoubleClick,
  isDragTarget,
  clipboard,
  operationType,
  diffCounts,
  folderMetrics,
  isHiddenFromNonAdmins,
  onRefresh,
  selectedFiles,
  selectedDownloadableFiles,
  selectedUploadableFiles,
  selectedCheckoutableFiles,
  selectedCheckinableFiles,
  selectedUpdatableFiles,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onDropOnFolder,
  draggedFilesRef,
  files: _files, // No longer used here - parent gets files from store
  checkFolderSynced: _checkFolderSynced,
  checkFolderCheckoutStatus: _checkFolderCheckoutStatus,
  currentFolder,
  lowercaseExtensions,
  toggleFolder,
  // Action button props
  user,
  isOfflineMode,
  stageCheckin,
  unstageCheckin,
  getStagedCheckin,
  addToast,
}: VirtualizedTreeRowProps) {
  const { file, depth, isExpanded } = item

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT VALUES FROM folderMetrics
  // Pre-computed by useVaultTree in a single O(N) pass. Extracting here keeps
  // the FolderActionButtons interface stable while consolidating data flow.
  // ═══════════════════════════════════════════════════════════════════════════
  const localOnlyCount = folderMetrics?.localOnlyFilesCount ?? 0
  const folderStats = folderMetrics
    ? {
        checkoutUsers: folderMetrics.checkoutUsers,
        checkedOutByMeCount: folderMetrics.myCheckedOutFilesCount,
        totalCheckouts: folderMetrics.totalCheckedOutFilesCount,
        syncedCount: folderMetrics.syncedFilesCount,
      }
    : null

  const isCurrentFolder = file.isDirectory && file.relativePath === currentFolder
  const isProcessing = operationType !== null
  const isCut = clipboard?.operation === 'cut' && clipboard.files.some((f) => f.path === file.path)
  // Don't apply diffClass to folders - folder visual state is derived from children (via folderMetrics)
  // Only files should use their own diffStatus for CSS styling (e.g., sidebar-diff-cloud makes text italic)
  const diffClass =
    !file.isDirectory && file.diffStatus ? `${DIFF_STATUS_CLASS_PREFIX}${file.diffStatus}` : ''

  // Use pre-computed iconColor from folderMetrics (priority-based: local-only > server-only > synced > mine > others)
  const folderIconColor = folderMetrics?.iconColor ?? 'text-plm-fg-muted'
  const icon = useFolderIcon(file, folderIconColor)

  // Use pre-computed isSynced from folderMetrics for text styling (italic/muted when not synced)
  const folderIsSynced = file.isDirectory ? (folderMetrics?.isSynced ?? false) : false

  // Callback ref for rename input - explicitly focus and select on mount
  // (autoFocus alone is unreliable in virtualized lists where rows are recycled)
  const renameInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus()
      node.select()
    }
  }, [])

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isRenaming) return
      if (e.shiftKey) e.preventDefault()
      onClick(e, file, item.flatIndex)

      // Trigger slow double-click detection (not on shift/ctrl click)
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        onSlowDoubleClick(file)
      }
    },
    [isRenaming, onClick, file, item.flatIndex, onSlowDoubleClick],
  )

  // Double click handler
  const handleDoubleClick = useCallback(() => {
    if (isRenaming) return
    resetSlowDoubleClick()
    onDoubleClick(file)
  }, [isRenaming, resetSlowDoubleClick, onDoubleClick, file])

  // Context menu handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onContextMenu(e, file)
    },
    [onContextMenu, file],
  )

  // Drag start handler - simplified to let parent determine multi-select
  // (Parent gets fresh selection from store to avoid stale closure issues)
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (file.diffStatus === 'cloud') {
        e.preventDefault()
        return
      }
      onDragStart(e, file)
    },
    [file, onDragStart],
  )

  // Drag over handler
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
      const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
      const currentDraggedFiles = draggedFilesRef.current

      if (!hasPdmFiles && !hasExternalFiles && currentDraggedFiles.length === 0) return

      if (file.isDirectory) {
        onFolderDragOver(e, file, currentDraggedFiles)
      }
    },
    [file, draggedFilesRef, onFolderDragOver],
  )

  // Toggle folder expansion
  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleFolder(file.relativePath)
    },
    [toggleFolder, file.relativePath],
  )

  return (
    <div
      className={`tree-item group ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''} ${isCut ? 'opacity-50' : ''}`}
      style={{
        ...style,
        paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX,
        height: getTreeRowHeight(treeRowSize),
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      draggable={file.diffStatus !== 'cloud'}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={file.isDirectory ? onFolderDragLeave : undefined}
      onDrop={file.isDirectory ? (e) => onDropOnFolder(e, file, onRefresh) : undefined}
      data-path={file.path}
    >
      {/* Folder chevron or file spacer */}
      {file.isDirectory ? (
        <span className="mr-1 cursor-pointer" onClick={handleToggleExpand}>
          {isExpanded ? (
            <ChevronDown size={14} className="text-plm-fg-muted" />
          ) : (
            <ChevronRight size={14} className="text-plm-fg-muted" />
          )}
        </span>
      ) : (
        <span className="w-[14px] mr-1" />
      )}

      {/* Icon */}
      <span className="tree-item-icon">{icon}</span>

      {/* Name */}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          className="flex-1 text-sm bg-plm-bg border border-plm-accent rounded px-1 py-0.5 outline-none"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onRenameSubmit()
            } else if (e.key === 'Escape') {
              onRenameCancel()
            }
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          draggable={false}
        />
      ) : (
        <span
          className={`truncate text-sm flex-1 ${
            // For folders: use checkFolderSynced() callback (same as icon) for consistent updates
            // For files: use the file's own diffStatus
            (file.isDirectory ? !folderIsSynced : file.diffStatus === 'cloud')
              ? 'italic text-plm-fg-muted'
              : ''
          }`}
        >
          {file.isDirectory || !file.extension
            ? file.name
            : file.name.slice(0, -file.extension.length) +
              (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
        </span>
      )}

      {!isRenaming && isHiddenFromNonAdmins && <HiddenFolderBadge className="mr-1" />}

      {/* Folder action buttons */}
      {!isRenaming && file.isDirectory && folderStats && (
        <FolderActionButtons
          file={file}
          diffCounts={diffCounts}
          localOnlyCount={localOnlyCount}
          checkoutUsers={folderStats.checkoutUsers}
          checkedOutByMeCount={folderStats.checkedOutByMeCount}
          totalCheckouts={folderStats.totalCheckouts}
          syncedCount={folderStats.syncedCount}
          operationType={operationType}
          onRefresh={onRefresh}
          isOfflineMode={isOfflineMode}
        />
      )}

      {/* File action buttons */}
      {!isRenaming && !file.isDirectory && (
        <FileActionButtons
          file={file}
          operationType={operationType}
          onRefresh={onRefresh}
          selectedFiles={selectedFiles}
          selectedDownloadableFiles={selectedDownloadableFiles}
          selectedUploadableFiles={selectedUploadableFiles}
          selectedCheckoutableFiles={selectedCheckoutableFiles}
          selectedCheckinableFiles={selectedCheckinableFiles}
          selectedUpdatableFiles={selectedUpdatableFiles}
          user={user}
          isOfflineMode={isOfflineMode}
          stageCheckin={stageCheckin}
          unstageCheckin={unstageCheckin}
          getStagedCheckin={getStagedCheckin}
          addToast={addToast}
        />
      )}
    </div>
  )
}, arePropsEqual)
