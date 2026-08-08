import { AlertTriangle, Check, FileUp, Loader2 } from 'lucide-react'

import { t } from '@/lib/i18n'

import type { UseVaultAuditConflictResult } from './useVaultAuditConflict'
import type { UseVaultAuditPushResult } from './useVaultAuditPush'

interface VaultAuditConflictActionBarProps {
  conflict: UseVaultAuditConflictResult
  push: UseVaultAuditPushResult
}

/**
 * The two writes a conflict can mean, kept side by side so the final click repeats the choice.
 *
 * The document side is still per file, while the database side is per finding. That difference is
 * shown in the two counts instead of making a row button look like it has a narrower effect than
 * the writer actually has.
 */
export function VaultAuditConflictActionBar({ conflict, push }: VaultAuditConflictActionBarProps) {
  const busy = conflict.applying || push.running
  const selectedFiles = push.eligibility.selected

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.conflict.instruction')}</p>
      </div>

      {conflict.error && (
        <p className="text-sm text-plm-error flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {conflict.error}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-plm-fg-muted">
            {conflict.selectedCount === 0
              ? t('vaultAudit.conflict.fileSelectPrompt')
              : t('vaultAudit.conflict.fileSelectedSummary', {
                  values: conflict.selectedCount,
                })}
          </p>
          <button
            type="button"
            onClick={() => void conflict.apply()}
            disabled={busy || !conflict.canApply}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-bg bg-plm-accent hover:bg-plm-accent/90 rounded-md transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {conflict.applying ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
            {conflict.applying
              ? t('vaultAudit.conflict.applying')
              : t('vaultAudit.conflict.applyFile', { count: conflict.selectedCount })}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-plm-fg-muted">
            {selectedFiles === 0
              ? t('vaultAudit.conflict.bluePlmSelectPrompt')
              : t('vaultAudit.conflict.bluePlmSelectedSummary', { files: selectedFiles })}
          </p>
          <button
            type="button"
            onClick={() => void push.run()}
            disabled={busy || !push.canRun}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-bg bg-plm-accent hover:bg-plm-accent/90 rounded-md transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {push.running ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
            {push.running
              ? t('vaultAudit.push.running')
              : t('vaultAudit.conflict.applyBluePlm', { files: push.eligibility.eligible.length })}
          </button>
        </div>
      </div>

      <p className="text-xs text-plm-fg-muted">{t('vaultAudit.conflict.bluePlmNote')}</p>
    </div>
  )
}
