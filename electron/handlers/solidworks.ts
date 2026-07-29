// TODO(decompose): Extract to swProcessManager.ts — process lifecycle, orphan watchdog, and process helpers (lines ~164–512)
// TODO(decompose): Extract to swCommandQueue.ts — request queue, sendSWCommand, executeCommandDirect, response parsing (lines ~514–1085)
// TODO(decompose): Extract to swServiceLifecycle.ts — startSWService, stopSWService, pollServiceUntilReady, installation detection (lines ~1087–1331)
// TODO(decompose): Extract to swThumbnails.ts — thumbnail/preview extraction via DM API and CFB/OLE fallback (lines ~1333–1527)
// TODO(decompose): Extract to swRegistry.ts — registry helpers for file locations, license operations, and version detection (lines ~1528–2143)

// SolidWorks handlers for Electron main process
import { app, ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import type * as fsTypes from 'fs'
import path from 'path'
import { spawn, ChildProcess, execSync } from 'child_process'
import * as CFB from 'cfb'

// Import error handling utilities from COM stability layer
import {
  SwErrorCode,
  parseServiceError,
  isRetryableError,
  getOperationTimeout,
  shouldRetry,
  calculateRetryDelay,
  formatErrorForLogging,
  createErrorNotification,
  DEFAULT_RETRY_CONFIG,
  type SwServiceResult,
  type SwParsedError,
} from './solidworksErrors'

// ============================================
// Configuration Constants
// ============================================

/** Maximum time to wait for service startup (ms) */
const SERVICE_STARTUP_TIMEOUT_MS = 10000

/** Interval between ping attempts during startup (ms) */
const SERVICE_STARTUP_POLL_INTERVAL_MS = 500

/** Maximum concurrent SW commands to prevent service overload */
const SW_MAX_CONCURRENT_COMMANDS = 3

/** Ping timeout for status checks (ms) - short to avoid blocking */
const STATUS_PING_TIMEOUT_MS = 2000

/** Ping cache TTL (ms) - avoid redundant status checks */
const PING_CACHE_TTL_MS = 1000

/**
 * Extended ping cache TTL (ms) used when the last status resolved to "busy".
 * Reusing a known-busy result for longer prevents pollers from re-probing a
 * service that is clearly occupied every single cycle.
 */
const BUSY_PING_CACHE_TTL_MS = 3000

/**
 * Maximum continuous in-flight window (ms) during which the status handler
 * synthesizes a "busy" result instead of issuing a real ping. An in-flight
 * command is itself proof of liveness, but this bound ensures a genuinely hung
 * (alive but unresponsive) SolidWorks is still eventually probed.
 */
const SYNTHESIZED_BUSY_MAX_MS = 30_000

// ============================================
// Module State
// ============================================

let mainWindow: BrowserWindow | null = null

// External log function references
let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error
let logWarn: (message: string, data?: unknown) => void = console.warn

// SolidWorks service state
let swServiceProcess: ChildProcess | null = null
let swServiceBuffer = ''
let swPendingRequests: Map<
  number,
  { resolve: (value: SWServiceResult) => void; reject: (error: Error) => void }
> = new Map()
let swRequestId = 0
let solidWorksInstalled: boolean | null = null

/**
 * Track the last known PID separately from the process reference.
 * This allows us to detect if the process is still alive even if
 * the Node.js ChildProcess reference was lost (e.g., due to IPC errors).
 */
let lastKnownServicePid: number | null = null

/**
 * Cache the service version separately from the ping cache.
 * This persists across ping timeouts so we don't show spurious
 * "version unknown" warnings when the service is busy.
 */
let cachedServiceVersion: string | null = null

// Thumbnail extraction tracking
const thumbnailsInProgress = new Set<string>()

// ============================================
// Request Queue State
// ============================================

/**
 * Queue priority. Higher runs first; ties keep FIFO order.
 *
 * Browsing a folder floods the queue with one getPreview per file. Behind a
 * concurrency of 3 that pushes interactive work (a status ping, the properties for
 * the file the user just selected) tens of slots back, and it times out.
 */
const PRIORITY_BULK = 0
const PRIORITY_INTERACTIVE = 1

/**
 * Actions that must not queue behind a folder's worth of preview extractions:
 * status probes, and anything triggered by a direct user action.
 * `ping` bypasses the queue entirely but is listed for the paths that do queue it.
 */
const INTERACTIVE_ACTIONS = new Set([
  'ping',
  'resetComConnection',
  'releaseHandles',
  'getSelectedFiles',
  'getOpenDocuments',
  'isDocumentOpen',
  'getDocumentInfo',
  'getProperties',
  'setProperties',
  'setPropertiesBatch',
  'setDocumentProperties',
  'getConfigurations',
  'getReferences',
])

function getCommandPriority(action: string): number {
  return INTERACTIVE_ACTIONS.has(action) ? PRIORITY_INTERACTIVE : PRIORITY_BULK
}

/** Queue of pending commands waiting to be sent */
interface QueuedCommand {
  command: Record<string, unknown>
  options?: { timeoutMs?: number }
  resolve: (value: SWServiceResult) => void
  queuedAt: number
  priority: number
}

const commandQueue: QueuedCommand[] = []
let activeCommandCount = 0

/**
 * Timestamp (ms) of when the current continuous in-flight burst began, i.e. when
 * activeCommandCount last transitioned from 0 to a positive value. Null while
 * idle. Used to bound the synthesized-busy window in the status handler so a
 * wedged operation cannot mask itself as "busy" forever.
 */
let inFlightSince: number | null = null

// ============================================
// Ping Cache State
// ============================================

interface PingCacheEntry {
  result: SWServiceResult
  timestamp: number
}

let pingCache: PingCacheEntry | null = null

/**
 * Single-flight guard for the status ping. Concurrent status pollers
 * (useIntegrationStatus ~5s, useSolidWorksStatus ~15s, the settings screen)
 * await the same in-flight ping instead of each issuing their own, collapsing
 * duplicate probes into one.
 */
let pendingStatusPing: Promise<SwServiceResult> | null = null

/**
 * True while a background pre-warm (hidden SolidWorks launch) is in progress.
 * During this window the service is single-threaded launching SolidWorks (~40s),
 * so pings will time out. We use this flag to report "busy" in status checks
 * without spamming ping timeouts / error logs while the launch completes.
 */
let swWarmupInProgress = false

// ============================================
// Orphaned Process Watchdog State
// ============================================

/** Interval for checking orphaned processes (ms) */
const ORPHAN_CHECK_INTERVAL_MS = 5000 // 5 seconds - tasklist is very lightweight

/** Timer for periodic orphan cleanup */
let orphanWatchdogTimer: ReturnType<typeof setInterval> | null = null

/**
 * Counter for active Document Manager operations (getBom, getReferences).
 * When > 0, the watchdog skips orphan cleanup because the DM API may have
 * spawned a SolidWorks process with __wgldummywindowfodder window title.
 *
 * After the DM operation completes, the counter decrements and orphaned
 * processes from previous runs will be cleaned up on the next watchdog cycle.
 */
let activeDmOperations = 0

/** Actions that use Document Manager API and may spawn background SW processes */
const DM_OPERATIONS = new Set(['getBom', 'getReferences'])

/**
 * Placeholder for future use - records when a SolidWorks file was opened.
 * Currently not used since we only kill definitive zombie processes.
 */
export function recordSolidWorksFileOpen(): void {
  // No-op for now - we only kill __wgldummywindowfodder which is always safe
}

/**
 * Find processes locking a file using the Windows Restart Manager API
 * (via the SolidWorks .NET service). Does NOT require SolidWorks to be running.
 *
 * Returns the first process name found, or null if no lock or service unavailable.
 * Exported for use by fs.ts lock detection as a replacement for handle.exe.
 */
export async function findLockingProcessViaService(filePath: string): Promise<string | null> {
  try {
    // sendSWCommand is defined later in this module but is hoisted as a function declaration
    const result = await sendSWCommand(
      { action: 'findLockingProcesses', filePath },
      { timeoutMs: 5000 },
    )
    if (result?.success && result.data?.count > 0 && result.data?.processes?.length > 0) {
      // Return the first process name (e.g., "SLDWORKS" or "excel")
      return result.data.processes[0].processName || result.data.processes[0].appName || 'Unknown'
    }
    return null
  } catch {
    // Service not running or error - return null (caller will fall through)
    return null
  }
}

// SWServiceResult is imported from solidworksErrors.ts

// ============================================
// Process Management Helpers
// ============================================

/**
 * Checks if a process exists at the OS level using signal 0.
 * This does not kill the process, just checks if it's alive.
 * @param pid - Process ID to check
 * @returns true if process exists, false otherwise
 */
function checkProcessExists(pid: number): boolean {
  try {
    // Signal 0 just checks if process exists without killing it
    process.kill(pid, 0)
    return true
  } catch {
    // Process doesn't exist or we don't have permission
    return false
  }
}

/**
 * Finds all running SLDWORKS.exe processes on the system.
 * Uses Windows tasklist command to enumerate processes.
 * @returns Array of process info objects with PID and name
 */
function findSolidWorksProcesses(): { pid: number; name: string; windowTitle: string }[] {
  if (process.platform !== 'win32') {
    return []
  }

  try {
    // Use tasklist with verbose output to get window titles
    // This helps distinguish between active SolidWorks with documents open vs orphaned
    const output = execSync('tasklist /V /FI "IMAGENAME eq SLDWORKS.exe" /FO CSV /NH', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })

    const processes: { pid: number; name: string; windowTitle: string }[] = []

    // Parse CSV output: "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
    const lines = output
      .trim()
      .split('\n')
      .filter((line) => line.includes('SLDWORKS.exe'))

    for (const line of lines) {
      try {
        // Parse CSV - handle quoted fields
        const fields = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)
        if (fields && fields.length >= 2) {
          const name = fields[0].replace(/"/g, '')
          const pid = parseInt(fields[1].replace(/"/g, ''), 10)
          // Window title is the last field
          const windowTitle = fields.length >= 9 ? fields[8].replace(/"/g, '') : 'N/A'

          if (!isNaN(pid)) {
            processes.push({ pid, name, windowTitle })
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return processes
  } catch (error) {
    // tasklist may fail if no matching processes (returns error)
    const errStr = String(error)
    if (!errStr.includes('No tasks are running')) {
      log('[SolidWorks] Error finding SLDWORKS processes: ' + errStr)
    }
    return []
  }
}

/**
 * Determines if a SolidWorks process is orphaned (zombie state).
 * Only kills processes with the OpenGL dummy window - this is the definitive zombie indicator.
 * Other states like "N/A" or empty are too risky as they can occur during normal loading.
 * @param proc - Process info from findSolidWorksProcesses
 * @returns true if the process is definitely a zombie
 */
function isOrphanedProcess(proc: { pid: number; name: string; windowTitle: string }): boolean {
  const title = proc.windowTitle.toLowerCase()
  // Only the OpenGL dummy window is a definite zombie indicator
  // Other states (N/A, empty, etc.) are too risky - can occur during normal loading
  return title === '__wgldummywindowfodder'
}

/**
 * Kills orphaned SLDWORKS.exe processes.
 * Only kills processes that appear to be orphaned (no window/document open).
 * @param forceAll - If true, kill ALL SLDWORKS processes regardless of state
 * @returns Object with counts of processes found and killed
 */
async function killOrphanedSolidWorksProcesses(forceAll: boolean = false): Promise<{
  found: number
  orphaned: number
  killed: number
  errors: string[]
}> {
  // Skip orphan cleanup while DM operations are in progress
  // The DM API may spawn a __wgldummywindowfodder process that we shouldn't kill
  // After DM operations complete, orphans from previous runs will be cleaned up next cycle
  if (!forceAll && activeDmOperations > 0) {
    log(
      `[SolidWorks Watchdog] Skipping orphan check - ${activeDmOperations} DM operation(s) in progress`,
    )
    return { found: 0, orphaned: 0, killed: 0, errors: [] }
  }

  log(`[SolidWorks] [SCAN] SCANNING FOR ${forceAll ? 'ALL' : 'ORPHANED'} SLDWORKS PROCESSES`)

  const processes = findSolidWorksProcesses()
  log(`[SolidWorks] Found ${processes.length} SLDWORKS.exe process(es)`)

  const result = {
    found: processes.length,
    orphaned: 0,
    killed: 0,
    errors: [] as string[],
  }

  if (processes.length === 0) {
    log('[SolidWorks] No SLDWORKS.exe processes found')
    return result
  }

  for (const proc of processes) {
    log(`[SolidWorks] Process: PID=${proc.pid}, Window="${proc.windowTitle}"`)

    const shouldKill = forceAll || isOrphanedProcess(proc)
    if (isOrphanedProcess(proc)) {
      result.orphaned++
    }

    if (shouldKill) {
      try {
        log(`[SolidWorks] Killing PID ${proc.pid}...`)
        execSync(`taskkill /PID ${proc.pid} /F`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        })
        result.killed++
        log(`[SolidWorks] [OK] Killed PID ${proc.pid}`)
      } catch (error) {
        const errMsg = `Failed to kill PID ${proc.pid}: ${String(error)}`
        logError(`[SolidWorks] [FAIL] ${errMsg}`)
        result.errors.push(errMsg)
      }
    } else {
      log(`[SolidWorks] Skipping PID ${proc.pid} (appears active with document open)`)
    }
  }

  log(
    `[SolidWorks] Cleanup complete: ${result.killed}/${result.orphaned} orphaned processes killed`,
  )
  return result
}

/**
 * Gets the current status of SLDWORKS.exe processes on the system.
 * @returns Object with process counts and details
 */
function getSolidWorksProcessStatus(): {
  total: number
  orphaned: number
  active: number
  processes: { pid: number; windowTitle: string; isOrphaned: boolean }[]
} {
  const processes = findSolidWorksProcesses()
  const result = {
    total: processes.length,
    orphaned: 0,
    active: 0,
    processes: processes.map((p) => ({
      pid: p.pid,
      windowTitle: p.windowTitle,
      isOrphaned: isOrphanedProcess(p),
    })),
  }

  for (const proc of result.processes) {
    if (proc.isOrphaned) {
      result.orphaned++
    } else {
      result.active++
    }
  }

  return result
}

// ============================================
// Orphaned Process Watchdog
// ============================================

/**
 * Starts the orphaned process watchdog.
 * Runs periodically while the SW service is active.
 */
function startOrphanWatchdog(): void {
  if (orphanWatchdogTimer) {
    log('[SolidWorks Watchdog] Already running')
    return
  }

  log(
    '[SolidWorks Watchdog] Starting orphaned process watchdog (interval: ' +
      ORPHAN_CHECK_INTERVAL_MS +
      'ms)',
  )

  // Run immediately once
  runOrphanCheck()

  // Then run periodically
  orphanWatchdogTimer = setInterval(() => {
    runOrphanCheck()
  }, ORPHAN_CHECK_INTERVAL_MS)
}

/**
 * Stops the orphaned process watchdog.
 */
function stopOrphanWatchdog(): void {
  if (orphanWatchdogTimer) {
    log('[SolidWorks Watchdog] Stopping orphaned process watchdog')
    clearInterval(orphanWatchdogTimer)
    orphanWatchdogTimer = null
  }
}

/**
 * Performs a single orphan check and cleanup.
 * Called periodically by the watchdog.
 * Only kills processes with __wgldummywindowfodder window - definitive zombie indicator.
 */
async function runOrphanCheck(): Promise<void> {
  try {
    const status = getSolidWorksProcessStatus()

    if (status.orphaned === 0) {
      // No orphans, nothing to do (don't log to avoid spam)
      return
    }

    log(`[SolidWorks Watchdog] Detected ${status.orphaned} orphaned SLDWORKS.exe process(es)`)

    // Kill orphaned processes
    const result = await killOrphanedSolidWorksProcesses(false)

    if (result.killed > 0) {
      log(`[SolidWorks Watchdog] [OK] Cleaned up ${result.killed} orphaned process(es)`)

      // Notify the renderer about the cleanup
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('solidworks:orphans-cleaned', {
          killed: result.killed,
          timestamp: Date.now(),
        })
      }
    }
  } catch (error) {
    logError(`[SolidWorks Watchdog] Error during orphan check: ${String(error)}`)
  }
}

/**
 * Logs a comprehensive service state summary for debugging.
 */
function logServiceState(context: string): void {
  const processAlive = lastKnownServicePid ? checkProcessExists(lastKnownServicePid) : false
  const hasProcess = swServiceProcess !== null
  const hasStdin = swServiceProcess?.stdin !== null

  log(`[SolidWorks State] ${context}`, {
    hasProcessRef: hasProcess,
    pid: lastKnownServicePid,
    processAlive,
    hasStdin,
    pendingRequests: swPendingRequests.size,
    queueDepth: commandQueue.length,
    activeCommands: activeCommandCount,
    pingCacheValid: pingCache ? Date.now() - pingCache.timestamp < PING_CACHE_TTL_MS : false,
  })
}

/**
 * Clears the SolidWorks service process state and rejects all pending requests.
 * Call this whenever the process exits, errors, or disconnects.
 * @param reason - The reason for clearing state (for logging and error messages)
 * @param force - If true, clear state even if process appears alive (use for confirmed exits)
 */
function clearServiceState(reason: string, force: boolean = false): void {
  // Log state before clearing
  logServiceState(`Before clearServiceState (reason: ${reason}, force: ${force})`)

  // Before clearing, verify the process is actually dead (unless forced)
  // This prevents clearing state when stdio errors occur but process is still alive
  if (!force && lastKnownServicePid) {
    const stillAlive = checkProcessExists(lastKnownServicePid)
    if (stillAlive) {
      log(
        `[SolidWorks] NOT clearing service state - process ${lastKnownServicePid} is still alive (reason was: ${reason})`,
      )
      // Don't clear the reference - the process is still running
      // Just log the issue for debugging
      return
    }
  }

  // Stop the orphaned process watchdog since service is no longer running
  stopOrphanWatchdog()

  logWarn(`[SolidWorks] [WARN] CLEARING SERVICE STATE: ${reason}`)
  log(`[SolidWorks] Pending requests to reject: ${swPendingRequests.size}`)
  log(`[SolidWorks] Queued commands to cancel: ${commandQueue.length}`)

  swServiceProcess = null
  swServiceBuffer = ''
  lastKnownServicePid = null
  cachedServiceVersion = null

  // Reject all pending requests with descriptive error
  for (const [id, req] of swPendingRequests) {
    log(`[SolidWorks] Rejecting pending request ${id}: ${reason}`)
    req.reject(new Error(reason))
  }
  swPendingRequests.clear()

  // Clear queued commands
  for (const queued of commandQueue) {
    log(`[SolidWorks] Canceling queued command: ${queued.command.action}`)
    queued.resolve({ success: false, error: reason })
  }
  commandQueue.length = 0
  activeCommandCount = 0
  inFlightSince = null

  // Invalidate ping cache
  pingCache = null

  log(`[SolidWorks] Service state cleared completely`)
}

// ============================================
// Request Queue Management
// ============================================

/**
 * Returns current queue statistics for debugging and status reporting.
 */
function getQueueStats(): { queueDepth: number; activeCommands: number } {
  return {
    queueDepth: commandQueue.length,
    activeCommands: activeCommandCount,
  }
}

function normalizeForCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function isUnder(normalizedFilePath: string, normalizedFolder: string): boolean {
  if (normalizedFolder === '') return true
  return (
    normalizedFilePath.startsWith(normalizedFolder + '/') || normalizedFilePath === normalizedFolder
  )
}

/**
 * Drop queued preview/thumbnail extractions whose path matches a predicate.
 *
 * Only affects commands still waiting in the queue. The up-to-3 already dispatched
 * to the service cannot be aborted, so callers should expect a residual tail of at
 * most SW_MAX_CONCURRENT_COMMANDS running to their per-operation timeout.
 */
function cancelQueuedPreviewsWhere(
  shouldCancel: (normalizedFilePath: string) => boolean,
  reason: string,
): number {
  let cancelledCount = 0

  for (let i = commandQueue.length - 1; i >= 0; i--) {
    const queued = commandQueue[i]
    const filePath = queued.command.filePath as string | undefined
    const action = queued.command.action as string | undefined

    if (!filePath || (action !== 'getPreview' && action !== 'getThumbnail')) continue

    if (shouldCancel(normalizeForCompare(filePath))) {
      commandQueue.splice(i, 1)
      queued.resolve({ success: false, error: `Cancelled: ${reason}` })
      cancelledCount++
    }
  }

  return cancelledCount
}

/**
 * Cancel queued preview/thumbnail extractions for files inside a folder.
 * Used before moving folders to prevent EPERM errors from open file handles.
 * Returns info about what was cancelled and what's still active.
 */
function cancelPreviewsForFolder(folderPath: string): {
  cancelledCount: number
  activeCount: number
  activePaths: string[]
} {
  const normalizedFolder = normalizeForCompare(folderPath)

  const cancelledCount = cancelQueuedPreviewsWhere(
    (normalizedFile) => isUnder(normalizedFile, normalizedFolder),
    'folder being moved',
  )

  // Check for active thumbnail extractions in this folder
  const activePaths: string[] = []
  for (const activePath of thumbnailsInProgress) {
    if (isUnder(normalizeForCompare(activePath), normalizedFolder)) {
      activePaths.push(activePath)
    }
  }

  if (cancelledCount > 0 || activePaths.length > 0) {
    log(
      `[SolidWorks] Cancelled ${cancelledCount} queued previews for folder move, ${activePaths.length} still active`,
    )
  }

  return { cancelledCount, activeCount: activePaths.length, activePaths }
}

/**
 * Cancel queued previews the user has navigated away from.
 *
 * Browsing a folder enqueues one getPreview per file against a concurrency-3 queue,
 * so moving on before it drains leaves tens of requests that nobody will look at
 * ahead of the ones that matter. `keepFolderPath` is the folder now on screen; its
 * requests are left in place.
 */
function cancelStalePreviews(keepFolderPath?: string): { cancelledCount: number } {
  const normalizedKeep = keepFolderPath ? normalizeForCompare(keepFolderPath) : null

  const cancelledCount = cancelQueuedPreviewsWhere(
    (normalizedFile) => normalizedKeep === null || !isUnder(normalizedFile, normalizedKeep),
    'navigated away',
  )

  if (cancelledCount > 0) {
    log(
      `[SolidWorks] Cancelled ${cancelledCount} stale queued previews on navigate (queue depth now ${commandQueue.length})`,
    )
  }

  return { cancelledCount }
}

/**
 * Processes the next command in the queue if capacity is available.
 * Called after each command completes or when new commands are queued.
 */
/**
 * Take the next command to run: highest priority first, FIFO within a priority.
 *
 * A linear scan is fine here; the queue is short enough that a heap would be
 * more machinery than the problem warrants.
 */
function dequeueNextCommand(): QueuedCommand | undefined {
  if (commandQueue.length === 0) return undefined

  let bestIndex = 0
  for (let i = 1; i < commandQueue.length; i++) {
    if (commandQueue[i].priority > commandQueue[bestIndex].priority) {
      bestIndex = i
    }
  }

  return commandQueue.splice(bestIndex, 1)[0]
}

function processQueue(): void {
  while (activeCommandCount < SW_MAX_CONCURRENT_COMMANDS && commandQueue.length > 0) {
    const queued = dequeueNextCommand()!
    const waitTime = Date.now() - queued.queuedAt
    const action = queued.command.action as string

    if (waitTime > 100) {
      log(
        `[SolidWorks Queue] ${action} waited ${waitTime}ms in queue (now active: ${activeCommandCount + 1}, remaining: ${commandQueue.length})`,
      )
    }

    // Mark the start of a continuous in-flight burst (0 -> 1 transition)
    if (activeCommandCount === 0) {
      inFlightSince = Date.now()
    }
    activeCommandCount++

    // Execute the command directly (bypassing queue since we're already processing)
    executeCommandDirect(queued.command, queued.options)
      .then((result) => {
        activeCommandCount--
        if (activeCommandCount === 0) {
          inFlightSince = null
        }
        queued.resolve(result)
        // Continue processing queue
        processQueue()
      })
      .catch((error) => {
        activeCommandCount--
        if (activeCommandCount === 0) {
          inFlightSince = null
        }
        logError(`[SolidWorks Queue] ${action} execution failed: ${error}`)
        queued.resolve({ success: false, error: 'Command execution failed' })
        processQueue()
      })
  }
}

/** Maximum retries for auto-retry logic on retryable errors */
const MAX_AUTO_RETRIES = 2

/**
 * Internal function that directly sends a command to the service.
 * Use sendSWCommand for queued execution.
 *
 * Includes:
 * - Operation-specific timeouts via getOperationTimeout()
 * - Error classification via parseServiceError()
 * - Auto-retry for retryable errors (max 2 retries)
 * - Error notifications to renderer
 */
async function executeCommandDirect(
  command: Record<string, unknown>,
  options?: { timeoutMs?: number },
  attemptNumber: number = 0,
): Promise<SwServiceResult> {
  const action = command.action as string
  const filePath = command.filePath as string | undefined

  if (!swServiceProcess?.stdin) {
    logError(`[SolidWorks Cmd] [FAIL] ${action} - service not running`, { filePath })
    return { success: false, error: 'SolidWorks service not running. Start it first.' }
  }

  // Use operation-specific timeout if not explicitly provided
  const timeoutMs = options?.timeoutMs ?? getOperationTimeout(action)
  const startTime = Date.now()
  const id = ++swRequestId

  // Log command being sent (skip verbose logging for polling operations)
  const isQuietOperation = action === 'ping' || action === 'getSelectedFiles'
  if (!isQuietOperation) {
    const retryInfo = attemptNumber > 0 ? ` [retry ${attemptNumber}/${MAX_AUTO_RETRIES}]` : ''
    log(`[SolidWorks Cmd] -> ${action} (id: ${id}, timeout: ${timeoutMs}ms)${retryInfo}`, {
      filePath: filePath ? path.basename(filePath) : undefined,
      pendingRequests: swPendingRequests.size + 1,
      activeCommands: activeCommandCount,
    })
  }

  const result = await new Promise<SwServiceResult>((resolve) => {
    const timeout = setTimeout(() => {
      swPendingRequests.delete(id)
      const elapsed = Date.now() - startTime
      logError(`[SolidWorks Cmd] [TIMEOUT] TIMEOUT: ${action} (id: ${id}) after ${elapsed}ms`, {
        filePath: filePath ? path.basename(filePath) : undefined,
        remainingPendingRequests: swPendingRequests.size,
      })
      resolve({ success: false, error: 'Command timed out', errorCode: 'TIMEOUT' })
    }, timeoutMs)

    swPendingRequests.set(id, {
      resolve: (rawResult) => {
        clearTimeout(timeout)
        const elapsed = Date.now() - startTime

        // Log command completion (skip verbose logging for fast polling operations)
        if (!isQuietOperation || elapsed > 500 || !rawResult.success) {
          const status = rawResult.success ? '[OK]' : '[FAIL]'
          log(`[SolidWorks Cmd] ${status} ${action} (id: ${id}) completed in ${elapsed}ms`, {
            success: rawResult.success,
            error: rawResult.error,
            errorCode: rawResult.errorCode,
            filePath: filePath ? path.basename(filePath) : undefined,
          })
        }

        resolve(rawResult)
      },
      reject: () => {
        clearTimeout(timeout)
        const elapsed = Date.now() - startTime
        logError(`[SolidWorks Cmd] [FAIL] ${action} (id: ${id}) REJECTED after ${elapsed}ms`, {
          filePath: filePath ? path.basename(filePath) : undefined,
        })
        resolve({ success: false, error: 'Request rejected' })
      },
    })

    // Include requestId in command for response correlation
    const commandWithId = { ...command, requestId: id }
    const json = JSON.stringify(commandWithId) + '\n'
    swServiceProcess!.stdin!.write(json)
  })

  // If command failed, parse the error and potentially retry
  if (!result.success) {
    const parsedError = parseServiceError(result)

    // Log structured error information
    if (action !== 'ping') {
      logError(
        formatErrorForLogging(parsedError, {
          operation: action,
          filePath: filePath || undefined,
          additionalInfo: `attempt ${attemptNumber + 1}/${MAX_AUTO_RETRIES + 1}`,
        }),
      )
    }

    // Check if we should auto-retry
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, maxRetries: MAX_AUTO_RETRIES }
    if (shouldRetry(parsedError, attemptNumber, retryConfig)) {
      const delay = calculateRetryDelay(attemptNumber, retryConfig)
      log(
        `[SolidWorks Cmd] [RETRY] ${action}: Retrying in ${delay}ms (attempt ${attemptNumber + 1}/${MAX_AUTO_RETRIES})`,
      )

      await new Promise((r) => setTimeout(r, delay))
      return executeCommandDirect(command, options, attemptNumber + 1)
    }

    // No more retries - send notification to renderer for user-facing errors
    if (mainWindow && !mainWindow.isDestroyed() && action !== 'ping') {
      const notification = createErrorNotification(parsedError)
      mainWindow.webContents.send('solidworks:error', {
        ...notification,
        operation: action,
        filePath: filePath || undefined,
        errorCode: parsedError.code,
      })
    }
  }

  return result
}

/**
 * Polls the service with ping commands until it responds or timeout is reached.
 * @param timeoutMs - Maximum time to wait (default: SERVICE_STARTUP_TIMEOUT_MS)
 * @param pollIntervalMs - Time between ping attempts (default: SERVICE_STARTUP_POLL_INTERVAL_MS)
 * @returns Promise resolving to ping result or timeout error
 */
async function pollServiceUntilReady(
  timeoutMs: number = SERVICE_STARTUP_TIMEOUT_MS,
  pollIntervalMs: number = SERVICE_STARTUP_POLL_INTERVAL_MS,
): Promise<SWServiceResult> {
  const startTime = Date.now()
  let attemptCount = 0

  log(
    `[SolidWorks] Starting service startup polling (timeout: ${timeoutMs}ms, interval: ${pollIntervalMs}ms)`,
  )

  while (Date.now() - startTime < timeoutMs) {
    attemptCount++

    // Check if process is still alive
    if (!swServiceProcess) {
      const elapsed = Date.now() - startTime
      log(
        `[SolidWorks] Service process died during startup after ${elapsed}ms (${attemptCount} attempts)`,
      )
      return {
        success: false,
        error: 'Service process terminated unexpectedly',
        errorDetails: `The SolidWorks service process exited during startup after ${attemptCount} ping attempts over ${elapsed}ms.`,
      }
    }

    try {
      // Quick ping with short timeout (slightly less than poll interval)
      const pingResult = await sendSWCommand({ action: 'ping' }, { timeoutMs: pollIntervalMs - 50 })

      if (pingResult.success) {
        const elapsed = Date.now() - startTime
        log(`[SolidWorks] Service ready after ${elapsed}ms (${attemptCount} ping attempts)`)
        return pingResult
      }

      logError(`[SolidWorks] Ping attempt ${attemptCount} failed, retrying...`)
    } catch (error) {
      logError(`[SolidWorks] Ping attempt ${attemptCount} threw error: ${String(error)}`)
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  // Timeout reached
  const elapsed = Date.now() - startTime
  log(`[SolidWorks] Service startup timed out after ${elapsed}ms (${attemptCount} attempts)`)

  return {
    success: false,
    error: 'Service startup timed out',
    errorDetails: `The SolidWorks service did not respond to ping within ${timeoutMs / 1000} seconds (${attemptCount} attempts). The service may have failed to initialize properly.`,
  }
}

// Detect if SolidWorks is installed
function isSolidWorksInstalled(): boolean {
  if (solidWorksInstalled !== null) {
    return solidWorksInstalled
  }

  if (process.platform !== 'win32') {
    solidWorksInstalled = false
    return false
  }

  try {
    const result = execSync('reg query "HKEY_CLASSES_ROOT\\SldWorks.Application" /ve', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    solidWorksInstalled = result.includes('SldWorks.Application')
    log('[SolidWorks] Installation detected: ' + solidWorksInstalled)
    return solidWorksInstalled
  } catch {
    const commonPaths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
      'C:\\Program Files\\SolidWorks Corp\\SolidWorks\\SLDWORKS.exe',
      'C:\\Program Files (x86)\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
    ]

    for (const swPath of commonPaths) {
      if (fs.existsSync(swPath)) {
        solidWorksInstalled = true
        log('[SolidWorks] Installation detected at: ' + swPath)
        return true
      }
    }

    solidWorksInstalled = false
    log('[SolidWorks] Not installed on this machine')
    return false
  }
}

// Get the path to the SolidWorks service executable
function getSWServicePath(): { path: string; isProduction: boolean } {
  const isPackaged = app.isPackaged

  const possiblePaths = [
    // Production: bundled with packaged app
    {
      path: path.join(process.resourcesPath || '', 'bin', 'BluePLM.SolidWorksService.exe'),
      isProduction: true,
    },
    // Development: csproj OutputPath ensures consistent bin\{Configuration}\ output
    {
      path: path.join(
        app.getAppPath(),
        'solidworks-service',
        'BluePLM.SolidWorksService',
        'bin',
        'Release',
        'BluePLM.SolidWorksService.exe',
      ),
      isProduction: false,
    },
    {
      path: path.join(
        app.getAppPath(),
        'solidworks-service',
        'BluePLM.SolidWorksService',
        'bin',
        'Debug',
        'BluePLM.SolidWorksService.exe',
      ),
      isProduction: false,
    },
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p.path)) {
      return p
    }
  }

  return isPackaged ? possiblePaths[0] : possiblePaths[1]
}

// Handle output from the service
function handleSWServiceOutput(data: string): void {
  swServiceBuffer += data

  const lines = swServiceBuffer.split('\n')
  swServiceBuffer = lines.pop() || ''

  // #region agent log - Buffer processing
  const fs = require('fs')
  const debugLogPath = 'c:\\Users\\emill\\Documents\\GitHub\\bluePLM\\.cursor\\debug.log'
  const writeDebugLog = (entry: Record<string, unknown>) => {
    try {
      fs.appendFileSync(debugLogPath, JSON.stringify(entry) + '\n')
    } catch {}
  }
  if (lines.length > 0) {
    writeDebugLog({
      location: 'solidworks.ts:BUFFER_RECV',
      message: 'Buffer processing',
      data: {
        lineCount: lines.length,
        bufferRemaining: swServiceBuffer.length,
        pendingRequestIds: Array.from(swPendingRequests.keys()),
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'BUFFER_PROCESSING',
    })
  }
  // #endregion

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const result = JSON.parse(line) as SWServiceResult & { requestId?: number }

      // Match response to request by requestId (if present) or fall back to FIFO
      const requestId = result.requestId
      if (requestId !== undefined && swPendingRequests.has(requestId)) {
        const handlers = swPendingRequests.get(requestId)!
        swPendingRequests.delete(requestId)
        // #region agent log - Direct match
        writeDebugLog({
          location: 'solidworks.ts:DIRECT_MATCH',
          message: 'Response matched by requestId',
          data: {
            requestId,
            success: result.success,
            hasData: !!result.data,
            dataKeys: result.data ? Object.keys(result.data) : [],
          },
          timestamp: Date.now(),
          sessionId: 'debug-session',
          hypothesisId: 'DIRECT_MATCH',
        })
        // #endregion
        handlers.resolve(result)
      } else {
        // #region agent log - FIFO fallback WARNING
        writeDebugLog({
          location: 'solidworks.ts:FIFO_FALLBACK',
          message: 'FIFO fallback triggered - no matching requestId',
          data: {
            responseRequestId: requestId,
            responseSuccess: result.success,
            responseError: result.error,
            pendingRequestIds: Array.from(swPendingRequests.keys()),
            responseDataKeys: result.data ? Object.keys(result.data) : [],
          },
          timestamp: Date.now(),
          sessionId: 'debug-session',
          hypothesisId: 'FIFO_FALLBACK',
        })
        // #endregion
        // Fallback to FIFO for backwards compatibility
        const entry = swPendingRequests.entries().next().value
        if (entry) {
          const [id, handlers] = entry
          // #region agent log - FIFO match details
          writeDebugLog({
            location: 'solidworks.ts:FIFO_MATCH',
            message: 'FIFO matched response to wrong request',
            data: {
              matchedToRequestId: id,
              responseRequestId: requestId,
              responseSuccess: result.success,
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            hypothesisId: 'FIFO_FALLBACK',
          })
          // #endregion
          swPendingRequests.delete(id)
          handlers.resolve(result)
        }
      }
    } catch (parseError) {
      log('[SolidWorks Service] Failed to parse output: ' + line)
      // #region agent log - Parse error
      writeDebugLog({
        location: 'solidworks.ts:PARSE_ERROR',
        message: 'Failed to parse JSON response',
        data: {
          lineLength: line.length,
          linePreview: line.substring(0, 200),
          error: String(parseError),
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        hypothesisId: 'BUFFER_CORRUPTION',
      })
      // #endregion
    }
  }
}

/**
 * Send a command to the SolidWorks service with queue management.
 * Commands are queued to prevent overwhelming the service.
 * @param command - Command object to send
 * @param options - Optional settings including timeout and queue bypass
 * @returns Promise resolving to command result
 */
async function sendSWCommand(
  command: Record<string, unknown>,
  options?: { timeoutMs?: number; bypassQueue?: boolean },
): Promise<SWServiceResult> {
  const action = command.action as string
  const isDmOperation = DM_OPERATIONS.has(action)

  if (!swServiceProcess?.stdin) {
    if (action !== 'ping') {
      logError(`[SolidWorks] Command ${action} failed - service not running`)
    }
    return { success: false, error: 'SolidWorks service not running. Start it first.' }
  }

  // Track DM operations to prevent watchdog from killing their spawned processes
  if (isDmOperation) {
    activeDmOperations++
    log(`[SolidWorks] DM operation ${action} started (active: ${activeDmOperations})`)
  }

  // Ping commands bypass queue for immediate status checks
  const bypassQueue = options?.bypassQueue || command.action === 'ping'

  if (bypassQueue) {
    try {
      return await executeCommandDirect(command, options)
    } finally {
      if (isDmOperation) {
        activeDmOperations--
        log(`[SolidWorks] DM operation ${action} completed (active: ${activeDmOperations})`)
      }
    }
  }

  // Queue the command and process
  return new Promise((resolve) => {
    const stats = getQueueStats()

    if (stats.queueDepth > 5) {
      log(
        `[SolidWorks Queue] Queuing ${action} - depth: ${stats.queueDepth + 1}, active: ${stats.activeCommands}`,
      )
    }

    if (stats.queueDepth > 15) {
      logWarn(
        `[SolidWorks Queue] [WARN] HIGH QUEUE DEPTH: ${stats.queueDepth + 1} pending commands!`,
      )
    }

    // Wrap resolve to decrement DM counter when command completes
    const wrappedResolve = (result: SWServiceResult) => {
      if (isDmOperation) {
        activeDmOperations--
        log(`[SolidWorks] DM operation ${action} completed (active: ${activeDmOperations})`)
      }
      resolve(result)
    }

    commandQueue.push({
      command,
      options,
      resolve: wrappedResolve,
      queuedAt: Date.now(),
      priority: getCommandPriority(action),
    })

    // Trigger queue processing
    processQueue()
  })
}

// ============================================
// Auto-start Config Cache (main-process early boot)
// ============================================

/**
 * Persisted config that lets the MAIN process start the SolidWorks service at
 * app-ready, in parallel with the (heavy, single-threaded) renderer vault load.
 * Without this, the renderer-driven auto-start can be starved for tens of seconds
 * during boot, delaying the service and freezing status on stale "not running".
 */
interface SwAutoStartConfig {
  autoStartEnabled: boolean
  integrationEnabled: boolean
  dmLicenseKey?: string
  verboseLogging?: boolean
}

function getAutoStartConfigPath(): string {
  return path.join(app.getPath('userData'), 'sw-autostart.json')
}

function readAutoStartConfig(): SwAutoStartConfig | null {
  try {
    const configPath = getAutoStartConfigPath()
    if (!fs.existsSync(configPath)) return null
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as SwAutoStartConfig
  } catch (error) {
    logWarn(`[SolidWorks] Failed to read auto-start config: ${error}`)
    return null
  }
}

/**
 * Merge a partial patch into the persisted auto-start config. Enabled flags come
 * exclusively from the renderer's explicit set-autostart-config call; the
 * start-service IPC only patches license/verbose so a manual "Start service"
 * while auto-start is off never flips the persisted enabled flags on.
 */
function updateAutoStartConfig(patch: Partial<SwAutoStartConfig>): void {
  try {
    const existing = readAutoStartConfig() ?? {
      autoStartEnabled: false,
      integrationEnabled: false,
    }
    const merged: SwAutoStartConfig = { ...existing, ...patch }
    fs.writeFileSync(getAutoStartConfigPath(), JSON.stringify(merged, null, 2), 'utf-8')
  } catch (error) {
    logWarn(`[SolidWorks] Failed to write auto-start config: ${error}`)
  }
}

/**
 * Start the SolidWorks service from the MAIN process using the cached config.
 * Fire-and-forget: called at app-ready (parallel to renderer boot) so the service
 * is ready in ~2s regardless of vault-load contention. No-op when no cache exists
 * (first-ever boot) or when auto-start/integration is disabled; startSWService is
 * idempotent, so the renderer's own auto-start becomes a cheap confirmation.
 */
export async function autoStartServiceFromCache(): Promise<void> {
  const config = readAutoStartConfig()
  if (!config) {
    log('[SolidWorks] No cached auto-start config - deferring to renderer auto-start')
    return
  }

  if (!config.autoStartEnabled || !config.integrationEnabled) {
    log('[SolidWorks] Cached config disables auto-start - skipping main-process early start')
    return
  }

  if (!isSolidWorksInstalled()) {
    log('[SolidWorks] SolidWorks not installed - skipping main-process early start (DM-only)')
    // Still start the service so the DM API is available immediately.
  }

  log('[SolidWorks] Main-process early start: launching service in parallel with renderer boot')
  try {
    const result = await startSWService(
      config.dmLicenseKey || undefined,
      false,
      config.verboseLogging,
    )
    if (result.success) {
      log('[SolidWorks] Main-process early start succeeded')
    } else {
      logWarn(
        `[SolidWorks] Main-process early start did not succeed: ${result.error ?? 'unknown error'}`,
      )
    }
  } catch (error) {
    logWarn(`[SolidWorks] Main-process early start error: ${error}`)
  }
}

/**
 * Start the SolidWorks service process.
 * Uses polling-based startup confirmation instead of fixed delay.
 * @param dmLicenseKey - Optional Document Manager license key
 * @param cleanupOrphans - If true, kill orphaned SLDWORKS.exe processes before starting
 * @param verboseLogging - If true, enable verbose diagnostic logging in the service
 * @returns Promise resolving to service start result
 */
async function startSWService(
  dmLicenseKey?: string,
  cleanupOrphans?: boolean,
  verboseLogging?: boolean,
): Promise<SWServiceResult> {
  const startTime = Date.now()
  log('[SolidWorks] [START] START SERVICE REQUESTED')
  logServiceState('startSWService called')

  // Optionally cleanup orphaned SLDWORKS.exe processes before starting
  if (cleanupOrphans) {
    log('[SolidWorks] Checking for orphaned SLDWORKS.exe processes...')
    const cleanupResult = await killOrphanedSolidWorksProcesses(false)
    if (cleanupResult.killed > 0) {
      log(`[SolidWorks] [OK] Cleaned up ${cleanupResult.killed} orphaned process(es)`)
    }
  }

  // Allow service to start without SolidWorks - Document Manager API can work independently
  // The service will report its capabilities (dmApiAvailable, swInstalled) via ping response
  const swInstalled = isSolidWorksInstalled()
  if (!swInstalled) {
    log('[SolidWorks] [WARN] SolidWorks not installed - starting in Document Manager-only mode')
  }

  if (swServiceProcess) {
    // First check if the process is still alive at the OS level
    const pid = swServiceProcess.pid
    const processAlive = pid && !swServiceProcess.killed && checkProcessExists(pid)

    log(
      `[SolidWorks] Existing process check: PID=${pid}, alive=${processAlive}, killed=${swServiceProcess.killed}`,
    )

    if (!processAlive) {
      // Process is truly dead - clean up state (force since we verified it's dead)
      log('[SolidWorks] [WARN] Existing process is dead, cleaning up stale state')
      clearServiceState('Process no longer exists', true)
    } else {
      // Process exists - verify it's responsive with a health ping (15 second timeout for busy service)
      log('[SolidWorks] Checking existing process health with ping...')
      const pingResult = await sendSWCommand({ action: 'ping' }, { timeoutMs: 15000 })

      if (!pingResult.success) {
        // Ping failed but process is alive - service may be busy, not stale
        log(
          '[SolidWorks] [WARN] Service process alive (PID: ' + pid + ') but not responding to ping',
        )
        log('[SolidWorks] Service may be busy processing commands - not killing')
        return {
          success: true,
          data: {
            message: 'Service running but busy, please wait',
            busy: true,
          },
        }
      } else {
        // Process is alive and responsive
        log('[SolidWorks] [OK] Service already running and healthy (PID: ' + pid + ')')
        if (dmLicenseKey) {
          log('[SolidWorks] Updating DM license key on running service...')
          const result = await sendSWCommand({ action: 'setDmLicense', licenseKey: dmLicenseKey })
          if (result.success) {
            log('[SolidWorks] [OK] License key updated successfully')
            return { success: true, data: { message: 'Service running, license key updated' } }
          }
        }
        return { success: true, data: { message: 'Service already running' } }
      }
    }
  }

  const serviceInfo = getSWServicePath()
  const servicePath = serviceInfo.path
  log('[SolidWorks] Service path: ' + servicePath)

  if (!fs.existsSync(servicePath)) {
    if (serviceInfo.isProduction) {
      return {
        success: false,
        error: 'SolidWorks service not bundled',
        errorDetails:
          'The SolidWorks service executable was not included in this build. Please reinstall the application.',
      }
    } else {
      return {
        success: false,
        error: 'SolidWorks service not built',
        errorDetails: `Expected at: ${servicePath}\n\nBuild it with: dotnet build solidworks-service/BluePLM.SolidWorksService -c Release`,
      }
    }
  }

  const args: string[] = []
  if (dmLicenseKey) {
    args.push('--dm-license', dmLicenseKey)
  }
  if (verboseLogging) {
    args.push('--verbose')
  }

  return new Promise((resolve) => {
    try {
      log('[SolidWorks] Spawning new service process...')
      log(`[SolidWorks] Executable: ${servicePath}`)
      log(`[SolidWorks] DM License: ${dmLicenseKey ? 'provided' : 'not provided'}`)

      swServiceProcess = spawn(servicePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      const pid = swServiceProcess.pid
      // Save PID separately so we can detect if process is alive even if reference is lost
      lastKnownServicePid = pid ?? null
      log(`[SolidWorks] [OK] Process spawned with PID: ${pid}`)

      swServiceProcess.stdout?.on('data', (data: Buffer) => {
        handleSWServiceOutput(data.toString())
      })

      swServiceProcess.stderr?.on('data', (data: Buffer) => {
        const stderr = data.toString().trim()
        if (stderr) {
          // Filter out verbose ping-related messages to reduce log spam
          // Pings happen every 5 seconds and generate 6-7 lines each
          const isPingMessage =
            stderr.includes('Ping received') ||
            stderr.includes('Received command: {"action":"ping"') ||
            stderr.includes('DM API instance:') ||
            stderr.includes('DM API IsAvailable:') ||
            stderr.includes('DM API InitError:') ||
            stderr.includes('SW API IsSolidWorksAvailable:') ||
            (stderr.includes('Sending response') && stderr.includes('chars)')) ||
            stderr.includes('Response sent, waiting for next command')

          if (!isPingMessage) {
            log('[SolidWorks Service stderr] ' + stderr)
          }
        }
      })

      swServiceProcess.on('error', (error) => {
        // Error event can fire for IPC issues without the process dying
        logError(`[SolidWorks] [FAIL] PROCESS ERROR EVENT: ${String(error)}`)
        logServiceState('After process error event')
        // Don't force clear - let clearServiceState verify process is dead
        clearServiceState(`Process error: ${String(error)}`, false)
      })

      swServiceProcess.on('close', (code, signal) => {
        // Close event means process actually exited - force clear state
        log(`[SolidWorks] [DEAD] PROCESS EXITED (code: ${code}, signal: ${signal})`)
        logServiceState('After process close event')
        clearServiceState(`Process exited (code: ${code}, signal: ${signal})`, true)
      })

      swServiceProcess.on('disconnect', () => {
        // Disconnect can happen due to stdio issues without process dying
        log('[SolidWorks] [WARN] PROCESS DISCONNECTED')
        logServiceState('After process disconnect event')
        // Don't force clear - let clearServiceState verify process is dead
        clearServiceState('Process disconnected', false)
      })

      // Use polling to wait for service readiness instead of fixed delay
      log('[SolidWorks] Waiting for service to become ready...')
      pollServiceUntilReady()
        .then((result) => {
          const totalTime = Date.now() - startTime
          if (result.success) {
            log(`[SolidWorks] [OK] SERVICE STARTED SUCCESSFULLY (${totalTime}ms, PID: ${pid})`)
            logServiceState('After successful startup')

            // Start the orphaned process watchdog
            startOrphanWatchdog()
          } else {
            logError(
              `[SolidWorks] [FAIL] SERVICE FAILED TO START: ${result.error} (${totalTime}ms)`,
            )
            logServiceState('After failed startup')
          }
          resolve(result)
        })
        .catch((error) => {
          const totalTime = Date.now() - startTime
          logError(`[SolidWorks] [FAIL] SERVICE STARTUP EXCEPTION: ${String(error)} (${totalTime}ms)`)
          logServiceState('After startup exception')
          resolve({
            success: false,
            error: 'Service startup failed',
            errorDetails: `An unexpected error occurred while starting the service: ${String(error)}`,
          })
        })
    } catch (error) {
      const errorMsg = String(error)
      log('[SolidWorks] [FAIL] Failed to spawn service process: ' + errorMsg)
      resolve({
        success: false,
        error: 'Failed to start service',
        errorDetails: `Could not spawn service process: ${errorMsg}`,
      })
    }
  })
}

// Stop the SolidWorks service
async function stopSWService(): Promise<void> {
  log('[SolidWorks] =======================================')
  log('[SolidWorks] 🛑 STOP SERVICE REQUESTED')
  log('[SolidWorks] =======================================')
  logServiceState('stopSWService called')

  // Stop the orphaned process watchdog
  stopOrphanWatchdog()

  if (!swServiceProcess) {
    log('[SolidWorks] No service process to stop')
    return
  }

  const pid = swServiceProcess.pid
  log(`[SolidWorks] Sending quit command to service (PID: ${pid})...`)

  try {
    await sendSWCommand({ action: 'quit' }, { timeoutMs: 5000 })
    log('[SolidWorks] [OK] Quit command sent successfully')
  } catch (error) {
    logWarn(`[SolidWorks] [WARN] Quit command failed: ${error}`)
  }

  log('[SolidWorks] Killing process...')
  swServiceProcess.kill()
  swServiceProcess = null
  log('[SolidWorks] [OK] Service stopped')
  logServiceState('After stopSWService')
}

// Extract SolidWorks thumbnail from file
// For SW 2020+ files, uses Document Manager API as primary method (CFB/OLE doesn't work for new format)
async function extractSolidWorksThumbnail(
  filePath: string,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const fileName = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()

  // Only attempt SW thumbnail extraction for SolidWorks files
  const swExtensions = ['.sldprt', '.sldasm', '.slddrw']
  if (!swExtensions.includes(ext)) {
    return { success: false, error: 'Not a SolidWorks file' }
  }

  thumbnailsInProgress.add(filePath)

  try {
    // Primary method: Use Document Manager API (works for SW 2020+ files)
    // The SW service should be auto-started on app launch
    if (swServiceProcess?.stdin) {
      try {
        const dmResult = await sendSWCommand(
          { action: 'getPreview', filePath },
          { timeoutMs: 10000 }, // 10 second timeout for thumbnails
        )

        if (dmResult.success && dmResult.data) {
          const previewData = dmResult.data as { imageData?: string; mimeType?: string }
          if (previewData.imageData) {
            const mimeType = previewData.mimeType || 'image/png'
            log(`[SWThumbnail] Got preview via DM API for ${fileName}`)
            return { success: true, data: `data:${mimeType};base64,${previewData.imageData}` }
          }
        }
      } catch (dmErr) {
        // DM API failed, fall through to CFB extraction
        log(`[SWThumbnail] DM API failed for ${fileName}, trying CFB: ${dmErr}`)
      }
    }

    // Fallback: Try CFB/OLE extraction (for older pre-2015 files)
    if (!(await isOleCompoundFile(filePath))) {
      log(`[SWThumbnail] ${fileName} is not an OLE compound file, skipping CFB read`)
      return { success: false, error: 'No thumbnail found' }
    }

    try {
      const fileBuffer = fs.readFileSync(filePath)
      const cfb = CFB.read(fileBuffer, { type: 'buffer' })

      // Look for preview streams
      for (const entry of cfb.FileIndex) {
        if (!entry || !entry.content || entry.content.length < 100) continue

        // Check for PNG signature
        const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const contentBuffer = Buffer.from(entry.content as number[] | Uint8Array)
        if (contentBuffer.slice(0, 8).equals(pngSignature)) {
          log(`[SWThumbnail] Found PNG in entry "${entry.name}"`)
          const base64 = Buffer.from(entry.content).toString('base64')
          return { success: true, data: `data:image/png;base64,${base64}` }
        }

        // Check for JPEG signature
        if (entry.content[0] === 0xff && entry.content[1] === 0xd8 && entry.content[2] === 0xff) {
          log(`[SWThumbnail] Found JPEG in entry "${entry.name}"`)
          const base64 = Buffer.from(entry.content).toString('base64')
          return { success: true, data: `data:image/jpeg;base64,${base64}` }
        }

        // Check for BMP
        if (entry.content[0] === 0x42 && entry.content[1] === 0x4d) {
          log(`[SWThumbnail] Found BMP in entry "${entry.name}"`)
          const base64 = Buffer.from(entry.content).toString('base64')
          return { success: true, data: `data:image/bmp;base64,${base64}` }
        }
      }
    } catch (cfbErr) {
      // CFB extraction also failed (expected for SW 2020+ files)
      // Don't log header signature errors as they're expected for new format files
      const errStr = String(cfbErr)
      if (!errStr.includes('Header Signature')) {
        logError(`[SWThumbnail] CFB extraction failed for ${fileName}: ${cfbErr}`)
      }
    }

    log(`[SWThumbnail] No thumbnail found in ${fileName}`)
    return { success: false, error: 'No thumbnail found' }
  } finally {
    thumbnailsInProgress.delete(filePath)
  }
}

/** OLE2 / Compound File Binary header signature. */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * Whether a file is an OLE compound document, i.e. whether CFB.read has any chance
 * of succeeding.
 *
 * SolidWorks 2015+ files use a different container, so CFB.read throws
 * "Header Signature" on them after the caller has already pulled the entire file
 * (often hundreds of MB) into memory. Reading eight bytes answers the same question.
 *
 * This also bounds the damage for cloud-backed files: an eight-byte read hydrates a
 * OneDrive/Dropbox placeholder far more cheaply than a whole-file read would. Files
 * that are cloud-only in the vault are excluded upstream by their `cloud` diffStatus.
 */
async function isOleCompoundFile(filePath: string): Promise<boolean> {
  let handle: fsTypes.promises.FileHandle | undefined
  try {
    handle = await fs.promises.open(filePath, 'r')
    const header = Buffer.alloc(OLE_MAGIC.length)
    const { bytesRead } = await handle.read(header, 0, OLE_MAGIC.length, 0)
    return bytesRead === OLE_MAGIC.length && header.equals(OLE_MAGIC)
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

// Extract high-quality preview from SolidWorks file
async function extractSolidWorksPreview(
  filePath: string,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const fileName = path.basename(filePath)
  log(`[SWPreview] Extracting preview from: ${fileName}`)

  if (!(await isOleCompoundFile(filePath))) {
    log(`[SWPreview] ${fileName} is not an OLE compound file, skipping CFB read`)
    return { success: false, error: 'No preview stream found in file' }
  }

  try {
    const fileBuffer = fs.readFileSync(filePath)
    const cfb = CFB.read(fileBuffer, { type: 'buffer' })

    const previewStreamNames = [
      'PreviewPNG',
      'Preview',
      'PreviewBitmap',
      '\\x05PreviewMetaFile',
      'Thumbnails/thumbnail.png',
      'PackageContents',
    ]

    // Try named streams first
    for (const streamName of previewStreamNames) {
      try {
        const entry = CFB.find(cfb, streamName)
        if (entry && entry.content && entry.content.length > 100) {
          log(`[SWPreview] Found stream "${streamName}" with ${entry.content.length} bytes`)

          // Check PNG
          const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          const contentBuf = Buffer.from(entry.content as number[] | Uint8Array)
          if (contentBuf.slice(0, 8).equals(pngSignature)) {
            log(`[SWPreview] Found PNG preview in "${streamName}"!`)
            const base64 = contentBuf.toString('base64')
            return { success: true, data: `data:image/png;base64,${base64}` }
          }

          // Check BMP
          if (contentBuf[0] === 0x42 && contentBuf[1] === 0x4d) {
            log(`[SWPreview] Found BMP preview in "${streamName}"!`)
            const base64 = contentBuf.toString('base64')
            return { success: true, data: `data:image/bmp;base64,${base64}` }
          }

          // Check DIB (convert to BMP)
          if (
            contentBuf[0] === 0x28 &&
            contentBuf[1] === 0x00 &&
            contentBuf[2] === 0x00 &&
            contentBuf[3] === 0x00
          ) {
            log(`[SWPreview] Found DIB preview in "${streamName}", converting to BMP...`)
            const dibData = contentBuf
            const headerSize = dibData.readInt32LE(0)
            const pixelOffset = 14 + headerSize
            const fileSize = 14 + dibData.length

            const bmpHeader = Buffer.alloc(14)
            bmpHeader.write('BM', 0)
            bmpHeader.writeInt32LE(fileSize, 2)
            bmpHeader.writeInt32LE(0, 6)
            bmpHeader.writeInt32LE(pixelOffset, 10)

            const bmpData = Buffer.concat([bmpHeader, Buffer.from(dibData)])
            const base64 = bmpData.toString('base64')
            return { success: true, data: `data:image/bmp;base64,${base64}` }
          }
        }
      } catch {
        // Stream doesn't exist
      }
    }

    // Try all entries
    for (const entry of cfb.FileIndex) {
      if (!entry || !entry.content || entry.content.length < 100) continue

      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      if (Buffer.from(entry.content.slice(0, 8)).equals(pngSignature)) {
        log(`[SWPreview] Found PNG in entry "${entry.name}"!`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/png;base64,${base64}` }
      }

      if (entry.content[0] === 0xff && entry.content[1] === 0xd8 && entry.content[2] === 0xff) {
        log(`[SWPreview] Found JPEG in entry "${entry.name}"!`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/jpeg;base64,${base64}` }
      }
    }

    log(`[SWPreview] No preview stream found in ${fileName}`)
    return { success: false, error: 'No preview stream found in file' }
  } catch (error) {
    logError(`[SWPreview] Failed to extract preview from ${fileName}: ${error}`)
    return { success: false, error: String(error) }
  }
}

// Export functions for use by fs handlers
export function isFileBeingThumbnailed(filePath: string): boolean {
  return thumbnailsInProgress.has(filePath)
}

export function getThumbnailsInProgress(): Set<string> {
  return thumbnailsInProgress
}

// ============================================
// SOLIDWORKS Registry Helpers (File Locations)
// ============================================

interface SolidWorksVersion {
  version: string
  year: number
  registryPath: string
}

interface FileLocationsResult {
  success: boolean
  versions?: SolidWorksVersion[]
  locations?: {
    version: string
    documentTemplates: string[]
    sheetFormats: string[]
    bomTemplates: string[]
    customPropertyFolders: string[]
    promptForTemplate: boolean
  }[]
  error?: string
}

/**
 * Get all installed SOLIDWORKS versions by scanning the registry.
 * Supports SOLIDWORKS 2020 and newer.
 *
 * Registry structure:
 * - HKEY_CURRENT_USER\Software\SolidWorks\SOLIDWORKS {year}\ExtReferences
 *   Contains template folder paths for that version.
 *
 * Some older versions may use different key names (e.g., "SolidWorks 2020" vs "SOLIDWORKS 2020"),
 * so we check for both patterns.
 */
function getInstalledSolidWorksVersions(): {
  success: boolean
  versions?: SolidWorksVersion[]
  error?: string
} {
  if (process.platform !== 'win32') {
    return { success: false, error: 'SOLIDWORKS is only available on Windows' }
  }

  try {
    // Query SolidWorks root to find installed versions
    const result = execSync('reg query "HKEY_CURRENT_USER\\Software\\SolidWorks"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const versions: SolidWorksVersion[] = []
    const lines = result.split('\n')

    for (const line of lines) {
      // Match patterns:
      // - SOLIDWORKS 2024 (newer versions, all caps)
      // - SolidWorks 2020 (some older versions, mixed case)
      // Both formats: HKEY_CURRENT_USER\Software\SolidWorks\{SOLIDWORKS|SolidWorks} {year}
      const match = line.match(
        /HKEY_CURRENT_USER\\Software\\SolidWorks\\((SOLIDWORKS|SolidWorks)\s+(\d{4}))/i,
      )
      if (match) {
        const fullVersion = match[1]
        const year = parseInt(match[3])

        // Only include versions 2020 and newer
        if (year >= 2020) {
          // ExtReferences contains the template folder paths
          versions.push({
            version: fullVersion,
            year: year,
            registryPath: `HKEY_CURRENT_USER\\Software\\SolidWorks\\${fullVersion}\\ExtReferences`,
          })
        }
      }
    }

    // Sort by year descending (newest first)
    versions.sort((a, b) => b.year - a.year)

    if (versions.length > 0) {
      log('[SolidWorks Registry] Found versions: ' + versions.map((v) => v.version).join(', '))
    } else {
      log('[SolidWorks Registry] No SOLIDWORKS 2020+ versions found')
    }
    return { success: true, versions }
  } catch (error) {
    log('[SolidWorks Registry] Failed to query versions: ' + String(error))
    return { success: true, versions: [] } // Not an error if no SW installed
  }
}

/**
 * Read a multi-string registry value (REG_MULTI_SZ or REG_SZ with semicolon-separated paths)
 */
function readRegistryValue(keyPath: string, valueName: string): string[] {
  try {
    const result = execSync(`reg query "${keyPath}" /v "${valueName}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Parse the output - format is: ValueName    REG_SZ    Value
    const lines = result.split('\n')
    for (const line of lines) {
      if (line.includes(valueName)) {
        // Extract the value after REG_SZ or REG_MULTI_SZ
        const match = line.match(/REG_(?:MULTI_)?SZ\s+(.+)$/i)
        if (match) {
          const value = match[1].trim()
          // SOLIDWORKS uses semicolon-separated paths
          return value
            .split(';')
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
        }
      }
    }
    return []
  } catch {
    return [] // Value doesn't exist
  }
}

/**
 * Write a registry value (REG_SZ with semicolon-separated paths)
 */
function writeRegistryValue(keyPath: string, valueName: string, paths: string[]): boolean {
  try {
    const value = paths.join(';')
    execSync(`reg add "${keyPath}" /v "${valueName}" /t REG_SZ /d "${value}" /f`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch (error) {
    logError(`[SolidWorks Registry] Failed to write ${valueName}: ${String(error)}`)
    return false
  }
}

/**
 * Read a DWORD registry value
 */
function readRegistryDword(keyPath: string, valueName: string): number | null {
  try {
    const result = execSync(`reg query "${keyPath}" /v "${valueName}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Parse the output - format is: ValueName    REG_DWORD    0x1
    const lines = result.split('\n')
    for (const line of lines) {
      if (line.includes(valueName)) {
        const match = line.match(/REG_DWORD\s+0x([0-9a-fA-F]+)/i)
        if (match) {
          return parseInt(match[1], 16)
        }
      }
    }
    return null
  } catch {
    return null // Value doesn't exist
  }
}

/**
 * Write a DWORD registry value
 */
function writeRegistryDword(keyPath: string, valueName: string, value: number): boolean {
  try {
    execSync(`reg add "${keyPath}" /v "${valueName}" /t REG_DWORD /d ${value} /f`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch (error) {
    logError(`[SolidWorks Registry] Failed to write DWORD ${valueName}: ${String(error)}`)
    return false
  }
}

/**
 * Check if a registry key exists.
 */
function registryKeyExists(keyPath: string): boolean {
  try {
    execSync(`reg query "${keyPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

/**
 * Get the Document Templates registry path for a given version.
 * This is separate from ExtReferences and contains the "Use Default Document Templates" setting.
 */
function getDocumentTemplatesRegistryPath(version: string): string {
  return `HKEY_CURRENT_USER\\Software\\SolidWorks\\${version}\\Document Templates`
}

/**
 * Get current SOLIDWORKS file locations from registry for all installed versions.
 * Template paths are stored in ExtReferences with these value names:
 * - Document Template Folders
 * - Sheet Format Folders
 * - BOM Template Folders
 * - Custom Property Folders
 *
 * The "Prompt for template" setting is stored in Document Templates:
 * - Use Default Document Templates (0 = prompt, 1 = use default)
 */
function getSolidWorksFileLocations(): FileLocationsResult {
  const versionsResult = getInstalledSolidWorksVersions()
  if (!versionsResult.success || !versionsResult.versions) {
    return versionsResult as FileLocationsResult
  }

  const locations = versionsResult.versions
    .filter((v) => registryKeyExists(v.registryPath)) // Only include versions with ExtReferences
    .map((v) => {
      const docTemplates = readRegistryValue(v.registryPath, 'Document Template Folders')
      const sheetFormats = readRegistryValue(v.registryPath, 'Sheet Format Folders')
      const bomTemplates = readRegistryValue(v.registryPath, 'BOM Template Folders')
      const customProps = readRegistryValue(v.registryPath, 'Custom Property Folders')

      // Read the "Use Default Document Templates" setting
      // Value 0 = prompt user, Value 1 = use default (don't prompt)
      const docTemplatesPath = getDocumentTemplatesRegistryPath(v.version)
      const useDefaultValue = readRegistryDword(docTemplatesPath, 'Use Default Document Templates')
      const promptForTemplate = useDefaultValue === 0 // 0 means prompt, 1 means use default

      return {
        version: v.version,
        documentTemplates: docTemplates,
        sheetFormats: sheetFormats,
        bomTemplates: bomTemplates,
        customPropertyFolders: customProps,
        promptForTemplate: promptForTemplate,
      }
    })

  log('[SolidWorks Registry] Read file locations for ' + locations.length + ' versions')
  return { success: true, versions: versionsResult.versions, locations }
}

/**
 * Set SOLIDWORKS file locations in registry for all installed versions (2020+).
 * Paths should be full absolute paths (vault root + relative path already resolved).
 * Uses ExtReferences registry keys with these value names:
 * - Document Template Folders
 * - Sheet Format Folders
 * - BOM Template Folders
 * - Custom Property Folders
 *
 * Also sets the "Prompt for template" option in Document Templates:
 * - Use Default Document Templates (0 = prompt, 1 = use default)
 *
 * The new path is prepended to existing paths so it takes priority.
 */
function setSolidWorksFileLocations(settings: {
  documentTemplates?: string
  sheetFormats?: string
  bomTemplates?: string
  customPropertyFolders?: string
  promptForTemplate?: boolean
}): { success: boolean; updatedVersions?: string[]; error?: string } {
  const versionsResult = getInstalledSolidWorksVersions()
  if (!versionsResult.success || !versionsResult.versions) {
    return { success: false, error: versionsResult.error || 'Failed to get SOLIDWORKS versions' }
  }

  if (versionsResult.versions.length === 0) {
    return { success: false, error: 'No SOLIDWORKS 2020+ installations found' }
  }

  const updatedVersions: string[] = []
  const skippedVersions: string[] = []
  const errors: string[] = []

  for (const v of versionsResult.versions) {
    // Skip versions without ExtReferences key (shouldn't happen but be safe)
    if (!registryKeyExists(v.registryPath)) {
      skippedVersions.push(v.version)
      continue
    }

    let versionUpdated = false

    if (settings.documentTemplates !== undefined) {
      // Get existing paths and prepend new path (SOLIDWORKS uses first match)
      const existing = readRegistryValue(v.registryPath, 'Document Template Folders')
      const newPaths = [
        settings.documentTemplates,
        ...existing.filter((p) => p !== settings.documentTemplates),
      ]
      if (writeRegistryValue(v.registryPath, 'Document Template Folders', newPaths)) {
        versionUpdated = true
      } else {
        errors.push(`Failed to set Document Template Folders for ${v.version}`)
      }
    }

    if (settings.sheetFormats !== undefined) {
      const existing = readRegistryValue(v.registryPath, 'Sheet Format Folders')
      const newPaths = [
        settings.sheetFormats,
        ...existing.filter((p) => p !== settings.sheetFormats),
      ]
      if (writeRegistryValue(v.registryPath, 'Sheet Format Folders', newPaths)) {
        versionUpdated = true
      } else {
        errors.push(`Failed to set Sheet Format Folders for ${v.version}`)
      }
    }

    if (settings.bomTemplates !== undefined) {
      const existing = readRegistryValue(v.registryPath, 'BOM Template Folders')
      const newPaths = [
        settings.bomTemplates,
        ...existing.filter((p) => p !== settings.bomTemplates),
      ]
      if (writeRegistryValue(v.registryPath, 'BOM Template Folders', newPaths)) {
        versionUpdated = true
      } else {
        errors.push(`Failed to set BOM Template Folders for ${v.version}`)
      }
    }

    if (settings.customPropertyFolders !== undefined) {
      const existing = readRegistryValue(v.registryPath, 'Custom Property Folders')
      const newPaths = [
        settings.customPropertyFolders,
        ...existing.filter((p) => p !== settings.customPropertyFolders),
      ]
      if (writeRegistryValue(v.registryPath, 'Custom Property Folders', newPaths)) {
        versionUpdated = true
      } else {
        errors.push(`Failed to set Custom Property Folders for ${v.version}`)
      }
    }

    // Set the "Prompt user to select document template" option
    // Registry value: Use Default Document Templates
    // 0 = prompt user (what we want when promptForTemplate is true)
    // 1 = use default templates (don't prompt)
    if (settings.promptForTemplate !== undefined) {
      const docTemplatesPath = getDocumentTemplatesRegistryPath(v.version)
      const value = settings.promptForTemplate ? 0 : 1 // Invert: prompt=true means value=0
      if (writeRegistryDword(docTemplatesPath, 'Use Default Document Templates', value)) {
        versionUpdated = true
        log(
          `[SolidWorks Registry] Set promptForTemplate=${settings.promptForTemplate} for ${v.version}`,
        )
      } else {
        errors.push(`Failed to set Use Default Document Templates for ${v.version}`)
      }
    }

    if (versionUpdated) {
      updatedVersions.push(v.version)
    }
  }

  if (skippedVersions.length > 0) {
    log(
      '[SolidWorks Registry] Skipped versions without ExtReferences: ' + skippedVersions.join(', '),
    )
  }

  if (updatedVersions.length > 0) {
    log('[SolidWorks Registry] Updated file locations for: ' + updatedVersions.join(', '))
    return {
      success: true,
      updatedVersions,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }
  } else {
    return { success: false, error: errors.join('; ') || 'No versions updated' }
  }
}

// ============================================
// SOLIDWORKS License Registry Operations
// ============================================

/**
 * Registry path for SOLIDWORKS license serial numbers.
 * Writing to HKLM requires administrator privileges.
 */
const SW_LICENSE_REGISTRY_PATH =
  'HKEY_LOCAL_MACHINE\\Software\\SolidWorks\\Licenses\\Serial Numbers'

interface LicenseRegistryResult {
  success: boolean
  serialNumbers?: string[]
  error?: string
}

interface LicenseWriteResult {
  success: boolean
  error?: string
  requiresAdmin?: boolean
}

interface LicenseCheckResult {
  success: boolean
  found: boolean
  error?: string
}

/**
 * Get all SOLIDWORKS serial numbers from the registry.
 * Reads from HKLM\Software\SolidWorks\Licenses\Serial Numbers
 *
 * Serial numbers are stored as value names under this key.
 */
function getSolidWorksLicenseFromRegistry(): LicenseRegistryResult {
  if (process.platform !== 'win32') {
    return { success: false, error: 'SOLIDWORKS license registry is only available on Windows' }
  }

  try {
    // Query all values under the Serial Numbers key
    const result = execSync(`reg query "${SW_LICENSE_REGISTRY_PATH}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const serialNumbers: string[] = []
    const lines = result.split('\n')

    for (const line of lines) {
      // Skip empty lines and the key path line
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('HKEY_')) continue

      // Value format: "SerialNumber    REG_SZ    (some value or empty)"
      // We want the value name (serial number), not the data
      const match = trimmed.match(/^(\S+)\s+REG_/)
      if (match) {
        const valueName = match[1]
        // Filter out default value and other non-serial entries
        if (valueName && valueName !== '(Default)') {
          serialNumbers.push(valueName)
        }
      }
    }

    log(`[SolidWorks License] Found ${serialNumbers.length} serial number(s) in registry`)
    return { success: true, serialNumbers }
  } catch (error) {
    const errorStr = String(error)
    // "The system was unable to find the specified registry key" - key doesn't exist
    if (errorStr.includes('unable to find') || errorStr.includes('cannot find')) {
      log('[SolidWorks License] Registry key does not exist (no licenses installed)')
      return { success: true, serialNumbers: [] }
    }
    logError(`[SolidWorks License] Failed to read registry: ${errorStr}`)
    return { success: false, error: errorStr }
  }
}

/**
 * Write a SOLIDWORKS serial number to the registry.
 * Creates a value with the serial number as the name under:
 * HKLM\Software\SolidWorks\Licenses\Serial Numbers
 *
 * Requires administrator privileges. Returns requiresAdmin: true if elevation needed.
 */
function setSolidWorksLicenseInRegistry(serialNumber: string): LicenseWriteResult {
  if (process.platform !== 'win32') {
    return { success: false, error: 'SOLIDWORKS license registry is only available on Windows' }
  }

  if (!serialNumber || serialNumber.trim().length === 0) {
    return { success: false, error: 'Serial number cannot be empty' }
  }

  const cleanSerial = serialNumber.trim().toUpperCase()

  try {
    // First, ensure the key exists by creating it (won't error if exists)
    execSync(`reg add "${SW_LICENSE_REGISTRY_PATH}" /f`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Add the serial number as a value name with empty string data
    execSync(`reg add "${SW_LICENSE_REGISTRY_PATH}" /v "${cleanSerial}" /t REG_SZ /d "" /f`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    log(
      `[SolidWorks License] Successfully added serial number to registry: ${cleanSerial.slice(-4).padStart(cleanSerial.length, '*')}`,
    )
    return { success: true }
  } catch (error) {
    const errorStr = String(error)
    // Check for access denied errors
    if (
      errorStr.includes('Access is denied') ||
      errorStr.includes('requires elevation') ||
      errorStr.includes('administrator')
    ) {
      log('[SolidWorks License] Admin privileges required to write license registry')
      return {
        success: false,
        error: 'Administrator privileges required to modify SOLIDWORKS license registry',
        requiresAdmin: true,
      }
    }
    logError(`[SolidWorks License] Failed to write registry: ${errorStr}`)
    return { success: false, error: errorStr }
  }
}

/**
 * Remove a SOLIDWORKS serial number from the registry.
 * Deletes the value with the given serial number name from:
 * HKLM\Software\SolidWorks\Licenses\Serial Numbers
 *
 * Requires administrator privileges. Returns requiresAdmin: true if elevation needed.
 */
function removeSolidWorksLicenseFromRegistry(serialNumber: string): LicenseWriteResult {
  if (process.platform !== 'win32') {
    return { success: false, error: 'SOLIDWORKS license registry is only available on Windows' }
  }

  if (!serialNumber || serialNumber.trim().length === 0) {
    return { success: false, error: 'Serial number cannot be empty' }
  }

  const cleanSerial = serialNumber.trim().toUpperCase()

  try {
    execSync(`reg delete "${SW_LICENSE_REGISTRY_PATH}" /v "${cleanSerial}" /f`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    log(
      `[SolidWorks License] Successfully removed serial number from registry: ${cleanSerial.slice(-4).padStart(cleanSerial.length, '*')}`,
    )
    return { success: true }
  } catch (error) {
    const errorStr = String(error)
    // Check for access denied errors
    if (
      errorStr.includes('Access is denied') ||
      errorStr.includes('requires elevation') ||
      errorStr.includes('administrator')
    ) {
      log('[SolidWorks License] Admin privileges required to remove license from registry')
      return {
        success: false,
        error: 'Administrator privileges required to modify SOLIDWORKS license registry',
        requiresAdmin: true,
      }
    }
    // Check if value doesn't exist
    if (errorStr.includes('unable to find') || errorStr.includes('cannot find')) {
      log(
        `[SolidWorks License] Serial number not found in registry: ${cleanSerial.slice(-4).padStart(cleanSerial.length, '*')}`,
      )
      return { success: true } // Treat as success - it's already gone
    }
    logError(`[SolidWorks License] Failed to remove from registry: ${errorStr}`)
    return { success: false, error: errorStr }
  }
}

/**
 * Check if a specific SOLIDWORKS serial number exists in the registry.
 */
function checkLicenseInRegistry(serialNumber: string): LicenseCheckResult {
  if (process.platform !== 'win32') {
    return {
      success: false,
      found: false,
      error: 'SOLIDWORKS license registry is only available on Windows',
    }
  }

  if (!serialNumber || serialNumber.trim().length === 0) {
    return { success: false, found: false, error: 'Serial number cannot be empty' }
  }

  const cleanSerial = serialNumber.trim().toUpperCase()

  try {
    execSync(`reg query "${SW_LICENSE_REGISTRY_PATH}" /v "${cleanSerial}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    log(
      `[SolidWorks License] Serial number found in registry: ${cleanSerial.slice(-4).padStart(cleanSerial.length, '*')}`,
    )
    return { success: true, found: true }
  } catch (error) {
    const errorStr = String(error)
    // Value not found is expected when serial doesn't exist
    if (errorStr.includes('unable to find') || errorStr.includes('cannot find')) {
      log(
        `[SolidWorks License] Serial number not found in registry: ${cleanSerial.slice(-4).padStart(cleanSerial.length, '*')}`,
      )
      return { success: true, found: false }
    }
    logError(`[SolidWorks License] Failed to check registry: ${errorStr}`)
    return { success: false, found: false, error: errorStr }
  }
}

export interface SolidWorksHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
  logWarn: (message: string, data?: unknown) => void
}

export function registerSolidWorksHandlers(
  window: BrowserWindow,
  deps: SolidWorksHandlerDependencies,
): void {
  mainWindow = window
  log = deps.log
  logError = deps.logError
  logWarn = deps.logWarn

  // Thumbnail extraction
  ipcMain.handle('solidworks:extract-thumbnail', async (_, filePath: string) => {
    return extractSolidWorksThumbnail(filePath)
  })

  // Preview extraction
  ipcMain.handle('solidworks:extract-preview', async (_, filePath: string) => {
    return extractSolidWorksPreview(filePath)
  })

  // Service management
  ipcMain.handle(
    'solidworks:start-service',
    async (_, dmLicenseKey?: string, cleanupOrphans?: boolean, verboseLogging?: boolean) => {
      log(
        `[SolidWorks] IPC: start-service received (cleanupOrphans: ${cleanupOrphans}, verboseLogging: ${verboseLogging})`,
      )
      // Persist license/verbose so the main process can pre-start on the next boot.
      // Enabled flags are owned by set-autostart-config, so only patch known fields.
      const patch: Partial<SwAutoStartConfig> = {}
      if (dmLicenseKey !== undefined) patch.dmLicenseKey = dmLicenseKey
      if (verboseLogging !== undefined) patch.verboseLogging = verboseLogging
      if (Object.keys(patch).length > 0) updateAutoStartConfig(patch)
      return startSWService(dmLicenseKey, cleanupOrphans, verboseLogging)
    },
  )

  // Persist the renderer's auto-start policy so the main process can decide whether
  // to launch the service at app-ready (before the renderer is even responsive).
  ipcMain.handle(
    'solidworks:set-autostart-config',
    async (
      _,
      config: {
        autoStartEnabled: boolean
        integrationEnabled: boolean
        dmLicenseKey?: string
        verboseLogging?: boolean
      },
    ) => {
      const patch: Partial<SwAutoStartConfig> = {
        autoStartEnabled: config.autoStartEnabled,
        integrationEnabled: config.integrationEnabled,
      }
      if (config.dmLicenseKey !== undefined) patch.dmLicenseKey = config.dmLicenseKey
      if (config.verboseLogging !== undefined) patch.verboseLogging = config.verboseLogging
      updateAutoStartConfig(patch)
      return { success: true }
    },
  )

  ipcMain.handle('solidworks:stop-service', async () => {
    await stopSWService()
    return { success: true }
  })

  ipcMain.handle('solidworks:reset-com-connection', async () => {
    log('[SolidWorks] Reset COM connection requested (soft reconnect)')
    return sendSWCommand({ action: 'resetComConnection' }, { timeoutMs: 5000 })
  })

  ipcMain.handle('solidworks:force-restart', async (_, dmLicenseKey?: string) => {
    log('[SolidWorks] =======================================')
    log('[SolidWorks] [RESTART] FORCE RESTART REQUESTED')
    log('[SolidWorks] =======================================')
    logServiceState('Before force restart')

    // Kill existing process if any
    if (swServiceProcess) {
      const pid = swServiceProcess.pid
      log(`[SolidWorks] Force killing process (PID: ${pid})...`)
      try {
        swServiceProcess.kill('SIGKILL')
        log('[SolidWorks] [OK] SIGKILL sent')
      } catch (error) {
        logWarn(`[SolidWorks] [WARN] Kill failed: ${error}`)
      }
      swServiceProcess = null
    } else {
      log('[SolidWorks] No existing process to kill')
    }

    // Reject all pending requests
    const pendingCount = swPendingRequests.size
    log(`[SolidWorks] Rejecting ${pendingCount} pending requests...`)
    for (const [id, req] of swPendingRequests) {
      log(`[SolidWorks] Rejecting request ${id}`)
      req.reject(new Error('Service force-restarted'))
    }
    swPendingRequests.clear()

    log('[SolidWorks] Starting fresh service...')
    return startSWService(dmLicenseKey)
  })

  ipcMain.handle('solidworks:service-status', async () => {
    const swInstalled = isSolidWorksInstalled()
    const queueStats = getQueueStats()

    // Helper to determine operational mode
    const getMode = (dmAvailable: boolean, swApiAvailable: boolean): string => {
      if (dmAvailable && swApiAvailable) return 'full'
      if (dmAvailable) return 'dm-only'
      return 'limited'
    }

    // If we don't have a process reference, check if we have a saved PID
    // This handles the case where the reference was lost but process is still running
    if (!swServiceProcess) {
      if (lastKnownServicePid && checkProcessExists(lastKnownServicePid)) {
        log(
          `[SolidWorks] Status: No process reference but PID ${lastKnownServicePid} is alive - service is running but reference lost`,
        )
        // Process is alive but we lost the reference (likely due to IPC errors)
        // Report as running but busy (we can't communicate with it reliably)
        return {
          success: true,
          data: {
            running: true,
            busy: true,
            installed: swInstalled,
            referenceRecoveryNeeded: true,
            message: 'Service running but IPC connection lost - restart recommended',
            ...queueStats,
          },
        }
      }
      return { success: true, data: { running: false, installed: swInstalled, ...queueStats } }
    }

    // First check if process is alive at OS level
    const pid = swServiceProcess.pid
    const processAlive = pid ? checkProcessExists(pid) : false

    if (!processAlive) {
      log('[SolidWorks] Status check: process not alive at OS level, cleaning up')
      clearServiceState('Process no longer exists (detected during status check)', true)
      return { success: true, data: { running: false, installed: swInstalled, ...queueStats } }
    }

    // While a background pre-warm is launching SolidWorks, the service can't answer
    // pings (~40s). Report "busy" immediately instead of firing pings that will time
    // out and spam error logs. Reuse the last known capabilities from the ping cache.
    if (swWarmupInProgress) {
      const cachedData = pingCache?.result.data as Record<string, unknown> | undefined
      const dmAvailable = (cachedData?.documentManagerAvailable as boolean) ?? false
      const swApiAvailable = ((cachedData?.swInstalled as boolean) ?? false) && swInstalled
      return {
        success: true,
        data: {
          running: false,
          busy: true,
          warmingUp: true,
          installed: swInstalled,
          version: cachedData?.version || cachedServiceVersion,
          swInstalled: cachedData?.swInstalled,
          swApiAvailable,
          documentManagerAvailable: cachedData?.documentManagerAvailable,
          documentManagerError: cachedData?.documentManagerError,
          fastModeEnabled: cachedData?.fastModeEnabled,
          mode: getMode(dmAvailable, swApiAvailable),
          ...queueStats,
        },
      }
    }

    // Check ping cache to avoid redundant checks
    const now = Date.now()

    // Suppress the ping while a real command is in flight. The C# service reads
    // commands on a single thread, so it cannot answer a ping until the in-flight
    // operation returns anyway - and the in-flight command is itself proof of
    // liveness. Synthesize a "busy" status from the cached capabilities instead.
    // Bounded by SYNTHESIZED_BUSY_MAX_MS so a genuinely hung op is still probed.
    const commandInFlight = activeCommandCount > 0 || commandQueue.length > 0
    const withinBusyWindow =
      inFlightSince !== null && now - inFlightSince < SYNTHESIZED_BUSY_MAX_MS
    if (commandInFlight && withinBusyWindow) {
      const cachedData = pingCache?.result.data as Record<string, unknown> | undefined
      const dmAvailable = (cachedData?.documentManagerAvailable as boolean) ?? false
      const swApiAvailable = ((cachedData?.swInstalled as boolean) ?? false) && swInstalled
      return {
        success: true,
        data: {
          running: true,
          busy: true,
          installed: swInstalled,
          // Indicate the ping was deliberately skipped (in-flight op proves liveness)
          pingSkipped: true,
          version: cachedData?.version || cachedServiceVersion,
          swInstalled: cachedData?.swInstalled,
          swApiAvailable,
          documentManagerAvailable: cachedData?.documentManagerAvailable,
          documentManagerError: cachedData?.documentManagerError,
          fastModeEnabled: cachedData?.fastModeEnabled,
          mode: getMode(dmAvailable, swApiAvailable),
          ...queueStats,
        },
      }
    }

    // Check ping cache to avoid redundant checks. A known-busy result is reused
    // for longer (BUSY_PING_CACHE_TTL_MS) so pollers don't re-probe every cycle.
    const cacheTtl =
      pingCache && !pingCache.result.success ? BUSY_PING_CACHE_TTL_MS : PING_CACHE_TTL_MS
    if (pingCache && now - pingCache.timestamp < cacheTtl) {
      const cachedData = pingCache.result.data as Record<string, unknown> | undefined
      const dmAvailable = (cachedData?.documentManagerAvailable as boolean) ?? false
      const swApiAvailable = ((cachedData?.swInstalled as boolean) ?? false) && swInstalled
      return {
        success: true,
        data: {
          running: pingCache.result.success,
          busy: !pingCache.result.success,
          installed: swInstalled,
          cached: true,
          version: cachedData?.version || cachedServiceVersion,
          swInstalled: cachedData?.swInstalled,
          swApiAvailable,
          documentManagerAvailable: cachedData?.documentManagerAvailable,
          documentManagerError: cachedData?.documentManagerError,
          fastModeEnabled: cachedData?.fastModeEnabled,
          mode: getMode(dmAvailable, swApiAvailable),
          ...queueStats,
        },
      }
    }

    // Ping with short timeout (2s) to avoid blocking status checks.
    // Single-flight: concurrent status callers share one outstanding ping so the
    // two pollers (5s + 15s) and the settings screen can't stack duplicate probes.
    let pingPromise = pendingStatusPing
    if (!pingPromise) {
      pingPromise = sendSWCommand(
        { action: 'ping' },
        { timeoutMs: STATUS_PING_TIMEOUT_MS, bypassQueue: true },
      )
      pendingStatusPing = pingPromise
      void pingPromise.finally(() => {
        if (pendingStatusPing === pingPromise) {
          pendingStatusPing = null
        }
      })
    }
    const result = await pingPromise

    // Cache the ping result
    pingCache = { result, timestamp: now }

    const data = result.data as Record<string, unknown> | undefined

    // Cache version from successful ping response
    if (result.success && data?.version) {
      cachedServiceVersion = data.version as string
    }

    // If ping failed but process is alive, it's busy - not offline
    const isBusy = !result.success && processAlive

    if (isBusy) {
      log(
        `[SolidWorks] Status check: process alive but ping failed - marking as busy (queue: ${queueStats.queueDepth}, active: ${queueStats.activeCommands})`,
      )
    }

    const dmAvailable = (data?.documentManagerAvailable as boolean) ?? false
    const swApiAvailable = ((data?.swInstalled as boolean) ?? false) && swInstalled

    return {
      success: true,
      data: {
        running: result.success,
        busy: isBusy,
        installed: swInstalled,
        // Use cached version when ping times out (busy service)
        version: data?.version || cachedServiceVersion,
        swInstalled: data?.swInstalled,
        swApiAvailable,
        documentManagerAvailable: data?.documentManagerAvailable,
        documentManagerError: data?.documentManagerError,
        fastModeEnabled: data?.fastModeEnabled,
        mode: getMode(dmAvailable, swApiAvailable),
        ...queueStats,
      },
    }
  })

  ipcMain.handle('solidworks:is-installed', async () => {
    return { success: true, data: { installed: isSolidWorksInstalled() } }
  })

  // Orphaned process management
  ipcMain.handle('solidworks:get-process-status', async () => {
    log('[SolidWorks] IPC: get-process-status received')
    const status = getSolidWorksProcessStatus()
    return { success: true, data: status }
  })

  ipcMain.handle('solidworks:kill-orphaned-processes', async (_, forceAll?: boolean) => {
    log(`[SolidWorks] IPC: kill-orphaned-processes received (forceAll: ${forceAll})`)
    const result = await killOrphanedSolidWorksProcesses(forceAll ?? false)
    return {
      success: result.errors.length === 0 || result.killed > 0,
      data: result,
    }
  })

  // Cancel queued previews for folder move
  ipcMain.handle('sw:cancel-previews-for-folder', async (_, folderPath: string) => {
    return cancelPreviewsForFolder(folderPath)
  })

  // Drop queued previews the user navigated away from, keeping the current folder's
  ipcMain.handle('sw:cancel-previews', async (_, keepFolderPath?: string) => {
    return cancelStalePreviews(keepFolderPath)
  })

  // Release DM handles for folder move operations
  ipcMain.handle('sw:release-handles', async () => {
    log('[SolidWorks] Releasing handles for folder move...')
    const result = await sendSWCommand({ action: 'releaseHandles' }, { timeoutMs: 5000 })
    log(`[SolidWorks] Release handles result: ${JSON.stringify(result)}`)
    return result
  })

  // Check if SLDWORKS.exe process is running (lightweight, no service call)
  // This is useful for detecting if SolidWorks is open BEFORE attempting file operations
  ipcMain.handle('sw:is-process-running', async () => {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq SLDWORKS.exe" /FO CSV /NH', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      })
      const isRunning = result.toLowerCase().includes('sldworks.exe')
      log(`[SolidWorks] Process check: SLDWORKS.exe ${isRunning ? 'IS running' : 'is NOT running'}`)
      return isRunning
    } catch (error) {
      // If tasklist fails, assume SW is not running
      logWarn(`[SolidWorks] Process check failed: ${error}`)
      return false
    }
  })

  // Document operations
  ipcMain.handle(
    'solidworks:get-bom',
    async (
      _,
      filePath: string,
      options?: { includeChildren?: boolean; configuration?: string },
    ) => {
      return sendSWCommand({ action: 'getBom', filePath, ...options })
    },
  )

  ipcMain.handle(
    'solidworks:get-properties',
    async (_, filePath: string, configuration?: string) => {
      return sendSWCommand({ action: 'getProperties', filePath, configuration })
    },
  )

  ipcMain.handle(
    'solidworks:set-properties',
    async (_, filePath: string, properties: Record<string, string>, configuration?: string) => {
      return sendSWCommand({ action: 'setProperties', filePath, properties, configuration })
    },
  )

  ipcMain.handle(
    'solidworks:set-properties-batch',
    async (_, filePath: string, configProperties: Record<string, Record<string, string>>) => {
      return sendSWCommand({ action: 'setPropertiesBatch', filePath, configProperties })
    },
  )

  ipcMain.handle('solidworks:get-configurations', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getConfigurations', filePath })
  })

  ipcMain.handle('solidworks:get-references', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getReferences', filePath })
  })

  // Pre-warm: launch a hidden SolidWorks instance in the background so the first
  // property write (setProperties) doesn't pay the ~40s cold-start. No-op if SW is
  // already running. Guarded so only one warmup runs at a time.
  ipcMain.handle('solidworks:warmup', async () => {
    if (swWarmupInProgress) {
      return { success: true, data: { alreadyWarming: true } }
    }
    if (!swServiceProcess?.stdin) {
      return { success: false, error: 'SolidWorks service not running. Start it first.' }
    }
    log('[SolidWorks] IPC: warmup received - pre-launching hidden SolidWorks')
    swWarmupInProgress = true
    try {
      // Long timeout: a cold SolidWorks launch can take ~40s. bypassQueue so the
      // launch doesn't consume a shared queue slot for its full duration.
      const result = await sendSWCommand(
        { action: 'warmup' },
        { timeoutMs: getOperationTimeout('warmup'), bypassQueue: true },
      )
      if (result.success) {
        log('[SolidWorks] Warmup complete - SolidWorks is ready for fast edits')
      } else {
        log(`[SolidWorks] Warmup did not complete: ${result.error ?? 'unknown error'}`)
      }
      return result
    } finally {
      swWarmupInProgress = false
      // Invalidate ping cache so the next status check reflects the now-running SW.
      pingCache = null
    }
  })

  ipcMain.handle('solidworks:get-preview', async (_, filePath: string, configuration?: string) => {
    return sendSWCommand({ action: 'getPreview', filePath, configuration })
  })

  ipcMain.handle(
    'solidworks:get-mass-properties',
    async (_, filePath: string, configuration?: string) => {
      return sendSWCommand({ action: 'getMassProperties', filePath, configuration })
    },
  )

  ipcMain.handle('solidworks:get-inspection-characteristics', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getInspectionCharacteristics', filePath })
  })

  ipcMain.handle(
    'solidworks:set-inspection-characteristics',
    async (
      _,
      filePath: string,
      characteristics: Array<Record<string, string | null>>,
    ) => {
      return sendSWCommand({ action: 'setInspectionCharacteristics', filePath, characteristics })
    },
  )

  // Document creation
  ipcMain.handle(
    'solidworks:create-document-from-template',
    async (_, templatePath: string, outputPath: string) => {
      log(
        `[SolidWorks] IPC: create-document-from-template - template: ${templatePath}, output: ${outputPath}`,
      )
      return sendSWCommand({ action: 'createDocumentFromTemplate', templatePath, outputPath })
    },
  )

  // Export operations
  ipcMain.handle(
    'solidworks:export-pdf',
    async (
      _,
      filePath: string,
      options?: {
        outputPath?: string
        filenamePattern?: string
        pdmMetadata?: {
          partNumber?: string
          tabNumber?: string
          revision?: string
          description?: string
        }
      },
    ) => {
      return sendSWCommand({ action: 'exportPdf', filePath, ...options })
    },
  )

  ipcMain.handle(
    'solidworks:export-step',
    async (
      _,
      filePath: string,
      options?: {
        outputPath?: string
        configuration?: string
        exportAllConfigs?: boolean
        configurations?: string[]
        filenamePattern?: string
        pdmMetadata?: { partNumber?: string; revision?: string; description?: string }
        pdmMetadataOverride?: boolean
      },
    ) => {
      return sendSWCommand({ action: 'exportStep', filePath, ...options })
    },
  )

  ipcMain.handle('solidworks:export-dxf', async (_, filePath: string, outputPath?: string) => {
    return sendSWCommand({ action: 'exportDxf', filePath, outputPath })
  })

  ipcMain.handle(
    'solidworks:export-iges',
    async (
      _,
      filePath: string,
      options?: { outputPath?: string; exportAllConfigs?: boolean; configurations?: string[] },
    ) => {
      return sendSWCommand({ action: 'exportIges', filePath, ...options })
    },
  )

  ipcMain.handle(
    'solidworks:export-stl',
    async (
      _,
      filePath: string,
      options?: {
        outputPath?: string
        exportAllConfigs?: boolean
        configurations?: string[]
        resolution?: 'coarse' | 'fine' | 'custom'
        binaryFormat?: boolean
        customDeviation?: number // mm, for custom resolution
        customAngle?: number // degrees, for custom resolution
        filenamePattern?: string
        pdmMetadata?: {
          partNumber?: string
          tabNumber?: string
          revision?: string
          description?: string
        }
      },
    ) => {
      return sendSWCommand({ action: 'exportStl', filePath, ...options })
    },
  )

  ipcMain.handle(
    'solidworks:export-image',
    async (
      _,
      filePath: string,
      options?: { outputPath?: string; width?: number; height?: number },
    ) => {
      return sendSWCommand({ action: 'exportImage', filePath, ...options })
    },
  )

  ipcMain.handle(
    'solidworks:replace-component',
    async (_, assemblyPath: string, oldComponent: string, newComponent: string) => {
      return sendSWCommand({
        action: 'replaceComponent',
        filePath: assemblyPath,
        oldComponent,
        newComponent,
      })
    },
  )

  ipcMain.handle(
    'solidworks:pack-and-go',
    async (
      _,
      filePath: string,
      outputFolder: string,
      options?: { prefix?: string; suffix?: string },
    ) => {
      return sendSWCommand({ action: 'packAndGo', filePath, outputFolder, ...options })
    },
  )

  ipcMain.handle(
    'solidworks:duplicate-with-references',
    async (
      _,
      args: {
        sourceModelPath: string
        targetModelPath: string
        sourceDrawingPath?: string
        targetDrawingPath?: string
      },
    ) => {
      log(
        `[SolidWorks] IPC: duplicate-with-references - ${args.sourceModelPath} -> ${args.targetModelPath}` +
          (args.sourceDrawingPath ? ` (+ drawing ${args.targetDrawingPath})` : ' (no drawing)'),
      )
      return sendSWCommand({ action: 'duplicateWithReferences', ...args })
    },
  )

  ipcMain.handle(
    'solidworks:add-component',
    async (
      _,
      assemblyPath: string | null,
      componentPath: string,
      coordinates?: { x: number; y: number; z: number },
    ) => {
      return sendSWCommand({
        action: 'addComponent',
        filePath: assemblyPath,
        componentPath,
        coordinates: coordinates ? [coordinates.x, coordinates.y, coordinates.z] : null,
      })
    },
  )

  // File lock detection (uses Windows Restart Manager API, does NOT require SolidWorks)
  ipcMain.handle('solidworks:find-locking-processes', async (_, filePath: string) => {
    return sendSWCommand({ action: 'findLockingProcesses', filePath }, { timeoutMs: 5000 })
  })

  // Open document management
  ipcMain.handle(
    'solidworks:get-open-documents',
    async (_, options?: { includeComponents?: boolean }) => {
      return sendSWCommand({
        action: 'getOpenDocuments',
        includeComponents: options?.includeComponents ?? false,
      })
    },
  )

  ipcMain.handle('solidworks:is-document-open', async (_, filePath: string) => {
    return sendSWCommand({ action: 'isDocumentOpen', filePath })
  })

  // Document management commands use shorter timeouts to avoid blocking check-in
  // These should complete quickly - if they don't, the service is likely stuck
  ipcMain.handle('solidworks:get-document-info', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getDocumentInfo', filePath }, { timeoutMs: 10000 }) // 10 sec timeout
  })

  ipcMain.handle(
    'solidworks:set-document-readonly',
    async (_, filePath: string, readOnly: boolean) => {
      return sendSWCommand(
        { action: 'setDocumentReadOnly', filePath, readOnly },
        { timeoutMs: 10000 },
      ) // 10 sec timeout
    },
  )

  ipcMain.handle('solidworks:save-document', async (_, filePath: string) => {
    return sendSWCommand({ action: 'saveDocument', filePath }, { timeoutMs: 30000 }) // 30 sec timeout for saves
  })

  ipcMain.handle(
    'solidworks:set-document-properties',
    async (_, filePath: string, properties: Record<string, string>, configuration?: string) => {
      return sendSWCommand(
        { action: 'setDocumentProperties', filePath, properties, configuration },
        { timeoutMs: 30000 },
      )
    },
  )

  // Selection tracking - get currently selected components in the active assembly
  ipcMain.handle('solidworks:get-selected-files', async () => {
    return sendSWCommand({ action: 'getSelectedFiles' }, { timeoutMs: 2000 }) // Short timeout for responsiveness
  })

  // eDrawings handlers
  ipcMain.handle('edrawings:check-installed', async () => {
    const paths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\eDrawings\\eDrawings.exe',
      'C:\\Program Files (x86)\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\eDrawings\\eDrawings.exe',
    ]

    for (const ePath of paths) {
      if (fs.existsSync(ePath)) {
        return { installed: true, path: ePath }
      }
    }

    return { installed: false, path: null }
  })

  ipcMain.handle('edrawings:native-available', () => {
    return false // Native module not available in refactored version
  })

  ipcMain.handle('edrawings:open-file', async (_, filePath: string) => {
    const eDrawingsPaths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\eDrawings\\eDrawings.exe',
      'C:\\Program Files (x86)\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\eDrawings\\eDrawings.exe',
    ]

    let eDrawingsPath: string | null = null
    for (const ePath of eDrawingsPaths) {
      if (fs.existsSync(ePath)) {
        eDrawingsPath = ePath
        break
      }
    }

    if (!eDrawingsPath) {
      try {
        await shell.openPath(filePath)
        return { success: true, fallback: true }
      } catch {
        return { success: false, error: 'eDrawings not found' }
      }
    }

    try {
      spawn(eDrawingsPath, [filePath], {
        detached: true,
        stdio: 'ignore',
      }).unref()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('edrawings:get-window-handle', () => {
    if (!mainWindow) return null
    const handle = mainWindow.getNativeWindowHandle()
    return Array.from(handle)
  })

  // Placeholder handlers for eDrawings preview (native module not loaded)
  ipcMain.handle('edrawings:create-preview', () => {
    return { success: false, error: 'Native module not available' }
  })

  ipcMain.handle('edrawings:attach-preview', () => {
    return { success: false, error: 'Preview not created' }
  })

  ipcMain.handle('edrawings:load-file', async () => {
    return { success: false, error: 'Preview not attached' }
  })

  ipcMain.handle('edrawings:set-bounds', async () => {
    return { success: false }
  })

  ipcMain.handle('edrawings:show-preview', () => {
    return { success: false }
  })

  ipcMain.handle('edrawings:hide-preview', () => {
    return { success: false }
  })

  ipcMain.handle('edrawings:destroy-preview', () => {
    return { success: true }
  })

  // ============================================
  // SOLIDWORKS File Locations (Registry) Handlers
  // ============================================

  ipcMain.handle('solidworks:get-installed-versions', async () => {
    return getInstalledSolidWorksVersions()
  })

  ipcMain.handle('solidworks:get-file-locations', async () => {
    return getSolidWorksFileLocations()
  })

  ipcMain.handle(
    'solidworks:set-file-locations',
    async (
      _,
      settings: {
        documentTemplates?: string
        sheetFormats?: string
        bomTemplates?: string
        customPropertyFolders?: string
        promptForTemplate?: boolean
      },
    ) => {
      return setSolidWorksFileLocations(settings)
    },
  )

  // ===== License Registry Operations =====
  // These operate on HKLM\Software\SolidWorks\Licenses\Serial Numbers
  // Writing requires administrator privileges

  ipcMain.handle('solidworks:get-license-registry', async () => {
    return getSolidWorksLicenseFromRegistry()
  })

  ipcMain.handle('solidworks:set-license-registry', async (_, serialNumber: string) => {
    return setSolidWorksLicenseInRegistry(serialNumber)
  })

  ipcMain.handle('solidworks:remove-license-registry', async (_, serialNumber: string) => {
    return removeSolidWorksLicenseFromRegistry(serialNumber)
  })

  ipcMain.handle('solidworks:check-license-registry', async (_, serialNumber: string) => {
    return checkLicenseInRegistry(serialNumber)
  })

  // Open SOLIDWORKS License Manager
  ipcMain.handle('solidworks:open-license-manager', async () => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'SOLIDWORKS License Manager is only available on Windows' }
    }

    // Build list of possible paths including year-specific versions
    const possiblePaths: string[] = []

    // Check for year-specific installations (2020-2030)
    for (let year = 2030; year >= 2020; year--) {
      possiblePaths.push(
        `C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS ${year}\\swlmwiz.exe`,
        `C:\\Program Files\\SolidWorks Corp\\SolidWorks ${year}\\swlmwiz.exe`,
      )
    }

    // Generic paths (no year)
    possiblePaths.push(
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\swlmwiz.exe',
      'C:\\Program Files\\SolidWorks Corp\\SolidWorks\\swlmwiz.exe',
      'C:\\Program Files (x86)\\SOLIDWORKS Corp\\SOLIDWORKS\\swlmwiz.exe',
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS SolidNetWork License Manager\\SolidNetWork License Manager.exe',
      'C:\\Program Files\\SOLIDWORKS Corp\\SolidNetWork License Manager\\SolidNetWork License Manager.exe',
    )

    let licenseMgrPath: string | null = null
    for (const lmPath of possiblePaths) {
      if (fs.existsSync(lmPath)) {
        licenseMgrPath = lmPath
        log(`[SolidWorks] Found License Manager at: ${lmPath}`)
        break
      }
    }

    // If not found in common paths, try to find SOLIDWORKS installation from registry
    if (!licenseMgrPath) {
      try {
        const regResult = execSync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\SolidWorks\\SOLIDWORKS" /v "SolidWorks Folder" 2>nul',
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
        )
        const match = regResult.match(/SolidWorks Folder\s+REG_SZ\s+(.+)/i)
        if (match) {
          const swFolder = match[1].trim()
          const swlmPath = path.join(swFolder, 'swlmwiz.exe')
          if (fs.existsSync(swlmPath)) {
            licenseMgrPath = swlmPath
            log(`[SolidWorks] Found License Manager via registry at: ${swlmPath}`)
          }
        }
      } catch {
        // Registry query failed, continue with fallback
      }
    }

    if (!licenseMgrPath) {
      log('[SolidWorks] License Manager not found in any known location')
      return {
        success: false,
        error:
          'SOLIDWORKS License Manager not found. Open it from Start Menu -> SOLIDWORKS Tools -> SOLIDWORKS License Manager.',
      }
    }

    try {
      log(`[SolidWorks] Opening License Manager: ${licenseMgrPath}`)
      spawn(licenseMgrPath, [], {
        detached: true,
        stdio: 'ignore',
      }).unref()
      return { success: true }
    } catch (error) {
      logError(`[SolidWorks] Failed to open License Manager: ${String(error)}`)
      return { success: false, error: String(error) }
    }
  })
}

export function unregisterSolidWorksHandlers(): void {
  const handlers = [
    'solidworks:extract-thumbnail',
    'solidworks:extract-preview',
    'solidworks:start-service',
    'solidworks:set-autostart-config',
    'solidworks:stop-service',
    'solidworks:force-restart',
    'solidworks:reset-com-connection',
    'solidworks:service-status',
    'solidworks:is-installed',
    'solidworks:get-process-status',
    'solidworks:kill-orphaned-processes',
    'sw:cancel-previews-for-folder',
    'sw:cancel-previews',
    'sw:release-handles',
    'solidworks:get-bom',
    'solidworks:get-properties',
    'solidworks:set-properties',
    'solidworks:set-properties-batch',
    'solidworks:get-configurations',
    'solidworks:get-references',
    'solidworks:get-preview',
    'solidworks:get-mass-properties',
    'solidworks:export-pdf',
    'solidworks:export-step',
    'solidworks:export-dxf',
    'solidworks:export-iges',
    'solidworks:export-stl',
    'solidworks:export-image',
    'solidworks:replace-component',
    'solidworks:pack-and-go',
    'solidworks:duplicate-with-references',
    'solidworks:get-open-documents',
    'solidworks:is-document-open',
    'solidworks:get-document-info',
    'solidworks:set-document-readonly',
    'solidworks:save-document',
    'solidworks:set-document-properties',
    'solidworks:get-selected-files',
    'solidworks:get-installed-versions',
    'solidworks:get-file-locations',
    'solidworks:set-file-locations',
    'solidworks:get-license-registry',
    'solidworks:set-license-registry',
    'solidworks:remove-license-registry',
    'solidworks:check-license-registry',
    'solidworks:open-license-manager',
    'edrawings:check-installed',
    'edrawings:native-available',
    'edrawings:open-file',
    'edrawings:get-window-handle',
    'edrawings:create-preview',
    'edrawings:attach-preview',
    'edrawings:load-file',
    'edrawings:set-bounds',
    'edrawings:show-preview',
    'edrawings:hide-preview',
    'edrawings:destroy-preview',
  ]

  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}

/**
 * Cleanup function to be called on app quit.
 * Gracefully stops the SolidWorks service and clears all state.
 * Should be registered with app.on('before-quit').
 */
export async function cleanupSolidWorksService(): Promise<void> {
  log('[SolidWorks] =======================================')
  log('[SolidWorks] [CLEANUP] APP QUIT - CLEANUP STARTED')
  log('[SolidWorks] =======================================')
  logServiceState('App quit cleanup')

  // Stop the orphaned process watchdog
  stopOrphanWatchdog()

  if (!swServiceProcess) {
    log('[SolidWorks] No service process to clean up')
    return
  }

  const pid = swServiceProcess.pid
  log(`[SolidWorks] Gracefully stopping service (PID: ${pid})...`)

  try {
    // Try to send quit command gracefully (short timeout)
    log('[SolidWorks] Sending quit command...')
    await sendSWCommand({ action: 'quit' }, { timeoutMs: 2000 })
    log('[SolidWorks] [OK] Quit command sent')
  } catch (error) {
    logWarn(`[SolidWorks] [WARN] Quit command failed: ${error}`)
  }

  // Force kill if still running
  if (swServiceProcess) {
    try {
      log('[SolidWorks] Force killing process...')
      swServiceProcess.kill('SIGKILL')
      log('[SolidWorks] [OK] SIGKILL sent')
    } catch (error) {
      log('[SolidWorks] [FAIL] Error killing process: ' + String(error))
    }
  }

  clearServiceState('App quit cleanup', true)
  log('[SolidWorks] Service cleanup complete')
}
