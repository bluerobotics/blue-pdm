import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateCreator } from 'zustand'

import { createUserSlice } from './userSlice'
import type { PDMStoreState, UserSlice } from '../types'

type UserSliceCreator = StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  UserSlice
>
type StoreSet = Parameters<UserSliceCreator>[0]
type StoreGet = Parameters<UserSliceCreator>[1]

describe('user session reset', () => {
  let store: PDMStoreState

  beforeEach(() => {
    store = {} as unknown as PDMStoreState

    const set: StoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(store) : partial
      store = { ...store, ...update }
    }
    const get: StoreGet = () => store
    const api = {} as Parameters<UserSliceCreator>[2]
    const userSlice = createUserSlice(set, get, api)
    const clearAllConfigCaches = vi.fn()
    const clearAnnotations = vi.fn()
    const clearOrganizationData = vi.fn()
    const clearOrganizationMetadata = vi.fn()
    const clearRecentSearches = vi.fn()
    const clearClipboard = vi.fn()
    const clearReviewPreviewFile = vi.fn()
    const setItemPanel = vi.fn()
    const clearProcessingFolders = vi.fn()
    const clearOrphanedCheckouts = vi.fn()
    const clearStagedCheckins = vi.fn()
    const clearMissingStorageFiles = vi.fn()
    const clearPendingLargeUpload = vi.fn()

    store = {
      ...userSlice,
      clearAllConfigCaches,
      clearAnnotations,
      clearOrganizationData,
      clearOrganizationMetadata,
      clearRecentSearches,
      clearClipboard,
      clearReviewPreviewFile,
      setItemPanel,
      clearProcessingFolders,
      clearOrphanedCheckouts,
      clearStagedCheckins,
      clearMissingStorageFiles,
      clearPendingLargeUpload,
      vaultPath: 'C:\\vault-a',
      connectedVaults: [
        {
          id: 'vault-a',
          name: 'Vault A',
          localPath: 'C:\\vault-a',
          isExpanded: true,
        },
      ],
      activeVaultId: 'vault-a',
      recentVaults: ['C:\\vault-a'],
      autoConnect: true,
      isVaultConnected: true,
      files: [
        {
          name: 'part.sldprt',
          path: 'C:\\vault-a\\part.sldprt',
          relativePath: 'part.sldprt',
          isDirectory: false,
          extension: '.sldprt',
          size: 1,
          modifiedTime: 'now',
        },
      ],
      serverFiles: [
        {
          id: 'file-a',
          file_path: 'part.sldprt',
          name: 'part.sldprt',
          extension: '.sldprt',
          content_hash: 'hash-a',
        },
      ],
      selectedFiles: ['C:\\vault-a\\part.sldprt'],
      checkoutHydration: {
        'file-a': {
          ownerId: 'user-a',
          state: 'pending',
          attempt: 1,
          lastError: null,
          requestId: 'request-a',
          updatedAt: 1,
        },
      },
      vaultFilesCache: {
        'vault-a': {
          files: [],
          serverFiles: [],
          loaded: true,
          loading: false,
        },
      },
    } as unknown as PDMStoreState
  })

  it('clears session-owned file state while preserving vault preferences', () => {
    store.resetSessionState()

    expect(store.files).toEqual([])
    expect(store.serverFiles).toEqual([])
    expect(store.selectedFiles).toEqual([])
    expect(store.checkoutHydration).toEqual({})
    expect(store.vaultFilesCache).toEqual({})
    expect(store.isVaultConnected).toBe(false)
    expect(store.filesLoaded).toBe(false)
    expect(store.vaultPath).toBe('C:\\vault-a')
    expect(store.connectedVaults).toHaveLength(1)
    expect(store.activeVaultId).toBe('vault-a')
    expect(store.recentVaults).toEqual(['C:\\vault-a'])
    expect(store.autoConnect).toBe(true)
  })

  it('can keep the vault connected across an account switch', () => {
    // Only explicit user actions set isVaultConnected back to true, and the Explorer's
    // load effect returns early without it. Clearing it on an account switch therefore
    // strands the next user on a vault nothing reconnects.
    store.resetSessionState({ preserveVaultConnection: true })

    expect(store.isVaultConnected).toBe(true)
    expect(store.files).toEqual([])
    expect(store.serverFiles).toEqual([])
    expect(store.filesLoaded).toBe(false)
    expect(store.user).toBeNull()
    expect(store.organization).toBeNull()
  })
})
