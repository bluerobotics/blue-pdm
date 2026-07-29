import { describe, expect, it } from 'vitest'

import {
  areDistinctSites,
  deriveAccount,
  disambiguateByAddress,
  extractEmailDomain,
  isFreeMailDomain,
  normalizeCompanyName,
} from './grouping.js'
import type { CustomerAddress, CustomerInput } from './types.js'

describe('normalizeCompanyName', () => {
  it('treats the anglosphere legal suffixes as interchangeable', () => {
    const variants = ['Acme Ltd', 'ACME Limited', 'Acme Ltd.', 'acme, ltd', '  Acme   LIMITED  ']
    const keys = new Set(variants.map(normalizeCompanyName))

    expect(keys).toEqual(new Set(['acme']))
  })

  it('strips punctuated abbreviations', () => {
    expect(normalizeCompanyName('Acme L.L.C.')).toBe('acme')
    expect(normalizeCompanyName('Acme LLC')).toBe('acme')
    expect(normalizeCompanyName('Subsea S.r.l.')).toBe('subsea')
    expect(normalizeCompanyName('Subsea SRL')).toBe('subsea')
    expect(normalizeCompanyName('Ocean Tech B.V.')).toBe('ocean tech')
    expect(normalizeCompanyName('Ocean Tech BV')).toBe('ocean tech')
    expect(normalizeCompanyName('Deep S.p.A.')).toBe('deep')
    expect(normalizeCompanyName('Deep SpA')).toBe('deep')
  })

  it('handles the Nordic slash form', () => {
    expect(normalizeCompanyName('Nordic Marine A/S')).toBe('nordic marine')
    expect(normalizeCompanyName('Nordic Marine AS')).toBe('nordic marine')
    expect(normalizeCompanyName('Nordic Marine a/s')).toBe('nordic marine')
  })

  it('strips a trailing connector left dangling by a compound suffix', () => {
    expect(normalizeCompanyName('Acme GmbH & Co. KG')).toBe('acme')
    expect(normalizeCompanyName('Acme GmbH')).toBe('acme')
    expect(normalizeCompanyName('Acme Sdn Bhd')).toBe('acme')
    expect(normalizeCompanyName('Acme Pte Ltd')).toBe('acme')
  })

  it('expands ampersands so spacing around them does not matter', () => {
    expect(normalizeCompanyName('R&D Marine')).toBe('r and d marine')
    expect(normalizeCompanyName('R & D Marine')).toBe('r and d marine')
    expect(normalizeCompanyName('Smith & Sons Ltd')).toBe('smith and sons')
    expect(normalizeCompanyName('Smith and Sons Limited')).toBe('smith and sons')
  })

  it('folds accents and non-decomposing Nordic letters', () => {
    expect(normalizeCompanyName('Kongsberg Marítime')).toBe('kongsberg maritime')
    expect(normalizeCompanyName('Kongsberg Maritime')).toBe('kongsberg maritime')
    expect(normalizeCompanyName('Sjøkabel AS')).toBe('sjokabel')
    expect(normalizeCompanyName('Ægir Subsea')).toBe('aegir subsea')
    expect(normalizeCompanyName('Straße Marine GmbH')).toBe('strasse marine')
  })

  it('is stable under punctuation and separator changes', () => {
    const keys = new Set(
      [
        'Blue Robotics, Inc.',
        'Blue-Robotics Inc',
        'Blue  Robotics   INC',
        'Blue Robotics Inc.',
      ].map(normalizeCompanyName),
    )

    expect(keys).toEqual(new Set(['blue robotics']))
  })

  it('never strips a name down to nothing', () => {
    expect(normalizeCompanyName('Ltd')).toBe('ltd')
    expect(normalizeCompanyName('Co.')).toBe('co')
    expect(normalizeCompanyName('AS')).toBe('as')
  })

  it('returns an empty string for input with nothing to key on', () => {
    expect(normalizeCompanyName('')).toBe('')
    expect(normalizeCompanyName('    ')).toBe('')
    expect(normalizeCompanyName('...')).toBe('')
    expect(normalizeCompanyName('---')).toBe('')
    expect(normalizeCompanyName(undefined as unknown as string)).toBe('')
    expect(normalizeCompanyName(null as unknown as string)).toBe('')
  })

  it('never emits characters that could be mistaken for a domain', () => {
    expect(normalizeCompanyName('Acme.com Ltd')).toBe('acmecom')
    expect(normalizeCompanyName('Deep/Sea Systems')).toBe('deep sea systems')
  })
})

describe('extractEmailDomain', () => {
  it('lowercases the domain', () => {
    expect(extractEmailDomain('John@Acme-Subsea.COM')).toBe('acme-subsea.com')
    expect(extractEmailDomain('  ops@Kongsberg.NO  ')).toBe('kongsberg.no')
  })

  it('handles multi-label domains', () => {
    expect(extractEmailDomain('a@b.co.uk')).toBe('b.co.uk')
    expect(extractEmailDomain('a@mail.corp.example.com')).toBe('mail.corp.example.com')
  })

  it('unwraps the "Name <addr>" form Odoo sometimes stores', () => {
    expect(extractEmailDomain('John Doe <john@acme.com>')).toBe('acme.com')
  })

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['no at sign', 'not-an-email'],
    ['missing domain', 'a@'],
    ['missing local part', '@b.com'],
    ['no dot in domain', 'a@localhost'],
    ['space in local part', 'a b@c.com'],
    ['double at sign', 'a@@b.com'],
    ['empty label', 'a@b..com'],
    ['leading hyphen', 'a@-b.com'],
    ['trailing hyphen', 'a@b-.com'],
    ['single character tld', 'a@b.c'],
    ['trailing dot', 'a@b.com.'],
  ])('returns null for %s', (_label, value) => {
    expect(extractEmailDomain(value)).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(extractEmailDomain(undefined as unknown as string)).toBeNull()
    expect(extractEmailDomain(null as unknown as string)).toBeNull()
  })
})

describe('isFreeMailDomain', () => {
  it('recognises the global providers', () => {
    for (const domain of [
      'gmail.com',
      'googlemail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'live.com',
      'msn.com',
      'aol.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'protonmail.com',
      'proton.me',
    ]) {
      expect(isFreeMailDomain(domain), domain).toBe(true)
    }
  })

  it('recognises regional providers', () => {
    for (const domain of [
      'yahoo.co.uk',
      'yahoo.fr',
      'gmx.de',
      'web.de',
      'mail.ru',
      'yandex.ru',
      'qq.com',
      '163.com',
      '126.com',
      'naver.com',
      'daum.net',
      'orange.fr',
      'free.fr',
      'wanadoo.fr',
      'libero.it',
      'virgilio.it',
      'tiscali.it',
      'bluewin.ch',
      'telus.net',
      'shaw.ca',
      'btinternet.com',
      'sky.com',
      'comcast.net',
      'verizon.net',
      'att.net',
      'sbcglobal.net',
      'cox.net',
      'bigpond.com',
      'optusnet.com.au',
      'xtra.co.nz',
    ]) {
      expect(isFreeMailDomain(domain), domain).toBe(true)
    }
  })

  it('does not flag corporate domains', () => {
    for (const domain of [
      'acme-subsea.com',
      'oceaneering.com',
      'kongsberg.no',
      'saabseaeye.com',
      'gmail.com.mx',
      'notgmail.com',
      '',
    ]) {
      expect(isFreeMailDomain(domain), domain).toBe(false)
    }
  })

  it('tolerates casing, a leading at sign, and a trailing dot', () => {
    expect(isFreeMailDomain('GMAIL.COM')).toBe(true)
    expect(isFreeMailDomain('  Gmail.Com  ')).toBe(true)
    expect(isFreeMailDomain('@gmail.com')).toBe(true)
    expect(isFreeMailDomain('gmail.com.')).toBe(true)
  })

  it('returns false for non-string input', () => {
    expect(isFreeMailDomain(undefined as unknown as string)).toBe(false)
  })
})

describe('deriveAccount', () => {
  const base: CustomerInput = { id: 1 }

  it('keys a company by its normalised name', () => {
    const account = deriveAccount({
      ...base,
      name: 'Jonas Berg',
      email: 'jonas@acme-subsea.com',
      company: 'Acme Subsea Ltd',
    })

    expect(account).toEqual({
      accountKey: 'company:acme subsea',
      kind: 'company',
      displayName: 'Acme Subsea Ltd',
    })
  })

  it('treats a row flagged as a company as its own company name', () => {
    const account = deriveAccount({ id: 2, name: 'Acme Subsea Limited', isCompany: true })

    expect(account.kind).toBe('company')
    expect(account.accountKey).toBe('company:acme subsea')
  })

  it('collapses rows that differ only cosmetically onto one key', () => {
    const rows: CustomerInput[] = [
      { id: 1, name: 'Jonas', email: 'jonas@acme-subsea.com', company: 'Acme Subsea Ltd' },
      { id: 2, name: 'Mia', email: 'mia@gmail.com', company: 'ACME SUBSEA LIMITED' },
      { id: 3, name: 'Ola', company: 'Acme  Subsea,  Ltd.' },
      { id: 4, name: 'Acme Subsea AS', isCompany: true },
    ]

    const keys = new Set(rows.map((row) => deriveAccount(row).accountKey))

    expect(keys).toEqual(new Set(['company:acme subsea']))
  })

  it('routes a free-mail address to an individual account', () => {
    const account = deriveAccount({ id: 9, name: 'Hanna Iversen', email: 'Hanna@Gmail.com' })

    expect(account).toEqual({
      accountKey: 'individual:hanna@gmail.com',
      kind: 'individual',
      displayName: 'Hanna Iversen',
    })
  })

  it('routes a work email to a company account keyed by domain', () => {
    const account = deriveAccount({ id: 10, name: 'Hanna Iversen', email: 'hanna@oceaneering.com' })

    expect(account).toEqual({
      accountKey: 'company:oceaneering.com',
      kind: 'company',
      displayName: 'oceaneering.com',
    })
  })

  it('falls back to the customer id when there is no usable email', () => {
    expect(deriveAccount({ id: 42, name: 'Walk-in customer' })).toEqual({
      accountKey: 'individual:id:42',
      kind: 'individual',
      displayName: 'Walk-in customer',
    })

    expect(deriveAccount({ id: 43, email: 'not-an-email' }).accountKey).toBe('individual:id:43')
    expect(deriveAccount({ id: 44, email: '   ' }).accountKey).toBe('individual:id:44')
    expect(deriveAccount({ id: 45 }).displayName).toBe('Customer 45')
  })

  it('ignores a blank or unusable company name', () => {
    expect(deriveAccount({ id: 5, company: '   ', email: 'a@gmail.com' }).accountKey).toBe(
      'individual:a@gmail.com',
    )
    expect(deriveAccount({ id: 6, company: '###', email: 'a@gmail.com' }).kind).toBe('individual')
  })

  it('never collides a company name with an email domain', () => {
    const byName = deriveAccount({ id: 1, company: 'Acme Com' })
    const byDomain = deriveAccount({ id: 2, email: 'sales@acme.com' })

    expect(byName.accountKey).toBe('company:acme com')
    expect(byDomain.accountKey).toBe('company:acme.com')
    expect(byName.accountKey).not.toBe(byDomain.accountKey)
  })

  it('never collides a company with an individual', () => {
    const company = deriveAccount({ id: 1, company: 'Acme' })
    const individual = deriveAccount({ id: 2, email: 'acme@gmail.com' })

    expect(company.accountKey.startsWith('company:')).toBe(true)
    expect(individual.accountKey.startsWith('individual:')).toBe(true)
    expect(company.accountKey).not.toBe(individual.accountKey)
  })

  it('produces the same key for a string id and a numeric id', () => {
    expect(deriveAccount({ id: 42 }).accountKey).toBe(deriveAccount({ id: '42' }).accountKey)
  })
})

describe('areDistinctSites', () => {
  const bergen: CustomerAddress = { city: 'Bergen', postcode: '5003', country: 'Norway' }

  it('merges when either address is missing', () => {
    expect(areDistinctSites(null, bergen)).toBe(false)
    expect(areDistinctSites(bergen, undefined)).toBe(false)
    expect(areDistinctSites({}, {})).toBe(false)
  })

  it('splits on a clearly different country', () => {
    expect(
      areDistinctSites(bergen, {
        city: 'Aberdeen',
        postcode: 'AB10 1XY',
        country: 'United Kingdom',
      }),
    ).toBe(true)
  })

  it('merges country spellings that are the same place', () => {
    expect(areDistinctSites({ country: 'UK' }, { country: 'United Kingdom' })).toBe(false)
    expect(areDistinctSites({ country: 'GB' }, { country: 'Great Britain' })).toBe(false)
    expect(areDistinctSites({ country: 'USA' }, { country: 'United States of America' })).toBe(
      false,
    )
    expect(areDistinctSites({ country: 'Norge' }, { country: 'Norway' })).toBe(false)
    expect(areDistinctSites({ country: 'norway' }, { country: 'NORWAY' })).toBe(false)
  })

  it('declines to compare an ISO code against a spelled out country', () => {
    expect(areDistinctSites({ country: 'NO' }, { country: 'France' })).toBe(false)
  })

  it('requires both a different city and a different postcode', () => {
    expect(
      areDistinctSites(bergen, { city: 'Bergen kommune', postcode: '5003', country: 'Norway' }),
    ).toBe(false)
    expect(areDistinctSites(bergen, { city: 'Bergen', postcode: '5020', country: 'Norway' })).toBe(
      false,
    )
    expect(areDistinctSites(bergen, { city: 'Oslo', postcode: '0150', country: 'Norway' })).toBe(
      true,
    )
  })

  it('ignores postcode formatting', () => {
    expect(
      areDistinctSites(
        { city: 'Aberdeen', postcode: 'AB10 1XY', country: 'UK' },
        { city: 'aberdeen', postcode: 'ab101xy', country: 'UK' },
      ),
    ).toBe(false)
  })

  it('merges when a comparison field is missing on one side', () => {
    expect(areDistinctSites({ city: 'Oslo' }, { city: 'Bergen', postcode: '5003' })).toBe(false)
    expect(areDistinctSites({ postcode: '0150' }, { postcode: '5003' })).toBe(false)
  })
})

describe('disambiguateByAddress', () => {
  const oslo: CustomerAddress = { city: 'Oslo', postcode: '0150', country: 'Norway' }
  const bergen: CustomerAddress = { city: 'Bergen', postcode: '5003', country: 'Norway' }
  const aberdeen: CustomerAddress = { city: 'Aberdeen', postcode: 'AB10 1XY', country: 'UK' }

  it('leaves the key alone for the reference site', () => {
    expect(disambiguateByAddress('company:acme', oslo, oslo)).toBe('company:acme')
  })

  it('leaves the key alone when either address is missing', () => {
    expect(disambiguateByAddress('company:acme', null, oslo)).toBe('company:acme')
    expect(disambiguateByAddress('company:acme', oslo, undefined)).toBe('company:acme')
  })

  it('suffixes a clearly different site', () => {
    expect(disambiguateByAddress('company:acme', bergen, oslo)).toBe('company:acme#norway-bergen')
    expect(disambiguateByAddress('company:acme', aberdeen, oslo)).toBe(
      'company:acme#united-kingdom-aberdeen',
    )
  })

  it('derives the suffix from the address alone, not from the reference', () => {
    expect(disambiguateByAddress('company:acme', bergen, oslo)).toBe(
      disambiguateByAddress('company:acme', bergen, aberdeen),
    )
  })

  it('is deterministic across calls', () => {
    const first = disambiguateByAddress('company:acme', bergen, oslo)
    const second = disambiguateByAddress('company:acme', { ...bergen }, { ...oslo })

    expect(first).toBe(second)
  })

  it('prefers merging when the addresses are only partially known', () => {
    expect(disambiguateByAddress('company:acme', { city: 'Bergen' }, { city: 'Oslo' })).toBe(
      'company:acme',
    )
    expect(disambiguateByAddress('company:acme', { street: 'Dock 4' }, { street: 'Dock 9' })).toBe(
      'company:acme',
    )
  })
})
