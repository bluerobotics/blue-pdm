/**
 * Two answers that used to look identical, and the two ways of confusing them.
 *
 * Reading "could not enumerate" as "has none" is finding B1: the plan degrades to the document's
 * own property bag and the user is told the write was confirmed. Reading "has none" as "could not
 * enumerate" is the opposite mistake and no smaller - it refuses to write to every drawing in the
 * vault, because a drawing legitimately has no configurations.
 *
 * The service only began distinguishing them in 1.20.0. Before that no caller here could have been
 * right, which is worth remembering when reading the tests that assert on `errorCode`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDocumentConfigurations } from './configurationRead'

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

interface ConfigurationReply {
  success: boolean
  data?: { configurations?: unknown }
  error?: string
  errorCode?: string
}

function installService(getConfigurations: unknown): void {
  ;(globalThis as { window?: unknown }).window = {
    electronAPI: { solidworks: { getConfigurations } },
  }
}

function replying(reply: ConfigurationReply) {
  return vi.fn(async () => reply)
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('a document that has no configurations', () => {
  it('reads an empty list on a successful reply as an answer, not as a failure', async () => {
    // A drawing. `SolidWorksDocumentType.HasNoConfigurations` is why the service can say this
    // rather than failing, and treating it as a failure would refuse every drawing in the vault.
    installService(replying({ success: true, data: { configurations: [] } }))

    const read = await readDocumentConfigurations('C:/vault/BR-202020.slddrw')

    expect(read.ok).toBe(true)
    expect(read.ok && read.configurations).toEqual([])
  })
})

describe('a document whose configurations could not be listed', () => {
  it('refuses on the enumeration error code and says so', async () => {
    installService(
      replying({
        success: false,
        error: 'Could not enumerate configurations for BR-202020.sldprt: document is open',
        errorCode: 'CONFIGURATION_ENUMERATION_FAILED',
      }),
    )

    const read = await readDocumentConfigurations('C:/vault/BR-202020.sldprt')

    expect(read.ok).toBe(false)
    expect(read.ok === false && read.enumerationFailed).toBe(true)
    expect(read.ok === false && read.reason).toContain('document is open')
  })

  it('refuses on any other unsuccessful reply, without claiming enumeration failed', async () => {
    installService(replying({ success: false, error: 'Command timed out', errorCode: 'TIMEOUT' }))

    const read = await readDocumentConfigurations('C:/vault/BR-202020.sldprt')

    expect(read.ok).toBe(false)
    expect(read.ok === false && read.enumerationFailed).toBe(false)
    expect(read.ok === false && read.reason).toBe('Command timed out')
  })

  it('refuses when the service is not available at all', async () => {
    ;(globalThis as { window?: unknown }).window = { electronAPI: {} }

    const read = await readDocumentConfigurations('C:/vault/BR-202020.sldprt')

    expect(read.ok).toBe(false)
    expect(read.ok === false && read.reason).toContain('not available')
  })

  it('refuses when the call throws rather than replying', async () => {
    installService(
      vi.fn(async () => {
        throw new Error('the service pipe closed')
      }),
    )

    const read = await readDocumentConfigurations('C:/vault/BR-202020.sldprt')

    expect(read.ok).toBe(false)
    expect(read.ok === false && read.reason).toBe('the service pipe closed')
  })

  it('refuses a successful reply that carries no list, which is neither documented outcome', async () => {
    installService(replying({ success: true, data: {} }))

    const read = await readDocumentConfigurations('C:/vault/BR-202020.sldprt')

    expect(read.ok).toBe(false)
    expect(read.ok === false && read.reason).toContain('without a configuration list')
  })
})

describe('a document that has configurations', () => {
  it('carries the name, the active flag and the properties the tab is read from', async () => {
    installService(
      replying({
        success: true,
        data: {
          configurations: [
            { name: 'AS568-014', isActive: true, properties: { 'Tab Number': '014' } },
            { name: 'AS568-015', isActive: false, properties: {} },
          ],
        },
      }),
    )

    const read = await readDocumentConfigurations('C:/vault/BR-202020.sldprt')

    expect(read.ok).toBe(true)
    expect(read.ok && read.configurations).toEqual([
      { name: 'AS568-014', isActive: true, properties: { 'Tab Number': '014' } },
      { name: 'AS568-015', isActive: false, properties: {} },
    ])
  })
})
