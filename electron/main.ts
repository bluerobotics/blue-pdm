// BluePLM Electron Main Process
// This file contains only app lifecycle, window creation, and imports handlers from modules

import { app, BrowserWindow, shell, screen, nativeTheme, session, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as Sentry from '@sentry/electron/main'

import {
  registerAllHandlers,
  initializeLogging,
  writeLog,
  startCliServer,
  cleanupCli,
  autoStartServiceFromCache,
  cleanupSolidWorksService,
  cleanupExtensionHost,
  cleanupOAuth,
  cleanupUpdater,
  cleanupFs,
  performMigrationCheck,
  wasMigrationPerformed,
  handleDeepLink,
  storePendingDeepLink,
  setDeepLinkDependencies,
} from './handlers'
import { createAppMenu } from './menu'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================
// Instance Lock File (for stale lock detection)
// ============================================

// Lock file stores the PID of the running instance
// Used to detect and recover from zombie processes
const LOCK_FILE_PATH = path.join(app.getPath('userData'), '.instance-lock')

/**
 * Check if a process with the given PID is still alive.
 * Uses signal 0 which checks existence without actually sending a signal.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH = No such process, EPERM = permission denied (but process exists)
    return false
  }
}

/**
 * Write the current process PID to the lock file.
 * Called after successfully acquiring the single instance lock.
 */
function writeLockFile(): void {
  try {
    fs.writeFileSync(LOCK_FILE_PATH, String(process.pid), 'utf-8')
  } catch (error) {
    // Non-fatal - log but continue
    console.error('[Main] Failed to write lock file:', error)
  }
}

/**
 * Read the PID from the lock file.
 * Returns null if file doesn't exist or is invalid.
 */
function readLockFilePid(): number | null {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      const content = fs.readFileSync(LOCK_FILE_PATH, 'utf-8').trim()
      const pid = parseInt(content, 10)
      return isNaN(pid) ? null : pid
    }
  } catch {
    // Ignore read errors
  }
  return null
}

/**
 * Delete the lock file.
 * Called during cleanup and when recovering from stale locks.
 */
function deleteLockFile(): void {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      fs.unlinkSync(LOCK_FILE_PATH)
    }
  } catch {
    // Ignore deletion errors
  }
}

/**
 * Attempt to kill a zombie process by PID.
 * Returns true if the process was killed or doesn't exist.
 */
function tryKillZombieProcess(pid: number): boolean {
  try {
    // Check if process is still alive first
    if (!isProcessAlive(pid)) {
      return true // Already dead
    }

    // Try to kill the zombie process
    process.kill(pid, 'SIGTERM')

    // Wait a moment and check again
    // Using sync sleep via busy wait (acceptable for one-time startup)
    const start = Date.now()
    while (Date.now() - start < 500) {
      if (!isProcessAlive(pid)) {
        return true
      }
    }

    // Force kill if still alive
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Ignore - may not have permission
    }

    return !isProcessAlive(pid)
  } catch {
    // Permission denied or other error
    return false
  }
}

// ============================================
// Sentry Error Tracking (Main Process)
// ============================================

const SENTRY_DSN =
  process.env.VITE_SENTRY_DSN ||
  'https://7e0fa5359dedac9d87c951c593def9fa@o4510557909417984.ingest.us.sentry.io/4510557913350144'

function getAnalyticsSettingsPath(): string {
  return path.join(app.getPath('userData'), 'analytics-settings.json')
}

function readAnalyticsEnabled(): boolean {
  try {
    const settingsPath = getAnalyticsSettingsPath()
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      return data?.enabled === true
    }
  } catch {
    // Ignore errors
  }
  return false
}

let sentryInitialized = false

function initSentryMain(): void {
  if (sentryInitialized) return

  const analyticsEnabled = readAnalyticsEnabled()

  if (analyticsEnabled && SENTRY_DSN) {
    try {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        release: app.getVersion(),
        sendDefaultPii: false,
      })
      sentryInitialized = true
      log('[Sentry] Main process initialized')
    } catch (error) {
      console.error('[Sentry] Failed to initialize:', error)
    }
  } else {
    log('[Sentry] Not initialized (disabled by user or no DSN)')
  }
}

// ============================================
// Logging Utilities
// ============================================

const log = (message: string, data?: unknown) => {
  writeLog('info', `[Main] ${message}`, data)
}

const logError = (message: string, data?: unknown) => {
  writeLog('error', `[Main] ${message}`, data)
}

// Prevent crashes from taking down the whole app
process.on('uncaughtException', (error) => {
  writeLog('error', 'Uncaught exception', { error: error.message, stack: error.stack })
})

process.on('unhandledRejection', (reason) => {
  writeLog('error', 'Unhandled rejection', { reason: String(reason) })
})

// ============================================
// Window State Persistence
// ============================================

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const windowStateFile = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(windowStateFile)) {
      const data = fs.readFileSync(windowStateFile, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Failed to load window state:', error)
  }
  return { width: 1400, height: 900, isMaximized: false }
}

function saveWindowState(mainWindow: BrowserWindow) {
  if (!mainWindow) return

  try {
    const isMaximized = mainWindow.isMaximized()
    const bounds = mainWindow.getBounds()

    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    }

    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('Failed to save window state:', error)
  }
}

// ============================================
// Main Window
// ============================================

let mainWindow: BrowserWindow | null = null

// ============================================
// Timing Constants
// ============================================
const SHOW_WINDOW_FALLBACK_MS = 5_000
const HARD_EXIT_FALLBACK_MS = 500

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Follow system dark/light mode for web content
nativeTheme.themeSource = 'system'

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

// ============================================
// Deep Link Protocol Registration
// ============================================

// Register blueplm:// as the app's protocol handler
// Must be done before requesting single instance lock
if (process.defaultApp) {
  // Development: need to pass the script path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('blueplm', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  // Production: just register the protocol
  app.setAsDefaultProtocolClient('blueplm')
}

// Initialize deep link dependencies early for logging
setDeepLinkDependencies({
  log: (message: string, data?: unknown) => writeLog('info', `[DeepLink] ${message}`, data),
  logError: (message: string, data?: unknown) => writeLog('error', `[DeepLink] ${message}`, data),
})

// Check for deep link in startup arguments (Windows)
function getDeepLinkFromArgs(args: string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith('blueplm://') || arg.startsWith('blueplm:')) {
      return arg
    }
  }
  return null
}

// ============================================
// CRITICAL: Initialize logging BEFORE single instance lock
// This ensures we capture "Another instance running" messages for debugging
// ============================================
initializeLogging()

// Store initial deep link if launched via protocol
const initialDeepLink = getDeepLinkFromArgs(process.argv)
if (initialDeepLink) {
  log('App launched via deep link: ' + initialDeepLink.substring(0, 80))
  storePendingDeepLink(initialDeepLink)
}

const isTestMode = process.argv.includes('--test-mode') || process.env.BLUEPLM_TEST === '1'

/**
 * Attempt to acquire the single instance lock with stale lock recovery.
 * If the lock is held by a dead process (zombie), we attempt to recover.
 */
function acquireSingleInstanceLock(): boolean {
  if (isTestMode) {
    return true
  }

  // First attempt
  if (app.requestSingleInstanceLock()) {
    return true
  }

  // Lock is held - check if it's a stale lock from a zombie process
  log('Lock held by another process, checking for stale lock...')

  const existingPid = readLockFilePid()
  if (existingPid === null) {
    // No PID file - can't determine if stale, assume legitimate instance
    log('No lock file found, assuming another instance is running')
    return false
  }

  log(`Lock file shows PID: ${existingPid}`)

  if (isProcessAlive(existingPid)) {
    // Process is actually running - legitimate lock
    log(`Process ${existingPid} is alive, another instance is running`)
    return false
  }

  // Process is dead! This is a stale lock from a zombie
  log(`Process ${existingPid} is dead - stale lock detected, attempting recovery...`)

  // Delete the stale lock file
  deleteLockFile()

  // Try to kill any remaining zombie process (belt and suspenders)
  tryKillZombieProcess(existingPid)

  // Small delay to let OS release resources
  const start = Date.now()
  while (Date.now() - start < 100) {
    // Brief busy-wait
  }

  // Retry acquiring the lock
  if (app.requestSingleInstanceLock()) {
    log('✓ Successfully recovered from stale lock')
    return true
  }

  // Still can't get the lock - try one more time after killing
  log('Still cannot acquire lock, attempting force cleanup...')
  tryKillZombieProcess(existingPid)

  // Final attempt
  const finalWaitStart = Date.now()
  while (Date.now() - finalWaitStart < 500) {
    // Wait for process cleanup
  }

  return app.requestSingleInstanceLock()
}

const gotTheLock = acquireSingleInstanceLock()

if (!gotTheLock) {
  // CRITICAL: This log message is now captured to file for debugging restart issues
  log('⚠️ Another instance is running (could not recover), quitting...')
  app.quit()
  // Don't register any handlers - the app should quit immediately
} else {
  log(
    isTestMode
      ? 'Running in test mode (single instance lock bypassed)'
      : '✓ Got single instance lock',
  )

  // Write our PID to the lock file for future stale lock detection
  writeLockFile()

  // All app initialization happens inside this block to prevent
  // secondary instances from doing anything after calling app.quit()
  initializeApp()
}

function initializeApp() {
  // ============================================
  // App Lifecycle (only runs if we got the lock)
  // ============================================

  // Handle second instance (Windows/Linux deep links come through here)
  app.on('second-instance', (_event, commandLine) => {
    log('Second instance detected')

    // Check for deep link in command line args
    const deepLink = getDeepLinkFromArgs(commandLine)
    if (deepLink) {
      log('Deep link from second instance: ' + deepLink.substring(0, 80))
      handleDeepLink(deepLink)
    }

    // Focus the main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // Handle deep links on macOS (open-url event)
  app.on('open-url', (event, url) => {
    event.preventDefault()
    log('Deep link received (open-url): ' + url.substring(0, 80))

    if (mainWindow) {
      handleDeepLink(url)
    } else {
      // Window not ready yet, store for later
      storePendingDeepLink(url)
    }
  })

  // Initialize Sentry before app 'ready' event fires (required by @sentry/electron)
  initSentryMain()

  app
    .whenReady()
    .then(async () => {
      // Note: Logging is already initialized before single instance lock check

      // Perform migration check BEFORE creating window
      // This handles clean install when upgrading from 2.x to 3.0+
      log('Checking for version migration...')
      const migrationResult = await performMigrationCheck()
      if (migrationResult.performed) {
        log('Migration performed: cleaned ' + migrationResult.cleanedPaths.length + ' items', {
          fromVersion: migrationResult.fromVersion,
          toVersion: migrationResult.toVersion,
        })
      }

      log('App ready, creating window...')
      createWindow()

      // Start the SolidWorks service from the main process in parallel with the
      // renderer boot. The renderer's initial vault load can saturate its thread
      // for tens of seconds, starving the renderer-driven auto-start; launching
      // here (fire-and-forget) makes the service ready in ~2s regardless. No-op
      // on first-ever boot (no cache) or when auto-start is disabled.
      autoStartServiceFromCache().catch((error) => {
        logError('SolidWorks main-process early start failed', { error: String(error) })
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow()
        } else if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
        }
      })

      // Start CLI server in dev mode
      if (isDev || process.env.BLUEPLM_CLI === '1') {
        startCliServer()
      }
    })
    .catch((error) => {
      logError('Error during app ready', { error: String(error) })
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Track if we're already quitting to prevent re-entry
  let isQuitting = false

  // Cleanup on app quit
  app.on('before-quit', async (event) => {
    // Prevent re-entry during cleanup
    if (isQuitting) {
      return
    }

    // Prevent default quit behavior to allow async cleanup
    event.preventDefault()
    isQuitting = true

    log('App quitting, cleaning up all resources...')

    // ============================================
    // HARD DEADLINE: 8 seconds maximum for cleanup
    // This is the absolute maximum time we'll wait before force-killing
    // ============================================
    const HARD_DEADLINE_MS = 8000
    const CLEANUP_TIMEOUT_MS = 5000
    const cleanupStartTime = Date.now()

    // Set up hard deadline - if we're still running after 8 seconds, force exit
    const hardDeadlineTimer = setTimeout(() => {
      logError('HARD DEADLINE EXCEEDED - Force exiting with process.exit(1)')
      deleteLockFile() // Ensure lock file is cleaned up
      process.exit(1)
    }, HARD_DEADLINE_MS)

    // Wrap all cleanup in a timeout to prevent hangs
    const cleanupWithTimeout = async () => {
      // ================================================
      // CRITICAL: Stop all timers/intervals FIRST
      // These can prevent the Node.js event loop from exiting
      // ================================================

      // Stop update check timer (ROOT CAUSE of zombie process issue)
      cleanupUpdater()
      log('✓ Updater cleanup complete')

      // Stop file watcher
      try {
        await cleanupFs()
        log('✓ File watcher cleanup complete')
      } catch (error) {
        logError('Failed to cleanup file watcher', { error: String(error) })
      }

      // ================================================
      // Cleanup child processes and servers
      // ================================================

      // Cleanup Extension Host (has 1 second internal timeout)
      try {
        await cleanupExtensionHost()
        log('✓ Extension Host cleanup complete')
      } catch (error) {
        logError('Failed to cleanup Extension Host', { error: String(error) })
      }

      // Cleanup SolidWorks service (can hang if service is stuck)
      try {
        await cleanupSolidWorksService()
        log('✓ SolidWorks service cleanup complete')
      } catch (error) {
        logError('Failed to cleanup SolidWorks service', { error: String(error) })
      }

      // Cleanup OAuth servers (sync, should be fast)
      cleanupOAuth()
      log('✓ OAuth cleanup complete')

      // Cleanup CLI server (destroys active connections)
      cleanupCli()
      log('✓ CLI cleanup complete')
    }

    try {
      // Race cleanup against timeout
      await Promise.race([
        cleanupWithTimeout(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Cleanup timeout')), CLEANUP_TIMEOUT_MS),
        ),
      ])

      const elapsed = Date.now() - cleanupStartTime
      log(`All cleanup complete in ${elapsed}ms, exiting...`)
    } catch (error) {
      const elapsed = Date.now() - cleanupStartTime
      logError(`Cleanup timed out or failed after ${elapsed}ms, force exiting...`, {
        error: String(error),
      })
    }

    // Clear the hard deadline timer since we're about to exit
    clearTimeout(hardDeadlineTimer)

    // Delete the lock file so next launch doesn't see stale lock
    deleteLockFile()
    log('✓ Lock file deleted')

    // Exit the Electron app
    app.exit(0)

    // ============================================
    // HARD EXIT FALLBACK: after app.exit(0)
    // If app.exit(0) doesn't actually terminate the process
    // (e.g., due to lingering event handlers or refs), force it
    // ============================================
    setTimeout(() => {
      logError('Hard exit fallback triggered - app.exit(0) did not terminate process')
      process.exit(0)
    }, HARD_EXIT_FALLBACK_MS)
  })
}

// Helper to restore focus to main window after dialogs (fixes macOS UI freeze issue)
function restoreMainWindowFocus() {
  if (process.platform === 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus()
      }
    })
  }
}

function createWindow() {
  log('Creating BrowserWindow...')

  const savedState = loadWindowState()

  // Validate window position is on a visible display
  let x = savedState.x
  let y = savedState.y
  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays()
    const isOnDisplay = displays.some((display) => {
      const { x: dx, y: dy, width, height } = display.bounds
      return x! >= dx && x! < dx + width && y! >= dy && y! < dy + height
    })
    if (!isOnDisplay) {
      x = undefined
      y = undefined
    }
  }

  mainWindow = new BrowserWindow({
    x,
    y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 600,
    minHeight: 300,
    backgroundColor: '#0a1929',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#181818',
      symbolColor: '#cccccc',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  // Set up permission handler for geolocation
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['geolocation', 'notifications', 'clipboard-read']
    if (allowedPermissions.includes(permission)) {
      log(`Granting permission: ${permission}`)
      callback(true)
    } else {
      log(`Denying permission: ${permission}`)
      callback(false)
    }
  })

  // Restore maximized state
  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  // Save window state on changes
  // Store handler references so they can be removed during cleanup
  const resizeHandler = () => saveWindowState(mainWindow!)
  const moveHandler = () => saveWindowState(mainWindow!)
  const maximizeHandler = () => saveWindowState(mainWindow!)
  const unmaximizeHandler = () => saveWindowState(mainWindow!)

  mainWindow.on('resize', resizeHandler)
  mainWindow.on('move', moveHandler)
  mainWindow.on('maximize', maximizeHandler)
  mainWindow.on('unmaximize', unmaximizeHandler)

  let windowShown = false
  const showWindow = () => {
    if (!windowShown && mainWindow) {
      windowShown = true
      mainWindow.show()
    }
  }

  mainWindow.once('ready-to-show', showWindow)
  setTimeout(showWindow, SHOW_WINDOW_FALLBACK_MS)

  mainWindow.webContents.on('render-process-gone', () => log('Renderer process crashed!'))
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log('Failed to load: ' + errorCode + ' ' + errorDescription)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    log('Page finished loading')
    if (mainWindow) {
      // getTitleBarOverlayRect may not exist on all Electron versions
      const win = mainWindow as BrowserWindow & {
        getTitleBarOverlayRect?: () => { x: number; y: number; width: number; height: number }
      }
      const overlayRect = win.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
      mainWindow.webContents.send('titlebar-overlay-rect', overlayRect)
    }
  })

  // Show context menu with Cut/Copy/Paste for editable elements (inputs, textareas)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    // Only show edit context menu for editable fields
    if (params.isEditable) {
      const editMenu = Menu.buildFromTemplate([
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      ])
      editMenu.popup()
    }
  })

  const loadPath = isDev ? 'http://localhost:5173' : path.join(__dirname, '../dist/index.html')

  log('Loading: ' + loadPath)

  if (isDev) {
    mainWindow.loadURL(loadPath)
  } else {
    mainWindow.loadFile(loadPath).catch((error) => log('Error loading file: ' + String(error)))
  }

  // In production, intercept OAuth redirects
  if (!isDev) {
    mainWindow.webContents.on('will-navigate', (event, navUrl) => {
      if (navUrl.startsWith('http://localhost') && navUrl.includes('access_token')) {
        log('Intercepting OAuth redirect in main window')
        event.preventDefault()

        const url = new URL(navUrl)
        const hashFragment = url.hash || ''
        const queryString = url.search || ''

        const prodPath = path.join(__dirname, '../dist/index.html')
        const normalizedPath = prodPath.replace(/\\/g, '/')
        const fileUrl = `file:///${normalizedPath}${queryString}${hashFragment}`

        mainWindow?.loadURL(fileUrl)
      }
    })
  }

  // Keep track of Google auth windows
  let googleAuthWindow: BrowserWindow | null = null

  // Handle popup windows from iframes (like Google sign-in)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log('[Window] Popup requested: ' + url.substring(0, 100))

    const isGoogleAuth =
      url.includes('accounts.google.com') ||
      url.includes('google.com/o/oauth2') ||
      url.includes('google.com/signin')

    if (isGoogleAuth) {
      log('[Window] Opening Google auth in Electron window')

      if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
        googleAuthWindow.close()
      }

      googleAuthWindow = new BrowserWindow({
        width: 500,
        height: 700,
        parent: process.platform === 'darwin' ? undefined : mainWindow || undefined,
        modal: false,
        show: true,
        title: 'Sign in to Google',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      googleAuthWindow.loadURL(url)

      googleAuthWindow.webContents.on('did-navigate', (_, navUrl) => {
        log('[Window] Auth window navigated to: ' + navUrl.substring(0, 80))

        const isDocumentUrl =
          navUrl.includes('docs.google.com/document/d/') ||
          navUrl.includes('docs.google.com/spreadsheets/d/') ||
          navUrl.includes('docs.google.com/presentation/d/') ||
          navUrl.includes('docs.google.com/forms/d/') ||
          navUrl.includes('drive.google.com/file/d/')

        if (isDocumentUrl) {
          log('[Window] Sign-in complete, closing auth window')
          if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
            googleAuthWindow.close()
          }
        }
      })

      googleAuthWindow.on('closed', () => {
        log('[Window] Google auth window closed')
        googleAuthWindow = null
        mainWindow?.webContents.send('gdrive:session-authenticated')
        if (process.platform === 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus()
        }
      })

      return { action: 'deny' }
    }

    log('[Window] Opening in external browser: ' + url.substring(0, 80))
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    // ============================================
    // Clean up window event handlers to prevent memory leaks
    // and ensure the event loop can exit
    // ============================================
    if (mainWindow) {
      mainWindow.removeListener('resize', resizeHandler)
      mainWindow.removeListener('move', moveHandler)
      mainWindow.removeListener('maximize', maximizeHandler)
      mainWindow.removeListener('unmaximize', unmaximizeHandler)
    }
    mainWindow = null

    // ============================================
    // CRITICAL: Close the Extension Host window when main window closes
    // The Extension Host is a hidden BrowserWindow that prevents the
    // 'window-all-closed' event from firing. We must close it here
    // to allow the app to quit properly on Windows/Linux.
    // ============================================
    if (process.platform !== 'darwin') {
      // On Windows/Linux, we need to close Extension Host immediately
      // so window-all-closed fires and triggers app.quit()
      cleanupExtensionHost()
    }
  })

  // Register all IPC handlers
  registerAllHandlers(mainWindow, {
    restoreMainWindowFocus,
  })

  // Create application menu
  createAppMenu(mainWindow, { log })
}
