import { useMemo, useState } from 'react'
import { ExternalLink, Wrench } from 'lucide-react'

import { t } from '@/lib/i18n'
import type {
  VaultAuditCategoryKind,
  VaultAuditFinding,
  VaultAuditRepairHandler,
} from '@/types/vaultAudit'

import { fieldLabel, unattributedReasonLabel } from './vaultAuditLabels'
import { toRepairTarget } from './vaultAuditView'
import { useRevealInFileBrowser } from './useRevealInFileBrowser'

interface VaultAuditFindingsProps {
  findings: VaultAuditFinding[]
  kind: VaultAuditCategoryKind | null
  /**
   * The repair seam.
   *
   * The audit never supplies this. A repair tool passes a handler in and the per-row button comes
   * alive; until then the button is present and disabled so that the place a repair attaches is
   * visible in the interface rather than only in the code. The handler receives a
   * `VaultAuditRepairTarget` and decides for itself whether the value may be written - this
   * component makes no such claim.
   */
  onRepair?: VaultAuditRepairHandler
}

/**
 * Rows rendered before the list is truncated.
 *
 * A vault-wide scan can produce thousands of recoverable values, and a table that long is neither
 * readable nor cheap. The filter box narrows it; the full set is in the JSON artifact.
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

function ValueCell({ value }: { value: string | null }) {
  if (value === null) {
    return <span className="text-plm-fg-muted/50">{t('vaultAudit.findings.empty')}</span>
  }
  return <span className="text-plm-fg">{value}</span>
}

export function VaultAuditFindings({ findings, kind, onRepair }: VaultAuditFindingsProps) {
  const [filter, setFilter] = useState('')
  const { resolve, reveal } = useRevealInFileBrowser()

  const inCategory = useMemo(
    () => (kind ? findings.filter((finding) => finding.kind === kind) : []),
    [findings, kind],
  )

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return inCategory.filter((finding) => matches(finding, needle))
  }, [inCategory, filter])

  const rows = filtered.slice(0, MAX_ROWS)

  if (!kind) {
    return <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.selectPrompt')}</p>
  }

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

      {inCategory.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.none')}</p>
      )}

      {inCategory.length > 0 && filtered.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.noMatches')}</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="border border-plm-border rounded-md overflow-hidden">
            <table className="w-full text-xs table-fixed">
              <thead className="bg-plm-bg-lighter text-plm-fg-muted">
                <tr>
                  <th className="text-left font-normal px-2 py-1.5 w-2/5">
                    {t('vaultAudit.findings.columnFile')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.findings.columnConfiguration')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.findings.columnField')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.findings.columnDatabase')}
                  </th>
                  <th className="text-left font-normal px-2 py-1.5">
                    {t('vaultAudit.findings.columnFile2')}
                  </th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {rows.map((finding) => {
                  const localPath = resolve(finding.relativePath)
                  return (
                    <tr key={finding.id} className="border-t border-plm-border/60 align-top">
                      <td className="px-2 py-1.5 font-mono text-plm-fg truncate">
                        <span title={finding.relativePath}>{finding.relativePath}</span>
                      </td>
                      <td className="px-2 py-1.5 text-plm-fg-muted truncate">
                        {finding.configuration ?? t('vaultAudit.findings.fileScope')}
                      </td>
                      <td className="px-2 py-1.5 text-plm-fg-muted">
                        {fieldLabel(finding.field)}
                        {finding.unattributedReason && (
                          <span
                            className="block text-plm-fg-muted/70"
                            title={unattributedReasonLabel(finding.unattributedReason)}
                          >
                            {unattributedReasonLabel(finding.unattributedReason)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 truncate">
                        <ValueCell value={finding.databaseValue} />
                      </td>
                      <td className="px-2 py-1.5 truncate">
                        <ValueCell value={finding.fileValue} />
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
                          {/* TODO(repair-tool): passing `onRepair` enables this. The audit itself
                              never writes, so it stays disabled here. */}
                          <button
                            onClick={() => onRepair?.(toRepairTarget(finding))}
                            disabled={!onRepair}
                            title={
                              onRepair
                                ? t('vaultAudit.findings.repair')
                                : t('vaultAudit.findings.repairUnavailable')
                            }
                            className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                          >
                            <Wrench size={12} />
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
            {t('vaultAudit.findings.showing', { shown: rows.length, total: filtered.length })}
          </p>
        </>
      )}
    </section>
  )
}
