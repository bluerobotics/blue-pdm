/**
 * Discard Command
 * 
 * Discard local changes and revert to the server version.
 * Downloads the server file and releases the checkout.
 */

import type { Command, DiscardParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { checkinFile } from '../../supabase'
import { getDownloadUrl } from '../../storage'

export const discardCommand: Command<DiscardParams> = {
  id: 'discard',
  name: 'Discard Changes',
  description: 'Discard local changes and revert to server version',
  aliases: ['revert', 'reset'],
  usage: 'discard <path>',
  
  validate({ files }, ctx) {
    if (!ctx.user) {
      return 'Please sign in first'
    }
    
    if (!ctx.organization) {
      return 'No organization connected'
    }
    
    if (!ctx.vaultPath) {
      return 'No vault path configured'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const myCheckedOutFiles = syncedFiles.filter(f => f.pdmData?.checked_out_by === ctx.user?.id)
    
    if (myCheckedOutFiles.length === 0) {
      return 'No files checked out by you to discard'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    const organization = ctx.organization!
    
    // Get files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToDiscard = syncedFiles.filter(f => f.pdmData?.checked_out_by === user.id)
    
    if (filesToDiscard.length === 0) {
      return {
        success: true,
        message: 'No files to discard',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track folders being processed
    const foldersBeingProcessed = files
      .filter(f => f.isDirectory)
      .map(f => f.relativePath)
    foldersBeingProcessed.forEach(p => ctx.addProcessingFolder(p))
    
    // Progress tracking
    const toastId = `discard-${Date.now()}`
    const total = filesToDiscard.length
    const progress = new ProgressTracker(
      ctx,
      'discard',
      toastId,
      `Discarding changes for ${total} file${total > 1 ? 's' : ''}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel
    const results = await Promise.all(filesToDiscard.map(async (file) => {
      try {
        const contentHash = file.pdmData?.content_hash
        if (!contentHash) {
          progress.update()
          return { success: false, error: `${file.name}: No content hash` }
        }
        
        const { url, error: urlError } = await getDownloadUrl(organization.id, contentHash)
        if (urlError || !url) {
          progress.update()
          return { success: false, error: `${file.name}: ${urlError || 'Failed to get download URL'}` }
        }
        
        await window.electronAPI?.setReadonly(file.path, false)
        const writeResult = await window.electronAPI?.downloadUrl(url, file.path)
        if (!writeResult?.success) {
          progress.update()
          return { success: false, error: `${file.name}: Download failed` }
        }
        
        const result = await checkinFile(file.pdmData!.id, user.id)
        if (!result.success) {
          progress.update()
          return { success: false, error: `${file.name}: Failed to release checkout` }
        }
        
        await window.electronAPI?.setReadonly(file.path, true)
        ctx.updateFileInStore(file.path, {
          pdmData: { ...file.pdmData!, checked_out_by: null, checked_out_user: null },
          localHash: contentHash,
          diffStatus: undefined,
          localActiveVersion: undefined
        })
        progress.update()
        return { success: true }
        
      } catch (err) {
        progress.update()
        return { success: false, error: `${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}` }
      }
    }))
    
    // Count results
    for (const result of results) {
      if (result.success) succeeded++
      else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }
    
    // Clean up
    foldersBeingProcessed.forEach(p => ctx.removeProcessingFolder(p))
    const { duration } = progress.finish()
    ctx.onRefresh?.(true)
    
    // Show result
    if (failed > 0) {
      ctx.addToast('warning', `Discarded ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Discarded ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Discarded ${succeeded}/${total} files` : `Discarded ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

