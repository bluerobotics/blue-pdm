/**
 * Monotonic counter bumped whenever a file operation changes what is on disk
 * (move, rename, delete, add).
 *
 * `loadFiles` scans the filesystem and fetches the server list in parallel, then
 * replaces the whole store with the merged result. If a file operation lands
 * between the scan and the commit, the two halves describe different states of
 * the vault: the scan still has the old paths while the server already has the
 * new ones. Committing that merge reverts the operation in the UI and can drop
 * the affected files from both the source and destination folders.
 *
 * The counter lets a pass notice that the ground moved under it and rerun
 * instead of committing. It lives outside the Zustand store on purpose: every
 * bump would otherwise re-render every subscriber mid-operation.
 */

let epoch = 0

/** Call after a file operation has changed the filesystem. */
export function bumpFileMutationEpoch(): void {
  epoch++
}

/** Snapshot to compare against later. Never compare epochs across vaults. */
export function getFileMutationEpoch(): number {
  return epoch
}
