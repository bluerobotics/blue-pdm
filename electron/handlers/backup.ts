// Backup handlers for Electron main process (restic-based backup)
import { app, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'

// Module state
let mainWindow: BrowserWindow | null = null

// External log function reference
let log: (message: string, data?: unknown) => void = console.log
let logError: (message: string, data?: unknown) => void = console.error

// External working directory getter
let getWorkingDirectory: () => string | null = () => null

// Get path to bundled restic binary
function getResticPath(): string {
  const binaryName = process.platform === 'win32' ? 'restic.exe' : 'restic'
  
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binaryName)
  } else {
    return path.join(__dirname, '..', '..', 'resources', 'bin', process.platform, binaryName)
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

export function registerBackupHandlers(window: BrowserWindow, deps: BackupHandlerDependencies): void {
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
      } catch (err) {
        log('Bundled restic failed: ' + String(err))
      }
    }
    
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
    metadataJson?: string
    vaultName?: string
    vaultPath?: string
  }) => {
    log('Starting backup...', { provider: config.provider, bucket: config.bucket })
    
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
    log('Restic repository URL: ' + repo)
    
    try {
      event.sender.send('backup:progress', { phase: 'Initializing', percent: 5, message: 'Checking repository...' })
      
      const resticCmd = getResticCommand()
      
      // Check if repo exists, initialize if not
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
          init.on('error', reject)
        })
      }
      
      // Remove stale locks
      event.sender.send('backup:progress', { phase: 'Initializing', percent: 12, message: 'Checking for stale locks...' })
      try {
        await new Promise<void>((resolve) => {
          const unlock = spawn(resticCmd, ['-r', repo, 'unlock'], { env })
          unlock.stderr.on('data', (data: Buffer) => {
            log('restic unlock stderr: ' + data.toString())
          })
          unlock.on('close', (code: number) => {
            if (code === 0) {
              log('Repository unlocked (cleared any stale locks)')
            } else {
              log('Unlock returned code ' + code + ' (likely no locks to remove)')
            }
            resolve()
          })
          unlock.on('error', () => resolve())
        })
      } catch (err) {
        log('Unlock step error (non-fatal): ' + String(err))
      }
      
      const workingDirectory = getWorkingDirectory()
      const backupPath = config.vaultPath || workingDirectory
      if (!backupPath) {
        throw new Error('No vault connected - nothing to backup')
      }
      
      // Save database metadata
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
      
      const backupArgs = [
        '-r', repo,
        'backup',
        backupPath,
        '--json',
        '--tag', 'blueplm',
        '--tag', 'files'
      ]
      
      if (config.vaultName) {
        backupArgs.push('--tag', `vault:${config.vaultName}`)
      }
      
      if (config.metadataJson) {
        backupArgs.push('--tag', 'has-metadata')
      }
      
      const backupResult = await new Promise<{ snapshotId: string; stats: Record<string, unknown> }>((resolve, reject) => {
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
        
        const forget = spawn(resticCmd, [
          '-r', repo,
          'forget',
          '--keep-daily', String(config.retentionDaily),
          '--keep-weekly', String(config.retentionWeekly),
          '--keep-monthly', String(config.retentionMonthly),
          '--keep-yearly', String(config.retentionYearly),
          '--prune'
        ], { env })
        
        forget.stderr.on('data', (data: Buffer) => {
          stderrOutput += data.toString()
          log('restic forget stderr: ' + data.toString())
        })
        
        forget.on('close', (code: number) => {
          if (code === 0) resolve()
          else {
            logError('Retention policy failed', { exitCode: code, stderr: stderrOutput })
            reject(new Error(`Failed to apply retention policy (exit code ${code}): ${stderrOutput.trim() || 'unknown error'}`))
          }
        })
        forget.on('error', reject)
      })
      
      // Optional local backup
      let localBackupSuccess = false
      if (config.localBackupEnabled && config.localBackupPath) {
        event.sender.send('backup:progress', { phase: 'Local Backup', percent: 92, message: 'Creating local backup...' })
        try {
          const localPath = config.localBackupPath
          if (!fs.existsSync(localPath)) {
            fs.mkdirSync(localPath, { recursive: true })
          }
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
      const snapshots = await new Promise<Array<{ id: string; short_id?: string; time: string; hostname: string; paths: string[]; tags: string[] }>>((resolve, reject) => {
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
        
        list.on('error', reject)
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

  // Delete a snapshot
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
  ipcMain.handle('backup:restore', async (_event, config: {
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
    log('Starting restore...', { snapshotId: config.snapshotId, targetPath: config.targetPath })
    
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

  // Read database metadata from vault directory
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
}

export function unregisterBackupHandlers(): void {
  const handlers = [
    'backup:check-restic',
    'backup:run',
    'backup:list-snapshots',
    'backup:delete-snapshot',
    'backup:restore',
    'backup:read-metadata'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}
