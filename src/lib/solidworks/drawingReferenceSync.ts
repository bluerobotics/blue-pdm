/**
 * Keeps `file_references` in sync with drawings that change on disk.
 *
 * A drawing saved in SolidWorks should update the reverse lookup — "which drawings reference this
 * part?" — without waiting for a check-in. The watcher tells us which drawings changed; this reads
 * each one's references and upserts them.
 *
 * The shape of that work is the whole point of this module. It used to be a timer per drawing, all
 * armed at once, each firing an independent read: a watcher batch of 88 drawings became 88
 * concurrent jobs against a SolidWorks command queue with a concurrency of one. The queue took
 * minutes to drain, and because a save often lands while the previous batch is still draining, the
 * next batch piled on top of work that was already stale.
 *
 * It is now one job. A new batch supersedes the running one rather than joining it, reads run
 * sequentially at background priority, and the reads the superseded batch left in the queue are
 * cancelled instead of drained.
 */

import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import { upsertFileReferences } from '@/lib/supabase'
import type { SWReference } from '@/lib/supabase'

import { getSwReferencesCached, isReferencesUnresolved } from './referencesCache'
import type { SWServiceReference } from './types'

/** Collapse rapid successive saves of the same drawing into one read. */
const BATCH_DEBOUNCE_MS = 3_000

interface BatchContext {
  orgId: string
  vaultId: string
  vaultPath: string
}

/**
 * Identifies the batch currently allowed to write. A batch checks this between drawings and stops
 * as soon as a newer one has claimed it, so at most one batch is ever doing work.
 */
let currentBatchId = 0

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** Drawings whose reads have not started yet, accumulated across watcher events while debouncing. */
const pendingRelativePaths = new Set<string>()

/**
 * Note that drawings changed on disk and schedule a reference sync for them.
 *
 * Fire-and-forget: never blocks, never throws, and never surfaces an error to the user. A failed
 * read leaves the previous references in place, which is the right answer until we know better.
 *
 * @param changedRelativePaths - Vault-relative paths from the file watcher, of any type
 */
export function syncDrawingReferencesInBackground(changedRelativePaths: string[]): void {
  if (!window.electronAPI?.solidworks?.getReferences) return

  const drawingPaths = changedRelativePaths.filter((p) => p.toLowerCase().endsWith('.slddrw'))
  if (drawingPaths.length === 0) return

  for (const relativePath of drawingPaths) {
    pendingRelativePaths.add(relativePath)
  }

  log.debug('[DrawingRefSync]', 'Queued changed drawings', {
    added: drawingPaths.length,
    pending: pendingRelativePaths.size,
  })

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void startBatch()
  }, BATCH_DEBOUNCE_MS)
}

/**
 * Abandon any scheduled or running batch. Used when the vault or user changes, where finishing the
 * previous batch would write references into the wrong vault.
 */
export function cancelDrawingReferenceSync(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingRelativePaths.clear()
  currentBatchId++
}

async function startBatch(): Promise<void> {
  const { user, organization, activeVaultId, vaultPath } = usePDMStore.getState()
  if (!user || !organization?.id || !activeVaultId || !vaultPath) {
    pendingRelativePaths.clear()
    return
  }

  const relativePaths = Array.from(pendingRelativePaths)
  pendingRelativePaths.clear()
  if (relativePaths.length === 0) return

  const batchId = ++currentBatchId

  // Reads the previous batch queued describe a state of the disk this batch has already replaced.
  await window.electronAPI?.solidworks?.cancelBackgroundReferences?.('newer drawing batch')

  const context: BatchContext = {
    orgId: organization.id,
    vaultId: activeVaultId,
    vaultPath,
  }

  const startedAt = Date.now()
  let synced = 0
  let unresolved = 0
  let skipped = 0

  log.debug('[DrawingRefSync]', 'Batch started', { batchId, drawings: relativePaths.length })

  for (const relativePath of relativePaths) {
    if (batchId !== currentBatchId) {
      log.debug('[DrawingRefSync]', 'Batch superseded', { batchId, remaining: relativePaths.length })
      return
    }

    const outcome = await syncOneDrawing(relativePath, context)
    if (outcome === 'synced') synced++
    else if (outcome === 'unresolved') unresolved++
    else skipped++
  }

  log.debug('[DrawingRefSync]', 'Batch finished', {
    batchId,
    synced,
    unresolved,
    skipped,
    durationMs: Date.now() - startedAt,
  })
}

type DrawingSyncOutcome = 'synced' | 'unresolved' | 'skipped'

/**
 * Read one drawing's references and upsert them.
 *
 * Returns `unresolved` when the service could not read the file at all. That case deliberately
 * writes nothing: replacing a drawing's references with an empty set because a read failed is how
 * the reverse lookup silently empties out, and it is exactly what a wrong Document Manager search
 * filter did for as long as unresolved and empty were the same value on the wire.
 */
async function syncOneDrawing(
  relativePath: string,
  context: BatchContext,
): Promise<DrawingSyncOutcome> {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  const file = usePDMStore
    .getState()
    .files.find((f) => f.relativePath.replace(/\\/g, '/').toLowerCase() === normalized)

  if (!file?.pdmData?.id) {
    log.debug('[DrawingRefSync]', 'Skipping unsynced drawing', { relativePath })
    return 'skipped'
  }

  const fileId = file.pdmData.id

  try {
    const result = await getSwReferencesCached(file.path, 'background')

    if (isReferencesUnresolved(result)) {
      log.debug('[DrawingRefSync]', 'References unresolved, leaving existing rows alone', {
        relativePath,
      })
      return 'unresolved'
    }

    if (!result?.success || !result.data?.references) {
      log.debug('[DrawingRefSync]', 'No references returned', {
        relativePath,
        success: result?.success,
        error: result?.error,
      })
      return 'skipped'
    }

    const swRefs = result.data.references

    // Drawing references are always type 'reference'; 'component' is for assembly BOM rows.
    const references: SWReference[] = swRefs.map((ref) => ({
      childFilePath: ref.path,
      quantity: 1,
      referenceType: 'reference' as const,
    }))

    const upsertResult = await upsertFileReferences(
      context.orgId,
      context.vaultId,
      fileId,
      references,
      context.vaultPath,
    )

    if (!upsertResult.success) {
      log.debug('[DrawingRefSync]', 'Reference upsert failed', {
        relativePath,
        error: upsertResult.error,
      })
      return 'skipped'
    }

    log.debug('[DrawingRefSync]', 'References synced', {
      relativePath,
      inserted: upsertResult.inserted,
      updated: upsertResult.updated,
      deleted: upsertResult.deleted,
      skipped: upsertResult.skipped,
    })

    invalidateCachedDrawingDataForReferences(swRefs)
    return 'synced'
  } catch (error) {
    log.debug('[DrawingRefSync]', 'Error syncing drawing references', {
      relativePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return 'skipped'
  }
}

/**
 * Invalidates cached configDrawingData entries for files referenced by a drawing.
 *
 * The `configDrawingData` cache (keyed as "filePath::configName") stores which drawings reference a
 * particular part/assembly configuration. When a drawing's references change, the cached "which
 * drawings reference me" data for the referenced parts/assemblies becomes stale and must be cleared
 * so the UI fetches fresh data on next expand.
 */
function invalidateCachedDrawingDataForReferences(swRefs: SWServiceReference[]): void {
  const { configDrawingData, files } = usePDMStore.getState()

  if (configDrawingData.size === 0) return

  const referencedFileNames = new Set(swRefs.map((ref) => ref.fileName.toLowerCase()))
  const keysToInvalidate: string[] = []

  for (const configKey of Array.from(configDrawingData.keys())) {
    const separatorIndex = configKey.indexOf('::')
    if (separatorIndex === -1) continue

    const filePath = configKey.substring(0, separatorIndex)
    const matchingFile = files.find(
      (f) => f.relativePath === filePath || f.relativePath.replace(/\\/g, '/') === filePath,
    )

    if (matchingFile && referencedFileNames.has(matchingFile.name.toLowerCase())) {
      keysToInvalidate.push(configKey)
    }
  }

  if (keysToInvalidate.length === 0) return

  log.debug('[DrawingRefSync]', 'Invalidating cached drawing data', {
    count: keysToInvalidate.length,
  })

  for (const configKey of keysToInvalidate) {
    usePDMStore.getState().clearConfigDrawingData(configKey)
  }
}
