/**
 * The preview: every value that would be written, before anything is.
 *
 * Four columns because four things have to be true before an administrator can approve a write -
 * which file, which configuration, which field, and what string. A confirmation dialog that says
 * "repair 134 entries?" answers none of them.
 *
 * Derived rows are marked in place rather than filed in a separate table. Keeping them in one list
 * is what makes the ratio visible: an approval that is mostly reconstruction should look different
 * from one that is mostly recovery, and it cannot if the two are on separate screens.
 */

import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditRepairCandidate } from '@/types/vaultAudit'

import { fieldLabel } from './vaultAuditLabels'

/**
 * Rows rendered before the list is truncated.
 *
 * A vault-wide repair can propose thousands of entries. The filter narrows it, and select-all acts
 * on everything the filter matches rather than on what happens to be rendered - so a truncated
 * view never means a truncated approval.
 */
const MAX_ROWS = 200

interface VaultAuditRepairTableProps {
  candidates: readonly VaultAuditRepairCandidate[]
  selectedIds: ReadonlySet<string>
  disabled: boolean
  onToggle: (id: string) => void
  onSetMany: (ids: readonly string[], selected: boolean) => void
}

function matches(candidate: VaultAuditRepairCandidate, needle: string): boolean {
  if (!needle) return true
  return [candidate.relativePath, candidate.configuration, candidate.value]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

export function VaultAuditRepairTable({
  candidates,
  selectedIds,
  disabled,
  onToggle,
  onSetMany,
}: VaultAuditRepairTableProps) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return candidates.filter((candidate) => matches(candidate, needle))
  }, [candidates, filter])

  const rows = filtered.slice(0, MAX_ROWS)
  const filteredIds = useMemo(() => filtered.map((candidate) => candidate.id), [filtered])
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((candidate) => selectedIds.has(candidate.id))

  if (candidates.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSetMany(filteredIds, !allFilteredSelected)}
            disabled={disabled || filtered.length === 0}
            className="px-2 py-1 text-xs text-plm-fg-muted hover:text-plm-fg bg-plm-bg-lighter hover:bg-plm-bg-light border border-plm-border rounded-md transition-colors disabled:opacity-50"
          >
            {allFilteredSelected
              ? t('vaultAudit.repair.selectNone', { count: filtered.length })
              : t('vaultAudit.repair.selectAll', { count: filtered.length })}
          </button>
        </div>
        <input
          type="text"
          value={filter}
          placeholder={t('vaultAudit.repair.filterPlaceholder')}
          onChange={(event) => setFilter(event.target.value)}
          className="w-64 px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg outline-none focus:border-plm-accent"
        />
      </div>

      {filtered.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.repair.noMatches')}</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="border border-plm-border rounded-md overflow-hidden">
            <table className="w-full text-xs table-fixed">
              <thead className="bg-plm-bg-lighter text-plm-fg-muted">
                <tr>
                  <th className="w-8" />
                  <th className="text-left font-normal px-2 py-1.5 w-2/5">
                    {t('vaultAudit.repair.columnFile')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.repair.columnConfiguration')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.repair.columnField')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.repair.columnValue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((candidate) => {
                  const isDerived = candidate.provenance === 'derived'
                  return (
                    <tr
                      key={candidate.id}
                      className={`border-t border-plm-border/60 align-top ${
                        isDerived ? 'bg-plm-warning/5' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(candidate.id)}
                          disabled={disabled}
                          onChange={() => onToggle(candidate.id)}
                          className="accent-plm-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-plm-fg truncate">
                        <span title={candidate.relativePath}>{candidate.relativePath}</span>
                      </td>
                      <td className="px-2 py-1.5 text-plm-fg-muted truncate">
                        {candidate.configuration}
                      </td>
                      <td className="px-2 py-1.5 text-plm-fg-muted">
                        {fieldLabel(candidate.field)}
                      </td>
                      <td className="px-2 py-1.5 truncate">
                        <span className="text-plm-fg">{candidate.value}</span>
                        {isDerived && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 text-plm-warning"
                            title={t('vaultAudit.repair.derivedHint')}
                          >
                            <Sparkles size={10} />
                            {t('vaultAudit.repair.derivedTag')}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-plm-fg-muted">
            {t('vaultAudit.repair.showing', { shown: rows.length, total: filtered.length })}
          </p>
        </>
      )}
    </div>
  )
}
