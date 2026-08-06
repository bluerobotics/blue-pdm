import { useState, useEffect, useCallback, useMemo } from 'react'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore, LocalFile, DetailsPanelTab } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { buildThumbnailUrl } from '@/lib/thumbnailUrl'
import { useRetryableImage } from '@/hooks/useRetryableImage'
import { getFileIconType } from '@/lib/utils'
import { formatFileSize } from '@/lib/utils'
import { DraggableTab, TabDropZone, PanelLocation } from '@/components/shared/DraggableTab'
import { format } from 'date-fns'
import { getNextSerialNumber } from '@/lib/serialization'
import {
  resolveDescription,
  resolveFileMetadata,
  resolvePartNumber,
  resolveRevision,
  resolvedText,
} from '@/lib/metadata/overlay'
import { propertiesToMirror } from '@/lib/metadata/configurationMirror'
import { configurationScopeProperties } from '@/lib/metadata/divergence'
import { reportMetadataWrite } from '@/lib/metadata/reportMetadataWrite'
import { writeMetadataWithVerification } from '@/lib/metadata/writeMetadataToFile'
import { buildMetadataWritePlan } from '@/lib/metadata/writePlan'
import { MetadataWriteStateMarker } from '@/components/MetadataWriteStateMarker'
import { listWriteAddresses } from '@/lib/metadata/writeState'
import type { PendingMetadataEdit } from '@/stores/types'
import { WhereUsedTab, SWPropertiesTab } from '@/features/integrations/solidworks'
import { SWDatacardPanel } from '@/features/integrations/solidworks'
import { InspectionTab } from '@/features/integrations/solidworks'
import { VendorsTab } from './VendorsTab'
import { PdfAnnotationViewer } from './components/PdfAnnotationViewer'
import type { AnnotationOverlay } from './components/PdfAnnotationViewer'
import { CommentSidebar } from './components/CommentSidebar'
import {
  FileBox,
  Layers,
  FileText,
  File,
  Clock,
  User,
  Tag,
  Hash,
  Info,
  Cloud,
  Loader2,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen,
  ExternalLink,
  Download,
  Eye,
  FolderOpen,
  Pencil,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Sparkles,
} from 'lucide-react'

// Component to load OS icon for files
function DetailsPanelIcon({ file, size = 32 }: { file: LocalFile; size?: number }) {
  const iconUrl = useMemo(() => buildThumbnailUrl(file, 'grid'), [file])
  const { src, onError } = useRetryableImage(iconUrl)

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="flex-shrink-0 rounded"
        style={{ width: size, height: size }}
        decoding="async"
        onError={onError}
      />
    )
  }

  // Fallback to React icons
  const iconType = getFileIconType(file.extension)
  switch (iconType) {
    case 'part':
      return <FileBox size={size} className="text-plm-accent" />
    case 'assembly':
      return <Layers size={size} className="text-amber-400" />
    case 'drawing':
      return <FilePen size={size} className="text-sky-300" />
    case 'step':
      return <FileBox size={size} className="text-orange-400" />
    case 'pdf':
      return <FileType size={size} className="text-red-400" />
    case 'image':
      return <FileImage size={size} className="text-purple-400" />
    case 'spreadsheet':
      return <FileSpreadsheet size={size} className="text-green-400" />
    case 'archive':
      return <FileArchive size={size} className="text-yellow-500" />
    case 'schematic':
      return <Cpu size={size} className="text-red-400" />
    case 'library':
      return <Cpu size={size} className="text-violet-400" />
    case 'pcb':
      return <Cpu size={size} className="text-emerald-400" />
    case 'code':
      return <FileCode size={size} className="text-sky-400" />
    case 'text':
      return <FileText size={size} className="text-plm-fg-muted" />
    default:
      return <File size={size} className="text-plm-fg-muted" />
  }
}

export function DetailsPanel() {
  const {
    selectedFiles,
    getSelectedFileObjects,
    detailsPanelHeight,
    detailsPanelTab,
    setDetailsPanelTab,
    rightPanelTabs,
    moveTabToRight,
    moveTabToBottom,
    reorderTabsInPanel,
    bottomPanelTabOrder,
    user,
    addToast,
    cadPreviewMode,
    lowercaseExtensions,
    files,
    organization,
    updatePendingMetadata,
  } = usePDMStore(
    useShallow((s) => ({
      selectedFiles: s.selectedFiles,
      getSelectedFileObjects: s.getSelectedFileObjects,
      detailsPanelHeight: s.detailsPanelHeight,
      detailsPanelTab: s.detailsPanelTab,
      setDetailsPanelTab: s.setDetailsPanelTab,
      rightPanelTabs: s.rightPanelTabs,
      moveTabToRight: s.moveTabToRight,
      moveTabToBottom: s.moveTabToBottom,
      reorderTabsInPanel: s.reorderTabsInPanel,
      bottomPanelTabOrder: s.bottomPanelTabOrder,
      user: s.user,
      addToast: s.addToast,
      cadPreviewMode: s.cadPreviewMode,
      lowercaseExtensions: s.lowercaseExtensions,
      files: s.files,
      organization: s.organization,
      updatePendingMetadata: s.updatePendingMetadata,
    })),
  )

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null
  const isFolder = file?.isDirectory || false

  // Editable property state
  const [editingField, setEditingField] = useState<
    'itemNumber' | 'description' | 'revision' | 'state' | null
  >(null)
  const [editValue, setEditValue] = useState('')
  const [isSavingEdit] = useState(false)
  const [isGeneratingSerial, setIsGeneratingSerial] = useState(false)

  // Folder-specific state
  const [folderStats, setFolderStats] = useState<{
    size: number
    fileCount: number
    folderCount: number
  } | null>(null)

  // eDrawings state
  const [eDrawingsStatus, setEDrawingsStatus] = useState<{
    checked: boolean
    installed: boolean
    path: string | null
  }>({ checked: false, installed: false, path: null })

  const [cadZoom, setCadZoom] = useState(100) // Zoom percentage (100 = fit to pane)

  // Handle tab drop from either panel
  const handleTabDrop = useCallback(
    (tabId: string, fromLocation: PanelLocation, toLocation: PanelLocation) => {
      if (fromLocation === toLocation) return // No change needed

      if (toLocation === 'bottom' && fromLocation === 'right') {
        // Moving from right panel to bottom
        moveTabToBottom(tabId as DetailsPanelTab)
      } else if (toLocation === 'right' && fromLocation === 'bottom') {
        // Moving from bottom panel to right
        moveTabToRight(tabId as DetailsPanelTab)
      }
    },
    [moveTabToBottom, moveTabToRight],
  )

  // Reset zoom when file changes
  useEffect(() => {
    setCadZoom(100)
  }, [file?.path])

  // Check if eDrawings is installed (once on mount)
  useEffect(() => {
    const checkEDrawings = async () => {
      if (!window.electronAPI?.checkEDrawingsInstalled) {
        setEDrawingsStatus({ checked: true, installed: false, path: null })
        return
      }

      try {
        const result = await window.electronAPI.checkEDrawingsInstalled()
        setEDrawingsStatus({
          checked: true,
          installed: result.installed,
          path: result.path,
        })
      } catch (error) {
        log.error('[DetailsPanel]', 'Failed to check eDrawings', { error: error })
        setEDrawingsStatus({ checked: true, installed: false, path: null })
      }
    }

    checkEDrawings()
  }, [])

  // NOTE: PDF loading is now handled internally by PdfAnnotationViewer.
  // The old useEffect that created a data URL for the iframe has been removed.

  // CAD preview URL. The main process resolves it against the thumbnail cache,
  // preferring the full-resolution OLE stream and falling back to the Document
  // Manager image, so this component no longer sequences those itself.
  const cadPreviewUrl = useMemo(() => {
    if (cadPreviewMode === 'edrawings' || detailsPanelTab !== 'preview' || !file) return null
    return buildThumbnailUrl(file, 'preview')
  }, [file, detailsPanelTab, cadPreviewMode])

  const { src: cadThumbnail, onError: onCadPreviewError } = useRetryableImage(cadPreviewUrl)

  // Calculate folder stats when a folder is selected
  useEffect(() => {
    if (!file || !isFolder) {
      setFolderStats(null)
      return
    }

    const folderPath = file.relativePath
    const filesInFolder = files.filter(
      (f) => !f.isDirectory && f.relativePath.startsWith(folderPath + '/'),
    )
    const foldersInFolder = files.filter(
      (f) =>
        f.isDirectory &&
        f.relativePath.startsWith(folderPath + '/') &&
        f.relativePath !== folderPath,
    )

    let totalSize = 0
    for (const f of filesInFolder) {
      totalSize += f.size || 0
    }

    setFolderStats({
      size: totalSize,
      fileCount: filesInFolder.length,
      folderCount: foldersInFolder.length,
    })
  }, [file, isFolder, files])

  // Check if file is editable
  // - Unsynced files (no pdmData.id): always editable (local-only files)
  // - Synced files (has pdmData.id): must be checked out by current user
  const isFileEditable = file && (!file.pdmData?.id || file.pdmData?.checked_out_by === user?.id)

  // Org-wide: parts/assemblies file-level revision lockout
  const fileExt = file?.extension?.toLowerCase()
  const isModelFile = fileExt === '.sldprt' || fileExt === '.sldasm'
  const allowModelRevision = organization?.settings?.allow_file_level_revision_for_models
  const isRevisionEditable = !!isFileEditable && !(isModelFile && !allowModelRevision)

  // Handle starting edit of a property field
  const handleStartEdit = (field: 'itemNumber' | 'description' | 'revision' | 'state') => {
    if (!file) return

    // For synced files, require checkout (except state changes)
    if (file.pdmData?.id && file.pdmData.checked_out_by !== user?.id) {
      addToast('info', 'Check out file to edit metadata')
      return
    }
    // Unsynced files (no pdmData.id) are always editable - allows setting metadata before first sync

    const resolved = resolveFileMetadata(file)
    let currentValue = ''
    switch (field) {
      case 'itemNumber':
        currentValue = resolvedText(resolved.partNumber)
        break
      case 'description':
        currentValue = resolvedText(resolved.description)
        break
      case 'revision':
        currentValue = resolvedText(resolved.revision)
        break
    }

    setEditingField(field)
    setEditValue(currentValue)
  }

  // Save metadata to SolidWorks file
  // Writes to BOTH file-level AND default configuration so PRP references in drawings work
  // Uses live SW API if file is open (keeps file open), otherwise Document Manager (faster)
  const saveMetadataToSWFile = useCallback(
    async (
      targetFile: LocalFile,
      updates: { part_number?: string | null; description?: string | null; revision?: string },
      edit: PendingMetadataEdit,
    ) => {
      const ext = targetFile.extension?.toLowerCase() || ''
      // Not a SolidWorks document: there is no file write, and the pending edit is the only record
      // of it until check-in promotes it.
      if (!['.sldprt', '.sldasm', '.slddrw'].includes(ext)) return

      const watcherKey = targetFile.relativePath
      let watcherSuppressed = false
      // If this write is still pending after a moment, it likely triggered a cold
      // SolidWorks launch (~40s on the first edit). Surface a non-blocking hint.
      const slowWriteTimer = setTimeout(() => {
        addToast('info', 'Starting SolidWorks — the first edit can take up to a minute…')
      }, 1500)
      try {
        // The fields this edit touched, laid over what the file should hold for the rest. Built by
        // the shared planner rather than here: presence decides, not truthiness, so a field cleared
        // to nothing is written as an empty property instead of being dropped from the request. This
        // panel used to build the properties itself and return early when they all came out empty,
        // which made a full clear the one edit that could never reach the file.
        const resolved = resolveFileMetadata(targetFile)
        const [group] = buildMetadataWritePlan({
          pending: updates,
          committed: {
            partNumber: resolvedText(resolved.partNumber),
            description: resolvedText(resolved.description),
            revision: resolvedText(resolved.revision),
          },
          configurations: [],
          serialization: null,
        })

        if (!group || group.intents.length === 0) return
        const props = group.properties

        // Check if file is open in SolidWorks
        const isOpenResult = await window.electronAPI?.solidworks?.isDocumentOpen?.(targetFile.path)
        const isOpenInSW = !!(isOpenResult?.success && isOpenResult.data?.isOpen)

        // Suppress the FileWatcher for this path while SW mutates SLDPRT bytes. Otherwise
        // the watcher's debounced reload races against our post-write hash refresh and can
        // re-stamp stale localHash/localVersion before we update the store.
        usePDMStore.getState().addExpectedFileChanges([watcherKey])
        watcherSuppressed = true

        const result = await writeMetadataWithVerification({
          path: targetFile.path,
          groups: [group],
          useLiveApi: isOpenInSW,
        })

        reportMetadataWrite(edit, result)

        const landed = result.addresses.some(
          (entry) => entry.state === 'verified' || entry.state === 'unverified',
        )

        if (landed) {
          // Mirror the file-scope values into the active configuration so $PRP references in
          // drawings resolve. Uses the verification read-back rather than a second read: this panel
          // read the document here anyway, so confirming the write costs it nothing. Left
          // unverified deliberately - these are copies of values whose own addresses are confirmed
          // above, and a second read-back to check the copies would double the cost of every edit.
          //
          // A configuration that already holds its own value keeps it, on a clear as much as on a
          // set: a per-configuration description has its own address and its own editor, and
          // clearing the file-level one is not a request to wipe 68 of them. `propertiesToMirror`
          // is where that rule lives and is tested.
          if (ext !== '.slddrw' && result.document) {
            const configs = result.document.configurations
            const activeConfig =
              configs.find((c) => c.toLowerCase() === 'default') ||
              configs.find((c) => c.toLowerCase() === 'standard') ||
              configs[0]

            if (activeConfig) {
              const mirrored = propertiesToMirror(
                props,
                configurationScopeProperties(result.document, activeConfig),
              )
              if (Object.keys(mirrored).length > 0) {
                const mirror = isOpenInSW
                  ? await window.electronAPI?.solidworks?.setDocumentProperties?.(
                      targetFile.path,
                      mirrored,
                      activeConfig,
                    )
                  : await window.electronAPI?.solidworks?.setProperties(
                      targetFile.path,
                      mirrored,
                      activeConfig,
                    )

                // The copy's own outcome used to be dropped on the floor, so a mirror that failed
                // left a title block resolving to the old text with nothing anywhere saying so.
                // Not a reason to fail the edit - the addresses the user named are confirmed above,
                // and these are copies - but it is a reason to say so.
                if (!mirror?.success) {
                  log.warn(
                    '[DetailsPanel]',
                    'File-scope values were not copied into the active configuration',
                    {
                      path: targetFile.path,
                      configuration: activeConfig,
                      fields: Object.keys(mirrored),
                      error: mirror?.error,
                    },
                  )
                }
              }
            }
          }

          // Mark as recently modified to protect from LoadFiles overwrite
          if (targetFile.pdmData?.id) {
            usePDMStore.getState().markFileAsRecentlyModified(targetFile.pdmData.id)
          }
          // NOTE: We do NOT clear pendingMetadata here - it must persist until check-in
          // so the server gets updated with the new values.

          // Refresh localHash to match new disk content. Also clear localVersion: the
          // pre-write value tracks "version of disk content when downloaded/checked-in",
          // and that content no longer matches disk. Leaving it stale would let the
          // version-only branch in useLoadFiles classify this file as synced even though
          // bytes on disk diverge from pdmData.content_hash. Setting it to undefined
          // forces the merge to use hash-based detection, which is the only honest signal
          // after a local mutation.
          let freshHash: string | undefined
          try {
            const hashResult = await window.electronAPI?.hashFile(targetFile.path)
            if (hashResult?.success && hashResult.hash) {
              freshHash = hashResult.hash
            } else {
              log.warn(
                '[DetailsPanel]',
                'Failed to rehash after metadata write; clearing stale localHash',
                {
                  path: targetFile.path,
                  error: hashResult?.error,
                },
              )
            }
          } catch (error) {
            log.warn('[DetailsPanel]', 'Exception rehashing after metadata write', {
              path: targetFile.path,
              error: String(error),
            })
          }
          usePDMStore.getState().updateFileInStore(targetFile.path, {
            localHash: freshHash,
            localVersion: undefined,
          })
        }
      } catch (error) {
        log.error('[DetailsPanel]', 'Metadata write threw', {
          path: targetFile.path,
          error: String(error),
        })
        // The typed value stays; the fields it touched are marked as not in the file.
        reportMetadataWrite(edit, {
          outcome: 'failed',
          addresses: listWriteAddresses(edit.pending).map((address) => ({
            address,
            state: 'failed' as const,
            reason: error instanceof Error ? error.message : String(error),
          })),
        })
      } finally {
        clearTimeout(slowWriteTimer)
        // Delay clearing watcher suppression so the debounced FileWatcher event
        // triggered by our SW write is filtered out, not the next legitimate edit.
        if (watcherSuppressed) {
          setTimeout(() => {
            usePDMStore.getState().clearExpectedFileChanges([watcherKey])
          }, 5000)
        }
      }
    },
    [addToast],
  )

  // Handle saving an edited property
  const handleSaveEdit = async () => {
    if (!editingField || !file || !user) {
      setEditingField(null)
      setEditValue('')
      return
    }
    // Allow saving for both synced and unsynced files
    // Unsynced files store metadata in pendingMetadata which gets synced on first upload

    const trimmedValue = editValue.trim()

    // Get current value to check if changed (consider pending metadata too)
    const current = resolveFileMetadata(file)
    let currentValue = ''
    switch (editingField) {
      case 'itemNumber':
        currentValue = resolvedText(current.partNumber)
        break
      case 'description':
        currentValue = resolvedText(current.description)
        break
      case 'revision':
        currentValue = resolvedText(current.revision)
        break
    }

    if (trimmedValue === currentValue) {
      setEditingField(null)
      setEditValue('')
      return
    }

    // For item number, description, revision - save locally only (syncs on check-in)
    const pendingUpdates: {
      part_number?: string | null
      description?: string | null
      revision?: string
    } = {}
    switch (editingField) {
      case 'itemNumber':
        pendingUpdates.part_number = trimmedValue || null
        break
      case 'description':
        pendingUpdates.description = trimmedValue || null
        break
      case 'revision':
        pendingUpdates.revision = trimmedValue.toUpperCase()
        break
    }

    // Update pending metadata in store
    const edit = updatePendingMetadata(file.path, pendingUpdates)

    // Clear edit state first so UI is responsive
    setEditingField(null)
    setEditValue('')

    // Auto-save to SolidWorks file
    await saveMetadataToSWFile(file, pendingUpdates, edit)
  }

  // Handle generating a serial number for item number - auto-saves immediately
  // Works for both synced files (checked out) and unsynced local files
  const handleGenerateSerial = async () => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }

    if (!file) return

    // No longer require file to be synced - BR numbers can be generated for local files
    // The org counter increments atomically, so there won't be conflicts when multiple users
    // generate numbers for their local files before syncing

    try {
      // Generate the serial number first (no spinner yet - this is fast)
      const serial = await getNextSerialNumber(organization.id)
      if (!serial) {
        addToast('error', 'Serialization is disabled or failed')
        return
      }

      // Show the generated number immediately in the input
      setEditValue(serial)

      // Update pending metadata
      const pendingUpdates = { part_number: serial }
      const edit = updatePendingMetadata(file.path, pendingUpdates)

      // Now start the save operation (this is what takes time)
      setIsGeneratingSerial(true)

      // Auto-save to SolidWorks file
      await saveMetadataToSWFile(file, pendingUpdates, edit)

      // Exit edit mode after successful save
      setEditingField(null)
      setEditValue('')
    } catch (error) {
      addToast(
        'error',
        `Failed to generate serial: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setIsGeneratingSerial(false)
    }
  }

  // Handle canceling an edit
  const handleCancelEdit = () => {
    setEditingField(null)
    setEditValue('')
  }

  const getFileIcon = () => {
    if (!file) return <File size={32} className="text-plm-fg-muted" />

    // Keep React icons for folders
    if (file.isDirectory) {
      return <FolderOpen size={32} className="text-plm-warning" />
    }

    // Use OS icons for files
    return <DetailsPanelIcon file={file} size={32} />
  }

  // Check if file is SolidWorks
  const isSolidWorksFile =
    file && ['.sldprt', '.sldasm', '.slddrw'].includes(file.extension?.toLowerCase() || '')

  // Inspection tables are drawing-only
  const isDrawingFile = !!file && file.extension?.toLowerCase() === '.slddrw'

  // For SolidWorks files, use Preview tab (metadata is edited inline in the file tree)
  const allTabs: { id: DetailsPanelTab; label: string }[] =
    isSolidWorksFile && !isFolder
      ? [
          { id: 'preview', label: 'Preview' },
          { id: 'whereused', label: 'Where Used' },
          { id: 'vendors', label: 'Vendors' },
          ...(isDrawingFile ? [{ id: 'inspection' as const, label: 'Inspection' }] : []),
        ]
      : [
          { id: 'preview', label: 'Preview' },
          { id: 'properties', label: 'Properties' },
          { id: 'whereused', label: 'Where Used' },
          { id: 'vendors', label: 'Vendors' },
        ]

  // Filter out tabs that are in the right panel, then sort by custom order
  const filteredTabs = allTabs.filter((tab) => !rightPanelTabs.includes(tab.id))
  const tabs =
    bottomPanelTabOrder.length > 0
      ? [...filteredTabs].sort((a, b) => {
          const aIndex = bottomPanelTabOrder.indexOf(a.id as DetailsPanelTab)
          const bIndex = bottomPanelTabOrder.indexOf(b.id as DetailsPanelTab)
          // Tabs not in custom order go to end, maintaining their relative order
          if (aIndex === -1 && bIndex === -1) return 0
          if (aIndex === -1) return 1
          if (bIndex === -1) return -1
          return aIndex - bIndex
        })
      : filteredTabs

  // Handle tab reorder within bottom panel
  const handleTabReorder = useCallback(
    (tabId: string, newIndex: number) => {
      reorderTabsInPanel('bottom', tabId as DetailsPanelTab, newIndex)
    },
    [reorderTabsInPanel],
  )

  // Auto-switch to preview tab when selecting a SolidWorks file (properties tab not available for SW files)
  useEffect(() => {
    if (isSolidWorksFile && !isFolder && detailsPanelTab === 'properties') {
      setDetailsPanelTab('preview')
    }
  }, [isSolidWorksFile, isFolder, detailsPanelTab, setDetailsPanelTab])

  // Inspection tab is drawing-only; switch away if a non-drawing becomes selected
  useEffect(() => {
    if (detailsPanelTab === 'inspection' && !isDrawingFile) {
      setDetailsPanelTab('preview')
    }
  }, [detailsPanelTab, isDrawingFile, setDetailsPanelTab])

  // Check file types for preview
  const ext = file?.extension?.toLowerCase() || ''
  const isCADFile = [
    '.sldprt',
    '.sldasm',
    '.slddrw',
    '.step',
    '.stp',
    '.stl',
    '.iges',
    '.igs',
  ].includes(ext)
  const isImageFile = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)
  const isPDFFile = ext === '.pdf'

  // Open file in eDrawings
  const handleOpenInEDrawings = async () => {
    if (!file?.path) return

    try {
      await window.electronAPI?.openInEDrawings(file.path)
    } catch (error) {
      log.error('[DetailsPanel]', 'Failed to open in eDrawings', { error: error })
      addToast('error', 'Failed to open in eDrawings')
    }
  }

  return (
    <div
      className="details-panel bg-plm-panel border-t border-plm-border flex flex-col"
      style={{ height: detailsPanelHeight }}
    >
      {/* Tabs - Droppable zone */}
      <TabDropZone
        location="bottom"
        onDrop={handleTabDrop}
        className="tabs flex-shrink-0 relative min-h-[32px]"
        tabCount={tabs.length}
      >
        {tabs.map((tab, index) => (
          <DraggableTab
            key={tab.id}
            id={tab.id}
            label={tab.label}
            active={detailsPanelTab === tab.id}
            location="bottom"
            index={index}
            onClick={() => setDetailsPanelTab(tab.id)}
            onDoubleClick={() => moveTabToRight(tab.id)}
            onDragStart={() => {}}
            onDragEnd={() => {}}
            onReorder={handleTabReorder}
            tooltip={t('source.details.dragToReorder')}
          />
        ))}
      </TabDropZone>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {selectedFiles.length === 0 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            {t('source.details.selectFileToView')}
          </div>
        ) : selectedFiles.length > 1 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            {selectedFiles.length} {t('source.details.filesSelected')}
          </div>
        ) : (
          file && (
            <>
              {/* Preview tab for SolidWorks files */}
              {detailsPanelTab === 'preview' && isSolidWorksFile && !isFolder && (
                <SWDatacardPanel file={file} />
              )}

              {detailsPanelTab === 'properties' &&
                (isSolidWorksFile && !isFolder ? (
                  // SolidWorks files get the full SW Properties view with export options
                  <SWPropertiesTab file={file} />
                ) : (
                  // Standard properties view for non-SW files and folders
                  <div className="flex gap-6">
                    {/* File/Folder icon and name */}
                    <div className="flex items-start gap-4 flex-shrink-0">
                      {getFileIcon()}
                      <div>
                        <div className="font-semibold text-lg">{file.name}</div>
                        <div className="text-sm text-plm-fg-muted">{file.relativePath}</div>
                        {!isFolder && file.pdmData?.workflow_state && (
                          <span
                            className="px-2 py-0.5 rounded text-xs font-medium mt-2 inline-block"
                            style={{
                              backgroundColor: file.pdmData.workflow_state.color + '30',
                              color: file.pdmData.workflow_state.color,
                            }}
                          >
                            {file.pdmData.workflow_state.label || file.pdmData.workflow_state.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Properties grid */}
                    <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                      {isFolder ? (
                        // Folder properties
                        <>
                          <PropertyItem
                            icon={<Info size={14} />}
                            label={t('common.type')}
                            value={t('common.folder')}
                          />
                          <PropertyItem
                            icon={<Info size={14} />}
                            label={t('common.size')}
                            value={
                              folderStats
                                ? formatFileSize(folderStats.size)
                                : t('source.details.calculating')
                            }
                          />
                          <PropertyItem
                            icon={<File size={14} />}
                            label={t('common.files')}
                            value={folderStats ? String(folderStats.fileCount) : '...'}
                          />
                          <PropertyItem
                            icon={<FolderOpen size={14} />}
                            label={t('common.folders')}
                            value={folderStats ? String(folderStats.folderCount) : '...'}
                          />
                          <PropertyItem
                            icon={<Clock size={14} />}
                            label={t('fileBrowser.modified')}
                            value={
                              file.modifiedTime
                                ? (() => {
                                    try {
                                      const date = new Date(file.modifiedTime)
                                      return isNaN(date.getTime())
                                        ? '-'
                                        : format(date, 'MMM d, yyyy HH:mm')
                                    } catch {
                                      return '-'
                                    }
                                  })()
                                : '-'
                            }
                          />
                          <PropertyItem
                            icon={<Cloud size={14} />}
                            label={t('source.details.location')}
                            value={
                              file.relativePath.includes('/')
                                ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
                                : '/'
                            }
                          />
                        </>
                      ) : (
                        // File properties (non-SW files)
                        <>
                          {/* Values the user typed that are not in the file, kept and labelled with
                              a retry rather than discarded. */}
                          <MetadataWriteStateMarker
                            file={file}
                            onRetry={(target, retry) => {
                              void saveMetadataToSWFile(
                                target,
                                {
                                  part_number: retry.pending.part_number,
                                  description: retry.pending.description,
                                  revision: retry.pending.revision ?? undefined,
                                },
                                retry,
                              )
                            }}
                          />
                          <EditablePropertyItem
                            icon={<Tag size={14} />}
                            label={t('fileBrowser.itemNumber')}
                            value={resolvedText(resolvePartNumber(file), '-')}
                            isEditing={editingField === 'itemNumber'}
                            editValue={editValue}
                            isSaving={isSavingEdit}
                            editable={!!isFileEditable}
                            onStartEdit={() => handleStartEdit('itemNumber')}
                            onSave={handleSaveEdit}
                            onCancel={handleCancelEdit}
                            onEditValueChange={setEditValue}
                            placeholder="-"
                            onGenerate={handleGenerateSerial}
                            isGenerating={isGeneratingSerial}
                          />
                          <EditablePropertyItem
                            icon={<FileText size={14} />}
                            label={t('common.description')}
                            value={resolvedText(resolveDescription(file), '-')}
                            isEditing={editingField === 'description'}
                            editValue={editValue}
                            isSaving={isSavingEdit}
                            editable={!!isFileEditable}
                            onStartEdit={() => handleStartEdit('description')}
                            onSave={handleSaveEdit}
                            onCancel={handleCancelEdit}
                            onEditValueChange={setEditValue}
                            placeholder="-"
                          />
                          <EditablePropertyItem
                            icon={<Hash size={14} />}
                            label={t('source.details.revision')}
                            value={resolvedText(resolveRevision(file), '-')}
                            isEditing={editingField === 'revision'}
                            editValue={editValue}
                            isSaving={isSavingEdit}
                            editable={isRevisionEditable}
                            onStartEdit={() => handleStartEdit('revision')}
                            onSave={handleSaveEdit}
                            onCancel={handleCancelEdit}
                            onEditValueChange={setEditValue}
                            placeholder="-"
                            tooltip={
                              isModelFile && !allowModelRevision
                                ? 'Revision is controlled from drawings (org policy)'
                                : undefined
                            }
                          />
                          {/* State - display only, changes via workflow transitions */}
                          <div className="flex items-center gap-2">
                            <span className="text-plm-fg-muted">
                              <RefreshCw size={14} />
                            </span>
                            <span className="text-plm-fg-muted">{t('fileBrowser.state')}:</span>
                            {file.pdmData?.workflow_state ? (
                              <span
                                className="px-2 py-0.5 rounded text-xs font-medium"
                                style={{
                                  backgroundColor: file.pdmData.workflow_state.color + '30',
                                  color: file.pdmData.workflow_state.color,
                                }}
                                title={
                                  file.pdmData.workflow_state.is_editable
                                    ? t('source.details.editable')
                                    : t('source.details.locked')
                                }
                              >
                                {file.pdmData.workflow_state.label ||
                                  file.pdmData.workflow_state.name}
                              </span>
                            ) : (
                              <span className="text-plm-fg-muted">—</span>
                            )}
                          </div>
                          <PropertyItem
                            icon={<Hash size={14} />}
                            label={t('common.version')}
                            value={String(file.pdmData?.version || 1)}
                          />
                          <PropertyItem
                            icon={<Info size={14} />}
                            label={t('common.type')}
                            value={
                              file.extension
                                ? lowercaseExtensions !== false
                                  ? file.extension.replace('.', '').toLowerCase()
                                  : file.extension.replace('.', '').toUpperCase()
                                : t('common.file')
                            }
                          />
                          <PropertyItem
                            icon={<Clock size={14} />}
                            label={t('fileBrowser.modified')}
                            value={
                              file.modifiedTime
                                ? (() => {
                                    try {
                                      const date = new Date(file.modifiedTime)
                                      return isNaN(date.getTime())
                                        ? '-'
                                        : format(date, 'MMM d, yyyy HH:mm')
                                    } catch {
                                      return '-'
                                    }
                                  })()
                                : '-'
                            }
                          />
                          <PropertyItem
                            icon={<Info size={14} />}
                            label={t('common.size')}
                            value={formatFileSize(file.size)}
                          />
                          <PropertyItem
                            icon={<User size={14} />}
                            label={t('source.details.checkedOut')}
                            value={
                              file.pdmData?.checked_out_by
                                ? (file.pdmData as any).checked_out_user?.full_name || // TODO: type this
                                  (file.pdmData as any).checked_out_user?.email || // TODO: type this
                                  t('source.details.someone')
                                : t('source.details.notCheckedOut')
                            }
                          />
                          <PropertyItem
                            icon={<Cloud size={14} />}
                            label={t('source.details.syncStatus')}
                            value={
                              file.pdmData
                                ? t('source.details.synced')
                                : file.diffStatus === 'ignored'
                                  ? t('source.details.localOnlyIgnored')
                                  : t('source.details.localOnly')
                            }
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}

              {detailsPanelTab === 'preview' && !(isSolidWorksFile && !isFolder) && (
                <div className="flex flex-col items-center justify-center h-full py-4">
                  {!file ? (
                    <div className="text-sm text-plm-fg-muted">
                      {t('source.details.selectFileToPreview')}
                    </div>
                  ) : isPDFFile ? (
                    // PDF preview with annotation support + comment sidebar
                    <PdfWithComments file={file} />
                  ) : isImageFile ? (
                    // Image preview
                    <div className="w-full h-full flex items-center justify-center overflow-hidden">
                      <img
                        src={`file://${file.path}`}
                        alt={file.name}
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    </div>
                  ) : isCADFile ? (
                    // CAD file - show thumbnail or eDrawings based on setting
                    <div className="w-full h-full flex flex-col">
                      {cadPreviewMode === 'edrawings' ? (
                        // eDrawings mode - just show button to open externally
                        eDrawingsStatus.installed ? (
                          <div className="flex-1 flex flex-col items-center justify-center">
                            <FileBox size={48} className="mb-4 text-plm-accent" />
                            <div className="text-sm font-medium mb-2">{file.name}</div>
                            <button
                              onClick={handleOpenInEDrawings}
                              className="btn btn-primary gap-2"
                            >
                              <ExternalLink size={16} />
                              {t('source.details.openInEDrawings')}
                            </button>
                            <div className="text-xs text-plm-fg-muted mt-4">
                              {t('source.details.externalViewerNote')}
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-center">
                            <Eye size={48} className="mb-4 text-plm-fg-muted opacity-50" />
                            <div className="text-lg font-medium mb-2">
                              {t('source.details.eDrawingsNotFound')}
                            </div>
                            <div className="text-sm text-plm-fg-muted mb-4 max-w-xs">
                              {t('source.details.installEDrawings')}
                            </div>
                            <a
                              href="https://www.solidworks.com/support/free-downloads"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-primary gap-2"
                              onClick={(e) => {
                                e.preventDefault()
                                window.electronAPI?.openFile(
                                  'https://www.solidworks.com/support/free-downloads',
                                )
                              }}
                            >
                              <Download size={16} />
                              {t('source.details.downloadEDrawings')}
                            </a>
                          </div>
                        )
                      ) : cadThumbnail ? (
                        // Show extracted thumbnail with zoom controls
                        <div className="flex-1 flex flex-col min-h-0">
                          <div
                            className="flex-1 flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 rounded overflow-auto relative"
                            style={{ minHeight: 0 }}
                            onWheel={(e) => {
                              if (e.ctrlKey || e.metaKey) {
                                e.preventDefault()
                                const delta = e.deltaY > 0 ? -10 : 10
                                setCadZoom((prev) => Math.max(25, Math.min(400, prev + delta)))
                              }
                            }}
                          >
                            <img
                              src={cadThumbnail}
                              alt={file.name}
                              className="object-contain transition-transform duration-150"
                              decoding="async"
                              onError={onCadPreviewError}
                              style={{
                                width: cadZoom === 100 ? '100%' : 'auto',
                                height: cadZoom === 100 ? '100%' : 'auto',
                                maxWidth: cadZoom === 100 ? '100%' : 'none',
                                maxHeight: cadZoom === 100 ? '100%' : 'none',
                                transform: cadZoom !== 100 ? `scale(${cadZoom / 100})` : undefined,
                                transformOrigin: 'center center',
                              }}
                            />
                          </div>
                          {/* Zoom controls */}
                          <div className="flex items-center justify-center gap-2 py-2 border-t border-plm-border">
                            <button
                              onClick={() => setCadZoom((prev) => Math.max(25, prev - 25))}
                              className="btn btn-sm btn-ghost p-1"
                              title={t('source.details.zoomOut')}
                              disabled={cadZoom <= 25}
                            >
                              <ZoomOut size={16} />
                            </button>
                            <span className="text-xs text-plm-fg-muted w-12 text-center">
                              {cadZoom}%
                            </span>
                            <button
                              onClick={() => setCadZoom((prev) => Math.min(400, prev + 25))}
                              className="btn btn-sm btn-ghost p-1"
                              title={t('source.details.zoomIn')}
                              disabled={cadZoom >= 400}
                            >
                              <ZoomIn size={16} />
                            </button>
                            <button
                              onClick={() => setCadZoom(100)}
                              className="btn btn-sm btn-ghost p-1 ml-2"
                              title={t('source.details.resetToFit')}
                              disabled={cadZoom === 100}
                            >
                              <RotateCw size={14} />
                            </button>
                            {eDrawingsStatus.installed && (
                              <button
                                onClick={handleOpenInEDrawings}
                                className="btn btn-sm btn-secondary gap-1 ml-2"
                                title={t('source.details.openInFullEDrawings')}
                              >
                                <ExternalLink size={12} />
                                {t('source.details.eDrawingsLabel')}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : eDrawingsStatus.installed ? (
                        // No thumbnail but eDrawings available
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <FileBox size={48} className="mb-4 text-plm-accent" />
                          <div className="text-sm font-medium mb-2">{file.name}</div>
                          <div className="text-xs text-plm-fg-muted mb-4">
                            {t('source.details.noEmbeddedPreview')}
                          </div>
                          <button onClick={handleOpenInEDrawings} className="btn btn-primary gap-2">
                            <ExternalLink size={16} />
                            {t('source.details.openInEDrawings')}
                          </button>
                        </div>
                      ) : (
                        // No thumbnail, no eDrawings
                        <div className="flex-1 flex flex-col items-center justify-center text-center">
                          <Eye size={48} className="mb-4 text-plm-fg-muted opacity-50" />
                          <div className="text-lg font-medium mb-2">
                            {t('source.details.noPreviewAvailable')}
                          </div>
                          <div className="text-sm text-plm-fg-muted mb-4 max-w-xs">
                            {t('source.details.installEDrawings')}
                          </div>
                          <a
                            href="https://www.solidworks.com/support/free-downloads"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary gap-2"
                            onClick={(e) => {
                              e.preventDefault()
                              window.electronAPI?.openFile(
                                'https://www.solidworks.com/support/free-downloads',
                              )
                            }}
                          >
                            <Download size={16} />
                            {t('source.details.downloadEDrawings')}
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Other files - no preview
                    <div className="text-sm text-plm-fg-muted text-center">
                      <Eye size={48} className="mx-auto mb-4 opacity-30" />
                      <div>{t('source.details.noPreview')}</div>
                      <div className="text-xs mt-2 opacity-70">
                        {file.extension
                          ? lowercaseExtensions !== false
                            ? file.extension.toLowerCase()
                            : file.extension.toUpperCase()
                          : t('source.details.unknown')}{' '}
                        {t('source.details.cannotPreview')}
                      </div>
                      <button
                        onClick={() => window.electronAPI?.openFile(file.path)}
                        className="btn btn-secondary gap-2 mt-4"
                      >
                        <ExternalLink size={14} />
                        {t('source.details.openWithDefaultApp')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {detailsPanelTab === 'whereused' && <WhereUsedTab file={file} />}

              {detailsPanelTab === 'vendors' && <VendorsTab file={file} />}

              {detailsPanelTab === 'inspection' && isDrawingFile && <InspectionTab file={file} />}
            </>
          )
        )}
      </div>
    </div>
  )
}

// ============================================================================
// PdfWithComments - PDF viewer + comment sidebar layout
// ============================================================================

/**
 * Renders PdfAnnotationViewer (~70%) alongside CommentSidebar (~30%).
 * Wires annotation creation events to the store so CommentSidebar can
 * display the input and persist the comment.
 */
function PdfWithComments({ file }: { file: LocalFile }) {
  const annotations = usePDMStore((s) => s.annotations)
  const activeAnnotationId = usePDMStore((s) => s.activeAnnotationId)
  const setActiveAnnotationId = usePDMStore((s) => s.setActiveAnnotationId)
  const hoveredAnnotationId = usePDMStore((s) => s.hoveredAnnotationId)
  const setHoveredAnnotationId = usePDMStore((s) => s.setHoveredAnnotationId)
  const setShowCommentInput = usePDMStore((s) => s.setShowCommentInput)
  const pendingAnnotation = usePDMStore((s) => s.pendingAnnotation)
  const setPendingAnnotation = usePDMStore((s) => s.setPendingAnnotation)
  const clearAnnotations = usePDMStore((s) => s.clearAnnotations)
  const rightPanelVisible = usePDMStore((s) => s.rightPanelVisible)

  const fileId = file.pdmData?.id

  // Clear annotations when the file changes
  useEffect(() => {
    return () => {
      clearAnnotations()
    }
  }, [file.path, clearAnnotations])

  // Map store annotations to AnnotationOverlay[] for the PDF viewer
  const overlays = useMemo<AnnotationOverlay[]>(() => {
    const result: AnnotationOverlay[] = []
    for (const ann of annotations) {
      if (ann.position && ann.page_number != null) {
        result.push({
          id: ann.id,
          pageNumber: ann.page_number,
          position: ann.position,
          resolved: ann.resolved,
        })
      }
      for (const reply of ann.replies ?? []) {
        if (reply.position && reply.page_number != null) {
          result.push({
            id: reply.id,
            pageNumber: reply.page_number,
            position: reply.position,
            resolved: reply.resolved,
          })
        }
      }
    }
    return result
  }, [annotations])

  // When user selects an area on the PDF, open the comment input
  const handleAnnotationCreate = useCallback(
    (data: import('./components/PdfAnnotationViewer').NewAnnotationData) => {
      setPendingAnnotation(data)
      setShowCommentInput(true)
    },
    [setPendingAnnotation, setShowCommentInput],
  )

  // When user clicks an existing annotation overlay, highlight it in the sidebar
  const handleAnnotationClick = useCallback(
    (annotationId: string) => {
      setActiveAnnotationId(annotationId)
    },
    [setActiveAnnotationId],
  )

  const handleAnnotationHover = useCallback(
    (annotationId: string | null) => {
      setHoveredAnnotationId(annotationId)
    },
    [setHoveredAnnotationId],
  )

  return (
    <div className="w-full h-full flex">
      {/* PDF Viewer - takes ~70% width (or 100% if no file ID for commenting) */}
      <div className={fileId ? 'flex-[7] min-w-0' : 'w-full'}>
        <PdfAnnotationViewer
          filePath={file.path}
          fileName={file.name}
          fileVersion={file.pdmData?.version}
          initialScale="page-fit"
          annotations={overlays}
          pendingAnnotation={pendingAnnotation}
          hoveredAnnotationId={hoveredAnnotationId}
          activeAnnotationId={activeAnnotationId}
          onAnnotationCreate={fileId ? handleAnnotationCreate : undefined}
          onAnnotationClick={fileId ? handleAnnotationClick : undefined}
          onAnnotationHover={fileId ? handleAnnotationHover : undefined}
        />
      </div>

      {/* Comment Sidebar - ~30% width, only shown when file has a database ID and right panel is visible */}
      {fileId && rightPanelVisible && (
        <div className="flex-[3] min-w-[220px] max-w-[400px]">
          <CommentSidebar
            fileId={fileId}
            fileName={file.name}
            fileVersion={file.pdmData?.version}
          />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Property display components
// ============================================================================

interface PropertyItemProps {
  icon: React.ReactNode
  label: string
  value: string
}

function PropertyItem({ icon, label, value }: PropertyItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-plm-fg-muted">{icon}</span>
      <span className="text-plm-fg-muted">{label}:</span>
      <span className="text-plm-fg">{value}</span>
    </div>
  )
}

interface EditablePropertyItemProps {
  icon: React.ReactNode
  label: string
  value: string
  isEditing: boolean
  editValue: string
  isSaving: boolean
  editable: boolean
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
  onEditValueChange: (value: string) => void
  placeholder?: string
  onGenerate?: () => void
  isGenerating?: boolean
  /** Override tooltip when not editable (e.g. org policy lockout) */
  tooltip?: string
}

function EditablePropertyItem({
  icon,
  label,
  value,
  isEditing,
  editValue,
  isSaving,
  editable,
  onStartEdit,
  onSave,
  onCancel,
  onEditValueChange,
  placeholder = '-',
  onGenerate,
  isGenerating,
  tooltip,
}: EditablePropertyItemProps) {
  if (isEditing && editable) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-plm-fg-muted">{icon}</span>
        <span className="text-plm-fg-muted">{label}:</span>
        <div className="relative flex-1">
          <input
            type="text"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSave()
              } else if (e.key === 'Escape') {
                onCancel()
              }
            }}
            onBlur={(e) => {
              // Don't save on blur if clicking the generate button
              const relatedTarget = e.relatedTarget as HTMLElement | null
              if (relatedTarget?.dataset?.generateBtn) return
              onSave()
            }}
            autoFocus
            disabled={isSaving || isGenerating}
            className="w-full bg-plm-bg border border-plm-accent rounded pl-2 pr-7 py-0.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50"
          />
          {onGenerate && (
            <button
              data-generate-btn="true"
              onClick={onGenerate}
              disabled={isSaving || isGenerating}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/20 disabled:opacity-50 transition-colors"
              title={t('source.details.generateSerial')}
            >
              {isGenerating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 group">
      <span className={editable ? 'text-plm-fg-muted' : 'text-plm-fg-muted/50'}>{icon}</span>
      <span className={editable ? 'text-plm-fg-muted' : 'text-plm-fg-muted/50'}>{label}:</span>
      <span
        className={`px-1 rounded ${editable ? 'cursor-text hover:bg-plm-bg-light' : ''} ${!value || value === '-' || !editable ? 'text-plm-fg-muted' : 'text-plm-fg'}`}
        onClick={editable ? onStartEdit : undefined}
        title={
          editable ? t('source.details.clickToEdit') : tooltip || t('source.details.checkOutToEdit')
        }
      >
        {value || placeholder}
      </span>
      {editable && (
        <button
          onClick={onStartEdit}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-plm-accent/20 text-plm-fg-muted hover:text-plm-accent transition-opacity"
          title={t('common.edit')}
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  )
}

// StatePropertyItem removed - state changes now use workflow transitions
