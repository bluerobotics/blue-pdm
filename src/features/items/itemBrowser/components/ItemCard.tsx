import { memo } from 'react'

import { useThumbnail } from '@/features/source/browser/components/FileGrid/hooks'
import { FileCardIcon } from '@/features/source/browser/components/FileGrid/FileCardIcon'
import type { ItemFileType, ItemImage, ItemRow } from '@/types/item'

import { ItemThumbnail } from './ItemThumbnail'

const FILE_TYPE_LABELS: Record<ItemFileType, string> = {
  part: 'PART',
  assembly: 'ASM',
  drawing: 'DRW',
  pdf: 'PDF',
  step: 'STEP',
  other: 'OTHER',
}

interface ItemCardProps {
  row: ItemRow
  iconSize: number
  override?: ItemImage
  onContextMenu?: (event: React.MouseEvent) => void
}

/**
 * Grid/icon card for a single item, mirroring the file-browser FileCard visuals
 * (thumbnail preview + icon fallback) but showing item-centric metadata.
 */
export const ItemCard = memo(function ItemCard({
  row,
  iconSize,
  override,
  onContextMenu,
}: ItemCardProps) {
  const previewFile = row.primaryFile ?? {
    name: row.itemNumber,
    extension: '',
    isDirectory: false,
  }

  const thumbnail = useThumbnail({
    file: previewFile,
    iconSize,
    isProcessing: false,
  })

  const showDetails = iconSize >= 80
  const hasOverride = override?.type === 'icon' || override?.type === 'image'

  return (
    <div
      className="relative flex flex-col items-center p-2 rounded-lg cursor-default group/card transition-colors duration-100 hover:bg-plm-bg-lighter"
      style={{ width: iconSize + 24 }}
      title={row.itemNumber}
      onContextMenu={onContextMenu}
    >
      {/* File count badge (top right) */}
      <div className="absolute top-1 right-1 z-10 text-[10px] font-medium px-1.5 py-0.5 rounded bg-plm-bg/80 text-plm-fg-muted tabular-nums">
        {row.fileCount}
      </div>

      {/* Icon / thumbnail */}
      <div
        className="flex items-center justify-center relative z-0"
        style={{ width: iconSize, height: iconSize }}
      >
        {hasOverride ? (
          <ItemThumbnail primaryFile={row.primaryFile} override={override} size={iconSize} />
        ) : (
          <FileCardIcon
            file={previewFile}
            iconSize={iconSize}
            thumbnail={thumbnail.thumbnail}
            thumbnailError={thumbnail.thumbnailError}
            loadingThumbnail={thumbnail.loadingThumbnail}
            folderIconColor=""
            onThumbnailError={() => thumbnail.setThumbnailError(true)}
          />
        )}
      </div>

      {/* Item number */}
      <div
        className="mt-1 text-center w-full px-1"
        style={{ fontSize: Math.max(10, Math.min(12, iconSize / 8)) }}
      >
        <div className="truncate font-medium text-plm-fg">{row.itemNumber}</div>
        {showDetails && row.description && (
          <div className="truncate text-plm-fg-muted text-xs">{row.description}</div>
        )}
      </div>

      {/* State badge */}
      {row.workflowStateName && showDetails && (
        <div
          className="mt-1 px-1.5 py-0.5 rounded text-center max-w-full truncate"
          style={{
            fontSize: Math.max(8, Math.min(10, iconSize / 10)),
            backgroundColor: row.workflowStateColor
              ? `${row.workflowStateColor}30`
              : 'var(--plm-bg)',
            color: row.workflowStateColor || 'var(--plm-fg-muted)',
          }}
          title={row.workflowStateName}
        >
          {row.workflowStateName}
        </div>
      )}

      {/* File-type badges */}
      {showDetails && row.fileTypes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 justify-center">
          {row.fileTypes.map((type) => (
            <span
              key={type}
              className="text-[9px] font-medium px-1 py-0.5 rounded bg-plm-bg text-plm-fg-muted"
            >
              {FILE_TYPE_LABELS[type]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})
