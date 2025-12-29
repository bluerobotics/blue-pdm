/**
 * Get Latest Command
 * 
 * Download newer versions of files from the server.
 * Used for outdated files (local exists but server has newer version).
 */

import type { Command, CommandResult, LocalFile } from '../types'
import { buildFullPath, getFilesInFolder } from '../types'
import { ProgressTracker } from '../executor'
import { getDownloadUrl } from '../../storage'
import { usePDMStore, MissingStorageFile } from '../../../stores/pdmStore'

export interface GetLatestParams {
  files: LocalFile[]
}

// Detailed logging for get-latest operations
function logGetLatest(level: 'info' | 'warn' | 'error' | 'debug', message: string, context: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  const logData = { timestamp, ...context }
  
  const prefix = '[GetLatest]'
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

// Build file context for logging
function getFileContext(file: LocalFile): Record<string, unknown> {
  return {
    fileName: file.name,
    relativePath: file.relativePath,
    fullPath: file.path,
    diffStatus: file.diffStatus,
    localHash: file.localHash?.substring(0, 12),
    serverHash: file.pdmData?.content_hash?.substring(0, 12),
    fileId: file.pdmData?.id,
    version: file.pdmData?.version,
    checkedOutBy: file.pdmData?.checked_out_by,
    state: file.pdmData?.workflow_state?.name
  }
}

// Helper to get outdated files from selection (handles folders)
export function getOutdatedFilesFromSelection(files: LocalFile[], selection: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []
  
  logGetLatest('debug', 'getOutdatedFilesFromSelection called', {
    totalFilesInContext: files.length,
    selectionCount: selection.length,
    selectionPaths: selection.map(f => ({ path: f.relativePath, diffStatus: f.diffStatus, isDir: f.isDirectory }))
  })
  
  for (const item of selection) {
    if (item.isDirectory) {
      const filesInFolder = getFilesInFolder(files, item.relativePath)
      const outdatedInFolder = filesInFolder.filter(f => f.diffStatus === 'outdated')
      logGetLatest('debug', 'Processing folder selection', {
        folder: item.relativePath,
        filesInFolder: filesInFolder.length,
        outdatedInFolder: outdatedInFolder.length,
        outdatedFiles: outdatedInFolder.map(f => f.name)
      })
      result.push(...outdatedInFolder)
    } else if (item.diffStatus === 'outdated' && item.pdmData) {
      logGetLatest('debug', 'Adding outdated file from selection', getFileContext(item))
      result.push(item)
    } else {
      logGetLatest('debug', 'Skipping non-outdated file', {
        name: item.name,
        diffStatus: item.diffStatus,
        hasPdmData: !!item.pdmData,
        reason: !item.pdmData ? 'no pdmData' : item.diffStatus !== 'outdated' ? 'not outdated status' : 'unknown'
      })
    }
  }
  
  const dedupedResult = Array.from(new Map(result.map(f => [f.path, f])).values())
  logGetLatest('debug', 'getOutdatedFilesFromSelection result', {
    beforeDedup: result.length,
    afterDedup: dedupedResult.length,
    files: dedupedResult.map(f => f.name)
  })
  
  return dedupedResult
}

export const getLatestCommand: Command<GetLatestParams> = {
  id: 'get-latest' as any,
  name: 'Get Latest',
  description: 'Download newer versions of files from server',
  aliases: ['gl', 'update'],
  usage: 'get-latest <path> [--recursive]',
  
  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot get latest while offline'
    }
    
    if (!ctx.organization) {
      return 'No organization connected'
    }
    
    if (!ctx.vaultPath) {
      return 'No vault path configured'
    }
    
    if (!files || files.length === 0) {
      return 'No files selected'
    }
    
    // Get outdated files
    const outdatedFiles = getOutdatedFilesFromSelection(ctx.files, files)
    
    if (outdatedFiles.length === 0) {
      return 'No outdated files to update'
    }
    
    return null
  },
  
  async execute({ files }, ctx): Promise<CommandResult> {
    const organization = ctx.organization!
    const vaultPath = ctx.vaultPath!
    const operationId = `get-latest-${Date.now()}`
    
    logGetLatest('info', 'Starting get-latest operation', {
      operationId,
      orgId: organization.id,
      vaultPath,
      inputFilesCount: files.length,
      contextFilesCount: ctx.files.length,
      inputFiles: files.map(f => ({ name: f.name, diffStatus: f.diffStatus, isDir: f.isDirectory }))
    })
    
    // Get outdated files from selection
    const outdatedFiles = getOutdatedFilesFromSelection(ctx.files, files)
    
    logGetLatest('info', 'Outdated files after filtering', {
      operationId,
      count: outdatedFiles.length,
      files: outdatedFiles.map(f => getFileContext(f))
    })
    
    if (outdatedFiles.length === 0) {
      logGetLatest('warn', 'No outdated files found - returning early', {
        operationId,
        inputFilesCount: files.length,
        inputFileStatuses: files.map(f => ({ name: f.name, diffStatus: f.diffStatus, hasPdmData: !!f.pdmData }))
      })
      return {
        success: true,
        message: 'No files to update',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track files being updated
    const filePaths = outdatedFiles.map(f => f.relativePath)
    ctx.addProcessingFolders(filePaths)
    
    // Yield to event loop so React can render spinners
    await new Promise(resolve => setTimeout(resolve, 0))
    
    const total = outdatedFiles.length
    
    // Progress tracking
    const toastId = `get-latest-${Date.now()}`
    const progressLabel = total === 1 
      ? `Updating ${outdatedFiles[0].name}...`
      : `Updating ${total} file${total > 1 ? 's' : ''}...`
    
    const progress = new ProgressTracker(
      ctx,
      'get-latest',
      toastId,
      progressLabel,
      total
    )
    
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    
    // Collect updates for batch store update
    const pendingUpdates: Array<{ path: string; updates: Partial<LocalFile> }> = []
    
    // Process all files in parallel
    const results = await Promise.all(outdatedFiles.map(async (file) => {
      const fileCtx = getFileContext(file)
      
      if (!file.pdmData?.content_hash) {
        logGetLatest('error', 'File has no content hash - skipping', {
          operationId,
          ...fileCtx,
          pdmDataPresent: !!file.pdmData,
          contentHashPresent: !!file.pdmData?.content_hash
        })
        progress.update()
        return { success: false, error: `${file.name}: No content hash` }
      }
      
      try {
        const fullPath = buildFullPath(vaultPath, file.relativePath)
        
        logGetLatest('debug', 'Processing file for update', {
          operationId,
          ...fileCtx,
          fullPath
        })
        
        // Get download URL for the server version
        const { url, error: urlError } = await getDownloadUrl(organization.id, file.pdmData.content_hash)
        if (urlError || !url) {
          logGetLatest('error', 'Failed to get download URL', {
            operationId,
            ...fileCtx,
            urlError,
            orgId: organization.id
          })
          progress.update()
          return { success: false, error: `${file.name}: ${urlError || 'Failed to get URL'}` }
        }
        
        logGetLatest('debug', 'Got download URL, removing read-only', {
          operationId,
          fileName: file.name
        })
        
        // Remove read-only before overwriting
        const readonlyOffResult = await window.electronAPI?.setReadonly(fullPath, false)
        if (readonlyOffResult?.success === false) {
          logGetLatest('warn', 'Failed to remove read-only flag', {
            operationId,
            fileName: file.name,
            fullPath,
            error: readonlyOffResult.error
          })
        }
        
        // Download and overwrite the local file
        logGetLatest('debug', 'Downloading file', {
          operationId,
          fileName: file.name,
          fullPath
        })
        
        const downloadResult = await window.electronAPI?.downloadUrl(url, fullPath)
        if (!downloadResult?.success) {
          logGetLatest('error', 'Download failed', {
            operationId,
            ...fileCtx,
            fullPath,
            downloadError: downloadResult?.error,
            downloadResult
          })
          progress.update()
          return { success: false, error: `${file.name}: Download failed - ${downloadResult?.error || 'unknown error'}` }
        }
        
        logGetLatest('debug', 'Download succeeded, setting read-only', {
          operationId,
          fileName: file.name,
          downloadedSize: downloadResult.size,
          downloadedHash: downloadResult.hash?.substring(0, 12)
        })
        
        // Set read-only (file is not checked out)
        const readonlyOnResult = await window.electronAPI?.setReadonly(fullPath, true)
        if (readonlyOnResult?.success === false) {
          logGetLatest('warn', 'Failed to set read-only flag', {
            operationId,
            fileName: file.name,
            error: readonlyOnResult.error
          })
        }
        
        // Queue update for batch processing
        pendingUpdates.push({
          path: file.path,
          updates: {
            localHash: file.pdmData.content_hash,
            diffStatus: undefined // No longer outdated
          }
        })
        
        logGetLatest('info', 'File updated successfully', {
          operationId,
          fileName: file.name,
          newLocalHash: file.pdmData.content_hash?.substring(0, 12)
        })
        
        progress.update()
        return { success: true }
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logGetLatest('error', 'Exception while updating file', {
          operationId,
          ...fileCtx,
          error: errorMsg,
          stack: err instanceof Error ? err.stack : undefined
        })
        progress.update()
        return { success: false, error: `${file.name}: ${errorMsg}` }
      }
    }))
    
    // Apply all store updates in a single batch
    if (pendingUpdates.length > 0) {
      logGetLatest('debug', 'Applying store updates', {
        operationId,
        updateCount: pendingUpdates.length,
        paths: pendingUpdates.map(u => u.path)
      })
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
    
    // Clean up
    ctx.removeProcessingFolders(filePaths)
    const { duration } = progress.finish()
    
    logGetLatest('info', 'Get-latest operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      duration,
      errors: errors.length > 0 ? errors : undefined,
      pendingUpdatesApplied: pendingUpdates.length
    })
    
    ctx.onRefresh?.(true)
    
    // Detect "orphaned files" - database has records but storage is missing the actual files
    // This happens when check-in partially failed (database updated but upload failed)
    const objectNotFoundErrors = errors.filter(e => 
      e.includes('Object not found') || 
      e.includes('not found in cloud storage') ||
      e.includes('File not found')
    )
    const isOrphanedFilesSituation = objectNotFoundErrors.length > 0 && objectNotFoundErrors.length === failed
    
    // Show result with helpful message for orphaned files
    if (failed > 0) {
      if (isOrphanedFilesSituation) {
        // All failures are due to missing storage - show modal with affected files
        const fileCount = objectNotFoundErrors.length
        
        // Build list of missing storage files for the modal
        const missingFiles: MissingStorageFile[] = outdatedFiles
          .filter(f => {
            const errorForFile = errors.find(e => e.startsWith(f.name + ':'))
            return errorForFile && (
              errorForFile.includes('Object not found') ||
              errorForFile.includes('not found in cloud storage') ||
              errorForFile.includes('File not found')
            )
          })
          .map(f => ({
            fileId: f.pdmData?.id || '',
            fileName: f.name,
            filePath: f.relativePath,
            serverHash: f.pdmData?.content_hash || '',
            version: f.pdmData?.version || 0,
            detectedAt: new Date().toISOString()
          }))
        
        // Set in store to trigger modal
        if (missingFiles.length > 0) {
          usePDMStore.getState().setMissingStorageFiles(missingFiles)
        }
        
        logGetLatest('warn', 'Orphaned files detected - database records exist but storage files are missing', {
          operationId,
          orphanedCount: fileCount,
          affectedFiles: missingFiles.map(f => f.fileName)
        })
        
        // Don't show a toast - the modal is more informative
      } else {
        ctx.addToast('warning', `Updated ${succeeded}/${total} files`)
      }
    } else {
      ctx.addToast('success', `Updated ${succeeded} file${succeeded > 1 ? 's' : ''}`)
    }
    
    return {
      success: failed === 0,
      message: failed > 0 ? `Updated ${succeeded}/${total} files` : `Updated ${succeeded} file${succeeded > 1 ? 's' : ''}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    }
  }
}

