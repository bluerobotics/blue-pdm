/**
 * Delete Commands
 *
 * Optimized batch deletion using the new deleteBatch IPC handler.
 *
 * - delete-local: Remove local copies (keeps server version)
 * - delete-server: Soft delete from server (moves to trash)
 *
 * UI behavior:
 * - Files remain visible with spinners during deletion
 * - Store updates happen AFTER deletion completes (not optimistic)
 * - Both file tree and main browser update together when done
 *
 * Performance optimizations:
 * - Uses deleteBatch() for single IPC call instead of N individual calls
 * - Uses atomic updateFilesAndClearProcessing() for single-render updates
 * - Uses removeProcessingFoldersSync() for immediate UI update when done
 * - No onRefresh() calls - all updates are incremental
 */

import type {
  Command,
  DeleteLocalParams,
  DeleteServerParams,
  CommandResult,
  LocalFile,
} from '../types'
import {
  getSyncedFilesFromSelection,
  getUnsyncedFilesFromSelection,
  getFilesCheckedOutByOthers,
} from '../types'
import { checkinFile, softDeleteFile, deleteFolderByPath } from '../../supabase'
import { processWithConcurrency, CONCURRENT_OPERATIONS } from '../../concurrency'
import { log } from '@/lib/logger'
import { FileOperationTracker } from '../../fileOperationTracker'
import { removeFromSyncIndex } from '../../cache/localSyncIndex'
import { clearVaultCache } from '../../cache/vaultFileCache'

// Helper for timing-based logging
function logDelete(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown> = {},
) {
  log[level]('[Delete]', message, { ...context, timestamp: Date.now() })
}

// ============================================
// Type Definitions
// ============================================

/**
 * Result from a single file deletion in the batch
 */
interface BatchDeleteFileResult {
  path: string
  success: boolean
  error?: string
}

/**
 * Summary statistics from the batch delete operation
 */
interface BatchDeleteSummary {
  total: number
  succeeded: number
  failed: number
  duration: number
}

/**
 * Result from the deleteBatch IPC call
 */
interface BatchDeleteResult {
  success: boolean
  results: BatchDeleteFileResult[]
  summary: BatchDeleteSummary
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extracts human-readable error messages from batch delete results.
 * Categorizes errors by type (locked files vs other errors).
 */
function extractDeleteErrors(
  results: BatchDeleteFileResult[],
  filesToRemove: LocalFile[],
): { errors: string[]; lockedFileErrors: string[] } {
  const errors: string[] = []
  const lockedFileErrors: string[] = []

  // Build a path-to-name lookup for readable error messages
  const pathToName = new Map(filesToRemove.map((f) => [f.path, f.name]))

  for (const result of results) {
    if (!result.success && result.error) {
      const fileName =
        pathToName.get(result.path) || result.path.split(/[/\\]/).pop() || result.path
      const errorMsg = `${fileName}: ${result.error}`

      // Check if error is due to locked file (EBUSY, EPERM, resource busy, etc.)
      if (
        result.error.includes('EBUSY') ||
        result.error.includes('EPERM') ||
        result.error.includes('operation not permitted') ||
        result.error.includes('resource busy') ||
        result.error.includes('locked')
      ) {
        lockedFileErrors.push(errorMsg)
      }
      errors.push(errorMsg)
      log.error('[Delete]', 'Failed to remove local file', {
        path: result.path,
        error: result.error,
      })
    }
  }

  return { errors, lockedFileErrors }
}

/**
 * Generates appropriate toast message for delete results.
 * Handles locked files, single file errors, and batch error summaries.
 */
function showDeleteResultToast(
  ctx: { addToast: (type: 'success' | 'warning' | 'error' | 'info', message: string) => void },
  succeeded: number,
  failed: number,
  total: number,
  errors: string[],
  lockedFileErrors: string[],
): void {
  if (failed > 0) {
    const isAllLocked = lockedFileErrors.length === errors.length && errors.length > 0

    if (isAllLocked) {
      // All failures are due to locked files - give helpful message
      const fileNames = lockedFileErrors.map((e) => e.split(':')[0]).join(', ')
      if (succeeded === 0) {
        ctx.addToast(
          'error',
          `Cannot delete - file${failed > 1 ? 's' : ''} open in another app: ${fileNames}`,
        )
      } else {
        ctx.addToast(
          'warning',
          `Removed ${succeeded}/${total}. ${failed} file${failed > 1 ? 's' : ''} locked (close in SolidWorks): ${fileNames}`,
        )
      }
    } else if (total === 1 && errors.length > 0) {
      // Single file - show specific error
      ctx.addToast('warning', `Failed to remove: ${errors[0]}`)
    } else if (errors.length === 1) {
      // Multiple files but only one error - show it
      ctx.addToast('warning', `Removed ${succeeded}/${total} local files. Error: ${errors[0]}`)
    } else if (errors.length > 0) {
      // Multiple errors - summarize
      ctx.addToast(
        'warning',
        `Removed ${succeeded}/${total} local files. ${errors.length} error(s) - check logs for details`,
      )
    } else {
      ctx.addToast('warning', `Removed ${succeeded}/${total} local files`)
    }
  } else if (succeeded > 0) {
    ctx.addToast('success', `Removed ${succeeded} local file${succeeded > 1 ? 's' : ''}`)
  }
}

/**
 * Determines which folders should become cloud-only vs completely removed.
 *
 * When deleting local files from a folder:
 * - If the folder will have cloud-only children remaining (synced files that were deleted locally),
 *   the folder should be updated to diffStatus: 'cloud' to remain visible in the tree
 * - If the folder will have no children remaining, it can be safely removed from the store
 *
 * @param folderPaths - Array of folder paths that were selected for deletion
 * @param syncedFileUpdates - Files that will be updated to cloud-only status (contain path property)
 * @returns Object containing arrays of folder paths to make cloud-only vs remove entirely
 */
function categorizeFoldersForDeletion(
  folderPaths: string[],
  syncedFileUpdates: Array<{ path: string; updates: { diffStatus: 'cloud' } }>,
): { foldersToMakeCloudOnly: string[]; foldersToRemove: string[] } {
  const foldersToMakeCloudOnly: string[] = []
  const foldersToRemove: string[] = []

  for (const folderPath of folderPaths) {
    // Normalize path separators for comparison
    const normalizedFolderPath = folderPath.replace(/\\/g, '/')

    // Check if any synced files inside this folder will become cloud-only
    const hasCloudChildren = syncedFileUpdates.some((update) => {
      const normalizedFilePath = update.path.replace(/\\/g, '/')
      return normalizedFilePath.startsWith(normalizedFolderPath + '/')
    })

    if (hasCloudChildren) {
      foldersToMakeCloudOnly.push(folderPath)
    } else {
      foldersToRemove.push(folderPath)
    }
  }

  return { foldersToMakeCloudOnly, foldersToRemove }
}

/**
 * Releases checkouts for files checked out by the current user.
 * Returns paths that were successfully released.
 */
async function releaseCheckoutsForFiles(files: LocalFile[], userId: string): Promise<void> {
  const filesToRelease = files.filter((f) => f.pdmData?.checked_out_by === userId && f.pdmData?.id)

  // Release checkouts in parallel (fire-and-forget, errors are logged but don't block)
  await Promise.all(
    filesToRelease.map((file) =>
      checkinFile(file.pdmData!.id!, userId).catch((error) => {
        log.warn('[Delete]', 'Failed to release checkout before delete', {
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }),
    ),
  )
}

// ============================================
// Delete Local Command
// ============================================

export const deleteLocalCommand: Command<DeleteLocalParams> = {
  id: 'delete-local',
  name: 'Remove Local Copy',
  description: 'Remove local copies of files (keeps server version)',
  aliases: ['rm-local', 'remove'],
  usage: 'delete-local <path> [--recursive]',

  validate({ files }, ctx) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }

    // Note: We intentionally do NOT check checkout status here.
    // Checkout status is about server-side locking for editing - it's irrelevant
    // for deleting local copies. Users should be able to clean up their local disk
    // regardless of who has files checked out on the server.

    // Get synced files that exist locally
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files).filter(
      (f) => f.diffStatus !== 'cloud',
    )
    const unsyncedFiles = getUnsyncedFilesFromSelection(ctx.files, files)

    // Also check for local folders (not cloud-only)
    const localFolders = files.filter((f) => f.isDirectory && f.diffStatus !== 'cloud')

    if (syncedFiles.length === 0 && unsyncedFiles.length === 0 && localFolders.length === 0) {
      return 'No local files to remove'
    }

    return null
  },

  async execute({ files }, ctx): Promise<CommandResult> {
    const operationStart = performance.now()
    const operationId = `delete-local-${Date.now()}`

    logDelete('info', 'Starting delete-local operation', {
      operationId,
      selectedCount: files.length,
    })

    const user = ctx.user

    // Compute paths from selection (cheap — only iterates the selected items, not the full store)
    const foldersBeingProcessed = files.filter((f) => f.isDirectory).map((f) => f.relativePath)
    const filesBeingProcessed = files.filter((f) => !f.isDirectory).map((f) => f.relativePath)
    const allPathsBeingProcessed = [...foldersBeingProcessed, ...filesBeingProcessed]
    const localFolders = files.filter((f) => f.isDirectory && f.diffStatus !== 'cloud')

    // Register expected file changes to suppress file watcher during operation
    ctx.addExpectedFileChanges(allPathsBeingProcessed)

    // Yield to let the confirmation modal close, then show spinner BEFORE heavy file scanning
    await new Promise((resolve) => setTimeout(resolve, 0))
    ctx.addProcessingFoldersSync(allPathsBeingProcessed, 'delete')

    // Heavy file scanning — runs AFTER spinner is visible so UI doesn't freeze
    const syncedLocalFiles = getSyncedFilesFromSelection(ctx.files, files).filter(
      (f) => f.diffStatus !== 'cloud',
    )
    const unsyncedLocalFiles = getUnsyncedFilesFromSelection(ctx.files, files).filter(
      (f) => !f.isDirectory,
    )
    const filesToRemove = [...syncedLocalFiles, ...unsyncedLocalFiles]

    // Initialize tracker (reuses scan results — no duplicate scanning)
    const tracker = FileOperationTracker.start(
      'delete',
      filesToRemove.length,
      filesToRemove.map((f) => f.relativePath),
    )

    // Handle empty local folders with no files to remove
    if (filesToRemove.length === 0 && localFolders.length > 0) {
      ctx.removeProcessingFoldersSync(allPathsBeingProcessed)

      const folderPaths = localFolders.map((f) => f.path)

      // Use batch delete for folders
      const batchResult = (await window.electronAPI?.deleteBatch(folderPaths, true)) as
        | BatchDeleteResult
        | undefined

      if (batchResult) {
        const deleted = batchResult.summary.succeeded

        // Immediately remove from store
        const deletedPaths = batchResult.results.filter((r) => r.success).map((r) => r.path)
        if (deletedPaths.length > 0) {
          ctx.removeFilesFromStore(deletedPaths)
        }

        // Mark operation complete to help suppress file watcher
        ctx.setLastOperationCompletedAt(Date.now())

        if (deleted > 0) {
          ctx.addToast('success', `Deleted ${deleted} folder${deleted !== 1 ? 's' : ''}`)
        }

        // Fire-and-forget: Delete folders from server (soft delete)
        // Don't block UI - server cleanup happens in background
        if (ctx.activeVaultId && ctx.user?.id) {
          const vaultId = ctx.activeVaultId
          const userId = ctx.user.id
          Promise.all(
            localFolders.map((folder) =>
              deleteFolderByPath(vaultId, folder.relativePath, userId)
                .then(() =>
                  logDelete('info', 'Deleted folder from server', {
                    relativePath: folder.relativePath,
                  }),
                )
                .catch((error) =>
                  logDelete('warn', 'Failed to delete folder from server', {
                    relativePath: folder.relativePath,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                ),
            ),
          ).catch(() => {}) // Ignore aggregate errors
        }

        tracker.endOperation('completed')
        return {
          success: true,
          message: `Deleted ${deleted} folder${deleted !== 1 ? 's' : ''}`,
          total: localFolders.length,
          succeeded: deleted,
          failed: localFolders.length - deleted,
          duration: batchResult.summary.duration,
        }
      }

      // Mark operation complete to help suppress file watcher
      ctx.setLastOperationCompletedAt(Date.now())

      tracker.endOperation('failed', 'Delete operation failed')
      return {
        success: false,
        message: 'Delete operation failed',
        total: localFolders.length,
        succeeded: 0,
        failed: localFolders.length,
      }
    }

    if (filesToRemove.length === 0) {
      ctx.removeProcessingFoldersSync(allPathsBeingProcessed)
      ctx.addToast('info', 'No local files to remove')
      tracker.endOperation('completed')
      return {
        success: true,
        message: 'No local files to remove',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // Main path — spinner is already showing from above
    const total = filesToRemove.length

    // Progress tracking
    const toastId = `delete-${Date.now()}`
    const folderName =
      foldersBeingProcessed.length > 0 ? foldersBeingProcessed[0].split('/').pop() : 'files'

    ctx.addProgressToast(toastId, `Removing ${folderName}...`, total)

    // ═══════════════════════════════════════════════════════════════════════════
    // NO OPTIMISTIC UPDATE: Files stay visible with spinners until deletion completes
    // Store updates happen AFTER actual deletion for both views to update together
    // ═══════════════════════════════════════════════════════════════════════════

    // Separate synced and unsynced files for different handling after deletion
    const syncedFiles = filesToRemove.filter((f) => f.pdmData?.id)
    const unsyncedFiles = filesToRemove.filter((f) => !f.pdmData?.id)

    // Selected folders for post-deletion handling
    const selectedFolderPaths = files
      .filter((f) => f.isDirectory && f.diffStatus !== 'cloud')
      .map((f) => f.path)

    logDelete('info', 'Starting file deletion - files visible with spinners', {
      syncedCount: syncedFiles.length,
      unsyncedCount: unsyncedFiles.length,
      foldersCount: selectedFolderPaths.length,
    })

    // ═══════════════════════════════════════════════════════════════════════════
    // ACTUAL DELETION: Perform file system operations while spinners show
    // ═══════════════════════════════════════════════════════════════════════════

    // Release checkouts for files checked out by current user
    if (user?.id) {
      await releaseCheckoutsForFiles(filesToRemove, user.id)
    }

    // Start tracking the delete phase
    const deleteStepId = tracker.startStep('Delete files', { fileCount: filesToRemove.length })
    const deletePhaseStart = Date.now()

    // Perform batch delete - single IPC call for all files
    const filePaths = filesToRemove.map((f) => f.path)
    const batchResult = (await window.electronAPI?.deleteBatch(filePaths, true)) as
      | BatchDeleteResult
      | undefined

    if (!batchResult) {
      // ATOMIC: Clear processing with no updates
      tracker.endStep(deleteStepId, 'failed', { error: 'No response from system' })
      ctx.updateFilesAndClearProcessing([], allPathsBeingProcessed)
      ctx.setLastOperationCompletedAt(Date.now())
      logDelete('error', 'Batch delete failed - no response from system', { total })
      ctx.removeToast(toastId)
      ctx.addToast('error', 'Delete operation failed - no response from system')
      tracker.endOperation('failed', 'No response from system')
      return {
        success: false,
        message: 'Delete operation failed',
        total,
        succeeded: 0,
        failed: total,
      }
    }

    // End delete step
    tracker.endStep(deleteStepId, 'completed', {
      succeeded: batchResult.summary.succeeded,
      failed: batchResult.summary.failed,
      durationMs: Date.now() - deletePhaseStart,
    })

    // Update progress to 100%
    ctx.updateProgressToast(toastId, total, 100, undefined, `${total}/${total}`)

    const succeeded = batchResult.summary.succeeded
    const failed = batchResult.summary.failed

    // Extract errors for user feedback
    const { errors, lockedFileErrors } = extractDeleteErrors(batchResult.results, filesToRemove)

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-DELETION STORE UPDATE: Update store only for successfully deleted files
    // This is when both file tree and main browser update together
    // ═══════════════════════════════════════════════════════════════════════════

    const failedPaths = new Set(batchResult.results.filter((r) => !r.success).map((r) => r.path))

    // Successfully deleted synced files -> update to cloud-only status
    // Clearing pendingMetadata (and the persisted copy below) ensures a fresh
    // re-download pulls clean metadata from the server instead of resurrecting
    // stale local edits like per-config descriptions.
    const deletedSyncedFiles = syncedFiles.filter((f) => !failedPaths.has(f.path))
    const syncedFileUpdates = deletedSyncedFiles.map((f) => ({
      path: f.path,
      updates: {
        diffStatus: 'cloud' as const,
        localHash: undefined,
        localMtime: undefined,
        localSize: undefined,
        pendingMetadata: undefined,
      },
    }))

    // Successfully deleted unsynced files -> remove from store
    const deletedUnsyncedPaths = unsyncedFiles
      .filter((f) => !failedPaths.has(f.path))
      .map((f) => f.path)

    // Handle folders: determine which should become cloud-only vs removed
    let folderUpdates: Array<{
      path: string
      updates: {
        diffStatus: 'cloud'
        localHash: undefined
        localMtime: undefined
        localSize: undefined
      }
    }> = []
    let foldersToRemoveFromStore: string[] = []

    if (selectedFolderPaths.length > 0) {
      const { foldersToMakeCloudOnly, foldersToRemove } = categorizeFoldersForDeletion(
        selectedFolderPaths,
        syncedFileUpdates,
      )

      folderUpdates = foldersToMakeCloudOnly.map((path) => ({
        path,
        updates: {
          diffStatus: 'cloud' as const,
          localHash: undefined,
          localMtime: undefined,
          localSize: undefined,
        },
      }))
      foldersToRemoveFromStore = foldersToRemove

      // Delete actual folders on disk
      if (foldersToRemove.length > 0) {
        window.electronAPI?.deleteBatch(foldersToRemove, true).catch((error) => {
          logDelete('warn', 'Failed to delete some folders', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }

    // Combine all updates and apply atomically with processing state clear
    const allFileUpdates = [...syncedFileUpdates, ...folderUpdates]

    // Yield to browser before heavy store updates - keeps spinners animating
    // This prevents the UI from appearing frozen during React re-render
    await new Promise((resolve) => requestAnimationFrame(resolve))

    ctx.updateFilesAndClearProcessing(allFileUpdates, allPathsBeingProcessed)

    // Remove successfully deleted unsynced files and folders from store
    const allPathsToRemove = [...deletedUnsyncedPaths, ...foldersToRemoveFromStore]
    if (allPathsToRemove.length > 0) {
      ctx.removeFilesFromStore(allPathsToRemove)
    }

    // Clear persisted pending metadata for every successfully removed file so
    // re-downloading from the server yields fresh metadata (e.g. per-config
    // descriptions) rather than restoring stale local edits from localStorage.
    const clearedMetadataPaths = [...deletedSyncedFiles.map((f) => f.path), ...deletedUnsyncedPaths]
    if (clearedMetadataPaths.length > 0) {
      ctx.clearPersistedPendingMetadataForPaths(clearedMetadataPaths)
    }

    ctx.setLastOperationCompletedAt(Date.now())

    logDelete('info', 'Store updated after deletion', {
      syncedUpdatedToCloud: syncedFileUpdates.length,
      unsyncedRemoved: deletedUnsyncedPaths.length,
      foldersUpdated: folderUpdates.length,
      foldersRemoved: foldersToRemoveFromStore.length,
      metadataCleared: clearedMetadataPaths.length,
      failedCount: failedPaths.size,
    })

    // Add auto-download exclusions for successfully deleted synced files
    for (const file of deletedSyncedFiles) {
      if (file.relativePath) {
        ctx.addAutoDownloadExclusion(file.relativePath)
      }
    }

    ctx.removeToast(toastId)

    // Show result toast
    showDeleteResultToast(ctx, succeeded, failed, total, errors, lockedFileErrors)

    logDelete('info', 'Delete-local operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      durationMs: Math.round(performance.now() - operationStart),
    })

    // Complete operation tracking
    tracker.endOperation(failed === 0 ? 'completed' : 'failed', failed > 0 ? errors[0] : undefined)

    return {
      success: failed === 0,
      message:
        failed > 0
          ? `Removed ${succeeded}/${total} local files`
          : `Removed ${succeeded} local file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration: batchResult.summary.duration,
    }
  },
}

// ============================================
// Delete Server Command
// ============================================

export const deleteServerCommand: Command<DeleteServerParams> = {
  id: 'delete-server',
  name: 'Delete from Server',
  description: 'Soft delete files from server (moves to trash)',
  aliases: ['rm', 'delete'],
  usage: 'delete-server <path> [--local] [--recursive]',

  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot delete from server while offline'
    }

    if (!ctx.user) {
      return 'Please sign in first'
    }

    if (!files || files.length === 0) {
      return 'No files selected'
    }

    // Block deletion of files checked out by others
    const checkedOutByOthers = getFilesCheckedOutByOthers(ctx.files, files, ctx.user?.id)
    if (checkedOutByOthers.length > 0) {
      const names = checkedOutByOthers
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ')
      const suffix =
        checkedOutByOthers.length > 3 ? ` and ${checkedOutByOthers.length - 3} more` : ''
      return `Cannot delete files checked out by others: ${names}${suffix}`
    }

    // Get synced files (including cloud-only)
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const cloudOnlyFiles = files.filter((f) => f.diffStatus === 'cloud' && f.pdmData?.id)
    const allFilesToDelete = [
      ...new Map([...syncedFiles, ...cloudOnlyFiles].map((f) => [f.path, f])).values(),
    ]

    if (allFilesToDelete.length === 0) {
      // Check for local-only folders OR empty cloud-only folders
      const hasLocalFolders = files.some((f) => f.isDirectory && f.diffStatus !== 'cloud')
      const hasCloudOnlyFolders = files.some((f) => f.isDirectory && f.diffStatus === 'cloud')
      if (!hasLocalFolders && !hasCloudOnlyFolders) {
        return 'No files to delete from server'
      }
    }

    return null
  },

  async execute({ files, deleteLocal = true }, ctx): Promise<CommandResult> {
    const operationStart = performance.now()
    const operationId = `delete-server-${Date.now()}`

    // Initialize file operation tracker for DevTools monitoring
    // Note: We track all selected files, actual count determined after filtering
    const tracker = FileOperationTracker.start(
      'delete',
      files.length,
      files.map((f) => f.relativePath),
    )

    logDelete('info', 'Starting delete-server operation', {
      operationId,
      selectedCount: files.length,
      deleteLocal,
    })

    const user = ctx.user!

    // Compute selected paths (cheap — only iterates the selected items, not the full store)
    const selectedPaths = files.map((f) => f.relativePath)

    // Register expected file changes for local items
    if (deleteLocal) {
      const localPathsToDelete = files
        .filter((f) => f.diffStatus !== 'cloud')
        .map((f) => f.relativePath)
      ctx.addExpectedFileChanges(localPathsToDelete)
    }

    // Yield to let the confirmation modal close, then show spinner BEFORE heavy scanning.
    // Folder-level spinners propagate down to children via getProcessingOperation,
    // so marking selected paths covers all visible items.
    await new Promise((resolve) => setTimeout(resolve, 0))
    ctx.addProcessingFoldersSync(selectedPaths, 'delete')

    // Heavy scanning — runs AFTER spinner is visible so UI doesn't freeze
    const allFilesToDelete: LocalFile[] = []

    for (const item of files) {
      if (item.isDirectory) {
        // Get all synced files inside the folder
        const folderPath = item.relativePath.replace(/\\/g, '/')
        const filesInFolder = ctx.files.filter((f) => {
          if (f.isDirectory) return false
          if (!f.pdmData?.id) return false
          const filePath = f.relativePath.replace(/\\/g, '/')
          return filePath.startsWith(folderPath + '/')
        })
        allFilesToDelete.push(...filesInFolder)
      } else if (item.pdmData?.id) {
        allFilesToDelete.push(item)
      }
    }

    // Remove duplicates
    const uniqueFiles = [...new Map(allFilesToDelete.map((f) => [f.path, f])).values()]

    // Check for local folders to delete
    const hasLocalFolders = files.some((f) => f.isDirectory && f.diffStatus !== 'cloud')
    const hasCloudOnlyFolders = files.some((f) => f.isDirectory && f.diffStatus === 'cloud')

    // Handle empty cloud-only folders
    if (uniqueFiles.length === 0 && !hasLocalFolders) {
      ctx.removeProcessingFoldersSync(selectedPaths)

      if (hasCloudOnlyFolders) {
        const emptyFolders = files.filter((f) => f.isDirectory && f.diffStatus === 'cloud')
        const pathsToRemove = emptyFolders.map((f) => f.path)

        // For empty cloud-only folders, remove from store immediately
        // (No local files to delete, just removing metadata entries)
        ctx.removeFilesFromStore(pathsToRemove)
        ctx.addToast(
          'success',
          `Removed ${emptyFolders.length} empty folder${emptyFolders.length !== 1 ? 's' : ''}`,
        )

        // Fire-and-forget: Delete folders from server (soft delete) in parallel
        // Don't block UI - server cleanup happens in background
        if (ctx.activeVaultId && ctx.user?.id) {
          const vaultId = ctx.activeVaultId
          const userId = ctx.user.id
          Promise.all(
            emptyFolders.map((folder) =>
              deleteFolderByPath(vaultId, folder.relativePath, userId)
                .then(() =>
                  logDelete('info', 'Deleted folder from server', {
                    relativePath: folder.relativePath,
                  }),
                )
                .catch((error) =>
                  logDelete('warn', 'Failed to delete folder from server', {
                    relativePath: folder.relativePath,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                ),
            ),
          ).catch(() => {}) // Ignore aggregate errors
        }
        tracker.endOperation('completed')
        return {
          success: true,
          message: `Removed ${emptyFolders.length} empty folder${emptyFolders.length !== 1 ? 's' : ''}`,
          total: emptyFolders.length,
          succeeded: emptyFolders.length,
          failed: 0,
        }
      }
      ctx.addToast('warning', 'No files to delete from server')
      tracker.endOperation('completed')
      return {
        success: false,
        message: 'No files to delete from server',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // If only local folders with no server files, just delete locally using batch
    if (uniqueFiles.length === 0 && hasLocalFolders) {
      const foldersToDelete = files.filter((f) => f.isDirectory && f.diffStatus !== 'cloud')
      const folderAbsolutePaths = foldersToDelete.map((f) => f.path)

      // Spinner already showing from above, proceed with deletion
      logDelete('info', 'Starting local folder deletion - folders visible with spinners', {
        count: foldersToDelete.length,
      })

      // Perform actual deletion
      const batchResult = (await window.electronAPI?.deleteBatch(folderAbsolutePaths, true)) as
        | BatchDeleteResult
        | undefined

      if (batchResult) {
        const deleted = batchResult.summary.succeeded
        const failedCount = batchResult.summary.failed

        // Remove successfully deleted folders from store
        const deletedFolderPaths = foldersToDelete
          .filter((f) => batchResult.results.some((r) => r.path === f.path && r.success))
          .map((f) => f.path)

        // Yield to browser before store update - keeps spinners animating
        await new Promise((resolve) => requestAnimationFrame(resolve))

        if (deletedFolderPaths.length > 0) {
          ctx.removeFilesFromStore(deletedFolderPaths)
        }

        // Clear processing state synchronously
        ctx.removeProcessingFoldersSync(selectedPaths)
        ctx.setLastOperationCompletedAt(Date.now())

        logDelete('info', 'Local folder deletion complete', {
          deleted,
          failed: failedCount,
        })

        if (deleted > 0) {
          ctx.addToast('success', `Deleted ${deleted} folder${deleted !== 1 ? 's' : ''}`)
        }

        // Fire-and-forget: Delete folders from server (soft delete) in parallel
        // Don't block UI - server cleanup happens in background
        if (ctx.activeVaultId && ctx.user?.id) {
          const vaultId = ctx.activeVaultId
          const userId = ctx.user.id
          const deletedFolders = foldersToDelete.filter((f) =>
            batchResult.results.some((r) => r.path === f.path && r.success),
          )
          Promise.all(
            deletedFolders.map((folder) =>
              deleteFolderByPath(vaultId, folder.relativePath, userId)
                .then(() =>
                  logDelete('info', 'Deleted folder from server', {
                    relativePath: folder.relativePath,
                  }),
                )
                .catch((error) =>
                  logDelete('warn', 'Failed to delete folder from server', {
                    relativePath: folder.relativePath,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                ),
            ),
          ).catch(() => {}) // Ignore aggregate errors
        }

        tracker.endOperation('completed')
        return {
          success: true,
          message: `Deleted ${deleted} folder${deleted !== 1 ? 's' : ''}`,
          total: foldersToDelete.length,
          succeeded: deleted,
          failed: failedCount,
          duration: batchResult.summary.duration,
        }
      }

      // If batch delete failed entirely, just clear processing and report failure
      // (No need to restore - files were never removed from store)
      ctx.removeProcessingFoldersSync(selectedPaths)
      ctx.setLastOperationCompletedAt(Date.now())
      ctx.addToast('error', 'Delete operation failed')
      tracker.endOperation('failed', 'Delete operation failed')
      return {
        success: false,
        message: 'Delete operation failed',
        total: foldersToDelete.length,
        succeeded: 0,
        failed: foldersToDelete.length,
      }
    }

    // Main path — spinner already showing, build full path set for cleanup
    const foldersSelected = files.filter((f) => f.isDirectory).map((f) => f.relativePath)
    const pathsBeingProcessed = uniqueFiles.map((f) => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...pathsBeingProcessed, ...foldersSelected])]

    // Add individual file paths to processing (folders already covered by initial spinner)
    ctx.addProcessingFoldersSync(allPathsBeingProcessed, 'delete')

    const toastId = `delete-server-${Date.now()}`
    const totalFiles = uniqueFiles.length

    ctx.addProgressToast(
      toastId,
      `Deleting ${totalFiles} file${totalFiles !== 1 ? 's' : ''}...`,
      totalFiles,
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // NO OPTIMISTIC UPDATE: Files stay visible with spinners until deletion completes
    // Store updates happen AFTER actual deletion for both views to update together
    // ═══════════════════════════════════════════════════════════════════════════
    logDelete('info', 'Starting delete-server - files visible with spinners', {
      fileCount: files.length,
      uniqueServerFiles: uniqueFiles.length,
    })

    let deletedLocal = 0
    let deletedServer = 0
    const errors: string[] = []
    const startTime = Date.now()

    // STEP 1: Delete ALL local items first using batch operation
    if (deleteLocal) {
      // Expand selection to include files inside selected folders
      // This ensures files are explicitly deleted even if folder deletion fails
      const expandedLocalItems: LocalFile[] = []
      for (const item of files.filter((f) => f.diffStatus !== 'cloud')) {
        expandedLocalItems.push(item)
        if (item.isDirectory) {
          const folderPath = item.relativePath.replace(/\\/g, '/')
          const filesInFolder = ctx.files.filter((f) => {
            if (f.isDirectory) return false
            if (f.diffStatus === 'cloud') return false
            const filePath = f.relativePath.replace(/\\/g, '/')
            return filePath.startsWith(folderPath + '/')
          })
          expandedLocalItems.push(...filesInFolder)
        }
      }
      // Remove duplicates (in case files were both selected and inside a selected folder)
      const localItemsToDelete = [...new Map(expandedLocalItems.map((f) => [f.path, f])).values()]

      if (localItemsToDelete.length > 0) {
        const localDeleteStepId = tracker.startStep('Delete local files', {
          fileCount: localItemsToDelete.length,
        })
        const localDeleteStart = Date.now()

        // Release checkouts first
        await releaseCheckoutsForFiles(localItemsToDelete, user.id)

        // Batch delete local files
        // Sort by depth (deepest first) so children are deleted before parent folders
        const localPaths = localItemsToDelete
          .map((f) => f.path)
          .sort((a, b) => {
            const depthA = a.split(/[/\\]/).length
            const depthB = b.split(/[/\\]/).length
            return depthB - depthA // Deeper paths first
          })
        const localBatchResult = (await window.electronAPI?.deleteBatch(localPaths, true)) as
          | BatchDeleteResult
          | undefined

        if (localBatchResult) {
          deletedLocal = localBatchResult.summary.succeeded

          // Log any local deletion failures (no restore needed - files weren't removed from store)
          const failedLocalCount = localBatchResult.summary.failed
          if (failedLocalCount > 0) {
            logDelete('warn', 'Some local files failed to delete', {
              failed: failedLocalCount,
              succeeded: deletedLocal,
            })
          }
        }

        tracker.endStep(localDeleteStepId, 'completed', {
          succeeded: deletedLocal,
          durationMs: Date.now() - localDeleteStart,
        })
      }
    }

    // STEP 2: Delete from server with concurrency limiting
    // Server operations still need individual API calls (no batch endpoint)
    let completedCount = 0
    let serverResults: boolean[] = []

    if (uniqueFiles.length > 0) {
      const serverDeleteStepId = tracker.startStep('Delete from server', {
        fileCount: uniqueFiles.length,
        concurrency: CONCURRENT_OPERATIONS,
      })
      const serverDeleteStart = Date.now()

      serverResults = await processWithConcurrency(
        uniqueFiles,
        CONCURRENT_OPERATIONS,
        async (file) => {
          if (!file.pdmData?.id) {
            completedCount++
            ctx.updateProgressToast(
              toastId,
              completedCount,
              Math.round((completedCount / totalFiles) * 100),
              undefined,
              `${completedCount}/${totalFiles}`,
            )
            return false
          }
          try {
            const result = await softDeleteFile(file.pdmData.id, user.id)
            completedCount++
            ctx.updateProgressToast(
              toastId,
              completedCount,
              Math.round((completedCount / totalFiles) * 100),
              undefined,
              `${completedCount}/${totalFiles}`,
            )
            return result.success
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            errors.push(`${file.name}: ${errorMsg}`)
            log.error('[Delete]', 'Failed to delete file from server', {
              fileName: file.name,
              error: errorMsg,
            })
            completedCount++
            ctx.updateProgressToast(
              toastId,
              completedCount,
              Math.round((completedCount / totalFiles) * 100),
              undefined,
              `${completedCount}/${totalFiles}`,
            )
            return false
          }
        },
      )
      deletedServer = serverResults.filter((r) => r).length

      tracker.endStep(serverDeleteStepId, 'completed', {
        succeeded: deletedServer,
        failed: uniqueFiles.length - deletedServer,
        durationMs: Date.now() - serverDeleteStart,
      })

      // If keeping local copies (deleteLocal = false), update successfully deleted files
      // to show as local-only (clear pdmData)
      if (!deleteLocal) {
        const keptLocalFiles = uniqueFiles.filter(
          (f, i) => serverResults[i] && f.diffStatus !== 'cloud',
        )

        if (keptLocalFiles.length > 0) {
          // Update files to local-only status
          const localOnlyUpdates = keptLocalFiles.map((f) => ({
            path: f.path,
            updates: {
              pdmData: undefined,
              isSynced: false,
              diffStatus: 'added' as const,
            },
          }))
          ctx.updateFilesInStore(localOnlyUpdates)
          logDelete('info', 'Updated kept local files to local-only status', {
            count: keptLocalFiles.length,
          })

          // Clear read-only attribute for kept local files
          // Local-only files should always be writable
          const batchFiles = keptLocalFiles.map((f) => ({ path: f.path, readonly: false }))
          window.electronAPI
            ?.setReadonlyBatch(batchFiles)
            .then((result) => {
              if (result?.success === false || result?.results?.some((r) => !r.success)) {
                const failedCount = result?.results?.filter((r) => !r.success).length ?? 0
                logDelete('warn', 'Some files failed to clear read-only flag', {
                  totalFiles: keptLocalFiles.length,
                  failedCount,
                })
              } else {
                logDelete('debug', 'Cleared read-only flag for kept local files', {
                  count: keptLocalFiles.length,
                })
              }
            })
            .catch((error) => {
              logDelete('warn', 'Failed to clear read-only flags', {
                error: error instanceof Error ? error.message : String(error),
              })
            })
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-DELETION STORE UPDATE: Remove successfully deleted files from store
    // This is when both file tree and main browser update together
    // ═══════════════════════════════════════════════════════════════════════════

    // Collect all successfully deleted file paths
    const successfullyDeletedPaths: string[] = []

    // Files deleted from server (and optionally locally)
    uniqueFiles.forEach((file, i) => {
      if (serverResults[i]) {
        successfullyDeletedPaths.push(file.path)
      }
    })

    // Add folder paths if they were deleted
    const foldersToDeleteFromStore = files.filter((f) => f.isDirectory).map((f) => f.path)

    // Yield to browser before heavy store updates - keeps spinners animating
    // This prevents the UI from appearing frozen during React re-render
    await new Promise((resolve) => requestAnimationFrame(resolve))

    // Remove successfully deleted files from store and clear processing atomically
    const allPathsToRemove = [...successfullyDeletedPaths, ...foldersToDeleteFromStore]
    if (allPathsToRemove.length > 0) {
      ctx.removeFilesFromStore(allPathsToRemove)
    }

    // Clear processing state synchronously so UI updates immediately
    ctx.removeProcessingFoldersSync(allPathsBeingProcessed)
    ctx.setLastOperationCompletedAt(Date.now())
    ctx.removeToast(toastId)

    logDelete('info', 'Store updated after delete-server', {
      filesRemoved: successfullyDeletedPaths.length,
      foldersRemoved: foldersToDeleteFromStore.length,
    })

    const duration = Date.now() - startTime
    logDelete('info', 'Delete-server operation complete', {
      operationId,
      deletedServer,
      deletedLocal,
      durationMs: duration,
      totalDurationMs: Math.round(performance.now() - operationStart),
    })
    const failed = uniqueFiles.length - deletedServer

    // Build descriptive message
    let message = ''
    if (deletedServer > 0 && deletedLocal > 0) {
      message = `Deleted ${deletedServer} file${deletedServer !== 1 ? 's' : ''} from server (moved to trash) and removed local copies`
    } else if (deletedServer > 0) {
      message = `Deleted ${deletedServer} file${deletedServer !== 1 ? 's' : ''} from server (moved to trash)`
    } else if (deletedLocal > 0) {
      message = `Removed ${deletedLocal} local file${deletedLocal !== 1 ? 's' : ''}`
    } else {
      message = 'No files deleted'
    }

    // Show result toast
    if (deletedServer > 0 || deletedLocal > 0) {
      if (failed > 0 && errors.length > 0) {
        // Show error info when some files failed
        if (uniqueFiles.length === 1) {
          ctx.addToast('warning', `Failed to delete: ${errors[0]}`)
        } else if (errors.length === 1) {
          ctx.addToast('warning', `${message}. Error: ${errors[0]}`)
        } else {
          ctx.addToast('warning', `${message}. ${errors.length} error(s) - check logs for details`)
        }
      } else {
        ctx.addToast('success', message)
      }
    } else if (failed > 0 && errors.length > 0) {
      // All files failed
      if (errors.length === 1) {
        ctx.addToast('error', `Delete failed: ${errors[0]}`)
      } else {
        ctx.addToast('error', `Delete failed for ${failed} file(s) - check logs for details`)
      }
    }

    // No refresh needed - store updates are handled incrementally:
    // - Local files removed via removeFilesFromStore()
    // - Cloud-only files removed via removeFilesFromStore()
    // - Server deletion is reflected immediately in store updates

    // Remove deleted files from the sync index
    // This prevents them from being marked as orphaned if recreated locally
    if (deletedServer > 0 && ctx.activeVaultId) {
      const deletedPaths = uniqueFiles
        .filter((_, i) => serverResults[i]) // Only successfully deleted files
        .map((f) => f.relativePath)

      if (deletedPaths.length > 0) {
        removeFromSyncIndex(ctx.activeVaultId, deletedPaths).catch((error) => {
          logDelete('warn', 'Failed to update sync index after server delete', {
            error: String(error),
          })
        })
      }

      // Invalidate the vault cache so the next load rebuilds without the deleted
      // files. Without this, soft-deleted files linger in the IndexedDB cache as
      // unrecoverable "ghosts" (their server row is no longer visible to queries).
      clearVaultCache(ctx.activeVaultId).catch((error) => {
        logDelete('warn', 'Failed to clear vault cache after delete-server', {
          error: String(error),
        })
      })
    }

    // Fire-and-forget: Delete selected folders from server
    // After files are deleted, we need to delete the folder records from server too
    // This runs in background to not block the UI
    const foldersToDeleteFromServer = files.filter((f) => f.isDirectory)
    if (foldersToDeleteFromServer.length > 0 && ctx.activeVaultId) {
      const vaultId = ctx.activeVaultId
      const userId = user.id
      logDelete('info', 'Deleting folders from server (background)', {
        count: foldersToDeleteFromServer.length,
      })
      Promise.all(
        foldersToDeleteFromServer.map((folder) =>
          deleteFolderByPath(vaultId, folder.relativePath, userId)
            .then(() =>
              logDelete('info', 'Deleted folder from server', {
                relativePath: folder.relativePath,
              }),
            )
            .catch((error) =>
              logDelete('warn', 'Failed to delete folder from server', {
                relativePath: folder.relativePath,
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
        ),
      ).catch(() => {}) // Ignore aggregate errors
    }

    // Complete operation tracking
    tracker.endOperation(failed === 0 ? 'completed' : 'failed', failed > 0 ? errors[0] : undefined)

    return {
      success: failed === 0,
      message,
      total: uniqueFiles.length || files.length,
      succeeded: deletedServer || deletedLocal,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      details: [`Deleted from server: ${deletedServer}`, `Deleted locally: ${deletedLocal}`],
      duration,
    }
  },
}
