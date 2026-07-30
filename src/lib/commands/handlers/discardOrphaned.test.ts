import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Ordered record of the calls whose relative order the fix depends on. */
const callOrder: string[] = []

const releaseWatcher = vi.fn(() => {
  callOrder.push('release')
})
const beginWatcherSuppression = vi.fn(() => {
  callOrder.push('suppress')
  return releaseWatcher
})

vi.mock('@/lib/fileWatcherSuppression', () => ({ beginWatcherSuppression }))

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const endOperation = vi.fn()
vi.mock('../../fileOperationTracker', () => ({
  FileOperationTracker: { start: () => ({ endOperation }) },
}))

const removeFromSyncIndex = vi.fn(() => Promise.resolve())
vi.mock('../../cache/localSyncIndex', () => ({ removeFromSyncIndex }))

const { discardOrphanedCommand } = await import('./discardOrphaned')

import type { CommandContext, LocalFile } from '../types'

function orphan(name: string): LocalFile {
  return {
    name,
    path: `C:/vault/${name}`,
    relativePath: name,
    isDirectory: false,
    diffStatus: 'deleted_remote',
  } as LocalFile
}

/** A file present on both sides carries no diff status at all. */
function synced(name: string): LocalFile {
  return { ...orphan(name), diffStatus: undefined }
}

function makeContext(files: LocalFile[]) {
  return {
    files,
    activeVaultId: 'vault-1',
    addProcessingFoldersSync: vi.fn(),
    removeProcessingFolders: vi.fn(),
    addProgressToast: vi.fn(),
    updateProgressToast: vi.fn(),
    removeToast: vi.fn(),
    addToast: vi.fn(),
    removeFilesFromStore: vi.fn(),
    setLastOperationCompletedAt: vi.fn(),
  } as unknown as CommandContext & {
    removeFilesFromStore: ReturnType<typeof vi.fn>
    removeProcessingFolders: ReturnType<typeof vi.fn>
  }
}

/** Batch result where every listed path succeeded unless named in `failures`. */
function batchResult(paths: string[], failures: string[] = []) {
  const results = paths.map((path) => ({
    path,
    success: !failures.includes(path),
    error: failures.includes(path) ? 'EBUSY' : undefined,
  }))
  const succeeded = results.filter((r) => r.success).length

  return {
    success: failures.length === 0,
    results,
    summary: { total: paths.length, succeeded, failed: paths.length - succeeded, duration: 5 },
  }
}

let deleteBatch: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  callOrder.length = 0

  deleteBatch = vi.fn((paths: string[]) => {
    callOrder.push('deleteBatch')
    return Promise.resolve(batchResult(paths))
  })

  vi.stubGlobal('window', { electronAPI: { deleteBatch, log: vi.fn() } })
})

describe('discard-orphaned watcher suppression', () => {
  it('registers the deletions as expected changes before deleting', async () => {
    const files = [orphan('one.sldprt'), orphan('two.sldprt')]
    const ctx = makeContext(files)

    await discardOrphanedCommand.execute({ files }, ctx)

    expect(beginWatcherSuppression).toHaveBeenCalledTimes(1)
    // Registered against relative paths and the command's own ctx, matching the
    // processing markers and the delete handler.
    expect(beginWatcherSuppression).toHaveBeenCalledWith(['one.sldprt', 'two.sldprt'], ctx)
    expect(callOrder).toEqual(['suppress', 'deleteBatch', 'release'])
  })

  it('releases the registration when the batch returns no result', async () => {
    deleteBatch.mockResolvedValueOnce(undefined)
    const files = [orphan('one.sldprt')]

    const result = await discardOrphanedCommand.execute({ files }, makeContext(files))

    expect(result.success).toBe(false)
    expect(releaseWatcher).toHaveBeenCalledTimes(1)
  })

  it('releases the registration when the batch throws', async () => {
    deleteBatch.mockRejectedValueOnce(new Error('ipc died'))
    const files = [orphan('one.sldprt')]

    await expect(discardOrphanedCommand.execute({ files }, makeContext(files))).rejects.toThrow(
      'ipc died',
    )

    expect(releaseWatcher).toHaveBeenCalledTimes(1)
  })
})

describe('discard-orphaned store updates', () => {
  it('removes only the paths that were actually deleted', async () => {
    const files = [orphan('kept.sldprt'), orphan('gone.sldprt')]
    deleteBatch.mockImplementationOnce((paths: string[]) =>
      Promise.resolve(batchResult(paths, ['C:/vault/kept.sldprt'])),
    )
    const ctx = makeContext(files)

    const result = await discardOrphanedCommand.execute({ files }, ctx)

    expect(ctx.removeFilesFromStore).toHaveBeenCalledWith(['C:/vault/gone.sldprt'])
    expect(removeFromSyncIndex).toHaveBeenCalledWith('vault-1', ['gone.sldprt'])
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('leaves the store alone when every delete failed', async () => {
    const files = [orphan('one.sldprt')]
    deleteBatch.mockImplementationOnce((paths: string[]) =>
      Promise.resolve(batchResult(paths, paths)),
    )
    const ctx = makeContext(files)

    await discardOrphanedCommand.execute({ files }, ctx)

    expect(ctx.removeFilesFromStore).not.toHaveBeenCalled()
    expect(ctx.removeProcessingFolders).toHaveBeenCalledWith(['one.sldprt'])
    expect(releaseWatcher).toHaveBeenCalledTimes(1)
  })

  it('expands a folder to the orphans inside it', async () => {
    const child = orphan('folder/inner.sldprt')
    const sibling = synced('folder/sibling.sldprt')
    const folder = { ...orphan('folder'), isDirectory: true } as LocalFile
    const ctx = makeContext([folder, child, sibling])

    await discardOrphanedCommand.execute({ files: [folder] }, ctx)

    // Only the deleted_remote child is discarded, not the synced sibling.
    expect(deleteBatch).toHaveBeenCalledWith(['C:/vault/folder/inner.sldprt'], true)
  })
})

describe('discard-orphaned validation', () => {
  it('rejects an empty selection', () => {
    expect(discardOrphanedCommand.validate?.({ files: [] }, makeContext([]))).toBe(
      'No files selected',
    )
  })

  it('rejects a selection with nothing orphaned', () => {
    const file = synced('one.sldprt')
    expect(discardOrphanedCommand.validate?.({ files: [file] }, makeContext([file]))).toBe(
      'No orphaned files to discard',
    )
  })
})
