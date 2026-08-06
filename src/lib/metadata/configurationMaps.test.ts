import { describe, expect, it } from 'vitest'

import {
  buildConfigurationMapPayload,
  mergeConfigurationMap,
  readConfigurationMap,
} from './configurationMaps'

/** The ORING fixture's shape: many configurations, each with its own tab number. */
const ORING_CONFIGURATION_COUNT = 68

function oringConfigTabs(): Record<string, string> {
  const tabs: Record<string, string> = {}
  for (let index = 0; index < ORING_CONFIGURATION_COUNT; index++) {
    tabs[`AS568-${String(index + 1).padStart(3, '0')}`] = String(100 + index)
  }
  return tabs
}

describe('readConfigurationMap', () => {
  it('reads a reserved map out of custom_properties', () => {
    const properties = { Material: 'BUNA-70A', _config_tabs: { Default: '001' } }
    expect(readConfigurationMap(properties, '_config_tabs')).toEqual({ Default: '001' })
  })

  it('reads an absent, null or non-object map as empty', () => {
    expect(readConfigurationMap(undefined, '_config_tabs')).toEqual({})
    expect(readConfigurationMap(null, '_config_tabs')).toEqual({})
    expect(readConfigurationMap({}, '_config_tabs')).toEqual({})
    expect(readConfigurationMap({ _config_tabs: null }, '_config_tabs')).toEqual({})
    expect(readConfigurationMap({ _config_tabs: 'nope' }, '_config_tabs')).toEqual({})
    expect(readConfigurationMap({ _config_tabs: ['nope'] }, '_config_tabs')).toEqual({})
  })

  it('coerces numeric entries, which JSONB round-trips as numbers', () => {
    expect(readConfigurationMap({ _config_tabs: { Default: 12 } }, '_config_tabs')).toEqual({
      Default: '12',
    })
  })
})

describe('mergeConfigurationMap', () => {
  it('overlays the edited configurations onto the committed ones', () => {
    const merged = mergeConfigurationMap({ A: '1', B: '2' }, { B: '9' })
    expect(merged).toEqual({ A: '1', B: '9' })
  })

  it('keeps an intentional clear as an empty value rather than dropping it', () => {
    expect(mergeConfigurationMap({ A: '1' }, { A: '' })).toEqual({ A: '' })
  })

  it('returns the committed map unchanged when there is no pending edit', () => {
    expect(mergeConfigurationMap({ A: '1' }, undefined)).toEqual({ A: '1' })
  })
})

describe('buildConfigurationMapPayload', () => {
  it('sends no patch when the user edited no configuration', () => {
    expect(buildConfigurationMapPayload({ _config_tabs: { A: '1' } }, undefined)).toBeNull()
    expect(buildConfigurationMapPayload({ _config_tabs: { A: '1' } }, {})).toBeNull()
    expect(
      buildConfigurationMapPayload({ _config_tabs: { A: '1' } }, { config_tabs: {} }),
    ).toBeNull()
  })

  // This is the bug. One configuration edited on the 68-configuration fixture used to send a map
  // of one, which `jsonb ||` then wrote over the whole committed map.
  it('keeps the 67 configurations the user did not edit when one is edited', () => {
    const committed = oringConfigTabs()
    const editedConfiguration = 'AS568-014'

    const payload = buildConfigurationMapPayload(
      { _config_tabs: committed },
      { config_tabs: { [editedConfiguration]: '999' } },
    )

    expect(payload).not.toBeNull()
    expect(Object.keys(payload!._config_tabs ?? {})).toHaveLength(ORING_CONFIGURATION_COUNT)
    expect(payload!._config_tabs?.[editedConfiguration]).toBe('999')

    for (const [configuration, tab] of Object.entries(committed)) {
      if (configuration === editedConfiguration) continue
      expect(payload!._config_tabs?.[configuration]).toBe(tab)
    }
  })

  it('sends only the map that was edited', () => {
    const payload = buildConfigurationMapPayload(
      { _config_tabs: { A: '1' }, _config_descriptions: { A: 'O-ring' } },
      { config_tabs: { A: '2' } },
    )

    expect(payload).toEqual({ _config_tabs: { A: '2' } })
    expect(payload).not.toHaveProperty('_config_descriptions')
  })

  it('sends both maps when both were edited', () => {
    const payload = buildConfigurationMapPayload(
      { _config_tabs: { A: '1', B: '2' }, _config_descriptions: { A: 'first', B: 'second' } },
      { config_tabs: { B: '9' }, config_descriptions: { A: 'edited' } },
    )

    expect(payload).toEqual({
      _config_tabs: { A: '1', B: '9' },
      _config_descriptions: { A: 'edited', B: 'second' },
    })
  })

  it('sends the edit alone when the row has no committed map yet', () => {
    expect(buildConfigurationMapPayload(null, { config_tabs: { A: '1' } })).toEqual({
      _config_tabs: { A: '1' },
    })
  })

  it('does not mutate the committed map it was given', () => {
    const customProperties = { _config_tabs: { A: '1' } }
    buildConfigurationMapPayload(customProperties, { config_tabs: { B: '2' } })
    expect(customProperties._config_tabs).toEqual({ A: '1' })
  })
})
