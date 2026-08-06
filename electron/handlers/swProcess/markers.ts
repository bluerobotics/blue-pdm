/**
 * The stderr protocol the SolidWorks service uses to hand BluePLM ownership of a
 * SolidWorks process, and what a marker on that stream does and does not prove.
 *
 * Two separate things have to be right here.
 *
 * The first is framing. A marker is a line, and a Node pipe chunk is not a line:
 * `LAUNCHED_PID=23456\n` can arrive as `LAUNCHED_PID=234` followed by `56\n`. A
 * pattern run over a raw chunk reads the first half as a complete marker and
 * claims PID 234 - a process BluePLM never started, and one the watchdog would
 * then be entitled to close. So chunks are buffered into whole lines before any
 * of them is read, and the patterns are anchored to the end of the line so a
 * fragment cannot match even if a caller gets the buffering wrong.
 *
 * The second is evidence. A PID on its own proves nothing: it names whatever
 * currently holds that number. Reading a start time off that process and
 * recording it turns the guess into a record that certifies itself - the
 * classifier will later find the PID and the start time agreeing, because they
 * were copied from the same process, and return `reap`. So a claim is only
 * accepted while the service has announced a launch that has not completed, and
 * only for a process that started after that announcement.
 */

/** Written to stderr when the service is about to call CreateInstance. */
export const SW_LAUNCH_MARKER = '[SW-API] LAUNCHING_SW'

/**
 * Anchored at both ends of a trimmed line. A chunk boundary inside the digits
 * leaves a line that does not end here, so it cannot be read as a whole PID.
 */
const LAUNCHED_PID_PATTERN = /^\[SW-API\] LAUNCHED_PID=(\d+)$/
const RELEASED_PID_PATTERN = /^\[SW-API\] RELEASED_PID=(\d+)$/

export type SwOwnershipMarker =
  | { kind: 'launching' }
  | { kind: 'launched'; pid: number }
  | { kind: 'released'; pid: number }

export interface BufferedLines {
  /** Complete lines, separators removed. */
  lines: string[]
  /** The unterminated tail, to be prepended to the next chunk. */
  rest: string
}

/**
 * Splits a stderr chunk into the lines that are complete, keeping the rest.
 *
 * The tail is returned rather than emitted: a line is only whole once its
 * newline has arrived, and everything downstream depends on that.
 */
export function takeCompleteLines(buffered: string, chunk: string): BufferedLines {
  const combined = buffered + chunk
  const lines = combined.split('\n')
  const rest = lines.pop() ?? ''

  return { lines: lines.map((line) => line.replace(/\r$/, '')), rest }
}

/** Reads the ownership marker one complete line carries, if it carries one. */
export function readSwOwnershipMarker(line: string): SwOwnershipMarker | null {
  const trimmed = line.trim()

  if (trimmed === SW_LAUNCH_MARKER) return { kind: 'launching' }

  const launched = LAUNCHED_PID_PATTERN.exec(trimmed)
  if (launched) return { kind: 'launched', pid: Number.parseInt(launched[1], 10) }

  const released = RELEASED_PID_PATTERN.exec(trimmed)
  if (released) return { kind: 'released', pid: Number.parseInt(released[1], 10) }

  return null
}

/**
 * Slack between the service writing the launch announcement and this process
 * timestamping the line it read back off the pipe. The process is created after
 * the announcement, so its start time can only appear earlier than the
 * announcement by the pipe latency and the clock granularity behind both.
 */
export const SW_LAUNCH_CLAIM_TOLERANCE_MS = 5_000

/**
 * How long an announced launch stays claimable. CreateInstance can block for
 * tens of seconds, so this is generous; it exists only so a window cannot be
 * left open indefinitely by a launch that never reported a PID.
 */
export const SW_LAUNCH_WINDOW_MAX_AGE_MS = 10 * 60_000

export type SwLaunchProof = { proven: true } | { proven: false; reason: string }

export interface SwLaunchClaim {
  pid: number
  /** Creation time read off the process now holding that PID. */
  observedStartedAt: number | null
  /** When the service announced the launch, or null if it never did. */
  launchWindowOpenedAt: number | null
  now: number
}

/**
 * Whether a claimed PID can be shown to be the process the service just
 * launched, rather than whatever happens to hold that number.
 *
 * Everything it cannot prove it refuses, which costs at worst a leaked hidden
 * SolidWorks that has to be closed by hand. Accepting a claim it cannot prove
 * costs the user's own SolidWorks.
 */
export function proveSwLaunch(claim: SwLaunchClaim): SwLaunchProof {
  if (!Number.isInteger(claim.pid) || claim.pid <= 0) {
    return { proven: false, reason: `${claim.pid} is not a process id` }
  }

  if (claim.launchWindowOpenedAt === null) {
    return {
      proven: false,
      reason: 'the service never announced a launch, so nothing here was started by BluePLM',
    }
  }

  const windowAge = claim.now - claim.launchWindowOpenedAt
  if (windowAge > SW_LAUNCH_WINDOW_MAX_AGE_MS) {
    return {
      proven: false,
      reason: `the launch was announced ${windowAge}ms ago, longer than a launch can take`,
    }
  }

  if (claim.observedStartedAt === null) {
    return {
      proven: false,
      reason:
        'Windows would not report when the process started, so it cannot be told apart ' +
        'from a recycled PID and must not be recorded as ours',
    }
  }

  if (claim.observedStartedAt < claim.launchWindowOpenedAt - SW_LAUNCH_CLAIM_TOLERANCE_MS) {
    return {
      proven: false,
      reason:
        `the process holding this PID started at ${new Date(claim.observedStartedAt).toISOString()}, ` +
        `before the launch was announced at ${new Date(claim.launchWindowOpenedAt).toISOString()}, ` +
        'so it was already running and BluePLM did not start it',
    }
  }

  return { proven: true }
}
