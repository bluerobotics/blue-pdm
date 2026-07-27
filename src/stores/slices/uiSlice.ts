import { StateCreator } from 'zustand'
import type { PDMStoreState, UISlice, SidebarView, DetailsPanelTab, SettingsTab } from '../types'
import type { Clipboard } from '@/lib/fileOperations/types'
import { getChildModules, getDefaultModuleConfig } from '@/types/modules'

export const createUISlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  UISlice
> = (set, get) => ({
  // Initial state - Layout
  sidebarVisible: true,
  sidebarWidth: 380,
  activityBarMode: 'hover',
  activeView: 'explorer',
  detailsPanelVisible: true,
  detailsPanelHeight: 250,
  detailsPanelTab: 'preview',

  // Initial state - Right Panel
  rightPanelVisible: false,
  rightPanelWidth: 350,
  rightPanelTab: null,
  rightPanelTabs: [],
  bottomPanelTabOrder: [],

  // Initial state - Settings navigation
  settingsTab: 'profile' as SettingsTab,

  // Initial state - Google Drive
  gdriveCurrentFolderId: null,
  gdriveCurrentFolderName: null,
  gdriveDriveId: null,
  gdriveIsSharedDrive: false,
  gdriveOpenDocument: null,
  gdriveAuthVersion: 0,

  // Initial state - Terminal
  terminalVisible: false,
  terminalHeight: 250,
  terminalHistory: [],

  // Initial state - Deep Link
  pendingDeepLinkInstall: null,

  // Initial state - Clipboard (unified across FilePane and FileTree)
  clipboard: null,

  // Initial state - Command confirmation dialog
  pendingCommandConfirm: null,

  // Initial state - Review preview
  reviewPreviewFile: null,

  // Actions - Clipboard
  setClipboard: (clipboard: Clipboard | null) => set({ clipboard }),
  clearClipboard: () => set({ clipboard: null }),

  // Actions - Sidebar
  toggleSidebar: () => {
    const { sidebarVisible, tabsEnabled, activeTabId, tabs } = get()
    const newVisible = !sidebarVisible
    set({ sidebarVisible: newVisible })
    // Sync with active tab if tabs enabled
    if (tabsEnabled && activeTabId) {
      set({
        tabs: tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, panelState: { ...t.panelState, sidebarVisible: newVisible } }
            : t,
        ),
      })
    }
  },

  setSidebarWidth: (width: number) => set({ sidebarWidth: Math.max(200, Math.min(900, width)) }),

  setActivityBarMode: (mode) => set({ activityBarMode: mode }),

  setActiveView: (activeView: SidebarView) => {
    let resolvedView = activeView
    if ((resolvedView as string).startsWith('group-')) {
      const children = getChildModules(resolvedView as string, getDefaultModuleConfig())
      resolvedView = (children[0]?.id ?? 'explorer') as SidebarView
    }
    const prev = get().activeView
    const patch: Partial<PDMStoreState> = { activeView: resolvedView, sidebarVisible: true }
    if (prev === 'reviews' && resolvedView !== 'reviews') {
      patch.reviewPreviewFile = null
    }
    set(patch)
  },

  // Actions - Google Drive
  setGdriveNavigation: (folderId, folderName, isSharedDrive, driveId) =>
    set({
      gdriveCurrentFolderId: folderId,
      gdriveCurrentFolderName: folderName || null,
      gdriveIsSharedDrive: isSharedDrive || false,
      gdriveDriveId: driveId || null,
    }),

  setGdriveOpenDocument: (doc) => set({ gdriveOpenDocument: doc }),

  incrementGdriveAuthVersion: () => set((s) => ({ gdriveAuthVersion: s.gdriveAuthVersion + 1 })),

  // Actions - Details Panel
  toggleDetailsPanel: () => {
    const { detailsPanelVisible, tabsEnabled, activeTabId, tabs } = get()
    const newVisible = !detailsPanelVisible
    set({ detailsPanelVisible: newVisible })
    // Sync with active tab if tabs enabled
    if (tabsEnabled && activeTabId) {
      set({
        tabs: tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, panelState: { ...t.panelState, detailsPanelVisible: newVisible } }
            : t,
        ),
      })
    }
  },

  setDetailsPanelHeight: (height: number) =>
    set({ detailsPanelHeight: Math.max(100, Math.min(1200, height)) }),

  setDetailsPanelTab: (detailsPanelTab: DetailsPanelTab) => set({ detailsPanelTab }),

  // Actions - Right Panel
  toggleRightPanel: () => {
    const { rightPanelVisible, tabsEnabled, activeTabId, tabs } = get()
    const newVisible = !rightPanelVisible
    set({ rightPanelVisible: newVisible })
    // Sync with active tab if tabs enabled
    if (tabsEnabled && activeTabId) {
      set({
        tabs: tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, panelState: { ...t.panelState, rightPanelVisible: newVisible } }
            : t,
        ),
      })
    }
  },

  setRightPanelWidth: (width: number) =>
    set({ rightPanelWidth: Math.max(200, Math.min(1200, width)) }),

  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),

  moveTabToRight: (tab: DetailsPanelTab) => {
    const { rightPanelTabs, detailsPanelTab } = get()
    // Add tab to right panel if not already there
    if (!rightPanelTabs.includes(tab)) {
      set({
        rightPanelTabs: [...rightPanelTabs, tab],
        rightPanelTab: tab,
        rightPanelVisible: true,
        // If we moved the active bottom tab, switch to another
        detailsPanelTab: detailsPanelTab === tab ? 'properties' : detailsPanelTab,
      })
    }
  },

  moveTabToBottom: (tab: DetailsPanelTab) => {
    const { rightPanelTabs, rightPanelTab } = get()
    const newTabs = rightPanelTabs.filter((t) => t !== tab)
    set({
      rightPanelTabs: newTabs,
      rightPanelTab:
        newTabs.length > 0 ? (rightPanelTab === tab ? newTabs[0] : rightPanelTab) : null,
      rightPanelVisible: newTabs.length > 0,
      detailsPanelTab: tab,
    })
  },

  reorderTabsInPanel: (panel, tabId, newIndex) => {
    if (panel === 'right') {
      const { rightPanelTabs } = get()
      const currentIndex = rightPanelTabs.indexOf(tabId)
      if (currentIndex === -1 || currentIndex === newIndex) return

      const newTabs = [...rightPanelTabs]
      newTabs.splice(currentIndex, 1)
      newTabs.splice(newIndex, 0, tabId)
      set({ rightPanelTabs: newTabs })
    } else {
      // For bottom panel, we need to track custom order
      const { bottomPanelTabOrder } = get()
      // Default order if no custom order set
      const defaultOrder: DetailsPanelTab[] = [
        'preview',
        'properties',
        'whereused',
        'vendors',
        'inspection',
      ]
      const currentOrder = bottomPanelTabOrder.length > 0 ? bottomPanelTabOrder : defaultOrder

      const currentIndex = currentOrder.indexOf(tabId)
      if (currentIndex === -1) {
        // Tab not in order, add it at new index
        const newOrder = [...currentOrder]
        newOrder.splice(newIndex, 0, tabId)
        set({ bottomPanelTabOrder: newOrder })
      } else if (currentIndex !== newIndex) {
        const newOrder = [...currentOrder]
        newOrder.splice(currentIndex, 1)
        newOrder.splice(newIndex, 0, tabId)
        set({ bottomPanelTabOrder: newOrder })
      }
    }
  },

  // Actions - Terminal
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),

  setTerminalHeight: (height: number) =>
    set({ terminalHeight: Math.max(150, Math.min(600, height)) }),

  addTerminalHistory: (command: string) =>
    set((s) => {
      // Don't add duplicate consecutive commands
      if (s.terminalHistory[0] === command) return s
      // Keep last 100 commands
      return { terminalHistory: [command, ...s.terminalHistory.slice(0, 99)] }
    }),

  // Actions - Settings navigation
  setSettingsTab: (tab: SettingsTab) => set({ settingsTab: tab }),

  // Actions - Deep Link
  setPendingDeepLinkInstall: (data) => set({ pendingDeepLinkInstall: data }),
  clearPendingDeepLinkInstall: () => set({ pendingDeepLinkInstall: null }),

  // Actions - Command confirmation dialog
  setPendingCommandConfirm: (confirm) => set({ pendingCommandConfirm: confirm }),

  // Actions - Review preview
  setReviewPreviewFile: (file) => set({ reviewPreviewFile: file }),
  clearReviewPreviewFile: () => set({ reviewPreviewFile: null }),
})
