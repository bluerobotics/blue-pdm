import { CheckCircle2, AlertTriangle } from 'lucide-react'
import type { BackupStatus } from './types'

interface BackupStatusCardProps {
  status: BackupStatus | null
}

/**
 * Shows the backup configuration status (configured/not configured)
 * and the total number of snapshots available.
 */
export function BackupStatusCard({ status }: BackupStatusCardProps) {
  return (
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
  )
}
