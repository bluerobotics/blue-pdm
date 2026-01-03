// Snapping utilities for workflow canvas
import { useCallback } from 'react'
import type { WorkflowState, SnapSettings } from '../types'

export function useSnapToGrid(snapSettings: SnapSettings, states: WorkflowState[]) {
  /**
   * Snap position to grid
   */
  const snapToGridPosition = useCallback((x: number, y: number): { x: number; y: number } => {
    if (!snapSettings.snapToGrid) return { x, y }
    const gridSize = snapSettings.gridSize
    return {
      x: Math.round(x / gridSize) * gridSize,
      y: Math.round(y / gridSize) * gridSize
    }
  }, [snapSettings.snapToGrid, snapSettings.gridSize])

  /**
   * Check alignment with other states and return snapped position + alignment guides
   */
  const checkAlignment = useCallback((
    currentStateId: string,
    x: number,
    y: number
  ): { 
    snappedX: number
    snappedY: number
    verticalGuide: number | null
    horizontalGuide: number | null 
  } => {
    if (!snapSettings.snapToAlignment) {
      return { snappedX: x, snappedY: y, verticalGuide: null, horizontalGuide: null }
    }
    
    const threshold = snapSettings.alignmentThreshold
    let snappedX = x
    let snappedY = y
    let verticalGuide: number | null = null
    let horizontalGuide: number | null = null
    
    // Check alignment with each other state's center
    for (const state of states) {
      if (state.id === currentStateId) continue
      
      // Check vertical alignment (same X coordinate - centers aligned)
      if (Math.abs(state.position_x - x) <= threshold) {
        snappedX = state.position_x
        verticalGuide = state.position_x
      }
      
      // Check horizontal alignment (same Y coordinate - centers aligned)
      if (Math.abs(state.position_y - y) <= threshold) {
        snappedY = state.position_y
        horizontalGuide = state.position_y
      }
    }
    
    return { snappedX, snappedY, verticalGuide, horizontalGuide }
  }, [snapSettings.snapToAlignment, snapSettings.alignmentThreshold, states])

  /**
   * Apply all snapping logic and return final position
   */
  const applySnapping = useCallback((
    currentStateId: string,
    rawX: number,
    rawY: number
  ): { x: number; y: number; verticalGuide: number | null; horizontalGuide: number | null } => {
    // First apply grid snapping
    let { x, y } = snapToGridPosition(rawX, rawY)
    
    // Then check alignment (alignment takes priority over grid)
    const alignment = checkAlignment(currentStateId, x, y)
    
    return {
      x: alignment.snappedX,
      y: alignment.snappedY,
      verticalGuide: alignment.verticalGuide,
      horizontalGuide: alignment.horizontalGuide
    }
  }, [snapToGridPosition, checkAlignment])

  return {
    snapToGridPosition,
    checkAlignment,
    applySnapping
  }
}
