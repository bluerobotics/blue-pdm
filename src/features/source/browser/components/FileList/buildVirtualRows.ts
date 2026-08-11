import { resolvePartNumber, resolvedText } from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'
import type { ConfigBomItem, DrawingRefItem } from '@/stores/types'

import type { ConfigWithDepth } from '../../types'
import { findLocalFileByPath } from '../../utils/localFileLookup'
import type { ConfigSectionGroup, SelectableRow, VirtualRow } from './rowTypes'

const PART_EXTENSION = '.sldprt'
const ASSEMBLY_EXTENSION = '.sldasm'
const GROUP_ITEM_DEPTH = 1

interface ClipboardState {
  files: LocalFile[]
  operation: 'copy' | 'cut'
}

export interface BuildVirtualRowsOptions {
  displayFiles: LocalFile[]
  files: LocalFile[]
  isCreatingFolder: boolean
  selectedFiles: string[]
  clipboard: ClipboardState | null
  dragOverFolder: string | null
  userId: string | undefined
  isBeingProcessed: (path: string) => boolean
  expandedConfigFiles: ReadonlySet<string>
  fileConfigurations: ReadonlyMap<string, ConfigWithDepth[]>
  selectedConfigs: ReadonlySet<string>
  expandedConfigSections: ReadonlySet<string>
  expandedConfigDrawings: ReadonlySet<string>
  configDrawingData: ReadonlyMap<string, DrawingRefItem[]>
  loadingConfigDrawings: ReadonlySet<string>
  expandedConfigBoms: ReadonlySet<string>
  configBomData: ReadonlyMap<string, ConfigBomItem[]>
  loadingConfigBoms: ReadonlySet<string>
  expandedDrawingRefs: ReadonlySet<string>
  drawingRefData: ReadonlyMap<string, DrawingRefItem[]>
  expandedDrawingRefFiles: ReadonlySet<string>
}

function appendConfigDrawingRows(
  rows: VirtualRow[],
  selectableRows: SelectableRow[],
  files: LocalFile[],
  selectedFiles: string[],
  file: LocalFile,
  configName: string,
  configDepth: number,
  depth: number,
  items: DrawingRefItem[],
) {
  items.forEach((item) => {
    const drawingFile = findLocalFileByPath(item.file_path, files)
    const selectableIndex = drawingFile ? selectableRows.length : undefined

    rows.push({
      type: 'config-drawing',
      file,
      configName,
      configDepth,
      depth,
      item,
      drawingFile,
      selectableIndex,
      isSelected: drawingFile ? selectedFiles.includes(drawingFile.path) : false,
    })

    if (drawingFile) {
      selectableRows.push({
        path: drawingFile.path,
        file: drawingFile,
      })
    }
  })
}

function appendConfigBomRows(
  rows: VirtualRow[],
  file: LocalFile,
  configName: string,
  configDepth: number,
  items: ConfigBomItem[],
) {
  items.forEach((item) => {
    rows.push({
      type: 'config-bom',
      file,
      configName,
      configDepth,
      depth: GROUP_ITEM_DEPTH,
      item,
    })
  })
}

function appendConfigGroupRows(
  rows: VirtualRow[],
  file: LocalFile,
  configName: string,
  configDepth: number,
  group: ConfigSectionGroup,
  isExpanded: boolean,
  isLoading: boolean,
  items: ConfigBomItem[] | DrawingRefItem[],
) {
  rows.push({
    type: 'config-group',
    file,
    configName,
    configDepth,
    group,
    isExpanded,
    isLoading,
    count: items.length,
  })
}

export function buildVirtualRows({
  displayFiles,
  files,
  isCreatingFolder,
  selectedFiles,
  clipboard,
  dragOverFolder,
  userId,
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
}: BuildVirtualRowsOptions): { rows: VirtualRow[]; selectableRows: SelectableRow[] } {
  const rows: VirtualRow[] = []
  const selectableRows: SelectableRow[] = []

  if (isCreatingFolder) {
    rows.push({ type: 'new-folder' })
  }

  displayFiles.forEach((file, index) => {
    const diffClass =
      file.diffStatus === 'added'
        ? 'diff-added'
        : file.diffStatus === 'modified'
          ? 'diff-modified'
          : file.diffStatus === 'moved'
            ? 'diff-moved'
            : file.diffStatus === 'deleted'
              ? 'diff-deleted'
              : file.diffStatus === 'deleted_remote'
                ? 'diff-deleted-remote'
                : file.diffStatus === 'outdated'
                  ? 'diff-outdated'
                  : file.diffStatus === 'cloud'
                    ? 'diff-cloud'
                    : ''

    const isProcessing = isBeingProcessed(file.relativePath)
    const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath
    const isCut =
      clipboard?.operation === 'cut' &&
      clipboard.files.some((clipboardFile) => clipboardFile.path === file.path)
    const isEditable = !!file.pdmData?.id && file.pdmData?.checked_out_by === userId
    const basePartNumber = resolvedText(resolvePartNumber(file))

    rows.push({
      type: 'file',
      file,
      index,
      isSelected: selectedFiles.includes(file.path),
      isProcessing,
      diffClass,
      isDragTarget,
      isCut,
      isEditable,
      basePartNumber,
    })
    selectableRows.push({
      path: file.path,
      file,
    })

    if (expandedDrawingRefs.has(file.path)) {
      const refItems = drawingRefData.get(file.path) || []
      refItems.forEach((item) => {
        rows.push({
          type: 'drawing-ref',
          file,
          item,
        })

        const refFileKey = `${file.path}::${item.file_path}`
        if (
          item.configurations &&
          item.configurations.length > 0 &&
          expandedDrawingRefFiles.has(refFileKey)
        ) {
          item.configurations.forEach((configName) => {
            rows.push({
              type: 'drawing-ref-config',
              file,
              configName,
              parentItem: item,
            })
          })
        }
      })
    }

    if (!expandedConfigFiles.has(file.path)) return

    const configs = fileConfigurations.get(file.path) || []
    const configRevisions = (file.pdmData?.configuration_revisions || {}) as Record<string, string>
    const extension = file.extension?.toLowerCase()
    const isAssemblyFile = extension === ASSEMBLY_EXTENSION
    const isPartFile = extension === PART_EXTENSION
    const isConfigExpandable = isAssemblyFile || isPartFile

    configs.forEach((config) => {
      const configKey = `${file.path}::${config.name}`
      const isExpanded = expandedConfigSections.has(configKey)
      const isDrawingsExpanded = expandedConfigDrawings.has(configKey)
      const isDrawingsLoading = loadingConfigDrawings.has(configKey)
      const isBomExpanded = expandedConfigBoms.has(configKey)
      const isBomLoading = loadingConfigBoms.has(configKey)

      rows.push({
        type: 'config',
        file,
        config,
        isSelected: selectedConfigs.has(configKey),
        isEditable,
        basePartNumber,
        configRevision: configRevisions[config.name],
        isExpandable: isConfigExpandable,
        isExpanded,
        isLoading: isPartFile && isDrawingsLoading,
      })

      if (!isExpanded) return

      const drawingItems = configDrawingData.get(configKey) || []
      const bomItems = configBomData.get(configKey) || []
      const hasDrawingData = configDrawingData.has(configKey)
      const hasBomData = configBomData.has(configKey)

      if (isPartFile) {
        if (isDrawingsLoading) return
        if (!hasDrawingData) return

        if (drawingItems.length > 0) {
          appendConfigDrawingRows(
            rows,
            selectableRows,
            files,
            selectedFiles,
            file,
            config.name,
            config.depth,
            0,
            drawingItems,
          )
        } else {
          rows.push({
            type: 'config-empty',
            file,
            configName: config.name,
            configDepth: config.depth,
            kind: 'drawings',
          })
        }
        return
      }

      if (!isAssemblyFile) return

      appendConfigGroupRows(
        rows,
        file,
        config.name,
        config.depth,
        'drawings',
        isDrawingsExpanded,
        isDrawingsLoading,
        drawingItems,
      )
      appendConfigGroupRows(
        rows,
        file,
        config.name,
        config.depth,
        'ebom',
        isBomExpanded,
        isBomLoading,
        bomItems,
      )

      if (isDrawingsExpanded && !isDrawingsLoading && hasDrawingData) {
        if (drawingItems.length > 0) {
          appendConfigDrawingRows(
            rows,
            selectableRows,
            files,
            selectedFiles,
            file,
            config.name,
            config.depth,
            GROUP_ITEM_DEPTH,
            drawingItems,
          )
        } else {
          rows.push({
            type: 'config-empty',
            file,
            configName: config.name,
            configDepth: config.depth,
            kind: 'drawings',
          })
        }
      }

      if (isBomExpanded && !isBomLoading && hasBomData) {
        if (bomItems.length > 0) {
          appendConfigBomRows(rows, file, config.name, config.depth, bomItems)
        } else {
          rows.push({
            type: 'config-empty',
            file,
            configName: config.name,
            configDepth: config.depth,
            kind: 'ebom',
          })
        }
      }
    })
  })

  return { rows, selectableRows }
}
