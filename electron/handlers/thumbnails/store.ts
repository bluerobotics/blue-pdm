/**
 * Persistent, content-addressed thumbnail cache.
 *
 * Entries are keyed by a hash of the source path plus its mtime and size, so
 * validity follows file identity rather than elapsed time: an unchanged file is
 * never re-extracted, and a changed file lands on a different key and is
 * regenerated without any explicit invalidation call. Extraction of a CAD
 * preview costs a COM round-trip through the SolidWorks service, which is
 * serialized behind a single-command queue, so avoiding repeat work here is
 * what keeps browsing responsive.
 */

import { app, nativeImage } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { ThumbnailManifest } from './manifest'
import {
  TIER_MAX_EDGE_PX,
  type ExtractedImage,
  type ThumbnailBytes,
  type ThumbnailResult,
  type ThumbnailStoreDependencies,
  type ThumbnailTier,
} from './types'

/**
 * Bumped when normalization changes in a way that makes previously cached
 * images undesirable. It is part of every key, so a bump orphans the old
 * entries and lets eviction reclaim them.
 */
const CACHE_FORMAT_VERSION = 1

const CACHE_DIR_NAME = 'thumbnail-cache'

/** Characters of the hash used as a subdirectory, to keep directories small. */
const SHARD_LENGTH = 2

/** Disk budget for cached images. Negative entries are free and excluded. */
const MAX_CACHE_BYTES = 250 * 1024 * 1024

/** Sweep down to this fraction of the budget, so eviction is not continuous. */
const EVICTION_TARGET_RATIO = 0.8

/** Cap on remembered "this file has no preview" markers. */
const MAX_NEGATIVE_ENTRIES = 20_000

/** How often to re-check the disk budget. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

/** Extension marking a cached negative result. */
const NEGATIVE_EXT = 'none'

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  bmp: 'image/bmp',
  gif: 'image/gif',
  webp: 'image/webp',
}

let deps: ThumbnailStoreDependencies | null = null
let manifest: ThumbnailManifest | null = null
let cacheRoot = ''
let sweepTimer: NodeJS.Timeout | null = null
let initPromise: Promise<void> | null = null

/** Generations in progress, keyed by cache hash, so parallel requests share one extraction. */
const inFlight = new Map<string, Promise<ThumbnailResult>>()

const UNAVAILABLE: ThumbnailResult = { status: 'unavailable' }
const NONE: ThumbnailResult = { status: 'none' }

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function computeHash(
  filePath: string,
  tier: ThumbnailTier,
  mtimeMs: number,
  size: number,
  configuration?: string,
): string {
  const key = [
    normalizePath(filePath),
    Math.round(mtimeMs),
    size,
    tier,
    configuration ?? '',
    CACHE_FORMAT_VERSION,
  ].join('|')

  return crypto.createHash('sha1').update(key).digest('hex')
}

function entryPath(hash: string, ext: string): string {
  return path.join(cacheRoot, hash.slice(0, SHARD_LENGTH), `${hash}.${ext}`)
}

export async function initThumbnailStore(dependencies: ThumbnailStoreDependencies): Promise<void> {
  if (initPromise) return initPromise

  deps = dependencies
  cacheRoot = path.join(app.getPath('userData'), CACHE_DIR_NAME)

  initPromise = (async () => {
    try {
      await fs.promises.mkdir(cacheRoot, { recursive: true })

      manifest = new ThumbnailManifest(cacheRoot, dependencies.logError)

      const loaded = await manifest.load()
      if (!loaded) {
        dependencies.log('[ThumbnailCache] Manifest unavailable, rebuilding from disk')
        await manifest.rebuildFromDisk()
      }

      dependencies.log('[ThumbnailCache] Ready', {
        entries: manifest.size,
        megabytes: Math.round(manifest.bytes / (1024 * 1024)),
      })

      await sweep()

      sweepTimer = setInterval(() => {
        void sweep()
      }, SWEEP_INTERVAL_MS)
      sweepTimer.unref?.()
    } catch (error) {
      dependencies.logError('[ThumbnailCache] Initialization failed', { error: String(error) })
      manifest = null
    }
  })()

  return initPromise
}

/**
 * Identity of a source file as the cache understands it. Null when the file is
 * gone, which callers treat as "nothing to serve".
 */
async function statSource(filePath: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return null
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

/**
 * Resolve a thumbnail, generating it only on a true miss.
 *
 * The source file is stat-ed here rather than trusting a caller-supplied
 * version, so a stale caller can cause a redundant request but never a stale
 * image.
 */
export async function getThumbnail(
  filePath: string,
  tier: ThumbnailTier,
  configuration?: string,
): Promise<ThumbnailResult> {
  if (initPromise) await initPromise
  if (!manifest || !deps) return UNAVAILABLE

  const identity = await statSource(filePath)
  if (!identity) return NONE

  const hash = computeHash(filePath, tier, identity.mtimeMs, identity.size, configuration)

  const cached = await readEntry(hash)
  if (cached) return cached

  const existing = inFlight.get(hash)
  if (existing) return existing

  const generation = generate(filePath, tier, hash, configuration).finally(() => {
    inFlight.delete(hash)
  })
  inFlight.set(hash, generation)

  return generation
}

/**
 * Discard the cached entry for a file, so the next lookup regenerates it.
 *
 * Ordinary edits do not need this, since a changed file lands on a different
 * key by itself. It exists for the manual refresh action, where the user is
 * telling us the stored image is wrong.
 */
export async function invalidateThumbnail(
  filePath: string,
  tier: ThumbnailTier,
  configuration?: string,
): Promise<void> {
  if (initPromise) await initPromise
  if (!manifest) return

  const identity = await statSource(filePath)
  if (!identity) return

  const hash = computeHash(filePath, tier, identity.mtimeMs, identity.size, configuration)
  const entry = manifest.get(hash)
  if (!entry) return

  await removeEntry(hash, entry.negative ? NEGATIVE_EXT : entry.ext)
}

/**
 * Whether there is nothing left to generate for a file: it already has a cached
 * result of either kind, one is being produced right now, or the file is gone.
 * Prewarm uses this to skip work that is already done or pointless.
 */
export async function isCached(filePath: string, tier: ThumbnailTier): Promise<boolean> {
  if (initPromise) await initPromise
  if (!manifest) return false

  const identity = await statSource(filePath)
  if (!identity) return true

  const hash = computeHash(filePath, tier, identity.mtimeMs, identity.size)
  return manifest.get(hash) !== undefined || inFlight.has(hash)
}

/** Read a cached entry, or `undefined` when the key is not in the cache at all. */
async function readEntry(hash: string): Promise<ThumbnailResult | undefined> {
  const entry = manifest?.get(hash)
  if (!entry) return undefined

  if (entry.negative) {
    manifest?.touch(hash)
    return NONE
  }

  try {
    const buffer = await fs.promises.readFile(entryPath(hash, entry.ext))
    manifest?.touch(hash)
    return {
      status: 'ok',
      image: { buffer, mimeType: EXT_TO_MIME[entry.ext] ?? 'application/octet-stream' },
    }
  } catch {
    // Indexed but gone from disk, so the index is wrong. Drop it and let the
    // caller regenerate.
    manifest?.delete(hash)
    return undefined
  }
}

async function generate(
  filePath: string,
  tier: ThumbnailTier,
  hash: string,
  configuration?: string,
): Promise<ThumbnailResult> {
  if (!deps || !manifest) return UNAVAILABLE

  let extracted: ExtractedImage | null = null
  try {
    extracted = await deps.extract(filePath, tier, configuration)
  } catch (error) {
    // A failed extraction is not proof the file has no preview (the service may
    // simply be busy or restarting), so it stays retryable rather than being
    // recorded as a negative.
    deps.logWarn('[ThumbnailCache] Extraction failed', {
      path: filePath,
      error: String(error),
    })
    return UNAVAILABLE
  }

  const normalized = extracted ? normalizeImage(extracted, tier) : null

  if (!normalized) {
    await writeNegative(filePath, hash)
    return NONE
  }

  await writeImage(filePath, hash, normalized)
  return { status: 'ok', image: normalized }
}

async function writeImage(
  filePath: string,
  hash: string,
  image: ThumbnailBytes,
): Promise<void> {
  const ext = MIME_TO_EXT[image.mimeType]
  if (!ext || !manifest || !deps) return

  const target = entryPath(hash, ext)

  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    // Write then rename so a crash mid-write cannot leave a truncated image
    // that the index would happily serve.
    const tempPath = `${target}.tmp`
    await fs.promises.writeFile(tempPath, image.buffer)
    await fs.promises.rename(tempPath, target)

    manifest.set(hash, {
      sourcePath: filePath,
      bytes: image.buffer.length,
      lastAccess: Date.now(),
      negative: false,
      ext,
    })
  } catch (error) {
    deps.logError('[ThumbnailCache] Failed to write entry', {
      path: filePath,
      error: String(error),
    })
  }
}

async function writeNegative(filePath: string, hash: string): Promise<void> {
  if (!manifest) return

  const target = entryPath(hash, NEGATIVE_EXT)

  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, '')

    manifest.set(hash, {
      sourcePath: filePath,
      bytes: 0,
      lastAccess: Date.now(),
      negative: true,
      ext: '',
    })
  } catch {
    // The marker is an optimization; failing to persist it only costs a retry.
  }
}

/**
 * Scale down to the tier's bound and re-encode as PNG.
 *
 * The CFB fallback can yield uncompressed BMP, where a 256x256 preview is a
 * quarter of a megabyte, so re-encoding is worth the decode. When the bytes are
 * in a format `nativeImage` cannot read, they are stored untouched: Chromium
 * still renders them in an `img`, we just miss the size reduction.
 */
function normalizeImage(image: ExtractedImage, tier: ThumbnailTier): ThumbnailBytes | null {
  const passthrough = MIME_TO_EXT[image.mimeType]
    ? { buffer: image.buffer, mimeType: image.mimeType }
    : null

  try {
    const native = nativeImage.createFromBuffer(image.buffer)
    if (native.isEmpty()) return passthrough

    const { width, height } = native.getSize()
    if (width <= 0 || height <= 0) return passthrough

    const maxEdge = TIER_MAX_EDGE_PX[tier]
    const needsResize = width > maxEdge || height > maxEdge
    const resized = needsResize
      ? native.resize(
          width >= height ? { width: maxEdge, quality: 'best' } : { height: maxEdge, quality: 'best' },
        )
      : native

    const encoded = resized.toPNG()
    if (encoded.length === 0) return passthrough

    // Re-encoding an already-compressed source can inflate it; keep whichever
    // is smaller as long as the original is a format we can index.
    if (passthrough && !needsResize && passthrough.buffer.length <= encoded.length) {
      return passthrough
    }

    return { buffer: encoded, mimeType: 'image/png' }
  } catch {
    return passthrough
  }
}

/**
 * Bring the cache back under its disk budget, oldest access first.
 *
 * Negative markers occupy no space, so they cannot be evicted by byte pressure
 * and are capped by count instead.
 */
async function sweep(): Promise<void> {
  if (!manifest || !deps) return

  const byAge = manifest.entriesByAge()
  let removed = 0

  if (manifest.bytes > MAX_CACHE_BYTES) {
    const target = MAX_CACHE_BYTES * EVICTION_TARGET_RATIO

    for (const [hash, entry] of byAge) {
      if (manifest.bytes <= target) break
      if (entry.negative) continue
      await removeEntry(hash, entry.ext)
      removed++
    }
  }

  const negatives = byAge.filter(([, entry]) => entry.negative)
  if (negatives.length > MAX_NEGATIVE_ENTRIES) {
    for (const [hash] of negatives.slice(0, negatives.length - MAX_NEGATIVE_ENTRIES)) {
      await removeEntry(hash, NEGATIVE_EXT)
      removed++
    }
  }

  if (removed > 0) {
    deps.log('[ThumbnailCache] Evicted entries', {
      removed,
      remaining: manifest.size,
      megabytes: Math.round(manifest.bytes / (1024 * 1024)),
    })
    await manifest.flush()
  }
}

async function removeEntry(hash: string, ext: string): Promise<void> {
  await fs.promises.rm(entryPath(hash, ext || NEGATIVE_EXT), { force: true }).catch(() => undefined)
  manifest?.delete(hash)
}

export async function flushThumbnailStore(): Promise<void> {
  await manifest?.flush()
}

export async function disposeThumbnailStore(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  await manifest?.flush()
  manifest?.dispose()
  inFlight.clear()
  manifest = null
  deps = null
  initPromise = null
}
