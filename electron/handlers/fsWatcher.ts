// Vault file watcher.
//
// Two backends behind one interface:
//
// - Windows and macOS use a single native recursive fs.watch handle, which the OS
//   sets up in constant time. Measured against a 27,600-entry vault: chokidar took
//   194,928ms to reach `ready` while saturating the main process event loop the whole
//   time, and fs.watch({ recursive: true }) took 0ms. That stall was what made the
//   startup vault scan take 35-40s instead of ~1s.
// - Linux keeps chokidar. Node supports recursive watching there, but through a
//   userspace implementation that walks the tree the same way chokidar does, so there
//   is nothing to gain and a working watcher to lose.
//
// The native backend has to reconstruct what chokidar handed us for free: the
// add/change/unlink/addDir/unlinkDir distinction, and awaitWriteFinish.

import type { BrowserWindow } from 'electron'
import fs from 'fs'
import type * as fsTypes from 'fs'
import path from 'path'

import chokidar from 'chokidar'

const DEBOUNCE_MS = 1_000
const DEBOUNCE_BULK_MS = 2_000
const BULK_CHANGE_THRESHOLD = 10
const WRITE_SETTLE_MS = 750
const WATCHER_RESTART_DELAY_MS = 1_000
const UNNAMED_EVENT_SUMMARY_MS = 5_000

/**
 * How many changed paths to name in the log line.
 *
 * A bare count is not diagnosable. An 88-file batch that nobody could explain after the fact cost
 * an afternoon of reading logs that recorded only "88 files"; a handful of paths and the common
 * folder identify the culprit immediately, and a handful is cheap enough to log every time.
 */
const CHANGE_SAMPLE_SIZE = 5

/** Describe a change batch so an unexplained one is diagnosable from the log alone. */
function describeChanges(paths: string[]): string {
  const sample = paths.slice(0, CHANGE_SAMPLE_SIZE)
  const remainder = paths.length - sample.length
  const folders = new Set(paths.map((p) => path.dirname(p)))

  const suffix = remainder > 0 ? `, +${remainder} more` : ''
  const scope =
    folders.size === 1
      ? `all in ${Array.from(folders)[0]}`
      : `across ${folders.size} folders`

  return `${paths.length} files (${scope}): ${sample.join(', ')}${suffix}`
}

const IGNORED_PATTERNS = [
  /(^|[/\\])\../,
  /node_modules/,
  /\.git/,
  /desktop\.ini/i,
  /thumbs\.db/i,
  /\$RECYCLE\.BIN/i,
  /System Volume Information/i,
  /~\$/,
  /\.tmp$/i,
  /\.swp$/i,
  /\.download$/,
]

/** The subset of a watcher the rest of the main process depends on. */
export interface VaultWatcher {
  close(): Promise<void>
}

/**
 * Prior on-disk state, used to classify raw fs.watch events.
 *
 * A native event only says "this path changed" - turning that into added vs removed
 * and file vs directory needs to know what was there before, which is exactly what the
 * last full scan recorded.
 */
export interface WatcherScanCache {
  /** `undefined` when the path is unknown: either newly created or never scanned. */
  getKind(relativePath: string): 'directory' | 'file' | undefined
  /** False until a full scan has run, when every path would look newly added. */
  isPopulated(): boolean
  setEntry(relativePath: string, fullPath: string, stats: fsTypes.Stats): void
  /** Removes the path and, for a directory, everything beneath it. */
  deleteEntry(relativePath: string): void
  invalidate(): void
}

export interface VaultWatcherDeps {
  log: (message: string, data?: unknown) => void
  getMainWindow: () => BrowserWindow | null
  scanCache: WatcherScanCache
}

function isIgnored(relativePath: string): boolean {
  return IGNORED_PATTERNS.some((pattern) => pattern.test(relativePath))
}

function toRelativePath(dirPath: string, fullPath: string): string {
  return path.relative(dirPath, fullPath).replace(/\\/g, '/')
}

export function createVaultWatcher(dirPath: string, deps: VaultWatcherDeps): VaultWatcher {
  return process.platform === 'linux'
    ? createChokidarWatcher(dirPath, deps)
    : createNativeWatcher(dirPath, deps)
}

/**
 * One recursive OS watch handle for the whole vault.
 *
 * Events arrive as `(eventType, filename)` with no indication of what kind of entry it
 * is or whether it still exists, so classification happens at flush time against the
 * scan cache - after the debounce has already collapsed the burst of events Windows
 * emits for a single write.
 */
function createNativeWatcher(dirPath: string, deps: VaultWatcherDeps): VaultWatcher {
  const { log, getMainWindow, scanCache } = deps

  const pending = new Set<string>()
  /** Size/mtime of files seen mid-write, so we can wait for them to stop moving. */
  const inFlightWrites = new Map<string, { size: number; mtimeMs: number; observedAt: number }>()

  let watcher: fsTypes.FSWatcher | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  let restartTimer: NodeJS.Timeout | null = null
  let unnamedEventTimer: NodeJS.Timeout | null = null
  let unnamedEventCount = 0
  let closed = false

  const scheduleFlush = (delay: number): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void flush()
    }, delay)
  }

  /**
   * Ask the renderer for a full reload.
   *
   * Used when events were lost, which an incremental refresh cannot recover from: an
   * empty `files-changed` would be ignored by the renderer, and a partial one would
   * silently leave whatever we missed stale.
   */
  const requestResync = (reason: string): void => {
    log('Vault watcher requesting full resync: ' + reason)
    scanCache.invalidate()
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('vault-resync-required', reason)
    }
  }

  /**
   * Windows reports a notification without a filename when it cannot attribute one,
   * and on a tree this size that happens steadily in the background - measured at
   * roughly one every two seconds on an idle 27,600-entry vault, and far more while the
   * app is reading files. They carry no path, and real changes still arrive as named
   * events alongside them, so they are counted rather than acted on. Reloading the
   * vault for each one would mean a full rescan every couple of seconds.
   */
  const noteUnnamedEvent = (): void => {
    unnamedEventCount++
    if (unnamedEventTimer) return
    unnamedEventTimer = setTimeout(() => {
      unnamedEventTimer = null
      log('Ignored unnamed watch notifications: ' + unnamedEventCount)
      unnamedEventCount = 0
    }, UNNAMED_EVENT_SUMMARY_MS)
  }

  const flush = async (): Promise<void> => {
    debounceTimer = null
    if (closed || pending.size === 0) return

    const batch = Array.from(pending)
    pending.clear()

    const changedPaths: string[] = []
    const addedDirectories: string[] = []
    const removedDirectories: string[] = []
    const stillSettling: string[] = []

    for (const relativePath of batch) {
      const fullPath = path.join(dirPath, relativePath)

      let stats: fsTypes.Stats | null = null
      try {
        stats = await fs.promises.stat(fullPath)
      } catch {
        stats = null
      }

      if (closed) return

      if (!stats) {
        const previousKind = scanCache.getKind(relativePath)
        scanCache.deleteEntry(relativePath)
        inFlightWrites.delete(relativePath)
        if (previousKind === 'directory') removedDirectories.push(relativePath)
        changedPaths.push(relativePath)
        continue
      }

      if (stats.isDirectory()) {
        const alreadyKnown = scanCache.getKind(relativePath) === 'directory'
        scanCache.setEntry(relativePath, fullPath, stats)
        inFlightWrites.delete(relativePath)

        // A directory we already knew about only fires because its contents moved, and
        // the event for the child covers that.
        if (alreadyKnown) continue

        // Before the first full scan every directory looks new, so reporting additions
        // then would create phantom folders on the server.
        if (scanCache.isPopulated()) addedDirectories.push(relativePath)

        // A directory rename produces no events for its descendants, so the path itself
        // has to reach the renderer for the subtree to be re-scanned.
        changedPaths.push(relativePath)
        continue
      }

      // Stand in for chokidar's awaitWriteFinish: report a file only once its size and
      // mtime have held still, so a large SolidWorks save is not read mid-write.
      const previousWrite = inFlightWrites.get(relativePath)
      if (
        !previousWrite ||
        previousWrite.size !== stats.size ||
        previousWrite.mtimeMs !== stats.mtimeMs
      ) {
        inFlightWrites.set(relativePath, {
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          observedAt: Date.now(),
        })
        stillSettling.push(relativePath)
        continue
      }

      if (Date.now() - previousWrite.observedAt < WRITE_SETTLE_MS) {
        stillSettling.push(relativePath)
        continue
      }

      inFlightWrites.delete(relativePath)
      scanCache.setEntry(relativePath, fullPath, stats)
      changedPaths.push(relativePath)
    }

    for (const relativePath of stillSettling) pending.add(relativePath)
    if (stillSettling.length > 0) scheduleFlush(WRITE_SETTLE_MS)

    const window = getMainWindow()
    if (!window || window.isDestroyed()) return

    for (const relativePath of addedDirectories) {
      log('Directory added: ' + relativePath)
      window.webContents.send('directory-added', relativePath)
    }

    for (const relativePath of removedDirectories) {
      log('Directory removed: ' + relativePath)
      window.webContents.send('directory-removed', relativePath)
    }

    if (changedPaths.length > 0) {
      log('File changes detected: ' + describeChanges(changedPaths))
      window.webContents.send('files-changed', changedPaths)
    }
  }

  const handleEvent = (_eventType: fsTypes.WatchEventType, filename: string | Buffer | null) => {
    if (closed) return

    if (filename === null || filename === undefined) {
      noteUnnamedEvent()
      return
    }

    const relativePath = filename.toString().replace(/\\/g, '/')
    if (!relativePath || relativePath.startsWith('..')) return
    if (isIgnored(relativePath)) return

    pending.add(relativePath)
    scheduleFlush(pending.size > BULK_CHANGE_THRESHOLD ? DEBOUNCE_BULK_MS : DEBOUNCE_MS)
  }

  const detach = (): void => {
    if (!watcher) return
    const active = watcher
    watcher = null
    active.removeAllListeners()
    try {
      active.close()
    } catch {
      // Already closed by the OS - nothing left to release.
    }
  }

  const attach = (): void => {
    try {
      watcher = fs.watch(dirPath, { recursive: true, persistent: true })
    } catch (error) {
      log('Failed to start native file watcher: ' + String(error))
      return
    }
    watcher.on('change', handleEvent)
    watcher.on('error', handleError)
  }

  const restart = (): void => {
    if (closed || restartTimer) return
    detach()
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (closed) return
      attach()
      // Anything that happened while the handle was down was never delivered.
      requestResync('watcher restarted after error')
    }, WATCHER_RESTART_DELAY_MS)
  }

  function handleError(error: unknown): void {
    const fsError = error as NodeJS.ErrnoException
    if (fsError.code === 'EPERM' || fsError.code === 'EACCES') return
    log('File watcher error: ' + String(fsError))
    restart()
  }

  attach()

  return {
    close: async (): Promise<void> => {
      closed = true
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      if (unnamedEventTimer) {
        clearTimeout(unnamedEventTimer)
        unnamedEventTimer = null
      }
      pending.clear()
      inFlightWrites.clear()
      detach()
    },
  }
}

/** Linux backend - unchanged chokidar behaviour. */
function createChokidarWatcher(dirPath: string, deps: VaultWatcherDeps): VaultWatcher {
  const { log, getMainWindow } = deps

  const changedFiles = new Set<string>()
  let debounceTimer: NodeJS.Timeout | null = null

  const watcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    ignorePermissionErrors: true,
    ignored: IGNORED_PATTERNS,
  })

  const notifyChanges = () => {
    const window = getMainWindow()
    if (changedFiles.size > 0 && window && !window.isDestroyed()) {
      const files = Array.from(changedFiles)
      changedFiles.clear()
      log('File changes detected: ' + describeChanges(files))
      window.webContents.send('files-changed', files)
    }
    debounceTimer = null
  }

  const handleChange = (filePath: string) => {
    changedFiles.add(toRelativePath(dirPath, filePath))

    if (debounceTimer) clearTimeout(debounceTimer)
    const delay = changedFiles.size > BULK_CHANGE_THRESHOLD ? DEBOUNCE_BULK_MS : DEBOUNCE_MS
    debounceTimer = setTimeout(notifyChanges, delay)
  }

  watcher.on('change', handleChange)
  watcher.on('add', handleChange)
  watcher.on('unlink', handleChange)

  watcher.on('addDir', (addedDirPath: string) => {
    if (addedDirPath === dirPath) return
    const relativePath = toRelativePath(dirPath, addedDirPath)
    const window = getMainWindow()
    if (relativePath && window && !window.isDestroyed()) {
      log('Directory added: ' + relativePath)
      window.webContents.send('directory-added', relativePath)
    }
  })

  watcher.on('unlinkDir', (removedDirPath: string) => {
    const relativePath = toRelativePath(dirPath, removedDirPath)
    const window = getMainWindow()
    if (relativePath && window && !window.isDestroyed()) {
      log('Directory removed: ' + relativePath)
      window.webContents.send('directory-removed', relativePath)
    }
  })

  watcher.on('error', (error: unknown) => {
    const fsError = error as NodeJS.ErrnoException
    if (fsError.code === 'EPERM' || fsError.code === 'EACCES') return
    log('File watcher error: ' + String(fsError))
  })

  return {
    close: async (): Promise<void> => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      changedFiles.clear()
      await watcher.close()
    },
  }
}
