import { describe, expect, it } from 'vitest'

import {
  resolveConfigurationDescription,
  resolveConfigurationDescriptions,
  resolveConfigurationTab,
  resolveConfigurationTabs,
  resolveDescription,
  resolveFileMetadata,
  resolveMetadataField,
  resolvePartNumber,
  resolveRevision,
  resolveTabNumber,
  resolvedText,
  type MetadataOverlaySource,
} from './overlay'
import type { PDMFile } from '@/types/pdm'
import type { PendingMetadata } from '@/stores/types'

/**
 * A row carrying only the fields the overlay reads. The rest of `PDMFile` is thirty-odd columns
 * that no resolver touches, so asserting them here would only make the tests harder to read.
 */
function row(
  fields: Partial<Pick<PDMFile, 'part_number' | 'description' | 'revision'>> & {
    custom_properties?: unknown
  },
): PDMFile {
  return {
    part_number: null,
    description: null,
    revision: '',
    custom_properties: null,
    ...fields,
  } as PDMFile
}

function source(pendingMetadata?: PendingMetadata, pdmData?: PDMFile): MetadataOverlaySource {
  return { pendingMetadata, pdmData }
}

describe('resolveMetadataField', () => {
  // The whole point of the module: presence decides, truthiness does not.

  it('prefers a pending edit over the committed value', () => {
    expect(resolveMetadataField('PN-NEW', 'PN-OLD')).toEqual({
      value: 'PN-NEW',
      source: 'pending',
    })
  })

  it('falls back to the committed value when there is no pending key', () => {
    expect(resolveMetadataField(undefined, 'PN-OLD')).toEqual({
      value: 'PN-OLD',
      source: 'committed',
    })
  })

  it('reports absent when neither side has anything', () => {
    expect(resolveMetadataField(undefined, undefined)).toEqual({ value: null, source: 'absent' })
    expect(resolveMetadataField(undefined, null)).toEqual({ value: null, source: 'absent' })
    expect(resolveMetadataField(undefined, '')).toEqual({ value: null, source: 'absent' })
  })

  // The empty-string case, in both directions. `||` collapses the first two of these into the
  // committed value and `??` collapses the second; both then show the user what they deleted.

  it('honours a pending clear to an empty string rather than falling through', () => {
    expect(resolveMetadataField('', 'PN-OLD')).toEqual({ value: null, source: 'pending' })
  })

  it('honours a pending clear to null rather than falling through', () => {
    expect(resolveMetadataField(null, 'PN-OLD')).toEqual({ value: null, source: 'pending' })
  })

  it('distinguishes a cleared field from a field nobody set', () => {
    const cleared = resolveMetadataField('', undefined)
    const neverSet = resolveMetadataField(undefined, undefined)

    expect(cleared.value).toBe(neverSet.value)
    expect(cleared.source).toBe('pending')
    expect(neverSet.source).toBe('absent')
  })

  it('treats a committed empty string as absent, not as a value', () => {
    expect(resolveMetadataField(undefined, '')).toEqual({ value: null, source: 'absent' })
  })

  // A pending value identical to the committed one is still an edit. `dropCommittedPendingMetadata`
  // strips those before they are stored, so the resolver does not have to - and must not, because
  // reporting them as committed would hide a pending write that has not landed yet.

  it('reports a pending value identical to the committed one as pending', () => {
    expect(resolveMetadataField('PN-1', 'PN-1')).toEqual({ value: 'PN-1', source: 'pending' })
  })

  it('reports a pending clear that matches an already-empty committed value as pending', () => {
    expect(resolveMetadataField('', '')).toEqual({ value: null, source: 'pending' })
  })

  it('never returns an empty string as a value', () => {
    for (const pending of ['', null, undefined] as const) {
      for (const committed of ['', null, undefined] as const) {
        expect(resolveMetadataField(pending, committed).value).toBeNull()
      }
    }
  })
})

describe('resolvedText', () => {
  it('renders a resolved value as itself', () => {
    expect(resolvedText(resolveMetadataField('PN-1', undefined))).toBe('PN-1')
  })

  it('renders both a cleared and an unset field as the placeholder', () => {
    expect(resolvedText(resolveMetadataField('', 'PN-1'), '-')).toBe('-')
    expect(resolvedText(resolveMetadataField(undefined, undefined), '-')).toBe('-')
  })

  it('defaults the placeholder to an empty string', () => {
    expect(resolvedText(resolveMetadataField(undefined, undefined))).toBe('')
  })
})

describe('the file-scope field resolvers', () => {
  it('read each field off its own side of the pair', () => {
    const resolved = resolveFileMetadata(
      source(
        { part_number: 'PN-NEW' },
        row({ part_number: 'PN-OLD', description: 'committed desc', revision: 'B' }),
      ),
    )

    expect(resolved.partNumber).toEqual({ value: 'PN-NEW', source: 'pending' })
    expect(resolved.description).toEqual({ value: 'committed desc', source: 'committed' })
    expect(resolved.revision).toEqual({ value: 'B', source: 'committed' })
  })

  it('resolves against a file with no server row at all', () => {
    const resolved = resolveFileMetadata(source({ description: 'local only' }, undefined))

    expect(resolved.partNumber).toEqual({ value: null, source: 'absent' })
    expect(resolved.description).toEqual({ value: 'local only', source: 'pending' })
  })

  it('resolves against a file with no pending edits at all', () => {
    expect(resolvePartNumber(source(undefined, row({ part_number: 'PN-1' })))).toEqual({
      value: 'PN-1',
      source: 'committed',
    })
  })

  it('honours a clear on each field independently', () => {
    const resolved = resolveFileMetadata(
      source(
        { part_number: null, description: '' },
        row({ part_number: 'PN-OLD', description: 'committed desc', revision: 'B' }),
      ),
    )

    expect(resolved.partNumber).toEqual({ value: null, source: 'pending' })
    expect(resolved.description).toEqual({ value: null, source: 'pending' })
    expect(resolved.revision).toEqual({ value: 'B', source: 'committed' })
  })

  it('resolves the revision, which the pending shape types as string-or-undefined', () => {
    expect(resolveRevision(source({ revision: 'C' }, row({ revision: 'B' })))).toEqual({
      value: 'C',
      source: 'pending',
    })
    expect(resolveRevision(source({ revision: '' }, row({ revision: 'B' })))).toEqual({
      value: null,
      source: 'pending',
    })
  })

  it('resolves the description off an empty committed row as absent', () => {
    expect(resolveDescription(source(undefined, row({ description: '' })))).toEqual({
      value: null,
      source: 'absent',
    })
  })

  it('resolves the file-level tab number, which has no committed side', () => {
    expect(resolveTabNumber(source({ tab_number: '01' }))).toEqual({
      value: '01',
      source: 'pending',
    })
    expect(resolveTabNumber(source({ tab_number: null }))).toEqual({
      value: null,
      source: 'pending',
    })
    expect(resolveTabNumber(source(undefined, row({ part_number: 'PN-1' })))).toEqual({
      value: null,
      source: 'absent',
    })
  })
})

describe('the configuration-map resolvers', () => {
  /** The ORING fixture's shape: many configurations, only one of which the user edited. */
  const ORING_CONFIGURATION_COUNT = 68

  function committedTabs(): Record<string, string> {
    const tabs: Record<string, string> = {}
    for (let index = 0; index < ORING_CONFIGURATION_COUNT; index++) {
      tabs[`AS568-${String(index + 1).padStart(3, '0')}`] = String(100 + index)
    }
    return tabs
  }

  it('keeps every configuration the user did not edit', () => {
    const resolved = resolveConfigurationTabs(
      source(
        { config_tabs: { 'AS568-014': '999' } },
        row({ custom_properties: { _config_tabs: committedTabs() } }),
      ),
    )

    expect(Object.keys(resolved)).toHaveLength(ORING_CONFIGURATION_COUNT)
    expect(resolved['AS568-014']).toBe('999')
    expect(resolved['AS568-001']).toBe('100')
  })

  it('keeps a pending clear of one configuration without dropping the rest', () => {
    const resolved = resolveConfigurationTabs(
      source(
        { config_tabs: { 'AS568-014': '' } },
        row({ custom_properties: { _config_tabs: committedTabs() } }),
      ),
    )

    expect(resolved['AS568-014']).toBe('')
    expect(Object.keys(resolved)).toHaveLength(ORING_CONFIGURATION_COUNT)
  })

  it('resolves to the committed map when nothing was edited', () => {
    const resolved = resolveConfigurationTabs(
      source(undefined, row({ custom_properties: { _config_tabs: { Default: '001' } } })),
    )
    expect(resolved).toEqual({ Default: '001' })
  })

  it('resolves to the pending map when there is no committed side', () => {
    expect(resolveConfigurationTabs(source({ config_tabs: { Default: '001' } }))).toEqual({
      Default: '001',
    })
  })

  it('resolves to an empty map when neither side has one', () => {
    expect(resolveConfigurationTabs(source(undefined, row({})))).toEqual({})
    expect(resolveConfigurationDescriptions(source(undefined, row({})))).toEqual({})
  })

  it('reads descriptions out of their own reserved key', () => {
    const resolved = resolveConfigurationDescriptions(
      source(
        { config_descriptions: { A: 'edited' } },
        row({ custom_properties: { _config_descriptions: { A: 'old', B: 'kept' } } }),
      ),
    )
    expect(resolved).toEqual({ A: 'edited', B: 'kept' })
  })

  it('resolves a single configuration through the same presence rule as a scalar', () => {
    const pair = source(
      { config_tabs: { A: '', B: '2' } },
      row({ custom_properties: { _config_tabs: { A: '1', C: '3' } } }),
    )

    expect(resolveConfigurationTab(pair, 'A')).toEqual({ value: null, source: 'pending' })
    expect(resolveConfigurationTab(pair, 'B')).toEqual({ value: '2', source: 'pending' })
    expect(resolveConfigurationTab(pair, 'C')).toEqual({ value: '3', source: 'committed' })
    expect(resolveConfigurationTab(pair, 'D')).toEqual({ value: null, source: 'absent' })
  })

  it('resolves a single configuration description the same way', () => {
    const pair = source(
      { config_descriptions: { A: 'edited' } },
      row({ custom_properties: { _config_descriptions: { B: 'committed' } } }),
    )

    expect(resolveConfigurationDescription(pair, 'A')).toEqual({
      value: 'edited',
      source: 'pending',
    })
    expect(resolveConfigurationDescription(pair, 'B')).toEqual({
      value: 'committed',
      source: 'committed',
    })
  })
})
