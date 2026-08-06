/**
 * The verified write, end to end against a stubbed service.
 *
 * Four things are worth pinning here. Both halves of the write are one call however many
 * configurations it touched - one `setPropertiesBatch` and one `getProperties` - because that is
 * what makes verification affordable enough to leave on. A write no scope accepted skips the
 * read-back entirely, because a stale value that happens to match would otherwise verify a write
 * that never happened. Batching does not cost the per-address verdicts: the read-back names every
 * configuration, and a scope the batch reports as refused is still failed without consulting it.
 * And an outcome is only rounded up to a single answer when every address agrees - any disagreement
 * is `partial`, so a caller looking at the outcome alone cannot be told that 68 configurations
 * succeeded because 66 of them did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { summarizeOutcome, writeMetadataWithVerification } from './writeMetadataToFile'
import type { VerifiedAddress } from './verifyWrite'

interface Service {
  setProperties: ReturnType<typeof vi.fn>
  setPropertiesBatch: ReturnType<typeof vi.fn>
  setDocumentProperties: ReturnType<typeof vi.fn>
  getProperties: ReturnType<typeof vi.fn>
}

/** What the service says about a batch it was handed, beyond whether the call itself worked. */
interface BatchOutcome {
  success?: boolean
  error?: string
  data?: {
    configurationsProcessed?: number
    failedConfigurations?: Record<string, string>
    failedProperties?: string[]
    errors?: string[]
  }
}

const PATH = 'C:\\vault\\ORING-BUNA-70A.SLDPRT'

let service: Service

function install(options: {
  writeSucceeds?: boolean | ((configuration?: string) => boolean)
  batchOutcome?: BatchOutcome
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
    setPropertiesBatch: vi.fn(
      async (_path: string, configProperties: Record<string, Record<string, string>>) => {
        const outcome = options.batchOutcome
        if (outcome) return { success: outcome.success !== false, ...outcome }
        return {
          success: true,
          data: { configurationsProcessed: Object.keys(configProperties).length },
        }
      },
    ),
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

/** One configuration's group, as every plan that reaches more than one scope shapes it. */
function configurationGroup(configuration: string, tab: string) {
  return {
    configuration,
    properties: { 'Tab Number': tab },
    intents: [
      {
        address: { scope: 'configuration' as const, field: 'config_tab' as const, configuration },
        expected: tab,
      },
    ],
  }
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

  it('writes and reads back in one call each however many configurations were touched', async () => {
    const configurations = Array.from({ length: 12 }, (_, index) => `Config-${index}`)
    install({
      configurationProperties: Object.fromEntries(
        configurations.map((name) => [name, { 'Tab Number': '001' }]),
      ),
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: configurations.map((configuration) => configurationGroup(configuration, '001')),
    })

    expect(service.setPropertiesBatch).toHaveBeenCalledTimes(1)
    expect(service.setProperties).not.toHaveBeenCalled()
    expect(service.getProperties).toHaveBeenCalledTimes(1)
    // Every address still gets its own verdict; only the number of calls changed.
    expect(result.addresses).toHaveLength(12)
    expect(result.outcome).toBe('verified')
  })
})

describe('sending every configuration in one call', () => {
  it('keeps the file-scope group on its own call, since the batch has no file scope', async () => {
    install({
      fileProperties: { Number: 'BR-202020' },
      configurationProperties: { 'AS568-014': { Number: 'BR-202020' } },
    })

    await writeMetadataWithVerification({
      path: PATH,
      groups: [
        { properties: { Number: 'BR-202020' }, intents: [] },
        configurationGroup('AS568-014', '014'),
        configurationGroup('AS568-015', '015'),
      ],
    })

    expect(service.setProperties).toHaveBeenCalledTimes(1)
    expect(service.setProperties.mock.calls[0][2]).toBeUndefined()
    expect(service.setPropertiesBatch).toHaveBeenCalledTimes(1)
    expect(Object.keys(service.setPropertiesBatch.mock.calls[0][1])).toEqual([
      'AS568-014',
      'AS568-015',
    ])
  })

  it('writes the document bag before the configurations, as the plan ordered them', async () => {
    // The sync command's configuration writes mirror `Number` back to file scope, so a document
    // group issued after them would be overwritten by the mirror rather than the other way round.
    install({ configurationProperties: {} })

    await writeMetadataWithVerification({
      path: PATH,
      groups: [
        { properties: { Number: 'BR-202020' }, intents: [] },
        configurationGroup('AS568-014', '014'),
        configurationGroup('AS568-015', '015'),
      ],
    })

    expect(service.setProperties.mock.invocationCallOrder[0]).toBeLessThan(
      service.setPropertiesBatch.mock.invocationCallOrder[0],
    )
  })

  it('leaves a single configuration on the per-scope call, which states its own verdict', async () => {
    install({ configurationProperties: { 'AS568-014': { 'Tab Number': '014' } } })

    await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014')],
    })

    expect(service.setProperties).toHaveBeenCalledTimes(1)
    expect(service.setPropertiesBatch).not.toHaveBeenCalled()
  })

  it('refuses to batch two groups naming the same configuration, which would lose one', async () => {
    install({ configurationProperties: { 'AS568-014': {} } })

    await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-014', '015')],
    })

    expect(service.setPropertiesBatch).not.toHaveBeenCalled()
    expect(service.setProperties).toHaveBeenCalledTimes(2)
  })

  it('keeps the per-scope calls when the document is open in SolidWorks', async () => {
    // The live API has no batch, so the loop is the only way to reach each configuration.
    install({ configurationProperties: {} })

    await writeMetadataWithVerification({
      path: PATH,
      useLiveApi: true,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(service.setDocumentProperties).toHaveBeenCalledTimes(2)
    expect(service.setPropertiesBatch).not.toHaveBeenCalled()
  })

  it('fails a configuration the batch reported as refused without consulting the read-back', async () => {
    // The whole point of keeping the refusal signal: the file already holds the intended value, so
    // the read-back alone would call this verified and confirm a write that never happened.
    install({
      batchOutcome: {
        data: {
          configurationsProcessed: 2,
          failedProperties: ['AS568-015:Tab Number'],
        },
      },
      configurationProperties: {
        'AS568-014': { 'Tab Number': '014' },
        'AS568-015': { 'Tab Number': '015' },
      },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(result.outcome).toBe('partial')
    const refused = result.addresses.find(
      (entry) =>
        entry.address.scope === 'configuration' && entry.address.configuration === 'AS568-015',
    )
    expect(refused?.state).toBe('failed')
  })

  it('fails every configuration when the batch itself failed, and skips the read-back', async () => {
    install({ batchOutcome: { success: false, error: 'the file is read-only' } })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(result.outcome).toBe('failed')
    expect(result.addresses).toHaveLength(2)
    expect(result.addresses.every((entry) => entry.reason === 'the file is read-only')).toBe(true)
    expect(service.getProperties).not.toHaveBeenCalled()
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
    // One call for both configurations, and the read-back still answers for each by name.
    install({
      configurationProperties: {
        'AS568-014': { 'Tab Number': '014' },
        'AS568-015': {},
      },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(service.setPropertiesBatch).toHaveBeenCalledTimes(1)
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

describe('a configuration the batch neither entered nor named', () => {
  // The Document Manager path skips a configuration it cannot open, mentions it only in a prose
  // `errors` entry, and still returns success. `readBatchWriteReport` refuses to guess which one
  // and counts it; that count used to be logged and then dropped, leaving the read-back to decide
  // - and a stale value equal to the intended one reads exactly like one the write just put there.

  const skipped: BatchOutcome = {
    success: true,
    data: {
      configurationsProcessed: 1,
      errors: ["Error writing to config 'AS568-015': the configuration could not be opened"],
    },
  }

  it('refuses to confirm any scope in the batch, since nothing says which was skipped', async () => {
    install({
      batchOutcome: skipped,
      configurationProperties: {
        'AS568-014': { 'Tab Number': '014' },
        'AS568-015': { 'Tab Number': '015' },
      },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(result.addresses.map((entry) => entry.state)).toEqual(['unverified', 'unverified'])
    expect(result.outcome).toBe('unverified')
  })

  it('leaves a scope the read-back found empty as failed, which is decisive either way', async () => {
    install({
      batchOutcome: skipped,
      configurationProperties: { 'AS568-014': { 'Tab Number': '014' }, 'AS568-015': {} },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(result.addresses.map((entry) => entry.state)).toEqual(['unverified', 'failed'])
  })

  it('confirms normally when the service accounted for every configuration', async () => {
    install({
      configurationProperties: {
        'AS568-014': { 'Tab Number': '014' },
        'AS568-015': { 'Tab Number': '015' },
      },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [configurationGroup('AS568-014', '014'), configurationGroup('AS568-015', '015')],
    })

    expect(result.outcome).toBe('verified')
  })
})

describe('a group that carries properties but names no address', () => {
  it('reports a failure nothing else can carry, rather than rounding it away', async () => {
    // Sync Metadata emitted this shape on every part it touched: the document's own bag, written
    // with its intents stripped. A read-only file refused the write, no address was named, and the
    // command logged "PUSH complete - confirmed in the file".
    install({
      writeSucceeds: (configuration) => configuration !== undefined,
      configurationProperties: { Default: { 'Tab Number': '014' } },
    })

    const result = await writeMetadataWithVerification({
      path: PATH,
      groups: [
        { properties: { Number: 'BR-202020' }, intents: [] },
        configurationGroup('Default', '014'),
      ],
    })

    expect(result.unrecordedFailures).toEqual([
      { scope: '(file scope)', reason: 'the property is read-only' },
    ])
    expect(result.outcome).toBe('partial')
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
