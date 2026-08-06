/**
 * Which metadata writes are running right now, and how the browser asks.
 *
 * There is one set, and its members name the scope being written rather than only the file. That
 * distinction is the whole reason this module exists. `savingConfigsToSW` used to hold file paths
 * and be populated by `saveConfigsToSWFile` alone, so the two inline configuration editors - which
 * write to the document on every committed keystroke, through the same verified path - were
 * invisible to it. Their edits ran with no spinner anywhere, and, less visibly but worse, the
 * check-in and check-out guards that consult this set did not know a write was in flight and would
 * let a check-in start on top of one.
 *
 * A file-scope save is keyed by the path; a configuration edit by the path and the configuration.
 * `::` separates them, matching `selectedConfigs`, which keys configuration rows the same way. So
 * a configuration row can ask about itself, and anything that cares whether the file is busy at
 * all - the guards, the datacard's own markers - asks `isFileWriteInFlight`, which answers for
 * every scope inside it.
 *
 * Pure: no I/O, no store access, no React.
 */

const SCOPE_SEPARATOR = '::'

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

/** Add a key to the in-flight set, for the setter's updater form. */
export function withWriteInFlight(inFlight: ReadonlySet<string>, key: string): Set<string> {
  return new Set(inFlight).add(key)
}

/** Remove a key from the in-flight set, for the setter's updater form. */
export function withoutWriteInFlight(inFlight: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(inFlight)
  next.delete(key)
  return next
}
