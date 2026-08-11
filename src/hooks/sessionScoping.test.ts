import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/performanceMetrics', () => ({ recordMetric: vi.fn() }))
vi.mock('@/stores/pdmStore', () => ({ usePDMStore: vi.fn() }))
vi.mock('@/lib/analytics', () => ({
  clearAnalyticsUser: vi.fn(),
  setAnalyticsUser: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  getUserProfile: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
  linkUserToOrganization: vi.fn(),
  setCurrentAccessToken: vi.fn(),
  signOut: vi.fn(),
  supabase: { auth: { onAuthStateChange: vi.fn() } },
  syncUserSessionsOrgId: vi.fn(),
  updateLastOnline: vi.fn(),
}))
vi.mock('@/lib/supabaseConfig', () => ({ clearConfig: vi.fn() }))
vi.mock('@/lib/userActionLogger', () => ({ logUserAction: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const {
  advanceAuthSessionBoundary,
  isAuthSessionCurrent,
  shouldResetAuthSessionState,
  shouldDeferAutoConnectLoad,
} = await import('./useAuth')
const {
  getLastMergedState,
  resetLoadFilesCoordination,
  runExclusiveLoad,
  setLastMergedState,
  setLoadFilesSessionContext,
} = await import('./loadFilesCoordination')

const VAULT_ID = 'vault-1'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetLoadFilesCoordination()
  vi.stubGlobal('window', { electronAPI: { log: vi.fn() } })
})

describe('auth session boundaries', () => {
  it('does not reset state while establishing the first stored session', () => {
    const initial: { authenticatedUserId: string | null; sessionGeneration: number } = {
      authenticatedUserId: null,
      sessionGeneration: 0,
    }
    const restored = advanceAuthSessionBoundary(initial, 'INITIAL_SESSION', 'user-a')

    expect(restored.sessionGeneration).toBe(1)
    expect(shouldResetAuthSessionState(initial, 'INITIAL_SESSION', 'user-a')).toBe(false)
    expect(shouldResetAuthSessionState(restored, 'SIGNED_IN', 'user-a')).toBe(true)
  })

  it('rejects an old profile handler after sign-out and account change', async () => {
    let current: { authenticatedUserId: string | null; sessionGeneration: number } = {
      authenticatedUserId: null,
      sessionGeneration: 0,
    }
    const userA = advanceAuthSessionBoundary(current, 'SIGNED_IN', 'user-a')
    current = userA

    const oldProfile = deferred<{ id: string }>()
    let committedUser: string | null = null
    const oldHandler = oldProfile.promise.then((profile) => {
      if (isAuthSessionCurrent(userA, current)) {
        committedUser = profile.id
      }
    })

    current = advanceAuthSessionBoundary(current, 'SIGNED_OUT', null)
    const userB = advanceAuthSessionBoundary(current, 'SIGNED_IN', 'user-b')
    current = userB

    oldProfile.resolve({ id: 'user-a' })
    await oldHandler

    expect(committedUser).toBeNull()
    expect(userA.sessionGeneration).toBe(1)
    expect(userB.sessionGeneration).toBe(3)
    expect(
      advanceAuthSessionBoundary(userB, 'TOKEN_REFRESHED', 'user-b'),
    ).toEqual(userB)
  })

  it('rejects late cache and realtime responses from the old session', async () => {
    let current: { authenticatedUserId: string | null; sessionGeneration: number } = {
      authenticatedUserId: null,
      sessionGeneration: 0,
    }
    const userA = advanceAuthSessionBoundary(current, 'SIGNED_IN', 'user-a')
    current = userA
    const oldCacheWrite = deferred<void>()
    const oldRealtimeResponse = deferred<void>()
    let cacheCommitted = false
    let realtimeCommitted = false

    const cacheCommit = oldCacheWrite.promise.then(() => {
      cacheCommitted = isAuthSessionCurrent(userA, current)
    })
    const realtimeCommit = oldRealtimeResponse.promise.then(() => {
      realtimeCommitted = isAuthSessionCurrent(userA, current)
    })

    current = advanceAuthSessionBoundary(current, 'SIGNED_OUT', null)
    current = advanceAuthSessionBoundary(current, 'SIGNED_IN', 'user-b')
    oldCacheWrite.resolve()
    oldRealtimeResponse.resolve()
    await Promise.all([cacheCommit, realtimeCommit])

    expect(cacheCommitted).toBe(false)
    expect(realtimeCommitted).toBe(false)
  })
})

describe('session-scoped load coordination', () => {
  it('queues a new session behind an old session instead of joining it', async () => {
    setLoadFilesSessionContext({
      authenticatedUserId: 'user-a',
      sessionGeneration: 1,
    })
    const firstLoad = deferred<void>()
    let starts = 0

    const first = runExclusiveLoad(
      VAULT_ID,
      { silent: false, forceHashComputation: false, hasChangedPaths: false },
      () => {
        starts += 1
        return firstLoad.promise
      },
    )
    await flushMicrotasks()

    setLoadFilesSessionContext({
      authenticatedUserId: 'user-b',
      sessionGeneration: 3,
    })
    const second = runExclusiveLoad(
      VAULT_ID,
      { silent: false, forceHashComputation: false, hasChangedPaths: false },
      async () => {
        starts += 1
      },
    )

    await flushMicrotasks()
    expect(starts).toBe(1)

    firstLoad.resolve()
    await Promise.all([first, second])
    expect(starts).toBe(2)
  })

  it('invalidates merge shortcuts when the session boundary changes', () => {
    setLoadFilesSessionContext({
      authenticatedUserId: 'user-a',
      sessionGeneration: 1,
    })
    setLastMergedState(VAULT_ID, { scanFingerprint: 'old', storeFileCount: 1 })
    expect(getLastMergedState(VAULT_ID)).toBeDefined()

    setLoadFilesSessionContext({
      authenticatedUserId: 'user-b',
      sessionGeneration: 3,
    })

    expect(getLastMergedState(VAULT_ID)).toBeUndefined()
  })

  it('resolves unauthenticated online loading after auth initialization', () => {
    expect(
      shouldDeferAutoConnectLoad({
        isOfflineMode: false,
        authenticatedUserId: null,
        sessionGeneration: 0,
        authInitialized: true,
      }),
    ).toBe(false)
    expect(
      shouldDeferAutoConnectLoad({
        isOfflineMode: false,
        authenticatedUserId: 'user-a',
        sessionGeneration: 0,
        authInitialized: true,
      }),
    ).toBe(true)
    expect(
      shouldDeferAutoConnectLoad({
        isOfflineMode: false,
        authenticatedUserId: null,
        sessionGeneration: 0,
        authInitialized: false,
      }),
    ).toBe(true)
  })
})
