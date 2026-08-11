import type { LocalFile } from '@/stores/pdmStore'
import type { ConfigBomItem, DrawingRefItem } from '@/stores/types'

import type { ConfigWithDepth } from '../../types'

export interface FileVirtualRow {
  type: 'file'
  file: LocalFile
  index: number
  isSelected: boolean
  isProcessing: boolean
  diffClass: string
  isDragTarget: boolean
  isCut: boolean
  isEditable: boolean
  basePartNumber: string
}

export interface ConfigVirtualRow {
  type: 'config'
  file: LocalFile
  config: ConfigWithDepth
  isSelected: boolean
  isEditable: boolean
  basePartNumber: string
  configRevision?: string
  isExpandable: boolean
  isExpanded: boolean
  isLoading: boolean
}

export interface ConfigBomVirtualRow {
  type: 'config-bom'
  file: LocalFile
  configName: string
  configDepth: number
  depth: number
  item: ConfigBomItem
}

export interface DrawingRefVirtualRow {
  type: 'drawing-ref'
  file: LocalFile
  item: DrawingRefItem
}

export interface ConfigDrawingVirtualRow {
  type: 'config-drawing'
  file: LocalFile
  configName: string
  configDepth: number
  depth: number
  item: DrawingRefItem
  drawingFile?: LocalFile
  /** Visual selectable-row position; the same drawing path may appear more than once. */
  selectableIndex?: number
  isSelected: boolean
}

export interface SelectableRow {
  path: string
  file: LocalFile
}

export type ConfigSectionGroup = 'drawings' | 'ebom'

export interface ConfigGroupVirtualRow {
  type: 'config-group'
  file: LocalFile
  configName: string
  configDepth: number
  group: ConfigSectionGroup
  isExpanded: boolean
  isLoading: boolean
  count: number
}

export interface ConfigEmptyVirtualRow {
  type: 'config-empty'
  file: LocalFile
  configName: string
  configDepth: number
  kind: ConfigSectionGroup
}

export interface DrawingRefConfigVirtualRow {
  type: 'drawing-ref-config'
  file: LocalFile
  configName: string
  parentItem: DrawingRefItem
}

export interface NewFolderVirtualRow {
  type: 'new-folder'
}

export type VirtualRow =
  | FileVirtualRow
  | ConfigVirtualRow
  | ConfigBomVirtualRow
  | DrawingRefVirtualRow
  | ConfigDrawingVirtualRow
  | ConfigGroupVirtualRow
  | ConfigEmptyVirtualRow
  | DrawingRefConfigVirtualRow
  | NewFolderVirtualRow
