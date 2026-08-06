/**
 * Which metadata writes are running right now, and how anything that cares asks.
 *
 * There is one set, and its members name the scope being written rather than only the file. That
 * distinction is the reason this module exists. `savingConfigsToSW` used to hold file paths and be
 * populated by `saveConfigsToSWFile` alone, so the two inline configuration editors - which write
 * to the document on every committed keystroke, through the same verified path - were invisible to
 * it. Their edits ran with no spinner anywhere, and, less visibly but worse, the check-in and
 * check-out guards that consult this set did not know a write was in flight.
 *
 * A file-scope save is keyed by the path; a configuration edit by the path and the configuration.
 * `::` separates them, matching `selectedConfigs`, which keys configuration rows the same way. So
 * a configuration row can ask about itself, and anything that cares whether the file is busy at
 * all - the guards, the datacard's own markers - asks `isFileWriteInFlight`, which answers for
 * every scope inside it.
 *
 * ## Why the set lives here rather than in a component
 *
 * It used to be a `useState` in `FilePane`, which meant only React could see it. The guard that
 * matters is not the disabled button: it is the check-in itself, which reads `pendingMetadata` and
 * the per-address marks and writes whatever is still owed. A `ci` from the command line during an
 * inline configuration edit ran its own write against a document already mid-write, and neither
 * write knew about the other. A command handler cannot read component state, so the state moved to
 * where both can reach it; React reads it through `useMetadataWritesInFlight`, which subscribes.
 *
 * The registry is the only mutable thing in here. Everything else is a pure function of a set the
 * caller supplies, so the predicates stay testable without touching it.
 */

const SCOPE_SEPARATOR = '::'

// ============================================
// The registry
// ============================================

type Listener = () => void

const EMPTY: ReadonlySet<string> = new Set()

let running: ReadonlySet<string> = EMPTY
const listeners = new Set<Listener>()

/** Every scope being written right now. Stable by reference until it changes, for React. */
export function metadataWritesInFlight(): ReadonlySet<string> {
  return running
}

/** Called whenever a write starts or finishes. Returns the unsubscribe. */
export function subscribeToMetadataWrites(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: ReadonlySet<string>): void {
  running = next.size === 0 ? EMPTY : next
  for (const listener of listeners) listener()
}

/** Declare a write started. Every caller must pair this with `endMetadataWrite` in a `finally`. */
export function beginMetadataWrite(key: string): void {
  if (running.has(key)) return
  publish(withWriteInFlight(running, key))
}

export function endMetadataWrite(key: string): void {
  if (!running.has(key)) return
  publish(withoutWriteInFlight(running, key))
}

/**
 * Wait for every write against one file to finish, and say whether it did.
 *
 * Bounded rather than indefinite: the first metadata write after a cold start waits on SolidWorks
 * launching, which takes the better part of a minute, and a write that never ends must not hang a
 * check-in forever. A caller that times out has learnt something true - the document is still
 * being written - and should decline rather than write over it.
 */
export function awaitFileWritesSettled(path: string, timeoutMs: number): Promise<boolean> {
  if (!isFileWriteInFlight(running, path)) return Promise.resolve(true)

  return new Promise((resolve) => {
    const finish = (settled: boolean): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve(settled)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const unsubscribe = subscribeToMetadataWrites(() => {
      if (!isFileWriteInFlight(running, path)) finish(true)
    })
  })
}

/** Forget every running write. For tests, which must not inherit another test's registry. */
export function resetMetadataWritesInFlight(): void {
  publish(EMPTY)
}

// ============================================
// Keys and questions
// ============================================

/** The key a file-scope metadata save is tracked under. */
export function fileWriteKey(path: string): string {
  return path
}

/** The key one configuration's metadata write is tracked under. */
export function configurationWriteKey(path: string, configuration: string): string {
  return `${path}${SCOPE_SEPARATOR}${configuration}`
}

/** Whether a metadata write is running against this file at any scope. */
export function isFileWriteInFlight(inFlight: ReadonlySet<string>, path: string): boolean {
  if (inFlight.size === 0) return false
  if (inFlight.has(path)) return true
  const prefix = `${path}${SCOPE_SEPARATOR}`
  for (const key of inFlight) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

/** Whether a metadata write is running against this one configuration. */
export function isConfigurationWriteInFlight(
  inFlight: ReadonlySet<string>,
  path: string,
  configuration: string,
): boolean {
  return inFlight.has(configurationWriteKey(path, configuration))
}

// Private: a caller holding its own copy of the set is how the registry became invisible to
// everything that was not a React component.
function withWriteInFlight(inFlight: ReadonlySet<string>, key: string): Set<string> {
  return new Set(inFlight).add(key)
}

function withoutWriteInFlight(inFlight: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(inFlight)
  next.delete(key)
  return next
}
