import { describe, expect, it } from 'vitest'

import {
  checkSwServiceCompatibility,
  checkSwServiceFeature,
  EXPECTED_SW_SERVICE_VERSION,
  SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ,
} from './swServiceVersion'

describe('a feature floor is not the app floor', () => {
  it('refuses a service one release behind the command it needs', () => {
    // The case that shipped broken: the app-wide check calls 1.20.0 merely outdated - a soft
    // warning - while every call to a command added in 1.21.0 fails.
    expect(checkSwServiceCompatibility('1.20.0').status).toBe('outdated')
    expect(checkSwServiceFeature('1.20.0', '1.21.0').status).toBe('incompatible')
  })

  it('refuses in the same words the Service tab already uses', () => {
    const refusal = checkSwServiceFeature('1.20.0', '1.21.0')

    expect(refusal.message).toBe('Service rebuild required')
    expect(refusal.details).toContain('v1.21.0+')
  })

  it('accepts a service that has the command', () => {
    expect(checkSwServiceFeature('1.21.0', '1.21.0').status).toBe('current')
  })

  it('lets a service past the floor still be reported as behind the app', () => {
    // Once the app expects something later than the floor, a service that has the command but is
    // otherwise stale must not be silently promoted to current.
    expect(checkSwServiceFeature('1.21.0', '1.21.0')).toEqual(
      checkSwServiceCompatibility('1.21.0'),
    )
  })

  it('cannot prove a service that reports no version has the command', () => {
    expect(checkSwServiceFeature(null, '1.21.0').status).toBe('unknown')
  })
})

describe('the versions the app ships against', () => {
  it('expects a service new enough for the vault audit read', () => {
    // The audit's floor can never exceed what the app expects, or a correctly built service would
    // be refused.
    expect(checkSwServiceFeature(EXPECTED_SW_SERVICE_VERSION, SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ).status).toBe(
      'current',
    )
  })
})
