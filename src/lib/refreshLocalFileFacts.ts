import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import { log } from '@/lib/logger'

/**
 * Re-reads the on-disk facts for a single file and writes them into the store.
 *
 * Needed wherever we write a file ourselves and suppress the resulting vault reload.
 * Without it the store keeps the pre-write hash, size and mtime, so checkin takes its
 * fast path on a stale hash and skips the version increment, and diff status lags.
 */
export async function refreshLocalFileFacts(file: Pick<LocalFile, 'path'>): Promise<void> {
  const updates: Partial<LocalFile> = {}

  try {
    const hashResult = await window.electronAPI?.hashFile(file.path)
    if (hashResult?.success && hashResult.hash) {
      updates.localHash = hashResult.hash
    } else {
      // Clearing is safer than keeping a hash that no longer matches disk.
      updates.localHash = undefined
      log.warn('[LocalFileFacts]', 'Failed to rehash after write; clearing stale localHash', {
        path: file.path,
        error: hashResult?.error,
      })
    }
  } catch (error) {
    updates.localHash = undefined
    log.warn('[LocalFileFacts]', 'Exception rehashing after write; clearing stale localHash', {
      path: file.path,
      error: String(error),
    })
  }

  try {
    const statResult = await window.electronAPI?.statFile(file.path)
    if (statResult?.success) {
      if (typeof statResult.size === 'number') updates.size = statResult.size
      if (statResult.modifiedTime) updates.modifiedTime = statResult.modifiedTime
    }
  } catch (error) {
    // Size/mtime staleness is cosmetic compared to the hash, so this is non-fatal.
    log.warn('[LocalFileFacts]', 'Failed to stat after write', {
      path: file.path,
      error: String(error),
    })
  }

  usePDMStore.getState().updateFileInStore(file.path, updates)
}
