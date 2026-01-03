// Handler registry - registers all IPC handlers
import { BrowserWindow } from 'electron'

import { registerFsHandlers, unregisterFsHandlers, getWorkingDirectory, FsHandlerDependencies } from './fs'
import { registerBackupHandlers, unregisterBackupHandlers, BackupHandlerDependencies } from './backup'
import { registerSolidWorksHandlers, unregisterSolidWorksHandlers, isFileBeingThumbnailed, getThumbnailsInProgress, SolidWorksHandlerDependencies } from './solidworks'
import { registerDialogHandlers, unregisterDialogHandlers, DialogHandlerDependencies } from './dialogs'
import { registerSystemHandlers, unregisterSystemHandlers, SystemHandlerDependencies } from './system'
import { registerLoggingHandlers, unregisterLoggingHandlers, writeLog, initializeLogging, LoggingHandlerDependencies } from './logging'
import { registerUpdaterHandlers, unregisterUpdaterHandlers, UpdaterHandlerDependencies } from './updater'
import { registerOAuthHandlers, unregisterOAuthHandlers, OAuthHandlerDependencies } from './oauth'

// Logging utilities for main.ts
export { writeLog, initializeLogging } from './logging'

// Re-export getters
export { getWorkingDirectory } from './fs'
export { isFileBeingThumbnailed, getThumbnailsInProgress } from './solidworks'

// Convenience log functions
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

// Helper to restore focus to main window after dialogs
let restoreMainWindowFocusFn: () => void = () => {}

export function setRestoreMainWindowFocus(fn: () => void): void {
  restoreMainWindowFocusFn = fn
}

export interface AllHandlerDependencies {
  restoreMainWindowFocus: () => void
}

export function registerAllHandlers(mainWindow: BrowserWindow, deps: AllHandlerDependencies): void {
  restoreMainWindowFocusFn = deps.restoreMainWindowFocus

  // Create shared dependencies
  const fsHandlerDeps: FsHandlerDependencies = {
    log,
    logDebug,
    logError,
    logWarn,
    isFileBeingThumbnailed,
    thumbnailsInProgress: getThumbnailsInProgress(),
    restoreMainWindowFocus: restoreMainWindowFocusFn
  }

  const backupHandlerDeps: BackupHandlerDependencies = {
    log,
    logError,
    getWorkingDirectory
  }

  const solidWorksHandlerDeps: SolidWorksHandlerDependencies = {
    log
  }

  const dialogHandlerDeps: DialogHandlerDependencies = {
    log,
    restoreMainWindowFocus: restoreMainWindowFocusFn
  }

  const systemHandlerDeps: SystemHandlerDependencies = {
    log
  }

  const loggingHandlerDeps: LoggingHandlerDependencies = {}

  const updaterHandlerDeps: UpdaterHandlerDependencies = {
    log,
    logError
  }

  const oauthHandlerDeps: OAuthHandlerDependencies = {
    log
  }

  // Register all handlers
  registerFsHandlers(mainWindow, fsHandlerDeps)
  registerBackupHandlers(mainWindow, backupHandlerDeps)
  registerSolidWorksHandlers(mainWindow, solidWorksHandlerDeps)
  registerDialogHandlers(mainWindow, dialogHandlerDeps)
  registerSystemHandlers(mainWindow, systemHandlerDeps)
  registerLoggingHandlers(mainWindow, loggingHandlerDeps)
  registerUpdaterHandlers(mainWindow, updaterHandlerDeps)
  registerOAuthHandlers(mainWindow, oauthHandlerDeps)

  log('All IPC handlers registered')
}

export function unregisterAllHandlers(): void {
  unregisterFsHandlers()
  unregisterBackupHandlers()
  unregisterSolidWorksHandlers()
  unregisterDialogHandlers()
  unregisterSystemHandlers()
  unregisterLoggingHandlers()
  unregisterUpdaterHandlers()
  unregisterOAuthHandlers()
}
