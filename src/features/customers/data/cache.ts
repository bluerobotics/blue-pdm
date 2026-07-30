/**
 * Request cache for the customer analytics RPCs.
 *
 * The workspace, the sidebar navigator and the detail panel are three sibling
 * subtrees with no shared ancestor below the store, so they cannot pass data to
 * each other and each used to issue its own queries - the sidebar's three facet
 * calls were byte-for-byte duplicates of three the workspace already made.
 * Nothing was retained either, so leaving the view and coming back, detaching a
 * tab or finishing a sync re-ran the whole dashboard from scratch.
 *
 * This fixes both without pulling in a query library:
 *
 *  - Concurrent callers of the same key share one in-flight promise, so the
 *    duplicate facet calls collapse into the workspace's.
 *  - Resolved values are kept, so `peek` can seed a hook's initial state and
 *    the view paints immediately on remount instead of flashing skeletons.
 *  - Values older than FRESH_MS are still returned to `peek`, but `load`
 *    revalidates them in the background - stale-while-revalidate.
 *
 * Everything is keyed on values the caller passes in (org, window, bucket), and
 * `resolveWindow` is midnight-aligned, so keys are stable for the whole day.
 */

/** How long a resolved value is reused without going back to the database. */
const FRESH_MS = 60_000

/**
 * Entries are small (the largest is the RFM roster) but a new key appears for
 * every range the user tries, so the map is bounded rather than unbounded.
 */
const MAX_ENTRIES = 60

interface Entry {
  hasValue: boolean
  value: unknown
  storedAt: number
  inFlight?: Promise<unknown>
}

/**
 * A named unit of work. Pairing the key with the function that produces it is
 * what makes deduplication safe: two call sites cannot drift into computing the
 * same key for different queries, or different keys for the same one.
 */
export interface Query<T> {
  key: string
  run: () => Promise<T>
}

const entries = new Map<string, Entry>()

/**
 * Bumped by the store's customerDataVersion. A sync rewrites customers,
 * orders and enrichments wholesale, so nothing cached before it survives.
 */
let generation = -1

export function setGeneration(next: number): void {
  if (next === generation) return
  generation = next
  entries.clear()
}

/** Drops everything, for the manual refresh button. */
export function clearCustomerCache(): void {
  entries.clear()
}

/**
 * The last known value for a query, however old, or undefined if it has never
 * resolved. Safe to call during render - it never starts a request.
 */
export function peek<T>(query: Query<T>): T | undefined {
  const entry = entries.get(query.key)
  return entry?.hasValue ? (entry.value as T) : undefined
}

/** True when `peek` would return a value that `load` will not refetch. */
export function isFresh<T>(query: Query<T>): boolean {
  const entry = entries.get(query.key)
  return !!entry?.hasValue && Date.now() - entry.storedAt < FRESH_MS
}

export function load<T>(query: Query<T>): Promise<T> {
  const existing = entries.get(query.key)

  if (existing?.inFlight) return existing.inFlight as Promise<T>
  if (existing?.hasValue && Date.now() - existing.storedAt < FRESH_MS) {
    return Promise.resolve(existing.value as T)
  }

  // Captured so a response that lands after a sync invalidated the cache is
  // discarded rather than resurrecting pre-sync data into a fresh generation.
  const startedAt = generation

  const inFlight: Promise<T> = query.run().then(
    (value) => {
      if (startedAt === generation) {
        entries.set(query.key, { hasValue: true, value, storedAt: Date.now() })
        evict()
      }
      return value
    },
    (cause: unknown) => {
      // Failures are never cached. Any previous value is put back so a blip
      // does not throw away a perfectly good stale render.
      if (startedAt === generation) {
        if (existing?.hasValue) {
          entries.set(query.key, {
            hasValue: true,
            value: existing.value,
            storedAt: existing.storedAt,
          })
        } else {
          entries.delete(query.key)
        }
      }
      throw cause
    },
  )

  entries.set(query.key, {
    hasValue: existing?.hasValue ?? false,
    value: existing?.value,
    storedAt: existing?.storedAt ?? 0,
    inFlight,
  })

  return inFlight
}

/** Oldest-first eviction. In-flight entries are skipped - someone is awaiting them. */
function evict(): void {
  if (entries.size <= MAX_ENTRIES) return

  for (const [key, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) return
    if (!entry.inFlight) entries.delete(key)
  }
}
