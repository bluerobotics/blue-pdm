import { ChevronRight } from 'lucide-react'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { usePDMStore, type SidebarView } from '../../stores/pdmStore'
import { useTranslation } from '../../lib/i18n'
import { logNavigation } from '../../lib/userActionLogger'
import { 
  isModuleVisible,
  getChildModules,
  type ModuleId,
  type ModuleDefinition
} from '../../types/modules'
import { ExpandedContext } from './ActivityItem'
import { moduleTranslationKeys } from './constants'
import { getModuleIcon } from './utils'

export interface CascadingSidebarProps {
  parentRect: DOMRect
  itemRect?: DOMRect | null  // The rect of the hovered item for vertical positioning
  children: ModuleDefinition[]
  depth: number
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function CascadingSidebar({ parentRect, itemRect, children, depth, onMouseEnter, onMouseLeave }: CascadingSidebarProps) {
  const { activeView, setActiveView, getEffectiveModuleConfig } = usePDMStore()
  const moduleConfig = getEffectiveModuleConfig()
  const { t } = useTranslation()
  const isExpanded = useContext(ExpandedContext)
  const [hoveredChild, setHoveredChild] = useState<ModuleId | null>(null)
  const [childRect, setChildRect] = useState<DOMRect | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
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
  
  // Clear timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
    }
  }, [])
  
  // Close immediately when sidebar collapses to prevent icon drift
  useEffect(() => {
    if (!isExpanded) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
        closeTimeoutRef.current = null
      }
      setHoveredChild(null)
      setChildRect(null)
      onMouseLeave()
    }
  }, [isExpanded, onMouseLeave])
  
  // Measure content height after render
  useEffect(() => {
    if (panelRef.current) {
      setPanelHeight(panelRef.current.scrollHeight)
    }
  }, [visibleChildren.length])
  
  if (visibleChildren.length === 0) return null
  
  // Calculate position - start at hovered item, fit to content
  const itemHeight = 44 // h-11 = 44px per item
  const contentHeight = panelHeight || (visibleChildren.length * itemHeight + 16) // items + padding
  const maxHeight = window.innerHeight - 32 // 16px margin top and bottom
  const finalHeight = Math.min(contentHeight, maxHeight)
  
  // Start position: align with hovered item, or use parent top
  let topPosition = itemRect?.top ?? parentRect.top
  
  // Check if would overflow bottom of screen
  const bottomOverflow = topPosition + finalHeight - (window.innerHeight - 16)
  if (bottomOverflow > 0) {
    // Shift up to fit, but don't go above 16px from top
    topPosition = Math.max(16, topPosition - bottomOverflow)
  }
  
  const style: React.CSSProperties = {
    position: 'fixed',
    top: topPosition,
    left: parentRect.right,
    zIndex: 40 + depth,
    minWidth: isExpanded ? '200px' : '53px',
    width: isExpanded ? 'fit-content' : '53px',
    maxHeight: maxHeight,
  }
  
  const handleChildMouseEnter = (childId: ModuleId, e: React.MouseEvent) => {
    const allChildren = getChildModules(childId, moduleConfig)
    const childModules = allChildren.filter(c => isModuleVisible(c.id, moduleConfig))
    // Debug: always log for production-analytics
    if (childId === 'production-analytics' || allChildren.length > 0) {
      console.log(`[DEBUG] handleChildMouseEnter(${childId}):`, {
        allChildrenCount: allChildren.length,
        allChildrenIds: allChildren.map(c => c.id),
        visibleCount: childModules.length,
        visibleIds: childModules.map(c => c.id),
        moduleParents: Object.entries(moduleConfig.moduleParents || {}).filter(([_k, v]) => v === childId)
      })
    }
    if (childModules.length > 0) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
      setHoveredChild(childId)
      const target = e.currentTarget
      setChildRect(target.getBoundingClientRect())
    }
  }
  
  const handleChildMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredChild(null)
      setChildRect(null)
    }, 400) // Increased delay to give time to reach nested submenu
  }
  
  const handlePanelMouseEnter = () => {
    // Clear any pending close timeouts when entering the panel
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    onMouseEnter()
  }
  
  const handlePanelMouseLeave = () => {
    setHoveredChild(null)
    setChildRect(null)
    // Delay before calling parent's onMouseLeave to allow moving to nested panels
    closeTimeoutRef.current = setTimeout(() => {
      onMouseLeave()
    }, 300)
  }
  
  return (
    <div
      ref={panelRef}
      style={style}
      className="bg-plm-activitybar border-r border-plm-border shadow-xl flex flex-col animate-in slide-in-from-left-2 duration-150"
      onMouseEnter={handlePanelMouseEnter}
      onMouseLeave={handlePanelMouseLeave}
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
              const isComingSoon = !child.implemented
              
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
                      if (isComingSoon) return // Don't navigate for coming soon items
                      logNavigation(child.id, { title: childTitle })
                      setActiveView(child.id as SidebarView)
                    }}
                    className={`relative w-full h-11 flex items-center gap-3 px-[15px] transition-colors group ${
                      isComingSoon
                        ? 'opacity-40 cursor-not-allowed'
                        : isActive
                        ? 'text-plm-fg bg-plm-highlight border-l-2 border-plm-accent'
                        : 'text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight border-l-2 border-transparent'
                    } ${!isComingSoon && !isActive ? 'border-l-2 border-transparent' : ''}`}
                    title={isComingSoon ? 'In Development' : undefined}
                  >
                    {/* Icon */}
                    <div className="w-[22px] h-[22px] flex items-center justify-center flex-shrink-0">
                      {getModuleIcon(child.icon, 22, isComingSoon ? undefined : customIconColor)}
                    </div>
                    
                    {/* Title - only show when expanded */}
                        {isExpanded && (
                      <>
                        <span className={`text-[15px] font-medium whitespace-nowrap flex-1 text-left pr-2 ${isComingSoon ? 'italic' : ''}`}>
                          {childTitle}
                          {isComingSoon && <span className="text-[9px] ml-1.5 not-italic px-1 py-0.5 rounded bg-plm-warning/20 text-plm-warning">In Dev</span>}
                        </span>
                        {hasGrandchildren && !isComingSoon && (
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
                      itemRect={childRect}
                      children={childChildren}
                      depth={depth + 1}
                      onMouseEnter={() => {
                        if (hoverTimeoutRef.current) {
                          clearTimeout(hoverTimeoutRef.current)
                          hoverTimeoutRef.current = null
                        }
                        setHoveredChild(child.id)
                      }}
                      onMouseLeave={() => {
                        // Delay close to allow moving back to parent
                        hoverTimeoutRef.current = setTimeout(() => {
                          setHoveredChild(null)
                        }, 400)
                      }}
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
