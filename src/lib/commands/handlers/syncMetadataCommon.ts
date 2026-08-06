/**
 * The vocabulary the Sync Metadata command and its two halves share.
 *
 * Split out of `syncMetadata.ts` when the command outgrew a single file: the pull half, the push
 * half and the command itself all need the extension lists and the same log prefix, and a constant
 * duplicated across three files is a constant that eventually disagrees with itself.
 */

import { log } from '@/lib/logger'

/** Every SolidWorks document type the command will look at. */
export const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']
export const DRAWING_EXTENSIONS = ['.slddrw']
export const PART_ASSEMBLY_EXTENSIONS = ['.sldprt', '.sldasm']

/**
 * How long to keep suppressing the FileWatcher after writing properties into a SW file.
 * Must outlast the watcher's debounce so our own write is filtered out rather than the
 * user's next legitimate edit.
 */
export const WATCHER_SUPPRESSION_MS = 5_000

export function logSync(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[SyncMetadata]', message, context)
}

/**
 * How a drawing's parent model was located, when SolidWorks could not report the
 * drawing's references directly.
 *
 * `filename` and `reference-database` identify the parent unambiguously.
 * `sole-model-in-folder` is a guess from folder layout - see `isParentAuthoritative`.
 */
export type ParentInferenceStrategy = 'filename' | 'reference-database' | 'sole-model-in-folder'

/**
 * Extracted metadata structure
 */
export interface ExtractedMetadata {
  partNumber: string | null
  tabNumber: string | null
  description: string | null
  revision: string | null
  inheritedFromParent?: boolean
  parentModelPath?: string
  /**
   * Set only when the parent came from inference rather than the drawing's own
   * references. Absent means SolidWorks named the parent itself.
   */
  parentInferenceStrategy?: ParentInferenceStrategy
  /**
   * The drawing's own part number, before parent inheritance replaced it.
   * Only set when `inheritedFromParent` is true, so callers can detect a
   * drawing whose stored properties have drifted from its parent model.
   */
  ownPartNumber?: string | null
  /** The drawing's own description, before parent inheritance replaced it */
  ownDescription?: string | null
  /** True if drawing needs SW API for inheritance but SW isn't running */
  drawingNeedsSwButNotRunning?: boolean
  /** True if SW is running but COM inaccessible (permissions mismatch) */
  drawingNeedsSwComFix?: boolean
}
