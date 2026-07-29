import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptSecret, looksEncrypted } from '../crypto/secretBox.js'

const KEY = 'test-encryption-key-that-is-long-enough-32'

// env is read at import time, so the module has to be re-imported per key state.
async function load(key: string | undefined) {
  vi.resetModules()
  if (key === undefined) delete process.env.EXTENSION_ENCRYPTION_KEY
  else process.env.EXTENSION_ENCRYPTION_KEY = key
  return import('./credentialStore.js')
}

interface Row {
  id: string
  org_id: string
  secret: string | null
}

/** Minimal stand-in for the parts of the Supabase client this module touches. */
function fakeClient(row: Row | null) {
  const state = { row, updates: [] as Record<string, unknown>[], upserts: [] as Record<string, unknown>[] }
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { maybeSingle: async () => ({ data: state.row, error: null }) }
                },
              }
            },
          }
        },
        update(values: Record<string, unknown>) {
          state.updates.push(values)
          return { eq: async () => ({ error: null }) }
        },
        upsert(values: Record<string, unknown>) {
          state.upserts.push(values)
          return Promise.resolve({ error: null })
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, state }
}

const ORIGINAL = process.env.EXTENSION_ENCRYPTION_KEY
beforeEach(() => {
  process.env.SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_KEY ||= 'test-anon-key'
})
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXTENSION_ENCRYPTION_KEY
  else process.env.EXTENSION_ENCRYPTION_KEY = ORIGINAL
})

describe('encryption key handling', () => {
  it('reports the key as missing and explains how to fix it', async () => {
    const m = await load(undefined)
    expect(m.hasEncryptionKey()).toBe(false)
    expect(() => m.getEncryptionKey()).toThrow(/EXTENSION_ENCRYPTION_KEY is not configured/)
  })

  it('refuses to store a credential without a key rather than writing plaintext', async () => {
    const m = await load(undefined)
    const { client, state } = fakeClient(null)
    await expect(
      m.setCredential(client, 'org-1', 'odoo_saved_config', 'cfg-1', 'super-secret'),
    ).rejects.toThrow(/EXTENSION_ENCRYPTION_KEY is not configured/)
    expect(state.upserts).toHaveLength(0)
  })
})

describe('setCredential', () => {
  it('stores ciphertext, never the plaintext value', async () => {
    const m = await load(KEY)
    const { client, state } = fakeClient(null)
    await m.setCredential(client, 'org-1', 'odoo_saved_config', 'cfg-1', 'super-secret-key')

    expect(state.upserts).toHaveLength(1)
    const written = state.upserts[0].secret as string
    expect(written).not.toContain('super-secret-key')
    expect(looksEncrypted(written)).toBe(true)
    expect(JSON.stringify(state.upserts[0])).not.toContain('super-secret-key')
  })
})

describe('getCredential', () => {
  it('returns null when there is no row', async () => {
    const m = await load(KEY)
    const { client } = fakeClient(null)
    expect(await m.getCredential(client, 'odoo_saved_config', 'cfg-1')).toBeNull()
  })

  it('decrypts a stored credential', async () => {
    const m = await load(KEY)
    const { client } = fakeClient({
      id: 'row-1',
      org_id: 'org-1',
      secret: encryptSecret('the-real-key', KEY),
    })
    expect(await m.getCredential(client, 'odoo_saved_config', 'cfg-1')).toBe('the-real-key')
  })

  it('reads legacy plaintext even with no key configured', async () => {
    // An API that has not been given a key yet must keep working against
    // integrations that were configured before encryption existed.
    const m = await load(undefined)
    const { client, state } = fakeClient({ id: 'row-1', org_id: 'org-1', secret: 'legacy-plain' })
    expect(await m.getCredential(client, 'odoo_saved_config', 'cfg-1')).toBe('legacy-plain')
    expect(state.updates).toHaveLength(0)
  })

  it('upgrades legacy plaintext to ciphertext once a key is available', async () => {
    const m = await load(KEY)
    const { client, state } = fakeClient({ id: 'row-1', org_id: 'org-1', secret: 'legacy-plain' })
    expect(await m.getCredential(client, 'odoo_saved_config', 'cfg-1')).toBe('legacy-plain')
    await new Promise((r) => setTimeout(r, 0))
    expect(state.updates).toHaveLength(1)
    expect(looksEncrypted(state.updates[0].secret as string)).toBe(true)
  })

  it('fails closed when the key no longer matches, rather than returning ciphertext', async () => {
    const encrypted = encryptSecret('the-real-key', 'a-completely-different-key-32-chars')
    const m = await load(KEY)
    const { client } = fakeClient({ id: 'row-1', org_id: 'org-1', secret: encrypted })
    await expect(m.getCredential(client, 'odoo_saved_config', 'cfg-1')).rejects.toThrow(
      /could not be decrypted/,
    )
  })
})
