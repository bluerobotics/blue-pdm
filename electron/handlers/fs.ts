// TODO(decompose): Extract to fsHelpers.ts — hash functions, directory walkers, lock detection, and cleanup utilities (lines ~57–443)
// TODO(decompose): Extract to fsReadWrite.ts — read, write, download, and hash IPC handlers (lines ~549–1160)
// TODO(decompose): Extract to fsListAndScan.ts — directory listing, file scanning, and hash computation IPC handlers (lines ~1162–1466)
// TODO(decompose): Extract to fsDeleteAndRename.ts — delete, batch delete, trash, rename, copy, move, and lock-check IPC handlers (lines ~1546–2683)

// File system handlers for Electron main process
import { ipcMain, BrowserWindow, shell, dialog, nativeImage } from 'electron'
import fs from 'fs'
import type * as fsTypes from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { recordSolidWorksFileOpen, findLockingProcessViaService } from './solidworks'
import { createVaultWatcher, type VaultWatcher, type WatcherScanCache } from './fsWatcher'
import type { LocalFileInfo } from '../types'

const execAsync = promisify(exec)

// ============================================
// Timing Constants
// ============================================
const TRANSIENT_LOCK_RETRY_DELAY_MS = 1_000
const THUMBNAIL_WAIT_MS = 200
const WATCHER_STOP_BUFFER_MS = 100
const FS_EVENT_SETTLE_MS = 50
const THUMBNAIL_CHECK_WAIT_MS = 100
const DELETE_RETRY_BASE_MS = 100
const DIR_RENAME_HANDLE_RELEASE_MS = 500
/** Work budget between event loop handbacks during a vault scan (roughly one frame). */
const SCAN_YIELD_INTERVAL_MS = 8
/** Wall time to work time ratio above which a scan is considered starved. */
const SCAN_STARVATION_RATIO = 4
/** Work to complete before judging starvation, so one slow yield is not enough. */
const SCAN_STARVATION_MIN_WORK_MS = 100

// Module-level state
let mainWindow: BrowserWindow | null = null
let workingDirectory: string | null = null
let fileWatcher: VaultWatcher | null = null
let currentWatchPath: string | null = null // Track current watched path for deduplication
let pendingDeleteOperations = 0
let deleteWatcherStopPromise: Promise<void> | null = null

// Hash cache to avoid recomputing hashes for unchanged files
const hashCache = new Map<string, { size: number; mtime: number; hash: string }>()

/**
 * Last full vault scan, keyed by relative path.
 *
 * Kept so a watcher-driven refresh can re-stat only the handful of paths that
 * actually changed and still hand the renderer a complete list, instead of walking
 * every entry in the vault again. Invalidated whenever the working directory moves.
 */
let workingFilesScanCache: { rootDir: string; entries: Map<string, LocalFileInfo> } | null = null

function buildDirectoryEntry(
  fullPath: string,
  relativePath: string,
  stats: fsTypes.Stats,
): LocalFileInfo {
  return {
    name: path.basename(fullPath),
    path: fullPath,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: stats.mtime.toISOString(),
  }
}

function buildFileEntry(
  fullPath: string,
  relativePath: string,
  stats: fsTypes.Stats,
): LocalFileInfo {
  // Reuse a cached hash only when size and mtime both still match.
  const cached = hashCache.get(relativePath)
  const hash =
    cached && cached.size === stats.size && cached.mtime === stats.mtime.getTime()
      ? cached.hash
      : undefined

  return {
    name: path.basename(fullPath),
    path: fullPath,
    relativePath,
    isDirectory: false,
    extension: path.extname(fullPath).toLowerCase(),
    size: stats.size,
    modifiedTime: stats.mtime.toISOString(),
    hash,
    ino: stats.ino,
  }
}

/**
 * Walk a directory tree, keyed by path relative to `rootDir`.
 *
 * The stats are read with statSync rather than fs.promises. The syscalls themselves are
 * cheap either way (~600ms vs ~800ms for a 27,600-entry vault), but an awaiting walk
 * gives up the event loop between every directory, so anything else hogging the loop
 * stretches it out of all proportion - the same vault took 35s to walk while the old
 * chokidar watcher was starting up. statSync cannot be preempted that way.
 *
 * To stay responsive anyway, the walk hands the loop back every YIELD_INTERVAL_MS of
 * work. If those handbacks turn out to be expensive, we are being starved by something
 * else and finish inline instead of dragging the scan out for tens of seconds.
 */
async function scanWorkingTree(
  rootDir: string,
  startDir: string = rootDir,
): Promise<Map<string, LocalFileInfo>> {
  const entries = new Map<string, LocalFileInfo>()

  const walkStart = Date.now()
  let workedSince = Date.now()
  let workDone = 0
  let yielding = true

  const yieldIfDue = async (): Promise<void> => {
    if (!yielding) return

    const now = Date.now()
    if (now - workedSince < SCAN_YIELD_INTERVAL_MS) return

    workDone += now - workedSince
    await new Promise((resolve) => setImmediate(resolve))
    workedSince = Date.now()

    // Wall time running far ahead of work done means our yields are queueing behind
    // someone else's backlog. Stop yielding and take the loop for the last stretch.
    if (
      workDone >= SCAN_STARVATION_MIN_WORK_MS &&
      Date.now() - walkStart > workDone * SCAN_STARVATION_RATIO
    ) {
      yielding = false
      log('Vault scan is being starved of event loop time, finishing without yielding')
    }
  }

  async function walkDir(dir: string): Promise<void> {
    let items: fsTypes.Dirent[]
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      log('Error reading directory: ' + String(error))
      return
    }

    const subdirectories: string[] = []

    for (const item of items) {
      if (item.name.startsWith('.')) continue

      const fullPath = path.join(dir, item.name)

      let stats: fsTypes.Stats
      try {
        stats = fs.statSync(fullPath)
      } catch (error) {
        log('Error reading directory entry: ' + String(error))
        continue
      }

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/')

      if (item.isDirectory()) {
        entries.set(relativePath, buildDirectoryEntry(fullPath, relativePath, stats))
        subdirectories.push(fullPath)
      } else {
        entries.set(relativePath, buildFileEntry(fullPath, relativePath, stats))
      }
    }

    await yieldIfDue()

    for (const subdirectory of subdirectories) {
      await walkDir(subdirectory)
    }
  }

  await walkDir(startDir)
  return entries
}

/** Drop hash-cache entries for files that no longer exist in the scan. */
function pruneHashCache(entries: Map<string, LocalFileInfo>): void {
  for (const cachedPath of Array.from(hashCache.keys())) {
    const entry = entries.get(cachedPath)
    if (!entry || entry.isDirectory) {
      hashCache.delete(cachedPath)
    }
  }
}

/** Directories first, then path order - the ordering the renderer merge expects. */
function sortScanEntries(entries: Map<string, LocalFileInfo>): LocalFileInfo[] {
  return Array.from(entries.values()).sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.relativePath.localeCompare(b.relativePath)
  })
}

/** Remove a path from a scan, plus everything beneath it if it was a directory. */
function deleteScanEntry(entries: Map<string, LocalFileInfo>, relativePath: string): void {
  entries.delete(relativePath)
  for (const key of entries.keys()) {
    if (key.startsWith(relativePath + '/')) entries.delete(key)
  }
  hashCache.delete(relativePath)
}

/**
 * Exposes the last full scan to the watcher so it can tell an added directory from a
 * removed one. Writes go straight into the cache the delta handler reads, keeping a
 * single view of what is on disk.
 */
const watcherScanCache: WatcherScanCache = {
  getKind(relativePath) {
    const entry = workingFilesScanCache?.entries.get(relativePath)
    if (!entry) return undefined
    return entry.isDirectory ? 'directory' : 'file'
  },

  isPopulated() {
    return workingFilesScanCache !== null && workingFilesScanCache.rootDir === workingDirectory
  },

  setEntry(relativePath, fullPath, stats) {
    if (!this.isPopulated() || !workingFilesScanCache) return
    workingFilesScanCache.entries.set(
      relativePath,
      stats.isDirectory()
        ? buildDirectoryEntry(fullPath, relativePath, stats)
        : buildFileEntry(fullPath, relativePath, stats),
    )
  },

  deleteEntry(relativePath) {
    if (!this.isPopulated() || !workingFilesScanCache) return
    deleteScanEntry(workingFilesScanCache.entries, relativePath)
  },

  invalidate() {
    workingFilesScanCache = null
  },
}

// Track delete operations for debugging
let deleteOperationCounter = 0

// Lock detection now uses the Restart Manager API via the SolidWorks .NET service
// instead of requiring Sysinternals handle.exe to be installed separately.

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

// Calculate SHA-256 hash of a file (synchronous - use only for small files or when sync is required)
function hashFileSync(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

/**
 * Calculate SHA-256 hash of a file using streaming (async)
 * This is much more memory-efficient for large files as it doesn't load
 * the entire file into memory at once. The file is read in 64KB chunks.
 */
async function hashFileAsync(filePath: string): Promise<{ hash: string; size: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }) // 64KB chunks
    let size = 0

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      hash.update(chunk)
    })

    stream.on('end', () => {
      resolve({ hash: hash.digest('hex'), size })
    })

    stream.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Tracks vault roots whose orphaned `.download` temp files have already been swept
 * in this process lifetime. The sweep is expensive (recursive walk of the entire
 * vault) and only needs to run once per path — orphans only accumulate across
 * process restarts, never during a single session.
 */
const sweptDownloadRoots = new Set<string>()

/**
 * Remove orphaned .download temp files left behind by interrupted downloads.
 * Called on vault directory initialization to prevent stale temp files from accumulating.
 *
 * Async + non-blocking: uses `fs.promises` so the Electron main event loop is not
 * stalled while walking large vaults. Safe to fire-and-forget from IPC handlers.
 */
async function cleanupOrphanedDownloads(dirPath: string, isRoot = true): Promise<void> {
  if (isRoot) {
    if (sweptDownloadRoots.has(dirPath)) return
    sweptDownloadRoots.add(dirPath)
  }
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await cleanupOrphanedDownloads(fullPath, false)
      } else if (entry.name.endsWith('.download')) {
        try {
          await fs.promises.unlink(fullPath)
          log(`Cleaned up orphaned download temp file: ${fullPath}`)
        } catch (unlinkErr) {
          logError('Failed to clean up orphaned download temp file', {
            path: fullPath,
            error: String(unlinkErr),
          })
        }
      }
    }
  } catch (error) {
    // Directory may not be readable; not fatal
    logDebug('Could not scan for orphaned downloads', { dirPath, error: String(error) })
  }
}

// Helper to recursively count files in a directory (not including subdirectories themselves)
function countFilesInDir(dirPath: string): number {
  let count = 0
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      count += countFilesInDir(fullPath)
    } else {
      count++
    }
  }

  return count
}

// Helper to recursively copy a directory
// Returns the number of files (not directories) copied
function copyDirSync(src: string, dest: string, topLevelDest?: string): number {
  const effectiveDest = topLevelDest ?? dest
  const entries = fs.readdirSync(src, { withFileTypes: true })

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const topDestResolved = path.resolve(effectiveDest).toLowerCase()
  let fileCount = 0

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      const srcPathResolved = path.resolve(srcPath).toLowerCase()
      if (srcPathResolved === topDestResolved ||
          topDestResolved.startsWith(srcPathResolved + path.sep)) {
        continue
      }
      fileCount += copyDirSync(srcPath, destPath, effectiveDest)
    } else {
      fs.copyFileSync(srcPath, destPath)
      fileCount++
    }
  }

  return fileCount
}

// Helper to recursively get all files in a directory with relative paths
function getAllFilesInDir(
  dirPath: string,
  _baseFolder: string,
): Array<{
  name: string
  path: string
  relativePath: string
  extension: string
  size: number
  modifiedTime: string
}> {
  const files: Array<{
    name: string
    path: string
    relativePath: string
    extension: string
    size: number
    modifiedTime: string
  }> = []

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
            modifiedTime: stats.mtime.toISOString(),
          })
        }
      }
    } catch (error) {
      log('Error walking directory: ' + String(error))
    }
  }

  walkDir(dirPath)
  return files
}

// Try to find what process has a file locked
// Returns the process name if known, or "Unknown" if the file is locked but process can't be determined
// Priority: 1) SolidWorks temp files (instant), 2) O_RDWR test (instant), 3) Restart Manager API via .NET service
//
// options.forRead: when true, only report locks that prevent reading (EBUSY).
// Files that are open in SolidWorks but saved and readable will NOT be reported as locked.
// Use this for check-in/sync where we only need to read the file contents.
async function findLockingProcess(
  filePath: string,
  options?: { forRead?: boolean },
): Promise<string | null> {
  try {
    if (options?.forRead) {
      // Read-only lock check: only block if the file can't be read at all (mid-write / EBUSY)
      try {
        const fd = fs.openSync(filePath, fs.constants.O_RDONLY)
        fs.closeSync(fd)
        return null // File is readable — safe for check-in even if SW has it open
      } catch (readErr: unknown) {
        const nodeErr = readErr as NodeJS.ErrnoException
        if (nodeErr.code !== 'EBUSY') {
          return null // Not a busy lock — let the actual read operation report the error
        }
        // EBUSY = file is actively being written to. Identify the process.
        const dir = path.dirname(filePath)
        const baseName = path.basename(filePath, path.extname(filePath))
        const tempFile = path.join(dir, `~$${baseName}${path.extname(filePath)}`)
        if (fs.existsSync(tempFile)) {
          return 'SLDWORKS.exe'
        }
        try {
          const processName = await findLockingProcessViaService(filePath)
          if (processName) return processName
        } catch {
          /* service not available */
        }
        return 'another process'
      }
    }

    // Full lock check (default): detect any process holding the file open.
    // Used by rename, move, delete where exclusive access is needed.

    // FAST CHECK 1: SolidWorks temp files (~$filename) - instant, reliable indicator
    const dir = path.dirname(filePath)
    const baseName = path.basename(filePath, path.extname(filePath))
    const tempFile = path.join(dir, `~$${baseName}${path.extname(filePath)}`)
    if (fs.existsSync(tempFile)) {
      return 'SLDWORKS.exe'
    }

    // FAST CHECK 2: Confirm file is actually locked (instant)
    try {
      const fd = fs.openSync(filePath, fs.constants.O_RDWR)
      fs.closeSync(fd)
      return null // File is NOT locked
    } catch (openErr: unknown) {
      const nodeErr = openErr as NodeJS.ErrnoException
      if (nodeErr.code !== 'EBUSY' && nodeErr.code !== 'EACCES' && nodeErr.code !== 'EPERM') {
        return null // Some other error, not a lock
      }
      // EACCES/EPERM on Windows can mean read-only file, not a process lock.
      // Try O_RDONLY to distinguish: if readable, the file isn't locked.
      if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
        try {
          const fd = fs.openSync(filePath, fs.constants.O_RDONLY)
          fs.closeSync(fd)
          return null // Read-only file, not locked
        } catch {
          // Can't even read -- might be truly locked, continue detection
        }
      }
    }

    // PROCESS IDENTIFICATION: Use Restart Manager API via the .NET service
    // This replaces the previous handle.exe dependency (which required separate installation)
    try {
      const processName = await findLockingProcessViaService(filePath)
      if (processName) {
        return processName
      }
    } catch {
      // Service not available - fall through
    }

    // Transient lock retry: OS processes (Explorer, Search Indexer, antivirus) often hold
    // brief locks on recently created/copied files. Wait and re-test before reporting "Unknown".
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_LOCK_RETRY_DELAY_MS))
    try {
      const fd = fs.openSync(filePath, fs.constants.O_RDWR)
      fs.closeSync(fd)
      return null // Transient lock cleared
    } catch {
      return 'Unknown'
    }
  } catch (error) {
    log(`[LockDetect] Detection failed: ${error}`)
    return null
  }
}

// Stop file watcher
async function stopFileWatcher(): Promise<void> {
  if (fileWatcher) {
    log('Stopping file watcher')
    const watcher = fileWatcher
    fileWatcher = null
    currentWatchPath = null
    await watcher.close()
    log('File watcher closed')
  }
}

// File watcher for detecting external changes
async function startFileWatcher(dirPath: string): Promise<void> {
  // Skip if already watching this exact path (prevents rapid restarts during HMR)
  if (fileWatcher && currentWatchPath === dirPath) {
    log('File watcher already active for: ' + dirPath)
    return
  }

  await stopFileWatcher()

  log('Starting file watcher for: ' + dirPath)
  currentWatchPath = dirPath

  fileWatcher = createVaultWatcher(dirPath, {
    log: (message, data) => log(message, data),
    getMainWindow: () => mainWindow,
    scanCache: watcherScanCache,
  })
}

// Native file drag icon - a simple file icon that works well across platforms
// Using a slightly larger icon (32x32) with better visibility
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABjSURBVFhH7c0xDQAgDAXQskKxgBUsYAErWMECFv7OwEImXEOTN/wdPwEAAAAAAACU7F0z27sZuweeAAAAAAAAlOzdM9u7GbsHngAAAAAAAJTs3TPbuxm7B56AAAAAgF9mZgO0VARYFxh/1QAAAABJRU5ErkJggg==',
)

/**
 * Get the file extension icon for drag operations
 * Falls back to default DRAG_ICON if unable to get file-specific icon
 */
function getDragIconForFile(filePath: string): Electron.NativeImage {
  try {
    // Try to get the app's file icon from the system
    // This provides a more native feel
    const icon = nativeImage.createFromPath(filePath)
    if (!icon.isEmpty()) {
      // Resize to a reasonable drag icon size
      return icon.resize({ width: 32, height: 32 })
    }
  } catch {
    // Fall back to default icon
  }
  return DRAG_ICON
}

// Export getters for module state
export function getWorkingDirectory(): string | null {
  return workingDirectory
}

export function setWorkingDirectoryExternal(dir: string | null): void {
  workingDirectory = dir
}

export function clearHashCache(): void {
  hashCache.clear()
  // Scan entries embed cached hashes, so they would otherwise hand back the
  // values the caller just asked us to forget.
  workingFilesScanCache = null
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
      properties: ['openDirectory', 'createDirectory'],
    })

    restoreMainWindowFocus()

    if (!result.canceled && result.filePaths.length > 0) {
      workingDirectory = result.filePaths[0]
      hashCache.clear()
      log('Working directory set: ' + workingDirectory)
      await startFileWatcher(workingDirectory)
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
    if (!fs.existsSync(newPath)) {
      return { success: false, error: 'Path does not exist' }
    }
    // Dedupe at the source of truth: if this path is already active, skip the
    // expensive cleanup scan and watcher restart. Renderer effects often re-fire
    // during startup (auth, org, HMR, Strict Mode) and would otherwise queue
    // redundant work behind the event loop.
    if (workingDirectory === newPath) {
      return { success: true, path: workingDirectory }
    }
    workingDirectory = newPath
    hashCache.clear()
    // Fire-and-forget: orphan cleanup walks the whole vault and must not block
    // the IPC response. Internal try/catch handles all failure modes.
    void cleanupOrphanedDownloads(newPath)
    await startFileWatcher(newPath)
    return { success: true, path: workingDirectory }
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
      // Dedupe: avoid re-running cleanup + watcher restart when the renderer
      // re-asserts the same path (e.g. Strict Mode double-mount, HMR).
      if (workingDirectory === expandedPath) {
        return { success: true, path: workingDirectory }
      }
      workingDirectory = expandedPath
      hashCache.clear()
      // Fire-and-forget: see working-dir:set handler for rationale.
      void cleanupOrphanedDownloads(expandedPath)
      await startFileWatcher(expandedPath)
      return { success: true, path: workingDirectory }
    } catch (error) {
      log('Error creating working directory: ' + String(error))
      return { success: false, error: String(error) }
    }
  })

  // Path security: restrict file operations to the working directory
  function isPathWithinWorkingDir(filePath: string): boolean {
    if (!workingDirectory) return false
    const resolved = path.resolve(filePath)
    const root = path.resolve(workingDirectory)
    return resolved.startsWith(root + path.sep) || resolved === root
  }

  // File read/write handlers
  // Note: This handler reads the entire file into memory. For hash-only needs,
  // use 'fs:hash-file' which uses streaming and is more memory-efficient.
  ipcMain.handle('fs:read-file', async (_, filePath: string) => {
    try {
      if (!isPathWithinWorkingDir(filePath)) {
        logWarn(`[ReadFile] Blocked read outside working directory: ${filePath}`)
        return { success: false, error: 'Path is outside the vault working directory' }
      }

      // Safety net: check if file is readable before attempting full read.
      // Uses O_RDONLY (not O_RDWR) because SolidWorks holds files open with FILE_SHARE_READ
      // but not FILE_SHARE_WRITE — O_RDWR would get EBUSY even on saved, readable files.
      try {
        const fd = fs.openSync(filePath, fs.constants.O_RDONLY)
        fs.closeSync(fd)
      } catch (lockErr: unknown) {
        const lockNodeErr = lockErr as NodeJS.ErrnoException
        if (lockNodeErr.code === 'EBUSY') {
          log(`[ReadFile] File is busy, refusing to read: ${filePath} (${lockNodeErr.code})`)
          return {
            success: false,
            error: `File is locked by another process (${lockNodeErr.code})`,
            locked: true,
          }
        }
        // Other errors (e.g., ENOENT) fall through to the normal read which will report them
      }

      const data = fs.readFileSync(filePath)
      const hash = crypto.createHash('sha256').update(data).digest('hex')
      return {
        success: true,
        data: data.toString('base64'),
        size: data.length,
        hash,
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Check if a file is locked by another process
  // Used before check-in to detect if SolidWorks (or another process) is actively writing
  // Pass { forRead: true } to only block on files that can't be read (EBUSY / mid-write)
  ipcMain.handle(
    'fs:check-file-lock',
    async (_, filePath: string, options?: { forRead?: boolean }) => {
      try {
        const lockingProcess = await findLockingProcess(filePath, options)
        if (lockingProcess) {
          return { success: true, locked: true, processName: lockingProcess }
        }
        return { success: true, locked: false }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  )

  // Streaming hash computation - much more efficient for large files
  // Only returns hash and size, not file contents (for checkin operations)
  ipcMain.handle('fs:hash-file', async (_, filePath: string) => {
    try {
      const { hash, size } = await hashFileAsync(filePath)
      return { success: true, hash, size }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('fs:write-file', async (_, filePath: string, base64Data: string) => {
    logDebug('Writing file', { filePath, dataLength: base64Data?.length })

    try {
      if (!isPathWithinWorkingDir(filePath)) {
        logWarn(`[WriteFile] Blocked write outside working directory: ${filePath}`)
        return { success: false, error: 'Path is outside the vault working directory' }
      }

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
            code: nodeErr.code,
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

      const hash = crypto.createHash('sha256').update(buffer).digest('hex')

      // Atomic write: write to temp file, then rename to final path
      const tmpPath = filePath + '.tmp'
      fs.writeFileSync(tmpPath, buffer)
      try {
        fs.renameSync(tmpPath, filePath)
      } catch (renameErr) {
        try {
          fs.unlinkSync(tmpPath)
        } catch {}
        throw renameErr
      }

      logDebug('File written successfully', {
        filePath,
        size: buffer.length,
        hash: hash.substring(0, 12) + '...',
      })

      return { success: true, hash, size: buffer.length }
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException
      logError('Write file error', {
        filePath,
        error: String(error),
        code: nodeErr.code,
        syscall: nodeErr.syscall,
      })

      let errorMsg = String(error)
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
  ipcMain.handle(
    'fs:download-url',
    async (event, url: string, destPath: string, expectedHash?: string) => {
      const operationId = `dl-${Date.now()}`
      const startTime = Date.now()

      logDebug(`[${operationId}] Starting download`, {
        destPath,
        urlLength: url?.length,
        urlPrefix: url?.substring(0, 80) + '...',
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
              code: (mkdirErr as NodeJS.ErrnoException).code,
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
            code: (accessErr as NodeJS.ErrnoException).code,
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
                contentType: response.headers['content-type'],
              },
            })

            if (response.statusCode === 301 || response.statusCode === 302) {
              const redirectUrl = response.headers.location
              logDebug(`[${operationId}] Following redirect`, {
                redirectUrl: redirectUrl?.substring(0, 80),
              })

              if (redirectUrl) {
                const redirectClient = redirectUrl.startsWith('https') ? https : http
                const redirectRequest = redirectClient.get(
                  redirectUrl,
                  { timeout: REQUEST_TIMEOUT_MS },
                  (redirectResponse) => {
                    logDebug(`[${operationId}] Redirect response`, {
                      statusCode: redirectResponse.statusCode,
                      statusMessage: redirectResponse.statusMessage,
                    })
                    handleResponse(redirectResponse)
                  },
                )
                redirectRequest.on('error', (error) => {
                  logError(`[${operationId}] Redirect request error`, {
                    error: String(error),
                    code: (error as NodeJS.ErrnoException).code,
                  })
                  resolve({ success: false, error: `Redirect failed: ${error}` })
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

          request.on('error', (error) => {
            const nodeErr = error as NodeJS.ErrnoException & { hostname?: string }
            logError(`[${operationId}] HTTP request error`, {
              error: String(error),
              code: nodeErr.code,
              syscall: nodeErr.syscall,
              hostname: nodeErr.hostname,
            })

            let errorMsg = String(error)
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
                headers: response.headers,
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
            const tmpPath = destPath + '.download'
            const STALL_TIMEOUT_MS = 30000

            logDebug(`[${operationId}] Starting file write`, {
              destPath,
              tmpPath,
              contentLength,
              contentType: response.headers['content-type'],
              expectedHash: expectedHash ? expectedHash.substring(0, 12) + '...' : undefined,
            })

            let writeStream: fs.WriteStream
            try {
              writeStream = fs.createWriteStream(tmpPath)
            } catch (createErr) {
              logError(`[${operationId}] Failed to create write stream`, {
                tmpPath,
                error: String(createErr),
                code: (createErr as NodeJS.ErrnoException).code,
              })
              resolve({ success: false, error: `Failed to create file: ${createErr}` })
              return
            }

            const hashStream = crypto.createHash('sha256')

            let downloaded = 0
            let lastProgressTime = Date.now()
            let lastDownloaded = 0
            let resolved = false

            let stallTimer = setTimeout(() => {
              if (resolved) return
              resolved = true
              logError(
                `[${operationId}] Download stalled - no data received for ${STALL_TIMEOUT_MS}ms`,
                {
                  downloaded,
                  contentLength,
                },
              )
              response.destroy()
              writeStream.destroy()
              try {
                fs.unlinkSync(tmpPath)
              } catch {}
              resolve({
                success: false,
                error: `Download stalled: no data received for ${STALL_TIMEOUT_MS / 1000}s`,
              })
            }, STALL_TIMEOUT_MS)

            response.on('data', (chunk: Buffer) => {
              downloaded += chunk.length
              hashStream.update(chunk)

              clearTimeout(stallTimer)
              stallTimer = setTimeout(() => {
                if (resolved) return
                resolved = true
                logError(
                  `[${operationId}] Download stalled - no data received for ${STALL_TIMEOUT_MS}ms`,
                  {
                    downloaded,
                    contentLength,
                  },
                )
                response.destroy()
                writeStream.destroy()
                try {
                  fs.unlinkSync(tmpPath)
                } catch {}
                resolve({
                  success: false,
                  error: `Download stalled: no data received for ${STALL_TIMEOUT_MS / 1000}s`,
                })
              }, STALL_TIMEOUT_MS)

              const now = Date.now()
              if (now - lastProgressTime >= 100) {
                const bytesSinceLast = downloaded - lastDownloaded
                const timeSinceLast = (now - lastProgressTime) / 1000
                const speed = timeSinceLast > 0 ? bytesSinceLast / timeSinceLast : 0

                event.sender.send('download-progress', {
                  loaded: downloaded,
                  total: contentLength,
                  speed,
                })

                lastProgressTime = now
                lastDownloaded = downloaded
              }
            })

            response.on('error', (error: Error) => {
              if (resolved) return
              resolved = true
              clearTimeout(stallTimer)
              logError(`[${operationId}] Response stream error`, {
                error: String(error),
                downloaded,
                contentLength,
              })
              writeStream.destroy()
              try {
                fs.unlinkSync(tmpPath)
              } catch {}
              resolve({ success: false, error: `Download stream error: ${error}` })
            })

            response.pipe(writeStream)

            writeStream.on('finish', () => {
              if (resolved) return
              resolved = true
              clearTimeout(stallTimer)

              const hash = hashStream.digest('hex')
              const duration = Date.now() - startTime

              // Verify content-length if the server provided one
              if (contentLength > 0 && downloaded !== contentLength) {
                logError(`[${operationId}] Download truncated`, {
                  destPath,
                  downloaded,
                  contentLength,
                  shortBy: contentLength - downloaded,
                })
                try {
                  fs.unlinkSync(tmpPath)
                } catch {}
                resolve({
                  success: false,
                  error: `Download incomplete: received ${downloaded} of ${contentLength} bytes`,
                })
                return
              }

              // Verify hash if expected hash was provided
              if (expectedHash && hash !== expectedHash) {
                logError(`[${operationId}] Hash mismatch - file corrupted during download`, {
                  destPath,
                  downloaded,
                  contentLength,
                  expectedHash: expectedHash.substring(0, 12) + '...',
                  actualHash: hash.substring(0, 12) + '...',
                })
                try {
                  fs.unlinkSync(tmpPath)
                } catch {}
                resolve({
                  success: false,
                  error: `Download corrupted: hash mismatch (expected ${expectedHash.substring(0, 8)}, got ${hash.substring(0, 8)})`,
                })
                return
              }

              // Integrity checks passed - move temp file to final path
              // Uses a fallback chain to handle read-only files and files locked by
              // other processes (e.g. SolidWorks Document Manager holding handles open)
              let replaced = false

              // Strategy 1: direct rename (fastest, atomic)
              try {
                fs.renameSync(tmpPath, destPath)
                replaced = true
              } catch (renameErr1) {
                const code1 = (renameErr1 as NodeJS.ErrnoException).code
                if (code1 !== 'EPERM' && code1 !== 'EACCES') {
                  logError(`[${operationId}] Failed to move temp file to final path`, {
                    tmpPath,
                    destPath,
                    error: String(renameErr1),
                    code: code1,
                  })
                  try {
                    fs.unlinkSync(tmpPath)
                  } catch {}
                  resolve({ success: false, error: `Failed to finalize download: ${renameErr1}` })
                  return
                }

                // Strategy 2: clear read-only on dest, then retry rename
                try {
                  const stats = fs.statSync(destPath)
                  fs.chmodSync(destPath, stats.mode | 0o200)
                  fs.renameSync(tmpPath, destPath)
                  replaced = true
                  log(`[${operationId}] Rename succeeded after clearing read-only`, { destPath })
                } catch {
                  // Strategy 3: delete dest then rename temp into place
                  try {
                    fs.unlinkSync(destPath)
                    fs.renameSync(tmpPath, destPath)
                    replaced = true
                    log(`[${operationId}] Rename succeeded after deleting destination`, {
                      destPath,
                    })
                  } catch {
                    // Strategy 4: overwrite dest content in-place (works when
                    // another process holds a read handle with FILE_SHARE_WRITE)
                    try {
                      fs.copyFileSync(tmpPath, destPath)
                      fs.unlinkSync(tmpPath)
                      replaced = true
                      log(`[${operationId}] Replaced via copyFile fallback`, { destPath })
                    } catch (copyErr) {
                      logError(`[${operationId}] All replace strategies failed`, {
                        tmpPath,
                        destPath,
                        originalError: String(renameErr1),
                        copyError: String(copyErr),
                      })
                      try {
                        fs.unlinkSync(tmpPath)
                      } catch {}
                      resolve({
                        success: false,
                        error: `Failed to finalize download (file may be locked by SolidWorks): ${renameErr1}`,
                      })
                      return
                    }
                  }
                }
              }

              if (!replaced) {
                try {
                  fs.unlinkSync(tmpPath)
                } catch {}
                resolve({ success: false, error: 'Failed to replace destination file' })
                return
              }

              log(`[${operationId}] Download complete`, {
                destPath,
                size: downloaded,
                hash: hash.substring(0, 12) + '...',
                duration,
                speedMBps: (downloaded / 1024 / 1024 / (duration / 1000)).toFixed(2),
              })

              resolve({ success: true, hash, size: downloaded })
            })

            writeStream.on('error', (error) => {
              if (resolved) return
              resolved = true
              clearTimeout(stallTimer)

              const nodeErr = error as NodeJS.ErrnoException
              logError(`[${operationId}] Write stream error`, {
                tmpPath,
                error: String(error),
                code: nodeErr.code,
                downloaded,
                contentLength,
              })

              let errorMsg = `Failed to write file: ${error}`
              if (nodeErr.code === 'ENOSPC') {
                errorMsg = `Disk full: Not enough space to save the file.`
              } else if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
                errorMsg = `Permission denied: Cannot write to ${destPath}`
              } else if (nodeErr.code === 'EROFS') {
                errorMsg = `Read-only file system: Cannot write files.`
              }

              try {
                fs.unlinkSync(tmpPath)
              } catch {}
              resolve({ success: false, error: errorMsg })
            })
          }
        })
      } catch (error) {
        const duration = Date.now() - startTime
        logError(`[${operationId}] Download exception`, {
          destPath,
          error: String(error),
          stack: (error as Error).stack,
          duration,
        })
        return { success: false, error: `Download failed: ${error}` }
      }
    },
  )

  ipcMain.handle('fs:file-exists', async (_, filePath: string) => {
    return fs.existsSync(filePath)
  })

  ipcMain.handle('fs:get-hash', async (_, filePath: string) => {
    try {
      const hash = hashFileSync(filePath)
      return { success: true, hash }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Size + mtime for a single path. Lets callers refresh the on-disk facts for one
  // file after writing it, instead of triggering a full vault rescan.
  ipcMain.handle('fs:stat-file', async (_, filePath: string) => {
    try {
      const stats = await fs.promises.stat(filePath)
      return {
        success: true,
        size: stats.size,
        modifiedTime: stats.mtime.toISOString(),
        isDirectory: stats.isDirectory(),
      }
    } catch (error) {
      return { success: false, error: String(error) }
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
              modifiedTime: stats.mtime.toISOString(),
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
              hash: fileHash,
              ino: stats.ino,
            })
          }
        }
      } catch (error) {
        log('Error reading directory: ' + String(error))
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

  // Fast folder listing - no hash computation, uses hash cache
  // Used for folder-scoped refresh (faster than full vault scan)
  // Uses ASYNC fs operations to prevent blocking the main process (allows UI to render)
  ipcMain.handle('fs:list-folder-fast', async (_, folderRelativePath: string) => {
    if (!workingDirectory) {
      return { success: false, error: 'No working directory set' }
    }

    // Build full path to the folder
    const folderFullPath = folderRelativePath
      ? path.join(workingDirectory, folderRelativePath)
      : workingDirectory

    // Use async stat to check folder existence
    try {
      const stat = await fs.promises.stat(folderFullPath)
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory' }
      }
    } catch {
      return { success: false, error: 'Folder does not exist' }
    }

    const files: LocalFileInfo[] = []

    // Async recursive directory walker - allows event loop to process UI updates
    async function walkDir(dir: string): Promise<void> {
      try {
        const items = await fs.promises.readdir(dir, { withFileTypes: true })

        for (const item of items) {
          if (item.name.startsWith('.')) continue

          const fullPath = path.join(dir, item.name)
          // Relative path from vault root (not from folder)
          const relativePath = path.relative(workingDirectory!, fullPath).replace(/\\/g, '/')
          const stats = await fs.promises.stat(fullPath)

          if (item.isDirectory()) {
            files.push({
              name: item.name,
              path: fullPath,
              relativePath,
              isDirectory: true,
              extension: '',
              size: 0,
              modifiedTime: stats.mtime.toISOString(),
            })
            await walkDir(fullPath)
          } else {
            // Use cached hash if available (same logic as listWorkingFiles)
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
              hash: fileHash,
              ino: stats.ino,
            })
          }
        }
      } catch (error) {
        log('Error reading folder: ' + String(error))
      }
    }

    await walkDir(folderFullPath)

    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.relativePath.localeCompare(b.relativePath)
    })

    return { success: true, files, folderPath: folderRelativePath }
  })

  // Fast file listing - no hash computation
  ipcMain.handle('fs:list-working-files', async () => {
    if (!workingDirectory) {
      return { success: false, error: 'No working directory set' }
    }

    const entries = await scanWorkingTree(workingDirectory)
    pruneHashCache(entries)
    workingFilesScanCache = { rootDir: workingDirectory, entries }

    return { success: true, files: sortScanEntries(entries) }
  })

  /**
   * Refresh only the paths the watcher reported, patching them into the previous
   * full scan. Returns the same complete list shape as fs:list-working-files, so
   * callers get an unchanged view of the vault without re-walking every entry.
   * Falls back to a full scan when there is no usable cache.
   */
  ipcMain.handle('fs:list-working-files-delta', async (_, changedPaths: string[]) => {
    if (!workingDirectory) {
      return { success: false, error: 'No working directory set' }
    }

    const cache = workingFilesScanCache
    if (!cache || cache.rootDir !== workingDirectory || changedPaths.length === 0) {
      const entries = await scanWorkingTree(workingDirectory)
      pruneHashCache(entries)
      workingFilesScanCache = { rootDir: workingDirectory, entries }
      return { success: true, files: sortScanEntries(entries), wasFullScan: true }
    }

    const entries = new Map(cache.entries)
    const rootDir = workingDirectory

    for (const changedPath of changedPaths) {
      const relativePath = changedPath.replace(/\\/g, '/')
      if (!relativePath || relativePath.startsWith('..')) continue

      const fullPath = path.join(rootDir, relativePath)

      let stats: fsTypes.Stats
      try {
        stats = await fs.promises.stat(fullPath)
      } catch {
        // Gone. Drop it, plus anything beneath it if it was a directory.
        deleteScanEntry(entries, relativePath)
        continue
      }

      if (stats.isDirectory()) {
        // A directory appearing (or being replaced) can bring a whole subtree with it.
        for (const key of entries.keys()) {
          if (key.startsWith(relativePath + '/')) entries.delete(key)
        }
        entries.set(relativePath, buildDirectoryEntry(fullPath, relativePath, stats))
        const subtree = await scanWorkingTree(rootDir, fullPath)
        for (const [key, entry] of subtree) entries.set(key, entry)
      } else {
        entries.set(relativePath, buildFileEntry(fullPath, relativePath, stats))
      }
    }

    workingFilesScanCache = { rootDir, entries }

    return { success: true, files: sortScanEntries(entries), wasFullScan: false }
  })

  // Compute hashes for files in batches
  ipcMain.handle(
    'fs:compute-file-hashes',
    async (
      event,
      filePaths: Array<{ path: string; relativePath: string; size: number; mtime: number }>,
    ) => {
      if (!workingDirectory) {
        return { success: false, error: 'No working directory set' }
      }

      const results: Array<{ relativePath: string; hash: string }> = []
      const batchSize = 20
      let processed = 0
      const total = filePaths.length

      for (let i = 0; i < filePaths.length; i += batchSize) {
        // Exit early if window was closed during processing
        if (event.sender.isDestroyed()) {
          return { success: true, results }
        }

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
        // Check if sender is still valid before sending progress (window may be closed during shutdown)
        if (!event.sender.isDestroyed()) {
          event.sender.send('hash-progress', { processed, total, percent })
        }

        await new Promise((resolve) => setImmediate(resolve))
      }

      return { success: true, results }
    },
  )

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
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException
      logError('Failed to create folder', {
        folderPath,
        error: String(error),
        code: nodeErr.code,
        syscall: nodeErr.syscall,
      })

      let errorMsg = String(error)
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
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Check if a path is a directory
  ipcMain.handle('fs:is-directory', async (_, targetPath: string) => {
    try {
      if (!fs.existsSync(targetPath)) {
        return { success: false, error: 'Path does not exist' }
      }
      const stats = fs.statSync(targetPath)
      return { success: true, isDirectory: stats.isDirectory() }
    } catch (error) {
      return { success: false, error: String(error) }
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
        log(
          `[Delete #${deleteOpId}] File stats - size: ${preStats.size}, mode: ${preStats.mode.toString(8)}, isFile: ${preStats.isFile()}`,
        )
      } catch (error) {
        log(`[Delete #${deleteOpId}] Could not stat file: ${error}`)
      }

      if (isFileBeingThumbnailed(targetPath)) {
        log(
          `[Delete #${deleteOpId}] WARNING: File is currently being thumbnailed! Waiting ${THUMBNAIL_WAIT_MS}ms...`,
        )
        await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_WAIT_MS))
      }

      if (thumbnailsInProgress.size > 0) {
        log(
          `[Delete #${deleteOpId}] Files currently being thumbnailed: ${Array.from(
            thumbnailsInProgress,
          )
            .map((p) => path.basename(p))
            .join(', ')}`,
        )
      }

      const needsWatcherPause =
        workingDirectory &&
        (targetPath === workingDirectory ||
          workingDirectory.startsWith(targetPath) ||
          targetPath.startsWith(workingDirectory))

      log(
        `[Delete #${deleteOpId}] Needs watcher pause: ${needsWatcherPause}, workingDirectory: ${workingDirectory}`,
      )

      if (needsWatcherPause) {
        pendingDeleteOperations++
        log(
          `[Delete #${deleteOpId}] Pending delete ops: ${pendingDeleteOperations}, fileWatcher exists: ${!!fileWatcher}`,
        )

        if (pendingDeleteOperations === 1) {
          log(`[Delete #${deleteOpId}] First delete op - stopping file watcher...`)
          const watcherStopStart = Date.now()

          deleteWatcherStopPromise = (async () => {
            await stopFileWatcher()
            log(`[Delete] File watcher stopped in ${Date.now() - watcherStopStart}ms`)
            await new Promise((resolve) => setTimeout(resolve, WATCHER_STOP_BUFFER_MS))
            log(
              `[Delete] Buffer wait complete, total watcher stop time: ${Date.now() - watcherStopStart}ms`,
            )
          })()
        }

        if (deleteWatcherStopPromise) {
          log(`[Delete #${deleteOpId}] Waiting for watcher stop promise...`)
          await deleteWatcherStopPromise
          log(`[Delete #${deleteOpId}] Watcher stop promise resolved`)
        }
      }

      const attemptDelete = async (
        filePath: string,
        isFile: boolean,
        retries = 3,
      ): Promise<{ success: boolean; error?: string }> => {
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
                await new Promise((resolve) => setTimeout(resolve, delay))
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
        log(
          `[Delete #${deleteOpId}] END: ${fileName} - success: ${result.success}, total time: ${totalTime}ms`,
        )

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
              await startFileWatcher(workingDirectory)
            }
          }
        }
      }
    } catch (error) {
      log(`[Delete #${deleteOpId}] EXCEPTION for ${fileName}: ${String(error)}`)
      const errStr = String(error)
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

  // ════════════════════════════════════════════════════════════════════════════
  // BATCH DELETE OPERATIONS
  // These handlers process multiple files in a single IPC call with a single
  // watcher stop/restart cycle, significantly improving performance for bulk
  // delete operations (e.g., deleting 33 files goes from ~10s to ~1-2s)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Batch delete files - stops watcher ONCE, deletes all files, restarts watcher ONCE.
   * Much more efficient than calling fs:delete for each file individually.
   *
   * @param paths - Array of absolute file paths to delete
   * @param useTrash - Whether to move files to trash (default: true) or permanently delete
   * @returns Object with overall success status and per-file results
   */
  ipcMain.handle('fs:delete-batch', async (_, paths: string[], useTrash: boolean = true) => {
    const batchId = ++deleteOperationCounter
    const startTime = Date.now()

    log(`[DeleteBatch #${batchId}] START: ${paths.length} files, useTrash=${useTrash}`)

    if (!paths || paths.length === 0) {
      return { success: true, results: [] }
    }

    const results: Array<{ path: string; success: boolean; error?: string }> = []

    // Check if any path is within working directory
    const needsWatcherPause =
      workingDirectory &&
      paths.some(
        (targetPath) =>
          targetPath === workingDirectory ||
          workingDirectory.startsWith(targetPath) ||
          targetPath.startsWith(workingDirectory),
      )

    // Stop watcher ONCE for the entire batch
    if (needsWatcherPause && fileWatcher) {
      log(`[DeleteBatch #${batchId}] Stopping file watcher for batch operation`)
      await stopFileWatcher()
      // Brief wait for any pending file system events to settle
      await new Promise((resolve) => setTimeout(resolve, FS_EVENT_SETTLE_MS))
    }

    try {
      // Wait for any thumbnailing to complete
      if (thumbnailsInProgress.size > 0) {
        log(
          `[DeleteBatch #${batchId}] Waiting for ${thumbnailsInProgress.size} thumbnails to complete`,
        )
        await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_WAIT_MS))
      }

      // Process all files
      for (const targetPath of paths) {
        const fileName = path.basename(targetPath)

        try {
          // Skip if file doesn't exist
          if (!fs.existsSync(targetPath)) {
            results.push({ path: targetPath, success: true }) // Already deleted, consider success
            continue
          }

          // Check if file is being thumbnailed
          if (isFileBeingThumbnailed(targetPath)) {
            await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_CHECK_WAIT_MS))
          }

          const stats = fs.statSync(targetPath)
          const isFile = !stats.isDirectory()

          // Clear read-only if needed
          if (isFile && (stats.mode & 0o200) === 0) {
            try {
              fs.chmodSync(targetPath, stats.mode | 0o200)
            } catch {
              // Ignore chmod errors, try to delete anyway
            }
          }

          // Try to delete with retries for locked files
          let deleted = false
          let lastError: string | undefined

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              if (useTrash) {
                await shell.trashItem(targetPath)
              } else {
                if (isFile) {
                  fs.unlinkSync(targetPath)
                } else {
                  fs.rmSync(targetPath, { recursive: true, force: true })
                }
              }
              deleted = true
              break
            } catch (error) {
              lastError = String(error)
              const isLocked = lastError.includes('EBUSY') || lastError.includes('resource busy')

              if (isLocked && attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, attempt * DELETE_RETRY_BASE_MS))
                continue
              }

              // If trash failed, try direct delete
              if (useTrash && attempt === 1) {
                try {
                  if (isFile) {
                    fs.unlinkSync(targetPath)
                  } else {
                    fs.rmSync(targetPath, { recursive: true, force: true })
                  }
                  deleted = true
                  break
                } catch (fallbackErr) {
                  lastError = String(fallbackErr)
                }
              }
            }
          }

          if (deleted) {
            results.push({ path: targetPath, success: true })
          } else {
            let errorMsg = lastError || 'Unknown error'
            if (errorMsg.includes('EBUSY') || errorMsg.includes('resource busy')) {
              errorMsg = `${fileName} is locked (close it in the other application)`
            } else if (errorMsg.includes('EPERM') || errorMsg.includes('permission denied')) {
              errorMsg = `Permission denied - ${fileName} may be read-only or in use`
            }
            results.push({ path: targetPath, success: false, error: errorMsg })
            log(`[DeleteBatch #${batchId}] Failed to delete: ${fileName} - ${errorMsg}`)
          }
        } catch (error) {
          const errorMsg = String(error)
          results.push({ path: targetPath, success: false, error: errorMsg })
          log(`[DeleteBatch #${batchId}] Exception deleting: ${fileName} - ${errorMsg}`)
        }
      }
    } finally {
      // Restart watcher ONCE after all deletions complete
      if (needsWatcherPause && workingDirectory && fs.existsSync(workingDirectory)) {
        log(`[DeleteBatch #${batchId}] Restarting file watcher after batch operation`)
        await startFileWatcher(workingDirectory)
      }
    }

    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const duration = Date.now() - startTime

    log(
      `[DeleteBatch #${batchId}] END: ${succeeded}/${paths.length} succeeded, ${failed} failed, ${duration}ms`,
    )

    return {
      success: failed === 0,
      results,
      summary: { total: paths.length, succeeded, failed, duration },
    }
  })

  /**
   * Batch trash files - optimized for moving multiple files to recycle bin.
   * Similar to delete-batch but always uses shell.trashItem.
   *
   * @param paths - Array of absolute file paths to trash
   * @returns Object with overall success status and per-file results
   */
  ipcMain.handle('fs:trash-batch', async (_, paths: string[]) => {
    const batchId = ++deleteOperationCounter
    const startTime = Date.now()

    log(`[TrashBatch #${batchId}] START: ${paths.length} files`)

    if (!paths || paths.length === 0) {
      return { success: true, results: [] }
    }

    const results: Array<{ path: string; success: boolean; error?: string }> = []

    // Check if any path is within working directory
    const needsWatcherPause =
      workingDirectory &&
      paths.some(
        (targetPath) =>
          targetPath === workingDirectory ||
          workingDirectory.startsWith(targetPath) ||
          targetPath.startsWith(workingDirectory),
      )

    // Stop watcher ONCE for the entire batch
    if (needsWatcherPause && fileWatcher) {
      log(`[TrashBatch #${batchId}] Stopping file watcher for batch operation`)
      await stopFileWatcher()
      await new Promise((resolve) => setTimeout(resolve, FS_EVENT_SETTLE_MS))
    }

    try {
      // Process all files
      for (const targetPath of paths) {
        const fileName = path.basename(targetPath)

        try {
          if (!fs.existsSync(targetPath)) {
            results.push({ path: targetPath, success: true })
            continue
          }

          await shell.trashItem(targetPath)
          results.push({ path: targetPath, success: true })
        } catch (error) {
          const errorMsg = String(error)
          results.push({ path: targetPath, success: false, error: errorMsg })
          log(`[TrashBatch #${batchId}] Failed to trash: ${fileName} - ${errorMsg}`)
        }
      }
    } finally {
      // Restart watcher ONCE after all operations complete
      if (needsWatcherPause && workingDirectory && fs.existsSync(workingDirectory)) {
        log(`[TrashBatch #${batchId}] Restarting file watcher after batch operation`)
        await startFileWatcher(workingDirectory)
      }
    }

    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const duration = Date.now() - startTime

    log(
      `[TrashBatch #${batchId}] END: ${succeeded}/${paths.length} succeeded, ${failed} failed, ${duration}ms`,
    )

    return {
      success: failed === 0,
      results,
      summary: { total: paths.length, succeeded, failed, duration },
    }
  })

  // Native file drag - enables dragging files from BluePLM to external applications
  // Note: When dragging to SolidWorks, the smart drag detection in handleDragEnd
  // will automatically use the SolidWorks API to add components if an assembly is open
  ipcMain.on('fs:start-drag', (event, filePaths: string[]) => {
    log('fs:start-drag received: ' + filePaths.length + ' files')

    const validPaths = filePaths.filter((p) => {
      try {
        // Normalize the path for Windows (ensure backslashes)
        const normalizedPath = path.normalize(p)
        const exists = fs.existsSync(normalizedPath)
        const isFile = exists && fs.statSync(normalizedPath).isFile()
        if (!exists) log('  File does not exist: ' + normalizedPath)
        if (exists && !isFile) log('  Not a file (possibly directory): ' + normalizedPath)
        return isFile
      } catch (error) {
        log('  Error checking file: ' + p + ' ' + String(error))
        return false
      }
    })

    if (validPaths.length === 0) {
      log('No valid paths for drag')
      return
    }

    // Normalize paths for Windows
    const normalizedPaths = validPaths.map((p) => path.normalize(p))
    log('Valid paths for drag: ' + normalizedPaths.join(', '))

    try {
      // Use the first file for drag (Electron limitation - single file only)
      const file = normalizedPaths[0]
      const icon = getDragIconForFile(file)

      if (mainWindow && !mainWindow.isDestroyed()) {
        log('Calling startDrag via mainWindow.webContents for: ' + file)
        mainWindow.webContents.startDrag({
          file,
          icon,
        })
        log('startDrag completed successfully')
      } else {
        log('mainWindow not available, using event.sender')
        event.sender.startDrag({
          file,
          icon,
        })
        log('startDrag via event.sender completed')
      }
    } catch (error) {
      log('startDrag error: ' + String(error))
    }
  })

  ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    const maxRetries = 3
    const fileName = path.basename(oldPath)
    const startTime = Date.now()

    // Debug logging
    log(`[Rename-DEBUG] Starting rename operation`)
    log(`[Rename-DEBUG] Source: ${oldPath}`)
    log(`[Rename-DEBUG] Dest: ${newPath}`)
    log(`[Rename-DEBUG] Timestamp: ${new Date().toISOString()}`)

    // Count files before rename (for accurate reporting on success)
    let fileCount = 1
    let isDirectory = false
    try {
      const stats = fs.statSync(oldPath)
      isDirectory = stats.isDirectory()
      if (isDirectory) {
        fileCount = countFilesInDir(oldPath)
        log(`[Rename-DEBUG] Is directory with ${fileCount} files`)
        // NOTE: Lock checking is now done at the UI level BEFORE calling rename,
        // using the fs:check-folder-locks IPC handler which shows a modal to the user
      } else {
        log(`[Rename-DEBUG] Is single file`)
      }
    } catch {
      // If we can't stat, assume it's a single file
      log(`[Rename-DEBUG] Could not stat source, assuming single file`)
    }

    // For directories within the working directory, pause the file watcher
    // Chokidar holds handles on directories which prevents Windows from renaming them
    const needsWatcherPause =
      isDirectory &&
      workingDirectory &&
      (oldPath === workingDirectory ||
        workingDirectory.startsWith(oldPath) ||
        oldPath.startsWith(workingDirectory) ||
        newPath.startsWith(workingDirectory))

    if (needsWatcherPause && fileWatcher) {
      log(`[Rename] Stopping file watcher for directory rename`)
      await stopFileWatcher()
      // Wait for Windows to release kernel-level directory handles
      // 500ms gives Windows kernel time to flush handle caches after chokidar releases them
      await new Promise((resolve) => setTimeout(resolve, DIR_RENAME_HANDLE_RELEASE_MS))
    }

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const attemptStart = Date.now()
        try {
          fs.renameSync(oldPath, newPath)
          const totalDuration = Date.now() - startTime
          log(`[Rename-DEBUG] SUCCESS on attempt ${attempt} after ${totalDuration}ms`)
          log(`Renamed: ${oldPath} -> ${newPath} (${fileCount} files)`)
          return { success: true, fileCount }
        } catch (error) {
          const attemptDuration = Date.now() - attemptStart
          const errStr = String(error)
          const isLocked =
            errStr.includes('EPERM') ||
            errStr.includes('EBUSY') ||
            errStr.includes('operation not permitted')

          log(
            `[Rename-DEBUG] Attempt ${attempt}/${maxRetries} failed after ${attemptDuration}ms, isLocked=${isLocked}`,
          )

          if (isLocked && attempt < maxRetries) {
            // Try to identify the locking process
            log(
              `[Rename] Attempt ${attempt}/${maxRetries} failed for ${fileName}, detecting lock...`,
            )
            const lockInfo = await findLockingProcess(oldPath)
            if (lockInfo) {
              log(`[Rename] LOCK DETECTION: ${lockInfo}`)
            }

            const delay = attempt * 500 // 500ms, 1000ms
            log(`[Rename] Waiting ${delay}ms before retry...`)
            await new Promise((resolve) => setTimeout(resolve, delay))
            continue
          }

          // Final failure - get lock info for error message
          const totalDuration = Date.now() - startTime
          log(`[Rename-DEBUG] FINAL FAILURE after ${totalDuration}ms total`)
          logError('Rename FAILED: ' + oldPath + ' -> ' + newPath + ' | Error: ' + errStr)

          if (isLocked) {
            const lockInfo = await findLockingProcess(oldPath)
            let lockDetail = lockInfo || 'unknown process'

            // For directories, probe ALL files inside to find which specific file(s) are locked
            // Note: This scans ALL files with no limit, checking read-only vs truly locked
            let lockedFiles: Array<{ path: string; name: string; error: string }> = []
            try {
              const stats = fs.statSync(oldPath)
              if (stats.isDirectory()) {
                log(`[Rename] Probing ALL files in folder to find locked file(s)...`)

                // Inline recursive scan - no sampling, no limit
                function scanForLocks(dir: string): void {
                  try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true })
                    for (const entry of entries) {
                      const fullPath = path.join(dir, entry.name)
                      if (entry.isDirectory()) {
                        scanForLocks(fullPath)
                      } else {
                        // Try to open file with O_RDWR to detect locks
                        try {
                          const fd = fs.openSync(fullPath, fs.constants.O_RDWR)
                          fs.closeSync(fd)
                          // File is not locked
                        } catch (error: unknown) {
                          const nodeErr = error as NodeJS.ErrnoException
                          if (
                            nodeErr.code === 'EBUSY' ||
                            nodeErr.code === 'EACCES' ||
                            nodeErr.code === 'EPERM'
                          ) {
                            // Check if read-only (can still be moved) vs truly locked
                            try {
                              const fileStats = fs.statSync(fullPath)
                              const isReadOnly = (fileStats.mode & 0o200) === 0
                              if (!isReadOnly) {
                                // Truly locked, not just read-only
                                lockedFiles.push({
                                  path: fullPath,
                                  name: entry.name,
                                  error: nodeErr.code,
                                })
                              }
                            } catch {
                              // Can't stat, assume locked
                              lockedFiles.push({
                                path: fullPath,
                                name: entry.name,
                                error: nodeErr.code || 'UNKNOWN',
                              })
                            }
                          }
                        }
                      }
                    }
                  } catch (readErr) {
                    log(`[Rename] Cannot read directory: ${dir} - ${readErr}`)
                  }
                }

                scanForLocks(oldPath)

                if (lockedFiles.length > 0) {
                  const lockedFileNames = lockedFiles.map((f) => f.name).join(', ')
                  log(`[Rename] LOCKED FILES FOUND: ${lockedFileNames}`)
                  // Include locked file summary in the lock detail (avoid massive strings for many files)
                  if (lockedFiles.length > 5) {
                    // Show count for large numbers of locked files
                    lockDetail = `${lockDetail} | ${lockedFiles.length} files locked`
                  } else {
                    // Show individual file names for small numbers
                    lockDetail = `${lockDetail} | Locked: ${lockedFileNames}`
                  }
                } else {
                  log(`[Rename] No locked files found (lock may be on folder itself)`)
                }
              }
            } catch (statErr) {
              log(`[Rename] Could not stat path for folder detection: ${statErr}`)
            }

            log(`[Rename] Final lock detection: ${lockDetail}`)

            // Try PowerShell fallback for directory moves when fs.renameSync fails
            // PowerShell's Move-Item uses Windows Shell APIs (IFileOperation) which have
            // better handle management and can often succeed when Node.js fs.renameSync fails
            // Only available on Windows - Mac doesn't have the same handle locking issues
            if (isDirectory && process.platform === 'win32') {
              const psStartTime = Date.now()
              log(`[Rename-PS] === PowerShell Fallback Attempt ===`)
              log(`[Rename-PS] Source: ${oldPath}`)
              log(`[Rename-PS] Destination: ${newPath}`)
              log(`[Rename-PS] File count: ${fileCount}`)

              try {
                // Use -LiteralPath to handle paths with special characters (brackets, etc.)
                // Escape single quotes in paths by doubling them for PowerShell
                const escapedOldPath = oldPath.replace(/'/g, "''")
                const escapedNewPath = newPath.replace(/'/g, "''")
                const psCommand = `powershell -NoProfile -Command "Move-Item -LiteralPath '${escapedOldPath}' -Destination '${escapedNewPath}' -Force"`

                log(`[Rename-PS] Executing: ${psCommand}`)

                const { stdout, stderr } = await execAsync(psCommand, { timeout: 30000 })

                const psDuration = Date.now() - psStartTime
                log(`[Rename-PS] SUCCESS in ${psDuration}ms`)
                if (stdout && stdout.trim()) {
                  log(`[Rename-PS] stdout: ${stdout.trim()}`)
                }
                if (stderr && stderr.trim()) {
                  log(`[Rename-PS] stderr: ${stderr.trim()}`)
                }

                // Verify the move actually happened
                const sourceGone = !fs.existsSync(oldPath)
                const destExists = fs.existsSync(newPath)
                log(`[Rename-PS] Verification: sourceGone=${sourceGone}, destExists=${destExists}`)

                if (sourceGone && destExists) {
                  log(`[Rename-PS] Move verified successfully`)
                  return { success: true, fileCount }
                } else {
                  log(`[Rename-PS] Move verification FAILED - source still exists or dest missing`)
                  // Fall through to return original error
                }
              } catch (psErr: unknown) {
                const psDuration = Date.now() - psStartTime
                const psError = psErr as {
                  stdout?: string
                  stderr?: string
                  code?: number
                  message?: string
                }
                log(`[Rename-PS] FAILED after ${psDuration}ms`)
                log(`[Rename-PS] Error: ${psError.message || String(psErr)}`)
                if (psError.code !== undefined) {
                  log(`[Rename-PS] Exit code: ${psError.code}`)
                }
                if (psError.stdout && psError.stdout.trim()) {
                  log(`[Rename-PS] stdout: ${psError.stdout.trim()}`)
                }
                if (psError.stderr && psError.stderr.trim()) {
                  log(`[Rename-PS] stderr: ${psError.stderr.trim()}`)
                }
                // Continue to return the original error
              }
              log(`[Rename-PS] === End PowerShell Fallback ===`)
            }

            return {
              success: false,
              error: errStr,
              lockInfo: lockDetail,
              lockedFiles: lockedFiles.length > 0 ? lockedFiles : undefined,
            }
          }

          return { success: false, error: errStr }
        }
      }

      return { success: false, error: 'Max retries exceeded' }
    } finally {
      // Restart watcher if we paused it
      if (needsWatcherPause && workingDirectory && fs.existsSync(workingDirectory)) {
        log(`[Rename] Restarting file watcher after rename`)
        await startFileWatcher(workingDirectory)
      }
    }
  })

  // Test file locks in a folder - useful for debugging move failures
  // Note: This now scans ALL files (no sampling) and properly distinguishes read-only vs locked
  ipcMain.handle('fs:test-file-locks', async (_, folderPath: string, _sampleSize: number = 10) => {
    log(`[LockTest] Testing file locks in: ${folderPath}`)

    const startTime = Date.now()

    try {
      const stats = fs.statSync(folderPath)
      if (!stats.isDirectory()) {
        log(`[LockTest] Path is not a directory`)
        return { tested: 0, locked: 0, unlocked: 0, lockedFiles: [], error: 'Not a directory' }
      }
    } catch (error) {
      log(`[LockTest] Error accessing path: ${error}`)
      return { tested: 0, locked: 0, unlocked: 0, lockedFiles: [], error: String(error) }
    }

    // Inline lock detection - scans ALL files, distinguishes read-only vs truly locked
    const lockedFiles: Array<{ name: string; path: string }> = []
    let totalFiles = 0

    function scanDir(dir: string): void {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            scanDir(fullPath)
          } else {
            totalFiles++
            try {
              const fd = fs.openSync(fullPath, fs.constants.O_RDWR)
              fs.closeSync(fd)
              // File is not locked
            } catch (error: unknown) {
              const nodeErr = error as NodeJS.ErrnoException
              if (
                nodeErr.code === 'EBUSY' ||
                nodeErr.code === 'EACCES' ||
                nodeErr.code === 'EPERM'
              ) {
                // Check if read-only vs truly locked
                try {
                  const fileStats = fs.statSync(fullPath)
                  const isReadOnly = (fileStats.mode & 0o200) === 0
                  if (!isReadOnly) {
                    lockedFiles.push({ name: entry.name, path: fullPath })
                  }
                } catch {
                  lockedFiles.push({ name: entry.name, path: fullPath })
                }
              }
            }
          }
        }
      } catch (readErr) {
        log(`[LockTest] Cannot read directory: ${dir} - ${readErr}`)
      }
    }

    scanDir(folderPath)

    const duration = Date.now() - startTime

    const result = {
      tested: totalFiles,
      locked: lockedFiles.length,
      unlocked: totalFiles - lockedFiles.length,
      lockedFiles: lockedFiles.map((f) => f.name),
      duration,
    }

    log(`[LockTest] Result: ${result.locked}/${result.tested} locked (${duration}ms)`)
    if (result.locked > 0) {
      log(`[LockTest] Locked files: ${result.lockedFiles.join(', ')}`)
    }

    return result
  })

  // Check ALL files in a folder for locks (no sampling) - used before folder moves
  // Returns detailed info about each locked file including process name
  // Emits progress events via 'fs:check-folder-locks-progress' channel
  ipcMain.handle('fs:check-folder-locks', async (event, folderPath: string) => {
    log(`[LockCheck] Checking ALL files for locks in: ${folderPath}`)

    const startTime = Date.now()

    try {
      const stats = fs.statSync(folderPath)
      if (!stats.isDirectory()) {
        log(`[LockCheck] Path is not a directory`)
        return {
          lockedFiles: [],
          totalFiles: 0,
          error: 'Not a directory',
        }
      }
    } catch (error) {
      log(`[LockCheck] Error accessing path: ${error}`)
      return {
        lockedFiles: [],
        totalFiles: 0,
        error: String(error),
      }
    }

    interface LockedFileInfo {
      filename: string // Just the filename
      relativePath: string // Path relative to folderPath
      fullPath: string // Full absolute path
      process: string // Process name or "Unknown"
    }

    const lockedFiles: LockedFileInfo[] = []
    let totalFiles = 0

    // Send progress updates every 100ms
    let lastProgressTime = Date.now()
    const sendProgress = () => {
      const now = Date.now()
      if (now - lastProgressTime >= 100) {
        event.sender.send('fs:check-folder-locks-progress', {
          scanned: totalFiles,
          locked: lockedFiles.length,
          folderPath,
        })
        lastProgressTime = now
      }
    }

    // Recursively scan all files
    function scanDir(dir: string): void {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            scanDir(fullPath)
          } else {
            totalFiles++
            sendProgress() // Send progress update

            // Try to open file with O_RDWR to detect locks
            // If it fails, check if it's read-only (which CAN be moved) vs truly locked
            try {
              const fd = fs.openSync(fullPath, fs.constants.O_RDWR)
              fs.closeSync(fd)
              // File is not locked
            } catch (error: unknown) {
              const nodeErr = error as NodeJS.ErrnoException
              if (
                nodeErr.code === 'EBUSY' ||
                nodeErr.code === 'EACCES' ||
                nodeErr.code === 'EPERM'
              ) {
                // O_RDWR failed - but is it locked or just read-only?
                // Check the read-only attribute AFTER the failure
                try {
                  const stats = fs.statSync(fullPath)
                  const isReadOnly = (stats.mode & 0o200) === 0 // No user write permission

                  if (!isReadOnly) {
                    // File is NOT read-only, so it's truly locked by another process
                    const relativePath = path.relative(folderPath, fullPath).replace(/\\/g, '/')

                    // Quick check: SolidWorks temp file indicates SLDWORKS.exe
                    const baseName = path.basename(fullPath, path.extname(fullPath))
                    const tempFile = path.join(
                      path.dirname(fullPath),
                      `~$${baseName}${path.extname(fullPath)}`,
                    )
                    const processName = fs.existsSync(tempFile) ? 'SLDWORKS.exe' : 'Unknown'

                    lockedFiles.push({
                      filename: entry.name,
                      relativePath,
                      fullPath,
                      process: processName,
                    })
                  }
                  // If isReadOnly, file CAN be moved on Windows - don't report as locked
                } catch {
                  // Can't stat file, assume it's locked to be safe
                  const relativePath = path.relative(folderPath, fullPath).replace(/\\/g, '/')
                  lockedFiles.push({
                    filename: entry.name,
                    relativePath,
                    fullPath,
                    process: 'Unknown',
                  })
                }
              }
            }
          }
        }
      } catch (error) {
        log(`[LockCheck] Cannot read directory: ${dir} - ${error}`)
      }
    }

    scanDir(folderPath)

    // Send final progress
    event.sender.send('fs:check-folder-locks-progress', {
      scanned: totalFiles,
      locked: lockedFiles.length,
      folderPath,
      complete: true,
    })

    const duration = Date.now() - startTime

    log(
      `[LockCheck] Scanned ${totalFiles} files, found ${lockedFiles.length} locked (${duration}ms)`,
    )
    if (lockedFiles.length > 0) {
      log(
        `[LockCheck] Locked files: ${lockedFiles
          .slice(0, 10)
          .map((f) => f.filename)
          .join(', ')}${lockedFiles.length > 10 ? ` and ${lockedFiles.length - 10} more` : ''}`,
      )
    }

    return {
      lockedFiles,
      totalFiles,
      duration,
    }
  })

  ipcMain.handle('fs:copy-file', async (_, sourcePath: string, destPath: string) => {
    try {
      const stats = fs.statSync(sourcePath)
      let fileCount = 0

      if (stats.isDirectory()) {
        fileCount = copyDirSync(sourcePath, destPath)
        log(`Copied directory: ${sourcePath} -> ${destPath} (${fileCount} files)`)
      } else {
        const destDir = path.dirname(destPath)
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }

        fs.copyFileSync(sourcePath, destPath)
        fileCount = 1
        log('Copied file: ' + sourcePath + ' -> ' + destPath)
      }

      return { success: true, fileCount }
    } catch (error) {
      log('Error copying: ' + String(error))
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('fs:move-file', async (_, sourcePath: string, destPath: string) => {
    try {
      const stats = fs.statSync(sourcePath)
      const isDirectory = stats.isDirectory()

      if (isDirectory) {
        const srcResolved = path.resolve(sourcePath).toLowerCase()
        const destResolved = path.resolve(destPath).toLowerCase()
        if (
          destResolved === srcResolved ||
          destResolved.startsWith(srcResolved + path.sep)
        ) {
          log(`Error moving: cannot move directory into itself: ${sourcePath} -> ${destPath}`)
          return { success: false, error: 'Cannot move a folder into itself or a subfolder' }
        }
      }

      // Count files before move (for accurate reporting)
      const fileCount = isDirectory ? countFilesInDir(sourcePath) : 1

      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }

      try {
        fs.renameSync(sourcePath, destPath)
        log(`Moved (rename): ${sourcePath} -> ${destPath} (${fileCount} files)`)
        return { success: true, fileCount }
      } catch (renameErr) {
        log('Rename failed, trying copy+delete: ' + String(renameErr))
      }

      if (isDirectory) {
        const copiedCount = copyDirSync(sourcePath, destPath)
        fs.rmSync(sourcePath, { recursive: true, force: true })
        log(`Moved (copy+delete) directory: ${sourcePath} -> ${destPath} (${copiedCount} files)`)
        return { success: true, fileCount: copiedCount }
      } else {
        fs.copyFileSync(sourcePath, destPath)
        fs.unlinkSync(sourcePath)
        log('Moved (copy+delete) file: ' + sourcePath + ' -> ' + destPath)
        return { success: true, fileCount: 1 }
      }
    } catch (error) {
      log('Error moving: ' + String(error))
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('fs:open-in-explorer', async (_, targetPath: string) => {
    shell.showItemInFolder(targetPath)
    return { success: true }
  })

  ipcMain.handle('fs:open-file', async (_, filePath: string) => {
    try {
      // Check if this is a SolidWorks file - if so, start grace period for orphan cleanup
      const ext = path.extname(filePath).toLowerCase()
      if (['.sldprt', '.sldasm', '.slddrw'].includes(ext)) {
        recordSolidWorksFileOpen()
      }

      const error = await shell.openPath(filePath)
      if (error) {
        logError(`[Main] Failed to open file: ${filePath}`, { error })
        return { success: false, error }
      }
      return { success: true }
    } catch (error) {
      logError(`[Main] Error opening file: ${filePath}`, { error: String(error) })
      return { success: false, error: String(error) }
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
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('fs:is-readonly', async (_, filePath: string) => {
    try {
      const stats = fs.statSync(filePath)
      const isReadonly = (stats.mode & 0o200) === 0
      return { success: true, readonly: isReadonly }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Batch readonly operations - process multiple files in a single IPC call
  // This is much more efficient than making N separate IPC calls for N files
  ipcMain.handle(
    'fs:set-readonly-batch',
    async (_, files: Array<{ path: string; readonly: boolean }>) => {
      const results: Array<{ path: string; success: boolean; error?: string }> = []

      for (const file of files) {
        try {
          const stats = fs.statSync(file.path)
          if (stats.isDirectory()) {
            results.push({ path: file.path, success: true })
            continue
          }

          const currentMode = stats.mode

          if (file.readonly) {
            const newMode = currentMode & ~0o222
            fs.chmodSync(file.path, newMode)
          } else {
            const newMode = currentMode | 0o200
            fs.chmodSync(file.path, newMode)
          }

          results.push({ path: file.path, success: true })
        } catch (error) {
          results.push({ path: file.path, success: false, error: String(error) })
        }
      }

      return { success: true, results }
    },
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK SUPPORT HANDLERS
// These handlers support the self-test regression framework by providing
// file inspection, hashing, and test script discovery capabilities.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute a cryptographic hash of a file.
 * Uses streaming to handle large files without loading them entirely into memory.
 *
 * @param filePath - Absolute path to the file
 * @param algorithm - Hash algorithm to use (default: 'sha256')
 * @returns Object with success status, hex hash string, algorithm used, or error
 */
ipcMain.handle('fs:get-file-hash', async (_, filePath: string, algorithm?: string) => {
  const algo = algorithm || 'sha256'
  try {
    if (!filePath) {
      return { success: false, hash: '', algorithm: algo, error: 'Missing file path' }
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, hash: '', algorithm: algo, error: 'File not found' }
    }

    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      return { success: false, hash: '', algorithm: algo, error: 'Path is a directory, not a file' }
    }

    const { hash } = await hashFileAsync(filePath)
    // hashFileAsync always uses sha256; for other algorithms, recompute
    if (algo !== 'sha256') {
      const fileHash = crypto.createHash(algo)
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })

      return new Promise<{ success: boolean; hash: string; algorithm: string; error?: string }>(
        (resolve) => {
          stream.on('data', (chunk: Buffer) => {
            fileHash.update(chunk)
          })
          stream.on('end', () => {
            resolve({ success: true, hash: fileHash.digest('hex'), algorithm: algo })
          })
          stream.on('error', (error) => {
            resolve({
              success: false,
              hash: '',
              algorithm: algo,
              error: `Hash computation failed: ${error.message}`,
            })
          })
        },
      )
    }

    return { success: true, hash, algorithm: algo }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logError('Failed to compute file hash', { filePath, algorithm: algo, error: errMsg })
    return { success: false, hash: '', algorithm: algo, error: errMsg }
  }
})

/**
 * List all .bptest files in a folder (recursively).
 * Used by the self-test framework to discover test scripts.
 *
 * @param folderPath - Absolute path to the folder to scan
 * @returns Object with success status, array of absolute file paths, or error
 */
ipcMain.handle('fs:list-test-scripts', async (_, folderPath: string) => {
  try {
    if (!folderPath) {
      return { success: false, files: [], error: 'Missing folder path' }
    }

    if (!fs.existsSync(folderPath)) {
      return { success: false, files: [], error: 'Folder not found' }
    }

    const stats = fs.statSync(folderPath)
    if (!stats.isDirectory()) {
      return { success: false, files: [], error: 'Path is not a directory' }
    }

    const testFiles: string[] = []

    function scanDir(dir: string): void {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          // Skip hidden files/folders and common non-test directories
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            scanDir(fullPath)
          } else if (entry.name.endsWith('.bptest')) {
            testFiles.push(fullPath)
          }
        }
      } catch (error) {
        logWarn('Error scanning directory for test scripts', { dir, error: String(error) })
      }
    }

    scanDir(folderPath)

    // Sort alphabetically for deterministic output
    testFiles.sort((a, b) => a.localeCompare(b))

    return { success: true, files: testFiles }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logError('Failed to list test scripts', { folderPath, error: errMsg })
    return { success: false, files: [], error: errMsg }
  }
})

/**
 * Read a file as UTF-8 text (no base64 encoding).
 * Used for reading test scripts and other text-based configuration files.
 *
 * @param filePath - Absolute path to the file
 * @returns Object with success status, UTF-8 text content, or error
 */
ipcMain.handle('fs:read-text-file', async (_, filePath: string) => {
  try {
    if (!filePath) {
      return { success: false, content: '', error: 'Missing file path' }
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, content: '', error: 'File not found' }
    }

    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      return { success: false, content: '', error: 'Path is a directory, not a file' }
    }

    // Guard against excessively large text files (50 MB limit)
    const MAX_TEXT_SIZE = 50 * 1024 * 1024
    if (stats.size > MAX_TEXT_SIZE) {
      return {
        success: false,
        content: '',
        error: `File too large for text reading (${Math.round(stats.size / 1024 / 1024)}MB, limit is 50MB)`,
      }
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logError('Failed to read text file', { filePath, error: errMsg })
    return { success: false, content: '', error: errMsg }
  }
})

export function unregisterFsHandlers(): void {
  const handlers = [
    'working-dir:select',
    'working-dir:get',
    'working-dir:clear',
    'working-dir:set',
    'working-dir:create',
    'fs:read-file',
    'fs:write-file',
    'fs:download-url',
    'fs:file-exists',
    'fs:get-hash',
    'fs:hash-file',
    'fs:list-dir-files',
    'fs:list-working-files',
    'fs:compute-file-hashes',
    'fs:create-folder',
    'fs:is-dir-empty',
    'fs:is-directory',
    'fs:delete',
    'fs:delete-batch',
    'fs:trash-batch',
    'fs:rename',
    'fs:copy-file',
    'fs:move-file',
    'fs:open-in-explorer',
    'fs:open-file',
    'fs:set-readonly',
    'fs:is-readonly',
    'fs:set-readonly-batch',
    'fs:get-file-hash',
    'fs:list-test-scripts',
    'fs:read-text-file',
  ]

  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }

  ipcMain.removeListener('fs:start-drag', () => {})
}

/**
 * Cleanup file system resources on app quit.
 * Stops the file watcher to allow the process to exit cleanly.
 *
 * CRITICAL FOR CLEAN EXIT: close() can hang if there are pending file system
 * operations, so we add a hard timeout to ensure this cleanup doesn't block app
 * exit indefinitely.
 *
 * @param timeoutMs - Maximum time to wait for watcher.close() (default: 2000ms)
 */
export async function cleanupFs(timeoutMs: number = 2000): Promise<void> {
  if (fileWatcher) {
    log('Stopping file watcher for cleanup')
    const watcher = fileWatcher
    fileWatcher = null
    currentWatchPath = null

    try {
      // Race between watcher.close() and a hard timeout
      // This ensures we don't hang forever if the watcher is stuck
      await Promise.race([
        watcher.close().then(() => {
          log('File watcher closed successfully')
        }),
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error('File watcher close timed out'))
          }, timeoutMs)
        }),
      ])
    } catch (error) {
      // Log error but don't throw - we need cleanup to continue even if watcher is stuck
      logError('Error closing file watcher (continuing with cleanup)', { error: String(error) })
    }
  }
}
