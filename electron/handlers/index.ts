// Handler registry - registers all IPC handlers
import { BrowserWindow, ipcMain } from 'electron'

import {
  registerFsHandlers,
  unregisterFsHandlers,
  getWorkingDirectory,
  cleanupFs,
  FsHandlerDependencies,
} from './fs'
import {
  registerBackupHandlers,
  unregisterBackupHandlers,
  BackupHandlerDependencies,
} from './backup'
import {
  registerSolidWorksHandlers,
  unregisterSolidWorksHandlers,
  cleanupSolidWorksService,
  isFileBeingThumbnailed,
  getThumbnailsInProgress,
  SolidWorksHandlerDependencies,
} from './solidworks'
import {
  registerDialogHandlers,
  unregisterDialogHandlers,
  DialogHandlerDependencies,
} from './dialogs'
import {
  registerSystemHandlers,
  unregisterSystemHandlers,
  SystemHandlerDependencies,
} from './system'
import {
  registerLoggingHandlers,
  unregisterLoggingHandlers,
  writeLog,
  initializeLogging,
  LoggingHandlerDependencies,
} from './logging'
import {
  registerUpdaterHandlers,
  unregisterUpdaterHandlers,
  cleanupUpdater,
  UpdaterHandlerDependencies,
} from './updater'
import {
  registerOAuthHandlers,
  unregisterOAuthHandlers,
  cleanupOAuth,
  OAuthHandlerDependencies,
} from './oauth'
import {
  registerCliHandlers,
  unregisterCliHandlers,
  startCliServer,
  cleanupCli,
  CliHandlerDependencies,
} from './cli'
import { performMigrationCheck, getMigrationResult, wasMigrationPerformed } from './migration'
import {
  registerExtensionHostHandlers,
  unregisterExtensionHostHandlers,
  cleanupExtensionHost,
  onExtensionStateChange,
  type ExtensionHostHandlerDependencies,
} from './extensionHost'
import {
  registerDeepLinkHandlers,
  unregisterDeepLinkHandlers,
  handleDeepLink,
  parseDeepLink,
  storePendingDeepLink,
  processPendingDeepLink,
  hasPendingDeepLink,
  setDeepLinkDependencies,
  type DeepLinkHandlerDependencies,
} from './deepLink'
import {
  registerArchiveHandlers,
  unregisterArchiveHandlers,
  type ArchiveHandlerDependencies,
} from './archive'

// Logging utilities for main.ts
export { writeLog, initializeLogging } from './logging'

// Migration utilities for main.ts
export { performMigrationCheck, getMigrationResult, wasMigrationPerformed } from './migration'

// CLI exports for main.ts
export { startCliServer, cleanupCli } from './cli'

// Extension Host exports for main.ts
export { cleanupExtensionHost, onExtensionStateChange } from './extensionHost'

// Deep Link exports for main.ts
export {
  handleDeepLink,
  parseDeepLink,
  storePendingDeepLink,
  processPendingDeepLink,
  hasPendingDeepLink,
  setDeepLinkDependencies,
} from './deepLink'

// OAuth cleanup for main.ts
export { cleanupOAuth } from './oauth'

// Updater cleanup for main.ts (clears periodic update check timer)
export { cleanupUpdater } from './updater'

// File system cleanup for main.ts (stops file watcher)
export { cleanupFs } from './fs'

// Re-export getters
export { getWorkingDirectory } from './fs'
export { isFileBeingThumbnailed, getThumbnailsInProgress } from './solidworks'

// SolidWorks service cleanup for app quit
export { cleanupSolidWorksService } from './solidworks'

// SolidWorks main-process early start (parallel to renderer boot) for main.ts
export { autoStartServiceFromCache } from './solidworks'

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
    restoreMainWindowFocus: restoreMainWindowFocusFn,
  }

  const backupHandlerDeps: BackupHandlerDependencies = {
    log,
    logError,
    getWorkingDirectory,
  }

  const solidWorksHandlerDeps: SolidWorksHandlerDependencies = {
    log,
    logError,
    logWarn,
  }

  const dialogHandlerDeps: DialogHandlerDependencies = {
    log,
    restoreMainWindowFocus: restoreMainWindowFocusFn,
  }

  const systemHandlerDeps: SystemHandlerDependencies = {
    log,
  }

  const loggingHandlerDeps: LoggingHandlerDependencies = {}

  const updaterHandlerDeps: UpdaterHandlerDependencies = {
    log,
    logError,
  }

  const oauthHandlerDeps: OAuthHandlerDependencies = {
    log,
  }

  const cliHandlerDeps: CliHandlerDependencies = {
    log,
    logError,
  }

  const extensionHostHandlerDeps: ExtensionHostHandlerDependencies = {
    log,
    logError,
  }

  const deepLinkHandlerDeps: DeepLinkHandlerDependencies = {
    log,
    logError,
  }

  const archiveHandlerDeps: ArchiveHandlerDependencies = {
    log,
    logError,
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
  registerCliHandlers(mainWindow, cliHandlerDeps)
  registerExtensionHostHandlers(mainWindow, extensionHostHandlerDeps)
  registerDeepLinkHandlers(mainWindow, deepLinkHandlerDeps)
  registerArchiveHandlers(mainWindow, archiveHandlerDeps)

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
  unregisterCliHandlers()
  unregisterExtensionHostHandlers()
  unregisterDeepLinkHandlers()
  unregisterArchiveHandlers()
}
