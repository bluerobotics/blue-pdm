/**
 * Turning a divergence report into a set of repairs an administrator can approve.
 *
 * The offline planner in `configMapRepair.ts` works from two exported artifacts - a SQL shape
 * dump and a Document Manager census - because it runs in a process with no database and no vault.
 * The Vault Audit already has both sides in memory: it has just read every row and opened every
 * document. So this plans from the report rather than re-deriving it, which is what makes
 * scan-and-fix one flow instead of two tools that have to be kept in agreement.
 *
 * The two planners agree on the rules and neither is the other's caller. That is deliberate: the
 * offline one must keep working with no database client anywhere in its import graph, and giving
 * them a shared parent would drag the report's types into it.
 *
 * ## What may be proposed
 *
 * A proposal is only ever an entry for a configuration key the row's map does **not carry**.
 *
 * Absence of the key, not emptiness of the value. `missingTabConfigurations` counts a key holding
 * `""` as missing, and it is not a gap - it is a configuration whose value someone deliberately
 * cleared, and filling it would be an overwrite. `unkeyedTabConfigurations` is the set that
 * excludes those, which is why the scanner measures the two apart.
 *
 * Everything is decided by configuration **name**. The ORING-FKM-75A fixture carries 26 entries
 * against 15 configurations; by count it has lost eleven, and by name it describes everything the
 * file has and is intact. It produces no proposals here, and the eleven keys naming configurations
 * that no longer exist are never touched - removing one is a deletion, which nothing in this
 * pipeline can express.
 *
 * ## Recovered and derived are not the same claim
 *
 * A `recovered` value is the string the scanner already read out of the configuration's own
 * property bag under the key BluePLM's own writers produce. The database held it and lost it.
 *
 * A `derived` tab is the trailing segment of the configuration's `Number`. The database never
 * distinctly held it, which is precisely what the `unattributed` bucket exists to keep out of a
 * repair - so it is off by default, offered only where the scanner found nothing on either side,
 * and carries its provenance everywhere it goes so the interface can keep it visually apart.
 *
 * This module is pure: no I/O, no store, no React, no imports that can reach Supabase.
 */

import {
  CONFIG_DESCRIPTIONS_KEY,
  CONFIG_TABS_KEY,
  type ConfigScopeField,
  type FieldComparison,
  type FileDivergence,
} from './divergence'

import type { ConfigMapKey } from './configMapRepair'

import type {
  VaultAuditRepairCandidate,
  VaultAuditRepairFile,
} from '@/types/vaultAudit'

/** Which reserved map each configuration-scope field is stored in. */
const FIELD_TO_MAP: Record<ConfigScopeField, ConfigMapKey> = {
  config_tab: CONFIG_TABS_KEY,
  config_description: CONFIG_DESCRIPTIONS_KEY,
}

export interface RepairProposalOptions {
  /**
   * Also propose a tab derived from the configuration's `Number` where nothing survives on either
   * side. Off by default; a derived value is a reconstruction.
   */
  includeDerivedTabs: boolean
}

export const DEFAULT_REPAIR_PROPOSAL_OPTIONS: RepairProposalOptions = {
  includeDerivedTabs: false,
}

/** What the preview leads with, so the numbers are computed once rather than per render. */
export interface RepairProposalSummary {
  files: number
  entries: number
  recovered: number
  derived: number
}

function candidateId(file: FileDivergence, comparison: FieldComparison): string {
  return `${file.fileId}:${comparison.field}:${comparison.configuration ?? ''}`
}

/** The configurations whose key is genuinely absent from the row's map, by name. */
function unkeyedFor(file: FileDivergence, field: ConfigScopeField): ReadonlySet<string> {
  return new Set(
    field === 'config_tab'
      ? file.coverage.unkeyedTabConfigurations
      : file.coverage.unkeyedDescriptionConfigurations,
  )
}

/**
 * Whether a comparison is one this module may act on at all.
 *
 * Configuration scope only, and only fields the reserved maps hold. The file-scope fields live in
 * columns, and a column cannot have a key merged into it - the additive merge that makes this safe
 * simply does not apply to them, so they are not offered rather than being offered and refused.
 */
function isConfigScope(
  comparison: FieldComparison,
): comparison is FieldComparison & { configuration: string; field: ConfigScopeField } {
  return (
    comparison.scope === 'configuration' &&
    comparison.configuration !== undefined &&
    (comparison.field === 'config_tab' || comparison.field === 'config_description')
  )
}

/**
 * Every value that could be written, in the order the scan walked the vault.
 *
 * Order is the report's, not a ranking: the preview groups by file and an administrator reads it
 * against a folder tree, so shuffling the worst to the top would cost more than it bought.
 *
 * Nothing is re-classified here. `recoverable` and `unrecoverable` are the scanner's verdicts, and
 * they already encode the two things that decide whether a repair is legitimate: that the database
 * owns this field on this kind of file, and that the row's map existed and so once described the
 * file's configurations. A drawing's configuration fields are `unattributed` for the first reason
 * and never reach either branch below.
 */
export function buildRepairCandidates(
  files: readonly FileDivergence[],
  options: RepairProposalOptions = DEFAULT_REPAIR_PROPOSAL_OPTIONS,
): VaultAuditRepairCandidate[] {
  const candidates: VaultAuditRepairCandidate[] = []

  for (const file of files) {
    const unkeyed: Record<ConfigScopeField, ReadonlySet<string>> = {
      config_tab: unkeyedFor(file, 'config_tab'),
      config_description: unkeyedFor(file, 'config_description'),
    }

    for (const comparison of file.fieldComparisons) {
      if (!isConfigScope(comparison)) continue

      // The row already carries a key for this configuration. Whatever it holds - a value that
      // disagrees, or an empty string someone cleared on purpose - it is not a gap, and the merge
      // would leave it alone anyway. Proposing it would promise a change that cannot happen.
      if (!unkeyed[comparison.field].has(comparison.configuration)) continue

      const base = {
        id: candidateId(file, comparison),
        fileId: file.fileId,
        relativePath: file.relativePath,
        fileName: file.fileName,
        field: comparison.field,
        configuration: comparison.configuration,
      }

      if (comparison.recoverability === 'recoverable' && comparison.databaseRepairValue !== null) {
        candidates.push({
          ...base,
          value: comparison.databaseRepairValue,
          provenance: 'recovered',
        })
        continue
      }

      // Nothing survives on either side. The configuration's own `Number` may still imply a tab,
      // and that is a reconstruction rather than a recovery, so it is only offered on request.
      if (
        options.includeDerivedTabs &&
        comparison.field === 'config_tab' &&
        comparison.recoverability === 'unrecoverable'
      ) {
        const derived = file.derivableTabs[comparison.configuration]
        if (derived) candidates.push({ ...base, value: derived, provenance: 'derived' })
      }
    }
  }

  return candidates
}

/** Count what a set of candidates amounts to, for the preview's opening line. */
export function summarizeCandidates(
  candidates: readonly VaultAuditRepairCandidate[],
): RepairProposalSummary {
  const files = new Set<string>()
  let recovered = 0
  let derived = 0

  for (const candidate of candidates) {
    files.add(candidate.fileId)
    if (candidate.provenance === 'recovered') recovered += 1
    else derived += 1
  }

  return { files: files.size, entries: candidates.length, recovered, derived }
}

/**
 * Fold the approved candidates into one merge per file.
 *
 * The result is the whole of what crosses the wire. It carries values and configuration names and
 * nothing else - no instruction about how to apply them, because the merge order is written into
 * the database function and is not the client's to choose.
 */
export function toRepairRequest(
  candidates: readonly VaultAuditRepairCandidate[],
): VaultAuditRepairFile[] {
  const byFile = new Map<string, VaultAuditRepairFile>()

  for (const candidate of candidates) {
    let file = byFile.get(candidate.fileId)
    if (!file) {
      file = { fileId: candidate.fileId, relativePath: candidate.relativePath, maps: {} }
      byFile.set(candidate.fileId, file)
    }

    const key = FIELD_TO_MAP[candidate.field]
    const map = file.maps[key] ?? {}
    map[candidate.configuration] = candidate.value
    file.maps[key] = map
  }

  return [...byFile.values()]
}
