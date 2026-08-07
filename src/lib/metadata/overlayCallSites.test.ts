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
 * ## Why the scan asks the type checker
 *
 * The rule is not "do not read these two in the wrong order", it is **"do not read either side of
 * an overlay-governed field directly"**, with the exceptions named one at a time and a reason
 * written beside each. A new unrouted read then fails by default instead of needing the guard to
 * have predicted its shape.
 *
 * Two earlier guards tried to enforce that and lost, both for the same reason. The first was two
 * regexes looking for the reversed shape - a committed field, `||`, then `pendingMetadata` within
 * 120 characters - which caught one of the ten ways there are to get this wrong. The second read
 * the syntax tree, followed an alias and a destructuring, and caught all ten; then it lost to nine
 * more, because every rule it had was rooted at an identifier or property literally spelled
 * `pdmData` or `pendingMetadata`. A parameter destructured under another name got past it, so did
 * array destructuring, the row carried on an object property, the row returned from a helper,
 * `file['pdmData']`, a computed field name, a reassignment rather than a declaration - and, the one
 * no name-based rule can ever reach, a row that never passes through such a name at all, which is
 * what a Supabase result or a `serverFiles.find(...)` is.
 *
 * Chasing shapes is the losing game; there is always another spelling. What every one of them has
 * in common is not a name, it is a type: the value being read is a `PDMFile` or a `PendingMetadata`
 * however it was spelled and however it arrived. So the scan builds a real program from the
 * project's own `tsconfig.json` and asks the checker which interface each property it reads was
 * declared on. `SHAPES` below runs all twenty-one shapes against it and records which of them the
 * name-rooted scan caught, so the widening is measured rather than claimed.
 *
 * ## What this scan cannot see
 *
 * - A value typed `any` or `unknown` carries no property symbol. `custom_properties` is exactly
 *   that - an untyped JSON column - which is why the two reserved configuration-map keys are still
 *   matched by name, and why that one rule also matches their declarations and writes.
 * - A row whose columns land in an anonymous type rather than in `PDMFile`: a Supabase select with
 *   its own shape, the file rows nested inside an RFQ or a review. Those were measured and left
 *   out on purpose - there is no local file beside them and so no pending side to overlay, and the
 *   row is the whole answer.
 * - Test files, which are not scanned at all. A test that quotes the bad shape is documenting it.
 *   This file used to be inside its own scan and matched itself four times on the reserved-key
 *   rule, which is what let the anti-vacuity test below pass with the scan's main rules deleted.
 *
 * ## What would replace it
 *
 * A `PDMFile` whose `part_number`, `description` and `revision` are branded so that only
 * `overlay.ts` can unwrap them. An unrouted read would then fail to compile and this scan would
 * become a backstop for the untyped edges above rather than the guard. It is not a rider on a test:
 * every producer of a row would have to brand it, which is `src/types/pdm.ts`, `overlay.ts`, the
 * Supabase mappers and all twenty-one files named below, moving together.
 */

import { join, relative } from 'node:path'

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

/**
 * The two carriers, named by the interface the fields are declared on.
 *
 * This is the whole widening. A read is unrouted when the property it reads was declared on one of
 * these, whatever the value holding it happens to be called: `file.pdmData`, `committed`, `row`,
 * `rows[0]`, `serverFiles.find(...)` and a Supabase result all answer to `PDMFile`.
 */
const COMMITTED_CARRIER = { interfaceName: 'PDMFile', declaredIn: 'src/types/pdm.ts' }
const PENDING_CARRIER = { interfaceName: 'PendingMetadata', declaredIn: 'src/stores/types.ts' }

/**
 * The committed fields the overlay speaks for.
 *
 * `PDMFile` carries forty-odd columns and the overlay governs three of them, so reading `file_path`
 * off a row is not this rule's business. `PendingMetadata` needs no such list: every field on it is
 * an edit to a governed field, which is all that interface is.
 */
const COMMITTED_FIELDS = new Set(['part_number', 'description', 'revision'])

/**
 * The reserved keys the committed configuration maps live under inside `custom_properties`.
 *
 * Matched by name because there is nothing else to match: the column is typed `unknown`, so no
 * property symbol exists to ask about. The rule is blunt and catches the keys wherever they appear,
 * including where they are declared and written.
 */
const COMMITTED_MAP_KEYS = new Set(['_config_tabs', '_config_descriptions'])

type OverlaySide = 'committed' | 'pending'

/** Which rule found a read. `SHAPES` exercises every one of them. */
type ScanRule = 'property' | 'element' | 'computed' | 'binding' | 'reserved-key'

const SCAN_RULES: readonly ScanRule[] = [
  'property',
  'element',
  'computed',
  'binding',
  'reserved-key',
]

export interface UnroutedRead {
  side: OverlaySide
  field: string
  line: number
  /** The function the read sits in, which is the unit an allowance names. */
  symbol: string
  rule: ScanRule
}

function posixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

/** The carrier a property was declared on, if it was declared on one at all. */
function sideOfProperty(symbol: ts.Symbol | undefined, field: string): OverlaySide | undefined {
  for (const declaration of symbol?.declarations ?? []) {
    const parent = declaration.parent
    if (!ts.isInterfaceDeclaration(parent)) continue

    const declaredIn = posixPath(parent.getSourceFile().fileName)
    if (
      parent.name.text === COMMITTED_CARRIER.interfaceName &&
      declaredIn.endsWith(COMMITTED_CARRIER.declaredIn) &&
      COMMITTED_FIELDS.has(field)
    ) {
      return 'committed'
    }
    if (
      parent.name.text === PENDING_CARRIER.interfaceName &&
      declaredIn.endsWith(PENDING_CARRIER.declaredIn)
    ) {
      return 'pending'
    }
  }
  return undefined
}

/** Assigning, deleting or incrementing a field is not reading it. */
function isWriteTarget(node: ts.Node): boolean {
  const parent = node.parent
  if (!parent) return false
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true
  }
  if (ts.isDeleteExpression(parent)) return true
  return (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  )
}

function nameOfFunctionHolder(node: ts.Node): string | undefined {
  const parent = node.parent
  if (!parent) return undefined
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  // `const handleX = useCallback(() => ...)`: the name is one call out. Only for a bare callee, so
  // a callback handed to `.filter(...)` keeps looking for the function it sits in.
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression)) {
    return nameOfFunctionHolder(parent)
  }
  return undefined
}

/**
 * The function a read sits in.
 *
 * A whole file is too coarse to exempt: `useConfigHandlers.ts` is 978 lines, and allowing the file
 * made a new unrouted read anywhere inside it invisible. A line number is too fine to survive an
 * edit. A function name survives a refactor of its body and fails loudly when the function goes,
 * which is the failure that should happen.
 */
function enclosingSymbol(node: ts.Node): string {
  let current: ts.Node | undefined = node
  let outermostDeclaration: string | undefined

  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const held = nameOfFunctionHolder(current)
      if (held) return held
    }
    if (ts.isClassDeclaration(current) && current.name) return current.name.text
    if (ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) {
      outermostDeclaration = current.name.text
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      outermostDeclaration = current.name.text
    }
    current = current.parent
  }

  return outermostDeclaration ?? '<module>'
}

/**
 * Every read of an overlay-governed field in one file that did not go through the overlay.
 *
 * The checker does the work a name-based scan cannot: `getSymbolAtLocation` on the property being
 * read resolves through aliases, destructurings, parameters, helper return values and query
 * results alike, and answers with the interface the property was declared on.
 */
/**
 * Every field name either carrier could be asked for.
 *
 * A pre-filter, not a rule: it decides which nodes are worth asking the checker about, and asking
 * about every property access and every destructuring in the project instead costs twenty seconds
 * rather than three. It cannot narrow the answer, because `sideOfProperty` rejects anything not
 * declared on a carrier anyway, and the pending names are read off the interface rather than
 * listed so it cannot fall behind it.
 */
const candidatesByProgram = new WeakMap<ts.Program, ReadonlySet<string>>()

function candidateFields(program: ts.Program): ReadonlySet<string> {
  const cached = candidatesByProgram.get(program)
  if (cached) return cached

  const names = new Set(COMMITTED_FIELDS)

  for (const source of program.getSourceFiles()) {
    if (!posixPath(source.fileName).endsWith(PENDING_CARRIER.declaredIn)) continue
    for (const statement of source.statements) {
      if (!ts.isInterfaceDeclaration(statement)) continue
      if (statement.name.text !== PENDING_CARRIER.interfaceName) continue
      for (const member of statement.members) {
        if (member.name && ts.isIdentifier(member.name)) names.add(member.name.text)
      }
    }
  }

  candidatesByProgram.set(program, names)
  return names
}

export function findUnroutedReads(program: ts.Program, source: ts.SourceFile): UnroutedRead[] {
  const checker = program.getTypeChecker()
  const candidates = candidateFields(program)
  const found: UnroutedRead[] = []

  const record = (node: ts.Node, side: OverlaySide, field: string, rule: ScanRule) => {
    found.push({
      side,
      field,
      rule,
      symbol: enclosingSymbol(node),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    })
  }

  /** The fields an access could name: one for a literal, several for a union of literals. */
  const namedFields = (argument: ts.Expression): string[] => {
    if (ts.isStringLiteralLike(argument)) return [argument.text]
    const type = checker.getTypeAtLocation(argument)
    return (type.isUnion() ? type.types : [type])
      .filter((part): part is ts.StringLiteralType => part.isStringLiteral())
      .map((part) => part.value)
  }

  const propertyOf = (target: ts.Expression, field: string): ts.Symbol | undefined =>
    checker.getPropertyOfType(checker.getNonNullableType(checker.getTypeAtLocation(target)), field)

  const walk = (node: ts.Node) => {
    if (!isWriteTarget(node)) {
      if (ts.isPropertyAccessExpression(node)) {
        const field = node.name.text
        if (candidates.has(field)) {
          const side = sideOfProperty(checker.getSymbolAtLocation(node.name), field)
          if (side) record(node, side, field, 'property')
        }
      } else if (ts.isElementAccessExpression(node)) {
        // Whether the field is named by a literal or by an expression, the property has to be
        // looked up on the object's type: the name in the brackets carries no symbol of its own.
        const rule: ScanRule = ts.isStringLiteralLike(node.argumentExpression)
          ? 'element'
          : 'computed'
        for (const field of namedFields(node.argumentExpression)) {
          if (!candidates.has(field)) continue
          const side = sideOfProperty(propertyOf(node.expression, field), field)
          if (side) record(node, side, field, rule)
        }
      } else if (ts.isBindingElement(node) && ts.isIdentifier(node.propertyName ?? node.name)) {
        // Same again for a destructuring: the binding's own symbol is the local it introduces, so
        // the property is looked up on the type of the pattern it was taken out of.
        const field = (node.propertyName ?? node.name) as ts.Identifier
        if (candidates.has(field.text)) {
          const pattern = checker.getNonNullableType(checker.getTypeAtLocation(node.parent))
          const side = sideOfProperty(checker.getPropertyOfType(pattern, field.text), field.text)
          if (side) record(node, side, field.text, 'binding')
        }
      }
    }

    if (
      (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) &&
      COMMITTED_MAP_KEYS.has(node.text)
    ) {
      record(node, 'committed', node.text, 'reserved-key')
    }

    ts.forEachChild(node, walk)
  }
  walk(source)

  return found
}

// ============================================
// The shapes
// ============================================

/**
 * The scan this one replaces: every rule rooted at a name.
 *
 * Kept, and run, so that what the type-aware scan added is measured against it instead of being
 * asserted in a comment. It is the previous guard in miniature - the initial alias map, aliases
 * collected from any initializer mentioning one of the two names, and reads found off an
 * identifier or property spelled that way.
 */
function findNameRootedReads(text: string): string[] {
  const source = ts.createSourceFile('shape.ts', text, ts.ScriptTarget.Latest, true)
  const aliases = new Map<string, OverlaySide>([
    ['pdmData', 'committed'],
    ['pendingMetadata', 'pending'],
  ])
  const found: string[] = []

  const sideOfText = (value: string): OverlaySide | undefined => {
    if (/\bpdmData\b/.test(value)) return 'committed'
    if (/\bpendingMetadata\b/.test(value)) return 'pending'
    return undefined
  }

  const sideOf = (expression: ts.Expression): OverlaySide | undefined => {
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.name.text === 'pdmData') return 'committed'
      if (expression.name.text === 'pendingMetadata') return 'pending'
      return undefined
    }
    if (ts.isIdentifier(expression)) return aliases.get(expression.text)
    return undefined
  }

  const governed = (side: OverlaySide, field: string): boolean =>
    side === 'committed'
      ? COMMITTED_FIELDS.has(field)
      : COMMITTED_FIELDS.has(field) || field.startsWith('config_') || field === 'tab_number'

  const collectAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const side = sideOfText(node.initializer.getText(source))
      if (side) aliases.set(node.name.text, side)
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(source)

  const walk = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const side = sideOfText(node.initializer.getText(source))
      if (side) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name
          if (ts.isIdentifier(property) && governed(side, property.text)) found.push(property.text)
        }
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const side = sideOf(node.expression)
      if (side && governed(side, node.name.text)) found.push(node.name.text)
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const side = sideOf(node.expression)
      const field = node.argumentExpression.text
      if (side && governed(side, field)) found.push(field)
    }
    if (
      (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) &&
      COMMITTED_MAP_KEYS.has(node.text)
    ) {
      found.push(node.text)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)

  return found
}

interface Shape {
  name: string
  /** Whether this scan must find a read in it. */
  unrouted: boolean
  /** Whether the name-rooted scan that came before found one. */
  nameScan: boolean
  source: string
}

/**
 * Every way of getting this wrong that either guard has been shown, as compiled code.
 *
 * The first ten are the ones the regexes were run against. The rest are the ones that got past the
 * name-rooted scan that replaced them: each is a way of holding a row without ever writing the word
 * `pdmData` next to the field.
 */
const SHAPES: readonly Shape[] = [
  {
    name: 'a plain committed read with no pending side in sight - ExportActions.tsx:151',
    unrouted: true,
    nameScan: true,
    source: `export function exported(file: LocalFile) { return (file.pdmData?.revision || '').trim() }`,
  },
  {
    name: 'reversed using ?? instead of ||',
    unrouted: true,
    nameScan: true,
    source: `export function number(file: LocalFile) { return file.pdmData?.part_number ?? file.pendingMetadata?.part_number ?? '' }`,
  },
  {
    name: 'reversed via a ternary',
    unrouted: true,
    nameScan: true,
    source: `export function text(file: LocalFile) { return file.pdmData?.description ? file.pdmData.description : file.pendingMetadata?.description }`,
  },
  {
    name: 'reversed with more than 120 characters between the two reads',
    unrouted: true,
    nameScan: true,
    source: `export function rev(file: LocalFile) { return file.pdmData?.revision || /* ${'x'.repeat(140)} */ file.pendingMetadata?.revision || '' }`,
  },
  {
    name: 'reversed after destructuring pdmData',
    unrouted: true,
    nameScan: true,
    source: `export function number(file: LocalFile) {
  const { part_number } = file.pdmData ?? ({} as PDMFile)
  return part_number || file.pendingMetadata?.part_number
}`,
  },
  {
    name: 'reversed through a local alias',
    unrouted: true,
    nameScan: true,
    source: `export function number(file: LocalFile) {
  const committed = file.pdmData
  return committed?.part_number || file.pendingMetadata?.part_number
}`,
  },
  {
    name: 'a configuration map chosen with ?? rather than merged',
    unrouted: true,
    nameScan: true,
    source: `export function tabs(file: LocalFile, committed: Record<string, string>) { return file.pendingMetadata?.config_tabs ?? committed }`,
  },
  {
    name: 'a configuration map chosen via a ternary',
    unrouted: true,
    nameScan: true,
    source: `export function descriptions(file: LocalFile, committed: Record<string, string>) { return file.pendingMetadata?.config_descriptions ? file.pendingMetadata.config_descriptions : committed }`,
  },
  {
    name: 'a configuration map chosen off a destructured pending set',
    unrouted: true,
    nameScan: true,
    source: `export function tabs(file: LocalFile, committed: Record<string, string>) {
  const { config_tabs } = file.pendingMetadata ?? ({} as PendingMetadata)
  return config_tabs || committed
}`,
  },
  {
    name: 'the exact shape the old regex was written for',
    unrouted: true,
    nameScan: true,
    source: `export function number(file: LocalFile) { return file.pdmData?.part_number || file.pendingMetadata?.part_number || '' }`,
  },
  {
    name: 'the field named by a string rather than a dot',
    unrouted: true,
    nameScan: true,
    source: `export function number(file: LocalFile) { return file.pdmData?.['part_number'] ?? '' }`,
  },
  {
    name: 'the committed configuration map read out of the untyped column by its reserved key',
    unrouted: true,
    nameScan: true,
    source: `export function tabs(file: LocalFile) {
  const properties = (file.pdmData?.custom_properties ?? {}) as Record<string, unknown>
  return properties['_config_tabs']
}`,
  },
  {
    name: 'a parameter destructured under another name',
    unrouted: true,
    nameScan: false,
    source: `export function number({ pdmData: committed }: LocalFile) { return committed?.part_number ?? '' }`,
  },
  {
    name: 'array destructuring, which the alias collector only followed for a plain name',
    unrouted: true,
    nameScan: false,
    source: `export function number(files: LocalFile[]) {
  const [{ pdmData: row }] = files
  return row?.part_number ?? ''
}`,
  },
  {
    name: 'the row carried on an object property',
    unrouted: true,
    nameScan: false,
    source: `export function number(file: LocalFile) {
  const carried = { row: file.pdmData }
  return carried.row?.part_number ?? ''
}`,
  },
  {
    name: 'the row returned from a helper',
    unrouted: true,
    nameScan: false,
    source: `function rowOf(file: LocalFile) { return file.pdmData }
export function number(file: LocalFile) { return rowOf(file)?.part_number ?? '' }`,
  },
  {
    name: 'the row reached by string rather than by name',
    unrouted: true,
    nameScan: false,
    source: `export function number(file: LocalFile) { return file['pdmData']?.part_number ?? '' }`,
  },
  {
    name: 'a computed field name',
    unrouted: true,
    nameScan: false,
    source: `export function field(file: LocalFile, name: 'part_number' | 'description') { return file.pdmData?.[name] ?? '' }`,
  },
  {
    name: 'reassignment rather than declaration',
    unrouted: true,
    nameScan: false,
    source: `export function number(file: LocalFile) {
  let row: PDMFile | undefined
  row = file.pdmData
  return row?.part_number ?? ''
}`,
  },
  {
    name: 'a row that never passes through a name like pdmData - a query result',
    unrouted: true,
    nameScan: false,
    source: `export function number(rows: PDMFile[]) { return rows[0]?.part_number ?? '' }`,
  },
  {
    name: 'a row found in a server list - serverFiles.find(...)',
    unrouted: true,
    nameScan: false,
    source: `export function revisionOf(rows: PDMFile[], id: string) { return rows.find((row) => row.id === id)?.revision ?? '' }`,
  },
  {
    name: 'nothing, for a call site that went through the overlay',
    unrouted: false,
    nameScan: false,
    source: `export function shown(file: LocalFile) {
  return { revision: resolvedText(resolveRevision(file)), tabs: resolveConfigurationTabs(file) }
}`,
  },
  {
    name: 'nothing, for a field that is written rather than read',
    unrouted: false,
    nameScan: false,
    source: `export function edit(pending: PendingMetadata): PendingMetadata {
  pending.revision = 'B'
  return { ...pending, part_number: 'PN-1' }
}`,
  },
  {
    name: 'nothing, for a field of the same name on some other type',
    unrouted: false,
    nameScan: false,
    source: `export function label(item: { description: string; revision: string }) { return item.description + item.revision }`,
  },
]

const SHAPE_PREAMBLE = [
  `import type { LocalFile, PendingMetadata } from '@/stores/types'`,
  `import type { PDMFile } from '@/types/pdm'`,
  `import { resolveConfigurationTabs, resolveRevision, resolvedText } from '@/lib/metadata/overlay'`,
  '',
  '',
].join('\n')

function shapePath(index: number): string {
  return posixPath(join(__dirname, `overlayShape.${index}.ts`))
}

const PROJECT_ROOT = join(__dirname, '..', '..', '..')
const SOURCE_ROOT = join(PROJECT_ROOT, 'src')

/**
 * One program over the project and the shapes, built once.
 *
 * The shapes are compiled alongside the real source rather than in isolation so that they resolve
 * the same `LocalFile` and `PDMFile` the application does - a fixture typed against a copy of the
 * interface would keep passing after the real one moved.
 */
function buildProgram(): { program: ts.Program; projectFiles: readonly string[] } {
  const { config } = ts.readConfigFile(join(PROJECT_ROOT, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, PROJECT_ROOT)
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noEmit: true,
  }

  const shapes = new Map<string, string>()
  SHAPES.forEach((shape, index) => shapes.set(shapePath(index), SHAPE_PREAMBLE + shape.source))

  const host = ts.createCompilerHost(options, true)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (name) => shapes.get(posixPath(name)) ?? readFile(name)
  host.fileExists = (name) => shapes.has(posixPath(name)) || fileExists(name)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = shapes.get(posixPath(name))
    if (text === undefined) return getSourceFile(name, languageVersion, onError, shouldCreate)
    return ts.createSourceFile(name, text, languageVersion, true)
  }

  const projectFiles = parsed.fileNames.map(posixPath)
  return {
    program: ts.createProgram([...projectFiles, ...shapes.keys()], options, host),
    projectFiles,
  }
}

const { program, projectFiles } = buildProgram()

function shapeReads(index: number): UnroutedRead[] {
  const source = program.getSourceFile(shapePath(index))
  if (!source) throw new Error(`shape ${index} never reached the program`)

  const errors = program
    .getSemanticDiagnostics(source)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
  if (errors.length > 0) throw new Error(`shape ${index} does not compile: ${errors.join('; ')}`)

  return findUnroutedReads(program, source)
}

const INDEXED_SHAPES = SHAPES.map((shape, index) => ({ ...shape, index }))

describe('the scan finds a raw read however it is spelled', () => {
  it.each(INDEXED_SHAPES.filter((shape) => shape.unrouted))('catches: $name', ({ index }) => {
    expect(shapeReads(index)).not.toEqual([])
  })

  it.each(INDEXED_SHAPES.filter((shape) => !shape.unrouted))('finds: $name', ({ index }) => {
    expect(shapeReads(index)).toEqual([])
  })

  it('measures what the name-rooted scan before it caught, rather than claiming it', () => {
    const caught = INDEXED_SHAPES.filter(
      (shape) => findNameRootedReads(shape.source).length > 0,
    ).map((shape) => shape.name)

    expect(caught).toEqual(INDEXED_SHAPES.filter((shape) => shape.nameScan).map((s) => s.name))
    expect(INDEXED_SHAPES.filter((shape) => shape.unrouted && !shape.nameScan)).toHaveLength(9)
  })

  it('takes the fields it looks for from the carriers themselves', () => {
    expect([...candidateFields(program)].sort()).toEqual([
      'config_descriptions',
      'config_tabs',
      'description',
      'part_number',
      'revision',
      'tab_number',
    ])
  })

  it('exercises every rule it has, so a rule cannot be deleted unnoticed', () => {
    const exercised = new Set(INDEXED_SHAPES.flatMap((s) => shapeReads(s.index).map((r) => r.rule)))

    expect([...exercised].sort()).toEqual([...SCAN_RULES].sort())
  })
})

// ============================================
// The call sites
// ============================================

/**
 * One file's deliberate reads, scoped to the functions that make them.
 *
 * `symbols` is the point. A whole-file allowance covered `useConfigHandlers.ts` at 978 lines and
 * `useLoadFiles.ts` beside it, so a new unrouted read anywhere in either was invisible - an
 * exemption for one deliberate read exempted everything around it. `'*'` still means the whole
 * module, and is used once, for the module the rule is made of.
 */
interface Allowance {
  /** Path relative to `src`, in posix form. */
  file: string
  symbols: readonly string[]
  reason: string
}

const DELIBERATE: readonly Allowance[] = [
  {
    file: 'features/change-control/deviations/DeviationsView.tsx',
    symbols: ['handleTagFiles', 'handleDrop'],
    reason:
      'A deviation names a checked-in file state: file_revision is stored beside file_version and has to be the pair the server holds, and affected_part_numbers is a durable server list that must not carry a number no file in the database has yet.',
  },
  {
    file: 'features/integrations/solidworks/SolidWorksPanel.tsx',
    symbols: ['handleSyncMetadata', 'SWPropertiesTab'],
    reason:
      'A database-versus-file comparison. Overlaying a pending edit would ask whether the file agrees with what the user just typed and report "already up to date" for a file still holding the old value, which is the divergence the panel exists to surface.',
  },
  {
    file: 'features/items/itemBrowser/components/ItemExpandedSections.tsx',
    symbols: ['FileRow'],
    reason:
      'Lists the server rows linked to an item. No local file stands beside them, so there is no pending side to overlay and the row is the whole answer.',
  },
  {
    file: 'features/source/browser/hooks/configWritePlan.ts',
    symbols: ['buildConfigurationTabWritePlan', 'buildConfigurationDescriptionWritePlan'],
    reason:
      'Reads back the edit `partNumberEdit` has just built out of `resolvePartNumber`, so the overlay has already decided. It is shaped as a PendingMetadata because that is what the planner takes.',
  },
  {
    file: 'features/source/browser/hooks/useConfigHandlers.ts',
    symbols: [
      'handleConfigTabChange',
      'handleConfigDescriptionChange',
      'hasPendingMetadataChanges',
      'saveConfigsToSWFile',
    ],
    reason:
      'The committed row is what buildMetadataWritePlan consults for the fields the datacard edit does not name. The pending maps it reads are the ones it is about to store, where merging the committed values in would defeat dropCommittedPendingMetadata.',
  },
  {
    file: 'features/source/details/DetailsPanel.tsx',
    symbols: ['DetailsPanel'],
    reason:
      'Re-issues a write that never landed, from the values it failed on. A retry has to carry the edit as the user left it, not the field as it now displays.',
  },
  {
    file: 'features/source/explorer/file-tree/hooks/useVaultTree.ts',
    symbols: ['folderMetrics', 'getDiffCounts'],
    reason:
      'Counts cloud-only files that have never been checked in. The question is whether the server row has a revision yet, not what the field would display.',
  },
  {
    file: 'hooks/useLoadFiles.ts',
    symbols: ['runLoadFiles'],
    reason:
      'The load-time merge, which is where committed data is assembled. Its reads are diagnostics plus the move-detection mirror that seeds pendingMetadata from the row.',
  },
  {
    file: 'hooks/useRealtimeSubscriptions.ts',
    symbols: ['unsubscribeFiles'],
    reason: 'Logs the row a realtime event arrived for, to compare against the event payload.',
  },
  {
    file: 'lib/commands/handlers/fileOps.ts',
    symbols: ['execute'],
    reason:
      'Asks whether a pasted file carries any pending value at all before handing the whole set to the store. It reads the set as a set, never one field as a value.',
  },
  {
    file: 'lib/commands/handlers/info.ts',
    symbols: ['handleMetadata'],
    reason:
      'The `metadata` command prints both sides on purpose - the committed block, then a [Pending Changes] block - so the reader can see the difference the overlay exists to hide.',
  },
  {
    file: 'lib/commands/handlers/syncMetadataPlan.ts',
    symbols: ['buildPartAssemblyPushPlan'],
    reason:
      'Reads back the synthetic pending set it just built out of resolveFileMetadata, to hand the planner a committed side that agrees with it.',
  },
  {
    file: 'lib/metadata/checkinMetadata.ts',
    symbols: ['settleMetadataForCheckin'],
    reason:
      'The write plan check-in hands over wants the committed side by definition: it rewrites the fields the file never took, and the database row is what they should hold.',
  },
  {
    file: 'lib/metadata/configurationMaps.ts',
    symbols: ['ConfigurationMapPayload', 'buildConfigurationMapPayload'],
    reason:
      'Owns the merge the overlay applies to the configuration maps, and the payload shape it travels in.',
  },
  {
    file: 'lib/metadata/documentProperties.ts',
    symbols: ['CONFIG_TABS_KEY', 'CONFIG_DESCRIPTIONS_KEY'],
    reason: 'Declares the reserved configuration-map keys the overlay reads through.',
  },
  {
    file: 'lib/metadata/overlay.ts',
    symbols: ['*'],
    reason:
      'Where the rule lives. Every read in it is the overlay, so the module is allowed whole.',
  },
  {
    file: 'lib/metadata/pendingEdits.ts',
    symbols: ['applyPendingEdit', 'retryEdit'],
    reason:
      'Merges one edit into the pending set and names the fields a retry has to cover. Both are the edit as an edit, which is the one thing the overlay is not about.',
  },
  {
    file: 'lib/metadata/writePlan.ts',
    symbols: ['buildMetadataWritePlan'],
    reason:
      'Turns an edit into the properties to write into the file. The edit is its input, and the committed side reaches it separately as `committed`.',
  },
  {
    file: 'lib/metadata/writeState.ts',
    symbols: ['listWriteAddresses', 'scopePendingToGroup'],
    reason:
      'Addresses an edit field by field so a partial write can be recorded, and narrows it to one write group. Neither asks what a field holds.',
  },
  {
    file: 'lib/pendingMetadata.ts',
    symbols: ['CONFIG_TABS_KEY', 'CONFIG_DESCRIPTIONS_KEY', 'dropCommittedPendingMetadata'],
    reason:
      'Compares the two sides against each other to drop edits the database already has, which is the one job that needs them apart.',
  },
  {
    file: 'stores/slices/filesSlice.ts',
    symbols: ['clearPendingConfigMetadata'],
    reason: 'The store layer that owns pendingMetadata and decides what an edit is.',
  },
]

interface FoundRead extends UnroutedRead {
  file: string
}

/**
 * Every unrouted read in the project.
 *
 * Tests are excluded: a test that quotes the bad shape is documenting it, and every fixture in the
 * suite builds both sides by hand. This file was inside its own scan until it was found matching
 * itself four times on the reserved-key rule, which is exactly how the anti-vacuity test below
 * survived having the scan's main rules deleted.
 */
const FOUND: readonly FoundRead[] = projectFiles
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .flatMap((path) => {
    const source = program.getSourceFile(path)
    if (!source) return []
    const file = posixPath(relative(SOURCE_ROOT, source.fileName))
    return findUnroutedReads(program, source).map((read) => ({ ...read, file }))
  })

function allowanceFor(file: string): Allowance | undefined {
  return DELIBERATE.find((allowance) => allowance.file === file)
}

function isAllowed(read: FoundRead): boolean {
  const allowance = allowanceFor(read.file)
  if (!allowance) return false
  return allowance.symbols.includes('*') || allowance.symbols.includes(read.symbol)
}

describe('no call site decides the overlay for itself', () => {
  it('scans the project, so a scan that has stopped finding anything cannot pass', () => {
    expect(projectFiles.length).toBeGreaterThan(500)
    expect(FOUND.length).toBeGreaterThan(100)
  })

  it('reads no overlay-governed field outside the overlay and the reasons written down here', () => {
    const offenders = FOUND.filter((read) => !isAllowed(read)).map(
      (read) => `${read.file}#${read.symbol}:${read.line} ${read.side} ${read.field}`,
    )

    expect(offenders).toEqual([])
  })

  it('keeps no allowance for a read that is no longer there', () => {
    // An exemption for a problem that no longer exists is how the list rots, and it is also what
    // makes the rest of this block mean something: delete a rule from the scan and these go stale
    // in a heap, which is the failure the old `scanned.length > 0` could not produce.
    const stale = DELIBERATE.flatMap((allowance) =>
      allowance.symbols
        .filter((symbol) =>
          symbol === '*'
            ? !FOUND.some((read) => read.file === allowance.file)
            : !FOUND.some((read) => read.file === allowance.file && read.symbol === symbol),
        )
        .map((symbol) => `${allowance.file}#${symbol}`),
    )

    expect(stale).toEqual([])
  })
})
