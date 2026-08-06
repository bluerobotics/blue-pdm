import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()

vi.mock('../client', () => ({
  getSupabaseClient: () => ({ rpc }),
}))

vi.mock('../auth', () => ({
  getCurrentUserEmail: async () => 'someone@example.com',
}))

const { checkinFile } = await import('./checkout')

const FILE_ID = '00000000-0000-0000-0000-0000000000f1'
const USER_ID = '00000000-0000-0000-0000-0000000000u1'

/** Arguments of the single `checkin_file` call made by the test. */
function rpcArguments(): Record<string, unknown> {
  expect(rpc).toHaveBeenCalledTimes(1)
  const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
  expect(name).toBe('checkin_file')
  return args
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { success: true, file: { id: FILE_ID } }, error: null })
})

describe('checkinFile configuration maps', () => {
  // The payload the bug produced: one edited configuration, sent as the whole map.
  it('sends every committed configuration alongside the edited one', async () => {
    const committed: Record<string, string> = {}
    for (let index = 0; index < 68; index++) committed[`AS568-${index}`] = String(100 + index)

    await checkinFile(FILE_ID, USER_ID, {
      skipMachineMismatchCheck: true,
      pendingMetadata: { config_tabs: { 'AS568-14': '999' } },
      committedCustomProperties: { _config_tabs: committed },
    })

    const sent = rpcArguments().p_custom_properties as { _config_tabs: Record<string, string> }
    expect(Object.keys(sent._config_tabs)).toHaveLength(68)
    expect(sent._config_tabs['AS568-14']).toBe('999')
    expect(sent._config_tabs['AS568-0']).toBe('100')
  })

  it('sends no custom_properties patch when no configuration was edited', async () => {
    await checkinFile(FILE_ID, USER_ID, {
      skipMachineMismatchCheck: true,
      pendingMetadata: { part_number: 'PN-1' },
      committedCustomProperties: { _config_tabs: { A: '1' } },
    })

    expect(rpcArguments().p_custom_properties).toBeNull()
  })

  // A caller that does not know the committed side must not have its edit silently widened into a
  // replacement either; it sends what it has, and the RPC's entry-by-entry merge covers the rest.
  it('sends the edit alone when the committed properties were not supplied', async () => {
    await checkinFile(FILE_ID, USER_ID, {
      skipMachineMismatchCheck: true,
      pendingMetadata: { config_descriptions: { A: 'edited' } },
    })

    expect(rpcArguments().p_custom_properties).toEqual({ _config_descriptions: { A: 'edited' } })
  })
})
