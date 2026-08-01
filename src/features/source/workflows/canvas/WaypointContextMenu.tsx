/**
 * WaypointContextMenu - Context menu for managing transition waypoints/control points
 */
import { memo } from 'react'
import type { WorkflowTransition } from '@/types/workflow'

import type { WaypointContextMenu as WaypointContextMenuType } from '../types'

interface WaypointContextMenuProps {
  menu: WaypointContextMenuType
  transitions: WorkflowTransition[]
  onAddWaypoint: (transitionId: string, x: number, y: number, pathType: string) => void
  onRemoveWaypoint: (transitionId: string, waypointIndex: number) => void
  onResetWaypoints: (transitionId: string) => void
  onClose: () => void
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export const WaypointContextMenu = memo(function WaypointContextMenu({
  menu,
  transitions,
  onAddWaypoint,
  onRemoveWaypoint,
  onResetWaypoints,
  onClose,
  addToast,
}: WaypointContextMenuProps) {
  const transition = transitions.find((t) => t.id === menu.transitionId)

  return (
    <div
      className="fixed bg-plm-sidebar border border-plm-border rounded-lg shadow-xl py-1 min-w-[160px] z-50"
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        onClick={() => {
          if (transition) {
            const pathType = transition.line_path_type || 'spline'
            onAddWaypoint(menu.transitionId, menu.canvasX, menu.canvasY, pathType)
            addToast('info', 'Control point added')
          }
          onClose()
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors"
      >
        Add Control Point
      </button>

      {menu.waypointIndex !== null && (
        <button
          onClick={() => {
            onRemoveWaypoint(menu.transitionId, menu.waypointIndex!)
            addToast('info', 'Control point removed')
            onClose()
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors text-plm-error"
        >
          Remove Control Point
        </button>
      )}

      <button
        onClick={() => {
          onResetWaypoints(menu.transitionId)
          addToast('info', 'All control points reset')
          onClose()
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors text-plm-fg-muted"
      >
        Reset All Points
      </button>
    </div>
  )
})
