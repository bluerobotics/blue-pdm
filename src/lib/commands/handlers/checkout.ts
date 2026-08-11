/**
 * Checkout Command
 *
 * Check out files for editing. This:
 * 1. Locks the file on the server
 * 2. Makes the local file writable
 * 3. Auto-extracts SolidWorks metadata (if SW service available)
 */

import type { Command, CheckoutParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { checkoutFile } from '../../supabase'
import {
  processWithConcurrency,
  CONCURRENT_OPERATIONS,
  SW_CONCURRENT_OPERATIONS,
} from '../../concurrency'
import { updateInodes } from '../../cache/localSyncIndex'
import type { LocalFile } from '../../../stores/pdmStore'
import { usePDMStore } from '../../../stores/pdmStore'
import { log } from '@/lib/logger'
import { sleep } from '../../network'
import { FileOperationTracker } from '../../fileOperationTracker'

// SolidWorks file extensions that support metadata extraction
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

/** Normalize a file path for cross-source comparison (SolidWorks vs file system) */
const normalizePath = (p: string) => p.toLowerCase().replace(/\\/g, '/')

/**
 * Incremental Store Update Configuration
 *
 * During batch operations (checking out many files), updating the store after
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

// Note: Metadata extraction on checkout was removed.
// Metadata sync is now an explicit user action via "Sync Metadata" command.

// Logging for checkout operations
function logCheckout(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[Checkout]', message, context)
}

function getFileContext(file: LocalFile): Record<string, unknown> {
  return {
    fileName: file.name,
    relativePath: file.relativePath,
    fullPath: file.path,
    fileId: file.pdmData?.id,
    checkedOutBy: file.pdmData?.checked_out_by,
    version: file.pdmData?.version,
    state: file.pdmData?.workflow_state?.name,
  }
}

export const checkoutCommand: Command<CheckoutParams> = {
  id: 'checkout',
  name: 'Check Out',
  description: 'Check out files for editing',
  aliases: ['co'],
  usage: 'checkout <path> [--recursive]',

  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot check out files while offline'
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

    // Get synced files that can be checked out
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const checkoutable = syncedFiles.filter((f) => !f.pdmData?.checked_out_by)

    if (checkoutable.length === 0) {
      // Check if all are already checked out
      if (syncedFiles.length > 0 && syncedFiles.every((f) => f.pdmData?.checked_out_by)) {
        return 'All files are already checked out'
      }
      return 'No synced files to check out'
    }

    return null
  },

  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    const operationId = `checkout-${Date.now()}`

    // Get files that can be checked out (for tracker initialization)
    const syncedFilesForTracker = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckoutForTracker = syncedFilesForTracker.filter(
      (f) => !f.pdmData?.checked_out_by,
    )

    // Initialize file operation tracker for DevTools monitoring
    const tracker = FileOperationTracker.start(
      'checkout',
      filesToCheckoutForTracker.length,
      filesToCheckoutForTracker.map((f) => f.relativePath),
    )

    logCheckout('info', 'Starting checkout operation', {
      operationId,
      userId: user.id,
      selectedFileCount: files.length,
    })

    // Pre-fetch machine info ONCE before processing files (avoid redundant IPC calls)
    const prefetchStepId = tracker.startStep('Pre-fetch machine info')
    const { getMachineId, getMachineName } = await import('../../backup')
    const [machineId, machineName] = await Promise.all([getMachineId(), getMachineName()])
    tracker.endStep(prefetchStepId, 'completed', { machineId: machineId?.substring(0, 8) })

    // Pre-check SolidWorks service status (with retry if integration is enabled)
    const swStatusStepId = tracker.startStep('Check SW service status')
    let swServiceRunning = false
    try {
      const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
      swServiceRunning = !!status?.data?.running
    } catch {
      // SW service not available
    }

    // If SW service isn't running yet but the user has SW integration enabled,
    // wait briefly for the auto-start to complete (covers PLM restart timing)
    if (!swServiceRunning && usePDMStore.getState().solidworksIntegrationEnabled) {
      const SW_SERVICE_RETRY_ATTEMPTS = 3
      const SW_SERVICE_RETRY_DELAY_MS = 1500
      for (let attempt = 1; attempt <= SW_SERVICE_RETRY_ATTEMPTS; attempt++) {
        logCheckout(
          'debug',
          `SW service not ready, retry ${attempt}/${SW_SERVICE_RETRY_ATTEMPTS}`,
          { operationId },
        )
        await sleep(SW_SERVICE_RETRY_DELAY_MS)
        try {
          const retryStatus = await window.electronAPI?.solidworks?.getServiceStatus?.()
          if (retryStatus?.data?.running) {
            swServiceRunning = true
            logCheckout('info', `SW service became ready after ${attempt} retries`, { operationId })
            break
          }
        } catch {
          // Still not available
        }
      }
    }
    tracker.endStep(swStatusStepId, 'completed', { swRunning: swServiceRunning })

    // Get files that can be checked out
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckout = syncedFiles.filter((f) => !f.pdmData?.checked_out_by)

    logCheckout('debug', 'Filtered files for checkout', {
      operationId,
      syncedCount: syncedFiles.length,
      checkoutableCount: filesToCheckout.length,
      alreadyCheckedOut: syncedFiles.filter((f) => f.pdmData?.checked_out_by).length,
    })

    if (filesToCheckout.length === 0) {
      logCheckout('info', 'No files to check out', { operationId })
      tracker.endOperation('completed')
      return {
        success: true,
        message: 'No files to check out',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // Track folders and files being processed (for spinner display)
    // Use synchronous update to ensure spinners render before async work begins
    const foldersBeingProcessed = files.filter((f) => f.isDirectory).map((f) => f.relativePath)
    const filesBeingProcessed = filesToCheckout.map((f) => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...foldersBeingProcessed, ...filesBeingProcessed])]
    ctx.addProcessingFoldersSync(allPathsBeingProcessed, 'checkout')

    // Progress tracking
    const toastId = `checkout-${Date.now()}`
    const total = filesToCheckout.length
    const progress = new ProgressTracker(
      ctx,
      'checkout',
      toastId,
      `Checking out ${total} file${total > 1 ? 's' : ''}...`,
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

    // Collect paths for batch setReadonly call (performance: 1 IPC call instead of N)
    const pathsToMakeWritable: string[] = []

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
        logCheckout('debug', 'Incremental store flush', {
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
    const swFiles = filesToCheckout.filter((f) => SW_EXTENSIONS.includes(f.extension.toLowerCase()))
    const nonSwFiles = filesToCheckout.filter(
      (f) => !SW_EXTENSIONS.includes(f.extension.toLowerCase()),
    )

    logCheckout('info', 'Two-phase processing strategy', {
      operationId,
      totalFiles: filesToCheckout.length,
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
      const substepOrder = ['checkoutAPI', 'setDocRW', 'extractMeta', 'flush']
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
    let swReadOnlyFailCount = 0
    let swComUnavailable = false

    /**
     * Process a single file for checkout
     * Extracted to avoid code duplication between phases
     */
    const processFile = async (file: LocalFile): Promise<{ success: boolean; error?: string }> => {
      const fileCtx = getFileContext(file)
      const isSolidWorksFile = SW_EXTENSIONS.includes(file.extension.toLowerCase())
      const swOpStartTime = isSolidWorksFile ? Date.now() : null

      try {
        logCheckout('debug', 'Checking out file', { operationId, ...fileCtx })

        const checkoutAPIStart = performance.now()
        const result = await checkoutFile(file.pdmData!.id, user.id, user.email, {
          machineId,
          machineName,
        })
        recordSubstepTiming('checkoutAPI', performance.now() - checkoutAPIStart)

        if (result.success) {
          // Collect path for batch setReadonly call (done after all files processed)
          // This reduces N IPC calls to 1, significantly improving performance
          pathsToMakeWritable.push(file.path)

          // If SolidWorks file is open, also change document read-only state
          // This allows checking out files without closing SolidWorks!
          // OPTIMIZATION: Only call setDocumentReadOnly for files that are actually open
          // We fetched the open documents list ONCE before processing, reducing N calls to 1 + (open count)
          const isSWFile = SW_EXTENSIONS.includes(file.extension.toLowerCase())
          const isFileOpenInSW = openDocumentPaths.has(normalizePath(file.path))
          if (isSWFile && isFileOpenInSW) {
            try {
              // CRITICAL: Clear the file system read-only flag FIRST!
              // SOLIDWORKS cannot make a document editable if the underlying file is still read-only.
              // We do this individually for open SW files BEFORE calling setDocumentReadOnly.
              await window.electronAPI?.setReadonly(file.path, false)

              logCheckout('debug', 'Attempting to set SW document read-write', {
                operationId,
                fileName: file.name,
                filePath: file.path,
              })
              const setDocRWStart = performance.now()
              const docResult = await window.electronAPI?.solidworks?.setDocumentReadOnly?.(
                file.path,
                false,
              )
              recordSubstepTiming('setDocRW', performance.now() - setDocRWStart)
              if (docResult?.success && docResult.data?.changed) {
                logCheckout('info', 'Updated SolidWorks document to read-write', {
                  operationId,
                  fileName: file.name,
                  wasReadOnly: docResult.data.wasReadOnly,
                  isNowReadOnly: docResult.data.isNowReadOnly,
                })
              } else if (docResult?.success && !docResult.data?.changed) {
                logCheckout('debug', 'SW document already read-write, no change needed', {
                  operationId,
                  fileName: file.name,
                })
              } else if (!docResult?.success) {
                swReadOnlyFailCount++
                logCheckout('warn', 'Failed to set SW document read-write', {
                  operationId,
                  fileName: file.name,
                  error: docResult?.error,
                })
              }
            } catch (error) {
              swReadOnlyFailCount++
              logCheckout('warn', 'Exception setting SW document read-write', {
                operationId,
                fileName: file.name,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          } else if (isSWFile && openDocumentPaths.size > 0) {
            // File is a SW file but not currently open in SOLIDWORKS
            logCheckout('debug', 'SW file not open in SOLIDWORKS, skipping setDocumentReadOnly', {
              operationId,
              fileName: file.name,
            })
          }

          // Queue update for batch processing
          // IMPORTANT: Explicitly clear pendingMetadata on checkout
          // pendingMetadata should only be set when user edits the datacard
          // The UI falls back to pdmData for display when pendingMetadata is undefined
          pendingUpdates.push({
            path: file.path,
            updates: {
              pdmData: {
                ...file.pdmData!,
                checked_out_by: user.id,
                checked_out_user: {
                  id: user.id,
                  full_name: user.full_name,
                  email: user.email,
                  avatar_url: user.avatar_url,
                },
              },
              pendingMetadata: undefined, // Clear any existing pending metadata
            },
          })

          // Flush periodically for real-time UI feedback (count OR time based)
          if (shouldFlush()) {
            flushPendingUpdates()
          }

          // Log timing for SW operations (helps diagnose service performance)
          if (swOpStartTime !== null) {
            const swOpDuration = Date.now() - swOpStartTime
            logCheckout('info', 'SolidWorks file checkout successful', {
              operationId,
              fileName: file.name,
              swOperationDurationMs: swOpDuration,
            })
          } else {
            logCheckout('debug', 'File checkout successful', { operationId, fileName: file.name })
          }
          progress.update()
          return { success: true }
        } else {
          logCheckout('error', 'File checkout failed', {
            operationId,
            ...fileCtx,
            error: result.error,
          })
          progress.update()
          return { success: false, error: `${file.name}: ${result.error || 'Unknown error'}` }
        }
      } catch (error) {
        logCheckout('error', 'Checkout exception', {
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
    let nonSwResults: Array<{ success: boolean; error?: string }> = []
    let phase1StepId = ''
    if (nonSwFiles.length > 0) {
      logCheckout('info', 'Phase 1: Processing non-SW files', {
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
      logCheckout('info', 'Phase 1 complete', {
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
    let swResults: Array<{ success: boolean; error?: string }> = []

    // OPTIMIZATION: Fetch open documents ONCE before processing SW files
    // Then we only call setDocumentReadOnly for files that are actually open
    // This reduces N service calls to 1 + (number of open files)
    // NOTE: We pass includeComponents: true to get ALL loaded documents, including
    // sub-assemblies and parts loaded as components of an open assembly. This ensures
    // we update the read-only state for all files, not just those with visible windows.
    if (swFiles.length > 0 && swServiceRunning) {
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
          logCheckout('debug', 'Fetched open SW documents', {
            operationId,
            solidWorksRunning: openDocsResult.data.solidWorksRunning,
            openCount: openDocumentPaths.size,
            openFiles: Array.from(openDocumentPaths).map((p) => p.split(/[/\\]/).pop()),
          })
        } else if (openDocsResult?.success && !openDocsResult.data?.solidWorksRunning) {
          swComUnavailable = true
          logCheckout('debug', 'SOLIDWORKS not running, skipping open document detection', {
            operationId,
          })
        }
      } catch (error) {
        swComUnavailable = true
        logCheckout('warn', 'Failed to fetch open SW documents', {
          operationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } else if (swFiles.length > 0 && !swServiceRunning) {
      swComUnavailable = true
    }

    let phase2StepId = ''
    if (swFiles.length > 0) {
      logCheckout('info', 'Phase 2: Processing SW files', {
        operationId,
        count: swFiles.length,
        concurrency: SW_CONCURRENT_OPERATIONS,
        openDocumentsCount: openDocumentPaths.size,
      })
      currentPhaseTimings = phase2Timings
      phase2StepId = tracker.startStep('Process SW files', {
        fileCount: swFiles.length,
        concurrency: SW_CONCURRENT_OPERATIONS,
      })
      const phase2Start = Date.now()

      // Set batch operation flag to pause status polling
      usePDMStore.getState().setIsBatchSWOperationRunning(true)
      try {
        swResults = await processWithConcurrency(swFiles, SW_CONCURRENT_OPERATIONS, processFile)
      } finally {
        // Always reset flag, even if processing fails
        usePDMStore.getState().setIsBatchSWOperationRunning(false)
      }

      const phase2Succeeded = swResults.filter((r) => r.success).length
      const phase2Duration = Date.now() - phase2Start
      tracker.endStep(phase2StepId, 'completed', {
        succeeded: phase2Succeeded,
        failed: swFiles.length - phase2Succeeded,
        durationMs: phase2Duration,
      })
      // Add substeps with aggregate timing for this phase
      addSubstepsToPhase(phase2StepId, phase2Timings)
      logCheckout('info', 'Phase 2 complete', {
        operationId,
        count: swFiles.length,
        durationMs: phase2Duration,
      })
    }

    // Combine results from both phases
    const results = [...nonSwResults, ...swResults]

    // ========================================
    // BATCH SETREADONLY: Make all files writable in one IPC call
    // This reduces N IPC calls to 1, significantly improving performance
    // ========================================
    if (pathsToMakeWritable.length > 0) {
      const setWritableStepId = tracker.startStep('Set files writable (batch)', {
        fileCount: pathsToMakeWritable.length,
      })
      const setWritableStart = performance.now()
      const batchFiles = pathsToMakeWritable.map((path) => ({ path, readonly: false }))
      const batchResult = await window.electronAPI?.setReadonlyBatch(batchFiles)
      const setWritableDuration = performance.now() - setWritableStart

      if (batchResult?.success === false || batchResult?.results?.some((r) => !r.success)) {
        const failedCount = batchResult?.results?.filter((r) => !r.success).length ?? 0
        tracker.endStep(setWritableStepId, 'completed', {
          failed: failedCount,
          durationMs: Math.round(setWritableDuration),
        })
        logCheckout('warn', 'Some files failed to clear read-only flag', {
          operationId,
          totalFiles: pathsToMakeWritable.length,
          failedCount,
          durationMs: Math.round(setWritableDuration),
        })
      } else {
        tracker.endStep(setWritableStepId, 'completed', {
          durationMs: Math.round(setWritableDuration),
        })
        logCheckout('debug', 'Batch setReadonly complete', {
          operationId,
          fileCount: pathsToMakeWritable.length,
          durationMs: Math.round(setWritableDuration),
        })
      }
    }

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
    logCheckout('info', 'Atomic store update complete', {
      operationId,
      remainingFilesUpdated: remainingUpdates.length,
      processingPathsCleared: allPathsBeingProcessed.length,
      durationMs: storeUpdateDuration,
    })

    // Clear any persisted pending metadata for checked out files
    // This ensures stale metadata from previous checkouts doesn't get restored
    const checkedOutPaths = pendingUpdates.map((u) => u.path)
    ctx.clearPersistedPendingMetadataForPaths(checkedOutPaths)

    // Stamp inodes for checked-out files into IndexedDB immediately.
    // This closes the timing window where a SolidWorks rename can happen
    // before the next loadFiles end writes the inode data.
    const vaultId = usePDMStore.getState().activeVaultId
    if (vaultId) {
      // Build set of successful file paths from results (correctly ordered)
      // Results are ordered as: nonSwResults then swResults, so we need to map
      // indices back to the correct file from each phase
      const successfulPaths = new Set<string>()
      for (let i = 0; i < results.length; i++) {
        if (results[i].success) {
          const file = i < nonSwFiles.length ? nonSwFiles[i] : swFiles[i - nonSwFiles.length]
          successfulPaths.add(file.path)
        }
      }
      const successfulFiles = filesToCheckout.filter(
        (f: LocalFile) => successfulPaths.has(f.path) && f.ino && f.ino > 0,
      )
      if (successfulFiles.length > 0) {
        const inodeEntries = successfulFiles.map((f: LocalFile) => ({
          path: f.relativePath,
          ino: f.ino!,
        }))
        updateInodes(vaultId, inodeEntries).catch((error) => {
          logCheckout('warn', 'Failed to stamp inodes after checkout', {
            operationId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }

    // Count results
    for (const result of results) {
      if (result.success) succeeded++
      else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }

    const { duration } = progress.finish()

    // Log final result
    logCheckout(failed > 0 ? 'warn' : 'info', 'Checkout operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    })

    // Show result
    if (failed > 0) {
      // Show first error in toast for visibility
      const firstError = errors[0] || 'Unknown error'
      const moreText = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
      ctx.addToast('error', `Checkout failed: ${firstError}${moreText}`)
    } else {
      ctx.addToast('success', `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }

    // Warn if SW files were checked out but read-only state couldn't be updated in SolidWorks
    const swSucceeded = swFiles.filter((_, i) => swResults[i]?.success).length
    if (swSucceeded > 0 && (swComUnavailable || swReadOnlyFailCount > 0)) {
      ctx.addToast(
        'warning',
        'Files checked out and writable on disk, but SolidWorks still shows read-only. In SolidWorks: Edit menu \u2192 toggle Read-Only Mode, or close and reopen the file.',
      )
    }

    // Complete operation tracking
    tracker.endOperation(failed === 0 ? 'completed' : 'failed', failed > 0 ? errors[0] : undefined)

    return {
      success: failed === 0,
      message:
        failed > 0
          ? `Checked out ${succeeded}/${total} files`
          : `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    }
  },
}
