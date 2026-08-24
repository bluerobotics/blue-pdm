/**
 * Main-thread long task monitor.
 *
 * Hover highlighting, cursor shape and scrolling are all recalculated on the
 * main thread, so they only feel slow when something else is holding it. Which
 * subsystem is holding it does not appear anywhere in the session log, so the
 * view that happens to be open gets blamed for blocking it did not cause.
 *
 * This records the blocking itself. Entries carry the active view and a
 * timestamp, so a burst of long tasks can be lined up against the surrounding
 * log lines to find the subsystem responsible.
 */

import { log } from '@/lib/logger'
import { recordMetric } from '@/lib/performanceMetrics'
import { LOAF_FRAME_THRESHOLD_MS, WATCHDOG_DRIFT_THRESHOLD_MS } from '@/lib/performanceThresholds'

/**
 * Tasks at or above this get a line of their own. The Long Tasks API only
 * reports at all above 50ms, so anything here is already user-visible; this
 * higher bar picks out the ones that drop a run of frames rather than one.
 */
const REPORT_INDIVIDUALLY_MS = 200

/** Sub-threshold tasks are summarised on this cadence instead of one-by-one. */
const ROLLUP_INTERVAL_MS = 5000

/** The API's own floor, subtracted to get blocking time rather than duration. */
const LONG_TASK_FLOOR_MS = 50

const LONG_ANIMATION_FRAME_ENTRY_TYPE = 'long-animation-frame'
const WATCHDOG_INTERVAL_MS = 1000
const MAX_SCRIPT_DETAILS = 5

interface Bucket {
  count: number
  totalMs: number
  blockingMs: number
  longestMs: number
}

interface LongAnimationFrameScript {
  invokerType: string | null
  invoker: string | null
  sourceFunctionName: string | null
  sourceURL: string | null
  sourceCharPosition: number | null
  duration: number
  forcedStyleAndLayoutDuration: number | null
  pauseDuration: number | null
}

interface LongAnimationFrameEntry {
  duration: number
  startTime: number
  name: string
  entryType: string
  blockingDuration: number
  renderStart: number
  styleAndLayoutStart: number
  scripts: LongAnimationFrameScript[]
}

interface FramePhases {
  beforeRenderMs: number | null
  renderMs: number | null
  styleAndLayoutMs: number | null
}

type ContextProvider = () => Record<string, unknown>

let stop: (() => void) | null = null

function emptyBucket(): Bucket {
  return { count: 0, totalMs: 0, blockingMs: 0, longestMs: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toLongAnimationFrameScript(value: unknown): LongAnimationFrameScript | null {
  if (!isRecord(value) || typeof value.duration !== 'number') return null

  return {
    invokerType: typeof value.invokerType === 'string' ? value.invokerType : null,
    invoker: typeof value.invoker === 'string' ? value.invoker : null,
    sourceFunctionName:
      typeof value.sourceFunctionName === 'string' ? value.sourceFunctionName : null,
    sourceURL: typeof value.sourceURL === 'string' ? value.sourceURL : null,
    sourceCharPosition:
      typeof value.sourceCharPosition === 'number' ? value.sourceCharPosition : null,
    duration: value.duration,
    forcedStyleAndLayoutDuration:
      typeof value.forcedStyleAndLayoutDuration === 'number'
        ? value.forcedStyleAndLayoutDuration
        : null,
    pauseDuration: typeof value.pauseDuration === 'number' ? value.pauseDuration : null,
  }
}

function toLongAnimationFrameEntry(entry: PerformanceEntry): LongAnimationFrameEntry | null {
  const candidate: unknown = entry
  if (
    !isRecord(candidate) ||
    candidate.entryType !== LONG_ANIMATION_FRAME_ENTRY_TYPE ||
    typeof entry.duration !== 'number' ||
    typeof entry.startTime !== 'number' ||
    typeof candidate.blockingDuration !== 'number' ||
    typeof candidate.renderStart !== 'number' ||
    typeof candidate.styleAndLayoutStart !== 'number' ||
    !Array.isArray(candidate.scripts)
  ) {
    return null
  }

  const scripts = candidate.scripts
    .map(toLongAnimationFrameScript)
    .filter((script): script is LongAnimationFrameScript => script !== null)

  return {
    duration: entry.duration,
    startTime: entry.startTime,
    name: entry.name,
    entryType: entry.entryType,
    blockingDuration: candidate.blockingDuration,
    renderStart: candidate.renderStart,
    styleAndLayoutStart: candidate.styleAndLayoutStart,
    scripts,
  }
}

function getFramePhases(frame: LongAnimationFrameEntry): FramePhases {
  const frameEnd = frame.startTime + frame.duration
  if (frame.renderStart === 0) {
    return {
      beforeRenderMs: frame.duration,
      renderMs: null,
      styleAndLayoutMs: null,
    }
  }

  const beforeRenderMs = Math.max(0, frame.renderStart - frame.startTime)
  if (frame.styleAndLayoutStart === 0) {
    return {
      beforeRenderMs,
      renderMs: Math.max(0, frameEnd - frame.renderStart),
      styleAndLayoutMs: null,
    }
  }

  return {
    beforeRenderMs,
    renderMs: Math.max(0, frame.styleAndLayoutStart - frame.renderStart),
    styleAndLayoutMs: Math.max(0, frameEnd - frame.styleAndLayoutStart),
  }
}

function getTopScripts(frame: LongAnimationFrameEntry): LongAnimationFrameScript[] {
  return [...frame.scripts]
    .sort((first, second) => second.duration - first.duration)
    .slice(0, MAX_SCRIPT_DETAILS)
    .map((script) => ({
      ...script,
      duration: Math.round(script.duration),
      forcedStyleAndLayoutDuration:
        script.forcedStyleAndLayoutDuration === null
          ? null
          : Math.round(script.forcedStyleAndLayoutDuration),
      pauseDuration: script.pauseDuration === null ? null : Math.round(script.pauseDuration),
    }))
}

/**
 * Begin watching for long tasks. Safe to call when the API is missing and
 * safe to call twice - the second call is a no-op that returns the first
 * disposer, so a remounting root does not stack observers.
 */
export function startLongTaskMonitor(getContext: ContextProvider = () => ({})): () => void {
  if (stop) return stop

  let bucket = emptyBucket()

  const flush = () => {
    if (bucket.count === 0) return

    const { count, totalMs, blockingMs, longestMs } = bucket
    bucket = emptyBucket()

    log.warn('[Perf]', 'Main thread blocked', {
      tasks: count,
      totalMs: Math.round(totalMs),
      blockingMs: Math.round(blockingMs),
      longestMs: Math.round(longestMs),
      overMs: ROLLUP_INTERVAL_MS,
      ...getContext(),
    })
  }

  const supportedEntryTypes =
    typeof PerformanceObserver === 'undefined'
      ? []
      : (PerformanceObserver.supportedEntryTypes ?? [])
  const longTaskObserver =
    supportedEntryTypes.includes('longtask') && typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const ms = entry.duration

            if (ms >= REPORT_INDIVIDUALLY_MS) {
              log.warn('[Perf]', 'Long task', { ms: Math.round(ms), ...getContext() })
              continue
            }

            bucket.count += 1
            bucket.totalMs += ms
            bucket.blockingMs += ms - LONG_TASK_FLOOR_MS
            bucket.longestMs = Math.max(bucket.longestMs, ms)
          }
        })
      : null

  // `buffered` replays tasks recorded before this ran, which covers the boot
  // path - the window where blocking is worst and the observer is not up yet.
  longTaskObserver?.observe({ type: 'longtask', buffered: true })

  const longAnimationFrameObserver =
    supportedEntryTypes.includes(LONG_ANIMATION_FRAME_ENTRY_TYPE) &&
    typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver((list) => {
          for (const rawEntry of list.getEntries()) {
            const frame = toLongAnimationFrameEntry(rawEntry)
            if (!frame || frame.duration < LOAF_FRAME_THRESHOLD_MS) continue

            const phases = getFramePhases(frame)
            const scripts = getTopScripts(frame)
            const context = getContext()
            const frameData = {
              duration: Math.round(frame.duration),
              blockingDuration: Math.round(frame.blockingDuration),
              ...phases,
              scripts,
              ...context,
            }

            log.warn('[Perf]', 'Long animation frame', frameData)
            recordMetric('Performance', 'Long animation frame', {
              durationMs: frameData.duration,
              blockingDurationMs: frameData.blockingDuration,
              ...phases,
              scripts,
              ...context,
            })
          }
        })
      : null

  longAnimationFrameObserver?.observe({
    type: LONG_ANIMATION_FRAME_ENTRY_TYPE,
    buffered: true,
  })

  const timer = setInterval(flush, ROLLUP_INTERVAL_MS)
  let nextWatchdogAt = performance.now() + WATCHDOG_INTERVAL_MS
  let hiddenSinceLastTick = document.visibilityState === 'hidden'

  const markHidden = () => {
    if (document.visibilityState === 'hidden') hiddenSinceLastTick = true
  }
  document.addEventListener('visibilitychange', markHidden)

  const watchdogTimer = setInterval(() => {
    const now = performance.now()
    const driftMs = now - nextWatchdogAt
    nextWatchdogAt = now + WATCHDOG_INTERVAL_MS

    // A hidden window's timers are throttled to about one tick a minute, so the
    // drift measured across a spell in the background says nothing about whether
    // the renderer was blocked. One session reported a 200-second "stall" that
    // was the window sitting unfocused while the app processed events normally.
    const wasHidden = hiddenSinceLastTick || document.visibilityState === 'hidden'
    hiddenSinceLastTick = document.visibilityState === 'hidden'
    if (wasHidden) return

    if (driftMs >= WATCHDOG_DRIFT_THRESHOLD_MS) {
      log.warn('[Perf]', 'Renderer stalled', {
        driftMs: Math.round(driftMs),
        ...getContext(),
      })
    }
  }, WATCHDOG_INTERVAL_MS)

  stop = () => {
    clearInterval(timer)
    clearInterval(watchdogTimer)
    document.removeEventListener('visibilitychange', markHidden)
    longTaskObserver?.disconnect()
    longAnimationFrameObserver?.disconnect()
    flush()
    stop = null
  }

  return stop
}
