import { t } from '@/lib/i18n'
import type { VaultAuditProgress as Progress } from '@/types/vaultAudit'

interface VaultAuditProgressProps {
  progress: Progress
}

const PERCENT = 100

/**
 * A bar and a count while the scan runs.
 *
 * The total is unknown until the rows have been fetched and filtered, which is the first few
 * seconds. An indeterminate bar covers that window rather than a bar sitting at zero, because a
 * bar at zero is indistinguishable from a stall.
 */
export function VaultAuditProgress({ progress }: VaultAuditProgressProps) {
  const known = progress.total > 0
  const percent = known ? Math.round((progress.completed / progress.total) * PERCENT) : 0

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full rounded-full bg-plm-border overflow-hidden">
        {known ? (
          <div
            className="h-full bg-plm-accent transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-plm-accent animate-pulse" />
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-plm-fg-muted">
        <span>
          {known
            ? t('vaultAudit.progressFiles', {
                completed: progress.completed,
                total: progress.total,
              })
            : (progress.message || t('vaultAudit.preparing'))}
        </span>
        {known && <span>{percent}%</span>}
      </div>
    </div>
  )
}
