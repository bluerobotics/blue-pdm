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

// ============================================
// Command Context - Injected into commands
// ============================================

export interface CommandContext {
  // Auth & Organization
  user: User | null
  organization: Organization | null
  
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
  removeFilesFromStore: (paths: string[]) => void
  addProcessingFolder: (path: string) => void
  removeProcessingFolder: (path: string) => void
  
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

// ============================================
// Command Definition
// ============================================

export type CommandId = 
  | 'checkout'
  | 'checkin'
  | 'sync'
  | 'download'
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
export function getSyncedFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  for (const item of selection) {
    if (item.isDirectory) {
      // Get all synced files inside the folder
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const syncedInFolder = filesInFolder.filter(f => 
        f.pdmData?.id && f.diffStatus !== 'cloud'
      )
      result.push(...syncedInFolder)
    } else if (item.pdmData?.id && item.diffStatus !== 'cloud') {
      result.push(item)
    }
  }
  
  // Deduplicate by path
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Helper to get unsynced files from selection
export function getUnsyncedFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  for (const item of selection) {
    if (item.isDirectory) {
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const unsyncedInFolder = filesInFolder.filter(f => 
        !f.pdmData || f.diffStatus === 'added'
      )
      result.push(...unsyncedInFolder)
    } else if (!item.pdmData || item.diffStatus === 'added') {
      result.push(item)
    }
  }
  
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Helper to get cloud-only files from selection
export function getCloudOnlyFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  for (const item of selection) {
    if (item.isDirectory) {
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const cloudOnly = filesInFolder.filter(f => f.diffStatus === 'cloud')
      result.push(...cloudOnly)
    } else if (item.diffStatus === 'cloud' && item.pdmData) {
      result.push(item)
    }
  }
  
  return [...new Map(result.map(f => [f.path, f])).values()]
}

// Format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

// Format speed
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${bytesPerSec.toFixed(0)} B/s`
}

// Build full path from vault path and relative path
export function buildFullPath(vaultPath: string, relativePath: string): string {
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

// Get parent directory from a path
export function getParentDir(fullPath: string): string {
  const lastSlash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
  return lastSlash > 0 ? fullPath.substring(0, lastSlash) : fullPath
}

