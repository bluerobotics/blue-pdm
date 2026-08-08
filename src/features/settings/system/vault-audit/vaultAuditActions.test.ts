import { describe, expect, it } from 'vitest'

import type { VaultAuditFinding } from '@/types/vaultAudit'

import {
  actionForFinding,
  categoryActionOf,
  categoryDirectionOf,
  repairCandidateIdOf,
} from './vaultAuditActions'

function findingOf(overrides: Partial<VaultAuditFinding> = {}): VaultAuditFinding {
  return {
    id: 'f1:configuration:config_tab:Short',
    kind: 'recoverable',
    resolution: 'adopt-file-value',
    fileId: 'f1',
    relativePath: '0 - SHARED\\BRACKET.SLDPRT',
    fileName: 'BRACKET.SLDPRT',
    fileType: 'part',
    field: 'config_tab',
    scope: 'configuration',
    configuration: 'Short',
    databaseValue: null,
    fileValue: '-001',
    repairValue: '-001',
    unattributedReason: null,
    ...overrides,
  }
}

describe('repairCandidateIdOf', () => {
  it('rebuilds the key the repair proposal uses, without the scope segment', () => {
    expect(repairCandidateIdOf(findingOf())).toBe('f1:config_tab:Short')
  })

  it('has none for a value that lives in a column rather than a reserved map', () => {
    expect(
      repairCandidateIdOf(findingOf({ scope: 'file', field: 'description', configuration: null })),
    ).toBeNull()
  })
})

describe('actionForFinding', () => {
  const repairable = new Set(['f1:config_tab:Short'])

  it('offers the database write for a value the proposal produced', () => {
    expect(actionForFinding(findingOf(), repairable)).toEqual({
      available: true,
      kind: 'write-to-vault',
    })
  })

  /**
   * The merge is additive by construction, so a configuration whose key is already present would
   * be sent and refused. The proposal has already excluded it; this reports the exclusion rather
   * than offering a button that cannot work.
   */
  it('refuses a configuration the record already has an entry for', () => {
    const other = findingOf({ configuration: 'Long', id: 'f1:configuration:config_tab:Long' })
    expect(actionForFinding(other, repairable)).toEqual({
      available: false,
      reason: 'entry-already-recorded',
    })
  })

  it('has no database writer for a column, and says which problem that is', () => {
    const revision = findingOf({
      scope: 'file',
      field: 'revision',
      configuration: null,
      fileType: 'drawing',
    })
    expect(actionForFinding(revision, repairable)).toEqual({
      available: false,
      reason: 'no-vault-writer-for-field',
    })
  })

  it('offers the document write wherever BluePLM holds the surviving value', () => {
    const push = findingOf({ kind: 'absent-from-file', resolution: 'push-vault-value' })
    expect(actionForFinding(push, repairable)).toEqual({
      available: true,
      kind: 'write-to-file',
    })
  })

  it('never offers a document write for revision', () => {
    const revision = findingOf({
      field: 'revision',
      scope: 'file',
      configuration: null,
      resolution: 'push-vault-value',
    })
    expect(actionForFinding(revision, repairable)).toEqual({
      available: false,
      reason: 'no-write-resolves-it',
    })
  })

  /**
   * Both directions settle a conflict and only one of them exists. Offering the one that exists
   * leaves the largest actionable category with an action in it; offering neither would be more
   * symmetrical and less useful.
   */
  it('offers the document write for a conflict, which is the half that has a writer', () => {
    const conflict = findingOf({ kind: 'conflicting', resolution: 'choose-a-side' })
    expect(actionForFinding(conflict, repairable)).toEqual({
      available: true,
      kind: 'write-to-file',
    })
  })

  /**
   * Sync Metadata would refuse it anyway, so this changes no outcome - it moves the refusal in
   * front of the person choosing instead of leaving it in a summary after they chose.
   */
  it('will not offer a document write for a file somebody else is holding', () => {
    const push = findingOf({ kind: 'absent-from-file', resolution: 'push-vault-value' })
    expect(actionForFinding(push, repairable, new Set(['f1']))).toEqual({
      available: false,
      reason: 'held-by-another-user',
    })
  })

  it('blocks a conflict on a held file too, since resolving it writes the document', () => {
    const conflict = findingOf({ kind: 'conflicting', resolution: 'choose-a-side' })
    expect(actionForFinding(conflict, repairable, new Set(['f1']))).toEqual({
      available: false,
      reason: 'held-by-another-user',
    })
  })

  /**
   * The database write is a merge into the row's configuration map. It cannot overwrite an entry
   * and never opens the document, so a colleague's checkout is not a reason to withhold it -
   * withholding it would stop the recovery on every file anyone happens to be holding.
   */
  it('still offers the database write for a held file, which does not touch the document', () => {
    expect(actionForFinding(findingOf(), repairable, new Set(['f1']))).toEqual({
      available: true,
      kind: 'write-to-vault',
    })
  })

  it('offers nothing where no write settles the row at all', () => {
    for (const resolution of [
      'nothing-to-restore',
      'file-is-authoritative',
      'fix-on-parent-model',
      'leave-alone',
    ] as const) {
      expect(actionForFinding(findingOf({ resolution }), repairable)).toEqual({
        available: false,
        reason: 'no-write-resolves-it',
      })
    }
  })
})

describe('categoryActionOf', () => {
  it('names the one direction a category admits', () => {
    const rows = [findingOf({ kind: 'absent-from-file', resolution: 'push-vault-value' })]
    expect(categoryActionOf(rows, new Set())).toBe('write-to-file')
  })

  // Every row is `adopt-file-value`, but only the ones the proposal produced have anywhere to go.
  it('finds the direction even when the first rows have no writer', () => {
    const rows = [
      findingOf({ configuration: 'Long', id: 'a' }),
      findingOf({ configuration: 'Short', id: 'b' }),
    ]
    expect(categoryActionOf(rows, new Set(['f1:config_tab:Short']))).toBe('write-to-vault')
  })

  it('names none for a category nothing can be done about', () => {
    const rows = [findingOf({ kind: 'lost', resolution: 'nothing-to-restore' })]
    expect(categoryActionOf(rows, new Set())).toBeNull()
  })
})

describe('categoryDirectionOf', () => {
  /**
   * The reason this exists separately. `categoryActionOf` answers from what can be acted on, which
   * for a category entirely checked out to a colleague is nothing - and an action bar reading
   * "nothing can be written from here" would hide the checkout that is the actual answer.
   */
  it('still names the direction when every file is held by somebody else', () => {
    const rows = [findingOf({ kind: 'absent-from-file', resolution: 'push-vault-value' })]
    const held = new Set(['f1'])

    expect(categoryActionOf(rows, new Set(), held)).toBeNull()
    expect(categoryDirectionOf(rows)).toBe('write-to-file')
  })

  it('names the database direction for a category that adopts file values', () => {
    expect(categoryDirectionOf([findingOf()])).toBe('write-to-vault')
  })

  it('does not expose a file direction for revision even in a stale report', () => {
    expect(
      categoryDirectionOf([
        findingOf({
          field: 'revision',
          scope: 'file',
          configuration: null,
          resolution: 'push-vault-value',
        }),
      ]),
    ).toBeNull()
  })

  it('names none for a category that resolves as no write', () => {
    expect(categoryDirectionOf([findingOf({ resolution: 'leave-alone' })])).toBeNull()
  })
})
