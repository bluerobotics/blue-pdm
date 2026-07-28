/**
 * Vault File Cache - IndexedDB-based caching for server files
 *
 * Provides instant loading for subsequent app boots by:
 * 1. Storing all server files locally in IndexedDB
 * 2. Recording a "watermark" timestamp of the last sync
 * 3. On next boot, loading from cache instantly, then fetching only deltas
 *
 * Performance: For 25,000 files:
 * - First load: ~1s (full fetch + cache write)
 * - Subsequent loads: ~100-200ms (cache read + small delta fetch)
 */

import { getFilesDelta, LightweightFile, DeltaFile } from '@/lib/supabase/files/queries'
import { log } from '@/lib/logger'

/**
 * Cached server file extends LightweightFile with user profile info.
 * This allows us to preserve checked_out_user data across cache loads,
 * preventing the "SO" (Someone) avatar fallback when files are refreshed.
 */
export interface CachedServerFile extends LightweightFile {
  checked_out_user?: {
    email: string
    full_name: string | null
    avatar_url?: string
  } | null
}

interface VaultCacheEntry {
  vaultId: string
  orgId: string
  files: CachedServerFile[]
  watermark: string // ISO timestamp - MAX(updated_at) from files
  cachedAt: number // Date.now() when cached
}

const DB_NAME = 'blueplm-vault-cache'
// IMPORTANT: Bump this version to force cache clear on app update
// v1 -> v2: Fixed Supabase 1000 row limit bug
// v2 -> v3: Rows gained custom_properties; cached rows without it would leave files
//           looking permanently modified until their next delta update
const DB_VERSION = 3
const STORE_NAME = 'vault-files'

// Cache expiry - if cache is older than this, do a full refresh
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Open or create the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      log.error('[VaultCache]', 'Failed to open IndexedDB', { error: request.error })
      reject(request.error)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Delete old object store on version upgrade (clears corrupted cache)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME)
        log.info('[VaultCache]', 'Cleared old cache on version upgrade')
      }

      // Create fresh object store
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'vaultId' })
      store.createIndex('orgId', 'orgId', { unique: false })
      store.createIndex('cachedAt', 'cachedAt', { unique: false })
    }
  })

  return dbPromise
}

/**
 * Get cached files for a vault
 * Returns null if no cache exists or cache is expired
 */
export async function getCachedVaultFiles(
  orgId: string,
  vaultId: string,
): Promise<{ files: CachedServerFile[]; watermark: string } | null> {
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(vaultId)

      request.onsuccess = () => {
        const entry = request.result as VaultCacheEntry | undefined

        if (!entry) {
          resolve(null)
          return
        }

        // Check if cache belongs to same org
        if (entry.orgId !== orgId) {
          resolve(null)
          return
        }

        // Check if cache is expired
        if (Date.now() - entry.cachedAt > CACHE_MAX_AGE_MS) {
          log.info('[VaultCache]', 'Cache expired, will refresh')
          resolve(null)
          return
        }

        resolve({
          files: entry.files,
          watermark: entry.watermark,
        })
      }

      request.onerror = () => {
        log.error('[VaultCache]', 'Failed to read cache', { error: request.error })
        resolve(null)
      }
    })
  } catch (error) {
    log.error('[VaultCache]', 'Error reading cache', { error })
    return null
  }
}

/**
 * Save files to cache with watermark
 */
export async function setCachedVaultFiles(
  orgId: string,
  vaultId: string,
  files: CachedServerFile[],
): Promise<void> {
  try {
    const db = await openDB()

    // Compute watermark as MAX(updated_at)
    let maxUpdatedAt = ''
    for (const file of files) {
      if (file.updated_at && file.updated_at > maxUpdatedAt) {
        maxUpdatedAt = file.updated_at
      }
    }

    // Fallback to now if no files
    const watermark = maxUpdatedAt || new Date().toISOString()

    const entry: VaultCacheEntry = {
      vaultId,
      orgId,
      files,
      watermark,
      cachedAt: Date.now(),
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(entry)

      request.onsuccess = () => {
        log.info('[VaultCache]', `Cached ${files.length} files, watermark: ${watermark}`)
        resolve()
      }

      request.onerror = () => {
        log.error('[VaultCache]', 'Failed to write cache', { error: request.error })
        reject(request.error)
      }
    })
  } catch (error) {
    log.error('[VaultCache]', 'Error writing cache', { error })
  }
}

/**
 * Apply delta changes to cached files
 * Handles: new files, updated files, deleted files
 * Preserves checked_out_user info from existing cache when checkout hasn't changed
 */
export function applyDeltaToCache(
  cachedFiles: CachedServerFile[],
  deltaFiles: DeltaFile[],
): CachedServerFile[] {
  // Create map for O(1) lookup by ID
  const fileMap = new Map(cachedFiles.map((f) => [f.id, f]))

  for (const delta of deltaFiles) {
    if (delta.is_deleted || delta.deleted_at) {
      // File was deleted - remove from cache
      fileMap.delete(delta.id)
    } else {
      // File was added or updated - upsert
      // Preserve checked_out_user if the checkout user hasn't changed
      const existing = fileMap.get(delta.id)
      const preserveUserInfo =
        existing?.checked_out_user && existing.checked_out_by === delta.checked_out_by

      fileMap.set(delta.id, {
        id: delta.id,
        file_path: delta.file_path,
        file_name: delta.file_name,
        extension: delta.extension,
        file_type: delta.file_type,
        part_number: delta.part_number,
        description: delta.description,
        revision: delta.revision,
        version: delta.version,
        content_hash: delta.content_hash,
        file_size: delta.file_size,
        state: delta.state,
        checked_out_by: delta.checked_out_by,
        checked_out_at: delta.checked_out_at,
        updated_at: delta.updated_at,
        custom_properties: delta.custom_properties,
        // Preserve user info if checkout user hasn't changed
        checked_out_user: preserveUserInfo ? existing!.checked_out_user : undefined,
      })
    }
  }

  return Array.from(fileMap.values())
}

/**
 * Fetch files with caching - main entry point
 *
 * Strategy:
 * 1. Try to load from cache
 * 2. If cache hit, fetch delta and merge
 * 3. If cache miss, do full fetch and cache result
 *
 * @returns files and timing info for metrics
 */
export async function getFilesWithCache(
  orgId: string,
  vaultId: string,
  fetchFullFn: () => Promise<{ files: CachedServerFile[] | null; error: any }>,
): Promise<{
  files: CachedServerFile[] | null
  error: any
  cacheHit: boolean
  deltaCount: number
  timing: {
    cacheReadMs: number
    fetchMs: number
    mergeMs: number
  }
}> {
  const timing = {
    cacheReadMs: 0,
    fetchMs: 0,
    mergeMs: 0,
  }

  // Try cache first
  const cacheStart = performance.now()
  const cached = await getCachedVaultFiles(orgId, vaultId)
  timing.cacheReadMs = Math.round(performance.now() - cacheStart)

  if (cached) {
    // Cache hit - fetch only delta
    log.info('[VaultCache]', `Cache hit: ${cached.files.length} files, watermark: ${cached.watermark}`)

    const fetchStart = performance.now()
    const { files: deltaFiles, error } = await getFilesDelta(orgId, vaultId, cached.watermark)
    timing.fetchMs = Math.round(performance.now() - fetchStart)

    if (error) {
      log.error('[VaultCache]', 'Delta fetch failed, using cache only', { error })
      return {
        files: cached.files,
        error: null, // Don't fail - we have cache
        cacheHit: true,
        deltaCount: 0,
        timing,
      }
    }

    const deltaCount = deltaFiles?.length || 0
    log.info('[VaultCache]', `Delta: ${deltaCount} changes since ${cached.watermark}`)

    if (deltaCount > 0) {
      // Merge delta into cache
      const mergeStart = performance.now()
      const mergedFiles = applyDeltaToCache(cached.files, deltaFiles!)
      timing.mergeMs = Math.round(performance.now() - mergeStart)

      // Update cache with merged data
      setCachedVaultFiles(orgId, vaultId, mergedFiles).catch((err) => {
        log.error('[VaultCache]', 'Failed to update cache after delta', { error: err })
      })

      return {
        files: mergedFiles,
        error: null,
        cacheHit: true,
        deltaCount,
        timing,
      }
    }

    // No changes - return cache as-is
    return {
      files: cached.files,
      error: null,
      cacheHit: true,
      deltaCount: 0,
      timing,
    }
  }

  // Cache miss - full fetch
  log.info('[VaultCache]', 'Cache miss, doing full fetch')

  const fetchStart = performance.now()
  const { files, error } = await fetchFullFn()
  timing.fetchMs = Math.round(performance.now() - fetchStart)

  if (error || !files) {
    return {
      files,
      error,
      cacheHit: false,
      deltaCount: 0,
      timing,
    }
  }

  // Cache the result for next time
  setCachedVaultFiles(orgId, vaultId, files).catch((err) => {
    log.error('[VaultCache]', 'Failed to cache files', { error: err })
  })

  return {
    files,
    error: null,
    cacheHit: false,
    deltaCount: 0,
    timing,
  }
}

/**
 * Update cached files with user info.
 * Called after background task fetches checked_out_user data.
 * This persists user info to IndexedDB so subsequent loads have it immediately.
 */
export async function updateCachedUserInfo(
  vaultId: string,
  userInfoMap: Record<string, { email: string; full_name: string | null; avatar_url?: string }>,
): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const getRequest = store.get(vaultId)

      getRequest.onsuccess = () => {
        const entry = getRequest.result as VaultCacheEntry | undefined
        if (!entry) {
          resolve()
          return
        }

        // Update files with user info
        let updatedCount = 0
        const updatedFiles = entry.files.map((f) => {
          if (f.id in userInfoMap && f.checked_out_by) {
            updatedCount++
            return { ...f, checked_out_user: userInfoMap[f.id] }
          }
          return f
        })

        if (updatedCount > 0) {
          entry.files = updatedFiles
          const putRequest = store.put(entry)
          putRequest.onsuccess = () => {
            log.info('[VaultCache]', `Updated ${updatedCount} files with user info`)
            resolve()
          }
          putRequest.onerror = () => {
            log.error('[VaultCache]', 'Failed to update user info', { error: putRequest.error })
            resolve()
          }
        } else {
          resolve()
        }
      }

      getRequest.onerror = () => {
        log.error('[VaultCache]', 'Failed to read cache for user info update', { error: getRequest.error })
        resolve()
      }
    })
  } catch (error) {
    log.error('[VaultCache]', 'Error updating user info', { error })
  }
}

/**
 * Clear cache for a specific vault
 */
export async function clearVaultCache(vaultId: string): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(vaultId)

      request.onsuccess = () => {
        log.info('[VaultCache]', `Cleared cache for vault ${vaultId}`)
        resolve()
      }

      request.onerror = () => {
        log.error('[VaultCache]', 'Failed to clear cache', { error: request.error })
        reject(request.error)
      }
    })
  } catch (error) {
    log.error('[VaultCache]', 'Error clearing cache', { error })
  }
}

/**
 * Clear all vault caches
 */
export async function clearAllVaultCaches(): Promise<void> {
  try {
    const db = await openDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => {
        log.info('[VaultCache]', 'Cleared all caches')
        resolve()
      }

      request.onerror = () => {
        log.error('[VaultCache]', 'Failed to clear all caches', { error: request.error })
        reject(request.error)
      }
    })
  } catch (error) {
    log.error('[VaultCache]', 'Error clearing all caches', { error })
  }
}

// Expose cache utilities on window for DevTools console access
if (typeof window !== 'undefined') {
  ;(window as any).__clearVaultCache = clearVaultCache // TODO: type this
  ;(window as any).__clearAllVaultCaches = clearAllVaultCaches // TODO: type this
}
