// Backup handlers for Electron main process (restic-based backup)
import { app, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'

// ============================================
// Backup Log Types
// ============================================

export type BackupLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'
export type BackupPhase =
  | 'idle'
  | 'repo_check'
  | 'repo_init'
  | 'unlock'
  | 'file_scan'
  | 'backup'
  | 'retention'
  | 'restore'
  | 'metadata_import'
  | 'complete'
  | 'error'

export interface BackupLogEntry {
  level: BackupLogLevel
  phase: BackupPhase
  message: string
  timestamp: number
  metadata?: {
    operation?: string
    exitCode?: number
    filesProcessed?: number
    filesTotal?: number
    bytesProcessed?: number
    bytesTotal?: number
    currentFile?: string
    error?: string
    duration?: number
  }
}

export interface BackupOperationStats {
  phase: BackupPhase
  startTime: number
  endTime?: number
  filesProcessed: number
  filesTotal: number
  bytesProcessed: number
  bytesTotal: number
  errorsEncountered: number
}

// ============================================
// Module State
// ============================================

let mainWindow: BrowserWindow | null = null

// External log function reference
let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error

// External working directory getter
let getWorkingDirectory: () => string | null = () => null

// Operation tracking
let currentStats: BackupOperationStats | null = null
let isBackupRunning = false
let backupStartedAt: number | null = null

/**
 * Last logged failure per repository.
 *
 * Repository access failures (wrong credentials, missing bucket, no repo at that path)
 * do not heal on their own, and the snapshot list is polled every few minutes, so logging
 * each one buries everything else in the log. Log a given failure once and stay quiet
 * until the message changes or the repo becomes reachable again.
 */
const lastLoggedRepoFailure = new Map<string, string>()

function logRepoFailureOnce(repo: string, message: string, data?: Record<string, unknown>): void {
  if (lastLoggedRepoFailure.get(repo) === message) return

  lastLoggedRepoFailure.set(repo, message)
  logError(message, { ...data, repo })
}

function clearRepoFailure(repo: string): void {
  lastLoggedRepoFailure.delete(repo)
}

// Get path to bundled restic binary
function getResticPath(): string {
  const binaryName = process.platform === 'win32' ? 'restic.exe' : 'restic'

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binaryName)
  } else {
    // In dev mode, __dirname is dist-electron/ which is at the project root
    // So we only need to go up one level to reach the project root
    return path.join(__dirname, '..', 'resources', 'bin', process.platform, binaryName)
  }
}

// Get restic command (bundled or system fallback)
function getResticCommand(): string {
  const bundledPath = getResticPath()
  if (fs.existsSync(bundledPath)) {
    return bundledPath
  }
  return 'restic'
}

// ============================================
// Backup Log Helpers
// ============================================

function emitBackupLog(sender: Electron.WebContents, entry: BackupLogEntry): void {
  console.log('[BACKUP-DEBUG] Emitting log:', entry.phase, entry.message)
  sender.send('backup:log', entry)

  // Also log to file for debugging
  const levelMap: Record<BackupLogLevel, string> = {
    debug: 'DEBUG',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    success: 'SUCCESS',
  }
  log(`[Backup:${entry.phase}] [${levelMap[entry.level]}] ${entry.message}`, entry.metadata)
}

function startPhaseStats(phase: BackupPhase): void {
  currentStats = {
    phase,
    startTime: Date.now(),
    filesProcessed: 0,
    filesTotal: 0,
    bytesProcessed: 0,
    bytesTotal: 0,
    errorsEncountered: 0,
  }
}

function endPhaseStats(): BackupOperationStats | null {
  if (currentStats) {
    currentStats.endTime = Date.now()
    const stats = { ...currentStats }
    currentStats = null
    return stats
  }
  return null
}

function emitPhaseStart(sender: Electron.WebContents, phase: BackupPhase, message: string): void {
  startPhaseStats(phase)
  emitBackupLog(sender, {
    level: 'info',
    phase,
    message,
    timestamp: Date.now(),
  })
}

function emitPhaseComplete(
  sender: Electron.WebContents,
  phase: BackupPhase,
  message: string,
): void {
  const stats = endPhaseStats()
  emitBackupLog(sender, {
    level: 'success',
    phase,
    message,
    timestamp: Date.now(),
    metadata: stats
      ? {
          duration: stats.endTime ? stats.endTime - stats.startTime : undefined,
          filesProcessed: stats.filesProcessed,
          bytesProcessed: stats.bytesProcessed,
        }
      : undefined,
  })
}

function emitPhaseError(
  sender: Electron.WebContents,
  phase: BackupPhase,
  message: string,
  error?: string,
  exitCode?: number,
): void {
  if (currentStats) {
    currentStats.errorsEncountered++
  }
  emitBackupLog(sender, {
    level: 'error',
    phase,
    message,
    timestamp: Date.now(),
    metadata: { error, exitCode },
  })
}

// Parse restic JSON output for progress tracking
function parseResticProgress(line: string): {
  type: 'status' | 'summary' | 'unknown'
  percentDone?: number
  filesDone?: number
  filesTotal?: number
  bytesDone?: number
  bytesTotal?: number
  currentFile?: string
  snapshotId?: string
} | null {
  try {
    const json = JSON.parse(line)
    if (json.message_type === 'status') {
      return {
        type: 'status',
        percentDone: json.percent_done,
        filesDone: json.files_done,
        filesTotal: json.total_files,
        bytesDone: json.bytes_done,
        bytesTotal: json.total_bytes,
        currentFile: json.current_files?.[0],
      }
    } else if (json.message_type === 'summary') {
      return {
        type: 'summary',
        snapshotId: json.snapshot_id,
      }
    }
  } catch {
    // Not JSON
  }
  return null
}

// Parse restic restore output (not JSON, text-based)
function parseResticRestoreOutput(line: string): {
  type: 'restoring' | 'verifying' | 'unknown'
  path?: string
} | null {
  const restoringMatch = line.match(/restoring\s+(.+)/)
  if (restoringMatch) {
    return { type: 'restoring', path: restoringMatch[1].trim() }
  }
  const verifyingMatch = line.match(/verifying\s+(.+)/)
  if (verifyingMatch) {
    return { type: 'verifying', path: verifyingMatch[1].trim() }
  }
  return null
}

// ============================================
// Restic Configuration
// ============================================

// Build restic repository URL based on provider
function buildResticRepo(config: {
  provider: string
  bucket: string
  endpoint?: string
  region?: string
}): string {
  if (config.provider === 'backblaze_b2') {
    const endpoint = config.endpoint || 's3.us-west-004.backblazeb2.com'
    return `s3:${endpoint}/${config.bucket}/blueplm-backup`
  } else if (config.provider === 'aws_s3') {
    const region = config.region || 'us-east-1'
    return `s3:s3.${region}.amazonaws.com/${config.bucket}/blueplm-backup`
  } else if (config.provider === 'google_cloud') {
    return `gs:${config.bucket}:/blueplm-backup`
  }
  const endpoint = config.endpoint || 's3.amazonaws.com'
  return `s3:${endpoint}/${config.bucket}/blueplm-backup`
}

export interface BackupHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
  getWorkingDirectory: () => string | null
}

export function registerBackupHandlers(
  window: BrowserWindow,
  deps: BackupHandlerDependencies,
): void {
  mainWindow = window
  log = deps.log
  logError = deps.logError
  getWorkingDirectory = deps.getWorkingDirectory

  // Check if restic is available
  ipcMain.handle('backup:check-restic', async () => {
    const bundledPath = getResticPath()
    if (fs.existsSync(bundledPath)) {
      try {
        const version = execSync(`"${bundledPath}" version`, { encoding: 'utf8' })
        const match = version.match(/restic\s+([\d.]+)/)
        return { installed: true, version: match ? match[1] : 'unknown', path: bundledPath }
      } catch (error) {
        log('Bundled restic failed: ' + String(error))
      }
    }

    try {
      const version = execSync('restic version', { encoding: 'utf8' })
      const match = version.match(/restic\s+([\d.]+)/)
      return { installed: true, version: match ? match[1] : 'unknown', path: 'restic' }
    } catch {
      return {
        installed: false,
        error: 'restic not found. Run "npm run download-restic" to bundle it with the app.',
      }
    }
  })

  // Check if a backup is currently running in the main process
  ipcMain.handle('backup:is-running', async () => {
    return { running: isBackupRunning, startedAt: backupStartedAt }
  })

  // Run backup
  ipcMain.handle(
    'backup:run',
    async (
      event,
      config: {
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
        metadataJson?: string
        vaultName?: string
        vaultPath?: string
      },
    ) => {
      const operationStartTime = Date.now()
      isBackupRunning = true
      backupStartedAt = operationStartTime

      log('Starting backup...', { provider: config.provider, bucket: config.bucket })
      emitBackupLog(event.sender, {
        level: 'info',
        phase: 'idle',
        message: `Starting backup to ${config.provider} (${config.bucket})`,
        timestamp: Date.now(),
        metadata: { operation: 'backup' },
      })

      const env: NodeJS.ProcessEnv = {
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
      emitBackupLog(event.sender, {
        level: 'debug',
        phase: 'idle',
        message: `Repository URL configured: ${repo.replace(/\/\/[^@]+@/, '//***@')}`,
        timestamp: Date.now(),
      })

      try {
        // Phase: Repository Check
        emitPhaseStart(event.sender, 'repo_check', 'Checking repository status...')
        event.sender.send('backup:progress', {
          phase: 'Initializing',
          percent: 5,
          message: 'Checking repository...',
        })

        const resticCmd = getResticCommand()
        emitBackupLog(event.sender, {
          level: 'debug',
          phase: 'repo_check',
          message: `Using restic: ${resticCmd}`,
          timestamp: Date.now(),
        })

        // Check if repo exists, initialize if not
        let repoExists = false
        try {
          await new Promise<void>((resolve, reject) => {
            // Limit concurrent S3 connections to avoid rate limiting
            const check = spawn(
              resticCmd,
              ['-r', repo, 'snapshots', '--json', '-o', 's3.connections=2'],
              { env },
            )
            let stderr = ''

            check.stderr.on('data', (data: Buffer) => {
              stderr += data.toString()
            })

            check.on('close', (code: number) => {
              if (code === 0) {
                emitBackupLog(event.sender, {
                  level: 'info',
                  phase: 'repo_check',
                  message: 'Repository exists and is accessible',
                  timestamp: Date.now(),
                })
                repoExists = true
                resolve()
              } else {
                emitBackupLog(event.sender, {
                  level: 'info',
                  phase: 'repo_check',
                  message: 'Repository does not exist or is not initialized',
                  timestamp: Date.now(),
                  metadata: { exitCode: code, error: stderr.trim() },
                })
                reject(new Error('Repo not initialized'))
              }
            })
            check.on('error', reject)
          })
        } catch {
          // Phase: Repository Init
          emitPhaseStart(event.sender, 'repo_init', 'Initializing new repository...')
          event.sender.send('backup:progress', {
            phase: 'Initializing',
            percent: 10,
            message: 'Creating repository...',
          })

          await new Promise<void>((resolve, reject) => {
            const init = spawn(resticCmd, ['-r', repo, 'init'], { env })
            let stderr = ''
            let stdout = ''

            init.stdout.on('data', (data: Buffer) => {
              stdout += data.toString()
              emitBackupLog(event.sender, {
                level: 'debug',
                phase: 'repo_init',
                message: data.toString().trim(),
                timestamp: Date.now(),
              })
            })

            init.stderr.on('data', (data: Buffer) => {
              stderr += data.toString()
              emitBackupLog(event.sender, {
                level: 'warn',
                phase: 'repo_init',
                message: data.toString().trim(),
                timestamp: Date.now(),
              })
            })

            init.on('close', (code: number) => {
              if (code === 0) {
                emitPhaseComplete(event.sender, 'repo_init', 'Repository initialized successfully')
                resolve()
              } else {
                const errorMsg = stderr || stdout || `Exit code ${code}`
                emitPhaseError(
                  event.sender,
                  'repo_init',
                  'Failed to initialize repository',
                  errorMsg,
                  code,
                )
                reject(new Error(`Failed to initialize repository: ${errorMsg}`))
              }
            })
            init.on('error', (error) => {
              emitPhaseError(
                event.sender,
                'repo_init',
                'Repository init process error',
                error.message,
              )
              reject(error)
            })
          })
        }

        if (repoExists) {
          emitPhaseComplete(event.sender, 'repo_check', 'Repository check complete')
        }

        // Phase: Unlock
        emitPhaseStart(event.sender, 'unlock', 'Removing stale locks...')
        event.sender.send('backup:progress', {
          phase: 'Initializing',
          percent: 12,
          message: 'Checking for stale locks...',
        })

        try {
          await new Promise<void>((resolve) => {
            const unlock = spawn(resticCmd, ['-r', repo, 'unlock'], { env })
            let unlockOutput = ''

            unlock.stderr.on('data', (data: Buffer) => {
              unlockOutput += data.toString()
            })

            unlock.on('close', (code: number) => {
              if (code === 0) {
                emitPhaseComplete(event.sender, 'unlock', 'Stale locks cleared')
              } else {
                emitBackupLog(event.sender, {
                  level: 'debug',
                  phase: 'unlock',
                  message: `Unlock returned code ${code} (likely no locks to remove)`,
                  timestamp: Date.now(),
                })
              }
              resolve()
            })
            unlock.on('error', () => resolve())
          })
        } catch (error) {
          emitBackupLog(event.sender, {
            level: 'warn',
            phase: 'unlock',
            message: `Unlock step error (non-fatal): ${String(error)}`,
            timestamp: Date.now(),
          })
        }

        const workingDirectory = getWorkingDirectory()
        const backupPath = config.vaultPath || workingDirectory
        if (!backupPath) {
          emitPhaseError(event.sender, 'backup', 'No vault connected - nothing to backup')
          throw new Error('No vault connected - nothing to backup')
        }

        // Save database metadata
        if (config.metadataJson) {
          emitBackupLog(event.sender, {
            level: 'info',
            phase: 'backup',
            message: 'Saving database metadata to backup...',
            timestamp: Date.now(),
          })
          event.sender.send('backup:progress', {
            phase: 'Metadata',
            percent: 15,
            message: 'Saving database metadata...',
          })

          const blueplmDir = path.join(backupPath, '.blueplm')
          if (!fs.existsSync(blueplmDir)) {
            fs.mkdirSync(blueplmDir, { recursive: true })
          }

          const metadataPath = path.join(blueplmDir, 'database-export.json')
          fs.writeFileSync(metadataPath, config.metadataJson, 'utf-8')

          emitBackupLog(event.sender, {
            level: 'success',
            phase: 'backup',
            message: `Database metadata saved to ${metadataPath}`,
            timestamp: Date.now(),
          })
        }

        // Phase: Backup
        const vaultDisplayName = config.vaultName || path.basename(backupPath)
        emitPhaseStart(event.sender, 'backup', `Starting backup of ${vaultDisplayName}...`)
        event.sender.send('backup:progress', {
          phase: 'Backing up',
          percent: 20,
          message: `Backing up ${vaultDisplayName}...`,
        })

        const backupArgs = [
          '-r',
          repo,
          'backup',
          backupPath,
          '--json',
          '-o',
          's3.connections=2', // Limit concurrent connections to avoid rate limiting
          '--tag',
          'blueplm',
          '--tag',
          'files',
        ]

        if (config.vaultName) {
          backupArgs.push('--tag', `vault:${config.vaultName}`)
        }

        if (config.metadataJson) {
          backupArgs.push('--tag', 'has-metadata')
        }

        const backupResult = await new Promise<{
          snapshotId: string
          stats: Record<string, unknown>
        }>((resolve, reject) => {
          let output = ''
          let snapshotId = ''
          let lastProgressLog = 0

          const backup = spawn(resticCmd, backupArgs, { env })

          backup.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            for (const line of lines) {
              if (!line.trim()) continue

              const progress = parseResticProgress(line)
              if (progress) {
                if (progress.type === 'status') {
                  // Update internal stats
                  if (currentStats) {
                    currentStats.filesProcessed = progress.filesDone || 0
                    currentStats.filesTotal = progress.filesTotal || 0
                    currentStats.bytesProcessed = progress.bytesDone || 0
                    currentStats.bytesTotal = progress.bytesTotal || 0
                  }

                  const percent = 20 + Math.round((progress.percentDone || 0) * 60)
                  event.sender.send('backup:progress', {
                    phase: 'Backing up',
                    percent,
                    message: `${progress.filesDone || 0} files processed...`,
                  })

                  // Emit detailed log every 5 seconds
                  const now = Date.now()
                  if (now - lastProgressLog > 5000) {
                    lastProgressLog = now
                    emitBackupLog(event.sender, {
                      level: 'info',
                      phase: 'backup',
                      message: `Progress: ${progress.filesDone || 0}/${progress.filesTotal || '?'} files, ${Math.round((progress.percentDone || 0) * 100)}%`,
                      timestamp: now,
                      metadata: {
                        filesProcessed: progress.filesDone,
                        filesTotal: progress.filesTotal,
                        bytesProcessed: progress.bytesDone,
                        bytesTotal: progress.bytesTotal,
                        currentFile: progress.currentFile,
                      },
                    })
                  }
                } else if (progress.type === 'summary') {
                  snapshotId = progress.snapshotId || ''
                  output = line
                }
              }
            }
          })

          backup.stderr.on('data', (data: Buffer) => {
            const msg = data.toString().trim()
            if (msg) {
              emitBackupLog(event.sender, {
                level: 'warn',
                phase: 'backup',
                message: msg,
                timestamp: Date.now(),
              })
            }
          })

          backup.on('close', (code: number) => {
            if (code === 0) {
              try {
                const summary = output ? JSON.parse(output) : {}
                const stats = {
                  filesNew: summary.files_new || 0,
                  filesChanged: summary.files_changed || 0,
                  filesUnmodified: summary.files_unmodified || 0,
                  bytesAdded: summary.data_added || 0,
                  bytesTotal: summary.total_bytes_processed || 0,
                }

                emitPhaseComplete(
                  event.sender,
                  'backup',
                  `Backup complete: ${stats.filesNew} new, ${stats.filesChanged} changed, ${stats.filesUnmodified} unmodified files`,
                )

                resolve({ snapshotId, stats })
              } catch {
                emitPhaseComplete(event.sender, 'backup', 'Backup complete')
                resolve({ snapshotId, stats: {} })
              }
            } else {
              emitPhaseError(event.sender, 'backup', 'Backup failed', `Exit code ${code}`, code)
              reject(new Error(`Backup failed with exit code ${code}`))
            }
          })

          backup.on('error', (error) => {
            emitPhaseError(event.sender, 'backup', 'Backup process error', error.message)
            reject(error)
          })
        })

        // Phase: Retention
        emitPhaseStart(event.sender, 'retention', 'Applying retention policy...')
        event.sender.send('backup:progress', {
          phase: 'Cleanup',
          percent: 85,
          message: 'Applying retention policy...',
        })

        // Remove stale locks before retention
        try {
          await new Promise<void>((resolve) => {
            const unlock = spawn(resticCmd, ['-r', repo, 'unlock'], { env })
            unlock.on('close', () => resolve())
            unlock.on('error', () => resolve())
          })
        } catch {
          // Ignore
        }

        // Apply retention policy
        await new Promise<void>((resolve, reject) => {
          let stderrOutput = ''

          const forget = spawn(
            resticCmd,
            [
              '-r',
              repo,
              'forget',
              '-o',
              's3.connections=2', // Limit concurrent connections to avoid rate limiting
              '--keep-daily',
              String(config.retentionDaily),
              '--keep-weekly',
              String(config.retentionWeekly),
              '--keep-monthly',
              String(config.retentionMonthly),
              '--keep-yearly',
              String(config.retentionYearly),
              '--prune',
            ],
            { env },
          )

          forget.stdout.on('data', (data: Buffer) => {
            const msg = data.toString().trim()
            if (msg) {
              emitBackupLog(event.sender, {
                level: 'debug',
                phase: 'retention',
                message: msg,
                timestamp: Date.now(),
              })
            }
          })

          forget.stderr.on('data', (data: Buffer) => {
            stderrOutput += data.toString()
            const msg = data.toString().trim()
            if (msg) {
              emitBackupLog(event.sender, {
                level: 'warn',
                phase: 'retention',
                message: msg,
                timestamp: Date.now(),
              })
            }
          })

          forget.on('close', (code: number) => {
            if (code === 0) {
              emitPhaseComplete(event.sender, 'retention', 'Retention policy applied successfully')
              resolve()
            } else {
              emitPhaseError(
                event.sender,
                'retention',
                'Retention policy failed',
                stderrOutput.trim(),
                code,
              )
              reject(
                new Error(
                  `Failed to apply retention policy (exit code ${code}): ${stderrOutput.trim() || 'unknown error'}`,
                ),
              )
            }
          })
          forget.on('error', (error) => {
            emitPhaseError(event.sender, 'retention', 'Retention process error', error.message)
            reject(error)
          })
        })

        // Optional local backup
        let localBackupSuccess = false
        if (config.localBackupEnabled && config.localBackupPath) {
          emitBackupLog(event.sender, {
            level: 'info',
            phase: 'backup',
            message: `Creating local backup to ${config.localBackupPath}...`,
            timestamp: Date.now(),
          })
          event.sender.send('backup:progress', {
            phase: 'Local Backup',
            percent: 92,
            message: 'Creating local backup...',
          })

          try {
            const localPath = config.localBackupPath
            if (!fs.existsSync(localPath)) {
              fs.mkdirSync(localPath, { recursive: true })
            }
            if (process.platform === 'win32') {
              execSync(
                `robocopy "${workingDirectory}" "${localPath}" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP`,
                { stdio: 'ignore' },
              )
            } else {
              execSync(`rsync -a --delete "${workingDirectory}/" "${localPath}/"`, {
                stdio: 'ignore',
              })
            }
            localBackupSuccess = true
            emitBackupLog(event.sender, {
              level: 'success',
              phase: 'backup',
              message: 'Local backup created successfully',
              timestamp: Date.now(),
            })
          } catch (error) {
            emitBackupLog(event.sender, {
              level: 'error',
              phase: 'backup',
              message: `Local backup failed: ${String(error)}`,
              timestamp: Date.now(),
            })
          }
        }

        // Phase: Complete
        const totalDuration = Date.now() - operationStartTime
        emitBackupLog(event.sender, {
          level: 'success',
          phase: 'complete',
          message: `Backup completed successfully in ${Math.round(totalDuration / 1000)}s`,
          timestamp: Date.now(),
          metadata: {
            operation: 'backup',
            duration: totalDuration,
            filesProcessed:
              (backupResult.stats as Record<string, number>).filesNew +
              (backupResult.stats as Record<string, number>).filesChanged +
              (backupResult.stats as Record<string, number>).filesUnmodified,
          },
        })
        event.sender.send('backup:progress', {
          phase: 'Complete',
          percent: 100,
          message: 'Backup complete!',
        })

        isBackupRunning = false
        backupStartedAt = null
        return {
          success: true,
          snapshotId: backupResult.snapshotId,
          localBackupSuccess,
          stats: backupResult.stats,
        }
      } catch (error) {
        isBackupRunning = false
        backupStartedAt = null
        const totalDuration = Date.now() - operationStartTime
        emitBackupLog(event.sender, {
          level: 'error',
          phase: 'error',
          message: `Backup failed after ${Math.round(totalDuration / 1000)}s: ${String(error)}`,
          timestamp: Date.now(),
          metadata: { operation: 'backup', error: String(error), duration: totalDuration },
        })
        return { success: false, error: String(error) }
      }
    },
  )

  // List backup snapshots
  ipcMain.handle(
    'backup:list-snapshots',
    async (
      _,
      config: {
        provider: string
        bucket: string
        region?: string
        endpoint?: string
        accessKey: string
        secretKey: string
        resticPassword: string
      },
    ) => {
      const env: NodeJS.ProcessEnv = {
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
        const snapshots = await new Promise<
          Array<{
            id: string
            short_id?: string
            time: string
            hostname: string
            paths: string[]
            tags: string[]
          }>
        >((resolve, reject) => {
          let output = ''
          let stderr = ''

          // Limit concurrent S3 connections to avoid rate limiting
          const list = spawn(
            resticCmd,
            ['-r', repo, 'snapshots', '--json', '-o', 's3.connections=2'],
            { env },
          )

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
              reject(new Error(stderr.trim() || `Restic exited with code ${code}`))
            }
          })

          list.on('error', reject)
        })

        clearRepoFailure(repo)

        return {
          success: true,
          snapshots: snapshots.map((s) => ({
            id: s.short_id || s.id,
            time: s.time,
            hostname: s.hostname,
            paths: s.paths || [],
            tags: s.tags || [],
          })),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logRepoFailureOnce(repo, 'Failed to list snapshots', { error: message })
        return { success: false, error: message, snapshots: [] }
      }
    },
  )

  // Delete a snapshot
  ipcMain.handle(
    'backup:delete-snapshot',
    async (
      _,
      config: {
        provider: string
        bucket: string
        region?: string
        endpoint?: string
        accessKey: string
        secretKey: string
        resticPassword: string
        snapshotId: string
      },
    ) => {
      log('Deleting snapshot...', { snapshotId: config.snapshotId })

      const env: NodeJS.ProcessEnv = {
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
        // Remove any stale locks before operations
        log('Unlocking repository before delete...')
        try {
          await new Promise<void>((resolve) => {
            const unlock = spawn(resticCmd, ['-r', repo, 'unlock'], { env })
            unlock.on('close', () => resolve())
            unlock.on('error', () => resolve())
          })
        } catch {
          // Ignore unlock errors
        }

        // Forget the snapshot
        await new Promise<void>((resolve, reject) => {
          const forget = spawn(
            resticCmd,
            ['-r', repo, 'forget', '-o', 's3.connections=2', config.snapshotId],
            { env },
          )
          let stderr = ''

          forget.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
          })

          forget.on('close', (code: number) => {
            if (code === 0) resolve()
            else reject(new Error(stderr || `Forget failed with exit code ${code}`))
          })
          forget.on('error', reject)
        })

        // Unlock again before prune (in case forget created a lock)
        try {
          await new Promise<void>((resolve) => {
            const unlock = spawn(resticCmd, ['-r', repo, 'unlock'], { env })
            unlock.on('close', () => resolve())
            unlock.on('error', () => resolve())
          })
        } catch {
          // Ignore unlock errors
        }

        // Prune to reclaim space
        await new Promise<void>((resolve, reject) => {
          const prune = spawn(resticCmd, ['-r', repo, 'prune', '-o', 's3.connections=2'], { env })
          let stderr = ''

          prune.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
          })

          prune.on('close', (code: number) => {
            if (code === 0) {
              resolve()
            } else {
              // Exit code 11 typically means lock contention
              let errorMsg = stderr.trim() || `Exit code ${code}`
              if (code === 11) {
                errorMsg = `Repository is locked by another process. ${errorMsg}. Try again in a moment or check if another backup is running.`
              }
              reject(new Error(`Prune failed: ${errorMsg}`))
            }
          })
          prune.on('error', reject)
        })

        log('Snapshot deleted successfully')
        return { success: true }
      } catch (error) {
        logError('Failed to delete snapshot', { error: String(error) })
        return { success: false, error: String(error) }
      }
    },
  )

  // Restore from backup
  ipcMain.handle(
    'backup:restore',
    async (
      event,
      config: {
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
      },
    ) => {
      const operationStartTime = Date.now()

      log('Starting restore...', { snapshotId: config.snapshotId, targetPath: config.targetPath })
      emitBackupLog(event.sender, {
        level: 'info',
        phase: 'idle',
        message: `Starting restore of snapshot ${config.snapshotId} to ${config.targetPath}`,
        timestamp: Date.now(),
        metadata: { operation: 'restore' },
      })

      const env: NodeJS.ProcessEnv = {
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
        // Phase: Repository Check
        emitPhaseStart(event.sender, 'repo_check', 'Connecting to repository...')
        event.sender.send('backup:progress', {
          phase: 'Connecting',
          percent: 5,
          message: 'Connecting to repository...',
        })

        emitBackupLog(event.sender, {
          level: 'debug',
          phase: 'repo_check',
          message: `Using restic: ${resticCmd}`,
          timestamp: Date.now(),
        })

        // Unlock any stale locks first
        emitPhaseStart(event.sender, 'unlock', 'Checking for stale locks...')
        try {
          await new Promise<void>((resolve) => {
            const unlock = spawn(resticCmd, ['-r', repo, 'unlock'], { env })
            unlock.on('close', (code: number) => {
              if (code === 0) {
                emitBackupLog(event.sender, {
                  level: 'debug',
                  phase: 'unlock',
                  message: 'Repository unlocked',
                  timestamp: Date.now(),
                })
              }
              resolve()
            })
            unlock.on('error', () => resolve())
          })
        } catch {
          // Ignore unlock errors
        }
        emitPhaseComplete(event.sender, 'unlock', 'Lock check complete')

        // Phase: Restore
        emitPhaseStart(event.sender, 'restore', `Restoring snapshot ${config.snapshotId}...`)
        event.sender.send('backup:progress', {
          phase: 'Restoring',
          percent: 10,
          message: 'Starting file restore...',
        })

        const args = [
          '-r',
          repo,
          'restore',
          config.snapshotId,
          '--target',
          config.targetPath,
          '-o',
          's3.connections=2', // Limit concurrent connections to avoid rate limiting
          '--verbose', // Add verbose for better progress tracking
        ]

        if (config.specificPaths && config.specificPaths.length > 0) {
          emitBackupLog(event.sender, {
            level: 'info',
            phase: 'restore',
            message: `Restoring specific paths: ${config.specificPaths.join(', ')}`,
            timestamp: Date.now(),
          })
          for (const p of config.specificPaths) {
            args.push('--include', p)
          }
        }

        let filesRestored = 0
        let lastProgressLog = 0

        await new Promise<void>((resolve, reject) => {
          const restore = spawn(resticCmd, args, { env })

          restore.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            for (const line of lines) {
              if (!line.trim()) continue

              const parsed = parseResticRestoreOutput(line)
              if (parsed) {
                filesRestored++
                if (currentStats) {
                  currentStats.filesProcessed = filesRestored
                }

                // Update progress (estimate based on files, not perfect)
                const percent = Math.min(10 + Math.round(filesRestored * 0.1), 80)
                event.sender.send('backup:progress', {
                  phase: 'Restoring',
                  percent,
                  message: `${filesRestored} files restored...`,
                })

                // Emit detailed log every 3 seconds or every 100 files
                const now = Date.now()
                if (now - lastProgressLog > 3000 || filesRestored % 100 === 0) {
                  lastProgressLog = now
                  emitBackupLog(event.sender, {
                    level: 'info',
                    phase: 'restore',
                    message: `${parsed.type === 'restoring' ? 'Restoring' : 'Verifying'}: ${parsed.path}`,
                    timestamp: now,
                    metadata: {
                      filesProcessed: filesRestored,
                      currentFile: parsed.path,
                    },
                  })
                }
              } else if (line.trim()) {
                // Log other output
                emitBackupLog(event.sender, {
                  level: 'debug',
                  phase: 'restore',
                  message: line.trim(),
                  timestamp: Date.now(),
                })
              }
            }
          })

          restore.stderr.on('data', (data: Buffer) => {
            const msg = data.toString().trim()
            if (msg) {
              // Check if it's an error or just info
              const isError =
                msg.toLowerCase().includes('error') ||
                msg.toLowerCase().includes('failed') ||
                msg.toLowerCase().includes('permission denied')

              emitBackupLog(event.sender, {
                level: isError ? 'error' : 'warn',
                phase: 'restore',
                message: msg,
                timestamp: Date.now(),
              })

              if (isError && currentStats) {
                currentStats.errorsEncountered++
              }
            }
          })

          restore.on('close', (code: number) => {
            if (code === 0) {
              emitPhaseComplete(
                event.sender,
                'restore',
                `File restore complete: ${filesRestored} files restored`,
              )
              resolve()
            } else {
              emitPhaseError(
                event.sender,
                'restore',
                'File restore failed',
                `Exit code ${code}`,
                code,
              )
              reject(new Error(`Restore failed with exit code ${code}`))
            }
          })

          restore.on('error', (error) => {
            emitPhaseError(event.sender, 'restore', 'Restore process error', error.message)
            reject(error)
          })
        })

        // Phase: Check for metadata
        event.sender.send('backup:progress', {
          phase: 'Checking',
          percent: 85,
          message: 'Checking for database metadata...',
        })

        const metadataPath = path.join(config.targetPath, '.blueplm', 'database-export.json')
        let hasMetadata = false
        if (fs.existsSync(metadataPath)) {
          hasMetadata = true
          emitBackupLog(event.sender, {
            level: 'success',
            phase: 'restore',
            message: 'Found database metadata in restored backup',
            timestamp: Date.now(),
          })
        } else {
          emitBackupLog(event.sender, {
            level: 'info',
            phase: 'restore',
            message: 'No database metadata found in backup',
            timestamp: Date.now(),
          })
        }

        // Phase: Complete
        const totalDuration = Date.now() - operationStartTime
        emitBackupLog(event.sender, {
          level: 'success',
          phase: 'complete',
          message: `Restore completed successfully in ${Math.round(totalDuration / 1000)}s (${filesRestored} files)`,
          timestamp: Date.now(),
          metadata: {
            operation: 'restore',
            duration: totalDuration,
            filesProcessed: filesRestored,
          },
        })
        event.sender.send('backup:progress', {
          phase: 'Complete',
          percent: 100,
          message: 'Restore complete!',
        })

        return { success: true, hasMetadata, filesRestored }
      } catch (error) {
        const totalDuration = Date.now() - operationStartTime
        emitBackupLog(event.sender, {
          level: 'error',
          phase: 'error',
          message: `Restore failed after ${Math.round(totalDuration / 1000)}s: ${String(error)}`,
          timestamp: Date.now(),
          metadata: { operation: 'restore', error: String(error), duration: totalDuration },
        })
        return { success: false, error: String(error) }
      }
    },
  )

  // Read database metadata from vault directory
  ipcMain.handle('backup:read-metadata', async (_, vaultPath: string) => {
    const metadataPath = path.join(vaultPath, '.blueplm', 'database-export.json')

    log('[DEBUG] Looking for metadata at: ' + metadataPath)

    if (!fs.existsSync(metadataPath)) {
      log('[DEBUG] Metadata file NOT found at: ' + metadataPath)

      // Check if restic restored with full path structure
      // List contents of .blueplm folder if it exists
      const blueplmDir = path.join(vaultPath, '.blueplm')
      if (fs.existsSync(blueplmDir)) {
        const contents = fs.readdirSync(blueplmDir)
        log('[DEBUG] .blueplm folder exists, contents: ' + JSON.stringify(contents))
      } else {
        log('[DEBUG] .blueplm folder does not exist')
        // List top-level contents of vault path
        if (fs.existsSync(vaultPath)) {
          const contents = fs.readdirSync(vaultPath).slice(0, 20)
          log('[DEBUG] Vault path contents (first 20): ' + JSON.stringify(contents))
        }
      }

      return { success: false, error: 'No metadata file found' }
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8')
      log('[DEBUG] Metadata file size: ' + content.length + ' bytes')

      const data = JSON.parse(content)

      if (data._type !== 'blueplm_database_export') {
        log('[DEBUG] Invalid metadata type: ' + data._type)
        return { success: false, error: 'Invalid metadata file format' }
      }

      // Debug: log the structure
      log('[DEBUG] Metadata structure:', {
        _type: data._type,
        _version: data._version,
        _exportedAt: data._exportedAt,
        _orgName: data._orgName,
        _vaultName: data._vaultName,
        filesCount: Array.isArray(data.files)
          ? data.files.length
          : 'NOT AN ARRAY: ' + typeof data.files,
        fileVersionsCount: Array.isArray(data.fileVersions)
          ? data.fileVersions.length
          : 'NOT AN ARRAY: ' + typeof data.fileVersions,
      })

      log('Read database metadata from: ' + metadataPath)
      return { success: true, data }
    } catch (error) {
      logError('Failed to read metadata', { error: String(error) })
      return { success: false, error: String(error) }
    }
  })
}

export function unregisterBackupHandlers(): void {
  const handlers = [
    'backup:check-restic',
    'backup:is-running',
    'backup:run',
    'backup:list-snapshots',
    'backup:delete-snapshot',
    'backup:restore',
    'backup:read-metadata',
  ]

  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}
