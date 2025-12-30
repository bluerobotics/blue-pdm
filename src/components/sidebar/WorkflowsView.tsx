// @ts-nocheck - Supabase type inference issues with Database generics
import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  Plus, 
  Edit3,
  Trash2,
  X,
  Circle,
  Pencil,
  Eye,
  CheckCircle,
  XCircle,
  Archive,
  Clock,
  AlertTriangle,
  Star,
  Flag,
  Lock,
  Unlock,
  Send,
  Inbox,
  FileCheck,
  FileX,
  ThumbsUp,
  ThumbsDown,
  UserCheck,
  Users,
  ShieldCheck,
  BadgeCheck,
  ClipboardCheck,
  ListChecks,
  ArrowRight,
  Zap,
  GitBranch,
  ZoomIn,
  ZoomOut,
  Move,
  MousePointer,
  GripHorizontal,
  Palette,
  Minus,
  MoreHorizontal,
  Copy,
  ChevronDown,
  RotateCcw,
  Grid,
  Settings2,
  Magnet,
  AlignVerticalJustifyCenter,
  AlignHorizontalJustifyCenter,
  Download,
  Upload,
  Pin
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import type { 
  WorkflowTemplate, 
  WorkflowState, 
  WorkflowTransition, 
  WorkflowGate,
  TransitionLineStyle,
  TransitionPathType,
  TransitionArrowHead,
  TransitionLineThickness,
  UserRole,
  CanvasMode
} from '../../types/workflow'
import { STATE_COLORS, getContrastColor } from '../../types/workflow'

// Icon mapping for state icons
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'circle': Circle,
  'pencil': Pencil,
  'eye': Eye,
  'check-circle': CheckCircle,
  'x-circle': XCircle,
  'archive': Archive,
  'clock': Clock,
  'alert-triangle': AlertTriangle,
  'star': Star,
  'flag': Flag,
  'lock': Lock,
  'unlock': Unlock,
  'send': Send,
  'inbox': Inbox,
  'file-check': FileCheck,
  'file-x': FileX,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'user-check': UserCheck,
  'users': Users,
  'shield-check': ShieldCheck,
  'badge-check': BadgeCheck,
  'clipboard-check': ClipboardCheck,
  'list-checks': ListChecks,
}

// Helper to lighten a hex color
const lightenColor = (hex: string, amount: number): string => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  
  const newR = Math.min(255, Math.round(r + (255 - r) * amount))
  const newG = Math.min(255, Math.round(g + (255 - g) * amount))
  const newB = Math.min(255, Math.round(b + (255 - b) * amount))
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}

export function WorkflowsView() {
  const { organization, user, addToast, getEffectiveRole } = usePDMStore()
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([])
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTemplate | null>(null)
  const [states, setStates] = useState<WorkflowState[]>([])
  const [transitions, setTransitions] = useState<WorkflowTransition[]>([])
  const [gates, setGates] = useState<Record<string, WorkflowGate[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  
  // Update isAdmin when role changes (including impersonation)
  const effectiveRole = getEffectiveRole()
  
  // Canvas state
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('select')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null)
  const [isCreatingTransition, setIsCreatingTransition] = useState(false)
  const [transitionStartId, setTransitionStartId] = useState<string | null>(null)
  const [isDraggingToCreateTransition, setIsDraggingToCreateTransition] = useState(false) // Track drag-to-connect from handle
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  
  // Dragging state
  const [draggingStateId, setDraggingStateId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const hasDraggedRef = useRef(false) // Track if actual dragging occurred (vs just click)
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null) // Initial click position for threshold check
  const justCompletedTransitionRef = useRef(false) // Track if we just completed ANY transition (click or drag)
  const transitionCompletedAtRef = useRef<number>(0) // Timestamp of last transition completion
  const DRAG_THRESHOLD = 5 // Pixels of movement before drag starts
  
  // Dragging transition endpoint
  const [draggingTransitionEndpoint, setDraggingTransitionEndpoint] = useState<{
    transitionId: string
    endpoint: 'start' | 'end'
    originalStateId: string
  } | null>(null)
  const [hoveredStateId, setHoveredStateId] = useState<string | null>(null)
  
  // Resizing state boxes
  const [resizingState, setResizingState] = useState<{
    stateId: string
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
    startMouseX: number
    startMouseY: number
    startWidth: number
    startHeight: number
  } | null>(null)
  // Store custom dimensions per state (default is 120x60)
  const [stateDimensions, setStateDimensions] = useState<Record<string, { width: number; height: number }>>({})
  const DEFAULT_STATE_WIDTH = 120
  const DEFAULT_STATE_HEIGHT = 60
  
  // Hover state for showing connection points and effects
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [hoveredTransitionId, setHoveredTransitionId] = useState<string | null>(null)
  
  // Pinned transition labels - stores absolute canvas position (label stays fixed, doesn't follow line)
  const [pinnedLabelPositions, setPinnedLabelPositions] = useState<Record<string, { x: number; y: number }>>({})
  
  // Hover state for control points (for highlight effect)
  const [hoveredWaypoint, setHoveredWaypoint] = useState<{ transitionId: string; index: number } | null>(null)
  
  // Floating toolbar state (stores canvas coordinates, screen position computed dynamically)
  const [floatingToolbar, setFloatingToolbar] = useState<{
    canvasX: number  // Canvas coordinate (not screen)
    canvasY: number  // Canvas coordinate (not screen)
    type: 'state' | 'transition'
    targetId: string
  } | null>(null)
  
  // Dragging curve control point (waypoint handle)
  const [draggingCurveControl, setDraggingCurveControl] = useState<string | null>(null) // transitionId
  const [draggingWaypointIndex, setDraggingWaypointIndex] = useState<number | null>(null) // which waypoint index
  const [draggingWaypointAxis, setDraggingWaypointAxis] = useState<'x' | 'y' | null>(null) // axis constraint for elbow paths
  // Store waypoints per transition (array of points the curve passes through)
  const [waypoints, setWaypoints] = useState<Record<string, Array<{ x: number; y: number }>>>({})
  // Temp position while dragging curve control
  const [tempCurvePos, setTempCurvePos] = useState<{ x: number; y: number } | null>(null)
  const waypointHasDraggedRef = useRef(false) // Track if actual dragging occurred
  const justFinishedWaypointDragRef = useRef(false) // Track if we just finished a waypoint drag (to prevent deselection)
  const justFinishedLabelDragRef = useRef(false) // Track if we just finished a label drag (to prevent deselection)
  const handleCanvasMouseUpRef = useRef<() => void>(() => {}) // Ref to always point to latest mouseup handler
  const mouseUpProcessingRef = useRef(false) // Guard to prevent double mouseup processing
  
  // Dragging label position
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null) // transitionId
  // Store custom label offsets per transition (relative to curve midpoint)
  const [labelOffsets, setLabelOffsets] = useState<Record<string, { x: number; y: number }>>({})
  // Temp position while dragging label
  const [tempLabelPos, setTempLabelPos] = useState<{ x: number; y: number } | null>(null)
  
  // Store custom edge connection points (as a fraction 0-1 along each edge)
  // Key format: "transitionId-start" or "transitionId-end"
  const [edgePositions, setEdgePositions] = useState<Record<string, { 
    edge: 'left' | 'right' | 'top' | 'bottom'
    fraction: number // 0-1 position along that edge
  }>>({})
  
  // Snap settings
  const [snapSettings, setSnapSettings] = useState({
    gridSize: 40,          // Grid cell size in pixels
    snapToGrid: false,     // Whether to snap to grid when dragging
    snapToAlignment: true, // Whether to snap to vertical/horizontal alignment with other states
    alignmentThreshold: 10 // How close (in pixels) before snapping to alignment
  })
  const [showSnapSettings, setShowSnapSettings] = useState(false)
  const [alignmentGuides, setAlignmentGuides] = useState<{
    vertical: number | null    // X coordinate for vertical alignment guide
    horizontal: number | null  // Y coordinate for horizontal alignment guide
  }>({ vertical: null, horizontal: null })
  
  // Undo/Redo history
  type HistoryEntry = {
    type: 'state_add' | 'state_delete' | 'state_move' | 'transition_add' | 'transition_delete'
    data: any
  }
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const MAX_HISTORY = 50
  
  // Clipboard for copy/paste
  const [clipboard, setClipboard] = useState<{
    type: 'state' | 'transition'
    data: any
  } | null>(null)
  
  // LocalStorage key for visual customizations
  const getStorageKey = (workflowId: string) => `workflow-visual-${workflowId}`
  
  // Load visual customizations from localStorage when workflow changes
  useEffect(() => {
    if (!selectedWorkflow?.id) return
    
    try {
      const stored = localStorage.getItem(getStorageKey(selectedWorkflow.id))
      if (stored) {
        const data = JSON.parse(stored)
        // Support both old curveMidpoints (single point) and new waypoints (array)
        if (data.waypoints) {
          setWaypoints(data.waypoints)
        } else if (data.curveMidpoints) {
          // Migrate old format: convert single midpoint to array with one waypoint
          const migrated: Record<string, Array<{ x: number; y: number }>> = {}
          for (const [key, value] of Object.entries(data.curveMidpoints)) {
            migrated[key] = [value as { x: number; y: number }]
          }
          setWaypoints(migrated)
        }
        if (data.labelOffsets) setLabelOffsets(data.labelOffsets)
        if (data.edgePositions) setEdgePositions(data.edgePositions)
        if (data.snapSettings) setSnapSettings(prev => ({ ...prev, ...data.snapSettings }))
      }
    } catch (e) {
      console.warn('Failed to load workflow visual data:', e)
    }
  }, [selectedWorkflow?.id])
  
  // Save visual customizations to localStorage when they change
  useEffect(() => {
    if (!selectedWorkflow?.id) return
    
    try {
      localStorage.setItem(getStorageKey(selectedWorkflow.id), JSON.stringify({
        waypoints,
        labelOffsets,
        edgePositions,
        snapSettings
      }))
    } catch (e) {
      console.warn('Failed to save workflow visual data:', e)
    }
  }, [selectedWorkflow?.id, waypoints, labelOffsets, edgePositions, snapSettings])
  
  // Editing state
  const [showCreateWorkflow, setShowCreateWorkflow] = useState(false)
  const [showEditWorkflow, setShowEditWorkflow] = useState(false)
  const [showEditState, setShowEditState] = useState(false)
  const [showEditTransition, setShowEditTransition] = useState(false)
  const [showEditGate, setShowEditGate] = useState(false)
  const [editingState, setEditingState] = useState<WorkflowState | null>(null)
  const [editingTransition, setEditingTransition] = useState<WorkflowTransition | null>(null)
  const [editingGate, setEditingGate] = useState<WorkflowGate | null>(null)
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'state' | 'transition' | 'canvas'
    targetId: string
    canvasX?: number  // Canvas position for adding new state
    canvasY?: number
  } | null>(null)
  
  // Waypoint context menu (for adding/deleting control points on lines)
  const [waypointContextMenu, setWaypointContextMenu] = useState<{
    x: number          // Screen position
    y: number          // Screen position
    canvasX: number    // Canvas position for adding waypoint
    canvasY: number    // Canvas position for adding waypoint
    transitionId: string
    waypointIndex: number | null  // null = clicked on line (add only), number = clicked on waypoint (delete option)
  } | null>(null)
  
  const canvasRef = useRef<HTMLDivElement>(null)
  
  // Check if user is admin (respects role impersonation)
  useEffect(() => {
    setIsAdmin(effectiveRole === 'admin')
  }, [effectiveRole])
  
  // Push to undo stack helper
  const pushToUndo = useCallback((entry: HistoryEntry) => {
    setUndoStack(prev => {
      const newStack = [...prev, entry]
      if (newStack.length > MAX_HISTORY) newStack.shift()
      return newStack
    })
    setRedoStack([]) // Clear redo when new action is performed
  }, [])
  
  // Undo function
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || !isAdmin) return
    
    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    
    try {
      switch (entry.type) {
        case 'state_delete':
          // Re-add the deleted state
          const { data: restoredState, error: stateError } = await supabase
            .from('workflow_states')
            .insert(entry.data.state)
            .select()
            .single()
          if (stateError) throw stateError
          setStates(prev => [...prev, restoredState])
          setRedoStack(prev => [...prev, { type: 'state_add', data: { state: restoredState } }])
          addToast('success', 'Undo: State restored')
          break
          
        case 'state_add':
          // Delete the added state
          await supabase.from('workflow_states').delete().eq('id', entry.data.state.id)
          setStates(prev => prev.filter(s => s.id !== entry.data.state.id))
          setRedoStack(prev => [...prev, { type: 'state_delete', data: entry.data }])
          addToast('success', 'Undo: State removed')
          break
          
        case 'transition_delete':
          // Re-add the deleted transition
          const { data: restoredTrans, error: transError } = await supabase
            .from('workflow_transitions')
            .insert(entry.data.transition)
            .select()
            .single()
          if (transError) throw transError
          setTransitions(prev => [...prev, restoredTrans])
          setRedoStack(prev => [...prev, { type: 'transition_add', data: { transition: restoredTrans } }])
          addToast('success', 'Undo: Transition restored')
          break
          
        case 'transition_add':
          // Delete the added transition
          await supabase.from('workflow_transitions').delete().eq('id', entry.data.transition.id)
          setTransitions(prev => prev.filter(t => t.id !== entry.data.transition.id))
          setRedoStack(prev => [...prev, { type: 'transition_delete', data: entry.data }])
          addToast('success', 'Undo: Transition removed')
          break
          
        case 'state_move':
          // Move state back to original position
          await supabase
            .from('workflow_states')
            .update({ position_x: entry.data.oldX, position_y: entry.data.oldY })
            .eq('id', entry.data.stateId)
          setStates(prev => prev.map(s => 
            s.id === entry.data.stateId 
              ? { ...s, position_x: entry.data.oldX, position_y: entry.data.oldY }
              : s
          ))
          setRedoStack(prev => [...prev, { 
            type: 'state_move', 
            data: { stateId: entry.data.stateId, oldX: entry.data.newX, oldY: entry.data.newY, newX: entry.data.oldX, newY: entry.data.oldY }
          }])
          addToast('success', 'Undo: State moved back')
          break
      }
    } catch (err) {
      console.error('Undo failed:', err)
      addToast('error', 'Undo failed')
    }
  }, [undoStack, isAdmin, addToast])
  
  // Redo function
  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0 || !isAdmin) return
    
    const entry = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    
    try {
      switch (entry.type) {
        case 'state_add':
          const { data: readdedState, error: stateError } = await supabase
            .from('workflow_states')
            .insert(entry.data.state)
            .select()
            .single()
          if (stateError) throw stateError
          setStates(prev => [...prev, readdedState])
          setUndoStack(prev => [...prev, { type: 'state_delete', data: { state: readdedState } }])
          break
          
        case 'state_delete':
          await supabase.from('workflow_states').delete().eq('id', entry.data.state.id)
          setStates(prev => prev.filter(s => s.id !== entry.data.state.id))
          setUndoStack(prev => [...prev, { type: 'state_add', data: entry.data }])
          break
          
        case 'transition_add':
          const { data: readdedTrans, error: transError } = await supabase
            .from('workflow_transitions')
            .insert(entry.data.transition)
            .select()
            .single()
          if (transError) throw transError
          setTransitions(prev => [...prev, readdedTrans])
          setUndoStack(prev => [...prev, { type: 'transition_delete', data: { transition: readdedTrans } }])
          break
          
        case 'transition_delete':
          await supabase.from('workflow_transitions').delete().eq('id', entry.data.transition.id)
          setTransitions(prev => prev.filter(t => t.id !== entry.data.transition.id))
          setUndoStack(prev => [...prev, { type: 'transition_add', data: entry.data }])
          break
          
        case 'state_move':
          await supabase
            .from('workflow_states')
            .update({ position_x: entry.data.newX, position_y: entry.data.newY })
            .eq('id', entry.data.stateId)
          setStates(prev => prev.map(s => 
            s.id === entry.data.stateId 
              ? { ...s, position_x: entry.data.newX, position_y: entry.data.newY }
              : s
          ))
          setUndoStack(prev => [...prev, { 
            type: 'state_move', 
            data: { stateId: entry.data.stateId, oldX: entry.data.newX, oldY: entry.data.newY, newX: entry.data.oldX, newY: entry.data.oldY }
          }])
          break
      }
    } catch (err) {
      console.error('Redo failed:', err)
      addToast('error', 'Redo failed')
    }
  }, [redoStack, isAdmin, addToast])
  
  // Copy selected item
  const handleCopy = useCallback(() => {
    if (selectedStateId) {
      const state = states.find(s => s.id === selectedStateId)
      if (state) {
        setClipboard({ type: 'state', data: state })
        addToast('success', 'State copied')
      }
    } else if (selectedTransitionId) {
      const transition = transitions.find(t => t.id === selectedTransitionId)
      if (transition) {
        setClipboard({ type: 'transition', data: transition })
        addToast('success', 'Transition copied')
      }
    }
  }, [selectedStateId, selectedTransitionId, states, transitions, addToast])
  
  // Cut selected item (copy + delete)
  const handleCut = useCallback(async () => {
    if (!isAdmin) return
    
    if (selectedStateId) {
      const state = states.find(s => s.id === selectedStateId)
      if (state) {
        // Check for transitions first
        const hasTransitions = transitions.some(
          t => t.from_state_id === selectedStateId || t.to_state_id === selectedStateId
        )
        if (hasTransitions) {
          addToast('error', 'Remove all transitions first')
          return
        }
        setClipboard({ type: 'state', data: state })
        // Delete the state
        try {
          await supabase.from('workflow_states').delete().eq('id', selectedStateId)
          setStates(prev => prev.filter(s => s.id !== selectedStateId))
          pushToUndo({ type: 'state_delete', data: { state } })
          setSelectedStateId(null)
          setFloatingToolbar(null)
          addToast('success', 'State cut')
        } catch (err) {
          console.error('Cut failed:', err)
          addToast('error', 'Cut failed')
        }
      }
    } else if (selectedTransitionId) {
      const transition = transitions.find(t => t.id === selectedTransitionId)
      if (transition) {
        setClipboard({ type: 'transition', data: transition })
        // Delete the transition
        try {
          await supabase.from('workflow_transitions').delete().eq('id', selectedTransitionId)
          setTransitions(prev => prev.filter(t => t.id !== selectedTransitionId))
          pushToUndo({ type: 'transition_delete', data: { transition } })
          setSelectedTransitionId(null)
          setFloatingToolbar(null)
          addToast('success', 'Transition cut')
        } catch (err) {
          console.error('Cut failed:', err)
          addToast('error', 'Cut failed')
        }
      }
    }
  }, [isAdmin, selectedStateId, selectedTransitionId, states, transitions, addToast, pushToUndo])
  
  // Paste from clipboard
  const handlePaste = useCallback(async () => {
    if (!clipboard || !isAdmin || !selectedWorkflow) return
    
    try {
      if (clipboard.type === 'state') {
        // Create a new state with offset position
        const newState: Partial<WorkflowState> = {
          ...clipboard.data,
          id: undefined,
          workflow_id: selectedWorkflow.id,
          position_x: clipboard.data.position_x + 50,
          position_y: clipboard.data.position_y + 50,
          name: `${clipboard.data.name} (copy)`,
        }
        delete (newState as any).created_at
        delete (newState as any).updated_at
        
        const { data, error } = await supabase
          .from('workflow_states')
          .insert(newState)
          .select()
          .single()
        
        if (error) throw error
        
        setStates(prev => [...prev, data])
        pushToUndo({ type: 'state_add', data: { state: data } })
        setSelectedStateId(data.id)
        addToast('success', 'State pasted')
      } else if (clipboard.type === 'transition') {
        // Can only paste transition if both states exist
        const fromExists = states.some(s => s.id === clipboard.data.from_state_id)
        const toExists = states.some(s => s.id === clipboard.data.to_state_id)
        
        if (!fromExists || !toExists) {
          addToast('error', 'Cannot paste: source or target state not found')
          return
        }
        
        // Check if transition already exists
        const exists = transitions.some(
          t => t.from_state_id === clipboard.data.from_state_id && 
               t.to_state_id === clipboard.data.to_state_id
        )
        if (exists) {
          addToast('error', 'Transition already exists')
          return
        }
        
        const newTransition: Partial<WorkflowTransition> = {
          ...clipboard.data,
          id: undefined,
          workflow_id: selectedWorkflow.id,
          name: `${clipboard.data.name} (copy)`,
        }
        delete (newTransition as any).created_at
        delete (newTransition as any).updated_at
        
        const { data, error } = await supabase
          .from('workflow_transitions')
          .insert(newTransition)
          .select()
          .single()
        
        if (error) throw error
        
        setTransitions(prev => [...prev, data])
        pushToUndo({ type: 'transition_add', data: { transition: data } })
        setSelectedTransitionId(data.id)
        addToast('success', 'Transition pasted')
      }
    } catch (err) {
      console.error('Paste failed:', err)
      addToast('error', 'Paste failed')
    }
  }, [clipboard, isAdmin, selectedWorkflow, states, transitions, addToast, pushToUndo])
  
  // Delete selected item
  const handleDeleteSelected = useCallback(async () => {
    if (!isAdmin) return
    
    if (selectedStateId) {
      const state = states.find(s => s.id === selectedStateId)
      if (!state) return
      
      // Check for transitions first
      const hasTransitions = transitions.some(
        t => t.from_state_id === selectedStateId || t.to_state_id === selectedStateId
      )
      if (hasTransitions) {
        addToast('error', 'Remove all transitions first')
        return
      }
      
      try {
        await supabase.from('workflow_states').delete().eq('id', selectedStateId)
        setStates(prev => prev.filter(s => s.id !== selectedStateId))
        pushToUndo({ type: 'state_delete', data: { state } })
        setSelectedStateId(null)
        setFloatingToolbar(null)
        addToast('success', 'State deleted')
      } catch (err) {
        console.error('Delete failed:', err)
        addToast('error', 'Delete failed')
      }
    } else if (selectedTransitionId) {
      const transition = transitions.find(t => t.id === selectedTransitionId)
      if (!transition) return
      
      try {
        await supabase.from('workflow_transitions').delete().eq('id', selectedTransitionId)
        setTransitions(prev => prev.filter(t => t.id !== selectedTransitionId))
        pushToUndo({ type: 'transition_delete', data: { transition } })
        setSelectedTransitionId(null)
        setFloatingToolbar(null)
        addToast('success', 'Transition deleted')
      } catch (err) {
        console.error('Delete failed:', err)
        addToast('error', 'Delete failed')
      }
    }
  }, [isAdmin, selectedStateId, selectedTransitionId, states, transitions, addToast, pushToUndo])
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      
      // Escape - cancel connect mode or creating transition
      if (e.key === 'Escape') {
        if (isCreatingTransition) {
          setIsCreatingTransition(false)
          setTransitionStartId(null)
        }
        if (canvasMode === 'connect') {
          setCanvasMode('select')
        }
        return
      }
      
      // Delete or Backspace - delete selected item
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if a modal is open
        if (showEditState || showEditTransition) return
        handleDeleteSelected()
        e.preventDefault()
        return
      }
      
      // Ctrl/Cmd + Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        handleUndo()
        e.preventDefault()
        return
      }
      
      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
        handleRedo()
        e.preventDefault()
        return
      }
      
      // Ctrl/Cmd + C - Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        handleCopy()
        e.preventDefault()
        return
      }
      
      // Ctrl/Cmd + X - Cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        handleCut()
        e.preventDefault()
        return
      }
      
      // Ctrl/Cmd + V - Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        handlePaste()
        e.preventDefault()
        return
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCreatingTransition, canvasMode, showEditState, showEditTransition, handleDeleteSelected, handleUndo, handleRedo, handleCopy, handleCut, handlePaste])
  
  // Global mouseup listener to catch mouse releases outside the canvas during drags
  // Note: Does NOT include isDraggingToCreateTransition - that flow handles its own mouseup via state box
  useEffect(() => {
    const isAnyDragActive = draggingStateId || draggingCurveControl || draggingTransitionEndpoint || 
                           draggingLabel || resizingState || isDragging
    
    // Don't attach global listener if dragging to create transition - that has its own handlers
    if (!isAnyDragActive) return
    
    const handleGlobalMouseUp = () => {
      // Skip if we're creating a transition - don't interfere with that flow
      if (isDraggingToCreateTransition || isCreatingTransition) return
      
      // Call the canvas mouseup handler via ref to get the latest version
      // This ensures waypoint positions, state positions, etc. are saved
      handleCanvasMouseUpRef.current()
    }
    
    // Attach to document so we catch releases anywhere
    document.addEventListener('mouseup', handleGlobalMouseUp)
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [draggingStateId, draggingCurveControl, draggingTransitionEndpoint, draggingLabel, resizingState, isDragging, isDraggingToCreateTransition, isCreatingTransition])
  
  // Load workflows
  useEffect(() => {
    if (!organization) {
      setWorkflows([])
      setIsLoading(false)
      return
    }
    
    loadWorkflows()
  }, [organization])
  
  const loadWorkflows = async () => {
    if (!organization) return
    
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('workflow_templates')
        .select('*')
        .eq('org_id', organization.id)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name')
      
      if (error) throw error
      setWorkflows(data || [])
      
      // Auto-select default workflow
      if (data && data.length > 0 && !selectedWorkflow) {
        const defaultWorkflow = data.find(w => w.is_default) || data[0]
        await selectWorkflow(defaultWorkflow)
      }
    } catch (err) {
      console.error('Failed to load workflows:', err)
      addToast('error', 'Failed to load workflows')
    } finally {
      setIsLoading(false)
    }
  }
  
  const selectWorkflow = async (workflow: WorkflowTemplate) => {
    setSelectedWorkflow(workflow)
    setSelectedStateId(null)
    setSelectedTransitionId(null)
    
    // Load states
    try {
      const { data: statesData } = await supabase
        .from('workflow_states')
        .select('*')
        .eq('workflow_id', workflow.id)
        .order('sort_order')
      
      setStates(statesData || [])
      
      // Load transitions
      const { data: transitionsData } = await supabase
        .from('workflow_transitions')
        .select('*')
        .eq('workflow_id', workflow.id)
      
      setTransitions(transitionsData || [])
      
      // Load gates for each transition
      if (transitionsData && transitionsData.length > 0) {
        const { data: gatesData } = await supabase
          .from('workflow_gates')
          .select('*')
          .in('transition_id', transitionsData.map(t => t.id))
          .order('sort_order')
        
        // Group gates by transition
        const gatesByTransition: Record<string, WorkflowGate[]> = {}
        gatesData?.forEach(gate => {
          if (!gatesByTransition[gate.transition_id]) {
            gatesByTransition[gate.transition_id] = []
          }
          gatesByTransition[gate.transition_id].push(gate)
        })
        setGates(gatesByTransition)
      }
      
      // Apply canvas config - center on content by default
      const zoomLevel = workflow.canvas_config?.zoom || 1
      setZoom(zoomLevel)
      
      // Center view on content (states) instead of origin
      if (statesData && statesData.length > 0) {
        // Calculate bounding box of all states
        const minX = Math.min(...statesData.map(s => s.position_x))
        const maxX = Math.max(...statesData.map(s => s.position_x))
        const minY = Math.min(...statesData.map(s => s.position_y))
        const maxY = Math.max(...statesData.map(s => s.position_y))
        
        // Calculate center of content
        const contentCenterX = (minX + maxX) / 2
        const contentCenterY = (minY + maxY) / 2
        
        // Get canvas dimensions (use a reasonable default if not yet rendered)
        const canvasWidth = canvasRef.current?.clientWidth || 800
        const canvasHeight = canvasRef.current?.clientHeight || 600
        
        // Calculate pan to center content in viewport
        // Pan formula: content should appear at center of viewport
        // viewportCenter = contentCenter * zoom + pan
        // pan = viewportCenter - contentCenter * zoom
        const panX = (canvasWidth / 2) - (contentCenterX * zoomLevel)
        const panY = (canvasHeight / 2) - (contentCenterY * zoomLevel)
        
        setPan({ x: panX, y: panY })
      } else {
        // No states - use saved config or default to origin
        setPan({ 
          x: workflow.canvas_config?.panX || 0, 
          y: workflow.canvas_config?.panY || 0 
        })
      }
    } catch (err) {
      console.error('Failed to load workflow details:', err)
    }
  }
  
  // Create new workflow
  const createWorkflow = async (name: string, description: string) => {
    if (!organization || !user) return
    
    try {
      // Create the workflow using the default workflow function
      const { data, error } = await supabase
        .rpc('create_default_workflow', {
          p_org_id: organization.id,
          p_created_by: user.id
        })
      
      if (error) throw error
      
      // Update the name if different from default
      if (name !== 'Standard Release Process') {
        await supabase
          .from('workflow_templates')
          .update({ name, description })
          .eq('id', data)
      }
      
      addToast('success', 'Workflow created successfully')
      await loadWorkflows()
      setShowCreateWorkflow(false)
    } catch (err) {
      console.error('Failed to create workflow:', err)
      addToast('error', 'Failed to create workflow')
    }
  }
  
  // Add new state
  const addState = async () => {
    if (!selectedWorkflow || !isAdmin) return
    
    const newState: Partial<WorkflowState> = {
      workflow_id: selectedWorkflow.id,
      state_type: 'state',
      shape: 'rectangle',
      name: 'New State',
      label: 'New State',
      description: '',
      color: '#6B7280',
      icon: 'circle',
      position_x: 250 + states.length * 50,
      position_y: 200,
      is_editable: true,
      requires_checkout: true,
      auto_increment_revision: false,
      sort_order: states.length,
    }
    
    try {
      const { data, error } = await supabase
        .from('workflow_states')
        .insert(newState)
        .select()
        .single()
      
      if (error) throw error
      
      setStates([...states, data])
      setSelectedStateId(data.id)
      setEditingState(data)
      setShowEditState(true)
    } catch (err) {
      console.error('Failed to add state:', err)
      addToast('error', 'Failed to add state')
    }
  }
  
  // Export workflow to JSON
  const exportWorkflow = () => {
    if (!selectedWorkflow) return
    
    // Create export data structure
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      workflow: {
        name: selectedWorkflow.name,
        description: selectedWorkflow.description,
        canvas_config: selectedWorkflow.canvas_config,
      },
      states: states.map(s => ({
        name: s.name,
        label: s.label,
        description: s.description,
        color: s.color,
        icon: s.icon,
        position_x: s.position_x,
        position_y: s.position_y,
        is_editable: s.is_editable,
        requires_checkout: s.requires_checkout,
        auto_increment_revision: s.auto_increment_revision,
        sort_order: s.sort_order,
        // Use name as reference key for transitions
        _key: s.name
      })),
      transitions: transitions.map(t => {
        const fromState = states.find(s => s.id === t.from_state_id)
        const toState = states.find(s => s.id === t.to_state_id)
        return {
          from_state: fromState?.name,
          to_state: toState?.name,
          name: t.name,
          description: t.description,
          line_style: t.line_style,
          path_type: t.path_type,
          arrow_head: t.arrow_head,
          line_thickness: t.line_thickness,
          color: t.color,
          label_position: t.label_position,
        }
      })
    }
    
    // Download as JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${selectedWorkflow.name.toLowerCase().replace(/\s+/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    addToast('success', 'Workflow exported')
  }
  
  // Import workflow from JSON
  const importWorkflow = async (file: File) => {
    if (!selectedWorkflow || !isAdmin) return
    
    try {
      const text = await file.text()
      const importData = JSON.parse(text)
      
      // Validate import data
      if (!importData.version || !importData.states || !Array.isArray(importData.states)) {
        addToast('error', 'Invalid workflow file format')
        return
      }
      
      // Confirm import (will replace existing states/transitions)
      const confirmed = window.confirm(
        `Import workflow from "${file.name}"?\n\nThis will replace all existing states and transitions in "${selectedWorkflow.name}".`
      )
      if (!confirmed) return
      
      // Delete existing transitions first (due to foreign key constraints)
      await supabase
        .from('workflow_transitions')
        .delete()
        .eq('workflow_id', selectedWorkflow.id)
      
      // Delete existing states
      await supabase
        .from('workflow_states')
        .delete()
        .eq('workflow_id', selectedWorkflow.id)
      
      // Create new states and build ID mapping
      const stateIdMap: Record<string, string> = {}
      const newStates: WorkflowState[] = []
      
      for (const stateData of importData.states) {
        const { data: newState, error } = await supabase
          .from('workflow_states')
          .insert({
            workflow_id: selectedWorkflow.id,
            name: stateData.name,
            label: stateData.label,
            description: stateData.description,
            color: stateData.color || '#6B7280',
            icon: stateData.icon || 'circle',
            position_x: stateData.position_x || 100,
            position_y: stateData.position_y || 100,
            is_editable: stateData.is_editable ?? true,
            requires_checkout: stateData.requires_checkout ?? true,
            auto_increment_revision: stateData.auto_increment_revision ?? false,
            sort_order: stateData.sort_order || 0,
          })
          .select()
          .single()
        
        if (error) throw error
        
        // Map the original state name/key to new ID
        stateIdMap[stateData._key || stateData.name] = newState.id
        newStates.push(newState)
      }
      
      // Create transitions using the ID mapping
      const newTransitions: WorkflowTransition[] = []
      
      if (importData.transitions && Array.isArray(importData.transitions)) {
        for (const transData of importData.transitions) {
          const fromStateId = stateIdMap[transData.from_state]
          const toStateId = stateIdMap[transData.to_state]
          
          if (!fromStateId || !toStateId) {
            console.warn(`Skipping transition: state not found (${transData.from_state} -> ${transData.to_state})`)
            continue
          }
          
          const { data: newTrans, error } = await supabase
            .from('workflow_transitions')
            .insert({
              workflow_id: selectedWorkflow.id,
              from_state_id: fromStateId,
              to_state_id: toStateId,
              name: transData.name,
              description: transData.description,
              line_style: transData.line_style || 'solid',
              path_type: transData.path_type || 'straight',
              arrow_head: transData.arrow_head || 'end',
              line_thickness: transData.line_thickness || 'normal',
              color: transData.color,
              label_position: transData.label_position || 50,
            })
            .select()
            .single()
          
          if (error) throw error
          newTransitions.push(newTrans)
        }
      }
      
      // Update workflow metadata if provided
      if (importData.workflow) {
        await supabase
          .from('workflow_templates')
          .update({
            description: importData.workflow.description,
            canvas_config: importData.workflow.canvas_config,
          })
          .eq('id', selectedWorkflow.id)
      }
      
      // Update local state
      setStates(newStates)
      setTransitions(newTransitions)
      setSelectedStateId(null)
      setSelectedTransitionId(null)
      
      addToast('success', `Imported ${newStates.length} states and ${newTransitions.length} transitions`)
    } catch (err) {
      console.error('Failed to import workflow:', err)
      addToast('error', `Failed to import workflow: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }
  
  // File input ref for import
  const importInputRef = useRef<HTMLInputElement>(null)
  
  // Update state position (drag)
  const updateStatePosition = async (stateId: string, x: number, y: number) => {
    try {
      await supabase
        .from('workflow_states')
        .update({ position_x: Math.round(x), position_y: Math.round(y) })
        .eq('id', stateId)
      
      // Use functional updater to avoid stale closure issues
      setStates(prev => prev.map(s => 
        s.id === stateId ? { ...s, position_x: Math.round(x), position_y: Math.round(y) } : s
      ))
    } catch (err) {
      console.error('Failed to update state position:', err)
    }
  }
  
  // Delete state
  const deleteState = async (stateId: string) => {
    if (!isAdmin) return
    
    try {
      // Check if state has transitions
      const hasTransitions = transitions.some(
        t => t.from_state_id === stateId || t.to_state_id === stateId
      )
      
      if (hasTransitions) {
        addToast('error', 'Remove all transitions first')
        return
      }
      
      await supabase
        .from('workflow_states')
        .delete()
        .eq('id', stateId)
      
      setStates(states.filter(s => s.id !== stateId))
      setSelectedStateId(null)
      addToast('success', 'State deleted')
    } catch (err) {
      console.error('Failed to delete state:', err)
      addToast('error', 'Failed to delete state')
    }
  }
  
  // Start creating transition
  const startTransition = (fromStateId: string) => {
    if (!isAdmin) return
    setIsCreatingTransition(true)
    setTransitionStartId(fromStateId)
  }
  
  // Complete transition
  const completeTransition = async (toStateId: string) => {
    if (!selectedWorkflow || !transitionStartId || !isAdmin) return
    
    // Mark immediately that we're completing a transition to prevent subsequent events
    justCompletedTransitionRef.current = true
    transitionCompletedAtRef.current = Date.now()
    
    // Don't allow self-transitions
    if (transitionStartId === toStateId) {
      setIsCreatingTransition(false)
      setTransitionStartId(null)
      return
    }
    
    // Check if transition already exists
    const exists = transitions.some(
      t => t.from_state_id === transitionStartId && t.to_state_id === toStateId
    )
    
    if (exists) {
      addToast('error', 'Transition already exists')
      setIsCreatingTransition(false)
      setTransitionStartId(null)
      return
    }
    
    try {
      const newTransition: Partial<WorkflowTransition> = {
        workflow_id: selectedWorkflow.id,
        from_state_id: transitionStartId,
        to_state_id: toStateId,
        name: 'New Transition',
        line_style: 'solid',
        allowed_roles: ['admin', 'engineer'],
      }
      
      const { data, error } = await supabase
        .from('workflow_transitions')
        .insert(newTransition)
        .select()
        .single()
      
      if (error) throw error
      
      // Use functional updater to avoid stale closure issues
      setTransitions(prev => [...prev, data])
      setSelectedTransitionId(data.id)
      setEditingTransition(data)
      setShowEditTransition(true)
      
      // Create a default waypoint for the new spline transition
      const fromState = states.find(s => s.id === transitionStartId)
      const toState = states.find(s => s.id === toStateId)
      if (fromState && toState) {
        const midX = (fromState.position_x + toState.position_x) / 2
        const midY = (fromState.position_y + toState.position_y) / 2 - 40 // Offset up for natural curve
        setWaypoints(prev => ({
          ...prev,
          [data.id]: [{ x: midX, y: midY }]
        }))
      }
    } catch (err) {
      console.error('Failed to create transition:', err)
      addToast('error', 'Failed to create transition')
    }
    
    setIsCreatingTransition(false)
    setTransitionStartId(null)
    setIsDraggingToCreateTransition(false)
    setHoveredStateId(null)
  }
  
  // Delete transition
  const deleteTransition = async (transitionId: string) => {
    if (!isAdmin) return
    
    try {
      await supabase
        .from('workflow_transitions')
        .delete()
        .eq('id', transitionId)
      
      setTransitions(transitions.filter(t => t.id !== transitionId))
      setSelectedTransitionId(null)
      addToast('success', 'Transition deleted')
    } catch (err) {
      console.error('Failed to delete transition:', err)
      addToast('error', 'Failed to delete transition')
    }
  }
  
  // Add gate to transition (approval requirement on a transition line)
  const addTransitionGate = async (transitionId: string) => {
    if (!isAdmin) return
    
    try {
      const newGate: Partial<WorkflowGate> = {
        transition_id: transitionId,
        name: 'New Gate',
        gate_type: 'approval',
        required_approvals: 1,
        approval_mode: 'any',
        is_blocking: true,
        can_be_skipped_by: [],
        checklist_items: [],
        sort_order: (gates[transitionId]?.length || 0),
      }
      
      const { data, error } = await supabase
        .from('workflow_gates')
        .insert(newGate)
        .select()
        .single()
      
      if (error) throw error
      
      setGates({
        ...gates,
        [transitionId]: [...(gates[transitionId] || []), data]
      })
      setEditingGate(data)
      setShowEditGate(true)
    } catch (err) {
      console.error('Failed to add gate:', err)
      addToast('error', 'Failed to add gate')
    }
  }
  
  // Cancel connect mode / creating transition
  const cancelConnectMode = useCallback(() => {
    setIsCreatingTransition(false)
    setTransitionStartId(null)
    setIsDraggingToCreateTransition(false)
    setHoveredStateId(null)
  }, [])
  
  // Snap position to grid
  const snapToGridPosition = useCallback((x: number, y: number): { x: number; y: number } => {
    if (!snapSettings.snapToGrid) return { x, y }
    const gridSize = snapSettings.gridSize
    return {
      x: Math.round(x / gridSize) * gridSize,
      y: Math.round(y / gridSize) * gridSize
    }
  }, [snapSettings.snapToGrid, snapSettings.gridSize])
  
  // Check alignment with other states and return snapped position + alignment guides
  const checkAlignment = useCallback((
    currentStateId: string,
    x: number,
    y: number
  ): { 
    snappedX: number
    snappedY: number
    verticalGuide: number | null
    horizontalGuide: number | null 
  } => {
    if (!snapSettings.snapToAlignment) {
      return { snappedX: x, snappedY: y, verticalGuide: null, horizontalGuide: null }
    }
    
    const threshold = snapSettings.alignmentThreshold
    let snappedX = x
    let snappedY = y
    let verticalGuide: number | null = null
    let horizontalGuide: number | null = null
    
    // Check alignment with each other state's center
    for (const state of states) {
      if (state.id === currentStateId) continue
      
      // Check vertical alignment (same X coordinate - centers aligned)
      if (Math.abs(state.position_x - x) <= threshold) {
        snappedX = state.position_x
        verticalGuide = state.position_x
      }
      
      // Check horizontal alignment (same Y coordinate - centers aligned)
      if (Math.abs(state.position_y - y) <= threshold) {
        snappedY = state.position_y
        horizontalGuide = state.position_y
      }
    }
    
    return { snappedX, snappedY, verticalGuide, horizontalGuide }
  }, [snapSettings.snapToAlignment, snapSettings.alignmentThreshold, states])
  
  // Apply all snapping logic and return final position
  const applySnapping = useCallback((
    currentStateId: string,
    rawX: number,
    rawY: number
  ): { x: number; y: number; verticalGuide: number | null; horizontalGuide: number | null } => {
    // First apply grid snapping
    let { x, y } = snapToGridPosition(rawX, rawY)
    
    // Then check alignment (alignment takes priority over grid)
    const alignment = checkAlignment(currentStateId, x, y)
    
    return {
      x: alignment.snappedX,
      y: alignment.snappedY,
      verticalGuide: alignment.verticalGuide,
      horizontalGuide: alignment.horizontalGuide
    }
  }, [snapToGridPosition, checkAlignment])
  
  // Start dragging a state
  const startDraggingState = useCallback((stateId: string, e: React.MouseEvent) => {
    if (!isAdmin || canvasMode === 'connect') return
    
    const state = states.find(s => s.id === stateId)
    if (!state) return
    
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    // Calculate mouse position in canvas coordinates
    const mouseX = (e.clientX - rect.left - pan.x) / zoom
    const mouseY = (e.clientY - rect.top - pan.y) / zoom
    
    // Calculate offset from state center to mouse position
    setDragOffset({
      x: state.position_x - mouseX,
      y: state.position_y - mouseY
    })
    
    hasDraggedRef.current = false // Reset drag tracking
    dragStartPosRef.current = { x: e.clientX, y: e.clientY } // Store initial click position for threshold
    setDraggingStateId(stateId)
    setSelectedStateId(stateId)
    setSelectedTransitionId(null)
  }, [isAdmin, canvasMode, states, pan, zoom])
  
  // Canvas mouse handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (canvasMode === 'pan') {
      setIsDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }
  
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    // Calculate mouse position in canvas coordinates
    const mouseX = (e.clientX - rect.left - pan.x) / zoom
    const mouseY = (e.clientY - rect.top - pan.y) / zoom
    
    setMousePos({ x: mouseX, y: mouseY })
    
    // Handle pan dragging
    if (isDragging && canvasMode === 'pan') {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
    
    // Handle state dragging
    if (draggingStateId && dragStartPosRef.current) {
      // Check if we've exceeded the drag threshold
      const dx = e.clientX - dragStartPosRef.current.x
      const dy = e.clientY - dragStartPosRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      if (distance >= DRAG_THRESHOLD) {
        // First time exceeding threshold - hide toolbar
        if (!hasDraggedRef.current) {
          setFloatingToolbar(null)
        }
        hasDraggedRef.current = true // Mark that actual dragging occurred
        
        const rawX = mouseX + dragOffset.x
        const rawY = mouseY + dragOffset.y
        
        // Apply snapping (grid and/or alignment)
        const snapped = applySnapping(draggingStateId, rawX, rawY)
        
        // Update alignment guides for visual feedback
        setAlignmentGuides({
          vertical: snapped.verticalGuide,
          horizontal: snapped.horizontalGuide
        })
        
        // Update state position in local state (for smooth dragging)
        setStates(prevStates => prevStates.map(s => 
          s.id === draggingStateId 
            ? { ...s, position_x: Math.round(snapped.x), position_y: Math.round(snapped.y) }
            : s
        ))
      }
    }
    
    // Handle transition endpoint dragging - find state if mouse is over/near box
    if (draggingTransitionEndpoint) {
      const transition = transitions.find(t => t.id === draggingTransitionEndpoint.transitionId)
      if (transition) {
        // Find the closest state (excluding the state at the other end of the transition)
        const otherEndStateId = draggingTransitionEndpoint.endpoint === 'start' 
          ? transition.to_state_id 
          : transition.from_state_id
        
        let hoveredState: WorkflowState | null = null
        const SNAP_PADDING = 15 // Only snap when within 15px of the box edge
        
        for (const state of states) {
          // Don't snap to the state at the other end (would make a self-loop)
          if (state.id === otherEndStateId) continue
          
          // Check if mouse is inside or very close to the box boundary
          const dims = stateDimensions[state.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
          const hw = dims.width / 2 + SNAP_PADDING
          const hh = dims.height / 2 + SNAP_PADDING
          
          const inX = mouseX >= state.position_x - hw && mouseX <= state.position_x + hw
          const inY = mouseY >= state.position_y - hh && mouseY <= state.position_y + hh
          
          if (inX && inY) {
            hoveredState = state
            break // Take the first match
          }
        }
        
        setHoveredStateId(hoveredState?.id || null)
      }
    }
    
    // Handle creating transition - find state if mouse is over/near box for snapping
    if (isCreatingTransition && transitionStartId) {
      let hoveredState: WorkflowState | null = null
      const SNAP_PADDING = 15 // Only snap when within 15px of the box edge
      
      for (const state of states) {
        // Don't snap to the starting state (would make a self-loop)
        if (state.id === transitionStartId) continue
        
        // Check if mouse is inside or very close to the box boundary
        const dims = stateDimensions[state.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
        const hw = dims.width / 2 + SNAP_PADDING
        const hh = dims.height / 2 + SNAP_PADDING
        
        const inX = mouseX >= state.position_x - hw && mouseX <= state.position_x + hw
        const inY = mouseY >= state.position_y - hh && mouseY <= state.position_y + hh
        
        if (inX && inY) {
          hoveredState = state
          break // Take the first match
        }
      }
      
      setHoveredStateId(hoveredState?.id || null)
    }
    
    // Handle curve control dragging (no threshold - moves immediately)
    if (draggingCurveControl && draggingWaypointIndex !== null) {
      waypointHasDraggedRef.current = true
      // Apply axis constraint for elbow paths
      if (draggingWaypointAxis === 'x') {
        // Only X can change (vertical segment)
        setTempCurvePos(prev => prev ? { x: mouseX, y: prev.y } : { x: mouseX, y: mouseY })
      } else if (draggingWaypointAxis === 'y') {
        // Only Y can change (horizontal segment)
        setTempCurvePos(prev => prev ? { x: prev.x, y: mouseY } : { x: mouseX, y: mouseY })
      } else {
        // No constraint (spline paths)
        setTempCurvePos({ x: mouseX, y: mouseY })
      }
    }
    
    // Handle label dragging
    if (draggingLabel) {
      setTempLabelPos({ x: mouseX, y: mouseY })
    }
    
    // Handle state resizing
    if (resizingState) {
      const state = states.find(s => s.id === resizingState.stateId)
      if (state) {
        const dx = mouseX - resizingState.startMouseX
        const dy = mouseY - resizingState.startMouseY
        const handle = resizingState.handle
        
        let newWidth = resizingState.startWidth
        let newHeight = resizingState.startHeight
        let newX = state.position_x
        let newY = state.position_y
        
        const MIN_WIDTH = 80
        const MIN_HEIGHT = 40
        
        // Handle horizontal resizing
        if (handle.includes('e')) {
          newWidth = Math.max(MIN_WIDTH, resizingState.startWidth + dx * 2)
        }
        if (handle.includes('w')) {
          newWidth = Math.max(MIN_WIDTH, resizingState.startWidth - dx * 2)
        }
        
        // Handle vertical resizing
        if (handle.includes('s')) {
          newHeight = Math.max(MIN_HEIGHT, resizingState.startHeight + dy * 2)
        }
        if (handle.includes('n')) {
          newHeight = Math.max(MIN_HEIGHT, resizingState.startHeight - dy * 2)
        }
        
        setStateDimensions(prev => ({
          ...prev,
          [resizingState.stateId]: { width: newWidth, height: newHeight }
        }))
      }
    }
  }
  
  const handleCanvasMouseUp = async () => {
    // Guard to prevent double processing (canvas onMouseUp + global listener)
    if (mouseUpProcessingRef.current) return
    mouseUpProcessingRef.current = true
    // Reset the guard after a short delay (use microtask to ensure all events in this cycle are blocked)
    queueMicrotask(() => { mouseUpProcessingRef.current = false })
    
    // Clear alignment guides when drag ends
    setAlignmentGuides({ vertical: null, horizontal: null })
    
    // Save dragged state position to database
    if (draggingStateId) {
      const state = states.find(s => s.id === draggingStateId)
      if (state && hasDraggedRef.current) {
        // Only save position if actual dragging occurred (threshold exceeded)
        await updateStatePosition(draggingStateId, state.position_x, state.position_y)
        // Re-show toolbar after drag ends
        setFloatingToolbar({
          canvasX: state.position_x,
          canvasY: state.position_y - 34, // Top of the state box
          type: 'state',
          targetId: state.id
        })
      }
      setDraggingStateId(null)
      dragStartPosRef.current = null
    }
    
    // Handle drag-to-create transition drop (only if dropped in empty space - state boxes handle their own mouseup)
    if (isDraggingToCreateTransition && isCreatingTransition && transitionStartId) {
      // If not hovering a valid state, just reset (dropped in empty space)
      // The state box's onMouseUp handles completion when dropped on a valid target
      if (!hoveredStateId || hoveredStateId === transitionStartId) {
        // Dropped in empty space or on source state - just reset drag state, keep transition mode active
        setIsDraggingToCreateTransition(false)
        setHoveredStateId(null)
      }
    }
    
    // Handle transition endpoint drop
    if (draggingTransitionEndpoint) {
      if (hoveredStateId) {
        // Dropped on a valid state - reconnect
        const transition = transitions.find(t => t.id === draggingTransitionEndpoint.transitionId)
        const hoverState = states.find(s => s.id === hoveredStateId)
        
        if (transition && hoverState && hoveredStateId !== draggingTransitionEndpoint.originalStateId) {
          // Calculate edge position where the user dropped
          const edgePos = getNearestPointOnBoxEdge(
            hoverState.position_x, hoverState.position_y,
            mousePos.x, mousePos.y
          )
          
          // Update the transition in the database
          try {
            const updates = draggingTransitionEndpoint.endpoint === 'start'
              ? { from_state_id: hoveredStateId }
              : { to_state_id: hoveredStateId }
            
            await supabase
              .from('workflow_transitions')
              .update(updates)
              .eq('id', transition.id)
            
            // Update local state (use functional updater to avoid stale closure)
            setTransitions(prev => prev.map(t => 
              t.id === transition.id ? { ...t, ...updates } : t
            ))
            
            // Save the edge position where the user dropped
            const posKey = `${transition.id}-${draggingTransitionEndpoint.endpoint}`
            setEdgePositions(prev => ({
              ...prev,
              [posKey]: { edge: edgePos.edge, fraction: edgePos.fraction }
            }))
            
            addToast('success', 'Transition reconnected')
          } catch (err) {
            console.error('Failed to update transition:', err)
            addToast('error', 'Failed to reconnect transition')
          }
        } else if (transition && hoverState) {
          // Dropped on the same state - just save the new edge position
          const edgePos = getNearestPointOnBoxEdge(
            hoverState.position_x, hoverState.position_y,
            mousePos.x, mousePos.y
          )
          const posKey = `${transition.id}-${draggingTransitionEndpoint.endpoint}`
          setEdgePositions(prev => ({
            ...prev,
            [posKey]: { edge: edgePos.edge, fraction: edgePos.fraction }
          }))
        }
      } else {
        // Dropped in empty space - show error, don't save
        addToast('error', 'Drop on a state to reconnect, or press Escape to cancel')
      }
    }
    
    // Re-show toolbar after transition endpoint drag ends
    if (draggingTransitionEndpoint) {
      const transition = transitions.find(t => t.id === draggingTransitionEndpoint.transitionId)
      if (transition) {
        const fromState = states.find(s => s.id === transition.from_state_id)
        const toState = states.find(s => s.id === transition.to_state_id)
        if (fromState && toState) {
          // Calculate line bounds from states and waypoints
          const transitionWaypoints = waypoints[transition.id] || []
          const allPoints = [
            { x: fromState.position_x, y: fromState.position_y },
            { x: toState.position_x, y: toState.position_y },
            ...transitionWaypoints
          ]
          const lineMinY = Math.min(...allPoints.map(p => p.y))
          const lineCenterX = (Math.min(...allPoints.map(p => p.x)) + Math.max(...allPoints.map(p => p.x))) / 2
          setFloatingToolbar({
            canvasX: lineCenterX,
            canvasY: lineMinY,
            type: 'transition',
            targetId: transition.id
          })
        }
      }
    }
    
    setDraggingTransitionEndpoint(null)
    setHoveredStateId(null)
    
    // Handle waypoint drop - save the waypoint position (only if actual dragging occurred)
    if (draggingCurveControl && draggingWaypointIndex !== null) {
      const transitionId = draggingCurveControl
      const transition = transitions.find(t => t.id === transitionId)
      const pathType = transition?.line_path_type || 'spline'
      
      // Only save position if actual dragging occurred (threshold was exceeded)
      if (waypointHasDraggedRef.current && tempCurvePos) {
        // For elbow paths, update the waypoint based on segment position
        if (pathType === 'elbow') {
          // Get the segment info from the transition
          const elbowHandles = (transition as any)?._elbowHandles || []
          // Find the handle by waypointIndex, not array index
          const handle = elbowHandles.find((h: any) => h.waypointIndex === draggingWaypointIndex)
          
          if (handle) {
            // For elbow paths, each adjustable segment is controlled by a waypoint
            // The waypoint stores the position for that segment
            setWaypoints(prev => {
              const transitionWaypoints = [...(prev[transitionId] || [])]
              
              // Ensure we have enough waypoints
              while (transitionWaypoints.length <= draggingWaypointIndex) {
                // Default position - will be overwritten
                transitionWaypoints.push({ x: tempCurvePos.x, y: tempCurvePos.y })
              }
              
              // Update the waypoint - only update the axis that matters for this segment
              if (handle.isVertical) {
                // Vertical segment - X position matters (drag left/right)
                transitionWaypoints[draggingWaypointIndex] = { 
                  x: tempCurvePos.x, 
                  y: transitionWaypoints[draggingWaypointIndex]?.y || tempCurvePos.y 
                }
              } else {
                // Horizontal segment - Y position matters (drag up/down)
                transitionWaypoints[draggingWaypointIndex] = { 
                  x: transitionWaypoints[draggingWaypointIndex]?.x || tempCurvePos.x, 
                  y: tempCurvePos.y 
                }
              }
              
              return {
                ...prev,
                [transitionId]: transitionWaypoints
              }
            })
          }
        } else {
          // For spline paths, update the specific waypoint at the dragged index
          setWaypoints(prev => {
            const transitionWaypoints = [...(prev[transitionId] || [])]
            transitionWaypoints[draggingWaypointIndex] = { x: tempCurvePos.x, y: tempCurvePos.y }
            return {
              ...prev,
              [transitionId]: transitionWaypoints
            }
          })
        }
        
        // Re-show toolbar after waypoint drag ends (reuse transition from above)
        if (transition) {
          const fromState = states.find(s => s.id === transition.from_state_id)
          const toState = states.find(s => s.id === transition.to_state_id)
          if (fromState && toState) {
            // Calculate line bounds - use tempCurvePos for the waypoint we just dropped
            const updatedWaypoints = [...(waypoints[transitionId] || [])]
            if (draggingWaypointIndex !== null && draggingWaypointIndex < updatedWaypoints.length) {
              updatedWaypoints[draggingWaypointIndex] = { x: tempCurvePos.x, y: tempCurvePos.y }
            }
            const allPoints = [
              { x: fromState.position_x, y: fromState.position_y },
              { x: toState.position_x, y: toState.position_y },
              ...updatedWaypoints
            ]
            const lineMinY = Math.min(...allPoints.map(p => p.y))
            const lineCenterX = (Math.min(...allPoints.map(p => p.x)) + Math.max(...allPoints.map(p => p.x))) / 2
            setFloatingToolbar({
              canvasX: lineCenterX,
              canvasY: lineMinY,
              type: 'transition',
              targetId: transitionId
            })
          }
        }
      }
      
      // Reset drag tracking
      setDraggingCurveControl(null)
      setDraggingWaypointIndex(null)
      setDraggingWaypointAxis(null)
      setTempCurvePos(null)
      waypointHasDraggedRef.current = false
      // Mark that we just finished a waypoint drag to prevent deselection in handleCanvasClick
      justFinishedWaypointDragRef.current = true
    }
    
    // Handle label drop - save the label position
    if (draggingLabel && tempLabelPos) {
      const transition = transitions.find(t => t.id === draggingLabel)
      if (transition) {
        const isPinned = !!pinnedLabelPositions[draggingLabel]
        
        if (isPinned) {
          // Pinned label: save absolute position
          setPinnedLabelPositions(prev => ({
            ...prev,
            [draggingLabel]: { x: tempLabelPos.x, y: tempLabelPos.y }
          }))
        } else {
          // Not pinned: save offset from line midpoint
          const fromState = states.find(s => s.id === transition.from_state_id)
          const toState = states.find(s => s.id === transition.to_state_id)
          if (fromState && toState) {
            // Get custom dimensions for each state (must match rendering logic)
            const fromDims = stateDimensions[fromState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
            const toDims = stateDimensions[toState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
            
            // Check for stored edge positions (must match rendering logic)
            const storedStartPos = edgePositions[`${transition.id}-start`]
            const storedEndPos = edgePositions[`${transition.id}-end`]
            
            // Calculate connection points the same way as rendering
            const defaultStartPoint = getClosestPointOnBox(fromState.position_x, fromState.position_y, toState.position_x, toState.position_y, fromDims.width, fromDims.height)
            const defaultEndPoint = getClosestPointOnBox(toState.position_x, toState.position_y, fromState.position_x, fromState.position_y, toDims.width, toDims.height)
            
            const startPoint = storedStartPos 
              ? getPointFromEdgePosition(fromState.position_x, fromState.position_y, storedStartPos, fromDims.width, fromDims.height)
              : defaultStartPoint
            const endPoint = storedEndPos
              ? getPointFromEdgePosition(toState.position_x, toState.position_y, storedEndPos, toDims.width, toDims.height)
              : defaultEndPoint
            
            const lineMidX = (startPoint.x + endPoint.x) / 2
            const lineMidY = (startPoint.y + endPoint.y) / 2
            
            // Save offset from the line midpoint
            setLabelOffsets(prev => ({
              ...prev,
              [draggingLabel]: {
                x: tempLabelPos.x - lineMidX,
                y: tempLabelPos.y - lineMidY
              }
            }))
          }
        }
      }
      setDraggingLabel(null)
      setTempLabelPos(null)
      // Mark that we just finished a label drag to prevent deselection in handleCanvasClick
      justFinishedLabelDragRef.current = true
    }
    
    // Handle resize completion
    if (resizingState) {
      // Re-show toolbar after resize ends
      const state = states.find(s => s.id === resizingState.stateId)
      if (state) {
        const dims = stateDimensions[state.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
        setFloatingToolbar({
          canvasX: state.position_x,
          canvasY: state.position_y - dims.height / 2, // Top of the state box
          type: 'state',
          targetId: state.id
        })
      }
      setResizingState(null)
    }
    
    setIsDragging(false)
  }
  
  // Keep the ref updated to the latest handler for global mouseup
  useEffect(() => {
    handleCanvasMouseUpRef.current = handleCanvasMouseUp
  })
  
  const handleCanvasClick = (e: React.MouseEvent) => {
    // Don't process click if we were dragging a state
    if (draggingStateId) return
    
    // Don't deselect if we just finished dragging a waypoint
    if (justFinishedWaypointDragRef.current) {
      justFinishedWaypointDragRef.current = false
      return
    }
    
    // Don't deselect if we just finished dragging a label
    if (justFinishedLabelDragRef.current) {
      justFinishedLabelDragRef.current = false
      return
    }
    
    // Close context menu if open
    if (contextMenu) {
      setContextMenu(null)
    }
    
    // Close waypoint context menu if open
    if (waypointContextMenu) {
      setWaypointContextMenu(null)
    }
    
    // Close floating toolbar if open
    if (floatingToolbar) {
      setFloatingToolbar(null)
    }
    
    // Close snap settings dropdown if open
    if (showSnapSettings) {
      setShowSnapSettings(false)
    }
    
    // If clicking on canvas background (not a state/transition), cancel creating transition
    if (isCreatingTransition) {
      cancelConnectMode()
    }
    // Deselect when clicking background
    setSelectedStateId(null)
    setSelectedTransitionId(null)
    setHoverNodeId(null)
  }
  
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    // Mouse position relative to canvas element
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    // Calculate new zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.25, Math.min(2, zoom * zoomFactor))
    
    // Calculate the point in canvas coordinates that should stay under the mouse
    // Before zoom: (mouseX - pan.x) / zoom = canvasX
    // After zoom: (mouseX - newPan.x) / newZoom = canvasX (same point)
    // Therefore: newPan.x = mouseX - canvasX * newZoom
    
    const canvasX = (mouseX - pan.x) / zoom
    const canvasY = (mouseY - pan.y) / zoom
    
    const newPanX = mouseX - canvasX * newZoom
    const newPanY = mouseY - canvasY * newZoom
    
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }
  
  // Render state node
  const renderStateNode = (state: WorkflowState) => {
    const isSelected = selectedStateId === state.id
    const isTransitionStart = transitionStartId === state.id
    const isDraggingThis = draggingStateId === state.id
    const isResizingThis = resizingState?.stateId === state.id
    // Show snap target when dragging transition endpoint OR when creating a new transition
    const isSnapTarget = hoveredStateId === state.id && (draggingTransitionEndpoint !== null || (isCreatingTransition && transitionStartId !== state.id))
    const isHovered = hoverNodeId === state.id
    // Show connection points when selected, in connect mode, or when dragging to create a transition (on potential targets)
    const isPotentialTransitionTarget = isCreatingTransition && transitionStartId !== state.id
    const showConnectionPoints = isAdmin && (isSelected || canvasMode === 'connect' || isPotentialTransitionTarget)
    const showResizeHandles = isAdmin && isSelected && canvasMode === 'select'
    const textColor = getContrastColor(state.color)
    
    // Get custom dimensions or use defaults
    const dims = stateDimensions[state.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
    const hw = dims.width / 2
    const hh = dims.height / 2
    
    // Handle size constants
    const RESIZE_HANDLE_SIZE = 4
    const CONNECTION_HANDLE_SIZE = 4
    const CONNECTION_OFFSET = 12 // How far connection points float outside the box
    
    // Start resizing handler
    const startResize = (handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw', e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const mouseX = (e.clientX - rect.left - pan.x) / zoom
      const mouseY = (e.clientY - rect.top - pan.y) / zoom
      setFloatingToolbar(null)
      setResizingState({
        stateId: state.id,
        handle,
        startMouseX: mouseX,
        startMouseY: mouseY,
        startWidth: dims.width,
        startHeight: dims.height
      })
    }
    
    return (
      <g
        key={state.id}
        transform={`translate(${state.position_x}, ${state.position_y})`}
        style={{ 
          cursor: isDraggingThis ? 'grabbing' : isResizingThis ? 'grabbing' : (isAdmin && canvasMode === 'select' ? 'grab' : 'pointer'),
          pointerEvents: 'auto'
        }}
        onMouseEnter={() => {
          if (!draggingStateId && !draggingTransitionEndpoint && !resizingState) {
            setHoverNodeId(state.id)
          }
        }}
        onMouseLeave={() => {
          if (hoverNodeId === state.id) {
            setHoverNodeId(null)
          }
        }}
        onMouseDown={(e) => {
          e.stopPropagation()
          if (canvasMode === 'select' && isAdmin && !resizingState) {
            startDraggingState(state.id, e)
          }
        }}
        onMouseUp={(e) => {
          // Handle drag-to-create transition completion directly on the target state
          if (isDraggingToCreateTransition && isCreatingTransition && transitionStartId && transitionStartId !== state.id) {
            e.stopPropagation()
            completeTransition(state.id)
            // These are set in completeTransition too, but set again for safety
            justCompletedTransitionRef.current = true
            transitionCompletedAtRef.current = Date.now()
            setIsDraggingToCreateTransition(false)
            setHoveredStateId(null)
          }
        }}
        onClick={(e) => {
          e.stopPropagation()
          // Don't process click if we just finished dragging (actual movement occurred)
          if (hasDraggedRef.current) return
          
          // Don't process click if we just completed a transition (within 500ms)
          const timeSinceTransition = Date.now() - transitionCompletedAtRef.current
          if (justCompletedTransitionRef.current || timeSinceTransition < 500) {
            // Clear after a delay to allow double-click to also see the flag
            setTimeout(() => { justCompletedTransitionRef.current = false }, 500)
            return
          }
          
          // Don't process click if we're still in creating transition mode via drag (handles click after drag)
          if (isDraggingToCreateTransition) return
          
          if (isCreatingTransition) {
            completeTransition(state.id)
          } else {
            setSelectedStateId(state.id)
            setSelectedTransitionId(null)
            // Show floating toolbar above the state box (store canvas coordinates)
            setFloatingToolbar({
              canvasX: state.position_x,
              canvasY: state.position_y - hh, // Top of the state box
              type: 'state',
              targetId: state.id
            })
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          // Don't open edit dialog if we just completed a transition (within 500ms)
          const timeSinceTransition = Date.now() - transitionCompletedAtRef.current
          if (justCompletedTransitionRef.current || timeSinceTransition < 500) {
            setTimeout(() => { justCompletedTransitionRef.current = false }, 500)
            return
          }
          // Don't open edit dialog while creating transitions
          if (isCreatingTransition || isDraggingToCreateTransition) return
          
          if (isAdmin) {
            setEditingState(state)
            setShowEditState(true)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          // Right-click also shows floating toolbar
          setSelectedStateId(state.id)
          setSelectedTransitionId(null)
          setFloatingToolbar({
            canvasX: state.position_x,
            canvasY: state.position_y - hh, // Top of the state box
            type: 'state',
            targetId: state.id
          })
        }}
      >
        {/* Drag glow / snap target glow / transition start glow (no selection glow - handles indicate selection) */}
        {(isTransitionStart || isDraggingThis || isSnapTarget) && (
          state.shape === 'diamond' ? (
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
          )
        )}
        
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
        {isDraggingThis && (
          state.shape === 'diamond' ? (
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
              transform="translate(4, 4)"
            />
          )
        )}
        
        {/* Hover glow effect - brightness increase */}
        {isHovered && !isSelected && !isDraggingThis && (
          state.shape === 'diamond' ? (
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
          )
        )}
        
        {/* Node background */}
        {(() => {
          // Parse fill color and apply opacity
          const baseFillOpacity = state.fill_opacity ?? 1
          // Slightly increase opacity on hover for subtle effect
          const fillOpacity = isHovered && !isSelected ? Math.min(1, baseFillOpacity + 0.1) : baseFillOpacity
          const borderOpacity = state.border_opacity ?? 1
          const borderThickness = state.border_thickness ?? 2
          const borderColor = state.border_color || state.color
          
          // Convert hex to rgba for fill
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16)
            const g = parseInt(hex.slice(3, 5), 16)
            const b = parseInt(hex.slice(5, 7), 16)
            return `rgba(${r}, ${g}, ${b}, ${alpha})`
          }
          
          // Determine the stroke color based on selection state
          let strokeColor: string
          let strokeWidth: number
          if (isDraggingThis) {
            strokeColor = '#60a5fa'
            strokeWidth = 2
          } else if (isTransitionStart) {
            strokeColor = '#22c55e'
            strokeWidth = 2
          } else {
            // Normal border (same for selected and unselected - toolbar/handles indicate selection)
            strokeColor = hexToRgba(borderColor, borderOpacity)
            strokeWidth = borderThickness
          }
          
          const fillColor = hexToRgba(state.color, fillOpacity)
          const shape = state.shape || 'rectangle'
          
          // Render different shapes based on state.shape
          switch (shape) {
            case 'diamond':
              // Diamond shape - rotated square, good for decision/approval gates
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
              // Hexagon shape - 6-sided polygon
              const hexW = hw * 0.866 // cos(30°) for proper proportions
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
              // Ellipse/oval shape
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
              // Default rectangle shape
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
        })()}
        
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
          {state.state_type === 'gate' 
            ? `⛨ ${(state.gate_config as any)?.gate_type === 'checklist' ? 'Checklist' : 'Approval'}`
            : state.is_editable ? '✎ Editable' : '🔒 Locked'
          }
        </text>
        
        {/* Resize handles - appear when selected */}
        {showResizeHandles && (
          <g className="resize-handles">
            {/* Corner handles */}
            {/* Top-left */}
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
            {/* Top-right */}
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
            {/* Bottom-left */}
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
            {/* Bottom-right */}
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
            {/* Top */}
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
            {/* Bottom */}
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
            {/* Left */}
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
            {/* Right */}
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
        
        {/* Connection points - floating outside the box as small blue circles */}
        {showConnectionPoints && (
          <g className="connection-points">
            {/* Right point - floating outside */}
            <circle
              cx={hw + CONNECTION_OFFSET}
              cy="0"
              r={CONNECTION_HANDLE_SIZE}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth="1.5"
              className="cursor-crosshair"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                if (!isCreatingTransition) {
                  startTransition(state.id)
                  setIsDraggingToCreateTransition(true)
                }
              }}
              onMouseUp={(e) => {
                // Handle drag-to-create transition completion on connection point
                if (isDraggingToCreateTransition && isCreatingTransition && transitionStartId && transitionStartId !== state.id) {
                  e.stopPropagation()
                  completeTransition(state.id)
                  justCompletedTransitionRef.current = true
                  transitionCompletedAtRef.current = Date.now()
                  setIsDraggingToCreateTransition(false)
                  setHoveredStateId(null)
                }
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isCreatingTransition && transitionStartId !== state.id) {
                  completeTransition(state.id)
                }
              }}
            />
            {/* Left point - floating outside */}
            <circle
              cx={-hw - CONNECTION_OFFSET}
              cy="0"
              r={CONNECTION_HANDLE_SIZE}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth="1.5"
              className="cursor-crosshair"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                if (!isCreatingTransition) {
                  startTransition(state.id)
                  setIsDraggingToCreateTransition(true)
                }
              }}
              onMouseUp={(e) => {
                // Handle drag-to-create transition completion on connection point
                if (isDraggingToCreateTransition && isCreatingTransition && transitionStartId && transitionStartId !== state.id) {
                  e.stopPropagation()
                  completeTransition(state.id)
                  justCompletedTransitionRef.current = true
                  transitionCompletedAtRef.current = Date.now()
                  setIsDraggingToCreateTransition(false)
                  setHoveredStateId(null)
                }
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isCreatingTransition && transitionStartId !== state.id) {
                  completeTransition(state.id)
                }
              }}
            />
            {/* Top point - floating outside */}
            <circle
              cx="0"
              cy={-hh - CONNECTION_OFFSET}
              r={CONNECTION_HANDLE_SIZE}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth="1.5"
              className="cursor-crosshair"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                if (!isCreatingTransition) {
                  startTransition(state.id)
                  setIsDraggingToCreateTransition(true)
                }
              }}
              onMouseUp={(e) => {
                // Handle drag-to-create transition completion on connection point
                if (isDraggingToCreateTransition && isCreatingTransition && transitionStartId && transitionStartId !== state.id) {
                  e.stopPropagation()
                  completeTransition(state.id)
                  justCompletedTransitionRef.current = true
                  transitionCompletedAtRef.current = Date.now()
                  setIsDraggingToCreateTransition(false)
                  setHoveredStateId(null)
                }
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isCreatingTransition && transitionStartId !== state.id) {
                  completeTransition(state.id)
                }
              }}
            />
            {/* Bottom point - floating outside */}
            <circle
              cx="0"
              cy={hh + CONNECTION_OFFSET}
              r={CONNECTION_HANDLE_SIZE}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth="1.5"
              className="cursor-crosshair"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))', pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                if (!isCreatingTransition) {
                  startTransition(state.id)
                  setIsDraggingToCreateTransition(true)
                }
              }}
              onMouseUp={(e) => {
                // Handle drag-to-create transition completion on connection point
                if (isDraggingToCreateTransition && isCreatingTransition && transitionStartId && transitionStartId !== state.id) {
                  e.stopPropagation()
                  completeTransition(state.id)
                  justCompletedTransitionRef.current = true
                  transitionCompletedAtRef.current = Date.now()
                  setIsDraggingToCreateTransition(false)
                  setHoveredStateId(null)
                }
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isCreatingTransition && transitionStartId !== state.id) {
                  completeTransition(state.id)
                }
              }}
            />
          </g>
        )}
      </g>
    )
  }
  
  // Find the absolute closest point on any edge of the box to a given point
  // Also returns the fraction (0-1) along that edge for storage
  const getNearestPointOnBoxEdge = (
    boxCenterX: number, boxCenterY: number,
    pointX: number, pointY: number,
    boxWidth: number = 120,
    boxHeight: number = 60
  ): { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; fraction: number } => {
    const hw = boxWidth / 2
    const hh = boxHeight / 2
    
    const left = boxCenterX - hw
    const right = boxCenterX + hw
    const top = boxCenterY - hh
    const bottom = boxCenterY + hh
    
    // Calculate closest point on each edge with fraction
    const candidates: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; dist: number; fraction: number }[] = []
    
    // Right edge - clamp Y to edge bounds
    const rightY = Math.max(top, Math.min(bottom, pointY))
    const rightFraction = (rightY - top) / (bottom - top)
    candidates.push({ x: right, y: rightY, edge: 'right', dist: Math.hypot(right - pointX, rightY - pointY), fraction: rightFraction })
    
    // Left edge
    const leftY = Math.max(top, Math.min(bottom, pointY))
    const leftFraction = (leftY - top) / (bottom - top)
    candidates.push({ x: left, y: leftY, edge: 'left', dist: Math.hypot(left - pointX, leftY - pointY), fraction: leftFraction })
    
    // Bottom edge
    const bottomX = Math.max(left, Math.min(right, pointX))
    const bottomFraction = (bottomX - left) / (right - left)
    candidates.push({ x: bottomX, y: bottom, edge: 'bottom', dist: Math.hypot(bottomX - pointX, bottom - pointY), fraction: bottomFraction })
    
    // Top edge
    const topX = Math.max(left, Math.min(right, pointX))
    const topFraction = (topX - left) / (right - left)
    candidates.push({ x: topX, y: top, edge: 'top', dist: Math.hypot(topX - pointX, top - pointY), fraction: topFraction })
    
    // Return the closest
    candidates.sort((a, b) => a.dist - b.dist)
    return { x: candidates[0].x, y: candidates[0].y, edge: candidates[0].edge, fraction: candidates[0].fraction }
  }
  
  // Convert stored edge position back to coordinates
  const getPointFromEdgePosition = (
    boxCenterX: number, boxCenterY: number,
    edgePos: { edge: 'left' | 'right' | 'top' | 'bottom'; fraction: number },
    boxWidth: number = 120,
    boxHeight: number = 60
  ): { x: number; y: number } => {
    const hw = boxWidth / 2
    const hh = boxHeight / 2
    
    const left = boxCenterX - hw
    const right = boxCenterX + hw
    const top = boxCenterY - hh
    const bottom = boxCenterY + hh
    
    switch (edgePos.edge) {
      case 'right':
        return { x: right, y: top + edgePos.fraction * (bottom - top) }
      case 'left':
        return { x: left, y: top + edgePos.fraction * (bottom - top) }
      case 'bottom':
        return { x: left + edgePos.fraction * (right - left), y: bottom }
      case 'top':
        return { x: left + edgePos.fraction * (right - left), y: top }
    }
  }
  
  // Calculate the actual midpoint of a quadratic bezier curve (at t=0.5)
  const getBezierMidpoint = (
    startX: number, startY: number,
    controlX: number, controlY: number,
    endX: number, endY: number
  ): { x: number; y: number } => {
    // B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2
    return {
      x: 0.25 * startX + 0.5 * controlX + 0.25 * endX,
      y: 0.25 * startY + 0.5 * controlY + 0.25 * endY
    }
  }
  
  // Calculate the control point needed to make the curve pass through a given midpoint
  const getControlPointFromMidpoint = (
    startX: number, startY: number,
    midX: number, midY: number,
    endX: number, endY: number
  ): { x: number; y: number } => {
    // If M = 0.25*P0 + 0.5*P1 + 0.25*P2, then P1 = 2*M - 0.5*(P0 + P2)
    return {
      x: 2 * midX - 0.5 * (startX + endX),
      y: 2 * midY - 0.5 * (startY + endY)
    }
  }
  
  // Get perpendicular direction vector based on box edge
  const getPerpendicularDirection = (edge: 'left' | 'right' | 'top' | 'bottom'): { x: number; y: number } => {
    switch (edge) {
      case 'left': return { x: -1, y: 0 }
      case 'right': return { x: 1, y: 0 }
      case 'top': return { x: 0, y: -1 }
      case 'bottom': return { x: 0, y: 1 }
    }
  }
  
  // Generate a smooth SVG path through multiple waypoints with perpendicular box exits
  // Uses cubic bezier curves with straight perpendicular segments at box edges
  const generateSplinePath = (
    start: { x: number; y: number; edge?: 'left' | 'right' | 'top' | 'bottom' },
    waypointsList: Array<{ x: number; y: number }>,
    end: { x: number; y: number; edge?: 'left' | 'right' | 'top' | 'bottom' }
  ): string => {
    // Straight segment length at start/end for clean perpendicular lines
    const STRAIGHT_LENGTH = 20
    
    // Get perpendicular directions for start and end
    const startDir = start.edge ? getPerpendicularDirection(start.edge) : null
    const endDir = end.edge ? getPerpendicularDirection(end.edge) : null
    
    // Calculate the "stub" points - ends of the perpendicular straight segments
    const startStub = startDir 
      ? { x: start.x + startDir.x * STRAIGHT_LENGTH, y: start.y + startDir.y * STRAIGHT_LENGTH }
      : null
    const endStub = endDir
      ? { x: end.x + endDir.x * STRAIGHT_LENGTH, y: end.y + endDir.y * STRAIGHT_LENGTH }
      : null
    
    // Calculate control point distance for the curved middle section
    const curveStart = startStub || start
    const curveEnd = endStub || end
    const curveDist = Math.hypot(curveEnd.x - curveStart.x, curveEnd.y - curveStart.y)
    const controlDist = Math.max(20, Math.min(50, curveDist * 0.35))
    
    // No waypoints
    if (waypointsList.length === 0) {
      let path = `M ${start.x} ${start.y}`
      
      // Straight segment from start (perpendicular)
      if (startStub) {
        path += ` L ${startStub.x} ${startStub.y}`
      }
      
      // Curved section from stub to stub (or start to end if no stubs)
      const p1 = startStub || start
      const p2 = endStub || end
      
      if (startDir && endDir) {
        // Both have edges - create a smooth S-curve between stubs
        const cp1 = {
          x: p1.x + (startDir?.x || 0) * controlDist,
          y: p1.y + (startDir?.y || 0) * controlDist
        }
        const cp2 = {
          x: p2.x + (endDir?.x || 0) * controlDist,
          y: p2.y + (endDir?.y || 0) * controlDist
        }
        path += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`
      } else {
        // Simple line between stubs
        path += ` L ${p2.x} ${p2.y}`
      }
      
      // Straight segment to end (perpendicular)
      if (endStub) {
        path += ` L ${end.x} ${end.y}`
      }
      
      return path
    }
    
    // With waypoints - build path through all points
    let path = `M ${start.x} ${start.y}`
    
    // Straight segment from start (perpendicular)
    if (startStub) {
      path += ` L ${startStub.x} ${startStub.y}`
    }
    
    // Build the curved section through waypoints
    const curvePoints = [startStub || start, ...waypointsList, endStub || end]
    
    for (let i = 0; i < curvePoints.length - 1; i++) {
      const p1 = curvePoints[i]
      const p2 = curvePoints[i + 1]
      const segmentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const segmentControlDist = Math.max(15, segmentDist * 0.35)
      
      let cp1: { x: number; y: number }
      let cp2: { x: number; y: number }
      
      // First control point
      if (i === 0 && startDir) {
        // Continue in the perpendicular direction from start
        cp1 = {
          x: p1.x + startDir.x * segmentControlDist,
          y: p1.y + startDir.y * segmentControlDist
        }
      } else {
        // Tangent based on surrounding points
        const prev = i > 0 ? curvePoints[i - 1] : p1
        const tangentX = p2.x - prev.x
        const tangentY = p2.y - prev.y
        const tangentLen = Math.hypot(tangentX, tangentY) || 1
        cp1 = {
          x: p1.x + (tangentX / tangentLen) * segmentControlDist,
          y: p1.y + (tangentY / tangentLen) * segmentControlDist
        }
      }
      
      // Second control point
      if (i === curvePoints.length - 2 && endDir) {
        // Approach from the perpendicular direction to end
        cp2 = {
          x: p2.x + endDir.x * segmentControlDist,
          y: p2.y + endDir.y * segmentControlDist
        }
      } else {
        // Tangent based on surrounding points
        const next = i < curvePoints.length - 2 ? curvePoints[i + 2] : p2
        const tangentX = next.x - p1.x
        const tangentY = next.y - p1.y
        const tangentLen = Math.hypot(tangentX, tangentY) || 1
        cp2 = {
          x: p2.x - (tangentX / tangentLen) * segmentControlDist,
          y: p2.y - (tangentY / tangentLen) * segmentControlDist
        }
      }
      
      path += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`
    }
    
    // Straight segment to end (perpendicular)
    if (endStub) {
      path += ` L ${end.x} ${end.y}`
    }
    
    return path
  }
  
  // Get a point on the spline at parameter t (0-1) for placing labels/gates
  // This approximates the position along the path including straight stubs
  const getPointOnSpline = (
    start: { x: number; y: number; edge?: 'left' | 'right' | 'top' | 'bottom' },
    waypointsList: Array<{ x: number; y: number }>,
    end: { x: number; y: number; edge?: 'left' | 'right' | 'top' | 'bottom' },
    t: number = 0.5
  ): { x: number; y: number } => {
    const STRAIGHT_LENGTH = 20
    
    // Get perpendicular directions
    const startDir = start.edge ? getPerpendicularDirection(start.edge) : null
    const endDir = end.edge ? getPerpendicularDirection(end.edge) : null
    
    const startStub = startDir 
      ? { x: start.x + startDir.x * STRAIGHT_LENGTH, y: start.y + startDir.y * STRAIGHT_LENGTH }
      : null
    const endStub = endDir
      ? { x: end.x + endDir.x * STRAIGHT_LENGTH, y: end.y + endDir.y * STRAIGHT_LENGTH }
      : null
    
    // Build all the points the path goes through
    const allPoints: Array<{ x: number; y: number }> = [start]
    if (startStub) allPoints.push(startStub)
    allPoints.push(...waypointsList)
    if (endStub) allPoints.push(endStub)
    allPoints.push(end)
    
    // Calculate total approximate path length
    let totalLength = 0
    const segmentLengths: number[] = []
    for (let i = 0; i < allPoints.length - 1; i++) {
      const len = Math.hypot(allPoints[i + 1].x - allPoints[i].x, allPoints[i + 1].y - allPoints[i].y)
      segmentLengths.push(len)
      totalLength += len
    }
    
    // Find which segment t falls in
    const targetLength = t * totalLength
    let accumulatedLength = 0
    
    for (let i = 0; i < segmentLengths.length; i++) {
      if (accumulatedLength + segmentLengths[i] >= targetLength) {
        // t falls in this segment
        const segmentProgress = (targetLength - accumulatedLength) / segmentLengths[i]
        return {
          x: allPoints[i].x + segmentProgress * (allPoints[i + 1].x - allPoints[i].x),
          y: allPoints[i].y + segmentProgress * (allPoints[i + 1].y - allPoints[i].y)
        }
      }
      accumulatedLength += segmentLengths[i]
    }
    
    // Fallback to end point
    return { x: end.x, y: end.y }
  }
  
  // Find the closest point on the path to insert a new waypoint
  const findInsertionIndex = (
    waypointsList: Array<{ x: number; y: number }>,
    start: { x: number; y: number },
    end: { x: number; y: number },
    clickPoint: { x: number; y: number }
  ): number => {
    const points = [start, ...waypointsList, end]
    
    // Find which segment the click is closest to
    let bestSegment = 0
    let bestDist = Infinity
    
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      
      // Distance from point to line segment
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const lengthSq = dx * dx + dy * dy
      
      let t = 0
      if (lengthSq > 0) {
        t = Math.max(0, Math.min(1, ((clickPoint.x - p1.x) * dx + (clickPoint.y - p1.y) * dy) / lengthSq))
      }
      
      const projX = p1.x + t * dx
      const projY = p1.y + t * dy
      const dist = Math.hypot(clickPoint.x - projX, clickPoint.y - projY)
      
      if (dist < bestDist) {
        bestDist = dist
        bestSegment = i
      }
    }
    
    // Return the index where the new waypoint should be inserted
    // If bestSegment is 0, insert at index 0 (after start, before first waypoint)
    // If bestSegment is 1, insert at index 1 (after first waypoint)
    return bestSegment
  }
  
  // Calculate connection point using ray from center to target (for non-dragging cases)
  const getClosestPointOnBox = (
    boxCenterX: number, boxCenterY: number,  // Center of the box
    targetX: number, targetY: number,         // Point to connect to
    boxWidth: number = 120,
    boxHeight: number = 60
  ): { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' } => {
    const hw = boxWidth / 2
    const hh = boxHeight / 2
    
    // Box edges
    const left = boxCenterX - hw
    const right = boxCenterX + hw
    const top = boxCenterY - hh
    const bottom = boxCenterY + hh
    
    // Calculate intersection point with each edge
    const dx = targetX - boxCenterX
    const dy = targetY - boxCenterY
    
    // If target is at same position, default to right edge
    if (dx === 0 && dy === 0) {
      return { x: right, y: boxCenterY, edge: 'right' }
    }
    
    // Find where the line from center to target intersects each edge
    const candidates: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom'; dist: number }[] = []
    
    // Right edge (x = right)
    if (dx > 0) {
      const t = (right - boxCenterX) / dx
      const y = boxCenterY + t * dy
      if (y >= top && y <= bottom) {
        candidates.push({ x: right, y, edge: 'right', dist: Math.hypot(right - targetX, y - targetY) })
      }
    }
    
    // Left edge (x = left)
    if (dx < 0) {
      const t = (left - boxCenterX) / dx
      const y = boxCenterY + t * dy
      if (y >= top && y <= bottom) {
        candidates.push({ x: left, y, edge: 'left', dist: Math.hypot(left - targetX, y - targetY) })
      }
    }
    
    // Bottom edge (y = bottom)
    if (dy > 0) {
      const t = (bottom - boxCenterY) / dy
      const x = boxCenterX + t * dx
      if (x >= left && x <= right) {
        candidates.push({ x, y: bottom, edge: 'bottom', dist: Math.hypot(x - targetX, bottom - targetY) })
      }
    }
    
    // Top edge (y = top)
    if (dy < 0) {
      const t = (top - boxCenterY) / dy
      const x = boxCenterX + t * dx
      if (x >= left && x <= right) {
        candidates.push({ x, y: top, edge: 'top', dist: Math.hypot(x - targetX, top - targetY) })
      }
    }
    
    // Return the closest intersection point
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist)
      return { x: candidates[0].x, y: candidates[0].y, edge: candidates[0].edge }
    }
    
    // Fallback: determine edge based on angle
    const angle = Math.atan2(dy, dx)
    const absAngle = Math.abs(angle)
    
    if (absAngle <= Math.PI / 4) {
      return { x: right, y: boxCenterY, edge: 'right' }
    } else if (absAngle >= 3 * Math.PI / 4) {
      return { x: left, y: boxCenterY, edge: 'left' }
    } else if (angle > 0) {
      return { x: boxCenterX, y: bottom, edge: 'bottom' }
    } else {
      return { x: boxCenterX, y: top, edge: 'top' }
    }
  }

  // Render transition line
  const renderTransition = (transition: WorkflowTransition) => {
    const fromState = states.find(s => s.id === transition.from_state_id)
    const toState = states.find(s => s.id === transition.to_state_id)
    
    if (!fromState || !toState) return null
    
    const isSelected = selectedTransitionId === transition.id
    const transitionGates = gates[transition.id] || []
    const isDraggingThisTransition = draggingTransitionEndpoint?.transitionId === transition.id
    const draggingEndpoint = isDraggingThisTransition ? draggingTransitionEndpoint?.endpoint : null
    
    // Determine actual source and target positions (considering drag state)
    let sourceStatePos = { x: fromState.position_x, y: fromState.position_y }
    let targetStatePos = { x: toState.position_x, y: toState.position_y }
    
    // Get custom dimensions for each state
    const fromDims = stateDimensions[fromState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
    const toDims = stateDimensions[toState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
    
    // Check for stored edge positions
    const storedStartPos = edgePositions[`${transition.id}-start`]
    const storedEndPos = edgePositions[`${transition.id}-end`]
    
    // Calculate default connection points (for fallback) using custom dimensions
    const defaultStartPoint = getClosestPointOnBox(sourceStatePos.x, sourceStatePos.y, targetStatePos.x, targetStatePos.y, fromDims.width, fromDims.height)
    const defaultEndPoint = getClosestPointOnBox(targetStatePos.x, targetStatePos.y, sourceStatePos.x, sourceStatePos.y, toDims.width, toDims.height)
    
    // Get the fixed points (either stored or default)
    const fixedStartPoint = storedStartPos 
      ? { ...getPointFromEdgePosition(sourceStatePos.x, sourceStatePos.y, storedStartPos, fromDims.width, fromDims.height), edge: storedStartPos.edge }
      : defaultStartPoint
    const fixedEndPoint = storedEndPos
      ? { ...getPointFromEdgePosition(targetStatePos.x, targetStatePos.y, storedEndPos, toDims.width, toDims.height), edge: storedEndPos.edge }
      : defaultEndPoint
    
    let startPoint: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' }
    let endPoint: { x: number; y: number; edge: 'left' | 'right' | 'top' | 'bottom' }
    
    if (draggingEndpoint === 'start') {
      // Keep END fixed, only move START
      endPoint = fixedEndPoint
      
      if (hoveredStateId) {
        const hoverState = states.find(s => s.id === hoveredStateId)
        if (hoverState) {
          // Snap start to nearest point on hovered box edge
          const hoverDims = stateDimensions[hoverState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
          startPoint = getNearestPointOnBoxEdge(hoverState.position_x, hoverState.position_y, mousePos.x, mousePos.y, hoverDims.width, hoverDims.height)
        } else {
          startPoint = { x: mousePos.x, y: mousePos.y, edge: 'right', fraction: 0.5 }
        }
      } else {
        // Dragging freely - start follows mouse
        startPoint = { x: mousePos.x, y: mousePos.y, edge: 'right', fraction: 0.5 }
      }
    } else if (draggingEndpoint === 'end') {
      // Keep START fixed, only move END
      startPoint = fixedStartPoint
      
      if (hoveredStateId) {
        const hoverState = states.find(s => s.id === hoveredStateId)
        if (hoverState) {
          // Snap end to nearest point on hovered box edge
          const hoverDims = stateDimensions[hoverState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
          endPoint = getNearestPointOnBoxEdge(hoverState.position_x, hoverState.position_y, mousePos.x, mousePos.y, hoverDims.width, hoverDims.height)
        } else {
          endPoint = { x: mousePos.x, y: mousePos.y, edge: 'left', fraction: 0.5 }
        }
      } else {
        // Dragging freely - end follows mouse
        endPoint = { x: mousePos.x, y: mousePos.y, edge: 'left', fraction: 0.5 }
      }
    } else {
      // Not dragging - use the fixed points (stored or default)
      startPoint = fixedStartPoint
      endPoint = fixedEndPoint
    }
    
    const startX = startPoint.x
    const startY = startPoint.y
    const endX = endPoint.x
    const endY = endPoint.y
    
    // Line midpoint (center between endpoints)
    const lineMidX = (startX + endX) / 2
    const lineMidY = (startY + endY) / 2
    
    // Calculate bounding box for toolbar positioning (to appear above the line)
    const allLinePoints = [
      { x: startX, y: startY },
      { x: endX, y: endY },
      ...(waypoints[transition.id] || [])
    ]
    const lineMinY = Math.min(...allLinePoints.map(p => p.y)) // Topmost point
    const lineCenterX = (Math.min(...allLinePoints.map(p => p.x)) + Math.max(...allLinePoints.map(p => p.x))) / 2
    
    // Check if we're dragging this transition's curve control
    const isDraggingThisCurve = draggingCurveControl === transition.id
    const isDraggingThisLabel = draggingLabel === transition.id
    
    // Get stored waypoints for this transition
    const storedWaypoints = waypoints[transition.id] || []
    
    // Build the effective waypoints list (considering drag state)
    let effectiveWaypoints: Array<{ x: number; y: number }> = [...storedWaypoints]
    
    if (isDraggingThisCurve && tempCurvePos && draggingWaypointIndex !== null) {
      // Update the waypoint being dragged - extend array if needed (for new waypoints)
      effectiveWaypoints = [...storedWaypoints]
      // Ensure array is long enough
      while (effectiveWaypoints.length <= draggingWaypointIndex) {
        effectiveWaypoints.push({ x: tempCurvePos.x, y: tempCurvePos.y })
      }
      effectiveWaypoints[draggingWaypointIndex] = { x: tempCurvePos.x, y: tempCurvePos.y }
    }
    
    // Generate path based on path type setting
    const start = { x: startX, y: startY, edge: startPoint.edge }
    const end = { x: endX, y: endY, edge: endPoint.edge }
    const pathType = transition.line_path_type || 'spline'
    
    let pathD: string
    let curveMid: { x: number; y: number }
    
    if (pathType === 'straight') {
      // Simple straight line
      pathD = `M ${startX} ${startY} L ${endX} ${endY}`
      curveMid = { x: (startX + endX) / 2, y: (startY + endY) / 2 }
    } else if (pathType === 'elbow') {
      // Orthogonal elbow path - supports multiple waypoints like Miro
      // Each waypoint is a corner point where the path can turn
      const startEdge = startPoint.edge
      const endEdge = endPoint.edge
      
      // Minimum distance to travel before turning (clearance from box)
      const TURN_OFFSET = 30
      
      // Determine exit point and direction
      let exitX = startX
      let exitY = startY
      const exitHorizontal = startEdge === 'left' || startEdge === 'right'
      
      if (startEdge === 'right') exitX = startX + TURN_OFFSET
      else if (startEdge === 'left') exitX = startX - TURN_OFFSET
      else if (startEdge === 'top') exitY = startY - TURN_OFFSET
      else if (startEdge === 'bottom') exitY = startY + TURN_OFFSET
      
      // Determine entry point and direction
      let entryX = endX
      let entryY = endY
      const entryHorizontal = endEdge === 'left' || endEdge === 'right'
      
      if (endEdge === 'right') entryX = endX + TURN_OFFSET
      else if (endEdge === 'left') entryX = endX - TURN_OFFSET
      else if (endEdge === 'top') entryY = endY - TURN_OFFSET
      else if (endEdge === 'bottom') entryY = endY + TURN_OFFSET
      
      // Build path segments
      // For elbow paths, waypoints store SEGMENT POSITIONS (not corner positions)
      // - For vertical segments: waypoint.x is the X position of the segment
      // - For horizontal segments: waypoint.y is the Y position of the segment
      const segments: Array<{ x: number; y: number }> = [{ x: startX, y: startY }]
      segments.push({ x: exitX, y: exitY })
      
      // Determine the segment structure based on exit/entry directions
      if (exitHorizontal && entryHorizontal) {
        // Both horizontal - need vertical segment(s) in middle
        // Each waypoint controls a vertical segment's X position
        if (effectiveWaypoints.length === 0) {
          // Default: single vertical segment at midpoint
          const midX = (exitX + entryX) / 2
          segments.push({ x: midX, y: exitY })
          segments.push({ x: midX, y: entryY })
        } else {
          // Use waypoint X values for vertical segments
          let currentY = exitY
          for (let i = 0; i < effectiveWaypoints.length; i++) {
            const segX = effectiveWaypoints[i].x
            segments.push({ x: segX, y: currentY })
            // Alternate Y position for next segment
            currentY = (i % 2 === 0) ? entryY : exitY
            segments.push({ x: segX, y: currentY })
          }
          // Make sure we end at entry Y
          const lastPt = segments[segments.length - 1]
          if (lastPt.y !== entryY) {
            const finalX = effectiveWaypoints.length > 0 
              ? effectiveWaypoints[effectiveWaypoints.length - 1].x 
              : (exitX + entryX) / 2
            segments.push({ x: finalX, y: entryY })
          }
        }
      } else if (!exitHorizontal && !entryHorizontal) {
        // Both vertical - need horizontal segment(s) in middle
        // Each waypoint controls a horizontal segment's Y position
        if (effectiveWaypoints.length === 0) {
          // Default: single horizontal segment at midpoint
          const midY = (exitY + entryY) / 2
          segments.push({ x: exitX, y: midY })
          segments.push({ x: entryX, y: midY })
        } else {
          // Use waypoint Y values for horizontal segments
          let currentX = exitX
          for (let i = 0; i < effectiveWaypoints.length; i++) {
            const segY = effectiveWaypoints[i].y
            segments.push({ x: currentX, y: segY })
            // Alternate X position for next segment
            currentX = (i % 2 === 0) ? entryX : exitX
            segments.push({ x: currentX, y: segY })
          }
          // Make sure we end at entry X
          const lastPt = segments[segments.length - 1]
          if (lastPt.x !== entryX) {
            const finalY = effectiveWaypoints.length > 0 
              ? effectiveWaypoints[effectiveWaypoints.length - 1].y 
              : (exitY + entryY) / 2
            segments.push({ x: entryX, y: finalY })
          }
        }
      } else if (exitHorizontal) {
        // Exit horizontal, entry vertical - need corner(s)
        if (effectiveWaypoints.length === 0) {
          // Default: corner at (entryX, exitY)
          segments.push({ x: entryX, y: exitY })
        } else {
          // Waypoint controls corner position
          const wp = effectiveWaypoints[0]
          segments.push({ x: wp.x, y: exitY })
          segments.push({ x: wp.x, y: wp.y })
          if (wp.x !== entryX) {
            segments.push({ x: entryX, y: wp.y })
          }
        }
      } else {
        // Exit vertical, entry horizontal - need corner(s)
        if (effectiveWaypoints.length === 0) {
          // Default: corner at (exitX, entryY)
          segments.push({ x: exitX, y: entryY })
        } else {
          // Waypoint controls corner position
          const wp = effectiveWaypoints[0]
          segments.push({ x: exitX, y: wp.y })
          segments.push({ x: wp.x, y: wp.y })
          if (wp.y !== entryY) {
            segments.push({ x: wp.x, y: entryY })
          }
        }
      }
      
      segments.push({ x: entryX, y: entryY })
      segments.push({ x: endX, y: endY })
      
      // Remove duplicate consecutive points
      const cleanedSegments = segments.filter((p, i) => 
        i === 0 || p.x !== segments[i - 1].x || p.y !== segments[i - 1].y
      )
      
      // Build path string
      pathD = cleanedSegments.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      
      // Calculate handles at segment MIDPOINTS for ADJUSTABLE segments only (like Miro)
      // For H-to-H: vertical segments are adjustable (drag left/right)
      // For V-to-V: horizontal segments are adjustable (drag up/down)
      // For mixed: show handle on the corner segment
      const elbowHandlePositions: Array<{ x: number; y: number; isVertical: boolean; segmentIndex: number; waypointIndex: number }> = []
      
      // Determine which segment type is adjustable based on path configuration
      const adjustableSegmentType: 'vertical' | 'horizontal' | 'both' = 
        (exitHorizontal && entryHorizontal) ? 'vertical' :
        (!exitHorizontal && !entryHorizontal) ? 'horizontal' : 'both'
      
      // Track waypoint index for each handle
      let waypointIdx = 0
      
      for (let i = 1; i < cleanedSegments.length - 2; i++) {
        const p1 = cleanedSegments[i]
        const p2 = cleanedSegments[i + 1]
        
        // Determine if segment is vertical (same X) or horizontal (same Y)
        const isVerticalSegment = Math.abs(p1.x - p2.x) < 1
        const isHorizontalSegment = Math.abs(p1.y - p2.y) < 1
        
        // Only show handle if this is an adjustable segment
        const shouldShowHandle = 
          (adjustableSegmentType === 'vertical' && isVerticalSegment) ||
          (adjustableSegmentType === 'horizontal' && isHorizontalSegment) ||
          adjustableSegmentType === 'both'
        
        if (shouldShowHandle) {
          elbowHandlePositions.push({
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
            isVertical: isVerticalSegment,
            segmentIndex: i,
            waypointIndex: waypointIdx
          })
          waypointIdx++
        }
      }
      
      // Store handles with segment info for rendering
      ;(transition as any)._elbowHandles = elbowHandlePositions
      ;(transition as any)._elbowSegments = cleanedSegments
      
      // Calculate midpoint for label positioning (middle segment)
      const midIdx = Math.floor(cleanedSegments.length / 2)
      curveMid = {
        x: (cleanedSegments[Math.max(0, midIdx - 1)].x + cleanedSegments[midIdx].x) / 2,
        y: (cleanedSegments[Math.max(0, midIdx - 1)].y + cleanedSegments[midIdx].y) / 2
      }
    } else {
      // Spline (curved) - use existing spline function with waypoints
      pathD = generateSplinePath(start, effectiveWaypoints, end)
      curveMid = getPointOnSpline(start, effectiveWaypoints, end, 0.5)
    }
    const curveMidX = curveMid.x
    const curveMidY = curveMid.y
    
    // Label position - can be dragged separately or pinned to absolute position
    const storedLabelOffset = labelOffsets[transition.id]
    const pinnedPosition = pinnedLabelPositions[transition.id]
    let labelX: number, labelY: number
    
    if (isDraggingThisLabel && tempLabelPos) {
      labelX = tempLabelPos.x
      labelY = tempLabelPos.y
    } else if (pinnedPosition) {
      // Pinned: use absolute position (doesn't follow line)
      labelX = pinnedPosition.x
      labelY = pinnedPosition.y
    } else if (storedLabelOffset) {
      // Not pinned but has offset: follow line with offset
      labelX = lineMidX + storedLabelOffset.x
      labelY = lineMidY + storedLabelOffset.y
    } else {
      // Default: above the curve midpoint
      labelX = curveMidX
      labelY = curveMidY - 20
    }
    
    // Position for gate indicator (below curve midpoint)
    const gateX = curveMidX
    const gateY = curveMidY + 15
    
    return (
      <g key={transition.id} style={{ pointerEvents: 'auto' }}>
        {/* Clickable wider path for selection */}
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth="20"
          className="cursor-pointer"
          onMouseEnter={() => setHoveredTransitionId(transition.id)}
          onMouseLeave={() => setHoveredTransitionId(null)}
          onClick={(e) => {
            e.stopPropagation()
            setSelectedTransitionId(transition.id)
            setSelectedStateId(null)
            // Show floating toolbar above the topmost point of the line (store canvas coordinates)
            setFloatingToolbar({
              canvasX: lineCenterX,
              canvasY: lineMinY, // Topmost point of line
              type: 'transition',
              targetId: transition.id
            })
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (isAdmin) {
              // Get click position in canvas coordinates
              const rect = canvasRef.current?.getBoundingClientRect()
              if (rect) {
                const clickX = (e.clientX - rect.left - pan.x) / zoom
                const clickY = (e.clientY - rect.top - pan.y) / zoom
                
                const currentWaypoints = waypoints[transition.id] || []
                
                if (pathType === 'elbow') {
                  // For elbow paths, determine path configuration and add appropriate waypoint
                  // H-to-H: waypoints control vertical segments (store X value)
                  // V-to-V: waypoints control horizontal segments (store Y value)
                  // Mixed: waypoints control corners (store both X and Y)
                  const startEdge = startPoint?.edge
                  const endEdge = endPoint?.edge
                  const exitHorizontal = startEdge === 'left' || startEdge === 'right'
                  const entryHorizontal = endEdge === 'left' || endEdge === 'right'
                  
                  // Create waypoint based on path configuration
                  const newWaypoint = { x: clickX, y: clickY }
                  
                  // For H-to-H paths, sort waypoints by X
                  // For V-to-V paths, sort waypoints by Y
                  const newWaypoints = [...currentWaypoints, newWaypoint]
                  
                  if (exitHorizontal && entryHorizontal) {
                    // H-to-H: sort by X position
                    newWaypoints.sort((a, b) => a.x - b.x)
                  } else if (!exitHorizontal && !entryHorizontal) {
                    // V-to-V: sort by Y position
                    newWaypoints.sort((a, b) => a.y - b.y)
                  }
                  // For mixed paths, order doesn't matter (single waypoint corner)
                  
                  setWaypoints(prev => ({
                    ...prev,
                    [transition.id]: newWaypoints
                  }))
                } else {
                  // For spline paths, use standard insertion
                  const insertIndex = findInsertionIndex(
                    currentWaypoints,
                    { x: startX, y: startY },
                    { x: endX, y: endY },
                    { x: clickX, y: clickY }
                  )
                  
                  const newWaypoints = [...currentWaypoints]
                  newWaypoints.splice(insertIndex, 0, { x: clickX, y: clickY })
                  
                  setWaypoints(prev => ({
                    ...prev,
                    [transition.id]: newWaypoints
                  }))
                }
                
                addToast('info', 'Control point added')
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            // Right-click shows waypoint context menu for adding control points
            setSelectedTransitionId(transition.id)
            setSelectedStateId(null)
            
            // Get click position in canvas coordinates
            const rect = canvasRef.current?.getBoundingClientRect()
            if (rect) {
              const clickX = (e.clientX - rect.left - pan.x) / zoom
              const clickY = (e.clientY - rect.top - pan.y) / zoom
              
              setWaypointContextMenu({
                x: e.clientX,
                y: e.clientY,
                canvasX: clickX,
                canvasY: clickY,
                transitionId: transition.id,
                waypointIndex: null // null = clicking on line, not on existing waypoint
              })
            }
          }}
        />
        
        {/* Visible path */}
        {(() => {
          const isHoveredLine = hoveredTransitionId === transition.id
          // Lighten color slightly on hover for subtle effect
          const baseColor = transition.line_color || '#6b7280'
          const lineColor = isDraggingThisTransition ? '#60a5fa' : isSelected ? '#60a5fa' : isHoveredLine ? lightenColor(baseColor, 0.35) : baseColor
          const strokeWidth = transition.line_thickness || 2
          const arrowHead = transition.line_arrow_head || 'end'
          
          // Determine markers based on arrow head setting
          let markerStart: string | undefined
          let markerEnd: string | undefined
          
          if (isSelected || isDraggingThisTransition) {
            if (arrowHead === 'end' || arrowHead === 'both') {
              markerEnd = 'url(#arrowhead-selected)'
            }
            if (arrowHead === 'start' || arrowHead === 'both') {
              markerStart = 'url(#arrowhead-start-selected)'
            }
          } else if (isHoveredLine) {
            // Use hover markers
            if (arrowHead === 'end' || arrowHead === 'both') {
              markerEnd = `url(#arrowhead-hover-${transition.id})`
            }
            if (arrowHead === 'start' || arrowHead === 'both') {
              markerStart = `url(#arrowhead-start-hover-${transition.id})`
            }
          } else {
            if (arrowHead === 'end' || arrowHead === 'both') {
              markerEnd = `url(#arrowhead-${transition.id})`
            }
            if (arrowHead === 'start' || arrowHead === 'both') {
              markerStart = `url(#arrowhead-start-${transition.id})`
            }
          }
          
          return (
            <path
              d={pathD}
              fill="none"
              stroke={lineColor}
              strokeWidth={strokeWidth}
              strokeDasharray={isDraggingThisTransition ? '6,3' : transition.line_style === 'dashed' ? '8,4' : transition.line_style === 'dotted' ? '2,4' : 'none'}
              markerStart={markerStart}
              markerEnd={markerEnd}
              className="pointer-events-none"
              style={{ transition: 'stroke 0.15s ease-out' }}
            />
          )
        })()}
        
        {/* Handles are rendered in a separate layer above states */}
        
        {/* Transition label - always visible (hidden when selected since handles layer shows it) */}
        {transition.name && !isDraggingThisTransition && !isSelected && (
          <g 
            transform={`translate(${labelX}, ${labelY})`}
            className="cursor-pointer"
            style={{ pointerEvents: 'all' }}
            onClick={(e) => {
              e.stopPropagation()
              setSelectedTransitionId(transition.id)
              setSelectedStateId(null)
            }}
          >
            <rect
              x={-(transition.name.length * 3.5 + 8)}
              y="-10"
              width={transition.name.length * 7 + 16}
              height="18"
              rx="4"
              fill="rgba(31, 41, 55, 0.9)"
              stroke="rgba(75, 85, 99, 0.5)"
              strokeWidth="1"
            />
            <text
              x="0"
              y="3"
              textAnchor="middle"
              fontSize="10"
              fill="#d1d5db"
              className="select-none pointer-events-none"
            >
              {transition.name}
            </text>
          </g>
        )}
        
        {/* Gate indicator - clickable, positioned separately */}
        {transitionGates.length > 0 && !isDraggingThisTransition && (
          <g 
            transform={`translate(${gateX}, ${gateY})`}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedTransitionId(transition.id)
              setSelectedStateId(null)
            }}
          >
            <circle 
              r="12" 
              fill="#f59e0b" 
              stroke="#fff" 
              strokeWidth="2"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="11"
              fontWeight="700"
              fill="#000"
              className="select-none pointer-events-none"
            >
              {transitionGates.length}
            </text>
            {/* Tooltip hint */}
            <title>{transitionGates.length} gate{transitionGates.length > 1 ? 's' : ''} - click to view</title>
          </g>
        )}
      </g>
    )
  }
  
  // Render creating transition line
  const renderCreatingTransition = () => {
    if (!isCreatingTransition || !transitionStartId) return null
    
    const fromState = states.find(s => s.id === transitionStartId)
    if (!fromState) return null
    
    // Determine end point - snap to hovered state edge or use mouse position
    let endX = mousePos.x
    let endY = mousePos.y
    
    if (hoveredStateId && hoveredStateId !== transitionStartId) {
      const hoverState = states.find(s => s.id === hoveredStateId)
      if (hoverState) {
        const hoverDims = stateDimensions[hoverState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
        // Snap end point to nearest of 4 handle positions
        const hw = hoverDims.width / 2
        const hh = hoverDims.height / 2
        const handlePositions = [
          { x: hoverState.position_x + hw, y: hoverState.position_y, edge: 'right' as const },
          { x: hoverState.position_x - hw, y: hoverState.position_y, edge: 'left' as const },
          { x: hoverState.position_x, y: hoverState.position_y - hh, edge: 'top' as const },
          { x: hoverState.position_x, y: hoverState.position_y + hh, edge: 'bottom' as const },
        ]
        let nearestHandle = handlePositions[0]
        let minDist = Infinity
        for (const hp of handlePositions) {
          const dist = Math.hypot(hp.x - mousePos.x, hp.y - mousePos.y)
          if (dist < minDist) {
            minDist = dist
            nearestHandle = hp
          }
        }
        endX = nearestHandle.x
        endY = nearestHandle.y
      }
    }
    
    // Snap start point to nearest of 4 handle positions on source box
    const fromDims = stateDimensions[fromState.id] || { width: DEFAULT_STATE_WIDTH, height: DEFAULT_STATE_HEIGHT }
    const fhw = fromDims.width / 2
    const fhh = fromDims.height / 2
    const fromHandlePositions = [
      { x: fromState.position_x + fhw, y: fromState.position_y, edge: 'right' as const },
      { x: fromState.position_x - fhw, y: fromState.position_y, edge: 'left' as const },
      { x: fromState.position_x, y: fromState.position_y - fhh, edge: 'top' as const },
      { x: fromState.position_x, y: fromState.position_y + fhh, edge: 'bottom' as const },
    ]
    let startPoint = fromHandlePositions[0]
    let minStartDist = Infinity
    for (const hp of fromHandlePositions) {
      const dist = Math.hypot(hp.x - endX, hp.y - endY)
      if (dist < minStartDist) {
        minStartDist = dist
        startPoint = hp
      }
    }
    
    // Calculate midpoint for curved path
    const midX = (startPoint.x + endX) / 2
    const midY = (startPoint.y + endY) / 2
    const curveOffset = 30
    
    // Curve the line slightly
    let controlX = midX
    let controlY = midY - curveOffset
    
    if (startPoint.edge === 'bottom' || startPoint.edge === 'top') {
      controlX = midX + curveOffset
      controlY = midY
    }
    
    const pathD = `M ${startPoint.x} ${startPoint.y} Q ${controlX} ${controlY} ${endX} ${endY}`
    
    return (
      <path
        d={pathD}
        fill="none"
        stroke="#22c55e"
        strokeWidth="2"
        strokeDasharray="5,5"
        markerEnd="url(#arrowhead-creating)"
        className="pointer-events-none"
      />
    )
  }
  
  // Render transition handles in a separate layer (above states)
  const renderTransitionHandles = () => {
    if (!isAdmin) return null
    
    return transitions.map(transition => {
      const fromState = states.find(s => s.id === transition.from_state_id)
      const toState = states.find(s => s.id === transition.to_state_id)
      if (!fromState || !toState) return null
      
      const isSelected = selectedTransitionId === transition.id
      const isDraggingThis = draggingTransitionEndpoint?.transitionId === transition.id
      
      // Only show handles when selected and not currently dragging this transition
      if (!isSelected || isDraggingThis) return null
      
      // Check for stored edge positions
      const storedStartPos = edgePositions[`${transition.id}-start`]
      const storedEndPos = edgePositions[`${transition.id}-end`]
      
      // Calculate handle positions (use stored or default)
      const defaultStartPoint = getClosestPointOnBox(
        fromState.position_x, fromState.position_y,
        toState.position_x, toState.position_y
      )
      const defaultEndPoint = getClosestPointOnBox(
        toState.position_x, toState.position_y,
        fromState.position_x, fromState.position_y
      )
      
      const startPoint = storedStartPos 
        ? { ...getPointFromEdgePosition(fromState.position_x, fromState.position_y, storedStartPos), edge: storedStartPos.edge }
        : defaultStartPoint
      const endPoint = storedEndPos
        ? { ...getPointFromEdgePosition(toState.position_x, toState.position_y, storedEndPos), edge: storedEndPos.edge }
        : defaultEndPoint
      
      // Get path type and waypoints for this transition
      const pathType = transition.line_path_type || 'spline'
      // Always show waypoints when selected (even for non-spline) so user can manage them
      const transitionWaypoints = waypoints[transition.id] || []
      const lineMidX = (startPoint.x + endPoint.x) / 2
      const lineMidY = (startPoint.y + endPoint.y) / 2
      
      // Calculate curve midpoint for label positioning
      const curveMid = pathType === 'spline' 
        ? getPointOnSpline(
            { x: startPoint.x, y: startPoint.y, edge: startPoint.edge },
            transitionWaypoints,
            { x: endPoint.x, y: endPoint.y, edge: endPoint.edge },
            0.5
          )
        : { x: lineMidX, y: lineMidY }
      const curveMidX = curveMid.x
      const curveMidY = curveMid.y
      
      // Label position
      const storedLabelOffset = labelOffsets[transition.id]
      const labelX = storedLabelOffset ? lineMidX + storedLabelOffset.x : curveMidX
      const labelY = storedLabelOffset ? lineMidY + storedLabelOffset.y : curveMidY - 20
      const isDraggingThisLabel = draggingLabel === transition.id
      const actualLabelX = isDraggingThisLabel && tempLabelPos ? tempLabelPos.x : labelX
      const actualLabelY = isDraggingThisLabel && tempLabelPos ? tempLabelPos.y : labelY
      
      return (
        <g key={`handles-${transition.id}`}>
          {/* Start handle - small sleek circle */}
          <g
            transform={`translate(${startPoint.x}, ${startPoint.y})`}
            className="cursor-grab"
            style={{ pointerEvents: 'all' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setFloatingToolbar(null) // Hide toolbar when dragging starts
              setDraggingTransitionEndpoint({
                transitionId: transition.id,
                endpoint: 'start',
                originalStateId: transition.from_state_id
              })
            }}
          >
            {/* Invisible hit area */}
            <circle r="12" fill="transparent" />
            {/* Sleek visible handle */}
            <circle
              r="5"
              fill="#60a5fa"
              stroke="#fff"
              strokeWidth="1.5"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
            />
            <title>Drag to reconnect start</title>
          </g>
          
          {/* Waypoint handles - show at segment midpoints for elbow paths */}
          {(pathType === 'elbow' ? 
            // For elbow paths: show handles at segment MIDPOINTS (dynamically centered)
            ((transition as any)._elbowHandles || []).map((handle: { x: number; y: number; isVertical: boolean; segmentIndex: number; waypointIndex: number }, index: number) => {
              // Use waypointIndex for drag tracking, not array index
              const waypointIdx = handle.waypointIndex
              const isDraggingThisWaypoint = draggingCurveControl === transition.id && draggingWaypointIndex === waypointIdx
              // Handle position - for elbow, handles stay at segment midpoints
              // During drag, the segment moves which changes the midpoint
              let wpX = handle.x
              let wpY = handle.y
              
              if (isDraggingThisWaypoint && tempCurvePos) {
                // During drag, show handle at the dragged position (constrained to axis)
                if (handle.isVertical) {
                  // Vertical segment - only X changes, Y stays at midpoint
                  wpX = tempCurvePos.x
                } else {
                  // Horizontal segment - only Y changes, X stays at midpoint
                  wpY = tempCurvePos.y
                }
              }
              
              const isActiveForPathType = true
              const isHovered = hoveredWaypoint?.transitionId === transition.id && hoveredWaypoint?.index === waypointIdx
              // Cursor based on segment direction - perpendicular to segment
              const cursor = handle.isVertical ? 'ew-resize' : 'ns-resize'
              
              return { wpX, wpY, index: waypointIdx, isDraggingThisWaypoint, isActiveForPathType, isHovered, isVertical: handle.isVertical, freeMove: false, cursor, segmentIndex: handle.segmentIndex }
            })
            : 
            // For spline paths: show handles at stored waypoint positions
            transitionWaypoints.map((waypoint, index) => {
              const isDraggingThisWaypoint = draggingCurveControl === transition.id && draggingWaypointIndex === index
              const wpX = isDraggingThisWaypoint && tempCurvePos ? tempCurvePos.x : waypoint.x
              const wpY = isDraggingThisWaypoint && tempCurvePos ? tempCurvePos.y : waypoint.y
              const isActiveForPathType = true
              const isHovered = hoveredWaypoint?.transitionId === transition.id && hoveredWaypoint?.index === index
              return { wpX, wpY, index, isDraggingThisWaypoint, isActiveForPathType, isHovered, isVertical: false, freeMove: true, cursor: 'move' }
            })
          ).map(({ wpX, wpY, index, isDraggingThisWaypoint, isActiveForPathType, isHovered, isVertical, freeMove, cursor }) => {
            
            return (
              <g
                key={`waypoint-${index}`}
                transform={`translate(${wpX}, ${wpY})`}
                style={{ pointerEvents: 'all', opacity: isActiveForPathType ? 1 : 0.5, cursor }}
                onMouseEnter={() => setHoveredWaypoint({ transitionId: transition.id, index })}
                onMouseLeave={() => setHoveredWaypoint(null)}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setFloatingToolbar(null) // Hide toolbar when dragging starts
                  setWaypointContextMenu(null) // Close waypoint menu if open
                  setDraggingCurveControl(transition.id)
                  setDraggingWaypointIndex(index)
                  // For elbow paths, set axis constraint (unless it's a freeMove corner)
                  const axisConstraint = (pathType === 'elbow' && !freeMove) 
                    ? (isVertical ? 'x' : 'y') 
                    : null
                  setDraggingWaypointAxis(axisConstraint)
                  setTempCurvePos({ x: wpX, y: wpY })
                  waypointHasDraggedRef.current = false
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  // Only delete if we haven't dragged
                  if (!waypointHasDraggedRef.current) {
                    setWaypoints(prev => {
                      const currentWaypoints = [...(prev[transition.id] || [])]
                      currentWaypoints.splice(index, 1)
                      if (currentWaypoints.length === 0) {
                        const next = { ...prev }
                        delete next[transition.id]
                        return next
                      }
                      return { ...prev, [transition.id]: currentWaypoints }
                    })
                    addToast('info', 'Control point removed')
                  }
                }}
                onContextMenu={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  // Show context menu for this waypoint (with delete option)
                  setWaypointContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    canvasX: wpX,
                    canvasY: wpY,
                    transitionId: transition.id,
                    waypointIndex: index
                  })
                }}
              >
                {/* Invisible hit area */}
                <circle r="12" fill="transparent" />
                {/* Hover highlight ring */}
                {isHovered && !isDraggingThisWaypoint && (
                  <circle
                    r="9"
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                )}
                {/* White circle with blue border */}
                <circle
                  r="5"
                  fill={isDraggingThisWaypoint ? '#60a5fa' : (isHovered ? '#f0f0f0' : '#ffffff')}
                  stroke={isActiveForPathType ? '#60a5fa' : '#888'}
                  strokeWidth={isHovered || isDraggingThisWaypoint ? 2.5 : 2}
                  strokeDasharray={isActiveForPathType ? undefined : '2,2'}
                  style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
                />
                <title>
                  {isActiveForPathType 
                    ? `Drag to adjust • Double-click or right-click to remove`
                    : `Control point (inactive - used for spline and elbow paths)`
                  }
                </title>
              </g>
            )
          })}
          
          {/* Show "add waypoint" hint when no waypoints exist (spline and elbow modes) */}
          {(pathType === 'spline' || pathType === 'elbow') && transitionWaypoints.length === 0 && (
            <g
              transform={`translate(${curveMidX}, ${curveMidY})`}
              className="pointer-events-none"
            >
              <circle
                r="5"
                fill="rgba(255, 255, 255, 0.3)"
                stroke={`${transition.line_color || '#6b7280'}80`}
                strokeWidth="2"
                strokeDasharray="2,2"
              />
              <title>Double-click or right-click to add control point</title>
            </g>
          )}
          
          {/* Label as draggable handle - the label itself is the handle */}
          {transition.name && (() => {
            const isPinned = !!pinnedLabelPositions[transition.id]
            const textWidth = transition.name.length * 7
            const pinAreaWidth = 18 // Width for pin icon area
            const padding = 8
            const totalWidth = textWidth + padding * 2 + pinAreaWidth
            const labelStartX = -totalWidth / 2
            const textCenterX = labelStartX + padding + textWidth / 2
            const pinCenterX = labelStartX + textWidth + padding * 1.5 + pinAreaWidth / 2
            
            return (
              <g
                transform={`translate(${actualLabelX}, ${actualLabelY})`}
                style={{ pointerEvents: 'all' }}
              >
                {/* Label background - extended to include pin area */}
                <rect
                  x={labelStartX}
                  y="-10"
                  width={totalWidth}
                  height="18"
                  rx="4"
                  fill="rgba(31, 41, 55, 0.95)"
                  stroke={isDraggingThisLabel ? '#60a5fa' : isPinned ? 'rgba(96, 165, 250, 0.8)' : 'rgba(96, 165, 250, 0.6)'}
                  strokeWidth={isDraggingThisLabel ? 2 : isPinned ? 1.5 : 1}
                  style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
                  className="cursor-move"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    setDraggingLabel(transition.id)
                    setTempLabelPos({ x: actualLabelX, y: actualLabelY })
                    // Select the transition when starting to drag its label
                    setSelectedTransitionId(transition.id)
                    setSelectedStateId(null)
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    // Reset both offset and pinned position
                    setLabelOffsets(prev => {
                      const next = { ...prev }
                      delete next[transition.id]
                      return next
                    })
                    setPinnedLabelPositions(prev => {
                      const next = { ...prev }
                      delete next[transition.id]
                      return next
                    })
                    addToast('info', 'Label position reset')
                  }}
                />
                
                {/* Subtle divider between text and pin */}
                <line
                  x1={pinCenterX - pinAreaWidth / 2 - 1}
                  y1="-6"
                  x2={pinCenterX - pinAreaWidth / 2 - 1}
                  y2="6"
                  stroke="rgba(75, 85, 99, 0.4)"
                  strokeWidth="1"
                />
                
                {/* Label text */}
                <text
                  x={textCenterX}
                  y="3"
                  textAnchor="middle"
                  fontSize="10"
                  fill="#d1d5db"
                  className="select-none pointer-events-none"
                >
                  {transition.name}
                </text>
                
                {/* Pin icon - inside the label on the right */}
                <g
                  transform={`translate(${pinCenterX}, 0)`}
                  className="cursor-pointer"
                  style={{ pointerEvents: 'all' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isPinned) {
                      // Unpin: remove absolute position, label will follow line again
                      setPinnedLabelPositions(prev => {
                        const next = { ...prev }
                        delete next[transition.id]
                        return next
                      })
                    } else {
                      // Pin: save current absolute position
                      setPinnedLabelPositions(prev => ({
                        ...prev,
                        [transition.id]: { x: actualLabelX, y: actualLabelY }
                      }))
                    }
                  }}
                >
                  {/* Hover highlight area */}
                  <rect
                    x="-7"
                    y="-7"
                    width="14"
                    height="14"
                    rx="2"
                    fill={isPinned ? 'rgba(96, 165, 250, 0.3)' : 'transparent'}
                    className="hover:fill-[rgba(96,165,250,0.2)]"
                  />
                  {/* Pin icon */}
                  <g transform="translate(-5, -5) scale(0.42)">
                    <path 
                      d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5a.5.5 0 0 0 0-1h-9a.5.5 0 0 0 0 1H8a1 1 0 0 1 1 1z"
                      fill="none"
                      stroke={isPinned ? '#60a5fa' : '#9ca3af'}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                  <title>{isPinned ? 'Unpin (label will follow line)' : 'Pin label to canvas (won\'t follow line)'}</title>
                </g>
                
                <title>Drag to move label (double-click to reset)</title>
              </g>
            )
          })()}
          
          {/* End handle - small sleek circle with arrow indicator */}
          <g
            transform={`translate(${endPoint.x}, ${endPoint.y})`}
            className="cursor-grab"
            style={{ pointerEvents: 'all' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setFloatingToolbar(null) // Hide toolbar when dragging starts
              setDraggingTransitionEndpoint({
                transitionId: transition.id,
                endpoint: 'end',
                originalStateId: transition.to_state_id
              })
            }}
          >
            {/* Invisible hit area */}
            <circle r="12" fill="transparent" />
            {/* Sleek visible handle */}
            <circle
              r="5"
              fill="#22c55e"
              stroke="#fff"
              strokeWidth="1.5"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
            />
            <title>Drag to reconnect end</title>
          </g>
        </g>
      )
    })
  }
  
  if (!organization) {
    return (
      <div className="p-4 text-sm text-plm-fg-muted text-center">
        Sign in to manage workflows
      </div>
    )
  }
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="spinner" />
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* Unified header bar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-plm-border bg-plm-bg-light overflow-visible relative z-20">
        {/* Workflow selector */}
        <select
          value={selectedWorkflow?.id || ''}
          onChange={(e) => {
            const workflow = workflows.find(w => w.id === e.target.value)
            if (workflow) selectWorkflow(workflow)
          }}
          className="bg-plm-input border border-plm-border rounded px-2 py-1 text-sm min-w-[140px]"
          title={selectedWorkflow?.description || 'Select workflow'}
        >
          <option value="">Select workflow...</option>
          {workflows.map(w => (
            <option key={w.id} value={w.id}>
              {w.name} {w.is_default ? '(default)' : ''}
            </option>
          ))}
        </select>
        
        {isAdmin && (
          <button
            onClick={() => setShowCreateWorkflow(true)}
            className="p-1 hover:bg-plm-bg rounded text-plm-accent"
            title="Create new workflow"
          >
            <Plus size={14} />
          </button>
        )}
        
        {isAdmin && selectedWorkflow && (
          <button
            onClick={() => setShowEditWorkflow(true)}
            className="p-1 hover:bg-plm-bg rounded text-plm-fg-muted hover:text-plm-fg"
            title="Edit workflow name & description"
          >
            <Edit3 size={14} />
          </button>
        )}
        
        {selectedWorkflow && (
          <>
            <div className="w-px h-4 bg-plm-border mx-1" />
          <button
            onClick={() => {
              setCanvasMode('select')
              cancelConnectMode()
            }}
            className={`p-1.5 rounded ${canvasMode === 'select' && !isCreatingTransition ? 'bg-plm-accent text-white' : 'hover:bg-plm-bg'}`}
            title="Select mode (Esc)"
          >
            <MousePointer size={14} />
          </button>
          <button
            onClick={() => {
              setCanvasMode('pan')
              cancelConnectMode()
            }}
            className={`p-1.5 rounded ${canvasMode === 'pan' ? 'bg-plm-accent text-white' : 'hover:bg-plm-bg'}`}
            title="Pan mode"
          >
            <Move size={14} />
          </button>
          {isAdmin && (
            <button
              onClick={() => setCanvasMode('connect')}
              className={`p-1.5 rounded ${canvasMode === 'connect' || isCreatingTransition ? 'bg-green-600 text-white' : 'hover:bg-plm-bg'}`}
              title="Connect mode - draw transitions"
            >
              <ArrowRight size={14} />
            </button>
          )}
          
          {/* Cancel button when connecting */}
          {isCreatingTransition && (
            <button
              onClick={cancelConnectMode}
              className="p-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400"
              title="Cancel (Esc)"
            >
              <X size={14} />
            </button>
          )}
          
          <div className="w-px h-4 bg-plm-border mx-1" />
          
          <button
            onClick={() => setZoom(Math.min(2, zoom * 1.2))}
            className="p-1.5 hover:bg-plm-bg rounded"
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <span className="text-xs text-plm-fg-muted min-w-[40px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(Math.max(0.25, zoom * 0.8))}
            className="p-1.5 hover:bg-plm-bg rounded"
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => {
              setZoom(1)
              // Center on content instead of origin
              if (states.length > 0) {
                const minX = Math.min(...states.map(s => s.position_x))
                const maxX = Math.max(...states.map(s => s.position_x))
                const minY = Math.min(...states.map(s => s.position_y))
                const maxY = Math.max(...states.map(s => s.position_y))
                const contentCenterX = (minX + maxX) / 2
                const contentCenterY = (minY + maxY) / 2
                const canvasWidth = canvasRef.current?.clientWidth || 800
                const canvasHeight = canvasRef.current?.clientHeight || 600
                setPan({ 
                  x: (canvasWidth / 2) - contentCenterX, 
                  y: (canvasHeight / 2) - contentCenterY 
                })
              } else {
                setPan({ x: 0, y: 0 })
              }
            }}
            className="p-1.5 hover:bg-plm-bg rounded text-xs"
            title="Center on content"
          >
            1:1
          </button>
          
          <div className="w-px h-4 bg-plm-border mx-1" />
          
          {/* Snap settings button */}
          <div className="relative overflow-visible">
            <button
              onClick={() => setShowSnapSettings(!showSnapSettings)}
              className={`p-1.5 rounded flex items-center gap-1 ${
                (snapSettings.snapToGrid || snapSettings.snapToAlignment) 
                  ? 'bg-plm-accent/20 text-plm-accent' 
                  : 'hover:bg-plm-bg'
              }`}
              title="Snap settings"
            >
              <Magnet size={14} />
              <ChevronDown size={10} className={showSnapSettings ? 'rotate-180' : ''} />
            </button>
            
            {/* Snap settings dropdown */}
            {showSnapSettings && (
              <div className="absolute top-full left-0 mt-1 w-52 bg-plm-bg-light border border-plm-border rounded-lg shadow-lg z-[100] p-2.5">
                <div className="text-xs font-medium text-plm-fg mb-2 flex items-center gap-1.5">
                  <Settings2 size={11} />
                  Snap Settings
                </div>
                
                {/* Snap to Grid */}
                <label className="flex items-center gap-1.5 mb-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={snapSettings.snapToGrid}
                    onChange={(e) => setSnapSettings(prev => ({ ...prev, snapToGrid: e.target.checked }))}
                    className="rounded border-plm-border bg-plm-bg text-plm-accent focus:ring-plm-accent w-3 h-3"
                  />
                  <Grid size={11} className="text-plm-fg-muted group-hover:text-plm-fg shrink-0" />
                  <span className="text-[11px] text-plm-fg">Snap to Grid</span>
                </label>
                
                {/* Grid Size */}
                <div className="mb-1.5 pl-4">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="10"
                      value={snapSettings.gridSize}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, gridSize: parseInt(e.target.value) }))}
                      className="flex-1 h-1 bg-plm-border rounded appearance-none cursor-pointer min-w-0"
                    />
                    <span className="text-[10px] text-plm-fg-muted w-9 text-right shrink-0">{snapSettings.gridSize}px</span>
                  </div>
                </div>
                
                <div className="w-full h-px bg-plm-border my-1.5" />
                
                {/* Snap to Alignment */}
                <label className="flex items-center gap-1.5 mb-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={snapSettings.snapToAlignment}
                    onChange={(e) => setSnapSettings(prev => ({ ...prev, snapToAlignment: e.target.checked }))}
                    className="rounded border-plm-border bg-plm-bg text-plm-accent focus:ring-plm-accent w-3 h-3"
                  />
                  <AlignVerticalJustifyCenter size={11} className="text-plm-fg-muted group-hover:text-plm-fg shrink-0" />
                  <span className="text-[11px] text-plm-fg">Snap to Alignment</span>
                </label>
                
                {/* Alignment Threshold */}
                <div className="pl-4">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min="5"
                      max="30"
                      step="5"
                      value={snapSettings.alignmentThreshold}
                      onChange={(e) => setSnapSettings(prev => ({ ...prev, alignmentThreshold: parseInt(e.target.value) }))}
                      className="flex-1 h-1 bg-plm-border rounded appearance-none cursor-pointer min-w-0"
                    />
                    <span className="text-[10px] text-plm-fg-muted w-9 text-right shrink-0">{snapSettings.alignmentThreshold}px</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex-1" />
          
          {/* Export/Import buttons */}
          <button
            onClick={exportWorkflow}
            className="p-1.5 hover:bg-plm-bg rounded"
            title="Export workflow to JSON"
          >
            <Download size={14} />
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => importInputRef.current?.click()}
                className="p-1.5 hover:bg-plm-bg rounded"
                title="Import workflow from JSON"
              >
                <Upload size={14} />
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    importWorkflow(file)
                    e.target.value = '' // Reset input
                  }
                }}
              />
            </>
          )}
          
          <div className="w-px h-4 bg-plm-border mx-1" />
          
          {/* Workflow Roles link */}
          {isAdmin && (
            <button
              onClick={() => {
                // Navigate to workflow roles settings
                const { setActiveView } = usePDMStore.getState()
                setActiveView('settings')
                window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'team-members' }))
              }}
              className="flex items-center gap-1 px-2 py-1 hover:bg-plm-bg rounded text-xs text-plm-fg-muted hover:text-plm-fg"
              title="Manage workflow roles (approval authorities)"
            >
              <BadgeCheck size={12} />
              Roles
            </button>
          )}
          
          <div className="w-px h-4 bg-plm-border mx-1" />
          
          {isAdmin && (
            <>
              <button
                onClick={addState}
                className="flex items-center gap-1 px-2 py-1 bg-plm-accent hover:bg-plm-accent-hover rounded text-white text-xs"
              >
                <Plus size={12} />
                Add State
              </button>
            </>
          )}
          </>
        )}
      </div>
      
      {/* Visual canvas */}
      {selectedWorkflow && (
        <div 
          ref={canvasRef}
          className="flex-1 overflow-hidden bg-plm-bg relative"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => {
            // Don't call handleCanvasMouseUp here - the global mouseup listener handles
            // mouse releases outside the canvas. Calling it here causes double-fire issues.
            // Only cancel transition endpoint drag on mouse leave (not state drag)
            if (draggingTransitionEndpoint) {
              setDraggingTransitionEndpoint(null)
              setHoveredStateId(null)
            }
          }}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
          onContextMenu={(e) => {
            e.preventDefault()
            
            // Only show canvas context menu for admins
            if (!isAdmin || !selectedWorkflow) return
            
            // Calculate canvas position from screen position
            const rect = canvasRef.current?.getBoundingClientRect()
            if (!rect) return
            
            const canvasX = (e.clientX - rect.left - pan.x) / zoom
            const canvasY = (e.clientY - rect.top - pan.y) / zoom
            
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              type: 'canvas',
              targetId: '',
              canvasX,
              canvasY
            })
          }}
          style={{ 
            cursor: draggingStateId || draggingTransitionEndpoint
              ? 'grabbing'
              : canvasMode === 'pan' 
                ? (isDragging ? 'grabbing' : 'grab') 
                : isCreatingTransition 
                  ? 'crosshair' 
                  : 'default' 
          }}
        >
          {/* Mode indicator */}
          {(isCreatingTransition || canvasMode === 'connect' || draggingTransitionEndpoint || (isAdmin && canvasMode === 'select' && states.length > 0)) && (
            <div className="absolute top-2 left-2 z-10 bg-plm-bg-light/95 border border-plm-border rounded px-2 py-1 text-xs text-plm-fg-muted flex items-center gap-2 backdrop-blur-sm">
              {draggingTransitionEndpoint ? (
                <>
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <span>{hoveredStateId ? 'Release to connect' : 'Drag to a state to reconnect'}</span>
                </>
              ) : isCreatingTransition ? (
                <>
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span>Click a state to connect, or press ESC to cancel</span>
                </>
              ) : canvasMode === 'connect' ? (
                <>
                  <ArrowRight size={12} className="text-green-500" />
                  <span>Click green dots to create transitions</span>
                </>
              ) : draggingStateId ? (
                <>
                  <GripHorizontal size={12} className="text-blue-400" />
                  <span>Release to place state</span>
                </>
              ) : selectedTransitionId ? (
                <>
                  <ArrowRight size={12} className="text-blue-400" />
                  <span>Drag blue handles to reconnect arrow endpoints</span>
                </>
              ) : (
                <>
                  <GripHorizontal size={12} />
                  <span>Drag states to reposition • Select arrows to edit</span>
                </>
              )}
            </div>
          )}
          
          {/* Grid pattern */}
          <svg 
            className="absolute inset-0 w-full h-full"
            style={{ 
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              overflow: 'visible',
              pointerEvents: 'none'
            }}
          >
            {/* Definitions */}
            <defs>
              {/* Grid pattern - uses configurable grid size */}
              <pattern id="grid" width={snapSettings.gridSize} height={snapSettings.gridSize} patternUnits="userSpaceOnUse">
                <path 
                  d={`M ${snapSettings.gridSize} 0 L 0 0 0 ${snapSettings.gridSize}`} 
                  fill="none" 
                  stroke="#374151" 
                  strokeWidth="0.5" 
                  opacity={snapSettings.snapToGrid ? "0.5" : "0.3"} 
                />
              </pattern>
              
              {/* Arrow marker - end (default) */}
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
              </marker>
              
              {/* Arrow marker - end (selected) */}
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
              
              {/* Arrow marker - start (default) - points backwards */}
              <marker
                id="arrowhead-start"
                markerWidth="10"
                markerHeight="7"
                refX="1"
                refY="3.5"
                orient="auto"
              >
                <polygon points="10 0, 0 3.5, 10 7" fill="#6b7280" />
              </marker>
              
              {/* Arrow marker - start (selected) */}
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
              
              {/* Arrow marker - creating (green) */}
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
              
              {/* Generate color-specific markers for each transition (normal + hover) */}
              {transitions.map(t => {
                const color = t.line_color || '#6b7280'
                const hoverColor = lightenColor(color, 0.35)
                return (
                  <g key={`markers-${t.id}`}>
                    {/* Normal markers */}
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
                    {/* Hover markers */}
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
            
            {/* Grid background - large enough to feel infinite */}
            <rect 
              width="100000" 
              height="100000" 
              x="-50000" 
              y="-50000" 
              fill="url(#grid)" 
              style={{ pointerEvents: 'none' }}
            />
            
            {/* Alignment guide lines */}
            {alignmentGuides.vertical !== null && (
              <line
                x1={alignmentGuides.vertical}
                y1={-500}
                x2={alignmentGuides.vertical}
                y2={2000}
                stroke="#60a5fa"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.8"
              />
            )}
            {alignmentGuides.horizontal !== null && (
              <line
                x1={-500}
                y1={alignmentGuides.horizontal}
                x2={2000}
                y2={alignmentGuides.horizontal}
                stroke="#60a5fa"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.8"
              />
            )}
            
            {/* Transitions (render first so they're behind states) */}
            {transitions.map(renderTransition)}
            
            {/* Creating transition line */}
            {renderCreatingTransition()}
            
            {/* States */}
            {states.map(renderStateNode)}
            
            {/* Transition handles (rendered last so they appear above everything) */}
            {renderTransitionHandles()}
          </svg>
          
          {/* Empty state */}
          {states.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-plm-fg-muted">
                <GitBranch size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No states defined</p>
                {isAdmin && (
                  <button
                    onClick={addState}
                    className="mt-2 text-plm-accent hover:underline text-sm"
                  >
                    Add your first state
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Context menu for states and transitions */}
      {contextMenu && (
        <WorkflowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          isAdmin={isAdmin}
          targetState={contextMenu.type === 'state' ? states.find(s => s.id === contextMenu.targetId) : undefined}
          targetTransition={contextMenu.type === 'transition' ? transitions.find(t => t.id === contextMenu.targetId) : undefined}
          gates={contextMenu.type === 'transition' ? gates[contextMenu.targetId] || [] : []}
          allStates={states}
          hasWaypoints={contextMenu.type === 'transition' && (waypoints[contextMenu.targetId]?.length || 0) > 0}
          onEdit={() => {
            if (contextMenu.type === 'state') {
              const state = states.find(s => s.id === contextMenu.targetId)
              if (state) {
                setEditingState(state)
                setShowEditState(true)
              }
            } else if (contextMenu.type === 'transition') {
              const transition = transitions.find(t => t.id === contextMenu.targetId)
              if (transition) {
                setEditingTransition(transition)
                setShowEditTransition(true)
              }
            }
            setContextMenu(null)
          }}
          onDelete={() => {
            if (contextMenu.type === 'state') {
              deleteState(contextMenu.targetId)
            } else if (contextMenu.type === 'transition') {
              deleteTransition(contextMenu.targetId)
            }
            setContextMenu(null)
          }}
          onAddGate={() => {
            if (contextMenu.type === 'transition') {
              addTransitionGate(contextMenu.targetId)
            }
            setContextMenu(null)
          }}
          onResetWaypoints={() => {
            if (contextMenu.type === 'transition') {
              setWaypoints(prev => {
                const next = { ...prev }
                delete next[contextMenu.targetId]
                return next
              })
              addToast('info', 'Control points reset')
            }
            setContextMenu(null)
          }}
          onAddState={async () => {
            if (contextMenu.type === 'canvas' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) {
              // Snap position to grid if enabled
              let posX = contextMenu.canvasX
              let posY = contextMenu.canvasY
              if (snapSettings.snapToGrid) {
                posX = Math.round(posX / snapSettings.gridSize) * snapSettings.gridSize
                posY = Math.round(posY / snapSettings.gridSize) * snapSettings.gridSize
              }
              
              const newState: Partial<WorkflowState> = {
                workflow_id: selectedWorkflow?.id,
                name: `State ${states.length + 1}`,
                label: `State ${states.length + 1}`,
                description: '',
                color: '#6B7280',
                icon: 'circle',
                position_x: Math.round(posX),
                position_y: Math.round(posY),
                is_editable: true,
                requires_checkout: true,
                auto_increment_revision: false,
                sort_order: states.length,
              }
              
              try {
                const { data, error } = await supabase
                  .from('workflow_states')
                  .insert(newState)
                  .select()
                  .single()
                
                if (error) throw error
                
                setStates([...states, data])
                setSelectedStateId(data.id)
                setEditingState(data)
                setShowEditState(true)
              } catch (err) {
                console.error('Failed to add state:', err)
                addToast('error', 'Failed to add state')
              }
            }
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
      
      {/* Waypoint context menu (for adding/deleting control points) */}
      {waypointContextMenu && (
        <div
          className="fixed bg-plm-bg-light border border-plm-border rounded-lg shadow-xl z-[100] py-1 min-w-[160px]"
          style={{
            left: waypointContextMenu.x,
            top: waypointContextMenu.y,
            transform: 'translate(-50%, 8px)' // Center horizontally, offset down
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Add control point option (always show when clicking on line) */}
          {waypointContextMenu.waypointIndex === null && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-plm-bg flex items-center gap-2"
              onClick={() => {
                const transition = transitions.find(t => t.id === waypointContextMenu.transitionId)
                if (transition) {
                  const fromState = states.find(s => s.id === transition.from_state_id)
                  const toState = states.find(s => s.id === transition.to_state_id)
                  if (fromState && toState) {
                    const currentWaypoints = waypoints[waypointContextMenu.transitionId] || []
                    const insertIndex = findInsertionIndex(
                      currentWaypoints,
                      { x: fromState.position_x, y: fromState.position_y },
                      { x: toState.position_x, y: toState.position_y },
                      { x: waypointContextMenu.canvasX, y: waypointContextMenu.canvasY }
                    )
                    
                    const newWaypoints = [...currentWaypoints]
                    newWaypoints.splice(insertIndex, 0, { 
                      x: waypointContextMenu.canvasX, 
                      y: waypointContextMenu.canvasY 
                    })
                    
                    setWaypoints(prev => ({
                      ...prev,
                      [waypointContextMenu.transitionId]: newWaypoints
                    }))
                    addToast('info', 'Control point added')
                  }
                }
                setWaypointContextMenu(null)
              }}
            >
              <Plus size={14} />
              Add control point
            </button>
          )}
          
          {/* Delete control point option (only show when clicking on existing waypoint) */}
          {waypointContextMenu.waypointIndex !== null && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-plm-bg flex items-center gap-2 text-red-400 hover:text-red-300"
              onClick={() => {
                const idx = waypointContextMenu.waypointIndex
                if (idx !== null) {
                  setWaypoints(prev => {
                    const currentWaypoints = [...(prev[waypointContextMenu.transitionId] || [])]
                    currentWaypoints.splice(idx, 1)
                    if (currentWaypoints.length === 0) {
                      const next = { ...prev }
                      delete next[waypointContextMenu.transitionId]
                      return next
                    }
                    return { ...prev, [waypointContextMenu.transitionId]: currentWaypoints }
                  })
                  addToast('info', 'Control point removed')
                }
                setWaypointContextMenu(null)
              }}
            >
              <Trash2 size={14} />
              Delete control point
            </button>
          )}
        </div>
      )}
      
      {/* Floating toolbar */}
      {floatingToolbar && (() => {
        // Compute screen position from canvas coordinates (updates with pan/zoom)
        const rect = canvasRef.current?.getBoundingClientRect()
        const screenX = rect ? rect.left + pan.x + floatingToolbar.canvasX * zoom : 0
        // Position above the element with a gap (50px in screen space)
        const screenY = rect ? rect.top + pan.y + floatingToolbar.canvasY * zoom - 50 : 0
        return (
        <FloatingToolbar
          x={screenX}
          y={screenY}
          type={floatingToolbar.type}
          isAdmin={isAdmin}
          targetState={floatingToolbar.type === 'state' ? states.find(s => s.id === floatingToolbar.targetId) : undefined}
          targetTransition={floatingToolbar.type === 'transition' ? transitions.find(t => t.id === floatingToolbar.targetId) : undefined}
          onColorChange={async (color: string) => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ color })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, color } : s
                ))
              } catch (err) {
                console.error('Failed to update state color:', err)
              }
            } else {
              try {
                await supabase
                  .from('workflow_transitions')
                  .update({ line_color: color })
                  .eq('id', floatingToolbar.targetId)
                setTransitions(transitions.map(t => 
                  t.id === floatingToolbar.targetId ? { ...t, line_color: color } : t
                ))
              } catch (err) {
                console.error('Failed to update transition color:', err)
              }
            }
          }}
          onLineStyleChange={async (style: TransitionLineStyle) => {
            if (floatingToolbar.type === 'transition') {
              try {
                await supabase
                  .from('workflow_transitions')
                  .update({ line_style: style })
                  .eq('id', floatingToolbar.targetId)
                setTransitions(transitions.map(t => 
                  t.id === floatingToolbar.targetId ? { ...t, line_style: style } : t
                ))
              } catch (err) {
                console.error('Failed to update line style:', err)
              }
            }
          }}
          onPathTypeChange={async (pathType: TransitionPathType) => {
            if (floatingToolbar.type === 'transition') {
              try {
                await supabase
                  .from('workflow_transitions')
                  .update({ line_path_type: pathType })
                  .eq('id', floatingToolbar.targetId)
                setTransitions(transitions.map(t => 
                  t.id === floatingToolbar.targetId ? { ...t, line_path_type: pathType } : t
                ))
                // When switching TO spline or elbow, ensure there's at least one waypoint for control
                if (pathType === 'spline' || pathType === 'elbow') {
                  const existingWaypoints = waypoints[floatingToolbar.targetId]
                  if (!existingWaypoints || existingWaypoints.length === 0) {
                    // Create a default waypoint at the midpoint
                    const transition = transitions.find(t => t.id === floatingToolbar.targetId)
                    if (transition) {
                      const fromState = states.find(s => s.id === transition.from_state_id)
                      const toState = states.find(s => s.id === transition.to_state_id)
                      if (fromState && toState) {
                        const midX = (fromState.position_x + toState.position_x) / 2
                        // For spline, offset up for curve; for elbow, stay at midpoint
                        const midY = pathType === 'spline' 
                          ? (fromState.position_y + toState.position_y) / 2 - 40 
                          : (fromState.position_y + toState.position_y) / 2
                        setWaypoints(prev => ({
                          ...prev,
                          [floatingToolbar.targetId]: [{ x: midX, y: midY }]
                        }))
                      }
                    }
                  }
                }
                // Note: We preserve waypoints when switching between modes
                // so user can switch back and still have their adjustments
              } catch (err) {
                console.error('Failed to update path type:', err)
              }
            }
          }}
          onArrowHeadChange={async (arrowHead: TransitionArrowHead) => {
            if (floatingToolbar.type === 'transition') {
              try {
                await supabase
                  .from('workflow_transitions')
                  .update({ line_arrow_head: arrowHead })
                  .eq('id', floatingToolbar.targetId)
                setTransitions(transitions.map(t => 
                  t.id === floatingToolbar.targetId ? { ...t, line_arrow_head: arrowHead } : t
                ))
              } catch (err) {
                console.error('Failed to update arrow head:', err)
              }
            }
          }}
          onThicknessChange={async (thickness: TransitionLineThickness) => {
            if (floatingToolbar.type === 'transition') {
              try {
                await supabase
                  .from('workflow_transitions')
                  .update({ line_thickness: thickness })
                  .eq('id', floatingToolbar.targetId)
                setTransitions(transitions.map(t => 
                  t.id === floatingToolbar.targetId ? { ...t, line_thickness: thickness } : t
                ))
              } catch (err) {
                console.error('Failed to update thickness:', err)
              }
            }
          }}
          onFillOpacityChange={async (opacity: number) => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ fill_opacity: opacity })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, fill_opacity: opacity } : s
                ))
              } catch (err) {
                console.error('Failed to update fill opacity:', err)
              }
            }
          }}
          onBorderColorChange={async (color: string | null) => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ border_color: color })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, border_color: color } : s
                ))
              } catch (err) {
                console.error('Failed to update border color:', err)
              }
            }
          }}
          onBorderOpacityChange={async (opacity: number) => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ border_opacity: opacity })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, border_opacity: opacity } : s
                ))
              } catch (err) {
                console.error('Failed to update border opacity:', err)
              }
            }
          }}
          onBorderThicknessChange={async (thickness: number) => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ border_thickness: thickness })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, border_thickness: thickness } : s
                ))
              } catch (err) {
                console.error('Failed to update border thickness:', err)
              }
            }
          }}
          onCornerRadiusChange={async (radius: number) => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ corner_radius: radius })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, corner_radius: radius } : s
                ))
              } catch (err) {
                console.error('Failed to update corner radius:', err)
              }
            }
          }}
          onShapeChange={async (shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse') => {
            if (floatingToolbar.type === 'state') {
              try {
                await supabase
                  .from('workflow_states')
                  .update({ shape })
                  .eq('id', floatingToolbar.targetId)
                setStates(states.map(s => 
                  s.id === floatingToolbar.targetId ? { ...s, shape } : s
                ))
              } catch (err) {
                console.error('Failed to update shape:', err)
              }
            }
          }}
          onEdit={() => {
            if (floatingToolbar.type === 'state') {
              const state = states.find(s => s.id === floatingToolbar.targetId)
              if (state) {
                setEditingState(state)
                setShowEditState(true)
              }
            } else {
              const transition = transitions.find(t => t.id === floatingToolbar.targetId)
              if (transition) {
                setEditingTransition(transition)
                setShowEditTransition(true)
              }
            }
            setFloatingToolbar(null)
          }}
          onDuplicate={() => {
            if (floatingToolbar.type === 'state') {
              const state = states.find(s => s.id === floatingToolbar.targetId)
              if (state) {
                // Create duplicate state at offset position
                const newState: Partial<WorkflowState> = {
                  workflow_id: state.workflow_id,
                  name: state.name + ' (copy)',
                  label: (state.label || state.name) + ' (copy)',
                  description: state.description,
                  color: state.color,
                  icon: state.icon,
                  position_x: state.position_x + 40,
                  position_y: state.position_y + 40,
                  is_editable: state.is_editable,
                  requires_checkout: state.requires_checkout,
                  auto_increment_revision: state.auto_increment_revision,
                  sort_order: states.length,
                }
                supabase
                  .from('workflow_states')
                  .insert(newState)
                  .select()
                  .single()
                  .then(({ data, error }) => {
                    if (!error && data) {
                      setStates([...states, data])
                      addToast('success', 'State duplicated')
                    }
                  })
              }
            }
            setFloatingToolbar(null)
          }}
          onDelete={() => {
            if (floatingToolbar.type === 'state') {
              deleteState(floatingToolbar.targetId)
            } else {
              deleteTransition(floatingToolbar.targetId)
            }
            setFloatingToolbar(null)
          }}
          onAddGate={() => {
            if (floatingToolbar.type === 'transition') {
              addTransitionGate(floatingToolbar.targetId)
            }
            setFloatingToolbar(null)
          }}
          onClose={() => setFloatingToolbar(null)}
        />
        )
      })()}
      
      {/* No workflow selected */}
      {!selectedWorkflow && workflows.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-plm-fg-muted">
            <GitBranch size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm mb-2">No workflows defined</p>
            {isAdmin && (
              <button
                onClick={() => setShowCreateWorkflow(true)}
                className="text-plm-accent hover:underline text-sm"
              >
                Create your first workflow
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Create workflow dialog */}
      {showCreateWorkflow && (
        <CreateWorkflowDialog
          onClose={() => setShowCreateWorkflow(false)}
          onCreate={createWorkflow}
        />
      )}
      
      {/* Edit workflow dialog */}
      {showEditWorkflow && selectedWorkflow && (
        <EditWorkflowDialog
          workflow={selectedWorkflow}
          onClose={() => setShowEditWorkflow(false)}
          onSave={async (name, description) => {
            try {
              const { error } = await supabase
                .from('workflow_templates')
                .update({ name, description })
                .eq('id', selectedWorkflow.id)
              
              if (error) throw error
              
              // Update local state
              setWorkflows(workflows.map(w => 
                w.id === selectedWorkflow.id 
                  ? { ...w, name, description } 
                  : w
              ))
              setSelectedWorkflow({ ...selectedWorkflow, name, description })
              setShowEditWorkflow(false)
              addToast('success', 'Workflow updated')
            } catch (err) {
              console.error('Failed to update workflow:', err)
              addToast('error', 'Failed to update workflow')
            }
          }}
          onDelete={async () => {
            if (!window.confirm(`Delete "${selectedWorkflow.name}"? This will delete all states and transitions.`)) {
              return
            }
            try {
              const { error } = await supabase
                .from('workflow_templates')
                .delete()
                .eq('id', selectedWorkflow.id)
              
              if (error) throw error
              
              setWorkflows(workflows.filter(w => w.id !== selectedWorkflow.id))
              setSelectedWorkflow(null)
              setStates([])
              setTransitions([])
              setShowEditWorkflow(false)
              addToast('success', 'Workflow deleted')
            } catch (err) {
              console.error('Failed to delete workflow:', err)
              addToast('error', 'Failed to delete workflow')
            }
          }}
        />
      )}
      
      {/* Edit state dialog */}
      {showEditState && editingState && (
        <EditStateDialog
          state={editingState}
          onClose={() => {
            setShowEditState(false)
            setEditingState(null)
          }}
          onSave={async (updates) => {
            try {
              await supabase
                .from('workflow_states')
                .update(updates)
                .eq('id', editingState.id)
              
              setStates(states.map(s => 
                s.id === editingState.id ? { ...s, ...updates } : s
              ))
              setShowEditState(false)
              setEditingState(null)
              addToast('success', 'State updated')
            } catch (err) {
              console.error('Failed to update state:', err)
              addToast('error', 'Failed to update state')
            }
          }}
        />
      )}
      
      {/* Edit transition dialog */}
      {showEditTransition && editingTransition && (
        <EditTransitionDialog
          transition={editingTransition}
          onClose={() => {
            setShowEditTransition(false)
            setEditingTransition(null)
          }}
          onSave={async (updates) => {
            try {
              await supabase
                .from('workflow_transitions')
                .update(updates)
                .eq('id', editingTransition.id)
              
              setTransitions(transitions.map(t => 
                t.id === editingTransition.id ? { ...t, ...updates } : t
              ))
              setShowEditTransition(false)
              setEditingTransition(null)
              addToast('success', 'Transition updated')
            } catch (err) {
              console.error('Failed to update transition:', err)
              addToast('error', 'Failed to update transition')
            }
          }}
        />
      )}
    </div>
  )
}

// ============================================
// Sub-components
// ============================================

interface WorkflowContextMenuProps {
  x: number
  y: number
  type: 'state' | 'transition' | 'canvas'
  isAdmin: boolean
  targetState?: WorkflowState
  targetTransition?: WorkflowTransition
  gates: WorkflowGate[]
  allStates: WorkflowState[]
  hasWaypoints?: boolean
  onEdit: () => void
  onDelete: () => void
  onAddGate: () => void
  onResetWaypoints?: () => void
  onAddState?: () => void
  onClose: () => void
}

function WorkflowContextMenu({ 
  x, 
  y, 
  type, 
  isAdmin, 
  targetState, 
  targetTransition,
  gates,
  allStates,
  hasWaypoints,
  onEdit, 
  onDelete, 
  onAddGate,
  onResetWaypoints,
  onAddState,
  onClose 
}: WorkflowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    // Close on escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])
  
  // Adjust position to keep menu on screen
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)
  
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let newX = x
      let newY = y
      
      if (x + rect.width > window.innerWidth) {
        newX = window.innerWidth - rect.width - 8
      }
      if (y + rect.height > window.innerHeight) {
        newY = window.innerHeight - rect.height - 8
      }
      
      setAdjustedPos({ x: newX, y: newY })
    }
  }, [x, y])
  
  const fromState = targetTransition ? allStates.find(s => s.id === targetTransition.from_state_id) : null
  const toState = targetTransition ? allStates.find(s => s.id === targetTransition.to_state_id) : null
  
  return (
    <div
      ref={menuRef}
      className={`fixed bg-plm-sidebar border border-plm-border rounded-lg shadow-xl py-1 min-w-[200px] z-50 transition-opacity duration-75 ${
        adjustedPos ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: adjustedPos?.x ?? x, top: adjustedPos?.y ?? y }}
    >
      {/* Header showing what's selected (hidden for canvas) */}
      {type !== 'canvas' && (
        <div className="px-3 py-2 border-b border-plm-border">
          {type === 'state' && targetState && (
            <div className="flex items-center gap-2">
              <div 
                className="w-4 h-4 rounded flex items-center justify-center"
                style={{ backgroundColor: targetState.color }}
              />
              <span className="text-sm font-medium">{targetState.label || targetState.name}</span>
              <span className="text-xs text-plm-fg-muted">({targetState.is_editable ? 'Editable' : 'Locked'})</span>
            </div>
          )}
          {type === 'transition' && targetTransition && (
            <div>
              <div className="text-sm font-medium mb-1">{targetTransition.name || 'Unnamed transition'}</div>
              <div className="flex items-center gap-1.5 text-xs text-plm-fg-muted">
                <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: (fromState?.color || '#666') + '40' }}>
                  {fromState?.name || '?'}
                </span>
                <ArrowRight size={10} />
                <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: (toState?.color || '#666') + '40' }}>
                  {toState?.name || '?'}
                </span>
              </div>
              {gates.length > 0 && (
                <div className="mt-1 text-xs text-amber-400">
                  {gates.length} gate{gates.length > 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Menu items */}
      <div className="py-1">
        {type === 'canvas' && isAdmin && onAddState && (
          <button
            onClick={onAddState}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors"
          >
            <Plus size={14} />
            New State
          </button>
        )}
        
        {type !== 'canvas' && (
          <button
            onClick={onEdit}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors"
          >
            <Edit3 size={14} />
            Edit {type === 'state' ? 'State' : 'Transition'}...
          </button>
        )}
        
        {type === 'transition' && isAdmin && hasWaypoints && onResetWaypoints && (
          <button
            onClick={onResetWaypoints}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-highlight transition-colors text-plm-fg-muted"
          >
            <X size={14} />
            Reset Control Points
          </button>
        )}
        
        {isAdmin && type !== 'canvas' && (
          <>
            <div className="my-1 border-t border-plm-border" />
            <button
              onClick={onDelete}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-plm-error/20 text-plm-error transition-colors"
            >
              <Trash2 size={14} />
              Delete {type === 'state' ? 'State' : 'Transition'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================
// Tick Slider Component
// ============================================

interface TickSliderProps {
  value: number
  min: number
  max: number
  step: number
  snapPoints: number[]
  onChange: (value: number) => void
}

function TickSlider({ value, min, max, step, snapPoints, onChange }: TickSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  
  // Calculate position percentage
  const getPercent = (val: number) => ((val - min) / (max - min)) * 100
  
  // Snap to nearest point if within threshold
  const snapThreshold = ((max - min) / snapPoints.length) * 0.3
  const getSnappedValue = (val: number) => {
    for (const point of snapPoints) {
      if (Math.abs(val - point) <= snapThreshold) {
        return point
      }
    }
    return val
  }
  
  const handleMove = (clientX: number) => {
    if (!sliderRef.current) return
    const rect = sliderRef.current.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const rawValue = min + percent * (max - min)
    const snappedValue = getSnappedValue(rawValue)
    const steppedValue = Math.round(snappedValue / step) * step
    const clampedValue = Math.max(min, Math.min(max, steppedValue))
    onChange(clampedValue)
  }
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    handleMove(e.clientX)
  }
  
  useEffect(() => {
    if (!isDragging) return
    
    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX)
    }
    
    const handleMouseUp = () => {
      setIsDragging(false)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])
  
  return (
    <div 
      ref={sliderRef}
      className="relative h-6 cursor-pointer select-none"
      onMouseDown={handleMouseDown}
    >
      {/* Track background */}
      <div className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 bg-plm-border rounded-full" />
      
      {/* Filled track */}
      <div 
        className="absolute top-1/2 left-0 h-1 -translate-y-1/2 bg-plm-accent rounded-full"
        style={{ width: `${getPercent(value)}%` }}
      />
      
      {/* Tick marks */}
      {snapPoints.map((point) => {
        const percent = getPercent(point)
        const isActive = value >= point
        const isAtValue = Math.abs(value - point) < step
        return (
          <div
            key={point}
            className={`absolute top-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
              isAtValue ? 'bg-plm-fg scale-125' : isActive ? 'bg-plm-accent' : 'bg-plm-fg-muted/40'
            }`}
            style={{ left: `${percent}%` }}
          />
        )
      })}
      
      {/* Thumb */}
      <div
        className={`absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 bg-plm-fg rounded-full shadow-lg border-2 border-plm-accent transition-transform ${
          isDragging ? 'scale-125' : 'hover:scale-110'
        }`}
        style={{ left: `${getPercent(value)}%` }}
      />
    </div>
  )
}

// ============================================
// Floating Toolbar
// ============================================

// Color palette for toolbar - expanded with more organized colors
const TOOLBAR_COLORS = [
  // Row 1: Reds to Yellows
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  // Row 2: Greens
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  // Row 3: Blues
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  // Row 4: Purples to Pinks
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  // Row 5: Neutrals
  '#f5f5f4', '#a8a29e', '#6b7280', '#1f2937',
]

// LocalStorage key for saved colors
const SAVED_COLORS_KEY = 'blueplm_workflow_saved_colors'

// Get saved colors from localStorage
function getSavedColors(): string[] {
  try {
    const saved = localStorage.getItem(SAVED_COLORS_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

// Save colors to localStorage
function setSavedColors(colors: string[]): void {
  try {
    localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(colors.slice(0, 12))) // Max 12 saved colors
  } catch {
    // Ignore storage errors
  }
}

interface FloatingToolbarProps {
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
  // State-specific styling
  onFillOpacityChange?: (opacity: number) => void
  onBorderColorChange?: (color: string | null) => void
  onBorderOpacityChange?: (opacity: number) => void
  onBorderThicknessChange?: (thickness: number) => void
  onCornerRadiusChange?: (radius: number) => void
  onShapeChange?: (shape: 'rectangle' | 'diamond' | 'hexagon' | 'ellipse') => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAddGate?: () => void
  onClose: () => void
}

function FloatingToolbar({
  x,
  y,
  type,
  isAdmin,
  targetState,
  targetTransition,
  onColorChange,
  onLineStyleChange,
  onPathTypeChange,
  onArrowHeadChange,
  onThicknessChange,
  onFillOpacityChange,
  onBorderColorChange,
  onBorderOpacityChange,
  onBorderThicknessChange,
  onCornerRadiusChange,
  onShapeChange,
  onEdit,
  onDuplicate,
  onDelete,
  onAddGate,
  onClose
}: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showBorderColorPicker, setShowBorderColorPicker] = useState(false)
  const [showPathTypes, setShowPathTypes] = useState(false)
  const [showArrowHeads, setShowArrowHeads] = useState(false)
  const [showThickness, setShowThickness] = useState(false)
  const [showBoxStyles, setShowBoxStyles] = useState(false)
  const [showShapePicker, setShowShapePicker] = useState(false)
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)
  const [savedColors, setSavedColorsState] = useState<string[]>(getSavedColors)
  const [customColor, setCustomColor] = useState('#6b7280')
  const [customBorderColor, setCustomBorderColor] = useState('#6b7280')
  
  // Close all dropdowns
  const closeAllDropdowns = () => {
    setShowColorPicker(false)
    setShowBorderColorPicker(false)
    setShowPathTypes(false)
    setShowArrowHeads(false)
    setShowThickness(false)
    setShowBoxStyles(false)
    setShowShapePicker(false)
  }
  
  // Save a color to saved colors
  const saveColor = (color: string) => {
    const newSaved = [color, ...savedColors.filter(c => c !== color)].slice(0, 12)
    setSavedColorsState(newSaved)
    setSavedColors(newSaved)
  }
  
  // Remove a color from saved colors
  const removeSavedColor = (color: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newSaved = savedColors.filter(c => c !== color)
    setSavedColorsState(newSaved)
    setSavedColors(newSaved)
  }
  
  // Current color
  const currentColor = type === 'state' 
    ? targetState?.color || '#6b7280'
    : targetTransition?.line_color || '#6b7280'
  
  // State styling values
  const currentFillOpacity = targetState?.fill_opacity ?? 1
  const currentBorderColor = targetState?.border_color || null
  const currentBorderOpacity = targetState?.border_opacity ?? 1
  const currentStateBorderThickness = targetState?.border_thickness ?? 2
  const currentCornerRadius = targetState?.corner_radius ?? 8
  
  // Current line style
  const currentLineStyle = targetTransition?.line_style || 'solid'
  const currentPathType = targetTransition?.line_path_type || 'spline'
  const currentArrowHead = targetTransition?.line_arrow_head || 'end'
  const currentThickness = targetTransition?.line_thickness || 2
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])
  
  // Adjust position to keep toolbar on screen
  useEffect(() => {
    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect()
      let newX = x - rect.width / 2 // Center horizontally
      let newY = y
      
      // Keep on screen
      if (newX + rect.width > window.innerWidth) {
        newX = window.innerWidth - rect.width - 8
      }
      if (newX < 8) newX = 8
      if (newY < 8) newY = 8
      if (newY + rect.height > window.innerHeight) {
        newY = window.innerHeight - rect.height - 8
      }
      
      setAdjustedPos({ x: newX, y: newY })
    }
  }, [x, y])
  
  return (
    <div
      ref={toolbarRef}
      className={`fixed z-50 flex flex-col items-center gap-1 transition-opacity duration-75 ${
        adjustedPos ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: adjustedPos?.x ?? x, top: adjustedPos?.y ?? y }}
    >
      {/* Main horizontal toolbar */}
      <div className="flex items-center gap-0.5 bg-plm-sidebar rounded-lg shadow-2xl border border-plm-border p-1">
        {/* Color button */}
        <div className="relative">
          <button
            onClick={() => {
              closeAllDropdowns()
              setShowColorPicker(!showColorPicker)
              setCustomColor(currentColor)
            }}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
            title={type === 'state' ? 'Fill color' : 'Line color'}
          >
            <div 
              className="w-5 h-5 rounded border-2 border-plm-fg/30"
              style={{ backgroundColor: currentColor }}
            />
          </button>
          
          {/* Enhanced color picker dropdown */}
          {showColorPicker && (
            <div 
              className="absolute top-full left-0 mt-1 p-2 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border z-50"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Preset colors - dense grid */}
              <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Colors</div>
              <div className="grid grid-cols-5 gap-1.5 mb-3">
                {TOOLBAR_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      onColorChange(color)
                      closeAllDropdowns()
                    }}
                    className={`w-5 h-5 rounded transition-transform hover:scale-105 ${
                      currentColor === color ? 'ring-2 ring-plm-fg ring-offset-1 ring-offset-plm-sidebar' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              
              {/* Saved colors */}
              {savedColors.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Saved</div>
                  <div className="grid grid-cols-5 gap-1.5 mb-3">
                    {savedColors.map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          onColorChange(color)
                          closeAllDropdowns()
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          removeSavedColor(color, e)
                        }}
                        className={`relative w-5 h-5 rounded transition-transform hover:scale-105 group ${
                          currentColor === color ? 'ring-2 ring-plm-fg ring-offset-1 ring-offset-plm-sidebar' : ''
                        }`}
                        style={{ backgroundColor: color }}
                        title="Right-click to remove"
                      >
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-[8px] text-white opacity-0 group-hover:opacity-100 flex items-center justify-center">×</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              
              {/* Custom color */}
              <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-1.5">Custom</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border border-plm-border bg-transparent"
                />
                <input
                  type="text"
                  value={customColor}
                  onChange={(e) => {
                    const val = e.target.value
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                      setCustomColor(val)
                    }
                  }}
                  className="flex-1 px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded font-mono text-plm-fg"
                  placeholder="#000000"
                />
                <button
                  onClick={() => {
                    onColorChange(customColor)
                    closeAllDropdowns()
                  }}
                  className="px-2 py-1 text-xs bg-plm-accent text-white rounded hover:bg-plm-accent/80 transition-colors"
                >
                  Apply
                </button>
              </div>
              
              {/* Save color button */}
              <button
                onClick={() => saveColor(customColor)}
                className="mt-1.5 w-full px-2 py-1 text-xs text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded flex items-center justify-center gap-1 transition-colors"
              >
                <Plus size={12} />
                Save color
              </button>
            </div>
          )}
        </div>
        
        {/* Transition-specific options */}
        {type === 'transition' && (
          <>
            {/* Divider */}
            <div className="w-px h-5 bg-plm-border mx-0.5" />
            
            {/* Path type (straight/spline/elbow) */}
            {onPathTypeChange && (
              <div className="relative">
                <button
                  onClick={() => {
                    closeAllDropdowns()
                    setShowPathTypes(!showPathTypes)
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
                  title="Line path type"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
                    {currentPathType === 'straight' && (
                      <line x1="2" y1="14" x2="16" y2="4" stroke="currentColor" strokeWidth="2" />
                    )}
                    {currentPathType === 'spline' && (
                      <path d="M2 14 Q9 2 16 8" fill="none" stroke="currentColor" strokeWidth="2" />
                    )}
                    {currentPathType === 'elbow' && (
                      <path d="M2 14 L2 9 L16 9 L16 4" fill="none" stroke="currentColor" strokeWidth="2" />
                    )}
                  </svg>
                </button>
                
                {showPathTypes && (
                  <div className="absolute top-full left-0 mt-1 p-1 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border flex flex-col gap-0.5 min-w-[130px]">
                    {(['straight', 'spline', 'elbow'] as TransitionPathType[]).map((pathType) => (
                      <button
                        key={pathType}
                        onClick={() => {
                          onPathTypeChange(pathType)
                          closeAllDropdowns()
                        }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm hover:bg-plm-highlight transition-colors ${
                          currentPathType === pathType ? 'bg-plm-highlight text-plm-fg' : 'text-plm-fg-muted'
                        }`}
                      >
                        <svg width="24" height="16" viewBox="0 0 24 16">
                          {pathType === 'straight' && (
                            <line x1="2" y1="12" x2="22" y2="4" stroke="currentColor" strokeWidth="2" />
                          )}
                          {pathType === 'spline' && (
                            <path d="M2 12 Q12 0 22 8" fill="none" stroke="currentColor" strokeWidth="2" />
                          )}
                          {pathType === 'elbow' && (
                            <path d="M2 12 L2 8 L22 8 L22 4" fill="none" stroke="currentColor" strokeWidth="2" />
                          )}
                        </svg>
                        <span className="capitalize">{pathType}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Line settings (thickness + style) */}
            {onThicknessChange && (
              <div className="relative">
                <button
                  onClick={() => {
                    closeAllDropdowns()
                    setShowThickness(!showThickness)
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
                  title="Line settings"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
                    <line 
                      x1="2" y1="9" x2="16" y2="9" 
                      stroke="currentColor" 
                      strokeWidth={currentThickness}
                      strokeDasharray={currentLineStyle === 'dashed' ? '4,2' : currentLineStyle === 'dotted' ? '1,3' : 'none'}
                      strokeLinecap={currentLineStyle === 'dotted' ? 'round' : 'butt'}
                    />
                  </svg>
                </button>
                
                {showThickness && (
                  <div 
                    className="absolute top-full left-0 mt-1 p-3 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border min-w-[180px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Thickness slider */}
                    <div className="mb-4">
                      <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2 flex items-center justify-between">
                        <span>Thickness</span>
                        <span className="text-plm-fg-muted">{currentThickness}px</span>
                      </div>
                      <TickSlider
                        value={currentThickness}
                        min={1}
                        max={6}
                        step={1}
                        snapPoints={[1, 2, 3, 4, 5, 6]}
                        onChange={(val) => onThicknessChange(val as TransitionLineThickness)}
                      />
                    </div>
                    
                    {/* Line style */}
                    {onLineStyleChange && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Style</div>
                        <div className="flex gap-1">
                          {(['solid', 'dashed', 'dotted'] as TransitionLineStyle[]).map((style) => (
                            <button
                              key={style}
                              onClick={() => onLineStyleChange(style)}
                              className={`flex-1 py-2 rounded flex items-center justify-center transition-colors ${
                                currentLineStyle === style 
                                  ? 'bg-plm-highlight' 
                                  : 'bg-plm-bg hover:bg-plm-highlight'
                              }`}
                              title={style}
                            >
                              <svg width="32" height="8" viewBox="0 0 32 8" className="text-plm-fg">
                                <line 
                                  x1="2" y1="4" x2="30" y2="4" 
                                  stroke="currentColor" 
                                  strokeWidth="2"
                                  strokeDasharray={style === 'dashed' ? '6,3' : style === 'dotted' ? '2,4' : 'none'}
                                  strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
                                />
                              </svg>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Arrow direction - visual toggle buttons */}
            {onArrowHeadChange && (
              <div className="relative">
                <button
                  onClick={() => {
                    closeAllDropdowns()
                    setShowArrowHeads(!showArrowHeads)
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
                  title="Arrow direction"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
                    <defs>
                      <marker id="toolbar-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <polygon points="0 0, 6 3, 0 6" fill="currentColor" />
                      </marker>
                    </defs>
                    {currentArrowHead === 'end' && (
                      <line x1="2" y1="9" x2="14" y2="9" stroke="currentColor" strokeWidth="2" markerEnd="url(#toolbar-arrow)" />
                    )}
                    {currentArrowHead === 'start' && (
                      <line x1="16" y1="9" x2="4" y2="9" stroke="currentColor" strokeWidth="2" markerEnd="url(#toolbar-arrow)" />
                    )}
                    {currentArrowHead === 'both' && (
                      <>
                        <line x1="5" y1="9" x2="13" y2="9" stroke="currentColor" strokeWidth="2" />
                        <polygon points="2,9 6,6 6,12" fill="currentColor" />
                        <polygon points="16,9 12,6 12,12" fill="currentColor" />
                      </>
                    )}
                    {currentArrowHead === 'none' && (
                      <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="2" />
                    )}
                  </svg>
                </button>
                
                {showArrowHeads && (
                  <div 
                    className="absolute top-full right-0 mt-1 p-2 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Arrow</div>
                    <div className="flex gap-1">
                      {([
                        { value: 'end' as TransitionArrowHead, tooltip: 'Arrow at end' },
                        { value: 'start' as TransitionArrowHead, tooltip: 'Arrow at start' },
                        { value: 'both' as TransitionArrowHead, tooltip: 'Arrows at both ends' },
                        { value: 'none' as TransitionArrowHead, tooltip: 'No arrows' }
                      ]).map(({ value, tooltip }) => (
                        <button
                          key={value}
                          onClick={() => onArrowHeadChange(value)}
                          className={`w-10 h-8 rounded flex items-center justify-center transition-colors ${
                            currentArrowHead === value 
                              ? 'bg-plm-highlight' 
                              : 'bg-plm-bg hover:bg-plm-highlight'
                          }`}
                          title={tooltip}
                        >
                          <svg width="28" height="12" viewBox="0 0 28 12" className="text-plm-fg">
                            {value === 'end' && (
                              <>
                                <line x1="2" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" />
                                <polygon points="26,6 20,2 20,10" fill="currentColor" />
                              </>
                            )}
                            {value === 'start' && (
                              <>
                                <line x1="8" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="2" />
                                <polygon points="2,6 8,2 8,10" fill="currentColor" />
                              </>
                            )}
                            {value === 'both' && (
                              <>
                                <line x1="8" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" />
                                <polygon points="2,6 8,2 8,10" fill="currentColor" />
                                <polygon points="26,6 20,2 20,10" fill="currentColor" />
                              </>
                            )}
                            {value === 'none' && (
                              <line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="2" />
                            )}
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Divider */}
            <div className="w-px h-5 bg-plm-border mx-0.5" />
          </>
        )}
        
        {/* State-specific box styling options */}
        {type === 'state' && (
          <>
            {/* Divider */}
            <div className="w-px h-5 bg-plm-border mx-0.5" />
            
            {/* Box styling button */}
            <div className="relative">
              <button
                onClick={() => {
                  closeAllDropdowns()
                  setShowBoxStyles(!showBoxStyles)
                  setCustomBorderColor(currentBorderColor || currentColor)
                }}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors"
                title="Box styling"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" className="text-plm-fg-muted">
                  <rect x="2" y="2" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              
              {/* Box styling dropdown */}
              {showBoxStyles && (
                <div 
                  className="absolute top-full left-0 mt-1 p-3 bg-plm-sidebar rounded-lg shadow-xl border border-plm-border z-50 w-[200px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Fill Color */}
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Fill Color</div>
                    <div className="grid grid-cols-7 gap-1">
                      {/* No fill button */}
                      <button
                        onClick={() => onFillOpacityChange?.(0)}
                        className={`w-5 h-5 rounded flex items-center justify-center transition-colors border ${
                          currentFillOpacity === 0 
                            ? 'border-plm-fg bg-plm-bg' 
                            : 'border-plm-border bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title="No fill"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" className="text-plm-fg-muted">
                          <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" />
                          <rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                        </svg>
                      </button>
                      {/* Color presets */}
                      {TOOLBAR_COLORS.slice(0, 13).map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            onColorChange(color)
                            if (currentFillOpacity === 0) onFillOpacityChange?.(1)
                          }}
                          className={`w-5 h-5 rounded transition-transform hover:scale-105 ${
                            currentColor === color && currentFillOpacity > 0 ? 'ring-2 ring-plm-fg ring-offset-1 ring-offset-plm-sidebar' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  
                  {/* Fill Opacity */}
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2 flex items-center justify-between">
                      <span>Fill Opacity</span>
                      <span className="text-plm-fg-muted">{Math.round(currentFillOpacity * 100)}%</span>
                    </div>
                    <TickSlider
                      value={currentFillOpacity * 100}
                      min={0}
                      max={100}
                      step={1}
                      snapPoints={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                      onChange={(val) => onFillOpacityChange?.(val / 100)}
                    />
                  </div>
                  
                  {/* Border Color */}
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Border Color</div>
                    <div className="grid grid-cols-7 gap-1">
                      {/* No border / same as fill button */}
                      <button
                        onClick={() => {
                          onBorderColorChange?.(null)
                          setShowBorderColorPicker(false)
                        }}
                        className={`w-5 h-5 rounded flex items-center justify-center transition-colors border ${
                          currentBorderColor === null 
                            ? 'border-plm-fg bg-plm-bg' 
                            : 'border-plm-border bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title="Same as fill"
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" className="text-plm-fg-muted">
                          <rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2,2" />
                        </svg>
                      </button>
                      {/* Color presets */}
                      {TOOLBAR_COLORS.slice(0, 13).map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            onBorderColorChange?.(color)
                            setCustomBorderColor(color)
                          }}
                          className={`w-5 h-5 rounded transition-transform hover:scale-105 ${
                            currentBorderColor === color ? 'ring-2 ring-plm-fg ring-offset-1 ring-offset-plm-sidebar' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  
                  {/* Border Opacity */}
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2 flex items-center justify-between">
                      <span>Border Opacity</span>
                      <span className="text-plm-fg-muted">{Math.round(currentBorderOpacity * 100)}%</span>
                    </div>
                    <TickSlider
                      value={currentBorderOpacity * 100}
                      min={0}
                      max={100}
                      step={1}
                      snapPoints={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                      onChange={(val) => onBorderOpacityChange?.(val / 100)}
                    />
                  </div>
                  
                  {/* Border Thickness */}
                  <div className="mb-4">
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2 flex items-center justify-between">
                      <span>Border Thickness</span>
                      <span className="text-plm-fg-muted">{currentStateBorderThickness}px</span>
                    </div>
                    <TickSlider
                      value={currentStateBorderThickness}
                      min={1}
                      max={6}
                      step={1}
                      snapPoints={[1, 2, 3, 4, 5, 6]}
                      onChange={(val) => onBorderThicknessChange?.(val)}
                    />
                  </div>
                  
                  {/* Corner Radius - only for rectangle */}
                  {(targetState?.shape === 'rectangle' || !targetState?.shape) && (
                    <div className="mb-4">
                      <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2 flex items-center justify-between">
                        <span>Corner Radius</span>
                        <span className="text-plm-fg-muted">{currentCornerRadius}px</span>
                      </div>
                      <TickSlider
                        value={currentCornerRadius}
                        min={0}
                        max={24}
                        step={1}
                        snapPoints={[0, 4, 8, 12, 16, 20, 24]}
                        onChange={(val) => onCornerRadiusChange?.(val)}
                      />
                    </div>
                  )}
                  
                  {/* Shape */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-2">Shape</div>
                    <div className="flex gap-1">
                      {/* Rectangle */}
                      <button
                        onClick={() => onShapeChange?.('rectangle')}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-colors border ${
                          (targetState?.shape || 'rectangle') === 'rectangle'
                            ? 'border-plm-fg bg-plm-highlight'
                            : 'border-plm-border bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title="Rectangle"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" className="text-plm-fg">
                          <rect x="2" y="4" width="12" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </button>
                      {/* Diamond */}
                      <button
                        onClick={() => onShapeChange?.('diamond')}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-colors border ${
                          targetState?.shape === 'diamond'
                            ? 'border-plm-fg bg-plm-highlight'
                            : 'border-plm-border bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title="Diamond (for approval gates)"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" className="text-plm-fg">
                          <polygon points="8,2 14,8 8,14 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {/* Hexagon */}
                      <button
                        onClick={() => onShapeChange?.('hexagon')}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-colors border ${
                          targetState?.shape === 'hexagon'
                            ? 'border-plm-fg bg-plm-highlight'
                            : 'border-plm-border bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title="Hexagon"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" className="text-plm-fg">
                          <polygon points="4,2 12,2 15,8 12,14 4,14 1,8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {/* Ellipse */}
                      <button
                        onClick={() => onShapeChange?.('ellipse')}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-colors border ${
                          targetState?.shape === 'ellipse'
                            ? 'border-plm-fg bg-plm-highlight'
                            : 'border-plm-border bg-plm-bg hover:bg-plm-highlight'
                        }`}
                        title="Ellipse"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" className="text-plm-fg">
                          <ellipse cx="8" cy="8" rx="6" ry="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      </button>
                    </div>
                    {targetState?.state_type === 'gate' && (
                      <div className="text-[9px] text-plm-fg-muted mt-1.5">
                        ⛨ This is an approval gate
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Edit button */}
        <button
          onClick={onEdit}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors text-plm-fg-muted hover:text-plm-fg"
          title={`Edit ${type}`}
        >
          <Edit3 size={16} />
        </button>
        
        {/* Duplicate button (states only) */}
        {type === 'state' && isAdmin && (
          <button
            onClick={onDuplicate}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-highlight transition-colors text-plm-fg-muted hover:text-plm-fg"
            title="Duplicate"
          >
            <Copy size={16} />
          </button>
        )}
        
        {/* Gate creation now uses Add Gate button in toolbar - gates are first-class states */}
        
        {/* Divider */}
        <div className="w-px h-5 bg-plm-border mx-0.5" />
        
        {/* More options / Delete */}
        {isAdmin && (
          <button
            onClick={onDelete}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-plm-error/20 transition-colors text-plm-fg-muted hover:text-plm-error"
            title={`Delete ${type}`}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      
      {/* Connection hint arrow pointing down to object */}
      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-plm-border" />
    </div>
  )
}

// ============================================
// Dialog Components
// ============================================

interface CreateWorkflowDialogProps {
  onClose: () => void
  onCreate: (name: string, description: string) => void
}

function CreateWorkflowDialog({ onClose, onCreate }: CreateWorkflowDialogProps) {
  const [name, setName] = useState('New Workflow')
  const [description, setDescription] = useState('')
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-96 p-4">
        <h3 className="font-semibold mb-4">Create Workflow</h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm h-20 resize-none"
              placeholder="Optional description..."
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-plm-bg rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => onCreate(name, description)}
            className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

interface EditWorkflowDialogProps {
  workflow: WorkflowTemplate
  onClose: () => void
  onSave: (name: string, description: string) => void
  onDelete: () => void
}

function EditWorkflowDialog({ workflow, onClose, onSave, onDelete }: EditWorkflowDialogProps) {
  const [name, setName] = useState(workflow.name)
  const [description, setDescription] = useState(workflow.description || '')
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-96 p-4">
        <h3 className="font-semibold mb-4">Edit Workflow</h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm h-20 resize-none"
              placeholder="Optional description..."
            />
          </div>
          
          {workflow.is_default && (
            <p className="text-xs text-plm-fg-muted bg-plm-bg-light rounded p-2">
              This is the default workflow for new files.
            </p>
          )}
        </div>
        
        <div className="flex justify-between mt-4">
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded"
            title="Delete this workflow"
          >
            <Trash2 size={14} className="inline mr-1" />
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm hover:bg-plm-bg rounded"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(name, description)}
              className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
              disabled={!name.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface EditStateDialogProps {
  state: WorkflowState
  onClose: () => void
  onSave: (updates: Partial<WorkflowState>) => void
}

interface WorkflowRoleBasic {
  id: string
  name: string
  color: string
  icon: string
}

function EditStateDialog({ state, onClose, onSave }: EditStateDialogProps) {
  const { organization } = usePDMStore()
  const [name, setName] = useState(state.name)
  const [label, setLabel] = useState(state.label || '')
  const [description, setDescription] = useState(state.description || '')
  const [color, setColor] = useState(state.color)
  const [icon, setIcon] = useState(state.icon)
  const [isEditable, setIsEditable] = useState(state.is_editable)
  // requires_checkout is now auto-set to match is_editable (simplified UX)
  const [autoRev, setAutoRev] = useState(state.auto_increment_revision)
  const [requiredRoles, setRequiredRoles] = useState<string[]>(state.required_workflow_roles || [])
  
  // Load workflow roles
  const [workflowRoles, setWorkflowRoles] = useState<WorkflowRoleBasic[]>([])
  const [loadingRoles, setLoadingRoles] = useState(true)
  
  useEffect(() => {
    const loadRoles = async () => {
      if (!organization) return
      try {
        const { data, error } = await supabase
          .from('workflow_roles')
          .select('id, name, color, icon')
          .eq('org_id', organization.id)
          .eq('is_active', true)
          .order('sort_order')
          .order('name')
        
        if (!error && data) {
          setWorkflowRoles(data)
        }
      } catch (err) {
        console.error('Failed to load workflow roles:', err)
      } finally {
        setLoadingRoles(false)
      }
    }
    loadRoles()
  }, [organization])
  
  const toggleRequiredRole = (roleId: string) => {
    if (requiredRoles.includes(roleId)) {
      setRequiredRoles(requiredRoles.filter(id => id !== roleId))
    } else {
      setRequiredRoles([...requiredRoles, roleId])
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-auto p-4">
        <h3 className="font-semibold mb-4">Edit State</h3>
        
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-plm-fg-muted mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-plm-fg-muted mb-1">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
                placeholder={name}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm h-16 resize-none"
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Color</label>
            <div className="flex flex-wrap gap-1">
              {STATE_COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  className={`w-6 h-6 rounded ${color === c.value ? 'ring-2 ring-white ring-offset-1 ring-offset-plm-sidebar' : ''}`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Icon</label>
            <div className="flex flex-wrap gap-1">
              {Object.entries(ICON_MAP).slice(0, 16).map(([key, IconComp]) => (
                <button
                  key={key}
                  onClick={() => setIcon(key)}
                  className={`w-8 h-8 rounded flex items-center justify-center ${
                    icon === key ? 'bg-plm-accent text-white' : 'bg-plm-bg hover:bg-plm-highlight'
                  }`}
                >
                  <IconComp size={16} />
                </button>
              ))}
            </div>
          </div>
          
          {/* Required Workflow Roles */}
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">
              Required Roles to Enter State
              <span className="text-plm-fg-muted/60 ml-1">(optional)</span>
            </label>
            {loadingRoles ? (
              <div className="text-xs text-plm-fg-muted py-2">Loading roles...</div>
            ) : workflowRoles.length === 0 ? (
              <div className="text-xs text-plm-fg-muted py-2 bg-plm-bg rounded p-2">
                No workflow roles defined.{' '}
                <button
                  onClick={() => {
                    const { setActiveView } = usePDMStore.getState()
                    setActiveView('settings')
                    window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'team-members' }))
                    onClose()
                  }}
                  className="text-plm-accent hover:underline"
                >
                  Create roles in Settings
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 p-2 bg-plm-bg rounded border border-plm-border max-h-24 overflow-y-auto">
                {workflowRoles.map(role => (
                  <button
                    key={role.id}
                    onClick={() => toggleRequiredRole(role.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                      requiredRoles.includes(role.id)
                        ? 'ring-1 ring-plm-accent'
                        : 'hover:bg-plm-highlight'
                    }`}
                    style={{
                      backgroundColor: requiredRoles.includes(role.id) ? role.color + '30' : undefined
                    }}
                    title={requiredRoles.includes(role.id) ? 'Click to remove requirement' : 'Click to require this role'}
                  >
                    <BadgeCheck size={12} style={{ color: role.color }} />
                    <span>{role.name}</span>
                    {requiredRoles.includes(role.id) && (
                      <CheckCircle size={10} className="text-plm-success" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {requiredRoles.length > 0 && (
              <p className="text-[10px] text-plm-fg-muted mt-1">
                Users must have {requiredRoles.length === 1 ? 'this role' : 'any of these roles'} to enter this state
              </p>
            )}
          </div>
          
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isEditable}
                onChange={(e) => setIsEditable(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Files can be edited in this state</span>
            </label>
            {/* requires_checkout is now auto-set to match is_editable */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRev}
                onChange={(e) => setAutoRev(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Auto-increment revision on transition</span>
            </label>
          </div>
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-plm-bg rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({
              name,
              label: label || null,
              description: description || null,
              color,
              icon,
              is_editable: isEditable,
              requires_checkout: isEditable, // Auto-set: editable states require checkout
              auto_increment_revision: autoRev,
              required_workflow_roles: requiredRoles,
            })}
            className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
            disabled={!name.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

interface EditTransitionDialogProps {
  transition: WorkflowTransition
  onClose: () => void
  onSave: (updates: Partial<WorkflowTransition>) => void
}

function EditTransitionDialog({ transition, onClose, onSave }: EditTransitionDialogProps) {
  const { organization } = usePDMStore()
  const [name, setName] = useState(transition.name || '')
  const [description, setDescription] = useState(transition.description || '')
  const [lineStyle, setLineStyle] = useState(transition.line_style)
  const [allowedRoles, setAllowedRoles] = useState<UserRole[]>(transition.allowed_roles)
  const [allowedWorkflowRoles, setAllowedWorkflowRoles] = useState<string[]>(transition.allowed_workflow_roles || [])
  
  // Load workflow roles
  const [workflowRoles, setWorkflowRoles] = useState<WorkflowRoleBasic[]>([])
  const [loadingRoles, setLoadingRoles] = useState(true)
  
  useEffect(() => {
    const loadRoles = async () => {
      if (!organization) return
      try {
        const { data, error } = await supabase
          .from('workflow_roles')
          .select('id, name, color, icon')
          .eq('org_id', organization.id)
          .eq('is_active', true)
          .order('sort_order')
          .order('name')
        
        if (!error && data) {
          setWorkflowRoles(data)
        }
      } catch (err) {
        console.error('Failed to load workflow roles:', err)
      } finally {
        setLoadingRoles(false)
      }
    }
    loadRoles()
  }, [organization])
  
  const toggleRole = (role: UserRole) => {
    if (allowedRoles.includes(role)) {
      setAllowedRoles(allowedRoles.filter(r => r !== role))
    } else {
      setAllowedRoles([...allowedRoles, role])
    }
  }
  
  const toggleWorkflowRole = (roleId: string) => {
    if (allowedWorkflowRoles.includes(roleId)) {
      setAllowedWorkflowRoles(allowedWorkflowRoles.filter(id => id !== roleId))
    } else {
      setAllowedWorkflowRoles([...allowedWorkflowRoles, roleId])
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-[420px] max-h-[80vh] overflow-auto p-4">
        <h3 className="font-semibold mb-4">Edit Transition</h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              placeholder="e.g., Submit for Review"
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm h-16 resize-none"
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Line Style</label>
            <div className="flex gap-2">
              {(['solid', 'dashed', 'dotted'] as TransitionLineStyle[]).map(style => (
                <button
                  key={style}
                  onClick={() => setLineStyle(style)}
                  className={`px-3 py-1.5 rounded text-sm ${
                    lineStyle === style ? 'bg-plm-accent text-white' : 'bg-plm-bg hover:bg-plm-highlight'
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Allowed System Roles</label>
            <div className="flex gap-2">
              {(['admin', 'engineer', 'viewer'] as UserRole[]).map(role => (
                <label key={role} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowedRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="rounded"
                  />
                  <span className="text-sm capitalize">{role}</span>
                </label>
              ))}
            </div>
          </div>
          
          {/* Workflow Roles */}
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">
              Allowed Workflow Roles
              <span className="text-plm-fg-muted/60 ml-1">(optional)</span>
            </label>
            {loadingRoles ? (
              <div className="text-xs text-plm-fg-muted py-2">Loading roles...</div>
            ) : workflowRoles.length === 0 ? (
              <div className="text-xs text-plm-fg-muted py-2 bg-plm-bg rounded p-2">
                No workflow roles defined.{' '}
                <button
                  onClick={() => {
                    const { setActiveView } = usePDMStore.getState()
                    setActiveView('settings')
                    window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'team-members' }))
                    onClose()
                  }}
                  className="text-plm-accent hover:underline"
                >
                  Create roles in Settings
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 p-2 bg-plm-bg rounded border border-plm-border max-h-24 overflow-y-auto">
                {workflowRoles.map(role => (
                  <button
                    key={role.id}
                    onClick={() => toggleWorkflowRole(role.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                      allowedWorkflowRoles.includes(role.id)
                        ? 'ring-1 ring-plm-accent'
                        : 'hover:bg-plm-highlight'
                    }`}
                    style={{
                      backgroundColor: allowedWorkflowRoles.includes(role.id) ? role.color + '30' : undefined
                    }}
                    title={allowedWorkflowRoles.includes(role.id) ? 'Click to remove' : 'Click to allow this role'}
                  >
                    <BadgeCheck size={12} style={{ color: role.color }} />
                    <span>{role.name}</span>
                    {allowedWorkflowRoles.includes(role.id) && (
                      <CheckCircle size={10} className="text-plm-success" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {allowedWorkflowRoles.length > 0 && (
              <p className="text-[10px] text-plm-fg-muted mt-1">
                Users with {allowedWorkflowRoles.length === 1 ? 'this workflow role' : 'any of these workflow roles'} can execute this transition
              </p>
            )}
          </div>
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-plm-bg rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({
              name: name || null,
              description: description || null,
              line_style: lineStyle,
              allowed_roles: allowedRoles,
              allowed_workflow_roles: allowedWorkflowRoles,
            })}
            className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

