// src/components/context-menu/utils.ts

/**
 * Format file size to human-readable string
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Generate count label for multi-selection
 */
export function getCountLabel(fileCount: number, folderCount: number): string {
  const parts: string[] = []
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`)
  }
  if (folderCount > 0) {
    parts.push(`${folderCount} folder${folderCount > 1 ? 's' : ''}`)
  }
  return parts.length > 0 ? `(${parts.join(', ')})` : ''
}

/**
 * Get plural suffix
 */
export function plural(count: number, singular = '', pluralSuffix = 's'): string {
  return count === 1 ? singular : pluralSuffix
}
