import { app, BrowserWindow, ipcMain, Menu, shell, dialog, screen, nativeImage, nativeTheme, session } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import http from 'http'
import { fileURLToPath } from 'url'
import chokidar from 'chokidar'
import type { AddressInfo } from 'net'
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import * as si from 'systeminformation'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================
// File-based Logging System
// ============================================

// Log retention settings interface
interface LogRetentionSettings {
  maxFiles: number           // Max number of log files to keep (0 = unlimited)
  maxAgeDays: number         // Max age in days (0 = unlimited)
  maxSizeMb: number          // Max size per log file in MB
  maxTotalSizeMb: number     // Max total size of all log files in MB (0 = unlimited)
}

// Default settings (used if no settings file exists)
const DEFAULT_LOG_RETENTION: LogRetentionSettings = {
  maxFiles: 100,            // Keep max 100 log files
  maxAgeDays: 7,            // Auto-delete logs older than 7 days  
  maxSizeMb: 10,            // 10MB max per log file
  maxTotalSizeMb: 500       // 500MB max total (half a GB)
}

// Current settings (loaded on startup)
let logRetentionSettings: LogRetentionSettings = { ...DEFAULT_LOG_RETENTION }

// Settings file path
let logSettingsFilePath: string | null = null

function getLogSettingsPath(): string {
  if (!logSettingsFilePath) {
    logSettingsFilePath = path.join(app.getPath('userData'), 'log-settings.json')
  }
  return logSettingsFilePath
}

function loadLogRetentionSettings(): LogRetentionSettings {
  try {
    const settingsPath = getLogSettingsPath()
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8')
      const loaded = JSON.parse(data) as Partial<LogRetentionSettings>
      // Merge with defaults to ensure all fields exist
      logRetentionSettings = {
        maxFiles: loaded.maxFiles ?? DEFAULT_LOG_RETENTION.maxFiles,
        maxAgeDays: loaded.maxAgeDays ?? DEFAULT_LOG_RETENTION.maxAgeDays,
        maxSizeMb: loaded.maxSizeMb ?? DEFAULT_LOG_RETENTION.maxSizeMb,
        maxTotalSizeMb: loaded.maxTotalSizeMb ?? DEFAULT_LOG_RETENTION.maxTotalSizeMb
      }
    }
  } catch (err) {
    console.error('Failed to load log retention settings:', err)
    logRetentionSettings = { ...DEFAULT_LOG_RETENTION }
  }
  return logRetentionSettings
}

function saveLogRetentionSettings(settings: LogRetentionSettings): boolean {
  try {
    const settingsPath = getLogSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    logRetentionSettings = settings
    return true
  } catch (err) {
    console.error('Failed to save log retention settings:', err)
    return false
  }
}

// Computed values from settings
const LOG_MAX_SIZE = () => logRetentionSettings.maxSizeMb * 1024 * 1024

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

// In-memory log buffer (for fast access)
const logBuffer: LogEntry[] = []
const LOG_BUFFER_MAX = 1000 // Keep last 1000 entries in memory

let logFilePath: string | null = null
let logStream: fs.WriteStream | null = null
let currentLogSize = 0 // Track current log file size in bytes

function formatDateForFilename(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
}

function initializeLogging() {
  try {
    // Load log retention settings
    loadLogRetentionSettings()
    
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    
    // Create a new log file for this session with timestamp
    const sessionTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${sessionTimestamp}.log`)
    
    // Clean up old log files if we have too many
    cleanupOldLogFiles(logsDir)
    
    // Open log file for writing (new file for each session)
    logStream = fs.createWriteStream(logFilePath, { flags: 'w' })
    currentLogSize = 0
    
    // Write startup header
    const startupHeader = `${'='.repeat(60)}\nBluePLM Session Log\nStarted: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\nPlatform: ${process.platform} ${process.arch}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n${'='.repeat(60)}\n\n`
    logStream.write(startupHeader)
    currentLogSize += Buffer.byteLength(startupHeader, 'utf8')
  } catch (err) {
    console.error('Failed to initialize logging:', err)
  }
}

function cleanupOldLogFiles(logsDir: string) {
  try {
    const { maxFiles, maxAgeDays, maxTotalSizeMb } = logRetentionSettings
    const now = Date.now()
    const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0 // Convert days to milliseconds
    const maxTotalSizeBytes = maxTotalSizeMb > 0 ? maxTotalSizeMb * 1024 * 1024 : 0
    
    // Get all log files sorted by modified time (newest first) with sizes
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
      .map(filename => {
        const filePath = path.join(logsDir, filename)
        const stats = fs.statSync(filePath)
        return {
          name: filename,
          path: filePath,
          mtime: stats.mtime.getTime(),
          size: stats.size
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
    
    // First, delete files older than maxAgeDays (if age limit is set)
    if (maxAgeDays > 0) {
      for (const file of logFiles) {
        const age = now - file.mtime
        if (age > maxAgeMs) {
          try {
            fs.unlinkSync(file.path)
            console.log(`Deleted old log file (>${maxAgeDays} days): ${file.name}`)
          } catch (err) {
            console.error(`Failed to delete old log file ${file.name}:`, err)
          }
        }
      }
    }
    
    // Re-read remaining files after age-based cleanup (with sizes)
    let remainingFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
      .map(filename => {
        const filePath = path.join(logsDir, filename)
        const stats = fs.statSync(filePath)
        return {
          name: filename,
          path: filePath,
          mtime: stats.mtime.getTime(),
          size: stats.size
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
    
    // Delete files beyond the file count limit (if file limit is set)
    if (maxFiles > 0 && remainingFiles.length >= maxFiles) {
      const filesToDelete = remainingFiles.slice(maxFiles - 1)
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path)
          console.log(`Deleted old log file (over limit of ${maxFiles}): ${file.name}`)
        } catch (err) {
          console.error(`Failed to delete old log file ${file.name}:`, err)
        }
      }
      // Update remaining files list
      remainingFiles = remainingFiles.slice(0, maxFiles - 1)
    }
    
    // Delete oldest files until we're under the total size limit (if size limit is set)
    if (maxTotalSizeBytes > 0) {
      let totalSize = remainingFiles.reduce((sum, f) => sum + f.size, 0)
      
      // Delete from oldest to newest until under limit (skip the newest file which is current session)
      while (totalSize > maxTotalSizeBytes && remainingFiles.length > 1) {
        const oldestFile = remainingFiles.pop()!
        try {
          fs.unlinkSync(oldestFile.path)
          totalSize -= oldestFile.size
          console.log(`Deleted old log file (over total size limit of ${maxTotalSizeMb}MB): ${oldestFile.name}`)
        } catch (err) {
          console.error(`Failed to delete old log file ${oldestFile.name}:`, err)
        }
      }
    }
  } catch (err) {
    console.error('Failed to cleanup old log files:', err)
  }
}

function rotateLogFile() {
  try {
    // Close current log stream
    if (logStream) {
      logStream.end()
      logStream = null
    }
    
    const logsDir = path.join(app.getPath('userData'), 'logs')
    
    // Clean up old log files before creating new one
    cleanupOldLogFiles(logsDir)
    
    // Create new log file with current timestamp
    const newTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${newTimestamp}.log`)
    logStream = fs.createWriteStream(logFilePath, { flags: 'w' })
    currentLogSize = 0
    
    // Write continuation header
    const header = `${'='.repeat(60)}\nBluePLM Log (continued)\nRotated: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\n${'='.repeat(60)}\n\n`
    logStream.write(header)
    currentLogSize += Buffer.byteLength(header, 'utf8')
  } catch (err) {
    console.error('Failed to rotate log file:', err)
  }
}

function writeLog(level: LogEntry['level'], message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data
  }
  
  // Add to memory buffer
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift() // Remove oldest
  }
  
  // Format for file/console
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const logLine = `[${entry.timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`
  
  // Write to console
  if (level === 'error') {
    console.error(logLine.trim())
  } else if (level === 'warn') {
    console.warn(logLine.trim())
  } else {
    console.log(logLine.trim())
  }
  
  // Write to file
  if (logStream) {
    const lineBytes = Buffer.byteLength(logLine, 'utf8')
    
    // Check if we need to rotate before writing
    if (currentLogSize + lineBytes > LOG_MAX_SIZE()) {
      rotateLogFile()
    }
    
    logStream.write(logLine)
    currentLogSize += lineBytes
  }
}

// Prevent crashes from taking down the whole app
process.on('uncaughtException', (error) => {
  writeLog('error', 'Uncaught exception', { error: error.message, stack: error.stack })
})

process.on('unhandledRejection', (reason) => {
  writeLog('error', 'Unhandled rejection', { reason: String(reason) })
})

let mainWindow: BrowserWindow | null = null

// Local working directory for checked-out files
let workingDirectory: string | null = null
let fileWatcher: chokidar.FSWatcher | null = null

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Window state persistence
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
  } catch (err) {
    console.error('Failed to load window state:', err)
  }
  return { width: 1400, height: 900, isMaximized: false }
}

function saveWindowState() {
  if (!mainWindow) return
  
  try {
    const isMaximized = mainWindow.isMaximized()
    const bounds = mainWindow.getBounds()
    
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    }
    
    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('Failed to save window state:', err)
  }
}

// Convenience log functions (use new logging system)
const log = (message: string, data?: unknown) => {
  writeLog('info', `[Main] ${message}`, data)
}

const logDebug = (message: string, data?: unknown) => {
  writeLog('debug', `[Main] ${message}`, data)
}

const logError = (message: string, data?: unknown) => {
  writeLog('error', `[Main] ${message}`, data)
}

const logWarn = (message: string, data?: unknown) => {
  writeLog('warn', `[Main] ${message}`, data)
}

log('BluePLM starting...', { isDev, dirname: __dirname })

// Follow system dark/light mode for web content (like Google sign-in)
nativeTheme.themeSource = 'system'

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  log('Another instance is running, quitting...')
  app.quit()
} else {
  log('Got single instance lock')
}

function createWindow() {
  log('Creating BrowserWindow...')
  
  // Load saved window state
  const savedState = loadWindowState()
  
  // Validate window position is on a visible display
  let x = savedState.x
  let y = savedState.y
  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays()
    const isOnDisplay = displays.some(display => {
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
      color: '#181818',      // Default to dark theme - updated dynamically based on app theme
      symbolColor: '#cccccc',
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  // Set up permission handler for geolocation (needed for local weather feature)
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
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('maximize', saveWindowState)
  mainWindow.on('unmaximize', saveWindowState)

  let windowShown = false
  const showWindow = () => {
    if (!windowShown && mainWindow) {
      windowShown = true
      mainWindow.show()
    }
  }

  mainWindow.once('ready-to-show', showWindow)
  setTimeout(showWindow, 5000)

  mainWindow.webContents.on('crashed', () => log('Renderer process crashed!'))
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log('Failed to load:', errorCode, errorDescription)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    log('Page finished loading')
    // Send titlebar overlay rect to renderer
    if (mainWindow) {
      const overlayRect = mainWindow.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
      mainWindow.webContents.send('titlebar-overlay-rect', overlayRect)
    }
  })

  const loadPath = isDev 
    ? 'http://localhost:5173' 
    : path.join(__dirname, '../dist/index.html')
  
  log('Loading:', loadPath)
  
  if (isDev) {
    mainWindow.loadURL(loadPath)
  } else {
    mainWindow.loadFile(loadPath).catch(err => log('Error loading file:', err))
  }

  // In production, intercept OAuth redirects to localhost and reload the app with auth tokens
  if (!isDev) {
    mainWindow.webContents.on('will-navigate', (event, navUrl) => {
      if (navUrl.startsWith('http://localhost') && navUrl.includes('access_token')) {
        log('Intercepting OAuth redirect in main window:', navUrl.substring(0, 80) + '...')
        event.preventDefault()
        
        // Extract hash/query from the redirect URL
        const url = new URL(navUrl)
        const hashFragment = url.hash || ''
        const queryString = url.search || ''
        
        // Load the production HTML file with the auth tokens in hash
        const prodPath = path.join(__dirname, '../dist/index.html')
        const normalizedPath = prodPath.replace(/\\/g, '/')
        const fileUrl = `file:///${normalizedPath}${queryString}${hashFragment}`
        log('Reloading with file URL:', fileUrl.substring(0, 100) + '...')
        
        mainWindow?.loadURL(fileUrl)
      }
    })
  }

  // Keep track of Google auth windows to prevent garbage collection
  let googleAuthWindow: BrowserWindow | null = null
  
  // Handle popup windows from iframes (like Google sign-in)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log('[Window] Popup requested:', url.substring(0, 100))
    
    // Google auth URLs should open in an Electron window to keep session cookies in Electron
    const isGoogleAuth = url.includes('accounts.google.com') || 
                         url.includes('google.com/o/oauth2') ||
                         url.includes('google.com/signin')
    
    if (isGoogleAuth) {
      log('[Window] Opening Google auth in Electron window')
      
      // Close existing auth window if any
      if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
        googleAuthWindow.close()
      }
      
      // Create a popup window for Google sign-in - uses same session as main window
      googleAuthWindow = new BrowserWindow({
        width: 500,
        height: 700,
        parent: mainWindow || undefined,
        modal: false,
        show: true,
        title: 'Sign in to Google',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })
      
      googleAuthWindow.loadURL(url)
      
      // Auto-close when sign-in completes (navigates to actual Google Docs/Drive content)
      googleAuthWindow.webContents.on('did-navigate', (_, navUrl) => {
        log('[Window] Auth window navigated to:', navUrl.substring(0, 80))
        
        // Check if we've landed on actual document/drive content (sign-in complete)
        const isDocumentUrl = 
          navUrl.includes('docs.google.com/document/d/') ||
          navUrl.includes('docs.google.com/spreadsheets/d/') ||
          navUrl.includes('docs.google.com/presentation/d/') ||
          navUrl.includes('docs.google.com/forms/d/') ||
          navUrl.includes('drive.google.com/file/d/')
        
        if (isDocumentUrl) {
          log('[Window] Sign-in complete, closing auth window and refreshing main view')
          if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
            googleAuthWindow.close()
          }
        }
      })
      
      // When window closes (auto or manual), refresh the iframe
      googleAuthWindow.on('closed', () => {
        log('[Window] Google auth window closed')
        googleAuthWindow = null
        mainWindow?.webContents.send('gdrive:session-authenticated')
      })
      
      return { action: 'deny' }
    }
    
    // All other URLs open in external browser
    log('[Window] Opening in external browser:', url.substring(0, 80))
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  createAppMenu()
}

function createAppMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Set Working Directory...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:set-working-dir')
        },
        { type: 'separator' },
        {
          label: 'Add Files...',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('menu:add-files')
        },
        {
          label: 'Add Folder...',
          click: () => mainWindow?.webContents.send('menu:add-folder')
        },
        { type: 'separator' },
        {
          label: 'Check Out Selected',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:checkout')
        },
        {
          label: 'Check In Selected',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.send('menu:checkin')
        },
        { type: 'separator' },
        {
          label: 'Refresh',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('menu:refresh')
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          role: 'selectAll'
        },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:find')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar')
        },
        {
          label: 'Toggle Details Panel',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.send('menu:toggle-details')
        },
        { type: 'separator' },
        { 
          label: 'Zoom In', 
          accelerator: 'CmdOrCtrl+=', 
          click: () => {
            if (!mainWindow) return
            const current = mainWindow.webContents.getZoomFactor()
            const newZoom = Math.min(2.0, current + 0.1)
            mainWindow.webContents.setZoomFactor(newZoom)
            mainWindow.webContents.send('zoom-changed', newZoom)
          }
        },
        { 
          label: 'Zoom Out', 
          accelerator: 'CmdOrCtrl+-', 
          click: () => {
            if (!mainWindow) return
            const current = mainWindow.webContents.getZoomFactor()
            const newZoom = Math.max(0.5, current - 0.1)
            mainWindow.webContents.setZoomFactor(newZoom)
            mainWindow.webContents.send('zoom-changed', newZoom)
          }
        },
        { 
          label: 'Reset Zoom', 
          accelerator: 'CmdOrCtrl+0', 
          click: () => {
            if (!mainWindow) return
            mainWindow.webContents.setZoomFactor(1)
            mainWindow.webContents.send('zoom-changed', 1)
          }
        },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          role: 'toggleDevTools'
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About BluePLM',
          click: () => mainWindow?.webContents.send('menu:about')
        }
      ]
    }
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: 'About BluePLM', role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services' },
        { type: 'separator' },
        { label: 'Hide', accelerator: 'Cmd+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Cmd+Alt+H', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ============================================
// IPC Handlers - OAuth via System Browser
// ============================================

// Active OAuth server (only one at a time)
let activeOAuthServer: http.Server | null = null
let oauthTimeout: NodeJS.Timeout | null = null

// Clean up any active OAuth flow
function cleanupOAuthServer() {
  if (oauthTimeout) {
    clearTimeout(oauthTimeout)
    oauthTimeout = null
  }
  if (activeOAuthServer) {
    try {
      activeOAuthServer.close()
    } catch (e) {
      // Ignore close errors
    }
    activeOAuthServer = null
  }
}

ipcMain.handle('auth:open-oauth-window', async (_, url: string) => {
  return new Promise((resolve) => {
    // Clean up any previous OAuth flow
    cleanupOAuthServer()
    
    log('[OAuth] Starting system browser OAuth flow')
    
    // Track if we've resolved the promise
    let hasResolved = false
    const safeResolve = (result: { success: boolean; canceled?: boolean; error?: string }) => {
      if (!hasResolved) {
        hasResolved = true
        cleanupOAuthServer()
        resolve(result)
      }
    }
    
    // Create a local HTTP server to receive the OAuth callback
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://localhost`)
      
      log('[OAuth] Received callback request:', reqUrl.pathname, { search: reqUrl.search?.substring(0, 50) })
      
      // Handle the OAuth callback
      if (reqUrl.pathname === '/auth/callback' || reqUrl.pathname === '/') {
        // Check for tokens in query params first (some OAuth flows use this)
        const accessToken = reqUrl.searchParams.get('access_token')
        const refreshToken = reqUrl.searchParams.get('refresh_token')
        const expiresIn = reqUrl.searchParams.get('expires_in')
        const expiresAt = reqUrl.searchParams.get('expires_at')
        
        // Check for OAuth errors
        const error = reqUrl.searchParams.get('error')
        const errorDescription = reqUrl.searchParams.get('error_description')
        
        if (error) {
          log('[OAuth] OAuth error in callback:', error, errorDescription)
          const errorHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Sign In Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #0a1929 0%, #1a365d 100%);
      color: #e3f2fd;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      max-width: 400px;
    }
    .error-icon {
      width: 80px;
      height: 80px;
      margin-bottom: 20px;
    }
    h1 { margin: 0 0 10px 0; font-weight: 500; color: #f44336; }
    p { margin: 0; opacity: 0.8; }
  </style>
</head>
<body>
  <div class="container">
    <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M15 9l-6 6M9 9l6 6"/>
    </svg>
    <h1>Sign In Failed</h1>
    <p>${errorDescription || error || 'An error occurred during sign in.'}</p>
    <p style="margin-top: 16px; font-size: 12px;">You can close this window and try again.</p>
  </div>
  <script>setTimeout(() => window.close(), 5000);</script>
</body>
</html>`
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(errorHtml)
          safeResolve({ success: false, error: errorDescription || error || 'OAuth error' })
          return
        }
        
        // If we have tokens directly in query params, process them immediately
        if (accessToken && refreshToken) {
          log('[OAuth] Tokens received in query params, sending to renderer')
          
          const successHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Sign In Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #0a1929 0%, #1a365d 100%);
      color: #e3f2fd;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    .checkmark {
      width: 80px;
      height: 80px;
      margin-bottom: 20px;
    }
    h1 { margin: 0 0 10px 0; font-weight: 500; }
    p { margin: 0; opacity: 0.8; }
  </style>
</head>
<body>
  <div class="container">
    <svg class="checkmark" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 12l3 3 5-6"/>
    </svg>
    <h1>Sign In Successful!</h1>
    <p>You can close this window and return to BluePLM.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(successHtml)
          
          mainWindow?.webContents.send('auth:set-session', {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn ? parseInt(expiresIn) : 3600,
            expires_at: expiresAt ? parseInt(expiresAt) : undefined
          })
          
          // Focus the main window
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
          }
          
          safeResolve({ success: true })
          return
        }
        
        // No tokens in query - tokens are likely in hash fragment (client-side only)
        // Send HTML page that extracts tokens from hash and forwards them
        log('[OAuth] No tokens in query params, serving hash extraction page')
        const hashExtractHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Completing Sign In...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #0a1929 0%, #1a365d 100%);
      color: #e3f2fd;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      max-width: 400px;
    }
    .spinner {
      width: 60px;
      height: 60px;
      border: 4px solid rgba(255,255,255,0.2);
      border-top-color: #4caf50;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .checkmark {
      width: 80px;
      height: 80px;
      margin-bottom: 20px;
      display: none;
    }
    .error-icon {
      width: 80px;
      height: 80px;
      margin-bottom: 20px;
      display: none;
    }
    h1 { margin: 0 0 10px 0; font-weight: 500; }
    p { margin: 0; opacity: 0.8; }
    .status { transition: opacity 0.3s; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div id="loading" class="status">
      <div class="spinner"></div>
      <h1>Completing Sign In...</h1>
      <p>Please wait a moment.</p>
    </div>
    <div id="success" class="status hidden">
      <svg class="checkmark" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2" style="display:block;margin:0 auto 20px;">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12l3 3 5-6"/>
      </svg>
      <h1>Sign In Successful!</h1>
      <p>You can close this window and return to BluePLM.</p>
    </div>
    <div id="error" class="status hidden">
      <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2" style="display:block;margin:0 auto 20px;">
        <circle cx="12" cy="12" r="10"/>
        <path d="M15 9l-6 6M9 9l6 6"/>
      </svg>
      <h1 style="color:#f44336;">Sign In Issue</h1>
      <p id="errorMsg">Could not complete sign in. Please try again.</p>
    </div>
  </div>
  <script>
    (async function() {
      const showSuccess = () => {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('success').classList.remove('hidden');
        setTimeout(() => window.close(), 2000);
      };
      
      const showError = (msg) => {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('error').classList.remove('hidden');
        if (msg) document.getElementById('errorMsg').textContent = msg;
        setTimeout(() => window.close(), 5000);
      };
      
      try {
        // Extract tokens from hash fragment
        const hash = window.location.hash.substring(1);
        console.log('[OAuth] Hash length:', hash.length);
        
        if (!hash) {
          console.log('[OAuth] No hash fragment found');
          showError('No authentication data received. Please try signing in again.');
          return;
        }
        
        const params = new URLSearchParams(hash);
        
        // Check for errors in hash
        const error = params.get('error');
        const errorDescription = params.get('error_description');
        if (error) {
          console.log('[OAuth] Error in hash:', error, errorDescription);
          showError(errorDescription || error);
          return;
        }
        
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        
        if (!accessToken) {
          console.log('[OAuth] No access_token in hash');
          showError('No access token received. Please try signing in again.');
          return;
        }
        
        if (!refreshToken) {
          console.log('[OAuth] No refresh_token in hash');
          showError('No refresh token received. Please try signing in again.');
          return;
        }
        
        console.log('[OAuth] Forwarding tokens to server...');
        
        // Forward tokens to the server with retry logic
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
          attempts++;
          try {
            const response = await fetch('/auth/tokens?' + hash, {
              method: 'GET',
              cache: 'no-cache'
            });
            
            if (response.ok) {
              console.log('[OAuth] Tokens forwarded successfully');
              showSuccess();
              return;
            } else {
              console.log('[OAuth] Server returned error:', response.status);
              if (attempts >= maxAttempts) {
                showError('Server error. Please try again.');
              }
            }
          } catch (fetchErr) {
            console.log('[OAuth] Fetch error (attempt ' + attempts + '):', fetchErr);
            if (attempts >= maxAttempts) {
              showError('Could not connect to app. Please try again.');
            }
            // Wait before retry
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } catch (err) {
        console.error('[OAuth] Exception:', err);
        showError('An unexpected error occurred. Please try again.');
      }
    })();
  </script>
</body>
</html>`
        
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(hashExtractHtml)
        return
      }
      
      // Handle the token forwarding request from hash extraction page
      if (reqUrl.pathname === '/auth/tokens') {
        const accessToken = reqUrl.searchParams.get('access_token')
        const refreshToken = reqUrl.searchParams.get('refresh_token')
        const expiresIn = reqUrl.searchParams.get('expires_in')
        const expiresAt = reqUrl.searchParams.get('expires_at')
        
        log('[OAuth] /auth/tokens request received', { 
          hasAccessToken: !!accessToken, 
          hasRefreshToken: !!refreshToken 
        })
        
        if (accessToken && refreshToken) {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('OK')
          
          log('[OAuth] Tokens received from hash fragment, sending to renderer')
          mainWindow?.webContents.send('auth:set-session', {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn ? parseInt(expiresIn) : 3600,
            expires_at: expiresAt ? parseInt(expiresAt) : undefined
          })
          
          // Focus the main window
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
          }
          
          safeResolve({ success: true })
        } else {
          log('[OAuth] /auth/tokens request missing tokens')
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing tokens')
        }
        return
      }
      
      // Unknown path - redirect to callback
      log('[OAuth] Unknown path, redirecting to /auth/callback')
      res.writeHead(302, { 'Location': '/auth/callback' + (reqUrl.search || '') })
      res.end()
    })
    
    // Listen on a random available port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      const port = address.port
      const callbackUrl = `http://127.0.0.1:${port}/auth/callback`
      
      log('[OAuth] Local callback server started on port', port)
      
      activeOAuthServer = server
      
      // Modify the OAuth URL to use our local callback
      // Supabase uses 'redirect_to' parameter for the final redirect destination
      try {
        const oauthUrl = new URL(url)
        oauthUrl.searchParams.set('redirect_to', callbackUrl)
        
        const finalUrl = oauthUrl.toString()
        log('[OAuth] Opening system browser with OAuth URL', { 
          port, 
          callbackUrl,
          urlPreview: finalUrl.substring(0, 100) + '...'
        })
        
        shell.openExternal(finalUrl)
        
        // Set a timeout for the OAuth flow (5 minutes)
        oauthTimeout = setTimeout(() => {
          log('[OAuth] Timeout waiting for OAuth callback')
          safeResolve({ success: false, error: 'OAuth timed out. Please try again.' })
        }, 5 * 60 * 1000)
        
      } catch (err) {
        log('[OAuth] Error parsing OAuth URL:', err)
        safeResolve({ success: false, error: String(err) })
      }
    })
    
    server.on('error', (err) => {
      log('[OAuth] Server error:', err)
      safeResolve({ success: false, error: String(err) })
    })
  })
})

// ============================================
// Google Drive OAuth Handler
// ============================================
// Note: For production use, you would need to configure your own Google Cloud credentials
// This implementation uses environment variables or a config file for credentials

// Default credentials from environment variables
const DEFAULT_GOOGLE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID || ''
const DEFAULT_GOOGLE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET || ''
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ')

// Accept credentials as parameter (from org settings) or fall back to env variables
ipcMain.handle('auth:google-drive', async (_, credentials?: { clientId?: string; clientSecret?: string }) => {
  return new Promise((resolve) => {
    log('[GoogleDrive] Starting OAuth flow')
    
    // Use provided credentials or fall back to environment variables
    const GOOGLE_CLIENT_ID = credentials?.clientId || DEFAULT_GOOGLE_CLIENT_ID
    const GOOGLE_CLIENT_SECRET = credentials?.clientSecret || DEFAULT_GOOGLE_CLIENT_SECRET
    
    // Check if credentials are configured
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      log('[GoogleDrive] OAuth credentials not configured')
      resolve({ 
        success: false, 
        error: 'Google Drive integration requires OAuth credentials. Ask your admin to configure Google Drive in Settings → REST API → Google Drive Integration.' 
      })
      return
    }
    
    log('[GoogleDrive] Using credentials:', { hasClientId: !!GOOGLE_CLIENT_ID, source: credentials?.clientId ? 'org' : 'env' })
    
    let hasResolved = false
    const safeResolve = (result: { success: boolean; accessToken?: string; refreshToken?: string; expiry?: number; error?: string }) => {
      if (!hasResolved) {
        hasResolved = true
        if (gdAuthServer) {
          gdAuthServer.close()
          gdAuthServer = null
        }
        resolve(result)
      }
    }
    
    // Create local server to receive the callback
    let gdAuthServer: http.Server | null = null
    
    gdAuthServer = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost')
      
      log('[GoogleDrive] Received callback:', reqUrl.pathname)
      
      if (reqUrl.pathname === '/auth/google-callback') {
        const code = reqUrl.searchParams.get('code')
        const error = reqUrl.searchParams.get('error')
        
        if (error) {
          log('[GoogleDrive] OAuth error:', error)
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Google Drive - Error</title></head>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e2e; color: #cdd6f4;">
                <div style="text-align: center; padding: 40px; background: #313244; border-radius: 16px;">
                  <h1 style="color: #f38ba8;">Authentication Failed</h1>
                  <p>Error: ${error}</p>
                  <p style="opacity: 0.7; margin-top: 20px;">You can close this window.</p>
                </div>
              </body>
            </html>
          `)
          safeResolve({ success: false, error })
          return
        }
        
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body>Missing authorization code</body></html>')
          safeResolve({ success: false, error: 'Missing authorization code' })
          return
        }
        
        // Exchange authorization code for tokens
        try {
          const port = (gdAuthServer?.address() as AddressInfo)?.port || 8090
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              redirect_uri: `http://localhost:${port}/auth/google-callback`,
              grant_type: 'authorization_code'
            }).toString()
          })
          
          const tokens = await tokenResponse.json() as { 
            access_token?: string
            refresh_token?: string
            expires_in?: number
            error?: string
            error_description?: string 
          }
          
          if (tokens.error) {
            log('[GoogleDrive] Token exchange error:', tokens.error)
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`
              <html>
                <head><title>Google Drive - Error</title></head>
                <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e2e; color: #cdd6f4;">
                  <div style="text-align: center; padding: 40px; background: #313244; border-radius: 16px;">
                    <h1 style="color: #f38ba8;">Authentication Failed</h1>
                    <p>${tokens.error_description || tokens.error}</p>
                    <p style="opacity: 0.7; margin-top: 20px;">You can close this window.</p>
                  </div>
                </body>
              </html>
            `)
            safeResolve({ success: false, error: tokens.error_description || tokens.error })
            return
          }
          
          log('[GoogleDrive] Token exchange successful')
          
          // Success page
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head><title>Google Drive - Connected</title></head>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1e1e2e; color: #cdd6f4;">
                <div style="text-align: center; padding: 40px; background: #313244; border-radius: 16px;">
                  <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #4285f4, #34a853, #fbbc05, #ea4335); border-radius: 50%; margin: 0 auto 20px;"></div>
                  <h1 style="color: #a6e3a1; margin: 0 0 10px;">Connected to Google Drive!</h1>
                  <p style="opacity: 0.7;">You can close this window and return to BluePLM.</p>
                </div>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `)
          
          safeResolve({
            success: true,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiry: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : undefined
          })
        } catch (err) {
          log('[GoogleDrive] Token exchange failed:', err)
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body>Failed to exchange authorization code</body></html>')
          safeResolve({ success: false, error: String(err) })
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    
    gdAuthServer.listen(0, '127.0.0.1', () => {
      const port = (gdAuthServer?.address() as AddressInfo)?.port
      log('[GoogleDrive] Callback server listening on port', port)
      
      // Build OAuth URL
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', `http://localhost:${port}/auth/google-callback`)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', GOOGLE_DRIVE_SCOPES)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      
      // Open in system browser
      log('[GoogleDrive] Opening auth URL in browser')
      shell.openExternal(authUrl.toString())
      
      // Timeout after 5 minutes
      setTimeout(() => {
        safeResolve({ success: false, error: 'Authentication timed out. Please try again.' })
      }, 5 * 60 * 1000)
    })
    
    gdAuthServer.on('error', (err) => {
      log('[GoogleDrive] Server error:', err)
      safeResolve({ success: false, error: String(err) })
    })
  })
})

// ============================================
// IPC Handlers - App Info
// ============================================
ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:get-platform', () => process.platform)
ipcMain.handle('app:get-app-version', () => app.getVersion())

// Machine identification for backup service
ipcMain.handle('app:get-machine-id', () => {
  // Use a combination of platform-specific identifiers for a stable machine ID
  // This ID should persist across app restarts but be unique per machine
  const os = require('os')
  const platform = process.platform
  const hostname = os.hostname()
  const cpus = os.cpus()
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown'
  
  // Create a hash of machine-specific info
  const machineString = `${platform}-${hostname}-${cpuModel}-${os.arch()}`
  const hash = crypto.createHash('sha256').update(machineString).digest('hex')
  return hash.substring(0, 16) // Return first 16 chars for readability
})

ipcMain.handle('app:get-machine-name', () => {
  const os = require('os')
  return os.hostname()
})

ipcMain.handle('app:get-titlebar-overlay-rect', () => {
  if (!mainWindow) return { x: 0, y: 0, width: 138, height: 38 }
  // getTitleBarOverlayRect is available in Electron 20+
  return mainWindow.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
})

ipcMain.handle('app:set-titlebar-overlay', (_event, options: { color: string; symbolColor: string }) => {
  if (!mainWindow) return { success: false, error: 'No window' }
  try {
    // setTitleBarOverlay is available for Windows when using titleBarStyle: 'hidden' with titleBarOverlay
    mainWindow.setTitleBarOverlay({
      color: options.color,
      symbolColor: options.symbolColor,
      height: 36
    })
    return { success: true }
  } catch (err) {
    log(`[Main] Failed to set titlebar overlay: ${err}`)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('app:reload', () => {
  log('[Main] Reload requested via CLI')
  if (mainWindow) {
    mainWindow.webContents.reload()
    return { success: true }
  }
  return { success: false, error: 'No window' }
})

// Performance monitor pop-out window
let performanceWindow: BrowserWindow | null = null

ipcMain.handle('app:open-performance-window', () => {
  log('[Main] Opening performance monitor window')
  
  // If window already exists, focus it
  if (performanceWindow && !performanceWindow.isDestroyed()) {
    performanceWindow.focus()
    return { success: true }
  }
  
  // Create new performance window
  performanceWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#0a1929',
    title: 'Performance Monitor - BluePLM',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#181818',
      symbolColor: '#cccccc',
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  
  // Load the app with performance mode query param
  const loadPath = isDev 
    ? 'http://localhost:5173?mode=performance' 
    : path.join(__dirname, '../dist/index.html')
  
  if (isDev) {
    performanceWindow.loadURL(loadPath)
  } else {
    performanceWindow.loadFile(loadPath.replace('?mode=performance', ''), { query: { mode: 'performance' } })
  }
  
  performanceWindow.on('closed', () => {
    performanceWindow = null
  })
  
  return { success: true }
})

// Zoom level handlers
ipcMain.handle('app:get-zoom-factor', () => {
  if (!mainWindow) return 1
  return mainWindow.webContents.getZoomFactor()
})

ipcMain.handle('app:set-zoom-factor', (_event, factor: number) => {
  if (!mainWindow) return { success: false, error: 'No window' }
  // Clamp zoom factor between 0.5 (50%) and 2.0 (200%)
  const clampedFactor = Math.max(0.5, Math.min(2.0, factor))
  mainWindow.webContents.setZoomFactor(clampedFactor)
  return { success: true, factor: clampedFactor }
})

// Window size handlers (for dev tools responsive testing)
ipcMain.handle('app:get-window-size', () => {
  if (!mainWindow) return null
  const [width, height] = mainWindow.getSize()
  return { width, height }
})

ipcMain.handle('app:set-window-size', (_event, width: number, height: number) => {
  if (!mainWindow) return { success: false, error: 'No window' }
  try {
    // Unmaximize if maximized to allow resize
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }
    // Set the content size (inner window dimensions)
    mainWindow.setContentSize(width, height)
    log(`[Main] Window resized to ${width}x${height}`)
    return { success: true }
  } catch (err) {
    log('error', '[Main] Failed to resize window', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

ipcMain.handle('app:reset-window-size', () => {
  if (!mainWindow) return { success: false, error: 'No window' }
  try {
    // Reset to default size (1200x800)
    const defaultWidth = 1200
    const defaultHeight = 800
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }
    mainWindow.setSize(defaultWidth, defaultHeight)
    mainWindow.center()
    const [width, height] = mainWindow.getSize()
    log(`[Main] Window reset to default size: ${width}x${height}`)
    return { success: true, size: { width, height } }
  } catch (err) {
    log('error', '[Main] Failed to reset window size', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
})

// ============================================
// IPC Handlers - System Stats
// ============================================

// Cache for network stats to calculate deltas
let lastNetworkStats: { rx: number; tx: number; time: number } | null = null

ipcMain.handle('system:get-stats', async () => {
  try {
    // Get all stats in parallel for efficiency
    const [cpu, mem, netStats, fsSize] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(),
      si.fsSize()
    ])
    
    // Calculate network speed (bytes/sec)
    const totalRx = netStats.reduce((sum, iface) => sum + iface.rx_bytes, 0)
    const totalTx = netStats.reduce((sum, iface) => sum + iface.tx_bytes, 0)
    const now = Date.now()
    
    let rxSpeed = 0
    let txSpeed = 0
    
    if (lastNetworkStats) {
      const timeDelta = (now - lastNetworkStats.time) / 1000 // seconds
      if (timeDelta > 0) {
        rxSpeed = (totalRx - lastNetworkStats.rx) / timeDelta
        txSpeed = (totalTx - lastNetworkStats.tx) / timeDelta
      }
    }
    
    lastNetworkStats = { rx: totalRx, tx: totalTx, time: now }
    
    // Sum up disk usage across all mounted drives
    const totalDiskSize = fsSize.reduce((sum, disk) => sum + disk.size, 0)
    const totalDiskUsed = fsSize.reduce((sum, disk) => sum + disk.used, 0)
    
    // Get app memory usage (all Electron processes)
    const appMemory = process.memoryUsage()
    const heapUsed = appMemory.heapUsed
    const heapTotal = appMemory.heapTotal
    const rss = appMemory.rss // Resident Set Size - total memory allocated
    
    return {
      cpu: {
        usage: Math.round(cpu.currentLoad),
        cores: cpu.cpus.map(c => Math.round(c.load))
      },
      memory: {
        used: mem.used,
        total: mem.total,
        percent: Math.round((mem.used / mem.total) * 100)
      },
      network: {
        rxSpeed: Math.round(rxSpeed),
        txSpeed: Math.round(txSpeed)
      },
      disk: {
        used: totalDiskUsed,
        total: totalDiskSize,
        percent: totalDiskSize > 0 ? Math.round((totalDiskUsed / totalDiskSize) * 100) : 0
      },
      app: {
        heapUsed,
        heapTotal,
        rss
      }
    }
  } catch (err) {
    log('error', '[System] Failed to get system stats', err)
    return null
  }
})

// ============================================
// IPC Handlers - Logging
// ============================================
ipcMain.handle('logs:get-entries', () => {
  return logBuffer
})

ipcMain.handle('logs:get-path', () => {
  return logFilePath
})

ipcMain.handle('logs:export', async () => {
  try {
    // Export current session logs from memory buffer
    let sessionLogs = `BluePLM Session Logs\nExported: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\nPlatform: ${process.platform} ${process.arch}\nEntries: ${logBuffer.length}\n${'='.repeat(60)}\n\n`
    
    // Format each log entry
    for (const entry of logBuffer) {
      const dataStr = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : ''
      sessionLogs += `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${dataStr}\n`
    }
    
    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Session Logs',
      defaultPath: `blueplm-session-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'Log Files', extensions: ['log'] }
      ]
    })
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }
    
    fs.writeFileSync(result.filePath, sessionLogs)
    log('Logs exported to: ' + result.filePath)
    
    return { success: true, path: result.filePath }
  } catch (err) {
    logError('Failed to export logs', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('logs:get-dir', () => {
  return path.join(app.getPath('userData'), 'logs')
})

// Get crash dumps directory
ipcMain.handle('logs:get-crashes-dir', () => {
  try {
    return app.getPath('crashDumps')
  } catch {
    return null
  }
})

// List crash dump files
ipcMain.handle('logs:list-crashes', async () => {
  try {
    let crashesDir: string
    try {
      crashesDir = app.getPath('crashDumps')
    } catch {
      return { success: true, files: [] }
    }
    
    if (!fs.existsSync(crashesDir)) {
      return { success: true, files: [] }
    }
    
    // Recursively find all .dmp files
    const findDmpFiles = (dir: string): Array<{ name: string; path: string; size: number; modifiedTime: string }> => {
      const results: Array<{ name: string; path: string; size: number; modifiedTime: string }> = []
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            results.push(...findDmpFiles(fullPath))
          } else if (entry.name.endsWith('.dmp') || entry.name.endsWith('.txt')) {
            const stats = fs.statSync(fullPath)
            results.push({
              name: entry.name,
              path: fullPath,
              size: stats.size,
              modifiedTime: stats.mtime.toISOString()
            })
          }
        }
      } catch {
        // Ignore errors reading subdirectories
      }
      
      return results
    }
    
    const files = findDmpFiles(crashesDir)
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    
    return { success: true, files }
  } catch (err) {
    logError('Failed to list crash files', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// Read crash dump metadata (for .txt files that contain crash info)
ipcMain.handle('logs:read-crash', async (_, filePath: string) => {
  try {
    let crashesDir: string
    try {
      crashesDir = app.getPath('crashDumps')
    } catch {
      return { success: false, error: 'Crash dumps not available' }
    }
    
    const normalizedPath = path.normalize(filePath)
    if (!normalizedPath.startsWith(crashesDir)) {
      return { success: false, error: 'Access denied: file is not in crashes directory' }
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }
    
    // Only read .txt files (crash metadata), not .dmp files (binary)
    if (filePath.endsWith('.txt')) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } else {
      // For .dmp files, return basic info
      const stats = fs.statSync(filePath)
      return { 
        success: true, 
        content: `Binary crash dump file\nSize: ${(stats.size / 1024).toFixed(1)} KB\nCreated: ${stats.mtime.toISOString()}\n\nThis file can be analyzed with debugging tools.`
      }
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Open crashes directory
ipcMain.handle('logs:open-crashes-dir', async () => {
  try {
    let crashesDir: string
    try {
      crashesDir = app.getPath('crashDumps')
    } catch {
      return { success: false, error: 'Crash dumps not available' }
    }
    
    if (!fs.existsSync(crashesDir)) {
      fs.mkdirSync(crashesDir, { recursive: true })
    }
    
    shell.openPath(crashesDir)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('logs:list-files', async () => {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) {
      return { success: true, files: [] }
    }
    
    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .map(filename => {
        const filePath = path.join(logsDir, filename)
        const stats = fs.statSync(filePath)
        return {
          name: filename,
          path: filePath,
          size: stats.size,
          modifiedTime: stats.mtime.toISOString(),
          isCurrentSession: logFilePath ? path.normalize(filePath) === path.normalize(logFilePath) : false
        }
      })
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    
    return { success: true, files }
  } catch (err) {
    logError('Failed to list log files', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('logs:read-file', async (_, filePath: string) => {
  try {
    // Security check: ensure file is in logs directory
    const logsDir = path.join(app.getPath('userData'), 'logs')
    const normalizedPath = path.normalize(filePath)
    if (!normalizedPath.startsWith(logsDir)) {
      return { success: false, error: 'Access denied: file is not in logs directory' }
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }
    
    const content = fs.readFileSync(filePath, 'utf-8')
    return { success: true, content }
  } catch (err) {
    logError('Failed to read log file', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('logs:open-dir', async () => {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    await shell.openPath(logsDir)
    return { success: true }
  } catch (err) {
    logError('Failed to open logs directory', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('logs:delete-file', async (_, filePath: string) => {
  try {
    // Security check: ensure file is in logs directory
    const logsDir = path.join(app.getPath('userData'), 'logs')
    const normalizedPath = path.normalize(filePath)
    if (!normalizedPath.startsWith(logsDir)) {
      return { success: false, error: 'Access denied: file is not in logs directory' }
    }
    
    // Don't allow deleting current session log
    if (normalizedPath === logFilePath) {
      return { success: false, error: 'Cannot delete current session log' }
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' }
    }
    
    fs.unlinkSync(filePath)
    log('Deleted log file: ' + filePath)
    return { success: true }
  } catch (err) {
    logError('Failed to delete log file', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// Clean up old logs manually based on current retention settings
ipcMain.handle('logs:cleanup-old', async () => {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) {
      return { success: true, deleted: 0 }
    }
    
    const { maxFiles, maxAgeDays, maxTotalSizeMb } = logRetentionSettings
    const now = Date.now()
    const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0
    const maxTotalSizeBytes = maxTotalSizeMb > 0 ? maxTotalSizeMb * 1024 * 1024 : 0
    let deletedCount = 0
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
      .map(filename => {
        const filePath = path.join(logsDir, filename)
        const stats = fs.statSync(filePath)
        return {
          name: filename,
          path: filePath,
          mtime: stats.mtime.getTime(),
          size: stats.size
        }
      })
      .sort((a, b) => b.mtime - a.mtime) // Sort newest first
    
    // Delete files older than maxAgeDays (if age limit is set)
    if (maxAgeDays > 0) {
      for (const file of logFiles) {
        const age = now - file.mtime
        // Don't delete current session log
        if (age > maxAgeMs && path.normalize(file.path) !== logFilePath) {
          try {
            fs.unlinkSync(file.path)
            deletedCount++
            log(`Deleted old log file (>${maxAgeDays} days): ${file.name}`)
          } catch (err) {
            logError(`Failed to delete log file ${file.name}`, { error: String(err) })
          }
        }
      }
    }
    
    // Re-read remaining files with sizes
    let remainingFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
      .map(filename => {
        const filePath = path.join(logsDir, filename)
        const stats = fs.statSync(filePath)
        return {
          name: filename,
          path: filePath,
          mtime: stats.mtime.getTime(),
          size: stats.size
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
    
    // Apply file count limit (if file limit is set)
    if (maxFiles > 0 && remainingFiles.length > maxFiles) {
      const filesToDelete = remainingFiles.slice(maxFiles)
      for (const file of filesToDelete) {
        if (path.normalize(file.path) !== logFilePath) {
          try {
            fs.unlinkSync(file.path)
            deletedCount++
            log(`Deleted old log file (over limit of ${maxFiles}): ${file.name}`)
          } catch (err) {
            logError(`Failed to delete log file ${file.name}`, { error: String(err) })
          }
        }
      }
      remainingFiles = remainingFiles.slice(0, maxFiles)
    }
    
    // Apply total size limit (if size limit is set)
    if (maxTotalSizeBytes > 0) {
      let totalSize = remainingFiles.reduce((sum, f) => sum + f.size, 0)
      
      // Delete from oldest to newest until under limit (skip current session)
      while (totalSize > maxTotalSizeBytes && remainingFiles.length > 1) {
        const oldestFile = remainingFiles[remainingFiles.length - 1]
        if (path.normalize(oldestFile.path) !== logFilePath) {
          try {
            fs.unlinkSync(oldestFile.path)
            totalSize -= oldestFile.size
            deletedCount++
            log(`Deleted old log file (over total size limit of ${maxTotalSizeMb}MB): ${oldestFile.name}`)
          } catch (err) {
            logError(`Failed to delete log file ${oldestFile.name}`, { error: String(err) })
          }
        }
        remainingFiles.pop()
      }
    }
    
    log(`Log cleanup completed, deleted ${deletedCount} files`)
    return { success: true, deleted: deletedCount }
  } catch (err) {
    logError('Failed to cleanup old logs', { error: String(err) })
    return { success: false, error: String(err), deleted: 0 }
  }
})

// Get log retention settings
ipcMain.handle('logs:get-retention-settings', () => {
  return {
    success: true,
    settings: logRetentionSettings,
    defaults: DEFAULT_LOG_RETENTION
  }
})

// Set log retention settings
ipcMain.handle('logs:set-retention-settings', async (_, settings: Partial<LogRetentionSettings>) => {
  try {
    // Validate settings
    const newSettings: LogRetentionSettings = {
      maxFiles: Math.max(0, Math.floor(settings.maxFiles ?? logRetentionSettings.maxFiles)),
      maxAgeDays: Math.max(0, Math.floor(settings.maxAgeDays ?? logRetentionSettings.maxAgeDays)),
      maxSizeMb: Math.max(1, Math.floor(settings.maxSizeMb ?? logRetentionSettings.maxSizeMb)),
      maxTotalSizeMb: Math.max(0, Math.floor(settings.maxTotalSizeMb ?? logRetentionSettings.maxTotalSizeMb))
    }
    
    const saved = saveLogRetentionSettings(newSettings)
    if (saved) {
      log('Log retention settings updated', newSettings)
      
      // Apply cleanup with new settings immediately
      const logsDir = path.join(app.getPath('userData'), 'logs')
      if (fs.existsSync(logsDir)) {
        cleanupOldLogFiles(logsDir)
      }
      
      return { success: true, settings: logRetentionSettings }
    } else {
      return { success: false, error: 'Failed to save settings' }
    }
  } catch (err) {
    logError('Failed to set log retention settings', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// Get total log storage size
ipcMain.handle('logs:get-storage-info', async () => {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) {
      return { success: true, totalSize: 0, fileCount: 0 }
    }
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
    
    let totalSize = 0
    for (const filename of logFiles) {
      try {
        const stats = fs.statSync(path.join(logsDir, filename))
        totalSize += stats.size
      } catch {
        // Ignore files we can't stat
      }
    }
    
    return {
      success: true,
      totalSize,
      fileCount: logFiles.length,
      logsDir
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Log from renderer process
ipcMain.on('logs:write', (_, level: string, message: string, data?: unknown) => {
  const validLevel = ['info', 'warn', 'error', 'debug'].includes(level) ? level as LogEntry['level'] : 'info'
  writeLog(validLevel, `[Renderer] ${message}`, data)
})

// ============================================
// IPC Handlers - Window Controls
// ============================================
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized())

// ============================================
// IPC Handlers - Working Directory
// ============================================
ipcMain.handle('working-dir:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Working Directory',
    properties: ['openDirectory', 'createDirectory']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    workingDirectory = result.filePaths[0]
    hashCache.clear() // Clear hash cache when changing working directory
    log('Working directory set:', workingDirectory)
    startFileWatcher(workingDirectory)
    return { success: true, path: workingDirectory }
  }
  return { success: false, canceled: true }
})

ipcMain.handle('working-dir:get', () => workingDirectory)

ipcMain.handle('working-dir:clear', () => {
  log('Clearing working directory and stopping file watcher')
  stopFileWatcher()
  workingDirectory = null
  hashCache.clear() // Clear hash cache
  return { success: true }
})

ipcMain.handle('working-dir:set', async (_, newPath: string) => {
  if (fs.existsSync(newPath)) {
    workingDirectory = newPath
    hashCache.clear() // Clear hash cache when changing working directory
    startFileWatcher(newPath)
    return { success: true, path: workingDirectory }
  }
  return { success: false, error: 'Path does not exist' }
})

ipcMain.handle('working-dir:create', async (_, newPath: string) => {
  try {
    // Expand ~ to home directory on macOS/Linux
    let expandedPath = newPath
    if (newPath.startsWith('~')) {
      const homedir = require('os').homedir()
      expandedPath = newPath.replace(/^~/, homedir)
    }
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(expandedPath)) {
      fs.mkdirSync(expandedPath, { recursive: true })
      log('Created working directory:', expandedPath)
    }
    workingDirectory = expandedPath
    hashCache.clear() // Clear hash cache when changing working directory
    startFileWatcher(expandedPath)
    return { success: true, path: workingDirectory }
  } catch (err) {
    log('Error creating working directory:', err)
    return { success: false, error: String(err) }
  }
})

// Stop file watcher
function stopFileWatcher() {
  if (fileWatcher) {
    log('Stopping file watcher')
    fileWatcher.close()
    fileWatcher = null
  }
}

// File watcher for detecting external changes
function startFileWatcher(dirPath: string) {
  // Close existing watcher if any
  stopFileWatcher()
  
  log('Starting file watcher for:', dirPath)
  
  // Debounce timer for batching changes
  let debounceTimer: NodeJS.Timeout | null = null
  const changedFiles = new Set<string>()
  
  fileWatcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,  // Use native fs events (faster, but may need polling on network drives)
    awaitWriteFinish: {
      stabilityThreshold: 1000,  // Wait for file to be stable for 1 second
      pollInterval: 100
    },
    ignorePermissionErrors: true,  // Ignore EPERM errors
    ignored: [
      /(^|[\/\\])\../,  // Ignore dotfiles
      /node_modules/,
      /\.git/,
      /desktop\.ini/i,  // Windows system files
      /thumbs\.db/i,
      /\$RECYCLE\.BIN/i,
      /System Volume Information/i,
      /~\$/,  // Ignore Office temp files
      /\.tmp$/i,
      /\.swp$/i
    ]
  })
  
  const notifyChanges = () => {
    if (changedFiles.size > 0 && mainWindow) {
      const files = Array.from(changedFiles)
      changedFiles.clear()
      log('File changes detected:', files.length, 'files')
      mainWindow.webContents.send('files-changed', files)
    }
    debounceTimer = null
  }
  
  fileWatcher.on('change', (filePath) => {
    const relativePath = path.relative(dirPath, filePath).replace(/\\/g, '/')
    changedFiles.add(relativePath)
    
    // Debounce to batch rapid changes
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    // Use longer debounce when many files are changing (bulk operations)
    const delay = changedFiles.size > 10 ? 2000 : 1000
    debounceTimer = setTimeout(notifyChanges, delay)
  })
  
  fileWatcher.on('add', (filePath) => {
    const relativePath = path.relative(dirPath, filePath).replace(/\\/g, '/')
    changedFiles.add(relativePath)
    
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    // Use longer debounce when many files are changing (bulk operations)
    const delay = changedFiles.size > 10 ? 2000 : 1000
    debounceTimer = setTimeout(notifyChanges, delay)
  })
  
  fileWatcher.on('unlink', (filePath) => {
    const relativePath = path.relative(dirPath, filePath).replace(/\\/g, '/')
    changedFiles.add(relativePath)
    
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    // Use longer debounce when many files are changing (bulk operations)
    const delay = changedFiles.size > 10 ? 2000 : 1000
    debounceTimer = setTimeout(notifyChanges, delay)
  })
  
  fileWatcher.on('error', (error: NodeJS.ErrnoException) => {
    // Ignore EPERM errors (permission denied) - common on Windows for system files
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      return
    }
    log('File watcher error:', error)
  })
}

// ============================================
// IPC Handlers - Local File Operations
// ============================================

// Calculate SHA-256 hash of a file
function hashFileSync(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

// Get file info
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
    
    // Ensure directory exists
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
    
    // Check write permission
    try {
      fs.accessSync(dir, fs.constants.W_OK)
    } catch (accessErr) {
      logError('No write permission', { dir, filePath })
      return { success: false, error: `No write permission to directory: ${dir}` }
    }
    
    // Write the file
    fs.writeFileSync(filePath, buffer)
    
    // Calculate hash of written file
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

// Download file directly in main process (bypasses IPC for large files)
ipcMain.handle('fs:download-url', async (event, url: string, destPath: string) => {
  const operationId = `dl-${Date.now()}`
  const startTime = Date.now()
  
  logDebug(`[${operationId}] Starting download`, {
    destPath,
    urlLength: url?.length,
    urlPrefix: url?.substring(0, 80) + '...'
  })
  
  try {
    // Validate inputs
    if (!url) {
      logError(`[${operationId}] Missing URL parameter`)
      return { success: false, error: 'Missing URL parameter' }
    }
    
    if (!destPath) {
      logError(`[${operationId}] Missing destination path parameter`)
      return { success: false, error: 'Missing destination path parameter' }
    }
    
    // Ensure directory exists
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
    
    // Check if we have write permission
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
    
    // Check available disk space (basic check on Windows)
    try {
      const stats = fs.statfsSync ? fs.statfsSync(dir) : null
      if (stats) {
        const availableBytes = stats.bavail * stats.bsize
        logDebug(`[${operationId}] Disk space check`, {
          dir,
          availableBytes,
          availableMB: Math.round(availableBytes / 1024 / 1024)
        })
        if (availableBytes < 100 * 1024 * 1024) { // Less than 100MB
          logWarn(`[${operationId}] Low disk space warning`, { availableBytes })
        }
      }
    } catch {
      // statfsSync may not be available on all platforms
    }
    
    const https = await import('https')
    const http = await import('http')
    const client = url.startsWith('https') ? https : http
    
    return new Promise((resolve) => {
      logDebug(`[${operationId}] Initiating HTTP request`)
      
      const request = client.get(url, (response) => {
        logDebug(`[${operationId}] Got response`, {
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          headers: {
            contentLength: response.headers['content-length'],
            contentType: response.headers['content-type']
          }
        })
        
        if (response.statusCode === 301 || response.statusCode === 302) {
          // Handle redirect
          const redirectUrl = response.headers.location
          logDebug(`[${operationId}] Following redirect`, { redirectUrl: redirectUrl?.substring(0, 80) })
          
          if (redirectUrl) {
            const redirectClient = redirectUrl.startsWith('https') ? https : http
            redirectClient.get(redirectUrl, (redirectResponse) => {
              logDebug(`[${operationId}] Redirect response`, {
                statusCode: redirectResponse.statusCode,
                statusMessage: redirectResponse.statusMessage
              })
              handleResponse(redirectResponse)
            }).on('error', (err) => {
              logError(`[${operationId}] Redirect request error`, {
                error: String(err),
                code: (err as NodeJS.ErrnoException).code
              })
              resolve({ success: false, error: `Redirect failed: ${err}` })
            })
            return
          }
        }
        handleResponse(response)
      })
      
      request.on('error', (err) => {
        const nodeErr = err as NodeJS.ErrnoException
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
      
      function handleResponse(response: any) {
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
          
          // Send progress every 100ms
          const now = Date.now()
          if (now - lastProgressTime >= 100) {
            const bytesSinceLast = downloaded - lastDownloaded
            const timeSinceLast = (now - lastProgressTime) / 1000
            const speed = timeSinceLast > 0 ? bytesSinceLast / timeSinceLast : 0
            
            // Send progress to renderer
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
          // Try to clean up partial file
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
          
          // Try to clean up partial file
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

// List files from any directory (for multi-vault support)
ipcMain.handle('fs:list-dir-files', async (_, dirPath: string) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { success: false, error: 'Directory does not exist' }
  }
  
  const files: LocalFileInfo[] = []
  
  function walkDir(dir: string, baseDir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const item of items) {
        // Skip hidden files
        if (item.name.startsWith('.')) continue
        
        const fullPath = path.join(dir, item.name)
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
        const stats = fs.statSync(fullPath)
        
        if (item.isDirectory()) {
          // Add folder entry
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            isDirectory: true,
            extension: '',
            size: 0,
            modifiedTime: stats.mtime.toISOString()
          })
          // Recurse into folder
          walkDir(fullPath, baseDir)
        } else {
          // Add file entry with hash for comparison
          let fileHash: string | undefined
          try {
            // Compute hash for files (needed for diff detection)
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
      log('Error reading directory:', err)
    }
  }
  
  walkDir(dirPath, dirPath)
  
  // Sort: folders first, then by name
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.relativePath.localeCompare(b.relativePath)
  })
  
  return { success: true, files }
})

// Hash cache to avoid recomputing hashes for unchanged files
// Key: relativePath, Value: { size, mtime, hash }
const hashCache = new Map<string, { size: number; mtime: number; hash: string }>()

// FAST file listing - no hash computation, returns immediately
// This is used for initial load to show files right away
ipcMain.handle('fs:list-working-files', async () => {
  if (!workingDirectory) {
    return { success: false, error: 'No working directory set' }
  }
  
  const files: LocalFileInfo[] = []
  const seenPaths = new Set<string>() // Track which paths we've seen this scan
  
  function walkDir(dir: string, baseDir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const item of items) {
        // Skip hidden files
        if (item.name.startsWith('.')) continue
        
        const fullPath = path.join(dir, item.name)
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
        const stats = fs.statSync(fullPath)
        
        if (item.isDirectory()) {
          // Add folder entry
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            isDirectory: true,
            extension: '',
            size: 0,
            modifiedTime: stats.mtime.toISOString()
          })
          // Recurse into folder
          walkDir(fullPath, baseDir)
        } else {
          seenPaths.add(relativePath)
          
          // Check hash cache - reuse if file size and mtime haven't changed
          // This makes subsequent loads fast even with hash checking
          let fileHash: string | undefined
          const cached = hashCache.get(relativePath)
          const mtimeMs = stats.mtime.getTime()
          
          if (cached && cached.size === stats.size && cached.mtime === mtimeMs) {
            // File unchanged, reuse cached hash (FAST - no disk read)
            fileHash = cached.hash
          }
          // Don't compute hash if not cached - let background task handle it
          
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            isDirectory: false,
            extension: path.extname(item.name).toLowerCase(),
            size: stats.size,
            modifiedTime: stats.mtime.toISOString(),
            hash: fileHash  // May be undefined - will be computed in background
          })
        }
      }
    } catch (err) {
      log('Error reading directory:', err)
    }
  }
  
  walkDir(workingDirectory, workingDirectory)
  
  // Clean up cache entries for files that no longer exist
  for (const cachedPath of hashCache.keys()) {
    if (!seenPaths.has(cachedPath)) {
      hashCache.delete(cachedPath)
    }
  }
  
  // Sort: folders first, then by name
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.relativePath.localeCompare(b.relativePath)
  })
  
  return { success: true, files }
})

// Compute hashes for files in batches - returns progress updates via IPC
// This runs in background after initial file list is shown
ipcMain.handle('fs:compute-file-hashes', async (event, filePaths: Array<{ path: string; relativePath: string; size: number; mtime: number }>) => {
  if (!workingDirectory) {
    return { success: false, error: 'No working directory set' }
  }
  
  const results: Array<{ relativePath: string; hash: string }> = []
  const batchSize = 20 // Process 20 files at a time before yielding
  let processed = 0
  const total = filePaths.length
  
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize)
    
    for (const file of batch) {
      try {
        // Check cache first
        const cached = hashCache.get(file.relativePath)
        if (cached && cached.size === file.size && cached.mtime === file.mtime) {
          results.push({ relativePath: file.relativePath, hash: cached.hash })
          processed++
          continue
        }
        
        // Compute hash
        const fileData = fs.readFileSync(file.path)
        const hash = crypto.createHash('sha256').update(fileData).digest('hex')
        
        // Update cache
        hashCache.set(file.relativePath, { size: file.size, mtime: file.mtime, hash })
        
        results.push({ relativePath: file.relativePath, hash })
        processed++
      } catch (err) {
        // Skip files that can't be read
        hashCache.delete(file.relativePath)
        processed++
      }
    }
    
    // Send progress update after each batch
    const percent = Math.round((processed / total) * 100)
    event.sender.send('hash-progress', { processed, total, percent })
    
    // Yield to event loop to keep UI responsive
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
    
    // Check if it already exists
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

// Check if a directory is empty (has no files or subdirectories)
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
  try {
    log('Deleting item:', targetPath)
    // Check if path exists first
    if (!fs.existsSync(targetPath)) {
      log('Path does not exist:', targetPath)
      return { success: false, error: 'Path does not exist' }
    }
    
    // If deleting anything inside the working directory, pause the file watcher
    // to release file handles that might block deletion
    const needsWatcherPause = workingDirectory && (
      targetPath === workingDirectory || 
      workingDirectory.startsWith(targetPath) ||
      targetPath.startsWith(workingDirectory)
    )
    
    if (needsWatcherPause) {
      log('Pausing file watcher before delete')
      stopFileWatcher()
      // Give OS time to release file handles
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    try {
      // Move to Recycle Bin instead of permanent delete
      await shell.trashItem(targetPath)
      log('Successfully moved to Recycle Bin:', targetPath)
      return { success: true }
    } finally {
      // Restart the file watcher if we paused it (and we didn't delete the working directory itself)
      if (needsWatcherPause && workingDirectory && fs.existsSync(workingDirectory)) {
        log('Restarting file watcher after delete')
        startFileWatcher(workingDirectory)
      }
    }
  } catch (err) {
    log('Failed to delete:', targetPath, err)
    return { success: false, error: String(err) }
  }
})

// Native file drag - allows dragging files out of the app to Explorer, Chrome, etc.
// Create a simple 32x32 PNG icon for drag operations
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABjSURBVFhH7c0xDQAgDAXQskKxgBUsYAErWMECFv7OwEImXEOTN/wdPwEAAAAAAACU7F0z27sZuweeAAAAAAAAlOzdM9u7GbsHngAAAAAAAJTs3TPbuxm7B56AAAAAgF9mZgO0VARYFxh/1QAAAABJRU5ErkJggg=='
)

// Check if running as admin (which breaks drag-and-drop on Windows)
let warnedAboutAdmin = false

ipcMain.on('fs:start-drag', (event, filePaths: string[]) => {
  log('fs:start-drag received:', filePaths.length, 'files')
  
  // Filter to only existing files
  const validPaths = filePaths.filter(p => {
    try {
      const exists = fs.existsSync(p)
      const isFile = exists && fs.statSync(p).isFile()
      if (!exists) log('  File does not exist:', p)
      if (exists && !isFile) log('  Not a file:', p)
      return isFile
    } catch (err) {
      log('  Error checking file:', p, err)
      return false
    }
  })
  
  if (validPaths.length === 0) {
    log('No valid paths for drag')
    return
  }
  
  log('Valid paths for drag:', validPaths)
  
  try {
    // Use the mainWindow's webContents for more reliable drag
    if (mainWindow && !mainWindow.isDestroyed()) {
      log('Calling startDrag via mainWindow.webContents')
      mainWindow.webContents.startDrag({
        files: validPaths,
        icon: DRAG_ICON
      })
      log('startDrag completed')
    } else {
      log('mainWindow not available, using event.sender')
      event.sender.startDrag({
        files: validPaths,
        icon: DRAG_ICON
      })
      log('startDrag via event.sender completed')
    }
  } catch (err) {
    log('startDrag error:', err)
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
      // Recursively copy directory
      copyDirSync(sourcePath, destPath)
      log('Copied directory:', sourcePath, '->', destPath)
    } else {
      // Ensure destination directory exists
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      
      fs.copyFileSync(sourcePath, destPath)
      log('Copied file:', sourcePath, '->', destPath)
    }
    
    return { success: true }
  } catch (err) {
    log('Error copying:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:move-file', async (_, sourcePath: string, destPath: string) => {
  try {
    const stats = fs.statSync(sourcePath)
    
    // Ensure destination directory exists
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    
    // Try rename first (fastest, works on same filesystem)
    try {
      fs.renameSync(sourcePath, destPath)
      log('Moved (rename):', sourcePath, '->', destPath)
      return { success: true }
    } catch (renameErr) {
      // If rename fails (cross-filesystem), copy then delete
      log('Rename failed, trying copy+delete:', renameErr)
    }
    
    // Fallback: copy then delete
    if (stats.isDirectory()) {
      copyDirSync(sourcePath, destPath)
      fs.rmSync(sourcePath, { recursive: true, force: true })
      log('Moved (copy+delete) directory:', sourcePath, '->', destPath)
    } else {
      fs.copyFileSync(sourcePath, destPath)
      fs.unlinkSync(sourcePath)
      log('Moved (copy+delete) file:', sourcePath, '->', destPath)
    }
    
    return { success: true }
  } catch (err) {
    log('Error moving:', err)
    return { success: false, error: String(err) }
  }
})

// Helper to recursively copy a directory
function copyDirSync(src: string, dest: string) {
  // Create destination directory
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

ipcMain.handle('fs:open-in-explorer', async (_, targetPath: string) => {
  shell.showItemInFolder(targetPath)
  return { success: true }
})

ipcMain.handle('fs:open-file', async (_, filePath: string) => {
  // Use exec with 'start' command on Windows for faster file opening
  // shell.openPath() can be slow due to Windows shell association lookup
  if (process.platform === 'win32') {
    const { exec } = require('child_process')
    // Use 'start' with empty title ("") and quoted path for paths with spaces
    // The empty title "" is needed because start treats the first quoted arg as window title
    exec(`start "" "${filePath}"`, { windowsHide: true })
  } else {
    // On macOS/Linux, shell.openPath is fine
    shell.openPath(filePath)
  }
  return { success: true }
})

// Set file read-only attribute
ipcMain.handle('fs:set-readonly', async (_, filePath: string, readonly: boolean) => {
  try {
    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      return { success: true } // Skip directories
    }
    
    // Get current mode
    const currentMode = stats.mode
    
    if (readonly) {
      // Remove write permissions (owner, group, others)
      const newMode = currentMode & ~0o222
      fs.chmodSync(filePath, newMode)
    } else {
      // Add owner write permission
      const newMode = currentMode | 0o200
      fs.chmodSync(filePath, newMode)
    }
    
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Check if file is read-only
ipcMain.handle('fs:is-readonly', async (_, filePath: string) => {
  try {
    const stats = fs.statSync(filePath)
    // Check if owner write bit is not set
    const isReadonly = (stats.mode & 0o200) === 0
    return { success: true, readonly: isReadonly }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Helper to recursively get all files in a directory with relative paths
function getAllFilesInDir(dirPath: string, baseFolder: string): Array<{ name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }> {
  const files: Array<{ name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }> = []
  
  function walkDir(currentPath: string) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true })
      for (const item of items) {
        // Skip hidden files/folders
        if (item.name.startsWith('.')) continue
        
        const fullPath = path.join(currentPath, item.name)
        
        if (item.isDirectory()) {
          walkDir(fullPath)
        } else {
          const stats = fs.statSync(fullPath)
          // Compute relative path from the base folder (includes the folder name itself)
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
      log('Error walking directory:', err)
    }
  }
  
  walkDir(dirPath)
  return files
}

// Select files to add (returns file paths) - Windows doesn't support openFile + openDirectory together
ipcMain.handle('dialog:select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Files to Add',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'CAD Files', extensions: ['sldprt', 'sldasm', 'slddrw', 'step', 'stp', 'iges', 'igs', 'stl', 'pdf'] },
      { name: 'SolidWorks Parts', extensions: ['sldprt'] },
      { name: 'SolidWorks Assemblies', extensions: ['sldasm'] },
      { name: 'SolidWorks Drawings', extensions: ['slddrw'] }
    ]
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    const allFiles: Array<{ name: string; path: string; extension: string; size: number; modifiedTime: string }> = []
    
    for (const filePath of result.filePaths) {
      try {
        const stats = fs.statSync(filePath)
        allFiles.push({
          name: path.basename(filePath),
          path: filePath,
          extension: path.extname(filePath).toLowerCase(),
          size: stats.size,
          modifiedTime: stats.mtime.toISOString()
        })
      } catch (err) {
        log('Error reading file stats:', filePath, err)
      }
    }
    
    return { success: true, files: allFiles }
  }
  return { success: false, canceled: true }
})

// Select a folder to add (returns all files within the folder with relative paths preserved)
ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Folder to Add',
    properties: ['openDirectory']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0]
    const folderName = path.basename(folderPath)
    
    // Get all files in the folder recursively
    const allFiles = getAllFilesInDir(folderPath, folderName)
    
    log('Selected folder:', folderPath, 'with', allFiles.length, 'files')
    
    return { 
      success: true, 
      folderName,
      folderPath,
      files: allFiles 
    }
  }
  return { success: false, canceled: true }
})

// Save file dialog
ipcMain.handle('dialog:save-file', async (_, defaultName: string, filters?: Array<{ name: string; extensions: string[] }>) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save File',
    defaultPath: defaultName,
    filters: filters || [
      { name: 'PDF Documents', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  
  if (!result.canceled && result.filePath) {
    return { success: true, path: result.filePath }
  }
  return { success: false, canceled: true }
})

// Generate PDF from HTML content using Electron's printToPDF
ipcMain.handle('pdf:generate-from-html', async (_, htmlContent: string, outputPath: string) => {
  log('[PDF] Starting PDF generation to: ' + outputPath)
  
  let pdfWindow: BrowserWindow | null = null
  
  try {
    // Create an off-screen browser window
    pdfWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true
      }
    })

    // Load the HTML content
    log('[PDF] Loading HTML content...')
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)

    // Wait for content to fully render (including fonts/images)
    log('[PDF] Waiting for content to render...')
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Generate PDF
    log('[PDF] Generating PDF...')
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: {
        top: 0.5,
        bottom: 0.5,
        left: 0.5,
        right: 0.5
      }
    })

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Write to file
    log('[PDF] Writing PDF to disk: ' + outputPath)
    fs.writeFileSync(outputPath, pdfBuffer)
    
    log('[PDF] PDF generated successfully, size: ' + pdfBuffer.length + ' bytes')

    return { 
      success: true, 
      path: outputPath,
      size: pdfBuffer.length 
    }
  } catch (err) {
    logError('Failed to generate PDF', { error: String(err), outputPath })
    return { 
      success: false, 
      error: err instanceof Error ? err.message : String(err) 
    }
  } finally {
    // Clean up
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.destroy()
    }
  }
})

// ============================================
// eDrawings Preview & SolidWorks Thumbnails
// ============================================

// Try to load native eDrawings module
let edrawingsNative: any = null
try {
  edrawingsNative = require('../native/build/Release/edrawings_preview.node')
  log('[eDrawings] Native module loaded successfully')
} catch (err) {
  log('[eDrawings] Native module not available:', err)
}

// Extract thumbnail or icon from files using Windows Shell API (same as Explorer)
// First tries to get a preview thumbnail, then falls back to the file type icon
async function extractSolidWorksThumbnail(filePath: string): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    // First, try to get a preview thumbnail (works for images, PDFs with preview, SolidWorks, etc.)
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, { 
        width: 256, 
        height: 256 
      })
      
      if (thumbnail && !thumbnail.isEmpty()) {
        const pngData = thumbnail.toPNG()
        if (pngData && pngData.length > 100) {
          log('[Thumbnail] Got OS thumbnail for:', path.basename(filePath), 'size:', pngData.length)
          return { success: true, data: `data:image/png;base64,${pngData.toString('base64')}` }
        }
      }
    } catch (thumbErr) {
      // Thumbnail not available, will try icon below
    }
    
    // Fall back to file type icon (like Explorer shows for PDFs, Excel files, etc.)
    try {
      const icon = await app.getFileIcon(filePath, { size: 'large' })
      if (icon && !icon.isEmpty()) {
        const pngData = icon.toPNG()
        if (pngData && pngData.length > 100) {
          log('[Thumbnail] Got OS file icon for:', path.basename(filePath), 'size:', pngData.length)
          return { success: true, data: `data:image/png;base64,${pngData.toString('base64')}` }
        }
      }
    } catch (iconErr) {
      log('[Thumbnail] Could not get file icon:', String(iconErr))
    }
    
    log('[Thumbnail] No OS thumbnail/icon available for:', path.basename(filePath))
    return { success: false, error: 'No thumbnail or icon available from OS' }
  } catch (err) {
    log('[Thumbnail] OS thumbnail extraction failed:', String(err))
    return { success: false, error: String(err) }
  }
}

// IPC handler for extracting thumbnails
ipcMain.handle('solidworks:extract-thumbnail', async (_, filePath: string) => {
  return extractSolidWorksThumbnail(filePath)
})

// ============================================
// SolidWorks Service Integration
// ============================================

import { spawn, ChildProcess, execSync } from 'child_process'

interface SWServiceResult {
  success: boolean
  data?: unknown
  error?: string
  errorDetails?: string
}

let swServiceProcess: ChildProcess | null = null
let swServiceBuffer = ''
let swPendingRequests: Map<number, { resolve: (value: SWServiceResult) => void; reject: (err: Error) => void }> = new Map()
let swRequestId = 0
let solidWorksInstalled: boolean | null = null // Cache the detection result

// Detect if SolidWorks is installed on this machine
function isSolidWorksInstalled(): boolean {
  // Return cached result if already checked
  if (solidWorksInstalled !== null) {
    return solidWorksInstalled
  }

  // Only check on Windows - SolidWorks is Windows-only
  if (process.platform !== 'win32') {
    solidWorksInstalled = false
    return false
  }

  try {
    // Check Windows registry for SolidWorks COM registration
    // This is the most reliable way to detect if SolidWorks is installed
    const result = execSync(
      'reg query "HKEY_CLASSES_ROOT\\SldWorks.Application" /ve',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    solidWorksInstalled = result.includes('SldWorks.Application')
    log('[SolidWorks] Installation detected:', solidWorksInstalled)
    return solidWorksInstalled
  } catch {
    // Registry key doesn't exist - SolidWorks not installed
    // Also check common installation paths as fallback
    const commonPaths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
      'C:\\Program Files\\SolidWorks Corp\\SolidWorks\\SLDWORKS.exe',
      'C:\\Program Files (x86)\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
    ]
    
    for (const swPath of commonPaths) {
      if (fs.existsSync(swPath)) {
        solidWorksInstalled = true
        log('[SolidWorks] Installation detected at:', swPath)
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
  // Check if running from packaged app (production)
  const isPackaged = app.isPackaged
  
  const possiblePaths = [
    // Production - bundled with app in resources/bin
    { path: path.join(process.resourcesPath || '', 'bin', 'BluePLM.SolidWorksService.exe'), isProduction: true },
    // Development - Release build (relative to project root)
    { path: path.join(app.getAppPath(), 'solidworks-addin', 'BluePLM.SolidWorksService', 'bin', 'Release', 'BluePLM.SolidWorksService.exe'), isProduction: false },
    // Development - Debug build
    { path: path.join(app.getAppPath(), 'solidworks-addin', 'BluePLM.SolidWorksService', 'bin', 'Debug', 'BluePLM.SolidWorksService.exe'), isProduction: false },
  ]
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p.path)) {
      return p
    }
  }
  
  // Return appropriate default based on environment
  return isPackaged ? possiblePaths[0] : possiblePaths[1]
}

// Start the SolidWorks service process
async function startSWService(dmLicenseKey?: string): Promise<SWServiceResult> {
  // First check if SolidWorks is even installed
  if (!isSolidWorksInstalled()) {
    return { 
      success: false, 
      error: 'SolidWorks not installed',
      errorDetails: 'SolidWorks is not installed on this machine. The SolidWorks integration features require SolidWorks to be installed.'
    }
  }

  if (swServiceProcess) {
    // If service is already running but we have a new license key, set it
    if (dmLicenseKey) {
      const result = await sendSWCommand({ action: 'setDmLicense', licenseKey: dmLicenseKey })
      if (result.success) {
        return { success: true, data: { message: 'Service running, license key updated' } }
      }
    }
    return { success: true, data: { message: 'Service already running' } }
  }
  
  const serviceInfo = getSWServicePath()
  const servicePath = serviceInfo.path
  if (!fs.existsSync(servicePath)) {
    if (serviceInfo.isProduction) {
      // Running from packaged app - service wasn't bundled
      return { 
        success: false, 
        error: 'SolidWorks service not bundled',
        errorDetails: 'The SolidWorks service executable was not included in this build. Please contact support or rebuild the app with SolidWorks installed.'
      }
    } else {
      // Development mode - provide build instructions
      return { 
        success: false, 
        error: 'SolidWorks service not built',
        errorDetails: `Expected at: ${servicePath}\n\nBuild it with: dotnet build solidworks-addin/BluePLM.SolidWorksService -c Release`
      }
    }
  }
  
  // Build args - include DM license key if provided
  const args: string[] = []
  if (dmLicenseKey) {
    args.push('--dm-license', dmLicenseKey)
  }
  
  return new Promise((resolve) => {
    try {
      swServiceProcess = spawn(servicePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      
      swServiceProcess.stdout?.on('data', (data: Buffer) => {
        handleSWServiceOutput(data.toString())
      })
      
      swServiceProcess.stderr?.on('data', (data: Buffer) => {
        log('[SolidWorks Service]', data.toString())
      })
      
      swServiceProcess.on('error', (err) => {
        log('[SolidWorks Service] Process error:', err)
        swServiceProcess = null
      })
      
      swServiceProcess.on('close', (code) => {
        log('[SolidWorks Service] Process exited with code:', code)
        swServiceProcess = null
      })
      
      // Wait a moment and test with ping
      setTimeout(async () => {
        try {
          const pingResult = await sendSWCommand({ action: 'ping' })
          resolve(pingResult)
        } catch (err) {
          resolve({ success: false, error: String(err) })
        }
      }, 1000)
      
    } catch (err) {
      resolve({ success: false, error: String(err) })
    }
  })
}

// Stop the SolidWorks service
async function stopSWService(): Promise<void> {
  if (!swServiceProcess) return
  
  try {
    await sendSWCommand({ action: 'quit' })
  } catch {
    // Ignore quit errors
  }
  
  swServiceProcess.kill()
  swServiceProcess = null
}

// Handle output from the service
function handleSWServiceOutput(data: string): void {
  swServiceBuffer += data
  
  const lines = swServiceBuffer.split('\n')
  swServiceBuffer = lines.pop() || ''
  
  for (const line of lines) {
    if (!line.trim()) continue
    
    try {
      const result = JSON.parse(line) as SWServiceResult
      
      const [id, handlers] = swPendingRequests.entries().next().value || []
      if (handlers) {
        swPendingRequests.delete(id)
        handlers.resolve(result)
      }
    } catch (err) {
      log('[SolidWorks Service] Failed to parse output:', line)
    }
  }
}

// Send a command to the SolidWorks service
async function sendSWCommand(command: Record<string, unknown>): Promise<SWServiceResult> {
  if (!swServiceProcess?.stdin) {
    return { success: false, error: 'SolidWorks service not running. Start it first.' }
  }
  
  return new Promise((resolve, reject) => {
    const id = ++swRequestId
    
    const timeout = setTimeout(() => {
      swPendingRequests.delete(id)
      resolve({ success: false, error: 'Command timed out' })
    }, 300000) // 5 minute timeout
    
    swPendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      reject: (err) => {
        clearTimeout(timeout)
        reject(err)
      }
    })
    
    const json = JSON.stringify(command) + '\n'
    swServiceProcess!.stdin!.write(json)
  })
}

// IPC Handlers for SolidWorks operations

// Start the service
ipcMain.handle('solidworks:start-service', async (_, dmLicenseKey?: string) => {
  return startSWService(dmLicenseKey)
})

// Stop the service
ipcMain.handle('solidworks:stop-service', async () => {
  await stopSWService()
  return { success: true }
})

// Check if service is running
ipcMain.handle('solidworks:service-status', async () => {
  const swInstalled = isSolidWorksInstalled()
  
  if (!swInstalled) {
    return { success: true, data: { running: false, installed: false } }
  }
  
  if (!swServiceProcess) {
    return { success: true, data: { running: false, installed: true } }
  }
  const result = await sendSWCommand({ action: 'ping' })
  return { success: true, data: { running: result.success, installed: true, version: (result.data as any)?.version } }
})

// Check if SolidWorks is installed on this machine
ipcMain.handle('solidworks:is-installed', async () => {
  return { success: true, data: { installed: isSolidWorksInstalled() } }
})

// Get BOM from assembly
ipcMain.handle('solidworks:get-bom', async (_, filePath: string, options?: { includeChildren?: boolean; configuration?: string }) => {
  return sendSWCommand({ action: 'getBom', filePath, ...options })
})

// Get custom properties
ipcMain.handle('solidworks:get-properties', async (_, filePath: string, configuration?: string) => {
  return sendSWCommand({ action: 'getProperties', filePath, configuration })
})

// Set custom properties
ipcMain.handle('solidworks:set-properties', async (_, filePath: string, properties: Record<string, string>, configuration?: string) => {
  return sendSWCommand({ action: 'setProperties', filePath, properties, configuration })
})

// Get configurations
ipcMain.handle('solidworks:get-configurations', async (_, filePath: string) => {
  return sendSWCommand({ action: 'getConfigurations', filePath })
})

// Get external references
ipcMain.handle('solidworks:get-references', async (_, filePath: string) => {
  return sendSWCommand({ action: 'getReferences', filePath })
})

// Get high-res preview image (uses Document Manager API - no SW launch!)
ipcMain.handle('solidworks:get-preview', async (_, filePath: string, configuration?: string) => {
  return sendSWCommand({ action: 'getPreview', filePath, configuration })
})

// Get mass properties
ipcMain.handle('solidworks:get-mass-properties', async (_, filePath: string, configuration?: string) => {
  return sendSWCommand({ action: 'getMassProperties', filePath, configuration })
})

// Export to PDF
ipcMain.handle('solidworks:export-pdf', async (_, filePath: string, outputPath?: string) => {
  return sendSWCommand({ action: 'exportPdf', filePath, outputPath })
})

// Export to STEP
ipcMain.handle('solidworks:export-step', async (_, filePath: string, options?: { outputPath?: string; configuration?: string; exportAllConfigs?: boolean }) => {
  return sendSWCommand({ action: 'exportStep', filePath, ...options })
})

// Export to DXF
ipcMain.handle('solidworks:export-dxf', async (_, filePath: string, outputPath?: string) => {
  return sendSWCommand({ action: 'exportDxf', filePath, outputPath })
})

// Export to IGES
ipcMain.handle('solidworks:export-iges', async (_, filePath: string, outputPath?: string) => {
  return sendSWCommand({ action: 'exportIges', filePath, outputPath })
})

// Export to image (PNG)
ipcMain.handle('solidworks:export-image', async (_, filePath: string, options?: { outputPath?: string; width?: number; height?: number }) => {
  return sendSWCommand({ action: 'exportImage', filePath, ...options })
})

// Replace component in assembly
ipcMain.handle('solidworks:replace-component', async (_, assemblyPath: string, oldComponent: string, newComponent: string) => {
  return sendSWCommand({ action: 'replaceComponent', filePath: assemblyPath, oldComponent, newComponent })
})

// Pack and Go
ipcMain.handle('solidworks:pack-and-go', async (_, filePath: string, outputFolder: string, options?: { prefix?: string; suffix?: string }) => {
  return sendSWCommand({ action: 'packAndGo', filePath, outputFolder, ...options })
})

// ============================================
// End SolidWorks Service Integration
// ============================================

// ============================================
// RFQ Release Files Management
// ============================================

// Get RFQ output directory (creates if doesn't exist)
ipcMain.handle('rfq:get-output-dir', async (_, rfqId: string, rfqNumber?: string) => {
  try {
    const baseDir = path.join(app.getPath('userData'), 'rfq-releases')
    const rfqDir = path.join(baseDir, rfqNumber || rfqId)
    
    if (!fs.existsSync(rfqDir)) {
      fs.mkdirSync(rfqDir, { recursive: true })
    }
    
    return { success: true, path: rfqDir }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Export file to RFQ release folder with custom name
ipcMain.handle('rfq:export-release-file', async (_, options: {
  rfqId: string
  rfqNumber?: string
  sourceFilePath: string
  exportType: 'step' | 'pdf' | 'dxf' | 'iges'
  partNumber?: string
  revision?: string
  configuration?: string
}) => {
  try {
    const { rfqId, rfqNumber, sourceFilePath, exportType, partNumber, revision, configuration } = options
    
    // Create RFQ output directory
    const baseDir = path.join(app.getPath('userData'), 'rfq-releases')
    const rfqDir = path.join(baseDir, rfqNumber || rfqId)
    if (!fs.existsSync(rfqDir)) {
      fs.mkdirSync(rfqDir, { recursive: true })
    }
    
    // Generate output filename based on part number, revision, and optionally configuration
    const baseName = partNumber || path.basename(sourceFilePath, path.extname(sourceFilePath))
    const revSuffix = revision ? `_REV${revision}` : ''
    const configSuffix = configuration ? `_${configuration}` : ''
    const outputName = `${baseName}${revSuffix}${configSuffix}.${exportType}`
    const outputPath = path.join(rfqDir, outputName)
    
    // Export using SolidWorks service
    let result
    switch (exportType) {
      case 'step':
        result = await sendSWCommand({ 
          action: 'exportStep', 
          filePath: sourceFilePath, 
          outputPath, 
          exportAllConfigs: false,
          configuration: configuration || undefined
        })
        break
      case 'pdf':
        result = await sendSWCommand({ action: 'exportPdf', filePath: sourceFilePath, outputPath })
        break
      case 'dxf':
        result = await sendSWCommand({ action: 'exportDxf', filePath: sourceFilePath, outputPath })
        break
      case 'iges':
        result = await sendSWCommand({ action: 'exportIges', filePath: sourceFilePath, outputPath })
        break
      default:
        return { success: false, error: 'Invalid export type' }
    }
    
    if (result?.success) {
      // Get file size
      let fileSize = 0
      if (fs.existsSync(outputPath)) {
        fileSize = fs.statSync(outputPath).size
      }
      
      return {
        success: true,
        outputPath,
        fileName: outputName,
        fileSize
      }
    } else {
      return { success: false, error: result?.error || 'Export failed' }
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Create ZIP package of RFQ release files
ipcMain.handle('rfq:create-zip', async (_, options: {
  rfqId: string
  rfqNumber: string
  files: Array<{ path: string; name: string }>
  rfqPdfPath?: string
  outputPath?: string
}) => {
  try {
    const { rfqId, rfqNumber, files, rfqPdfPath, outputPath } = options
    
    // Use custom output path or default to app data directory
    let zipPath: string
    let rfqDir: string
    
    if (outputPath) {
      zipPath = outputPath
      rfqDir = path.dirname(outputPath)
    } else {
      // Create RFQ output directory in app data
      const baseDir = path.join(app.getPath('userData'), 'rfq-releases')
      rfqDir = path.join(baseDir, rfqNumber || rfqId)
      zipPath = path.join(rfqDir, `${rfqNumber}_ReleasePackage.zip`)
    }
    
    if (!fs.existsSync(rfqDir)) {
      fs.mkdirSync(rfqDir, { recursive: true })
    }
    
    // Use PowerShell on Windows, zip on other platforms
    if (process.platform === 'win32') {
      const { exec } = require('child_process')
      
      // Create a temp directory with all files to zip
      const tempDir = path.join(rfqDir, '_temp_zip')
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true })
      }
      fs.mkdirSync(tempDir, { recursive: true })
      
      // Copy files to temp directory
      for (const file of files) {
        if (fs.existsSync(file.path)) {
          fs.copyFileSync(file.path, path.join(tempDir, file.name))
        }
      }
      
      // Copy RFQ PDF if provided
      if (rfqPdfPath && fs.existsSync(rfqPdfPath)) {
        fs.copyFileSync(rfqPdfPath, path.join(tempDir, `${rfqNumber}_RFQ.pdf`))
      }
      
      // Delete existing zip if exists
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath)
      }
      
      // Create zip using PowerShell
      await new Promise<void>((resolve, reject) => {
        const psCommand = `Compress-Archive -Path "${tempDir}\\*" -DestinationPath "${zipPath}" -Force`
        exec(`powershell -Command "${psCommand}"`, (error: Error | null) => {
          // Clean up temp directory
          try {
            fs.rmSync(tempDir, { recursive: true })
          } catch {}
          
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    } else {
      // macOS/Linux - use built-in zip command
      const { exec } = require('child_process')
      
      const tempDir = path.join(rfqDir, '_temp_zip')
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true })
      }
      fs.mkdirSync(tempDir, { recursive: true })
      
      // Copy files
      for (const file of files) {
        if (fs.existsSync(file.path)) {
          fs.copyFileSync(file.path, path.join(tempDir, file.name))
        }
      }
      
      if (rfqPdfPath && fs.existsSync(rfqPdfPath)) {
        fs.copyFileSync(rfqPdfPath, path.join(tempDir, `${rfqNumber}_RFQ.pdf`))
      }
      
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath)
      }
      
      await new Promise<void>((resolve, reject) => {
        exec(`cd "${tempDir}" && zip -r "${zipPath}" .`, (error: Error | null) => {
          try {
            fs.rmSync(tempDir, { recursive: true })
          } catch {}
          
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    }
    
    if (fs.existsSync(zipPath)) {
      const stats = fs.statSync(zipPath)
      return {
        success: true,
        zipPath,
        fileSize: stats.size
      }
    } else {
      return { success: false, error: 'ZIP file was not created' }
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Open RFQ release folder
ipcMain.handle('rfq:open-folder', async (_, rfqId: string, rfqNumber?: string) => {
  try {
    const baseDir = path.join(app.getPath('userData'), 'rfq-releases')
    const rfqDir = path.join(baseDir, rfqNumber || rfqId)
    
    if (!fs.existsSync(rfqDir)) {
      fs.mkdirSync(rfqDir, { recursive: true })
    }
    
    shell.openPath(rfqDir)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ============================================
// End RFQ Release Files Management
// ============================================

// Check if eDrawings is installed
ipcMain.handle('edrawings:check-installed', async () => {
  // Try native module first
  if (edrawingsNative?.checkEDrawingsInstalled) {
    try {
      return edrawingsNative.checkEDrawingsInstalled()
    } catch (err) {
      log('[eDrawings] Native check failed:', err)
    }
  }
  
  // Fallback: Check common eDrawings installation paths
  const paths = [
    'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe',
    'C:\\Program Files\\eDrawings\\eDrawings.exe',
    'C:\\Program Files (x86)\\eDrawings\\eDrawings.exe',
    'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\eDrawings\\eDrawings.exe'
  ]
  
  for (const ePath of paths) {
    if (fs.existsSync(ePath)) {
      return { installed: true, path: ePath }
    }
  }
  
  return { installed: false, path: null }
})

// Check if native embedding is available
ipcMain.handle('edrawings:native-available', () => {
  return edrawingsNative !== null
})

// Open file in eDrawings
ipcMain.handle('edrawings:open-file', async (_, filePath: string) => {
  // Find eDrawings executable
  const eDrawingsPaths = [
    'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe',
    'C:\\Program Files\\eDrawings\\eDrawings.exe',
    'C:\\Program Files (x86)\\eDrawings\\eDrawings.exe',
    'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\eDrawings\\eDrawings.exe'
  ]
  
  let eDrawingsPath: string | null = null
  for (const ePath of eDrawingsPaths) {
    if (fs.existsSync(ePath)) {
      eDrawingsPath = ePath
      break
    }
  }
  
  if (!eDrawingsPath) {
    // Fallback to shell open if eDrawings not found
    try {
      await shell.openPath(filePath)
      return { success: true, fallback: true }
    } catch (err) {
      return { success: false, error: 'eDrawings not found' }
    }
  }
  
  try {
    // Launch eDrawings with the file
    const { spawn } = require('child_process')
    spawn(eDrawingsPath, [filePath], { 
      detached: true,
      stdio: 'ignore'
    }).unref()
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Get the native window handle for embedding
ipcMain.handle('edrawings:get-window-handle', () => {
  if (!mainWindow) return null
  
  // Get the native window handle (HWND on Windows)
  const handle = mainWindow.getNativeWindowHandle()
  // Return as array of bytes that can be reconstructed
  return Array.from(handle)
})

// Embedded eDrawings preview control management
let edrawingsPreview: any = null

ipcMain.handle('edrawings:create-preview', () => {
  if (!edrawingsNative?.EDrawingsPreview) {
    return { success: false, error: 'Native module not available' }
  }
  
  try {
    edrawingsPreview = new edrawingsNative.EDrawingsPreview()
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('edrawings:attach-preview', () => {
  if (!edrawingsPreview || !mainWindow) {
    return { success: false, error: 'Preview not created or window not available' }
  }
  
  try {
    const handle = mainWindow.getNativeWindowHandle()
    const result = edrawingsPreview.attachToWindow(handle)
    return { success: result }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('edrawings:load-file', async (_, filePath: string) => {
  if (!edrawingsPreview) {
    return { success: false, error: 'Preview not attached' }
  }
  
  try {
    const result = edrawingsPreview.loadFile(filePath)
    return { success: result }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('edrawings:set-bounds', async (_, x: number, y: number, width: number, height: number) => {
  if (!edrawingsPreview) {
    return { success: false }
  }
  
  try {
    edrawingsPreview.setBounds(x, y, width, height)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('edrawings:show-preview', () => {
  if (!edrawingsPreview) return { success: false }
  try {
    edrawingsPreview.show()
    return { success: true }
  } catch { return { success: false } }
})

ipcMain.handle('edrawings:hide-preview', () => {
  if (!edrawingsPreview) return { success: false }
  try {
    edrawingsPreview.hide()
    return { success: true }
  } catch { return { success: false } }
})

ipcMain.handle('edrawings:destroy-preview', () => {
  if (!edrawingsPreview) return { success: true }
  try {
    edrawingsPreview.destroy()
    edrawingsPreview = null
    return { success: true }
  } catch { return { success: false } }
})

// ============================================
// Backup System
// ============================================

// Get path to bundled restic binary
function getResticPath(): string {
  const binaryName = process.platform === 'win32' ? 'restic.exe' : 'restic'
  
  if (app.isPackaged) {
    // Production: use extraResources
    return path.join(process.resourcesPath, 'bin', binaryName)
  } else {
    // Development: use resources folder
    return path.join(__dirname, '..', 'resources', 'bin', process.platform, binaryName)
  }
}

// Check if restic is available (bundled or system)
ipcMain.handle('backup:check-restic', async () => {
  const { execSync } = require('child_process')
  
  // First try bundled restic
  const bundledPath = getResticPath()
  if (fs.existsSync(bundledPath)) {
    try {
      const version = execSync(`"${bundledPath}" version`, { encoding: 'utf8' })
      const match = version.match(/restic\s+([\d.]+)/)
      return { installed: true, version: match ? match[1] : 'unknown', path: bundledPath }
    } catch (err) {
      log('Bundled restic failed: ' + String(err))
    }
  }
  
  // Fall back to system restic
  try {
    const version = execSync('restic version', { encoding: 'utf8' })
    const match = version.match(/restic\s+([\d.]+)/)
    return { installed: true, version: match ? match[1] : 'unknown', path: 'restic' }
  } catch {
    return { 
      installed: false, 
      error: 'restic not found. Run "npm run download-restic" to bundle it with the app.'
    }
  }
})

// Get restic command (bundled or system fallback)
function getResticCommand(): string {
  const bundledPath = getResticPath()
  if (fs.existsSync(bundledPath)) {
    return bundledPath
  }
  return 'restic' // Fall back to system PATH
}

// Build restic repository URL based on provider
function buildResticRepo(config: {
  provider: string
  bucket: string
  endpoint?: string
  region?: string
}): string {
  if (config.provider === 'backblaze_b2') {
    // Backblaze B2 via S3-compatible API
    // Endpoint should be like: s3.us-west-004.backblazeb2.com
    const endpoint = config.endpoint || 's3.us-west-004.backblazeb2.com'
    return `s3:${endpoint}/${config.bucket}/blueplm-backup`
  } else if (config.provider === 'aws_s3') {
    // S3 backend: s3:s3.amazonaws.com/bucket/path
    const region = config.region || 'us-east-1'
    return `s3:s3.${region}.amazonaws.com/${config.bucket}/blueplm-backup`
  } else if (config.provider === 'google_cloud') {
    // GCS backend: gs:bucket:/path
    return `gs:${config.bucket}:/blueplm-backup`
  }
  // Default to S3-compatible
  const endpoint = config.endpoint || 's3.amazonaws.com'
  return `s3:${endpoint}/${config.bucket}/blueplm-backup`
}

// Run backup
ipcMain.handle('backup:run', async (event, config: {
  provider: string
  bucket: string
  region?: string
  endpoint?: string
  accessKey: string
  secretKey: string
  resticPassword: string
  retentionDaily: number
  retentionWeekly: number
  retentionMonthly: number
  retentionYearly: number
  localBackupEnabled?: boolean
  localBackupPath?: string
  metadataJson?: string  // Database metadata export as JSON string
  vaultName?: string     // Vault name for tagging
  vaultPath?: string     // Override vault path
}) => {
  const { spawn } = require('child_process')
  
  log('Starting backup...', { provider: config.provider, bucket: config.bucket })
  
  // Set up environment variables for restic
  const env = {
    ...process.env,
    RESTIC_PASSWORD: config.resticPassword,
    AWS_ACCESS_KEY_ID: config.accessKey,
    AWS_SECRET_ACCESS_KEY: config.secretKey,
  }
  
  // For Backblaze B2, also set B2 credentials
  if (config.provider === 'backblaze_b2') {
    env.B2_ACCOUNT_ID = config.accessKey
    env.B2_ACCOUNT_KEY = config.secretKey
  }
  
  const repo = buildResticRepo(config)
  log('Restic repository URL: ' + repo)
  
  try {
    // First, check if repo exists, if not initialize it
    event.sender.send('backup:progress', { phase: 'Initializing', percent: 5, message: 'Checking repository...' })
    
    const resticCmd = getResticCommand()
    
    try {
      await new Promise<void>((resolve, reject) => {
        const check = spawn(resticCmd, ['-r', repo, 'snapshots', '--json'], { env })
        check.on('close', (code: number) => {
          if (code === 0) resolve()
          else reject(new Error('Repo not initialized'))
        })
        check.on('error', reject)
      })
    } catch {
      // Initialize the repository
      log('Initializing restic repository...')
      event.sender.send('backup:progress', { phase: 'Initializing', percent: 10, message: 'Creating repository...' })
      
      await new Promise<void>((resolve, reject) => {
        const init = spawn(resticCmd, ['-r', repo, 'init'], { env })
        let stderr = ''
        let stdout = ''
        
        init.stdout.on('data', (data: Buffer) => {
          stdout += data.toString()
          log('restic init stdout: ' + data.toString())
        })
        
        init.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
          log('restic init stderr: ' + data.toString())
        })
        
        init.on('close', (code: number) => {
          if (code === 0) {
            log('Repository initialized successfully')
            resolve()
          } else {
            const errorMsg = stderr || stdout || `Exit code ${code}`
            logError('Failed to initialize repository', { code, stderr, stdout })
            reject(new Error(`Failed to initialize repository: ${errorMsg}`))
          }
        })
        init.on('error', (err) => {
          logError('Failed to spawn restic init', { error: String(err) })
          reject(err)
        })
      })
    }
    
    // Get the working directory (vault path) to backup
    const backupPath = config.vaultPath || workingDirectory
    if (!backupPath) {
      throw new Error('No vault connected - nothing to backup')
    }
    
    // Save database metadata to .blueplm folder if provided
    if (config.metadataJson) {
      event.sender.send('backup:progress', { phase: 'Metadata', percent: 15, message: 'Saving database metadata...' })
      
      const blueplmDir = path.join(backupPath, '.blueplm')
      if (!fs.existsSync(blueplmDir)) {
        fs.mkdirSync(blueplmDir, { recursive: true })
      }
      
      const metadataPath = path.join(blueplmDir, 'database-export.json')
      fs.writeFileSync(metadataPath, config.metadataJson, 'utf-8')
      log('Saved database metadata to: ' + metadataPath)
    }
    
    const vaultDisplayName = config.vaultName || path.basename(backupPath)
    event.sender.send('backup:progress', { phase: 'Backing up', percent: 20, message: `Backing up ${vaultDisplayName}...` })
    
    // Build backup command with appropriate tags
    const backupArgs = [
      '-r', repo,
      'backup',
      backupPath,
      '--json',
      '--tag', 'blueplm',
      '--tag', 'files'  // Always includes files
    ]
    
    // Add vault name tag for filtering
    if (config.vaultName) {
      backupArgs.push('--tag', `vault:${config.vaultName}`)
    }
    
    // Add has-metadata tag if database metadata was included
    if (config.metadataJson) {
      backupArgs.push('--tag', 'has-metadata')
    }
    
    // Run the backup
    const backupResult = await new Promise<{ snapshotId: string; stats: any }>((resolve, reject) => {
      let output = ''
      let snapshotId = ''
      
      const backup = spawn(resticCmd, backupArgs, { env })
      
      backup.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const json = JSON.parse(line)
            if (json.message_type === 'status') {
              const percent = 20 + Math.round((json.percent_done || 0) * 60)
              event.sender.send('backup:progress', {
                phase: 'Backing up',
                percent,
                message: `${json.files_done || 0} files processed...`
              })
            } else if (json.message_type === 'summary') {
              snapshotId = json.snapshot_id
              output = JSON.stringify(json)
            }
          } catch {
            // Not JSON, ignore
          }
        }
      })
      
      backup.stderr.on('data', (data: Buffer) => {
        log('restic stderr: ' + data.toString())
      })
      
      backup.on('close', (code: number) => {
        if (code === 0) {
          try {
            const summary = output ? JSON.parse(output) : {}
            resolve({
              snapshotId,
              stats: {
                filesNew: summary.files_new || 0,
                filesChanged: summary.files_changed || 0,
                filesUnmodified: summary.files_unmodified || 0,
                bytesAdded: summary.data_added || 0,
                bytesTotal: summary.total_bytes_processed || 0
              }
            })
          } catch {
            resolve({ snapshotId, stats: {} })
          }
        } else {
          reject(new Error(`Backup failed with exit code ${code}`))
        }
      })
      
      backup.on('error', reject)
    })
    
    event.sender.send('backup:progress', { phase: 'Cleanup', percent: 85, message: 'Applying retention policy...' })
    
    // Apply retention policy
    await new Promise<void>((resolve, reject) => {
      const forget = spawn(resticCmd, [
        '-r', repo,
        'forget',
        '--keep-daily', String(config.retentionDaily),
        '--keep-weekly', String(config.retentionWeekly),
        '--keep-monthly', String(config.retentionMonthly),
        '--keep-yearly', String(config.retentionYearly),
        '--prune'
      ], { env })
      
      forget.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error('Failed to apply retention policy'))
      })
      forget.on('error', reject)
    })
    
    // Optional: Local backup
    let localBackupSuccess = false
    if (config.localBackupEnabled && config.localBackupPath) {
      event.sender.send('backup:progress', { phase: 'Local Backup', percent: 92, message: 'Creating local backup...' })
      try {
        const localPath = config.localBackupPath
        if (!fs.existsSync(localPath)) {
          fs.mkdirSync(localPath, { recursive: true })
        }
        // Copy working directory to local backup path
        const { execSync } = require('child_process')
        if (process.platform === 'win32') {
          execSync(`robocopy "${workingDirectory}" "${localPath}" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP`, { stdio: 'ignore' })
        } else {
          execSync(`rsync -a --delete "${workingDirectory}/" "${localPath}/"`, { stdio: 'ignore' })
        }
        localBackupSuccess = true
      } catch (err) {
        logError('Local backup failed', { error: String(err) })
      }
    }
    
    event.sender.send('backup:progress', { phase: 'Complete', percent: 100, message: 'Backup complete!' })
    
    log('Backup completed successfully', { snapshotId: backupResult.snapshotId })
    
    return {
      success: true,
      snapshotId: backupResult.snapshotId,
      localBackupSuccess,
      stats: backupResult.stats
    }
  } catch (err) {
    logError('Backup failed', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// List backup snapshots
ipcMain.handle('backup:list-snapshots', async (_, config: {
  provider: string
  bucket: string
  region?: string
  endpoint?: string
  accessKey: string
  secretKey: string
  resticPassword: string
}) => {
  const { spawn } = require('child_process')
  
  const env = {
    ...process.env,
    RESTIC_PASSWORD: config.resticPassword,
    AWS_ACCESS_KEY_ID: config.accessKey,
    AWS_SECRET_ACCESS_KEY: config.secretKey,
  }
  
  if (config.provider === 'backblaze_b2') {
    env.B2_ACCOUNT_ID = config.accessKey
    env.B2_ACCOUNT_KEY = config.secretKey
  }
  
  const repo = buildResticRepo(config)
  const resticCmd = getResticCommand()
  
  try {
    const snapshots = await new Promise<any[]>((resolve, reject) => {
      let output = ''
      let stderr = ''
      
      const list = spawn(resticCmd, ['-r', repo, 'snapshots', '--json'], { env })
      
      list.stdout.on('data', (data: Buffer) => {
        output += data.toString()
      })
      
      list.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      
      list.on('close', (code: number) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(output)
            resolve(parsed)
          } catch {
            resolve([])
          }
        } else {
          const errorMsg = stderr.trim() || `Restic exited with code ${code}`
          logError('Failed to list snapshots', { code, stderr: errorMsg, repo })
          reject(new Error(errorMsg))
        }
      })
      
      list.on('error', (err) => {
        logError('Failed to spawn restic for list snapshots', { error: String(err) })
        reject(err)
      })
    })
    
    return {
      success: true,
      snapshots: snapshots.map(s => ({
        id: s.short_id || s.id,
        time: s.time,
        hostname: s.hostname,
        paths: s.paths || [],
        tags: s.tags || []
      }))
    }
  } catch (err) {
    logError('Failed to list snapshots', { error: String(err) })
    return { success: false, error: String(err), snapshots: [] }
  }
})

// Delete a snapshot from restic
ipcMain.handle('backup:delete-snapshot', async (_, config: {
  provider: string
  bucket: string
  region?: string
  endpoint?: string
  accessKey: string
  secretKey: string
  resticPassword: string
  snapshotId: string
}) => {
  const { spawn } = require('child_process')
  
  log('Deleting snapshot...', { snapshotId: config.snapshotId })
  
  const env = {
    ...process.env,
    RESTIC_PASSWORD: config.resticPassword,
    AWS_ACCESS_KEY_ID: config.accessKey,
    AWS_SECRET_ACCESS_KEY: config.secretKey,
  }
  
  if (config.provider === 'backblaze_b2') {
    env.B2_ACCOUNT_ID = config.accessKey
    env.B2_ACCOUNT_KEY = config.secretKey
  }
  
  const repo = buildResticRepo(config)
  const resticCmd = getResticCommand()
  
  try {
    // Forget the snapshot (mark for deletion)
    await new Promise<void>((resolve, reject) => {
      const forget = spawn(resticCmd, ['-r', repo, 'forget', config.snapshotId], { env })
      let stderr = ''
      
      forget.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      
      forget.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error(stderr || `Exit code ${code}`))
      })
      forget.on('error', reject)
    })
    
    // Prune the repository to actually free space
    await new Promise<void>((resolve, reject) => {
      const prune = spawn(resticCmd, ['-r', repo, 'prune'], { env })
      
      prune.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error(`Prune failed with exit code ${code}`))
      })
      prune.on('error', reject)
    })
    
    log('Snapshot deleted successfully')
    return { success: true }
  } catch (err) {
    logError('Failed to delete snapshot', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// Restore from backup
ipcMain.handle('backup:restore', async (event, config: {
  provider: string
  bucket: string
  region?: string
  endpoint?: string
  accessKey: string
  secretKey: string
  resticPassword: string
  snapshotId: string
  targetPath: string
  specificPaths?: string[]
}) => {
  const { spawn } = require('child_process')
  
  log('Starting restore...', { snapshotId: config.snapshotId, targetPath: config.targetPath })
  
  const env = {
    ...process.env,
    RESTIC_PASSWORD: config.resticPassword,
    AWS_ACCESS_KEY_ID: config.accessKey,
    AWS_SECRET_ACCESS_KEY: config.secretKey,
  }
  
  if (config.provider === 'backblaze_b2') {
    env.B2_ACCOUNT_ID = config.accessKey
    env.B2_ACCOUNT_KEY = config.secretKey
  }
  
  const repo = buildResticRepo(config)
  const resticCmd = getResticCommand()
  
  try {
    const args = [
      '-r', repo,
      'restore', config.snapshotId,
      '--target', config.targetPath
    ]
    
    if (config.specificPaths && config.specificPaths.length > 0) {
      for (const p of config.specificPaths) {
        args.push('--include', p)
      }
    }
    
    await new Promise<void>((resolve, reject) => {
      const restore = spawn(resticCmd, args, { env })
      
      restore.stdout.on('data', (data: Buffer) => {
        log('restore stdout: ' + data.toString())
      })
      
      restore.stderr.on('data', (data: Buffer) => {
        log('restore stderr: ' + data.toString())
      })
      
      restore.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error(`Restore failed with exit code ${code}`))
      })
      
      restore.on('error', reject)
    })
    
    log('Restore completed successfully')
    
    // Check if metadata file exists in restored data
    const metadataPath = path.join(config.targetPath, '.blueplm', 'database-export.json')
    let hasMetadata = false
    if (fs.existsSync(metadataPath)) {
      hasMetadata = true
      log('Found database metadata in restored backup')
    }
    
    return { success: true, hasMetadata }
  } catch (err) {
    logError('Restore failed', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// Read database metadata from a vault directory
ipcMain.handle('backup:read-metadata', async (_, vaultPath: string) => {
  const metadataPath = path.join(vaultPath, '.blueplm', 'database-export.json')
  
  if (!fs.existsSync(metadataPath)) {
    return { success: false, error: 'No metadata file found' }
  }
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8')
    const data = JSON.parse(content)
    
    if (data._type !== 'blueplm_database_export') {
      return { success: false, error: 'Invalid metadata file format' }
    }
    
    log('Read database metadata from: ' + metadataPath)
    return { success: true, data }
  } catch (err) {
    logError('Failed to read metadata', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// ============================================
// Auto Updater
// ============================================

// Configure auto-updater
autoUpdater.autoDownload = false  // Don't auto-download, let user decide
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.logger = {
  info: (message: string) => writeLog('info', `[AutoUpdater] ${message}`),
  warn: (message: string) => writeLog('warn', `[AutoUpdater] ${message}`),
  error: (message: string) => writeLog('error', `[AutoUpdater] ${message}`),
  debug: (message: string) => writeLog('debug', `[AutoUpdater] ${message}`)
}

// Track update state
let updateAvailable: UpdateInfo | null = null
let updateDownloaded = false
let downloadProgress: ProgressInfo | null = null

// Update reminder state persistence
interface UpdateReminder {
  version: string
  postponedAt: number  // timestamp
}

const updateReminderFile = path.join(app.getPath('userData'), 'update-reminder.json')

function loadUpdateReminder(): UpdateReminder | null {
  try {
    if (fs.existsSync(updateReminderFile)) {
      const data = fs.readFileSync(updateReminderFile, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Failed to load update reminder:', err)
  }
  return null
}

function saveUpdateReminder(reminder: UpdateReminder): void {
  try {
    fs.writeFileSync(updateReminderFile, JSON.stringify(reminder, null, 2))
  } catch (err) {
    console.error('Failed to save update reminder:', err)
  }
}

function clearUpdateReminder(): void {
  try {
    if (fs.existsSync(updateReminderFile)) {
      fs.unlinkSync(updateReminderFile)
    }
  } catch (err) {
    console.error('Failed to clear update reminder:', err)
  }
}

function shouldShowUpdate(version: string): boolean {
  const reminder = loadUpdateReminder()
  if (!reminder) return true
  
  // If it's a different version, show it
  if (reminder.version !== version) {
    clearUpdateReminder()
    return true
  }
  
  // Check if 24 hours have passed
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const timeSincePostponed = Date.now() - reminder.postponedAt
  
  if (timeSincePostponed >= TWENTY_FOUR_HOURS) {
    log(`Update reminder expired (${Math.round(timeSincePostponed / 1000 / 60 / 60)} hours), showing update`)
    clearUpdateReminder()
    return true
  }
  
  log(`Update postponed ${Math.round(timeSincePostponed / 1000 / 60)} minutes ago, will remind in ${Math.round((TWENTY_FOUR_HOURS - timeSincePostponed) / 1000 / 60)} minutes`)
  return false
}

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  log('Checking for updates...')
  mainWindow?.webContents.send('updater:checking')
})

autoUpdater.on('update-available', (info: UpdateInfo) => {
  log('Update available:', info.version)
  updateAvailable = info
  
  // Check if user has postponed this update recently
  if (shouldShowUpdate(info.version)) {
    mainWindow?.webContents.send('updater:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  } else {
    log('Update notification suppressed - user postponed recently')
  }
  
  isUserInitiatedCheck = false
})

autoUpdater.on('update-not-available', (info: UpdateInfo) => {
  log('No update available, current version is latest')
  updateAvailable = null
  isUserInitiatedCheck = false
  mainWindow?.webContents.send('updater:not-available', {
    version: info.version
  })
})

autoUpdater.on('download-progress', (progress: ProgressInfo) => {
  downloadProgress = progress
  mainWindow?.webContents.send('updater:download-progress', {
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total
  })
})

autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
  log('Update downloaded:', info.version)
  updateDownloaded = true
  downloadProgress = null
  mainWindow?.webContents.send('updater:downloaded', {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes
  })
})

// Track if this is a user-initiated check (vs auto-check on startup)
let isUserInitiatedCheck = false

autoUpdater.on('error', (error: Error) => {
  logError('Auto-updater error', { error: error.message })
  downloadProgress = null
  // Only show error to user if they manually triggered the check
  // Suppress errors from automatic startup checks (network issues, release not ready, etc.)
  if (isUserInitiatedCheck) {
    mainWindow?.webContents.send('updater:error', {
      message: error.message
    })
  }
  isUserInitiatedCheck = false
})

// IPC handlers for update operations
ipcMain.handle('updater:check', async () => {
  try {
    if (isDev) {
      log('Skipping update check in development mode')
      return { success: false, error: 'Updates disabled in development' }
    }
    isUserInitiatedCheck = true  // Mark as user-initiated so errors are shown
    const result = await autoUpdater.checkForUpdates()
    return { success: true, updateInfo: result?.updateInfo }
  } catch (err) {
    logError('Failed to check for updates', { error: String(err) })
    isUserInitiatedCheck = false
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('updater:download', async () => {
  try {
    if (!updateAvailable) {
      return { success: false, error: 'No update available' }
    }
    log('Starting update download...')
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (err) {
    logError('Failed to download update', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('updater:install', () => {
  if (!updateDownloaded) {
    return { success: false, error: 'No update downloaded' }
  }
  log('Installing update and restarting...')
  autoUpdater.quitAndInstall(false, true)
  return { success: true }
})

ipcMain.handle('updater:get-status', () => {
  return {
    updateAvailable: updateAvailable ? {
      version: updateAvailable.version,
      releaseDate: updateAvailable.releaseDate,
      releaseNotes: updateAvailable.releaseNotes
    } : null,
    updateDownloaded,
    downloadProgress: downloadProgress ? {
      percent: downloadProgress.percent,
      bytesPerSecond: downloadProgress.bytesPerSecond,
      transferred: downloadProgress.transferred,
      total: downloadProgress.total
    } : null
  }
})

// Postpone update reminder (remind later)
ipcMain.handle('updater:postpone', (_, version: string) => {
  log(`User postponed update for version ${version}`)
  saveUpdateReminder({
    version,
    postponedAt: Date.now()
  })
  return { success: true }
})

// Clear update reminder (e.g., when user clicks download)
ipcMain.handle('updater:clear-reminder', () => {
  log('Clearing update reminder')
  clearUpdateReminder()
  return { success: true }
})

// Get reminder status
ipcMain.handle('updater:get-reminder', () => {
  const reminder = loadUpdateReminder()
  return reminder
})

// Download a specific version's installer from GitHub releases
ipcMain.handle('updater:download-version', async (_, version: string, downloadUrl: string) => {
  log(`Downloading specific version: ${version} from ${downloadUrl}`)
  
  try {
    const https = await import('https')
    const http = await import('http')
    const fs = await import('fs')
    const nodePath = await import('path')
    
    // Create temp directory for download
    const tempDir = nodePath.join(app.getPath('temp'), 'blueplm-updates')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    
    // Determine filename from URL
    const urlParts = new URL(downloadUrl)
    const fileName = nodePath.basename(urlParts.pathname)
    const filePath = nodePath.join(tempDir, fileName)
    
    // Download the file with redirect handling
    const downloadWithRedirects = (url: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      return new Promise((resolve) => {
        const protocol = url.startsWith('https') ? https : http
        
        protocol.get(url, (response) => {
          // Handle redirects (GitHub uses them)
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location
            if (redirectUrl) {
              log(`Following redirect to: ${redirectUrl}`)
              downloadWithRedirects(redirectUrl).then(resolve)
              return
            }
          }
          
          if (response.statusCode !== 200) {
            resolve({ success: false, error: `HTTP ${response.statusCode}` })
            return
          }
          
          const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedBytes = 0
          let lastProgressUpdate = Date.now()
          let lastBytes = 0
          
          const file = fs.createWriteStream(filePath)
          
          response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length
            
            // Throttle progress updates to every 100ms
            const now = Date.now()
            if (now - lastProgressUpdate >= 100) {
              const elapsed = (now - lastProgressUpdate) / 1000
              const bytesPerSecond = elapsed > 0 ? (downloadedBytes - lastBytes) / elapsed : 0
              const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0
              
              // Send progress to renderer
              if (mainWindow) {
                mainWindow.webContents.send('update-download-progress', {
                  percent,
                  bytesPerSecond,
                  transferred: downloadedBytes,
                  total: totalBytes
                })
              }
              
              lastProgressUpdate = now
              lastBytes = downloadedBytes
            }
          })
          
          response.pipe(file)
          
          file.on('finish', () => {
            file.close()
            log(`Downloaded installer to: ${filePath}`)
            resolve({ success: true, filePath })
          })
          
          file.on('error', (err) => {
            fs.unlink(filePath, () => {}) // Delete partial file
            resolve({ success: false, error: String(err) })
          })
        }).on('error', (err) => {
          resolve({ success: false, error: String(err) })
        })
      })
    }
    
    return await downloadWithRedirects(downloadUrl)
  } catch (err) {
    logError('Failed to download version installer', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// Run a downloaded installer
ipcMain.handle('updater:run-installer', async (_, filePath: string) => {
  log(`Running installer: ${filePath}`)
  
  try {
    const fs = await import('fs')
    
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Installer file not found' }
    }
    
    // Open the installer with the default application
    await shell.openPath(filePath)
    
    // Quit the app so the installer can update it
    setTimeout(() => {
      app.quit()
    }, 1000)
    
    return { success: true }
  } catch (err) {
    logError('Failed to run installer', { error: String(err) })
    return { success: false, error: String(err) }
  }
})

// ============================================
// App Lifecycle
// ============================================

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  // Initialize file-based logging now that app paths are available
  initializeLogging()
  
  log('App ready, creating window...')
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
  
  // Check for updates after a short delay (let the app fully load first)
  if (!isDev) {
    setTimeout(() => {
      log('Auto-checking for updates...')
      autoUpdater.checkForUpdates().catch(err => {
        logError('Auto update check failed', { error: String(err) })
      })
    }, 5000) // 5 second delay
  }
}).catch(err => {
  logError('Error during app ready', { error: String(err) })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ============================================
// External CLI Server (for development/automation)
// ============================================
const CLI_PORT = 31337

let cliServer: http.Server | null = null
let pendingCliRequests: Map<string, { resolve: (result: unknown) => void, reject: (err: Error) => void }> = new Map()

function startCliServer() {
  if (cliServer) return
  
  cliServer = http.createServer(async (req, res) => {
    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Content-Type', 'application/json')
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }
    
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const { command } = JSON.parse(body)
        
        if (!command || typeof command !== 'string') {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Missing command' }))
          return
        }
        
        log(`[CLI Server] Received command: ${command}`)
        
        // Handle reload command directly in main process
        if (command === 'reload-app' || command === 'restart') {
          log('[CLI Server] Reloading app...')
          if (mainWindow) {
            mainWindow.webContents.reload()
            res.writeHead(200)
            res.end(JSON.stringify({ success: true, result: { outputs: [{ type: 'info', content: 'Reloading app...' }] } }))
          } else {
            res.writeHead(503)
            res.end(JSON.stringify({ error: 'No window' }))
          }
          return
        }
        
        // Generate unique request ID
        const requestId = `cli-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        
        // Send command to renderer and wait for response
        const resultPromise = new Promise((resolve, reject) => {
          pendingCliRequests.set(requestId, { resolve, reject })
          
          // Timeout after 30 seconds
          setTimeout(() => {
            if (pendingCliRequests.has(requestId)) {
              pendingCliRequests.delete(requestId)
              reject(new Error('Command timeout'))
            }
          }, 30000)
        })
        
        // Send to renderer
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('cli-command', { requestId, command })
        } else {
          res.writeHead(503)
          res.end(JSON.stringify({ error: 'App not ready' }))
          return
        }
        
        const result = await resultPromise
        res.writeHead(200)
        res.end(JSON.stringify({ success: true, result }))
        
      } catch (err) {
        log(`[CLI Server] Error: ${err}`)
        res.writeHead(500)
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
  })
  
  cliServer.listen(CLI_PORT, '127.0.0.1', () => {
    log(`[CLI Server] Listening on http://127.0.0.1:${CLI_PORT}`)
    console.log(`\n📟 BluePLM CLI Server running on port ${CLI_PORT}`)
    console.log(`   Use: node cli/blueplm.js <command>\n`)
  })
  
  cliServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`[CLI Server] Port ${CLI_PORT} already in use`)
    } else {
      logError('[CLI Server] Error', { error: String(err) })
    }
  })
}

// IPC handler for CLI command responses from renderer
ipcMain.on('cli-response', (_, { requestId, result }) => {
  const pending = pendingCliRequests.get(requestId)
  if (pending) {
    pendingCliRequests.delete(requestId)
    pending.resolve(result)
  }
})

// Start CLI server when app is ready (only in dev mode or if env var is set)
app.whenReady().then(() => {
  if (isDev || process.env.BLUEPLM_CLI === '1') {
    startCliServer()
  }
})
