import { memo } from 'react'
import { ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import type { ColumnConfig } from './types'

export interface ColumnHeadersProps {
  columns: ColumnConfig[]
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  resizingColumn: string | null
  draggingColumn: string | null
  dragOverColumn: string | null
  getColumnLabel: (columnId: string) => string
  onSort: (columnId: string) => void
  onResize: (e: React.MouseEvent, columnId: string) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent, columnId: string) => void
  onDragOver: (e: React.DragEvent, columnId: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, columnId: string) => void
  onDragEnd: () => void
}

/**
 * Memoized column headers component for the file table
 */
export const ColumnHeaders = memo(function ColumnHeaders({
  columns,
  sortColumn,
  sortDirection,
  resizingColumn,
  draggingColumn,
  dragOverColumn,
  getColumnLabel,
  onSort,
  onResize,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: ColumnHeadersProps) {
  const visibleColumns = columns.filter(c => c.visible)

  return (
    <thead>
      <tr>
        {visibleColumns.map(column => (
          <th
            key={column.id}
            data-column-id={column.id}
            style={{ width: column.width }}
            className={`
              ${column.sortable ? 'sortable cursor-pointer' : ''} 
              ${draggingColumn === column.id ? 'dragging opacity-50' : ''} 
              ${dragOverColumn === column.id ? 'drag-over bg-plm-accent/10' : ''}
            `}
            onClick={() => column.sortable && onSort(column.id)}
            onContextMenu={onContextMenu}
            onDragOver={(e) => onDragOver(e, column.id)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, column.id)}
            onDragEnd={onDragEnd}
          >
            <div className="flex items-center gap-1">
              <span
                draggable
                onDragStart={(e) => onDragStart(e, column.id)}
                className="cursor-grab active:cursor-grabbing"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} className="text-plm-fg-muted opacity-50" />
              </span>
              <span>{getColumnLabel(column.id)}</span>
              {sortColumn === column.id && (
                sortDirection === 'asc' 
                  ? <ChevronUp size={12} />
                  : <ChevronDown size={12} />
              )}
            </div>
            <div
              className={`column-resize-handle ${resizingColumn === column.id ? 'resizing' : ''}`}
              onMouseDown={(e) => onResize(e, column.id)}
            />
          </th>
        ))}
      </tr>
    </thead>
  )
})
