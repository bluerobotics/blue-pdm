/**
 * The verified write, end to end against a stubbed service.
 *
 * Three things are worth pinning here. The read-back is one call however many configurations the
 * write touched, because that is what makes verification affordable enough to leave on. A write no
 * scope accepted skips the read-back entirely, because a stale value that happens to match would
 * otherwise verify a write that never happened. And an outcome is only rounded up to a single answer
 * when every address agrees - any disagreement is `partial`, so a caller looking at the outcome alone
 * cannot be told that 68 configurations succeeded because 66 of them did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { summarizeOutcome, writeMetadataWithVerification } from './writeMetadataToFile'
import type { VerifiedAddress } from './verifyWrite'

interface Service {
  setProperties: ReturnType<typeof vi.fn>
  setDocumentProperties: ReturnType<typeof vi.fn>
  getProperties: ReturnType<typeof vi.fn>
}

const PATH = 'C:\\vault\\ORING-BUNA-70A.SLDPRT'

let service: Service

function install(options: {
  writeSucceeds?: boolean | ((configuration?: string) => boolean)
  fileProperties?: Record<string, string>
  configurationProperties?: Record<string, Record<string, string>>
  readFails?: boolean
}): void {
  const decide = (configuration?: string): boolean => {
    if (typeof options.writeSucceeds === 'function') return options.writeSucceeds(configuration)
    return options.writeSucceeds !== false
  }

  service = {
    setProperties: vi.fn(async (_path: string, _props: unknown, configuration?: string) => ({
      success: decide(configuration),
      error: decide(configuration) ? undefined : 'the property is read-only',
    })),
    setDocumentProperties: vi.fn(async () => ({ success: true })),
    getProperties: vi.fn(async () => {
      if (options.readFails) return { success: false, error: 'the document is locked' }
      const configurationProperties = options.configurationProperties ?? {}
      return {
        success: true,
        data: {
          configurations: Object.keys(configurationProperties),
          fileProperties: options.fileProperties ?? {},
          configurationProperties,
        },
      }
    }),
  }

  // @ts-expect-error the test only needs the SolidWorks surface this module touches
  globalThis.window = { electronAPI: { solidworks: service } }
}

beforeEach(() => {
  install({ fileProperties: {} })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('confirming a write against the file', () => {
  it('verifies a value the read-back finds', async () => {
    install({ fileProperties: { Number: 'BR-202020' } })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          properties: { Number: 'BR-202020' },
          intents: [{ address: { scope: 'file', field: 'part_number' }, expected: 'BR-202020' }],
        },
      ],
    })

    expect(result.outcome).toBe('verified')
    expect(result.readBackMs).not.toBeNull()
  })

  it('fails a write the service reported as successful but the file did not take', async () => {
    // The bug this whole path exists for: the service reports the API call, not the file.
    install({ fileProperties: { Number: 'BR-101010' } })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          properties: { Number: 'BR-202020' },
          intents: [{ address: { scope: 'file', field: 'part_number' }, expected: 'BR-202020' }],
        },
      ],
    })

    expect(result.outcome).toBe('failed')
    expect(result.addresses[0].reason).toContain('BR-101010')
  })

  it('reads the file back once however many configurations were written', async () => {
    const configurations = Array.from({ length: 12 }, (_, index) => `Config-${index}`)
    install({
      configurationProperties: Object.fromEntries(
        configurations.map((name) => [name, { 'Tab Number': '001' }]),
      ),
    })

    await writeMetadataWithVerification({
      path: PATH,
      groups: configurations.map((configuration) => ({
        configuration,
        properties: { 'Tab Number': '001' },
        intents: [
          {
            address: { scope: 'configuration' as const, field: 'config_tab' as const, configuration },
            expected: '001',
          },
        ],
      })),
    })

    expect(service.setProperties).toHaveBeenCalledTimes(12)
    expect(service.getProperties).toHaveBeenCalledTimes(1)
  })
})

describe('when the read-back cannot happen', () => {
  it('records unverified rather than either of the other two answers', async () => {
    install({ readFails: true })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          properties: { Number: 'BR-202020' },
          intents: [{ address: { scope: 'file', field: 'part_number' }, expected: 'BR-202020' }],
        },
      ],
    })

    expect(result.outcome).toBe('unverified')
    expect(result.addresses[0].reason).toContain('locked')
  })

  it('does not read the file back when no scope accepted the write', async () => {
    install({ writeSucceeds: false })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          properties: { Number: 'BR-202020' },
          intents: [{ address: { scope: 'file', field: 'part_number' }, expected: 'BR-202020' }],
        },
      ],
    })

    expect(result.outcome).toBe('failed')
    expect(result.readBackMs).toBeNull()
    expect(service.getProperties).not.toHaveBeenCalled()
  })
})

describe('a write that landed in some scopes and not others', () => {
  it('reports partial and keeps the per-configuration detail', async () => {
    install({
      writeSucceeds: (configuration) => configuration !== 'AS568-015',
      configurationProperties: {
        'AS568-014': { 'Tab Number': '014' },
        'AS568-015': {},
      },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          configuration: 'AS568-014',
          properties: { 'Tab Number': '014' },
          intents: [
            {
              address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-014' },
              expected: '014',
            },
          ],
        },
        {
          configuration: 'AS568-015',
          properties: { 'Tab Number': '015' },
          intents: [
            {
              address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-015' },
              expected: '015',
            },
          ],
        },
      ],
    })

    expect(result.outcome).toBe('partial')
    expect(result.addresses.filter((entry) => entry.state === 'verified')).toHaveLength(1)
    expect(result.addresses.filter((entry) => entry.state === 'failed')).toHaveLength(1)
  })
})

describe('a group that names addresses but carries no properties', () => {
  // The group was skipped, so its intents counted towards "this write has something to do" and
  // reached neither the accepted nor the rejected list. Nothing recorded a verdict for them and
  // nothing reported them: the addresses simply vanished between the plan and the outcome. No plan
  // emits this shape, which is exactly why it would have gone unnoticed.

  it('records them unattempted rather than dropping them', async () => {
    install({ fileProperties: {} })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          properties: {},
          intents: [{ address: { scope: 'file', field: 'revision' }, expected: 'B' }],
        },
      ],
    })

    expect(result.addresses).toHaveLength(1)
    expect(result.addresses[0].state).toBe('unattempted')
    expect(result.outcome).toBe('unattempted')
    expect(service.setProperties).not.toHaveBeenCalled()
  })

  it('says nothing about a group with neither properties nor intents', async () => {
    install({ fileProperties: { Number: 'BR-202020' } })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        { configuration: 'Empty', properties: {}, intents: [] },
        {
          properties: { Number: 'BR-202020' },
          intents: [{ address: { scope: 'file', field: 'part_number' }, expected: 'BR-202020' }],
        },
      ],
    })

    expect(result.addresses).toHaveLength(1)
    expect(result.outcome).toBe('verified')
  })
})

describe('rounding many verdicts into one outcome', () => {
  const at = (state: VerifiedAddress['state']): VerifiedAddress => ({
    address: { scope: 'file', field: 'part_number' },
    state,
  })

  it('rounds up only when every address agrees', () => {
    expect(summarizeOutcome([at('verified'), at('verified')])).toBe('verified')
    expect(summarizeOutcome([at('failed'), at('failed')])).toBe('failed')
    expect(summarizeOutcome([at('unverified')])).toBe('unverified')
    expect(summarizeOutcome([at('unattempted')])).toBe('unattempted')
  })

  it('refuses to pick a winner when they disagree', () => {
    expect(summarizeOutcome([at('verified'), at('failed')])).toBe('partial')
    expect(summarizeOutcome([at('verified'), at('unverified')])).toBe('partial')
  })

  it('says not-applicable when there was nothing to establish', () => {
    expect(summarizeOutcome([])).toBe('not-applicable')
  })
})

describe('clearing a field', () => {
  it('sends the empty value instead of dropping the property from the write', async () => {
    install({ fileProperties: {} })

    await writeMetadataWithVerification({
      path: PATH,
      groups: [
        {
          properties: { Description: '' },
          intents: [{ address: { scope: 'file', field: 'description' }, expected: '' }],
        },
      ],
    })

    const [, properties] = service.setProperties.mock.calls[0]

    expect(properties).toEqual({ Description: '' })
  })

  it('uses the live SolidWorks API when the document is open', async () => {
    install({ fileProperties: { Description: 'New title' } })

    await writeMetadataWithVerification({
      path: PATH,
      useLiveApi: true,
      groups: [
        {
          properties: { Description: 'New title' },
          intents: [{ address: { scope: 'file', field: 'description' }, expected: 'New title' }],
        },
      ],
    })

    expect(service.setDocumentProperties).toHaveBeenCalledTimes(1)
    expect(service.setProperties).not.toHaveBeenCalled()
  })
})
