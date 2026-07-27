import { StateCreator } from 'zustand'

import type { PDMStoreState, ItemBrowserSlice, ColumnConfig } from '../types'
import { DEFAULT_ITEM_DEFINITION } from '../../types/item'

// Default column config for the Item Browser list view (order = display order)
export const DEFAULT_ITEM_COLUMNS: ColumnConfig[] = [
  { id: 'itemNumber', label: 'Item Number', width: 60, visible: true, sortable: true },
  { id: 'description', label: 'Description', width: 196, visible: true, sortable: true },
  { id: 'revision', label: 'Rev', width: 48, visible: true, sortable: true },
  { id: 'designation', label: 'Designation', width: 120, visible: true, sortable: true },
  { id: 'stage', label: 'Stage', width: 150, visible: true, sortable: true },
  { id: 'types', label: 'File Types', width: 150, visible: true, sortable: false },
  { id: 'fileCount', label: 'Files', width: 70, visible: true, sortable: true },
  { id: 'lastModified', label: 'Modified', width: 130, visible: true, sortable: true },
]

export const createItemBrowserSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  ItemBrowserSlice
> = (set) => ({
  // State
  itemDefinition: { ...DEFAULT_ITEM_DEFINITION },
  itemDefinitionLoaded: false,
  itemViewMode: 'list',
  itemListRowSize: 32,
  itemIconSize: 120,
  itemColumns: DEFAULT_ITEM_COLUMNS.map((c) => ({ ...c })),
  itemPanel: null,

  // Actions
  setItemDefinition: (itemDefinition) => set({ itemDefinition }),
  setItemDefinitionLoaded: (itemDefinitionLoaded) => set({ itemDefinitionLoaded }),
  setItemViewMode: (itemViewMode) => set({ itemViewMode }),
  setItemListRowSize: (size) => set({ itemListRowSize: Math.max(16, Math.min(64, size)) }),
  setItemIconSize: (size) => set({ itemIconSize: Math.max(48, Math.min(256, size)) }),
  setItemColumns: (itemColumns) => set({ itemColumns }),
  setItemPanel: (itemPanel) => set({ itemPanel }),
})
