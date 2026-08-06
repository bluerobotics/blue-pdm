/**
 * What the inline configuration editors owe the document when a field is emptied.
 *
 * Both editors gated `Number` and `Base Item Number` on the base number being truthy, so a user who
 * cleared the item number and then touched a configuration left the old number in the file while
 * the database moved on. The description editor also nested `Tab Number` inside the same
 * condition, which tied a configuration's tab to whether the file had an item number at all.
 */

import { describe, expect, it } from 'vitest'

import {
  buildConfigurationDescriptionWritePlan,
  buildConfigurationTabWritePlan,
} from './configWritePlan'
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

const NUMBERED = file(undefined, row({ part_number: 'BR-100635' }))

describe('editing a configuration tab', () => {
  it('rebuilds the configuration number from the base and the new tab', () => {
    const [group] = buildConfigurationTabWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Number']).toBe('BR-100635-014')
    expect(group.properties['Base Item Number']).toBe('BR-100635')
    expect(group.properties['Tab Number']).toBe('014')
  })

  it('writes the tab empty when the user cleared it', () => {
    const [group] = buildConfigurationTabWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      tabNumber: '',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Tab Number']).toBe('')
    expect(group.properties['Number']).toBe('BR-100635')
  })

  it('empties the number too when the item number itself was cleared', () => {
    const [group] = buildConfigurationTabWritePlan({
      file: file({ part_number: '' }, row({ part_number: 'BR-100635' })),
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Number']).toBe('')
    expect(group.properties['Base Item Number']).toBe('')
  })

  it('leaves the number alone when BluePLM never held one', () => {
    const [group] = buildConfigurationTabWritePlan({
      file: file(undefined, row({})),
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties).not.toHaveProperty('Number')
    expect(group.properties).not.toHaveProperty('Base Item Number')
    expect(group.properties['Tab Number']).toBe('014')
  })

  it('says the tab is what the write is meant to establish', () => {
    const [group] = buildConfigurationTabWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.intents).toContainEqual({
      address: { scope: 'configuration', field: 'config_tab', configuration: 'AS568-014' },
      expected: '014',
    })
  })

  it('leaves the configuration description alone', () => {
    const [group] = buildConfigurationTabWritePlan({
      file: file(undefined, row({ part_number: 'BR-100635', description: 'file level' })),
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties).not.toHaveProperty('Description')
    expect(group.properties).not.toHaveProperty('Revision')
  })
})

describe('editing a configuration description', () => {
  it('writes the description empty when the user cleared it', () => {
    const [group] = buildConfigurationDescriptionWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      description: '',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Description']).toBe('')
  })

  it('empties the number too when the item number itself was cleared', () => {
    const [group] = buildConfigurationDescriptionWritePlan({
      file: file({ part_number: '' }, row({ part_number: 'BR-100635' })),
      configuration: 'AS568-014',
      description: 'O-ring, NBR 70A',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Number']).toBe('')
    expect(group.properties['Base Item Number']).toBe('')
  })

  it('keeps the configuration tab even when the file has no item number', () => {
    const [group] = buildConfigurationDescriptionWritePlan({
      file: file(
        undefined,
        row({ custom_properties: { _config_tabs: { 'AS568-014': '014' } } }),
      ),
      configuration: 'AS568-014',
      description: 'O-ring, NBR 70A',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Tab Number']).toBe('014')
  })

  it('takes the tab the document holds when BluePLM has none for this configuration', () => {
    const [group] = buildConfigurationDescriptionWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      description: 'O-ring, NBR 70A',
      documentTabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.properties['Number']).toBe('BR-100635-014')
    expect(group.properties['Tab Number']).toBe('014')
  })

  it('says the description is what the write is meant to establish', () => {
    const [group] = buildConfigurationDescriptionWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      description: 'O-ring, NBR 70A',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(group.intents).toContainEqual({
      address: {
        scope: 'configuration',
        field: 'config_description',
        configuration: 'AS568-014',
      },
      expected: 'O-ring, NBR 70A',
    })
  })
})

describe('both editors', () => {
  it('open the document once, for the configuration, and not for the number they carry', () => {
    // The number is named so `Number` can be rebuilt from base and tab; it is not what this edit
    // establishes. Once the plan builder started writing the document's own bag for every
    // file-scope address a plan claimed, that distinction became the difference between one
    // service call per committed keystroke and two - the second one rewriting a number nobody
    // touched and recording a file-scope verdict for it.
    const tabPlan = buildConfigurationTabWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })
    const descriptionPlan = buildConfigurationDescriptionWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      description: 'O-ring, NBR 70A',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    for (const groups of [tabPlan, descriptionPlan]) {
      expect(groups).toHaveLength(1)
      expect(groups[0].configuration).toBe('AS568-014')
      expect(groups[0].intents.every((intent) => intent.address.scope === 'configuration')).toBe(
        true,
      )
    }
  })

  it('carry the parity properties', () => {
    for (const [group] of [
      buildConfigurationTabWritePlan({
        file: NUMBERED,
        configuration: 'AS568-014',
        tabNumber: '014',
        serialization: SERIALIZATION,
        parity: PARITY,
      }),
      buildConfigurationDescriptionWritePlan({
        file: NUMBERED,
        configuration: 'AS568-014',
        description: 'O-ring, NBR 70A',
        serialization: SERIALIZATION,
        parity: PARITY,
      }),
    ].map((groups) => groups)) {
      expect(group.properties['Date']).toBe('2026-08-06')
      expect(group.properties['DrawnBy']).toBe('A. Engineer')
    }
  })

  it('write into the configuration the user edited, not the document', () => {
    const [tab] = buildConfigurationTabWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      tabNumber: '014',
      serialization: SERIALIZATION,
      parity: PARITY,
    })
    const [description] = buildConfigurationDescriptionWritePlan({
      file: NUMBERED,
      configuration: 'AS568-014',
      description: 'O-ring, NBR 70A',
      serialization: SERIALIZATION,
      parity: PARITY,
    })

    expect(tab.configuration).toBe('AS568-014')
    expect(description.configuration).toBe('AS568-014')
  })
})
