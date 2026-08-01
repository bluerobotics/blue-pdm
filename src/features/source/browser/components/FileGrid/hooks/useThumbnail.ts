import { useMemo } from 'react'

import { useRetryableImage } from '@/hooks/useRetryableImage'
import {
  MIN_THUMBNAIL_ICON_SIZE,
  buildThumbnailUrl,
  type ThumbnailSource,
} from '@/lib/thumbnailUrl'

export interface UseThumbnailParams {
  file: ThumbnailSource
  iconSize: number
  isProcessing: boolean
  /** Change token to use in place of the file's mtime and size, when known. */
  version?: string
}

export interface ThumbnailState {
  thumbnail: string | null
  onThumbnailError: () => void
}

/**
 * Resolve the thumbnail URL for a SolidWorks file.
 *
 * The browser performs the fetch, so this is a pure derivation with no request
 * of its own: a card that scrolls back into view renders the same URL and
 * Chromium serves it from cache.
 */
export function useThumbnail({
  file,
  iconSize,
  isProcessing,
  version,
}: UseThumbnailParams): ThumbnailState {
  const { path, extension, isDirectory, size, modifiedTime } = file

  const url = useMemo(() => {
    // A file mid-operation may be partially written, so leave it to the icon.
    if (isProcessing || iconSize < MIN_THUMBNAIL_ICON_SIZE) return null
    return buildThumbnailUrl({ path, extension, isDirectory, size, modifiedTime }, 'grid', {
      version,
    })
  }, [path, extension, isDirectory, size, modifiedTime, iconSize, isProcessing, version])

  const { src, onError } = useRetryableImage(url)

  return { thumbnail: src, onThumbnailError: onError }
}
