import React, { memo } from 'react'
import { FileBox, Layers, FilePen, File } from 'lucide-react'
import type { ConfigBomItem } from '@/stores/types'

export interface ConfigBomRowProps {
  item: ConfigBomItem
  /** Nesting depth within the configuration section */
  depth: number
  /** Depth of the parent configuration in the file's config tree */
  configDepth: number
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  onClick: (e: React.MouseEvent) => void
}

/**
 * Icon component for file types in BOM rows
 */
function BomFileIcon({
  fileType,
  size = 12,
}: {
  fileType: ConfigBomItem['file_type']
  size?: number
}) {
  switch (fileType) {
    case 'part':
      return <FileBox size={size} className="text-plm-accent flex-shrink-0" />
    case 'assembly':
      return <Layers size={size} className="text-amber-400 flex-shrink-0" />
    case 'drawing':
      return <FilePen size={size} className="text-sky-300 flex-shrink-0" />
    default:
      return <File size={size} className="text-plm-fg-muted flex-shrink-0" />
  }
}

/**
 * Custom comparison function for ConfigBomRow memoization.
 */
function areConfigBomRowPropsEqual(
  prevProps: ConfigBomRowProps,
  nextProps: ConfigBomRowProps,
): boolean {
  // Compare item identity and key properties
  if (prevProps.item.id !== nextProps.item.id) return false
  if (prevProps.item.file_name !== nextProps.item.file_name) return false
  if (prevProps.item.quantity !== nextProps.item.quantity) return false
  if (prevProps.item.part_number !== nextProps.item.part_number) return false
  if (prevProps.item.description !== nextProps.item.description) return false
  if (prevProps.item.state !== nextProps.item.state) return false

  // Compare primitive props
  if (prevProps.depth !== nextProps.depth) return false
  if (prevProps.configDepth !== nextProps.configDepth) return false
  if (prevProps.rowHeight !== nextProps.rowHeight) return false

  // Compare visibleColumns array (shallow check on length and ids)
  if (prevProps.visibleColumns.length !== nextProps.visibleColumns.length) return false
  for (let i = 0; i < prevProps.visibleColumns.length; i++) {
    if (prevProps.visibleColumns[i].id !== nextProps.visibleColumns[i].id) return false
    if (prevProps.visibleColumns[i].width !== nextProps.visibleColumns[i].width) return false
  }

  return true
}

/**
 * Displays a BOM item (part/subassembly) under a configuration row.
 * Used to show the bill of materials for a specific configuration.
 */
export const ConfigBomRow = memo(function ConfigBomRow({
  item,
  depth,
  configDepth,
  rowHeight,
  visibleColumns,
  onClick,
}: ConfigBomRowProps) {
  // Calculate indentation: base indent + parent config depth + item depth + extra for nesting under config
  const indentPx = 24 + configDepth * 16 + depth * 16 + 32

  return (
    <tr
      className="config-bom-row cursor-pointer hover:bg-plm-bg-light/50"
      style={{ height: rowHeight }}
      onClick={onClick}
    >
      {visibleColumns.map((column) => (
        <td key={column.id} style={{ width: column.width }}>
          {column.id === 'name' ? (
            <div
              className="flex items-center gap-1.5"
              style={{
                minHeight: rowHeight - 8,
                paddingLeft: `${indentPx}px`,
              }}
            >
              <span className="text-plm-fg-dim text-[10px]">├</span>
              <BomFileIcon fileType={item.file_type} size={12} />
              <span className="truncate text-xs text-plm-fg-dim">{item.file_name}</span>
              {/* Quantity badge */}
              <span
                className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-plm-bg-light text-plm-fg-muted"
                title={`Quantity: ${item.quantity}`}
              >
                ×{item.quantity}
              </span>
            </div>
          ) : column.id === 'itemNumber' ? (
            item.part_number ? (
              <span className="text-[10px] text-plm-fg-dim font-mono">{item.part_number}</span>
            ) : (
              <span className="text-plm-fg-dim/50 text-[10px]">—</span>
            )
          ) : column.id === 'description' ? (
            item.description ? (
              <span className="text-[10px] text-plm-fg-dim truncate">{item.description}</span>
            ) : (
              <span className="text-plm-fg-dim/50 text-[10px]">—</span>
            )
          ) : column.id === 'revision' ? (
            item.revision ? (
              <span className="text-[10px] text-plm-fg-dim">{item.revision}</span>
            ) : (
              <span className="text-plm-fg-dim/50 text-[10px]">—</span>
            )
          ) : column.id === 'state' ? (
            item.state ? (
              <span className="text-[10px] text-plm-fg-dim">{item.state}</span>
            ) : (
              <span className="text-plm-fg-dim/50 text-[10px]">—</span>
            )
          ) : (
            <span className="text-plm-fg-dim/50 text-[10px]">—</span>
          )}
        </td>
      ))}
    </tr>
  )
}, areConfigBomRowPropsEqual)
