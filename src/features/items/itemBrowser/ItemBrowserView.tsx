import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Filter,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  Search,
  Settings2,
  Shapes,
  ShieldCheck,
  Upload,
} from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { isPathHidden } from '@/lib/hiddenFolders'
import { t } from '@/lib/i18n'
import {
  getItemDefinitionSettings,
  getItemDesignationAssignments,
  getItemDesignations,
  getItemImages,
  getOrgWorkflowStages,
  resetItemImage,
  setItemDesignationAssignment,
  setItemIcon,
  updateItemDefinitionSettings,
  uploadItemImage,
} from '@/lib/supabase'
import { buildFullPath } from '@/lib/utils/path'
import { ViewToggle, SizeSlider } from '@/features/source/browser/components/Toolbar'
import type {
  ItemDefinitionSettings,
  ItemDesignation,
  ItemImage,
  ItemRow,
  ItemWorkflowStage,
} from '@/types/item'

import { ItemDefinitionModal } from './components/ItemDefinitionModal'
import { ItemIconModal } from './components/ItemIconModal'
import { ItemGrid } from './components/ItemGrid'
import { ItemTable } from './components/ItemTable'
import { useItems } from './hooks/useItems'

export function ItemBrowserView() {
  const files = usePDMStore((s) => s.files)
  const { enforcedHiddenPaths } = useHiddenFolders()
  const visibleFiles = useMemo(
    () => files.filter((f) => !isPathHidden(f.relativePath, enforcedHiddenPaths)),
    [files, enforcedHiddenPaths],
  )
  const organization = usePDMStore((s) => s.organization)
  const addToast = usePDMStore((s) => s.addToast)
  const itemDefinition = usePDMStore((s) => s.itemDefinition)
  const setItemDefinition = usePDMStore((s) => s.setItemDefinition)
  const setItemDefinitionLoaded = usePDMStore((s) => s.setItemDefinitionLoaded)

  const viewMode = usePDMStore((s) => s.itemViewMode)
  const setViewMode = usePDMStore((s) => s.setItemViewMode)
  const listRowSize = usePDMStore((s) => s.itemListRowSize)
  const setListRowSize = usePDMStore((s) => s.setItemListRowSize)
  const iconSize = usePDMStore((s) => s.itemIconSize)
  const setIconSize = usePDMStore((s) => s.setItemIconSize)
  const columns = usePDMStore((s) => s.itemColumns)
  const setColumns = usePDMStore((s) => s.setItemColumns)

  const vaultPath = usePDMStore((s) => s.vaultPath)
  const activeVaultId = usePDMStore((s) => s.activeVaultId)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const setActiveView = usePDMStore((s) => s.setActiveView)
  const setCurrentFolder = usePDMStore((s) => s.setCurrentFolder)
  const setSelectedFiles = usePDMStore((s) => s.setSelectedFiles)
  const setPendingScrollToFile = usePDMStore((s) => s.setPendingScrollToFile)
  const setItemPanel = usePDMStore((s) => s.setItemPanel)

  const [stages, setStages] = useState<ItemWorkflowStage[]>([])
  const [designations, setDesignations] = useState<ItemDesignation[]>([])
  const [designationAssignments, setDesignationAssignments] = useState<Map<string, string>>(
    new Map(),
  )
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const [imagesByPart, setImagesByPart] = useState<Map<string, ItemImage>>(new Map())
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; itemNumber: string } | null>(
    null,
  )
  const [iconModalItem, setIconModalItem] = useState<string | null>(null)
  const [savingIcon, setSavingIcon] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)

  const rows = useItems(
    visibleFiles,
    itemDefinition,
    stages,
    organization?.serialization_settings,
    designations,
    designationAssignments,
  )

  const canEditDesignation = hasPermission('system:item-designations', 'edit')

  const loadConfig = useCallback(async () => {
    if (!organization?.id) return
    setLoading(true)
    try {
      const [definition, stageList, images, designationList, assignments] = await Promise.all([
        getItemDefinitionSettings(organization.id),
        getOrgWorkflowStages(organization.id),
        getItemImages(organization.id),
        getItemDesignations(organization.id),
        activeVaultId
          ? getItemDesignationAssignments(organization.id, activeVaultId)
          : Promise.resolve(new Map<string, string>()),
      ])
      setItemDefinition(definition)
      setItemDefinitionLoaded(true)
      setStages(stageList)
      setImagesByPart(images)
      setDesignations(designationList)
      setDesignationAssignments(assignments)
    } finally {
      setLoading(false)
    }
  }, [organization?.id, activeVaultId, setItemDefinition, setItemDefinitionLoaded])

  const handleChangeDesignation = useCallback(
    async (itemNumber: string, designationId: string | null) => {
      if (!organization?.id || !activeVaultId) return
      const previous = designationAssignments
      setDesignationAssignments((prev) => {
        const next = new Map(prev)
        if (designationId) next.set(itemNumber, designationId)
        else next.delete(itemNumber)
        return next
      })
      try {
        await setItemDesignationAssignment(
          organization.id,
          activeVaultId,
          itemNumber,
          designationId,
        )
      } catch (error) {
        setDesignationAssignments(previous)
        addToast('error', error instanceof Error ? error.message : 'Failed to update designation')
      }
    },
    [organization?.id, activeVaultId, designationAssignments, addToast],
  )

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // Reveal a file in the Explorer view: switch tabs, navigate to its folder,
  // select it, and queue a scroll so the row is highlighted on arrival.
  const handleOpenInExplorer = useCallback(
    (relativePath: string) => {
      if (!relativePath) return
      const normalized = relativePath.replace(/\\/g, '/')
      const lastSlash = normalized.lastIndexOf('/')
      const folder = lastSlash > 0 ? normalized.slice(0, lastSlash) : ''
      const absolute = vaultPath ? buildFullPath(vaultPath, relativePath) : relativePath
      setCurrentFolder(folder)
      setSelectedFiles([absolute])
      setPendingScrollToFile(absolute)
      setActiveView('explorer')
    },
    [vaultPath, setCurrentFolder, setSelectedFiles, setPendingScrollToFile, setActiveView],
  )

  const openImageMenu = useCallback((event: React.MouseEvent, itemNumber: string) => {
    event.preventDefault()
    event.stopPropagation()
    setImageMenu({ x: event.clientX, y: event.clientY, itemNumber })
  }, [])

  const handleOpenEbom = useCallback(
    (row: ItemRow) => {
      const assembly = row.files
        .filter((f) => f.file_type === 'assembly')
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]
      setItemPanel({
        itemNumber: row.itemNumber,
        kind: 'ebom',
        fileId: assembly?.id ?? null,
        title: row.itemNumber,
      })
    },
    [setItemPanel],
  )

  const handleOpenMbom = useCallback(
    (row: ItemRow) => {
      setItemPanel({
        itemNumber: row.itemNumber,
        kind: 'mbom',
        fileId: null,
        title: row.itemNumber,
      })
    },
    [setItemPanel],
  )

  // Close any open item detail panel when leaving the Item Browser.
  useEffect(() => {
    return () => setItemPanel(null)
  }, [setItemPanel])

  // Close the image context menu on any outside click
  useEffect(() => {
    if (!imageMenu) return
    const close = () => setImageMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [imageMenu])

  const handleUsePreview = async (itemNumber: string) => {
    if (!organization?.id) return
    try {
      await resetItemImage(organization.id, itemNumber)
      setImagesByPart((prev) => {
        const next = new Map(prev)
        next.delete(itemNumber)
        return next
      })
    } catch {
      addToast('error', 'Failed to reset item image')
    }
  }

  const handleSaveIcon = async (iconName: string, iconColor: string | null) => {
    if (!organization?.id || !iconModalItem) return
    setSavingIcon(true)
    try {
      const image = await setItemIcon(organization.id, iconModalItem, iconName, iconColor)
      setImagesByPart((prev) => new Map(prev).set(iconModalItem, image))
      setIconModalItem(null)
    } catch {
      addToast('error', 'Failed to set icon')
    } finally {
      setSavingIcon(false)
    }
  }

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const target = uploadTargetRef.current
    event.target.value = ''
    uploadTargetRef.current = null
    if (!file || !target || !organization?.id) return
    try {
      const image = await uploadItemImage(organization.id, target, file)
      setImagesByPart((prev) => new Map(prev).set(target, image))
      addToast('success', 'Image uploaded')
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to upload image')
    }
  }

  const handleSaveDefinition = async (definition: ItemDefinitionSettings) => {
    if (!organization?.id) return
    setIsSaving(true)
    try {
      const { error } = await updateItemDefinitionSettings(organization.id, definition)
      if (error) {
        addToast('error', 'Failed to save item definition')
        return
      }
      setItemDefinition(definition)
      addToast('success', 'Item definition saved')
      setShowModal(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-plm-border shrink-0">
        <ShieldCheck size={16} className="text-plm-accent shrink-0" />
        <span className="text-sm font-medium text-plm-fg">{t('sidebar.items')}</span>
        <span className="text-xs text-plm-fg-muted">
          {rows.length} {rows.length === 1 ? 'item' : 'items'}
        </span>

        <div className="flex-1" />

        <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        <SizeSlider
          viewMode={viewMode}
          iconSize={iconSize}
          listRowSize={listRowSize}
          onIconSizeChange={setIconSize}
          onListRowSizeChange={setListRowSize}
        />

        <div className="relative ml-2">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-plm-fg-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items"
            className="w-56 pl-8 pr-3 py-1.5 text-sm bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
          />
        </div>

        {viewMode === 'list' && (
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            className={`p-1.5 rounded-md transition-colors ${
              showFilters
                ? 'bg-plm-accent/20 text-plm-accent'
                : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light'
            }`}
            title="Column filters"
          >
            <Filter size={16} />
          </button>
        )}

        <button
          onClick={loadConfig}
          className="p-1.5 rounded-md text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors disabled:opacity-50"
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={() => setShowModal(true)}
          className="p-1.5 rounded-md text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors"
          title="Item definition"
        >
          <Settings2 size={16} />
        </button>
      </div>

      {/* Content */}
      {viewMode === 'icons' ? (
        <ItemGrid
          rows={rows}
          search={search}
          iconSize={iconSize}
          imagesByPart={imagesByPart}
          onOpenImageMenu={openImageMenu}
        />
      ) : (
        <ItemTable
          rows={rows}
          columns={columns}
          onColumnsChange={setColumns}
          search={search}
          rowSize={listRowSize}
          showFilters={showFilters}
          imagesByPart={imagesByPart}
          designations={designations}
          canEditDesignation={canEditDesignation}
          onChangeDesignation={handleChangeDesignation}
          onOpenEbom={handleOpenEbom}
          onOpenMbom={handleOpenMbom}
          onOpenInExplorer={handleOpenInExplorer}
          onOpenImageMenu={openImageMenu}
        />
      )}

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadChange}
      />

      {imageMenu &&
        (() => {
          const row = rows.find((r) => r.itemNumber === imageMenu.itemNumber)
          const relativePath = row?.primaryFile?.relativePath
          return (
            <div
              className="context-menu"
              style={{ left: imageMenu.x, top: imageMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {relativePath && (
                <div
                  className="context-menu-item"
                  onClick={() => {
                    handleOpenInExplorer(relativePath)
                    setImageMenu(null)
                  }}
                >
                  <FolderOpen size={14} className="text-plm-accent" />
                  <span>Open in File Explorer</span>
                </div>
              )}
              <div className="px-3 py-1.5 text-xs text-plm-fg-muted uppercase tracking-wide border-b border-plm-border my-1">
                Image
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  handleUsePreview(imageMenu.itemNumber)
                  setImageMenu(null)
                }}
              >
                <ImageIcon size={14} />
                <span>Use SolidWorks Preview</span>
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  setIconModalItem(imageMenu.itemNumber)
                  setImageMenu(null)
                }}
              >
                <Shapes size={14} />
                <span>Choose Icon...</span>
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  uploadTargetRef.current = imageMenu.itemNumber
                  setImageMenu(null)
                  uploadInputRef.current?.click()
                }}
              >
                <Upload size={14} />
                <span>Upload Image...</span>
              </div>
            </div>
          )
        })()}

      {iconModalItem && (
        <ItemIconModal
          itemNumber={iconModalItem}
          initialIcon={imagesByPart.get(iconModalItem)?.iconName}
          initialColor={imagesByPart.get(iconModalItem)?.iconColor}
          onSave={handleSaveIcon}
          onClose={() => setIconModalItem(null)}
          isSaving={savingIcon}
        />
      )}

      {showModal && (
        <ItemDefinitionModal
          definition={itemDefinition}
          stages={stages}
          onSave={handleSaveDefinition}
          onClose={() => setShowModal(false)}
          isSaving={isSaving}
        />
      )}
    </div>
  )
}
