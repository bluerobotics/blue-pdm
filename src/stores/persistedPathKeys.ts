/**
 * The store's path-keyed persisted maps, declared once, so nothing can be added without the rename
 * path and the persistence layer both knowing about it.
 *
 * These maps hang off a file's absolute path rather than off the file object, because they have to
 * outlive the file object: `setFiles` rebuilds the whole array from disk on every load, so anything
 * that must survive a reload has to be findable by path afterwards. That makes a rename a data
 * migration - every one of them has to move to the new key in the same transaction the file moves -
 * and it made `renameFileInStore` a hand-written list of map names to migrate.
 *
 * A hand-written list drifts. It did: `persistedMetadataWriteState` was added beside
 * `persistedPendingMetadata` and never reached the rename list, so renaming a file kept the pending
 * value and orphaned the record of whether the file had actually accepted it - including the
 * `promoted` mark that says the database holds something the file may not. The value looked clean
 * after the next reload, which is the exact confusion the mark exists to prevent.
 *
 * So the list is declared here and everything derives from it:
 *
 * - `migratePersistedPathKeys` returns `Pick<PDMStoreState, PersistedPathKeyedMap>`, so adding a
 *   name to the registry stops the build until the migration handles it.
 * - `pickPersistedPathKeys` and `restorePersistedPathKeys` are what the persist middleware writes
 *   and reads, so a registered map is persisted and restored without a second declaration.
 * - `REGISTRY_COVERS_EVERY_PATH_KEYED_MAP` fails the build if the state declares a `persisted*` map
 *   keyed by string that the registry does not name, so the registry cannot fall behind the state
 *   either. That direction used to be a regular expression over `types.ts`, which required two
 *   spaces of indentation, a name of letters only, a literal colon and the literal word `Record` -
 *   so an optional `?`, an inline index signature, a type alias, a digit in the name, or a
 *   declaration in any other slice file all went past it. A type cannot be spelled around.
 *
 * Pure: no store access, no React.
 */

import type { PDMStoreState } from './types'

/**
 * Every persisted map keyed by a file's absolute path.
 *
 * Adding one here is the whole registration. In-memory caches keyed by path - `fileConfigurations`,
 * `drawingRefData`, the expansion sets - are deliberately not here: they are rebuilt from the file
 * system rather than restored, and they are `Map`/`Set` rather than plain records.
 */
export const PERSISTED_PATH_KEYED_MAPS = [
  'persistedPendingMetadata',
  'persistedMetadataWriteState',
  'persistedCopySource',
] as const

export type PersistedPathKeyedMap = (typeof PERSISTED_PATH_KEYED_MAPS)[number]

/** The slice of store state the registry covers. */
export type PersistedPathKeyedState = Pick<PDMStoreState, PersistedPathKeyedMap>

/**
 * Every `persisted*` key of a state whose value is keyed by an arbitrary string.
 *
 * `string extends keyof V` is the whole test, and it is a question about the type rather than
 * about how the type was written: `Record<string, V>`, an inline `{ [path: string]: V }` and any
 * alias of either all answer yes, because all three have `string` for their `keyof`. A value with
 * named properties does not, and neither does a number, a `Map` or a `Set` - which is why the
 * in-memory path-keyed caches are correctly not the registry's business. `-?` strips the
 * optionality so an optional map is judged on the type it holds rather than on `undefined`.
 */
export type PathKeyedPersistedMapKeys<S> = {
  [K in Extract<keyof S, `persisted${string}`>]-?: string extends keyof NonNullable<S[K]>
    ? K
    : never
}[Extract<keyof S, `persisted${string}`>]

/** The path-keyed persisted maps the registry does not name. Empty is the only valid answer. */
export type UnregisteredPathKeyedMaps<S> = Exclude<
  PathKeyedPersistedMapKeys<S>,
  PersistedPathKeyedMap
>

/**
 * `true` when the registry covers the state, and otherwise a type nothing can be assigned to,
 * carrying the offending keys so the compiler names them.
 */
export type RegistryCoversState<S> = [UnregisteredPathKeyedMaps<S>] extends [never]
  ? true
  : {
      readonly 'add this to PERSISTED_PATH_KEYED_MAPS and to the rename': UnregisteredPathKeyedMaps<S>
    }

/**
 * The other half of the derivation, and the half that used to be a test.
 *
 * `migratePersistedPathKeys` returns `Pick<PDMStoreState, PersistedPathKeyedMap>`, so a name added
 * to the registry stops the build until the rename carries it. This stops the build the other way:
 * add a path-keyed `persisted*` map anywhere in the state and it fails here, naming the key, until
 * the registry names it too.
 */
export const REGISTRY_COVERS_EVERY_PATH_KEYED_MAP: RegistryCoversState<PDMStoreState> = true

/** A path change to apply to every registered map. */
export interface PathRename {
  oldPath: string
  newPath: string
  /** True when the path is a folder, so keys beneath it move with it. */
  isDirectory: boolean
}

/**
 * Move one record's keys across a rename.
 *
 * Case-insensitively, because the store holds whatever case the file system reported and Windows
 * will report a different one for the same file. A directory carries its descendants with it: the
 * keys are absolute paths, so a folder rename changes the prefix of every path inside it.
 */
export function migratePathKeyedRecord<V>(
  record: Readonly<Record<string, V>>,
  rename: PathRename,
): Record<string, V> {
  const { oldPath, newPath, isDirectory } = rename
  const result: Record<string, V> = { ...record }
  const oldPathLower = oldPath.toLowerCase()

  if (isDirectory) {
    const separator = oldPath.includes('\\') ? '\\' : '/'
    for (const key of Object.keys(result)) {
      const keyLower = key.toLowerCase()
      if (keyLower !== oldPathLower && !keyLower.startsWith(oldPathLower + separator)) continue
      result[newPath + key.slice(oldPath.length)] = result[key]
      delete result[key]
    }
    return result
  }

  const existingKey = Object.keys(record).find((key) => key.toLowerCase() === oldPathLower)
  if (existingKey !== undefined) {
    result[newPath] = result[existingKey]
    delete result[existingKey]
  }
  return result
}

/**
 * Move every registered map across a rename, in one object the caller hands straight to `set`.
 *
 * Written out key by key rather than looped on purpose: the return type is derived from the
 * registry, so a name added to `PERSISTED_PATH_KEYED_MAPS` fails to compile here until it is
 * migrated. A loop would type-check while silently doing nothing new.
 */
export function migratePersistedPathKeys(
  state: PersistedPathKeyedState,
  rename: PathRename,
): PersistedPathKeyedState {
  return {
    persistedPendingMetadata: migratePathKeyedRecord(state.persistedPendingMetadata, rename),
    persistedMetadataWriteState: migratePathKeyedRecord(state.persistedMetadataWriteState, rename),
    persistedCopySource: migratePathKeyedRecord(state.persistedCopySource, rename),
  }
}

/** What the persist middleware writes out. Same exhaustiveness argument as the migration. */
export function pickPersistedPathKeys(state: PersistedPathKeyedState): PersistedPathKeyedState {
  return {
    persistedPendingMetadata: state.persistedPendingMetadata,
    persistedMetadataWriteState: state.persistedMetadataWriteState,
    persistedCopySource: state.persistedCopySource,
  }
}

/** One registered map as read back from storage, or an empty map when it was never written. */
function restoreMap<K extends PersistedPathKeyedMap>(
  persisted: Readonly<Record<string, unknown>>,
  key: K,
): PersistedPathKeyedState[K] {
  const raw = persisted[key]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {} as PersistedPathKeyedState[K]
  }
  return raw as PersistedPathKeyedState[K]
}

/**
 * What the persist middleware reads back in.
 *
 * Anything that is not an object reads as empty rather than being trusted: local storage is a file
 * on the user's disk and a hand-edited or half-written value must not crash the load.
 */
export function restorePersistedPathKeys(
  persisted: Readonly<Record<string, unknown>>,
): PersistedPathKeyedState {
  return {
    persistedPendingMetadata: restoreMap(persisted, 'persistedPendingMetadata'),
    persistedMetadataWriteState: restoreMap(persisted, 'persistedMetadataWriteState'),
    persistedCopySource: restoreMap(persisted, 'persistedCopySource'),
  }
}
