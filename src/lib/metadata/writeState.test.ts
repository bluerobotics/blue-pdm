/**
 * What the per-field write state has to get right for the compromise it replaces to stay replaced.
 *
 * The previous release could either discard a failed edit or let check-in promote it as though the
 * file had accepted it, and chose the first. These tests pin the third option: the value stays, the
 * mark says where it stands, and nothing rounds the three outcomes the plan insists on - verified,
 * failed, unverified - into fewer than three.
 */

import { describe, expect, it } from 'vitest'

import {
  addressKey,
  applyWriteState,
  applyWriteStates,
  clearWriteState,
  isConfirmed,
  isEmptyRecord,
  listRecordedAddresses,
  listWriteAddresses,
  needsWrite,
  readWriteState,
  rehydrateWriteState,
  resolveFileWriteState,
  scopePendingToGroup,
  scopeRecordToGroup,
  summarizeWriteState,
  type MetadataWriteAddress,
  type MetadataWriteStateRecord,
} from './writeState'

const AT = '2026-08-06T12:00:00.000Z'

const partNumber: MetadataWriteAddress = { scope: 'file', field: 'part_number' }
const tab014: MetadataWriteAddress = {
  scope: 'configuration',
  field: 'config_tab',
  configuration: 'AS568-014',
}
const tab015: MetadataWriteAddress = {
  scope: 'configuration',
  field: 'config_tab',
  configuration: 'AS568-015',
}

describe('a failed write keeps the value and marks it', () => {
  it('records the failure against the field, leaving the pending value untouched', () => {
    const pending = { part_number: 'PN-NEW' }
    const record = applyWriteState(undefined, listWriteAddresses(pending), 'failed', {
      at: AT,
      reason: 'the property is read-only in this document',
    })

    // The value is still there - nothing in this module can remove it.
    expect(pending.part_number).toBe('PN-NEW')
    expect(readWriteState(record, partNumber)).toEqual({
      state: 'failed',
      at: AT,
      reason: 'the property is read-only in this document',
    })
  })

  it('says the field still owes the file a write, so a retry is the whole remedy', () => {
    expect(needsWrite('failed')).toBe(true)
    expect(needsWrite('unattempted')).toBe(true)
    expect(needsWrite('pending')).toBe(true)
  })

  it('does not claim a failed field is in the file', () => {
    expect(isConfirmed('failed')).toBe(false)
    expect(isConfirmed('unverified')).toBe(false)
    expect(isConfirmed('verified')).toBe(true)
  })
})

describe('an unverifiable write is not a failed one', () => {
  it('keeps them as separate states, because the remedies differ', () => {
    // `failed` means the value is known not to be there; `unverified` means nobody knows. Telling a
    // user their file might have changed when it definitely has not, or the reverse, are both wrong.
    expect(needsWrite('unverified')).toBe(false)
    expect(needsWrite('failed')).toBe(true)
  })

  it('reports unverified as more alarming than pending but less than failed', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'unverified' },
        { address: tab014, state: 'pending' },
      ],
      { at: AT },
    )

    expect(summarizeWriteState(record).worst).toBe('unverified')

    const withFailure = applyWriteState(record, [tab015], 'failed', { at: AT })
    expect(summarizeWriteState(withFailure).worst).toBe('failed')
  })

  it('keeps a service that never ran distinct from a write that was refused', () => {
    const offline = applyWriteState(undefined, [partNumber], 'unattempted', { at: AT })
    const refused = applyWriteState(undefined, [partNumber], 'failed', { at: AT })

    expect(readWriteState(offline, partNumber)?.state).toBe('unattempted')
    expect(readWriteState(refused, partNumber)?.state).toBe('failed')
  })
})

describe('a partial write across many configurations', () => {
  const configurations = Array.from({ length: 68 }, (_, index) => `AS568-${String(index).padStart(3, '0')}`)

  it('records each configuration separately rather than rounding the file to one answer', () => {
    const record = applyWriteStates(
      undefined,
      configurations.map((configuration, index) => ({
        address: {
          scope: 'configuration' as const,
          field: 'config_tab' as const,
          configuration,
        },
        state: index < 66 ? ('verified' as const) : ('failed' as const),
        reason: index < 66 ? undefined : 'the configuration refused the value',
      })),
      { at: AT },
    )

    const summary = summarizeWriteState(record)

    expect(summary.counts.verified).toBe(66)
    expect(summary.counts.failed).toBe(2)
    expect(summary.worst).toBe('failed')
    expect(summary.affectedConfigurations).toEqual(['AS568-066', 'AS568-067'])
    expect(summary.unwritten).toHaveLength(2)
  })

  it('leaves the 66 confirmed configurations alone when the 2 are retried', () => {
    let record = applyWriteStates(
      undefined,
      configurations.map((configuration) => ({
        address: {
          scope: 'configuration' as const,
          field: 'config_tab' as const,
          configuration,
        },
        state: 'verified' as const,
      })),
      { at: AT },
    )

    record = applyWriteState(record, [tab014], 'failed', { at: AT })

    expect(summarizeWriteState(record).counts.verified).toBe(67)
    expect(readWriteState(record, tab014)?.state).toBe('failed')
  })

  it('stamps one timestamp on one write, not one per configuration', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: tab014, state: 'verified' },
        { address: tab015, state: 'failed' },
      ],
      { at: AT },
    )

    expect(readWriteState(record, tab014)?.at).toBe(AT)
    expect(readWriteState(record, tab015)?.at).toBe(AT)
  })
})

describe('what a whole file shows', () => {
  it('treats an edited field with nothing recorded as pending, not as confirmed', () => {
    // An edit made before this feature existed, or one recorded while the state was being cleared,
    // must not read as though the file had taken it.
    const state = resolveFileWriteState({ part_number: 'PN-NEW' }, undefined)

    expect(state).toBe('pending')
  })

  it('shows nothing once every edited field is confirmed', () => {
    const record = applyWriteState(undefined, [partNumber], 'verified', { at: AT })

    expect(resolveFileWriteState({ part_number: 'PN-NEW' }, record)).toBe('verified')
  })

  it('lets a recorded failure outrank an unrecorded edit', () => {
    const record = applyWriteState(undefined, [tab014], 'failed', { at: AT })

    expect(resolveFileWriteState({ part_number: 'PN-NEW', config_tabs: { 'AS568-014': '014' } }, record)).toBe(
      'failed',
    )
  })

  it('says nothing about a file with no edits and no record', () => {
    expect(resolveFileWriteState(undefined, undefined)).toBeUndefined()
  })

  it('flags a value the database took while the file was unconfirmed', () => {
    const record = applyWriteState(undefined, [partNumber], 'unverified', {
      at: AT,
      promoted: true,
    })

    expect(summarizeWriteState(record).hasPromotedUnconfirmed).toBe(true)
  })
})

describe('addresses', () => {
  it('counts a clear as an edit, because presence decides and not truthiness', () => {
    expect(listWriteAddresses({ part_number: null })).toEqual([partNumber])
    expect(listWriteAddresses({ part_number: undefined })).toEqual([])
  })

  it('names one address per configuration entry', () => {
    const addresses = listWriteAddresses({
      config_tabs: { 'AS568-014': '014', 'AS568-015': '' },
      config_descriptions: { 'AS568-014': 'O-ring' },
    })

    expect(addresses.map(addressKey)).toEqual([
      'configuration:config_tab:AS568-014',
      'configuration:config_tab:AS568-015',
      'configuration:config_description:AS568-014',
    ])
  })

  it('distinguishes the two configuration fields at the same configuration', () => {
    expect(
      addressKey({ scope: 'configuration', field: 'config_tab', configuration: 'Default' }),
    ).not.toBe(
      addressKey({ scope: 'configuration', field: 'config_description', configuration: 'Default' }),
    )
  })
})

describe('clearing and pruning', () => {
  it('forgets only the addresses named', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'failed' },
        { address: tab014, state: 'verified' },
      ],
      { at: AT },
    )

    const cleared = clearWriteState(record, [partNumber])

    expect(readWriteState(cleared, partNumber)).toBeUndefined()
    expect(readWriteState(cleared, tab014)?.state).toBe('verified')
  })

  it('collapses to undefined when nothing is left to say', () => {
    const record = applyWriteState(undefined, [partNumber], 'failed', { at: AT })

    expect(clearWriteState(record, [partNumber])).toBeUndefined()
    expect(isEmptyRecord(undefined)).toBe(true)
    expect(isEmptyRecord({})).toBe(true)
  })

  it('lists every address it has anything to say about', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'failed' },
        { address: tab014, state: 'verified' },
      ],
      { at: AT },
    )

    expect(listRecordedAddresses(record).map(addressKey).sort()).toEqual([
      'configuration:config_tab:AS568-014',
      'file:part_number',
    ])
  })
})

describe('narrowing a record to one datacard column', () => {
  const record = applyWriteStates(
    undefined,
    [
      { address: partNumber, state: 'verified' },
      { address: tab014, state: 'failed' },
      {
        address: { scope: 'configuration', field: 'config_description', configuration: 'AS568-014' },
        state: 'unverified',
      },
    ],
    { at: AT },
  )

  it('puts a configuration tab under Tab Number and not under Item Number', () => {
    // Otherwise one failed configuration puts an identical warning on all four columns, and none of
    // them says which cell to click.
    expect(resolveFileWriteState(undefined, scopeRecordToGroup(record, 'tab_number'))).toBe('failed')
    expect(resolveFileWriteState(undefined, scopeRecordToGroup(record, 'part_number'))).toBe(
      'verified',
    )
  })

  it('puts a configuration description under Description', () => {
    expect(resolveFileWriteState(undefined, scopeRecordToGroup(record, 'description'))).toBe(
      'unverified',
    )
  })

  it('says nothing for a column with nothing recorded', () => {
    expect(scopeRecordToGroup(record, 'revision')).toBeUndefined()
    expect(resolveFileWriteState(undefined, scopeRecordToGroup(record, 'revision'))).toBeUndefined()
  })

  it('narrows the pending set the same way, so an edit with no outcome still shows as pending', () => {
    const pending = { revision: 'B', config_tabs: { 'AS568-015': '015' } }

    expect(scopePendingToGroup(pending, 'revision')).toEqual({ revision: 'B' })
    expect(scopePendingToGroup(pending, 'tab_number')).toEqual({
      config_tabs: { 'AS568-015': '015' },
    })
    expect(scopePendingToGroup(pending, 'part_number')).toBeUndefined()
    expect(resolveFileWriteState(scopePendingToGroup(pending, 'revision'), undefined)).toBe('pending')
  })

  it('keeps a clear scoped, since a cleared field is an edit', () => {
    expect(scopePendingToGroup({ description: null }, 'description')).toEqual({ description: null })
  })
})

describe('coming back after a restart', () => {
  it('turns a write that was in flight into an unconfirmed one', () => {
    // Nobody ever saw the outcome. A spinner would never resolve, and `pending` would claim the file
    // was untouched.
    const record: MetadataWriteStateRecord = {
      fields: { part_number: { state: 'writing', at: AT } },
    }

    const rehydrated = rehydrateWriteState(record)

    expect(readWriteState(rehydrated, partNumber)?.state).toBe('unverified')
    expect(readWriteState(rehydrated, partNumber)?.reason).toContain('closed')
  })

  it('leaves every settled state exactly as it was', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'failed', reason: 'refused' },
        { address: tab014, state: 'verified' },
      ],
      { at: AT },
    )

    expect(rehydrateWriteState(record)).toBe(record)
  })
})
