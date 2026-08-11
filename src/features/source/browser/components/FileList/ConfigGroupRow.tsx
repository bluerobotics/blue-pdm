import React, { memo } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

import { t } from '@/lib/i18n'

import type { ConfigSectionGroup } from './rowTypes'

export interface ConfigGroupRowProps {
  group: ConfigSectionGroup
  configDepth: number
  isExpanded: boolean
  isLoading: boolean
  count: number
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  onToggle: (e: React.MouseEvent) => void
}

function areConfigGroupRowPropsEqual(
  prevProps: ConfigGroupRowProps,
  nextProps: ConfigGroupRowProps,
): boolean {
  if (prevProps.group !== nextProps.group) return false
  if (prevProps.configDepth !== nextProps.configDepth) return false
  if (prevProps.isExpanded !== nextProps.isExpanded) return false
  if (prevProps.isLoading !== nextProps.isLoading) return false
  if (prevProps.count !== nextProps.count) return false
  if (prevProps.rowHeight !== nextProps.rowHeight) return false

  if (prevProps.visibleColumns.length !== nextProps.visibleColumns.length) return false
  for (let i = 0; i < prevProps.visibleColumns.length; i++) {
    if (prevProps.visibleColumns[i].id !== nextProps.visibleColumns[i].id) return false
    if (prevProps.visibleColumns[i].width !== nextProps.visibleColumns[i].width) return false
  }

  return true
}

export const ConfigGroupRow = memo(function ConfigGroupRow({
  group,
  configDepth,
  isExpanded,
  isLoading,
  count,
  rowHeight,
  visibleColumns,
  onToggle,
}: ConfigGroupRowProps) {
  const indentPx = 24 + configDepth * 16 + 32
  const label =
    group === 'drawings'
      ? t('source.configTree.drawings', 'Drawings')
      : t('source.configTree.ebom', 'eBOM')
  const toggleTitle = isExpanded
    ? t('source.configTree.collapse', 'Collapse')
    : t('source.configTree.expand', 'Expand')

  return (
    <tr className="config-group-row hover:bg-plm-bg-light/50" style={{ height: rowHeight }}>
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
              <button
                onClick={onToggle}
                className="p-0.5 -ml-1 hover:bg-plm-bg-light rounded transition-colors"
                title={toggleTitle}
                aria-label={toggleTitle}
              >
                {isLoading ? (
                  <Loader2 size={10} className="text-plm-fg-muted animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown size={10} className="text-plm-fg-muted" />
                ) : (
                  <ChevronRight size={10} className="text-plm-fg-muted" />
                )}
              </button>
              <span className="truncate text-xs text-plm-fg-dim">{label}</span>
              <span className="text-[10px] text-plm-fg-dim">({count})</span>
            </div>
          ) : (
            <span className="text-plm-fg-dim/50 text-[10px]">—</span>
          )}
        </td>
      ))}
    </tr>
  )
}, areConfigGroupRowPropsEqual)
