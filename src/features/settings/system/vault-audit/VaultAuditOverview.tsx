import { AlertTriangle, CheckCircle2, CircleDashed, FileWarning, ShieldCheck } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditView } from '@/types/vaultAudit'

interface VaultAuditOverviewProps {
  view: VaultAuditView
  artifactPath: string | null
}

const MS_PER_SECOND = 1000

function unreadLines(view: VaultAuditView): string[] {
  const lines: string[] = []
  const { missingOnDisk, openInSolidWorks, readFailed } = view.unread

  if (openInSolidWorks > 0) {
    lines.push(t('vaultAudit.unread.openInSolidWorks', { count: openInSolidWorks }))
  }
  if (missingOnDisk > 0) {
    lines.push(t('vaultAudit.unread.missingOnDisk', { count: missingOnDisk }))
  }
  if (readFailed > 0) {
    lines.push(t('vaultAudit.unread.readFailed', { count: readFailed }))
  }
  return lines
}

/**
 * Why in-scope files were never opened, one clause per reason.
 *
 * Deliberately worded as "not compared" rather than as anything that sounds like damage: the 6,363
 * single-configuration models a `configuration-recorded` run skips are overwhelmingly fine, and an
 * alarming count over them would be a worse lie than the silence it replaces.
 */
function notComparedLines(view: VaultAuditView): string[] {
  const lines: string[] = []
  const { noConfigurationRecord, beyondLimit } = view.notCompared

  if (noConfigurationRecord > 0) {
    lines.push(
      t('vaultAudit.notCompared.noConfigurationRecord', { count: noConfigurationRecord }),
    )
  }
  if (beyondLimit > 0) {
    lines.push(t('vaultAudit.notCompared.beyondLimit', { count: beyondLimit }))
  }
  return lines
}

export function VaultAuditOverview({ view, artifactPath }: VaultAuditOverviewProps) {
  // "No findings" and "nothing to act on" are different claims, and `findings.length === 0` only
  // supports the first. A `configuration-recorded` run compares roughly one model in seven, so the
  // green tick used to appear over six thousand files nothing had looked at.
  const noFindings = view.findings.length === 0
  const everythingCompared = view.notCompared.total === 0
  const clean = noFindings && everythingCompared
  const notRead = unreadLines(view)
  const notCompared = notComparedLines(view)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {clean ? (
          <CheckCircle2 size={16} className="text-plm-success mt-0.5 flex-shrink-0" />
        ) : noFindings ? (
          <CircleDashed size={16} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
        ) : (
          <FileWarning size={16} className="text-yellow-500 mt-0.5 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm text-plm-fg">
            {clean
              ? t('vaultAudit.result.noFindings')
              : noFindings
                ? t('vaultAudit.result.noFindingsInCompared')
                : t('vaultAudit.result.filesWithFindings', {
                    files: view.filesWithFindings,
                    compared: view.filesCompared,
                  })}
          </p>
          <p className="text-xs text-plm-fg-muted mt-0.5">
            {t('vaultAudit.result.scanned', {
              files: view.filesCompared,
              seconds: Math.round(view.durationMs / MS_PER_SECOND),
            })}
            {view.filesWithMultipleConfigurations > 0 &&
              ` · ${t('vaultAudit.result.multiConfiguration', {
                count: view.filesWithMultipleConfigurations,
              })}`}
          </p>
        </div>
      </div>

      {view.cancelled && (
        <p className="text-xs text-yellow-500 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {t('vaultAudit.result.cancelledNote')}
        </p>
      )}

      {notCompared.length > 0 && (
        <p className="text-xs text-plm-fg-muted">
          {t('vaultAudit.notCompared.heading')}: {notCompared.join(' · ')}
        </p>
      )}

      {notRead.length > 0 && (
        <p className="text-xs text-plm-fg-muted">
          {t('vaultAudit.unread.heading')}: {notRead.join(' · ')}
        </p>
      )}

      {view.integrity.filesChanged > 0 ? (
        <p className="text-xs text-plm-error flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {t('vaultAudit.integrity.changed', { count: view.integrity.filesChanged })}
        </p>
      ) : (
        view.integrity.filesHashed > 0 && (
          <p className="text-xs text-plm-fg-muted flex items-start gap-1.5">
            <ShieldCheck size={13} className="mt-0.5 flex-shrink-0 text-plm-success" />
            {t('vaultAudit.integrity.verified', { count: view.integrity.filesHashed })}
          </p>
        )
      )}

      {view.noEvidenceValues > 0 && (
        <p className="text-xs text-plm-fg-muted">
          {t('vaultAudit.result.noEvidence', { count: view.noEvidenceValues })}
        </p>
      )}

      {artifactPath && (
        <p className="text-xs text-plm-fg-muted font-mono break-all">
          {t('vaultAudit.result.artifact', { path: artifactPath })}
        </p>
      )}
    </div>
  )
}
