/**
 * Every key added by the metadata write-path remediation, asserted to exist and to interpolate.
 *
 * A missing key is not a missing translation. `getTranslation` returns the key itself when it
 * cannot find one and no fallback string was given (`index.ts:86`), so a `t('vaultAudit.notCompared
 * .beyondLimit', { count: 5 })` whose key was never added puts the literal string
 * `vaultAudit.notCompared.beyondLimit` on the screen. These call sites were written with fallback
 * strings for exactly that reason, while `en.ts` was outside the agent's boundary; the fallbacks
 * are gone now, so something has to hold the keys in place.
 *
 * The `{{count}}` assertions matter for a second reason. `getTranslation` skips interpolation
 * entirely when the second argument is a string (`index.ts:87`), so the fallback form and the
 * parameter form are mutually exclusive - a key that takes a count cannot be written defensively.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'

/** Keys that render as-is. */
const PLAIN = [
  'metadataWrite.configurationsUnreadable',
  'shareLink.fileNotFound',
  'shareLink.noContent',
  'shareLink.notPermitted',
  'shareLink.signingFailed',
  'trash.deleteNotPermitted',
  'vaultAudit.notCompared.heading',
  'vaultAudit.result.noFindingsInCompared',
] as const

/** Keys whose sentence contains the number, so a translator can put it where the language wants. */
const COUNTED = [
  'metadataWrite.configurationsUnaddressed',
  'vaultAudit.notCompared.noConfigurationRecord',
  'vaultAudit.notCompared.beyondLimit',
  'vaultAudit.repair.receiptNoRecord',
  'vaultAudit.repair.receiptEntriesDropped',
] as const

describe('the keys this remediation added', () => {
  it.each(PLAIN)('resolves %s to a sentence rather than to the key', (key) => {
    const text = getTranslation('en', key)

    expect(text).not.toBe(key)
    expect(text.length).toBeGreaterThan(0)
  })

  it.each(COUNTED)('resolves %s and substitutes the count', (key) => {
    const text = getTranslation('en', key, { count: 68 })

    expect(text).not.toBe(key)
    expect(text).toContain('68')
    expect(text).not.toContain('{{count}}')
  })

  it('leaves no placeholder unfilled in the repair receipt’s shortfall line', () => {
    const text = getTranslation('en', 'vaultAudit.repair.receiptShortfall', {
      count: 12,
      requested: 40,
    })

    expect(text).toContain('12')
    expect(text).toContain('40')
    expect(text).not.toMatch(/\{\{\w+\}\}/)
  })

  it('serves the English text to a locale that has not translated these yet', () => {
    // The established pattern: `en.ts` is 1,300 lines and the others are around 400, with
    // `getTranslation` falling back to the English dictionary per key rather than per file.
    expect(getTranslation('de', 'shareLink.notPermitted')).toBe(
      getTranslation('en', 'shareLink.notPermitted'),
    )
    expect(getTranslation('zh-TW', 'vaultAudit.notCompared.beyondLimit', { count: 3 })).toContain(
      '3',
    )
  })
})
