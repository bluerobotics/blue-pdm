// The filled outline of a state node, and the colours every layer of the node draws with
import { getContrastColor } from '@/types/workflow'
import type { WorkflowState } from '@/types/workflow'

import { outlineToLocalPath, type Outline } from '../utils/shapeOutline'

const DRAG_STROKE_COLOR = '#60a5fa'
const TRANSITION_START_STROKE_COLOR = '#22c55e'
const EMPHASIS_STROKE_WIDTH = 2
/** Lift applied to the fill while the pointer is over an unselected node. */
const HOVER_FILL_BOOST = 0.1

export interface NodeColors {
  fillColor: string
  strokeColor: string
  strokeWidth: number
  textColor: string
}

interface NodeColorInput {
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
  isTransitionStart: boolean
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Dragging and connect-mode override the node's own border so the interaction
 * reads at a glance; everything else honours what the state was styled with.
 */
export function resolveNodeColors(state: WorkflowState, input: NodeColorInput): NodeColors {
  const baseFillOpacity = state.fill_opacity ?? 1
  const fillOpacity =
    input.isHovered && !input.isSelected
      ? Math.min(1, baseFillOpacity + HOVER_FILL_BOOST)
      : baseFillOpacity

  let strokeColor: string
  let strokeWidth: number
  if (input.isDragging) {
    strokeColor = DRAG_STROKE_COLOR
    strokeWidth = EMPHASIS_STROKE_WIDTH
  } else if (input.isTransitionStart) {
    strokeColor = TRANSITION_START_STROKE_COLOR
    strokeWidth = EMPHASIS_STROKE_WIDTH
  } else {
    strokeColor = hexToRgba(state.border_color || state.color, state.border_opacity ?? 1)
    strokeWidth = state.border_thickness ?? 2
  }

  return {
    fillColor: hexToRgba(state.color, fillOpacity),
    strokeColor,
    strokeWidth,
    textColor: getContrastColor(state.color),
  }
}

interface StateNodeShapeProps {
  outline: Outline
  colors: NodeColors
}

/**
 * Every shape draws from the same outline the snapping and hit-testing use, so
 * the silhouette the user sees is exactly the silhouette a connection lands on.
 * The outline is in world coordinates while the node's group is already
 * translated to its position, hence the local path.
 */
export function StateNodeShape({ outline, colors }: StateNodeShapeProps) {
  return (
    <path
      d={outlineToLocalPath(outline)}
      fill={colors.fillColor}
      stroke={colors.strokeColor}
      strokeWidth={colors.strokeWidth}
      strokeLinejoin="round"
      style={{ transition: 'fill 0.15s ease-out' }}
    />
  )
}
