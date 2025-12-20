/**
 * Checkin Command
 * 
 * Check in files after editing. This:
 * 1. Uploads new content if modified
 * 2. Updates metadata on server (auto-extracts from SolidWorks files if available)
 * 3. Releases the checkout lock
 * 4. Makes the local file read-only
 */

import type { Command, CheckinParams, CommandResult } from '../types'
import { getSyncedFilesFromSelection } from '../types'
import { ProgressTracker } from '../executor'
import { checkinFile } from '../../supabase'
import type { LocalFile } from '../../../stores/pdmStore'

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
  part_number?: string | null
  description?: string | null
  revision?: string | null
} | null> {
  // Only process SolidWorks files
  if (!SW_EXTENSIONS.includes(extension.toLowerCase())) {
    return null
  }
  
  // Check if SolidWorks service is available
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  if (!status?.data?.running) {
    console.debug('[Checkin] SolidWorks service not running, skipping metadata extraction')
    return null
  }
  
  try {
    const result = await window.electronAPI?.solidworks?.getProperties?.(fullPath)
    
    if (!result?.success || !result.data) {
      console.debug('[Checkin] Failed to get properties:', result?.error)
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
    console.debug('[Checkin] Available properties:', propKeys.join(', '))
    
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
      // PDM-specific
      'SW-File Name (File Name)', // Sometimes used as part number
    ]
    
    let part_number: string | null = null
    for (const key of partNumberKeys) {
      if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
        part_number = allProps[key].trim()
        console.debug(`[Checkin] Found part number in "${key}": ${part_number}`)
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
            console.debug(`[Checkin] Found part number (fallback) in "${key}": ${part_number}`)
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
        console.debug(`[Checkin] Found description in "${key}": ${description?.substring(0, 50)}`)
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
            console.debug(`[Checkin] Found description (fallback) in "${key}": ${description?.substring(0, 50)}`)
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
        console.debug(`[Checkin] Found revision in "${key}": ${revision}`)
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
            console.debug(`[Checkin] Found revision (fallback) in "${key}": ${revision}`)
            break
          }
        }
      }
    }
    
    console.debug('[Checkin] Extracted metadata:', { part_number, description: description?.substring(0, 50), revision })
    
    return {
      part_number,
      description: description?.trim() || null,
      revision: revision?.trim() || null
    }
  } catch (err) {
    console.warn('[Checkin] Failed to extract SolidWorks metadata:', err)
    return null
  }
}

// Detailed logging for checkin operations
function logCheckin(level: 'info' | 'warn' | 'error' | 'debug', message: string, context: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  const logData = { timestamp, ...context }
  
  const prefix = '[Checkin]'
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

function getFileContext(file: LocalFile): Record<string, unknown> {
  return {
    fileName: file.name,
    relativePath: file.relativePath,
    fullPath: file.path,
    fileId: file.pdmData?.id,
    fileSize: file.size,
    localHash: file.localHash?.substring(0, 12),
    serverHash: file.pdmData?.content_hash?.substring(0, 12),
    version: file.pdmData?.version,
    state: file.pdmData?.state,
    hasPendingMetadata: !!file.pendingMetadata
  }
}

export const checkinCommand: Command<CheckinParams> = {
  id: 'checkin',
  name: 'Check In',
  description: 'Check in files after editing',
  aliases: ['ci'],
  usage: 'checkin <path> [--message "commit message"]',
  
  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot check in files while offline'
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
    
    // Get synced files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const checkinable = syncedFiles.filter(f => f.pdmData?.checked_out_by === ctx.user?.id)
    
    if (checkinable.length === 0) {
      // Check if files exist but aren't checked out by user
      if (syncedFiles.length > 0) {
        const checkedOutByOthers = syncedFiles.filter(f => 
          f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== ctx.user?.id
        )
        if (checkedOutByOthers.length > 0) {
          return 'Files are checked out by other users'
        }
        return 'Files are not checked out by you'
      }
      return 'No files checked out by you'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const user = ctx.user!
    const operationId = `checkin-${Date.now()}`
    
    logCheckin('info', 'Starting checkin operation', {
      operationId,
      userId: user.id,
      selectedFileCount: files.length
    })
    
    // Get files checked out by current user
    const syncedFiles = getSyncedFilesFromSelection(ctx.files, files)
    const filesToCheckin = syncedFiles.filter(f => f.pdmData?.checked_out_by === user.id)
    
    logCheckin('debug', 'Filtered files for checkin', {
      operationId,
      syncedCount: syncedFiles.length,
      checkinableCount: filesToCheckin.length,
      checkedOutByOthers: syncedFiles.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user.id).length
    })
    
    if (filesToCheckin.length === 0) {
      logCheckin('info', 'No files to check in', { operationId })
      return {
        success: true,
        message: 'No files to check in',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track folders and files being processed (for spinner display)
    const foldersBeingProcessed = files
      .filter(f => f.isDirectory)
      .map(f => f.relativePath)
    const filesBeingProcessed = filesToCheckin.map(f => f.relativePath)
    const allPathsBeingProcessed = [...new Set([...foldersBeingProcessed, ...filesBeingProcessed])]
    ctx.addProcessingFolders(allPathsBeingProcessed)
    
    // Yield to event loop so React can render spinners before starting operation
    await new Promise(resolve => setTimeout(resolve, 0))
    
    // Progress tracking
    const toastId = `checkin-${Date.now()}`
    const total = filesToCheckin.length
    const progress = new ProgressTracker(
      ctx,
      'checkin',
      toastId,
      `Checking in ${total} file${total > 1 ? 's' : ''}...`,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Process all files in parallel, collect updates for batch store update
    const pendingUpdates: Array<{ path: string; updates: Parameters<typeof ctx.updateFileInStore>[1] }> = []
    
    const results = await Promise.all(filesToCheckin.map(async (file) => {
      const fileCtx = getFileContext(file)
      
      try {
        const wasFileMoved = file.pdmData?.file_path && 
          file.relativePath !== file.pdmData.file_path
        const wasFileRenamed = file.pdmData?.file_name && 
          file.name !== file.pdmData.file_name
        
        logCheckin('debug', 'Checking in file', {
          operationId,
          ...fileCtx,
          wasFileMoved,
          wasFileRenamed,
          oldPath: wasFileMoved ? file.pdmData?.file_path : undefined,
          oldName: wasFileRenamed ? file.pdmData?.file_name : undefined
        })
        
        // If SolidWorks file is open, save it first to ensure we check in the latest changes
        if (SW_EXTENSIONS.includes(file.extension.toLowerCase())) {
          try {
            const docInfo = await window.electronAPI?.solidworks?.getDocumentInfo?.(file.path)
            if (docInfo?.success && docInfo.data?.isOpen && docInfo.data?.isDirty) {
              logCheckin('info', 'Saving open SolidWorks document before check-in', {
                operationId,
                fileName: file.name
              })
              const saveResult = await window.electronAPI?.solidworks?.saveDocument?.(file.path)
              if (saveResult?.success && saveResult.data?.saved) {
                logCheckin('info', 'SolidWorks document saved successfully', {
                  operationId,
                  fileName: file.name
                })
              } else if (!saveResult?.success) {
                logCheckin('warn', 'Failed to save SolidWorks document', {
                  operationId,
                  fileName: file.name,
                  error: saveResult?.error
                })
              }
            }
          } catch {
            // SW service not available - continue with regular checkin
          }
        }
        
        // Read file to get hash
        const readResult = await window.electronAPI?.readFile(file.path)
        
        if (!readResult?.success) {
          logCheckin('error', 'Failed to read local file', {
            operationId,
            ...fileCtx,
            readError: readResult?.error
          })
          progress.update()
          return { success: false, error: `${file.name}: Failed to read file - ${readResult?.error || 'Unknown error'}` }
        }
        
        // Auto-extract SolidWorks metadata if no manual edits were made
        let metadataToUse = file.pendingMetadata
        if (!metadataToUse) {
          const swMetadata = await extractSolidWorksMetadata(file.path, file.extension)
          if (swMetadata) {
            metadataToUse = swMetadata
            logCheckin('debug', 'Auto-extracted SolidWorks metadata', {
              operationId,
              fileName: file.name,
              partNumber: swMetadata.part_number,
              description: swMetadata.description?.substring(0, 50)
            })
          }
        }
        
        if (readResult?.success && readResult.hash) {
          logCheckin('debug', 'File read successful, uploading', {
            operationId,
            fileName: file.name,
            localHash: readResult.hash.substring(0, 12),
            size: readResult.size
          })
          
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newContentHash: readResult.hash,
            newFileSize: file.size,
            newFilePath: wasFileMoved ? file.relativePath : undefined,
            newFileName: wasFileRenamed ? file.name : undefined,
            pendingMetadata: metadataToUse
          })
          
          if (result.success && result.file) {
            // Make file read-only on file system
            const readonlyResult = await window.electronAPI?.setReadonly(file.path, true)
            if (readonlyResult?.success === false) {
              logCheckin('warn', 'Failed to set read-only flag', {
                operationId,
                fileName: file.name,
                error: readonlyResult.error
              })
            }
            
            // If SolidWorks file is open, also set document to read-only
            // This allows checking in files without closing SolidWorks!
            if (SW_EXTENSIONS.includes(file.extension.toLowerCase())) {
              try {
                const docResult = await window.electronAPI?.solidworks?.setDocumentReadOnly?.(file.path, true)
                if (docResult?.success && docResult.data?.changed) {
                  logCheckin('info', 'Updated SolidWorks document to read-only', {
                    operationId,
                    fileName: file.name,
                    wasReadOnly: docResult.data.wasReadOnly,
                    isNowReadOnly: docResult.data.isNowReadOnly
                  })
                }
              } catch {
                // SW service not available or file not open - that's fine
              }
            }
            
            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: { ...file.pdmData!, ...result.file, checked_out_by: null, checked_out_user: null },
                localHash: readResult.hash,
                diffStatus: undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined
              }
            })
            
            logCheckin('debug', 'File checkin successful', {
              operationId,
              fileName: file.name,
              newVersion: result.file.version
            })
            progress.update()
            return { success: true }
          } else {
            logCheckin('error', 'Checkin API call failed', {
              operationId,
              ...fileCtx,
              error: result.error
            })
            progress.update()
            return { success: false, error: `${file.name}: ${result.error || 'Check in failed'}` }
          }
        } else {
          // Metadata-only checkin (no content change)
          logCheckin('debug', 'Metadata-only checkin', {
            operationId,
            fileName: file.name
          })
          
          const result = await checkinFile(file.pdmData!.id, user.id, {
            newFilePath: wasFileMoved ? file.relativePath : undefined,
            newFileName: wasFileRenamed ? file.name : undefined,
            pendingMetadata: metadataToUse
          })
          
          if (result.success && result.file) {
            // Make file read-only on file system
            await window.electronAPI?.setReadonly(file.path, true)
            
            // If SolidWorks file is open, also set document to read-only
            if (SW_EXTENSIONS.includes(file.extension.toLowerCase())) {
              try {
                await window.electronAPI?.solidworks?.setDocumentReadOnly?.(file.path, true)
              } catch {
                // SW service not available or file not open - that's fine
              }
            }
            
            // Queue update for batch processing
            pendingUpdates.push({
              path: file.path,
              updates: {
                pdmData: { ...file.pdmData!, ...result.file, checked_out_by: null, checked_out_user: null },
                localHash: result.file.content_hash,
                diffStatus: undefined,
                localActiveVersion: undefined,
                pendingMetadata: undefined
              }
            })
            
            logCheckin('debug', 'Metadata checkin successful', {
              operationId,
              fileName: file.name
            })
            progress.update()
            return { success: true }
          } else {
            logCheckin('error', 'Metadata checkin failed', {
              operationId,
              ...fileCtx,
              error: result.error
            })
            progress.update()
            return { success: false, error: `${file.name}: ${result.error || 'Check in failed'}` }
          }
        }
      } catch (err) {
        logCheckin('error', 'Checkin exception', {
          operationId,
          ...fileCtx,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        })
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
    
    // Log final result
    logCheckin(failed > 0 ? 'warn' : 'info', 'Checkin operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      duration,
      errors: errors.length > 0 ? errors : undefined
    })
    
    // Show result
    if (failed > 0) {
      // Show first error in toast for visibility
      const firstError = errors[0] || 'Unknown error'
      const moreText = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
      ctx.addToast('error', `Check-in failed: ${firstError}${moreText}`)
    } else {
      ctx.addToast('success', `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Checked in ${succeeded}/${total} files` : `Checked in ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

