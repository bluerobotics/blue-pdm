import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => {
  let fileResult: Promise<unknown> = Promise.resolve({ data: [], error: null })
  let userResult: Promise<unknown> = Promise.resolve({ data: [], error: null })

  const setResults = (nextFileResult: Promise<unknown>, nextUserResult: Promise<unknown>) => {
    fileResult = nextFileResult
    userResult = nextUserResult
  }

  const createQuery = (result: Promise<unknown>) => {
    const query = {
      select: () => query,
      in: () => query,
      not: () => query,
      eq: () => query,
      single: () => query,
      maybeSingle: () => query,
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        return result.then(onfulfilled, onrejected)
      },
    }
    return query
  }

  const client = {
    from: vi.fn((table: string) =>
      createQuery(table === 'files' ? fileResult : userResult),
    ),
  }

  return { client, setResults }
})

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => mocks.client,
}))

import { getCheckedOutUsers } from './queries'

const FIRST_FILE_ID = 'file-a'
const FIRST_OWNER_ID = 'owner-a'
const SECOND_OWNER_ID = 'owner-b'
const ORG_ID = 'org-a'
const VAULT_ID = 'vault-a'

describe('getCheckedOutUsers', () => {
  beforeEach(() => {
    mocks.client.from.mockClear()
    mocks.setResults(
      Promise.resolve({ data: [], error: null }),
      Promise.resolve({ data: [], error: null }),
    )
  })

  it('deduplicates an in-flight lookup while its transport is deferred', async () => {
    const fileResponse = deferred<{
      data: Array<{
        id: string
        checked_out_by: string
        org_id: string
        vault_id: string
      }>
      error: null
    }>()
    const userResponse = Promise.resolve({
      data: [
        {
          id: FIRST_OWNER_ID,
          email: 'owner-a@example.test',
          full_name: 'Owner A',
          avatar_url: null,
        },
      ],
      error: null,
    })
    mocks.setResults(fileResponse.promise, userResponse)

    const scope = { orgId: ORG_ID, vaultId: VAULT_ID }
    const firstRequest = getCheckedOutUsers([FIRST_FILE_ID], scope)
    const secondRequest = getCheckedOutUsers([FIRST_FILE_ID], scope)

    expect(mocks.client.from).toHaveBeenCalledTimes(1)

    fileResponse.resolve({
      data: [
        {
          id: FIRST_FILE_ID,
          checked_out_by: FIRST_OWNER_ID,
          org_id: ORG_ID,
          vault_id: VAULT_ID,
        },
      ],
      error: null,
    })

    await expect(secondRequest).resolves.toEqual({
      users: {
        [FIRST_FILE_ID]: {
          id: FIRST_OWNER_ID,
          email: 'owner-a@example.test',
          full_name: 'Owner A',
          avatar_url: null,
        },
      },
      error: null,
    })
    await expect(firstRequest).resolves.toEqual(await secondRequest)
    expect(mocks.client.from).toHaveBeenCalledTimes(2)
  })

  it('does not attach a profile whose id differs from the file owner', async () => {
    mocks.setResults(
      Promise.resolve({
        data: [
          {
            id: FIRST_FILE_ID,
            checked_out_by: FIRST_OWNER_ID,
            org_id: ORG_ID,
            vault_id: VAULT_ID,
          },
        ],
        error: null,
      }),
      Promise.resolve({
        data: [
          {
            id: SECOND_OWNER_ID,
            email: 'owner-b@example.test',
            full_name: 'Owner B',
            avatar_url: null,
          },
        ],
        error: null,
      }),
    )

    await expect(
      getCheckedOutUsers([FIRST_FILE_ID], { orgId: ORG_ID, vaultId: VAULT_ID }),
    ).resolves.toEqual({ users: {}, error: null })
  })
})
