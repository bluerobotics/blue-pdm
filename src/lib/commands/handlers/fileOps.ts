/**
 * File Operations Commands
 *
 * Commands: rename, move, copy, new-folder
 * These are registered commands for programmatic use.
 */

import type {
  Command,
  RenameParams,
  MoveParams,
  CopyParams,
  NewFolderParams,
  MergeFolderParams,
  CommandResult,
  LocalFile,
} from '../types'
import type { PendingMetadata } from '@/stores/types'
import {
  getFilesInFolder,
  getFilesCheckedOutByOthers,
  getCloudOnlyFilesFromSelection,
} from '../types'
import { ProgressTracker } from '../executor'
import {
  updateFilePath,
  updateFolderPath,
  syncFolder,
  updateFolderServerPath,
  deleteFolderOnServer,
} from '../../supabase'
import { moveFileOnServer } from '../../supabase/files/move'
import { getExtension } from '../../utils/path'
import { resolveFileMetadata } from '@/lib/metadata/overlay'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'

const THUMBNAIL_EXTRACTION_WAIT_MS = 2_000
const DEFER_MS = 0

// Tracks in-flight background server path updates per folder so rapid
// sequential renames (A->B->C) are chained rather than overlapping.
const pendingFolderServerUpdates = new Map<string, Promise<void>>()

/**
 * Parse lock info string and return a user-friendly toast message.
 * Prioritizes external processes (SLDWORKS, swCefSubProc) over internal ones.
 *
 * @param lockInfo - The lock info string from the rename/move operation
 * @returns Object with the toast message and a short display name, or null if no specific process detected
 */
function parseLockInfoForToast(lockInfo: string): { message: string; processName: string } | null {
  // Check for handle.exe output first
  if (lockInfo.includes('handle64.exe:') || lockInfo.includes('handle.exe:')) {
    const match = lockInfo.match(/:\s*(\w+\.exe)/i)
    const processName = match ? match[1] : 'another application'
    return { message: `file is in use by ${processName}. Close it and try again.`, processName }
  }

  // Check for SolidWorks temp file pattern
  if (lockInfo.includes('SolidWorks temp file')) {
    return {
      message: 'file is in use by SolidWorks. Close SolidWorks and try again.',
      processName: 'SolidWorks',
    }
  }

  // Priority-based detection for "Potential:" format from PowerShell detection
  if (lockInfo.includes('Potential:')) {
    // Priority 1: SLDWORKS.exe - the full SolidWorks application
    if (/SLDWORKS\(/i.test(lockInfo)) {
      return {
        message:
          'SolidWorks has files open. Close the files in SolidWorks (or end SLDWORKS.exe in Task Manager), then try again.',
        processName: 'SLDWORKS',
      }
    }

    // Priority 2: swCefSubProc - SolidWorks Connected services
    if (/swCefSubProc\(/i.test(lockInfo)) {
      return {
        message:
          'SolidWorks Connected services are blocking this folder. Check Task Manager for swCefSubProc processes and end them, then try again.',
        processName: 'swCefSubProc',
      }
    }

    // Priority 3: BluePLM.SolidWorksService - our own DM API service holding handles
    // This happens when the handle release didn't work properly
    if (/BluePLM\.SolidWorksService\(/i.test(lockInfo) && !/SLDWORKS\(/i.test(lockInfo)) {
      return {
        message:
          'BluePLM is holding file handles. Try again in a few seconds, or restart BluePLM if the problem persists.',
        processName: 'BluePLM.SolidWorksService',
      }
    }

    // Priority 4: explorer.exe - Windows Explorer thumbnail caching
    // Only show this if neither SLDWORKS nor BluePLM.SolidWorksService are primary suspects
    if (
      /explorer\(/i.test(lockInfo) &&
      !/SLDWORKS\(/i.test(lockInfo) &&
      !/BluePLM\.SolidWorksService\(/i.test(lockInfo)
    ) {
      return {
        message:
          'Windows Explorer is caching file previews in this folder. Close any File Explorer windows showing this folder and try again.',
        processName: 'explorer',
      }
    }

    // Fallback: extract first process name for generic message
    const match = lockInfo.match(/Potential:\s*([^(,]+)/i)
    const processName = match ? match[1].trim() : 'another application'
    return { message: `file is in use by ${processName}. Close it and try again.`, processName }
  }

  return null
}

/**
 * Helper to extract metadata from source file for copying, through the shared overlay.
 * A field the user cleared on the source copies across as cleared, not as the server's old value.
 */
function extractMetadataForCopy(source: LocalFile): PendingMetadata | undefined {
  const { partNumber, description, revision } = resolveFileMetadata(source)

  // Only return metadata if there's something to copy
  if (!partNumber.value && !description.value && !revision.value) return undefined

  return {
    part_number: partNumber.value,
    description: description.value,
    revision: revision.value ?? undefined,
  }
}

/**
 * Rename Command - Rename a file or folder
 */
export const renameCommand: Command<RenameParams> = {
  id: 'rename',
  name: 'Rename',
  description: 'Rename a file or folder',
  aliases: ['ren'],
  usage: 'rename <old-name> <new-name>',

  validate({ file, newName }, ctx) {
    if (!file) {
      return 'No file selected'
    }

    if (!newName || newName.trim() === '') {
      return 'New name cannot be empty'
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(newName)) {
      return 'Name contains invalid characters'
    }

    // Block renaming if checked out by others
    if (file.pdmData?.id) {
      if (file.isDirectory) {
        // For folders: block if any nested file is checked out by another user
        const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
        const blockedBy = nestedFiles.find(
          (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== ctx.user?.id,
        )
        if (blockedBy) {
          const userName = (blockedBy.pdmData as any).checked_out_user?.full_name || 'another user' // TODO: type this
          return `Cannot rename folder: ${blockedBy.name} is checked out by ${userName}`
        }
      } else {
        if (file.pdmData.checked_out_by && file.pdmData.checked_out_by !== ctx.user?.id) {
          const userName = (file.pdmData as any).checked_out_user?.full_name || 'another user' // TODO: type this
          return `Cannot rename: file is checked out by ${userName}`
        }
      }
    }

    // Check for duplicate name in the same directory (case-insensitive for Windows)
    const parentPath = file.relativePath.includes('/')
      ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
      : ''

    const newNameLower = newName.trim().toLowerCase()
    const existingSibling = ctx.files.find((f) => {
      if (f.path === file.path) return false // Skip the file being renamed
      const siblingParent = f.relativePath.includes('/')
        ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
        : ''
      return siblingParent === parentPath && f.name.toLowerCase() === newNameLower
    })

    if (existingSibling) {
      return `A ${existingSibling.isDirectory ? 'folder' : 'file'} named "${newName.trim()}" already exists`
    }

    return null
  },

  async execute({ file, newName }, ctx): Promise<CommandResult> {
    let pathsToClear: string[] | null = null
    try {
      // Preserve the original file extension if not provided in the new name
      // Only applies to files, not directories
      let finalName = newName
      if (!file.isDirectory) {
        const originalExt = getExtension(file.name)
        const newNameExt = getExtension(newName)

        // If original file had an extension but new name doesn't, append the original extension
        if (originalExt && !newNameExt) {
          finalName = newName + originalExt
        }
      }

      // Rename locally first
      const oldPath = file.path
      const sep = file.path.includes('\\') ? '\\' : '/'
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf(sep))
      const newPath = `${parentDir}${sep}${finalName}`

      // Compute paths for file watcher suppression
      const oldRelPath = file.relativePath
      const relParentDir = oldRelPath.substring(0, oldRelPath.lastIndexOf('/'))
      const newRelPath = relParentDir ? `${relParentDir}/${finalName}` : finalName

      // Register expected file changes to suppress file watcher during operation
      // For folders, also register nested files to prevent spurious "unexpected changes" events
      const expectedPaths = [oldRelPath, newRelPath]
      if (file.isDirectory) {
        const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
        for (const nested of nestedFiles) {
          expectedPaths.push(nested.relativePath) // Old nested path
          // Compute new nested path by replacing the folder prefix
          const nestedNewPath = nested.relativePath.replace(oldRelPath, newRelPath)
          expectedPaths.push(nestedNewPath) // New nested path
        }
        log.debug('[Rename]', 'Registered expected changes for folder rename', {
          folder: oldRelPath,
          nestedFileCount: nestedFiles.length,
        })
      }
      ctx.addExpectedFileChanges(expectedPaths)
      pathsToClear = [...expectedPaths]

      // Handle cloud-only files: skip local rename (file doesn't exist locally), just update database
      if (file.diffStatus === 'cloud' && !file.isDirectory) {
        log.debug('[Rename]', 'Cloud-only file, skipping local rename', { fileName: file.name })

        // Update database path directly
        if (file.pdmData?.id) {
          await updateFilePath(file.pdmData.id, newRelPath)
          log.info('[Rename]', 'Updated cloud-only file path in database', {
            oldRelPath,
            newRelPath,
          })
        }

        // Update store with new path (cloud-only files have pdmData but no local file)
        ctx.renameFileInStore(oldPath, newPath, finalName, false)

        // Mark operation complete to help suppress file watcher
        ctx.setLastOperationCompletedAt(Date.now())

        ctx.addToast('success', `Renamed to ${finalName}`)

        return {
          success: true,
          message: `Renamed to ${finalName}`,
          total: 1,
          succeeded: 1,
          failed: 0,
        }
      }

      const renameResult = (await window.electronAPI?.renameItem(oldPath, newPath)) as
        | { success: boolean; error?: string; lockInfo?: string }
        | undefined
      if (!renameResult?.success) {
        const errorMsg = renameResult?.error || 'Failed to rename locally'
        const lockInfo = renameResult?.lockInfo
        log.error('[Rename]', 'Local rename failed', {
          fileName: file.name,
          oldPath,
          newPath,
          isDirectory: file.isDirectory,
          error: errorMsg,
          lockInfo,
        })

        // Show user-friendly toast for file locking errors
        const isLockError =
          errorMsg.includes('EPERM') ||
          errorMsg.includes('EBUSY') ||
          errorMsg.includes('operation not permitted')
        if (isLockError && lockInfo) {
          const parsed = parseLockInfoForToast(lockInfo)
          if (parsed) {
            ctx.addToast('error', `Cannot rename: ${parsed.message}`)
          } else {
            ctx.addToast(
              'error',
              `Cannot rename: file is in use by another application. Close it and try again.`,
            )
          }
        } else if (isLockError) {
          ctx.addToast(
            'error',
            `Cannot rename: file or folder is in use by another application. Try again in a few seconds.`,
          )
        } else {
          ctx.addToast('error', `Failed to rename: ${errorMsg}`)
        }

        return {
          success: false,
          message: errorMsg,
          total: 1,
          succeeded: 0,
          failed: 1,
        }
      }

      // Collect nested synced files BEFORE renameFileInStore changes paths
      let nestedSyncedFiles: Array<{
        oldRelPath: string
        newRelPath: string
        pdmData: LocalFile['pdmData']
      }> = []
      if (file.isDirectory) {
        const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
        nestedSyncedFiles = nestedFiles
          .filter((f) => f.pdmData?.file_path)
          .map((f) => ({
            oldRelPath: f.relativePath,
            newRelPath: newRelPath + f.relativePath.substring(oldRelPath.length),
            pdmData: f.pdmData,
          }))
      }

      // Optimistic UI update: rename in store BEFORE server updates
      // Must run before updateFolderPath because server updates trigger realtime events
      // that trickle in one-by-one. If the store isn't updated first, the folder entry
      // gets modified by realtime before renameFileInStore can find it.
      ctx.renameFileInStore(oldPath, newPath, finalName, false)

      // Update nested files' pdmData.file_path to prevent ghost files when loadFiles()
      // rebuilds the pdmMap. Same proven pattern as the move command.
      if (file.isDirectory && nestedSyncedFiles.length > 0) {
        const vaultPath = ctx.vaultPath || ''
        const sep = vaultPath.includes('\\') ? '\\' : '/'
        const pdmDataUpdates = nestedSyncedFiles.map((nested) => ({
          path: `${vaultPath}${sep}${nested.newRelPath.replace(/\//g, sep)}`,
          updates: {
            pdmData: {
              ...nested.pdmData,
              file_path: nested.newRelPath,
            },
          },
        }))
        ctx.updateFilesInStore(
          pdmDataUpdates as Array<{ path: string; updates: Partial<LocalFile> }>,
        )
        log.debug('[Rename]', 'Updated nested files pdmData.file_path', {
          folderPath: file.relativePath,
          updatedCount: pdmDataUpdates.length,
        })
      }

      // Mark operation complete to help suppress file watcher
      ctx.setLastOperationCompletedAt(Date.now())

      ctx.addToast('success', `Renamed to ${finalName}`)

      // For synced files, update server paths in the background.
      // The FS rename and store update are already done -- the UI is correct.
      // Server updates are slow for large folders (~2min for 164 files) and
      // must not block the rename UI.
      if (file.pdmData?.id) {
        if (file.isDirectory) {
          const folderId = file.pdmData.id
          const vaultId = ctx.activeVaultId || undefined
          const prev = pendingFolderServerUpdates.get(newRelPath)
          const serverUpdate = (prev ?? Promise.resolve()).then(async () => {
            const folderResult = await updateFolderPath(oldRelPath, newRelPath, vaultId)
            if (!folderResult.success || folderResult.updated < folderResult.total) {
              const failCount = (folderResult.total || 0) - folderResult.updated
              log.warn('[Rename]', 'Some server file paths failed to update', {
                updated: folderResult.updated,
                total: folderResult.total,
                errors: folderResult.errors,
              })
              ctx.addToast(
                'warning',
                `${failCount} file(s) may not have updated on the server. Try refreshing.`,
              )
            }
            try {
              await updateFolderServerPath(folderId, newRelPath)
              log.info('[Rename]', 'Updated folder path on server', { oldRelPath, newRelPath })
            } catch (error) {
              log.warn('[Rename]', 'Failed to update folder path on server', {
                error: error instanceof Error ? error.message : String(error),
              })
            }
          })
          pendingFolderServerUpdates.set(newRelPath, serverUpdate)
          serverUpdate.finally(() => {
            if (pendingFolderServerUpdates.get(newRelPath) === serverUpdate) {
              pendingFolderServerUpdates.delete(newRelPath)
            }
          })
        } else {
          updateFilePath(file.pdmData.id, newRelPath).catch((error) => {
            log.warn('[Rename]', 'Background file path update failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }
      }

      return {
        success: true,
        message: `Renamed to ${finalName}`,
        total: 1,
        succeeded: 1,
        failed: 0,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        total: 1,
        succeeded: 0,
        failed: 1,
      }
    } finally {
      // Schedule the watcher suppression clear after the same 5s window used by
      // download.ts and getLatest.ts. Clearing immediately races the debounced
      // FileWatcher event for the rename; clearing at all (even late) prevents
      // the expectedFileChanges set from growing unboundedly across operations.
      if (pathsToClear) {
        const paths = pathsToClear
        setTimeout(() => ctx.clearExpectedFileChanges(paths), 5000)
      }
    }
  },
}

/**
 * Move Command - Move files to a new location
 */
export const moveCommand: Command<MoveParams> = {
  id: 'move',
  name: 'Move',
  description: 'Move files to a new location',
  aliases: ['mv'],
  usage: 'move <source...> <destination>',

  validate({ files, targetFolder }, ctx) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }

    if (targetFolder === undefined) {
      return 'No target folder specified'
    }

    for (const file of files) {
      if (!file.isDirectory) continue
      const src = file.relativePath.replace(/\\/g, '/').toLowerCase()
      const dest = (targetFolder ?? '').replace(/\\/g, '/').toLowerCase()
      if (dest === src || dest.startsWith(src + '/')) {
        return `Cannot move "${file.name}" into itself or a subfolder`
      }
    }

    // Block moving files checked out by others
    const checkedOutByOthers = getFilesCheckedOutByOthers(ctx.files, files, ctx.user?.id)
    if (checkedOutByOthers.length > 0) {
      const names = checkedOutByOthers
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ')
      const suffix =
        checkedOutByOthers.length > 3 ? ` and ${checkedOutByOthers.length - 3} more` : ''
      return `Cannot move files checked out by others: ${names}${suffix}`
    }

    return null
  },

  async execute({ files, targetFolder, resolvedName }, ctx): Promise<CommandResult> {
    const toastId = `move-${Date.now()}`

    let succeededItems = 0
    let failedItems = 0
    let totalFilesMoved = 0 // Actual files moved (including directory contents)
    const errors: string[] = []
    let pathsToClear: string[] | null = null

    // Check if any file operations are in progress for files inside folders being moved
    // This prevents moving folders while downloads/syncs/checkins are active.
    // Runs before the progress toast and expected-change registration so an early
    // return here has nothing to clean up.
    for (const file of files) {
      if (file.isDirectory) {
        const folderPath = file.relativePath.replace(/\\/g, '/').toLowerCase()
        const opsInProgress: { path: string; operation: string }[] = []

        for (const [opPath, opType] of ctx.processingOperations) {
          const normalizedOpPath = opPath.replace(/\\/g, '/').toLowerCase()
          if (normalizedOpPath.startsWith(folderPath + '/') || normalizedOpPath === folderPath) {
            opsInProgress.push({ path: opPath, operation: opType })
          }
        }

        if (opsInProgress.length > 0) {
          const opTypes = [...new Set(opsInProgress.map((o) => o.operation))].join(', ')
          log.warn('[Move]', 'Cannot move folder: file operations in progress', {
            folder: file.name,
            operationsInProgress: opsInProgress.length,
            operationTypes: opTypes,
          })
          ctx.addToast(
            'warning',
            `Cannot move "${file.name}": ${opsInProgress.length} ${opTypes} operation(s) in progress. Wait for them to complete.`,
          )
          return {
            success: false,
            message: `Cannot move: ${opTypes} in progress`,
            total: files.length,
            succeeded: 0,
            failed: files.length,
          }
        }
      }
    }

    // Pre-count files for accurate progress tracking (like copy command)
    // Also register expected file changes to suppress file watcher during operation
    const expectedPaths: string[] = []
    const expectedFileCounts = new Map<string, number>() // Expected file count per item (for progress on failure)
    let totalFilesToMove = 0 // Total files including nested files in directories

    for (const file of files) {
      expectedPaths.push(file.relativePath) // Source path
      // Use resolvedName if provided (for rename during move), otherwise use original name
      const effectiveName = files.length === 1 && resolvedName ? resolvedName : file.name
      const newRelPath = targetFolder ? `${targetFolder}/${effectiveName}` : effectiveName
      expectedPaths.push(newRelPath) // Destination path

      // For directories, also register all nested file paths
      // This prevents the FileWatcher from treating nested file moves as "unexpected external changes"
      if (file.isDirectory) {
        const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
        for (const nested of nestedFiles) {
          expectedPaths.push(nested.relativePath) // Old nested path
          // Compute new nested path by replacing the folder prefix
          const nestedNewPath = nested.relativePath.replace(file.relativePath, newRelPath)
          expectedPaths.push(nestedNewPath) // New nested path
        }
        // Count only actual files (not directories) for progress
        const nestedFileCount = nestedFiles.filter((f) => !f.isDirectory).length
        totalFilesToMove += nestedFileCount
        expectedFileCounts.set(file.path, nestedFileCount)
        log.debug('[Move]', 'Registered expected changes for folder move', {
          folder: file.relativePath,
          nestedFileCount,
          totalExpectedPaths: expectedPaths.length,
        })
      } else {
        totalFilesToMove += 1
        expectedFileCounts.set(file.path, 1)
      }
    }
    ctx.addExpectedFileChanges(expectedPaths)
    pathsToClear = [...expectedPaths]

    // Initialize progress tracker with total file count (not item count)
    const progress = new ProgressTracker(
      ctx,
      'move',
      toastId,
      `Moving ${totalFilesToMove} file${totalFilesToMove !== 1 ? 's' : ''}...`,
      totalFilesToMove,
    )

    // Cancel queued thumbnail extractions for files in folders being moved
    // This prevents EPERM errors from open file handles during thumbnail generation
    // Type cast needed because these APIs are defined in electron/preload.ts but not recognized by src compilation
    const electronAPI = window.electronAPI as typeof window.electronAPI & {
      cancelPreviewsForFolder?: (
        folderPath: string,
      ) => Promise<{ cancelledCount: number; activeCount: number; activePaths: string[] }>
      releaseHandles?: () => Promise<{
        success: boolean
        data?: { released: boolean }
        error?: string
      }>
    }

    for (const file of files) {
      if (file.isDirectory && electronAPI?.cancelPreviewsForFolder) {
        const result = await electronAPI.cancelPreviewsForFolder(file.path)
        if (result) {
          if (result.cancelledCount > 0 || result.activeCount > 0) {
            log.debug('[Move]', 'Cancelled previews for folder move', {
              folder: file.name,
              cancelledCount: result.cancelledCount,
              activeCount: result.activeCount,
            })
          }

          // If there are active extractions, wait briefly for them to complete
          if (result.activeCount > 0) {
            log.debug('[Move]', `Waiting for ${result.activeCount} active thumbnail extractions...`)
            await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_EXTRACTION_WAIT_MS))
          }
        }
      }
    }

    // Release SolidWorks Document Manager handles before folder moves
    // The DM API caches directory handles that prevent folder moves with EPERM errors
    const hasDirectoryMoves = files.some((f) => f.isDirectory)
    const directoryFiles = files.filter((f) => f.isDirectory)

    // Note: testFileLocks was removed - lock checking now happens at UI level via checkFolderLocks
    // which shows a modal with ALL locked files before the move command is executed

    if (hasDirectoryMoves && electronAPI?.releaseHandles) {
      log.info('[Move-DEBUG]', 'Starting handle release for folder move', {
        directoryCount: directoryFiles.length,
        directories: directoryFiles.map((f) => f.name),
        timestamp: new Date().toISOString(),
      })

      const releaseStartTime = Date.now()
      try {
        const releaseResult = await electronAPI.releaseHandles()
        const releaseDuration = Date.now() - releaseStartTime

        log.info('[Move-DEBUG]', 'Handle release completed', {
          result: releaseResult as Record<string, unknown>,
          durationMs: releaseDuration,
        })

        // Add delay for OS to fully release file handles
        // COM object release is synchronous but OS handle release is asynchronous
        // INCREASED from 500ms to 2000ms for reliability
        const handleReleaseDelayMs = 2000
        log.info(
          '[Move-DEBUG]',
          `Waiting ${handleReleaseDelayMs}ms for OS to release file handles...`,
        )
        await new Promise((resolve) => setTimeout(resolve, handleReleaseDelayMs))

        // NOTE: Post-release lock verification was removed because:
        // 1. Lock checking now happens at the UI level BEFORE this command (via checkFolderLocks)
        // 2. Sampling-based checks were unreliable (tested wrong files, gave false confidence)
        // 3. The UI shows a modal with ALL locked files, giving user full control

        const totalReleaseTime = Date.now() - releaseStartTime
        log.info('[Move-DEBUG]', `Handle release completed in ${totalReleaseTime}ms`)
      } catch (error) {
        // Non-fatal - log and continue with move attempt
        log.warn('[Move]', 'Failed to release SW handles (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    for (const file of files) {
      try {
        // Move locally
        const sep = file.path.includes('\\') ? '\\' : '/'
        const vaultPath = ctx.vaultPath || ''
        // Use resolvedName if provided (for single-file rename during move), otherwise use original name
        const effectiveName = files.length === 1 && resolvedName ? resolvedName : file.name
        const newPath = targetFolder
          ? `${vaultPath}${sep}${targetFolder.replace(/\//g, sep)}${sep}${effectiveName}`
          : `${vaultPath}${sep}${effectiveName}`

        // Compute new relative path for DB and store updates
        const newRelPath = targetFolder ? `${targetFolder}/${effectiveName}` : effectiveName

        // Handle cloud-only files: skip local move (file doesn't exist locally), just update database
        if (file.diffStatus === 'cloud' && !file.isDirectory) {
          log.debug('[Move]', 'Cloud-only file, skipping local move', { fileName: file.name })

          // Update database path directly
          if (file.pdmData?.id) {
            const cloudMoveResult = ctx.user?.id
              ? await moveFileOnServer(file.pdmData.id, ctx.user.id, newRelPath, effectiveName)
              : await updateFilePath(file.pdmData.id, newRelPath)

            if (!cloudMoveResult.success) {
              log.error('[Move]', 'Server move failed for cloud-only file', {
                fileName: file.name,
                newPath: newRelPath,
                error: cloudMoveResult.error,
              })
              failedItems++
              errors.push(`${file.name}: ${cloudMoveResult.error || 'Failed to move on server'}`)
              progress.update()
              continue
            }

            log.info('[Move]', 'Updated cloud-only file path in database', {
              oldPath: file.relativePath,
              newPath: newRelPath,
            })
          }

          // Update store with new path (cloud-only files have pdmData but no local file)
          ctx.renameFileInStore(file.path, newPath, newRelPath, true)

          // Count this as success
          const filesMoved = 1
          totalFilesMoved += filesMoved
          progress.update()
          succeededItems++
          continue
        }

        // For directories containing cloud-only files, update those DB paths FIRST
        // This allows the atomic folder rename to succeed (cloud files don't exist locally)
        if (file.isDirectory) {
          const cloudOnlyFiles = getCloudOnlyFilesFromSelection(ctx.files, [file])
          const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
          const localFilesCount = nestedFiles.filter((f) => f.diffStatus !== 'cloud').length

          if (cloudOnlyFiles.length > 0) {
            log.debug('[Move]', 'Folder contains cloud-only files, updating DB paths first', {
              folder: file.name,
              cloudOnlyCount: cloudOnlyFiles.length,
              localFilesCount,
            })

            // Update database paths for cloud-only files BEFORE local folder move
            for (const cloudFile of cloudOnlyFiles) {
              if (cloudFile.pdmData?.id) {
                // Compute new path by replacing the moved folder's path prefix
                const cloudFileNewRelPath = cloudFile.relativePath.replace(
                  file.relativePath,
                  newRelPath,
                )
                await updateFilePath(cloudFile.pdmData.id, cloudFileNewRelPath)

                // Update store for this cloud-only file
                const cloudFileNewPath = cloudFile.path.replace(file.path, newPath)
                ctx.renameFileInStore(cloudFile.path, cloudFileNewPath, cloudFileNewRelPath, true)

                log.debug('[Move]', 'Updated cloud-only file in folder', {
                  fileName: cloudFile.name,
                  oldPath: cloudFile.relativePath,
                  newPath: cloudFileNewRelPath,
                })
              }
            }

            // If folder contains ONLY cloud-only files (no local files), skip the local rename
            // because there's nothing to move on the filesystem
            if (localFilesCount === 0) {
              log.info('[Move]', 'Folder contains only cloud-only files, skipping local rename', {
                folder: file.name,
                cloudOnlyCount: cloudOnlyFiles.length,
              })

              // Update the folder record itself if it has one
              if (file.pdmData?.id) {
                try {
                  await updateFolderServerPath(file.pdmData.id, newRelPath)
                  log.info('[Move]', 'Updated cloud-only folder path on server', {
                    oldPath: file.relativePath,
                    newPath: newRelPath,
                  })
                } catch (error) {
                  log.warn('[Move]', 'Failed to update folder path on server', {
                    error: error instanceof Error ? error.message : String(error),
                  })
                }
              }

              // Update folder in store
              ctx.renameFileInStore(file.path, newPath, newRelPath, true)

              // Update progress (count cloud files as moved)
              totalFilesMoved += cloudOnlyFiles.length
              for (let i = 0; i < cloudOnlyFiles.length; i++) {
                progress.update()
              }

              succeededItems++
              continue // Skip the local filesystem rename
            }
          }
        }

        // Debug logging for move inputs
        log.debug('[Move]', 'Attempting local move', {
          fileName: file.name,
          sourcePath: file.path,
          destPath: newPath,
          isDirectory: file.isDirectory,
          targetFolder: targetFolder || '(root)',
        })

        const moveResult = (await window.electronAPI?.renameItem(file.path, newPath)) as
          | { success: boolean; fileCount?: number; error?: string; lockInfo?: string }
          | undefined
        if (!moveResult?.success) {
          // Log the error with full context for debugging
          log.error('[Move]', 'Local move failed', {
            fileName: file.name,
            sourcePath: file.path,
            destPath: newPath,
            isDirectory: file.isDirectory,
            error: moveResult?.error || 'Unknown error',
            lockInfo: moveResult?.lockInfo,
          })
          failedItems++
          // Include lockInfo in the error string for toast processing
          const errorMsg = moveResult?.lockInfo
            ? `${file.name}: LOCKED_BY:${moveResult.lockInfo}`
            : `${file.name}: ${moveResult?.error || 'Failed to move'}`
          errors.push(errorMsg)
          // Update progress by expected file count for this item
          const expectedCount = expectedFileCounts.get(file.path) || 1
          for (let i = 0; i < expectedCount; i++) {
            progress.update()
          }
          continue
        }

        // Track actual files moved (including directory contents)
        const filesMoved = moveResult.fileCount || 1
        totalFilesMoved += filesMoved

        // Update progress by actual files moved
        for (let i = 0; i < filesMoved; i++) {
          progress.update()
        }

        // Update server if synced (newRelPath already computed at start of loop)
        if (file.pdmData?.id) {
          if (file.isDirectory) {
            const folderResult = await updateFolderPath(
              file.relativePath,
              newRelPath,
              ctx.activeVaultId || undefined,
            )
            if (!folderResult.success || folderResult.updated < folderResult.total) {
              const failCount = (folderResult.total || 0) - folderResult.updated
              log.warn('[Move]', 'Some server file paths failed to update', {
                updated: folderResult.updated,
                total: folderResult.total,
                errors: folderResult.errors,
              })
              ctx.addToast(
                'warning',
                `${failCount} file(s) may not have updated on the server. Try refreshing.`,
              )
            }
            try {
              await updateFolderServerPath(file.pdmData.id, newRelPath)
              log.info('[Move]', 'Updated folder path on server', {
                oldPath: file.relativePath,
                newPath: newRelPath,
              })
            } catch (error) {
              log.warn('[Move]', 'Failed to update folder path on server', {
                error: error instanceof Error ? error.message : String(error),
              })
            }
          } else {
            const serverMoveResult = ctx.user?.id
              ? await moveFileOnServer(file.pdmData.id, ctx.user.id, newRelPath, effectiveName)
              : await updateFilePath(file.pdmData.id, newRelPath)

            if (!serverMoveResult.success) {
              // The file is already moved on disk, so put it back rather than
              // leaving the vault and the server disagreeing about where it lives.
              log.error('[Move]', 'Server move failed, rolling back local move', {
                fileName: file.name,
                sourcePath: file.path,
                destPath: newPath,
                error: serverMoveResult.error,
              })

              const rollback = (await window.electronAPI?.renameItem(newPath, file.path)) as
                | { success: boolean; error?: string }
                | undefined
              if (!rollback?.success) {
                log.error('[Move]', 'Failed to roll back local move', {
                  fileName: file.name,
                  error: rollback?.error,
                })
              }

              totalFilesMoved -= filesMoved
              failedItems++
              errors.push(`${file.name}: ${serverMoveResult.error || 'Failed to move on server'}`)
              continue
            }
          }
        }

        // For directory moves, collect nested synced files BEFORE renameFileInStore
        // (since renameFileInStore will update paths immediately)
        let nestedSyncedFiles: Array<{
          oldRelPath: string
          newRelPath: string
          pdmData: LocalFile['pdmData']
        }> = []
        if (file.isDirectory) {
          const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
          nestedSyncedFiles = nestedFiles
            .filter((f) => f.pdmData?.file_path) // Only synced files with pdmData
            .map((f) => ({
              oldRelPath: f.relativePath,
              newRelPath: newRelPath + f.relativePath.substring(file.relativePath.length),
              pdmData: f.pdmData,
            }))
        }

        // Optimistic UI update: update file path in store immediately
        ctx.renameFileInStore(file.path, newPath, newRelPath, true)

        // For directory moves, also update nested files' pdmData.file_path to prevent
        // them from becoming "local only" when loadFiles() runs and compares paths
        if (file.isDirectory && nestedSyncedFiles.length > 0) {
          const vaultPath = ctx.vaultPath || ''
          const sep = vaultPath.includes('\\') ? '\\' : '/'
          const pdmDataUpdates = nestedSyncedFiles.map((nested) => ({
            // Use the NEW path (after renameFileInStore updated it)
            path: `${vaultPath}${sep}${nested.newRelPath.replace(/\//g, sep)}`,
            updates: {
              pdmData: {
                ...nested.pdmData,
                file_path: nested.newRelPath, // Update file_path to match new relativePath
              },
            },
          }))
          ctx.updateFilesInStore(
            pdmDataUpdates as Array<{ path: string; updates: Partial<LocalFile> }>,
          )
          log.debug('[Move]', 'Updated nested files pdmData.file_path', {
            folderPath: file.relativePath,
            updatedCount: pdmDataUpdates.length,
          })
        }

        succeededItems++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        log.error('[Move]', 'Move operation threw exception', {
          fileName: file.name,
          sourcePath: file.path,
          isDirectory: file.isDirectory,
          error: errorMessage,
        })
        failedItems++
        errors.push(`${file.name}: ${errorMessage}`)
        // Update progress by expected file count for this item
        const expectedCount = expectedFileCounts.get(file.path) || 1
        for (let i = 0; i < expectedCount; i++) {
          progress.update()
        }
      }
    }

    const { duration } = progress.finish()

    // Mark operation complete to help suppress file watcher
    ctx.setLastOperationCompletedAt(Date.now())

    if (!ctx.silent) {
      if (failedItems > 0) {
        // Check if we have lock info from the error
        const lockInfoMatch = errors.find((e) => e.includes('LOCKED_BY:'))
        if (lockInfoMatch) {
          // Extract the lock info (process name/details)
          const lockInfo = lockInfoMatch.split('LOCKED_BY:')[1]?.trim() || 'another application'
          const parsed = parseLockInfoForToast(lockInfo)
          if (parsed) {
            ctx.addToast('error', `Cannot move: ${parsed.message}`)
          } else {
            ctx.addToast(
              'error',
              `Cannot move: file is in use by another application. Close it and try again.`,
            )
          }
        } else {
          // Check for specific error types
          const hasLockError = errors.some(
            (e) =>
              e.includes('EPERM') || e.includes('EBUSY') || e.includes('operation not permitted'),
          )
          const hasNotFoundError = errors.some(
            (e) => e.includes('ENOENT') || e.includes('no such file'),
          )

          if (hasLockError) {
            ctx.addToast(
              'error',
              `Cannot move: file or folder is in use by another application. Try again in a few seconds.`,
            )
          } else if (hasNotFoundError) {
            ctx.addToast(
              'error',
              `Cannot move: some files do not exist locally. Try downloading them first.`,
            )
          } else {
            ctx.addToast(
              'error',
              `Moved ${totalFilesMoved} file${totalFilesMoved !== 1 ? 's' : ''} (${failedItems} item${failedItems !== 1 ? 's' : ''} failed)`,
            )
          }
        }
      } else {
        ctx.addToast('success', `Moved ${totalFilesMoved} file${totalFilesMoved !== 1 ? 's' : ''}`)
      }
    }

    // No onRefresh needed - UI updates instantly via renameFileInStore

    // Schedule the watcher suppression clear after the same 5s window used by
    // download.ts and getLatest.ts. Without this the expectedFileChanges set
    // grows unboundedly across move operations.
    if (pathsToClear) {
      const paths = pathsToClear
      setTimeout(() => ctx.clearExpectedFileChanges(paths), 5000)
    }

    return {
      success: failedItems === 0,
      message:
        failedItems > 0
          ? `Moved ${totalFilesMoved} files (${failedItems} items failed)`
          : `Moved ${totalFilesMoved} file${totalFilesMoved !== 1 ? 's' : ''}`,
      total: totalFilesMoved,
      succeeded: succeededItems,
      failed: failedItems,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    }
  },
}

/**
 * Generate a unique copy name for a file that already exists.
 * e.g., "file.txt" -> "file - Copy.txt" -> "file - Copy (2).txt" -> etc.
 */
async function generateUniqueCopyName(basePath: string, sep: string): Promise<string> {
  const lastSepIndex = basePath.lastIndexOf(sep)
  const dir = basePath.substring(0, lastSepIndex)
  const filename = basePath.substring(lastSepIndex + 1)

  // Split filename into name and extension
  const lastDotIndex = filename.lastIndexOf('.')
  const hasExtension = lastDotIndex > 0
  const name = hasExtension ? filename.substring(0, lastDotIndex) : filename
  const ext = hasExtension ? filename.substring(lastDotIndex) : ''

  // Try "name - Copy.ext" first
  let copyName = `${name} - Copy${ext}`
  let copyPath = `${dir}${sep}${copyName}`

  const exists = await window.electronAPI?.fileExists(copyPath)
  if (!exists) {
    return copyPath
  }

  // Try "name - Copy (N).ext" for N = 2, 3, 4, ...
  let counter = 2
  while (counter < 1000) {
    // Safety limit
    copyName = `${name} - Copy (${counter})${ext}`
    copyPath = `${dir}${sep}${copyName}`

    const copyExists = await window.electronAPI?.fileExists(copyPath)
    if (!copyExists) {
      return copyPath
    }
    counter++
  }

  // Fallback: use timestamp
  copyName = `${name} - Copy (${Date.now()})${ext}`
  return `${dir}${sep}${copyName}`
}

/**
 * Copy Command - Copy files to a new location
 */
export const copyCommand: Command<CopyParams> = {
  id: 'copy',
  name: 'Copy',
  description: 'Copy files to a new location',
  aliases: ['cp'],
  usage: 'copy <source...> <destination>',

  validate({ files, targetFolder }) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }

    if (targetFolder === undefined) {
      return 'No target folder specified'
    }

    return null
  },

  async execute({ files, targetFolder }, ctx): Promise<CommandResult> {
    const toastId = `copy-${Date.now()}`

    let succeededItems = 0
    let failedItems = 0
    let totalFilesCopied = 0 // Actual files copied (including directory contents)
    const errors: string[] = []
    const newFiles: LocalFile[] = []

    // Build expected file changes for all items BEFORE starting copy operations
    // This prevents FileWatcher from treating nested file copies as "unexpected external changes"
    // which would trigger unnecessary loadFiles + metadata refresh
    // Also pre-count total files for accurate progress tracking
    const expectedPaths: string[] = []
    const destPathCache = new Map<string, string>() // Cache computed dest paths for reuse in loop
    const expectedFileCounts = new Map<string, number>() // Expected file count per item (for progress on failure)
    // Cache nested files with their destination paths for optimistic UI update
    const nestedFilesCache = new Map<
      string,
      Array<{ source: LocalFile; destRelativePath: string }>
    >()
    let totalFilesToCopy = 0 // Total files including nested files in directories

    for (const file of files) {
      const sep = file.path.includes('\\') ? '\\' : '/'
      const vaultPath = ctx.vaultPath || ''
      let destPath = targetFolder
        ? `${vaultPath}${sep}${targetFolder.replace(/\//g, sep)}${sep}${file.name}`
        : `${vaultPath}${sep}${file.name}`

      // Check if source and destination are the same, or if destination already exists
      // Use case-insensitive comparison for Windows compatibility
      if (file.path.toLowerCase() === destPath.toLowerCase()) {
        destPath = await generateUniqueCopyName(destPath, sep)
      } else {
        const destExists = await window.electronAPI?.fileExists(destPath)
        if (destExists) {
          destPath = await generateUniqueCopyName(destPath, sep)
        }
      }

      // Cache the computed destination path
      destPathCache.set(file.path, destPath)

      const destName = destPath.substring(destPath.lastIndexOf(sep) + 1)
      const destRelativePath = targetFolder ? `${targetFolder}/${destName}` : destName

      expectedPaths.push(destRelativePath)

      // For directories, also register nested file destination paths and count files
      if (file.isDirectory) {
        const nestedFiles = getFilesInFolder(ctx.files, file.relativePath)
        const nestedWithDest: Array<{ source: LocalFile; destRelativePath: string }> = []
        // When copying into a descendant of self, copyDirSync skips entries on the
        // ancestor chain of the destination. Mirror that here so we don't register
        // phantom expected paths / optimistic store rows.
        const destLower = destRelativePath.replace(/\\/g, '/').toLowerCase()
        let nestedFileCount = 0
        for (const nested of nestedFiles) {
          const srcLower = nested.relativePath.replace(/\\/g, '/').toLowerCase()
          if (srcLower === destLower || destLower.startsWith(srcLower + '/')) {
            continue
          }
          const nestedDestPath = nested.relativePath.replace(file.relativePath, destRelativePath)
          expectedPaths.push(nestedDestPath)
          nestedWithDest.push({ source: nested, destRelativePath: nestedDestPath })
          if (!nested.isDirectory) nestedFileCount++
        }
        nestedFilesCache.set(file.path, nestedWithDest)
        totalFilesToCopy += nestedFileCount
        expectedFileCounts.set(file.path, nestedFileCount)
        log.debug('[Copy]', 'Registered expected changes for folder copy', {
          folder: file.relativePath,
          nestedFileCount,
          totalExpectedPaths: expectedPaths.length,
        })
      } else {
        totalFilesToCopy += 1
        expectedFileCounts.set(file.path, 1)
      }
    }

    // Register all expected changes before starting copy operations
    ctx.addExpectedFileChanges(expectedPaths)
    const pathsToClear = [...expectedPaths]

    // Initialize progress tracker with total file count (not item count)
    const progress = new ProgressTracker(
      ctx,
      'copy',
      toastId,
      `Copying ${totalFilesToCopy} file${totalFilesToCopy !== 1 ? 's' : ''}...`,
      totalFilesToCopy,
    )

    for (const file of files) {
      try {
        // Get cached destination path (already computed above)
        const sep = file.path.includes('\\') ? '\\' : '/'
        const destPath = destPathCache.get(file.path)!

        // Compute destination relative path
        const destName = destPath.substring(destPath.lastIndexOf(sep) + 1)
        const destRelativePath = targetFolder ? `${targetFolder}/${destName}` : destName

        const copyResult = (await window.electronAPI?.copyFile(file.path, destPath)) as
          | { success: boolean; fileCount?: number; error?: string }
          | undefined
        if (!copyResult?.success) {
          failedItems++
          errors.push(`${file.name}: ${copyResult?.error || 'Failed to copy'}`)
          // Update progress by expected file count for this item
          const expectedCount = expectedFileCounts.get(file.path) || 1
          for (let i = 0; i < expectedCount; i++) {
            progress.update()
          }
        } else {
          succeededItems++
          const filesCopied = copyResult.fileCount || 1
          totalFilesCopied += filesCopied

          // Update progress by actual files copied
          for (let i = 0; i < filesCopied; i++) {
            progress.update()
          }

          // Construct LocalFile for optimistic UI update
          // Extract metadata from both pendingMetadata and pdmData for copying
          const newFile: LocalFile = {
            name: destName,
            path: destPath,
            relativePath: destRelativePath,
            isDirectory: file.isDirectory,
            extension: file.extension,
            size: file.size,
            modifiedTime: new Date().toISOString(),
            // Copied file is local-only (not synced to server)
            isSynced: false,
            diffStatus: 'added',
            // Copy metadata from source file (from pendingMetadata or pdmData)
            pendingMetadata: extractMetadataForCopy(file),
            // Preserve version history source for copying at first sync
            copiedFromFileId: file.pdmData?.id,
            copiedVersion: file.pdmData?.version,
          }
          newFiles.push(newFile)

          // For directories, also add all nested files AND intermediate subdirectories
          // to the store for instant UI update. Without intermediate directories,
          // the file browser's getFilesInFolder (which shows direct children only)
          // won't find any files to display when navigating into the copied folder.
          if (file.isDirectory) {
            const nestedWithDest = nestedFilesCache.get(file.path)
            if (nestedWithDest) {
              const vaultPath = ctx.vaultPath || ''
              // Track directories already added to avoid duplicates
              const addedDirs = new Set<string>()

              for (const { source, destRelativePath: nestedDestRelPath } of nestedWithDest) {
                // First, add any intermediate directories that don't exist yet
                // For a path like "BASESTATION/DEVELOPMENT/file.SLDASM", we need to ensure
                // "BASESTATION/DEVELOPMENT" exists as a directory entry in the store
                const pathParts = nestedDestRelPath.split('/')
                let currentPath = ''
                for (let i = 0; i < pathParts.length - 1; i++) {
                  currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
                  // Skip if already added, or if it's the root folder being copied (already added above)
                  if (addedDirs.has(currentPath) || currentPath === destRelativePath) continue
                  addedDirs.add(currentPath)

                  const dirFullPath = `${vaultPath}${sep}${currentPath.replace(/\//g, sep)}`
                  newFiles.push({
                    name: pathParts[i],
                    path: dirFullPath,
                    relativePath: currentPath,
                    isDirectory: true,
                    extension: '',
                    size: 0,
                    modifiedTime: new Date().toISOString(),
                    isSynced: false,
                    diffStatus: 'added',
                  })
                }

                // Then add the file itself
                const nestedFullPath = `${vaultPath}${sep}${nestedDestRelPath.replace(/\//g, sep)}`
                newFiles.push({
                  name: source.name,
                  path: nestedFullPath,
                  relativePath: nestedDestRelPath,
                  isDirectory: source.isDirectory,
                  extension: source.extension,
                  size: source.size,
                  modifiedTime: new Date().toISOString(),
                  isSynced: false,
                  diffStatus: 'added',
                  // Copy metadata from source file (from pendingMetadata or pdmData)
                  pendingMetadata: extractMetadataForCopy(source),
                  // Preserve version history source for copying at first sync
                  copiedFromFileId: source.pdmData?.id,
                  copiedVersion: source.pdmData?.version,
                })
              }
            }
          }
        }
      } catch (error) {
        failedItems++
        errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        // Update progress by expected file count for this item
        const expectedCount = expectedFileCounts.get(file.path) || 1
        for (let i = 0; i < expectedCount; i++) {
          progress.update()
        }
      }
    }

    const { duration } = progress.finish()

    // Optimistic UI update: add new files to store immediately
    if (newFiles.length > 0) {
      ctx.addFilesToStore(newFiles)

      // Persist metadata for copied files so it survives reloads
      // This updates both the file in store and persistedPendingMetadata
      const store = usePDMStore.getState()
      for (const newFile of newFiles) {
        if (
          newFile.pendingMetadata &&
          Object.keys(newFile.pendingMetadata).some(
            (k) => newFile.pendingMetadata![k as keyof PendingMetadata] != null,
          )
        ) {
          store.updatePendingMetadata(newFile.path, newFile.pendingMetadata)
        }
        // Persist copy source info for version history preservation
        if (newFile.copiedFromFileId && newFile.copiedVersion) {
          store.setCopySource(newFile.path, {
            sourceFileId: newFile.copiedFromFileId,
            version: newFile.copiedVersion,
          })
        }
      }

      // Yield to browser to allow UI to repaint
      await new Promise((resolve) => setTimeout(resolve, DEFER_MS))
    }

    // Mark operation complete to help suppress file watcher
    ctx.setLastOperationCompletedAt(Date.now())

    if (!ctx.silent) {
      if (failedItems > 0) {
        ctx.addToast(
          'error',
          `Copied ${totalFilesCopied} file${totalFilesCopied !== 1 ? 's' : ''} (${failedItems} item${failedItems !== 1 ? 's' : ''} failed)`,
        )
      } else {
        ctx.addToast(
          'success',
          `Copied ${totalFilesCopied} file${totalFilesCopied !== 1 ? 's' : ''}`,
        )
      }
    }

    // No onRefresh needed - UI updates instantly via addFilesToStore

    // Schedule the watcher suppression clear after the same 5s window used by
    // download.ts and getLatest.ts; otherwise expectedFileChanges grows
    // unboundedly across copy operations.
    setTimeout(() => ctx.clearExpectedFileChanges(pathsToClear), 5000)

    return {
      success: failedItems === 0,
      message:
        failedItems > 0
          ? `Copied ${totalFilesCopied} files (${failedItems} items failed)`
          : `Copied ${totalFilesCopied} file${totalFilesCopied !== 1 ? 's' : ''}`,
      total: totalFilesToCopy,
      succeeded: totalFilesCopied,
      failed: failedItems > 0 ? totalFilesToCopy - totalFilesCopied : 0,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    }
  },
}

/**
 * New Folder Command - Create a new folder
 */
export const newFolderCommand: Command<NewFolderParams> = {
  id: 'new-folder',
  name: 'New Folder',
  description: 'Create a new folder',
  aliases: ['mkdir', 'md'],
  usage: 'mkdir <name>',

  validate({ folderName }, ctx) {
    if (!folderName || folderName.trim() === '') {
      return 'Folder name cannot be empty'
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(folderName)) {
      return 'Folder name contains invalid characters'
    }

    if (!ctx.vaultPath) {
      return 'No vault connected'
    }

    return null
  },

  async execute({ parentPath, folderName }, ctx): Promise<CommandResult> {
    let pathsToClear: string[] | null = null
    try {
      const vaultPath = ctx.vaultPath!
      const sep = vaultPath.includes('\\') ? '\\' : '/'

      // Check for existing folder with same name (case-insensitive) using fresh store state
      // This prevents duplicate folders when React state is stale in the UI hook
      const existingFolderNames = new Set(
        ctx.files
          .filter((f) => f.isDirectory)
          .filter((f) => {
            const parent = f.relativePath.includes('/')
              ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
              : ''
            return parent === (parentPath || '')
          })
          .map((f) => f.name.toLowerCase()),
      )

      let finalName = folderName
      if (existingFolderNames.has(folderName.toLowerCase())) {
        // Generate unique name
        let counter = 2
        while (existingFolderNames.has(`new folder (${counter})`) && counter < 1000) {
          counter++
        }
        finalName = `New Folder (${counter})`
        log.info('[NewFolder]', 'Name conflict, using unique name', {
          requested: folderName,
          using: finalName,
        })
      }

      const fullPath = parentPath
        ? `${vaultPath}${sep}${parentPath.replace(/\//g, sep)}${sep}${finalName}`
        : `${vaultPath}${sep}${finalName}`

      // Compute relative path for file watcher suppression
      const relativePath = parentPath ? `${parentPath}/${finalName}` : finalName

      // Register expected file changes to suppress file watcher during operation
      ctx.addExpectedFileChanges([relativePath])
      pathsToClear = [relativePath]

      const result = await window.electronAPI?.createFolder(fullPath)
      if (!result?.success) {
        return {
          success: false,
          message: result?.error || 'Failed to create folder',
          total: 1,
          succeeded: 0,
          failed: 1,
        }
      }

      // Sync folder to server immediately (if online and connected)
      let folderPdmData: { id: string; folder_path: string } | undefined
      if (ctx.activeVaultId && ctx.organization?.id && ctx.user?.id && !ctx.isOfflineMode) {
        const { folder, error } = await syncFolder(
          ctx.organization.id,
          ctx.activeVaultId,
          ctx.user.id,
          relativePath,
        )
        if (error) {
          // Log warning but don't fail - local folder still created
          log.warn('[NewFolder]', 'Failed to sync folder to server', {
            relativePath,
            error: error instanceof Error ? error.message : String(error),
          })
        } else if (folder) {
          folderPdmData = { id: folder.id, folder_path: folder.folder_path }
          log.info('[NewFolder]', 'Folder synced to server', { relativePath, folderId: folder.id })
        }
      }

      // Optimistic UI update: add new folder to store immediately
      const newFolder: LocalFile = {
        name: finalName,
        path: fullPath,
        relativePath,
        isDirectory: true,
        extension: '',
        size: 0,
        modifiedTime: new Date().toISOString(),
        isSynced: !!folderPdmData,
        diffStatus: folderPdmData ? undefined : 'added',
        // Store folder PDM data if synced (uses same pdmData field but with folder-specific shape)
        pdmData: folderPdmData
          ? ({ id: folderPdmData.id, folder_path: folderPdmData.folder_path } as any) // TODO: type this
          : undefined,
      }
      ctx.addFilesToStore([newFolder])

      // Yield to browser to allow UI to repaint
      await new Promise((resolve) => setTimeout(resolve, DEFER_MS))

      // Mark operation complete to help suppress file watcher
      ctx.setLastOperationCompletedAt(Date.now())

      ctx.addToast('success', `Created folder: ${finalName}`)
      // No onRefresh needed - UI updates instantly via addFilesToStore

      return {
        success: true,
        message: `Created folder: ${finalName}`,
        total: 1,
        succeeded: 1,
        failed: 0,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        total: 1,
        succeeded: 0,
        failed: 1,
      }
    } finally {
      // Clear watcher suppression after the same 5s window used elsewhere so
      // expectedFileChanges does not grow unboundedly.
      if (pathsToClear) {
        const paths = pathsToClear
        setTimeout(() => ctx.clearExpectedFileChanges(paths), 5000)
      }
    }
  },
}

/**
 * Merge Folder Command - Merge a folder's contents into an existing folder
 * Used when moving a folder to a location where a folder with the same name exists
 */
export const mergeFolderCommand: Command<MergeFolderParams> = {
  id: 'merge-folder',
  name: 'Merge Folder',
  description: 'Merge folder contents into an existing folder',
  aliases: [],
  usage: 'merge-folder <source> <destination>',

  validate({ sourceFolder, targetFolder }, ctx) {
    if (!sourceFolder) {
      return 'Source folder is required'
    }

    if (!sourceFolder.isDirectory) {
      return 'Source must be a directory'
    }

    if (targetFolder === undefined) {
      return 'Target folder is required'
    }

    if (!ctx.vaultPath) {
      return 'No vault connected'
    }

    return null
  },

  async execute(
    { sourceFolder, targetFolder, conflictResolution = 'prompt' },
    ctx,
  ): Promise<CommandResult> {
    const toastId = `merge-${Date.now()}`
    let pathsToClear: string[] | null = null

    try {
      const vaultPath = ctx.vaultPath!
      const sep = vaultPath.includes('\\') ? '\\' : '/'

      // Target folder path (existing folder with same name)
      const destFolderRelPath = targetFolder
        ? `${targetFolder}/${sourceFolder.name}`
        : sourceFolder.name
      const destFolderPath = `${vaultPath}${sep}${destFolderRelPath.replace(/\//g, sep)}`

      // Get all files in source folder
      const sourceFiles = getFilesInFolder(ctx.files, sourceFolder.relativePath)

      // Get all files in destination folder
      const destFiles = getFilesInFolder(ctx.files, destFolderRelPath)
      const destFileNames = new Set(
        destFiles.map((f) => {
          // Get relative path within the destination folder
          const relPath = f.relativePath.substring(destFolderRelPath.length + 1)
          return relPath.toLowerCase()
        }),
      )

      // Categorize source files: conflicts vs non-conflicts
      const conflicts: Array<{ source: LocalFile; destPath: string }> = []
      const nonConflicts: Array<{ source: LocalFile; destPath: string }> = []

      for (const sourceFile of sourceFiles) {
        // Compute relative path within source folder
        const relPathInSource = sourceFile.relativePath.substring(
          sourceFolder.relativePath.length + 1,
        )

        // Compute destination path
        const destRelPath = `${destFolderRelPath}/${relPathInSource}`
        const destPath = `${vaultPath}${sep}${destRelPath.replace(/\//g, sep)}`

        if (destFileNames.has(relPathInSource.toLowerCase())) {
          conflicts.push({ source: sourceFile, destPath })
        } else {
          nonConflicts.push({ source: sourceFile, destPath })
        }
      }

      log.info('[MergeFolder]', 'Categorized files for merge', {
        sourceFolder: sourceFolder.name,
        totalFiles: sourceFiles.length,
        conflicts: conflicts.length,
        nonConflicts: nonConflicts.length,
      })

      // Initialize progress tracking
      const totalOperations = nonConflicts.length + conflicts.length
      const progress = new ProgressTracker(
        ctx,
        'merge-folder',
        toastId,
        `Merging ${sourceFolder.name}...`,
        totalOperations,
      )

      let succeeded = 0
      let failed = 0
      const errors: string[] = []

      // Register expected file changes
      const expectedPaths = [
        sourceFolder.relativePath,
        ...sourceFiles.map((f) => f.relativePath),
        ...nonConflicts.map((nc) =>
          nc.destPath.substring(vaultPath.length + 1).replace(/\\/g, '/'),
        ),
      ]
      ctx.addExpectedFileChanges(expectedPaths)
      pathsToClear = [...expectedPaths]

      // Move non-conflicting files
      for (const { source, destPath } of nonConflicts) {
        try {
          // Create parent directories if needed
          const parentDir = destPath.substring(0, destPath.lastIndexOf(sep))
          if (parentDir !== destFolderPath) {
            await window.electronAPI?.createFolder(parentDir)
          }

          // Move the file
          const moveResult = await window.electronAPI?.renameItem(source.path, destPath)
          if (moveResult?.success) {
            // Update store
            const destRelPath = destPath.substring(vaultPath.length + 1).replace(/\\/g, '/')
            ctx.renameFileInStore(source.path, destPath, destRelPath, true)

            // Update server if synced, and patch pdmData.file_path in the store
            if (source.pdmData?.id) {
              const updateResult = await updateFilePath(source.pdmData.id, destRelPath)
              if (updateResult.success && updateResult.file) {
                ctx.updateFilesInStore([
                  {
                    path: destPath,
                    updates: { pdmData: { ...source.pdmData, file_path: destRelPath } },
                  },
                ])
              }
            }

            succeeded++
          } else {
            failed++
            errors.push(`${source.name}: ${moveResult?.error || 'Failed to move'}`)
          }
        } catch (error) {
          failed++
          errors.push(`${source.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
        progress.update()
      }

      // Handle conflicting files based on resolution
      for (const { source, destPath } of conflicts) {
        try {
          let finalDestPath = destPath
          let finalDestRelPath = destPath.substring(vaultPath.length + 1).replace(/\\/g, '/')

          if (conflictResolution === 'skip') {
            // Skip this file - just remove from source (delete source copy)
            log.debug('[MergeFolder]', 'Skipping conflicting file', { name: source.name })
            // Don't delete the source - user chose to skip, so leave it
            progress.update()
            continue
          } else if (conflictResolution === 'rename') {
            // Generate unique name for the file
            const ext = source.extension || ''
            const baseName = source.name.substring(0, source.name.length - ext.length)
            let counter = 2
            let newName = `${baseName} (${counter})${ext}`
            let newDestPath = destPath.replace(source.name, newName)

            // Check if the renamed file exists
            while ((await window.electronAPI?.fileExists(newDestPath)) && counter < 1000) {
              counter++
              newName = `${baseName} (${counter})${ext}`
              newDestPath = destPath.replace(source.name, newName)
            }

            finalDestPath = newDestPath
            finalDestRelPath = newDestPath.substring(vaultPath.length + 1).replace(/\\/g, '/')
          }
          // For 'overwrite' or 'prompt' with overwrite resolution, use original destPath

          // Move/overwrite the file
          const moveResult = await window.electronAPI?.renameItem(source.path, finalDestPath)
          if (moveResult?.success) {
            ctx.renameFileInStore(source.path, finalDestPath, finalDestRelPath, true)

            // Update server if synced, and patch pdmData.file_path in the store
            if (source.pdmData?.id) {
              const updateResult = await updateFilePath(source.pdmData.id, finalDestRelPath)
              if (updateResult.success && updateResult.file) {
                ctx.updateFilesInStore([
                  {
                    path: finalDestPath,
                    updates: { pdmData: { ...source.pdmData, file_path: finalDestRelPath } },
                  },
                ])
              }
            }

            succeeded++
          } else {
            failed++
            errors.push(`${source.name}: ${moveResult?.error || 'Failed to move'}`)
          }
        } catch (error) {
          failed++
          errors.push(`${source.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
        progress.update()
      }

      // Delete the now-empty source folder
      try {
        await window.electronAPI?.deleteItem(sourceFolder.path)
        ctx.removeFilesFromStore([sourceFolder.path])

        if (sourceFolder.pdmData?.id && ctx.user?.id) {
          const deleteResult = await deleteFolderOnServer(sourceFolder.pdmData.id, ctx.user.id)
          if (!deleteResult.success) {
            log.warn('[MergeFolder]', 'Failed to delete source folder on server', {
              folderId: sourceFolder.pdmData.id,
              error: deleteResult.error,
            })
          }
        }

        log.info('[MergeFolder]', 'Deleted empty source folder', {
          path: sourceFolder.relativePath,
        })
      } catch (error) {
        log.warn('[MergeFolder]', 'Failed to delete source folder (may not be empty)', {
          path: sourceFolder.relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      const { duration } = progress.finish()
      ctx.setLastOperationCompletedAt(Date.now())

      if (failed > 0) {
        ctx.addToast('warning', `Merged ${succeeded} files, ${failed} failed`)
      } else {
        ctx.addToast(
          'success',
          `Merged ${succeeded} file${succeeded !== 1 ? 's' : ''} into ${sourceFolder.name}`,
        )
      }

      return {
        success: failed === 0,
        message:
          failed > 0
            ? `Merged ${succeeded} files, ${failed} failed`
            : `Merged ${succeeded} file${succeeded !== 1 ? 's' : ''}`,
        total: totalOperations,
        succeeded,
        failed,
        errors: errors.length > 0 ? errors : undefined,
        duration,
      }
    } catch (error) {
      log.error('[MergeFolder]', 'Merge operation failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        total: 1,
        succeeded: 0,
        failed: 1,
      }
    } finally {
      // Clear watcher suppression after the same 5s window used elsewhere so
      // expectedFileChanges does not grow unboundedly.
      if (pathsToClear) {
        const paths = pathsToClear
        setTimeout(() => ctx.clearExpectedFileChanges(paths), 5000)
      }
    }
  },
}
