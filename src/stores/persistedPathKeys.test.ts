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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

describe('the registry cannot fall behind the state it describes', () => {
  // The type system enforces the other direction: `migratePersistedPathKeys` and the two
  // persistence helpers return `Pick<PDMStoreState, PersistedPathKeyedMap>`, so a name added to the
  // registry stops the build until every one of them handles it. This is the direction the compiler
  // cannot see - a `persisted*` map declared on the slice and never registered.

  it('names every path-keyed persisted map the files slice declares', () => {
    const types = readFileSync(join(__dirname, 'types.ts'), 'utf8')
    const declared = [...types.matchAll(/^\s{2}(persisted[A-Za-z]*)\s*:\s*Record</gm)].map(
      (match) => match[1],
    )

    expect(declared.length).toBeGreaterThan(0)
    expect([...declared].sort()).toEqual([...PERSISTED_PATH_KEYED_MAPS].sort())
  })

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
