// System handlers for Electron main process
import { app, ipcMain, BrowserWindow, clipboard } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import * as si from 'systeminformation'

// Module state
let mainWindow: BrowserWindow | null = null
let log: (message: string, data?: unknown) => void = console.log

// Analytics settings
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

function writeAnalyticsEnabled(enabled: boolean): void {
  try {
    const settingsPath = getAnalyticsSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({ enabled }), 'utf8')
  } catch (err) {
    console.error('[Analytics] Failed to write settings:', err)
  }
}

export interface SystemHandlerDependencies {
  log: (message: string, data?: unknown) => void
}

export function registerSystemHandlers(window: BrowserWindow, deps: SystemHandlerDependencies): void {
  mainWindow = window
  log = deps.log

  // App info handlers
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-platform', () => process.platform)
  ipcMain.handle('app:get-app-version', () => app.getVersion())

  // Analytics handlers
  ipcMain.handle('analytics:set-enabled', (_, enabled: boolean) => {
    writeAnalyticsEnabled(enabled)
    return { success: true }
  })

  ipcMain.handle('analytics:get-enabled', () => {
    return { enabled: readAnalyticsEnabled() }
  })

  // Machine identification
  ipcMain.handle('app:get-machine-id', () => {
    try {
      const hostname = require('os').hostname()
      const cpus = require('os').cpus()
      const cpuInfo = cpus[0]?.model || 'unknown'
      const raw = `${hostname}-${cpuInfo}-${process.platform}`
      const hash = crypto.createHash('sha256').update(raw).digest('hex')
      return hash.substring(0, 16)
    } catch {
      return 'unknown'
    }
  })

  ipcMain.handle('app:get-machine-name', () => {
    return require('os').hostname()
  })

  // Clipboard handlers
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('clipboard:read-text', () => {
    try {
      return { success: true, text: clipboard.readText() }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Titlebar handlers
  ipcMain.handle('app:get-titlebar-overlay-rect', () => {
    if (!mainWindow) return { x: 0, y: 0, width: 138, height: 38 }
    // getTitleBarOverlayRect may not exist on all Electron versions
    const win = mainWindow as BrowserWindow & { getTitleBarOverlayRect?: () => { x: number; y: number; width: number; height: number } }
    return win.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
  })

  ipcMain.handle('app:set-titlebar-overlay', (_event, options: { color: string; symbolColor: string }) => {
    if (!mainWindow) return { success: false }
    try {
      if (mainWindow.setTitleBarOverlay) {
        mainWindow.setTitleBarOverlay({
          color: options.color,
          symbolColor: options.symbolColor,
          height: 36
        })
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // App control
  ipcMain.handle('app:reload', () => {
    if (mainWindow) {
      mainWindow.webContents.reload()
      return { success: true }
    }
    return { success: false, error: 'No window' }
  })

  ipcMain.handle('app:request-focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const allWindows = BrowserWindow.getAllWindows()
      for (const win of allWindows) {
        if (win !== mainWindow && !win.isDestroyed()) {
          log('[Window] Closing child window: ' + win.getTitle())
          win.close()
        }
      }
      
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      
      if (process.platform === 'darwin') {
        app.dock?.show()
      }
      
      return { success: true }
    }
    return { success: false, error: 'No window' }
  })

  // Performance window
  ipcMain.handle('app:open-performance-window', () => {
    const perfWindow = new BrowserWindow({
      width: 600,
      height: 500,
      title: 'Performance Monitor',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
    if (isDev) {
      perfWindow.loadURL('http://localhost:5173/#/performance')
    } else {
      perfWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'), {
        hash: '/performance'
      })
    }
    
    return { success: true }
  })

  // Tab window creation
  ipcMain.handle('app:create-tab-window', (_event, view: string, title: string, customData?: Record<string, unknown>) => {
    const tabWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      title: title || 'BluePLM',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
    const queryParams = customData ? `?data=${encodeURIComponent(JSON.stringify(customData))}` : ''
    
    if (isDev) {
      tabWindow.loadURL(`http://localhost:5173/#/${view}${queryParams}`)
    } else {
      tabWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'), {
        hash: `/${view}${queryParams}`
      })
    }
    
    return { success: true, windowId: tabWindow.id }
  })

  // Zoom handlers
  ipcMain.handle('app:get-zoom-factor', () => {
    if (!mainWindow) return 1
    return mainWindow.webContents.getZoomFactor()
  })

  ipcMain.handle('app:set-zoom-factor', (_event, factor: number) => {
    if (!mainWindow) return { success: false }
    mainWindow.webContents.setZoomFactor(factor)
    mainWindow.webContents.send('zoom-changed', factor)
    return { success: true }
  })

  // Window size handlers
  ipcMain.handle('app:get-window-size', () => {
    if (!mainWindow) return { width: 1400, height: 900 }
    const bounds = mainWindow.getBounds()
    return { width: bounds.width, height: bounds.height }
  })

  ipcMain.handle('app:set-window-size', (_event, width: number, height: number) => {
    if (!mainWindow) return { success: false }
    mainWindow.setSize(width, height)
    return { success: true }
  })

  ipcMain.handle('app:reset-window-size', () => {
    if (!mainWindow) return { success: false }
    mainWindow.setSize(1400, 900)
    mainWindow.center()
    mainWindow.webContents.setZoomFactor(1)
    mainWindow.webContents.send('zoom-changed', 1)
    return { success: true }
  })

  // System stats - returns data directly (no wrapper) for component compatibility
  ipcMain.handle('system:get-stats', async () => {
    try {
      const [cpuLoad, mem, diskLayout, netStats] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats()
      ])
      
      const cpuUsage = Math.round(cpuLoad.currentLoad)
      const coreUsages = cpuLoad.cpus.map(c => Math.round(c.load))
      const memoryUsed = mem.used
      const memoryTotal = mem.total
      const memoryPercent = Math.round((memoryUsed / memoryTotal) * 100)
      
      let diskUsed = 0
      let diskTotal = 0
      let diskPercent = 0
      
      if (diskLayout.length > 0) {
        const mainDisk = diskLayout[0]
        diskUsed = mainDisk.used
        diskTotal = mainDisk.size
        diskPercent = Math.round(mainDisk.use)
      }
      
      // Network stats - sum all interfaces
      let rxSpeed = 0
      let txSpeed = 0
      for (const iface of netStats) {
        rxSpeed += iface.rx_sec || 0
        txSpeed += iface.tx_sec || 0
      }
      
      return {
        cpu: { 
          usage: cpuUsage,
          cores: coreUsages
        },
        memory: {
          used: memoryUsed,
          total: memoryTotal,
          percent: memoryPercent
        },
        disk: {
          used: diskUsed,
          total: diskTotal,
          percent: diskPercent
        },
        network: {
          rxSpeed,
          txSpeed
        }
      }
    } catch (err) {
      console.error('[System] Failed to get stats:', err)
      return null
    }
  })

  // Window state handlers
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized())

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  
  ipcMain.on('window:close', () => mainWindow?.close())
}

export function unregisterSystemHandlers(): void {
  const handlers = [
    'app:get-version', 'app:get-platform', 'app:get-app-version',
    'analytics:set-enabled', 'analytics:get-enabled',
    'app:get-machine-id', 'app:get-machine-name',
    'clipboard:write-text', 'clipboard:read-text',
    'app:get-titlebar-overlay-rect', 'app:set-titlebar-overlay',
    'app:reload', 'app:request-focus', 'app:open-performance-window', 'app:create-tab-window',
    'app:get-zoom-factor', 'app:set-zoom-factor',
    'app:get-window-size', 'app:set-window-size', 'app:reset-window-size',
    'system:get-stats', 'window:is-maximized'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
  
  ipcMain.removeAllListeners('window:minimize')
  ipcMain.removeAllListeners('window:maximize')
  ipcMain.removeAllListeners('window:close')
}
