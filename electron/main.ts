// BluePLM Electron Main Process
// This file contains only app lifecycle, window creation, and imports handlers from modules

import { app, BrowserWindow, ipcMain, shell, screen, nativeTheme, session } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { fileURLToPath } from 'url'
import * as Sentry from '@sentry/electron/main'

import { registerAllHandlers, initializeLogging, writeLog } from './handlers'
import { createAppMenu } from './menu'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================
// Sentry Error Tracking (Main Process)
// ============================================

const SENTRY_DSN = process.env.VITE_SENTRY_DSN || 'https://7e0fa5359dedac9d87c951c593def9fa@o4510557909417984.ingest.us.sentry.io/4510557913350144'

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
    } catch (err) {
      console.error('[Sentry] Failed to initialize:', err)
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
  } catch (err) {
    console.error('Failed to load window state:', err)
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
      isMaximized
    }
    
    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('Failed to save window state:', err)
  }
}

// ============================================
// Main Window
// ============================================

let mainWindow: BrowserWindow | null = null

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Follow system dark/light mode for web content
nativeTheme.themeSource = 'system'

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

const isTestMode = process.argv.includes('--test-mode') || process.env.BLUEPLM_TEST === '1'
const gotTheLock = isTestMode ? true : app.requestSingleInstanceLock()

if (!gotTheLock) {
  log('Another instance is running, quitting...')
  app.quit()
} else {
  log(isTestMode ? 'Running in test mode (single instance lock bypassed)' : 'Got single instance lock')
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
      color: '#181818',
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
  mainWindow.on('resize', () => saveWindowState(mainWindow!))
  mainWindow.on('move', () => saveWindowState(mainWindow!))
  mainWindow.on('maximize', () => saveWindowState(mainWindow!))
  mainWindow.on('unmaximize', () => saveWindowState(mainWindow!))

  let windowShown = false
  const showWindow = () => {
    if (!windowShown && mainWindow) {
      windowShown = true
      mainWindow.show()
    }
  }

  mainWindow.once('ready-to-show', showWindow)
  setTimeout(showWindow, 5000)

  mainWindow.webContents.on('render-process-gone', () => log('Renderer process crashed!'))
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log('Failed to load: ' + errorCode + ' ' + errorDescription)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    log('Page finished loading')
    if (mainWindow) {
      // getTitleBarOverlayRect may not exist on all Electron versions
      const win = mainWindow as BrowserWindow & { getTitleBarOverlayRect?: () => { x: number; y: number; width: number; height: number } }
      const overlayRect = win.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
      mainWindow.webContents.send('titlebar-overlay-rect', overlayRect)
    }
  })

  const loadPath = isDev 
    ? 'http://localhost:5173' 
    : path.join(__dirname, '../dist/index.html')
  
  log('Loading: ' + loadPath)
  
  if (isDev) {
    mainWindow.loadURL(loadPath)
  } else {
    mainWindow.loadFile(loadPath).catch(err => log('Error loading file: ' + String(err)))
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
    
    const isGoogleAuth = url.includes('accounts.google.com') || 
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
        parent: process.platform === 'darwin' ? undefined : (mainWindow || undefined),
        modal: false,
        show: true,
        title: 'Sign in to Google',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
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
    mainWindow = null
  })

  // Register all IPC handlers
  registerAllHandlers(mainWindow, {
    restoreMainWindowFocus
  })

  // Create application menu
  createAppMenu(mainWindow, { log })
}

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
  // Initialize file-based logging
  initializeLogging()
  
  // Initialize Sentry for crash reporting
  initSentryMain()
  
  log('App ready, creating window...')
  createWindow()

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
        
        const requestId = `cli-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        
        const resultPromise = new Promise((resolve, reject) => {
          pendingCliRequests.set(requestId, { resolve, reject })
          
          setTimeout(() => {
            if (pendingCliRequests.has(requestId)) {
              pendingCliRequests.delete(requestId)
              reject(new Error('Command timeout'))
            }
          }, 30000)
        })
        
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
