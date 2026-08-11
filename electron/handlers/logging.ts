// Logging handlers for Electron main process
import { app, ipcMain, BrowserWindow, shell, dialog } from 'electron'
import fs from 'fs'
import path from 'path'

// Log retention settings interface
export interface LogRetentionSettings {
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
  maxTotalSizeMb: 500,
}

const BYTES_PER_MB = 1024 * 1024
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const LOG_STREAM_HEALTH_CHECK_INTERVAL_MS = 5_000

// Module state
let mainWindow: BrowserWindow | null = null
let logRetentionSettings: LogRetentionSettings = { ...DEFAULT_LOG_RETENTION }
let logRecordingEnabled = true
let logFilePath: string | null = null
let logStream: fs.WriteStream | null = null
let logStreamHealthy = false
let lastLogStreamHealthCheck = 0
let currentLogSize = 0
let logSettingsFilePath: string | null = null

// In-memory log buffer
export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

export interface LogFileInfo {
  name: string
  path: string
  size: number
  modifiedTime: string
  isCurrentSession: boolean
}

export interface CrashFileInfo {
  name: string
  path: string
  size: number
  modifiedTime: string
}

export interface LoggingOperationResponse {
  success: boolean
  error?: string
}

export interface ExportLogsResponse extends LoggingOperationResponse {
  path?: string
  canceled?: boolean
}

export interface ReadLogResponse extends LoggingOperationResponse {
  content?: string
}

export interface ReadCrashResponse extends LoggingOperationResponse {
  content?: string
}

export interface LogFilesResponse extends LoggingOperationResponse {
  files?: LogFileInfo[]
  logsDir?: string
}

export interface CrashFilesResponse extends LoggingOperationResponse {
  files?: CrashFileInfo[]
}

export interface DeleteAllLogsResponse extends LoggingOperationResponse {
  deleted: number
  errors?: string[]
}

export interface LogRetentionResponse extends LoggingOperationResponse {
  settings?: LogRetentionSettings
  defaults?: LogRetentionSettings
}

export interface StorageInfoResponse extends LoggingOperationResponse {
  totalSize?: number
  fileCount?: number
  logsDir?: string
}

export interface RecordingStateResponse {
  enabled: boolean
}

export interface SetRecordingStateResponse {
  success: boolean
  enabled: boolean
}

export interface StartLogResponse extends LoggingOperationResponse {
  path?: string
}

export interface CleanupLogsResponse extends LoggingOperationResponse {
  deleted: number
}

export interface LogCleanupResult {
  deleted: number
  errors: string[]
}

const logBuffer: LogEntry[] = []
const LOG_BUFFER_MAX = 1000

interface LogFileRecord {
  name: string
  path: string
  mtime: number
  size: number
}

function getLogSettingsPath(): string {
  if (!logSettingsFilePath) {
    logSettingsFilePath = path.join(app.getPath('userData'), 'log-settings.json')
  }
  return logSettingsFilePath
}

function getLogRecordingStatePath(): string {
  return path.join(app.getPath('userData'), 'log-recording-state.json')
}

function getLogsDirectory(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function getCrashReportsDirectory(): string {
  return path.join(app.getPath('userData'), 'Crashpad', 'reports')
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
        maxTotalSizeMb: loaded.maxTotalSizeMb ?? DEFAULT_LOG_RETENTION.maxTotalSizeMb,
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

function getLogFileRecords(logsDir: string): LogFileRecord[] {
  return fs
    .readdirSync(logsDir)
    .filter((filename) => filename.startsWith('blueplm-') && filename.endsWith('.log'))
    .map((filename) => {
      const filePath = path.join(logsDir, filename)
      const stats = fs.statSync(filePath)
      return {
        name: filename,
        path: filePath,
        mtime: stats.mtime.getTime(),
        size: stats.size,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function toLogFileInfo(file: LogFileRecord): LogFileInfo {
  return {
    name: file.name,
    path: file.path,
    size: file.size,
    modifiedTime: new Date(file.mtime).toISOString(),
    isCurrentSession: file.path === logFilePath,
  }
}

function cleanupOldLogFiles(logsDir: string): LogCleanupResult {
  const result: LogCleanupResult = {
    deleted: 0,
    errors: [],
  }
  const attemptedPaths = new Set<string>()

  const deleteFile = (file: LogFileRecord): void => {
    if (file.path === logFilePath || attemptedPaths.has(file.path)) {
      return
    }

    attemptedPaths.add(file.path)
    try {
      fs.unlinkSync(file.path)
      result.deleted++
    } catch (error) {
      result.errors.push(`${file.name}: ${String(error)}`)
    }
  }

  try {
    const { maxFiles, maxAgeDays, maxTotalSizeMb } = logRetentionSettings
    const now = Date.now()
    const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * MILLISECONDS_PER_DAY : 0
    const maxTotalSizeBytes = maxTotalSizeMb > 0 ? maxTotalSizeMb * BYTES_PER_MB : 0

    let logFiles = getLogFileRecords(logsDir)

    // Delete old files by age
    if (maxAgeDays > 0) {
      for (const file of logFiles) {
        const age = now - file.mtime
        if (age > maxAgeMs) {
          deleteFile(file)
        }
      }
    }

    // Re-read after age cleanup
    logFiles = getLogFileRecords(logsDir)

    // Delete files beyond count limit
    if (maxFiles > 0 && logFiles.length >= maxFiles) {
      const nonCurrentFiles = logFiles.filter((file) => file.path !== logFilePath)
      const filesToKeep = Math.max(0, maxFiles - 1)
      const filesToDelete = nonCurrentFiles.slice(filesToKeep)
      for (const file of filesToDelete) {
        deleteFile(file)
      }
      logFiles = getLogFileRecords(logsDir)
    }

    // Delete files beyond total size limit
    if (maxTotalSizeBytes > 0) {
      let totalSize = logFiles.reduce((sum, f) => sum + f.size, 0)
      const nonCurrentFiles = logFiles
        .filter((file) => file.path !== logFilePath)
        .sort((a, b) => a.mtime - b.mtime)

      for (const oldestFile of nonCurrentFiles) {
        if (totalSize <= maxTotalSizeBytes) {
          break
        }

        const previousDeletedCount = result.deleted
        deleteFile(oldestFile)
        if (result.deleted > previousDeletedCount) {
          totalSize -= oldestFile.size
        }
      }
    }
  } catch (error) {
    result.errors.push(String(error))
  }

  return result
}

export function pruneLogsToRetention(): LogCleanupResult {
  const logsDir = getLogsDirectory()

  try {
    fs.mkdirSync(logsDir, { recursive: true })
    return cleanupOldLogFiles(logsDir)
  } catch (error) {
    return { deleted: 0, errors: [String(error)] }
  }
}

export function pruneCrashDumpsToRetention(): LogCleanupResult {
  const result: LogCleanupResult = {
    deleted: 0,
    errors: [],
  }
  const maxAgeDays = logRetentionSettings.maxAgeDays

  if (maxAgeDays <= 0) {
    return result
  }

  const crashDir = getCrashReportsDirectory()
  const cutoff = Date.now() - maxAgeDays * MILLISECONDS_PER_DAY

  try {
    if (!fs.existsSync(crashDir)) {
      return result
    }

    const crashFiles = fs.readdirSync(crashDir).filter((filename) => filename.endsWith('.dmp'))
    for (const filename of crashFiles) {
      const filePath = path.join(crashDir, filename)
      try {
        const stats = fs.statSync(filePath)
        if (stats.mtime.getTime() < cutoff) {
          fs.unlinkSync(filePath)
          result.deleted++
        }
      } catch (error) {
        result.errors.push(`${filename}: ${String(error)}`)
      }
    }
  } catch (error) {
    result.errors.push(String(error))
  }

  return result
}

function attachLogStreamErrorHandler(stream: fs.WriteStream): void {
  stream.on('error', () => {
    if (logStream === stream) {
      logStreamHealthy = false
      logStream = null
    }
  })
}

function openLogStream(filePath: string, header: string): boolean {
  try {
    const stream = fs.createWriteStream(filePath, { flags: 'w' })
    attachLogStreamErrorHandler(stream)
    logStream = stream
    logStreamHealthy = true
    currentLogSize = Buffer.byteLength(header, 'utf8')
    stream.write(header)
    return true
  } catch {
    logStreamHealthy = false
    logStream = null
    return false
  }
}

function ensureLogStream(): boolean {
  const now = Date.now()
  const shouldCheckHealth =
    !logStream ||
    !logStreamHealthy ||
    now - lastLogStreamHealthCheck >= LOG_STREAM_HEALTH_CHECK_INTERVAL_MS

  if (!shouldCheckHealth) {
    return true
  }

  lastLogStreamHealthCheck = now
  const logsDir = getLogsDirectory()

  try {
    fs.mkdirSync(logsDir, { recursive: true })

    const targetExists = Boolean(logStream && logFilePath && fs.existsSync(logFilePath))
    if (logStream && logStreamHealthy && targetExists) {
      return true
    }

    if (logStream) {
      logStream.end()
      logStream = null
    }
    logStreamHealthy = false

    const recoveryTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${recoveryTimestamp}.log`)
    const recoveryHeader = `${'='.repeat(60)}\nBluePLM Log (recovered)\nRecovered: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\n${'='.repeat(60)}\n\n`
    return openLogStream(logFilePath, recoveryHeader)
  } catch {
    logStreamHealthy = false
    logStream = null
    return false
  }
}

function rotateLogFile() {
  try {
    if (logStream) {
      logStream.end()
      logStream = null
    }
    logStreamHealthy = false
    logFilePath = null

    const logsDir = getLogsDirectory()
    fs.mkdirSync(logsDir, { recursive: true })
    cleanupOldLogFiles(logsDir)

    const newTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${newTimestamp}.log`)

    const header = `${'='.repeat(60)}\nBluePLM Log (continued)\nRotated: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\n${'='.repeat(60)}\n\n`
    if (!openLogStream(logFilePath, header)) {
      logFilePath = null
    }
  } catch {
    logStreamHealthy = false
    logStream = null
  }
}

// Write log entry
export function writeLog(level: LogEntry['level'], message: string, data?: unknown) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
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
  }

  if (logRecordingEnabled && ensureLogStream() && logStream) {
    const lineBytes = Buffer.byteLength(logLine, 'utf8')
    const maxSize = logRetentionSettings.maxSizeMb * BYTES_PER_MB

    if (maxSize > 0 && currentLogSize + lineBytes > maxSize) {
      rotateLogFile()
    }

    if (logStream) {
      logStream.write(logLine)
      currentLogSize += lineBytes
    }
  }
}

// Initialize logging
// Note: We intentionally do NOT load persisted log recording state here.
// Log recording is always re-enabled on app restart for debugging reliability.
export function initializeLogging() {
  try {
    loadLogRetentionSettings()
    // logRecordingEnabled defaults to true (see line 25) - we do not persist/restore this

    const logsDir = getLogsDirectory()
    fs.mkdirSync(logsDir, { recursive: true })

    const sessionTimestamp = formatDateForFilename(new Date())
    logFilePath = path.join(logsDir, `blueplm-${sessionTimestamp}.log`)

    cleanupOldLogFiles(logsDir)

    const startupHeader = `${'='.repeat(60)}\nBluePLM Session Log\nStarted: ${new Date().toISOString()}\nVersion: ${app.getVersion()}\nPlatform: ${process.platform} ${process.arch}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n${'='.repeat(60)}\n\n`
    if (!openLogStream(logFilePath, startupHeader)) {
      logFilePath = null
    }
    lastLogStreamHealthCheck = Date.now()
  } catch (error) {
    console.error('Failed to initialize logging:', error)
  }
}

export type LoggingHandlerDependencies = Record<string, never>

export function registerLoggingHandlers(
  window: BrowserWindow,
  _deps: LoggingHandlerDependencies,
): void {
  mainWindow = window

  // Get log entries from buffer
  ipcMain.handle('logs:get-entries', (): LogEntry[] => {
    return logBuffer.slice(-100)
  })

  // Get current log file path
  ipcMain.handle('logs:get-path', (): string | null => {
    return logFilePath
  })

  // Export logs
  ipcMain.handle('logs:export', async (): Promise<ExportLogsResponse> => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Logs',
      defaultPath: `blueplm-logs-${formatDateForFilename(new Date())}.log`,
      filters: [{ name: 'Log Files', extensions: ['log'] }],
    })

    if (!result.canceled && result.filePath) {
      try {
        const logsDir = getLogsDirectory()
        fs.mkdirSync(logsDir, { recursive: true })
        const logFiles = fs
          .readdirSync(logsDir)
          .filter((f) => f.startsWith('blueplm-') && f.endsWith('.log'))
          .sort()

        let content = ''
        for (const file of logFiles) {
          const filePath = path.join(logsDir, file)
          content += fs.readFileSync(filePath, 'utf8')
          content += '\n\n'
        }

        fs.writeFileSync(result.filePath, content)
        return { success: true, path: result.filePath }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }
    return { success: false, canceled: true }
  })

  // Get logs directory
  ipcMain.handle('logs:get-dir', (): string => {
    return getLogsDirectory()
  })

  // Get crashes directory
  ipcMain.handle('logs:get-crashes-dir', (): string => {
    return getCrashReportsDirectory()
  })

  // List crash files
  ipcMain.handle('logs:list-crashes', async (): Promise<CrashFilesResponse> => {
    const crashDir = getCrashReportsDirectory()

    if (!fs.existsSync(crashDir)) {
      return { success: true, files: [] }
    }

    try {
      const files = fs
        .readdirSync(crashDir)
        .filter((f) => f.endsWith('.dmp'))
        .map((filename) => {
          const filePath = path.join(crashDir, filename)
          const stats = fs.statSync(filePath)
          return {
            name: filename,
            path: filePath,
            size: stats.size,
            modifiedTime: stats.mtime.toISOString(),
          }
        })
        .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())

      return { success: true, files }
    } catch (error) {
      return { success: false, error: String(error), files: [] }
    }
  })

  // Read crash file
  ipcMain.handle('logs:read-crash', async (_, filePath: string): Promise<ReadCrashResponse> => {
    try {
      const stats = fs.statSync(filePath)
      return {
        success: true,
        content: `Binary crash dump (${stats.size} bytes)`,
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Open crashes directory
  ipcMain.handle('logs:open-crashes-dir', async (): Promise<LoggingOperationResponse> => {
    const crashDir = getCrashReportsDirectory()
    try {
      fs.mkdirSync(crashDir, { recursive: true })
      const openError = await shell.openPath(crashDir)
      if (openError) {
        return { success: false, error: openError }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // List log files
  ipcMain.handle('logs:list-files', async (): Promise<LogFilesResponse> => {
    const logsDir = getLogsDirectory()

    try {
      fs.mkdirSync(logsDir, { recursive: true })
      const files = getLogFileRecords(logsDir).map(toLogFileInfo)

      return { success: true, files, logsDir }
    } catch (error) {
      return { success: false, error: String(error), files: [], logsDir }
    }
  })

  // Read log file
  ipcMain.handle('logs:read-file', async (_, filePath: string): Promise<ReadLogResponse> => {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Open logs directory
  ipcMain.handle('logs:open-dir', async (): Promise<LoggingOperationResponse> => {
    const logsDir = getLogsDirectory()
    try {
      fs.mkdirSync(logsDir, { recursive: true })
      const openError = await shell.openPath(logsDir)
      if (openError) {
        return { success: false, error: openError }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Delete log file
  ipcMain.handle(
    'logs:delete-file',
    async (_, filePath: string): Promise<LoggingOperationResponse> => {
      try {
        // Don't delete current log file
        if (filePath === logFilePath) {
          return { success: false, error: 'Cannot delete current log file' }
        }

        fs.unlinkSync(filePath)
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  )

  // Delete all log files (except current session)
  ipcMain.handle('logs:delete-all-files', async (): Promise<DeleteAllLogsResponse> => {
    const logsDir = getLogsDirectory()

    try {
      const files = fs
        .readdirSync(logsDir)
        .filter((f) => f.startsWith('blueplm-') && f.endsWith('.log'))

      let deletedCount = 0
      const errors: string[] = []

      for (const filename of files) {
        const filePath = path.join(logsDir, filename)

        // Don't delete current log file
        if (filePath === logFilePath) {
          continue
        }

        try {
          fs.unlinkSync(filePath)
          deletedCount++
        } catch (error) {
          errors.push(`${filename}: ${String(error)}`)
        }
      }

      return {
        success: true,
        deleted: deletedCount,
        errors: errors.length > 0 ? errors : undefined,
      }
    } catch (error) {
      return { success: false, error: String(error), deleted: 0 }
    }
  })

  // Cleanup old logs
  ipcMain.handle('logs:cleanup-old', async (): Promise<CleanupLogsResponse> => {
    const cleanupResult = pruneLogsToRetention()
    if (cleanupResult.errors.length > 0) {
      return {
        success: false,
        deleted: cleanupResult.deleted,
        error: cleanupResult.errors.join('; '),
      }
    }
    return { success: true, deleted: cleanupResult.deleted }
  })

  // Get retention settings
  ipcMain.handle('logs:get-retention-settings', (): LogRetentionResponse => {
    return {
      success: true,
      settings: logRetentionSettings,
      defaults: DEFAULT_LOG_RETENTION,
    }
  })

  // Set retention settings
  ipcMain.handle(
    'logs:set-retention-settings',
    async (_, settings: Partial<LogRetentionSettings>): Promise<LogRetentionResponse> => {
      const newSettings: LogRetentionSettings = {
        maxFiles: settings.maxFiles ?? logRetentionSettings.maxFiles,
        maxAgeDays: settings.maxAgeDays ?? logRetentionSettings.maxAgeDays,
        maxSizeMb: settings.maxSizeMb ?? logRetentionSettings.maxSizeMb,
        maxTotalSizeMb: settings.maxTotalSizeMb ?? logRetentionSettings.maxTotalSizeMb,
      }

      const saved = saveLogRetentionSettings(newSettings)
      return { success: saved, settings: newSettings }
    },
  )

  // Get storage info
  ipcMain.handle('logs:get-storage-info', async (): Promise<StorageInfoResponse> => {
    const logsDir = getLogsDirectory()

    try {
      fs.mkdirSync(logsDir, { recursive: true })
      const files = fs
        .readdirSync(logsDir)
        .filter((f) => f.startsWith('blueplm-') && f.endsWith('.log'))

      let totalSize = 0
      for (const file of files) {
        const stats = fs.statSync(path.join(logsDir, file))
        totalSize += stats.size
      }

      return {
        success: true,
        fileCount: files.length,
        totalSize,
        logsDir,
      }
    } catch (error) {
      return { success: false, error: String(error), logsDir }
    }
  })

  // Recording state
  ipcMain.handle('logs:get-recording-state', (): RecordingStateResponse => {
    return { enabled: logRecordingEnabled }
  })

  ipcMain.handle('logs:set-recording-state', (_, enabled: boolean): SetRecordingStateResponse => {
    const success = saveLogRecordingState(enabled)
    return { success, enabled: logRecordingEnabled }
  })

  // Start new log file
  ipcMain.handle('logs:start-new-file', (): StartLogResponse => {
    rotateLogFile()
    return {
      success: logStreamHealthy,
      ...(logFilePath ? { path: logFilePath } : {}),
    }
  })

  // Export filtered logs
  ipcMain.handle(
    'logs:export-filtered',
    async (_, entries: Array<{ raw: string }>): Promise<ExportLogsResponse> => {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Filtered Logs',
        defaultPath: `blueplm-filtered-${formatDateForFilename(new Date())}.log`,
        filters: [{ name: 'Log Files', extensions: ['log'] }],
      })

      if (!result.canceled && result.filePath) {
        try {
          const content = entries.map((e) => e.raw).join('\n')
          fs.writeFileSync(result.filePath, content)
          return { success: true, path: result.filePath }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      }
      return { success: false, canceled: true }
    },
  )

  // Write log from renderer
  ipcMain.on('logs:write', (_, level: string, message: string, data?: unknown) => {
    writeLog(level as LogEntry['level'], message, data)
  })
}

export function unregisterLoggingHandlers(): void {
  const handlers = [
    'logs:get-entries',
    'logs:get-path',
    'logs:export',
    'logs:get-dir',
    'logs:get-crashes-dir',
    'logs:list-crashes',
    'logs:read-crash',
    'logs:open-crashes-dir',
    'logs:list-files',
    'logs:read-file',
    'logs:open-dir',
    'logs:delete-file',
    'logs:delete-all-files',
    'logs:cleanup-old',
    'logs:get-retention-settings',
    'logs:set-retention-settings',
    'logs:get-storage-info',
    'logs:get-recording-state',
    'logs:set-recording-state',
    'logs:start-new-file',
    'logs:export-filtered',
  ]

  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }

  ipcMain.removeAllListeners('logs:write')
}
