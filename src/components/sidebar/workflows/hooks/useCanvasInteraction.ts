// Canvas pan and zoom interaction hook
import { useState, useCallback, useRef } from 'react'
import { MIN_ZOOM, MAX_ZOOM } from '../constants'
import type { CanvasMode, Point } from '../types'

export interface CanvasInteractionState {
  canvasMode: CanvasMode
  zoom: number
  pan: Point
  isDragging: boolean
  dragStart: Point
  mousePos: Point
}

export function useCanvasInteraction(initialZoom: number = 1, initialPan: Point = { x: 0, y: 0 }) {
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('select')
  const [zoom, setZoom] = useState(initialZoom)
  const [pan, setPan] = useState(initialPan)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  
  const canvasRef = useRef<HTMLDivElement>(null)

  /**
   * Start panning the canvas
   */
  const startPan = useCallback((e: React.MouseEvent) => {
    if (canvasMode === 'pan') {
      setIsDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [canvasMode, pan])

  /**
   * Handle mouse move for panning and mouse position tracking
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    // Calculate mouse position in canvas coordinates
    const mouseX = (e.clientX - rect.left - pan.x) / zoom
    const mouseY = (e.clientY - rect.top - pan.y) / zoom
    
    setMousePos({ x: mouseX, y: mouseY })
    
    // Handle pan dragging
    if (isDragging && canvasMode === 'pan') {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
    
    return { x: mouseX, y: mouseY }
  }, [isDragging, canvasMode, dragStart, pan, zoom])

  /**
   * End panning
   */
  const endPan = useCallback(() => {
    setIsDragging(false)
  }, [])

  /**
   * Handle mouse wheel for zooming
   */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    // Mouse position relative to canvas element
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // Calculate new zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor))
    
    // Calculate the point in canvas coordinates that should stay under the mouse
    // Before zoom: (mouseX - pan.x) / zoom = canvasX
    // After zoom: (mouseX - newPan.x) / newZoom = canvasX (same point)
    // Therefore: newPan.x = mouseX - canvasX * newZoom
    
    const canvasX = (mouseX - pan.x) / zoom
    const canvasY = (mouseY - pan.y) / zoom
    
    const newPanX = mouseX - canvasX * newZoom
    const newPanY = mouseY - canvasY * newZoom
    
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }, [zoom, pan])

  /**
   * Zoom to a specific level (for toolbar buttons)
   */
  const zoomTo = useCallback((newZoom: number) => {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))
    
    // Zoom towards center of canvas
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      
      const canvasX = (centerX - pan.x) / zoom
      const canvasY = (centerY - pan.y) / zoom
      
      const newPanX = centerX - canvasX * clampedZoom
      const newPanY = centerY - canvasY * clampedZoom
      
      setPan({ x: newPanX, y: newPanY })
    }
    
    setZoom(clampedZoom)
  }, [zoom, pan])

  /**
   * Center view on content
   */
  const centerOnContent = useCallback((states: Array<{ position_x: number; position_y: number }>) => {
    if (states.length === 0) return
    
    const minX = Math.min(...states.map(s => s.position_x))
    const maxX = Math.max(...states.map(s => s.position_x))
    const minY = Math.min(...states.map(s => s.position_y))
    const maxY = Math.max(...states.map(s => s.position_y))
    
    const contentCenterX = (minX + maxX) / 2
    const contentCenterY = (minY + maxY) / 2
    
    const canvasWidth = canvasRef.current?.clientWidth || 800
    const canvasHeight = canvasRef.current?.clientHeight || 600
    
    const panX = (canvasWidth / 2) - (contentCenterX * zoom)
    const panY = (canvasHeight / 2) - (contentCenterY * zoom)
    
    setPan({ x: panX, y: panY })
  }, [zoom])

  /**
   * Reset zoom to 100%
   */
  const resetZoom = useCallback(() => {
    zoomTo(1)
  }, [zoomTo])

  /**
   * Convert screen coordinates to canvas coordinates
   */
  const screenToCanvas = useCallback((screenX: number, screenY: number): Point => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: screenX, y: screenY }
    
    return {
      x: (screenX - rect.left - pan.x) / zoom,
      y: (screenY - rect.top - pan.y) / zoom
    }
  }, [pan, zoom])

  /**
   * Convert canvas coordinates to screen coordinates
   */
  const canvasToScreen = useCallback((canvasX: number, canvasY: number): Point => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: canvasX, y: canvasY }
    
    return {
      x: rect.left + pan.x + canvasX * zoom,
      y: rect.top + pan.y + canvasY * zoom
    }
  }, [pan, zoom])

  return {
    // State
    canvasMode,
    zoom,
    pan,
    isDragging,
    mousePos,
    canvasRef,
    
    // State setters
    setCanvasMode,
    setZoom,
    setPan,
    
    // Event handlers
    startPan,
    handleMouseMove,
    endPan,
    handleWheel,
    
    // Actions
    zoomTo,
    centerOnContent,
    resetZoom,
    
    // Coordinate conversion
    screenToCanvas,
    canvasToScreen
  }
}
