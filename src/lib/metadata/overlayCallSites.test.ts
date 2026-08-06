/**
 * Regression cover for the call sites whose precedence was reversed, and the scan that stops new
 * ones appearing.
 *
 * Three sites read the committed value first and the pending edit second, so a user's uncommitted
 * renumber or retitle was silently ignored by the thing they were about to hand to someone else -
 * a PDF filename, a drawing title block, a CSV. They were invisible because
 * `updatePendingMetadata` also copied the pending value into `pdmData`, which makes both branches
 * return the same string. That copy is gone, which is what makes these live.
 *
 * The sites themselves are component and hook internals - the suite runs in `node` with no React
 * harness - so this file covers them two ways. Each scenario below reproduces one site's inputs and
 * asserts what the shared overlay now returns for them, and the source scan at the bottom asserts
 * that no file has gone back to deciding for itself.
 *
 * ## Why the scan reads the syntax tree
 *
 * It used to be two regexes, and they looked for the *reversed* shape: a committed field, then
 * `||`, then the word `pendingMetadata` within 120 characters. Run against ten ways of getting this
 * wrong, they caught one - the exact one they were written for. They missed `??` in place of `||`,
 * a ternary, the same pair more than 120 characters apart, a `pdmData` that had been destructured,
 * a `pdmData` that had been assigned to a local first, and every one of those again on the
 * configuration maps. Worst of all they missed a plain committed read with no pending side
 * mentioned at all - which is what `ExportActions.tsx` was doing with `revision`, live, while the
 * scan passed.
 *
 * The regexes lost because they described the wrong thing. A careless conversion does not leave the
 * pending side lying next to the committed one; that is exactly the part it forgot. So the rule
 * here is not "do not read these two in the wrong order", it is **"do not read the committed side
 * of an overlay-governed field at all"**, and the exceptions are named one at a time with a reason.
 * A new unrouted read fails by default instead of needing the scan to have predicted its shape.
 *
 * Deciding that needs to see through a local alias and a destructuring pattern, which is where a
 * regex has to stop, so the scan parses each file with the TypeScript compiler that is already a
 * dependency. `TEN_SHAPES` below is the original ten, run against the scanner, so the claim that it
 * catches them is checked rather than asserted.
 *
 * The proper fix is a type that makes the bad shape unrepresentable - `part_number` on `PDMFile`
 * branded so that only `overlay.ts` can unwrap it. That is a change to `PDMFile` and to the
 * overlay, both of which are outside this change's reach; until then this scan is the guard.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import {
  resolveConfigurationDescription,
  resolveConfigurationTab,
  resolveConfigurationTabs,
  resolveDescription,
  resolvePartNumber,
  resolvedText,
} from './overlay'
import type { MetadataOverlaySource } from './overlay'
import type { PDMFile } from '@/types/pdm'

function row(
  fields: Partial<Pick<PDMFile, 'part_number' | 'description' | 'revision'>> & {
    custom_properties?: unknown
  },
): PDMFile {
  return {
    part_number: null,
    description: null,
    revision: '',
    custom_properties: null,
    ...fields,
  } as PDMFile
}

/**
 * A file the user has renumbered and retitled in the datacard but not yet checked in. This is the
 * state all three reversed sites got wrong, and the state the `pdmData` copy used to disguise.
 */
const RENAMED_BUT_NOT_CHECKED_IN: MetadataOverlaySource = {
  pendingMetadata: { part_number: 'PN-NEW', description: 'New description' },
  pdmData: row({ part_number: 'PN-OLD', description: 'Old description' }),
}

describe('ExportActions - the drawing export path', () => {
  // Was: `drawing.pdmData?.part_number || drawing.pendingMetadata?.part_number || ''`.
  // A drawing exported after a renumber got the old number in both the PDF filename and the
  // title block, so the wrong number reached whoever the PDF was sent to.

  it('names the exported drawing from the pending renumber, not the committed number', () => {
    expect(resolvedText(resolvePartNumber(RENAMED_BUT_NOT_CHECKED_IN))).toBe('PN-NEW')
  })

  it('takes the drawing description from the pending retitle', () => {
    expect(resolvedText(resolveDescription(RENAMED_BUT_NOT_CHECKED_IN))).toBe('New description')
  })

  it('exports nothing rather than the old number when the user cleared it', () => {
    const cleared: MetadataOverlaySource = {
      pendingMetadata: { part_number: '' },
      pdmData: row({ part_number: 'PN-OLD' }),
    }
    expect(resolvedText(resolvePartNumber(cleared))).toBe('')
  })

  it('still falls back to the committed value when there is no pending edit', () => {
    expect(resolvedText(resolvePartNumber({ pdmData: row({ part_number: 'PN-OLD' }) }))).toBe(
      'PN-OLD',
    )
  })

  it('keeps every configuration tab when only one was edited', () => {
    // Was: `pendingMetadata?.config_tabs || custom_properties._config_tabs`. Pending holds only
    // the edited configurations, so choosing it dropped the rest and the export picked a tab off
    // a one-entry map.
    const tabs = resolveConfigurationTabs({
      pendingMetadata: { config_tabs: { 'AS568-014': '999' } },
      pdmData: row({ custom_properties: { _config_tabs: { Default: '001', 'AS568-014': '014' } } }),
    })

    expect(tabs['Default']).toBe('001')
    expect(tabs['AS568-014']).toBe('999')
  })
})

describe('useConfigHandlers - the configuration export path', () => {
  // Was: `file?.pdmData?.part_number || file?.pendingMetadata?.part_number || ''` for the base
  // number, and `configDescription || file?.pdmData?.description || file?.pendingMetadata?.description`
  // for the description. Exporting a configuration after a renumber built the full item number
  // from the committed base, so the tab was appended to the wrong root.

  it('builds the configuration item number from the pending base number', () => {
    expect(resolvedText(resolvePartNumber(RENAMED_BUT_NOT_CHECKED_IN))).toBe('PN-NEW')
  })

  it('falls back to the pending file-level description, not the committed one', () => {
    const file: MetadataOverlaySource = {
      pendingMetadata: { description: 'New description' },
      pdmData: row({ description: 'Old description' }),
    }
    const configDescription = resolveConfigurationDescription(file, 'Default').value

    expect(configDescription).toBeNull()
    expect(configDescription || resolvedText(resolveDescription(file))).toBe('New description')
  })

  it('prefers a configuration-specific description over the file-level one', () => {
    const file: MetadataOverlaySource = {
      pendingMetadata: { description: 'file level', config_descriptions: { Default: 'config' } },
      pdmData: row({ description: 'Old description' }),
    }
    expect(resolveConfigurationDescription(file, 'Default').value).toBe('config')
  })

  it('takes a configuration tab the user edited over the committed one', () => {
    const file: MetadataOverlaySource = {
      pendingMetadata: { config_tabs: { Default: '900' } },
      pdmData: row({ custom_properties: { _config_tabs: { Default: '001' } } }),
    }
    expect(resolveConfigurationTab(file, 'Default').value).toBe('900')
  })
})

describe('ExportMetadataTableActions - the BR number column', () => {
  // Was: `file.pdmData?.part_number || file.pendingMetadata?.part_number || ''`. The metadata
  // table is a deliverable, so a stale BR number here leaves the building.

  it('writes the pending BR number into the exported table', () => {
    expect(resolvedText(resolvePartNumber(RENAMED_BUT_NOT_CHECKED_IN))).toBe('PN-NEW')
  })

  it('writes the pending description into the exported table', () => {
    expect(resolvedText(resolveDescription(RENAMED_BUT_NOT_CHECKED_IN))).toBe('New description')
  })
})

// ============================================
// The scan
// ============================================

/** The committed fields the overlay governs. Reading one off `pdmData` bypasses it. */
const COMMITTED_FIELDS = new Set(['part_number', 'description', 'revision'])

/**
 * The pending fields the overlay governs.
 *
 * Reading one of these off `pendingMetadata` is as wrong as reading the committed side: it answers
 * "what did the user type" when the question was "what does this field hold", and for the two
 * configuration maps it also throws away every configuration the user did not touch.
 */
const PENDING_FIELDS = new Set([
  'part_number',
  'description',
  'revision',
  'tab_number',
  'config_tabs',
  'config_descriptions',
])

/** The reserved keys the committed configuration maps live under inside `custom_properties`. */
const COMMITTED_MAP_KEYS = ['_config_tabs', '_config_descriptions']

type OverlaySide = 'committed' | 'pending'

export interface UnroutedRead {
  side: OverlaySide
  field: string
  line: number
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/**
 * Find every read of an overlay-governed field that did not go through the overlay.
 *
 * Aliases and destructurings are followed by name, deliberately over-approximating: a local whose
 * initializer so much as mentions `pdmData` is treated as the committed side, because the only way
 * to then read `part_number` off it is the bug this looks for.
 */
export function findUnroutedReads(path: string, text: string): UnroutedRead[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const aliases = new Map<string, OverlaySide>([
    ['pdmData', 'committed'],
    ['pendingMetadata', 'pending'],
  ])
  const found: UnroutedRead[] = []

  const sideOfText = (value: string): OverlaySide | undefined => {
    if (/\bpdmData\b/.test(value)) return 'committed'
    if (/\bpendingMetadata\b/.test(value)) return 'pending'
    return undefined
  }

  const sideOf = (expression: ts.Expression): OverlaySide | undefined => {
    const node = unwrap(expression)
    // A property is only ever the real thing - `file.pdmData`. Aliases are locals, so resolving a
    // property name through the alias map would make `item.file.revision` an offence because some
    // unrelated local up the file happened to be called `file`.
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 'pdmData') return 'committed'
      if (node.name.text === 'pendingMetadata') return 'pending'
      return undefined
    }
    if (ts.isIdentifier(node)) return aliases.get(node.text)
    return undefined
  }

  const fieldsFor = (side: OverlaySide): ReadonlySet<string> =>
    side === 'committed' ? COMMITTED_FIELDS : PENDING_FIELDS

  const record = (side: OverlaySide, field: string, node: ts.Node) => {
    found.push({
      side,
      field,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    })
  }

  // Aliases first: `const committed = file.pdmData` has to be known before `committed.part_number`
  // is walked, and a declaration can sit below its use inside another function.
  const collectAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const side = sideOfText(node.initializer.getText(source))
      if (side) aliases.set(node.name.text, side)
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(source)

  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      const side = sideOfText(node.initializer.getText(source))
      if (side) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name
          if (ts.isIdentifier(property) && fieldsFor(side).has(property.text)) {
            record(side, property.text, element)
          }
        }
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const side = sideOf(node.expression)
      if (side && fieldsFor(side).has(node.name.text)) record(side, node.name.text, node)
    }

    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      const side = sideOf(node.expression)
      const field = node.argumentExpression.text
      if (side && fieldsFor(side).has(field)) record(side, field, node)
    }

    // The committed configuration maps have no named property to key off - they are two reserved
    // strings inside a JSON column - so they are found by the key rather than by the access.
    if (ts.isStringLiteral(node) && COMMITTED_MAP_KEYS.includes(node.text)) {
      record('committed', node.text, node)
    }
    if (ts.isIdentifier(node) && COMMITTED_MAP_KEYS.includes(node.text)) {
      record('committed', node.text, node)
    }

    ts.forEachChild(node, walk)
  }
  walk(source)

  return found
}

/** The ten shapes the two regexes were run against. Nine of them got through. */
const TEN_SHAPES: ReadonlyArray<{ name: string; caughtBefore: boolean; source: string }> = [
  {
    name: 'a plain committed read with no pending side in sight - ExportActions.tsx:151',
    caughtBefore: false,
    source: `const revision = (file.pdmData?.revision || '').trim()`,
  },
  {
    name: 'reversed using ?? instead of ||',
    caughtBefore: false,
    source: `const n = file.pdmData?.part_number ?? file.pendingMetadata?.part_number ?? ''`,
  },
  {
    name: 'reversed via a ternary',
    caughtBefore: false,
    source: `const n = file.pdmData?.description ? file.pdmData.description : file.pendingMetadata?.description`,
  },
  {
    name: 'reversed with more than 120 characters between the two reads',
    caughtBefore: false,
    source: `const n = file.pdmData?.revision || /* ${'x'.repeat(140)} */ file.pendingMetadata?.revision || ''`,
  },
  {
    name: 'reversed after destructuring pdmData',
    caughtBefore: false,
    source: `const { part_number } = file.pdmData ?? {}\nconst n = part_number || file.pendingMetadata?.part_number`,
  },
  {
    name: 'reversed through a local alias',
    caughtBefore: false,
    source: `const committed = file.pdmData\nconst n = committed.part_number || file.pendingMetadata?.part_number`,
  },
  {
    name: 'a configuration map chosen with ?? rather than merged',
    caughtBefore: false,
    source: `const tabs = file.pendingMetadata?.config_tabs ?? committedTabs`,
  },
  {
    name: 'a configuration map chosen via a ternary',
    caughtBefore: false,
    source: `const tabs = file.pendingMetadata?.config_descriptions ? file.pendingMetadata.config_descriptions : committed`,
  },
  {
    name: 'a configuration map chosen off a destructured pending set',
    caughtBefore: false,
    source: `const { config_tabs } = file.pendingMetadata ?? {}\nconst tabs = config_tabs || committedTabs`,
  },
  {
    name: 'the exact shape the old regex was written for',
    caughtBefore: true,
    source: `const n = file.pdmData?.part_number || file.pendingMetadata?.part_number || ''`,
  },
]

describe('the scan catches every shape the regexes missed', () => {
  it.each(TEN_SHAPES)('catches: $name', ({ source }) => {
    expect(findUnroutedReads('shape.ts', source)).not.toEqual([])
  })

  it('confirms nine of the ten got past the regexes it replaces', () => {
    const reversed =
      /pdmData(!|\?)?\.(part_number|description|revision)\s*\|\|[^;\n]{0,120}?pendingMetadata/
    const replaced = /pendingMetadata(!|\?)?\.config_(tabs|descriptions)\s*\|\|/

    for (const shape of TEN_SHAPES) {
      const flat = shape.source.replace(/\s*\n\s*/g, ' ')
      expect(reversed.test(flat) || replaced.test(flat)).toBe(shape.caughtBefore)
    }
  })

  it('leaves a call site that went through the overlay alone', () => {
    const converted = `
      const revision = resolvedText(resolveRevision(file))
      const tabs = resolveConfigurationTabs(file)
      const description = resolveConfigurationDescription(file, name).value
    `
    expect(findUnroutedReads('converted.ts', converted)).toEqual([])
  })

  it('does not flag a field that is written rather than read', () => {
    const write = `store.updatePendingMetadata(path, { part_number: 'PN-1', revision: 'B' })`
    expect(findUnroutedReads('write.ts', write)).toEqual([])
  })
})

describe('no call site decides the overlay for itself', () => {
  const SOURCE_ROOT = join(__dirname, '..', '..')

  /**
   * Files that read one side on purpose, each with the reason it is not a bug.
   *
   * An upper bound, not an equality: converting one of these must not break the scan, so the
   * assertion is that every offender is listed here rather than that every entry still offends.
   * Adding to it is the deliberate act - a new file that reads the committed side fails until
   * somebody writes down why.
   */
  const DELIBERATE = new Map<string, string>([
    [
      'lib/metadata/checkinMetadata.ts',
      'The write plan check-in hands over wants the committed side by definition: it rewrites the fields the file never took, and the database row is what they should hold.',
    ],
    [
      'features/source/browser/hooks/useConfigHandlers.ts',
      'Same: the committed row is what buildMetadataWritePlan consults for the fields the datacard edit does not name. The pending maps it reads are the ones it is about to store, where merging the committed values in would defeat dropCommittedPendingMetadata.',
    ],
    [
      'features/integrations/solidworks/SolidWorksPanel.tsx',
      'A database-versus-file comparison. Overlaying a pending edit would ask whether the file agrees with what the user just typed and report "already up to date" for a file still holding the old value, which is the divergence the panel exists to surface.',
    ],
    [
      'features/source/explorer/file-tree/hooks/useVaultTree.ts',
      'Counts cloud-only files that have never been checked in. The question is whether the server row has a revision yet, not what the field would display.',
    ],
    [
      'features/change-control/deviations/DeviationsView.tsx',
      'A deviation names a checked-in file state: file_revision is stored beside file_version and has to be the pair the server holds, and affected_part_numbers is a durable server list that must not carry a number no file in the database has yet.',
    ],
    [
      'lib/commands/handlers/info.ts',
      'The `metadata` command prints both sides on purpose - the committed block, then a [Pending Changes] block - so the reader can see the difference the overlay exists to hide.',
    ],
    [
      'hooks/useLoadFiles.ts',
      'The load-time merge, which is where committed data is assembled. Its reads are diagnostics plus the move-detection mirror that seeds pendingMetadata from the row.',
    ],
    [
      'hooks/useRealtimeSubscriptions.ts',
      'Logs the row a realtime event arrived for, to compare against the event payload.',
    ],
    [
      'stores/slices/filesSlice.ts',
      'The store layer that owns pendingMetadata and decides what an edit is.',
    ],
    [
      'lib/pendingMetadata.ts',
      'Compares the two sides against each other to drop edits the database already has, which is the one job that needs them apart.',
    ],
    [
      'lib/supabase/files/checkout.ts',
      'Builds the RPC payload from the pending edit alone: the server is being told what changed, not what the field holds.',
    ],
    [
      'lib/metadata/divergence.ts',
      'Owns the reserved configuration-map keys the overlay reads through.',
    ],
    [
      'lib/metadata/configurationMaps.ts',
      'Owns the merge the overlay applies to the configuration maps.',
    ],
    [
      'lib/supabase/files/queries.ts',
      'Names the reserved configuration-map keys in the select list that fetches them.',
    ],
    ['lib/metadata/overlay.ts', 'Where the rule lives.'],
    ['lib/metadata/overlayCallSites.test.ts', 'Quotes the shapes it replaced.'],
    ['stores/types.ts', 'Documents the pending fields in comments.'],
  ])

  function sourceFiles(directory: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
      else if (/\.tsx?$/.test(entry)) found.push(path)
    }
    return found
  }

  // Tests are excluded: a test that quotes the bad shape is documenting it, and every fixture in
  // the suite builds both sides by hand. Production code is what ships and what this scan is for.
  const files = sourceFiles(SOURCE_ROOT)
    .filter((path) => !/\.test\.tsx?$/.test(path) || path.endsWith('overlayCallSites.test.ts'))
    .map((path) => ({ path: relative(SOURCE_ROOT, path), text: readFileSync(path, 'utf8') }))

  it('finds source to scan, so a broken scan cannot pass by finding nothing', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('proves the scan is looking at the files it claims to, by finding the allowed ones', () => {
    const scanned = files
      .filter((file) => findUnroutedReads(file.path, file.text).length > 0)
      .map((file) => file.path)

    expect(scanned.length).toBeGreaterThan(0)
  })

  it('reads no overlay-governed field outside the overlay and the reasons written down here', () => {
    const allowed = new Set([...DELIBERATE.keys()].map((path) => path.split('/').join(sep)))

    const offenders = files
      .filter((file) => !allowed.has(file.path))
      .flatMap((file) =>
        findUnroutedReads(file.path, file.text).map(
          (read) => `${file.path}:${read.line} ${read.side} ${read.field}`,
        ),
      )

    expect(offenders).toEqual([])
  })
})
