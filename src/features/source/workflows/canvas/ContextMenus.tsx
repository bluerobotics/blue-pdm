/**
 * ContextMenus - Context menus for workflow canvas
 *
 * Includes the main workflow context menu and waypoint context menu.
 */
import type {
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
  TransitionPathType,
} from '@/types/workflow'
import type { Point, WaypointContextMenu, ContextMenuState } from '../types'
import { WorkflowContextMenu } from './WorkflowContextMenu'

interface ContextMenusProps {
  // Context menu state
  contextMenu: ContextMenuState | null
  waypointContextMenu: WaypointContextMenu | null

  // Data
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>
  waypoints: Record<string, Point[]>
  isAdmin: boolean

  // Handlers
  openEditState: (state: WorkflowState) => void
  openEditTransition: (transition: WorkflowTransition) => void
  deleteState: (stateId: string) => Promise<boolean>
  deleteTransition: (transitionId: string) => Promise<boolean>
  addTransitionGate: (transitionId: string) => Promise<void>
  addState: () => Promise<WorkflowState | null>
  onAddWaypointToTransition: (
    transitionId: string,
    x: number,
    y: number,
    pathType: TransitionPathType,
    startEdge: string,
    endEdge: string,
  ) => void

  // Setters
  setWaypoints: React.Dispatch<React.SetStateAction<Record<string, Point[]>>>
  setContextMenu: (menu: ContextMenuState | null) => void
  setWaypointContextMenu: (menu: WaypointContextMenu | null) => void

  // Notifications
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function ContextMenus({
  contextMenu,
  waypointContextMenu,
  states,
  transitions,
  gates,
  waypoints,
  isAdmin,
  openEditState,
  openEditTransition,
  deleteState,
  deleteTransition,
  addTransitionGate,
  addState,
  onAddWaypointToTransition,
  setWaypoints,
  setContextMenu,
  setWaypointContextMenu,
  addToast,
}: ContextMenusProps) {
  const closeContextMenu = () => setContextMenu(null)

  return (
    <>
      {/* Main context menu */}
      {contextMenu && (
        <WorkflowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          isAdmin={isAdmin}
          targetState={
            contextMenu.type === 'state'
              ? states.find((s) => s.id === contextMenu.targetId)
              : undefined
          }
          targetTransition={
            contextMenu.type === 'transition'
              ? transitions.find((t) => t.id === contextMenu.targetId)
              : undefined
          }
          gates={contextMenu.type === 'transition' ? gates[contextMenu.targetId] || [] : []}
          allStates={states}
          hasWaypoints={
            contextMenu.type === 'transition' && (waypoints[contextMenu.targetId]?.length || 0) > 0
          }
          onEdit={() => {
            if (contextMenu.type === 'state') {
              const state = states.find((s) => s.id === contextMenu.targetId)
              if (state) openEditState(state)
            } else if (contextMenu.type === 'transition') {
              const transition = transitions.find((t) => t.id === contextMenu.targetId)
              if (transition) openEditTransition(transition)
            }
            closeContextMenu()
          }}
          onDelete={() => {
            if (contextMenu.type === 'state') {
              deleteState(contextMenu.targetId)
            } else if (contextMenu.type === 'transition') {
              deleteTransition(contextMenu.targetId)
            }
            closeContextMenu()
          }}
          onAddGate={() => {
            if (contextMenu.type === 'transition') {
              addTransitionGate(contextMenu.targetId)
            }
            closeContextMenu()
          }}
          onResetWaypoints={() => {
            if (contextMenu.type === 'transition') {
              setWaypoints((prev) => {
                const next = { ...prev }
                delete next[contextMenu.targetId]
                return next
              })
              addToast('info', 'Control points reset')
            }
            closeContextMenu()
          }}
          onAddState={contextMenu.type === 'canvas' ? addState : undefined}
          onClose={closeContextMenu}
        />
      )}

      {/* Waypoint context menu */}
      {waypointContextMenu && (
        <div
          className="fixed bg-plm-sidebar border border-plm-border rounded-lg shadow-xl py-1 min-w-[160px] z-50"
          style={{ left: waypointContextMenu.x, top: waypointContextMenu.y }}
        >
          <button
            onClick={() => {
              const transition = transitions.find((t) => t.id === waypointContextMenu.transitionId)
              if (transition) {
                const pathType = transition.line_path_type || 'spline'
                onAddWaypointToTransition(
                  waypointContextMenu.transitionId,
                  waypointContextMenu.canvasX,
                  waypointContextMenu.canvasY,
                  pathType,
                  'auto',
                  'auto',
                )
                addToast('info', 'Control point added')
              }
              setWaypointContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors"
          >
            Add Control Point
          </button>
          {waypointContextMenu.waypointIndex !== null && (
            <button
              onClick={() => {
                setWaypoints((prev) => {
                  const currentWaypoints = [...(prev[waypointContextMenu.transitionId] || [])]
                  currentWaypoints.splice(waypointContextMenu.waypointIndex!, 1)
                  if (currentWaypoints.length === 0) {
                    const next = { ...prev }
                    delete next[waypointContextMenu.transitionId]
                    return next
                  }
                  return { ...prev, [waypointContextMenu.transitionId]: currentWaypoints }
                })
                addToast('info', 'Control point removed')
                setWaypointContextMenu(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors text-plm-error"
            >
              Remove Control Point
            </button>
          )}
          <button
            onClick={() => {
              setWaypoints((prev) => {
                const next = { ...prev }
                delete next[waypointContextMenu.transitionId]
                return next
              })
              addToast('info', 'All control points reset')
              setWaypointContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors text-plm-fg-muted"
          >
            Reset All Points
          </button>
        </div>
      )}
    </>
  )
}
