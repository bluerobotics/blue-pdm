import { useState, useEffect } from 'react'
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Calendar,
  RefreshCw,
  Settings,
  Loader2,
  Eye,
  EyeOff,
  Info,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Play,
  RotateCcw,
  Key,
  Download,
  Upload,
  Trash2,
  Monitor,
  Server,
  Folder
} from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import {
  getBackupStatus,
  getBackupConfig,
  saveBackupConfig,
  deleteSnapshot,
  runBackup,
  restoreFromSnapshot,
  getMachineId,
  getMachineName,
  getPlatform,
  designateThisMachine,
  clearDesignatedMachine,
  isDesignatedMachineOnline,
  isThisDesignatedMachine,
  requestBackup,
  markBackupStarted,
  markBackupComplete,
  startBackupService,
  stopBackupService,
  type BackupStatus,
  type BackupConfig
} from '../lib/backup'

// Format date for display
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Calculate next scheduled backup time in the given timezone
function getNextScheduledBackup(hour: number, minute: number, timezone?: string): Date {
  const now = new Date()
  const tz = timezone || 'UTC'
  
  // Guard against undefined/null values
  const safeHour = hour ?? 0
  const safeMinute = minute ?? 0
  
  // Get current date/time in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  try {
    const parts = formatter.formatToParts(now)
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    const currentYear = parseInt(parts.find(p => p.type === 'year')?.value || '2024')
    const currentMonth = parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1
    const currentDay = parseInt(parts.find(p => p.type === 'day')?.value || '1')
    
    // Create date for scheduled time today in the target timezone
    // We'll approximate by creating a local date and adjusting
    let nextDate = new Date(currentYear, currentMonth, currentDay, safeHour, safeMinute, 0, 0)
    
    // If the scheduled time has passed for today, add a day
    const currentMinutes = currentHour * 60 + currentMinute
    const scheduledMinutes = safeHour * 60 + safeMinute
    if (scheduledMinutes <= currentMinutes) {
      nextDate.setDate(nextDate.getDate() + 1)
    }
    
    return nextDate
  } catch {
    // Fallback to UTC
    const next = new Date(now)
    next.setUTCHours(safeHour, safeMinute, 0, 0)
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    return next
  }
}

// Format time until next backup
function formatTimeUntil(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  
  if (diffMins < 60) return `in ${diffMins}m`
  if (diffHours < 24) {
    const mins = diffMins % 60
    return `in ${diffHours}h ${mins}m`
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' tomorrow'
}

interface BackupPanelProps {
  isAdmin: boolean
}

export function BackupPanel({ isAdmin }: BackupPanelProps) {
  const { organization, user, addToast, activeVaultId, connectedVaults, vaultPath } = usePDMStore()
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  // Main state
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  // Current machine info
  const [_currentMachineId, setCurrentMachineId] = useState<string>('')
  const [_machineName, setMachineName] = useState<string>('This Machine')
  const [_machinePlatform, setMachinePlatform] = useState<string>('')
  const [isThisDesignated, setIsThisDesignated] = useState(false)
  const [isDesignatedOnline, setIsDesignatedOnline] = useState(false)
  
  // Backup/restore state
  const [isRunningBackup, setIsRunningBackup] = useState(false)
  const [backupProgress, setBackupProgress] = useState<{ phase: string; percent: number; message: string } | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null)
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; time: string } | null>(null)
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([])
  const [historyVaultFilter, setHistoryVaultFilter] = useState<string>('all')
  
  // Config form state
  const [provider, setProvider] = useState<'backblaze_b2' | 'aws_s3' | 'google_cloud'>('backblaze_b2')
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [resticPassword, setResticPassword] = useState('')
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [showResticPassword, setShowResticPassword] = useState(false)
  const [retentionDaily, setRetentionDaily] = useState(14)
  const [retentionWeekly, setRetentionWeekly] = useState(10)
  const [retentionMonthly, setRetentionMonthly] = useState(12)
  const [retentionYearly, setRetentionYearly] = useState(5)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleHour, setScheduleHour] = useState(0)
  const [scheduleMinute, setScheduleMinute] = useState(0)
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC')
  
  // Calculate total retention points
  const totalRetentionPoints = retentionDaily + retentionWeekly + retentionMonthly + retentionYearly
  
  // Load backup status
  const loadStatus = async () => {
    if (!organization?.id) return
    
    try {
      const newStatus = await getBackupStatus(organization.id)
      setStatus(newStatus)
      
      // Populate form with existing config
      if (newStatus.config) {
        setProvider(newStatus.config.provider)
        setBucket(newStatus.config.bucket || '')
        setRegion(newStatus.config.region || '')
        setEndpoint(newStatus.config.endpoint || '')
        setAccessKey(newStatus.config.access_key_encrypted || '')
        setSecretKey(newStatus.config.secret_key_encrypted || '')
        setResticPassword(newStatus.config.restic_password_encrypted || '')
        setRetentionDaily(newStatus.config.retention_daily ?? 14)
        setRetentionWeekly(newStatus.config.retention_weekly ?? 10)
        setRetentionMonthly(newStatus.config.retention_monthly ?? 12)
        setRetentionYearly(newStatus.config.retention_yearly ?? 5)
        setScheduleEnabled(newStatus.config.schedule_enabled ?? false)
        setScheduleHour(newStatus.config.schedule_hour ?? 0)
        setScheduleMinute(newStatus.config.schedule_minute ?? 0)
        setScheduleTimezone(newStatus.config.schedule_timezone || 'UTC')
      }
    } catch (err) {
      console.error('Failed to load backup status:', err)
    }
  }
  
  useEffect(() => {
    setIsLoading(true)
    loadStatus().finally(() => setIsLoading(false))
    
    // Load current machine info
    getMachineId().then(setCurrentMachineId)
    getMachineName().then(setMachineName)
    getPlatform().then(setMachinePlatform)
  }, [organization?.id])
  
  // Check designated machine status when config changes
  useEffect(() => {
    if (status?.config) {
      isThisDesignatedMachine(status.config).then(setIsThisDesignated)
      setIsDesignatedOnline(isDesignatedMachineOnline(status.config))
    }
  }, [status?.config])
  
  // Initialize selected vaults when connected vaults change
  useEffect(() => {
    if (connectedVaults.length > 0 && selectedVaultIds.length === 0) {
      // Select all vaults by default
      setSelectedVaultIds(connectedVaults.map(v => v.id))
    }
  }, [connectedVaults])
  
  // Start backup service if this is the designated machine
  useEffect(() => {
    if (!isThisDesignated || !organization?.id || !currentVaultId) return
    
    console.log('[BackupPanel] This is the designated machine, starting backup service...')
    
    startBackupService(
      organization.id,
      currentVaultId,
      async (config) => {
        // Backup request received - run the backup
        await handleRunBackupInternal(config)
      },
      async () => {
        // Fetch fresh config from database each time
        // (don't use status?.config - it's a stale closure capture!)
        return await getBackupConfig(organization.id)
      }
    )
    
    return () => {
      stopBackupService()
    }
  }, [isThisDesignated, organization?.id, currentVaultId])
  
  // Refresh status periodically to see updated heartbeats
  useEffect(() => {
    const interval = setInterval(() => {
      if (organization?.id) {
        loadStatus()
      }
    }, 15000) // Every 15 seconds
    
    return () => clearInterval(interval)
  }, [organization?.id])
  
  // Refresh snapshots from restic
  const handleRefresh = async () => {
    if (!organization?.id) return
    setIsRefreshing(true)
    try {
      await loadStatus()
      addToast('success', 'Backup status refreshed')
    } catch (err) {
      addToast('error', 'Failed to refresh backup status')
    } finally {
      setIsRefreshing(false)
    }
  }
  
  // Save configuration
  const handleSaveConfig = async () => {
    if (!organization?.id || !user?.id) return
    
    if (!bucket || !accessKey || !secretKey || !resticPassword) {
      addToast('error', 'Please fill in all required fields')
      return
    }
    
    setIsSaving(true)
    try {
      const result = await saveBackupConfig(organization.id, {
        provider,
        bucket,
        region: region || null,
        endpoint: endpoint || null,
        access_key_encrypted: accessKey,
        secret_key_encrypted: secretKey,
        restic_password_encrypted: resticPassword,
        retention_daily: retentionDaily,
        retention_weekly: retentionWeekly,
        retention_monthly: retentionMonthly,
        retention_yearly: retentionYearly,
        schedule_enabled: scheduleEnabled,
        schedule_hour: scheduleHour,
        schedule_minute: scheduleMinute,
        schedule_timezone: scheduleTimezone
      }, user.id)
      
      if (result.success) {
        addToast('success', 'Backup configuration saved')
        await loadStatus()
      } else {
        addToast('error', result.error || 'Failed to save configuration')
      }
    } catch (err) {
      addToast('error', 'Failed to save configuration')
    } finally {
      setIsSaving(false)
    }
  }
  
  // Run backup now
  // Internal function to actually run the backup (used by designated machine)
  const handleRunBackupInternal = async (config: BackupConfig) => {
    const vaultsToBackup = connectedVaults.filter(v => selectedVaultIds.includes(v.id))
    
    // Debug logging
    window.electronAPI?.log('info', '[Backup] handleRunBackupInternal called', {
      configOrgId: config.org_id,
      vaultsToBackup: vaultsToBackup.map(v => ({ id: v.id, name: v.name })),
      selectedVaultIds
    })
    
    if (vaultsToBackup.length === 0) {
      addToast('error', 'No vaults selected for backup')
      return
    }
    
    setIsRunningBackup(true)
    setBackupProgress({ phase: 'Starting', percent: 0, message: 'Initializing backup...' })
    
    // Mark backup as started in database
    await markBackupStarted(organization?.id || '')
    
    const cleanupProgress = window.electronAPI?.onBackupProgress?.((progress) => {
      setBackupProgress(progress)
    })
    
    let successCount = 0
    let failCount = 0
    
    try {
      for (let i = 0; i < vaultsToBackup.length; i++) {
        const vault = vaultsToBackup[i]
        setBackupProgress({ 
          phase: `Vault ${i + 1}/${vaultsToBackup.length}`, 
          percent: Math.round((i / vaultsToBackup.length) * 100), 
          message: `Backing up ${vault.name}...` 
        })
        
        try {
          window.electronAPI?.log('info', '[Backup] Running backup for vault', {
            vaultId: vault.id,
            vaultName: vault.name,
            vaultPath: vault.localPath,
            configOrgId: config.org_id
          })
          const result = await runBackup(config, { 
            vaultId: vault.id,
            vaultName: vault.name,
            vaultPath: vault.localPath
          })
          
          if (result.success) {
            successCount++
            addToast('success', `Backed up ${vault.name}: ${result.snapshotId?.substring(0, 8)}`)
          } else {
            failCount++
            addToast('error', `Failed to backup ${vault.name}: ${result.error}`)
          }
        } catch (err) {
          failCount++
          console.error(`Backup failed for ${vault.name}:`, err)
          addToast('error', `Failed to backup ${vault.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } finally {
      cleanupProgress?.()
      // Mark backup as complete
      await markBackupComplete(organization?.id || '')
      setIsRunningBackup(false)
      setBackupProgress(null)
      await loadStatus()
      
      if (vaultsToBackup.length > 1) {
        addToast('info', `Backup complete: ${successCount} succeeded, ${failCount} failed`)
      }
    }
  }
  
  // Handle backup button click - either run locally or request remotely
  const handleRunBackup = async () => {
    if (!status?.config || !organization?.id) {
      addToast('error', 'Backup not configured')
      return
    }
    
    // Check if there's a designated machine
    if (!status.config.designated_machine_id) {
      addToast('error', 'No backup machine designated. Set this machine as backup source first.')
      return
    }
    
    // If this is the designated machine, run locally
    if (isThisDesignated) {
      if (!currentVaultId) {
        addToast('error', 'No vault connected')
        return
      }
      await handleRunBackupInternal(status.config)
      return
    }
    
    // Otherwise, request backup from designated machine
    if (!isDesignatedOnline) {
      addToast('error', 'Backup machine is offline. Cannot trigger backup.')
      return
    }
    
    try {
      const result = await requestBackup(organization.id, user?.email || '')
      if (result.success) {
        addToast('success', 'Backup requested! The designated machine will start the backup shortly.')
        await loadStatus()
      } else {
        addToast('error', result.error || 'Failed to request backup')
      }
    } catch (err) {
      addToast('error', 'Failed to request backup')
    }
  }
  
  // Designate this machine as backup source
  const handleDesignateThisMachine = async () => {
    if (!organization?.id || !user?.email) return
    
    const result = await designateThisMachine(organization.id, user.email)
    if (result.success) {
      addToast('success', 'This machine is now the backup source')
      await loadStatus()
    } else {
      addToast('error', result.error || 'Failed to designate machine')
    }
  }
  
  // Clear designated machine
  const handleClearDesignatedMachine = async () => {
    if (!organization?.id) return
    
    const result = await clearDesignatedMachine(organization.id)
    if (result.success) {
      addToast('success', 'Backup source cleared')
      await loadStatus()
    } else {
      addToast('error', result.error || 'Failed to clear designation')
    }
  }
  
  // Delete a snapshot
  const handleDeleteSnapshot = async () => {
    if (!deleteConfirmTarget || !status?.config) return
    
    const { id: snapshotId } = deleteConfirmTarget
    setDeleteConfirmTarget(null)
    setDeletingSnapshotId(snapshotId)
    
    try {
      const result = await deleteSnapshot(status.config, snapshotId)
      
      if (result.success) {
        addToast('success', 'Snapshot deleted')
        await loadStatus()
      } else {
        addToast('error', result.error || 'Failed to delete snapshot')
      }
    } catch (err) {
      console.error('Delete failed:', err)
      addToast('error', 'Failed to delete snapshot')
    } finally {
      setDeletingSnapshotId(null)
    }
  }
  
  // Restore from snapshot
  const handleRestore = async () => {
    if (!selectedSnapshot || !status?.config || !vaultPath) {
      addToast('error', 'No snapshot selected or vault not connected')
      return
    }
    
    setIsRestoring(true)
    try {
      addToast('info', `Restoring snapshot ${selectedSnapshot.substring(0, 8)}...`, 0)
      const result = await restoreFromSnapshot(status.config, selectedSnapshot, vaultPath)
      
      if (result.success) {
        addToast('success', 'Files restored successfully!')
        
        if (result.hasMetadata) {
          addToast('info', 'Database metadata found, importing...', 5000)
          // Note: Would need to read and parse the metadata file
          // For now, just notify the user
          addToast('success', 'Restore complete! Metadata can be imported from .blueplm/database-export.json')
        }
        
        setSelectedSnapshot(null)
      } else {
        addToast('error', result.error || 'Restore failed')
      }
    } catch (err) {
      console.error('Restore failed:', err)
      addToast('error', 'Restore failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsRestoring(false)
    }
  }
  
  // Export config
  const handleExportConfig = () => {
    const exportData = {
      _type: 'blueplm_backup_config',
      _version: 1,
      _exportedAt: new Date().toISOString(),
      _warning: 'This file contains sensitive credentials. Store securely!',
      provider,
      bucket,
      region,
      endpoint,
      accessKey,
      secretKey,
      resticPassword,
      retentionDaily,
      retentionWeekly,
      retentionMonthly,
      retentionYearly
    }
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `blueplm-backup-config-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    
    addToast('success', 'Configuration exported. Keep this file safe - it\'s your disaster recovery key!')
  }
  
  // Import config
  const handleImportConfig = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        
        if (data._type !== 'blueplm_backup_config') {
          addToast('error', 'Invalid backup configuration file')
          return
        }
        
        setProvider(data.provider || 'backblaze_b2')
        setBucket(data.bucket || '')
        setRegion(data.region || '')
        setEndpoint(data.endpoint || '')
        setAccessKey(data.accessKey || '')
        setSecretKey(data.secretKey || '')
        setResticPassword(data.resticPassword || '')
        setRetentionDaily(data.retentionDaily ?? 14)
        setRetentionWeekly(data.retentionWeekly ?? 10)
        setRetentionMonthly(data.retentionMonthly ?? 10)
        setRetentionYearly(data.retentionYearly ?? 5)
        
        addToast('success', 'Configuration imported! Click Save to apply.')
      } catch (err) {
        addToast('error', 'Failed to parse configuration file')
      }
    }
    input.click()
  }
  
  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-plm-fg-muted" />
      </div>
    )
  }
  
  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-plm-accent" />
          <h3 className="font-semibold">Backup & Restore</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded hover:bg-plm-bg-secondary text-plm-fg-muted hover:text-plm-fg transition-colors"
          title="Refresh from backup server"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      {/* Status Overview */}
      <div className="space-y-4">
        {/* Configuration Status */}
        <div className={`p-4 rounded-lg border ${
          status?.isConfigured 
            ? 'bg-emerald-500/10 border-emerald-500/30' 
            : 'bg-amber-500/10 border-amber-500/30'
        }`}>
          <div className="flex items-center gap-3">
            {status?.isConfigured ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            )}
            <div className="flex-1">
              <div className="font-medium">
                {status?.isConfigured ? 'Backup Configured' : 'Backup Not Configured'}
              </div>
              <div className="text-sm text-plm-fg-muted">
                {status?.isConfigured 
                  ? `${status.totalSnapshots} snapshot${status.totalSnapshots !== 1 ? 's' : ''} available`
                  : 'Configure backup settings below to enable backups'
                }
              </div>
            </div>
          </div>
        </div>
        
        {/* Backup Schedule Info */}
        {status?.isConfigured && (
          <div className="flex gap-3">
            {/* Last Backup */}
            <div className="flex-1 p-3 rounded-lg bg-plm-bg-secondary border border-plm-border">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-plm-fg-muted" />
                <span className="text-xs text-plm-fg-muted">Last Backup</span>
              </div>
              {status.lastSnapshot ? (
                <>
                  <div className="text-sm font-medium">{formatRelativeTime(status.lastSnapshot.time)}</div>
                  <div className="text-xs text-plm-fg-muted">{status.lastSnapshot.hostname}</div>
                </>
              ) : (
                <div className="text-sm text-plm-fg-muted">None yet</div>
              )}
            </div>
            
            {/* Next Scheduled */}
            <div className="flex-1 p-3 rounded-lg bg-plm-bg-secondary border border-plm-border">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-plm-fg-muted" />
                <span className="text-xs text-plm-fg-muted">Next Backup</span>
              </div>
              {status.config?.schedule_enabled && status.config?.designated_machine_id && 
               status.config.schedule_hour != null && status.config.schedule_minute != null ? (
                <>
                  <div className="text-sm font-medium">
                    {formatTimeUntil(getNextScheduledBackup(
                      status.config.schedule_hour,
                      status.config.schedule_minute,
                      status.config.schedule_timezone
                    ))}
                  </div>
                  <div className="text-xs text-plm-fg-muted">
                    {String(status.config.schedule_hour).padStart(2, '0')}:{String(status.config.schedule_minute).padStart(2, '0')} {status.config.schedule_timezone?.replace(/_/g, ' ').split('/').pop() || 'UTC'}
                  </div>
                </>
              ) : (
                <div className="text-sm text-plm-fg-muted">
                  {!status.config?.designated_machine_id ? 'No machine set' : 'Not scheduled'}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Backup Source - Visible to ALL users */}
        {status?.isConfigured && (
          <div className="p-4 rounded-lg bg-plm-bg-secondary border border-plm-border space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4 text-plm-fg-muted" />
                Backup Source
              </h4>
              {status.config?.designated_machine_id ? (
                (isThisDesignated || isDesignatedOnline) ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Online
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-plm-fg-muted">
                    <span className="w-2 h-2 rounded-full bg-plm-fg-muted" />
                    Offline
                  </span>
                )
              ) : (
                <span className="text-xs text-amber-400">Not set</span>
              )}
            </div>
            
            {status.config?.designated_machine_id ? (
              // Show designated machine info
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Monitor className="w-8 h-8 text-plm-fg-muted" />
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      {status.config.designated_machine_name || 'Unknown'}
                      {isThisDesignated && (
                        <span className="text-xs px-1.5 py-0.5 bg-plm-accent/20 text-plm-accent rounded">
                          This machine
                        </span>
                      )}
                    </div>
                  <div className="text-xs text-plm-fg-muted">
                    {status.config.designated_machine_platform} • {status.config.designated_machine_user_email}
                  </div>
                  {!isThisDesignated && status.config.designated_machine_last_seen && (
                    <div className="text-xs text-plm-fg-muted">
                      Last seen: {formatRelativeTime(status.config.designated_machine_last_seen)}
                    </div>
                  )}
                  </div>
                </div>
                
                {/* Vaults to backup */}
                {isThisDesignated && (
                  <div className="p-2 rounded bg-plm-bg-tertiary space-y-2">
                    <div className="text-xs text-plm-fg-muted flex items-center gap-2">
                      <Folder className="w-4 h-4" />
                      Vaults to backup
                    </div>
                    {connectedVaults.length > 0 ? (
                      <div className="space-y-1">
                        {connectedVaults.map(vault => (
                          <label key={vault.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-plm-bg-secondary cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedVaultIds.includes(vault.id)}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedVaultIds(prev => [...prev, vault.id])
                                } else {
                                  setSelectedVaultIds(prev => prev.filter(id => id !== vault.id))
                                }
                              }}
                              className="w-4 h-4 rounded border-plm-border bg-plm-bg-primary"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{vault.name}</div>
                              <div className="text-xs text-plm-fg-muted truncate">{vault.localPath}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-amber-400">No vaults connected</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // No machine designated
              <div className="flex items-center gap-3 py-2">
                <Monitor className="w-8 h-8 text-plm-fg-muted opacity-50" />
                <div className="flex-1 text-sm text-plm-fg-muted">
                  No backup machine designated
                </div>
              </div>
            )}
            
            {/* Backup request/running status */}
            {status.config?.backup_requested_at && !status.config?.backup_running_since && (
              <div className="p-2 rounded bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
                ⏳ Backup requested by {status.config.backup_requested_by}...
              </div>
            )}
            {status.config?.backup_running_since && (
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                🔄 Backup in progress...
              </div>
            )}
            
            {/* Admin controls */}
            {isAdmin && (
              <div className="space-y-2 pt-2 border-t border-plm-border">
                {/* Designate/Clear machine button */}
                {isThisDesignated ? (
                  <button
                    onClick={handleClearDesignatedMachine}
                    className="w-full py-2 px-4 rounded text-sm bg-plm-bg-tertiary hover:bg-plm-bg-primary text-plm-fg-muted hover:text-plm-fg border border-plm-border"
                  >
                    Clear designation
                  </button>
                ) : !status.config?.designated_machine_id ? (
                  <button
                    onClick={handleDesignateThisMachine}
                    className="w-full py-2 px-4 rounded text-sm bg-plm-accent text-white hover:bg-plm-accent-hover font-medium"
                  >
                    Set this machine as backup source
                  </button>
                ) : !isDesignatedOnline ? (
                  // Another machine is designated but offline - allow taking over
                  <button
                    onClick={handleDesignateThisMachine}
                    className="w-full py-2 px-4 rounded text-sm bg-amber-600 text-white hover:bg-amber-500 font-medium flex items-center justify-center gap-2"
                  >
                    <Monitor className="w-4 h-4" />
                    Take over as backup source
                  </button>
                ) : null}
                
                {/* Backup Now button */}
                {status.config?.designated_machine_id && (() => {
                  const noVaultsSelected = isThisDesignated && selectedVaultIds.length === 0
                  const isDisabled = isRunningBackup || (!isThisDesignated && !isDesignatedOnline) || !!status.config?.backup_requested_at || noVaultsSelected
                  const getTitle = () => {
                    if (noVaultsSelected) return 'Select at least one vault to backup'
                    if (!isThisDesignated && !isDesignatedOnline) return 'Backup machine is offline'
                    return undefined
                  }
                  return (
                    <button
                      onClick={handleRunBackup}
                      disabled={isDisabled}
                      className={`w-full py-2.5 px-4 rounded font-medium flex items-center justify-center gap-2 ${
                        isDisabled
                          ? 'bg-plm-bg-tertiary text-plm-fg-muted cursor-not-allowed'
                          : 'bg-emerald-600 text-white hover:bg-emerald-500'
                      }`}
                      title={getTitle()}
                    >
                      {isRunningBackup ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {backupProgress?.message || 'Running Backup...'}
                        </>
                      ) : status.config?.backup_requested_at ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Backup Requested...
                        </>
                      ) : noVaultsSelected ? (
                        <>
                          <AlertTriangle className="w-4 h-4" />
                          No Vaults Selected
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          {isThisDesignated ? 'Sync & Backup Now' : 'Request Backup'}
                        </>
                      )}
                    </button>
                  )
                })()}
              </div>
            )}
            
            {/* Backup Progress */}
            {backupProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>{backupProgress.phase}</span>
                  <span>{backupProgress.percent}%</span>
                </div>
                <div className="w-full bg-plm-bg-tertiary rounded-full h-1.5">
                  <div 
                    className="bg-emerald-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${backupProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        
      </div>
      
      {/* Snapshot History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-4 h-4 text-plm-fg-muted" />
            Backup History
            {status?.totalSnapshots ? (
              <span className="text-xs text-plm-fg-muted">({status.totalSnapshots})</span>
            ) : null}
          </h4>
          
          {/* Vault filter */}
          {status?.snapshots && status.snapshots.length > 0 && (() => {
            // Extract unique vault names from snapshot tags
            const vaultNames = new Set<string>()
            status.snapshots.forEach(s => {
              s.tags?.forEach(tag => {
                if (tag.startsWith('vault:')) {
                  vaultNames.add(tag.substring(6))
                }
              })
            })
            
            if (vaultNames.size > 0) {
              return (
                <select
                  value={historyVaultFilter}
                  onChange={e => setHistoryVaultFilter(e.target.value)}
                  className="px-2 py-1 rounded text-xs bg-plm-bg-primary border border-plm-border"
                >
                  <option value="all">All vaults</option>
                  {Array.from(vaultNames).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              )
            }
            return null
          })()}
        </div>
        
        <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
          {!status?.isConfigured ? (
            <div className="text-sm text-plm-fg-muted py-8 text-center bg-plm-bg-secondary rounded-lg border border-plm-border">
              Configure backup settings to view history
            </div>
          ) : status.error ? (
            <div className="text-sm text-red-400 py-4 text-center bg-red-500/10 rounded-lg border border-red-500/30">
              {status.error}
            </div>
          ) : status.snapshots.length === 0 ? (
            <div className="text-sm text-plm-fg-muted py-8 text-center bg-plm-bg-secondary rounded-lg border border-plm-border">
              No backups yet. Click "Sync & Backup Now" to create your first backup.
            </div>
          ) : (
            status.snapshots
              .filter(snapshot => {
                if (historyVaultFilter === 'all') return true
                return snapshot.tags?.some(tag => tag === `vault:${historyVaultFilter}`)
              })
              .map(snapshot => {
              // Check tags to determine what's included
              const hasFiles = snapshot.tags?.includes('files') || snapshot.tags?.includes('blueplm')
              const hasMetadata = snapshot.tags?.includes('has-metadata')
              const vaultTag = snapshot.tags?.find(t => t.startsWith('vault:'))
              const vaultName = vaultTag ? vaultTag.substring(6) : null
              
              // Status: success only if both files AND metadata
              const isComplete = hasFiles && hasMetadata
              const isIncomplete = hasFiles && !hasMetadata
              
              return (
                <div
                  key={snapshot.id}
                  className={`p-3 rounded border ${
                    selectedSnapshot === snapshot.id
                      ? 'bg-amber-500/10 border-amber-500/30'
                      : 'bg-plm-bg-secondary border-plm-border'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Status badge */}
                      {isComplete ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          Complete
                        </span>
                      ) : isIncomplete ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-amber-500/20 text-amber-400 border-amber-500/30" title="Files backed up but database metadata missing">
                          <AlertTriangle className="w-3 h-3" />
                          Partial
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-red-500/20 text-red-400 border-red-500/30">
                          <XCircle className="w-3 h-3" />
                          Error
                        </span>
                      )}
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2">
                          {formatDate(snapshot.time)}
                          {vaultName && (
                            <span className="text-xs px-1.5 py-0.5 bg-plm-bg-tertiary rounded text-plm-fg-muted">
                              {vaultName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-plm-fg-muted">
                          from {snapshot.hostname} • {snapshot.id}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Restore button */}
                      {isAdmin && (
                        <button
                          onClick={() => setSelectedSnapshot(selectedSnapshot === snapshot.id ? null : snapshot.id)}
                          disabled={isRestoring}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            selectedSnapshot === snapshot.id
                              ? 'bg-amber-600 text-white'
                              : 'bg-plm-bg-tertiary hover:bg-amber-600/20 text-plm-fg-muted hover:text-amber-500'
                          }`}
                          title="Restore vault to this backup"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restore
                        </button>
                      )}
                      {/* Delete button */}
                      {isAdmin && (
                        <button
                          onClick={() => setDeleteConfirmTarget({ id: snapshot.id, time: formatDate(snapshot.time) })}
                          disabled={deletingSnapshotId === snapshot.id}
                          className="p-1 rounded text-plm-fg-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete this snapshot"
                        >
                          {deletingSnapshotId === snapshot.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Files/Database check indicators */}
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-plm-border">
                    <div className="flex items-center gap-1.5">
                      {hasFiles ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-xs text-emerald-400">Files</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-plm-fg-muted" />
                          <span className="text-xs text-plm-fg-muted">Files</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {hasMetadata ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-xs text-emerald-400">Database</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs text-amber-400">No Database</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
        
        {/* Restore Action Bar */}
        {selectedSnapshot && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-amber-300">
                  <strong>Ready to restore snapshot {selectedSnapshot.substring(0, 8)}</strong>
                  <br />
                  This will overwrite current files with the backed-up versions.
                </p>
              </div>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="text-amber-400 hover:text-amber-300"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRestore}
                disabled={isRestoring}
                className="flex-1 py-2 px-4 bg-amber-600 text-white rounded font-medium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isRestoring ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Restore Now
                  </>
                )}
              </button>
              <button
                onClick={() => setSelectedSnapshot(null)}
                disabled={isRestoring}
                className="py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Non-admin notice */}
        {!isAdmin && (status?.snapshots?.length ?? 0) > 0 && (
          <div className="p-2 rounded bg-plm-bg-secondary border border-plm-border">
            <p className="text-xs text-plm-fg-muted text-center">
              Only admins can run backups and restore
            </p>
          </div>
        )}
      </div>
      
      {/* Admin Configuration Section */}
      {isAdmin && (
        <div className="space-y-3 pt-4 border-t border-plm-border">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center justify-between w-full text-left"
          >
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Settings className="w-4 h-4 text-plm-fg-muted" />
              Backup Configuration
              <span className="text-xs px-1.5 py-0.5 bg-plm-accent/20 text-plm-accent rounded">
                Admin
              </span>
            </h4>
            {showConfig ? (
              <ChevronUp className="w-4 h-4 text-plm-fg-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-plm-fg-muted" />
            )}
          </button>
          
          {showConfig && (
            <div className="space-y-4 p-4 rounded-lg bg-plm-bg-secondary border border-plm-border">
              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium mb-1">Provider</label>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value as typeof provider)}
                  className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                >
                  <option value="backblaze_b2">Backblaze B2</option>
                  <option value="aws_s3">Amazon S3</option>
                  <option value="google_cloud">Google Cloud Storage</option>
                </select>
              </div>
              
              {/* Bucket */}
              <div>
                <label className="block text-sm font-medium mb-1">Bucket Name</label>
                <input
                  type="text"
                  value={bucket}
                  onChange={e => setBucket(e.target.value)}
                  placeholder="my-backup-bucket"
                  className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                />
              </div>
              
              {/* Endpoint (for S3-compatible) */}
              {provider === 'backblaze_b2' && (
                <div>
                  <label className="block text-sm font-medium mb-1">S3 Endpoint</label>
                  <input
                    type="text"
                    value={endpoint}
                    onChange={e => setEndpoint(e.target.value)}
                    placeholder="s3.us-west-004.backblazeb2.com"
                    className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                  <p className="text-xs text-plm-fg-muted mt-1">
                    Find this in your B2 bucket settings
                  </p>
                </div>
              )}
              
              {/* Region (for AWS) */}
              {provider === 'aws_s3' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Region</label>
                  <input
                    type="text"
                    value={region}
                    onChange={e => setRegion(e.target.value)}
                    placeholder="us-east-1"
                    className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                </div>
              )}
              
              {/* Access Key */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  {provider === 'backblaze_b2' ? 'Application Key ID' : 'Access Key ID'}
                </label>
                <input
                  type="text"
                  value={accessKey}
                  onChange={e => setAccessKey(e.target.value)}
                  placeholder="004..."
                  className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm font-mono"
                />
              </div>
              
              {/* Secret Key */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  {provider === 'backblaze_b2' ? 'Application Key' : 'Secret Access Key'}
                </label>
                <div className="relative">
                  <input
                    type={showSecretKey ? 'text' : 'password'}
                    value={secretKey}
                    onChange={e => setSecretKey(e.target.value)}
                    placeholder="K004..."
                    className="w-full px-3 py-2 pr-10 rounded bg-plm-bg-primary border border-plm-border text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                  >
                    {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              {/* Restic Password */}
              <div>
                <label className="block text-sm font-medium mb-1 flex items-center gap-1">
                  <Key className="w-3 h-3" />
                  Encryption Password
                </label>
                <div className="relative">
                  <input
                    type={showResticPassword ? 'text' : 'password'}
                    value={resticPassword}
                    onChange={e => setResticPassword(e.target.value)}
                    placeholder="Strong password for encrypting backups"
                    className="w-full px-3 py-2 pr-10 rounded bg-plm-bg-primary border border-plm-border text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResticPassword(!showResticPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
                  >
                    {showResticPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-plm-fg-muted mt-1">
                  This password encrypts your backups. <strong>Store it safely!</strong>
                </p>
              </div>
              
              {/* Retention Policy */}
              <div>
                <label className="block text-sm font-medium mb-2">Retention Policy</label>
                <p className="text-xs text-plm-fg-muted mb-3">How long to keep backups on the server</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-plm-fg-muted mb-1">Keep daily for</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={retentionDaily}
                        onChange={e => setRetentionDaily(parseInt(e.target.value) || 14)}
                        className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                      />
                      <span className="text-xs text-plm-fg-muted whitespace-nowrap">days</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-plm-fg-muted mb-1">Keep weekly for</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="52"
                        value={retentionWeekly}
                        onChange={e => setRetentionWeekly(parseInt(e.target.value) || 10)}
                        className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                      />
                      <span className="text-xs text-plm-fg-muted whitespace-nowrap">weeks</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-plm-fg-muted mb-1">Keep monthly for</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={retentionMonthly}
                        onChange={e => setRetentionMonthly(parseInt(e.target.value) || 12)}
                        className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                      />
                      <span className="text-xs text-plm-fg-muted whitespace-nowrap">months</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-plm-fg-muted mb-1">Keep yearly for</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={retentionYearly}
                        onChange={e => setRetentionYearly(parseInt(e.target.value) || 5)}
                        className="w-full px-3 py-2 rounded bg-plm-bg-primary border border-plm-border text-sm"
                      />
                      <span className="text-xs text-plm-fg-muted whitespace-nowrap">years</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-plm-fg-muted mt-2">
                  ≈ {totalRetentionPoints} restore points total
                </p>
              </div>
              
              {/* Schedule */}
              <div>
                <label className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={e => setScheduleEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-plm-border bg-plm-bg-primary"
                  />
                  <span className="text-sm font-medium">Enable scheduled backups</span>
                </label>
                
                {scheduleEnabled && (
                  <div className="pl-6">
                    <label className="block text-xs text-plm-fg-muted mb-1">Backup time</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={`${scheduleHour}:${scheduleMinute}`}
                        onChange={e => {
                          const [h, m] = e.target.value.split(':').map(Number)
                          setScheduleHour(h)
                          setScheduleMinute(m)
                        }}
                        className="w-24 px-2 py-1.5 rounded bg-plm-bg-primary border border-plm-border text-sm"
                      >
                        {Array.from({ length: 48 }, (_, i) => {
                          const hour = Math.floor(i / 2)
                          const minute = (i % 2) * 30
                          const value = `${hour}:${minute}`
                          const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
                          return <option key={value} value={value}>{label}</option>
                        })}
                      </select>
                      <select
                        value={scheduleTimezone}
                        onChange={e => setScheduleTimezone(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded bg-plm-bg-primary border border-plm-border text-sm"
                      >
                        <optgroup label="Americas">
                          <option value="America/Los_Angeles">Pacific (LA)</option>
                          <option value="America/Denver">Mountain (Denver)</option>
                          <option value="America/Chicago">Central (Chicago)</option>
                          <option value="America/New_York">Eastern (NY)</option>
                          <option value="America/Sao_Paulo">São Paulo</option>
                        </optgroup>
                        <optgroup label="Europe">
                          <option value="Europe/London">London</option>
                          <option value="Europe/Paris">Paris / Berlin</option>
                          <option value="Europe/Moscow">Moscow</option>
                        </optgroup>
                        <optgroup label="Asia/Pacific">
                          <option value="Asia/Dubai">Dubai</option>
                          <option value="Asia/Kolkata">India</option>
                          <option value="Asia/Shanghai">China</option>
                          <option value="Asia/Tokyo">Tokyo</option>
                          <option value="Australia/Sydney">Sydney</option>
                        </optgroup>
                        <optgroup label="Other">
                          <option value="UTC">UTC</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Info Box */}
              <div className="p-3 rounded bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-300">
                    <p className="mb-1">
                      Backups use <strong>restic</strong> with deduplication, so storage usage is much lower than raw file size.
                    </p>
                    <a
                      href="https://www.backblaze.com/b2/cloud-storage.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
                    >
                      Backblaze B2 Pricing
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
              
              {/* Save Button */}
              <button
                onClick={handleSaveConfig}
                disabled={isSaving}
                className="w-full py-2 px-4 bg-plm-accent text-white rounded font-medium hover:bg-plm-accent-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Save Configuration
                  </>
                )}
              </button>
              
              {/* Export/Import buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleExportConfig}
                  className="flex-1 py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-primary border border-plm-border flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Config
                </button>
                <button
                  onClick={handleImportConfig}
                  className="flex-1 py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-primary border border-plm-border flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Import Config
                </button>
              </div>
              
              {/* Disaster Recovery Warning */}
              <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300">
                    <p className="font-medium mb-1">Export your config as disaster recovery!</p>
                    <p>
                      If Supabase goes down, the exported config file is your key to access backups.
                      Store it in a password manager or secure location.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Delete Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-red-500/10">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Delete Snapshot?</h3>
                <p className="text-sm text-plm-fg-muted mt-1">
                  {deleteConfirmTarget.time}
                </p>
              </div>
            </div>
            
            <div className="space-y-2 text-sm text-plm-fg-muted">
              <p>This will permanently delete the snapshot from the backup server.</p>
              <p className="text-red-400 font-medium">This action cannot be undone.</p>
            </div>
            
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeleteConfirmTarget(null)}
                className="flex-1 py-2 px-4 bg-plm-bg-tertiary text-plm-fg rounded font-medium hover:bg-plm-bg-secondary border border-plm-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSnapshot}
                className="flex-1 py-2 px-4 bg-red-600 text-white rounded font-medium hover:bg-red-500 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

