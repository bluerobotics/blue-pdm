/**
 * Force Release Command (Admin Only)
 * 
 * Immediately release the checkout lock on files checked out by others.
 * The server version stays as-is, user's local changes are orphaned.
 */

import type { Command, ForceReleaseParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { adminForceDiscardCheckout } from '../../supabase'

export const forceReleaseCommand: Command<ForceReleaseParams> = {
  id: 'force-release',
  name: 'Force Release',
  description: 'Admin: Force release checkout lock on files checked out by others',
  aliases: ['force-unlock'],
  usage: 'force-release <path>',
  
  validate({ files }, ctx) {
    if (!ctx.user) {
      return 'Please sign in first'
    }
    
    if (ctx.user.role !== 'admin') {
      return 'Admin privileges required'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get files checked out by others
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const checkedOutByOthers = syncedFiles.filter(f => 
      f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== ctx.user?.id
    )
    
    if (checkedOutByOthers.length === 0) {
      return 'No files checked out by others'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    
    // Get files checked out by others
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToRelease = syncedFiles.filter(f => 
      f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user.id
    )
    
    if (filesToRelease.length === 0) {
      return {
        success: true,
        message: 'No files to force release',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Progress tracking
    const toastId = `force-release-${Date.now()}`
    const total = filesToRelease.length
    const startTime = Date.now()
    
    ctx.addProgressToast(toastId, `Force releasing ${total} checkout${total > 1 ? 's' : ''}...`, total)
    
    let completedCount = 0
    
    const updateProgress = () => {
      completedCount++
      const percent = Math.round((completedCount / total) * 100)
      ctx.updateProgressToast(toastId, completedCount, percent, undefined, `${completedCount}/${total}`)
    }
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel
    const results = await Promise.all(filesToRelease.map(async (file) => {
      try {
        const result = await adminForceDiscardCheckout(file.pdmData!.id, user.id)
        
        if (result.success) {
          // Update store
          ctx.updateFileInStore(file.path, {
            pdmData: {
              ...file.pdmData!,
              checked_out_by: null,
              checked_out_user: null
            }
          })
          
          updateProgress()
          return { success: true }
        } else {
          updateProgress()
          return { success: false, error: result.error || 'Force release failed' }
        }
      } catch (err) {
        updateProgress()
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: `${file.name}: ${errorMsg}` }
      }
    }))
    
    // Count results
    for (const result of results) {
      if (result.success) {
        succeeded++
      } else {
        failed++
        if (result.error) {
          errors.push(result.error)
        }
      }
    }
    
    // Clean up
    ctx.removeToast(toastId)
    
    const duration = Date.now() - startTime
    
    // Refresh file list
    ctx.onRefresh?.(true)
    
    // Show result toast
    if (failed > 0) {
      ctx.addToast('warning', `Force released ${succeeded}/${total} checkouts (${failed} failed)`)
    } else {
      ctx.addToast('success', `Force released ${succeeded} checkout${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0
        ? `Force released ${succeeded}/${total} checkouts`
        : `Force released ${succeeded} checkout${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

