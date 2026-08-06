/**
 * Admin-only folder visibility.
 *
 * Folders listed in `organizations.settings.admin_only_folders` are removed from
 * the interface for non-admins and skipped by the serial number vault scan.
 * This is decluttering only — every organisation member can still read the rows
 * through the API, so it must never be presented as an access restriction.
 */

/** Vault-relative folder paths marked admin-only, as stored in org settings. */
export type HiddenFolderPaths = readonly string[]

/**
 * Normalize a vault-relative path for comparison: forward slashes, no leading or
 * trailing separator. Vault paths come from both the filesystem (backslashes) and
 * the database (forward slashes).
 */
export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Whether `path` is a hidden folder or lives underneath one.
 * Matching is case-insensitive because vault paths originate from Windows.
 */
export function isPathHidden(
  path: string | null | undefined,
  hiddenPaths: HiddenFolderPaths,
): boolean {
  if (!path || hiddenPaths.length === 0) return false

  const candidate = normalizeVaultPath(path).toLowerCase()
  if (!candidate) return false

  for (const hidden of hiddenPaths) {
    const target = normalizeVaultPath(hidden).toLowerCase()
    if (!target) continue
    if (candidate === target || candidate.startsWith(`${target}/`)) return true
  }

  return false
}

/** Whether this exact folder is the one marked hidden (not merely nested inside one). */
export function isFolderMarkedHidden(
  folderPath: string | null | undefined,
  hiddenPaths: HiddenFolderPaths,
): boolean {
  if (!folderPath || hiddenPaths.length === 0) return false

  const candidate = normalizeVaultPath(folderPath).toLowerCase()
  if (!candidate) return false

  return hiddenPaths.some((hidden) => normalizeVaultPath(hidden).toLowerCase() === candidate)
}

/** Add or remove a folder from the hidden list, returning a new normalized list. */
export function toggleHiddenFolderPath(
  hiddenPaths: HiddenFolderPaths,
  folderPath: string,
): string[] {
  const normalized = normalizeVaultPath(folderPath)
  if (!normalized) return [...hiddenPaths]

  if (isFolderMarkedHidden(normalized, hiddenPaths)) {
    const lower = normalized.toLowerCase()
    return hiddenPaths.filter((hidden) => normalizeVaultPath(hidden).toLowerCase() !== lower)
  }

  return [...hiddenPaths, normalized]
}

const EMPTY_PATHS: string[] = []

// Keyed by the settings object so every caller gets the same array instance. The
// vault tree and file pane memoize on this value by reference across hook instances.
const pathsBySettings = new WeakMap<object, string[]>()

/**
 * Read the hidden folder list off an organization settings object.
 * The value lives in a JSONB column, so it can be absent or malformed.
 */
export function readHiddenFolderPaths(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object') return EMPTY_PATHS

  const key = settings as object
  const cached = pathsBySettings.get(key)
  if (cached) return cached

  const value = (settings as Record<string, unknown>)['admin_only_folders']
  const paths = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : EMPTY_PATHS

  pathsBySettings.set(key, paths)
  return paths
}
