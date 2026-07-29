import { describe, expect, it } from 'vitest'

import {
  INDIVIDUAL_CONTEXT_FIELDS,
  buildEnrichmentPayload,
  renderEnrichmentPrompt,
} from './redaction.js'
import type { EnrichmentInput } from './redaction.js'

const company: EnrichmentInput = {
  accountKey: 'company:acme subsea',
  kind: 'company',
  displayName: 'Acme Subsea Ltd',
  companyName: 'Acme Subsea Ltd',
  contactName: 'Jonas Berg',
  email: 'jonas.berg@acme-subsea.com',
  phone: '+44 1224 555 010',
  emailDomain: 'acme-subsea.com',
  jobTitle: 'Head of Procurement',
  industry: 'Offshore energy services',
  website: 'https://acme-subsea.example',
  vatNumber: 'GB123456789',
  street: '12 Harbour Road',
  street2: 'Unit 4',
  city: 'Aberdeen',
  postcode: 'AB10 1XY',
  state: 'Aberdeenshire',
  country: 'United Kingdom',
  internalNotes: 'Renewing the survey fleet in Q3',
  productNames: ['ROV Thruster T200', 'Tether Reel'],
  orderCount: 12,
  totalSpend: 184500,
  currency: 'GBP',
}

const individual: EnrichmentInput = {
  accountKey: 'individual:hanna.iversen@gmail.com',
  kind: 'individual',
  displayName: 'Hanna Iversen',
  companyName: null,
  contactName: 'Hanna Iversen',
  email: 'hanna.iversen@gmail.com',
  phone: '+47 900 12 345',
  emailDomain: 'gmail.com',
  jobTitle: 'Marine biology student',
  industry: 'Recreational diving',
  website: 'https://hannaiversen.example',
  vatNumber: 'NO999888777MVA',
  street: 'Storgata 14B',
  street2: 'Leilighet 3',
  city: 'Bergen',
  postcode: '5003',
  state: 'Vestland',
  country: 'Norway',
  internalNotes: 'Paid by personal card, asked about tether warranty',
  productNames: ['BlueROV2 Heavy', 'Ping Sonar'],
  orderCount: 3,
  totalSpend: 8450,
  currency: 'NOK',
}

describe('buildEnrichmentPayload - company accounts', () => {
  it('keeps the full context and allows web search', () => {
    const payload = buildEnrichmentPayload(company)

    expect(payload.webSearchAllowed).toBe(true)
    expect(payload.kind).toBe('company')
    expect(payload.context).toMatchObject({
      companyName: 'Acme Subsea Ltd',
      emailDomain: 'acme-subsea.com',
      website: 'https://acme-subsea.example',
      vatNumber: 'GB123456789',
      jobTitle: 'Head of Procurement',
      industry: 'Offshore energy services',
      street: '12 Harbour Road',
      street2: 'Unit 4',
      city: 'Aberdeen',
      postcode: 'AB10 1XY',
      state: 'Aberdeenshire',
      country: 'United Kingdom',
      internalNotes: 'Renewing the survey fleet in Q3',
      productsOrdered: ['ROV Thruster T200', 'Tether Reel'],
      orderCount: 12,
      totalSpend: 184500,
      currency: 'GBP',
    })
  })

  it('renders the street address into the model text block', () => {
    const rendered = renderEnrichmentPrompt(buildEnrichmentPayload(company))

    expect(rendered).toContain('Street: 12 Harbour Road')
    expect(rendered).toContain('Street (line 2): Unit 4')
    expect(rendered).toContain('City: Aberdeen')
    expect(rendered).toContain('Postcode: AB10 1XY')
    expect(rendered).toContain('Country: United Kingdom')
    expect(rendered).toContain('Total spend: 184500 GBP')
    expect(rendered).toContain('Products ordered: ROV Thruster T200, Tether Reel')
    expect(rendered).toContain('Web search: permitted')
  })

  it('withholds the contact person even for a company', () => {
    const payload = buildEnrichmentPayload(company)
    const rendered = renderEnrichmentPrompt(payload)

    expect(payload.redactedFields).toEqual(
      expect.arrayContaining(['contactName', 'email', 'phone']),
    )
    expect(rendered).not.toContain('Jonas Berg')
    expect(rendered).not.toContain('jonas.berg@acme-subsea.com')
    expect(rendered).not.toContain('+44 1224 555 010')
  })

  it('falls back to the display name when no company name is recorded', () => {
    const payload = buildEnrichmentPayload({
      accountKey: 'company:oceaneering.com',
      kind: 'company',
      displayName: 'oceaneering.com',
    })

    expect(payload.context.companyName).toBe('oceaneering.com')
  })
})

describe('buildEnrichmentPayload - individual accounts', () => {
  it('refuses web search', () => {
    expect(buildEnrichmentPayload(individual).webSearchAllowed).toBe(false)
  })

  it('keeps only country, region and order history', () => {
    const { context } = buildEnrichmentPayload(individual)

    expect(context).toEqual({
      state: 'Vestland',
      country: 'Norway',
      productsOrdered: ['BlueROV2 Heavy', 'Ping Sonar'],
      orderCount: 3,
      totalSpend: 8450,
      currency: 'NOK',
    })
  })

  it('exposes no context field outside the individual allow-list', () => {
    const { context } = buildEnrichmentPayload(individual)

    for (const key of Object.keys(context)) {
      expect(INDIVIDUAL_CONTEXT_FIELDS, key).toContain(key)
    }
  })

  it('drops every identifying field', () => {
    const { context } = buildEnrichmentPayload(individual)

    expect(context).not.toHaveProperty('street')
    expect(context).not.toHaveProperty('street2')
    expect(context).not.toHaveProperty('postcode')
    expect(context).not.toHaveProperty('city')
    expect(context).not.toHaveProperty('companyName')
    expect(context).not.toHaveProperty('emailDomain')
    expect(context).not.toHaveProperty('vatNumber')
    expect(context).not.toHaveProperty('website')
    expect(context).not.toHaveProperty('jobTitle')
    expect(context).not.toHaveProperty('internalNotes')
  })

  it('reports what it withheld', () => {
    const { redactedFields } = buildEnrichmentPayload(individual)

    expect(redactedFields).toEqual(
      expect.arrayContaining([
        'emailDomain',
        'website',
        'vatNumber',
        'jobTitle',
        'industry',
        'street',
        'street2',
        'city',
        'postcode',
        'internalNotes',
        'contactName',
        'email',
        'phone',
        'displayName',
      ]),
    )
  })

  // The regression test that actually matters: a fully populated private
  // person, serialised exactly as the model would receive it, must not leak a
  // single sensitive value.
  it('leaks none of the sensitive values into the serialized output', () => {
    const payload = buildEnrichmentPayload(individual)
    const rendered = renderEnrichmentPrompt(payload)
    const serializedContext = JSON.stringify(payload.context)

    const mustNotAppear = [
      'Hanna Iversen',
      'Hanna',
      'Iversen',
      'hanna.iversen@gmail.com',
      'gmail.com',
      '+47 900 12 345',
      '900 12 345',
      'Storgata 14B',
      'Storgata',
      'Leilighet 3',
      'Bergen',
      '5003',
      'NO999888777MVA',
      'Marine biology student',
      'Recreational diving',
      'hannaiversen.example',
      'Paid by personal card, asked about tether warranty',
      'personal card',
    ]

    for (const value of mustNotAppear) {
      expect(rendered, `rendered prompt leaked ${value}`).not.toContain(value)
      expect(serializedContext, `context leaked ${value}`).not.toContain(value)
    }
  })

  it('still tells the model the region and the order history', () => {
    const rendered = renderEnrichmentPrompt(buildEnrichmentPayload(individual))

    expect(rendered).toContain('Account type: Individual (private person)')
    expect(rendered).toContain('State/Region: Vestland')
    expect(rendered).toContain('Country: Norway')
    expect(rendered).toContain('Products ordered: BlueROV2 Heavy, Ping Sonar')
    expect(rendered).toContain('Order count: 3')
    expect(rendered).toContain('Total spend: 8450 NOK')
    expect(rendered).toContain('Web search: not permitted')
  })

  it('never lets a company name reach an individual payload', () => {
    const payload = buildEnrichmentPayload({
      ...individual,
      companyName: 'Iversen Consulting',
    })

    expect(JSON.stringify(payload.context)).not.toContain('Iversen Consulting')
    expect(payload.redactedFields).toContain('companyName')
  })
})

describe('renderEnrichmentPrompt', () => {
  it('omits missing fields instead of emitting blanks', () => {
    const rendered = renderEnrichmentPrompt(
      buildEnrichmentPayload({
        accountKey: 'company:acme',
        kind: 'company',
        displayName: 'Acme',
        companyName: 'Acme',
        website: '',
        vatNumber: '   ',
        street: null,
        city: undefined,
        internalNotes: '\n  \t ',
        productNames: [],
        orderCount: null,
        totalSpend: undefined,
      }),
    )

    expect(rendered).not.toContain('undefined')
    expect(rendered).not.toContain('null')
    expect(rendered).not.toMatch(/:\s*$/m)
    expect(rendered).not.toContain('Website')
    expect(rendered).not.toContain('Products ordered')
    expect(rendered.split('\n')).toEqual([
      'Account type: Company',
      'Web search: permitted',
      'Company name: Acme',
    ])
  })

  it('keeps a zero order count, which is information rather than a blank', () => {
    const rendered = renderEnrichmentPrompt(
      buildEnrichmentPayload({
        accountKey: 'company:acme',
        kind: 'company',
        displayName: 'Acme',
        orderCount: 0,
        totalSpend: 0,
        currency: 'EUR',
      }),
    )

    expect(rendered).toContain('Order count: 0')
    expect(rendered).toContain('Total spend: 0 EUR')
  })

  it('drops a currency that has no spend to qualify', () => {
    const payload = buildEnrichmentPayload({
      accountKey: 'company:acme',
      kind: 'company',
      displayName: 'Acme',
      currency: 'EUR',
    })

    expect(payload.context).not.toHaveProperty('currency')
    expect(renderEnrichmentPrompt(payload)).not.toContain('EUR')
  })

  it('collapses whitespace and deduplicates product names', () => {
    const payload = buildEnrichmentPayload({
      accountKey: 'company:acme',
      kind: 'company',
      displayName: 'Acme',
      internalNotes: 'Line one\n\nLine  two',
      productNames: ['ROV  Thruster', 'ROV Thruster', '   ', 'Tether Reel'],
    })

    expect(payload.context.internalNotes).toBe('Line one Line two')
    expect(payload.context.productsOrdered).toEqual(['ROV Thruster', 'Tether Reel'])
  })

  it('never renders the correlation key, which embeds an email for individuals', () => {
    const rendered = renderEnrichmentPrompt(buildEnrichmentPayload(individual))

    expect(rendered).not.toContain('individual:hanna.iversen@gmail.com')
  })
})
