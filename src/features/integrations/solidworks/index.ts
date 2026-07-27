export {
  useSolidWorksService,
  WhereUsedTab,
  SWPropertiesPanel,
  SWPropertiesTab,
  SWDatacardTab,
  SWExportActions,
} from './SolidWorksPanel'
export { SWDatacardPanel } from './SWDatacardPanel'
export { InspectionTab } from './inspection/InspectionTab'
export {
  BomTree,
  convertLegacyBomToBomNodes,
  type BomNode,
  type BomTreeProps,
  type LegacyBomItem,
} from './BomTree'

// SOLIDWORKS file creation (for context menus)
export { SolidWorksContextMenuItems, type SolidWorksContextMenuItemsProps } from './components'
export {
  useSolidWorksFileCreation,
  type UseSolidWorksFileCreationReturn,
  type AvailableTemplates,
  type TemplateFile,
  type SolidWorksFileType,
} from './hooks'
