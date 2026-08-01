/**
 * The connection dots on a node's border.
 *
 * They live in their own layer above the nodes for two reasons: they need the
 * zoom to stay a constant size on screen, which a node would otherwise have to
 * re-render for, and drawing them last keeps a port grabbable even when its
 * node is overlapped by another.
 */
import React from 'react'

import type { CanvasMode, WorkflowState } from '@/types/workflow'

import { PORT_HIT_RADIUS_PX, PORT_VISUAL_RADIUS_PX } from '../constants'
import type { EdgePosition, StateDimensions } from '../types'
import { buildOutline, outlinePorts, resolveOutlineDimensions } from '../utils/shapeOutline'

const PORT_COLOR = '#3b82f6'

export interface ConnectionPortsLayerProps {
  states: WorkflowState[]
  stateDimensions: Record<string, StateDimensions>
  zoom: number
  isAdmin: boolean
  canvasMode: CanvasMode
  selectedStateId: string | null
  hoveredStateId: string | null
  isCreatingTransition: boolean
  onStartConnection: (stateId: string, anchor: EdgePosition, e: React.MouseEvent) => void
}

function ConnectionPortsLayerComponent({
  states,
  stateDimensions,
  zoom,
  isAdmin,
  canvasMode,
  selectedStateId,
  hoveredStateId,
  isCreatingTransition,
  onStartConnection,
}: ConnectionPortsLayerProps) {
  if (!isAdmin || canvasMode === 'pan') return null

  // Ports appear on the node under the cursor and on the selected one. While a
  // connection is in flight the hovered node is whichever one it would land on,
  // so the target's ports light up as something to aim at.
  const visibleIds = new Set<string>()
  if (hoveredStateId) visibleIds.add(hoveredStateId)
  if (selectedStateId) visibleIds.add(selectedStateId)
  if (visibleIds.size === 0) return null

  const scale = zoom > 0 ? zoom : 1
  const visualRadius = PORT_VISUAL_RADIUS_PX / scale
  const hitRadius = PORT_HIT_RADIUS_PX / scale

  return (
    <g className="connection-ports">
      {states
        .filter((state) => visibleIds.has(state.id))
        .map((state) => {
          const outline = buildOutline(state, resolveOutlineDimensions(state.id, stateDimensions))

          return outlinePorts(outline).map((port) => (
            <g
              key={`${state.id}-${port.edge}`}
              data-state-id={state.id}
              className="cursor-crosshair"
              style={{ pointerEvents: isCreatingTransition ? 'none' : 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onStartConnection(state.id, { edge: port.edge, fraction: 0.5 }, e)
              }}
            >
              <circle cx={port.x} cy={port.y} r={hitRadius} fill="transparent" />
              <circle
                cx={port.x}
                cy={port.y}
                r={visualRadius}
                fill={PORT_COLOR}
                stroke="#fff"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
              />
            </g>
          ))
        })}
    </g>
  )
}

export const ConnectionPortsLayer = React.memo(ConnectionPortsLayerComponent)
