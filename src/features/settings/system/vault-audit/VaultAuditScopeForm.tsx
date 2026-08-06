import { Loader2, Play, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditScope, VaultAuditScopeKind } from '@/types/vaultAudit'

interface VaultAuditScopeFormProps {
  scope: VaultAuditScope
  onScopeChange: (scope: VaultAuditScope) => void
  isRunning: boolean
  /** A vault is connected. False shows the "connect a vault" hint next to the button. */
  canScan: boolean
  /**
   * Something other than a missing vault prevents a run - today, a SolidWorks service too old to
   * answer the audit's read command. The reason is stated above the form, so the button only has
   * to stop being clickable.
   */
  blocked: boolean
  cancelRequested: boolean
  hasResult: boolean
  onStart: () => void
  onCancel: () => void
}

interface ScopeOption {
  kind: VaultAuditScopeKind
  label: string
  hint: string
}

function scopeOptions(): ScopeOption[] {
  return [
    {
      kind: 'configuration-recorded',
      label: t('vaultAudit.scope.configurationRecorded'),
      hint: t('vaultAudit.scope.configurationRecordedHint'),
    },
    {
      kind: 'folder',
      label: t('vaultAudit.scope.folder'),
      hint: t('vaultAudit.scope.folderHint'),
    },
    {
      kind: 'whole-vault',
      label: t('vaultAudit.scope.wholeVault'),
      hint: t('vaultAudit.scope.wholeVaultHint'),
    },
  ]
}

export function VaultAuditScopeForm({
  scope,
  onScopeChange,
  isRunning,
  canScan,
  blocked,
  cancelRequested,
  hasResult,
  onStart,
  onCancel,
}: VaultAuditScopeFormProps) {
  return (
    <div className="space-y-4">
      <fieldset disabled={isRunning} className="space-y-2">
        <legend className="text-sm font-medium text-plm-fg mb-2">
          {t('vaultAudit.scope.legend')}
        </legend>

        {scopeOptions().map((option) => (
          <label
            key={option.kind}
            className={`flex gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
              scope.kind === option.kind
                ? 'border-plm-accent bg-plm-highlight'
                : 'border-plm-border hover:bg-plm-bg-lighter'
            } ${isRunning ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="vault-audit-scope"
              className="mt-1 accent-plm-accent"
              checked={scope.kind === option.kind}
              onChange={() => onScopeChange({ ...scope, kind: option.kind })}
            />
            <div className="min-w-0">
              <div className="text-sm text-plm-fg">{option.label}</div>
              <p className="text-xs text-plm-fg-muted mt-0.5">{option.hint}</p>
              {option.kind === 'folder' && scope.kind === 'folder' && (
                <input
                  type="text"
                  value={scope.folderPath}
                  placeholder={t('vaultAudit.scope.folderPlaceholder')}
                  onChange={(event) =>
                    onScopeChange({ kind: 'folder', folderPath: event.target.value })
                  }
                  className="mt-2 w-full px-2 py-1 text-xs font-mono bg-plm-bg border border-plm-border rounded text-plm-fg outline-none focus:border-plm-accent"
                />
              )}
            </div>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        {isRunning ? (
          <button
            onClick={onCancel}
            disabled={cancelRequested}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-plm-fg bg-plm-bg-lighter hover:bg-plm-bg-light border border-plm-border rounded-md transition-colors disabled:opacity-50"
          >
            <X size={14} />
            {cancelRequested ? t('vaultAudit.cancelling') : t('vaultAudit.cancel')}
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={!canScan || blocked}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-plm-fg bg-plm-accent/20 hover:bg-plm-accent/30 border border-plm-accent rounded-md transition-colors disabled:opacity-50"
          >
            <Play size={14} />
            {hasResult ? t('vaultAudit.rescan') : t('vaultAudit.scan')}
          </button>
        )}

        {isRunning && <Loader2 size={14} className="animate-spin text-plm-fg-muted" />}
        {!canScan && <span className="text-xs text-plm-fg-muted">{t('vaultAudit.noVault')}</span>}
      </div>
    </div>
  )
}
