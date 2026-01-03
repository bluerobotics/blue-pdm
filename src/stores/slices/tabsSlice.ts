import { StateCreator } from 'zustand'
import type { PDMStoreState, TabsSlice, Tab, TabGroup, TabPanelState } from '../types'

export const createTabsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  TabsSlice
> = (set, get) => ({
  // Initial state
  tabs: [{
    id: 'default-tab',
    title: 'Explorer',
    folderPath: '',
    panelState: { sidebarVisible: true, detailsPanelVisible: true, rightPanelVisible: false }
  }],
  activeTabId: 'default-tab',
  tabGroups: [],
  tabsEnabled: true,
  
  // Actions
  setTabsEnabled: (enabled) => set({ tabsEnabled: enabled }),
  
  addTab: (folderPath, title) => {
    const { currentFolder, sidebarVisible, detailsPanelVisible, rightPanelVisible, connectedVaults, activeVaultId } = get()
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const folder = folderPath ?? currentFolder
    const activeVault = connectedVaults.find(v => v.id === activeVaultId)
    const folderName = folder ? folder.split(/[/\\]/).pop() || 'Root' : (activeVault?.name || 'Explorer')
    
    const newTab: Tab = {
      id,
      title: title || folderName,
      folderPath: folder,
      panelState: { sidebarVisible, detailsPanelVisible, rightPanelVisible }
    }
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabId: id,
    }))
    return id
  },
  
  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    
    // Always keep at least one tab
    if (tabs.length <= 1) return
    
    const tabIndex = tabs.findIndex(t => t.id === tabId)
    if (tabIndex === -1) return
    
    // Don't close pinned tabs directly
    const tab = tabs[tabIndex]
    if (tab.isPinned) return
    
    const newTabs = tabs.filter(t => t.id !== tabId)
    
    // If closing active tab, switch to adjacent tab
    let newActiveId = activeTabId
    let newActiveTab: Tab | undefined
    if (activeTabId === tabId && newTabs.length > 0) {
      const newIndex = Math.min(tabIndex, newTabs.length - 1)
      newActiveTab = newTabs[newIndex]
      newActiveId = newActiveTab.id
    }
    
    // Restore the new active tab's state
    if (newActiveTab) {
      set({
        tabs: newTabs,
        activeTabId: newActiveId,
        currentFolder: newActiveTab.folderPath,
        sidebarVisible: newActiveTab.panelState.sidebarVisible,
        detailsPanelVisible: newActiveTab.panelState.detailsPanelVisible,
        rightPanelVisible: newActiveTab.panelState.rightPanelVisible,
      })
    } else {
      set({ tabs: newTabs, activeTabId: newActiveId })
    }
  },
  
  closeOtherTabs: (tabId) => {
    const { tabs } = get()
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    
    // Keep the current tab and pinned tabs
    const newTabs = tabs.filter(t => t.id === tabId || t.isPinned)
    set({
      tabs: newTabs,
      activeTabId: tabId,
    })
  },
  
  setActiveTab: (tabId) => {
    const { tabs, activeTabId } = get()
    if (tabId === activeTabId) return
    
    const tab = tabs.find(t => t.id === tabId)
    if (tab) {
      // Restore the tab's folder and panel state
      set({
        activeTabId: tabId,
        currentFolder: tab.folderPath,
        sidebarVisible: tab.panelState.sidebarVisible,
        detailsPanelVisible: tab.panelState.detailsPanelVisible,
        rightPanelVisible: tab.panelState.rightPanelVisible,
      })
    }
  },
  
  moveTab: (tabId, newIndex) => {
    const { tabs } = get()
    const currentIndex = tabs.findIndex(t => t.id === tabId)
    if (currentIndex === -1 || newIndex < 0 || newIndex >= tabs.length) return
    
    const newTabs = [...tabs]
    const [movedTab] = newTabs.splice(currentIndex, 1)
    newTabs.splice(newIndex, 0, movedTab)
    set({ tabs: newTabs })
  },
  
  pinTab: (tabId) => {
    const { tabs } = get()
    const newTabs = tabs.map(t => 
      t.id === tabId ? { ...t, isPinned: true } : t
    )
    // Move pinned tab to the front (after other pinned tabs)
    const pinnedCount = newTabs.filter(t => t.isPinned && t.id !== tabId).length
    const tabIndex = newTabs.findIndex(t => t.id === tabId)
    if (tabIndex > pinnedCount) {
      const [tab] = newTabs.splice(tabIndex, 1)
      newTabs.splice(pinnedCount, 0, tab)
    }
    set({ tabs: newTabs })
  },
  
  unpinTab: (tabId) => {
    const { tabs } = get()
    set({
      tabs: tabs.map(t => 
        t.id === tabId ? { ...t, isPinned: false } : t
      )
    })
  },
  
  duplicateTab: (tabId) => {
    const { tabs } = get()
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return ''
    
    const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const newTab: Tab = {
      ...tab,
      id: newId,
      isPinned: false,
      title: `${tab.title} (Copy)`,
    }
    
    const tabIndex = tabs.findIndex(t => t.id === tabId)
    const newTabs = [...tabs]
    newTabs.splice(tabIndex + 1, 0, newTab)
    
    set({
      tabs: newTabs,
      activeTabId: newId,
    })
    return newId
  },
  
  updateTabTitle: (tabId, title) => {
    const { tabs } = get()
    set({
      tabs: tabs.map(t => 
        t.id === tabId ? { ...t, title } : t
      )
    })
  },
  
  updateTabFolder: (tabId, folderPath) => {
    const { tabs, connectedVaults, activeVaultId } = get()
    const activeVault = connectedVaults.find(v => v.id === activeVaultId)
    const folderName = folderPath ? folderPath.split(/[/\\]/).pop() || 'Root' : (activeVault?.name || 'Explorer')
    set({
      tabs: tabs.map(t => 
        t.id === tabId ? { ...t, folderPath, title: folderName } : t
      )
    })
  },
  
  updateTabPanelState: (tabId, panelState: Partial<TabPanelState>) => {
    const { tabs } = get()
    set({
      tabs: tabs.map(t => 
        t.id === tabId ? { ...t, panelState: { ...t.panelState, ...panelState } } : t
      )
    })
  },
  
  syncCurrentTabWithState: () => {
    const { activeTabId, tabs, currentFolder, sidebarVisible, detailsPanelVisible, rightPanelVisible, connectedVaults, activeVaultId } = get()
    if (!activeTabId) return
    
    const activeVault = connectedVaults.find(v => v.id === activeVaultId)
    const folderName = currentFolder ? currentFolder.split(/[/\\]/).pop() || 'Root' : (activeVault?.name || 'Explorer')
    set({
      tabs: tabs.map(t => 
        t.id === activeTabId ? {
          ...t,
          folderPath: currentFolder,
          title: folderName,
          panelState: { sidebarVisible, detailsPanelVisible, rightPanelVisible }
        } : t
      )
    })
  },
  
  // Tab Groups
  createTabGroup: (name, color) => {
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const newGroup: TabGroup = { id, name, color }
    set((s) => ({
      tabGroups: [...s.tabGroups, newGroup]
    }))
    return id
  },
  
  deleteTabGroup: (groupId) => {
    const { tabGroups, tabs } = get()
    set({
      tabGroups: tabGroups.filter(g => g.id !== groupId),
      tabs: tabs.map(t => 
        t.groupId === groupId ? { ...t, groupId: undefined } : t
      )
    })
  },
  
  renameTabGroup: (groupId, name) => {
    const { tabGroups } = get()
    set({
      tabGroups: tabGroups.map(g => 
        g.id === groupId ? { ...g, name } : g
      )
    })
  },
  
  setTabGroupColor: (groupId, color) => {
    const { tabGroups } = get()
    set({
      tabGroups: tabGroups.map(g => 
        g.id === groupId ? { ...g, color } : g
      )
    })
  },
  
  addTabToGroup: (tabId, groupId) => {
    const { tabs } = get()
    set({
      tabs: tabs.map(t => 
        t.id === tabId ? { ...t, groupId } : t
      )
    })
  },
  
  removeTabFromGroup: (tabId) => {
    const { tabs } = get()
    set({
      tabs: tabs.map(t => 
        t.id === tabId ? { ...t, groupId: undefined } : t
      )
    })
  },
})
