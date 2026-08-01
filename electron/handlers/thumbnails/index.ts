/**
 * Persistent thumbnail cache: a content-addressed store on disk plus the custom
 * scheme that serves it to the renderer.
 */

export {
  initThumbnailStore,
  getThumbnail,
  invalidateThumbnail,
  isCached,
  flushThumbnailStore,
  disposeThumbnailStore,
} from './store'

export {
  THUMBNAIL_SCHEME,
  registerThumbnailScheme,
  registerThumbnailProtocol,
  unregisterThumbnailProtocol,
  buildThumbnailUrl,
  clearThumbnailHttpCache,
} from './protocol'

export { prewarmFolder, cancelPrewarm } from './prewarm'

export { registerThumbnailIpcHandlers, unregisterThumbnailIpcHandlers } from './ipc'

export {
  TIER_MAX_EDGE_PX,
  isThumbnailTier,
  type ExtractedImage,
  type ThumbnailBytes,
  type ThumbnailExtractor,
  type ThumbnailProtocolDependencies,
  type ThumbnailResult,
  type ThumbnailStoreDependencies,
  type ThumbnailTier,
} from './types'
