/**
 * Command Executor
 *
 * Handles running commands with:
 * - Validation
 * - Progress tracking
 * - Error handling
 * - Command history (for future undo/redo)
 * - Active operation tracking & cancellation
 */

import { usePDMStore } from '../../stores/pdmStore'
import type { Command, CommandContext, CommandResult, CommandId, CommandMap } from './types'
import { logUserAction } from '../userActionLogger'
import { log } from '../logger'
// NOTE: checkFilesForSizeWarning is imported dynamically below to avoid circular dependency
// (useUploadSizeWarning → @/lib/commands → executor.ts → useUploadSizeWarning)

// Registry of all commands
const commandRegistry = new Map<CommandId, Command<any>>()

// ============================================
// Command Confirmation Dialog (promise-based)
// ============================================

// Module-level resolver for the confirm dialog promise.
// The store holds the dialog state (title, message, items),
// and this variable holds the resolve function to avoid storing functions in Zustand.
let confirmResolver: ((confirmed: boolean) => void) | null = null

/**
 * Resolve the pending command confirmation dialog.
 * Called by the CommandConfirmContainer component when user clicks confirm/cancel.
 */
export function resolveCommandConfirm(confirmed: boolean): void {
  const store = usePDMStore.getState()
  store.setPendingCommandConfirm(null)
  if (confirmResolver) {
    confirmResolver(confirmed)
    confirmResolver = null
  }
}

/**
 * Show a confirmation dialog and wait for user response.
 * Used by command handlers via ctx.confirm().
 */
function showCommandConfirm(opts: {
  title: string
  message: string
  items?: string[]
  confirmText?: string
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve
    const store = usePDMStore.getState()
    store.setPendingCommandConfirm({
      title: opts.title,
      message: opts.message,
      items: opts.items,
      confirmText: opts.confirmText,
    })
  })
}

// Command history for audit trail
interface CommandHistoryEntry {
  id: string
  commandId: CommandId
  params: unknown
  result: CommandResult
  timestamp: Date
  userId?: string
}

const commandHistory: CommandHistoryEntry[] = []
const MAX_HISTORY = 100

// ============================================
// Active Operations Registry (for cancellation)
// ============================================

interface ActiveOperation {
  id: string
  commandId: CommandId
  toastId: string
  startTime: Date
  description: string
}

const activeOperations = new Map<string, ActiveOperation>()

/**
 * Register an active operation
 */
export function registerActiveOperation(
  operationId: string,
  commandId: CommandId,
  toastId: string,
  description: string,
): void {
  activeOperations.set(operationId, {
    id: operationId,
    commandId,
    toastId,
    startTime: new Date(),
    description,
  })
}

/**
 * Unregister an active operation (when it completes)
 */
export function unregisterActiveOperation(operationId: string): void {
  activeOperations.delete(operationId)
}

/**
 * Get all active operations
 */
export function getActiveOperations(): ActiveOperation[] {
  return Array.from(activeOperations.values())
}

/**
 * Check if there are any active operations
 */
export function hasActiveOperations(): boolean {
  return activeOperations.size > 0
}

/**
 * Cancel all active operations
 * Returns the number of operations that were cancelled
 */
export function cancelAllOperations(): number {
  const store = usePDMStore.getState()
  const operations = Array.from(activeOperations.values())

  for (const op of operations) {
    // Request cancellation via the toast system
    store.requestCancelProgressToast(op.toastId)
  }

  const count = operations.length
  if (count > 0) {
    store.addToast('warning', `Cancelling ${count} operation${count > 1 ? 's' : ''}...`)
  }

  return count
}

/**
 * Cancel a specific operation by ID
 */
export function cancelOperation(operationId: string): boolean {
  const op = activeOperations.get(operationId)
  if (!op) return false

  const store = usePDMStore.getState()
  store.requestCancelProgressToast(op.toastId)
  return true
}

/**
 * Register a command in the registry
 */
export function registerCommand<K extends CommandId>(id: K, command: CommandMap[K]): void {
  commandRegistry.set(id, command as Command<any>)
}

/**
 * Get a command by ID
 */
export function getCommand<K extends CommandId>(id: K): CommandMap[K] | undefined {
  return commandRegistry.get(id) as CommandMap[K] | undefined
}

/**
 * Get all registered commands
 */
export function getAllCommands(): Command<any>[] {
  return Array.from(commandRegistry.values())
}

/**
 * Build command context from the store
 */
export function buildCommandContext(
  onRefresh?: (silent?: boolean) => void,
  existingToastId?: string,
  silent?: boolean,
  // Collects progress toasts this command creates, so the caller can clear any
  // that are still open if the command throws before finishing them.
  trackedToastIds?: Set<string>,
): CommandContext {
  const store = usePDMStore.getState()

  const addProgressToast: CommandContext['addProgressToast'] = (id, message, total) => {
    trackedToastIds?.add(id)
    store.addProgressToast(id, message, total)
  }

  const removeToast: CommandContext['removeToast'] = (id) => {
    trackedToastIds?.delete(id)
    store.removeToast(id)
  }

  return {
    user: store.user,
    organization: store.organization,
    isOfflineMode: store.isOfflineMode,
    getEffectiveRole: store.getEffectiveRole,
    vaultPath: store.vaultPath,
    activeVaultId: store.activeVaultId,
    files: store.files,

    // Confirmation dialog
    confirm: showCommandConfirm,

    // Toast functions
    addToast: store.addToast,
    addProgressToast,
    updateProgressToast: store.updateProgressToast,
    removeToast,
    isProgressToastCancelled: store.isProgressToastCancelled,

    // Store updates
    updateFileInStore: store.updateFileInStore,
    updateFilesInStore: store.updateFilesInStore,
    removeFilesFromStore: store.removeFilesFromStore,
    addFilesToStore: store.addFilesToStore,
    renameFileInStore: store.renameFileInStore,
    clearPersistedPendingMetadataForPaths: store.clearPersistedPendingMetadataForPaths,
    addProcessingFolder: store.addProcessingFolder,
    addProcessingFolders: store.addProcessingFolders,
    addProcessingFoldersSync: store.addProcessingFoldersSync,
    removeProcessingFolder: store.removeProcessingFolder,
    removeProcessingFolders: store.removeProcessingFolders,
    removeProcessingFoldersSync: store.removeProcessingFoldersSync,
    updateFilesAndClearProcessing: store.updateFilesAndClearProcessing,
    processingOperations: store.processingOperations,

    // Auto-download exclusion (scoped to active vault)
    addAutoDownloadExclusion: (relativePath: string) => {
      const vaultId = store.activeVaultId
      if (vaultId) {
        store.addAutoDownloadExclusion(vaultId, relativePath)
      }
    },

    // File watcher suppression
    addExpectedFileChanges: store.addExpectedFileChanges,
    clearExpectedFileChanges: store.clearExpectedFileChanges,
    setLastOperationCompletedAt: store.setLastOperationCompletedAt,

    // Realtime update debouncing
    markFileAsRecentlyModified: store.markFileAsRecentlyModified,
    clearRecentlyModified: store.clearRecentlyModified,

    // Refresh
    onRefresh,

    // Existing toast ID (when operation was queued, toast was already created)
    existingToastId,

    // Silent mode (skip success toasts)
    silent,
  }
}

// File operations that should be queued (run serially, one at a time)
const QUEUED_FILE_OPERATIONS: CommandId[] = [
  'checkout',
  'checkin',
  'sync',
  'download',
  'get-latest',
  'discard',
  'force-release',
]

/**
 * Execute a command by ID
 *
 * File operations (checkout, checkin, sync, download, etc.) are queued and
 * executed serially to prevent overlapping operations and provide cleaner UX.
 */
export async function executeCommand<K extends CommandId>(
  commandId: K,
  params: CommandMap[K] extends Command<infer P> ? P : never,
  options?: {
    onRefresh?: (silent?: boolean) => void
    silent?: boolean // Skip success toast
    skipSizeWarning?: boolean // Bypass large-file check (user already confirmed)
  },
): Promise<CommandResult> {
  const command = commandRegistry.get(commandId)

  if (!command) {
    log.error('[Commands]', 'Unknown command', { commandId })
    return {
      success: false,
      message: `Unknown command: ${commandId}`,
      total: 0,
      succeeded: 0,
      failed: 0,
    }
  }

  const ctx = buildCommandContext(options?.onRefresh, undefined, options?.silent)

  // Validate before queuing
  const validationError = command.validate(params, ctx)
  if (validationError) {
    ctx.addToast('warning', validationError)
    return {
      success: false,
      message: validationError,
      total: 0,
      succeeded: 0,
      failed: 0,
    }
  }

  // Check for large files on upload commands (sync, checkin) before queuing
  if ((commandId === 'sync' || commandId === 'checkin') && !options?.skipSizeWarning) {
    const store = usePDMStore.getState()
    const { uploadSizeWarningEnabled, uploadSizeWarningThreshold } = store

    if (uploadSizeWarningEnabled) {
      const files = (params as any)?.files || [] // TODO: type this
      // Dynamic import to avoid circular dependency
      const { checkFilesForSizeWarning } = await import('../../hooks/useUploadSizeWarning')
      const { largeFiles, smallFiles } = checkFilesForSizeWarning(
        files,
        uploadSizeWarningThreshold,
        uploadSizeWarningEnabled,
      )

      // If there are large files, set pending upload and return early
      if (largeFiles.length > 0) {
        store.setPendingLargeUpload({
          files,
          largeFiles,
          smallFiles,
          command: commandId as 'sync' | 'checkin',
          options: (params as any)?.extractReferences ? { extractReferences: true } : undefined, // TODO: type this
          onRefresh: options?.onRefresh,
        })

        // Return a "pending" result - the actual command will run after user decision
        return {
          success: true,
          message: 'Waiting for user decision on large files',
          total: 0,
          succeeded: 0,
          failed: 0,
        }
      }
    }
  }

  // Route file operations through the serial queue
  if (QUEUED_FILE_OPERATIONS.includes(commandId)) {
    const store = usePDMStore.getState()
    const files = (params as any)?.files || [] // TODO: type this
    const paths = files.map((f: { relativePath?: string }) => f.relativePath || '').filter(Boolean)
    const fileCount = files.length

    // Map command ID to queue operation type
    const typeMap: Record<
      string,
      | 'download'
      | 'get-latest'
      | 'delete'
      | 'upload'
      | 'sync'
      | 'checkin'
      | 'checkout'
      | 'discard'
      | 'force-release'
    > = {
      checkout: 'checkout',
      checkin: 'checkin',
      sync: 'sync',
      download: 'download',
      'get-latest': 'get-latest',
      discard: 'discard',
      'force-release': 'force-release',
    }

    const opType = typeMap[commandId] || 'sync'

    // Map to OperationType for processing state (spinners)
    // 'get-latest' maps to 'download' for spinner display
    const processingType: import('../../stores/types').OperationType =
      commandId === 'get-latest'
        ? 'download'
        : commandId === 'force-release'
          ? 'checkout'
          : commandId === 'discard'
            ? 'checkout'
            : (opType as import('../../stores/types').OperationType)

    // Create toast immediately (shows "Queued" until operation starts)
    const toastId = `${commandId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const toastMessage =
      fileCount === 1
        ? `${command.name} ${files[0]?.name || 'file'}...`
        : `${command.name} ${fileCount} file${fileCount > 1 ? 's' : ''}...`

    // Check if there are already operations running/queued - if so, this one is queued
    const isQueued = store.isOperationRunning || store.operationQueue.length > 0
    store.addProgressToast(toastId, toastMessage, fileCount, isQueued)

    // Set processing state (spinners) immediately
    store.addProcessingFoldersSync(paths, processingType)

    const operationId = store.queueOperation({
      commandId,
      type: opType,
      label: toastMessage,
      paths,
      toastId,
      fileCount,
      execute: async () => {
        // Mark toast as active (not queued anymore)
        store.setProgressToastActive(toastId)

        // Execute the actual command (pass toastId so it can update the existing toast)
        await executeCommandDirect(commandId, params, { ...options, existingToastId: toastId })
      },
    })

    // If operation was a duplicate, clean up and return early
    if (!operationId) {
      // Remove the processing state we just set (spinners)
      store.removeProcessingFolders(paths)
      // Remove the progress toast we just created
      store.removeToast(toastId)

      return {
        success: true,
        message: 'Operation already in progress',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // Return result immediately
    return {
      success: true,
      message: isQueued ? 'Queued' : 'Started',
      total: 0,
      succeeded: 0,
      failed: 0,
    }
  }

  // Non-queued commands execute directly
  return executeCommandDirect(commandId, params, options)
}

/**
 * Execute a command directly (bypassing the queue)
 * This is used internally by the queue processor and for non-file-operation commands.
 */
async function executeCommandDirect<K extends CommandId>(
  commandId: K,
  params: CommandMap[K] extends Command<infer P> ? P : never,
  options?: {
    onRefresh?: (silent?: boolean) => void
    silent?: boolean
    existingToastId?: string // If provided, ProgressTracker will reuse this toast instead of creating a new one
  },
): Promise<CommandResult> {
  const command = commandRegistry.get(commandId)

  if (!command) {
    return {
      success: false,
      message: `Unknown command: ${commandId}`,
      total: 0,
      succeeded: 0,
      failed: 0,
    }
  }

  // Seeded with the queued toast (if any) because ProgressTracker adopts it rather
  // than creating its own, so it never passes through ctx.addProgressToast.
  const openToastIds = new Set<string>(
    options?.existingToastId ? [options.existingToastId] : undefined,
  )
  const ctx = buildCommandContext(
    options?.onRefresh,
    options?.existingToastId,
    options?.silent,
    openToastIds,
  )
  const startTime = Date.now()

  // Execute
  try {
    // Log user action for command execution
    const fileCount = (params as any)?.files?.length // TODO: type this
    logUserAction('file', `Command: ${commandId}`, {
      fileCount: fileCount || 0,
      commandId,
    })
    const result = await command.execute(params, ctx)

    // Add timing
    result.duration = Date.now() - startTime

    // Log command result when it indicates failure (red toast scenarios)
    if (!result.success) {
      log.warn('[Commands]', `Command ${commandId} completed with failure`, {
        commandId,
        message: result.message,
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
        errors: result.errors?.slice(0, 5), // Limit logged errors for readability
        duration: result.duration,
      })
    }

    // Record in history
    const historyEntry: CommandHistoryEntry = {
      id: `${commandId}-${Date.now()}`,
      commandId,
      params,
      result,
      timestamp: new Date(),
      userId: ctx.user?.id,
    }
    commandHistory.unshift(historyEntry)
    if (commandHistory.length > MAX_HISTORY) {
      commandHistory.pop()
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log.error('[Commands]', `Error executing ${commandId}`, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })

    // A command that throws mid-flight never reaches ProgressTracker.finish(), which
    // would leave its progress toast stuck on screen forever. Queued operations are
    // covered by processQueue's finally; direct ones (move, copy, rename) are not.
    for (const toastId of openToastIds) {
      unregisterActiveOperation(`${commandId}-${toastId}`)
      usePDMStore.getState().removeToast(toastId)
    }
    openToastIds.clear()

    ctx.addToast('error', `Command failed: ${errorMessage}`)

    return {
      success: false,
      message: errorMessage,
      total: 0,
      succeeded: 0,
      failed: 1,
      errors: [errorMessage],
      duration: Date.now() - startTime,
    }
  }
}

/**
 * Get command history
 */
export function getCommandHistory(): CommandHistoryEntry[] {
  return [...commandHistory]
}

/**
 * Clear command history
 */
export function clearCommandHistory(): void {
  commandHistory.length = 0
}

/**
 * Progress tracker helper for commands
 * Standardized file count progress (no speed, no bytes)
 * Automatically registers/unregisters with the active operations registry
 *
 * If ctx.existingToastId is provided, reuses that toast instead of creating a new one.
 * This happens when operations are queued - the toast is created immediately when queueing.
 */
export class ProgressTracker {
  private operationId: string
  private toastId: string
  private ctx: CommandContext
  private total: number
  private completed: number = 0
  private startTime: number
  private lastUpdateTime: number = 0

  constructor(
    ctx: CommandContext,
    commandId: CommandId,
    toastId: string,
    message: string,
    total: number,
  ) {
    this.ctx = ctx
    // Use existing toast from queue if available, otherwise use the provided toastId
    this.toastId = ctx.existingToastId || toastId
    this.operationId = `${commandId}-${this.toastId}`
    this.total = total
    this.startTime = Date.now()

    // Only create a new toast if we don't have an existing one from the queue
    if (!ctx.existingToastId) {
      ctx.addProgressToast(this.toastId, message, total)
    }

    // Set initial label so UI shows "0/X" immediately
    ctx.updateProgressToast(this.toastId, 0, 0, undefined, `0/${total}`)

    // Register this operation for tracking/cancellation
    registerActiveOperation(this.operationId, commandId, this.toastId, message)
  }

  /**
   * Update progress (call after each item completes)
   * Throttled to avoid excessive store updates - only updates if:
   * - 100ms has passed since last update, OR
   * - This is the last item
   */
  update(): void {
    this.completed++

    // Calculate percent
    const percent = Math.round((this.completed / this.total) * 100)
    const now = Date.now()
    const timeSinceLastUpdate = now - this.lastUpdateTime
    const isComplete = this.completed >= this.total

    // Throttle updates: only update if enough time passed or complete
    // 100ms = 10 updates/second max, which is smooth enough for UI
    if (timeSinceLastUpdate < 100 && !isComplete) {
      return
    }

    this.lastUpdateTime = now

    // Build label - simple file count format
    const label = `${this.completed}/${this.total}`

    this.ctx.updateProgressToast(this.toastId, this.completed, percent, undefined, label)
  }

  /**
   * Set a custom status message on the progress toast.
   * Useful for showing validation phases before the main progress starts.
   */
  setStatus(message: string): void {
    this.ctx.updateProgressToast(this.toastId, this.completed, 0, undefined, message)
  }

  /**
   * Check if cancelled
   */
  isCancelled(): boolean {
    return this.ctx.isProgressToastCancelled(this.toastId)
  }

  /**
   * Finish and remove toast
   */
  finish(): { duration: number } {
    // Unregister from active operations
    unregisterActiveOperation(this.operationId)

    this.ctx.removeToast(this.toastId)
    const duration = Date.now() - this.startTime
    return { duration }
  }
}
