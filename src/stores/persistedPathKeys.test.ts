/**
 * The registry of path-keyed persisted maps, and the rename that has to carry every one of them.
 *
 * The failure this guards against is not a rename bug, it is a bookkeeping bug that produced one:
 * `renameFileInStore` listed the maps to migrate by hand, `persistedMetadataWriteState` was added
 * beside `persistedPendingMetadata` and never joined the list, and renaming a file moved the
 * pending value while orphaning the record of whether the file had accepted it. What made that
 * severe is the `promoted` mark - check-in's durable statement that the database holds a value the
 * file may not - which is set only after the pending value has already gone, so nothing else
 * recorded the doubt. After a reload the value read as clean.
 *
 * So the tests below are deliberately not "does this one map move". They walk the registry, so a
 * map registered tomorrow is covered by them today, and they check that the registry itself cannot
 * fall behind the state it is supposed to describe.
 */

import { join } from 'node:path'

import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PERSISTED_PATH_KEYED_MAPS,
  migratePathKeyedRecord,
  migratePersistedPathKeys,
  pickPersistedPathKeys,
  restorePersistedPathKeys,
  type PersistedPathKeyedState,
} from './persistedPathKeys'
import { usePDMStore } from './pdmStore'
import type { LocalFile } from './types'

const OLD_PATH = 'C:\\vault\\rings\\ORING-BUNA-70A.SLDPRT'
const NEW_PATH = 'C:\\vault\\rings\\ORING-VITON-75A.SLDPRT'

/** A distinguishable value per map, so a test can tell "moved" from "replaced by a default". */
function seeded(path: string): PersistedPathKeyedState {
  return {
    persistedPendingMetadata: { [path]: { part_number: 'PN-100' } },
    persistedMetadataWriteState: {
      [path]: { fields: { part_number: { state: 'failed', at: 'T', promoted: true } } },
    },
    persistedCopySource: { [path]: { sourceFileId: 'source-id', version: 3 } },
  }
}

function localFile(path: string): LocalFile {
  return {
    name: path.split('\\').pop() ?? path,
    path,
    relativePath: 'rings/' + (path.split('\\').pop() ?? path),
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '',
  }
}

describe('every registered map moves when a file is renamed', () => {
  const migrated = migratePersistedPathKeys(seeded(OLD_PATH), {
    oldPath: OLD_PATH,
    newPath: NEW_PATH,
    isDirectory: false,
  })

  it.each(PERSISTED_PATH_KEYED_MAPS)('carries %s to the new path', (map) => {
    expect(migrated[map][NEW_PATH]).toEqual(seeded(OLD_PATH)[map][OLD_PATH])
    expect(migrated[map][OLD_PATH]).toBeUndefined()
  })

  it('matches the old key without regard to case, since Windows reports either', () => {
    const migratedFromLowercase = migratePersistedPathKeys(seeded(OLD_PATH.toLowerCase()), {
      oldPath: OLD_PATH,
      newPath: NEW_PATH,
      isDirectory: false,
    })

    expect(migratedFromLowercase.persistedPendingMetadata[NEW_PATH]).toBeDefined()
  })

  it('carries everything beneath a renamed folder with it', () => {
    const inside = 'C:\\vault\\rings\\nested\\PART.SLDPRT'
    const record = migratePathKeyedRecord(
      { [inside]: 'kept', 'C:\\vault\\other\\PART.SLDPRT': 'untouched' },
      { oldPath: 'C:\\vault\\rings', newPath: 'C:\\vault\\seals', isDirectory: true },
    )

    expect(record['C:\\vault\\seals\\nested\\PART.SLDPRT']).toBe('kept')
    expect(record['C:\\vault\\other\\PART.SLDPRT']).toBe('untouched')
    expect(record[inside]).toBeUndefined()
  })

  it('leaves a record with no entry for the renamed path alone', () => {
    const record = { 'C:\\vault\\other.sldprt': 'untouched' }

    expect(
      migratePathKeyedRecord(record, {
        oldPath: OLD_PATH,
        newPath: NEW_PATH,
        isDirectory: false,
      }),
    ).toEqual(record)
  })
})

describe('the store applies the migration on a real rename', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI: { log: vi.fn() } },
      configurable: true,
      writable: true,
    })
    usePDMStore.setState({
      files: [localFile(OLD_PATH)],
      serverFiles: [],
      selectedFiles: [],
      ...seeded(OLD_PATH),
    })
  })

  it.each(PERSISTED_PATH_KEYED_MAPS)('rekeys %s alongside the file', (map) => {
    usePDMStore.getState().renameFileInStore(OLD_PATH, NEW_PATH, 'ORING-VITON-75A.SLDPRT')

    const state = usePDMStore.getState()

    expect(state[map][NEW_PATH]).toBeDefined()
    expect(state[map][OLD_PATH]).toBeUndefined()
  })

  it('restores the promoted mark onto the renamed file at the next load', () => {
    // The whole point. `setFiles` rebuilds the array from disk and restores the write state by
    // path, so a mark left at the old key is a mark nobody ever sees again - and the value it was
    // about reads as one the file accepted.
    usePDMStore.getState().renameFileInStore(OLD_PATH, NEW_PATH, 'ORING-VITON-75A.SLDPRT')
    usePDMStore.getState().setFiles([localFile(NEW_PATH)])

    const restored = usePDMStore.getState().files[0]

    expect(restored.path).toBe(NEW_PATH)
    expect(restored.metadataWriteState?.fields?.part_number).toEqual({
      state: 'failed',
      at: 'T',
      promoted: true,
    })
  })
})

// ============================================
// The registry against the state it describes
// ============================================

/**
 * One state shape, and what `UnregisteredPathKeyedMaps` must say about it.
 *
 * These are compiled, not pattern-matched. The check they exercise is
 * `REGISTRY_COVERS_EVERY_PATH_KEYED_MAP`, a type-level assertion that fails the build rather than
 * a test, so what is demonstrated here is the same operator the build uses, applied to shapes the
 * real state does not contain. The list is written to be read as a list of things a scan of the
 * source text got wrong: the first five all passed the regex this replaces.
 */
interface RegistryProbe {
  name: string
  /** Extra declarations above the probe slice, for shapes that need a second name. */
  preamble?: string
  /** The property the probe slice declares. */
  declares?: string
  /** The state to check. Defaults to the probe slice on its own. */
  state?: string
  /** The keys the operator must report as unregistered. */
  unregistered: readonly string[]
}

const REGISTRY_PROBES: readonly RegistryProbe[] = [
  {
    name: 'a plain Record - the one spelling the source scan did catch',
    declares: 'persistedProbeObvious: Record<string, string>',
    unregistered: ['persistedProbeObvious'],
  },
  {
    name: 'an optional map, where the `?` used to break the scan apart from the `:`',
    declares: 'persistedProbeOptional?: Record<string, string>',
    unregistered: ['persistedProbeOptional'],
  },
  {
    name: 'an inline index signature rather than the word Record',
    declares: 'persistedProbeIndexSignature: { [path: string]: string }',
    unregistered: ['persistedProbeIndexSignature'],
  },
  {
    name: 'a type alias, which says nothing about its own shape',
    preamble: 'type ProbePathMap = Record<string, { at: string }>',
    declares: 'persistedProbeAlias: ProbePathMap',
    unregistered: ['persistedProbeAlias'],
  },
  {
    name: 'a digit in the name, which the alpha-only scan stopped reading at',
    declares: 'persistedProbe2: Record<string, string>',
    unregistered: ['persistedProbe2'],
  },
  {
    name: 'a map declared in another slice file entirely, invisible to a scan of one file',
    state: 'PDMStoreState & ProbeOtherSlice',
    unregistered: ['persistedProbeOtherFile'],
  },
  {
    name: 'two at once, both named',
    declares:
      'persistedProbeFirst: Record<string, string>; persistedProbeSecond?: Record<string, number>',
    unregistered: ['persistedProbeFirst', 'persistedProbeSecond'],
  },
  {
    name: 'passes a registered map however it is spelled',
    preamble: 'type ProbePathMap = Record<string, { part_number?: string }>',
    declares: 'persistedPendingMetadata?: ProbePathMap',
    unregistered: [],
  },
  {
    name: 'passes a persisted value that is not keyed by path, which the registry is not for',
    declares: 'persistedSidebarWidth: number',
    unregistered: [],
  },
  {
    name: 'passes a path-keyed map that is not persisted, and so is not named `persisted*`',
    declares: 'fileConfigurationsByPath: Record<string, string>',
    unregistered: [],
  },
  {
    name: 'passes the real store state, which is the assertion the build makes',
    state: 'PDMStoreState',
    unregistered: [],
  },
]

// The probes live beside this file rather than in a directory of their own: they are never written
// to disk, and module resolution will not look inside a directory the file system does not have.
const OTHER_SLICE_PATH = posixPath(join(__dirname, 'registryProbe.otherSlice.ts'))
const OTHER_SLICE_SOURCE = `
export interface ProbeOtherSlice {
  persistedProbeOtherFile: Record<string, string>
}
`

function posixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function probePath(index: number): string {
  return posixPath(join(__dirname, `registryProbe.${index}.ts`))
}

function probeSource(probe: RegistryProbe): string {
  return [
    `import type { UnregisteredPathKeyedMaps } from '@/stores/persistedPathKeys'`,
    `import type { PDMStoreState } from '@/stores/types'`,
    `import type { ProbeOtherSlice } from './registryProbe.otherSlice'`,
    probe.preamble ?? '',
    `interface ProbeState { ${probe.declares ?? ''} }`,
    `export declare const unregistered: UnregisteredPathKeyedMaps<${probe.state ?? 'ProbeState'}>`,
  ].join('\n')
}

/**
 * A program over the probes, resolving `@/` against the real tsconfig so they see the real state.
 *
 * The unused-name checks are off because a probe imports every name the table might need and uses
 * one of them; everything else the project asks for stays on, and each probe's diagnostics are
 * asserted empty so a probe cannot rot into one that compiles to nothing.
 */
function probeProgram(files: ReadonlyMap<string, string>): ts.Program {
  const projectRoot = join(__dirname, '..', '..')
  const { config } = ts.readConfigFile(join(projectRoot, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, projectRoot)
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noEmit: true,
  }

  const host = ts.createCompilerHost(options, true)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (name) => files.get(posixPath(name)) ?? readFile(name)
  host.fileExists = (name) => files.has(posixPath(name)) || fileExists(name)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = files.get(posixPath(name))
    if (text === undefined) return getSourceFile(name, languageVersion, onError, shouldCreate)
    return ts.createSourceFile(name, text, languageVersion, true)
  }

  return ts.createProgram([...files.keys()], options, host)
}

/** The string literals the probe's `unregistered` declaration resolved to. */
function unregisteredKeys(checker: ts.TypeChecker, source: ts.SourceFile): string[] {
  const statement = source.statements.find(ts.isVariableStatement)
  const declaration = statement?.declarationList.declarations[0]
  if (!declaration) throw new Error(`probe ${source.fileName} declared nothing to read`)

  const type = checker.getTypeAtLocation(declaration.name)
  const parts = type.isUnion() ? type.types : [type]
  return parts
    .filter((part): part is ts.StringLiteralType => part.isStringLiteral())
    .map((part) => part.value)
    .sort()
}

describe('the registry cannot fall behind the state it describes', () => {
  const files = new Map<string, string>([[OTHER_SLICE_PATH, OTHER_SLICE_SOURCE]])
  REGISTRY_PROBES.forEach((probe, index) => files.set(probePath(index), probeSource(probe)))

  const program = probeProgram(files)
  const checker = program.getTypeChecker()

  it.each(REGISTRY_PROBES.map((probe, index) => ({ ...probe, index })))(
    'catches: $name',
    ({ index, unregistered }) => {
      const source = program.getSourceFile(probePath(index))
      if (!source) throw new Error(`probe ${index} never reached the program`)

      expect(
        program
          .getSemanticDiagnostics(source)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')),
      ).toEqual([])
      expect(unregisteredKeys(checker, source)).toEqual([...unregistered].sort())
    },
  )

  it('leaves no map behind in the rename, whatever the registry grows to hold', () => {
    const migrated = migratePersistedPathKeys(seeded(OLD_PATH), {
      oldPath: OLD_PATH,
      newPath: NEW_PATH,
      isDirectory: false,
    })

    expect(Object.keys(migrated).sort()).toEqual([...PERSISTED_PATH_KEYED_MAPS].sort())
  })
})

describe('what the persist middleware writes and reads', () => {
  it('writes exactly the registered maps', () => {
    const state = seeded(OLD_PATH)

    expect(pickPersistedPathKeys(state)).toEqual(state)
  })

  it('reads an absent or corrupt map back as empty rather than failing the load', () => {
    const restored = restorePersistedPathKeys({
      persistedPendingMetadata: { [OLD_PATH]: { part_number: 'PN-100' } },
      persistedMetadataWriteState: 'not an object',
    })

    expect(restored.persistedPendingMetadata[OLD_PATH]).toEqual({ part_number: 'PN-100' })
    expect(restored.persistedMetadataWriteState).toEqual({})
    expect(restored.persistedCopySource).toEqual({})
  })
})
