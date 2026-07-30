import { recordMetric } from '@/lib/performanceMetrics'

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
}

interface InFlightLoad {
  vaultId: string | undefined
  request: LoadFilesRequest
  promise: Promise<void>
}

let inFlightLoad: InFlightLoad | null = null

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
  const active = inFlightLoad

  if (active) {
    if (active.vaultId === vaultId && inFlightCoversRequest(active.request, request)) {
      window.electronAPI?.log('info', '[LoadFiles] Joining in-flight load', { ...request })
      recordMetric('VaultLoad', 'Joined in-flight load', { ...request })
      return active.promise
    }

    window.electronAPI?.log('info', '[LoadFiles] Queued behind in-flight load', { ...request })
    recordMetric('VaultLoad', 'Queued behind in-flight load', { ...request })
    // Errors from the previous pass are already logged by the pass itself.
    await active.promise.catch(() => undefined)
  }

  const promise = start()
  inFlightLoad = { vaultId, request, promise }

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
