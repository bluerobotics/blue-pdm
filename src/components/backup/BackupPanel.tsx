import { useState } from 'react'
import { Shield, RefreshCw, Loader2 } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

// Hooks
import { useBackupStatus } from './hooks/useBackupStatus'
import { useBackupConfig } from './hooks/useBackupConfig'
import { useBackupOperations } from './hooks/useBackupOperations'

// Components
import { BackupStatusCard } from './BackupStatusCard'
import { BackupScheduleInfo } from './BackupScheduleInfo'
import { BackupSourceSection } from './BackupSourceSection'
import { BackupHistory } from './BackupHistory'
import { RestoreActionBar } from './RestoreActionBar'
import { DeleteSnapshotDialog } from './DeleteSnapshotDialog'
import { BackupConfigForm } from './BackupConfigForm'

// Types
import type { BackupPanelProps } from './types'

/**
 * Main BackupPanel component - orchestrates all backup functionality.
 * Manages backup configuration, status, history, and restore operations.
 */
export function BackupPanel({ isAdmin }: BackupPanelProps) {
  const { organization, user, addToast, activeVaultId, connectedVaults, vaultPath } = usePDMStore()
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  // Config section visibility
  const [showConfig, setShowConfig] = useState(false)
  
  // Load backup status
  const {
    status,
    isLoading,
    isRefreshing,
    isThisDesignated,
    isDesignatedOnline,
    refresh,
    loadStatus
  } = useBackupStatus(organization?.id, addToast)
  
  // Config form state
  const configHook = useBackupConfig(
    status?.config,
    organization?.id,
    user?.id,
    addToast,
    loadStatus
  )
  
  // Operations (backup, restore, delete, designate)
  const operations = useBackupOperations(
    status?.config,
    organization?.id,
    user?.id,
    user?.email,
    vaultPath,
    currentVaultId,
    connectedVaults,
    isThisDesignated,
    isDesignatedOnline,
    addToast,
    loadStatus
  )
  
  // Handle vault toggle for selection
  const handleVaultToggle = (vaultId: string, checked: boolean) => {
    if (checked) {
      operations.setSelectedVaultIds(prev => [...prev, vaultId])
    } else {
      operations.setSelectedVaultIds(prev => prev.filter(id => id !== vaultId))
    }
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
          onClick={refresh}
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
        <BackupStatusCard status={status} />
        
        {/* Backup Schedule Info */}
        {status?.isConfigured && (
          <BackupScheduleInfo status={status} />
        )}
        
        {/* Backup Source Section */}
        {status?.isConfigured && (
          <BackupSourceSection
            status={status}
            isThisDesignated={isThisDesignated}
            isDesignatedOnline={isDesignatedOnline}
            isAdmin={isAdmin}
            connectedVaults={connectedVaults}
            selectedVaultIds={operations.selectedVaultIds}
            onVaultToggle={handleVaultToggle}
            isRunningBackup={operations.isRunningBackup}
            backupProgress={operations.backupProgress}
            onRunBackup={operations.handleRunBackup}
            onDesignateThisMachine={operations.handleDesignateThisMachine}
            onClearDesignatedMachine={operations.handleClearDesignatedMachine}
          />
        )}
      </div>
      
      {/* Snapshot History */}
      <BackupHistory
        status={status}
        isAdmin={isAdmin}
        selectedSnapshot={operations.selectedSnapshot}
        onSelectSnapshot={operations.setSelectedSnapshot}
        deletingSnapshotId={operations.deletingSnapshotId}
        onRequestDelete={operations.setDeleteConfirmTarget}
        historyVaultFilter={operations.historyVaultFilter}
        onHistoryVaultFilterChange={operations.setHistoryVaultFilter}
        isRestoring={operations.isRestoring}
      />
      
      {/* Restore Action Bar */}
      {operations.selectedSnapshot && (
        <RestoreActionBar
          selectedSnapshot={operations.selectedSnapshot}
          isRestoring={operations.isRestoring}
          onRestore={operations.handleRestore}
          onCancel={() => operations.setSelectedSnapshot(null)}
        />
      )}
      
      {/* Admin Configuration Section */}
      {isAdmin && (
        <BackupConfigForm
          showConfig={showConfig}
          onToggleConfig={() => setShowConfig(!showConfig)}
          provider={configHook.provider}
          onProviderChange={configHook.setProvider}
          bucket={configHook.bucket}
          onBucketChange={configHook.setBucket}
          region={configHook.region}
          onRegionChange={configHook.setRegion}
          endpoint={configHook.endpoint}
          onEndpointChange={configHook.setEndpoint}
          accessKey={configHook.accessKey}
          onAccessKeyChange={configHook.setAccessKey}
          secretKey={configHook.secretKey}
          onSecretKeyChange={configHook.setSecretKey}
          resticPassword={configHook.resticPassword}
          onResticPasswordChange={configHook.setResticPassword}
          showSecretKey={configHook.showSecretKey}
          onShowSecretKeyChange={configHook.setShowSecretKey}
          showResticPassword={configHook.showResticPassword}
          onShowResticPasswordChange={configHook.setShowResticPassword}
          retentionDaily={configHook.retentionDaily}
          onRetentionDailyChange={configHook.setRetentionDaily}
          retentionWeekly={configHook.retentionWeekly}
          onRetentionWeeklyChange={configHook.setRetentionWeekly}
          retentionMonthly={configHook.retentionMonthly}
          onRetentionMonthlyChange={configHook.setRetentionMonthly}
          retentionYearly={configHook.retentionYearly}
          onRetentionYearlyChange={configHook.setRetentionYearly}
          totalRetentionPoints={configHook.totalRetentionPoints}
          scheduleEnabled={configHook.scheduleEnabled}
          onScheduleEnabledChange={configHook.setScheduleEnabled}
          scheduleHour={configHook.scheduleHour}
          scheduleMinute={configHook.scheduleMinute}
          onScheduleTimeChange={(h, m) => {
            configHook.setScheduleHour(h)
            configHook.setScheduleMinute(m)
          }}
          scheduleTimezone={configHook.scheduleTimezone}
          onScheduleTimezoneChange={configHook.setScheduleTimezone}
          isSaving={configHook.isSaving}
          onSave={configHook.handleSave}
          onExport={configHook.exportConfig}
          onImport={configHook.importConfig}
        />
      )}
      
      {/* Delete Confirmation Modal */}
      {operations.deleteConfirmTarget && (
        <DeleteSnapshotDialog
          target={operations.deleteConfirmTarget}
          onConfirm={operations.handleDeleteSnapshot}
          onCancel={() => operations.setDeleteConfirmTarget(null)}
        />
      )}
    </div>
  )
}
