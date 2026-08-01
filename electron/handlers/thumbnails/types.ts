/**
 * Shared types for the persistent thumbnail cache.
 *
 * Kept in their own module so `store.ts` and `protocol.ts` can depend on them
 * without either importing the other.
 */

/**
 * Size class of a cached image.
 *
 * `grid` feeds file browser icons, `preview` feeds the details/datacard panels.
 * The tier is part of the cache key, so both can coexist for one source file.
 */
export type ThumbnailTier = 'grid' | 'preview'

/** Longest edge, in pixels, that a cached image of each tier is scaled down to. */
export const TIER_MAX_EDGE_PX: Record<ThumbnailTier, number> = {
  grid: 256,
  preview: 1024,
}

export function isThumbnailTier(value: string): value is ThumbnailTier {
  return value === 'grid' || value === 'preview'
}

/** Raw image bytes as pulled out of a CAD file, before normalization. */
export interface ExtractedImage {
  buffer: Buffer
  mimeType: string
}

/**
 * Pulls an image out of a source file, or resolves null when the file
 * legitimately has none (which the store records as a negative entry).
 *
 * `configuration` selects a specific CAD configuration's preview; omitting it
 * asks for the file's default.
 */
export type ThumbnailExtractor = (
  filePath: string,
  tier: ThumbnailTier,
  configuration?: string,
) => Promise<ExtractedImage | null>

export interface ThumbnailStoreDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
  logWarn: (message: string, data?: unknown) => void
  extract: ThumbnailExtractor
}

export interface ThumbnailProtocolDependencies {
  logWarn: (message: string, data?: unknown) => void
  /**
   * Current vault root. The protocol handler refuses paths outside it, so a
   * compromised renderer cannot turn the thumbnail scheme into an arbitrary
   * file read.
   */
  getVaultRoot: () => string | null
}

/** A resolved cache hit, ready to be written to an HTTP response. */
export interface ThumbnailBytes {
  buffer: Buffer
  mimeType: string
}

/**
 * Outcome of a thumbnail lookup.
 *
 * `none` and `unavailable` both mean "no image", but they must not be conflated
 * at the HTTP layer: `none` is durable knowledge that the file has no preview
 * and is safe to cache against the file's version, whereas `unavailable` means
 * the extraction could not be completed right now and must stay retryable.
 */
export type ThumbnailResult =
  | { status: 'ok'; image: ThumbnailBytes }
  | { status: 'none' }
  | { status: 'unavailable' }
