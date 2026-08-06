import type { LiveSwProcess, SwOwnershipRecord } from './types'

/**
 * Verdict for one live SLDWORKS.exe.
 *
 * `reap` is the only verdict that lets the watchdog touch a process, and it is
 * reachable solely through a provenance record that matches the process on both
 * PID and start time. Every other outcome — including every case the evidence
 * cannot settle — keeps the process running.
 */
export type SwProcessVerdict =
  | 'reap'
  | 'keep-in-use'
  | 'keep-unowned'
  | 'keep-pid-reused'
  | 'keep-unverifiable'

export interface SwClassification {
  verdict: SwProcessVerdict
  reapable: boolean
  /** Log-ready sentence naming the evidence this verdict rests on. */
  reason: string
}

function keep(verdict: Exclude<SwProcessVerdict, 'reap'>, reason: string): SwClassification {
  return { verdict, reapable: false, reason }
}

function describeStartTime(startedAt: number | null): string {
  return startedAt === null ? 'unknown' : new Date(startedAt).toISOString()
}

/**
 * Decides whether the watchdog may reap a SolidWorks process.
 *
 * Pure: everything it needs is in its arguments, so the decision is reproducible
 * from a log line.
 */
export function classifySwProcess(
  proc: LiveSwProcess,
  record: SwOwnershipRecord | undefined,
): SwClassification {
  if (!record) {
    return keep(
      'keep-unowned',
      `BluePLM has no launch record for PID ${proc.pid}, so BluePLM did not start it`,
    )
  }

  if (record.startedAt === null || proc.startedAt === null) {
    return keep(
      'keep-unverifiable',
      `PID ${proc.pid} has a launch record but its identity cannot be confirmed ` +
        `(record start time ${describeStartTime(record.startedAt)}, ` +
        `observed start time ${describeStartTime(proc.startedAt)})`,
    )
  }

  if (record.startedAt !== proc.startedAt) {
    return keep(
      'keep-pid-reused',
      `PID ${proc.pid} was recycled: BluePLM launched a process with this PID at ` +
        `${describeStartTime(record.startedAt)}, but the live one started at ` +
        `${describeStartTime(proc.startedAt)}`,
    )
  }

  if (record.inUse) {
    return keep(
      'keep-in-use',
      `PID ${proc.pid} was launched by BluePLM and is still held by the running service`,
    )
  }

  return {
    verdict: 'reap',
    reapable: true,
    reason:
      `PID ${proc.pid} was launched by BluePLM at ${describeStartTime(record.startedAt)} ` +
      `(session ${record.sessionId}) and is no longer held by any service`,
  }
}

/** Close requests sent to one process before it is left alone for good. */
export const MAX_SW_CLOSE_REQUESTS = 3

/** Time a process is given to act on a close request before it is asked again. */
export const SW_CLOSE_RETRY_INTERVAL_MS = 30_000

export type SwCloseAction = 'request' | 'wait' | 'abandon'

export interface SwClosePlan {
  action: SwCloseAction
  reason: string
}

/**
 * Decides what to do next about a reapable instance.
 *
 * Reaping is always a graceful close request and never a forced kill, even
 * though provenance is proven: an instance BluePLM launched is visible and can
 * be adopted by the user, so it may be holding unsaved work. A process that
 * ignores repeated close requests is usually sitting on a "save changes?"
 * prompt, and is abandoned to the user rather than destroyed.
 */
export function planSwClose(record: SwOwnershipRecord, now: number): SwClosePlan {
  if (record.abandonedAt !== null) {
    return {
      action: 'abandon',
      reason: `PID ${record.pid} was already abandoned at ${describeStartTime(record.abandonedAt)}`,
    }
  }

  if (record.closeRequests >= MAX_SW_CLOSE_REQUESTS) {
    return {
      action: 'abandon',
      reason:
        `PID ${record.pid} ignored ${record.closeRequests} close request(s); ` +
        `leaving it running rather than forcing it, in case it is holding unsaved work`,
    }
  }

  if (
    record.lastCloseRequestAt !== null &&
    now - record.lastCloseRequestAt < SW_CLOSE_RETRY_INTERVAL_MS
  ) {
    return {
      action: 'wait',
      reason: `PID ${record.pid} was asked to close ${now - record.lastCloseRequestAt}ms ago`,
    }
  }

  return {
    action: 'request',
    reason: `Asking PID ${record.pid} to close (attempt ${record.closeRequests + 1} of ${MAX_SW_CLOSE_REQUESTS})`,
  }
}
