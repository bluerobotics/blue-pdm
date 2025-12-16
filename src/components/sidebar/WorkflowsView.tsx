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
  GripHorizontal
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import type { 
  WorkflowTemplate, 
  WorkflowState, 
  WorkflowTransition, 
  WorkflowGate,
  WorkflowStateType,
  FileStateMapping,
  TransitionLineStyle,
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

// Minimum sidebar width for workflow view
const WORKFLOW_SIDEBAR_WIDTH = 600

export function WorkflowsView() {
  const { organization, user, addToast, sidebarWidth, setSidebarWidth, getEffectiveRole } = usePDMStore()
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
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  
  // Dragging state
  const [draggingStateId, setDraggingStateId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  
  // Dragging transition endpoint
  const [draggingTransitionEndpoint, setDraggingTransitionEndpoint] = useState<{
    transitionId: string
    endpoint: 'start' | 'end'
    originalStateId: string
  } | null>(null)
  const [hoveredStateId, setHoveredStateId] = useState<string | null>(null)
  
  // Dragging curve control point (middle handle)
  const [draggingCurveControl, setDraggingCurveControl] = useState<string | null>(null) // transitionId
  // Store custom curve midpoints per transition (the point ON the curve the user dragged to)
  const [curveMidpoints, setCurveMidpoints] = useState<Record<string, { x: number; y: number }>>({})
  // Temp position while dragging curve control
  const [tempCurvePos, setTempCurvePos] = useState<{ x: number; y: number } | null>(null)
  
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
  
  // LocalStorage key for visual customizations
  const getStorageKey = (workflowId: string) => `workflow-visual-${workflowId}`
  
  // Load visual customizations from localStorage when workflow changes
  useEffect(() => {
    if (!selectedWorkflow?.id) return
    
    try {
      const stored = localStorage.getItem(getStorageKey(selectedWorkflow.id))
      if (stored) {
        const data = JSON.parse(stored)
        if (data.curveMidpoints) setCurveMidpoints(data.curveMidpoints)
        if (data.labelOffsets) setLabelOffsets(data.labelOffsets)
        if (data.edgePositions) setEdgePositions(data.edgePositions)
      }
    } catch (e) {
      console.warn('Failed to load workflow visual data:', e)
    }
  }, [selectedWorkflow?.id])
  
  // Save visual customizations to localStorage when they change
  useEffect(() => {
    if (!selectedWorkflow?.id) return
    
    // Don't save empty state
    if (Object.keys(curveMidpoints).length === 0 && 
        Object.keys(labelOffsets).length === 0 && 
        Object.keys(edgePositions).length === 0) return
    
    try {
      localStorage.setItem(getStorageKey(selectedWorkflow.id), JSON.stringify({
        curveMidpoints,
        labelOffsets,
        edgePositions
      }))
    } catch (e) {
      console.warn('Failed to save workflow visual data:', e)
    }
  }, [selectedWorkflow?.id, curveMidpoints, labelOffsets, edgePositions])
  
  // Editing state
  const [showCreateWorkflow, setShowCreateWorkflow] = useState(false)
  const [showEditState, setShowEditState] = useState(false)
  const [showEditTransition, setShowEditTransition] = useState(false)
  const [showEditGate, setShowEditGate] = useState(false)
  const [editingState, setEditingState] = useState<WorkflowState | null>(null)
  const [editingTransition, setEditingTransition] = useState<WorkflowTransition | null>(null)
  const [editingGate, setEditingGate] = useState<WorkflowGate | null>(null)
  
  // Store previous sidebar width to restore on unmount
  const previousWidthRef = useRef<number>(sidebarWidth)
  
  const canvasRef = useRef<HTMLDivElement>(null)
  
  // Expand sidebar for workflow view
  useEffect(() => {
    previousWidthRef.current = sidebarWidth
    if (sidebarWidth < WORKFLOW_SIDEBAR_WIDTH) {
      setSidebarWidth(WORKFLOW_SIDEBAR_WIDTH)
    }
    return () => {
      // Restore previous width when leaving workflows view
      // Only if it was smaller before
      if (previousWidthRef.current < WORKFLOW_SIDEBAR_WIDTH) {
        setSidebarWidth(previousWidthRef.current)
      }
    }
  }, [])
  
  // Check if user is admin (respects role impersonation)
  useEffect(() => {
    setIsAdmin(effectiveRole === 'admin')
  }, [effectiveRole])
  
  // Handle ESC key to cancel connect mode or creating transition
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCreatingTransition) {
          setIsCreatingTransition(false)
          setTransitionStartId(null)
        }
        if (canvasMode === 'connect') {
          setCanvasMode('select')
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCreatingTransition, canvasMode])
  
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
      
      // Apply canvas config
      if (workflow.canvas_config) {
        setZoom(workflow.canvas_config.zoom || 1)
        setPan({ x: workflow.canvas_config.panX || 0, y: workflow.canvas_config.panY || 0 })
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
      name: 'New State',
      label: 'New State',
      description: '',
      color: '#6B7280',
      icon: 'circle',
      position_x: 250 + states.length * 50,
      position_y: 200,
      state_type: 'intermediate',
      maps_to_file_state: 'wip',
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
  
  // Update state position (drag)
  const updateStatePosition = async (stateId: string, x: number, y: number) => {
    try {
      await supabase
        .from('workflow_states')
        .update({ position_x: Math.round(x), position_y: Math.round(y) })
        .eq('id', stateId)
      
      setStates(states.map(s => 
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
      
      setTransitions([...transitions, data])
      setSelectedTransitionId(data.id)
      setEditingTransition(data)
      setShowEditTransition(true)
    } catch (err) {
      console.error('Failed to create transition:', err)
      addToast('error', 'Failed to create transition')
    }
    
    setIsCreatingTransition(false)
    setTransitionStartId(null)
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
  
  // Add gate to transition
  const addGate = async (transitionId: string) => {
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
  }, [])
  
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
    if (draggingStateId) {
      const newX = mouseX + dragOffset.x
      const newY = mouseY + dragOffset.y
      
      // Update state position in local state (for smooth dragging)
      setStates(prevStates => prevStates.map(s => 
        s.id === draggingStateId 
          ? { ...s, position_x: Math.round(newX), position_y: Math.round(newY) }
          : s
      ))
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
        const BOX_WIDTH = 120
        const BOX_HEIGHT = 60
        const SNAP_PADDING = 15 // Only snap when within 15px of the box edge
        
        for (const state of states) {
          // Don't snap to the state at the other end (would make a self-loop)
          if (state.id === otherEndStateId) continue
          
          // Check if mouse is inside or very close to the box boundary
          const hw = BOX_WIDTH / 2 + SNAP_PADDING
          const hh = BOX_HEIGHT / 2 + SNAP_PADDING
          
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
    
    // Handle curve control dragging
    if (draggingCurveControl) {
      setTempCurvePos({ x: mouseX, y: mouseY })
    }
    
    // Handle label dragging
    if (draggingLabel) {
      setTempLabelPos({ x: mouseX, y: mouseY })
    }
  }
  
  const handleCanvasMouseUp = async () => {
    // Save dragged state position to database
    if (draggingStateId) {
      const state = states.find(s => s.id === draggingStateId)
      if (state) {
        await updateStatePosition(draggingStateId, state.position_x, state.position_y)
      }
      setDraggingStateId(null)
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
            
            // Update local state
            setTransitions(transitions.map(t => 
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
    
    setDraggingTransitionEndpoint(null)
    setHoveredStateId(null)
    
    // Handle curve control drop - save the curve midpoint (point ON the curve)
    if (draggingCurveControl && tempCurvePos) {
      // Save the absolute position of where the user dragged the midpoint
      setCurveMidpoints(prev => ({
        ...prev,
        [draggingCurveControl]: { x: tempCurvePos.x, y: tempCurvePos.y }
      }))
      setDraggingCurveControl(null)
      setTempCurvePos(null)
    }
    
    // Handle label drop - save the label position
    if (draggingLabel && tempLabelPos) {
      const transition = transitions.find(t => t.id === draggingLabel)
      if (transition) {
        const fromState = states.find(s => s.id === transition.from_state_id)
        const toState = states.find(s => s.id === transition.to_state_id)
        if (fromState && toState) {
          // Calculate the default label position (curve midpoint)
          const startPoint = getClosestPointOnBox(fromState.position_x, fromState.position_y, toState.position_x, toState.position_y)
          const endPoint = getClosestPointOnBox(toState.position_x, toState.position_y, fromState.position_x, fromState.position_y)
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
      setDraggingLabel(null)
      setTempLabelPos(null)
    }
    
    setIsDragging(false)
  }
  
  const handleCanvasClick = (e: React.MouseEvent) => {
    // Don't process click if we were dragging
    if (draggingStateId) return
    
    // If clicking on canvas background (not a state/transition), cancel creating transition
    if (isCreatingTransition) {
      cancelConnectMode()
    }
    // Deselect when clicking background
    setSelectedStateId(null)
    setSelectedTransitionId(null)
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
    const isSnapTarget = hoveredStateId === state.id && draggingTransitionEndpoint !== null
    const textColor = getContrastColor(state.color)
    
    return (
      <g
        key={state.id}
        transform={`translate(${state.position_x}, ${state.position_y})`}
        style={{ cursor: isDraggingThis ? 'grabbing' : (isAdmin && canvasMode === 'select' ? 'grab' : 'pointer') }}
        onMouseDown={(e) => {
          e.stopPropagation()
          if (canvasMode === 'select' && isAdmin) {
            startDraggingState(state.id, e)
          }
        }}
        onClick={(e) => {
          e.stopPropagation()
          // Don't process click if we just finished dragging
          if (draggingStateId) return
          
          if (isCreatingTransition) {
            completeTransition(state.id)
          } else {
            setSelectedStateId(state.id)
            setSelectedTransitionId(null)
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (isAdmin) {
            setEditingState(state)
            setShowEditState(true)
          }
        }}
      >
        {/* Selection glow / drag glow / snap target glow */}
        {(isSelected || isTransitionStart || isDraggingThis || isSnapTarget) && (
          <rect
            x="-64"
            y="-34"
            width="128"
            height="68"
            rx="12"
            fill={isSnapTarget ? 'rgba(96, 165, 250, 0.2)' : 'none'}
            stroke={isSnapTarget ? '#60a5fa' : isDraggingThis ? '#60a5fa' : isSelected ? '#fff' : '#22c55e'}
            strokeWidth={isSnapTarget ? 3 : 2}
            opacity={isSnapTarget ? 1 : isDraggingThis ? 0.8 : 0.6}
            strokeDasharray={isDraggingThis ? '4,2' : 'none'}
          />
        )}
        
        {/* Snap target indicator */}
        {isSnapTarget && (
          <text
            x="0"
            y="-42"
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
          <rect
            x="-56"
            y="-26"
            width="120"
            height="60"
            rx="8"
            fill="rgba(0,0,0,0.3)"
            transform="translate(4, 4)"
          />
        )}
        
        {/* Node background */}
        <rect
          x="-60"
          y="-30"
          width="120"
          height="60"
          rx="8"
          fill={state.color}
          stroke={isDraggingThis ? '#60a5fa' : isSelected ? '#fff' : isTransitionStart ? '#22c55e' : 'rgba(255,255,255,0.2)'}
          strokeWidth={isSelected || isTransitionStart || isDraggingThis ? 2 : 1}
        />
        
        {/* Drag handle indicator (top of node) - only show for admins in select mode */}
        {isAdmin && canvasMode === 'select' && (
          <g opacity={isSelected || isDraggingThis ? 1 : 0.5}>
            {/* Grip dots */}
            <circle cx="-8" cy="-22" r="1.5" fill={textColor} opacity="0.6" />
            <circle cx="0" cy="-22" r="1.5" fill={textColor} opacity="0.6" />
            <circle cx="8" cy="-22" r="1.5" fill={textColor} opacity="0.6" />
          </g>
        )}
        
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
        
        {/* State type badge */}
        <text
          x="0"
          y="16"
          textAnchor="middle"
          fontSize="9"
          fill={textColor}
          opacity="0.7"
          className="select-none pointer-events-none"
        >
          {state.state_type.toUpperCase()}
        </text>
        
        {/* Connection points for transitions */}
        {isAdmin && canvasMode === 'connect' && (
          <>
            {/* Right point - start transition */}
            <circle
              cx="60"
              cy="0"
              r="10"
              fill="#22c55e"
              stroke="#fff"
              strokeWidth="2"
              className="cursor-crosshair"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
              onClick={(e) => {
                e.stopPropagation()
                startTransition(state.id)
              }}
            />
            <text
              x="60"
              y="4"
              textAnchor="middle"
              fontSize="12"
              fontWeight="bold"
              fill="#fff"
              className="select-none pointer-events-none"
            >
              →
            </text>
            
            {/* Left point - end transition (when creating) */}
            {isCreatingTransition && transitionStartId !== state.id && (
              <>
                <circle
                  cx="-60"
                  cy="0"
                  r="10"
                  fill="#3b82f6"
                  stroke="#fff"
                  strokeWidth="2"
                  className="cursor-crosshair"
                  style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
                />
                <text
                  x="-60"
                  y="4"
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="bold"
                  fill="#fff"
                  className="select-none pointer-events-none"
                >
                  ●
                </text>
              </>
            )}
          </>
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
    
    // Check for stored edge positions
    const storedStartPos = edgePositions[`${transition.id}-start`]
    const storedEndPos = edgePositions[`${transition.id}-end`]
    
    // Calculate default connection points (for fallback)
    const defaultStartPoint = getClosestPointOnBox(sourceStatePos.x, sourceStatePos.y, targetStatePos.x, targetStatePos.y)
    const defaultEndPoint = getClosestPointOnBox(targetStatePos.x, targetStatePos.y, sourceStatePos.x, sourceStatePos.y)
    
    // Get the fixed points (either stored or default)
    const fixedStartPoint = storedStartPos 
      ? { ...getPointFromEdgePosition(sourceStatePos.x, sourceStatePos.y, storedStartPos), edge: storedStartPos.edge }
      : defaultStartPoint
    const fixedEndPoint = storedEndPos
      ? { ...getPointFromEdgePosition(targetStatePos.x, targetStatePos.y, storedEndPos), edge: storedEndPos.edge }
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
          startPoint = getNearestPointOnBoxEdge(hoverState.position_x, hoverState.position_y, mousePos.x, mousePos.y)
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
          endPoint = getNearestPointOnBoxEdge(hoverState.position_x, hoverState.position_y, mousePos.x, mousePos.y)
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
    
    // Check if we're dragging this transition's curve control
    const isDraggingThisCurve = draggingCurveControl === transition.id
    const isDraggingThisLabel = draggingLabel === transition.id
    
    // Check for stored curve midpoint (the point ON the curve the user set)
    const storedMidpoint = curveMidpoints[transition.id]
    
    // Calculate control point
    let controlX: number, controlY: number
    let curveMidX: number, curveMidY: number  // Actual midpoint ON the bezier curve
    
    if (isDraggingThisCurve && tempCurvePos) {
      // User is dragging - the temp position is the desired curve midpoint
      curveMidX = tempCurvePos.x
      curveMidY = tempCurvePos.y
      // Calculate what control point would make the curve pass through this point
      const cp = getControlPointFromMidpoint(startX, startY, curveMidX, curveMidY, endX, endY)
      controlX = cp.x
      controlY = cp.y
    } else if (storedMidpoint) {
      // Use stored curve midpoint
      curveMidX = storedMidpoint.x
      curveMidY = storedMidpoint.y
      // Calculate control point from stored midpoint
      const cp = getControlPointFromMidpoint(startX, startY, curveMidX, curveMidY, endX, endY)
      controlX = cp.x
      controlY = cp.y
    } else {
      // Calculate default control point based on connection edges
      const horizDist = Math.abs(endX - startX)
      const vertDist = Math.abs(endY - startY)
      const curveStrength = Math.max(40, Math.min(100, Math.max(horizDist, vertDist) * 0.3))
      
      controlX = lineMidX
      controlY = lineMidY
      
      if (startPoint.edge === 'right' && endPoint.edge === 'left') {
        controlY = lineMidY - curveStrength * 0.3
      } else if (startPoint.edge === 'left' && endPoint.edge === 'right') {
        controlY = lineMidY + curveStrength
      } else if (startPoint.edge === 'bottom' && endPoint.edge === 'top') {
        controlX = lineMidX + curveStrength * 0.3
      } else if (startPoint.edge === 'top' && endPoint.edge === 'bottom') {
        controlX = lineMidX - curveStrength
      } else {
        if (startPoint.edge === 'right' || startPoint.edge === 'left') {
          controlY = lineMidY + (endY > startY ? -1 : 1) * curveStrength * 0.5
        } else {
          controlX = lineMidX + (endX > startX ? -1 : 1) * curveStrength * 0.5
        }
      }
      
      // Calculate the actual curve midpoint from this control point
      const mid = getBezierMidpoint(startX, startY, controlX, controlY, endX, endY)
      curveMidX = mid.x
      curveMidY = mid.y
    }
    
    const pathD = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`
    
    // Label position - can be dragged separately
    const storedLabelOffset = labelOffsets[transition.id]
    let labelX: number, labelY: number
    
    if (isDraggingThisLabel && tempLabelPos) {
      labelX = tempLabelPos.x
      labelY = tempLabelPos.y
    } else if (storedLabelOffset) {
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
      <g key={transition.id}>
        {/* Clickable wider path for selection */}
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth="20"
          className="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedTransitionId(transition.id)
            setSelectedStateId(null)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (isAdmin) {
              setEditingTransition(transition)
              setShowEditTransition(true)
            }
          }}
        />
        
        {/* Selection highlight */}
        {isSelected && (
          <path
            d={pathD}
            fill="none"
            stroke="#fff"
            strokeWidth="6"
            strokeDasharray="none"
            opacity="0.3"
            className="pointer-events-none"
          />
        )}
        
        {/* Visible path */}
        <path
          d={pathD}
          fill="none"
          stroke={isDraggingThisTransition ? '#60a5fa' : isSelected ? '#60a5fa' : transition.line_color || '#6b7280'}
          strokeWidth={isSelected || isDraggingThisTransition ? 3 : 2}
          strokeDasharray={isDraggingThisTransition ? '6,3' : transition.line_style === 'dashed' ? '8,4' : transition.line_style === 'dotted' ? '2,4' : 'none'}
          markerEnd={isSelected || isDraggingThisTransition ? 'url(#arrowhead-selected)' : 'url(#arrowhead)'}
          className="pointer-events-none"
        />
        
        {/* Handles are rendered in a separate layer above states */}
        
        {/* Transition label - positioned near the curve */}
        {transition.name && !isDraggingThisTransition && (
          <g transform={`translate(${labelX}, ${labelY})`}>
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
    
    // Find nearest point on source box edge to the mouse
    const startPoint = getNearestPointOnBoxEdge(
      fromState.position_x, fromState.position_y,
      mousePos.x, mousePos.y
    )
    
    // Calculate midpoint for curved path
    const midX = (startPoint.x + mousePos.x) / 2
    const midY = (startPoint.y + mousePos.y) / 2
    const curveOffset = 30
    
    // Curve the line slightly
    let controlX = midX
    let controlY = midY - curveOffset
    
    if (startPoint.edge === 'bottom' || startPoint.edge === 'top') {
      controlX = midX + curveOffset
      controlY = midY
    }
    
    const pathD = `M ${startPoint.x} ${startPoint.y} Q ${controlX} ${controlY} ${mousePos.x} ${mousePos.y}`
    
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
        ? getPointFromEdgePosition(fromState.position_x, fromState.position_y, storedStartPos)
        : defaultStartPoint
      const endPoint = storedEndPos
        ? getPointFromEdgePosition(toState.position_x, toState.position_y, storedEndPos)
        : defaultEndPoint
      
      // Calculate the line midpoint
      const lineMidX = (startPoint.x + endPoint.x) / 2
      const lineMidY = (startPoint.y + endPoint.y) / 2
      
      // Calculate curve midpoint (the point ON the curve where handle should be)
      const storedMidpoint = curveMidpoints[transition.id]
      let curveMidX: number, curveMidY: number
      let controlX: number, controlY: number
      
      if (storedMidpoint) {
        curveMidX = storedMidpoint.x
        curveMidY = storedMidpoint.y
        const cp = getControlPointFromMidpoint(startPoint.x, startPoint.y, curveMidX, curveMidY, endPoint.x, endPoint.y)
        controlX = cp.x
        controlY = cp.y
      } else {
        // Default curve calculation
        const horizDist = Math.abs(endPoint.x - startPoint.x)
        const vertDist = Math.abs(endPoint.y - startPoint.y)
        const curveStrength = Math.max(40, Math.min(100, Math.max(horizDist, vertDist) * 0.3))
        controlX = lineMidX
        controlY = lineMidY - curveStrength * 0.3
        // Calculate actual midpoint ON the curve
        const mid = getBezierMidpoint(startPoint.x, startPoint.y, controlX, controlY, endPoint.x, endPoint.y)
        curveMidX = mid.x
        curveMidY = mid.y
      }
      
      // Label position
      const storedLabelOffset = labelOffsets[transition.id]
      const labelX = storedLabelOffset ? lineMidX + storedLabelOffset.x : curveMidX
      const labelY = storedLabelOffset ? lineMidY + storedLabelOffset.y : curveMidY - 20
      
      return (
        <g key={`handles-${transition.id}`}>
          {/* Start handle */}
          <g
            transform={`translate(${startPoint.x}, ${startPoint.y})`}
            className="cursor-grab"
            style={{ pointerEvents: 'all' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDraggingTransitionEndpoint({
                transitionId: transition.id,
                endpoint: 'start',
                originalStateId: transition.from_state_id
              })
            }}
          >
            {/* Larger invisible hit area */}
            <circle r="16" fill="transparent" />
            {/* Visible handle */}
            <circle
              r="10"
              fill="#60a5fa"
              stroke="#fff"
              strokeWidth="2"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}
            />
            <circle r="4" fill="#fff" className="pointer-events-none" />
            <title>Drag to reconnect start</title>
          </g>
          
          {/* Curve control handle (middle) - positioned ON the curve */}
          <g
            transform={`translate(${curveMidX}, ${curveMidY})`}
            className="cursor-move"
            style={{ pointerEvents: 'all' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDraggingCurveControl(transition.id)
              setTempCurvePos({ x: curveMidX, y: curveMidY })
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              // Reset to default curve
              setCurveMidpoints(prev => {
                const next = { ...prev }
                delete next[transition.id]
                return next
              })
              addToast('info', 'Curve reset to default')
            }}
          >
            {/* Larger invisible hit area */}
            <circle r="14" fill="transparent" />
            {/* Visible handle - diamond shape for curve control */}
            <rect
              x="-8"
              y="-8"
              width="16"
              height="16"
              rx="3"
              transform="rotate(45)"
              fill="#f59e0b"
              stroke="#fff"
              strokeWidth="2"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}
            />
            <title>Drag to adjust curve (double-click to reset)</title>
          </g>
          
          {/* Label handle - separate from curve control */}
          {transition.name && (
            <g
              transform={`translate(${labelX}, ${labelY})`}
              className="cursor-move"
              style={{ pointerEvents: 'all' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setDraggingLabel(transition.id)
                setTempLabelPos({ x: labelX, y: labelY })
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                // Reset label position
                setLabelOffsets(prev => {
                  const next = { ...prev }
                  delete next[transition.id]
                  return next
                })
                addToast('info', 'Label position reset')
              }}
            >
              {/* Small grab handle indicator */}
              <circle r="6" fill="#10b981" stroke="#fff" strokeWidth="1.5" 
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
              <title>Drag to move label (double-click to reset)</title>
            </g>
          )}
          
          {/* End handle */}
          <g
            transform={`translate(${endPoint.x}, ${endPoint.y})`}
            className="cursor-grab"
            style={{ pointerEvents: 'all' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDraggingTransitionEndpoint({
                transitionId: transition.id,
                endpoint: 'end',
                originalStateId: transition.to_state_id
              })
            }}
          >
            {/* Larger invisible hit area */}
            <circle r="16" fill="transparent" />
            {/* Visible handle */}
            <circle
              r="10"
              fill="#60a5fa"
              stroke="#fff"
              strokeWidth="2"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}
            />
            <polygon
              points="-4,-4 4,0 -4,4"
              fill="#fff"
              className="pointer-events-none"
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
      {/* Workflow selector header */}
      <div className="p-3 border-b border-plm-border">
        <div className="flex items-center gap-2 mb-2">
          <select
            value={selectedWorkflow?.id || ''}
            onChange={(e) => {
              const workflow = workflows.find(w => w.id === e.target.value)
              if (workflow) selectWorkflow(workflow)
            }}
            className="flex-1 bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
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
              className="p-1.5 bg-plm-accent hover:bg-plm-accent-hover rounded text-white"
              title="Create workflow"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
        
        {selectedWorkflow?.description && (
          <p className="text-xs text-plm-fg-muted">{selectedWorkflow.description}</p>
        )}
      </div>
      
      {/* Canvas toolbar */}
      {selectedWorkflow && (
        <div className="flex items-center gap-1 p-2 border-b border-plm-border bg-plm-bg-light">
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
              setPan({ x: 0, y: 0 })
            }}
            className="p-1.5 hover:bg-plm-bg rounded text-xs"
            title="Reset view"
          >
            1:1
          </button>
          
          <div className="flex-1" />
          
          {isAdmin && (
            <button
              onClick={addState}
              className="flex items-center gap-1 px-2 py-1 bg-plm-accent hover:bg-plm-accent-hover rounded text-white text-xs"
            >
              <Plus size={12} />
              Add State
            </button>
          )}
        </div>
      )}
      
      {/* Visual canvas */}
      {selectedWorkflow && (
        <div 
          ref={canvasRef}
          className="flex-1 overflow-hidden bg-plm-bg relative"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => {
            handleCanvasMouseUp()
            // Cancel dragging if mouse leaves canvas
            if (draggingStateId) {
              setDraggingStateId(null)
            }
            if (draggingTransitionEndpoint) {
              setDraggingTransitionEndpoint(null)
              setHoveredStateId(null)
            }
          }}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
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
              transformOrigin: '0 0'
            }}
          >
            {/* Definitions */}
            <defs>
              {/* Grid pattern */}
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.3" />
              </pattern>
              
              {/* Arrow marker - default */}
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
              
              {/* Arrow marker - selected */}
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
            </defs>
            
            {/* Grid background */}
            <rect width="2000" height="2000" x="-500" y="-500" fill="url(#grid)" />
            
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
      
      {/* Selected item properties panel */}
      {selectedWorkflow && (selectedStateId || selectedTransitionId) && (
        <div className="border-t border-plm-border bg-plm-sidebar p-3">
          {selectedStateId && (
            <SelectedStatePanel
              state={states.find(s => s.id === selectedStateId)!}
              isAdmin={isAdmin}
              onEdit={() => {
                setEditingState(states.find(s => s.id === selectedStateId)!)
                setShowEditState(true)
              }}
              onDelete={() => deleteState(selectedStateId)}
            />
          )}
          
          {selectedTransitionId && (
            <SelectedTransitionPanel
              transition={transitions.find(t => t.id === selectedTransitionId)!}
              gates={gates[selectedTransitionId] || []}
              states={states}
              isAdmin={isAdmin}
              onEdit={() => {
                setEditingTransition(transitions.find(t => t.id === selectedTransitionId)!)
                setShowEditTransition(true)
              }}
              onDelete={() => deleteTransition(selectedTransitionId)}
              onAddGate={() => addGate(selectedTransitionId)}
            />
          )}
        </div>
      )}
      
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

interface SelectedStatePanelProps {
  state: WorkflowState
  isAdmin: boolean
  onEdit: () => void
  onDelete: () => void
}

function SelectedStatePanel({ state, isAdmin, onEdit, onDelete }: SelectedStatePanelProps) {
  const IconComponent = ICON_MAP[state.icon] || Circle
  
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div 
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ backgroundColor: state.color }}
        >
          <IconComponent size={14} style={{ color: getContrastColor(state.color) }} />
        </div>
        <span className="font-medium text-sm">{state.label || state.name}</span>
        <span className="text-xs text-plm-fg-muted px-1.5 py-0.5 bg-plm-bg rounded">
          {state.state_type}
        </span>
      </div>
      
      {state.description && (
        <p className="text-xs text-plm-fg-muted mb-2">{state.description}</p>
      )}
      
      <div className="flex gap-2 text-xs text-plm-fg-muted mb-2">
        <span>Maps to: {state.maps_to_file_state}</span>
        {state.is_editable && <span>• Editable</span>}
        {state.requires_checkout && <span>• Requires checkout</span>}
        {state.auto_increment_revision && <span>• Auto-rev</span>}
      </div>
      
      {isAdmin && (
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-2 py-1 bg-plm-bg hover:bg-plm-highlight rounded text-xs"
          >
            <Edit3 size={12} />
            Edit
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 bg-plm-error/20 hover:bg-plm-error/30 text-plm-error rounded text-xs"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

interface SelectedTransitionPanelProps {
  transition: WorkflowTransition
  gates: WorkflowGate[]
  states: WorkflowState[]
  isAdmin: boolean
  onEdit: () => void
  onDelete: () => void
  onAddGate: () => void
}

function SelectedTransitionPanel({ 
  transition, 
  gates, 
  states, 
  isAdmin, 
  onEdit, 
  onDelete,
  onAddGate 
}: SelectedTransitionPanelProps) {
  const fromState = states.find(s => s.id === transition.from_state_id)
  const toState = states.find(s => s.id === transition.to_state_id)
  
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <ArrowRight size={14} className="text-plm-fg-muted" />
        <span className="font-medium text-sm">{transition.name || 'Unnamed transition'}</span>
      </div>
      
      <div className="flex items-center gap-2 text-xs text-plm-fg-muted mb-2">
        <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: fromState?.color + '40' }}>
          {fromState?.name}
        </span>
        <ArrowRight size={10} />
        <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: toState?.color + '40' }}>
          {toState?.name}
        </span>
      </div>
      
      {/* Gates */}
      {gates.length > 0 && (
        <div className="mb-2">
          <div className="text-xs text-plm-fg-muted mb-1">Gates ({gates.length}):</div>
          {gates.map(gate => (
            <div key={gate.id} className="flex items-center gap-2 text-xs bg-plm-bg rounded px-2 py-1 mb-1">
              {gate.gate_type === 'approval' && <UserCheck size={12} className="text-amber-500" />}
              {gate.gate_type === 'checklist' && <ListChecks size={12} className="text-blue-500" />}
              {gate.gate_type === 'condition' && <Zap size={12} className="text-purple-500" />}
              <span>{gate.name}</span>
              {gate.is_blocking && <span className="text-plm-fg-muted">(blocking)</span>}
            </div>
          ))}
        </div>
      )}
      
      {isAdmin && (
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-2 py-1 bg-plm-bg hover:bg-plm-highlight rounded text-xs"
          >
            <Edit3 size={12} />
            Edit
          </button>
          <button
            onClick={onAddGate}
            className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded text-xs"
          >
            <Plus size={12} />
            Add Gate
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 bg-plm-error/20 hover:bg-plm-error/30 text-plm-error rounded text-xs"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
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

interface EditStateDialogProps {
  state: WorkflowState
  onClose: () => void
  onSave: (updates: Partial<WorkflowState>) => void
}

function EditStateDialog({ state, onClose, onSave }: EditStateDialogProps) {
  const [name, setName] = useState(state.name)
  const [label, setLabel] = useState(state.label || '')
  const [description, setDescription] = useState(state.description || '')
  const [color, setColor] = useState(state.color)
  const [icon, setIcon] = useState(state.icon)
  const [stateType, setStateType] = useState(state.state_type)
  const [mapsTo, setMapsTo] = useState(state.maps_to_file_state)
  const [isEditable, setIsEditable] = useState(state.is_editable)
  const [requiresCheckout, setRequiresCheckout] = useState(state.requires_checkout)
  const [autoRev, setAutoRev] = useState(state.auto_increment_revision)
  
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
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-plm-fg-muted mb-1">State Type</label>
              <select
                value={stateType}
                onChange={(e) => setStateType(e.target.value as WorkflowStateType)}
                className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              >
                <option value="initial">Initial</option>
                <option value="intermediate">Intermediate</option>
                <option value="final">Final</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-plm-fg-muted mb-1">Maps to File State</label>
              <select
                value={mapsTo}
                onChange={(e) => setMapsTo(e.target.value as FileStateMapping)}
                className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              >
                <option value="not_tracked">Not Tracked</option>
                <option value="wip">WIP</option>
                <option value="in_review">In Review</option>
                <option value="released">Released</option>
                <option value="obsolete">Obsolete</option>
              </select>
            </div>
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresCheckout}
                onChange={(e) => setRequiresCheckout(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Require checkout to edit</span>
            </label>
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
              state_type: stateType,
              maps_to_file_state: mapsTo,
              is_editable: isEditable,
              requires_checkout: requiresCheckout,
              auto_increment_revision: autoRev,
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
  const [name, setName] = useState(transition.name || '')
  const [description, setDescription] = useState(transition.description || '')
  const [lineStyle, setLineStyle] = useState(transition.line_style)
  const [allowedRoles, setAllowedRoles] = useState<UserRole[]>(transition.allowed_roles)
  
  const toggleRole = (role: UserRole) => {
    if (allowedRoles.includes(role)) {
      setAllowedRoles(allowedRoles.filter(r => r !== role))
    } else {
      setAllowedRoles([...allowedRoles, role])
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-96 p-4">
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
            <label className="block text-xs text-plm-fg-muted mb-1">Allowed Roles</label>
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

