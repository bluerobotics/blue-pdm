/**
 * Sync Command (First Check-In)
 * 
 * Upload new local files to the server for the first time.
 * This syncs files that exist locally but haven't been added to PDM yet.
 */

import type { Command, SyncParams, CommandResult } from '../types'
import { getUnsyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { syncFile } from '../../supabase'

export const syncCommand: Command<SyncParams> = {
  id: 'sync',
  name: 'First Check In',
  description: 'Upload new files to the server for the first time',
  aliases: ['upload', 'add'],
  usage: 'sync <path> [--recursive]',
  
  validate({ files }, ctx) {
    if (!ctx.user) {
      return 'Please sign in first'
    }
    
    if (!ctx.organization) {
      return 'No organization connected'
    }
    
    if (!ctx.activeVaultId) {
      return 'No vault selected'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get unsynced files
    const unsyncedFiles = getUnsyncedFilesFromSelection(ctx.files, files)
    
    if (unsyncedFiles.length === 0) {
      return 'No unsynced files to upload'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    const organization = ctx.organization!
    const activeVaultId = ctx.activeVaultId!
    
    // Get unsynced files
    const filesToSync = getUnsyncedFilesFromSelection(ctx.files, files)
    
    if (filesToSync.length === 0) {
      return {
        success: true,
        message: 'No files to sync',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track folders being processed
    const foldersBeingProcessed = files
      .filter(f => f.isDirectory)
      .map(f => f.relativePath)
    ctx.addProcessingFolders(foldersBeingProcessed)
    
    // Yield to event loop so React can render spinners before starting operation
    await new Promise(resolve => setTimeout(resolve, 0))
    
    const total = filesToSync.length
    
    // Progress tracking
    const toastId = `sync-${Date.now()}`
    const progress = new ProgressTracker(
      ctx,
      'sync',
      toastId,
      `Uploading ${total} file${total > 1 ? 's' : ''}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel, collect updates for batch store update
    const pendingUpdates: Array<{ path: string; updates: Parameters<typeof ctx.updateFileInStore>[1] }> = []
    
    const results = await Promise.all(filesToSync.map(async (file) => {
      try {
        const readResult = await window.electronAPI?.readFile(file.path)
        
        // Allow empty files (data can be empty string, but hash should always exist)
        if (!readResult?.success || readResult.data === undefined || !readResult.hash) {
          progress.update()
          return { success: false, error: `Failed to read ${file.name}` }
        }
        
        const { error, file: syncedFile } = await syncFile(
          organization.id, activeVaultId, user.id,
          file.relativePath, file.name, file.extension, file.size,
          readResult.hash, readResult.data
        )
        
        if (error || !syncedFile) {
          progress.update()
          const errorMsg = error instanceof Error ? error.message : (typeof error === 'object' && error !== null ? (error as any).message || String(error) : String(error || 'Upload failed'))
          return { success: false, error: `${file.name}: ${errorMsg}` }
        }
        
        await window.electronAPI?.setReadonly(file.path, true)
        // Queue update for batch processing
        pendingUpdates.push({
          path: file.path,
          updates: { pdmData: syncedFile, localHash: readResult.hash, diffStatus: undefined }
        })
        progress.update()
        return { success: true }
        
      } catch (err) {
        progress.update()
        return { success: false, error: `${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}` }
      }
    }))
    
    // Apply all store updates in a single batch (avoids N re-renders)
    if (pendingUpdates.length > 0) {
      ctx.updateFilesInStore(pendingUpdates)
    }
    
    // Count results
    for (const result of results) {
      if (result.success) succeeded++
      else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }
    
    // Clean up - batch remove
    ctx.removeProcessingFolders(foldersBeingProcessed)
    const { duration } = progress.finish()
    
    // Show result
    if (failed > 0) {
      ctx.addToast('warning', `Synced ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Synced ${succeeded} file${succeeded > 1 ? 's' : ''} to cloud`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Synced ${succeeded}/${total} files` : `Synced ${succeeded} file${succeeded > 1 ? 's' : ''} to cloud`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

