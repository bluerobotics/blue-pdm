import { useState, useRef, useCallback, useEffect } from 'react'
import { 
  X, 
  Plus, 
  Pin, 
  Copy, 
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Clock,
  Search,
  GitBranch,
  Trash2,
  Terminal,
  FileText,
  Package,
  Settings,
  AlertTriangle,
  Users,
  Truck,
  HardDrive,
  LayoutGrid,
  Layers
} from 'lucide-react'
import { usePDMStore, type Tab, type TabGroup, type SidebarView } from '../stores/pdmStore'

// Icon mapping for views
function getViewIcon(view: SidebarView, size: number = 14) {
  const iconProps = { size, className: 'flex-shrink-0' }
  switch (view) {
    case 'explorer': return <FolderOpen {...iconProps} />
    case 'pending': return <Clock {...iconProps} />
    case 'search': return <Search {...iconProps} />
    case 'workflows': return <GitBranch {...iconProps} />
    case 'history': return <Clock {...iconProps} />
    case 'trash': return <Trash2 {...iconProps} />
    case 'terminal': return <Terminal {...iconProps} />
    case 'eco': return <FileText {...iconProps} />
    case 'ecr': return <AlertTriangle {...iconProps} />
    case 'products': return <Package {...iconProps} />
    case 'process': return <GitBranch {...iconProps} />
    case 'schedule': return <LayoutGrid {...iconProps} />
    case 'reviews': return <FileText {...iconProps} />
    case 'gsd': return <Layers {...iconProps} />
    case 'deviations': return <AlertTriangle {...iconProps} />
    case 'suppliers': return <Users {...iconProps} />
    case 'supplier-portal': return <Truck {...iconProps} />
    case 'google-drive': return <HardDrive {...iconProps} />
    case 'settings': return <Settings {...iconProps} />
    default: return <FileText {...iconProps} />
  }
}

// Tab group colors
const groupColors = [
  { name: 'Red', value: 'bg-red-500/30 border-red-500' },
  { name: 'Orange', value: 'bg-orange-500/30 border-orange-500' },
  { name: 'Yellow', value: 'bg-yellow-500/30 border-yellow-500' },
  { name: 'Green', value: 'bg-green-500/30 border-green-500' },
  { name: 'Blue', value: 'bg-blue-500/30 border-blue-500' },
  { name: 'Purple', value: 'bg-purple-500/30 border-purple-500' },
  { name: 'Pink', value: 'bg-pink-500/30 border-pink-500' },
  { name: 'Cyan', value: 'bg-cyan-500/30 border-cyan-500' },
]

interface TabItemProps {
  tab: Tab
  isActive: boolean
  group?: TabGroup
  onContextMenu: (e: React.MouseEvent, tab: Tab) => void
  onDragStart: (e: React.DragEvent, tab: Tab) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetTab: Tab) => void
}

function TabItem({ tab, isActive, group, onContextMenu, onDragStart, onDragOver, onDrop }: TabItemProps) {
  const { setActiveTab, closeTab } = usePDMStore()
  const [isDragOver, setIsDragOver] = useState(false)
  
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    closeTab(tab.id)
  }
  
  // Get group color class
  const groupColorClass = group?.color || ''
  
  return (
    <div
      draggable
      onClick={() => setActiveTab(tab.id)}
      onContextMenu={(e) => onContextMenu(e, tab)}
      onDragStart={(e) => onDragStart(e, tab)}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
        onDragOver(e)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false)
        onDrop(e, tab)
      }}
      className={`
        group relative flex items-center gap-1.5 h-8 px-3 cursor-pointer select-none
        border-r border-plm-border transition-colors min-w-[100px] max-w-[200px]
        ${isActive 
          ? 'bg-plm-bg text-plm-fg border-b-2 border-b-plm-accent' 
          : 'bg-plm-activitybar text-plm-fg-dim hover:bg-plm-bg-lighter hover:text-plm-fg'
        }
        ${isDragOver ? 'bg-plm-accent/20' : ''}
        ${groupColorClass ? `border-l-2 ${groupColorClass}` : ''}
      `}
    >
      {/* Pin indicator */}
      {tab.isPinned && (
        <Pin size={10} className="text-plm-accent flex-shrink-0" />
      )}
      
      {/* Tab icon */}
      {getViewIcon(tab.view)}
      
      {/* Tab title */}
      <span className="truncate text-[13px] flex-1">
        {tab.title}
      </span>
      
      {/* Close button (hidden for pinned tabs unless hovered) */}
      {(!tab.isPinned || isActive) && (
        <button
          onClick={handleClose}
          className={`
            p-0.5 rounded hover:bg-plm-bg-lighter transition-opacity
            ${tab.isPinned ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}
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
  tabGroups: TabGroup[]
}

function TabContextMenu({ tab, position, onClose, tabGroups }: TabContextMenuProps) {
  const {
    closeTab,
    closeTabsToRight,
    closeOtherTabs,
    closeAllTabs,
    pinTab,
    unpinTab,
    duplicateTab,
    createTabGroup,
    addTabToGroup,
    removeTabFromGroup,
    tabs
  } = usePDMStore()
  
  const menuRef = useRef<HTMLDivElement>(null)
  const [showGroupSubmenu, setShowGroupSubmenu] = useState(false)
  const [showNewGroupInput, setShowNewGroupInput] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  
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
  
  const tabIndex = tabs.findIndex(t => t.id === tab.id)
  const hasTabsToRight = tabIndex < tabs.length - 1
  const hasOtherTabs = tabs.length > 1
  
  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      const groupId = createTabGroup(newGroupName.trim(), groupColors[0].value)
      addTabToGroup(tab.id, groupId)
      onClose()
    }
  }
  
  const handlePopOut = () => {
    // Send IPC to create new window with this tab's view
    window.electronAPI?.createTabWindow?.(tab.view, tab.title, tab.customData)
    closeTab(tab.id)
    onClose()
  }
  
  return (
    <div
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 w-56 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 text-sm"
    >
      {/* Close actions */}
      <button
        onClick={() => { closeTab(tab.id); onClose() }}
        disabled={tab.isPinned}
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
      <button
        onClick={() => { closeTabsToRight(tab.id); onClose() }}
        disabled={!hasTabsToRight}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Close Tabs to the Right
      </button>
      <button
        onClick={() => { closeAllTabs(); onClose() }}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
      >
        Close All Tabs
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
      
      <div className="h-px bg-plm-border my-1" />
      
      {/* Tab groups */}
      <div 
        className="relative"
        onMouseEnter={() => setShowGroupSubmenu(true)}
        onMouseLeave={() => setShowGroupSubmenu(false)}
      >
        <button className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-plm-bg-lighter">
          <span className="flex items-center gap-2">
            <Layers size={14} />
            Add to Group
          </span>
          <ChevronRight size={14} />
        </button>
        
        {showGroupSubmenu && (
          <div className="absolute left-full top-0 ml-1 w-48 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1">
            {/* Existing groups */}
            {tabGroups.map(group => (
              <button
                key={group.id}
                onClick={() => { addTabToGroup(tab.id, group.id); onClose() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
              >
                <div className={`w-3 h-3 rounded ${group.color.split(' ')[0]}`} />
                {group.name}
              </button>
            ))}
            
            {tabGroups.length > 0 && <div className="h-px bg-plm-border my-1" />}
            
            {/* New group */}
            {showNewGroupInput ? (
              <div className="px-2 py-1">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateGroup()
                    if (e.key === 'Escape') setShowNewGroupInput(false)
                  }}
                  placeholder="Group name..."
                  className="w-full px-2 py-1 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setShowNewGroupInput(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter text-plm-accent"
              >
                <Plus size={14} />
                New Group...
              </button>
            )}
            
            {/* Remove from group */}
            {tab.groupId && (
              <>
                <div className="h-px bg-plm-border my-1" />
                <button
                  onClick={() => { removeTabFromGroup(tab.id); onClose() }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter text-plm-error"
                >
                  Remove from Group
                </button>
              </>
            )}
          </div>
        )}
      </div>
      
      <div className="h-px bg-plm-border my-1" />
      
      {/* Pop out */}
      <button
        onClick={handlePopOut}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
      >
        <ExternalLink size={14} />
        Pop Out to New Window
      </button>
    </div>
  )
}

interface NewTabMenuProps {
  position: { x: number; y: number }
  onClose: () => void
}

function NewTabMenu({ position, onClose }: NewTabMenuProps) {
  const { addTab } = usePDMStore()
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
  
  const views: { view: SidebarView; label: string }[] = [
    { view: 'explorer', label: 'Explorer' },
    { view: 'pending', label: 'Pending' },
    { view: 'search', label: 'Search' },
    { view: 'history', label: 'History' },
    { view: 'trash', label: 'Trash' },
    { view: 'terminal', label: 'Terminal' },
    { view: 'eco', label: 'ECOs' },
    { view: 'ecr', label: 'ECRs' },
    { view: 'products', label: 'Products' },
    { view: 'reviews', label: 'Reviews' },
    { view: 'suppliers', label: 'Suppliers' },
    { view: 'google-drive', label: 'Google Drive' },
    { view: 'settings', label: 'Settings' },
  ]
  
  const handleAddTab = (view: SidebarView, label: string) => {
    addTab(view, label)
    onClose()
  }
  
  return (
    <div
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 w-48 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl py-1 text-sm max-h-80 overflow-y-auto"
    >
      {views.map(({ view, label }) => (
        <button
          key={view}
          onClick={() => handleAddTab(view, label)}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-plm-bg-lighter"
        >
          {getViewIcon(view)}
          {label}
        </button>
      ))}
    </div>
  )
}

export function TabBar() {
  const { 
    tabs, 
    activeTabId, 
    tabGroups, 
    tabsEnabled,
    addTab,
    moveTab 
  } = usePDMStore()
  
  const [contextMenu, setContextMenu] = useState<{ tab: Tab; position: { x: number; y: number } } | null>(null)
  const [newTabMenu, setNewTabMenu] = useState<{ position: { x: number; y: number } } | null>(null)
  const [draggedTab, setDraggedTab] = useState<Tab | null>(null)
  
  // Don't render if tabs are disabled or no tabs exist
  if (!tabsEnabled) return null
  
  const handleContextMenu = useCallback((e: React.MouseEvent, tab: Tab) => {
    e.preventDefault()
    setContextMenu({ tab, position: { x: e.clientX, y: e.clientY } })
  }, [])
  
  const handleDragStart = useCallback((e: React.DragEvent, tab: Tab) => {
    setDraggedTab(tab)
    e.dataTransfer.effectAllowed = 'move'
  }, [])
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])
  
  const handleDrop = useCallback((e: React.DragEvent, targetTab: Tab) => {
    e.preventDefault()
    if (!draggedTab || draggedTab.id === targetTab.id) return
    
    const targetIndex = tabs.findIndex(t => t.id === targetTab.id)
    moveTab(draggedTab.id, targetIndex)
    setDraggedTab(null)
  }, [draggedTab, tabs, moveTab])
  
  const handleNewTabClick = (e: React.MouseEvent) => {
    // Quick add explorer tab on single click
    addTab('explorer', 'Explorer')
  }
  
  const handleNewTabContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setNewTabMenu({ position: { x: e.clientX, y: e.clientY } })
  }
  
  // Group tabs by groupId for rendering
  const groupedTabs = tabs.reduce((acc, tab) => {
    const groupId = tab.groupId || 'ungrouped'
    if (!acc[groupId]) acc[groupId] = []
    acc[groupId].push(tab)
    return acc
  }, {} as Record<string, Tab[]>)
  
  // Render order: ungrouped first, then groups
  const renderOrder = ['ungrouped', ...tabGroups.map(g => g.id)]
  
  return (
    <div className="h-9 bg-plm-activitybar border-b border-plm-border flex items-end overflow-x-auto scrollbar-hidden">
      {/* Tabs */}
      <div className="flex items-end h-full">
        {renderOrder.map(groupId => {
          const tabsInGroup = groupedTabs[groupId] || []
          if (tabsInGroup.length === 0) return null
          
          const group = tabGroups.find(g => g.id === groupId)
          
          return (
            <div key={groupId} className="flex items-end h-full">
              {/* Group label (if grouped) */}
              {group && (
                <div 
                  className={`h-8 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wider border-r border-plm-border ${group.color}`}
                >
                  {group.name}
                </div>
              )}
              
              {/* Tabs in this group */}
              {tabsInGroup.map(tab => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  group={group}
                  onContextMenu={handleContextMenu}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                />
              ))}
            </div>
          )
        })}
      </div>
      
      {/* New tab button */}
      <button
        onClick={handleNewTabClick}
        onContextMenu={handleNewTabContextMenu}
        className="h-8 w-8 flex items-center justify-center text-plm-fg-dim hover:text-plm-fg hover:bg-plm-bg-lighter transition-colors flex-shrink-0"
        title="New Tab (Right-click for menu)"
      >
        <Plus size={16} />
      </button>
      
      {/* Spacer to push to the right */}
      <div className="flex-1" />
      
      {/* Context Menu */}
      {contextMenu && (
        <TabContextMenu
          tab={contextMenu.tab}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          tabGroups={tabGroups}
        />
      )}
      
      {/* New Tab Menu */}
      {newTabMenu && (
        <NewTabMenu
          position={newTabMenu.position}
          onClose={() => setNewTabMenu(null)}
        />
      )}
    </div>
  )
}

