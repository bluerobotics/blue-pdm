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
    console.debug('[Sync] SolidWorks service not running, skipping metadata extraction')
    return null
  }
  
  try {
    const result = await window.electronAPI?.solidworks?.getProperties?.(fullPath)
    
    if (!result?.success || !result.data) {
      console.debug('[Sync] Failed to get properties:', result?.error)
      return null
    }
    
    const data = result.data as {
      fileProperties?: Record<string, string>
      configurationProperties?: Record<string, Record<string, string>>
    }
    
    // Merge file-level and active configuration properties
    // Configuration properties take precedence over file-level properties
    const allProps: Record<string, string> = { ...data.fileProperties }
    
    // Also check configuration properties - try multiple common config names
    const configProps = data.configurationProperties
    if (configProps) {
      // Priority order: Default, Standard, first available
      const configNames = Object.keys(configProps)
      const preferredConfig = configNames.find(k => 
        k.toLowerCase() === 'default'
      ) || configNames.find(k => 
        k.toLowerCase() === 'standard'
      ) || configNames.find(k =>
        k.toLowerCase() === 'default configuration'
      ) || configNames[0]
      
      if (preferredConfig && configProps[preferredConfig]) {
        // Config properties override file-level properties
        Object.assign(allProps, configProps[preferredConfig])
      }
    }
    
    // Log all available properties for debugging
    const propKeys = Object.keys(allProps)
    console.debug('[Sync] Available properties:', propKeys.join(', '))
    
    // Extract part number from common property names (comprehensive list)
    const partNumberKeys = [
      // SolidWorks standard/common
      'Base Item Number',  // Document Manager standard property
      'PartNumber', 'Part Number', 'PARTNUMBER', 'PART NUMBER',
      'Part No', 'Part No.', 'PartNo', 'PARTNO', 'PART NO',
      // Item number variations
      'ItemNumber', 'Item Number', 'ITEMNUMBER', 'ITEM NUMBER',
      'Item No', 'Item No.', 'ItemNo', 'ITEMNO', 'ITEM NO',
      // Short forms
      'PN', 'P/N', 'pn', 'p/n',
      // Other common names
      'Number', 'No', 'No.',
      'Document Number', 'DocumentNumber', 'Doc Number', 'DocNo',
      'Stock Code', 'StockCode', 'Stock Number', 'StockNumber',
      'Product Number', 'ProductNumber', 'SKU',
    ]
    
    let partNumber: string | null = null
    for (const key of partNumberKeys) {
      if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
        partNumber = allProps[key].trim()
        console.debug(`[Sync] Found part number in "${key}": ${partNumber}`)
        break
      }
    }
    
    // Case-insensitive fallback
    if (!partNumber) {
      for (const [key, value] of Object.entries(allProps)) {
        const lowerKey = key.toLowerCase()
        // Skip formula references (start with $)
        if (value?.startsWith?.('$')) continue
        
        if ((lowerKey.includes('part') && (lowerKey.includes('number') || lowerKey.includes('no'))) ||
            (lowerKey.includes('item') && (lowerKey.includes('number') || lowerKey.includes('no'))) ||
            lowerKey === 'pn' || lowerKey === 'p/n' ||
            lowerKey.includes('stock') && (lowerKey.includes('code') || lowerKey.includes('number'))) {
          if (value && value.trim()) {
            partNumber = value.trim()
            console.debug(`[Sync] Found part number (fallback) in "${key}": ${partNumber}`)
            break
          }
        }
      }
    }
    
    // Extract description (comprehensive list)
    const descriptionKeys = [
      'Description', 'DESCRIPTION', 'description',
      'Desc', 'DESC', 'desc',
      'Title', 'TITLE', 'title',
      'Name', 'NAME', 'name',
      'Part Description', 'PartDescription', 'PART DESCRIPTION',
      'Component Description', 'ComponentDescription',
      'Item Description', 'ItemDescription',
    ]
    
    let description: string | null = null
    for (const key of descriptionKeys) {
      if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
        description = allProps[key].trim()
        break
      }
    }
    
    // Case-insensitive fallback for description
    if (!description) {
      for (const [key, value] of Object.entries(allProps)) {
        const lowerKey = key.toLowerCase()
        if (value?.startsWith?.('$')) continue
        
        if (lowerKey.includes('description') || lowerKey.includes('desc')) {
          if (value && value.trim()) {
            description = value.trim()
            break
          }
        }
      }
    }
    
    // Extract revision (comprehensive list)
    const revisionKeys = [
      'Revision', 'REVISION', 'revision',
      'Rev', 'REV', 'rev',
      'Rev.', 'REV.',
      'RevLevel', 'Rev Level', 'Revision Level', 'RevisionLevel',
      'Rev No', 'RevNo', 'Rev Number', 'RevNumber',
      'Version', 'VERSION', 'version',
      'Ver', 'VER', 'ver',
      'ECO', 'ECN', 'Change Level', 'ChangeLevel',
      'Engineering Change', 'EngineeringChange',
    ]
    
    let revision: string | null = null
    for (const key of revisionKeys) {
      if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
        revision = allProps[key].trim()
        break
      }
    }
    
    // Case-insensitive fallback for revision
    if (!revision) {
      for (const [key, value] of Object.entries(allProps)) {
        const lowerKey = key.toLowerCase()
        if (value?.startsWith?.('$')) continue
        
        if (lowerKey.includes('revision') || lowerKey === 'rev' || 
            lowerKey.includes('rev ') || lowerKey.startsWith('rev.')) {
          if (value && value.trim()) {
            revision = value.trim()
            break
          }
        }
      }
    }
    
    // Build custom properties object (exclude the ones we've already extracted)
    const excludeKeys = new Set([
      ...partNumberKeys, 
      ...descriptionKeys,
      ...revisionKeys
    ].map(k => k.toLowerCase()))
    
    const customProperties: Record<string, string | number | null> = {}
    for (const [key, value] of Object.entries(allProps)) {
      if (!excludeKeys.has(key.toLowerCase()) && value && !value.startsWith('$')) {
        customProperties[key] = value
      }
    }
    
    console.debug('[Sync] Extracted metadata:', { partNumber, description: description?.substring(0, 50), revision })
    
    return {
      partNumber,
      description: description?.trim() || null,
      revision,
      customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined
    }
  } catch (err) {
    console.warn('[Sync] Failed to extract SolidWorks metadata:', err)
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

