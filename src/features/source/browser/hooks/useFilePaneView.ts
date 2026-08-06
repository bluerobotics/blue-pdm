/**
 * Composite hook that groups all view-related state and handlers
 * for the FilePane component
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { FileMetadataColumn } from '@/types/database'
import { supabase, isWatchingFile } from '@/lib/supabase'

import { useContextMenuState } from './useContextMenuState'
import { useDialogState } from './useDialogState'
import { useRenameState } from './useRenameState'
import { useInlineActionHover } from './useInlineActionHover'
import { useNavigationHistory } from './useNavigationHistory'
import { useFileSelection } from './useFileSelection'
import { useFolderMetrics } from './useFolderMetrics'
import { useSorting } from './useSorting'
import {
  getFileProcessingOperation,
  getFolderProcessingOperation,
  matchesKeybinding,
} from '../utils'
import type { SortColumn, SortDirection } from '../types'

export function useFilePaneView() {
  const {
    files,
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    columns,
    sortColumn,
    sortDirection,
    toggleSort,
    user,
    organization,
    currentFolder,
    setCurrentFolder,
    expandedFolders,
    toggleFolder,
    searchQuery,
    searchType,
    hideSolidworksTempFiles,
    processingOperations,
    tabsEnabled,
    activeTabId,
    updateTabFolder,
  } = usePDMStore()

  const { enforcedHiddenPaths } = useHiddenFolders()

  // Context menu state
  const contextMenuState = useContextMenuState()

  // Dialog state
  const dialogState = useDialogState()

  // Rename state
  const renameState = useRenameState()

  // Inline action hover states
  const hoverState = useInlineActionHover()

  // Platform
  const [platform, setPlatform] = useState<string>('win32')

  // Current machine ID
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)

  // Custom metadata columns
  const [customMetadataColumns, setCustomMetadataColumns] = useState<FileMetadataColumn[]>([])

  // Watch file state
  const [watchingFiles, setWatchingFiles] = useState<Set<string>>(new Set())
  const [isTogglingWatch, setIsTogglingWatch] = useState(false)

  // Navigation history
  const navigationHistory = useNavigationHistory({
    setCurrentFolder,
    expandedFolders,
    toggleFolder,
    tabsEnabled,
    activeTabId,
    updateTabFolder,
  })

  // Sorted files
  const { sortedFiles, isSearching } = useSorting({
    files,
    currentPath: currentFolder,
    sortColumn: sortColumn as SortColumn,
    sortDirection: sortDirection as SortDirection,
    searchQuery,
    searchType,
    hideSolidworksTempFiles,
    hiddenFolderPaths: enforcedHiddenPaths,
    toggleSort,
  })

  // File selection
  const fileSelection = useFileSelection({
    sortedFiles,
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
  })

  // Folder metrics
  const folderMetrics = useFolderMetrics({
    files,
    userId: user?.id,
    userFullName: user?.full_name ?? undefined,
    userEmail: user?.email,
    userAvatarUrl: user?.avatar_url ?? undefined,
    hideSolidworksTempFiles,
  })

  // Calculate selected updatable files
  const selectedUpdatableFiles = useMemo(() => {
    if (selectedFiles.length <= 1) return []
    return files.filter(
      (f) => selectedFiles.includes(f.path) && !f.isDirectory && f.diffStatus === 'outdated',
    )
  }, [files, selectedFiles])

  // Check folder sync status (O(1) lookup)
  const isFolderSynced = useCallback(
    (folderPath: string): boolean => {
      const fm = folderMetrics.get(folderPath)
      if (!fm) return false
      return fm.isSynced
    },
    [folderMetrics],
  )

  // Get folder checkout status (O(1) lookup)
  const getFolderCheckoutStatus = useCallback(
    (folderPath: string): 'mine' | 'others' | 'both' | null => {
      const fm = folderMetrics.get(folderPath)
      if (!fm) return null

      if (fm.hasMyCheckedOutFiles && fm.hasOthersCheckedOutFiles) return 'both'
      if (fm.hasMyCheckedOutFiles) return 'mine'
      if (fm.hasOthersCheckedOutFiles) return 'others'
      return null
    },
    [folderMetrics],
  )

  // Check if path is being processed
  const isBeingProcessed = useCallback(
    (relativePath: string, isDirectory: boolean = false) => {
      if (isDirectory) {
        return getFolderProcessingOperation(relativePath, processingOperations) !== null
      }
      return getFileProcessingOperation(relativePath, processingOperations) !== null
    },
    [processingOperations],
  )

  // Load platform
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])

  // Load machine ID
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const { getMachineId } = await import('@/lib/backup')
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)
      } catch {
        setCurrentMachineId(null)
      }
    }
    loadMachineId()
  }, [])

  // Load custom metadata columns
  useEffect(() => {
    const loadCustomColumns = async () => {
      if (!organization?.id) {
        setCustomMetadataColumns([])
        return
      }

      try {
        const { data, error } = await supabase
          .from('file_metadata_columns')
          .select('*')
          .eq('org_id', organization.id)
          .order('sort_order')

        if (error) {
          log.error('[FilePane]', 'Failed to load custom metadata columns', { error })
          return
        }

        setCustomMetadataColumns(data || [])
      } catch (error) {
        log.error('[FilePane]', 'Failed to load custom metadata columns', { error: error })
      }
    }

    loadCustomColumns()
  }, [organization?.id])

  // Check if user is watching file when context menu opens
  useEffect(() => {
    const contextMenu = contextMenuState.contextMenu
    if (contextMenu && user?.id && contextMenu.file.pdmData?.id) {
      isWatchingFile(contextMenu.file.pdmData.id, user.id).then(({ watching }) => {
        if (watching) {
          setWatchingFiles((prev) => new Set(prev).add(contextMenu.file.pdmData!.id))
        }
      })
    }
  }, [contextMenuState.contextMenu, user?.id])

  // Helper for keybinding check
  const checkKeybinding = useCallback((e: KeyboardEvent, action: string): boolean => {
    const keybindings = usePDMStore.getState().keybindings
    return matchesKeybinding(e, keybindings[action as keyof typeof keybindings])
  }, [])

  // Combine columns with custom metadata columns
  const allColumns = useMemo(
    () => [
      ...columns,
      ...customMetadataColumns
        .filter((c) => c.visible)
        .map((c) => ({
          id: `custom_${c.name}`,
          label: c.label,
          width: c.width,
          visible: c.visible,
          sortable: c.sortable,
        })),
    ],
    [columns, customMetadataColumns],
  )

  const visibleColumns = useMemo(() => allColumns.filter((c) => c.visible), [allColumns])

  return {
    // Context menu state
    ...contextMenuState,

    // Dialog state
    ...dialogState,

    // Rename state
    ...renameState,

    // Hover state
    ...hoverState,

    // Navigation
    ...navigationHistory,

    // File selection
    ...fileSelection,

    // Sorted files
    sortedFiles,
    isSearching,

    // Folder metrics
    folderMetrics,
    isFolderSynced,
    getFolderCheckoutStatus,
    isBeingProcessed,
    selectedUpdatableFiles,

    // Platform and machine
    platform,
    currentMachineId,

    // Custom columns
    customMetadataColumns,
    allColumns,
    visibleColumns,

    // Watch state
    watchingFiles,
    setWatchingFiles,
    isTogglingWatch,
    setIsTogglingWatch,

    // Keybinding check
    checkKeybinding,

    // Current path
    currentPath: currentFolder,
  }
}
