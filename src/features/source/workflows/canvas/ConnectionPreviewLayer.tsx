/**
 * The line that follows the cursor while a connection is being drawn or
 * re-anchored, plus the highlight on whatever it is about to land on.
 *
 * It is drawn with the same path generator as a committed transition, so the
 * preview is not an approximation of the result - it is the result, minus the
 * database row. The layer subscribes to the preview store directly, which keeps
 * per-frame updates from re-rendering the rest of the canvas.
 */
import type { ConnectionPreviewStore } from '../context/connectionPreviewStore'
import { useConnectionPreview } from '../context/connectionPreviewStore'
import type { Point, PointWithEdge } from '../types'
import type { ConnectionSnap } from '../utils/connectionSnap'
import { generateElbowPath, generateSplinePath } from '../utils/pathGeneration'

import { ConnectionDropTarget } from './ConnectionDropTarget'

const PREVIEW_COLOR = '#22c55e'

export interface ConnectionPreviewLayerProps {
  store: ConnectionPreviewStore
  zoom: number
}

export function ConnectionPreviewLayer({ store, zoom }: ConnectionPreviewLayerProps) {
  const preview = useConnectionPreview(store)
  if (!preview) return null

  const { origin, cursor, snap, pathType } = preview
  const end = resolveEnd(origin, cursor, snap)

  const pathD =
    pathType === 'elbow'
      ? generateElbowPath(origin, [], end).path
      : pathType === 'straight'
        ? `M ${origin.x} ${origin.y} L ${end.x} ${end.y}`
        : generateSplinePath(origin, [], end)

  return (
    <g>
      <ConnectionDropTarget snap={snap} zoom={zoom} />

      <path
        d={pathD}
        fill="none"
        stroke={PREVIEW_COLOR}
        strokeWidth={2}
        strokeDasharray={snap ? undefined : '5,5'}
        strokeLinecap="round"
        markerEnd="url(#arrowhead-creating)"
        vectorEffect="non-scaling-stroke"
        className="pointer-events-none"
      />
    </g>
  )
}

/**
 * Where the moving end of the preview sits. Once snapped it takes the target's
 * border point and surface direction; until then it follows the cursor and is
 * given a direction pointing back at the origin, so the line arrives head-on
 * instead of sprouting a stub into empty space.
 */
function resolveEnd(origin: Point, cursor: Point, snap: ConnectionSnap | null): PointWithEdge {
  if (snap) {
    return {
      x: snap.point.x,
      y: snap.point.y,
      edge: snap.anchor?.edge ?? 'left',
      normal: snap.normal,
    }
  }

  const dx = origin.x - cursor.x
  const dy = origin.y - cursor.y
  const length = Math.hypot(dx, dy)
  const normal = length > 0 ? { x: dx / length, y: dy / length } : { x: -1, y: 0 }

  return {
    x: cursor.x,
    y: cursor.y,
    edge: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top',
    normal,
  }
}
