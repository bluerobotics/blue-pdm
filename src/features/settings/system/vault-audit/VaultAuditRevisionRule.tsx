/**
 * The one convention the audit cannot work out for itself.
 *
 * Some shops expect a part's revision property to be present in the model file; others have the
 * drawing carry it and the model never states one. On the second kind of vault every model in the
 * database holds a revision, no model file holds one, and the audit reports that as several hundred
 * documents standing behind their records — the largest category on the page, and every row of it
 * noise.
 *
 * Both conventions are legitimate, so this asks rather than guessing, and defaults to the drawing
 * because that is the more common arrangement and the more expensive one to get wrong: guessing
 * the other way puts a real finding in front of someone who can dismiss it, while this way round
 * the mistake is a finding for a document that is intentionally not expected to carry one. Either
 * way, revision remains driven by the file whenever the file carries it.
 *
 * ## Why the count is always on screen
 *
 * A filter with no visible effect is how a page comes to show a reassuring number over values it
 * decided not to mention, which is the failure the whole audit exists to avoid. The excluded count
 * is printed whenever it is not zero, in the same place as the control that produced it.
 */

import { GitBranch } from 'lucide-react'

import { t } from '@/lib/i18n'

interface VaultAuditRevisionRuleProps {
  expectRevisionOnModels: boolean
  /** Comparisons left out by the current setting. Zero when they are being shown. */
  hiddenCount: number
  onChange: (expect: boolean) => void
}

export function VaultAuditRevisionRule({
  expectRevisionOnModels,
  hiddenCount,
  onChange,
}: VaultAuditRevisionRuleProps) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
      <GitBranch size={14} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
      <div className="space-y-1.5 min-w-0">
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={expectRevisionOnModels}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-0.5 accent-plm-accent"
          />
          <span>
            <span className="text-plm-fg block">{t('vaultAudit.revisionRule.label')}</span>
            <span className="text-plm-fg-muted block">{t('vaultAudit.revisionRule.hint')}</span>
          </span>
        </label>

        {hiddenCount > 0 && (
          <p className="text-xs text-plm-fg-muted">
            {t('vaultAudit.revisionRule.hidden', { count: hiddenCount })}
          </p>
        )}
      </div>
    </div>
  )
}
