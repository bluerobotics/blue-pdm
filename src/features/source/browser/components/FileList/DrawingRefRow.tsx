import React, { memo } from 'react'
import {
  FileBox,
  Layers,
  FilePen,
  File,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  RotateCw,
} from 'lucide-react'
import type { DrawingRefItem } from '@/stores/types'
import { t } from '@/lib/i18n'

export interface DrawingRefRowProps {
  /** The drawing reference item to display */
  item: DrawingRefItem
  /** Nesting depth within the drawing references (currently always 0) */
  depth: number
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  /** Whether this ref file's configs are expanded */
  isExpanded: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  /** Toggle config expansion for this referenced file */
  onToggleExpand: (e: React.MouseEvent) => void
}

/**
 * Icon component for file types in drawing reference rows.
 * Matches the BomFileIcon pattern from ConfigBomRow.
 */
function DrawingRefFileIcon({
  fileType,
  size = 12,
}: {
  fileType: DrawingRefItem['file_type']
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
 * Custom comparison function for DrawingRefRow memoization.
 * Compares item identity, display properties, and layout props to prevent
 * unnecessary re-renders in the virtualized file list.
 */
function areDrawingRefRowPropsEqual(
  prevProps: DrawingRefRowProps,
  nextProps: DrawingRefRowProps,
): boolean {
  // Compare item identity and key display properties
  if (prevProps.item.id !== nextProps.item.id) return false
  if (prevProps.item.unresolved !== nextProps.item.unresolved) return false
  if (prevProps.item.file_name !== nextProps.item.file_name) return false
  if (prevProps.item.file_type !== nextProps.item.file_type) return false
  if (prevProps.item.part_number !== nextProps.item.part_number) return false
  if (prevProps.item.description !== nextProps.item.description) return false
  if (prevProps.item.revision !== nextProps.item.revision) return false
  if (prevProps.item.state !== nextProps.item.state) return false
  if (prevProps.item.configuration !== nextProps.item.configuration) return false

  // Compare configurations array
  const prevConfigs = prevProps.item.configurations
  const nextConfigs = nextProps.item.configurations
  if (prevConfigs?.length !== nextConfigs?.length) return false
  if (prevConfigs && nextConfigs) {
    for (let i = 0; i < prevConfigs.length; i++) {
      if (prevConfigs[i] !== nextConfigs[i]) return false
    }
  }

  // Compare per-config metadata (shallow reference check)
  if (prevProps.item.config_tabs !== nextProps.item.config_tabs) return false
  if (prevProps.item.config_descriptions !== nextProps.item.config_descriptions) return false
  if (prevProps.item.configuration_revisions !== nextProps.item.configuration_revisions)
    return false

  // Compare primitive props
  if (prevProps.depth !== nextProps.depth) return false
  if (prevProps.rowHeight !== nextProps.rowHeight) return false
  if (prevProps.isExpanded !== nextProps.isExpanded) return false

  // Compare visibleColumns array (shallow check on length, ids, and widths)
  if (prevProps.visibleColumns.length !== nextProps.visibleColumns.length) return false
  for (let i = 0; i < prevProps.visibleColumns.length; i++) {
    if (prevProps.visibleColumns[i].id !== nextProps.visibleColumns[i].id) return false
    if (prevProps.visibleColumns[i].width !== nextProps.visibleColumns[i].width) return false
  }

  return true
}

/**
 * Stands in for the reference list of a drawing whose references could not be read.
 *
 * Every headless tier declined, so the honest answer is "unknown", not "none". The retry is allowed
 * to escalate as far as opening the drawing in SolidWorks, which is why it is behind a click.
 */
function UnresolvedDrawingRefRow({
  indentPx,
  rowHeight,
  visibleColumns,
  onRetry,
}: {
  indentPx: number
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  onRetry: (e: React.MouseEvent) => void
}) {
  return (
    <tr className="drawing-ref-row" style={{ height: rowHeight }}>
      {visibleColumns.map((column) => (
        <td key={column.id} style={{ width: column.width }}>
          {column.id === 'name' ? (
            <div
              className="flex items-center gap-1.5"
              style={{ minHeight: rowHeight - 8, paddingLeft: `${indentPx}px` }}
            >
              <span className="text-plm-fg-dim text-[10px]">├</span>
              <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
              <span className="truncate text-xs text-plm-fg-muted">
                {t('drawingRefs.unresolved', 'References could not be read')}
              </span>
              <button
                className="flex items-center gap-1 flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-plm-bg-light text-plm-fg-dim hover:text-plm-fg"
                onClick={onRetry}
                title={t(
                  'drawingRefs.retryHint',
                  'Read again, opening the drawing in SolidWorks if needed',
                )}
              >
                <RotateCw size={10} />
                {t('drawingRefs.retry', 'Retry')}
              </button>
            </div>
          ) : (
            <span className="text-plm-fg-dim/50 text-[10px]">—</span>
          )}
        </td>
      ))}
    </tr>
  )
}

/**
 * Displays a referenced part/assembly under a drawing file row.
 * Shown when a user expands a `.slddrw` file to reveal which models
 * (parts and assemblies) the drawing references.
 *
 * When the item has multiple configurations (from DB enrichment),
 * shows an expand/collapse chevron and a config count badge.
 */
export const DrawingRefRow = memo(function DrawingRefRow({
  item,
  depth,
  rowHeight,
  visibleColumns,
  isExpanded,
  onClick,
  onContextMenu,
  onToggleExpand,
}: DrawingRefRowProps) {
  // Calculate indentation: base indent + depth + offset for nesting directly under file row
  const indentPx = 24 + depth * 16 + 16
  const hasConfigs = item.configurations && item.configurations.length > 0

  if (item.unresolved) {
    return (
      <UnresolvedDrawingRefRow
        indentPx={indentPx}
        rowHeight={rowHeight}
        visibleColumns={visibleColumns}
        onRetry={onToggleExpand}
      />
    )
  }

  return (
    <tr
      className="drawing-ref-row cursor-pointer hover:bg-plm-bg-light/50"
      style={{ height: rowHeight }}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
              {/* Expand/collapse chevron when configs available */}
              {hasConfigs ? (
                <button
                  className="flex-shrink-0 p-0 text-plm-fg-muted hover:text-plm-fg-dim"
                  onClick={onToggleExpand}
                  title={isExpanded ? 'Collapse configurations' : 'Expand configurations'}
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : null}
              <DrawingRefFileIcon fileType={item.file_type} size={12} />
              <span className="truncate text-xs text-plm-fg-dim">{item.file_name}</span>
              {/* Configuration count badge -- shown when multiple configs are referenced */}
              {hasConfigs && item.configurations!.length > 1 && (
                <span
                  className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-plm-bg-light text-plm-fg-muted"
                  title={`Configurations: ${item.configurations!.join(', ')}`}
                >
                  {item.configurations!.length} configs
                </span>
              )}
              {/* Single configuration badge */}
              {hasConfigs && item.configurations!.length === 1 && (
                <span
                  className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-plm-bg-light text-plm-fg-muted"
                  title={`Configuration: ${item.configurations![0]}`}
                >
                  {item.configurations![0]}
                </span>
              )}
              {/* Legacy single config badge (when no configs array, but config field is set) */}
              {!hasConfigs && item.configuration && (
                <span
                  className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-plm-bg-light text-plm-fg-muted"
                  title={`Configuration: ${item.configuration}`}
                >
                  {item.configuration}
                </span>
              )}
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
}, areDrawingRefRowPropsEqual)
