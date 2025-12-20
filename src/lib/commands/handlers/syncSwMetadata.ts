/**
 * Sync SolidWorks Metadata Command
 * 
 * Extract metadata from SolidWorks files and update the database.
 * Creates a new version if metadata has changed.
 * 
 * This can be triggered from:
 * - Right-click context menu
 * - Command palette
 */

import type { Command, CommandResult, LocalFile, SyncSwMetadataParams } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { syncSolidWorksFileMetadata } from '../../supabase'

// SolidWorks file extensions that support metadata extraction
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

// Detailed logging
function logSyncMeta(level: 'info' | 'warn' | 'error' | 'debug', message: string, context: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  const logData = { timestamp, ...context }
  
  const prefix = '[SyncSWMetadata]'
  if (level === 'error') {
    console.error(prefix, message, logData)
  } else if (level === 'warn') {
    console.warn(prefix, message, logData)
  } else if (level === 'debug') {
    console.debug(prefix, message, logData)
  } else {
    console.log(prefix, message, logData)
  }
  
  try {
    window.electronAPI?.log(level, `${prefix} ${message}`, logData)
  } catch {
    // Ignore if electronAPI not available
  }
}

/**
 * Extract metadata from SolidWorks file using the SW service
 */
async function extractSolidWorksMetadata(
  fullPath: string,
  extension: string
): Promise<{
  part_number?: string | null
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
    logSyncMeta('debug', 'SolidWorks service not running', { fullPath })
    return null
  }
  
  try {
    const result = await window.electronAPI?.solidworks?.getProperties?.(fullPath)
    
    if (!result?.success || !result.data) {
      logSyncMeta('warn', 'Failed to get properties from SolidWorks', { fullPath, error: result?.error })
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
    logSyncMeta('debug', 'Available properties', { fullPath, properties: propKeys.join(', ') })
    
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
    
    let part_number: string | null = null
    for (const key of partNumberKeys) {
      if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
        part_number = allProps[key].trim()
        logSyncMeta('debug', `Found part number in "${key}"`, { fullPath, partNumber: part_number })
        break
      }
    }
    
    // Case-insensitive fallback
    if (!part_number) {
      for (const [key, value] of Object.entries(allProps)) {
        const lowerKey = key.toLowerCase()
        // Skip formula references (start with $)
        if (value?.startsWith?.('$')) continue
        
        if ((lowerKey.includes('part') && (lowerKey.includes('number') || lowerKey.includes('no'))) ||
            (lowerKey.includes('item') && (lowerKey.includes('number') || lowerKey.includes('no'))) ||
            lowerKey === 'pn' || lowerKey === 'p/n' ||
            lowerKey.includes('stock') && (lowerKey.includes('code') || lowerKey.includes('number'))) {
          if (value && value.trim()) {
            part_number = value.trim()
            logSyncMeta('debug', `Found part number (fallback) in "${key}"`, { fullPath, partNumber: part_number })
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
    
    logSyncMeta('debug', 'Extracted metadata', { 
      fullPath, 
      partNumber: part_number, 
      description: description?.substring(0, 50), 
      revision 
    })
    
    return {
      part_number,
      description: description?.trim() || null,
      revision,
      customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined
    }
  } catch (err) {
    logSyncMeta('error', 'Exception extracting metadata', { fullPath, error: String(err) })
    return null
  }
}

/**
 * Check if metadata has changed
 */
function hasMetadataChanged(
  file: LocalFile,
  newMetadata: { part_number?: string | null; description?: string | null }
): boolean {
  const currentPartNumber = file.pdmData?.part_number || null
  const currentDescription = file.pdmData?.description || null
  
  const newPartNumber = newMetadata.part_number || null
  const newDescription = newMetadata.description || null
  
  return currentPartNumber !== newPartNumber || currentDescription !== newDescription
}

export const syncSwMetadataCommand: Command<SyncSwMetadataParams> = {
  id: 'sync-sw-metadata',
  name: 'Sync SolidWorks Metadata',
  description: 'Extract and sync metadata from SolidWorks file properties',
  aliases: ['sw-metadata', 'extract-metadata'],
  usage: 'sync-sw-metadata <path>',
  
  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot sync metadata while offline'
    }
    
    if (!ctx.user) {
      return 'Please sign in first'
    }
    
    if (!ctx.organization) {
      return 'No organization connected'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get synced SolidWorks files
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const swFiles = syncedFiles.filter(f => SW_EXTENSIONS.includes(f.extension.toLowerCase()))
    
    if (swFiles.length === 0) {
      return 'No SolidWorks files selected'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    const operationId = `sync-sw-metadata-${Date.now()}`
    
    // Check if SolidWorks service is running
    const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
    if (!status?.data?.running) {
      ctx.addToast('error', 'SolidWorks service is not running. Start it from Settings.')
      return {
        success: false,
        message: 'SolidWorks service not running',
        total: 0,
        succeeded: 0,
        failed: 0,
        errors: ['SolidWorks service is not running']
      }
    }
    
    logSyncMeta('info', 'Starting SW metadata sync', {
      operationId,
      userId: user.id,
      selectedFileCount: files.length
    })
    
    // Get synced SolidWorks files
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToProcess = syncedFiles.filter(f => SW_EXTENSIONS.includes(f.extension.toLowerCase()))
    
    if (filesToProcess.length === 0) {
      return {
        success: true,
        message: 'No SolidWorks files to process',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track files being processed
    const filesBeingProcessed = filesToProcess.map(f => f.relativePath)
    ctx.addProcessingFolders(filesBeingProcessed)
    
    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0))
    
    // Progress tracking
    const toastId = `sync-sw-metadata-${Date.now()}`
    const total = filesToProcess.length
    const progress = new ProgressTracker(
      ctx,
      'sync-sw-metadata',
      toastId,
      `Syncing metadata from ${total} file${total > 1 ? 's' : ''}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    let updated = 0
    let unchanged = 0
    const errors: string[] = []
    
    // Process files in parallel
    const pendingUpdates: Array<{ path: string; updates: Parameters<typeof ctx.updateFileInStore>[1] }> = []
    
    const results = await Promise.all(filesToProcess.map(async (file) => {
      try {
        // Extract metadata from SW file
        const swMetadata = await extractSolidWorksMetadata(file.path, file.extension)
        
        if (!swMetadata) {
          logSyncMeta('warn', 'Failed to extract metadata', {
            operationId,
            fileName: file.name
          })
          progress.update()
          return { success: false, error: `${file.name}: Failed to extract metadata` }
        }
        
        logSyncMeta('debug', 'Extracted metadata', {
          operationId,
          fileName: file.name,
          partNumber: swMetadata.part_number,
          description: swMetadata.description?.substring(0, 50)
        })
        
        // Check if metadata has changed
        if (!hasMetadataChanged(file, swMetadata)) {
          logSyncMeta('debug', 'Metadata unchanged', { operationId, fileName: file.name })
          progress.update()
          return { success: true, changed: false }
        }
        
        // Update metadata on server (this creates a new version)
        const result = await syncSolidWorksFileMetadata(file.pdmData!.id, user.id, {
          part_number: swMetadata.part_number,
          description: swMetadata.description,
          custom_properties: swMetadata.customProperties
        })
        
        if (result.success && result.file) {
          // Queue store update
          pendingUpdates.push({
            path: file.path,
            updates: {
              pdmData: { ...file.pdmData!, ...result.file }
            }
          })
          
          logSyncMeta('info', 'Metadata updated', {
            operationId,
            fileName: file.name,
            newVersion: result.file.version
          })
          progress.update()
          return { success: true, changed: true }
        } else {
          logSyncMeta('error', 'Failed to update metadata', {
            operationId,
            fileName: file.name,
            error: result.error
          })
          progress.update()
          return { success: false, error: `${file.name}: ${result.error || 'Update failed'}` }
        }
      } catch (err) {
        logSyncMeta('error', 'Exception', {
          operationId,
          fileName: file.name,
          error: err instanceof Error ? err.message : String(err)
        })
        progress.update()
        return { success: false, error: `${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}` }
      }
    }))
    
    // Apply store updates
    if (pendingUpdates.length > 0) {
      ctx.updateFilesInStore(pendingUpdates)
    }
    
    // Count results
    for (const result of results) {
      if (result.success) {
        succeeded++
        if (result.changed) {
          updated++
        } else {
          unchanged++
        }
      } else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }
    
    // Clean up
    ctx.removeProcessingFolders(filesBeingProcessed)
    const { duration } = progress.finish()
    
    // Log final result
    logSyncMeta(failed > 0 ? 'warn' : 'info', 'Metadata sync complete', {
      operationId,
      total,
      succeeded,
      failed,
      updated,
      unchanged,
      duration
    })
    
    // Show result toast
    if (failed > 0) {
      ctx.addToast('warning', `Synced metadata: ${updated} updated, ${unchanged} unchanged, ${failed} failed`)
    } else if (updated > 0) {
      ctx.addToast('success', `Synced metadata: ${updated} file${updated > 1 ? 's' : ''} updated (new version created)`)
    } else {
      ctx.addToast('info', 'Metadata already up to date')
    }
    
    return {
      success: failed === 0,
      message: `Synced ${succeeded} file${succeeded > 1 ? 's' : ''}: ${updated} updated, ${unchanged} unchanged`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

