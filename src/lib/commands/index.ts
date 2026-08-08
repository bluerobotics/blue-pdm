/**
 * Command System
 *
 * Centralized command system for all PDM operations.
 *
 * Usage:
 * ```typescript
 * import { executeCommand } from '../lib/commands'
 *
 * // Execute a command
 * await executeCommand('checkout', { files: selectedFiles })
 *
 * // With refresh callback
 * await executeCommand('download', { files: selectedFiles }, { onRefresh: handleRefresh })
 * ```
 */

// Re-export types
export * from './types'

// Re-export terminal command registry
export {
  registerTerminalCommand,
  getTerminalCommandHandler,
  getAllTerminalCommands,
  getTerminalCommandsByCategory,
  isTerminalCommandRegistered,
  getAllTerminalCommandAliases,
  getTerminalCommandMeta,
  type CommandHandler,
  type CommandMeta,
  type CommandCategory,
} from './registry'

// Re-export executor
export {
  executeCommand,
  getCommand,
  getAllCommands,
  buildCommandContext,
  getCommandHistory,
  clearCommandHistory,
  ProgressTracker,
  // Active operation management
  getActiveOperations,
  hasActiveOperations,
  cancelAllOperations,
  cancelOperation,
  // Command confirmation dialog
  resolveCommandConfirm,
} from './executor'

// Import handlers
import { registerCommand } from './executor'
import { checkoutCommand } from './handlers/checkout'
import { checkinCommand } from './handlers/checkin'
import { syncCommand } from './handlers/sync'
import { downloadCommand } from './handlers/download'
import { getLatestCommand } from './handlers/getLatest'
import { deleteLocalCommand, deleteServerCommand } from './handlers/delete'
import { discardCommand } from './handlers/discard'
import { discardOrphanedCommand } from './handlers/discardOrphaned'
import { forceReleaseCommand } from './handlers/forceRelease'
import {
  openCommand,
  showInExplorerCommand,
  pinCommand,
  unpinCommand,
  ignoreCommand,
} from './handlers/misc'
import {
  renameCommand,
  moveCommand,
  copyCommand,
  newFolderCommand,
  mergeFolderCommand,
} from './handlers/fileOps'
import { syncMetadataCommand } from './handlers/syncMetadata'
import { extractReferencesCommand } from './handlers/extractReferences'
import {
  bulkDownloadAssemblyCommand,
  bulkCheckoutAssemblyCommand,
  bulkCheckinAssemblyCommand,
  bulkDeleteAssemblyCommand,
} from './handlers/bulkAssembly'
import { packAndGoCommand } from './handlers/packAndGo'
import { matchGhostFileCommand } from './handlers/matchGhostFile'

// Register all commands on module load
function initializeCommands() {
  // Core PDM operations
  registerCommand('checkout', checkoutCommand)
  registerCommand('checkin', checkinCommand)
  registerCommand('sync', syncCommand)
  registerCommand('download', downloadCommand)
  registerCommand('get-latest', getLatestCommand)
  registerCommand('delete-local', deleteLocalCommand)
  registerCommand('delete-server', deleteServerCommand)
  registerCommand('discard', discardCommand)
  registerCommand('discard-orphaned', discardOrphanedCommand)
  registerCommand('force-release', forceReleaseCommand)

  // File operations
  registerCommand('open', openCommand)
  registerCommand('show-in-explorer', showInExplorerCommand)
  registerCommand('pin', pinCommand)
  registerCommand('unpin', unpinCommand)
  registerCommand('ignore', ignoreCommand)

  // File management (rename, move, copy, new folder, merge folder)
  registerCommand('rename', renameCommand)
  registerCommand('move', moveCommand)
  registerCommand('copy', copyCommand)
  registerCommand('new-folder', newFolderCommand)
  registerCommand('merge-folder', mergeFolderCommand)

  // SolidWorks specific
  registerCommand('sync-metadata', syncMetadataCommand)
  registerCommand('extract-references', extractReferencesCommand)

  // Bulk assembly operations
  registerCommand('bulk-download-assembly', bulkDownloadAssemblyCommand)
  registerCommand('bulk-checkout-assembly', bulkCheckoutAssemblyCommand)
  registerCommand('bulk-checkin-assembly', bulkCheckinAssemblyCommand)
  registerCommand('bulk-delete-assembly', bulkDeleteAssemblyCommand)
  registerCommand('pack-and-go', packAndGoCommand)

  // Ghost file resolution
  registerCommand('match-ghost-file', matchGhostFileCommand)
}

// Initialize on import
initializeCommands()

// ============================================
// Convenience exports for common operations
// ============================================

import type { LocalFile } from '../../stores/pdmStore'
import { executeCommand } from './executor'

/**
 * Check out files for editing
 */
export async function checkout(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('checkout', { files }, { onRefresh })
}

/**
 * Check in files after editing
 */
export async function checkin(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('checkin', { files }, { onRefresh })
}

/**
 * Upload new files to server (first check-in)
 */
export async function sync(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('sync', { files }, { onRefresh })
}

/**
 * Download cloud files to local vault
 */
export async function download(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('download', { files }, { onRefresh })
}

/**
 * Remove local copies (keeps server version)
 */
export async function deleteLocal(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('delete-local', { files }, { onRefresh })
}

/**
 * Delete from server (moves to trash)
 */
export async function deleteServer(
  files: LocalFile[],
  deleteLocalToo: boolean = true,
  onRefresh?: (silent?: boolean) => void,
) {
  return executeCommand('delete-server', { files, deleteLocal: deleteLocalToo }, { onRefresh })
}

/**
 * Discard local changes and revert to server version
 */
export async function discard(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('discard', { files }, { onRefresh })
}

/**
 * Discard orphaned files (local files that no longer exist on server)
 */
export async function discardOrphaned(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('discard-orphaned', { files }, { onRefresh })
}

/**
 * Get latest version from server (for outdated files)
 */
export async function getLatest(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('get-latest', { files }, { onRefresh })
}

/**
 * Admin: Force release checkout
 */
export async function forceRelease(files: LocalFile[], onRefresh?: (silent?: boolean) => void) {
  return executeCommand('force-release', { files }, { onRefresh })
}

/**
 * Sync metadata between BluePLM and SolidWorks files.
 * - For drawings: PULL (reads from SW file, updates pendingMetadata)
 * - For parts/assemblies: PUSH (writes from pendingMetadata to SW file)
 * Only works on files checked out by the current user.
 */
export async function syncMetadata(
  files: LocalFile[],
  onRefresh?: (silent?: boolean) => void,
  options?: { omitRevisionOnModels?: boolean },
) {
  return executeCommand(
    'sync-metadata',
    { files, omitRevisionOnModels: options?.omitRevisionOnModels },
    { onRefresh },
  )
}

/**
 * Extract and store assembly references for Contains/Where-Used queries.
 * Useful for importing existing vaults with assemblies.
 */
export async function extractReferences(
  files: LocalFile[],
  onRefresh?: (silent?: boolean) => void,
) {
  return executeCommand('extract-references', { files }, { onRefresh })
}

// ============================================
// Cancellation
// ============================================

import { cancelAllOperations, hasActiveOperations, getActiveOperations } from './executor'

/**
 * Cancel all running file operations
 * Returns the number of operations that were cancelled
 */
export function cancel(): number {
  return cancelAllOperations()
}

/**
 * Check if there are any operations that can be cancelled
 */
export function canCancel(): boolean {
  return hasActiveOperations()
}

/**
 * Get descriptions of all running operations
 */
export function getRunningOperations(): string[] {
  return getActiveOperations().map((op) => op.description)
}
