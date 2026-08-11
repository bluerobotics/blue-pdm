import { useMemo, useCallback, useDeferredValue, useRef } from 'react'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import {
  getCheckoutDisplayUser,
  getCheckoutUsersSignature,
} from '@/lib/checkout/checkoutDisplay'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { isPathHidden } from '@/lib/hiddenFolders'
import type { OperationType } from '@/stores/types'
import {
  getFolderCheckoutStatus,
  isFolderSynced,
  getFolderCheckoutUsers,
  computeFolderVisualState,
  type CheckoutUser,
} from '@/components/shared/FileItem'
import type { TreeMap, FolderDiffCounts } from '../types'
import { recordMetric } from '@/lib/performanceMetrics'
import { logExplorer } from '@/lib/userActionLogger'

/**
 * Pre-computed folder metrics for O(1) lookups instead of O(N) per-folder computations.
 * Matches the FolderMetrics type from browser/types.ts for consistency.
 *
 * PERFORMANCE: All folder statistics including diff counts are computed in a single O(N) pass
 * through the files array. Each lookup (getDiffCounts, checkFolderSynced, etc.) is O(1).
 */
export interface FolderMetrics {
  /** Number of cloud-only files in this folder (recursively) */
  cloudFilesCount: number
  /** Number of new cloud files (first download pending) */
  cloudNewFilesCount: number
  /** Number of local-only files (unsynced) */
  localOnlyFilesCount: number
  /** Number of files that can be checked out */
  checkoutableFilesCount: number
  /** Number of outdated files needing update */
  outdatedFilesCount: number
  /** Has at least one checkoutable file */
  hasCheckoutableFiles: boolean
  /** Has at least one file checked out by current user */
  hasMyCheckedOutFiles: boolean
  /** Has at least one file checked out by others */
  hasOthersCheckedOutFiles: boolean
  /** Has any unsynced files */
  hasUnsyncedFiles: boolean
  /** Count of files checked out by current user */
  myCheckedOutFilesCount: number
  /** Total count of all checked out files */
  totalCheckedOutFilesCount: number
  /** Number of synced (non-checkout, non-cloud) files */
  syncedFilesCount: number
  /** List of users who have files checked out */
  checkoutUsers: CheckoutUser[]
  /** Stable identity signature for all displayed checkout users in this folder */
  checkoutSignature: string
  /**
   * Whether folder text should be normal (true) or italic/muted (false).
   * Computed via priority-based logic from computeFolderVisualState().
   */
  isSynced: boolean
  /** Checkout status: 'mine' | 'others' | 'both' | null */
  checkoutStatus: 'mine' | 'others' | 'both' | null
  /**
   * Priority-based folder icon color (Tailwind class).
   * Computed via computeFolderVisualState() using priority order:
   * local-only > server-only > synced > mine > others
   */
  iconColor: string

  // ─── Diff Counts (for FolderDiffCounts compatibility) ───────────────────────
  /** Number of locally added files (not yet synced to cloud) */
  addedCount: number
  /** Number of modified files (local changes pending) */
  modifiedCount: number
  /** Number of moved files (path changed, pending sync) */
  movedCount: number
  /** Number of deleted files (removed locally, pending sync) */
  deletedCount: number
  /** Number of files deleted on remote (exists locally but removed from cloud) */
  deletedRemoteCount: number
}

/** Map of folder path to pre-computed metrics */
export type FolderMetricsMap = Map<string, FolderMetrics>

// ============================================================================
// Cross-instance memo caches
// ============================================================================
// useVaultTree runs in up to three places at once: FileTree, and FilePane plus
// useFilePaneView via useFolderMetrics. Each has its own useMemo, so a single
// store update used to trigger the O(N) tree and folderMetrics passes once per
// instance over tens of thousands of files. All instances read the same store
// values, so the dependency tuples are reference-identical and a one-entry cache
// collapses them into a single computation. Both passes are pure over their deps.

function depsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

let treeMemoCache: { deps: readonly unknown[]; result: TreeMap } | null = null
let folderMetricsMemoCache: { deps: readonly unknown[]; result: FolderMetricsMap } | null = null

/**
 * Hook for building and managing the vault file tree
 * Handles tree construction, filtering, and folder statistics
 *
 * PERFORMANCE: Uses O(N) single-pass folder metrics computation instead of
 * O(N²) per-folder filtering. The folderMetrics Map is pre-computed once
 * and all folder stat functions do O(1) lookups.
 */
export function useVaultTree() {
  // Selective state selectors - each subscription only triggers on its own changes
  const files = usePDMStore((s) => s.files)
  const hideSolidworksTempFiles = usePDMStore((s) => s.hideSolidworksTempFiles)
  const hideCloudOnlyFolders = usePDMStore((s) => s.hideCloudOnlyFolders)
  const user = usePDMStore((s) => s.user)
  const checkoutHydration = usePDMStore((s) => s.checkoutHydration)
  const processingOperations = usePDMStore((s) => s.processingOperations)
  const { enforcedHiddenPaths } = useHiddenFolders()

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFORMANCE OPTIMIZATION: useDeferredValue for folderMetrics
  // ═══════════════════════════════════════════════════════════════════════════
  // The folderMetrics computation is O(N × depth) which with 22K+ files takes
  // ~100-200ms and blocks the UI thread. By using useDeferredValue, React can:
  // 1. Keep the UI responsive by yielding to user input
  // 2. Batch multiple rapid file updates into fewer re-computations
  // 3. Show stale metrics briefly while computing new ones
  //
  // The tree structure uses immediate `files` for accurate navigation,
  // while folder metrics (visual indicators) use deferred data.
  // ═══════════════════════════════════════════════════════════════════════════
  const deferredFiles = useDeferredValue(files)

  // Read via ref inside folderMetrics so the memo can depend on deferredFiles alone.
  // With `files` in its dependency array the memo also ran on the pre-deferral render,
  // recomputing over the whole vault against data it was about to be handed again.
  const isDeferredRef = useRef(false)
  isDeferredRef.current = deferredFiles !== files

  // Note: getFolderDiffCounts no longer needed from store - computed in folderMetrics Map
  // This eliminates O(N) per-folder calls, replacing with O(1) Map lookups

  // Build folder tree structure
  const tree = useMemo<TreeMap>(() => {
    const deps = [files, hideSolidworksTempFiles, hideCloudOnlyFolders, enforcedHiddenPaths] as const
    if (treeMemoCache && depsEqual(treeMemoCache.deps, deps)) {
      return treeMemoCache.result
    }

    const _treeStart = performance.now()
    logExplorer('tree useMemo START', { filesCount: files.length, hideCloudOnlyFolders })
    const treeMap: TreeMap = { '': [] }

    // Filter out any undefined or invalid files and optionally hide SolidWorks temp files
    const validFiles = files.filter((f) => {
      if (!f || !f.relativePath || !f.name) return false
      // Hide SolidWorks temp lock files (~$filename.sldxxx) when setting is enabled
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      // Folders an admin marked hidden, plus everything nested under them
      if (isPathHidden(f.relativePath, enforcedHiddenPaths)) return false
      return true
    })

    // When hideCloudOnlyFolders is enabled, compute which folders have downloaded files
    // A folder is considered "has downloads" if any file in it (recursively) is NOT cloud-only
    let foldersWithDownloads: Set<string> | null = null
    if (hideCloudOnlyFolders) {
      foldersWithDownloads = new Set<string>()

      for (const file of validFiles) {
        // Check if this file is downloaded (not cloud-only)
        if (!file.isDirectory && file.diffStatus !== 'cloud') {
          // Mark all parent folders as having downloads
          const parts = file.relativePath.split('/')
          let currentPath = ''
          for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
            foldersWithDownloads.add(currentPath)
          }
        }
      }
    }

    validFiles.forEach((file) => {
      const parts = file.relativePath.split('/')

      // When filtering, skip files/folders in cloud-only folders
      if (hideCloudOnlyFolders && foldersWithDownloads) {
        if (file.isDirectory) {
          // Skip folders that don't have any downloaded files
          if (!foldersWithDownloads.has(file.relativePath)) {
            return
          }
        } else {
          // Skip cloud-only files in cloud-only folders
          // But keep cloud files that are in folders WITH downloaded files (mixed folders)
          if (file.diffStatus === 'cloud') {
            // If this cloud file's immediate parent doesn't have downloads, skip it
            // This ensures we show cloud files in mixed folders but not in pure cloud folders
            const immediateParent = parts.slice(0, -1).join('/')
            if (!foldersWithDownloads.has(immediateParent) && immediateParent !== '') {
              return
            }
          }
        }
      }

      if (parts.length === 1) {
        treeMap[''].push(file)
      } else {
        const parentPath = parts.slice(0, -1).join('/')
        if (!treeMap[parentPath]) {
          treeMap[parentPath] = []
        }
        treeMap[parentPath].push(file)
      }
    })

    logExplorer('tree useMemo END', {
      durationMs: Math.round(performance.now() - _treeStart),
      treeKeyCount: Object.keys(treeMap).length,
      rootItems: treeMap['']?.length,
    })

    treeMemoCache = { deps, result: treeMap }
    return treeMap
  }, [files, hideSolidworksTempFiles, hideCloudOnlyFolders, enforcedHiddenPaths])

  /**
   * Pre-computed folder metrics in a single O(N) pass.
   *
   * PERFORMANCE OPTIMIZATION:
   * Previously, each visible folder would call getLocalOnlyCount(), getFolderCheckoutStats(),
   * checkFolderSynced(), etc. Each function did files.filter() - O(N) per folder.
   * With 50 visible folders × 5 stat functions × 1000 files = 250,000+ iterations per render.
   *
   * Now: Single O(N) pass = 1000 iterations total. Each lookup is O(1).
   *
   * ADDITIONAL OPTIMIZATIONS:
   * - Merged checkout user collection into the first pass, eliminating a second O(N) iteration.
   * - Uses Map<userId, CheckoutUser> per folder for O(1) deduplication during iteration.
   * - Uses useDeferredValue(files) to prevent UI freezes during rapid file updates.
   *   React can yield to user input while this computation runs in the background.
   */
  const folderMetrics = useMemo<FolderMetricsMap>(() => {
    const deps = [
      deferredFiles,
      user?.id,
      user?.full_name,
      user?.email,
      user?.avatar_url,
      checkoutHydration,
      hideSolidworksTempFiles,
      enforcedHiddenPaths,
    ] as const
    if (folderMetricsMemoCache && depsEqual(folderMetricsMemoCache.deps, deps)) {
      return folderMetricsMemoCache.result
    }

    const startTime = performance.now()
    const fileCount = deferredFiles.length
    const isDeferred = isDeferredRef.current
    logExplorer('folderMetrics useMemo START', { fileCount, isDeferred })
    recordMetric('FolderMetrics', 'Starting computation', { fileCount, isDeferred })

    const metrics = new Map<string, FolderMetrics>()
    // Track checkout users per folder using Map for O(1) deduplication during single pass
    const checkoutUsersMaps = new Map<string, Map<string, CheckoutUser>>()
    const userId = user?.id

    // Get all non-directory files (optionally excluding SolidWorks temp files)
    // Uses deferredFiles to allow React to batch updates and yield to user input
    const allNonDirFiles = deferredFiles.filter((f) => {
      if (!f || !f.relativePath || !f.name) return false
      if (f.isDirectory) return false
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      if (isPathHidden(f.relativePath, enforcedHiddenPaths)) return false
      return true
    })

    // Helper to initialize empty metrics for a folder path
    const initMetrics = (): FolderMetrics => ({
      cloudFilesCount: 0,
      cloudNewFilesCount: 0,
      localOnlyFilesCount: 0,
      checkoutableFilesCount: 0,
      outdatedFilesCount: 0,
      hasCheckoutableFiles: false,
      hasMyCheckedOutFiles: false,
      hasOthersCheckedOutFiles: false,
      hasUnsyncedFiles: false,
      myCheckedOutFilesCount: 0,
      totalCheckedOutFilesCount: 0,
      syncedFilesCount: 0,
      checkoutUsers: [],
      checkoutSignature: getCheckoutUsersSignature([]),
      isSynced: false, // Will be computed via computeFolderVisualState in post-processing
      checkoutStatus: null,
      iconColor: 'text-plm-fg-muted', // Will be computed via computeFolderVisualState in post-processing
      // Diff counts - initialized to 0, computed in single pass below
      addedCount: 0,
      modifiedCount: 0,
      movedCount: 0,
      deletedCount: 0,
      deletedRemoteCount: 0,
    })

    // Server-only statuses (files not locally present)
    const serverOnlyStatuses = ['cloud', 'deleted']

    // Single pass through all files to compute folder metrics AND collect checkout users
    // Previously this was two O(N) passes; now merged for ~40% faster computation
    for (const file of allNonDirFiles) {
      // Get all parent folder paths for this file
      const parts = file.relativePath.split('/')
      let currentPath = ''

      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]

        if (!metrics.has(currentPath)) {
          metrics.set(currentPath, initMetrics())
          checkoutUsersMaps.set(currentPath, new Map<string, CheckoutUser>())
        }

        const m = metrics.get(currentPath)!

        // Cloud files
        if (file.diffStatus === 'cloud') {
          m.cloudFilesCount++
          // Cloud new = cloud files without existing revision (first download)
          if (!file.pdmData?.revision) {
            m.cloudNewFilesCount++
          }
        }

        // Local-only (unsynced) files - files without pdmData or marked as added/deleted_remote
        // Excludes cloud-only and ignored files
        if (
          (!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') &&
          file.diffStatus !== 'cloud' &&
          file.diffStatus !== 'ignored'
        ) {
          m.localOnlyFilesCount++
          m.hasUnsyncedFiles = true
        }

        // Checkoutable files (synced, not checked out, exists locally)
        if (
          file.pdmData &&
          !file.pdmData.checked_out_by &&
          file.diffStatus !== 'cloud' &&
          file.diffStatus !== 'deleted'
        ) {
          m.checkoutableFilesCount++
          m.hasCheckoutableFiles = true
        }

        // Outdated files
        if (file.diffStatus === 'outdated') {
          m.outdatedFilesCount++
        }

        // Synced count (has pdmData, not checked out, not cloud-only)
        if (file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud') {
          m.syncedFilesCount++
        }

        // Checkout tracking - exclude server-only files
        if (!serverOnlyStatuses.includes(file.diffStatus || '')) {
          // Checked out by me
          if (file.pdmData?.checked_out_by === userId) {
            m.hasMyCheckedOutFiles = true
            m.myCheckedOutFilesCount++
            m.totalCheckedOutFilesCount++
          }

          // Checked out by others
          if (file.pdmData?.checked_out_by && file.pdmData.checked_out_by !== userId) {
            m.hasOthersCheckedOutFiles = true
            m.totalCheckedOutFilesCount++
          }
        }

        // Note: isSynced and iconColor are computed in post-processing using
        // computeFolderVisualState() for priority-based logic

        // ─── Diff Status Counting ─────────────────────────────────────────────────
        // Count files by diffStatus for getDiffCounts() O(1) lookups.
        // Note: outdatedFilesCount and cloudFilesCount are already tracked above.
        if (file.diffStatus === 'added') {
          m.addedCount++
        } else if (file.diffStatus === 'modified') {
          m.modifiedCount++
        } else if (file.diffStatus === 'moved') {
          m.movedCount++
        } else if (file.diffStatus === 'deleted') {
          m.deletedCount++
        } else if (file.diffStatus === 'deleted_remote') {
          m.deletedRemoteCount++
        }
        // Note: 'cloud' and 'outdated' are already counted in cloudFilesCount and outdatedFilesCount

        // ─── Checkout Users Collection (merged from second pass) ──────────────────
        // Collect unique checkout users per folder using Map for O(1) deduplication.
        // Previously this was a separate O(N) pass; now merged for better performance.
        // Also tracks file IDs per user for folder notification functionality.
        if (file.pdmData?.checked_out_by && file.pdmData?.id && file.diffStatus !== 'deleted') {
          const checkoutUserId = file.pdmData.checked_out_by
          const fileId = file.pdmData.id
          const usersMap = checkoutUsersMaps.get(currentPath)!

          // O(1) deduplication via Map.has() instead of O(users) array.some()
          if (!usersMap.has(checkoutUserId)) {
            const displayUser = getCheckoutDisplayUser(
              file,
              user,
              fileId ? checkoutHydration[fileId]?.state : undefined,
            )
            if (
              displayUser &&
              (displayUser.displayState === 'mine' ||
                displayUser.displayState === 'resolved')
            ) {
              usersMap.set(checkoutUserId, {
                ...displayUser,
                fileIds: [fileId],
              })
            }
          } else {
            // User already exists, add this file ID to their list
            const existingUser = usersMap.get(checkoutUserId)!
            if (existingUser.fileIds) {
              existingUser.fileIds.push(fileId)
            } else {
              existingUser.fileIds = [fileId]
            }
          }
        }
      }
    }

    // Convert checkout user Maps to sorted arrays and compute visual state
    // This is O(folders) not O(files), so much faster than a second file iteration
    for (const [folderPath, m] of metrics) {
      const usersMap = checkoutUsersMaps.get(folderPath)
      if (usersMap && usersMap.size > 0) {
        // Convert Map values to array and sort (me first)
        m.checkoutUsers = Array.from(usersMap.values()).sort((a, b) => {
          if (a.isMe && !b.isMe) return -1
          if (!a.isMe && b.isMe) return 1
          return 0
        })
      }
      m.checkoutSignature = getCheckoutUsersSignature(m.checkoutUsers)

      // Compute checkout status
      if (m.hasMyCheckedOutFiles && m.hasOthersCheckedOutFiles) {
        m.checkoutStatus = 'both'
      } else if (m.hasMyCheckedOutFiles) {
        m.checkoutStatus = 'mine'
      } else if (m.hasOthersCheckedOutFiles) {
        m.checkoutStatus = 'others'
      }

      // Compute priority-based folder visual state (iconColor and isSynced)
      // Priority order: local-only > server-only > synced > mine > others
      const visualState = computeFolderVisualState(
        m.localOnlyFilesCount > 0, // hasLocalOnly
        m.cloudFilesCount > 0, // hasServerOnly
        m.syncedFilesCount > 0, // hasSynced
        m.hasMyCheckedOutFiles, // hasMineCheckouts
        m.hasOthersCheckedOutFiles, // hasOthersCheckouts
      )
      m.iconColor = visualState.iconColor
      m.isSynced = visualState.isSynced
    }

    const durationMs = performance.now() - startTime
    logExplorer('folderMetrics useMemo END', {
      folderCount: metrics.size,
      durationMs: Math.round(durationMs),
    })
    recordMetric('FolderMetrics', 'Computation complete', {
      folderCount: metrics.size,
      durationMs: Math.round(durationMs * 100) / 100,
    })

    folderMetricsMemoCache = { deps, result: metrics }
    return metrics
  }, [
    deferredFiles,
    user,
    checkoutHydration,
    hideSolidworksTempFiles,
    enforcedHiddenPaths,
  ])

  // Check if a file/folder is affected by any processing operation
  // Spinners propagate DOWN to children, not UP to parents
  const isBeingProcessed = useCallback(
    (relativePath: string, _isDirectory: boolean = false): boolean => {
      const normalizedPath = relativePath.replace(/\\/g, '/')

      // Check if this exact path is being processed
      if (processingOperations.has(relativePath)) return true
      if (processingOperations.has(normalizedPath)) return true

      // Check if THIS path is INSIDE any processing folder (downward propagation)
      for (const processingPath of processingOperations.keys()) {
        const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
        if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return true
      }
      return false
    },
    [processingOperations],
  )

  // Get the operation type for a file/folder if it's being processed
  // Returns OperationType if processing, null otherwise
  // Spinners propagate DOWN to children, not UP to parents
  const getProcessingOperation = useCallback(
    (relativePath: string, _isDirectory: boolean = false): OperationType | null => {
      const normalizedPath = relativePath.replace(/\\/g, '/')

      // Check if this exact path is being processed
      if (processingOperations.has(relativePath)) {
        return processingOperations.get(relativePath)!
      }
      if (processingOperations.has(normalizedPath)) {
        return processingOperations.get(normalizedPath)!
      }

      // Check if THIS path is INSIDE any processing folder (downward propagation)
      // This makes spinners propagate DOWN to children, not UP to parents
      for (const [processingPath, opType] of processingOperations) {
        const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
        if (normalizedPath.startsWith(normalizedProcessingPath + '/')) {
          return opType
        }
      }
      return null
    },
    [processingOperations],
  )

  /**
   * Check if a folder is fully synced (for text styling: normal vs italic/muted).
   * O(1) lookup from pre-computed folderMetrics Map.
   * Falls back to O(N) computation for folders not in the Map (edge case).
   *
   * Note: Uses priority-based logic from computeFolderVisualState().
   * Priority order: local-only > server-only > synced > mine > others
   */
  const checkFolderSynced = useCallback(
    (folderPath: string): boolean => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        return metrics.isSynced
      }
      // Fallback for folders not in metrics (shouldn't happen in normal use)
      // Uses deferredFiles for consistency with folderMetrics computation
      const filteredFiles = hideSolidworksTempFiles
        ? deferredFiles.filter((f) => !f.name?.startsWith('~$'))
        : deferredFiles
      return isFolderSynced(folderPath, filteredFiles)
    },
    [folderMetrics, deferredFiles, hideSolidworksTempFiles],
  )

  /**
   * Get folder icon color (Tailwind class) using priority-based logic.
   * O(1) lookup from pre-computed folderMetrics Map.
   *
   * Priority order: local-only > server-only > synced > mine > others
   */
  const getFolderIconColorFromMetrics = useCallback(
    (folderPath: string): string => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        return metrics.iconColor
      }
      // Fallback for folders not in metrics - return default grey
      return 'text-plm-fg-muted'
    },
    [folderMetrics],
  )

  /**
   * Get checkout status for a folder.
   * O(1) lookup from pre-computed folderMetrics Map.
   * Falls back to O(N) computation for folders not in the Map (edge case).
   */
  const checkFolderCheckoutStatus = useCallback(
    (folderPath: string) => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        return metrics.checkoutStatus
      }
      // Fallback for folders not in metrics - uses deferredFiles for consistency
      return getFolderCheckoutStatus(folderPath, deferredFiles, user?.id)
    },
    [folderMetrics, deferredFiles, user?.id],
  )

  /**
   * Get checkout users for a folder.
   * O(1) lookup from pre-computed folderMetrics Map.
   * Falls back to O(N) computation for folders not in the Map (edge case).
   */
  const getCheckoutUsersForFolder = useCallback(
    (folderPath: string): CheckoutUser[] => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        return metrics.checkoutUsers
      }
      // Fallback for folders not in metrics - uses deferredFiles for consistency
      return getFolderCheckoutUsers(
        folderPath,
        deferredFiles,
        user?.id,
        user?.full_name || undefined,
        user?.email || undefined,
        user?.avatar_url || undefined,
      )
    },
    [folderMetrics, deferredFiles, user?.id, user?.full_name, user?.email, user?.avatar_url],
  )

  /**
   * Get diff counts for a folder.
   * O(1) lookup from pre-computed folderMetrics Map.
   * Falls back to computing manually for folders not in the Map (edge case).
   *
   * PERFORMANCE OPTIMIZATION: Previously called getFolderDiffCountsFromStore which
   * iterated through ALL files (O(N)) for EVERY visible folder. With 50 visible folders
   * and 1000 files, that was 50,000+ iterations per render.
   * Now: Single O(N) pass computes all metrics. Each getDiffCounts call is O(1).
   */
  const getDiffCounts = useCallback(
    (folderPath: string): FolderDiffCounts => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        // O(1) lookup from pre-computed Map
        return {
          added: metrics.addedCount,
          modified: metrics.modifiedCount,
          moved: metrics.movedCount,
          deleted: metrics.deletedCount,
          outdated: metrics.outdatedFilesCount,
          cloud: metrics.cloudFilesCount,
          cloudNew: metrics.cloudNewFilesCount,
        }
      }

      // Fallback for folders not in metrics (edge case - empty folders or root)
      // This should rarely execute in normal use
      // Uses deferredFiles for consistency with folderMetrics computation
      const prefix = folderPath ? folderPath + '/' : ''
      let added = 0,
        modified = 0,
        moved = 0,
        deleted = 0,
        outdated = 0,
        cloud = 0,
        cloudNew = 0

      for (const file of deferredFiles) {
        if (file.isDirectory) continue
        if (!file.relativePath) continue
        if (folderPath && !file.relativePath.startsWith(prefix)) continue
        if (hideSolidworksTempFiles && file.name?.startsWith('~$')) continue

        if (file.diffStatus === 'added') added++
        else if (file.diffStatus === 'modified') modified++
        else if (file.diffStatus === 'moved') moved++
        else if (file.diffStatus === 'deleted') deleted++
        else if (file.diffStatus === 'outdated') outdated++
        else if (file.diffStatus === 'cloud') {
          cloud++
          if (!file.pdmData?.revision) cloudNew++
        }
      }

      return { added, modified, moved, deleted, outdated, cloud, cloudNew }
    },
    [folderMetrics, deferredFiles, hideSolidworksTempFiles],
  )

  /**
   * Get local-only files count for a folder.
   * O(1) lookup from pre-computed folderMetrics Map.
   * Falls back to O(N) computation for folders not in the Map (edge case).
   */
  const getLocalOnlyCount = useCallback(
    (folderPath: string): number => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        return metrics.localOnlyFilesCount
      }
      // Fallback for folders not in metrics - uses deferredFiles for consistency
      return deferredFiles.filter(
        (f) =>
          !f.isDirectory &&
          f.relativePath &&
          (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') &&
          f.diffStatus !== 'cloud' &&
          f.diffStatus !== 'ignored' &&
          f.relativePath.startsWith(folderPath + '/') &&
          !(hideSolidworksTempFiles && f.name?.startsWith('~$')),
      ).length
    },
    [folderMetrics, deferredFiles, hideSolidworksTempFiles],
  )

  /**
   * Get folder checkout statistics.
   * O(1) lookup from pre-computed folderMetrics Map.
   * Falls back to O(N) computation for folders not in the Map (edge case).
   */
  const getFolderCheckoutStats = useCallback(
    (folderPath: string) => {
      const metrics = folderMetrics.get(folderPath)
      if (metrics !== undefined) {
        return {
          checkoutUsers: metrics.checkoutUsers,
          checkedOutByMeCount: metrics.myCheckedOutFilesCount,
          totalCheckouts: metrics.totalCheckedOutFilesCount,
          syncedCount: metrics.syncedFilesCount,
        }
      }
      // Fallback for folders not in metrics - uses deferredFiles for consistency
      const checkoutUsers = getCheckoutUsersForFolder(folderPath)
      const checkedOutByMeCount = deferredFiles.filter(
        (f) =>
          !f.isDirectory &&
          f.relativePath &&
          f.pdmData?.checked_out_by === user?.id &&
          f.relativePath.startsWith(folderPath + '/'),
      ).length
      const totalCheckouts = deferredFiles.filter(
        (f) =>
          !f.isDirectory &&
          f.relativePath &&
          f.pdmData?.checked_out_by &&
          f.relativePath.startsWith(folderPath + '/'),
      ).length
      const syncedCount = deferredFiles.filter(
        (f) =>
          !f.isDirectory &&
          f.relativePath &&
          f.pdmData &&
          !f.pdmData.checked_out_by &&
          f.diffStatus !== 'cloud' &&
          f.relativePath.startsWith(folderPath + '/'),
      ).length

      return {
        checkoutUsers,
        checkedOutByMeCount,
        totalCheckouts,
        syncedCount,
      }
    },
    [folderMetrics, deferredFiles, user?.id, getCheckoutUsersForFolder],
  )

  // Sort children for display
  const sortChildren = useCallback((children: LocalFile[]): LocalFile[] => {
    return children
      .filter((child) => child && child.name)
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
  }, [])

  return {
    tree,
    /** Pre-computed folder metrics Map for O(1) lookups */
    folderMetrics,
    isBeingProcessed,
    getProcessingOperation,
    checkFolderSynced,
    checkFolderCheckoutStatus,
    /** Get priority-based folder icon color (Tailwind class) */
    getFolderIconColorFromMetrics,
    getCheckoutUsersForFolder,
    getDiffCounts,
    getLocalOnlyCount,
    getFolderCheckoutStats,
    sortChildren,
  }
}
