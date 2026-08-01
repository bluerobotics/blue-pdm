/**
 * Serves cached thumbnails to the renderer over a custom scheme.
 *
 * Going through Chromium's network stack rather than IPC means an `img` tag can
 * point straight at a file's thumbnail: the browser handles conditional
 * fetching, off-thread decoding, lazy loading and its own in-memory image
 * cache, and repeat paints during virtualized scrolling never re-enter
 * JavaScript at all. Because every URL carries the source file's version, the
 * responses can be marked immutable and the renderer needs no cache of its own.
 */

import { protocol, session } from 'electron'
import path from 'path'

import { getThumbnail, invalidateThumbnail } from './store'
import { isThumbnailTier, type ThumbnailProtocolDependencies } from './types'

export const THUMBNAIL_SCHEME = 'blueplm-thumb'

/** Host component of thumbnail URLs. Present only because a standard scheme needs one. */
const THUMBNAIL_HOST = 'thumb'

/** A year, the conventional maximum for content addressed by an immutable URL. */
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000

const IMMUTABLE_CACHE_CONTROL = `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`

/**
 * Extensions the scheme will act on. Anything else is rejected before touching
 * the filesystem, which keeps the handler from being usable as a general file
 * reader even for paths inside the vault.
 */
const ALLOWED_EXTENSIONS = new Set(['.sldprt', '.sldasm', '.slddrw'])

let deps: ThumbnailProtocolDependencies | null = null

/**
 * Must run before the app `ready` event, which is the only window in which
 * Electron accepts scheme privileges.
 */
export function registerThumbnailScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: THUMBNAIL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * Build a thumbnail URL for a source file.
 *
 * `version` should change whenever the file's content does; it is what makes
 * the immutable caching safe. The store still derives its own cache key from a
 * fresh stat, so a stale version here costs at most one redundant request.
 */
export function buildThumbnailUrl(filePath: string, tier: string, version: string): string {
  const params = new URLSearchParams({ tier, p: filePath, v: version })
  return `${THUMBNAIL_SCHEME}://${THUMBNAIL_HOST}/?${params.toString()}`
}

export function registerThumbnailProtocol(dependencies: ThumbnailProtocolDependencies): void {
  deps = dependencies

  protocol.handle(THUMBNAIL_SCHEME, async (request) => {
    try {
      return await handleRequest(request)
    } catch (error) {
      deps?.logWarn('[ThumbnailProtocol] Request failed', {
        url: request.url,
        error: String(error),
      })
      return notFound(false)
    }
  })
}

export function unregisterThumbnailProtocol(): void {
  try {
    protocol.unhandle(THUMBNAIL_SCHEME)
  } catch {
    // Not registered, e.g. when startup failed before this point.
  }
  deps = null
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)

  const tier = url.searchParams.get('tier') ?? ''
  const filePath = url.searchParams.get('p') ?? ''
  const configuration = url.searchParams.get('c') || undefined

  if (!isThumbnailTier(tier) || !filePath) return notFound(false)
  if (!isPathAllowed(filePath)) return notFound(false)

  if (url.searchParams.get('refresh') === '1') {
    await invalidateThumbnail(filePath, tier, configuration)
  }

  const result = await getThumbnail(filePath, tier, configuration)

  if (result.status === 'ok') {
    return new Response(new Uint8Array(result.image.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.image.mimeType,
        'Content-Length': String(result.image.buffer.length),
        'Cache-Control': IMMUTABLE_CACHE_CONTROL,
        // The scheme is a different origin from the app, and the renderer's
        // origin differs between dev and packaged builds.
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // A file that genuinely has no preview will not grow one until it changes,
  // and a change produces a different URL, so that answer is cacheable.
  // A transient failure must not be.
  return notFound(result.status === 'none')
}

function notFound(cacheable: boolean): Response {
  return new Response(null, {
    status: 404,
    headers: {
      'Cache-Control': cacheable ? IMMUTABLE_CACHE_CONTROL : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/**
 * Confine the scheme to CAD files inside the open vault.
 *
 * Path containment is checked on the resolved, normalized path so `..`
 * segments cannot walk out of the vault.
 */
function isPathAllowed(filePath: string): boolean {
  if (!deps) return false

  const vaultRoot = deps.getVaultRoot()
  if (!vaultRoot) return false

  if (!ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return false

  const resolved = path.resolve(filePath)
  const resolvedRoot = path.resolve(vaultRoot)

  const relative = path.relative(resolvedRoot, resolved)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Drop Chromium's cached responses for the scheme.
 *
 * Version-keyed URLs make this unnecessary for ordinary file edits; it exists
 * for the case where the underlying cache is cleared out from under the
 * browser and the two would otherwise disagree.
 */
export async function clearThumbnailHttpCache(): Promise<void> {
  try {
    await session.defaultSession.clearCache()
  } catch {
    // Best effort; a stale browser cache only means a redundant repaint.
  }
}
