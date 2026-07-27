import { memo } from 'react'
import { icons as lucideIcons, Box } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { FileIcon, FileTypeIcon } from '@/components/shared/FileItem'
import type { LocalFile } from '@/stores/pdmStore'
import type { ItemImage, ItemPrimaryFile } from '@/types/item'

interface ItemThumbnailProps {
  primaryFile: ItemPrimaryFile | null
  override?: ItemImage
  size: number
  className?: string
}

// Below this size, skip SolidWorks thumbnail extraction (async IPC) and render a
// cheap extension-based icon instead. Matches the useThumbnail grid threshold.
const THUMBNAIL_MIN_SIZE = 64

/**
 * Renders an item's visual: an uploaded image or a chosen Lucide icon when an
 * override exists, otherwise the primary file's SolidWorks preview (falling back
 * to a file-type icon via the shared FileIcon).
 *
 * At small sizes (list views) the primary-file fallback uses the extension-based
 * FileTypeIcon to avoid per-row thumbnail IPC that makes large lists janky.
 */
export const ItemThumbnail = memo(function ItemThumbnail({
  primaryFile,
  override,
  size,
  className = '',
}: ItemThumbnailProps) {
  if (override?.type === 'image' && override.imageUrl) {
    return (
      <img
        src={override.imageUrl}
        alt=""
        className={`rounded object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  if (override?.type === 'icon' && override.iconName) {
    const IconComponent: LucideIcon = lucideIcons[override.iconName as keyof typeof lucideIcons] ?? Box
    return (
      <IconComponent
        size={size}
        className={`flex-shrink-0 ${className}`}
        style={{ color: override.iconColor || undefined }}
      />
    )
  }

  // Small sizes: extension-based icon only, no thumbnail extraction.
  if (size < THUMBNAIL_MIN_SIZE) {
    return (
      <FileTypeIcon
        extension={primaryFile?.extension ?? ''}
        size={size}
        className={className}
      />
    )
  }

  const fileLike = {
    path: primaryFile?.path ?? '',
    extension: primaryFile?.extension ?? '',
    isDirectory: primaryFile?.isDirectory ?? false,
  } as unknown as LocalFile

  return <FileIcon file={fileLike} size={size} className={className} />
})
