import { describe, expect, it } from 'vitest'

import type { CheckoutUserProfile } from '@/types/pdm'
import { getInitials } from '@/lib/utils'
import {
  deriveCheckoutDisplay,
  getCheckoutDisplayUser,
  getCheckoutSignature,
} from './checkoutDisplay'

const OWNER_ID = 'owner-1'
const CURRENT_USER_ID = 'current-user'

const profile: CheckoutUserProfile = {
  id: OWNER_ID,
  email: 'owner@example.com',
  full_name: 'Owner One',
  avatar_url: 'https://example.com/owner.png',
}

function checkedOutFile(checkedOutUser?: CheckoutUserProfile) {
  return {
    pdmData: {
      checked_out_by: OWNER_ID,
      ...(checkedOutUser ? { checked_out_user: checkedOutUser } : {}),
    },
  }
}

const currentUser = {
  id: CURRENT_USER_ID,
  email: 'current@example.com',
  full_name: 'Current User',
  avatar_url: null,
}

describe('checkout display derivation', () => {
  it('maps the five render-only states from owner and profile data', () => {
    expect(deriveCheckoutDisplay({ pdmData: { checked_out_by: null } }, currentUser).state).toBe(
      'none',
    )
    expect(
      deriveCheckoutDisplay(
        { pdmData: { checked_out_by: CURRENT_USER_ID } },
        currentUser,
      ).state,
    ).toBe('mine')
    expect(deriveCheckoutDisplay(checkedOutFile(profile), currentUser).state).toBe('resolved')
    expect(deriveCheckoutDisplay(checkedOutFile(), currentUser, 'pending').state).toBe('hydrating')
    expect(deriveCheckoutDisplay(checkedOutFile(), currentUser, 'error').state).toBe('unavailable')
  })

  it.each(['list', 'grid', 'tree', 'details', 'pending'])(
    'changes the shared signature for a profile-only update in the %s surface',
    () => {
      const before = getCheckoutSignature(checkedOutFile(), currentUser, 'pending')
      const after = getCheckoutSignature(checkedOutFile(profile), currentUser, 'pending')

      expect(after).not.toBe(before)
    },
  )

  it('keeps unresolved placeholders render-only and never persists them', () => {
    const file = checkedOutFile()
    const before = JSON.stringify(file)
    const display = deriveCheckoutDisplay(file, currentUser, 'pending')
    const displayUser = getCheckoutDisplayUser(file, currentUser, 'pending')

    expect(display.state).toBe('hydrating')
    expect(display.displayName).not.toBe('Someone')
    expect(getInitials(display.displayName, { placeholder: true })).toBe('?')
    expect(displayUser?.name).toBe(display.displayName)
    expect(JSON.stringify(file)).toBe(before)
    expect(file.pdmData.checked_out_user).toBeUndefined()
  })

  it('rejects enrichment attached to a different owner', () => {
    const file = {
      pdmData: {
        checked_out_by: OWNER_ID,
        checked_out_user: { ...profile, id: 'other-owner' },
      },
    }

    const display = deriveCheckoutDisplay(file, currentUser, 'error')

    expect(display.state).toBe('unavailable')
    expect(display.profile).toBeNull()
    expect(display.profileId).toBeNull()
  })
})
