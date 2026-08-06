import { describe, expect, it } from 'vitest'

import {
  proveSwLaunch,
  readSwOwnershipMarker,
  SW_LAUNCH_CLAIM_TOLERANCE_MS,
  SW_LAUNCH_WINDOW_MAX_AGE_MS,
  takeCompleteLines,
  type SwOwnershipMarker,
} from './markers'

/** Feeds chunks through the buffer the way the stderr handler does. */
function readMarkers(chunks: string[]): SwOwnershipMarker[] {
  const markers: SwOwnershipMarker[] = []
  let buffered = ''

  for (const chunk of chunks) {
    const { lines, rest } = takeCompleteLines(buffered, chunk)
    buffered = rest

    for (const line of lines) {
      const marker = readSwOwnershipMarker(line)
      if (marker) markers.push(marker)
    }
  }

  return markers
}

describe('takeCompleteLines', () => {
  it('holds back a line that has no newline yet', () => {
    expect(takeCompleteLines('', '[SW-API] LAUNCHED_PID=234')).toEqual({
      lines: [],
      rest: '[SW-API] LAUNCHED_PID=234',
    })
  })

  it('strips the carriage return the service writes', () => {
    expect(takeCompleteLines('', 'one\r\ntwo\r\n').lines).toEqual(['one', 'two'])
  })
})

describe('reading ownership markers off a chunked stream', () => {
  it('does not claim a pid whose digits are split across two chunks', () => {
    // The defect: `.match()` over the first chunk alone reads a complete
    // LAUNCHED_PID=234 and hands PID 234 to the ownership registry.
    const markers = readMarkers(['[SW-API] LAUNCHED_PID=234', '56\n'])

    expect(markers).toEqual([{ kind: 'launched', pid: 23456 }])
    expect(markers).not.toContainEqual({ kind: 'launched', pid: 234 })
  })

  it('does not claim a pid at all until its line is complete', () => {
    expect(readMarkers(['[SW-API] LAUNCHED_PID=234'])).toEqual([])
  })

  it('survives a split anywhere in the marker', () => {
    const line = '[SW-API] LAUNCHED_PID=23456\n'

    for (let cut = 1; cut < line.length; cut++) {
      expect(readMarkers([line.slice(0, cut), line.slice(cut)])).toEqual([
        { kind: 'launched', pid: 23456 },
      ])
    }
  })

  it('reads every marker when several arrive in one chunk', () => {
    // `.match()` returns the first hit only, so the second was silently dropped.
    const markers = readMarkers([
      '[SW-API] LAUNCHING_SW\n[SW-API] LAUNCHED_PID=111\n[SW-API] RELEASED_PID=222\n',
    ])

    expect(markers).toEqual([
      { kind: 'launching' },
      { kind: 'launched', pid: 111 },
      { kind: 'released', pid: 222 },
    ])
  })

  it('does not strand a record by truncating a release', () => {
    expect(readMarkers(['[SW-API] RELEASED_PID=99', '887\n'])).toEqual([
      { kind: 'released', pid: 99887 },
    ])
  })

  it('ignores ordinary service chatter', () => {
    expect(
      readMarkers(['[SW-API] Connected to existing SolidWorks instance\n[Service] Ping\n']),
    ).toEqual([])
  })

  it('does not read a marker quoted inside another line', () => {
    expect(readMarkers(['[Service] saw "[SW-API] LAUNCHED_PID=23456" in the log\n'])).toEqual([])
  })
})

describe('proveSwLaunch', () => {
  const announced = Date.parse('2026-08-06T12:00:00.000Z')

  it('accepts a process that started after the launch was announced', () => {
    expect(
      proveSwLaunch({
        pid: 23456,
        observedStartedAt: announced + 1_200,
        launchWindowOpenedAt: announced,
        now: announced + 40_000,
      }),
    ).toEqual({ proven: true })
  })

  it('refuses a process that was already running when the launch was announced', () => {
    // The collision the truncated PID produces: 234 belongs to the user's own
    // SolidWorks, started hours ago. Reading its start time and recording it
    // would mint a record that certifies itself.
    const proof = proveSwLaunch({
      pid: 234,
      observedStartedAt: announced - 3_600_000,
      launchWindowOpenedAt: announced,
      now: announced + 500,
    })

    expect(proof.proven).toBe(false)
    expect(proof).toMatchObject({ reason: expect.stringContaining('already running') })
  })

  it('refuses a claim the service never announced a launch for', () => {
    const proof = proveSwLaunch({
      pid: 23456,
      observedStartedAt: announced,
      launchWindowOpenedAt: null,
      now: announced,
    })

    expect(proof.proven).toBe(false)
    expect(proof).toMatchObject({ reason: expect.stringContaining('never announced') })
  })

  it('refuses a process whose start time Windows would not report', () => {
    const proof = proveSwLaunch({
      pid: 23456,
      observedStartedAt: null,
      launchWindowOpenedAt: announced,
      now: announced + 1_000,
    })

    expect(proof.proven).toBe(false)
    expect(proof).toMatchObject({ reason: expect.stringContaining('recycled PID') })
  })

  it('refuses a claim against an announcement too old to still be that launch', () => {
    const proof = proveSwLaunch({
      pid: 23456,
      observedStartedAt: announced + SW_LAUNCH_WINDOW_MAX_AGE_MS + 2_000,
      launchWindowOpenedAt: announced,
      now: announced + SW_LAUNCH_WINDOW_MAX_AGE_MS + 2_000,
    })

    expect(proof.proven).toBe(false)
    expect(proof).toMatchObject({ reason: expect.stringContaining('longer than a launch can take') })
  })

  it('allows for the pipe latency behind the announcement it is compared against', () => {
    // The service writes the announcement, then creates the process; this side
    // timestamps the line only once it has been read back off the pipe, so the
    // process can legitimately look very slightly older than the announcement.
    expect(
      proveSwLaunch({
        pid: 23456,
        observedStartedAt: announced - SW_LAUNCH_CLAIM_TOLERANCE_MS + 1,
        launchWindowOpenedAt: announced,
        now: announced + 1_000,
      }),
    ).toEqual({ proven: true })

    expect(
      proveSwLaunch({
        pid: 23456,
        observedStartedAt: announced - SW_LAUNCH_CLAIM_TOLERANCE_MS - 1,
        launchWindowOpenedAt: announced,
        now: announced + 1_000,
      }).proven,
    ).toBe(false)
  })

  it('refuses anything that is not a process id', () => {
    for (const pid of [0, -1, Number.NaN]) {
      expect(
        proveSwLaunch({
          pid,
          observedStartedAt: announced,
          launchWindowOpenedAt: announced,
          now: announced,
        }).proven,
      ).toBe(false)
    }
  })
})
