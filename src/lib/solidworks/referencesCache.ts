/**
 * Coalescing cache for SolidWorks `getReferences` lookups.
 *
 * A single drawing save fans out to independent consumers — the metadata sync pulls the
 * parent model's properties, and the background sync upserts the `file_references` table.
 * Both need the same reference list, neither knows about the other, and reading references
 * routes through the SolidWorks COM API where calls are serialized in the service's command
 * queue. A duplicate therefore costs seconds of wall clock, not milliseconds.
 *
 * Consumers reacting to a file-watcher batch should call `clearSwReferencesCache()` once at
 * the start of the batch and then read through `getSwReferencesCached()`, which guarantees
 * every entry is "as of the current batch". The TTL is only a backstop for callers outside
 * that pattern.
 */

import { normalizePath } from './pathMatching'

import { REFERENCES_UNRESOLVED } from './types'
import type { SWServiceReference, SwReferenceOrigin } from './types'

/** Backstop lifetime for a resolved entry; watcher batches normally clear well before this. */
const REFERENCES_CACHE_TTL_MS = 30_000

export interface SwReferencesResult {
  success: boolean
  data?: {
    filePath: string
    references: SWServiceReference[]
    count: number
  }
  error?: string
}

/**
 * Whether the service declined to answer, as opposed to answering "none".
 *
 * Every consumer that writes references to the database must check this before recording an
 * absence: an unresolved read carries no information about what the file references.
 */
export function isReferencesUnresolved(result: SwReferencesResult | undefined): boolean {
  return result?.error === REFERENCES_UNRESOLVED
}

interface CacheEntry {
  promise: Promise<SwReferencesResult | undefined>
  /** Null while the call is still in flight. */
  resolvedAt: number | null
}

const cache = new Map<string, CacheEntry>()

/**
 * Read a file's SolidWorks references, sharing one call between concurrent or closely
 * spaced callers.
 *
 * @param filePath - Absolute path to the drawing or assembly
 * @param origin - Who asked. Background reads are answered headlessly and queue behind
 *   interactive work; a foreground read may escalate to opening the document. Defaults to
 *   background so a caller that has not thought about it cannot surprise the user with a window.
 * @returns The service response, or undefined when the SolidWorks bridge is unavailable
 */
export function getSwReferencesCached(
  filePath: string,
  origin: SwReferenceOrigin = 'background',
): Promise<SwReferencesResult | undefined> {
  const key = normalizePath(filePath)
  const cached = cache.get(key)

  // A foreground read is a deliberate retry of something the background tier could not answer,
  // so it must not be served the cached failure or a background call still in flight.
  if (
    cached &&
    origin !== 'foreground' &&
    (cached.resolvedAt === null || Date.now() - cached.resolvedAt < REFERENCES_CACHE_TTL_MS)
  ) {
    return cached.promise
  }

  // Held by reference so a call this one superseded cannot mark it resolved when it lands.
  let entry: CacheEntry | undefined

  const promise = (async () => {
    const result = await window.electronAPI?.solidworks?.getReferences?.(filePath, origin)

    // Only a successful read is worth reusing. Failures here are usually transient — the
    // service restarting, SolidWorks busy, a command timing out — so the next caller
    // should get a fresh attempt rather than a memoized error.
    const current = entry
    if (current !== undefined && cache.get(key) === current) {
      if (result?.success) current.resolvedAt = Date.now()
      else cache.delete(key)
    }

    return result
  })().catch((error: unknown) => {
    if (entry !== undefined && cache.get(key) === entry) cache.delete(key)
    throw error
  })

  entry = { promise, resolvedAt: null }
  cache.set(key, entry)

  return promise
}

/**
 * Drop all cached references. Call this when the set of files on disk may have changed,
 * so the next read reflects the new state.
 */
export function clearSwReferencesCache(): void {
  cache.clear()
}
