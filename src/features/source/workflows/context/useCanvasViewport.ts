/**
 * Canvas viewport: mode, zoom, pan, pointer position and the conversions
 * between screen and canvas coordinates.
 *
 * The viewport and pointer are also mirrored into refs so memoized children can
 * do coordinate math during a gesture without re-rendering on every frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { CanvasMode, WorkflowState } from '@/types/workflow'

import { MIN_ZOOM, MAX_ZOOM } from '../constants'
import type { Point } from '../types'

/** Wheel delta to zoom factor; exponential keeps the velocity symmetric. */
const ZOOM_SENSITIVITY = 0.01

const FALLBACK_CANVAS_WIDTH = 800
const FALLBACK_CANVAS_HEIGHT = 600

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    element.isContentEditable
  )
}

export function useCanvasViewport() {
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('select')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })

  const canvasRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<SVGGElement>(null)

  const viewportRef = useRef<{ pan: Point; zoom: number }>({ pan, zoom })
  viewportRef.current = { pan, zoom }

  // The pointer moves far too often to be React state: anything that needs the
  // live position reads this, and the connection preview has its own store.
  const mousePosRef = useRef<Point>({ x: 0, y: 0 })

  // ---- Spacebar-to-pan (hold space to temporarily pan, like Figma) ----
  const canvasModeRef = useRef(canvasMode)
  canvasModeRef.current = canvasMode
  const isSpacePanningRef = useRef(false)
  const preSpacePanModeRef = useRef<CanvasMode>('select')

  useEffect(() => {
    const startSpacePan = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (isEditableTarget(document.activeElement)) return
      e.preventDefault()
      if (isSpacePanningRef.current) return
      isSpacePanningRef.current = true
      preSpacePanModeRef.current = canvasModeRef.current
      setCanvasMode('pan')
    }

    const endSpacePan = () => {
      if (!isSpacePanningRef.current) return
      isSpacePanningRef.current = false
      setCanvasMode(preSpacePanModeRef.current)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      endSpacePan()
    }

    window.addEventListener('keydown', startSpacePan)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', endSpacePan)
    return () => {
      window.removeEventListener('keydown', startSpacePan)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', endSpacePan)
    }
  }, [])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Miro-style: ctrl/cmd + wheel (and trackpad pinch, which reports ctrlKey)
      // zooms toward the cursor; a plain wheel / two-finger drag pans the canvas.
      if (e.ctrlKey || e.metaKey) {
        const zoomFactor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor))

        const canvasX = (mouseX - pan.x) / zoom
        const canvasY = (mouseY - pan.y) / zoom

        setZoom(newZoom)
        setPan({ x: mouseX - canvasX * newZoom, y: mouseY - canvasY * newZoom })
      } else {
        // Shift+wheel scrolls horizontally on mice that have no horizontal axis.
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
        setPan({ x: pan.x - dx, y: pan.y - dy })
      }
    },
    [zoom, pan],
  )

  const centerOnContent = useCallback(
    (contentStates: WorkflowState[]) => {
      if (contentStates.length === 0) return

      const minX = Math.min(...contentStates.map((s) => s.position_x))
      const maxX = Math.max(...contentStates.map((s) => s.position_x))
      const minY = Math.min(...contentStates.map((s) => s.position_y))
      const maxY = Math.max(...contentStates.map((s) => s.position_y))

      const contentCenterX = (minX + maxX) / 2
      const contentCenterY = (minY + maxY) / 2

      const canvasWidth = canvasRef.current?.clientWidth || FALLBACK_CANVAS_WIDTH
      const canvasHeight = canvasRef.current?.clientHeight || FALLBACK_CANVAS_HEIGHT

      setPan({
        x: canvasWidth / 2 - contentCenterX * zoom,
        y: canvasHeight / 2 - contentCenterY * zoom,
      })
    },
    [zoom],
  )

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: screenX, y: screenY }

      return {
        x: (screenX - rect.left - pan.x) / zoom,
        y: (screenY - rect.top - pan.y) / zoom,
      }
    },
    [pan, zoom],
  )

  const canvasToScreen = useCallback(
    (canvasX: number, canvasY: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: canvasX, y: canvasY }

      return {
        x: rect.left + pan.x + canvasX * zoom,
        y: rect.top + pan.y + canvasY * zoom,
      }
    },
    [pan, zoom],
  )

  return {
    canvasMode,
    zoom,
    pan,
    canvasRef,
    groupRef,
    viewportRef,
    mousePosRef,
    setCanvasMode,
    setZoom,
    setPan,
    handleWheel,
    centerOnContent,
    screenToCanvas,
    canvasToScreen,
  }
}
