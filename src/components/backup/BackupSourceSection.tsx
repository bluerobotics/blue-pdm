import {
  Server,
  Monitor,
  Loader2,
  Play,
  AlertTriangle
} from 'lucide-react'
import type { BackupStatus, BackupProgress, ConnectedVault } from './types'
import { formatRelativeTime } from './utils'
import { VaultSelector } from './VaultSelector'

interface BackupSourceSectionProps {
  status: BackupStatus
  isThisDesignated: boolean
  isDesignatedOnline: boolean
  isAdmin: boolean
  connectedVaults: ConnectedVault[]
  selectedVaultIds: string[]
  onVaultToggle: (vaultId: string, checked: boolean) => void
  isRunningBackup: boolean
  backupProgress: BackupProgress | null
  onRunBackup: () => void
  onDesignateThisMachine: () => void
  onClearDesignatedMachine: () => void
}

/**
 * Shows backup source machine info and controls.
 * Includes machine designation, vault selection, and backup now button.
 */
export function BackupSourceSection({
  status,
  isThisDesignated,
  isDesignatedOnline,
  isAdmin,
  connectedVaults,
  selectedVaultIds,
  onVaultToggle,
  isRunningBackup,
  backupProgress,
  onRunBackup,
  onDesignateThisMachine,
  onClearDesignatedMachine
}: BackupSourceSectionProps) {
  const config = status.config
  
  return (
    <div className="p-4 rounded-lg bg-plm-bg-secondary border border-plm-border space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Server className="w-4 h-4 text-plm-fg-muted" />
          Backup Source
        </h4>
        {config?.designated_machine_id ? (
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
      
      {config?.designated_machine_id ? (
        // Show designated machine info
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Monitor className="w-8 h-8 text-plm-fg-muted" />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                {config.designated_machine_name || 'Unknown'}
                {isThisDesignated && (
                  <span className="text-xs px-1.5 py-0.5 bg-plm-accent/20 text-plm-accent rounded">
                    This machine
                  </span>
                )}
              </div>
              <div className="text-xs text-plm-fg-muted">
                {config.designated_machine_platform} • {config.designated_machine_user_email}
              </div>
              {!isThisDesignated && config.designated_machine_last_seen && (
                <div className="text-xs text-plm-fg-muted">
                  Last seen: {formatRelativeTime(config.designated_machine_last_seen)}
                </div>
              )}
            </div>
          </div>
          
          {/* Vaults to backup */}
          {isThisDesignated && (
            <VaultSelector
              connectedVaults={connectedVaults}
              selectedVaultIds={selectedVaultIds}
              onVaultToggle={onVaultToggle}
            />
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
      {config?.backup_requested_at && !config?.backup_running_since && (
        <div className="p-2 rounded bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
          ⏳ Backup requested by {config.backup_requested_by}...
        </div>
      )}
      {config?.backup_running_since && (
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
              onClick={onClearDesignatedMachine}
              className="w-full py-2 px-4 rounded text-sm bg-plm-bg-tertiary hover:bg-plm-bg-primary text-plm-fg-muted hover:text-plm-fg border border-plm-border"
            >
              Clear designation
            </button>
          ) : !config?.designated_machine_id ? (
            <button
              onClick={onDesignateThisMachine}
              className="w-full py-2 px-4 rounded text-sm bg-plm-accent text-white hover:bg-plm-accent-hover font-medium"
            >
              Set this machine as backup source
            </button>
          ) : !isDesignatedOnline ? (
            // Another machine is designated but offline - allow taking over
            <button
              onClick={onDesignateThisMachine}
              className="w-full py-2 px-4 rounded text-sm bg-amber-600 text-white hover:bg-amber-500 font-medium flex items-center justify-center gap-2"
            >
              <Monitor className="w-4 h-4" />
              Take over as backup source
            </button>
          ) : null}
          
          {/* Backup Now button */}
          {config?.designated_machine_id && (() => {
            const noVaultsSelected = isThisDesignated && selectedVaultIds.length === 0
            const isDisabled = isRunningBackup || (!isThisDesignated && !isDesignatedOnline) || !!config?.backup_requested_at || noVaultsSelected
            const getTitle = () => {
              if (noVaultsSelected) return 'Select at least one vault to backup'
              if (!isThisDesignated && !isDesignatedOnline) return 'Backup machine is offline'
              return undefined
            }
            return (
              <button
                onClick={onRunBackup}
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
                ) : config?.backup_requested_at ? (
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
  )
}
