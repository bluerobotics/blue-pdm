/**
 * useRafThrottle - Coalesces rapid calls into at most one invocation per
 * animation frame, always using the most recent arguments.
 *
 * Used to keep pointer-move driven updates (pan, drag, rubber-band preview)
 * at the display refresh rate instead of firing React state updates on every
 * single pointer event.
 */
import { useCallback, useEffect, useRef } from 'react'

export function useRafThrottle<Args extends unknown[]>(
  callback: (...args: Args) => void,
): readonly [(...args: Args) => void, () => void] {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const frameRef = useRef<number | null>(null)
  const argsRef = useRef<Args | null>(null)

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    argsRef.current = null
  }, [])

  const throttled = useCallback((...args: Args) => {
    argsRef.current = args
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const latest = argsRef.current
      argsRef.current = null
      if (latest) callbackRef.current(...latest)
    })
  }, [])

  useEffect(() => cancel, [cancel])

  return [throttled, cancel] as const
}
