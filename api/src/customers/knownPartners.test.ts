/**
 * The partner list in 60-customers.sql hardcodes the account_key each partner
 * will be synced under. Those keys are the output of normalizeCompanyName(),
 * transcribed by hand into SQL - so nothing stops the two from drifting apart,
 * and the failure would be silent: a partner whose key is a character off
 * simply never matches, and quietly stays classified as a direct customer
 * forever.
 *
 * This reads the keys back out of the SQL and recomputes them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractEmailDomain, isFreeMailDomain, normalizeCompanyName } from './grouping.js'

const MODULE_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/modules/60-customers.sql',
)

interface PartnerEntry {
  name: string
  channel: string
  country: string
  website: string
  accountKeys: string[]
}

/**
 * Pull the VALUES rows out of known_partners().
 *
 * Deliberately a parse of the shipped file rather than a duplicated copy of the
 * list: a fixture would only prove the fixture and the normalizer agree.
 */
function parseKnownPartners(): PartnerEntry[] {
  const sql = readFileSync(MODULE_SQL, 'utf8')

  const start = sql.indexOf('CREATE OR REPLACE FUNCTION known_partners()')
  expect(start, 'known_partners() not found in 60-customers.sql').toBeGreaterThan(-1)

  const end = sql.indexOf(') AS d(name, channel, country, website, account_keys);', start)
  expect(end, 'end of the known_partners() VALUES list not found').toBeGreaterThan(-1)

  const body = sql
    .slice(start, end)
    .replace(/::TEXT\[\]/g, '')
    .replace(/::TEXT/g, '')

  const rowPattern =
    /^\s*\('((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*ARRAY\[([^\]]*)\]\),?\s*$/

  const entries: PartnerEntry[] = []

  for (const line of body.split('\n')) {
    const match = rowPattern.exec(line)
    if (!match) continue

    entries.push({
      name: unquote(match[1]),
      channel: unquote(match[2]),
      country: unquote(match[3]),
      website: unquote(match[4]),
      accountKeys: match[5]
        .split(',')
        .map((key) => unquote(key.trim().replace(/^'|'$/g, '')))
        .filter(Boolean),
    })
  }

  return entries
}

/** SQL escapes a literal quote by doubling it. */
function unquote(value: string): string {
  return value.replace(/''/g, "'")
}

/** The part of a key after its kind prefix. */
function bareKey(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

describe('known_partners() in 60-customers.sql', () => {
  const entries = parseKnownPartners()
  const distributors = entries.filter((entry) => entry.channel === 'distributor')
  const integrators = entries.filter((entry) => entry.channel === 'integrator')

  it('parses the whole list', () => {
    // 66 published distributors, one of which (JM Robotics) builds ROVs rather
    // than reselling ours, plus 26 integrators from the Q1/Q2 2026 review.
    // A change here is fine and expected - it just has to be deliberate.
    expect(distributors).toHaveLength(65)
    expect(integrators).toHaveLength(27)
  })

  it('puts every partner in a real channel', () => {
    // 'direct' is the absence of a partner relationship, so it must never
    // appear here: seeding it would be a no-op that looks like a decision.
    for (const entry of entries) {
      expect(['distributor', 'integrator'], `${entry.name} has channel ${entry.channel}`).toContain(
        entry.channel,
      )
    }
  })

  it('names each partner once', () => {
    const names = entries.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('claims each account key for only one partner', () => {
    const seen = new Map<string, string>()

    for (const entry of entries) {
      for (const key of entry.accountKeys) {
        const owner = seen.get(key)
        expect(owner, `${key} is claimed by both ${owner} and ${entry.name}`).toBeUndefined()
        seen.set(key, entry.name)
      }
    }
  })

  it('lists the key normalizeCompanyName actually produces for the name', () => {
    for (const entry of entries) {
      const derived = `company:${normalizeCompanyName(entry.name)}`
      expect(entry.accountKeys, `${entry.name} is missing its name-derived key`).toContain(derived)
    }
  })

  it('lists the website domain as a fallback key', () => {
    for (const entry of entries) {
      // SIX VOICE sells through a storefront host rather than its own domain,
      // so a partner record there would never key on it.
      if (entry.website === 'underwaterdrone.stores.jp') continue
      // A blank website is the honest answer for a partner we only ever reached
      // on a personal mailbox; those carry an individual: key instead.
      if (!entry.website) continue

      expect(entry.accountKeys, `${entry.name} is missing its domain key`).toContain(
        `company:${entry.website}`,
      )
    }
  })

  it('only lists keys deriveAccount could actually produce', () => {
    // Three shapes are legitimate: the normalized company name, an alias for a
    // partner that trades under a shorter name than the one we list, and the
    // email domain. Anything else is a key no sync would ever generate, so it
    // would sit in the list matching nothing.
    for (const entry of entries) {
      for (const key of entry.accountKeys) {
        expect(key, `${key} is not normalised`).toBe(key.toLowerCase().trim())

        if (key.startsWith('individual:')) continue

        expect(key.startsWith('company:'), `${key} is not a company or individual key`).toBe(true)

        const bare = bareKey(key)

        if (bare.includes('.')) {
          expect(bare.includes(' '), `${key} looks like a domain but contains a space`).toBe(false)
          continue
        }

        // normalizeCompanyName strips periods, so a name-derived key can never
        // look like a domain - which is what keeps the two kinds apart. Running
        // it again must be a no-op, or the key is not something it can emit.
        expect(normalizeCompanyName(bare), `${key} is not a normalizeCompanyName output`).toBe(bare)
      }
    }
  })

  it('only keys on a person when deriveAccount would refuse the domain', () => {
    // deriveAccount never keys a company on gmail.com and friends, so an
    // individual: key is the only way to reach those partners. It is also the
    // only excuse for one: using it for a company with its own domain would
    // pin the partner to whichever employee happened to place the order.
    for (const entry of entries) {
      for (const key of entry.accountKeys.filter((k) => k.startsWith('individual:'))) {
        // deriveAccount only ever emits an address it could parse, so an
        // unparseable one is a key nothing would match.
        const domain = extractEmailDomain(bareKey(key))
        expect(domain, `${key} is not a parseable email address`).not.toBeNull()

        expect(isFreeMailDomain(domain!), `${entry.name} keys on ${domain}, its own domain`).toBe(
          true,
        )
        expect(entry.website, `${entry.name} has both a website and a personal key`).toBe('')
      }
    }
  })

  it('only aliases a partner whose listed name is not its trading name', () => {
    // An alias is a deliberate concession, not a general escape hatch: every
    // extra name key has to be justified by the listed name differing from what
    // the company would be entered as.
    const aliased = entries.filter(
      (entry) =>
        entry.accountKeys.filter(
          (key) => key.startsWith('company:') && !bareKey(key).includes('.'),
        ).length > 1,
    )

    expect(aliased.map((entry) => entry.name)).toEqual([
      'Searobotix (Hangzhou AOHI Marine Engineering)',
    ])
  })

  it('records a country for every partner', () => {
    for (const entry of entries) {
      expect(entry.country.length, `${entry.name} has no country`).toBeGreaterThan(0)
    }
  })
})
