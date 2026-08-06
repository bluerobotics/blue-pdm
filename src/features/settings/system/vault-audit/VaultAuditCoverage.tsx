import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditCoverage as Coverage } from '@/types/vaultAudit'

interface VaultAuditCoverageProps {
  coverage: Coverage
}

/** Files listed before the "show all" toggle. Enough to see the shape of the problem. */
const INITIAL_ROWS = 10

/**
 * How the per-configuration records line up with the files they describe.
 *
 * Two columns, kept apart on purpose. Undescribed configurations are values the record has stopped
 * carrying. Stale entries are keys for configurations that have gone, which is clutter. Merging
 * them - or worse, comparing entry counts against configuration counts - reports a file carrying
 * eleven leftover keys as having lost eleven values, when it has lost nothing.
 */
export function VaultAuditCoverage({ coverage }: VaultAuditCoverageProps) {
  const [showAll, setShowAll] = useState(false)

  const rows = showAll ? coverage.files : coverage.files.slice(0, INITIAL_ROWS)
  const aligned =
    coverage.filesWithUndescribedConfigurations === 0 && coverage.filesWithStaleKeys === 0

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.coverage.heading')}</h3>
      <p className="text-xs text-plm-fg-muted">{t('vaultAudit.coverage.description')}</p>

      {aligned ? (
        <p className="text-xs text-plm-success">{t('vaultAudit.coverage.allAligned')}</p>
      ) : (
        <ul className="text-xs text-plm-fg-muted space-y-1">
          {coverage.filesWithUndescribedConfigurations > 0 && (
            <li className="text-plm-fg">
              {t('vaultAudit.coverage.undescribed', {
                files: coverage.filesWithUndescribedConfigurations,
              })}{' '}
              ·{' '}
              {t('vaultAudit.coverage.undescribedEntries', {
                count: coverage.undescribedConfigurationCount,
              })}
            </li>
          )}
          {coverage.filesWithEmptiedRecord > 0 && (
            <li>{t('vaultAudit.coverage.emptied', { count: coverage.filesWithEmptiedRecord })}</li>
          )}
          {coverage.filesWithStaleKeys > 0 && (
            <li>
              {t('vaultAudit.coverage.stale', {
                files: coverage.filesWithStaleKeys,
                count: coverage.staleKeyCount,
              })}
            </li>
          )}
          {coverage.filesWithNoRecord > 0 && (
            <li>{t('vaultAudit.coverage.noRecord', { count: coverage.filesWithNoRecord })}</li>
          )}
        </ul>
      )}

      {coverage.filesWithStaleKeys > 0 && (
        <p className="text-xs text-plm-fg-muted/80 italic">{t('vaultAudit.coverage.staleNote')}</p>
      )}

      {rows.length > 0 && (
        <div className="border border-plm-border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-plm-bg-lighter text-plm-fg-muted">
              <tr>
                <th className="text-left font-normal px-2 py-1.5">
                  {t('vaultAudit.coverage.columnFile')}
                </th>
                <th className="text-right font-normal px-2 py-1.5 w-28">
                  {t('vaultAudit.coverage.columnConfigurations')}
                </th>
                <th className="text-right font-normal px-2 py-1.5 w-28">
                  {t('vaultAudit.coverage.columnUndescribed')}
                </th>
                <th className="text-right font-normal px-2 py-1.5 w-28">
                  {t('vaultAudit.coverage.columnStale')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((file) => (
                <tr key={file.fileId} className="border-t border-plm-border/60">
                  <td className="px-2 py-1.5 text-plm-fg font-mono truncate max-w-0">
                    <span title={file.relativePath}>{file.relativePath}</span>
                    {file.recordEmptied && (
                      <span className="ml-2 text-plm-error">
                        {t('vaultAudit.coverage.recordEmptied')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-plm-fg-muted">
                    {file.configurationCount}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right ${
                      file.undescribedConfigurations.length > 0
                        ? 'text-plm-error'
                        : 'text-plm-fg-muted'
                    }`}
                  >
                    {file.undescribedConfigurations.length}
                  </td>
                  <td className="px-2 py-1.5 text-right text-plm-fg-muted">
                    {file.staleKeys.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {coverage.files.length > INITIAL_ROWS && (
            <button
              onClick={() => setShowAll((current) => !current)}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-plm-fg-muted hover:text-plm-fg bg-plm-bg-lighter border-t border-plm-border transition-colors"
            >
              {showAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAll
                ? t('vaultAudit.coverage.showFewer')
                : t('vaultAudit.coverage.showAll', { total: coverage.files.length })}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
