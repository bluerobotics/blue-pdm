// @ts-nocheck - Supabase type inference issues with Database generics
/**
 * Delete Commands
 * 
 * - delete-local: Remove local copies (keeps server version)
 * - delete-server: Soft delete from server (moves to trash)
 */

import type { 
  Command, 
  DeleteLocalParams, 
  DeleteServerParams, 
  CommandResult,
  LocalFile
} from '../types'
import { 
  getSyncedFilesFromSelection, 
  getUnsyncedFilesFromSelection
} from '../types'
import { checkinFile, softDeleteFile } from '../../supabase'

// ============================================
// Delete Local Command
// ============================================

export const deleteLocalCommand: Command<DeleteLocalParams> = {
  id: 'delete-local',
  name: 'Remove Local Copy',
  description: 'Remove local copies of files (keeps server version)',
  aliases: ['rm-local', 'remove'],
  usage: 'delete-local <path> [--recursive]',
  
  validate({ files }, ctx) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get synced files that exist locally
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
      .filter(f => f.diffStatus !== 'cloud')
    const unsyncedFiles = getUnsyncedFilesFromSelection(ctx.files, files)
    
    // Also check for local folders (not cloud-only)
    const localFolders = files.filter(f => f.isDirectory && f.diffStatus !== 'cloud')
    
    if (syncedFiles.length === 0 && unsyncedFiles.length === 0 && localFolders.length === 0) {
      return 'No local files to remove'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user
    const vaultPath = ctx.vaultPath
    
    // Get files to remove - both synced and unsynced local files
    const syncedLocalFiles = getSyncedFilesFromSelection(ctx.files, files)
      .filter(f => f.diffStatus !== 'cloud')
    const unsyncedLocalFiles = getUnsyncedFilesFromSelection(ctx.files, files)
      .filter(f => !f.isDirectory)
    const filesToRemove = [...syncedLocalFiles, ...unsyncedLocalFiles]
    
    // Get local folders to delete (even if empty)
    const localFolders = files.filter(f => f.isDirectory && f.diffStatus !== 'cloud')
    
    // Handle empty local folders with no files to remove
    if (filesToRemove.length === 0 && localFolders.length > 0) {
      let deleted = 0
      for (const folder of localFolders) {
        try {
          const result = await window.electronAPI?.deleteItem(folder.path)
          if (result?.success) deleted++
        } catch (err) {
          console.error('Failed to delete folder:', folder.path, err)
        }
      }
      
      ctx.onRefresh?.(true)
      
      if (deleted > 0) {
        ctx.addToast('success', `Removed ${deleted} local folder${deleted !== 1 ? 's' : ''}`)
      }
      
      return {
        success: true,
        message: `Removed ${deleted} local folder${deleted !== 1 ? 's' : ''}`,
        total: localFolders.length,
        succeeded: deleted,
        failed: localFolders.length - deleted
      }
    }
    
    if (filesToRemove.length === 0) {
      ctx.addToast('info', 'No local files to remove')
      return {
        success: true,
        message: 'No local files to remove',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track paths being processed - batch add
    const foldersBeingProcessed = files.filter(f => f.isDirectory).map(f => f.relativePath)
    const filesBeingProcessed = files.filter(f => !f.isDirectory).map(f => f.relativePath)
    const allPathsBeingProcessed = [...foldersBeingProcessed, ...filesBeingProcessed]
    ctx.addProcessingFolders(allPathsBeingProcessed)
    
    // Yield to event loop so React can render spinners before starting operation
    await new Promise(resolve => setTimeout(resolve, 0))
    
    const total = filesToRemove.length
    
    // Progress tracking with file count (not bytes)
    const toastId = `delete-${Date.now()}`
    const startTime = Date.now()
    const folderName = foldersBeingProcessed.length > 0
      ? foldersBeingProcessed[0].split('/').pop()
      : 'files'
    
    ctx.addProgressToast(toastId, `Removing ${folderName}...`, total)
    
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
    const results = await Promise.all(filesToRemove.map(async (file) => {
      try {
        // If checked out by current user, release the checkout first
        if (file.pdmData?.checked_out_by === user?.id && file.pdmData?.id) {
          await checkinFile(file.pdmData.id, user!.id)
        }
        
        // Delete the file
        const result = await window.electronAPI?.deleteItem(file.path)
        updateProgress()
        
        if (result?.success) {
          return { success: true }
        } else {
          return { success: false, error: `${file.name}: ${result?.error || 'Delete failed'}` }
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
    
    // Clean up empty parent directories (only if truly empty)
    if (vaultPath) {
      const parentDirs = new Set<string>()
      for (const file of filesToRemove) {
        let dir = file.path.substring(0, file.path.lastIndexOf('\\'))
        while (dir && dir.length > vaultPath.length) {
          parentDirs.add(dir)
          const lastSlash = dir.lastIndexOf('\\')
          if (lastSlash <= 0) break
          dir = dir.substring(0, lastSlash)
        }
      }
      
      // Also include selected folders
      for (const item of files) {
        if (item.isDirectory && item.diffStatus !== 'cloud') {
          parentDirs.add(item.path)
        }
      }
      
      // Sort by depth (deepest first)
      const sortedDirs = Array.from(parentDirs).sort((a, b) => 
        b.split('\\').length - a.split('\\').length
      )
      
      // Only delete folders that are truly empty
      for (const dir of sortedDirs) {
        try {
          const isEmpty = await window.electronAPI?.isDirEmpty(dir)
          if (isEmpty?.empty) {
            await window.electronAPI?.deleteItem(dir)
          }
        } catch {
          // Folder might not be empty or already deleted - expected
        }
      }
    }
    
    // Clean up - batch remove
    ctx.removeProcessingFolders(allPathsBeingProcessed)
    ctx.removeToast(toastId)
    
    const duration = Date.now() - startTime
    
    // Refresh file list
    ctx.onRefresh?.(true)
    
    // Show result toast - be clear this is local-only deletion
    if (failed > 0) {
      ctx.addToast('warning', `Removed ${succeeded}/${total} local files (server copies preserved)`)
    } else if (succeeded > 0) {
      ctx.addToast('success', `Removed ${succeeded} local file${succeeded > 1 ? 's' : ''} (server copies preserved)`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0
        ? `Removed ${succeeded}/${total} local files (server copies preserved)`
        : `Removed ${succeeded} local file${succeeded > 1 ? 's' : ''} (server copies preserved)`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

// ============================================
// Delete Server Command
// ============================================

export const deleteServerCommand: Command<DeleteServerParams> = {
  id: 'delete-server',
  name: 'Delete from Server',
  description: 'Soft delete files from server (moves to trash)',
  aliases: ['rm', 'delete'],
  usage: 'delete-server <path> [--local] [--recursive]',
  
  validate({ files }, ctx) {
    if (!ctx.user) {
      return 'Please sign in first'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get synced files (including cloud-only)
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const cloudOnlyFiles = files.filter(f => f.diffStatus === 'cloud' && f.pdmData?.id)
    const allFilesToDelete = [...new Map([...syncedFiles, ...cloudOnlyFiles].map(f => [f.path, f])).values()]
    
    if (allFilesToDelete.length === 0) {
      // Check for local-only folders OR empty cloud-only folders
      const hasLocalFolders = files.some(f => f.isDirectory && f.diffStatus !== 'cloud')
      const hasCloudOnlyFolders = files.some(f => f.isDirectory && f.diffStatus === 'cloud')
      if (!hasLocalFolders && !hasCloudOnlyFolders) {
        return 'No files to delete from server'
      }
    }
    
    return null
  },
  
  async execute({ files, deleteLocal = true }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    
    // Get all synced files to delete from server (including files inside folders)
    const allFilesToDelete: LocalFile[] = []
    
    for (const item of files) {
      if (item.isDirectory) {
        // Get all synced files inside the folder
        const folderPath = item.relativePath.replace(/\\/g, '/')
        const filesInFolder = ctx.files.filter(f => {
          if (f.isDirectory) return false
          if (!f.pdmData?.id) return false
          const filePath = f.relativePath.replace(/\\/g, '/')
          return filePath.startsWith(folderPath + '/')
        })
        allFilesToDelete.push(...filesInFolder)
      } else if (item.pdmData?.id) {
        allFilesToDelete.push(item)
      }
    }
    
    // Remove duplicates
    const uniqueFiles = [...new Map(allFilesToDelete.map(f => [f.path, f])).values()]
    
    // Check for local folders to delete
    const hasLocalFolders = files.some(f => f.isDirectory && f.diffStatus !== 'cloud')
    const hasCloudOnlyFolders = files.some(f => f.isDirectory && f.diffStatus === 'cloud')
    
    // Handle empty cloud-only folders
    if (uniqueFiles.length === 0 && !hasLocalFolders) {
      if (hasCloudOnlyFolders) {
        const emptyFolders = files.filter(f => f.isDirectory && f.diffStatus === 'cloud')
        const pathsToRemove = emptyFolders.map(f => f.path)
        ctx.removeFilesFromStore(pathsToRemove)
        ctx.addToast('success', `Removed ${emptyFolders.length} empty folder${emptyFolders.length !== 1 ? 's' : ''}`)
        return {
          success: true,
          message: `Removed ${emptyFolders.length} empty folder${emptyFolders.length !== 1 ? 's' : ''}`,
          total: emptyFolders.length,
          succeeded: emptyFolders.length,
          failed: 0
        }
      }
      ctx.addToast('warning', 'No files to delete from server')
      return {
        success: false,
        message: 'No files to delete from server',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // If only local folders with no server files, just delete locally
    if (uniqueFiles.length === 0 && hasLocalFolders) {
      const foldersToDelete = files.filter(f => f.isDirectory && f.diffStatus !== 'cloud')
      const folderPaths = foldersToDelete.map(f => f.relativePath)
      ctx.addProcessingFolders(folderPaths)
      
      // Yield to event loop so React can render spinners before starting operation
      await new Promise(resolve => setTimeout(resolve, 0))
      
      let deleted = 0
      for (const folder of foldersToDelete) {
        try {
          const result = await window.electronAPI?.deleteItem(folder.path)
          if (result?.success) deleted++
        } catch (err) {
          console.error('Failed to delete folder:', folder.path, err)
        }
      }
      
      ctx.removeProcessingFolders(folderPaths)
      
      if (deleted > 0) {
        ctx.addToast('success', `Removed ${deleted} local folder${deleted !== 1 ? 's' : ''} (not synced to server)`)
        ctx.onRefresh?.(true)
      }
      
      return {
        success: true,
        message: `Removed ${deleted} local folder${deleted !== 1 ? 's' : ''} (not synced to server)`,
        total: foldersToDelete.length,
        succeeded: deleted,
        failed: foldersToDelete.length - deleted
      }
    }
    
    // Track paths being processed - batch add
    const foldersSelected = files.filter(f => f.isDirectory).map(f => f.relativePath)
    const pathsBeingProcessed = uniqueFiles.map(f => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...pathsBeingProcessed, ...foldersSelected])]
    ctx.addProcessingFolders(allPathsBeingProcessed)
    
    // Yield to event loop so React can render spinners before starting operation
    await new Promise(resolve => setTimeout(resolve, 0))
    
    const toastId = `delete-server-${Date.now()}`
    ctx.addProgressToast(toastId, `Deleting...`, 2)
    
    let deletedLocal = 0
    let deletedServer = 0
    const errors: string[] = []
    
    // STEP 1: Delete ALL local items first in parallel
    if (deleteLocal) {
      const localItemsToDelete = [...files]
      if (localItemsToDelete.length > 0) {
        const localResults = await Promise.all(localItemsToDelete.map(async (item) => {
          try {
            // Release checkout if needed
            if (item.pdmData?.checked_out_by === user?.id && item.pdmData?.id) {
              await checkinFile(item.pdmData.id, user!.id).catch(() => {})
            }
            const result = await window.electronAPI?.deleteItem(item.path)
            return result?.success || false
          } catch {
            return false
          }
        }))
        deletedLocal = localResults.filter(r => r).length
      }
    }
    
    ctx.updateProgressToast(toastId, 1, 50)
    
    // STEP 2: Delete from server in parallel
    if (uniqueFiles.length > 0) {
      const serverResults = await Promise.all(uniqueFiles.map(async (file) => {
        if (!file.pdmData?.id) return false
        try {
          const result = await softDeleteFile(file.pdmData.id, user.id)
          return result.success
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`${file.name}: ${errorMsg}`)
          return false
        }
      }))
      deletedServer = serverResults.filter(r => r).length
    }
    
    ctx.updateProgressToast(toastId, 2, 100)
    
    // Clean up - batch remove
    ctx.removeProcessingFolders(allPathsBeingProcessed)
    ctx.removeToast(toastId)
    
    // Refresh file list
    ctx.onRefresh?.(true)
    
    const failed = uniqueFiles.length - deletedServer
    
    // Build descriptive message
    let message = ''
    if (deletedServer > 0 && deletedLocal > 0) {
      message = `Deleted ${deletedServer} file${deletedServer !== 1 ? 's' : ''} from server (moved to trash) and removed local copies`
    } else if (deletedServer > 0) {
      message = `Deleted ${deletedServer} file${deletedServer !== 1 ? 's' : ''} from server (moved to trash)`
    } else if (deletedLocal > 0) {
      message = `Removed ${deletedLocal} local file${deletedLocal !== 1 ? 's' : ''}`
    } else {
      message = 'No files deleted'
    }
    
    if (deletedServer > 0 || deletedLocal > 0) {
      ctx.addToast('success', message)
    }
    
    return {
      success: failed === 0,
      message,
      total: uniqueFiles.length || files.length,
      succeeded: deletedServer || deletedLocal,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      details: {
        deletedFromServer: deletedServer,
        deletedLocally: deletedLocal
      }
    }
  }
}

