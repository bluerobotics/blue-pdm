/**
 * Repair: the half of the Vault Audit that writes.
 *
 * Everything above it on the page reads. This section takes the scan's own findings, shows every
 * value it would write, and writes only the ones the administrator ticks - through a database
 * function whose merge can add a configuration entry and can do nothing else.
 *
 * The guarantee is stated at the top of the section rather than buried in a confirmation. It is
 * not reassurance: it is the reason a bulk write to production metadata is a reasonable thing to
 * offer at all, and the administrator should be able to check it against what the receipt says
 * afterwards.
 */

import { AlertTriangle, Check, Database, Loader2, ShieldCheck, Sparkles } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditRepairOutcome } from '@/types/vaultAudit'

import { describeShortfall } from './repairReceipt'
import { useVaultAuditRepair } from './useVaultAuditRepair'
import { VaultAuditRepairTable } from './VaultAuditRepairTable'

function Receipt({ outcome }: { outcome: VaultAuditRepairOutcome }) {
  // Broken out by reason rather than reported as one number. Fewer entries landing than were asked
  // for is the normal result of applying against a row that has moved on - but it is also what an
  // unreachable file looks like, and this panel used to describe both as "already there".
  const shortfall = describeShortfall(outcome)
  const refused = outcome.files.filter((file) => file.refused !== null)

  return (
    <div className="p-3 rounded-md border border-plm-border bg-plm-bg-lighter space-y-1.5">
      <p className="text-sm text-plm-fg flex items-center gap-1.5">
        <Check size={14} className="text-plm-success flex-shrink-0" />
        {t('vaultAudit.repair.receiptHeading', {
          entries: outcome.entriesAdded,
          files: outcome.filesUpdated,
        })}
      </p>
      {shortfall.alreadyPresent > 0 && (
        <p className="text-xs text-plm-fg-muted">
          {t('vaultAudit.repair.receiptShortfall', {
            count: shortfall.alreadyPresent,
            requested: outcome.entriesRequested,
          })}
        </p>
      )}
      {shortfall.noRecord > 0 && (
        <p className="text-xs text-plm-fg-muted">
          {t('vaultAudit.repair.receiptNoRecord', { count: shortfall.noRecord })}
        </p>
      )}
      {refused.length > 0 && (
        <p className="text-xs text-plm-warning flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            {t('vaultAudit.repair.receiptRefused', { count: refused.length })}
            {shortfall.unreachable > 0 && (
              <> {t('vaultAudit.repair.receiptEntriesDropped', { count: shortfall.unreachable })}</>
            )}
          </span>
        </p>
      )}
    </div>
  )
}

export function VaultAuditRepair() {
  const repair = useVaultAuditRepair()

  if (repair.notInstalled) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.repair.heading')}</h3>
        <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
          <Database size={14} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
          <p className="text-sm text-plm-fg-muted">{t('vaultAudit.repair.notInstalled')}</p>
        </div>
      </section>
    )
  }

  const nothingToDo = repair.available.entries === 0 && !repair.includeDerivedTabs

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.repair.heading')}</h3>
        <p className="text-xs text-plm-fg-muted mt-0.5">{t('vaultAudit.repair.description')}</p>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
        <ShieldCheck size={14} className="text-plm-success mt-0.5 flex-shrink-0" />
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.repair.guarantee')}</p>
      </div>

      {nothingToDo ? (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.repair.nothingToRepair')}</p>
      ) : (
        <>
          <p className="text-sm text-plm-fg">
            {t('vaultAudit.repair.available', {
              entries: repair.available.entries,
              files: repair.available.files,
            })}
            {repair.available.derived > 0 && (
              <span className="text-plm-fg-muted">
                {' '}
                {t('vaultAudit.repair.availableSplit', {
                  recovered: repair.available.recovered,
                  derived: repair.available.derived,
                })}
              </span>
            )}
          </p>

          <label className="flex items-start gap-2 text-xs text-plm-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={repair.includeDerivedTabs}
              disabled={repair.applying}
              onChange={(event) => repair.setIncludeDerivedTabs(event.target.checked)}
              className="mt-0.5 accent-plm-accent"
            />
            <span>
              <span className="text-plm-fg inline-flex items-center gap-1">
                <Sparkles size={11} className="text-plm-warning" />
                {t('vaultAudit.repair.includeDerived')}
              </span>
              <span className="block">{t('vaultAudit.repair.includeDerivedHint')}</span>
            </span>
          </label>

          <VaultAuditRepairTable
            candidates={repair.candidates}
            selectedIds={repair.selectedIds}
            disabled={repair.applying}
            onToggle={repair.toggle}
            onSetMany={repair.setMany}
          />

          {repair.error && (
            <p className="text-sm text-plm-error flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {repair.error}
            </p>
          )}

          {repair.outcome && <Receipt outcome={repair.outcome} />}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-plm-fg-muted">
              {repair.selected.entries === 0
                ? t('vaultAudit.repair.selectPrompt')
                : t('vaultAudit.repair.selectedSummary', {
                    entries: repair.selected.entries,
                    files: repair.selected.files,
                    derived: repair.selected.derived,
                  })}
            </p>
            <button
              onClick={() => void repair.apply()}
              disabled={!repair.canApply}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-bg bg-plm-accent hover:bg-plm-accent/90 rounded-md transition-colors disabled:opacity-40 flex-shrink-0"
            >
              {repair.applying ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              {repair.applying
                ? t('vaultAudit.repair.applying')
                : t('vaultAudit.repair.apply', { count: repair.selected.entries })}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
