/**
 * Tracking for status reads that fail while a customer sync is being watched.
 *
 * Split out from useCustomerSync so the give-up rule can be exercised without a
 * DOM: this module owns the counting and the wording, the hook owns the store
 * writes and the timer.
 */

/**
 * How many status reads in a row may fail before the poller gives up and says
 * why.
 *
 * An API older than this app has no status route at all, so every poll 404s and
 * no run ever arrives to display. Without a ceiling that reads as an indefinite
 * 'Starting…' with no way out - the run is invisible, and the only button on
 * offer is a Stop that 404s for the same reason.
 */
export const MAX_POLL_FAILURES = 3

/**
 * What the API's own 404 handler says for a path it has no route for.
 *
 * Matching on it is what separates "this build has no cancel route" from the
 * cancel route's own 404, which says there was nothing to stop. Both arrive as
 * 404 NOT_FOUND and they call for opposite reactions, so the message is the
 * only thing that tells them apart. Keep in step with the notFoundHandler in
 * api/server.ts.
 */
export const ROUTE_MISSING_MESSAGE = 'Endpoint not found'

/**
 * The one failure here that is not transient: an API older than this app has no
 * progress or cancel routes at all, so retrying will never help.
 */
export const OUTDATED_API_MESSAGE =
  'The API server is running an older build than this app expects, so it cannot ' +
  'report on a sync or stop one. Any sync already running is unaffected. ' +
  'Redeploy the API server to fix this.'

export interface PollFailure {
  /** How many reads have now failed back to back. */
  consecutive: number
  /** True once the poller should stop and surface `message`. */
  exhausted: boolean
  /** Why it is failing, in terms of what the reader can do about it. */
  message: string
}

/**
 * Counted rather than acted on immediately because a single failed poll is
 * routine - a redeploy, a dropped connection - and tearing a live run's
 * progress down over one blip would be worse than waiting another two seconds.
 */
let consecutive = 0

/** Why the status reads are failing, in terms of what the reader can do. */
export function failureMessage(status: number | null): string {
  if (status === 404) return OUTDATED_API_MESSAGE
  const detail = status === null ? 'it could not be reached' : `it returned HTTP ${status}`
  return `Could not read sync progress from the API server - ${detail}. Any sync already running is unaffected; reopen this view to pick it up again.`
}

/** Record a failed read and report whether the poller should give up. */
export function recordPollFailure(status: number | null): PollFailure {
  consecutive += 1
  return {
    consecutive,
    exhausted: consecutive >= MAX_POLL_FAILURES,
    message: failureMessage(status),
  }
}

/**
 * Forget the run of failures.
 *
 * Called on any successful read, and again when a sync starts - otherwise
 * failures accumulated while idle would trip the very first poll of a run that
 * had not yet had a chance to fail.
 */
export function resetPollFailures(): void {
  consecutive = 0
}
