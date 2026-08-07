/**
 * Calling the repair, and reading what came back.
 *
 * Two things are pinned here, both about telling the operator something true.
 *
 * "Not installed yet" is a claim about the database, and it sends an administrator to apply a
 * schema. It used to be raised for *any* `42883`, which PostgreSQL also raises when the repair is
 * present and a helper it calls is not - so a partially installed schema told the operator to wait
 * for a release that had already shipped, and they waited.
 *
 * The receipt has to carry the entries that were asked for and dropped, not only the ones that
 * landed. Schema 95 added `entries_requested` to the refusal branch for exactly that reason, and a
 * reader that ignores it puts the shortfall back where the SQL had it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyConfigMapRepair, ConfigMapRepairNotInstalledError } from './configMapRepair'

const rpc = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc }),
}))

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const ORG = '11111111-2222-3333-4444-555555555555'

function answers(value: { data?: unknown; error?: { message: string; code?: string } | null }) {
  rpc.mockResolvedValue({ data: value.data ?? null, error: value.error ?? null })
}

beforeEach(() => {
  rpc.mockReset()
})

describe('deciding that the repair is not installed', () => {
  it('believes PostgREST when it says the routine is not in its schema cache', async () => {
    // What an older database actually answers: PostgREST resolves the routine before PostgreSQL
    // sees the request, so `undefined_function` is never raised at all.
    answers({
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.repair_config_maps(p_org_id, p_repairs)',
      },
    })

    await expect(applyConfigMapRepair(ORG, [])).rejects.toBeInstanceOf(
      ConfigMapRepairNotInstalledError,
    )
  })

  it('believes 42883 when the message names the repair itself', async () => {
    answers({
      error: { code: '42883', message: 'function repair_config_maps(uuid, jsonb) does not exist' },
    })

    await expect(applyConfigMapRepair(ORG, [])).rejects.toBeInstanceOf(
      ConfigMapRepairNotInstalledError,
    )
  })

  it('does not believe 42883 when the missing function is one the repair calls', async () => {
    // The defect. `require_org_member` is present in schema 85 and absent in nothing, but
    // `emergency-lockdown.sql` records `anon_revoke_grantors(oid)` going missing exactly this way
    // on a partially applied schema. The repair is installed; a dependency is not; and telling the
    // operator to apply schema 94 is advice that cannot work.
    answers({
      error: { code: '42883', message: 'function anon_revoke_grantors(oid) does not exist' },
    })

    const failure = await applyConfigMapRepair(ORG, []).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(ConfigMapRepairNotInstalledError)
    expect((failure as Error).message).toBe('function anon_revoke_grantors(oid) does not exist')
  })

  it('passes an authorization refusal straight through', async () => {
    answers({
      error: {
        code: '42501',
        message: 'Only organization admins can repair configuration maps',
      },
    })

    const failure = await applyConfigMapRepair(ORG, []).catch((error: unknown) => error)

    expect(failure).not.toBeInstanceOf(ConfigMapRepairNotInstalledError)
    expect((failure as Error).message).toBe('Only organization admins can repair configuration maps')
  })
})

describe('reading the receipt', () => {
  it('carries the entries a file lost when its row did not resolve', async () => {
    answers({
      data: {
        success: true,
        files_requested: 2,
        files_updated: 1,
        entries_requested: 68,
        entries_added: 40,
        files: [
          {
            file_id: 'file-1',
            file_path: 'Parts/ORING.SLDPRT',
            updated: true,
            refused: null,
            maps: { _config_tabs: { before: 0, requested: 40, added: 40, after: 40 } },
          },
          {
            file_id: 'file-2',
            file_path: null,
            updated: false,
            refused: 'row-not-found',
            entries_requested: 28,
            maps: {},
          },
        ],
      },
    })

    const outcome = await applyConfigMapRepair(ORG, [])

    expect(outcome.files[1]).toMatchObject({
      refused: 'row-not-found',
      entriesRequested: 28,
      entriesUnderAbsentMap: 0,
    })
  })

  it('counts a file’s request off its maps when the applied branch reported no total', async () => {
    answers({
      data: {
        success: true,
        files_requested: 1,
        files_updated: 1,
        entries_requested: 12,
        entries_added: 12,
        files: [
          {
            file_id: 'file-1',
            file_path: 'Parts/ORING.SLDPRT',
            updated: true,
            refused: null,
            maps: {
              _config_tabs: { before: 0, requested: 8, added: 8, after: 8 },
              _config_descriptions: { before: 2, requested: 4, added: 4, after: 6 },
            },
          },
        ],
      },
    })

    const outcome = await applyConfigMapRepair(ORG, [])

    expect(outcome.files[0].entriesRequested).toBe(12)
  })

  it('records what was asked for under a map the row does not carry', async () => {
    answers({
      data: {
        success: true,
        files_requested: 1,
        files_updated: 0,
        entries_requested: 9,
        entries_added: 0,
        files: [
          {
            file_id: 'file-1',
            file_path: 'Parts/ORING.SLDPRT',
            updated: false,
            refused: null,
            maps: { _config_descriptions: { refused: 'map-absent', requested: 9 } },
          },
        ],
      },
    })

    const outcome = await applyConfigMapRepair(ORG, [])

    expect(outcome.files[0]).toMatchObject({
      mapsAbsent: ['_config_descriptions'],
      entriesUnderAbsentMap: 9,
      entriesRequested: 9,
    })
  })
})
