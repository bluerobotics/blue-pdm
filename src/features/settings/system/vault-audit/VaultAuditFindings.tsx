/**
 * One category's findings, and the button that resolves them.
 *
 * This used to be a read-only list with a separate repair panel underneath it, and the two were
 * different views of overlapping data: the panel had checkboxes the list did not, over a subset of
 * the same values, with nothing on screen explaining the relationship. Selecting a category and
 * acting on it are the same task, so they are now the same section, and the repair panel is what
 * this renders when the category selected is the one it always covered.
 *
 * ## What a tick means depends on the direction, and that is not smoothed over
 *
 * The database writer works per value; the document writer is the Sync Metadata command and works
 * per file. So in a `write-to-file` category, ticking any row of a file selects that whole file,
 * and every row belonging to it ticks with it. Rendering those rows as individually selectable
 * would promise a precision the command does not have.
 *
 * ## Rows that cannot be acted on are still rows
 *
 * A category is one resolution, but not every row in it has a writer - a recoverable value in a
 * column rather than in a reserved map has nowhere to go until something writes columns. Those
 * stay in the table with no checkbox and a line saying why, rather than being filtered out, so the
 * count on the category card and the count in the table agree.
 */

import { useMemo, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import type { VaultAuditCategoryKind, VaultAuditFinding } from '@/types/vaultAudit'

import { rangeBetween } from './repairSelection'
import { VaultAuditConflictActionBar } from './VaultAuditConflictActionBar'
import { useVaultAuditPush } from './useVaultAuditPush'
import { useVaultAuditConflict } from './useVaultAuditConflict'
import { useVaultAuditRepair } from './useVaultAuditRepair'
import { VaultAuditActionBar } from './VaultAuditActionBar'
import { VaultAuditFindingsTable, type VaultAuditFindingRow } from './VaultAuditFindingsTable'
import { actionForFinding, categoryDirectionOf, repairCandidateIdOf } from './vaultAuditActions'
import { compareForDisplay } from './valueDifference'

interface VaultAuditFindingsProps {
  findings: VaultAuditFinding[]
  kind: VaultAuditCategoryKind | null
}

/**
 * Rows rendered before the list is truncated.
 *
 * A vault-wide scan can produce thousands of values, and a table that long is neither readable nor
 * cheap. The filter box narrows it; the full set is in the JSON artifact. Selection is applied to
 * the rows on screen only, so what the button writes is always what the admin could see.
 */
const MAX_ROWS = 200

function matches(finding: VaultAuditFinding, needle: string): boolean {
  if (!needle) return true
  const haystack = [
    finding.relativePath,
    finding.configuration ?? '',
    finding.databaseValue ?? '',
    finding.fileValue ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export function VaultAuditFindings({ findings, kind }: VaultAuditFindingsProps) {
  const [filter, setFilter] = useState('')
  const anchorId = useRef<string | null>(null)

  const repair = useVaultAuditRepair()
  const push = useVaultAuditPush(findings)
  const conflict = useVaultAuditConflict(findings)
  const {
    blockedReasonFor,
    canAdoptFileValue,
    selectedFindingIds: selectedConflictIds,
    settledFindingIds: settledConflictIds,
  } = conflict

  // The proposal decides what may be written into a reserved map, and it knows two things a
  // finding does not: whether the row already carries a key for that configuration, and whether
  // derived tabs are being offered. Reduced to a set of ids so the table can ask per row.
  const repairable = useMemo(
    () => new Set(repair.candidates.map((candidate) => candidate.id)),
    [repair.candidates],
  )

  const inCategory = useMemo(
    () => (kind ? findings.filter((finding) => finding.kind === kind) : []),
    [findings, kind],
  )

  // The direction, not the availability. A category whose every file is checked out to a colleague
  // still writes into files, and the action bar has to say so rather than going blank.
  const action = useMemo(() => categoryDirectionOf(inCategory), [inCategory])

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return inCategory.filter((finding) => matches(finding, needle))
  }, [inCategory, filter])

  const rows = useMemo<VaultAuditFindingRow[]>(() => {
    return filtered.slice(0, MAX_ROWS).map((finding) => {
      const rowAction = actionForFinding(finding, repairable, push.heldByOthers)
      const candidateId = repairCandidateIdOf(finding)
      const isConflict = finding.resolution === 'choose-a-side'
      const toVault = !isConflict && rowAction.available && rowAction.kind === 'write-to-vault'
      const selectionId = toVault && candidateId ? candidateId : finding.fileId
      const fileChoiceBlockedReason = blockedReasonFor(finding)

      return {
        finding,
        action: rowAction,
        selectionId,
        selected: isConflict
          ? push.selectedFileIds.has(finding.fileId) || selectedConflictIds.has(finding.id)
          : toVault
            ? repair.selectedIds.has(selectionId)
            : push.selectedFileIds.has(selectionId),
        settled: isConflict
          ? push.writtenFileIds.has(finding.fileId) || settledConflictIds.has(finding.id)
          : toVault
            ? repair.settledIds.has(selectionId)
            : push.writtenFileIds.has(selectionId),
        comparison: compareForDisplay(finding.databaseValue, finding.fileValue),
        availability: push.availability.get(finding.fileId) ?? null,
        conflict: isConflict
          ? {
              useBluePlm: {
                available: finding.field !== 'revision' && !push.heldByOthers.has(finding.fileId),
                selected: push.selectedFileIds.has(finding.fileId),
                settled: push.writtenFileIds.has(finding.fileId),
                reason: push.heldByOthers.has(finding.fileId)
                  ? t('vaultAudit.blocked.heldByAnotherUser')
                  : null,
              },
              useFile: {
                available: canAdoptFileValue(finding),
                selected: selectedConflictIds.has(finding.id),
                settled: settledConflictIds.has(finding.id),
                reason: fileChoiceBlockedReason ? t('vaultAudit.blocked.fileNotLoaded') : null,
              },
            }
          : null,
      }
    })
  }, [
    blockedReasonFor,
    canAdoptFileValue,
    selectedConflictIds,
    settledConflictIds,
    filtered,
    repairable,
    repair.selectedIds,
    repair.settledIds,
    push.selectedFileIds,
    push.writtenFileIds,
    push.heldByOthers,
    push.availability,
  ])

  const selectable = useMemo(
    () =>
      rows.filter(
        (row) => row.finding.resolution !== 'choose-a-side' && row.action.available && !row.settled,
      ),
    [rows],
  )

  // Counted in the unit the button writes in. A document write ticks whole files, and several rows
  // of one file are one thing being selected - offering to "select all 42" and then writing twelve
  // files would be describing the click by what was clicked rather than by what happens.
  const selectableUnits = useMemo(
    () => new Set(selectable.map((row) => row.selectionId)).size,
    [selectable],
  )

  const busy = repair.applying || push.running || conflict.applying

  const applySelection = (targets: readonly VaultAuditFindingRow[], selected: boolean) => {
    const toVault = targets.filter(
      (row) => row.action.available && row.action.kind === 'write-to-vault',
    )
    const toFile = targets.filter(
      (row) => row.action.available && row.action.kind === 'write-to-file',
    )

    if (toVault.length > 0) {
      repair.setMany(
        toVault.map((row) => row.selectionId),
        selected,
      )
    }
    if (toFile.length > 0) {
      push.setManyFiles(
        toFile.map((row) => row.selectionId),
        selected,
      )
    }
  }

  const handleToggle = (row: VaultAuditFindingRow, shiftKey: boolean) => {
    const selected = !row.selected

    if (shiftKey) {
      const span = rangeBetween(
        rows.map((candidate) => candidate.finding.id),
        anchorId.current,
        row.finding.id,
      )
      if (span) {
        const spanIds = new Set(span)
        applySelection(
          rows.filter(
            (candidate) =>
              spanIds.has(candidate.finding.id) &&
              candidate.finding.resolution !== 'choose-a-side' &&
              candidate.action.available &&
              !candidate.settled,
          ),
          selected,
        )
        anchorId.current = row.finding.id
        return
      }
    }

    applySelection([row], selected)
    anchorId.current = row.finding.id
  }

  const handleConflictChoice = (
    row: VaultAuditFindingRow,
    direction: 'write-to-file' | 'write-to-vault',
  ) => {
    if (!row.conflict) return

    if (direction === 'write-to-file') {
      if (row.finding.field === 'revision') return
      const selected = row.conflict.useBluePlm.selected
      const fileConflictIds = inCategory
        .filter(
          (finding) =>
            finding.resolution === 'choose-a-side' && finding.fileId === row.finding.fileId,
        )
        .map((finding) => finding.id)
      conflict.setMany(fileConflictIds, false)
      push.setManyFiles([row.finding.fileId], !selected)
      return
    }

    const selected = row.conflict.useFile.selected
    push.setManyFiles([row.finding.fileId], false)
    conflict.setMany([row.finding.id], !selected)
  }

  if (!kind) {
    return <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.selectPrompt')}</p>
  }

  const allSelected = selectable.length > 0 && selectable.every((row) => row.selected)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.findings.heading')}</h3>
        <input
          type="text"
          value={filter}
          placeholder={t('vaultAudit.findings.filterPlaceholder')}
          onChange={(event) => setFilter(event.target.value)}
          className="w-64 px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg outline-none focus:border-plm-accent"
        />
      </div>

      <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.directionNote')}</p>

      {inCategory.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.none')}</p>
      )}

      {inCategory.length > 0 && filtered.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.noMatches')}</p>
      )}

      {rows.length > 0 && (
        <>
          {selectable.length > 0 && (
            <button
              onClick={() => applySelection(selectable, !allSelected)}
              disabled={busy}
              className="text-xs text-plm-accent hover:underline disabled:opacity-40"
            >
              {allSelected
                ? t('vaultAudit.findings.selectNone', { count: selectableUnits })
                : t('vaultAudit.findings.selectAll', {
                    count: selectableUnits,
                    unit:
                      action === 'write-to-file'
                        ? t('vaultAudit.findings.unitFiles')
                        : t('vaultAudit.findings.unitValues'),
                  })}
            </button>
          )}

          <VaultAuditFindingsTable
            rows={rows}
            totalMatching={filtered.length}
            disabled={busy}
            onToggle={handleToggle}
            onChooseConflict={handleConflictChoice}
          />

          <div className="pt-2">
            {kind === 'conflicting' ? (
              <VaultAuditConflictActionBar conflict={conflict} push={push} />
            ) : (
              <VaultAuditActionBar action={action} repair={repair} push={push} />
            )}
          </div>
        </>
      )}
    </section>
  )
}
