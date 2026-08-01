/**
 * ArrowMarkers - SVG marker definitions for transition arrows
 */
import { memo } from 'react'
import type { WorkflowTransition } from '@/types/workflow'
import { lightenColor } from '../utils'

interface ArrowMarkersProps {
  transitions: WorkflowTransition[]
}

export const ArrowMarkers = memo(function ArrowMarkers({ transitions }: ArrowMarkersProps) {
  return (
    <defs>
      {/* Selected state arrowhead */}
      <marker
        id="arrowhead-selected"
        markerWidth="10"
        markerHeight="7"
        refX="9"
        refY="3.5"
        orient="auto"
      >
        <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
      </marker>
      <marker
        id="arrowhead-start-selected"
        markerWidth="10"
        markerHeight="7"
        refX="1"
        refY="3.5"
        orient="auto"
      >
        <polygon points="10 0, 0 3.5, 10 7" fill="#60a5fa" />
      </marker>

      {/* Creating transition arrowhead */}
      <marker
        id="arrowhead-creating"
        markerWidth="10"
        markerHeight="7"
        refX="9"
        refY="3.5"
        orient="auto"
      >
        <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
      </marker>

      {/* Per-transition markers for custom colors */}
      {transitions.map((t) => {
        const color = t.line_color || '#6b7280'
        const hoverColor = lightenColor(color, 0.35)
        return (
          <g key={`markers-${t.id}`}>
            <marker
              id={`arrowhead-${t.id}`}
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill={color} />
            </marker>
            <marker
              id={`arrowhead-start-${t.id}`}
              markerWidth="10"
              markerHeight="7"
              refX="1"
              refY="3.5"
              orient="auto"
            >
              <polygon points="10 0, 0 3.5, 10 7" fill={color} />
            </marker>
            <marker
              id={`arrowhead-hover-${t.id}`}
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill={hoverColor} />
            </marker>
            <marker
              id={`arrowhead-start-hover-${t.id}`}
              markerWidth="10"
              markerHeight="7"
              refX="1"
              refY="3.5"
              orient="auto"
            >
              <polygon points="10 0, 0 3.5, 10 7" fill={hoverColor} />
            </marker>
          </g>
        )
      })}
    </defs>
  )
})
