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
import type { LocalFile } from '../../../stores/pdmStore'

// Concurrency limit for parallel downloads
// Too many concurrent downloads can overwhelm network/Supabase rate limits
const MAX_CONCURRENT_DOWNLOADS = 15

// Number of retry attempts for failed downloads
const MAX_RETRY_ATTEMPTS = 3

// Delay between retries (exponential backoff: 1s, 2s, 4s)
const RETRY_BASE_DELAY_MS = 1000

/**
 * Simple concurrency limiter for async operations
 * Allows running up to `limit` promises concurrently
 */
function createConcurrencyLimiter(limit: number) {
  let running = 0
  const queue: Array<() => void> = []
  
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a slot if at capacity
    if (running >= limit) {
      await new Promise<void>(resolve => queue.push(resolve))
    }
    
    running++
    try {
      return await fn()
    } finally {
      running--
      // Release next waiting task
      const next = queue.shift()
      if (next) next()
    }
  }
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Detailed logging for download operations
function logDownload(level: 'info' | 'warn' | 'error' | 'debug', message: string, context: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  const logData = { timestamp, ...context }
  
  const prefix = '[Download]'
  if (level === 'error') {
    console.error(prefix, message, logData)
  } else if (level === 'warn') {
    console.warn(prefix, message, logData)
  } else if (level === 'debug') {
    console.debug(prefix, message, logData)
  } else {
    console.log(prefix, message, logData)
  }
  
  // Also log to electron main process
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
    isDirectory: file.isDirectory,
    diffStatus: file.diffStatus,
    fileSize: file.pdmData?.file_size,
    contentHash: file.pdmData?.content_hash ? `${file.pdmData.content_hash.substring(0, 12)}...` : null,
    fileId: file.pdmData?.id,
    version: file.pdmData?.version,
    state: file.pdmData?.workflow_state?.name
  }
}

export const downloadCommand: Command<DownloadParams> = {
  id: 'download',
  name: 'Download',
  description: 'Download cloud files to local vault',
  aliases: ['dl', 'get'],
  usage: 'download <path> [--recursive]',
  
  validate({ files }, ctx) {
    if (ctx.isOfflineMode) {
      return 'Cannot download files while offline'
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
    const operationId = `download-${Date.now()}`
    
    logDownload('info', 'Starting download operation', {
      operationId,
      orgId: organization.id,
      vaultPath,
      selectedFileCount: files.length,
      selectedPaths: files.map(f => f.relativePath)
    })
    
    // Get cloud-only files from selection
    const cloudFiles = getCloudOnlyFilesFromSelection(ctx.files, files)
    const cloudOnlyFolders = files.filter(f => f.isDirectory && (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new'))
    
    logDownload('debug', 'Filtered cloud files', {
      operationId,
      cloudFileCount: cloudFiles.length,
      cloudFolderCount: cloudOnlyFolders.length,
      cloudFiles: cloudFiles.map(f => ({ name: f.name, path: f.relativePath, hash: f.pdmData?.content_hash?.substring(0, 12) }))
    })
    
    // Handle empty cloud-only folders - just create them locally
    if (cloudFiles.length === 0 && cloudOnlyFolders.length > 0) {
      let created = 0
      const createdPaths: string[] = []
      const folderErrors: string[] = []
      
      for (const folder of cloudOnlyFolders) {
        try {
          const fullPath = buildFullPath(vaultPath, folder.relativePath)
          logDownload('debug', 'Creating folder', { operationId, folder: folder.relativePath, fullPath })
          
          const result = await window.electronAPI?.createFolder(fullPath)
          if (result?.success === false) {
            throw new Error(result.error || 'Unknown error creating folder')
          }
          created++
          createdPaths.push(folder.path)
          logDownload('debug', 'Folder created successfully', { operationId, folder: folder.relativePath })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logDownload('error', 'Failed to create folder', { 
            operationId,
            folder: folder.relativePath,
            error: errorMsg
          })
          folderErrors.push(`${folder.name}: ${errorMsg}`)
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
      
      logDownload('info', 'Folder creation complete', {
        operationId,
        created,
        failed: cloudOnlyFolders.length - created,
        errors: folderErrors
      })
      
      return {
        success: true,
        message: `Created ${created} folder${created > 1 ? 's' : ''} locally`,
        total: cloudOnlyFolders.length,
        succeeded: created,
        failed: cloudOnlyFolders.length - created,
        errors: folderErrors.length > 0 ? folderErrors : undefined
      }
    }
    
    if (cloudFiles.length === 0) {
      logDownload('info', 'No cloud files to download', { operationId })
      return {
        success: true,
        message: 'No files to download',
        total: 0,
        succeeded: 0,
        failed: 0
      }
    }
    
    // Track cloud files, selected folders, and all cloud-only folders for spinner display
    // This ensures:
    // 1. Individual cloud files show spinners
    // 2. Parent folders that were selected show spinners  
    // 3. Child cloud-only folders also show spinners
    const cloudFilePaths = cloudFiles.map(f => f.relativePath)
    const selectedFolderPaths = files.filter(f => f.isDirectory).map(f => f.relativePath)
    
    // Find all cloud-only folders that are descendants of selected folders
    const childCloudFolderPaths: string[] = []
    for (const selectedFolder of selectedFolderPaths) {
      const normalizedSelected = selectedFolder.replace(/\\/g, '/')
      // Find cloud folders that are children of this selected folder
      const childFolders = ctx.files.filter(f => {
        if (!f.isDirectory) return false
        if (f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new') return false
        const normalizedPath = f.relativePath.replace(/\\/g, '/')
        return normalizedPath.startsWith(normalizedSelected + '/')
      }).map(f => f.relativePath)
      childCloudFolderPaths.push(...childFolders)
    }
    
    // Combine all paths that need spinners (deduplicated)
    const allPathsToTrack = [...new Set([...cloudFilePaths, ...selectedFolderPaths, ...childCloudFolderPaths])]
    ctx.addProcessingFolders(allPathsToTrack)
    
    // Yield to event loop so React can render spinners before starting download
    // Use 16ms (roughly one frame) to ensure React has time to process state update and re-render
    await new Promise(resolve => setTimeout(resolve, 16))
    
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
    
    // Create concurrency limiter to avoid overwhelming network/Supabase
    const limit = createConcurrencyLimiter(MAX_CONCURRENT_DOWNLOADS)
    
    logDownload('info', 'Starting parallel downloads with concurrency limit', {
      operationId,
      totalFiles: cloudFiles.length,
      maxConcurrent: MAX_CONCURRENT_DOWNLOADS
    })
    
    // Helper function to download a single file with retry logic
    const downloadWithRetry = async (file: LocalFile, attempt: number = 1): Promise<{ success: boolean; error?: string }> => {
      const fileCtx = getFileContext(file)
      
      if (!file.pdmData?.content_hash) {
        logDownload('error', 'File has no content hash', {
          operationId,
          ...fileCtx,
          pdmData: file.pdmData ? {
            id: file.pdmData.id,
            version: file.pdmData.version,
            state: file.pdmData.workflow_state?.name,
            hasHash: !!file.pdmData.content_hash
          } : null
        })
        return { success: false, error: `${file.name}: No content hash - file metadata may be corrupted or incomplete` }
      }
      
      const fullPath = buildFullPath(vaultPath, file.relativePath)
      const parentDir = getParentDir(fullPath)
      
      try {
        logDownload('debug', 'Downloading file', {
          operationId,
          ...fileCtx,
          fullPath,
          parentDir,
          attempt
        })
        
        // Create parent directory
        const mkdirResult = await window.electronAPI?.createFolder(parentDir)
        if (mkdirResult?.success === false) {
          logDownload('error', 'Failed to create parent directory', {
            operationId,
            ...fileCtx,
            parentDir,
            error: mkdirResult.error
          })
          return { success: false, error: `${file.name}: Failed to create directory - ${mkdirResult.error}` }
        }
        
        // Get signed URL
        logDownload('debug', 'Getting signed URL', {
          operationId,
          fileName: file.name,
          orgId: organization.id,
          hash: file.pdmData.content_hash?.substring(0, 12),
          attempt
        })
        
        const { url, error: urlError } = await getDownloadUrl(organization.id, file.pdmData.content_hash)
        if (urlError || !url) {
          logDownload('error', 'Failed to get download URL', {
            operationId,
            ...fileCtx,
            urlError,
            orgId: organization.id,
            hash: file.pdmData.content_hash?.substring(0, 16)
          })
          return { success: false, error: `${file.name}: ${urlError || 'Failed to get download URL - file may not exist in cloud storage'}` }
        }
        
        // Download file
        logDownload('debug', 'Starting file download', {
          operationId,
          fileName: file.name,
          destPath: fullPath,
          attempt
        })
        
        const downloadResult = await window.electronAPI?.downloadUrl(url, fullPath)
        if (!downloadResult?.success) {
          const errorMsg = downloadResult?.error || 'Unknown error writing to disk'
          const isRetryable = errorMsg.includes('timed out') || 
                              errorMsg.includes('ECONNRESET') || 
                              errorMsg.includes('ETIMEDOUT') ||
                              errorMsg.includes('socket hang up') ||
                              errorMsg.includes('Connection')
          
          // Retry on timeout/connection errors
          if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
            const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
            logDownload('warn', 'Download failed, retrying...', {
              operationId,
              fileName: file.name,
              attempt,
              maxAttempts: MAX_RETRY_ATTEMPTS,
              error: errorMsg,
              retryDelayMs: delayMs
            })
            await sleep(delayMs)
            return downloadWithRetry(file, attempt + 1)
          }
          
          logDownload('error', 'File download failed', {
            operationId,
            ...fileCtx,
            fullPath,
            downloadError: errorMsg,
            downloadResult,
            attempt,
            willRetry: false
          })
          return { success: false, error: `${file.name}: Download failed - ${errorMsg}` }
        }
        
        // Set read-only
        const readonlyResult = await window.electronAPI?.setReadonly(fullPath, true)
        if (readonlyResult?.success === false) {
          logDownload('warn', 'Failed to set read-only flag', {
            operationId,
            fileName: file.name,
            fullPath,
            error: readonlyResult.error
          })
          // Don't fail the download for this
        }
        
        logDownload('debug', 'File download complete', {
          operationId,
          fileName: file.name,
          fullPath,
          downloadedSize: downloadResult.size,
          hash: downloadResult.hash?.substring(0, 12),
          attempt
        })
        
        return { success: true }
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        
        // Retry on exceptions that look like network errors
        const isRetryable = errorMsg.includes('timed out') || 
                            errorMsg.includes('ECONNRESET') || 
                            errorMsg.includes('ETIMEDOUT') ||
                            errorMsg.includes('socket hang up') ||
                            errorMsg.includes('Connection')
        
        if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
          logDownload('warn', 'Download exception, retrying...', {
            operationId,
            fileName: file.name,
            attempt,
            maxAttempts: MAX_RETRY_ATTEMPTS,
            error: errorMsg,
            retryDelayMs: delayMs
          })
          await sleep(delayMs)
          return downloadWithRetry(file, attempt + 1)
        }
        
        logDownload('error', 'Download exception', {
          operationId,
          ...fileCtx,
          fullPath,
          error: errorMsg,
          stack: err instanceof Error ? err.stack : undefined,
          attempt
        })
        return { success: false, error: `${file.name}: ${errorMsg}` }
      }
    }
    
    // Process all files with concurrency limit
    const results = await Promise.all(cloudFiles.map(file => 
      limit(async () => {
        const result = await downloadWithRetry(file)
        progress.update()
        return result
      })
    ))
    
    // Count results
    for (const result of results) {
      if (result.success) succeeded++
      else {
        failed++
        if (result.error) errors.push(result.error)
      }
    }
    
    // Clean up - use batch remove to avoid N state updates
    ctx.removeProcessingFolders(allPathsToTrack)
    const { duration } = progress.finish()
    ctx.onRefresh?.(true)
    
    // Log final result
    logDownload(failed > 0 ? 'warn' : 'info', 'Download operation complete', {
      operationId,
      total,
      succeeded,
      failed,
      duration,
      errors: errors.length > 0 ? errors : undefined
    })
    
    // Show result
    if (failed > 0) {
      // Log errors more prominently
      logDownload('error', 'Some files failed to download', {
        operationId,
        failedCount: failed,
        errors
      })
      // Show first error in toast for visibility
      const firstError = errors[0] || 'Unknown error'
      const moreText = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
      ctx.addToast('error', `Download failed: ${firstError}${moreText}`)
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

