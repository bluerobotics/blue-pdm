/**
 * IPC surface for the thumbnail cache.
 *
 * Images themselves never travel over IPC; they are fetched by the renderer
 * through the `blueplm-thumb` scheme. This channel only exists so the renderer
 * can tell the main process which folder is on screen.
 */

import { ipcMain } from 'electron'

import { cancelPrewarm, prewarmFolder } from './prewarm'

const PREWARM_CHANNEL = 'thumbnails:prewarm-folder'

type Logger = (message: string, data?: unknown) => void

export interface ThumbnailIpcDependencies {
  log: Logger
}

export function registerThumbnailIpcHandlers(deps: ThumbnailIpcDependencies): void {
  ipcMain.handle(PREWARM_CHANNEL, async (_, folderPath: string) => {
    if (typeof folderPath !== 'string' || !folderPath) return { generated: 0, skipped: 0 }
    return prewarmFolder(folderPath, deps.log)
  })
}

export function unregisterThumbnailIpcHandlers(): void {
  ipcMain.removeHandler(PREWARM_CHANNEL)
  cancelPrewarm()
}
