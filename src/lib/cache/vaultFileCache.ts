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
import {
  hashCheckoutIdentifier,
  isCheckoutProfileForOwner,
  type CheckoutUserProfile,
} from '@/types/pdm'

/**
 * Cached server file extends LightweightFile with user profile info.
 * This allows us to preserve checked_out_user data across cache loads,
 * preventing the "SO" (Someone) avatar fallback when files are refreshed.
 */
export interface CachedServerFile extends LightweightFile {
  checked_out_user?: CheckoutUserProfile | null
}

export interface CacheWriteContext {
  requestId?: string
  isCurrent?: () => boolean
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
// v3 -> v4: Profiles gained owner IDs; old unkeyed profiles are not safe to migrate
const DB_VERSION = 4
const STORE_NAME = 'vault-files'

// Cache expiry - if cache is older than this, do a full refresh
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let dbPromise: Promise<IDBDatabase> | null = null
const vaultWriteQueues = new Map<string, Promise<void>>()

function enqueueVaultWrite(
  vaultId: string,
  operation: () => Promise<void>,
  context?: CacheWriteContext,
): Promise<void> {
  const previous = vaultWriteQueues.get(vaultId) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(async () => {
    if (context?.isCurrent && !context.isCurrent()) {
      log.debug('[VaultCache]', 'Discarding stale cache write before transaction', {
        vaultId: hashCheckoutIdentifier(vaultId),
        requestId: context.requestId,
        stale: true,
      })
      return
    }

    await operation()
  })

  vaultWriteQueues.set(vaultId, queued)
  queued.then(
    () => {
      if (vaultWriteQueues.get(vaultId) === queued) vaultWriteQueues.delete(vaultId)
    },
    () => {
      if (vaultWriteQueues.get(vaultId) === queued) vaultWriteQueues.delete(vaultId)
    },
  )
  return queued
}

function sanitizeCachedFile(file: CachedServerFile): CachedServerFile {
  if (isCheckoutProfileForOwner(file.checked_out_user, file.checked_out_by)) {
    return file
  }

  const { checked_out_user: _checkedOutUser, ...withoutProfile } = file
  return withoutProfile
}

function isCacheContextCurrent(context?: CacheWriteContext): boolean {
  return !context?.isCurrent || context.isCurrent()
}

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

        const files = entry.files.map(sanitizeCachedFile)
        const discardedProfiles = entry.files.filter(
          (file, index) => file.checked_out_user && !files[index].checked_out_user,
        ).length
        if (discardedProfiles > 0) {
          log.warn('[VaultCache]', 'Discarded cache profiles without matching owners', {
            orgId: hashCheckoutIdentifier(orgId),
            vaultId: hashCheckoutIdentifier(vaultId),
            discardedProfiles,
          })
        }

        resolve({
          files,
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
  context?: CacheWriteContext,
): Promise<void> {
  return enqueueVaultWrite(
    vaultId,
    async () => {
      const writeStart = performance.now()
      try {
        const db = await openDB()
        const validatedFiles = files.map(sanitizeCachedFile)

        // Compute watermark as MAX(updated_at)
        let maxUpdatedAt = ''
        for (const file of validatedFiles) {
          if (file.updated_at && file.updated_at > maxUpdatedAt) {
            maxUpdatedAt = file.updated_at
          }
        }

        const watermark = maxUpdatedAt || new Date().toISOString()
        const entry: VaultCacheEntry = {
          vaultId,
          orgId,
          files: validatedFiles,
          watermark,
          cachedAt: Date.now(),
        }

        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite')
          const store = transaction.objectStore(STORE_NAME)

          // Revalidate immediately before the write, while this transaction is still authoritative.
          if (!isCacheContextCurrent(context)) {
            log.debug('[VaultCache]', 'Discarding stale full cache write in transaction', {
              orgId: hashCheckoutIdentifier(orgId),
              vaultId: hashCheckoutIdentifier(vaultId),
              requestId: context?.requestId,
              stale: true,
            })
            transaction.abort()
            resolve()
            return
          }

          const request = store.put(entry)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })

        log.info('[VaultCache]', 'Cached server files', {
          orgId: hashCheckoutIdentifier(orgId),
          vaultId: hashCheckoutIdentifier(vaultId),
          requestId: context?.requestId,
          fileCount: validatedFiles.length,
          latencyMs: Math.round(performance.now() - writeStart),
        })
      } catch (error) {
        log.error('[VaultCache]', 'Error writing cache', {
          orgId: hashCheckoutIdentifier(orgId),
          vaultId: hashCheckoutIdentifier(vaultId),
          requestId: context?.requestId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    context,
  )
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
  const fileMap = new Map(cachedFiles.map((file) => [file.id, sanitizeCachedFile(file)]))

  for (const delta of deltaFiles) {
    if (delta.is_deleted || delta.deleted_at) {
      // File was deleted - remove from cache
      fileMap.delete(delta.id)
    } else {
      // File was added or updated - upsert
      // Preserve checked_out_user if the checkout user hasn't changed
      const existing = fileMap.get(delta.id)
      const preserveUserInfo =
        existing?.checked_out_user &&
        isCheckoutProfileForOwner(existing.checked_out_user, delta.checked_out_by) &&
        existing.checked_out_by === delta.checked_out_by

      const nextFile: CachedServerFile = {
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
      }
      fileMap.set(delta.id, sanitizeCachedFile(nextFile))
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
  fetchFullFn: () => Promise<{ files: CachedServerFile[] | null; error: unknown }>,
  context?: CacheWriteContext,
): Promise<{
  files: CachedServerFile[] | null
  error: unknown
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
    log.info('[VaultCache]', 'Cache hit', {
      orgId: hashCheckoutIdentifier(orgId),
      vaultId: hashCheckoutIdentifier(vaultId),
      requestId: context?.requestId,
      fileCount: cached.files.length,
      watermark: cached.watermark,
    })

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
      void setCachedVaultFiles(orgId, vaultId, mergedFiles, context)

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
  log.info('[VaultCache]', 'Cache miss, doing full fetch', {
    orgId: hashCheckoutIdentifier(orgId),
    vaultId: hashCheckoutIdentifier(vaultId),
    requestId: context?.requestId,
  })

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
  void setCachedVaultFiles(orgId, vaultId, files, context)

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
export function updateCachedUserInfo(
  vaultId: string,
  userInfoMap: Record<string, CheckoutUserProfile>,
): Promise<void>
export function updateCachedUserInfo(
  orgId: string,
  vaultId: string,
  userInfoMap: Record<string, CheckoutUserProfile>,
  context?: CacheWriteContext,
): Promise<void>
export function updateCachedUserInfo(
  first: string,
  second: string | Record<string, CheckoutUserProfile>,
  third?: Record<string, CheckoutUserProfile>,
  context?: CacheWriteContext,
): Promise<void> {
  const orgId: string | null = typeof second === 'string' ? first : null
  const vaultId: string = typeof second === 'string' ? second : first
  const userInfoMap: Record<string, CheckoutUserProfile> | undefined =
    typeof second === 'string' ? third : second

  if (!userInfoMap) return Promise.resolve()

  return enqueueVaultWrite(
    vaultId,
    async () => {
      const updateStart = performance.now()
      try {
        const db = await openDB()

        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, 'readwrite')
          const store = transaction.objectStore(STORE_NAME)

          if (!isCacheContextCurrent(context)) {
            log.debug('[VaultCache]', 'Discarding stale profile cache write in transaction', {
              orgId: hashCheckoutIdentifier(orgId),
              vaultId: hashCheckoutIdentifier(vaultId),
              requestId: context?.requestId,
              stale: true,
            })
            transaction.abort()
            resolve()
            return
          }

          const getRequest = store.get(vaultId)
          getRequest.onsuccess = () => {
            const entry = getRequest.result as VaultCacheEntry | undefined
            if (!entry || (orgId !== null && entry.orgId !== orgId)) {
              resolve()
              return
            }

            if (!isCacheContextCurrent(context)) {
              log.debug('[VaultCache]', 'Discarding stale profile cache write after read', {
                orgId: hashCheckoutIdentifier(orgId),
                vaultId: hashCheckoutIdentifier(vaultId),
                requestId: context?.requestId,
                stale: true,
              })
              transaction.abort()
              resolve()
              return
            }

            let updatedCount = 0
            const updatedFiles = entry.files.map((file) => {
              const profile = userInfoMap[file.id]
              if (
                profile &&
                file.checked_out_by === profile.id &&
                isCheckoutProfileForOwner(profile, file.checked_out_by)
              ) {
                updatedCount++
                return { ...file, checked_out_user: profile }
              }
              return sanitizeCachedFile(file)
            })

            if (updatedCount === 0) {
              resolve()
              return
            }

            entry.files = updatedFiles
            const putRequest = store.put(entry)
            putRequest.onsuccess = () => resolve()
            putRequest.onerror = () => reject(putRequest.error)
          }

          getRequest.onerror = () => reject(getRequest.error)
        })

        log.info('[VaultCache]', 'Updated cached checkout profiles', {
          orgId: hashCheckoutIdentifier(orgId),
          vaultId: hashCheckoutIdentifier(vaultId),
          requestId: context?.requestId,
          profileCount: Object.keys(userInfoMap).length,
          latencyMs: Math.round(performance.now() - updateStart),
        })
      } catch (error) {
        log.error('[VaultCache]', 'Error updating cached user info', {
          orgId: hashCheckoutIdentifier(orgId),
          vaultId: hashCheckoutIdentifier(vaultId),
          requestId: context?.requestId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    context,
  )
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
