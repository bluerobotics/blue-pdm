import { beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_POLL_FAILURES,
  OUTDATED_API_MESSAGE,
  failureMessage,
  recordPollFailure,
  resetPollFailures,
} from './syncPollFailures'

beforeEach(() => {
  resetPollFailures()
})

describe('recordPollFailure', () => {
  it('tolerates failures below the ceiling', () => {
    for (let attempt = 1; attempt < MAX_POLL_FAILURES; attempt++) {
      const failure = recordPollFailure(404)
      expect(failure.consecutive).toBe(attempt)
      expect(failure.exhausted).toBe(false)
    }
  })

  it('gives up once the ceiling is reached', () => {
    const failures = Array.from({ length: MAX_POLL_FAILURES }, () => recordPollFailure(404))
    const last = failures[failures.length - 1]

    expect(last.consecutive).toBe(MAX_POLL_FAILURES)
    expect(last.exhausted).toBe(true)
    expect(last.message).toBe(OUTDATED_API_MESSAGE)
  })

  it('counts consecutively, so a success in between starts over', () => {
    recordPollFailure(500)
    recordPollFailure(500)
    resetPollFailures()

    // Without the reset this read would be the third in a row and give up.
    expect(recordPollFailure(500).exhausted).toBe(false)
  })

  it('counts failures of differing causes towards the same ceiling', () => {
    recordPollFailure(null)
    recordPollFailure(500)

    // A run of unrelated faults is still a run: what matters is that nothing
    // has been read back, not why each individual read failed.
    expect(recordPollFailure(404).exhausted).toBe(true)
  })
})

describe('failureMessage', () => {
  it('names a stale deploy for a 404, since retrying cannot fix it', () => {
    expect(failureMessage(404)).toBe(OUTDATED_API_MESSAGE)
    expect(failureMessage(404)).toContain('Redeploy the API server')
  })

  it('reports the status for other server errors', () => {
    expect(failureMessage(500)).toContain('HTTP 500')
    expect(failureMessage(500)).not.toBe(OUTDATED_API_MESSAGE)
  })

  it('says the server was unreachable when there was no response at all', () => {
    expect(failureMessage(null)).toContain('could not be reached')
  })

  it('never claims a running sync was disturbed', () => {
    // Reading progress and running the sync are separate concerns on separate
    // requests, so a failed read must not imply the run itself is in trouble.
    for (const status of [404, 500, null]) {
      expect(failureMessage(status)).toContain('unaffected')
    }
  })
})
