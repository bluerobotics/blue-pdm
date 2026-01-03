import { useState, useEffect, useMemo, useCallback } from 'react'
import { saveBackupConfig, type BackupConfig } from '../../../lib/backup'
import { DEFAULT_RETENTION } from '../constants'

interface UseBackupConfigReturn {
  // Provider settings
  provider: 'backblaze_b2' | 'aws_s3' | 'google_cloud'
  setProvider: (provider: 'backblaze_b2' | 'aws_s3' | 'google_cloud') => void
  bucket: string
  setBucket: (bucket: string) => void
  region: string
  setRegion: (region: string) => void
  endpoint: string
  setEndpoint: (endpoint: string) => void
  
  // Credentials
  accessKey: string
  setAccessKey: (key: string) => void
  secretKey: string
  setSecretKey: (key: string) => void
  resticPassword: string
  setResticPassword: (password: string) => void
  showSecretKey: boolean
  setShowSecretKey: (show: boolean) => void
  showResticPassword: boolean
  setShowResticPassword: (show: boolean) => void
  
  // Retention settings
  retentionDaily: number
  setRetentionDaily: (days: number) => void
  retentionWeekly: number
  setRetentionWeekly: (weeks: number) => void
  retentionMonthly: number
  setRetentionMonthly: (months: number) => void
  retentionYearly: number
  setRetentionYearly: (years: number) => void
  totalRetentionPoints: number
  
  // Schedule settings
  scheduleEnabled: boolean
  setScheduleEnabled: (enabled: boolean) => void
  scheduleHour: number
  setScheduleHour: (hour: number) => void
  scheduleMinute: number
  setScheduleMinute: (minute: number) => void
  scheduleTimezone: string
  setScheduleTimezone: (timezone: string) => void
  
  // Actions
  handleSave: () => Promise<void>
  isSaving: boolean
  
  // Export/Import
  exportConfig: () => void
  importConfig: () => void
}

/**
 * Hook to manage backup configuration form state
 */
export function useBackupConfig(
  initialConfig: BackupConfig | null | undefined,
  orgId: string | undefined,
  userId: string | undefined,
  addToast: (type: 'success' | 'error' | 'info', message: string, duration?: number) => void,
  onSaveSuccess: () => Promise<void>
): UseBackupConfigReturn {
  // Provider settings
  const [provider, setProvider] = useState<'backblaze_b2' | 'aws_s3' | 'google_cloud'>('backblaze_b2')
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [endpoint, setEndpoint] = useState('')
  
  // Credentials
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [resticPassword, setResticPassword] = useState('')
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [showResticPassword, setShowResticPassword] = useState(false)
  
  // Retention settings
  const [retentionDaily, setRetentionDaily] = useState(DEFAULT_RETENTION.daily)
  const [retentionWeekly, setRetentionWeekly] = useState(DEFAULT_RETENTION.weekly)
  const [retentionMonthly, setRetentionMonthly] = useState(DEFAULT_RETENTION.monthly)
  const [retentionYearly, setRetentionYearly] = useState(DEFAULT_RETENTION.yearly)
  
  // Schedule settings
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleHour, setScheduleHour] = useState(0)
  const [scheduleMinute, setScheduleMinute] = useState(0)
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC')
  
  // Saving state
  const [isSaving, setIsSaving] = useState(false)

  // Populate form with existing config
  useEffect(() => {
    if (initialConfig) {
      setProvider(initialConfig.provider)
      setBucket(initialConfig.bucket || '')
      setRegion(initialConfig.region || '')
      setEndpoint(initialConfig.endpoint || '')
      setAccessKey(initialConfig.access_key_encrypted || '')
      setSecretKey(initialConfig.secret_key_encrypted || '')
      setResticPassword(initialConfig.restic_password_encrypted || '')
      setRetentionDaily(initialConfig.retention_daily ?? DEFAULT_RETENTION.daily)
      setRetentionWeekly(initialConfig.retention_weekly ?? DEFAULT_RETENTION.weekly)
      setRetentionMonthly(initialConfig.retention_monthly ?? DEFAULT_RETENTION.monthly)
      setRetentionYearly(initialConfig.retention_yearly ?? DEFAULT_RETENTION.yearly)
      setScheduleEnabled(initialConfig.schedule_enabled ?? false)
      setScheduleHour(initialConfig.schedule_hour ?? 0)
      setScheduleMinute(initialConfig.schedule_minute ?? 0)
      setScheduleTimezone(initialConfig.schedule_timezone || 'UTC')
    }
  }, [initialConfig])

  // Calculate total retention points
  const totalRetentionPoints = useMemo(
    () => retentionDaily + retentionWeekly + retentionMonthly + retentionYearly,
    [retentionDaily, retentionWeekly, retentionMonthly, retentionYearly]
  )

  // Save configuration
  const handleSave = useCallback(async () => {
    if (!orgId || !userId) return
    
    if (!bucket || !accessKey || !secretKey || !resticPassword) {
      addToast('error', 'Please fill in all required fields')
      return
    }
    
    setIsSaving(true)
    try {
      const result = await saveBackupConfig(orgId, {
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
      }, userId)
      
      if (result.success) {
        addToast('success', 'Backup configuration saved')
        await onSaveSuccess()
      } else {
        addToast('error', result.error || 'Failed to save configuration')
      }
    } catch (_err) {
      addToast('error', 'Failed to save configuration')
    } finally {
      setIsSaving(false)
    }
  }, [
    orgId, userId, bucket, accessKey, secretKey, resticPassword,
    provider, region, endpoint, retentionDaily, retentionWeekly,
    retentionMonthly, retentionYearly, scheduleEnabled, scheduleHour,
    scheduleMinute, scheduleTimezone, addToast, onSaveSuccess
  ])

  // Export config
  const exportConfig = useCallback(() => {
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
  }, [
    provider, bucket, region, endpoint, accessKey, secretKey,
    resticPassword, retentionDaily, retentionWeekly, retentionMonthly,
    retentionYearly, addToast
  ])

  // Import config
  const importConfig = useCallback(() => {
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
        setRetentionDaily(data.retentionDaily ?? DEFAULT_RETENTION.daily)
        setRetentionWeekly(data.retentionWeekly ?? DEFAULT_RETENTION.weekly)
        setRetentionMonthly(data.retentionMonthly ?? DEFAULT_RETENTION.monthly)
        setRetentionYearly(data.retentionYearly ?? DEFAULT_RETENTION.yearly)
        
        addToast('success', 'Configuration imported! Click Save to apply.')
      } catch (_err) {
        addToast('error', 'Failed to parse configuration file')
      }
    }
    input.click()
  }, [addToast])

  return {
    provider,
    setProvider,
    bucket,
    setBucket,
    region,
    setRegion,
    endpoint,
    setEndpoint,
    accessKey,
    setAccessKey,
    secretKey,
    setSecretKey,
    resticPassword,
    setResticPassword,
    showSecretKey,
    setShowSecretKey,
    showResticPassword,
    setShowResticPassword,
    retentionDaily,
    setRetentionDaily,
    retentionWeekly,
    setRetentionWeekly,
    retentionMonthly,
    setRetentionMonthly,
    retentionYearly,
    setRetentionYearly,
    totalRetentionPoints,
    scheduleEnabled,
    setScheduleEnabled,
    scheduleHour,
    setScheduleHour,
    scheduleMinute,
    setScheduleMinute,
    scheduleTimezone,
    setScheduleTimezone,
    handleSave,
    isSaving,
    exportConfig,
    importConfig
  }
}
