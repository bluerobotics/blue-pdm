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
  Globe
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
  type ModuleId
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
}

// Context to share expanded state
const ExpandedContext = createContext(false)

type SidebarMode = 'expanded' | 'collapsed' | 'hover'

interface ActivityItemProps {
  icon: React.ReactNode
  view: SidebarView
  title: string
  badge?: number
}

function ActivityItem({ icon, view, title, badge }: ActivityItemProps) {
  const { activeView, setActiveView } = usePDMStore()
  const isExpanded = useContext(ExpandedContext)
  const [showTooltip, setShowTooltip] = useState(false)
  const isActive = activeView === view

  return (
    <div className="py-1 px-[6px]">
      <button
        onClick={() => {
          logNavigation(view, { title })
          setActiveView(view)
        }}
        onMouseEnter={() => !isExpanded && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`relative h-11 w-full flex items-center gap-3 px-[9px] rounded-lg transition-colors overflow-hidden ${
          isActive
            ? 'text-plm-accent bg-plm-highlight'
            : 'text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight'
        }`}
      >
        {/* Tooltip for collapsed state */}
        {showTooltip && !isExpanded && (
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
          <span className="text-[15px] font-medium whitespace-nowrap overflow-hidden">
            {title}
          </span>
        )}
      </button>
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
function getModuleIcon(iconName: string, size: number = 22): React.ReactNode {
  if (iconName === 'GoogleDrive') {
    return <GoogleDriveIcon size={size} />
  }
  const IconComponent = iconComponents[iconName]
  if (IconComponent) {
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
  'products': 'sidebar.products',
  'process': 'sidebar.process',
  'schedule': 'sidebar.schedule',
  'suppliers': 'sidebar.suppliers',
  'supplier-portal': 'sidebar.supplierPortal',
  'google-drive': 'sidebar.googleDrive',
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
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  
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
  
  // Build the visible modules list based on module order and visibility
  const visibleModules = useMemo(() => {
    return moduleConfig.moduleOrder.filter(moduleId => 
      isModuleVisible(moduleId, moduleConfig)
    )
  }, [moduleConfig])
  
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
  
  // In expanded mode, container matches bar width. In collapsed/hover mode, container is always collapsed width.
  const containerWidth = activityBarMode === 'expanded' ? 'w-64' : 'w-[53px]'
  
  return (
    <ExpandedContext.Provider value={isExpanded}>
      {/* Container with relative positioning for the overlay */}
      <div className={`relative flex-shrink-0 transition-all duration-200 ${containerWidth}`}>
        {/* Actual activity bar - expands on hover, overlays content */}
        <div 
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
              {/* Dynamic Modules */}
              <div className="flex flex-col pt-[4px]">
                {visibleModules.map((moduleId, visibleIndex) => {
                  const module = MODULES.find(m => m.id === moduleId)
                  if (!module) return null
                  
                  const translationKey = moduleTranslationKeys[moduleId]
                  const title = translationKey ? t(translationKey) : module.name
                  
                  // Special handling for reviews badge
                  const badge = moduleId === 'reviews' ? totalBadge : undefined
                  
                  return (
                    <div key={moduleId}>
                      <ActivityItem
                        icon={getModuleIcon(module.icon)}
                        view={moduleId as SidebarView}
                        title={title}
                        badge={badge}
                      />
                      {getDividerAfterVisibleIndex.has(visibleIndex) && <SectionDivider />}
                    </div>
                  )
                })}
              </div>

              {/* Settings - always shown, after a divider if there are visible modules */}
              {visibleModules.length > 0 && <SectionDivider />}
              <ActivityItem
                icon={<Settings size={22} />}
                view="settings"
                title={t('sidebar.settings')}
              />
              
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
    </ExpandedContext.Provider>
  )
}
