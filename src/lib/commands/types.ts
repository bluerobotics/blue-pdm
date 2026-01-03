/**
 * Command System Types
 * 
 * Centralized command system for all PDM operations.
 * This enables consistent behavior across:
 * - Right-click context menus (FileContextMenu, ExplorerView)
 * - Inline buttons (FileBrowser rows)
 * - Sidebar views (CheckoutView)
 * - Future: Terminal/CLI interface
 * - Future: External API for add-ins
 */

import type { LocalFile as StoreLocalFile, ToastType } from '../../stores/pdmStore'
import type { User, Organization } from '../../types/pdm'

// Re-export LocalFile for use by handlers
export type LocalFile = StoreLocalFile

// Re-export CommandCategory from registry for external use
export type { CommandCategory } from './registry'

// ============================================
// Command Context - Injected into commands
// ============================================

export interface CommandContext {
  // Auth & Organization
  user: User | null
  organization: Organization | null
  isOfflineMode: boolean
  getEffectiveRole: () => string
  
  // Vault info
  vaultPath: string | null
  activeVaultId: string | null
  
  // All files in the vault (for folder operations)
  files: LocalFile[]
  
  // Toast notifications
  addToast: (type: ToastType, message: string, duration?: number) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number, speed?: string, label?: string) => void
  removeToast: (id: string) => void
  isProgressToastCancelled: (id: string) => boolean
  
  // Store updates
  updateFileInStore: (path: string, updates: Partial<LocalFile>) => void
  updateFilesInStore: (updates: Array<{ path: string; updates: Partial<LocalFile> }>) => void  // Batch update
  removeFilesFromStore: (paths: string[]) => void
  addProcessingFolder: (path: string) => void
  addProcessingFolders: (paths: string[]) => void  // Batch add (single state update)
  removeProcessingFolder: (path: string) => void
  removeProcessingFolders: (paths: string[]) => void  // Batch remove (single state update)
  
  // Auto-download exclusion (for tracking intentionally removed local copies)
  addAutoDownloadExclusion: (relativePath: string) => void
  
  // Refresh callback
  onRefresh?: (silent?: boolean) => void
}

// ============================================
// Command Result
// ============================================

export interface CommandResult {
  success: boolean
  message: string
  
  // Counts
  total: number
  succeeded: number
  failed: number
  
  // Optional details
  details?: string[]
  errors?: string[]
  
  // Timing
  duration?: number  // milliseconds
  speed?: string     // e.g., "15.3 MB/s"
}

// ============================================
// Command Parameters
// ============================================

// Base params - all commands get target files
export interface BaseCommandParams {
  files: LocalFile[]
}

// Checkout
export interface CheckoutParams extends BaseCommandParams {}

// Checkin with optional new content hash
export interface CheckinParams extends BaseCommandParams {
  // If provided, will upload new content (for modified files)
  uploadContent?: boolean
  // Optional comment for the checkin
  comment?: string
}

// First check-in / Sync (upload new files to server)
export interface SyncParams extends BaseCommandParams {}

// Download cloud files
export interface DownloadParams extends BaseCommandParams {}

// Delete local copies (keeps server version)
export interface DeleteLocalParams extends BaseCommandParams {}

// Delete from server (soft delete - moves to trash)
export interface DeleteServerParams extends BaseCommandParams {
  // Also delete local copies
  deleteLocal?: boolean
}

// Discard changes (revert to server version)
export interface DiscardParams extends BaseCommandParams {}

// Get latest version from server (for outdated files)
export interface GetLatestParams extends BaseCommandParams {}

// Force release checkout (admin only)
export interface ForceReleaseParams extends BaseCommandParams {}

// Rename file or folder
export interface RenameParams {
  file: LocalFile
  newName: string
}

// Move files to new location
export interface MoveParams extends BaseCommandParams {
  targetFolder: string
}

// Copy files
export interface CopyParams extends BaseCommandParams {
  targetFolder: string
}

// Create new folder
export interface NewFolderParams {
  parentPath: string
  folderName: string
}

// Pin/Unpin
export interface PinParams {
  file: LocalFile
  vaultId: string
  vaultName: string
}

export interface UnpinParams {
  path: string
}

// Ignore patterns
export interface IgnoreParams {
  vaultId: string
  pattern: string
}

// Open file/folder
export interface OpenParams {
  file: LocalFile
}

// Show in Explorer/Finder
export interface ShowInExplorerParams {
  path: string
}

// Sync SolidWorks metadata
export interface SyncSwMetadataParams extends BaseCommandParams {}

// ============================================
// Command Definition
// ============================================

export type CommandId = 
  | 'checkout'
  | 'checkin'
  | 'sync'
  | 'download'
  | 'get-latest'
  | 'delete-local'
  | 'delete-server'
  | 'discard'
  | 'force-release'
  | 'rename'
  | 'move'
  | 'copy'
  | 'new-folder'
  | 'pin'
  | 'unpin'
  | 'ignore'
  | 'open'
  | 'show-in-explorer'
  | 'sync-sw-metadata'

export interface Command<TParams = unknown> {
  // Identifier
  id: CommandId
  name: string
  description: string
  
  // CLI support
  aliases?: string[]
  usage?: string  // e.g., "checkout <path> [--recursive]"
  
  // Validation - returns error message or null if valid
  validate: (params: TParams, ctx: CommandContext) => string | null
  
  // Execution
  execute: (params: TParams, ctx: CommandContext) => Promise<CommandResult>
  
  // Undo support (optional)
  canUndo?: boolean
  undo?: (params: TParams, ctx: CommandContext) => Promise<CommandResult>
}

// Type-safe command map
export type CommandMap = {
  'checkout': Command<CheckoutParams>
  'checkin': Command<CheckinParams>
  'sync': Command<SyncParams>
  'download': Command<DownloadParams>
  'get-latest': Command<GetLatestParams>
  'delete-local': Command<DeleteLocalParams>
  'delete-server': Command<DeleteServerParams>
  'discard': Command<DiscardParams>
  'force-release': Command<ForceReleaseParams>
  'rename': Command<RenameParams>
  'move': Command<MoveParams>
  'copy': Command<CopyParams>
  'new-folder': Command<NewFolderParams>
  'pin': Command<PinParams>
  'unpin': Command<UnpinParams>
  'ignore': Command<IgnoreParams>
  'open': Command<OpenParams>
  'show-in-explorer': Command<ShowInExplorerParams>
  'sync-sw-metadata': Command<SyncSwMetadataParams>
}

// ============================================
// Utility Types
// ============================================

// Helper to get files in a folder (including nested)
export function getFilesInFolder(files: LocalFile[], folderPath: string): LocalFile[] {
  const normalizedFolder = folderPath.replace(/\\/g, '/')
  return files.filter(f => {
    if (f.isDirectory) return false
    const normalizedPath = f.relativePath.replace(/\\/g, '/')
    return normalizedPath.startsWith(normalizedFolder + '/')
  })
}

// Helper to get synced files from selection (handles folders)
// "Synced" means files that exist BOTH locally AND on server
// Excludes: cloud, cloud_new, deleted (these only exist on server, not locally)
export function getSyncedFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  // Statuses that indicate file doesn't exist locally (server-only)
  const serverOnlyStatuses = ['cloud', 'cloud_new', 'deleted']
  
  for (const item of selection) {
    if (item.isDirectory) {
      // Get all synced files inside the folder
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const syncedInFolder = filesInFolder.filter(f => 
        f.pdmData?.id && !serverOnlyStatuses.includes(f.diffStatus || '')
      )
      result.push(...syncedInFolder)
    } else if (item.pdmData?.id && !serverOnlyStatuses.includes(item.diffStatus || '')) {
      // Look up fresh file from files array to get current pendingMetadata
      // (selection may have stale reference without latest metadata edits)
      const freshFile = files.find(f => f.path === item.path)
      result.push(freshFile || item)
    }
  }
  
  // Deduplicate by path
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Helper to get unsynced files from selection
// Includes both 'added' (truly new) and 'deleted_remote' (orphaned local files)
export function getUnsyncedFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  for (const item of selection) {
    if (item.isDirectory) {
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const unsyncedInFolder = filesInFolder.filter(f => 
        !f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote'
      )
      result.push(...unsyncedInFolder)
    } else if (!item.pdmData || item.diffStatus === 'added' || item.diffStatus === 'deleted_remote') {
      // Look up fresh file from files array (selection may have stale reference)
      const freshFile = files.find(f => f.path === item.path)
      result.push(freshFile || item)
    }
  }
  
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Helper to get cloud-only files from selection (includes both 'cloud' and 'cloud_new')
export function getCloudOnlyFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  for (const item of selection) {
    if (item.isDirectory) {
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const cloudOnly = filesInFolder.filter(f => f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new')
      result.push(...cloudOnly)
    } else if ((item.diffStatus === 'cloud' || item.diffStatus === 'cloud_new') && item.pdmData) {
      // Look up fresh file from files array (selection may have stale reference)
      const freshFile = files.find(f => f.path === item.path)
      result.push(freshFile || item)
    }
  }
  
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Helper to get files that can have their checkout discarded/released
// Includes BOTH:
// 1. Synced files (exist locally) checked out by user - will download server version
// 2. Deleted files (don't exist locally) checked out by user - will just release checkout
export function getDiscardableFilesFromSelection(files: LocalFile[], selection: LocalFile[], userId?: string): LocalFile[] {
  const result: LocalFile[] = []
  
  for (const item of selection) {
    if (item.isDirectory) {
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      // Include synced files and 'deleted' files checked out by user
      const discardable = filesInFolder.filter(f => 
        f.pdmData?.id && 
        f.pdmData.checked_out_by === userId &&
        (f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
      )
      result.push(...discardable)
    } else if (
      item.pdmData?.id && 
      item.pdmData.checked_out_by === userId &&
      item.diffStatus !== 'cloud' && 
      item.diffStatus !== 'cloud_new'
    ) {
      // Look up fresh file from files array (selection may have stale reference)
      const freshFile = files.find(f => f.path === item.path)
      result.push(freshFile || item)
    }
  }
  
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Format bytes to human readable
// Re-export shared utility functions for backwards compatibility
export { formatBytes, formatSpeed, buildFullPath, getParentDir } from '../utils'

