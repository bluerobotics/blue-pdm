// File system handlers for Electron main process
import { ipcMain, BrowserWindow, shell, dialog, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Module-level state
let mainWindow: BrowserWindow | null = null
let workingDirectory: string | null = null
let fileWatcher: FSWatcher | null = null
let pendingDeleteOperations = 0
let deleteWatcherStopPromise: Promise<void> | null = null

// Hash cache to avoid recomputing hashes for unchanged files
const hashCache = new Map<string, { size: number; mtime: number; hash: string }>()

// Track delete operations for debugging
let deleteOperationCounter = 0

// External log function reference (will be set during registration)
let log: (message: string, data?: unknown) => void = console.log
let logDebug: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error
let logWarn: (message: string, data?: unknown) => void = console.warn

// External thumbnail tracking function reference
let isFileBeingThumbnailed: (filePath: string) => boolean = () => false
let thumbnailsInProgress: Set<string> = new Set()

// Helper to restore focus to main window after dialogs
let restoreMainWindowFocus: () => void = () => {}

// Local file info interface
interface LocalFileInfo {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  extension: string
  size: number
  modifiedTime: string
  hash?: string
}

// Calculate SHA-256 hash of a file
function hashFileSync(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

// Helper to recursively copy a directory
function copyDirSync(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true })
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// Helper to recursively get all files in a directory with relative paths
function getAllFilesInDir(dirPath: string, _baseFolder: string): Array<{ name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }> {
  const files: Array<{ name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }> = []
  
  function walkDir(currentPath: string) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true })
      for (const item of items) {
        if (item.name.startsWith('.')) continue
        
        const fullPath = path.join(currentPath, item.name)
        
        if (item.isDirectory()) {
          walkDir(fullPath)
        } else {
          const stats = fs.statSync(fullPath)
          const relativePath = path.relative(path.dirname(dirPath), fullPath).replace(/\\/g, '/')
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            extension: path.extname(item.name).toLowerCase(),
            size: stats.size,
            modifiedTime: stats.mtime.toISOString()
          })
        }
      }
    } catch (err) {
      log('Error walking directory: ' + String(err))
    }
  }
  
  walkDir(dirPath)
  return files
}

// Try to find what process has a file locked using Windows commands
async function findLockingProcess(filePath: string): Promise<string | null> {
  const fileName = path.basename(filePath)
  
  try {
    // Method 1: Try handle.exe / handle64.exe from Sysinternals
    for (const handleExe of ['handle64.exe', 'handle.exe']) {
      try {
        const { stdout } = await execAsync(`${handleExe} -accepteula "${fileName}" 2>nul`, { timeout: 5000 })
        if (stdout && stdout.trim() && !stdout.includes('No matching handles found')) {
          const lines = stdout.split('\n').filter((l: string) => l.includes(fileName) || l.match(/^\w+\.exe/i))
          if (lines.length > 0) {
            log(`[LockDetect] ${handleExe} output:\n${stdout.trim()}`)
            return `${handleExe}: ${lines.slice(0, 3).join(' | ')}`
          }
        }
      } catch {
        // handle.exe not available
      }
    }
    
    // Method 2: Try PowerShell to check for processes
    try {
      const psCommand = `Get-Process | Where-Object { $_.Path -like '*SolidWorks*' -or $_.ProcessName -like '*SLDWORKS*' -or $_.ProcessName -like '*explorer*' } | Select-Object ProcessName, Id | ConvertTo-Json`
      const { stdout } = await execAsync(`powershell -Command "${psCommand}"`, { timeout: 5000 })
      if (stdout && stdout.trim()) {
        const processes = JSON.parse(stdout)
        const procList = Array.isArray(processes) ? processes : [processes]
        if (procList.length > 0) {
          const procInfo = procList.map((p: { ProcessName: string; Id: number }) => `${p.ProcessName}(${p.Id})`).join(', ')
          log(`[LockDetect] Potential locking processes: ${procInfo}`)
          return `Potential: ${procInfo}`
        }
      }
    } catch (e) {
      log(`[LockDetect] PowerShell check failed: ${e}`)
    }
    
    // Method 3: Check for SolidWorks temp files
    const dir = path.dirname(filePath)
    const baseName = path.basename(filePath, path.extname(filePath))
    const tempFile = path.join(dir, `~$${baseName}${path.extname(filePath)}`)
    if (fs.existsSync(tempFile)) {
      log(`[LockDetect] Found SolidWorks temp file: ${tempFile}`)
      return `SolidWorks temp file exists: ~$${fileName} (file is open in SolidWorks)`
    }
    
    // Method 4: Try to open the file exclusively
    try {
      const fd = fs.openSync(filePath, fs.constants.O_RDWR | fs.constants.O_EXCL)
      fs.closeSync(fd)
      log(`[LockDetect] File is NOT locked (opened successfully)`)
      return null
    } catch (openErr: unknown) {
      const nodeErr = openErr as NodeJS.ErrnoException
      if (nodeErr.code === 'EBUSY' || nodeErr.code === 'EACCES') {
        log(`[LockDetect] Confirmed file is locked: ${nodeErr.code}`)
        return `File is locked (${nodeErr.code}) but process unknown`
      }
    }
    
    return null
  } catch (err) {
    log(`[LockDetect] Detection failed: ${err}`)
    return null
  }
}

// Stop file watcher
async function stopFileWatcher(): Promise<void> {
  if (fileWatcher) {
    log('Stopping file watcher')
    const watcher = fileWatcher
    fileWatcher = null
    await watcher.close()
    log('File watcher closed')
  }
}

// File watcher for detecting external changes
function startFileWatcher(dirPath: string) {
  stopFileWatcher()
  
  log('Starting file watcher for: ' + dirPath)
  
  let debounceTimer: NodeJS.Timeout | null = null
  const changedFiles = new Set<string>()
  
  fileWatcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    },
    ignorePermissionErrors: true,
    ignored: [
      /(^|[\/\\])\../,
      /node_modules/,
      /\.git/,
      /desktop\.ini/i,
      /thumbs\.db/i,
      /\$RECYCLE\.BIN/i,
      /System Volume Information/i,
      /~\$/,
      /\.tmp$/i,
      /\.swp$/i
    ]
  })
  
  const notifyChanges = () => {
    if (changedFiles.size > 0 && mainWindow) {
      const files = Array.from(changedFiles)
      changedFiles.clear()
      log('File changes detected: ' + files.length + ' files')
      mainWindow.webContents.send('files-changed', files)
    }
    debounceTimer = null
  }
  
  const handleChange = (filePath: string) => {
    const relativePath = path.relative(dirPath, filePath).replace(/\\/g, '/')
    changedFiles.add(relativePath)
    
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    const delay = changedFiles.size > 10 ? 2000 : 1000
    debounceTimer = setTimeout(notifyChanges, delay)
  }
  
  fileWatcher.on('change', handleChange)
  fileWatcher.on('add', handleChange)
  fileWatcher.on('unlink', handleChange)
  
  fileWatcher.on('error', (error: unknown) => {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return
    }
    log('File watcher error: ' + String(error))
  })
}

// Native file drag icon
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABjSURBVFhH7c0xDQAgDAXQskKxgBUsYAErWMECFv7OwEImXEOTN/wdPwEAAAAAAACU7F0z27sZuweeAAAAAAAAlOzdM9u7GbsHngAAAAAAAJTs3TPbuxm7B56AAAAAgF9mZgO0VARYFxh/1QAAAABJRU5ErkJggg=='
)

// Export getters for module state
export function getWorkingDirectory(): string | null {
  return workingDirectory
}

export function setWorkingDirectoryExternal(dir: string | null): void {
  workingDirectory = dir
}

export function clearHashCache(): void {
  hashCache.clear()
}

export interface FsHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logDebug: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
  logWarn: (message: string, data?: unknown) => void
  isFileBeingThumbnailed: (filePath: string) => boolean
  thumbnailsInProgress: Set<string>
  restoreMainWindowFocus: () => void
}

export function registerFsHandlers(window: BrowserWindow, deps: FsHandlerDependencies): void {
  mainWindow = window
  log = deps.log
  logDebug = deps.logDebug
  logError = deps.logError
  logWarn = deps.logWarn
  isFileBeingThumbnailed = deps.isFileBeingThumbnailed
  thumbnailsInProgress = deps.thumbnailsInProgress
  restoreMainWindowFocus = deps.restoreMainWindowFocus

  // Working directory handlers
  ipcMain.handle('working-dir:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Working Directory',
      properties: ['openDirectory', 'createDirectory']
    })
    
    restoreMainWindowFocus()
    
    if (!result.canceled && result.filePaths.length > 0) {
      workingDirectory = result.filePaths[0]
      hashCache.clear()
      log('Working directory set: ' + workingDirectory)
      startFileWatcher(workingDirectory)
      return { success: true, path: workingDirectory }
    }
    return { success: false, canceled: true }
  })

  ipcMain.handle('working-dir:get', () => workingDirectory)

  ipcMain.handle('working-dir:clear', async () => {
    log('Clearing working directory and stopping file watcher')
    await stopFileWatcher()
    workingDirectory = null
    hashCache.clear()
    return { success: true }
  })

  ipcMain.handle('working-dir:set', async (_, newPath: string) => {
    if (fs.existsSync(newPath)) {
      workingDirectory = newPath
      hashCache.clear()
      startFileWatcher(newPath)
      return { success: true, path: workingDirectory }
    }
    return { success: false, error: 'Path does not exist' }
  })

  ipcMain.handle('working-dir:create', async (_, newPath: string) => {
    try {
      let expandedPath = newPath
      if (newPath.startsWith('~')) {
        const os = require('os')
        expandedPath = newPath.replace(/^~/, os.homedir())
      }
      
      if (!fs.existsSync(expandedPath)) {
        fs.mkdirSync(expandedPath, { recursive: true })
        log('Created working directory: ' + expandedPath)
      }
      workingDirectory = expandedPath
      hashCache.clear()
      startFileWatcher(expandedPath)
      return { success: true, path: workingDirectory }
    } catch (err) {
      log('Error creating working directory: ' + String(err))
      return { success: false, error: String(err) }
    }
  })

  // File read/write handlers
  ipcMain.handle('fs:read-file', async (_, filePath: string) => {
    try {
      const data = fs.readFileSync(filePath)
      const hash = crypto.createHash('sha256').update(data).digest('hex')
      return { 
        success: true, 
        data: data.toString('base64'), 
        size: data.length,
        hash 
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:write-file', async (_, filePath: string, base64Data: string) => {
    logDebug('Writing file', { filePath, dataLength: base64Data?.length })
    
    try {
      if (!filePath) {
        logError('Write file: missing file path')
        return { success: false, error: 'Missing file path' }
      }
      
      if (!base64Data) {
        logError('Write file: missing data', { filePath })
        return { success: false, error: 'Missing file data' }
      }
      
      const buffer = Buffer.from(base64Data, 'base64')
      logDebug('Decoded buffer', { filePath, bufferSize: buffer.length })
      
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        logDebug('Creating parent directory', { dir })
        try {
          fs.mkdirSync(dir, { recursive: true })
        } catch (mkdirErr) {
          const nodeErr = mkdirErr as NodeJS.ErrnoException
          logError('Failed to create parent directory', {
            dir,
            error: String(mkdirErr),
            code: nodeErr.code
          })
          return { success: false, error: `Failed to create directory: ${mkdirErr}` }
        }
      }
      
      try {
        fs.accessSync(dir, fs.constants.W_OK)
      } catch {
        logError('No write permission', { dir, filePath })
        return { success: false, error: `No write permission to directory: ${dir}` }
      }
      
      fs.writeFileSync(filePath, buffer)
      
      const hash = crypto.createHash('sha256').update(buffer).digest('hex')
      
      logDebug('File written successfully', {
        filePath,
        size: buffer.length,
        hash: hash.substring(0, 12) + '...'
      })
      
      return { success: true, hash, size: buffer.length }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      logError('Write file error', {
        filePath,
        error: String(err),
        code: nodeErr.code,
        syscall: nodeErr.syscall
      })
      
      let errorMsg = String(err)
      if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
        errorMsg = `Permission denied: Cannot write to ${filePath}`
      } else if (nodeErr.code === 'ENOSPC') {
        errorMsg = `Disk full: Not enough space to write file`
      } else if (nodeErr.code === 'EROFS') {
        errorMsg = `Read-only file system: Cannot write files`
      } else if (nodeErr.code === 'EBUSY') {
        errorMsg = `File is busy/locked: ${filePath}`
      } else if (nodeErr.code === 'ENAMETOOLONG') {
        errorMsg = `Path too long: ${filePath.length} characters`
      }
      
      return { success: false, error: errorMsg }
    }
  })

  // Download file directly in main process
  ipcMain.handle('fs:download-url', async (event, url: string, destPath: string) => {
    const operationId = `dl-${Date.now()}`
    const startTime = Date.now()
    
    logDebug(`[${operationId}] Starting download`, {
      destPath,
      urlLength: url?.length,
      urlPrefix: url?.substring(0, 80) + '...'
    })
    
    try {
      if (!url) {
        logError(`[${operationId}] Missing URL parameter`)
        return { success: false, error: 'Missing URL parameter' }
      }
      
      if (!destPath) {
        logError(`[${operationId}] Missing destination path parameter`)
        return { success: false, error: 'Missing destination path parameter' }
      }
      
      const dir = path.dirname(destPath)
      logDebug(`[${operationId}] Ensuring directory exists`, { dir })
      
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true })
          logDebug(`[${operationId}] Created directory`, { dir })
        } catch (mkdirErr) {
          logError(`[${operationId}] Failed to create directory`, {
            dir,
            error: String(mkdirErr),
            code: (mkdirErr as NodeJS.ErrnoException).code
          })
          return { success: false, error: `Failed to create directory: ${mkdirErr}` }
        }
      }
      
      try {
        fs.accessSync(dir, fs.constants.W_OK)
      } catch (accessErr) {
        logError(`[${operationId}] No write permission to directory`, {
          dir,
          error: String(accessErr),
          code: (accessErr as NodeJS.ErrnoException).code
        })
        return { success: false, error: `No write permission to directory: ${dir}` }
      }
      
      const https = await import('https')
      const http = await import('http')
      const client = url.startsWith('https') ? https : http
      
      const REQUEST_TIMEOUT_MS = 120000
      
      return new Promise((resolve) => {
        logDebug(`[${operationId}] Initiating HTTP request`, { timeoutMs: REQUEST_TIMEOUT_MS })
        
        const request = client.get(url, { timeout: REQUEST_TIMEOUT_MS }, (response) => {
          logDebug(`[${operationId}] Got response`, {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: {
              contentLength: response.headers['content-length'],
              contentType: response.headers['content-type']
            }
          })
          
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location
            logDebug(`[${operationId}] Following redirect`, { redirectUrl: redirectUrl?.substring(0, 80) })
            
            if (redirectUrl) {
              const redirectClient = redirectUrl.startsWith('https') ? https : http
              const redirectRequest = redirectClient.get(redirectUrl, { timeout: REQUEST_TIMEOUT_MS }, (redirectResponse) => {
                logDebug(`[${operationId}] Redirect response`, {
                  statusCode: redirectResponse.statusCode,
                  statusMessage: redirectResponse.statusMessage
                })
                handleResponse(redirectResponse)
              })
              redirectRequest.on('error', (err) => {
                logError(`[${operationId}] Redirect request error`, {
                  error: String(err),
                  code: (err as NodeJS.ErrnoException).code
                })
                resolve({ success: false, error: `Redirect failed: ${err}` })
              })
              redirectRequest.on('timeout', () => {
                logError(`[${operationId}] Redirect request timeout`)
                redirectRequest.destroy()
                resolve({ success: false, error: 'Request timed out (during redirect)' })
              })
              return
            }
          }
          handleResponse(response)
        })
        
        request.on('error', (err) => {
          const nodeErr = err as NodeJS.ErrnoException & { hostname?: string }
          logError(`[${operationId}] HTTP request error`, {
            error: String(err),
            code: nodeErr.code,
            syscall: nodeErr.syscall,
            hostname: nodeErr.hostname
          })
          
          let errorMsg = String(err)
          if (nodeErr.code === 'ENOTFOUND') {
            errorMsg = `Network error: Could not reach server. Check your internet connection.`
          } else if (nodeErr.code === 'ECONNREFUSED') {
            errorMsg = `Connection refused by server.`
          } else if (nodeErr.code === 'ETIMEDOUT') {
            errorMsg = `Connection timed out. The server may be slow or unreachable.`
          } else if (nodeErr.code === 'ECONNRESET') {
            errorMsg = `Connection reset. The download was interrupted.`
          }
          
          resolve({ success: false, error: errorMsg })
        })
        
        request.on('timeout', () => {
          logError(`[${operationId}] Request timeout`)
          request.destroy()
          resolve({ success: false, error: 'Request timed out' })
        })
        
        function handleResponse(response: typeof http.IncomingMessage.prototype) {
          if (response.statusCode !== 200) {
            logError(`[${operationId}] HTTP error status`, {
              statusCode: response.statusCode,
              statusMessage: response.statusMessage,
              headers: response.headers
            })
            
            let errorMsg = `HTTP ${response.statusCode}: ${response.statusMessage || 'Unknown error'}`
            if (response.statusCode === 404) {
              errorMsg = `File not found on server (HTTP 404). The download URL may have expired.`
            } else if (response.statusCode === 403) {
              errorMsg = `Access denied (HTTP 403). The download URL may have expired or you don't have permission.`
            } else if (response.statusCode === 500) {
              errorMsg = `Server error (HTTP 500). Please try again later.`
            } else if (response.statusCode === 503) {
              errorMsg = `Service unavailable (HTTP 503). The server may be overloaded.`
            }
            
            resolve({ success: false, error: errorMsg })
            return
          }
          
          const contentLength = parseInt(response.headers['content-length'] || '0', 10)
          logDebug(`[${operationId}] Starting file write`, {
            destPath,
            contentLength,
            contentType: response.headers['content-type']
          })
          
          let writeStream: fs.WriteStream
          try {
            writeStream = fs.createWriteStream(destPath)
          } catch (createErr) {
            logError(`[${operationId}] Failed to create write stream`, {
              destPath,
              error: String(createErr),
              code: (createErr as NodeJS.ErrnoException).code
            })
            resolve({ success: false, error: `Failed to create file: ${createErr}` })
            return
          }
          
          const hashStream = crypto.createHash('sha256')
          
          let downloaded = 0
          let lastProgressTime = Date.now()
          let lastDownloaded = 0
          
          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            hashStream.update(chunk)
            
            const now = Date.now()
            if (now - lastProgressTime >= 100) {
              const bytesSinceLast = downloaded - lastDownloaded
              const timeSinceLast = (now - lastProgressTime) / 1000
              const speed = timeSinceLast > 0 ? bytesSinceLast / timeSinceLast : 0
              
              event.sender.send('download-progress', {
                loaded: downloaded,
                total: contentLength,
                speed
              })
              
              lastProgressTime = now
              lastDownloaded = downloaded
            }
          })
          
          response.on('error', (err: Error) => {
            logError(`[${operationId}] Response stream error`, {
              error: String(err),
              downloaded,
              contentLength
            })
            writeStream.destroy()
            try { fs.unlinkSync(destPath) } catch {}
            resolve({ success: false, error: `Download stream error: ${err}` })
          })
          
          response.pipe(writeStream)
          
          writeStream.on('finish', () => {
            const hash = hashStream.digest('hex')
            const duration = Date.now() - startTime
            
            log(`[${operationId}] Download complete`, {
              destPath,
              size: downloaded,
              hash: hash.substring(0, 12) + '...',
              duration,
              speedMBps: (downloaded / 1024 / 1024 / (duration / 1000)).toFixed(2)
            })
            
            resolve({ success: true, hash, size: downloaded })
          })
          
          writeStream.on('error', (err) => {
            const nodeErr = err as NodeJS.ErrnoException
            logError(`[${operationId}] Write stream error`, {
              destPath,
              error: String(err),
              code: nodeErr.code,
              downloaded,
              contentLength
            })
            
            let errorMsg = `Failed to write file: ${err}`
            if (nodeErr.code === 'ENOSPC') {
              errorMsg = `Disk full: Not enough space to save the file.`
            } else if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
              errorMsg = `Permission denied: Cannot write to ${destPath}`
            } else if (nodeErr.code === 'EROFS') {
              errorMsg = `Read-only file system: Cannot write files.`
            }
            
            try { fs.unlinkSync(destPath) } catch {}
            resolve({ success: false, error: errorMsg })
          })
        }
      })
    } catch (err) {
      const duration = Date.now() - startTime
      logError(`[${operationId}] Download exception`, {
        destPath,
        error: String(err),
        stack: (err as Error).stack,
        duration
      })
      return { success: false, error: `Download failed: ${err}` }
    }
  })

  ipcMain.handle('fs:file-exists', async (_, filePath: string) => {
    return fs.existsSync(filePath)
  })

  ipcMain.handle('fs:get-hash', async (_, filePath: string) => {
    try {
      const hash = hashFileSync(filePath)
      return { success: true, hash }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // List files from any directory
  ipcMain.handle('fs:list-dir-files', async (_, dirPath: string) => {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return { success: false, error: 'Directory does not exist' }
    }
    
    const files: LocalFileInfo[] = []
    
    function walkDir(dir: string, baseDir: string) {
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true })
        
        for (const item of items) {
          if (item.name.startsWith('.')) continue
          
          const fullPath = path.join(dir, item.name)
          const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
          const stats = fs.statSync(fullPath)
          
          if (item.isDirectory()) {
            files.push({
              name: item.name,
              path: fullPath,
              relativePath,
              isDirectory: true,
              extension: '',
              size: 0,
              modifiedTime: stats.mtime.toISOString()
            })
            walkDir(fullPath, baseDir)
          } else {
            let fileHash: string | undefined
            try {
              const fileData = fs.readFileSync(fullPath)
              fileHash = crypto.createHash('sha256').update(fileData).digest('hex')
            } catch {
              // Skip hash if file can't be read
            }
            
            files.push({
              name: item.name,
              path: fullPath,
              relativePath,
              isDirectory: false,
              extension: path.extname(item.name).toLowerCase(),
              size: stats.size,
              modifiedTime: stats.mtime.toISOString(),
              hash: fileHash
            })
          }
        }
      } catch (err) {
        log('Error reading directory: ' + String(err))
      }
    }
    
    walkDir(dirPath, dirPath)
    
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.relativePath.localeCompare(b.relativePath)
    })
    
    return { success: true, files }
  })

  // Fast file listing - no hash computation
  ipcMain.handle('fs:list-working-files', async () => {
    if (!workingDirectory) {
      return { success: false, error: 'No working directory set' }
    }
    
    const files: LocalFileInfo[] = []
    const seenPaths = new Set<string>()
    
    function walkDir(dir: string, baseDir: string) {
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true })
        
        for (const item of items) {
          if (item.name.startsWith('.')) continue
          
          const fullPath = path.join(dir, item.name)
          const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
          const stats = fs.statSync(fullPath)
          
          if (item.isDirectory()) {
            files.push({
              name: item.name,
              path: fullPath,
              relativePath,
              isDirectory: true,
              extension: '',
              size: 0,
              modifiedTime: stats.mtime.toISOString()
            })
            walkDir(fullPath, baseDir)
          } else {
            seenPaths.add(relativePath)
            
            let fileHash: string | undefined
            const cached = hashCache.get(relativePath)
            const mtimeMs = stats.mtime.getTime()
            
            if (cached && cached.size === stats.size && cached.mtime === mtimeMs) {
              fileHash = cached.hash
            }
            
            files.push({
              name: item.name,
              path: fullPath,
              relativePath,
              isDirectory: false,
              extension: path.extname(item.name).toLowerCase(),
              size: stats.size,
              modifiedTime: stats.mtime.toISOString(),
              hash: fileHash
            })
          }
        }
      } catch (err) {
        log('Error reading directory: ' + String(err))
      }
    }
    
    walkDir(workingDirectory, workingDirectory)
    
    // Clean up cache entries for files that no longer exist
    Array.from(hashCache.keys()).forEach(cachedPath => {
      if (!seenPaths.has(cachedPath)) {
        hashCache.delete(cachedPath)
      }
    })
    
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.relativePath.localeCompare(b.relativePath)
    })
    
    return { success: true, files }
  })

  // Compute hashes for files in batches
  ipcMain.handle('fs:compute-file-hashes', async (event, filePaths: Array<{ path: string; relativePath: string; size: number; mtime: number }>) => {
    if (!workingDirectory) {
      return { success: false, error: 'No working directory set' }
    }
    
    const results: Array<{ relativePath: string; hash: string }> = []
    const batchSize = 20
    let processed = 0
    const total = filePaths.length
    
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize)
      
      for (const file of batch) {
        try {
          const cached = hashCache.get(file.relativePath)
          if (cached && cached.size === file.size && cached.mtime === file.mtime) {
            results.push({ relativePath: file.relativePath, hash: cached.hash })
            processed++
            continue
          }
          
          const fileData = fs.readFileSync(file.path)
          const hash = crypto.createHash('sha256').update(fileData).digest('hex')
          
          hashCache.set(file.relativePath, { size: file.size, mtime: file.mtime, hash })
          
          results.push({ relativePath: file.relativePath, hash })
          processed++
        } catch {
          hashCache.delete(file.relativePath)
          processed++
        }
      }
      
      const percent = Math.round((processed / total) * 100)
      event.sender.send('hash-progress', { processed, total, percent })
      
      await new Promise(resolve => setImmediate(resolve))
    }
    
    return { success: true, results }
  })

  ipcMain.handle('fs:create-folder', async (_, folderPath: string) => {
    logDebug('Creating folder', { folderPath })
    
    try {
      if (!folderPath) {
        logError('Create folder: missing path parameter')
        return { success: false, error: 'Missing folder path' }
      }
      
      if (fs.existsSync(folderPath)) {
        const stats = fs.statSync(folderPath)
        if (stats.isDirectory()) {
          logDebug('Folder already exists', { folderPath })
          return { success: true }
        } else {
          logError('Path exists but is not a directory', { folderPath })
          return { success: false, error: 'Path exists but is not a directory' }
        }
      }
      
      fs.mkdirSync(folderPath, { recursive: true })
      logDebug('Folder created successfully', { folderPath })
      return { success: true }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      logError('Failed to create folder', {
        folderPath,
        error: String(err),
        code: nodeErr.code,
        syscall: nodeErr.syscall
      })
      
      let errorMsg = String(err)
      if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
        errorMsg = `Permission denied: Cannot create folder at ${folderPath}`
      } else if (nodeErr.code === 'ENOSPC') {
        errorMsg = `Disk full: Cannot create folder`
      } else if (nodeErr.code === 'ENOENT') {
        errorMsg = `Invalid path: Parent directory does not exist`
      } else if (nodeErr.code === 'ENAMETOOLONG') {
        errorMsg = `Path too long: ${folderPath.length} characters`
      } else if (nodeErr.code === 'EROFS') {
        errorMsg = `Read-only file system: Cannot create folders`
      }
      
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle('fs:is-dir-empty', async (_, dirPath: string) => {
    try {
      if (!fs.existsSync(dirPath)) {
        return { success: false, error: 'Directory does not exist' }
      }
      const stat = fs.statSync(dirPath)
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory' }
      }
      const entries = fs.readdirSync(dirPath)
      return { success: true, empty: entries.length === 0 }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:delete', async (_, targetPath: string) => {
    const deleteStartTime = Date.now()
    const fileName = path.basename(targetPath)
    const deleteOpId = ++deleteOperationCounter
    
    try {
      log(`[Delete #${deleteOpId}] START: ${fileName}`)
      log(`[Delete #${deleteOpId}] Full path: ${targetPath}`)
      
      if (!fs.existsSync(targetPath)) {
        log(`[Delete #${deleteOpId}] Path does not exist: ${targetPath}`)
        return { success: false, error: 'Path does not exist' }
      }
      
      try {
        const preStats = fs.statSync(targetPath)
        log(`[Delete #${deleteOpId}] File stats - size: ${preStats.size}, mode: ${preStats.mode.toString(8)}, isFile: ${preStats.isFile()}`)
      } catch (e) {
        log(`[Delete #${deleteOpId}] Could not stat file: ${e}`)
      }
      
      if (isFileBeingThumbnailed(targetPath)) {
        log(`[Delete #${deleteOpId}] WARNING: File is currently being thumbnailed! Waiting 200ms...`)
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
      if (thumbnailsInProgress.size > 0) {
        log(`[Delete #${deleteOpId}] Files currently being thumbnailed: ${Array.from(thumbnailsInProgress).map(p => path.basename(p)).join(', ')}`)
      }
      
      const needsWatcherPause = workingDirectory && (
        targetPath === workingDirectory || 
        workingDirectory.startsWith(targetPath) ||
        targetPath.startsWith(workingDirectory)
      )
      
      log(`[Delete #${deleteOpId}] Needs watcher pause: ${needsWatcherPause}, workingDirectory: ${workingDirectory}`)
      
      if (needsWatcherPause) {
        pendingDeleteOperations++
        log(`[Delete #${deleteOpId}] Pending delete ops: ${pendingDeleteOperations}, fileWatcher exists: ${!!fileWatcher}`)
        
        if (pendingDeleteOperations === 1) {
          log(`[Delete #${deleteOpId}] First delete op - stopping file watcher...`)
          const watcherStopStart = Date.now()
          
          deleteWatcherStopPromise = (async () => {
            await stopFileWatcher()
            log(`[Delete] File watcher stopped in ${Date.now() - watcherStopStart}ms`)
            await new Promise(resolve => setTimeout(resolve, 100))
            log(`[Delete] Buffer wait complete, total watcher stop time: ${Date.now() - watcherStopStart}ms`)
          })()
        }
        
        if (deleteWatcherStopPromise) {
          log(`[Delete #${deleteOpId}] Waiting for watcher stop promise...`)
          await deleteWatcherStopPromise
          log(`[Delete #${deleteOpId}] Watcher stop promise resolved`)
        }
      }
      
      const attemptDelete = async (filePath: string, isFile: boolean, retries = 3): Promise<{ success: boolean, error?: string }> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          log(`[Delete #${deleteOpId}] Attempt ${attempt}/${retries} for: ${fileName}`)
          
          try {
            log(`[Delete #${deleteOpId}] Trying shell.trashItem...`)
            await shell.trashItem(filePath)
            log(`[Delete #${deleteOpId}] SUCCESS via Recycle Bin: ${fileName} (attempt ${attempt})`)
            return { success: true }
          } catch (trashErr) {
            log(`[Delete #${deleteOpId}] shell.trashItem failed: ${trashErr}`)
            
            try {
              log(`[Delete #${deleteOpId}] Trying fs.${isFile ? 'unlinkSync' : 'rmSync'}...`)
              if (isFile) {
                fs.unlinkSync(filePath)
              } else {
                fs.rmSync(filePath, { recursive: true, force: true })
              }
              log(`[Delete #${deleteOpId}] SUCCESS via fs delete: ${fileName} (attempt ${attempt})`)
              return { success: true }
            } catch (deleteErr) {
              const errStr = String(deleteErr)
              const isLocked = errStr.includes('EBUSY') || errStr.includes('resource busy')
              
              log(`[Delete #${deleteOpId}] fs delete failed: ${errStr}`)
              log(`[Delete #${deleteOpId}] Is locked (EBUSY): ${isLocked}`)
              
              if (isLocked) {
                log(`[Delete #${deleteOpId}] Attempting to detect locking process...`)
                const lockInfo = await findLockingProcess(filePath)
                if (lockInfo) {
                  log(`[Delete #${deleteOpId}] LOCK DETECTION: ${lockInfo}`)
                } else {
                  log(`[Delete #${deleteOpId}] LOCK DETECTION: Could not determine locking process`)
                }
              }
              
              if (isLocked && attempt < retries) {
                const delay = attempt * 300
                log(`[Delete #${deleteOpId}] File locked, waiting ${delay}ms before retry...`)
                await new Promise(resolve => setTimeout(resolve, delay))
                continue
              }
              
              log(`[Delete #${deleteOpId}] FAILED after ${attempt} attempts: ${fileName}`)
              throw deleteErr
            }
          }
        }
        return { success: false, error: 'Max retries exceeded' }
      }
      
      try {
        const stats = fs.statSync(targetPath)
        const isFile = !stats.isDirectory()
        
        if (isFile && (stats.mode & 0o200) === 0) {
          log(`[Delete #${deleteOpId}] Clearing read-only attribute for: ${fileName}`)
          fs.chmodSync(targetPath, stats.mode | 0o200)
        }
        
        const result = await attemptDelete(targetPath, isFile)
        const totalTime = Date.now() - deleteStartTime
        log(`[Delete #${deleteOpId}] END: ${fileName} - success: ${result.success}, total time: ${totalTime}ms`)
        
        if (!result.success) {
          return result
        }
        return { success: true }
      } finally {
        if (needsWatcherPause) {
          pendingDeleteOperations--
          log(`[Delete #${deleteOpId}] Complete, pending ops remaining: ${pendingDeleteOperations}`)
          
          if (pendingDeleteOperations === 0) {
            deleteWatcherStopPromise = null
            if (workingDirectory && fs.existsSync(workingDirectory)) {
              log(`[Delete] All deletes complete, restarting file watcher`)
              startFileWatcher(workingDirectory)
            }
          }
        }
      }
    } catch (err) {
      log(`[Delete #${deleteOpId}] EXCEPTION for ${fileName}: ${String(err)}`)
      const errStr = String(err)
      let errorMsg = errStr
      if (errStr.includes('EBUSY') || errStr.includes('resource busy')) {
        const fileName = path.basename(targetPath)
        errorMsg = `EBUSY: ${fileName} is locked (close it in the other application first)`
      } else if (errStr.includes('EPERM') || errStr.includes('permission denied')) {
        errorMsg = `Permission denied - file may be read-only or in use`
      } else if (errStr.includes('ENOENT')) {
        errorMsg = `File not found`
      }
      return { success: false, error: errorMsg }
    }
  })

  // Native file drag
  ipcMain.on('fs:start-drag', (event, filePaths: string[]) => {
    log('fs:start-drag received: ' + filePaths.length + ' files')
    
    const validPaths = filePaths.filter(p => {
      try {
        const exists = fs.existsSync(p)
        const isFile = exists && fs.statSync(p).isFile()
        if (!exists) log('  File does not exist: ' + p)
        if (exists && !isFile) log('  Not a file: ' + p)
        return isFile
      } catch (err) {
        log('  Error checking file: ' + p + ' ' + String(err))
        return false
      }
    })
    
    if (validPaths.length === 0) {
      log('No valid paths for drag')
      return
    }
    
    log('Valid paths for drag: ' + validPaths.join(', '))
    
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        log('Calling startDrag via mainWindow.webContents')
        // Use single file if only one, otherwise use first file
        const file = validPaths[0]
        mainWindow.webContents.startDrag({
          file,
          icon: DRAG_ICON
        })
        log('startDrag completed')
      } else {
        log('mainWindow not available, using event.sender')
        const file = validPaths[0]
        event.sender.startDrag({
          file,
          icon: DRAG_ICON
        })
        log('startDrag via event.sender completed')
      }
    } catch (err) {
      log('startDrag error: ' + String(err))
    }
  })

  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    try {
      fs.renameSync(oldPath, newPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:copy-file', async (_, sourcePath: string, destPath: string) => {
    try {
      const stats = fs.statSync(sourcePath)
      
      if (stats.isDirectory()) {
        copyDirSync(sourcePath, destPath)
        log('Copied directory: ' + sourcePath + ' -> ' + destPath)
      } else {
        const destDir = path.dirname(destPath)
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }
        
        fs.copyFileSync(sourcePath, destPath)
        log('Copied file: ' + sourcePath + ' -> ' + destPath)
      }
      
      return { success: true }
    } catch (err) {
      log('Error copying: ' + String(err))
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:move-file', async (_, sourcePath: string, destPath: string) => {
    try {
      const stats = fs.statSync(sourcePath)
      
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      
      try {
        fs.renameSync(sourcePath, destPath)
        log('Moved (rename): ' + sourcePath + ' -> ' + destPath)
        return { success: true }
      } catch (renameErr) {
        log('Rename failed, trying copy+delete: ' + String(renameErr))
      }
      
      if (stats.isDirectory()) {
        copyDirSync(sourcePath, destPath)
        fs.rmSync(sourcePath, { recursive: true, force: true })
        log('Moved (copy+delete) directory: ' + sourcePath + ' -> ' + destPath)
      } else {
        fs.copyFileSync(sourcePath, destPath)
        fs.unlinkSync(sourcePath)
        log('Moved (copy+delete) file: ' + sourcePath + ' -> ' + destPath)
      }
      
      return { success: true }
    } catch (err) {
      log('Error moving: ' + String(err))
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:open-in-explorer', async (_, targetPath: string) => {
    shell.showItemInFolder(targetPath)
    return { success: true }
  })

  ipcMain.handle('fs:open-file', async (_, filePath: string) => {
    try {
      const error = await shell.openPath(filePath)
      if (error) {
        console.error('[Main] Failed to open file:', filePath, error)
        return { success: false, error }
      }
      return { success: true }
    } catch (err) {
      console.error('[Main] Error opening file:', filePath, err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:set-readonly', async (_, filePath: string, readonly: boolean) => {
    try {
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        return { success: true }
      }
      
      const currentMode = stats.mode
      
      if (readonly) {
        const newMode = currentMode & ~0o222
        fs.chmodSync(filePath, newMode)
      } else {
        const newMode = currentMode | 0o200
        fs.chmodSync(filePath, newMode)
      }
      
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:is-readonly', async (_, filePath: string) => {
    try {
      const stats = fs.statSync(filePath)
      const isReadonly = (stats.mode & 0o200) === 0
      return { success: true, readonly: isReadonly }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}

export function unregisterFsHandlers(): void {
  const handlers = [
    'working-dir:select', 'working-dir:get', 'working-dir:clear', 'working-dir:set', 'working-dir:create',
    'fs:read-file', 'fs:write-file', 'fs:download-url', 'fs:file-exists', 'fs:get-hash',
    'fs:list-dir-files', 'fs:list-working-files', 'fs:compute-file-hashes',
    'fs:create-folder', 'fs:is-dir-empty', 'fs:delete', 'fs:rename', 'fs:copy-file', 'fs:move-file',
    'fs:open-in-explorer', 'fs:open-file', 'fs:set-readonly', 'fs:is-readonly'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
  
  ipcMain.removeListener('fs:start-drag', () => {})
}
