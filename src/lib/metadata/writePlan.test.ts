/**
 * What a set of pending edits asks the file to hold.
 *
 * The two things worth pinning are the clear and the tab. A cleared field has to reach the file as an
 * empty property rather than be left out - leaving it out is how a clear silently failed to happen,
 * and the details panel used to skip the write entirely when every field came out empty. And the tab
 * has to be written even on a file with no part number, which the old builder nested inside its
 * base-number branch and therefore skipped.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildMetadataWritePlan } from './writePlan'
import { addressKey } from './writeState'

const COMMITTED = { partNumber: 'BR-101010', description: 'O-ring, NBR 70A', revision: 'A' }

describe('clearing a field writes an empty property', () => {
  it('emits the part number properties holding nothing, rather than omitting them', () => {
    const [group] = buildMetadataWritePlan({
      pending: { part_number: null },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
    })

    expect(group.properties['Number']).toBe('')
    expect(group.properties['Base Item Number']).toBe('')
  })

  it('emits an empty description rather than leaving the old one in the file', () => {
    const [group] = buildMetadataWritePlan({
      pending: { description: null },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
    })

    expect('Description' in group.properties).toBe(true)
    expect(group.properties['Description']).toBe('')
  })

  it('produces a write for a full clear, so the panel has something to send', () => {
    const groups = buildMetadataWritePlan({
      // A cleared revision is the empty string rather than null - `PendingMetadata.revision` is not
      // nullable, and presence is what decides, so both spell the same clear.
      pending: { part_number: null, description: null, revision: '' },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].intents.map((intent) => addressKey(intent.address))).toEqual([
      'file:part_number',
      'file:description',
      'file:revision',
    ])
    expect(groups[0].intents.every((intent) => intent.expected === '')).toBe(true)
  })

  it('does not resurrect the committed value on a clear', () => {
    const [group] = buildMetadataWritePlan({
      pending: { part_number: null },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
    })

    expect(group.properties['Number']).not.toBe('BR-101010')
  })
})

describe('a field nobody touched is left out entirely', () => {
  it('writes no property for an untouched field, which is not the same as writing an empty one', () => {
    const [group] = buildMetadataWritePlan({
      pending: { revision: 'B' },
      committed: { partNumber: null, description: null, revision: 'A' },
      configurations: [],
      serialization: null,
    })

    expect('Number' in group.properties).toBe(false)
    expect('Description' in group.properties).toBe(false)
    expect(group.properties['Revision']).toBe('B')
  })

  it('records an intent only for the fields the edit named', () => {
    const [group] = buildMetadataWritePlan({
      pending: { description: 'New title' },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
    })

    expect(group.intents.map((intent) => addressKey(intent.address))).toEqual(['file:description'])
  })
})

describe('tab numbers', () => {
  it('writes a configuration tab even on a file with no part number', () => {
    const [group] = buildMetadataWritePlan({
      pending: { config_tabs: { 'AS568-014': '014' } },
      committed: { partNumber: null, description: null, revision: null },
      configurations: [{ name: 'AS568-014' }],
      serialization: null,
    })

    expect(group.properties['Tab Number']).toBe('014')
  })

  it('empties the tab property when a tab is cleared', () => {
    const [group] = buildMetadataWritePlan({
      pending: { config_tabs: { 'AS568-014': '' } },
      committed: COMMITTED,
      configurations: [{ name: 'AS568-014', tabNumber: '014' }],
      serialization: null,
    })

    expect(group.properties['Tab Number']).toBe('')
    expect(group.properties['Number']).toBe('BR-101010')
  })

  it('leaves an untouched configuration with no tab without an empty property', () => {
    const [group] = buildMetadataWritePlan({
      pending: { config_descriptions: { Default: 'A title' } },
      committed: COMMITTED,
      configurations: [{ name: 'Default' }],
      serialization: null,
    })

    expect('Tab Number' in group.properties).toBe(false)
  })

  it('combines the base and the tab into Number without a separator settings object', () => {
    const [group] = buildMetadataWritePlan({
      pending: { config_tabs: { 'AS568-014': '014' } },
      committed: COMMITTED,
      configurations: [{ name: 'AS568-014' }],
      serialization: null,
    })

    expect(group.properties['Number']).toBe('BR-101010-014')
  })
})

describe('a multi-configuration file', () => {
  const configurations = [
    { name: 'Default', isActive: true },
    { name: 'AS568-014' },
    { name: 'AS568-015' },
  ]

  it('writes only the configurations the edit touched', () => {
    const groups = buildMetadataWritePlan({
      pending: { config_tabs: { 'AS568-014': '014' } },
      committed: COMMITTED,
      configurations,
      serialization: null,
    })

    expect(groups.map((group) => group.configuration)).toEqual(['AS568-014'])
  })

  it('writes the file-scope fields into the document bag and copies them into the active configuration', () => {
    // The copy is what SolidWorks resolves for that configuration; the document's own bag is what
    // the address means and what the divergence scanner reads. The plan used to emit only the copy,
    // so the write reported `verified` against a document whose own bag still held the old value.
    const groups = buildMetadataWritePlan({
      pending: { part_number: 'BR-202020' },
      committed: COMMITTED,
      configurations,
      serialization: null,
    })

    expect(groups.map((group) => group.configuration)).toEqual([undefined, 'Default'])
    expect(groups[0].intents.map((intent) => intent.address)).toEqual([
      { scope: 'file', field: 'part_number' },
    ])
    expect(groups[0].properties['Base Item Number']).toBe('BR-202020')
    expect(groups[1].properties['Base Item Number']).toBe('BR-202020')
    expect(groups[1].intents).toHaveLength(0)
  })

  it('does not claim the file-scope field twice when several configurations are written', () => {
    const groups = buildMetadataWritePlan({
      pending: { part_number: 'BR-202020', config_tabs: { 'AS568-014': '014' } },
      committed: COMMITTED,
      configurations,
      serialization: null,
    })

    const fileScoped = groups.flatMap((group) =>
      group.intents.filter((intent) => intent.address.scope === 'file'),
    )

    expect(fileScoped).toHaveLength(1)
  })

  it('writes no document group for a configuration-only edit', () => {
    // The inline configuration editors write on every committed keystroke. Nothing at file scope
    // changed, so a second open and save per keystroke would buy nothing.
    const groups = buildMetadataWritePlan({
      pending: { config_tabs: { 'AS568-014': '014' } },
      committed: COMMITTED,
      configurations,
      serialization: null,
    })

    expect(groups.map((group) => group.configuration)).toEqual(['AS568-014'])
  })

  it('names the file-scope tab number, which a multi-configuration document used to drop', () => {
    // Reachable through the Sync Metadata pull. The plan produced no group for it at all, so no
    // intent, no verdict, and check-in read the silence as confirmation.
    const groups = buildMetadataWritePlan({
      pending: { tab_number: '014' },
      committed: COMMITTED,
      configurations,
      serialization: null,
    })

    expect(groups[0].configuration).toBeUndefined()
    expect(groups[0].intents.map((intent) => intent.address)).toEqual([
      { scope: 'file', field: 'tab_number' },
    ])
    expect(groups[0].properties['Tab Number']).toBe('014')
  })

  it('names the file-level description as well as the base configuration’s own', () => {
    // Editing both used to lose the file-level one: the per-configuration intent took the branch
    // and the file-scope intent was never emitted, so its address left check-in unrecorded.
    const groups = buildMetadataWritePlan({
      pending: { description: 'Viton o-ring', config_descriptions: { Default: 'Viton, 014' } },
      committed: COMMITTED,
      configurations,
      serialization: null,
    })

    expect(groups[0].intents.map((intent) => intent.address)).toEqual([
      { scope: 'file', field: 'description' },
    ])
    expect(groups[0].properties['Description']).toBe('Viton o-ring')
    expect(groups[1].intents.map((intent) => intent.address)).toEqual([
      { scope: 'configuration', field: 'config_description', configuration: 'Default' },
    ])
    expect(groups[1].properties['Description']).toBe('Viton, 014')
  })
})

describe('restricting the plan to what is still owed', () => {
  it('writes only the named addresses, leaving confirmed ones alone', () => {
    const groups = buildMetadataWritePlan({
      pending: {
        config_tabs: { 'AS568-014': '014', 'AS568-015': '015' },
      },
      committed: COMMITTED,
      configurations: [{ name: 'AS568-014' }, { name: 'AS568-015' }],
      serialization: null,
      only: [{ scope: 'configuration', field: 'config_tab', configuration: 'AS568-015' }],
    })

    expect(groups.map((group) => group.configuration)).toEqual(['AS568-015'])
    expect(groups[0].properties['Tab Number']).toBe('015')
  })

  it('produces nothing when nothing is owed', () => {
    const groups = buildMetadataWritePlan({
      pending: { part_number: 'BR-202020' },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
      only: [],
    })

    expect(groups.flatMap((group) => group.intents)).toHaveLength(0)
  })
})

describe('the write paths all ask this module', () => {
  const SOURCE_ROOT = join(__dirname, '..', '..')

  it.each([
    join('features', 'source', 'details', 'DetailsPanel.tsx'),
    join('features', 'source', 'browser', 'hooks', 'useConfigHandlers.ts'),
    join('lib', 'commands', 'handlers', 'syncMetadataPlan.ts'),
  ])('%s builds its properties here rather than its own way', (relativePath) => {
    // Three callers previously mapped logical fields to property names themselves, and the details
    // panel's copy filtered empties out, which is what made a full clear unexpressible there.
    // Check-in was a fourth until it stopped writing documents; Sync Metadata took its place here.
    const source = readFileSync(join(SOURCE_ROOT, relativePath), 'utf8')

    expect(source).toContain('buildMetadataWritePlan')
  })
})

describe('the PDM parity properties', () => {
  it('stamps Date and DrawnBy when the caller is making the edit', () => {
    const [group] = buildMetadataWritePlan({
      pending: { description: 'New title' },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
      parity: { date: '2026-08-06', drawnBy: 'Emil' },
    })

    expect(group.properties['Date']).toBe('2026-08-06')
    expect(group.properties['DrawnBy']).toBe('Emil')
  })

  it('leaves them alone when the caller is completing somebody else’s edit', () => {
    // Check-in restamping these would attribute an old edit to whoever ran the check-in.
    const [group] = buildMetadataWritePlan({
      pending: { description: 'New title' },
      committed: COMMITTED,
      configurations: [],
      serialization: null,
    })

    expect('Date' in group.properties).toBe(false)
    expect('DrawnBy' in group.properties).toBe(false)
  })
})
