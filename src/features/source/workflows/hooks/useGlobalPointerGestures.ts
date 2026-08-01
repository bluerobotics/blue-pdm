/**
 * Routes pointer move/up through window listeners while a canvas gesture is
 * active, so a drag never stops because the cursor left the canvas or outran
 * the element under it. Moves are coalesced to one update per animation frame.
 */
import { useEffect, useRef } from 'react'

import { useRafThrottle } from '../utils'

interface UseGlobalPointerGesturesParams {
  /** True while any drag, resize or transition-creation gesture is in flight. */
  isInteracting: boolean
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void | Promise<void>
}

export function useGlobalPointerGestures({
  isInteracting,
  onPointerMove,
  onPointerUp,
}: UseGlobalPointerGesturesParams) {
  const interactingRef = useRef(isInteracting)
  interactingRef.current = isInteracting

  const moveHandlerRef = useRef(onPointerMove)
  moveHandlerRef.current = onPointerMove
  const upHandlerRef = useRef(onPointerUp)
  upHandlerRef.current = onPointerUp

  const [throttledPointerMove, cancelPointerMove] = useRafThrottle((e: PointerEvent) => {
    moveHandlerRef.current(e)
  })

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (interactingRef.current) throttledPointerMove(e)
    }
    const onUp = (e: PointerEvent) => {
      cancelPointerMove()
      if (interactingRef.current) void upHandlerRef.current(e)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [throttledPointerMove, cancelPointerMove])
}
