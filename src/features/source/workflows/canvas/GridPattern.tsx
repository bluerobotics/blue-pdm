/**
 * GridPattern - Renders the grid lines for snap-to-grid functionality
 */
import { memo } from 'react'
import type { SnapSettings } from '../types'

interface GridPatternProps {
  snapSettings: SnapSettings
}

// Large enough to cover any realistic panned/zoomed viewport in canvas space.
const GRID_EXTENT = 100000

export const GridPattern = memo(function GridPattern({ snapSettings }: GridPatternProps) {
  if (!snapSettings.snapToGrid) return null

  const size = snapSettings.gridSize

  // A single tiled <pattern> + one rect is far cheaper than hundreds of <line>s
  // and is composited on the GPU, so it stays crisp during pan/zoom.
  return (
    <>
      <defs>
        <pattern id="wf-grid-pattern" width={size} height={size} patternUnits="userSpaceOnUse">
          <path
            d={`M ${size} 0 L 0 0 0 ${size}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
          />
        </pattern>
      </defs>
      <rect
        x={-GRID_EXTENT}
        y={-GRID_EXTENT}
        width={GRID_EXTENT * 2}
        height={GRID_EXTENT * 2}
        fill="url(#wf-grid-pattern)"
        opacity={0.15}
        className="pointer-events-none"
      />
    </>
  )
})
