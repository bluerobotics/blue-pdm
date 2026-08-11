/**
 * Discard Command
 *
 * Discard local changes and revert to the server version.
 * For files that exist locally: downloads the server file and releases the checkout.
 * For 'deleted' files (checked out but deleted locally): just releases the checkout.
 */

import type { Command, DiscardParams, CommandResult, LocalFile } from '../types'
import { getDiscardableFilesFromSelection, getFilesInFolder } from '../types'
import { ProgressTracker } from '../executor'
import { undoCheckout } from '../../supabase'
import { getDownloadUrl } from '../../storage'
import { isRetryableError, getNetworkErrorMessage, getBackoffDelay, sleep } from '../../network'
import { processWithConcurrency, CONCURRENT_OPERATIONS } from '../../concurrency'
import { log } from '@/lib/logger'
import { getCheckoutProfileForOwner } from '@/lib/checkout/checkoutDisplay'
import { FileOperationTracker } from '../../fileOperationTracker'
import { clearVaultCache } from '@/lib/cache/vaultFileCache'

const MAX_RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000
const UNDO_CHECKOUT_MAX_RETRIES = 2

function logDiscard(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[Discard]', message, context)
}

// Helper to get file context for logging
function getFileContext(file: LocalFile): Record<string, unknown> {
  return {
    fileName: file.name,
    relativePath: file.relativePath,
    fullPath: file.path,
    fileId: file.pdmData?.id,
    diffStatus: file.diffStatus,
    checkedOutBy: file.pdmData?.checked_out_by,
    checkedOutUser: getCheckoutProfileForOwner(file)?.email,
  }
}

// Helper to analyze why files were filtered out
function analyzeFilterResults(
  files: LocalFile[],
  folderPath: string,
  userId: string,
): {
  totalInFolder: number
  notSynced: number
  notCheckedOutByUser: number
  cloudOnly: number
  discardable: number
  samples: { notSynced: string[]; notCheckedOutByUser: string[]; cloudOnly: string[] }
} {
  const filesInFolder = getFilesInFolder(files, folderPath)
  const notSynced: LocalFile[] = []
  const notCheckedOutByUser: LocalFile[] = []
  const cloudOnly: LocalFile[] = []
  const discardable: LocalFile[] = []

  for (const f of filesInFolder) {
    if (!f.pdmData?.id) {
      notSynced.push(f)
    } else if (f.diffStatus === 'cloud') {
      cloudOnly.push(f)
    } else if (f.pdmData.checked_out_by !== userId) {
      notCheckedOutByUser.push(f)
    } else {
      discardable.push(f)
    }
  }

  return {
    totalInFolder: filesInFolder.length,
    notSynced: notSynced.length,
    notCheckedOutByUser: notCheckedOutByUser.length,
    cloudOnly: cloudOnly.length,
    discardable: discardable.length,
    samples: {
      notSynced: notSynced.slice(0, 3).map((f) => f.name),
      notCheckedOutByUser: notCheckedOutByUser
        .slice(0, 3)
        .map(
          (f) =>
            `${f.name} (by: ${getCheckoutProfileForOwner(f)?.email || f.pdmData?.checked_out_by || 'none'})`,
        ),
      cloudOnly: cloudOnly.slice(0, 3).map((f) => f.name),
    },
  }
}

export const discardCommand: Command<DiscardParams> = {
  id: 'discard',
  name: 'Discard Changes',
  description: 'Discard local changes and revert to server version',
  aliases: ['revert', 'reset'],
  usage: 'discard <path>',

  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot discard changes while offline'
    }

    if (!ctx.user) {
      return 'Please sign in first'
    }

    if (!ctx.organization) {
      return 'No organization connected'
    }

    if (!ctx.vaultPath) {
      return 'No vault path configured'
    }

    if (!files || files.length === 0) {
      return 'No files selected'
    }

    // Get files checked out by current user (includes 'deleted' files)
    const discardableFiles = getDiscardableFilesFromSelection(ctx.files, files, ctx.user?.id)

    // Log filter analysis for debugging
    const folders = files.filter((f) => f.isDirectory)
    if (folders.length > 0 && discardableFiles.length === 0) {
      for (const folder of folders) {
        const analysis = analyzeFilterResults(ctx.files, folder.relativePath, ctx.user.id)
        logDiscard('warn', 'No discardable files found in folder', {
          folder: folder.relativePath,
          userId: ctx.user.id,
          ...analysis,
        })
      }
    }

    if (discardableFiles.length === 0) {
      return 'No files checked out by you to discard'
    }

    return null
  },

  async execute({ files }, ctx): Promise<CommandResult> {
    const operationStart = performance.now()
    const user = ctx.user!
    const organization = ctx.organization!
    const operationId = `discard-${Date.now()}`

    // Get discardable files for tracker initialization
    const discardableFilesForTracker = getDiscardableFilesFromSelection(ctx.files, files, user.id)

    // Initialize file operation tracker for DevTools monitoring
    const tracker = FileOperationTracker.start(
      'discard',
      discardableFilesForTracker.length,
      discardableFilesForTracker.map((f) => f.relativePath),
    )

    logDiscard('info', 'Starting discard operation', {
      timestamp: Date.now(),
      operationId,
      userId: user.id,
      selectedFileCount: files.length,
      selectedFolders: files.filter((f) => f.isDirectory).map((f) => f.relativePath),
      selectedFiles: files.filter((f) => !f.isDirectory).map((f) => f.name),
      contextFilesCount: ctx.files.length,
    })

    // Get files checked out by current user (includes 'deleted' files)
    const filesToDiscard = getDiscardableFilesFromSelection(ctx.files, files, user.id)

    // Log detailed filter analysis for folders
    const folders = files.filter((f) => f.isDirectory)
    for (const folder of folders) {
      const analysis = analyzeFilterResults(ctx.files, folder.relativePath, user.id)
      logDiscard('info', 'Folder filter analysis', {
        operationId,
        folder: folder.relativePath,
        ...analysis,
      })
    }

    logDiscard('info', 'Files to discard after filtering', {
      operationId,
      count: filesToDiscard.length,
      files: filesToDiscard.map((f) => ({
        name: f.name,
        diffStatus: f.diffStatus,
        checkedOutBy: f.pdmData?.checked_out_by,
      })),
    })

    if (filesToDiscard.length === 0) {
      logDiscard('warn', 'No files to discard after filtering', {
        operationId,
        inputFilesCount: files.length,
      })
      tracker.endOperation('completed')
      return {
        success: true,
        message: 'No files to discard',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // Track folders and files being processed
    const foldersBeingProcessed = files.filter((f) => f.isDirectory).map((f) => f.relativePath)
    const filesBeingProcessed = filesToDiscard.map((f) => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...foldersBeingProcessed, ...filesBeingProcessed])]
    // NOTE: Don't add processing here - executor already did it via processingOperations
    ctx.addProcessingFoldersSync(foldersBeingProcessed, 'sync')

    // Yield to event loop so React can render spinners before starting operation
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Progress tracking
    const toastId = `discard-${Date.now()}`
    const total = filesToDiscard.length
    const progress = new ProgressTracker(
      ctx,
      'discard',
      toastId,
      `Discarding changes for ${total} file${total > 1 ? 's' : ''}...`,
      total,
    )

    let succeeded = 0
    let failed = 0
    const errors: string[] = []

    // Process all files in parallel, collect updates for batch store update
    const pendingUpdates: Array<{
      path: string
      updates: Parameters<typeof ctx.updateFileInStore>[1]
    }> = []

    // Track paths to remove from store (deleted files that will become cloud-only)
    const pathsToRemove: string[] = []

    // Start tracking the discard phase
    const discardStepId = tracker.startStep('Discard files', {
      fileCount: filesToDiscard.length,
      concurrency: CONCURRENT_OPERATIONS,
    })
    const discardPhaseStart = Date.now()

    const results = await processWithConcurrency(
      filesToDiscard,
      CONCURRENT_OPERATIONS,
      async (file) => {
        const fileCtx = getFileContext(file)

        try {
          const contentHash = file.pdmData?.content_hash

          if (!contentHash) {
            logDiscard('warn', 'File has no content hash', { operationId, ...fileCtx })
            progress.update()
            return { success: false, error: `${file.name}: No content hash` }
          }

          // Check if file actually exists locally (don't trust diffStatus alone)
          const fileExists = await window.electronAPI?.fileExists(file.path)
          const isDeletedLocally = !fileExists || file.diffStatus === 'deleted'

          logDiscard('debug', 'Processing file', {
            operationId,
            ...fileCtx,
            contentHash,
            fileExists,
            isDeletedLocally,
          })

          if (isDeletedLocally) {
            // For files that don't exist locally, just release checkout using undoCheckout
            // This is simpler than checkinFile and doesn't do any version/content logic
            const result = await undoCheckout(file.pdmData!.id, user.id)
            if (!result.success) {
              logDiscard('error', 'Failed to release checkout for deleted file', {
                operationId,
                ...fileCtx,
                error: result.error,
              })
              progress.update()
              return {
                success: false,
                error: `${file.name}: ${result.error || 'Failed to release checkout'}`,
              }
            }

            // Remove from store (will be re-added as 'cloud' on next refresh)
            pathsToRemove.push(file.path)
            logDiscard('debug', 'Released checkout for deleted file', { operationId, ...fileCtx })
          } else {
            // For files that exist locally, download server version to replace local changes
            await window.electronAPI?.setReadonly(file.path, false)

            // Download with retry logic (URL refreshed each attempt in case of expiry)
            let writeResult:
              | { success: boolean; error?: string; size?: number; hash?: string }
              | undefined
            let lastDownloadError: string | undefined

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
              const { url, error: urlError } = await getDownloadUrl(organization.id, contentHash)
              if (urlError || !url) {
                lastDownloadError = urlError || 'Failed to get download URL'
                logDiscard('error', 'Failed to get download URL', {
                  operationId,
                  ...fileCtx,
                  urlError,
                  attempt,
                })
                if (isRetryableError(lastDownloadError) && attempt < MAX_RETRY_ATTEMPTS) {
                  await sleep(getBackoffDelay(attempt, RETRY_BASE_DELAY_MS))
                  continue
                }
                break
              }

              writeResult = await window.electronAPI?.downloadUrl(url, file.path, contentHash)
              if (writeResult?.success) break

              lastDownloadError = writeResult?.error || 'Download failed'
              if (isRetryableError(lastDownloadError) && attempt < MAX_RETRY_ATTEMPTS) {
                logDiscard('warn', 'Download failed, retrying...', {
                  operationId,
                  fileName: file.name,
                  attempt,
                  error: lastDownloadError,
                  retryDelayMs: Math.round(getBackoffDelay(attempt, RETRY_BASE_DELAY_MS)),
                })
                await sleep(getBackoffDelay(attempt, RETRY_BASE_DELAY_MS))
              } else {
                break
              }
            }

            if (!writeResult?.success) {
              const userMessage = getNetworkErrorMessage(lastDownloadError || 'Download failed')
              logDiscard('error', 'Download failed after retries', {
                operationId,
                ...fileCtx,
                error: lastDownloadError,
              })
              // Restore read-only so the file isn't left writable without checkout
              await window.electronAPI?.setReadonly(file.path, true)
              progress.update()
              return { success: false, error: `${file.name}: ${userMessage}` }
            }

            // Release checkout with retry (file already has server content, so undo must succeed)
            let undoResult: { success: boolean; error?: string | null } = { success: false }
            for (let attempt = 0; attempt <= UNDO_CHECKOUT_MAX_RETRIES; attempt++) {
              undoResult = await undoCheckout(file.pdmData!.id, user.id)
              if (undoResult.success) break
              if (attempt < UNDO_CHECKOUT_MAX_RETRIES) {
                logDiscard('warn', 'undoCheckout failed, retrying...', {
                  operationId,
                  ...fileCtx,
                  error: undoResult.error,
                  attempt,
                })
                await sleep(1000)
              }
            }

            if (!undoResult.success) {
              logDiscard('error', 'Failed to release checkout after download succeeded', {
                operationId,
                ...fileCtx,
                error: undoResult.error,
              })
              // File has server content but checkout is still held -- report as failure
              // so the user knows to retry or force-release
              await window.electronAPI?.setReadonly(file.path, true)
              progress.update()
              return {
                success: false,
                error: `${file.name}: File reverted but checkout release failed — use Force Release`,
              }
            }

            await window.electronAPI?.setReadonly(file.path, true)
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: { ...file.pdmData!, checked_out_by: null, checked_out_user: null },
                localHash: writeResult.hash || contentHash,
                diffStatus: undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined,
              },
            })
            logDiscard('debug', 'Discarded file successfully', { operationId, ...fileCtx })
          }
          progress.update()
          return { success: true }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          logDiscard('error', 'Exception during discard', {
            operationId,
            ...fileCtx,
            error: errorMsg,
          })
          progress.update()
          return { success: false, error: `${file.name}: ${errorMsg}` }
        }
      },
    )

    // Count results and collect successfully discarded paths (before store update for logging)
    const discardedPaths: string[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.success) {
        succeeded++
        // Track path for clearing persisted pending metadata
        discardedPaths.push(filesToDiscard[i].path)

        // Mark file as recently modified to prevent realtime state drift
        // Stale realtime UPDATE events may arrive shortly after discard
        // and could revert the local state to pre-discard values (e.g., show as checked out again)
        const fileId = filesToDiscard[i].pdmData?.id
        if (fileId) {
          ctx.markFileAsRecentlyModified(fileId)
          // Clear the flag after 15 seconds (debounce window)
          setTimeout(() => ctx.clearRecentlyModified(fileId), 15000)
        }
      } else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }

    // End discard step
    tracker.endStep(discardStepId, 'completed', {
      succeeded,
      failed,
      durationMs: Date.now() - discardPhaseStart,
    })

    // Clear any persisted pending metadata for successfully discarded files
    // This ensures local metadata edits made during checkout are reverted
    if (discardedPaths.length > 0) {
      ctx.clearPersistedPendingMetadataForPaths(discardedPaths)
    }

    // ATOMIC UPDATE: Apply all store updates and clear processing in single render
    const storeUpdateStepId = tracker.startStep('Atomic store update', {
      updateCount: pendingUpdates.length,
    })
    const storeUpdateStart = performance.now()
    ctx.updateFilesAndClearProcessing(pendingUpdates, allPathsBeingProcessed)
    ctx.setLastOperationCompletedAt(Date.now())
    const storeUpdateDuration = Math.round(performance.now() - storeUpdateStart)
    tracker.endStep(storeUpdateStepId, 'completed', { durationMs: storeUpdateDuration })

    logDiscard('info', 'Atomic store update complete', {
      operationId,
      updatedFiles: pendingUpdates.length,
      processingPathsCleared: allPathsBeingProcessed.length,
      durationMs: storeUpdateDuration,
    })

    // Remove deleted files from store (they'll reappear as 'cloud' on next refresh)
    if (pathsToRemove.length > 0) {
      ctx.removeFilesFromStore(pathsToRemove)
      logDiscard('debug', 'Removed deleted files from store', { count: pathsToRemove.length })
    }

    // Invalidate vault cache so delta sync picks up checkout changes on next load.
    // undoCheckout now bumps updated_at, but clearing the cache is a safety net.
    if (succeeded > 0 && ctx.activeVaultId) {
      clearVaultCache(ctx.activeVaultId).catch((error) => {
        logDiscard('warn', 'Failed to clear vault cache after discard', { error: String(error) })
      })
    }

    const { duration } = progress.finish()

    const totalDurationMs = Math.round(performance.now() - operationStart)
    logDiscard('info', 'Discard operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration,
      totalDurationMs,
    })

    // NO onRefresh() call - incremental store updates are sufficient
    // The atomic updateFilesAndClearProcessing ensures correct state display

    // Show result
    if (failed > 0) {
      ctx.addToast('warning', `Discarded ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Discarded ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }

    // Complete operation tracking
    tracker.endOperation(failed === 0 ? 'completed' : 'failed', failed > 0 ? errors[0] : undefined)

    return {
      success: failed === 0,
      message:
        failed > 0
          ? `Discarded ${succeeded}/${total} files`
          : `Discarded ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    }
  },
}
