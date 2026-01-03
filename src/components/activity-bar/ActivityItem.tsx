import { ChevronRight } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePDMStore, type SidebarView } from '../../stores/pdmStore'
import { logNavigation } from '../../lib/userActionLogger'
import type { ModuleDefinition, ModuleId } from '../../types/modules'
import { CascadingSidebar } from './CascadingSidebar'

// Context to share expanded state
export const ExpandedContext = createContext(false)

// Context to share sidebar rect for cascading panels
export const SidebarRectContext = createContext<DOMRect | null>(null)

export interface ActivityItemProps {
  icon: React.ReactNode
  view: SidebarView
  title: string
  badge?: number
  hasChildren?: boolean
  children?: ModuleDefinition[]
  depth?: number
  onHoverWithChildren?: (moduleId: ModuleId | null, rect: DOMRect | null) => void
  isComingSoon?: boolean
  inDevBadge?: boolean
}

export function ActivityItem({ icon, view, title, badge, hasChildren, children, depth = 0, onHoverWithChildren, isComingSoon = false, inDevBadge = false }: ActivityItemProps) {
  const { activeView, setActiveView, activityBarMode } = usePDMStore()
  const isExpanded = useContext(ExpandedContext)
  const sidebarRect = useContext(SidebarRectContext)
  const [showTooltip, setShowTooltip] = useState(false)
  const [showSubmenu, setShowSubmenu] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const isActive = activeView === view && !isComingSoon
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Show chevron in collapsed mode only (not in hover mode) - not for coming soon items
  const showCollapsedChevron = !isExpanded && activityBarMode === 'collapsed' && hasChildren && children && children.length > 0 && !isComingSoon

  const handleMouseEnter = () => {
    if (!isExpanded && (!hasChildren || isComingSoon)) setShowTooltip(true)
    
    if (hasChildren && children && children.length > 0 && !isComingSoon) {
      // Clear any pending close timeout
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
        submenuTimeoutRef.current = null
      }
      // Delay showing submenu slightly to prevent accidental triggers
      hoverTimeoutRef.current = setTimeout(() => {
        setShowSubmenu(true)
        onHoverWithChildren?.(view as ModuleId, buttonRef.current?.getBoundingClientRect() || null)
      }, 100)
    }
  }

  const handleMouseLeave = () => {
    setShowTooltip(false)
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    // Don't close submenu immediately - give time to move to submenu
    submenuTimeoutRef.current = setTimeout(() => {
      setShowSubmenu(false)
      onHoverWithChildren?.(null, null)
    }, 200)
  }

  // Close submenu immediately when sidebar collapses to prevent icon drift
  useEffect(() => {
    if (!isExpanded) {
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
        submenuTimeoutRef.current = null
      }
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      setShowSubmenu(false)
      setShowTooltip(false)
    }
  }, [isExpanded])

  return (
    <div className="py-1 px-[6px]">
      <button
        ref={buttonRef}
        onClick={() => {
          if (isComingSoon) return // Don't navigate for coming soon items
          // If has children, clicking still navigates to the main view
          logNavigation(view, { title })
          setActiveView(view)
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`relative h-11 w-full flex items-center gap-3 px-[9px] rounded-lg transition-colors overflow-hidden ${
          isComingSoon
            ? 'opacity-40 cursor-not-allowed'
            : isActive
            ? 'text-plm-accent bg-plm-highlight'
            : 'text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight'
        }`}
        title={isComingSoon ? 'In Development' : undefined}
      >
        {/* Tooltip for collapsed state (only if no children or coming soon) */}
        {showTooltip && !isExpanded && (!hasChildren || isComingSoon) && (
          <div className="absolute left-full ml-3 z-50 pointer-events-none">
            <div className="px-2.5 py-1.5 bg-plm-fg text-plm-bg text-sm font-medium rounded whitespace-nowrap">
              {isComingSoon ? `${title} - In Development` : title}
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
        {/* Small chevron for collapsed mode (not hover mode) */}
        {showCollapsedChevron && (
          <ChevronRight 
            size={12} 
            className="absolute -right-0.5 text-plm-fg-dim"
          />
        )}
        {isExpanded && (
          <>
            <span className={`text-[15px] font-medium whitespace-nowrap overflow-hidden flex-1 text-left ${isComingSoon ? 'italic' : ''}`}>
              {title}
              {inDevBadge && <span className="text-[9px] ml-1.5 not-italic px-1 py-0.5 rounded bg-plm-warning/20 text-plm-warning">In Dev</span>}
            </span>
            {/* Chevron for items with children - not for coming soon items */}
            {hasChildren && children && children.length > 0 && !isComingSoon && (
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
          itemRect={buttonRef.current?.getBoundingClientRect()}
          children={children}
          depth={depth + 1}
          onMouseEnter={() => {
            // Clear any pending close timeout when entering submenu
            if (submenuTimeoutRef.current) {
              clearTimeout(submenuTimeoutRef.current)
              submenuTimeoutRef.current = null
            }
            setShowSubmenu(true)
          }}
          onMouseLeave={() => {
            // Delay close to allow moving back to parent
            submenuTimeoutRef.current = setTimeout(() => {
              setShowSubmenu(false)
            }, 150)
          }}
        />
      )}
    </div>
  )
}
