/**
 * setFiles is the last line of defence against the same file arriving twice.
 *
 * Everything upstream of it - the load merge, the folder refresh, the realtime
 * batches - matches files on the lowercase relative path, while this only ever
 * compared the absolute one. A local entry built by path.join and a cloud entry
 * built by buildFullPath describe one file, so any divergence between the two
 * vault prefixes let a pair through that the producer had already treated as a
 * single row. A store that grows by rows nobody added is how one vault reached
 * 27,993 entries for 25,213 server files, and the renderer died on the next
 * merge over it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'

import type { LocalFile, PDMStoreState, FilesSlice } from '../types'
import { createFilesSlice } from './filesSlice'

vi.mock('@/stores/pdmStore', () => ({
  usePDMStore: {
    getState: vi.fn(),
  },
}))

type FilesSliceCreator = StateCreator<PDMStoreState, [['zustand/persist', unknown]], [], FilesSlice>
type StoreSet = Parameters<FilesSliceCreator>[0]
type StoreGet = Parameters<FilesSliceCreator>[1]

function file(overrides: Partial<LocalFile> & Pick<LocalFile, 'path' | 'relativePath'>): LocalFile {
  return {
    name: overrides.relativePath.split('/').pop() || '',
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: 'now',
    ...overrides,
  }
}

describe('setFiles deduplication', () => {
  let store: PDMStoreState

  beforeEach(() => {
    // setFiles reports the duplicates it filtered over the renderer log bridge
    vi.stubGlobal('window', { electronAPI: { log: vi.fn() } })

    store = {} as unknown as PDMStoreState

    const set: StoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(store) : partial
      store = { ...store, ...update }
    }
    const get: StoreGet = () => store
    const api = {} as Parameters<FilesSliceCreator>[2]
    const filesSlice = createFilesSlice(set, get, api)

    store = {
      ...filesSlice,
      files: [],
      user: null,
      persistedPendingMetadata: {},
      persistedMetadataWriteState: {},
      persistedCopySource: {},
    } as unknown as PDMStoreState
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('collapses entries that share a relative path but not an absolute one', () => {
    store.setFiles([
      file({ path: 'C:\\vault\\parts\\bracket.sldprt', relativePath: 'parts/bracket.sldprt' }),
      file({
        path: '\\\\?\\C:\\vault\\parts\\bracket.sldprt',
        relativePath: 'parts/bracket.sldprt',
        diffStatus: 'cloud',
      }),
    ])

    expect(store.files).toHaveLength(1)
  })

  it('keeps the local entry when a cloud row duplicates it', () => {
    store.setFiles([
      file({
        path: '\\\\?\\C:\\vault\\parts\\bracket.sldprt',
        relativePath: 'parts/bracket.sldprt',
        diffStatus: 'cloud',
      }),
      file({
        path: 'C:\\vault\\parts\\bracket.sldprt',
        relativePath: 'parts/bracket.sldprt',
        diffStatus: 'modified',
      }),
    ])

    expect(store.files).toHaveLength(1)
    expect(store.files[0].diffStatus).toBe('modified')
  })

  it('still collapses case-different absolute paths', () => {
    store.setFiles([
      file({ path: 'C:\\vault\\PARTS\\bracket.sldprt', relativePath: 'PARTS/bracket.sldprt' }),
      file({ path: 'c:\\vault\\parts\\bracket.sldprt', relativePath: 'parts/bracket.sldprt' }),
    ])

    expect(store.files).toHaveLength(1)
  })

  it('leaves distinct files alone', () => {
    store.setFiles([
      file({ path: 'C:\\vault\\parts\\bracket.sldprt', relativePath: 'parts/bracket.sldprt' }),
      file({ path: 'C:\\vault\\parts\\housing.sldprt', relativePath: 'parts/housing.sldprt' }),
      file({
        path: 'C:\\vault\\parts',
        relativePath: 'parts',
        isDirectory: true,
        extension: '',
      }),
    ])

    expect(store.files).toHaveLength(3)
  })
})
