// Constants for Explorer components

// MIME types for drag and drop
export const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.step': 'application/step',
  '.stp': 'application/step',
  '.sldprt': 'application/octet-stream',
  '.sldasm': 'application/octet-stream',
  '.slddrw': 'application/octet-stream',
}

// Custom data transfer type for PDM files
export const PDM_FILES_DATA_TYPE = 'application/x-plm-files'

// SolidWorks file extensions for metadata operations
export const SOLIDWORKS_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

// Tree item indentation (pixels per depth level)
export const TREE_INDENT_PX = 16

// Base padding for tree items
export const TREE_BASE_PADDING_PX = 8

// Slow double click timing thresholds (ms)
export const SLOW_DOUBLE_CLICK_MIN_MS = 400
export const SLOW_DOUBLE_CLICK_MAX_MS = 1500

// Diff status class prefix
export const DIFF_STATUS_CLASS_PREFIX = 'sidebar-diff-'
