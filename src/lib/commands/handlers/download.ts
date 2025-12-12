/**
 * Download Command
 * 
 * Download cloud-only files to the local vault.
 * Creates necessary parent directories and makes files read-only.
 */

import type { Command, DownloadParams, CommandResult } from '../types'
import { getCloudOnlyFilesFromSelection, buildFullPath, getParentDir } from '../types'
import { ProgressTracker } from '../executor'
import { getDownloadUrl } from '../../storage'

export const downloadCommand: Command<DownloadParams> = {
  id: 'download',
  name: 'Download',
  description: 'Download cloud files to local vault',
  aliases: ['dl', 'get'],
  usage: 'download <path> [--recursive]',
  
  validate({ files }, ctx) {
    if (!ctx.organization) {
      return 'No organization connected'
    }
    
    if (!ctx.vaultPath) {
      return 'No vault path configured'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get cloud-only files
    const cloudFiles = getCloudOnlyFilesFromSelection(ctx.files, files)
    
    // Also allow empty cloud-only folders (to create them locally)
    const hasCloudOnlyFolders = files.some(f => f.isDirectory && f.diffStatus === 'cloud')
    
    if (cloudFiles.length === 0 && !hasCloudOnlyFolders) {
      return 'No cloud files to download'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const organization = ctx.organization!
    const vaultPath = ctx.vaultPath!
    
    // Get cloud-only files and track which folders have files to download
    const cloudFiles = getCloudOnlyFilesFromSelection(ctx.files, files)
    const cloudOnlyFolders = files.filter(f => f.isDirectory && f.diffStatus === 'cloud')
    const foldersWithCloudFiles = files
      .filter(f => f.isDirectory)
      .filter(folder => {
        const folderPath = folder.relativePath.replace(/\\/g, '/')
        return cloudFiles.some(cf => 
          cf.relativePath.replace(/\\/g, '/').startsWith(folderPath + '/')
        )
      })
      .map(f => f.relativePath)
    
    // Handle empty cloud-only folders - just create them locally
    if (cloudFiles.length === 0 && cloudOnlyFolders.length > 0) {
      let created = 0
      const createdPaths: string[] = []
      
      for (const folder of cloudOnlyFolders) {
        try {
          const fullPath = buildFullPath(vaultPath, folder.relativePath)
          await window.electronAPI?.createFolder(fullPath)
          created++
          createdPaths.push(folder.path)
        } catch (err) {
          console.error('Failed to create folder:', folder.relativePath, err)
        }
      }
      
      // Remove the cloud-only folder entries from store
      // The refresh will pick them up as real local folders
      if (createdPaths.length > 0) {
        ctx.removeFilesFromStore(createdPaths)
      }
      
      // Refresh to pick up the newly created local folders
      ctx.onRefresh?.(false)  // Non-silent refresh to fully reload
      
      if (created > 0) {
        ctx.addToast('success', `Created ${created} folder${created > 1 ? 's' : ''} locally`)
      }
      
      return {
        success: true,
        message: `Created ${created} folder${created > 1 ? 's' : ''} locally`,
        total: cloudOnlyFolders.length,
        succeeded: created,
        failed: cloudOnlyFolders.length - created
      }
    }
    
    if (cloudFiles.length === 0) {
      return {
        success: true,
        message: 'No files to download',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track folders being processed
    foldersWithCloudFiles.forEach(p => ctx.addProcessingFolder(p))
    
    const total = cloudFiles.length
    
    // Progress tracking
    const toastId = `download-${Date.now()}`
    const folderName = foldersWithCloudFiles.length > 0
      ? foldersWithCloudFiles[0].split('/').pop()
      : 'files'
    
    const progress = new ProgressTracker(
      ctx,
      'download',
      toastId,
      `Downloading ${folderName}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel
    const results = await Promise.all(cloudFiles.map(async (file) => {
      if (!file.pdmData?.content_hash) {
        progress.update()
        return { success: false, error: `${file.name}: No content hash` }
      }
      
      try {
        const fullPath = buildFullPath(vaultPath, file.relativePath)
        await window.electronAPI?.createFolder(getParentDir(fullPath))
        
        const { url, error: urlError } = await getDownloadUrl(organization.id, file.pdmData.content_hash)
        if (urlError || !url) {
          progress.update()
          return { success: false, error: `${file.name}: ${urlError || 'Failed to get URL'}` }
        }
        
        const downloadResult = await window.electronAPI?.downloadUrl(url, fullPath)
        if (!downloadResult?.success) {
          progress.update()
          return { success: false, error: `${file.name}: Download failed` }
        }
        
        await window.electronAPI?.setReadonly(fullPath, true)
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
    foldersWithCloudFiles.forEach(p => ctx.removeProcessingFolder(p))
    const { duration } = progress.finish()
    ctx.onRefresh?.(true)
    
    // Show result
    if (failed > 0) {
      ctx.addToast('warning', `Downloaded ${succeeded}/${total} files`)
    } else {
      ctx.addToast('success', `Downloaded ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Downloaded ${succeeded}/${total} files` : `Downloaded ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

