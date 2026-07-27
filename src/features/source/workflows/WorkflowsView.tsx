/**
 * WorkflowsView - Visual workflow editor for state machine management
 *
 * State Management Pattern:
 * - Canvas interaction: WorkflowCanvasContext (slim, ~60 items)
 * - Global actions: usePDMStore (addToast)
 * - Dialog state: useWorkflowDialogs hook
 * - Core data: props from useWorkflowData hook
 *
 * This follows the project's Zustand-first pattern where Context
 * is only used for component-tree-scoped ephemeral state.
 *
 * @example
 * ```tsx
 * <WorkflowsView />
 * ```
 */
import { useEffect, useRef } from 'react'
import { GitBranch } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'

import { useRafThrottle, useStableCallback } from './utils'

// Slim canvas context
import { WorkflowCanvasProvider, useWorkflowCanvasContext } from './context/WorkflowCanvasContext'

// Hooks (data-fetching and behavior)
import {
  useWorkflowData,
  useUndoRedo,
  useWorkflowCRUD,
  useWorkflowIO,
  useClipboardOperations,
  useFloatingToolbarActions,
  useCanvasHandlers,
  useCanvasEvents,
  useWorkflowDialogs,
} from './hooks'

// Components
import { WorkflowCanvas } from './canvas'
import { WorkflowsList } from './WorkflowsList'
import { WorkflowToolbar } from './WorkflowToolbar'
import { WorkflowDialogs, WorkflowContextMenus } from './components'

// Types
import type { WorkflowTemplate, WorkflowState, WorkflowTransition } from './types'

// ============================================
// MAIN COMPONENT - Wraps content with Provider
// ============================================

export function WorkflowsView() {
  // Workflow data hook - manages Supabase data fetching
  const workflowData = useWorkflowData({})

  return (
    <WorkflowCanvasProvider workflowId={workflowData.selectedWorkflow?.id}>
      <WorkflowsViewContent
        // Data props (from useWorkflowData)
        workflows={workflowData.workflows}
        selectedWorkflow={workflowData.selectedWorkflow}
        states={workflowData.states}
        transitions={workflowData.transitions}
        gates={workflowData.gates}
        isLoading={workflowData.isLoading}
        isAdmin={workflowData.isAdmin}
        setStates={workflowData.setStates}
        setTransitions={workflowData.setTransitions}
        setGates={workflowData.setGates}
        setSelectedWorkflow={workflowData.setSelectedWorkflow}
        // Actions
        selectWorkflow={workflowData.selectWorkflow}
        createWorkflow={workflowData.createWorkflow}
        updateWorkflow={workflowData.updateWorkflow}
        deleteWorkflow={workflowData.deleteWorkflow}
      />
    </WorkflowCanvasProvider>
  )
}

// ============================================
// CONTENT COMPONENT - Uses context + local state
// ============================================

interface WorkflowsViewContentProps {
  // Data
  workflows: WorkflowTemplate[]
  selectedWorkflow: WorkflowTemplate | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
  gates: Record<string, import('./types').WorkflowGate[]>
  isLoading: boolean
  isAdmin: boolean
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  setGates: React.Dispatch<React.SetStateAction<Record<string, import('./types').WorkflowGate[]>>>
  setSelectedWorkflow: React.Dispatch<React.SetStateAction<WorkflowTemplate | null>>
  // Actions
  selectWorkflow: (workflow: WorkflowTemplate) => void
  createWorkflow: (name: string, description: string) => Promise<boolean>
  updateWorkflow: (id: string, updates: { name: string; description: string }) => Promise<boolean>
  deleteWorkflow: (id: string) => Promise<boolean>
}

function WorkflowsViewContent({
  workflows,
  selectedWorkflow,
  states,
  transitions,
  gates,
  isLoading,
  isAdmin,
  setStates,
  setTransitions,
  setGates,
  setSelectedWorkflow,
  selectWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
}: WorkflowsViewContentProps) {
  // Canvas context (slim - only canvas interaction state)
  const canvas = useWorkflowCanvasContext()

  // Toast from global store
  const { addToast } = usePDMStore()

  // Import input ref
  const importInputRef = useRef<HTMLInputElement>(null)

  // ============================================
  // DIALOG STATE (consolidated hook)
  // ============================================
  const dialogs = useWorkflowDialogs()

  // ============================================
  // BEHAVIOR HOOKS
  // ============================================

  // Undo/redo
  const undoRedoState = useUndoRedo({
    isAdmin,
    addToast,
    setStates,
    setTransitions,
  })
  const { pushToUndo, handleUndo, handleRedo } = undoRedoState

  // CRUD operations
  const crudOperations = useWorkflowCRUD({
    selectedWorkflow,
    states,
    transitions,
    gates,
    isAdmin,
    setStates,
    setTransitions,
    setGates,
    setSelectedStateId: canvas.selectState,
    setSelectedTransitionId: canvas.selectTransition,
    setEditingState: dialogs.setEditingState,
    setEditingTransition: dialogs.setEditingTransition,
    setEditingGate: () => {},
    setShowEditState: dialogs.setShowEditState,
    setShowEditTransition: dialogs.setShowEditTransition,
    setShowEditGate: () => {},
    setFloatingToolbar: dialogs.setFloatingToolbar,
    setIsCreatingTransition: canvas.setIsCreatingTransition,
    setTransitionStartId: canvas.setTransitionStartId,
    setIsDraggingToCreateTransition: canvas.setIsDraggingToCreateTransition,
    setHoveredStateId: canvas.setHoveredStateId,
    transitionStartId: canvas.transitionStartId,
    justCompletedTransitionRef: canvas.justCompletedTransitionRef,
    transitionCompletedAtRef: canvas.transitionCompletedAtRef,
    setWaypoints: canvas.setWaypoints,
    addToast,
    pushToUndo,
  })
  const {
    addState,
    deleteState,
    updateStatePosition,
    startTransition,
    completeTransition,
    deleteTransition,
    cancelConnectMode,
    addTransitionGate,
  } = crudOperations

  // Import/export
  const ioOperations = useWorkflowIO({
    selectedWorkflow,
    states,
    transitions,
    isAdmin,
    setStates,
    setTransitions,
    setSelectedStateId: canvas.selectState,
    setSelectedTransitionId: canvas.selectTransition,
    addToast,
  })
  const {
    exportWorkflow,
    requestImport: importWorkflow,
    pendingImport,
    confirmImport,
    cancelImport,
    isImporting,
  } = ioOperations

  // Clipboard operations
  const clipboardOps = useClipboardOperations({
    selectedWorkflow,
    states,
    transitions,
    isAdmin,
    selectedStateId: canvas.selectedStateId,
    selectedTransitionId: canvas.selectedTransitionId,
    clipboard: dialogs.clipboard,
    setClipboard: dialogs.setClipboard,
    setStates,
    setTransitions,
    setSelectedStateId: canvas.selectState,
    setSelectedTransitionId: canvas.selectTransition,
    setFloatingToolbar: dialogs.setFloatingToolbar,
    addToast,
    pushToUndo,
  })
  const { handleCopy, handleCut, handlePaste, handleDeleteSelected } = clipboardOps

  // Floating toolbar actions
  const toolbarActions = useFloatingToolbarActions({
    states,
    transitions,
    waypoints: canvas.waypoints,
    floatingToolbar: dialogs.floatingToolbar,
    setStates,
    setTransitions,
    setWaypoints: canvas.setWaypoints,
    setFloatingToolbar: dialogs.setFloatingToolbar,
    setEditingState: dialogs.setEditingState,
    setEditingTransition: dialogs.setEditingTransition,
    setShowEditState: dialogs.setShowEditState,
    setShowEditTransition: dialogs.setShowEditTransition,
    deleteState,
    deleteTransition,
    addTransitionGate,
    addToast,
  })

  // Canvas mouse handlers - applySnapping now takes states as parameter
  const applySnappingWithStates = (stateId: string, x: number, y: number) => {
    return canvas.applySnapping(stateId, x, y, states)
  }

  const { handleCanvasMouseDown, handleCanvasMouseMove, handleCanvasMouseUp } = useCanvasHandlers({
    canvasRef: canvas.canvasRef,
    groupRef: canvas.groupRef,
    viewportRef: canvas.viewportRef,
    mousePosRef: canvas.mousePosRef,
    hasDraggedRef: canvas.hasDraggedRef,
    dragStartPosRef: canvas.dragStartPosRef,
    waypointHasDraggedRef: canvas.waypointHasDraggedRef,
    pan: canvas.pan,
    zoom: canvas.zoom,
    canvasMode: canvas.canvasMode,
    isCreatingTransition: canvas.isCreatingTransition,
    draggingStateId: canvas.draggingStateId,
    dragOffset: canvas.dragOffset,
    currentResizing: canvas.resizingState,
    draggingTransitionEndpoint: canvas.draggingTransitionEndpoint,
    waypoints: canvas.waypoints,
    draggingCurveControl: canvas.draggingCurveControl,
    draggingWaypointIndex: canvas.draggingWaypointIndex,
    draggingWaypointAxis: canvas.draggingWaypointAxis,
    tempCurvePos: canvas.tempCurvePos,
    draggingLabel: canvas.draggingLabel,
    tempLabelPos: canvas.tempLabelPos,
    states,
    transitions,
    hoveredStateId: canvas.hoveredStateId,
    isDraggingToCreateTransition: canvas.isDraggingToCreateTransition,
    setPan: canvas.setPan,
    setMousePos: canvas.setMousePos,
    setDraggingStateId: canvas.setDraggingStateId,
    setFloatingToolbar: dialogs.setFloatingToolbar,
    setAlignmentGuides: canvas.setAlignmentGuides,
    setStates,
    setTransitions,
    setHoveredStateId: canvas.setHoveredStateId,
    setTempCurvePos: canvas.setTempCurvePos,
    setTempLabelPos: canvas.setTempLabelPos,
    setWaypoints: canvas.setWaypoints,
    setPinnedLabelPositions: canvas.setPinnedLabelPositions,
    setDraggingTransitionEndpoint: canvas.setDraggingTransitionEndpoint,
    checkDragThreshold: canvas.checkDragThreshold,
    markHasDragged: canvas.markHasDragged,
    applySnapping: applySnappingWithStates,
    getDimensions: canvas.getDimensions,
    updateDimensions: canvas.updateDimensions,
    closeAll: dialogs.closeAll,
    clearAlignmentGuides: canvas.clearAlignmentGuides,
    updateStatePosition,
    stopDragging: canvas.stopDragging,
    stopResizing: canvas.stopResizing,
    updateEdgePosition: canvas.updateEdgePosition,
    stopWaypointDrag: canvas.stopWaypointDrag,
    stopLabelDrag: canvas.stopLabelDrag,
    cancelTransitionCreation: canvas.cancelTransitionCreation,
    clearSelection: canvas.clearSelection,
    addToast,
  })

  // Canvas event handlers (click, context menu, keyboard shortcuts)
  const {
    handleCanvasClick,
    handleCanvasContextMenu,
    handleStateStartDrag,
    handleStateStartResize,
    handleStateShowToolbar,
    handleTransitionShowToolbar,
    handleAddWaypointToTransition,
  } = useCanvasEvents({
    canvasRef: canvas.canvasRef,
    hasDraggedRef: canvas.hasDraggedRef,
    pan: canvas.pan,
    zoom: canvas.zoom,
    canvasMode: canvas.canvasMode,
    isCreatingTransition: canvas.isCreatingTransition,
    contextMenu: dialogs.contextMenu,
    floatingToolbar: dialogs.floatingToolbar,
    isAdmin,
    states,
    transitions,
    waypoints: canvas.waypoints,
    cancelTransitionCreation: canvas.cancelTransitionCreation,
    setContextMenu: dialogs.setContextMenu,
    closeContextMenu: dialogs.closeContextMenu,
    setFloatingToolbar: dialogs.setFloatingToolbar,
    clearSelection: canvas.clearSelection,
    startDragging: canvas.startDragging,
    startResizing: canvas.startResizing,
    getDimensions: canvas.getDimensions,
    showStateToolbar: dialogs.showStateToolbar,
    showTransitionToolbar: dialogs.showTransitionToolbar,
    addWaypoint: canvas.addWaypoint,
    handleCopy,
    handleCut,
    handlePaste,
    handleUndo,
    handleRedo,
    handleDeleteSelected,
  })

  // ============================================
  // STABLE HANDLER IDENTITIES
  // ============================================
  // Wrap handlers passed to memoized StateNode / TransitionLine children so that
  // recreated parent closures never bust memoization while still invoking the
  // latest logic (no stale pan/zoom/state captures).
  const stableStartDrag = useStableCallback(handleStateStartDrag)
  const stableStartResize = useStableCallback(handleStateStartResize)
  const stableShowStateToolbar = useStableCallback(handleStateShowToolbar)
  const stableCompleteTransition = useStableCallback(completeTransition)
  const stableStartTransition = useStableCallback(startTransition)
  const stableEditState = useStableCallback(dialogs.openEditState)
  const stableShowTransitionToolbar = useStableCallback(handleTransitionShowToolbar)
  const stableAddWaypoint = useStableCallback(handleAddWaypointToTransition)
  const stableShowTransitionContextMenu = useStableCallback(
    (transitionId: string, clientX: number, clientY: number, canvasX: number, canvasY: number) => {
      canvas.selectTransition(transitionId)
      dialogs.setFloatingToolbar(null)
      dialogs.setContextMenu({
        x: clientX,
        y: clientY,
        type: 'transition',
        targetId: transitionId,
        canvasX,
        canvasY,
      })
    },
  )

  // ============================================
  // GLOBAL POINTER HANDLING (smooth, drop-free drags)
  // ============================================
  // Route pointer move/up through window listeners while a gesture is active so
  // dragging never stops when the cursor leaves the canvas or moves quickly.
  // Moves are coalesced to one update per animation frame via rAF.
  const interacting = !!(
    canvas.draggingStateId ||
    canvas.resizingState ||
    canvas.draggingTransitionEndpoint ||
    canvas.draggingCurveControl ||
    canvas.draggingLabel ||
    canvas.isCreatingTransition
  )
  const interactingRef = useRef(interacting)
  interactingRef.current = interacting

  const moveHandlerRef = useRef(handleCanvasMouseMove)
  moveHandlerRef.current = handleCanvasMouseMove
  const upHandlerRef = useRef(handleCanvasMouseUp)
  upHandlerRef.current = handleCanvasMouseUp

  const [throttledPointerMove, cancelPointerMove] = useRafThrottle((e: PointerEvent) => {
    moveHandlerRef.current(e)
  })

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (interactingRef.current) throttledPointerMove(e)
    }
    const onUp = (e: PointerEvent) => {
      cancelPointerMove()
      if (interactingRef.current) void upHandlerRef.current(e)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [throttledPointerMove, cancelPointerMove])

  // ============================================
  // RENDER
  // ============================================

  const canvasTransform = `translate(${canvas.pan.x}, ${canvas.pan.y}) scale(${canvas.zoom})`

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex h-full">
        <WorkflowsList
          workflows={workflows}
          selectedWorkflowId={selectedWorkflow?.id || null}
          isLoading={isLoading}
          isAdmin={isAdmin}
          onSelectWorkflow={selectWorkflow}
          onEditWorkflow={(workflow) => {
            setSelectedWorkflow(workflow)
            dialogs.setShowEditWorkflow(true)
          }}
          onCreateWorkflow={() => dialogs.setShowCreateWorkflow(true)}
        />

        <div className="flex-1 flex flex-col">
          {selectedWorkflow && (
            <>
              <WorkflowToolbar
                workflows={workflows}
                selectedWorkflow={selectedWorkflow}
                states={states}
                isAdmin={isAdmin}
                canvasMode={canvas.canvasMode}
                zoom={canvas.zoom}
                isCreatingTransition={canvas.isCreatingTransition}
                snapSettings={canvas.snapSettings}
                showSnapSettings={dialogs.showSnapSettings}
                canvasRef={canvas.canvasRef}
                importInputRef={importInputRef}
                selectWorkflow={selectWorkflow}
                setShowCreateWorkflow={dialogs.setShowCreateWorkflow}
                setShowEditWorkflow={dialogs.setShowEditWorkflow}
                setCanvasMode={canvas.setCanvasMode}
                cancelConnectMode={cancelConnectMode}
                setZoom={canvas.setZoom}
                setPan={canvas.setPan}
                setSnapSettings={canvas.setSnapSettings}
                setShowSnapSettings={dialogs.setShowSnapSettings}
                exportWorkflow={exportWorkflow}
                importWorkflow={importWorkflow}
                addState={addState}
              />

              <WorkflowCanvas
                states={states}
                transitions={transitions}
                gates={gates}
                selectedStateId={canvas.selectedStateId}
                selectedTransitionId={canvas.selectedTransitionId}
                hoveredStateId={canvas.hoveredStateId}
                hoveredTransitionId={canvas.hoveredTransitionId}
                hoveredWaypoint={canvas.hoveredWaypoint}
                canvasMode={canvas.canvasMode}
                zoom={canvas.zoom}
                pan={canvas.pan}
                mousePos={canvas.mousePos}
                canvasRef={canvas.canvasRef}
                groupRef={canvas.groupRef}
                viewportRef={canvas.viewportRef}
                canvasTransform={canvasTransform}
                isAdmin={isAdmin}
                draggingStateId={canvas.draggingStateId}
                currentResizing={canvas.resizingState}
                isCreatingTransition={canvas.isCreatingTransition}
                transitionStartId={canvas.transitionStartId}
                isDraggingToCreateTransition={canvas.isDraggingToCreateTransition}
                draggingTransitionEndpoint={canvas.draggingTransitionEndpoint}
                justCompletedTransitionRef={canvas.justCompletedTransitionRef}
                transitionCompletedAtRef={canvas.transitionCompletedAtRef}
                hasDraggedRef={canvas.hasDraggedRef}
                stateDimensions={canvas.stateDimensions}
                getDimensions={canvas.getDimensions}
                snapSettings={canvas.snapSettings}
                alignmentGuides={canvas.alignmentGuides}
                waypoints={canvas.waypoints}
                edgePositions={canvas.edgePositions}
                draggingCurveControl={canvas.draggingCurveControl}
                draggingWaypointIndex={canvas.draggingWaypointIndex}
                tempCurvePos={canvas.tempCurvePos}
                waypointHasDraggedRef={canvas.waypointHasDraggedRef}
                labelOffsets={canvas.labelOffsets}
                pinnedLabelPositions={canvas.pinnedLabelPositions}
                draggingLabel={canvas.draggingLabel}
                tempLabelPos={canvas.tempLabelPos}
                floatingToolbar={dialogs.floatingToolbar}
                toolbarActions={toolbarActions}
                onCanvasMouseDown={handleCanvasMouseDown}
                onCanvasClick={handleCanvasClick}
                onCanvasContextMenu={handleCanvasContextMenu}
                onWheel={canvas.handleWheel}
                onSelectState={canvas.selectState}
                onSelectTransition={canvas.selectTransition}
                onStartDrag={stableStartDrag}
                onStartResize={stableStartResize}
                onCompleteTransition={stableCompleteTransition}
                onStartTransition={stableStartTransition}
                onEditState={stableEditState}
                onHoverState={canvas.setHoveredStateId}
                onShowStateToolbar={stableShowStateToolbar}
                onShowTransitionToolbar={stableShowTransitionToolbar}
                onShowTransitionContextMenu={stableShowTransitionContextMenu}
                onAddWaypointToTransition={stableAddWaypoint}
                setIsDraggingToCreateTransition={canvas.setIsDraggingToCreateTransition}
                setHoveredStateId={canvas.setHoveredStateId}
                setHoveredTransitionId={canvas.setHoveredTransitionId}
                setFloatingToolbar={dialogs.setFloatingToolbar}
                setDraggingTransitionEndpoint={canvas.setDraggingTransitionEndpoint}
                setDraggingCurveControl={canvas.setDraggingCurveControl}
                setDraggingWaypointIndex={canvas.setDraggingWaypointIndex}
                setDraggingWaypointAxis={canvas.setDraggingWaypointAxis}
                setTempCurvePos={canvas.setTempCurvePos}
                setDraggingLabel={canvas.setDraggingLabel}
                setTempLabelPos={canvas.setTempLabelPos}
                setHoveredWaypoint={canvas.setHoveredWaypoint}
                setWaypoints={canvas.setWaypoints}
                setWaypointContextMenu={dialogs.setWaypointContextMenu}
                setLabelOffsets={canvas.setLabelOffsets}
                setPinnedLabelPositions={canvas.setPinnedLabelPositions}
                addToast={addToast}
              />
            </>
          )}

          {!selectedWorkflow && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-plm-fg-muted">
                <GitBranch size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">Select a workflow to edit</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            importWorkflow(file)
          }
          if (importInputRef.current) {
            importInputRef.current.value = ''
          }
        }}
      />

      {/* Context menus */}
      <WorkflowContextMenus
        contextMenu={dialogs.contextMenu}
        waypointContextMenu={dialogs.waypointContextMenu}
        states={states}
        transitions={transitions}
        gates={gates}
        waypoints={canvas.waypoints}
        isAdmin={isAdmin}
        openEditState={dialogs.openEditState}
        openEditTransition={dialogs.openEditTransition}
        deleteState={deleteState}
        deleteTransition={deleteTransition}
        addTransitionGate={addTransitionGate}
        addState={addState}
        handleAddWaypointToTransition={handleAddWaypointToTransition}
        setWaypoints={canvas.setWaypoints}
        closeContextMenu={dialogs.closeContextMenu}
        setWaypointContextMenu={dialogs.setWaypointContextMenu}
        addToast={addToast}
      />

      {/* Dialogs */}
      <WorkflowDialogs
        showCreateWorkflow={dialogs.showCreateWorkflow}
        showEditWorkflow={dialogs.showEditWorkflow}
        showEditState={dialogs.showEditState}
        showEditTransition={dialogs.showEditTransition}
        selectedWorkflow={selectedWorkflow}
        editingState={dialogs.editingState}
        editingTransition={dialogs.editingTransition}
        createWorkflow={createWorkflow}
        updateWorkflow={updateWorkflow}
        deleteWorkflow={deleteWorkflow}
        setStates={setStates}
        setTransitions={setTransitions}
        setShowCreateWorkflow={dialogs.setShowCreateWorkflow}
        setShowEditWorkflow={dialogs.setShowEditWorkflow}
        closeEditState={dialogs.closeEditState}
        closeEditTransition={dialogs.closeEditTransition}
        addToast={addToast}
      />

      {/* Import Workflow Confirmation Dialog */}
      {pendingImport && selectedWorkflow && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={cancelImport}
        >
          <div
            className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-plm-fg mb-4">Import Workflow</h3>
            <p className="text-base text-plm-fg-muted mb-4">
              Import workflow from <strong>{pendingImport.file.name}</strong>?
              <br />
              <br />
              This will replace all existing states and transitions in{' '}
              <strong>{selectedWorkflow.name}</strong> with {pendingImport.stateCount} states and{' '}
              {pendingImport.transitionCount} transitions.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelImport} className="btn btn-ghost" disabled={isImporting}>
                Cancel
              </button>
              <button onClick={confirmImport} disabled={isImporting} className="btn btn-primary">
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
