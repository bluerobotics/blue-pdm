/**
 * Checkout Command
 * 
 * Check out files for editing. This:
 * 1. Locks the file on the server
 * 2. Makes the local file writable
 */

import type { Command, CheckoutParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { checkoutFile } from '../../supabase'

export const checkoutCommand: Command<CheckoutParams> = {
  id: 'checkout',
  name: 'Check Out',
  description: 'Check out files for editing',
  aliases: ['co'],
  usage: 'checkout <path> [--recursive]',
  
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
    
    // Get synced files that can be checked out
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const checkoutable = syncedFiles.filter(f => !f.pdmData?.checked_out_by)
    
    if (checkoutable.length === 0) {
      // Check if all are already checked out
      if (syncedFiles.length > 0 && syncedFiles.every(f => f.pdmData?.checked_out_by)) {
        return 'All files are already checked out'
      }
      return 'No synced files to check out'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    
    // Get files that can be checked out
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckout = syncedFiles.filter(f => !f.pdmData?.checked_out_by)
    
    if (filesToCheckout.length === 0) {
      return {
        success: true,
        message: 'No files to check out',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track folders being processed (for spinner display) - batch add
    const foldersBeingProcessed = files
      .filter(f => f.isDirectory)
      .map(f => f.relativePath)
    ctx.addProcessingFolders(foldersBeingProcessed)
    
    // Yield to event loop so React can render spinners before starting operation
    await new Promise(resolve => setTimeout(resolve, 0))
    
    // Progress tracking
    const toastId = `checkout-${Date.now()}`
    const total = filesToCheckout.length
    const progress = new ProgressTracker(
      ctx,
      'checkout',
      toastId,
      `Checking out ${total} file${total > 1 ? 's' : ''}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel, collect updates for batch store update
    const pendingUpdates: Array<{ path: string; updates: Parameters<typeof ctx.updateFileInStore>[1] }> = []
    
    const results = await Promise.all(filesToCheckout.map(async (file) => {
      try {
        const result = await checkoutFile(file.pdmData!.id, user.id)
        
        if (result.success) {
          await window.electronAPI?.setReadonly(file.path, false)
          // Queue update for batch processing
          pendingUpdates.push({
            path: file.path,
            updates: {
              pdmData: {
                ...file.pdmData!,
                checked_out_by: user.id,
                checked_out_user: { full_name: user.full_name, email: user.email, avatar_url: user.avatar_url }
              }
            }
          })
          progress.update()
          return { success: true }
        } else {
          progress.update()
          return { success: false, error: result.error || 'Unknown error' }
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
      ctx.addToast('warning', `Checked out ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Checked out ${succeeded}/${total} files` : `Checked out ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

