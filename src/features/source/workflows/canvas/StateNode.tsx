// StateNode component - renders a workflow state on the canvas
import React from 'react'

import type { WorkflowState, CanvasMode } from '@/types/workflow'

import type { ResizingState, StateDimensions } from '../types'
import { RESIZE_HANDLE_SIZE } from '../constants'
import { buildOutline, inflateOutline, outlineToLocalPath } from '../utils/shapeOutline'

import { StateNodeShape, resolveNodeColors } from './StateNodeShape'

/** How far outside the silhouette each decoration is drawn. */
const HOVER_RING_OFFSET = 2
const EMPHASIS_RING_OFFSET = 4
const DRAG_SHADOW_OFFSET = 4

export interface StateNodeProps {
  state: WorkflowState

  // Selection state
  isSelected: boolean
  isTransitionStart: boolean
  isDragging: boolean
  isResizing: boolean
  isHovered: boolean

  // Mode state
  isAdmin: boolean
  canvasMode: CanvasMode
  isCreatingTransition: boolean

  // Dimensions
  dimensions: StateDimensions

  // Canvas transform
  canvasRef: React.RefObject<HTMLDivElement | null>

  // Refs for timing
  hasDraggedRef: React.MutableRefObject<boolean>

  // Event handlers
  onSelect: () => void
  onStartDrag: (e: React.MouseEvent) => void
  onStartResize: (handle: ResizingState['handle'], e: React.MouseEvent) => void
  /** Begin a connection from wherever on this node the pointer went down. */
  onStartConnection: (e: React.MouseEvent) => void
  onEdit: () => void
  onHoverChange: (isHovered: boolean) => void
  onShowToolbar: () => void
}

function StateNodeComponent({
  state,
  isSelected,
  isTransitionStart,
  isDragging: isDraggingThis,
  isResizing: isResizingThis,
  isHovered,
  isAdmin,
  canvasMode,
  isCreatingTransition,
  dimensions: dims,
  canvasRef,
  hasDraggedRef,
  onSelect,
  onStartDrag,
  onStartResize,
  onStartConnection,
  onEdit,
  onHoverChange,
  onShowToolbar,
}: StateNodeProps) {
  const hw = dims.width / 2
  const hh = dims.height / 2

  const showResizeHandles = isAdmin && isSelected && canvasMode === 'select'

  const outline = buildOutline(state, dims)
  const shapePath = outlineToLocalPath(outline)
  const hoverRingPath = outlineToLocalPath(inflateOutline(outline, HOVER_RING_OFFSET))
  const emphasisRingPath = outlineToLocalPath(inflateOutline(outline, EMPHASIS_RING_OFFSET))

  // Start resizing handler
  const startResize = (handle: ResizingState['handle'], e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    onStartResize(handle, e)
  }

  const colors = resolveNodeColors(state, {
    isSelected,
    isHovered,
    isDragging: isDraggingThis,
    isTransitionStart,
  })
  const { textColor } = colors

  return (
    <g
      key={state.id}
      transform={`translate(${state.position_x}, ${state.position_y})`}
      style={{
        cursor: isDraggingThis
          ? 'grabbing'
          : isResizingThis
            ? 'grabbing'
            : canvasMode === 'connect'
              ? 'crosshair'
              : isAdmin && canvasMode === 'select'
                ? 'grab'
                : 'pointer',
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (!isAdmin) return

        if (canvasMode === 'connect' && !isCreatingTransition) {
          onStartConnection(e)
          return
        }
        if (canvasMode === 'select' && !isResizingThis) {
          onStartDrag(e)
        }
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (hasDraggedRef.current || isCreatingTransition) return

        onSelect()
        onShowToolbar()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (isCreatingTransition) return
        if (isAdmin) onEdit()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onSelect()
        onShowToolbar()
      }}
    >
      {/* Drag / connection-origin emphasis ring */}
      {(isTransitionStart || isDraggingThis) && (
        <path
          d={emphasisRingPath}
          fill="none"
          stroke={isDraggingThis ? '#60a5fa' : '#22c55e'}
          strokeWidth={2}
          strokeLinejoin="round"
          opacity={isDraggingThis ? 0.8 : 0.6}
          strokeDasharray={isDraggingThis ? '4,2' : 'none'}
          className="pointer-events-none"
        />
      )}

      {/* Drop shadow when dragging */}
      {isDraggingThis && (
        <path
          d={shapePath}
          fill="rgba(0,0,0,0.3)"
          transform={`translate(${DRAG_SHADOW_OFFSET}, ${DRAG_SHADOW_OFFSET})`}
          className="pointer-events-none"
        />
      )}

      {/* Hover glow effect */}
      {isHovered && !isSelected && !isDraggingThis && (
        <path
          d={hoverRingPath}
          fill="none"
          stroke="rgba(255, 255, 255, 0.5)"
          strokeWidth="2"
          strokeLinejoin="round"
          className="pointer-events-none"
          style={{ transition: 'opacity 0.15s ease-out' }}
        />
      )}

      {/* Node background */}
      <StateNodeShape outline={outline} colors={colors} />

      {/* Label */}
      <text
        x="0"
        y="0"
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        fill={textColor}
        className="select-none pointer-events-none"
      >
        {state.label || state.name}
      </text>

      {/* State config indicators */}
      <text
        x="0"
        y="16"
        textAnchor="middle"
        fontSize="9"
        fill={textColor}
        opacity="0.7"
        className="select-none pointer-events-none"
      >
        {state.is_editable ? '✎ Editable' : '🔒 Locked'}
      </text>

      {/* Resize handles */}
      {showResizeHandles && (
        <g className="resize-handles">
          {/* Corner handles */}
          <rect
            x={-hw - RESIZE_HANDLE_SIZE}
            y={-hh - RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-nwse-resize"
            onMouseDown={(e) => startResize('nw', e)}
          />
          <rect
            x={hw - RESIZE_HANDLE_SIZE}
            y={-hh - RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-nesw-resize"
            onMouseDown={(e) => startResize('ne', e)}
          />
          <rect
            x={-hw - RESIZE_HANDLE_SIZE}
            y={hh - RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-nesw-resize"
            onMouseDown={(e) => startResize('sw', e)}
          />
          <rect
            x={hw - RESIZE_HANDLE_SIZE}
            y={hh - RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-nwse-resize"
            onMouseDown={(e) => startResize('se', e)}
          />
          {/* Side handles */}
          <rect
            x={-RESIZE_HANDLE_SIZE}
            y={-hh - RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-ns-resize"
            onMouseDown={(e) => startResize('n', e)}
          />
          <rect
            x={-RESIZE_HANDLE_SIZE}
            y={hh - RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-ns-resize"
            onMouseDown={(e) => startResize('s', e)}
          />
          <rect
            x={-hw - RESIZE_HANDLE_SIZE}
            y={-RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-ew-resize"
            onMouseDown={(e) => startResize('w', e)}
          />
          <rect
            x={hw - RESIZE_HANDLE_SIZE}
            y={-RESIZE_HANDLE_SIZE}
            width={RESIZE_HANDLE_SIZE * 2}
            height={RESIZE_HANDLE_SIZE * 2}
            fill="#fff"
            stroke="#6b7280"
            strokeWidth="1"
            className="cursor-ew-resize"
            onMouseDown={(e) => startResize('e', e)}
          />
        </g>
      )}
    </g>
  )
}

/**
 * Only re-render a node when its own visual inputs change. Function props are
 * stable (wrapped with useStableCallback upstream), and refs never change, so we
 * compare the data/visual props explicitly. This keeps node drag and pan cheap:
 * dragging one node does not re-render the others.
 */
function statePropsEqual(prev: StateNodeProps, next: StateNodeProps): boolean {
  return (
    prev.state === next.state &&
    prev.dimensions === next.dimensions &&
    prev.isSelected === next.isSelected &&
    prev.isTransitionStart === next.isTransitionStart &&
    prev.isDragging === next.isDragging &&
    prev.isResizing === next.isResizing &&
    prev.isHovered === next.isHovered &&
    prev.isAdmin === next.isAdmin &&
    prev.canvasMode === next.canvasMode &&
    prev.isCreatingTransition === next.isCreatingTransition
  )
}

export const StateNode = React.memo(StateNodeComponent, statePropsEqual)
