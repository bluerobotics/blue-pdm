import { Clock, Calendar } from 'lucide-react'
import type { BackupStatus } from './types'
import { formatRelativeTime, getNextScheduledBackup, formatTimeUntil } from './utils'

interface BackupScheduleInfoProps {
  status: BackupStatus
}

/**
 * Shows the last backup time and next scheduled backup time.
 */
export function BackupScheduleInfo({ status }: BackupScheduleInfoProps) {
  return (
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
  )
}
