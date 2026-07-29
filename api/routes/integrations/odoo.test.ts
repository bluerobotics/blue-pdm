import { describe, it, expect, beforeAll } from 'vitest'

type OdooRoutes = typeof import('./odoo.js')
type CredentialStore = typeof import('../../src/integrations/credentialStore.js')

let odoo: OdooRoutes
let credentialStore: CredentialStore

beforeAll(async () => {
  // Both modules reach the API env schema, which exits the process when the
  // Supabase settings are missing, so they cannot be imported at the top.
  process.env.SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_KEY ||= 'test-anon-key'
  odoo = await import('./odoo.js')
  credentialStore = await import('../../src/integrations/credentialStore.js')
})

const CONFIGS = [
  { id: 'prod', url: 'https://one.odoo.com', database: 'main', username: 'admin@example.com' },
  { id: 'dev', url: 'https://two.odoo.com', database: 'main', username: 'admin@example.com' },
  { id: 'other-db', url: 'https://one.odoo.com', database: 'staging', username: 'admin@example.com' },
]

describe('isSameConnection', () => {
  const TARGET = {
    url: 'https://one.odoo.com',
    database: 'main',
    username: 'admin@example.com',
  }

  it('accepts the same target written with a trailing slash', () => {
    // Stored settings and submitted values do not always agree on trailing
    // slashes or scheme casing, and a false negative here would pointlessly
    // force an admin to retype a key they cannot read.
    expect(odoo.isSameConnection({ ...TARGET, url: 'https://one.odoo.com/' }, TARGET)).toBe(true)
  })

  it.each([
    ['a different host', { ...TARGET, url: 'https://attacker.example' }],
    ['a different database', { ...TARGET, database: 'staging' }],
    ['a different username', { ...TARGET, username: 'someone-else@example.com' }],
  ])('refuses to treat %s as the same connection', (_label, candidate) => {
    // This is the check that stops a stored key being delivered to a host the
    // caller chose: an admin cannot read the key, but without this they could
    // re-point the connection and leave the key field blank.
    expect(odoo.isSameConnection(candidate, TARGET)).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty settings', {}],
    ['settings missing a username', { url: TARGET.url, database: TARGET.database }],
  ])('fails closed on %s', (_label, candidate) => {
    expect(odoo.isSameConnection(candidate, TARGET)).toBe(false)
  })
})

describe('findMatchingSavedConfig', () => {
  it('matches on url, database and username together', () => {
    const match = odoo.findMatchingSavedConfig(CONFIGS, {
      url: 'https://one.odoo.com',
      database: 'main',
      username: 'admin@example.com',
    })
    expect(match?.id).toBe('prod')
  })

  it('still matches a connection whose API key has been rotated', () => {
    // The key is no longer part of the comparison, so re-saving the same
    // connection with a new key updates that config instead of piling up a
    // duplicate for every rotation.
    const match = odoo.findMatchingSavedConfig(CONFIGS, {
      url: 'https://two.odoo.com',
      database: 'main',
      username: 'admin@example.com',
    })
    expect(match?.id).toBe('dev')
  })

  it('treats a different database on the same server as a different connection', () => {
    const match = odoo.findMatchingSavedConfig(CONFIGS, {
      url: 'https://one.odoo.com',
      database: 'staging',
      username: 'admin@example.com',
    })
    expect(match?.id).toBe('other-db')
  })

  it('does not match when the username differs', () => {
    const match = odoo.findMatchingSavedConfig(CONFIGS, {
      url: 'https://one.odoo.com',
      database: 'main',
      username: 'someone-else@example.com',
    })
    expect(match).toBeUndefined()
  })

  it('does not match when the url differs', () => {
    const match = odoo.findMatchingSavedConfig(CONFIGS, {
      url: 'https://three.odoo.com',
      database: 'main',
      username: 'admin@example.com',
    })
    expect(match).toBeUndefined()
  })

  it('copes with the query returning nothing', () => {
    const target = { url: 'https://one.odoo.com', database: 'main', username: 'admin@example.com' }
    expect(odoo.findMatchingSavedConfig(null, target)).toBeUndefined()
    expect(odoo.findMatchingSavedConfig(undefined, target)).toBeUndefined()
    expect(odoo.findMatchingSavedConfig([], target)).toBeUndefined()
  })
})

describe('credentialSetupProblem', () => {
  it('surfaces the missing encryption key and how to set it', () => {
    const problem = odoo.credentialSetupProblem(new credentialStore.CredentialKeyMissingError())
    expect(problem).toMatch(/EXTENSION_ENCRYPTION_KEY is not configured/)
    expect(problem).toMatch(/randomBytes/)
  })

  it('surfaces an unreachable credential store', () => {
    const problem = odoo.credentialSetupProblem(
      new odoo.CredentialStoreUnavailableError('Set SUPABASE_SERVICE_KEY environment variable.'),
    )
    expect(problem).toMatch(/SUPABASE_SERVICE_KEY/)
  })

  it('leaves anything else to the error handler', () => {
    expect(odoo.credentialSetupProblem(new Error('Odoo returned a 500'))).toBeNull()
    expect(odoo.credentialSetupProblem('not an error')).toBeNull()
    expect(odoo.credentialSetupProblem(undefined)).toBeNull()
  })
})
