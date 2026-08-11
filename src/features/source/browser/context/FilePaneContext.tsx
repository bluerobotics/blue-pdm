import {
  createContext,
  useContext,
  useState,
  useRef,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type {
  ContextMenuState,
  ColumnContextMenuState,
  ConfigContextMenuState,
  CustomConfirmState,
  DeleteLocalCheckoutConfirmState,
  ConflictDialogState,
  SelectionBox,
  ConfigWithDepth,
  FolderMetrics,
} from '../types'
import type { FileMetadataColumn } from '@/types/database'

// Context value type - provides all state needed by FilePane child components
export interface FilePaneContextValue {
  // Core state from store
  files: LocalFile[]
  selectedFiles: string[]
  currentFolder: string
  vaultPath: string | null
  user: { id: string; avatar_url?: string | null; full_name?: string | null; email?: string } | null

  // Store-derived settings
  columns: { id: string; label: string; width: number; visible: boolean; sortable: boolean }[]
  lowercaseExtensions: boolean
  listRowSize: number

  // Custom metadata columns (from organization)
  customMetadataColumns: FileMetadataColumn[]

  // Local state
  contextMenu: ContextMenuState | null
  setContextMenu: (menu: ContextMenuState | null) => void
  emptyContextMenu: { x: number; y: number } | null
  setEmptyContextMenu: (menu: { x: number; y: number } | null) => void
  columnContextMenu: ColumnContextMenuState | null
  setColumnContextMenu: (menu: ColumnContextMenuState | null) => void
  configContextMenu: ConfigContextMenuState | null
  setConfigContextMenu: (menu: ConfigContextMenuState | null) => void

  // Drag state
  isDraggingOver: boolean
  setIsDraggingOver: (dragging: boolean) => void
  isExternalDrag: boolean
  setIsExternalDrag: (external: boolean) => void
  dragOverFolder: string | null
  setDragOverFolder: (folder: string | null) => void
  draggedFiles: LocalFile[]
  setDraggedFiles: (files: LocalFile[]) => void

  // Selection
  selectionBox: SelectionBox | null
  setSelectionBox: (box: SelectionBox | null) => void
  lastClickedIndex: number | null
  setLastClickedIndex: (index: number | null) => void

  // Rename state
  renamingFile: LocalFile | null
  setRenamingFile: (file: LocalFile | null) => void
  renameValue: string
  setRenameValue: (value: string) => void

  // Highlight state (read-only name selection for copying)
  highlightingFile: LocalFile | null
  setHighlightingFile: (file: LocalFile | null) => void

  // Delete state
  deleteConfirm: LocalFile | null
  setDeleteConfirm: (file: LocalFile | null) => void
  deleteEverywhere: boolean
  setDeleteEverywhere: (everywhere: boolean) => void

  // Dialog states
  customConfirm: CustomConfirmState | null
  setCustomConfirm: (confirm: CustomConfirmState | null) => void
  deleteLocalCheckoutConfirm: DeleteLocalCheckoutConfirmState | null
  setDeleteLocalCheckoutConfirm: (confirm: DeleteLocalCheckoutConfirmState | null) => void
  conflictDialog: ConflictDialogState | null
  setConflictDialog: (dialog: ConflictDialogState | null) => void

  // Column state
  resizingColumn: string | null
  setResizingColumn: (column: string | null) => void
  draggingColumn: string | null
  setDraggingColumn: (column: string | null) => void
  dragOverColumn: string | null
  setDragOverColumn: (column: string | null) => void

  // Configuration state (SolidWorks) - read from Zustand store
  // Note: setters are accessed via usePDMStore directly, not through context
  expandedConfigFiles: Set<string>
  expandedConfigSections: Set<string>
  fileConfigurations: Map<string, ConfigWithDepth[]>
  loadingConfigs: Set<string>
  selectedConfigs: Set<string>

  // Configuration BOM state - read from Zustand store
  expandedConfigBoms: Set<string>
  configBomData: Map<string, import('@/stores/types').ConfigBomItem[]>
  loadingConfigBoms: Set<string>

  // Drawing reference state (for .slddrw files showing referenced models) - read from Zustand store
  expandedDrawingRefs: Set<string>
  drawingRefData: Map<string, import('@/stores/types').DrawingRefItem[]>
  loadingDrawingRefs: Set<string>
  expandedDrawingRefFiles: Set<string>

  // Config -> drawings state (for part/assembly configs showing which drawings reference them) - read from Zustand store
  expandedConfigDrawings: Set<string>
  configDrawingData: Map<string, import('@/stores/types').DrawingRefItem[]>
  loadingConfigDrawings: Set<string>

  // Clipboard (read from Zustand store - single source of truth)
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null

  // Pending scroll target (transient - set when navigating to a file from a reference row)
  pendingScrollToFile: string | null

  // Editing
  editingCell: { path: string; column: string } | null
  setEditingCell: (cell: { path: string; column: string } | null) => void
  editValue: string
  setEditValue: (value: string) => void

  // New folder
  isCreatingFolder: boolean
  setIsCreatingFolder: (creating: boolean) => void
  newFolderName: string
  setNewFolderName: (name: string) => void

  // Machine ID
  currentMachineId: string | null

  // Folder metrics (computed from files)
  folderMetrics: Map<string, FolderMetrics>
  setFolderMetrics: (metrics: Map<string, FolderMetrics>) => void

  // Inline action hover states (for multi-select highlighting)
  isDownloadHovered: boolean
  setIsDownloadHovered: (hovered: boolean) => void
  isUploadHovered: boolean
  setIsUploadHovered: (hovered: boolean) => void
  isCheckoutHovered: boolean
  setIsCheckoutHovered: (hovered: boolean) => void
  isCheckinHovered: boolean
  setIsCheckinHovered: (hovered: boolean) => void
  isUpdateHovered: boolean
  setIsUpdateHovered: (hovered: boolean) => void
  isConfigCommitHovered: boolean
  setIsConfigCommitHovered: (hovered: boolean) => void

  // Refs
  tableRef: React.RefObject<HTMLDivElement | null>
  contextMenuRef: React.RefObject<HTMLDivElement | null>
  renameInputRef: React.RefObject<HTMLInputElement | null>
  highlightInputRef: React.RefObject<HTMLInputElement | null>
  newFolderInputRef: React.RefObject<HTMLInputElement | null>
  inlineEditInputRef: React.RefObject<HTMLInputElement | null>

  // Callbacks
  onRefresh: (silent?: boolean) => void
}

const FilePaneContext = createContext<FilePaneContextValue | null>(null)

export interface FilePaneProviderProps {
  children: ReactNode
  onRefresh: (silent?: boolean) => void
  /** Optional custom metadata columns from organization */
  customMetadataColumns?: FileMetadataColumn[]
  /** Rename state - passed from useRenameState hook to avoid duplicate state */
  renameState?: {
    renamingFile: LocalFile | null
    setRenamingFile: (file: LocalFile | null) => void
    renameValue: string
    setRenameValue: (value: string) => void
    renameInputRef: React.RefObject<HTMLInputElement | null>
    highlightingFile: LocalFile | null
    setHighlightingFile: (file: LocalFile | null) => void
    highlightInputRef: React.RefObject<HTMLInputElement | null>
    isCreatingFolder: boolean
    setIsCreatingFolder: (creating: boolean) => void
    newFolderName: string
    setNewFolderName: (name: string) => void
    newFolderInputRef: React.RefObject<HTMLInputElement | null>
    editingCell: { path: string; column: string } | null
    setEditingCell: (cell: { path: string; column: string } | null) => void
    editValue: string
    setEditValue: (value: string) => void
    inlineEditInputRef: React.RefObject<HTMLInputElement | null>
  }
  /**
   * Table container ref - passed from FilePane.tsx so the virtualizer can measure the scroll container.
   * CRITICAL: If not provided, the virtualizer won't be able to render items because
   * getScrollElement() will return null.
   */
  tableRef?: React.RefObject<HTMLDivElement | null>
  /**
   * Pre-computed folder metrics from useFolderMetrics hook.
   * CRITICAL: If not provided, folder inline action buttons won't render because
   * the context's local folderMetrics Map will be empty.
   */
  folderMetrics?: Map<string, FolderMetrics>
}

export function FilePaneProvider({
  children,
  onRefresh,
  customMetadataColumns = [],
  renameState,
  tableRef: externalTableRef,
  folderMetrics: externalFolderMetrics,
}: FilePaneProviderProps) {
  // Get store state
  const files = usePDMStore((s) => s.files)
  const selectedFiles = usePDMStore((s) => s.selectedFiles)
  const currentFolder = usePDMStore((s) => s.currentFolder)
  const vaultPath = usePDMStore((s) => s.vaultPath)
  const user = usePDMStore((s) => s.user)
  const columns = usePDMStore((s) => s.columns)
  const lowercaseExtensions = usePDMStore((s) => s.lowercaseExtensions)
  const listRowSize = usePDMStore((s) => s.listRowSize)

  // SolidWorks configuration state from store (similar to expandedFolders/selectedFiles)
  // Note: setters are accessed via usePDMStore directly in handlers, not passed through context
  const expandedConfigFiles = usePDMStore((s) => s.expandedConfigFiles)
  const expandedConfigSections = usePDMStore((s) => s.expandedConfigSections)
  const selectedConfigs = usePDMStore((s) => s.selectedConfigs)
  const fileConfigurations = usePDMStore((s) => s.fileConfigurations)
  const loadingConfigs = usePDMStore((s) => s.loadingConfigs)

  // Configuration BOM state from store
  const expandedConfigBoms = usePDMStore((s) => s.expandedConfigBoms)
  const configBomData = usePDMStore((s) => s.configBomData)
  const loadingConfigBoms = usePDMStore((s) => s.loadingConfigBoms)

  // Drawing reference state from store (for .slddrw files showing referenced models)
  const expandedDrawingRefs = usePDMStore((s) => s.expandedDrawingRefs)
  const drawingRefData = usePDMStore((s) => s.drawingRefData)
  const loadingDrawingRefs = usePDMStore((s) => s.loadingDrawingRefs)
  const expandedDrawingRefFiles = usePDMStore((s) => s.expandedDrawingRefFiles)

  // Config -> drawings state from store (for part/assembly configs showing referencing drawings)
  const expandedConfigDrawings = usePDMStore((s) => s.expandedConfigDrawings)
  const configDrawingData = usePDMStore((s) => s.configDrawingData)
  const loadingConfigDrawings = usePDMStore((s) => s.loadingConfigDrawings)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [columnContextMenu, setColumnContextMenu] = useState<ColumnContextMenuState | null>(null)
  const [configContextMenu, setConfigContextMenu] = useState<ConfigContextMenuState | null>(null)

  // Drag state
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isExternalDrag, setIsExternalDrag] = useState(false)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [draggedFiles, setDraggedFiles] = useState<LocalFile[]>([])

  // Selection
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)

  // Rename state - use props if provided (from useRenameState hook), otherwise create local state
  // This avoids duplicate state between useRenameState hook and context
  const [localRenamingFile, setLocalRenamingFile] = useState<LocalFile | null>(null)
  const [localRenameValue, setLocalRenameValue] = useState('')
  const [localHighlightingFile, setLocalHighlightingFile] = useState<LocalFile | null>(null)
  const [localIsCreatingFolder, setLocalIsCreatingFolder] = useState(false)
  const [localNewFolderName, setLocalNewFolderName] = useState('')
  const [localEditingCell, setLocalEditingCell] = useState<{ path: string; column: string } | null>(
    null,
  )
  const [localEditValue, setLocalEditValue] = useState('')
  const localRenameInputRef = useRef<HTMLInputElement>(null)
  const localHighlightInputRef = useRef<HTMLInputElement>(null)
  const localNewFolderInputRef = useRef<HTMLInputElement>(null)
  const localInlineEditInputRef = useRef<HTMLInputElement>(null)

  // Use passed state if available, otherwise use local state
  const renamingFile = renameState?.renamingFile ?? localRenamingFile
  const setRenamingFile = renameState?.setRenamingFile ?? setLocalRenamingFile
  const renameValue = renameState?.renameValue ?? localRenameValue
  const setRenameValue = renameState?.setRenameValue ?? setLocalRenameValue
  const highlightingFile = renameState?.highlightingFile ?? localHighlightingFile
  const setHighlightingFile = renameState?.setHighlightingFile ?? setLocalHighlightingFile
  const isCreatingFolder = renameState?.isCreatingFolder ?? localIsCreatingFolder
  const setIsCreatingFolder = renameState?.setIsCreatingFolder ?? setLocalIsCreatingFolder
  const newFolderName = renameState?.newFolderName ?? localNewFolderName
  const setNewFolderName = renameState?.setNewFolderName ?? setLocalNewFolderName
  const editingCell = renameState?.editingCell ?? localEditingCell
  const setEditingCell = renameState?.setEditingCell ?? setLocalEditingCell
  const editValue = renameState?.editValue ?? localEditValue
  const setEditValue = renameState?.setEditValue ?? setLocalEditValue
  const renameInputRef = renameState?.renameInputRef ?? localRenameInputRef
  const highlightInputRef = renameState?.highlightInputRef ?? localHighlightInputRef
  const newFolderInputRef = renameState?.newFolderInputRef ?? localNewFolderInputRef
  const inlineEditInputRef = renameState?.inlineEditInputRef ?? localInlineEditInputRef

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState<LocalFile | null>(null)
  const [deleteEverywhere, setDeleteEverywhere] = useState(false)

  // Dialog states
  const [customConfirm, setCustomConfirm] = useState<CustomConfirmState | null>(null)
  const [deleteLocalCheckoutConfirm, setDeleteLocalCheckoutConfirm] =
    useState<DeleteLocalCheckoutConfirmState | null>(null)
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState | null>(null)

  // Column state
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  // Configuration state is now passed as props from FilePane.tsx
  // to share state with useConfigHandlers hook

  // Clipboard - read from Zustand store (single source of truth)
  const clipboard = usePDMStore((s) => s.clipboard)

  // Pending scroll target - read from Zustand store (set by click handlers, consumed by FileListBody)
  const pendingScrollToFile = usePDMStore((s) => s.pendingScrollToFile)

  // Machine ID (loaded once)
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)

  // Folder metrics - use external if provided (from FilePane.tsx useFolderMetrics hook)
  // CRITICAL: The external metrics must be used so folder inline action buttons render correctly
  const [localFolderMetrics, setLocalFolderMetrics] = useState<Map<string, FolderMetrics>>(
    new Map(),
  )
  const folderMetrics = externalFolderMetrics ?? localFolderMetrics
  const setFolderMetrics = setLocalFolderMetrics

  // Inline action hover states
  const [isDownloadHovered, setIsDownloadHovered] = useState(false)
  const [isUploadHovered, setIsUploadHovered] = useState(false)
  const [isCheckoutHovered, setIsCheckoutHovered] = useState(false)
  const [isCheckinHovered, setIsCheckinHovered] = useState(false)
  const [isUpdateHovered, setIsUpdateHovered] = useState(false)
  const [isConfigCommitHovered, setIsConfigCommitHovered] = useState(false)

  // Refs
  // Use external tableRef if provided (from FilePane.tsx), otherwise create local ref
  // CRITICAL: The external ref must be used so the virtualizer can measure the scroll container
  const localTableRef = useRef<HTMLDivElement>(null)
  const tableRef = externalTableRef ?? localTableRef
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Load machine ID on mount
  useEffect(() => {
    window.electronAPI?.getMachineId?.().then((id) => {
      if (id) setCurrentMachineId(id)
    })
  }, [])

  const value = useMemo<FilePaneContextValue>(
    () => ({
      // Core state
      files,
      selectedFiles,
      currentFolder,
      vaultPath,
      user,

      // Store-derived settings
      columns,
      lowercaseExtensions,
      listRowSize,

      // Custom metadata columns
      customMetadataColumns,

      // Context menus
      contextMenu,
      setContextMenu,
      emptyContextMenu,
      setEmptyContextMenu,
      columnContextMenu,
      setColumnContextMenu,
      configContextMenu,
      setConfigContextMenu,

      // Drag
      isDraggingOver,
      setIsDraggingOver,
      isExternalDrag,
      setIsExternalDrag,
      dragOverFolder,
      setDragOverFolder,
      draggedFiles,
      setDraggedFiles,

      // Selection
      selectionBox,
      setSelectionBox,
      lastClickedIndex,
      setLastClickedIndex,

      // Rename
      renamingFile,
      setRenamingFile,
      renameValue,
      setRenameValue,

      // Highlight (read-only name selection)
      highlightingFile,
      setHighlightingFile,

      // Delete
      deleteConfirm,
      setDeleteConfirm,
      deleteEverywhere,
      setDeleteEverywhere,

      // Dialogs
      customConfirm,
      setCustomConfirm,
      deleteLocalCheckoutConfirm,
      setDeleteLocalCheckoutConfirm,
      conflictDialog,
      setConflictDialog,

      // Columns
      resizingColumn,
      setResizingColumn,
      draggingColumn,
      setDraggingColumn,
      dragOverColumn,
      setDragOverColumn,

      // Configurations (read from Zustand store, setters accessed via usePDMStore directly)
      expandedConfigFiles,
      expandedConfigSections,
      fileConfigurations,
      loadingConfigs,
      selectedConfigs,

      // Configuration BOM (from Zustand store)
      expandedConfigBoms,
      configBomData,
      loadingConfigBoms,

      // Drawing references (from Zustand store)
      expandedDrawingRefs,
      drawingRefData,
      loadingDrawingRefs,
      expandedDrawingRefFiles,

      // Config -> drawings (from Zustand store)
      expandedConfigDrawings,
      configDrawingData,
      loadingConfigDrawings,

      // Clipboard (from Zustand store)
      clipboard,

      // Pending scroll target (from Zustand store)
      pendingScrollToFile,

      // Editing
      editingCell,
      setEditingCell,
      editValue,
      setEditValue,

      // New folder
      isCreatingFolder,
      setIsCreatingFolder,
      newFolderName,
      setNewFolderName,

      // Machine ID
      currentMachineId,

      // Folder metrics
      folderMetrics,
      setFolderMetrics,

      // Inline action hover states
      isDownloadHovered,
      setIsDownloadHovered,
      isUploadHovered,
      setIsUploadHovered,
      isCheckoutHovered,
      setIsCheckoutHovered,
      isCheckinHovered,
      setIsCheckinHovered,
      isUpdateHovered,
      setIsUpdateHovered,
      isConfigCommitHovered,
      setIsConfigCommitHovered,

      // Refs
      tableRef,
      contextMenuRef,
      renameInputRef,
      highlightInputRef,
      newFolderInputRef,
      inlineEditInputRef,

      // Callbacks
      onRefresh,
    }),
    [
      files,
      selectedFiles,
      currentFolder,
      vaultPath,
      user,
      columns,
      lowercaseExtensions,
      listRowSize,
      customMetadataColumns,
      contextMenu,
      emptyContextMenu,
      columnContextMenu,
      configContextMenu,
      isDraggingOver,
      isExternalDrag,
      dragOverFolder,
      draggedFiles,
      selectionBox,
      lastClickedIndex,
      renamingFile,
      renameValue,
      highlightingFile,
      deleteConfirm,
      deleteEverywhere,
      customConfirm,
      deleteLocalCheckoutConfirm,
      conflictDialog,
      resizingColumn,
      draggingColumn,
      dragOverColumn,
      expandedConfigFiles,
      expandedConfigSections,
      fileConfigurations,
      loadingConfigs,
      selectedConfigs,
      expandedConfigBoms,
      configBomData,
      loadingConfigBoms,
      expandedDrawingRefs,
      drawingRefData,
      loadingDrawingRefs,
      expandedDrawingRefFiles,
      expandedConfigDrawings,
      configDrawingData,
      loadingConfigDrawings,
      clipboard,
      pendingScrollToFile,
      editingCell,
      editValue,
      isCreatingFolder,
      newFolderName,
      currentMachineId,
      folderMetrics,
      isDownloadHovered,
      isUploadHovered,
      isCheckoutHovered,
      isCheckinHovered,
      isUpdateHovered,
      isConfigCommitHovered,
      onRefresh,
    ],
  )

  return <FilePaneContext.Provider value={value}>{children}</FilePaneContext.Provider>
}

export function useFilePaneContext() {
  const context = useContext(FilePaneContext)
  if (!context) {
    throw new Error('useFilePaneContext must be used within FilePaneProvider')
  }
  return context
}
