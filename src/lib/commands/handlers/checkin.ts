// TODO(decompose): Extract to checkinUpload.ts — uploadFileContentToStorage with retry/verification logic (lines ~78–189)
// TODO(decompose): Extract to checkinReferences.ts — extractAndStoreReferences and drawing revision propagation (lines ~257–370)
// TODO(decompose): Extract to checkinProcessFile.ts — processFile inner function (single-file checkin logic including fast-path, upload path, metadata path) (lines ~866–1557)
// TODO(decompose): Extract to checkinHelpers.ts — syncPendingVersionNotes, logCheckin, translateCheckinError, getFileContext, detectPostCheckinDrift (lines ~191–393, 839–860)

/**
 * Checkin Command
 *
 * Check in files after editing. This:
 * 1. Uploads new content to storage if modified (hash changed)
 * 2. Updates server with new content hash and pending metadata
 * 3. Releases the checkout lock
 * 4. Makes the local file read-only
 *
 * NOTE: This command does NOT write metadata to SolidWorks files.
 * Metadata should be saved to SW files during editing via "Save to File" button.
 * Check-in only sends pendingMetadata to the server database.
 */

import type { Command, CheckinParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import {
  checkinFile,
  upsertFileReferences,
  getSupabaseClient,
  updateVersionNote,
  propagateDrawingRevisionToConfigurations,
} from '../../supabase'
import type { SWReference } from '../../supabase/files/mutations'
import {
  processWithConcurrency,
  CONCURRENT_OPERATIONS,
  SW_CONCURRENT_OPERATIONS,
} from '../../concurrency'
import type { LocalFile } from '../../../stores/pdmStore'
import { usePDMStore } from '../../../stores/pdmStore'
import { resolveRevision, resolvedText } from '@/lib/metadata/overlay'
import { settleMetadataForCheckin } from '@/lib/metadata/checkinMetadata'
import { log } from '@/lib/logger'
import { isRetryableError, getBackoffDelay, sleep } from '../../network'
import { FileOperationTracker } from '../../fileOperationTracker'

// SolidWorks file extensions that support metadata extraction
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

/** Normalize a file path for cross-source comparison (SolidWorks vs file system) */
const normalizePath = (p: string) => p.toLowerCase().replace(/\\/g, '/')

// File types that have references to extract (assemblies reference components, drawings reference models)
const REFERENCE_FILE_EXTENSIONS = ['.sldasm', '.slddrw']

// Drawing extensions (need special handling for reference type)
const DRAWING_EXTENSIONS = ['.slddrw']

/**
 * Incremental Store Update Configuration
 *
 * During batch operations (checking in many files), updating the store after
 * every single file causes excessive React re-renders and impacts performance.
 * Updating only at the end means the UI shows no progress until completion.
 *
 * We use BOTH count-based and time-based flushing:
 * - FLUSH_INTERVAL: Flush every N files (prevents huge batches)
 * - FLUSH_TIME_MS: Flush at least every N ms (ensures UI updates even if files are slow)
 *
 * This keeps the UI responsive regardless of file processing speed.
 */
const FLUSH_INTERVAL = 25 // Flush every 25 files
const FLUSH_TIME_MS = 500 // Flush at least every 500ms

/**
 * Pre-cached SolidWorks service status to avoid redundant IPC calls per file
 */
interface SwServiceStatus {
  running: boolean
  documentManagerAvailable: boolean
}

/**
 * Upload file content to storage with the given hash
 * Used during check-in when file content has changed
 * Handles deduplication - skips upload if content already exists
 */
const UPLOAD_MAX_RETRIES = 3
const UPLOAD_RETRY_BASE_DELAY_MS = 1000

async function uploadFileContentToStorage(
  orgId: string,
  hash: string,
  base64Content: string,
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  const dirPath = `${orgId}/${hash.substring(0, 2)}`
  const storagePath = `${dirPath}/${hash}`

  try {
    // Check if already exists (deduplication)
    const { data: existing, error: listError } = await client.storage
      .from('vault')
      .list(dirPath, { search: hash, limit: 1 })

    if (listError) {
      log.warn('[Checkin]', 'Storage list check failed, will attempt upload', {
        error: listError.message,
      })
    }

    if (existing && existing.length > 0) {
      log.debug('[Checkin]', 'Content already exists in storage (deduplication)', {
        hash: hash.substring(0, 12),
      })
      return { success: true }
    }

    // Convert base64 to blob
    const binaryString = atob(base64Content)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const blob = new Blob([bytes])
    const expectedSize = bytes.length

    // Upload with retry
    let lastError: string | undefined
    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
      const { error: uploadError } = await client.storage.from('vault').upload(storagePath, blob, {
        contentType: 'application/octet-stream',
        upsert: false,
      })

      if (uploadError) {
        if (uploadError.message.includes('already exists')) {
          break // Content-addressable dedup -- this is fine
        }
        lastError = uploadError.message
        if (isRetryableError(lastError) && attempt < UPLOAD_MAX_RETRIES) {
          const delayMs = getBackoffDelay(attempt, UPLOAD_RETRY_BASE_DELAY_MS)
          log.warn(
            '[Checkin]',
            `Upload failed (attempt ${attempt}/${UPLOAD_MAX_RETRIES}), retrying...`,
            {
              hash: hash.substring(0, 12),
              error: lastError,
              retryDelayMs: Math.round(delayMs),
            },
          )
          await sleep(delayMs)
          continue
        }
        return { success: false, error: lastError }
      }

      // Upload reported success -- break out of retry loop
      lastError = undefined
      break
    }

    // Post-upload verification: confirm the object exists with the expected size
    const { data: verified, error: verifyError } = await client.storage
      .from('vault')
      .list(dirPath, { search: hash, limit: 1 })

    if (verifyError) {
      log.warn('[Checkin]', 'Post-upload verification list failed', {
        hash: hash.substring(0, 12),
        error: verifyError.message,
      })
      // Non-fatal: upload likely succeeded, verification just couldn't confirm
    } else if (!verified || verified.length === 0) {
      return {
        success: false,
        error: 'Upload verification failed: object not found in storage after upload',
      }
    } else {
      const storedSize = (verified[0] as { metadata?: { size?: number } }).metadata?.size
      if (storedSize !== undefined && storedSize !== expectedSize) {
        log.error('[Checkin]', 'Post-upload size mismatch — stored object is corrupted', {
          hash: hash.substring(0, 12),
          expectedSize,
          storedSize,
        })
        return {
          success: false,
          error: `Upload corrupted: expected ${expectedSize} bytes, stored ${storedSize} bytes`,
        }
      }
    }

    return { success: true }
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: errMessage }
  }
}

/**
 * Sync pending version notes to the server
 * Updates the comment field on historical file_versions records
 *
 * @param file - The file being checked in
 * @param userId - Current user ID
 * @returns Promise that resolves when all notes are synced (errors are logged but not fatal)
 */
async function syncPendingVersionNotes(file: LocalFile, userId: string): Promise<void> {
  const pendingNotes = file.pendingVersionNotes
  if (!pendingNotes || Object.keys(pendingNotes).length === 0) {
    return // No pending notes to sync
  }

  const fileId = file.pdmData?.id
  if (!fileId) {
    log.warn('[Checkin]', 'Cannot sync version notes - no file ID', { fileName: file.name })
    return
  }

  // Sync each pending note to the server
  for (const [versionId, note] of Object.entries(pendingNotes)) {
    try {
      const result = await updateVersionNote(fileId, versionId, userId, note)
      if (!result.success) {
        log.warn('[Checkin]', 'Failed to sync version note', {
          fileName: file.name,
          versionId,
          error: result.error,
        })
      } else {
        log.debug('[Checkin]', 'Synced version note', { fileName: file.name, versionId })
      }
    } catch (error) {
      log.warn('[Checkin]', 'Exception syncing version note', {
        fileName: file.name,
        versionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// Detailed logging for checkin operations
function logCheckin(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[Checkin]', message, context)
}

/**
 * Extract and store references after a successful check-in.
 * This populates the file_references table for Contains/Where-Used queries.
 *
 * Handles both:
 * - Assemblies: Component references (parts and sub-assemblies)
 * - Drawings: Model references (the parts/assemblies the drawing documents)
 *
 * @param file - The checked-in assembly or drawing file
 * @param orgId - Organization ID
 * @param vaultId - Vault ID
 * @param vaultRootPath - Optional local vault root path for better path matching
 * @returns Promise that resolves when extraction is complete (non-blocking to check-in)
 */
async function extractAndStoreReferences(
  file: LocalFile,
  orgId: string,
  vaultId: string,
  vaultRootPath?: string,
): Promise<void> {
  // Process assemblies and drawings (both have references to extract)
  if (!REFERENCE_FILE_EXTENSIONS.includes(file.extension.toLowerCase())) {
    return
  }

  const fileId = file.pdmData?.id
  if (!fileId) {
    logCheckin('debug', 'Skipping reference extraction - no file ID', { fileName: file.name })
    return
  }

  // Check if SolidWorks service is running
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  if (!status?.data?.running) {
    logCheckin('debug', 'Skipping reference extraction - SW service not running', {
      fileName: file.name,
    })
    return
  }

  const isDrawing = DRAWING_EXTENSIONS.includes(file.extension.toLowerCase())

  try {
    logCheckin('debug', 'Extracting file references', {
      fileName: file.name,
      fullPath: file.path,
      isDrawing,
    })

    // Call SolidWorks service to get references
    const result = await window.electronAPI?.solidworks?.getReferences?.(file.path)

    if (!result?.success || !result.data?.references) {
      logCheckin('debug', 'No references returned from SW service', {
        fileName: file.name,
        isDrawing,
        error: result?.error,
      })
      return
    }

    const swRefs = result.data.references as Array<{
      path: string
      fileName: string
      exists: boolean
      fileType: string
    }>

    logCheckin('debug', 'Got references from SW service', {
      fileName: file.name,
      isDrawing,
      count: swRefs.length,
      firstRef: swRefs[0]?.fileName,
    })

    // Convert SW service format to our SWReference format
    // The SW service returns one entry per unique component path
    // Reference types differ based on file type:
    // - Assemblies: components (parts and sub-assemblies)
    // - Drawings: model references (the parts/assemblies the drawing documents)
    const references: SWReference[] = swRefs.map((ref) => ({
      childFilePath: ref.path,
      quantity: 1, // SW service doesn't provide quantity in getReferences, default to 1
      referenceType: isDrawing
        ? 'reference' // Drawings reference models they document
        : ref.fileType === 'assembly'
          ? 'component'
          : ref.fileType === 'part'
            ? 'component'
            : 'reference',
      configuration: undefined, // Will be populated if we have BOM data
    }))

    // Store references in database (pass vault root for better path matching)
    const upsertResult = await upsertFileReferences(
      orgId,
      vaultId,
      fileId,
      references,
      vaultRootPath,
    )

    if (upsertResult.success) {
      logCheckin('info', 'Stored file references', {
        fileName: file.name,
        isDrawing,
        inserted: upsertResult.inserted,
        updated: upsertResult.updated,
        deleted: upsertResult.deleted,
        skipped: upsertResult.skipped,
        skippedReasons: upsertResult.skippedReasons,
      })
    } else {
      logCheckin('warn', 'Failed to store file references', {
        fileName: file.name,
        isDrawing,
        error: upsertResult.error,
      })
    }
  } catch (error) {
    // Non-fatal - reference extraction failure shouldn't block check-in
    logCheckin('warn', 'Reference extraction failed', {
      fileName: file.name,
      isDrawing,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function translateCheckinError(error: string | null | undefined, fileName: string): string {
  if (!error) return `${fileName}: Check in failed`
  if (error.includes('idx_files_vault_path_unique_active') || error.includes('duplicate key')) {
    return `${fileName}: A file already exists at this path on the server. The local rename conflicts with an existing file. Delete or rename the conflicting file first.`
  }
  return `${fileName}: ${error}`
}

function getFileContext(file: LocalFile): Record<string, unknown> {
  return {
    fileName: file.name,
    relativePath: file.relativePath,
    fullPath: file.path,
    fileId: file.pdmData?.id,
    fileSize: file.size,
    localHash: file.localHash?.substring(0, 12),
    serverHash: file.pdmData?.content_hash?.substring(0, 12),
    version: file.pdmData?.version,
    workflowState: file.pdmData?.workflow_state?.name,
    hasPendingMetadata: !!file.pendingMetadata,
  }
}

export const checkinCommand: Command<CheckinParams> = {
  id: 'checkin',
  name: 'Check In',
  description: 'Check in files after editing',
  aliases: ['ci'],
  usage: 'checkin <path> [--message "commit message"]',

  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot check in files while offline'
    }

    if (!ctx.user) {
      return 'Please sign in first'
    }

    if (!ctx.organization) {
      return 'No organization connected'
    }

    if (!files || files.length === 0) {
      return 'No files selected'
    }

    // Get synced files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const checkinable = syncedFiles.filter((f) => f.pdmData?.checked_out_by === ctx.user?.id)

    if (checkinable.length === 0) {
      // Check if files exist but aren't checked out by user
      if (syncedFiles.length > 0) {
        const checkedOutByOthers = syncedFiles.filter(
          (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== ctx.user?.id,
        )
        if (checkedOutByOthers.length > 0) {
          return 'Files are checked out by other users'
        }
        return 'Files are not checked out by you'
      }
      return 'No files checked out by you'
    }

    return null
  },

  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    const operationId = `checkin-${Date.now()}`

    // Get files checked out by current user (for tracker initialization)
    const syncedFilesForTracker = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckinForTracker = syncedFilesForTracker.filter(
      (f) => f.pdmData?.checked_out_by === user.id,
    )

    // Initialize file operation tracker for DevTools monitoring
    const tracker = FileOperationTracker.start(
      'checkin',
      filesToCheckinForTracker.length,
      filesToCheckinForTracker.map((f) => f.relativePath),
    )

    logCheckin('info', 'Starting checkin operation', {
      operationId,
      userId: user.id,
      selectedFileCount: files.length,
    })

    // Get files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckin = syncedFiles.filter((f) => f.pdmData?.checked_out_by === user.id)

    logCheckin('debug', 'Filtered files for checkin', {
      operationId,
      syncedCount: syncedFiles.length,
      checkinableCount: filesToCheckin.length,
      checkedOutByOthers: syncedFiles.filter(
        (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user.id,
      ).length,
    })

    if (filesToCheckin.length === 0) {
      logCheckin('info', 'No files to check in', { operationId })
      tracker.endOperation('completed')
      return {
        success: true,
        message: 'No files to check in',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // ========================================
    // PERFORMANCE OPTIMIZATION: Pre-fetch all values ONCE before the loop
    // This eliminates N redundant IPC/DB calls for N files
    // ========================================

    // Pre-fetch machine ID ONCE (avoids 80 getMachineId IPC calls for 80 files)
    const prefetchStepId = tracker.startStep('Pre-fetch machine info')
    const { getMachineId } = await import('../../backup')
    const machineId = await getMachineId()
    tracker.endStep(prefetchStepId, 'completed', { machineId: machineId?.substring(0, 8) })

    const orgId = ctx.organization?.id

    logCheckin('debug', 'Pre-fetched batch operation values', {
      operationId,
      machineId: machineId?.substring(0, 8) + '...',
    })

    // Pre-check SolidWorks service status ONCE (avoid checking for every file in batch)
    const swStatusStepId = tracker.startStep('Check SW service status')
    let swServiceStatus: SwServiceStatus = { running: false, documentManagerAvailable: false }
    try {
      const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
      swServiceStatus = {
        running: !!status?.data?.running,
        documentManagerAvailable: !!status?.data?.documentManagerAvailable,
      }
    } catch {
      // SW service not available
    }
    tracker.endStep(swStatusStepId, 'completed', {
      swRunning: swServiceStatus.running,
      documentManagerAvailable: swServiceStatus.documentManagerAvailable,
    })

    // ========================================
    // PRE-CHECK: Detect unsaved/locked SolidWorks files BEFORE processing
    //
    // If any files are open in SolidWorks with unsaved changes, prompt the user.
    // If any files are actively locked (mid-write), hard-error and abort.
    // This prevents uploading stale or corrupt file content.
    // ========================================
    const swFilesToCheckin = filesToCheckin.filter((f) =>
      SW_EXTENSIONS.includes(f.extension.toLowerCase()),
    )

    if (swFilesToCheckin.length > 0 && swServiceStatus.running) {
      const preCheckStepId = tracker.startStep('Pre-check SW file state')

      try {
        const openDocsResult = await window.electronAPI?.solidworks?.getOpenDocuments?.({
          includeComponents: true,
        })

        if (
          openDocsResult?.success &&
          openDocsResult.data?.solidWorksRunning &&
          openDocsResult.data?.documents
        ) {
          // Build a map of open documents by normalized path
          const openDocMap = new Map<
            string,
            { isDirty: boolean; isReadOnly: boolean; filePath: string }
          >()
          for (const doc of openDocsResult.data.documents) {
            if (doc.filePath) {
              openDocMap.set(normalizePath(doc.filePath), {
                isDirty: !!doc.isDirty,
                isReadOnly: !!doc.isReadOnly,
                filePath: doc.filePath,
              })
            }
          }

          // Cross-reference with files being checked in
          const dirtyFiles: Array<{ file: LocalFile; docPath: string }> = []

          for (const file of swFilesToCheckin) {
            const normalizedPath = normalizePath(file.path)
            const openDoc = openDocMap.get(normalizedPath)
            if (openDoc?.isDirty) {
              dirtyFiles.push({ file, docPath: openDoc.filePath })
            }
          }

          logCheckin('debug', 'Pre-check: SW file state', {
            operationId,
            openDocCount: openDocMap.size,
            dirtyCount: dirtyFiles.length,
            dirtyFiles: dirtyFiles.map((d) => d.file.name),
          })

          // If there are unsaved files, abort and tell the user to save first
          if (dirtyFiles.length > 0) {
            const names = dirtyFiles.map((d) => d.file.name).join(', ')
            logCheckin('info', 'Aborting check-in: unsaved SW files', {
              operationId,
              dirtyFiles: names,
            })
            ctx.addToast(
              'error',
              `Unsaved changes detected \u2014 save ${dirtyFiles.length === 1 ? dirtyFiles[0].file.name : 'your files'} in SolidWorks first`,
            )
            tracker.endStep(preCheckStepId, 'completed', { unsaved: names })
            tracker.endOperation('completed')
            return {
              success: false,
              message: `Unsaved SolidWorks files: ${names}`,
              total: 0,
              succeeded: 0,
              failed: 0,
            }
          }

          // After saving, check if any files are still actively locked (mid-write)
          // This catches the case where SolidWorks auto-save is in progress
          for (const file of swFilesToCheckin) {
            try {
              const lockCheck = await window.electronAPI?.checkFileLock?.(file.path, {
                forRead: true,
              })
              if (lockCheck?.locked) {
                const processName = lockCheck.processName || 'another process'
                logCheckin('error', 'File is actively locked, aborting check-in', {
                  operationId,
                  fileName: file.name,
                  lockedBy: processName,
                })
                ctx.addToast(
                  'error',
                  `Cannot check in \u2014 ${file.name} is locked by ${processName}. Please wait and try again.`,
                )
                tracker.endStep(preCheckStepId, 'completed', {
                  locked: file.name,
                  lockedBy: processName,
                })
                tracker.endOperation('completed')
                return {
                  success: false,
                  message: `${file.name} is locked by ${processName}`,
                  total: 0,
                  succeeded: 0,
                  failed: 1,
                  errors: [`${file.name}: File is locked by ${processName}`],
                }
              }
            } catch {
              // Lock check not available - continue without it
            }
          }
        }
      } catch (error) {
        // SW pre-check failed - continue without it (non-blocking)
        logCheckin('warn', 'SW pre-check failed, continuing', {
          operationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      tracker.endStep(preCheckStepId, 'completed')
    }

    // Track folders and files being processed (for spinner display)
    // Use synchronous update to ensure spinners render before async work begins
    const foldersBeingProcessed = files.filter((f) => f.isDirectory).map((f) => f.relativePath)
    const filesBeingProcessed = filesToCheckin.map((f) => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...foldersBeingProcessed, ...filesBeingProcessed])]
    ctx.addProcessingFoldersSync(allPathsBeingProcessed, 'checkin')

    // Progress tracking
    const toastId = `checkin-${Date.now()}`
    const total = filesToCheckin.length
    const progress = new ProgressTracker(
      ctx,
      'checkin',
      toastId,
      `Checking in ${total} file${total > 1 ? 's' : ''}...`,
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

    // Collect files for batch readonly operation (optimization: 1 IPC call instead of N)
    const filesToMakeReadonly: string[] = []

    // Track flush position and timing for incremental store updates
    let lastFlushIndex = 0
    let lastFlushTime = Date.now()

    /**
     * Flush pending store updates to provide real-time UI feedback.
     * Called periodically during batch operations based on count OR time.
     *
     * NOTE: For large batches (50+ files), incremental flushing is SKIPPED
     * because each flush triggers React re-renders with expensive folderMetrics
     * computation, blocking all concurrent workers.
     */
    const flushPendingUpdates = () => {
      const updateCount = pendingUpdates.length
      if (updateCount > lastFlushIndex) {
        const flushStart = performance.now()
        const updatesToFlush = pendingUpdates.slice(lastFlushIndex)
        ctx.updateFilesInStore(updatesToFlush)
        const flushDuration = performance.now() - flushStart
        recordSubstepTiming('flush', flushDuration)
        lastFlushIndex = updateCount
        lastFlushTime = Date.now()
        logCheckin('debug', 'Incremental store flush', {
          operationId,
          flushedCount: updatesToFlush.length,
          totalProcessed: updateCount,
          flushDurationMs: Math.round(flushDuration),
        })
      }
    }

    /**
     * Check if we should flush based on count OR time threshold.
     * This keeps UI responsive even when individual files take a long time.
     *
     * PERFORMANCE OPTIMIZATION: For large batches (50+ files), skip incremental
     * flushes entirely. Each flush triggers expensive O(N×depth) folderMetrics
     * recomputation in useVaultTree, blocking all concurrent workers.
     * The atomic final update at the end handles all files efficiently.
     */
    const shouldFlush = (): boolean => {
      // Skip incremental flushes for large batches - they cause React blocking
      if (total >= 50) return false

      const countThreshold = pendingUpdates.length - lastFlushIndex >= FLUSH_INTERVAL
      const timeThreshold = Date.now() - lastFlushTime >= FLUSH_TIME_MS
      return countThreshold || (pendingUpdates.length > lastFlushIndex && timeThreshold)
    }

    // ========================================
    // PATH CHANGE CONFIRMATION: Warn user before committing rename/move to server
    // SolidWorks tree renames can be transient (revert if assembly isn't saved),
    // so auto-updating the server path without confirmation is dangerous.
    // ========================================
    const filesWithPathChanges = filesToCheckin.filter((f) => {
      return (
        f.pdmData?.file_path && f.relativePath.toLowerCase() !== f.pdmData.file_path.toLowerCase()
      )
    })

    if (filesWithPathChanges.length > 0 && ctx.confirm) {
      const items = filesWithPathChanges.map((f) => `${f.pdmData?.file_name || '?'} → ${f.name}`)
      const confirmed = await ctx.confirm({
        title: 'File Path Changed',
        message:
          filesWithPathChanges.length === 1
            ? 'This file was renamed or moved locally. Update the server path?'
            : `${filesWithPathChanges.length} files were renamed or moved locally. Update the server paths?`,
        items,
        confirmText: 'Update Paths & Check In',
      })

      if (!confirmed) {
        logCheckin('info', 'User declined path change — skipping path updates', {
          operationId,
          files: filesWithPathChanges.map((f) => f.name),
        })
        for (const f of filesWithPathChanges) {
          ;(f as any)._skipPathUpdate = true // TODO: type this
        }
      }
    }

    // ========================================
    // TWO-PHASE PROCESSING: Prevent SolidWorks service flooding
    //
    // The SolidWorks service uses a serial stdin/stdout pipe, so high concurrency
    // (e.g., 20 files) overwhelms it and causes timeouts/crashes.
    //
    // Strategy:
    // 1. Process non-SW files first at high concurrency (20) - no service bottleneck
    // 2. Process SW files second at low concurrency (3) - respects serial pipe limit
    // ========================================

    // Split files into SW and non-SW for two-phase processing
    const swFiles = filesToCheckin.filter((f) => SW_EXTENSIONS.includes(f.extension.toLowerCase()))
    const nonSwFiles = filesToCheckin.filter(
      (f) => !SW_EXTENSIONS.includes(f.extension.toLowerCase()),
    )

    logCheckin('info', 'Two-phase processing strategy', {
      operationId,
      totalFiles: filesToCheckin.length,
      swFiles: swFiles.length,
      nonSwFiles: nonSwFiles.length,
      swConcurrency: SW_CONCURRENT_OPERATIONS,
      nonSwConcurrency: CONCURRENT_OPERATIONS,
    })

    // ========================================
    // SUBSTEP TIMING: Aggregate timing per phase
    // Tracked separately for non-SW (Phase 1) and SW (Phase 2) files
    // This helps identify which subprocess is the bottleneck
    // ========================================
    type SubstepTimings = Record<string, { totalMs: number; callCount: number }>
    const phase1Timings: SubstepTimings = {}
    const phase2Timings: SubstepTimings = {}
    let currentPhaseTimings: SubstepTimings = phase1Timings

    const recordSubstepTiming = (name: string, durationMs: number) => {
      if (!currentPhaseTimings[name]) {
        currentPhaseTimings[name] = { totalMs: 0, callCount: 0 }
      }
      currentPhaseTimings[name].totalMs += durationMs
      currentPhaseTimings[name].callCount++
    }

    /**
     * Add substeps to a phase step after processing is complete
     */
    const addSubstepsToPhase = (phaseStepId: string, timings: SubstepTimings) => {
      const substepOrder = ['hashFile', 'readFile', 'upload', 'checkinAPI', 'setDocRO', 'flush']
      for (const name of substepOrder) {
        const timing = timings[name]
        if (timing && timing.callCount > 0) {
          tracker.addSubstep(phaseStepId, `${name} (${timing.callCount} calls)`, timing.totalMs, {
            avgMs: Math.round(timing.totalMs / timing.callCount),
            callCount: timing.callCount,
          })
        }
      }
    }

    // Declare openDocumentPaths here so processFile can access it
    // Will be populated before Phase 2 processing
    let openDocumentPaths: Set<string> = new Set()

    // Track files that drifted after check-in (for post-operation summary)
    const driftedFiles: string[] = []

    /**
     * Detect post-check-in drift: re-hash the file after readonly is set
     * and compare to the hash that was uploaded. SolidWorks can modify open
     * files (e.g., reference rebuild) between upload and readonly, leaving
     * local content that the server does not have.
     *
     * Returns the current on-disk hash if drift occurred, or null if unchanged.
     */
    const detectPostCheckinDrift = async (
      file: LocalFile,
      uploadedHash: string,
      isSWFile: boolean,
      isOpenInSW: boolean,
    ): Promise<string | null> => {
      if (!isSWFile || !isOpenInSW) return null

      const postHash = await window.electronAPI?.hashFile(file.path)
      const currentHash = postHash?.success ? postHash.hash : undefined
      if (!currentHash || currentHash === uploadedHash) return null

      logCheckin('warn', 'POST-CHECKIN DRIFT: file modified after upload', {
        operationId,
        fileName: file.name,
        uploadedHash: uploadedHash.substring(0, 12),
        currentHash: currentHash.substring(0, 12),
      })
      driftedFiles.push(file.name)

      return currentHash
    }

    /**
     * Process a single file for check-in
     * Extracted to avoid code duplication between phases
     */
    const processFile = async (
      file: LocalFile,
    ): Promise<{ success: boolean; error?: string; file?: LocalFile }> => {
      const fileCtx = getFileContext(file)
      const isSolidWorksFile = SW_EXTENSIONS.includes(file.extension.toLowerCase())
      const swOpStartTime = isSolidWorksFile ? Date.now() : null

      try {
        let wasFileMoved =
          file.pdmData?.file_path &&
          file.relativePath.toLowerCase() !== file.pdmData.file_path.toLowerCase()
        let wasFileRenamed =
          file.pdmData?.file_name &&
          file.name.toLowerCase() !== file.pdmData.file_name.toLowerCase()

        // Skip path update if user declined the confirmation dialog
        if ((file as any)._skipPathUpdate) { // TODO: type this
          wasFileMoved = false
          wasFileRenamed = false
        }

        // Pre-flight: verify file still exists at the detected new path before
        // committing the path change — SolidWorks tree renames can revert
        if (wasFileMoved) {
          try {
            const fileStillExists = await window.electronAPI?.fileExists?.(file.path)
            if (!fileStillExists) {
              logCheckin('warn', 'File no longer exists at new path, skipping path update', {
                operationId,
                ...fileCtx,
                newPath: file.relativePath,
                oldPath: file.pdmData?.file_path,
              })
              wasFileMoved = false
              wasFileRenamed = false
            }
          } catch {
            // fileExists not available — proceed without the check
          }
        }

        // Block rename/move if destination path already occupied by another server file
        if (wasFileMoved || wasFileRenamed) {
          const destPathLower = file.relativePath.toLowerCase()
          const conflictingFile = ctx.files.find(
            (f) =>
              f.relativePath.toLowerCase() === destPathLower &&
              f.pdmData?.id &&
              f.pdmData.id !== file.pdmData?.id,
          )
          if (conflictingFile) {
            logCheckin('error', 'Rename/move blocked: destination path occupied by another file', {
              operationId,
              ...fileCtx,
              destPath: file.relativePath,
              conflictingFileId: conflictingFile.pdmData?.id,
              conflictingFileName: conflictingFile.pdmData?.file_name,
            })
            progress.update()
            return {
              success: false,
              error: `${file.name}: Cannot rename — another file already exists at "${file.relativePath}". Delete or rename the existing file first, or undo this rename.`,
            }
          }
        }

        // ========================================
        // FAST PATH OPTIMIZATION: Skip file upload for truly unchanged files
        //
        // We ALWAYS compute a fresh hash to ensure we detect actual file changes.
        // The cached localHash can be stale if the file was modified in SolidWorks
        // and the file watcher didn't recompute it (for performance reasons).
        //
        // If ALL of these are true:
        // 1. Fresh hash matches server hash (no content change)
        // 2. No pending metadata to send to server
        // 3. File wasn't moved or renamed
        //
        // Then we can skip the file upload (but we still needed to compute the hash).
        // ========================================
        const hasPendingMetadata = !!file.pendingMetadata

        // Get the pending values into the file before the database takes them.
        //
        // Check-in used to promote whatever it found pending on the assumption that the datacard had
        // already written it. When that write had failed, the database silently accepted a value the
        // file did not have. This writes what is still owed, reads it back, and returns the record of
        // anything it could not confirm - which travels with the file update below rather than being
        // thrown away with the pending value. Decision D4: check-in may be slower for files that were
        // actually edited.
        //
        // Before the hash, deliberately: this write changes the document, so hashing first would
        // record a hash the file no longer has and the fast path would compare against it.
        const metadataSettleStart = performance.now()
        const swStatus = usePDMStore.getState().integrations.solidworks.status
        const metadataSettlement = await settleMetadataForCheckin(file, {
          organizationId: orgId,
          serviceAvailable: swStatus === 'online' || swStatus === 'partial',
        })
        recordSubstepTiming('settleMetadata', performance.now() - metadataSettleStart)

        // CRITICAL: Always compute fresh hash - cached localHash may be stale
        // This fixes a bug where files modified in SolidWorks were not detected
        // because the file watcher preserves old hashes for performance.
        const hashStartTime = performance.now()
        const freshHashResult = await window.electronAPI?.hashFile(file.path)
        recordSubstepTiming('hashFile', performance.now() - hashStartTime)

        const freshHash = freshHashResult?.success ? freshHashResult.hash : undefined
        const freshSize = freshHashResult?.success ? freshHashResult.size : file.size

        if (!freshHash) {
          logCheckin('error', 'Failed to compute hash for file', {
            operationId,
            ...fileCtx,
            hashError: freshHashResult?.error,
          })
          progress.update()
          return {
            success: false,
            error: `${file.name}: Failed to hash file - ${freshHashResult?.error || 'Unknown error'}`,
          }
        }

        const contentUnchanged = freshHash === file.pdmData?.content_hash
        const canTakeFastPath =
          contentUnchanged && !hasPendingMetadata && !wasFileMoved && !wasFileRenamed

        logCheckin('debug', 'Checking in file', {
          operationId,
          ...fileCtx,
          wasFileMoved,
          wasFileRenamed,
          oldPath: wasFileMoved ? file.pdmData?.file_path : undefined,
          oldName: wasFileRenamed ? file.pdmData?.file_name : undefined,
          canTakeFastPath,
          hasPendingMetadata,
        })

        // ========================================
        // FAST PATH: File unchanged, just release checkout
        // ========================================
        if (canTakeFastPath) {
          logCheckin('info', 'Taking fast path - file unchanged', {
            operationId,
            fileName: file.name,
            freshHash: freshHash?.substring(0, 12),
          })

          // Set readonly BEFORE releasing the checkout lock to prevent SolidWorks
          // from modifying the file between lock release and readonly.
          const isFastPathSWFile = SW_EXTENSIONS.includes(file.extension.toLowerCase())
          const isFastPathFileOpenInSW = openDocumentPaths.has(normalizePath(file.path))
          let fastPathMadeReadonly = false
          if (swServiceStatus.running && isFastPathSWFile && isFastPathFileOpenInSW) {
            try {
              await window.electronAPI?.setReadonly(file.path, true)

              const setDocROStart = performance.now()
              const docResult = await window.electronAPI?.solidworks?.setDocumentReadOnly?.(
                file.path,
                true,
              )
              recordSubstepTiming('setDocRO', performance.now() - setDocROStart)
              fastPathMadeReadonly = true
              if (docResult?.success && docResult.data?.changed) {
                logCheckin('info', 'Fast path pre-RPC: Updated SolidWorks document to read-only', {
                  operationId,
                  fileName: file.name,
                  wasReadOnly: docResult.data.wasReadOnly,
                  isNowReadOnly: docResult.data.isNowReadOnly,
                })
              }
            } catch (error) {
              logCheckin('warn', 'Fast path pre-RPC: Exception setting SW document read-only', {
                operationId,
                fileName: file.name,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          const checkinAPIStart = performance.now()
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newContentHash: freshHash,
            newFileSize: freshSize,
            localActiveVersion: file.localActiveVersion,
            comment: file.pendingCheckinNote,
            machineId,
            skipMachineMismatchCheck: true,
          })
          recordSubstepTiming('checkinAPI', performance.now() - checkinAPIStart)

          if (result.success && result.file) {
            // Sync any pending version notes (non-blocking, errors logged)
            await syncPendingVersionNotes(file, user.id)

            // Collect for batch readonly operation
            filesToMakeReadonly.push(file.path)

            // Post-check-in integrity verification
            const fastPathDriftHash = await detectPostCheckinDrift(
              file,
              freshHash,
              isFastPathSWFile,
              isFastPathFileOpenInSW,
            )

            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: {
                  ...file.pdmData!,
                  ...result.file,
                  checked_out_by: null,
                  checked_out_user: null,
                },
                localHash: fastPathDriftHash || freshHash,
                localVersion: result.file.version,
                diffStatus: fastPathDriftHash ? ('modified' as const) : undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined,
                // The value is now the database's. What could not be confirmed against the file
                // keeps its mark, which is why this is set rather than left alone: the pending
                // value's disappearance must not take the record of doubt with it.
                metadataWriteState: metadataSettlement.writeState,
                pendingVersionNotes: undefined,
                pendingCheckinNote: undefined,
              },
            })

            // CRITICAL: Clear recently modified flag so LoadFiles doesn't restore stale state
            if (file.pdmData?.id) {
              ctx.clearRecentlyModified(file.pdmData.id)
            }

            // Flush periodically for real-time UI feedback
            if (shouldFlush()) {
              flushPendingUpdates()
            }

            logCheckin('info', 'Fast path checkin successful', {
              operationId,
              fileName: file.name,
              oldVersion: file.pdmData?.version,
              newVersion: result.file.version,
            })
            progress.update()
            return { success: true, file }
          } else {
            // RPC failed — restore writable if we set readonly pre-RPC
            if (fastPathMadeReadonly) {
              try {
                await window.electronAPI?.setReadonly(file.path, false)
                await window.electronAPI?.solidworks?.setDocumentReadOnly?.(file.path, false)
              } catch {
                logCheckin('warn', 'Fast path: Failed to restore writable after failed RPC', {
                  operationId,
                  fileName: file.name,
                })
              }
            }
            logCheckin('error', 'Fast path checkin failed', {
              operationId,
              ...fileCtx,
              error: result.error,
            })
            progress.update()
            return { success: false, error: `${file.name}: ${result.error || 'Check in failed'}` }
          }
        }

        // ========================================
        // USE FRESH HASH: We already computed it above before the fast path check
        // Note: Metadata writing to SW file is handled by "Save to File" button during editing.
        // Check-in no longer writes to SW files - it only updates server and sets read-only.
        // ========================================
        let fileHash = freshHash
        let fileSize = freshSize

        logCheckin('debug', 'Using fresh hash for upload path', {
          operationId,
          fileName: file.name,
          hash: fileHash?.substring(0, 12),
          size: fileSize,
        })

        // Only use pending metadata if user made edits
        // Auto-extraction removed - it was opening every SW file in Document Manager
        // Metadata sync happens on checkout when properties are displayed
        //
        // Pending holds only the configurations the user edited, so the row's committed
        // custom_properties travels with it and checkinFile sends the complete configuration
        // maps. Sending pending alone is what used to erase the rest of them.
        const metadataToUse = file.pendingMetadata

        if (fileHash) {
          // Check if content actually changed from what's in storage
          const contentChanged = fileHash !== file.pdmData?.content_hash

          // Upload new content to storage if hash changed
          // This ensures the file blob exists before updating the database
          if (contentChanged && orgId) {
            logCheckin('debug', 'Content changed, uploading to storage', {
              operationId,
              fileName: file.name,
              oldHash: file.pdmData?.content_hash?.substring(0, 12),
              newHash: fileHash.substring(0, 12),
            })

            // Read file content for upload
            const readFileStart = performance.now()
            const readResult = await window.electronAPI?.readFile(file.path)
            recordSubstepTiming('readFile', performance.now() - readFileStart)
            if (!readResult?.success || readResult.data === undefined) {
              const errorDetail = readResult?.locked
                ? `${file.name}: File is locked by another process \u2014 save your work and try again`
                : `${file.name}: Failed to read file for upload`
              logCheckin('error', 'Failed to read file for upload', {
                operationId,
                fileName: file.name,
                error: readResult?.error,
                locked: readResult?.locked,
              })
              progress.update()
              return { success: false, error: errorDetail }
            }

            // TOCTOU guard: file may have changed between hashFile and readFile.
            // Use the hash from readFile (which matches the actual content) as the
            // authoritative hash for the storage path and DB record.
            if (readResult.hash && readResult.hash !== fileHash) {
              logCheckin('warn', 'File changed between hash and read (TOCTOU) — using read hash', {
                operationId,
                fileName: file.name,
                hashFileHash: fileHash.substring(0, 12),
                readFileHash: readResult.hash.substring(0, 12),
              })
              fileHash = readResult.hash
              fileSize = readResult.size ?? fileSize
            }

            // Upload to storage
            const uploadStart = performance.now()
            const uploadResult = await uploadFileContentToStorage(orgId, fileHash, readResult.data)
            recordSubstepTiming('upload', performance.now() - uploadStart)
            if (!uploadResult.success) {
              logCheckin('error', 'Failed to upload file to storage', {
                operationId,
                fileName: file.name,
                error: uploadResult.error,
              })
              progress.update()
              return {
                success: false,
                error: `${file.name}: Failed to upload - ${uploadResult.error}`,
              }
            }

            logCheckin('info', 'Uploaded new content to storage', {
              operationId,
              fileName: file.name,
              hash: fileHash.substring(0, 12),
              size: fileSize,
            })
          }

          logCheckin('debug', 'Hash computed, checking in', {
            operationId,
            fileName: file.name,
            localHash: fileHash.substring(0, 12),
            size: fileSize,
            contentChanged,
          })

          // Determine SW file status early for pre-RPC readonly
          const isSWFile = SW_EXTENSIONS.includes(file.extension.toLowerCase())
          const isFileOpenInSW = openDocumentPaths.has(normalizePath(file.path))
          let madeReadonlyPreRPC = false

          // Set readonly BEFORE releasing the checkout lock to prevent SolidWorks
          // from modifying the file between lock release and readonly.
          if (swServiceStatus.running && isSWFile && isFileOpenInSW) {
            try {
              await window.electronAPI?.setReadonly(file.path, true)

              logCheckin('debug', 'Pre-RPC: set SW document read-only', {
                operationId,
                fileName: file.name,
                filePath: file.path,
              })
              const setDocROStart = performance.now()
              const docResult = await window.electronAPI?.solidworks?.setDocumentReadOnly?.(
                file.path,
                true,
              )
              recordSubstepTiming('setDocRO', performance.now() - setDocROStart)
              madeReadonlyPreRPC = true
              if (docResult?.success && docResult.data?.changed) {
                logCheckin('info', 'Pre-RPC: Updated SolidWorks document to read-only', {
                  operationId,
                  fileName: file.name,
                  wasReadOnly: docResult.data.wasReadOnly,
                  isNowReadOnly: docResult.data.isNowReadOnly,
                })
              } else if (!docResult?.success) {
                logCheckin('warn', 'Pre-RPC: Failed to set SW document read-only', {
                  operationId,
                  fileName: file.name,
                  error: docResult?.error,
                })
                if (docResult?.error?.includes('timed out')) {
                  swServiceStatus.running = false
                }
              }
            } catch (error) {
              logCheckin('warn', 'Pre-RPC: Exception setting SW document read-only', {
                operationId,
                fileName: file.name,
                error: error instanceof Error ? error.message : String(error),
              })
              swServiceStatus.running = false
            }
          } else if (isSWFile && openDocumentPaths.size > 0 && !isFileOpenInSW) {
            logCheckin(
              'debug',
              'SW file not open in SOLIDWORKS, skipping pre-RPC setDocumentReadOnly',
              {
                operationId,
                fileName: file.name,
              },
            )
          }

          const checkinAPIStart = performance.now()
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newContentHash: fileHash,
            newFileSize: fileSize || file.size,
            newFilePath: wasFileMoved ? file.relativePath : undefined,
            newFileName: wasFileRenamed ? file.name : undefined,
            localActiveVersion: file.localActiveVersion,
            pendingMetadata: metadataToUse,
            committedCustomProperties: file.pdmData?.custom_properties,
            comment: file.pendingCheckinNote,
            machineId,
            skipMachineMismatchCheck: true,
          })
          recordSubstepTiming('checkinAPI', performance.now() - checkinAPIStart)

          if (result.success && result.file) {
            // Sync any pending version notes (non-blocking, errors logged)
            await syncPendingVersionNotes(file, user.id)

            // Collect for batch readonly operation (handles non-SW files and SW files not open)
            filesToMakeReadonly.push(file.path)

            // Post-check-in integrity verification
            const uploadDriftHash = await detectPostCheckinDrift(
              file,
              fileHash!,
              isSWFile,
              isFileOpenInSW,
            )

            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: {
                  ...file.pdmData!,
                  ...result.file,
                  checked_out_by: null,
                  checked_out_user: null,
                },
                localHash: uploadDriftHash || fileHash,
                localVersion: result.file.version,
                diffStatus: uploadDriftHash ? ('modified' as const) : undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined,
                // The value is now the database's. What could not be confirmed against the file
                // keeps its mark, which is why this is set rather than left alone: the pending
                // value's disappearance must not take the record of doubt with it.
                metadataWriteState: metadataSettlement.writeState,
                pendingVersionNotes: undefined,
                pendingCheckinNote: undefined,
              },
            })

            // Flush periodically for real-time UI feedback (count OR time based)
            if (shouldFlush()) {
              flushPendingUpdates()
            }

            // Log timing for SW operations (helps diagnose service performance)
            if (swOpStartTime !== null) {
              const swOpDuration = Date.now() - swOpStartTime
              logCheckin('info', 'SolidWorks file checkin successful', {
                operationId,
                fileName: file.name,
                oldVersion: file.pdmData?.version,
                newVersion: result.file.version,
                swOperationDurationMs: swOpDuration,
              })
            } else {
              logCheckin('info', 'File checkin successful', {
                operationId,
                fileName: file.name,
                oldVersion: file.pdmData?.version,
                newVersion: result.file.version,
                localActiveVersionCleared: file.localActiveVersion !== undefined,
                diffStatusCleared: file.diffStatus !== undefined,
              })
            }
            progress.update()
            return { success: true, file }
          } else {
            // RPC failed — restore writable if we set readonly pre-RPC
            if (madeReadonlyPreRPC) {
              try {
                await window.electronAPI?.setReadonly(file.path, false)
                await window.electronAPI?.solidworks?.setDocumentReadOnly?.(file.path, false)
                logCheckin('info', 'Restored writable after failed RPC', {
                  operationId,
                  fileName: file.name,
                })
              } catch {
                logCheckin('warn', 'Failed to restore writable after failed RPC', {
                  operationId,
                  fileName: file.name,
                })
              }
            }
            const errorMsg = translateCheckinError(result.error, file.name)
            logCheckin('error', 'Checkin API call failed', {
              operationId,
              ...fileCtx,
              error: result.error,
            })
            progress.update()
            return { success: false, error: errorMsg }
          }
        } else {
          // Metadata-only checkin (no content change)
          logCheckin('debug', 'Metadata-only checkin', {
            operationId,
            fileName: file.name,
          })

          // Set readonly BEFORE releasing the checkout lock (metadata path)
          const isMetaSWFile = SW_EXTENSIONS.includes(file.extension.toLowerCase())
          const isMetaFileOpenInSW = openDocumentPaths.has(normalizePath(file.path))
          let metaMadeReadonly = false
          if (swServiceStatus.running && isMetaSWFile && isMetaFileOpenInSW) {
            try {
              await window.electronAPI?.setReadonly(file.path, true)

              logCheckin('debug', 'Metadata path pre-RPC: set SW document read-only', {
                operationId,
                fileName: file.name,
                filePath: file.path,
              })
              const setDocROStart = performance.now()
              const docResult = await window.electronAPI?.solidworks?.setDocumentReadOnly?.(
                file.path,
                true,
              )
              recordSubstepTiming('setDocRO', performance.now() - setDocROStart)
              metaMadeReadonly = true
              if (docResult?.success && docResult.data?.changed) {
                logCheckin(
                  'info',
                  'Metadata path pre-RPC: Updated SolidWorks document to read-only',
                  {
                    operationId,
                    fileName: file.name,
                    wasReadOnly: docResult.data.wasReadOnly,
                    isNowReadOnly: docResult.data.isNowReadOnly,
                  },
                )
              } else if (!docResult?.success) {
                logCheckin('warn', 'Metadata path pre-RPC: Failed to set SW document read-only', {
                  operationId,
                  fileName: file.name,
                  error: docResult?.error,
                })
                if (docResult?.error?.includes('timed out')) {
                  swServiceStatus.running = false
                }
              }
            } catch (error) {
              logCheckin('warn', 'Metadata path pre-RPC: Exception setting SW document read-only', {
                operationId,
                fileName: file.name,
                error: error instanceof Error ? error.message : String(error),
              })
              swServiceStatus.running = false
            }
          } else if (isMetaSWFile && openDocumentPaths.size > 0 && !isMetaFileOpenInSW) {
            logCheckin(
              'debug',
              'SW file not open in SOLIDWORKS, skipping pre-RPC setDocumentReadOnly (metadata path)',
              {
                operationId,
                fileName: file.name,
              },
            )
          }

          const checkinAPIStart = performance.now()
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newFilePath: wasFileMoved ? file.relativePath : undefined,
            newFileName: wasFileRenamed ? file.name : undefined,
            localActiveVersion: file.localActiveVersion,
            pendingMetadata: metadataToUse,
            committedCustomProperties: file.pdmData?.custom_properties,
            comment: file.pendingCheckinNote,
            machineId,
            skipMachineMismatchCheck: true,
          })
          recordSubstepTiming('checkinAPI', performance.now() - checkinAPIStart)

          if (result.success && result.file) {
            // Sync any pending version notes (non-blocking, errors logged)
            await syncPendingVersionNotes(file, user.id)

            // Collect for batch readonly operation
            filesToMakeReadonly.push(file.path)

            // Post-check-in integrity verification
            const metaDriftHash = await detectPostCheckinDrift(
              file,
              result.file.content_hash || '',
              isMetaSWFile,
              isMetaFileOpenInSW,
            )

            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: {
                  ...file.pdmData!,
                  ...result.file,
                  checked_out_by: null,
                  checked_out_user: null,
                },
                localHash: metaDriftHash || result.file.content_hash,
                localVersion: result.file.version,
                diffStatus: metaDriftHash ? ('modified' as const) : undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined,
                // The value is now the database's. What could not be confirmed against the file
                // keeps its mark, which is why this is set rather than left alone: the pending
                // value's disappearance must not take the record of doubt with it.
                metadataWriteState: metadataSettlement.writeState,
                pendingVersionNotes: undefined,
                pendingCheckinNote: undefined,
              },
            })

            // Flush periodically for real-time UI feedback (count OR time based)
            if (shouldFlush()) {
              flushPendingUpdates()
            }

            // Log timing for SW operations (helps diagnose service performance)
            if (swOpStartTime !== null) {
              const swOpDuration = Date.now() - swOpStartTime
              logCheckin('info', 'SolidWorks metadata checkin successful', {
                operationId,
                fileName: file.name,
                oldVersion: file.pdmData?.version,
                newVersion: result.file.version,
                swOperationDurationMs: swOpDuration,
              })
            } else {
              logCheckin('info', 'Metadata checkin successful', {
                operationId,
                fileName: file.name,
                oldVersion: file.pdmData?.version,
                newVersion: result.file.version,
                localActiveVersionCleared: file.localActiveVersion !== undefined,
                diffStatusCleared: file.diffStatus !== undefined,
              })
            }
            progress.update()
            return { success: true, file }
          } else {
            // RPC failed — restore writable if we set readonly pre-RPC
            if (metaMadeReadonly) {
              try {
                await window.electronAPI?.setReadonly(file.path, false)
                await window.electronAPI?.solidworks?.setDocumentReadOnly?.(file.path, false)
                logCheckin('info', 'Metadata path: Restored writable after failed RPC', {
                  operationId,
                  fileName: file.name,
                })
              } catch {
                logCheckin('warn', 'Metadata path: Failed to restore writable after failed RPC', {
                  operationId,
                  fileName: file.name,
                })
              }
            }
            const errorMsg = translateCheckinError(result.error, file.name)
            logCheckin('error', 'Metadata checkin failed', {
              operationId,
              ...fileCtx,
              error: result.error,
            })
            progress.update()
            return { success: false, error: errorMsg }
          }
        }
      } catch (error) {
        logCheckin('error', 'Checkin exception', {
          operationId,
          ...fileCtx,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
        progress.update()
        return {
          success: false,
          error: `${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }
      }
    }

    // ========================================
    // PHASE 1: Process non-SolidWorks files at high concurrency (20)
    // These files don't need SW service, so no bottleneck
    // ========================================
    let nonSwResults: Array<{ success: boolean; error?: string; file?: LocalFile }> = []
    let phase1StepId = ''
    if (nonSwFiles.length > 0) {
      logCheckin('info', 'Phase 1: Processing non-SW files', {
        operationId,
        count: nonSwFiles.length,
        concurrency: CONCURRENT_OPERATIONS,
      })
      currentPhaseTimings = phase1Timings
      phase1StepId = tracker.startStep('Process non-SW files', {
        fileCount: nonSwFiles.length,
        concurrency: CONCURRENT_OPERATIONS,
      })
      const phase1Start = Date.now()
      nonSwResults = await processWithConcurrency(nonSwFiles, CONCURRENT_OPERATIONS, processFile)
      const phase1Succeeded = nonSwResults.filter((r) => r.success).length
      tracker.endStep(phase1StepId, 'completed', {
        succeeded: phase1Succeeded,
        failed: nonSwFiles.length - phase1Succeeded,
        durationMs: Date.now() - phase1Start,
      })
      // Add substeps with aggregate timing for this phase
      addSubstepsToPhase(phase1StepId, phase1Timings)
      logCheckin('info', 'Phase 1 complete', {
        operationId,
        count: nonSwFiles.length,
        durationMs: Date.now() - phase1Start,
      })
    }

    // ========================================
    // PHASE 2: Process SolidWorks files at low concurrency (3)
    // Respects the serial stdin/stdout pipe limit of the SW service
    // Sets batch flag to pause status polling during heavy operations
    // ========================================
    let swResults: Array<{ success: boolean; error?: string; file?: LocalFile }> = []

    // OPTIMIZATION: Fetch open documents ONCE before processing SW files
    // Then we only call setDocumentReadOnly for files that are actually open
    // This reduces N service calls to 1 + (number of open files)
    // NOTE: We pass includeComponents: true to get ALL loaded documents, including
    // sub-assemblies and parts loaded as components of an open assembly. This ensures
    // we update the read-only state for all files, not just those with visible windows.
    if (swFiles.length > 0 && swServiceStatus.running) {
      try {
        const openDocsResult = await window.electronAPI?.solidworks?.getOpenDocuments?.({
          includeComponents: true,
        })
        if (openDocsResult?.success && openDocsResult.data?.documents) {
          // Normalize paths for comparison (lowercase + forward slashes)
          // SolidWorks GetPathName() may return forward slashes while the file store uses backslashes
          openDocumentPaths = new Set(
            openDocsResult.data.documents
              .map((doc) => (doc.filePath ? normalizePath(doc.filePath) : null))
              .filter((p): p is string => Boolean(p)),
          )
          logCheckin('debug', 'Fetched open SW documents', {
            operationId,
            solidWorksRunning: openDocsResult.data.solidWorksRunning,
            openCount: openDocumentPaths.size,
            openFiles: Array.from(openDocumentPaths).map((p) => p.split(/[/\\]/).pop()),
          })
        } else if (openDocsResult?.success && !openDocsResult.data?.solidWorksRunning) {
          logCheckin('debug', 'SOLIDWORKS not running, skipping open document detection', {
            operationId,
          })
        }
      } catch (error) {
        // SW service error - continue without optimization
        logCheckin('warn', 'Failed to fetch open SW documents', {
          operationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    let phase2StepId = ''
    if (swFiles.length > 0) {
      // Split SW files: process parts/assemblies BEFORE drawings.
      // SolidWorks can rebuild a drawing when its referenced part changes state,
      // so checking in a part concurrently with its drawing risks the drawing
      // being modified on disk after its content was already uploaded.
      const swNonDrawings = swFiles.filter(
        (f) => !DRAWING_EXTENSIONS.includes(f.extension.toLowerCase()),
      )
      const swDrawings = swFiles.filter((f) =>
        DRAWING_EXTENSIONS.includes(f.extension.toLowerCase()),
      )

      logCheckin('info', 'Phase 2: Processing SW files (parts/assemblies first, then drawings)', {
        operationId,
        total: swFiles.length,
        partsAndAssemblies: swNonDrawings.length,
        drawings: swDrawings.length,
        concurrency: SW_CONCURRENT_OPERATIONS,
        openDocumentsCount: openDocumentPaths.size,
      })
      currentPhaseTimings = phase2Timings
      phase2StepId = tracker.startStep('Process SW files', {
        fileCount: swFiles.length,
        concurrency: SW_CONCURRENT_OPERATIONS,
        partsAndAssemblies: swNonDrawings.length,
        drawings: swDrawings.length,
      })
      const phase2Start = Date.now()

      // Set batch operation flag to pause status polling
      usePDMStore.getState().setIsBatchSWOperationRunning(true)
      try {
        // Phase 2a: Parts and assemblies first
        if (swNonDrawings.length > 0) {
          const partResults = await processWithConcurrency(
            swNonDrawings,
            SW_CONCURRENT_OPERATIONS,
            processFile,
          )
          swResults.push(...partResults)
          logCheckin('info', 'Phase 2a complete: parts/assemblies', {
            operationId,
            count: swNonDrawings.length,
            succeeded: partResults.filter((r) => r.success).length,
          })
        }

        // Phase 2b: Drawings second (after parts are checked in and readonly)
        if (swDrawings.length > 0) {
          const drawingResults = await processWithConcurrency(
            swDrawings,
            SW_CONCURRENT_OPERATIONS,
            processFile,
          )
          swResults.push(...drawingResults)
          logCheckin('info', 'Phase 2b complete: drawings', {
            operationId,
            count: swDrawings.length,
            succeeded: drawingResults.filter((r) => r.success).length,
          })
        }
      } finally {
        // Always reset flag, even if processing fails
        usePDMStore.getState().setIsBatchSWOperationRunning(false)
      }

      const phase2Succeeded = swResults.filter((r) => r.success).length
      tracker.endStep(phase2StepId, 'completed', {
        succeeded: phase2Succeeded,
        failed: swFiles.length - phase2Succeeded,
        durationMs: Date.now() - phase2Start,
      })
      // Add substeps with aggregate timing for this phase
      addSubstepsToPhase(phase2StepId, phase2Timings)
      logCheckin('info', 'Phase 2 complete', {
        operationId,
        count: swFiles.length,
        durationMs: Date.now() - phase2Start,
      })
    }

    // Combine results from both phases
    const results = [...nonSwResults, ...swResults]

    // ========================================
    // ATOMIC FINAL CLEANUP: Update remaining files AND clear processing state in ONE store update
    // This prevents the 5-second UI freeze caused by two sequential re-renders with folderMetrics recalc
    // ========================================
    const storeUpdateStepId = tracker.startStep('Atomic store update', {
      updateCount: pendingUpdates.length - lastFlushIndex,
    })
    const finalUpdateStart = performance.now()
    const remainingUpdates = pendingUpdates.slice(lastFlushIndex)
    ctx.updateFilesAndClearProcessing(remainingUpdates, allPathsBeingProcessed)
    ctx.setLastOperationCompletedAt(Date.now())
    const storeUpdateDuration = Math.round(performance.now() - finalUpdateStart)
    tracker.endStep(storeUpdateStepId, 'completed', { durationMs: storeUpdateDuration })
    logCheckin('info', 'Atomic store update complete', {
      operationId,
      remainingFilesUpdated: remainingUpdates.length,
      processingPathsCleared: allPathsBeingProcessed.length,
      durationMs: storeUpdateDuration,
    })

    // Batch set readonly on all successful files (optimization: 1 IPC call instead of N)
    if (filesToMakeReadonly.length > 0) {
      const readonlyStepId = tracker.startStep('Set readonly batch', {
        fileCount: filesToMakeReadonly.length,
      })
      logCheckin('debug', 'Setting readonly batch', {
        operationId,
        fileCount: filesToMakeReadonly.length,
      })
      const batchReadonlyResult = await window.electronAPI?.setReadonlyBatch(
        filesToMakeReadonly.map((path) => ({ path, readonly: true })),
      )
      const readonlyFailures = batchReadonlyResult?.results?.filter((r) => !r.success) || []
      tracker.endStep(readonlyStepId, 'completed', {
        succeeded: filesToMakeReadonly.length - readonlyFailures.length,
        failed: readonlyFailures.length,
      })
      if (batchReadonlyResult) {
        const failures = batchReadonlyResult.results?.filter((r) => !r.success) || []
        if (failures.length > 0) {
          logCheckin('warn', 'Some files failed to set readonly', {
            operationId,
            failedCount: failures.length,
            failures: failures.slice(0, 5).map((f) => ({ path: f.path, error: f.error })),
          })
        }
      }
    }

    // Count results and collect successfully checked-in files
    const successfulFiles: LocalFile[] = []
    for (const result of results) {
      if (result.success) {
        succeeded++
        if (result.file) {
          successfulFiles.push(result.file)

          // Mark file as recently modified to prevent realtime state drift
          // Stale realtime UPDATE events may arrive shortly after check-in
          // and could revert the local state to pre-check-in values
          if (result.file.pdmData?.id) {
            ctx.markFileAsRecentlyModified(result.file.pdmData.id)
            // Clear the flag after 15 seconds (debounce window)
            setTimeout(() => ctx.clearRecentlyModified(result.file!.pdmData!.id), 15000)
          }
        }
      } else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }

    // Extract and store assembly references in BACKGROUND (non-blocking)
    // This runs after all files are checked in, so child references are more likely to exist
    // We don't await this - it runs in background and logs its own results
    let extractionStarted = false
    const assemblyFiles: LocalFile[] = []

    if (successfulFiles.length > 0 && ctx.activeVaultId && ctx.organization?.id) {
      // Find files with references to extract (assemblies and drawings)
      const filesWithRefs = successfulFiles.filter((f) =>
        REFERENCE_FILE_EXTENSIONS.includes(f.extension.toLowerCase()),
      )
      assemblyFiles.push(...filesWithRefs)

      if (assemblyFiles.length > 0) {
        // Check if SolidWorks service is running BEFORE attempting extraction
        const swStatus = await window.electronAPI?.solidworks?.getServiceStatus?.()
        const swRunning = swStatus?.data?.running

        const assembliesCount = assemblyFiles.filter(
          (f) => f.extension.toLowerCase() === '.sldasm',
        ).length
        const drawingsCount = assemblyFiles.filter(
          (f) => f.extension.toLowerCase() === '.slddrw',
        ).length

        if (!swRunning) {
          logCheckin('info', 'Skipping reference extraction - SW service not running', {
            operationId,
            fileCount: assemblyFiles.length,
            assemblies: assembliesCount,
            drawings: drawingsCount,
            files: assemblyFiles.map((f) => f.name),
          })
          // Show info toast so user knows what to do
          ctx.addToast(
            'info',
            `File references not extracted — start SolidWorks service and use "Update from SW" in Contains tab`,
          )
        } else {
          logCheckin('debug', 'Starting background reference extraction', {
            operationId,
            fileCount: assemblyFiles.length,
            assemblies: assembliesCount,
            drawings: drawingsCount,
            files: assemblyFiles.map((f) => f.name),
          })

          extractionStarted = true
          const vaultId = ctx.activeVaultId
          const orgId = ctx.organization.id
          const vaultRootPath = ctx.vaultPath || undefined

          // NON-BLOCKING: Fire-and-forget extraction - don't await!
          // This keeps the checkin responsive while references are extracted in background
          Promise.allSettled(
            assemblyFiles.map((f) => extractAndStoreReferences(f, orgId, vaultId, vaultRootPath)),
          )
            .then(async (extractResults) => {
              const extractionSucceeded = extractResults.filter(
                (r) => r.status === 'fulfilled',
              ).length
              const extractionFailed = assemblyFiles.length - extractionSucceeded

              logCheckin('info', 'Background reference extraction complete', {
                operationId,
                total: assemblyFiles.length,
                succeeded: extractionSucceeded,
                failed: extractionFailed,
              })

              // Show warning toast if extraction had failures
              if (extractionFailed > 0 && extractionSucceeded === 0) {
                ctx.addToast('warning', `Failed to extract component references`)
              } else if (extractionFailed > 0) {
                ctx.addToast(
                  'warning',
                  `Reference extraction failed for ${extractionFailed}/${assemblyFiles.length} assemblies`,
                )
              }

              // After reference extraction, propagate drawing revisions to referenced parts/assemblies
              // This updates the configuration_revisions field on referenced files
              const drawingFiles = assemblyFiles.filter(
                (f) => DRAWING_EXTENSIONS.includes(f.extension.toLowerCase()) && f.pdmData?.id, // Must have a file ID
              )

              if (drawingFiles.length > 0) {
                logCheckin('debug', 'Propagating drawing revisions to configuration revisions', {
                  operationId,
                  drawingCount: drawingFiles.length,
                })

                let propagationSucceeded = 0
                let propagationFailed = 0

                for (const drawing of drawingFiles) {
                  // Get the drawing's revision (from pending metadata if available, else from pdmData)
                  const drawingRevision = resolvedText(resolveRevision(drawing))

                  try {
                    const propResult = await propagateDrawingRevisionToConfigurations(
                      drawing.pdmData!.id,
                      drawingRevision,
                      orgId,
                    )

                    if (propResult.success || propResult.updated > 0) {
                      propagationSucceeded++
                      logCheckin('info', 'Propagated drawing revision to configs', {
                        drawingName: drawing.name,
                        drawingRevision,
                        configsUpdated: propResult.updated,
                      })
                    } else if (propResult.errors.length > 0) {
                      propagationFailed++
                      logCheckin('warn', 'Drawing revision propagation had errors', {
                        drawingName: drawing.name,
                        errors: propResult.errors,
                      })
                    }
                  } catch (error) {
                    propagationFailed++
                    logCheckin('error', 'Drawing revision propagation failed', {
                      drawingName: drawing.name,
                      error: error instanceof Error ? error.message : String(error),
                    })
                  }
                }

                logCheckin('info', 'Drawing revision propagation complete', {
                  operationId,
                  totalDrawings: drawingFiles.length,
                  succeeded: propagationSucceeded,
                  failed: propagationFailed,
                })
              }
            })
            .catch((error) => {
              logCheckin('error', 'Background reference extraction error', {
                operationId,
                error: error instanceof Error ? error.message : String(error),
              })
            })
        }
      }
    }

    const { duration } = progress.finish()

    // Log final result
    logCheckin(failed > 0 ? 'warn' : 'info', 'Checkin operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      assembliesProcessed: assemblyFiles.length,
      extractionStartedInBackground: extractionStarted,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    })

    // Build success message
    const checkinMsg = `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`

    // Show result
    if (failed > 0) {
      // Show first error in toast for visibility
      const firstError = errors[0] || 'Unknown error'
      const moreText = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
      ctx.addToast('error', `Check-in failed: ${firstError}${moreText}`)
    } else {
      ctx.addToast('success', checkinMsg)
    }

    // Warn about post-check-in drift (SolidWorks modified files after upload)
    if (driftedFiles.length > 0) {
      const fileList =
        driftedFiles.length <= 3
          ? driftedFiles.join(', ')
          : `${driftedFiles.slice(0, 3).join(', ')} (+${driftedFiles.length - 3} more)`
      ctx.addToast(
        'warning',
        `${driftedFiles.length === 1 ? 'File was' : `${driftedFiles.length} files were`} modified by SolidWorks after check-in: ${fileList}. ` +
          `Check out and check in again to save the latest version.`,
      )
      logCheckin('warn', 'Post-check-in drift detected', {
        operationId,
        driftedFiles,
        count: driftedFiles.length,
      })
    }

    // Complete operation tracking
    tracker.endOperation(failed === 0 ? 'completed' : 'failed', failed > 0 ? errors[0] : undefined)

    return {
      success: failed === 0,
      message: failed > 0 ? `Checked in ${succeeded}/${total} files` : checkinMsg,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    }
  },
}
