// Migration handler for major version upgrades
// Clears disposable caches while preserving user configuration

import { app, session } from 'electron'
import fs from 'fs'
import path from 'path'
import { pruneCrashDumpsToRetention, pruneLogsToRetention, writeLog } from './logging'

// ============================================
// Types
// ============================================

interface VersionInfo {
  version: string
  lastRun: string
  migratedFrom?: string
}

type StoredVersionStatus = 'missing' | 'valid' | 'corrupt'

interface StoredVersionResult {
  info: VersionInfo | null
  status: StoredVersionStatus
}

interface MigrationResult {
  performed: boolean
  fromVersion: string | null
  toVersion: string
  cleanedPaths: string[]
  errors: string[]
}

// ============================================
// Module State
// ============================================

let migrationResult: MigrationResult | null = null

// ============================================
// Paths
// ============================================

function getVersionFilePath(): string {
  return path.join(app.getPath('userData'), 'app-version.json')
}

function getTempUpdatePath(): string {
  return path.join(app.getPath('temp'), 'blueplm-updates')
}

// ============================================
// Version Management
// ============================================

function isVersionInfo(value: unknown): value is VersionInfo {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.version === 'string' && typeof record.lastRun === 'string'
}

function loadStoredVersion(): StoredVersionResult {
  const versionFile = getVersionFilePath()

  if (!fs.existsSync(versionFile)) {
    return { info: null, status: 'missing' }
  }

  try {
    const data = fs.readFileSync(versionFile, 'utf-8')
    const parsed: unknown = JSON.parse(data)
    if (isVersionInfo(parsed)) {
      return { info: parsed, status: 'valid' }
    }
  } catch {
    return { info: null, status: 'corrupt' }
  }

  return { info: null, status: 'corrupt' }
}

function saveVersion(version: string, migratedFrom?: string): boolean {
  try {
    const versionInfo: VersionInfo = {
      version,
      lastRun: new Date().toISOString(),
      ...(migratedFrom && { migratedFrom }),
    }

    // Ensure userData directory exists
    const userDataPath = app.getPath('userData')
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true })
    }

    fs.writeFileSync(getVersionFilePath(), JSON.stringify(versionInfo, null, 2))
    return true
  } catch (error) {
    writeLog('error', '[Migration] Failed to save version info', { error: String(error) })
    return false
  }
}

// ============================================
// Version Comparison
// ============================================

function getMajorVersion(version: string): number {
  const match = version.match(/^(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

function shouldPerformMajorUpgradeCleanup(
  fromVersion: string | null,
  toVersion: string,
  storedVersionStatus: StoredVersionStatus,
): boolean {
  if (storedVersionStatus === 'corrupt') {
    return false
  }

  // If no previous version stored, this might be:
  // 1. A fresh install (no migration needed)
  // 2. An upgrade from an older version that didn't track versions
  // For safety, we check if userData has old data patterns
  if (storedVersionStatus === 'missing') {
    // Check for telltale signs of a pre-3.0 installation (no version tracking)
    const userDataPath = app.getPath('userData')
    const hasLegacyData =
      fs.existsSync(path.join(userDataPath, 'window-state.json')) ||
      fs.existsSync(path.join(userDataPath, 'analytics-settings.json')) ||
      fs.existsSync(path.join(userDataPath, 'logs'))

    // If we have legacy data but no version file, assume it's a pre-3.0 upgrade
    if (hasLegacyData) {
      writeLog(
        'info',
        '[Migration] Found legacy data without version file - treating as pre-3.0 upgrade',
      )
      return getMajorVersion(toVersion) >= 3
    }

    return false
  }

  if (!fromVersion) {
    return false
  }

  const fromMajor = getMajorVersion(fromVersion)
  const toMajor = getMajorVersion(toVersion)

  // Cache cleanup on ANY major version upgrade (2→3, 3→4, 4→5, etc.)
  return toMajor > fromMajor
}

// ============================================
// Data Cleanup
// ============================================

function deleteRecursive(targetPath: string): boolean {
  try {
    if (!fs.existsSync(targetPath)) {
      return false
    }

    const stats = fs.statSync(targetPath)
    if (stats.isDirectory()) {
      const entries = fs.readdirSync(targetPath)
      for (const entry of entries) {
        deleteRecursive(path.join(targetPath, entry))
      }
      fs.rmdirSync(targetPath)
    } else {
      fs.unlinkSync(targetPath)
    }
    return true
  } catch (error) {
    writeLog('error', `[Migration] Failed to delete ${targetPath}`, { error: String(error) })
    return false
  }
}

/**
 * Delete disposable caches and prune retained logs/crashes only.
 *
 * Intentionally preserved (user configuration):
 * - Local Storage / Session Storage — org config, login session, vault bindings,
 *   onboarding, "Help improve BluePLM", SolidWorks prefs, UI state (`blue-plm-storage`)
 * - IndexedDB — vault file cache / sync index
 * - analytics-settings.json, log-settings.json — telemetry / logging prefs
 * - window-state.json — window geometry
 * - app-version.json — stamped before migration cleanup
 */
function cleanDisposableUserData(): { cleaned: string[]; errors: string[] } {
  const userDataPath = app.getPath('userData')
  const cleaned: string[] = []
  const errors: string[] = []

  const logsPath = path.join(userDataPath, 'logs')
  const logCleanup = pruneLogsToRetention()
  if (logCleanup.deleted > 0) {
    cleaned.push(logsPath)
    writeLog('info', `[Migration] Pruned ${logCleanup.deleted} log files`)
  }
  errors.push(...logCleanup.errors.map((error) => `Failed to prune logs: ${error}`))

  const crashReportsPath = path.join(userDataPath, 'Crashpad', 'reports')
  const crashCleanup = pruneCrashDumpsToRetention()
  if (crashCleanup.deleted > 0) {
    cleaned.push(crashReportsPath)
    writeLog('info', `[Migration] Pruned ${crashCleanup.deleted} crash dumps`)
  }
  errors.push(...crashCleanup.errors.map((error) => `Failed to prune crash dumps: ${error}`))

  const itemsToDelete = [
    'update-reminder.json',
    'log-recording-state.json',
    'Cache',
    'Code Cache',
    'GPUCache',
    'blob_storage',
    'Service Worker',
    'Network',
    'TransportSecurity',
  ]

  for (const item of itemsToDelete) {
    const itemPath = path.join(userDataPath, item)
    try {
      if (deleteRecursive(itemPath)) {
        cleaned.push(itemPath)
        writeLog('info', `[Migration] Deleted: ${item}`)
      }
    } catch (error) {
      errors.push(`Failed to delete ${item}: ${String(error)}`)
    }
  }

  return { cleaned, errors }
}

function cleanTempFiles(): { cleaned: string[]; errors: string[] } {
  const cleaned: string[] = []
  const errors: string[] = []

  // Clean BluePLM temp folder
  const tempPath = getTempUpdatePath()
  try {
    if (deleteRecursive(tempPath)) {
      cleaned.push(tempPath)
      writeLog('info', '[Migration] Deleted temp updates folder')
    }
  } catch (error) {
    errors.push(`Failed to delete temp folder: ${String(error)}`)
  }

  return { cleaned, errors }
}

// ============================================
// Main Migration Function
// ============================================

/**
 * Check and perform migration if needed.
 * This should be called BEFORE the window is created.
 * Returns information about what was done.
 */
export async function performMigrationCheck(): Promise<MigrationResult> {
  const currentVersion = app.getVersion()
  const storedVersion = loadStoredVersion()
  const previousVersion = storedVersion.info?.version ?? null

  if (storedVersion.status === 'corrupt') {
    writeLog('error', '[Migration] app-version.json is corrupt; skipping legacy cleanup')
  }

  writeLog('info', `[Migration] Current version: ${currentVersion}`)
  writeLog(
    'info',
    `[Migration] Previous version: ${previousVersion ?? 'none (first run or legacy)'}`,
  )

  const result: MigrationResult = {
    performed: false,
    fromVersion: previousVersion,
    toVersion: currentVersion,
    cleanedPaths: [],
    errors: [],
  }

  if (shouldPerformMajorUpgradeCleanup(previousVersion, currentVersion, storedVersion.status)) {
    const fromMajor = previousVersion ? getMajorVersion(previousVersion) : 'legacy'
    const toMajor = getMajorVersion(currentVersion)
    writeLog('info', '[Migration] ===== PERFORMING MAJOR UPGRADE CACHE CLEANUP =====')
    writeLog('info', `[Migration] Major version upgrade: ${fromMajor} → ${toMajor}`)
    writeLog(
      'info',
      `[Migration] Upgrading from ${previousVersion ?? 'pre-3.0 (legacy)'} to ${currentVersion}`,
    )
    writeLog(
      'info',
      '[Migration] Preserving Local Storage (org config, session, vault bindings, onboarding)',
    )

    const versionSaved = saveVersion(currentVersion, previousVersion ?? 'pre-3.0')
    if (!versionSaved) {
      const errorMessage = 'Failed to save app version before cleanup'
      result.errors.push(errorMessage)
      writeLog('error', `[Migration] ${errorMessage}; aborting cleanup`)
      migrationResult = result
      return result
    }

    // Clean disposable caches/logs only — keep configuration
    const userDataResult = cleanDisposableUserData()
    result.cleanedPaths.push(...userDataResult.cleaned)
    result.errors.push(...userDataResult.errors)

    // Clean temp files
    const tempResult = cleanTempFiles()
    result.cleanedPaths.push(...tempResult.cleaned)
    result.errors.push(...tempResult.errors)

    // Clear only ephemeral session caches. Do NOT clear localstorage, cookies,
    // or IndexedDB — those hold org config, auth session, vault bindings, and
    // onboarding choices ("Help improve BluePLM", language, etc.).
    try {
      await session.defaultSession.clearStorageData({
        storages: ['shadercache', 'serviceworkers', 'cachestorage'],
      })
      writeLog('info', '[Migration] Cleared ephemeral Electron session caches')
    } catch (error) {
      writeLog('error', '[Migration] Failed to clear session caches', { error: String(error) })
      result.errors.push(`Failed to clear session caches: ${String(error)}`)
    }

    result.performed = true
    writeLog(
      'info',
      `[Migration] Major upgrade cleanup complete. Cleaned ${result.cleanedPaths.length} items.`,
    )
    if (result.errors.length > 0) {
      writeLog('warn', `[Migration] Encountered ${result.errors.length} errors`, {
        errors: result.errors,
      })
    }
  } else {
    // Just update the version file
    saveVersion(currentVersion)
    writeLog('info', '[Migration] No migration needed')
  }

  migrationResult = result
  return result
}

/**
 * Get the migration result from the last check.
 * Useful for showing a notification to the user.
 */
export function getMigrationResult(): MigrationResult | null {
  return migrationResult
}

/**
 * Check if a migration was performed on this startup.
 */
export function wasMigrationPerformed(): boolean {
  return migrationResult?.performed ?? false
}
