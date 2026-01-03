/**
 * File Operations Commands
 * 
 * Commands: rename, move, copy, new-folder
 * These are registered commands for programmatic use.
 */

import type { Command, RenameParams, MoveParams, CopyParams, NewFolderParams, CommandResult } from '../types'
import { ProgressTracker } from '../executor'
import { updateFilePath, updateFolderPath } from '../../supabase'

/**
 * Rename Command - Rename a file or folder
 */
export const renameCommand: Command<RenameParams> = {
  id: 'rename',
  name: 'Rename',
  description: 'Rename a file or folder',
  aliases: ['ren'],
  usage: 'rename <old-name> <new-name>',
  
  validate({ file, newName }) {
    if (!file) {
      return 'No file selected'
    }
    
    if (!newName || newName.trim() === '') {
      return 'New name cannot be empty'
    }
    
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(newName)) {
      return 'Name contains invalid characters'
    }
    
    return null
  },
  
  async execute({ file, newName }, ctx): Promise<CommandResult> {
    try {
      // Rename locally first
      const oldPath = file.path
      const sep = file.path.includes('\\') ? '\\' : '/'
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf(sep))
      const newPath = `${parentDir}${sep}${newName}`
      
      const renameResult = await window.electronAPI?.renameItem(oldPath, newPath)
      if (!renameResult?.success) {
        return {
          success: false,
          message: renameResult?.error || 'Failed to rename locally',
          total: 1,
          succeeded: 0,
          failed: 1
        }
      }
      
      // For synced files, update server path
      if (file.pdmData?.id) {
        const oldRelPath = file.relativePath
        const relParentDir = oldRelPath.substring(0, oldRelPath.lastIndexOf('/'))
        const newRelPath = relParentDir ? `${relParentDir}/${newName}` : newName
        
        if (file.isDirectory) {
          await updateFolderPath(oldRelPath, newRelPath)
        } else {
          await updateFilePath(file.pdmData.id, newRelPath)
        }
      }
      
      ctx.addToast('success', `Renamed to ${newName}`)
      ctx.onRefresh?.(true)
      
      return {
        success: true,
        message: `Renamed to ${newName}`,
        total: 1,
        succeeded: 1,
        failed: 0
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
  }
}

/**
 * Move Command - Move files to a new location
 */
export const moveCommand: Command<MoveParams> = {
  id: 'move',
  name: 'Move',
  description: 'Move files to a new location',
  aliases: ['mv'],
  usage: 'move <source...> <destination>',
  
  validate({ files, targetFolder }) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    if (targetFolder === undefined) {
      return 'No target folder specified'
    }
    
    return null
  },
  
  async execute({ files, targetFolder }, ctx): Promise<CommandResult> {
    const toastId = `move-${Date.now()}`
    const total = files.length
    const progress = new ProgressTracker(ctx, 'move', toastId, `Moving ${total} file${total > 1 ? 's' : ''}...`, total)
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    for (const file of files) {
      try {
        // Move locally
        const sep = file.path.includes('\\') ? '\\' : '/'
        const vaultPath = ctx.vaultPath || ''
        const newPath = targetFolder 
          ? `${vaultPath}${sep}${targetFolder.replace(/\//g, sep)}${sep}${file.name}`
          : `${vaultPath}${sep}${file.name}`
        
        const moveResult = await window.electronAPI?.renameItem(file.path, newPath)
        if (!moveResult?.success) {
          failed++
          errors.push(`${file.name}: ${moveResult?.error || 'Failed to move'}`)
          progress.update()
          continue
        }
        
        // Update server if synced
        if (file.pdmData?.id) {
          const newRelPath = targetFolder ? `${targetFolder}/${file.name}` : file.name
          if (file.isDirectory) {
            await updateFolderPath(file.relativePath, newRelPath)
          } else {
            await updateFilePath(file.pdmData.id, newRelPath)
          }
        }
        
        succeeded++
      } catch (err) {
        failed++
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
      progress.update()
    }
    
    const { duration } = progress.finish()
    
    if (failed > 0) {
      ctx.addToast('error', `Moved ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Moved ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    ctx.onRefresh?.(true)
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Moved ${succeeded}/${total} files` : `Moved ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

/**
 * Copy Command - Copy files to a new location
 */
export const copyCommand: Command<CopyParams> = {
  id: 'copy',
  name: 'Copy',
  description: 'Copy files to a new location',
  aliases: ['cp'],
  usage: 'copy <source...> <destination>',
  
  validate({ files, targetFolder }) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    if (targetFolder === undefined) {
      return 'No target folder specified'
    }
    
    return null
  },
  
  async execute({ files, targetFolder }, ctx): Promise<CommandResult> {
    const toastId = `copy-${Date.now()}`
    const total = files.length
    const progress = new ProgressTracker(ctx, 'copy', toastId, `Copying ${total} file${total > 1 ? 's' : ''}...`, total)
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    for (const file of files) {
      try {
        // Copy locally
        const sep = file.path.includes('\\') ? '\\' : '/'
        const vaultPath = ctx.vaultPath || ''
        const newPath = targetFolder 
          ? `${vaultPath}${sep}${targetFolder.replace(/\//g, sep)}${sep}${file.name}`
          : `${vaultPath}${sep}${file.name}`
        
        const copyResult = await window.electronAPI?.copyFile(file.path, newPath)
        if (!copyResult?.success) {
          failed++
          errors.push(`${file.name}: ${copyResult?.error || 'Failed to copy'}`)
        } else {
          succeeded++
        }
      } catch (err) {
        failed++
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
      progress.update()
    }
    
    const { duration } = progress.finish()
    
    if (failed > 0) {
      ctx.addToast('error', `Copied ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Copied ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    ctx.onRefresh?.(true)
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Copied ${succeeded}/${total} files` : `Copied ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

/**
 * New Folder Command - Create a new folder
 */
export const newFolderCommand: Command<NewFolderParams> = {
  id: 'new-folder',
  name: 'New Folder',
  description: 'Create a new folder',
  aliases: ['mkdir', 'md'],
  usage: 'mkdir <name>',
  
  validate({ folderName }, ctx) {
    if (!folderName || folderName.trim() === '') {
      return 'Folder name cannot be empty'
    }
    
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(folderName)) {
      return 'Folder name contains invalid characters'
    }
    
    if (!ctx.vaultPath) {
      return 'No vault connected'
    }
    
    return null
  },
  
  async execute({ parentPath, folderName }, ctx): Promise<CommandResult> {
    try {
      const vaultPath = ctx.vaultPath!
      const sep = vaultPath.includes('\\') ? '\\' : '/'
      const fullPath = parentPath 
        ? `${vaultPath}${sep}${parentPath.replace(/\//g, sep)}${sep}${folderName}`
        : `${vaultPath}${sep}${folderName}`
      
      const result = await window.electronAPI?.createFolder(fullPath)
      if (!result?.success) {
        return {
          success: false,
          message: result?.error || 'Failed to create folder',
          total: 1,
          succeeded: 0,
          failed: 1
        }
      }
      
      ctx.addToast('success', `Created folder: ${folderName}`)
      ctx.onRefresh?.(true)
      
      return {
        success: true,
        message: `Created folder: ${folderName}`,
        total: 1,
        succeeded: 1,
        failed: 0
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
  }
}
