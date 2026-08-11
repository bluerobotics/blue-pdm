import { describe, expect, it } from 'vitest'

import type { CheckoutUserProfile } from '@/types/pdm'
import { applyDeltaToCache, type CachedServerFile } from './vaultFileCache'

const OWNER_A_ID = 'owner-a'
const OWNER_B_ID = 'owner-b'
const FILE_ID = 'file-a'

function profile(id: string): CheckoutUserProfile {
  return {
    id,
    email: `${id}@example.test`,
    full_name: id,
    avatar_url: null,
  }
}

function cachedFile(ownerId: string, checkedOutUser?: CheckoutUserProfile): CachedServerFile {
  return {
    id: FILE_ID,
    file_path: 'designs/widget.sldprt',
    file_name: 'widget.sldprt',
    extension: '.sldprt',
    file_type: 'part',
    part_number: null,
    description: null,
    revision: null,
    version: 1,
    content_hash: 'hash-a',
    file_size: 100,
    state: 'In Work',
    checked_out_by: ownerId,
    checked_out_at: '2026-08-10T17:00:00.000Z',
    updated_at: '2026-08-10T17:00:00.000Z',
    custom_properties: null,
    checked_out_user: checkedOutUser,
  }
}

function delta(ownerId: string): Parameters<typeof applyDeltaToCache>[1][number] {
  return {
    ...cachedFile(ownerId),
    deleted_at: null,
    is_deleted: false,
  }
}

describe('vault checkout profile cache reconciliation', () => {
  it('preserves a cached profile only when the delta keeps the same owner', () => {
    const result = applyDeltaToCache(
      [cachedFile(OWNER_A_ID, profile(OWNER_A_ID))],
      [delta(OWNER_A_ID)],
    )

    expect(result[0].checked_out_user?.id).toBe(OWNER_A_ID)
  })

  it('drops a cached profile when the owner changes', () => {
    const result = applyDeltaToCache(
      [cachedFile(OWNER_A_ID, profile(OWNER_A_ID))],
      [delta(OWNER_B_ID)],
    )

    expect(result[0]).not.toHaveProperty('checked_out_user')
    expect(result[0].checked_out_by).toBe(OWNER_B_ID)
  })
})
