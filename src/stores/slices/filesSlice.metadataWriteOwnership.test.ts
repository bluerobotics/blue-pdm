import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'

import { applyWriteState, type MetadataWriteStateRecord } from '@/lib/metadata/writeState'
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

const AT = '2026-08-10T12:00:00.000Z'
const FILE_PATH = 'C:\\vault\\metadata-test'

function localFile(extension: string, metadataWriteState?: MetadataWriteStateRecord): LocalFile {
  const path = `${FILE_PATH}${extension}`
  return {
    name: `metadata-test${extension}`,
    path,
    relativePath: `metadata-test${extension}`,
    isDirectory: false,
    extension,
    size: 1,
    modifiedTime: 'now',
    metadataWriteState,
  }
}

describe('updatePendingMetadata write ownership', () => {
  let store: PDMStoreState

  beforeEach(() => {
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
      lockDrawingItemNumber: false,
      lockDrawingDescription: false,
      lockDrawingRevision: false,
      persistedPendingMetadata: {},
      persistedMetadataWriteState: {},
    } as unknown as PDMStoreState
  })

  it('preserves non-SolidWorks values while removing every write obligation', () => {
    const staleState = applyWriteState(
      undefined,
      [
        { scope: 'file', field: 'part_number' },
        { scope: 'file', field: 'description' },
        { scope: 'file', field: 'revision' },
        { scope: 'file', field: 'tab_number' },
      ],
      'failed',
      { at: AT },
    )
    const file = localFile('.pdf', staleState)
    const path = `${FILE_PATH}.pdf`
    const pending = {
      part_number: 'BR-202020',
      description: 'Exported drawing',
      revision: 'R2',
      tab_number: '02',
    }
    store.files = [file]

    const edit = store.updatePendingMetadata(path, pending)

    expect(edit.pending).toEqual(pending)
    expect(store.files[0].pendingMetadata).toEqual(pending)
    expect(store.files[0].metadataWriteState).toEqual({})
    expect(store.persistedMetadataWriteState[path]).toEqual({})
  })

  it('prunes a drawing revision while recording a writable item number', () => {
    const staleState = applyWriteState(
      undefined,
      [
        { scope: 'file', field: 'revision' },
        { scope: 'file', field: 'part_number' },
      ],
      'failed',
      { at: AT },
    )
    const file = localFile('.slddrw', staleState)
    const path = `${FILE_PATH}.slddrw`
    const pending = { revision: 'R2', part_number: 'BR-202020' }
    store.files = [file]

    store.updatePendingMetadata(path, pending)

    expect(store.files[0].pendingMetadata).toEqual(pending)
    expect(store.files[0].metadataWriteState?.fields?.revision).toBeUndefined()
    expect(store.files[0].metadataWriteState?.fields?.part_number).toMatchObject({
      state: 'pending',
    })
  })
})
