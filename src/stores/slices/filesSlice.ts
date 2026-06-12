// TODO(decompose): Extract to filesSliceProcessing.ts — processing operations batching, flush logic, and all addProcessing/removeProcessing actions (lines ~18–95, 1585–1669)
// TODO(decompose): Extract to filesSliceMetadata.ts — pending metadata, copy source, version notes, and config metadata actions (lines ~499–758)
// TODO(decompose): Extract to filesSliceRealtime.ts — addCloudFile, updateFilePdmData, updateFileLocationFromServer, batchUpdateFileLocationsFromServer, removeCloudFile (lines ~1072–1477)
// TODO(decompose): Extract to filesSliceSolidworks.ts — SolidWorks configuration, config BOM, drawing ref, and config drawing expansion actions (lines ~1671–1862)

import { StateCreator } from 'zustand'
import type {
  PDMStoreState,
  FilesSlice,
  LocalFile,
  DiffStatus,
  OperationType,
  FileLocationUpdate,
  ServerFile,
} from '../types'
import type { PDMFile } from '../../types/pdm'
import { buildFullPath } from '@/lib/utils/path'
import { recordMetric } from '@/lib/performanceMetrics'
import { log } from '@/lib/logger'
import { logExplorer } from '@/lib/userActionLogger'
import { thumbnailCache } from '@/lib/thumbnailCache'

// ============================================================================
// Processing Operations Batching
// ============================================================================
// These variables batch processingOperations Map updates to reduce React re-renders.
// Multiple add/remove calls within the same microtask are combined into a single state update.
// This is critical for performance when processing 60+ files in batch operations.
//
// We use queueMicrotask to schedule flushes, which runs at the end of the current
// microtask queue. This ensures UI sees processing state immediately after the
// synchronous code that adds the processing operation completes, preventing
// intermediate states like "green cloud during checkin".

let pendingProcessingAdds = new Map<string, OperationType>()
let pendingProcessingRemoves = new Set<string>()
let processingFlushScheduled = false

/**
 * Flushes pending processing operations changes immediately.
 * Used internally by scheduleProcessingFlush and flushProcessingSync.
 */
function doProcessingFlush(
  get: () => PDMStoreState,
  set: (state: Partial<PDMStoreState>) => void,
): void {
  processingFlushScheduled = false

  // Early exit if nothing to flush
  if (pendingProcessingAdds.size === 0 && pendingProcessingRemoves.size === 0) {
    return
  }

  const currentState = get()
  const newMap = new Map(currentState.processingOperations)

  // Apply removes first, then adds (adds override removes for same path)
  pendingProcessingRemoves.forEach((p) => newMap.delete(p))
  pendingProcessingAdds.forEach((opType, p) => newMap.set(p, opType))

  // Clear pending batches
  pendingProcessingRemoves.clear()
  pendingProcessingAdds.clear()

  set({ processingOperations: newMap })
}

/**
 * Schedules a flush of pending processing operations changes.
 * Uses queueMicrotask for immediate processing at the end of the current task,
 * ensuring the UI sees processing state before any async operations start.
 *
 * @param get - Zustand get function from slice
 * @param set - Zustand set function from slice
 */
function scheduleProcessingFlush(
  get: () => PDMStoreState,
  set: (state: Partial<PDMStoreState>) => void,
): void {
  if (processingFlushScheduled) return
  processingFlushScheduled = true

  queueMicrotask(() => doProcessingFlush(get, set))
}

/**
 * Flushes pending processing operations synchronously.
 * Use this in critical paths where the UI MUST show the processing state
 * before any async work begins (e.g., before starting file operations).
 *
 * @param get - Zustand get function from slice
 * @param set - Zustand set function from slice
 */
function flushProcessingSync(
  get: () => PDMStoreState,
  set: (state: Partial<PDMStoreState>) => void,
): void {
  // Cancel any scheduled flush since we're flushing now
  processingFlushScheduled = false
  doProcessingFlush(get, set)
}

export const createFilesSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  FilesSlice
> = (set, get) => ({
  // Initial state
  files: [],
  serverFiles: [],
  serverFolderPaths: new Set<string>(),
  selectedFiles: [],
  pendingScrollToFile: null,
  expandedFolders: new Set<string>(),
  currentFolder: '',
  persistedPendingMetadata: {},
  persistedCopySource: {},
  sortColumn: 'name',
  sortDirection: 'asc',

  // Initial state - Search
  searchQuery: '',
  searchType: 'all',
  searchResults: [],
  isSearching: false,
  recentSearches: [],

  // Initial state - Filters
  workflowStateFilter: [],
  extensionFilter: [],
  historyFolderFilter: null,
  trashFolderFilter: null,
  ignorePatterns: {},

  // Initial state - Processing (Map tracks operation type per path for inline button spinners)
  processingOperations: new Map<string, import('../types').OperationType>(),

  // Initial state - SolidWorks Configurations
  expandedConfigFiles: new Set<string>(),
  selectedConfigs: new Set<string>(),
  fileConfigurations: new Map<string, import('../types').SWConfiguration[]>(),
  loadingConfigs: new Set<string>(),

  // Initial state - Configuration BOM expansion
  expandedConfigBoms: new Set<string>(),
  configBomData: new Map<string, import('../types').ConfigBomItem[]>(),
  loadingConfigBoms: new Set<string>(),

  // Initial state - Drawing file expand (for .slddrw files showing referenced models)
  expandedDrawingRefs: new Set<string>(),
  drawingRefData: new Map<string, import('../types').DrawingRefItem[]>(),
  loadingDrawingRefs: new Set<string>(),
  // Tracks which referenced files under a drawing are expanded to show configs
  // Keyed by "drawingPath::refFilePath"
  expandedDrawingRefFiles: new Set<string>(),

  // Initial state - Config -> drawings (for part/assembly configs showing which drawings reference them)
  expandedConfigDrawings: new Set<string>(),
  configDrawingData: new Map<string, import('../types').DrawingRefItem[]>(),
  loadingConfigDrawings: new Set<string>(),

  // Initial state - Realtime update debouncing
  recentlyModifiedFiles: new Map<string, number>(),

  // Initial state - Pending pane sections (collapsed by default)
  expandedPendingSections: new Set<string>(),

  // Actions - Files
  setFiles: (files) => {
    // Restore any persisted pending metadata to the files
    const { persistedPendingMetadata } = get()
    const persistedKeys = Object.keys(persistedPendingMetadata)
    if (persistedKeys.length > 0) {
      log.debug('[filesSlice]', `setFiles: restoring pending metadata for ${persistedKeys.length} files`)
      log.debug('[filesSlice]', 'persistedPendingMetadata keys', { keys: persistedKeys })
    }

    // Deduplicate by path (case-insensitive for Windows compatibility)
    // When duplicates exist, prefer LOCAL files over CLOUD files
    const seenPaths = new Map<string, number>() // lowercase path -> index in deduped array
    const deduped: typeof files = []
    let duplicateCount = 0

    for (const file of files) {
      const pathLower = file.path.toLowerCase()
      const existingIdx = seenPaths.get(pathLower)

      if (existingIdx !== undefined) {
        duplicateCount++
        const existing = deduped[existingIdx]
        // Prefer local file over cloud - local files have more accurate local state
        if (file.diffStatus !== 'cloud' && existing.diffStatus === 'cloud') {
          deduped[existingIdx] = file
        }
      } else {
        seenPaths.set(pathLower, deduped.length)
        deduped.push(file)
      }
    }

    // Log if duplicates were filtered
    if (duplicateCount > 0) {
      window.electronAPI?.log('warn', '[Store] setFiles filtered duplicates', {
        duplicateCount,
        originalCount: files.length,
        dedupedCount: deduped.length,
        timestamp: Date.now(),
      })
    }

    const { persistedCopySource } = get()
    const filesWithRestoredMetadata = deduped.map((f) => {
      let restored = f
      const persisted = persistedPendingMetadata[f.path]
      if (persisted) {
        log.debug('[filesSlice]', `setFiles: restoring metadata for ${f.path}`, persisted as Record<string, unknown>)
        // Restore pending metadata and mark as modified if it's a synced file
        restored = {
          ...restored,
          pendingMetadata: persisted,
          diffStatus:
            restored.pdmData &&
            !['outdated', 'deleted', 'deleted_remote'].includes(restored.diffStatus || '')
              ? ('modified' as const)
              : restored.diffStatus,
        }
      }
      // Restore copy source info for version history preservation
      const copySource = persistedCopySource[f.path]
      if (copySource) {
        restored = {
          ...restored,
          copiedFromFileId: copySource.sourceFileId,
          copiedVersion: copySource.version,
        }
      }
      return restored
    })
    set({ files: filesWithRestoredMetadata })
  },

  setServerFiles: (serverFiles) => set({ serverFiles }),
  setServerFolderPaths: (serverFolderPaths) => set({ serverFolderPaths }),

  updateFileInStore: (path, updates) => {
    set((state) => ({
      files: state.files.map((f) => (f.path === path ? { ...f, ...updates } : f)),
    }))
  },

  // Batch update multiple files in a single state change (avoids N re-renders)
  updateFilesInStore: (updates) => {
    if (updates.length === 0) return
    window.electronAPI?.log('info', '[Store] updateFilesInStore START', {
      updateCount: updates.length,
      paths: updates.slice(0, 5).map((u) => u.path),
      timestamp: Date.now(),
    })
    // Build a map for O(1) lookups - use lowercase keys for case-insensitive matching on Windows
    const updateMap = new Map(updates.map((u) => [u.path.toLowerCase(), u.updates]))
    set((state) => {
      const newFiles = state.files.map((f) => {
        const fileUpdates = updateMap.get(f.path.toLowerCase())
        return fileUpdates ? { ...f, ...fileUpdates } : f
      })

      // Clear persistedPendingMetadata for files where pendingMetadata is being cleared
      // This prevents LoadFiles from restoring stale pending metadata after check-in
      // Note: persistedPendingMetadata uses original paths (not lowercase), so we need to
      // find matching keys case-insensitively
      let newPersistedPendingMetadata = state.persistedPendingMetadata
      let newPersistedCopySource = state.persistedCopySource
      for (const [lowerPath, fileUpdates] of updateMap) {
        // Only clear persistedPendingMetadata when the update EXPLICITLY includes pendingMetadata.
        // Using 'in' check prevents unrelated updates (e.g. pdmData-only) from clearing metadata.
        if ('pendingMetadata' in fileUpdates && fileUpdates.pendingMetadata === undefined) {
          const matchingKey = Object.keys(newPersistedPendingMetadata).find(
            (k) => k.toLowerCase() === lowerPath,
          )
          if (matchingKey) {
            if (newPersistedPendingMetadata === state.persistedPendingMetadata) {
              newPersistedPendingMetadata = { ...state.persistedPendingMetadata }
            }
            delete newPersistedPendingMetadata[matchingKey]
          }
        }
        // Only clear persistedCopySource when the update EXPLICITLY includes copy fields.
        if (
          ('copiedFromFileId' in fileUpdates || 'copiedVersion' in fileUpdates) &&
          fileUpdates.copiedFromFileId === undefined &&
          fileUpdates.copiedVersion === undefined
        ) {
          const matchingKey = Object.keys(newPersistedCopySource).find(
            (k) => k.toLowerCase() === lowerPath,
          )
          if (matchingKey) {
            if (newPersistedCopySource === state.persistedCopySource) {
              newPersistedCopySource = { ...state.persistedCopySource }
            }
            delete newPersistedCopySource[matchingKey]
          }
        }
      }

      return {
        files: newFiles,
        persistedPendingMetadata: newPersistedPendingMetadata,
        persistedCopySource: newPersistedCopySource,
      }
    })
  },

  /**
   * Atomic update: combines file updates + clearing processing state in a single set() call.
   *
   * This prevents two sequential re-renders that would otherwise occur when calling
   * updateFilesInStore() followed by removeProcessingFolders(). With 8000+ files,
   * each re-render triggers expensive O(N x depth) folderMetrics computation in
   * useVaultTree.ts, causing ~5 second UI freezes.
   *
   * The key optimization is doing BOTH updates in ONE set() call, so React only
   * re-renders once instead of twice.
   *
   * @param updates - Array of file path + partial updates to apply
   * @param pathsToClearProcessing - Paths to remove from processingOperations Map
   */
  updateFilesAndClearProcessing: (updates, pathsToClearProcessing) => {
    const startTime = performance.now()

    // Debug: Log first few update paths and sample file paths from store
    const sampleUpdatePaths = updates.slice(0, 3).map((u) => u.path)
    const { files: currentFiles } = get()
    const sampleStorePaths = currentFiles.slice(0, 3).map((f) => f.path)
    window.electronAPI?.log('info', '[Store] updateFilesAndClearProcessing START', {
      updateCount: updates.length,
      clearCount: pathsToClearProcessing.length,
      sampleUpdatePaths,
      sampleStorePaths,
      timestamp: Date.now(),
    })
    recordMetric('Store', 'updateFilesAndClearProcessing START', {
      updateCount: updates.length,
      clearCount: pathsToClearProcessing.length,
    })

    // Clear these paths from pending batches to avoid double processing
    // This ensures the scheduled flush doesn't undo our direct update
    for (const path of pathsToClearProcessing) {
      pendingProcessingAdds.delete(path)
      pendingProcessingRemoves.delete(path)
    }

    // Build a map for O(1) file update lookups
    // Use lowercase keys on Windows for case-insensitive matching
    const updateMap =
      updates.length > 0 ? new Map(updates.map((u) => [u.path.toLowerCase(), u.updates])) : null

    // Build the set of paths to clear for O(1) lookups
    const pathsToClear = new Set(pathsToClearProcessing)

    // Single atomic state update - one re-render instead of two
    set((state) => {
      // Build new processingOperations Map with paths removed
      const newProcessingOps = new Map(state.processingOperations)
      for (const path of pathsToClear) {
        newProcessingOps.delete(path)
      }

      // Build new files array with updates applied
      // Use lowercase for case-insensitive matching on Windows
      let matchCount = 0
      const newFiles = updateMap
        ? state.files.map((f) => {
            const fileUpdates = updateMap.get(f.path.toLowerCase())
            if (fileUpdates) matchCount++
            return fileUpdates ? { ...f, ...fileUpdates } : f
          })
        : state.files

      // Debug: Log how many files actually matched
      if (updateMap && updateMap.size > 0) {
        window.electronAPI?.log('info', '[Store] updateFilesAndClearProcessing MATCH', {
          updateMapSize: updateMap.size,
          matchCount,
          unmatchedCount: updateMap.size - matchCount,
          timestamp: Date.now(),
        })
      }

      // Clear persistedPendingMetadata for files where pendingMetadata is being cleared
      // This prevents LoadFiles from restoring stale pending metadata after check-in
      // Note: persistedPendingMetadata uses original paths (not lowercase), so we need to
      // find matching keys case-insensitively
      let newPersistedPendingMetadata = state.persistedPendingMetadata
      if (updateMap) {
        for (const [lowerPath, fileUpdates] of updateMap) {
          if (fileUpdates.pendingMetadata === undefined) {
            // Find the actual key that matches case-insensitively
            const matchingKey = Object.keys(newPersistedPendingMetadata).find(
              (k) => k.toLowerCase() === lowerPath,
            )
            if (matchingKey) {
              // Lazily create a copy only if we need to modify
              if (newPersistedPendingMetadata === state.persistedPendingMetadata) {
                newPersistedPendingMetadata = { ...state.persistedPendingMetadata }
              }
              delete newPersistedPendingMetadata[matchingKey]
            }
          }
        }
      }

      return {
        files: newFiles,
        processingOperations: newProcessingOps,
        persistedPendingMetadata: newPersistedPendingMetadata,
      }
    })

    const durationMs = performance.now() - startTime
    window.electronAPI?.log('info', '[Store] updateFilesAndClearProcessing COMPLETE', {
      durationMs: Math.round(durationMs * 100) / 100,
      timestamp: Date.now(),
    })
    recordMetric('Store', 'updateFilesAndClearProcessing COMPLETE', {
      durationMs: Math.round(durationMs * 100) / 100,
    })
  },

  removeFilesFromStore: (paths) => {
    if (paths.length === 0) return
    // Use lowercase paths for case-insensitive matching on Windows
    const pathSet = new Set(paths.map((p) => p.toLowerCase()))
    const beforeCount = get().files.length
    // Check if paths exist in files before removing
    const existingPaths = paths.filter((p) =>
      get().files.some((f) => f.path.toLowerCase() === p.toLowerCase()),
    )
    log.debug('[Store]', 'removeFilesFromStore BEFORE', {
      pathsToRemove: paths.length,
      existingPaths: existingPaths.length,
      samplePaths: paths.slice(0, 3),
      beforeCount,
    })
    // Invalidate thumbnail cache for removed files
    for (const p of paths) {
      thumbnailCache.invalidate(p)
    }
    set((state) => {
      // Resolve LocalFile entries about to be removed so we can mirror the
      // removal onto state.serverFiles by relative path (forward-slash keyed).
      // Without this, a refreshCurrentFolder pass after a delete would see the
      // stale server entry whose path is no longer on disk and resurrect it as
      // a 'cloud' ghost.
      const itemsToRemove = state.files.filter((f) => pathSet.has(f.path.toLowerCase()))
      const relPathsToRemove = new Set<string>()
      const relPrefixesToRemove: string[] = []
      for (const item of itemsToRemove) {
        const rel = item.relativePath.toLowerCase()
        relPathsToRemove.add(rel)
        if (item.isDirectory) {
          relPrefixesToRemove.push(rel + '/')
        }
      }

      const updatedServerFiles =
        relPathsToRemove.size === 0 && relPrefixesToRemove.length === 0
          ? state.serverFiles
          : state.serverFiles.filter((sf) => {
              const sfPathLower = sf.file_path.toLowerCase()
              if (relPathsToRemove.has(sfPathLower)) return false
              for (const prefix of relPrefixesToRemove) {
                if (sfPathLower.startsWith(prefix)) return false
              }
              return true
            })

      return {
        files: state.files.filter((f) => !pathSet.has(f.path.toLowerCase())),
        serverFiles: updatedServerFiles,
        selectedFiles: state.selectedFiles.filter((p) => !pathSet.has(p.toLowerCase())),
      }
    })
    const afterCount = get().files.length
    log.debug('[Store]', 'removeFilesFromStore AFTER', {
      afterCount,
      removed: beforeCount - afterCount,
    })
    window.electronAPI?.log('info', '[Store] removeFilesFromStore', {
      pathsToRemove: paths.length,
      existingPaths: existingPaths.length,
      beforeCount,
      afterCount,
      removed: beforeCount - afterCount,
      timestamp: Date.now(),
    })
  },

  addFilesToStore: (newFiles) => {
    const beforeCount = get().files.length
    set((state) => {
      // Build set of existing paths (case-insensitive for Windows compatibility)
      const existingPaths = new Set(state.files.map((f) => f.path.toLowerCase()))
      // Filter out duplicates - files with paths that already exist
      const uniqueNewFiles = newFiles.filter((f) => !existingPaths.has(f.path.toLowerCase()))
      const duplicateCount = newFiles.length - uniqueNewFiles.length

      // Log if duplicates were filtered
      if (duplicateCount > 0) {
        const duplicatePaths = newFiles
          .filter((f) => existingPaths.has(f.path.toLowerCase()))
          .slice(0, 5)
          .map((f) => f.path)
        window.electronAPI?.log('warn', '[Store] addFilesToStore filtered duplicates', {
          duplicateCount,
          sampleDuplicates: duplicatePaths,
          timestamp: Date.now(),
        })
      }

      return {
        files: [...state.files, ...uniqueNewFiles],
      }
    })
    window.electronAPI?.log('info', '[Store] addFilesToStore', {
      requestedCount: newFiles.length,
      beforeCount,
      afterCount: get().files.length,
      actuallyAdded: get().files.length - beforeCount,
      paths: newFiles.slice(0, 5).map((f) => f.path),
      timestamp: Date.now(),
    })
  },

  updatePendingMetadata: (path, metadata) => {
    log.debug('[filesSlice]', `updatePendingMetadata called: ${path}`, metadata as Record<string, unknown>)

    // Guard: Never set pendingMetadata on non-editable files
    // This prevents accidental metadata changes on files not checked out by the user
    const state = get()
    const file = state.files.find((f) => f.path === path)

    if (file?.pdmData?.id) {
      const checkedOutBy = file.pdmData.checked_out_by
      const currentUserId = state.user?.id

      if (!checkedOutBy || checkedOutBy !== currentUserId) {
        log.warn('[filesSlice]', `updatePendingMetadata: Skipping non-editable file ${path}`)
        window.electronAPI?.log(
          'warn',
          '[filesSlice] Attempted to set pendingMetadata on non-editable file',
          {
            path,
            checkedOutBy,
            currentUserId,
            reason: !checkedOutBy ? 'not_checked_out' : 'checked_out_by_other',
          },
        )
        return
      }
    }

    set((state) => {
      // Calculate new pending metadata
      const file = state.files.find((f) => f.path === path)
      const existingPending = file?.pendingMetadata || state.persistedPendingMetadata[path] || {}
      log.debug('[filesSlice]', 'updatePendingMetadata: existingPending', existingPending as Record<string, unknown>)

      // Handle config_tabs merge specially (per-config tab numbers)
      let newConfigTabs = existingPending.config_tabs
      if (metadata.config_tabs) {
        newConfigTabs = {
          ...(existingPending.config_tabs || {}),
          ...metadata.config_tabs,
        }
      }

      // Handle config_descriptions merge specially (per-config descriptions)
      let newConfigDescriptions = existingPending.config_descriptions
      if (metadata.config_descriptions) {
        newConfigDescriptions = {
          ...(existingPending.config_descriptions || {}),
          ...metadata.config_descriptions,
        }
      }

      const newPending = {
        ...existingPending,
        ...metadata,
        config_tabs: newConfigTabs,
        config_descriptions: newConfigDescriptions,
      }

      log.debug('[filesSlice]', 'updatePendingMetadata: newPending', newPending as Record<string, unknown>)
      log.debug('[filesSlice]', `updatePendingMetadata: persisting to key: ${path}`)

      return {
        // Update file in files array
        files: state.files.map((f) => {
          if (f.path === path) {
            // Also update the pdmData to show the changes immediately in UI
            const updatedPdmData = f.pdmData
              ? {
                  ...f.pdmData,
                  part_number:
                    metadata.part_number !== undefined
                      ? metadata.part_number
                      : f.pdmData.part_number,
                  description:
                    metadata.description !== undefined
                      ? metadata.description
                      : f.pdmData.description,
                  revision:
                    metadata.revision !== undefined ? metadata.revision : f.pdmData.revision,
                }
              : f.pdmData
            return {
              ...f,
              pendingMetadata: newPending,
              pdmData: updatedPdmData,
              // Mark as modified if it has pdmData (synced file)
              diffStatus: f.pdmData ? 'modified' : f.diffStatus,
            }
          }
          return f
        }),
        // Also persist for app restart survival
        persistedPendingMetadata: {
          ...state.persistedPendingMetadata,
          [path]: newPending,
        },
      }
    })
  },

  clearPendingMetadata: (path) => {
    set((state) => {
      const file = state.files.find((f) => f.path === path)
      const pending = file?.pendingMetadata
      // Destructure to exclude `path` key, using _ for intentionally discarded value
      const { [path]: _, ...remainingPersisted } = state.persistedPendingMetadata

      // Merge pending values into pdmData before clearing
      // This ensures the UI still shows the new values after clearing
      // Use !== undefined check instead of ?? to handle null values correctly
      // (null should be preserved as the new value, not trigger fallback)
      const mergedPdmData =
        file?.pdmData && pending
          ? {
              ...file.pdmData,
              part_number:
                pending.part_number !== undefined ? pending.part_number : file.pdmData.part_number,
              description:
                pending.description !== undefined ? pending.description : file.pdmData.description,
              revision: pending.revision !== undefined ? pending.revision : file.pdmData.revision,
            }
          : file?.pdmData

      log.info('[filesSlice]', 'clearPendingMetadata', {
        path,
        pendingPartNumber: pending?.part_number,
        currentPdmPartNumber: file?.pdmData?.part_number,
        mergedPartNumber: mergedPdmData?.part_number,
      })

      return {
        files: state.files.map((f) => {
          if (f.path === path) {
            return { ...f, pendingMetadata: undefined, pdmData: mergedPdmData }
          }
          return f
        }),
        persistedPendingMetadata: remainingPersisted,
      }
    })
  },

  clearPendingConfigMetadata: (path) => {
    set((state) => {
      const file = state.files.find((f) => f.path === path)
      const existingPending = file?.pendingMetadata

      // If no pending metadata, nothing to clear
      if (!existingPending) return state

      // Destructure to exclude config_tabs and config_descriptions (intentionally discarded)
      const { config_tabs, config_descriptions, ...remainingPending } = existingPending

      // Check if there's anything left after removing config metadata
      const hasRemainingPending = Object.keys(remainingPending).some(
        (k) => remainingPending[k as keyof typeof remainingPending] !== undefined,
      )
      const newPending = hasRemainingPending ? remainingPending : undefined

      // Update persisted metadata too
      const existingPersistedPending = state.persistedPendingMetadata[path]
      let newPersistedMetadata = state.persistedPendingMetadata
      if (existingPersistedPending) {
        // Destructure to exclude config fields (prefixed with _ to indicate intentionally unused)
        const {
          config_tabs: _ct,
          config_descriptions: _cd,
          ...remainingPersistedPending
        } = existingPersistedPending
        const hasRemainingPersistedPending = Object.keys(remainingPersistedPending).some(
          (k) =>
            remainingPersistedPending[k as keyof typeof remainingPersistedPending] !== undefined,
        )
        if (hasRemainingPersistedPending) {
          newPersistedMetadata = {
            ...state.persistedPendingMetadata,
            [path]: remainingPersistedPending,
          }
        } else {
          // Destructure to exclude `path` key (intentionally discarded)
          const { [path]: _, ...rest } = state.persistedPendingMetadata
          newPersistedMetadata = rest
        }
      }

      return {
        files: state.files.map((f) =>
          f.path === path ? { ...f, pendingMetadata: newPending } : f,
        ),
        persistedPendingMetadata: newPersistedMetadata,
      }
    })
  },

  // Batch clear persisted pending metadata for multiple paths (used during checkout)
  clearPersistedPendingMetadataForPaths: (paths) => {
    set((state) => {
      const pathSet = new Set(paths)
      const newPersisted = Object.fromEntries(
        Object.entries(state.persistedPendingMetadata).filter(([p]) => !pathSet.has(p)),
      )
      return { persistedPendingMetadata: newPersisted }
    })
  },

  // Set or clear copy source info for version history preservation on paste
  setCopySource: (path, source) => {
    set((state) => {
      const newCopySource = { ...state.persistedCopySource }
      if (source) {
        newCopySource[path] = source
      } else {
        delete newCopySource[path]
      }
      // Also update the file in the store if it exists
      const files = state.files.map((f) => {
        if (f.path === path) {
          return {
            ...f,
            copiedFromFileId: source?.sourceFileId,
            copiedVersion: source?.version,
          }
        }
        return f
      })
      return { persistedCopySource: newCopySource, files }
    })
  },

  // Update a pending version note for a specific version (syncs on check-in)
  updatePendingVersionNote: (path, versionId, note) => {
    set((state) => {
      return {
        files: state.files.map((f) => {
          if (f.path === path) {
            const existingNotes = f.pendingVersionNotes || {}
            // If note is empty, remove it from the record
            const newNotes = note.trim()
              ? { ...existingNotes, [versionId]: note }
              : Object.fromEntries(Object.entries(existingNotes).filter(([id]) => id !== versionId))
            return {
              ...f,
              pendingVersionNotes: Object.keys(newNotes).length > 0 ? newNotes : undefined,
            }
          }
          return f
        }),
      }
    })
  },

  // Clear all pending version notes for a file (after check-in syncs them)
  clearPendingVersionNotes: (path) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.path === path ? { ...f, pendingVersionNotes: undefined } : f,
      ),
    }))
  },

  // Update the pending check-in note for the upcoming local version
  updatePendingCheckinNote: (path, note) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.path === path ? { ...f, pendingCheckinNote: note.trim() || undefined } : f,
      ),
    }))
  },

  renameFileInStore: (oldPath, newPath, newNameOrRelPath, isMove = false) => {
    const { files, selectedFiles } = get()

    // Log rename operation start for debugging
    window.electronAPI?.log('info', '[Store] renameFileInStore START', {
      oldPath,
      newPath,
      newNameOrRelPath,
      isMove,
      totalFilesInStore: files.length,
      timestamp: Date.now(),
    })

    // Use case-insensitive matching for Windows compatibility
    const oldPathLower = oldPath.toLowerCase()

    // Find the item being renamed to check if it's a directory
    const targetItem = files.find((f) => f.path.toLowerCase() === oldPathLower)
    const isDirectory = targetItem?.isDirectory
    const oldRelPath = targetItem?.relativePath || ''

    // Log if target item was found
    if (!targetItem) {
      window.electronAPI?.log('warn', '[Store] renameFileInStore: target item not found in store', {
        oldPath,
        oldPathLower,
        timestamp: Date.now(),
      })
    }

    // Compute the new relative path for the item being renamed
    let newRelPathForItem: string
    if (isMove) {
      newRelPathForItem = newNameOrRelPath
    } else {
      const pathParts = oldRelPath.split('/')
      pathParts[pathParts.length - 1] = newNameOrRelPath
      newRelPathForItem = pathParts.join('/')
    }

    // Log directory rename details
    if (isDirectory) {
      window.electronAPI?.log('info', '[Store] renameFileInStore: directory rename', {
        oldRelPath,
        newRelPath: newRelPathForItem,
        timestamp: Date.now(),
      })
      // Invalidate thumbnail cache for all files in the folder
      thumbnailCache.invalidateFolder(oldPath)
    } else {
      // Invalidate thumbnail cache for the renamed file
      thumbnailCache.invalidate(oldPath)
    }

    // Determine path separator for nested file updates
    const separator = oldPath.includes('\\') ? '\\' : '/'
    const oldPathWithSep = oldPathLower + separator

    // Track how many nested files are updated (for debugging)
    let nestedUpdatedCount = 0

    // Update file in the files array
    const updatedFiles = files.map((f) => {
      const fPathLower = f.path.toLowerCase()

      // Exact match - the item being renamed
      if (fPathLower === oldPathLower) {
        let newRelativePath: string
        let newName: string

        if (isMove) {
          // For moves, newNameOrRelPath is the full new relative path
          newRelativePath = newNameOrRelPath
          newName = newNameOrRelPath.includes('/')
            ? newNameOrRelPath.split('/').pop()!
            : newNameOrRelPath
        } else {
          // For renames, newNameOrRelPath is just the new filename
          newName = newNameOrRelPath
          const pathParts = f.relativePath.split('/')
          pathParts[pathParts.length - 1] = newName
          newRelativePath = pathParts.join('/')
        }

        return {
          ...f,
          path: newPath,
          name: newName,
          relativePath: newRelativePath,
          extension: newName.includes('.')
            ? '.' + (newName.split('.').pop()?.toLowerCase() || '')
            : '',
        }
      }

      // For directories, also update all nested items (files and folders inside)
      if (isDirectory && fPathLower.startsWith(oldPathWithSep)) {
        nestedUpdatedCount++
        // Replace the old path prefix with the new path prefix
        const newNestedPath = newPath + f.path.slice(oldPath.length)
        // Replace the old relative path prefix with the new relative path prefix
        const newNestedRelPath = newRelPathForItem + f.relativePath.slice(oldRelPath.length)

        return {
          ...f,
          path: newNestedPath,
          relativePath: newNestedRelPath,
        }
      }

      return f
    })

    // Log nested file updates for debugging
    if (isDirectory && nestedUpdatedCount > 0) {
      window.electronAPI?.log('info', '[Store] renameFileInStore updated nested items', {
        oldPath: oldRelPath,
        newPath: newRelPathForItem,
        nestedItemsUpdated: nestedUpdatedCount,
        timestamp: Date.now(),
      })
    }

    // Update selected files if the renamed file was selected (case-insensitive)
    // Also update any selected files that were inside a renamed directory
    const updatedSelectedFiles = selectedFiles.map((p) => {
      const pLower = p.toLowerCase()
      if (pLower === oldPathLower) {
        return newPath
      }
      // If this selected file was inside the renamed directory, update its path too
      if (isDirectory && pLower.startsWith(oldPathWithSep)) {
        return newPath + p.slice(oldPath.length)
      }
      return p
    })

    // Migrate path-keyed state so pending metadata, configurations, etc. survive renames
    const state = get()
    const migratePathKey = <V>(record: Record<string, V>): Record<string, V> => {
      const result = { ...record }
      if (isDirectory) {
        const oldPrefix = oldPath.toLowerCase()
        const sep = oldPath.includes('\\') ? '\\' : '/'
        for (const key of Object.keys(result)) {
          if (key.toLowerCase() === oldPrefix || key.toLowerCase().startsWith(oldPrefix + sep)) {
            const newKey = newPath + key.slice(oldPath.length)
            result[newKey] = result[key]
            delete result[key]
          }
        }
      } else if (oldPath.toLowerCase() in Object.keys(record).map((k) => k.toLowerCase())) {
        const existingKey = Object.keys(record).find(
          (k) => k.toLowerCase() === oldPath.toLowerCase(),
        )
        if (existingKey) {
          result[newPath] = result[existingKey]
          delete result[existingKey]
        }
      } else {
        const existingKey = Object.keys(record).find(
          (k) => k.toLowerCase() === oldPath.toLowerCase(),
        )
        if (existingKey) {
          result[newPath] = result[existingKey]
          delete result[existingKey]
        }
      }
      return result
    }

    const migrateMap = <V>(map: Map<string, V>): Map<string, V> => {
      const newMap = new Map(map)
      if (isDirectory) {
        const oldPrefixLower = oldPath.toLowerCase()
        const sep = oldPath.includes('\\') ? '\\' : '/'
        for (const [key, val] of map) {
          const keyLower = key.toLowerCase()
          if (keyLower === oldPrefixLower || keyLower.startsWith(oldPrefixLower + sep)) {
            const newKey = newPath + key.slice(oldPath.length)
            newMap.delete(key)
            newMap.set(newKey, val)
          }
        }
      } else {
        for (const [key, val] of map) {
          if (key.toLowerCase() === oldPath.toLowerCase()) {
            newMap.delete(key)
            newMap.set(newPath, val)
            break
          }
        }
      }
      return newMap
    }

    const migrateSet = (s: Set<string>): Set<string> => {
      const newSet = new Set(s)
      if (isDirectory) {
        const oldPrefixLower = oldPath.toLowerCase()
        const sep = oldPath.includes('\\') ? '\\' : '/'
        for (const val of s) {
          const valLower = val.toLowerCase()
          if (valLower === oldPrefixLower || valLower.startsWith(oldPrefixLower + sep)) {
            newSet.delete(val)
            newSet.add(newPath + val.slice(oldPath.length))
          }
        }
      } else {
        for (const val of s) {
          if (val.toLowerCase() === oldPath.toLowerCase()) {
            newSet.delete(val)
            newSet.add(newPath)
            break
          }
        }
      }
      return newSet
    }

    // Mirror path changes onto state.serverFiles so refreshCurrentFolder does
    // not resurrect a ghost cloud-only entry at the old path on next refresh.
    // serverFiles is keyed by relative path (forward slashes), so match against
    // oldRelPath (not oldPath / newPath which are full filesystem paths).
    const oldRelPathLower = oldRelPath.toLowerCase()
    const oldRelPathWithSlash = oldRelPathLower + '/'
    const updatedServerFiles =
      oldRelPath === ''
        ? state.serverFiles
        : state.serverFiles.map((sf) => {
            const sfPathLower = sf.file_path.toLowerCase()
            if (sfPathLower === oldRelPathLower) {
              const newName = newRelPathForItem.includes('/')
                ? newRelPathForItem.split('/').pop()!
                : newRelPathForItem
              return {
                ...sf,
                file_path: newRelPathForItem,
                name: newName,
                extension: newName.includes('.')
                  ? '.' + (newName.split('.').pop()?.toLowerCase() || '')
                  : '',
              }
            }
            if (isDirectory && sfPathLower.startsWith(oldRelPathWithSlash)) {
              return {
                ...sf,
                file_path: newRelPathForItem + sf.file_path.slice(oldRelPath.length),
              }
            }
            return sf
          })

    set({
      files: updatedFiles,
      serverFiles: updatedServerFiles,
      selectedFiles: updatedSelectedFiles,
      persistedPendingMetadata: migratePathKey(state.persistedPendingMetadata),
      persistedCopySource: migratePathKey(state.persistedCopySource as Record<string, any>) as any, // TODO: type this
      processingOperations: migrateMap(state.processingOperations),
      fileConfigurations: migrateMap(state.fileConfigurations),
      drawingRefData: migrateMap(state.drawingRefData),
      expandedConfigFiles: migrateSet(state.expandedConfigFiles),
      expandedDrawingRefs: migrateSet(state.expandedDrawingRefs),
    })
  },

  setSelectedFiles: (selectedFiles) => {
    const firstFew = selectedFiles.slice(0, 3).map((p) => p.split('/').pop())
    logExplorer('setSelectedFiles', {
      count: selectedFiles.length,
      preview: firstFew.join(', ') + (selectedFiles.length > 3 ? '...' : ''),
    })
    set({ selectedFiles })
  },

  setPendingScrollToFile: (path) => {
    set({ pendingScrollToFile: path })
  },

  toggleFileSelection: (path, multiSelect = false) => {
    const { selectedFiles } = get()
    const fileName = path.split('/').pop()
    const wasSelected = selectedFiles.includes(path)
    logExplorer('toggleFileSelection', {
      path: fileName,
      multiSelect,
      wasSelected,
      prevCount: selectedFiles.length,
    })
    if (multiSelect) {
      if (wasSelected) {
        set({ selectedFiles: selectedFiles.filter((p) => p !== path) })
      } else {
        set({ selectedFiles: [...selectedFiles, path] })
      }
    } else {
      set({ selectedFiles: [path] })
    }
  },

  selectAllFiles: () => {
    const { files } = get()
    const allFiles = files.filter((f) => !f.isDirectory).map((f) => f.path)
    logExplorer('selectAllFiles', { count: allFiles.length })
    set({ selectedFiles: allFiles })
  },

  clearSelection: () => {
    logExplorer('clearSelection')
    set({ selectedFiles: [] })
  },

  toggleFolder: (path) => {
    const { expandedFolders } = get()
    const newExpanded = new Set(expandedFolders)
    const isExpanding = !newExpanded.has(path)
    logExplorer('toggleFolder', { path, isExpanding })
    if (isExpanding) {
      newExpanded.add(path)
    } else {
      newExpanded.delete(path)
    }
    set({ expandedFolders: newExpanded })
  },

  collapseAllFolders: () => {
    const { expandedFolders } = get()
    logExplorer('collapseAllFolders', { prevCount: expandedFolders.size })
    set({ expandedFolders: new Set<string>() })
  },

  setCurrentFolder: (currentFolder) => {
    logExplorer('setCurrentFolder', { folder: currentFolder || '(root)' })
    set({ currentFolder })
  },

  // Actions - Realtime Updates (incremental without full refresh)
  addCloudFile: (pdmFile) => {
    const { files, vaultPath, activeVaultId } = get()
    if (!vaultPath) {
      window.electronAPI?.log(
        'warn',
        '[Store] addCloudFile called with no vaultPath -- file will not appear in store',
        {
          fileId: pdmFile.id,
          filePath: pdmFile.file_path,
          fileName: pdmFile.file_name,
        },
      )
      return
    }

    // Defense in depth against cross-vault realtime leaks: never materialize a
    // file (or its parent folders) that belongs to a different vault than the
    // one currently open. Without this, an off-vault event would fabricate ghost
    // "cloud" folders in the active vault.
    if (activeVaultId && pdmFile.vault_id && pdmFile.vault_id !== activeVaultId) {
      log.debug('[filesSlice]', 'addCloudFile SKIP: file for other vault', {
        fileId: pdmFile.id,
        fileVaultId: pdmFile.vault_id,
        activeVaultId,
      })
      return
    }

    // Build the corresponding ServerFile entry for state.serverFiles. We keep
    // the two collections in lock-step so refreshCurrentFolder, which reads
    // serverFiles, never sees stale data after a realtime echo.
    const serverFileEntry: ServerFile = {
      id: pdmFile.id,
      file_path: pdmFile.file_path,
      name: pdmFile.file_name,
      extension: pdmFile.extension || '',
      content_hash: pdmFile.content_hash || '',
    }

    // Check if file already exists (by server ID or path) - case-insensitive for Windows
    const existingByPath = files.find(
      (f) => f.relativePath.toLowerCase() === pdmFile.file_path.toLowerCase(),
    )
    if (existingByPath) {
      // File already exists locally - update its pdmData instead (not a true duplicate, just merging)
      window.electronAPI?.log('debug', '[Store] addCloudFile merging with existing local file', {
        path: pdmFile.file_path,
        existingDiffStatus: existingByPath.diffStatus,
        timestamp: Date.now(),
      })
      set((state) => ({
        files: state.files.map((f) => {
          if (f.relativePath.toLowerCase() !== pdmFile.file_path.toLowerCase()) {
            return f
          }

          // Determine diff status using best available information
          let newDiffStatus = f.diffStatus

          if (f.localHash) {
            // Hash comparison is most accurate
            newDiffStatus = f.localHash === pdmFile.content_hash ? undefined : 'outdated'
          } else if (f.localVersion !== undefined && pdmFile.version !== undefined) {
            // Use tracked local version as fallback when hash unavailable
            // This provides accurate status without expensive hash computation
            newDiffStatus =
              f.localVersion === pdmFile.version
                ? undefined
                : f.localVersion < pdmFile.version
                  ? 'outdated'
                  : f.diffStatus
          } else if (f.diffStatus === 'outdated') {
            // No way to verify 'outdated' status - clear it rather than preserve potentially wrong status
            // Background hash computation will determine correct status
            newDiffStatus = undefined
          }
          // Otherwise preserve existing diffStatus (e.g. 'modified', 'added')

          return {
            ...f,
            pdmData: pdmFile,
            isSynced: true,
            diffStatus: newDiffStatus,
          }
        }),
        serverFiles: state.serverFiles.some((sf) => sf.id === pdmFile.id)
          ? state.serverFiles.map((sf) => (sf.id === pdmFile.id ? serverFileEntry : sf))
          : [...state.serverFiles, serverFileEntry],
      }))
      return
    }

    // Add cloud parent folders if needed
    const pathParts = pdmFile.file_path.split('/')
    const newFiles: LocalFile[] = []

    // Create cloud folders for parents that don't exist
    let currentPath = ''
    for (let i = 0; i < pathParts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
      const folderExists = files.some(
        (f) => f.relativePath.toLowerCase() === currentPath.toLowerCase(),
      )
      // Case-insensitive check for folders we're about to add in this batch
      const currentPathLower = currentPath.toLowerCase()
      if (
        !folderExists &&
        !newFiles.some((f) => f.relativePath.toLowerCase() === currentPathLower)
      ) {
        newFiles.push({
          name: pathParts[i],
          path: buildFullPath(vaultPath, currentPath),
          relativePath: currentPath,
          isDirectory: true,
          extension: '',
          size: 0,
          modifiedTime: '',
          diffStatus: 'cloud',
        })
      }
    }

    // Add the cloud file itself - mark as 'cloud' (available for download)
    newFiles.push({
      name: pdmFile.file_name,
      path: buildFullPath(vaultPath, pdmFile.file_path),
      relativePath: pdmFile.file_path,
      isDirectory: false,
      extension: pdmFile.extension,
      size: pdmFile.file_size || 0,
      modifiedTime: pdmFile.updated_at || '',
      pdmData: pdmFile,
      isSynced: false,
      diffStatus: 'cloud',
    })

    set((state) => ({
      files: [...state.files, ...newFiles],
      serverFiles: state.serverFiles.some((sf) => sf.id === pdmFile.id)
        ? state.serverFiles
        : [...state.serverFiles, serverFileEntry],
    }))
  },

  updateFilePdmData: (fileId, pdmData) => {
    set((state) => ({
      files: state.files.map((f) => {
        if (f.pdmData?.id === fileId) {
          // Defense-in-depth: Preserve pending metadata fields even if realtime tries to overwrite
          // This prevents stale realtime events from reverting local edits
          const preservedFields = f.pendingMetadata
            ? {
                part_number:
                  f.pendingMetadata.part_number !== undefined
                    ? f.pdmData.part_number
                    : pdmData.part_number,
                description:
                  f.pendingMetadata.description !== undefined
                    ? f.pdmData.description
                    : pdmData.description,
                revision:
                  f.pendingMetadata.revision !== undefined ? f.pdmData.revision : pdmData.revision,
              }
            : {}

          // Preserve checked_out_user if not explicitly provided in the update
          // Realtime events don't include joined user info, so we preserve existing data
          // to prevent "SO" (Someone) avatars from appearing during file updates
          const existingUserInfo = (f.pdmData as any)?.checked_out_user // TODO: type this
          const preserveUserInfo =
            existingUserInfo &&
            !('checked_out_user' in pdmData) &&
            f.pdmData.checked_out_by === pdmData.checked_out_by

          const updatedPdmData = {
            ...f.pdmData,
            ...pdmData,
            ...preservedFields,
            ...(preserveUserInfo ? { checked_out_user: existingUserInfo } : {}),
          } as PDMFile

          // Recompute diff status using best available information
          let newDiffStatus = f.diffStatus
          if (pdmData.content_hash && f.localHash && f.localHash.length > 0) {
            // Hash comparison is most accurate
            if (pdmData.content_hash !== f.localHash) {
              newDiffStatus = 'outdated'
            } else if (f.diffStatus === 'outdated') {
              newDiffStatus = undefined
            }
          } else if (f.localVersion !== undefined && pdmData.version !== undefined) {
            // Use tracked local version as fallback when hash unavailable
            if (f.localVersion === pdmData.version) {
              // Versions match - file is synced
              if (f.diffStatus === 'outdated') {
                newDiffStatus = undefined
              }
            } else if (f.localVersion < pdmData.version) {
              // Local is older than server
              newDiffStatus = 'outdated'
            }
            // If local > server, preserve existing status (likely 'modified')
          } else if (f.diffStatus === 'outdated') {
            // No way to verify 'outdated' status - clear it rather than preserve potentially wrong status
            // Background hash computation will determine correct status
            newDiffStatus = undefined
          }
          // Otherwise preserve existing diffStatus (e.g. 'modified', 'added')

          // Handle checkout status changes for files marked as 'deleted'
          if (
            f.diffStatus === 'deleted' &&
            'checked_out_by' in pdmData &&
            pdmData.checked_out_by === null
          ) {
            newDiffStatus = 'cloud'
          }

          return {
            ...f,
            pdmData: updatedPdmData,
            diffStatus: newDiffStatus,
          }
        }
        return f
      }),
    }))
  },

  /**
   * Update a file's location from a realtime event (handles path changes from other users).
   * This is called when a file is moved by another user (or same user on different machine).
   * Updates path, relativePath, name, and pdmData, and creates parent folders if needed.
   */
  updateFileLocationFromServer: (fileId, newRelativePath, newFileName, pdmData) => {
    const { vaultPath } = get()
    if (!vaultPath) return

    const newFullPath = buildFullPath(vaultPath, newRelativePath)

    log.info('[filesSlice]', 'updateFileLocationFromServer', {
      fileId,
      newRelativePath,
      newFileName,
    })

    set((state) => {
      // Find current file to get old path for selectedFiles update
      const existingFile = state.files.find((f) => f.pdmData?.id === fileId)
      const oldPath = existingFile?.path

      // Ensure parent folders exist (for cloud-only files moved to new location)
      const pathParts = newRelativePath.split('/')
      const newFolders: LocalFile[] = []
      let currentPath = ''
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
        const folderExists = state.files.some(
          (f) => f.relativePath.toLowerCase() === currentPath.toLowerCase(),
        )
        // Case-insensitive check for folders we're about to add in this batch
        if (
          !folderExists &&
          !newFolders.some((f) => f.relativePath.toLowerCase() === currentPath.toLowerCase())
        ) {
          newFolders.push({
            name: pathParts[i],
            path: buildFullPath(vaultPath, currentPath),
            relativePath: currentPath,
            isDirectory: true,
            extension: '',
            size: 0,
            modifiedTime: '',
            diffStatus: 'cloud',
          })
        }
      }

      // Update the file's location
      const updatedFiles = state.files.map((f) => {
        if (f.pdmData?.id !== fileId) return f
        return {
          ...f,
          path: newFullPath,
          relativePath: newRelativePath,
          name: newFileName,
          extension: newFileName.includes('.')
            ? '.' + (newFileName.split('.').pop()?.toLowerCase() || '')
            : '',
          pdmData: { ...f.pdmData, ...pdmData } as PDMFile,
        }
      })

      // Mirror onto state.serverFiles so refreshCurrentFolder does not
      // resurrect a ghost cloud-only entry at the old path.
      const updatedServerFiles = state.serverFiles.map((sf) => {
        if (sf.id !== fileId) return sf
        return {
          ...sf,
          file_path: newRelativePath,
          name: newFileName,
          extension: newFileName.includes('.')
            ? '.' + (newFileName.split('.').pop()?.toLowerCase() || '')
            : '',
        }
      })

      // Update selectedFiles if needed
      const updatedSelectedFiles =
        oldPath && state.selectedFiles.includes(oldPath)
          ? state.selectedFiles.map((p) => (p === oldPath ? newFullPath : p))
          : state.selectedFiles

      return {
        files: [...updatedFiles, ...newFolders],
        serverFiles: updatedServerFiles,
        selectedFiles: updatedSelectedFiles,
      }
    })
  },

  /**
   * Batch update multiple file locations from realtime events.
   * This prevents render cascade when a folder is moved and multiple files
   * receive individual realtime UPDATE events - instead of N set() calls
   * causing N re-renders, we do a single set() with all updates combined.
   */
  batchUpdateFileLocationsFromServer: (updates: FileLocationUpdate[]) => {
    if (updates.length === 0) return

    const { vaultPath, activeVaultId } = get()
    if (!vaultPath) return

    // Defense in depth against cross-vault realtime leaks: only apply location
    // updates for files in the currently open vault. An off-vault move would
    // otherwise recreate parent folders (e.g. a ghost WLC folder) in this vault.
    const scopedUpdates = activeVaultId
      ? updates.filter((u) => !u.pdmData.vault_id || u.pdmData.vault_id === activeVaultId)
      : updates
    if (scopedUpdates.length === 0) return

    log.info('[filesSlice]', 'batchUpdateFileLocationsFromServer', {
      updateCount: scopedUpdates.length,
      skippedCount: updates.length - scopedUpdates.length,
      fileIds: scopedUpdates.map((u) => u.fileId).slice(0, 5),
    })

    set((state) => {
      // Build a map of fileId -> update for O(1) lookups
      const updateMap = new Map(scopedUpdates.map((u) => [u.fileId, u]))

      // Collect all new folders that need to be created
      const newFolders: LocalFile[] = []

      // Build a comprehensive set of existing paths (case-insensitive) to prevent duplicates
      // Include ALL files/folders, not just directories, to catch edge cases where
      // an entry might exist with wrong isDirectory flag or from concurrent updates
      const existingPaths = new Set(state.files.map((f) => f.relativePath.toLowerCase()))
      // Also track by full path for extra safety
      const existingFullPaths = new Set(state.files.map((f) => f.path.toLowerCase()))

      // Track old paths for selectedFiles update
      const oldPathToNewPath = new Map<string, string>()

      // Pre-create all parent folders needed (only if they truly don't exist)
      for (const update of scopedUpdates) {
        const pathParts = update.newRelativePath.split('/')
        let currentPath = ''
        for (let i = 0; i < pathParts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
          const lowerPath = currentPath.toLowerCase()
          const fullPath = buildFullPath(vaultPath, currentPath)
          const lowerFullPath = fullPath.toLowerCase()

          // Skip if folder already exists in state OR was already queued for creation
          // Check both relativePath and full path for robustness
          if (
            existingPaths.has(lowerPath) ||
            existingFullPaths.has(lowerFullPath) ||
            newFolders.some((f) => f.relativePath.toLowerCase() === lowerPath)
          ) {
            continue
          }

          newFolders.push({
            name: pathParts[i],
            path: fullPath,
            relativePath: currentPath,
            isDirectory: true,
            extension: '',
            size: 0,
            modifiedTime: '',
            diffStatus: 'cloud',
          })
          // Add to tracking sets to prevent duplicates within this batch
          existingPaths.add(lowerPath)
          existingFullPaths.add(lowerFullPath)
        }
      }

      if (newFolders.length > 0) {
        log.debug('[filesSlice]', 'batchUpdateFileLocationsFromServer creating folders', {
          folderCount: newFolders.length,
          paths: newFolders.map((f) => f.relativePath),
        })
      }

      // Update all files in a single pass
      const updatedFiles = state.files.map((f) => {
        const update = f.pdmData?.id ? updateMap.get(f.pdmData.id) : undefined
        if (!update) return f

        const newFullPath = buildFullPath(vaultPath, update.newRelativePath)
        oldPathToNewPath.set(f.path, newFullPath)

        return {
          ...f,
          path: newFullPath,
          relativePath: update.newRelativePath,
          name: update.newFileName,
          extension: update.newFileName.includes('.')
            ? '.' + (update.newFileName.split('.').pop()?.toLowerCase() || '')
            : '',
          pdmData: { ...f.pdmData, ...update.pdmData } as PDMFile,
        }
      })

      // Mirror the same path changes onto state.serverFiles. Without this,
      // refreshCurrentFolder iterates a stale serverFiles list and resurrects
      // a ghost cloud-only entry at the old path.
      const updatedServerFiles = state.serverFiles.map((sf) => {
        const update = updateMap.get(sf.id)
        if (!update) return sf
        return {
          ...sf,
          file_path: update.newRelativePath,
          name: update.newFileName,
          extension: update.newFileName.includes('.')
            ? '.' + (update.newFileName.split('.').pop()?.toLowerCase() || '')
            : '',
        }
      })

      // Update selectedFiles if any were moved
      const updatedSelectedFiles = state.selectedFiles.map((p) => oldPathToNewPath.get(p) || p)

      return {
        files: [...updatedFiles, ...newFolders],
        serverFiles: updatedServerFiles,
        selectedFiles: updatedSelectedFiles,
      }
    })
  },

  removeCloudFile: (fileId) => {
    set((state) => ({
      files: state.files
        .filter((f) => {
          // Only remove cloud-only files
          if (f.pdmData?.id === fileId && f.diffStatus === 'cloud') {
            return false
          }
          return true
        })
        .map((f) => {
          // Mark locally existing files as 'deleted_remote'
          if (f.pdmData?.id === fileId && f.diffStatus !== 'cloud') {
            return {
              ...f,
              pdmData: undefined,
              isSynced: false,
              diffStatus: 'deleted_remote' as const,
            }
          }
          return f
        }),
      // Drop the matching serverFiles entry so refreshCurrentFolder does not
      // resurrect a ghost cloud-only entry from a stale server list.
      serverFiles: state.serverFiles.filter((sf) => sf.id !== fileId),
    }))
  },

  // Actions - Search
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchType: (searchType) => set({ searchType }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setIsSearching: (isSearching) => set({ isSearching }),
  addRecentSearch: (query) => {
    const { recentSearches } = get()
    const filtered = recentSearches.filter((s) => s.toLowerCase() !== query.toLowerCase())
    set({ recentSearches: [query, ...filtered].slice(0, 20) })
  },
  clearRecentSearches: () => set({ recentSearches: [] }),

  // Actions - Sort & Filter
  setSortColumn: (sortColumn) => set({ sortColumn }),
  setSortDirection: (sortDirection) => set({ sortDirection }),
  toggleSort: (column) => {
    const { sortColumn, sortDirection } = get()
    if (sortColumn === column) {
      set({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ sortColumn: column, sortDirection: 'asc' })
    }
  },
  setWorkflowStateFilter: (workflowStateFilter) => set({ workflowStateFilter }),
  setExtensionFilter: (extensionFilter) => set({ extensionFilter }),
  setHistoryFolderFilter: (folderPath) => set({ historyFolderFilter: folderPath }),
  setTrashFolderFilter: (folderPath) => set({ trashFolderFilter: folderPath }),

  // Actions - Ignore Patterns
  addIgnorePattern: (vaultId, pattern) => {
    const { ignorePatterns } = get()
    const current = ignorePatterns[vaultId] || []
    if (!current.includes(pattern)) {
      set({
        ignorePatterns: {
          ...ignorePatterns,
          [vaultId]: [...current, pattern],
        },
      })
    }
  },
  removeIgnorePattern: (vaultId, pattern) => {
    const { ignorePatterns } = get()
    const current = ignorePatterns[vaultId] || []
    set({
      ignorePatterns: {
        ...ignorePatterns,
        [vaultId]: current.filter((p) => p !== pattern),
      },
    })
  },
  setIgnorePatterns: (vaultId, patterns) => {
    const { ignorePatterns } = get()
    set({
      ignorePatterns: {
        ...ignorePatterns,
        [vaultId]: patterns,
      },
    })
  },
  getIgnorePatterns: (vaultId) => {
    return get().ignorePatterns[vaultId] || []
  },
  isPathIgnored: (vaultId, relativePath) => {
    const patterns = get().ignorePatterns[vaultId] || []
    const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase()

    for (const pattern of patterns) {
      const normalizedPattern = pattern.toLowerCase()

      // Extension pattern: *.ext
      if (normalizedPattern.startsWith('*.')) {
        const ext = normalizedPattern.slice(1) // ".ext"
        if (normalizedPath.endsWith(ext)) return true
      }
      // Folder pattern: foldername/ or foldername/**
      else if (normalizedPattern.endsWith('/') || normalizedPattern.endsWith('/**')) {
        const folderPattern = normalizedPattern.replace(/\/\*\*$/, '/').replace(/\/$/, '')
        if (
          normalizedPath === folderPattern ||
          normalizedPath.startsWith(folderPattern + '/') ||
          normalizedPath.includes('/' + folderPattern + '/') ||
          normalizedPath.includes('/' + folderPattern)
        ) {
          return true
        }
      }
      // Exact match pattern
      else if (
        normalizedPath === normalizedPattern ||
        normalizedPath.endsWith('/' + normalizedPattern)
      ) {
        return true
      }
      // Simple wildcard matching for other patterns
      else if (normalizedPattern.includes('*')) {
        const regex = new RegExp(
          '^' + normalizedPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        )
        if (regex.test(normalizedPath)) return true
      }
    }

    return false
  },

  // Actions - Processing (with operation type for inline button spinners)
  // These functions use batching to reduce React re-renders during bulk operations.
  // Multiple add/remove calls within the same microtask are combined into a single state update.

  addProcessingFolder: (path, operationType) => {
    // Add to pending batch (overrides any pending remove)
    pendingProcessingRemoves.delete(path)
    pendingProcessingAdds.set(path, operationType)
    scheduleProcessingFlush(get, set)
  },

  addProcessingFolders: (paths, operationType) => {
    if (paths.length === 0) return
    // Add all to pending batch
    for (const path of paths) {
      pendingProcessingRemoves.delete(path)
      pendingProcessingAdds.set(path, operationType)
    }
    scheduleProcessingFlush(get, set)
  },

  addProcessingFoldersSync: (paths, operationType) => {
    if (paths.length === 0) return
    // Add all to pending batch
    for (const path of paths) {
      pendingProcessingRemoves.delete(path)
      pendingProcessingAdds.set(path, operationType)
    }
    // Flush synchronously so UI shows spinner BEFORE async operations begin
    flushProcessingSync(get, set)
  },

  removeProcessingFolder: (path) => {
    // Add to pending removes (cancel any pending add)
    pendingProcessingAdds.delete(path)
    pendingProcessingRemoves.add(path)
    scheduleProcessingFlush(get, set)
  },

  removeProcessingFolders: (paths) => {
    if (paths.length === 0) return
    // Add all to pending removes
    for (const path of paths) {
      pendingProcessingAdds.delete(path)
      pendingProcessingRemoves.add(path)
    }
    scheduleProcessingFlush(get, set)
  },

  removeProcessingFoldersSync: (paths) => {
    if (paths.length === 0) return
    // Add all to pending removes
    for (const path of paths) {
      pendingProcessingAdds.delete(path)
      pendingProcessingRemoves.add(path)
    }
    // Flush synchronously so UI updates IMMEDIATELY after operation completes
    flushProcessingSync(get, set)
  },

  clearProcessingFolders: () => set({ processingOperations: new Map() }),
  getProcessingOperation: (path, _isDirectory = false) => {
    const { processingOperations } = get()
    const normalizedPath = path.replace(/\\/g, '/')

    // Direct lookup first - works for both files and folders
    if (processingOperations.has(path)) {
      return processingOperations.get(path)!
    }
    if (processingOperations.has(normalizedPath)) {
      return processingOperations.get(normalizedPath)!
    }

    // Check if THIS path is INSIDE any processing folder (downward propagation)
    // This makes spinners propagate DOWN to children, not UP to parents
    for (const [processingPath, opType] of processingOperations) {
      const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
      // Check if THIS path is inside a processing folder
      if (normalizedPath.startsWith(normalizedProcessingPath + '/')) {
        return opType
      }
    }

    return null
  },

  // Actions - SolidWorks Configurations
  toggleConfigExpansion: (filePath: string) => {
    const { expandedConfigFiles } = get()
    const newExpanded = new Set(expandedConfigFiles)
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath)
      // Also clear selected configs for this file when collapsing
      const { selectedConfigs } = get()
      const newSelected = new Set(
        [...selectedConfigs].filter((key) => !key.startsWith(filePath + '::')),
      )
      set({ expandedConfigFiles: newExpanded, selectedConfigs: newSelected })
    } else {
      newExpanded.add(filePath)
      set({ expandedConfigFiles: newExpanded })
    }
  },

  setExpandedConfigFiles: (paths: Set<string>) => set({ expandedConfigFiles: paths }),

  setSelectedConfigs: (configs: Set<string>) => set({ selectedConfigs: configs }),

  setFileConfigurations: (filePath: string, configs: import('../types').SWConfiguration[]) => {
    const { fileConfigurations } = get()
    const newMap = new Map(fileConfigurations)
    newMap.set(filePath, configs)
    set({ fileConfigurations: newMap })
  },

  clearFileConfigurations: (filePath: string) => {
    const { fileConfigurations } = get()
    const newMap = new Map(fileConfigurations)
    newMap.delete(filePath)
    set({ fileConfigurations: newMap })
  },

  setLoadingConfigs: (paths: Set<string>) => set({ loadingConfigs: paths }),

  addLoadingConfig: (filePath: string) => {
    const { loadingConfigs } = get()
    set({ loadingConfigs: new Set(loadingConfigs).add(filePath) })
  },

  removeLoadingConfig: (filePath: string) => {
    const { loadingConfigs } = get()
    const newSet = new Set(loadingConfigs)
    newSet.delete(filePath)
    set({ loadingConfigs: newSet })
  },

  clearAllConfigCaches: () => {
    set({
      fileConfigurations: new Map(),
      expandedConfigFiles: new Set(),
      selectedConfigs: new Set(),
      configBomData: new Map(),
      expandedConfigBoms: new Set(),
      drawingRefData: new Map(),
      expandedDrawingRefs: new Set(),
      expandedDrawingRefFiles: new Set(),
      configDrawingData: new Map(),
      expandedConfigDrawings: new Set(),
    })
  },

  // Actions - Configuration BOM expansion
  toggleConfigBomExpansion: (configKey: string) => {
    const { expandedConfigBoms } = get()
    const newExpanded = new Set(expandedConfigBoms)
    if (newExpanded.has(configKey)) {
      newExpanded.delete(configKey)
    } else {
      newExpanded.add(configKey)
    }
    set({ expandedConfigBoms: newExpanded })
  },

  setExpandedConfigBoms: (keys: Set<string>) => set({ expandedConfigBoms: keys }),

  setConfigBomData: (configKey: string, items: import('../types').ConfigBomItem[]) => {
    const { configBomData } = get()
    const newMap = new Map(configBomData)
    newMap.set(configKey, items)
    set({ configBomData: newMap })
  },

  clearConfigBomData: (configKey: string) => {
    const { configBomData } = get()
    const newMap = new Map(configBomData)
    newMap.delete(configKey)
    set({ configBomData: newMap })
  },

  addLoadingConfigBom: (configKey: string) => {
    const { loadingConfigBoms } = get()
    set({ loadingConfigBoms: new Set(loadingConfigBoms).add(configKey) })
  },

  removeLoadingConfigBom: (configKey: string) => {
    const { loadingConfigBoms } = get()
    const newSet = new Set(loadingConfigBoms)
    newSet.delete(configKey)
    set({ loadingConfigBoms: newSet })
  },

  // Actions - Drawing file expand (for .slddrw files showing referenced models)
  toggleDrawingRefExpansion: (filePath: string) => {
    const { expandedDrawingRefs } = get()
    const newExpanded = new Set(expandedDrawingRefs)
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath)
    } else {
      newExpanded.add(filePath)
    }
    set({ expandedDrawingRefs: newExpanded })
  },

  setDrawingRefData: (filePath: string, items: import('../types').DrawingRefItem[]) => {
    const { drawingRefData } = get()
    const newMap = new Map(drawingRefData)
    newMap.set(filePath, items)
    set({ drawingRefData: newMap })
  },

  clearDrawingRefData: (filePath: string) => {
    const { drawingRefData } = get()
    const newMap = new Map(drawingRefData)
    newMap.delete(filePath)
    set({ drawingRefData: newMap })
  },

  addLoadingDrawingRef: (filePath: string) => {
    const { loadingDrawingRefs } = get()
    set({ loadingDrawingRefs: new Set(loadingDrawingRefs).add(filePath) })
  },

  removeLoadingDrawingRef: (filePath: string) => {
    const { loadingDrawingRefs } = get()
    const newSet = new Set(loadingDrawingRefs)
    newSet.delete(filePath)
    set({ loadingDrawingRefs: newSet })
  },

  // Toggle expansion of a referenced file under a drawing to show its configs
  toggleDrawingRefFileExpansion: (key: string) => {
    const { expandedDrawingRefFiles } = get()
    const newExpanded = new Set(expandedDrawingRefFiles)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    set({ expandedDrawingRefFiles: newExpanded })
  },

  // Actions - Config -> drawings (for part/assembly configs showing which drawings reference them)
  toggleConfigDrawingExpansion: (configKey: string) => {
    const { expandedConfigDrawings } = get()
    const newExpanded = new Set(expandedConfigDrawings)
    if (newExpanded.has(configKey)) {
      newExpanded.delete(configKey)
    } else {
      newExpanded.add(configKey)
    }
    set({ expandedConfigDrawings: newExpanded })
  },

  setConfigDrawingData: (configKey: string, items: import('../types').DrawingRefItem[]) => {
    const { configDrawingData } = get()
    const newMap = new Map(configDrawingData)
    newMap.set(configKey, items)
    set({ configDrawingData: newMap })
  },

  clearConfigDrawingData: (configKey: string) => {
    const { configDrawingData } = get()
    const newMap = new Map(configDrawingData)
    newMap.delete(configKey)
    set({ configDrawingData: newMap })
  },

  addLoadingConfigDrawing: (configKey: string) => {
    const { loadingConfigDrawings } = get()
    set({ loadingConfigDrawings: new Set(loadingConfigDrawings).add(configKey) })
  },

  removeLoadingConfigDrawing: (configKey: string) => {
    const { loadingConfigDrawings } = get()
    const newSet = new Set(loadingConfigDrawings)
    newSet.delete(configKey)
    set({ loadingConfigDrawings: newSet })
  },

  // Actions - Realtime update debouncing
  markFileAsRecentlyModified: (fileId: string) => {
    const { recentlyModifiedFiles } = get()
    const newMap = new Map(recentlyModifiedFiles)
    newMap.set(fileId, Date.now())
    set({ recentlyModifiedFiles: newMap })
  },

  clearRecentlyModified: (fileId: string) => {
    const { recentlyModifiedFiles } = get()
    const newMap = new Map(recentlyModifiedFiles)
    newMap.delete(fileId)
    set({ recentlyModifiedFiles: newMap })
  },

  isFileRecentlyModified: (fileId: string) => {
    const { recentlyModifiedFiles } = get()
    const timestamp = recentlyModifiedFiles.get(fileId)
    if (!timestamp) return false
    // 15 second window - after this, realtime updates are allowed again
    const DEBOUNCE_WINDOW_MS = 15000
    return Date.now() - timestamp < DEBOUNCE_WINDOW_MS
  },

  // Actions - Pending pane sections
  togglePendingSection: (sectionId: string) => {
    const { expandedPendingSections } = get()
    const newExpanded = new Set(expandedPendingSections)
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId)
    } else {
      newExpanded.add(sectionId)
    }
    set({ expandedPendingSections: newExpanded })
  },

  // Getters
  getSelectedFileObjects: () => {
    const { files, selectedFiles } = get()
    return files.filter((f) => selectedFiles.includes(f.path))
  },

  getVisibleFiles: () => {
    const { files, expandedFolders, workflowStateFilter, extensionFilter, searchQuery } = get()

    let visible = files.filter((file) => {
      // Check if parent folder is expanded
      const parts = file.relativePath.split('/')
      if (parts.length > 1) {
        // Check all ancestor folders
        for (let i = 1; i <= parts.length - 1; i++) {
          const ancestorPath = parts.slice(0, i).join('/')
          if (!expandedFolders.has(ancestorPath)) {
            return false
          }
        }
      }
      return true
    })

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      visible = visible.filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.relativePath.toLowerCase().includes(query) ||
          f.pdmData?.part_number?.toLowerCase().includes(query) ||
          f.pdmData?.description?.toLowerCase().includes(query),
      )
    }

    // Apply workflow state filter
    if (workflowStateFilter.length > 0) {
      visible = visible.filter(
        (f) =>
          f.isDirectory ||
          !f.pdmData?.workflow_state_id ||
          workflowStateFilter.includes(f.pdmData.workflow_state_id),
      )
    }

    // Apply extension filter
    if (extensionFilter.length > 0) {
      visible = visible.filter((f) => f.isDirectory || extensionFilter.includes(f.extension))
    }

    return visible
  },

  getFileByPath: (path) => {
    const { files } = get()
    // Case-insensitive matching for Windows compatibility
    const pathLower = path.toLowerCase()
    return files.find((f) => f.path.toLowerCase() === pathLower)
  },

  getDeletedFiles: () => {
    const { files, serverFiles, vaultPath } = get()
    if (!vaultPath) return []

    const localPaths = new Set(files.map((f) => f.relativePath.toLowerCase()))

    return serverFiles
      .filter((sf) => !localPaths.has(sf.file_path.toLowerCase()))
      .map((sf) => ({
        name: sf.name,
        path: buildFullPath(vaultPath, sf.file_path),
        relativePath: sf.file_path,
        isDirectory: false,
        extension: sf.extension,
        size: 0,
        modifiedTime: '',
        diffStatus: 'deleted' as DiffStatus,
        pdmData: { id: sf.id } as any, // TODO: type this
      }))
  },

  getFolderDiffCounts: (folderPath: string) => {
    const { files } = get()

    let added = 0
    let modified = 0
    let moved = 0
    let deleted = 0
    let outdated = 0
    let cloud = 0
    let cloudNew = 0

    const prefix = folderPath ? folderPath + '/' : ''
    for (const file of files) {
      if (file.isDirectory) continue

      if (folderPath) {
        if (!file.relativePath.startsWith(prefix)) continue
      }

      if (file.diffStatus === 'added') added++
      else if (file.diffStatus === 'modified') modified++
      else if (file.diffStatus === 'moved') moved++
      else if (file.diffStatus === 'deleted') deleted++
      else if (file.diffStatus === 'outdated') outdated++
      else if (file.diffStatus === 'cloud') cloud++
    }

    return { added, modified, moved, deleted, outdated, cloud, cloudNew }
  },
})
