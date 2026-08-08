/**
 * The findings table.
 *
 * Presentational: it renders rows and reports clicks. Which rows may be ticked, what a tick means
 * and what happens when the button is pressed are all decided in `VaultAuditFindings`, because
 * they depend on which of the two writers covers the row and this component should not have an
 * opinion about that.
 *
 * ## Two things this table does differently from an ordinary list
 *
 * **The value columns are built around the difference, not around the start of the string.** Two
 * descriptions that share their first thirty characters used to render as two identical truncated
 * cells, which made the conflict category unreadable and therefore unanswerable. The shared ends
 * are trimmed to a little context, the differing span is highlighted, and the full value is on the
 * title attribute.
 *
 * **A row with no checkbox says why.** An empty cell where other rows have a control reads as an
 * oversight; the reason is in the resolution column, which is where the row already explains
 * itself.
 */

import { ArrowLeft, ArrowRight, Check, ExternalLink } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import type { VaultAuditActionKind, VaultAuditRowAction } from './vaultAuditActions'
import type { VaultAuditFileAvailability } from './vaultAuditFileState'
import {
  isTrivialDifference,
  type ValueComparisonDisplay,
  type ValueSegments,
} from './valueDifference'
import {
  blockedReasonLabel,
  differenceLabel,
  fieldLabel,
  resolutionDirection,
  resolutionHint,
  resolutionLabel,
  unattributedReasonLabel,
} from './vaultAuditLabels'
import { useRevealInFileBrowser } from './useRevealInFileBrowser'

/** One finding, with everything the table needs to draw it already decided. */
export interface VaultAuditFindingRow {
  finding: VaultAuditFinding
  action: VaultAuditRowAction
  /** What ticking this row adds to: a value for a database write, a file for a document write. */
  selectionId: string
  selected: boolean
  /** Already written by an apply in this session. Shown, but not offered again. */
  settled: boolean
  /** Null when one side holds nothing, so there is no difference to point at. */
  comparison: ValueComparisonDisplay | null
  /** Who can write this file today. Null for a finding whose file is not in the loaded list. */
  availability: VaultAuditFileAvailability | null
  /** The two explicit choices shown for a conflict row. */
  conflict: {
    useBluePlm: ConflictOption
    useFile: ConflictOption
  } | null
}

export interface ConflictOption {
  available: boolean
  selected: boolean
  settled: boolean
  reason: string | null
}

interface VaultAuditFindingsTableProps {
  rows: VaultAuditFindingRow[]
  /** Rows beyond the render cap, so the footer can say what is not shown. */
  totalMatching: number
  disabled: boolean
  onToggle: (row: VaultAuditFindingRow, shiftKey: boolean) => void
  onChooseConflict: (row: VaultAuditFindingRow, direction: VaultAuditActionKind) => void
}

function ValueCell({ value, segments }: { value: string | null; segments: ValueSegments | null }) {
  if (value === null) {
    return <span className="text-plm-fg-muted/50">{t('vaultAudit.findings.empty')}</span>
  }

  if (!segments) {
    return (
      <span className="text-plm-fg break-words" title={value}>
        {value}
      </span>
    )
  }

  return (
    <span className="text-plm-fg-muted break-words" title={value}>
      {segments.elidedStart && '…'}
      {segments.head}
      {/* One value being a prefix of the other leaves nothing to highlight, and an unmarked cell
          would read as no difference at all. The marker stands in for the missing span. */}
      {segments.middle === '' ? (
        <mark className="inline-block w-1 h-3 align-middle bg-plm-warning/50 rounded-sm" />
      ) : (
        <mark className="bg-plm-warning/25 text-plm-fg rounded-sm px-0.5">{segments.middle}</mark>
      )}
      {segments.tail}
      {segments.elidedEnd && '…'}
    </span>
  )
}

/**
 * Naming the colleague where the row knows the name.
 *
 * "Someone else has it" tells the reader the row is blocked and nothing about what to do next;
 * a name is what turns it into a message they can act on.
 */
function heldByLabel(availability: VaultAuditFileAvailability | null): string {
  const holder = availability?.state === 'held-by-other' ? availability.holder : null
  return holder
    ? t('vaultAudit.blocked.heldBy', { user: holder })
    : t('vaultAudit.blocked.heldByAnotherUser')
}

function DirectionCell({ finding }: { finding: VaultAuditFinding }) {
  const direction = resolutionDirection(finding.resolution)
  if (!direction) return null

  const Icon = direction === 'file-to-vault' ? ArrowLeft : ArrowRight
  return (
    <span
      className="flex justify-center text-plm-accent"
      title={resolutionHint(finding.resolution)}
    >
      <Icon size={12} />
    </span>
  )
}

export function VaultAuditFindingsTable({
  rows,
  totalMatching,
  disabled,
  onToggle,
  onChooseConflict,
}: VaultAuditFindingsTableProps) {
  const { resolve, reveal } = useRevealInFileBrowser()

  return (
    <>
      <div className="border border-plm-border rounded-md overflow-hidden">
        <table className="w-full text-xs table-fixed">
          <thead className="bg-plm-bg-lighter text-plm-fg-muted">
            <tr>
              <th className="w-8" />
              <th className="text-left font-normal px-2 py-1.5 w-1/5">
                {t('vaultAudit.findings.columnFile')}
              </th>
              <th className="text-left font-normal px-2 py-1.5 w-24">
                {t('vaultAudit.findings.columnConfiguration')}
              </th>
              <th className="text-left font-normal px-2 py-1.5 w-24">
                {t('vaultAudit.findings.columnField')}
              </th>
              <th className="text-left font-normal px-2 py-1.5">
                {t('vaultAudit.findings.columnDatabase')}
              </th>
              <th className="w-6" />
              <th className="text-left font-normal px-2 py-1.5">
                {t('vaultAudit.findings.columnFile2')}
              </th>
              <th className="text-left font-normal px-2 py-1.5 w-40">
                {t('vaultAudit.findings.columnResolution')}
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { finding } = row
              const isConflict = finding.resolution === 'choose-a-side'
              const localPath = resolve(finding.relativePath)
              const trivialNote =
                row.comparison && isTrivialDifference(row.comparison.kind)
                  ? differenceLabel(row.comparison.kind)
                  : null

              return (
                <tr key={finding.id} className="border-t border-plm-border/60 align-top">
                  <td className="px-2 py-1.5">
                    {row.settled ? (
                      <Check
                        size={12}
                        className="text-plm-success"
                        aria-label={t('vaultAudit.findings.settled')}
                      />
                    ) : !isConflict && row.action.available ? (
                      <input
                        type="checkbox"
                        checked={row.selected}
                        disabled={disabled}
                        onChange={() => undefined}
                        onClick={(event) => onToggle(row, event.shiftKey)}
                        className="accent-plm-accent"
                        aria-label={resolutionLabel(finding.resolution)}
                      />
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-plm-fg truncate">
                    <span title={finding.relativePath}>{finding.relativePath}</span>
                  </td>
                  <td className="px-2 py-1.5 text-plm-fg-muted truncate">
                    {finding.configuration ?? t('vaultAudit.findings.fileScope')}
                  </td>
                  <td className="px-2 py-1.5 text-plm-fg-muted">
                    {fieldLabel(finding.field)}
                    {finding.unattributedReason && (
                      <span className="block text-plm-fg-muted/70">
                        {unattributedReasonLabel(finding.unattributedReason)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <ValueCell
                      value={finding.databaseValue}
                      segments={row.comparison?.database ?? null}
                    />
                  </td>
                  <td className="py-1.5">
                    <DirectionCell finding={finding} />
                  </td>
                  <td className="px-2 py-1.5">
                    <ValueCell value={finding.fileValue} segments={row.comparison?.file ?? null} />
                  </td>
                  <td className="px-2 py-1.5 text-plm-fg">
                    <span title={resolutionHint(finding.resolution)}>
                      {resolutionLabel(finding.resolution)}
                    </span>
                    {isConflict && row.conflict && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {finding.field !== 'revision' && (
                          <button
                            type="button"
                            onClick={() => onChooseConflict(row, 'write-to-file')}
                            disabled={
                              disabled ||
                              row.conflict.useBluePlm.settled ||
                              !row.conflict.useBluePlm.available
                            }
                            aria-pressed={row.conflict.useBluePlm.selected}
                            title={
                              row.conflict.useBluePlm.reason ??
                              t('vaultAudit.resolution.pushVaultValueHint')
                            }
                            className={`px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                              row.conflict.useBluePlm.selected
                                ? 'border-plm-accent bg-plm-accent/20 text-plm-accent'
                                : 'border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
                            }`}
                          >
                            {t('vaultAudit.conflict.useBluePlm')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onChooseConflict(row, 'write-to-vault')}
                          disabled={
                            disabled ||
                            row.conflict.useFile.settled ||
                            !row.conflict.useFile.available
                          }
                          aria-pressed={row.conflict.useFile.selected}
                          title={
                            row.conflict.useFile.reason ??
                            t('vaultAudit.resolution.adoptFileValueHint')
                          }
                          className={`px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
                            row.conflict.useFile.selected
                              ? 'border-plm-accent bg-plm-accent/20 text-plm-accent'
                              : 'border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
                          }`}
                        >
                          {t('vaultAudit.conflict.useFile')}
                        </button>
                      </div>
                    )}
                    {!row.action.available && (
                      <span className="block text-plm-fg-muted/70">
                        {row.action.reason === 'held-by-another-user'
                          ? heldByLabel(row.availability)
                          : blockedReasonLabel(row.action.reason)}
                      </span>
                    )}
                    {trivialNote && (
                      <span className="block text-plm-warning/80">{trivialNote}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => reveal(finding.relativePath)}
                        disabled={!localPath}
                        title={
                          localPath
                            ? t('vaultAudit.findings.reveal')
                            : t('vaultAudit.findings.revealUnavailable')
                        }
                        className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-plm-fg-muted">
        {t('vaultAudit.findings.showing', { shown: rows.length, total: totalMatching })}
        {rows.length > 1 &&
          rows.some(
            (row) => row.finding.resolution !== 'choose-a-side' && row.action.available,
          ) && <> {t('vaultAudit.findings.rangeHint')}</>}
      </p>
    </>
  )
}
