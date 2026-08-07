/**
 * The order in which a share link is created, which is the whole of its authorization.
 *
 * Nothing in `createShareLink` asks whether the caller may share the file. The INSERT policy on
 * `file_share_links` is what answers, and it is the only thing that does - so the insert has to
 * happen, and has to be *read*, before a URL exists. It used to happen after, inside a `try`/`catch`
 * that caught nothing, because `supabase-js` reports a refused insert by returning `{ error }`
 * rather than by throwing. A viewer the policy refuses walked away with a working seven-day public
 * download and left no trace of having taken it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createShareLink } from './shareLinks'

const single = vi.fn()
const insert = vi.fn()
const createSignedUrl = vi.fn()

vi.mock('./client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'file_share_links') return { insert }
      return { select: () => ({ eq: () => ({ single }) }) }
    },
    storage: { from: () => ({ createSignedUrl }) },
  }),
}))

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const ORG = 'org-1'
const FILE = 'file-1'
const USER = 'user-1'

const FILE_ROW = {
  content_hash: 'abcdef0123456789',
  file_name: 'ORING-BUNA-70A.SLDPRT',
  org_id: ORG,
}

beforeEach(() => {
  single.mockReset().mockResolvedValue({ data: FILE_ROW, error: null })
  insert.mockReset().mockResolvedValue({ error: null })
  createSignedUrl
    .mockReset()
    .mockResolvedValue({ data: { signedUrl: 'https://storage/signed' }, error: null })
})

describe('creating a share link', () => {
  it('returns a URL when the audit row was accepted', async () => {
    const result = await createShareLink(ORG, FILE, USER)

    expect(result.error).toBeUndefined()
    expect(result.link?.downloadUrl).toBe('https://storage/signed')
  })

  it('mints nothing when the insert is refused, and says so', async () => {
    // The refusal arrives as a returned value, not as a throw. Nothing here used to read it.
    insert.mockResolvedValue({
      error: { code: '42501', message: 'new row violates row-level security policy' },
    })

    const result = await createShareLink(ORG, FILE, USER)

    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(result.link).toBeNull()
    expect(result.error).toMatch(/permission/i)
  })

  it('records the share before it mints the URL, never after', async () => {
    const order: string[] = []
    insert.mockImplementation(async () => {
      order.push('insert')
      return { error: null }
    })
    createSignedUrl.mockImplementation(async () => {
      order.push('sign')
      return { data: { signedUrl: 'https://storage/signed' }, error: null }
    })

    await createShareLink(ORG, FILE, USER)

    expect(order).toEqual(['insert', 'sign'])
  })

  it('takes the organization from the file row so the policy’s own comparison holds', async () => {
    // Schema 95's INSERT policy requires the row's org_id to equal the file's. Sending the caller's
    // argument instead is a silent refusal waiting for the first caller that passes the wrong one.
    single.mockResolvedValue({ data: { ...FILE_ROW, org_id: 'org-from-row' }, error: null })

    await createShareLink(ORG, FILE, USER)

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-from-row' }))
  })

  it('caps the recorded expiry at what storage will actually sign for', async () => {
    await createShareLink(ORG, FILE, USER, { expiresInDays: 4_000 })

    const [{ expires_at: recorded }] = insert.mock.calls[0]
    const [, seconds] = createSignedUrl.mock.calls[0]
    const days = Math.round(
      (new Date(recorded).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    )

    expect(days).toBe(365)
    expect(seconds).toBe(365 * 24 * 60 * 60)
  })

  it('refuses a file with no content in storage before touching the audit table', async () => {
    single.mockResolvedValue({ data: { ...FILE_ROW, content_hash: null }, error: null })

    const result = await createShareLink(ORG, FILE, USER)

    expect(insert).not.toHaveBeenCalled()
    expect(result.link).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('reports a signing failure rather than handing back a link with no URL', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'object not found' } })

    const result = await createShareLink(ORG, FILE, USER)

    expect(result.link).toBeNull()
    expect(result.error).toBe('object not found')
  })
})
