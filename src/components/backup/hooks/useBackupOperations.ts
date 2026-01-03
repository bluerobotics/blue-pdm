import { useState, useEffect, useCallback } from 'react'
import {
  runBackup,
  restoreFromSnapshot,
  deleteSnapshot,
  designateThisMachine,
  clearDesignatedMachine,
  requestBackup,
  markBackupStarted,
  markBackupComplete,
  startBackupService,
  stopBackupService,
  getBackupConfig,
  type BackupConfig
} from '../../../lib/backup'
import type { BackupProgress, DeleteConfirmTarget, ConnectedVault } from '../types'

interface UseBackupOperationsReturn {
  // Backup state
  isRunningBackup: boolean
  backupProgress: BackupProgress | null
  
  // Restore state
  isRestoring: boolean
  selectedSnapshot: string | null
  setSelectedSnapshot: (id: string | null) => void
  
  // Delete state
  deletingSnapshotId: string | null
  deleteConfirmTarget: DeleteConfirmTarget | null
  setDeleteConfirmTarget: (target: DeleteConfirmTarget | null) => void
  
  // Vault selection
  selectedVaultIds: string[]
  setSelectedVaultIds: React.Dispatch<React.SetStateAction<string[]>>
  
  // History filter
  historyVaultFilter: string
  setHistoryVaultFilter: (filter: string) => void
  
  // Operations
  handleRunBackup: () => Promise<void>
  handleRestore: () => Promise<void>
  handleDeleteSnapshot: () => Promise<void>
  handleDesignateThisMachine: () => Promise<void>
  handleClearDesignatedMachine: () => Promise<void>
}

/**
 * Hook to manage backup and restore operations
 */
export function useBackupOperations(
  config: BackupConfig | null | undefined,
  orgId: string | undefined,
  _userId: string | undefined, // Reserved for future use
  userEmail: string | undefined,
  vaultPath: string | null,
  currentVaultId: string | undefined,
  connectedVaults: ConnectedVault[],
  isThisDesignated: boolean,
  isDesignatedOnline: boolean,
  addToast: (type: 'success' | 'error' | 'info', message: string, duration?: number) => void,
  loadStatus: () => Promise<void>
): UseBackupOperationsReturn {
  // Backup state
  const [isRunningBackup, setIsRunningBackup] = useState(false)
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null)
  
  // Restore state
  const [isRestoring, setIsRestoring] = useState(false)
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null)
  
  // Delete state
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<DeleteConfirmTarget | null>(null)
  
  // Vault selection
  const [selectedVaultIds, setSelectedVaultIds] = useState<string[]>([])
  
  // History filter
  const [historyVaultFilter, setHistoryVaultFilter] = useState<string>('all')

  // Initialize selected vaults when connected vaults change
  useEffect(() => {
    if (connectedVaults.length > 0 && selectedVaultIds.length === 0) {
      // Select all vaults by default
      setSelectedVaultIds(connectedVaults.map(v => v.id))
    }
  }, [connectedVaults, selectedVaultIds.length])

  // Internal function to actually run the backup (used by designated machine)
  const handleRunBackupInternal = useCallback(async (backupConfig: BackupConfig) => {
    const vaultsToBackup = connectedVaults.filter(v => selectedVaultIds.includes(v.id))
    
    window.electronAPI?.log('info', '[Backup] handleRunBackupInternal called', {
      configOrgId: backupConfig.org_id,
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
    await markBackupStarted(orgId || '')
    
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
            configOrgId: backupConfig.org_id
          })
          const result = await runBackup(backupConfig, { 
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
      await markBackupComplete(orgId || '')
      setIsRunningBackup(false)
      setBackupProgress(null)
      await loadStatus()
      
      if (vaultsToBackup.length > 1) {
        addToast('info', `Backup complete: ${successCount} succeeded, ${failCount} failed`)
      }
    }
  }, [connectedVaults, selectedVaultIds, orgId, addToast, loadStatus])

  // Start backup service if this is the designated machine
  useEffect(() => {
    if (!isThisDesignated || !orgId || !currentVaultId) return
    
    console.log('[BackupPanel] This is the designated machine, starting backup service...')
    
    startBackupService(
      orgId,
      currentVaultId,
      async (backupConfig) => {
        // Backup request received - run the backup
        await handleRunBackupInternal(backupConfig)
      },
      async () => {
        // Fetch fresh config from database each time
        return await getBackupConfig(orgId)
      }
    )
    
    return () => {
      stopBackupService()
    }
  }, [isThisDesignated, orgId, currentVaultId, handleRunBackupInternal])

  // Handle backup button click - either run locally or request remotely
  const handleRunBackup = useCallback(async () => {
    if (!config || !orgId) {
      addToast('error', 'Backup not configured')
      return
    }
    
    // Check if there's a designated machine
    if (!config.designated_machine_id) {
      addToast('error', 'No backup machine designated. Set this machine as backup source first.')
      return
    }
    
    // If this is the designated machine, run locally
    if (isThisDesignated) {
      if (!currentVaultId) {
        addToast('error', 'No vault connected')
        return
      }
      await handleRunBackupInternal(config)
      return
    }
    
    // Otherwise, request backup from designated machine
    if (!isDesignatedOnline) {
      addToast('error', 'Backup machine is offline. Cannot trigger backup.')
      return
    }
    
    try {
      const result = await requestBackup(orgId, userEmail || '')
      if (result.success) {
        addToast('success', 'Backup requested! The designated machine will start the backup shortly.')
        await loadStatus()
      } else {
        addToast('error', result.error || 'Failed to request backup')
      }
    } catch (_err) {
      addToast('error', 'Failed to request backup')
    }
  }, [config, orgId, isThisDesignated, currentVaultId, isDesignatedOnline, userEmail, handleRunBackupInternal, addToast, loadStatus])

  // Restore from snapshot
  const handleRestore = useCallback(async () => {
    if (!selectedSnapshot || !config || !vaultPath) {
      addToast('error', 'No snapshot selected or vault not connected')
      return
    }
    
    setIsRestoring(true)
    try {
      addToast('info', `Restoring snapshot ${selectedSnapshot.substring(0, 8)}...`, 0)
      const result = await restoreFromSnapshot(config, selectedSnapshot, vaultPath)
      
      if (result.success) {
        addToast('success', 'Files restored successfully!')
        
        if (result.hasMetadata) {
          addToast('info', 'Database metadata found, importing...', 5000)
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
  }, [selectedSnapshot, config, vaultPath, addToast])

  // Delete a snapshot
  const handleDeleteSnapshot = useCallback(async () => {
    if (!deleteConfirmTarget || !config) return
    
    const { id: snapshotId } = deleteConfirmTarget
    setDeleteConfirmTarget(null)
    setDeletingSnapshotId(snapshotId)
    
    try {
      const result = await deleteSnapshot(config, snapshotId)
      
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
  }, [deleteConfirmTarget, config, addToast, loadStatus])

  // Designate this machine as backup source
  const handleDesignateThisMachine = useCallback(async () => {
    if (!orgId || !userEmail) return
    
    const result = await designateThisMachine(orgId, userEmail)
    if (result.success) {
      addToast('success', 'This machine is now the backup source')
      await loadStatus()
    } else {
      addToast('error', result.error || 'Failed to designate machine')
    }
  }, [orgId, userEmail, addToast, loadStatus])

  // Clear designated machine
  const handleClearDesignatedMachine = useCallback(async () => {
    if (!orgId) return
    
    const result = await clearDesignatedMachine(orgId)
    if (result.success) {
      addToast('success', 'Backup source cleared')
      await loadStatus()
    } else {
      addToast('error', result.error || 'Failed to clear designation')
    }
  }, [orgId, addToast, loadStatus])

  return {
    isRunningBackup,
    backupProgress,
    isRestoring,
    selectedSnapshot,
    setSelectedSnapshot,
    deletingSnapshotId,
    deleteConfirmTarget,
    setDeleteConfirmTarget,
    selectedVaultIds,
    setSelectedVaultIds,
    historyVaultFilter,
    setHistoryVaultFilter,
    handleRunBackup,
    handleRestore,
    handleDeleteSnapshot,
    handleDesignateThisMachine,
    handleClearDesignatedMachine
  }
}
