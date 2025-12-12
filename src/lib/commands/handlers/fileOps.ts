/**
 * File Operations Commands
 * 
 * - rename: Rename a file or folder
 * - move: Move files to a new location
 * - copy: Copy files to a new location
 * - new-folder: Create a new folder
 */

import type { 
  Command, 
  RenameParams,
  MoveParams,
  CopyParams,
  NewFolderParams,
  CommandResult
} from '../types'
import { updateFilePath, updateFolderPath } from '../../supabase'

// ============================================
// Rename Command
// ============================================

export const renameCommand: Command<RenameParams> = {
  id: 'rename',
  name: 'Rename',
  description: 'Rename a file or folder',
  aliases: ['mv', 'ren'],
  usage: 'rename <path> <newname>',
  
  validate({ file, newName }, ctx) {
    if (!file) {
      return 'No file specified'
    }
    if (!newName || !newName.trim()) {
      return 'New name is required'
    }
    if (newName === file.name) {
      return 'New name is the same as current name'
    }
    
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(newName)) {
      return 'Name contains invalid characters'
    }
    
    // For synced files, must be checked out by current user
    if (file.pdmData && !file.isDirectory) {
      if (file.pdmData.checked_out_by !== ctx.user?.id) {
        return 'File must be checked out to rename'
      }
    }
    
    if (!ctx.vaultPath) {
      return 'No vault path'
    }
    
    return null
  },
  
  async execute({ file, newName }, ctx): Promise<CommandResult> {
    if (!ctx.vaultPath) {
      return {
        success: false,
        message: 'No vault path',
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
    
    try {
      // Build paths
      const isWindows = ctx.vaultPath.includes('\\')
      const sep = isWindows ? '\\' : '/'
      
      // Get parent directory from relative path
      const relativePath = file.relativePath.replace(/\\/g, '/')
      const parentDir = relativePath.includes('/') 
        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
        : ''
      
      const oldPath = file.path
      const newRelativePath = parentDir ? `${parentDir}/${newName}` : newName
      const newPath = `${ctx.vaultPath}${sep}${newRelativePath.replace(/\//g, sep)}`
      
      // Perform local rename
      const result = await window.electronAPI?.renameItem(oldPath, newPath)
      
      if (!result?.success) {
        ctx.addToast('error', result?.error || 'Failed to rename')
        return {
          success: false,
          message: result?.error || 'Failed to rename',
          total: 1,
          succeeded: 0,
          failed: 1
        }
      }
      
      // Update server if synced
      if (file.pdmData?.id) {
        if (file.isDirectory) {
          // Update all files in folder on server
          await updateFolderPath(file.relativePath, newRelativePath)
        } else {
          // Update single file path on server
          await updateFilePath(file.pdmData.id, newRelativePath)
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
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      ctx.addToast('error', `Failed to rename: ${errorMsg}`)
      return {
        success: false,
        message: `Failed to rename: ${errorMsg}`,
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
  }
}

// ============================================
// Move Command
// ============================================

export const moveCommand: Command<MoveParams> = {
  id: 'move',
  name: 'Move',
  description: 'Move files to a new location',
  aliases: ['mv'],
  usage: 'move <files...> <destination>',
  
  validate({ files, targetFolder }, ctx) {
    if (!files || files.length === 0) {
      return 'No files specified'
    }
    if (!targetFolder && targetFolder !== '') {
      return 'No destination folder specified'
    }
    
    // For synced files, must be checked out by current user
    for (const file of files) {
      if (file.pdmData && !file.isDirectory) {
        if (file.pdmData.checked_out_by !== ctx.user?.id) {
          return `${file.name} must be checked out to move`
        }
      }
    }
    
    if (!ctx.vaultPath) {
      return 'No vault path'
    }
    
    return null
  },
  
  async execute({ files, targetFolder }, ctx): Promise<CommandResult> {
    if (!ctx.vaultPath) {
      return {
        success: false,
        message: 'No vault path',
        total: files.length,
        succeeded: 0,
        failed: files.length
      }
    }
    
    const isWindows = ctx.vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    for (const file of files) {
      try {
        const newRelativePath = targetFolder 
          ? `${targetFolder}/${file.name}` 
          : file.name
        const destPath = `${ctx.vaultPath}${sep}${newRelativePath.replace(/\//g, sep)}`
        
        const result = await window.electronAPI?.moveFile(file.path, destPath)
        
        if (result?.success) {
          // Update server path if synced
          if (file.pdmData?.id) {
            if (file.isDirectory) {
              await updateFolderPath(file.relativePath, newRelativePath)
            } else {
              await updateFilePath(file.pdmData.id, newRelativePath)
            }
          }
          succeeded++
        } else {
          failed++
          errors.push(`${file.name}: ${result?.error || 'Failed to move'}`)
        }
      } catch (err) {
        failed++
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
    
    if (succeeded > 0) {
      ctx.addToast('success', `Moved ${succeeded} item${succeeded !== 1 ? 's' : ''}`)
    }
    if (failed > 0) {
      ctx.addToast('error', `Failed to move ${failed} item${failed !== 1 ? 's' : ''}`)
    }
    
    ctx.onRefresh?.(true)
    
    return {
      success: failed === 0,
      message: `Moved ${succeeded} of ${files.length} items`,
      total: files.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined
    }
  }
}

// ============================================
// Copy Command
// ============================================

export const copyCommand: Command<CopyParams> = {
  id: 'copy',
  name: 'Copy',
  description: 'Copy files to a new location',
  aliases: ['cp'],
  usage: 'copy <files...> <destination>',
  
  validate({ files, targetFolder }, ctx) {
    if (!files || files.length === 0) {
      return 'No files specified'
    }
    if (!targetFolder && targetFolder !== '') {
      return 'No destination folder specified'
    }
    if (!ctx.vaultPath) {
      return 'No vault path'
    }
    return null
  },
  
  async execute({ files, targetFolder }, ctx): Promise<CommandResult> {
    if (!ctx.vaultPath) {
      return {
        success: false,
        message: 'No vault path',
        total: files.length,
        succeeded: 0,
        failed: files.length
      }
    }
    
    const isWindows = ctx.vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    for (const file of files) {
      try {
        // Generate unique destination path (handle name collisions)
        const destPath = await getUniqueDestPath(
          ctx.vaultPath,
          targetFolder,
          file.name,
          sep
        )
        
        const result = await window.electronAPI?.copyFile(file.path, destPath)
        
        if (result?.success) {
          // Note: Copied files are NOT synced - they become new local files
          // User must explicitly sync them
          succeeded++
        } else {
          failed++
          errors.push(`${file.name}: ${result?.error || 'Failed to copy'}`)
        }
      } catch (err) {
        failed++
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
    
    if (succeeded > 0) {
      ctx.addToast('success', `Copied ${succeeded} item${succeeded !== 1 ? 's' : ''}`)
    }
    if (failed > 0) {
      ctx.addToast('error', `Failed to copy ${failed} item${failed !== 1 ? 's' : ''}`)
    }
    
    ctx.onRefresh?.(true)
    
    return {
      success: failed === 0,
      message: `Copied ${succeeded} of ${files.length} items`,
      total: files.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined
    }
  }
}

// ============================================
// New Folder Command
// ============================================

export const newFolderCommand: Command<NewFolderParams> = {
  id: 'new-folder',
  name: 'New Folder',
  description: 'Create a new folder',
  aliases: ['mkdir', 'md'],
  usage: 'new-folder <parent> <name>',
  
  validate({ parentPath: _parentPath, folderName }, ctx) {
    if (!folderName || !folderName.trim()) {
      return 'Folder name is required'
    }
    
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(folderName)) {
      return 'Folder name contains invalid characters'
    }
    
    if (!ctx.vaultPath) {
      return 'No vault path'
    }
    
    return null
  },
  
  async execute({ parentPath, folderName }, ctx): Promise<CommandResult> {
    if (!ctx.vaultPath) {
      return {
        success: false,
        message: 'No vault path',
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
    
    try {
      const isWindows = ctx.vaultPath.includes('\\')
      const sep = isWindows ? '\\' : '/'
      
      // Generate unique folder name if it already exists
      let finalFolderName = folderName
      let newFolderRelPath = parentPath 
        ? `${parentPath}/${finalFolderName}`
        : finalFolderName
      let fullPath = `${ctx.vaultPath}${sep}${newFolderRelPath.replace(/\//g, sep)}`
      
      // Check if folder exists and generate unique name
      let counter = 1
      console.log('[NewFolder] Checking path:', fullPath)
      let exists = await window.electronAPI?.fileExists(fullPath)
      console.log('[NewFolder] Exists:', exists)
      
      while (exists) {
        finalFolderName = `${folderName} (${counter})`
        newFolderRelPath = parentPath 
          ? `${parentPath}/${finalFolderName}`
          : finalFolderName
        fullPath = `${ctx.vaultPath}${sep}${newFolderRelPath.replace(/\//g, sep)}`
        console.log('[NewFolder] Trying path:', fullPath)
        exists = await window.electronAPI?.fileExists(fullPath)
        console.log('[NewFolder] Exists:', exists)
        counter++
        
        // Safety limit
        if (counter > 100) {
          ctx.addToast('error', 'Too many folders with the same name')
          return {
            success: false,
            message: 'Too many folders with the same name',
            total: 1,
            succeeded: 0,
            failed: 1
          }
        }
      }
      
      console.log('[NewFolder] Creating:', fullPath, 'as:', finalFolderName)
      
      const result = await window.electronAPI?.createFolder(fullPath)
      
      if (!result?.success) {
        ctx.addToast('error', result?.error || 'Failed to create folder')
        return {
          success: false,
          message: result?.error || 'Failed to create folder',
          total: 1,
          succeeded: 0,
          failed: 1
        }
      }
      
      ctx.addToast('success', `Created folder: ${finalFolderName}`)
      ctx.onRefresh?.(true)
      
      return {
        success: true,
        message: `Created folder: ${finalFolderName}`,
        total: 1,
        succeeded: 1,
        failed: 0
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      ctx.addToast('error', `Failed to create folder: ${errorMsg}`)
      return {
        success: false,
        message: `Failed to create folder: ${errorMsg}`,
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Generate a unique destination path, handling name collisions
 * by appending (1), (2), etc.
 */
async function getUniqueDestPath(
  vaultPath: string,
  targetFolder: string,
  fileName: string,
  sep: string
): Promise<string> {
  const basePath = targetFolder 
    ? `${vaultPath}${sep}${targetFolder.replace(/\//g, sep)}${sep}` 
    : `${vaultPath}${sep}`
  
  let destPath = `${basePath}${fileName}`
  let counter = 1
  
  // Check if file exists
  while (await window.electronAPI?.fileExists(destPath)) {
    // Split name and extension
    const lastDot = fileName.lastIndexOf('.')
    const nameWithoutExt = lastDot > 0 ? fileName.substring(0, lastDot) : fileName
    const ext = lastDot > 0 ? fileName.substring(lastDot) : ''
    
    destPath = `${basePath}${nameWithoutExt} (${counter})${ext}`
    counter++
    
    // Safety limit
    if (counter > 100) {
      throw new Error('Too many files with the same name')
    }
  }
  
  return destPath
}

