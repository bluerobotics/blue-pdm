// StateNode component - renders a workflow state on the canvas
import React from 'react'

import { getContrastColor } from '@/types/workflow'

import type { WorkflowState, CanvasMode, ResizingState, StateDimensions } from '../types'
import { RESIZE_HANDLE_SIZE, CONNECTION_HANDLE_SIZE, CONNECTION_OFFSET } from '../constants'

export interface StateNodeProps {
  state: WorkflowState

  // Selection state
  isSelected: boolean
  isTransitionStart: boolean
  isDragging: boolean
  isResizing: boolean
  isSnapTarget: boolean
  isHovered: boolean

  // Mode state
  isAdmin: boolean
  canvasMode: CanvasMode
  isCreatingTransition: boolean
  transitionStartId: string | null
  isDraggingToCreateTransition: boolean

  // Dimensions
  dimensions: StateDimensions

  // Canvas transform
  canvasRef: React.RefObject<HTMLDivElement | null>

  // Refs for timing
  justCompletedTransitionRef: React.MutableRefObject<boolean>
  transitionCompletedAtRef: React.MutableRefObject<number>
  hasDraggedRef: React.MutableRefObject<boolean>

  // Event handlers
  onSelect: () => void
  onStartDrag: (e: React.MouseEvent) => void
  onStartResize: (handle: ResizingState['handle'], e: React.MouseEvent) => void
  onCompleteTransition: () => void
  onStartTransition: () => void
  onEdit: () => void
  onHoverChange: (isHovered: boolean) => void
  onShowToolbar: () => void

  // Transition creation handlers
  onSetDraggingToCreateTransition: (value: boolean) => void
  onSetHoveredStateId: (id: string | null) => void
}

function StateNodeComponent({
  state,
  isSelected,
  isTransitionStart,
  isDragging: isDraggingThis,
  isResizing: isResizingThis,
  isSnapTarget,
  isHovered,
  isAdmin,
  canvasMode,
  isCreatingTransition,
  transitionStartId,
  isDraggingToCreateTransition,
  dimensions: dims,
  canvasRef,
  justCompletedTransitionRef,
  transitionCompletedAtRef,
  hasDraggedRef,
  onSelect,
  onStartDrag,
  onStartResize,
  onCompleteTransition,
  onStartTransition,
  onEdit,
  onHoverChange,
  onShowToolbar,
  onSetDraggingToCreateTransition,
  onSetHoveredStateId,
}: StateNodeProps) {
  const textColor = getContrastColor(state.color)
  const hw = dims.width / 2
  const hh = dims.height / 2

  // Show connection points when selected, in connect mode, or when dragging to create a transition
  const isPotentialTransitionTarget = isCreatingTransition && transitionStartId !== state.id
  const showConnectionPoints =
    isAdmin && (isSelected || canvasMode === 'connect' || isPotentialTransitionTarget)
  const showResizeHandles = isAdmin && isSelected && canvasMode === 'select'

  // Start resizing handler
  const startResize = (handle: ResizingState['handle'], e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    onStartResize(handle, e)
  }

  // Handle connection point mousedown
  const handleConnectionPointMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isCreatingTransition) {
      onStartTransition()
      onSetDraggingToCreateTransition(true)
    }
  }

  // Handle connection point mouseup (completing transition)
  const handleConnectionPointMouseUp = (e: React.MouseEvent) => {
    if (
      isDraggingToCreateTransition &&
      isCreatingTransition &&
      transitionStartId &&
      transitionStartId !== state.id
    ) {
      e.stopPropagation()
      onCompleteTransition()
      justCompletedTransitionRef.current = true
      transitionCompletedAtRef.current = Date.now()
      onSetDraggingToCreateTransition(false)
      onSetHoveredStateId(null)
    }
  }

  // Handle connection point click
  const handleConnectionPointClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCreatingTransition && transitionStartId !== state.id) {
      onCompleteTransition()
    }
  }

  // Parse colors for rendering
  const baseFillOpacity = state.fill_opacity ?? 1
  const fillOpacity =
    isHovered && !isSelected ? Math.min(1, baseFillOpacity + 0.1) : baseFillOpacity
  const borderOpacity = state.border_opacity ?? 1
  const borderThickness = state.border_thickness ?? 2
  const borderColor = state.border_color || state.color

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  // Determine stroke color based on state
  let strokeColor: string
  let strokeWidth: number
  if (isDraggingThis) {
    strokeColor = '#60a5fa'
    strokeWidth = 2
  } else if (isTransitionStart) {
    strokeColor = '#22c55e'
    strokeWidth = 2
  } else {
    strokeColor = hexToRgba(borderColor, borderOpacity)
    strokeWidth = borderThickness
  }

  const fillColor = hexToRgba(state.color, fillOpacity)
  const shape = state.shape || 'rectangle'

  // Render the node shape
  const renderShape = () => {
    switch (shape) {
      case 'diamond':
        return (
          <polygon
            points={`0,${-hh} ${hw},0 0,${hh} ${-hw},0`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            style={{ transition: 'fill 0.15s ease-out' }}
          />
        )
      case 'hexagon':
        return (
          <polygon
            points={`${-hw * 0.5},${-hh} ${hw * 0.5},${-hh} ${hw},0 ${hw * 0.5},${hh} ${-hw * 0.5},${hh} ${-hw},0`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            style={{ transition: 'fill 0.15s ease-out' }}
          />
        )
      case 'ellipse':
        return (
          <ellipse
            cx={0}
            cy={0}
            rx={hw}
            ry={hh}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            style={{ transition: 'fill 0.15s ease-out' }}
          />
        )
      case 'rectangle':
      default:
        const cornerRadius = state.corner_radius ?? 8
        return (
          <rect
            x={-hw}
            y={-hh}
            width={dims.width}
            height={dims.height}
            rx={cornerRadius}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            style={{ transition: 'fill 0.15s ease-out' }}
          />
        )
    }
  }

  return (
    <g
      key={state.id}
      transform={`translate(${state.position_x}, ${state.position_y})`}
      style={{
        cursor: isDraggingThis
          ? 'grabbing'
          : isResizingThis
            ? 'grabbing'
            : isAdmin && canvasMode === 'select'
              ? 'grab'
              : 'pointer',
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (canvasMode === 'select' && isAdmin && !isResizingThis) {
          onStartDrag(e)
        }
      }}
      onMouseUp={(e) => {
        if (
          isDraggingToCreateTransition &&
          isCreatingTransition &&
          transitionStartId &&
          transitionStartId !== state.id
        ) {
          e.stopPropagation()
          onCompleteTransition()
          justCompletedTransitionRef.current = true
          transitionCompletedAtRef.current = Date.now()
          onSetDraggingToCreateTransition(false)
          onSetHoveredStateId(null)
        }
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (hasDraggedRef.current) return

        const timeSinceTransition = Date.now() - transitionCompletedAtRef.current
        if (justCompletedTransitionRef.current || timeSinceTransition < 500) {
          setTimeout(() => {
            justCompletedTransitionRef.current = false
          }, 500)
          return
        }

        if (isDraggingToCreateTransition) return

        if (isCreatingTransition) {
          onCompleteTransition()
        } else {
          onSelect()
          onShowToolbar()
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        const timeSinceTransition = Date.now() - transitionCompletedAtRef.current
        if (justCompletedTransitionRef.current || timeSinceTransition < 500) {
          setTimeout(() => {
            justCompletedTransitionRef.current = false
          }, 500)
          return
        }
        if (isCreatingTransition || isDraggingToCreateTransition) return

        if (isAdmin) {
          onEdit()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onSelect()
        onShowToolbar()
      }}
    >
      {/* Drag glow / snap target glow / transition start glow */}
      {(isTransitionStart || isDraggingThis || isSnapTarget) &&
        (shape === 'diamond' ? (
          <polygon
            points={`0,${-hh - 4} ${hw + 4},0 0,${hh + 4} ${-hw - 4},0`}
            fill={isSnapTarget ? 'rgba(96, 165, 250, 0.2)' : 'none'}
            stroke={isSnapTarget ? '#60a5fa' : isDraggingThis ? '#60a5fa' : '#22c55e'}
            strokeWidth={isSnapTarget ? 3 : 2}
            opacity={isSnapTarget ? 1 : isDraggingThis ? 0.8 : 0.6}
            strokeDasharray={isDraggingThis ? '4,2' : 'none'}
            strokeLinejoin="round"
          />
        ) : (
          <rect
            x={-hw - 4}
            y={-hh - 4}
            width={dims.width + 8}
            height={dims.height + 8}
            rx={(state.corner_radius ?? 8) + 4}
            fill={isSnapTarget ? 'rgba(96, 165, 250, 0.2)' : 'none'}
            stroke={isSnapTarget ? '#60a5fa' : isDraggingThis ? '#60a5fa' : '#22c55e'}
            strokeWidth={isSnapTarget ? 3 : 2}
            opacity={isSnapTarget ? 1 : isDraggingThis ? 0.8 : 0.6}
            strokeDasharray={isDraggingThis ? '4,2' : 'none'}
          />
        ))}

      {/* Snap target indicator */}
      {isSnapTarget && (
        <text
          x="0"
          y={-hh - 12}
          textAnchor="middle"
          fontSize="10"
          fill="#60a5fa"
          fontWeight="600"
          className="select-none pointer-events-none"
        >
          Drop here
        </text>
      )}

      {/* Drop shadow when dragging */}
      {isDraggingThis &&
        (shape === 'diamond' ? (
          <polygon
            points={`0,${-hh} ${hw},0 0,${hh} ${-hw},0`}
            fill="rgba(0,0,0,0.3)"
            transform="translate(4, 4)"
          />
        ) : (
          <rect
            x={-hw + 4}
            y={-hh + 4}
            width={dims.width}
            height={dims.height}
            rx={state.corner_radius ?? 8}
            fill="rgba(0,0,0,0.3)"
          />
        ))}

      {/* Hover glow effect */}
      {isHovered &&
        !isSelected &&
        !isDraggingThis &&
        (shape === 'diamond' ? (
          <polygon
            points={`0,${-hh - 2} ${hw + 2},0 0,${hh + 2} ${-hw - 2},0`}
            fill="none"
            stroke="rgba(255, 255, 255, 0.5)"
            strokeWidth="2"
            strokeLinejoin="round"
            className="pointer-events-none"
            style={{ transition: 'opacity 0.15s ease-out' }}
          />
        ) : (
          <rect
            x={-hw - 2}
            y={-hh - 2}
            width={dims.width + 4}
            height={dims.height + 4}
            rx={(state.corner_radius ?? 8) + 2}
            fill="none"
            stroke="rgba(255, 255, 255, 0.5)"
            strokeWidth="2"
            className="pointer-events-none"
            style={{ transition: 'opacity 0.15s ease-out' }}
          />
        ))}

      {/* Node background */}
      {renderShape()}

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

      {/* Connection points */}
      {showConnectionPoints && (
        <g className="connection-points">
          {/* Right */}
          <circle
            cx={hw + CONNECTION_OFFSET}
            cy="0"
            r={CONNECTION_HANDLE_SIZE}
            fill="#3b82f6"
            stroke="#fff"
            strokeWidth="1.5"
            className="cursor-crosshair"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
            onMouseDown={handleConnectionPointMouseDown}
            onMouseUp={handleConnectionPointMouseUp}
            onClick={handleConnectionPointClick}
          />
          {/* Left */}
          <circle
            cx={-hw - CONNECTION_OFFSET}
            cy="0"
            r={CONNECTION_HANDLE_SIZE}
            fill="#3b82f6"
            stroke="#fff"
            strokeWidth="1.5"
            className="cursor-crosshair"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
            onMouseDown={handleConnectionPointMouseDown}
            onMouseUp={handleConnectionPointMouseUp}
            onClick={handleConnectionPointClick}
          />
          {/* Top */}
          <circle
            cx="0"
            cy={-hh - CONNECTION_OFFSET}
            r={CONNECTION_HANDLE_SIZE}
            fill="#3b82f6"
            stroke="#fff"
            strokeWidth="1.5"
            className="cursor-crosshair"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
            onMouseDown={handleConnectionPointMouseDown}
            onMouseUp={handleConnectionPointMouseUp}
            onClick={handleConnectionPointClick}
          />
          {/* Bottom */}
          <circle
            cx="0"
            cy={hh + CONNECTION_OFFSET}
            r={CONNECTION_HANDLE_SIZE}
            fill="#3b82f6"
            stroke="#fff"
            strokeWidth="1.5"
            className="cursor-crosshair"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
            onMouseDown={handleConnectionPointMouseDown}
            onMouseUp={handleConnectionPointMouseUp}
            onClick={handleConnectionPointClick}
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
    prev.isSnapTarget === next.isSnapTarget &&
    prev.isHovered === next.isHovered &&
    prev.isAdmin === next.isAdmin &&
    prev.canvasMode === next.canvasMode &&
    prev.isCreatingTransition === next.isCreatingTransition &&
    prev.transitionStartId === next.transitionStartId &&
    prev.isDraggingToCreateTransition === next.isDraggingToCreateTransition
  )
}

export const StateNode = React.memo(StateNodeComponent, statePropsEqual)

