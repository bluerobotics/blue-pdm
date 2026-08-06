import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  awaitFileWritesSettled,
  beginMetadataWrite,
  configurationWriteKey,
  endMetadataWrite,
  fileWriteKey,
  isConfigurationWriteInFlight,
  isFileWriteInFlight,
  metadataWritesInFlight,
  resetMetadataWritesInFlight,
  subscribeToMetadataWrites,
} from './writeInFlight'

const PATH = 'C:/vault/o-ring.sldprt'
const OTHER = 'C:/vault/gasket.sldprt'

afterEach(() => {
  resetMetadataWritesInFlight()
  vi.useRealTimers()
})

describe('the set anything can ask, not only React', () => {
  // The set used to be a `useState` in `FilePane`. A command handler cannot read component state,
  // so check-in - the guard that actually matters - could not consult it.
  it('answers outside a component', () => {
    beginMetadataWrite(configurationWriteKey(PATH, 'AS568-014'))

    expect(isFileWriteInFlight(metadataWritesInFlight(), PATH)).toBe(true)
    expect(isFileWriteInFlight(metadataWritesInFlight(), OTHER)).toBe(false)
  })

  it('tells a file-scope save apart from one configuration’s', () => {
    beginMetadataWrite(configurationWriteKey(PATH, 'AS568-014'))

    expect(isConfigurationWriteInFlight(metadataWritesInFlight(), PATH, 'AS568-014')).toBe(true)
    expect(isConfigurationWriteInFlight(metadataWritesInFlight(), PATH, 'AS568-015')).toBe(false)
    expect(isFileWriteInFlight(metadataWritesInFlight(), PATH)).toBe(true)
  })

  it('does not mistake a path that starts with another for the same file', () => {
    beginMetadataWrite(fileWriteKey(`${PATH}.bak`))

    expect(isFileWriteInFlight(metadataWritesInFlight(), PATH)).toBe(false)
  })

  it('keeps the file busy until every scope inside it finishes', () => {
    beginMetadataWrite(configurationWriteKey(PATH, 'AS568-014'))
    beginMetadataWrite(configurationWriteKey(PATH, 'AS568-015'))

    endMetadataWrite(configurationWriteKey(PATH, 'AS568-014'))
    expect(isFileWriteInFlight(metadataWritesInFlight(), PATH)).toBe(true)

    endMetadataWrite(configurationWriteKey(PATH, 'AS568-015'))
    expect(isFileWriteInFlight(metadataWritesInFlight(), PATH)).toBe(false)
  })

  it('hands React a set that keeps its identity until it changes', () => {
    const before = metadataWritesInFlight()
    expect(metadataWritesInFlight()).toBe(before)

    beginMetadataWrite(fileWriteKey(PATH))
    const during = metadataWritesInFlight()
    expect(during).not.toBe(before)

    beginMetadataWrite(fileWriteKey(PATH))
    expect(metadataWritesInFlight()).toBe(during)
  })

  it('tells subscribers when a write starts and when it ends', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToMetadataWrites(listener)

    beginMetadataWrite(fileWriteKey(PATH))
    endMetadataWrite(fileWriteKey(PATH))
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    beginMetadataWrite(fileWriteKey(PATH))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('waiting for a write already running against the file', () => {
  it('returns at once when nothing is running', async () => {
    await expect(awaitFileWritesSettled(PATH, 1_000)).resolves.toBe(true)
  })

  it('resolves when the last scope finishes', async () => {
    beginMetadataWrite(configurationWriteKey(PATH, 'AS568-014'))
    beginMetadataWrite(configurationWriteKey(PATH, 'AS568-015'))

    const settled = awaitFileWritesSettled(PATH, 5_000)
    endMetadataWrite(configurationWriteKey(PATH, 'AS568-014'))
    endMetadataWrite(configurationWriteKey(PATH, 'AS568-015'))

    await expect(settled).resolves.toBe(true)
  })

  it('is not woken by another file’s write finishing', async () => {
    vi.useFakeTimers()
    beginMetadataWrite(fileWriteKey(PATH))
    beginMetadataWrite(fileWriteKey(OTHER))

    const settled = awaitFileWritesSettled(PATH, 1_000)
    endMetadataWrite(fileWriteKey(OTHER))

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(settled).resolves.toBe(false)
  })

  it('gives up rather than waiting forever on a write that never ends', async () => {
    vi.useFakeTimers()
    beginMetadataWrite(fileWriteKey(PATH))

    const settled = awaitFileWritesSettled(PATH, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    // A caller that times out has learnt something true and must decline, not write over it.
    await expect(settled).resolves.toBe(false)
  })
})
