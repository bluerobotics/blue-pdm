/**
 * useStableCallback - Returns a callback with a stable identity that always
 * invokes the latest version of the provided function.
 *
 * This lets us pass handlers into React.memo'd children without breaking
 * memoization (the identity never changes) while still always running the
 * most up-to-date closure (no stale pan/zoom/state captures).
 */
import { useCallback, useRef } from 'react'

export function useStableCallback<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  const fnRef = useRef(fn)
  fnRef.current = fn

  return useCallback((...args: Args) => fnRef.current(...args), [])
}
