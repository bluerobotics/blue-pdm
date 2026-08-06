/**
 * File context menu component
 * Composes action components for a clean, maintainable structure
 *
 * Menu Structure:
 * - Primary actions (always visible): Open, Download, Check In/Out
 * - Grouped submenus: File Actions, Edit, Export
 * - Delete actions (always visible)
 * - Expandable "More Actions": Collaboration (where used, properties, refresh metadata, reviews, etc.)
 *   Only shown when total items exceed threshold (otherwise items shown inline)
 */
import React, { useState, useMemo } from 'react'
import { Clipboard, FileOutput, FolderOpen } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'

// Import action components
import {
  OpenActions,
  AssemblyActions,
  BulkAssemblyActions,
  DuplicateActions,
  FileSystemActions,
  FolderVisibilityActions,
  ClipboardActions,
  SyncActions,
  CheckoutActions,
  CollaborationActions,
  DeleteActions,
  ExportActions,
  ExportMetadataTableActions,
  useContextMenuSelectionState,
} from './actions'
import { ContextMenuGroup, ExpandableSection } from './components'
import { shouldShowExpandableSection, countCollaborationActions } from './utils'

export interface FileContextMenuProps {
  // Core menu data (required)
  contextMenu: { x: number; y: number; file: LocalFile }
  contextMenuAdjustedPos: { x: number; y: number } | null
  onClose: () => void

  // Ref for positioning (from useContextMenuState)
  contextMenuRef: React.RefObject<HTMLDivElement | null>

  // Files and context
  getContextMenuFiles: () => LocalFile[]

  // Platform (not in context)
  platform: string

  // Handlers for file operations
  onRefresh: (silent?: boolean) => void
  navigateToFolder: (path: string) => void
  startRenaming: (file: LocalFile) => void

  // Clipboard operations
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void

  // Checkout folder operations
  handleCheckoutFolder: (folder: LocalFile) => void
  handleCheckinFolder: (folder: LocalFile) => void

  // State change
  handleBulkStateChange: (files: LocalFile[], newState: string) => void

  // Modals and panels
  setDetailsPanelTab: (tab: 'properties' | 'whereused') => void
  setDetailsPanelVisible: (visible: boolean) => void
  handleOpenReviewModal: (file: LocalFile) => void
  handleOpenCheckoutRequestModal: (file: LocalFile) => void
  handleOpenMentionModal: (file: LocalFile) => void
  handleOpenECOModal: (file: LocalFile) => void

  // Watch and share
  watchingFiles: Set<string>
  isTogglingWatch: boolean
  handleToggleWatch: (file: LocalFile) => void
  isCreatingShareLink: boolean
  handleQuickShareLink: (file: LocalFile) => void

  // Delete operations
  setCustomConfirm: (
    state: {
      title: string
      message: string
      warning?: string
      confirmText: string
      confirmDanger?: boolean
      onConfirm: () => void
    } | null,
  ) => void
  setDeleteLocalCheckoutConfirm: (
    state: {
      checkedOutFiles: LocalFile[]
      allFilesToProcess: LocalFile[]
      contextFiles: LocalFile[]
    } | null,
  ) => void

  // Undo
  undoStack: Array<{ type: 'delete'; file: LocalFile; originalPath: string }>
  handleUndo: () => void

  // Submenu state
  showIgnoreSubmenu: boolean
  setShowIgnoreSubmenu: (value: boolean) => void
  showStateSubmenu: boolean
  setShowStateSubmenu: (value: boolean) => void
  ignoreSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  stateSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>

  // Files currently saving metadata
  savingConfigsToSW?: Set<string>
}

export function FileContextMenu({
  // Core menu data
  contextMenu,
  contextMenuAdjustedPos,
  onClose,
  contextMenuRef,
  getContextMenuFiles,
  platform,
  // Handlers
  onRefresh,
  navigateToFolder,
  startRenaming,
  handleCopy,
  handleCut,
  handlePaste,
  handleCheckoutFolder,
  handleCheckinFolder,
  handleBulkStateChange,
  setDetailsPanelTab,
  setDetailsPanelVisible,
  handleOpenReviewModal,
  handleOpenCheckoutRequestModal,
  handleOpenMentionModal,
  handleOpenECOModal,
  watchingFiles,
  isTogglingWatch,
  handleToggleWatch,
  isCreatingShareLink,
  handleQuickShareLink,
  setCustomConfirm,
  setDeleteLocalCheckoutConfirm,
  undoStack,
  handleUndo,
  showIgnoreSubmenu,
  setShowIgnoreSubmenu,
  showStateSubmenu,
  setShowStateSubmenu,
  ignoreSubmenuTimeoutRef,
  stateSubmenuTimeoutRef,
  savingConfigsToSW,
}: FileContextMenuProps) {
  // Get user and other values from store
  const { user, files, getEffectiveRole, solidworksIntegrationEnabled } = usePDMStore()

  // State for expandable section
  const [isExpanded, setIsExpanded] = useState(false)

  // Get context files
  const contextFiles = getContextMenuFiles()
  const multiSelect = contextFiles.length > 1
  const firstFile = contextFiles[0]
  // Use the selection state hook to compute counts and state
  const { counts, state, syncedFilesInSelection, unsyncedFilesInSelection } =
    useContextMenuSelectionState({
      contextFiles,
      userId: user?.id,
    })

  // Compute whether to show expandable "More Actions" section
  // Only show when total menu items exceed threshold, otherwise show all items inline
  const menuCountProps = useMemo(
    () => ({
      contextFiles,
      multiSelect,
      firstFile,
      counts,
      state,
      userId: user?.id,
      isAdmin: getEffectiveRole() === 'admin',
      solidworksEnabled: solidworksIntegrationEnabled,
      allFiles: files,
    }),
    [
      contextFiles,
      multiSelect,
      firstFile,
      counts,
      state,
      user?.id,
      getEffectiveRole,
      solidworksIntegrationEnabled,
      files,
    ],
  )

  const showExpandable = useMemo(
    () => shouldShowExpandableSection(menuCountProps),
    [menuCountProps],
  )

  const collaborationItemCount = useMemo(
    () => countCollaborationActions(menuCountProps),
    [menuCountProps],
  )

  // Close menu and clear submenus
  const handleCloseMenu = () => {
    onClose()
    setShowIgnoreSubmenu(false)
    setShowStateSubmenu(false)
    if (ignoreSubmenuTimeoutRef.current) {
      clearTimeout(ignoreSubmenuTimeoutRef.current)
    }
    if (stateSubmenuTimeoutRef.current) {
      clearTimeout(stateSubmenuTimeoutRef.current)
    }
  }

  // Check if we have items for the File Actions submenu (always true - Copy Name works for all files)
  const hasFileSystemActions = true

  // Export: SolidWorks sources and/or PDF & STEP (metadata table)
  const swExtensions = ['.sldprt', '.sldasm', '.slddrw']
  const pdfStepExtensions = new Set(['.pdf', '.step', '.stp', '.stpz', '.p21'])
  const hasSwExportActions = contextFiles.some((f) => {
    const ext = f.extension?.toLowerCase() || ''
    return swExtensions.includes(ext) && !f.isDirectory
  })
  const hasPdfStepTableExport = contextFiles.some((f) => {
    const ext = f.extension?.toLowerCase() || ''
    return !f.isDirectory && pdfStepExtensions.has(ext)
  })
  const hasExportActions = hasSwExportActions || hasPdfStepTableExport

  return (
    <>
      {/* Overlay to close menu on click */}
      <div
        className="fixed inset-0 z-50"
        onClick={handleCloseMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          handleCloseMenu()
        }}
      />

      {/* Context menu */}
      <div
        ref={contextMenuRef}
        className="context-menu z-[60]"
        style={{
          left: contextMenuAdjustedPos?.x ?? contextMenu.x,
          top: contextMenuAdjustedPos?.y ?? contextMenu.y,
        }}
      >
        {/* ===== PRIMARY ACTIONS (always visible) ===== */}

        {/* Open actions (open file, open folder, open all) */}
        <OpenActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
          navigateToFolder={navigateToFolder}
        />

        {/* Assembly actions (insert into open SolidWorks assembly) */}
        <AssemblyActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
        />

        {/* Duplicate a part together with its drawing, remapping the drawing's reference */}
        <DuplicateActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
        />

        {/* Bulk assembly actions (download/checkout/checkin all related files) */}
        <BulkAssemblyActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
        />

        {/* Sync actions (download, ignore, first check in) */}
        <SyncActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
          onRefresh={onRefresh}
          counts={counts}
          state={state}
          unsyncedFilesInSelection={unsyncedFilesInSelection}
          showIgnoreSubmenu={showIgnoreSubmenu}
          setShowIgnoreSubmenu={setShowIgnoreSubmenu}
          ignoreSubmenuTimeoutRef={ignoreSubmenuTimeoutRef}
        />

        {/* Checkout actions (checkout, checkin, discard, force release, change state) */}
        <CheckoutActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
          onRefresh={onRefresh}
          counts={counts}
          state={state}
          syncedFilesInSelection={syncedFilesInSelection}
          handleCheckoutFolder={handleCheckoutFolder}
          handleCheckinFolder={handleCheckinFolder}
          handleBulkStateChange={handleBulkStateChange}
          showStateSubmenu={showStateSubmenu}
          setShowStateSubmenu={setShowStateSubmenu}
          stateSubmenuTimeoutRef={stateSubmenuTimeoutRef}
          savingConfigsToSW={savingConfigsToSW}
        />

        {/* ===== GROUPED SUBMENUS ===== */}
        <div className="context-menu-separator" />

        {/* File Actions submenu (show in explorer, copy path, pin, rename) */}
        <ContextMenuGroup label="File Actions" icon={FolderOpen} hasItems={hasFileSystemActions}>
          <FileSystemActions
            contextFiles={contextFiles}
            multiSelect={multiSelect}
            firstFile={firstFile}
            onClose={onClose}
            platform={platform}
            startRenaming={startRenaming}
            userId={user?.id}
          />
          <FolderVisibilityActions
            contextFiles={contextFiles}
            multiSelect={multiSelect}
            firstFile={firstFile}
            onClose={onClose}
          />
        </ContextMenuGroup>

        {/* Edit submenu (copy, cut, paste) */}
        <ContextMenuGroup label="Edit" icon={Clipboard}>
          <ClipboardActions
            contextFiles={contextFiles}
            multiSelect={multiSelect}
            firstFile={firstFile}
            onClose={onClose}
            handleCopy={handleCopy}
            handleCut={handleCut}
            handlePaste={handlePaste}
          />
        </ContextMenuGroup>

        {/* Export submenu (SolidWorks STEP, IGES, STL, PDF, DXF) */}
        <ContextMenuGroup label="Export" icon={FileOutput} hasItems={hasExportActions}>
          <ExportMetadataTableActions
            contextFiles={contextFiles}
            multiSelect={multiSelect}
            firstFile={firstFile}
            onClose={onClose}
          />
          <ExportActions
            contextFiles={contextFiles}
            multiSelect={multiSelect}
            firstFile={firstFile}
            onClose={onClose}
          />
        </ContextMenuGroup>

        {/* ===== DELETE ACTIONS (always visible) ===== */}
        <DeleteActions
          contextFiles={contextFiles}
          multiSelect={multiSelect}
          firstFile={firstFile}
          onClose={onClose}
          onRefresh={onRefresh}
          counts={counts}
          state={state}
          setCustomConfirm={setCustomConfirm}
          setDeleteLocalCheckoutConfirm={setDeleteLocalCheckoutConfirm}
          undoStack={undoStack}
          handleUndo={handleUndo}
        />

        {/* ===== COLLABORATION ACTIONS ===== */}
        {/* Show in expandable section only when total items exceed threshold */}
        {showExpandable ? (
          <ExpandableSection
            expanded={isExpanded}
            onToggle={() => setIsExpanded(!isExpanded)}
            hiddenCount={isExpanded ? undefined : collaborationItemCount}
          >
            <CollaborationActions
              contextFiles={contextFiles}
              multiSelect={multiSelect}
              firstFile={firstFile}
              onClose={onClose}
              onRefresh={onRefresh}
              state={state}
              setDetailsPanelTab={setDetailsPanelTab}
              setDetailsPanelVisible={setDetailsPanelVisible}
              handleOpenReviewModal={handleOpenReviewModal}
              handleOpenCheckoutRequestModal={handleOpenCheckoutRequestModal}
              handleOpenMentionModal={handleOpenMentionModal}
              handleOpenECOModal={handleOpenECOModal}
              watchingFiles={watchingFiles}
              isTogglingWatch={isTogglingWatch}
              handleToggleWatch={handleToggleWatch}
              isCreatingShareLink={isCreatingShareLink}
              handleQuickShareLink={handleQuickShareLink}
            />
          </ExpandableSection>
        ) : (
          /* Show collaboration actions inline when few total items */
          <>
            <div className="context-menu-separator" />
            <CollaborationActions
              contextFiles={contextFiles}
              multiSelect={multiSelect}
              firstFile={firstFile}
              onClose={onClose}
              onRefresh={onRefresh}
              state={state}
              setDetailsPanelTab={setDetailsPanelTab}
              setDetailsPanelVisible={setDetailsPanelVisible}
              handleOpenReviewModal={handleOpenReviewModal}
              handleOpenCheckoutRequestModal={handleOpenCheckoutRequestModal}
              handleOpenMentionModal={handleOpenMentionModal}
              handleOpenECOModal={handleOpenECOModal}
              watchingFiles={watchingFiles}
              isTogglingWatch={isTogglingWatch}
              handleToggleWatch={handleToggleWatch}
              isCreatingShareLink={isCreatingShareLink}
              handleQuickShareLink={handleQuickShareLink}
            />
          </>
        )}
      </div>
    </>
  )
}
