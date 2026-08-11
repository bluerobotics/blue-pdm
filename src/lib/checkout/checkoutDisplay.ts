import { t } from '@/lib/i18n'
import {
  isCheckoutProfileForOwner,
  type CheckoutDisplayState,
  type CheckoutIdentityCarrier,
  type CheckoutUserProfile,
} from '@/types/pdm'

export type CheckoutHydrationHint = 'pending' | 'error'

export interface CheckoutCurrentUser {
  id: string
  email?: string | null
  full_name?: string | null
  avatar_url?: string | null
  custom_avatar_url?: string | null
}

export interface CheckoutDisplay {
  state: CheckoutDisplayState
  ownerId: string | null
  profileId: string | null
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  profile: CheckoutUserProfile | null
}

export interface CheckoutDisplayUser {
  id: string
  name: string
  email?: string
  avatar_url?: string
  isMe: boolean
  displayState: CheckoutDisplayState
  checkoutSignature: string
}

export interface CheckoutDisplayFile {
  pdmData?: Pick<CheckoutIdentityCarrier, 'checked_out_by' | 'checked_out_user'>
}

export function getCheckoutProfileForOwner(
  file: CheckoutDisplayFile | null | undefined,
): CheckoutUserProfile | null {
  const ownerId = file?.pdmData?.checked_out_by ?? null
  const profile = file?.pdmData?.checked_out_user
  return isCheckoutProfileForOwner(profile, ownerId) ? profile : null
}

function getNonEmptyValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function getEmailName(email: string | null): string | null {
  if (!email) return null
  const localPart = email.split('@')[0]?.trim()
  return localPart || email
}

function getHydrationState(
  hint: CheckoutHydrationHint | { state: CheckoutHydrationHint } | null | undefined,
): CheckoutHydrationHint {
  if (typeof hint === 'object' && hint !== null) return hint.state
  return hint ?? 'pending'
}

function getResolvedDisplayName(profile: CheckoutUserProfile): string {
  return (
    getNonEmptyValue(profile.full_name) ||
    getEmailName(getNonEmptyValue(profile.email)) ||
    t('checkoutDisplay.ownerUnavailable')
  )
}

function getCurrentUserAvatarUrl(currentUser: CheckoutCurrentUser): string | null {
  return (
    getNonEmptyValue(currentUser.custom_avatar_url) ||
    getNonEmptyValue(currentUser.avatar_url)
  )
}

/**
 * Derives the render-only checkout state from the authoritative owner and
 * owner-validated profile enrichment. The returned placeholder fields are
 * display text only; they must never be written to a file or cache.
 */
export function deriveCheckoutDisplay(
  file: CheckoutDisplayFile | null | undefined,
  currentUser: CheckoutCurrentUser | null | undefined,
  hydrationHint?: CheckoutHydrationHint | { state: CheckoutHydrationHint } | null,
): CheckoutDisplay {
  const ownerId = file?.pdmData?.checked_out_by ?? null

  if (!ownerId) {
    return {
      state: 'none',
      ownerId: null,
      profileId: null,
      displayName: null,
      email: null,
      avatarUrl: null,
      profile: null,
    }
  }

  const profile = getCheckoutProfileForOwner(file)

  if (currentUser?.id === ownerId) {
    const email = getNonEmptyValue(currentUser.email)
    return {
      state: 'mine',
      ownerId,
      profileId: ownerId,
      displayName:
        getNonEmptyValue(currentUser.full_name) ||
        getEmailName(email) ||
        t('checkoutDisplay.you'),
      email,
      avatarUrl: getCurrentUserAvatarUrl(currentUser),
      profile: profile ?? null,
    }
  }

  if (profile) {
    const email = getNonEmptyValue(profile.email)
    return {
      state: 'resolved',
      ownerId,
      profileId: profile.id,
      displayName: getResolvedDisplayName(profile),
      email,
      avatarUrl: getNonEmptyValue(profile.avatar_url),
      profile,
    }
  }

  const state: CheckoutDisplayState =
    getHydrationState(hydrationHint) === 'error' ? 'unavailable' : 'hydrating'

  return {
    state,
    ownerId,
    profileId: null,
    displayName:
      state === 'hydrating'
        ? t('checkoutDisplay.loadingOwner')
        : t('checkoutDisplay.ownerUnavailable'),
    email: null,
    avatarUrl: null,
    profile: null,
  }
}

/**
 * Produces the one stable identity signature used by memoized checkout rows.
 * JSON encoding keeps separators in user-provided values from colliding.
 */
export function getCheckoutSignature(
  file: CheckoutDisplayFile | null | undefined,
  currentUser: CheckoutCurrentUser | null | undefined,
  hydrationHint?: CheckoutHydrationHint | { state: CheckoutHydrationHint } | null,
): string {
  const display = deriveCheckoutDisplay(file, currentUser, hydrationHint)
  return JSON.stringify([
    display.ownerId,
    display.profileId,
    display.displayName,
    display.email,
    display.avatarUrl,
    display.state,
  ])
}

export function getCheckoutDisplayUser(
  file: CheckoutDisplayFile | null | undefined,
  currentUser: CheckoutCurrentUser | null | undefined,
  hydrationHint?: CheckoutHydrationHint | { state: CheckoutHydrationHint } | null,
): CheckoutDisplayUser | null {
  const display = deriveCheckoutDisplay(file, currentUser, hydrationHint)
  if (display.state === 'none' || !display.ownerId || !display.displayName) return null

  return {
    id: display.ownerId,
    name: display.displayName,
    email: display.email ?? undefined,
    avatar_url: display.avatarUrl ?? undefined,
    isMe: display.state === 'mine',
    displayState: display.state,
    checkoutSignature: getCheckoutSignature(file, currentUser, hydrationHint),
  }
}

export function getCheckoutUsersSignature(
  users: ReadonlyArray<Pick<CheckoutDisplayUser, 'checkoutSignature'>>,
): string {
  return JSON.stringify(users.map((user) => user.checkoutSignature))
}
