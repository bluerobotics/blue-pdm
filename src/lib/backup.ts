// Backup service - simplified to use restic directly for everything
import { getSupabaseClient } from './supabase'
import { log } from '@/lib/logger'

// ============================================
// Types
// ============================================

export interface BackupConfig {
  id: string
  org_id: string
  provider: 'backblaze_b2' | 'aws_s3' | 'google_cloud'
  bucket: string | null
  region: string | null
  endpoint: string | null
  access_key_encrypted: string | null
  secret_key_encrypted: string | null
  restic_password_encrypted: string | null
  retention_daily: number
  retention_weekly: number
  retention_monthly: number
  retention_yearly: number
  // Schedule
  schedule_enabled: boolean
  schedule_hour: number
  schedule_minute: number
  schedule_timezone: string
  // Designated machine info
  designated_machine_id: string | null
  designated_machine_name: string | null
  designated_machine_platform: string | null
  designated_machine_user_email: string | null
  designated_machine_last_seen: string | null
  // Backup request state
  backup_requested_at: string | null
  backup_requested_by: string | null
  backup_running_since: string | null
  // Timestamps
  created_at: string
  updated_at: string
}

// Snapshot info from restic directly
export interface BackupSnapshot {
  id: string // Short ID (first 8 chars)
  short_id: string // Same as id
  time: string // ISO timestamp
  hostname: string // Machine that created backup
  paths: string[] // Backed up paths
  tags: string[] // Tags (e.g., 'blueplm')
  // Parsed from restic
  tree?: string
  parent?: string
}

export interface BackupStatus {
  isConfigured: boolean
  config: BackupConfig | null
  snapshots: BackupSnapshot[] // Live from restic
  lastSnapshot: BackupSnapshot | null
  totalSnapshots: number
  isLoading: boolean
  error: string | null
}

export interface BackupResult {
  success: boolean
  snapshotId?: string
  error?: string
  stats?: {
    filesNew: number
    filesChanged: number
    filesUnmodified: number
    bytesAdded: number
    bytesTotal: number
    durationSeconds: number
  }
}

// ============================================
// Machine ID Management (still useful for identifying backup source)
// ============================================

export async function getMachineId(): Promise<string> {
  if (window.electronAPI?.getMachineId) {
    const id = await window.electronAPI.getMachineId()
    if (id) return id
  }

  let machineId = localStorage.getItem('blueplm_machine_id')
  if (!machineId) {
    machineId = `machine_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
    localStorage.setItem('blueplm_machine_id', machineId)
  }
  return machineId
}

export async function getMachineName(): Promise<string> {
  if (window.electronAPI?.getMachineName) {
    const name = await window.electronAPI.getMachineName()
    if (name) return name
  }
  return 'Unknown Machine'
}

export async function getPlatform(): Promise<string> {
  if (window.electronAPI?.getPlatform) {
    return await window.electronAPI.getPlatform()
  }
  return 'unknown'
}

// ============================================
// Backup Config Functions (stored in Supabase for convenience)
// ============================================

export async function getBackupConfig(orgId: string): Promise<BackupConfig | null> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('backup_config')
    .select('*')
    .eq('org_id', orgId)
    .single()

  if (error && error.code !== 'PGRST116') {
    log.error('[Backup]', 'Error fetching config', { error: error.message })
    return null
  }

  return data as BackupConfig | null
}

export async function saveBackupConfig(
  orgId: string,
  config: Partial<BackupConfig>,
  _userId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient()

  const updateData = {
    ...config,
    org_id: orgId,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('backup_config')
    .upsert(updateData, { onConflict: 'org_id' })

  if (error) {
    log.error('[Backup]', 'Error saving config', { error: error.message })
    return { success: false, error: error.message }
  }

  return { success: true }
}

// ============================================
// Designated Machine Functions
// ============================================

// Set this machine as the designated backup machine
export async function designateThisMachine(
  orgId: string,
  userEmail: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient()

  const machineId = await getMachineId()
  const machineName = await getMachineName()
  const platform = await getPlatform()

  const { error } = await supabase
    .from('backup_config')
    .update({
      designated_machine_id: machineId,
      designated_machine_name: machineName,
      designated_machine_platform: platform,
      designated_machine_user_email: userEmail,
      designated_machine_last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)

  if (error) {
    log.error('[Backup]', 'Error designating machine', { error: error.message })
    return { success: false, error: error.message }
  }

  log.info('[Backup]', 'This machine designated as backup source', { machineName })
  return { success: true }
}

// Clear designated machine
export async function clearDesignatedMachine(
  orgId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from('backup_config')
    .update({
      designated_machine_id: null,
      designated_machine_name: null,
      designated_machine_platform: null,
      designated_machine_user_email: null,
      designated_machine_last_seen: null,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)

  if (error) {
    log.error('[Backup]', 'Error clearing designated machine', { error: error.message })
    return { success: false, error: error.message }
  }

  return { success: true }
}

// Update heartbeat (called every minute by designated machine)
export async function updateHeartbeat(orgId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const machineId = await getMachineId()

  // Direct update instead of RPC
  const { error } = await supabase
    .from('backup_config')
    .update({
      designated_machine_last_seen: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('designated_machine_id', machineId)

  if (error) {
    log.error('[Backup]', 'Heartbeat error', { error: error.message })
    return false
  }

  return true
}

// Check if designated machine is online (seen within last 2 minutes)
export function isDesignatedMachineOnline(config: BackupConfig | null): boolean {
  if (!config?.designated_machine_last_seen) return false

  const lastSeen = new Date(config.designated_machine_last_seen).getTime()
  const twoMinutesAgo = Date.now() - 2 * 60 * 1000
  return lastSeen > twoMinutesAgo
}

// Check if this is the designated machine
export async function isThisDesignatedMachine(config: BackupConfig | null): Promise<boolean> {
  if (!config?.designated_machine_id) return false
  const machineId = await getMachineId()
  return config.designated_machine_id === machineId
}

// Request a backup (called by any admin)
export async function requestBackup(
  orgId: string,
  userEmail: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient()

  // Check if there's a designated machine first
  const { data: config, error: configError } = await supabase
    .from('backup_config')
    .select('designated_machine_id')
    .eq('org_id', orgId)
    .single()

  if (configError || !config?.designated_machine_id) {
    return { success: false, error: 'No designated machine configured' }
  }

  // Direct update instead of RPC
  const { error } = await supabase
    .from('backup_config')
    .update({
      backup_requested_at: new Date().toISOString(),
      backup_requested_by: userEmail,
    })
    .eq('org_id', orgId)

  if (error) {
    log.error('[Backup]', 'Error requesting backup', { error: error.message })
    return { success: false, error: error.message }
  }

  return { success: true }
}

// Check if there's a pending backup request (called by designated machine)
export function hasPendingBackupRequest(config: BackupConfig | null): boolean {
  return !!config?.backup_requested_at && !config?.backup_running_since
}

// Mark backup as started (called by designated machine)
export async function markBackupStarted(orgId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const machineId = await getMachineId()

  // Verify this is the designated machine and update running state
  const { error } = await supabase
    .from('backup_config')
    .update({
      backup_running_since: new Date().toISOString(),
      backup_requested_at: null,
      backup_requested_by: null,
    })
    .eq('org_id', orgId)
    .eq('designated_machine_id', machineId)

  if (error) {
    log.error('[Backup]', 'Error marking backup started', { error: error.message })
    return false
  }

  return true
}

// Mark backup as complete (called by designated machine)
export async function markBackupComplete(orgId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const machineId = await getMachineId()

  // Verify this is the designated machine and clear running state
  const { error } = await supabase
    .from('backup_config')
    .update({
      backup_running_since: null,
    })
    .eq('org_id', orgId)
    .eq('designated_machine_id', machineId)

  if (error) {
    log.error('[Backup]', 'Error marking backup complete', { error: error.message })
    return false
  }

  return true
}

// ============================================
// Heartbeat & Request Polling Service
// ============================================

let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let pollingInterval: ReturnType<typeof setInterval> | null = null
let lastScheduledBackupDate: string | null = null

// Module-level backup running state so it survives component unmount/remount
let _isBackupRunning = false
let _backupStartedAt: number | null = null

export function isBackupRunningLocally(): boolean {
  return _isBackupRunning
}

export function getBackupStartedAt(): number | null {
  return _backupStartedAt
}

export function setBackupRunningLocally(running: boolean): void {
  _isBackupRunning = running
  _backupStartedAt = running ? Date.now() : null
}

// Check if it's time for a scheduled backup
function shouldRunScheduledBackup(config: BackupConfig): boolean {
  if (!config.schedule_enabled) return false

  const now = new Date()

  // Get current time in the configured timezone
  let currentHour: number
  let currentMinute: number
  let today: string

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.schedule_timezone || 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = formatter.formatToParts(now)
    currentHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0')
    currentMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0')

    // Get today's date in the configured timezone
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.schedule_timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    today = dateFormatter.format(now)
  } catch {
    // Fallback to UTC if timezone is invalid
    currentHour = now.getUTCHours()
    currentMinute = now.getUTCMinutes()
    today = now.toISOString().split('T')[0]
  }

  if (currentHour === config.schedule_hour && currentMinute === config.schedule_minute) {
    if (lastScheduledBackupDate === today) return false
    lastScheduledBackupDate = today
    return true
  }
  return false
}

// Start heartbeat and polling (called when app starts if this is designated machine)
export function startBackupService(
  orgId: string,
  _vaultId: string,
  onBackupRequest: (config: BackupConfig) => void,
  getLatestConfig: () => Promise<BackupConfig | null>,
): void {
  stopBackupService()

  log.info('[Backup]', 'Starting backup service')

  // Immediate heartbeat
  updateHeartbeat(orgId)

  // Heartbeat every minute
  heartbeatInterval = setInterval(() => {
    updateHeartbeat(orgId)
  }, 60 * 1000)

  // Poll for backup requests and schedule every 30 seconds
  pollingInterval = setInterval(async () => {
    try {
      const config = await getLatestConfig()
      if (!config) return

      // Check if we're still the designated machine
      const isDesignated = await isThisDesignatedMachine(config)
      if (!isDesignated) {
        log.info('[Backup]', 'No longer designated machine, stopping service')
        stopBackupService()
        return
      }

      // Skip if already running, but auto-clear if stuck for over 2 hours
      if (config.backup_running_since) {
        const runningSince = new Date(config.backup_running_since).getTime()
        const TWO_HOURS_MS = 2 * 60 * 60 * 1000
        if (Date.now() - runningSince > TWO_HOURS_MS) {
          log.warn('[Backup]', 'backup_running_since stuck for >2 hours, auto-clearing', {
            runningSince: config.backup_running_since,
            ageMinutes: Math.round((Date.now() - runningSince) / 60000),
          })
          await markBackupComplete(orgId)
        } else {
          return
        }
      }

      // Check for pending backup request
      if (hasPendingBackupRequest(config)) {
        onBackupRequest(config)
        return
      }

      // Check for scheduled backup
      if (shouldRunScheduledBackup(config)) {
        onBackupRequest(config)
      }
    } catch (error) {
      log.error('[Backup]', 'Polling error', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, 30 * 1000)
}

// Stop the service
export function stopBackupService(): void {
  const wasRunning = heartbeatInterval !== null || pollingInterval !== null

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }

  // startBackupService calls this defensively, so logging unconditionally makes every
  // start look like a stop/start cycle in the log.
  if (wasRunning) {
    log.info('[Backup]', 'Backup service stopped')
  }
}

// ============================================
// Restic Operations - All backup data lives here!
// ============================================

// Queue for restic operations that can't run in parallel
// (restic locks the repository during operations)
const deleteQueue: Array<{
  config: BackupConfig
  snapshotId: string
  resolve: (result: { success: boolean; error?: string }) => void
}> = []
let isProcessingDeleteQueue = false

// ============================================
// Snapshot Caching and Rate Limiting
// ============================================

interface SnapshotCache {
  snapshots: BackupSnapshot[]
  timestamp: number
  configHash: string // To invalidate cache if config changes
}

let snapshotCache: SnapshotCache | null = null
let pendingSnapshotRequest: Promise<BackupSnapshot[]> | null = null
let backoffMs = 0
let lastErrorTime = 0

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_BACKOFF_MS = 10 * 60 * 1000 // 10 minutes
const INITIAL_BACKOFF_MS = 30 * 1000 // 30 seconds
const BACKOFF_MULTIPLIER = 2

// Generate a simple hash of config to detect changes
function getConfigHash(config: BackupConfig): string {
  return `${config.provider}:${config.bucket}:${config.endpoint}:${config.region}`
}

// Check if cache is still valid
function isCacheValid(config: BackupConfig): boolean {
  if (!snapshotCache) return false
  if (getConfigHash(config) !== snapshotCache.configHash) return false
  return Date.now() - snapshotCache.timestamp < CACHE_TTL_MS
}

// Check if we're in backoff period
function isInBackoff(): boolean {
  if (backoffMs === 0) return false
  return Date.now() - lastErrorTime < backoffMs
}

// Get remaining backoff time in seconds
export function getBackoffRemaining(): number {
  if (!isInBackoff()) return 0
  return Math.max(0, Math.ceil((lastErrorTime + backoffMs - Date.now()) / 1000))
}

// Get cache age in seconds (for UI display)
export function getSnapshotCacheAge(): number | null {
  if (!snapshotCache) return null
  return Math.floor((Date.now() - snapshotCache.timestamp) / 1000)
}

// Check if we have cached data available
export function hasCachedSnapshots(): boolean {
  return snapshotCache !== null && snapshotCache.snapshots.length > 0
}

// Get cached snapshots without triggering a fetch
export function getCachedSnapshots(): BackupSnapshot[] {
  return snapshotCache?.snapshots || []
}

// Clear the backoff (call after successful operation)
function clearBackoff(): void {
  backoffMs = 0
  lastErrorTime = 0
}

// Increase backoff exponentially
function increaseBackoff(): void {
  if (backoffMs === 0) {
    backoffMs = INITIAL_BACKOFF_MS
  } else {
    backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)
  }
  lastErrorTime = Date.now()
  log.warn('[Backup]', `Rate limited - backing off for ${Math.round(backoffMs / 1000)}s`)
}

// Check if error is rate-limiting related
function isRateLimitError(errorMsg: string): boolean {
  const rateLimitPatterns = [
    '503',
    'too many requests',
    'rate limit',
    'service unavailable',
    'temporarily unavailable',
    'try again later',
  ]
  const lowerError = errorMsg.toLowerCase()
  return rateLimitPatterns.some((pattern) => lowerError.includes(pattern))
}

async function processDeleteQueue(): Promise<void> {
  if (isProcessingDeleteQueue || deleteQueue.length === 0) return

  isProcessingDeleteQueue = true

  while (deleteQueue.length > 0) {
    const item = deleteQueue.shift()!

    try {
      const result = await deleteSnapshotInternal(item.config, item.snapshotId)
      item.resolve(result)
    } catch (error) {
      item.resolve({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  isProcessingDeleteQueue = false
}

// List snapshots directly from restic (with caching, deduplication, and backoff)
export async function listSnapshots(
  config: BackupConfig,
  options?: { forceRefresh?: boolean },
): Promise<BackupSnapshot[]> {
  if (!window.electronAPI?.listBackupSnapshots) {
    log.error('[Backup]', 'listBackupSnapshots not available')
    return getCachedSnapshots()
  }

  if (
    !config.bucket ||
    !config.access_key_encrypted ||
    !config.secret_key_encrypted ||
    !config.restic_password_encrypted
  ) {
    log.error('[Backup]', 'Config incomplete for listing snapshots')
    return getCachedSnapshots()
  }

  // Return cached data if valid (unless force refresh)
  if (!options?.forceRefresh && isCacheValid(config)) {
    log.debug('[Backup]', 'Returning cached snapshots', {
      age: Math.round((Date.now() - snapshotCache!.timestamp) / 1000) + 's',
    })
    return snapshotCache!.snapshots
  }

  // Check if we're in backoff period
  if (isInBackoff()) {
    const remaining = getBackoffRemaining()
    log.warn('[Backup]', `In backoff period, ${remaining}s remaining. Returning cached data.`)
    return getCachedSnapshots()
  }

  // If there's already a request in flight, wait for it instead of making a new one
  if (pendingSnapshotRequest) {
    log.debug('[Backup]', 'Waiting for in-flight snapshot request')
    try {
      return await pendingSnapshotRequest
    } catch {
      return getCachedSnapshots()
    }
  }

  // Make the actual request
  pendingSnapshotRequest = (async () => {
    try {
      const result = await window.electronAPI!.listBackupSnapshots({
        provider: config.provider,
        bucket: config.bucket || '',
        region: config.region || undefined,
        endpoint: config.endpoint || undefined,
        accessKey: config.access_key_encrypted || '',
        secretKey: config.secret_key_encrypted || '',
        resticPassword: config.restic_password_encrypted || '',
      })

      // Add short_id if missing (restic returns id but not always short_id)
      const snapshots = (result.snapshots || []).map((s) => ({
        ...s,
        short_id: (s as any).short_id || s.id.substring(0, 8), // TODO: type this
      }))

      // Success! Update cache and clear backoff
      snapshotCache = {
        snapshots,
        timestamp: Date.now(),
        configHash: getConfigHash(config),
      }
      clearBackoff()

      log.debug('[Backup]', 'Snapshot list refreshed', { count: snapshots.length })
      return snapshots
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error('[Backup]', 'Failed to list snapshots', { error: errorMsg })

      // Check if this is a rate-limiting error
      if (isRateLimitError(errorMsg)) {
        increaseBackoff()
      }

      // Return cached data if available, otherwise empty array
      return getCachedSnapshots()
    } finally {
      pendingSnapshotRequest = null
    }
  })()

  return pendingSnapshotRequest
}

// Internal delete function (called by queue processor)
async function deleteSnapshotInternal(
  config: BackupConfig,
  snapshotId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!window.electronAPI?.deleteBackupSnapshot) {
    return { success: false, error: 'Delete not available: Electron API not found' }
  }

  if (
    !config.bucket ||
    !config.access_key_encrypted ||
    !config.secret_key_encrypted ||
    !config.restic_password_encrypted
  ) {
    return { success: false, error: 'Config incomplete for delete' }
  }

  try {
    const result = await window.electronAPI.deleteBackupSnapshot({
      provider: config.provider,
      bucket: config.bucket,
      region: config.region || undefined,
      endpoint: config.endpoint || undefined,
      accessKey: config.access_key_encrypted,
      secretKey: config.secret_key_encrypted,
      resticPassword: config.restic_password_encrypted,
      snapshotId,
    })

    return { success: result.success, error: result.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Delete a snapshot from restic (queued to prevent lock conflicts)
export async function deleteSnapshot(
  config: BackupConfig,
  snapshotId: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    deleteQueue.push({ config, snapshotId, resolve })
    processDeleteQueue()
  })
}

// Run a backup
export async function runBackup(
  config: BackupConfig,
  options?: {
    vaultId?: string // For database metadata export
    vaultName?: string // For tagging the snapshot
    vaultPath?: string // Override working directory
    metadataJson?: string // Pre-exported metadata
  },
): Promise<BackupResult> {
  const startTime = Date.now()

  try {
    if (!config.bucket || !config.access_key_encrypted || !config.secret_key_encrypted) {
      throw new Error('Backup not configured: missing bucket or credentials')
    }

    if (!config.restic_password_encrypted) {
      throw new Error('Backup not configured: missing restic password')
    }

    // Export database metadata if vaultId provided
    let metadataJson = options?.metadataJson
    if (!metadataJson && options?.vaultId) {
      window.electronAPI?.log('info', '[Backup] Exporting database metadata...', {
        orgId: config.org_id,
        vaultId: options.vaultId,
      })
      const metadataExport = await exportDatabaseMetadata(config.org_id, options.vaultId)
      if (metadataExport.success && metadataExport.data) {
        metadataJson = JSON.stringify(metadataExport.data, null, 2)
        window.electronAPI?.log('info', '[Backup] Database metadata exported successfully', {
          files: metadataExport.data.files?.length,
          versions: metadataExport.data.fileVersions?.length,
        })
      } else {
        window.electronAPI?.log('error', '[Backup] Failed to export metadata', {
          error: metadataExport.error,
        })
      }
    } else if (!options?.vaultId) {
      window.electronAPI?.log('warn', '[Backup] No vaultId provided, skipping metadata export')
    }

    if (!window.electronAPI?.runBackup) {
      throw new Error('Backup not available: Electron API not found')
    }

    const result = await window.electronAPI.runBackup({
      provider: config.provider,
      bucket: config.bucket,
      region: config.region || undefined,
      endpoint: config.endpoint || undefined,
      accessKey: config.access_key_encrypted,
      secretKey: config.secret_key_encrypted,
      resticPassword: config.restic_password_encrypted,
      retentionDaily: config.retention_daily,
      retentionWeekly: config.retention_weekly,
      retentionMonthly: config.retention_monthly,
      retentionYearly: config.retention_yearly,
      metadataJson,
      vaultName: options?.vaultName,
      vaultPath: options?.vaultPath,
    })

    const durationSeconds = Math.round((Date.now() - startTime) / 1000)

    if (result.success) {
      return {
        success: true,
        snapshotId: result.snapshotId,
        stats: {
          filesNew: result.stats?.filesNew || 0,
          filesChanged: result.stats?.filesChanged || 0,
          filesUnmodified: result.stats?.filesUnmodified || 0,
          bytesAdded: result.stats?.bytesAdded || 0,
          bytesTotal: result.stats?.bytesTotal || 0,
          durationSeconds,
        },
      }
    } else {
      throw new Error(result.error || 'Backup failed')
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Restore files from a snapshot
export async function restoreFromSnapshot(
  config: BackupConfig,
  snapshotId: string,
  targetPath: string,
  specificPaths?: string[],
): Promise<{ success: boolean; hasMetadata?: boolean; error?: string }> {
  if (!window.electronAPI?.restoreFromBackup) {
    return { success: false, error: 'Restore not available: Electron API not found' }
  }

  if (
    !config.bucket ||
    !config.access_key_encrypted ||
    !config.secret_key_encrypted ||
    !config.restic_password_encrypted
  ) {
    return { success: false, error: 'Config incomplete for restore' }
  }

  try {
    const result = await window.electronAPI.restoreFromBackup({
      provider: config.provider,
      bucket: config.bucket,
      region: config.region || undefined,
      endpoint: config.endpoint || undefined,
      accessKey: config.access_key_encrypted,
      secretKey: config.secret_key_encrypted,
      resticPassword: config.restic_password_encrypted,
      snapshotId,
      targetPath,
      specificPaths,
    })

    return { success: result.success, hasMetadata: result.hasMetadata, error: result.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Get complete backup status
export async function getBackupStatus(orgId: string): Promise<BackupStatus> {
  const config = await getBackupConfig(orgId)

  const isConfigured = !!(
    config?.bucket &&
    config?.access_key_encrypted &&
    config?.restic_password_encrypted
  )

  // If not configured, return empty status
  if (!isConfigured || !config) {
    return {
      isConfigured: false,
      config: null,
      snapshots: [],
      lastSnapshot: null,
      totalSnapshots: 0,
      isLoading: false,
      error: null,
    }
  }

  // Get snapshots directly from restic
  let snapshots: BackupSnapshot[] = []
  let error: string | null = null

  try {
    snapshots = await listSnapshots(config)
    // Sort by time descending
    snapshots.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  } catch (error) {
    error = error instanceof Error ? error.message : String(error)
    log.error('[Backup]', 'Failed to get snapshots', { error })
  }

  return {
    isConfigured: true,
    config,
    snapshots,
    lastSnapshot: snapshots[0] || null,
    totalSnapshots: snapshots.length,
    isLoading: false,
    error,
  }
}

// ============================================
// Database Metadata Export/Import
// ============================================

export interface DatabaseExport {
  _type: 'blueplm_database_export'
  _version: 3 // Updated to v3 for new schema
  _exportedAt: string
  _orgId: string
  _orgName: string
  _vaultId: string
  _vaultName: string
  files: Array<{
    id: string
    file_path: string
    file_name: string
    extension: string
    file_type: 'part' | 'assembly' | 'drawing' | 'pdf' | 'step' | 'other'
    content_hash: string | null
    file_size: number | null
    state: string | null
    checked_out_by: string | null
    checked_out_at: string | null
    version: number
    created_at: string | null
    updated_at: string | null
    deleted_at: string | null
  }>
  fileVersions: Array<{
    id: string
    file_id: string
    version: number
    revision: string
    content_hash: string
    file_size: number | null
    state: string
    created_by: string
    created_at: string | null
  }>
  fileComments: Array<unknown> // May not exist in all deployments
  users: Array<{
    id: string
    email: string
    full_name: string | null
    role: string
  }>
}

export async function exportDatabaseMetadata(
  orgId: string,
  vaultId: string,
): Promise<{ success: boolean; data?: DatabaseExport; error?: string }> {
  const supabase = getSupabaseClient()

  try {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single()

    if (orgError) {
      throw new Error(`Failed to fetch organization: ${orgError.message}`)
    }

    const { data: vault, error: vaultError } = await supabase
      .from('vaults')
      .select('id, name')
      .eq('id', vaultId)
      .single()

    if (vaultError) {
      throw new Error(`Failed to fetch vault: ${vaultError.message}`)
    }

    const { data: files, error: filesError } = await supabase
      .from('files')
      .select(
        'id, file_path, file_name, extension, file_type, content_hash, file_size, state, checked_out_by, checked_out_at, version, created_at, updated_at, deleted_at',
      )
      .eq('org_id', orgId)
      .eq('vault_id', vaultId)
      .is('deleted_at', null)

    if (filesError) throw new Error(`Failed to fetch files: ${filesError.message}`)

    const fileIds = (files || []).map((f) => f.id)

    // Batch the file_versions query to avoid exceeding PostgREST URL length limits.
    // With 24K+ UUIDs, a single .in() would produce an ~874KB query string (limit ~8KB).
    const BATCH_SIZE = 300
    let fileVersions: any[] = []
    if (fileIds.length > 0) {
      let batchErrors = 0
      for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
        const batch = fileIds.slice(i, i + BATCH_SIZE)
        const { data: versions, error: versionsError } = await supabase
          .from('file_versions')
          .select(
            'id, file_id, version, revision, content_hash, file_size, state, created_by, created_at',
          )
          .in('file_id', batch)

        if (versionsError) {
          batchErrors++
          log.error('[Backup]', `file_versions batch ${Math.floor(i / BATCH_SIZE) + 1} failed`, {
            error: versionsError.message,
            batchSize: batch.length,
          })
        } else if (versions) {
          fileVersions = fileVersions.concat(versions)
        }
      }
      if (batchErrors > 0) {
        log.warn(
          '[Backup]',
          `${batchErrors} version batches failed out of ${Math.ceil(fileIds.length / BATCH_SIZE)}`,
        )
      }
      log.info('[Backup]', 'File versions fetched', {
        total: fileVersions.length,
        batches: Math.ceil(fileIds.length / BATCH_SIZE),
      })
    }

    // Note: file_comments table may not exist in all deployments
    let fileComments: any[] = []

    const { data: users } = await supabase
      .from('users')
      .select('id, email, full_name, role')
      .eq('org_id', orgId)

    const exportData: DatabaseExport = {
      _type: 'blueplm_database_export',
      _version: 3,
      _exportedAt: new Date().toISOString(),
      _orgId: orgId,
      _orgName: org.name,
      _vaultId: vaultId,
      _vaultName: vault.name,
      files: files || [],
      fileVersions,
      fileComments,
      users: users || [],
    }

    return { success: true, data: exportData }
  } catch (error) {
    log.error('[Backup]', 'Failed to export database metadata', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function importDatabaseMetadata(
  exportData: DatabaseExport,
  options: { overwriteExisting?: boolean; restoreDeleted?: boolean } = {},
): Promise<{
  success: boolean
  stats?: { filesRestored: number; versionsRestored: number; skipped: number }
  error?: string
}> {
  const supabase = getSupabaseClient()
  const { overwriteExisting = false, restoreDeleted = true } = options

  try {
    if (exportData._type !== 'blueplm_database_export') {
      throw new Error('Invalid database export file')
    }

    let filesRestored = 0
    let versionsRestored = 0
    let skipped = 0

    for (const file of exportData.files) {
      if (file.deleted_at && !restoreDeleted) {
        skipped++
        continue
      }

      const { data: existing } = await supabase
        .from('files')
        .select('id')
        .eq('id', file.id)
        .single()

      if (existing && !overwriteExisting) {
        skipped++
        continue
      }

      // Validate file_type is a valid enum value
      const validFileTypes = ['part', 'assembly', 'drawing', 'pdf', 'step', 'other'] as const
      const fileType = validFileTypes.includes(file.file_type as (typeof validFileTypes)[number])
        ? file.file_type
        : 'other'

      // Use any to bypass type restrictions during restore
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('files') as any).upsert( // TODO: type this
        {
          id: file.id,
          org_id: exportData._orgId,
          vault_id: exportData._vaultId,
          file_path: file.file_path,
          file_name: file.file_name,
          extension: file.extension || '',
          file_type: fileType,
          content_hash: file.content_hash,
          file_size: file.file_size,
          state: file.state,
          checked_out_by: file.checked_out_by,
          checked_out_at: file.checked_out_at,
          version: file.version,
          created_at: file.created_at,
          updated_at: file.updated_at,
          deleted_at: restoreDeleted ? null : file.deleted_at,
        },
        { onConflict: 'id' },
      )

      if (!error) filesRestored++
      else skipped++
    }

    for (const version of exportData.fileVersions) {
      const { data: existing } = await supabase
        .from('file_versions')
        .select('id')
        .eq('id', version.id)
        .single()

      if (existing && !overwriteExisting) continue

      const { error } = await supabase.from('file_versions').upsert(
        {
          id: version.id,
          file_id: version.file_id,
          version: version.version,
          revision: version.revision || '',
          content_hash: version.content_hash || '',
          file_size: version.file_size,
          state: version.state || 'work_in_progress',
          created_at: version.created_at,
          created_by: version.created_by || exportData._orgId, // Fallback if missing
        },
        { onConflict: 'id' },
      )

      if (!error) versionsRestored++
    }

    for (const rawComment of exportData.fileComments) {
      const comment = rawComment as {
        id: string
        file_id: string
        user_id: string
        comment: string
        created_at: string
      }
      const { data: existing } = await supabase
        .from('file_comments')
        .select('id')
        .eq('id', comment.id)
        .single()

      if (existing && !overwriteExisting) continue

      await supabase.from('file_comments').upsert(
        {
          id: comment.id,
          file_id: comment.file_id,
          user_id: comment.user_id,
          comment: comment.comment,
          created_at: comment.created_at,
        },
        { onConflict: 'id' },
      )
    }

    log.info('[Backup]', 'Metadata import complete', { filesRestored, versionsRestored, skipped })
    return { success: true, stats: { filesRestored, versionsRestored, skipped } }
  } catch (error) {
    log.error('[Backup]', 'Failed to import database metadata', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
