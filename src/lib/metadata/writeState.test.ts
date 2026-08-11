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
  groupOfAddress,
  isConfirmed,
  isEmptyRecord,
  listRecordedAddresses,
  listWriteAddresses,
  needsWrite,
  pendingWithoutGroups,
  recordWithoutGroups,
  readWriteState,
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
  // This used to claim that a write interrupted by a crash came back as `unverified`. Nothing ever
  // recorded `writing`, so nothing ever did, and the test proved it only by building the state by
  // hand. `writing` is now outside the recorded union, so the record a crash leaves behind is the
  // one the edit started with.

  it('brings an interrupted write back owing the file a write, so it is re-issued', () => {
    // `updatePendingMetadata` marks the edited address `pending` before any write is issued, and a
    // crash mid-write leaves exactly that. `pending` still owes the file a write, so the next save
    // or check-in re-issues it and reads the file back, which settles the question that the crash
    // left open. Recording anything a retry skips would leave it open forever.
    const record = applyWriteState(undefined, [partNumber], 'pending', { at: AT })

    expect(readWriteState(record, partNumber)?.state).toBe('pending')
    expect(needsWrite('pending')).toBe(true)
  })

  it('cannot hold an in-flight marker, because that is not a conclusion about the file', () => {
    // @ts-expect-error 'writing' is a display state and is deliberately not recordable.
    const rejected: MetadataWriteStateRecord = { fields: { part_number: { state: 'writing', at: AT } } }
    expect(rejected).toBeDefined()
  })
})

describe('the promoted mark outlives the attempt that set it', () => {
  // Check-in promotes a value it could not confirm and stamps `promoted`, which is a statement
  // about the database rather than about the write. Every transition builds a fresh entry, so the
  // flag used to be dropped the moment the user touched the field again - and if the retry failed
  // too, nothing was left saying the database held something the file might not.

  it('keeps the mark when the user edits the field again and the retry fails', () => {
    const afterCheckin = applyWriteState(undefined, [partNumber], 'failed', {
      at: AT,
      promoted: true,
    })
    const afterEdit = applyWriteState(afterCheckin, [partNumber], 'pending', { at: AT })
    const afterRetry = applyWriteState(afterEdit, [partNumber], 'failed', {
      at: AT,
      reason: 'the property is read-only in this document',
    })

    expect(readWriteState(afterEdit, partNumber)?.promoted).toBe(true)
    expect(readWriteState(afterRetry, partNumber)?.promoted).toBe(true)
    expect(summarizeWriteState(afterRetry).hasPromotedUnconfirmed).toBe(true)
  })

  it('drops it the moment the file is confirmed to hold the value', () => {
    const afterCheckin = applyWriteState(undefined, [partNumber], 'unverified', {
      at: AT,
      promoted: true,
    })
    const confirmed = applyWriteState(afterCheckin, [partNumber], 'verified', { at: AT })

    expect(readWriteState(confirmed, partNumber)?.promoted).toBeUndefined()
    expect(summarizeWriteState(confirmed).hasPromotedUnconfirmed).toBe(false)
  })

  it('carries it through a batch of per-address outcomes, not just a single transition', () => {
    const promoted = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'failed' },
        { address: tab014, state: 'unverified' },
      ],
      { at: AT, promoted: true },
    )
    const rewritten = applyWriteStates(
      promoted,
      [
        { address: partNumber, state: 'failed', reason: 'refused again' },
        { address: tab014, state: 'verified' },
      ],
      { at: AT },
    )

    expect(readWriteState(rewritten, partNumber)?.promoted).toBe(true)
    expect(readWriteState(rewritten, tab014)?.promoted).toBeUndefined()
  })

  it('leaves an address nobody promoted unmarked', () => {
    const record = applyWriteState(undefined, [partNumber], 'failed', { at: AT })

    expect(readWriteState(record, partNumber)?.promoted).toBeUndefined()
  })
})

describe('grouping and removing write obligations', () => {
  const revision: MetadataWriteAddress = { scope: 'file', field: 'revision' }
  const description: MetadataWriteAddress = {
    scope: 'configuration',
    field: 'config_description',
    configuration: 'Default',
  }

  it('maps every address shape to the column that answers for it', () => {
    expect(groupOfAddress({ scope: 'file', field: 'part_number' })).toBe('part_number')
    expect(groupOfAddress({ scope: 'file', field: 'tab_number' })).toBe('tab_number')
    expect(groupOfAddress({ scope: 'file', field: 'description' })).toBe('description')
    expect(groupOfAddress({ scope: 'file', field: 'revision' })).toBe('revision')
    expect(groupOfAddress(tab014)).toBe('tab_number')
    expect(groupOfAddress(description)).toBe('description')
  })

  it('drops configuration maps with the column they belong to', () => {
    const pending = {
      part_number: 'PN-NEW',
      tab_number: '014',
      config_tabs: { Default: '014' },
      description: 'O-ring',
      config_descriptions: { Default: 'O-ring' },
      revision: 'B',
    }

    expect(pendingWithoutGroups(pending, new Set(['description', 'tab_number'] as const))).toEqual({
      part_number: 'PN-NEW',
      revision: 'B',
    })
  })

  it('returns the pending input untouched when no groups are excluded', () => {
    const pending = { part_number: 'PN-NEW', config_tabs: { Default: '014' } }

    expect(pendingWithoutGroups(pending, new Set())).toBe(pending)
  })

  it('returns no pending set when every group is excluded', () => {
    const pending = {
      part_number: 'PN-NEW',
      tab_number: '014',
      config_tabs: { Default: '014' },
      description: 'O-ring',
      config_descriptions: { Default: 'O-ring' },
      revision: 'B',
    }

    expect(
      pendingWithoutGroups(
        pending,
        new Set(['part_number', 'tab_number', 'description', 'revision'] as const),
      ),
    ).toBeUndefined()
  })

  it('removes recorded configuration addresses through the existing clear operation', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'failed' },
        { address: tab014, state: 'failed' },
        { address: description, state: 'failed' },
        { address: revision, state: 'failed' },
      ],
      { at: AT },
    )

    const remaining = recordWithoutGroups(record, new Set(['description', 'tab_number'] as const))

    expect(readWriteState(remaining, partNumber)?.state).toBe('failed')
    expect(readWriteState(remaining, revision)?.state).toBe('failed')
    expect(readWriteState(remaining, tab014)).toBeUndefined()
    expect(readWriteState(remaining, description)).toBeUndefined()
  })

  it('returns the recorded input untouched when no groups are excluded', () => {
    const record = applyWriteState(undefined, [partNumber], 'failed', { at: AT })

    expect(recordWithoutGroups(record, new Set())).toBe(record)
  })

  it('returns no recorded state when every address is excluded', () => {
    const record = applyWriteStates(
      undefined,
      [
        { address: partNumber, state: 'failed' },
        { address: tab014, state: 'failed' },
        { address: description, state: 'failed' },
        { address: revision, state: 'failed' },
      ],
      { at: AT },
    )

    expect(
      recordWithoutGroups(
        record,
        new Set(['part_number', 'tab_number', 'description', 'revision'] as const),
      ),
    ).toBeUndefined()
  })
})
