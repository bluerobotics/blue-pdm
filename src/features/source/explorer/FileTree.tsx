// TODO(decompose): Extract to FileTreeVaultSection.tsx — renderVaultSection function including vault stats, drag handlers, and virtualized tree rendering (lines ~808–1091)
// TODO(decompose): Extract to FileTreeDialogs.tsx — disconnect vault dialog, vault properties modal, and new folder dialog (lines ~1369–1761)
// TODO(decompose): Extract to FileTreeBatchActions.tsx — batch operation handlers (download all, update outdated, first-checkin, check-in my checkouts, checkout all) (lines ~507–595)

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import {
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Database,
  Cloud,
  Loader2,
  Unlink,
  FolderOpen as FolderOpenIcon,
  AlertTriangle,
  Check,
  Info,
  RefreshCw,
  Plus,
  Lock,
  X,
  Filter,
  CloudOff,
  FolderMinus,
} from 'lucide-react'
// Shared file/folder components
import { FileIcon, type CheckoutUser } from '@/components/shared/FileItem'
// Use command system for PDM operations
import { executeCommand } from '@/lib/commands'
import { usePDMStore, LocalFile, ConnectedVault } from '@/stores/pdmStore'
// Context menu from feature module
import { FileContextMenu } from '@/features/source/context-menu'
// Selection box overlay from browser feature
import { SelectionBoxOverlay } from '@/features/source/browser'
// FileTree sub-components
import { VaultTreeItem } from './file-tree/VaultTreeItem'
import { PinnedFoldersSection } from './file-tree/PinnedFoldersSection'
import { NoVaultAccessMessage } from './file-tree/RecentVaultsSection'
import { VirtualizedTreeRow } from './file-tree/VirtualizedTreeRow'
import { TreeHoverProvider } from './file-tree/TreeHoverContext'
// FileTree hooks
import { useVaultTree } from './file-tree/hooks/useVaultTree'
import { useFlattenedTree } from './file-tree/hooks/useFlattenedTree'
import { useTreeDragDrop } from './file-tree/hooks/useTreeDragDrop'
import { useTreeKeyboardNav } from './file-tree/hooks/useTreeKeyboardNav'
// Shared hooks
import {
  useSelectionCategories,
  useClipboard,
  useSelectionBox,
  useSlowDoubleClick,
  useAutoScrollOnDrag,
} from '@/hooks'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
// Logging
import { logExplorer } from '@/lib/userActionLogger'
// Constants
import {
  TREE_BASE_PADDING_PX,
  TREE_INDENT_PX,
  DIFF_STATUS_CLASS_PREFIX,
  SOLIDWORKS_EXTENSIONS,
  PDM_FILES_DATA_TYPE,
  getTreeRowHeight,
} from './file-tree/constants'

interface FileTreeProps {
  onOpenVault?: () => void
  onOpenRecentVault?: (path: string) => void
  onRefresh?: (silent?: boolean, forceHashComputation?: boolean) => void
}

export function FileTree({ onRefresh }: FileTreeProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTIVE ZUSTAND SELECTORS
  // Split monolithic usePDMStore() into individual selectors to prevent
  // unnecessary re-renders. Each selector only triggers re-render when its
  // specific value changes.
  //
  // Pattern: Use useShallow() wrapper for object/array selectors to enable
  // shallow equality comparison (Zustand v5+ API).
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Data Selectors (arrays/objects use useShallow wrapper) ────────────────
  const files = usePDMStore((s) => s.files)
  const expandedFolders = usePDMStore((s) => s.expandedFolders)
  const connectedVaults = usePDMStore(useShallow((s) => s.connectedVaults))
  const pinnedFolders = usePDMStore(useShallow((s) => s.pinnedFolders))
  const selectedFiles = usePDMStore(useShallow((s) => s.selectedFiles))

  // ─── Primitive Selectors (no equality function needed) ─────────────────────
  const vaultPath = usePDMStore((s) => s.vaultPath)
  const currentFolder = usePDMStore((s) => s.currentFolder)
  const activeVaultId = usePDMStore((s) => s.activeVaultId)
  const pinnedSectionExpanded = usePDMStore((s) => s.pinnedSectionExpanded)
  const lowercaseExtensions = usePDMStore((s) => s.lowercaseExtensions)
  const isLoading = usePDMStore((s) => s.isLoading)
  const filesLoaded = usePDMStore((s) => s.filesLoaded)
  const hideSolidworksTempFiles = usePDMStore((s) => s.hideSolidworksTempFiles)
  const hideCloudOnlyFolders = usePDMStore((s) => s.hideCloudOnlyFolders)
  const setHideCloudOnlyFolders = usePDMStore((s) => s.setHideCloudOnlyFolders)
  const treeRowSize = usePDMStore((s) => s.treeRowSize)
  const tabsEnabled = usePDMStore((s) => s.tabsEnabled)
  const activeTabId = usePDMStore((s) => s.activeTabId)

  // ─── User Selectors ────────────────────────────────────────────────────────
  const user = usePDMStore((s) => s.user)
  const impersonatedUser = usePDMStore((s) => s.impersonatedUser)

  // ─── Admin-only folder visibility ──────────────────────────────────────────
  const { isMarkedHidden } = useHiddenFolders()

  // ─── Offline Mode & Staged Checkin Selectors ────────────────────────────────
  const isOfflineMode = usePDMStore((s) => s.isOfflineMode)
  const { stageCheckin, unstageCheckin, getStagedCheckin } = usePDMStore(
    useShallow((s) => ({
      stageCheckin: s.stageCheckin,
      unstageCheckin: s.unstageCheckin,
      getStagedCheckin: s.getStagedCheckin,
    })),
  )

  // ─── Action Selectors (grouped by domain, useShallow wrapper) ──────────────
  // Folder actions
  const { toggleFolder, setCurrentFolder, updateTabFolder } = usePDMStore(
    useShallow((s) => ({
      toggleFolder: s.toggleFolder,
      setCurrentFolder: s.setCurrentFolder,
      updateTabFolder: s.updateTabFolder,
    })),
  )

  // Vault actions
  const {
    toggleVaultExpanded,
    switchVault,
    removeConnectedVault,
    setVaultPath,
    setVaultConnected,
  } = usePDMStore(
    useShallow((s) => ({
      toggleVaultExpanded: s.toggleVaultExpanded,
      switchVault: s.switchVault,
      removeConnectedVault: s.removeConnectedVault,
      setVaultPath: s.setVaultPath,
      setVaultConnected: s.setVaultConnected,
    })),
  )

  // File state actions
  const { setFiles, setServerFiles, setFilesLoaded } = usePDMStore(
    useShallow((s) => ({
      setFiles: s.setFiles,
      setServerFiles: s.setServerFiles,
      setFilesLoaded: s.setFilesLoaded,
    })),
  )

  // Selection actions
  const { setSelectedFiles, toggleFileSelection } = usePDMStore(
    useShallow((s) => ({
      setSelectedFiles: s.setSelectedFiles,
      toggleFileSelection: s.toggleFileSelection,
    })),
  )

  // Pinned folder actions
  const { unpinFolder, togglePinnedSection, reorderPinnedFolders } = usePDMStore(
    useShallow((s) => ({
      unpinFolder: s.unpinFolder,
      togglePinnedSection: s.togglePinnedSection,
      reorderPinnedFolders: s.reorderPinnedFolders,
    })),
  )

  // Toast action (single function, no shallow needed)
  const addToast = usePDMStore((s) => s.addToast)

  // Computed getter (returns new array, but memoized internally)
  const getEffectiveVaultIds = usePDMStore((s) => s.getEffectiveVaultIds)

  // Filter connected vaults based on impersonated user's access
  const effectiveVaultIds = getEffectiveVaultIds()
  const visibleVaults = useMemo(() => {
    if (effectiveVaultIds.length === 0) return connectedVaults
    return connectedVaults.filter((v) => effectiveVaultIds.includes(v.id))
  }, [connectedVaults, effectiveVaultIds])

  // Use extracted hooks
  // folderMetrics Map provides O(1) lookups for pre-computed folder statistics
  const {
    tree,
    folderMetrics,
    isBeingProcessed,
    getProcessingOperation,
    checkFolderSynced,
    checkFolderCheckoutStatus,
    getDiffCounts,
    sortChildren,
  } = useVaultTree()

  // ═══════════════════════════════════════════════════════════════════════════
  // O(1) SELECTION LOOKUP
  // Convert selectedFiles array to Set for O(1) .has() checks instead of O(N) .includes()
  // ═══════════════════════════════════════════════════════════════════════════
  const selectedFilesSet = useMemo(() => new Set(selectedFiles), [selectedFiles])

  // Use flattened tree for virtualization
  const { flattenedItems, getVisibleFiles, getFilesInRange, totalCount } = useFlattenedTree({
    tree,
    sortChildren,
  })

  const {
    draggedFilesRef,
    dragOverFolder,
    setDragOverFolder,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleDropOnFolder,
    handleVaultRootDrop,
  } = useTreeDragDrop()

  // Use shared selection categories hook
  const categories = useSelectionCategories({
    files,
    selectedFiles,
    userId: user?.id,
  })

  // Shared clipboard hook
  const {
    clipboard,
    handleCopy,
    handleCut,
    handlePaste: pasteToFolder,
  } = useClipboard({
    files,
    selectedFiles,
    userId: user?.id,
    onRefresh,
    addToast,
  })

  // Local state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(
    null,
  )
  const [vaultContextMenu, setVaultContextMenu] = useState<{
    x: number
    y: number
    vault: ConnectedVault
  } | null>(null)
  const [disconnectingVault, setDisconnectingVault] = useState<ConnectedVault | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [showVaultProperties, setShowVaultProperties] = useState<ConnectedVault | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [platform, setPlatform] = useState<string>('win32')
  const [renameValue, setRenameValue] = useState('')
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [isCheckingInAll, setIsCheckingInAll] = useState(false)
  const isRenamingRef = useRef(false)

  // New folder dialog state
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('New Folder')
  const [newFolderParentPath, setNewFolderParentPath] = useState<string>('')
  const [isCheckingInMyCheckouts, setIsCheckingInMyCheckouts] = useState(false)

  // Ref for the file tree container
  const fileTreeContainerRef = useRef<HTMLDivElement>(null!)
  // Ref for the scrollable vault list (where virtualization happens)
  const scrollableContainerRef = useRef<HTMLDivElement>(null!)

  // Auto-scroll when dragging near edges of the scrollable container
  useAutoScrollOnDrag(scrollableContainerRef, { edgeThreshold: 50, maxScrollSpeed: 15 })

  // Clear selection helper
  const clearSelection = useCallback(() => {
    setSelectedFiles([])
  }, [setSelectedFiles])

  // Selection box (marquee/drag-box selection)
  const { selectionBox, selectionHandlers } = useSelectionBox({
    containerRef: scrollableContainerRef,
    getVisibleItems: getVisibleFiles,
    rowSelector: '.tree-item',
    setSelectedFiles,
    clearSelection,
    excludeSelector: '.vault-header', // Don't start selection when clicking vault headers
  })

  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])

  // Switch to a different vault
  const switchToVault = async (vault: ConnectedVault) => {
    if (vault.id === activeVaultId) {
      logExplorer('switchToVault - already active, navigating to root', { vaultName: vault.name })
      setCurrentFolder('')
      // Sync tab title when navigating to vault root
      if (tabsEnabled && activeTabId) {
        updateTabFolder(activeTabId, '')
      }
      return
    }

    logExplorer('switchToVault START', {
      fromVaultId: activeVaultId,
      toVaultId: vault.id,
      vaultName: vault.name,
    })

    setFiles([])
    setServerFiles([])
    setFilesLoaded(false)

    if (window.electronAPI) {
      const result = await window.electronAPI.setWorkingDir(vault.localPath)
      if (!result.success) {
        logExplorer('switchToVault FAILED', { vaultName: vault.name, error: result.error })
        addToast('error', `Failed to switch vault: ${result.error}`)
        return
      }
    }

    switchVault(vault.id, vault.localPath)
    setCurrentFolder('')
    // Sync tab title when switching vaults
    if (tabsEnabled && activeTabId) {
      updateTabFolder(activeTabId, '')
    }

    logExplorer('switchToVault END', { vaultName: vault.name })
  }

  // Get files that need attention before disconnect
  const getDisconnectWarnings = () => {
    const checkedOutFiles = files.filter(
      (f) => !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.diffStatus !== 'deleted',
    )
    const newFiles = files.filter((f) => !f.isDirectory && f.diffStatus === 'added')
    const modifiedFiles = files.filter(
      (f) => !f.isDirectory && (f.diffStatus === 'modified' || f.diffStatus === 'moved'),
    )
    return { checkedOutFiles, newFiles, modifiedFiles }
  }

  const handleVaultContextMenu = (e: React.MouseEvent, vault: ConnectedVault) => {
    e.preventDefault()
    e.stopPropagation()
    setVaultContextMenu({ x: e.clientX, y: e.clientY, vault })
  }

  const confirmDisconnect = async () => {
    if (!disconnectingVault) return

    setIsDisconnecting(true)

    // Stop file watcher if this is the active vault
    if (disconnectingVault.id === activeVaultId) {
      const api = window.electronAPI
      if (api) {
        try {
          await api.clearWorkingDir()
        } catch (error) {
          // Ignore - watcher may not be running
        }
      }

      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      setVaultPath(null)
      setVaultConnected(false)
    }

    removeConnectedVault(disconnectingVault.id)
    setDisconnectingVault(null)
    setIsDisconnecting(false)

    addToast('success', 'Vault disconnected (local files preserved)')
  }

  // Slow double-click to rename (Windows Explorer-style)
  const { handleSlowDoubleClick, resetSlowDoubleClick } = useSlowDoubleClick({
    onRename: (file) => {
      setRenamingFile(file)
      setRenameValue(file.name)
    },
    canRename: (file) => {
      if (file.isDirectory) {
        // Folders: block only if another user has files checked out inside
        const folderPath = file.relativePath.replace(/\\/g, '/')
        const nestedFiles = files.filter((f) => {
          if (f.isDirectory) return false
          return f.relativePath.replace(/\\/g, '/').startsWith(folderPath + '/')
        })
        return !nestedFiles.some(
          (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id,
        )
      }
      const isSynced = !!file.pdmData
      const isCheckedOutByMe = file.pdmData?.checked_out_by === user?.id
      return !isSynced || isCheckedOutByMe
    },
    allowDirectories: true,
  })

  const handleRenameSubmit = async () => {
    if (isRenamingRef.current) return

    if (!renamingFile || !renameValue.trim()) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    const newName = renameValue.trim()

    if (newName === renamingFile.name) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    isRenamingRef.current = true
    try {
      await executeCommand('rename', { file: renamingFile, newName }, { onRefresh })
    } finally {
      setRenamingFile(null)
      setRenameValue('')
      isRenamingRef.current = false
    }
  }

  // Clipboard paste handler that determines target folder from context menu
  const handlePaste = async () => {
    if (!contextMenu?.file || !vaultPath) return

    const targetFolderRelPath = contextMenu.file.isDirectory
      ? contextMenu.file.relativePath
      : contextMenu.file.relativePath.substring(0, contextMenu.file.relativePath.lastIndexOf('/'))

    await pasteToFolder(targetFolderRelPath)
  }

  const handleRename = (file: LocalFile) => {
    setRenamingFile(file)
    setRenameValue(file.name)
  }

  // Keyboard navigation (placed after handleRename so F2 can use it)
  useTreeKeyboardNav({
    containerRef: fileTreeContainerRef,
    tree,
    onRename: handleRename,
    onRefresh,
  })

  const handleNewFolder = async () => {
    if (!contextMenu?.file || !vaultPath) return

    const parentPath = contextMenu.file.isDirectory
      ? contextMenu.file.relativePath
      : contextMenu.file.relativePath.substring(0, contextMenu.file.relativePath.lastIndexOf('/'))

    // Generate a unique folder name (New Folder, New Folder (2), etc.)
    // Only check folders in the target parent directory
    const existingFolderNames = new Set(
      files
        .filter((f) => f.isDirectory)
        .filter((f) => {
          const folderParent = f.relativePath.includes('/')
            ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
            : ''
          return folderParent === parentPath
        })
        .map((f) => f.name.toLowerCase()),
    )

    let folderName = 'New Folder'
    let counter = 2
    while (existingFolderNames.has(folderName.toLowerCase()) && counter < 1000) {
      folderName = `New Folder (${counter})`
      counter++
    }

    setNewFolderParentPath(parentPath)
    setNewFolderName(folderName)
    setShowNewFolderDialog(true)
  }

  const handleNewFolderSubmit = async () => {
    if (!newFolderName.trim()) {
      setShowNewFolderDialog(false)
      return
    }
    await executeCommand(
      'new-folder',
      { parentPath: newFolderParentPath, folderName: newFolderName.trim() },
      { onRefresh },
    )
    setShowNewFolderDialog(false)
  }

  // Batch operations handlers
  const handleDownloadAllCloudFiles = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDownloadingAll) return

    const cloudFiles = files.filter((f) => !f.isDirectory && f.diffStatus === 'cloud')
    if (cloudFiles.length === 0) {
      addToast('info', 'No cloud files to download')
      return
    }

    setIsDownloadingAll(true)
    try {
      await executeCommand('download', { files: cloudFiles }, { onRefresh })
    } finally {
      setIsDownloadingAll(false)
    }
  }

  const handleUpdateAllOutdated = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDownloadingAll) return

    const outdatedFiles = files.filter((f) => !f.isDirectory && f.diffStatus === 'outdated')
    if (outdatedFiles.length === 0) {
      addToast('info', 'No outdated files to update')
      return
    }

    setIsDownloadingAll(true)
    try {
      await executeCommand('get-latest', { files: outdatedFiles }, { onRefresh })
    } finally {
      setIsDownloadingAll(false)
    }
  }

  const handleFirstCheckinAllLocal = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCheckingInAll) return

    const localOnlyFiles = files.filter(
      (f) => !f.isDirectory && (!f.pdmData || f.diffStatus === 'added'),
    )
    if (localOnlyFiles.length === 0) {
      addToast('info', 'No local files to check in')
      return
    }

    setIsCheckingInAll(true)
    try {
      await executeCommand('sync', { files: localOnlyFiles }, { onRefresh })
    } finally {
      setIsCheckingInAll(false)
    }
  }

  const handleCheckInMyCheckouts = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCheckingInMyCheckouts) return

    const myCheckedOutFiles = files.filter(
      (f) => !f.isDirectory && f.pdmData?.checked_out_by === user?.id && f.diffStatus !== 'deleted',
    )
    if (myCheckedOutFiles.length === 0) {
      addToast('info', 'No files to check in')
      return
    }

    setIsCheckingInMyCheckouts(true)
    try {
      await executeCommand('checkin', { files: myCheckedOutFiles }, { onRefresh })
    } finally {
      setIsCheckingInMyCheckouts(false)
    }
  }

  const handleCheckoutAllSynced = async (e: React.MouseEvent) => {
    e.stopPropagation()

    const syncedFiles = files.filter(
      (f) => !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud',
    )
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to check out')
      return
    }

    await executeCommand('checkout', { files: syncedFiles }, { onRefresh })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIRTUALIZED TREE ITEM CLICK HANDLER
  // Handles selection logic including shift-click range selection
  // ═══════════════════════════════════════════════════════════════════════════
  const handleTreeItemClick = useCallback(
    (e: React.MouseEvent, file: LocalFile, flatIndex: number) => {
      const modifiers = {
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
      }
      logExplorer('handleTreeItemClick', {
        name: file.name,
        isDirectory: file.isDirectory,
        flatIndex,
        ...modifiers,
      })

      if (e.shiftKey && lastClickedIndex !== null) {
        // Range selection
        const filesInRange = getFilesInRange(lastClickedIndex, flatIndex)
        const rangePaths = filesInRange.map((f) => f.path)

        if (e.ctrlKey || e.metaKey) {
          const newSelection = [...new Set([...selectedFiles, ...rangePaths])]
          setSelectedFiles(newSelection)
        } else {
          setSelectedFiles(rangePaths)
        }
      } else if (e.ctrlKey || e.metaKey) {
        toggleFileSelection(file.path, true)
        setLastClickedIndex(flatIndex)
      } else {
        setSelectedFiles([file.path])
        setLastClickedIndex(flatIndex)
      }

      const folderPath = file.isDirectory
        ? file.relativePath
        : file.relativePath.split('/').slice(0, -1).join('/') || ''

      setCurrentFolder(folderPath)

      // Sync with active tab when tabs are enabled
      if (tabsEnabled && activeTabId) {
        updateTabFolder(activeTabId, folderPath)
      }
    },
    [
      lastClickedIndex,
      selectedFiles,
      setSelectedFiles,
      toggleFileSelection,
      setCurrentFolder,
      getFilesInRange,
      tabsEnabled,
      activeTabId,
      updateTabFolder,
    ],
  )

  // Handle double-click on tree items
  const handleTreeItemDoubleClick = useCallback(
    async (file: LocalFile) => {
      logExplorer('handleTreeItemDoubleClick', {
        name: file.name,
        isDirectory: file.isDirectory,
        diffStatus: file.diffStatus,
      })

      if (file.isDirectory) {
        toggleFolder(file.relativePath)
      } else if (file.diffStatus === 'cloud') {
        const result = await executeCommand(
          'download',
          { files: [file] },
          { onRefresh, silent: true },
        )
        if (result.success && window.electronAPI) {
          window.electronAPI.openFile(file.path)
        }
      } else if (window.electronAPI) {
        window.electronAPI.openFile(file.path)
      }
    },
    [toggleFolder, onRefresh],
  )

  // Handle context menu on tree items
  const handleTreeItemContextMenu = useCallback(
    (e: React.MouseEvent, file: LocalFile) => {
      if (!(selectedFiles.length > 1 && selectedFiles.includes(file.path))) {
        setSelectedFiles([file.path])
      }
      setContextMenu({ x: e.clientX, y: e.clientY, file })
    },
    [selectedFiles, setSelectedFiles],
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // VIRTUALIZER SETUP
  // Only render visible rows plus overscan for smooth scrolling
  // ═══════════════════════════════════════════════════════════════════════════
  const treeRowHeight = getTreeRowHeight(treeRowSize)
  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollableContainerRef.current,
    estimateSize: () => treeRowHeight,
    overscan: 15,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [treeRowSize, virtualizer])

  // Legacy renderTreeItem for PinnedFoldersSection (needs recursive rendering)
  // This is used only for pinned folders which have a different rendering context
  // Note: This is a simplified version without action buttons for pinned preview
  const renderTreeItem = useCallback(
    (file: LocalFile, depth: number = 0): React.ReactNode => {
      const isExpanded = expandedFolders.has(file.relativePath)
      const isCurrentFolderFlag = file.isDirectory && file.relativePath === currentFolder
      const children = tree[file.relativePath] || []

      // Don't apply diffClass to folders - folder visual state is derived from children (via checkFolderSynced)
      // Only files should use their own diffStatus for CSS styling
      const diffClass =
        !file.isDirectory && file.diffStatus ? `${DIFF_STATUS_CLASS_PREFIX}${file.diffStatus}` : ''
      const isSelected = selectedFiles.includes(file.path)
      const operationType = getProcessingOperation(file.relativePath, file.isDirectory)
      const isProcessing = operationType !== null
      const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath
      const isCut =
        clipboard?.operation === 'cut' && clipboard.files.some((f) => f.path === file.path)

      // Get file icon
      const getFileIcon = () => {
        if (file.isDirectory) {
          if (file.diffStatus === 'cloud') {
            return <FolderOpen size={16} className="text-plm-fg-muted" />
          }
          const checkoutStatus = checkFolderCheckoutStatus(file.relativePath)
          if (checkoutStatus === 'others' || checkoutStatus === 'both') {
            return <FolderOpen size={16} className="text-plm-error" />
          }
          if (checkoutStatus === 'mine') {
            return <FolderOpen size={16} className="text-orange-400" />
          }
          const synced = checkFolderSynced(file.relativePath)
          return (
            <FolderOpen size={16} className={synced ? 'text-plm-success' : 'text-plm-fg-muted'} />
          )
        }
        return <FileIcon file={file} size={16} />
      }

      return (
        <div key={file.path}>
          <div
            className={`tree-item group ${isCurrentFolderFlag ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''} ${isCut ? 'opacity-50' : ''}`}
            style={{ paddingLeft: TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX }}
          >
            {file.isDirectory ? (
              <span
                className="mr-1 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFolder(file.relativePath)
                }}
              >
                {isExpanded ? (
                  <ChevronDown size={14} className="text-plm-fg-muted" />
                ) : (
                  <ChevronRight size={14} className="text-plm-fg-muted" />
                )}
              </span>
            ) : (
              <span className="w-[14px] mr-1" />
            )}
            <span className="tree-item-icon">{getFileIcon()}</span>
            <span
              className={`truncate text-sm flex-1 ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}
            >
              {file.isDirectory || !file.extension
                ? file.name
                : file.name.slice(0, -file.extension.length) +
                  (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
            </span>
          </div>
          {file.isDirectory && isExpanded && (
            <div>{sortChildren(children).map((child) => renderTreeItem(child, depth + 1))}</div>
          )}
        </div>
      )
    },
    [
      tree,
      expandedFolders,
      currentFolder,
      selectedFiles,
      getProcessingOperation,
      dragOverFolder,
      clipboard,
      checkFolderCheckoutStatus,
      checkFolderSynced,
      toggleFolder,
      lowercaseExtensions,
      sortChildren,
    ],
  )

  // Render vault section with virtualized tree
  const renderVaultSection = (vault: ConnectedVault) => {
    const isActive = activeVaultId === vault.id
    const isExpanded = vault.isExpanded

    // Calculate vault stats
    const cloudFiles = isActive
      ? files.filter((f) => !f.isDirectory && f.diffStatus === 'cloud')
      : []
    const cloudFilesCount = cloudFiles.length
    const isAnyCloudFileProcessing =
      isActive && cloudFiles.some((f) => isBeingProcessed(f.relativePath))
    const outdatedFiles = isActive
      ? files.filter((f) => !f.isDirectory && f.diffStatus === 'outdated')
      : []
    const outdatedFilesCount = outdatedFiles.length
    const isAnyOutdatedFileProcessing =
      isActive && outdatedFiles.some((f) => isBeingProcessed(f.relativePath))
    const localOnlyFilesCount = isActive
      ? files.filter(
          (f) =>
            !f.isDirectory &&
            (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') &&
            f.diffStatus !== 'cloud' &&
            f.diffStatus !== 'ignored' &&
            !(hideSolidworksTempFiles && f.name?.startsWith('~$')),
        ).length
      : 0
    const syncedFilesCount = isActive
      ? files.filter(
          (f) =>
            !f.isDirectory && f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud',
        ).length
      : 0
    const checkedOutByMeCount = isActive
      ? files.filter((f) => !f.isDirectory && f.pdmData?.checked_out_by === user?.id).length
      : 0
    const checkedOutByOthers = isActive
      ? files.filter(
          (f) =>
            !f.isDirectory && f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id,
        )
      : []

    // Get all checkout users (with count for FolderCheckinButton)
    type CheckoutUserWithCount = CheckoutUser & { count?: number }
    const allCheckoutUsers: CheckoutUserWithCount[] = []
    if (isActive && checkedOutByMeCount > 0 && user) {
      allCheckoutUsers.push({
        id: user.id,
        name: user.full_name || user.email || 'You',
        email: user.email || undefined,
        avatar_url: user.avatar_url || undefined,
        isMe: true,
        count: checkedOutByMeCount,
      })
    }
    if (isActive) {
      const othersMap = new Map<
        string,
        { id: string; name: string; email?: string; avatar_url?: string; count: number }
      >()
      for (const f of checkedOutByOthers) {
        const checkoutUserId = f.pdmData!.checked_out_by!
        const checkedOutUser = (f.pdmData as any).checked_out_user // TODO: type this
        if (othersMap.has(checkoutUserId)) {
          othersMap.get(checkoutUserId)!.count++
        } else {
          othersMap.set(checkoutUserId, {
            id: checkoutUserId,
            name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
            email: checkedOutUser?.email,
            avatar_url: checkedOutUser?.avatar_url,
            count: 1,
          })
        }
      }
      for (const u of othersMap.values()) {
        allCheckoutUsers.push({ ...u, isMe: false })
      }
    }

    const totalCheckouts = checkedOutByMeCount + checkedOutByOthers.length

    // Handle vault header click
    const handleVaultClick = () => {
      if (isActive) {
        toggleVaultExpanded(vault.id)
      } else {
        switchToVault(vault)
        if (!isExpanded) {
          toggleVaultExpanded(vault.id)
        }
      }
    }

    // Drag handlers for vault header
    const handleVaultDragOver = (e: React.DragEvent) => {
      if (!isActive) return
      e.preventDefault()
      e.stopPropagation()
      const hasPdmFiles = e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
      const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
      if (hasPdmFiles || draggedFilesRef.current.length > 0) {
        e.dataTransfer.dropEffect = 'move'
        setDragOverFolder('')
      } else if (hasExternalFiles) {
        e.dataTransfer.dropEffect = 'copy'
        setDragOverFolder('')
      }
    }

    const handleVaultDragLeave = (e: React.DragEvent) => {
      if (!isActive) return
      e.preventDefault()
      const relatedTarget = e.relatedTarget as HTMLElement
      if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
        if (dragOverFolder === '') {
          setDragOverFolder(null)
        }
      }
    }

    const handleVaultDrop = (e: React.DragEvent) => {
      if (!isActive) return
      handleVaultRootDrop(e, onRefresh)
    }

    return (
      <div key={vault.id} className="border-b border-plm-border last:border-b-0">
        <VaultTreeItem
          vault={vault}
          isActive={isActive}
          isExpanded={isExpanded && isActive}
          onClick={handleVaultClick}
          onContextMenu={(e) => handleVaultContextMenu(e, vault)}
          onDragOver={handleVaultDragOver}
          onDragLeave={handleVaultDragLeave}
          onDrop={handleVaultDrop}
          isDragTarget={isActive && dragOverFolder === ''}
          cloudFilesCount={cloudFilesCount}
          outdatedFilesCount={outdatedFilesCount}
          localOnlyFilesCount={localOnlyFilesCount}
          syncedFilesCount={syncedFilesCount}
          checkedOutByMeCount={checkedOutByMeCount}
          allCheckoutUsers={allCheckoutUsers}
          totalCheckouts={totalCheckouts}
          isDownloadingAll={isDownloadingAll}
          isCheckingInAll={isCheckingInAll}
          isCheckingInMyCheckouts={isCheckingInMyCheckouts}
          isAnyCloudFileProcessing={isAnyCloudFileProcessing}
          isAnyOutdatedFileProcessing={isAnyOutdatedFileProcessing}
          onDownloadAllCloud={handleDownloadAllCloudFiles}
          onUpdateAllOutdated={handleUpdateAllOutdated}
          onFirstCheckinAllLocal={handleFirstCheckinAllLocal}
          onCheckInMyCheckouts={handleCheckInMyCheckouts}
          onCheckoutAllSynced={handleCheckoutAllSynced}
        />

        {/* Vault contents - VIRTUALIZED */}
        {isExpanded && isActive && (
          <div
            className={`pb-2 min-h-[40px] ${dragOverFolder === '' ? 'bg-plm-accent/10 outline outline-2 outline-dashed outline-plm-accent/50 rounded' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (
                draggedFilesRef.current.length > 0 ||
                e.dataTransfer.types.includes(PDM_FILES_DATA_TYPE)
              ) {
                if (!dragOverFolder) setDragOverFolder('')
              }
            }}
            onDragLeave={(e) => {
              const relatedTarget = e.relatedTarget as HTMLElement
              if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                if (dragOverFolder === '') setDragOverFolder(null)
              }
            }}
            onDrop={(e) => handleVaultRootDrop(e, onRefresh)}
          >
            {/* Virtualized tree container */}
            {totalCount > 0 && (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const item = flattenedItems[virtualRow.index]
                  if (!item) return null

                  const file = item.file
                  // O(1) selection check via Set instead of O(N) array.includes()
                  const isSelected = selectedFilesSet.has(file.path)
                  const isRenaming = renamingFile?.relativePath === file.relativePath
                  const operationType = getProcessingOperation(file.relativePath, file.isDirectory)
                  // O(1) Map lookup for pre-computed folder metrics (null fallback for undefined)
                  const metrics = file.isDirectory
                    ? (folderMetrics.get(file.relativePath) ?? null)
                    : null
                  const diffCounts = file.isDirectory ? getDiffCounts(file.relativePath) : null
                  const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath

                  return (
                    <VirtualizedTreeRow
                      key={file.path}
                      item={item}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      treeRowSize={treeRowSize}
                      isSelected={isSelected}
                      isRenaming={isRenaming}
                      renameValue={renameValue}
                      onRenameChange={setRenameValue}
                      onRenameSubmit={handleRenameSubmit}
                      onRenameCancel={() => {
                        setRenamingFile(null)
                        setRenameValue('')
                      }}
                      onClick={handleTreeItemClick}
                      onDoubleClick={handleTreeItemDoubleClick}
                      onContextMenu={handleTreeItemContextMenu}
                      onSlowDoubleClick={handleSlowDoubleClick}
                      resetSlowDoubleClick={resetSlowDoubleClick}
                      isDragTarget={isDragTarget}
                      clipboard={clipboard}
                      operationType={operationType}
                      diffCounts={diffCounts}
                      folderMetrics={metrics}
                      isHiddenFromNonAdmins={
                        file.isDirectory && isMarkedHidden(file.relativePath)
                      }
                      onRefresh={onRefresh}
                      selectedFiles={selectedFiles}
                      selectedDownloadableFiles={categories.downloadable}
                      selectedUploadableFiles={categories.uploadable}
                      selectedCheckoutableFiles={categories.checkoutable}
                      selectedCheckinableFiles={categories.checkinable}
                      selectedUpdatableFiles={categories.updatable}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onFolderDragOver={handleFolderDragOver}
                      onFolderDragLeave={handleFolderDragLeave}
                      onDropOnFolder={handleDropOnFolder}
                      draggedFilesRef={draggedFilesRef}
                      files={files}
                      checkFolderSynced={checkFolderSynced}
                      checkFolderCheckoutStatus={checkFolderCheckoutStatus}
                      // Props passed from parent to avoid store subscriptions
                      currentFolder={currentFolder}
                      lowercaseExtensions={lowercaseExtensions}
                      toggleFolder={toggleFolder}
                      // Action button props
                      user={user}
                      isOfflineMode={isOfflineMode}
                      stageCheckin={stageCheckin}
                      unstageCheckin={unstageCheckin}
                      getStagedCheckin={getStagedCheckin}
                      addToast={addToast}
                    />
                  )
                })}
              </div>
            )}

            {(isLoading || !filesLoaded) && (tree[''] || []).length === 0 && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="text-plm-fg-muted animate-spin" />
              </div>
            )}

            {(tree[''] || []).length === 0 && !isLoading && filesLoaded && (
              <div className="px-4 py-4 text-center text-plm-fg-muted text-xs">
                {dragOverFolder === '' ? 'Drop here to move to root' : 'No files in vault'}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Render when no vaults connected
  if (visibleVaults.length === 0) {
    if (impersonatedUser && connectedVaults.length > 0) {
      return (
        <NoVaultAccessMessage
          impersonatedUser={impersonatedUser}
          connectedVaultsCount={connectedVaults.length}
        />
      )
    }

    // No vaults connected - show empty state with link to vault settings
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center">
        <Database size={32} className="text-plm-fg-muted mb-3" />
        <p className="text-sm text-plm-fg-muted mb-4">No vault connected</p>
        <button
          onClick={() => {
            // Navigate to vault settings
            const { setActiveView, setSettingsTab } = usePDMStore.getState()
            setActiveView('settings')
            setSettingsTab('vaults')
          }}
          className="btn btn-ghost btn-sm text-plm-accent hover:text-plm-accent"
        >
          <Database size={14} />
          Connect a Vault
        </button>
      </div>
    )
  }

  // Main render - multiple vaults mode
  return (
    <TreeHoverProvider>
      <div ref={fileTreeContainerRef} className="flex flex-col h-full outline-none" tabIndex={-1}>
        {/* Pinned section */}
        <PinnedFoldersSection
          pinnedFolders={pinnedFolders}
          isExpanded={pinnedSectionExpanded}
          onToggle={togglePinnedSection}
          activeVaultId={activeVaultId}
          connectedVaults={connectedVaults}
          files={files}
          tree={tree}
          getDiffCounts={getDiffCounts}
          onNavigate={async (pinned, vault) => {
            if (pinned.vaultId !== activeVaultId && vault) {
              setFiles([])
              setServerFiles([])
              setFilesLoaded(false)

              if (window.electronAPI) {
                const result = await window.electronAPI.setWorkingDir(vault.localPath)
                if (!result.success) {
                  addToast('error', `Failed to switch vault: ${result.error}`)
                  return
                }
              }

              switchVault(pinned.vaultId, vault.localPath)

              if (!vault.isExpanded) {
                toggleVaultExpanded(pinned.vaultId)
              }
            }

            const folderPath = pinned.isDirectory
              ? pinned.path
              : pinned.path.split('/').slice(0, -1).join('/') || ''

            setCurrentFolder(folderPath)

            // Sync tab title when navigating via pinned folders
            if (tabsEnabled && activeTabId) {
              updateTabFolder(activeTabId, folderPath)
            }
          }}
          onUnpin={unpinFolder}
          onReorder={reorderPinnedFolders}
          onRefresh={onRefresh}
          renderTreeItem={renderTreeItem}
        />

        {/* Filter bar - above vault list */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-plm-border bg-plm-bg">
          <button
            onClick={() => setHideCloudOnlyFolders(!hideCloudOnlyFolders)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              hideCloudOnlyFolders
                ? 'bg-plm-accent/20 text-plm-accent border border-plm-accent/30'
                : 'text-plm-fg-muted hover:bg-plm-highlight hover:text-plm-fg border border-transparent'
            }`}
            title={
              hideCloudOnlyFolders
                ? 'Showing downloaded only - click to show all'
                : 'Show only folders with downloaded files'
            }
          >
            {hideCloudOnlyFolders ? (
              <>
                <CloudOff size={12} />
                <span>Downloaded only</span>
              </>
            ) : (
              <>
                <Filter size={12} />
                <span>Filter</span>
              </>
            )}
          </button>
        </div>

        {/* Vault list - scrollable container for virtualization */}
        <div
          ref={scrollableContainerRef}
          className={`flex-1 overflow-y-auto relative ${selectionBox ? 'selecting' : ''}`}
          {...selectionHandlers}
        >
          {/* Selection box overlay */}
          {selectionBox && <SelectionBoxOverlay box={selectionBox} />}

          {visibleVaults.map((vault) => renderVaultSection(vault))}

          {impersonatedUser &&
            effectiveVaultIds.length > 0 &&
            connectedVaults.length > visibleVaults.length && (
              <div className="px-3 py-2 text-xs text-plm-fg-dim italic border-t border-plm-border mt-2">
                {connectedVaults.length - visibleVaults.length} vault
                {connectedVaults.length - visibleVaults.length !== 1 ? 's' : ''} hidden (no access
                as {impersonatedUser.full_name || impersonatedUser.email})
              </div>
            )}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <FileContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            files={files}
            contextFiles={
              selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)
                ? files.filter((f) => selectedFiles.includes(f.path))
                : [contextMenu.file]
            }
            onClose={() => setContextMenu(null)}
            onRefresh={onRefresh || (() => {})}
            clipboard={clipboard}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            onRename={handleRename}
            onNewFolder={handleNewFolder}
          />
        )}

        {/* Vault Context Menu */}
        {vaultContextMenu && (
          <div className="fixed inset-0 z-50" onClick={() => setVaultContextMenu(null)}>
            <div
              className="fixed bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 min-w-[160px]"
              style={{ left: vaultContextMenu.x, top: vaultContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                onClick={() => {
                  setVaultContextMenu(null)
                  const vault = vaultContextMenu.vault
                  if (activeVaultId !== vault.id && vault.localPath) {
                    switchVault(vault.id, vault.localPath)
                  }
                  onRefresh?.(false, true)
                }}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                onClick={() => {
                  setVaultContextMenu(null)
                  usePDMStore.getState().collapseAllFolders()
                }}
              >
                <FolderMinus size={14} />
                Collapse All Folders
              </button>
              {(() => {
                // Only show sync option for SW files checked out by current user
                const swFilesCheckedOut = files.filter(
                  (f) =>
                    !f.isDirectory &&
                    SOLIDWORKS_EXTENSIONS.includes(f.extension.toLowerCase()) &&
                    f.pdmData?.checked_out_by === user?.id,
                )

                if (swFilesCheckedOut.length > 0) {
                  return (
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                      onClick={() => {
                        setVaultContextMenu(null)
                        executeCommand('sync-metadata', { files: swFilesCheckedOut }, { onRefresh })
                      }}
                    >
                      <RefreshCw size={14} className="text-plm-accent" />
                      Sync SW Metadata ({swFilesCheckedOut.length})
                    </button>
                  )
                }
                return null
              })()}
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                onClick={() => {
                  if (vaultContextMenu.vault.localPath) {
                    window.electronAPI?.openInExplorer(vaultContextMenu.vault.localPath)
                  }
                  setVaultContextMenu(null)
                }}
              >
                <FolderOpenIcon size={14} />
                {platform === 'darwin' ? 'Reveal in Finder' : 'Open in Explorer'}
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                onClick={() => {
                  setShowVaultProperties(vaultContextMenu.vault)
                  setVaultContextMenu(null)
                }}
              >
                <Info size={14} />
                Properties
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-fg"
                onClick={async () => {
                  const vault = vaultContextMenu.vault
                  setVaultContextMenu(null)

                  const result = await window.electronAPI?.selectWorkingDir()
                  if (result?.success && result.path) {
                    const { updateConnectedVault, setVaultPath, setVaultConnected, addToast } =
                      usePDMStore.getState()
                    updateConnectedVault(vault.id, { localPath: result.path })

                    if (activeVaultId === vault.id) {
                      setVaultPath(result.path)
                      setVaultConnected(true)
                    }

                    addToast('success', `Vault "${vault.name}" path changed to: ${result.path}`)
                  }
                }}
              >
                <FolderOpen size={14} />
                Change Path...
              </button>
              <div className="border-t border-plm-border my-1" />
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight flex items-center gap-2 text-plm-warning"
                onClick={() => {
                  setDisconnectingVault(vaultContextMenu.vault)
                  setVaultContextMenu(null)
                }}
              >
                <Unlink size={14} />
                Disconnect Vault
              </button>
            </div>
          </div>
        )}

        {/* Disconnect Vault Confirmation Dialog */}
        {disconnectingVault && (
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setDisconnectingVault(null)}
          >
            <div
              className="bg-plm-bg-light border border-plm-warning/50 rounded-xl shadow-2xl w-[480px] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-plm-border bg-plm-warning/10">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-plm-warning/20 rounded-full">
                    <AlertTriangle size={24} className="text-plm-warning" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-plm-fg">Disconnect Vault</h3>
                    <p className="text-sm text-plm-fg-muted">"{disconnectingVault.name}"</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {(() => {
                  const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                  const hasBlockingIssues =
                    checkedOutFiles.length > 0 || newFiles.length > 0 || modifiedFiles.length > 0

                  return (
                    <>
                      {hasBlockingIssues ? (
                        <div className="p-4 bg-plm-error/10 border border-plm-error/30 rounded-lg space-y-3">
                          <p className="text-sm font-medium text-plm-error">
                            You must resolve these issues before disconnecting:
                          </p>

                          {checkedOutFiles.length > 0 && (
                            <div className="bg-plm-bg/50 p-2 rounded">
                              <p className="text-sm text-plm-fg flex items-center gap-2">
                                <span className="w-2 h-2 bg-plm-accent rounded-full"></span>
                                <strong>{checkedOutFiles.length}</strong> file
                                {checkedOutFiles.length !== 1 ? 's' : ''} checked out
                              </p>
                              <p className="text-xs text-plm-fg-muted ml-4">
                                Check in or undo checkout
                              </p>
                            </div>
                          )}

                          {newFiles.length > 0 && (
                            <div className="bg-plm-bg/50 p-2 rounded">
                              <p className="text-sm text-plm-fg flex items-center gap-2">
                                <span className="w-2 h-2 bg-plm-success rounded-full"></span>
                                <strong>{newFiles.length}</strong> new file
                                {newFiles.length !== 1 ? 's' : ''} not synced
                              </p>
                              <p className="text-xs text-plm-fg-muted ml-4">
                                Sync or delete locally
                              </p>
                            </div>
                          )}

                          {modifiedFiles.length > 0 && (
                            <div className="bg-plm-bg/50 p-2 rounded">
                              <p className="text-sm text-plm-fg flex items-center gap-2">
                                <span className="w-2 h-2 bg-plm-warning rounded-full"></span>
                                <strong>{modifiedFiles.length}</strong> modified file
                                {modifiedFiles.length !== 1 ? 's' : ''}
                              </p>
                              <p className="text-xs text-plm-fg-muted ml-4">
                                Check out & check in, or revert
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-4 bg-plm-success/10 border border-plm-success/30 rounded-lg">
                          <p className="text-sm text-plm-fg flex items-center gap-2">
                            <Check size={16} className="text-plm-success" />
                            All files are synced. Safe to disconnect.
                          </p>
                        </div>
                      )}

                      <p className="text-sm text-plm-fg-muted">
                        {hasBlockingIssues
                          ? 'Close this dialog and resolve the issues above.'
                          : 'Local files will be preserved. You can reconnect anytime.'}
                      </p>
                    </>
                  )
                })()}
              </div>

              <div className="p-4 border-t border-plm-border bg-plm-bg flex justify-end gap-3">
                <button
                  onClick={() => setDisconnectingVault(null)}
                  className="btn btn-ghost"
                  disabled={isDisconnecting}
                >
                  {(() => {
                    const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                    return checkedOutFiles.length > 0 ||
                      newFiles.length > 0 ||
                      modifiedFiles.length > 0
                      ? 'Close'
                      : 'Cancel'
                  })()}
                </button>
                {(() => {
                  const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                  const canDisconnect =
                    checkedOutFiles.length === 0 &&
                    newFiles.length === 0 &&
                    modifiedFiles.length === 0

                  return canDisconnect ? (
                    <button
                      onClick={confirmDisconnect}
                      disabled={isDisconnecting}
                      className="btn bg-plm-warning hover:bg-plm-warning/80 text-black disabled:opacity-50 flex items-center gap-2"
                    >
                      {isDisconnecting ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Disconnecting...
                        </>
                      ) : (
                        <>
                          <Unlink size={16} />
                          Disconnect
                        </>
                      )}
                    </button>
                  ) : null
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Vault Properties Modal */}
        {showVaultProperties && (
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowVaultProperties(null)}
          >
            <div
              className="bg-plm-bg-light border border-plm-border rounded-xl shadow-2xl w-[500px] max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-plm-border bg-plm-bg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-plm-accent/20 rounded-lg vault-icon-bg">
                    <Database size={20} className="vault-icon text-plm-accent" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-plm-fg">
                      {showVaultProperties.name}
                    </h3>
                    <p className="text-xs text-plm-fg-muted">Vault Properties</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVaultProperties(null)}
                  className="p-1 hover:bg-plm-bg-light rounded text-plm-fg-muted hover:text-plm-fg"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 space-y-4 overflow-auto max-h-[60vh]">
                <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                  <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-1">
                    Local Path
                  </div>
                  <div className="text-sm text-plm-fg break-all font-mono">
                    {showVaultProperties.localPath || 'Not connected locally'}
                  </div>
                </div>

                {(() => {
                  const vaultFiles = files.filter((f) => !f.isDirectory)
                  const vaultFolders = files.filter((f) => f.isDirectory)
                  const syncedFiles = vaultFiles.filter((f) => !f.diffStatus)
                  const modifiedFiles = vaultFiles.filter((f) => f.diffStatus === 'modified')
                  const addedFiles = vaultFiles.filter((f) => f.diffStatus === 'added')
                  const cloudFiles = vaultFiles.filter((f) => f.diffStatus === 'cloud')
                  const conflictFiles = vaultFiles.filter((f) => f.diffStatus === 'outdated')
                  const checkedOutByMe = vaultFiles.filter(
                    (f) => f.pdmData?.checked_out_by === user?.id,
                  )
                  const checkedOutByOthersVault = vaultFiles.filter(
                    (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id,
                  )

                  const totalLocalSize = vaultFiles
                    .filter((f) => f.diffStatus !== 'cloud')
                    .reduce((sum, f) => sum + (f.size || 0), 0)

                  const formatSize = (bytes: number) => {
                    if (bytes === 0) return '0 B'
                    if (bytes >= 1024 * 1024 * 1024)
                      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
                    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
                    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
                    return `${bytes} B`
                  }

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3 bg-plm-bg rounded-lg border border-plm-border text-center">
                          <div className="text-2xl font-bold text-plm-fg">{vaultFiles.length}</div>
                          <div className="text-xs text-plm-fg-muted">Files</div>
                        </div>
                        <div className="p-3 bg-plm-bg rounded-lg border border-plm-border text-center">
                          <div className="text-2xl font-bold text-plm-fg">
                            {vaultFolders.length}
                          </div>
                          <div className="text-xs text-plm-fg-muted">Folders</div>
                        </div>
                        <div className="p-3 bg-plm-bg rounded-lg border border-plm-border text-center">
                          <div className="text-2xl font-bold text-plm-fg">
                            {formatSize(totalLocalSize)}
                          </div>
                          <div className="text-xs text-plm-fg-muted">Local Size</div>
                        </div>
                      </div>

                      <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                        <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">
                          Sync Status
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Check size={14} className="text-plm-success" />
                              <span className="text-sm text-plm-fg">Synced</span>
                            </div>
                            <span className="text-sm font-medium text-plm-fg">
                              {syncedFiles.length}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <RefreshCw size={14} className="text-plm-warning" />
                              <span className="text-sm text-plm-fg">Modified</span>
                            </div>
                            <span className="text-sm font-medium text-plm-fg">
                              {modifiedFiles.length}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Plus size={14} className="text-plm-accent" />
                              <span className="text-sm text-plm-fg">Local Only</span>
                            </div>
                            <span className="text-sm font-medium text-plm-fg">
                              {addedFiles.length}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Cloud size={14} className="text-plm-fg-muted" />
                              <span className="text-sm text-plm-fg">Cloud Only</span>
                            </div>
                            <span className="text-sm font-medium text-plm-fg">
                              {cloudFiles.length}
                            </span>
                          </div>
                          {conflictFiles.length > 0 && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <AlertTriangle size={14} className="text-plm-error" />
                                <span className="text-sm text-plm-fg">Conflicts</span>
                              </div>
                              <span className="text-sm font-medium text-plm-error">
                                {conflictFiles.length}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                        <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">
                          Checkout Status
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Lock size={14} className="text-plm-accent" />
                              <span className="text-sm text-plm-fg">Checked out by you</span>
                            </div>
                            <span className="text-sm font-medium text-plm-fg">
                              {checkedOutByMe.length}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Lock size={14} className="text-plm-warning" />
                              <span className="text-sm text-plm-fg">Checked out by others</span>
                            </div>
                            <span className="text-sm font-medium text-plm-fg">
                              {checkedOutByOthersVault.length}
                            </span>
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const typeCount = new Map<string, number>()
                        vaultFiles.forEach((f) => {
                          const ext = (f.extension || 'other').toLowerCase()
                          typeCount.set(ext, (typeCount.get(ext) || 0) + 1)
                        })

                        const sortedTypes = [...typeCount.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 10)

                        if (sortedTypes.length === 0) return null

                        return (
                          <div className="p-3 bg-plm-bg rounded-lg border border-plm-border">
                            <div className="text-xs text-plm-fg-muted uppercase tracking-wide mb-3">
                              File Types
                            </div>
                            <div className="space-y-1.5">
                              {sortedTypes.map(([ext, count]) => (
                                <div key={ext} className="flex items-center justify-between">
                                  <span className="text-sm text-plm-fg">.{ext}</span>
                                  <span className="text-sm text-plm-fg-muted">{count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )
                })()}
              </div>

              <div className="p-4 border-t border-plm-border bg-plm-bg flex justify-end">
                <button onClick={() => setShowVaultProperties(null)} className="btn btn-ghost">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* New Folder Dialog */}
        {showNewFolderDialog && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
            onClick={() => setShowNewFolderDialog(false)}
          >
            <div
              className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-medium text-plm-fg mb-4">New Folder</h3>
              <div className="mb-4">
                <label className="block text-sm text-plm-fg-muted mb-1">Folder name</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleNewFolderSubmit()
                    if (e.key === 'Escape') setShowNewFolderDialog(false)
                  }}
                  className="w-full bg-plm-bg border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowNewFolderDialog(false)} className="btn btn-ghost">
                  Cancel
                </button>
                <button
                  onClick={handleNewFolderSubmit}
                  disabled={!newFolderName.trim()}
                  className="btn btn-primary"
                >
                  Create Folder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TreeHoverProvider>
  )
}
