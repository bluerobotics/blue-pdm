// File tree item component for the explorer
import { Loader2 } from 'lucide-react'
import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import { FileIcon } from '../../shared/FileItemComponents'
import { FileActionButtons } from './TreeItemActions'
import { TREE_BASE_PADDING_PX, TREE_INDENT_PX, DIFF_STATUS_CLASS_PREFIX } from './constants'

interface FileTreeItemProps {
  file: LocalFile
  depth: number
  isSelected: boolean
  isRenaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  isProcessing: boolean
  isCut: boolean
  onRefresh?: (silent?: boolean) => void
  // Multi-select props
  selectedFiles: string[]
  selectedDownloadableFiles: LocalFile[]
  selectedUploadableFiles: LocalFile[]
  selectedCheckoutableFiles: LocalFile[]
  selectedCheckinableFiles: LocalFile[]
  selectedUpdatableFiles: LocalFile[]
  // Hover states
  isDownloadHovered: boolean
  isUploadHovered: boolean
  isCheckoutHovered: boolean
  isCheckinHovered: boolean
  isUpdateHovered: boolean
  setIsDownloadHovered: (v: boolean) => void
  setIsUploadHovered: (v: boolean) => void
  setIsCheckoutHovered: (v: boolean) => void
  setIsCheckinHovered: (v: boolean) => void
  setIsUpdateHovered: (v: boolean) => void
}

/**
 * File tree item component
 * Renders a single file in the explorer tree with status indicators and actions
 */
export function FileTreeItem({
  file,
  depth,
  isSelected,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  isProcessing,
  isCut,
  onRefresh,
  selectedFiles,
  selectedDownloadableFiles,
  selectedUploadableFiles,
  selectedCheckoutableFiles,
  selectedCheckinableFiles,
  selectedUpdatableFiles,
  isDownloadHovered,
  isUploadHovered,
  isCheckoutHovered,
  isCheckinHovered,
  isUpdateHovered,
  setIsDownloadHovered,
  setIsUploadHovered,
  setIsCheckoutHovered,
  setIsCheckinHovered,
  setIsUpdateHovered
}: FileTreeItemProps) {
  const { lowercaseExtensions } = usePDMStore()
  
  const diffClass = file.diffStatus ? `${DIFF_STATUS_CLASS_PREFIX}${file.diffStatus}` : ''
  
  // Get file icon
  const getIcon = () => {
    if (isProcessing) {
      return <Loader2 size={16} className="text-sky-400 animate-spin" />
    }
    return <FileIcon file={file} size={16} />
  }
  
  // Format filename with optional lowercase extension
  const getDisplayName = () => {
    if (!file.extension) return file.name
    return file.name.slice(0, -file.extension.length) + 
      (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)
  }
  
  // Check if this file should show dimmed due to multi-select hover
  const shouldDim = !file.isDirectory && (
    (isDownloadHovered && selectedDownloadableFiles.some(f => f.path === file.path)) ||
    (isUploadHovered && selectedUploadableFiles.some(f => f.path === file.path)) ||
    (isCheckoutHovered && selectedCheckoutableFiles.some(f => f.path === file.path)) ||
    (isCheckinHovered && selectedCheckinableFiles.some(f => f.path === file.path))
  )
  
  return (
    <div
      className={`tree-item group ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isCut ? 'opacity-50' : ''}`}
      style={{ paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      draggable={file.diffStatus !== 'cloud'}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Spacer to align with folder chevrons */}
      <span className="w-[14px] mr-1" />
      
      {/* File icon */}
      <span className="tree-item-icon">{getIcon()}</span>
      
      {/* File name - editable when renaming */}
      {isRenaming ? (
        <input
          type="text"
          className="flex-1 text-sm bg-plm-bg border border-plm-accent rounded px-1 py-0.5 outline-none"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameSubmit()
            if (e.key === 'Escape') onRenameCancel()
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={`truncate text-sm flex-1 transition-opacity duration-200 ${
          shouldDim ? 'opacity-50' : ''
        } ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}>
          {getDisplayName()}
        </span>
      )}
      
      {/* Action buttons */}
      {!isRenaming && (
        <FileActionButtons
          file={file}
          isProcessing={isProcessing}
          onRefresh={onRefresh}
          selectedFiles={selectedFiles}
          selectedDownloadableFiles={selectedDownloadableFiles}
          selectedUploadableFiles={selectedUploadableFiles}
          selectedCheckoutableFiles={selectedCheckoutableFiles}
          selectedCheckinableFiles={selectedCheckinableFiles}
          selectedUpdatableFiles={selectedUpdatableFiles}
          isDownloadHovered={isDownloadHovered}
          isUploadHovered={isUploadHovered}
          isCheckoutHovered={isCheckoutHovered}
          isCheckinHovered={isCheckinHovered}
          isUpdateHovered={isUpdateHovered}
          setIsDownloadHovered={setIsDownloadHovered}
          setIsUploadHovered={setIsUploadHovered}
          setIsCheckoutHovered={setIsCheckoutHovered}
          setIsCheckinHovered={setIsCheckinHovered}
          setIsUpdateHovered={setIsUpdateHovered}
        />
      )}
    </div>
  )
}
