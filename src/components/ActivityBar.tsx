import { 
  FolderTree, 
  ArrowDownUp, 
  History, 
  Search,
  Trash2,
  Terminal,
  ClipboardList,
  GitBranch,
  ClipboardCheck,
  Settings,
  AlertCircle,
  Package,
  Network,
  Calendar,
  Telescope,
  PanelLeft,
  Building2,
  Globe,
  FileWarning,
  ChevronRight
} from 'lucide-react'
import { createContext, useContext, useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { usePDMStore, SidebarView } from '../stores/pdmStore'
import { registerModule, unregisterModule } from '@/lib/telemetry'
import { getUnreadNotificationCount, getPendingReviewsForUser } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import { logNavigation, logSettings } from '../lib/userActionLogger'
import { 
  MODULES, 
  isModuleVisible,
  getChildModules,
  buildCombinedOrderList,
  type ModuleId,
  type ModuleDefinition
} from '../types/modules'

// Custom Google Drive icon
function GoogleDriveIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8.24 2L1 14.19L4.24 19.83L11.47 7.64L8.24 2Z" fill="currentColor"/>
      <path d="M15.76 2H8.24L15.47 14.19H22.99L15.76 2Z" fill="currentColor" fillOpacity="0.7"/>
      <path d="M1 14.19L4.24 19.83H19.76L22.99 14.19H1Z" fill="currentColor" fillOpacity="0.4"/>
    </svg>
  )
}

// Icon components mapping
const iconComponents: Record<string, React.ComponentType<{ size?: number }>> = {
  FolderTree,
  ArrowDownUp,
  History,
  Search,
  Trash2,
  Terminal,
  ClipboardList,
  GitBranch,
  ClipboardCheck,
  AlertCircle,
  Package,
  Network,
  Calendar,
  Telescope,
  Building2,
  Globe,
  FileWarning,
  Settings,
}

// Context to share expanded state
const ExpandedContext = createContext(false)

// Context to share sidebar rect for cascading panels
const SidebarRectContext = createContext<DOMRect | null>(null)

type SidebarMode = 'expanded' | 'collapsed' | 'hover'

interface ActivityItemProps {
  icon: React.ReactNode
  view: SidebarView
  title: string
  badge?: number
  hasChildren?: boolean
  children?: ModuleDefinition[]
  depth?: number
  onHoverWithChildren?: (moduleId: ModuleId | null, rect: DOMRect | null) => void
}

function ActivityItem({ icon, view, title, badge, hasChildren, children, depth = 0, onHoverWithChildren }: ActivityItemProps) {
  const { activeView, setActiveView } = usePDMStore()
  const isExpanded = useContext(ExpandedContext)
  const sidebarRect = useContext(SidebarRectContext)
  const [showTooltip, setShowTooltip] = useState(false)
  const [showSubmenu, setShowSubmenu] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const isActive = activeView === view
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = () => {
    if (!isExpanded) setShowTooltip(true)
    
    if (hasChildren && children && children.length > 0) {
      // Delay showing submenu slightly to prevent accidental triggers
      hoverTimeoutRef.current = setTimeout(() => {
        setShowSubmenu(true)
        onHoverWithChildren?.(view as ModuleId, buttonRef.current?.getBoundingClientRect() || null)
      }, 150)
    }
  }

  const handleMouseLeave = () => {
    setShowTooltip(false)
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    // Don't close submenu immediately - let the submenu handle its own hover
    setTimeout(() => {
      setShowSubmenu(false)
      onHoverWithChildren?.(null, null)
    }, 100)
  }

  return (
    <div className="py-1 px-[6px]">
      <button
        ref={buttonRef}
        onClick={() => {
          // If has children, clicking still navigates to the main view
          logNavigation(view, { title })
          setActiveView(view)
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`relative h-11 w-full flex items-center gap-3 px-[9px] rounded-lg transition-colors overflow-hidden ${
          isActive
            ? 'text-plm-accent bg-plm-highlight'
            : 'text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight'
        }`}
      >
        {/* Tooltip for collapsed state */}
        {showTooltip && !isExpanded && !hasChildren && (
          <div className="absolute left-full ml-3 z-50 pointer-events-none">
            <div className="px-2.5 py-1.5 bg-plm-fg text-plm-bg text-sm font-medium rounded whitespace-nowrap">
              {title}
            </div>
          </div>
        )}
        <div className="relative w-[22px] h-[22px] flex items-center justify-center flex-shrink-0">
          {icon}
          {badge !== undefined && badge > 0 && (
            <div className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] flex items-center justify-center bg-plm-error rounded-full shadow-sm">
              <span className="text-[10px] font-bold text-white px-1">
                {badge > 99 ? '99+' : badge}
              </span>
            </div>
          )}
        </div>
        {isExpanded && (
          <>
            <span className="text-[15px] font-medium whitespace-nowrap overflow-hidden flex-1 text-left">
              {title}
            </span>
            {/* Chevron for items with children */}
            {hasChildren && children && children.length > 0 && (
              <ChevronRight 
                size={14} 
                className={`flex-shrink-0 text-plm-fg-dim transition-transform duration-200 ${showSubmenu ? 'translate-x-0.5' : ''}`}
              />
            )}
          </>
        )}
      </button>
      
      {/* Cascading Sidebar Panel */}
      {showSubmenu && hasChildren && children && children.length > 0 && sidebarRect && (
        <CascadingSidebar
          parentRect={sidebarRect}
          children={children}
          depth={depth + 1}
          onMouseEnter={() => setShowSubmenu(true)}
          onMouseLeave={() => setShowSubmenu(false)}
        />
      )}
    </div>
  )
}

// Cascading sidebar panel that appears on hover - matches main sidebar style
interface CascadingSidebarProps {
  parentRect: DOMRect
  children: ModuleDefinition[]
  depth: number
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function CascadingSidebar({ parentRect, children, depth, onMouseEnter, onMouseLeave }: CascadingSidebarProps) {
  const { activeView, setActiveView, moduleConfig } = usePDMStore()
  const { t } = useTranslation()
  const isExpanded = useContext(ExpandedContext)
  const [hoveredChild, setHoveredChild] = useState<ModuleId | null>(null)
  const [childRect, setChildRect] = useState<DOMRect | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Filter to only show visible children
  const visibleChildren = children.filter(child => isModuleVisible(child.id, moduleConfig))
  
  // Update scroll state
  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) {
      setCanScrollUp(container.scrollTop > 0)
      setCanScrollDown(container.scrollTop < container.scrollHeight - container.clientHeight - 1)
    }
  }, [])
  
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      updateScrollState()
      container.addEventListener('scroll', updateScrollState)
      return () => container.removeEventListener('scroll', updateScrollState)
    }
  }, [updateScrollState])
  
  if (visibleChildren.length === 0) return null
  
  // Calculate position - full height, to the right of parent sidebar
  const style: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: parentRect.right,
    zIndex: 40 + depth,
    width: isExpanded ? '256px' : '53px', // Match main sidebar width (w-64 = 256px, w-[53px])
  }
  
  const handleChildMouseEnter = (childId: ModuleId, e: React.MouseEvent) => {
    const childModules = getChildModules(childId, moduleConfig).filter(c => isModuleVisible(c.id, moduleConfig))
    if (childModules.length > 0) {
      // Clear any pending timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
      setHoveredChild(childId)
      const target = e.currentTarget
      setChildRect(target.getBoundingClientRect())
    }
  }
  
  const handleChildMouseLeave = () => {
    // Delay clearing to allow moving to submenu
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredChild(null)
      setChildRect(null)
    }, 150)
  }
  
  return (
    <div
      ref={panelRef}
      style={style}
      className="bg-plm-activitybar border-r border-plm-border shadow-xl flex flex-col animate-in slide-in-from-left-2 duration-200"
      onMouseEnter={() => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current)
        }
        onMouseEnter()
      }}
      onMouseLeave={() => {
        setHoveredChild(null)
        setChildRect(null)
        onMouseLeave()
      }}
    >
      {/* Scrollable area */}
      <div className="flex-1 min-h-0 relative">
        {/* Top fade gradient */}
        <div 
          className={`absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-plm-activitybar to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
            canScrollUp ? 'opacity-100' : 'opacity-0'
          }`}
        />
        
        {/* Scrollable container */}
        <div 
          ref={scrollContainerRef}
          className="h-full overflow-y-auto overflow-x-hidden scrollbar-hidden"
        >
          <div className="flex flex-col pt-[4px]">
            {visibleChildren.map(child => {
              const childChildren = getChildModules(child.id, moduleConfig).filter(c => isModuleVisible(c.id, moduleConfig))
              const hasGrandchildren = childChildren.length > 0
              const translationKey = moduleTranslationKeys[child.id]
              const childTitle = translationKey ? t(translationKey) : child.name
              const isActive = activeView === child.id
              const customIconColor = moduleConfig.moduleIconColors?.[child.id] || null
              
              return (
                <div
                  key={child.id}
                  className="relative"
                  onMouseEnter={(e) => handleChildMouseEnter(child.id, e)}
                  onMouseLeave={handleChildMouseLeave}
                >
                  {/* Item button - styled like ActivityItem */}
                  <button
                    onClick={() => {
                      logNavigation(child.id, { title: childTitle })
                      setActiveView(child.id as SidebarView)
                    }}
                    className={`relative w-full h-11 flex items-center gap-3 px-4 transition-colors group ${
                      isActive
                        ? 'text-plm-fg bg-plm-highlight border-l-2 border-plm-accent'
                        : 'text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight border-l-2 border-transparent'
                    }`}
                  >
                    {/* Icon */}
                    <div className="w-[22px] h-[22px] flex items-center justify-center flex-shrink-0">
                      {getModuleIcon(child.icon, 22, customIconColor)}
                    </div>
                    
                    {/* Title - only show when expanded */}
                    {isExpanded && (
                      <>
                        <span className="text-sm font-medium whitespace-nowrap overflow-hidden flex-1 text-left">
                          {childTitle}
                        </span>
                        {hasGrandchildren && (
                          <ChevronRight 
                            size={14} 
                            className={`flex-shrink-0 text-plm-fg-dim transition-transform duration-200 ${hoveredChild === child.id ? 'translate-x-0.5' : ''}`}
                          />
                        )}
                      </>
                    )}
                  </button>
                  
                  {/* Nested cascade (recursive) */}
                  {hoveredChild === child.id && hasGrandchildren && childRect && (
                    <CascadingSidebar
                      parentRect={panelRef.current?.getBoundingClientRect() || childRect}
                      children={childChildren}
                      depth={depth + 1}
                      onMouseEnter={() => {
                        if (hoverTimeoutRef.current) {
                          clearTimeout(hoverTimeoutRef.current)
                        }
                        setHoveredChild(child.id)
                      }}
                      onMouseLeave={() => setHoveredChild(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
          
          {/* Bottom padding */}
          <div className="h-2" />
        </div>
        
        {/* Bottom fade gradient */}
        <div 
          className={`absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-plm-activitybar to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
            canScrollDown ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    </div>
  )
}


function SectionDivider() {
  return (
    <div className="mx-4 my-2">
      <div className="h-px bg-plm-border" />
    </div>
  )
}

function SidebarControl() {
  const { activityBarMode, setActivityBarMode } = usePDMStore()
  const { t } = useTranslation()
  const [showMenu, setShowMenu] = useState(false)
  
  const modeLabels: Record<SidebarMode, string> = {
    expanded: t('sidebar.expanded'),
    collapsed: t('sidebar.collapsed'), 
    hover: t('sidebar.expandOnHover')
  }
  
  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return
    
    const handleClickOutside = () => setShowMenu(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showMenu])
  
  return (
    <div className="py-[2px] pb-[6px] px-[6px]">
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          className="w-full h-10 flex items-center px-[9px] rounded-lg text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight/50 transition-colors"
        >
          <PanelLeft size={18} />
        </button>
        
        {showMenu && (
          <div 
            className="absolute bottom-full left-0 mb-1 w-44 bg-plm-bg border border-plm-border rounded-md shadow-xl overflow-hidden z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-plm-border">
              <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted">{t('sidebar.sidebarControl')}</div>
            </div>
            {(['expanded', 'collapsed', 'hover'] as SidebarMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  logSettings(`Changed sidebar mode to ${mode}`)
                  setActivityBarMode(mode)
                  setShowMenu(false)
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  activityBarMode === mode 
                    ? 'bg-plm-highlight text-plm-fg' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/50'
                }`}
              >
                {activityBarMode === mode && (
                  <div className="w-1.5 h-1.5 rounded-full bg-plm-accent" />
                )}
                <span className={activityBarMode !== mode ? 'ml-3.5' : ''}>{modeLabels[mode]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Get the icon component for a module
function getModuleIcon(iconName: string, size: number = 22, customColor?: string | null): React.ReactNode {
  if (iconName === 'GoogleDrive') {
    return <GoogleDriveIcon size={size} />
  }
  const IconComponent = iconComponents[iconName]
  if (IconComponent) {
    if (customColor) {
      return (
        <span style={{ color: customColor }}>
          <IconComponent size={size} />
        </span>
      )
    }
    return <IconComponent size={size} />
  }
  return <Package size={size} />
}

// Translation keys for module names
const moduleTranslationKeys: Record<ModuleId, string> = {
  'explorer': 'sidebar.explorer',
  'pending': 'sidebar.pending',
  'search': 'sidebar.search',
  'workflows': 'sidebar.workflows',
  'history': 'sidebar.history',
  'trash': 'sidebar.trash',
  'terminal': 'sidebar.terminal',
  'eco': 'sidebar.eco',
  'gsd': 'sidebar.gsd',
  'ecr': 'sidebar.ecr',
  'reviews': 'sidebar.reviews',
  'deviations': 'sidebar.deviations',
  'products': 'sidebar.products',
  'process': 'sidebar.process',
  'schedule': 'sidebar.schedule',
  'suppliers': 'sidebar.suppliers',
  'supplier-portal': 'sidebar.supplierPortal',
  'google-drive': 'sidebar.googleDrive',
  'settings': 'sidebar.settings',
}

export function ActivityBar() {
  const { 
    user, 
    organization,
    unreadNotificationCount, 
    pendingReviewCount,
    setUnreadNotificationCount,
    setPendingReviewCount,
    activityBarMode,
    moduleConfig
  } = usePDMStore()
  
  // Register module for telemetry tracking
  useEffect(() => {
    registerModule('ActivityBar')
    return () => unregisterModule('ActivityBar')
  }, [])
  const { t } = useTranslation()
  
  const [isHovering, setIsHovering] = useState(false)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const [sidebarRect, setSidebarRect] = useState<DOMRect | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  
  // Determine if sidebar should be expanded based on mode
  const isExpanded = activityBarMode === 'expanded' || (activityBarMode === 'hover' && isHovering)
  
  // Load notification counts on mount and periodically
  useEffect(() => {
    if (!user?.id || !organization?.id) return
    
    const loadCounts = async () => {
      try {
        const { count } = await getUnreadNotificationCount(user.id)
        setUnreadNotificationCount(count)
        
        const { reviews } = await getPendingReviewsForUser(user.id, organization.id)
        setPendingReviewCount(reviews.length)
      } catch (err) {
        console.error('Error loading notification counts:', err)
      }
    }
    
    loadCounts()
    
    // Refresh every 60 seconds
    const interval = setInterval(loadCounts, 60000)
    return () => clearInterval(interval)
  }, [user?.id, organization?.id, setUnreadNotificationCount, setPendingReviewCount])
  
  const totalBadge = unreadNotificationCount + pendingReviewCount
  
  // Build the visible sidebar items (modules and groups) using combined order
  type SidebarItem = 
    | { type: 'module'; id: ModuleId; module: ModuleDefinition }
    | { type: 'group'; id: string; group: typeof moduleConfig.customGroups[0] }
  
  const visibleSidebarItems = useMemo(() => {
    const items: SidebarItem[] = []
    const combinedList = buildCombinedOrderList(
      moduleConfig.moduleOrder,
      moduleConfig.dividers,
      moduleConfig.customGroups || []
    )
    
    for (const item of combinedList) {
      if (item.type === 'group') {
        const group = (moduleConfig.customGroups || []).find(g => g.id === item.id && g.enabled)
        if (group) {
          // Only show if group has visible children
          const childModules = getChildModules(group.id, moduleConfig).filter(child => 
            isModuleVisible(child.id, moduleConfig)
          )
          if (childModules.length > 0) {
            items.push({ type: 'group', id: group.id, group })
          }
        }
      } else if (item.type === 'module') {
        const moduleId = item.id as ModuleId
        const module = MODULES.find(m => m.id === moduleId)
        if (!module) continue
        
        // Only show if visible AND is top-level (no parent)
        const hasParent = moduleConfig.moduleParents?.[moduleId]
        if (!hasParent && isModuleVisible(moduleId, moduleConfig)) {
          items.push({ type: 'module', id: moduleId, module })
        }
      }
    }
    return items
  }, [moduleConfig])
  
  // For backward compat - list of just visible module IDs for divider positioning
  const visibleModules = useMemo(() => {
    return visibleSidebarItems
      .filter((item): item is SidebarItem & { type: 'module' } => item.type === 'module')
      .map(item => item.id)
  }, [visibleSidebarItems])
  
  // Build a map of original index to visible index for divider positioning
  const originalToVisibleIndex = useMemo(() => {
    const map = new Map<number, number>()
    let visibleIdx = -1
    for (let origIdx = 0; origIdx < moduleConfig.moduleOrder.length; origIdx++) {
      const moduleId = moduleConfig.moduleOrder[origIdx]
      if (isModuleVisible(moduleId, moduleConfig)) {
        visibleIdx++
        map.set(origIdx, visibleIdx)
      }
    }
    return map
  }, [moduleConfig])
  
  // Determine where to show dividers based on position
  const getDividerAfterVisibleIndex = useMemo(() => {
    const result = new Set<number>()
    
    for (const divider of moduleConfig.dividers) {
      if (!divider.enabled) continue
      
      // Find the visible index that corresponds to the divider's position
      // The divider position is in the original module order
      // We need to find the last visible module at or before that position
      let lastVisibleIdx = -1
      for (let origIdx = 0; origIdx <= divider.position && origIdx < moduleConfig.moduleOrder.length; origIdx++) {
        const visibleIdx = originalToVisibleIndex.get(origIdx)
        if (visibleIdx !== undefined) {
          lastVisibleIdx = visibleIdx
        }
      }
      
      if (lastVisibleIdx >= 0) {
        result.add(lastVisibleIdx)
      }
    }
    
    return result
  }, [moduleConfig.dividers, originalToVisibleIndex, moduleConfig.moduleOrder.length])
  
  // Check scroll state
  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    const { scrollTop, scrollHeight, clientHeight } = container
    setCanScrollUp(scrollTop > 0)
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1)
  }, [])
  
  // Update scroll state on mount, resize, and when modules change
  useEffect(() => {
    updateScrollState()
    
    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('scroll', updateScrollState)
      
      // Also check on resize
      const resizeObserver = new ResizeObserver(updateScrollState)
      resizeObserver.observe(container)
      
      return () => {
        container.removeEventListener('scroll', updateScrollState)
        resizeObserver.disconnect()
      }
    }
  }, [updateScrollState, visibleModules.length])
  
  // Update sidebar rect for cascading panels
  useEffect(() => {
    const updateSidebarRect = () => {
      if (sidebarRef.current) {
        setSidebarRect(sidebarRef.current.getBoundingClientRect())
      }
    }
    
    updateSidebarRect()
    
    // Update on resize
    const resizeObserver = new ResizeObserver(updateSidebarRect)
    if (sidebarRef.current) {
      resizeObserver.observe(sidebarRef.current)
    }
    
    return () => resizeObserver.disconnect()
  }, [isExpanded])
  
  // In expanded mode, container matches bar width. In collapsed/hover mode, container is always collapsed width.
  const containerWidth = activityBarMode === 'expanded' ? 'w-64' : 'w-[53px]'
  
  return (
    <ExpandedContext.Provider value={isExpanded}>
      <SidebarRectContext.Provider value={sidebarRect}>
      {/* Container with relative positioning for the overlay */}
      <div className={`relative flex-shrink-0 transition-all duration-200 ${containerWidth}`}>
        {/* Actual activity bar - expands on hover, overlays content */}
        <div 
          ref={sidebarRef}
          className={`absolute inset-y-0 left-0 bg-plm-activitybar flex flex-col border-r border-plm-border z-40 transition-all duration-200 ease-out ${
            isExpanded ? 'w-64' : 'w-[53px]'
          } ${activityBarMode === 'hover' && isExpanded ? 'shadow-xl' : ''}`}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {/* Scrollable modules area */}
          <div className="flex-1 min-h-0 relative">
            {/* Top fade gradient - indicates more content above */}
            <div 
              className={`absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-plm-activitybar to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
                canScrollUp ? 'opacity-100' : 'opacity-0'
              }`}
            />
            
            {/* Scrollable container - hide scrollbar since fade gradients indicate scrollability */}
            <div 
              ref={scrollContainerRef}
              className="h-full overflow-y-auto overflow-x-hidden scrollbar-hidden"
            >
              {/* Dynamic Modules and Groups */}
              <div className="flex flex-col pt-[4px]">
                {visibleSidebarItems.map((item) => {
                  if (item.type === 'group') {
                    // Render custom group
                    const { group } = item
                    const childModules = getChildModules(group.id, moduleConfig).filter(child => 
                      isModuleVisible(child.id, moduleConfig)
                    )
                    
                    return (
                      <ActivityItem
                        key={group.id}
                        icon={getModuleIcon(group.icon, 22, group.iconColor)}
                        view={'explorer' as SidebarView}  // Groups don't navigate directly
                        title={group.name}
                        hasChildren={true}
                        children={childModules}
                      />
                    )
                  } else {
                    // Render module
                    const { module, id: moduleId } = item
                    const translationKey = moduleTranslationKeys[moduleId]
                    const title = translationKey ? t(translationKey) : module.name
                    
                    // Special handling for reviews badge
                    const badge = moduleId === 'reviews' ? totalBadge : undefined
                    
                    // Get visible child modules (using config's moduleParents)
                    const childModules = getChildModules(moduleId, moduleConfig).filter(child => 
                      isModuleVisible(child.id, moduleConfig)
                    )
                    const moduleHasChildren = childModules.length > 0
                    
                    // Get custom icon color
                    const customIconColor = moduleConfig.moduleIconColors?.[moduleId] || null
                    
                    // Find visible index for this module for divider positioning
                    const visibleIndex = visibleModules.indexOf(moduleId)
                    
                    return (
                      <div key={moduleId}>
                        <ActivityItem
                          icon={getModuleIcon(module.icon, 22, customIconColor)}
                          view={moduleId as SidebarView}
                          title={title}
                          badge={badge}
                          hasChildren={moduleHasChildren}
                          children={childModules}
                        />
                        {visibleIndex >= 0 && getDividerAfterVisibleIndex.has(visibleIndex) && <SectionDivider />}
                      </div>
                    )
                  }
                })}
              </div>

              {/* Bottom padding for scroll */}
              <div className="h-2" />
            </div>
            
            {/* Bottom fade gradient - indicates more content below */}
            <div 
              className={`absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-plm-activitybar to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
                canScrollDown ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </div>
          
          {/* Sidebar Control at very bottom - always visible */}
          <div className="flex-shrink-0">
            <SidebarControl />
          </div>
        </div>
      </div>
      </SidebarRectContext.Provider>
    </ExpandedContext.Provider>
  )
}
