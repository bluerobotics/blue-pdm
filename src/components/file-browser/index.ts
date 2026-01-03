// FileBrowser components and hooks
// FileBrowser is still in the parent directory (components/FileBrowser.tsx)
// but imports these sub-components from this directory
export { FileBrowser } from '../FileBrowser'
export { FileIconCard } from './FileIconCard'
export { ListRowIcon } from './ListRowIcon'
export { ColumnHeaders } from './ColumnHeaders'

// Types
export type {
  FileBrowserProps,
  FileIconCardProps,
  ListRowIconProps,
  ColumnConfig,
  SelectionState,
  DragState,
  FolderMetrics,
  FolderMetricsMap,
  CheckoutUser,
  ConfigWithDepth,
  FileConflict,
  ConflictDialogState,
  ContextMenuState,
  ColumnContextMenuState,
  ConfigContextMenuState,
  CustomConfirmState,
  DeleteLocalCheckoutConfirmState,
  SelectionBox
} from './types'

export { COLUMN_TRANSLATION_KEYS } from './types'

// Constants
export {
  DEFAULT_ROW_HEIGHT,
  DEFAULT_ICON_SIZE,
  MIN_COLUMN_WIDTH,
  RESIZE_HANDLE_WIDTH,
  GRID_CARD_SIZE,
  ICON_SIZE_MIN,
  ICON_SIZE_MAX,
  LIST_ROW_SIZE_MIN,
  LIST_ROW_SIZE_MAX,
  SW_CONFIG_EXTENSIONS,
  SW_THUMBNAIL_EXTENSIONS
} from './constants'

// Hooks
export { useFileSelection } from './hooks/useFileSelection'
export { useFileDragDrop } from './hooks/useFileDragDrop'
export { useKeyboardNav } from './hooks/useKeyboardNav'
export { useColumnResize } from './hooks/useColumnResize'
export { useFolderMetrics } from './hooks/useFolderMetrics'
