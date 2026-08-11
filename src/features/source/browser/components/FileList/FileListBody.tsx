import React, {
  useMemo,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { FolderOpen } from 'lucide-react'
import { getCheckoutSignature } from '@/lib/checkout/checkoutDisplay'
import { isConfigurationWriteInFlight } from '@/lib/metadata/writeInFlight'
import { getTabValidationOptions } from '@/lib/tabValidation'
import { combineBaseAndTab } from '@/lib/serialization'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { ConfigBomItem, DrawingRefItem } from '@/stores/types'

import type { ConfigWithDepth } from '../../types'
import { useFilePaneContext, useFilePaneHandlers } from '../../context'
import { buildVirtualRows } from './buildVirtualRows'
import { ConfigBomRow } from './ConfigBomRow'
import { ConfigDrawingRow } from './ConfigDrawingRow'
import { ConfigEmptyRow } from './ConfigEmptyRow'
import { ConfigGroupRow } from './ConfigGroupRow'
import { ConfigRow } from './ConfigRow'
import { DrawingRefRow } from './DrawingRefRow'
import { FileRow } from './FileRow'
import type {
  ConfigBomVirtualRow,
  ConfigDrawingVirtualRow,
  ConfigEmptyVirtualRow,
  ConfigGroupVirtualRow,
  ConfigVirtualRow,
  DrawingRefConfigVirtualRow,
  DrawingRefVirtualRow,
  FileVirtualRow,
  SelectableRow,
} from './rowTypes'

// Slim props interface - state comes from context
export interface FileListBodyProps {
  // Sorted/filtered files to display (computed in parent)
  displayFiles: LocalFile[]

  // Computed values (not in context)
  visibleColumns: { id: string; width: number }[]

  // Drag state (from useDragState, not context)
  dragOverFolder: string | null

  // Processing state helper
  isBeingProcessed: (path: string) => boolean

  // New folder handler
  handleCreateFolder: () => void

  // Row event handlers
  onRowClick: (e: React.MouseEvent, file: LocalFile, index: number) => void
  onRowDoubleClick: (file: LocalFile) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
  onDragStart: (e: React.DragEvent, file: LocalFile) => void
  onDragEnd: () => void
  onFolderDragOver: (e: React.DragEvent, folder: LocalFile) => void
  onFolderDragLeave: (e: React.DragEvent) => void
  onDropOnFolder: (e: React.DragEvent, folder: LocalFile) => void

  // Config row event handlers
  onConfigRowClick: (
    e: React.MouseEvent,
    filePath: string,
    configName: string,
    configs: ConfigWithDepth[],
  ) => void
  onConfigContextMenu: (e: React.MouseEvent, filePath: string, configName: string) => void
  onConfigDescriptionChange: (filePath: string, configName: string, value: string) => void
  onConfigTabChange: (filePath: string, configName: string, value: string) => void
  onCommitConfigurationEdits: (
    file: LocalFile,
    configNames: string[],
  ) => void | Promise<void>
  onConfigSectionsToggle: (e: React.MouseEvent, file: LocalFile, configName: string) => void
  onConfigGroupToggle: (
    e: React.MouseEvent,
    file: LocalFile,
    configName: string,
    group: 'drawings' | 'ebom',
  ) => void

  // Config BOM row event handlers
  onConfigBomRowClick: (e: React.MouseEvent, file: LocalFile, item: ConfigBomItem) => void

  // Drawing reference row event handlers
  onDrawingRefRowClick: (e: React.MouseEvent, file: LocalFile, item: DrawingRefItem) => void
  onDrawingRefRowContextMenu: (e: React.MouseEvent, file: LocalFile, item: DrawingRefItem) => void
  onDrawingRefFileToggle: (e: React.MouseEvent, file: LocalFile, item: DrawingRefItem) => void
  onConfigDrawingRowClick: (
    e: React.MouseEvent,
    file: LocalFile,
    item: DrawingRefItem,
    selectableIndex?: number,
  ) => void
  onConfigDrawingRowContextMenu: (
    e: React.MouseEvent,
    file: LocalFile,
    item: DrawingRefItem,
  ) => void
  onConfigDrawingFileContextMenu: (e: React.MouseEvent, file: LocalFile) => void

  // Ordered rows used by file selection and keyboard navigation
  onSelectableRowsChange: (rows: SelectableRow[]) => void

  // Cell rendering
  renderCellContent: (file: LocalFile, columnId: string) => React.ReactNode
}

// ============================================================================
// Component
// ============================================================================

export const FileListBody = forwardRef<HTMLTableSectionElement, FileListBodyProps>(
  function FileListBody(
    {
      displayFiles,
      visibleColumns,
      dragOverFolder,
      isBeingProcessed,
      handleCreateFolder,
      onRowClick,
      onRowDoubleClick,
      onContextMenu,
      onDragStart,
      onDragEnd,
      onFolderDragOver,
      onFolderDragLeave,
      onDropOnFolder,
      onConfigRowClick,
      onConfigContextMenu,
      onConfigDescriptionChange,
      onConfigTabChange,
      onCommitConfigurationEdits,
      onConfigSectionsToggle,
      onConfigGroupToggle,
      onConfigBomRowClick,
      onDrawingRefRowClick,
      onDrawingRefRowContextMenu,
      onDrawingRefFileToggle,
      onConfigDrawingRowClick,
      onConfigDrawingRowContextMenu,
      onConfigDrawingFileContextMenu,
      onSelectableRowsChange,
      renderCellContent,
    },
    ref,
  ) {
    // Get state from context
    const {
      files,
      selectedFiles,
      clipboard,
      listRowSize,
      user,
      expandedConfigFiles,
      fileConfigurations,
      selectedConfigs,
      expandedConfigSections,
      expandedConfigBoms,
      configBomData,
      loadingConfigBoms,
      expandedDrawingRefs,
      drawingRefData,
      expandedDrawingRefFiles,
      expandedConfigDrawings,
      configDrawingData,
      loadingConfigDrawings,
      isCreatingFolder,
      newFolderName,
      newFolderInputRef,
      setNewFolderName,
      setIsCreatingFolder,
      tableRef,
      pendingScrollToFile,
    } = useFilePaneContext()
    const { savingConfigsToSW } = useFilePaneHandlers()
    const checkoutHydration = usePDMStore((s) => s.checkoutHydration)

    // Get tab settings from organization serialization settings
    const serializationSettings = usePDMStore((s) => s.organization?.serialization_settings)
    const tabValidationOptions = getTabValidationOptions(serializationSettings)
    const tabEnabled = !!serializationSettings?.tab_enabled

    // Action to clear the pending scroll target after scrolling
    const setPendingScrollToFile = usePDMStore((s) => s.setPendingScrollToFile)

    // Local ref for the tbody element
    const tbodyRef = useRef<HTMLTableSectionElement>(null)

    // Expose tbody ref to parent if needed
    useImperativeHandle(ref, () => tbodyRef.current!, [])

    // Row heights
    const fileRowHeight = listRowSize + 8
    const configRowHeight = listRowSize + 4
    const configBomRowHeight = listRowSize // Slightly smaller for BOM items
    const newFolderRowHeight = 40 // Fixed height for new folder input

    // ============================================================================
    // Build virtual rows array
    // ============================================================================

    const { rows: virtualRows, selectableRows } = useMemo(
      () =>
        buildVirtualRows({
          displayFiles,
          files,
          isCreatingFolder,
          selectedFiles,
          clipboard,
          dragOverFolder,
          userId: user?.id,
          isBeingProcessed,
          expandedConfigFiles,
          fileConfigurations,
          selectedConfigs,
          expandedConfigSections,
          expandedConfigDrawings,
          configDrawingData,
          loadingConfigDrawings,
          expandedConfigBoms,
          configBomData,
          loadingConfigBoms,
          expandedDrawingRefs,
          drawingRefData,
          expandedDrawingRefFiles,
        }),
      [
        displayFiles,
        files,
        isCreatingFolder,
        selectedFiles,
        clipboard,
        dragOverFolder,
        user?.id,
        isBeingProcessed,
        expandedConfigFiles,
        fileConfigurations,
        selectedConfigs,
        expandedConfigSections,
        expandedConfigDrawings,
        configDrawingData,
        loadingConfigDrawings,
        expandedConfigBoms,
        configBomData,
        loadingConfigBoms,
        expandedDrawingRefs,
        drawingRefData,
        expandedDrawingRefFiles,
      ],
    )

    useEffect(() => {
      onSelectableRowsChange(selectableRows)
    }, [onSelectableRowsChange, selectableRows])

    // ============================================================================
    // Virtualizer setup
    // ============================================================================

    const getRowHeight = useCallback(
      (index: number): number => {
        const row = virtualRows[index]
        if (!row) return fileRowHeight

        switch (row.type) {
          case 'new-folder':
            return newFolderRowHeight
          case 'config':
            return configRowHeight
          case 'config-group':
          case 'config-empty':
          case 'config-bom':
            return configBomRowHeight
          case 'drawing-ref':
            return configBomRowHeight
          case 'config-drawing':
            return configBomRowHeight
          case 'drawing-ref-config':
            return configBomRowHeight
          case 'file':
          default:
            return fileRowHeight
        }
      },
      [virtualRows, fileRowHeight, configRowHeight, configBomRowHeight, newFolderRowHeight],
    )

    const virtualizer = useVirtualizer({
      count: virtualRows.length,
      getScrollElement: () => tableRef.current,
      estimateSize: getRowHeight,
      overscan: 10,
    })

    const virtualItems = virtualizer.getVirtualItems()

    // Scroll to a pending file target after navigation (e.g., clicking a drawing ref row)
    useEffect(() => {
      if (!pendingScrollToFile) return
      const idx = virtualRows.findIndex(
        (r) => r.type === 'file' && r.file.path === pendingScrollToFile,
      )
      if (idx >= 0) {
        // Use requestAnimationFrame to ensure the virtualizer has measured the new rows
        requestAnimationFrame(() => {
          virtualizer.scrollToIndex(idx, { align: 'center' })
        })
      }
      setPendingScrollToFile(null)
    }, [pendingScrollToFile, virtualRows, virtualizer, setPendingScrollToFile])

    // Calculate padding for spacer rows to maintain scroll position
    // This technique renders only visible rows with spacer rows above/below
    const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
    const paddingBottom =
      virtualItems.length > 0
        ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
        : 0

    // ============================================================================
    // Row renderers
    // ============================================================================

    const renderNewFolderRow = useCallback(
      () => (
        <tr className="new-folder-row" style={{ height: newFolderRowHeight }}>
          <td colSpan={visibleColumns.length}>
            <div className="flex items-center gap-2 py-1">
              <FolderOpen size={16} className="text-plm-accent" />
              <input
                ref={newFolderInputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder()
                  } else if (e.key === 'Escape') {
                    setIsCreatingFolder(false)
                    setNewFolderName('')
                  }
                }}
                onBlur={handleCreateFolder}
                className="bg-plm-bg border border-plm-accent rounded px-2 py-1 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
                placeholder="Folder name"
              />
            </div>
          </td>
        </tr>
      ),
      [
        visibleColumns.length,
        newFolderName,
        newFolderRowHeight,
        handleCreateFolder,
        setNewFolderName,
        setIsCreatingFolder,
        newFolderInputRef,
      ],
    )

    const renderFileRow = useCallback(
      (row: FileVirtualRow) => {
        const { file, index, isSelected, isProcessing, diffClass, isDragTarget, isCut } = row

        return (
          <FileRow
            key={file.path}
            file={file}
            index={index}
            isSelected={isSelected}
            isProcessing={isProcessing}
            diffClass={diffClass}
            isDragTarget={isDragTarget}
            isCut={isCut}
            rowHeight={fileRowHeight}
            visibleColumns={visibleColumns}
            checkoutSignature={getCheckoutSignature(
              file,
              user,
              file.pdmData?.id ? checkoutHydration[file.pdmData.id]?.state : undefined,
            )}
            draggable={file.diffStatus !== 'cloud'}
            onClick={(e) => onRowClick(e, file, index)}
            onDoubleClick={() => onRowDoubleClick(file)}
            onContextMenu={(e) => onContextMenu(e, file)}
            onDragStart={(e) => onDragStart(e, file)}
            onDragEnd={onDragEnd}
            onDragOver={file.isDirectory ? (e) => onFolderDragOver(e, file) : undefined}
            onDragLeave={file.isDirectory ? onFolderDragLeave : undefined}
            onDrop={file.isDirectory ? (e) => onDropOnFolder(e, file) : undefined}
            renderCell={renderCellContent}
          />
        )
      },
      [
        fileRowHeight,
        visibleColumns,
        onRowClick,
        onRowDoubleClick,
        onContextMenu,
        onDragStart,
        onDragEnd,
        onFolderDragOver,
        onFolderDragLeave,
        onDropOnFolder,
        renderCellContent,
        user,
        checkoutHydration,
      ],
    )

    const renderConfigRow = useCallback(
      (row: ConfigVirtualRow) => {
        const {
          file,
          config,
          isSelected,
          isEditable,
          basePartNumber,
          configRevision,
          isExpandable,
          isExpanded,
          isLoading,
        } = row
        const configs = fileConfigurations.get(file.path) || []

        return (
          <ConfigRow
            key={`${file.path}::config::${config.name}`}
            file={file}
            config={config}
            isSelected={isSelected}
            isEditable={isEditable}
            rowHeight={configRowHeight}
            visibleColumns={visibleColumns}
            basePartNumber={basePartNumber}
            configRevision={configRevision}
            isExpandable={isExpandable}
            isExpanded={isExpanded}
            isLoading={isLoading}
            tabEnabled={tabEnabled}
            tabValidationOptions={tabValidationOptions}
            isWriting={isConfigurationWriteInFlight(savingConfigsToSW, file.path, config.name)}
            onCommitConfigurationEdits={onCommitConfigurationEdits}
            onClick={(e) => onConfigRowClick(e, file.path, config.name, configs)}
            onContextMenu={(e) => onConfigContextMenu(e, file.path, config.name)}
            onDescriptionChange={(value) =>
              onConfigDescriptionChange(file.path, config.name, value)
            }
            onTabChange={(value) => onConfigTabChange(file.path, config.name, value)}
            onToggleSections={(e) => onConfigSectionsToggle(e, file, config.name)}
          />
        )
      },
      [
        configRowHeight,
        visibleColumns,
        fileConfigurations,
        tabEnabled,
        tabValidationOptions,
        savingConfigsToSW,
        onConfigRowClick,
        onConfigContextMenu,
        onConfigDescriptionChange,
        onConfigTabChange,
        onCommitConfigurationEdits,
        onConfigSectionsToggle,
      ],
    )

    const renderConfigGroupRow = useCallback(
      (row: ConfigGroupVirtualRow) => (
        <ConfigGroupRow
          key={`${row.file.path}::config-group::${row.configName}::${row.group}`}
          group={row.group}
          configDepth={row.configDepth}
          isExpanded={row.isExpanded}
          isLoading={row.isLoading}
          count={row.count}
          rowHeight={configBomRowHeight}
          visibleColumns={visibleColumns}
          onToggle={(e) => onConfigGroupToggle(e, row.file, row.configName, row.group)}
        />
      ),
      [configBomRowHeight, visibleColumns, onConfigGroupToggle],
    )

    const renderConfigEmptyRow = useCallback(
      (row: ConfigEmptyVirtualRow) => (
        <ConfigEmptyRow
          key={`${row.file.path}::config-empty::${row.configName}::${row.kind}`}
          kind={row.kind}
          configDepth={row.configDepth}
          rowHeight={configBomRowHeight}
          visibleColumns={visibleColumns}
        />
      ),
      [configBomRowHeight, visibleColumns],
    )

    const renderConfigBomRow = useCallback(
      (row: ConfigBomVirtualRow) => {
        const { file, configDepth, depth, item } = row

        return (
          <ConfigBomRow
            key={`${file.path}::bom::${row.configName}::${item.id}`}
            item={item}
            depth={depth}
            configDepth={configDepth}
            rowHeight={configBomRowHeight}
            visibleColumns={visibleColumns}
            onClick={(e) => onConfigBomRowClick(e, file, item)}
          />
        )
      },
      [configBomRowHeight, visibleColumns, onConfigBomRowClick],
    )

    const renderDrawingRefRow = useCallback(
      (row: DrawingRefVirtualRow) => {
        const { file, item } = row
        const refFileKey = `${file.path}::${item.file_path}`
        const isRefExpanded = expandedDrawingRefFiles.has(refFileKey)

        return (
          <DrawingRefRow
            key={`${file.path}::drawing-ref::${item.id}`}
            item={item}
            depth={0}
            rowHeight={configBomRowHeight}
            visibleColumns={visibleColumns}
            isExpanded={isRefExpanded}
            onClick={(e) => onDrawingRefRowClick(e, file, item)}
            onContextMenu={(e) => onDrawingRefRowContextMenu(e, file, item)}
            onToggleExpand={(e) => onDrawingRefFileToggle(e, file, item)}
          />
        )
      },
      [
        configBomRowHeight,
        visibleColumns,
        expandedDrawingRefFiles,
        onDrawingRefRowClick,
        onDrawingRefRowContextMenu,
        onDrawingRefFileToggle,
      ],
    )

    const renderConfigDrawingRow = useCallback(
      (row: ConfigDrawingVirtualRow) => {
        const { file, configDepth, depth, item, drawingFile, selectableIndex, isSelected } = row

        return (
          <ConfigDrawingRow
            key={`${file.path}::config-drawing::${row.configName}::${item.id}`}
            item={item}
            depth={depth}
            configDepth={configDepth}
            rowHeight={configBomRowHeight}
            visibleColumns={visibleColumns}
            drawingFile={drawingFile}
            selectableIndex={selectableIndex}
            isSelected={isSelected}
            onClick={(e) =>
              onConfigDrawingRowClick(e, drawingFile ?? file, item, selectableIndex)
            }
            onContextMenu={(e) =>
              drawingFile
                ? onConfigDrawingFileContextMenu(e, drawingFile)
                : onConfigDrawingRowContextMenu(e, file, item)
            }
          />
        )
      },
      [
        configBomRowHeight,
        visibleColumns,
        onConfigDrawingRowClick,
        onConfigDrawingRowContextMenu,
        onConfigDrawingFileContextMenu,
      ],
    )

    const renderDrawingRefConfigRow = useCallback(
      (row: DrawingRefConfigVirtualRow) => {
        const { file, configName, parentItem } = row
        // Indent: base (24) + depth 0 (0) + under-file offset (16) + under-ref offset (24)
        const indentPx = 24 + 16 + 24

        // Per-config metadata from the referenced file
        const tabNumber = parentItem.config_tabs?.[configName]
        const configDescription = parentItem.config_descriptions?.[configName] || null
        const configRevision = parentItem.configuration_revisions?.[configName] || null

        // Build full item number: base part number + tab number (if tabs enabled)
        const basePN = parentItem.part_number || ''
        const fullItemNumber = basePN
          ? tabNumber && serializationSettings
            ? combineBaseAndTab(basePN, tabNumber, serializationSettings)
            : basePN
          : null

        return (
          <tr
            key={`${file.path}::drawing-ref-config::${parentItem.file_path}::${configName}`}
            className="drawing-ref-config-row hover:bg-plm-bg-light/50"
            style={{ height: configBomRowHeight }}
          >
            {visibleColumns.map((column) => (
              <td key={column.id} style={{ width: column.width }}>
                {column.id === 'name' ? (
                  <div
                    className="flex items-center gap-1.5"
                    style={{
                      minHeight: configBomRowHeight - 8,
                      paddingLeft: `${indentPx}px`,
                    }}
                  >
                    <span className="text-plm-fg-dim text-[10px]">├</span>
                    <span className="text-amber-400/70 text-[10px]">◆</span>
                    <span className="truncate text-[10px] text-plm-fg-muted">{configName}</span>
                  </div>
                ) : column.id === 'itemNumber' ? (
                  fullItemNumber ? (
                    <span className="text-[10px] text-plm-fg-dim font-mono">{fullItemNumber}</span>
                  ) : (
                    <span className="text-plm-fg-dim/50 text-[10px]">—</span>
                  )
                ) : column.id === 'description' ? (
                  configDescription ? (
                    <span className="text-[10px] text-plm-fg-dim truncate">
                      {configDescription}
                    </span>
                  ) : (
                    <span className="text-plm-fg-dim/50 text-[10px]">—</span>
                  )
                ) : column.id === 'revision' ? (
                  configRevision ? (
                    <span className="text-[10px] text-plm-fg-dim">{configRevision}</span>
                  ) : (
                    <span className="text-plm-fg-dim/50 text-[10px]">—</span>
                  )
                ) : column.id === 'state' ? (
                  parentItem.state ? (
                    <span className="text-[10px] text-plm-fg-dim">{parentItem.state}</span>
                  ) : (
                    <span className="text-plm-fg-dim/50 text-[10px]">—</span>
                  )
                ) : (
                  <span className="text-plm-fg-dim/50 text-[10px]">—</span>
                )}
              </td>
            ))}
          </tr>
        )
      },
      [configBomRowHeight, visibleColumns, serializationSettings],
    )

    // ============================================================================
    // Render
    // ============================================================================

    // If no rows, render empty tbody to maintain table structure
    if (virtualRows.length === 0) {
      return <tbody ref={tbodyRef} />
    }

    return (
      <tbody ref={tbodyRef}>
        {/* Top spacer row for virtual scroll positioning */}
        {paddingTop > 0 && (
          <tr aria-hidden="true" style={{ height: paddingTop }}>
            <td colSpan={visibleColumns.length} style={{ padding: 0, border: 0 }} />
          </tr>
        )}

        {/* Render only visible virtual rows */}
        {virtualItems.map((virtualRow: VirtualItem) => {
          const row = virtualRows[virtualRow.index]
          if (!row) return null

          switch (row.type) {
            case 'new-folder':
              return <React.Fragment key="__new-folder__">{renderNewFolderRow()}</React.Fragment>
            case 'file':
              return (
                <React.Fragment key={`file::${row.file.path}`}>{renderFileRow(row)}</React.Fragment>
              )
            case 'config':
              return (
                <React.Fragment key={`config::${row.file.path}::${row.config.name}`}>
                  {renderConfigRow(row)}
                </React.Fragment>
              )
            case 'config-group':
              return (
                <React.Fragment
                  key={`config-group::${row.file.path}::${row.configName}::${row.group}`}
                >
                  {renderConfigGroupRow(row)}
                </React.Fragment>
              )
            case 'config-empty':
              return (
                <React.Fragment
                  key={`config-empty::${row.file.path}::${row.configName}::${row.kind}`}
                >
                  {renderConfigEmptyRow(row)}
                </React.Fragment>
              )
            case 'config-bom':
              return (
                <React.Fragment
                  key={`config-bom::${row.file.path}::${row.configName}::${row.item.id}`}
                >
                  {renderConfigBomRow(row)}
                </React.Fragment>
              )
            case 'drawing-ref':
              return (
                <React.Fragment key={`drawing-ref::${row.file.path}::${row.item.id}`}>
                  {renderDrawingRefRow(row)}
                </React.Fragment>
              )
            case 'config-drawing':
              return (
                <React.Fragment
                  key={`config-drawing::${row.file.path}::${row.configName}::${row.item.id}`}
                >
                  {renderConfigDrawingRow(row)}
                </React.Fragment>
              )
            case 'drawing-ref-config':
              return (
                <React.Fragment
                  key={`drawing-ref-config::${row.file.path}::${row.parentItem.file_path}::${row.configName}`}
                >
                  {renderDrawingRefConfigRow(row)}
                </React.Fragment>
              )
            default:
              return null
          }
        })}

        {/* Bottom spacer row for virtual scroll positioning */}
        {paddingBottom > 0 && (
          <tr aria-hidden="true" style={{ height: paddingBottom }}>
            <td colSpan={visibleColumns.length} style={{ padding: 0, border: 0 }} />
          </tr>
        )}
      </tbody>
    )
  },
)
