import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCustomerCache, isFresh, load, peek, setGeneration, type Query } from './cache'

function counted<T>(key: string, value: T, calls: { n: number }): Query<T> {
  return {
    key,
    run: async () => {
      calls.n++
      return value
    },
  }
}

/** A query whose promise the test resolves by hand. */
function deferred<T>(key: string, calls: { n: number }) {
  let settle: (value: T) => void = () => {}
  const query: Query<T> = {
    key,
    run: () => {
      calls.n++
      return new Promise<T>((resolve) => {
        settle = resolve
      })
    },
  }
  return { query, resolve: (value: T) => settle(value) }
}

beforeEach(() => {
  clearCustomerCache()
  // -1 is the module's initial generation, so this resets rather than clears.
  setGeneration(-1)
  vi.useRealTimers()
})

describe('peek', () => {
  it('returns undefined before anything has resolved', () => {
    const calls = { n: 0 }
    expect(peek(counted('a', 1, calls))).toBeUndefined()
    expect(calls.n).toBe(0)
  })

  it('returns the value once loaded, without starting a request', async () => {
    const calls = { n: 0 }
    const query = counted('a', 42, calls)

    await load(query)

    expect(peek(query)).toBe(42)
    expect(calls.n).toBe(1)
  })
})

describe('load', () => {
  it('shares one in-flight request between concurrent callers', async () => {
    const calls = { n: 0 }
    const { query, resolve } = deferred<string>('facets', calls)

    const first = load(query)
    const second = load(query)

    expect(calls.n).toBe(1)

    resolve('counts')

    expect(await first).toBe('counts')
    expect(await second).toBe('counts')
  })

  it('serves a fresh value without going back to the source', async () => {
    const calls = { n: 0 }
    const query = counted('a', 1, calls)

    await load(query)
    await load(query)

    expect(calls.n).toBe(1)
  })

  it('refetches once the value is stale', async () => {
    vi.useFakeTimers()
    const calls = { n: 0 }
    const query = counted('a', 1, calls)

    await load(query)
    expect(isFresh(query)).toBe(true)

    vi.advanceTimersByTime(61_000)

    expect(isFresh(query)).toBe(false)
    await load(query)
    expect(calls.n).toBe(2)
  })

  it('does not cache a failure', async () => {
    let attempts = 0
    const query: Query<number> = {
      key: 'flaky',
      run: async () => {
        attempts++
        if (attempts === 1) throw new Error('boom')
        return 7
      },
    }

    await expect(load(query)).rejects.toThrow('boom')
    expect(peek(query)).toBeUndefined()

    expect(await load(query)).toBe(7)
  })

  it('keeps the previous value when a revalidation fails', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const query: Query<number> = {
      key: 'flaky',
      run: async () => {
        attempts++
        if (attempts === 1) return 1
        throw new Error('offline')
      },
    }

    await load(query)
    vi.advanceTimersByTime(61_000)

    await expect(load(query)).rejects.toThrow('offline')

    // Stale beats blank: the panel keeps rendering the last good numbers.
    expect(peek(query)).toBe(1)
  })
})

describe('setGeneration', () => {
  it('drops everything when the generation moves', async () => {
    const calls = { n: 0 }
    const query = counted('a', 1, calls)

    await load(query)
    setGeneration(1)

    expect(peek(query)).toBeUndefined()
    await load(query)
    expect(calls.n).toBe(2)
  })

  it('is a no-op when the generation is unchanged', async () => {
    const calls = { n: 0 }
    const query = counted('a', 1, calls)

    setGeneration(3)
    await load(query)
    setGeneration(3)

    expect(peek(query)).toBe(1)
  })

  it('discards a response that lands after the generation moved', async () => {
    const calls = { n: 0 }
    const { query, resolve } = deferred<number>('a', calls)

    const inFlight = load(query)
    setGeneration(9)
    resolve(1)
    await inFlight

    // A sync invalidated the cache mid-request, so this answer describes data
    // that no longer exists and must not be stored.
    expect(peek(query)).toBeUndefined()
  })
})
