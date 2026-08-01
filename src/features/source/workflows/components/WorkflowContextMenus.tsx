/**
 * WorkflowContextMenus - Renders context menus for canvas, states, transitions
 */
import { WorkflowContextMenu, WaypointContextMenu } from '../canvas'
import type { WorkflowState, WorkflowTransition, WorkflowGate } from '@/types/workflow'

import type {
  ContextMenuState,
  WaypointContextMenu as WaypointContextMenuType,
} from '../types'

interface WorkflowContextMenusProps {
  contextMenu: ContextMenuState | null
  waypointContextMenu: WaypointContextMenuType | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>
  waypoints: Record<string, Array<{ x: number; y: number }>>
  isAdmin: boolean

  // Actions
  openEditState: (state: WorkflowState) => void
  openEditTransition: (transition: WorkflowTransition) => void
  deleteState: (id: string) => void
  deleteTransition: (id: string) => void
  addTransitionGate: (transitionId: string) => void
  addState: (x: number, y: number) => void
  handleAddWaypointToTransition: (
    transitionId: string,
    x: number,
    y: number,
    pathType: string,
    exitDir: string,
    entryDir: string,
  ) => void
  setWaypoints: React.Dispatch<
    React.SetStateAction<Record<string, Array<{ x: number; y: number }>>>
  >
  closeContextMenu: () => void
  setWaypointContextMenu: (m: WaypointContextMenuType | null) => void
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export function WorkflowContextMenus({
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
  handleAddWaypointToTransition,
  setWaypoints,
  closeContextMenu,
  setWaypointContextMenu,
  addToast,
}: WorkflowContextMenusProps) {
  return (
    <>
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
            if (contextMenu.type === 'state') deleteState(contextMenu.targetId)
            else if (contextMenu.type === 'transition') deleteTransition(contextMenu.targetId)
            closeContextMenu()
          }}
          onAddGate={() => {
            if (contextMenu.type === 'transition') addTransitionGate(contextMenu.targetId)
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
          onAddState={
            contextMenu.type === 'canvas' &&
            contextMenu.canvasX !== undefined &&
            contextMenu.canvasY !== undefined
              ? () => addState(contextMenu.canvasX!, contextMenu.canvasY!)
              : undefined
          }
          onClose={closeContextMenu}
        />
      )}

      {waypointContextMenu && (
        <WaypointContextMenu
          menu={waypointContextMenu}
          transitions={transitions}
          onAddWaypoint={(transitionId, x, y, pathType) => {
            handleAddWaypointToTransition(transitionId, x, y, pathType, 'auto', 'auto')
          }}
          onRemoveWaypoint={(transitionId, waypointIndex) => {
            setWaypoints((prev) => {
              const current = [...(prev[transitionId] || [])]
              current.splice(waypointIndex, 1)
              if (current.length === 0) {
                const next = { ...prev }
                delete next[transitionId]
                return next
              }
              return { ...prev, [transitionId]: current }
            })
          }}
          onResetWaypoints={(transitionId) => {
            setWaypoints((prev) => {
              const next = { ...prev }
              delete next[transitionId]
              return next
            })
          }}
          onClose={() => setWaypointContextMenu(null)}
          addToast={addToast}
        />
      )}
    </>
  )
}
