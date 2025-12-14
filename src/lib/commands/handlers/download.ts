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
    
    // Get cloud-only files (includes both 'cloud' and 'cloud_new')
    const cloudFiles = getCloudOnlyFilesFromSelection(ctx.files, files)
    
    // Also allow empty cloud-only folders (to create them locally)
    const hasCloudOnlyFolders = files.some(f => f.isDirectory && (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new'))
    
    if (cloudFiles.length === 0 && !hasCloudOnlyFolders) {
      return 'No cloud files to download'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const organization = ctx.organization!
    const vaultPath = ctx.vaultPath!
    
    // Get cloud-only files from selection
    const cloudFiles = getCloudOnlyFilesFromSelection(ctx.files, files)
    const cloudOnlyFolders = files.filter(f => f.isDirectory && (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new'))
    
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
    
    // Track only the cloud-only files being downloaded (not entire folders)
    // This prevents spinners showing on ALL files when downloading from a parent folder
    // Use batch add to avoid N state updates
    const cloudFilePaths = cloudFiles.map(f => f.relativePath)
    ctx.addProcessingFolders(cloudFilePaths)
    
    // Yield to event loop so React can render spinners before starting download
    await new Promise(resolve => setTimeout(resolve, 0))
    
    const total = cloudFiles.length
    
    // Progress tracking
    const toastId = `download-${Date.now()}`
    const progressLabel = total === 1 
      ? `Downloading ${cloudFiles[0].name}...`
      : `Downloading ${total} cloud file${total > 1 ? 's' : ''}...`
    
    const progress = new ProgressTracker(
      ctx,
      'download',
      toastId,
      progressLabel,
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
    
    // Clean up - use batch remove to avoid N state updates
    ctx.removeProcessingFolders(cloudFilePaths)
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

