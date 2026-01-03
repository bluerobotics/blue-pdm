// Logging handlers for Electron main process
import { app, ipcMain, BrowserWindow, shell, dialog } from 'electron'
import fs from 'fs'
import path from 'path'

// Log retention settings interface
interface LogRetentionSettings {
  maxFiles: number
  maxAgeDays: number
  maxSizeMb: number
  maxTotalSizeMb: number
}

// Default settings
const DEFAULT_LOG_RETENTION: LogRetentionSettings = {
  maxFiles: 100,
  maxAgeDays: 7,
  maxSizeMb: 10,
  maxTotalSizeMb: 500
}

// Module state
let mainWindow: BrowserWindow | null = null
let logRetentionSettings: LogRetentionSettings = { ...DEFAULT_LOG_RETENTION }
let logRecordingEnabled = true
let logFilePath: string | null = null
let logStream: fs.WriteStream | null = null
let currentLogSize = 0
let logSettingsFilePath: string | null = null

// In-memory log buffer
interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

const logBuffer: LogEntry[] = []
const LOG_BUFFER_MAX = 1000

function getLogSettingsPath(): string {
  if (!logSettingsFilePath) {
    logSettingsFilePath = path.join(app.getPath('userData'), 'log-settings.json')
  }
  return logSettingsFilePath
}

function getLogRecordingStatePath(): string {
  return path.join(app.getPath('userData'), 'log-recording-state.json')
}

function loadLogRecordingState(): boolean {
  try {
    const statePath = getLogRecordingStatePath()
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      logRecordingEnabled = data.enabled !== false
    }
  } catch {
    logRecordingEnabled = true
  }
  return logRecordingEnabled
}

function saveLogRecordingState(enabled: boolean): boolean {
  try {
    const statePath = getLogRecordingStatePath()
    fs.writeFileSync(statePath, JSON.stringify({ enabled }), 'utf8')
    logRecordingEnabled = enabled
    return true
  } catch {
    return false
  }
}

function loadLogRetentionSettings(): LogRetentionSettings {
  try {
    const settingsPath = getLogSettingsPath()
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8')
      const loaded = JSON.parse(data) as Partial<LogRetentionSettings>
      logRetentionSettings = {
        maxFiles: loaded.maxFiles ?? DEFAULT_LOG_RETENTION.maxFiles,
        maxAgeDays: loaded.maxAgeDays ?? DEFAULT_LOG_RETENTION.maxAgeDays,
        maxSizeMb: loaded.maxSizeMb ?? DEFAULT_LOG_RETENTION.maxSizeMb,
        maxTotalSizeMb: loaded.maxTotalSizeMb ?? DEFAULT_LOG_RETENTION.maxTotalSizeMb
      }
    }
  } catch {
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
  } catch {
    return false
  }
}

function formatDateForFilename(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
}

function cleanupOldLogFiles(logsDir: string) {
  try {
    const { maxFiles, maxAgeDays, maxTotalSizeMb } = logRetentionSettings
    const now = Date.now()
    const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0
    const maxTotalSizeBytes = maxTotalSizeMb > 0 ? maxTotalSizeMb * 1024 * 1024 : 0
    
    let logFiles = fs.readdirSync(logsDir)
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
    
    // Delete old files by age
    if (maxAgeDays > 0) {
      for (const file of logFiles) {
        const age = now - file.mtime
        if (age > maxAgeMs) {
          try {
            fs.unlinkSync(file.path)
          } catch {}
        }
      }
    }
    
    // Re-read after age cleanup
    logFiles = fs.readdirSync(logsDir)
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
    
    // Delete files beyond count limit
    if (maxFiles > 0 && logFiles.length >= maxFiles) {
      const filesToDelete = logFiles.slice(maxFiles - 1)
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path)
        } catch {}
      }
      logFiles = logFiles.slice(0, maxFiles - 1)
    }
    
    // Delete files beyond total size limit
    if (maxTotalSizeBytes > 0) {
      let totalSize = logFiles.reduce((sum, f) => sum + f.size, 0)
      
      while (totalSize > maxTotalSizeBytes && logFiles.length > 1) {
        const oldestFile = logFiles.pop()!
        try {
          fs.unlinkSync(oldestFile.path)
          totalSize -= oldestFile.size
        } catch {}
      }
    }
  } catch {}
}

function rotateLogFile() {
  try {
    if (logStream) {
      logStream.end()
      logStream = null
    }
    
    const logsDir = path.join(app.getPath('userData'), 'logs')
    cleanupOldLogFiles(logsDir)
    
    const newTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${newTimestamp}.log`)
    logStream = fs.createWriteStream(logFilePath, { flags: 'w' })
    currentLogSize = 0
    
    const header = `${'='.repeat(60)}\nBluePLM Log (continued)\nRotated: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\n${'='.repeat(60)}\n\n`
    logStream.write(header)
    currentLogSize += Buffer.byteLength(header, 'utf8')
  } catch {}
}

// Write log entry
export function writeLog(level: LogEntry['level'], message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data
  }
  
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift()
  }
  
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
  const logLine = `[${entry.timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`
  
  if (level === 'error') {
    console.error(logLine.trim())
  } else if (level === 'warn') {
    console.warn(logLine.trim())
  } else {
    console.log(logLine.trim())
  }
  
  if (logRecordingEnabled && logStream) {
    const lineBytes = Buffer.byteLength(logLine, 'utf8')
    const maxSize = logRetentionSettings.maxSizeMb * 1024 * 1024
    
    if (currentLogSize + lineBytes > maxSize) {
      rotateLogFile()
    }
    
    logStream.write(logLine)
    currentLogSize += lineBytes
  }
}

// Initialize logging
export function initializeLogging() {
  try {
    loadLogRetentionSettings()
    loadLogRecordingState()
    
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    
    const sessionTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${sessionTimestamp}.log`)
    
    cleanupOldLogFiles(logsDir)
    
    logStream = fs.createWriteStream(logFilePath, { flags: 'w' })
    currentLogSize = 0
    
    const startupHeader = `${'='.repeat(60)}\nBluePLM Session Log\nStarted: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\nPlatform: ${process.platform} ${process.arch}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n${'='.repeat(60)}\n\n`
    logStream.write(startupHeader)
    currentLogSize += Buffer.byteLength(startupHeader, 'utf8')
  } catch (err) {
    console.error('Failed to initialize logging:', err)
  }
}

export interface LoggingHandlerDependencies {}

export function registerLoggingHandlers(window: BrowserWindow, _deps: LoggingHandlerDependencies): void {
  mainWindow = window

  // Get log entries from buffer
  ipcMain.handle('logs:get-entries', () => {
    return logBuffer.slice(-100)
  })

  // Get current log file path
  ipcMain.handle('logs:get-path', () => {
    return logFilePath
  })

  // Export logs
  ipcMain.handle('logs:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Logs',
      defaultPath: `blueplm-logs-${formatDateForFilename(new Date())}.log`,
      filters: [{ name: 'Log Files', extensions: ['log'] }]
    })
    
    if (!result.canceled && result.filePath) {
      try {
        const logsDir = path.join(app.getPath('userData'), 'logs')
        const logFiles = fs.readdirSync(logsDir)
          .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
          .sort()
        
        let content = ''
        for (const file of logFiles) {
          const filePath = path.join(logsDir, file)
          content += fs.readFileSync(filePath, 'utf8')
          content += '\n\n'
        }
        
        fs.writeFileSync(result.filePath, content)
        return { success: true, path: result.filePath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
    return { success: false, canceled: true }
  })

  // Get logs directory
  ipcMain.handle('logs:get-dir', () => {
    return path.join(app.getPath('userData'), 'logs')
  })

  // Get crashes directory
  ipcMain.handle('logs:get-crashes-dir', () => {
    return path.join(app.getPath('userData'), 'Crashpad', 'reports')
  })

  // List crash files
  ipcMain.handle('logs:list-crashes', async () => {
    const crashDir = path.join(app.getPath('userData'), 'Crashpad', 'reports')
    
    if (!fs.existsSync(crashDir)) {
      return { success: true, crashes: [] }
    }
    
    try {
      const files = fs.readdirSync(crashDir)
        .filter(f => f.endsWith('.dmp'))
        .map(filename => {
          const filePath = path.join(crashDir, filename)
          const stats = fs.statSync(filePath)
          return {
            name: filename,
            path: filePath,
            size: stats.size,
            date: stats.mtime.toISOString()
          }
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      
      return { success: true, crashes: files }
    } catch (err) {
      return { success: false, error: String(err), crashes: [] }
    }
  })

  // Read crash file
  ipcMain.handle('logs:read-crash', async (_, filePath: string) => {
    try {
      const stats = fs.statSync(filePath)
      return {
        success: true,
        data: {
          path: filePath,
          size: stats.size,
          date: stats.mtime.toISOString(),
          content: `Binary crash dump (${stats.size} bytes)`
        }
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Open crashes directory
  ipcMain.handle('logs:open-crashes-dir', async () => {
    const crashDir = path.join(app.getPath('userData'), 'Crashpad', 'reports')
    if (!fs.existsSync(crashDir)) {
      fs.mkdirSync(crashDir, { recursive: true })
    }
    await shell.openPath(crashDir)
    return { success: true }
  })

  // List log files
  ipcMain.handle('logs:list-files', async () => {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    
    try {
      const files = fs.readdirSync(logsDir)
        .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
        .map(filename => {
          const filePath = path.join(logsDir, filename)
          const stats = fs.statSync(filePath)
          return {
            name: filename,
            path: filePath,
            size: stats.size,
            date: stats.mtime.toISOString()
          }
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      
      return { success: true, files }
    } catch (err) {
      return { success: false, error: String(err), files: [] }
    }
  })

  // Read log file
  ipcMain.handle('logs:read-file', async (_, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Open logs directory
  ipcMain.handle('logs:open-dir', async () => {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    await shell.openPath(logsDir)
    return { success: true }
  })

  // Delete log file
  ipcMain.handle('logs:delete-file', async (_, filePath: string) => {
    try {
      // Don't delete current log file
      if (filePath === logFilePath) {
        return { success: false, error: 'Cannot delete current log file' }
      }
      
      fs.unlinkSync(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Cleanup old logs
  ipcMain.handle('logs:cleanup-old', async () => {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    cleanupOldLogFiles(logsDir)
    return { success: true }
  })

  // Get retention settings
  ipcMain.handle('logs:get-retention-settings', () => {
    return {
      success: true,
      settings: logRetentionSettings,
      defaults: DEFAULT_LOG_RETENTION
    }
  })

  // Set retention settings
  ipcMain.handle('logs:set-retention-settings', async (_, settings: Partial<LogRetentionSettings>) => {
    const newSettings: LogRetentionSettings = {
      maxFiles: settings.maxFiles ?? logRetentionSettings.maxFiles,
      maxAgeDays: settings.maxAgeDays ?? logRetentionSettings.maxAgeDays,
      maxSizeMb: settings.maxSizeMb ?? logRetentionSettings.maxSizeMb,
      maxTotalSizeMb: settings.maxTotalSizeMb ?? logRetentionSettings.maxTotalSizeMb
    }
    
    const saved = saveLogRetentionSettings(newSettings)
    return { success: saved, settings: newSettings }
  })

  // Get storage info
  ipcMain.handle('logs:get-storage-info', async () => {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    
    try {
      const files = fs.readdirSync(logsDir)
        .filter(f => f.startsWith('blueplm-') && f.endsWith('.log'))
      
      let totalSize = 0
      for (const file of files) {
        const stats = fs.statSync(path.join(logsDir, file))
        totalSize += stats.size
      }
      
      return {
        success: true,
        data: {
          fileCount: files.length,
          totalSizeBytes: totalSize,
          totalSizeMb: Math.round(totalSize / 1024 / 1024 * 100) / 100
        }
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Recording state
  ipcMain.handle('logs:get-recording-state', () => {
    return { enabled: logRecordingEnabled }
  })

  ipcMain.handle('logs:set-recording-state', (_, enabled: boolean) => {
    return { success: saveLogRecordingState(enabled) }
  })

  // Start new log file
  ipcMain.handle('logs:start-new-file', () => {
    rotateLogFile()
    return { success: true, path: logFilePath }
  })

  // Export filtered logs
  ipcMain.handle('logs:export-filtered', async (_, entries: Array<{ raw: string }>) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Filtered Logs',
      defaultPath: `blueplm-filtered-${formatDateForFilename(new Date())}.log`,
      filters: [{ name: 'Log Files', extensions: ['log'] }]
    })
    
    if (!result.canceled && result.filePath) {
      try {
        const content = entries.map(e => e.raw).join('\n')
        fs.writeFileSync(result.filePath, content)
        return { success: true, path: result.filePath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
    return { success: false, canceled: true }
  })

  // Write log from renderer
  ipcMain.on('logs:write', (_, level: string, message: string, data?: unknown) => {
    writeLog(level as LogEntry['level'], message, data)
  })
}

export function unregisterLoggingHandlers(): void {
  const handlers = [
    'logs:get-entries', 'logs:get-path', 'logs:export', 'logs:get-dir', 'logs:get-crashes-dir',
    'logs:list-crashes', 'logs:read-crash', 'logs:open-crashes-dir', 'logs:list-files',
    'logs:read-file', 'logs:open-dir', 'logs:delete-file', 'logs:cleanup-old',
    'logs:get-retention-settings', 'logs:set-retention-settings', 'logs:get-storage-info',
    'logs:get-recording-state', 'logs:set-recording-state', 'logs:start-new-file', 'logs:export-filtered'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
  
  ipcMain.removeAllListeners('logs:write')
}
