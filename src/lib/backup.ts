// Backup service - simplified to use restic directly for everything
import { getSupabaseClient } from './supabase'

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
  id: string           // Short ID (first 8 chars)
  short_id: string     // Same as id
  time: string         // ISO timestamp
  hostname: string     // Machine that created backup
  paths: string[]      // Backed up paths
  tags: string[]       // Tags (e.g., 'bluepdm')
  // Parsed from restic
  tree?: string
  parent?: string
}

export interface BackupStatus {
  isConfigured: boolean
  config: BackupConfig | null
  snapshots: BackupSnapshot[]   // Live from restic
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
  
  let machineId = localStorage.getItem('bluepdm_machine_id')
  if (!machineId) {
    machineId = `machine_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
    localStorage.setItem('bluepdm_machine_id', machineId)
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
    console.error('[Backup] Error fetching config:', error)
    return null
  }
  
  return data as BackupConfig | null
}

export async function saveBackupConfig(
  orgId: string,
  config: Partial<BackupConfig>,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient()
  
  const updateData = {
    ...config,
    org_id: orgId,
    updated_at: new Date().toISOString()
  }
  
  const { error } = await supabase
    .from('backup_config')
    .upsert(updateData, { onConflict: 'org_id' })
  
  if (error) {
    console.error('[Backup] Error saving config:', error)
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
  userEmail: string
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
      updated_at: new Date().toISOString()
    })
    .eq('org_id', orgId)
  
  if (error) {
    console.error('[Backup] Error designating machine:', error)
    return { success: false, error: error.message }
  }
  
  console.log('[Backup] This machine designated as backup source:', machineName)
  return { success: true }
}

// Clear designated machine
export async function clearDesignatedMachine(
  orgId: string
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
      updated_at: new Date().toISOString()
    })
    .eq('org_id', orgId)
  
  if (error) {
    console.error('[Backup] Error clearing designated machine:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

// Update heartbeat (called every minute by designated machine)
export async function updateHeartbeat(orgId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const machineId = await getMachineId()
  
  const { data, error } = await supabase
    .rpc('update_backup_heartbeat', {
      p_org_id: orgId,
      p_machine_id: machineId
    })
  
  if (error) {
    console.error('[Backup] Heartbeat error:', error)
    return false
  }
  
  return data === true
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
  userEmail: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient()
  
  const { data, error } = await supabase
    .rpc('request_backup', {
      p_org_id: orgId,
      p_requested_by: userEmail
    })
  
  if (error) {
    console.error('[Backup] Error requesting backup:', error)
    return { success: false, error: error.message }
  }
  
  if (!data) {
    return { success: false, error: 'No designated machine configured' }
  }
  
  console.log('[Backup] Backup requested by:', userEmail)
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
  
  const { data, error } = await supabase
    .rpc('start_backup', {
      p_org_id: orgId,
      p_machine_id: machineId
    })
  
  if (error) {
    console.error('[Backup] Error marking backup started:', error)
    return false
  }
  
  return data === true
}

// Mark backup as complete (called by designated machine)
export async function markBackupComplete(orgId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const machineId = await getMachineId()
  
  const { data, error } = await supabase
    .rpc('complete_backup', {
      p_org_id: orgId,
      p_machine_id: machineId
    })
  
  if (error) {
    console.error('[Backup] Error marking backup complete:', error)
    return false
  }
  
  return data === true
}

// ============================================
// Heartbeat & Request Polling Service
// ============================================

let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let pollingInterval: ReturnType<typeof setInterval> | null = null
let lastScheduledBackupDate: string | null = null

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
      hour12: false
    })
    const parts = formatter.formatToParts(now)
    currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
    currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    
    // Get today's date in the configured timezone
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.schedule_timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
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
  vaultId: string,
  onBackupRequest: (config: BackupConfig) => void,
  getLatestConfig: () => Promise<BackupConfig | null>
): void {
  stopBackupService()
  
  console.log('[Backup] Starting backup service...')
  
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
        console.log('[Backup] No longer designated machine, stopping service')
        stopBackupService()
        return
      }
      
      // Skip if already running
      if (config.backup_running_since) return
      
      // Check for pending backup request
      if (hasPendingBackupRequest(config)) {
        console.log('[Backup] Backup request detected, triggering backup...')
        onBackupRequest(config)
        return
      }
      
      // Check for scheduled backup
      if (shouldRunScheduledBackup(config)) {
        console.log('[Backup] Scheduled backup time reached, triggering backup...')
        onBackupRequest(config)
      }
    } catch (err) {
      console.error('[Backup] Polling error:', err)
    }
  }, 30 * 1000)
  
  console.log('[Backup] Backup service started')
}

// Stop the service
export function stopBackupService(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
  console.log('[Backup] Backup service stopped')
}

// ============================================
// Restic Operations - All backup data lives here!
// ============================================

// List snapshots directly from restic
export async function listSnapshots(config: BackupConfig): Promise<BackupSnapshot[]> {
  if (!window.electronAPI?.listBackupSnapshots) {
    console.error('[Backup] listBackupSnapshots not available')
    return []
  }
  
  if (!config.bucket || !config.access_key_encrypted || !config.secret_key_encrypted || !config.restic_password_encrypted) {
    console.error('[Backup] Config incomplete for listing snapshots')
    return []
  }
  
  try {
    const result = await window.electronAPI.listBackupSnapshots({
      provider: config.provider,
      bucket: config.bucket,
      region: config.region || undefined,
      endpoint: config.endpoint || undefined,
      accessKey: config.access_key_encrypted,
      secretKey: config.secret_key_encrypted,
      resticPassword: config.restic_password_encrypted
    })
    
    return result.snapshots || []
  } catch (err) {
    console.error('[Backup] Failed to list snapshots:', err)
    return []
  }
}

// Delete a snapshot from restic
export async function deleteSnapshot(
  config: BackupConfig,
  snapshotId: string
): Promise<{ success: boolean; error?: string }> {
  if (!window.electronAPI?.deleteBackupSnapshot) {
    return { success: false, error: 'Delete not available: Electron API not found' }
  }
  
  if (!config.bucket || !config.access_key_encrypted || !config.secret_key_encrypted || !config.restic_password_encrypted) {
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
      snapshotId
    })
    
    return { success: result.success, error: result.error }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Run a backup
export async function runBackup(
  config: BackupConfig,
  options?: {
    vaultId?: string  // For database metadata export
    vaultName?: string  // For tagging the snapshot
    vaultPath?: string  // Override working directory
    metadataJson?: string  // Pre-exported metadata
  }
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
      window.electronAPI?.log('info', '[Backup] Exporting database metadata...', { orgId: config.org_id, vaultId: options.vaultId })
      const metadataExport = await exportDatabaseMetadata(config.org_id, options.vaultId)
      if (metadataExport.success && metadataExport.data) {
        metadataJson = JSON.stringify(metadataExport.data, null, 2)
        window.electronAPI?.log('info', '[Backup] Database metadata exported successfully', { 
          files: metadataExport.data.files?.length,
          versions: metadataExport.data.fileVersions?.length 
        })
      } else {
        window.electronAPI?.log('error', '[Backup] Failed to export metadata', { error: metadataExport.error })
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
      vaultPath: options?.vaultPath
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
          durationSeconds
        }
      }
    } else {
      throw new Error(result.error || 'Backup failed')
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Restore files from a snapshot
export async function restoreFromSnapshot(
  config: BackupConfig,
  snapshotId: string,
  targetPath: string,
  specificPaths?: string[]
): Promise<{ success: boolean; hasMetadata?: boolean; error?: string }> {
  if (!window.electronAPI?.restoreFromBackup) {
    return { success: false, error: 'Restore not available: Electron API not found' }
  }
  
  if (!config.bucket || !config.access_key_encrypted || !config.secret_key_encrypted || !config.restic_password_encrypted) {
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
      specificPaths
    })
    
    return { success: result.success, hasMetadata: result.hasMetadata, error: result.error }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Get complete backup status
export async function getBackupStatus(orgId: string): Promise<BackupStatus> {
  const config = await getBackupConfig(orgId)
  
  const isConfigured = !!(config?.bucket && config?.access_key_encrypted && config?.restic_password_encrypted)
  
  // If not configured, return empty status
  if (!isConfigured || !config) {
    return {
      isConfigured: false,
      config: null,
      snapshots: [],
      lastSnapshot: null,
      totalSnapshots: 0,
      isLoading: false,
      error: null
    }
  }
  
  // Get snapshots directly from restic
  let snapshots: BackupSnapshot[] = []
  let error: string | null = null
  
  try {
    snapshots = await listSnapshots(config)
    // Sort by time descending
    snapshots.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    console.error('[Backup] Failed to get snapshots:', err)
  }
  
  return {
    isConfigured: true,
    config,
    snapshots,
    lastSnapshot: snapshots[0] || null,
    totalSnapshots: snapshots.length,
    isLoading: false,
    error
  }
}

// ============================================
// Database Metadata Export/Import
// ============================================

export interface DatabaseExport {
  _type: 'bluepdm_database_export'
  _version: 3  // Updated to v3 for new schema
  _exportedAt: string
  _orgId: string
  _orgName: string
  _vaultId: string
  _vaultName: string
  files: Array<{
    id: string
    file_path: string
    file_name: string
    extension: string | null
    file_type: string | null
    content_hash: string | null
    file_size: number | null
    state: string | null
    checked_out_by: string | null
    checked_out_at: string | null
    version: number
    created_at: string
    updated_at: string
    deleted_at: string | null
  }>
  fileVersions: Array<{
    id: string
    file_id: string
    version: number
    revision: string | null
    content_hash: string | null
    file_size: number | null
    state: string | null
    created_by: string | null
    created_at: string
  }>
  fileComments: Array<any>  // May not exist in all deployments
  users: Array<{
    id: string
    email: string
    full_name: string | null
    role: string
  }>
}

export async function exportDatabaseMetadata(
  orgId: string,
  vaultId: string
): Promise<{ success: boolean; data?: DatabaseExport; error?: string }> {
  const supabase = getSupabaseClient()
  
  window.electronAPI?.log('info', '[Backup] exportDatabaseMetadata called', { orgId, vaultId })
  
  try {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', orgId)
      .single()
    
    if (orgError) {
      window.electronAPI?.log('error', '[Backup] Failed to fetch organization', { error: orgError.message })
      throw new Error(`Failed to fetch organization: ${orgError.message}`)
    }
    window.electronAPI?.log('info', '[Backup] Found organization', { name: org?.name })
    
    const { data: vault, error: vaultError } = await supabase
      .from('vaults')
      .select('id, name')
      .eq('id', vaultId)
      .single()
    
    if (vaultError) {
      window.electronAPI?.log('error', '[Backup] Failed to fetch vault', { error: vaultError.message, vaultId })
      throw new Error(`Failed to fetch vault: ${vaultError.message}`)
    }
    window.electronAPI?.log('info', '[Backup] Found vault', { name: vault?.name })
    
    const { data: files, error: filesError } = await supabase
      .from('files')
      .select('id, file_path, file_name, extension, file_type, content_hash, file_size, state, checked_out_by, checked_out_at, version, created_at, updated_at, deleted_at')
      .eq('org_id', orgId)
      .eq('vault_id', vaultId)
      .is('deleted_at', null)
    
    if (filesError) throw new Error(`Failed to fetch files: ${filesError.message}`)
    
    const fileIds = (files || []).map(f => f.id)
    
    let fileVersions: any[] = []
    if (fileIds.length > 0) {
      const { data: versions, error: versionsError } = await supabase
        .from('file_versions')
        .select('id, file_id, version, revision, content_hash, file_size, state, created_by, created_at')
        .in('file_id', fileIds)
      
      if (!versionsError) fileVersions = versions || []
    }
    
    // Note: file_comments table may not exist in all deployments
    let fileComments: any[] = []
    
    const { data: users } = await supabase
      .from('users')
      .select('id, email, full_name, role')
      .eq('org_id', orgId)
    
    const exportData: DatabaseExport = {
      _type: 'bluepdm_database_export',
      _version: 3,
      _exportedAt: new Date().toISOString(),
      _orgId: orgId,
      _orgName: org.name,
      _vaultId: vaultId,
      _vaultName: vault.name,
      files: files || [],
      fileVersions,
      fileComments,
      users: users || []
    }
    
    window.electronAPI?.log('info', '[Backup] Exported metadata', { 
      files: files?.length || 0, 
      versions: fileVersions.length 
    })
    return { success: true, data: exportData }
  } catch (err) {
    window.electronAPI?.log('error', '[Backup] Failed to export database metadata', { 
      error: err instanceof Error ? err.message : String(err) 
    })
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function importDatabaseMetadata(
  exportData: DatabaseExport,
  options: { overwriteExisting?: boolean; restoreDeleted?: boolean } = {}
): Promise<{ success: boolean; stats?: { filesRestored: number; versionsRestored: number; skipped: number }; error?: string }> {
  const supabase = getSupabaseClient()
  const { overwriteExisting = false, restoreDeleted = true } = options
  
  try {
    if (exportData._type !== 'bluepdm_database_export') {
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
      
      const { error } = await supabase
        .from('files')
        .upsert({
          id: file.id,
          org_id: exportData._orgId,
          vault_id: exportData._vaultId,
          path: file.path,
          checksum: file.checksum,
          size: file.size,
          is_folder: file.is_folder,
          locked_by: file.locked_by,
          locked_at: file.locked_at,
          current_version: file.current_version,
          created_at: file.created_at,
          updated_at: file.updated_at,
          created_by: file.created_by,
          updated_by: file.updated_by,
          deleted_at: restoreDeleted ? null : file.deleted_at,
          deleted_by: restoreDeleted ? null : file.deleted_by
        }, { onConflict: 'id' })
      
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
      
      const { error } = await supabase
        .from('file_versions')
        .upsert({
          id: version.id,
          file_id: version.file_id,
          version_number: version.version_number,
          checksum: version.checksum,
          size: version.size,
          storage_path: version.storage_path,
          created_at: version.created_at,
          created_by: version.created_by,
          comment: version.comment
        }, { onConflict: 'id' })
      
      if (!error) versionsRestored++
    }
    
    for (const comment of exportData.fileComments) {
      const { data: existing } = await supabase
        .from('file_comments')
        .select('id')
        .eq('id', comment.id)
        .single()
      
      if (existing && !overwriteExisting) continue
      
      await supabase
        .from('file_comments')
        .upsert({
          id: comment.id,
          file_id: comment.file_id,
          user_id: comment.user_id,
          comment: comment.comment,
          created_at: comment.created_at
        }, { onConflict: 'id' })
    }
    
    console.log(`[Backup] Metadata import complete: ${filesRestored} files, ${versionsRestored} versions, ${skipped} skipped`)
    return { success: true, stats: { filesRestored, versionsRestored, skipped } }
  } catch (err) {
    console.error('[Backup] Failed to import database metadata:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
