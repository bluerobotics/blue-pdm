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
import { useRef } from 'react'
import { GitBranch } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'

import { useStableCallback } from './utils'

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
  useConnectionGesture,
  useGlobalPointerGestures,
  useWorkflowDialogs,
} from './hooks'

// Components
import { WorkflowCanvas } from './canvas'
import { WorkflowsList } from './WorkflowsList'
import { WorkflowToolbar } from './WorkflowToolbar'
import { WorkflowDialogs, WorkflowContextMenus } from './components'
import { ImportWorkflowDialog } from './dialogs/ImportWorkflowDialog'

// Types
import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowTransition,
  WorkflowGate,
} from '@/types/workflow'

// ============================================
// MAIN COMPONENT - Wraps content with Provider
// ============================================

export function WorkflowsView() {
  // Workflow data hook - manages Supabase data fetching
  const workflowData = useWorkflowData({})
  const { addToast } = usePDMStore()

  const reportLayoutError = useStableCallback((message: string) => {
    log.error('[Workflow]', 'Failed to save canvas layout', { message })
    addToast('error', t('workflows.layoutSaveFailed'))
  })

  return (
    // Keying on the workflow id remounts the canvas, so no selection, drag or
    // routing state can leak across a workflow switch.
    <WorkflowCanvasProvider
      key={workflowData.selectedWorkflow?.id ?? 'none'}
      workflowId={workflowData.selectedWorkflow?.id}
      states={workflowData.states}
      transitions={workflowData.transitions}
      setStates={workflowData.setStates}
      setTransitions={workflowData.setTransitions}
      onLayoutError={reportLayoutError}
    >
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
        reloadWorkflow={workflowData.reloadCurrentWorkflow}
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
  gates: Record<string, WorkflowGate[]>
  isLoading: boolean
  isAdmin: boolean
  setStates: React.Dispatch<React.SetStateAction<WorkflowState[]>>
  setTransitions: React.Dispatch<React.SetStateAction<WorkflowTransition[]>>
  setGates: React.Dispatch<React.SetStateAction<Record<string, WorkflowGate[]>>>
  setSelectedWorkflow: React.Dispatch<React.SetStateAction<WorkflowTemplate | null>>
  // Actions
  selectWorkflow: (workflow: WorkflowTemplate) => void
  createWorkflow: (name: string, description: string) => Promise<boolean>
  updateWorkflow: (id: string, updates: { name: string; description: string }) => Promise<boolean>
  deleteWorkflow: (id: string) => Promise<boolean>
  reloadWorkflow: () => Promise<void>
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
  reloadWorkflow,
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
    setTransitionStartAnchor: canvas.setTransitionStartAnchor,
    setIsDraggingToCreateTransition: canvas.setIsDraggingToCreateTransition,
    setHoveredStateId: canvas.setHoveredStateId,
    transitionStartId: canvas.transitionStartId,
    addToast,
    pushToUndo,
  })
  const {
    addState,
    deleteState,
    updateStatePosition,
    completeTransition,
    deleteTransition,
    addTransitionGate,
  } = crudOperations

  // Drawing a transition and re-anchoring one, resolved from geometry alone
  const {
    startConnection,
    startEndpointDrag,
    updateConnectionPointer,
    finishConnectionPointer,
    isConnectionActive,
  } = useConnectionGesture({
    isAdmin,
    states,
    transitions,
    stateDimensions: canvas.stateDimensions,
    viewportRef: canvas.viewportRef,
    connectionPreview: canvas.connectionPreview,
    isCreatingTransition: canvas.isCreatingTransition,
    transitionStartId: canvas.transitionStartId,
    transitionStartAnchor: canvas.transitionStartAnchor,
    setIsCreatingTransition: canvas.setIsCreatingTransition,
    setTransitionStartId: canvas.setTransitionStartId,
    setTransitionStartAnchor: canvas.setTransitionStartAnchor,
    setIsDraggingToCreateTransition: canvas.setIsDraggingToCreateTransition,
    cancelTransitionCreation: canvas.cancelTransitionCreation,
    draggingTransitionEndpoint: canvas.draggingTransitionEndpoint,
    setDraggingTransitionEndpoint: canvas.setDraggingTransitionEndpoint,
    setTransitions,
    updateEdgePosition: canvas.updateEdgePosition,
    setHoveredStateId: canvas.setHoveredStateId,
    setFloatingToolbar: dialogs.setFloatingToolbar,
    completeTransition,
    addToast,
  })

  // Import/export
  const ioOperations = useWorkflowIO({
    selectedWorkflow,
    states,
    transitions,
    gates,
    isAdmin,
    reloadWorkflow,
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
    deleteState,
    deleteTransition,
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
    dragOriginRef: canvas.dragOriginRef,
    waypointHasDraggedRef: canvas.waypointHasDraggedRef,
    pan: canvas.pan,
    zoom: canvas.zoom,
    canvasMode: canvas.canvasMode,
    draggingStateId: canvas.draggingStateId,
    dragOffset: canvas.dragOffset,
    currentResizing: canvas.resizingState,
    waypoints: canvas.waypoints,
    draggingCurveControl: canvas.draggingCurveControl,
    draggingWaypointIndex: canvas.draggingWaypointIndex,
    draggingWaypointAxis: canvas.draggingWaypointAxis,
    tempCurvePos: canvas.tempCurvePos,
    draggingLabel: canvas.draggingLabel,
    tempLabelPos: canvas.tempLabelPos,
    states,
    setPan: canvas.setPan,
    setDraggingStateId: canvas.setDraggingStateId,
    setFloatingToolbar: dialogs.setFloatingToolbar,
    setAlignmentGuides: canvas.setAlignmentGuides,
    setStates,
    setTempCurvePos: canvas.setTempCurvePos,
    setTempLabelPos: canvas.setTempLabelPos,
    setWaypoints: canvas.setWaypoints,
    setPinnedLabelPositions: canvas.setPinnedLabelPositions,
    updateConnectionPointer,
    finishConnectionPointer,
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
    stopWaypointDrag: canvas.stopWaypointDrag,
    stopLabelDrag: canvas.stopLabelDrag,
    clearSelection: canvas.clearSelection,
    pushToUndo,
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
  const stableStartConnection = useStableCallback(startConnection)
  const stableStartEndpointDrag = useStableCallback(startEndpointDrag)
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

  useGlobalPointerGestures({
    isInteracting: !!(
      canvas.draggingStateId ||
      canvas.resizingState ||
      canvas.draggingCurveControl ||
      canvas.draggingLabel ||
      isConnectionActive
    ),
    onPointerMove: handleCanvasMouseMove,
    onPointerUp: handleCanvasMouseUp,
  })

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
                cancelConnectMode={canvas.cancelTransitionCreation}
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
                canvasRef={canvas.canvasRef}
                groupRef={canvas.groupRef}
                viewportRef={canvas.viewportRef}
                canvasTransform={canvasTransform}
                isAdmin={isAdmin}
                draggingStateId={canvas.draggingStateId}
                currentResizing={canvas.resizingState}
                isCreatingTransition={canvas.isCreatingTransition}
                transitionStartId={canvas.transitionStartId}
                draggingTransitionEndpoint={canvas.draggingTransitionEndpoint}
                connectionPreview={canvas.connectionPreview}
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
                onStartConnection={stableStartConnection}
                onStartEndpointDrag={stableStartEndpointDrag}
                onEditState={stableEditState}
                onHoverState={canvas.setHoveredStateId}
                onShowStateToolbar={stableShowStateToolbar}
                onShowTransitionToolbar={stableShowTransitionToolbar}
                onShowTransitionContextMenu={stableShowTransitionContextMenu}
                onAddWaypointToTransition={stableAddWaypoint}
                setHoveredTransitionId={canvas.setHoveredTransitionId}
                setFloatingToolbar={dialogs.setFloatingToolbar}
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
                <p className="text-sm">{t('workflows.emptyCanvas')}</p>
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

      {pendingImport && selectedWorkflow && (
        <ImportWorkflowDialog
          pending={pendingImport}
          workflowName={selectedWorkflow.name}
          isImporting={isImporting}
          onConfirm={confirmImport}
          onCancel={cancelImport}
        />
      )}
    </div>
  )
}
