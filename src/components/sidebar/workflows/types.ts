// Types specific to the workflow editor canvas
import type { 
  WorkflowTemplate, 
  WorkflowState, 
  WorkflowTransition, 
  WorkflowGate,
  TransitionLineStyle,
  TransitionPathType,
  TransitionArrowHead,
  TransitionLineThickness,
  CanvasMode 
} from '../../../types/workflow'

// Re-export commonly used types for convenience
export type { 
  WorkflowTemplate, 
  WorkflowState, 
  WorkflowTransition, 
  WorkflowGate,
  TransitionLineStyle,
  TransitionPathType,
  TransitionArrowHead,
  TransitionLineThickness,
  CanvasMode
}

// Editor state types
export interface EditorState {
  canvasMode: CanvasMode
  zoom: number
  pan: { x: number; y: number }
  selectedStateId: string | null
  selectedTransitionId: string | null
  isDragging: boolean
  dragStart: { x: number; y: number }
}

export interface DraggingState {
  draggingStateId: string | null
  dragOffset: { x: number; y: number }
}

export interface TransitionCreationState {
  isCreatingTransition: boolean
  transitionStartId: string | null
  isDraggingToCreateTransition: boolean
  hoveredStateId: string | null
}

export interface TransitionEndpointDrag {
  transitionId: string
  endpoint: 'start' | 'end'
  originalStateId: string
}

export interface ResizingState {
  stateId: string
  handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  startMouseX: number
  startMouseY: number
  startWidth: number
  startHeight: number
}

export interface StateDimensions {
  width: number
  height: number
}

export interface EdgePosition {
  edge: 'left' | 'right' | 'top' | 'bottom'
  fraction: number // 0-1 position along that edge
}

export interface SnapSettings {
  gridSize: number
  snapToGrid: boolean
  snapToAlignment: boolean
  alignmentThreshold: number
}

export interface AlignmentGuides {
  vertical: number | null
  horizontal: number | null
}

// History/undo types
export interface HistoryEntry {
  type: 'state_add' | 'state_delete' | 'state_move' | 'transition_add' | 'transition_delete'
  data: any
}

export interface ClipboardData {
  type: 'state' | 'transition'
  data: any
}

// Context menu types
export interface ContextMenuState {
  x: number
  y: number
  type: 'state' | 'transition' | 'canvas'
  targetId: string
  canvasX?: number
  canvasY?: number
}

export interface WaypointContextMenu {
  x: number
  y: number
  canvasX: number
  canvasY: number
  transitionId: string
  waypointIndex: number | null
}

// Floating toolbar types
export interface FloatingToolbarState {
  canvasX: number
  canvasY: number
  type: 'state' | 'transition'
  targetId: string
}

// Path and waypoint types
export interface Point {
  x: number
  y: number
}

export interface PointWithEdge extends Point {
  edge: 'left' | 'right' | 'top' | 'bottom'
}

export interface ElbowHandle {
  x: number
  y: number
  isVertical: boolean
  segmentIndex: number
  waypointIndex: number
}

// Workflow role type (simplified for UI)
export interface WorkflowRoleBasic {
  id: string
  name: string
  color: string
  icon: string
}

// Props interfaces for components
export interface StateNodeProps {
  state: WorkflowState
  isSelected: boolean
  isTransitionStart: boolean
  isDragging: boolean
  isResizing: boolean
  isSnapTarget: boolean
  isHovered: boolean
  isAdmin: boolean
  canvasMode: CanvasMode
  isCreatingTransition: boolean
  transitionStartId: string | null
  dimensions: StateDimensions
  onSelect: () => void
  onStartDrag: (e: React.MouseEvent) => void
  onStartResize: (handle: ResizingState['handle'], e: React.MouseEvent) => void
  onCompleteTransition: () => void
  onStartTransition: () => void
  onEdit: () => void
  onHoverChange: (isHovered: boolean) => void
}

export interface TransitionLineProps {
  transition: WorkflowTransition
  fromState: WorkflowState
  toState: WorkflowState
  isSelected: boolean
  isHovered: boolean
  isAdmin: boolean
  gates: WorkflowGate[]
  fromDimensions: StateDimensions
  toDimensions: StateDimensions
  waypoints: Point[]
  labelOffset: Point | null
  pinnedLabelPosition: Point | null
  edgePositions: {
    start: EdgePosition | null
    end: EdgePosition | null
  }
  draggingEndpoint: TransitionEndpointDrag | null
  draggingWaypointIndex: number | null
  tempCurvePos: Point | null
  tempLabelPos: Point | null
  hoveredStateId: string | null
  mousePos: Point
  onSelect: () => void
  onHoverChange: (isHovered: boolean) => void
  onEdit: () => void
  onStartEndpointDrag: (endpoint: 'start' | 'end') => void
  onStartWaypointDrag: (waypointIndex: number, axis?: 'x' | 'y' | null) => void
  onStartLabelDrag: () => void
  onAddWaypoint: (clickX: number, clickY: number) => void
  onWaypointContextMenu: (e: React.MouseEvent, waypointIndex: number | null) => void
}

export interface WorkflowCanvasProps {
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, WorkflowGate[]>
  editorState: EditorState
  isAdmin: boolean
  // ... many more props
}

export interface WorkflowToolbarProps {
  canvasMode: CanvasMode
  zoom: number
  isAdmin: boolean
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  snapSettings: SnapSettings
  onModeChange: (mode: CanvasMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onUndo: () => void
  onRedo: () => void
  onAddState: () => void
  onExport: () => void
  onImport: () => void
  onSnapSettingsChange: (settings: Partial<SnapSettings>) => void
}

export interface FloatingToolbarProps {
  x: number
  y: number
  type: 'state' | 'transition'
  isAdmin: boolean
  targetState?: WorkflowState
  targetTransition?: WorkflowTransition
  onColorChange: (color: string) => void
  onLineStyleChange?: (style: TransitionLineStyle) => void
  onPathTypeChange?: (pathType: TransitionPathType) => void
  onArrowHeadChange?: (arrowHead: TransitionArrowHead) => void
  onThicknessChange?: (thickness: TransitionLineThickness) => void
  onFillOpacityChange?: (opacity: number) => void
  onBorderColorChange?: (color: string | null) => void
  onBorderOpacityChange?: (opacity: number) => void
  onBorderThicknessChange?: (thickness: number) => void
  onCornerRadiusChange?: (radius: number) => void
  onShapeChange?: (shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse') => void
  onEdit: () => void
  onDuplicate?: () => void
  onDelete: () => void
  onAddGate?: () => void
  onClose: () => void
}

export interface WorkflowContextMenuProps {
  x: number
  y: number
  type: 'state' | 'transition' | 'canvas'
  isAdmin: boolean
  targetState?: WorkflowState
  targetTransition?: WorkflowTransition
  gates: WorkflowGate[]
  allStates: WorkflowState[]
  hasWaypoints: boolean
  onEdit: () => void
  onDelete: () => void
  onAddGate: () => void
  onResetWaypoints: () => void
  onAddState: () => void
  onClose: () => void
}

// Dialog props
export interface CreateWorkflowDialogProps {
  onClose: () => void
  onCreate: (name: string, description: string) => void
}

export interface EditWorkflowDialogProps {
  workflow: WorkflowTemplate
  onClose: () => void
  onSave: (name: string, description: string) => void
  onDelete: () => void
}

export interface EditStateDialogProps {
  state: WorkflowState
  onClose: () => void
  onSave: (updates: Partial<WorkflowState>) => void
}

export interface EditTransitionDialogProps {
  transition: WorkflowTransition
  onClose: () => void
  onSave: (updates: Partial<WorkflowTransition>) => void
}
