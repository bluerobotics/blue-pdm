import { describe, expect, it } from 'vitest'

import {
  isCheckoutProfileForOwner,
  reconcileCheckoutProfile,
  type CheckoutIdentityCarrier,
  type CheckoutUserProfile,
} from './pdm'

const FIRST_OWNER_ID = 'owner-a'
const SECOND_OWNER_ID = 'owner-b'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function profile(id: string): CheckoutUserProfile {
  return {
    id,
    email: `${id}@example.test`,
    full_name: id,
    avatar_url: null,
  }
}

describe('checkout identity reconciliation', () => {
  it('rejects a late profile when the checkout owner changed while loading', async () => {
    const profileResponse = deferred<CheckoutUserProfile>()
    const ownerChanged: CheckoutIdentityCarrier = {
      checked_out_by: SECOND_OWNER_ID,
    }

    const lateResult = profileResponse.promise.then((resolvedProfile) =>
      reconcileCheckoutProfile(ownerChanged, resolvedProfile),
    )

    profileResponse.resolve(profile(FIRST_OWNER_ID))

    await expect(lateResult).resolves.toEqual(ownerChanged)
  })

  it('preserves only a profile whose id matches the authoritative owner', () => {
    const hydrated: CheckoutIdentityCarrier = reconcileCheckoutProfile(
      { checked_out_by: FIRST_OWNER_ID },
      profile(FIRST_OWNER_ID),
    )
    const refreshed: CheckoutIdentityCarrier = reconcileCheckoutProfile(
      { ...hydrated, checked_out_at: '2026-08-10T17:00:00.000Z' },
      hydrated.checked_out_user,
    )

    expect(isCheckoutProfileForOwner(refreshed.checked_out_user, FIRST_OWNER_ID)).toBe(true)
    expect(
      reconcileCheckoutProfile(
        { checked_out_by: FIRST_OWNER_ID },
        profile(SECOND_OWNER_ID),
      ),
    ).toEqual({ checked_out_by: FIRST_OWNER_ID })
  })
})
