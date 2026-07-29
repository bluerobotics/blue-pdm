import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ODOO_ALLOWED_MODELS,
  ODOO_ALLOWED_ORM_METHODS,
  decodeXmlEntities,
  odooReadOnlyCall,
  parseXmlRpcResponse,
  parseXmlValue,
  valueToXml,
} from './odoo.js'

const URL_ = 'https://erp.example.com'
const DB = 'proddb'
const UID = 2
const KEY = 'secret-api-key'

/** Wrap a value payload in a full XML-RPC response envelope. */
function methodResponse(valueXml: string): string {
  return `<?xml version="1.0"?>
<methodResponse><params><param>${valueXml}</param></params></methodResponse>`
}

/** A fetch stub that returns a fixed XML body and records every call. */
function stubFetch(body = methodResponse('<value><array><data></data></array></value>')) {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    void input
    return new Response(body, { status: 200 })
  })
}

describe('odooReadOnlyCall', () => {
  let globalFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Any use of the ambient fetch would mean the guard leaked a real request.
    globalFetch = vi.fn(async () => {
      throw new Error('global fetch must not be called by these tests')
    })
    vi.stubGlobal('fetch', globalFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const writeParams = (ormMethod: string) => [
    DB,
    UID,
    KEY,
    'res.partner',
    ormMethod,
    [[1], { name: 'hacked' }],
  ]

  for (const ormMethod of ['write', 'create', 'unlink', 'copy']) {
    it(`rejects execute_kw with ORM method '${ormMethod}' before any network call`, async () => {
      const fetchImpl = stubFetch()

      await expect(
        odooReadOnlyCall(URL_, 'object', 'execute_kw', writeParams(ormMethod), {
          fetch: fetchImpl,
        }),
      ).rejects.toThrow(new RegExp(`^\\[SECURITY\\].*'${ormMethod}'`))

      expect(fetchImpl).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
    })
  }

  it("is not fooled by the transport method always being 'execute_kw'", async () => {
    const fetchImpl = stubFetch()
    // The `method` argument here is on every legitimate call too; only
    // params[4] distinguishes a read from a write.
    await expect(
      odooReadOnlyCall(
        URL_,
        'object',
        'execute_kw',
        [DB, UID, KEY, 'res.partner', 'write', [[1], { name: 'x' }]],
        { fetch: fetchImpl },
      ),
    ).rejects.toThrow(/\[SECURITY\]/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a model outside the allowlist even with an allowed ORM method', async () => {
    const fetchImpl = stubFetch()

    await expect(
      odooReadOnlyCall(
        URL_,
        'object',
        'execute_kw',
        [DB, UID, KEY, 'account.move', 'search_read', [[]]],
        { fetch: fetchImpl },
      ),
    ).rejects.toThrow(/\[SECURITY\].*'account\.move'/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a missing or non-string ORM method', async () => {
    const fetchImpl = stubFetch()

    await expect(
      odooReadOnlyCall(URL_, 'object', 'execute_kw', [DB, UID, KEY, 'res.partner'], {
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/\[SECURITY\].*params\[4\]/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects non-execute_kw transport methods that are not explicitly allowed', async () => {
    const fetchImpl = stubFetch()

    // The legacy `execute` entrypoint takes the ORM method at a different
    // index, so it is refused outright rather than parsed.
    await expect(
      odooReadOnlyCall(URL_, 'object', 'execute', [DB, UID, KEY, 'res.partner', 'unlink', [1]], {
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/\[SECURITY\].*'object\.execute'/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows search_read on res.partner and sends the request', async () => {
    const fetchImpl = stubFetch(
      methodResponse(
        '<value><array><data><value><struct>' +
          '<member><name>name</name><value><string>Smith &amp; Sons</string></value></member>' +
          '</struct></value></data></array></value>',
      ),
    )

    const result = await odooReadOnlyCall(
      URL_,
      'object',
      'execute_kw',
      [DB, UID, KEY, 'res.partner', 'search_read', [[['is_company', '=', true]]], { limit: 10 }],
      { fetch: fetchImpl },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(`${URL_}/xmlrpc/2/object`)
    expect(result).toEqual([{ name: 'Smith & Sons' }])
  })

  it('allows read on res.partner', async () => {
    const fetchImpl = stubFetch(methodResponse('<value><array><data></data></array></value>'))

    await expect(
      odooReadOnlyCall(
        URL_,
        'object',
        'execute_kw',
        [DB, UID, KEY, 'res.partner', 'read', [[1, 2], ['name']]],
        { fetch: fetchImpl },
      ),
    ).resolves.toEqual([])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('allows the inherently read-only common.version and common.authenticate calls', async () => {
    const fetchImpl = stubFetch(methodResponse('<value><int>7</int></value>'))

    await expect(
      odooReadOnlyCall(URL_, 'common', 'version', [], { fetch: fetchImpl }),
    ).resolves.toBe(7)
    await expect(
      odooReadOnlyCall(URL_, 'common', 'authenticate', [DB, 'user', KEY, {}], {
        fetch: fetchImpl,
      }),
    ).resolves.toBe(7)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('exposes allowlists that contain no mutating operation', () => {
    for (const mutating of ['write', 'create', 'unlink', 'copy', 'name_create', 'load']) {
      expect(ODOO_ALLOWED_ORM_METHODS as readonly string[]).not.toContain(mutating)
    }
    expect(ODOO_ALLOWED_ORM_METHODS).toEqual([
      'search',
      'search_read',
      'search_count',
      'read',
      'fields_get',
      'check_access_rights',
    ])
    expect(ODOO_ALLOWED_MODELS).toEqual([
      'res.partner',
      'sale.order',
      'sale.order.line',
      'res.partner.category',
      'res.partner.industry',
    ])
  })
})

describe('decodeXmlEntities', () => {
  it('decodes the named entities', () => {
    expect(decodeXmlEntities('Smith &amp; Sons')).toBe('Smith & Sons')
    expect(decodeXmlEntities('&lt;tag&gt;')).toBe('<tag>')
    expect(decodeXmlEntities('&quot;quoted&quot;')).toBe('"quoted"')
    expect(decodeXmlEntities('it&apos;s')).toBe("it's")
  })

  it('decodes numeric entities, decimal and hex', () => {
    expect(decodeXmlEntities('it&#39;s')).toBe("it's")
    expect(decodeXmlEntities('it&#x27;s')).toBe("it's")
    expect(decodeXmlEntities('caf&#233;')).toBe('café')
    expect(decodeXmlEntities('&#x1F600;')).toBe('\u{1F600}')
  })

  it('does not double-decode: &amp;lt; becomes &lt; and not <', () => {
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;')
    expect(decodeXmlEntities('&amp;amp;')).toBe('&amp;')
    expect(decodeXmlEntities('&amp;#39;')).toBe('&#39;')
  })

  it('leaves unknown or malformed entities untouched', () => {
    expect(decodeXmlEntities('A &nbsp; B')).toBe('A &nbsp; B')
    expect(decodeXmlEntities('&constructor; &toString;')).toBe('&constructor; &toString;')
    expect(decodeXmlEntities('100% & rising')).toBe('100% & rising')
    expect(decodeXmlEntities('plain text')).toBe('plain text')
  })
})

describe('XML value parsing', () => {
  it('decodes entities in <string> values', () => {
    expect(parseXmlValue('<string>Smith &amp; Sons</string>')).toBe('Smith & Sons')
    expect(parseXmlValue('<string>Ben &amp; Jerry&#39;s</string>')).toBe("Ben & Jerry's")
  })

  it('decodes entities inside structs and arrays', () => {
    const xml =
      '<array><data>' +
      '<value><struct><member><name>name</name>' +
      '<value><string>R&amp;D Ltd</string></value></member></struct></value>' +
      '<value><string>&lt;script&gt;</string></value>' +
      '</data></array>'
    expect(parseXmlValue(xml)).toEqual([{ name: 'R&D Ltd' }, '<script>'])
  })

  it('decodes entities in fault messages', () => {
    const xml =
      '<?xml version="1.0"?><methodResponse><fault><value><struct>' +
      '<member><name>faultString</name><value><string>Object res.partner &amp; friends</string></value></member>' +
      '</struct></value></fault></methodResponse>'
    expect(() => parseXmlRpcResponse(xml)).toThrow('Odoo fault: Object res.partner & friends')
  })

  it('still parses non-string scalars unchanged', () => {
    expect(parseXmlValue('<int>42</int>')).toBe(42)
    expect(parseXmlValue('<boolean>1</boolean>')).toBe(true)
    expect(parseXmlValue('<double>1.5</double>')).toBe(1.5)
  })
})

describe('valueToXml / parse round trip', () => {
  const cases = [
    'Smith & Sons',
    'R&D <Group> "Alpha"',
    "Ben & Jerry's",
    '&lt;',
    '&amp;lt;',
    '100% & rising',
    'plain name',
    'café & crème',
  ]

  for (const original of cases) {
    it(`round trips ${JSON.stringify(original)}`, () => {
      expect(parseXmlRpcResponse(methodResponse(valueToXml(original)))).toBe(original)
    })
  }

  it('round trips a struct of company names', () => {
    const record = { name: 'Smith & Sons', ref: '<A&B>' }
    expect(parseXmlRpcResponse(methodResponse(valueToXml(record)))).toEqual(record)
  })
})
