/**
 * File Utility Functions
 */

import type { FileRecord } from '../types.js'

/**
 * Determine file type from extension
 */
export function getFileTypeFromExtension(ext: string): FileRecord['file_type'] {
  const lowerExt = (ext || '').toLowerCase()
  if (['.sldprt', '.prt', '.ipt', '.par'].includes(lowerExt)) return 'part'
  if (['.sldasm', '.asm', '.iam'].includes(lowerExt)) return 'assembly'
  if (['.slddrw', '.drw', '.idw', '.dwg'].includes(lowerExt)) return 'drawing'
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'].includes(lowerExt)) return 'document'
  return 'other'
}
