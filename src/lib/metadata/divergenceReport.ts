/**
 * Rendering and persistence for the phase 0 divergence report.
 *
 * Two outputs, deliberately: a summary a person reads and decides from, and a JSON artifact a
 * later repair phase consumes so that repair operates on measured facts rather than re-deriving
 * them from a vault that may have changed in between.
 *
 * The only write in this module is the artifact, and it goes to the application's log directory -
 * never into the vault, and never near a SolidWorks document.
 */

import { t } from '@/lib/i18n'

import type { DivergenceReport } from './divergenceScan'
import type { DivergenceSummary, OwnedField } from './divergence'

/** Longest lists printed in the summary; the artifact always carries the complete set. */
const MAX_LISTED = 20

function fieldLabel(field: OwnedField): string {
  switch (field) {
    case 'part_number':
      return t('divergence.field.partNumber', 'part number')
    case 'description':
      return t('divergence.field.description', 'description')
    case 'revision':
      return t('divergence.field.revision', 'revision')
    case 'config_tab':
      return t('divergence.field.configTab', 'configuration tab')
    case 'config_description':
      return t('divergence.field.configDescription', 'configuration description')
  }
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '0%'
  return `${Math.round((part / whole) * 1000) / 10}%`
}

function fieldTallyLines(summary: DivergenceSummary): string[] {
  const lines: string[] = []
  for (const tally of summary.fieldTallies) {
    const scope =
      tally.scope === 'file'
        ? t('divergence.scope.file', 'file')
        : t('divergence.scope.configuration', 'config')
    lines.push(
      `  ${fieldLabel(tally.field)} (${scope}): ${tally.compared} compared, ` +
        `${tally.agrees} agree, ${tally.fileEmpty} file-empty, ` +
        `${tally.databaseEmpty} database-empty, ${tally.bothSetDiffer} differ`,
    )
  }
  return lines
}

/**
 * Render the summary a person reads.
 *
 * Ordered by what the plan says matters: the extent of the configuration-map wipe first, then the
 * values that cannot be recovered from anywhere, then the ones that can, then the conflicts, then
 * the per-field breakdown, then the read-back cost phase 4 is designed around.
 */
export function formatDivergenceReport(report: DivergenceReport): string[] {
  const { summary, counts } = report
  const lines: string[] = []

  lines.push(t('divergence.heading', 'Divergence scan - database versus SolidWorks files'))
  lines.push(
    t('divergence.scanned', {
      compared: counts.filesCompared,
      fetched: counts.rowsFetched,
      duration: Math.round(report.durationMs / 100) / 10,
    }),
  )

  if (report.cancelled) {
    lines.push(t('divergence.cancelled', 'The scan was cancelled; the numbers below are partial.'))
  }

  if (counts.filesMissingOnDisk > 0 || counts.filesUnreadable > 0) {
    lines.push(
      t('divergence.notRead', {
        missing: counts.filesMissingOnDisk,
        unreadable: counts.filesUnreadable,
      }),
    )
  }

  lines.push('')
  lines.push(t('divergence.wipeHeading', '1. Configuration maps the database no longer describes'))
  lines.push(
    t('divergence.wipeSummary', {
      files: summary.filesWithTruncatedConfigMap,
      multi: summary.filesWithMultipleConfigurations,
      pct: percent(summary.filesWithTruncatedConfigMap, summary.filesWithMultipleConfigurations),
      entries: summary.totalMissingConfigurationEntries,
    }),
  )
  for (const entry of summary.truncatedConfigMaps.slice(0, MAX_LISTED)) {
    lines.push(
      `  ${entry.relativePath}: ${entry.fileConfigurationCount} configurations in the file, ` +
        `${entry.databaseTabKeyCount} recorded, ${entry.missingTabCount} missing`,
    )
  }
  if (summary.truncatedConfigMaps.length > MAX_LISTED) {
    lines.push(
      t('divergence.andMore', { count: summary.truncatedConfigMaps.length - MAX_LISTED }),
    )
  }

  lines.push('')
  lines.push(t('divergence.unrecoverableHeading', '2. Values held by neither side - UNRECOVERABLE'))
  if (summary.unrecoverableValues === 0) {
    lines.push(t('divergence.unrecoverableNone', '  None found.'))
  } else {
    lines.push(
      t('divergence.unrecoverableSummary', { count: summary.unrecoverableValues }),
    )
    for (const value of summary.unrecoverable.slice(0, MAX_LISTED)) {
      const where = value.configuration ? ` [${value.configuration}]` : ''
      lines.push(`  ${value.relativePath}${where}: ${fieldLabel(value.field)}`)
    }
    if (summary.unrecoverable.length > MAX_LISTED) {
      lines.push(
        t('divergence.andMore', { count: summary.unrecoverable.length - MAX_LISTED }),
      )
    }
    lines.push(
      t('divergence.unrecoverableCaveat', { count: summary.noEvidenceValues }),
    )
  }

  lines.push('')
  lines.push(t('divergence.recoverableHeading', '3. Values the file still holds - recoverable'))
  lines.push(
    t('divergence.recoverableSummary', { count: summary.recoverableValues }),
  )

  lines.push('')
  lines.push(t('divergence.disagreeingHeading', '4. Values the two sides disagree about'))
  lines.push(
    t('divergence.disagreeingSummary', { count: summary.disagreeingValues }),
  )
  for (const value of summary.disagreeing.slice(0, MAX_LISTED)) {
    const where = value.configuration ? ` [${value.configuration}]` : ''
    lines.push(
      `  ${value.relativePath}${where} ${fieldLabel(value.field)}: ` +
        `database "${value.databaseValue ?? ''}" / file "${value.fileValue ?? ''}"`,
    )
  }
  if (summary.disagreeing.length > MAX_LISTED) {
    lines.push(
      t('divergence.andMore', { count: summary.disagreeing.length - MAX_LISTED }),
    )
  }

  lines.push('')
  lines.push(t('divergence.fieldHeading', '5. Divergence per field'))
  lines.push(...fieldTallyLines(summary))

  if (report.readBackTimings.length > 0) {
    lines.push('')
    lines.push(t('divergence.timingHeading', '6. Cost of one read-back cycle'))
    for (const timing of report.readBackTimings) {
      lines.push(
        `  ${timing.relativePath} (${timing.configurationCount} configurations): ` +
          `median ${timing.medianMs}ms, min ${timing.minMs}ms, max ${timing.maxMs}ms ` +
          `over ${timing.samplesMs.length} reads`,
      )
    }
  }

  lines.push('')
  lines.push(
    t('divergence.integrity', {
      hashed: report.integrity.filesHashed,
      breaches: report.integrity.breaches.length,
    }),
  )
  for (const breach of report.integrity.breaches) {
    lines.push(`  CHANGED: ${breach.relativePath}`)
  }

  return lines
}

/** UTF-8 safe base64, because `writeFile` takes base64 and a description may hold any character. */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function timestampSlug(iso: string): string {
  return iso.replace(/[:.]/g, '-').replace('Z', '')
}

/**
 * Persist the artifact under the application's log directory.
 *
 * Not into the vault: the vault is what the scan is measuring, and dropping a file into it would
 * change the thing being measured and put a write inside the folder this phase exists to protect.
 */
export async function writeDivergenceArtifact(report: DivergenceReport): Promise<string> {
  const logsDir = await window.electronAPI?.getLogsDir?.()
  if (!logsDir) throw new Error('Could not resolve the log directory')

  const directory = `${logsDir}\\divergence`
  await window.electronAPI?.ensureDir?.(directory)

  const path = `${directory}\\divergence-report-${timestampSlug(report.generatedAt)}.json`
  const result = await window.electronAPI?.writeFile?.(
    path,
    toBase64(JSON.stringify(report, null, 2)),
  )
  if (!result?.success) throw new Error(result?.error ?? 'Writing the report failed')

  return path
}
