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
 * - `persistedPathKeys.test.ts` fails if the slice declares a `persisted*` map the registry does
 *   not name, so the registry cannot fall behind the state either.
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
