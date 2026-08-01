/**
 * Builds URLs for the `blueplm-thumb` scheme served by the Electron main process.
 *
 * Thumbnails are fetched by the browser itself rather than over IPC, so there is
 * no renderer-side cache to maintain: pointing an `img` at one of these URLs is
 * the whole client. Each URL embeds the source file's version, and the main
 * process marks responses immutable, so repeat paints during virtualized
 * scrolling are served from Chromium's image cache without re-entering
 * JavaScript or re-extracting anything.
 */

/** Must match THUMBNAIL_SCHEME in electron/handlers/thumbnails/protocol.ts. */
const THUMBNAIL_SCHEME = 'blueplm-thumb'

/** Host component. Present only because a standard scheme requires one. */
const THUMBNAIL_HOST = 'thumb'

/** File types that can carry an embedded SolidWorks preview. */
export const SW_THUMBNAIL_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

/**
 * Smallest grid card size that shows a preview rather than an extension icon.
 *
 * Applies to the icon-grid views only, matching their long-standing behavior.
 * Row-based views have no such floor: they showed previews at every row height
 * before the cache existed, and now cost even less to do so.
 */
export const MIN_THUMBNAIL_ICON_SIZE = 64

export type ThumbnailTier = 'grid' | 'preview'

/** The parts of a file the URL builder needs. */
export interface ThumbnailSource {
  path?: string
  extension: string
  isDirectory: boolean
  size?: number
  modifiedTime?: string
}

/**
 * Stand-in version for callers that do not carry file metadata.
 *
 * It keeps URLs stable within a session so the browser cache still works, and
 * changes across restarts so nothing is pinned indefinitely. The main process
 * always derives its own cache key from a fresh stat, so this only affects how
 * long Chromium may hold a previous image, never what gets stored.
 */
const SESSION_VERSION = `s${Date.now().toString(36)}`

export function supportsThumbnail(file: ThumbnailSource): boolean {
  if (file.isDirectory || !file.path) return false
  return SW_THUMBNAIL_EXTENSIONS.includes(file.extension.toLowerCase())
}

function resolveVersion(file: ThumbnailSource, versionOverride?: string): string {
  if (versionOverride) return versionOverride

  const modifiedMs = file.modifiedTime ? Date.parse(file.modifiedTime) : NaN
  if (Number.isNaN(modifiedMs) && file.size === undefined) return SESSION_VERSION

  return `${Number.isNaN(modifiedMs) ? 0 : modifiedMs}-${file.size ?? 0}`
}

export interface ThumbnailUrlOptions {
  /**
   * Change token to use in place of mtime and size, for callers that track
   * their own (item rows, for instance).
   */
  version?: string
  /**
   * Discards the cached entry and regenerates before responding. Every distinct
   * token produces a distinct URL, which is what lets a manual refresh get past
   * the browser's own cache.
   */
  refreshToken?: number
  /** CAD configuration whose preview to show, instead of the file's default. */
  configuration?: string
}

/** URL for a file's thumbnail, or null when the file cannot have one. */
export function buildThumbnailUrl(
  file: ThumbnailSource,
  tier: ThumbnailTier,
  options: ThumbnailUrlOptions = {},
): string | null {
  if (!supportsThumbnail(file) || !file.path) return null

  const params = new URLSearchParams({
    tier,
    p: file.path,
    v: resolveVersion(file, options.version),
  })

  if (options.configuration) {
    params.set('c', options.configuration)
  }

  if (options.refreshToken) {
    params.set('refresh', '1')
    params.set('r', String(options.refreshToken))
  }

  return `${THUMBNAIL_SCHEME}://${THUMBNAIL_HOST}/?${params.toString()}`
}
