import type { LocalFile } from '@/stores/pdmStore'

/**
 * Find a local file matching the given component path.
 * Tries exact match first, then falls back to filename match within the vault.
 *
 * SolidWorks reports the path it resolved, which may sit under a different vault root than the one
 * this machine mounted, so an exact comparison alone loses matches that plainly are the same file.
 */
export function findLocalFileByPath(
  componentPath: string,
  files: LocalFile[],
): LocalFile | undefined {
  const normalizedPath = componentPath.toLowerCase().replace(/\//g, '\\')
  const componentFileName = componentPath.split(/[\\/]/).pop()?.toLowerCase() || ''

  let match = files.find((f) => f.path.toLowerCase() === normalizedPath)

  // Try matching by path ending (handles different vault roots)
  if (!match) {
    match = files.find((f) => {
      const fPath = f.path.toLowerCase()
      return fPath.endsWith(normalizedPath) || normalizedPath.endsWith(fPath)
    })
  }

  // Try matching by filename only (last resort)
  if (!match && componentFileName) {
    match = files.find((f) => {
      const fName = f.path.split(/[\\/]/).pop()?.toLowerCase() || ''
      return fName === componentFileName
    })
  }

  return match
}
