import { useState, useEffect, useCallback } from 'react'
import {
  getBackupStatus,
  isThisDesignatedMachine,
  isDesignatedMachineOnline,
  type BackupStatus
} from '../../../lib/backup'

interface UseBackupStatusReturn {
  status: BackupStatus | null
  isLoading: boolean
  isRefreshing: boolean
  isThisDesignated: boolean
  isDesignatedOnline: boolean
  refresh: () => Promise<void>
  loadStatus: () => Promise<void>
}

/**
 * Hook to manage backup status loading and polling
 */
export function useBackupStatus(
  orgId: string | undefined,
  addToast: (type: 'success' | 'error' | 'info', message: string, duration?: number) => void
): UseBackupStatusReturn {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isThisDesignated, setIsThisDesignated] = useState(false)
  const [isDesignatedOnline, setIsDesignatedOnline] = useState(false)

  // Load backup status
  const loadStatus = useCallback(async () => {
    if (!orgId) return
    
    try {
      const newStatus = await getBackupStatus(orgId)
      setStatus(newStatus)
    } catch (err) {
      console.error('Failed to load backup status:', err)
    }
  }, [orgId])

  // Initial load
  useEffect(() => {
    setIsLoading(true)
    loadStatus().finally(() => setIsLoading(false))
  }, [loadStatus])

  // Check designated machine status when config changes
  useEffect(() => {
    if (status?.config) {
      isThisDesignatedMachine(status.config).then(setIsThisDesignated)
      setIsDesignatedOnline(isDesignatedMachineOnline(status.config))
    }
  }, [status?.config])

  // Refresh status periodically to see updated heartbeats
  useEffect(() => {
    const interval = setInterval(() => {
      if (orgId) {
        loadStatus()
      }
    }, 15000) // Every 15 seconds
    
    return () => clearInterval(interval)
  }, [orgId, loadStatus])

  // Manual refresh
  const refresh = useCallback(async () => {
    if (!orgId) return
    setIsRefreshing(true)
    try {
      await loadStatus()
      addToast('success', 'Backup status refreshed')
    } catch (_err) {
      addToast('error', 'Failed to refresh backup status')
    } finally {
      setIsRefreshing(false)
    }
  }, [orgId, loadStatus, addToast])

  return {
    status,
    isLoading,
    isRefreshing,
    isThisDesignated,
    isDesignatedOnline,
    refresh,
    loadStatus
  }
}
