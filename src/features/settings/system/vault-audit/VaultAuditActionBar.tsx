/**
 * The button for whatever the selected category resolves as, and everything that has to be said
 * before it is pressed.
 *
 * There is one bar rather than one control per row because a category is a single direction, and
 * because both writers behind it are batch operations - a per-row button would be a click per
 * value with no way to see the whole set first, which is the argument that removed the per-row
 * repair button in the first place.
 *
 * The two directions are not symmetrical and the bar does not pretend they are.
 *
 * **Into the database** is bounded by the SQL behind it: the merge is `computed || existing` in a
 * `SECURITY DEFINER` function, so it can add a configuration entry and cannot overwrite one. That
 * guarantee is stated above the button rather than in a confirmation, because it is the reason a
 * bulk write to production metadata is a reasonable thing to offer, and it should be checkable
 * against the receipt afterwards.
 *
 * **Into the file** is the Sync Metadata command, which rebuilds every BluePLM-owned property except
 * file-driven revision in the documents it is given and will only touch a file that is local-only or
 * checked out by you. Both facts are stated before the click: the first because ticking one
 * description and changing a part number would otherwise be a surprise, and the second because a
 * vault-wide audit routinely selects hundreds of files of which almost none are checked out, and a
 * run that quietly processed the eligible eighth would leave the vault looking done.
 */

import {
  AlertTriangle,
  Check,
  Database,
  FileUp,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditRepairOutcome } from '@/types/vaultAudit'

import { describeShortfall } from './repairReceipt'
import type { UseVaultAuditPushResult } from './useVaultAuditPush'
import type { UseVaultAuditRepairResult } from './useVaultAuditRepair'
import type { VaultAuditActionKind } from './vaultAuditActions'

interface VaultAuditActionBarProps {
  /** What this category's rows resolve as, or null when none of them can be acted on. */
  action: VaultAuditActionKind | null
  repair: UseVaultAuditRepairResult
  push: UseVaultAuditPushResult
}

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

function WriteToVaultBar({ repair }: { repair: UseVaultAuditRepairResult }) {
  if (repair.notInstalled) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
        <Database size={14} className="text-plm-fg-muted mt-0.5 flex-shrink-0" />
        <p className="text-sm text-plm-fg-muted">{t('vaultAudit.repair.notInstalled')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
        <ShieldCheck size={14} className="text-plm-success mt-0.5 flex-shrink-0" />
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.repair.guarantee')}</p>
      </div>

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

      {repair.error && (
        <p className="text-sm text-plm-error flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {repair.error}
        </p>
      )}

      {repair.outcome && <Receipt outcome={repair.outcome} />}

      <div className="flex items-center justify-between gap-3">
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
          {repair.applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {repair.applying
            ? t('vaultAudit.repair.applying')
            : t('vaultAudit.repair.apply', { count: repair.selected.entries })}
        </button>
      </div>
    </div>
  )
}

function WriteToFileBar({ push }: { push: UseVaultAuditPushResult }) {
  const { eligibility } = push

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-md border border-plm-border bg-plm-bg-lighter">
        <FileUp size={14} className="text-plm-accent mt-0.5 flex-shrink-0" />
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.push.wholeFileNote')}</p>
      </div>

      {push.heldByOthers.size > 0 && (
        <p className="text-xs text-plm-fg-muted flex items-start gap-1.5">
          <Lock size={13} className="mt-0.5 flex-shrink-0" />
          {t('vaultAudit.push.heldByOthers', { count: push.heldByOthers.size })}
        </p>
      )}

      {eligibility.selected > 0 && (
        <div className="text-xs space-y-1">
          <p className="text-plm-fg">
            {t('vaultAudit.push.eligible', {
              eligible: eligibility.eligible.length,
              selected: eligibility.selected,
            })}
          </p>
          {/* Separated from the lock above because this one is yours to clear: these files are in
              BluePLM and nobody is holding them, so a checkout makes them writable. */}
          {eligibility.tally.notCheckedOut > 0 && (
            <p className="text-plm-warning flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              {t('vaultAudit.push.notCheckedOut', { count: eligibility.tally.notCheckedOut })}
            </p>
          )}
          {eligibility.tally.notLoaded > 0 && (
            <p className="text-plm-fg-muted">
              {t('vaultAudit.push.notLoaded', { count: eligibility.tally.notLoaded })}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-plm-fg-muted">
          {eligibility.selected === 0
            ? t('vaultAudit.push.selectPrompt')
            : t('vaultAudit.push.selectedSummary', { files: eligibility.selected })}
        </p>
        <button
          onClick={() => void push.run()}
          disabled={!push.canRun}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-plm-bg bg-plm-accent hover:bg-plm-accent/90 rounded-md transition-colors disabled:opacity-40 flex-shrink-0"
        >
          {push.running ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
          {push.running
            ? t('vaultAudit.push.running')
            : t('vaultAudit.push.apply', { count: eligibility.eligible.length })}
        </button>
      </div>
    </div>
  )
}

export function VaultAuditActionBar({ action, repair, push }: VaultAuditActionBarProps) {
  if (action === null) {
    return <p className="text-xs text-plm-fg-muted">{t('vaultAudit.actions.noneAvailable')}</p>
  }
  if (action === 'write-to-vault') return <WriteToVaultBar repair={repair} />
  return <WriteToFileBar push={push} />
}
