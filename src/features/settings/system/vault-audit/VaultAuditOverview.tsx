import { AlertTriangle, CheckCircle2, CircleDashed, FileWarning, ShieldCheck } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditView } from '@/types/vaultAudit'

import { hasEvidence } from './vaultAuditView'

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

/**
 * What the run is entitled to claim, which is not always what its findings suggest.
 *
 * Three of these four states report zero findings, and only one of them is good news. A run whose
 * scope named no rows, and a run that named rows and opened none of them, both arrive here with an
 * empty findings list and nothing marked uncompared - the shape of a perfect vault. Reading the
 * denominator first is what separates them.
 */
type HeadlineTone = 'empty' | 'clean' | 'partial' | 'findings'

function headlineToneOf(view: VaultAuditView): HeadlineTone {
  // Before anything else: no rows matched, or none of the matched rows were ever compared. Either
  // way the run has no evidence about anything and cannot speak to health.
  if (!hasEvidence(view)) return 'empty'
  if (view.findings.length > 0) return 'findings'
  // "No findings" and "nothing to act on" are different claims, and an empty findings list only
  // supports the first. A `configuration-recorded` run compares roughly one model in seven, so the
  // green tick used to appear over six thousand files nothing had looked at.
  return view.notCompared.total === 0 ? 'clean' : 'partial'
}

function headlineTextOf(view: VaultAuditView, tone: HeadlineTone): string {
  if (tone === 'empty') {
    return view.rowsInScope === 0
      ? t('vaultAudit.result.scopeMatchedNothing')
      : t('vaultAudit.result.comparedNothing', { rows: view.rowsInScope })
  }
  if (tone === 'clean') return t('vaultAudit.result.noFindings')
  if (tone === 'partial') return t('vaultAudit.result.noFindingsInCompared')
  return t('vaultAudit.result.filesWithFindings', {
    files: view.filesWithFindings,
    compared: view.filesCompared,
  })
}

export function VaultAuditOverview({ view, artifactPath }: VaultAuditOverviewProps) {
  const tone = headlineToneOf(view)
  const notRead = unreadLines(view)
  const notCompared = notComparedLines(view)
  // Only worth saying when a folder was actually asked for. On a whole-vault run that matched
  // nothing, the path is not the thing to go and check.
  const unmatchedFolderPath =
    tone === 'empty' && view.rowsInScope === 0 ? view.scopeDescription.pathPrefix : null

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {tone === 'clean' ? (
          <CheckCircle2 size={16} className="text-plm-success mt-0.5 flex-shrink-0" />
        ) : tone === 'empty' ? (
          <AlertTriangle size={16} className="text-yellow-500 mt-0.5 flex-shrink-0" />
        ) : tone === 'partial' ? (
          <CircleDashed size={16} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
        ) : (
          <FileWarning size={16} className="text-yellow-500 mt-0.5 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm text-plm-fg">{headlineTextOf(view, tone)}</p>
          {unmatchedFolderPath && (
            <p className="text-xs text-plm-fg-muted mt-1">
              {t('vaultAudit.result.folderMatchedNothing', { path: unmatchedFolderPath })}
            </p>
          )}
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
