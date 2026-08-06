import { t } from '@/lib/i18n'
import type { FieldTally } from '@/lib/metadata/divergence'

import { fieldLabel } from './vaultAuditLabels'

interface VaultAuditFieldTableProps {
  tallies: FieldTally[]
}

/** The scanner's per-field breakdown, for working out which field is carrying the damage. */
export function VaultAuditFieldTable({ tallies }: VaultAuditFieldTableProps) {
  if (tallies.length === 0) return null

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.fields.heading')}</h3>

      <div className="border border-plm-border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-plm-bg-lighter text-plm-fg-muted">
            <tr>
              <th className="text-left font-normal px-2 py-1.5">
                {t('vaultAudit.fields.columnField')}
              </th>
              <th className="text-right font-normal px-2 py-1.5">
                {t('vaultAudit.fields.columnCompared')}
              </th>
              <th className="text-right font-normal px-2 py-1.5">
                {t('vaultAudit.fields.columnAgrees')}
              </th>
              <th className="text-right font-normal px-2 py-1.5">
                {t('vaultAudit.fields.columnFileEmpty')}
              </th>
              <th className="text-right font-normal px-2 py-1.5">
                {t('vaultAudit.fields.columnDatabaseEmpty')}
              </th>
              <th className="text-right font-normal px-2 py-1.5">
                {t('vaultAudit.fields.columnDiffer')}
              </th>
            </tr>
          </thead>
          <tbody>
            {tallies.map((tally) => (
              <tr key={`${tally.scope}:${tally.field}`} className="border-t border-plm-border/60">
                <td className="px-2 py-1.5 text-plm-fg">
                  {fieldLabel(tally.field)}
                  <span className="text-plm-fg-muted/70 ml-1.5">
                    {tally.scope === 'file'
                      ? t('divergence.scope.file')
                      : t('divergence.scope.configuration')}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-plm-fg-muted">{tally.compared}</td>
                <td className="px-2 py-1.5 text-right text-plm-fg-muted">{tally.agrees}</td>
                <td className="px-2 py-1.5 text-right text-plm-fg-muted">{tally.fileEmpty}</td>
                <td className="px-2 py-1.5 text-right text-plm-fg-muted">{tally.databaseEmpty}</td>
                <td
                  className={`px-2 py-1.5 text-right ${
                    tally.bothSetDiffer > 0 ? 'text-yellow-500' : 'text-plm-fg-muted'
                  }`}
                >
                  {tally.bothSetDiffer}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
