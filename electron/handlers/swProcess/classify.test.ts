import { describe, expect, it } from 'vitest'

import {
  MAX_SW_CLOSE_REQUESTS,
  SW_CLOSE_RETRY_INTERVAL_MS,
  classifySwProcess,
  planSwClose,
} from './classify'
import type { LiveSwProcess, SwOwnershipRecord } from './types'

const LAUNCHED_AT = Date.parse('2026-08-06T16:15:00.000Z')

function liveProcess(overrides: Partial<LiveSwProcess> = {}): LiveSwProcess {
  return {
    pid: 20396,
    startedAt: LAUNCHED_AT,
    windowTitle: 'SOLIDWORKS 2024 SP5.0',
    ...overrides,
  }
}

function ownershipRecord(overrides: Partial<SwOwnershipRecord> = {}): SwOwnershipRecord {
  return {
    pid: 20396,
    startedAt: LAUNCHED_AT,
    inUse: false,
    sessionId: 'session-a',
    ownerPid: 4242,
    recordedAt: LAUNCHED_AT,
    closeRequests: 0,
    lastCloseRequestAt: null,
    abandonedAt: null,
    ...overrides,
  }
}

describe('classifySwProcess', () => {
  it('reaps an instance BluePLM launched and no longer holds', () => {
    const result = classifySwProcess(liveProcess(), ownershipRecord())

    expect(result.verdict).toBe('reap')
    expect(result.reapable).toBe(true)
  })

  it('keeps an instance BluePLM launched while the service still holds it', () => {
    const result = classifySwProcess(liveProcess(), ownershipRecord({ inUse: true }))

    expect(result.verdict).toBe('keep-in-use')
    expect(result.reapable).toBe(false)
  })

  it('keeps a process BluePLM never launched', () => {
    const result = classifySwProcess(liveProcess(), undefined)

    expect(result.verdict).toBe('keep-unowned')
    expect(result.reapable).toBe(false)
  })

  it('keeps a recycled PID whose live process started after the recorded one', () => {
    const result = classifySwProcess(
      liveProcess({ startedAt: LAUNCHED_AT + 60_000 }),
      ownershipRecord({ startedAt: LAUNCHED_AT }),
    )

    expect(result.verdict).toBe('keep-pid-reused')
    expect(result.reapable).toBe(false)
  })

  it('keeps a process whose start time could not be observed', () => {
    const result = classifySwProcess(liveProcess({ startedAt: null }), ownershipRecord())

    expect(result.verdict).toBe('keep-unverifiable')
    expect(result.reapable).toBe(false)
  })

  it('keeps an instance whose launch was recorded without a start time', () => {
    const result = classifySwProcess(liveProcess(), ownershipRecord({ startedAt: null }))

    expect(result.verdict).toBe('keep-unverifiable')
    expect(result.reapable).toBe(false)
  })

  it('never reaps on window title alone, whatever the title says', () => {
    // The incident this rule replaces: a user's own SolidWorks showing the
    // OpenGL scratch window was killed, while the instance BluePLM had launched
    // showed an ordinary title and was spared. Neither title decides anything.
    const titles = ['__wglDummyWindowFodder', '', 'N/A', 'SOLIDWORKS 2024 SP5.0']

    for (const windowTitle of titles) {
      const unowned = classifySwProcess(liveProcess({ windowTitle }), undefined)
      expect(unowned.reapable).toBe(false)

      const owned = classifySwProcess(liveProcess({ windowTitle }), ownershipRecord())
      expect(owned.reapable).toBe(true)
    }
  })

  it('explains every verdict in terms of the evidence behind it', () => {
    const result = classifySwProcess(liveProcess({ startedAt: null }), ownershipRecord())

    expect(result.reason).toContain('20396')
    expect(result.reason).toContain('unknown')
  })
})

describe('planSwClose', () => {
  const now = LAUNCHED_AT + 3_600_000

  it('asks a reapable instance to close when nothing has been tried yet', () => {
    expect(planSwClose(ownershipRecord(), now).action).toBe('request')
  })

  it('waits before repeating a close request', () => {
    const record = ownershipRecord({
      closeRequests: 1,
      lastCloseRequestAt: now - SW_CLOSE_RETRY_INTERVAL_MS + 1_000,
    })

    expect(planSwClose(record, now).action).toBe('wait')
  })

  it('repeats a close request once the interval has passed', () => {
    const record = ownershipRecord({
      closeRequests: 1,
      lastCloseRequestAt: now - SW_CLOSE_RETRY_INTERVAL_MS - 1,
    })

    expect(planSwClose(record, now).action).toBe('request')
  })

  it('abandons an instance that ignored every close request rather than forcing it', () => {
    const record = ownershipRecord({
      closeRequests: MAX_SW_CLOSE_REQUESTS,
      lastCloseRequestAt: now - SW_CLOSE_RETRY_INTERVAL_MS - 1,
    })

    const plan = planSwClose(record, now)

    expect(plan.action).toBe('abandon')
    expect(plan.reason).toContain('unsaved work')
  })

  it('stays abandoned once abandoned', () => {
    const record = ownershipRecord({ abandonedAt: now - 1_000 })

    expect(planSwClose(record, now).action).toBe('abandon')
  })
})
