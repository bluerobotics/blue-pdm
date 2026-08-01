/**
 * The feedback shown on the node a connection is about to land on.
 *
 * The whole silhouette lights up so it is obvious which node will be hit, and
 * when the endpoint has locked onto a specific spot the run of border around it
 * is thickened and marked. Because both are traced from the same outline the
 * snapping uses, a hexagon highlights as a hexagon and the marker sits exactly
 * where the line will attach.
 */
import { DROP_TARGET_INFLATE_PX, EDGE_HIGHLIGHT_ARC_PX } from '../constants'
import type { ConnectionSnap } from '../utils/connectionSnap'
import { inflateOutline, outlineRunPath, outlineToPath } from '../utils/shapeOutline'

const TARGET_COLOR = '#60a5fa'
const PINNED_COLOR = '#22c55e'

export interface ConnectionDropTargetProps {
  snap: ConnectionSnap | null
  zoom: number
}

export function ConnectionDropTarget({ snap, zoom }: ConnectionDropTargetProps) {
  if (!snap) return null

  const scale = zoom > 0 ? zoom : 1
  const isPinned = snap.kind !== 'body'
  const color = isPinned ? PINNED_COLOR : TARGET_COLOR

  const halo = outlineToPath(inflateOutline(snap.outline, DROP_TARGET_INFLATE_PX / scale))
  const run = isPinned
    ? outlineRunPath(snap.outline, snap.arcLength, EDGE_HIGHLIGHT_ARC_PX / scale)
    : null

  return (
    <g className="pointer-events-none">
      <path
        d={halo}
        fill={color}
        fillOpacity={0.12}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {run && (
        <path
          d={run}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {isPinned && (
        <>
          <circle
            cx={snap.point.x}
            cy={snap.point.y}
            r={6 / scale}
            fill="none"
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={snap.point.x} cy={snap.point.y} r={3 / scale} fill={color} />
        </>
      )}
    </g>
  )
}
