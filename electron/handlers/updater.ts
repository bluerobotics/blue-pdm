// Auto-updater handlers for Electron main process
import { app, ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'

// Module state
let mainWindow: BrowserWindow | null = null
let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error

// Update state
let updateAvailable: UpdateInfo | null = null
let updateDownloaded = false
let downloadProgress: ProgressInfo | null = null
let isUserInitiatedCheck = false

// Update check timing
let lastUpdateCheck = 0
const UPDATE_CHECK_COOLDOWN = 30 * 1000
const UPDATE_CHECK_INTERVAL = 2 * 60 * 1000
let updateCheckTimer: ReturnType<typeof setInterval> | null = null

// Update reminder state
interface UpdateReminder {
  version: string
  postponedAt: number
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function getUpdateReminderFile(): string {
  return path.join(app.getPath('userData'), 'update-reminder.json')
}

function loadUpdateReminder(): UpdateReminder | null {
  try {
    const reminderFile = getUpdateReminderFile()
    if (fs.existsSync(reminderFile)) {
      const data = fs.readFileSync(reminderFile, 'utf-8')
      return JSON.parse(data)
    }
  } catch {}
  return null
}

function saveUpdateReminder(reminder: UpdateReminder): void {
  try {
    fs.writeFileSync(getUpdateReminderFile(), JSON.stringify(reminder, null, 2))
  } catch {}
}

function clearUpdateReminder(): void {
  try {
    const reminderFile = getUpdateReminderFile()
    if (fs.existsSync(reminderFile)) {
      fs.unlinkSync(reminderFile)
    }
  } catch {}
}

function shouldShowUpdate(version: string): boolean {
  const reminder = loadUpdateReminder()
  if (!reminder) return true
  
  if (reminder.version !== version) {
    clearUpdateReminder()
    return true
  }
  
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const timeSincePostponed = Date.now() - reminder.postponedAt
  
  if (timeSincePostponed >= TWENTY_FOUR_HOURS) {
    log('Update reminder expired, showing update')
    clearUpdateReminder()
    return true
  }
  
  return false
}

async function performAutoUpdateCheck(reason: string): Promise<void> {
  if (isDev) return
  
  const now = Date.now()
  const timeSinceLastCheck = now - lastUpdateCheck
  
  if (timeSinceLastCheck < UPDATE_CHECK_COOLDOWN) {
    log(`[Update] Skipping check (${reason}) - checked ${Math.round(timeSinceLastCheck / 1000)}s ago`)
    return
  }
  
  if (updateAvailable && !updateDownloaded) {
    log(`[Update] Skipping check (${reason}) - update already available: v${updateAvailable.version}`)
    return
  }
  
  lastUpdateCheck = now
  log(`[Update] Checking for updates (${reason})...`)
  
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log(`[Update] Auto check failed: ${String(err)}`)
  }
}

export interface UpdaterHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

export function registerUpdaterHandlers(window: BrowserWindow, deps: UpdaterHandlerDependencies): void {
  mainWindow = window
  log = deps.log
  logError = deps.logError

  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (message: string) => log(`[AutoUpdater] ${message}`),
    warn: (message: string) => log(`[AutoUpdater] ${message}`),
    error: (message: string) => logError(`[AutoUpdater] ${message}`),
    debug: (message: string) => log(`[AutoUpdater] ${message}`)
  }

  // Auto-updater event handlers
  autoUpdater.on('checking-for-update', () => {
    log('Checking for updates...')
    mainWindow?.webContents.send('updater:checking')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log('Update available: ' + info.version)
    updateAvailable = info
    
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
    log('Update downloaded: ' + info.version)
    updateDownloaded = true
    downloadProgress = null
    mainWindow?.webContents.send('updater:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('error', (error: Error) => {
    logError('Auto-updater error', { error: error.message })
    downloadProgress = null
    if (isUserInitiatedCheck) {
      mainWindow?.webContents.send('updater:error', {
        message: error.message
      })
    }
    isUserInitiatedCheck = false
  })

  // IPC handlers
  ipcMain.handle('updater:check', async () => {
    try {
      if (isDev) {
        log('Skipping update check in development mode')
        return { success: false, error: 'Updates disabled in development' }
      }
      isUserInitiatedCheck = true
      await autoUpdater.checkForUpdates()
      return { success: true, updateInfo: updateAvailable }
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
    
    setImmediate(() => {
      try {
        if (process.platform === 'darwin') {
          log('[Update] macOS: Using app.relaunch + app.exit for update installation')
          autoUpdater.autoInstallOnAppQuit = true
          app.relaunch()
          app.exit(0)
        } else {
          autoUpdater.quitAndInstall(false, true)
        }
      } catch (err) {
        logError('[Update] quitAndInstall failed, trying fallback', { error: String(err) })
        try {
          app.relaunch()
          app.exit(0)
        } catch {
          app.quit()
        }
      }
    })
    
    return { success: true }
  })

  ipcMain.handle('updater:get-status', () => {
    const shouldShow = updateAvailable ? shouldShowUpdate(updateAvailable.version) : false
    
    return {
      updateAvailable: (updateAvailable && shouldShow) ? {
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

  ipcMain.handle('updater:postpone', (_, version: string) => {
    log(`User postponed update for version ${version}`)
    saveUpdateReminder({
      version,
      postponedAt: Date.now()
    })
    return { success: true }
  })

  ipcMain.handle('updater:clear-reminder', () => {
    log('Clearing update reminder')
    clearUpdateReminder()
    return { success: true }
  })

  ipcMain.handle('updater:get-reminder', () => {
    return loadUpdateReminder()
  })

  // Download specific version installer
  ipcMain.handle('updater:download-version', async (_, version: string, downloadUrl: string) => {
    log(`Downloading specific version: ${version} from ${downloadUrl}`)
    
    try {
      const https = await import('https')
      const http = await import('http')
      
      const tempDir = path.join(app.getPath('temp'), 'blueplm-updates')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }
      
      const urlParts = new URL(downloadUrl)
      const fileName = path.basename(urlParts.pathname)
      const filePath = path.join(tempDir, fileName)
      
      const downloadWithRedirects = (url: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
        return new Promise((resolve) => {
          const protocol = url.startsWith('https') ? https : http
          
          protocol.get(url, (response) => {
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
              
              const now = Date.now()
              if (now - lastProgressUpdate >= 100) {
                const elapsed = (now - lastProgressUpdate) / 1000
                const bytesPerSecond = elapsed > 0 ? (downloadedBytes - lastBytes) / elapsed : 0
                const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0
                
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
              fs.unlink(filePath, () => {})
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

  // Run downloaded installer
  ipcMain.handle('updater:run-installer', async (_, filePath: string) => {
    log(`Running installer: ${filePath}`)
    
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Installer file not found' }
      }
      
      await shell.openPath(filePath)
      
      setTimeout(() => {
        app.quit()
      }, 1000)
      
      return { success: true }
    } catch (err) {
      logError('Failed to run installer', { error: String(err) })
      return { success: false, error: String(err) }
    }
  })

  // Start periodic update checks
  if (!isDev) {
    setTimeout(() => {
      performAutoUpdateCheck('startup')
    }, 5000)
    
    updateCheckTimer = setInterval(() => {
      performAutoUpdateCheck('periodic')
    }, UPDATE_CHECK_INTERVAL)
    
    mainWindow?.on('focus', () => {
      performAutoUpdateCheck('window-focus')
    })
  }
}

export function unregisterUpdaterHandlers(): void {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
  
  const handlers = [
    'updater:check', 'updater:download', 'updater:install', 'updater:get-status',
    'updater:postpone', 'updater:clear-reminder', 'updater:get-reminder',
    'updater:download-version', 'updater:run-installer'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}
