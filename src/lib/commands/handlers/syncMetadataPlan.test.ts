/**
 * What Sync Metadata is allowed to do to a file it was pointed at.
 *
 * The two failures these tests were written for are both silent, both destructive, and both look
 * like a successful sync from the outside:
 *
 * - The configuration tabs were read from `pendingMetadata` alone. A file whose tabs live only in
 *   the database - which is every file nobody edited this session - therefore computed an empty tab
 *   for all 68 of its configurations, wrote `Number` as the bare base and left `Tab Number` out
 *   entirely. Running Sync Metadata stripped the tab from every configuration in the file.
 * - A cleared field was filtered out of the write instead of being written empty, so the value the
 *   user deleted stayed in the document and came back the next time anything read the file.
 */

import { describe, expect, it } from 'vitest'

import { buildPartAssemblyPushPlan, type PushConfiguration } from './syncMetadataPlan'
import type { MetadataOverlaySource } from '@/lib/metadata/overlay'
import type { PlanSerialization } from '@/lib/metadata/writePlan'
import type { PendingMetadata } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

const PARITY = { date: '2026-08-06', drawnBy: 'A. Engineer' }

const SERIALIZATION: PlanSerialization = {
  tabEnabled: true,
  settings: { tab_enabled: true, tab_separator: '-', suffix: '' } as PlanSerialization['settings'],
}

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

function file(pending: PendingMetadata | undefined, pdmData: PDMFile): MetadataOverlaySource {
  return { pendingMetadata: pending, pdmData }
}

function group(groups: ReturnType<typeof buildPartAssemblyPushPlan>, configuration?: string) {
  const found = groups.find((entry) => entry.configuration === configuration)
  if (!found) throw new Error(`no group for ${configuration ?? 'the document'}`)
  return found
}

/** The o-ring shape, reduced: tabs in the database, nothing edited this session. */
const ORING_CONFIGURATIONS: PushConfiguration[] = [
  { name: 'AS568-014', isActive: true },
  { name: 'AS568-015' },
]

const ORING = file(
  undefined,
  row({
    part_number: 'BR-100635',
    description: 'O-ring, NBR 70A',
    revision: 'B',
    custom_properties: { _config_tabs: { 'AS568-014': '014', 'AS568-015': '015' } },
  }),
)

describe('the tabs a sync writes back', () => {
  it('keeps each configuration its own tab when the tabs live only in the database', () => {
    const groups = buildPartAssemblyPushPlan({
      file: ORING,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups, 'AS568-014').properties['Tab Number']).toBe('014')
    expect(group(groups, 'AS568-015').properties['Tab Number']).toBe('015')
  })

  it('builds each configuration number from the base and that configuration s tab', () => {
    const groups = buildPartAssemblyPushPlan({
      file: ORING,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups, 'AS568-014').properties['Number']).toBe('BR-100635-014')
    expect(group(groups, 'AS568-015').properties['Number']).toBe('BR-100635-015')
    expect(group(groups, 'AS568-014').properties['Base Item Number']).toBe('BR-100635')
  })

  it('lets an edited tab win over the database, without dropping the tabs nobody edited', () => {
    const groups = buildPartAssemblyPushPlan({
      file: file({ config_tabs: { 'AS568-014': '999' } }, ORING.pdmData!),
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups, 'AS568-014').properties['Tab Number']).toBe('999')
    expect(group(groups, 'AS568-015').properties['Tab Number']).toBe('015')
  })

  it('leaves the document its own tab for a configuration BluePLM has no opinion about', () => {
    const groups = buildPartAssemblyPushPlan({
      file: file(undefined, row({ part_number: 'BR-100635' })),
      configurations: [{ name: 'Default', isActive: true, tabNumber: '001' }],
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups, 'Default').properties['Tab Number']).toBe('001')
    expect(group(groups, 'Default').properties['Number']).toBe('BR-100635-001')
  })

  it('writes the tab empty when the user cleared it, rather than leaving the old one', () => {
    const groups = buildPartAssemblyPushPlan({
      file: file({ config_tabs: { 'AS568-014': '' } }, ORING.pdmData!),
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups, 'AS568-014').properties['Tab Number']).toBe('')
    expect(group(groups, 'AS568-014').properties['Number']).toBe('BR-100635')
  })
})

describe('a cleared field reaches the document as an empty value', () => {
  const cleared = file(
    { part_number: '', description: '', revision: '' },
    row({ part_number: 'BR-100635', description: 'O-ring, NBR 70A', revision: 'B' }),
  )

  it('writes the number empty rather than omitting it', () => {
    const groups = buildPartAssemblyPushPlan({
      file: cleared,
      configurations: [],
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups).properties['Number']).toBe('')
    expect(group(groups).properties['Base Item Number']).toBe('')
  })

  it('writes the description and revision empty rather than omitting them', () => {
    const groups = buildPartAssemblyPushPlan({
      file: cleared,
      configurations: [],
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups).properties['Description']).toBe('')
    expect(group(groups).properties['Revision']).toBe('')
  })

  it('still plans a write when every file-scope field was cleared at once', () => {
    const groups = buildPartAssemblyPushPlan({
      file: cleared,
      configurations: [],
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(groups).not.toEqual([])
  })

  it('clears the same fields inside every configuration', () => {
    const groups = buildPartAssemblyPushPlan({
      file: cleared,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups, 'AS568-014').properties['Description']).toBe('')
    expect(group(groups, 'AS568-014').properties['Revision']).toBe('')
  })
})

describe('a field nobody ever set is left alone', () => {
  it('writes nothing at all for a file BluePLM holds no metadata for', () => {
    const groups = buildPartAssemblyPushPlan({
      file: file(undefined, row({})),
      configurations: [],
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(groups).toEqual([])
  })

  it('omits the number rather than emptying it when neither side ever held one', () => {
    const groups = buildPartAssemblyPushPlan({
      file: file(undefined, row({ description: 'O-ring, NBR 70A' })),
      configurations: [],
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups).properties).not.toHaveProperty('Number')
    expect(group(groups).properties['Description']).toBe('O-ring, NBR 70A')
  })
})

describe('the write says what it is meant to establish', () => {
  it('names an address per configuration tab, so the read-back can confirm each one', () => {
    const groups = buildPartAssemblyPushPlan({
      file: ORING,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    const tabs = groups
      .flatMap((entry) => entry.intents)
      .filter((intent) => intent.address.scope === 'configuration')
      .map((intent) => [(intent.address as { configuration: string }).configuration, intent.expected])

    expect(tabs).toEqual([
      ['AS568-014', '014'],
      ['AS568-015', '015'],
    ])
  })

  it('names the file-scope fields once, on the document group that establishes them', () => {
    const groups = buildPartAssemblyPushPlan({
      file: ORING,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    const fileScope = groups
      .flatMap((entry) => entry.intents)
      .filter((intent) => intent.address.scope === 'file')

    expect(fileScope.map((intent) => intent.address)).toEqual([
      { scope: 'file', field: 'part_number' },
      { scope: 'file', field: 'description' },
      { scope: 'file', field: 'revision' },
    ])
    // On the document group, not on a configuration: a failed write of the document's own bag used
    // to name no address at all, so Sync Metadata could log "confirmed in the file" having failed
    // to write it.
    expect(group(groups).intents).toHaveLength(3)
  })

  it('carries the parity properties into every scope it writes', () => {
    const groups = buildPartAssemblyPushPlan({
      file: ORING,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    for (const entry of groups) {
      expect(entry.properties['Date']).toBe('2026-08-06')
      expect(entry.properties['DrawnBy']).toBe('A. Engineer')
    }
  })
})

describe('the document bag is written alongside the configurations', () => {
  it('keeps the base number out of the tab on the document itself', () => {
    const groups = buildPartAssemblyPushPlan({
      file: ORING,
      configurations: ORING_CONFIGURATIONS,
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group(groups).properties['Number']).toBe('BR-100635')
    expect(group(groups).properties).not.toHaveProperty('Tab Number')
  })
})
