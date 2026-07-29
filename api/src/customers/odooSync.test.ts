import { describe, expect, it } from 'vitest'
import { deriveAccount } from './grouping.js'
import {
  ADDRESS_COLUMN_MAP,
  ORDER_COLUMN_MAP,
  PARTNER_COLUMN_MAP,
  PARTNER_FIELDS,
  accountInputFromRow,
  chunk,
  computeCustomerAggregates,
  emptyAggregates,
  fillMissingColumns,
  intersectFields,
  many2oneErpId,
  many2oneId,
  many2oneName,
  mapOrderLine,
  mapRecord,
  mappedColumns,
  odooBool,
  odooDateTime,
  odooNumber,
  odooText,
  parseFieldsGet,
  resolveStickyAccountId,
  summariseOrderLines,
  toOdooDateTime,
  unwrapMany2One,
} from './odooSync.js'
import type { OdooRecord, PartialRow } from './odooSync.js'

/** Every field a modern Odoo would report for res.partner. */
const FULL_PARTNER_FIELDS = new Set(PARTNER_FIELDS)

// ═══════════════════════════════════════════════════════════════════════════════
// MANY2ONE UNWRAPPING
// ═══════════════════════════════════════════════════════════════════════════════

describe('unwrapMany2One', () => {
  it('splits the [id, "Display Name"] pair Odoo actually sends', () => {
    expect(unwrapMany2One([42, 'Norway'])).toEqual({ id: 42, name: 'Norway' })
  })

  it('treats false as unset, which is how Odoo spells a null many2one', () => {
    expect(unwrapMany2One(false)).toEqual({ id: null, name: null })
  })

  it('treats null and undefined as unset', () => {
    expect(unwrapMany2One(null)).toEqual({ id: null, name: null })
    expect(unwrapMany2One(undefined)).toEqual({ id: null, name: null })
  })

  it('accepts a bare numeric id with no display name attached', () => {
    expect(unwrapMany2One(7)).toEqual({ id: 7, name: null })
    expect(unwrapMany2One('7')).toEqual({ id: 7, name: null })
  })

  it('accepts a one-element array', () => {
    expect(unwrapMany2One([7])).toEqual({ id: 7, name: null })
  })

  it('reads a bare non-numeric string as a name with no id', () => {
    expect(unwrapMany2One('Norway')).toEqual({ id: null, name: 'Norway' })
  })

  it('trims the display name and collapses an empty one to null', () => {
    expect(unwrapMany2One([42, '  Norway  '])).toEqual({ id: 42, name: 'Norway' })
    expect(unwrapMany2One([42, ''])).toEqual({ id: 42, name: null })
    expect(unwrapMany2One([42, false])).toEqual({ id: 42, name: null })
  })

  it('does not invent an id from a non-integer first element', () => {
    expect(unwrapMany2One([false, 'Norway'])).toEqual({ id: null, name: 'Norway' })
    expect(unwrapMany2One([1.5, 'Norway']).id).toBeNull()
  })

  it('returns nulls for shapes it does not understand', () => {
    expect(unwrapMany2One({ id: 1 })).toEqual({ id: null, name: null })
    expect(unwrapMany2One([])).toEqual({ id: null, name: null })
  })

  it('exposes the halves individually, with the id stringified for erp_id columns', () => {
    expect(many2oneId([42, 'Norway'])).toBe(42)
    expect(many2oneName([42, 'Norway'])).toBe('Norway')
    expect(many2oneErpId([42, 'Norway'])).toBe('42')
    expect(many2oneErpId(false)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// SCALAR COERCION
// ═══════════════════════════════════════════════════════════════════════════════

describe('scalar coercion', () => {
  it('collapses Odoo\'s false-means-empty convention to null', () => {
    expect(odooText(false)).toBeNull()
    expect(odooText('')).toBeNull()
    expect(odooText('   ')).toBeNull()
    expect(odooText('  hello  ')).toBe('hello')
    expect(odooNumber(false)).toBeNull()
    expect(odooNumber(0)).toBe(0)
    expect(odooNumber('12.5')).toBe(12.5)
    expect(odooNumber('not a number')).toBeNull()
  })

  it('only reads a literal true as true', () => {
    expect(odooBool(true)).toBe(true)
    expect(odooBool(false)).toBe(false)
    expect(odooBool(1)).toBe(false)
    expect(odooBool(undefined)).toBe(false)
  })

  it('reads naive Odoo datetimes as UTC rather than server-local time', () => {
    expect(odooDateTime('2024-03-01 12:30:00')).toBe('2024-03-01T12:30:00.000Z')
    expect(odooDateTime('2024-03-01')).toBe('2024-03-01T00:00:00.000Z')
    expect(odooDateTime('2024-03-01 12:30')).toBe('2024-03-01T12:30:00.000Z')
    expect(odooDateTime(false)).toBeNull()
    expect(odooDateTime('nonsense')).toBeNull()
  })

  it('formats a Date back into the naive form an Odoo domain expects', () => {
    expect(toOdooDateTime(new Date('2024-03-01T12:30:00.000Z'))).toBe('2024-03-01 12:30:00')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD INTERSECTION AGAINST fields_get
// ═══════════════════════════════════════════════════════════════════════════════

describe('field intersection against fields_get', () => {
  it('reads the field names out of a fields_get response', () => {
    const raw = {
      name: { type: 'char' },
      email: { type: 'char' },
      customer_rank: { type: 'integer' },
    }
    expect(parseFieldsGet(raw)).toEqual(new Set(['name', 'email', 'customer_rank']))
  })

  it('returns an empty set for a response that is not a field dictionary', () => {
    expect(parseFieldsGet(null)).toEqual(new Set())
    expect(parseFieldsGet(false)).toEqual(new Set())
    expect(parseFieldsGet([])).toEqual(new Set())
    expect(parseFieldsGet('boom')).toEqual(new Set())
  })

  it('keeps only fields the model has and reports the rest', () => {
    const available = new Set(['id', 'name', 'email', 'street'])
    const result = intersectFields(['id', 'name', 'industry_id', 'email', 'vat'], available)

    expect(result.selected).toEqual(['id', 'name', 'email'])
    expect(result.unavailable).toEqual(['industry_id', 'vat'])
  })

  it('preserves the requested order and drops duplicates', () => {
    const result = intersectFields(['name', 'name', 'email'], new Set(['name', 'email']))
    expect(result.selected).toEqual(['name', 'email'])
  })

  it('reports everything as unavailable when fields_get came back empty', () => {
    const result = intersectFields(['name', 'email'], new Set())
    expect(result.selected).toEqual([])
    expect(result.unavailable).toEqual(['name', 'email'])
  })

  it('never asks a stock Odoo for a field it does not have', () => {
    // industry_id needs a module that is not always installed; carrier_id needs
    // the delivery addon. Neither may reach a search_read.
    const stockPartner = new Set(['id', 'name', 'email', 'customer_rank'])
    const plan = intersectFields(PARTNER_FIELDS, stockPartner)

    expect(plan.selected).toEqual(['id', 'name', 'email', 'customer_rank'])
    expect(plan.unavailable).toContain('industry_id')
    expect(plan.unavailable).toContain('parent_id')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ROW MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const FULL_PARTNER: OdooRecord = {
  id: 11,
  name: 'Acme Subsea Ltd',
  email: 'ops@acme-subsea.com',
  phone: '+47 555 0100',
  street: 'Havnegata 1',
  street2: false,
  city: 'Bergen',
  zip: '5003',
  state_id: [12, 'Vestland'],
  country_id: [166, 'Norway'],
  website: 'https://acme-subsea.com',
  vat: 'NO123456789',
  is_company: true,
  parent_id: false,
  function: false,
  industry_id: [4, 'Marine'],
  comment: 'Prefers pallet delivery',
  customer_rank: 3,
}

describe('mapRecord', () => {
  it('maps a full res.partner onto customer columns', () => {
    const row = mapRecord(FULL_PARTNER, FULL_PARTNER_FIELDS, PARTNER_COLUMN_MAP)

    expect(row).toMatchObject({
      name: 'Acme Subsea Ltd',
      email: 'ops@acme-subsea.com',
      city: 'Bergen',
      // Both of these arrive as [id, "Name"] and must land as the name.
      state: 'Vestland',
      country: 'Norway',
      industry: 'Marine',
      is_company: true,
      street2: null,
      job_title: null,
      company: null,
      notes: 'Prefers pallet delivery',
    })
  })

  it('omits the column entirely when the field is not on this Odoo', () => {
    const noIndustry = new Set([...FULL_PARTNER_FIELDS].filter((f) => f !== 'industry_id'))
    const row = mapRecord(FULL_PARTNER, noIndustry, PARTNER_COLUMN_MAP)

    // Absent, not null: null would mean "Odoo says this customer has no
    // industry", which is a different and destructive claim.
    expect('industry' in row).toBe(false)
  })

  it('omits the column when the record itself did not carry the field', () => {
    const partial: OdooRecord = { id: 11, name: 'Acme' }
    const row = mapRecord(partial, FULL_PARTNER_FIELDS, PARTNER_COLUMN_MAP)

    expect(row).toEqual({ name: 'Acme' })
  })

  it('maps a shipping partner onto address columns', () => {
    const row = mapRecord(FULL_PARTNER, FULL_PARTNER_FIELDS, ADDRESS_COLUMN_MAP)
    expect(row).toEqual({
      name: 'Acme Subsea Ltd',
      street: 'Havnegata 1',
      street2: null,
      city: 'Bergen',
      zip: '5003',
      state: 'Vestland',
      country: 'Norway',
    })
  })

  it('maps a sale.order, unwrapping its many2one payment term and carrier', () => {
    const order: OdooRecord = {
      id: 900,
      date_order: '2024-05-06 09:00:00',
      state: 'sale',
      amount_total: 1200.5,
      amount_untaxed: 1000,
      amount_tax: 200.5,
      payment_term_id: [3, '30 Days'],
      carrier_id: [8, 'DHL Express'],
      note: false,
      write_date: '2024-05-07 10:00:00',
    }
    const available = new Set(ORDER_COLUMN_MAP.map((m) => m.field))
    const row = mapRecord(order, available, ORDER_COLUMN_MAP)

    expect(row).toEqual({
      order_date: '2024-05-06T09:00:00.000Z',
      status: 'sale',
      total: 1200.5,
      net: 1000,
      tax: 200.5,
      payment_term: '30 Days',
      shipping_method: 'DHL Express',
      note: null,
      odoo_write_date: '2024-05-07T10:00:00.000Z',
    })
  })

  it('lists exactly the columns a run will write', () => {
    const noIndustry = new Set([...FULL_PARTNER_FIELDS].filter((f) => f !== 'industry_id'))
    const columns = mappedColumns(noIndustry, PARTNER_COLUMN_MAP)

    expect(columns).toContain('name')
    expect(columns).not.toContain('industry')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// "A MISSING FIELD MUST NOT BLANK A STORED VALUE"
// ═══════════════════════════════════════════════════════════════════════════════

describe('fillMissingColumns', () => {
  const columns = ['name', 'email', 'industry', 'website']

  it('writes the stored value back when Odoo said nothing about the field', () => {
    const stored: PartialRow = {
      name: 'Acme',
      email: 'old@acme.com',
      industry: 'Marine Robotics',
      website: 'https://acme.example',
    }
    const filled = fillMissingColumns({ name: 'Acme', email: 'new@acme.com' }, columns, stored)

    expect(filled.email).toBe('new@acme.com')
    // The whole point: an industry that cost effort to record is not wiped
    // just because this Odoo has no industry_id field.
    expect(filled.industry).toBe('Marine Robotics')
    expect(filled.website).toBe('https://acme.example')
  })

  it('still honours an explicit null, which means Odoo cleared the value', () => {
    const stored: PartialRow = { name: 'Acme', email: 'old@acme.com' }
    const filled = fillMissingColumns({ name: 'Acme', email: null }, columns, stored)

    expect(filled.email).toBeNull()
  })

  it('nulls only the columns a brand-new row has nothing to preserve for', () => {
    const filled = fillMissingColumns({ name: 'Acme' }, columns, undefined)
    expect(filled).toEqual({ name: 'Acme', email: null, industry: null, website: null })
  })

  it('produces the same key set for every row, as a bulk upsert requires', () => {
    const a = fillMissingColumns({ name: 'A' }, columns, { industry: 'Aquaculture' })
    const b = fillMissingColumns({ name: 'B', email: 'b@b.com' }, columns, null)

    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
  })

  it('does not mutate the row it was handed', () => {
    const row: PartialRow = { name: 'Acme' }
    fillMissingColumns(row, columns, { industry: 'Marine' })
    expect(row).toEqual({ name: 'Acme' })
  })

  it('end to end: a field absent from fields_get is left out of the write entirely', () => {
    // First of the two ways a stored value survives: the column never enters
    // the run's column set, so it is absent from every payload and Postgres
    // never touches it.
    const stored: PartialRow = { name: 'Acme Subsea Ltd', industry: 'Offshore Wind' }
    const withoutIndustry = new Set([...FULL_PARTNER_FIELDS].filter((f) => f !== 'industry_id'))
    const columns = mappedColumns(withoutIndustry, PARTNER_COLUMN_MAP)

    const mapped = mapRecord(FULL_PARTNER, withoutIndustry, PARTNER_COLUMN_MAP)
    const filled = fillMissingColumns(mapped, columns, stored)

    expect(columns).not.toContain('industry')
    expect('industry' in filled).toBe(false)
    expect(filled.city).toBe('Bergen')
  })

  it('end to end: one record omitting a field does not blank it for that customer', () => {
    // Second way: the column IS in the run's column set because other records
    // have it, so it must appear in this record's payload too - carrying the
    // stored value rather than a null.
    const stored: PartialRow = { name: 'Acme Subsea Ltd', industry: 'Offshore Wind' }
    const columns = mappedColumns(FULL_PARTNER_FIELDS, PARTNER_COLUMN_MAP)
    const quietRecord: OdooRecord = { id: 11, name: 'Acme Subsea Ltd' }

    const mapped = mapRecord(quietRecord, FULL_PARTNER_FIELDS, PARTNER_COLUMN_MAP)
    const filled = fillMissingColumns(mapped, columns, stored)

    expect(columns).toContain('industry')
    expect(filled.industry).toBe('Offshore Wind')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// STICKY account_id
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveStickyAccountId', () => {
  const EXISTING = '11111111-1111-1111-1111-111111111111'
  const DERIVED = '22222222-2222-2222-2222-222222222222'

  it('keeps an account the customer already has, even when derivation disagrees', () => {
    // This is the rule that stops a rename in Odoo from orphaning research
    // that has already been paid for.
    expect(resolveStickyAccountId(EXISTING, DERIVED)).toBe(EXISTING)
  })

  it('uses the derived account only when the customer has never been grouped', () => {
    expect(resolveStickyAccountId(null, DERIVED)).toBe(DERIVED)
    expect(resolveStickyAccountId(undefined, DERIVED)).toBe(DERIVED)
    expect(resolveStickyAccountId('', DERIVED)).toBe(DERIVED)
  })

  it('leaves the link null when there is nothing on either side', () => {
    expect(resolveStickyAccountId(null, null)).toBeNull()
    expect(resolveStickyAccountId(null, undefined)).toBeNull()
  })

  it('a company renaming itself in Odoo keeps its original account', () => {
    // "Acme Ltd" -> "Acme Limited" normalises to the same key anyway, but even
    // a rename that does change the key must not relink an existing customer.
    const before = deriveAccount({ id: '11', name: 'Acme Ltd', isCompany: true })
    const after = deriveAccount({ id: '11', name: 'Globex Corporation', isCompany: true })
    expect(after.accountKey).not.toBe(before.accountKey)

    const accountIdByKey = new Map([
      [before.accountKey, EXISTING],
      [after.accountKey, DERIVED],
    ])
    const resolved = resolveStickyAccountId(EXISTING, accountIdByKey.get(after.accountKey))

    expect(resolved).toBe(EXISTING)
  })
})

describe('accountInputFromRow', () => {
  it('feeds deriveAccount from the mapped row, so field availability carries through', () => {
    const row = mapRecord(FULL_PARTNER, FULL_PARTNER_FIELDS, PARTNER_COLUMN_MAP)
    const input = accountInputFromRow('11', row)

    expect(input).toEqual({
      id: '11',
      name: 'Acme Subsea Ltd',
      email: 'ops@acme-subsea.com',
      company: null,
      isCompany: true,
    })
    expect(deriveAccount(input).accountKey).toBe('company:acme subsea')
  })

  it('reads a contact as belonging to its parent company', () => {
    const contact: OdooRecord = {
      ...FULL_PARTNER,
      id: 12,
      name: 'Jo Diver',
      is_company: false,
      parent_id: [11, 'Acme Subsea Ltd'],
      email: 'jo@acme-subsea.com',
    }
    const row = mapRecord(contact, FULL_PARTNER_FIELDS, PARTNER_COLUMN_MAP)
    const account = deriveAccount(accountInputFromRow('12', row))

    // Same account as the company above, so the pair is researched once.
    expect(account.accountKey).toBe('company:acme subsea')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER LINES
// ═══════════════════════════════════════════════════════════════════════════════

describe('mapOrderLine', () => {
  const available = new Set([
    'name',
    'product_id',
    'product_uom_qty',
    'price_unit',
    'price_subtotal',
    'discount',
  ])

  it('maps a line, unwrapping product_id into both a name and an erp id', () => {
    const line: OdooRecord = {
      id: 5,
      order_id: [900, 'SO0900'],
      name: '[ROV-1] Observation ROV',
      product_id: [77, 'Observation ROV'],
      product_uom_qty: 2,
      price_unit: 4500,
      price_subtotal: 8100,
      discount: 10,
    }

    expect(mapOrderLine(line, available)).toEqual({
      product_name: 'Observation ROV',
      product_erp_id: '77',
      quantity: 2,
      price_unit: 4500,
      price_subtotal: 8100,
      discount: 10,
    })
  })

  it('falls back to the line description for a line with no product', () => {
    const note: OdooRecord = {
      id: 6,
      product_id: false,
      name: 'Delivery scheduled for week 20',
      product_uom_qty: 0,
      price_unit: 0,
      price_subtotal: 0,
      discount: false,
    }
    const row = mapOrderLine(note, available)

    expect(row.product_name).toBe('Delivery scheduled for week 20')
    expect(row.product_erp_id).toBeNull()
    expect(row.discount).toBeNull()
  })

  it('nulls the columns whose fields this Odoo does not expose', () => {
    const row = mapOrderLine({ id: 7, name: 'Widget' }, new Set(['name']))
    expect(row).toEqual({
      product_name: 'Widget',
      product_erp_id: null,
      quantity: null,
      price_unit: null,
      price_subtotal: null,
      discount: null,
    })
  })
})

describe('summariseOrderLines', () => {
  it('counts the lines and recovers the order-level discount', () => {
    const summary = summariseOrderLines([
      {
        product_name: 'A',
        product_erp_id: '1',
        quantity: 2,
        price_unit: 100,
        price_subtotal: 180,
        discount: 10,
      },
      {
        product_name: 'B',
        product_erp_id: '2',
        quantity: 1,
        price_unit: 50,
        price_subtotal: 50,
        discount: 0,
      },
    ])

    expect(summary.itemsCount).toBe(2)
    expect(summary.discountTotal).toBe(20)
  })

  it('never reports a negative discount when tax rounding runs the other way', () => {
    const summary = summariseOrderLines([
      {
        product_name: 'A',
        product_erp_id: '1',
        quantity: 1,
        price_unit: 100,
        price_subtotal: 110,
        discount: 0,
      },
    ])
    expect(summary.discountTotal).toBe(0)
  })

  it('handles an order with no lines', () => {
    expect(summariseOrderLines([])).toEqual({ itemsCount: 0, discountTotal: 0 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATES
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeCustomerAggregates', () => {
  const CUSTOMER_A = 'aaaaaaaa-0000-0000-0000-000000000000'
  const CUSTOMER_B = 'bbbbbbbb-0000-0000-0000-000000000000'

  it('sums spend and items, and finds the order-date range', () => {
    const result = computeCustomerAggregates([
      {
        customer_id: CUSTOMER_A,
        order_date: '2023-01-05T00:00:00.000Z',
        total: 100.25,
        items_count: 2,
        status: 'sale',
      },
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-06-01T00:00:00.000Z',
        total: 400,
        items_count: 3,
        status: 'done',
      },
      {
        customer_id: CUSTOMER_B,
        order_date: '2024-02-02T00:00:00.000Z',
        total: 50,
        items_count: 1,
        status: 'sale',
      },
    ])

    expect(result.get(CUSTOMER_A)).toEqual({
      total_spent: 500.25,
      order_count: 2,
      item_count: 5,
      first_order_date: '2023-01-05T00:00:00.000Z',
      last_order_date: '2024-06-01T00:00:00.000Z',
    })
    expect(result.get(CUSTOMER_B)?.order_count).toBe(1)
  })

  it('leaves cancelled orders out of the totals entirely', () => {
    const result = computeCustomerAggregates([
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-01-01T00:00:00.000Z',
        total: 100,
        items_count: 1,
        status: 'sale',
      },
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-09-09T00:00:00.000Z',
        total: 999,
        items_count: 9,
        status: 'cancel',
      },
    ])

    expect(result.get(CUSTOMER_A)).toEqual({
      total_spent: 100,
      order_count: 1,
      item_count: 1,
      first_order_date: '2024-01-01T00:00:00.000Z',
      last_order_date: '2024-01-01T00:00:00.000Z',
    })
  })

  it('leaves unconfirmed quotations out of spend', () => {
    // draft and sent are quotations in Odoo, not revenue. Counting them would
    // also skew enrichment priority toward customers who were quoted a big job
    // and never bought.
    const result = computeCustomerAggregates([
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-01-01T00:00:00.000Z',
        total: 100,
        items_count: 1,
        status: 'sale',
      },
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-02-02T00:00:00.000Z',
        total: 5000,
        items_count: 4,
        status: 'draft',
      },
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-03-03T00:00:00.000Z',
        total: 7000,
        items_count: 7,
        status: 'sent',
      },
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-04-04T00:00:00.000Z',
        total: 250,
        items_count: 2,
        status: 'done',
      },
    ])

    expect(result.get(CUSTOMER_A)).toEqual({
      total_spent: 350,
      order_count: 2,
      item_count: 3,
      first_order_date: '2024-01-01T00:00:00.000Z',
      last_order_date: '2024-04-04T00:00:00.000Z',
    })
  })

  it('accepts the strings PostgREST can hand back for NUMERIC columns', () => {
    const result = computeCustomerAggregates([
      {
        customer_id: CUSTOMER_A,
        order_date: '2024-01-01T00:00:00.000Z',
        total: '19.99',
        items_count: '3',
        status: 'sale',
      },
    ])

    expect(result.get(CUSTOMER_A)?.total_spent).toBe(19.99)
    expect(result.get(CUSTOMER_A)?.item_count).toBe(3)
  })

  it('rounds float drift back to the two decimals the column stores', () => {
    const result = computeCustomerAggregates(
      [0.1, 0.2].map((total) => ({
        customer_id: CUSTOMER_A,
        order_date: '2024-01-01T00:00:00.000Z',
        total,
        items_count: 0,
        status: 'sale',
      })),
    )
    expect(result.get(CUSTOMER_A)?.total_spent).toBe(0.3)
  })

  it('counts an order with no date but does not invent a range', () => {
    const result = computeCustomerAggregates([
      { customer_id: CUSTOMER_A, order_date: null, total: 10, items_count: 1, status: 'sale' },
    ])

    expect(result.get(CUSTOMER_A)).toEqual({
      total_spent: 10,
      order_count: 1,
      item_count: 1,
      first_order_date: null,
      last_order_date: null,
    })
  })

  it('zeroes a customer whose orders all went away', () => {
    expect(emptyAggregates()).toEqual({
      total_spent: 0,
      order_count: 0,
      item_count: 0,
      first_order_date: null,
      last_order_date: null,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// BATCHING
// ═══════════════════════════════════════════════════════════════════════════════

describe('chunk', () => {
  it('splits into full batches plus a remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns nothing for an empty list, so callers issue no write at all', () => {
    expect(chunk([], 500)).toEqual([])
  })

  it('keeps a short list in one batch', () => {
    expect(chunk([1, 2], 500)).toEqual([[1, 2]])
  })

  it('rejects a size that would loop forever', () => {
    expect(() => chunk([1], 0)).toThrow(/at least 1/)
  })
})
