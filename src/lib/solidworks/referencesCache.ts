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

import type { SWServiceReference } from './types'

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
 * @returns The service response, or undefined when the SolidWorks bridge is unavailable
 */
export function getSwReferencesCached(filePath: string): Promise<SwReferencesResult | undefined> {
  const key = normalizePath(filePath)
  const cached = cache.get(key)

  if (
    cached &&
    (cached.resolvedAt === null || Date.now() - cached.resolvedAt < REFERENCES_CACHE_TTL_MS)
  ) {
    return cached.promise
  }

  const promise = (async () => {
    const result = await window.electronAPI?.solidworks?.getReferences?.(filePath)

    // Only a successful read is worth reusing. Failures here are usually transient — the
    // service restarting, SolidWorks busy, a command timing out — so the next caller
    // should get a fresh attempt rather than a memoized error.
    if (result?.success) {
      const entry = cache.get(key)
      if (entry) entry.resolvedAt = Date.now()
    } else {
      cache.delete(key)
    }

    return result
  })().catch((error: unknown) => {
    cache.delete(key)
    throw error
  })

  cache.set(key, { promise, resolvedAt: null })

  return promise
}

/**
 * Drop all cached references. Call this when the set of files on disk may have changed,
 * so the next read reflects the new state.
 */
export function clearSwReferencesCache(): void {
  cache.clear()
}
