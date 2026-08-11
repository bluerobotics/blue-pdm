import { memo } from 'react'

import { t } from '@/lib/i18n'

import type { ConfigSectionGroup } from './rowTypes'

export interface ConfigEmptyRowProps {
  kind: ConfigSectionGroup
  configDepth: number
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
}

function areConfigEmptyRowPropsEqual(
  prevProps: ConfigEmptyRowProps,
  nextProps: ConfigEmptyRowProps,
): boolean {
  if (prevProps.kind !== nextProps.kind) return false
  if (prevProps.configDepth !== nextProps.configDepth) return false
  if (prevProps.rowHeight !== nextProps.rowHeight) return false

  if (prevProps.visibleColumns.length !== nextProps.visibleColumns.length) return false
  for (let i = 0; i < prevProps.visibleColumns.length; i++) {
    if (prevProps.visibleColumns[i].id !== nextProps.visibleColumns[i].id) return false
    if (prevProps.visibleColumns[i].width !== nextProps.visibleColumns[i].width) return false
  }

  return true
}

export const ConfigEmptyRow = memo(function ConfigEmptyRow({
  kind,
  configDepth,
  rowHeight,
  visibleColumns,
}: ConfigEmptyRowProps) {
  const indentPx = 24 + configDepth * 16 + 32
  const message =
    kind === 'drawings'
      ? t('source.configTree.noDrawings', 'No drawings reference this configuration')
      : t('source.configTree.noComponents', 'No components in this configuration')

  return (
    <tr className="config-empty-row" style={{ height: rowHeight }}>
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
              <span className="truncate text-xs text-plm-fg-muted">{message}</span>
            </div>
          ) : (
            <span className="text-plm-fg-dim/50 text-[10px]">—</span>
          )}
        </td>
      ))}
    </tr>
  )
}, areConfigEmptyRowPropsEqual)
