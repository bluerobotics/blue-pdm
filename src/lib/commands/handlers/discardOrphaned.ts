/**
 * Discard Orphaned Command
 *
 * Delete local files that no longer exist on the server (orphaned files).
 * These are files that were previously synced but have been deleted from the vault
 * by another user. They show with 'deleted_remote' status.
 *
 * This command:
 * 1. Deletes the local files from disk
 * 2. Removes them from the local sync index
 * 3. Updates the store to remove the files from view
 *
 * The deletions are registered as expected file changes for the duration, so the
 * watcher does not read them back as external edits and trigger a vault reload.
 */

import type { Command, CommandResult, LocalFile } from '../types'
import { getFilesInFolder } from '../types'
import { log } from '@/lib/logger'
import { FileOperationTracker } from '../../fileOperationTracker'
import { removeFromSyncIndex } from '../../cache/localSyncIndex'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'

function logDiscardOrphaned(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[DiscardOrphaned]', message, context)
}

/**
 * Parameters for the discard-orphaned command.
 */
export interface DiscardOrphanedParams {
  /** Array of files/folders to check for orphaned files. */
  files: LocalFile[]
}

/**
 * Get orphaned files (deleted_remote) from a selection.
 * Handles both individual files and folders.
 */
function getOrphanedFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []

  for (const item of selection) {
    if (item.isDirectory) {
      // Get all orphaned files inside the folder
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const orphanedInFolder = filesInFolder.filter((f) => f.diffStatus === 'deleted_remote')
      result.push(...orphanedInFolder)
    } else if (item.diffStatus === 'deleted_remote') {
      result.push(item)
    }
  }

  // Deduplicate by path
  return [...new Map(result.map((f) => [f.path, f])).values()]
}

export const discardOrphanedCommand: Command<DiscardOrphanedParams> = {
  id: 'discard-orphaned',
  name: 'Discard Orphaned Files',
  description: 'Delete local files that no longer exist on the server',
  aliases: ['remove-orphaned', 'cleanup-orphaned'],
  usage: 'discard-orphaned <path>',

  validate({ files }, ctx) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }

    // Get orphaned files
    const orphanedFiles = getOrphanedFilesFromSelection(ctx.files, files)

    if (orphanedFiles.length === 0) {
      return 'No orphaned files to discard'
    }

    return null
  },

  async execute({ files }, ctx): Promise<CommandResult> {
    const operationStart = performance.now()
    const operationId = `discard-orphaned-${Date.now()}`

    // Get orphaned files
    const filesToDiscard = getOrphanedFilesFromSelection(ctx.files, files)

    logDiscardOrphaned('info', 'Starting discard orphaned operation', {
      operationId,
      selectedCount: files.length,
      orphanedCount: filesToDiscard.length,
    })

    if (filesToDiscard.length === 0) {
      return {
        success: true,
        message: 'No orphaned files to discard',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // Initialize file operation tracker for DevTools monitoring
    const tracker = FileOperationTracker.start(
      'delete',
      filesToDiscard.length,
      filesToDiscard.map((f) => f.relativePath),
    )

    const total = filesToDiscard.length

    // Track paths being processed
    const pathsBeingProcessed = filesToDiscard.map((f) => f.relativePath)
    ctx.addProcessingFoldersSync(pathsBeingProcessed, 'delete')

    // Without this the watcher sees our own deletions as external changes once the
    // batch operation restarts it, and kicks off a full vault reload. Matches the
    // delete handler; the helper carries a backstop so a missed release cannot
    // suppress these paths for the rest of the session.
    const releaseWatcher = beginWatcherSuppression(pathsBeingProcessed, ctx)

    try {
      // Progress tracking
      const toastId = `discard-orphaned-${Date.now()}`
      ctx.addProgressToast(
        toastId,
        `Removing ${total} orphaned file${total !== 1 ? 's' : ''}...`,
        total,
      )

      // Yield to let confirmation modal close
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Delete local files using batch operation
      const filePaths = filesToDiscard.map((f) => f.path)
      const batchResult = (await window.electronAPI?.deleteBatch(filePaths, true)) as
        | {
            success: boolean
            results: Array<{ path: string; success: boolean; error?: string }>
            summary: { total: number; succeeded: number; failed: number; duration: number }
          }
        | undefined

      if (!batchResult) {
        tracker.endOperation('failed', 'No response from system')
        ctx.removeProcessingFolders(pathsBeingProcessed)
        ctx.removeToast(toastId)
        ctx.addToast('error', 'Failed to discard orphaned files - no response from system')
        return {
          success: false,
          message: 'Discard operation failed',
          total,
          succeeded: 0,
          failed: total,
        }
      }

      const succeeded = batchResult.summary.succeeded
      const failed = batchResult.summary.failed

      // Get paths that were successfully deleted
      const deletedPaths = batchResult.results.filter((r) => r.success).map((r) => r.path)

      // Update progress
      ctx.updateProgressToast(toastId, total, 100, undefined, `${total}/${total}`)

      // Remove successfully deleted files from the store
      if (deletedPaths.length > 0) {
        ctx.removeFilesFromStore(deletedPaths)

        // Remove from sync index so they're not marked as orphaned if recreated
        if (ctx.activeVaultId) {
          const relativePaths = filesToDiscard
            .filter((f) => deletedPaths.includes(f.path))
            .map((f) => f.relativePath)
          removeFromSyncIndex(ctx.activeVaultId, relativePaths).catch((err) => {
            logDiscardOrphaned('warn', 'Failed to update sync index', { error: String(err) })
          })
        }
      }

      // Clear processing state
      ctx.removeProcessingFolders(pathsBeingProcessed)
      ctx.setLastOperationCompletedAt(Date.now())
      ctx.removeToast(toastId)

      // Extract errors for feedback
      const errors: string[] = []
      for (const result of batchResult.results) {
        if (!result.success && result.error) {
          const fileName = result.path.split(/[/\\]/).pop() || result.path
          errors.push(`${fileName}: ${result.error}`)
          logDiscardOrphaned('error', 'Failed to delete orphaned file', {
            path: result.path,
            error: result.error,
          })
        }
      }

      // Show result toast
      if (failed > 0) {
        if (errors.length === 1) {
          ctx.addToast(
            'warning',
            `Discarded ${succeeded}/${total} orphaned files. Error: ${errors[0]}`,
          )
        } else {
          ctx.addToast(
            'warning',
            `Discarded ${succeeded}/${total} orphaned files. ${errors.length} error(s)`,
          )
        }
      } else if (succeeded > 0) {
        ctx.addToast('success', `Discarded ${succeeded} orphaned file${succeeded > 1 ? 's' : ''}`)
      }

      logDiscardOrphaned('info', 'Discard orphaned operation complete', {
        operationId,
        total,
        succeeded,
        failed,
        durationMs: Math.round(performance.now() - operationStart),
      })

      tracker.endOperation(failed === 0 ? 'completed' : 'failed', failed > 0 ? errors[0] : undefined)

      return {
        success: failed === 0,
        message:
          failed > 0
            ? `Discarded ${succeeded}/${total} orphaned files`
            : `Discarded ${succeeded} orphaned file${succeeded > 1 ? 's' : ''}`,
        total,
        succeeded,
        failed,
        errors: errors.length > 0 ? errors : undefined,
        duration: batchResult.summary.duration,
      }
    } finally {
      releaseWatcher()
    }
  },
}
