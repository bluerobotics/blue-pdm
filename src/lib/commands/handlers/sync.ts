/**
 * Sync Command (First Check-In)
 * 
 * Upload new local files to the server for the first time.
 * This syncs files that exist locally but haven't been added to PDM yet.
 * 
 * For SolidWorks files, automatically extracts metadata (part number, description)
 * from file custom properties when the SolidWorks service is available.
 */

import type { Command, SyncParams, CommandResult } from '../types'
import { getUnsyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { syncFile } from '../../supabase'
import { usePDMStore } from '../../../stores/pdmStore'

// Helper to check if file is a SolidWorks temp lock file (~$filename.sldxxx)
function isSolidworksTempFile(name: string): boolean {
  return name.startsWith('~$')
}

// SolidWorks file extensions that support metadata extraction
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

/**
 * Extract metadata from SolidWorks file using the SW service
 * Returns null if service unavailable or extraction fails
 */
async function extractSolidWorksMetadata(
  fullPath: string,
  extension: string
): Promise<{
  partNumber?: string | null
  description?: string | null
  revision?: string | null
  customProperties?: Record<string, string | number | null>
} | null> {
  // Only process SolidWorks files
  if (!SW_EXTENSIONS.includes(extension.toLowerCase())) {
    return null
  }
  
  // Check if SolidWorks service is available
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  if (!status?.data?.running) {
    return null
  }
  
  try {
    const result = await window.electronAPI?.solidworks?.getProperties?.(fullPath)
    
    if (!result?.success || !result.data) {
      return null
    }
    
    const data = result.data as {
      fileProperties?: Record<string, string>
      configurationProperties?: Record<string, Record<string, string>>
    }
    
    // Merge file-level and active configuration properties
    const allProps: Record<string, string> = { ...data.fileProperties }
    
    // Also check configuration properties (use first config or "Default")
    const configProps = data.configurationProperties
    if (configProps) {
      const configName = Object.keys(configProps).find(k => 
        k.toLowerCase() === 'default' || k.toLowerCase() === 'standard'
      ) || Object.keys(configProps)[0]
      
      if (configName && configProps[configName]) {
        // Configuration properties override file-level properties
        Object.assign(allProps, configProps[configName])
      }
    }
    
    // Extract part number from common property names
    const partNumberKeys = [
      'PartNumber', 'Part Number', 'Part No', 'Part No.', 'PartNo',
      'ItemNumber', 'Item Number', 'Item No', 'Item No.', 'ItemNo',
      'PN', 'P/N', 'Number', 'No', 'No.'
    ]
    let partNumber: string | null = null
    for (const key of partNumberKeys) {
      if (allProps[key] && allProps[key].trim()) {
        partNumber = allProps[key].trim()
        break
      }
    }
    // Case-insensitive fallback
    if (!partNumber) {
      for (const [key, value] of Object.entries(allProps)) {
        const lowerKey = key.toLowerCase()
        if ((lowerKey.includes('part') && (lowerKey.includes('number') || lowerKey.includes('no'))) ||
            (lowerKey.includes('item') && (lowerKey.includes('number') || lowerKey.includes('no'))) ||
            lowerKey === 'pn' || lowerKey === 'p/n') {
          if (value && value.trim()) {
            partNumber = value.trim()
            break
          }
        }
      }
    }
    
    // Extract description
    const description = allProps['Description'] || allProps['description'] || null
    
    // Extract revision
    const revisionKeys = ['Revision', 'Rev', 'Rev.', 'REV', 'RevLevel', 'Rev Level']
    let revision: string | null = null
    for (const key of revisionKeys) {
      if (allProps[key] && allProps[key].trim()) {
        revision = allProps[key].trim()
        break
      }
    }
    
    // Build custom properties object (exclude the ones we've already extracted)
    const excludeKeys = new Set([
      ...partNumberKeys, 'Description', 'description',
      ...revisionKeys
    ].map(k => k.toLowerCase()))
    
    const customProperties: Record<string, string | number | null> = {}
    for (const [key, value] of Object.entries(allProps)) {
      if (!excludeKeys.has(key.toLowerCase()) && value) {
        customProperties[key] = value
      }
    }
    
    return {
      partNumber,
      description: description?.trim() || null,
      revision,
      customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined
    }
  } catch (err) {
    console.warn('Failed to extract SolidWorks metadata:', err)
    return null
  }
}

export const syncCommand: Command<SyncParams> = {
  id: 'sync',
  name: 'First Check In',
  description: 'Upload new files to the server for the first time',
  aliases: ['upload', 'add'],
  usage: 'sync <path> [--recursive]',
  
  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot sync files while offline'
    }
    
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
    let filesToSync = getUnsyncedFilesFromSelection(ctx.files, files)
    
    // Filter out SolidWorks temp files (~$) when setting is enabled
    const { ignoreSolidworksTempFiles } = usePDMStore.getState()
    if (ignoreSolidworksTempFiles) {
      filesToSync = filesToSync.filter(f => !isSolidworksTempFile(f.name))
    }
    
    if (filesToSync.length === 0) {
      return {
        success: true,
        message: 'No files to sync',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track folders and files being processed (for spinner display)
    const foldersBeingProcessed = files
      .filter(f => f.isDirectory)
      .map(f => f.relativePath)
    const filesBeingProcessed = filesToSync.map(f => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...foldersBeingProcessed, ...filesBeingProcessed])]
    ctx.addProcessingFolders(allPathsBeingProcessed)
    
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
        
        // Extract SolidWorks metadata if this is a SW file and service is available
        const metadata = await extractSolidWorksMetadata(file.path, file.extension)
        
        const { error, file: syncedFile } = await syncFile(
          organization.id, activeVaultId, user.id,
          file.relativePath, file.name, file.extension, file.size,
          readResult.hash, readResult.data,
          metadata || undefined
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
    ctx.removeProcessingFolders(allPathsBeingProcessed)
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

