/**
 * What check-in records about the pending values it hands to the database.
 *
 * Two defects are pinned here and they pull in opposite directions, which is why the tests are
 * worth reading together. The first is the original one: a value reached the database while the
 * file did not have it and nothing recorded that, so the mark disappeared along with the pending
 * value that had been its only trace. The second is the fix's own overreach: check-in wrote the
 * pending values into the document to guarantee the two agreed, which changed the bytes of the
 * file being checked in and cut a version on every drawing carrying an edit.
 *
 * So the line these tests draw is about what counts as evidence. An address with a `failed`,
 * `unverified` or `unattempted` mark had a write run against it that did not confirm, and that
 * survives. An address with nothing recorded had no write run against it, which is the ordinary
 * case now - an item number typed into the file list is written on Enter and records its own
 * outcome, and a drawing's value is pulled from its parent model and was never headed for the
 * drawing at all. Treating that absence as suspicious would put a warning on the normal case.
 *
 * No SolidWorks stub, and no `window`: touching the document is the defect, so a call into the
 * service would throw here rather than quietly pass.
 */

import { describe, expect, it } from 'vitest'

import { promoteMetadataForCheckin } from './checkinMetadata'
import {
  addressKey,
  applyWriteState,
  type MetadataFieldGroup,
  type MetadataWriteStateRecord,
} from './writeState'
import type { LocalFile } from '@/stores/types'

const AT = '2026-08-06T12:00:00.000Z'

const PART_NUMBER = { scope: 'file', field: 'part_number' } as const
const REVISION = { scope: 'file', field: 'revision' } as const
const REVISION_ONLY_UNWRITABLE = new Set<MetadataFieldGroup>(['revision'])

function file(overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: 'ORING-BUNA-70A.SLDPRT',
    path: 'C:\\vault\\ORING-BUNA-70A.SLDPRT',
    relativePath: 'ORING-BUNA-70A.SLDPRT',
    extension: '.sldprt',
    isDirectory: false,
    size: 1024,
    pdmData: { id: 'file-1', part_number: 'BR-101010' },
    ...overrides,
  } as LocalFile
}

/** One address in one state, as some earlier write would have left it. */
function marked(state: 'verified' | 'failed' | 'unverified' | 'unattempted', reason?: string) {
  return applyWriteState(undefined, [PART_NUMBER], state, { at: AT, reason })
}

describe('a value with no write recorded against it', () => {
  it('is promoted without a mark, because nothing was ever attempted against the file', () => {
    // The ordinary case, and the one check-in used to write for. An edit committed in the file
    // list has already been written and recorded; a drawing's pulled value belongs to the parent
    // model. Neither leaves anything for check-in to doubt.
    const outcome = promoteMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' } }),
    )

    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('is promoted without a mark on a file that cannot hold custom properties at all', () => {
    const outcome = promoteMetadataForCheckin(
      file({ extension: '.step', pendingMetadata: { part_number: 'BR-202020' } }),
    )

    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('is promoted without a mark for a configuration the document may not even have', () => {
    const outcome = promoteMetadataForCheckin(
      file({ pendingMetadata: { config_descriptions: { 'AS568-014': 'O-ring, Viton' } } }),
    )

    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })
})

describe('a value whose write ran and did not confirm', () => {
  it('is promoted and keeps saying the file refused it', () => {
    // The value is the user's and the database owns it, so withholding it would lose the edit.
    // What must not happen is the record of doubt vanishing with the pending value.
    const outcome = promoteMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' }, metadataWriteState: marked('failed') }),
    )

    expect(outcome.promotedUnconfirmed.map(addressKey)).toEqual(['file:part_number'])
    expect(outcome.writeState?.fields?.part_number).toMatchObject({
      state: 'failed',
      promoted: true,
    })
  })

  it('keeps `unverified` as `unverified`, which is not the same claim as `failed`', () => {
    const outcome = promoteMetadataForCheckin(
      file({
        pendingMetadata: { part_number: 'BR-202020' },
        metadataWriteState: marked('unverified'),
      }),
    )

    expect(outcome.writeState?.fields?.part_number).toMatchObject({
      state: 'unverified',
      promoted: true,
    })
  })

  it('keeps `unattempted`, so a user whose service was off is not told the file might have changed', () => {
    const outcome = promoteMetadataForCheckin(
      file({
        pendingMetadata: { part_number: 'BR-202020' },
        metadataWriteState: marked('unattempted'),
      }),
    )

    expect(outcome.writeState?.fields?.part_number).toMatchObject({
      state: 'unattempted',
      promoted: true,
    })
  })

  it('records when the write failed rather than when the check-in ran', () => {
    // `at` answers "when did this go wrong", and check-in is not that event. Restamping it would
    // make a mark earned last week read as one earned during this check-in.
    const outcome = promoteMetadataForCheckin(
      file({
        pendingMetadata: { part_number: 'BR-202020' },
        metadataWriteState: marked('failed', 'the document is read-only'),
      }),
    )

    expect(outcome.writeState?.fields?.part_number?.at).toBe(AT)
    expect(outcome.writeState?.fields?.part_number?.reason).toBe('the document is read-only')
  })
})

describe('addresses with no BluePLM write path', () => {
  it('clears an unwritable failed address without promoting it', () => {
    const outcome = promoteMetadataForCheckin(
      file({
        extension: '.slddrw',
        pendingMetadata: { revision: 'R2' },
        metadataWriteState: applyWriteState(undefined, [REVISION], 'failed', { at: AT }),
      }),
      REVISION_ONLY_UNWRITABLE,
    )

    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('still promotes a writable address with its existing mark', () => {
    const outcome = promoteMetadataForCheckin(
      file({
        extension: '.slddrw',
        pendingMetadata: { part_number: 'BR-202020' },
        metadataWriteState: marked('failed'),
      }),
      REVISION_ONLY_UNWRITABLE,
    )

    expect(outcome.promotedUnconfirmed.map(addressKey)).toEqual(['file:part_number'])
    expect(outcome.writeState?.fields?.part_number).toMatchObject({
      state: 'failed',
      promoted: true,
    })
  })
})

describe('a value the file is known to hold', () => {
  it('is forgotten, since the file and the database now agree', () => {
    const outcome = promoteMetadataForCheckin(
      file({
        pendingMetadata: { part_number: 'BR-202020' },
        metadataWriteState: marked('verified'),
      }),
    )

    expect(outcome.writeState).toBeUndefined()
    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('is forgotten one configuration at a time, leaving only the two that refused', () => {
    const configurations = Array.from(
      { length: 68 },
      (_, index) => `AS568-${String(index).padStart(3, '0')}`,
    )
    let record: MetadataWriteStateRecord | undefined
    for (const [index, configuration] of configurations.entries()) {
      record = applyWriteState(
        record,
        [{ scope: 'configuration', field: 'config_tab', configuration }],
        index < 66 ? 'verified' : 'failed',
        { at: AT },
      )
    }

    const outcome = promoteMetadataForCheckin(
      file({
        pendingMetadata: {
          config_tabs: Object.fromEntries(
            configurations.map((name, index) => [name, String(index)]),
          ),
        },
        metadataWriteState: record,
      }),
    )

    expect(outcome.promotedUnconfirmed).toHaveLength(2)
    expect(Object.keys(outcome.writeState?.config_tabs ?? {})).toEqual(['AS568-066', 'AS568-067'])
  })
})

describe('marks that outlive the edit that produced them', () => {
  it('leaves a previous check-in’s mark alone when nothing is pending', () => {
    // The mark outliving the pending value is the whole point: an earlier check-in put this in
    // the database unconfirmed, and a check-in finding nothing pending must not read that as
    // nothing to say.
    const record: MetadataWriteStateRecord = {
      fields: { part_number: { state: 'failed', at: AT, promoted: true } },
    }

    const outcome = promoteMetadataForCheckin(file({ metadataWriteState: record }))

    expect(outcome.writeState?.fields?.part_number).toMatchObject({
      state: 'failed',
      promoted: true,
    })
  })

  it('does not re-report an old mark as something this check-in promoted', () => {
    const record: MetadataWriteStateRecord = {
      fields: { part_number: { state: 'failed', at: AT, promoted: true } },
    }

    const outcome = promoteMetadataForCheckin(file({ metadataWriteState: record }))

    expect(outcome.promotedUnconfirmed).toHaveLength(0)
  })

  it('leaves a file with neither edits nor marks with nothing at all', () => {
    expect(promoteMetadataForCheckin(file())).toEqual({
      writeState: undefined,
      promotedUnconfirmed: [],
    })
  })

  it('does not disturb an unrelated address while clearing a settled one', () => {
    const record = applyWriteState(
      marked('verified'),
      [{ scope: 'file', field: 'revision' }],
      'failed',
      {
        at: AT,
      },
    )

    const outcome = promoteMetadataForCheckin(
      file({ pendingMetadata: { part_number: 'BR-202020' }, metadataWriteState: record }),
    )

    expect(outcome.writeState?.fields?.part_number).toBeUndefined()
    expect(outcome.writeState?.fields?.revision?.state).toBe('failed')
    expect(outcome.writeState?.fields?.revision?.promoted).toBeUndefined()
  })
})
