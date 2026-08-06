import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { classifySwProcess } from './classify'
import {
  abandonSwProcess,
  forgetSwProcess,
  getSwOwnershipRecord,
  hasSwReapCandidates,
  initSwOwnershipStore,
  listSwOwnershipRecords,
  noteSwCloseRequest,
  recordSwLaunch,
  releaseAllSwProcesses,
  releaseSwProcess,
} from './ownership'
import type { LiveSwProcess } from './types'

const LAUNCHED_AT = Date.parse('2026-08-06T16:15:00.000Z')

let storeDir: string
let storeFile: string

function initStore(options: { sessionId: string; alivePids?: number[] }): void {
  const alive = new Set(options.alivePids ?? [])
  initSwOwnershipStore({
    filePath: storeFile,
    sessionId: options.sessionId,
    isProcessAlive: (pid) => alive.has(pid),
  })
}

function liveProcess(pid: number, startedAt: number | null): LiveSwProcess {
  return { pid, startedAt, windowTitle: '__wglDummyWindowFodder' }
}

beforeEach(async () => {
  storeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'blueplm-sw-ownership-'))
  storeFile = path.join(storeDir, 'sw-owned-processes.json')
})

afterEach(async () => {
  await fs.promises.rm(storeDir, { recursive: true, force: true })
})

describe('SolidWorks ownership registry', () => {
  it('starts empty, so nothing on the machine is a cleanup candidate', () => {
    initStore({ sessionId: 'session-a' })

    expect(listSwOwnershipRecords()).toEqual([])
    expect(hasSwReapCandidates()).toBe(false)
  })

  it('holds a launched instance until the service releases it', () => {
    initStore({ sessionId: 'session-a' })
    recordSwLaunch(20396, LAUNCHED_AT)

    expect(hasSwReapCandidates()).toBe(false)

    releaseSwProcess(20396)

    expect(hasSwReapCandidates()).toBe(true)
    expect(getSwOwnershipRecord(20396)?.inUse).toBe(false)
  })

  it('adopts instances left behind when the app that launched them is gone', () => {
    initStore({ sessionId: 'session-a', alivePids: [process.pid] })
    recordSwLaunch(20396, LAUNCHED_AT)

    // A crash: no release, no clean shutdown, and a new app run starts.
    initStore({ sessionId: 'session-b', alivePids: [] })

    const record = getSwOwnershipRecord(20396)
    expect(record?.inUse).toBe(false)
    expect(record?.sessionId).toBe('session-a')
    expect(classifySwProcess(liveProcess(20396, LAUNCHED_AT), record).verdict).toBe('reap')
  })

  it('leaves instances alone while the app holding them is still running', () => {
    initStore({ sessionId: 'session-a', alivePids: [process.pid] })
    recordSwLaunch(20396, LAUNCHED_AT)

    // A second app run finds a record whose owner is still alive.
    initStore({ sessionId: 'session-b', alivePids: [process.pid] })

    const record = getSwOwnershipRecord(20396)
    expect(record?.inUse).toBe(true)
    expect(classifySwProcess(liveProcess(20396, LAUNCHED_AT), record).reapable).toBe(false)
  })

  it('will not let a recycled PID inherit a previous runs ownership', () => {
    initStore({ sessionId: 'session-a', alivePids: [process.pid] })
    recordSwLaunch(20396, LAUNCHED_AT)
    initStore({ sessionId: 'session-b', alivePids: [] })

    // Same PID, different process: Windows handed the number to something else.
    const stranger = liveProcess(20396, LAUNCHED_AT + 120_000)

    expect(classifySwProcess(stranger, getSwOwnershipRecord(20396)).verdict).toBe('keep-pid-reused')
  })

  it('records a launch whose start time is unknown as permanently unmatched', () => {
    initStore({ sessionId: 'session-a' })
    recordSwLaunch(20396, null)
    releaseSwProcess(20396)

    const verdict = classifySwProcess(
      liveProcess(20396, LAUNCHED_AT),
      getSwOwnershipRecord(20396),
    ).verdict

    expect(verdict).toBe('keep-unverifiable')
  })

  it('releases every instance this run launched when the service dies', () => {
    initStore({ sessionId: 'session-a' })
    recordSwLaunch(20396, LAUNCHED_AT)
    recordSwLaunch(12340, LAUNCHED_AT + 1_000)

    const released = releaseAllSwProcesses()

    expect(released.map((record) => record.pid).sort()).toEqual([12340, 20396])
    expect(hasSwReapCandidates()).toBe(true)
  })

  it('stops treating an abandoned instance as a candidate, so scanning stops too', () => {
    initStore({ sessionId: 'session-a' })
    recordSwLaunch(20396, LAUNCHED_AT)
    releaseSwProcess(20396)
    noteSwCloseRequest(20396, LAUNCHED_AT + 1_000)

    expect(getSwOwnershipRecord(20396)?.closeRequests).toBe(1)
    expect(hasSwReapCandidates()).toBe(true)

    abandonSwProcess(20396, LAUNCHED_AT + 2_000)

    expect(hasSwReapCandidates()).toBe(false)
  })

  it('forgets a record when its process is gone', () => {
    initStore({ sessionId: 'session-a' })
    recordSwLaunch(20396, LAUNCHED_AT)

    forgetSwProcess(20396)

    expect(getSwOwnershipRecord(20396)).toBeUndefined()
    initStore({ sessionId: 'session-b', alivePids: [] })
    expect(listSwOwnershipRecords()).toEqual([])
  })

  it('survives a corrupt registry file without inventing ownership', async () => {
    await fs.promises.writeFile(storeFile, 'not json at all', 'utf8')

    initStore({ sessionId: 'session-a' })

    expect(listSwOwnershipRecords()).toEqual([])
    expect(classifySwProcess(liveProcess(20396, LAUNCHED_AT), undefined).reapable).toBe(false)
  })
})
