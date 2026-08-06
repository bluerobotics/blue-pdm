/**
 * Rendering a configuration-map repair plan for a person to read and decide from.
 *
 * Plain strings rather than `t()`, unlike `divergenceReport.ts`. Two reasons, both deliberate. This
 * report is printed by a developer script to a terminal and never appears in the application, so
 * there is no user whose language it should follow. And `lib/i18n` reaches `pdmStore`, which reaches
 * the Supabase client - importing it would put a database client in the import graph of a tool
 * whose central claim is that it has no way to write to the database. Being able to check that
 * claim by reading the imports is worth more here than translation the operator will never see.
 *
 * The report separates two things that a summary would otherwise merge: a value **recovered** from
 * the key BluePLM writes, and a value **derived** by splitting the configuration's `Number`. The
 * first is a value the database demonstrably once held; the second is a reconstruction the database
 * never distinctly held, and marking it is what keeps the repair from quietly manufacturing data.
 *
 * Pure: strings in, strings out.
 */

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'

import type {
  ConfigMapKey,
  FileRepairPlan,
  ProposedEntry,
  RepairPlan,
  SkipReason,
} from './configMapRepair'

function mapLabel(map: ConfigMapKey): string {
  return map === CONFIG_TABS_KEY ? 'tab' : 'description'
}

function skipReasonLabel(reason: SkipReason): string {
  switch (reason) {
    case 'key-already-present':
      return 'the row already has this configuration, so it was left alone'
    case 'row-has-no-map':
      return 'the row carries no map of this kind, so nothing was lost from one'
    case 'row-map-not-an-object':
      return 'the row holds something other than an object under the reserved key'
    case 'no-value-in-document':
      return 'the configuration holds nothing under a key BluePLM writes'
    case 'derivation-not-enabled':
      return 'a tab could only be derived from Number, and derivation is off'
    case 'matches-file-level':
      return 'the value repeats the file-level value, and duplicates are excluded'
  }
}

function entryLine(plan: FileRepairPlan, entry: ProposedEntry): string {
  const notes: string[] = [entry.provenance]
  if (entry.matchesFileLevel) notes.push('same as file-level')
  return (
    `  ${plan.relativePath}  [${entry.configuration}]  ${mapLabel(entry.map)} = ` +
    `"${entry.value}"  (${notes.join(', ')})`
  )
}

function proposalLines(plan: RepairPlan): string[] {
  const lines: string[] = []

  for (const file of plan.files) {
    if (file.proposed.length === 0) continue

    const tabs = file.proposed.filter((entry) => entry.map === CONFIG_TABS_KEY).length
    const descriptions = file.proposed.length - tabs

    lines.push('')
    lines.push(
      `${file.relativePath}  -  ${file.configurationCount} configurations, ` +
        `${file.proposed.length} entries to add (${tabs} tab, ${descriptions} description)`,
    )
    lines.push(
      `  currently on the row: ${file.existingKeyCount[CONFIG_TABS_KEY]} tab, ` +
        `${file.existingKeyCount[CONFIG_DESCRIPTIONS_KEY]} description - none of them touched`,
    )
    for (const entry of file.proposed) lines.push(entryLine(file, entry))
  }

  return lines
}

function untouchedLines(plan: RepairPlan): string[] {
  const untouched = plan.files.filter((file) => file.proposed.length === 0)
  if (untouched.length === 0) return ['  None - every file planned has at least one gap.']

  const lines: string[] = []
  for (const file of untouched) {
    const stale = file.staleKeys.length
    const staleNote =
      stale > 0
        ? `, ${stale} keys naming configurations the document no longer has (kept as they are)`
        : ''
    lines.push(
      `  ${file.relativePath}: ${file.configurationCount} configurations, ` +
        `${file.existingKeyCount[CONFIG_TABS_KEY]} tab and ` +
        `${file.existingKeyCount[CONFIG_DESCRIPTIONS_KEY]} description entries on the row${staleNote}`,
    )
  }
  return lines
}

function staleLines(plan: RepairPlan): string[] {
  const lines: string[] = []
  for (const file of plan.files) {
    if (file.staleKeys.length === 0) continue
    const names = file.staleKeys.map((key) => `${mapLabel(key.map)}:${key.configuration}`)
    lines.push(`  ${file.relativePath}: ${names.join(', ')}`)
  }
  return lines.length > 0 ? lines : ['  None.']
}

function judgementLines(plan: RepairPlan): string[] {
  const { summary, options } = plan
  const lines: string[] = []

  lines.push('  Values equal to the document file-level value')
  if (options.skipFileLevelDuplicates) {
    lines.push(
      `    Excluded. ${summary.skippedByReason['matches-file-level']} entries were declined on` +
        ' this ground.',
    )
  } else {
    lines.push(
      `    Filled. ${summary.fileLevelDuplicateEntries} of the ${summary.proposedEntries} proposed` +
        ' entries repeat it.',
    )
  }
  lines.push(
    '    They sit in the configuration own property bag, so equality with the file-level value is',
  )
  lines.push(
    '    not evidence of inheritance, and a configuration with no entry already falls back to the',
  )
  lines.push(
    '    document at display time - so filling restores the row without changing what is shown.',
  )
  lines.push('    Reverse it with --skip-file-level-duplicates.')

  lines.push('')
  lines.push('  Tabs derived by splitting the configuration Number')
  if (options.includeDerivedTabs) {
    lines.push(
      `    Included, and marked "derived" above. ${summary.derivedEntries} entries came this way.`,
    )
  } else {
    lines.push(
      `    Excluded. ${summary.skippedByReason['derivation-not-enabled']} tabs could only have been` +
        ' derived.',
    )
  }
  lines.push(
    '    A derived tab is a value the database never distinctly held, and the rule disagrees with',
  )
  lines.push(
    '    the stored convention about the leading dash - a Number ending "-010" derives to "010"',
  )
  lines.push('    where the document own Tab Number reads "-010". Enable it with --include-derived.')

  return lines
}

function skipLines(plan: RepairPlan): string[] {
  const lines: string[] = []
  const entries = Object.entries(plan.summary.skippedByReason) as [SkipReason, number][]
  for (const [reason, count] of entries) {
    if (count === 0) continue
    lines.push(`  ${count}: ${skipReasonLabel(reason)}`)
  }
  return lines.length > 0 ? lines : ['  None.']
}

function unplannedLines(plan: RepairPlan): string[] {
  const relevant = plan.unplanned.filter((row) => row.reason !== 'out-of-scope')
  const outOfScope = plan.unplanned.length - relevant.length

  const lines: string[] = []
  if (outOfScope > 0) lines.push(`  ${outOfScope} rows outside the requested path filter.`)
  for (const row of relevant) {
    const detail = row.detail ? ` (${row.detail})` : ''
    lines.push(`  ${row.relativePath}: ${row.reason}${detail}`)
  }
  return lines.length > 0 ? lines : ['  None.']
}

/**
 * The dry run, in the order the operator has to decide in: what would be written, what would not,
 * the two judgement calls, then everything the plan declined to touch.
 */
export function formatRepairPlan(plan: RepairPlan): string[] {
  const { summary } = plan
  const lines: string[] = []

  lines.push('Configuration-map repair - DRY RUN, nothing has been written')
  lines.push(
    `${summary.rowsConsidered} rows considered, ${plan.files.length} matched to a document, ` +
      `${summary.filesWithProposals} with at least one gap to fill.`,
  )
  lines.push(
    `${summary.proposedEntries} entries would be added ` +
      `(${summary.recoveredEntries} recovered, ${summary.derivedEntries} derived).`,
  )
  lines.push(
    `${summary.existingKeysPreserved} entries already on those rows would be left exactly as they` +
      ` are, and ${summary.staleKeys} keys naming configurations that no longer exist would be kept.`,
  )
  lines.push('Every proposal is for a configuration key the row does not have. Nothing else is')
  lines.push('representable: the merge is `computed || existing`, so the row always wins.')

  lines.push('')
  lines.push('1. Entries that would be added')
  const proposals = proposalLines(plan)
  if (proposals.length === 0) lines.push('  None.')
  else lines.push(...proposals)

  lines.push('')
  lines.push('2. Files with a document match and nothing to fill')
  lines.push(...untouchedLines(plan))

  lines.push('')
  lines.push('3. Keys for configurations the document no longer has - kept, never removed')
  lines.push(...staleLines(plan))

  lines.push('')
  lines.push('4. The two judgement calls')
  lines.push(...judgementLines(plan))

  lines.push('')
  lines.push('5. Configurations that produced nothing')
  lines.push(...skipLines(plan))

  lines.push('')
  lines.push('6. Rows the plan could not act on')
  lines.push(...unplannedLines(plan))

  return lines
}
