/**
 * Background generation of thumbnails for a folder the user just opened.
 *
 * Only files with no cached entry are touched, and because entries survive
 * restarts this is a one-time cost per file version rather than something that
 * repeats every session. Work runs one file at a time to match the SolidWorks
 * service's single-command queue: dispatching more would only start timeout
 * clocks against a service that cannot answer yet.
 */

import fs from 'fs'
import path from 'path'

import { getThumbnail, isCached } from './store'

/** Only these can carry an embedded preview, so only these are worth visiting. */
const PREWARM_EXTENSIONS = new Set(['.sldprt', '.sldasm', '.slddrw'])

/**
 * Upper bound on files visited per folder. Prewarm is an optimization for the
 * next scroll, not a vault-wide indexer, and a folder larger than this will have
 * its remainder generated on demand anyway.
 */
const MAX_PREWARM_FILES = 500

/**
 * Identifies the newest run. An earlier run notices it has been superseded at
 * its next iteration and stops, so navigating quickly between folders does not
 * leave several passes competing for the queue.
 */
let currentRun = 0

type Logger = (message: string, data?: unknown) => void

export interface PrewarmResult {
  generated: number
  skipped: number
}

export async function prewarmFolder(folderPath: string, log: Logger): Promise<PrewarmResult> {
  const run = ++currentRun
  const result: PrewarmResult = { generated: 0, skipped: 0 }

  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  } catch {
    return result
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && PREWARM_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .slice(0, MAX_PREWARM_FILES)

  for (const entry of candidates) {
    if (run !== currentRun) break

    const filePath = path.join(folderPath, entry.name)

    if (await isCached(filePath, 'grid')) {
      result.skipped++
      continue
    }

    // Sequential on purpose: the store's in-flight map already merges this with
    // any on-demand request the renderer makes for the same file.
    await getThumbnail(filePath, 'grid')
    result.generated++
  }

  if (result.generated > 0) {
    log('[ThumbnailCache] Prewarmed folder', {
      folder: folderPath,
      generated: result.generated,
      alreadyCached: result.skipped,
      superseded: run !== currentRun,
    })
  }

  return result
}

/** Stop any in-progress pass, e.g. at shutdown. */
export function cancelPrewarm(): void {
  currentRun++
}
