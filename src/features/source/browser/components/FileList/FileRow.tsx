import React, { memo } from 'react'
import type { LocalFile } from '@/stores/pdmStore'

export interface FileRowProps {
  file: LocalFile
  index: number
  isSelected: boolean
  isProcessing: boolean
  diffClass: string
  isDragTarget: boolean
  isCut: boolean
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  checkoutSignature: string
  draggable: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  renderCell: (file: LocalFile, columnId: string) => React.ReactNode
}

/**
 * Custom comparison function for FileRow memoization.
 * Compares props that affect rendering, skipping callback functions.
 */
function areFileRowPropsEqual(prevProps: FileRowProps, nextProps: FileRowProps): boolean {
  // Compare file identity and key properties
  if (prevProps.file.path !== nextProps.file.path) return false
  if (prevProps.file.name !== nextProps.file.name) return false
  if (prevProps.file.diffStatus !== nextProps.file.diffStatus) return false
  if (prevProps.file.isDirectory !== nextProps.file.isDirectory) return false
  if (prevProps.file.size !== nextProps.file.size) return false
  if (prevProps.file.modifiedTime !== nextProps.file.modifiedTime) return false
  if (prevProps.checkoutSignature !== nextProps.checkoutSignature) return false

  // Compare primitive props
  if (prevProps.index !== nextProps.index) return false
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.isProcessing !== nextProps.isProcessing) return false
  if (prevProps.diffClass !== nextProps.diffClass) return false
  if (prevProps.isDragTarget !== nextProps.isDragTarget) return false
  if (prevProps.isCut !== nextProps.isCut) return false
  if (prevProps.rowHeight !== nextProps.rowHeight) return false
  if (prevProps.draggable !== nextProps.draggable) return false

  // Compare visibleColumns array (shallow check on length and ids)
  if (prevProps.visibleColumns.length !== nextProps.visibleColumns.length) return false
  for (let i = 0; i < prevProps.visibleColumns.length; i++) {
    if (prevProps.visibleColumns[i].id !== nextProps.visibleColumns[i].id) return false
    if (prevProps.visibleColumns[i].width !== nextProps.visibleColumns[i].width) return false
  }

  // Compare renderCell by reference (should be stable from useCallback)
  if (prevProps.renderCell !== nextProps.renderCell) return false

  return true
}

export const FileRow = memo(function FileRow({
  file,
  isSelected,
  isProcessing,
  diffClass,
  isDragTarget,
  isCut,
  rowHeight,
  visibleColumns,
  draggable,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  renderCell,
}: FileRowProps) {
  return (
    <tr
      className={`${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''} ${isCut ? 'opacity-50' : ''}`}
      style={{ height: rowHeight }}
      data-path={file.path}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {visibleColumns.map((column) => (
        <td key={column.id} style={{ width: column.width }}>
          {renderCell(file, column.id)}
        </td>
      ))}
    </tr>
  )
}, areFileRowPropsEqual)
