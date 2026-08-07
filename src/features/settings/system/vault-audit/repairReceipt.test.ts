/**
 * The repair receipt read three ways instead of one.
 *
 * The page used to subtract `entriesAdded` from `entriesRequested` and print the difference under a
 * sentence saying those entries "were already there". Two of the three ways that difference can
 * arise are not that, and the one the SQL fix in schema 95 makes visible - a file whose row did not
 * resolve - is the one where entries were genuinely dropped.
 */

import { describe, expect, it } from 'vitest'

import type { VaultAuditRepairFileOutcome, VaultAuditRepairOutcome } from '@/types/vaultAudit'

import { describeShortfall } from './repairReceipt'

function file(overrides: Partial<VaultAuditRepairFileOutcome> = {}): VaultAuditRepairFileOutcome {
  return {
    fileId: 'file-1',
    relativePath: 'Parts/ORING-BUNA-70A.SLDPRT',
    updated: true,
    refused: null,
    entriesRequested: 0,
    added: {},
    mapsAbsent: [],
    entriesUnderAbsentMap: 0,
    ...overrides,
  }
}

function receipt(overrides: Partial<VaultAuditRepairOutcome> = {}): VaultAuditRepairOutcome {
  return {
    filesRequested: 1,
    filesUpdated: 1,
    entriesRequested: 0,
    entriesAdded: 0,
    files: [],
    ...overrides,
  }
}

describe('reading the shortfall', () => {
  it('reports nothing when every entry landed', () => {
    expect(
      describeShortfall(
        receipt({ entriesRequested: 68, entriesAdded: 68, files: [file({ entriesRequested: 68 })] }),
      ),
    ).toEqual({ total: 0, unreachable: 0, noRecord: 0, alreadyPresent: 0 })
  })

  it('calls a row that was ahead of the scan "already present", which it is', () => {
    const shortfall = describeShortfall(
      receipt({ entriesRequested: 68, entriesAdded: 60, files: [file({ entriesRequested: 68 })] }),
    )

    expect(shortfall).toEqual({ total: 8, unreachable: 0, noRecord: 0, alreadyPresent: 8 })
  })

  it('does not call a dropped file "already present" - the case A10 made visible', () => {
    // Before schema 95 `entries_requested` skipped the unresolved file entirely, so this receipt
    // read 40 requested, 40 added, shortfall zero: silence for the batch that lost the most. With
    // the SQL fixed the shortfall appears, and it must not be described as entries the row held.
    const shortfall = describeShortfall(
      receipt({
        filesRequested: 2,
        filesUpdated: 1,
        entriesRequested: 68,
        entriesAdded: 40,
        files: [
          file({ entriesRequested: 40 }),
          file({
            fileId: 'file-2',
            relativePath: null,
            updated: false,
            refused: 'row-not-found',
            entriesRequested: 28,
          }),
        ],
      }),
    )

    expect(shortfall).toEqual({ total: 28, unreachable: 28, noRecord: 0, alreadyPresent: 0 })
  })

  it('separates entries with no map to be restored into from entries already held', () => {
    const shortfall = describeShortfall(
      receipt({
        entriesRequested: 30,
        entriesAdded: 18,
        files: [
          file({
            entriesRequested: 30,
            mapsAbsent: ['_config_descriptions'],
            entriesUnderAbsentMap: 9,
          }),
        ],
      }),
    )

    expect(shortfall).toEqual({ total: 12, unreachable: 0, noRecord: 9, alreadyPresent: 3 })
  })

  it('shrinks the reassuring line rather than the alarming one when they collide', () => {
    // `alreadyPresent` is the residual and never a count in its own right. A refusal this module
    // has not been taught about therefore takes space away from "already there" instead of hiding
    // inside it, which is the direction the defect ran.
    const shortfall = describeShortfall(
      receipt({
        entriesRequested: 20,
        entriesAdded: 5,
        files: [
          file({ entriesRequested: 20, refused: 'row-not-found' }),
        ],
      }),
    )

    expect(shortfall.alreadyPresent).toBe(0)
    expect(shortfall.unreachable).toBe(20)
  })

  it('never reports a negative count from a receipt that disagrees with itself', () => {
    const shortfall = describeShortfall(
      receipt({ entriesRequested: 5, entriesAdded: 9, files: [file({ entriesRequested: 5 })] }),
    )

    expect(shortfall.total).toBe(0)
    expect(shortfall.alreadyPresent).toBe(0)
  })
})
