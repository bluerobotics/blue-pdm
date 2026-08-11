import { recordMetric } from '@/lib/performanceMetrics'
import type { LoadFilesSessionContext } from '@/types/pdm'

/**
 * Cross-instance coordination state for `loadFiles`.
 *
 * Module-scoped rather than refs because `useLoadFiles` is instantiated by several
 * components, and silent watcher-driven refreshes never set `isLoading`, so there is
 * no other signal that a full scan and merge is already underway.
 */

export interface LoadFilesRequest {
  silent: boolean
  forceHashComputation: boolean
  /** Set when the file watcher supplied the specific paths that changed. */
  hasChangedPaths: boolean
  /** Auth boundary for callers that need session-scoped serialization. */
  authenticatedUserId?: LoadFilesSessionContext['authenticatedUserId']
  sessionGeneration?: LoadFilesSessionContext['sessionGeneration']
}

interface InFlightLoad {
  vaultId: string | undefined
  request: LoadFilesRequest
  promise: Promise<void>
}

let inFlightLoad: InFlightLoad | null = null
let currentSessionContext: LoadFilesSessionContext | undefined

interface LoadSessionBoundary {
  authenticatedUserId?: LoadFilesSessionContext['authenticatedUserId']
  sessionGeneration?: LoadFilesSessionContext['sessionGeneration']
}

function sessionContextMatches(active: LoadSessionBoundary, incoming: LoadSessionBoundary): boolean {
  return (
    active.authenticatedUserId === incoming.authenticatedUserId &&
    active.sessionGeneration === incoming.sessionGeneration
  )
}

function withCurrentSessionContext(request: LoadFilesRequest): LoadFilesRequest {
  return {
    ...request,
    authenticatedUserId:
      request.authenticatedUserId !== undefined
        ? request.authenticatedUserId
        : currentSessionContext?.authenticatedUserId,
    sessionGeneration:
      request.sessionGeneration !== undefined
        ? request.sessionGeneration
        : currentSessionContext?.sessionGeneration,
  }
}

/**
 * Publish the auth boundary used by legacy `useLoadFiles` callers that do not
 * pass a request object to this module. A changed boundary invalidates
 * per-vault merge shortcuts, while an in-flight pass is allowed to finish and
 * reject its own stale commit.
 */
export function setLoadFilesSessionContext(context: LoadFilesSessionContext): void {
  if (sessionContextMatches(currentSessionContext ?? {}, context)) return

  resetLoadFilesCoordination()
  currentSessionContext = { ...context }
}

/** Drop coordination state that belongs to a previous auth/session boundary. */
export function resetLoadFilesCoordination(): void {
  supersededLoads.clear()
  lastMergedState.clear()
}

/** True while a full loadFiles pass is running (including silent refreshes). */
export function isLoadFilesInFlight(): boolean {
  return inFlightLoad !== null
}

/**
 * Whether an already-running pass satisfies an incoming request, letting the caller
 * await it instead of starting a second scan. A force-hash pass covers a normal one
 * but not vice versa, and a silent pass does not cover a request that expects the
 * loading spinner.
 */
function inFlightCoversRequest(active: LoadFilesRequest, incoming: LoadFilesRequest): boolean {
  // A watcher-reported change may have landed after the running pass scanned that
  // path, so those requests always get their own pass rather than joining.
  if (incoming.hasChangedPaths) return false
  if (incoming.forceHashComputation && !active.forceHashComputation) return false
  if (!incoming.silent && active.silent) return false
  return true
}

/**
 * Serialize loadFiles passes.
 *
 * Two passes must never overlap: each does a full local scan plus a full server
 * merge, and the last setFiles wins, so concurrent passes burn the main thread twice
 * and can commit stale results. Requests that an in-flight pass already satisfies
 * join it; anything else queues behind it.
 */
export async function runExclusiveLoad(
  vaultId: string | undefined,
  request: LoadFilesRequest,
  start: () => Promise<void>,
): Promise<void> {
  const scopedRequest = withCurrentSessionContext(request)

  while (inFlightLoad) {
    const active = inFlightLoad
    if (
      active.vaultId === vaultId &&
      sessionContextMatches(active.request, scopedRequest) &&
      inFlightCoversRequest(active.request, scopedRequest)
    ) {
      window.electronAPI?.log('info', '[LoadFiles] Joining in-flight load', { ...scopedRequest })
      recordMetric('VaultLoad', 'Joined in-flight load', { ...scopedRequest })
      return active.promise
    }

    window.electronAPI?.log('info', '[LoadFiles] Queued behind in-flight load', {
      ...scopedRequest,
    })
    recordMetric('VaultLoad', 'Queued behind in-flight load', { ...scopedRequest })
    // Errors from the previous pass are already logged by the pass itself.
    await active.promise.catch(() => undefined)
  }

  const promise = start()
  inFlightLoad = { vaultId, request: scopedRequest, promise }

  try {
    await promise
  } finally {
    if (inFlightLoad?.promise === promise) {
      inFlightLoad = null
    }
  }
}

/**
 * Vaults whose in-flight pass refused to commit because a file operation landed
 * mid-scan. Set by the pass, drained by the caller once the pass has finished and
 * re-entry is safe.
 */
const supersededLoads = new Set<string>()

export function markLoadSuperseded(vaultId: string | undefined): void {
  if (vaultId) supersededLoads.add(vaultId)
}

/** Returns whether the vault needs another pass, clearing the flag. */
export function consumeSupersededLoad(vaultId: string | undefined): boolean {
  if (!vaultId) return false
  return supersededLoads.delete(vaultId)
}

/**
 * State of the last merge that actually committed, per vault. Lets a silent refresh
 * recognise that neither disk, server, nor store moved and skip the merge entirely.
 */
export interface MergedVaultState {
  scanFingerprint: string
  storeFileCount: number
}

const lastMergedState = new Map<string, MergedVaultState>()

export function getLastMergedState(vaultId: string | undefined): MergedVaultState | undefined {
  return vaultId ? lastMergedState.get(vaultId) : undefined
}

export function setLastMergedState(vaultId: string | undefined, state: MergedVaultState): void {
  if (vaultId) lastMergedState.set(vaultId, state)
}

/**
 * FNV-1a over path/size/mtime of every scanned entry. Cheap enough (tens of ms on a
 * 27k-item vault) to be worth it against a multi-second merge, and sensitive to
 * exactly the fields the merge derives diff status from.
 */
export function computeLocalScanFingerprint(
  files: Array<{ relativePath: string; size: number; modifiedTime: string }>,
): string {
  const FNV_OFFSET_BASIS = 0x811c9dc5
  const FNV_PRIME = 0x01000193

  let hash = FNV_OFFSET_BASIS
  const appendString = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, FNV_PRIME)
    }
  }

  for (const file of files) {
    appendString(file.relativePath)
    appendString('|')
    appendString(String(file.size))
    appendString('|')
    appendString(file.modifiedTime)
    appendString('\n')
  }

  return `${files.length}:${(hash >>> 0).toString(16)}`
}
