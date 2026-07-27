// Shared smart components - barrel export
// Each component has its own folder with index.ts for cleaner imports

// Avatar components
export { Avatar, AvatarWithStatus } from './Avatar'
export { AvatarGroup } from './Avatar'

// Pickers
export {
  ColorPicker,
  ColorPickerDropdown,
  ColorSwatchRow,
  DEFAULT_PRESET_COLORS,
} from './ColorPicker'
export { IconPicker, IconGridPicker, ICON_LIBRARY, ICON_CATEGORIES, ICONS } from './IconPicker'

// Tab/Panel components
export { DraggableTab, TabDropZone } from './DraggableTab'
export type { DraggableTabProps, TabDropZoneProps, PanelLocation } from './DraggableTab'

// File browser components
export {
  FileIcon,
  FileTypeIcon,
  FileItemIcon,
  StatusIcon,
  CheckoutAvatars,
  getFolderCheckoutStatus,
  isFolderSynced,
  getFolderIconColor,
  getFolderCheckoutUsers,
  getFileCheckoutUser,
  getCloudFilesCount,
  getCloudNewFilesCount,
  getLocalOnlyFilesCount,
  getSyncedCheckoutableCount,
  getMyCheckedOutCount,
  getTotalCheckoutCount,
} from './FileItem'
export type {
  FileIconProps,
  FileTypeIconProps,
  FileItemIconProps,
  StatusIconProps,
  CheckoutAvatarsProps,
  CheckoutUser,
  FolderCheckoutStatus,
} from './FileItem'

// Status & Info components
export { OnlineUsersIndicator } from './OnlineUsers'
export { SolidWorksStatusIndicator } from './SolidWorksStatusIndicator'
export { ImpersonationBanner } from './ImpersonationBanner'
export { LanguageSelector } from './LanguageSelector'

// Context Menu - now in feature module
// Import from '@/features/source/context-menu' instead

// Dialogs
export * from './Dialogs'

// Screens
export * from './Screens'

// Inline Actions
export * from './InlineActions'
