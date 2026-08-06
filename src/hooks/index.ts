// Barrel export for all custom hooks
export { useTheme } from './useTheme'
export { useLanguage } from './useLanguage'
export { useRealtimeSubscriptions } from './useRealtimeSubscriptions'
export { useSessionHeartbeat } from './useSessionHeartbeat'
export { useBackupHeartbeat } from './useBackupHeartbeat'
export { useSolidWorksAutoStart } from './useSolidWorksAutoStart'
export { useAutoUpdater } from './useAutoUpdater'
export { useKeyboardShortcuts } from './useKeyboardShortcuts'

// New hooks extracted from App.tsx
export { useLoadFiles } from './useLoadFiles'
export { useAuth } from './useAuth'
export { useStagedCheckins } from './useStagedCheckins'
export { useAutoDownload } from './useAutoDownload'
export { useVaultManagement } from './useVaultManagement'
export { useIntegrationStatus } from './useIntegrationStatus'

// SolidWorks status management
export { useSolidWorksStatus } from './useSolidWorksStatus'
export type { SolidWorksServiceStatus, UseSolidWorksStatusReturn } from './useSolidWorksStatus'

// Shared file operation hooks
export { useClipboard } from './useClipboard'
export { useSelectionCategories } from './useSelectionCategories'
export { useDragDrop } from './useDragDrop'
export {
  useSelectionBox,
  type SelectionBox,
  type UseSelectionBoxOptions,
  type UseSelectionBoxReturn,
} from './useSelectionBox'

// App startup
export { useAppStartup } from './useAppStartup'

// Slow double-click for rename (Windows Explorer-style)
export {
  useSlowDoubleClick,
  SLOW_DOUBLE_CLICK_MIN_MS,
  SLOW_DOUBLE_CLICK_MAX_MS,
} from './useSlowDoubleClick'
export type { UseSlowDoubleClickOptions, UseSlowDoubleClickReturn } from './useSlowDoubleClick'

// Deep link handling
export { useDeepLinkInstall } from './useDeepLinkInstall'

// Auto-scroll during drag operations
export { useAutoScrollOnDrag } from './useAutoScrollOnDrag'
export type { AutoScrollOptions } from './useAutoScrollOnDrag'

// Admin-restricted modules
export { useDeniedModules } from './useDeniedModules'

// Admin-only folder visibility (cosmetic decluttering, not access control)
export { useHiddenFolders } from './useHiddenFolders'
export type { UseHiddenFoldersResult } from './useHiddenFolders'
