/**
 * Checkin Command
 * 
 * Check in files after editing. This:
 * 1. Uploads new content if modified
 * 2. Updates metadata on server
 * 3. Releases the checkout lock
 * 4. Makes the local file read-only
 */

import type { Command, CheckinParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { checkinFile } from '../../supabase'

export const checkinCommand: Command<CheckinParams> = {
  id: 'checkin',
  name: 'Check In',
  description: 'Check in files after editing',
  aliases: ['ci'],
  usage: 'checkin <path> [--message "commit message"]',
  
  validate({ files }, ctx) {
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
    const checkinable = syncedFiles.filter(f => f.pdmData?.checked_out_by === ctx.user?.id)
    
    if (checkinable.length === 0) {
      // Check if files exist but aren't checked out by user
      if (syncedFiles.length > 0) {
        const checkedOutByOthers = syncedFiles.filter(f => 
          f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== ctx.user?.id
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
    
    // Get files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckin = syncedFiles.filter(f => f.pdmData?.checked_out_by === user.id)
    
    if (filesToCheckin.length === 0) {
      return {
        success: true,
        message: 'No files to check in',
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
    
    // Progress tracking
    const toastId = `checkin-${Date.now()}`
    const total = filesToCheckin.length
    const progress = new ProgressTracker(
      ctx,
      'checkin',
      toastId,
      `Checking in ${total} file${total > 1 ? 's' : ''}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel, collect updates for batch store update
    const pendingUpdates: Array<{ path: string; updates: Parameters<typeof ctx.updateFileInStore>[1] }> = []
    
    const results = await Promise.all(filesToCheckin.map(async (file) => {
      try {
        const wasFileMoved = file.pdmData?.file_path && 
          file.relativePath !== file.pdmData.file_path
        const wasFileRenamed = file.pdmData?.file_name && 
          file.name !== file.pdmData.file_name
        
        const readResult = await window.electronAPI?.readFile(file.path)
        
        if (readResult?.success && readResult.hash) {
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newContentHash: readResult.hash,
            newFileSize: file.size,
            newFilePath: wasFileMoved ? file.relativePath : undefined,
            newFileName: wasFileRenamed ? file.name : undefined,
            pendingMetadata: file.pendingMetadata
          })
          
          if (result.success && result.file) {
            await window.electronAPI?.setReadonly(file.path, true)
            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: { ...file.pdmData!, ...result.file, checked_out_by: null, checked_out_user: null },
                localHash: readResult.hash,
                diffStatus: undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined
              }
            })
            progress.update()
            return { success: true }
          } else {
            progress.update()
            return { success: false, error: result.error || 'Check in failed' }
          }
        } else {
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newFilePath: wasFileMoved ? file.relativePath : undefined,
            newFileName: wasFileRenamed ? file.name : undefined,
            pendingMetadata: file.pendingMetadata
          })
          
          if (result.success && result.file) {
            await window.electronAPI?.setReadonly(file.path, true)
            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: { ...file.pdmData!, ...result.file, checked_out_by: null, checked_out_user: null },
                localHash: result.file.content_hash,
                diffStatus: undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined
              }
            })
            progress.update()
            return { success: true }
          } else {
            progress.update()
            return { success: false, error: result.error || 'Check in failed' }
          }
        }
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
      ctx.addToast('warning', `Checked in ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Checked in ${succeeded}/${total} files` : `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

