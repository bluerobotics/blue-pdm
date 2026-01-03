// Electron-specific types used across handler modules

export interface LogRetentionSettings {
  maxFiles: number           // Max number of log files to keep (0 = unlimited)
  maxAgeDays: number         // Max age in days (0 = unlimited)
  maxSizeMb: number          // Max size per log file in MB
  maxTotalSizeMb: number     // Max total size of all log files in MB (0 = unlimited)
}

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export interface UpdateReminder {
  version: string
  postponedAt: number  // timestamp
}

// SolidWorks service types
export interface SWCommand {
  action: string
  filePath?: string
  [key: string]: unknown
}

export interface SWCommandResult {
  success: boolean
  error?: string
  [key: string]: unknown
}

// Backup config types
export interface BackupConfig {
  provider: string
  bucket: string
  region?: string
  endpoint?: string
  accessKey: string
  secretKey: string
  resticPassword: string
}

export interface BackupRunConfig extends BackupConfig {
  retentionDaily: number
  retentionWeekly: number
  retentionMonthly: number
  retentionYearly: number
  localBackupEnabled?: boolean
  localBackupPath?: string
  metadataJson?: string
  vaultName?: string
  vaultPath?: string
}

export interface RestoreConfig extends BackupConfig {
  snapshotId: string
  targetPath: string
  specificPaths?: string[]
}
