import { useState, useRef, useCallback, useEffect } from 'react'
import { 
  X, 
  Plus, 
  Pin, 
  Copy, 
  FolderOpen
} from 'lucide-react'
import { usePDMStore, type Tab } from '../stores/pdmStore'

type DropPosition = 'before' | 'after' | null

interface TabItemProps {
  tab: Tab
  tabIndex: number
  isActive: boolean
  isOnlyTab: boolean
  isDragging: boolean
  onContextMenu: (e: React.MouseEvent, tab: Tab) => void
  onDragStart: (e: React.DragEvent, tab: Tab) => void
  showDropIndicator: DropPosition
}

function TabItem({ tab, tabIndex, isActive, isOnlyTab, isDragging, onContextMenu, onDragStart, showDropIndicator }: TabItemProps) {
  const { setActiveTab, closeTab } = usePDMStore()
  
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOnlyTab) {
      closeTab(tab.id)
    }
  }
  
  return (
    <div
      data-tab-index={tabIndex}
      draggable={true}
      onClick={() => setActiveTab(tab.id)}
      onContextMenu={(e) => onContextMenu(e, tab)}
      onDragStart={(e) => {
        e.stopPropagation()
        onDragStart(e, tab)
      }}
      className={`
        group relative flex items-center gap-1.5 px-3 cursor-grab active:cursor-grabbing select-none titlebar-no-drag
        transition-all min-w-[120px] max-w-[220px]
        ${isActive 
          ? 'bg-[#3a3a3a] text-plm-fg h-[34px] rounded-t-xl z-10 -mb-px' 
          : 'bg-plm-bg/50 text-plm-fg-dim hover:bg-plm-bg-lighter hover:text-plm-fg h-[30px] mt-1 mx-0.5 rounded-t-lg'
        }
        ${isDragging ? 'opacity-50 scale-95' : ''}
      `}
    >
      {/* Chrome-style interior corner curves for active tab */}
      {isActive && (
        <>
          {/* Left interior curve - uses box-shadow trick */}
          <div 
            className="absolute -left-[10px] bottom-0 w-[10px] h-[10px] rounded-br-full bg-transparent"
            style={{
              boxShadow: '5px 0 0 0 #3a3a3a',
            }}
          />
          {/* Right interior curve */}
          <div 
            className="absolute -right-[10px] bottom-0 w-[10px] h-[10px] rounded-bl-full bg-transparent"
            style={{
              boxShadow: '-5px 0 0 0 #3a3a3a',
            }}
          />
        </>
      )}
      {/* Drop indicator - shown as vertical bar on left or right edge */}
      {showDropIndicator === 'before' && (
        <div className="absolute -left-[2px] top-1 bottom-1 w-1 bg-plm-accent rounded-full z-10" />
      )}
      {showDropIndicator === 'after' && (
        <div className="absolute -right-[2px] top-1 bottom-1 w-1 bg-plm-accent rounded-full z-10" />
      )}
      {/* Pin indicator */}
      {tab.isPinned && (
        <Pin size={10} className="text-plm-accent flex-shrink-0" />
      )}
      
      {/* Folder icon */}
      <FolderOpen size={14} className="flex-shrink-0 text-plm-accent" />
      
      {/* Tab title */}
      <span className="truncate text-[13px] flex-1">
        {tab.title}
      </span>
      
      {/* Close button (hidden for pinned or only tab) */}
      {!isOnlyTab && !tab.isPinned && (
        <button
          onClick={handleClose}
          className={`
            p-0.5 rounded hover:bg-plm-bg-lighter transition-opacity
            opacity-0 group-hover:opacity-100
            ${isActive ? 'opacity-100' : ''}
          `}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

interface TabContextMenuProps {
  tab: Tab
  position: { x: number; y: number }
  onClose: () => void
  tabCount: number
}

function TabContextMenu({ tab, position, onClose, tabCount }: TabContextMenuProps) {
  const {
    closeTab,
    closeOtherTabs,
    pinTab,
    unpinTab,
    duplicateTab
  } = usePDMStore()
  
  const menuRef = useRef<HTMLDivElement>(null)
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])
  
  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])
  
  const hasOtherTabs = tabCount > 1
  const canClose = hasOtherTabs && !tab.isPinned
  
  return (
    <div
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 w-52 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 text-sm"
    >
      {/* Close actions */}
      <button
        onClick={() => { closeTab(tab.id); onClose() }}
        disabled={!canClose}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={14} />
        Close
      </button>
      <button
        onClick={() => { closeOtherTabs(tab.id); onClose() }}
        disabled={!hasOtherTabs}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Close Other Tabs
      </button>
      
      <div className="h-px bg-plm-border my-1" />
      
      {/* Pin/Unpin */}
      <button
        onClick={() => { tab.isPinned ? unpinTab(tab.id) : pinTab(tab.id); onClose() }}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
      >
        <Pin size={14} />
        {tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
      </button>
      
      {/* Duplicate */}
      <button
        onClick={() => { duplicateTab(tab.id); onClose() }}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
      >
        <Copy size={14} />
        Duplicate Tab
      </button>
    </div>
  )
}

export function TabBar() {
  const { 
    tabs, 
    activeTabId, 
    tabsEnabled,
    addTab,
    moveTab
  } = usePDMStore()
  
  const tabContainerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ tab: Tab; position: { x: number; y: number } } | null>(null)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; position: DropPosition } | null>(null)
  
  const handleContextMenu = useCallback((e: React.MouseEvent, tab: Tab) => {
    e.preventDefault()
    setContextMenu({ tab, position: { x: e.clientX, y: e.clientY } })
  }, [])
  
  const handleDragStart = useCallback((e: React.DragEvent, tab: Tab) => {
    // Set drag data first (required for drag to work in some browsers)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `tab:${tab.id}`)
    e.dataTransfer.setData('application/x-tab', tab.id)
    
    // Set state after dataTransfer setup
    setDraggedTabId(tab.id)
    
    // Create custom drag image
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, e.nativeEvent.offsetX, e.nativeEvent.offsetY)
    }
  }, [])
  
  // Handle drag over the entire tab container to calculate drop position
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    
    if (!tabContainerRef.current || !draggedTabId) return
    
    const draggedIndex = tabs.findIndex(t => t.id === draggedTabId)
    if (draggedIndex === -1) return
    
    // Find all tab elements
    const tabElements = tabContainerRef.current.querySelectorAll<HTMLElement>('[data-tab-index]')
    
    let targetIndex: number | null = null
    let position: DropPosition = null
    
    for (const tabEl of tabElements) {
      const rect = tabEl.getBoundingClientRect()
      const tabIndex = parseInt(tabEl.dataset.tabIndex || '-1', 10)
      
      if (tabIndex === -1) continue
      
      // Check if mouse is within this tab's horizontal bounds
      if (e.clientX >= rect.left && e.clientX <= rect.right) {
        // Use 40% / 60% split to create a stable zone in the middle
        const leftThreshold = rect.left + rect.width * 0.4
        const rightThreshold = rect.left + rect.width * 0.6
        
        if (e.clientX < leftThreshold) {
          position = 'before'
          targetIndex = tabIndex
        } else if (e.clientX > rightThreshold) {
          position = 'after'
          targetIndex = tabIndex
        } else {
          // In the middle zone - keep previous position if same tab, otherwise default to 'after'
          if (dropTarget?.index === tabIndex) {
            position = dropTarget.position
            targetIndex = tabIndex
          } else {
            position = 'after'
            targetIndex = tabIndex
          }
        }
        break
      }
      
      // Handle case where mouse is to the left of the first tab
      if (e.clientX < rect.left && tabIndex === 0) {
        position = 'before'
        targetIndex = 0
        break
      }
      
      // Handle case where mouse is to the right of this tab but not in the next one
      if (e.clientX > rect.right) {
        position = 'after'
        targetIndex = tabIndex
        // Continue to check next tabs
      }
    }
    
    if (targetIndex !== null && position !== null) {
      // Don't show indicator if it would result in no movement
      const wouldMoveTo = position === 'before' ? targetIndex : targetIndex + 1
      const adjustedTarget = draggedIndex < wouldMoveTo ? wouldMoveTo - 1 : wouldMoveTo
      
      if (draggedIndex === adjustedTarget) {
        setDropTarget(null)
        return
      }
      
      setDropTarget({ index: targetIndex, position })
    }
  }, [draggedTabId, tabs, dropTarget])
  
  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're actually leaving the container (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (!tabContainerRef.current?.contains(relatedTarget)) {
      setDropTarget(null)
    }
  }, [])
  
  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    
    // Handle tab drop (reordering)
    if (!draggedTabId || !dropTarget) {
      setDraggedTabId(null)
      setDropTarget(null)
      return
    }
    
    const draggedIndex = tabs.findIndex(t => t.id === draggedTabId)
    if (draggedIndex === -1) {
      setDraggedTabId(null)
      setDropTarget(null)
      return
    }
    
    // Calculate the new index based on drop position
    let newIndex = dropTarget.position === 'before' ? dropTarget.index : dropTarget.index + 1
    
    // Adjust if dragging from before the target
    if (draggedIndex < newIndex) {
      newIndex--
    }
    
    if (draggedIndex !== newIndex) {
      moveTab(draggedTabId, newIndex)
    }
    
    setDraggedTabId(null)
    setDropTarget(null)
  }, [draggedTabId, dropTarget, tabs, moveTab])
  
  const handleNewTabClick = useCallback(() => {
    addTab()
  }, [addTab])
  
  const handleDragEnd = useCallback(() => {
    setDraggedTabId(null)
    setDropTarget(null)
  }, [])
  
  // Don't render if tabs are disabled
  if (!tabsEnabled) return null
  
  return (
    <div 
      className="h-[35px] bg-plm-activitybar flex items-end overflow-x-auto scrollbar-hidden px-1 titlebar-no-drag"
      onDragEnd={handleDragEnd}
    >
      {/* Tabs container - handles all drag events */}
      <div 
        ref={tabContainerRef}
        className="flex items-end h-full titlebar-no-drag"
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onDrop={handleContainerDrop}
      >
        {tabs.map((tab, tabIndex) => {
          // Calculate if this tab should show the drop indicator
          let showDropIndicator: DropPosition = null
          if (dropTarget?.index === tabIndex) {
            showDropIndicator = dropTarget.position
          }
          
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              tabIndex={tabIndex}
              isActive={tab.id === activeTabId}
              isOnlyTab={tabs.length === 1}
              isDragging={tab.id === draggedTabId}
              onContextMenu={handleContextMenu}
              onDragStart={handleDragStart}
              showDropIndicator={showDropIndicator}
            />
          )
        })}
      </div>
      
      {/* New tab button */}
      <button
        onClick={handleNewTabClick}
        className="h-7 w-7 mb-0.5 ml-1 flex items-center justify-center text-plm-fg-dim hover:text-plm-fg hover:bg-plm-bg-light rounded transition-colors flex-shrink-0"
        title="New Tab"
      >
        <Plus size={16} />
      </button>
      
      {/* Spacer to push to the right */}
      <div className="flex-1" />
      
      {/* Tab Context Menu */}
      {contextMenu && (
        <TabContextMenu
          tab={contextMenu.tab}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          tabCount={tabs.length}
        />
      )}
    </div>
  )
}
