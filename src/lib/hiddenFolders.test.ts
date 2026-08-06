import { describe, expect, it } from 'vitest'

import {
  isFolderMarkedHidden,
  isPathHidden,
  normalizeVaultPath,
  readHiddenFolderPaths,
  toggleHiddenFolderPath,
} from './hiddenFolders'

const HIDDEN = ['0 - SHARED/00 - REGRESSION TESTS']

describe('normalizeVaultPath', () => {
  it('converts backslashes and strips surrounding separators', () => {
    expect(normalizeVaultPath('\\0 - SHARED\\00 - REGRESSION TESTS\\')).toBe(
      '0 - SHARED/00 - REGRESSION TESTS',
    )
  })

  it('returns an empty string for the vault root', () => {
    expect(normalizeVaultPath('/')).toBe('')
  })
})

describe('isPathHidden', () => {
  it('matches the hidden folder itself', () => {
    expect(isPathHidden('0 - SHARED/00 - REGRESSION TESTS', HIDDEN)).toBe(true)
  })

  it('matches nested children at any depth', () => {
    expect(isPathHidden('0 - SHARED/00 - REGRESSION TESTS/bracket.SLDPRT', HIDDEN)).toBe(true)
    expect(isPathHidden('0 - SHARED/00 - REGRESSION TESTS/deep/nested/part.SLDPRT', HIDDEN)).toBe(
      true,
    )
  })

  it('does not match a sibling sharing the same prefix', () => {
    expect(isPathHidden('FOOBAR/part.SLDPRT', ['FOO'])).toBe(false)
    expect(isPathHidden('FOOBAR', ['FOO'])).toBe(false)
    expect(isPathHidden('0 - SHARED/00 - REGRESSION TESTS EXTRA', HIDDEN)).toBe(false)
  })

  it('ignores case differences from Windows paths', () => {
    expect(isPathHidden('0 - shared/00 - regression tests/part.sldprt', HIDDEN)).toBe(true)
    expect(isPathHidden('0 - SHARED\\00 - REGRESSION TESTS\\part.SLDPRT', HIDDEN)).toBe(true)
  })

  it('does not match parents of a hidden folder', () => {
    expect(isPathHidden('0 - SHARED', HIDDEN)).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(isPathHidden('', HIDDEN)).toBe(false)
    expect(isPathHidden(null, HIDDEN)).toBe(false)
    expect(isPathHidden('anything', [])).toBe(false)
    expect(isPathHidden('anything', [''])).toBe(false)
  })
})

describe('isFolderMarkedHidden', () => {
  it('only matches the exact folder, not its children', () => {
    expect(isFolderMarkedHidden('0 - SHARED/00 - REGRESSION TESTS', HIDDEN)).toBe(true)
    expect(isFolderMarkedHidden('0 - SHARED/00 - REGRESSION TESTS/nested', HIDDEN)).toBe(false)
  })
})

describe('toggleHiddenFolderPath', () => {
  it('adds a normalized path when not present', () => {
    expect(toggleHiddenFolderPath([], '\\Projects\\Scratch\\')).toEqual(['Projects/Scratch'])
  })

  it('removes an existing path regardless of casing', () => {
    expect(toggleHiddenFolderPath(HIDDEN, '0 - shared/00 - regression tests')).toEqual([])
  })

  it('leaves the list untouched for the vault root', () => {
    expect(toggleHiddenFolderPath(HIDDEN, '')).toEqual(HIDDEN)
  })
})

describe('readHiddenFolderPaths', () => {
  it('reads string entries and drops anything else', () => {
    expect(readHiddenFolderPaths({ admin_only_folders: ['Tests', '', 42, null, 'More'] })).toEqual([
      'Tests',
      'More',
    ])
  })

  it('returns an empty list for missing or malformed settings', () => {
    expect(readHiddenFolderPaths(null)).toEqual([])
    expect(readHiddenFolderPaths({})).toEqual([])
    expect(readHiddenFolderPaths({ admin_only_folders: 'Tests' })).toEqual([])
  })

  it('returns the same array instance for the same settings object', () => {
    const settings = { admin_only_folders: ['Tests'] }
    expect(readHiddenFolderPaths(settings)).toBe(readHiddenFolderPaths(settings))
  })
})
