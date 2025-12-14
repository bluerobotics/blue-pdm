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
import { createContext, useContext, useEffect, useState } from 'react'
import { usePDMStore, SidebarView } from '../stores/pdmStore'
import { getUnreadNotificationCount, getPendingReviewsForUser } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'

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
        onClick={() => setActiveView(view)}
        onMouseEnter={() => !isExpanded && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`relative h-11 w-full flex items-center gap-3 px-[9px] rounded-lg transition-colors overflow-hidden ${
          isActive
            ? 'text-pdm-accent bg-pdm-highlight'
            : 'text-pdm-fg-dim hover:text-pdm-fg hover:bg-pdm-highlight'
        }`}
      >
        {/* Tooltip for collapsed state */}
        {showTooltip && !isExpanded && (
          <div className="absolute left-full ml-3 z-50 pointer-events-none">
            <div className="px-2.5 py-1.5 bg-pdm-fg text-pdm-bg text-sm font-medium rounded whitespace-nowrap">
              {title}
            </div>
          </div>
        )}
        <div className="relative w-[22px] h-[22px] flex items-center justify-center flex-shrink-0">
          {icon}
          {badge && badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-pdm-activitybar">
              {badge > 99 ? '99+' : badge}
            </span>
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
      <div className="h-px bg-pdm-border" />
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
          className="w-full h-10 flex items-center px-[9px] rounded-lg text-pdm-fg-dim hover:text-pdm-fg hover:bg-pdm-highlight/50 transition-colors"
        >
          <PanelLeft size={18} />
        </button>
        
        {showMenu && (
          <div 
            className="absolute bottom-full left-0 mb-1 w-44 bg-pdm-bg border border-pdm-border rounded-md shadow-xl overflow-hidden z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-pdm-border">
              <div className="text-[10px] uppercase tracking-wider text-pdm-fg-muted">{t('sidebar.sidebarControl')}</div>
            </div>
            {(['expanded', 'collapsed', 'hover'] as SidebarMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setActivityBarMode(mode)
                  setShowMenu(false)
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  activityBarMode === mode 
                    ? 'bg-pdm-highlight text-pdm-fg' 
                    : 'text-pdm-fg-muted hover:text-pdm-fg hover:bg-pdm-highlight/50'
                }`}
              >
                {activityBarMode === mode && (
                  <div className="w-1.5 h-1.5 rounded-full bg-pdm-accent" />
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

export function ActivityBar() {
  const { 
    user, 
    organization,
    unreadNotificationCount, 
    pendingReviewCount,
    setUnreadNotificationCount,
    setPendingReviewCount,
    activityBarMode
  } = usePDMStore()
  const { t } = useTranslation()
  
  const [isHovering, setIsHovering] = useState(false)
  
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
  
  // In expanded mode, container matches bar width. In collapsed/hover mode, container is always collapsed width.
  // Note: +1px to account for border-r
  const containerWidth = activityBarMode === 'expanded' ? 'w-64' : 'w-[53px]'
  
  return (
    <ExpandedContext.Provider value={isExpanded}>
      {/* Container with relative positioning for the overlay */}
      <div className={`relative flex-shrink-0 transition-all duration-200 ${containerWidth}`}>
        {/* Actual activity bar - expands on hover, overlays content */}
        <div 
          className={`absolute inset-y-0 left-0 bg-pdm-activitybar flex flex-col border-r border-pdm-border z-40 transition-all duration-200 ease-out ${
            isExpanded ? 'w-64' : 'w-[53px]'
          } ${activityBarMode === 'hover' && isExpanded ? 'shadow-xl' : ''}`}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {/* PDM Section - File/Data-centric */}
          <div className="flex flex-col pt-[4px]">
            <ActivityItem
              icon={<FolderTree size={22} />}
              view="explorer"
              title={t('sidebar.explorer')}
            />
            <ActivityItem
              icon={<ArrowDownUp size={22} />}
              view="pending"
              title={t('sidebar.pending')}
            />
            <ActivityItem
              icon={<Search size={22} />}
              view="search"
              title={t('sidebar.search')}
            />
            <ActivityItem
              icon={<GitBranch size={22} />}
              view="workflows"
              title={t('sidebar.workflows')}
            />
            <ActivityItem
              icon={<History size={22} />}
              view="history"
              title={t('sidebar.history')}
            />
            <ActivityItem
              icon={<Trash2 size={22} />}
              view="trash"
              title={t('sidebar.trash')}
            />
            <ActivityItem
              icon={<Terminal size={22} />}
              view="terminal"
              title={t('sidebar.terminal')}
            />
          </div>

          {/* Divider between PDM and PLM */}
          <SectionDivider />

          {/* PLM Section - Lifecycle/Process-centric */}
          <div className="flex flex-col">
            <ActivityItem
              icon={<ClipboardList size={22} />}
              view="eco"
              title={t('sidebar.eco')}
            />
            <ActivityItem
              icon={<Telescope size={22} />}
              view="gsd"
              title={t('sidebar.gsd')}
            />
            <ActivityItem
              icon={<AlertCircle size={22} />}
              view="ecr"
              title={t('sidebar.ecr')}
            />
            <ActivityItem
              icon={<Package size={22} />}
              view="products"
              title={t('sidebar.products')}
            />
            <ActivityItem
              icon={<Network size={22} />}
              view="process"
              title={t('sidebar.process')}
            />
            <ActivityItem
              icon={<Calendar size={22} />}
              view="schedule"
              title={t('sidebar.schedule')}
            />
          <ActivityItem
            icon={<ClipboardCheck size={22} />}
            view="reviews"
            title={t('sidebar.reviews')}
            badge={totalBadge}
          />
            <ActivityItem
              icon={<Building2 size={22} />}
              view="suppliers"
              title={t('sidebar.suppliers')}
            />
            <ActivityItem
              icon={<Globe size={22} />}
              view="supplier-portal"
              title={t('sidebar.supplierPortal')}
            />
          </div>

          {/* Settings */}
          <SectionDivider />
          <ActivityItem
            icon={<Settings size={22} />}
            view="settings"
            title={t('sidebar.settings')}
          />

          {/* Spacer to push sidebar control to bottom */}
          <div className="flex-1" />
          
          {/* Sidebar Control at very bottom */}
          <SidebarControl />
        </div>
      </div>
    </ExpandedContext.Provider>
  )
}
