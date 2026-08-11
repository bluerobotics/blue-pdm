// SIZE: this file is over the 1500-line split threshold in .cursor/rules/style.mdc.
// The performance work deliberately did not carry the split: loadFiles is one long
// pipeline whose stages share ~20 locals, so a mechanical extraction would have
// meant threading a large context object through every stage in the same change as
// behavioural fixes. New module-level state added by that work lives in
// ./loadFilesCoordination.ts instead, so the file did not grow. The inline
// TODO(decompose) markers below record the intended seams; take them one at a time
// in a change that does nothing else.

import { useCallback, useRef, startTransition } from 'react'
// flushSync removed - causes React crashes when called during existing render cycles
import { usePDMStore } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { getFilesLightweight, getCheckedOutUsers, getVaultFolders } from '@/lib/supabase'
import { executeCommand } from '@/lib/commands'
import { buildFullPath } from '@/lib/commands/types'
import { dropCommittedPendingMetadata } from '@/lib/pendingMetadata'
import { recordMetric } from '@/lib/performanceMetrics'
import { log } from '@/lib/logger'
import {
  getFilesWithCache,
  updateCachedUserInfo,
  type CacheWriteContext,
  type CachedServerFile,
} from '@/lib/cache/vaultFileCache'
import {
  getSyncIndex,
  updateSyncIndexFromServer,
  getInodeMap,
  getVersionMap,
  updateInodes,
} from '@/lib/cache/localSyncIndex'
import { logExplorer } from '@/lib/userActionLogger'
import type { CheckoutProfileScope } from '@/lib/supabase/files/queries'
import {
  hashCheckoutIdentifier,
  isCheckoutProfileForOwner,
  mergePdmFileData,
  reconcileCheckoutProfile,
  type CheckoutLoadContext,
  type CheckoutUserProfile,
  type LoadFilesSessionContext,
  type PDMFile,
} from '@/types/pdm'
import {
  computeLocalScanFingerprint,
  consumeSupersededLoad,
  getLastMergedState,
  isLoadFilesInFlight,
  markLoadSuperseded,
  runExclusiveLoad,
  setLastMergedState,
} from './loadFilesCoordination'
import { getFileMutationEpoch } from '@/lib/fileMutationEpoch'

const CHECKOUT_PROFILE_MAX_ATTEMPTS = 3
const CHECKOUT_PROFILE_RETRY_BASE_MS = 200
let loadRequestSequence = 0
const latestLoadRequestByVault = new Map<string, string>()

function createLoadRequestId(): string {
  loadRequestSequence += 1
  return `load-${Date.now()}-${loadRequestSequence}`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function waitForCheckoutRetry(attempt: number): Promise<void> {
  const delayMs = CHECKOUT_PROFILE_RETRY_BASE_MS * 2 ** (attempt - 1)
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

interface CheckoutProfileFetchResult {
  users: Record<string, CheckoutUserProfile>
  error: unknown
  attempts: number
}

async function fetchCheckoutProfilesWithRetry(
  fileIds: string[],
  scope: CheckoutProfileScope,
  requestId: string,
  isCurrent?: () => boolean,
): Promise<CheckoutProfileFetchResult> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= CHECKOUT_PROFILE_MAX_ATTEMPTS; attempt++) {
    if (isCurrent && !isCurrent()) {
      return { users: {}, error: null, attempts: attempt - 1 }
    }

    const fetchStart = performance.now()
    let result: { users: Record<string, CheckoutUserProfile>; error: unknown }
    try {
      result = await getCheckedOutUsers(fileIds, scope)
    } catch (error) {
      result = { users: {}, error }
    }
    const latencyMs = Math.round(performance.now() - fetchStart)

    if (isCurrent && !isCurrent()) {
      log.info('[CheckoutHydration]', 'Discarding profile response after context change', {
        requestId,
        orgId: hashCheckoutIdentifier(scope.orgId),
        vaultId: hashCheckoutIdentifier(scope.vaultId),
        attempt,
        latencyMs,
        stale: true,
      })
      return { users: {}, error: null, attempts: attempt }
    }

    if (!result.error) {
      log.info('[CheckoutHydration]', 'Checkout profiles fetched', {
        requestId,
        orgId: hashCheckoutIdentifier(scope.orgId),
        vaultId: hashCheckoutIdentifier(scope.vaultId),
        fileCount: fileIds.length,
        hitCount: Object.keys(result.users).length,
        missCount: fileIds.length - Object.keys(result.users).length,
        attempt,
        latencyMs,
        stale: false,
      })
      return { users: result.users, error: null, attempts: attempt }
    }

    lastError = result.error
    log.warn('[CheckoutHydration]', 'Checkout profile lookup failed', {
      requestId,
      orgId: hashCheckoutIdentifier(scope.orgId),
      vaultId: hashCheckoutIdentifier(scope.vaultId),
      fileCount: fileIds.length,
      attempt,
      latencyMs,
      error: getErrorMessage(result.error),
      retrying: attempt < CHECKOUT_PROFILE_MAX_ATTEMPTS,
    })

    if (attempt < CHECKOUT_PROFILE_MAX_ATTEMPTS) {
      await waitForCheckoutRetry(attempt)
    }
  }

  return { users: {}, error: lastError, attempts: CHECKOUT_PROFILE_MAX_ATTEMPTS }
}

/**
 * Hook to load files from working directory and merge with PDM data
 * Handles:
 * - Local file scanning
 * - Server file fetching and merging
 * - Diff status computation (added, modified, outdated, moved, cloud, deleted)
 * - Background hash computation
 * - Auto-download of cloud files and updates
 *
 * @param sessionContext Optional auth boundary supplied by useAuth:
 * `{ authenticatedUserId: string | null; sessionGeneration: number }`.
 */
export function useLoadFiles(sessionContext?: LoadFilesSessionContext) {
  const {
    vaultPath,
    organization,
    isOfflineMode,
    activeVaultId,
    connectedVaults,
    user,
    setFiles,
    setServerFiles,
    setServerFolderPaths,
    setIsLoading,
    setStatusMessage,
    setFilesLoaded,
  } = usePDMStore(
    useShallow((s) => ({
      vaultPath: s.vaultPath,
      organization: s.organization,
      isOfflineMode: s.isOfflineMode,
      activeVaultId: s.activeVaultId,
      connectedVaults: s.connectedVaults,
      user: s.user,
      setFiles: s.setFiles,
      setServerFiles: s.setServerFiles,
      setServerFolderPaths: s.setServerFolderPaths,
      setIsLoading: s.setIsLoading,
      setStatusMessage: s.setStatusMessage,
      setFilesLoaded: s.setFilesLoaded,
    })),
  )

  const latestSessionContext = useRef<LoadFilesSessionContext | undefined>(sessionContext)
  latestSessionContext.current = sessionContext

  const authenticatedUserId =
    sessionContext?.authenticatedUserId !== undefined
      ? sessionContext.authenticatedUserId
      : (user?.id ?? null)
  const sessionGeneration = sessionContext?.sessionGeneration ?? 0

  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id

  // Load files from working directory and merge with PDM data
  // silent = true means no loading spinner (for background refreshes after downloads/uploads)
  // forceHashComputation = true forces full hash computation on ALL synced files (for Full Refresh)
  // changedRelativePaths, when supplied by the file watcher, lets the main process
  // re-stat only those paths instead of walking the whole vault.
  // Callers should use loadFiles below, which serializes passes; this is the raw implementation.
  const runLoadFiles = useCallback(
    async (
      silent: boolean = false,
      forceHashComputation: boolean = false,
      changedRelativePaths?: string[],
    ) => {
      // Capture vault context at start - used to detect if vault changed during async operations
      const loadingForVaultId = currentVaultId
      const loadingForVaultPath = vaultPath
      const loadContext: CheckoutLoadContext = {
        orgId: organization?.id ?? null,
        vaultId: loadingForVaultId ?? null,
        vaultPath: loadingForVaultPath,
        authenticatedUserId,
        sessionGeneration,
        requestId: createLoadRequestId(),
      }
      if (loadContext.vaultId) {
        latestLoadRequestByVault.set(loadContext.vaultId, loadContext.requestId)
      }

      window.electronAPI?.log('info', '[LoadFiles] Called with', {
        vaultPath: loadingForVaultPath,
        currentVaultId: loadingForVaultId,
        silent,
        forceHashComputation,
      })
      log.info('[CheckoutHydration]', 'Load context captured', {
        requestId: loadContext.requestId,
        orgId: hashCheckoutIdentifier(loadContext.orgId),
        vaultId: hashCheckoutIdentifier(loadContext.vaultId),
        vaultPath: hashCheckoutIdentifier(loadContext.vaultPath),
        authenticatedUserId: hashCheckoutIdentifier(loadContext.authenticatedUserId),
        sessionGeneration: loadContext.sessionGeneration,
      })
      if (!window.electronAPI || !loadingForVaultPath) return

      // A watcher delta refresh can be caused by BluePLM's own SolidWorks metadata write. Clearing
      // every configuration cache here would collapse the tree while the user is editing, even
      // when the file watcher delivers the event after watcher suppression expires. The edit path
      // already updates its cached configuration row, so keep the cache for targeted refreshes.
      // Full/manual refreshes still clear everything so they always reload SolidWorks data.
      const isWatcherDeltaRefresh = silent && (changedRelativePaths?.length ?? 0) > 0
      if (!isWatcherDeltaRefresh) {
        usePDMStore.getState().clearAllConfigCaches()
      }

      if (!silent) {
        setIsLoading(true)
        setStatusMessage(
          forceHashComputation ? 'Full refresh: Loading files...' : 'Loading files...',
        )
        // Yield to UI thread so loading state renders before heavy work
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      // Every asynchronous stage uses the same org/vault/path/session boundary.
      const isLoadContextCurrent = () => {
        const currentState = usePDMStore.getState()
        const currentActive = currentState.activeVaultId || currentState.connectedVaults[0]?.id
        const currentSession = latestSessionContext.current
        const currentUserId = currentState.user?.id ?? null
        const sessionMatches =
          currentSession === undefined ||
          (currentSession.authenticatedUserId === loadContext.authenticatedUserId &&
            currentSession.sessionGeneration === loadContext.sessionGeneration)
        const requestMatches =
          !loadContext.vaultId ||
          latestLoadRequestByVault.get(loadContext.vaultId) === loadContext.requestId

        return (
          currentState.organization?.id === loadContext.orgId &&
          (currentActive ?? null) === loadContext.vaultId &&
          currentState.vaultPath === loadContext.vaultPath &&
          currentUserId === loadContext.authenticatedUserId &&
          sessionMatches &&
          requestMatches
        )
      }
      const isVaultStale = () => !isLoadContextCurrent()
      const cacheContext: CacheWriteContext = {
        requestId: loadContext.requestId,
        isCurrent: isLoadContextCurrent,
      }

      // Gates the auto-discard below. The catch swallows errors rather than
      // rethrowing, so a failed pass also reaches that code; only a pass that
      // actually committed has an orphan list worth acting on.
      let committedMerge = false

      try {
        // Run local file scan and server fetch in PARALLEL for faster boot
        // Note: listWorkingFiles now returns FAST (no blocking hash computation)
        // Hashes are computed in background after initial display
        const shouldFetchServer = organization && !isOfflineMode && currentVaultId

        if (!silent) {
          setStatusMessage(
            shouldFetchServer ? 'Loading local & cloud files...' : 'Scanning local files...',
          )
        }

        // Start timing for vault load operations
        const vaultLoadStart = performance.now()
        recordMetric('VaultLoad', 'Starting vault load', { silent })

        // Start both operations at once, tracking each separately
        const localScanStart = performance.now()
        let localScanEnd = 0

        // Snapshot taken before the scan reads the disk, so any file operation that
        // lands while this pass runs makes the merge stale. See fileMutationEpoch.
        const epochAtScanStart = getFileMutationEpoch()

        // A delta scan is only safe when it can build on a prior full scan; the
        // main process falls back to a full walk on its own if it cannot.
        const canDeltaScan =
          !forceHashComputation &&
          changedRelativePaths !== undefined &&
          changedRelativePaths.length > 0

        const localPromise = (
          canDeltaScan
            ? window.electronAPI.listWorkingFilesDelta(changedRelativePaths!)
            : window.electronAPI.listWorkingFiles()
        ).then((result) => {
          localScanEnd = performance.now()
          return result
        })

        // Server fetch with caching - tries IndexedDB cache first, then delta sync
        // First load: Full fetch via RPC + cache in IndexedDB
        // Subsequent loads: Load from cache instantly + fetch only changes (delta sync)
        const serverPromise = shouldFetchServer
          ? getFilesWithCache(
              organization.id,
              currentVaultId,
              () => getFilesLightweight(organization.id, currentVaultId),
              cacheContext,
            )
          : Promise.resolve({
              files: null,
              error: null,
              cacheHit: false,
              deltaCount: 0,
              timing: { cacheReadMs: 0, fetchMs: 0, mergeMs: 0 },
            })

        // Also load the local sync index for detecting orphaned files
        // The sync index tracks files that were previously synced - if they're not on server anymore,
        // they were deleted by another user (orphaned)
        const syncIndexPromise = currentVaultId
          ? getSyncIndex(currentVaultId)
          : Promise.resolve(new Set<string>())

        // Load inode map for rename detection (ino -> old relativePath)
        const inodeMapPromise = currentVaultId
          ? getInodeMap(currentVaultId)
          : Promise.resolve(new Map<number, string[]>())

        // Load persisted version/hash data for accurate outdated detection on app restart
        const versionMapPromise = currentVaultId
          ? getVersionMap(currentVaultId)
          : Promise.resolve(new Map<string, { localVersion?: number; localHash?: string }>())

        // Fetch server folders (for empty folder sync feature)
        // These are explicit folder records, separate from implicit folders derived from file paths
        const serverFoldersPromise =
          shouldFetchServer && currentVaultId
            ? getVaultFolders(currentVaultId)
            : Promise.resolve({ folders: [], error: undefined })

        // Wait for all to complete
        const [
          localResult,
          serverResultWithCache,
          localSyncIndex,
          savedInodeMap,
          savedVersionMap,
          serverFoldersResult,
        ] = await Promise.all([
          localPromise,
          serverPromise,
          syncIndexPromise,
          inodeMapPromise,
          versionMapPromise,
          serverFoldersPromise,
        ])

        // Extract files from cache result
        const serverResult = {
          files: serverResultWithCache.files as CachedServerFile[] | null,
          error: serverResultWithCache.error,
        }

        // Record timing for local scan
        const localScanDuration = localScanEnd - localScanStart
        recordMetric('VaultLoad', 'Local scan complete', {
          durationMs: Math.round(localScanDuration),
          fileCount: localResult.files?.length || 0,
        })

        // Record timing for server fetch (only if we actually fetched)
        if (shouldFetchServer) {
          recordMetric('VaultLoad', 'Server fetch complete', {
            durationMs: serverResultWithCache.timing.fetchMs,
            fileCount: serverResult.files?.length || 0,
            cacheHit: serverResultWithCache.cacheHit,
            deltaCount: serverResultWithCache.deltaCount,
            cacheReadMs: serverResultWithCache.timing.cacheReadMs,
            networkFetchMs: serverResultWithCache.timing.fetchMs,
            deltaMergeMs: serverResultWithCache.timing.mergeMs,
          })
        }

        // Process local files
        if (!localResult.success || !localResult.files) {
          const errorMsg = localResult.error || 'Failed to load files'
          window.electronAPI?.log('error', '[LoadFiles] Local file scan failed', {
            errorMsg,
            vaultPath,
            hasWorkingDir: !!localResult,
          })
          setStatusMessage(errorMsg)
          return
        }

        if (!isLoadContextCurrent()) {
          log.info('[CheckoutHydration]', 'Discarding load before merge', {
            requestId: loadContext.requestId,
            orgId: hashCheckoutIdentifier(loadContext.orgId),
            vaultId: hashCheckoutIdentifier(loadContext.vaultId),
            stale: true,
          })
          return
        }

        window.electronAPI?.log('info', '[LoadFiles] Scanned local items', {
          count: localResult.files.length,
        })

        // Skip the merge when none of its three inputs moved.
        //
        // Server: cacheHit with a zero-row delta means the watermark query found no
        // changes. Disk: an identical scan fingerprint means no path, size or mtime
        // changed. Store: an unchanged file count means no other operation added or
        // removed entries since we last committed. With all three unchanged the merge
        // would recompute the same result over ~25k rows and rewrite the entire sync
        // index for nothing.
        //
        // Restricted to silent refreshes (the watcher path this exists for) and to
        // vaults already merged once, so explicit user refreshes and the first load of
        // a vault always take the full path.
        const localScanFingerprint = computeLocalScanFingerprint(localResult.files)
        const lastMerged = getLastMergedState(loadingForVaultId)
        const storeState = usePDMStore.getState()
        const canSkipMerge =
          silent &&
          !forceHashComputation &&
          serverResultWithCache.cacheHit &&
          serverResultWithCache.deltaCount === 0 &&
          lastMerged !== undefined &&
          lastMerged.scanFingerprint === localScanFingerprint &&
          lastMerged.storeFileCount === storeState.files.length &&
          storeState.filesLoaded &&
          !isVaultStale()

        if (canSkipMerge) {
          window.electronAPI?.log(
            'info',
            '[LoadFiles] Skipping merge - no local, server or store changes',
            {
              localFileCount: localResult.files.length,
              localScanMs: Math.round(localScanDuration),
            },
          )
          recordMetric('VaultLoad', 'Skipped merge (no changes)', {
            localFileCount: localResult.files.length,
            localScanMs: Math.round(localScanDuration),
          })
          return
        }

        window.electronAPI?.log('info', '[LoadFiles] Server query params', {
          orgId: organization?.id,
          vaultId: currentVaultId,
          shouldFetchServer,
          serverFileCount: serverResult.files?.length || 0,
          serverError: serverResult.error ? getErrorMessage(serverResult.error) : undefined,
        })

        // Debug: Log first few paths for comparison (helps debug path matching issues)
        if (serverResult.files && serverResult.files.length > 0) {
          const sampleServer = serverResult.files.slice(0, 5).map((f: any) => f.file_path)
          const sampleLocal = localResult.files
            .filter((f: any) => !f.isDirectory)
            .slice(0, 5)
            .map((f: any) => f.relativePath)
          window.electronAPI?.log('info', '[LoadFiles] Sample SERVER paths', sampleServer)
          window.electronAPI?.log('info', '[LoadFiles] Sample LOCAL paths', sampleLocal)

          // Try to find a matching file by name and compare full paths
          const firstServerFile = serverResult.files[0] as any // TODO: type this
          if (firstServerFile) {
            const serverFileName =
              firstServerFile.file_name || firstServerFile.file_path.split('/').pop()
            const matchingLocal = localResult.files.find((f: any) => f.name === serverFileName)
            if (matchingLocal) {
              window.electronAPI?.log('info', '[LoadFiles] PATH COMPARISON', {
                fileName: serverFileName,
                serverPath: firstServerFile.file_path,
                localPath: matchingLocal.relativePath,
                serverLower: firstServerFile.file_path.toLowerCase(),
                localLower: matchingLocal.relativePath.toLowerCase(),
                pathsEqual:
                  firstServerFile.file_path.toLowerCase() ===
                  matchingLocal.relativePath.toLowerCase(),
              })
            } else {
              window.electronAPI?.log('warn', '[LoadFiles] Could not find local file with name', {
                serverFileName,
              })
            }
          }
        }

        // Map hash to localHash for comparison
        let localFiles = localResult.files.map((f: any) => ({
          ...f,
          localHash: f.hash,
        }))

        // Get ignored paths checker for later use (don't filter, just mark as ignored)
        const isIgnoredPath = currentVaultId
          ? (path: string) => usePDMStore.getState().isPathIgnored(currentVaultId, path)
          : () => false

        // 2. If connected to Supabase, merge PDM data
        const mergeStart = performance.now()
        if (shouldFetchServer) {
          const pdmFiles = serverResult.files
          const pdmError = serverResult.error

          if (pdmError) {
            window.electronAPI?.log('warn', '[LoadFiles] Failed to fetch PDM data', {
              error: pdmError,
            })
          } else if (pdmFiles && Array.isArray(pdmFiles)) {
            if (!silent) {
              setStatusMessage(`Merging ${pdmFiles.length} files...`)
            }

            // Create a map of pdm data by file path (case-insensitive for Windows compatibility)
            // Windows filesystems are case-insensitive, so we normalize to lowercase for matching
            // The fast RPC intentionally returns a lightweight row, while LocalFile.pdmData
            // remains the established full-domain shape. The existing consumers only read the
            // lightweight fields here; keep the boundary explicit instead of leaking `any`.
            const pdmMap = new Map<string, PDMFile>(
              pdmFiles.map((file) => [
                file.file_path.toLowerCase(),
                file as unknown as PDMFile,
              ]),
            )

            // Create a map of server folders by path (case-insensitive for Windows compatibility)
            // These are explicit folder records from the folders table (for empty folder sync)
            const serverFoldersMap = new Map(
              (serverFoldersResult.folders || []).map((f) => [f.folder_path.toLowerCase(), f]),
            )

            // Debug: verify pdmMap keys
            const pdmMapKeys = Array.from(pdmMap.keys()).slice(0, 3)
            window.electronAPI?.log(
              'info',
              '[LoadFiles] pdmMap sample keys (lowercase)',
              pdmMapKeys,
            )
            window.electronAPI?.log('info', '[LoadFiles] Server folders count', {
              count: serverFoldersMap.size,
            })

            // Store server files for tracking deletions
            const serverFilesList = pdmFiles.map((file) => ({
              id: file.id,
              file_path: file.file_path,
              name: file.file_name,
              extension: file.extension ?? '',
              content_hash: file.content_hash || '',
            }))
            setServerFiles(serverFilesList)

            // Clean up auto-download exclusions for files that no longer exist on the server
            if (currentVaultId) {
              const serverFilePaths = new Set(pdmFiles.map((file) => file.file_path))
              usePDMStore.getState().cleanupStaleExclusions(currentVaultId, serverFilePaths)
            }

            // Compute all folder paths that exist on the server (from file paths + explicit folder records)
            const serverFolderPathsSet = new Set<string>()
            // Add folders implied by file paths
            for (const file of pdmFiles) {
              const pathParts = file.file_path.split('/')
              let currentPath = ''
              for (let i = 0; i < pathParts.length - 1; i++) {
                currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
                serverFolderPathsSet.add(currentPath)
              }
            }
            // Add explicit folder records (for empty folders)
            for (const folder of serverFoldersResult.folders || []) {
              serverFolderPathsSet.add(folder.folder_path)
            }
            setServerFolderPaths(serverFolderPathsSet)

            // Create set of local file paths for deletion detection (case-insensitive)
            const localPathSet = new Set(localFiles.map((f) => f.relativePath.toLowerCase()))

            // Create a map of existing files' localActiveVersion to preserve rollback state
            // Use getState() to get current files at execution time (not stale closure value)
            // Key by BOTH absolute path and relative path for robust lookup during refresh
            const currentFiles = usePDMStore.getState().files
            const existingLocalActiveVersions = new Map<string, number>()
            for (const f of currentFiles) {
              if (f.localActiveVersion !== undefined) {
                existingLocalActiveVersions.set(f.path, f.localActiveVersion)
                existingLocalActiveVersions.set(f.relativePath, f.localActiveVersion)
              }
            }

            // Create a map of existing files' localVersion to preserve tracked version numbers
            // localVersion tracks which version's content is actually on disk (set during download/checkin)
            // Seed from IndexedDB first (survives app restart), then overlay in-memory values
            const existingLocalVersions = new Map<string, number>()
            for (const [relPath, data] of savedVersionMap) {
              if (data.localVersion !== undefined) {
                existingLocalVersions.set(relPath, data.localVersion)
              }
            }
            for (const f of currentFiles) {
              if (f.localVersion !== undefined) {
                existingLocalVersions.set(f.path, f.localVersion)
                existingLocalVersions.set(f.relativePath, f.localVersion)
                // Mirror the lowercase convention used by the IndexedDB sync index
                // so cold-start (IndexedDB-only) and warm-refresh lookups share a key space.
                existingLocalVersions.set(f.relativePath.toLowerCase(), f.localVersion)
              }
            }

            // Create a map of existing files' localHash to preserve computed hashes
            // This prevents re-computing hashes or falling back to timestamp-based diff detection
            // when the file watcher triggers a refresh after operations like checkin
            // Seed from IndexedDB first (survives app restart), then overlay in-memory values
            // Index under BOTH relativePath and full path so the per-file lookup below can hit
            // either; mirrors existingLocalVersions which already does this correctly.
            const existingLocalHashes = new Map<string, string>()
            for (const [relPath, data] of savedVersionMap) {
              if (data.localHash) {
                existingLocalHashes.set(relPath, data.localHash)
              }
            }
            for (const f of currentFiles) {
              if (f.localHash) {
                existingLocalHashes.set(f.path, f.localHash)
                existingLocalHashes.set(f.relativePath, f.localHash)
                // Mirror the lowercase convention used by the IndexedDB sync index
                // so cold-start (IndexedDB-only) and warm-refresh lookups share a key space.
                existingLocalHashes.set(f.relativePath.toLowerCase(), f.localHash)
              }
            }

            // Create a map of existing files' pendingMetadata to preserve unsaved changes
            // This prevents losing user's edits (like generated part numbers) when FileWatcher triggers refresh
            const existingPendingMetadata = new Map<
              string,
              (typeof currentFiles)[0]['pendingMetadata']
            >()
            for (const f of currentFiles) {
              if (f.pendingMetadata && Object.keys(f.pendingMetadata).length > 0) {
                existingPendingMetadata.set(f.path, f.pendingMetadata)
              }
            }

            // Secondary map keyed by server-relative path for moved file lookups
            // When a file is renamed, pendingMetadata is stored under the OLD path, but we look up by NEW path.
            // This map allows us to find pending metadata using pdmData.file_path (the old server path).
            const existingPendingByServerPath = new Map<
              string,
              (typeof currentFiles)[0]['pendingMetadata']
            >()
            for (const f of currentFiles) {
              if (
                f.pendingMetadata &&
                Object.keys(f.pendingMetadata).length > 0 &&
                f.pdmData?.file_path
              ) {
                existingPendingByServerPath.set(
                  f.pdmData.file_path.toLowerCase(),
                  f.pendingMetadata,
                )
              }
            }

            // Preserve only profiles whose IDs still match the current owner.
            const existingCheckedOutUsers = new Map<string, CheckoutUserProfile>()
            for (const f of currentFiles) {
              const profile = f.pdmData?.checked_out_user
              if (
                f.pdmData?.id &&
                isCheckoutProfileForOwner(profile, f.pdmData.checked_out_by)
              ) {
                existingCheckedOutUsers.set(f.pdmData.id, profile)
              }
            }

            // Also get persistedPendingMetadata for app restart survival
            const { persistedPendingMetadata, isFileRecentlyModified } = usePDMStore.getState()

            // Create a map of existing files' pdmData for recently modified files
            // This prevents server data from overwriting local changes that were just saved
            // (e.g., when FileWatcher triggers LoadFiles right after Save to File before DB update propagates)
            const recentlyModifiedPdmData = new Map<string, (typeof currentFiles)[0]['pdmData']>()
            for (const f of currentFiles) {
              if (f.pdmData?.id && isFileRecentlyModified(f.pdmData.id)) {
                recentlyModifiedPdmData.set(f.path, f.pdmData)
                window.electronAPI?.log(
                  'debug',
                  '[LoadFiles] Preserving pdmData for recently modified file',
                  {
                    path: f.path,
                    fileId: f.pdmData.id,
                    partNumber: f.pdmData.part_number,
                  },
                )
              }
            }

            // Create a map of files checked out by me, keyed by content hash for move detection
            // This allows us to detect moved files (same content, different path) and preserve their pdmData
            // IMPORTANT: Only track checked-out-by-me files - if a file isn't checked out by me,
            // I couldn't have moved it, so matching hashes should be treated as new files, not moves.
            const checkedOutByMeByHash = new Map<string, PDMFile>()
            for (const pdmFile of pdmFiles) {
              if (pdmFile.content_hash && pdmFile.checked_out_by === user?.id) {
                checkedOutByMeByHash.set(
                  pdmFile.content_hash,
                  pdmFile as unknown as PDMFile,
                )
              }
            }

            // TODO(decompose): Extract to hooks/useLoadFiles/renameDetection.ts — hash-based
            // and inode-based rename detection (~130 lines). Pure function taking localFiles,
            // pdmMap, localPathSet, checkedOutByMeByHash, savedInodeMap, user and returning
            // { inodeRenameMap, inodeMatchedServerPaths, updatedLocalFiles }.
            // --- Rename detection: compute hashes for unmatched local files ---
            // When a file is renamed externally (e.g. SolidWorks tree rename), the new path
            // has no hash in cache. Without a hash, the existing move detection (below) can't
            // match the file to its server record by content_hash. We fix this by computing
            // hashes for unmatched local files when there are also missing checked-out-by-me
            // server files — a strong signal that an external rename occurred.
            if (checkedOutByMeByHash.size > 0 && window.electronAPI?.computeFileHashes) {
              const unmatchedLocalFiles = localFiles.filter(
                (f) => !f.isDirectory && !f.localHash && !pdmMap.has(f.relativePath.toLowerCase()),
              )

              const missingServerPaths = new Set<string>()
              for (const [, pdmFile] of checkedOutByMeByHash) {
                if (!localPathSet.has(pdmFile.file_path.toLowerCase())) {
                  missingServerPaths.add(pdmFile.file_path.toLowerCase())
                }
              }

              if (unmatchedLocalFiles.length > 0 && missingServerPaths.size > 0) {
                window.electronAPI?.log(
                  'info',
                  '[LoadFiles] Rename detection: computing hashes for unmatched local files',
                  {
                    unmatchedLocal: unmatchedLocalFiles.length,
                    missingServer: missingServerPaths.size,
                    unmatchedSamples: unmatchedLocalFiles.slice(0, 3).map((f) => f.relativePath),
                    missingSamples: Array.from(missingServerPaths).slice(0, 3),
                  },
                )

                const hashRequests = unmatchedLocalFiles.map((f) => ({
                  path: f.path,
                  relativePath: f.relativePath,
                  size: f.size,
                  mtime: new Date(f.modifiedTime).getTime(),
                }))

                try {
                  const { results } = await window.electronAPI.computeFileHashes(hashRequests)
                  if (results && results.length > 0) {
                    const hashMap = new Map(results.map((r) => [r.relativePath, r.hash]))
                    let renameMatchCount = 0
                    localFiles = localFiles.map((f) => {
                      const computed = hashMap.get(f.relativePath)
                      if (computed) {
                        if (checkedOutByMeByHash.has(computed)) renameMatchCount++
                        return { ...f, localHash: computed }
                      }
                      return f
                    })
                    window.electronAPI?.log(
                      'info',
                      '[LoadFiles] Rename detection: hashes computed',
                      {
                        hashesComputed: results.length,
                        renameMatchesFound: renameMatchCount,
                      },
                    )
                  }
                } catch (error) {
                  window.electronAPI?.log(
                    'warn',
                    '[LoadFiles] Rename detection: hash computation failed',
                    { error: String(error) },
                  )
                }
              }
            }

            // --- Inode-based rename detection ---
            // The NTFS file index (stats.ino) persists across renames on the same volume.
            // We use previously persisted inodes from the sync index to match "new" local
            // files to "missing" server files. This handles all rename scenarios including
            // modified-then-renamed files where hash matching fails.
            const inodeRenameMap = new Map<string, PDMFile>() // localPath(lower) -> pdmFile
            const inodeMatchedServerPaths = new Set<string>() // old server paths matched by inode

            if (savedInodeMap.size > 0) {
              // Build ino -> pdmFile map for server files that are missing locally.
              // savedInodeMap is Map<ino, paths[]> — try each candidate path against pdmMap
              // to handle stale duplicate entries from the old updateInodes upsert bug.
              //
              // Inode matches are NOT restricted to checked-out-by-me files. NTFS MFT indices
              // are per-machine and file-unique, making false positives extremely unlikely.
              // Restricting to checked-out files caused ghost/orphan pairs after a checkin
              // that updated the server path and released the checkout.
              const inodeToServerFile = new Map<number, PDMFile>()
              for (const [ino, oldRelativePaths] of savedInodeMap) {
                for (const oldRelativePath of oldRelativePaths) {
                  const pdmFile = pdmMap.get(oldRelativePath)
                  if (pdmFile && !localPathSet.has(oldRelativePath)) {
                    inodeToServerFile.set(ino, pdmFile)
                    break
                  }
                }
              }

              if (inodeToServerFile.size > 0) {
                // Check each unmatched local file for an inode match
                for (const localFile of localFiles) {
                  if (localFile.isDirectory || !localFile.ino || localFile.ino === 0) continue
                  if (pdmMap.has(localFile.relativePath.toLowerCase())) continue

                  const serverFile = inodeToServerFile.get(localFile.ino)
                  if (serverFile) {
                    inodeRenameMap.set(localFile.relativePath.toLowerCase(), serverFile)
                    inodeMatchedServerPaths.add(serverFile.file_path.toLowerCase())
                    inodeToServerFile.delete(localFile.ino)
                    const isCheckedOutByMe = user?.id
                      ? serverFile.checked_out_by === user.id
                      : !!serverFile.checked_out_by
                    window.electronAPI?.log('info', '[LoadFiles] Inode rename detected', {
                      oldPath: serverFile.file_path,
                      newPath: localFile.relativePath,
                      ino: localFile.ino,
                      method: 'inode',
                      checkedOutByMe: isCheckedOutByMe,
                    })
                  }
                }

                if (inodeRenameMap.size > 0) {
                  window.electronAPI?.log('info', '[LoadFiles] Inode rename summary', {
                    matches: inodeRenameMap.size,
                    remainingUnresolved: inodeToServerFile.size,
                  })
                }
              }
            }

            // TODO(decompose): Extract to hooks/useLoadFiles/mergeFilesWithServer.ts — the
            // local-server merge loop (~320 lines, through "MATCH STATS" log). Pure function
            // taking localFiles, pdmMap, existing*Maps, user, and returning merged localFiles
            // with pdmData, diffStatus, localVersion, and pendingMetadata applied.

            // Merge PDM data into local files and compute diff status
            let matchedCount = 0
            let unmatchedCount = 0
            const unmatchedSamples: string[] = []

            localFiles = localFiles.map((localFile) => {
              if (localFile.isDirectory) {
                // Check if this folder exists on server (from explicit folder records)
                const folderKey = localFile.relativePath.toLowerCase()
                const serverFolder = serverFoldersMap.get(folderKey)
                if (serverFolder) {
                  // Attach folder pdmData for synced folders
                  return {
                    ...localFile,
                    isSynced: true,
                    pdmData: { id: serverFolder.id, folder_path: serverFolder.folder_path } as any, // TODO: type this
                  }
                }
                return localFile
              }

              // Use lowercase for case-insensitive matching (Windows compatibility)
              const lookupKey = localFile.relativePath.toLowerCase()
              let pdmData = pdmMap.get(lookupKey)
              let isMovedFile = false

              // Debug: track match/unmatch counts
              if (pdmData) {
                matchedCount++
              } else {
                unmatchedCount++
                if (unmatchedSamples.length < 5) {
                  unmatchedSamples.push(lookupKey)
                }
              }

              // Preserve localActiveVersion from existing file (for rollback state)
              // Try both absolute path and relative path for robust lookup
              const existingLocalActiveVersion =
                existingLocalActiveVersions.get(localFile.path) ||
                existingLocalActiveVersions.get(localFile.relativePath)

              // Preserve localVersion from existing file (tracks actual version on disk)
              // The lowercase fallback matches the IndexedDB sync index key space, which is
              // the only seed available on cold start.
              const existingLocalVersion =
                existingLocalVersions.get(localFile.path) ||
                existingLocalVersions.get(localFile.relativePath) ||
                existingLocalVersions.get(localFile.relativePath.toLowerCase())

              // Debug: log when localActiveVersion is being preserved (helps diagnose rollback issues)
              if (existingLocalActiveVersion !== undefined) {
                window.electronAPI?.log('debug', '[LoadFiles] Preserving localActiveVersion', {
                  path: localFile.relativePath,
                  version: existingLocalActiveVersion,
                })
              }

              // Preserve localHash from existing file if not computed fresh
              // This prevents falling back to timestamp-based diff detection after file watcher refreshes
              // Try both full path (in-memory entries) and relativePath (IndexedDB entries) so a
              // persisted hash from a previous app session is always reachable.
              const existingLocalHash =
                existingLocalHashes.get(localFile.path) ||
                existingLocalHashes.get(localFile.relativePath) ||
                existingLocalHashes.get(localFile.relativePath.toLowerCase())
              const effectiveLocalHash = localFile.localHash || existingLocalHash

              // PRIMARY: Inode-based rename detection
              // The NTFS file index (ino) persists across renames. If we previously recorded
              // this file's inode at a different path, it was renamed/moved.
              if (!pdmData && inodeRenameMap.size > 0) {
                const inodeMatch = inodeRenameMap.get(localFile.relativePath.toLowerCase())
                if (inodeMatch) {
                  pdmData = inodeMatch
                  isMovedFile = true
                }
              }

              // FALLBACK: Hash-based move detection for cases where inode is unavailable
              // (e.g., first load after upgrade, network drives, ino=0)
              if (!pdmData && effectiveLocalHash) {
                const movedFromFile = checkedOutByMeByHash.get(effectiveLocalHash)
                if (movedFromFile) {
                  const originalPathStillExists = localPathSet.has(
                    movedFromFile.file_path.toLowerCase(),
                  )

                  if (!originalPathStillExists) {
                    pdmData = movedFromFile
                    isMovedFile = true
                  }
                }
              }

              // Determine diff status
              let diffStatus:
                | 'added'
                | 'modified'
                | 'outdated'
                | 'moved'
                | 'ignored'
                | 'deleted_remote'
                | undefined
              if (!pdmData) {
                // File exists locally but not on server
                // Check if it's in the ignore list (keep local only)
                if (isIgnoredPath(localFile.relativePath)) {
                  diffStatus = 'ignored'
                } else {
                  // Check if this file was previously synced (in sync index)
                  // If it was synced before but is no longer on server, it was deleted by another user
                  const wasPrevinouslySynced = localSyncIndex.has(
                    localFile.relativePath.toLowerCase(),
                  )
                  if (wasPrevinouslySynced) {
                    // File was synced before but no longer on server = orphaned (deleted_remote)
                    diffStatus = 'deleted_remote'
                    window.electronAPI?.log('debug', '[LoadFiles] Detected orphaned file', {
                      path: localFile.relativePath,
                      reason: 'in_sync_index_but_not_on_server',
                    })
                  } else {
                    // File was never synced = genuinely new (added)
                    diffStatus = 'added'
                  }
                }
              } else if (isMovedFile) {
                // File was moved - needs check-in to update server path (but no version increment)
                diffStatus = 'moved'
              } else if (pdmData.content_hash && effectiveLocalHash) {
                // Both hashes available - use hash comparison (most accurate)
                if (pdmData.content_hash === effectiveLocalHash) {
                  // Hashes match - file is synced, leave diffStatus undefined
                } else {
                  // Hashes differ - determine if local is newer or cloud is newer
                  const localModTime = new Date(localFile.modifiedTime).getTime()
                  const cloudUpdateTime = pdmData.updated_at
                    ? new Date(pdmData.updated_at).getTime()
                    : 0

                  if (localModTime > cloudUpdateTime) {
                    diffStatus = 'modified'
                  } else {
                    diffStatus = 'outdated'
                  }
                }
              } else if (pdmData.content_hash) {
                // No local hash available - use VERSION-BASED detection first, then TIMESTAMP fallback
                const localModTime = new Date(localFile.modifiedTime).getTime()
                const cloudUpdateTime = pdmData.updated_at
                  ? new Date(pdmData.updated_at).getTime()
                  : 0
                const isCheckedOutByMe = pdmData.checked_out_by === user?.id

                // PRIORITY 1: Use tracked localVersion for accurate outdated detection
                // This is set when files are downloaded, checked in, or rolled back
                if (existingLocalVersion !== undefined && pdmData.version !== undefined) {
                  if (existingLocalVersion < pdmData.version) {
                    // Server has a newer version - file is definitely outdated
                    diffStatus = 'outdated'
                  } else if (existingLocalVersion === pdmData.version) {
                    // Versions match - file should be synced
                    // But if checked out by me and local is newer, might be modified
                    if (isCheckedOutByMe && localModTime > cloudUpdateTime + 5000) {
                      diffStatus = 'modified'
                    }
                    // Otherwise: leave as synced (diffStatus undefined)
                  }
                  // If existingLocalVersion > pdmData.version: local has uncommitted changes (modified)
                  // This shouldn't normally happen, but leave status as-is
                } else {
                  // No localVersion available — do NOT use timestamp fallback for "outdated"
                  // since it produces mass false positives (e.g., files downloaded weeks ago
                  // whose server updated_at was bumped by unrelated checkout/checkin activity).
                  // Instead, trust that background hash computation will resolve the real status.
                  const MODIFIED_TOLERANCE_MS = 5000

                  if (isCheckedOutByMe && localModTime > cloudUpdateTime + MODIFIED_TOLERANCE_MS) {
                    diffStatus = 'modified'
                  }
                  // For non-checked-out files: leave as synced (undefined) and let
                  // background hash computation determine the accurate status.
                }
              }
              // The background hash computation will set the proper status once hashes are computed

              // Preserve pendingMetadata from existing file OR from persistedPendingMetadata (for app restart)
              // For moved files, also try looking up by the OLD path (stored in pdmData.file_path)
              // since pendingMetadata was stored under the old path before the rename
              const recoveredPending =
                existingPendingMetadata.get(localFile.path) ||
                persistedPendingMetadata[localFile.path] ||
                (isMovedFile && pdmData?.file_path
                  ? existingPendingByServerPath.get(pdmData.file_path.toLowerCase()) ||
                    persistedPendingMetadata[buildFullPath(loadingForVaultPath, pdmData.file_path)]
                  : undefined)

              // Compare against the server row: an edit the server already holds is not an edit,
              // and leaving it pending marks the file as needing check-in forever.
              const preservedPending = dropCommittedPendingMetadata(recoveredPending, pdmData)

              // Check if this file was recently modified locally (e.g., just saved to SW file + DB)
              // If so, preserve the existing pdmData to prevent server data from overwriting local changes
              // This handles the race condition between Save to File and FileWatcher triggering LoadFiles
              const recentlyModifiedData = recentlyModifiedPdmData.get(localFile.path)

              // Determine final pdmData:
              // 1. If file was recently modified locally, use preserved pdmData (highest priority)
              // 2. Otherwise use server pdmData as-is
              //
              // Pending values are deliberately NOT merged in here. Doing so re-created, on every
              // vault load, the same conflation updatePendingMetadata used to perform: the edit
              // read back as a value the server confirmed. Readers overlay pending over committed
              // at render time through src/lib/metadata/overlay.ts.
              let finalPdmData = pdmData

              if (recentlyModifiedData && pdmData) {
                // Recently modified - keep the local pdmData to prevent reversion
                finalPdmData = mergePdmFileData(recentlyModifiedData, {
                  checked_out_by: pdmData.checked_out_by,
                  checked_out_at: pdmData.checked_out_at,
                })
                window.electronAPI?.log(
                  'debug',
                  '[LoadFiles] SKIP merge for recently modified file',
                  {
                    path: localFile.path,
                    serverPartNumber: pdmData?.part_number,
                    preservedPartNumber: recentlyModifiedData.part_number,
                    reason: 'recently_modified',
                  },
                )
              }

              if (finalPdmData?.id) {
                const preservedUserInfo = existingCheckedOutUsers.get(finalPdmData.id)
                const profile = isCheckoutProfileForOwner(
                  preservedUserInfo,
                  finalPdmData.checked_out_by,
                )
                  ? preservedUserInfo
                  : finalPdmData.checked_out_user
                finalPdmData = reconcileCheckoutProfile(finalPdmData, profile)
              }

              // CRITICAL: Preserve 'modified' status for files with pending metadata changes
              // The hash comparison above may incorrectly set diffStatus to undefined because
              // the file content hasn't changed yet (user only edited UI fields).
              // But we know there ARE pending changes, so force 'modified' status.
              const finalDiffStatus =
                preservedPending && Object.keys(preservedPending).length > 0 && pdmData
                  ? ('modified' as const)
                  : diffStatus

              // When a file is detected as moved via inode/hash, mirror the BR number
              // (part_number) into pendingMetadata so it's preserved if a subsequent
              // reload fails to re-detect the move (e.g., inode data is lost).
              let finalPending = preservedPending
              if (isMovedFile && pdmData?.part_number && !preservedPending?.part_number) {
                finalPending = {
                  ...preservedPending,
                  part_number: pdmData.part_number,
                }
              }

              // Diagnostic logging for moved files to help debug BR number preservation issues
              if (isMovedFile) {
                window.electronAPI?.log('info', '[LoadFiles] Moved file metadata', {
                  oldPath: pdmData?.file_path,
                  newPath: localFile.relativePath,
                  pdmPartNumber: pdmData?.part_number ?? null,
                  preservedPartNumber: preservedPending?.part_number ?? null,
                  finalPartNumber: finalPending?.part_number ?? null,
                })
              }

              // Determine localVersion:
              // - If file is synced (hashes verifiably match), use server version
              // - If preserved from previous state and >= server version, keep it (prevents stale cache overwrite)
              // - Otherwise undefined (will be set when downloaded or checked in)
              //
              // CRITICAL: We must NOT stamp pdmData.version onto localVersion when there is no
              // disk evidence (no localHash AND no existingLocalVersion). Doing so makes the file
              // appear synced at the server's version forever, even though disk content may not
              // match. Instead, leave localVersion undefined and let the forced background hash
              // (see filesNeedingHash logic below) resolve the truth from disk.
              const isSyncedWithServer =
                pdmData &&
                !finalDiffStatus &&
                pdmData.content_hash &&
                effectiveLocalHash &&
                pdmData.content_hash === effectiveLocalHash
              const computedLocalVersion = isSyncedWithServer && pdmData
                ? existingLocalVersion !== undefined && existingLocalVersion >= pdmData.version
                  ? existingLocalVersion
                  : pdmData.version
                : existingLocalVersion

              return {
                ...localFile,
                pdmData: finalPdmData || undefined,
                isSynced: !!pdmData,
                diffStatus: finalDiffStatus,
                // Preserve rollback state if it exists
                localActiveVersion: existingLocalActiveVersion,
                // Track actual version on disk
                localVersion: computedLocalVersion,
                // Preserve localHash from existing file if not computed fresh
                localHash: effectiveLocalHash,
                // Preserve pendingMetadata so user's unsaved edits survive file refresh
                pendingMetadata: finalPending,
              }
            })

            // Debug: Log match statistics
            window.electronAPI?.log('info', '[LoadFiles] MATCH STATS', {
              matched: matchedCount,
              unmatched: unmatchedCount,
              serverTotal: pdmFiles.length,
              unmatchedSamples,
            })

            // TODO(decompose): Extract to hooks/useLoadFiles/cloudFileReconciliation.ts —
            // cloud-only file injection + ghost-orphan cross-referencing (~120 lines).
            // Pure function taking pdmFiles, localFiles, localPathSet, localContentHashes,
            // inodeMatchedServerPaths, user, vaultPath and returning updated localFiles array.

            // Add cloud-only files (exist on server but not locally) as "cloud" or "deleted" entries
            // "cloud" = available for download (muted)
            // "deleted" = was checked out by me but removed locally (red) - indicates moved/deleted file
            // Note: if a file was MOVED (same content hash exists locally), don't show the deleted ghost
            const cloudFolders = new Set<string>()

            // Create a set of local content hashes to detect moved files
            const localContentHashes = new Set(
              localFiles.filter((f) => !f.isDirectory && f.localHash).map((f) => f.localHash),
            )

            for (const pdmFile of pdmFiles) {
              if (!localPathSet.has(pdmFile.file_path.toLowerCase())) {
                // Check if this file was MOVED (same content exists at a different location locally)
                // or matched by inode-based rename detection
                const isCheckedOutByMe = pdmFile.checked_out_by === user?.id
                const wasMoved =
                  pdmFile.content_hash && localContentHashes.has(pdmFile.content_hash)
                const wasInodeRenamed = inodeMatchedServerPaths.has(pdmFile.file_path.toLowerCase())

                // If moved/renamed, don't show the ghost at the old location - the file is handled at the new location
                if (wasMoved || wasInodeRenamed) {
                  continue
                }

                // If checked out by me but not moved, it was truly deleted locally
                const isDeletedByMe = isCheckedOutByMe

                // Add cloud parent folders for this file
                const pathParts = pdmFile.file_path.split('/')
                let currentPath = ''
                for (let i = 0; i < pathParts.length - 1; i++) {
                  currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
                  if (
                    !localPathSet.has(currentPath.toLowerCase()) &&
                    !cloudFolders.has(currentPath)
                  ) {
                    cloudFolders.add(currentPath)
                  }
                }

                // Add the cloud-only file (not synced locally), retaining only
                // owner-matching profile enrichment.
                const preservedCloudUserInfo = existingCheckedOutUsers.get(pdmFile.id)
                const cloudPdmFile = pdmFile as unknown as PDMFile
                const cloudFilePdmData = reconcileCheckoutProfile(
                  cloudPdmFile,
                  isCheckoutProfileForOwner(preservedCloudUserInfo, cloudPdmFile.checked_out_by)
                    ? preservedCloudUserInfo
                    : cloudPdmFile.checked_out_user,
                )

                localFiles.push({
                  name: pdmFile.file_name,
                  path: buildFullPath(loadingForVaultPath, pdmFile.file_path),
                  relativePath: pdmFile.file_path,
                  isDirectory: false,
                  extension: pdmFile.extension,
                  size: pdmFile.file_size || 0,
                  modifiedTime: pdmFile.updated_at || '',
                  pdmData: cloudFilePdmData,
                  isSynced: false, // Not synced locally
                  diffStatus: isDeletedByMe ? 'deleted' : 'cloud', // Deleted if I moved/removed it, otherwise cloud
                })
              }
            }

            // --- Ghost-orphan cross-referencing (safety net) ---
            // If inode detection missed a rename, we may have a ghost (server file, no local)
            // AND an orphan (local file, no server match) in the same folder with the same extension.
            // Auto-match them to prevent the ghost/orphan pair from persisting.
            const ghostFiles = localFiles.filter(
              (f) => f.diffStatus === 'deleted' && f.pdmData && !f.isDirectory,
            )
            const orphanFiles = localFiles.filter(
              (f) => f.diffStatus === 'deleted_remote' && !f.isDirectory,
            )

            if (ghostFiles.length > 0 && orphanFiles.length > 0) {
              const orphansByFolderExt = new Map<string, (typeof localFiles)[number][]>()
              for (const orphan of orphanFiles) {
                const folder = orphan.relativePath
                  .substring(0, orphan.relativePath.lastIndexOf('/'))
                  .toLowerCase()
                const ext = (orphan.extension || '').toLowerCase()
                const key = `${folder}|${ext}`
                const list = orphansByFolderExt.get(key) || []
                list.push(orphan)
                orphansByFolderExt.set(key, list)
              }

              for (const ghost of ghostFiles) {
                const folder = ghost.relativePath
                  .substring(0, ghost.relativePath.lastIndexOf('/'))
                  .toLowerCase()
                const ext = (ghost.extension || '').toLowerCase()
                const candidates = orphansByFolderExt.get(`${folder}|${ext}`)
                if (candidates && candidates.length === 1) {
                  const orphan = candidates[0]
                  window.electronAPI?.log(
                    'info',
                    '[LoadFiles] Ghost-orphan cross-reference match',
                    {
                      ghostPath: ghost.relativePath,
                      orphanPath: orphan.relativePath,
                    },
                  )
                  orphan.pdmData = ghost.pdmData
                  orphan.diffStatus = 'moved'
                  orphan.isSynced = true
                  ghost.diffStatus = 'cloud'
                  ghost.pdmData = { ...ghost.pdmData, _suppressedByOrphanMatch: true } as any // TODO: type this
                  candidates.length = 0
                }
              }

              localFiles = localFiles.filter((f) => !(f.pdmData as any)?._suppressedByOrphanMatch) // TODO: type this
            }

            // Auto-create server folders locally (folders that exist on server but not locally)
            // Since folders sync immediately, we should also auto-create them on the receiving end
            // This is instant (just mkdir operations) - no content to download
            const addedCloudFolderPaths = new Set<string>()
            const foldersToCreate: Array<{
              path: string
              fullPath: string
              folderPath: string
              serverFolder?: any
            }> = []

            // Collect implicit cloud folders (from file paths)
            for (const folderPath of cloudFolders) {
              const fullPath = buildFullPath(loadingForVaultPath, folderPath)
              const serverFolder = serverFoldersMap.get(folderPath.toLowerCase())
              addedCloudFolderPaths.add(folderPath.toLowerCase())
              foldersToCreate.push({ path: folderPath, fullPath, folderPath, serverFolder })
            }

            // Collect explicit server folders that aren't already added
            for (const serverFolder of serverFoldersResult.folders || []) {
              const folderPathLower = serverFolder.folder_path.toLowerCase()
              if (addedCloudFolderPaths.has(folderPathLower) || localPathSet.has(folderPathLower)) {
                continue
              }
              const fullPath = buildFullPath(loadingForVaultPath, serverFolder.folder_path)
              foldersToCreate.push({
                path: serverFolder.folder_path,
                fullPath,
                folderPath: serverFolder.folder_path,
                serverFolder,
              })
            }

            // Create all folders locally in parallel (fast - just mkdir operations)
            if (foldersToCreate.length > 0 && window.electronAPI) {
              window.electronAPI.log('info', '[LoadFiles] Auto-creating server folders locally', {
                count: foldersToCreate.length,
              })

              // Create folders in parallel - this is very fast (sub-ms per folder)
              await Promise.all(
                foldersToCreate.map(async ({ fullPath }) => {
                  try {
                    await window.electronAPI?.createFolder(fullPath)
                  } catch (error) {
                    // Folder might already exist or creation failed - that's okay
                    window.electronAPI?.log('debug', '[LoadFiles] Folder creation skipped/failed', {
                      fullPath,
                      error: error instanceof Error ? error.message : String(error),
                    })
                  }
                }),
              )
            }

            // Add all server folders to localFiles as synced (they now exist locally)
            for (const { path: folderPath, fullPath, serverFolder } of foldersToCreate) {
              const folderName = folderPath.split('/').pop() || folderPath
              localFiles.push({
                name: folderName,
                path: fullPath,
                relativePath: folderPath,
                isDirectory: true,
                extension: '',
                size: 0,
                modifiedTime: serverFolder?.created_at || '',
                diffStatus: undefined, // Not cloud anymore - they exist locally now
                isSynced: true,
                pdmData: serverFolder
                  ? ({ id: serverFolder.id, folder_path: serverFolder.folder_path } as any) // TODO: type this
                  : undefined,
              })
            }

            // Debug: Log merge summary
            const syncedCount = localFiles.filter((f) => !f.isDirectory && f.isSynced).length
            const addedCount = localFiles.filter(
              (f) => !f.isDirectory && f.diffStatus === 'added',
            ).length
            const cloudCount = localFiles.filter(
              (f) => !f.isDirectory && f.diffStatus === 'cloud',
            ).length
            const orphanedCount = localFiles.filter(
              (f) => !f.isDirectory && f.diffStatus === 'deleted_remote',
            ).length
            const deletedCount = localFiles.filter(
              (f) => !f.isDirectory && f.diffStatus === 'deleted',
            ).length
            window.electronAPI?.log('info', '[LoadFiles] Merge summary', {
              serverFiles: pdmFiles.length,
              localFilesAfterMerge: localFiles.filter((f) => !f.isDirectory).length,
              synced: syncedCount,
              added: addedCount,
              cloudOnly: cloudCount,
              orphaned: orphanedCount,
              ghostFiles: deletedCount,
            })

            // Update the local sync index with all server file paths
            // This ensures we track which files have been synced for orphan detection
            if (currentVaultId) {
              const serverPaths = pdmFiles.map((file) => file.file_path)

              // Persist inodes (and localVersion/localHash) for all matched local files
              // so the next load can use inodes for rename detection and version/hash
              // for accurate outdated status on app restart
              const inodeEntries: Array<{
                path: string
                ino: number
                localVersion?: number
                localHash?: string
              }> = []
              for (const f of localFiles) {
                if (!f.isDirectory && f.ino && f.ino > 0 && f.pdmData) {
                  inodeEntries.push({
                    path: f.relativePath,
                    ino: f.ino,
                    localVersion: f.localVersion,
                    localHash: f.localHash,
                  })
                  if (
                    f.diffStatus === 'moved' &&
                    f.pdmData.file_path &&
                    f.pdmData.file_path.toLowerCase() !== f.relativePath.toLowerCase()
                  ) {
                    inodeEntries.push({ path: f.pdmData.file_path, ino: f.ino })
                  }
                }
              }

              // Chain: create sync index entries first, THEN stamp inodes/versions onto them.
              // updateInodes now upserts (creates entries if missing), but running after
              // updateSyncIndexFromServer ensures we don't create entries that should be pruned.
              updateSyncIndexFromServer(currentVaultId, serverPaths)
                .then((): Promise<void> | void => {
                  if (inodeEntries.length > 0) {
                    return updateInodes(currentVaultId, inodeEntries)
                  }
                })
                .catch((error) => {
                  window.electronAPI?.log(
                    'warn',
                    '[LoadFiles] Failed to update sync index or inodes',
                    { error: String(error) },
                  )
                })
            }
          }
        } else {
          // Offline mode or no org - local files are "added" unless ignored
          localFiles = localFiles.map((f) => ({
            ...f,
            diffStatus: f.isDirectory
              ? undefined
              : isIgnoredPath(f.relativePath)
                ? ('ignored' as const)
                : ('added' as const),
          }))
        }

        // Update folder diffStatus based on contents
        // A folder should be 'cloud' if all its contents are cloud-only AND it has some cloud content
        // Empty folders that exist locally should NOT be marked as cloud
        // Process folders bottom-up (deepest first) so parent folders see updated child statuses

        // OPTIMIZATION: Build parent->children index in O(n) instead of O(n²) filtering
        // This reduces 25,000 files × 2,500 folders = 62.5M ops down to ~27,500 ops
        const childrenByParent = new Map<string, typeof localFiles>()
        for (const file of localFiles) {
          const normalizedPath = file.relativePath.replace(/\\/g, '/')
          const lastSlash = normalizedPath.lastIndexOf('/')
          const parentPath = lastSlash > 0 ? normalizedPath.substring(0, lastSlash) : ''

          const existing = childrenByParent.get(parentPath)
          if (existing) {
            existing.push(file)
          } else {
            childrenByParent.set(parentPath, [file])
          }
        }

        const folders = localFiles.filter((f) => f.isDirectory)

        // Sort folders by depth (deepest first)
        folders.sort((a, b) => {
          const depthA = a.relativePath.split(/[/\\]/).length
          const depthB = b.relativePath.split(/[/\\]/).length
          return depthB - depthA
        })

        // Check each folder from deepest to shallowest - now O(1) lookup per folder
        for (const folder of folders) {
          const normalizedFolder = folder.relativePath.replace(/\\/g, '/')

          // O(1) lookup instead of O(n) filter
          const directChildren = childrenByParent.get(normalizedFolder) || []

          const hasLocalContent = directChildren.some((f) => f.diffStatus !== 'cloud')
          const hasCloudContent = directChildren.some((f) => f.diffStatus === 'cloud')

          // Only mark as cloud if folder has cloud content AND no local content
          // Empty local folders should stay as normal folders
          if (!hasLocalContent && hasCloudContent) {
            folder.diffStatus = 'cloud'
          }
        }

        // Record merge timing
        const mergeDuration = performance.now() - mergeStart
        recordMetric('VaultLoad', 'Merge complete', { durationMs: Math.round(mergeDuration) })

        // Check if vault changed during async operations - if so, skip setting files
        // This prevents race conditions when auto-connect switches vaults during initial load
        if (isVaultStale()) {
          window.electronAPI?.log(
            'info',
            '[LoadFiles] Skipping setFiles - vault changed during load',
            {
              loadedFor: loadingForVaultId,
              currentVault: usePDMStore.getState().activeVaultId,
            },
          )
          return
        }

        // Record total vault load time
        const vaultLoadDuration = performance.now() - vaultLoadStart
        recordMetric('VaultLoad', 'Total vault load complete', {
          durationMs: Math.round(vaultLoadDuration),
          fileCount: localFiles.filter((f: { isDirectory: boolean }) => !f.isDirectory).length,
          folderCount: localFiles.filter((f: { isDirectory: boolean }) => f.isDirectory).length,
        })

        // Detect externally deleted synced files and add auto-download exclusions
        // This prevents auto-download from re-downloading files the user deleted via Windows Explorer
        // Detection: files that had local copies but now show as cloud-only
        if (currentVaultId) {
          const previousFiles = usePDMStore.getState().files

          // Only run detection if we have previous state (skip on first load)
          if (previousFiles.length > 0) {
            const { addAutoDownloadExclusion } = usePDMStore.getState()

            // Build set of paths that previously had local copies (synced files with local presence)
            const previousLocalSyncedPaths = new Set(
              previousFiles
                .filter((f) => !f.isDirectory && f.pdmData?.id && f.diffStatus !== 'cloud')
                .map((f) => f.relativePath),
            )

            // Build set of folder paths that previously had local presence
            const previousLocalFolderPaths = new Set(
              previousFiles
                .filter((f) => f.isDirectory && f.diffStatus !== 'cloud')
                .map((f) => f.relativePath.toLowerCase()),
            )

            // Find files that transitioned from local to cloud-only (externally deleted)
            const externallyDeletedFiles = localFiles.filter(
              (f) =>
                !f.isDirectory &&
                f.diffStatus === 'cloud' &&
                f.pdmData?.id &&
                previousLocalSyncedPaths.has(f.relativePath),
            )

            // Find folders that transitioned from local to cloud-only (externally deleted)
            const externallyDeletedFolders = localFiles.filter(
              (f) =>
                f.isDirectory &&
                f.diffStatus === 'cloud' &&
                previousLocalFolderPaths.has(f.relativePath.toLowerCase()),
            )

            // Collect all files to exclude (directly deleted + files in deleted folders)
            const filesToExclude = new Set<string>()

            // Add directly deleted files
            for (const file of externallyDeletedFiles) {
              filesToExclude.add(file.relativePath)
            }

            // Add files within deleted folders
            for (const folder of externallyDeletedFolders) {
              const folderPrefix = folder.relativePath.toLowerCase() + '/'
              for (const file of localFiles) {
                if (
                  !file.isDirectory &&
                  file.diffStatus === 'cloud' &&
                  file.relativePath.toLowerCase().startsWith(folderPrefix)
                ) {
                  filesToExclude.add(file.relativePath)
                }
              }
            }

            // Add exclusions for all externally deleted files
            if (filesToExclude.size > 0) {
              for (const relativePath of filesToExclude) {
                addAutoDownloadExclusion(currentVaultId, relativePath)
              }

              window.electronAPI?.log(
                'info',
                '[LoadFiles] Added auto-download exclusions for externally deleted files',
                {
                  fileCount: externallyDeletedFiles.length,
                  folderCount: externallyDeletedFolders.length,
                  totalExcluded: filesToExclude.size,
                  paths: Array.from(filesToExclude).slice(0, 10), // Log first 10 paths
                  truncated: filesToExclude.size > 10,
                },
              )
            }
          }
        }

        // A file operation landed after the scan read the disk, so the local half of
        // this merge describes the vault before the operation while the server half
        // describes it after. Committing would revert the operation in the UI and
        // strand its files, so drop the merge and rerun over a fresh full scan.
        if (getFileMutationEpoch() !== epochAtScanStart) {
          window.electronAPI?.log(
            'info',
            '[LoadFiles] Discarding merge - file ops landed mid-scan',
            {
              epochAtScanStart,
              epochNow: getFileMutationEpoch(),
              silent,
            },
          )
          recordMetric('VaultLoad', 'Discarded merge superseded by file ops', { silent })
          markLoadSuperseded(loadingForVaultId)
          return
        }

        setFiles(localFiles)
        setFilesLoaded(true) // Mark that initial load is complete
        committedMerge = true

        // Only recorded once the merge actually committed, so a failed or aborted
        // pass can never make the next one skip.
        setLastMergedState(loadingForVaultId, {
          scanFingerprint: localScanFingerprint,
          storeFileCount: localFiles.length,
        })
        const totalFiles = localFiles.filter((f) => !f.isDirectory).length
        const syncedCount = localFiles.filter((f) => !f.isDirectory && f.pdmData).length
        const folderCount = localFiles.filter((f) => f.isDirectory).length
        setStatusMessage(
          `Loaded ${totalFiles} files, ${folderCount} folders${syncedCount > 0 ? ` (${syncedCount} synced)` : ''}`,
        )

        // TODO(decompose): Extract to hooks/useLoadFiles/backgroundTasks.ts — all post-render
        // background work (~400 lines): user info lazy-load, hash computation, auto-download
        // of cloud files, auto-download of updates. Takes isVaultStale, localFiles,
        // organization, user, and store actions. Auto-discard deliberately does not belong
        // here: it mutates the filesystem and so has to stay inside the exclusive load.

        // Background tasks (non-blocking) - run after UI renders
        if (user && window.electronAPI) {
          setTimeout(async () => {
            // Skip background tasks if vault changed
            if (isVaultStale()) {
              window.electronAPI?.log(
                'info',
                '[LoadFiles] Skipping background tasks - vault changed',
              )
              return
            }

            // NOTE: We no longer set read-only status on startup.
            // Read-only is managed at checkout/checkin time only:
            // - Checkout: sets writable
            // - Checkin/Download/GetLatest: sets read-only
            // The file system preserves these attributes between sessions.

            // 1. Lazy-load checked out user info for UI display (non-blocking)
            // This adds user names/emails to the UI without blocking initial render
            const userInfoStart = performance.now()
            const checkedOutFileIds = localFiles
              .filter((f) => !f.isDirectory && f.pdmData?.checked_out_by)
              .map((f) => f.pdmData?.id)
              .filter((fileId): fileId is string => Boolean(fileId))

            const hydrationOwners = new Map<string, string>()
            for (const file of localFiles) {
              if (!file.isDirectory && file.pdmData?.id && file.pdmData.checked_out_by) {
                hydrationOwners.set(file.pdmData.id, file.pdmData.checked_out_by)
              }
            }

            if (checkedOutFileIds.length > 0 && organization && loadingForVaultId) {
              const uniqueFileIds = [...new Set(checkedOutFileIds)]
              const hydrationAction = usePDMStore.getState()
              for (const fileId of uniqueFileIds) {
                const ownerId = hydrationOwners.get(fileId)
                if (!ownerId) continue
                hydrationAction.setCheckoutHydrationStatus(fileId, {
                  ownerId,
                  state: 'pending',
                  attempt: 0,
                  lastError: null,
                  requestId: loadContext.requestId,
                  updatedAt: Date.now(),
                })
              }

              const scope: CheckoutProfileScope = {
                orgId: organization.id,
                vaultId: loadingForVaultId,
              }
              const profileResult = await fetchCheckoutProfilesWithRetry(
                uniqueFileIds,
                scope,
                loadContext.requestId,
                isLoadContextCurrent,
              )

              if (!isLoadContextCurrent()) {
                log.info('[CheckoutHydration]', 'Discarding stale profile response', {
                  requestId: loadContext.requestId,
                  orgId: hashCheckoutIdentifier(scope.orgId),
                  vaultId: hashCheckoutIdentifier(scope.vaultId),
                  responseCount: Object.keys(profileResult.users).length,
                  stale: true,
                })
                return
              }

              const usersFound = Object.keys(profileResult.users).length
              const updateStart = performance.now()
              hydrationAction.applyCheckoutUserProfiles(profileResult.users)

              for (const fileId of uniqueFileIds) {
                const ownerId = hydrationOwners.get(fileId)
                if (!ownerId) continue
                const profile = profileResult.users[fileId]
                if (profile && isCheckoutProfileForOwner(profile, ownerId)) {
                  hydrationAction.clearCheckoutHydrationStatus(fileId)
                } else {
                  hydrationAction.setCheckoutHydrationStatus(fileId, {
                    ownerId,
                    state: 'error',
                    attempt: profileResult.attempts,
                    lastError: profileResult.error
                      ? getErrorMessage(profileResult.error)
                      : 'profile_not_found',
                    requestId: loadContext.requestId,
                    updatedAt: Date.now(),
                  })
                }
              }

              // This call is queued after the base cache write, and the context is
              // checked again inside the IndexedDB transaction.
              void updateCachedUserInfo(
                organization.id,
                loadingForVaultId,
                profileResult.users,
                cacheContext,
              )

              recordMetric('VaultLoad', 'User info update complete', {
                durationMs: Math.round(performance.now() - updateStart),
                fetchMs: Math.round(performance.now() - userInfoStart),
                usersFound,
              })
            }
            recordMetric('VaultLoad', 'User info task complete', {
              durationMs: Math.round(performance.now() - userInfoStart),
              checkedOutFiles: checkedOutFileIds.length,
            })

            // 2. Background hash computation - SKIPPED on startup for performance
            // We now use timestamp-based diff detection which is instant.
            // Hashes are computed on-demand at checkin time when accuracy is critical.
            // This saves ~27 seconds on vaults with 25k+ files.
            // When forceHashComputation=true (Full Refresh), compute ALL synced files for accurate sync status.
            //
            // EXCEPTION: even when skipHashComputation=true, we MUST hash "first-sight" files —
            // ones that have a server content_hash but neither a localHash nor a localVersion.
            // The merge has no disk evidence for these, so without a real hash we'd either
            // mis-classify them as synced or have to make up a localVersion (the latter is
            // exactly the bug that caused users to see "v2/v2" while disk content was older).
            // The set is bounded to files we've truly never observed, so cost stays small in
            // steady state.
            const skipHashComputation = !forceHashComputation

            const hashTaskStart = performance.now()
            // When forceHashComputation, compute hashes for ALL files with server content_hash (even if local hash exists)
            // Otherwise, only compute for files without local hash
            const filesNeedingHash = skipHashComputation
              ? localFiles.filter(
                  (f) =>
                    !f.isDirectory &&
                    f.pdmData?.content_hash &&
                    !f.localHash &&
                    f.localVersion === undefined,
                )
              : localFiles.filter(
                  (f) =>
                    !f.isDirectory &&
                    f.pdmData?.content_hash &&
                    (forceHashComputation || !f.localHash),
                )

            recordMetric('VaultLoad', 'Hash computation starting', {
              filesNeedingHash: filesNeedingHash.length,
              totalFiles: localFiles.filter((f) => !f.isDirectory).length,
              skipped: skipHashComputation,
            })

            if (filesNeedingHash.length > 0 && window.electronAPI.computeFileHashes) {
              window.electronAPI?.log('info', '[LoadFiles] Computing hashes for', {
                count: filesNeedingHash.length,
                forceHashComputation,
              })
              setStatusMessage(
                forceHashComputation
                  ? `Full refresh: Computing hashes (0/${filesNeedingHash.length})...`
                  : `Checking ${filesNeedingHash.length} files for changes...`,
              )

              // Prepare file list for hash computation
              const hashRequests = filesNeedingHash.map((f) => ({
                path: f.path,
                relativePath: f.relativePath,
                size: f.size,
                mtime: new Date(f.modifiedTime).getTime(),
              }))

              try {
                // Compute hashes in background (with progress updates via IPC)
                const hashComputeStart = performance.now()
                const { results } = await window.electronAPI.computeFileHashes(hashRequests)
                const hashComputeDuration = performance.now() - hashComputeStart

                recordMetric('VaultLoad', 'Hash IPC complete', {
                  durationMs: Math.round(hashComputeDuration),
                  filesHashed: results?.length || 0,
                })

                if (results && results.length > 0 && !isVaultStale()) {
                  // Create a map for quick lookup
                  const hashMap = new Map(results.map((r) => [r.relativePath, r.hash]))

                  // Update files with computed hashes and recompute diff status
                  const updateStart = performance.now()
                  const currentFiles = usePDMStore.getState().files
                  const updatedFiles = currentFiles.map((f) => {
                    if (f.isDirectory) return f

                    const computedHash = hashMap.get(f.relativePath)
                    if (!computedHash) return f

                    // Recompute diff status with the new hash
                    let newDiffStatus = f.diffStatus
                    let newLocalVersion = f.localVersion
                    if (f.pdmData?.content_hash && computedHash) {
                      if (f.pdmData.content_hash !== computedHash) {
                        // Hashes differ - check which is newer
                        const localModTime = new Date(f.modifiedTime).getTime()
                        const cloudUpdateTime = f.pdmData.updated_at
                          ? new Date(f.pdmData.updated_at).getTime()
                          : 0
                        newDiffStatus = localModTime > cloudUpdateTime ? 'modified' : 'outdated'
                        // Debug: log hash mismatches to help identify stale data issues
                        window.electronAPI?.log('warn', '[HashCompute] Hash mismatch detected', {
                          file: f.name,
                          localHash: computedHash.substring(0, 12),
                          serverHash: f.pdmData.content_hash.substring(0, 12),
                          localModTime: new Date(localModTime).toISOString(),
                          serverUpdatedAt: f.pdmData.updated_at,
                          result: newDiffStatus,
                          checkedOut: !!f.pdmData.checked_out_by,
                        })
                      } else {
                        // Hashes match - file is synced with server version
                        newDiffStatus = undefined
                        newLocalVersion = f.pdmData.version
                      }
                    }

                    return {
                      ...f,
                      localHash: computedHash,
                      diffStatus: newDiffStatus,
                      localVersion: newLocalVersion,
                    }
                  })
                  const updateDuration = performance.now() - updateStart

                  // Use startTransition for non-blocking UI updates during background hash computation
                  // This prevents UI jank when updating many files' hash status
                  startTransition(() => {
                    setFiles(updatedFiles)
                  })

                  recordMetric('VaultLoad', 'Hash update complete', {
                    durationMs: Math.round(updateDuration),
                    filesUpdated: results.length,
                  })
                  window.electronAPI?.log('info', '[LoadFiles] Hash computation complete', {
                    updated: results.length,
                  })
                }
              } catch (error) {
                window.electronAPI?.log('error', '[LoadFiles] Hash computation failed', {
                  error: String(error),
                })
              }

              // Clear the status message after hash computation
              setStatusMessage('')

              recordMetric('VaultLoad', 'Hash task complete', {
                durationMs: Math.round(performance.now() - hashTaskStart),
                filesProcessed: filesNeedingHash.length,
              })
            }

            // 3. Auto-download cloud files and updates (if enabled)
            // Run after hash computation so we have accurate diff statuses
            // IMPORTANT: Skip on silent refreshes to prevent infinite loops
            // (silent refreshes are triggered by download/update commands completing)
            if (silent) {
              window.electronAPI?.log('info', '[AutoDownload] Skipping - silent refresh')
            }

            const {
              autoDownloadCloudFiles,
              autoDownloadUpdates,
              addToast,
              autoDownloadExcludedFiles,
              activeVaultId,
            } = usePDMStore.getState()

            // Skip auto-download if vault changed during async operations
            if (isVaultStale()) {
              window.electronAPI?.log('info', '[AutoDownload] Skipping - vault changed during load')
              return
            }

            // Log auto-download settings state for debugging
            window.electronAPI?.log('info', '[AutoDownload] Settings check', {
              autoDownloadCloudFiles,
              autoDownloadUpdates,
              silent,
              hasOrg: !!organization,
              isOfflineMode,
            })

            if (
              !silent &&
              (autoDownloadCloudFiles || autoDownloadUpdates) &&
              organization &&
              !isOfflineMode
            ) {
              const latestFiles = usePDMStore.getState().files

              // Get exclusion list for current vault
              const excludedPaths = activeVaultId
                ? autoDownloadExcludedFiles[activeVaultId] || []
                : []
              const excludedPathsSet = new Set(excludedPaths)

              // Auto-download cloud-only files and folders
              if (autoDownloadCloudFiles) {
                // Get cloud-only files (not in excluded paths)
                const cloudOnlyFiles = latestFiles.filter(
                  (f) =>
                    !f.isDirectory &&
                    f.diffStatus === 'cloud' &&
                    f.pdmData?.content_hash &&
                    // Exclude files that were intentionally removed locally
                    !excludedPathsSet.has(f.relativePath),
                )

                // Get cloud-only folders (will download all their contents)
                const cloudOnlyFolders = latestFiles.filter(
                  (f) =>
                    f.isDirectory &&
                    f.diffStatus === 'cloud' &&
                    // Exclude folders that were intentionally removed locally
                    !excludedPathsSet.has(f.relativePath),
                )

                // Combine files and folders for download
                const itemsToDownload = [...cloudOnlyFiles, ...cloudOnlyFolders]

                if (itemsToDownload.length > 0) {
                  const fileCount = cloudOnlyFiles.length
                  const folderCount = cloudOnlyFolders.length
                  window.electronAPI?.log('info', '[AutoDownload] Downloading cloud items', {
                    files: fileCount,
                    folders: folderCount,
                  })
                  try {
                    // Don't pass onRefresh - we already skipped auto-download on silent refreshes,
                    // and the download command will update the store. User can manually refresh if needed.
                    const result = await executeCommand('download', { files: itemsToDownload })
                    if (result.succeeded > 0) {
                      const message =
                        folderCount > 0
                          ? `Auto-downloaded ${result.succeeded} cloud file${result.succeeded > 1 ? 's' : ''} (${folderCount} folder${folderCount > 1 ? 's' : ''})`
                          : `Auto-downloaded ${result.succeeded} cloud file${result.succeeded > 1 ? 's' : ''}`
                      addToast('success', message)
                    }
                    if (result.failed > 0) {
                      window.electronAPI?.log('warn', '[AutoDownload] Some downloads failed', {
                        failed: result.failed,
                        errors: result.errors,
                      })
                    }
                  } catch (error) {
                    window.electronAPI?.log(
                      'error',
                      '[AutoDownload] Failed to download cloud files',
                      { error: String(error) },
                    )
                  }
                }
              }

              // Auto-download updates for outdated files
              if (autoDownloadUpdates) {
                // Debug: Log all files with outdated status before filtering
                const allOutdatedStatus = latestFiles.filter((f) => f.diffStatus === 'outdated')
                window.electronAPI?.log('debug', '[AutoDownload] Files with outdated status', {
                  count: allOutdatedStatus.length,
                  files: allOutdatedStatus.map((f) => ({
                    name: f.name,
                    relativePath: f.relativePath,
                    isDirectory: f.isDirectory,
                    hasContentHash: !!f.pdmData?.content_hash,
                    contentHash: f.pdmData?.content_hash?.substring(0, 12),
                    localHash: f.localHash?.substring(0, 12),
                    fileId: f.pdmData?.id,
                    checkedOutBy: f.pdmData?.checked_out_by,
                  })),
                })

                const outdatedFiles = latestFiles.filter(
                  (f) => !f.isDirectory && f.diffStatus === 'outdated' && f.pdmData?.content_hash,
                )

                // Debug: Log files that were filtered out
                const filteredOut = allOutdatedStatus.filter(
                  (f) => f.isDirectory || !f.pdmData?.content_hash,
                )
                if (filteredOut.length > 0) {
                  window.electronAPI?.log(
                    'warn',
                    '[AutoDownload] Outdated files FILTERED OUT (no content_hash or is directory)',
                    {
                      count: filteredOut.length,
                      files: filteredOut.map((f) => ({
                        name: f.name,
                        isDirectory: f.isDirectory,
                        hasContentHash: !!f.pdmData?.content_hash,
                      })),
                    },
                  )
                }

                if (outdatedFiles.length > 0) {
                  window.electronAPI?.log('info', '[AutoDownload] Updating outdated files', {
                    count: outdatedFiles.length,
                    files: outdatedFiles.map((f) => ({
                      name: f.name,
                      relativePath: f.relativePath,
                      localHash: f.localHash?.substring(0, 12),
                      serverHash: f.pdmData?.content_hash?.substring(0, 12),
                      fileId: f.pdmData?.id,
                    })),
                  })
                  try {
                    // Don't pass onRefresh - same reason as above
                    const result = await executeCommand('get-latest', { files: outdatedFiles })
                    window.electronAPI?.log('info', '[AutoDownload] Update result', {
                      total: result.total,
                      succeeded: result.succeeded,
                      failed: result.failed,
                      errors: result.errors,
                    })
                    if (result.succeeded > 0) {
                      addToast(
                        'success',
                        `Auto-updated ${result.succeeded} file${result.succeeded > 1 ? 's' : ''}`,
                      )
                    }
                    if (result.failed > 0) {
                      window.electronAPI?.log('warn', '[AutoDownload] Some updates failed', {
                        failed: result.failed,
                        errors: result.errors,
                      })
                    }
                  } catch (error) {
                    window.electronAPI?.log(
                      'error',
                      '[AutoDownload] Failed to update outdated files',
                      { error: String(error) },
                    )
                  }
                }
              }
            }
          }, 50) // Small delay to let React render first
        }
      } catch (error) {
        if (!silent) {
          setStatusMessage('Error loading files')
        }
        window.electronAPI?.log?.('error', '[LoadFiles] Error loading files', {
          error: String(error),
        })
      } finally {
        if (!silent) {
          setIsLoading(false)
          setTimeout(() => setStatusMessage(''), 3000)
        }
      }

      // Auto-discard orphaned files: local files that were previously synced but
      // are no longer on the server, because another user deleted them. They carry
      // diffStatus 'deleted_remote'.
      //
      // Awaited here rather than in the fire-and-forget block above so that it runs
      // inside runExclusiveLoad. Discarding deletes from disk and bumps the file
      // mutation epoch; run without the lock held it landed mid-scan of whichever
      // pass started next, and that pass then correctly refused to commit its merge
      // and reran a full scan. Holding the lock means a queued pass does not begin
      // scanning until the deletion is done.
      //
      // Every abort path above returns out of the try, so only a committed merge
      // reaches this. Silent refreshes never discard, which stops a watcher-driven
      // refresh from chaining into another one.
      if (committedMerge && !silent && user && window.electronAPI && !isVaultStale()) {
        const { autoDiscardOrphanedFiles, addToast, files: latestFiles } = usePDMStore.getState()

        const orphanedFiles = autoDiscardOrphanedFiles
          ? latestFiles.filter((f) => !f.isDirectory && f.diffStatus === 'deleted_remote')
          : []

        if (orphanedFiles.length > 0) {
          window.electronAPI.log('info', '[AutoDiscard] Discarding orphaned files', {
            count: orphanedFiles.length,
            files: orphanedFiles.map((f) => ({
              name: f.name,
              relativePath: f.relativePath,
            })),
          })

          try {
            const result = await executeCommand('discard-orphaned', { files: orphanedFiles })
            if (result.succeeded > 0) {
              addToast(
                'info',
                `Auto-discarded ${result.succeeded} orphaned file${result.succeeded > 1 ? 's' : ''}`,
              )
            }
            if (result.failed > 0) {
              window.electronAPI?.log('warn', '[AutoDiscard] Some files failed to discard', {
                failed: result.failed,
                errors: result.errors,
              })
            }
          } catch (error) {
            // Swallowed: a failed discard must not reject the load promise, which
            // would surface as a failed refresh to every caller.
            window.electronAPI?.log('error', '[AutoDiscard] Failed to discard orphaned files', {
              error: String(error),
            })
          }
        }
      }
    },
    [
      vaultPath,
      organization,
      isOfflineMode,
      currentVaultId,
      user,
      authenticatedUserId,
      sessionGeneration,
      setFiles,
      setServerFiles,
      setServerFolderPaths,
      setIsLoading,
      setStatusMessage,
      setFilesLoaded,
    ],
  )

  /** Serialized entry point for loadFiles. See runExclusiveLoad for the rationale. */
  const loadFiles = useCallback(
    async (
      silent: boolean = false,
      forceHashComputation: boolean = false,
      changedRelativePaths?: string[],
    ) => {
      await runExclusiveLoad(
        currentVaultId,
        {
          silent,
          forceHashComputation,
          hasChangedPaths: (changedRelativePaths?.length ?? 0) > 0,
        },
        () => runLoadFiles(silent, forceHashComputation, changedRelativePaths),
      )

      // The pass refused to commit because a file operation raced it. Rerun now that
      // the operation has landed, over a full scan: the delta scan's cached entries
      // still hold the pre-operation paths. Only one retry, so a burst of operations
      // cannot spin here.
      if (!consumeSupersededLoad(currentVaultId)) return

      await runExclusiveLoad(
        currentVaultId,
        { silent, forceHashComputation, hasChangedPaths: false },
        () => runLoadFiles(silent, forceHashComputation),
      )
      consumeSupersededLoad(currentVaultId)
    },
    [runLoadFiles, currentVaultId],
  )

  // TODO(decompose): Extract to hooks/useRefreshFolder.ts — refreshCurrentFolder is a
  // self-contained hook (~220 lines) that shares no mutable state with loadFiles.
  // Could be a standalone useRefreshFolder(vaultPath, user, setFiles, ...) hook.

  /**
   * Refresh only a specific folder (faster than full vault refresh)
   * Uses cached server data and only scans the local folder
   */
  const refreshCurrentFolder = useCallback(
    async (folderPath: string) => {
      logExplorer('refreshCurrentFolder ENTRY', { folderPath, vaultPath })
      window.electronAPI?.log('info', '[RefreshFolder] Called with', { folderPath, vaultPath })
      if (!window.electronAPI || !vaultPath) return

      // Guard against concurrent refreshes. isLoading misses silent watcher-driven
      // loadFiles passes, so check the in-flight tracker too.
      if (usePDMStore.getState().isLoading || isLoadFilesInFlight()) {
        window.electronAPI?.log('info', '[RefreshFolder] Skipping - already refreshing')
        return
      }

      // Set loading state and yield to UI thread so spinner renders before heavy work
      // (replaces flushSync which can crash React if called during an existing render cycle)
      setIsLoading(true)
      setStatusMessage(`Refreshing folder...`)
      await new Promise((resolve) => setTimeout(resolve, 0))

      try {
        // 1. Get existing files from store
        const existingFiles = usePDMStore.getState().files
        const serverFiles = usePDMStore.getState().serverFiles

        // 2. Scan only the target folder locally (fast - no hash computation)
        const localResult = await window.electronAPI.listFolderFast(folderPath)

        if (!localResult.success || !localResult.files) {
          window.electronAPI?.log('error', '[RefreshFolder] Failed to scan folder', {
            error: localResult.error,
          })
          setStatusMessage('Failed to refresh folder')
          return
        }

        window.electronAPI?.log('info', '[RefreshFolder] Scanned folder', {
          folderPath,
          localCount: localResult.files.length,
        })

        // 2b. Preserve the current folder's own entry (will be excluded by filter but needs to stay)
        // listFolderFast returns CONTENTS of the folder, not the folder entry itself
        const currentFolderEntry = folderPath
          ? existingFiles.find(
              (f) => f.relativePath.toLowerCase() === folderPath.toLowerCase() && f.isDirectory,
            )
          : undefined

        // 3. Separate existing files: those in the folder vs those outside
        const folderPrefix = folderPath ? folderPath.toLowerCase() + '/' : ''
        const filesOutsideFolder = existingFiles.filter((f) => {
          const relPath = f.relativePath.toLowerCase()
          // Keep files that are NOT in or under the refreshed folder
          if (folderPath === '') {
            // Refreshing root - replace everything
            return false
          }
          return !relPath.startsWith(folderPrefix) && relPath !== folderPath.toLowerCase()
        })

        // 4. Build COMPLETE pdmData map from existing files (not stripped serverFiles)
        // This preserves version, part_number, checkout info, workflow_state, etc.
        const existingPdmMap = new Map<string, NonNullable<(typeof existingFiles)[0]['pdmData']>>()
        const existingVersionMap = new Map<
          string,
          { localVersion?: number; localActiveVersion?: number }
        >()
        for (const f of existingFiles) {
          const key = f.relativePath.toLowerCase()
          if (f.pdmData) {
            existingPdmMap.set(key, f.pdmData)
          }
          if (f.localVersion !== undefined || f.localActiveVersion !== undefined) {
            existingVersionMap.set(key, {
              localVersion: f.localVersion,
              localActiveVersion: f.localActiveVersion,
            })
          }
        }

        // Also build a set of server file paths for cloud-only detection
        const serverPathSet = new Set<string>()
        for (const sf of serverFiles) {
          serverPathSet.add(sf.file_path.toLowerCase())
        }

        // 5. Merge local folder files with COMPLETE server data from existing files
        const userId = user?.id
        const refreshedFolderFiles = localResult.files.map((localFile: any) => {
          if (localFile.isDirectory) {
            return {
              ...localFile,
              localHash: localFile.hash,
            }
          }

          const lookupKey = localFile.relativePath.toLowerCase()
          // Use complete pdmData from existing files (has version, part_number, etc.)
          const pdmData = existingPdmMap.get(lookupKey)

          // Determine diff status
          let diffStatus: 'added' | 'modified' | 'outdated' | 'cloud' | undefined
          if (!pdmData) {
            // Check if file exists on server but we don't have pdmData yet
            // (shouldn't happen normally, but handle gracefully)
            diffStatus = serverPathSet.has(lookupKey) ? undefined : 'added'
          } else if (pdmData.content_hash && localFile.hash) {
            if (pdmData.content_hash !== localFile.hash) {
              const localModTime = new Date(localFile.modifiedTime).getTime()
              const cloudUpdateTime = pdmData.updated_at
                ? new Date(pdmData.updated_at).getTime()
                : 0
              diffStatus = localModTime > cloudUpdateTime ? 'modified' : 'outdated'
            }
          } else if (pdmData.content_hash) {
            // No local hash - use version-based detection first, then timestamp fallback
            // (mirrors the loadFiles merge logic to avoid false "outdated" from timestamps)
            const localModTime = new Date(localFile.modifiedTime).getTime()
            const cloudUpdateTime = pdmData.updated_at ? new Date(pdmData.updated_at).getTime() : 0
            const isCheckedOutByMe = pdmData.checked_out_by === userId

            const vInfo = existingVersionMap.get(lookupKey)
            const existingLocalVersion = vInfo?.localVersion

            if (existingLocalVersion !== undefined && pdmData.version !== undefined) {
              if (existingLocalVersion < pdmData.version) {
                diffStatus = 'outdated'
              } else if (existingLocalVersion === pdmData.version) {
                if (isCheckedOutByMe && localModTime > cloudUpdateTime + 5000) {
                  diffStatus = 'modified'
                }
              }
            } else {
              if (isCheckedOutByMe && localModTime > cloudUpdateTime + 5000) {
                diffStatus = 'modified'
              }
            }
          }

          const versionInfo = existingVersionMap.get(lookupKey)
          return {
            ...localFile,
            localHash: localFile.hash,
            pdmData: pdmData || undefined,
            isSynced: !!pdmData,
            diffStatus,
            localVersion: versionInfo?.localVersion,
            localActiveVersion: versionInfo?.localActiveVersion,
          }
        })

        // 6. Add cloud-only files in this folder (exist on server but not locally)
        const localPathSet = new Set(
          localResult.files.map((f: any) => f.relativePath.toLowerCase()),
        )
        for (const sf of serverFiles) {
          const sfPath = sf.file_path.toLowerCase()
          const isInFolder = folderPath === '' || sfPath.startsWith(folderPrefix)

          if (isInFolder && !localPathSet.has(sfPath)) {
            // Use complete pdmData from existing files if available
            const completePdmData = existingPdmMap.get(sfPath)

            refreshedFolderFiles.push({
              name: sf.name,
              path: buildFullPath(vaultPath, sf.file_path),
              relativePath: sf.file_path,
              isDirectory: false,
              extension: sf.extension || '',
              size: completePdmData?.file_size || 0,
              modifiedTime: completePdmData?.updated_at || '',
              pdmData: completePdmData || undefined,
              isSynced: false,
              diffStatus: 'cloud' as const,
            })
          }
        }

        // 7. Combine: files outside folder + refreshed folder files + current folder entry
        // The current folder entry must be preserved so navigation back works correctly
        const combinedFiles = [
          ...filesOutsideFolder,
          ...refreshedFolderFiles,
          ...(currentFolderEntry ? [currentFolderEntry] : []),
        ]

        // Sort for consistent display
        combinedFiles.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.relativePath.localeCompare(b.relativePath)
        })

        window.electronAPI?.log('info', '[RefreshFolder] Complete', {
          folderPath,
          outsideFolder: filesOutsideFolder.length,
          inFolder: refreshedFolderFiles.length,
          total: combinedFiles.length,
        })

        // Use startTransition to mark this as a non-urgent update
        // This allows React to render the loading spinner before processing the heavy file list
        // IMPORTANT: setIsLoading(false) is inside the transition so the concurrency guard
        // stays up until setFiles actually applies — prevents race with realtime batch updates
        const stStart = performance.now()
        logExplorer('startTransition CALLING', { combinedFilesCount: combinedFiles.length })
        startTransition(() => {
          logExplorer('startTransition EXECUTING setFiles', {
            delayMs: Math.round(performance.now() - stStart),
          })
          setFiles(combinedFiles)
          setIsLoading(false)
          setStatusMessage(`Refreshed ${refreshedFolderFiles.length} items`)
          setTimeout(() => setStatusMessage(''), 3000)
        })
      } catch (error) {
        window.electronAPI?.log('error', '[RefreshFolder] Error', { error: String(error) })
        setStatusMessage('Error refreshing folder')
        setIsLoading(false)
        setTimeout(() => setStatusMessage(''), 3000)
      }
    },
    [vaultPath, user, setFiles, setIsLoading, setStatusMessage],
  )

  return { loadFiles, refreshCurrentFolder }
}
