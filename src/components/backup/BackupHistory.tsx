import { Clock } from 'lucide-react'
import type { BackupStatus, DeleteConfirmTarget } from './types'
import { extractVaultNamesFromSnapshots, formatDate } from './utils'
import { BackupHistoryItem } from './BackupHistoryItem'

interface BackupHistoryProps {
  status: BackupStatus | null
  isAdmin: boolean
  selectedSnapshot: string | null
  onSelectSnapshot: (id: string | null) => void
  deletingSnapshotId: string | null
  onRequestDelete: (target: DeleteConfirmTarget) => void
  historyVaultFilter: string
  onHistoryVaultFilterChange: (filter: string) => void
  isRestoring: boolean
}

/**
 * Shows the backup history with filtering by vault.
 */
export function BackupHistory({
  status,
  isAdmin,
  selectedSnapshot,
  onSelectSnapshot,
  deletingSnapshotId,
  onRequestDelete,
  historyVaultFilter,
  onHistoryVaultFilterChange,
  isRestoring
}: BackupHistoryProps) {
  const vaultNames = status?.snapshots ? extractVaultNamesFromSnapshots(status.snapshots) : []
  
  const filteredSnapshots = status?.snapshots?.filter(snapshot => {
    if (historyVaultFilter === 'all') return true
    return snapshot.tags?.some(tag => tag === `vault:${historyVaultFilter}`)
  }) || []

  return (
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
        {vaultNames.length > 0 && (
          <select
            value={historyVaultFilter}
            onChange={e => onHistoryVaultFilterChange(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-plm-bg-primary border border-plm-border"
          >
            <option value="all">All vaults</option>
            {vaultNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
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
        ) : filteredSnapshots.length === 0 ? (
          <div className="text-sm text-plm-fg-muted py-8 text-center bg-plm-bg-secondary rounded-lg border border-plm-border">
            No backups yet. Click "Sync & Backup Now" to create your first backup.
          </div>
        ) : (
          filteredSnapshots.map(snapshot => (
            <BackupHistoryItem
              key={snapshot.id}
              snapshot={snapshot}
              isSelected={selectedSnapshot === snapshot.id}
              isAdmin={isAdmin}
              isDeleting={deletingSnapshotId === snapshot.id}
              isRestoring={isRestoring}
              onSelect={() => onSelectSnapshot(selectedSnapshot === snapshot.id ? null : snapshot.id)}
              onRequestDelete={() => onRequestDelete({ id: snapshot.id, time: formatDate(snapshot.time) })}
            />
          ))
        )}
      </div>
      
      {/* Non-admin notice */}
      {!isAdmin && (status?.snapshots?.length ?? 0) > 0 && (
        <div className="p-2 rounded bg-plm-bg-secondary border border-plm-border">
          <p className="text-xs text-plm-fg-muted text-center">
            Only admins can run backups and restore
          </p>
        </div>
      )}
    </div>
  )
}
